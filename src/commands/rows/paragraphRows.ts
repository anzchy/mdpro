/**
 * Purpose: command-table rows for the Paragraph group of `KeyboardShortcuts`.
 * v1 = today's defaults; v2 = plan § 5.3.2 with D9 (off-Mac Ctrl+Shift keys
 * for Code Fences, Quote and the lists), D10 (Quote ⇧⌘B on macOS) and D16
 * (Insert Table ⇧⌘T). M4 places the macOS item under Paragraph and keeps
 * the existing off-Mac Format path and menu id.
 *
 * @coordinates-with src/commands/commandTable.ts — assembles the rows
 */
import type { CommandRow, OwnershipContext, MenuPath} from "../commandTable.types";
import { configurable, macOff } from "../rowBuilders";

const BOTH: readonly OwnershipContext[] = ["editorW", "editorS", "tableW", "tableS"];

const heading = (level: 1 | 2 | 3 | 4 | 5 | 6): CommandRow =>
  configurable({
    id: `paragraph.heading${level}`,
    menuId: `menu.paragraph.heading${level}`,
    menu: macOff<MenuPath>(["Paragraph", `Heading ${level}`], "none"),
    field: `paragraphHeading${level}`,
    v1: `Cmd+${level}`,
    v2: `Cmd+${level}`,
    availability: ["both", "both"],
  });

export const PARAGRAPH_ROWS: readonly CommandRow[] = [
  heading(1),
  heading(2),
  heading(3),
  heading(4),
  heading(5),
  heading(6),
  configurable({
    id: "paragraph.paragraph",
    menuId: "menu.paragraph.paragraph",
    menu: macOff<MenuPath>(["Paragraph", "Paragraph"], "none"),
    field: "paragraphParagraph",
    v1: "Cmd+0",
    v2: "Cmd+Shift+0",
    availability: ["both", "both"],
  }),
  configurable({
    id: "paragraph.increaseHeading",
    menuId: "menu.paragraph.increase_heading",
    menu: macOff<MenuPath>(["Paragraph", "Increase Heading"], "none"),
    field: "paragraphIncreaseHeading",
    v1: "Cmd+=",
    v2: "Cmd+Option+]",
    availability: ["both", "both"],
  }),
  configurable({
    id: "paragraph.decreaseHeading",
    menuId: "menu.paragraph.decrease_heading",
    menu: macOff<MenuPath>(["Paragraph", "Decrease Heading"], "none"),
    field: "paragraphDecreaseHeading",
    v1: "Cmd+-",
    v2: "Cmd+Option+[",
    availability: ["both", "both"],
  }),
  configurable({
    id: "paragraph.table",
    field: "paragraphTable",
    menuId: "menu.format.insert_table",
    menu: macOff<MenuPath>(["Paragraph", "Table..."], ["Format", "Insert Table"]),
    v1: "Cmd+Option+T",
    v2: "Cmd+Shift+T",
    availability: ["W", "W"],
  }),
  configurable({
    id: "paragraph.codeFences",
    menuId: "menu.paragraph.code_fences",
    menu: macOff<MenuPath>(["Paragraph", "Code Fences"], "none"),
    field: "paragraphCodeFences",
    v1: "Cmd+Option+C",
    v2: macOff("Cmd+Option+C", "Cmd+Shift+K"),
    availability: ["both", "both"],
  }),
  configurable({
    id: "paragraph.mathBlock",
    menuId: "menu.paragraph.math_block",
    menu: macOff<MenuPath>(["Paragraph", "Math Block"], "none"),
    field: "paragraphMathBlock",
    v1: "Cmd+Option+B",
    v2: "Cmd+Option+Shift+M",
    availability: ["S", "S"],
    // § 5.8 row 3: built in Source only.
    contexts: ["editorS", "tableS"],
  }),
  configurable({
    id: "paragraph.quote",
    menuId: "menu.paragraph.quote",
    menu: macOff<MenuPath>(["Paragraph", "Quote"], "none"),
    field: "paragraphQuote",
    v1: "Cmd+Option+Q",
    v2: macOff("Cmd+Shift+B", "Cmd+Shift+Q"),
    availability: ["none", "both"],
    contexts: BOTH,
  }),
  configurable({
    id: "paragraph.orderedList",
    menuId: "menu.paragraph.ordered_list",
    menu: macOff<MenuPath>(["Paragraph", "Ordered List"], "none"),
    field: "paragraphOrderedList",
    v1: "Cmd+Option+O",
    v2: macOff("Cmd+Option+O", "Cmd+Shift+["),
    availability: ["S", "both"],
    contexts: BOTH,
  }),
  configurable({
    id: "paragraph.unorderedList",
    menuId: "menu.paragraph.unordered_list",
    menu: macOff<MenuPath>(["Paragraph", "Unordered List"], "none"),
    field: "paragraphUnorderedList",
    v1: "Cmd+Option+U",
    v2: macOff("Cmd+Option+U", "Cmd+Shift+]"),
    availability: ["S", "both"],
    contexts: BOTH,
  }),
  configurable({
    id: "paragraph.indent",
    menuId: "menu.paragraph.indent",
    menu: macOff<MenuPath>(["Paragraph", "Indent"], "none"),
    field: "paragraphIndent",
    v1: "Cmd+]",
    v2: "Cmd+]",
    availability: ["both", "both"],
  }),
  configurable({
    id: "paragraph.outdent",
    menuId: "menu.paragraph.outdent",
    menu: macOff<MenuPath>(["Paragraph", "Outdent"], "none"),
    field: "paragraphOutdent",
    v1: "Cmd+[",
    v2: "Cmd+[",
    availability: ["both", "both"],
  }),
];
