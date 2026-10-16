/**
 * Purpose: Core save logic for handleSave, extracted from App.tsx, plus the
 * post-await half of a save: `applySaveResult` writes a finished save back to the
 * store without overwriting edits that landed while the save was awaiting (D19).
 * The save bodies and the per-document queue that serializes them (D70) live in
 * `documentSave.ts`.
 *
 * Pipeline (D19): save IPC resolves → `applySaveResult` → settle flush
 *   ("save-settle") → re-read the store → `resolveSaveResult` → apply
 *   (`applied`: upsert + delete draft; `edited-during-save`: upsert path/lastSaved,
 *   and dirty if the store no longer holds what was written (D70); `closed`:
 *   nothing) → log.
 *
 * Key decisions:
 * - `applySaveResult` is synchronous and final: no `await` between reading and
 *   writing the store, and nothing runs after `delete_draft` resolves (F8).
 * - The draft is deleted only on `applied`; after an in-flight edit it is the only
 *   persisted copy of the newer text.
 * - A failed settle flush demotes `applied` to `edited-during-save`, but `closed`
 *   is decided first, so a failed flush never resurrects a closed tab (F7). The
 *   demoted document loses its saved-content baseline (D214): the editor may hold
 *   text the store lacks, so no later write may read clean until a clean point.
 * - D214-WI-5/6: an external change or a close recorded while the save ran (the
 *   document's baseline epoch is past the generation the caller captured) demotes it
 *   the same way and forces it dirty.
 * - The `file.save` result log carries the document id, a boolean flag and the
 *   caller's actionId, never content, lengths or paths. A `draft.delete` failure
 *   warn also carries the IPC error text, which may name the draft file.
 *
 * Extracted so it can be unit-tested without mounting the App component (#377).
 * The save path intentionally omits the busy-indicator lifecycle — toggling
 * that overlay causes a visible layout shift (blink) on Cmd+S. Local saves
 * complete fast enough that no progress indicator is needed; the "Saved" toast
 * is sufficient feedback.
 */

/** Dependencies injected by handleSave — separated for unit-testability. */
export interface SaveDeps {
  saveActiveDocument: (
    id?: string,
  ) => Promise<{ path?: string | null; success?: boolean } | null | undefined>;
  updateRecentFiles: (path: string) => void;
  showToast: (message: string) => void;
}

/**
 * Execute a document save without mounting the busy overlay.
 *
 * Toggling the busy overlay on save causes a layout shift (blink) because the
 * border-bottom on `.busy-indicator` shifts the workspace down then up within
 * ~10–50 ms. Local saves don't need a progress indicator; the "Saved" toast
 * is sufficient.
 *
 * Also owns the save-side flush (D15): `flushDocumentForSave` pushes pending
 * WYSIWYG edits into documentStore and returns the fresh document, so the
 * bytes handed to `save_file` / `save_file_dialog` never come from a render
 * closure. A failed flush throws, which `performSave` surfaces as "Save failed:"
 * and which leaves the document dirty (rule 60: never save stale content silently).
 * A rejected save IPC (a serialized `FileError`) is shown in Rust's wording through
 * `ipcErrorMessage`, never as `[object Object]` (D163).
 *
 * @coordinates-with src/services/documentSave.ts — the queued save bodies (D70)
 * @coordinates-with src/stores/milkdownEditorStore.ts — flushPendingEdits
 * @coordinates-with src/utils/saveResult.ts — resolveSaveResult (D19)
 * @coordinates-with src/utils/ipcErrorMessage.ts — the "Save failed:" text (D163)
 */

import { invoke } from "@tauri-apps/api/core";
import { baselineMovedSince, useDocumentStore } from "../stores/documentStore";
import { useMilkdownEditorStore } from "../stores/milkdownEditorStore";
import type { Document } from "../types/document";
import { ipcErrorMessage } from "../utils/ipcErrorMessage";
import { resolveSaveResult, type SaveResolution } from "../utils/saveResult";
import type { SaveResult } from "./fileService";
import { loggingService } from "./loggingService";

/**
 * Flush pending WYSIWYG edits, then read document `documentId` from the store
 * (`null` if it was closed, e.g. while its save waited in the queue).
 * Throws when the flush failed: saving would write content older than the editor.
 */
export function flushDocumentForSave(documentId: string, actionId?: string): Document | null {
  const { status } = useMilkdownEditorStore.getState().flushPendingEdits("save");
  const doc = useDocumentStore.getState().getDocumentById(documentId) ?? null;
  if (status === "failed") {
    loggingService.logEventSync({
      level: "error",
      event: "file.save",
      status: "fail",
      actionId: actionId ?? loggingService.generateActionId(),
      context: { documentId: doc?.id ?? null, cause: "flush-failed" },
    });
    throw new Error("editor changes could not be captured; the document was not saved");
  }
  return doc;
}
export async function performSave(
  actionId: string | undefined,
  deps: SaveDeps,
): Promise<void> {
  try {
    const result = await deps.saveActiveDocument(actionId);
    if (result?.path) deps.updateRecentFiles(result.path);
    if (result?.success) deps.showToast("Saved");
  } catch (err) {
    // D163: a rejected save IPC is a serialized `FileError` object, not an `Error`.
    deps.showToast(`Save failed: ${ipcErrorMessage(err)}`);
  }
}


