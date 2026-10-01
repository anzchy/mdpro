/**
 * @module table-row-cells-leading-blank.test
 * D41 WI-1: `parseRowCells` drops the leading edge segment AT MOST ONCE — only
 * the blank segment before the first `|`, the same rule as
 * `lines.ts#splitCellTexts`.
 *
 * LAW UNDER TEST (RC-6, text agreement with the line splitter), for every
 * `(line, rowIdx, colCount)`:
 *   parseRowCells(line, r, cc).map(text) == padTruncate(splitCellTexts(line.text).map(trim), cc)
 *
 * RC-6 is a TEXT law only. Over-dropping on all-blank rows changes offsets, not
 * texts, and is killed by E11's offsets (and by C1-MNT-T3A / C1-SYNC-RT).
 *
 * On af51749 every blank cell seen while `cells.length === 1` is dropped, so
 * `||x` parses as `["x",""]` (splitter: `["","x"]`) and `| | x` as `["x",""]`.
 *
 * Matrix: `.claude/tdd-guardian/tests-20261002-D41.md` cases C1-RC-E11, -E12,
 * -E13, -PIN, C1-RC-6, C1-RC-2b (round-2 corrections D-1..D-5 applied).
 */

import { describe, expect, it } from "vitest";

import { linesFromText } from "../src/plugins/codemirror/textLineSource";
import { linesFromString, splitCellTexts } from "../src/utils/tableParser/lines";
import { parseRowCells } from "../src/utils/tableParser/rowCells";
import type { LineRange, TableCell } from "../src/utils/tableParser/types";
import { frozenParseRowCells } from "./support/frozenTableParse";
import { legacyParseRowCells } from "./support/legacyTableScan";
import { makeCorpus, makeOverlapCorpus, OVERLAP_SEED, SEED } from "./support/tableCorpus";
import { textOf } from "./support/tableSpanOracle";

const CORPUS_COUNT = 200;
const COL_COUNTS = [1, 2, 3, 5] as const;
const ALPHABET = ["|", " ", "x", "\\"] as const;
const MAX_LEN = 6;
const LINE_STARTS = [0, 7] as const;
/** 5,461 strings × 2 starts × 4 colCounts. */
const DOMAIN_B_SIZE = 43_688;
const DOMAIN_A_FLOOR = 40_000;
const DOMAIN_TIMEOUT_MS = 60_000;

interface Tuple {
  label: string;
  line: LineRange;
  rowIdx: number;
  colCount: number;
}

/** `TableCell` literal from the matrix's `{start,end,text,row,col}` shorthand. */
function cell(start: number, end: number, text: string, row: number, col: number): TableCell {
  return { start, end, text, row, col };
}

function lineOf(start: number, text: string): LineRange {
  return { start, end: start + text.length, text };
}

/** Domain A: the RC-1 domain — every line of both corpora, both adapters, every cc. */
function domainA(): Tuple[] {
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
          out.push({ label: `${id}/${name} line ${rowIdx} cc ${colCount}`, line, rowIdx, colCount });
        }
        rowIdx += 1;
      }
    }
  }
  return out;
}

/** Every string over ALPHABET of length 0..MAX_LEN. */
function allStrings(): string[] {
  const out: string[] = [""];
  let layer: string[] = [""];
  for (let len = 1; len <= MAX_LEN; len += 1) {
    const next: string[] = [];
    for (const s of layer) for (const ch of ALPHABET) next.push(s + ch);
    out.push(...next);
    layer = next;
  }
  return out;
}

/** Domain B: exhaustive small alphabet × line.start × cc. */
function domainB(): Tuple[] {
  const out: Tuple[] = [];
  for (const text of allStrings()) {
    for (const start of LINE_STARTS) {
      for (const colCount of COL_COUNTS) {
        out.push({ label: `${JSON.stringify(text)}@${start} cc ${colCount}`, line: lineOf(start, text), rowIdx: 0, colCount });
      }
    }
  }
  return out;
}

const DOMAIN_A = domainA();
const DOMAIN_B = domainB();

function padTruncate(texts: string[], cc: number): string[] {
  const out = texts.slice(0, cc);
  while (out.length < cc) out.push("");
  return out;
}

/** Mismatch summary: total count plus the first few labels, so a RED run stays readable. */
function summary(list: string[]): { count: number; first: string[] } {
  return { count: list.length, first: list.slice(0, 10) };
}

