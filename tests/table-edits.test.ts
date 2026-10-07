// @vitest-environment node
/**
 * @module table-edits.test
 * Purpose: Verify the pure source-mode table-edit functions (Phase 2
 * WI-2.4). Each edit takes a parsed TableModel + action context and
 * returns the new source for the table region plus a cursor offset.
 *
 * These functions are the heart of the source-mode context menu — the
 * dispatcher (sourceTableContextMenu.ts) is a thin wrapper that splices
 * `result.source` into `[model.start, model.end)` and places the cursor
 * at `model.start + result.cursorOffset`.
 *
 * Coverage strategy: round-trip every edit (apply → re-parse → assert
 * shape). This tests serialization correctness AND structural mutation
 * in one pass.
 */

import { describe, expect, it } from "vitest";
import { parseTableAt } from "../src/utils/tableParser";
import {
  applyEdit,
  insertRowBefore,
  insertRowAfter,
  insertColumnBefore,
  insertColumnAfter,
  deleteRow,
  deleteColumn,
  deleteTable,
  moveRowUp,
  moveRowDown,
  moveColumnLeft,
  moveColumnRight,
  setAlignment,
} from "../src/utils/tableEdits";
import type { TableContext } from "../src/plugins/milkdown/table/types";

const SIMPLE_MD = "| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n";

function ctxAt(rowIndex: number, colIndex: number, model = parseTableAt(SIMPLE_MD, 0)!): TableContext {
  return {
    rowIndex,
    colIndex,
    rowCount: model.rowCount,
    colCount: model.colCount,
    alignment: (model.alignments[colIndex] ?? "left") as TableContext["alignment"],
  };
}

// ---------------------------------------------------------------------------
// insertRowBefore / insertRowAfter
// ---------------------------------------------------------------------------

describe("insertRowBefore", () => {
  it("inserts a blank row above the body row at rowIdx", () => {
    const model = parseTableAt(SIMPLE_MD, 0)!;
    const result = insertRowBefore(model, ctxAt(1, 1)); // body row [1,2,3]
    const reParsed = parseTableAt(result.source, 0)!;
    expect(reParsed.rowCount).toBe(model.rowCount + 1);
    expect(reParsed.rows[1].every((c) => c.text === "")).toBe(true);
    // Old [1,2,3] body row is now at row 2.
    expect(reParsed.rows[2][0].text).toBe("1");
  });

  it("places cursor at the start of the new row's cell at colIndex", () => {
    const model = parseTableAt(SIMPLE_MD, 0)!;
    const result = insertRowBefore(model, ctxAt(1, 2));
    const reParsed = parseTableAt(result.source, 0)!;
    // Cursor should land in the new (empty) cell at row 1, col 2.
    expect(result.cursorOffset).toBe(reParsed.rows[1][2].start);
  });

  it("works at the header row — new row becomes the header", () => {
    const model = parseTableAt(SIMPLE_MD, 0)!;
    const result = insertRowBefore(model, ctxAt(0, 0));
    const reParsed = parseTableAt(result.source, 0)!;
    expect(reParsed.rows[0].every((c) => c.text === "")).toBe(true);
    expect(reParsed.rows[1][0].text).toBe("a"); // old header is now body
  });
});

describe("insertRowAfter", () => {
  it("inserts a blank row below the body row at rowIdx", () => {
    const model = parseTableAt(SIMPLE_MD, 0)!;
    const result = insertRowAfter(model, ctxAt(1, 1));
    const reParsed = parseTableAt(result.source, 0)!;
    expect(reParsed.rowCount).toBe(model.rowCount + 1);
    expect(reParsed.rows[2].every((c) => c.text === "")).toBe(true);
    expect(reParsed.rows[1][0].text).toBe("1"); // old body row stays
    expect(reParsed.rows[3][0].text).toBe("4"); // old [4,5,6] shifted down
  });

  it("at the header row — inserts the new row at index 1 (first body)", () => {
    const model = parseTableAt(SIMPLE_MD, 0)!;
    const result = insertRowAfter(model, ctxAt(0, 0));
    const reParsed = parseTableAt(result.source, 0)!;
    expect(reParsed.rows[0][0].text).toBe("a"); // header stays
    expect(reParsed.rows[1].every((c) => c.text === "")).toBe(true);
  });

  it("places cursor in the new row at the same colIndex", () => {
    const model = parseTableAt(SIMPLE_MD, 0)!;
    const result = insertRowAfter(model, ctxAt(2, 1));
    const reParsed = parseTableAt(result.source, 0)!;
    expect(result.cursorOffset).toBe(reParsed.rows[3][1].start);
  });
});

