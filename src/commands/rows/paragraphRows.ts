/**
 * Purpose: command-table rows for the Paragraph group of `KeyboardShortcuts`.
 * v1 = today's defaults; v2 = plan § 5.3.2 with D9 (off-Mac Ctrl+Shift keys
 * for Code Fences, Quote and the lists), D10 (Quote ⇧⌘B on macOS) and D16
 * (Insert Table ⇧⌘T). Insert Table is today's Format › Insert Table item.
 *
 * @coordinates-with src/commands/commandTable.ts — assembles the rows
 */
import type { CommandRow, OwnershipContext } from "../commandTable.types";
import { configurable, macOff } from "../rowBuilders";

const BOTH: readonly OwnershipContext[] = ["editorW", "editorS", "tableW", "tableS"];

const heading = (level: 1 | 2 | 3 | 4 | 5 | 6): CommandRow =>
  configurable({
    id: `paragraph.heading${level}`,
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
    field: "paragraphParagraph",
    v1: "Cmd+0",
    v2: "Cmd+Shift+0",
    availability: ["both", "both"],
  }),
  configurable({
    id: "paragraph.increaseHeading",
    field: "paragraphIncreaseHeading",
    v1: "Cmd+=",
    v2: "Cmd+Option+]",
    availability: ["S", "S"],
  }),
  configurable({
    id: "paragraph.decreaseHeading",
    field: "paragraphDecreaseHeading",
    v1: "Cmd+-",
    v2: "Cmd+Option+[",
    availability: ["S", "S"],
  }),
  configurable({
    id: "paragraph.table",
    field: "paragraphTable",
    menuId: "menu.format.insert_table",
    menu: ["Format", "Insert Table"],
    v1: "Cmd+Option+T",
    v2: "Cmd+Shift+T",
    availability: ["W", "W"],
  }),
  configurable({
    id: "paragraph.codeFences",
    field: "paragraphCodeFences",
    v1: "Cmd+Option+C",
    v2: macOff("Cmd+Option+C", "Cmd+Shift+K"),
    availability: ["W", "W"],
  }),
  configurable({
    id: "paragraph.mathBlock",
    field: "paragraphMathBlock",
    v1: "Cmd+Option+B",
    v2: "Cmd+Option+Shift+M",
    availability: ["none", "none"],
    // § 5.8 row 3: built in Source only.
    contexts: ["editorS", "tableS"],
  }),
  configurable({
    id: "paragraph.quote",
    field: "paragraphQuote",
    v1: "Cmd+Option+Q",
    v2: macOff("Cmd+Shift+B", "Cmd+Shift+Q"),
    availability: ["none", "W"],
    contexts: BOTH,
  }),
  configurable({
    id: "paragraph.orderedList",
    field: "paragraphOrderedList",
    v1: "Cmd+Option+O",
    v2: macOff("Cmd+Option+O", "Cmd+Shift+["),
    availability: ["none", "W"],
    contexts: BOTH,
  }),
  configurable({
    id: "paragraph.unorderedList",
    field: "paragraphUnorderedList",
    v1: "Cmd+Option+U",
    v2: macOff("Cmd+Option+U", "Cmd+Shift+]"),
    availability: ["none", "W"],
    contexts: BOTH,
  }),
  configurable({
    id: "paragraph.indent",
    field: "paragraphIndent",
    v1: "Cmd+]",
    v2: "Cmd+]",
    availability: ["both", "both"],
  }),
  configurable({
    id: "paragraph.outdent",
    field: "paragraphOutdent",
    v1: "Cmd+[",
    v2: "Cmd+[",
    availability: ["both", "both"],
  }),
];
