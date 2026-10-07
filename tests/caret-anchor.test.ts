// @vitest-environment node
/**
 * D37 WI-2 — `anchorCaretAcrossReplace` example cases CA-1..CA-18.
 *
 * Matrix: `.claude/tdd-guardian/tests-20260930-233000.md`, §"Unit:
 * src/utils/caretAnchor.ts#anchorCaretAcrossReplace", as amended by §"Coordinator
 * additions" (CA-16, CA-17) and §"Adversary round 1 — resolutions" (authoritative:
 * the two-candidate tie rule, no overlap normalisation, CA-17 re-scoped, CA-18 added).
 *
 * The rule under test, with `start = findDiffStart`, `{a, b} = findDiffEnd` (raw) on the
 * old doc rebuilt in the new schema, and `h` = head clamped to the old size:
 * `pre = h` is valid when `h ≤ start`; `suf = h − a + b` when `h ≥ a`. Exactly one valid →
 * use it; neither → `start`; both (a tie) → the candidate whose new textblock `eq`s the
 * old head's textblock at the same parentOffset, `pre` checked first, else `pre`.
 * Everything clamped to `[0, newSize]`.
 *
 * Real prosemirror-model, two `Schema` instances from one spec; no mocks. Positions are
 * PM positions: in `P("Hello world")` the text spans 1..12 and `content.size` is 13.
 */
import { describe, expect, it } from "vitest";
import type { Node } from "@milkdown/kit/prose/model";
import { anchorCaretAcrossReplace, CARET_ANCHOR_MAX_DOC_SIZE } from "../src/utils/caretAnchor";
import { docOf, rebuildIn, schemaA, schemaB, schemaNarrow, type Block } from "./helpers/caretAnchorSchemas";

const oldA = (blocks: Block[]): Node => docOf(schemaA, blocks);
const newB = (blocks: Block[]): Node => docOf(schemaB, blocks);
const posOf = (oldDoc: Node, newDoc: Node, heads: number[]): number[] =>
  heads.map((h) => anchorCaretAcrossReplace(oldDoc, newDoc, h).pos);

/** The diff the function is specified against: old rebuilt in the NEW schema. */
function diffOf(oldDoc: Node, newDoc: Node): { start: number | null; a?: number; b?: number } {
  const rebuilt = rebuildIn(newDoc.type.schema, oldDoc);
  const start = rebuilt.content.findDiffStart(newDoc.content);
  if (start === null) return { start };
  const end = rebuilt.content.findDiffEnd(newDoc.content);
  return { start, a: end?.a, b: end?.b };
}

describe("anchorCaretAcrossReplace — cross-schema and unchanged", () => {
  it("CA-1: a direct diff across schemas is 0, the function still maps the caret", () => {
    const oldDoc = oldA(["Hello world"]);
    const newDoc = newB(["XY Hello world"]);
    expect(oldDoc.type.schema).not.toBe(newDoc.type.schema);
    expect(oldDoc.content.findDiffStart(newDoc.content)).toBe(0);
    expect(anchorCaretAcrossReplace(oldDoc, newDoc, 12)).toEqual({ pos: 15, anchor: "diff" });
  });

  it("CA-2: identical content across two schemas keeps the clamped head, anchor unchanged", () => {
    const oldDoc = oldA(["Hello world"]);
    const newDoc = newB(["Hello world"]);
    expect(oldDoc.content.findDiffStart(newDoc.content)).toBe(0);
    expect(diffOf(oldDoc, newDoc).start).toBeNull();
    expect([5, -1, 99].map((h) => anchorCaretAcrossReplace(oldDoc, newDoc, h))).toEqual([
      { pos: 5, anchor: "unchanged" },
      { pos: 0, anchor: "unchanged" },
      { pos: 13, anchor: "unchanged" },
    ]);
  });
});

describe("anchorCaretAcrossReplace — inline inserts", () => {
  it("CA-3: an insert before the caret shifts it by the inserted length", () => {
    expect(anchorCaretAcrossReplace(oldA(["ab"]), newB(["XYab"]), 3)).toEqual({ pos: 5, anchor: "diff" });
  });

  it("CA-4: an insert after the caret leaves the head unchanged (Δ ≠ 0)", () => {
    expect(anchorCaretAcrossReplace(oldA(["abab"]), newB(["ababXY"]), 2)).toEqual({ pos: 2, anchor: "diff" });
  });

  it("CA-5: an insert exactly at the caret — the tie goes left", () => {
    expect(anchorCaretAcrossReplace(oldA(["abba"]), newB(["abXYba"]), 3).pos).toBe(3);
  });

  it("CA-6: insert at doc start — no caret lands inside the inserted text", () => {
    const mapped = posOf(oldA(["ab"]), newB(["XYab"]), [1, 2, 3]);
    expect(mapped).toEqual([1, 4, 5]);
    expect(mapped.filter((p) => p > 1 && p < 3)).toEqual([]);
  });

  it("CA-7: insert at doc end — no caret lands inside the inserted text", () => {
    const mapped = posOf(oldA(["ab"]), newB(["abXY"]), [1, 2, 3]);
    expect(mapped).toEqual([1, 2, 3]);
    expect(mapped.filter((p) => p > 3 && p < 5)).toEqual([]);
  });
});

