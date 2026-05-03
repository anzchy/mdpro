/**
 * @module tableParser/serialize
 * Purpose: Render TableModels (or raw rows + alignments) back to GFM
 * markdown. Round-trips with `parseTableAt`. Used by `tableEdits`
 * (Phase 2 WI-2.4) to write back into the source range after a
 * structural mutation.
 *
 * @coordinates-with src/utils/tableParser/parse.ts
 * @coordinates-with src/utils/tableEdits.ts
 */

import type {
  ColumnAlignment,
  TableCell,
  TableModel,
} from "./types";

/**
 * Render a TableModel back to GFM markdown. Padding aligns the pipes
 * column-by-column for readable raw markdown.
 */
export function serializeModel(model: TableModel): string {
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

/**
 * Render a synthesized table from raw row text + alignments. Used by
 * `tableEdits` to write back into `[model.start, model.end)` after a
 * structural edit. Output has NO trailing newline — drop-in
 * replacement for `model.raw`.
 */
export function serializeRows(
  rows: string[][],
  alignments: ColumnAlignment[],
): string {
  if (rows.length === 0) return "";
  const colCount = alignments.length;
  const widths = new Array(colCount).fill(3);
  for (const row of rows) {
    for (let c = 0; c < Math.min(row.length, colCount); c += 1) {
      widths[c] = Math.max(widths[c], row[c].length);
    }
  }
  const headerCells: TableCell[] = padRow(rows[0], colCount).map((text, c) => ({
    start: 0,
    end: 0,
    text,
    row: 0,
    col: c,
  }));
  const lines: string[] = [];
  lines.push(emitRow(headerCells, widths));
  lines.push(emitDelimiterRow(alignments, widths));
  for (let r = 1; r < rows.length; r += 1) {
    const bodyCells: TableCell[] = padRow(rows[r], colCount).map((text, c) => ({
      start: 0,
      end: 0,
      text,
      row: r,
      col: c,
    }));
    lines.push(emitRow(bodyCells, widths));
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function padRow(row: string[], colCount: number): string[] {
  const out = row.slice(0, colCount);
  while (out.length < colCount) out.push("");
  return out;
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
