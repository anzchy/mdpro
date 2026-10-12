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
 *   (close, path change) · `pendingFileChangeFor` is the save path's check.
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
 *   store follows itself writes the moved slot first, so the prune keeps it.
 * - **Nothing global across windows**: each window has its own JS store.
 * - **Two sources, one slot** (D111): `source` says whether a watcher event or an open
 *   or Save As reply's seed check recorded it. Both settle the same way. A reply whose
 *   flag is false records nothing and clears nothing.
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
 * @module stores/externalChangeStore
 */
import { create } from "zustand";
import { loggingService } from "../services/loggingService";
import type { Document } from "../types/document";
import type { FileChangedEvent, PendingFileChange } from "../types/fileChange";
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
  /** Per document, the highest `seq` the user answered (Reload / Ignore / rename). */
  settled: Record<string, number>;
}

export const useExternalChangeStore = create<ExternalChangeState>(() => ({ pending: {}, settled: {} }));

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
}

/** A slot that is only a rename not yet followed: the path it will move to, else undefined. */
function pendingRenameTarget(slot: PendingFileChange | undefined): string | undefined {
  return slot?.event.changeType === "renamed" ? slot.event.newPath : undefined;
}

/** The slot `event` leaves for `doc`, and the path the document moves to now, if any (D178). */
function nextSlot(
  doc: Document & { path: string },
  prior: PendingFileChange | undefined,
  event: FileChangedEvent,
  base: Omit<PendingFileChange, "path" | "event">,
): { slot: PendingFileChange; moveTo?: string } {
  const newPath = event.changeType === "renamed" ? event.newPath : undefined;
  if (newPath !== undefined && prior && pendingRenameTarget(prior) === undefined) {
    // A content change is pending: follow the rename now and carry the change to the
    // new path as a `modified` there (a file exists at it), presented without a new wait.
    const carried: FileChangedEvent = { path: newPath, changeType: "modified", timestamp: event.timestamp };
    return {
      slot: { ...base, path: newPath, event: carried, receivedAt: prior.receivedAt, source: prior.source },
      moveTo: newPath,
    };
  }
  if (doc.path !== event.path) {
    // Matched through a rename not yet followed (`pendingRenameTarget`).
    if (newPath !== undefined) {
      // A rename of the target chains: still one rename, from the document's own path.
      return { slot: { ...base, path: doc.path, event: { ...event, path: doc.path } } };
    }
    // A change at the target: follow the rename now so the change is recorded at its path.
    return { slot: { ...base, path: event.path, event }, moveTo: event.path };
  }
  return { slot: { ...base, path: event.path, event } };
}

/**
 * Record `event` against every open document whose path is the event's, or whose
 * pending rename leads to it (D178), at once. A rename never replaces a pending content
 * change: the document follows it at once and the change moves to the new path.
 */
export function recordFileChange(event: FileChangedEvent, actionId: string, now = Date.now()): RecordResult {
  const { documents, activeDocumentId, updateDocumentPath } = useDocumentStore.getState();
  const pending = useExternalChangeStore.getState().pending;
  const owners = documents.filter(
    (doc): doc is Document & { path: string } =>
      doc.path !== null && (doc.path === event.path || pendingRenameTarget(pending[doc.id]) === event.path),
  );
  if (owners.length === 0) return { documentIds: [], activeRecorded: false };
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
  useExternalChangeStore.setState({ pending: next });
  // After the slots: the prune below then finds each moved slot already at the new path.
  for (const { id, path } of moves) updateDocumentPath(id, path);
  return {
    documentIds: owners.map((doc) => doc.id),
    activeRecorded: owners.some((doc) => doc.id === activeDocumentId),
  };
}

/**
 * D111: record that `documentId`'s file changed after the read (or Save As write) its
 * buffer holds, as an open or Save As reply's `changedSinceRead` reported. The slot is
 * a `modified` change at the document's current path with source `open-check`; like a
 * watcher event it replaces any earlier slot with a newer `seq`, so acknowledging an
 * older change never clears it. Returns false (and records nothing) when the document
 * is not in the store or has no path. Nothing here ever clears a slot.
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
  useExternalChangeStore.setState({ pending: { ...useExternalChangeStore.getState().pending, [documentId]: slot } });
  logPending("recorded", documentId, lastSeq, { changeType: "modified", source: "open-check" }, actionId);
  return true;
}

/** The unresolved change of `documentId`, if any. */
export function pendingFileChangeFor(documentId: string): PendingFileChange | undefined {
  return useExternalChangeStore.getState().pending[documentId];
}

function removeSlot(documentId: string, reason: PendingSettleReason): void {
  const { pending, settled } = useExternalChangeStore.getState();
  const slot = pending[documentId];
  if (!slot) return;
  const next = { ...pending };
  delete next[documentId];
  const nextSettled = { ...settled };
  delete nextSettled[documentId];
  useExternalChangeStore.setState({ pending: next, settled: nextSettled });
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
}

/** Close and path change: drop each slot whose document left or moved to another path. */
function pruneAgainst(documents: Document[]): void {
  const pending = useExternalChangeStore.getState().pending;
  for (const slot of Object.values(pending)) {
    const doc = documents.find((d) => d.id === slot.documentId);
    if (!doc) removeSlot(slot.documentId, "closed");
    else if (doc.path !== slot.path) removeSlot(slot.documentId, "path-changed");
  }
}

useDocumentStore.subscribe((state, previous) => {
  if (state.documents !== previous.documents) pruneAgainst(state.documents);
});
