/**
 * @module codemirror-lint-table-column-count.test
 * Purpose: Verify the source-mode column-count linter (Phase 3 WI-3.1).
 * The linter flags body rows whose cell count differs from the header,
 * skips fenced code blocks (R3 fence guard), and stays silent on
 * well-formed tables.
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { tableColumnCountDiagnostics } from "../src/plugins/codemirror/lintTableColumnCount";

function makeState(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [markdown()] });
}

describe("tableColumnCountDiagnostics — happy path", () => {
  it("returns no diagnostics for a well-formed table", () => {
    const md = "| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n";
    expect(tableColumnCountDiagnostics(makeState(md))).toEqual([]);
  });

  it("returns no diagnostics when there is only a header (no body rows to check)", () => {
    const md = "| a | b |\n| - | - |\n";
    expect(tableColumnCountDiagnostics(makeState(md))).toEqual([]);
  });

  it("returns no diagnostics for prose with no tables", () => {
    expect(tableColumnCountDiagnostics(makeState("Just prose.\nMore.\n"))).toEqual([]);
  });
});

describe("tableColumnCountDiagnostics — mismatches", () => {
  it("flags a body row with too few cells", () => {
    // header has 3, body row has 2
    const md = "| a | b | c |\n| - | - | - |\n| 1 | 2 |\n";
    const diags = tableColumnCountDiagnostics(makeState(md));
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].message).toMatch(/2.*3|3.*2/); // mentions both counts
    // Diagnostic should land on the body row line.
    const body = "| 1 | 2 |";
    expect(diags[0].from).toBe(md.indexOf(body));
    expect(diags[0].to).toBe(md.indexOf(body) + body.length);
  });

  it("flags a body row with too many cells", () => {
    const md = "| a | b |\n| - | - |\n| 1 | 2 | 3 |\n";
    const diags = tableColumnCountDiagnostics(makeState(md));
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("warning");
  });

  it("flags every mismatched body row independently", () => {
    const md = "| a | b | c |\n| - | - | - |\n| 1 |\n| 2 | 3 | 4 | 5 |\n| 6 | 7 | 8 |\n";
    const diags = tableColumnCountDiagnostics(makeState(md));
    expect(diags).toHaveLength(2); // two mismatched rows; the third body is fine
  });
});

describe("tableColumnCountDiagnostics — escapes and edges", () => {
  it("treats escaped pipes inside a cell as content, not separators", () => {
    // body row has `a \| b` which is a single cell — no mismatch
    const md = "| h1 | h2 |\n| -- | -- |\n| a \\| b | c |\n";
    expect(tableColumnCountDiagnostics(makeState(md))).toEqual([]);
  });

  it("handles tables with no leading/trailing edge pipes", () => {
    const md = "a | b | c\n- | - | -\n1 | 2 | 3\n";
    expect(tableColumnCountDiagnostics(makeState(md))).toEqual([]);
  });
});

describe("tableColumnCountDiagnostics — fence guard", () => {
  it("ignores tables inside fenced code blocks (Risk R3)", () => {
    const md =
      "```\n" +
      "| h | h |\n| - | - |\n| 1 |\n" + // mismatched body, but fenced
      "```\n";
    expect(tableColumnCountDiagnostics(makeState(md))).toEqual([]);
  });

  it("still flags real tables when a fenced block precedes them", () => {
    const md =
      "```\n| f | f |\n| - | - |\n```\n\n" +
      "| h1 | h2 | h3 |\n| -- | -- | -- |\n| 1 | 2 |\n";
    const diags = tableColumnCountDiagnostics(makeState(md));
    expect(diags).toHaveLength(1);
  });
});

describe("tableColumnCountDiagnostics — multiple tables in one doc", () => {
  it("checks each table against its own header", () => {
    const md =
      "| a | b |\n| - | - |\n| 1 | 2 |\n\n" +
      "Some prose.\n\n" +
      "| x | y | z |\n| - | - | - |\n| 4 | 5 |\n";
    const diags = tableColumnCountDiagnostics(makeState(md));
    expect(diags).toHaveLength(1);
    // The diagnostic is on the second table's body row.
    expect(md.slice(diags[0].from, diags[0].to)).toContain("4");
  });
});
