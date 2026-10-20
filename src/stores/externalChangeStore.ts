/**
 * Purpose: this window's unresolved external changes, one slot per open document
 * (D171, ADR-0081 "E-retention"). The window's single `file:changed` listener records
 * here at once; the reload prompt, Reload / Ignore and the save path read and settle it.
 *
 * Pipeline: `useFileWatcher` listener → `recordFileChange(event)` → a slot per open
 *   document whose path matches, or whose pending rename leads to it (D178) (or, D111, an open / Save As reply's
 *   `changedSinceRead` → `recordOpenDivergence(id)`) → presented by `usePresentedFileChange` when that
 *   document is active → settled by `acknowledgeFileChange` (Reload / Ignore / rename)
 *   or dropped by `forgetFileChange` (prompt withdrawn) and the documentStore prune
 *   (close, path change) · `pendingFileChangeFor` is the save path's check. A save
 *   notice (`origin`, D173-WI-3) skips only its origin document in its origin window.
 *
 * Key decisions:
 * - **Keyed by document id, owned by the document's lifetime.** The path is only the
 *   lookup at receipt. Ids are path-derived, so a closed-then-reopened file gets the
 *   same id: the prune below removes the slot when the document leaves the store, so a
 *   reopened document starts with none, and a late event for a closed path finds no
 *   document and is dropped.
 * - **One slot per document, the latest change.** Every change replaces the previous
 *   one with a higher `seq`; a prompt for the latest change covers the earlier ones.
 * - **A rename never replaces a pending content change (D178).** A `renamed` event
 *   for a document with a pending `modified` / `deleted` (or `open-check`) slot is
 *   followed at once (`updateDocumentPath`), and the change moves to the new path as
 *   a `modified` there (a file exists at it) under a new `seq`, keeping its receipt
 *   time so it is presented without a fresh wait; a prompt already up is re-raised
 *   for the new path, and the old prompt's token can no longer settle it. A rename
 *   with nothing pending is recorded as before and followed silently on activation;
 *   until then its target is indexed, so a change at the new path is recorded
 *   against the document (which then follows the rename at once) and a further
 *   rename chains to one rename from the document's own path.
 *   `acknowledgeFileChange(id, seq)` clears the slot only when its `seq` is ≤ the one
 *   acknowledged, so a change that arrived after the prompt was shown stays pending.
 * - **`settled` remembers the highest `seq` the user answered** while a newer change
 *   keeps the slot, so the presenter never shows the answered one again.
 * - **`seq` comes from one window-wide counter**, so it increases per document and
 *   never repeats across lifetimes of the same id.
 * - **A path change retires the slot** (Save As, rename-follow): the change was about
 *   the old path, and later events are recorded under the new one. A rename this
 *   store follows itself writes the moved slots first, then moves every document in
 *   one `updateDocumentPaths` (b87), so the prune keeps them all.
 * - **A save notice never records against its saver (D173-WI-3).** The exact origin
 *   (`origin.documentId` in the window `origin.windowLabel`) is skipped and its slot
 *   left untouched: an own save never clears or replaces a pending change. Every other
 *   matching document records it, a same-path sibling tab in the saving window too.
 * - **A content change drops the saved-content baseline (D214-WI-4)** of every
 *   document it is recorded against (`dropBaseline`), as does an open divergence: the
 *   disk no longer holds the old text, so undoing back to it must not read clean. A
 *   rename does not, and the own-save origin is never recorded, so keeps its baseline.
 * - **Window-local**: each window has its own JS store.
 * - **Ignored deletions remain guarded (D290).** Ignore moves a deleted slot to
 *   `ignoredDeletions`; a new event, path change, close, reload or listener reset
 *   retires it. An explicit save clears only a matching document/path/seq marker.
 * - **Two sources, one slot** (D111): `source` distinguishes watcher and open-check;
 *   a false reply flag records nothing. Both sources settle the same way.
 * - Logs (`file.change.pending`) carry the document id, `seq`, an action and a reason,
 *   never the path or content.
 *
 * @coordinates-with src/hooks/useFileWatcher.ts — records, presents, resets on unmount
 * @coordinates-with src/hooks/useExternalChangePrompt.ts — acknowledges on Reload / Ignore / rename
 * @coordinates-with src/hooks/useReloadPrompt.ts — `forgetFileChange` on withdrawal
 * @coordinates-with src/utils/externalChangeGuard.ts — the save-time check
 * @coordinates-with src/stores/documentStore.ts — the prune subscription
 * @coordinates-with src/utils/fileChangeCapture.ts — `recordOpenDivergence` and the
 *   replay of events held during an open or Save As (D111)
 * @coordinates-with src/utils/fileChangeOrigin.ts — the save-notice origin filter
 * @coordinates-with src/utils/externalChangeSlot.ts — rename transition
 * @module stores/externalChangeStore
 */
import { create } from "zustand";
import { loggingService } from "../services/loggingService";
import type { Document } from "../types/document";
import type { FileChangedEvent, PendingFileChange } from "../types/fileChange";
import { skipOrigin } from "../utils/fileChangeOrigin";
import { nextSlot, pendingRenameTarget } from "../utils/externalChangeSlot";
import { useDocumentStore } from "./documentStore";

