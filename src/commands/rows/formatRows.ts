/**
 * Purpose: command-table rows for the Format group of `KeyboardShortcuts`.
 * v1 = today's defaults; v2 = plan § 5.3.2 with D17 (Strikethrough ⇧⌘X).
 * Highlight is today's Format › Highlight Selection item.
 *
 * @coordinates-with src/commands/commandTable.ts — assembles the rows
 */
import type { CommandRow, OwnershipContext, MenuPath} from "../commandTable.types";
import { configurable, macOff } from "../rowBuilders";

const BOTH: readonly OwnershipContext[] = ["editorW", "editorS", "tableW", "tableS"];

export const FORMAT_ROWS: readonly CommandRow[] = [
  configurable({
    id: "format.strong",
    menuId: "menu.format.strong",
    menu: macOff<MenuPath>(["Format", "Bold"], "none"),
    field: "formatStrong",
    v1: "Cmd+B",
    v2: "Cmd+B",
    availability: ["both", "both"],
  }),
  configurable({
    id: "format.emphasis",
    menuId: "menu.format.emphasis",
    menu: macOff<MenuPath>(["Format", "Italic"], "none"),
    field: "formatEmphasis",
    v1: "Cmd+I",
    v2: "Cmd+I",
    availability: ["both", "both"],
  }),
  configurable({
    id: "format.underline",
    menuId: "menu.format.underline",
    menu: macOff<MenuPath>(["Format", "Underline"], "none"),
    field: "formatUnderline",
    v1: "Cmd+U",
    v2: "Cmd+U",
    availability: ["none", "none"],
    contexts: BOTH,
  }),
  configurable({
    id: "format.code",
    menuId: "menu.format.code",
    menu: macOff<MenuPath>(["Format", "Code"], "none"),
    field: "formatCode",
    v1: "Cmd+Shift+`",
    v2: "Cmd+Shift+`",
    availability: ["both", "both"],
  }),
  configurable({
    id: "format.strike",
    menuId: "menu.format.strike",
    menu: macOff<MenuPath>(["Format", "Strikethrough"], "none"),
    field: "formatStrike",
    v1: "Ctrl+Shift+`",
    v2: "Cmd+Shift+X",
    availability: ["both", "both"],
  }),
  configurable({
    id: "format.hyperlink",
    menuId: "menu.format.hyperlink",
    menu: macOff<MenuPath>(["Format", "Link..."], "none"),
    field: "formatHyperlink",
    v1: "Cmd+K",
    v2: "Cmd+K",
    availability: ["both", "both"],
  }),
  configurable({
    id: "format.image",
    menuId: "menu.format.image",
    menu: macOff<MenuPath>(["Format", "Image..."], "none"),
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
    menuId: "menu.format.clear_format",
    menu: macOff<MenuPath>(["Format", "Clear Format"], "none"),
    field: "formatClearFormat",
    v1: "Cmd+\\",
    v2: "Cmd+\\",
    availability: ["none", "none"],
    contexts: BOTH,
  }),
];
