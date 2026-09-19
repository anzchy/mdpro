/**
 * WI-3.5.2 — `src/utils/headingCoordination.ts#coordinateHeadingKeys`, the matcher.
 *
 * Matrix: `.claude/tdd-guardian/tests-20260918-214500.md` §M, cases M1-M7, M9-M17
 * (M8 was deleted in revision 2). Laws L1-L7 are named on each case.
 *
 * No mocks anywhere in this file — the unit has no boundaries. `mint` is a production
 * parameter, supplied here as a deterministic test-owned closure returning "m1", "m2", …
 * so there is no `crypto` / `Date.now()` to stub. G0 forbids new dependencies, so every
 * generated domain below is a hand-written function in this file, not `fast-check`.
 */
import { describe, expect, it } from "vitest";

import {
  coordinateHeadingKeys,
  type KeyedHeading,
  type ParsedHeading,
} from "../src/utils/headingCoordination";
import { slugBase } from "../src/utils/headingIdentity";
import { asHeadingKey, type HeadingKey } from "../src/types/toc";

// ---------------------------------------------------------------------------
// Shared fixtures and helpers
// ---------------------------------------------------------------------------

function kh(key: string, level: number, text: string): KeyedHeading {
  return { key: asHeadingKey(key), level, text };
}

function ph(level: number, text: string): ParsedHeading {
  return { level, text };
}

function parsedOf(headings: readonly KeyedHeading[]): ParsedHeading[] {
  return headings.map(({ level, text }) => ph(level, text));
}

/** k4 duplicates k2's TEXT at a different LEVEL — the witness M15 and M17 need. */
const BASE: readonly KeyedHeading[] = [
  kh("k1", 1, "Guide"),
  kh("k2", 2, "Intro"),
  kh("k3", 2, "Setup"),
  kh("k4", 3, "Intro"),
];

/** Identical text AND level. */
const DUP: readonly KeyedHeading[] = [kh("d1", 2, "Intro"), kh("d2", 2, "Intro")];

interface MintRecorder {
  mint: () => HeadingKey;
  readonly minted: string[];
  readonly callCount: number;
}

function createMint(prefix = "m"): MintRecorder {
  const minted: string[] = [];
  return {
    mint: (): HeadingKey => {
      const value = `${prefix}${minted.length + 1}`;
      minted.push(value);
      return asHeadingKey(value);
    },
    minted,
    get callCount(): number {
      return minted.length;
    },
  };
}

// ---------------------------------------------------------------------------
// The edit-script domain shared by M2, M4 and M17
// ---------------------------------------------------------------------------

type Op =
  | { kind: "noop" }
  | { kind: "rename"; i: number }
  | { kind: "insert"; i: number }
  | { kind: "delete"; i: number }
  | { kind: "move"; i: number; j: number };

/** 1 noop + 4 renames + 5 inserts + 4 deletes + 12 moves = 26 single ops. */
function buildOpTable(): Op[] {
  const ops: Op[] = [{ kind: "noop" }];
  for (let i = 0; i < BASE.length; i += 1) ops.push({ kind: "rename", i });
  for (let i = 0; i <= BASE.length; i += 1) ops.push({ kind: "insert", i });
  for (let i = 0; i < BASE.length; i += 1) ops.push({ kind: "delete", i });
  for (let i = 0; i < BASE.length; i += 1) {
    for (let j = 0; j < BASE.length; j += 1) {
      if (i !== j) ops.push({ kind: "move", i, j });
    }
  }
  return ops;
}

/** Every script of length 1 and length 2 over the op table: 26 + 676 = 702. */
function buildScripts(): Op[][] {
  const ops = buildOpTable();
  const scripts: Op[][] = ops.map((op) => [op]);
  for (const first of ops) {
    for (const second of ops) scripts.push([first, second]);
  }
  return scripts;
}

/** A heading being tracked through a script, carrying where it came from. */
interface TrackedHeading {
  level: number;
  text: string;
  /** The `BASE` key this heading descends from, or `null` if the script created it. */
  origin: string | null;
}

/** The oracle's sentinel for "this slot must hold a freshly minted key". */
const NEW = "<new>";

function pairOf(level: number, text: string): string {
  return `${level} ${text}`;
}

