/**
 * @module tests/support/legacyTableScan
 * Purpose: FROZEN byte-copy of the table scanner as it shipped before
 * WI-2 (`src/utils/tableParser/parse.ts` + `src/utils/cursorSync/table.ts`
 * at commit-time of the WI-2 plan). Used as a golden oracle by
 * `tests/table-line-index.test.ts`.
 *
 * ---------------------------------------------------------------------
 * THIS FILE IS NEVER UPDATED.
 *
 * It is a reference implementation, not a test double. If a test that
 * compares live code against this file fails, the live code changed
 * behaviour. Editing this file to match is a BEHAVIOURAL DECISION that
 * must be argued for on its own merits — it is not a "test fix". The
 * whole value of the oracle is that it cannot be renegotiated while
 * chasing green.
 * ---------------------------------------------------------------------
 *
 * Import rule: types only, and only from `tableParser/types`. This file
 * must never import the live implementation, or it would compare the
 * new code against itself.
 *
 * Not a `*.test.ts`, so vitest does not collect it (`vitest.config.ts`
 * includes only `tests/**\/*.test.{ts,tsx}`).
 */

import {
  MAX_INDENT,
  type ColumnAlignment,
  type LineRange,
  type TableCell,
  type TableModel,
} from "../../src/utils/tableParser/types";

// --- verbatim from src/utils/tableParser/parse.ts --------------------------

function parseTableAt(source: string, offset: number): TableModel | null {
  if (offset < 0 || offset > source.length) return null;
  if (source.length === 0) return null;

  const lines = splitLines(source);
  if (lines.length === 0) return null;

  // Find the line containing offset.
  const startLineIdx = findLineIndex(lines, offset);
  if (startLineIdx < 0) return null;

  // Walk up from this line to find the first table-candidate line.
  let headerIdx = startLineIdx;
  while (headerIdx > 0 && isTableCandidateLine(lines[headerIdx - 1])) {
    headerIdx -= 1;
  }
  if (!isTableCandidateLine(lines[headerIdx])) return null;

  // The next line MUST be a delimiter row.
  if (headerIdx + 1 >= lines.length) return null;
  const headerLine = lines[headerIdx];
  const delimLine = lines[headerIdx + 1];
  if (!isDelimiterLine(delimLine)) return null;

  const headerCells = splitCellTexts(headerLine.text);
  const delimCells = splitCellTexts(delimLine.text);
  if (headerCells.length === 0 || headerCells.length !== delimCells.length) {
    return null;
  }

  // Walk down to collect body rows until we hit a non-table line.
  let endLineIdx = headerIdx + 1; // delimiter is part of the structure
  for (let i = headerIdx + 2; i < lines.length; i += 1) {
    if (!isTableCandidateLine(lines[i])) break;
    endLineIdx = i;
  }

  // Refuse if the offset is outside the table's line span.
  if (startLineIdx < headerIdx || startLineIdx > endLineIdx) return null;

  // Build the model.
  const colCount = headerCells.length;
  const alignments = delimCells.map(parseAlignment);

  const rowLines: LineRange[] = [
    headerLine,
    ...lines.slice(headerIdx + 2, endLineIdx + 1),
  ];

  const rows: TableCell[][] = rowLines.map((line, rowIdx) =>
    parseRowCells(line, rowIdx, colCount),
  );
  const cells = rows.flat();

  const start = headerLine.start;
  const end = lines[endLineIdx].end;

  return {
    start,
    end,
    rowCount: rows.length,
    colCount,
    alignments,
    cells,
    rows,
    raw: source.slice(start, end),
  };
}

function splitLines(source: string): LineRange[] {
  const out: LineRange[] = [];
  let start = 0;
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === "\n") {
      // Strip CR if present (CRLF line endings)
      const lineEnd = i > start && source[i - 1] === "\r" ? i - 1 : i;
      out.push({ start, end: lineEnd, text: source.slice(start, lineEnd) });
      start = i + 1;
    }
  }
  if (start <= source.length) {
    out.push({ start, end: source.length, text: source.slice(start) });
  }
  return out;
}

function findLineIndex(lines: LineRange[], offset: number): number {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // Allow offset to land on the trailing newline (treat as belonging
    // to this line) by checking <= line.end + 1.
    if (offset >= line.start && offset <= line.end + 1) return i;
  }
  return -1;
}

function isTableCandidateLine(line: LineRange): boolean {
  const text = line.text.replace(/\r$/, "");
  if (text.trim().length === 0) return false;
  const indent = countLeadingSpaces(text);
  if (indent > MAX_INDENT) return false;
  return hasUnescapedPipe(text);
}

function countLeadingSpaces(s: string): number {
  let n = 0;
  while (n < s.length && s[n] === " ") n += 1;
  return n;
}

function hasUnescapedPipe(s: string): boolean {
  let escaped = false;
  for (const ch of s) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "|") return true;
  }
  return false;
}

function isDelimiterLine(line: LineRange): boolean {
  const text = line.text.replace(/\r$/, "").trim();
  if (!text) return false;
  // After splitting and dropping empty edge segments, every cell must
  // match `:?-+:?` (with optional surrounding whitespace).
  const cells = splitCellTexts(text);
  if (cells.length === 0) return false;
  return cells.every((c) => /^\s*:?-+:?\s*$/.test(c));
}

function splitCellTexts(line: string): string[] {
  const text = line.replace(/\r$/, "");
  // Strip leading indent (caller already validated <= 3 spaces).
  const trimmed = text.replace(/^ {0,3}/, "");

  const segments: string[] = [];
  let buf = "";
  let escaped = false;
  for (const ch of trimmed) {
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
      segments.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (escaped) buf += "\\";
  segments.push(buf);

  // Drop empty edges (the optional `|` at start/end).
  if (segments.length > 0 && segments[0].trim() === "") segments.shift();
  if (segments.length > 0 && segments[segments.length - 1].trim() === "") segments.pop();
  return segments;
}

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

// --- verbatim from src/utils/cursorSync/table.ts --------------------------

type IsFenced = (offset: number) => boolean;

function findAllTables(source: string, isFenced?: IsFenced): TableModel[] {
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

// --- exported under `legacy*` names ---------------------------------------

export {
  splitLines as legacySplitLines,
  findLineIndex as legacyFindLineIndex,
  isTableCandidateLine as legacyIsTableCandidateLine,
  isDelimiterLine as legacyIsDelimiterLine,
  countLeadingSpaces as legacyCountLeadingSpaces,
  hasUnescapedPipe as legacyHasUnescapedPipe,
  splitCellTexts as legacySplitCellTexts,
  parseRowCells as legacyParseRowCells,
  parseAlignment as legacyParseAlignment,
  parseTableAt as legacyParseTableAt,
  findAllTables as legacyFindAllTables,
};
export type { IsFenced as LegacyIsFenced };
