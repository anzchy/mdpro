// @vitest-environment node
/**
 * WI-21 (ADR-0047 fix round): pins for `assertNoPrivateData` user-name matching
 * (WI-8/T19) and the `writeManifest` failure message (WI-8/T20).
 * Matrix: `.claude/tdd-guardian/tests-20261002-201520.md`, units
 * "`assertNoPrivateData` user-name matching (WI-21)" and
 * "`scripts/control/manifest.mjs#writeManifest` failure (WI-21)".
 *
 * Split out of `control-build-manifest-privacy.test.ts`, which these cases
 * would push past the 300-line limit (rule 50 §6). Both are pins (plan O16).
 *
 * Law (T19): a value trips exactly when it holds some occurrence of the user
 * name, case-insensitively, bounded on each side by the string's edge or a
 * character outside `[A-Za-z0-9]`; the name is matched literally.
 *
 * Every path and name here is fake (`/w/r`, `/h/<name>`, users `someone`, `j.doe`, ...).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { ManifestError, assertNoPrivateData, writeManifest } from "../../scripts/control/manifest.mjs";

type Obj = Record<string, unknown>;
type Ctx = { repoRoot: string; homeDir: string; userName: string };

const ctxFor = (name: string): Ctx => ({ repoRoot: "/w/r", homeDir: `/h/${name}`, userName: name });
const CTX = ctxFor("someone");

/** A valid, untainted manifest (hash fields hex, no rooted strings). */
function manifest(): Obj {
  return {
    schemaVersion: 1,
    buildId: "0123456789abcdef".repeat(4),
    sourceTree: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
    sourceTreeExcludes: ["**/*.tsbuildinfo", ".claude/", "docs/"],
    commit: "0123456789abcdef0123456789abcdef01234567",
    profile: "release",
    features: ["a", "b"],
    sidecarSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    distSha256: "fedcba9876543210".repeat(4),
    mainBinarySha256: "0123456789abcdef".repeat(4),
    versions: { tauri: ["2.9.5"], "@tauri-apps/cli": ["2.9.4"] },
    codesign: {
      identifier: "tauri_app-f283913162faab95",
      format: "app bundle with Mach-O thin (arm64)",
      cdhash: "6140cd9271f655c037829fe53d1fc93b80de994e",
      signature: "adhoc",
      teamIdentifier: "not set",
    },
    updaterArtifacts: false,
    bundle: "src-tauri/target/release/bundle/macos/mdpro.app",
  };
}