function assertPairwiseDistinct(headings: readonly ParsedHeading[], where: string): void {
  const seen = new Set<string>();
  for (const heading of headings) {
    const pair = pairOf(heading.level, heading.text);
    if (seen.has(pair)) {
      // M17 precondition 1. The oracle is undefined here, so throw rather than
      // silently weaken the case into something that cannot fail.
      throw new Error(`M17 precondition violated: duplicate (level,text) in ${where}: ${pair}`);
    }
    seen.add(pair);
  }
}

function applyOp(list: readonly TrackedHeading[], op: Op, insertSeq: number): TrackedHeading[] {
  const copy = list.map((h) => ({ ...h }));
  switch (op.kind) {
    case "noop":
      return copy;
    case "rename": {
      if (op.i >= copy.length) return copy;
      copy[op.i] = { ...copy[op.i], text: `Renamed ${op.i}` };
      return copy;
    }
    case "insert": {
      if (op.i > copy.length) return copy;
      copy.splice(op.i, 0, { level: 4, text: `Brand new ${insertSeq}`, origin: null });
      return copy;
    }
    case "delete": {
      if (op.i >= copy.length) return copy;
      copy.splice(op.i, 1);
      return copy;
    }
    case "move": {
      if (op.i >= copy.length) return copy;
      const [moved] = copy.splice(op.i, 1);
      if (op.j > copy.length) return list.map((h) => ({ ...h }));
      copy.splice(op.j, 0, moved);
      return copy;
    }
  }
}

/**
 * Apply `script` to `BASE` and derive, from the script's own provenance, exactly which
 * key each resulting slot must hold. The oracle never calls `coordinateHeadingKeys`.
 *
 * Derivation, stated over provenance and asserted preconditions (not over the matcher's
 * data structures):
 *   1. A surviving heading whose `(level, text)` is unchanged keeps its origin key. Under
 *      precondition 1 (pairs pairwise distinct on both sides) that pairing is forced: the
 *      matcher's exact-match pass has exactly one candidate.
 *   2. Any remaining slot `i` takes `BASE[i].key` iff that key was not taken in step 1 and
 *      `BASE[i].level === next[i].level` — the same-ordinal-same-level continuity policy.
 *      This is where a rename keeps its key, and also where the documented delete+insert
 *      limitation (M16) is encoded: once, here, rather than per case.
 *   3. Everything else must be freshly minted (`NEW`).
 */
function applyScript(script: readonly Op[]): { next: ParsedHeading[]; expectedKeys: string[] } {
  if (script.length > 2) {
    throw new Error(`M17 precondition violated: script longer than 2: ${JSON.stringify(script)}`);
  }

  let tracked: TrackedHeading[] = BASE.map((h) => ({
    level: h.level,
    text: h.text,
    origin: h.key,
  }));
  let insertSeq = 0;
  for (const op of script) {
    if (op.kind === "insert") insertSeq += 1;
    tracked = applyOp(tracked, op, insertSeq);
  }

  const next = tracked.map(({ level, text }) => ph(level, text));
  const basePairs = new Set(BASE.map((h) => pairOf(h.level, h.text)));
  const baseByKey = new Map(BASE.map((h, index) => [h.key as string, { ...h, index }]));

  assertPairwiseDistinct(parsedOf(BASE), "previous");
  assertPairwiseDistinct(next, "next");

  // Step 1 — survivors whose pair is unchanged.
  const consumed = new Set<string>();
  const expectedKeys: string[] = tracked.map((heading) => {
    const origin = heading.origin === null ? null : baseByKey.get(heading.origin);
    const unchanged =
      origin !== undefined && origin !== null && origin.level === heading.level && origin.text === heading.text;
    if (unchanged) {
      consumed.add(origin.key as string);
      return origin.key as string;
    }
    if (basePairs.has(pairOf(heading.level, heading.text))) {
      // A changed/new heading must not collide with a `previous` pair, or step 1's
      // "exactly one candidate" argument fails and the oracle is undefined.
      throw new Error(
        `M17 precondition violated: changed heading collides with a previous pair: ${pairOf(heading.level, heading.text)}`,
      );
    }
    return NEW;
  });

  // Step 2 — same-ordinal, same-level continuity among the leftovers.
  for (let i = 0; i < expectedKeys.length; i += 1) {
    if (expectedKeys[i] !== NEW) continue;
    if (i >= BASE.length) continue;
    const candidate = BASE[i];
    if (consumed.has(candidate.key as string)) continue;
    if (candidate.level !== next[i].level) continue;
    consumed.add(candidate.key as string);
    expectedKeys[i] = candidate.key as string;
  }

  return { next, expectedKeys };
}

