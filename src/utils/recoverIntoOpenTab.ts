/**
 * Purpose: place a recovered draft in the store (D146). When its file is already open
 * under another id (e.g. the path-derived id of a file opened at launch), the draft goes
 * into that tab instead of a second tab for the same file, unless that tab holds unsaved
 * text of its own.
 *
 * Pipeline: recovered document (`draftRecoveryOutcome`, under the draft id) →
 *   `placeRecovered`: open tab with the same non-null path and another id → flush that
 *   tab's pending WYSIWYG edits (`flushPendingEditsFor`) → re-read it →
 *   - clean, flush ok → `merged-into-clean`: the draft's content into that tab, under its
 *     id, modified → `upsertAndActivate` (→ `prepareWholesaleReplace(id,
 *     "draft-recovery")`, so the WYSIWYG view rebuilds) → `file.draft.recover.merge` →
 *     re-key the draft: `save_draft` under the tab's id, then `delete_draft` of the draft
 *     id → `file.draft.delete` (reason `rekeyed`, the target id and byte count; the
 *     audit line for the one draft deletion outside the recovery dialog, WI-2) →
 *     `file.draft.rekey`;
 *   - dirty, or the flush failed → `collision-dirty`: today's second tab under the draft
 *     id, a toast naming the file, `file.draft.recover.merge` (warn);
 *   - no match, or no path → `new`: today's tab under the draft id, nothing logged here.
 *
 * Key decisions:
 * - Neither version's unsaved text is ever discarded: a dirty tab is never overwritten,
 *   and the flush runs first because `prepareWholesaleReplace` discards pending editor
 *   edits unwritten (ADR-0028's rule for every write that can land on an open id).
 * - The merged tab keeps its path, encoding, line ending, saved time and size: a draft
 *   carries only content, path and title (`RecoverResult`), so the file's encoding is
 *   the open tab's, not the UTF-8 / LF `draftRecoveryOutcome` assumes.
 * - The match is the exact path string, the same string `recover_draft` watched (D59),
 *   so the one watch per path is what `close_document` of that tab unwatches.
 *   `FileWatcher::watch` on a watched path is a set insert (`alreadyWatched`), not a
 *   second registration; it re-snapshots the baseline, as recovery always does
 *   (ADR-0068 decision 4).
 * - The re-key keeps the draft linked to the tab that holds it. `recover_draft` stamped
 *   the UUID draft `recovered` with this window as owner, and nothing would ever delete
 *   it: autosave and ⌘S work on the tab's id. Left alone it is hidden while this window
 *   lives and relisted on the next launch (ADR-0038 §3), resurrecting text that was
 *   already merged. So the text is written under the tab's id first, and the UUID draft
 *   is deleted only after that write succeeded; a failed write keeps it (logged), so the
 *   text is never left only in memory. `delete_draft` (unguarded, as saveService uses
 *   it) is right here: the guarded discard refuses a draft owned by a live window, and
 *   this window owns it.
 * - Logs carry ids, enums and a byte count only, never the path, content or error text.
 *
 * @coordinates-with src/App.tsx — applyDraftOutcome calls applyRecoveredDocument
 * @coordinates-with src/utils/draftRecoveryOutcome.ts — builds the recovered document
 * @coordinates-with src/hooks/useDocument.ts — upsertAndActivateDocument (the store write)
 * @coordinates-with src/stores/milkdownEditorStore.ts — flushPendingEditsFor
 * @coordinates-with src/hooks/useAutoSave.ts — the same `save_draft` payload shape
 * @coordinates-with src-tauri/src/commands/draft_recover_watch.rs — the watch on the path
 * @module utils/recoverIntoOpenTab
 */
import { invoke } from "@tauri-apps/api/core";
import { loggingService } from "../services/loggingService";
import { useDocumentStore } from "../stores/documentStore";
import { useMilkdownEditorStore } from "../stores/milkdownEditorStore";
import type { Document } from "../types/document";
import { extractTitle } from "./draftTitle";

export type RecoverPlacement =
  | { kind: "merged-into-clean"; document: Document }
  | { kind: "collision-dirty"; document: Document; open: Document }
  | { kind: "new"; document: Document };

