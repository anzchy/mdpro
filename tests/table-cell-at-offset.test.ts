// @vitest-environment node
/**
 * @module table-cell-at-offset.test
 * D12 WI-3 (ADR-0043 Decision 3): `cellAtOffset(src, span, offset)` reads
 * only the row that owns the cursor, and is exactly
 * `cellAtResolvedLine(src, span, src.lineIndexAt(offset), offset)`.
 *
 * LAWS UNDER TEST
 *  - Equivalence: `cellAtOffset(src, locate(src,o), o)` deep-equals
 *    `findCell(parseTableAtOffset(src,o), o)` (or null) for every (src, o).
 *  - Wrapper identity: `cellAtOffset(src, span, o)` equals
 *    `cellAtResolvedLine(src, span, src.lineIndexAt(o), o)`, with the same
 *    recorded line-source calls.
 *  - Containment: a non-null result has start <= o < end, col < colCount
 *    and row < rowCount.
 *  - Cost invariance: line() calls and rows parsed do not depend on R.
 *
 * Finding 1: `lineIndexAt` maps column 0 of a line to the line ABOVE. In a
 * table without edge pipes that column is inside cell 0, so the owning row
 * is `i + 1` whenever `offset > line(i).end`. The seeded corpus always uses
 * edge pipes, so the NEP / M1 fixtures are the only reach into that rule.
 *
 * The CAO-6 whole-domain sweep runs in the slow tier,
 * `table-cell-at-offset.slow.test.ts` (ADR-0050).
 *
 * Matrix: `.claude/tdd-guardian/tests-20260930-D12.md` cases CAO-1..CAO-6.
 */

import { isDeepStrictEqual } from "node:util";

import { describe, expect, it, vi } from "vitest";

import {
  cellAtOffset,
  cellAtResolvedLine,
  locateTableAtOffset,
} from "../src/utils/tableParser/locate";
import { linesFromString, type TableLineSource } from "../src/utils/tableParser/lines";
import type { TableCell, TableSpan } from "../src/utils/tableParser/types";
import {
  ADAPTERS,
  CAO2_FIXTURE_DOCS as FIXTURE_DOCS,
  corpusDocs,
  type Doc,
  DOMAIN_TIMEOUT_MS,
  legacyCell,
  offsetsOf,
} from "./support/tableOffsetDomain";
import { D12_FIXTURES, recordingSource } from "./support/tableSpanOracle";
import { collectionCases } from "./support/collectionCases";

// Passthrough counter over the REAL `parseRowCells` — observes, replaces nothing.
const rowCells = vi.hoisted(() => ({ calls: 0, lastLength: -1 }));
vi.mock("../src/utils/tableParser/rowCells", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils/tableParser/rowCells")>();
  return {
    ...actual,
    parseRowCells: (...args: Parameters<typeof actual.parseRowCells>) => {
      rowCells.calls += 1;
      const out = actual.parseRowCells(...args);
      rowCells.lastLength = out.length;
      return out;
    },
  };
});

function cell(start: number, end: number, text: string, row: number, col: number): TableCell {
  return { start, end, text, row, col };
}

function containmentViolation(c: TableCell | null, span: TableSpan | null, o: number): string | null {
  if (c === null) return null;
  if (span === null) return "cell with a null span";
  if (!(c.start <= o && o < c.end)) return `offset outside [${c.start},${c.end})`;
  if (!(c.col >= 0 && c.col < span.colCount)) return `col ${c.col} of ${span.colCount}`;
  if (!(c.row >= 0 && c.row < span.rowCount)) return `row ${c.row} of ${span.rowCount}`;
  return null;
}

/** The CAO-1 relation over `docs`; returns the disagreement list. */
function equivalenceSweep(docs: Doc[]): { mismatches: string[]; nonNull: number } {
  const mismatches: string[] = [];
  let nonNull = 0;
  for (const { id, source } of docs) {
    for (const [name, make] of ADAPTERS) {
      for (const o of offsetsOf(source)) {
        const expected = legacyCell(make(source), o);
        const span = locateTableAtOffset(make(source), o);
        const got = cellAtOffset(make(source), span, o);
        const where = `${id}/${name}@${o}`;
        if (!isDeepStrictEqual(got, expected)) {
          mismatches.push(`${where}: got ${JSON.stringify(got)} want ${JSON.stringify(expected)}`);
        }
        const bad = containmentViolation(got, span, o);
        if (bad) mismatches.push(`${where}: ${bad}`);
        if (got !== null) nonNull += 1;
      }
    }
  }
  return { mismatches, nonNull };
}

