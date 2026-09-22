/**
 * Purpose: D17 WI-1 — `isAtScrollLimit`, the scroll-limit predicate extracted from
 * `readSpyLineRange` so the source spy and the WYSIWYG spy share one copy. Matrix
 * `.claude/tdd-guardian/tests-20260922-210708.md`, cases **A-1 … A-4**. A-5 is the
 * existing suites (`codemirror-viewport-line.test.ts` V-19 among them) running unedited.
 *
 * Laws (ADR-0017, `codemirrorViewportLine.ts` header §(a2)):
 *   - **Guard invariant** — `clientHeight <= 0` or NaN answers `false` for every offset.
 *     The `clientHeight > 0` conjunct is the part a reader will want to delete.
 *   - **Monotonicity** — for fixed `scrollHeight` and `clientHeight > 0`, the answer goes
 *     false→true exactly once as `scrollTop` increases.
 *
 * Generated domains use the seeded LCG from `tests/helpers/headingCorpus.ts` (no new
 * dependency). Every failure message carries the seed and the triple.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  SPY_SCROLL_LIMIT_TOLERANCE_PX as T,
  isAtScrollLimit,
  readSpyLineRange,
} from "../src/utils/codemirrorViewportLine";
import { DEFAULT_SEED, createLcg } from "./helpers/headingCorpus";
import {
  createFakeView,
  expectScrollOverrideLive,
  type FakeViewFixture,
  type FixtureScrollMetrics,
} from "./helpers/fakeCodemirrorView";

const UINT32 = 2 ** 32;

/** Uniform float in `[min, max)` from one LCG draw. */
function uniform(next: () => number, min: number, max: number): number {
  return min + (next() / UINT32) * (max - min);
}

/** Uniform integer in `[min, max]`. */
function int(next: () => number, min: number, max: number): number {
  return Math.floor(uniform(next, min, max + 1));
}

interface Row {
  label: string;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  expected: boolean;
}

/** A-1. Stated against the imported tolerance, not the number 1. */
const A1_ROWS: Row[] = [
  { label: "1: unlaid-out 0/0/0", scrollTop: 0, scrollHeight: 0, clientHeight: 0, expected: false },
  { label: "2: laid-out short doc 0/732/732", scrollTop: 0, scrollHeight: 732, clientHeight: 732, expected: true },
  { label: "3: exactly at the limit", scrollTop: 1340, scrollHeight: 2000, clientHeight: 660, expected: true },
  { label: "4: remaining == T (pins >=)", scrollTop: 1340 - T, scrollHeight: 2000, clientHeight: 660, expected: true },
  { label: "5: remaining == T + 1", scrollTop: 1340 - T - 1, scrollHeight: 2000, clientHeight: 660, expected: false },
  { label: "6: over-scrolled", scrollTop: 1500, scrollHeight: 2000, clientHeight: 660, expected: true },
  { label: "7: top of a long doc", scrollTop: 0, scrollHeight: 2000, clientHeight: 660, expected: false },
];

