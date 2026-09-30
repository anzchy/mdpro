/**
 * @module table-row-cells.test
 * D12 WI-1: `parseRowCells` moves out of `parse.ts` into `rowCells.ts`.
 *
 * LAW UNDER TEST — refactor preservation. For every
 * `(line, rowIdx, colCount)`, the moved `parseRowCells` deep-equals
 * `frozenParseRowCells`, the verbatim copy of HEAD 6df4896 in
 * `tests/support/frozenTableParse.ts`. Structural invariants hold over the
 * same domain, so a copy that is "equal to the frozen copy" only because
 * both were edited the same way still fails.
 *
 * Matrix: `.claude/tdd-guardian/tests-20260930-D12.md` cases RC-1..RC-5.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { linesFromText } from "../src/plugins/codemirror/textLineSource";
import { linesFromString } from "../src/utils/tableParser/lines";
import { parseRowCells } from "../src/utils/tableParser/rowCells";
import type { LineRange, TableCell } from "../src/utils/tableParser/types";
import { frozenParseRowCells } from "./support/frozenTableParse";
import { legacyParseRowCells } from "./support/legacyTableScan";
import {
  makeCorpus,
  makeOverlapCorpus,
  OVERLAP_SEED,
  SEED,
} from "./support/tableCorpus";
import { textOf } from "./support/tableSpanOracle";

const CORPUS_COUNT = 200;
const COL_COUNTS = [1, 2, 3, 5] as const;
const TUPLE_FLOOR = 40_000;
const MAX_FILE_LINES = 300;
/**
 * RC-1..RC-3 walk ~50k tuples each. Vitest times out synchronous tests too,
 * and under the full lane with coverage they measured 4-6 s — too close to
 * the 5 s default to be a stable gate.
 */
const DOMAIN_TIMEOUT_MS = 60_000;

interface Tuple {
  /** `corpus#index/adapter` — printed in mismatch lists. */
  doc: string;
  line: LineRange;
  rowIdx: number;
  colCount: number;
}

/** The RC-1 domain: every line of both corpora, both adapters, every colCount. */
function domain(): Tuple[] {
  const docs = [
    ...makeCorpus(SEED, CORPUS_COUNT).map((d) => ({ id: `corpus#${d.index}`, source: d.source })),
    ...makeOverlapCorpus(OVERLAP_SEED, CORPUS_COUNT).map((d) => ({
      id: `overlap#${d.index}`,
      source: d.source,
    })),
  ];
  const out: Tuple[] = [];
  for (const { id, source } of docs) {
    const adapters = [
      ["string", linesFromString(source)],
      ["text", linesFromText(textOf(source))],
    ] as const;
    for (const [name, src] of adapters) {
      let rowIdx = 0;
      for (const line of src.iterLines()) {
        for (const colCount of COL_COUNTS) {
          out.push({ doc: `${id}/${name}`, line, rowIdx, colCount });
        }
        rowIdx += 1;
      }
    }
  }
  return out;
}

const DOMAIN = domain();

/**
 * Exact deep equality of two cell lists: same length, same own-key set,
 * and every one of the five fields strictly equal. Cheaper than calling
 * `expect().toEqual` per tuple across the whole domain.
 */
function sameCells(a: TableCell[], b: TableCell[]): boolean {
  if (a.length !== b.length) return false;
  for (let k = 0; k < a.length; k += 1) {
    const x = a[k];
    const y = b[k];
    if (Object.keys(x).length !== 5 || Object.keys(y).length !== 5) return false;
    if (
      x.start !== y.start ||
      x.end !== y.end ||
      x.text !== y.text ||
      x.row !== y.row ||
      x.col !== y.col
    ) {
      return false;
    }
  }
  return true;
}

function label(t: Tuple): string {
  return `${t.doc} line ${t.rowIdx} cc ${t.colCount}`;
}

/** `TableCell` literal from the matrix's `{start,end,text,row,col}` shorthand. */
function cell(start: number, end: number, text: string, row: number, col: number): TableCell {
  return { start, end, text, row, col };
}

describe("RC-1 parseRowCells equals the frozen HEAD copy over both corpora", () => {
  it("deep-equals frozenParseRowCells for every (line, rowIdx, colCount)", () => {
    const mismatches: string[] = [];
    let tuplesChecked = 0;
    for (const t of DOMAIN) {
      const actual = parseRowCells(t.line, t.rowIdx, t.colCount);
      const expected = frozenParseRowCells(t.line, t.rowIdx, t.colCount);
      tuplesChecked += 1;
      if (!sameCells(actual, expected)) mismatches.push(label(t));
    }
    expect(mismatches).toEqual([]);
    expect(tuplesChecked).toBeGreaterThan(TUPLE_FLOOR);
  }, DOMAIN_TIMEOUT_MS);
});

describe("RC-2 the legacy oracle agrees with the frozen copy", () => {
  it("legacyParseRowCells deep-equals frozenParseRowCells over the RC-1 domain", () => {
    const mismatches: string[] = [];
    for (const t of DOMAIN) {
      const legacy = legacyParseRowCells(t.line, t.rowIdx, t.colCount);
      const frozen = frozenParseRowCells(t.line, t.rowIdx, t.colCount);
      if (!sameCells(legacy, frozen)) mismatches.push(label(t));
    }
    expect(mismatches).toEqual([]);
  }, DOMAIN_TIMEOUT_MS);
});

