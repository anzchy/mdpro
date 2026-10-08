// @vitest-environment node
/**
 * `scripts/control/smokeChecks.mjs` (ADR-0047 WI-001 review closure, WI-3, L1):
 * cases VB-01..25, SE-01..03, SS-01..03 from
 * `.claude/tdd-guardian/tests-20261008-085917.md`. No mocks: the real
 * `parseCodesign`, `MANIFEST_FILE` and `buildLayout` are used throughout.
 *
 * Laws: checkVerifyBundle reports exactly the suffix-filtered artifacts of
 * listingAfter (VB-18), is order-invariant (VB-19), monotonic on adding an
 * entry (VB-20), sensitive to any single departure from a valid bundle
 * (VB-21), and never emits a home path or a plugin-hijacking phrase (VB-22).
 * smokeExit: exit 0 iff the build exited 0 with no signal and no failures
 * (SE-01). formatSmokeSummary round-trips through the plugin's count parser
 * (SS-02).
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildLayout } from "../scripts/control/buildSteps.mjs";
import { MANIFEST_FILE } from "../scripts/control/manifest.mjs";
import { checkVerifyBundle, formatSmokeSummary, smokeExit } from "../scripts/control/smokeChecks.mjs";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const REL = "src-tauri/target/verify/release/bundle/macos/mdpro-verify.app";
const DIR = "src-tauri/target/verify/release/bundle/macos";
const CDHASH = "6140cd9271f655c037829fe53d1fc93b80de994e";

// Verbatim copy of FIXTURE from tests/control-build-digests.test.ts:202-219 (real
// ad-hoc `codesign -dvvv` stderr, home path replaced by /Users/someone). Copied,
// not imported: test files export nothing (matrix Deviation 8).
const CODESIGN_LINES = [
  "Executable=/Users/someone/Documents/01_Coding/mac-app/mdpro/src-tauri/target/release/bundle/macos/mdpro.app/Contents/MacOS/tauri-app",
  "Identifier=tauri_app-f283913162faab95",
  "Format=app bundle with Mach-O thin (arm64)",
  "CodeDirectory v=20400 size=159160 flags=0x20002(adhoc,linker-signed) hashes=4970+0 location=embedded",
  "Hash type=sha256 size=32",
  "CandidateCDHash sha256=6140cd9271f655c037829fe53d1fc93b80de994e",
  "CandidateCDHashFull sha256=6140cd9271f655c037829fe53d1fc93b80de994e6cb3338db3b24a9789dc85ca",
  "Hash choices=sha256",
  "CMSDigest=6140cd9271f655c037829fe53d1fc93b80de994e6cb3338db3b24a9789dc85ca",
  "CMSDigestType=2",
  "CDHash=6140cd9271f655c037829fe53d1fc93b80de994e",
  "Signature=adhoc",
  "Info.plist=not bound",
  "TeamIdentifier=not set",
  "Sealed Resources=none",
  "Internal requirements=none",
];
const csText = (lines: string[]) => `${lines.join("\n")}\n`;
const CODESIGN = csText(CODESIGN_LINES);

type Manifest = Record<string, unknown>;
/** Shaped like `assembleManifest`'s output (manifest.mjs:167-182), 14 fields. */
function manifestObj(): Manifest {
  return {
    schemaVersion: 1,
    buildId: "a".repeat(64),
    sourceTree: "b".repeat(64),
    sourceTreeExcludes: ["node_modules"],
    commit: "c".repeat(40),
    profile: "verify",
    features: ["verify-run"],
    sidecarSha256: "d".repeat(64),
    distSha256: "e".repeat(64),
    mainBinarySha256: "f".repeat(64),
    versions: { node: "v22.0.0", pnpm: "10.26.1" },
    codesign: {
      identifier: "tauri_app-f283913162faab95",
      format: "app bundle with Mach-O thin (arm64)",
      cdhash: CDHASH,
      signature: "adhoc",
      teamIdentifier: "not set",
    },
    updaterArtifacts: false,
    bundle: REL,
  };
}
const MANIFEST = JSON.stringify(manifestObj());
const withManifest = (edit: (m: Manifest) => void): string => {
  const m = manifestObj();
  edit(m);
  return JSON.stringify(m);
};

