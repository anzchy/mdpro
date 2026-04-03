/**
 * Purpose: ProseMirror highlight command for WYSIWYG (Milkdown) mode.
 *
 * When ⌘⇧H is pressed in WYSIWYG mode, applies the ProseMirror 'highlight'
 * mark directly to the current selection via toggleMark(), giving immediate
 * visual rendering without a mode switch (fixes #376).
 *
 * Design decisions:
 * - Uses toggleMark() from prosemirror-commands so the ProseMirror highlight
 *   mark is applied/removed as a proper mark, not by inserting raw ==text==.
 * - The mark type is resolved from view.state.schema.marks.highlight —
 *   the name registered by highlightMarkSchema in highlightMarkPlugin.ts.
 * - Returns false when there is no selection (cursor-only) or when the
 *   highlight mark is absent from the schema, matching the command contract.
 *
 * @coordinates-with highlightMarkPlugin.ts (defines highlightMarkSchema with name "highlight")
 * @coordinates-with MilkdownEditor.tsx (calls this function on Cmd+Shift+H in WYSIWYG mode)
 */

import type { EditorView as MilkdownView } from "@milkdown/kit/prose/view";
import { toggleMark } from "@milkdown/kit/prose/commands";

/**
 * Toggles the ProseMirror highlight mark on the current selection.
 *
 * @param view - The ProseMirror EditorView from the Milkdown instance.
 * @returns `true` if the mark was toggled, `false` if there was no selection
 *          or the highlight mark is not registered in the schema.
 */
export function milkdownHighlightCommand(view: MilkdownView): boolean {
  const { from, to } = view.state.selection;

  // Nothing selected — no-op (mirrors highlightCommand behaviour for CM)
  if (from === to) return false;

  const markType = view.state.schema.marks.highlight;
  if (!markType) return false;

  return toggleMark(markType)(view.state, view.dispatch);
}
