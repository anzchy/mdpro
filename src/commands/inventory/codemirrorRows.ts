/**
 * Purpose: the Source editor's (CodeMirror) baseline chords before M1b: the
 * basic setup's keymaps (@codemirror/commands 6.10.1, search 6.6.0, language
 * 6.12.1, lint 6.9.5, autocomplete 6.20.1), `indentWithTab`, and mdpro's own
 * keymaps (Editor.tsx, headingPlugin, linkPlugin, highlightPlugin, the Source
 * table Tab keymap). A binding's `Shift-` variant is its own row. Only names
 * with a modifier, or an F-key, are listed.
 *
 * @coordinates-with tests/editor-owned-inventory.test.tsx — historical rows
 *   and live v2 removal checks
 */
import type { EditorOwnedRow } from "../editorOwnedChords";
import { LINUX, MAC, OFF, impl, owned, remove, row, shadowedBy, type RowOptions } from "./rowKit";

const s = (source: string, key: string, d = owned, opts?: RowOptions): EditorOwnedRow =>
  row("S", `codemirror:${source}`, key, d, opts);
const m = (source: string, key: string, d = owned, opts?: RowOptions): EditorOwnedRow =>
  row("S", `mdpro:${source}`, key, d, opts);
const mac = { platforms: MAC };
const off = { platforms: OFF };

const DEFAULT_KEYMAP: readonly EditorOwnedRow[] = [
  s("defaultKeymap", "Alt-ArrowLeft"), s("defaultKeymap", "Shift-Alt-ArrowLeft"),
  s("defaultKeymap", "Alt-ArrowRight"), s("defaultKeymap", "Shift-Alt-ArrowRight"),
  s("defaultKeymap", "Ctrl-ArrowLeft", owned, mac), s("defaultKeymap", "Shift-Ctrl-ArrowLeft", owned, mac),
  s("defaultKeymap", "Ctrl-ArrowRight", owned, mac), s("defaultKeymap", "Shift-Ctrl-ArrowRight", owned, mac),
  s("defaultKeymap", "Alt-ArrowUp"), s("defaultKeymap", "Shift-Alt-ArrowUp"),
  s("defaultKeymap", "Alt-ArrowDown"), s("defaultKeymap", "Shift-Alt-ArrowDown"),
  // C17 keeps multi-cursor outside tables; the applied table keymap wins inside them.
  s("defaultKeymap", "Mod-Alt-ArrowUp"), s("defaultKeymap", "Mod-Alt-ArrowDown"),
  s("defaultKeymap", "Mod-Enter"),
  s("defaultKeymap", "Alt-l", owned, off), s("defaultKeymap", "Ctrl-l", owned, mac),
  // D268: Source Italic's v1 Mod-i wins in the high-precedence source-format keymap.
  s("defaultKeymap", "Mod-i", shadowedBy("mdpro:sourceFormatPlugin")),
  s("defaultKeymap", "Mod-[", impl("paragraph.outdent")), s("defaultKeymap", "Mod-]", impl("paragraph.indent")),
  s("defaultKeymap", "Mod-Alt-\\", owned, mac), s("defaultKeymap", "Mod-Alt-\\", remove("D264"), off),
  s("defaultKeymap", "Shift-Mod-k", remove("D267")),
  s("defaultKeymap", "Shift-Mod-\\"),
  s("defaultKeymap", "Mod-/", shadowedBy("mdpro:Editor.viewModeKeymap")),
  s("defaultKeymap", "Alt-A"),
  s("defaultKeymap", "Ctrl-m", remove("D272"), off), s("defaultKeymap", "Shift-Alt-m", owned, mac),
  s("defaultKeymap", "Shift-ArrowLeft"), s("defaultKeymap", "Shift-ArrowRight"),
  s("defaultKeymap", "Shift-ArrowUp"), s("defaultKeymap", "Shift-ArrowDown"),
  s("defaultKeymap", "Mod-ArrowLeft", owned, off), s("defaultKeymap", "Shift-Mod-ArrowLeft", owned, off),
  s("defaultKeymap", "Mod-ArrowRight", owned, off), s("defaultKeymap", "Shift-Mod-ArrowRight", owned, off),
  s("defaultKeymap", "Cmd-ArrowLeft", owned, mac), s("defaultKeymap", "Shift-Cmd-ArrowLeft", owned, mac),
  s("defaultKeymap", "Cmd-ArrowRight", owned, mac), s("defaultKeymap", "Shift-Cmd-ArrowRight", owned, mac),
  s("defaultKeymap", "Cmd-ArrowUp", impl("edit.jumpToTop"), mac), s("defaultKeymap", "Shift-Cmd-ArrowUp", owned, mac),
  s("defaultKeymap", "Cmd-ArrowDown", impl("edit.jumpToBottom"), mac),
  s("defaultKeymap", "Shift-Cmd-ArrowDown", owned, mac),
  s("defaultKeymap", "Ctrl-ArrowUp", owned, mac), s("defaultKeymap", "Shift-Ctrl-ArrowUp", owned, mac),
  s("defaultKeymap", "Ctrl-ArrowDown", owned, mac), s("defaultKeymap", "Shift-Ctrl-ArrowDown", owned, mac),
  s("defaultKeymap", "Shift-PageUp"), s("defaultKeymap", "Shift-PageDown"),
  s("defaultKeymap", "Shift-Home"), s("defaultKeymap", "Shift-End"),
  s("defaultKeymap", "Mod-Home", impl("edit.jumpToTop")), s("defaultKeymap", "Shift-Mod-Home"),
  s("defaultKeymap", "Mod-End", impl("edit.jumpToBottom")), s("defaultKeymap", "Shift-Mod-End"),
  s("defaultKeymap", "Shift-Enter"), s("defaultKeymap", "Mod-a", impl("edit.selectAll")),
  s("defaultKeymap", "Shift-Backspace"),
  s("defaultKeymap", "Mod-Backspace"), s("defaultKeymap", "Mod-Delete"),
  s("defaultKeymap", "Alt-Backspace", owned, mac), s("defaultKeymap", "Alt-Delete", owned, mac),
  // macOS Emacs-style motion (standardKeymap's emacsStyleKeymap).
  ...["b", "f", "p", "n", "a", "e"].flatMap((k) => [
    s("defaultKeymap", `Ctrl-${k}`, owned, mac), s("defaultKeymap", `Shift-Ctrl-${k}`, owned, mac),
  ]),
  ...["Ctrl-d", "Ctrl-h", "Ctrl-k", "Ctrl-Alt-h", "Ctrl-o", "Ctrl-t", "Ctrl-v"].map((k) =>
    s("defaultKeymap", k, owned, mac)),
];