function sameCells(a: TableCell[], b: TableCell[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, k) => {
    const y = b[k];
    return x.start === y.start && x.end === y.end && x.text === y.text && x.row === y.row && x.col === y.col;
  });
}

describe("C1-RC-E11..E13 leading blank cells keep their columns", () => {
  it("E11: all-blank appended row `|  |  |  |` keeps three cells", () => {
    expect(parseRowCells(lineOf(0, "|  |  |  |"), 0, 3)).toEqual([
      cell(1, 3, "", 0, 0),
      cell(4, 6, "", 0, 1),
      cell(7, 9, "", 0, 2),
    ]);
  });

  it("E12: `| | x |` keeps x in column 1", () => {
    expect(parseRowCells(lineOf(22, "| | x |"), 1, 2)).toEqual([
      cell(23, 24, "", 1, 0),
      cell(25, 28, "x", 1, 1),
    ]);
  });

  it("E13(a): `||` gives two empty cells", () => {
    expect(parseRowCells(lineOf(0, "||"), 0, 2)).toEqual([cell(1, 1, "", 0, 0), cell(2, 2, "", 0, 1)]);
  });

  it("E13(b): `| | x` (no trailing pipe) keeps x in column 1", () => {
    expect(parseRowCells(lineOf(0, "| | x"), 0, 2)).toEqual([cell(1, 2, "", 0, 0), cell(3, 5, "x", 0, 1)]);
  });
});

describe("C1-RC-PIN pipe-less and interior-blank rows are unchanged (CHAR)", () => {
  const PINS: Array<[string, number, TableCell[]]> = [
    ["a | b", 2, [cell(0, 2, "a", 0, 0), cell(3, 5, "b", 0, 1)]],
    ["| a | b", 2, [cell(1, 4, "a", 0, 0), cell(5, 7, "b", 0, 1)]],
    ["a |  | c", 3, [cell(0, 2, "a", 0, 0), cell(3, 5, "", 0, 1), cell(6, 8, "c", 0, 2)]],
    ["| a |  | c |", 3, [cell(1, 4, "a", 0, 0), cell(5, 7, "", 0, 1), cell(8, 11, "c", 0, 2)]],
  ];
  for (const [text, cc, expected] of PINS) {
    it(`${JSON.stringify(text)} [${cc}] — live and frozen both equal the literal`, () => {
      expect(parseRowCells(lineOf(0, text), 0, cc)).toEqual(expected);
      expect(frozenParseRowCells(lineOf(0, text), 0, cc)).toEqual(expected);
    });
  }
});

describe("C1-RC-6 text agreement with splitCellTexts", () => {
  function mismatchesOver(domain: Tuple[]): string[] {
    const out: string[] = [];
    for (const t of domain) {
      const got = parseRowCells(t.line, t.rowIdx, t.colCount).map((c) => c.text);
      const want = padTruncate(splitCellTexts(t.line.text).map((s) => s.trim()), t.colCount);
      if (got.length !== want.length || got.some((g, k) => g !== want[k])) {
        out.push(`${t.label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
      }
    }
    return out;
  }

  it("holds over Domain A (both corpora × both adapters × cc)", () => {
    expect(DOMAIN_A.length).toBeGreaterThan(DOMAIN_A_FLOOR);
    expect(summary(mismatchesOver(DOMAIN_A))).toEqual({ count: 0, first: [] });
  }, DOMAIN_TIMEOUT_MS);

  it("holds over Domain B (every {|, space, x, \\} string of length 0..6)", () => {
    expect(DOMAIN_B.length).toBe(DOMAIN_B_SIZE);
    expect(summary(mismatchesOver(DOMAIN_B))).toEqual({ count: 0, first: [] });
  }, DOMAIN_TIMEOUT_MS);
});

describe("C1-RC-2b the fixed legacy oracle agrees with the live parser everywhere", () => {
  it("legacyParseRowCells deep-equals parseRowCells over Domain A ∪ Domain B", () => {
    const mismatches: string[] = [];
    for (const t of [...DOMAIN_A, ...DOMAIN_B]) {
      const live = parseRowCells(t.line, t.rowIdx, t.colCount);
      const legacy = legacyParseRowCells(t.line, t.rowIdx, t.colCount);
      if (!sameCells(live, legacy)) mismatches.push(t.label);
    }
    expect(summary(mismatches)).toEqual({ count: 0, first: [] });
  }, DOMAIN_TIMEOUT_MS);
});
