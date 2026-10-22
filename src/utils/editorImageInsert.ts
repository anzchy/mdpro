/**
 * Purpose: one guarded Image picker/copy/insert flow for both editor modes.
 * @coordinates-with editorMenuCommands.ts
 * @coordinates-with editorMenuSourceCommands.ts
 */
import { commandsCtx, type Editor } from "@milkdown/kit/core";
import { insertImageCommand } from "@milkdown/kit/preset/commonmark";
import type { EditorView as MilkdownView } from "@milkdown/kit/prose/view";
import { EditorView as SourceEditorView, type EditorView as SourceView } from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";
import { closeHistory } from "@milkdown/kit/prose/history";
import { copyExternalImage, pickImage } from "../services/imageService";
import { ipcErrorMessage } from "./ipcErrorMessage";
import { loggingService } from "../services/loggingService";
import { useDocumentStore } from "../stores/documentStore";
import { useEditorStore } from "../stores/editorStore";
import { useMilkdownEditorStore } from "../stores/milkdownEditorStore";
import { useToastStore } from "../stores/toastStore";
import { resolveImagesInContainer } from "../hooks/useMilkdownImages";
import { isTokenCurrent, type MenuTargetToken } from "./menuTargetToken";
import type { EditorMenuResult } from "./editorMenuCommands";

let pending = false;

type Target =
  | { mode: "source"; view: SourceView }
  | { mode: "wysiwyg"; view: MilkdownView; editor: Editor };

function logCompletion(actionId: string, status: "success" | "cancel" | "fail", reason?: string): void {
  loggingService.logEventSync({
    level: status === "fail" ? "error" : "info", event: "ui.menu.select", status, actionId,
    context: { controlId: "editor.format.image", stage: "complete", ...(reason ? { reason } : {}) },
  });
}

function imageErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "InvalidPath" in error) {
    const payload = error.InvalidPath;
    if (typeof payload === "object" && payload !== null && "message" in payload && typeof payload.message === "string") {
      return `invalid path: ${payload.message}`;
    }
  }
  return ipcErrorMessage(error);
}

/** Open Image synchronously, then validate identity again after each awaited boundary. */
export function startEditorImageInsert(target: Target, token: MenuTargetToken, actionId: string): EditorMenuResult {
  if (pending) return { status: "refused", reason: "modal_open" };
  const state = useDocumentStore.getState();
  const document = state.documents.find((item) => item.id === state.activeDocumentId);
  const path = document?.path;
  if (!path) {
    useToastStore.getState().showToast("Save the document before pasting images");
    return { status: "refused", reason: "no_change" };
  }
  if (target.mode === "source" ? (target.view.state.readOnly || !target.view.state.facet(SourceEditorView.editable)) : !target.view.editable) {
    return { status: "refused", reason: "read_only" };
  }
  const current = () => {
    if (!isTokenCurrent(token) || useEditorStore.getState().viewMode !== target.mode) return false;
    const now = useDocumentStore.getState();
    if (now.activeDocumentId !== token.documentId || now.documents.find((item) => item.id === token.documentId)?.path !== path) return false;
    if (target.mode === "source") return !target.view.state.readOnly && target.view.state.facet(SourceEditorView.editable) && target.view.dom.isConnected && useEditorStore.getState().editorView === target.view;
    return target.view.editable && !target.view.isDestroyed && target.view.dom.isConnected &&
      useMilkdownEditorStore.getState().getEditor() === target.editor;
  };
  if (!current()) return { status: "refused", reason: "missing_view" };
  pending = true;
  loggingService.logEventSync({
    level: "info", event: "ui.menu.select", status: "start", actionId,
    context: { controlId: "editor.format.image", stage: "opened" },
  });
  void (async () => {
    try {
      const selected = await pickImage();
      if (!current()) { logCompletion(actionId, "cancel", "stale"); return; }
      if (!selected) { logCompletion(actionId, "cancel", "picker_cancel"); return; }
      const copied = await copyExternalImage(path, selected);
      if (!current()) { logCompletion(actionId, "cancel", "stale"); return; }
      if (target.mode === "source") {
        const { from, to } = target.view.state.selection.main;
        target.view.dispatch({ changes: { from, to, insert: copied.markdownSyntax }, selection: { anchor: from + copied.markdownSyntax.length }, userEvent: "input", annotations: isolateHistory.of("full") });
      } else {
        target.view.dispatch(closeHistory(target.view.state.tr));
        target.editor.action((ctx) => ctx.get(commandsCtx).call(insertImageCommand.key, { src: copied.relativePath, alt: "" }));
        target.view.dispatch(closeHistory(target.view.state.tr));
        queueMicrotask(() => { if (current()) resolveImagesInContainer(path); });
      }
      logCompletion(actionId, "success");
    } catch (error) {
      if (!current()) { logCompletion(actionId, "cancel", "stale"); return; }
      const message = imageErrorMessage(error);
      useToastStore.getState().showToast(`Failed to insert image: ${message}`);
      logCompletion(actionId, "fail", "copy_or_pick_error");
    } finally {
      pending = false;
    }
  })();
  return { status: "opened" };
}
