/**
 * Purpose: command-table rows for the Edit group of `KeyboardShortcuts`.
 * v1 = today's defaults and the D255 audit's availability; v2 = plan § 5.3.2
 * with D13 (Replace keeps ⌘H) and the M1b deltas (Replace → Source).
 *
 * @coordinates-with src/commands/commandTable.ts — assembles the rows
 */
import type { CommandRow, OwnershipContext } from "../commandTable.types";
import { configurable } from "../rowBuilders";

/** Contexts of a command whose eventual build covers both modes. */
const BOTH: readonly OwnershipContext[] = ["editorW", "editorS", "tableW", "tableS"];

export const EDIT_ROWS: readonly CommandRow[] = [
  configurable({
    id: "edit.copyAsMarkdown",
    field: "editCopyAsMarkdown",
    v1: "Cmd+Shift+C",
    v2: "Cmd+Shift+C",
    availability: ["none", "none"],
    contexts: BOTH,
  }),
  configurable({
    id: "edit.pasteAsPlainText",
    field: "editPasteAsPlainText",
    v1: "Cmd+Shift+V",
    v2: "Cmd+Shift+V",
    availability: ["none", "none"],
    contexts: BOTH,
  }),
  configurable({
    id: "edit.selectLine",
    field: "editSelectLine",
    v1: "Cmd+L",
    v2: "Cmd+L",
    availability: ["none", "none"],
    contexts: BOTH,
  }),
  configurable({
    id: "edit.selectWord",
    field: "editSelectWord",
    v1: "Cmd+D",
    v2: "Cmd+D",
    availability: ["S", "S"],
  }),
  configurable({
    id: "edit.deleteWord",
    field: "editDeleteWord",
    v1: "Cmd+Shift+D",
    v2: "<unassigned>",
    availability: ["none", "none"],
    contexts: BOTH,
  }),
  configurable({
    id: "edit.jumpToTop",
    field: "editJumpToTop",
    v1: "Cmd+Up",
    v2: "<system>",
    availability: ["both", "both"],
  }),
  configurable({
    id: "edit.jumpToBottom",
    field: "editJumpToBottom",
    v1: "Cmd+Down",
    v2: "<system>",
    availability: ["both", "both"],
  }),
  configurable({
    id: "edit.find",
    field: "editFind",
    v1: "Cmd+F",
    v2: "Cmd+F",
    availability: ["S", "S"],
  }),
  configurable({
    id: "edit.findNext",
    field: "editFindNext",
    v1: "Cmd+G",
    v2: "Cmd+G",
    v2Secondaries: ["F3"],
    availability: ["S", "S"],
  }),
  configurable({
    id: "edit.findPrevious",
    field: "editFindPrevious",
    v1: "Cmd+Shift+G",
    v2: "Cmd+Shift+G",
    v2Secondaries: ["Shift+F3"],
    availability: ["S", "S"],
  }),
  configurable({
    id: "edit.replace",
    field: "editReplace",
    v1: "Cmd+H",
    v2: "Cmd+H",
    availability: ["none", "S"],
    contexts: BOTH,
  }),
];
