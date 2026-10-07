// @vitest-environment node
/**
 * @module toc-geometry-spy-retain.test
 * Purpose: pin `retainAtScrollLimit` and `selectActiveHeading` (D17 WI-2).
 * Matrix cases G-7..G-12: the guard table in order, the closed interval
 * `[anchorPx, clientHeight]`, the retention laws, bad geometry → null, the tail
 * case at the tolerance edge, and composition off the limit.
 */

import { describe, expect, it } from "vitest";
import {
  SPY_ANCHOR_OFFSET_PX as A,
  SPY_SCROLL_LIMIT_TOLERANCE_PX as T,
} from "../src/utils/codemirrorViewportLine";
import {
  pickActiveHeadingIndex,
  retainAtScrollLimit,
  selectActiveHeading,
  type GeometrySample,
} from "../src/utils/tocGeometrySpy";
import { createLcg, DEFAULT_SEED } from "./helpers/headingCorpus";

const CLIENT_H = 660;

describe("G-7 retainAtScrollLimit guard table, one row per check, in order", () => {
  it("1. picked === current wins even when current is out of range", () => {
    expect(retainAtScrollLimit(4, 4, CLIENT_H + 500, CLIENT_H, A, true)).toBe(4);
  });
  it("2. current null → picked (also with picked null)", () => {
    expect(retainAtScrollLimit(2, null, 300, CLIENT_H, A, true)).toBe(2);
    expect(retainAtScrollLimit(null, null, 300, CLIENT_H, A, true)).toBeNull();
  });
  it("3. not at the limit → picked even though current is visible at 300", () => {
    // Positive stimulus first: at the limit the same inputs retain.
    expect(retainAtScrollLimit(2, 5, 300, CLIENT_H, A, true)).toBe(5);
    expect(retainAtScrollLimit(2, 5, 300, CLIENT_H, A, false)).toBe(2);
  });
  it("4. unresolvable currentTop at the limit → picked", () => {
    expect(retainAtScrollLimit(2, 5, Number.NaN, CLIENT_H, A, true)).toBe(2);
    expect(retainAtScrollLimit(2, 5, undefined, CLIENT_H, A, true)).toBe(2);
    expect(retainAtScrollLimit(2, 5, null, CLIENT_H, A, true)).toBe(2);
  });
  it("5. at the limit, currentTop 300 → current", () => {
    expect(retainAtScrollLimit(2, 5, 300, CLIENT_H, A, true)).toBe(5);
  });
  it("6. at the limit, currentTop A−1 → picked", () => {
    expect(retainAtScrollLimit(2, 5, A - 1, CLIENT_H, A, true)).toBe(2);
  });
  it("7. at the limit, currentTop clientHeight+1 → picked", () => {
    expect(retainAtScrollLimit(2, 5, CLIENT_H + 1, CLIENT_H, A, true)).toBe(2);
  });
});

describe("G-8 closed-interval edges at the limit", () => {
  const rows: Array<[number, "picked" | "current"]> = [
    [A - 1, "picked"],
    [A, "current"],
    [A + 1, "current"],
    [CLIENT_H - 1, "current"],
    [CLIENT_H, "current"],
    [CLIENT_H + 1, "picked"],
  ];
  it.each(rows)("currentTop %d → %s", (top, which) => {
    expect(retainAtScrollLimit(1, 7, top, CLIENT_H, A, true)).toBe(which === "picked" ? 1 : 7);
  });
});