/** Size of the multiset intersection of `(level, text)` pairs — the L4 bound's `I`. */
function multisetIntersectionSize(
  previous: readonly KeyedHeading[],
  next: readonly ParsedHeading[],
): number {
  const counts = new Map<string, number>();
  for (const h of previous) {
    const pair = pairOf(h.level, h.text);
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  let intersection = 0;
  for (const h of next) {
    const pair = pairOf(h.level, h.text);
    const remaining = counts.get(pair) ?? 0;
    if (remaining > 0) {
      counts.set(pair, remaining - 1);
      intersection += 1;
    }
  }
  return intersection;
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += 1) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([items[i], ...tail]);
  }
  return out;
}

const SCRIPTS = buildScripts();
const BASE_KEYS = new Set(BASE.map((h) => h.key as string));

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

describe("coordinateHeadingKeys — M1: LAW L1, idempotence and `mint` untouched", () => {
  it("returns previous keys in order across three repeated revisions, minting nothing", () => {
    const recorder = createMint();

    const first = coordinateHeadingKeys(BASE, parsedOf(BASE), recorder.mint);
    expect(first).toEqual(["k1", "k2", "k3", "k4"]);

    const secondPrevious: KeyedHeading[] = BASE.map((h, i) => ({ ...h, key: first[i] }));
    const second = coordinateHeadingKeys(secondPrevious, parsedOf(BASE), recorder.mint);
    expect(second).toEqual(["k1", "k2", "k3", "k4"]);

    const thirdPrevious: KeyedHeading[] = BASE.map((h, i) => ({ ...h, key: second[i] }));
    const third = coordinateHeadingKeys(thirdPrevious, parsedOf(BASE), recorder.mint);
    expect(third).toEqual(["k1", "k2", "k3", "k4"]);

    expect(recorder.callCount).toBe(0);
  });
});

describe("coordinateHeadingKeys — M2: LAW L2, conservation over the edit-script domain", () => {
  it("enumerates every script of length <= 2 (26 singles + 676 pairs)", () => {
    expect(SCRIPTS.length).toBe(26 + 26 * 26);
  });

  it("never duplicates a key, never invents one, and always returns one key per heading", () => {
    for (const script of SCRIPTS) {
      const ctx = JSON.stringify(script);
      const { next } = applyScript(script);
      const recorder = createMint();
      const out = coordinateHeadingKeys(BASE, next, recorder.mint);

      expect(out.length, ctx).toBe(next.length);
      expect(new Set(out).size, ctx).toBe(out.length);

      const mintedKeys = new Set(recorder.minted);
      expect(
        out.every((k) => BASE_KEYS.has(k as string) || mintedKeys.has(k as string)),
        ctx,
      ).toBe(true);

      const reused = out.filter((k) => BASE_KEYS.has(k as string));
      expect(new Set(reused).size, ctx).toBe(reused.length);
    }
  });
});

describe("coordinateHeadingKeys — M3: LAW L3, a pure rename preserves the key while the slug changes", () => {
  const RENAMES: ReadonlyArray<readonly [string, string]> = [
    ["Intro", "Introduction"],
    ["架构", "架构设计"],
    ["Setup", "Set up"],
    ["A", "B"],
    ["- Draft", "- Final"],
    ["Setup…", "Teardown…"],
    ["(beta)", "(stable)"],
    ["v1.0", "v2.0"],
  ];

  it("preserves the key for eight rename pairs whose slugs provably differ", () => {
    for (const [oldText, newText] of RENAMES) {
      const ctx = `${oldText} -> ${newText}`;
      expect(slugBase(oldText), ctx).not.toBe(slugBase(newText));

      const recorder = createMint();
      const out = coordinateHeadingKeys([kh("k1", 2, oldText)], [ph(2, newText)], recorder.mint);
      expect(out, ctx).toEqual(["k1"]);
      expect(recorder.callCount, ctx).toBe(0);
    }
  });

  it("preserves the key for a rename in place at each index of a four-heading document", () => {
    for (let i = 0; i < BASE.length; i += 1) {
      const ctx = `rename at ${i}`;
      const next = parsedOf(BASE).map((h, index) => (index === i ? ph(h.level, "Renamed") : h));
      const recorder = createMint();
      const out = coordinateHeadingKeys(BASE, next, recorder.mint);
      expect(out, ctx).toEqual(["k1", "k2", "k3", "k4"]);
      expect(recorder.callCount, ctx).toBe(0);
    }
  });
});