const LIBRARY_KEYMAPS: readonly EditorOwnedRow[] = [
  s("searchKeymap", "Mod-f", impl("edit.find")),
  s("searchKeymap", "F3", impl("edit.findNext")), s("searchKeymap", "Shift-F3", impl("edit.findPrevious")),
  s("searchKeymap", "Mod-g", impl("edit.findNext")), s("searchKeymap", "Shift-Mod-g", impl("edit.findPrevious")),
  s("searchKeymap", "Mod-Shift-l", remove("C11")),
  s("searchKeymap", "Mod-Alt-g"),
  s("searchKeymap", "Mod-d", impl("edit.selectWord")),
  s("historyKeymap", "Mod-z", impl("edit.undo")),
  s("historyKeymap", "Mod-y", impl("edit.redo"), off), s("historyKeymap", "Mod-Shift-z", impl("edit.redo"), mac),
  s("historyKeymap", "Ctrl-Shift-z", impl("edit.redo"), { platforms: LINUX }),
  s("historyKeymap", "Mod-u", shadowedBy("mdpro:sourceFormatPlugin")),
  s("historyKeymap", "Alt-u", owned, off), s("historyKeymap", "Mod-Shift-u", owned, mac),
  s("foldKeymap", "Ctrl-Shift-[", remove("C12"), off), s("foldKeymap", "Ctrl-Shift-]", remove("C12"), off),
  s("foldKeymap", "Cmd-Alt-[", remove("C12"), mac), s("foldKeymap", "Cmd-Alt-]", remove("C12"), mac),
  s("foldKeymap", "Ctrl-Alt-[", remove("C12"), off), s("foldKeymap", "Ctrl-Alt-]", remove("C12"), off),
  s("foldKeymap", "Ctrl-Alt-[", owned, mac), s("foldKeymap", "Ctrl-Alt-]", owned, mac),
  s("lintKeymap", "Mod-Shift-m", remove("D269")), s("lintKeymap", "F8"),
  s("completionKeymap", "Ctrl-Space"),
  s("completionKeymap", "Alt-`", owned, mac), s("completionKeymap", "Alt-i", owned, mac),
  s("indentWithTab", "Shift-Tab"),
];

const MDPRO_KEYMAPS: readonly EditorOwnedRow[] = [
  m("Editor.viewModeKeymap", "Mod-/", impl("view.cycleViewMode")),
  m("Editor.viewModeKeymap", "Mod-Alt-/"),
  m("Editor.undoRedo", "Mod-z", impl("edit.undo")),
  m("Editor.undoRedo", "Mod-Shift-z", impl("edit.redo")),
  m("Editor.undoRedo", "Mod-y", impl("edit.redo")),
  m("sourceTableTabNav", "Shift-Tab"),
  ...([1, 2, 3, 4, 5, 6] as const).map((n) => m("headingPlugin", `Mod-${n}`, impl(`paragraph.heading${n}`))),
  m("headingPlugin", "Mod-0", impl("paragraph.paragraph")),
  m("headingPlugin", "Mod-=", impl("paragraph.increaseHeading")),
  m("headingPlugin", "Mod--", impl("paragraph.decreaseHeading")),
  m("linkPlugin", "Mod-k", impl("format.hyperlink")),
  m("highlightPlugin", "Mod-Shift-h", impl("format.highlight")),
];

export const CODEMIRROR_ROWS: readonly EditorOwnedRow[] = [...DEFAULT_KEYMAP, ...LIBRARY_KEYMAPS, ...MDPRO_KEYMAPS];
