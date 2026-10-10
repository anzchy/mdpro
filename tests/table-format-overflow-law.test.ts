// @vitest-environment node
/**
 * D44 WI-1: the laws of overflow widening in `formatAllTables`.
 *  L1 cell conservation with column fidelity, L2 uniform per-table width,
 *  L3 idempotence, L4 pre-fix conservation (metamorphic, against the frozen
 *  HEAD formatter in `tests/support/frozenTableFormat.ts`).
 *
 * Matrix: `.claude/tdd-guardian/tests-20261007-155353.md` F-FROZEN-PIN,
 * F-LAW-EXHAUSTIVE, F-LAW-PROPERTY, F-LAW-NONVACUOUS, F-PREFIX-METAMORPHIC,
 * F-CONSERVE-CORPUS. No mocks. The random half is seeded (`D44_SEED`) with the
 * repo's `mulberry32`; fast-check is not a dependency (matrix finding 1).
 */

import { describe, expect, it } from "vitest";

import { formatAllTables } from "../src/utils/tableFormatter";
import { splitCellTexts } from "../src/utils/tableParser/lines";
import { findAllTables } from "../src/utils/cursorSync/table";
import { frozenFormatAllTables } from "./support/frozenTableFormat";
import { REPRO_HEAD, REPRO_INPUT } from "./support/tableOverflowFixtures";
import { OVERLAP_SEED, SEED, makeCorpus, makeOverlapCorpus } from "./support/tableCorpus";
import {
  ALIGNMENTS,
  D44_SEED,
  EXHAUSTIVE_DOMAIN_SIZE,
  ROW_FORMS,
  checkOverflowLaws,
  exhaustiveOverflowDomain,
  prefixRelation,
  randomOverflowCases,
  summarize,
  summary,
  widthOf,
  type OverflowCase,
} from "./support/tableOverflowArb";

const RANDOM_COUNT = 2000;
const DOMAIN_TIMEOUT_MS = 60_000;
const CLEAN = { count: 0, first: [] };
const ALL_CLEAN = { P0: CLEAN, P1: CLEAN, P2: CLEAN, P3: CLEAN, P4: CLEAN, P5: CLEAN, P6: CLEAN };

const EXHAUSTIVE = exhaustiveOverflowDomain();
const RANDOM = randomOverflowCases(D44_SEED, RANDOM_COUNT);

function prefixMismatches(cases: readonly OverflowCase[]): string[] {
  const bad: string[] = [];
  for (const c of cases) {
    const why = prefixRelation(c.source, formatAllTables(c.source), frozenFormatAllTables(c.source));
    if (why) bad.push(`#${c.index} ${why}`);
  }
  return bad;
}

describe("F-FROZEN-PIN: the oracle is the pre-fix formatter", () => {
  it("frozen copy formats D41 LEAD and still truncates F-REPRO", () => {
    expect(frozenFormatAllTables("| h1 | h2 |\n| - | - |\n| | x |\n")).toBe(
      "| h1  | h2  |\n| --- | --- |\n|     | x   |\n",
    );
    expect(frozenFormatAllTables(REPRO_INPUT)).toBe(REPRO_HEAD);
  });
});

describe("F-LAW-EXHAUSTIVE: P1-P6 over the 1688-case domain", () => {
  it("every law holds on every case", () => {
    expect(EXHAUSTIVE.length).toBe(EXHAUSTIVE_DOMAIN_SIZE);
    expect(summarize(checkOverflowLaws(EXHAUSTIVE, (s) => formatAllTables(s)))).toEqual(ALL_CLEAN);
  }, DOMAIN_TIMEOUT_MS);
});

describe("F-PREFIX-METAMORPHIC: old columns are pinned by relation to the pre-fix output", () => {
  it("exhaustive domain: table lines only grow, by whole cells", () => {
    expect(summary(prefixMismatches(EXHAUSTIVE))).toEqual(CLEAN);
  }, DOMAIN_TIMEOUT_MS);

  it(`random domain (seed ${D44_SEED}): table lines only grow, by whole cells`, () => {
    expect(summary(prefixMismatches(RANDOM))).toEqual(CLEAN);
  }, DOMAIN_TIMEOUT_MS);
});

