// @vitest-environment node
/**
 * @module table-locate.test
 * D12 WI-2 (ADR-0043 Decisions 1-2): `locateTableAtOffset` /
 * `locateTableAtLine` return a `TableSpan` from the SAME walker that
 * `parseTableAtLine` uses, which becomes the collecting adapter.
 *
 * LAWS UNDER TEST
 *  - Commutation with the model: `locate(src, o)` deep-equals
 *    `spanOfModel(lines, parseTableAtOffset(src, o))`, null included.
 *  - Identical walk: locate and parse make the same `line()` index sequence.
 *  - Refactor preservation of the walker: `parseTableAtLine` deep-equals the
 *    frozen HEAD 6df4896 walker, with an identical index sequence.
 *  - Plain data: a span is 8 own data keys and survives a JSON round-trip.
 *
 * LOC-2 runs in the slow tier, `table-locate.slow.test.ts` (ADR-0050).
 *
 * Matrix: `.claude/tdd-guardian/tests-20260930-D12.md` cases LOC-1..LOC-9.
 */

import { isDeepStrictEqual } from "node:util";

import { describe, expect, it, vi } from "vitest";

import type { TableSpan } from "../src/utils/tableParser";
import {
  isTableCandidateLine,
  linesFromString,
  splitLines,
  type TableLineSource,
} from "../src/utils/tableParser/lines";
import { locateTableAtLine, locateTableAtOffset } from "../src/utils/tableParser/locate";
import { parseTableAtLine, parseTableAtOffset } from "../src/utils/tableParser/parse";
import type { TableModel } from "../src/utils/tableParser/types";
import { frozenParseTableAtLine } from "./support/frozenTableParse";
import {
  ADAPTERS,
  corpusDocs,
  type Doc,
  DOMAIN_TIMEOUT_MS,
  loc1DocsOf,
  offsetsOf,
} from "./support/tableOffsetDomain";
import { D12_FIXTURES, recordingSource, spanOfModel } from "./support/tableSpanOracle";

// Passthrough counter over the REAL `parseRowCells` — observes, replaces nothing.
const rowCells = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../src/utils/tableParser/rowCells", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils/tableParser/rowCells")>();
  return {
    ...actual,
    parseRowCells: (...args: Parameters<typeof actual.parseRowCells>) => {
      rowCells.calls += 1;
      return actual.parseRowCells(...args);
    },
  };
});

const NON_NULL_FLOOR = 1_000;
const SPAN_KEYS = [
  "alignments",
  "colCount",
  "delimiterIsCandidate",
  "end",
  "headerLine",
  "lastLine",
  "rowCount",
  "start",
];

const ALL_FIXTURE_DOCS: Doc[] = Object.entries(D12_FIXTURES).map(([id, source]) => ({
  id,
  source,
}));

/** A model with its lazy `raw` getter read out, for by-value comparison. */
function materialise(m: TableModel | null): Record<string, unknown> | null {
  return m === null ? null : { ...m, raw: m.raw };
}

interface LocSample {
  where: string;
  span: TableSpan | null;
  src: TableLineSource;
}

let loc1Cache: { samples: LocSample[]; mismatches: string[] } | null = null;

/** LOC-1's sweep, computed once and shared with LOC-7. */
function loc1Sweep(): { samples: LocSample[]; mismatches: string[] } {
  if (loc1Cache) return loc1Cache;
  const samples: LocSample[] = [];
  const mismatches: string[] = [];
  for (const { id, source } of loc1DocsOf()) {
    const lines = splitLines(source);
    for (const [name, make] of ADAPTERS) {
      for (const o of offsetsOf(source)) {
        const srcA = make(source);
        const srcB = make(source);
        const expected = spanOfModel(lines, parseTableAtOffset(srcA, o));
        const span: TableSpan | null = locateTableAtOffset(srcB, o);
        const where = `${id}/${name}@${o}`;
        if (!isDeepStrictEqual(span, expected)) {
          mismatches.push(`${where}: got ${JSON.stringify(span)} want ${JSON.stringify(expected)}`);
        }
        samples.push({ where, span, src: srcB });
      }
    }
  }
  loc1Cache = { samples, mismatches };
  return loc1Cache;
}

describe("LOC-1 the span equals the model projection at every offset", () => {
  it("locateTableAtOffset deep-equals spanOfModel(parseTableAtOffset) over both corpora, fixtures and adapters", () => {
    const { samples, mismatches } = loc1Sweep();
    expect(mismatches.slice(0, 20)).toEqual([]);
    expect(mismatches.length).toBe(0);
    // Non-vacuity: both flag values are reached.
    expect(samples.some((s) => s.span?.delimiterIsCandidate === false)).toBe(true);
    expect(samples.some((s) => s.span?.delimiterIsCandidate === true)).toBe(true);
  }, DOMAIN_TIMEOUT_MS);
});

