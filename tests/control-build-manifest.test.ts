// @vitest-environment node
/**
 * WI-8 (ADR-0047): the build manifest — `assembleManifest`, `assertNoPrivateData`
 * and `writeManifest`.
 * Matrix: `.claude/tdd-guardian/tests-20261002-155158.md`, unit WI-8, T01..T15;
 * plan decisions O4 (buildId), O7/O14 (codesign fields), O8 (versions arrays)
 * and O11 (recursively sorted keys, one trailing newline).
 *
 * Fixture paths are neutral (`/Users/someone/dev/mdpro`, user `someone`).
 * `buildId` values come from the real `computeBuildId`, whose own golden cases
 * pin it (WI-3).
 *
 * The `assertNoPrivateData` and `writeManifest` cases start from `expected()`,
 * the literal that T01 pins as `assembleManifest(IN)`, so a defect in one unit
 * fails only that unit's cases.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { computeBuildId } from "../scripts/control/buildId.mjs";
import {
  ManifestError,
  assembleManifest,
  assertNoPrivateData,
  writeManifest,
  // @ts-expect-error -- plain ESM script, no .d.ts by design
} from "../scripts/control/manifest.mjs";

type Obj = Record<string, unknown>;
type Path = (string | number)[];
type IdFields = {
  sourceTree: unknown;
  sourceTreeExcludes: unknown;
  profile: unknown;
  features: unknown;
  sidecarSha256: unknown;
};

const NAME = "build-manifest.json";
const REPO = "/Users/someone/dev/mdpro";
const CTX = { repoRoot: REPO, homeDir: "/Users/someone", userName: "someone" };
const V1 = "0123456789abcdef".repeat(4);
const V2 = "fedcba9876543210".repeat(4);
const TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const SIDECAR = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const BUNDLE_REL = "src-tauri/target/release/bundle/macos/mdpro.app";
const EXCLUDES = ["**/*.tsbuildinfo", ".claude/", "docs/"];

/** WI-6's `REAL` codesign value (captured from a real ad-hoc bundle). */
const REAL = {
  identifier: "tauri_app-f283913162faab95",
  format: "app bundle with Mach-O thin (arm64)",
  cdhash: "6140cd9271f655c037829fe53d1fc93b80de994e",
  signature: "adhoc",
  teamIdentifier: "not set",
};

/** The 10 `versions` keys, array values per O8 (one empty, one with two versions). */
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

const idOf = (x: IdFields): string => computeBuildId(x);
const idFieldsOf = (x: Obj): IdFields => ({
  sourceTree: x.sourceTree,
  sourceTreeExcludes: x.sourceTreeExcludes,
  profile: x.profile,
  features: x.features,
  sidecarSha256: x.sidecarSha256,
});

const ID_FIELDS = {
  sourceTree: TREE,
  sourceTreeExcludes: EXCLUDES,
  profile: "release",
  features: [] as string[],
  sidecarSha256: SIDECAR,
};
const BUILD_ID = idOf(ID_FIELDS);

/** A fresh copy of the `IN` fixture. */
function inp(): Obj {
  return {
    repoRoot: REPO,
    buildId: BUILD_ID,
    sourceTree: TREE,
    sourceTreeExcludes: [...EXCLUDES],
    commit: COMMIT,
    profile: "release",
    features: [],
    sidecarSha256: SIDECAR,
    distSha256: V1,
    mainBinarySha256: V2,
    versions: structuredClone(VERSIONS),
    codesign: { ...REAL },
    bundle: `${REPO}/${BUNDLE_REL}`,
  };
}