describe("RC-3 structural invariants of parseRowCells", () => {
  it("holds length, col, row, bounds and ordering for every tuple", () => {
    const violations: string[] = [];
    for (const t of DOMAIN) {
      const cells = parseRowCells(t.line, t.rowIdx, t.colCount);
      const where = label(t);
      if (cells.length !== t.colCount) violations.push(`${where}: length ${cells.length}`);
      cells.forEach((c, k) => {
        if (c.col !== k) violations.push(`${where}: cells[${k}].col ${c.col}`);
        if (c.row !== t.rowIdx) violations.push(`${where}: cells[${k}].row ${c.row}`);
        if (!(t.line.start <= c.start && c.start <= c.end && c.end <= t.line.end)) {
          violations.push(`${where}: cells[${k}] [${c.start},${c.end}) outside line`);
        }
        const next = cells[k + 1];
        if (next && c.end > next.start) {
          violations.push(`${where}: cells[${k}].end ${c.end} > cells[${k + 1}].start ${next.start}`);
        }
      });
    }
    expect(violations).toEqual([]);
  }, DOMAIN_TIMEOUT_MS);
});

describe("RC-4 named edge fixtures (exact cells)", () => {
  const fixtures: Array<[string, LineRange, number, number, TableCell[]]> = [
    [
      "E1 final line keeps CR",
      { start: 22, end: 32, text: "| 1 | 2 |\r" },
      2,
      2,
      [cell(23, 26, "1", 2, 0), cell(27, 30, "2", 2, 1)],
    ],
    [
      "E2 escaped pipe",
      { start: 0, end: 12, text: "| a\\|b | c |" },
      0,
      2,
      [cell(1, 7, "a\\|b", 0, 0), cell(8, 11, "c", 0, 1)],
    ],
    [
      "E3 trailing backslash",
      { start: 0, end: 8, text: "| a | b\\" },
      0,
      2,
      [cell(1, 4, "a", 0, 0), cell(5, 8, "b\\", 0, 1)],
    ],
    [
      "E4 no edge pipes",
      { start: 12, end: 17, text: "a | b" },
      0,
      2,
      [cell(12, 14, "a", 0, 0), cell(15, 17, "b", 0, 1)],
    ],
    [
      "E5 pad",
      { start: 0, end: 5, text: "| 1 |" },
      0,
      3,
      [cell(1, 4, "1", 0, 0), cell(5, 5, "", 0, 1), cell(5, 5, "", 0, 2)],
    ],
    [
      "E6 truncate",
      { start: 0, end: 13, text: "| 1 | 2 | 3 |" },
      0,
      2,
      [cell(1, 4, "1", 0, 0), cell(5, 8, "2", 0, 1)],
    ],
    [
      "E7 CJK/astral",
      { start: 0, end: 11, text: "| 汉字 | 𝄞 |" },
      0,
      2,
      [cell(1, 5, "汉字", 0, 0), cell(6, 10, "𝄞", 0, 1)],
    ],
    [
      "E8 2-space indent",
      { start: 10, end: 17, text: "  | a |" },
      0,
      1,
      [cell(13, 16, "a", 0, 0)],
    ],
    [
      "E9 CHARACTER-count indent (tab is not a space)",
      { start: 0, end: 7, text: " \ta | b" },
      0,
      2,
      [cell(1, 4, "a", 0, 0), cell(5, 7, "b", 0, 1)],
    ],
    [
      "E10 empty line",
      { start: 4, end: 4, text: "" },
      0,
      2,
      [cell(4, 4, "", 0, 0), cell(4, 4, "", 0, 1)],
    ],
  ];

  it.each(fixtures)("%s", (_name, line, rowIdx, colCount, expected) => {
    expect(parseRowCells(line, rowIdx, colCount)).toEqual(expected);
  });
});

describe("RC-5 module surface and size", () => {
  it("keeps the barrel's runtime exports exactly as before", async () => {
    const keys = Object.keys(await import("../src/utils/tableParser")).sort();
    expect(keys).toEqual([
      "countTableLineCells",
      "findCell",
      "findCellOrNearest",
      "parseTableAt",
      "serializeModel",
      "serializeRows",
    ]);
    for (const internal of ["parseRowCells", "locateTableAtOffset", "cellAtResolvedLine"]) {
      expect(keys).not.toContain(internal);
    }
  });

  it("keeps parse.ts, rowCells.ts (and locate.ts once it exists) within 300 lines", () => {
    const lineCount = (rel: string): number => {
      const text = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
      const parts = text.split("\n");
      return text.endsWith("\n") ? parts.length - 1 : parts.length;
    };
    const required = ["../src/utils/tableParser/parse.ts", "../src/utils/tableParser/rowCells.ts"];
    const sizes: Record<string, number> = {};
    for (const rel of required) sizes[rel] = lineCount(rel);
    // locate.ts is created by WI-2; until then there is nothing to measure.
    const locate = "../src/utils/tableParser/locate.ts";
    if (existsSync(fileURLToPath(new URL(locate, import.meta.url)))) sizes[locate] = lineCount(locate);

    const over = Object.entries(sizes).filter(([, n]) => n > MAX_FILE_LINES);
    expect(over).toEqual([]);
  });
});