describe("CAO-1 every-offset equivalence over both corpora and both adapters", () => {
  it("cellAtOffset(src, locate(src,o), o) deep-equals findCell(parseTableAtOffset(src,o), o)", () => {
    const { mismatches, nonNull } = equivalenceSweep(corpusDocs());
    expect(mismatches.slice(0, 20)).toEqual([]);
    expect(mismatches.length).toBe(0);
    expect(nonNull).toBeGreaterThan(0);
  }, DOMAIN_TIMEOUT_MS);
});

describe("CAO-2 named fixture sweep (Finding 1 included)", () => {
  it.each(collectionCases("tests/table-cell-at-offset.test.ts:113", FIXTURE_DOCS.map((d) => [d.id, d] as const)))("%s: the CAO-1 relation at every offset", (_id, doc) => {
    const { mismatches } = equivalenceSweep([doc]);
    expect(mismatches).toEqual([]);
  });
});

describe("CAO-3 Finding-1 non-vacuity (exact values at line-start offsets)", () => {
  const { NEP, NEP_CRLF, M1_NEP } = D12_FIXTURES;

  it("preconditions: the line-start quirk is reached in NEP", () => {
    const src = linesFromString(NEP);
    expect(src.lineIndexAt(12)).toBe(1);
    expect(src.lineIndexAt(18)).toBe(2);
  });

  const probes: Array<[string, string, number, TableCell | null]> = [
    ["NEP@0 header col 0", NEP, 0, cell(0, 2, "a", 0, 0)],
    ["NEP@12 first body col 0", NEP, 12, cell(12, 14, "c", 1, 0)],
    ["NEP@18 later body col 0", NEP, 18, cell(18, 20, "e", 2, 0)],
    ["NEP@6 owning row is the delimiter", NEP, 6, null],
    ["NEP@24 lastLine.end+1", NEP, 24, null],
    ["NEP_CRLF@13 on the \\n", NEP_CRLF, 13, null],
    ["NEP_CRLF@14 body col 0", NEP_CRLF, 14, cell(14, 16, "c", 1, 0)],
    ["M1_NEP@17 body col 0", M1_NEP, 17, cell(17, 19, "1", 1, 0)],
    ["M1_NEP@6 header interior", M1_NEP, 6, cell(5, 7, "a", 0, 0)],
  ];

  for (const [label, doc, o, expected] of probes) {
    for (const [name, make] of collectionCases("tests/table-cell-at-offset.test.ts:140", ADAPTERS)) {
      it(`${label} (${name})`, () => {
        const span = locateTableAtOffset(make(doc), o);
        expect(cellAtOffset(make(doc), span, o)).toEqual(expected);
      });
    }
  }

  for (const [name, make] of collectionCases("tests/table-cell-at-offset.test.ts:148", ADAPTERS)) {
    it(`NEP@24 (${name}): the span is non-null even though the cell is null`, () => {
      expect(locateTableAtOffset(make(NEP), 24)).toMatchObject({ headerLine: 0, lastLine: 3 });
    });
  }
});

describe("CAO-4 a null span returns null (Revision 1 S6)", () => {
  it.each([0, 12, -1])("o=%s: null, no line reads, no row parsed", (o) => {
    const rec = recordingSource(linesFromString(D12_FIXTURES.NEP));
    rowCells.calls = 0;
    const got = cellAtOffset(rec, null, o);
    const counts = {
      line: rec.lineIndices.length,
      lineIndexAt: rec.lineIndexAtCalls,
      rowCells: rowCells.calls,
    };
    expect(got).toBeNull();
    // The wrapper resolves the line first (CAO-6 identity); the null guard precedes any read.
    expect(counts).toEqual({ line: 0, lineIndexAt: 1, rowCells: 0 });
  });
});