describe("G-9 retention laws (S5)", () => {
  it(`600 seeded tuples: non-invention, idempotence, projection (seed ${DEFAULT_SEED})`, () => {
    const next = createLcg(DEFAULT_SEED ^ 0x99);
    const KEYS: Array<number | null> = [null, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const TOPS = [Number.NaN, -100, A - 1, A, 300, 660, 661, 5000];
    let retainedNonPicked = 0;
    for (let c = 0; c < 600; c++) {
      const picked = KEYS[next() % KEYS.length];
      const current = KEYS[next() % KEYS.length];
      const top = TOPS[next() % TOPS.length];
      const ch = next() % 2 === 0 ? 0 : CLIENT_H;
      const atLimit = next() % 2 === 0;
      const label = `seed ${DEFAULT_SEED} tuple ${c}`;
      const r = retainAtScrollLimit(picked, current, top, ch, A, atLimit);
      expect(r === picked || r === current || r === null, label).toBe(true);
      if (r === null) expect(picked, label).toBeNull();
      expect(retainAtScrollLimit(r, current, top, ch, A, atLimit), label).toBe(r);
      if (!atLimit) expect(r, label).toBe(picked);
      if (r === current && current !== picked) retainedNonPicked++;
    }
    expect(retainedNonPicked).toBeGreaterThan(0);
  });
});

/** Scroller-relative tops for content offsets at a given scrollTop. */
function sampleAt(
  offsets: readonly number[],
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): GeometrySample {
  return {
    count: offsets.length,
    topAt: (i) => offsets[i] - scrollTop,
    scrollTop,
    scrollHeight,
    clientHeight,
  };
}

describe("G-10 bad geometry → null", () => {
  // Layout whose pick is 0: one heading at the top of the content.
  const offsets = [0, 900, 1500];
  it("guard: clientHeight 660 picks 0", () => {
    expect(selectActiveHeading(sampleAt(offsets, 0, 2000, 660), null)).toBe(0);
    expect(selectActiveHeading(sampleAt(offsets, 0, 2000, 660), 0)).toBe(0);
  });
  const bad: Array<[string, number, number]> = [
    ["clientHeight 0", 0, 0],
    ["clientHeight −1", 0, -1],
    ["clientHeight NaN", 0, Number.NaN],
    ["scrollTop NaN", Number.NaN, 660],
    ["scrollTop Infinity", Infinity, 660],
  ];
  it.each(bad)("%s → null", (_label, scrollTop, clientHeight) => {
    const sample: GeometrySample = {
      count: offsets.length,
      topAt: (i) => offsets[i],
      scrollTop,
      scrollHeight: 2000,
      clientHeight,
    };
    expect(selectActiveHeading(sample, null)).toBeNull();
    expect(selectActiveHeading(sample, 0)).toBeNull();
  });
});

describe("G-11 tail case and the tolerance edge", () => {
  const MAX = 2000 - CLIENT_H; // 1340
  it("matrix layout [0, 900, 1500, 1880]", () => {
    const offsets = [0, 900, 1500, 1880];
    const at = (st: number, cur: number | null) => selectActiveHeading(sampleAt(offsets, st, 2000, CLIENT_H), cur);
    // (a) at the limit, current = last → kept.
    expect(at(MAX, 3)).toBe(3);
    // (b) within tolerance → still at the limit → kept.
    expect(at(MAX - T, 3)).toBe(3);
    // (c) one pixel past the tolerance → the heading that owns the anchor wins.
    // Anchor sits at content y = 1338 + A = 1378; heading 1 (900) owns it.
    // (The matrix row says `2`; see the implementation report — heading 2 at 1500
    // cannot reach the anchor at this scrollTop.)
    expect(at(MAX - T - 1, 3)).toBe(pickActiveHeadingIndex(4, (i) => offsets[i] - (MAX - T - 1), A));
    expect(at(MAX - T - 1, 3)).toBe(1);
    // (d) as (a) with current 2 → 2 is visible (rel 160) and retained.
    expect(at(MAX, 2)).toBe(2);
  });
  it("companion layout [0, 900, 1370, 1880] where heading 2 owns the anchor near the limit", () => {
    const offsets = [0, 900, 1370, 1880];
    const at = (st: number, cur: number | null) => selectActiveHeading(sampleAt(offsets, st, 2000, CLIENT_H), cur);
    expect(at(MAX, 3)).toBe(3);
    expect(at(MAX - T, 3)).toBe(3);
    expect(at(MAX - T - 1, 3)).toBe(2);
    expect(at(MAX, 2)).toBe(2);
  });
});

describe("G-12 composition law off the limit", () => {
  it(`300 seeded layouts, scrollTop ≤ max − T − 1, equals the raw pick at SPY_ANCHOR_OFFSET_PX (seed ${DEFAULT_SEED})`, () => {
    const next = createLcg(DEFAULT_SEED ^ 0x12);
    let atAnchorCases = 0;
    for (let c = 0; c < 300; c++) {
      const clientHeight = 300 + (next() % 700);
      const scrollHeight = clientHeight + 2 + T + (next() % 5000);
      const max = scrollHeight - clientHeight;
      const scrollTop = next() % (max - T);
      const rel: number[] = [];
      const n = next() % 30;
      for (let k = 0; k < n; k++) rel.push(-scrollTop + (next() % scrollHeight));
      if (c % 5 < 2) {
        rel.push(A, A + 1);
        atAnchorCases++;
      }
      rel.sort((a, b) => a - b);
      const currentIndex = rel.length > 0 && next() % 3 !== 0 ? next() % rel.length : null;
      const sample: GeometrySample = { count: rel.length, topAt: (i) => rel[i], scrollTop, scrollHeight, clientHeight };
      const label = `seed ${DEFAULT_SEED} layout ${c}`;
      expect(scrollTop <= max - T - 1, label).toBe(true);
      expect(selectActiveHeading(sample, currentIndex), label).toBe(
        pickActiveHeadingIndex(rel.length, (i) => rel[i], A),
      );
    }
    expect(atAnchorCases).toBeGreaterThanOrEqual(50);
  });
});
