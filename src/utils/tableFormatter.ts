/**
 * @module tableFormatter
 * Purpose: GFM table pretty-printer (Phase 3 WI-3.2). Reads a parsed
 * `TableModel` (or a whole document) and produces aligned source —
 * cells padded column-by-column, alignment markers preserved, escaped
 * pipes preserved, CRLF normalized to LF.
 *
 * `formatTable(model)` is the single-table primitive used by the
 * "Reformat table" context-menu action. `formatAllTables(source,
 * isFenced)` is the whole-document pass used by the
 * `editor.autoReformatTablesOnSave` Settings opt-in.
 *
 * Both pass through `serializeRows` / `findAllTables` so the fence
 * guard (Risk R3) and the parser's edge-pipe / escape semantics stay
 * single-source-of-truth.
 *
 * @coordinates-with src/utils/tableParser
 * @coordinates-with src/utils/cursorSync/table.ts
 * @coordinates-with src/hooks/useDocument.ts (auto-reformat on save)
 */

import {
  serializeRows,
  type TableModel,
} from "./tableParser";
import { findAllTables, type IsFenced } from "./cursorSync/table";

/**
 * Serialize `model` with column-aligned padding. Output is a drop-in
 * replacement for `model.raw` (NO trailing newline).
 */
export function formatTable(model: TableModel): string {
  return serializeRows(
    model.rows.map((row) => row.map((cell) => cell.text)),
    model.alignments,
  );
}

/**
 * Walk the source, format every (non-fenced) table region in place,
 * and return the new source. Idempotent — applying twice yields the
 * same output as applying once.
 *
 * Implementation detail: tables are spliced from LAST to FIRST so each
 * splice doesn't shift offsets in the still-pending tables.
 */
export function formatAllTables(source: string, isFenced?: IsFenced): string {
  const tables = findAllTables(source, isFenced);
  if (tables.length === 0) return source;

  let out = source;
  for (let i = tables.length - 1; i >= 0; i -= 1) {
    const table = tables[i];
    const formatted = formatTable(table);
    out = out.slice(0, table.start) + formatted + out.slice(table.end);
  }
  return out;
}
