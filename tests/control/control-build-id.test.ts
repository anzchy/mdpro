// @vitest-environment node
/**
 * WI-3 (ADR-0047): `computeBuildId` — the pure digest over the build inputs.
 * Matrix: `.claude/tdd-guardian/tests-20261002-155158.md`, unit WI-3, T01..T10.
 *
 * Golden values were computed outside the module, by hand-writing the O4
 * canonical tuple and hashing it with `printf '%s' "$CANON" | shasum -a 256`.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BuildIdInputError,
  computeBuildId,
  isValidFeatureName,
  // @ts-expect-error -- plain ESM script, no .d.ts by design
} from "../../scripts/control/buildId.mjs";

type Input = {
  sourceTree: unknown;
  sourceTreeExcludes: unknown;
  profile: unknown;
  features: unknown;
  sidecarSha256: unknown;
};

const HEX64 = /^[0-9a-f]{64}$/;
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const EMPTY_SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const BASE = {
  sourceTree: EMPTY_TREE,
  sourceTreeExcludes: [".claude/", "docs/", "**/*.tsbuildinfo"],
  profile: "release",
  features: [] as string[],
  sidecarSha256: EMPTY_SHA,
};

const CANON_1 =
  '["mdpro-build-id/1","4b825dc642cb6eb9a060e54bf8d69288fbee4904",["**/*.tsbuildinfo",".claude/","docs/"],"release",[],"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"]';
const GOLDEN_1 = "0321b0ca736453d77c5571efaf681656ca91d3ee93131b26de76bd3bfaf91304";

const CANON_2 =
  '["mdpro-build-id/1","4b825dc642cb6eb9a060e54bf8d69288fbee4904",["**/*.tsbuildinfo",".claude/","docs/"],"verify",["a","b"],"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"]';
const GOLDEN_2 = "23e1179266415faf646761e23235eaf9cf377f7782fb4677a06f1b0d8c3f18ea";

const CANON_3 =
  '["mdpro-build-id/1","4b825dc642cb6eb9a060e54bf8d69288fbee4904",["Docs/","_gen/","docs/"],"release",["B","_x","a","b-c"],"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"]';
const GOLDEN_3 = "ed8961d94f735096ce3915577bae6a4b1e7326cbcb149fff30f431061c49614d";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const id = (x: Input): string => computeBuildId(x);

// ---------------------------------------------------------------------------
// Seeded generator (mulberry32). No fast-check by design (plan Deferred).
// ---------------------------------------------------------------------------
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
type Rng = () => number;
const int = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const pick = <T>(r: Rng, xs: readonly T[]): T => xs[int(r, 0, xs.length - 1)];
const str = (r: Rng, alphabet: string, lo: number, hi: number) =>
  Array.from({ length: int(r, lo, hi) }, () => pick(r, [...alphabet])).join("");

