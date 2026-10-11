/**
 * @module table/insertRow
 * Purpose: The WYSIWYG table menu's "Insert row above" (and its keyboard
 * shortcut) when the target is the HEADER row (D155): a new empty header row on
 * top, and the old header's contents move down into a new first body row.
 *
 * Pipeline: `runCommandFor` (`contextMenuCommands.ts`, only when the context's
 * row is 0) → `insertRowAboveHeader` → one `replaceWith` of the header row by
 * [emptied header row, body row with the old header content] → caret into the
 * empty header cell of the selection's column → `view.dispatch` (one undo step).
 *
 * Key decisions:
 *   - preset-gfm's `addRowBeforeCommand` → `addRowWithAlignment` inserts a body
 *     `table_row` at index `rect.top`, which is 0 on the header row. Milkdown's
 *     table content is `table_header_row table_row+`, so ProseMirror closed the
 *     table before that row and the file gained an extra empty table above the
 *     original. Only a header row can come first, so "a row above the header" is
 *     done the way Typora does it: the header moves down a row.
 *   - The body cells keep each header cell's attrs (alignment, colspan,
 *     colwidth), so the column alignment the serializer reads from the header
 *     row is unchanged and the new row matches `addRowWithAlignment`, which
 *     gives every cell its column's header alignment. The emptied header cells
 *     keep their attrs too.
 *   - A header cell with `rowspan > 1` (GFM has none, the schema allows it)
 *     would span into the moved row; the action refuses (returns false, nothing
 *     dispatched, logged) rather than guess. So does a header cell whose content
 *     is not valid body-cell content (both are `paragraph+` today), rather than
 *     drop its text.
 *   - Caret: the empty header cell of the selection's left column, where the
 *     user types the new header.
 *   - Insert row above on a body row, and Insert row below anywhere, keep
 *     preset-gfm's commands; this module is never called for them.
 *
 * @coordinates-with src/plugins/milkdown/table/contextMenuCommands.ts — the caller
 * @coordinates-with src/plugins/milkdown/table/insertColumn.ts — the same pattern for Insert column (D141)
 * @coordinates-with prosemirror-tables `selectedRect` / `TableMap`
 */
import type { Node as PmNode } from "@milkdown/kit/prose/model";
import { Selection } from "@milkdown/kit/prose/state";
import { isInTable, selectedRect, TableMap } from "@milkdown/kit/prose/tables";
import type { EditorView } from "@milkdown/kit/prose/view";
import { loggingService } from "../../../services/loggingService";

const BODY_ROW = "table_row";
const BODY_CELL = "table_cell";

/**
 * Insert an empty header row above the current header and move the old header
 * content into a new first body row, as one transaction. Returns false (and
 * dispatches nothing) outside a table, when the selection does not start on the
 * header row, or when a header cell spans rows.
 */
export function insertRowAboveHeader(view: EditorView): boolean {
  const { state } = view;
  if (!isInTable(state)) return false;
  const rect = selectedRect(state);
  if (rect.top !== 0) return false;
  const { schema } = state;
  const rowType = schema.nodes[BODY_ROW];
  const cellType = schema.nodes[BODY_CELL];
  const header = rect.table.firstChild;
  if (!header || !rowType || !cellType) return false;

  const emptied: PmNode[] = [];
  const moved: PmNode[] = [];
  let spansRows = false;
  header.forEach((cell) => {
    if ((cell.attrs.rowspan ?? 1) > 1) spansRows = true;
    const empty = cell.type.createAndFill(cell.attrs);
    // Null when the header content is not valid body-cell content: refuse
    // rather than drop the header text.
    const body = cellType.createAndFill(cell.attrs, cell.content);
    if (empty) emptied.push(empty);
    if (body) moved.push(body);
  });
  if (spansRows || emptied.length !== header.childCount || moved.length !== header.childCount) {
    loggingService.logEventSync({
      level: "warn",
      event: "editor.table.insert_row_above_header",
      status: "fail",
      actionId: loggingService.generateActionId(),
      context: { reason: spansRows ? "header-rowspan" : "cell-create-failed", cells: header.childCount },
    });
    return false;
  }

  const tr = state.tr.replaceWith(rect.tableStart, rect.tableStart + header.nodeSize, [
    header.type.create(header.attrs, emptied),
    rowType.create(null, moved),
  ]);
  // The replacement keeps the table node, so it still starts at tableStart.
  const table = tr.doc.nodeAt(rect.tableStart - 1);
  if (table) {
    const map = TableMap.get(table);
    const cellPos = rect.tableStart + map.map[Math.min(rect.left, map.width - 1)];
    tr.setSelection(Selection.near(tr.doc.resolve(cellPos + 1)));
  }
  view.dispatch(tr.scrollIntoView());
  return true;
}
