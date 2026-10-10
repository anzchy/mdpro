/**
 * @module tableParser/parse
 * Purpose: Core GFM table recognition (Phase 2 WI-2.0). Returns a
 * `TableModel` with absolute offsets so downstream consumers (Tab nav,
 * context menu, cursor sync, lint, MCP) never reinvent pipe-scanning.
 * Fence detection is the caller's responsibility — see
 * `src/plugins/codemirror/sourceTableDetection.ts`.
 *
 * Pipeline: `parseTableAtOffset(src, offset)` resolves the offset to a
 * line (`locate.ts#resolveOffsetLine`) and hands it to `parseTableAtLine`,
 * which runs the shared walker `locate.ts#walkTableAtLine` with a row
 * collector and then builds the cells of every collected row.
 * `parseTableAt(source, offset)` is that function over
 * `lines.ts#linesFromString`; the CodeMirror call sites reach it over
 * `textLineSource.ts#linesFromText` (Phase 4 WI-3B). Neither materialises
 * the document — a claim this header carried while the parser was still
 * copying `raw` eagerly on every probe (D11). Line splitting, offset
 * resolution and the predicates live in `./lines` (Phase 4 WI-2). The walk
 * that finds a table's lines — including the setext and cell-count
 * refusals — lives in `./locate` (D12 WI-2, ADR-0043), which also returns
 * it as a cell-free `TableSpan` for the cursor path; this file turns a
 * successful walk into a `TableModel`. Whole-document enumeration lives in
 * `./scan` (Phase 4 WI-3), which probes `parseTableAtLine` once per
 * maximal run of candidate lines — this file has no loop over the
 * document and must not grow one. Splitting one row line into its
 * cells lives in `./rowCells` (D12 WI-1, ADR-0043), so a caller can build
 * one row's cells without building the whole model.
 *
 * Key decisions:
 *  - `parseTableAt` keeps its exact string signature, return type and
 *    null-guard order. It therefore builds the line index on every call
 *    — exactly once per call, never twice. Hoisting that build across
 *    calls is a scanner concern, not a parser one.
 *  - `parseTableAtOffset` is the same computation with the string step
 *    removed, not a second parser. One algorithm, two adapters — and since
 *    D12, one walker with two outputs: this file's model and `locate.ts`'s
 *    span, pinned to identical `line()` sequences.
 *  - `TableModel.raw` is a memoized lazy GETTER, not a stored string
 *    (D11). Eager `src.slice` put a whole-table copy on the cursor path,
 *    which `sourceTableDetection` runs per keystroke and never reads;
 *    since D13 the linter doesn't either, and only `tableWriteGuard`
 *    still pays its one copy. Keep it enumerable
 *    and typed `string` — `raw` is spread and serialized, and would
 *    vanish from both on a prototype. Cost: the model pins `src`, so a
 *    long-lived one retains the line index, not just the table. The only
 *    such holder wraps the rope EditorState already retains.
 *  - Body-row cells are padded / truncated to the header's column count
 *    per GFM, which loses the raw cell count; `countTableLineCells`
 *    exposes the pre-pad number for the column-count linter. D44
 *    (ADR-0052) keeps that truncation: format-on-save widens instead,
 *    and `tableFormatter.ts` reads the overflow cells back from the
 *    row's own line with `lines.ts#splitCellTexts`.
 *  - Block-level CommonMark rules this parser must lose to (setext
 *    underlines, indentation in columns) live in `./commonmark`, not here
 *    — WI-C1 / WI-C2, plan `20260917-plan-table-over-detection-vs-gfm.md`.
 *
 * @coordinates-with src/utils/tableParser/commonmark.ts
 * @coordinates-with src/utils/tableParser/lines.ts
 * @coordinates-with src/utils/tableParser/locate.ts
 * @coordinates-with src/utils/tableParser/rowCells.ts
 * @coordinates-with src/utils/tableParser/scan.ts
 * @coordinates-with src/utils/tableParser/find.ts
 * @coordinates-with src/utils/cursorSync/table.ts
 * @coordinates-with src/plugins/codemirror/sourceTableDetection.ts
 * @coordinates-with src/plugins/codemirror/textLineSource.ts
 */

import { linesFromString, splitCellTexts, type TableLineSource } from "./lines";
import { resolveOffsetLine, walkTableAtLine } from "./locate";
import { parseRowCells } from "./rowCells";
import { type LineRange, type TableCell, type TableModel } from "./types";

/**
 * Count the unescaped cell segments in a single line of GFM table
 * source. Used by the column-count linter (Phase 3 WI-3.1) so it
 * doesn't reinvent the parser's edge-pipe + escaped-pipe logic.
 *
 * The parser pads/truncates body rows to match the header during
 * `parseTableAt`, which loses the raw cell count — this helper
 * exposes the pre-pad number so the linter can flag mismatches.
 */
export function countTableLineCells(line: string): number {
  return splitCellTexts(line).length;
}

/**
 * Locate a GFM table containing `offset`. Returns null when no table
 * is found at or around the given source position.
 */
export function parseTableAt(source: string, offset: number): TableModel | null {
  // Guarded before the split so an out-of-range offset still costs
  // nothing, exactly as it did before WI-3B.
  if (offset < 0 || offset > source.length) return null;
  // Exactly one line-index build per call.
  return parseTableAtOffset(linesFromString(source), offset);
}

/**
 * Representation-neutral twin of `parseTableAt` (Phase 4 WI-3B): locate
 * the table containing `offset` in an already-split document, whatever
 * that document is backed by — see the header for the two adapters.
 *
 * The guard order is `parseTableAt`'s, unchanged: out-of-range offset,
 * then empty document, then offset resolution. It lives in
 * `locate.ts#resolveOffsetLine`, shared with `locateTableAtOffset`, so the
 * two adapters cannot drift apart on which offsets reach the walker.
 */
export function parseTableAtOffset(
  src: TableLineSource,
  offset: number,
): TableModel | null {
  const startLineIdx = resolveOffsetLine(src, offset);
  if (startLineIdx < 0) return null;
  return parseTableAtLine(src, startLineIdx);
}

/**
 * Internal (folder-scoped): parse the table containing line `lineIdx`
 * of an already-split document.
 *
 * Exported so the linear scanner can reuse one `TableLineSource` across
 * many probes; it is deliberately absent from the `index.ts` barrel, so
 * the public surface is still `parseTableAt`.
 *
 * The collecting adapter over `locate.ts#walkTableAtLine` (D12 WI-2): the
 * walk collects the row lines, and cells are built only once it has
 * succeeded — a refused table never reaches `parseRowCells`. Returns null
 * exactly when `locateTableAtLine` does.
 */
export function parseTableAtLine(
  src: TableLineSource,
  lineIdx: number,
): TableModel | null {
  const rowLines: LineRange[] = [];
  const span = walkTableAtLine(src, lineIdx, rowLines);
  if (span === null) return null;

  const { start, end, colCount, alignments } = span;
  const rows: TableCell[][] = rowLines.map((line, rowIdx) =>
    parseRowCells(line, rowIdx, colCount),
  );
  const cells = rows.flat();

  // D11 — see the header's Key decision. Lazy, memoized.
  let rawCache: string | undefined;

  return {
    start,
    end,
    rowCount: rows.length,
    colCount,
    alignments,
    cells,
    rows,
    get raw(): string {
      if (rawCache === undefined) rawCache = src.slice(start, end);
      return rawCache;
    },
  };
}