describe("anchorCaretAcrossReplace — regions, clamping, fallbacks", () => {
  it("CA-8(i): multi-region edit with Δ = 0 — inside maps to start, the end side is head − a + b", () => {
    const oldDoc = oldA(["abcdefgh"]);
    const newDoc = newB(["aXbcdefh"]);
    expect(diffOf(oldDoc, newDoc)).toEqual({ start: 2, a: 8, b: 8 });
    expect(posOf(oldDoc, newDoc, [1, 2, 5, 8, 9])).toEqual([1, 2, 2, 8, 9]);
  });

  it("CA-8(ii): multi-region edit with Δ = +1 — head 5 maps to start, not head + Δ", () => {
    const oldDoc = oldA(["abcdefgh"]);
    const newDoc = newB(["aXYbcdefh"]);
    expect(diffOf(oldDoc, newDoc)).toEqual({ start: 2, a: 8, b: 9 });
    expect(posOf(oldDoc, newDoc, [1, 5, 8, 9])).toEqual([1, 2, 9, 10]);
  });

  it("CA-9: aab → aaab maps heads 0..5 to [0,1,2,3,5,6] — never negative, monotone", () => {
    const oldDoc = oldA(["aab"]);
    const newDoc = newB(["aaab"]);
    expect(diffOf(oldDoc, newDoc)).toEqual({ start: 3, a: 1, b: 2 });
    const mapped = posOf(oldDoc, newDoc, [0, 1, 2, 3, 4, 5]);
    expect(mapped).toEqual([0, 1, 2, 3, 5, 6]);
    expect(mapped.every((p, i) => i === 0 || p >= mapped[i - 1])).toBe(true);
  });

  it("CA-10: clamps a head past the new end, and a negative head", () => {
    expect(posOf(oldA(["Hello world"]), newB(["Hi"]), [12, 50, -3])).toEqual([3, 4, 0]);
  });

  /*
   * CA-19 — a head inside a rewritten region maps to the region start (adversary round 2,
   * note b). Hand working; old `P("Hello world")` spans 0..13, text 1..12, h = 3 (`He|llo`).
   * (i) new `P(Summary)` 0..9, `P(Hello world)` 9..22, `P(bar)` 22..27.
   *     findDiffStart: P vs P same markup, text 'H' vs 'S' differ at once → start = 1.
   *     findDiffEnd: last children P(Hello world) vs P(bar), inner ends 12 / 26, 'd' vs 'r'
   *     differ at once → a = 12, b = 26. h = 3: not ≤ 1, not ≥ 12 → neither → start = 1.
   * (ii) new `P(Hello)` 0..7, `P(Hello there)` 7..20.
   *     findDiffStart: "Hello world" vs "Hello" share 5 chars → start = 1 + 5 = 6.
   *     findDiffEnd: P(Hello world) vs P(Hello there), inner ends 12 / 19, 'd' vs 'e'
   *     differ → a = 12, b = 19. h = 3 ≤ 6 and < 12 → only `pre` is valid → 3.
   *     NOTE: (ii) runs the `pre` branch, not the inside branch; the caret lands inside
   *     new content only because the new first paragraph repeats the old prefix.
   */
  it("CA-19(i): a head strictly inside a rewritten region maps to the region start", () => {
    const oldDoc = oldA(["Hello world"]);
    const newDoc = newB(["Summary", "Hello world", "bar"]);
    expect(diffOf(oldDoc, newDoc)).toEqual({ start: 1, a: 12, b: 26 });
    expect(anchorCaretAcrossReplace(oldDoc, newDoc, 3)).toEqual({ pos: 1, anchor: "diff" });
  });

  it("CA-19(ii): a rewrite that keeps the old prefix keeps the head (pre branch)", () => {
    const oldDoc = oldA(["Hello world"]);
    const newDoc = newB(["Hello", "Hello there"]);
    expect(diffOf(oldDoc, newDoc)).toEqual({ start: 6, a: 12, b: 19 });
    expect(anchorCaretAcrossReplace(oldDoc, newDoc, 3)).toEqual({ pos: 3, anchor: "diff" });
  });

  it("CA-11: a forced schema mismatch gives fallback-json with no throw", () => {
    const oldDoc = docOf(schemaA, [{ h: "T" }, "ab"]);
    const newDoc = docOf(schemaNarrow, ["ab"]);
    expect(() => rebuildIn(schemaNarrow, oldDoc)).toThrow(RangeError);
    let result: unknown;
    expect(() => {
      result = anchorCaretAcrossReplace(oldDoc, newDoc, 5);
    }).not.toThrow();
    expect(result).toEqual({ pos: 4, anchor: "fallback-json" });
  });

  const M = CARET_ANCHOR_MAX_DOC_SIZE;

  it("CA-12(a): an old doc of exactly the threshold size is still diffed", { timeout: 30_000 }, () => {
    expect(M).toBeGreaterThan(0);
    const oldDoc = oldA(["a".repeat(M - 2)]);
    expect(oldDoc.content.size).toBe(M);
    const newDoc = newB(["a".repeat(M - 2) + "X"]);
    expect(anchorCaretAcrossReplace(oldDoc, newDoc, M - 1)).toEqual({ pos: M - 1, anchor: "diff" });
  });

  it("CA-12(b): an old doc one past the threshold falls back to the clamped head", { timeout: 30_000 }, () => {
    const oldDoc = oldA(["a".repeat(M - 1)]);
    expect(oldDoc.content.size).toBe(M + 1);
    const newDoc = newB(["a".repeat(M - 1) + "X"]);
    expect(anchorCaretAcrossReplace(oldDoc, newDoc, M)).toEqual({ pos: M, anchor: "fallback-size" });
  });
});