describe("coordinateHeadingKeys — M4: LAW L4, mint count equals the unmatched count and respects the intersection bound", () => {
  it("holds across the whole edit-script domain", () => {
    for (const script of SCRIPTS) {
      const ctx = JSON.stringify(script);
      const { next } = applyScript(script);
      const recorder = createMint();
      const out = coordinateHeadingKeys(BASE, next, recorder.mint);

      const unmatched = out.filter((k) => !BASE_KEYS.has(k as string)).length;
      expect(recorder.callCount, ctx).toBe(unmatched);

      const intersection = multisetIntersectionSize(BASE, next);
      expect(recorder.callCount, `${ctx} I=${intersection}`).toBeLessThanOrEqual(
        next.length - intersection,
      );
    }
  });

  it("holds for DUP-seeded revisions where the intersection binds", () => {
    const cases: ReadonlyArray<{ previous: readonly KeyedHeading[]; next: ParsedHeading[] }> = [
      { previous: DUP, next: [ph(2, "Intro")] },
      { previous: DUP, next: [ph(2, "Intro"), ph(2, "Intro"), ph(2, "Intro")] },
      { previous: DUP, next: [ph(2, "Intro"), ph(3, "Intro")] },
      { previous: DUP, next: [] },
    ];

    for (const { previous, next } of cases) {
      const ctx = JSON.stringify(next);
      const recorder = createMint();
      const out = coordinateHeadingKeys(previous, next, recorder.mint);
      const previousKeys = new Set(previous.map((h) => h.key as string));

      expect(recorder.callCount, ctx).toBe(out.filter((k) => !previousKeys.has(k as string)).length);
      expect(recorder.callCount, ctx).toBeLessThanOrEqual(
        next.length - multisetIntersectionSize(previous, next),
      );
    }
  });
});

describe("coordinateHeadingKeys — M5: LAW L5, a pure move is permutation-equivariant", () => {
  const MOVABLE: readonly KeyedHeading[] = [
    kh("k1", 1, "Guide"),
    kh("k2", 2, "Intro"),
    kh("k3", 2, "Setup"),
    kh("k4", 3, "Details"),
  ];

  it("returns previous keys under the permutation for all 24 permutations, minting nothing", () => {
    const perms = permutations([0, 1, 2, 3]);
    expect(perms.length).toBe(24);

    for (const p of perms) {
      const ctx = `permutation ${p.join("")}`;
      const next = p.map((index) => ph(MOVABLE[index].level, MOVABLE[index].text));
      const recorder = createMint();
      const out = coordinateHeadingKeys(MOVABLE, next, recorder.mint);

      expect(out, ctx).toEqual(p.map((index) => MOVABLE[index].key));
      expect(recorder.callCount, ctx).toBe(0);
    }
  });
});

describe("coordinateHeadingKeys — M6: LAW L6, determinism and absence of module state", () => {
  const next = [ph(1, "Guide"), ph(2, "Renamed"), ph(2, "Setup")];

  it("returns deep-equal results for two calls with independent mint closures", () => {
    const a = createMint();
    const b = createMint();

    const first = coordinateHeadingKeys(BASE, next, a.mint);
    const second = coordinateHeadingKeys(BASE, next, b.mint);

    expect(second).toEqual(first);
    expect(b.callCount).toBe(a.callCount);
  });

  it("is not perturbed by an unrelated interleaved call", () => {
    const a = createMint();
    const b = createMint();
    const noise = createMint();

    const first = coordinateHeadingKeys(BASE, next, a.mint);
    coordinateHeadingKeys(DUP, [ph(2, "Intro"), ph(2, "Intro"), ph(2, "Other")], noise.mint);
    const second = coordinateHeadingKeys(BASE, next, b.mint);

    expect(second).toEqual(first);
    expect(b.callCount).toBe(a.callCount);
  });
});

describe("coordinateHeadingKeys — M7: RESET case (a), text and relative order both change", () => {
  it("mints a fresh key and retires the old one", () => {
    const previous = [kh("k1", 2, "Alpha"), kh("k2", 2, "Beta"), kh("k3", 2, "Gamma")];
    const next = [ph(2, "Beta renamed"), ph(2, "Alpha"), ph(2, "Gamma")];
    const recorder = createMint();

    const out = coordinateHeadingKeys(previous, next, recorder.mint);

    expect(out).toEqual(["m1", "k1", "k3"]);
    expect(out).not.toContain("k2");
    expect(recorder.callCount).toBe(1);
  });
});

