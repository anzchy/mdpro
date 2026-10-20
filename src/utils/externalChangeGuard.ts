/**
 * Purpose: save-time checks for pending changes (D171) and ignored deletions (D290).
 * Every route that writes a document's file through `save_file` asks here right
 * before the write, so an external change recorded while the save waited (D70 queue,
 * `get_preferences`) still stops it.
 *
 * Routes (audited for D171): ⌘S / menu Save → `documentSave.saveDocumentNow`
 * (guarded, also when queued); the relaunch save → `useUpdater.prepareForRelaunch`
 * (guarded, refuses the relaunch); Save As (`save_file_dialog`, D111-WI-1) refuses only
 * when the picked target is the document's own file: the dialog writes in Rust, so the
 * document's path goes along as `refusePath` (`saveAsRefusePath`) and Rust decides.
 * Not guarded: autosave (`save_draft`, never the file), close / window close /
 * quit (they discard or draft, ADR-0035, never `save_file`).
 *
 * Key decisions:
 * - Blocked means nothing is written and the document stays dirty; the reload prompt
 *   for that document is (or will be, after its 300 ms) on screen, and the caller's
 *   toast names the reason.
 * - The `file.change.pending` `save-blocked` line carries the document id, the pending
 *   `seq` and the route, never the path.
 * - An ignored deletion asks on ordinary Save, blocks relaunch, and makes Save As
 *   refuse the old path until a new target is chosen.
 *
 * @coordinates-with src/stores/externalChangeStore.ts — `pendingFileChangeFor`
 * @coordinates-with src/services/documentSave.ts — the ⌘S body
 * @coordinates-with src/hooks/useUpdater.ts — the relaunch save
 * @module utils/externalChangeGuard
 */
import { ignoredDeletionFor, logPending, pendingFileChangeFor, type IgnoredDeletion } from "../stores/externalChangeStore";

export type GuardedSaveRoute = "save" | "relaunch" | "save-as";

/** The text a blocked save shows (after "Save failed: " on ⌘S). */
export const SAVE_BLOCKED_MESSAGE =
  "the file changed on disk; reload or ignore that change before saving";

/** Thrown by a guarded save that found an unresolved external change. */
export class ExternalChangePendingError extends Error {
  constructor() {
    super(SAVE_BLOCKED_MESSAGE);
    this.name = "ExternalChangePendingError";
  }
}

/** A Save needs a specific choice before writing an ignored deletion's old path. */
export class RecreateChoiceRequiredError extends Error {
  constructor(readonly marker: IgnoredDeletion, readonly actionId: string) {
    super("save requires a recreate choice");
    this.name = "RecreateChoiceRequiredError";
  }
}

/**
 * True (and logged) when `documentId` has an unresolved external change, so the
 * caller must not write. False when it may write.
 */
export function saveBlockedByPendingChange(
  documentId: string,
  route: GuardedSaveRoute,
  actionId?: string,
): boolean {
  const slot = pendingFileChangeFor(documentId);
  const ignored = route === "relaunch" ? ignoredDeletionFor(documentId) : undefined;
  if (!slot && !ignored) return false;
  logPending("save-blocked", documentId, (slot ?? ignored)!.seq, { route }, actionId);
  return true;
}

/**
 * D111-WI-1: the path a Save As of `doc` must refuse to write: its own path while it has
 * an unresolved external change, else null (any target may be written). Also returns the
 * pending `seq` for the `save-blocked` log line if Rust refuses.
 */
export function saveAsRefusePath(doc: { id: string; path: string | null }): { path: string; seq: number } | null {
  if (!doc.path) return null;
  const slot = pendingFileChangeFor(doc.id);
  const ignored = ignoredDeletionFor(doc.id);
  return slot ? { path: doc.path, seq: slot.seq } : ignored && ignored.path === doc.path ? { path: doc.path, seq: ignored.seq } : null;
}

/** D111-WI-1: log a Save As that Rust refused onto the own path (route `save-as`). */
export function logSaveAsBlocked(documentId: string, seq: number, actionId?: string): void {
  logPending("save-blocked", documentId, seq, { route: "save-as" satisfies GuardedSaveRoute }, actionId);
}
