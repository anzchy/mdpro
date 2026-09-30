/**
 * @module tableParser/locate
 * Purpose: The table walker, the cursor-path adapters that return WHERE a
 * table is (`TableSpan`) without building its cells, and the one-row cell
 * lookup against a span (D12, ADR-0043 Decisions 1-3).
 *
 * Pipeline: `resolveOffsetLine(src, offset)` applies the offset guards and
 * resolves the start line -> `walkTableAtLine(src, lineIdx, rows?)` walks
 * up to the header, checks the delimiter, walks down to the last row and
 * returns a `TableSpan`. Two adapters over that one walk:
 *  - `locateTableAtLine` / `locateTableAtOffset` collect nothing and
 *    return the span (the Source cursor context);
 *  - `parse.ts#parseTableAtLine` passes a row collector and builds the
 *    `TableModel` from the collected lines AFTER the walk succeeds.
 * Given a span, `cellAtOffset` / `cellAtResolvedLine` parse only the row
 * that owns the offset (`rowCells.ts#parseRowCells`) — never the table.
 *
 * Key decisions:
 *  - One algorithm, two outputs — never a second walker. Guard order,
 *    refusal conditions and the D13 single-fetch line cache (2R+5 `line()`
 *    calls) are exactly the HEAD 6df4896 walker's; `tests/table-locate.test.ts`
 *    LOC-9 pins that against a frozen copy.
 *  - A span is plain data with no reference to `src`, so holding one pins
 *    nothing; its line indices are valid only for the document they were
 *    computed on.
 *  - `delimiterIsCandidate` is `isTableCandidateLine(delimiter)`, not
 *    `isDelimiterLine` (always true here): a pipe-less `:-:` breaks the
 *    upward walk, which is what makes span reuse unsafe for it (ADR-0043
 *    Context 3).
 *  - The owning row is not always `lineIndexAt(offset)`: column 0 of a
 *    line resolves to the line above (Finding 1, preserved on purpose), so
 *    `offset > line(i).end` means row `i + 1`. Still one row, at most two
 *    `line()` reads, independent of the table's size.
 *  - Folder-scoped: imported by path, deliberately absent from the
 *    `index.ts` barrel. Only the `TableSpan` TYPE is public.
 *
 * @coordinates-with src/utils/tableParser/parse.ts
 * @coordinates-with src/utils/tableParser/lines.ts
 * @coordinates-with src/utils/tableParser/rowCells.ts
 * @coordinates-with src/utils/tableParser/find.ts
 * @coordinates-with src/utils/tableParser/commonmark.ts
 * @coordinates-with src/utils/tableParser/types.ts
 */

import { isSetextUnderline } from "./commonmark";
import {
  isDelimiterLine,
  isTableCandidateLine,
  splitCellTexts,
  type TableLineSource,
} from "./lines";
import { parseRowCells } from "./rowCells";
import {
  type ColumnAlignment,
  type LineRange,
  type TableCell,
  type TableSpan,
} from "./types";

/**
 * The offset guards shared by `parseTableAtOffset` and
 * `locateTableAtOffset`, in their fixed order: out-of-range offset, then
 * empty document, then offset resolution. An empty document has one
 * (empty) line, so without the length guard offset 0 would reach the
 * walker instead of returning null. Returns the start line, or -1.
 */
export function resolveOffsetLine(src: TableLineSource, offset: number): number {
  if (offset < 0 || offset > src.length) return -1;
  if (src.length === 0) return -1;
  if (src.lineCount === 0) return -1;
  // NaN passes the comparisons above; the adapters resolve it to -1.
  return src.lineIndexAt(offset);
}

/**
 * Internal (folder-scoped): walk the table containing line `lineIdx` of an
 * already-split document and return its span, or null.
 *
 * Walks UP from `lineIdx` to the first candidate line, requires a
 * delimiter row directly beneath it, then walks DOWN to the last
 * candidate line. Returns null when `lineIdx` ends up outside the
 * table's line span. When `rows` is given, the header line and every body
 * line are pushed onto it in order (the delimiter is not a row); a caller
 * must ignore what was collected when the walk returns null.
 */