type Inputs = {
  listingBefore: readonly string[];
  listingAfter: readonly string[];
  manifestText: string | null;
  codesignText: string;
  expectedBundleRel: string;
};
const VALID: Inputs = {
  listingBefore: [],
  listingAfter: ["build-manifest.json", "mdpro-verify.app"],
  manifestText: MANIFEST,
  codesignText: CODESIGN,
  expectedBundleRel: REL,
};

// ---------------------------------------------------------------------------
// Message templates (matrix "Message templates"; immutable after red).
// ---------------------------------------------------------------------------
const show = (v: unknown) => (v === undefined ? "missing" : JSON.stringify(v));
const T_MNULL = (dir = DIR) => `manifest not found: ${dir}/build-manifest.json`;
const T_MJSON = `manifest is not valid JSON: ${DIR}/build-manifest.json`;
const T_MOBJ = `manifest is not a JSON object: ${DIR}/build-manifest.json`;
const T_UPD = (v: unknown) => `manifest updaterArtifacts is ${show(v)}, expected false`;
const T_PROF = (v: unknown) => `manifest profile is ${show(v)}, expected "verify"`;
const T_BUNDLE = (v: unknown, rel = REL) => `manifest bundle is ${show(v)}, expected "${rel}"`;
const T_CDH = (m: unknown, c: string) =>
  `manifest codesign.cdhash ${show(m)} does not match CDHash= ${c} from codesign -dvvv`;
const T_APP = `mdpro-verify.app missing from ${DIR}`;
const T_MFILE = (dir = DIR) => `build-manifest.json missing from ${dir}`;
const T_NEW = (n: string, dir = DIR) => `updater artifact created by this build: ${dir}/${n}`;
const T_STALE = (n: string) => `stale updater artifact (present before the build): ${DIR}/${n}`;
const CS_NO_CDHASH = "parseCodesign: missing or empty CDHash= (cdhash); is the bundle signed?";
const CS_NOTHING =
  "parseCodesign: missing or empty Identifier= (identifier), Format= (format), CDHash= (cdhash); is the bundle signed?";

const isArtifact = (n: string) => n.endsWith(".app.tar.gz") || n.endsWith(".sig");

/** Every failure array checkVerifyBundle returns in this file, for VB-22. */
const SEEN: string[] = [];
function check(x: Inputs): string[] {
  const out = checkVerifyBundle(x) as string[];
  SEEN.push(...out);
  return out;
}

// ---------------------------------------------------------------------------
// Seeded generator (mulberry32), copied from tests/control-build-id.test.ts:54.
// No fast-check by design (matrix Deviation 1).
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
const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const randStr = (r: Rng, alphabet: string, lo: number, hi: number) =>
  Array.from({ length: int(r, lo, hi) }, () => alphabet[Math.floor(r() * alphabet.length)]).join("");
