import { closeSearchPanel, findNext, findPrevious, openSearchPanel, search, searchKeymap, selectNextOccurrence } from "@codemirror/search";
import { keymap, type EditorView, type KeyBinding } from "@codemirror/view";
import { appliedKey } from "../../../commands/appliedKeymap";
import type { AppliedShortcuts } from "../../../types/keyboardShortcuts";

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

/** Source Replace opens the panel with its Replace input focused. */
export function openReplacePanel(view: EditorView): boolean {
  if (!openSearchPanel(view)) return false;
  const input = view.dom.querySelector<HTMLInputElement>(".cm-search input[name=replace]");
  input?.focus();
  input?.select();
  return true;
}

/** Keep F3 navigation fixed while configurable search and selection chords follow the applied set. */
export function searchExtensionsFor(applied: AppliedShortcuts | null, isMac: boolean) {
  const platform = isMac ? "macos" : "linux";
  const rows: KeyBinding[] = [
    { key: "F3", run: findNext, shift: findPrevious, scope: "editor search-panel", preventDefault: true },
    { key: "Escape", run: closeSearchPanel, scope: "editor search-panel" },
  ];
  const add = (field: "editFind" | "editFindNext" | "editFindPrevious" | "editReplace" | "editSelectWord", run: KeyBinding["run"]) => {
    const key = appliedKey(applied, field, platform);
    if (key) rows.push({ key, run, scope: "editor search-panel", preventDefault: true });
  };
  add("editFind", openSearchPanel);
  add("editFindNext", findNext);
  add("editFindPrevious", findPrevious);
  add("editReplace", openReplacePanel);
  add("editSelectWord", selectNextOccurrence);
  return [search({ top: true }), keymap.of(rows)];
}
