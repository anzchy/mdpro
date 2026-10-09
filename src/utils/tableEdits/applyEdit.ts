/**
 * @module tableEdits/applyEdit
 * Purpose: Action-id dispatcher that maps a `TableActionId` to the
 * matching pure edit function. Mirrors `dispatchTableAction`'s M1
 * audit-fix gate — disabled actions return null so callers can
 * dispatch without checking `isActionDisabled` themselves.
 *
 * Logging (D49 WI-1.3, rule 20): when an edit rewrote a table whose body
 * rows overflow the header (`EditResult.widened`), logs one
 * `editor.table.edit-widened` entry (info, success) with
 * `{ action, fromColCount, toColCount }` — counts only, never cell text.
 * Nothing is logged for a disabled action, for `delete_table`, or for a
 * table with no overflow. The edits in `edits.ts` stay pure; this
 * dispatcher is the one place that holds the action id, shared by the
 * source context menu and the MCP table dispatcher.
 *
 * @coordinates-with src/utils/tableEdits/edits.ts
 * @coordinates-with src/utils/tableFormatter.ts (`editor.table.format-widened`, same counts)
 * @coordinates-with src/plugins/milkdown/table/contextMenu.ts (parallel WYSIWYG dispatcher)
 */

import type { TableModel } from "../tableParser";
import type {
  TableActionId,
  TableContext,
} from "../../plugins/milkdown/table/types";
import { isActionDisabled } from "../../plugins/milkdown/table/actionGate";
import { loggingService } from "../../services/loggingService";
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
  reformatTable,
  setAlignment,
  type EditResult,
} from "./edits";

/**
 * Apply the matching edit for the action id. Returns null when the
 * action is disabled at the given context (out-of-range move) or
 * unrecognized. Logs `editor.table.edit-widened` once when the result
 * reports that the table widened.
 */
export function applyEdit(
  model: TableModel,
  ctx: TableContext,
  id: TableActionId,
): EditResult | null {
  if (isActionDisabled(id, ctx)) return null;
  const result = runEdit(model, ctx, id);
  if (result?.widened) {
    loggingService.logEventSync({
      level: "info",
      event: "editor.table.edit-widened",
      status: "success",
      context: {
        action: id,
        fromColCount: result.widened.fromColCount,
        toColCount: result.widened.toColCount,
      },
    });
  }
  return result;
}

function runEdit(
  model: TableModel,
  ctx: TableContext,
  id: TableActionId,
): EditResult | null {
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
    case "reformat_table":
      return reformatTable(model, ctx);
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
