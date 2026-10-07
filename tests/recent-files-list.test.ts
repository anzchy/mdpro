// @vitest-environment node
/**
 * WI-5 (ADR-0031 step 5a) — the pure recent-files list operations.
 *
 * Cases RF-01 … RF-04 of `.claude/tdd-guardian/tests-20260926-221500.md`.
 *
 * **Laws.**
 * - (Head) `pushRecent(l, p)[0] === p` for non-empty `p`.
 * - (Idempotence) `pushRecent(pushRecent(l, p), p)` deep-equals `pushRecent(l, p)`.
 * - (Bound) `length <= MAX_RECENT_FILES`.
 * - (Order conservation) `pushRecent(l, p).slice(1)` deep-equals
 *   `l.filter(x => x !== p).slice(0, 9)`.
 * - (Fold equivalence, metamorphic) `mergePending(stored, [pN … p1])` deep-equals
 *   replaying `p1 … pN` through `pushRecent`, oldest first.
 *
 * No mocks: these are pure functions.
 */
import { describe, expect, it } from "vitest";
import { MAX_RECENT_FILES, mergePending, pushRecent } from "../src/utils/recentFiles";

/** mulberry32 — a small seeded PRNG so every generated case is reproducible. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = ["/a.md", "/b.md", "/c.md", "/d.md", "/e.md", "/f.md", "/g.md"];

function genList(rand: () => number, maxLen: number): string[] {
  const len = Math.floor(rand() * (maxLen + 1));
  return Array.from({ length: len }, () => ALPHABET[Math.floor(rand() * ALPHABET.length)]);
}

function L(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `/s/${i}.md`);
}

describe("RF-01 pushRecent: prepend, move-to-front, cap boundary", () => {
  it("MAX_RECENT_FILES is 10", () => {
    expect(MAX_RECENT_FILES).toBe(10);
  });

  it("prepends onto a 9-element list without dropping anything", () => {
    const out = pushRecent(L(9), "/n.md");
    expect(out).toEqual(["/n.md", ...L(9)]);
    expect(out).toHaveLength(10);
  });

  it("drops the oldest entry when a new path is pushed onto a full list", () => {
    const out = pushRecent(L(10), "/n.md");
    expect(out).toEqual(["/n.md", ...L(9)]);
    expect(out).toHaveLength(10);
  });

  it("moves an existing last element to the front and drops nothing", () => {
    const out = pushRecent(L(10), "/s/9.md");
    expect(out).toEqual(["/s/9.md", ...L(9)]);
    expect(out).toHaveLength(10);
  });

  it("caps an over-long stored list at 10", () => {
    const out = pushRecent(L(11), "/n.md");
    expect(out).toEqual(["/n.md", ...L(9)]);
    expect(out).toHaveLength(10);
  });

  it("pushes onto an empty list", () => {
    expect(pushRecent([], "/n.md")).toEqual(["/n.md"]);
  });
});

describe("RF-02 an empty path is a no-op", () => {
  it("pushRecent with an empty path returns the list unchanged", () => {
    expect(pushRecent(["/a.md"], "")).toEqual(["/a.md"]);
  });

  it("mergePending skips empty paths in the buffer", () => {
    expect(mergePending(["/a.md"], ["", "/b.md"])).toEqual(["/b.md", "/a.md"]);
  });
});

describe("RF-03 laws over generated lists", () => {
  it("Head, Idempotence, Bound and Order-conservation hold for 1,000 seeded cases", () => {
    const seed = 0x5a5a0005;
    const rand = mulberry32(seed);
    for (let i = 0; i < 1000; i += 1) {
      const l = genList(rand, 13);
      const p = ALPHABET[Math.floor(rand() * ALPHABET.length)];
      const tag = `seed=${seed} case=${i} l=${JSON.stringify(l)} p=${p}`;
      const once = pushRecent(l, p);
      expect(once[0], `Head ${tag}`).toBe(p);
      expect(pushRecent(once, p), `Idempotence ${tag}`).toEqual(once);
      expect(once.length <= MAX_RECENT_FILES, `Bound ${tag}`).toBe(true);
      expect(once.slice(1), `Order conservation ${tag}`).toEqual(
        l.filter((x) => x !== p).slice(0, MAX_RECENT_FILES - 1),
      );
    }
  });
});

describe("RF-04 mergePending equals replaying the buffer oldest first", () => {
  it("named witness: buffer [b, a] over stored [s1, s2]", () => {
    expect(mergePending(["/s1", "/s2"], ["/b", "/a"])).toEqual(["/b", "/a", "/s1", "/s2"]);
  });

  it("fold equivalence holds for 1,000 seeded cases", () => {
    const seed = 0x5a5a0404;
    const rand = mulberry32(seed);
    for (let i = 0; i < 1000; i += 1) {
      const stored = genList(rand, 12);
      const pending = genList(rand, 12);
      const expected = pending.slice().reverse().reduce(pushRecent, stored);
      expect(
        mergePending(stored, pending),
        `seed=${seed} case=${i} stored=${JSON.stringify(stored)} pending=${JSON.stringify(pending)}`,
      ).toEqual(expected);
    }
  });
});
