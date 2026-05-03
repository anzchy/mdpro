/**
 * @module table-formatter.test
 * Purpose: Verify the GFM table pretty-printer (Phase 3 WI-3.2). The
 * formatter produces aligned source — pads each cell to the widest
 * value in its column, preserves alignment markers, and respects
 * escaped pipes. `formatAllTables` walks the source, replaces every
 * table region with its formatted output, and skips tables inside
 * fenced code blocks.
 */

import { describe, expect, it } from "vitest";
import { parseTableAt } from "../src/utils/tableParser";
import { formatTable, formatAllTables } from "../src/utils/tableFormatter";

// ---------------------------------------------------------------------------
// formatTable — single TableModel in, formatted source out
// ---------------------------------------------------------------------------

describe("formatTable", () => {
  it("pads cells column-by-column so pipes line up", () => {
    const md = "| a | longheader |\n| - | - |\n| 1 | 2 |\n";
    const model = parseTableAt(md, 0)!;
    const out = formatTable(model);
    const lines = out.split("\n");
    expect(lines[0].length).toBe(lines[1].length);
    expect(lines[1].length).toBe(lines[2].length);
    // Output round-trips to an equivalent model.
    const reParsed = parseTableAt(out, 0)!;
    expect(reParsed.rows.map((r) => r.map((c) => c.text))).toEqual(
      model.rows.map((r) => r.map((c) => c.text)),
    );
  });

  it("preserves alignment markers (:--/:-:/--:)", () => {
    const md = "| a | b | c |\n| :- | :-: | -: |\n| 1 | 2 | 3 |\n";
    const model = parseTableAt(md, 0)!;
    const out = formatTable(model);
    const reParsed = parseTableAt(out, 0)!;
    expect(reParsed.alignments).toEqual(["left", "center", "right"]);
  });

  it("preserves escaped pipes inside cells", () => {
    const md = "| h1 | h2 |\n| -- | -- |\n| a \\| b | c |\n";
    const model = parseTableAt(md, 0)!;
    const out = formatTable(model);
    expect(out).toContain("\\|");
    const reParsed = parseTableAt(out, 0)!;
    expect(reParsed.rows[1][0].text).toBe("a \\| b");
  });

  it("returns output WITHOUT a trailing newline (drop-in for model.raw)", () => {
    const md = "| a | b |\n| - | - |\n| 1 | 2 |\n";
    const model = parseTableAt(md, 0)!;
    expect(formatTable(model).endsWith("\n")).toBe(false);
  });

  it("is idempotent — already-formatted source round-trips identically", () => {
    const md = "| a | b |\n| - | - |\n| 1 | 2 |\n";
    const model = parseTableAt(md, 0)!;
    const once = formatTable(model);
    const twice = formatTable(parseTableAt(once, 0)!);
    expect(twice).toBe(once);
  });
});

// ---------------------------------------------------------------------------
// formatAllTables — whole-document pass
// ---------------------------------------------------------------------------

describe("formatAllTables", () => {
  it("returns the source unchanged when there are no tables", () => {
    const md = "Just prose.\nMore prose.\n";
    expect(formatAllTables(md)).toBe(md);
  });

  it("formats a single table in place, leaving surrounding prose untouched", () => {
    const md =
      "Before.\n\n" +
      "|a|longheader|\n|-|-|\n|1|2|\n" + // unformatted table
      "\nAfter.\n";
    const out = formatAllTables(md);
    expect(out.startsWith("Before.\n\n")).toBe(true);
    expect(out.endsWith("\nAfter.\n")).toBe(true);
    // The table region should now have padded cells (min 3-char width
    // per column so delimiter `---` fits; longest content sets width).
    expect(out).toContain("| a   | longheader |");
    expect(out).toContain("| --- | ---------- |");
  });

  it("formats every table in a multi-table doc independently", () => {
    const md =
      "|a|b|\n|-|-|\n|1|2|\n\n" +
      "Mid.\n\n" +
      "|x|y|z|\n|-|-|-|\n|7|8|9|\n";
    const out = formatAllTables(md);
    // Min 3-char padding: "a" → "a  ", "b" → "b  " (3 chars).
    expect(out).toContain("| a   | b   |");
    expect(out).toContain("| x   | y   | z   |");
    expect(out).toContain("Mid.");
  });

  it("skips tables inside fenced code blocks (Risk R3 fence guard)", () => {
    const md =
      "```\n" +
      "|a|b|\n|-|-|\n|1|2|\n" + // INSIDE fence — must NOT be formatted
      "```\n\n" +
      "|x|y|\n|-|-|\n|3|4|\n"; // OUTSIDE fence — must be formatted
    const fenceStart = md.indexOf("```");
    const fenceEnd = md.indexOf("```\n\n") + 4;
    const isFenced = (offset: number) =>
      offset >= fenceStart && offset < fenceEnd;
    const out = formatAllTables(md, isFenced);
    // Inside fence: original compact form preserved.
    expect(out).toContain("|a|b|\n|-|-|\n|1|2|");
    // Outside fence: padded with 3-char min width.
    expect(out).toContain("| x   | y   |");
  });

  it("handles CRLF input gracefully — formatted region uses LF internally", () => {
    const md = "|a|b|\r\n|-|-|\r\n|1|2|\r\n";
    const out = formatAllTables(md);
    // The formatter rewrites the table region; the trailing line ending
    // (just past `model.end`) is outside the replaced range and keeps
    // its CRLF. What matters is the rewritten table body is LF-clean
    // and re-parses correctly.
    expect(out).toContain("| a   | b   |\n| --- | --- |\n| 1   | 2   |");
    const reParsed = parseTableAt(out, 0)!;
    expect(reParsed.colCount).toBe(2);
    expect(reParsed.rowCount).toBe(2);
  });

  it("is idempotent on already-formatted multi-table docs", () => {
    // Already padded with 3-char min — running formatter again must
    // produce identical output.
    const md =
      "| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\n" +
      "| x   | y   |\n| --- | --- |\n| 3   | 4   |\n";
    expect(formatAllTables(md)).toBe(md);
  });
});