describe("isAtScrollLimit", () => {
  it("A-1: the boundary table", () => {
    for (const row of A1_ROWS) {
      expect(
        isAtScrollLimit(row.scrollTop, row.scrollHeight, row.clientHeight),
        `A-1 ${row.label} (${row.scrollTop}/${row.scrollHeight}/${row.clientHeight}, T=${T})`,
      ).toBe(row.expected);
    }
  });

  it("A-2: clientHeight <= 0 or NaN is false for every offset; NaN offsets are false", () => {
    // Wrong-reason guard: the same offsets with a healthy clientHeight do answer true,
    // so the falses below are the guard's doing, not an offset that never reaches.
    expect(isAtScrollLimit(5000, 0, 600), "A-2 precondition: healthy twin is true").toBe(true);

    const next = createLcg(DEFAULT_SEED);
    const badHeights = [0, -1, Number.NaN, Number.NEGATIVE_INFINITY];
    for (let i = 0; i < 300; i++) {
      const clientHeight = badHeights[i % badHeights.length];
      const scrollTop = uniform(next, -50, 5000);
      const scrollHeight = uniform(next, 0, 5000);
      expect(
        isAtScrollLimit(scrollTop, scrollHeight, clientHeight),
        `A-2 seed=${DEFAULT_SEED} i=${i}: ${scrollTop}/${scrollHeight}/${clientHeight}`,
      ).toBe(false);
    }

    expect(isAtScrollLimit(Number.NaN, 2000, 660), "A-2 NaN scrollTop").toBe(false);
    expect(isAtScrollLimit(1340, Number.NaN, 660), "A-2 NaN scrollHeight").toBe(false);
    expect(isAtScrollLimit(Number.NaN, Number.NaN, 660), "A-2 NaN both").toBe(false);
  });

  it("A-3: monotonic in scrollTop, first true at max(0, scrollHeight - clientHeight - T)", () => {
    const next = createLcg(DEFAULT_SEED + 3);
    const STEP = 0.5;
    for (let i = 0; i < 200; i++) {
      const scrollHeight = int(next, 0, 5000);
      const clientHeight = int(next, 1, 3000);
      const label = `A-3 seed=${DEFAULT_SEED + 3} i=${i}: sh=${scrollHeight} ch=${clientHeight}`;

      let firstTrue: number | null = null;
      let sawFalseAfterTrue = false;
      for (let scrollTop = 0; scrollTop <= scrollHeight; scrollTop += STEP) {
        const at = isAtScrollLimit(scrollTop, scrollHeight, clientHeight);
        if (at && firstTrue === null) firstTrue = scrollTop;
        if (!at && firstTrue !== null) sawFalseAfterTrue = true;
      }
      expect(sawFalseAfterTrue, `${label}: no true→false transition`).toBe(false);
      expect(firstTrue, `${label}: first true`).toBe(
        Math.max(0, scrollHeight - clientHeight - T),
      );
    }
  });
});

describe("isAtScrollLimit agrees with readSpyLineRange(view).atScrollLimit", () => {
  let fixtures: FakeViewFixture[] = [];
  afterEach(() => {
    for (const fixture of fixtures) fixture.destroy();
    fixtures = [];
  });

  const TWELVE_LINE_DOC = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\n");
  // Healthy line geometry: the anchor sits on line 4, the bottom edge on line 11, so
  // `readSpyLineRange` never takes its degenerate `null` branch.
  const lineAtY = (y: number): number => (y < 300 ? 4 : 11);

  it("A-4: 150 seeded triples (A-1 rows included) give equal booleans", () => {
    const next = createLcg(DEFAULT_SEED + 4);
    const triples: FixtureScrollMetrics[] = A1_ROWS.map(({ scrollTop, scrollHeight, clientHeight }) => ({
      scrollTop,
      scrollHeight,
      clientHeight,
    }));
    while (triples.length < 150) {
      const scrollHeight = int(next, 0, 5000);
      const clientHeight = int(next, 0, 1200);
      const max = scrollHeight - clientHeight;
      // Half the draws land within a few pixels of the limit, where drift would show.
      const scrollTop =
        triples.length % 2 === 0
          ? Math.max(0, max) + int(next, -4, 4) / 2
          : uniform(next, 0, Math.max(1, scrollHeight));
      triples.push({ scrollTop, scrollHeight, clientHeight });
    }

    let trues = 0;
    let falses = 0;
    for (const [i, scroll] of triples.entries()) {
      const fixture = createFakeView({ doc: TWELVE_LINE_DOC, lineAtY, scroll });
      fixtures.push(fixture);
      expectScrollOverrideLive(fixture);

      const { scrollTop, scrollHeight, clientHeight } = scroll;
      const expected = isAtScrollLimit(scrollTop, scrollHeight, clientHeight);
      const range = readSpyLineRange(fixture.view);
      const label = `A-4 seed=${DEFAULT_SEED + 4} i=${i}: ${scrollTop}/${scrollHeight}/${clientHeight}`;
      expect(range, `${label}: healthy geometry gives a range`).not.toBeNull();
      expect(range?.atScrollLimit, label).toBe(expected);
      if (expected) trues++;
      else falses++;
    }
    // Wrong-reason guard: a sample that is all-true or all-false cannot detect drift.
    expect(trues, "A-4: the sample reaches the limit").toBeGreaterThan(10);
    expect(falses, "A-4: the sample stays short of the limit").toBeGreaterThan(10);
  });
});
