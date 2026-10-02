/**
 * @module table-leading-blank-format-mcp.test
 * D41 WI-1 consumers: the serializer → parser round-trip, `formatAllTables`
 * (⌘S format-on-save) and the MCP table writes (`applyMcpTableAction`).
 *
 * On af51749 `parseRowCells` drops a blank first cell AND keeps dropping while
 * only one cell has been collected, so `| | x |` parses as `["x", ""]`. Every
 * consumer that re-serializes the parsed model then moves x from column 1 to
 * column 0 (format) or overwrites it (MCP `set_cell`) — silent data corruption.
 *
 * LAWS:
 *  - RT: parseTableAt(serializeRows(rows, aligns), 0) cell texts == rows.
 *  - FMT: formatting preserves every cell text by column, and f(f(x)) == f(x).
 *  - MCP-LOCAL: set_cell(r, c, v) changes exactly cell (r, c).
 *
 * Matrix: `.claude/tdd-guardian/tests-20261002-D41.md` cases C1-RT, C1-FMT-LEAD,
 * C1-FMT-LAW, C1-MCP-SET, C1-MCP-LOCAL, C1-MCP-EDIT. No mocks: pure functions.
 */

import { describe, expect, it } from "vitest";

import { applyMcpTableAction } from "../src/utils/tableMcp";
import { formatAllTables } from "../src/utils/tableFormatter";
import { parseTableAt, serializeRows } from "../src/utils/tableParser";

const LEAD = "| h1 | h2 |\n| - | - |\n| | x |\n";
const LEAD_FORMATTED = "| h1  | h2  |\n| --- | --- |\n|     | x   |\n";
const HEADER_CELLS = ["h", "x"] as const;
const BODY_CELLS = ["", "x", "yy"] as const;
const COL_COUNTS = [1, 2, 3] as const;
/** cc 1: 2·(3+9) + cc 2: 4·(9+81) + cc 3: 8·(27+729). */
const RT_TABLE_COUNT = 6_432;
const DOMAIN_TIMEOUT_MS = 60_000;

type Rows = string[][];

/** Every length-`n` tuple over `alphabet`. */
function tuples(alphabet: readonly string[], n: number): string[][] {
  let out: string[][] = [[]];
  for (let i = 0; i < n; i += 1) {
    out = out.flatMap((t) => alphabet.map((a) => [...t, a]));
  }
  return out;
}

/** The C1-RT domain: header ∈ {h,x}^cc, then 1 or 2 body rows ∈ {"",x,yy}^cc. */
function rtDomain(): Rows[] {
  const out: Rows[] = [];
  for (const cc of COL_COUNTS) {
    const headers = tuples(HEADER_CELLS, cc);
    const bodies = tuples(BODY_CELLS, cc);
    for (const h of headers) {
      for (const b1 of bodies) {
        out.push([h, b1]);
        for (const b2 of bodies) out.push([h, b1, b2]);
      }
    }
  }
  return out;
}

const RT = rtDomain();
const nullAligns = (cc: number) => new Array(cc).fill(null);

/** Cell texts of the first table in `source`, row-major (header first, no delimiter). */
function textsOf(source: string): Rows | null {
  const model = parseTableAt(source, 0);
  return model ? model.rows.map((r) => r.map((c) => c.text)) : null;
}

const same = (a: Rows | null, b: Rows) => JSON.stringify(a) === JSON.stringify(b);

/** Hand-typed variant with single-space padding: `| | x |` for a blank cell. */
function sloppy(rows: Rows): string {
  const line = (cells: string[]) => "|" + cells.map((c) => (c === "" ? " " : ` ${c} `)).join("|") + "|";
  const cc = rows[0].length;
  return [line(rows[0]), "|" + " - |".repeat(cc), ...rows.slice(1).map(line)].join("\n") + "\n";
}

function summary(list: string[]): { count: number; first: string[] } {
  return { count: list.length, first: list.slice(0, 10) };
}

describe("C1-RT serializeRows → parseTableAt round-trip", () => {
  it("returns every enumerated table's cell texts unchanged", () => {
    expect(RT.length).toBe(RT_TABLE_COUNT);
    const mismatches: string[] = [];
    for (const rows of RT) {
      const src = serializeRows(rows, nullAligns(rows[0].length));
      const got = textsOf(src);
      if (!same(got, rows)) mismatches.push(`${JSON.stringify(rows)} → ${JSON.stringify(got)}`);
    }
    expect(summary(mismatches)).toEqual({ count: 0, first: [] });
  }, DOMAIN_TIMEOUT_MS);
});

describe("C1-FMT formatAllTables keeps cell text in its column", () => {
  it("C1-FMT-LEAD: formatting LEAD keeps x in column 1", () => {
    expect(formatAllTables(LEAD)).toBe(LEAD_FORMATTED);
  });

  it("C1-FMT-LAW: text preservation and idempotence over canonical and sloppy variants", () => {
    const lost: string[] = [];
    const unstable: string[] = [];
    for (const rows of RT) {
      const canonical = serializeRows(rows, nullAligns(rows[0].length)) + "\n";
      for (const v of [canonical, sloppy(rows)]) {
        const once = formatAllTables(v);
        if (!same(textsOf(once), rows)) lost.push(`${JSON.stringify(v)} → ${JSON.stringify(textsOf(once))}`);
        if (formatAllTables(once) !== once) unstable.push(JSON.stringify(v));
      }
    }
    expect(summary(lost)).toEqual({ count: 0, first: [] });
    expect(summary(unstable)).toEqual({ count: 0, first: [] });
  }, DOMAIN_TIMEOUT_MS);
});

describe("C1-MCP table writes keep columns", () => {
  it("C1-MCP-SET: set_cell row 1 col 0 writes y beside x, x is not overwritten", () => {
    expect(
      applyMcpTableAction(LEAD, "set_cell", { tableIndex: 0, row: 1, col: 0, content: "y" }),
    ).toBe("| h1  | h2  |\n| --- | --- |\n| y   | x   |\n");
  });

  it("C1-MCP-LOCAL: set_cell(r, c, z) changes exactly cell (r, c) in every enumerated table", () => {
    const mismatches: string[] = [];
    for (const rows of RT) {
      const src = serializeRows(rows, nullAligns(rows[0].length)) + "\n";
      rows.forEach((row, r) => {
        row.forEach((_, c) => {
          const out = applyMcpTableAction(src, "set_cell", { tableIndex: 0, row: r, col: c, content: "z" });
          const want = rows.map((rr, i) => rr.map((t, j) => (i === r && j === c ? "z" : t)));
          const got = out === null ? null : textsOf(out);
          if (!same(got, want)) mismatches.push(`${JSON.stringify(rows)} (${r},${c}) → ${JSON.stringify(got)}`);
        });
      });
    }
    expect(summary(mismatches)).toEqual({ count: 0, first: [] });
  }, DOMAIN_TIMEOUT_MS);

  it("C1-MCP-EDIT(a): add_row after row 1 keeps x in column 1", () => {
    expect(applyMcpTableAction(LEAD, "add_row", { tableIndex: 0, after: 1 })).toBe(
      "| h1  | h2  |\n| --- | --- |\n|     | x   |\n|     |     |\n",
    );
  });

  it("C1-MCP-EDIT(b): delete_column 0 deletes the blank cell, not x", () => {
    const out = applyMcpTableAction(LEAD, "delete_column", { tableIndex: 0, index: 0 });
    expect(out).not.toBeNull();
    expect(textsOf(out!)).toEqual([["h2"], ["x"]]);
  });
});
