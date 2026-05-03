/**
 * @module tableMcp
 * Purpose: Pure source-level helpers behind the MCP table tools
 * (Phase 3 WI-3.3). The frontend's `useMcpEvents` handler calls
 * `applyMcpTableAction` on receipt of `mcp:table_action` events from
 * the Rust HTTP routes, computes the new document content, then
 * pushes it back to the shadow store via the existing
 * `mcp_sync_documents` flow.
 *
 * Architecture (WI-3.3 Option B — frontend-driven): Rust validates
 * inputs and forwards intent; the frontend owns parsing + edits via
 * `tableParser` / `tableEdits` so we don't ship a second parser in
 * Rust. Rust returns 202 Accepted; the MCP client confirms via a
 * follow-up `read_document`.
 *
 * @coordinates-with src-tauri/src/services/http_server.rs
 * @coordinates-with src/hooks/useMcpEvents.ts
 * @coordinates-with src/utils/tableEdits
 * @coordinates-with src/utils/tableParser
 */

import {
  serializeRows,
  type ColumnAlignment,
  type TableModel,
} from "./tableParser";
import { findAllTables } from "./cursorSync/table";
import { applyEdit } from "./tableEdits";
import { makeIsFenced } from "./fenceRanges";
import type {
  TableActionId,
  TableContext,
} from "../plugins/milkdown/table/types";

export type McpTableAction =
  | "insert_table"
  | "set_cell"
  | "add_row"
  | "delete_row"
  | "add_column"
  | "delete_column";

// ---------------------------------------------------------------------------
// insert_table
// ---------------------------------------------------------------------------

export interface InsertTablePayload {
  rows: number;
  cols: number;
  alignments?: ColumnAlignment[];
}

/**
 * Append an empty table to the source. Returns the new source, or
 * null on invalid input.
 */
export function insertTable(
  source: string,
  payload: InsertTablePayload,
): string | null {
  if (payload.rows <= 0 || payload.cols <= 0) return null;
  const alignments: ColumnAlignment[] =
    payload.alignments ?? new Array(payload.cols).fill(null);
  if (alignments.length !== payload.cols) return null;

  const blankRow = (): string[] => new Array(payload.cols).fill("");
  const rows: string[][] = [];
  for (let i = 0; i < payload.rows; i += 1) rows.push(blankRow());
  const tableSrc = serializeRows(rows, alignments);

  // Append to doc with a leading blank line (markdown table boundary).
  const sep = source.length === 0 || source.endsWith("\n\n")
    ? ""
    : source.endsWith("\n")
      ? "\n"
      : "\n\n";
  return source + sep + tableSrc + "\n";
}

// ---------------------------------------------------------------------------
// set_cell
// ---------------------------------------------------------------------------

export interface SetCellPayload {
  /** 0-based table index in document order (default 0). */
  tableIndex?: number;
  row: number;
  col: number;
  content: string;
}

/**
 * Audit-fix H2 (2026-05-04): cells live on a single source line and
 * use `|` as a column separator. An MCP client passing raw cell text
 * with embedded `|` or newlines would silently corrupt the table on
 * the next round-trip.
 *
 * - `|` characters are escaped to `\|` (GFM literal-pipe form),
 *   leaving any pre-existing `\|` untouched.
 * - `\n` / `\r` are NOT escapable in GFM cells — return null so the
 *   caller surfaces an error instead of fabricating a broken cell.
 */
export function escapeCellContent(content: string): string | null {
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

export function setCell(
  source: string,
  payload: SetCellPayload,
): string | null {
  const tableIndex = payload.tableIndex ?? 0;
  // Audit-fix H2: refuse content with embedded newlines; auto-escape pipes.
  const safeContent = escapeCellContent(payload.content);
  if (safeContent === null) return null;
  // Audit-fix H4: skip fenced tables so MCP can't target/clobber them.
  const tables = findAllTables(source, makeIsFenced(source));
  const table = tables[tableIndex];
  if (!table) return null;
  if (payload.row < 0 || payload.row >= table.rowCount) return null;
  if (payload.col < 0 || payload.col >= table.colCount) return null;

  const rows = table.rows.map((r) => r.map((c) => c.text));
  rows[payload.row][payload.col] = safeContent;
  const formatted = serializeRows(rows, table.alignments);
  return source.slice(0, table.start) + formatted + source.slice(table.end);
}

// ---------------------------------------------------------------------------
// Generic dispatcher
// ---------------------------------------------------------------------------

/**
 * Resolve an MCP intent against the current source. Returns the new
 * source or null on invalid payload / out-of-range coords / unknown
 * action.
 */
export function applyMcpTableAction(
  source: string,
  action: McpTableAction,
  payload: Record<string, unknown>,
): string | null {
  switch (action) {
    case "insert_table":
      return insertTable(source, payload as unknown as InsertTablePayload);
    case "set_cell":
      return setCell(source, payload as unknown as SetCellPayload);
    case "add_row":
      return dispatchTableEdit(source, payload, "row", "add");
    case "delete_row":
      return dispatchTableEdit(source, payload, "row", "delete");
    case "add_column":
      return dispatchTableEdit(source, payload, "col", "add");
    case "delete_column":
      return dispatchTableEdit(source, payload, "col", "delete");
    default:
      return null;
  }
}

/**
 * Dispatch the row/column add/delete actions through `tableEdits.applyEdit`
 * (single source of truth for structural mutations).
 *
 * Payload contract:
 *   - add_row:    { tableIndex?, after: number }  // 0-based row index
 *   - delete_row: { tableIndex?, index: number }
 *   - add_column: { tableIndex?, after: number }
 *   - delete_column: { tableIndex?, index: number }
 */
function dispatchTableEdit(
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

  // Audit-fix H4: fence-guarded enumeration so MCP indices match what
  // the user (and the WYSIWYG view) sees.
  const tables = findAllTables(source, makeIsFenced(source));
  const table = tables[tableIndex];
  if (!table) return null;

  const ctx = buildContext(table, axis, targetIndex);
  if (!ctx) return null;

  const actionId: TableActionId =
    axis === "row"
      ? op === "add"
        ? "insert_row_after"
        : "delete_row"
      : op === "add"
        ? "insert_column_after"
        : "delete_column";

  const result = applyEdit(table, ctx, actionId);
  if (!result) return null;

  return source.slice(0, table.start) + result.source + source.slice(table.end);
}

function buildContext(
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
