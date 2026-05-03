/**
 * @module tableEdits/applyEdit
 * Purpose: Action-id dispatcher that maps a `TableActionId` to the
 * matching pure edit function. Mirrors `dispatchTableAction`'s M1
 * audit-fix gate — disabled actions return null so callers can
 * dispatch without checking `isActionDisabled` themselves.
 *
 * @coordinates-with src/utils/tableEdits/edits.ts
 * @coordinates-with src/plugins/milkdown/table/contextMenu.ts (parallel WYSIWYG dispatcher)
 */

import type { TableModel } from "../tableParser";
import type {
  TableActionId,
  TableContext,
} from "../../plugins/milkdown/table/types";
import {
  deleteColumn,
  deleteRow,
  deleteTable,
  insertColumnAfter,
  insertColumnBefore,
  insertRowAfter,
  insertRowBefore,
  moveColumnLeft,
  moveColumnRight,
  moveRowDown,
  moveRowUp,
  setAlignment,
  type EditResult,
} from "./edits";

/**
 * Replicated from the Phase 1 WYSIWYG dispatcher so this module is
 * independently testable without importing Milkdown. Single-source
 * candidate for L4 follow-up — the rule is simple enough that
 * duplication is currently acceptable.
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
