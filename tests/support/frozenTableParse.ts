/**
 * @module tests/support/frozenTableParse
 * Purpose: FROZEN verbatim copy of the table walker and row builder from
 * HEAD `6df4896` `src/utils/tableParser/parse.ts` (lines 133-207,
 * 227-289, 291-299) plus `commonmark.ts#countLeadingSpaces`, taken before
 * D12 WI-1 touched anything. Oracle for `tests/table-row-cells.test.ts`
 * (RC-1..RC-3) and, from WI-2, the locate suite (LOC-9).
 *
 * ---------------------------------------------------------------------
 * Frozen at 6df4896. Never edit. If a test disagrees with this file, the
 * source changed.
 * ---------------------------------------------------------------------
 *
 * Only identifiers are renamed (`frozen*`). The line-level predicates
 * (`isTableCandidateLine`, `isDelimiterLine`, `splitCellTexts`,
 * `isSetextUnderline`) are imported LIVE on purpose: this file pins the
 * walker's structure and the cell walk, and the predicates are pinned by
 * their own suites. It never imports `parse.ts` or `rowCells.ts`, or it
 * would compare the new code against itself.
 *
 * Not a `*.test.ts`, so vitest does not collect it.
 */

import { isSetextUnderline } from "../../src/utils/tableParser/commonmark";
import {
  isDelimiterLine,
  isTableCandidateLine,
  splitCellTexts,
  type TableLineSource,
} from "../../src/utils/tableParser/lines";
import {
  type ColumnAlignment,
  type LineRange,
  type TableCell,
  type TableModel,
} from "../../src/utils/tableParser/types";

// --- verbatim from commonmark.ts (6df4896) ---------------------------------

function frozenCountLeadingSpaces(s: string): number {
  let n = 0;
  while (n < s.length && s[n] === " ") n += 1;
  return n;
}

// --- verbatim from parse.ts lines 133-207 (6df4896) ------------------------

export function frozenParseTableAtLine(
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

  // Walk down collecting body rows until a non-table line. Each line is
  // fetched once and kept (D13: re-fetching cost the lint pass R calls).
  let endLineIdx = headerIdx + 1; // delimiter is part of the structure
  let endLine = delimLine;
  const rowLines: LineRange[] = [headerLine];
  for (let i = headerIdx + 2; i < lineCount; i += 1) {
    const line = src.line(i);
    if (!isTableCandidateLine(line)) break;
    rowLines.push(line);
    endLineIdx = i;
    endLine = line;
  }

  // Refuse if the offset is outside the table's line span.
  if (lineIdx < headerIdx || lineIdx > endLineIdx) return null;

  // Build the model.
  const colCount = headerCells.length;
  const alignments = delimCells.map(frozenParseAlignment);

  const rows: TableCell[][] = rowLines.map((line, rowIdx) =>
    frozenParseRowCells(line, rowIdx, colCount),
  );
  const cells = rows.flat();

  const start = headerLine.start;
  const end = endLine.end;

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

// --- verbatim from parse.ts lines 227-299 (6df4896) ------------------------

export function frozenParseRowCells(line: LineRange, rowIdx: number, colCount: number): TableCell[] {
  const text = line.text.replace(/\r$/, "");
  const indent = frozenCountLeadingSpaces(text);
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

export function frozenParseAlignment(cell: string): ColumnAlignment {
  const t = cell.trim();
  const left = t.startsWith(":");
  const right = t.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}