/** A fresh copy of the manifest `assembleManifest(inp())` must return (T01). */
function expected(): Obj {
  return {
    schemaVersion: 1,
    buildId: BUILD_ID,
    sourceTree: TREE,
    sourceTreeExcludes: [...EXCLUDES],
    commit: COMMIT,
    profile: "release",
    features: [],
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

/** Expect a ManifestError whose message names `fieldPath` and repeats none of `secrets`. */
function expectRejects(fn: () => unknown, fieldPath: string, secrets: string[] = []): void {
  const e = caught(fn);
  expect(e, `expected a ManifestError naming ${fieldPath}`).toBeInstanceOf(ManifestError);
  const msg = (e as Error).message;
  expect(msg).toContain(fieldPath);
  for (const s of secrets) expect(msg).not.toContain(s);
}

function setAt(root: Obj, at: Path, value: unknown): Obj {
  let node = root as Record<string | number, unknown>;
  for (const key of at.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
  node[at[at.length - 1]] = value;
  return root;
}

function without(o: Obj, key: string): Obj {
  const copy = { ...o };
  delete copy[key];
  return copy;
}

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
const hex = (r: Rng, n: number) => str(r, HEX, n, n);
function flipNibble(r: Rng, h: string): string {
  const i = int(r, 0, h.length - 1);
  const c = HEX[(HEX.indexOf(h[i]) + int(r, 1, 15)) % 16];
  return h.slice(0, i) + c + h.slice(i + 1);
}

// ---------------------------------------------------------------------------
// Real tmpdir I/O
// ---------------------------------------------------------------------------
const made: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mdpro-manifest-"));
  made.push(d);
  return d;
}
afterEach(() => {
  for (const d of made.splice(0)) {
    fs.chmodSync(d, 0o755);
    fs.rmSync(d, { recursive: true, force: true });
  }
});

// ===========================================================================
// assembleManifest
// ===========================================================================
describe("assembleManifest", () => {
  it("WI-8/T01 valid inputs give the exact closed-schema manifest", () => {
    const m = assembleManifest(inp());
    expect(m).toEqual(expected());
    expect(Object.keys(m).sort()).toEqual([
      "buildId",
      "bundle",
      "codesign",
      "commit",
      "distSha256",
      "features",
      "mainBinarySha256",
      "profile",
      "schemaVersion",
      "sidecarSha256",
      "sourceTree",
      "sourceTreeExcludes",
      "updaterArtifacts",
      "versions",
    ]);
  });

  it("WI-8/T02 bundle: a relative in-root path passes; escapes and the root itself throw", () => {
    expect(assembleManifest({ ...inp(), bundle: "src-tauri/x.app" }).bundle).toBe("src-tauri/x.app");
    const escapes = [
      "/elsewhere/mdpro.app",
      `${REPO}/../x.app`,
      `${REPO}-evil/x.app`,
      "../x.app",
      REPO,
    ];
    for (const bundle of escapes) {
      expectRejects(() => assembleManifest({ ...inp(), bundle }), "bundle", ["/elsewhere", REPO, "someone"]);
    }
  });

  const T03_ROWS: [string, () => Obj, string][] = [
    ["an unknown top-level env", () => ({ ...inp(), env: {} }), "env"],
    ["an unknown top-level token", () => ({ ...inp(), token: "x" }), "token"],
    ["an unknown top-level PATH", () => ({ ...inp(), PATH: "/usr/bin" }), "PATH"],
    ["the case variant buildID", () => ({ ...inp(), buildID: V1 }), "buildID"],
    ["a nested codesign.token", () => ({ ...inp(), codesign: { ...REAL, token: "ghp_x" } }), "codesign.token"],
    [
      "a nested versions.GITHUB_TOKEN",
      () => ({ ...inp(), versions: { ...VERSIONS, GITHUB_TOKEN: ["x"] } }),
      "versions.GITHUB_TOKEN",
    ],
    ["a missing distSha256", () => without(inp(), "distSha256"), "distSha256"],
    ["a missing codesign.cdhash", () => ({ ...inp(), codesign: without(REAL, "cdhash") }), "codesign.cdhash"],
    ["a missing versions.tao", () => ({ ...inp(), versions: without(VERSIONS, "tao") }), "versions.tao"],
  ];
  it.each(T03_ROWS)("WI-8/T03 the key set is closed at every depth: rejects %s", (_label, make, keyPath) => {
    expectRejects(() => assembleManifest(make()), keyPath, ["/usr/bin", "ghp_x"]);
  });

  it("WI-8/T04 commit: null and 64 hex are echoed; HEAD and uppercase hex throw", () => {
    expect(assembleManifest({ ...inp(), commit: null }).commit).toBeNull();
    expect(assembleManifest({ ...inp(), commit: V1 }).commit).toBe(V1);
    expectRejects(() => assembleManifest({ ...inp(), commit: "HEAD" }), "commit");
    expectRejects(() => assembleManifest({ ...inp(), commit: COMMIT.toUpperCase() }), "commit");
  });

  const flippedLast = BUILD_ID.slice(0, -1) + (BUILD_ID.endsWith("0") ? "1" : "0");
  const T05_ROWS: [string, string][] = [
    ["its last nibble flipped", flippedLast],
    ["computed for profile verify", idOf({ ...ID_FIELDS, profile: "verify" })],
    ["the literal unknown", "unknown"],
  ];
  it.each(T05_ROWS)("WI-8/T05 a buildId that disagrees with its fields throws: %s", (_label, buildId) => {
    expectRejects(() => assembleManifest({ ...inp(), buildId }), "buildId");
  });

  // -------------------------------------------------------------------------
  // T06: buildId consistency law over generated inputs (seed 806)
  // -------------------------------------------------------------------------
  const SEED_T06 = 806;
  const FEATURE_POOL = ["control", "verify-run", "alpha", "beta_2", "X9"];
  const EXCLUDE_POOL = [".claude/", "docs/", "**/*.tsbuildinfo", "tests/fixtures/", "a,b c"];
  const BUNDLE_POOL = [BUNDLE_REL, "src-tauri/target/verify/release/bundle/macos/mdpro.app", "out/x.app"];
  const subset = (r: Rng, pool: string[]) => pool.filter(() => r() < 0.5);

  function genConsistent(r: Rng): Obj {
    const excludes = subset(r, EXCLUDE_POOL);
    if (excludes.length === 0) excludes.push(pick(r, EXCLUDE_POOL));
    const id = {
      sourceTree: hex(r, pick(r, [40, 64])),
      sourceTreeExcludes: excludes,
      profile: pick(r, ["release", "verify"]),
      features: subset(r, FEATURE_POOL),
      sidecarSha256: hex(r, 64),
    };
    const commitKind = int(r, 0, 2);
    const rel = pick(r, BUNDLE_POOL);
    return {
      repoRoot: REPO,
      buildId: idOf(id),
      ...id,
      commit: commitKind === 0 ? null : hex(r, commitKind === 1 ? 40 : 64),
      distSha256: hex(r, 64),
      mainBinarySha256: hex(r, 64),
      versions: structuredClone(VERSIONS),
      codesign: { ...REAL, cdhash: hex(r, 40) },
      bundle: r() < 0.5 ? rel : `${REPO}/${rel}`,
    };
  }

  function toggleOne(r: Rng, list: string[], pool: string[]): string[] {
    const absent = pool.filter((p) => !list.includes(p));
    if (list.length > 0 && (absent.length === 0 || r() < 0.5)) {
      const i = int(r, 0, list.length - 1);
      return list.filter((_, j) => j !== i);
    }
    return [...list, pick(r, absent)];
  }

  function mutateIdInput(r: Rng, x: Obj): Obj {
    const y = structuredClone(x);
    switch (int(r, 0, 4)) {
      case 0:
        y.sourceTree = flipNibble(r, y.sourceTree as string);
        break;
      case 1:
        y.sourceTreeExcludes = toggleOne(r, y.sourceTreeExcludes as string[], EXCLUDE_POOL);
        break;
      case 2:
        y.profile = y.profile === "release" ? "verify" : "release";
        break;
      case 3:
        y.features = toggleOne(r, y.features as string[], FEATURE_POOL);
        break;
      default:
        y.sidecarSha256 = flipNibble(r, y.sidecarSha256 as string);
    }
    return y;
  }

  function mutateOutside(r: Rng, x: Obj, trial: number): Obj {
    const y = structuredClone(x);
    if (trial < 10) {
      const key = (y.features as string[]).length > 0 ? "features" : "sourceTreeExcludes";
      const list = y[key] as string[];
      y[key] = [...list].reverse().concat(list[0]);
      return y;
    }
    const versions = y.versions as Record<string, string[]>;
    const codesign = y.codesign as Obj;
    switch (int(r, 0, 5)) {
      case 0:
        y.distSha256 = flipNibble(r, y.distSha256 as string);
        break;
      case 1:
        y.mainBinarySha256 = flipNibble(r, y.mainBinarySha256 as string);
        break;
      case 2:
        y.commit = y.commit === null ? hex(r, 40) : null;
        break;
      case 3: {
        const key = pick(r, Object.keys(versions).filter((k) => versions[k].length > 0));
        versions[key][0] = "99.0.0";
        break;
      }
      case 4:
        y.bundle = "elsewhere-in-repo/other.app";
        break;
      default:
        codesign.cdhash = flipNibble(r, codesign.cdhash as string);
    }
    return y;
  }

  it("WI-8/T06 buildId always agrees with the manifest's own fields (seed 806, 150 trials)", () => {
    const r = mulberry32(SEED_T06);
    for (let i = 0; i < 50; i++) {
      const x = genConsistent(r);
      const m = assembleManifest(x);
      const tag = `seed ${SEED_T06} consistent ${i}`;
      expect(m.buildId, tag).toBe(x.buildId);
      expect(m.buildId, tag).toBe(idOf(idFieldsOf(m)));
    }
    for (let i = 0; i < 50; i++) {
      const x = genConsistent(r);
      const y = mutateIdInput(r, x);
      const tag = `seed ${SEED_T06} id-input mutant ${i}`;
      expect(idOf(idFieldsOf(y)), `${tag}: precondition`).not.toBe(x.buildId);
      const e = caught(() => assembleManifest(y));
      expect(e, tag).toBeInstanceOf(ManifestError);
      expect((e as Error).message, tag).toContain("buildId");
    }
    for (let i = 0; i < 50; i++) {
      const x = genConsistent(r);
      const y = mutateOutside(r, x, i);
      const tag = `seed ${SEED_T06} mirror ${i}`;
      const e = caught(() => assembleManifest(y));
      expect(e, tag).toBeUndefined();
      expect(assembleManifest(y).buildId, tag).toBe(x.buildId);
    }
  });
});

// ===========================================================================
// assertNoPrivateData
// ===========================================================================
describe("assertNoPrivateData", () => {
  const T07_ROWS: [string, Path, unknown, string][] = [
    ["features: [someone]", ["features"], ["someone"], "features"],
    ["codesign.identifier: /x", ["codesign", "identifier"], "/x", "codesign.identifier"],
    ["versions.tao: [~/x]", ["versions", "tao"], ["~/x"], "versions.tao"],
    [
      "versions[@tauri-apps/cli]: [x/Users/someone/y]",
      ["versions", "@tauri-apps/cli"],
      ["x/Users/someone/y"],
      "@tauri-apps/cli",
    ],
    [
      "codesign.format holding the repo root",
      ["codesign", "format"],
      "built in /Users/someone/dev/mdpro",
      "codesign.format",
    ],
    ["features: [a/someone/b]", ["features"], ["a/someone/b"], "features"],
    ["codesign.teamIdentifier: by someone", ["codesign", "teamIdentifier"], "by someone", "codesign.teamIdentifier"],
    ["codesign.identifier: com.someone.app", ["codesign", "identifier"], "com.someone.app", "codesign.identifier"],
  ];
  it.each(T07_ROWS)("WI-8/T07 a tainted leaf throws naming its field path: %s", (_label, at, value, fieldPath) => {
    const m = setAt(expected(), at, value);
    expectRejects(() => assertNoPrivateData(m, CTX), fieldPath, ["/Users", "someone"]);
  });

  it("WI-8/T08 a short user name does not trip on hex, only on a whole word", () => {
    const ab = { repoRoot: REPO, homeDir: "/Users/ab", userName: "ab" };
    const hexy = expected();
    for (const k of ["buildId", "sidecarSha256", "distSha256", "mainBinarySha256"]) hexy[k] = "ab".repeat(32);
    hexy.sourceTree = "ab".repeat(20);
    hexy.commit = "ab".repeat(20);
    (hexy.codesign as Obj).cdhash = "ab".repeat(20);
    expect(caught(() => assertNoPrivateData(hexy, ab)), "(a) hex full of ab").toBeUndefined();

    const longer = { ...expected(), features: ["someoneelse"] };
    expect(caught(() => assertNoPrivateData(longer, CTX)), "(b) someoneelse").toBeUndefined();

    expectRejects(() => assertNoPrivateData({ ...expected(), features: ["ab"] }, ab), "features");
  });

  const T09_ROWS: [string, Path, string][] = [
    ["sidecarSha256 holding a path", ["sidecarSha256"], "/Users/someone/x"],
    ["codesign.cdhash holding the user name", ["codesign", "cdhash"], "someone"],
    ["sourceTree holding ~", ["sourceTree"], "~"],
  ];
  it.each(T09_ROWS)("WI-8/T09 a hash field holding a non-hash value throws: %s", (_label, at, value) => {
    const m = setAt(expected(), at, value);
    expectRejects(() => assertNoPrivateData(m, CTX), at.join("."), ["/Users", "someone"]);
  });

  const HASH_PATHS = new Set([
    "buildId",
    "sourceTree",
    "commit",
    "sidecarSha256",
    "distSha256",
    "mainBinarySha256",
    "codesign.cdhash",
  ]);
  function stringLeaves(v: unknown, at: Path = [], out: Path[] = []): Path[] {
    if (typeof v === "string") {
      if (!HASH_PATHS.has(at.join("."))) out.push(at);
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => stringLeaves(x, [...at, i], out));
    } else if (v !== null && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) stringLeaves(x, [...at, k], out);
    }
    return out;
  }

  it("WI-8/T10 any tainted non-hash leaf at any depth throws (seed 810, 200 trials)", () => {
    const SEED = 810;
    const r = mulberry32(SEED);
    const base = (): Obj => ({ ...expected(), features: ["control", "verify-run"] });
    const leaves = stringLeaves(base());
    const taints: ((s: string) => string)[] = [
      (s) => `/abs${s}`,
      (s) => `~${s}`,
      (s) => `${s}${CTX.homeDir}${s}`,
      (s) => `${s}${CTX.repoRoot}`,
      (s) => `${s}/${CTX.userName}/${s}`,
      (s) => `${s}.${CTX.userName}.${s}`,
    ];
    for (let i = 0; i < 200; i++) {
      const tag = `seed ${SEED} trial ${i}`;
      expect(caught(() => assertNoPrivateData(base(), CTX)), `${tag}: untainted base`).toBeUndefined();
      const at = pick(r, leaves);
      const value = pick(r, taints)(str(r, "abcdefghijklmnopqrstuvwxyz", 0, 4));
      const e = caught(() => assertNoPrivateData(setAt(base(), at, value), CTX));
      expect(e, `${tag}: ${at.join(".")}`).toBeInstanceOf(ManifestError);
      expect((e as Error).message, tag).not.toContain(CTX.userName);
    }
  });
});

