// @vitest-environment node
/**
 * D49 WI-1.2: the source-mode context-menu edits keep body cells past the
 * header's column count ("overflow"), widening the table the way format on
 * save does (ADR-0052, superseded for the edits by ADR-0063).
 *
 * Matrix: `.claude/tdd-guardian/tests-20261009-111653.md` "# WI-1.2" E-1 to
 * E-22 and FROZEN-PIN, with the adversary-round-1 amendments to E-15 (compare
 * only `{source, cursorOffset}`) and E-18 (the two-row domain S').
 * E-16, E-21 and E-22 are pins: they hold on 8bb859e too.
 * No mocks; the frozen copy is an oracle, not a mock.
 */

import { describe, expect, it } from "vitest";

import { applyEdit } from "../src/utils/tableEdits";
import { parseTableAt, type TableModel } from "../src/utils/tableParser";
import { splitCellTexts } from "../src/utils/tableParser/lines";
import type { TableActionId, TableContext } from "../src/plugins/milkdown/table/types";
import { frozenApplyEdit } from "./support/frozenTableEdits";
import { ALL_ACTION_IDS, ctxAt } from "./support/tableEditsOverflowLaws";
import { oracleCells } from "./support/tableOverflowArb";

const T2 = "| a | b |\n|---|---|\n| 1 | 2 | Z |\n| 3 | 4 |\n";
const T0 = "| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n";
const T1C = "| a |\n|---|\n| x | Z |\n";
const H = "| a   | b   |     |";
const D = "| --- | --- | --- |";
const R1 = "| 1   | 2   | Z   |";
const R2 = "| 3   | 4   |     |";
const B3 = "|     |     |     |";
const lines = (...ls: string[]) => ls.join("\n");

function model(src: string): TableModel {
  const m = parseTableAt(src, 0);
  if (!m) throw new Error(`no table in ${JSON.stringify(src)}`);
  return m;
}
const ctx = (m: TableModel, r: number, c: number): TableContext => ctxAt(m, r, c);
function run(src: string, r: number, c: number, id: TableActionId) {
  const m = model(src);
  const out = applyEdit(m, ctx(m, r, c), id);
  if (!out) throw new Error(`${id} (${r},${c}) disabled`);
  return out;
}
const cellText = (source: string, r: number, c: number) => parseTableAt(source, 0)?.rows[r]?.[c]?.text;

describe("FROZEN-PIN: the oracle is the pre-fix edits", () => {
  it("frozen reformat of T2 still drops Z", () => {
    const m = model(T2);
    expect(frozenApplyEdit(m, ctx(m, 1, 0), "reformat_table")!.source).not.toContain("Z");
  });
});

