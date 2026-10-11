/**
 * @module table/pasteCells
 * Purpose: Pastes a slice into a table as cells — prosemirror-tables' own
 * `handlePaste`, with each pasted row given the cell type of the host row it
 * lands in (D142). Milkdown's table has a `table_header_row` of `table_header`
 * cells and `table_row`s of `table_cell`s; prosemirror-tables puts pasted cells
 * in the host as they came, so a header cell landing in a body row (or a body
 * cell in the header row) made `insertCells`' row replace fit the cells by
 * closing the row: the host's rows were mangled, and `insertCells`' closing
 * `TableMap.positionAt` threw out of the paste listener, so the native paste was
 * not prevented.
 *
 * Pipeline: paste → `pasteWidenAlignment.ts`'s front `handlePaste` → `pasteAsCells`:
 * `pastedCells` → over a CellSelection `clipCells` to the selection, else at the
 * caret's cell → `retypeRows` → prosemirror-tables' `insertCells` → `dispatch`.
 *
 * Key decisions:
 *   - Rows are retyped after `clipCells`, per target row, because a CellSelection
 *     paste repeats the pasted rows: the same pasted row can land in the header
 *     row and in a body row. A row past the host's end lands in a row `growTable`
 *     adds, a body row (`tableNodeTypes(schema).row`).
 *   - A retyped cell keeps its pasted attrs (alignment included), as a same-type
 *     paste already did: the pasted cell replaces the host cell.
 *   - Plain content over a CellSelection is fitted into one cell, as
 *     prosemirror-tables does, but each copy takes its column's header alignment:
 *     the schema default `left` would otherwise write `:-` into the header row's
 *     delimiter (D135's rule for added rows).
 *   - Logs `editor.table.paste-retyped` (rule 20) only when a cell was retyped,
 *     after `insertCells` returned; a paste that needed none logs nothing here.
 *
 * @coordinates-with src/plugins/milkdown/table/pasteWidenAlignment.ts — the caller, and its dispatch wrapper
 * @coordinates-with src/plugins/milkdown/table/pasteInventedRows.ts — drops the parser's invented rows before this
 * @coordinates-with prosemirror-tables `handlePaste` / `pastedCells` / `clipCells` / `insertCells`
 */
import { Fragment, type Node as PmNode, type NodeType, type Slice } from "@milkdown/kit/prose/model";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import {
  __clipCells,
  __insertCells,
  __pastedCells,
  CellSelection,
  isInTable,
  type Rect,
  selectionCell,
  TableMap,
  tableNodeTypes,
} from "@milkdown/kit/prose/tables";
import { Transform } from "@milkdown/kit/prose/transform";
import { loggingService } from "../../../services/loggingService";

export const PASTE_RETYPED_EVENT = "editor.table.paste-retyped";

type Cells = NonNullable<ReturnType<typeof __pastedCells>>;

/** The row type of host row `index`; a row past the end is one `growTable` adds. */
function targetRowType(table: PmNode, index: number): NodeType {
  return index < table.childCount ? table.child(index).type : tableNodeTypes(table.type.schema).row;
}

/** Give each row of `cells`, landing at host row `top + i`, that row's cell type. */
function retypeRows(cells: Cells, table: PmNode, top: number): { cells: Cells; retyped: number } {
  let retyped = 0;
  const rows = cells.rows.map((row, i) => {
    const cellType = targetRowType(table, top + i).contentMatch.defaultType;
    if (!cellType) return row;
    const out: PmNode[] = [];
    row.forEach((cell) => {
      if (cell.type === cellType) out.push(cell);
      else {
        out.push(cellType.create(cell.attrs, cell.content, cell.marks));
        retyped += 1;
      }
    });
    return Fragment.from(out);
  });
  return { cells: { ...cells, rows }, retyped };
}

/**
 * Plain content fitted into one cell per selected column, each with its column's
 * header alignment (so the header row keeps its delimiter).
 */
function fittedCells(state: EditorState, slice: Slice, table: PmNode, left: number, width: number): Cells {
  const cellType = tableNodeTypes(state.schema).cell;
  const map = TableMap.get(table);
  const row: PmNode[] = [];
  for (let col = left; col < left + width; col += 1) {
    const alignment: unknown = table.nodeAt(map.map[col])?.attrs.alignment ?? null;
    const empty = cellType.createAndFill({ alignment });
    if (empty) row.push(new Transform(empty).replace(0, empty.content.size, slice).doc);
  }
  return { width: row.length, height: 1, rows: [Fragment.from(row)] };
}

/**
 * Paste `slice` as cells, like prosemirror-tables' `handlePaste`, with each row
 * retyped for the host row it lands in. Returns false, dispatching nothing, when
 * the selection is not in a table, or is not a CellSelection and the slice is not
 * cells or rows.
 */
export function pasteAsCells(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  slice: Slice,
): boolean {
  if (!isInTable(state)) return false;
  const pasted = __pastedCells(slice);
  const sel = state.selection;
  let start: number;
  let table: PmNode;
  let rect: Rect;
  let cells: Cells;
  if (sel instanceof CellSelection) {
    table = sel.$anchorCell.node(-1);
    start = sel.$anchorCell.start(-1);
    rect = TableMap.get(table).rectBetween(sel.$anchorCell.pos - start, sel.$headCell.pos - start);
    const width = rect.right - rect.left;
    cells = __clipCells(pasted ?? fittedCells(state, slice, table, rect.left, width), width, rect.bottom - rect.top);
  } else {
    if (!pasted) return false;
    const $cell = selectionCell(state);
    table = $cell.node(-1);
    start = $cell.start(-1);
    rect = TableMap.get(table).findCell($cell.pos - start);
    cells = pasted;
  }
  const typed = retypeRows(cells, table, rect.top);
  __insertCells(state, dispatch, start, rect, typed.cells);
  if (typed.retyped > 0) {
    loggingService.logEventSync({
      level: "info",
      event: PASTE_RETYPED_EVENT,
      status: "success",
      actionId: loggingService.generateActionId(),
      context: { retyped: typed.retyped, rows: typed.cells.height, cols: typed.cells.width },
    });
  }
  return true;
}