/** Why a slot was settled; `acknowledged` for a user answer, `cleared` otherwise. */
export type PendingSettleReason =
  | "reloaded"
  | "ignored"
  | "renamed"
  | "closed"
  | "path-changed"
  | "withdrawn"
  | "listener-reset";

export type PendingLogAction = "recorded" | "acknowledged" | "cleared" | "save-blocked";

interface ExternalChangeState {
  pending: Record<string, PendingFileChange>;
  ignoredDeletions: Record<string, IgnoredDeletion>;
  /** Per document, the highest `seq` the user answered (Reload / Ignore / rename). */
  settled: Record<string, number>;
}

export interface IgnoredDeletion { documentId: string; path: string; seq: number }
export const useExternalChangeStore = create<ExternalChangeState>(() => ({ pending: {}, settled: {}, ignoredDeletions: {} }));

let lastSeq = 0;

const ACKNOWLEDGING: ReadonlySet<PendingSettleReason> = new Set(["reloaded", "ignored", "renamed"]);

/** Log one `file.change.pending` line: ids, enums and numbers only. */
export function logPending(
  action: PendingLogAction,
  documentId: string,
  seq: number,
  extra: Record<string, unknown> = {},
  actionId: string = loggingService.generateActionId(),
): void {
  loggingService.logEventSync({
    level: action === "save-blocked" ? "warn" : "info",
    event: "file.change.pending",
    status: action === "save-blocked" ? "cancel" : "success",
    actionId,
    context: { action, documentId, seq, ...extra },
  });
}

/** What a receipt did: the documents it recorded against (store order). */
export interface RecordResult {
  documentIds: string[];
  activeRecorded: boolean;
  /** D173-WI-3: set (only) when the event was this window's own save of a matching
   *  document, which was skipped (`utils/fileChangeOrigin.ts`). */
  ownSkipped?: true;
}

/**
 * Record `event` against every open document whose path is the event's, or whose
 * pending rename leads to it (D178), at once, except the origin of this window's own
 * save notice (D173-WI-3), whose slot is left untouched. A rename never replaces a
 * pending content change: the document follows it at once and the change moves to the
 * new path. A non-rename change drops each recorded document's baseline (D214-WI-4).
 */
export function recordFileChange(event: FileChangedEvent, actionId: string, now = Date.now()): RecordResult {
  const { documents, activeDocumentId, updateDocumentPaths } = useDocumentStore.getState();
  const pending = useExternalChangeStore.getState().pending;
  const matched = documents.filter(
    (doc): doc is Document & { path: string } =>
      doc.path !== null && (doc.path === event.path || pendingRenameTarget(pending[doc.id]) === event.path),
  );
  const { owners, ownSkipped } = skipOrigin(matched, event);
  const own = ownSkipped ? { ownSkipped: true as const } : {};
  if (owners.length === 0) return { documentIds: [], activeRecorded: false, ...own };
  const next = { ...pending };
  const moves: Array<{ id: string; path: string }> = [];
  for (const doc of owners) {
    lastSeq += 1;
    const base = { documentId: doc.id, seq: lastSeq, receivedAt: now, actionId, source: "watcher" as const };
    const { slot, moveTo } = nextSlot(doc, pending[doc.id], event, base);
    next[doc.id] = slot;
    if (moveTo !== undefined) moves.push({ id: doc.id, path: moveTo });
    logPending(
      "recorded",
      doc.id,
      lastSeq,
      { changeType: event.changeType, source: slot.source, followed: moveTo !== undefined },
      actionId,
    );
  }
  const ignoredDeletions = { ...useExternalChangeStore.getState().ignoredDeletions };
  for (const doc of owners) delete ignoredDeletions[doc.id];
  useExternalChangeStore.setState({ pending: next, ignoredDeletions });
  // After the slots, and in one `set` (b87): the prune below then runs once, against
  // the final paths, and finds every moved slot already at its document's new path.
  if (moves.length > 0) updateDocumentPaths(moves);
  // D214-WI-4: after the moves, so the prune sees every slot at its document's path.
  if (event.changeType !== "renamed") for (const doc of owners) useDocumentStore.getState().dropBaseline(doc.id);
  return {
    documentIds: owners.map((doc) => doc.id),
    activeRecorded: owners.some((doc) => doc.id === activeDocumentId),
    ...own,
  };
}

/**
 * D111: record that `documentId`'s file changed after the read (or Save As write) its
 * buffer holds, as an open or Save As reply's `changedSinceRead` reported. The slot is
 * a `modified` change at the document's current path with source `open-check`; like a
 * watcher event it replaces any earlier slot with a newer `seq`, so acknowledging an
 * older change never clears it. Returns false (and records nothing) when the document
 * is not in the store or has no path. Nothing here ever clears a slot. A recorded
 * divergence drops the document's baseline (D214-WI-4).
 */
