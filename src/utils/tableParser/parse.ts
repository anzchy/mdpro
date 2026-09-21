/**
 * @module tableParser/parse
 * Purpose: Core GFM table recognition (Phase 2 WI-2.0). Returns a
 * `TableModel` with absolute offsets so downstream consumers (Tab nav,
 * context menu, cursor sync, lint, MCP) never reinvent pipe-scanning.
 * Fence detection is the caller's responsibility — see
 * `src/plugins/codemirror/sourceTableDetection.ts`.
 *
 * Pipeline: `parseTableAtOffset(src, offset)` resolves the offset to a
 * line and hands both to `parseTableAtLine`, which does all the real work
 * against the split document. `parseTableAt(source, offset)` is that
 * function over `lines.ts#linesFromString`; the CodeMirror call sites
 * reach it over `textLineSource.ts#linesFromText` (Phase 4 WI-3B).
 * Neither materialises the document — a claim this header carried while
 * the parser was still copying `raw` eagerly on every probe (D11). Line
 * splitting, offset resolution and the predicates live in `./lines`
 * (Phase 4 WI-2); this file
 * owns table structure only. Whole-document enumeration lives in
 * `./scan` (Phase 4 WI-3), which probes `parseTableAtLine` once per
 * maximal run of candidate lines — this file has no loop over the
 * document and must not grow one.
 *
 * Key decisions:
 *  - `parseTableAt` keeps its exact string signature, return type and
 *    null-guard order. It therefore builds the line index on every call
 *    — exactly once per call, never twice. Hoisting that build across
 *    calls is a scanner concern, not a parser one.
 *  - `parseTableAtOffset` is the same computation with the string step
 *    removed, not a second parser. One algorithm, two adapters.
 *  - `TableModel.raw` is a memoized lazy GETTER, not a stored string
 *    (D11). Eager `src.slice` put a whole-table copy on the cursor path,
 *    which `sourceTableDetection` runs per keystroke and never reads;
 *    the two that do read it still pay one copy each. Keep it enumerable
 *    and typed `string` — `raw` is spread and serialized, and would
 *    vanish from both on a prototype. Cost: the model pins `src`, so a
 *    long-lived one retains the line index, not just the table. The only
 *    such holder wraps the rope EditorState already retains.
 *  - Body-row cells are padded / truncated to the header's column count
 *    per GFM, which loses the raw cell count; `countTableLineCells`
 *    exposes the pre-pad number for the column-count linter.
 *  - Block-level CommonMark rules this parser must lose to (setext
 *    underlines, indentation in columns) live in `./commonmark`, not here
 *    — WI-C1 / WI-C2, plan `20260917-plan-table-over-detection-vs-gfm.md`.
 *
 * @coordinates-with src/utils/tableParser/commonmark.ts
 * @coordinates-with src/utils/tableParser/lines.ts
 * @coordinates-with src/utils/tableParser/scan.ts
 * @coordinates-with src/utils/tableParser/find.ts
 * @coordinates-with src/utils/cursorSync/table.ts
 * @coordinates-with src/plugins/codemirror/sourceTableDetection.ts
 * @coordinates-with src/plugins/codemirror/textLineSource.ts
 */

import { countLeadingSpaces, isSetextUnderline } from "./commonmark";
import {
  isDelimiterLine,
  isTableCandidateLine,
  linesFromString,
  splitCellTexts,
  type TableLineSource,
} from "./lines";
import {
  type ColumnAlignment,
  type LineRange,
  type TableCell,
  type TableModel,
} from "./types";

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
 * then empty document, then offset resolution. It matters — an empty
 * document has one (empty) line, so without the length guard offset 0
 * would reach the parser instead of returning null.
 */