describe("E-1 … E-12: every rewriting edit keeps Z in its row and column", () => {
  const COL_4 = (a: string, b: string, c: string, d: string) => `| ${a.padEnd(3)} | ${b.padEnd(3)} | ${c.padEnd(3)} | ${d.padEnd(3)} |`;
  const D4 = "| --- | --- | --- | --- |";
  const CASES: Array<[string, TableActionId, number, number, string, [number, number] | null]> = [
    ["E-1", "insert_row_before", 1, 0, lines(H, D, B3, R1, R2), [2, 2]],
    ["E-2", "insert_row_after", 1, 0, lines(H, D, R1, B3, R2), [1, 2]],
    ["E-3", "insert_column_before", 1, 0, lines(COL_4("", "a", "b", ""), D4, COL_4("", "1", "2", "Z"), COL_4("", "3", "4", "")), [1, 3]],
    ["E-4", "insert_column_after", 1, 1, lines(COL_4("a", "b", "", ""), D4, COL_4("1", "2", "", "Z"), COL_4("3", "4", "", "")), [1, 3]],
    ["E-5", "delete_row", 2, 0, lines(H, D, R1), [1, 2]],
    ["E-5b", "delete_row", 1, 0, lines(H, D, R2), null],
    ["E-6", "delete_column", 1, 0, lines("| b   |     |", "| --- | --- |", "| 2   | Z   |", "| 4   |     |"), [1, 1]],
    ["E-7", "move_row_up", 2, 0, lines(H, D, R2, R1), [2, 2]],
    ["E-7b", "move_row_up", 1, 0, lines(R1, D, "| a   | b   |     |", R2), [0, 2]],
    ["E-8", "move_row_down", 1, 0, lines(H, D, R2, R1), [2, 2]],
    ["E-9", "move_column_left", 1, 1, lines("| b   | a   |     |", D, "| 2   | 1   | Z   |", "| 4   | 3   |     |"), [1, 2]],
    ["E-10", "move_column_right", 1, 0, lines("| b   | a   |     |", D, "| 2   | 1   | Z   |", "| 4   | 3   |     |"), [1, 2]],
    ["E-11", "reformat_table", 1, 0, lines(H, D, R1, R2), [1, 2]],
    ["E-12a", "align_left", 1, 1, lines(H, "| --- | :-- | --- |", R1, R2), [1, 2]],
    ["E-12b", "align_center", 1, 1, lines(H, "| --- | :-: | --- |", R1, R2), [1, 2]],
    ["E-12c", "align_right", 1, 1, lines(H, "| --- | --: | --- |", R1, R2), [1, 2]],
  ];
  it.each(CASES)("%s %s at (%i,%i)", (_id, action, r, c, expected, z) => {
    const out = run(T2, r, c, action);
    expect(out.source).toBe(expected);
    if (z) expect(cellText(out.source, z[0], z[1])).toBe("Z");
    else expect(out.source).not.toContain("Z");
  });
});

describe("E-13: an inserted blank row has the widened width", () => {
  it("insert_row_after gives a 3-cell blank line", () => {
    const line = run(T2, 1, 0, "insert_row_after").source.split("\n")[3];
    expect(line).toBe("|     |     |     |");
    expect(splitCellTexts(line).map((s) => s.trim())).toEqual(["", "", ""]);
  });
});

describe("E-14: the cursor lands at exact offsets", () => {
  const CASES: Array<[TableActionId, number, number, number, string]> = [
    ["reformat_table", 1, 0, 41, "1"],
    ["insert_row_before", 1, 0, 41, ""],
    ["insert_row_after", 1, 0, 61, ""],
    ["insert_column_after", 1, 1, 65, ""],
    ["delete_column", 1, 0, 29, "2"],
    ["move_row_up", 2, 0, 41, "3"],
    ["move_column_right", 1, 0, 47, "1"],
    ["align_center", 1, 1, 47, "2"],
  ];
  it.each(CASES)("%s at (%i,%i) → %i", (action, r, c, offset, text) => {
    const out = run(T2, r, c, action);
    expect(out.cursorOffset).toBe(offset);
    expect(out.source.slice(offset, offset + 1)).toBe(" ");
    expect(out.source.slice(offset, out.source.indexOf("|", offset)).trim()).toBe(text);
  });
});

describe("E-15: deleting column 0 of a 1-column header keeps the overflow (Finding 5)", () => {
  it("a 1-column table holding Z remains", () => {
    const out = run(T1C, 0, 0, "delete_column");
    expect({ source: out.source, cursorOffset: out.cursorOffset }).toEqual({
      source: "|     |\n| --- |\n| Z   |",
      cursorOffset: 1,
    });
    expect(cellText(out.source, 1, 0)).toBe("Z");
  });
});

