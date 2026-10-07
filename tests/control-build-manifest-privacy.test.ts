// @vitest-environment node
/**
 * WI-20 (ADR-0047): `assertNoPrivateData` after it moves to
 * `scripts/control/manifestPrivacy.mjs`, and its field-naming error text.
 * Matrix: `.claude/tdd-guardian/tests-20261002-201520.md`, unit
 * `manifestPrivacy.mjs#assertNoPrivateData` (WI-8/T16, T17, T18).
 *
 * Import rule (matrix): `manifest.mjs` is imported statically; the privacy
 * module is imported dynamically inside T16 and T17 only, so a missing module
 * fails those two cases and never the property pin (T18).
 *
 * Every path and name here is fake (`/w/r`, `/h/someone`, user `someone`).
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { computeBuildId } from "../scripts/control/buildId.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import * as M from "../scripts/control/manifest.mjs";

type Obj = Record<string, unknown>;
type Path = (string | number)[];
type Ctx = { repoRoot: string; homeDir: string; userName: string };
type PrivacyModule = {
  assertNoPrivateData: (m: unknown, ctx: Ctx) => void;
  ManifestError?: unknown;
};

const CTX: Ctx = { repoRoot: "/w/r", homeDir: "/h/someone", userName: "someone" };
const V1 = "0123456789abcdef".repeat(4);
const V2 = "fedcba9876543210".repeat(4);
const TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const SIDECAR = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const BUNDLE_REL = "src-tauri/target/release/bundle/macos/mdpro.app";
const EXCLUDES = ["**/*.tsbuildinfo", ".claude/", "docs/"];
const FEATURES = ["a", "b"];

/** WI-6's `REAL` codesign value (captured from a real ad-hoc bundle). */
const REAL = {
  identifier: "tauri_app-f283913162faab95",
  format: "app bundle with Mach-O thin (arm64)",
  cdhash: "6140cd9271f655c037829fe53d1fc93b80de994e",
  signature: "adhoc",
  teamIdentifier: "not set",
};

const VERSIONS: Record<string, string[]> = {
  tauri: ["2.9.5"],
  "tauri-build": ["2.0.0", "2.5.3"],
  wry: ["0.53.5"],
  tao: ["0.34.5"],
  "tauri-plugin-opener": ["2.5.2"],
  "tauri-plugin-single-instance": ["2.3.6"],
  "tauri-plugin-updater": ["2.9.0"],
  "tauri-plugin-process": [],
  "@tauri-apps/api": ["2.9.0"],
  "@tauri-apps/cli": ["2.9.4"],
};

const BUILD_ID: string = computeBuildId({
  sourceTree: TREE,
  sourceTreeExcludes: EXCLUDES,
  profile: "release",
  features: FEATURES,
  sidecarSha256: SIDECAR,
});