const SAFE = "abcdefghijklmnopqrstuvwxyz0123456789._-";
const HEX = "0123456789abcdef";
function subset(r: Rng, pool: readonly string[], max: number): string[] {
  const shuffled = shuffle(r, pool);
  return shuffled.slice(0, int(r, 0, Math.min(max, pool.length)));
}
function shuffle<T>(r: Rng, xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const POOL = [
  "mdpro-verify.app",
  "build-manifest.json",
  "mdpro-verify.app.tar.gz",
  "mdpro-verify.app.tar.gz.sig",
  "mdpro.app.tar.gz",
  "x.sig",
  "sig.txt",
  "app.tar.gzx",
  "mdpro-verify.app.tar",
  "notes.md",
  "é.app.tar.gz",
];
const genListings = (r: Rng): Inputs => ({
  ...VALID,
  listingBefore: subset(r, POOL, 8),
  listingAfter: subset(r, POOL, 8),
});

/** One VB-21 mutation of VALID; returns the mutated inputs and the mutation kind. */
function mutate(r: Rng, base: Inputs, executableHome?: string): { x: Inputs; kind: string } {
  const kind = pick(r, ["profile", "bundle", "updater", "cdhash", "csCdhash", "dropApp", "dropManifest", "addArtifact"]);
  let x: Inputs = { ...base };
  const m = JSON.parse(base.manifestText ?? MANIFEST) as Manifest;
  const hex40 = (avoid: string) => {
    let h = avoid;
    while (h === avoid) h = randStr(r, HEX, 40, 40);
    return h;
  };
  switch (kind) {
    case "profile": {
      let p = "verify";
      while (p === "verify") p = randStr(r, SAFE, 1, 12);
      m.profile = p;
      break;
    }
    case "bundle": {
      let b = REL;
      while (b === REL) b = Array.from({ length: int(r, 1, 4) }, () => randStr(r, SAFE, 1, 8)).join("/");
      m.bundle = b;
      break;
    }
    case "updater": {
      const choice = int(r, 0, 7);
      if (choice === 7) delete m.updaterArtifacts;
      else m.updaterArtifacts = [true, 1, "", "false", null, [], {}][choice];
      break;
    }
    case "cdhash":
      (m.codesign as Manifest).cdhash = hex40(CDHASH);
      break;
    case "csCdhash": {
      const h = hex40(String((m.codesign as Manifest).cdhash));
      x.codesignText = x.codesignText.replace(/^CDHash=.*$/m, `CDHash=${h}`);
      break;
    }
    case "dropApp":
      x.listingAfter = x.listingAfter.filter((n) => n !== "mdpro-verify.app");
      break;
    case "dropManifest":
      x.listingAfter = x.listingAfter.filter((n) => n !== "build-manifest.json");
      break;
    case "addArtifact":
      x.listingAfter = [...x.listingAfter, `${randStr(r, SAFE, 1, 8)}${pick(r, [".app.tar.gz", ".sig"])}`];
      break;
  }
  x = { ...x, manifestText: JSON.stringify(m) };
  if (executableHome !== undefined) {
    x.codesignText = x.codesignText.replace(/^Executable=.*$/m, `Executable=/Users/u${executableHome}/x`);
  }
  return { x, kind };
}

// Copied verbatim from the tdd-guardian plugin, lib/exec.js:28-33 (UPGRADE_PATTERNS)
// and :36-43 (NO_TESTS_PATTERNS), version 0.10.2. Re-copy with a reason if the plugin changes.
const UPGRADE_PATTERNS = [
  { re: /JavaScript heap out of memory|Out of memory|MemoryError|OutOfMemoryError/i, status: "killed" },
  { re: /Cannot find module|ModuleNotFoundError|ImportError: No module named|error: could not find|package .* is not in (std|GOROOT)/i, status: "runner-error" },
  { re: /command not found|is not recognized as an internal or external command|No such file or directory/i, status: "runner-missing" },
  { re: /error: unknown (option|flag|argument)|unrecognized arguments|Unknown option/i, status: "runner-error" },
];
const NO_TESTS_PATTERNS = [
  /no tests? (were )?found/i,
  /no test files found/i,
  /no tests ran/i,
  /collected 0 items/i,
  /Test suites: 0 total/i,
  /\[no test files\]/i,
];

type Counts = { failed: number; passed: number; skipped: number; total: number };
// Copied verbatim from the tdd-guardian plugin, lib/exec.js:94-150 (COUNT_PARSERS)
// and :152-163 (parseCounts), version 0.10.2. First match wins.
const COUNT_PARSERS: ((t: string) => Counts | null)[] = [
  // Vitest: "Tests  12 passed | 1 failed (13)"
  (t) => {
    const m = /Tests\s+(?:(\d+)\s+failed\s*\|\s*)?(\d+)\s+passed(?:\s*\|\s*(\d+)\s+skipped)?\s*\((\d+)\)/i.exec(t);
    return m ? { failed: +(m[1] || 0), passed: +m[2], skipped: +(m[3] || 0), total: +m[4] } : null;
  },
  // Jest: "Tests:       1 failed, 12 passed, 13 total"
  (t) => {
    const m = /Tests:\s+(?:(\d+) failed,\s*)?(?:(\d+) skipped,\s*)?(?:(\d+) passed,\s*)?(\d+) total/i.exec(t);
    return m ? { failed: +(m[1] || 0), skipped: +(m[2] || 0), passed: +(m[3] || 0), total: +m[4] } : null;
  },
  // Pytest: "=== 1 failed, 12 passed, 2 skipped in 0.4s ==="
  (t) => {
    if (!/=+.*(passed|failed|error).*=+/i.test(t)) return null;
    const failed = +(/(\d+) failed/i.exec(t)?.[1] || 0);
    const passed = +(/(\d+) passed/i.exec(t)?.[1] || 0);
    const skipped = +(/(\d+) skipped/i.exec(t)?.[1] || 0);
    const errors = +(/(\d+) errors?/i.exec(t)?.[1] || 0);
    if (!failed && !passed && !skipped && !errors) return null;
    return { failed: failed + errors, passed, skipped, total: failed + passed + skipped + errors };
  },
  // Cargo: "test result: FAILED. 12 passed; 1 failed; 2 ignored"
  (t) => {
    const m = /test result:\s+\w+\.\s+(\d+) passed;\s*(\d+) failed;\s*(\d+) ignored/i.exec(t);
    return m ? { passed: +m[1], failed: +m[2], skipped: +m[3], total: +m[1] + +m[2] + +m[3] } : null;
  },
  // Maven Surefire / Gradle: "Tests run: 13, Failures: 1, Errors: 0, Skipped: 2"
  (t) => {
    const m = /Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)/i.exec(t);
    if (!m) return null;
    const total = +m[1];
    const failed = +m[2] + +m[3];
    return { passed: total - failed - +m[4], failed, skipped: +m[4], total };
  },
  // dotnet test: "Passed!  - Failed: 0, Passed: 12, Skipped: 1, Total: 13"
  (t) => {
    const m = /Failed:\s*(\d+),\s*Passed:\s*(\d+),\s*Skipped:\s*(\d+),\s*Total:\s*(\d+)/i.exec(t);
    return m ? { failed: +m[1], passed: +m[2], skipped: +m[3], total: +m[4] } : null;
  },
  // Go: count per-test result lines.
  (t) => {
    const pass = (t.match(/^\s*--- PASS:/gm) || []).length;
    const fail = (t.match(/^\s*--- FAIL:/gm) || []).length;
    const skip = (t.match(/^\s*--- SKIP:/gm) || []).length;
    return pass + fail + skip > 0 ? { passed: pass, failed: fail, skipped: skip, total: pass + fail + skip } : null;
  },
  // ExUnit: "13 tests, 1 failure"
  (t) => {
    const m = /(\d+) tests?, (\d+) failures?(?:, (\d+) (?:skipped|excluded))?/i.exec(t);
    return m ? { total: +m[1], failed: +m[2], skipped: +(m[3] || 0), passed: +m[1] - +m[2] - +(m[3] || 0) } : null;
  },
  // RSpec: "13 examples, 1 failure, 2 pending"
  (t) => {
    const m = /(\d+) examples?, (\d+) failures?(?:, (\d+) pending)?/i.exec(t);
    return m ? { total: +m[1], failed: +m[2], skipped: +(m[3] || 0), passed: +m[1] - +m[2] - +(m[3] || 0) } : null;
  },
];
function parseCounts(stdout: string, stderr: string): Counts | null {
  const text = stdout + "\n" + stderr;
  for (const parser of COUNT_PARSERS) {
    try {
      const counts = parser(text);
      if (counts && Number.isFinite(counts.total)) return counts;
    } catch {
      // A parser that throws on unexpected output must not take the run down.
    }
  }
  return null;
}
const lastLine = (s: string) => s.trimEnd().split("\n").at(-1);