export interface RecoverIntoStoreDeps {
  /** `useDocument().upsertAndActivateDocument`: wholesale prep, upsert, activate. */
  upsertAndActivate: (document: Document) => void;
  showToast: (message: string) => void;
}

const fileName = (path: string): string => path.split(/[/\\]/).pop() || path;

/** The toast for a draft recovered next to a dirty tab of the same file. */
export const collisionToast = (path: string): string =>
  `A recovered draft and an unsaved edit of ${fileName(path)} are both open.`;

/**
 * Where `recovered` (under its draft id) goes. Flushes the matching tab's pending
 * WYSIWYG edits before judging it; reads nothing else and writes no document.
 */
export function placeRecovered(recovered: Document): RecoverPlacement {
  const { path } = recovered;
  if (path === null) return { kind: "new", document: recovered };
  const match = useDocumentStore
    .getState()
    .documents.find((doc) => doc.id !== recovered.id && doc.path === path);
  if (!match) return { kind: "new", document: recovered };
  const { status } = useMilkdownEditorStore
    .getState()
    .flushPendingEditsFor(match.id, "draft-recovery");
  const open = useDocumentStore.getState().getDocumentById(match.id) ?? match;
  if (status === "failed" || open.isModified) {
    return { kind: "collision-dirty", document: recovered, open };
  }
  return {
    kind: "merged-into-clean",
    document: { ...open, content: recovered.content, isModified: true },
  };
}

function logMerge(draftId: string, documentId: string, outcome: RecoverPlacement["kind"]) {
  loggingService.logEventSync({
    level: outcome === "collision-dirty" ? "warn" : "info",
    event: "file.draft.recover.merge",
    status: "success",
    actionId: loggingService.generateActionId(),
    context: { draftId, documentId, outcome },
  });
}

function logRekey(draftId: string, documentId: string, stage?: "save_draft" | "delete_draft") {
  loggingService.logEventSync({
    level: stage ? "warn" : "info",
    event: "file.draft.rekey",
    status: stage ? "fail" : "success",
    actionId: loggingService.generateActionId(),
    context: stage ? { draftId, documentId, stage } : { draftId, documentId },
  });
}

/** Move the recovered draft from `draftId` to the merged tab's id; never rejects. */
async function rekeyDraft(draftId: string, merged: Document): Promise<void> {
  try {
    await invoke("save_draft", {
      documentId: merged.id,
      content: merged.content,
      originalPath: merged.path,
      title: extractTitle(merged.content),
    });
  } catch {
    logRekey(draftId, merged.id, "save_draft");
    return;
  }
  try {
    await invoke("delete_draft", { documentId: draftId });
  } catch {
    logRekey(draftId, merged.id, "delete_draft");
    return;
  }
  logRekeyDelete(draftId, merged);
  logRekey(draftId, merged.id);
}

/**
 * The audit line for the one draft deletion outside the recovery dialog (D146 WI-2):
 * which draft went, why, where its text now lives and how many UTF-8 bytes moved.
 */
function logRekeyDelete(draftId: string, merged: Document) {
  loggingService.logEventSync({
    level: "info",
    event: "file.draft.delete",
    status: "success",
    actionId: loggingService.generateActionId(),
    context: {
      draftId,
      reason: "rekeyed",
      rekeyedTo: merged.id,
      bytes: new TextEncoder().encode(merged.content).length,
    },
  });
}

/**
 * Put the recovered document in the store (synchronously, before the first await),
 * then, after a merge, re-key its draft. Resolves when the re-key settles.
 */
export async function applyRecoveredDocument(
  draftId: string,
  recovered: Document,
  deps: RecoverIntoStoreDeps,
): Promise<RecoverPlacement["kind"]> {
  const placement = placeRecovered(recovered);
  deps.upsertAndActivate(placement.document);
  switch (placement.kind) {
    case "new":
      return placement.kind;
    case "collision-dirty":
      logMerge(draftId, placement.open.id, placement.kind);
      deps.showToast(collisionToast(placement.open.path ?? ""));
      return placement.kind;
    case "merged-into-clean":
      logMerge(draftId, placement.document.id, placement.kind);
      await rekeyDraft(draftId, placement.document);
      return placement.kind;
  }
}
