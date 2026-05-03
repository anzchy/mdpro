/**
 * @module cursor-sync-table.test
 * Purpose: Verify the pure source-side helpers + capture slot for the
 * cross-mode table cursor sync (Phase 2 WI-2.6). The ProseMirror-aware
 * capture/restore lives in `cursorSync/tableMilkdown.ts` and is
 * exercised through integration in `tests/mode-toggle-table-cursor-sync`.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  captureCellFromSource,
  consumePendingTableCell,
  findAllTables,
  getPendingTableCell,
  locateCellInSource,
  setPendingTableCell,
} from "../src/utils/cursorSync/table";

afterEach(() => {
  // The capture slot is module-level — reset between tests.
  setPendingTableCell(null);
});

const TWO_TABLE_DOC =
  "First.\n\n" +
  "| a | b |\n| - | - |\n| 1 | 2 |\n" +
  "\nSome prose.\n\n" +
  "| x | y | z |\n| - | - | - |\n| 7 | 8 | 9 |\n| 4 | 5 | 6 |\n" +
  "\nLast.\n";

// ---------------------------------------------------------------------------
// findAllTables
// ---------------------------------------------------------------------------

describe("findAllTables", () => {
  it("returns an empty array when the doc has no tables", () => {
    expect(findAllTables("Just prose.\nMore prose.\n")).toEqual([]);
  });

  it("finds a single table at the top of the doc", () => {
    const md = "| a | b |\n| - | - |\n| 1 | 2 |\n";
    const tables = findAllTables(md);
    expect(tables).toHaveLength(1);
    expect(tables[0].colCount).toBe(2);
    expect(tables[0].rowCount).toBe(2);
  });

  it("finds multiple tables in document order", () => {
    const tables = findAllTables(TWO_TABLE_DOC);
    expect(tables).toHaveLength(2);
    expect(tables[0].colCount).toBe(2);
    expect(tables[1].colCount).toBe(3);
    // Tables should be non-overlapping and in document order.
    expect(tables[0].end).toBeLessThan(tables[1].start);
  });

  // Audit-fix H1: a fenced code block containing pipe-shaped lines must
  // not be enumerated, otherwise tableIndex drifts vs. the WYSIWYG side
  // (Milkdown's `descendants` walk doesn't see fenced content as tables).
  it("skips tables inside fenced code blocks when an isFenced predicate is supplied", () => {
    const md =
      "```\n" +
      "| fake | fake |\n| ---- | ---- |\n| 0    | 0    |\n" +
      "```\n\n" +
      "| real | data |\n| ---- | ---- |\n| 1    | 2    |\n";
    const fenceStart = md.indexOf("```");
    const fenceEnd = md.indexOf("```\n\n") + 4; // exclusive of trailing blank line
    const isFenced = (offset: number) =>
      offset >= fenceStart && offset < fenceEnd;
    const tables = findAllTables(md, isFenced);
    expect(tables).toHaveLength(1);
    expect(tables[0].rows[0][0].text).toBe("real");
  });

  it("captureCellFromSource ignores positions inside fences and indexes only real tables", () => {
    const md =
      "```\n| fake | fake |\n| ---- | ---- |\n```\n\n" +
      "| real | data |\n| ---- | ---- |\n| 1    | 2    |\n";
    const fenceStart = md.indexOf("```");
    const fenceEnd = md.indexOf("```\n\n") + 4;
    const isFenced = (offset: number) =>
      offset >= fenceStart && offset < fenceEnd;
    // Cursor in the real table — should still be captured even though a
    // fenced "table" appears earlier.
    const realCell = md.indexOf("| 1") + 2;
    const captured = captureCellFromSource(md, realCell, isFenced);
    expect(captured).toEqual({ tableIndex: 0, rowIndex: 1, colIndex: 0 });
  });

  it("captureCellFromSource returns null when the cursor itself is inside a fence", () => {
    const md = "```\n| a | b |\n| - | - |\n| 1 | 2 |\n```\n";
    const inFence = md.indexOf("| 1") + 2;
    const isFenced = (offset: number) => offset > 0 && offset < md.length - 4;
    expect(captureCellFromSource(md, inFence, isFenced)).toBeNull();
  });

  it("locateCellInSource also filters fenced tables to keep tableIndex consistent with capture", () => {
    const md =
      "```\n| fake | fake |\n| ---- | ---- |\n```\n\n" +
      "| real | data |\n| ---- | ---- |\n| 1    | 2    |\n";
    const fenceStart = md.indexOf("```");
    const fenceEnd = md.indexOf("```\n\n") + 4;
    const isFenced = (offset: number) =>
      offset >= fenceStart && offset < fenceEnd;
    // tableIndex 0 with the predicate must point at the REAL table.
    const offset = locateCellInSource(
      md,
      { tableIndex: 0, rowIndex: 1, colIndex: 0 },
      isFenced,
    );
    expect(offset).not.toBeNull();
    // The offset should point inside the real table's `1` cell.
    // (Cell offsets include leading padding — `text` is trimmed but
    // `start`/`end` track the raw segment.)
    expect(md.slice(offset!).trimStart().startsWith("1")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// captureCellFromSource
// ---------------------------------------------------------------------------

describe("captureCellFromSource", () => {
  it("returns null when the offset is outside any table", () => {
    expect(captureCellFromSource(TWO_TABLE_DOC, 0)).toBeNull();
  });

  it("captures cell coords for the first table", () => {
    const offset = TWO_TABLE_DOC.indexOf("| 1") + 2; // inside `1`
    const pos = captureCellFromSource(TWO_TABLE_DOC, offset);
    expect(pos).toEqual({ tableIndex: 0, rowIndex: 1, colIndex: 0 });
  });

  it("captures cell coords for the second table with the correct tableIndex", () => {
    const offset = TWO_TABLE_DOC.indexOf("| 8") + 2; // body row of table 2
    const pos = captureCellFromSource(TWO_TABLE_DOC, offset);
    expect(pos).toEqual({ tableIndex: 1, rowIndex: 1, colIndex: 1 });
  });

  it("returns null when the offset is in the delimiter row (no body cell)", () => {
    const md = "| a | b |\n| - | - |\n| 1 | 2 |\n";
    const offset = md.indexOf("| -") + 2; // delimiter
    expect(captureCellFromSource(md, offset)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// locateCellInSource
// ---------------------------------------------------------------------------

describe("locateCellInSource", () => {
  it("returns the cell start offset for a valid (tableIndex, row, col)", () => {
    const offset = locateCellInSource(TWO_TABLE_DOC, {
      tableIndex: 1,
      rowIndex: 2,
      colIndex: 2,
    });
    expect(offset).not.toBeNull();
    // Offset should be within table 2's range.
    const tables = findAllTables(TWO_TABLE_DOC);
    expect(offset!).toBeGreaterThanOrEqual(tables[1].start);
    expect(offset!).toBeLessThanOrEqual(tables[1].end);
  });

  it("returns null when the tableIndex is out of range", () => {
    expect(
      locateCellInSource(TWO_TABLE_DOC, { tableIndex: 5, rowIndex: 0, colIndex: 0 }),
    ).toBeNull();
  });

  it("returns null when (row, col) is out of range for the chosen table", () => {
    expect(
      locateCellInSource(TWO_TABLE_DOC, { tableIndex: 0, rowIndex: 99, colIndex: 0 }),
    ).toBeNull();
    expect(
      locateCellInSource(TWO_TABLE_DOC, { tableIndex: 0, rowIndex: 0, colIndex: 99 }),
    ).toBeNull();
  });

  it("round-trips capture → locate for every body cell", () => {
    // For each cell in TWO_TABLE_DOC, capture its offset, then locate it back.
    const tables = findAllTables(TWO_TABLE_DOC);
    for (let t = 0; t < tables.length; t += 1) {
      for (const cell of tables[t].cells) {
        const captured = captureCellFromSource(TWO_TABLE_DOC, cell.start);
        expect(captured).toEqual({
          tableIndex: t,
          rowIndex: cell.row,
          colIndex: cell.col,
        });
        const located = locateCellInSource(TWO_TABLE_DOC, captured!);
        expect(located).toBe(cell.start);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// pending-cell slot
// ---------------------------------------------------------------------------

describe("pending-cell slot", () => {
  it("starts empty", () => {
    expect(getPendingTableCell()).toBeNull();
  });

  it("setPendingTableCell + getPendingTableCell round-trips", () => {
    setPendingTableCell({ tableIndex: 1, rowIndex: 2, colIndex: 0 });
    expect(getPendingTableCell()).toEqual({
      tableIndex: 1,
      rowIndex: 2,
      colIndex: 0,
    });
  });

  it("consumePendingTableCell returns and clears", () => {
    setPendingTableCell({ tableIndex: 0, rowIndex: 1, colIndex: 1 });
    expect(consumePendingTableCell()).toEqual({
      tableIndex: 0,
      rowIndex: 1,
      colIndex: 1,
    });
    expect(getPendingTableCell()).toBeNull();
    // Second consume returns null.
    expect(consumePendingTableCell()).toBeNull();
  });

  it("setPendingTableCell(null) clears the slot", () => {
    setPendingTableCell({ tableIndex: 0, rowIndex: 0, colIndex: 0 });
    setPendingTableCell(null);
    expect(getPendingTableCell()).toBeNull();
  });
});
