/**
 * @module toc-geometry-spy.test
 * Purpose: pin `pickActiveHeadingIndex` (D17 WI-2) — the pixel-space picker the
 * WYSIWYG scroll spy uses. Matrix cases G-1..G-6: edge table, binary search ≡
 * linear-scan oracle, monotonicity in the anchor, the probe bound, soundness on
 * unordered/NaN input, and the header-documented degenerate anchors.
 * Retention and the composed selector live in `toc-geometry-spy-retain.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { pickActiveHeadingIndex } from "../src/utils/tocGeometrySpy";
import { createLcg, DEFAULT_SEED } from "./helpers/headingCorpus";

const ANCHOR = 100;

/** Test-local oracle: forward scan, last index with `top <= anchor` wins. */
function oracle(tops: readonly number[], anchor: number): number | null {
  let active: number | null = null;
  for (let i = 0; i < tops.length; i++) if (tops[i] <= anchor) active = i;
  return active;
}

function pick(tops: readonly number[], anchor: number): number | null {
  return pickActiveHeadingIndex(tops.length, (i) => tops[i], anchor);
}

const INCREMENTS = [0, 1, 5, 40, 400] as const;

function nonDecreasing(next: () => number, count: number): number[] {
  const tops: number[] = [];
  let top = -1000 + (next() % 2000);
  for (let i = 0; i < count; i++) {
    tops.push(top);
    top += INCREMENTS[next() % INCREMENTS.length];
  }
  return tops;
}

function anchorsFor(tops: readonly number[], next: () => number): number[] {
  const anchors: number[] = [];
  for (const t of tops) anchors.push(t - 1, t, t + 1);
  if (tops.length > 0) anchors.push(tops[0] - 1, tops[tops.length - 1] + 1);
  for (let k = 0; k < 3; k++) anchors.push(-3000 + (next() % 6000));
  return anchors;
}

describe("G-1 pickActiveHeadingIndex edge table (anchor 100)", () => {
  const rows: Array<[string, number[], number | null]> = [
    ["count 0", [], null],
    ["one above", [50], 0],
    ["one exactly at the anchor", [100], 0],
    ["one below", [101], null],
    ["all above", [0, 10, 20], 2],
    ["all below", [200, 300], null],
    ["tie at the anchor → last of the tie", [0, 100, 100, 100, 300], 3],
    ["all tied at the anchor → last", [100, 100, 100], 2],
    ["straddle 99/101", [0, 99, 101], 1],
    ["count 2, boundary before the first", [101, 200], null],
    ["count 2, boundary between", [100, 101], 0],
    ["count 2, boundary after the last", [99, 100], 1],
    ["count 3, boundary before the first", [101, 102, 103], null],
    ["count 3, boundary after index 0", [100, 101, 102], 0],
    ["count 3, boundary after index 1", [99, 100, 101], 1],
    ["count 3, boundary after index 2", [98, 99, 100], 2],
  ];
  it.each(rows)("%s", (_label, tops, expected) => {
    expect(pick(tops, ANCHOR)).toBe(expected);
    // Every row must also agree with the oracle — the table is not self-referential.
    expect(oracle(tops, ANCHOR)).toBe(expected);
  });
});

describe("G-2 binary search ≡ linear-scan oracle (law)", () => {
  it(`500 seeded non-decreasing layouts agree with the oracle (seed ${DEFAULT_SEED})`, () => {
    const next = createLcg(DEFAULT_SEED);
    let nonNull = 0;
    let nulls = 0;
    for (let c = 0; c < 500; c++) {
      const tops = nonDecreasing(next, next() % 65);
      for (const anchor of anchorsFor(tops, next)) {
        const expected = oracle(tops, anchor);
        if (expected === null) nulls++;
        else nonNull++;
        expect(pick(tops, anchor), `seed ${DEFAULT_SEED} case ${c} anchor ${anchor}`).toBe(expected);
      }
    }
    // Wrong-reason guard: the domain exercised both answers.
    expect(nonNull).toBeGreaterThan(0);
    expect(nulls).toBeGreaterThan(0);
  });
});

