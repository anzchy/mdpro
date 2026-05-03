/**
 * @module tableParser
 * Purpose: Pure GFM table parser (Phase 2 WI-2.0). Single source of
 * truth for source-mode detection, Tab navigation, source-mode context
 * menu, lint rule, formatter, and Phase 3 MCP tools — they all need to
 * "find cell boundaries in this source range" and must not ship their
 * own pipe-scanning regex.
 *
 * GFM table format:
 *
 *   | Header A | Header B |   ← header row (edge pipes optional)
 *   | :------- | -------: |   ← delimiter row (alignment via colons)
 *   | cell 1   | cell 2   |   ← body rows
 *
 * Edge cases handled:
 *   - escaped `\|` inside cell content
 *   - missing leading/trailing `|`
 *   - up to 3 leading spaces (CommonMark indented-code boundary)
 *   - CRLF normalized to LF for processing; offsets refer to the
 *     ORIGINAL source so callers don't need to translate
 *   - body rows shorter/longer than header (padded / truncated per GFM)
 *
 * Out of scope for v1:
 *   - tables inside blockquotes (`> | a | b |`)
 *   - tables inside list items (multi-paragraph lists with embedded tables)
 *   - tables inside fenced code blocks (caller responsibility — fence
 *     detection lives in the CodeMirror integration layer that consumes
 *     this parser; the parser itself does NOT scan for fences because
 *     it operates on a single table-shaped region the caller hands it)
 *
 * @coordinates-with src/plugins/codemirror/sourceTableDetection.ts (planned WI-2.2)
 * @coordinates-with src/plugins/codemirror/sourceTableTabNav.ts (planned WI-2.3)
 * @coordinates-with src/plugins/codemirror/sourceTableContextMenu.ts (planned WI-2.4)
 * @coordinates-with src/utils/tableFormatter.ts (planned WI-3.2)
 * @coordinates-with src/plugins/codemirror/lintTableColumnCount.ts (planned WI-3.1)
 */

export type ColumnAlignment = "left" | "center" | "right" | null;

export interface TableCell {
  /** Character offset (inclusive) within the original source. */
  start: number;
  /** Character offset (exclusive). */
  end: number;
  /** Cell content with leading/trailing whitespace trimmed. */
  text: string;
  /** Row index (0 = header). */
  row: number;
  /** Column index (0 = leftmost). */
  col: number;
}

export interface TableModel {
  /** Source offset (inclusive) of the first character of the table. */
  start: number;
  /** Source offset (exclusive) of the end of the table. */
  end: number;
  /** Header + body row count. */
  rowCount: number;
  /** Column count derived from the header / delimiter rows. */
  colCount: number;
  /** Per-column alignment from the delimiter row. */
  alignments: ColumnAlignment[];
  /** All cells in row-major order. */
  cells: TableCell[];
  /** Cells indexed as rows[row][col]. */
  rows: TableCell[][];
  /** The exact substring of the original source that the table occupies. */
  raw: string;
}

interface LineRange {
  /** Start offset in source (inclusive). */
  start: number;
  /** End offset in source (exclusive of the trailing `\n` if present). */
  end: number;
  /** Line content WITHOUT the trailing newline. May contain `\r`. */
  text: string;
}

const MAX_INDENT = 3; // CommonMark: 4+ spaces is an indented code block.

/**
 * Locate a GFM table containing `offset`. Returns null when no table
 * is found at or around the given source position.
 */
export function parseTableAt(source: string, offset: number): TableModel | null {
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

/**
 * Locate the cell at a given character offset within the original
 * source. Returns null when the offset is between cells (e.g., inside
 * a `|` separator or in the delimiter row).
 */
export function findCell(model: TableModel, offset: number): TableCell | null {
  for (const cell of model.cells) {
    if (offset >= cell.start && offset < cell.end) return cell;
  }
  return null;
}

/**
 * Render a TableModel back to GFM markdown. Padding aligns the pipes
 * column-by-column for readable raw markdown. Round-trips with
 * `parseTableAt`.
 */
export function serializeModel(model: TableModel): string {
  // Compute the visual width of each column from the maximum cell text
  // length — keeps the pipes lined up in the source.
  const widths = computeColumnWidths(model);

  const headerRow = model.rows[0];
  const lines: string[] = [];
  lines.push(emitRow(headerRow, widths));
  lines.push(emitDelimiterRow(model.alignments, widths));
  for (let i = 1; i < model.rows.length; i += 1) {
    lines.push(emitRow(model.rows[i], widths));
  }
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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

/**
 * A line is a table candidate if it:
 *  - has up to 3 leading spaces of indent (4+ is a code block in CM)
 *  - contains at least one unescaped `|`
 *  - is not blank
 */
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

/**
 * Split a row line into cell text segments, respecting `\|` escapes
 * and dropping the empty segments that appear at the edges when the
 * line begins / ends with `|`.
 */
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

/**
 * Parse cells from a row line, computing absolute source offsets so
 * `findCell` can map an offset back to its cell.
 *
 * Pads to colCount with empty cells at the end (GFM: missing trailing
 * cells are empty). Truncates if the row has more cells than the
 * header (GFM: excess cells are ignored).
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
  let firstSegEdgePipe = false; // tracks whether the first `|` was an edge pipe

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
        firstSegEdgePipe = true;
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

  void firstSegEdgePipe; // intentional: tracked for future debug logging

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

function computeColumnWidths(model: TableModel): number[] {
  const widths = new Array(model.colCount).fill(3); // min 3 for `---`
  for (const row of model.rows) {
    for (let c = 0; c < row.length; c += 1) {
      widths[c] = Math.max(widths[c], row[c].text.length);
    }
  }
  return widths;
}

function emitRow(row: TableCell[], widths: number[]): string {
  const parts = row.map((cell, c) => ` ${cell.text.padEnd(widths[c])} `);
  return "|" + parts.join("|") + "|";
}

function emitDelimiterRow(alignments: ColumnAlignment[], widths: number[]): string {
  const parts = alignments.map((align, c) => {
    const w = widths[c];
    switch (align) {
      case "left":
        return ` :${"-".repeat(w - 1)} `;
      case "right":
        return ` ${"-".repeat(w - 1)}: `;
      case "center":
        return ` :${"-".repeat(Math.max(w - 2, 1))}: `;
      default:
        return ` ${"-".repeat(w)} `;
    }
  });
  return "|" + parts.join("|") + "|";
}