function caught(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

const withIdentifier = (value: string): Obj => {
  const m = manifest();
  (m.codesign as Obj).identifier = value;
  return m;
};

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Asserts `value` in `codesign.identifier` trips: ManifestError, field named, no casing of the name. */
function expectTrips(value: string, ctx: Ctx, label: string): void {
  const e = caught(() => assertNoPrivateData(withIdentifier(value), ctx));
  expect(e, label).toBeInstanceOf(ManifestError);
  const msg = (e as Error).message;
  expect(msg, label).toContain("codesign.identifier");
  expect(msg, label).not.toMatch(new RegExp(escapeRe(ctx.userName), "i"));
}

function expectPasses(value: string, ctx: Ctx, label: string): void {
  expect(caught(() => assertNoPrivateData(withIdentifier(value), ctx)), label).toBeUndefined();
}

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
const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const SEPS = [..."./-_ @"];
const ALNUM = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"];
const flipCase = (r: Rng, s: string): string =>
  [...s].map((c) => (r() < 0.5 ? (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()) : c)).join("");

describe("WI-8/T19: user-name matching is case-insensitive and whole-token", () => {
  it("WI-8/T19 examples with user someone", () => {
    for (const v of ["com.SomeOne.app", "x/SOMEONE/y", "someone_x"]) expectTrips(v, CTX, `throws: ${v}`);
    for (const v of ["SOMEONEelse", "xsomeone", "someone2"]) expectPasses(v, CTX, `passes: ${v}`);
  });

  it("WI-8/T19 user names containing '.', '-' and '_' are matched literally (rows n1..n9)", () => {
    const rows: [string, string, string, boolean][] = [
      ["n1", "j.doe", "com.j.doe.app", true],
      ["n2", "j.doe", "com.J.DOE.app", true],
      ["n3", "j.doe", "com.jxdoe.app", false],
      ["n4", "j.doe", "x/j-doe/y", false],
      ["n5", "j.doe", "xj.doe", false],
      ["n6", "j_doe", "x/j_doe/y", true],
      ["n7", "j-doe", "x.j-doe.y", true],
      ["n8", "j-doe", "j-doex", false],
      ["n9", "J.Doe", "com.j.doe.app", true],
    ];
    for (const [id, name, value, trips] of rows) {
      const ctx = ctxFor(name);
      expect(caught(() => assertNoPrivateData(manifest(), ctx)), `${id} control: untainted`).toBeUndefined();
      if (trips) expectTrips(value, ctx, `${id} ${name} ${value}`);
      else expectPasses(value, ctx, `${id} ${name} ${value}`);
    }
  });

  it("WI-8/T19 a later bounded occurrence trips (rows o1..o3)", () => {
    expectTrips("xsomeone.someone", CTX, "o1");
    expectTrips("someone2/someone", CTX, "o2");
    expectPasses("xsomeone.ysomeone", CTX, "o3 (control)");
  });

  it("WI-8/T19 property (a): seed 819, 100 trials, separated trips and glued never does", () => {
    const r = mulberry32(819);
    for (let t = 0; t < 100; t++) {
      const cased = flipCase(r, "someone");
      const sep = "x" + pick(r, SEPS) + cased + pick(r, SEPS) + "y";
      const glued = pick(r, ALNUM) + cased + pick(r, ALNUM);
      const e = caught(() => assertNoPrivateData(withIdentifier(sep), CTX));
      const label = `seed 819 trial ${t} value ${JSON.stringify(sep)}`;
      expect(e, label).toBeInstanceOf(ManifestError);
      expect((e as Error).message, label).toContain("codesign.identifier");
      expect((e as Error).message, label).not.toMatch(/someone/i);
      expectPasses(glued, CTX, `seed 819 trial ${t} value ${JSON.stringify(glued)}`);
    }
  });

  it("WI-8/T19 property (b): seed 8190, 120 trials over four names, incl. a second occurrence", () => {
    const r = mulberry32(8190);
    const NAMES = ["someone", "j.doe", "j_doe", "j-doe"] as const;
    const drawn = new Map<string, number>(NAMES.map((n) => [n, 0]));
    for (let t = 0; t < 120; t++) {
      const name = pick(r, NAMES);
      drawn.set(name, (drawn.get(name) ?? 0) + 1);
      const ctx = ctxFor(name);
      const cased = flipCase(r, name);
      const sep = "x" + pick(r, SEPS) + cased + pick(r, SEPS) + "y";
      const glued = pick(r, ALNUM) + cased + pick(r, ALNUM);
      const twice = pick(r, ALNUM) + cased + pick(r, SEPS) + cased;
      const at = (v: string) => `seed 8190 trial ${t} name ${name} value ${JSON.stringify(v)}`;
      expectTrips(sep, ctx, at(sep));
      expectPasses(glued, ctx, at(glued));
      expectTrips(twice, ctx, at(twice));
    }
    for (const n of NAMES) expect(drawn.get(n), `name ${n} drawn`).toBeGreaterThanOrEqual(15);
  });
});

// ---------------------------------------------------------------------------
// WI-8/T20: writeManifest failure carries the error code, not the directory
// ---------------------------------------------------------------------------
const made: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "wm-"));
  made.push(d);
  return d;
}
afterEach(() => {
  for (const d of made.splice(0)) {
    fs.chmodSync(d, 0o755);
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("WI-8/T20: a failed writeManifest names the error code, not the directory", () => {
  it("WI-8/T20 a missing directory gives ENOENT without the directory", () => {
    const dir = path.join(tmp(), "nope");
    const e = caught(() => writeManifest(dir, manifest()));
    expect(e).toBeInstanceOf(ManifestError);
    const msg = (e as Error).message;
    expect(msg).toBe("writeManifest: cannot write build-manifest.json (ENOENT)");
    expect(msg).toContain("ENOENT");
    expect(msg).not.toContain(dir);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it.skipIf(process.getuid?.() === 0)("WI-8/T20 a read-only directory gives EACCES without the directory", () => {
    const ro = tmp();
    fs.chmodSync(ro, 0o555);
    try {
      const e = caught(() => writeManifest(ro, manifest()));
      expect(e).toBeInstanceOf(ManifestError);
      const msg = (e as Error).message;
      expect(msg).toContain("EACCES");
      expect(msg).not.toContain(ro);
      expect(fs.readdirSync(ro)).toEqual([]);
    } finally {
      fs.chmodSync(ro, 0o755);
    }
  });
});
