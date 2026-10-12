/**
 * Purpose: the save-time check for an unresolved external change (D171, ADR-0081).
 * Every route that writes a document's file through `save_file` asks here right
 * before the write, so an external change recorded while the save waited (D70 queue,
 * `get_preferences`) still stops it.
 *
 * Routes (audited for D171): ⌘S / menu Save → `documentSave.saveDocumentNow`
 * (guarded, also when queued); the relaunch save → `useUpdater.prepareForRelaunch`
 * (guarded, refuses the relaunch). Not guarded: Save As (`save_file_dialog`, the user
 * picks the target), autosave (`save_draft`, never the file), close / window close /
 * quit (they discard or draft, ADR-0035, never `save_file`).
 *
 * Key decisions:
 * - Blocked means nothing is written and the document stays dirty; the reload prompt
 *   for that document is (or will be, after its 300 ms) on screen, and the caller's
 *   toast names the reason.
 * - The `file.change.pending` `save-blocked` line carries the document id, the pending
 *   `seq` and the route, never the path.
 *
 * @coordinates-with src/stores/externalChangeStore.ts — `pendingFileChangeFor`
 * @coordinates-with src/services/documentSave.ts — the ⌘S body
 * @coordinates-with src/hooks/useUpdater.ts — the relaunch save
 * @module utils/externalChangeGuard
 */
import { logPending, pendingFileChangeFor } from "../stores/externalChangeStore";

export type GuardedSaveRoute = "save" | "relaunch";

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
  if (!slot) return false;
  logPending("save-blocked", documentId, slot.seq, { route }, actionId);
  return true;
}