describe("anchorCaretAcrossReplace — block inserts and the tie rule", () => {
  it("CA-13: a block inserted before the caret's paragraph, caret mid-paragraph, shifts by its node size", () => {
    expect(anchorCaretAcrossReplace(oldA(["ab", "ba"]), newB(["ab", "XY", "ba"]), 6)).toEqual({
      pos: 10,
      anchor: "diff",
    });
  });

  it("CA-14(i): a block inserted before the caret's paragraph, caret at its start (XY / Zab)", () => {
    expect(anchorCaretAcrossReplace(oldA(["ab"]), newB(["XY", "ab"]), 1).pos).toBe(5);
  });

  it("CA-14(ii): the same mid-document — the caret stays at the start of its own paragraph", () => {
    expect(anchorCaretAcrossReplace(oldA(["ab", "ba"]), newB(["ab", "XY", "ba"]), 5).pos).toBe(9);
  });

  it("CA-15: pure and deterministic — equal results, inputs unchanged", () => {
    const oldDoc = oldA(["abcdefgh"]);
    const newDoc = newB(["aXYbcdefh"]);
    const oldJson = JSON.stringify(oldDoc.toJSON());
    const newJson = JSON.stringify(newDoc.toJSON());
    const first = anchorCaretAcrossReplace(oldDoc, newDoc, 5);
    const second = anchorCaretAcrossReplace(oldDoc, newDoc, 5);
    expect(second).toEqual(first);
    expect(JSON.stringify(oldDoc.toJSON())).toBe(oldJson);
    expect(JSON.stringify(newDoc.toJSON())).toBe(newJson);
  });

  it("CA-16: a tie where suf is in a textblock at a different parentOffset stays left", () => {
    const oldDoc = oldA(["ab"]);
    const newDoc = newB(["a", { hr: true }, "b"]);
    expect(diffOf(oldDoc, newDoc)).toEqual({ start: 2, a: 2, b: 5 });
    const $b = newDoc.resolve(5);
    expect($b.parent.isTextblock).toBe(true);
    expect($b.parentOffset).toBe(0);
    expect(oldDoc.resolve(2).parentOffset).toBe(1);
    expect(anchorCaretAcrossReplace(oldDoc, newDoc, 2)).toEqual({ pos: 2, anchor: "diff" });
  });

  /*
   * CA-17 (re-scoped by the adversary round): at a tie, an old head that is NOT in a
   * textblock takes `pre`. The pair is chosen so the guard is observable: `suf`'s parent
   * in the new doc DOES `eq` the old head's container at the same parentOffset, so a
   * rule that dropped the textblock checks would move the caret right (to 9 and 12).
   */
  it("CA-17: a tie with the old head in a non-textblock container stays left, no throw", () => {
    const oldDoc = oldA([{ bq: ["a"] }]);
    const newDoc = newB([{ bq: ["a", "b"] }, { bq: ["a"] }]);
    const { start, a, b } = diffOf(oldDoc, newDoc);
    expect({ start, a, b }).toEqual({ start: 4, a: 0, b: 8 });
    const rebuilt = rebuildIn(schemaB, oldDoc);
    for (const h of [1, 4]) {
      expect(h <= start! && h >= a!, `h=${h} is a tie`).toBe(true);
      const $old = rebuilt.resolve(h);
      expect($old.parent.isTextblock).toBe(false);
      const $suf = newDoc.resolve(h - a! + b!);
      expect($suf.parentOffset).toBe($old.parentOffset);
      expect($suf.parent.eq($old.parent)).toBe(true);
    }
    let results: unknown;
    expect(() => {
      results = [1, 4].map((h) => anchorCaretAcrossReplace(oldDoc, newDoc, h));
    }).not.toThrow();
    expect(results).toEqual([
      { pos: 1, anchor: "diff" },
      { pos: 4, anchor: "diff" },
    ]);
  });

  it("CA-18: a block that repeats the caret paragraph's prefix — the caret follows its paragraph", () => {
    expect(anchorCaretAcrossReplace(oldA(["a"]), newB(["ab", "a"]), 1)).toEqual({ pos: 5, anchor: "diff" });
  });

  it("CA-18 (mid-document): the same with a paragraph before", () => {
    expect(anchorCaretAcrossReplace(oldA(["b", "a"]), newB(["b", "ab", "a"]), 4)).toEqual({
      pos: 8,
      anchor: "diff",
    });
  });
});
