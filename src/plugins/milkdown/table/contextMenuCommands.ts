/**
 * @module table/contextMenuCommands
 * Purpose: Maps one WYSIWYG table-menu action to the Milkdown command(s)
 * that perform it. Called by `dispatchTableAction` after the action has
 * passed the fresh-context gate.
 *
 * Key decisions:
 *   - D65: preset-gfm's select commands return `Boolean(dispatch?.(tr))`,
 *     and `view.dispatch` returns undefined, so they report false even
 *     when the selection moved. Delete therefore ignores that return and
 *     checks that the live selection became a `CellSelection` before it
 *     deletes (the H4 intent: never delete the user's text selection).
 *   - D78: alignment is a column property — the serializer reads it from
 *     the header row. `setAlignCommand` (prosemirror-tables
 *     `setCellAttr`) changes only the caret's cell, and with a column
 *     selection it skips the whole column when the selection's last cell
 *     already has the value. Align writes every cell of the column itself.
 *   - D141: Insert column does not use preset-gfm's `addColBeforeCommand` /
 *     `addColAfterCommand`, whose cells take the schema default `left` and
 *     serialize as `:-`. `insertUnalignedColumn` inserts the column unaligned,
 *     as MCP `add_column` does. Insert row keeps preset-gfm's commands, which
 *     copy each column's header alignment.
 *
 * @coordinates-with src/plugins/milkdown/table/contextMenu.ts
 * @coordinates-with src/plugins/milkdown/table/insertColumn.ts
 */

import {
  addRowAfterCommand,
  addRowBeforeCommand,
  deleteSelectedCellsCommand,
  moveColCommand,
  moveRowCommand,
  selectColCommand,
  selectRowCommand,
  selectTableCommand,
} from "@milkdown/kit/preset/gfm";
import type { EditorView } from "@milkdown/kit/prose/view";
import { CellSelection, findTable, TableMap } from "@milkdown/kit/prose/tables";
import type { TableActionId, TableContext } from "./actionDescriptors";
import { insertUnalignedColumn } from "./insertColumn";

export interface CommandsLike {
  call: (key: unknown, payload?: unknown) => boolean;
}

type ColumnAlignment = "left" | "center" | "right";

/** Run the select command, then delete only if a cell selection resulted. */
function selectThenDelete(
  commands: CommandsLike,
  view: EditorView,
  selectKey: unknown,
  payload?: unknown,
): boolean {
  commands.call(selectKey, payload);
  if (!(view.state.selection instanceof CellSelection)) return false;
  return commands.call(deleteSelectedCellsCommand.key);
}

/**
 * Set `alignment` on every cell in column `colIndex` of the table holding
 * the selection, header included. Returns false only outside a table;
 * a column that already has the value is a successful no-op.
 */
function alignColumn(view: EditorView, colIndex: number, value: ColumnAlignment): boolean {
  const { state } = view;
  const table = findTable(state.selection.$from);
  if (!table) return false;
  const map = TableMap.get(table.node);
  if (colIndex < 0 || colIndex >= map.width) return false;
  const tr = state.tr;
  const cells = map.cellsInRect({ left: colIndex, right: colIndex + 1, top: 0, bottom: map.height });
  for (const rel of cells) {
    const pos = table.start + rel;
    const cell = state.doc.nodeAt(pos);
    if (cell && cell.attrs.alignment !== value) {
      tr.setNodeMarkup(pos, null, { ...cell.attrs, alignment: value });
    }
  }
  if (tr.docChanged) view.dispatch(tr);
  return true;
}

export function runCommandFor(
  id: TableActionId,
  commands: CommandsLike,
  view: EditorView,
  ctx: TableContext,
): boolean {
  switch (id) {
    case "insert_row_before":
      return commands.call(addRowBeforeCommand.key);
    case "insert_row_after":
      return commands.call(addRowAfterCommand.key);
    case "insert_column_before":
      return insertUnalignedColumn(view, "before");
    case "insert_column_after":
      return insertUnalignedColumn(view, "after");

    case "move_row_up":
      return commands.call(moveRowCommand.key, {
        from: ctx.rowIndex,
        to: ctx.rowIndex - 1,
      });
    case "move_row_down":
      return commands.call(moveRowCommand.key, {
        from: ctx.rowIndex,
        to: ctx.rowIndex + 1,
      });
    case "move_column_left":
      return commands.call(moveColCommand.key, {
        from: ctx.colIndex,
        to: ctx.colIndex - 1,
      });
    case "move_column_right":
      return commands.call(moveColCommand.key, {
        from: ctx.colIndex,
        to: ctx.colIndex + 1,
      });

    case "align_left":
      return alignColumn(view, ctx.colIndex, "left");
    case "align_center":
      return alignColumn(view, ctx.colIndex, "center");
    case "align_right":
      return alignColumn(view, ctx.colIndex, "right");

    case "reformat_table":
      // Phase 3 WI-3.2: in WYSIWYG, "Reformat table" is a visible no-op.
      // Milkdown's GFM serializer emits compact (unpadded) markdown on
      // every keystroke via the listener; padding our way and writing
      // back would be undone the moment the user types. The action is
      // kept in the descriptor catalog for menu parity — source mode
      // does the real work via tableEdits.applyEdit.
      return false;

    case "delete_row":
      return selectThenDelete(commands, view, selectRowCommand.key, { index: ctx.rowIndex });
    case "delete_column":
      return selectThenDelete(commands, view, selectColCommand.key, { index: ctx.colIndex });
    case "delete_table":
      return selectThenDelete(commands, view, selectTableCommand.key);

    default: {
      // Exhaustiveness check — TS will error if a new TableActionId is
      // added without a case here.
      const _exhaustive: never = id;
      void _exhaustive;
      return false;
    }
  }
}