describe("CAO-5 cost is invariant under R; one row parsed", () => {
  interface Probe {
    label: string;
    doc: (R: number) => string;
    /** Offset for body row k = R/2 (line k+2) or the delimiter (line 1). */
    offset: (src: TableLineSource, k: number) => number;
    expected: (k: number) => Partial<TableCell> | null;
  }

  const piped = (R: number): string => {
    let s = "| h0 | h1 | h2 |\n| --- | --- | --- |\n";
    for (let k = 0; k < R; k += 1) s += `| r${k}c0 | r${k}c1 | r${k}c2 |\n`;
    return s;
  };
  const nep = (R: number): string => {
    let s = "h0 | h1 | h2\n--- | --- | ---\n";
    for (let k = 0; k < R; k += 1) s += `r${k}c0 | r${k}c1 | r${k}c2\n`;
    return s;
  };
  const cell1Interior = (src: TableLineSource, k: number): number => {
    const line = src.line(k + 2);
    return line.start + line.text.indexOf(`r${k}c1`) + 1;
  };

  const probes: Probe[] = [
    {
      label: "(a) piped: interior of cell 1",
      doc: piped,
      offset: cell1Interior,
      expected: (k) => ({ text: `r${k}c1`, row: k + 1, col: 1 }),
    },
    {
      label: "(a) no-edge-pipe: interior of cell 1",
      doc: nep,
      offset: cell1Interior,
      expected: (k) => ({ text: `r${k}c1`, row: k + 1, col: 1 }),
    },
    {
      label: "(b) no-edge-pipe: col 0 of the body row (the i+1 path)",
      doc: nep,
      offset: (src, k) => src.line(k + 2).start,
      expected: (k) => ({ text: `r${k}c0`, row: k + 1, col: 0 }),
    },
    {
      label: "(c) piped: the delimiter row",
      doc: piped,
      offset: (src) => src.line(1).start + 2,
      expected: () => null,
    },
    {
      label: "(c) no-edge-pipe: the delimiter row",
      doc: nep,
      offset: (src) => src.line(1).start + 2,
      expected: () => null,
    },
  ];

  for (const probe of probes) {
    for (const [name, make] of collectionCases("tests/table-cell-at-offset.test.ts:229", ADAPTERS)) {
      it(`${probe.label} (${name}): equal counts at R=2,000 and R=50,000`, () => {
        const counts: Array<Record<string, number>> = [];
        for (const R of [2_000, 50_000]) {
          const k = R / 2;
          const doc = probe.doc(R);
          const o = probe.offset(linesFromString(doc), k);
          const rec = recordingSource(make(doc));
          const span = locateTableAtOffset(rec, o);
          expect(span).not.toBeNull();
          rec.reset();
          rowCells.calls = 0;
          rowCells.lastLength = -1;

          const got = cellAtOffset(rec, span, o);

          const c = {
            line: rec.lineIndices.length,
            lineIndexAt: rec.lineIndexAtCalls,
            slice: rec.sliceCalls,
            iterLines: rec.iterLinesCalls,
            rowCells: rowCells.calls,
            rowLength: rowCells.lastLength,
          };
          counts.push(c);

          const want = probe.expected(k);
          expect(c.line).toBeLessThanOrEqual(2);
          expect(c.lineIndexAt).toBeLessThanOrEqual(1);
          expect(c.slice).toBe(0);
          expect(c.iterLines).toBe(0);
          if (want === null) {
            expect(got).toBeNull();
            expect(c.rowCells).toBe(0);
          } else {
            expect(got).toMatchObject(want);
            expect(got!.start <= o && o < got!.end).toBe(true);
            expect(c.rowCells).toBe(1);
            expect(c.rowLength).toBe(3);
          }
        }
        expect(counts[1]).toEqual(counts[0]);
      });
    }
  }
});

describe("CAO-6 wrapper identity: cellAtOffset = cellAtResolvedLine after lineIndexAt (K = 3)", () => {
  // The CAO-1-domain sweep of this law (~5.5 s under coverage) runs in the slow
  // tier: table-cell-at-offset.slow.test.ts (ADR-0050).
  for (const [name, make] of collectionCases("tests/table-cell-at-offset.test.ts:279", ADAPTERS)) {
    it(`a resolved index of -1 with a non-null span is null with 0 line calls (${name})`, () => {
      const doc = D12_FIXTURES.P2;
      const span = locateTableAtOffset(make(doc), 22);
      expect(span).not.toBeNull();
      const rec = recordingSource(make(doc));
      expect(cellAtResolvedLine(rec, span, -1, 22)).toBeNull();
      expect(rec.lineIndices).toEqual([]);
    });
  }
});
