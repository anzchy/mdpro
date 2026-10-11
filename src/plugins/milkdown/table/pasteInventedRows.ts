/**
 * @module table/pasteInventedRows
 * Purpose: Completes the empty rows the HTML parser invents for a pasted or
 * dropped table, before preset-gfm's table paste rule sees them (D142, D149,
 * D150). Milkdown's table content is `table_header_row table_row+`, so the parser
 * gives a tbody-only table an empty header row and a header-only table an empty
 * body row. gfm's `tablePasteRule` reads a table whose last row has no cells as
 * empty and swaps it for an empty paragraph (the header text was lost, D149), and
 * fills an empty header row with `table_header` cells of the schema default
 * `alignment: "left"`, written `| :- |` (D150). This rule fills such a row with
 * empty cells of no alignment first, so gfm's rule leaves the table alone and a
 * table lands whole: header plus one empty body row, or an empty header row over
 * every body row (GFM needs a header row; promoting the first body row would
 * change what the user copied).
 *
 * Pipeline: clipboard HTML → DOM parser → `transformPasted` → Milkdown's paste
 * rules by priority: this rule (`PRIORITY`) → gfm's `tablePasteRule` (50) → the
 * plugins' `transformPasted` → `handlePaste`: in a table `pasteAsCells`, which
 * drops the rows filled here (`withoutInventedRows`) before it pastes cells;
 * elsewhere `replaceSelection` inserts the completed table. A drop runs the same
 * `transformPasted`, then `handleDrop`.
 *
 * Key decisions:
 *   - Target-free: the rule does not look at the selection, because on a drop
 *     the selection is not where the slice lands (b51 audit of D142). It always
 *     produces a schema-valid table; only the cell paste, which knows its target,
 *     takes the filled rows back out. A filled row is recognised by identity
 *     (`inventedRows`), never by being empty: an empty row the user copied is
 *     pasted as one.
 *   - A row is invented when it has no cells and no rowspan from a row above
 *     covers it. A covered row is real: dropping or filling it would move the
 *     rows below it (b51). Its width is the table's widest row.
 *   - Only closed top-level tables, the ones gfm's rule reads; a table on the
 *     slice's open edge is a cut fragment, left as cut.
 *   - A table with no cell at all (`<table></table>`) is dropped whole: there is
 *     no width to fill, and gfm's rule would turn it into an empty paragraph,
 *     which splits a host table. A slice left with nothing is `Slice.empty`.
 *   - Logs `editor.table.paste-rows-filled` when it filled a row and
 *     `editor.table.paste-rows-dropped` when it dropped a table (rule 20).
 *
 * @coordinates-with src/plugins/milkdown/table/pasteCells.ts — drops the filled rows from a cell paste
 * @coordinates-with src/plugins/milkdown/table/parityPlugins.ts — registration
 * @coordinates-with @milkdown/preset-gfm `tablePasteRule` — must run after this
 */
import { Fragment, type Node as PmNode, Slice } from "@milkdown/kit/prose/model";
import { $pasteRule } from "@milkdown/kit/utils";
import { loggingService } from "../../../services/loggingService";

export const PASTE_ROWS_DROPPED_EVENT = "editor.table.paste-rows-dropped";
export const PASTE_ROWS_FILLED_EVENT = "editor.table.paste-rows-filled";

/** Above preset-gfm's `tablePasteRule`, which takes Milkdown's default 50. */
const PRIORITY = 100;

/** The rows this rule filled; `withoutInventedRows` takes exactly these back out. */
const inventedRows = new WeakSet<PmNode>();

/** Each row's width (rowspans from above included), and whether a rowspan covers it. */
function rowLayout(table: PmNode): { widths: number[]; covered: boolean[] } {
  const carried: number[] = [];
  const widths: number[] = [];
  table.forEach((row, _offset, r) => {
    let width = carried[r] ?? 0;
    row.forEach((cell) => {
      const colspan = Number(cell.attrs.colspan ?? 1);
      width += colspan;
      for (let k = 1; k < Number(cell.attrs.rowspan ?? 1); k += 1) {
        carried[r + k] = (carried[r + k] ?? 0) + colspan;
      }
    });
    widths.push(width);
  });
  return { widths, covered: widths.map((_w, r) => (carried[r] ?? 0) > 0) };
}