/** `expected()` from control-build-manifest.test.ts, with REPO = "/w/r" and two features. */
function manifest(): Obj {
  return {
    schemaVersion: 1,
    buildId: BUILD_ID,
    sourceTree: TREE,
    sourceTreeExcludes: [...EXCLUDES],
    commit: COMMIT,
    profile: "release",
    features: [...FEATURES],
    sidecarSha256: SIDECAR,
    distSha256: V1,
    mainBinarySha256: V2,
    versions: structuredClone(VERSIONS),
    codesign: { ...REAL },
    updaterArtifacts: false,
    bundle: BUNDLE_REL,
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

function setAt(root: Obj, at: Path, value: unknown): Obj {
  let node = root as Record<string | number, unknown>;
  for (const key of at.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
  node[at[at.length - 1]] = value;
  return root;
}

/** Load the privacy module; a load failure is reported as this assertion, not the loader's text. */
async function loadPrivacy(): Promise<PrivacyModule> {
  let mod: unknown;
  let loaded = true;
  try {
    // @ts-expect-error -- plain ESM script, no .d.ts by design
    mod = await import("../scripts/control/manifestPrivacy.mjs");
  } catch {
    loaded = false;
  }
  expect(loaded, "scripts/control/manifestPrivacy.mjs exports the privacy check").toBe(true);
  return mod as PrivacyModule;
}

const tainted = (): Obj => setAt(manifest(), ["codesign", "identifier"], "com.someone.app");

describe("WI-8/T16: both import paths reject identically, one ManifestError class, one function", () => {
  it("WI-8/T16 manifest.mjs and manifestPrivacy.mjs agree on a tainted and an untainted manifest", async () => {
    const P = await loadPrivacy();
    const eM = caught(() => M.assertNoPrivateData(tainted(), CTX));
    const eP = caught(() => P.assertNoPrivateData(tainted(), CTX));
    expect(eM).toBeInstanceOf(M.ManifestError);
    expect(eP).toBeInstanceOf(M.ManifestError);
    expect((eP as Error).message).toBe((eM as Error).message);

    expect(caught(() => M.assertNoPrivateData(manifest(), CTX))).toBeUndefined();
    expect(caught(() => P.assertNoPrivateData(manifest(), CTX))).toBeUndefined();

    if (P.ManifestError !== undefined) expect(P.ManifestError).toBe(M.ManifestError);
    expect(M.assertNoPrivateData).toBe(P.assertNoPrivateData);
  });
});

describe("WI-8/T17: the user-name error names the field and explains the match", () => {
  it("WI-8/T17 codesign.identifier = com.someone.app: field path, case-insensitive whole token, no private data", async () => {
    // manifest.mjs first, so its wording is checked even while the privacy module cannot load.
    const paths: [string, () => Promise<PrivacyModule["assertNoPrivateData"]>][] = [
      ["manifest.mjs", async () => M.assertNoPrivateData],
      ["manifestPrivacy.mjs", async () => (await loadPrivacy()).assertNoPrivateData],
    ];
    for (const [label, load] of paths) {
      const check = await load();
      const e = caught(() => check(tainted(), CTX));
      expect(e, label).toBeInstanceOf(M.ManifestError);
      const msg = (e as Error).message;
      expect(msg.startsWith("assertNoPrivateData: codesign.identifier"), `${label}: ${msg}`).toBe(true);
      expect(msg, label).toContain("case-insensitive");
      expect(msg, label).toContain("whole token");
      expect(msg, label).not.toMatch(/someone/i);
      expect(msg, label).not.toContain("com.someone.app");
      expect(msg, label).not.toContain("/h/");
      expect(msg, label).not.toContain("/w/");
    }
  });
});

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
const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

/** Every path to a string leaf, with array indices. */
function stringLeaves(v: unknown, at: Path = []): Path[] {
  if (typeof v === "string") return [at];
  if (Array.isArray(v)) return v.flatMap((item, i) => stringLeaves(item, [...at, i]));
  if (v !== null && typeof v === "object") {
    return Object.entries(v).flatMap(([k, item]) => stringLeaves(item, [...at, k]));
  }
  return [];
}

/** Oracle for the `keyPath` form: `.key`, `["key"]`, `[i]`; no leading dot at the root. */
function keyPathOf(p: Path): string {
  let out = "";
  for (const k of p) {
    if (typeof k === "number") out += `[${k}]`;
    else if (/^[A-Za-z_$][\w$]*$/.test(k)) out += out === "" ? k : `.${k}`;
    else out += `[${JSON.stringify(k)}]`;
  }
  return out;
}

const HASH_PATHS = new Set([
  "buildId",
  "sourceTree",
  "commit",
  "sidecarSha256",
  "distSha256",
  "mainBinarySha256",
  "codesign.cdhash",
]);
/** Each taint carries the marker `zq`, which no message word contains. */
const TAINTS = ["zq-someone-zq", "/h/someone/zq", "zq/w/r/zq", "/zq/abs", "~/zq", "ZQ"] as const;
const FORCED: Path[] = [["versions", "@tauri-apps/cli", 0], ["features", 1], ["codesign", "identifier"]];

describe("WI-8/T18: every rejection names the tainted leaf's path, never its value", () => {
  it("WI-8/T18 seed 818, 150 trials over string leaves incl. array elements", () => {
    const r = mulberry32(818);
    const leaves = stringLeaves(manifest());
    const hit = new Set<string>();
    for (let t = 0; t < 150; t++) {
      const path = t < FORCED.length ? FORCED[t] : pick(r, leaves);
      const isHash = HASH_PATHS.has(keyPathOf(path));
      let taint: string = pick(r, TAINTS);
      while (!isHash && taint === "ZQ") taint = pick(r, TAINTS);
      const label = `seed 818 trial ${t} path ${JSON.stringify(path)} taint ${taint}`;

      const e = caught(() => M.assertNoPrivateData(setAt(manifest(), path, taint), CTX));
      expect(e !== undefined, label).toBe(true);
      expect(e, label).toBeInstanceOf(M.ManifestError);
      const msg = (e as Error).message;
      expect(msg, label).toContain(keyPathOf(path));
      expect(msg, label).not.toContain(taint);
      hit.add(JSON.stringify(path));
    }
    for (const f of FORCED) expect(hit.has(JSON.stringify(f)), `forced ${JSON.stringify(f)}`).toBe(true);
    expect(hit.size).toBeGreaterThanOrEqual(20);
  });
});
