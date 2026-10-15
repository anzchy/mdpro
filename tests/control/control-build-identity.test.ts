// @vitest-environment node
/**
 * WI-4 (ADR-0047): `computeSourceTree` — the git tree of the non-excluded
 * worktree content, computed through an empty temporary index.
 * Matrix: `.claude/tdd-guardian/tests-20261002-155158.md`, unit WI-4, T01..T30.
 *
 * Every repo is a real `git init` under a `fs.mkdtempSync` root (see
 * `tests/helpers/controlGitRepo.ts`); the oracle is git's own
 * `rev-parse HEAD^{tree}` after committing the same content.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitSandbox } from "../helpers/controlGitRepo";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { DEFAULT_EXCLUDES, computeSourceTree } from "../../scripts/control/sourceTree.mjs";

type Result = { tree: string; excludes: string[] };
const compute = (repo: string, options?: { excludes: string[] }): Promise<Result> =>
  computeSourceTree(repo, options);
const treeOf = async (repo: string, options?: { excludes: string[] }) => (await compute(repo, options)).tree;

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const DEFAULTS = [".claude/", "docs/", "**/*.tsbuildinfo"];

let sb: GitSandbox;

beforeEach(() => {
  sb = new GitSandbox();
  sb.stubEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
  sb.cleanup();
});

/** `mkRepo` plus a committed tracked-but-ignored `build/keep.txt` (the T07 repo). */
function mkTrackedIgnoredRepo(name: string): string {
  const repo = sb.mkRepo(name);
  sb.write(repo, "build/keep.txt", "k0");
  sb.git(repo, ["add", "-f", "build/keep.txt"]);
  sb.write(repo, ".gitignore", "dist/\nbuild/\n");
  sb.commitAll(repo, "keep");
  return repo;
}

