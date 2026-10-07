/**
 * @module tests/support/frozenTableFormat
 * Purpose: FROZEN verbatim copy of `formatTable` / `formatAllTables` from
 * `src/utils/tableFormatter.ts` at 1c8a52c, taken before D44 WI-2 touched
 * anything. It is the pre-fix oracle for the D44 law L4 (pre-fix
 * conservation): a table with no overflow must format byte-identically to
 * this, and a widened table's lines must start with this output's lines.
 *
 * ---------------------------------------------------------------------
 * Frozen at 1c8a52c. Never edit. If a test disagrees with this file, the
 * source changed. F-FROZEN-PIN pins that this copy still TRUNCATES.
 * ---------------------------------------------------------------------
 *
 * Only identifiers are renamed (`frozen*`). `findAllTables`,
 * `guardTableWrite` and `serializeRows` are imported LIVE on purpose: D44
 * WI-2 may not change any of them, and this file must never import
 * `tableFormatter.ts` or it would compare the new code against itself.
 *
 * Not a `*.test.ts`, so vitest does not collect it.
 */

import { serializeRows, type TableModel } from "../../src/utils/tableParser";
import { findAllTables, type IsFenced } from "../../src/utils/cursorSync/table";
import { guardTableWrite } from "../../src/utils/tableWriteGuard";

// --- verbatim from tableFormatter.ts (1c8a52c) ----------------------------

export function frozenFormatTable(model: TableModel): string {
  return serializeRows(
    model.rows.map((row) => row.map((cell) => cell.text)),
    model.alignments,
  );
}

export function frozenFormatAllTables(source: string, isFenced?: IsFenced): string {
  const tables = findAllTables(source, isFenced);
  if (tables.length === 0) return source;

  let out = source;
  for (let i = tables.length - 1; i >= 0; i -= 1) {
    const table = tables[i];
    if (!guardTableWrite(table, "format.all_tables")) continue;
    const formatted = frozenFormatTable(table);
    out = out.slice(0, table.start) + formatted + out.slice(table.end);
  }
  return out;
}
