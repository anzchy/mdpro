import { search, searchKeymap } from "@codemirror/search";
import { keymap } from "@codemirror/view";

/**
 * CodeMirror extensions that enable Find & Replace.
 *
 * - `search({ top: true })` mounts the inline search panel at the top of
 *   the editor so it does not obscure the text being searched.
 * - `keymap.of(searchKeymap)` wires the standard bindings:
 *     Cmd+F  — open Find panel
 *     Cmd+H  — open Find & Replace panel
 *     Enter / Shift+Enter / Cmd+G / Shift+Cmd+G — next / previous match
 *     Escape — close the panel
 *
 * WYSIWYG (Milkdown) mode search is out of scope — tracked as a follow-up.
 */
export const searchExtensions = [
  search({ top: true }),
  keymap.of(searchKeymap),
];
