/**
 * @module tableWiden
 * Purpose: the write-side widening helper (D44 / ADR-0052, shared since D49).
 * `widenTable(model)` returns a table's cell texts and alignments widened to
 * its own widest row, so a writer that re-serializes the table keeps body
 * cells past the header's column count ("overflow") instead of dropping them.
 *
 * The parser still truncates rows to the header (`tableParser/rowCells.ts`,
 * GFM's "excess cells are ignored"; ADR-0052 §3 keeps it that way, because
 * cursor locate, the linter and MCP rely on it). Widening is a write-side
 * policy, which is why this module sits beside `tableFormatter.ts` and
 * `tableWriteGuard.ts` rather than inside `tableParser/`.
 *
 * Key decisions:
 *  - Cells inside the header's columns come from `model.rows`; only the
 *    overflow is read back from the row's own line with `splitCellTexts`,
 *    trimmed exactly as `parseRowCells` trims. That depends on the two
 *    splitters agreeing on where cells break (RC-6). Neither knows about
 *    code spans; if only one of them learns, overflow lands in the wrong
 *    column. `tests/table-widen.test.ts` W-7 is the tripwire.
 *  - A blank overflow cell still counts as a column (ADR-0052 §2). New
 *    columns get an empty header cell and default alignment (`null`).
 *  - Rows are RECTANGULAR: every row is padded with `""` to
 *    `alignments.length`, so a caller that swaps or splices columns never
 *    reads `undefined`. `serializeRows` already pads, so the formatter's
 *    bytes are unchanged by this.
 *  - The width is a `reduce`, never `Math.max(...spread)`.
 *  - The rule itself is `widenRows`, generic over the cell type (D64 WI-2):
 *    `widenTable` feeds it strings, and the Milkdown parse-time transformer
 *    feeds it mdast `tableCell`s, so WYSIWYG load and source-side writers
 *    widen identically (ADR-0067 Decision 1).
 *
 * @coordinates-with src/utils/tableFormatter.ts (format on save / formatTable)
 * @coordinates-with src/utils/tableEdits/edits.ts (context-menu edits)
 * @coordinates-with src/utils/tableParser/lines.ts (splitCellTexts, the overflow read)
 * @coordinates-with src/utils/tableParser/rowCells.ts (parseRowCells, RC-6 agreement)
 * @coordinates-with src/plugins/milkdown/table/raggedTableWiden.ts (widenRows over mdast cells)
 */

import type { ColumnAlignment, TableModel } from "./tableParser";
import { splitCellTexts } from "./tableParser/lines";

/** Raw line index of the delimiter row in `model.raw` (0 is the header). */
const DELIMITER_LINE = 1;

/** A table's cell texts and alignments, widened and rectangular. */
export interface WidenedTable {
  rows: string[][];
  alignments: ColumnAlignment[];
}

/**
 * Cell texts and alignments for `model`, widened to its widest row, with
 * every row padded to `alignments.length`. Callers derive the new width as
 * `alignments.length` and "did it widen" as `alignments.length > model.colCount`.
 *
 * `model.raw` line 0 is the header, line 1 the delimiter (skipped by
 * index, never by content), and line k >= 2 is model row k - 1. A row's
 * overflow is `splitCellTexts(line).slice(colCount)`, trimmed exactly as
 * `parseRowCells` trims, so the two sources agree (RC-6).
 */
export function widenTable(model: TableModel): WidenedTable {
  const lines = model.raw.split("\n");
  const ragged = model.rows.map((row, r) => {
    const line = lines[r === 0 ? 0 : r + DELIMITER_LINE] ?? "";
    const overflow = splitCellTexts(line)
      .slice(model.colCount)
      .map((text) => text.trim());
    return [...row.map((cell) => cell.text), ...overflow];
  });
  return widenRows(ragged, model.alignments, () => "");
}

/**
 * The shared widening rule (ADR-0063, ADR-0067 Decision 1), generic over the cell
 * type so the source-side `widenTable` and the Milkdown parse-time transformer
 * (`plugins/milkdown/table/raggedTableWiden.ts`) apply one rule instead of two copies.
 *
 * The width is the widest row, never less than `alignments.length`; a cell counts
 * however blank it is. Each row is padded IN PLACE at its end with `blank()` (one
 * fresh value per missing cell), so every existing cell keeps its column index.
 * The returned alignments are a NEW array extended with explicit `null`; the
 * caller's array is not mutated.
 */
export function widenRows<T>(
  rows: T[][],
  alignments: readonly ColumnAlignment[],
  blank: () => T,
): { rows: T[][]; alignments: ColumnAlignment[] } {
  // reduce, not Math.max(...spread): a spread over a huge table overflows the stack.
  const width = rows.reduce((max, row) => Math.max(max, row.length), alignments.length);
  const widened = [...alignments];
  while (widened.length < width) widened.push(null);
  for (const row of rows) {
    while (row.length < width) row.push(blank());
  }
  return { rows, alignments: widened };
}

