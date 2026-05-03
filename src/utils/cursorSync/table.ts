/**
 * @module cursorSync/table
 * Purpose: Cross-mode table cursor sync (Phase 2 WI-2.6). When the user
 * toggles between source and WYSIWYG, place the cursor in the same
 * cell on the inbound editor. Disambiguates docs with multiple tables
 * by carrying a `tableIndex` (0-based document order) alongside the
 * row/column.
 *
 * Pure helpers (source-side) live here. ProseMirror-side capture and
 * restore live in `cursorSync/tableMilkdown.ts` so this module remains
 * unit-testable without an editor.
 *
 * Capture slot is module-level: `setPendingTableCell` writes;
 * `consumePendingTableCell` reads and clears (called from the inbound
 * editor's mount path). Tests reset with `setPendingTableCell(null)`.
 *
 * @coordinates-with src/stores/editorStore.ts (capture on transition)
 * @coordinates-with src/components/Editor/Editor.tsx (source restore)
 * @coordinates-with src/components/Editor/MilkdownEditor.tsx (WYSIWYG restore)
 * @coordinates-with src/utils/cursorSync/tableMilkdown.ts
 */

import {
  findCell,
  parseTableAt,
  type TableModel,
} from "../tableParser";

export interface TableCellPos {
  /** 0-based index of the table within the document (doc order). */
  tableIndex: number;
  /** 0-based row in the model (header = 0; delimiter is not a row). */
  rowIndex: number;
  /** 0-based column. */
  colIndex: number;
}

// ---------------------------------------------------------------------------
// Pure source-side helpers
// ---------------------------------------------------------------------------

/**
 * Walk the source linearly and return every GFM table in document
 * order. O(doc) — only called at mode-toggle time, never on the
 * keystroke hot path.
 *
 * Advancement after a yielded table must clear the line that
 * `parseTableAt`'s `findLineIndex` would still attribute to the table
 * via its boundary-fudge (the `<= line.end + 1` check that maps a
 * trailing `\n` back to the line above). Walking past the FIRST
 * newline after `model.end` guarantees the next probe sits on the
 * next real line.
 */
export function findAllTables(source: string): TableModel[] {
  const out: TableModel[] = [];
  let pos = 0;
  while (pos <= source.length) {
    const model = parseTableAt(source, pos);
    if (model) {
      out.push(model);
      const nextLine = source.indexOf("\n", model.end + 1);
      pos = nextLine === -1 ? source.length + 1 : nextLine + 1;
      continue;
    }
    const newline = source.indexOf("\n", pos);
    pos = newline === -1 ? source.length + 1 : newline + 1;
  }
  return out;
}

/**
 * Capture the cell at the given source offset. Returns null when the
 * offset is outside any table or sits in a non-cell region (delimiter
 * row, between cells).
 */
export function captureCellFromSource(
  source: string,
  offset: number,
): TableCellPos | null {
  const tables = findAllTables(source);
  for (let i = 0; i < tables.length; i += 1) {
    const table = tables[i];
    if (offset < table.start || offset > table.end) continue;
    const cell = findCell(table, offset);
    if (!cell) return null;
    return { tableIndex: i, rowIndex: cell.row, colIndex: cell.col };
  }
  return null;
}

/**
 * Reverse of `captureCellFromSource`: locate the cursor offset for the
 * cell at (tableIndex, rowIndex, colIndex) within `source`. Returns
 * null when the table or cell is out of range (e.g., after a
 * mode-side edit shrunk the table).
 */
export function locateCellInSource(
  source: string,
  pos: TableCellPos,
): number | null {
  const tables = findAllTables(source);
  const table = tables[pos.tableIndex];
  if (!table) return null;
  const row = table.rows[pos.rowIndex];
  if (!row) return null;
  const cell = row[pos.colIndex];
  if (!cell) return null;
  return cell.start;
}

// ---------------------------------------------------------------------------
// Pending-cell slot (module-level singleton)
// ---------------------------------------------------------------------------

let pendingCapture: TableCellPos | null = null;

/** Set or clear the pending cell. Pass null to clear (used by tests). */
export function setPendingTableCell(pos: TableCellPos | null): void {
  pendingCapture = pos;
}

/** Read without consuming. Useful for diagnostics. */
export function getPendingTableCell(): TableCellPos | null {
  return pendingCapture;
}

/** Read and clear. The inbound editor calls this exactly once. */
export function consumePendingTableCell(): TableCellPos | null {
  const value = pendingCapture;
  pendingCapture = null;
  return value;
}
