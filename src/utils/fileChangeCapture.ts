/**
 * Purpose: keep the external changes an open or Save As would otherwise lose (D111,
 * ADR-0081, Codex interleavings 5 and 6). Rust registers the watch before it replies,
 * so a `file:changed` event can arrive while the reply is still in flight, before the
 * document holding that path is in the store; the listener used to drop it as
 * `other-path`. Each open or Save As opens a capture before its IPC call and settles it
 * once the open guard (or the Save As result) has committed a document.
 *
 * Pipeline: `beginCapture(path)` before the IPC → the listener's unmatched events →
 *   `captureUnmatched(event)` → `settle(target, changedSinceRead)` after the commit →
 *   `recordOpenDivergence(target)` when the flag is set, then each held event for the
 *   target's path through `recordFileChange`, in arrival order.
 *
 * Key decisions:
 * - **Only events no open document matched are held.** A matched event is recorded
 *   at once by the listener, as before; holding it too would record it twice.
 * - **A capture with no path (the Open and Save As dialogs pick the path in Rust)
 *   holds every unmatched event**, and replays only those whose path is the committed
 *   document's path. A capture with a path holds only that path's events.
 * - **The flag is recorded before the replay**, so a held watcher event (say a delete)
 *   is the latest slot and the one presented.
 * - **No commit, nothing kept.** A failed or cancelled open, a refused or cancelled
 *   Save As, and an open the guard turned into focusing an existing dirty tab settle
 *   with no target: the held events are dropped, and the flag attaches to nothing.
 *   The dirty tab's path was already watched, so its own watcher events reach it.
 * - **Bounded**: at most `MAX_HELD` events per capture, oldest dropped first; a slot
 *   keeps only the latest change anyway.
 * - `settle` is idempotent, so a `finally` may call it after a success path did.
 * - D173: a capture also reserves its path's watch hold (`reserveWatchHold`; null: every
 *   path), so the window releases nothing the open or Save As may still commit; `settle`
 *   ends the reservation and runs the release check, committed or not.
 *
 * @coordinates-with src/hooks/useFileWatcher.ts — calls `captureUnmatched`
 * @coordinates-with src/stores/externalChangeStore.ts — `recordFileChange`, `recordOpenDivergence`
 * @coordinates-with src/hooks/useDocument.ts — the three open entry points
 * @coordinates-with src/services/documentSave.ts — Save As (`saveAsCommitTarget`)
 * @coordinates-with src/utils/watchHolds.ts — `reserveWatchHold`
 * @module utils/fileChangeCapture
 */
import { useDocumentStore } from "../stores/documentStore";
import { recordFileChange, recordOpenDivergence } from "../stores/externalChangeStore";
import type { FileChangedEvent } from "../types/fileChange";
import type { OpenWriteResult } from "./openWriteGuard";
import { reserveWatchHold } from "./watchHolds";

/** Events held per capture before the oldest is dropped. */
export const MAX_HELD = 32;

/** The document an open or Save As committed: the one its read now lives in. */
export interface CommitTarget {
  documentId: string;
  path: string | null;
}

export interface FileChangeCapture {
  /**
   * End the capture. With a target, record `changedSinceRead` on it and replay the
   * held events for its path; without one, drop them. Later calls do nothing.
   */
  settle(target: CommitTarget | null, changedSinceRead?: boolean, actionId?: string): void;
  /** `settle` on an open guard's result (`openCommitTarget`); returns `outcome`. */
  settleOpen(outcome: OpenWriteResult, changedSinceRead?: boolean, actionId?: string): OpenWriteResult;
}

interface Held {
  path: string | null;
  /** Each held event with its `file.change.received` actionId, reused on replay. */
  events: Array<{ event: FileChangedEvent; actionId: string }>;
}

const captures = new Map<number, Held>();
let nextId = 0;

/** Hold unmatched events for an open or Save As of `path` (null: not known yet). */
export function beginCapture(path: string | null): FileChangeCapture {
  nextId += 1;
  const id = nextId;
  captures.set(id, { path, events: [] });
  const endReservation = reserveWatchHold(path);
  return {
    settleOpen(outcome, changedSinceRead, actionId) {
      this.settle(openCommitTarget(outcome), changedSinceRead, actionId);
      return outcome;
    },
    settle(target, changedSinceRead = false, actionId) {
      const held = captures.get(id);
      if (!held) return;
      captures.delete(id);
      if (target) {
        if (changedSinceRead) recordOpenDivergence(target.documentId, actionId);
        for (const { event, actionId: receipt } of held.events) {
          if (target.path !== null && event.path === target.path) recordFileChange(event, receipt);
        }
      }
      endReservation();
    },
  };
}

/**
 * Hold `event` (received under `actionId`) for every open capture that may commit its
 * path. Returns whether any did.
 */
export function captureUnmatched(event: FileChangedEvent, actionId: string): boolean {
  let taken = false;
  for (const held of captures.values()) {
    if (held.path !== null && held.path !== event.path) continue;
    held.events.push({ event, actionId });
    if (held.events.length > MAX_HELD) held.events.shift();
    taken = true;
  }
  return taken;
}

/** The commit target of an open guard's result: the written document, or none when the
 *  guard focused an existing dirty tab instead of installing the read. */
export function openCommitTarget(outcome: OpenWriteResult): CommitTarget | null {
  return outcome.kind === "written" ? { documentId: outcome.document.id, path: outcome.document.path } : null;
}

/** The commit target of a successful Save As to `path`: the document, if the save's
 *  result moved it to `path` (it is gone when it was closed during the save). */
export function saveAsCommitTarget(documentId: string, path: string): CommitTarget | null {
  const doc = useDocumentStore.getState().documents.find((d) => d.id === documentId);
  return doc?.path === path ? { documentId, path } : null;
}
