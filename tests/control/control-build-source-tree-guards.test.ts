// @vitest-environment node
/**
 * WI-13 (ADR-0047 fix round): `computeSourceTree` refuses gitlinks.
 * Matrix: `.claude/tdd-guardian/tests-20261002-201520.md`, unit WI-4, T31..T38.
 *
 * Law: two different contents of the non-excluded worktree never yield one
 * tree, so any gitlink (mode 160000) in the finished temp index rejects. A
 * failed call leaves the temp dir and the real repo unchanged (T38).
 *
 * WI-19 (fix round): exclude validation, unit WI-4, T39..T40. One predicate
 * governs `computeSourceTree` and `computeBuildId`, and it runs before any git
 * process or temp dir.
 *
 * Every repo is a real `git init` under a `fs.mkdtempSync` root (see
 * `tests/helpers/controlGitRepo.ts`); none is the mdpro checkout.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitSandbox } from "../helpers/controlGitRepo";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { SourceTreeError, computeSourceTree, headCommit } from "../../scripts/control/sourceTree.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { BuildIdInputError, computeBuildId } from "../../scripts/control/buildId.mjs";

type Result = { tree: string; excludes: string[] };
type Outcome = { ok: string } | { err: Error };

const compute = (repo: string): Promise<Result> => computeSourceTree(repo);
/** The rejection value, or `null` when the call resolved. */
const rejectionOf = (repo: string): Promise<Error | null> =>
  compute(repo).then(
    () => null,
    (x: Error) => x,
  );
const outcomeOf = (repo: string): Promise<Outcome> =>
  compute(repo).then(
    (t) => ({ ok: t.tree }),
    (e: Error) => ({ err: e }),
  );

const GITLINK_LINE = (p: string) => new RegExp(`^160000 [0-9a-f]{40} 0\\t${p.replace(/\//g, "\\/")}\\n?$`);

let sb: GitSandbox;

beforeEach(() => {
  sb = new GitSandbox();
  sb.stubEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
  sb.cleanup();
});

/** A nested repo at `<repo>/<rel>` holding one file; committed unless `commit` is false. */
function nest(repo: string, rel: string, file: string, content: string, commit = true): string {
  const n = path.join(repo, rel);
  fs.mkdirSync(n, { recursive: true });
  sb.git(n, ["init", "-q"]);
  sb.write(n, file, content);
  if (commit) {
    sb.git(n, ["add", "."]);
    sb.git(n, ["commit", "-qm", "n0"]);
  }
  return n;
}

