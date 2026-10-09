/**
 * @module tests/support/frozenTableEdits
 * Purpose: FROZEN verbatim copy of `src/utils/tableEdits/edits.ts` and
 * `src/utils/tableEdits/applyEdit.ts` at 8bb859e, taken before D49 WI-1.2
 * made the context-menu edits widen. It is the pre-fix oracle for E-16 and
 * the law L-6: an edit on a table with no overflow must produce exactly
 * what this copy produces (`source` and `cursorOffset`).
 *
 * ---------------------------------------------------------------------
 * Frozen at 8bb859e. Never edit, never keep in sync. Its whole value is
 * being stale. If a test disagrees with this file, the source changed.
 * FROZEN-PIN (tests/table-edits-overflow.test.ts) pins that this copy
 * still TRUNCATES: reformatting T2 drops `Z`.
 * ---------------------------------------------------------------------
 *
 * Only identifiers are renamed (`frozen*`), and the doc comments are
 * trimmed. `parseTableAt`, `serializeRows` and `isActionDisabled` are
 * imported LIVE on purpose: WI-1.2 may not change any of them. This file
 * must never import `src/utils/tableEdits`, or it would compare the new
 * code against itself.
 *
 * Not a `*.test.ts`, so vitest does not collect it.
 */

import {
  parseTableAt,
  serializeRows,
  type ColumnAlignment,
  type TableModel,
} from "../../src/utils/tableParser";
import type {
  TableActionId,
  TableCellAlignment,
  TableContext,
} from "../../src/plugins/milkdown/table/types";
import { isActionDisabled } from "../../src/plugins/milkdown/table/actionGate";

export interface FrozenEditResult {
  source: string;
  cursorOffset: number;
}

// --- verbatim from edits.ts (8bb859e) --------------------------------------

function mutableFromModel(model: TableModel): {
  rows: string[][];
  alignments: ColumnAlignment[];
} {
  return {
    rows: model.rows.map((r) => r.map((c) => c.text)),
    alignments: model.alignments.slice(),
  };
}