/** `row` filled with `width` empty cells of its own cell type and no alignment. */
function filledRow(row: PmNode, width: number): PmNode | null {
  const cellType = row.type.contentMatch.defaultType;
  const cells: PmNode[] = [];
  for (let i = 0; i < width; i += 1) {
    const cell = cellType?.createAndFill({ alignment: null });
    if (!cell) return null;
    cells.push(cell);
  }
  const out = row.type.create(row.attrs, cells, row.marks);
  inventedRows.add(out);
  return out;
}

/** `table` with its invented rows filled; null when it has no cell at all. */
function completed(table: PmNode): { table: PmNode | null; filled: number } {
  const { widths, covered } = rowLayout(table);
  const width = Math.max(0, ...widths);
  if (width === 0) return { table: null, filled: 0 };
  let filled = 0;
  const rows: PmNode[] = [];
  table.forEach((row, _offset, r) => {
    const next = row.childCount === 0 && !covered[r] ? filledRow(row, width) : null;
    if (next) filled += 1;
    rows.push(next ?? row);
  });
  return { table: filled > 0 ? table.copy(Fragment.from(rows)) : table, filled };
}

/** Map every closed top-level table of `slice` through `fn` (null drops it). */
function mapClosedTables(slice: Slice, fn: (table: PmNode) => PmNode | null): Slice {
  let changed = false;
  const out: PmNode[] = [];
  const last = slice.content.childCount - 1;
  slice.content.forEach((node, _offset, index) => {
    // A table on an open edge is a fragment of a larger one; its rows stay as cut.
    const open = (index === 0 && slice.openStart > 0) || (index === last && slice.openEnd > 0);
    const next = node.type.spec.tableRole !== "table" || open ? node : fn(node);
    if (next !== node) changed = true;
    if (next) out.push(next);
  });
  if (!changed) return slice;
  if (out.length === 0) return Slice.empty;
  return new Slice(Fragment.from(out), slice.openStart, slice.openEnd);
}

/**
 * Fill the invented rows of every closed top-level table in `slice`, and drop
 * such a table with no cell at all. Returns the same slice when nothing changed,
 * with the rows filled and the rows of the tables dropped.
 */
export function completeInventedRows(slice: Slice): { slice: Slice; filled: number; dropped: number } {
  let filled = 0;
  let dropped = 0;
  const out = mapClosedTables(slice, (table) => {
    const result = completed(table);
    filled += result.filled;
    if (!result.table) dropped += table.childCount;
    return result.table;
  });
  return { slice: out, filled, dropped };
}

/**
 * `slice` without the rows `completeInventedRows` filled, for a paste into a
 * table's cells: there an invented row would overwrite a host row with blanks.
 * The table left may lack a schema-required row; it is read as cells, not inserted.
 */
export function withoutInventedRows(slice: Slice): { slice: Slice; dropped: number } {
  let dropped = 0;
  const out = mapClosedTables(slice, (table) => {
    const rows: PmNode[] = [];
    table.forEach((row) => {
      if (!inventedRows.has(row)) rows.push(row);
    });
    // A table keeps at least one real row: one with no cell was dropped, not filled.
    if (rows.length === table.childCount || rows.length === 0) return table;
    dropped += table.childCount - rows.length;
    return table.copy(Fragment.from(rows));
  });
  return { slice: out, dropped };
}

function log(event: string, context: Record<string, number>): void {
  loggingService.logEventSync({
    level: "info",
    event,
    status: "success",
    actionId: loggingService.generateActionId(),
    context,
  });
}

export const tablePasteInventedRowsRule = $pasteRule(() => ({
  priority: PRIORITY,
  run: (slice, _view, isPlainText) => {
    if (isPlainText) return slice;
    const result = completeInventedRows(slice);
    if (result.filled > 0) log(PASTE_ROWS_FILLED_EVENT, { filledRows: result.filled });
    if (result.dropped > 0) log(PASTE_ROWS_DROPPED_EVENT, { droppedRows: result.dropped });
    return result.slice;
  },
}));
