/**
 * @module tableParser/types
 * Purpose: Public types for the GFM table parser. Lives in its own file
 * so consumers (cursor sync, source-mode plugins, MCP tools) can
 * import types without pulling parse/serialize implementations.
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

/** Internal — line range with inclusive start, exclusive end (excluding `\n`). */
export interface LineRange {
  /** Start offset in source (inclusive). */
  start: number;
  /** End offset in source (exclusive of the trailing `\n` if present). */
  end: number;
  /** Line content WITHOUT the trailing newline. May contain `\r`. */
  text: string;
}

/** CommonMark: 4+ leading spaces is an indented code block, not a table. */
export const MAX_INDENT = 3;
