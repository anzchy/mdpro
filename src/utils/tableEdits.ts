/**
 * @module tableEdits
 * Purpose: Pure source-mode table edits (Phase 2 WI-2.4). Each function
 * takes a parsed `TableModel` plus a `TableContext` and returns the new
 * source for the table region plus a cursor offset within that source.
 *
 * Strategy: build a mutable `string[][]` from the model, apply the
 * structural mutation, serialize via `serializeRows`, then re-parse to
 * read the cursor target cell's offset. Re-parsing is cheap and avoids
 * reinventing offset arithmetic for every action.
 *
 * @coordinates-with src/plugins/codemirror/sourceTableContextMenu.ts
 * @coordinates-with src/plugins/milkdown/table/actionDescriptors.ts
 */

import {
  parseTableAt,
  serializeRows,
  type ColumnAlignment,
  type TableModel,
} from "./tableParser";
import type {
  TableActionId,
  TableCellAlignment,
  TableContext,
} from "../plugins/milkdown/table/types";

export interface EditResult {
  /** New text for the source range `[model.start, model.end)`. */
  source: string;
  /** Cursor offset relative to the start of `source`. */
  cursorOffset: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read the model into a mutable rows + alignments pair. */
function mutableFromModel(model: TableModel): {
  rows: string[][];
  alignments: ColumnAlignment[];
} {
  return {
    rows: model.rows.map((r) => r.map((c) => c.text)),
    alignments: model.alignments.slice(),
  };
}

/**
 * Serialize and locate the cursor target cell. When the resulting
 * table has zero rows or zero columns, returns an empty source — the
 * dispatcher treats this as "delete the table region".
 */
function emit(
  rows: string[][],
  alignments: ColumnAlignment[],
  targetRow: number,
  targetCol: number,
): EditResult {
  if (rows.length === 0 || alignments.length === 0) {
    return { source: "", cursorOffset: 0 };
  }
  const source = serializeRows(rows, alignments);
  const reParsed = parseTableAt(source, 0);
  if (!reParsed) return { source, cursorOffset: 0 };
  const clampedRow = Math.max(0, Math.min(targetRow, reParsed.rowCount - 1));
  const clampedCol = Math.max(0, Math.min(targetCol, reParsed.colCount - 1));
  const cursorOffset = reParsed.rows[clampedRow][clampedCol].start;
  return { source, cursorOffset };
}

function makeBlankRow(colCount: number): string[] {
  return new Array(colCount).fill("");
}

// ---------------------------------------------------------------------------
// Insert
// ---------------------------------------------------------------------------

export function insertRowBefore(
  model: TableModel,
  ctx: TableContext,
): EditResult {
  const { rows, alignments } = mutableFromModel(model);
  rows.splice(ctx.rowIndex, 0, makeBlankRow(model.colCount));
  return emit(rows, alignments, ctx.rowIndex, ctx.colIndex);
}

export function insertRowAfter(
  model: TableModel,
  ctx: TableContext,
): EditResult {
  const { rows, alignments } = mutableFromModel(model);
  // GFM has no "above the header" semantic — when rowIndex is 0 (header),
  // "after" means row index 1 (first body). For body rows, insert at
  // rowIndex + 1.
  const insertAt = ctx.rowIndex + 1;
  rows.splice(insertAt, 0, makeBlankRow(model.colCount));
  return emit(rows, alignments, insertAt, ctx.colIndex);
}

export function insertColumnBefore(
  model: TableModel,
  ctx: TableContext,
): EditResult {
  const { rows, alignments } = mutableFromModel(model);
  for (const row of rows) row.splice(ctx.colIndex, 0, "");
  alignments.splice(ctx.colIndex, 0, null);
  return emit(rows, alignments, ctx.rowIndex, ctx.colIndex);
}

export function insertColumnAfter(
  model: TableModel,
  ctx: TableContext,
): EditResult {
  const { rows, alignments } = mutableFromModel(model);
  const insertAt = ctx.colIndex + 1;
  for (const row of rows) row.splice(insertAt, 0, "");
  alignments.splice(insertAt, 0, null);
  return emit(rows, alignments, ctx.rowIndex, insertAt);
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export function deleteRow(model: TableModel, ctx: TableContext): EditResult {
  const { rows, alignments } = mutableFromModel(model);
  rows.splice(ctx.rowIndex, 1);
  if (rows.length === 0) return { source: "", cursorOffset: 0 };
  return emit(rows, alignments, ctx.rowIndex, ctx.colIndex);
}

export function deleteColumn(
  model: TableModel,
  ctx: TableContext,
): EditResult {
  const { rows, alignments } = mutableFromModel(model);
  for (const row of rows) row.splice(ctx.colIndex, 1);
  alignments.splice(ctx.colIndex, 1);
  if (alignments.length === 0) return { source: "", cursorOffset: 0 };
  return emit(rows, alignments, ctx.rowIndex, ctx.colIndex);
}

export function deleteTable(
  _model: TableModel,
  _ctx: TableContext,
): EditResult {
  void _model;
  void _ctx;
  return { source: "", cursorOffset: 0 };
}

// ---------------------------------------------------------------------------
// Move
// ---------------------------------------------------------------------------

function swapRows(rows: string[][], a: number, b: number): void {
  const tmp = rows[a];
  rows[a] = rows[b];
  rows[b] = tmp;
}

function swapColumns(
  rows: string[][],
  alignments: ColumnAlignment[],
  a: number,
  b: number,
): void {
  for (const row of rows) {
    const tmp = row[a];
    row[a] = row[b];
    row[b] = tmp;
  }
  const tmp = alignments[a];
  alignments[a] = alignments[b];
  alignments[b] = tmp;
}

export function moveRowUp(model: TableModel, ctx: TableContext): EditResult {
  const { rows, alignments } = mutableFromModel(model);
  swapRows(rows, ctx.rowIndex, ctx.rowIndex - 1);
  return emit(rows, alignments, ctx.rowIndex - 1, ctx.colIndex);
}

export function moveRowDown(
  model: TableModel,
  ctx: TableContext,
): EditResult {
  const { rows, alignments } = mutableFromModel(model);
  swapRows(rows, ctx.rowIndex, ctx.rowIndex + 1);
  return emit(rows, alignments, ctx.rowIndex + 1, ctx.colIndex);
}

export function moveColumnLeft(
  model: TableModel,
  ctx: TableContext,
): EditResult {
  const { rows, alignments } = mutableFromModel(model);
  swapColumns(rows, alignments, ctx.colIndex, ctx.colIndex - 1);
  return emit(rows, alignments, ctx.rowIndex, ctx.colIndex - 1);
}

export function moveColumnRight(
  model: TableModel,
  ctx: TableContext,
): EditResult {
  const { rows, alignments } = mutableFromModel(model);
  swapColumns(rows, alignments, ctx.colIndex, ctx.colIndex + 1);
  return emit(rows, alignments, ctx.rowIndex, ctx.colIndex + 1);
}

// ---------------------------------------------------------------------------
// Alignment
// ---------------------------------------------------------------------------

export function setAlignment(
  model: TableModel,
  ctx: TableContext,
  align: TableCellAlignment,
): EditResult {
  const { rows, alignments } = mutableFromModel(model);
  alignments[ctx.colIndex] = align;
  return emit(rows, alignments, ctx.rowIndex, ctx.colIndex);
}

// ---------------------------------------------------------------------------
// Action-id dispatcher
// ---------------------------------------------------------------------------

/**
 * Mirror of `isActionDisabled` from the WYSIWYG dispatcher (single
 * source of truth lives there in spirit; replicated here so this module
 * is independently testable without importing Milkdown).
 */
function isActionDisabled(id: TableActionId, ctx: TableContext): boolean {
  switch (id) {
    case "move_row_up":
      return ctx.rowIndex <= 0;
    case "move_row_down":
      return ctx.rowIndex >= ctx.rowCount - 1;
    case "move_column_left":
      return ctx.colIndex <= 0;
    case "move_column_right":
      return ctx.colIndex >= ctx.colCount - 1;
    default:
      return false;
  }
}

/**
 * Apply the matching edit for the action id. Returns null when the
 * action is disabled at the given context (out-of-range move) or
 * unrecognized.
 *
 * Mirrors `dispatchTableAction`'s M1 audit-fix gate: the dispatcher
 * does not have to check disabled-ness — `applyEdit` returns null and
 * the dispatcher treats that as "no-op".
 */
export function applyEdit(
  model: TableModel,
  ctx: TableContext,
  id: TableActionId,
): EditResult | null {
  if (isActionDisabled(id, ctx)) return null;
  switch (id) {
    case "insert_row_before":
      return insertRowBefore(model, ctx);
    case "insert_row_after":
      return insertRowAfter(model, ctx);
    case "insert_column_before":
      return insertColumnBefore(model, ctx);
    case "insert_column_after":
      return insertColumnAfter(model, ctx);
    case "move_row_up":
      return moveRowUp(model, ctx);
    case "move_row_down":
      return moveRowDown(model, ctx);
    case "move_column_left":
      return moveColumnLeft(model, ctx);
    case "move_column_right":
      return moveColumnRight(model, ctx);
    case "align_left":
      return setAlignment(model, ctx, "left");
    case "align_center":
      return setAlignment(model, ctx, "center");
    case "align_right":
      return setAlignment(model, ctx, "right");
    case "delete_row":
      return deleteRow(model, ctx);
    case "delete_column":
      return deleteColumn(model, ctx);
    case "delete_table":
      return deleteTable(model, ctx);
    default: {
      const _exhaustive: never = id;
      void _exhaustive;
      return null;
    }
  }
}
