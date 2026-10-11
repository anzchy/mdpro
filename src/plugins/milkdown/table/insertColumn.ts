/**
 * @module table/insertColumn
 * Purpose: The WYSIWYG table menu's "Insert column left / right" (and their
 * keyboard shortcuts): prosemirror-tables' `addColumn`, with every cell of the
 * inserted column set to `alignment: null` in the same transaction (D141).
 *
 * Pipeline: `runCommandFor` (`contextMenuCommands.ts`) → `insertUnalignedColumn`
 * → `selectedRect` + `addColumn` on one transaction → reset the new column's
 * cells → `view.dispatch` (one undo step).
 *
 * Key decisions:
 *   - preset-gfm's `addColBeforeCommand` / `addColAfterCommand` are
 *     prosemirror-tables' `addColumnBefore` / `addColumnAfter`, which fill the
 *     column with `createAndFill()`: the schema default `alignment: "left"`. The
 *     serializer reads column alignment from the header row, so one menu action
 *     wrote `| -- | -- | :- |`. `null` matches MCP `add_column`
 *     (`src/utils/tableEdits/edits.ts`), which inserts an unaligned column.
 *   - Narrowest point: only this menu action changes. The schema default stays
 *     `left` (D99 keeps it for Insert Table), and `addColumn` itself still picks
 *     the cell types (header row → `table_header`), so only `alignment` differs
 *     from the preset command.
 *   - A cell is "inserted" when it occupies exactly the new column. A spanning
 *     cell `addColumn` widened instead (GFM has none, but the schema allows it)
 *     keeps its alignment.
 *   - Rows are not touched: preset-gfm's `addRowWithAlignment` already copies
 *     each column's header alignment, so Insert row leaves the delimiter row as is.
 *
 * @coordinates-with src/plugins/milkdown/table/contextMenuCommands.ts — the caller
 * @coordinates-with src/plugins/milkdown/table/pasteWidenAlignment.ts — the same reset for a widening paste (D135)
 * @coordinates-with prosemirror-tables `addColumn` / `selectedRect`
 */
import type { EditorView } from "@milkdown/kit/prose/view";
import { addColumn, isInTable, selectedRect, TableMap } from "@milkdown/kit/prose/tables";

export type InsertColumnSide = "before" | "after";

/**
 * Insert an unaligned column before or after the selection's column(s), as one
 * transaction. Returns false (and dispatches nothing) outside a table.
 */
export function insertUnalignedColumn(view: EditorView, side: InsertColumnSide): boolean {
  const { state } = view;
  if (!isInTable(state)) return false;
  const rect = selectedRect(state);
  const col = side === "before" ? rect.left : rect.right;
  const tr = addColumn(state.tr, rect, col);
  // addColumn edits only inside the table, so the table still starts at tableStart.
  const table = tr.doc.nodeAt(rect.tableStart - 1);
  if (table) {
    const map = TableMap.get(table);
    const column = { left: col, right: col + 1, top: 0, bottom: map.height };
    for (const offset of map.cellsInRect(column)) {
      const cellRect = map.findCell(offset);
      if (cellRect.left !== col || cellRect.right !== col + 1) continue;
      const cell = table.nodeAt(offset);
      if (!cell || cell.attrs.alignment === null) continue;
      tr.setNodeMarkup(rect.tableStart + offset, null, { ...cell.attrs, alignment: null });
    }
  }
  view.dispatch(tr);
  return true;
}