// ===========================================================================
// checkVerifyBundle
// ===========================================================================
describe("checkVerifyBundle", () => {
  it("VB-01 a clean verify bundle passes", () => {
    expect(check(VALID)).toEqual([]);
  });

  it("VB-02 a null manifest alone is one failure", () => {
    expect(check({ ...VALID, manifestText: null })).toEqual([T_MNULL()]);
  });

  it("VB-03 a realistic missing manifest gives two failures in order", () => {
    expect(check({ ...VALID, manifestText: null, listingAfter: ["mdpro-verify.app"] })).toEqual([T_MNULL(), T_MFILE()]);
  });

  it.each(['{"profile":', "", "not json"])("VB-04 malformed JSON %j", (text) => {
    expect(() => checkVerifyBundle({ ...VALID, manifestText: text })).not.toThrow();
    expect(check({ ...VALID, manifestText: text })).toEqual([T_MJSON]);
  });

  it.each(["null", "[]", '"verify"', "42"])("VB-05 valid JSON that is not an object %j", (text) => {
    expect(() => checkVerifyBundle({ ...VALID, manifestText: text })).not.toThrow();
    expect(check({ ...VALID, manifestText: text })).toEqual([T_MOBJ]);
  });

  it.each([[true], ["false"], [0], [null], [undefined]])("VB-06 updaterArtifacts %j is not strictly false", (v) => {
    const text = withManifest((m) => {
      if (v === undefined) delete m.updaterArtifacts;
      else m.updaterArtifacts = v;
    });
    expect(check({ ...VALID, manifestText: text })).toEqual([T_UPD(v)]);
  });

  it.each([["release"], ["Verify"], [undefined]])("VB-07 profile %j", (v) => {
    const text = withManifest((m) => {
      if (v === undefined) delete m.profile;
      else m.profile = v;
    });
    expect(check({ ...VALID, manifestText: text })).toEqual([T_PROF(v)]);
  });

  it.each(["src-tauri/target/release/bundle/macos/mdpro.app", `${REL}/`, `./${REL}`])(
    "VB-08 bundle %j must equal expectedBundleRel exactly",
    (v) => {
      expect(check({ ...VALID, manifestText: withManifest((m) => (m.bundle = v)) })).toEqual([T_BUNDLE(v)]);
    },
  );

  it.each([["0".repeat(40)], [CDHASH.toUpperCase()], [undefined]])("VB-09 manifest cdhash %j vs codesign", (v) => {
    const text = withManifest((m) => {
      const cs = m.codesign as Manifest;
      if (v === undefined) delete cs.cdhash;
      else cs.cdhash = v;
    });
    expect(check({ ...VALID, manifestText: text })).toEqual([T_CDH(v, CDHASH)]);
  });

  it.each([
    ["CDHash= line removed", csText(CODESIGN_LINES.filter((l) => !l.startsWith("CDHash="))), CS_NO_CDHASH],
    ["empty output", "", CS_NOTHING],
    ["unsigned", "code object is not signed at all", CS_NOTHING],
  ])("VB-10 codesign output without CDHash= (%s)", (_name, cs, msg) => {
    const out = check({ ...VALID, codesignText: cs });
    expect(out).toEqual([msg]);
    expect(out[0]).toContain("CDHash=");
  });

  it("VB-11 the Executable=/Users/… path never leaks", () => {
    const i = check(VALID);
    expect(i).toEqual([]);
    const ii = check({ ...VALID, manifestText: withManifest((m) => ((m.codesign as Manifest).cdhash = "1".repeat(40))) });
    expect(ii).toEqual([T_CDH("1".repeat(40), CDHASH)]);
    const cs = csText(CODESIGN_LINES.map((l) => (l.startsWith("Identifier=") ? "Identifier=/Users/someone/x" : l)));
    const iii = check({ ...VALID, codesignText: cs });
    expect(iii).toEqual(["parseCodesign: identifier (Identifier=) is a rooted path; refusing to record it"]);
    for (const out of [i, ii, iii]) expect(out.join("\n")).not.toContain("/Users/");
  });

  it("VB-12 the .app is missing from listingAfter", () => {
    expect(check({ ...VALID, listingAfter: ["build-manifest.json"] })).toEqual([T_APP]);
  });

  it("VB-13 the manifest file is missing from listingAfter while manifestText is present", () => {
    expect(check({ ...VALID, listingAfter: ["mdpro-verify.app"] })).toEqual([T_MFILE()]);
  });

  it("VB-14 updater artifacts created by this build", () => {
    const gz = "mdpro-verify.app.tar.gz";
    const sig = "mdpro-verify.app.tar.gz.sig";
    expect(check({ ...VALID, listingAfter: [...VALID.listingAfter, gz] })).toEqual([T_NEW(gz)]);
    expect(check({ ...VALID, listingAfter: [...VALID.listingAfter, sig] })).toEqual([T_NEW(sig)]);
    expect(check({ ...VALID, listingAfter: [sig, gz, ...VALID.listingAfter] })).toEqual([T_NEW(gz), T_NEW(sig)]);
  });

  it("VB-15 stale artifacts vs artifacts the build removed", () => {
    const gz = "mdpro-verify.app.tar.gz";
    expect(check({ ...VALID, listingBefore: [gz], listingAfter: [...VALID.listingAfter, gz] })).toEqual([T_STALE(gz)]);
    expect(check({ ...VALID, listingBefore: [gz] })).toEqual([]);
  });

  it("VB-16 decoys are not artifacts", () => {
    const decoys = ["sig.txt", "mdpro-verify.app.tar.gzx", "notes.sig.bak", "mdpro-verify.app.tar", "app.tar.gz"];
    expect(check({ ...VALID, listingAfter: [...VALID.listingAfter, ...decoys] })).toEqual([]);
  });

  it("VB-17 everything wrong at once: exact order, determinism, purity", () => {
    const bad = "0".repeat(40);
    const text = withManifest((m) => {
      m.profile = "release";
      m.bundle = "x";
      m.updaterArtifacts = true;
      (m.codesign as Manifest).cdhash = bad;
    });
    const x: Inputs = Object.freeze({
      ...VALID,
      manifestText: text,
      listingBefore: Object.freeze(["z.sig"]),
      listingAfter: Object.freeze(["z.sig", "a.app.tar.gz"]),
    });
    const expected = [
      T_UPD(true),
      T_PROF("release"),
      T_BUNDLE("x"),
      T_CDH(bad, CDHASH),
      T_APP,
      T_MFILE(),
      T_NEW("a.app.tar.gz"),
      T_STALE("z.sig"),
    ];
    expect(check(x)).toEqual(expected);
    expect(check(x)).toEqual(expected);
    expect(x.listingAfter).toEqual(["z.sig", "a.app.tar.gz"]);
    expect(x.listingBefore).toEqual(["z.sig"]);
  });

  it("VB-18 artifact-filter property (seed 2026100821)", () => {
    const seed = 2026100821;
    const r = mulberry32(seed);
    for (let i = 0; i < 300; i++) {
      const x = genListings(r);
      const before = [...x.listingBefore];
      const artifacts = x.listingAfter
        .filter(isArtifact)
        .sort()
        .map((n) => (before.includes(n) ? T_STALE(n) : T_NEW(n)));
      const prefix = [
        ...(x.listingAfter.includes("mdpro-verify.app") ? [] : [T_APP]),
        ...(x.listingAfter.includes("build-manifest.json") ? [] : [T_MFILE()]),
      ];
      expect(check(x), `seed ${seed} iter ${i}`).toEqual([...prefix, ...artifacts]);
    }
  });

  it("VB-19 permutation invariance (seed 2026100822)", () => {
    const seed = 2026100822;
    const r = mulberry32(seed);
    const fixed: Inputs[] = [
      { ...VALID, manifestText: null, listingAfter: ["mdpro-verify.app"] },
      { ...VALID, listingAfter: ["build-manifest.json"] },
      { ...VALID, listingAfter: ["mdpro-verify.app.tar.gz.sig", "mdpro-verify.app.tar.gz", ...VALID.listingAfter] },
      { ...VALID, listingBefore: ["mdpro-verify.app.tar.gz", "x.sig"], listingAfter: [...VALID.listingAfter, "mdpro-verify.app.tar.gz"] },
      { ...VALID, listingAfter: [...VALID.listingAfter, "sig.txt", "notes.sig.bak", "app.tar.gz"] },
      { ...VALID, listingBefore: ["z.sig"], listingAfter: ["z.sig", "a.app.tar.gz"], manifestText: withManifest((m) => (m.profile = "release")) },
    ];
    const domain = [...fixed, ...Array.from({ length: 200 }, () => genListings(r))];
    domain.forEach((x, i) => {
      const original = check(x);
      for (let k = 0; k < 3; k++) {
        const shuffled = { ...x, listingBefore: shuffle(r, x.listingBefore), listingAfter: shuffle(r, x.listingAfter) };
        expect(check(shuffled), `seed ${seed} iter ${i} shuffle ${k}`).toEqual(original);
      }
    });
  });

  it("VB-20 monotonic on adding an entry (seed 2026100823)", () => {
    const seed = 2026100823;
    const r = mulberry32(seed);
    const addable = POOL.filter((n) => n !== "mdpro-verify.app" && n !== "build-manifest.json");
    for (let i = 0; i < 300; i++) {
      const base = genListings(r);
      const xName = r() < 0.5 ? pick(r, addable) : randStr(r, "abcdefghijklmnopqrstuvwxyz.", 1, 12);
      const before = check(base);
      const after = check({ ...base, listingAfter: [...base.listingAfter, xName] });
      const msg = `seed ${seed} iter ${i} add ${JSON.stringify(xName)}`;
      expect(after, msg).toEqual(expect.arrayContaining(before));
      if (!isArtifact(xName)) expect(after, msg).toEqual(before);
    }
  });

  it("VB-21 sensitivity: any single departure from VALID fails (seed 2026100824)", () => {
    const seed = 2026100824;
    const r = mulberry32(seed);
    for (let i = 0; i < 300; i++) {
      const { x, kind } = mutate(r, VALID);
      expect(check(x).length, `seed ${seed} iter ${i} mutation ${kind}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("VB-23 fixture constants match the real layout", () => {
    const layout = buildLayout("/r", "verify");
    expect(path.relative("/r", layout.app)).toBe(REL);
    expect(path.relative("/r", layout.bundleDir)).toBe(DIR);
    expect(MANIFEST_FILE).toBe("build-manifest.json");
  });

  it.each([
    ["deleted", (m: Manifest) => delete m.codesign],
    ["null", (m: Manifest) => (m.codesign = null)],
    ["a string", (m: Manifest) => (m.codesign = "x")],
  ])("VB-24 manifest codesign %s", (_name, edit) => {
    const x = { ...VALID, manifestText: withManifest(edit) };
    expect(() => checkVerifyBundle(x)).not.toThrow();
    expect(check(x)).toEqual([
      `manifest codesign.cdhash missing does not match CDHash= ${CDHASH} from codesign -dvvv`,
    ]);
  });

  it("VB-25 a different expectedBundleRel drives the bundle check and the message paths", () => {
    const REL2 = "src-tauri/target/alt/release/bundle/macos/mdpro-verify.app";
    const DIR2 = "src-tauri/target/alt/release/bundle/macos";
    const m2 = withManifest((m) => (m.bundle = REL2));
    expect(check({ ...VALID, expectedBundleRel: REL2, manifestText: m2 })).toEqual([]);
    expect(check({ ...VALID, expectedBundleRel: REL2 })).toEqual([`manifest bundle is "${REL}", expected "${REL2}"`]);
    expect(
      check({
        ...VALID,
        expectedBundleRel: REL2,
        manifestText: null,
        listingAfter: ["mdpro-verify.app", "mdpro-verify.app.tar.gz"],
      }),
    ).toEqual([
      `manifest not found: ${DIR2}/build-manifest.json`,
      `build-manifest.json missing from ${DIR2}`,
      `updater artifact created by this build: ${DIR2}/mdpro-verify.app.tar.gz`,
    ]);
  });

  // Runs last in this describe so SEEN holds every failure produced above.
  it("VB-22 failure-text privacy and plugin-safety property (seed 2026100825)", () => {
    const seed = 2026100825;
    const r = mulberry32(seed);
    for (let i = 0; i < 300; i++) {
      const { x } = mutate(r, VALID, randStr(r, SAFE, 1, 10));
      check(x);
    }
    expect(SEEN.length).toBeGreaterThan(300);
    for (const f of SEEN) {
      const msg = `seed ${seed} failure ${JSON.stringify(f)}`;
      expect(f.includes("/Users/"), msg).toBe(false);
      for (const { re } of UPGRADE_PATTERNS) expect(re.test(f), `${msg} matches ${re}`).toBe(false);
      for (const re of NO_TESTS_PATTERNS) expect(re.test(f), `${msg} matches ${re}`).toBe(false);
      expect(/\d+ (passed|failed|skipped|errors?)/i.test(f), msg).toBe(false);
    }
  });
});

// ===========================================================================
// smokeExit
// ===========================================================================
const PASS_THROUGH = new Set([75, 126, 127, 130, 137, 143]);

describe("smokeExit", () => {
  it("SE-01 exhaustive safety and mapping law", () => {
    const statuses: (number | null)[] = [null, ...Array.from({ length: 256 }, (_, s) => s)];
    const signals = [null, "SIGTERM", "SIGINT", "SIGKILL"];
    const failureSets = [[], ["x"]];
    let n = 0;
    for (const buildStatus of statuses) {
      for (const buildSignal of signals) {
        for (const failures of failureSets) {
          if (buildStatus === null && buildSignal === null) continue; // SE-03
          n++;
          const combo = `status ${buildStatus} signal ${buildSignal} failures ${JSON.stringify(failures)}`;
          const r = smokeExit({ buildStatus, buildSignal, failures });
          if (buildSignal !== null) {
            expect(r, combo).toEqual({ signal: buildSignal });
            continue;
          }
          const s = buildStatus as number;
          const expectedExit = s !== 0 ? (PASS_THROUGH.has(s) ? s : 1) : failures.length > 0 ? 1 : 0;
          expect(r.exit, combo).toBe(expectedExit);
          expect(r.exit === 0, combo).toBe(s === 0 && failures.length === 0);
          const expectedFailures = s !== 0 ? [...failures, `control:build exited ${s}`] : [...failures];
          expect(r.failures, combo).toEqual(expectedFailures);
        }
      }
    }
    expect(n).toBe(2054);
  });

  it.each([
    [0, null, [], { exit: 0, failures: [] }],
    [0, null, ["a"], { exit: 1, failures: ["a"] }],
    ...[75, 126, 127, 130, 137, 143].map((s) => [s, null, [], { exit: s, failures: [`control:build exited ${s}`] }]),
    ...[1, 2, 101, 255].map((s) => [s, null, [], { exit: 1, failures: [`control:build exited ${s}`] }]),
    [null, "SIGTERM", [], { signal: "SIGTERM" }],
    [null, "SIGINT", ["a"], { signal: "SIGINT" }],
  ])("SE-02 status %j signal %j failures %j", (buildStatus, buildSignal, failures, expected) => {
    expect(smokeExit({ buildStatus, buildSignal, failures })).toEqual(expected);
  });

  it("SE-03 the build never ran (status and signal both null) is not success", () => {
    const r = smokeExit({ buildStatus: null, buildSignal: null, failures: [] });
    expect("exit" in r && r.exit !== 0).toBe(true);
    expect(r.failures.length).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// formatSmokeSummary
// ===========================================================================
describe("formatSmokeSummary", () => {
  it("SS-01 examples", () => {
    expect(lastLine(formatSmokeSummary(9, []))).toBe("=== 9 passed, 0 failed ===");
    const out = formatSmokeSummary(9, ["a", "b"]);
    expect(lastLine(out)).toBe("=== 7 passed, 2 failed ===");
    const lines = out.trimEnd().split("\n").slice(0, -1);
    expect(lines.indexOf("a")).toBeGreaterThanOrEqual(0);
    expect(lines.indexOf("b")).toBeGreaterThan(lines.indexOf("a"));
  });

  it("SS-02 round-trip through the copied plugin parser (seed 2026100831)", () => {
    const seed = 2026100831;
    const r = mulberry32(seed);
    for (let i = 0; i < 300; i++) {
      let F: string[];
      if (i % 10 === 0) {
        F = [];
      } else {
        let x = VALID;
        for (let k = int(r, 1, 4); k > 0; k--) x = mutate(r, x).x;
        F = checkVerifyBundle(x) as string[];
      }
      const M = F.length;
      const total = M + int(r, F.length === 0 ? 1 : 0, 20);
      const out = formatSmokeSummary(total, F);
      const msg = `seed ${seed} iter ${i} M ${M} total ${total}`;
      expect(parseCounts(out, ""), msg).toEqual({ failed: M, passed: total - M, skipped: 0, total });
      for (const re of NO_TESTS_PATTERNS) expect(re.test(out), `${msg} matches ${re}`).toBe(false);
    }
  });

  it("SS-03 everything failed", () => {
    const out = formatSmokeSummary(3, ["a", "b", "c"]);
    expect(lastLine(out)).toBe("=== 0 passed, 3 failed ===");
    expect(parseCounts(out, "")).toEqual({ failed: 3, passed: 0, skipped: 0, total: 3 });
  });
});
