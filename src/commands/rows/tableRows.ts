/**
 * Purpose: command-table rows for the six in-table keys of
 * `KeyboardShortcuts`. Unchanged in v2 (§ 5.3.2, K2); they act only inside a
 * table, in either mode.
 *
 * @coordinates-with src/commands/commandTable.ts — assembles the rows
 */
import type { KeyboardShortcuts } from "../../types/preferences";
import type { CommandRow } from "../commandTable.types";
import { TABLE_CONTEXTS, configurable } from "../rowBuilders";

const tableRow = (name: string, field: keyof KeyboardShortcuts, chord: string): CommandRow =>
  configurable({
    id: `table.${name}`,
    field,
    v1: chord,
    v2: chord,
    availability: ["both", "both"],
    contexts: TABLE_CONTEXTS,
  });

export const TABLE_ROWS: readonly CommandRow[] = [
  tableRow("insertRowAbove", "tableInsertRowAbove", "Cmd+Option+Up"),
  tableRow("insertRowBelow", "tableInsertRowBelow", "Cmd+Option+Down"),
  tableRow("insertColumnLeft", "tableInsertColumnLeft", "Cmd+Option+Left"),
  tableRow("insertColumnRight", "tableInsertColumnRight", "Cmd+Option+Right"),
  tableRow("deleteRow", "tableDeleteRow", "Cmd+Option+Backspace"),
  tableRow("deleteColumn", "tableDeleteColumn", "Cmd+Option+Shift+Backspace"),
];
