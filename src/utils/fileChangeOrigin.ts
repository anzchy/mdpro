/**
 * Purpose: the receipt's origin filter for save notices (D173-WI-3, ADR-0086
 * decision 5). A save notice is a `file:changed` that carries `origin: { windowLabel,
 * documentId }` (Rust `notice_saved`, D173-WI-2); it reaches every window. The one
 * document it must not be recorded against is the exact origin: the saving document
 * in the saving window. Every other matching document records it as an external
 * change: a sibling tab on the same path in the saving window, and a document with the
 * same (path-derived) id in another window.
 *
 * Pipeline: `externalChangeStore.recordFileChange` (the listener and the capture
 *   replay) → `skipOrigin(owners, event)` → the remaining owners are recorded.
 *
 * Key decisions:
 * - **Pure, apart from reading this window's label**, and the label is read only for
 *   an event that carries `origin`, the non-throwing way (`currentWindowLabel`), so a
 *   watcher event behaves exactly as before and never touches the window API.
 * - **The skipped document's slot is not this module's business**: the caller leaves
 *   it as it was, so an own-save notice never clears or replaces a pending change.
 *
 * @coordinates-with src/stores/externalChangeStore.ts — `recordFileChange` calls it
 * @coordinates-with src/utils/currentWindowLabel.ts — this window's label
 * @coordinates-with src-tauri/src/services/file_watcher_save_notice.rs — the notice
 * @module utils/fileChangeOrigin
 */
import type { FileChangedEvent } from "../types/fileChange";
import { currentWindowLabel } from "./currentWindowLabel";

/** The owners left once the origin is dropped, and whether it was among them. */
export interface OriginFiltered<T> {
  owners: T[];
  ownSkipped: boolean;
}

/**
 * Drop from `owners` the one document that saved `event` in this window: its id is
 * `event.origin.documentId` and this window's label is `event.origin.windowLabel`.
 * An event without `origin` (every watcher event) keeps every owner.
 */
export function skipOrigin<T extends { id: string }>(
  owners: T[],
  event: FileChangedEvent,
  windowLabel: () => string = currentWindowLabel,
): OriginFiltered<T> {
  const origin = event.origin;
  if (!origin || !owners.some((doc) => doc.id === origin.documentId)) return { owners, ownSkipped: false };
  if (origin.windowLabel !== windowLabel()) return { owners, ownSkipped: false };
  return { owners: owners.filter((doc) => doc.id !== origin.documentId), ownSkipped: true };
}
