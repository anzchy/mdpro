/**
 * Purpose: the WYSIWYG editor's (Milkdown 7.18.0) baseline chords before M1b:
 * the `$useKeymap` keymaps of preset-commonmark, preset-gfm and plugin-history
 * (with their entry names), mdpro's typora keymap, Milkdown core's ProseMirror
 * base keymap (macOS adds its Emacs-style rows), and the `handleKeyDown`
 * handlers of prosemirror-tables' tableEditing and mdpro's inlineEditPlugin.
 * D255-WI-3b's seven v1 entries remain here for migration history.
 * Only names with a modifier are listed.
 *
 * @coordinates-with tests/editor-owned-inventory.test.tsx — historical package exports
 * @coordinates-with tests/milkdown-keymap-probe-*.test.ts — v2 active projection
 */
import type { EditorOwnedRow } from "../editorOwnedChords";
import type { CommandId } from "../commandTable.types";
import { MAC, OFF, TABLE_W, impl, owned, remove, row, type RowOptions } from "./rowKit";

const preset = (exp: string, key: string, name: string, d = owned, opts: RowOptions = {}): EditorOwnedRow =>
  row("W", `milkdown:preset-commonmark/${exp}`, key, d, { ...opts, names: [name] });
const typora = (key: string, name: string, d = owned, opts: RowOptions = {}): EditorOwnedRow =>
  row("W", "mdpro:typoraKeymap", key, d, { names: [name], ...opts });
const base = (key: string, d = owned, opts?: RowOptions): EditorOwnedRow =>
  row("W", "milkdown:core/baseKeymap", key, d, opts);
const table = (source: string, key: string, d = owned, names?: readonly string[]): EditorOwnedRow =>
  row("W", source, key, d, { contexts: TABLE_W, ...(names ? { names } : {}) });
const k4 = remove("K4");

const COMMONMARK: readonly EditorOwnedRow[] = [
  preset("emphasisKeymap", "Mod-i", "ToggleEmphasis", impl("format.emphasis")),
  preset("strongKeymap", "Mod-b", "ToggleBold", impl("format.strong")),
  preset("inlineCodeKeymap", "Mod-e", "ToggleInlineCode", impl("format.code")),
  preset("paragraphKeymap", "Mod-Alt-0", "TurnIntoText", k4),
  ...([1, 2, 3, 4, 5, 6] as const).map((n) => preset("headingKeymap", `Mod-Alt-${n}`, `TurnIntoH${n}`, k4)),
  // Quote's own ⇧⌘B on macOS (D10); off-Mac Quote is Ctrl+Shift+Q and K4 removes this key.
  preset("blockquoteKeymap", "Mod-Shift-b", "WrapInBlockquote", impl("paragraph.quote"), { platforms: MAC }),
  preset("blockquoteKeymap", "Mod-Shift-b", "WrapInBlockquote", k4, { platforms: OFF }),
  preset("codeBlockKeymap", "Mod-Alt-c", "CreateCodeBlock", impl("paragraph.codeFences"), { platforms: MAC }),
  preset("codeBlockKeymap", "Mod-Alt-c", "CreateCodeBlock", owned, { platforms: OFF }),
  preset("hardbreakKeymap", "Shift-Enter", "InsertHardbreak"),
  preset("bulletListKeymap", "Mod-Alt-8", "WrapInBulletList", k4),
  preset("orderedListKeymap", "Mod-Alt-7", "WrapInOrderedList", k4),
  preset("listItemKeymap", "Mod-]", "SinkListItem", impl("paragraph.indent")),
  preset("listItemKeymap", "Mod-[", "LiftListItem", impl("paragraph.outdent")),
  preset("listItemKeymap", "Shift-Tab", "LiftListItem"),
];

const GFM_AND_HISTORY: readonly EditorOwnedRow[] = [
  row("W", "milkdown:preset-gfm/strikethroughKeymap", "Mod-Alt-x", impl("format.strike"),
    { names: ["ToggleStrikethrough"] }),
  table("milkdown:preset-gfm/tableKeymap", "Mod-]", remove("D271"), ["NextCell"]),
  table("milkdown:preset-gfm/tableKeymap", "Mod-[", remove("D271"), ["PrevCell"]),
  table("milkdown:preset-gfm/tableKeymap", "Shift-Tab", owned, ["PrevCell"]),
  table("milkdown:preset-gfm/tableKeymap", "Mod-Enter", owned, ["ExitTable"]),
  row("W", "milkdown:plugin-history/historyKeymap", "Mod-z", impl("edit.undo"), { names: ["Undo"] }),
  row("W", "milkdown:plugin-history/historyKeymap", "Mod-y", impl("edit.redo"), { names: ["Redo"] }),
  row("W", "milkdown:plugin-history/historyKeymap", "Shift-Mod-z", impl("edit.redo"), { names: ["Redo"] }),
];

const heading = (n: 1 | 2 | 3 | 4 | 5 | 6): EditorOwnedRow =>
  typora(`Mod-${n}`, `heading${n}`, impl(`paragraph.heading${n}` as CommandId));

const TYPORA: readonly EditorOwnedRow[] = [
  heading(1), heading(2), heading(3), heading(4), heading(5), heading(6),
  typora("Mod-0", "paragraph", impl("paragraph.paragraph")),
  typora("Mod-b", "bold", impl("format.strong")),
  typora("Mod-i", "italic", impl("format.emphasis")),
  typora("Mod-=", "increaseHeading", impl("paragraph.increaseHeading")),
  typora("Mod--", "decreaseHeading", impl("paragraph.decreaseHeading")),
  typora("Mod-d", "selectWord", impl("edit.selectWord")),
  typora("Mod-l", "selectLine", impl("edit.selectLine")),
  typora("Mod-\\", "clearFormat", impl("format.clearFormat")),
  typora("Mod-u", "underline", impl("format.underline")),
  typora("Mod-Ctrl-i", "image", impl("format.image"), { platforms: MAC }),
  row("W", "mdpro:typoraKeymap", "Shift-Tab", owned, { names: ["codeBlockOutdent", "tableShiftTab"] }),
  typora("Mod-Shift-`", "inlineCode", impl("format.code")),
  typora("Ctrl-Shift-`", "strikethrough", impl("format.strike"), { platforms: MAC }),
  typora("Alt-Shift-5", "strikethrough", impl("format.strike"), { platforms: OFF }),
  typora("Mod-k", "link", impl("format.hyperlink")),
];

const HANDLERS: readonly EditorOwnedRow[] = [
  base("Mod-Enter"), base("Mod-Backspace"), base("Shift-Backspace"), base("Mod-Delete"),
  base("Mod-a", impl("edit.selectAll")),
  ...["Ctrl-h", "Ctrl-d", "Ctrl-a", "Ctrl-e", "Alt-d", "Alt-Delete", "Alt-Backspace", "Ctrl-Alt-Backspace"].map((k) =>
    base(k, owned, { platforms: MAC })),
  ...["Shift-ArrowLeft", "Shift-ArrowRight", "Shift-ArrowUp", "Shift-ArrowDown", "Mod-Backspace", "Mod-Delete"].map(
    (k) => table("prosemirror-tables:tableEditing", k)),
  // ⌃` reveals the inline element under the cursor (inlineEditPlugin.ts handleKeyDown).
  row("W", "mdpro:inlineEditPlugin", "Ctrl-`", owned),
];

export const MILKDOWN_ROWS: readonly EditorOwnedRow[] = [...COMMONMARK, ...GFM_AND_HISTORY, ...TYPORA, ...HANDLERS];