// ---------------------------------------------------------------------------
// insertColumnBefore / insertColumnAfter
// ---------------------------------------------------------------------------

describe("insertColumnBefore", () => {
  it("inserts a new empty column to the left of colIdx", () => {
    const model = parseTableAt(SIMPLE_MD, 0)!;
    const result = insertColumnBefore(model, ctxAt(1, 1));
    const reParsed = parseTableAt(result.source, 0)!;
    expect(reParsed.colCount).toBe(model.colCount + 1);
    // Column 1 is the new empty column; old col `b` is now at col 2.
    expect(reParsed.rows[0][1].text).toBe("");
    expect(reParsed.rows[0][2].text).toBe("b");
    expect(reParsed.rows[1][1].text).toBe("");
    expect(reParsed.rows[1][2].text).toBe("2");
  });

  it("inherits no alignment for the new column (null)", () => {
    const aligned = "| a | b |\n| :- | -: |\n| 1 | 2 |\n";
    const model = parseTableAt(aligned, 0)!;
    const result = insertColumnBefore(model, ctxAt(0, 1, model));
    const reParsed = parseTableAt(result.source, 0)!;
    expect(reParsed.alignments).toEqual(["left", null, "right"]);
  });

  it("places cursor in the new column at the same rowIndex", () => {
    const model = parseTableAt(SIMPLE_MD, 0)!;
    const result = insertColumnBefore(model, ctxAt(2, 2));
    const reParsed = parseTableAt(result.source, 0)!;
    expect(result.cursorOffset).toBe(reParsed.rows[2][2].start);
  });
});

describe("insertColumnAfter", () => {
  it("inserts a new empty column to the right of colIdx", () => {
    const model = parseTableAt(SIMPLE_MD, 0)!;
    const result = insertColumnAfter(model, ctxAt(0, 1));
    const reParsed = parseTableAt(result.source, 0)!;
    expect(reParsed.colCount).toBe(model.colCount + 1);
    expect(reParsed.rows[0][1].text).toBe("b");
    expect(reParsed.rows[0][2].text).toBe(""); // new column
    expect(reParsed.rows[0][3].text).toBe("c");
  });

  it("at the last column — appends a new column at the end", () => {
    const model = parseTableAt(SIMPLE_MD, 0)!;
    const result = insertColumnAfter(model, ctxAt(0, 2));
    const reParsed = parseTableAt(result.source, 0)!;
    expect(reParsed.colCount).toBe(model.colCount + 1);
    expect(reParsed.rows[0][3].text).toBe("");
  });
});

// ---------------------------------------------------------------------------
// deleteRow
// ---------------------------------------------------------------------------

describe("deleteRow", () => {
  it("removes the body row at rowIdx", () => {
    const model = parseTableAt(SIMPLE_MD, 0)!;
    const result = deleteRow(model, ctxAt(1, 0));
    const reParsed = parseTableAt(result.source, 0)!;
    expect(reParsed.rowCount).toBe(model.rowCount - 1);
    expect(reParsed.rows[1][0].text).toBe("4"); // [4,5,6] is now the only body row
  });

  it("removes the header row — first body row becomes the new header", () => {
    const model = parseTableAt(SIMPLE_MD, 0)!;
    const result = deleteRow(model, ctxAt(0, 0));
    const reParsed = parseTableAt(result.source, 0)!;
    expect(reParsed.rows[0][0].text).toBe("1");
  });

  it("places cursor at the same rowIdx after delete (or last row if was last)", () => {
    const model = parseTableAt(SIMPLE_MD, 0)!;
    // Delete row 1 → cursor lands on what is now row 1 (was row 2)
    const result = deleteRow(model, ctxAt(1, 0));
    const reParsed = parseTableAt(result.source, 0)!;
    expect(result.cursorOffset).toBe(reParsed.rows[1][0].start);
  });

  it("when only one row remains and it is deleted, returns an empty table", () => {
    const md = "| a |\n| - |\n";
    const model = parseTableAt(md, 0)!;
    const result = deleteRow(model, ctxAt(0, 0, model));
    expect(result.source).toBe("");
  });
});

