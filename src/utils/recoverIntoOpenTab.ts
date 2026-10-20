/**
 * Purpose: place a recovered draft in the store (D146). When its file is already open
 * under another id (e.g. the path-derived id of a file opened at launch), the draft goes
 * into that tab instead of a second tab for the same file, unless that tab holds unsaved
 * text of its own or another draft is already stored under its id (D151).
 *
 * Pipeline: recovered document (`draftRecoveryOutcome`, under the draft id) → open tab
 *   with the same non-null path and another id → `get_draft` under that tab's id (D151)
 *   → `placeRecovered`: flush that tab's pending WYSIWYG edits (`flushPendingEditsFor`)
 *   → re-read it →
 *   - dirty, or the flush failed → `collision-dirty`: today's second tab under the draft
 *     id, a toast naming the file, `file.draft.recover.merge` (warn);
 *   - clean, a draft stored under its id → `collision-existing-draft`; the check
 *     rejected (or ran for an id no longer matching) → `collision-draft-check-failed`:
 *     the same second tab, toast and warn line, nothing saved or deleted;
 *   - clean, flush ok, no draft under its id → `merged-into-clean`: the draft's content
 *     into that tab, under its id, modified, with no saved-content baseline (D214) →
 *     `upsertAndActivate`
 *     (→ `prepareWholesaleReplace(id, "draft-recovery")`, so the WYSIWYG view rebuilds)
 *     → `file.draft.recover.merge` → re-key the draft: `save_draft` under the tab's id, then `delete_draft` of the draft
 *     id → `file.draft.delete` (reason `rekeyed`, the target id and byte count; the
 *     audit line for the one draft deletion outside the recovery dialog, WI-2) →
 *     `file.draft.rekey`;
 *   - no match, or no path → `new`: today's tab under the draft id, nothing logged here.
 *   D291: Recovery's return-focus guard starts before the draft IPC and is
 *   committed only after this placement activates its chosen document; an
 *   async `get_draft` never lets the closing dialog focus the outgoing tab.
 *
 * Key decisions:
 * - Neither version's unsaved text is ever discarded: a dirty tab is never overwritten,
 *   and the flush runs first because `prepareWholesaleReplace` discards pending editor
 *   edits unwritten (ADR-0028's rule for every write that can land on an open id).
 * - The merged tab keeps its path, encoding, line ending, saved time and size: a draft
 *   carries only content, path and title (`RecoverResult`), so the file's encoding is
 *   the open tab's, not the UTF-8 / LF `draftRecoveryOutcome` assumes.
 * - The match is the exact path string, the same string `recover_draft` watched (D59)
 *   and held for this window (D173), so the window's one hold on that path is what
 *   `watchHolds` releases once no tab here holds it, with the recover's newer gen.
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
 * - A draft already stored under the open tab's id blocks the merge (D151). `save_draft`
 *   replaces the bundle under that id unconditionally, so the re-key would overwrite it,
 *   and so would the merged tab's next autosave. That draft is a second unrecovered
 *   version of the file (a crash with two dirty tabs on it; both drafts are listed, the
 *   file reopens clean under one id). So the recovered draft keeps its own tab and id,
 *   the open tab stays clean and untouched, and both drafts survive. A failed check is
 *   treated the same way: the merge only runs on a confirmed absence.
 * - Logs carry ids, enums and a byte count only, never the path, content or error text.
 *
 * @coordinates-with src/App.tsx — applyDraftOutcome calls applyRecoveredDocument
 * @coordinates-with src/utils/draftRecoveryOutcome.ts — builds the recovered document
 * @coordinates-with src/hooks/useDocument.ts — upsertAndActivateDocument (the store write)
 * @coordinates-with src/stores/milkdownEditorStore.ts — flushPendingEditsFor
 * @coordinates-with src/hooks/useAutoSave.ts — the same `save_draft` payload shape
 * @coordinates-with src-tauri/src/commands/draft.rs — `get_draft` (the D151 check), `save_draft`
 * @coordinates-with src-tauri/src/commands/draft_recover_watch.rs — the watch on the path
 * @module utils/recoverIntoOpenTab
 */
import { invoke } from "@tauri-apps/api/core";
import { loggingService } from "../services/loggingService";
import { useDocumentStore } from "../stores/documentStore";
import { useMilkdownEditorStore } from "../stores/milkdownEditorStore";
import type { Document } from "../types/document";
import { extractTitle } from "./draftTitle";
import { recoveryPlacementCommitted, recoveryPlacementFailed, recoveryPlacementStarted, recoveryWillActivate } from "./recoveryPlacementFocus";

/** Whether a draft is stored under the open tab's id (D151): `get_draft`'s answer. */
export type DraftUnderOpenId = "absent" | "present" | "check-failed";

/** The id `get_draft` was asked about and its answer. */
export interface OpenIdDraftCheck {
  id: string;
  state: DraftUnderOpenId;
}

export type RecoverPlacement =
  | { kind: "merged-into-clean"; document: Document }
  | { kind: "collision-dirty"; document: Document; open: Document }
  | { kind: "collision-existing-draft"; document: Document; open: Document }
  | { kind: "collision-draft-check-failed"; document: Document; open: Document }
  | { kind: "new"; document: Document };

