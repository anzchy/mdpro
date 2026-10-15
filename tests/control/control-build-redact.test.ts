// @vitest-environment node
/**
 * WI-14 (ADR-0047): `redactPaths` and the CLI's redacted failure output.
 * Matrix: `.claude/tdd-guardian/tests-20261002-201520.md`, units
 * `buildSteps.mjs#redactPaths` (WI-10/T19, T20, T21, T30) and
 * `build.mjs#main CLI redaction` (WI-10/T22), with decisions O18 and O19.
 *
 * Every path here is fake (`/h/u/r`, `/w/r`, …) or lives in a sandbox dir.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { redactPaths } from "../../scripts/control/buildSteps.mjs";
import { FIXED_GIT_ENV, GitSandbox } from "../helpers/controlGitRepo";

type Ctx = { repoRoot: string; homeDir: string };
const redact = (text: string, ctx: Ctx): string => redactPaths(text, ctx);

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

const SEG_ALPHABET = "ab.~-";
/** No `/`, so filler alone can never contain either path. */
const FILLER_ALPHABET = "ab.~- :";
const TRIALS = 300;
const METAMORPHIC_TRIALS = 200;

const seg = (r: Rng) => str(r, SEG_ALPHABET, 1, 3);
const gen = (r: Rng) => `/${Array.from({ length: int(r, 1, 3) }, () => seg(r)).join("/")}`;
const filler = (r: Rng) => str(r, FILLER_ALPHABET, 1, 4);

type Relation = 0 | 1 | 2 | 3;
type GenCase = {
  root: string;
  home: string;
  text: string;
  filler: string;
  maxDepth: number;
  relation: Relation;
  homeOverridden: boolean;
  traps: number;
};

/**
 * A nested trap: start from one path, then splice a path over a character of
 * the previous level that equals the other path's (or its own) replacement, so
 * reducing a level rebuilds the one above it.
 */
function trap(r: Rng, root: string, home: string): { text: string; achieved: number } {
  const repl = (p: string) => (p === root ? "." : "~");
  const depth = int(r, 1, 3);
  let t = pick(r, [root, home]);
  let span: [number, number] = [0, t.length];
  let achieved = 0;
  for (let level = 1; level <= depth; level++) {
    const y = pick(r, [root, home]);
    const want = repl(y);
    const hits: number[] = [];
    for (let j = span[0]; j < span[1]; j++) if (t[j] === want) hits.push(j);
    if (hits.length === 0) break;
    const j = pick(r, hits);
    t = t.slice(0, j) + y + t.slice(j + 1);
    span = [j, j + y.length];
    achieved++;
  }
  return { text: t, achieved };
}

/** The matrix's `genCase(r, t)`; WI-10/T30 reuses it. */
function genCase(r: Rng, trial: number): GenCase {
  const relation = (trial % 4) as Relation;
  let root: string;
  let home: string;
  if (relation === 0) {
    home = gen(r);
    root = home + gen(r);
  } else if (relation === 1) {
    root = gen(r);
    home = root + gen(r);
  } else if (relation === 2) {
    root = gen(r);
    home = gen(r);
    for (let k = 0; k < 10 && (root.includes(home) || home.includes(root)); k++) {
      root = gen(r);
      home = gen(r);
    }
  } else {
    root = gen(r);
    home = root;
  }
  const homeOverridden = trial % 10 === 9;
  if (homeOverridden) home = "/";

  const tokens: string[] = [];
  let maxDepth = 0;
  let traps = 0;
  const n = int(r, 1, 8);
  for (let k = 0; k < n; k++) {
    const w = r();
    if (w < 0.2) tokens.push(root);
    else if (w < 0.4) tokens.push(home);
    else if (w < 0.6) tokens.push(filler(r));
    else {
      const tr = trap(r, root, home);
      if (tr.achieved === 0) {
        tokens.push(filler(r));
      } else {
        tokens.push(tr.text);
        traps++;
        maxDepth = Math.max(maxDepth, tr.achieved);
      }
    }
  }
  const fill = Array.from({ length: int(r, 1, 3) }, () => filler(r)).join(" ");
  return { root, home, text: tokens.join(""), filler: fill, maxDepth, relation, homeOverridden, traps };
}

const describeCase = (seed: number, t: number, c: GenCase) =>
  `seed ${seed} trial ${t} root ${JSON.stringify(c.root)} home ${JSON.stringify(c.home)} text ${JSON.stringify(c.text)}`;