// ---------------------------------------------------------------------------
// deleteColumn
// ---------------------------------------------------------------------------

describe("deleteColumn", () => {
  it("removes the column at colIdx and its alignment", () => {
    const aligned = "| a | b | c |\n| :- | :-: | -: |\n| 1 | 2 | 3 |\n";
    const model = parseTableAt(aligned, 0)!;
    const result = deleteColumn(model, ctxAt(0, 1, model));
    const reParsed = parseTableAt(result.source, 0)!;
    expect(reParsed.colCount).toBe(2);
    expect(reParsed.rows[0][0].text).toBe("a");
    expect(reParsed.rows[0][1].text).toBe("c");
    expect(reParsed.alignments).toEqual(["left", "right"]);
  });

  it("places cursor in the same rowIdx, clamped colIdx", () => {
    const model = parseTableAt(SIMPLE_MD, 0)!;
    // Delete the last column at colIdx=2 → cursor moves to new last column (1)
    const result = deleteColumn(model, ctxAt(2, 2));
    const reParsed = parseTableAt(result.source, 0)!;
    expect(result.cursorOffset).toBe(reParsed.rows[2][1].start);
  });

  it("when the only column is deleted, returns an empty table", () => {
    const md = "| a |\n| - |\n| 1 |\n";
    const model = parseTableAt(md, 0)!;
    const result = deleteColumn(model, ctxAt(0, 0, model));
    expect(result.source).toBe("");
  });
});

// ---------------------------------------------------------------------------
// deleteTable
// ---------------------------------------------------------------------------