function emit(
  rows: string[][],
  alignments: ColumnAlignment[],
  targetRow: number,
  targetCol: number,
): FrozenEditResult {
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

export function frozenInsertRowBefore(model: TableModel, ctx: TableContext): FrozenEditResult {
  const { rows, alignments } = mutableFromModel(model);
  rows.splice(ctx.rowIndex, 0, makeBlankRow(model.colCount));
  return emit(rows, alignments, ctx.rowIndex, ctx.colIndex);
}

export function frozenInsertRowAfter(model: TableModel, ctx: TableContext): FrozenEditResult {
  const { rows, alignments } = mutableFromModel(model);
  const insertAt = ctx.rowIndex + 1;
  rows.splice(insertAt, 0, makeBlankRow(model.colCount));
  return emit(rows, alignments, insertAt, ctx.colIndex);
}

export function frozenInsertColumnBefore(model: TableModel, ctx: TableContext): FrozenEditResult {
  const { rows, alignments } = mutableFromModel(model);
  for (const row of rows) row.splice(ctx.colIndex, 0, "");
  alignments.splice(ctx.colIndex, 0, null);
  return emit(rows, alignments, ctx.rowIndex, ctx.colIndex);
}

export function frozenInsertColumnAfter(model: TableModel, ctx: TableContext): FrozenEditResult {
  const { rows, alignments } = mutableFromModel(model);
  const insertAt = ctx.colIndex + 1;
  for (const row of rows) row.splice(insertAt, 0, "");
  alignments.splice(insertAt, 0, null);
  return emit(rows, alignments, ctx.rowIndex, insertAt);
}

export function frozenDeleteRow(model: TableModel, ctx: TableContext): FrozenEditResult {
  const { rows, alignments } = mutableFromModel(model);
  rows.splice(ctx.rowIndex, 1);
  if (rows.length === 0) return { source: "", cursorOffset: 0 };
  return emit(rows, alignments, ctx.rowIndex, ctx.colIndex);
}

export function frozenDeleteColumn(model: TableModel, ctx: TableContext): FrozenEditResult {
  const { rows, alignments } = mutableFromModel(model);
  for (const row of rows) row.splice(ctx.colIndex, 1);
  alignments.splice(ctx.colIndex, 1);
  if (alignments.length === 0) return { source: "", cursorOffset: 0 };
  return emit(rows, alignments, ctx.rowIndex, ctx.colIndex);
}

export function frozenDeleteTable(_model: TableModel, _ctx: TableContext): FrozenEditResult {
  void _model;
  void _ctx;
  return { source: "", cursorOffset: 0 };
}

export function frozenMoveRowUp(model: TableModel, ctx: TableContext): FrozenEditResult {
  const { rows, alignments } = mutableFromModel(model);
  swapRows(rows, ctx.rowIndex, ctx.rowIndex - 1);
  return emit(rows, alignments, ctx.rowIndex - 1, ctx.colIndex);
}

export function frozenMoveRowDown(model: TableModel, ctx: TableContext): FrozenEditResult {
  const { rows, alignments } = mutableFromModel(model);
  swapRows(rows, ctx.rowIndex, ctx.rowIndex + 1);
  return emit(rows, alignments, ctx.rowIndex + 1, ctx.colIndex);
}

export function frozenMoveColumnLeft(model: TableModel, ctx: TableContext): FrozenEditResult {
  const { rows, alignments } = mutableFromModel(model);
  swapColumns(rows, alignments, ctx.colIndex, ctx.colIndex - 1);
  return emit(rows, alignments, ctx.rowIndex, ctx.colIndex - 1);
}

export function frozenMoveColumnRight(model: TableModel, ctx: TableContext): FrozenEditResult {
  const { rows, alignments } = mutableFromModel(model);
  swapColumns(rows, alignments, ctx.colIndex, ctx.colIndex + 1);
  return emit(rows, alignments, ctx.rowIndex, ctx.colIndex + 1);
}

export function frozenReformatTable(model: TableModel, ctx: TableContext): FrozenEditResult {
  const { rows, alignments } = mutableFromModel(model);
  return emit(rows, alignments, ctx.rowIndex, ctx.colIndex);
}

export function frozenSetAlignment(
  model: TableModel,
  ctx: TableContext,
  align: TableCellAlignment,
): FrozenEditResult {
  const { rows, alignments } = mutableFromModel(model);
  alignments[ctx.colIndex] = align;
  return emit(rows, alignments, ctx.rowIndex, ctx.colIndex);
}

// --- verbatim from applyEdit.ts (8bb859e) ----------------------------------

export function frozenApplyEdit(
  model: TableModel,
  ctx: TableContext,
  id: TableActionId,
): FrozenEditResult | null {
  if (isActionDisabled(id, ctx)) return null;
  switch (id) {
    case "insert_row_before":
      return frozenInsertRowBefore(model, ctx);
    case "insert_row_after":
      return frozenInsertRowAfter(model, ctx);
    case "insert_column_before":
      return frozenInsertColumnBefore(model, ctx);
    case "insert_column_after":
      return frozenInsertColumnAfter(model, ctx);
    case "move_row_up":
      return frozenMoveRowUp(model, ctx);
    case "move_row_down":
      return frozenMoveRowDown(model, ctx);
    case "move_column_left":
      return frozenMoveColumnLeft(model, ctx);
    case "move_column_right":
      return frozenMoveColumnRight(model, ctx);
    case "align_left":
      return frozenSetAlignment(model, ctx, "left");
    case "align_center":
      return frozenSetAlignment(model, ctx, "center");
    case "align_right":
      return frozenSetAlignment(model, ctx, "right");
    case "reformat_table":
      return frozenReformatTable(model, ctx);
    case "delete_row":
      return frozenDeleteRow(model, ctx);
    case "delete_column":
      return frozenDeleteColumn(model, ctx);
    case "delete_table":
      return frozenDeleteTable(model, ctx);
    default: {
      const _exhaustive: never = id;
      void _exhaustive;
      return null;
    }
  }
}