describe("G-3 monotonic in the anchor (law)", () => {
  it(`200 seeded layouts: result (null ↦ −1) never decreases as the anchor rises (seed ${DEFAULT_SEED})`, () => {
    const next = createLcg(DEFAULT_SEED ^ 0x33);
    for (let c = 0; c < 200; c++) {
      const tops = nonDecreasing(next, 1 + (next() % 40));
      const anchors = [...new Set(anchorsFor(tops, next))].sort((a, b) => a - b);
      let prev = -2;
      let rose = false;
      for (const anchor of anchors) {
        const r = pick(tops, anchor) ?? -1;
        expect(r, `seed ${DEFAULT_SEED} case ${c} anchor ${anchor}`).toBeGreaterThanOrEqual(prev);
        if (prev !== -2 && r > prev) rose = true;
        prev = r;
      }
      // Wrong-reason guard: the sweep crossed at least one boundary.
      expect(rose, `case ${c}`).toBe(true);
    }
  });
});

describe("G-4 probe bound", () => {
  const COUNTS = [0, 1, 2, 3, 4, 5, 7, 8, 9, 1000, 1023, 1024, 1025, 3000];
  it.each(COUNTS)("count %i: topAt calls ≤ ⌈log2 n⌉ + 1 and the result equals the oracle", (count) => {
    const next = createLcg(DEFAULT_SEED + count);
    const tops = nonDecreasing(next, count);
    const bound = count === 0 ? 0 : Math.ceil(Math.log2(count)) + 1;
    const lo = count === 0 ? 0 : tops[0];
    const hi = count === 0 ? 0 : tops[count - 1];
    const anchors = [lo - 1, hi + 1];
    for (let k = 0; k < 20; k++) anchors.push(lo + (next() % Math.max(1, hi - lo + 1)));
    for (const anchor of anchors) {
      let calls = 0;
      const result = pickActiveHeadingIndex(
        count,
        (i) => {
          calls++;
          return tops[i];
        },
        anchor,
      );
      expect(calls, `seed ${DEFAULT_SEED + count} anchor ${anchor}`).toBeLessThanOrEqual(bound);
      expect(result, `seed ${DEFAULT_SEED + count} anchor ${anchor}`).toBe(oracle(tops, anchor));
    }
  });
});

describe("G-5 soundness on arbitrary input, never throws", () => {
  it(`300 seeded unordered layouts with NaN/±Infinity (seed ${DEFAULT_SEED})`, () => {
    const next = createLcg(DEFAULT_SEED ^ 0x55);
    const SPECIAL = [Number.NaN, Infinity, -Infinity];
    let nonNull = 0;
    for (let c = 0; c < 300; c++) {
      const count = next() % 41;
      const tops = Array.from({ length: count }, () =>
        next() % 6 === 0 ? SPECIAL[next() % SPECIAL.length] : -500 + (next() % 1500),
      );
      const anchor = -500 + (next() % 1500);
      let result: number | null = null;
      expect(() => {
        result = pick(tops, anchor);
      }, `seed ${DEFAULT_SEED} case ${c}`).not.toThrow();
      if (result !== null) {
        nonNull++;
        const i: number = result;
        expect(Number.isInteger(i) && i >= 0 && i < count, `case ${c} index ${i}`).toBe(true);
        expect(tops[i] <= anchor, `case ${c} top ${tops[i]} anchor ${anchor}`).toBe(true);
      }
    }
    expect(nonNull).toBeGreaterThan(0);
  });
});

describe("G-6 degenerate anchors and tops — the module header's table", () => {
  const rows: Array<[string, number[], number, number | null]> = [
    ["header row: anchor NaN → null", [0, 10, 20], Number.NaN, null],
    ["header row: anchor −Infinity → null", [0, 10, 20], -Infinity, null],
    ["header row: anchor +Infinity → last index", [0, 10, 20], Infinity, 2],
    ["header row: all tops NaN → null", [Number.NaN, Number.NaN], 100, null],
    ["header row: a NaN probe compares as below the anchor line → 0", [0, Number.NaN, 20], 100, 0],
    ["header row: count 0 → null", [], 100, null],
  ];
  it.each(rows)("%s", (_label, tops, anchor, expected) => {
    expect(() => pick(tops, anchor)).not.toThrow();
    expect(pick(tops, anchor)).toBe(expected);
  });
});