describe("E-16 (pin): a table with no overflow is byte-identical to the frozen edits", () => {
  it.each([T0, "| a | b | c |\n| :- | :-: | -: |\n| 1 | 2 | 3 |\n"])("%j", (src) => {
    const m = model(src);
    const bad: string[] = [];
    for (let r = 0; r < m.rowCount; r += 1) {
      for (let c = 0; c < m.colCount; c += 1) {
        for (const id of ALL_ACTION_IDS) {
          const got = applyEdit(m, ctx(m, r, c), id);
          const pick = got ? { source: got.source, cursorOffset: got.cursorOffset } : null;
          const want = frozenApplyEdit(m, ctx(m, r, c), id);
          if (JSON.stringify(pick) !== JSON.stringify(want)) bad.push(`${id} (${r},${c})`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("E-17: an empty row and an all-blank overflow row", () => {
  it("both widen to 4 columns (ADR-0052 §2)", () => {
    expect(run("| a | b |\n|---|---|\n|\n| 1 | 2 | | |\n", 2, 0, "reformat_table").source).toBe(
      lines("| a   | b   |     |     |", "| --- | --- | --- | --- |", "|     |     |     |     |", "| 1   | 2   |     |     |"),
    );
  });
});

const REWRITING = ALL_ACTION_IDS.filter((id) => id !== "delete_table");
/** E-18 amended domain: the ctx each rewriting edit runs at on a two-body-row table. */
const ctxFor = (id: TableActionId): [number, number] =>
  id === "delete_row" ? [2, 0] : id === "move_column_left" ? [1, 1] : [1, 0];

describe("E-18: an escaped pipe in overflow survives every edit as one cell", () => {
  it("reformat keeps `a\\|b` as one cell", () => {
    expect(run("| a | b |\n|---|---|\n| 1 | 2 | a\\|b |\n", 1, 0, "reformat_table").source).toBe(
      "| a   | b   |      |\n| --- | --- | ---- |\n| 1   | 2   | a\\|b |",
    );
  });
  it.each(REWRITING)("%s keeps exactly one `a\\|b` cell", (id) => {
    const [r, c] = ctxFor(id);
    const out = run("| a | b |\n|---|---|\n| 1 | 2 | a\\|b |\n| 3 | 4 |\n", r, c, id);
    const cells = out.source.split("\n").filter((_, i) => i !== 1).flatMap(oracleCells);
    expect(cells.filter((s) => s === "a\\|b")).toHaveLength(1);
    expect(out.source.replaceAll("a\\|b", "").includes("a|b")).toBe(false);
  });
});

describe("E-19: a code-span pipe row (splitter agreement, Finding 2)", () => {
  it("output cells equal the input's splitCellTexts cells", () => {
    const out = run("| a |\n|---|\n| `x|y` | b |\n", 1, 0, "reformat_table").source;
    expect(out).toBe("| a   |     |     |\n| --- | --- | --- |\n| `x  | y`  | b   |");
    expect(oracleCells(out.split("\n")[2])).toEqual(["`x", "y`", "b"]);
  });
});

describe("E-20: a CRLF table keeps its overflow and the rewrite has no \\r", () => {
  const CRLF = "| a | b |\r\n|---|---|\r\n| 1 | 2 | Z\r\n| 3 | 4 |\r\n";
  it("reformat gives the LF-joined widened table", () => {
    expect(run(CRLF, 1, 0, "reformat_table").source).toBe(lines(H, D, R1, R2));
  });
  it.each(REWRITING)("%s keeps Z and writes no \\r", (id) => {
    const [r, c] = ctxFor(id);
    const out = run(CRLF, r, c, id).source;
    expect(out.includes("\r")).toBe(false);
    expect(out).toContain("Z");
  });
});

describe("E-21 (pin): header narrower than delimiter has no write path (Finding 1)", () => {
  it("parseTableAt returns null", () => {
    expect(parseTableAt("| a |\n|---|---|\n| 1 | 2 | Z |\n", 0)).toBeNull();
  });
});

describe("E-22 (pin): move_column_right cannot reach an overflow column (Finding 4, deferred)", () => {
  it("is disabled at the last header column", () => {
    const m = model(T2);
    expect(applyEdit(m, ctx(m, 1, 1), "move_column_right")).toBeNull();
  });
});
