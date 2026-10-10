/**
 * Purpose: bind a pending ⌘K link request to the document and view mode it was made
 * in, and cancel it — closing the "Insert Link" modal — when either changes before
 * the URL arrives (D73). Mounted once, in `App`.
 *
 * Key decisions:
 * - **Why it exists**: one CodeMirror view is reused across tabs and the Source
 *   callback only checked `view.dom.isConnected`, so a request that outlived its
 *   document (native ⌘W, `file:open`, MCP `create_document` → `setActiveDocumentId`)
 *   wrote `[text](url)` into another document at stale offsets. The WYSIWYG ⌘K shares
 *   `linkInsertStore`, so it is bound here too.
 * - **Binding captured at request time**: zustand notifies subscribers synchronously
 *   inside `setPendingCallback`, so the active id and view mode read then are the
 *   ones the request was made in.
 * - **One subscription point, live only while a request is pending**: the watch on
 *   the document and editor stores is taken when a callback appears and dropped when
 *   it goes (however it goes), so an idle app observes nothing.
 * - Content edits and closing *another* document do not cancel; only the binding
 *   (the bound document's presence, the active id, the view mode) does.
 * - Lives in a hook, not the store: `linkInsertStore` is imported by the keymap
 *   plugins, whose node-environment tests must not pull the editor store graph.
 *
 * Logs `ui.link-insert.cancel` (`status: "cancel"`, `context: { screen, reason }`)
 * once per cancellation; the user-driven Cancel stays `ui.link-modal.cancel`.
 *
 * @module hooks/useLinkInsertBinding
 * @coordinates-with src/stores/linkInsertStore.ts — the pending request
 * @coordinates-with src/stores/documentStore.ts — `activeDocumentId`, `documents`
 * @coordinates-with src/stores/editorStore.ts — `viewMode`
 * @coordinates-with src/App.tsx — the one mount
 */
import { useEffect } from "react";
import { loggingService } from "../services/loggingService";
import { useDocumentStore } from "../stores/documentStore";
import { useEditorStore } from "../stores/editorStore";
import { useLinkInsertStore } from "../stores/linkInsertStore";
import type { ViewMode } from "../types/editor";

/** Why a pending request was cancelled without the user answering. */
export type LinkInsertCancelReason = "document-closed" | "document-switched" | "view-mode-changed";

const CANCEL_EVENT = "ui.link-insert.cancel";

interface Binding {
  documentId: string | null;
  viewMode: ViewMode;
}

function currentBinding(): Binding {
  return {
    documentId: useDocumentStore.getState().activeDocumentId,
    viewMode: useEditorStore.getState().viewMode,
  };
}

/** Why `binding` no longer holds, or null while it still does. */
function brokenBy(binding: Binding): LinkInsertCancelReason | null {
  const { documents, activeDocumentId } = useDocumentStore.getState();
  if (binding.documentId !== null && !documents.some((d) => d.id === binding.documentId)) {
    return "document-closed";
  }
  if (activeDocumentId !== binding.documentId) return "document-switched";
  if (useEditorStore.getState().viewMode !== binding.viewMode) return "view-mode-changed";
  return null;
}

/** Watch `binding` until it breaks (then cancel the request) or the returned stop runs. */
function watchBinding(binding: Binding): () => void {
  const check = () => {
    const reason = brokenBy(binding);
    if (reason === null) return;
    const { mode, clearPendingCallback } = useLinkInsertStore.getState();
    clearPendingCallback();
    loggingService.logEventSync({
      level: "info",
      event: CANCEL_EVENT,
      status: "cancel",
      actionId: loggingService.generateActionId(),
      context: { screen: mode, reason },
    });
  };
  const offDocuments = useDocumentStore.subscribe(check);
  const offEditor = useEditorStore.subscribe(check);
  return () => {
    offDocuments();
    offEditor();
  };
}

/** Cancel a pending ⌘K link request whose document or view mode changed (D73). */
export function useLinkInsertBinding(): void {
  useEffect(() => {
    let stop: (() => void) | null = null;
    const unwatch = () => {
      stop?.();
      stop = null;
    };
    const offLink = useLinkInsertStore.subscribe((state, prev) => {
      if (state.pendingCallback === prev.pendingCallback) return;
      unwatch();
      if (state.pendingCallback !== null) stop = watchBinding(currentBinding());
    });
    return () => {
      offLink();
      unwatch();
    };
  }, []);
}