const HEX = "0123456789abcdef";
const FEATURE_ALPHA = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-";
// WI-19 (C4): a feature name may not start with `-`; draw the first character without it.
const FEATURE_HEAD = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_";
const genFeature = (r: Rng) => pick(r, [...FEATURE_HEAD]) + str(r, FEATURE_ALPHA, 0, 7);
const EXCLUDE_ALPHA = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ/*., \n"';

const isLegalExclude = (e: string) =>
  e.length > 0 && !e.startsWith("/") && !e.split("/").includes("..");

function genExclude(r: Rng): string {
  for (;;) {
    const e = str(r, EXCLUDE_ALPHA, 1, 10);
    if (isLegalExclude(e)) return e;
  }
}

function genValid(r: Rng, nf: [number, number] = [0, 5], ne: [number, number] = [0, 4]) {
  return {
    // @ts-expect-error -- TS2556: tsc cannot spread a union of 2-tuples into fixed params; runtime is exact
    sourceTree: str(r, HEX, ...(r() < 0.5 ? ([40, 40] as const) : ([64, 64] as const))),
    sourceTreeExcludes: Array.from({ length: int(r, ...ne) }, () => genExclude(r)),
    profile: r() < 0.5 ? "release" : "verify",
    features: Array.from({ length: int(r, ...nf) }, () => genFeature(r)),
    sidecarSha256: str(r, HEX, 64, 64),
  };
}

function shuffle<T>(r: Rng, xs: readonly T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = int(r, 0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function withDupes<T>(r: Rng, xs: readonly T[]): T[] {
  const out = [...xs];
  const n = int(r, 0, 3);
  for (let i = 0; i < n && xs.length > 0; i++) out.splice(int(r, 0, out.length), 0, pick(r, xs));
  return out;
}

const flipNibble = (h: string, i: number) =>
  h.slice(0, i) + HEX[(HEX.indexOf(h[i]) + 1) % 16] + h.slice(i + 1);

type Valid = ReturnType<typeof genValid>;
const KINDS = ["tree", "profile", "addFeature", "removeFeature", "sidecar", "addExclude", "removeExclude"] as const;

function mutate(r: Rng, b: Valid, kind: (typeof KINDS)[number]): Valid {
  switch (kind) {
    case "tree":
      return { ...b, sourceTree: flipNibble(b.sourceTree, int(r, 0, b.sourceTree.length - 1)) };
    case "profile":
      return { ...b, profile: b.profile === "release" ? "verify" : "release" };
    case "addFeature": {
      let f: string;
      do f = genFeature(r);
      while (b.features.includes(f));
      return { ...b, features: [...b.features, f] };
    }
    case "removeFeature": {
      if (b.features.length === 0) return mutate(r, b, "addFeature");
      const gone = pick(r, b.features);
      return { ...b, features: b.features.filter((f) => f !== gone) };
    }
    case "sidecar":
      return { ...b, sidecarSha256: flipNibble(b.sidecarSha256, int(r, 0, 63)) };
    case "addExclude": {
      let e: string;
      do e = genExclude(r);
      while (b.sourceTreeExcludes.includes(e));
      return { ...b, sourceTreeExcludes: [...b.sourceTreeExcludes, e] };
    }
    case "removeExclude": {
      if (b.sourceTreeExcludes.length === 0) return mutate(r, b, "addExclude");
      const gone = pick(r, b.sourceTreeExcludes);
      return { ...b, sourceTreeExcludes: b.sourceTreeExcludes.filter((e) => e !== gone) };
    }
  }
}

// ---------------------------------------------------------------------------

describe("computeBuildId (WI-3)", () => {
  it("WI-3/T01 golden value for BASE", () => {
    expect(sha(CANON_1)).toBe(GOLDEN_1);
    expect(id(BASE)).toBe(GOLDEN_1);
  });

  it("WI-3/T02 second golden value proves canonicalisation precedes hashing", () => {
    expect(sha(CANON_2)).toBe(GOLDEN_2);
    const input = {
      ...BASE,
      profile: "verify",
      features: ["b", "a", "a"],
      sourceTreeExcludes: ["docs/", ".claude/", "docs/", "**/*.tsbuildinfo"],
    };
    expect(id(input)).toBe(GOLDEN_2);
  });

  it("WI-3/T03 determinism and no mutation of caller input", () => {
    const input = { ...BASE, features: ["z", "a", "a"], sourceTreeExcludes: ["docs/", ".claude/"] };
    const before = structuredClone(input);
    const results = Array.from({ length: 100 }, () => id(input));
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toMatch(HEX64);
    expect(input).toStrictEqual(before);
  });

  it("WI-3/T04 output predicate over generated valid inputs (seed 20261002)", () => {
    const r = mulberry32(20261002);
    const ids = Array.from({ length: 300 }, () => {
      const out = id(genValid(r));
      expect(out, "seed 20261002").toMatch(HEX64);
      return out;
    });
    expect(new Set(ids).size, "seed 20261002").toBe(300);
  });

  it("WI-3/T05 permutation and duplication invariance (seed 20261003)", () => {
    const r = mulberry32(20261003);
    let checked = 0;
    for (let b = 0; b < 20; b++) {
      const base = genValid(r, [3, 5], [2, 4]);
      const expected = id(base);
      expect(expected).toMatch(HEX64);
      for (let v = 0; v < 10; v++) {
        const variant = {
          ...base,
          features: withDupes(r, shuffle(r, base.features)),
          sourceTreeExcludes: withDupes(r, shuffle(r, base.sourceTreeExcludes)),
        };
        expect(id(variant), `seed 20261003 base ${b} variant ${v}`).toBe(expected);
        checked++;
      }
    }
    expect(checked).toBe(200);
  });

  it("WI-3/T06 single-field sensitivity (metamorphic, seed 20261004)", () => {
    const base = { ...BASE, features: ["default"] };
    const mutants = [
      { ...base, sourceTree: EMPTY_TREE.slice(0, -1) + "5" },
      { ...base, profile: "verify" },
      { ...base, features: ["default", "x"] },
      { ...base, features: [] },
      { ...base, sidecarSha256: "f" + EMPTY_SHA.slice(1) },
      { ...base, sourceTreeExcludes: [...base.sourceTreeExcludes, "tests/"] },
      { ...base, sourceTreeExcludes: base.sourceTreeExcludes.filter((e) => e !== "docs/") },
    ];
    const ids = [base, ...mutants].map(id);
    expect(new Set(ids).size).toBe(8);

    const r = mulberry32(20261004);
    for (let i = 0; i < 100; i++) {
      const b = genValid(r);
      const kind = pick(r, KINDS);
      const m = mutate(r, b, kind);
      expect(id(m), `seed 20261004 iteration ${i} kind ${kind}`).not.toBe(id(b));
    }
  });

  it("WI-3/T07 separator characters cannot alias inputs", () => {
    expect(() => id({ ...BASE, features: ["a,b"] })).toThrow(/features/);

    const pairs: [string[], string[]][] = [
      [["a,b"], ["a", "b"]],
      [["x\ny"], ["x", "y"]],
      [['a","b'], ["a", "b"]],
    ];
    const byKey = new Map<string, string>();
    for (const [left, right] of pairs) {
      let l = "";
      let rr = "";
      expect(() => (l = id({ ...BASE, sourceTreeExcludes: left }))).not.toThrow();
      expect(() => (rr = id({ ...BASE, sourceTreeExcludes: right }))).not.toThrow();
      expect(l).toMatch(HEX64);
      expect(l).not.toBe(rr);
      byKey.set(JSON.stringify(left), l);
      byKey.set(JSON.stringify(right), rr);
    }
    // ["a","b"] appears in two pairs, so the six inputs are five distinct ones.
    expect(byKey.size).toBe(5);
    expect(new Set(byKey.values()).size).toBe(5);
  });

  describe("WI-3/T08 guard table: every invalid field throws BuildIdInputError naming the field", () => {
    const hex = (n: number) => "a".repeat(n);
    const rows: [string, RegExp, unknown][] = [
      ["profile", /profile/, "debug"],
      ["profile", /profile/, ""],
      ["profile", /profile/, "Release"],
      ["profile", /profile/, undefined],
      ["features", /features/, ["a,b"]],
      ["features", /features/, ["a b"]],
      ["features", /features/, [""]],
      ["features", /features/, ["a/b"]],
      ["features", /features/, ["é"]],
      ["features", /features/, "a"],
      ["features", /features/, undefined],
      ["sourceTree", /sourceTree(?!Excludes)/, hex(39)],
      ["sourceTree", /sourceTree(?!Excludes)/, hex(41)],
      ["sourceTree", /sourceTree(?!Excludes)/, hex(63)],
      ["sourceTree", /sourceTree(?!Excludes)/, hex(65)],
      ["sourceTree", /sourceTree(?!Excludes)/, hex(39) + "z"],
      ["sourceTree", /sourceTree(?!Excludes)/, EMPTY_TREE.toUpperCase()],
      ["sourceTree", /sourceTree(?!Excludes)/, undefined],
      ["sidecarSha256", /sidecarSha256/, EMPTY_SHA.toUpperCase()],
      ["sidecarSha256", /sidecarSha256/, hex(63)],
      ["sidecarSha256", /sidecarSha256/, hex(63) + "g"],
      ["sidecarSha256", /sidecarSha256/, undefined],
      ["sourceTreeExcludes", /sourceTreeExcludes/, ["/abs"]],
      ["sourceTreeExcludes", /sourceTreeExcludes/, ["../x"]],
      ["sourceTreeExcludes", /sourceTreeExcludes/, ["a/../b"]],
      ["sourceTreeExcludes", /sourceTreeExcludes/, [".."]],
      ["sourceTreeExcludes", /sourceTreeExcludes/, [""]],
      ["sourceTreeExcludes", /sourceTreeExcludes/, ["a\u0000b"]],
      ["sourceTreeExcludes", /sourceTreeExcludes/, "docs/"],
    ];

    it.each(rows.map((row, i) => [i, ...row] as const))(
      "WI-3/T08 row %i: %s = %j",
      (_i, field, pattern, value) => {
        const input = { ...BASE, [field]: value };
        let caught: unknown;
        try {
          id(input);
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(BuildIdInputError);
        expect((caught as Error).name).toBe("BuildIdInputError");
        expect((caught as Error).message).toMatch(pattern);
      },
    );
  });

  it("WI-3/T09 boundaries of the valid partitions", () => {
    const pairs: [Input, Input][] = [
      [{ ...BASE, features: [] }, { ...BASE, features: ["default"] }],
      [BASE, { ...BASE, sourceTree: EMPTY_SHA }],
      [{ ...BASE, sourceTreeExcludes: [] }, BASE],
    ];
    for (const [a, b] of pairs) {
      const ia = id(a);
      const ib = id(b);
      expect(ia).toMatch(HEX64);
      expect(ib).toMatch(HEX64);
      expect(ia).not.toBe(ib);
    }
  });

  it("WI-3/T10 third golden value pins code-unit sort order, not locale order", () => {
    expect(sha(CANON_3)).toBe(GOLDEN_3);
    const input = {
      ...BASE,
      features: ["a", "B", "_x", "b-c"],
      sourceTreeExcludes: ["docs/", "Docs/", "_gen/"],
    };
    expect(id(input)).toBe(GOLDEN_3);
  });

  // Added beyond the matrix: O9 makes the feature predicate a public export
  // that the arg parser will import, so its partition is pinned here.
  it("WI-3/X01 isValidFeatureName is the predicate computeBuildId enforces", () => {
    for (const ok of ["default", "verify-run", "A_b-9", "x"]) expect(isValidFeatureName(ok)).toBe(true);
    for (const bad of ["", "a,b", "a b", "a/b", "é", "a\n", 1, undefined]) {
      expect(isValidFeatureName(bad)).toBe(false);
    }
  });
});
