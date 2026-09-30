/**
 * Purpose: put keyboard focus and a collapsed caret at the END of the active Milkdown
 * editor, scrolled into view, and return its `view.dom` — or `null` when no WYSIWYG view
 * is registered. The MCP confirm dialog's focus fallback (D37 WI-6, "Gap 2 (a)"): when
 * the element that held focus at open is gone (queued prompts: an approved write rebuilt
 * the editor meanwhile), focus goes here so keystrokes still land.
 *
 * Key decisions:
 * - **The end, not the old caret** (D38, known limit): the rebuilt view's default
 *   selection is its start, which is where no one was typing; the end is a predictable
 *   place and the scroll shows it. The cost is a visible jump to the end of the document.
 * - **Selection-only, `addToHistory: false`**: it neither dirties the document nor adds
 *   an undo step (the `useMilkdownFocusRestore` convention).
 * - **Never throws**: a missing editor, or an editor whose view is not ready yet
 *   (`editor.action` throws), returns `null`.
 *
 * @module utils/focusActiveMilkdownAtEnd
 * @coordinates-with src/stores/milkdownEditorStore.ts — `getEditor`, the active editor
 * @coordinates-with src/components/common/McpWriteConfirmDialog.tsx — the caller
 * @coordinates-with src/hooks/useReturnFocusOnClose.ts — focuses the returned element
 */
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { useMilkdownEditorStore } from "../stores/milkdownEditorStore";

function activeView(): EditorView | null {
  const editor = useMilkdownEditorStore.getState().getEditor() as Editor | null;
  if (!editor) return null;
  try {
    return editor.action((ctx) => ctx.get(editorViewCtx));
  } catch {
    return null;
  }
}

/** Focus the active Milkdown view with the caret at its end; its DOM, or `null`. */
export function focusActiveMilkdownAtEnd(): HTMLElement | null {
  const view = activeView();
  if (!view) return null;
  const { state } = view;
  view.dispatch(
    state.tr
      .setSelection(TextSelection.atEnd(state.doc))
      .scrollIntoView()
      .setMeta("addToHistory", false),
  );
  view.focus();
  return view.dom;
}
