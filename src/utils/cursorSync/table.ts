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
 * Each source-side helper comes in two forms (Phase 4 WI-3B): a `…FromSource`
 * / `…InSource` string entry point, and a `…FromLines` / `…InLines` twin over
 * a bare `TableLineSource`. The string form IS the line form over
 * `linesFromString` — one algorithm, two adapters. The CodeMirror callers use
 * the line form over the editor's rope, so the mode-toggle capture and
 * restore paths never copy the document into a string. This module still
 * imports nothing from `@codemirror/state`.
 *
 * Capture slot is module-level: `setPendingTableCell` writes;
 * `consumePendingTableCell` reads and clears (called from the inbound
 * editor's mount path). Tests reset with `setPendingTableCell(null)`.
 *
 * @coordinates-with src/stores/editorStore.ts (capture on transition)
 * @coordinates-with src/components/Editor/Editor.tsx (source restore)
 * @coordinates-with src/components/Editor/MilkdownEditor.tsx (WYSIWYG restore)
 * @coordinates-with src/utils/cursorSync/tableMilkdown.ts
 * @coordinates-with src/utils/tableParser/scan.ts (findAllTables delegates)
 */

import {
  findCell,
  type TableModel,
} from "../tableParser";
import {
  linesFromString,
  type TableLineSource,
} from "../tableParser/lines";
import { scanTables } from "../tableParser/scan";
import type { IsFenced } from "../tableParser/types";

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
 * Fence predicate. Defined in `tableParser/types.ts` since WI-3 so the
 * pure scanner can name it without importing this module; re-exported
 * here because that is the import path the rest of the app already uses
 * (`tableFormatter.ts`, the CodeMirror plugins). See the type's own doc
 * comment for the `tableIndex`-drift rationale.
 */
export type { IsFenced };

/**
 * Walk the source and return every GFM table in document order. O(doc):
 * the line index is built exactly once per call and each line's candidacy
 * is evaluated O(1) times.
 *
 * A thin delegation to `tableParser/scan.ts#scanTables` — this function
 * owns no enumeration logic of its own, so the string entry point can
 * never drift into a second parser. The equivalence argument for the
 * rewrite, and the one class where it deliberately diverges from the
 * pre-WI-3 behaviour (overlapping models on a valid non-candidate
 * delimiter — ADR-0007), are recorded in `scan.ts`.
 *
 * When `isFenced` is supplied, tables whose start offset sits inside a
 * fenced code block are skipped, and the predicate is called only for
 * tables that actually parsed — see `IsFenced` for rationale.
 *
 * CALL FREQUENCY — and why the module-level claim that used to sit here
 * was wrong. Until Phase 4 this comment read `O(doc) — only called at
 * mode-toggle time, never on the keystroke hot path`. That was true of
 * `captureCellFromSource` / `locateCellInSource` below, whose only
 * callers are the view-mode transition, and false of enumeration, which
 * `lintTableColumnCount` reaches on the CodeMirror lint timer shortly
 * after each keystroke (today via `scanTables` over the editor's rope,
 * before WI-3B via this function). Being right about its own function
 * and wrong about the module is exactly why it survived review, so state
 * the two separately rather than collapsing them again:
 *
 *  - This function, the string entry point, is called by `tableMcp.ts`
 *    (MCP tool calls) and `tableFormatter.ts` (format-on-save, 重排表格)
 *    — user-initiated, not per-keystroke.
 *  - The enumeration it delegates to IS on the keystroke-adjacent path
 *    through `scanTables`. Cost work belongs in `scan.ts`, not here.
 */
export function findAllTables(
  source: string,
  isFenced?: IsFenced,
): TableModel[] {
  return scanTables(linesFromString(source), isFenced);
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
  return captureCellFromLines(linesFromString(source), offset, isFenced);
}

/**
 * Representation-neutral twin of `captureCellFromSource` (Phase 4 WI-3B).
 * `captureCellFromSource` is this function over `linesFromString`; the
 * mode-toggle capture path is this function over
 * `codemirror/textLineSource.ts#linesFromText`, and therefore never
 * materialises the editor document.
 */
export function captureCellFromLines(
  src: TableLineSource,
  offset: number,
  isFenced?: IsFenced,
): TableCellPos | null {
  if (isFenced && isFenced(offset)) return null;
  const tables = scanTables(src, isFenced);
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
  return locateCellInLines(linesFromString(source), pos, isFenced);
}

/**
 * Representation-neutral twin of `locateCellInSource` (Phase 4 WI-3B).
 * `locateCellInSource` is this function over `linesFromString`; the
 * mode-toggle restore path is this function over
 * `codemirror/textLineSource.ts#linesFromText`.
 */
export function locateCellInLines(
  src: TableLineSource,
  pos: TableCellPos,
  isFenced?: IsFenced,
): number | null {
  const tables = scanTables(src, isFenced);
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
