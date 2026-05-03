/**
 * @module table-parser.test
 * Purpose: Verify the shared GFM table parser (Phase 2 WI-2.0).
 * Six downstream consumers depend on this — source-mode detection,
 * Tab nav, context menu, formatter, lint, and Phase 3 MCP tools.
 * Testing exhaustively now means none of those consumers ship their
 * own pipe-scanning regex.
 *
 * GFM table format (informally):
 *   | Header A | Header B |   ← header row (pipes optional at edges)
 *   | :------- | -------: |   ← delimiter row (alignment via colons)
 *   | cell 1   | cell 2   |   ← body rows
 *
 * Edge cases covered: escaped `\|`, missing edge pipes, CRLF, leading
 * whitespace up to 3 spaces (CommonMark allows; 4+ becomes a code
 * block), trailing whitespace, multiple body rows, single-cell rows,
 * default columns (no `:`), `findCell` at boundaries, `serializeModel`
 * round-trip.
 */

import { describe, expect, it } from "vitest";
import {
  findCell,
  parseTableAt,
  serializeModel,
  type ColumnAlignment,
  type TableModel,
} from "../src/utils/tableParser";

// ---------------------------------------------------------------------------
// parseTableAt — happy path + offset semantics
// ---------------------------------------------------------------------------

describe("parseTableAt — recognizes a basic GFM table", () => {
  it("parses a 2-column 1-body-row table at offset 0", () => {
    const md = "| a | b |\n| - | - |\n| 1 | 2 |\n";
    const model = parseTableAt(md, 0);
    expect(model).not.toBeNull();
    expect(model!.rowCount).toBe(2); // header + 1 body
    expect(model!.colCount).toBe(2);
    expect(model!.alignments).toEqual([null, null]);
    expect(model!.rows[0][0].text).toBe("a");
    expect(model!.rows[0][1].text).toBe("b");
    expect(model!.rows[1][0].text).toBe("1");
    expect(model!.rows[1][1].text).toBe("2");
  });

  it("returns the same model for any offset inside the table", () => {
    const md = "| a | b |\n| - | - |\n| 1 | 2 |\n";
    const a = parseTableAt(md, 0)!;
    const b = parseTableAt(md, 12)!; // somewhere inside the delimiter row
    const c = parseTableAt(md, 25)!; // somewhere inside the body row
    expect(a.start).toBe(b.start);
    expect(a.start).toBe(c.start);
    expect(a.end).toBe(b.end);
  });

  it("returns null when offset is before the table", () => {
    const md = "Some prose first.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n";
    expect(parseTableAt(md, 5)).toBeNull();
  });

  it("returns null when offset is after the table", () => {
    const md = "| a | b |\n| - | - |\n| 1 | 2 |\n\nMore prose.\n";
    expect(parseTableAt(md, md.length - 4)).toBeNull();
  });

  it("returns null when offset is out of range", () => {
    const md = "| a | b |\n| - | - |\n| 1 | 2 |\n";
    expect(parseTableAt(md, -1)).toBeNull();
    expect(parseTableAt(md, md.length + 100)).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(parseTableAt("", 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Alignment parsing
// ---------------------------------------------------------------------------

describe("parseTableAt — alignment markers", () => {
  it("parses left / center / right / default alignments", () => {
    const md =
      "| a | b | c | d |\n" +
      "| :- | :-: | -: | - |\n" +
      "| 1 | 2 | 3 | 4 |\n";
    const model = parseTableAt(md, 0)!;
    expect(model.alignments).toEqual<ColumnAlignment[]>([
      "left",
      "center",
      "right",
      null,
    ]);
  });

  it("accepts long dash runs in the delimiter row", () => {
    const md = "| a | b |\n| :------- | -------: |\n| 1 | 2 |\n";
    const model = parseTableAt(md, 0)!;
    expect(model.alignments).toEqual<ColumnAlignment[]>(["left", "right"]);
  });

  it("accepts a delimiter row with whitespace padding", () => {
    const md = "| a | b |\n|   :---:   |   ---:   |\n| 1 | 2 |\n";
    const model = parseTableAt(md, 0)!;
    expect(model.alignments).toEqual<ColumnAlignment[]>(["center", "right"]);
  });
});

// ---------------------------------------------------------------------------
// Cell-content edge cases
// ---------------------------------------------------------------------------

describe("parseTableAt — cell-content edge cases", () => {
  it("preserves escaped pipes \\| inside cell content", () => {
    const md = "| a | b |\n| - | - |\n| pipe \\| inside | other |\n";
    const model = parseTableAt(md, 0)!;
    expect(model.rows[1][0].text).toBe("pipe \\| inside");
    expect(model.rows[1][1].text).toBe("other");
    expect(model.colCount).toBe(2); // not 3 — escape held
  });

  it("trims leading/trailing whitespace from cell text", () => {
    const md = "| a | b |\n| - | - |\n|    1    |   2  |\n";
    const model = parseTableAt(md, 0)!;
    expect(model.rows[1][0].text).toBe("1");
    expect(model.rows[1][1].text).toBe("2");
  });

  it("supports tables without leading/trailing pipes", () => {
    const md = "a | b\n- | -\n1 | 2\n";
    const model = parseTableAt(md, 0)!;
    expect(model).not.toBeNull();
    expect(model.colCount).toBe(2);
    expect(model.rows[0][0].text).toBe("a");
    expect(model.rows[1][1].text).toBe("2");
  });

  it("supports CRLF line endings", () => {
    const md = "| a | b |\r\n| - | - |\r\n| 1 | 2 |\r\n";
    const model = parseTableAt(md, 0)!;
    expect(model.colCount).toBe(2);
    expect(model.rows[1][0].text).toBe("1");
  });

  it("includes multiple body rows in row order", () => {
    const md = "| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |\n";
    const model = parseTableAt(md, 0)!;
    expect(model.rowCount).toBe(4);
    expect(model.rows.map((r) => r.map((c) => c.text))).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
      ["5", "6"],
    ]);
  });

  it("supports a body row missing its trailing newline", () => {
    const md = "| a | b |\n| - | - |\n| 1 | 2 |";
    const model = parseTableAt(md, 0)!;
    expect(model.rowCount).toBe(2);
    expect(model.rows[1][1].text).toBe("2");
  });
});

// ---------------------------------------------------------------------------
// Indentation + CommonMark boundary
// ---------------------------------------------------------------------------

describe("parseTableAt — indentation boundary", () => {
  it("accepts indentation up to 3 spaces", () => {
    const md = "   | a | b |\n   | - | - |\n   | 1 | 2 |\n";
    const model = parseTableAt(md, 0)!;
    expect(model).not.toBeNull();
    expect(model.colCount).toBe(2);
  });

  it("does NOT recognize a table indented 4+ spaces (becomes code block in CommonMark)", () => {
    const md = "    | a | b |\n    | - | - |\n    | 1 | 2 |\n";
    expect(parseTableAt(md, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Negative cases — must not falsely identify a table
// ---------------------------------------------------------------------------

describe("parseTableAt — non-tables", () => {
  it("returns null when the second line is not a delimiter row", () => {
    const md = "| a | b |\n| 1 | 2 |\n";
    expect(parseTableAt(md, 0)).toBeNull();
  });

  it("returns null when the header has fewer columns than the delimiter", () => {
    // GFM requires header column count to match the delimiter row.
    const md = "| a |\n| - | - |\n| 1 | 2 |\n";
    expect(parseTableAt(md, 0)).toBeNull();
  });

  it("returns null when the source has only a delimiter line", () => {
    expect(parseTableAt("| --- | --- |\n", 0)).toBeNull();
  });

  it("returns null when the delimiter cells contain anything other than -:", () => {
    const md = "| a | b |\n| -x- | -y- |\n| 1 | 2 |\n";
    expect(parseTableAt(md, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findCell — locating a cell from a character offset
// ---------------------------------------------------------------------------

describe("findCell", () => {
  const md = "| a | b |\n| - | - |\n| 1 | 2 |\n";

  it("returns the cell containing the offset", () => {
    const model = parseTableAt(md, 0)!;
    // Offset 2 lands inside `a` in the header row
    const cell = findCell(model, 2);
    expect(cell).not.toBeNull();
    expect(cell!.text).toBe("a");
    expect(cell!.row).toBe(0);
    expect(cell!.col).toBe(0);
  });

  it("returns the second cell when the offset lands inside it", () => {
    const model = parseTableAt(md, 0)!;
    // `b` is at index 6 in the header line
    const cell = findCell(model, 6);
    expect(cell!.text).toBe("b");
    expect(cell!.col).toBe(1);
  });

  it("returns the body cell when the offset is in a body row", () => {
    const model = parseTableAt(md, 0)!;
    // Body row starts at offset 20 (header `| a | b |\n` = 9 + delim
    // `| - | - |\n` = 10 → 19; `| 1 ...` starts at 20). Inside `1` ≈ 22.
    const cell = findCell(model, 22);
    expect(cell!.text).toBe("1");
    expect(cell!.row).toBe(1);
    expect(cell!.col).toBe(0);
  });

  it("returns null when the offset is in the delimiter row", () => {
    const model = parseTableAt(md, 0)!;
    // Offset 11 sits inside the delimiter row (delim row covers 9..19)
    expect(findCell(model, 11)).toBeNull();
  });

  it("returns null when the offset is outside the table entirely", () => {
    const model = parseTableAt(md, 0)!;
    expect(findCell(model, 1000)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// serializeModel — round-trip
// ---------------------------------------------------------------------------

describe("serializeModel — round-trip", () => {
  it("emits a valid GFM table that re-parses to an equivalent model", () => {
    const md = "| a | b |\n| - | - |\n| 1 | 2 |\n";
    const model = parseTableAt(md, 0)!;
    const reEmitted = serializeModel(model);
    const reParsed = parseTableAt(reEmitted, 0)!;
    expect(reParsed.colCount).toBe(model.colCount);
    expect(reParsed.rowCount).toBe(model.rowCount);
    expect(reParsed.alignments).toEqual(model.alignments);
    expect(reParsed.rows.map((r) => r.map((c) => c.text))).toEqual(
      model.rows.map((r) => r.map((c) => c.text)),
    );
  });

  it("preserves alignment markers across round-trip", () => {
    const md = "| a | b | c |\n| :- | :-: | -: |\n| 1 | 2 | 3 |\n";
    const model = parseTableAt(md, 0)!;
    const reEmitted = serializeModel(model);
    const reParsed = parseTableAt(reEmitted, 0)!;
    expect(reParsed.alignments).toEqual<ColumnAlignment[]>(["left", "center", "right"]);
  });

  it("emits a delimiter row that reflects each column's alignment", () => {
    const md = "| a | b | c |\n| :- | :-: | -: |\n| 1 | 2 | 3 |\n";
    const model = parseTableAt(md, 0)!;
    const out = serializeModel(model);
    // Each delimiter cell should encode its alignment via colons
    expect(out).toMatch(/:-+\s*\|\s*:-+:|---:/);
  });
});
