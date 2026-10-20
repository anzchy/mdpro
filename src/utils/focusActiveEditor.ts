/**
 * Purpose: choose and focus the active editor view in either mode. The target
 * selection policy is a caller option, independent of Recovery's close policy.
 * Source keeps its live selection; Milkdown may use its existing end caret.
 * @module utils/focusActiveEditor
 * @coordinates-with src/components/common/RecoveryDialog.tsx
 * @coordinates-with src/utils/focusActiveMilkdownAtEnd.ts
 */
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import { Selection } from "@milkdown/kit/prose/state";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView as ProseView } from "@milkdown/kit/prose/view";
import { useEditorStore } from "../stores/editorStore";
import { useMilkdownEditorStore } from "../stores/milkdownEditorStore";
import { useDocumentStore } from "../stores/documentStore";
import { loggingService } from "../services/loggingService";
import { isModalOpen } from "./modalTabActionGuard";

export type EditorFocusMode = "wysiwyg" | "source";
export type WysiwygCaret = "end" | "preserve";

function endCaret(doc: ProseNode): Selection {
  return Selection.findFrom(doc.resolve(doc.content.size), -1, true) ?? Selection.atEnd(doc);
}

function focusProse(view: ProseView, caret: WysiwygCaret): HTMLElement | null {
  if (!view.dom.isConnected) return null;
  if (caret === "end") {
    view.dispatch(view.state.tr.setSelection(endCaret(view.state.doc)).scrollIntoView().setMeta("addToHistory", false));
  }
  view.focus();
  return view.dom;
}

/** Focus the live editor in `mode`, returning its focusable DOM node, or null. */
export function focusActiveEditor(mode: EditorFocusMode, caret: WysiwygCaret = "end"): HTMLElement | null {
  if (mode === "source") {
    const view = useEditorStore.getState().editorView;
    if (!view?.dom.isConnected) return null;
    view.focus();
    return view.contentDOM;
  }
  const editor = useMilkdownEditorStore.getState().getEditor() as Editor | null;
  if (!editor) return null;
  try {
    const view = editor.action((ctx) => ctx.get(editorViewCtx)) as ProseView;
    return focusProse(view, caret);
  } catch {
    return null;
  }
}

interface ReadyEditor {
  documentId: string;
  generation: number;
  mode: EditorFocusMode;
  element: HTMLElement;
  focus: () => HTMLElement | null;
}

type CancelReason = "moved" | "modal" | "switched";
interface FocusIntent {
  documentId: string;
  generation: number;
  mode: EditorFocusMode;
  cancelEvent: string;
  release: () => void;
}

const ready = new Map<EditorFocusMode, ReadyEditor>();
let pending: FocusIntent | null = null;

function currentGeneration(documentId: string): number {
  return useMilkdownEditorStore.getState().editorGenerations[documentId] ?? 0;
}

function identityMatches(intent: Pick<FocusIntent, "documentId" | "generation" | "mode">, editor: ReadyEditor): boolean {
  return editor.documentId === intent.documentId && editor.generation === intent.generation && editor.mode === intent.mode;
}

function cancel(reason: CancelReason): void {
  const intent = pending;
  if (!intent) return;
  pending = null;
  intent.release();
  loggingService.logEventSync({
    level: "info",
    event: intent.cancelEvent,
    status: "cancel",
    actionId: loggingService.generateActionId(),
    context: { reason },
  });
}

function consume(editor: ReadyEditor): HTMLElement | null {
  const intent = pending;
  if (!intent || !identityMatches(intent, editor)) return null;
  if (useDocumentStore.getState().activeDocumentId !== editor.documentId) { cancel("switched"); return null; }
  if (currentGeneration(editor.documentId) !== editor.generation) return null;
  if (isModalOpen()) { cancel("modal"); return null; }
  if (document.activeElement && document.activeElement !== document.body) { cancel("moved"); return null; }
  pending = null;
  intent.release();
  return editor.focus();
}

/** Register an actual view with its document and generation. Cleanup cannot clear a newer view. */
export function registerReadyEditor(editor: ReadyEditor): () => void {
  if (useDocumentStore.getState().activeDocumentId !== editor.documentId ||
      currentGeneration(editor.documentId) !== editor.generation) return () => {};
  ready.set(editor.mode, editor);
  consume(editor);
  return () => { if (ready.get(editor.mode) === editor) ready.delete(editor.mode); };
}

/** One-shot focus request for the active document; the caller owns its log event name. */
export function requestActiveEditorFocus(cancelEvent: string): HTMLElement | null {
  const documentId = useDocumentStore.getState().activeDocumentId;
  const mode = useEditorStore.getState().viewMode;
  if (!documentId) return focusActiveEditor(mode);
  const generation = currentGeneration(documentId);
  const identity = { documentId, mode, generation };
  const registered = ready.get(mode);
  if (registered && identityMatches(identity, registered)) return registered.focus();
  // Legacy/direct callers have no view registration. Never trust that shortcut if a
  // registered outgoing view exists or a replacement generation is in flight.
  if (!registered && generation === 0) {
    const direct = focusActiveEditor(mode);
    if (direct) return direct;
  }
  if (pending) cancel("switched");
  const onFocus = (event: FocusEvent) => {
    const target = event.target;
    if (target instanceof Element && target !== document.body) cancel(isModalOpen() ? "modal" : "moved");
  };
  const onDocument = (state: { activeDocumentId: string | null }) => {
    if (state.activeDocumentId !== documentId) cancel("switched");
  };
  const unsubscribe = useDocumentStore.subscribe(onDocument);
  const unsubscribeGeneration = useMilkdownEditorStore.subscribe(() => {
    if (pending?.documentId === documentId) pending.generation = currentGeneration(documentId);
  });
  const onEditorStore = (state: { viewMode: string; editorView: { dom: HTMLElement; contentDOM: HTMLElement; focus: () => void } | null }) => {
    if (state.viewMode !== mode) { cancel("switched"); return; }
    if (mode !== "source" || ready.has("source") || !state.editorView?.dom.isConnected) return;
    const entry: ReadyEditor = { ...identity, element: state.editorView.contentDOM,
      focus: () => focusActiveEditor("source") };
    consume(entry);
  };
  const unsubscribeEditor = useEditorStore.subscribe(onEditorStore);
  const observer = new MutationObserver(() => { if (isModalOpen()) cancel("modal"); });
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("focusin", onFocus, true);
  pending = {
    ...identity, cancelEvent,
    release: () => {
      unsubscribe(); unsubscribeGeneration(); unsubscribeEditor(); observer.disconnect();
      document.removeEventListener("focusin", onFocus, true);
    },
  };
  return null;
}

/** Current Milkdown view, or null before its editor context is ready. */
export function getMilkdownView(editor: Editor | null | undefined): ProseView | null {
  if (!editor) return null;
  try { return editor.action((ctx) => ctx.get(editorViewCtx)); } catch { return null; }
}

/** Build an identity-bearing readiness registration for a Milkdown view. */
export function readyMilkdown(documentId: string, generation: number, view: ProseView): () => void {
  return registerReadyEditor({ documentId, generation, mode: "wysiwyg", element: view.dom,
    focus: () => focusProse(view, "end") });
}