export function recordOpenDivergence(
  documentId: string,
  actionId: string = loggingService.generateActionId(),
  now = Date.now(),
): boolean {
  const doc = useDocumentStore.getState().documents.find((d) => d.id === documentId);
  if (!doc?.path) return false;
  lastSeq += 1;
  const event: FileChangedEvent = { path: doc.path, changeType: "modified", timestamp: now };
  const slot: PendingFileChange = {
    documentId,
    seq: lastSeq,
    path: doc.path,
    event,
    receivedAt: now,
    actionId,
    source: "open-check",
  };
  const { pending, ignoredDeletions } = useExternalChangeStore.getState();
  const nextIgnored = { ...ignoredDeletions };
  delete nextIgnored[documentId];
  useExternalChangeStore.setState({ pending: { ...pending, [documentId]: slot }, ignoredDeletions: nextIgnored });
  logPending("recorded", documentId, lastSeq, { changeType: "modified", source: "open-check" }, actionId);
  useDocumentStore.getState().dropBaseline(documentId);
  return true;
}
/** The unresolved change of `documentId`, if any. */
export function pendingFileChangeFor(documentId: string): PendingFileChange | undefined {
  return useExternalChangeStore.getState().pending[documentId];
}

/** An answered deletion still requiring a choice before recreating the original path. */
export function ignoredDeletionFor(documentId: string): IgnoredDeletion | undefined {
  return useExternalChangeStore.getState().ignoredDeletions[documentId];
}

/** One-shot retirement, only if the choice still names this marker. */
export function clearIgnoredDeletion(marker: IgnoredDeletion): boolean {
  const state = useExternalChangeStore.getState();
  const current = state.ignoredDeletions[marker.documentId];
  if (!current || current.path !== marker.path || current.seq !== marker.seq) return false;
  const ignoredDeletions = { ...state.ignoredDeletions };
  delete ignoredDeletions[marker.documentId];
  useExternalChangeStore.setState({ ignoredDeletions });
  return true;
}

function removeSlot(documentId: string, reason: PendingSettleReason): void {
  const { pending, settled, ignoredDeletions } = useExternalChangeStore.getState();
  const slot = pending[documentId];
  if (!slot) return;
  const next = { ...pending };
  delete next[documentId];
  const nextSettled = { ...settled };
  delete nextSettled[documentId];
  const nextIgnored = { ...ignoredDeletions };
  if (reason === "ignored" && slot.event.changeType === "deleted") {
    nextIgnored[documentId] = { documentId, path: slot.path, seq: slot.seq };
  } else if (reason === "reloaded" || reason === "closed" || reason === "path-changed" || reason === "listener-reset") {
    delete nextIgnored[documentId];
  }
  useExternalChangeStore.setState({ pending: next, settled: nextSettled, ignoredDeletions: nextIgnored });
  logPending(ACKNOWLEDGING.has(reason) ? "acknowledged" : "cleared", documentId, slot.seq, { reason });
}

/**
 * Settle `documentId`'s change up to `seq`: cleared when the slot's `seq` is ≤ `seq`,
 * kept when a newer change arrived since. Returns whether it cleared.
 */
export function acknowledgeFileChange(documentId: string, seq: number, reason: PendingSettleReason): boolean {
  const slot = pendingFileChangeFor(documentId);
  if (!slot) return false;
  if (slot.seq > seq) {
    // A newer change arrived since `seq` was shown: it stays pending, and the answered
    // one may no longer be presented while the newer one waits out its debounce.
    const { settled } = useExternalChangeStore.getState();
    if ((settled[documentId] ?? 0) < seq) {
      useExternalChangeStore.setState({ settled: { ...settled, [documentId]: seq } });
    }
    return false;
  }
  removeSlot(documentId, reason);
  return true;
}

/** Drop `documentId`'s change whatever its `seq` (the prompt's owner went away). */
export function forgetFileChange(documentId: string, reason: PendingSettleReason): void {
  removeSlot(documentId, reason);
}

/** Drop every slot (the window's listener unmounted, or mounted afresh). */
export function resetFileChanges(): void {
  const ids = Object.keys(useExternalChangeStore.getState().pending);
  for (const id of ids) removeSlot(id, "listener-reset");
  useExternalChangeStore.setState({ ignoredDeletions: {} });
}

/** Close and path change: drop each slot whose document left or moved to another path. */
function pruneAgainst(documents: Document[]): void {
  const pending = useExternalChangeStore.getState().pending;
  for (const slot of Object.values(pending)) {
    const doc = documents.find((d) => d.id === slot.documentId);
    if (!doc) removeSlot(slot.documentId, "closed");
    else if (doc.path !== slot.path) removeSlot(slot.documentId, "path-changed");
  }
  for (const marker of Object.values(useExternalChangeStore.getState().ignoredDeletions)) {
    const doc = documents.find((d) => d.id === marker.documentId);
    if (!doc || doc.path !== marker.path) clearIgnoredDeletion(marker);
  }
}

useDocumentStore.subscribe((state, previous) => {
  if (state.documents !== previous.documents) pruneAgainst(state.documents);
});