export function parseTableAtOffset(
  src: TableLineSource,
  offset: number,
): TableModel | null {
  if (offset < 0 || offset > src.length) return null;
  if (src.length === 0) return null;
  if (src.lineCount === 0) return null;

  // Find the line containing offset.
  const startLineIdx = src.lineIndexAt(offset);
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
 * Walks UP from `lineIdx` to the first candidate line, requires a
 * delimiter row directly beneath it, then walks DOWN to the last
 * candidate line. Returns null when `lineIdx` ends up outside the
 * table's line span.
 */
export function parseTableAtLine(
  src: TableLineSource,
  lineIdx: number,
): TableModel | null {
  const lineCount = src.lineCount;

  // Walk up from this line to find the first table-candidate line.
  let headerIdx = lineIdx;
  while (headerIdx > 0 && isTableCandidateLine(src.line(headerIdx - 1))) {
    headerIdx -= 1;
  }
  if (!isTableCandidateLine(src.line(headerIdx))) return null;

  // The next line MUST be a delimiter row.
  if (headerIdx + 1 >= lineCount) return null;
  const headerLine = src.line(headerIdx);
  const delimLine = src.line(headerIdx + 1);
  if (!isDelimiterLine(delimLine)) return null;
  // WI-C1: setext beats the table delimiter. `headerIdx` is a non-blank
  // candidate line, so a `-`-only line under it is a setext H2 underline
  // and GFM emits a heading plus a paragraph, not a table. Colon-bearing
  // spellings (`:-:`, `--:`, `:--`) are real delimiters and do not match.
  if (isSetextUnderline(delimLine.text.replace(/\r$/, ""))) return null;

  const headerCells = splitCellTexts(headerLine.text);
  const delimCells = splitCellTexts(delimLine.text);
  if (headerCells.length === 0 || headerCells.length !== delimCells.length) {
    return null;
  }

  // Walk down to collect body rows until we hit a non-table line.
  let endLineIdx = headerIdx + 1; // delimiter is part of the structure
  for (let i = headerIdx + 2; i < lineCount; i += 1) {
    if (!isTableCandidateLine(src.line(i))) break;
    endLineIdx = i;
  }

  // Refuse if the offset is outside the table's line span.
  if (lineIdx < headerIdx || lineIdx > endLineIdx) return null;

  // Build the model.
  const colCount = headerCells.length;
  const alignments = delimCells.map(parseAlignment);

  const rowLines: LineRange[] = [headerLine];
  for (let i = headerIdx + 2; i <= endLineIdx; i += 1) {
    rowLines.push(src.line(i));
  }

  const rows: TableCell[][] = rowLines.map((line, rowIdx) =>
    parseRowCells(line, rowIdx, colCount),
  );
  const cells = rows.flat();

  const start = headerLine.start;
  const end = src.line(endLineIdx).end;

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

// ---------------------------------------------------------------------------
// Internal helpers — table structure only. Line splitting, offset
// resolution and the line-level predicates live in `./lines`.
// ---------------------------------------------------------------------------

/**
 * Parse cells from a row line, computing absolute source offsets so
 * `findCell` can map an offset back to its cell.
 *
 * Pads to colCount with empty cells at the end (GFM: missing trailing
 * cells are empty). Truncates if the row has more cells than the
 * header (GFM: excess cells are ignored).
 *
 * `countLeadingSpaces` here is a CHARACTER count and must stay one — it
 * is the base of every cell's absolute offset. Do not swap in
 * `commonmark.ts#countIndentColumns`: columns and characters part company
 * on tabs, and the substitution would move every `TableCell.start/end`.
 */
function parseRowCells(line: LineRange, rowIdx: number, colCount: number): TableCell[] {
  const text = line.text.replace(/\r$/, "");
  const indent = countLeadingSpaces(text);
  const baseOffset = line.start + indent;
  const stripped = text.slice(indent);

  // Walk the line tracking absolute offsets. We need the start/end of
  // each cell's content range INCLUDING padding (so findCell hits a
  // cell when the cursor is in the whitespace next to the text).
  const cells: { start: number; end: number; text: string }[] = [];
  let segStart = 0; // offset relative to `stripped`
  let buf = "";
  let escaped = false;

  for (let i = 0; i < stripped.length; i += 1) {
    const ch = stripped[i];
    if (escaped) {
      buf += "\\" + ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "|") {
      cells.push({ start: segStart, end: i, text: buf });
      buf = "";
      segStart = i + 1;
      if (cells.length === 1 && cells[0].text.trim() === "") {
        // Drop the empty leading-edge cell.
        cells.length = 0;
      }
      continue;
    }
    buf += ch;
  }
  if (escaped) buf += "\\";
  cells.push({ start: segStart, end: stripped.length, text: buf });

  // Drop the empty trailing-edge cell (if the line ended with `|`).
  if (cells.length > 0 && cells[cells.length - 1].text.trim() === "") {
    cells.pop();
  }

  // Pad with empty cells if short; truncate if long.
  while (cells.length < colCount) {
    cells.push({
      start: stripped.length,
      end: stripped.length,
      text: "",
    });
  }
  if (cells.length > colCount) cells.length = colCount;

  return cells.map((c, colIdx): TableCell => ({
    start: baseOffset + c.start,
    end: baseOffset + c.end,
    text: c.text.trim(),
    row: rowIdx,
    col: colIdx,
  }));
}

function parseAlignment(cell: string): ColumnAlignment {
  const t = cell.trim();
  const left = t.startsWith(":");
  const right = t.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}
