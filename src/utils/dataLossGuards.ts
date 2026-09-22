/**
 * Purpose: pure decision functions for the two highest data-loss-risk
 * interactions — window/document close with unsaved changes, and external-edit
 * conflict resolution — plus the flush-then-read helpers (D15) that feed the
 * close decisions fresh store state. Extracted from App.tsx so the decisions can
 * be unit tested for *behavior* (precedent: fake-IPC pattern in
 * useFileWatcher.test.ts) rather than only asserted as source-text contracts.
 *
 * The `decide*` functions stay pure. The `*AfterFlush` helpers are not: they
 * call `flushPendingEdits` so a WYSIWYG edit still inside the edit-sync delay
 * reaches documentStore before the decision reads it. A flush can only move a
 * decision toward "prompt", never away from it: a FAILED flush counts as unsaved
 * (D15-WI-5), because a history-less edit dirties the document only when its
 * write succeeds. App.tsx composes `decide*` over these helpers inline.
 *
 * The rule these encode: a dirty document must never be discarded or clobbered
 * without an explicit user decision. App.tsx wires these into the window
 * `onCloseRequested` handler, the close-request handler, and the file-change
 * effect; the logic itself lives here.
 *
 * @coordinates-with src/App.tsx (onCloseRequested, handleCloseRequest,
 *   file-change effect)
 * @coordinates-with src/stores/milkdownEditorStore.ts — flushPendingEdits
 */

import { useDocumentStore } from "../stores/documentStore";
import { useMilkdownEditorStore } from "../stores/milkdownEditorStore";
import type { Document } from "../types/document";

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

/**
 * Push pending WYSIWYG edits into documentStore (D15), then return the fresh active
 * document for a ⌘W decision. Never the render closure: an edit typed less than the
 * edit-sync delay ago is only in documentStore after this flush. If the flush failed,
 * the returned copy reads modified (the store is left untouched) so the close prompts.
 */
export function activeDocumentAfterFlush(): Document | null {
  const { status } = useMilkdownEditorStore.getState().flushPendingEdits("tab-close");
  const doc = useDocumentStore.getState().getActiveDocument() ?? null;
  return doc && status === "failed" ? { ...doc, isModified: true } : doc;
}

/**
 * Flush, then report whether ANY open document is modified: a window close discards
 * every tab, not only the active one. A failed flush counts as unsaved.
 */
export function hasUnsavedChangesAfterFlush(): boolean {
  const { status } = useMilkdownEditorStore.getState().flushPendingEdits("window-close");
  return status === "failed" || useDocumentStore.getState().documents.some((doc) => doc.isModified);
}