export function walkTableAtLine(
  src: TableLineSource,
  lineIdx: number,
  rows?: LineRange[],
): TableSpan | null {
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

  // Walk down to the last body row. Each line is fetched once and kept
  // (D13: re-fetching cost the lint pass R calls).
  let endLineIdx = headerIdx + 1; // delimiter is part of the structure
  let endLine = delimLine;
  rows?.push(headerLine);
  for (let i = headerIdx + 2; i < lineCount; i += 1) {
    const line = src.line(i);
    if (!isTableCandidateLine(line)) break;
    rows?.push(line);
    endLineIdx = i;
    endLine = line;
  }

  // Refuse if the offset is outside the table's line span.
  if (lineIdx < headerIdx || lineIdx > endLineIdx) return null;

  return {
    start: headerLine.start,
    end: endLine.end,
    headerLine: headerIdx,
    lastLine: endLineIdx,
    // Header plus body rows; the delimiter line is not a row.
    rowCount: endLineIdx - headerIdx,
    colCount: headerCells.length,
    alignments: delimCells.map(parseAlignment),
    delimiterIsCandidate: isTableCandidateLine(delimLine),
  };
}

/**
 * The span of the table containing line `lineIdx`, or null. Makes the
 * same `line()` calls as `parseTableAtLine` and builds no cells.
 */
export function locateTableAtLine(
  src: TableLineSource,
  lineIdx: number,
): TableSpan | null {
  return walkTableAtLine(src, lineIdx);
}

/**
 * The span of the table containing `offset`, or null — exactly when
 * `parseTableAtOffset` would return null, and otherwise the projection of
 * its model. Builds no cells and never calls `slice`.
 */
export function locateTableAtOffset(
  src: TableLineSource,
  offset: number,
): TableSpan | null {
  const lineIdx = resolveOffsetLine(src, offset);
  if (lineIdx < 0) return null;
  return walkTableAtLine(src, lineIdx);
}

/**
 * The one `TableCell` under `offset`, or null, reading only the row that
 * owns the cursor (ADR-0043 Decision 3). Equal to
 * `findCell(parseTableAtOffset(src, offset), offset)` when `span` is
 * `locateTableAtOffset(src, offset)`.
 *
 * Exactly `cellAtResolvedLine(src, span, src.lineIndexAt(offset), offset)`
 * — nothing more. A caller that has already resolved the line (the
 * Source cursor field, for its reuse check) calls the helper directly and
 * saves the second `lineIndexAt`.
 */
export function cellAtOffset(
  src: TableLineSource,
  span: TableSpan | null,
  offset: number,
): TableCell | null {
  return cellAtResolvedLine(src, span, src.lineIndexAt(offset), offset);
}

/**
 * Internal, exported for tests and the cursor field only (not in the
 * barrel): `cellAtOffset` with the RAW `lineIndexAt(offset)` already
 * resolved into `lineIdx`.
 *
 * Finding 1: `lineIndexAt` maps an offset equal to `line(i).end + 1` to
 * line `i`, but under LF that offset is also column 0 of line `i + 1`,
 * which in a table without edge pipes is inside that row's first cell.
 * So when `offset > line(i).end` the owning row is `i + 1`, otherwise it
 * is `i`. Either way exactly one row is parsed and at most two lines are
 * read. The header is row 0; the delimiter owns no cell; a body line maps
 * to row `line - headerLine - 1`.
 */
export function cellAtResolvedLine(
  src: TableLineSource,
  span: TableSpan | null,
  lineIdx: number,
  offset: number,
): TableCell | null {
  if (span === null) return null;
  // Also rejects -1 (an unresolvable offset) before any line is read.
  if (lineIdx < span.headerLine || lineIdx > span.lastLine) return null;
  const delimiterIdx = span.headerLine + 1;

  const resolved = src.line(lineIdx);
  let owner = lineIdx;
  let ownerLine = resolved;
  if (offset > resolved.end) {
    owner = lineIdx + 1;
    if (owner > span.lastLine || owner === delimiterIdx) return null;
    ownerLine = src.line(owner);
  } else if (owner === delimiterIdx) {
    return null;
  }

  const row = owner === span.headerLine ? 0 : owner - span.headerLine - 1;
  for (const cell of parseRowCells(ownerLine, row, span.colCount)) {
    if (offset >= cell.start && offset < cell.end) return cell;
  }
  return null;
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