// ===========================================================================
// writeManifest
// ===========================================================================
describe("writeManifest", () => {
  it("WI-8/T11 round-trip: the file parses back to the manifest and ends with one newline", () => {
    const dir = tmp();
    const m = expected();
    const p = writeManifest(dir, m);
    expect(p).toBe(path.join(dir, NAME));
    const text = fs.readFileSync(p, "utf8");
    expect(JSON.parse(text)).toEqual(m);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });

  it("WI-8/T12 writing twice and over a longer file gives identical bytes and no tmp leftovers", () => {
    const dir = tmp();
    const m = expected();
    const first = fs.readFileSync(writeManifest(dir, m));
    expect(fs.readdirSync(dir)).toEqual([NAME]);
    const second = fs.readFileSync(writeManifest(dir, m));
    expect(fs.readdirSync(dir)).toEqual([NAME]);
    fs.writeFileSync(path.join(dir, NAME), `{"stale": "${"x".repeat(first.length * 2)}"}\n`);
    const third = fs.readFileSync(writeManifest(dir, m));
    expect(fs.readdirSync(dir)).toEqual([NAME]);
    expect(second.equals(first)).toBe(true);
    expect(third.equals(first)).toBe(true);
  });

  function shuffled(r: Rng, o: Obj): Obj {
    const keys = Object.keys(o);
    for (let i = keys.length - 1; i > 0; i--) {
      const j = int(r, 0, i);
      [keys[i], keys[j]] = [keys[j], keys[i]];
    }
    return Object.fromEntries(keys.map((k) => [k, o[k]]));
  }
  function expectSortedKeys(v: unknown, at: string): void {
    if (Array.isArray(v)) {
      v.forEach((x, i) => expectSortedKeys(x, `${at}[${i}]`));
    } else if (v !== null && typeof v === "object") {
      const keys = Object.keys(v);
      expect(keys, at).toEqual([...keys].sort());
      for (const [k, x] of Object.entries(v)) expectSortedKeys(x, `${at}.${k}`);
    }
  }

  it("WI-8/T13 bytes are stable and keys sorted at every depth, whatever the insertion order (seed 813)", () => {
    const SEED = 813;
    const r = mulberry32(SEED);
    const root = tmp();
    const texts: string[] = [];
    for (let i = 0; i < 20; i++) {
      const m = expected();
      m.versions = shuffled(r, m.versions as Obj);
      m.codesign = shuffled(r, m.codesign as Obj);
      const dir = path.join(root, String(i));
      fs.mkdirSync(dir);
      texts.push(fs.readFileSync(writeManifest(dir, shuffled(r, m)), "utf8"));
    }
    for (const [i, text] of texts.entries()) expect(text, `seed ${SEED} permutation ${i}`).toBe(texts[0]);
    expectSortedKeys(JSON.parse(texts[0]), "$");
  });

  it("WI-8/T14 a missing directory throws", () => {
    const dir = path.join(tmp(), "missing");
    expect(() => writeManifest(dir, expected())).toThrow(ManifestError);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it.skipIf(process.getuid?.() === 0)("WI-8/T14 a read-only directory throws and is left empty", () => {
    const dir = tmp();
    fs.chmodSync(dir, 0o555);
    expect(() => writeManifest(dir, expected())).toThrow(ManifestError);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("WI-8/T15 end to end: the written file carries no absolute path, home or user name", () => {
    const m = assembleManifest(inp());
    expect(caught(() => assertNoPrivateData(m, CTX))).toBeUndefined();
    const text = fs.readFileSync(writeManifest(tmp(), m), "utf8");
    for (const banned of ["/Users", "someone", '"/', '"~']) expect(text).not.toContain(banned);
    expect(JSON.parse(text).bundle).toBe(BUNDLE_REL);
  });
});
