/**
 * @module tableParser/rowCells
 * Purpose: Split ONE table row line into its `TableCell`s with absolute
 * source offsets (D12 WI-1, ADR-0043). Moved verbatim out of `parse.ts`
 * so the cursor path can build a single row's cells without building the
 * whole model: `parse.ts#parseTableAtLine` calls it once per row, and
 * `locate.ts#cellAtResolvedLine` (D12 WI-3) calls it for the cursor's row
 * only.
 *
 * Folder-scoped: imported by path, deliberately absent from the `index.ts`
 * barrel, like `parseTableAtLine` and `scan.ts`.
 *
 * Key decisions:
 *  - `countLeadingSpaces` here is a CHARACTER count and must stay one — it
 *    is the base of every cell's absolute offset. Do not swap in
 *    `commonmark.ts#countIndentColumns`: columns and characters part
 *    company on tabs, and the substitution would move every
 *    `TableCell.start/end`.
 *  - Behaviour is pinned byte-for-byte against the frozen HEAD copy in
 *    `tests/support/frozenTableParse.ts` (`tests/table-row-cells.test.ts`).
 *
 * @coordinates-with src/utils/tableParser/parse.ts
 * @coordinates-with src/utils/tableParser/locate.ts
 * @coordinates-with src/utils/tableParser/commonmark.ts
 * @coordinates-with src/utils/tableParser/find.ts
 */

import { countLeadingSpaces } from "./commonmark";
import { type LineRange, type TableCell } from "./types";

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
export function parseRowCells(line: LineRange, rowIdx: number, colCount: number): TableCell[] {
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
