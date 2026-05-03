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
 * Predicate that returns true when the given source offset sits
 * inside a fenced code block (` ``` ` / ` ~~~ `). Callers in source
 * mode pass `(pos) => isPositionInFencedCode(state, pos)`; tests can
 * pass a synthetic predicate or omit (defaults to "never fenced").
 *
 * Audit-fix H1/H2 (2026-05-03): without this guard, pipe-shaped lines
 * inside a fence are enumerated by `findAllTables`, which makes
 * `tableIndex` drift relative to Milkdown's `descendants` walk
 * (Milkdown never yields `table` nodes inside fenced code). Source
 * and WYSIWYG must enumerate the same tables in the same order or
 * the cross-mode cursor sync lands in the wrong one.
 */
export type IsFenced = (offset: number) => boolean;

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
 *
 * When `isFenced` is supplied, tables whose start offset sits inside
 * a fenced code block are skipped — see `IsFenced` for rationale.
 */
export function findAllTables(
  source: string,
  isFenced?: IsFenced,
): TableModel[] {
  const out: TableModel[] = [];
  let pos = 0;
  while (pos <= source.length) {
    const model = parseTableAt(source, pos);
    if (model) {
      if (!isFenced || !isFenced(model.start)) {
        out.push(model);
      }
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
 * offset is outside any table, sits in a non-cell region (delimiter
 * row, between cells), or sits inside a fenced code block.
 */
export function captureCellFromSource(
  source: string,
  offset: number,
  isFenced?: IsFenced,
): TableCellPos | null {
  if (isFenced && isFenced(offset)) return null;
  const tables = findAllTables(source, isFenced);
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
 *
 * Pass the SAME `isFenced` predicate that was used at capture time so
 * `tableIndex` stays consistent across the round-trip.
 */
export function locateCellInSource(
  source: string,
  pos: TableCellPos,
  isFenced?: IsFenced,
): number | null {
  const tables = findAllTables(source, isFenced);
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

/**
 * Audit-fix M1/M2 (2026-05-03): pair the captured cell with the
 * `documentId` it was captured from so a doc-switch between transition
 * and inbound-editor mount can't apply stale coordinates to a
 * different document. Editor.tsx's `onCreateEditor` and
 * MilkdownEditor's loaded effect both consume the slot — without
 * this, any non-toggle remount (e.g., document switch) consumes the
 * pending capture and silently restores a doomed offset.
 */
export interface PendingTableCapture {
  documentId: string;
  pos: TableCellPos;
}

let pendingCapture: PendingTableCapture | null = null;

/** Set or clear the pending cell. Pass null to clear (used by tests). */
export function setPendingTableCell(value: PendingTableCapture | null): void {
  pendingCapture = value;
}

/** Read without consuming. Useful for diagnostics and tests. */
export function getPendingTableCell(): PendingTableCapture | null {
  return pendingCapture;
}

/**
 * Read and clear when the document matches. If the slot is empty OR
 * the captured documentId differs from `forDocumentId`, return null
 * AND clear the slot (so a stale capture doesn't survive a doc
 * switch).
 *
 * Pass `forDocumentId === null` only from tests where document
 * identity is irrelevant; in that case any capture is consumed.
 */
export function consumePendingTableCell(
  forDocumentId: string | null,
): TableCellPos | null {
  const value = pendingCapture;
  pendingCapture = null;
  if (!value) return null;
  if (forDocumentId === null) return value.pos;
  if (value.documentId !== forDocumentId) return null;
  return value.pos;
}
