/**
 * Purpose: pure decision functions for the two highest data-loss-risk
 * interactions — window/document close with unsaved changes, and external-edit
 * conflict resolution. Extracted from App.tsx so the decisions can be unit
 * tested for *behavior* (precedent: fake-IPC pattern in useFileWatcher.test.ts)
 * rather than only asserted as source-text contracts.
 *
 * The rule these encode: a dirty document must never be discarded or clobbered
 * without an explicit user decision. App.tsx wires these into the window
 * `onCloseRequested` handler, the close-request handler, and the file-change
 * effect; the logic itself lives here.
 *
 * @coordinates-with src/App.tsx (onCloseRequested, handleCloseRequest,
 *   file-change effect)
 */

/** What the window close handler should do when the OS requests a close. */
export type WindowCloseDecision = "allow" | "prompt" | "save-and-close";

/**
 * Decide how to handle an OS window-close request.
 *
 * - `allow`: a prior confirm already latched the close — let it through.
 * - `prompt`: unsaved changes exist — show the confirm dialog, do NOT close.
 * - `save-and-close`: clean document — persist window state and close.
 */
export function decideWindowClose(state: {
  allowWindowClose: boolean;
  hasUnsavedChanges: boolean;
}): WindowCloseDecision {
  if (state.allowWindowClose) return "allow";
  if (state.hasUnsavedChanges) return "prompt";
  return "save-and-close";
}

/** What the in-app close-request (⌘W) handler should do. */
export type CloseRequestDecision = "prompt" | "close";

/**
 * Decide how to handle a document close request. A modified document must
 * prompt before closing; a clean one closes directly.
 */
export function decideCloseRequest(doc: { isModified: boolean } | null): CloseRequestDecision | "noop" {
  if (!doc) return "noop";
  return doc.isModified ? "prompt" : "close";
}

export interface FileChangeEvent {
  path: string;
  changeType: "modified" | "deleted" | "renamed" | string;
  newPath?: string;
}

export type FileChangeAction =
  | { action: "ignore" }
  | { action: "rename"; newPath: string }
  | { action: "reload-prompt"; message: string }
  | { action: "deleted-prompt"; message: string };

/**
 * Decide how to respond to an external file change on the active document.
 *
 * Critically, a `modified` event must NOT auto-reload — that would clobber the
 * user's in-editor unsaved edits. It surfaces a prompt instead; the actual
 * reload is user-initiated. Events for a path other than the active document
 * are ignored (filter to the active doc only).
 */
export function decideFileChange(
  event: FileChangeEvent | null,
  activeDoc: { path: string | null } | null,
): FileChangeAction {
  if (!event || !activeDoc) return { action: "ignore" };
  if (event.path !== activeDoc.path) return { action: "ignore" };

  if (event.changeType === "renamed" && event.newPath) {
    return { action: "rename", newPath: event.newPath };
  }
  if (event.changeType === "deleted") {
    return {
      action: "deleted-prompt",
      message: "File was deleted externally. Save to a new location if needed.",
    };
  }
  return {
    action: "reload-prompt",
    message: "File was modified externally. Reload to update content?",
  };
}
