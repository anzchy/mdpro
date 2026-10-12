/** One `file:changed` event as Rust's watcher emits it (`file_watcher_route.rs`). */
export interface FileChangedEvent {
  path: string;
  changeType: "modified" | "deleted" | "renamed";
  newPath?: string;
  timestamp: number;
}

/**
 * An external change recorded against one open document (D171). `seq` is unique and
 * increasing within the window, so it orders the changes of one document lifetime and
 * never repeats across lifetimes; `path` is the document path the event matched.
 */
export interface PendingFileChange {
  documentId: string;
  seq: number;
  path: string;
  event: FileChangedEvent;
  /** `Date.now()` at receipt; the prompt is shown 300 ms after the latest receipt. */
  receivedAt: number;
  /** The `file.change.received` line's actionId, reused by `delivered`. */
  actionId: string;
  /**
   * `watcher`: a `file:changed` event. `open-check` (D111): an open or Save As reply
   * said the file changed between its read (or write) and the watch registration.
   */
  source: "watcher" | "open-check";
}