describe("WI-13 computeSourceTree gitlink refusal", { timeout: 60_000 }, () => {
  it("WI-4/T31 a committed nested repo at src/n is refused", async () => {
    const repo = sb.mkRepo("t31");
    nest(repo, "src/n", "f.txt", "N0");
    const e = await rejectionOf(repo);
    expect(e).toBeInstanceOf(SourceTreeError);
    expect((e as Error).message).toContain("src/n");
  });

  it("WI-4/T32 never one tree for three contents of a nested repo (C1 sequence)", async () => {
    const repo = sb.mkRepo("t32");
    const n = nest(repo, "src/n", "f.txt", "N0");
    const results: Outcome[] = [];
    results.push(await outcomeOf(repo));
    sb.write(n, "f.txt", "N1");
    results.push(await outcomeOf(repo));
    sb.write(n, "new.txt", "U");
    results.push(await outcomeOf(repo));
    expect(results.filter((r) => "ok" in r)).toEqual([]);
    for (const r of results) {
      const err = (r as { err: Error }).err;
      expect(err).toBeInstanceOf(SourceTreeError);
      expect(err.message).toContain("src/n");
    }
  });

  it("WI-4/T33 a tracked gitlink is refused", async () => {
    const repo = sb.mkRepo("t33");
    nest(repo, "src/sub", "g.txt", "S0");
    sb.git(repo, ["add", "src/sub"]);
    sb.git(repo, ["commit", "-qm", "embed"]);
    const lsOut = sb.git(repo, ["ls-files", "-s", "--", "src/sub"]);
    expect(lsOut).toMatch(GITLINK_LINE("src/sub"));
    const e = await rejectionOf(repo);
    expect(e).toBeInstanceOf(SourceTreeError);
    expect((e as Error).message).toContain("src/sub");
  });

  it("WI-4/T34 two gitlinks are both named", async () => {
    const repo = sb.mkRepo("t34");
    nest(repo, "src/n", "f.txt", "N0");
    nest(repo, "lib/m", "f.txt", "M0");
    const e = await rejectionOf(repo);
    expect(e).toBeInstanceOf(SourceTreeError);
    expect((e as Error).message).toContain("src/n");
    expect((e as Error).message).toContain("lib/m");
  });

  it("WI-4/T35 a nested repo with no commit is refused (existing behaviour pinned)", async () => {
    const repo = sb.mkRepo("t35");
    nest(repo, "src/n", "f.txt", "N0", false);
    const e = await rejectionOf(repo);
    expect(e).toBeInstanceOf(SourceTreeError);
    expect((e as Error).message).toContain("src/n");
  });

  it("WI-4/T36 a committed nested repo under an ignored directory still resolves", async () => {
    const repo = sb.mkRepo("t36");
    expect(fs.readFileSync(path.join(repo, ".gitignore"), "utf8")).toBe("dist/\n");
    nest(repo, "dist/n", "f.txt", "D0");
    const result = await compute(repo);
    expect(result.tree).toBe(sb.oracle(repo));
    expect(result.excludes).toEqual([".claude/", "docs/", "**/*.tsbuildinfo"]);
  });

  it("WI-4/T37 a tracked gitlink under docs/ does not move or break the tree", async () => {
    const repo = sb.mkRepo("t37");
    const h0 = (await compute(repo)).tree;
    nest(repo, "docs/sub", "g.txt", "S0");
    sb.git(repo, ["add", "docs/sub"]);
    sb.git(repo, ["commit", "-qm", "docs-embed"]);
    expect(sb.git(repo, ["ls-files", "-s", "--", "docs/sub"])).toMatch(GITLINK_LINE("docs/sub"));
    expect((await compute(repo)).tree).toBe(h0);
  });

  it("WI-4/T38 a refused call changes nothing", async () => {
    const repo = sb.mkRepo("t38");
    nest(repo, "src/n", "f.txt", "N0");
    vi.stubEnv("TMPDIR", sb.tmp);
    const before = sb.snapshotRepo(repo);
    const e = await rejectionOf(repo);
    expect(e).toBeInstanceOf(SourceTreeError);
    expect(fs.readdirSync(sb.tmp)).toEqual([]);
    expect(sb.snapshotRepo(repo)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// WI-19: exclude validation (T39, T40)
// ---------------------------------------------------------------------------

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

const ID_BASE = {
  sourceTree: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
  sourceTreeExcludes: [".claude/", "docs/", "**/*.tsbuildinfo"],
  profile: "release",
  features: [] as string[],
  sidecarSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
};

const treeRejection = (repo: string, excludes: unknown[]): Promise<Error | null> =>
  computeSourceTree(repo, { excludes }).then(
    () => null,
    (x: Error) => x,
  );

describe("WI-19 computeSourceTree exclude validation", { timeout: 60_000 }, () => {
  it("WI-4/T39 the seven invalid excludes are refused before any git call", async () => {
    vi.stubEnv("TMPDIR", sb.tmp);
    const repo = sb.mkRepo("t39");
    const plain = sb.dir("t39-plain");
    const rows: unknown[] = ["", "/abs", "a\u0000b", 42 as unknown as string, "..", "../x", "a/../b"];
    for (const [i, row] of rows.entries()) {
      for (const [where, dir] of [
        ["repo", repo],
        ["plain", plain],
      ] as const) {
        const e = await treeRejection(dir, [row]);
        const label = `row ${i + 1} ${JSON.stringify(row)} against ${where}`;
        expect(e, label).toBeInstanceOf(SourceTreeError);
        expect((e as Error).message, label).toContain("invalid exclude");
      }
    }
    expect(fs.readdirSync(sb.tmp)).toEqual([]);
  });

  it(
    "WI-4/T40 computeSourceTree and computeBuildId agree on exclude validity (seed 4040, 43 candidates)",
    { timeout: 30_000 },
    async () => {
      const repo = sb.mkRepo("t40");
      const forced = ["..", "../x", "a/..", "a/../b", "/a", "/", "a", "*", "a b", '"', "a..b", "...", "."];
      const alphabet = [..."ab/.*\u0000 \""];
      const r = mulberry32(4040);
      const generated = Array.from({ length: 30 }, () => {
        const len = 1 + Math.floor(r() * 6);
        let c = Array.from({ length: len }, () => alphabet[Math.floor(r() * alphabet.length)]).join("");
        if (r() < 0.15) c = `../${c}`;
        if (r() < 0.15) c = `/${c}`;
        return c;
      });
      const candidates = [...forced, ...generated];
      expect(candidates).toHaveLength(43);

      let invalid = 0;
      let valid = 0;
      for (const [i, c] of candidates.entries()) {
        const e = await treeRejection(repo, [c]);
        const stRejectsInvalid = e !== null && e.message.includes("invalid exclude");
        let idThrows = false;
        try {
          computeBuildId({ ...ID_BASE, sourceTreeExcludes: [c] });
        } catch (err) {
          idThrows = err instanceof BuildIdInputError;
        }
        expect(stRejectsInvalid, `seed 4040 candidate ${i} ${JSON.stringify(c)}`).toBe(idThrows);
        if (idThrows) invalid++;
        else valid++;
      }
      expect(invalid).toBeGreaterThan(0);
      expect(valid).toBeGreaterThan(0);
    },
  );
});

// ---------------------------------------------------------------------------
// WI-21: headCommit outside any repo (WI-4/T41, a pin)
// ---------------------------------------------------------------------------
describe("WI-21 headCommit outside a repo", { timeout: 30_000 }, () => {
  it("WI-4/T41 headCommit on a plain directory rejects with SourceTreeError naming the dir", async () => {
    const d = sb.dir("plain");
    const e = await (headCommit(d) as Promise<string | null>).then(
      () => null,
      (x: Error) => x,
    );
    expect(e).toBeInstanceOf(SourceTreeError);
    expect((e as Error).message).toContain(`cannot read HEAD of ${d}`);
  });
});
