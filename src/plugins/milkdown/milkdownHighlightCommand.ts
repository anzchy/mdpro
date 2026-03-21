/**
 * Purpose: ProseMirror highlight command for WYSIWYG (Milkdown) mode.
 *
 * When ⌘⇧H is pressed in WYSIWYG mode, `viewRef.current` is null because
 * CodeMirror is not mounted. This module provides an equivalent command that
 * wraps the current ProseMirror selection with `==text==` markers by
 * dispatching a text-insert transaction on the Milkdown EditorView.
 *
 * Design decisions:
 * - Uses raw ProseMirror `view.dispatch` (not a Milkdown $command) because
 *   there is no native highlight mark in the GFM/commonmark preset — the
 *   `==` syntax is a non-standard extension that Milkdown renders via its
 *   remark pipeline rather than a ProseMirror mark.
 * - Works only on a single contiguous selection (the first range). Multiple
 *   non-adjacent selections are unsupported by ProseMirror's text model.
 * - Returns `false` when there is no selection (cursor-only), matching the
 *   contract of CodeMirror command functions.
 */

import type { EditorView as MilkdownView } from "@milkdown/kit/prose/view";
import { TextSelection } from "@milkdown/kit/prose/state";

const HIGHLIGHT_OPEN = "==";
const HIGHLIGHT_CLOSE = "==";

/**
 * Wraps the current ProseMirror selection with `==` highlight markers.
 *
 * @param view - The ProseMirror EditorView from the Milkdown instance.
 * @returns `true` if text was wrapped, `false` if there was nothing to wrap.
 */
export function milkdownHighlightCommand(view: MilkdownView): boolean {
  const { state } = view;
  const { from, to } = state.selection;

  // Nothing selected — no-op (mirrors highlightCommand behaviour for CM)
  if (from === to) return false;

  const selectedText = state.doc.textBetween(from, to);

  // Build: ==<selected text>==
  const wrapped = HIGHLIGHT_OPEN + selectedText + HIGHLIGHT_CLOSE;

  const tr = state.tr.insertText(wrapped, from, to);

  // Re-select the inner text (excluding == markers) in the updated document
  const innerFrom = from + HIGHLIGHT_OPEN.length;
  const innerTo = innerFrom + selectedText.length;
  tr.setSelection(TextSelection.create(tr.doc, innerFrom, innerTo));
  tr.scrollIntoView();

  view.dispatch(tr);
  return true;
}
