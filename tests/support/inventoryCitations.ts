/**
 * @module tests/support/inventoryCitations
 * Purpose: the literal `implements` evidence for M1A-WI-6.
 * - IMPLEMENTS_BY_IDENTITY (R1-10a): each command id → the exported functions a
 *   CodeMirror binding must run (`===`) to implement it.
 * - IMPLEMENTS_CITED (R1-10b / R2-4b): every other `implements` pair, with the
 *   `file:line` that binds it and, for named keymap entries, the entry's name.
 *   Package paths are read from the pnpm store; `src/` paths from the worktree.
 */
import * as cmc from "@codemirror/commands";
import { findNext, findPrevious, openSearchPanel, selectNextOccurrence } from "@codemirror/search";
import * as heading from "../../src/plugins/codemirror/headingPlugin";
import { insertLinkCommand } from "../../src/plugins/codemirror/linkPlugin";
import { sourceFormatRunners } from "../../src/plugins/codemirror/sourceFormatPlugin";

export const IMPLEMENTS_BY_IDENTITY: Readonly<Record<string, readonly unknown[]>> = {
  "edit.undo": [cmc.undo],
  "edit.redo": [cmc.redo],
  "edit.selectWord": [selectNextOccurrence],
  "edit.find": [openSearchPanel],
  "edit.findNext": [findNext],
  "edit.findPrevious": [findPrevious],
  "paragraph.indent": [cmc.indentMore],
  "paragraph.outdent": [cmc.indentLess],
  "paragraph.heading1": [heading.heading1Command],
  "paragraph.heading2": [heading.heading2Command],
  "paragraph.heading3": [heading.heading3Command],
  "paragraph.heading4": [heading.heading4Command],
  "paragraph.heading5": [heading.heading5Command],
  "paragraph.heading6": [heading.heading6Command],
  "paragraph.paragraph": [heading.paragraphCommand],
  "paragraph.increaseHeading": [heading.increaseHeadingCommand],
  "paragraph.decreaseHeading": [heading.decreaseHeadingCommand],
  "format.hyperlink": [insertLinkCommand],
  "edit.jumpToTop": [cmc.cursorDocStart],
  "edit.jumpToBottom": [cmc.cursorDocEnd],
  "edit.selectAll": [cmc.selectAll],
  "format.strong": [sourceFormatRunners.strong],
  "format.emphasis": [sourceFormatRunners.emphasis],
  "format.code": [sourceFormatRunners.code],
  "format.strike": [sourceFormatRunners.strike],
  "paragraph.codeFences": [sourceFormatRunners.codeFences],
  "paragraph.mathBlock": [sourceFormatRunners.mathBlock],
  "paragraph.orderedList": [sourceFormatRunners.orderedList],
  "paragraph.unorderedList": [sourceFormatRunners.unorderedList],
  "edit.selectLine": [sourceFormatRunners.selectLine],
  "edit.deleteWord": [sourceFormatRunners.deleteWord],
};

export interface CitedImplements {
  readonly source: string;
  readonly key: string;
  readonly implements: string;
  readonly citation: string;
  readonly name?: string;
}

const CM = "@milkdown/preset-commonmark/lib/index.js";
const GFM = "@milkdown/preset-gfm/lib/index.js";
const HIST = "@milkdown/plugin-history/lib/index.js";
const TYPORA = "src/plugins/milkdown/typoraKeymapPlugin.ts";
const cm = (exp: string) => `milkdown:preset-commonmark/${exp}`;

const typora = (key: string, id: string, line: number, name: string): CitedImplements => ({
  source: "mdpro:typoraKeymap", key, implements: id, citation: `${TYPORA}:${line}`, name,
});

export const IMPLEMENTS_CITED: readonly CitedImplements[] = [
  { source: "mdpro:Editor.viewModeKeymap", key: "Mod-/", implements: "view.cycleViewMode",
    citation: "src/components/Editor/Editor.tsx:103" },
  { source: "mdpro:highlightPlugin", key: "Mod-Shift-h", implements: "format.highlight",
    citation: "src/plugins/codemirror/highlightPlugin.ts:67" },
  { source: cm("emphasisKeymap"), key: "Mod-i", implements: "format.emphasis", citation: `${CM}:113`, name: "ToggleEmphasis" },
  { source: cm("strongKeymap"), key: "Mod-b", implements: "format.strong", citation: `${CM}:208`, name: "ToggleBold" },
  { source: cm("inlineCodeKeymap"), key: "Mod-e", implements: "format.code", citation: `${CM}:290`, name: "ToggleInlineCode" },
  { source: cm("blockquoteKeymap"), key: "Mod-Shift-b", implements: "paragraph.quote", citation: `${CM}:764`,
    name: "WrapInBlockquote" },
  { source: cm("codeBlockKeymap"), key: "Mod-Alt-c", implements: "paragraph.codeFences", citation: `${CM}:891`,
    name: "CreateCodeBlock" },
  { source: cm("listItemKeymap"), key: "Mod-]", implements: "paragraph.indent", citation: `${CM}:1520`, name: "SinkListItem" },
  { source: cm("listItemKeymap"), key: "Mod-[", implements: "paragraph.outdent", citation: `${CM}:1527`, name: "LiftListItem" },
  { source: "milkdown:preset-gfm/strikethroughKeymap", key: "Mod-Alt-x", implements: "format.strike",
    citation: `${GFM}:81`, name: "ToggleStrikethrough" },
  { source: "milkdown:plugin-history/historyKeymap", key: "Mod-z", implements: "edit.undo", citation: `${HIST}:33`, name: "Undo" },
  { source: "milkdown:plugin-history/historyKeymap", key: "Mod-y", implements: "edit.redo", citation: `${HIST}:40`, name: "Redo" },
  { source: "milkdown:plugin-history/historyKeymap", key: "Shift-Mod-z", implements: "edit.redo", citation: `${HIST}:40`,
    name: "Redo" },
  typora("Mod-1", "paragraph.heading1", 116, "heading1"),
  typora("Mod-2", "paragraph.heading2", 117, "heading2"),
  typora("Mod-3", "paragraph.heading3", 118, "heading3"),
  typora("Mod-4", "paragraph.heading4", 119, "heading4"),
  typora("Mod-5", "paragraph.heading5", 120, "heading5"),
  typora("Mod-6", "paragraph.heading6", 121, "heading6"),
  typora("Mod-0", "paragraph.paragraph", 122, "paragraph"),
  typora("Mod-b", "format.strong", 123, "bold"),
  typora("Mod-i", "format.emphasis", 124, "italic"),
  typora("Mod-Shift-`", "format.code", 177, "inlineCode"),
  typora("Ctrl-Shift-`", "format.strike", 112, "strikethrough"),
  typora("Alt-Shift-5", "format.strike", 112, "strikethrough"),
  typora("Mod-k", "format.hyperlink", 191, "link"),
  { source: "milkdown:core/baseKeymap", key: "Mod-a", implements: "edit.selectAll",
    citation: "prosemirror-commands/dist/index.js:820" },
];
