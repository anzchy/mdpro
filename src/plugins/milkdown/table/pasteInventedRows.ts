/**
 * @module table/pasteInventedRows
 * Purpose: Drops the empty rows the HTML parser invents for a pasted table, when
 * the paste lands in a table (D142), before preset-gfm's table paste rule sees
 * them. Milkdown's table content is `table_header_row table_row+`, so the parser
 * fills a tbody-only table with an empty header row and a header-only table with
 * an empty body row. Pasted as cells, the first became a blank row above the
 * user's rows; the second made gfm's `tablePasteRule` (which reads a table whose
 * last row has no cells as empty) swap the whole table for an empty paragraph,
 * which `replaceSelection` then pasted into the cell, splitting the host table
 * around a `<br />` paragraph and dropping the pasted values.
 *
 * Pipeline: clipboard HTML → DOM parser → `transformPasted` → Milkdown's paste
 * rules by priority: this rule (`PRIORITY`) → gfm's `tablePasteRule` (50) → the
 * plugins' `transformPasted` → `handlePaste` (`pasteAsCells`).
 *
 * Key decisions:
 *   - Only when the selection is in a table: a table pasted outside one stays a
 *     whole table and keeps its header row, which gfm's rule then repairs.
 *   - Only closed top-level tables, the ones gfm's rule reads; a table on the
 *     slice's open edge is a cut fragment, left as cut.
 *   - A row is invented when it has no cells: HTML cannot paste an empty row as
 *     content, so nothing the user copied is dropped. A table with no cell at
 *     all (`<table></table>`, `<table><tr></tr></table>`) is dropped whole: gfm's
 *     rule would turn it into an empty paragraph, which splits the host the same
 *     way. A slice left with nothing is `Slice.empty`, and the paste inserts nothing.
 *   - Logs `editor.table.paste-rows-dropped` (rule 20) when it dropped a row or
 *     a table.
 *
 * @coordinates-with src/plugins/milkdown/table/pasteCells.ts — pastes the result as cells
 * @coordinates-with src/plugins/milkdown/table/parityPlugins.ts — registration
 * @coordinates-with @milkdown/preset-gfm `tablePasteRule` — must run after this
 */
import { Fragment, type Node as PmNode, Slice } from "@milkdown/kit/prose/model";
import { isInTable } from "@milkdown/kit/prose/tables";
import { $pasteRule } from "@milkdown/kit/utils";
import { loggingService } from "../../../services/loggingService";

export const PASTE_ROWS_DROPPED_EVENT = "editor.table.paste-rows-dropped";

/** Above preset-gfm's `tablePasteRule`, which takes Milkdown's default 50. */
const PRIORITY = 100;

/** `table` without its cell-less rows; null when no row has a cell. */
function withoutEmptyRows(table: PmNode): PmNode | null {
  const rows: PmNode[] = [];
  table.forEach((row) => {
    if (row.childCount > 0) rows.push(row);
  });
  if (rows.length === 0) return null;
  return rows.length === table.childCount ? table : table.copy(Fragment.from(rows));
}

/**
 * Drop the cell-less rows of every closed top-level table in `slice`, and such a
 * table with no cell at all. Returns the same slice when nothing was dropped, and
 * the number of rows dropped (a dropped table counts its rows).
 */
export function dropInventedRows(slice: Slice): { slice: Slice; dropped: number } {
  let dropped = 0;
  let changed = false;
  const out: PmNode[] = [];
  const last = slice.content.childCount - 1;
  slice.content.forEach((node, _offset, index) => {
    // A table on an open edge is a fragment of a larger one; its rows stay as cut.
    const open = (index === 0 && slice.openStart > 0) || (index === last && slice.openEnd > 0);
    if (node.type.spec.tableRole !== "table" || open) {
      out.push(node);
      return;
    }
    const next = withoutEmptyRows(node);
    if (next !== node) changed = true;
    dropped += node.childCount - (next?.childCount ?? 0);
    if (next) out.push(next);
  });
  if (!changed) return { slice, dropped: 0 };
  if (out.length === 0) return { slice: Slice.empty, dropped };
  return { slice: new Slice(Fragment.from(out), slice.openStart, slice.openEnd), dropped };
}

export const tablePasteInventedRowsRule = $pasteRule(() => ({
  priority: PRIORITY,
  run: (slice, view, isPlainText) => {
    if (isPlainText || !isInTable(view.state)) return slice;
    const result = dropInventedRows(slice);
    if (result.slice !== slice) {
      loggingService.logEventSync({
        level: "info",
        event: PASTE_ROWS_DROPPED_EVENT,
        status: "success",
        actionId: loggingService.generateActionId(),
        context: { droppedRows: result.dropped },
      });
    }
    return result.slice;
  },
}));