type CollisionKind = Exclude<RecoverPlacement["kind"], "merged-into-clean" | "new">;

export interface RecoverIntoStoreDeps {
  /** `useDocument().upsertAndActivateDocument`: wholesale prep, upsert, activate. */
  upsertAndActivate: (document: Document) => void;
  showToast: (message: string) => void;
}

const fileName = (path: string): string => path.split(/[/\\]/).pop() || path;

/** The toast for a draft recovered next to a dirty tab of the same file. */
export const collisionToast = (path: string): string =>
  `A recovered draft and an unsaved edit of ${fileName(path)} are both open.`;

/** The toast for a recovered draft kept in its own tab: another draft of the file waits (D151). */
export const existingDraftToast = (path: string): string =>
  "Another unsaved draft of " +
  `${fileName(path)} is still waiting to be recovered, so this one opened in its own tab.`;

/** The toast for a draft opened in its own tab because the check for another draft failed. */
export const draftCheckFailedToast = (path: string): string =>
  "Could not check for another unsaved draft of " +
  `${fileName(path)}, so this one opened in its own tab.`;

const TOASTS: Record<CollisionKind, (path: string) => string> = {
  "collision-dirty": collisionToast,
  "collision-existing-draft": existingDraftToast,
  "collision-draft-check-failed": draftCheckFailedToast,
};

/** The open tab sharing `recovered`'s non-null path under another id, if any. */
function findOpenMatch(recovered: Document): Document | undefined {
  const { path } = recovered;
  if (path === null) return undefined;
  return useDocumentStore
    .getState()
    .documents.find((doc) => doc.id !== recovered.id && doc.path === path);
}

/**
 * Ask `get_draft` whether a draft is stored under `id`. `null` (Rust `None`) is absent;
 * a rejection is `check-failed`, which callers treat like `present`. Never rejects.
 */
export async function checkDraftUnder(id: string): Promise<OpenIdDraftCheck> {
  try {
    const draft = await invoke<unknown>("get_draft", { documentId: id });
    return { id, state: draft == null ? "absent" : "present" };
  } catch {
    return { id, state: "check-failed" };
  }
}

/**
 * Where `recovered` (under its draft id) goes, given `check`: what `get_draft` said
 * about the matching tab's id. A check about another id (the tab changed while it ran)
 * counts as failed. Flushes the matching tab's pending WYSIWYG edits before judging it;
 * reads nothing else and writes no document.
 */
export function placeRecovered(recovered: Document, check?: OpenIdDraftCheck): RecoverPlacement {
  const match = findOpenMatch(recovered);
  if (!match) return { kind: "new", document: recovered };
  const { status } = useMilkdownEditorStore
    .getState()
    .flushPendingEditsFor(match.id, "draft-recovery");
  const open = useDocumentStore.getState().getDocumentById(match.id) ?? match;
  if (status === "failed" || open.isModified) {
    return { kind: "collision-dirty", document: recovered, open };
  }
  const draftState = check?.id === match.id ? check.state : "check-failed";
  if (draftState === "present") {
    return { kind: "collision-existing-draft", document: recovered, open };
  }
  if (draftState === "check-failed") {
    return { kind: "collision-draft-check-failed", document: recovered, open };
  }
  return {
    kind: "merged-into-clean",
    // D214: the draft's text is not on disk, so the tab loses its baseline (sticky dirty).
    document: { ...open, content: recovered.content, isModified: true, savedContent: undefined },
  };
}

function logMerge(draftId: string, documentId: string, outcome: RecoverPlacement["kind"]) {
  loggingService.logEventSync({
    level: outcome === "merged-into-clean" ? "info" : "warn",
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
 * Put the recovered document in the store, then, after a merge, re-key its draft.
 * With no open tab of the same path this is synchronous, before the first await; with
 * one, it first awaits `get_draft` under that tab's id (D151), then places and writes
 * the store in one synchronous step. Resolves when the re-key settles.
 */
export async function applyRecoveredDocument(
  draftId: string,
  recovered: Document,
  deps: RecoverIntoStoreDeps,
): Promise<RecoverPlacement["kind"] | "failed"> {
  recoveryPlacementStarted(draftId);
  let placement: RecoverPlacement;
  try {
    const match = findOpenMatch(recovered);
    const check = match ? await checkDraftUnder(match.id) : undefined;
    placement = placeRecovered(recovered, check);
    recoveryWillActivate(draftId, placement.document.id);
    deps.upsertAndActivate(placement.document);
    recoveryPlacementCommitted(draftId, placement.document.id);
  } catch {
    recoveryPlacementFailed(draftId);
    deps.showToast("Failed to recover draft");
    return "failed";
  }
  switch (placement.kind) {
    case "new":
      return placement.kind;
    case "collision-dirty":
    case "collision-existing-draft":
    case "collision-draft-check-failed":
      logMerge(draftId, placement.open.id, placement.kind);
      deps.showToast(TOASTS[placement.kind](placement.open.path ?? ""));
      return placement.kind;
    case "merged-into-clean":
      logMerge(draftId, placement.document.id, placement.kind);
      await rekeyDraft(draftId, placement.document);
      return placement.kind;
  }
}
