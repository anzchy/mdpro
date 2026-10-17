/**
 * Purpose: command-table rows for the Format group of `KeyboardShortcuts`.
 * v1 = today's defaults; v2 = plan § 5.3.2 with D17 (Strikethrough ⇧⌘X).
 * Highlight is today's Format › Highlight Selection item.
 *
 * @coordinates-with src/commands/commandTable.ts — assembles the rows
 */
import type { CommandRow, OwnershipContext } from "../commandTable.types";
import { configurable } from "../rowBuilders";

const BOTH: readonly OwnershipContext[] = ["editorW", "editorS", "tableW", "tableS"];

export const FORMAT_ROWS: readonly CommandRow[] = [
  configurable({
    id: "format.strong",
    field: "formatStrong",
    v1: "Cmd+B",
    v2: "Cmd+B",
    availability: ["W", "W"],
  }),
  configurable({
    id: "format.emphasis",
    field: "formatEmphasis",
    v1: "Cmd+I",
    v2: "Cmd+I",
    availability: ["W", "W"],
  }),
  configurable({
    id: "format.underline",
    field: "formatUnderline",
    v1: "Cmd+U",
    v2: "Cmd+U",
    availability: ["none", "none"],
    contexts: BOTH,
  }),
  configurable({
    id: "format.code",
    field: "formatCode",
    v1: "Cmd+Shift+`",
    v2: "Cmd+Shift+`",
    availability: ["W", "W"],
  }),
  configurable({
    id: "format.strike",
    field: "formatStrike",
    v1: "Ctrl+Shift+`",
    v2: "Cmd+Shift+X",
    availability: ["W", "W"],
  }),
  configurable({
    id: "format.hyperlink",
    field: "formatHyperlink",
    v1: "Cmd+K",
    v2: "Cmd+K",
    availability: ["both", "both"],
  }),
  configurable({
    id: "format.image",
    field: "formatImage",
    v1: "Cmd+Ctrl+I",
    v2: "Cmd+Shift+I",
    availability: ["none", "none"],
    contexts: BOTH,
  }),
  configurable({
    id: "format.highlight",
    field: "formatHighlight",
    menuId: "menu.format.highlight",
    menu: ["Format", "Highlight Selection"],
    v1: "Cmd+Shift+H",
    v2: "Cmd+Shift+M",
    availability: ["both", "both"],
  }),
  configurable({
    id: "format.clearFormat",
    field: "formatClearFormat",
    v1: "Cmd+\\",
    v2: "Cmd+\\",
    availability: ["none", "none"],
    contexts: BOTH,
  }),
];