describe("coordinateHeadingKeys — M9: insert does not shift identity", () => {
  const previous = [kh("k1", 2, "A"), kh("k2", 2, "B"), kh("k3", 2, "C")];
  const arms: ReadonlyArray<readonly [number, string[]]> = [
    [0, ["m1", "k1", "k2", "k3"]],
    [1, ["k1", "m1", "k2", "k3"]],
    [3, ["k1", "k2", "k3", "m1"]],
  ];

  it("gives the inserted heading a fresh key at head, middle and tail", () => {
    for (const [at, expected] of arms) {
      const ctx = `insert at ${at}`;
      const next = parsedOf(previous);
      next.splice(at, 0, ph(2, "New"));
      const recorder = createMint();

      const out = coordinateHeadingKeys(previous, next, recorder.mint);

      expect(out, ctx).toEqual(expected);
      expect(recorder.callCount, ctx).toBe(1);
      expect(["k1", "k2", "k3"], ctx).not.toContain(out[at] as string);
    }
  });
});

describe("coordinateHeadingKeys — M10: delete retires and never reassigns", () => {
  const previous = [kh("k1", 2, "A"), kh("k2", 2, "B"), kh("k3", 2, "C")];
  const arms: ReadonlyArray<readonly [number, string, string[]]> = [
    [0, "k1", ["k2", "k3"]],
    [1, "k2", ["k1", "k3"]],
    [2, "k3", ["k1", "k2"]],
  ];

  it("drops the deleted key at head, middle and tail without shifting", () => {
    for (const [at, deleted, expected] of arms) {
      const ctx = `delete ${at}`;
      const next = parsedOf(previous);
      next.splice(at, 1);
      const recorder = createMint();

      const out = coordinateHeadingKeys(previous, next, recorder.mint);

      expect(out, ctx).toEqual(expected);
      expect(out, ctx).not.toContain(deleted);
      expect(recorder.callCount, ctx).toBe(0);
    }
  });
});

describe("coordinateHeadingKeys — M11: duplicates stay independent", () => {
  it("mints two distinct keys when both duplicates are new", () => {
    const recorder = createMint();
    const out = coordinateHeadingKeys([], [ph(2, "Intro"), ph(2, "Intro")], recorder.mint);

    expect(out).toEqual(["m1", "m2"]);
    expect(out[0]).not.toBe(out[1]);
    expect(recorder.callCount).toBe(2);
  });

  it("preserves both duplicates positionally across a non-heading edit", () => {
    const recorder = createMint();
    const out = coordinateHeadingKeys(DUP, [ph(2, "Intro"), ph(2, "Intro")], recorder.mint);

    expect(out).toEqual(["d1", "d2"]);
    expect(out[0]).not.toBe(out[1]);
    expect(recorder.callCount).toBe(0);
  });
});

describe("coordinateHeadingKeys — M12: duplicate-count overflow and underflow", () => {
  it("mints once when the duplicate group grows beyond the previous count", () => {
    const recorder = createMint();
    const out = coordinateHeadingKeys(
      DUP,
      [ph(2, "Intro"), ph(2, "Intro"), ph(2, "Intro")],
      recorder.mint,
    );

    expect(out).toEqual(["d1", "d2", "m1"]);
    expect(recorder.callCount).toBe(1);
  });

  it("retires the surplus key when the duplicate group shrinks", () => {
    const previous = [kh("d1", 2, "Intro"), kh("d2", 2, "Intro"), kh("d3", 2, "Intro")];
    const recorder = createMint();
    const out = coordinateHeadingKeys(previous, [ph(2, "Intro"), ph(2, "Intro")], recorder.mint);

    expect(out).toEqual(["d1", "d2"]);
    expect(out).not.toContain("d3");
    expect(recorder.callCount).toBe(0);
  });
});