describe("deleteTable", () => {
  it("returns an empty source string", () => {
    const model = parseTableAt(SIMPLE_MD, 0)!;
    const result = deleteTable(model, ctxAt(1, 1));
    expect(result.source).toBe("");
    expect(result.cursorOffset).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// moveRowUp / moveRowDown
// ---------------------------------------------------------------------------

describe("moveRowUp", () => {
  it("swaps row at rowIdx with the row above", () => {
    const model = parseTableAt(SIMPLE_MD, 0)!;
    const result = moveRowUp(model, ctxAt(2, 0)); // [4,5,6] up to row 1
    const reParsed = parseTableAt(result.source, 0)!;
    expect(reParsed.rows[1][0].text).toBe("4");
    expect(reParsed.rows[2][0].text).toBe("1");
  });

  it("places cursor at the moved cell's new position", () => {
    const model = parseTableAt(SIMPLE_MD, 0)!;
    const result = moveRowUp(model, ctxAt(2, 1));
    const reParsed = parseTableAt(result.source, 0)!;
    expect(result.cursorOffset).toBe(reParsed.rows[1][1].start);
  });
});

describe("moveRowDown", () => {
  it("swaps row at rowIdx with the row below", () => {
    const model = parseTableAt(SIMPLE_MD, 0)!;
    const result = moveRowDown(model, ctxAt(1, 0)); // [1,2,3] down to row 2
    const reParsed = parseTableAt(result.source, 0)!;
    expect(reParsed.rows[1][0].text).toBe("4");
    expect(reParsed.rows[2][0].text).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// moveColumnLeft / moveColumnRight
// ---------------------------------------------------------------------------

describe("moveColumnLeft / Right", () => {
  it("moveColumnLeft swaps colIdx with colIdx-1 in every row, including alignments", () => {
    const aligned = "| a | b | c |\n| :- | :-: | -: |\n| 1 | 2 | 3 |\n";
    const model = parseTableAt(aligned, 0)!;
    const result = moveColumnLeft(model, ctxAt(0, 2, model)); // c moves left to col 1
    const reParsed = parseTableAt(result.source, 0)!;
    expect(reParsed.rows[0].map((c) => c.text)).toEqual(["a", "c", "b"]);
    expect(reParsed.alignments).toEqual(["left", "right", "center"]);
  });

  it("moveColumnRight swaps colIdx with colIdx+1", () => {
    const model = parseTableAt(SIMPLE_MD, 0)!;
    const result = moveColumnRight(model, ctxAt(0, 0));
    const reParsed = parseTableAt(result.source, 0)!;
    expect(reParsed.rows[0].map((c) => c.text)).toEqual(["b", "a", "c"]);
  });

  it("cursor follows the moved column", () => {
    const model = parseTableAt(SIMPLE_MD, 0)!;
    const result = moveColumnRight(model, ctxAt(2, 0));
    const reParsed = parseTableAt(result.source, 0)!;
    expect(result.cursorOffset).toBe(reParsed.rows[2][1].start);
  });
});

// ---------------------------------------------------------------------------
// setAlignment
// ---------------------------------------------------------------------------

describe("setAlignment", () => {
  it("sets the alignment for the column at colIdx", () => {
    const model = parseTableAt(SIMPLE_MD, 0)!;
    const result = setAlignment(model, ctxAt(0, 1), "center");
    const reParsed = parseTableAt(result.source, 0)!;
    expect(reParsed.alignments).toEqual([null, "center", null]);
  });

  it("preserves cell content unchanged", () => {
    const model = parseTableAt(SIMPLE_MD, 0)!;
    const result = setAlignment(model, ctxAt(0, 0), "right");
    const reParsed = parseTableAt(result.source, 0)!;
    expect(reParsed.rows[0].map((c) => c.text)).toEqual(["a", "b", "c"]);
    expect(reParsed.rows[1].map((c) => c.text)).toEqual(["1", "2", "3"]);
  });

  it("cursor stays at the original cell", () => {
    const model = parseTableAt(SIMPLE_MD, 0)!;
    const result = setAlignment(model, ctxAt(2, 1), "left");
    const reParsed = parseTableAt(result.source, 0)!;
    expect(result.cursorOffset).toBe(reParsed.rows[2][1].start);
  });
});

// ---------------------------------------------------------------------------
// applyEdit (action-id dispatcher)
// ---------------------------------------------------------------------------

describe("applyEdit", () => {
  it("dispatches the matching edit function for each action id", () => {
    const model = parseTableAt(SIMPLE_MD, 0)!;
    const ctx = ctxAt(1, 1);
    const insertResult = applyEdit(model, ctx, "insert_row_before");
    expect(insertResult).not.toBeNull();
    const reParsed = parseTableAt(insertResult!.source, 0)!;
    expect(reParsed.rowCount).toBe(model.rowCount + 1);
  });

  it("returns null for disabled actions (move at boundary)", () => {
    const model = parseTableAt(SIMPLE_MD, 0)!;
    const result = applyEdit(model, ctxAt(0, 0), "move_row_up");
    expect(result).toBeNull();
  });

  it("returns null for move_column_right at last column", () => {
    const model = parseTableAt(SIMPLE_MD, 0)!;
    const result = applyEdit(model, ctxAt(0, 2), "move_column_right");
    expect(result).toBeNull();
  });

  it("dispatches align_left/center/right correctly", () => {
    const model = parseTableAt(SIMPLE_MD, 0)!;
    const result = applyEdit(model, ctxAt(0, 1), "align_center");
    const reParsed = parseTableAt(result!.source, 0)!;
    expect(reParsed.alignments[1]).toBe("center");
  });

  it("dispatches delete_table to empty source", () => {
    const model = parseTableAt(SIMPLE_MD, 0)!;
    const result = applyEdit(model, ctxAt(1, 1), "delete_table");
    expect(result!.source).toBe("");
  });
});
