/**
 * Purpose: compatibility fallback for dialogs that return to the active
 * Milkdown editor's last text cursor (D37, D72). Missing views return null.
 * @module utils/focusActiveMilkdownAtEnd
 * @coordinates-with src/utils/focusActiveEditor.ts
 */
import { focusActiveEditor } from "./focusActiveEditor";

/** Focus the current Milkdown view at its last text cursor. */
export function focusActiveMilkdownAtEnd(): HTMLElement | null {
  return focusActiveEditor("wysiwyg", "end");
}