// LOC-2 (the identical-walk law over LOC-1's whole domain, ~4.9 s under
// coverage) runs in the slow tier: table-locate.slow.test.ts (ADR-0050).

describe("LOC-3 locate stays within 2R+5 line() calls and never slices", () => {
  function docOf(R: number): string {
    return "| h | h |\n| - | - |\n" + "| x | y |\n".repeat(R);
  }

  for (const R of [100, 2_000]) {
    for (const [name, make] of ADAPTERS) {
      it(`R=${R} (${name}): <= 2R+5 line(), 0 slice, 0 iterLines, 0 rows built`, () => {
        const doc = docOf(R);
        const middleBodyLine = 2 + Math.floor(R / 2);
        const probe = linesFromString(doc).line(middleBodyLine).start + 2;
        const rec = recordingSource(make(doc));
        rowCells.calls = 0;

        const span = locateTableAtOffset(rec, probe);

        const counts = {
          line: rec.lineIndices.length,
          slice: rec.sliceCalls,
          iterLines: rec.iterLinesCalls,
          rowCells: rowCells.calls,
        };
        expect(counts.line).toBeLessThanOrEqual(2 * R + 5);
        expect(counts.slice).toBe(0);
        expect(counts.iterLines).toBe(0);
        expect(counts.rowCells).toBe(0);
        expect(span).toEqual({
          start: 0,
          end: doc.length - 1,
          headerLine: 0,
          lastLine: R + 1,
          rowCount: R + 1,
          colCount: 2,
          alignments: [null, null],
          delimiterIsCandidate: true,
        });
      });
    }
  }
});

describe("LOC-4 parse builds cells only after the walk succeeds", () => {
  const cases: Array<[string, string]> = [
    ["broken header (3 header cells, 2 delimiter cells)", "| a | b | c |\n| - | - |\n| 1 | 2 |\n"],
    ["SETEXT", D12_FIXTURES.SETEXT],
  ];

  it.each(cases)("%s at o=2: parseTableAtOffset is null and builds no row", (_name, doc) => {
    for (const [, make] of ADAPTERS) {
      rowCells.calls = 0;
      const model = parseTableAtOffset(make(doc), 2);
      const calls = rowCells.calls;
      expect(model).toBeNull();
      expect(calls).toBe(0);
    }
  });
});

describe("LOC-5 guard order (-1, length+1, length+2, empty, NaN)", () => {
  const T3 = D12_FIXTURES.T3;
  const cases: Array<[string, string, number, number]> = [
    // [label, doc, offset, expected lineIndexAt calls]
    ["T3 @ -1", T3, -1, 0],
    ["T3 @ length+1 (57)", T3, 57, 0],
    ["T3 @ length+2 (58)", T3, 58, 0],
    ["empty @ 0", "", 0, 0],
    ["T3 @ NaN", T3, Number.NaN, 1],
  ];

  it("T3 has the length the offsets above assume", () => {
    expect(T3.length).toBe(56);
  });

  for (const [label, doc, o, lineIndexAtCalls] of cases) {
    for (const [name, make] of ADAPTERS) {
      it(`${label} (${name}): null from both, guards before any line read`, () => {
        const recL = recordingSource(make(doc));
        const recP = recordingSource(make(doc));
        expect(locateTableAtOffset(recL, o)).toBeNull();
        expect(parseTableAtOffset(recP, o)).toBeNull();
        expect(recL.lineIndexAtCalls).toBe(lineIndexAtCalls);
        expect(recL.lineIndices).toEqual([]);
        expect(recL.lineIndices).toEqual(recP.lineIndices);
        expect(recL.lineIndexAtCalls).toBe(recP.lineIndexAtCalls);
      });
    }
  }
});

describe("LOC-6 delimiterIsCandidate and setext", () => {
  for (const [name, make] of ADAPTERS) {
    it(`PIPELESS (${name}): pipe-less :-: gives delimiterIsCandidate false; offset 12 is null`, () => {
      const doc = D12_FIXTURES.PIPELESS;
      expect(locateTableAtOffset(make(doc), 2)).toEqual({
        start: 0,
        end: 21,
        headerLine: 0,
        lastLine: 3,
        rowCount: 3,
        colCount: 1,
        alignments: ["center"],
        delimiterIsCandidate: false,
      });
      expect(locateTableAtOffset(make(doc), 12)).toBeNull();
    });

    it(`PIPED_DELIM (${name}): a piped :-: gives delimiterIsCandidate true`, () => {
      expect(locateTableAtOffset(make(D12_FIXTURES.PIPED_DELIM), 16)).toEqual({
        start: 0,
        end: 19,
        headerLine: 0,
        lastLine: 2,
        rowCount: 2,
        colCount: 1,
        alignments: ["center"],
        delimiterIsCandidate: true,
      });
    });

    it(`SETEXT (${name}): --- is refused as a setext underline at every offset`, () => {
      const doc = D12_FIXTURES.SETEXT;
      const nonNull = offsetsOf(doc).filter((o) => locateTableAtOffset(make(doc), o) !== null);
      expect(nonNull).toEqual([]);
    });
  }
});