describe(`F-LAW-PROPERTY: P1-P6 over ${RANDOM_COUNT} seeded cases (seed ${D44_SEED})`, () => {
  it("every law holds on every random case", () => {
    expect(summarize(checkOverflowLaws(RANDOM, (s) => formatAllTables(s), D44_SEED))).toEqual(ALL_CLEAN);
  }, DOMAIN_TIMEOUT_MS);

  it("F-LAW-NONVACUOUS: the random domain covers every class", () => {
    const overflowCells = (c: OverflowCase) => c.rows.flatMap((r) => r.cells.slice(c.h));
    const overflowing = RANDOM.filter((c) => widthOf(c) > c.h);
    const tightBackslash = RANDOM.filter((c) =>
      c.rows.some((r) => r.form === "tight" && r.cells.slice(c.h).includes("c\\\\")),
    );
    const alignSeen = new Set(RANDOM.flatMap((c) => c.aligns));
    const formsOnOverflow = new Set(
      RANDOM.flatMap((c) => c.rows.filter((r) => r.cells.length > c.h).map((r) => r.form)),
    );
    expect(overflowing.length).toBeGreaterThanOrEqual(600);
    expect(RANDOM.filter((c) => widthOf(c) === c.h).length).toBeGreaterThanOrEqual(200);
    expect(RANDOM.filter((c) => overflowCells(c).includes("")).length).toBeGreaterThanOrEqual(1);
    expect(RANDOM.filter((c) => overflowCells(c).includes("a\\|b")).length).toBeGreaterThanOrEqual(1);
    expect(tightBackslash.length).toBeGreaterThanOrEqual(1);
    expect(RANDOM.filter((c) => overflowCells(c).includes("中")).length).toBeGreaterThanOrEqual(1);
    expect(RANDOM.filter((c) => c.rows.length === 0).length).toBeGreaterThanOrEqual(1);
    expect([...ALIGNMENTS].every((a) => alignSeen.has(a))).toBe(true);
    expect([...ROW_FORMS].every((f) => formsOnOverflow.has(f))).toBe(true);
  });
});

describe("F-CONSERVE-CORPUS: conservation and per-table width over 400 real-shaped docs", () => {
  it("(a) no-overflow docs unchanged, (b) prefix relation, (c) idempotent, (d) per-table W", () => {
    const docs = [
      ...makeCorpus(SEED, 200).map((d) => d.source),
      ...makeOverlapCorpus(OVERLAP_SEED, 200).map((d) => d.source),
    ];
    const widest = (raw: string) => Math.max(...raw.split("\n").map((l) => splitCellTexts(l).length));
    const a: string[] = [];
    const b: string[] = [];
    const c: string[] = [];
    const d: string[] = [];
    let noOverflowDocs = 0;
    docs.forEach((doc, i) => {
      const out = formatAllTables(doc);
      const tin = findAllTables(doc);
      const ws = tin.map((t) => widest(t.raw));
      if (tin.every((t, k) => ws[k] === t.colCount)) {
        noOverflowDocs += 1;
        if (out !== frozenFormatAllTables(doc)) a.push(`doc ${i}`);
      }
      const why = prefixRelation(doc, out, frozenFormatAllTables(doc));
      if (why) b.push(`doc ${i}: ${why}`);
      if (formatAllTables(out) !== out) c.push(`doc ${i}`);
      const tout = findAllTables(out);
      if (tout.length !== tin.length) {
        d.push(`doc ${i}: ${tin.length} tables → ${tout.length}`);
        return;
      }
      tout.forEach((t, k) => {
        const linesOk = t.raw.split("\n").every((l) => splitCellTexts(l).length === ws[k]);
        if (t.colCount !== ws[k] || !linesOk) d.push(`doc ${i} table ${k}: W=${ws[k]} got ${t.colCount}`);
      });
    });
    expect(noOverflowDocs).toBeGreaterThanOrEqual(100);
    expect({ a: summary(a), b: summary(b), c: summary(c), d: summary(d) }).toEqual({
      a: CLEAN,
      b: CLEAN,
      c: CLEAN,
      d: CLEAN,
    });
  }, DOMAIN_TIMEOUT_MS);
});
