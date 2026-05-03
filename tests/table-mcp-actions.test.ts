/**
 * @module table-mcp-actions.test
 * Purpose: Verify the pure source-level helpers behind the MCP table
 * tools (Phase 3 WI-3.3). Each helper takes a source string and an
 * action payload, returns either the new source or null on invalid
 * input. The frontend's `useMcpEvents` handler calls these on
 * receipt of `mcp:table_action` events from Rust.
 */

import { describe, expect, it } from "vitest";
import {
  applyMcpTableAction,
  insertTable,
  setCell,
} from "../src/utils/tableMcp";
import { parseTableAt } from "../src/utils/tableParser";
import { findAllTables } from "../src/utils/cursorSync/table";

const TWO_TABLE_DOC =
  "Intro.\n\n" +
  "| a | b |\n| - | - |\n| 1 | 2 |\n" +
  "\nMid.\n\n" +
  "| x | y | z |\n| - | - | - |\n| 7 | 8 | 9 |\n";

// ---------------------------------------------------------------------------
// insert_table
// ---------------------------------------------------------------------------

describe("insertTable", () => {
  it("appends a new empty table to a doc with no tables", () => {
    const out = insertTable("Just prose.\n", { rows: 2, cols: 3 });
    expect(out).not.toBeNull();
    expect(out).toContain("|");
    const tables = findAllTables(out!);
    expect(tables).toHaveLength(1);
    expect(tables[0].colCount).toBe(3);
    expect(tables[0].rowCount).toBe(2); // 1 header + 1 body
  });

  it("appends with alignments when supplied", () => {
    const out = insertTable("\n", {
      rows: 2,
      cols: 3,
      alignments: ["left", "center", "right"],
    });
    expect(out).not.toBeNull();
    const tables = findAllTables(out!);
    expect(tables[0].alignments).toEqual(["left", "center", "right"]);
  });

  it("returns null when rows or cols are <= 0", () => {
    expect(insertTable("", { rows: 0, cols: 3 })).toBeNull();
    expect(insertTable("", { rows: 2, cols: 0 })).toBeNull();
    expect(insertTable("", { rows: -1, cols: 3 })).toBeNull();
  });

  it("returns null when alignments length differs from cols", () => {
    expect(
      insertTable("", { rows: 2, cols: 3, alignments: ["left", "right"] }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// set_cell
// ---------------------------------------------------------------------------

describe("setCell", () => {
  it("updates a body cell in the first table by default (tableIndex=0)", () => {
    const out = setCell(TWO_TABLE_DOC, { row: 1, col: 0, content: "NEW" });
    expect(out).not.toBeNull();
    const re = parseTableAt(out!, out!.indexOf("| NEW") + 1)!;
    expect(re.rows[1][0].text).toBe("NEW");
  });

  it("updates a cell in the second table when tableIndex=1", () => {
    const out = setCell(TWO_TABLE_DOC, {
      tableIndex: 1,
      row: 1,
      col: 2,
      content: "Z",
    });
    expect(out).not.toBeNull();
    expect(out).toContain("| Z");
    // First table is unchanged.
    expect(out).toContain("| 1 | 2 |");
  });

  it("returns null when row or col is out of range", () => {
    expect(
      setCell(TWO_TABLE_DOC, { row: 99, col: 0, content: "X" }),
    ).toBeNull();
    expect(
      setCell(TWO_TABLE_DOC, { row: 0, col: 99, content: "X" }),
    ).toBeNull();
  });

  it("returns null when tableIndex is out of range", () => {
    expect(
      setCell(TWO_TABLE_DOC, {
        tableIndex: 99,
        row: 0,
        col: 0,
        content: "X",
      }),
    ).toBeNull();
  });

  it("returns null when there are no tables in the source", () => {
    expect(
      setCell("Just prose.\n", { row: 0, col: 0, content: "X" }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// applyMcpTableAction — dispatcher
// ---------------------------------------------------------------------------

describe("applyMcpTableAction", () => {
  it("dispatches insert_table", () => {
    const out = applyMcpTableAction("\n", "insert_table", {
      rows: 2,
      cols: 2,
    });
    expect(out).toContain("|");
  });

  it("dispatches set_cell", () => {
    const out = applyMcpTableAction(TWO_TABLE_DOC, "set_cell", {
      row: 1,
      col: 0,
      content: "X",
    });
    expect(out).not.toBeNull();
    // serializeRows pads to min 3-char width, so cell "X" becomes "X  ".
    const re = parseTableAt(out!, out!.indexOf("| X"))!;
    expect(re.rows[1][0].text).toBe("X");
  });

  it("dispatches add_row via tableEdits (insert_row_after)", () => {
    const out = applyMcpTableAction(TWO_TABLE_DOC, "add_row", { after: 1 });
    expect(out).not.toBeNull();
    const tableSection = out!.slice(out!.indexOf("| a"), out!.indexOf("\nMid"));
    const lineCount = tableSection.split("\n").filter((l) => l.includes("|")).length;
    // Original had 3 (header, delim, body) — should now have 4.
    expect(lineCount).toBeGreaterThan(3);
  });

  it("dispatches delete_row", () => {
    const out = applyMcpTableAction(TWO_TABLE_DOC, "delete_row", { index: 1 });
    expect(out).not.toBeNull();
    // First table's body row "1, 2" deleted; first table now is header-only.
    const firstTable = findAllTables(out!)[0];
    expect(firstTable.rowCount).toBe(1);
    expect(firstTable.rows[0][0].text).toBe("a");
  });

  it("dispatches add_column", () => {
    const out = applyMcpTableAction(TWO_TABLE_DOC, "add_column", { after: 0 });
    expect(out).not.toBeNull();
    const re = findAllTables(out!)[0];
    expect(re.colCount).toBe(3);
  });

  it("dispatches delete_column", () => {
    const out = applyMcpTableAction(TWO_TABLE_DOC, "delete_column", { index: 0 });
    expect(out).not.toBeNull();
    const re = findAllTables(out!)[0];
    expect(re.colCount).toBe(1);
    expect(re.rows[0][0].text).toBe("b");
  });

  it("returns null for unknown actions", () => {
    expect(
      applyMcpTableAction(TWO_TABLE_DOC, "wat" as never, {}),
    ).toBeNull();
  });

  it("returns null for invalid payloads", () => {
    expect(
      applyMcpTableAction("\n", "insert_table", { rows: 0, cols: 3 }),
    ).toBeNull();
    expect(
      applyMcpTableAction(TWO_TABLE_DOC, "delete_row", { index: 99 }),
    ).toBeNull();
  });
});