describe("coordinateHeadingKeys — M13: the three ways a rename does not pair", () => {
  it("(i) refuses a same-index rename whose level changed", () => {
    const recorder = createMint();
    const out = coordinateHeadingKeys([kh("k1", 2, "Intro")], [ph(3, "Introduction")], recorder.mint);

    expect(out).toEqual(["m1"]);
    expect(out).not.toContain("k1");
    expect(recorder.callCount).toBe(1);
  });

  it("(ii) refuses a next leftover sitting beyond the previous list", () => {
    const recorder = createMint();
    const out = coordinateHeadingKeys(
      [kh("k1", 2, "Intro")],
      [ph(2, "Intro"), ph(2, "Other")],
      recorder.mint,
    );

    expect(out).toEqual(["k1", "m1"]);
    expect(recorder.callCount).toBe(1);
  });

  it("(iii) refuses a previous leftover whose slot was already matched in pass 1", () => {
    const recorder = createMint();
    const out = coordinateHeadingKeys(
      [kh("k1", 2, "Old"), kh("k2", 2, "Keep")],
      [ph(2, "Keep"), ph(2, "Fresh")],
      recorder.mint,
    );

    expect(out).toEqual(["k2", "m1"]);
    expect(out).not.toContain("k1");
    expect(recorder.callCount).toBe(1);
  });
});

describe("coordinateHeadingKeys — M14: degenerate inputs", () => {
  it("handles the four corners of the size partition", () => {
    const empty = createMint();
    expect(coordinateHeadingKeys([], [], empty.mint)).toEqual([]);
    expect(empty.callCount).toBe(0);

    const grown = createMint();
    expect(coordinateHeadingKeys([], [ph(2, "A")], grown.mint)).toEqual(["m1"]);
    expect(grown.callCount).toBe(1);

    const emptied = createMint();
    expect(coordinateHeadingKeys([kh("k1", 2, "A")], [], emptied.mint)).toEqual([]);
    expect(emptied.callCount).toBe(0);

    const kept = createMint();
    expect(coordinateHeadingKeys([kh("k1", 2, "A")], [ph(2, "A")], kept.mint)).toEqual(["k1"]);
    expect(kept.callCount).toBe(0);
  });
});

describe("coordinateHeadingKeys — M15: pass 1 groups by (level, text), not by text alone", () => {
  it("arm A — delete-1 keeps the H3 'Intro' on k4, not on k2", () => {
    const recorder = createMint();
    const out = coordinateHeadingKeys(
      BASE,
      [ph(1, "Guide"), ph(2, "Setup"), ph(3, "Intro")],
      recorder.mint,
    );

    expect(out).toEqual(["k1", "k3", "k4"]);
    expect(recorder.callCount).toBe(0);
  });

  it("arm B — move-1→3 keeps the H3 'Intro' on k4 and moves k2 to the tail", () => {
    const recorder = createMint();
    const out = coordinateHeadingKeys(
      BASE,
      [ph(1, "Guide"), ph(2, "Setup"), ph(3, "Intro"), ph(2, "Intro")],
      recorder.mint,
    );

    expect(out).toEqual(["k1", "k3", "k4", "k2"]);
    expect(recorder.callCount).toBe(0);
  });
});

describe("coordinateHeadingKeys — M16: same-index same-level delete+insert inherits", () => {
  it("hands the deleted heading's key to the heading typed in its slot (documented limitation)", () => {
    const previous = [kh("k1", 2, "A"), kh("k2", 2, "B"), kh("k3", 2, "C")];
    const recorder = createMint();

    const out = coordinateHeadingKeys(
      previous,
      [ph(2, "A"), ph(2, "Brand new"), ph(2, "C")],
      recorder.mint,
    );

    expect(out).toEqual(["k1", "k2", "k3"]);
    expect(recorder.callCount).toBe(0);
  });
});

describe("coordinateHeadingKeys — M17: LAW L7, positional oracle over the whole domain", () => {
  it("matches the provenance-derived key at every position of every script", () => {
    for (const script of SCRIPTS) {
      const { next, expectedKeys } = applyScript(script);
      const recorder = createMint();
      const out = coordinateHeadingKeys(BASE, next, recorder.mint);

      const ctx = `${JSON.stringify(script)} expected=${JSON.stringify(
        expectedKeys,
      )} actual=${JSON.stringify(out)}`;

      expect(out.length, ctx).toBe(expectedKeys.length);
      for (let i = 0; i < expectedKeys.length; i += 1) {
        if (expectedKeys[i] === NEW) {
          expect(BASE_KEYS.has(out[i] as string), `${ctx} at ${i}`).toBe(false);
        } else {
          expect(out[i], `${ctx} at ${i}`).toBe(expectedKeys[i]);
        }
      }
    }
  });
});