describe("WI-4 computeSourceTree", { timeout: 60_000 }, () => {
  it("WI-4/T01 clean committed repo equals git's own tree (independent oracle)", async () => {
    const repo = sb.mkRepo("r");
    const tree = await treeOf(repo);
    expect(tree).toMatch(HEX40);
    expect(tree).toBe(sb.oracle(repo));
  });

  it("WI-4/T02 determinism on a dirty tree", async () => {
    const repo = sb.mkRepo("r");
    sb.write(repo, "src/a.ts", "A1\n");
    sb.write(repo, "src/n.ts", "N\n");
    const t1 = await treeOf(repo);
    const t2 = await treeOf(repo);
    expect(t1).toMatch(HEX40);
    expect(t1).not.toBe(sb.oracle(repo));
    expect(t2).toBe(t1);
  });

  it("WI-4/T03 acceptance 1 tree-level cases are pairwise distinct, and revert round-trips", async () => {
    const repo = sb.mkRepo("r");
    const h0 = await treeOf(repo);
    sb.write(repo, "src/a.ts", "A1\n");
    const hA = await treeOf(repo);
    sb.write(repo, "src/a.ts", "A2\n");
    const hB = await treeOf(repo);
    sb.write(repo, "src/a.ts", "A1\n");
    sb.write(repo, "src/a.ts", "A0\n");
    const hR = await treeOf(repo);
    sb.write(repo, "src/x.ts", "X1\n");
    const hF = await treeOf(repo);
    sb.write(repo, "src/x.ts", "X0\n");
    sb.write(repo, "src/new.ts", "new\n");
    const hN = await treeOf(repo);
    expect(new Set([h0, hA, hB, hF, hN]).size).toBe(5);
    expect(hR).toBe(h0);
    expect(h0).toBe(sb.oracle(repo));
  });

  it("WI-4/T04 staging independence", async () => {
    const repo = sb.mkRepo("r");
    sb.write(repo, "src/a.ts", "A2\n");
    const unstaged = await treeOf(repo);
    sb.git(repo, ["add", "src/a.ts"]);
    const staged = await treeOf(repo);
    sb.git(repo, ["reset", "-q"]);
    sb.write(repo, "src/a.ts", "A1\n");
    sb.git(repo, ["add", "src/a.ts"]);
    sb.write(repo, "src/a.ts", "A2\n");
    const partly = await treeOf(repo);
    sb.commitAll(repo, "A2");
    const oracle = sb.oracle(repo);
    expect(unstaged).toBe(oracle);
    expect(staged).toBe(oracle);
    expect(partly).toBe(oracle);
  });

  it("WI-4/T05 deleting a tracked file", async () => {
    const repo = sb.mkRepo("r");
    const h0 = sb.oracle(repo);
    fs.rmSync(path.join(repo, "src/x.ts"));
    const tree = await treeOf(repo);
    expect(tree).not.toBe(h0);
    sb.git(repo, ["rm", "-q", "src/x.ts"]);
    sb.git(repo, ["commit", "-q", "-m", "rm"]);
    expect(tree).toBe(sb.oracle(repo));
  });

  it("WI-4/T06 ignored untracked file is invisible", async () => {
    const repo = sb.mkRepo("r");
    sb.write(repo, "dist/out.js", "out\n");
    expect(await treeOf(repo)).toBe(sb.oracle(repo));
  });

  it("WI-4/T07 a tracked-but-ignored file is in the tree, and its edits count", async () => {
    const repo = mkTrackedIgnoredRepo("r");
    const hK0 = sb.oracle(repo);
    expect(sb.git(repo, ["ls-tree", "-r", "--name-only", "HEAD"])).toContain("build/keep.txt");
    expect(await treeOf(repo)).toBe(hK0);
    sb.write(repo, "build/keep.txt", "k1");
    const edited = await treeOf(repo);
    expect(edited).not.toBe(hK0);
    sb.git(repo, ["commit", "-q", "-am", "k1"]);
    expect(edited).toBe(sb.oracle(repo));
  });

  it("WI-4/T08 default excludes are invisible and root-anchored", async () => {
    const repo = sb.mkRepo("r");
    const base = sb.oracle(repo);
    sb.write(repo, "docs/old.md", "old\n");
    sb.write(repo, ".claude/s.json", "{}\n");
    sb.commitAll(repo, "excluded");
    const hE = await treeOf(repo);
    expect(hE, "baseline equals the tree without the excluded roots").toBe(base);

    const add = (rel: string) => () => {
      sb.write(repo, rel, "x\n");
      return () => fs.rmSync(path.join(repo, rel));
    };
    const modify = (rel: string) => () => {
      const before = fs.readFileSync(path.join(repo, rel), "utf8");
      sb.write(repo, rel, `${before}changed\n`);
      return () => sb.write(repo, rel, before);
    };
    const invisible: Array<[string, () => () => void]> = [
      ["modify docs/old.md", modify("docs/old.md")],
      ["add untracked docs/new.md", add("docs/new.md")],
      ["modify .claude/s.json", modify(".claude/s.json")],
      ["add .claude/n.json", add(".claude/n.json")],
      ["add a/b/tsconfig.x.tsbuildinfo", add("a/b/tsconfig.x.tsbuildinfo")],
      ["add tsconfig.node.tsbuildinfo", add("tsconfig.node.tsbuildinfo")],
    ];
    for (const [name, apply] of invisible) {
      const revert = apply();
      expect(await treeOf(repo), `invisible row: ${name}`).toBe(hE);
      revert();
    }

    sb.write(repo, "x.tsbuildinfo", "t0\n");
    sb.git(repo, ["add", "-f", "x.tsbuildinfo"]);
    expect(await treeOf(repo), "invisible row: tracked x.tsbuildinfo added").toBe(hE);
    sb.write(repo, "x.tsbuildinfo", "t1\n");
    expect(await treeOf(repo), "invisible row: tracked x.tsbuildinfo modified").toBe(hE);
    sb.commitAll(repo, "tracked tsbuildinfo");
    expect(await treeOf(repo), "invisible row: tracked x.tsbuildinfo committed").toBe(hE);

    const visible = ["docsx/file", "src/docs/file", "src/.claude/file", "x.tsbuildinfo.bak"];
    for (const rel of visible) {
      const revert = add(rel)();
      expect(await treeOf(repo), `visible row: ${rel}`).not.toBe(hE);
      revert();
    }

    // docs/gen: tracked, ignored, and under an excluded root.
    sb.write(repo, ".gitignore", "dist/\ndocs/gen/\n");
    sb.write(repo, "docs/gen/keep.txt", "g0\n");
    sb.git(repo, ["add", "-f", "docs/gen/keep.txt"]);
    sb.commitAll(repo, "docs gen");
    const hE1 = await treeOf(repo);
    sb.write(repo, "docs/gen/keep.txt", "g1\n");
    expect(await treeOf(repo), "invisible row: tracked-ignored docs/gen/keep.txt").toBe(hE1);

    // H8: tracked and ignored, kept out only by the glob exclude.
    sb.write(repo, ".gitignore", "dist/\ndocs/gen/\n*.tsbuildinfo\n");
    sb.write(repo, "a/x.tsbuildinfo", "t0");
    sb.git(repo, ["add", "-f", "a/x.tsbuildinfo"]);
    sb.commitAll(repo, "h8");
    const hE2 = await treeOf(repo);
    const never = sb.copy(repo, "never-added");
    sb.git(never, ["rm", "-q", "--cached", "a/x.tsbuildinfo"]);
    fs.rmSync(path.join(never, "a/x.tsbuildinfo"));
    expect(await treeOf(never), "H8: the glob-excluded file is absent, not frozen").toBe(hE2);
    sb.write(repo, "a/x.tsbuildinfo", "t1");
    expect(await treeOf(repo), "invisible row: H8 tracked-ignored a/x.tsbuildinfo").toBe(hE2);
  });

  it("WI-4/T09 excluded content is absent from the tree, not merely frozen", async () => {
    const r1 = sb.mkRepo("r1");
    sb.write(r1, "docs/old.md", "old\n");
    sb.commitAll(r1, "docs");
    const r2 = sb.mkRepo("r2");
    expect(await treeOf(r1)).toBe(sb.oracle(r2));
  });

  it("WI-4/T10 custom excludes replace the default list", async () => {
    const repo = sb.mkRepo("r");
    const opts = { excludes: ["src/gen/"] };
    const base = await compute(repo, opts);
    expect(base.tree).toBe(sb.oracle(repo));
    expect(base.excludes).toEqual(["src/gen/"]);
    sb.write(repo, "src/gen/a.ts", "gen\n");
    expect(await treeOf(repo, opts), "src/gen/a.ts is excluded").toBe(base.tree);
    fs.rmSync(path.join(repo, "src/gen"), { recursive: true });
    sb.write(repo, "docs/z.md", "z\n");
    expect(await treeOf(repo, opts), "docs/ is no longer excluded").not.toBe(base.tree);
  });

  it("WI-4/T11 return shape and the default list", async () => {
    const repo = sb.mkRepo("r");
    const result = await compute(repo);
    expect(DEFAULT_EXCLUDES).toEqual([".claude/", "docs/", "**/*.tsbuildinfo"]);
    expect(result.excludes).toEqual([".claude/", "docs/", "**/*.tsbuildinfo"]);
    expect(Object.keys(result).sort()).toEqual(["excludes", "tree"]);
    expect(result.tree).toBe(sb.oracle(repo));
  });

  it("WI-4/T12 the real index and object store are untouched", async () => {
    const repo = mkTrackedIgnoredRepo("r");
    sb.write(repo, "src/a.ts", "A1\n");
    sb.git(repo, ["add", "src/a.ts"]);
    sb.write(repo, "src/a.ts", "A2\n");
    sb.write(repo, "src/n.ts", "N\n");
    sb.write(repo, "dist/o.js", "o\n");
    sb.git(repo, ["update-index", "--assume-unchanged", "src/x.ts"]);
    sb.git(repo, ["update-index", "-q", "--refresh"], { allowFail: true });

    const control1 = sb.snapshotRepo(repo);
    const control2 = sb.snapshotRepo(repo);
    expect(control2, "the snapshot helper itself is inert").toEqual(control1);
    expect(control1.lsFilesV).toMatch(/^h src\/x\.ts$/m);

    const before = sb.snapshotRepo(repo);
    const result = await compute(repo);
    const after = sb.snapshotRepo(repo);
    expect(after).toEqual(before);
    expect(result.tree).toMatch(HEX40);
    expect(result.tree).not.toBe(sb.oracle(repo));
  });

  it.skipIf(process.getuid?.() === 0)(
    "WI-4/T13 failure mid-run: no side effects, temp dir removed, clear error",
    async () => {
      const repo = sb.mkRepo("r");
      const secret = path.join(repo, "src/secret.ts");
      sb.write(repo, "src/secret.ts", "secret\n");
      fs.chmodSync(secret, 0o000);
      try {
        const before = sb.snapshotRepo(repo);
        vi.stubEnv("TMPDIR", sb.tmp);
        const error = await compute(repo).then(
          () => null,
          (e: unknown) => e,
        );
        expect(error).toBeInstanceOf(Error);
        const message = (error as Error).message;
        expect(message.includes(repo) || message.includes("secret.ts")).toBe(true);
        expect(sb.snapshotRepo(repo)).toEqual(before);
        expect(fs.readdirSync(sb.tmp)).toEqual([]);
      } finally {
        fs.chmodSync(secret, 0o644);
      }
    },
  );

  it("WI-4/T14 inherited repo-local git env vars are scrubbed", async () => {
    const p = sb.mkRepo("P");
    const o = sb.mkRepo("O");
    sb.write(o, "ignore-src", "src/\n");
    sb.write(p, "src/n.ts", "N\n");
    const clean = await treeOf(p);
    expect(clean).toMatch(HEX40);
    expect(clean).not.toBe(sb.oracle(p));

    const beforeP = sb.snapshotRepo(p);
    const beforeO = sb.snapshotRepo(o);
    const hostile: Record<string, string> = {
      GIT_INDEX_FILE: sb.indexPath(p),
      GIT_DIR: path.join(o, ".git"),
      GIT_WORK_TREE: o,
      GIT_OBJECT_DIRECTORY: path.join(o, ".git", "objects"),
      GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(o, ".git", "objects"),
      GIT_COMMON_DIR: path.join(o, ".git"),
      GIT_CONFIG_PARAMETERS: `'core.excludesfile'='${path.join(o, "ignore-src")}'`,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.excludesFile",
      GIT_CONFIG_VALUE_0: path.join(o, "ignore-src"),
    };
    for (const [k, v] of Object.entries(hostile)) vi.stubEnv(k, v);
    const tree = await treeOf(p);
    vi.unstubAllEnvs();
    sb.stubEnv();

    expect(tree).toBe(clean);
    expect(sb.snapshotRepo(p)).toEqual(beforeP);
    expect(sb.snapshotRepo(o)).toEqual(beforeO);
  });

  it("WI-4/T15 repo with no commits and no index", async () => {
    const repo = sb.init("r");
    sb.write(repo, "src/a.ts", "A0\n");
    const index = sb.indexPath(repo);
    expect(fs.existsSync(index)).toBe(false);
    const tree = await treeOf(repo);
    expect(fs.existsSync(index), "the real index was not created").toBe(false);
    expect(tree).toMatch(HEX40);
    sb.commitAll(repo, "first");
    expect(sb.oracle(repo)).toBe(tree);
  });

  it("WI-4/T16 empty content gives git's empty tree", async () => {
    const empty = sb.init("empty");
    const onlyExcluded = sb.init("only-excluded");
    sb.write(onlyExcluded, "docs/a.md", "a\n");
    sb.write(onlyExcluded, ".claude/b.json", "{}\n");
    expect(await treeOf(empty)).toBe(EMPTY_TREE);
    expect(await treeOf(onlyExcluded)).toBe(EMPTY_TREE);
  });

  it("WI-4/T17 linked worktree", async () => {
    const m = sb.mkRepo("M");
    const wt = path.join(sb.root, "wt");
    sb.git(m, ["worktree", "add", "-q", wt, "-b", "wt"]);
    sb.register(wt);
    expect(sb.indexPath(wt)).not.toBe(sb.indexPath(m));
    const beforeM = sb.snapshotRepo(m);
    const beforeWt = sb.snapshotRepo(wt);

    const fromWt = await treeOf(wt);
    const fromM = await treeOf(m);
    expect(fromM).toBe(sb.oracle(m));
    expect(fromWt).toBe(fromM);
    expect(sb.snapshotRepo(wt)).toEqual(beforeWt);

    sb.write(wt, "src/a.ts", "WT\n");
    expect(await treeOf(wt)).not.toBe(fromM);
    expect(await treeOf(m)).toBe(fromM);
    const afterWt = sb.snapshotRepo(wt);
    expect([afterWt.indexBytes, afterWt.indexMtimeMs]).toEqual([beforeWt.indexBytes, beforeWt.indexMtimeMs]);
    expect(sb.snapshotRepo(m)).toEqual(beforeM);
  });

  it("WI-4/T18 outside a git repo", async () => {
    const n = sb.dir("plain");
    vi.stubEnv("TMPDIR", sb.tmp);
    let p: Promise<Result> | undefined;
    expect(() => {
      p = compute(n);
    }).not.toThrow();
    await expect(p).rejects.toThrow(n);
    expect(fs.readdirSync(sb.tmp)).toEqual([]);
  });

  it("WI-4/T19 temp dir is removed after success", async () => {
    const repo = sb.mkRepo("r");
    vi.stubEnv("TMPDIR", sb.tmp);
    const tree = await treeOf(repo);
    expect(fs.readdirSync(sb.tmp)).toEqual([]);
    expect(tree).toBe(sb.oracle(repo));
  });

  it("WI-4/T20 SHA-256 object-format repo", async () => {
    const repo = sb.mkRepo("r", ["--object-format=sha256"]);
    const tree = await treeOf(repo);
    expect(tree).toMatch(HEX64);
    expect(tree).toBe(sb.oracle(repo));
  });

  it("WI-4/T21 spaces and unicode in paths", async () => {
    const repo = sb.init("my repo é");
    sb.write(repo, "src/a b.ts", "ab\n");
    sb.write(repo, ".gitignore", "build/\n");
    sb.write(repo, "build/k é.txt", "k\n");
    sb.git(repo, ["add", "-A"]);
    sb.git(repo, ["add", "-f", "build/k é.txt"]);
    sb.git(repo, ["commit", "-q", "-m", "unicode"]);
    expect(sb.git(repo, ["ls-tree", "-r", "-z", "--name-only", "HEAD"]).split("\0")).toContain("build/k é.txt");
    const before = await treeOf(repo);
    expect(before).toBe(sb.oracle(repo));
    sb.write(repo, "src/a b.ts", "ab2\n");
    expect(await treeOf(repo)).not.toBe(before);
  });

  it("WI-4/T22 concurrent calls do not share a temp index", async () => {
    const repo = sb.mkRepo("r");
    sb.write(repo, "src/a.ts", "A1\n");
    sb.write(repo, "src/n.ts", "N\n");
    vi.stubEnv("TMPDIR", sb.tmp);
    const before = sb.snapshotRepo(repo);
    const trees = (await Promise.all([1, 2, 3, 4].map(() => treeOf(repo)))) as string[];
    const after = sb.snapshotRepo(repo);
    expect(new Set(trees).size).toBe(1);
    expect(trees[0]).toMatch(HEX40);
    expect(trees[0]).not.toBe(sb.oracle(repo));
    expect(after).toEqual(before);
    expect(fs.readdirSync(sb.tmp)).toEqual([]);
  });

  /** An unflagged `mkRepo` with `src/x.ts`="X9\n"; returns [computed tree, oracle after commit]. */
  async function unflaggedX9(name: string): Promise<[string, string]> {
    const twin = sb.mkRepo(name);
    sb.write(twin, "src/x.ts", "X9\n");
    const tree = await treeOf(twin);
    sb.git(twin, ["commit", "-q", "-am", "X9"]);
    return [tree, sb.oracle(twin)];
  }

  it("WI-4/T23 an --assume-unchanged file's edit still changes the tree", async () => {
    const repo = sb.mkRepo("r");
    const h0 = sb.oracle(repo);
    sb.git(repo, ["update-index", "--assume-unchanged", "src/x.ts"]);
    sb.write(repo, "src/x.ts", "X9\n");
    const tree = await treeOf(repo);
    const [twinTree, twinOracle] = await unflaggedX9("twin");
    expect(tree).not.toBe(h0);
    expect(tree).toBe(twinTree);
    expect(twinTree).toBe(twinOracle);
    expect(sb.git(repo, ["ls-files", "-v", "src/x.ts"])).toMatch(/^h /);
  });

  it("WI-4/T24 a --skip-worktree file's edit still changes the tree", async () => {
    const repo = sb.mkRepo("r");
    const h0 = sb.oracle(repo);
    sb.git(repo, ["update-index", "--skip-worktree", "src/x.ts"]);
    sb.write(repo, "src/x.ts", "X9\n");
    const tree = await treeOf(repo);
    const [twinTree, twinOracle] = await unflaggedX9("twin");
    expect(tree).not.toBe(h0);
    expect(tree).toBe(twinTree);
    expect(twinTree).toBe(twinOracle);
    expect(sb.git(repo, ["ls-files", "-v", "src/x.ts"])).toMatch(/^S /);
  });

  it("WI-4/T25 a same-size edit with an unchanged mtime still changes the tree", async () => {
    const repo = sb.mkRepo("r");
    const h0 = sb.oracle(repo);
    const file = path.join(repo, "src/x.ts");
    const st = fs.statSync(file);
    sb.git(repo, ["update-index", "-q", "--refresh"]);
    fs.writeFileSync(file, "Y0\n");
    fs.utimesSync(file, st.atime, st.mtime);
    expect(fs.statSync(file).size).toBe(st.size);
    // utimes takes a Date (ms precision, then a float round trip); allow that slack.
    expect(Math.abs(fs.statSync(file).mtimeMs - st.mtimeMs)).toBeLessThan(2);
    const tree = await treeOf(repo);

    const clone = path.join(sb.root, "clone");
    sb.git(sb.root, ["clone", "-q", repo, clone]);
    sb.write(clone, "src/x.ts", "Y0\n");
    sb.git(clone, ["commit", "-q", "-am", "Y0"]);
    expect(tree).not.toBe(h0);
    expect(tree).toBe(sb.oracle(clone));
  });

  it("WI-4/T26 an untracked nested git repository under an excluded root is ignored without error", async () => {
    const repo = sb.mkRepo("r");
    const h0 = sb.oracle(repo);
    const agent = path.join(repo, ".claude/worktrees/agent-1");
    fs.mkdirSync(agent, { recursive: true });
    sb.git(agent, ["init", "-q", "-b", "main"]);
    sb.write(agent, "f.txt", "f\n");
    sb.git(agent, ["add", "f.txt"]);
    sb.git(agent, ["commit", "-q", "-m", "nested"]);
    const docsSub = path.join(repo, "docs/sub");
    fs.mkdirSync(docsSub, { recursive: true });
    sb.git(docsSub, ["init", "-q", "-b", "main"]);
    sb.write(docsSub, "g.txt", "g\n");

    const before = sb.snapshotRepo(repo);
    const tree = await treeOf(repo);
    expect(tree).toBe(h0);
    expect(sb.snapshotRepo(repo)).toEqual(before);
  });

  it("WI-4/T27 a tracked-but-ignored file deleted from the worktree leaves the tree", async () => {
    const repo = mkTrackedIgnoredRepo("r");
    const hK0 = sb.oracle(repo);
    fs.rmSync(path.join(repo, "build/keep.txt"));
    const tree = await treeOf(repo);

    const copy = sb.copy(repo, "copy");
    sb.git(copy, ["rm", "-q", "--cached", "build/keep.txt"]);
    sb.git(copy, ["commit", "-q", "-m", "rm keep"]);
    expect(tree).not.toBe(hK0);
    expect(tree).toBe(sb.oracle(copy));
    expect(sb.git(repo, ["ls-files", "build/keep.txt"]).trim()).toBe("build/keep.txt");
  });

  it("WI-4/T28 GIT_CONFIG_GLOBAL passes through, so a global excludes file applies", async () => {
    const repo = sb.mkRepo("r");
    const h0 = sb.oracle(repo);
    sb.write(repo, "src/n.ts", "N\n");
    const g = sb.dir("G");
    sb.write(g, "ignore", "src/n.ts\n");
    sb.write(g, "gitconfig", `[core]\n\texcludesFile = ${path.join(g, "ignore")}\n`);

    const withoutGlobal = await treeOf(repo);
    expect(withoutGlobal).toMatch(HEX40);
    expect(withoutGlobal).not.toBe(h0);

    vi.stubEnv("GIT_CONFIG_GLOBAL", path.join(g, "gitconfig"));
    const withGlobal = await treeOf(repo);
    expect(withGlobal).toBe(h0);
    const status = sb.git(repo, ["status", "--porcelain", "-uall"], {
      env: { GIT_CONFIG_GLOBAL: path.join(g, "gitconfig") },
    });
    expect(status).not.toContain("src/n.ts");
  });

  it("WI-4/T29 the API is asynchronous", async () => {
    const repo = sb.mkRepo("r");
    const p = compute(repo);
    expect(p).toBeInstanceOf(Promise);
    expect(await p).toEqual({ tree: sb.oracle(repo), excludes: DEFAULTS });
  });

  it("WI-4/T30 the executable bit is part of the tree", async () => {
    const repo = sb.mkRepo("r");
    expect(sb.git(repo, ["config", "core.fileMode"]).trim()).toBe("true");
    const script = path.join(repo, "scripts/r.sh");
    sb.write(repo, "scripts/r.sh", "#!/bin/sh\n");
    fs.chmodSync(script, 0o755);
    sb.commitAll(repo, "script");
    expect(sb.git(repo, ["ls-tree", "HEAD", "scripts/r.sh"])).toMatch(/^100755 /);

    const t1 = await treeOf(repo);
    expect(t1).toBe(sb.oracle(repo));
    fs.chmodSync(script, 0o644);
    const t2 = await treeOf(repo);
    const copy = sb.copy(repo, "copy");
    sb.git(copy, ["commit", "-q", "-am", "mode"]);
    fs.chmodSync(script, 0o755);
    const t3 = await treeOf(repo);
    expect(t2).not.toBe(t1);
    expect(t2).toBe(sb.oracle(copy));
    expect(t3).toBe(t1);
  });
});