describe("LOC-7 span shape: 8 own data keys, no source reference, JSON round-trip", () => {
  it("holds for every non-null LOC-1 span", () => {
    const violations: string[] = [];
    let checked = 0;
    for (const { where, span, src } of loc1Sweep().samples) {
      if (span === null) continue;
      checked += 1;
      const keys = Object.keys(span).sort();
      if (!isDeepStrictEqual(keys, SPAN_KEYS)) violations.push(`${where}: keys ${keys}`);
      for (const [key, desc] of Object.entries(Object.getOwnPropertyDescriptors(span))) {
        if (!("value" in desc) || desc.get !== undefined) violations.push(`${where}: ${key} is an accessor`);
        if (desc.value === src) violations.push(`${where}: ${key} references the source`);
        if (typeof desc.value === "function") violations.push(`${where}: ${key} is a function`);
      }
      if (!isDeepStrictEqual(JSON.parse(JSON.stringify(span)), span)) {
        violations.push(`${where}: JSON round-trip differs`);
      }
      for (const banned of ["cells", "rows", "raw"]) {
        if (banned in span) violations.push(`${where}: has ${banned}`);
      }
    }
    expect(violations.slice(0, 20)).toEqual([]);
    expect(violations.length).toBe(0);
    expect(checked).toBeGreaterThan(0);
  }, DOMAIN_TIMEOUT_MS);
});

describe("LOC-8 TableSpan is exported from the barrel as a type only", () => {
  it("annotates a span through the barrel type (checked by pnpm typecheck:tests)", async () => {
    const span: TableSpan | null = locateTableAtOffset(linesFromString(D12_FIXTURES.P2), 22);
    expect(span).toEqual({
      start: 0,
      end: 29,
      headerLine: 0,
      lastLine: 2,
      rowCount: 2,
      colCount: 2,
      alignments: [null, null],
      delimiterIsCandidate: true,
    });
    const keys = Object.keys(await import("../src/utils/tableParser"));
    expect(keys).not.toContain("TableSpan");
    expect(keys).not.toContain("locateTableAtOffset");
    expect(keys).not.toContain("locateTableAtLine");
  });
});

describe("LOC-9 the split walker equals the frozen HEAD 6df4896 walker", () => {
  it("parseTableAtLine and locateTableAtLine match frozenParseTableAtLine, with identical line() sequences", () => {
    const mismatches: string[] = [];
    let nonNull = 0;
    let pipelessSpans = 0;
    let setextRefusals = 0;
    for (const { id, source } of [...corpusDocs(), ...ALL_FIXTURE_DOCS]) {
      const lines = splitLines(source);
      for (const [name, make] of ADAPTERS) {
        for (let i = 0; i < lines.length; i += 1) {
          const recF = recordingSource(make(source));
          const recP = recordingSource(make(source));
          const recL = recordingSource(make(source));
          const mF = frozenParseTableAtLine(recF, i);
          const mP = parseTableAtLine(recP, i);
          const span = locateTableAtLine(recL, i);
          // Snapshot before `raw` is read — the deep-equal below slices.
          const seqF = [...recF.lineIndices];
          const seqP = [...recP.lineIndices];
          const seqL = [...recL.lineIndices];
          const where = `${id}/${name} line ${i}`;

          if (!isDeepStrictEqual(materialise(mP), materialise(mF))) {
            mismatches.push(`${where}: parseTableAtLine differs from frozen`);
          }
          if (!isDeepStrictEqual(span, spanOfModel(lines, mF))) {
            mismatches.push(`${where}: locateTableAtLine ${JSON.stringify(span)} differs`);
          }
          if (!isDeepStrictEqual(seqP, seqF)) mismatches.push(`${where}: parse seq [${seqP}] vs [${seqF}]`);
          if (!isDeepStrictEqual(seqL, seqF)) mismatches.push(`${where}: locate seq [${seqL}] vs [${seqF}]`);

          if (mF !== null) nonNull += 1;
          if (span?.delimiterIsCandidate === false) pipelessSpans += 1;
          const next = lines[i + 1];
          if (
            mF === null &&
            isTableCandidateLine(lines[i]) &&
            next !== undefined &&
            /^ {0,3}-+[ \t]*$/.test(next.text.replace(/\r$/, ""))
          ) {
            setextRefusals += 1;
          }
        }
      }
    }
    expect(mismatches.slice(0, 20)).toEqual([]);
    expect(mismatches.length).toBe(0);
    expect(pipelessSpans).toBeGreaterThanOrEqual(1);
    expect(setextRefusals).toBeGreaterThanOrEqual(1);
    expect(nonNull).toBeGreaterThanOrEqual(NON_NULL_FLOOR);
  }, DOMAIN_TIMEOUT_MS);
});