describe("redactPaths (WI-14)", () => {
  it("WI-10/T19 holds containment, identity and idempotence over generated paths (seed 1019)", () => {
    const r = mulberry32(1019);
    let traps = 0;
    let depth3 = 0;
    const perRelation = [0, 0, 0, 0];
    for (let t = 0; t < TRIALS; t++) {
      const c = genCase(r, t);
      traps += c.traps;
      if (c.maxDepth === 3) depth3++;
      if (!c.homeOverridden) perRelation[c.relation]++;
      const ctx = { repoRoot: c.root, homeDir: c.home };
      const msg = describeCase(1019, t, c);
      const out = redact(c.text, ctx);
      expect(out.includes(c.root), `(a) ${msg} out ${JSON.stringify(out)}`).toBe(false);
      if (c.home !== "/") expect(out.includes(c.home), `(b) ${msg} out ${JSON.stringify(out)}`).toBe(false);
      expect(redact(out, ctx), `(c) ${msg}`).toBe(out);
      expect(redact(c.filler, ctx), `(d) ${msg} filler ${JSON.stringify(c.filler)}`).toBe(c.filler);
    }
    // Generator sanity: the recombination the property exists for really occurs.
    expect(traps).toBeGreaterThanOrEqual(30);
    for (const count of perRelation) expect(count).toBeGreaterThanOrEqual(60);
    expect(depth3).toBeGreaterThanOrEqual(20);
  });

  it("WI-10/T20 redacts the examples", () => {
    const rows: [number, string, string, string, string][] = [
      [1, "/h/u/r", "/h/u", "at /h/u/r/src and /h/u/.cfg", "at ./src and ~/.cfg"],
      [2, "/w/r", "/h/someone", "/w/r/a:/w/r/b /h/someone/x /h/someone/y", "./a:./b ~/x ~/y"],
      [3, "/w/r", "/h/someone", "./src ~/x", "./src ~/x"],
      [4, "/w/r", "/", "/w/r/a /etc/x", "./a /etc/x"],
      [5, "/w/r", "", "/w/r/a /h/x", "./a /h/x"],
    ];
    for (const [n, repoRoot, homeDir, text, output] of rows) {
      expect(redact(text, { repoRoot, homeDir }), `row ${n}`).toBe(output);
    }
  });

  it("WI-10/T21 a replacement that rebuilds a path does not bring it back", () => {
    const rows: [number, string, string, string, string][] = [
      [1, "/a.b", "/h/someone", "/a/a.bb", "."],
      [2, "/w/r", "/h~", "/h/h~~", "~~"],
      [3, "/r~s", "/h", "/r/hs", "."],
      [4, "/r", "/h.k", "/h/rk", "~"],
      [5, "/a.b", "/h/someone", "/a/a/a.bbb", "."],
      [6, "/a.b", "/h/someone", "/a/a/a/a.bbbb", "."],
      [7, "/a.b", "/h/someone", `${"/a".repeat(1000)}.${"b".repeat(1000)}`, "."],
      [8, "/x~y", "/h.z", "/h/x/h.zyz", "~"],
    ];
    for (const [n, repoRoot, homeDir, text, output] of rows) {
      const ctx = { repoRoot, homeDir };
      const out = redact(text, ctx);
      expect(out, `row ${n}`).toBe(output);
      expect(out.includes(repoRoot), `row ${n} keeps the root`).toBe(false);
      expect(out.includes(homeDir), `row ${n} keeps home`).toBe(false);
      expect(redact(out, ctx), `row ${n} idempotent`).toBe(out);
    }
  });

  it("WI-10/T30 trailing slashes on either path do not change the output (O19)", () => {
    const bareHome = "/h/u";
    const rows: [number, string, string, string, string][] = [
      [1, "/w/r", "/h/u/", "cannot read /h/u", "cannot read ~"],
      [2, "/w/r", "/h/u/", "/h/u/x and /h/u", "~/x and ~"],
      [3, "/w/r/", "/h/u", "of /w/r: x", "of .: x"],
      [4, "/w/r/", "/h/u", "/w/r/src/a.ts", "./src/a.ts"],
      [5, "/w/r//", "/h/u//", "/w/r/a /h/u/b", "./a ~/b"],
      [6, "/w/r", "//", "/w/r/a http://x", "./a http://x"],
    ];
    for (const [n, repoRoot, homeDir, text, output] of rows) {
      const out = redact(text, { repoRoot, homeDir });
      expect(out, `row ${n}`).toBe(output);
      if (n === 1 || n === 2 || n === 5) expect(out.includes(bareHome), `row ${n} keeps ${bareHome}`).toBe(false);
    }

    const r = mulberry32(1030);
    for (let t = 0; t < METAMORPHIC_TRIALS; t++) {
      const c = genCase(r, t);
      const bare = redact(c.text, { repoRoot: c.root, homeDir: c.home });
      const slashed = redact(c.text, { repoRoot: `${c.root}/`, homeDir: `${c.home}/` });
      expect(slashed, describeCase(1030, t, c)).toBe(bare);
    }
  });
});

// ---------------------------------------------------------------------------
// WI-10/T22: the real CLI, run from a copy of the scripts in a sandbox dir
// that is not a git repo, so `computeSourceTree` fails naming its repo root.
// ---------------------------------------------------------------------------
function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(path.relative(dir, p));
    }
  };
  walk(dir);
  return out.sort();
}

describe("control:build CLI redaction (WI-14)", () => {
  let sb: GitSandbox;
  beforeEach(() => {
    sb = new GitSandbox();
  });
  afterEach(() => {
    sb.cleanup();
  });

  it("WI-10/T22 prints a failure with its repo root and HOME redacted, exit 1", () => {
    const home = path.join(sb.root, "home", "u");
    const copyRoot = path.join(home, "repo");
    const scriptsDir = path.join(copyRoot, "scripts", "control");
    fs.mkdirSync(scriptsDir, { recursive: true });
    const src = fileURLToPath(new URL("../../scripts/control", import.meta.url));
    for (const name of fs.readdirSync(src).filter((f) => f.endsWith(".mjs"))) {
      fs.copyFileSync(path.join(src, name), path.join(scriptsDir, name));
    }
    const before = listFilesRecursive(copyRoot);

    const env = {
      ...FIXED_GIT_ENV,
      PATH: process.env.PATH ?? "",
      HOME: home,
      TMPDIR: sb.tmp,
      GIT_CEILING_DIRECTORIES: sb.root,
    };
    const r = spawnSync(process.execPath, [path.join(scriptsDir, "build.mjs")], {
      cwd: sb.root,
      env,
      encoding: "utf8",
    });

    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toContain("source tree before the build: cannot compute the source tree of .:");
    expect(r.stderr).not.toContain(copyRoot);
    expect(r.stderr).not.toContain(home);
    expect(r.stderr).not.toContain(sb.root);
    expect(listFilesRecursive(copyRoot)).toEqual(before);
    expect(fs.readdirSync(sb.tmp)).toEqual([]);
  });
});
