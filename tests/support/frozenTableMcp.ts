/**
 * @module tests/support/frozenTableMcp
 * Purpose: FROZEN verbatim copy of `src/utils/tableMcp.ts`'s `setCell`,
 * `escapeCellContent`, `dispatchTableEdit`, `buildContext` and the
 * rewriting arms of `applyMcpTableAction` at 8bb859e, taken before D49
 * WI-2 made the MCP table actions widen. It is the pre-fix oracle for MA-9:
 * on a table with no overflow, every MCP rewriting action must produce
 * exactly what this copy produces.
 *
 * ---------------------------------------------------------------------
 * Frozen at 8bb859e. Never edit, never keep in sync. Its whole value is
 * being stale. If a test disagrees with this file, the source changed.
 * ---------------------------------------------------------------------
 *
 * Only identifiers are renamed (`frozen*`), and the doc comments are
 * trimmed. The row/column actions go through `frozenApplyEdit`
 * (`./frozenTableEdits`), never `src/utils/tableEdits`, or the new code
 * would be compared against itself. `serializeRows`, `findAllTables`,
 * `makeIsFenced` and `guardTableWrite` are imported LIVE on purpose: WI-2
 * may not change any of them. `insert_table` is not copied (WI-2 leaves it
 * alone; MA-10 pins it directly) and returns null here.
 *
 * Not a `*.test.ts`, so vitest does not collect it.
 */

import { serializeRows, type TableModel } from "../../src/utils/tableParser";
import { findAllTables } from "../../src/utils/cursorSync/table";
import { makeIsFenced } from "../../src/utils/fenceRanges";
import { guardTableWrite } from "../../src/utils/tableWriteGuard";
import type { McpTableAction, SetCellPayload } from "../../src/utils/tableMcp";
import type { TableActionId, TableContext } from "../../src/plugins/milkdown/table/types";
import { frozenApplyEdit } from "./frozenTableEdits";

// --- verbatim from tableMcp.ts (8bb859e) -----------------------------------

function frozenEscapeCellContent(content: string): string | null {
  if (content.includes("\n") || content.includes("\r")) return null;
  let out = "";
  let prevWasBackslash = false;
  for (const ch of content) {
    if (ch === "|" && !prevWasBackslash) {
      out += "\\|";
      prevWasBackslash = false;
      continue;
    }
    out += ch;
    prevWasBackslash = ch === "\\" && !prevWasBackslash;
  }
  return out;
}

export function frozenSetCell(
  source: string,
  payload: SetCellPayload,
): string | null {
  const tableIndex = payload.tableIndex ?? 0;
  const safeContent = frozenEscapeCellContent(payload.content);
  if (safeContent === null) return null;
  const tables = findAllTables(source, makeIsFenced(source));
  const table = tables[tableIndex];
  if (!table) return null;
  if (!guardTableWrite(table, "mcp.set_cell")) return null;
  if (payload.row < 0 || payload.row >= table.rowCount) return null;
  if (payload.col < 0 || payload.col >= table.colCount) return null;

  const rows = table.rows.map((r) => r.map((c) => c.text));
  rows[payload.row][payload.col] = safeContent;
  const formatted = serializeRows(rows, table.alignments);
  return source.slice(0, table.start) + formatted + source.slice(table.end);
}

export function frozenApplyMcpTableAction(
  source: string,
  action: McpTableAction,
  payload: Record<string, unknown>,
): string | null {
  switch (action) {
    case "set_cell":
      return frozenSetCell(source, payload as unknown as SetCellPayload);
    case "add_row":
      return frozenDispatchTableEdit(source, payload, "row", "add");
    case "delete_row":
      return frozenDispatchTableEdit(source, payload, "row", "delete");
    case "add_column":
      return frozenDispatchTableEdit(source, payload, "col", "add");
    case "delete_column":
      return frozenDispatchTableEdit(source, payload, "col", "delete");
    default:
      return null;
  }
}

function frozenDispatchTableEdit(
  source: string,
  payload: Record<string, unknown>,
  axis: "row" | "col",
  op: "add" | "delete",
): string | null {
  const tableIndex = (payload.tableIndex as number | undefined) ?? 0;
  const targetIndex =
    op === "add"
      ? (payload.after as number | undefined)
      : (payload.index as number | undefined);
  if (typeof targetIndex !== "number") return null;

  const tables = findAllTables(source, makeIsFenced(source));
  const table = tables[tableIndex];
  if (!table) return null;
  if (!guardTableWrite(table, "mcp.table_edit")) return null;

  const ctx = frozenBuildContext(table, axis, targetIndex);
  if (!ctx) return null;

  const actionId: TableActionId =
    axis === "row"
      ? op === "add"
        ? "insert_row_after"
        : "delete_row"
      : op === "add"
        ? "insert_column_after"
        : "delete_column";

  const result = frozenApplyEdit(table, ctx, actionId);
  if (!result) return null;

  return source.slice(0, table.start) + result.source + source.slice(table.end);
}

function frozenBuildContext(
  table: TableModel,
  axis: "row" | "col",
  targetIndex: number,
): TableContext | null {
  if (axis === "row") {
    if (targetIndex < 0 || targetIndex >= table.rowCount) return null;
    return {
      rowIndex: targetIndex,
      colIndex: 0,
      rowCount: table.rowCount,
      colCount: table.colCount,
      alignment: "left",
    };
  }
  if (targetIndex < 0 || targetIndex >= table.colCount) return null;
  return {
    rowIndex: 0,
    colIndex: targetIndex,
    rowCount: table.rowCount,
    colCount: table.colCount,
    alignment: "left",
  };
}
