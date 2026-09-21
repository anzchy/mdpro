/**
 * `src/utils/lineCounter.ts` exists to remove a quadratic.
 *
 * `parseHeadingsFromContent` computed each heading's line number as
 * `countNewlines(forParse.slice(0, node.from))` — for every heading, allocate
 * the whole prefix and scan it from the start. On `.perf-corpus/dense-math.source.md`
 * (9,961,596 B, 70,886 headings) that is roughly 3.5e11 character reads and
 * hundreds of GB of cumulative allocation. It is the measured 153-183 s
 * Source-mode stall in docs/test/20260921-d6-matrix-retest.md §2 cell 7, whose
 * sampled stack top was `operationStringIndexOfWithIndexWithOneChar` — the JSC
 * fast path for exactly `indexOf("\n", i)`, which is what `countNewlines` is.
 *
 * WHICH CASE IS THE REGRESSION TEST: S1. It is deterministic and counts
 * characters, not milliseconds, so it is a real gate rather than one E39/G0
 * forbids. Every prefix-rescanning implementation — including the one being
 * replaced — reads O(n) characters per call and fails it; no timeout, no
 * machine dependence, no flake. The correctness cases around it would all pass
 * against the old code.
 */
import { describe, expect, it } from "vitest";
import { createLineCounter } from "../src/utils/lineCounter";

/**
 * Independent oracle. Deliberately the naive spelling — this is the definition
 * the fast implementation must match, and writing it a second clever way would
 * let one bug agree with itself.
 */
const referenceLine = (source: string, offset: number): number => {
  const clamped = Math.min(Math.max(offset, 0), source.length);
  return source.slice(0, clamped).split("\n").length;
};

describe("createLineCounter", () => {
  it("S1: ascending offsets cost ONE pass over the source, not one per call", () => {
    // The whole point of the module. 4,000 offsets over a 400,001-character
    // source: the old shape reads ~8e8 characters, this one reads at most
    // 400,001.
    const source = `${"x".repeat(99)}\n`.repeat(4_000);
    const counter = createLineCounter(source);

    for (let i = 0; i < 4_000; i++) counter.lineAt(i * 100);

    expect(counter.scanned).toBeLessThanOrEqual(source.length);

    // Non-vacuous in the other direction too: an implementation that answered
    // without reading anything (a cached constant, a no-op) would satisfy the
    // bound above trivially. It must actually have walked to the last offset
    // asked for.
    expect(counter.scanned).toBeGreaterThanOrEqual(399_900);
  });

  it("S2: agrees with the naive definition at every offset, for every shape", () => {
    // Equivalence is the law; the fast path earns nothing if it disagrees.
    // Shapes chosen for the ways a line scanner goes wrong: no terminator at
    // all, a terminator at index 0, consecutive terminators, a trailing
    // terminator, CRLF (where `\r` is an ordinary character and must NOT end a
    // line — src/services/tocService.ts module header), a lone `\r`, and
    // astral characters, whose surrogate halves are two offsets.
    const shapes = [
      "",
      "no terminator here",
      "\n",
      "\n\n\n",
      "a\nb\nc",
      "a\nb\nc\n",
      "a\r\nb\r\nc\r\n",
      "a\rb\rc",
      "🎉\n🎉\n🎉",
      "# 标题\n正文\n\n## 二级\n",
    ];

    for (const source of shapes) {
      // A fresh counter per offset, so a wrong rewind cannot be masked by the
      // ascending order the cursor is optimised for. S3 covers the shared-
      // counter path separately.
      for (let offset = 0; offset <= source.length; offset++) {
        expect(createLineCounter(source).lineAt(offset)).toBe(
          referenceLine(source, offset),
        );
      }
    }
  });

  it("S3: one counter answers a whole ascending sweep as the oracle does", () => {
    // S2 proves each answer in isolation; this proves the carried state does
    // not corrupt later answers. Both are needed — a counter that never
    // advanced its newline tally would pass S2 and fail here.
    const source = "alpha\nbeta\n\ngamma\r\ndelta\n";
    const counter = createLineCounter(source);

    for (let offset = 0; offset <= source.length; offset++) {
      expect(counter.lineAt(offset)).toBe(referenceLine(source, offset));
    }
  });

  it("S4: a backwards offset is answered correctly, not from a stale cursor", () => {
    // Headings arrive in document order today (Lezer's `iterate` is pre-order
    // over position-ordered children), so this path should not be reachable
    // from tocService. It is implemented and tested anyway because the failure
    // it prevents is silent: a stale cursor returns a plausible wrong line
    // number, and nothing downstream can tell a wrong line from a right one.
    const source = "one\ntwo\nthree\nfour\nfive\n";
    const counter = createLineCounter(source);

    expect(counter.lineAt(source.indexOf("five"))).toBe(5);
    expect(counter.lineAt(source.indexOf("two"))).toBe(2);
    expect(counter.lineAt(0)).toBe(1);
    expect(counter.lineAt(source.indexOf("four"))).toBe(4);
  });

  it("S5: monotonic — a later offset never reports an earlier line", () => {
    const source = "a\nbb\nccc\n\ndddd\neeeee";
    const counter = createLineCounter(source);

    let previous = 0;
    for (let offset = 0; offset <= source.length; offset++) {
      const line = counter.lineAt(offset);
      expect(line).toBeGreaterThanOrEqual(previous);
      previous = line;
    }
  });

  it("S6: offsets outside the source clamp instead of throwing or drifting", () => {
    // `node.from` should always be in range; an out-of-range offset means a
    // rebasing bug upstream. Clamping keeps that bug from becoming a crash in
    // an effect, and the value returned is the honest one for the clamp.
    const source = "a\nb\nc";
    const counter = createLineCounter(source);

    expect(counter.lineAt(-1)).toBe(1);
    expect(counter.lineAt(-1_000_000)).toBe(1);
    expect(createLineCounter(source).lineAt(source.length)).toBe(3);
    expect(createLineCounter(source).lineAt(source.length + 50)).toBe(3);
  });

  it("S7: the first line is 1, including in an empty source", () => {
    expect(createLineCounter("").lineAt(0)).toBe(1);
    expect(createLineCounter("anything").lineAt(0)).toBe(1);
  });

  it("S8: `\\r` is an ordinary character, matching the rest of the TOC stack", () => {
    // Pinned explicitly rather than left to S2's CRLF shape, because it is a
    // DECISION and not an accident: src/services/tocService.ts's module header
    // states a lone `\r` is not a line terminator, and the guard's
    // longest-line counter (ADR-0019) made the same call. Three places
    // agreeing by coincidence is how they later stop agreeing.
    const counter = createLineCounter("a\rb\rc\nd");
    expect(counter.lineAt(7)).toBe(2);
  });
});
