/**
 * @module tableEdits/edits
 * Purpose: 14 pure source-mode table edits (Phase 2 WI-2.4). Each
 * function takes a parsed `TableModel` plus a `TableContext` and
 * returns the new source for the table region plus a cursor offset
 * within that source.
 *
 * Strategy: build a mutable `string[][]` from the model, WIDENED to its
 * widest row by `widenTable` (D49), apply the structural mutation,
 * serialize via `serializeRows`, then re-parse to read the cursor target
 * cell's offset. Re-parsing is cheap and avoids reinventing offset
 * arithmetic for every action.
 *
 * Widening: body cells past the header's column count ("overflow") are
 * kept, exactly as format on save keeps them (ADR-0052, whose "formatter
 * only" clause is superseded by ADR-0063: edits widen like format-on-save).
 * Every row is the widened width `W = alignments.length`, so an inserted
 * blank row has `W` cells and `deleteColumn` empties the table only when
 * the WIDENED width reaches 0 (a 1-column header with overflow keeps a
 * table). `ctx.colIndex` is header-width (the menu builds it from
 * `model.colCount`), which indexes the same column in the widened table.
 * A table with no overflow edits byte-identically to before.
 *
 * Every edit built from a widened table reports it in
 * `EditResult.widened` (`fromColCount` = header width, `toColCount` = the
 * widened width BEFORE the edit's own column insert/delete), so
 * `applyEdit` can log `editor.table.edit-widened` without a second
 * `widenTable` pass. The edits themselves stay free of I/O.
 *
 * The action-id dispatcher (`applyEdit`) lives in `applyEdit.ts` so
 * this file stays focused on the per-action math.
 *
 * @coordinates-with src/utils/tableEdits/applyEdit.ts
 * @coordinates-with src/utils/tableWiden.ts (widenTable, shared with tableFormatter.ts)
 * @coordinates-with src/plugins/codemirror/sourceTableContextMenu.ts
 */

import {
  parseTableAt,
  serializeRows,
  type ColumnAlignment,
  type TableModel,
} from "../tableParser";
import { widenTable, type WidenedTable } from "../tableWiden";
import type {
  TableCellAlignment,
  TableContext,
} from "../../plugins/milkdown/table/types";

export interface EditResult {
  /** New text for the source range `[model.start, model.end)`. */
  source: string;
  /** Cursor offset relative to the start of `source`. */
  cursorOffset: number;
  /**
   * Present only when the table widened (D49 WI-1.3): header width and the
   * widened width before the edit's own structural mutation. Counts only,
   * never cell text.
   */
  widened?: TableWidening;
}

