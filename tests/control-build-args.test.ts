// @vitest-environment node
/**
 * WI-9 (ADR-0047): `parseBuildArgs` — the `pnpm control:build` argument parser.
 * Matrix: `.claude/tdd-guardian/tests-20261002-155158.md`, unit WI-9, T01..T08,
 * with the round-2 decision O9 (help, `=` forms, repeated `--profile`, shared
 * feature predicate). WI-19 adds T09 (matrix `tests-20261002-201520.md`): a
 * feature name may not start with `-`.
 */
import { describe, expect, it } from "vitest";
import {
  BuildArgsError,
  parseBuildArgs,
  USAGE,
  // @ts-expect-error -- plain ESM script, no .d.ts by design
} from "../scripts/control/args.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { computeBuildId } from "../scripts/control/buildId.mjs";

const parse = (argv: string[]): unknown => parseBuildArgs(argv);

const BASE = {
  sourceTree: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
  sourceTreeExcludes: [".claude/", "docs/", "**/*.tsbuildinfo"],
  profile: "release",
  features: [] as string[],
  sidecarSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
};

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

function shuffle<T>(r: Rng, xs: readonly T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = int(r, 0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const FEATURE_ALPHA = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-";
// WI-19 (C4): a feature name may not start with `-`, so the first character
// comes from the alphabet without it.
const FEATURE_HEAD = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_";
// A feature spelled exactly like a help token would ask for help instead (O9).
const HELP_TOKENS = ["-h", "--help"];

function genFeatureSet(r: Rng): string[] {
  const set = new Set<string>();
  const n = int(r, 0, 5);
  while (set.size < n) {
    const f = pick(r, [...FEATURE_HEAD]) + str(r, FEATURE_ALPHA, 0, 7);
    if (!HELP_TOKENS.includes(f)) set.add(f);
  }
  return [...set];
}

/** Split `items` into `n` non-empty contiguous chunks. */
function chunk<T>(r: Rng, items: readonly T[], n: number): T[][] {
  const cuts = shuffle(
    r,
    Array.from({ length: items.length - 1 }, (_, i) => i + 1),
  )
    .slice(0, n - 1)
    .sort((x, y) => x - y);
  const bounds = [0, ...cuts, items.length];
  return bounds.slice(0, -1).map((b, i) => items.slice(b, bounds[i + 1]));
}

function caught(argv: string[]): unknown {
  try {
    parse(argv);
  } catch (err) {
    return err;
  }
  return undefined;
}

// ---------------------------------------------------------------------------

describe("parseBuildArgs (WI-9)", () => {
  it("WI-9/T01 empty argv gives the release profile with no features", () => {
    expect(parse([])).toEqual({ profile: "release", features: [] });
  });

  it("WI-9/T02 profile plus repeated features gives sorted, de-duplicated features", () => {
    expect(parse(["--profile", "verify", "--features", "b,a", "--features", "b"])).toEqual({
      profile: "verify",
      features: ["a", "b"],
    });
  });

  it("WI-9/T03 a leading pnpm separator is tolerated", () => {
    expect(parse(["--", "--profile", "verify"])).toEqual({ profile: "verify", features: [] });
    expect(parse(["--"])).toEqual({ profile: "release", features: [] });
  });

  it("WI-9/T04 canonical form under group order, repetition, flag order and spelling (seed 20261009)", () => {
    const r = mulberry32(20261009);
    let checked = 0;
    for (let trial = 0; trial < 200; trial++) {
      const set = genFeatureSet(r);
      const multiset = [...set];
      const dupes = set.length === 0 ? 0 : int(r, 0, 3);
      for (let d = 0; d < dupes; d++) multiset.push(pick(r, set));
      const items = shuffle(r, multiset);
      const groupCount = items.length === 0 ? 0 : Math.min(int(r, 1, 3), items.length);
      const groups = groupCount === 0 ? [] : chunk(r, items, groupCount);

      const flags: string[][] = groups.map((g) => {
        const joined = g.join(",");
        return r() < 0.5 ? ["--features", joined] : [`--features=${joined}`];
      });
      const profile = r() < 0.5 ? "release" : "verify";
      const profileFlag = r() < 0.5 ? ["--profile", profile] : [`--profile=${profile}`];
      flags.splice(int(r, 0, flags.length), 0, profileFlag);

      const argv = [...(r() < 0.5 ? ["--"] : []), ...flags.flat()];
      expect(parse(argv), `seed 20261009 trial ${trial} argv ${JSON.stringify(argv)}`).toEqual({
        profile,
        features: [...set].sort(),
      });
      checked++;
    }
    expect(checked).toBe(200);
  });

  describe("WI-9/T05 guard table: the error names the offending token and carries the usage", () => {
    const rows: [string[], string][] = [
      [["--profile"], "--profile"],
      [["--profile", "--features", "a"], "--profile"],
      [["--profile", "debug"], "debug"],
      [["--profile="], "--profile"],
      [["--feature", "x"], "--feature"],
      [["--features", ""], "--features"],
      [["--features", "a b"], "a b"],
      [["--features", "a,,b"], "--features"],
      [["--features", "a,"], "--features"],
      [["-p", "verify"], "-p"],
      [["verify"], "verify"],
      [["--profile", "release", "--profile", "verify"], "--profile"],
      [["--profile=release", "--profile", "verify"], "--profile"],
    ];

    it.each(rows.map(([argv, token], i) => [i, JSON.stringify(argv), argv, token] as const))(
      "WI-9/T05 row %i: %s is rejected",
      (_i, _label, argv, token) => {
        const err = caught([...argv]);
        expect(err).toBeInstanceOf(BuildArgsError);
        expect((err as Error).name).toBe("BuildArgsError");
        expect((err as Error).message).toContain(token);
        expect((err as Error).message).toContain("Usage");
      },
    );
  });

  it("WI-9/T06 feature validity agrees with computeBuildId (seed 20261010)", () => {
    const r = mulberry32(20261010);
    const alphabet = "abcXYZ019_-./ é@";
    let rejected = 0;
    let accepted = 0;
    for (let i = 0; i < 100; i++) {
      const f = str(r, alphabet, 1, 6);
      const parseThrows = caught(["--features", f]) !== undefined;
      let idThrows = false;
      try {
        computeBuildId({ ...BASE, features: [f] });
      } catch {
        idThrows = true;
      }
      expect(parseThrows, `seed 20261010 iteration ${i} feature ${JSON.stringify(f)}`).toBe(idThrows);
      if (idThrows) rejected++;
      else accepted++;
    }
    expect(rejected).toBeGreaterThan(0);
    expect(accepted).toBeGreaterThan(0);
  });

  it("WI-9/T07 help returns exactly { help: true } and validates nothing else", () => {
    const cases = [
      ["--help"],
      ["-h"],
      ["--profile", "verify", "--help"],
      ["--profile", "debug", "--help"],
      ["--bogus", "-h"],
    ];
    for (const argv of cases) {
      expect(caught(argv), JSON.stringify(argv)).toBeUndefined();
      expect(parse(argv), JSON.stringify(argv)).toEqual({ help: true });
    }
  });

  it("WI-9/T08 the = spellings are accepted", () => {
    expect(parse(["--profile=verify"])).toEqual({ profile: "verify", features: [] });
    expect(parse(["--features=b,a"])).toEqual({ profile: "release", features: ["a", "b"] });
    expect(parse(["--features=b", "--features", "a", "--profile=release"])).toEqual({
      profile: "release",
      features: ["a", "b"],
    });
  });

  describe("WI-9/T09 a feature with a leading - is rejected, naming the token", () => {
    const rows: [string[], string][] = [
      [["--features", "-x"], "-x"],
      [["--features", "--x"], "--x"],
      [["--features=-x"], "-x"],
      [["--features", "a,-b"], "-b"],
    ];

    it.each(rows.map(([argv, token], i) => [i + 1, JSON.stringify(argv), argv, token] as const))(
      "WI-9/T09 row %i: %s is rejected",
      (_i, _label, argv, token) => {
        const e = caught([...argv]);
        expect(e).toBeInstanceOf(BuildArgsError);
        expect((e as Error).message).toContain(`"${token}"`);
        expect((e as Error).message).toContain("Usage: pnpm control:build");
      },
    );

    it("WI-9/T09 row 5: a - after the first character stays valid", () => {
      expect(parse(["--features", "x-,_x,a-b"])).toEqual({ profile: "release", features: ["_x", "a-b", "x-"] });
    });
  });

  // Added beyond the matrix: the entry prints USAGE for --help (WI-10/WI-11).
  it("WI-9/X01 the usage text names the command, both profiles and the features flag", () => {
    expect(typeof USAGE).toBe("string");
    for (const part of ["Usage", "pnpm control:build", "--profile", "release", "verify", "--features", "--help"]) {
      expect(USAGE).toContain(part);
    }
  });
});