/** Flush reason for the post-await flush that precedes the compare (D19). */
const SETTLE_FLUSH_REASON = "save-settle";

/**
 * Delete a document's auto-save draft after a save that wrote everything the store
 * holds. Fire-and-forget: a rejection is logged as a `draft.delete` warn, never thrown.
 */
function deleteDraftAfterSave(documentId: string, actionId?: string): void {
  void invoke("delete_draft", { documentId }).catch((err) => {
    loggingService.logEventSync({
      level: "warn",
      event: "draft.delete",
      status: "fail",
      actionId: actionId ?? loggingService.generateActionId(),
      context: { documentId, error: err instanceof Error ? err.message : String(err) },
    });
  });
}

/** D214-WI-5/6: a save demoted because the baseline moved (change or close) while it ran. */
function logDemotedSave(documentId: string, actionId: string | undefined): void {
  loggingService.logEventSync({
    level: "warn",
    event: "file.save",
    status: "success",
    actionId: actionId ?? loggingService.generateActionId(),
    context: { documentId, demoted: true, reason: "external_change_during_save" },
  });
}

/** Log a save whose result was not applied as written (ids and flags only). */
function logUnappliedSave(
  documentId: string,
  flag: "editedDuringSave" | "closedDuringSave",
  actionId: string | undefined,
): void {
  loggingService.logEventSync({
    level: "info",
    event: "file.save",
    status: "success",
    actionId: actionId ?? loggingService.generateActionId(),
    context: { documentId, [flag]: true },
  });
}

/**
 * Apply a successful save to the store (D19). Call it synchronously after the save
 * IPC resolved with `success: true`; `snapshotContent` is the content read before the
 * save's first await, and `writtenContent` is what went to disk (the snapshot, or its
 * auto-reformat).
 *
 * - Flushes pending WYSIWYG edits first (`"save-settle"`), so an edit still waiting
 *   on the edit-sync timer is compared rather than marked clean.
 * - `applied`: store takes `writtenContent`, clean, with path / lastSaved; the draft
 *   is deleted.
 * - `edited-during-save` (also forced by a failed settle flush): one upsert of path /
 *   lastSaved; content untouched; dirty raised if the store content is not what was
 *   written (D70); the baseline becomes `writtenContent` (D214); the draft is kept.
 *   A failed settle flush instead drops the baseline (`savedContent: undefined`) of a
 *   dirty document, so it reads dirty on every write until the next clean point. A
 *   document the store already holds clean is upserted clean, which re-derives it.
 * - `applied` also sets the baseline to `writtenContent` (D214).
 * - `closed`: no store write, no draft call.
 *
 * - D214-WI-5/6: `startGeneration` is `documentStore.baselineGeneration` captured
 *   before the save IPC. If the document's baseline moved since (`baselineMovedSince`:
 *   an external change, or a close and reopen under the same id), the result is
 *   demoted like a failed settle flush, and also forced dirty: path / lastSaved
 *   recorded, `savedContent: undefined`, draft kept, `file.save` warn logged with
 *   `reason: "external_change_during_save"`. Omitted: no check.
 *
 * Synchronous and returns `undefined`: nothing it does happens after it returns
 * except the fire-and-forget draft deletion.
 */
export function applySaveResult(
  docId: string,
  snapshotContent: string,
  writtenContent: string,
  result: SaveResult,
  actionId?: string,
  startGeneration?: number,
): void {
  const { status } = useMilkdownEditorStore.getState().flushPendingEdits(SETTLE_FLUSH_REASON);
  const store = useDocumentStore.getState();
  const current = store.getDocumentById(docId);
  let resolution: SaveResolution = resolveSaveResult({
    current,
    snapshotContent,
    writtenContent,
    path: result.path,
    savedAt: result.savedAt,
  });
  if (status === "failed" && resolution.kind === "applied" && current) {
    // The editor may hold text the store lacks: keep dirty and keep the draft, and
    // drop the baseline (D214) so no write reads clean until the next clean point
    // (dirty documents only: a clean upsert re-derives the baseline from content).
    resolution = {
      kind: "edited-during-save",
      next: { ...current, path: result.path, lastSaved: result.savedAt, savedContent: undefined },
    };
  }
  const epochMoved = baselineMovedSince(docId, startGeneration);
  if (current && resolution.kind !== "closed" && epochMoved) {
    // D214-WI-5/6: a change (or close) was recorded during the save; disk may not hold
    // what was written. Same demotion as above, and dirty: the user decides at the prompt.
    resolution = {
      kind: "edited-during-save",
      next: { ...current, path: result.path, lastSaved: result.savedAt, isModified: true, savedContent: undefined },
    };
    logDemotedSave(docId, actionId);
  }

  switch (resolution.kind) {
    case "applied":
      store.upsertDocument(resolution.next);
      deleteDraftAfterSave(docId, actionId);
      return;
    case "edited-during-save":
      store.upsertDocument(resolution.next);
      logUnappliedSave(docId, "editedDuringSave", actionId);
      return;
    case "closed":
      logUnappliedSave(docId, "closedDuringSave", actionId);
      return;
    default: {
      const unreachable: never = resolution;
      throw new Error(`unhandled save resolution: ${JSON.stringify(unreachable)}`);
    }
  }
}