/** Header width → widened width of a table whose body rows overflow. */
export interface TableWidening {
  fromColCount: number;
  toColCount: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface MutableTable extends WidenedTable {
  /** Set when the table widened; carried onto every result. */
  widened?: TableWidening;
}

/**
 * Fresh, rectangular cell texts and alignments for `model`, widened to its
 * widest row. The table widened when `alignments.length > model.colCount`;
 * the counts are captured here, before any structural mutation.
 */
function mutableFromModel(model: TableModel): MutableTable {
  const table: MutableTable = widenTable(model);
  if (table.alignments.length > model.colCount) {
    table.widened = {
      fromColCount: model.colCount,
      toColCount: table.alignments.length,
    };
  }
  return table;
}

/** Attach the widening (if any) to a result. */
function withWidened(result: EditResult, widened?: TableWidening): EditResult {
  return widened ? { ...result, widened } : result;
}

function emit(
  rows: string[][],
  alignments: ColumnAlignment[],
  targetRow: number,
  targetCol: number,
  widened?: TableWidening,
): EditResult {
  if (rows.length === 0 || alignments.length === 0) {
    return withWidened({ source: "", cursorOffset: 0 }, widened);
  }
  const source = serializeRows(rows, alignments);
  const reParsed = parseTableAt(source, 0);
  if (!reParsed) return withWidened({ source, cursorOffset: 0 }, widened);
  const clampedRow = Math.max(0, Math.min(targetRow, reParsed.rowCount - 1));
  const clampedCol = Math.max(0, Math.min(targetCol, reParsed.colCount - 1));
  const cursorOffset = reParsed.rows[clampedRow][clampedCol].start;
  return withWidened({ source, cursorOffset }, widened);
}

function makeBlankRow(colCount: number): string[] {
  return new Array(colCount).fill("");
}

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

// ---------------------------------------------------------------------------
// Insert
// ---------------------------------------------------------------------------

export function insertRowBefore(
  model: TableModel,
  ctx: TableContext,
): EditResult {
  const { rows, alignments, widened } = mutableFromModel(model);
  rows.splice(ctx.rowIndex, 0, makeBlankRow(alignments.length));
  return emit(rows, alignments, ctx.rowIndex, ctx.colIndex, widened);
}

export function insertRowAfter(
  model: TableModel,
  ctx: TableContext,
): EditResult {
  const { rows, alignments, widened } = mutableFromModel(model);
  // GFM has no "above the header" semantic — when rowIndex is 0 (header),
  // "after" means row index 1 (first body). For body rows, insert at
  // rowIndex + 1.
  const insertAt = ctx.rowIndex + 1;
  rows.splice(insertAt, 0, makeBlankRow(alignments.length));
  return emit(rows, alignments, insertAt, ctx.colIndex, widened);
}

export function insertColumnBefore(
  model: TableModel,
  ctx: TableContext,
): EditResult {
  const { rows, alignments, widened } = mutableFromModel(model);
  for (const row of rows) row.splice(ctx.colIndex, 0, "");
  alignments.splice(ctx.colIndex, 0, null);
  return emit(rows, alignments, ctx.rowIndex, ctx.colIndex, widened);
}

export function insertColumnAfter(
  model: TableModel,
  ctx: TableContext,
): EditResult {
  const { rows, alignments, widened } = mutableFromModel(model);
  const insertAt = ctx.colIndex + 1;
  for (const row of rows) row.splice(insertAt, 0, "");
  alignments.splice(insertAt, 0, null);
  return emit(rows, alignments, ctx.rowIndex, insertAt, widened);
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export function deleteRow(model: TableModel, ctx: TableContext): EditResult {
  const { rows, alignments, widened } = mutableFromModel(model);
  rows.splice(ctx.rowIndex, 1);
  if (rows.length === 0) return { source: "", cursorOffset: 0 };
  return emit(rows, alignments, ctx.rowIndex, ctx.colIndex, widened);
}

export function deleteColumn(
  model: TableModel,
  ctx: TableContext,
): EditResult {
  const { rows, alignments, widened } = mutableFromModel(model);
  for (const row of rows) row.splice(ctx.colIndex, 1);
  alignments.splice(ctx.colIndex, 1);
  // The widened width, not the header's: overflow keeps the table (D49).
  if (alignments.length === 0) return { source: "", cursorOffset: 0 };
  return emit(rows, alignments, ctx.rowIndex, ctx.colIndex, widened);
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

export function moveRowUp(model: TableModel, ctx: TableContext): EditResult {
  const { rows, alignments, widened } = mutableFromModel(model);
  swapRows(rows, ctx.rowIndex, ctx.rowIndex - 1);
  return emit(rows, alignments, ctx.rowIndex - 1, ctx.colIndex, widened);
}

export function moveRowDown(
  model: TableModel,
  ctx: TableContext,
): EditResult {
  const { rows, alignments, widened } = mutableFromModel(model);
  swapRows(rows, ctx.rowIndex, ctx.rowIndex + 1);
  return emit(rows, alignments, ctx.rowIndex + 1, ctx.colIndex, widened);
}

export function moveColumnLeft(
  model: TableModel,
  ctx: TableContext,
): EditResult {
  const { rows, alignments, widened } = mutableFromModel(model);
  swapColumns(rows, alignments, ctx.colIndex, ctx.colIndex - 1);
  return emit(rows, alignments, ctx.rowIndex, ctx.colIndex - 1, widened);
}

export function moveColumnRight(
  model: TableModel,
  ctx: TableContext,
): EditResult {
  const { rows, alignments, widened } = mutableFromModel(model);
  swapColumns(rows, alignments, ctx.colIndex, ctx.colIndex + 1);
  return emit(rows, alignments, ctx.rowIndex, ctx.colIndex + 1, widened);
}

// ---------------------------------------------------------------------------
// Format (Phase 3 WI-3.2)
// ---------------------------------------------------------------------------

/**
 * Re-emit the table with column-aligned padding. Round-trips with
 * `parseTableAt` so the cursor target after format lands on the same
 * cell. Output is the widened cell text re-serialized via
 * `serializeRows`, byte-identical to `tableFormatter.formatTable(model)`
 * (both go through `widenTable`; pinned by D49 law L-5).
 */
export function reformatTable(
  model: TableModel,
  ctx: TableContext,
): EditResult {
  const { rows, alignments, widened } = mutableFromModel(model);
  return emit(rows, alignments, ctx.rowIndex, ctx.colIndex, widened);
}

// ---------------------------------------------------------------------------
// Alignment
// ---------------------------------------------------------------------------

export function setAlignment(
  model: TableModel,
  ctx: TableContext,
  align: TableCellAlignment,
): EditResult {
  const { rows, alignments, widened } = mutableFromModel(model);
  alignments[ctx.colIndex] = align;
  return emit(rows, alignments, ctx.rowIndex, ctx.colIndex, widened);
}
