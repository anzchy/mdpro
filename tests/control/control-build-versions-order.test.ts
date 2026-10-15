// @vitest-environment node
/**
 * WI-21 (ADR-0047 fix round): the versions sort is a total order (WI-7/T10).
 * Matrix: `.claude/tdd-guardian/tests-20261002-201520.md`, unit
 * "`scripts/control/versions.mjs` sort, `collectVersions`, `readNodeModuleVersion` (WI-21)".
 *
 * Split out of `control-build-versions.test.ts`, which this case would push
 * past the 300-line limit (rule 50 §6). A pin (plan O16).
 *
 * Law: `cargoLockVersions(text, ["tauri"]).tauri` is a function of the multiset
 * of locked versions, duplicate-free, ordered semver-before-non-semver, semver by
 * numeric core then pre-release-before-release, and re-sorting it is the identity.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { cargoLockVersions } from "../../scripts/control/versions.mjs";

/** Seeded generator (mulberry32). No fast-check by design (plan Deferred). */
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
const int = (r: Rng, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const chars = (r: Rng, alphabet: string, lo: number, hi: number): string =>
  Array.from({ length: int(r, lo, hi) }, () => pick(r, [...alphabet])).join("");

const DIGITS = "0123456789";
const NON_SEMVER = ["1.2", "1.2.3.4", "v1.0.0", "abc"] as const;

/** One core part: `0`, 1-3 digits, a leading-zero form, or a 20-digit number. */
function part(r: Rng): string {
  switch (int(r, 0, 3)) {
    case 0:
      return "0";
    case 1:
      return chars(r, DIGITS, 1, 3);
    case 2:
      return "0" + chars(r, DIGITS, 1, 2);
    default:
      return pick(r, [..."123456789"]) + chars(r, DIGITS, 19, 19);
  }
}

function semver(r: Rng): string {
  let v = `${part(r)}.${part(r)}.${part(r)}`;
  if (r() < 0.4) v += "-" + chars(r, "abcdefghijklmnopqrstuvwxyz0123456789.", 1, 4);
  if (r() < 0.2) v += "+" + chars(r, "abcdefghijklmnopqrstuvwxyz0123456789", 1, 3);
  return v;
}

// The spec's grammar, restated in the test (not imported).
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([^+]*))?(?:\+.*)?$/;
const lt = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Oracle: semver before non-semver; BigInt core; pre-release before release; then `<`. */
function cmp(a: string, b: string): number {
  const ma = SEMVER.exec(a);
  const mb = SEMVER.exec(b);
  if (!ma && !mb) return lt(a, b);
  if (!ma) return 1;
  if (!mb) return -1;
  for (let i = 1; i <= 3; i++) {
    const x = BigInt(ma[i]);
    const y = BigInt(mb[i]);
    if (x !== y) return x < y ? -1 : 1;
  }
  const pa = ma[4];
  const pb = mb[4];
  if (pa !== undefined && pb === undefined) return -1;
  if (pa === undefined && pb !== undefined) return 1;
  if (pa !== undefined && pb !== undefined && pa !== pb) return lt(pa, pb);
  return lt(a, b);
}

const coreOf = (v: string): string | null => {
  const m = SEMVER.exec(v);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
};

/**
 * 2-12 versions, repeats allowed. Beyond the matrix's weights, a draw may reuse
 * an earlier semver core with the pre-release toggled, so that "a pre-release
 * paired with its own plain release" occurs often enough to be exercised.
 */
function multiset(r: Rng): string[] {
  const out: string[] = [];
  const n = int(r, 2, 12);
  for (let i = 0; i < n; i++) {
    const prior = out.filter((v) => SEMVER.test(v));
    if (prior.length > 0 && r() < 0.25) {
      const base = pick(r, prior);
      const core = coreOf(base) as string;
      out.push(base.includes("-") ? core : `${core}-${chars(r, "abcdefghijklmnopqrstuvwxyz0123456789.", 1, 4)}`);
    } else if (prior.length > 0 && r() < 0.1) {
      out.push(pick(r, out));
    } else {
      out.push(r() < 0.7 ? semver(r) : pick(r, NON_SEMVER));
    }
  }
  return out;
}

const lockText = (versions: string[]): string =>
  versions.map((v) => `[[package]]\nname = "tauri"\nversion = "${v}"\n`).join("\n");

function shuffled<T>(r: Rng, xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = int(r, 0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const sortedOf = (versions: string[]): string[] => cargoLockVersions(lockText(versions), ["tauri"]).tauri;

describe("WI-7/T10: the versions order is total and input-order independent", () => {
  it("WI-7/T10 seed 710, 200 trials: three orders agree, duplicate-free, partitioned, strictly increasing", () => {
    const r = mulberry32(710);
    let twoNonSemver = 0;
    let wideOrZeroPart = 0;
    let preWithRelease = 0;
    for (let t = 0; t < 200; t++) {
      const ms = multiset(r);
      const label = `seed 710 trial ${t} versions ${JSON.stringify(ms)}`;
      const outA = sortedOf(ms);
      const outB = sortedOf(shuffled(r, ms));
      const outC = sortedOf(outA);

      expect(outA, label).toEqual(outB);
      expect(outA, label).toEqual(outC);
      expect(new Set(outA).size, label).toBe(outA.length);
      expect(new Set(outA), label).toEqual(new Set(ms));
      const firstNon = outA.findIndex((v) => !SEMVER.test(v));
      if (firstNon >= 0) {
        expect(outA.slice(firstNon).every((v) => !SEMVER.test(v)), label).toBe(true);
      }
      for (let i = 0; i + 1 < outA.length; i++) {
        expect(cmp(outA[i], outA[i + 1]), `${label} at ${i}: ${outA[i]} vs ${outA[i + 1]}`).toBeLessThan(0);
      }

      const distinct = [...new Set(ms)];
      if (distinct.filter((v) => !SEMVER.test(v)).length >= 2) twoNonSemver++;
      if (
        distinct.some((v) => {
          const m = SEMVER.exec(v);
          return m !== null && [m[1], m[2], m[3]].some((p) => p.length === 20 || /^0\d/.test(p));
        })
      ) {
        wideOrZeroPart++;
      }
      const releases = new Set(distinct.filter((v) => SEMVER.test(v) && SEMVER.exec(v)?.[4] === undefined));
      if (distinct.some((v) => SEMVER.exec(v)?.[4] !== undefined && releases.has(coreOf(v) as string))) {
        preWithRelease++;
      }
    }
    expect(twoNonSemver, "trials with 2+ distinct non-semver versions").toBeGreaterThanOrEqual(50);
    expect(wideOrZeroPart, "trials with a leading-zero or 20-digit part").toBeGreaterThanOrEqual(50);
    expect(preWithRelease, "trials with a pre-release and its own plain release").toBeGreaterThanOrEqual(50);
  });
});
