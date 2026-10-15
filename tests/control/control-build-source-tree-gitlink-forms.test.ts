// @vitest-environment node
/**
 * WI-13 (ADR-0047 fix round, decision O20): every form of gitlink the scope
 * can reach is refused, whichever step would have added it; a symlink (mode
 * 120000) is not a gitlink and still resolves.
 * Matrix: `.claude/tdd-guardian/tests-20261002-201520.md`, unit WI-4, T42..T45.
 *
 * Every repo is a real `git init` under a `fs.mkdtempSync` root (see
 * `tests/helpers/controlGitRepo.ts`); none is the mdpro checkout.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitSandbox } from "../helpers/controlGitRepo";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { SourceTreeError, computeSourceTree } from "../../scripts/control/sourceTree.mjs";

type Result = { tree: string; excludes: string[] };
type Outcome = { ok: string } | { err: Error };

const compute = (repo: string): Promise<Result> => computeSourceTree(repo);
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

let sb: GitSandbox;

beforeEach(() => {
  sb = new GitSandbox();
  sb.stubEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
  sb.cleanup();
});

/** A committed nested repo at `<repo>/<rel>` holding one file. */
function nest(repo: string, rel: string, file: string, content: string): string {
  const n = path.join(repo, rel);
  fs.mkdirSync(n, { recursive: true });
  sb.git(n, ["init", "-q"]);
  sb.write(n, file, content);
  sb.git(n, ["add", "."]);
  sb.git(n, ["commit", "-qm", "n0"]);
  return n;
}

describe("WI-13 computeSourceTree gitlink forms (O20)", { timeout: 60_000 }, () => {
  it("WI-4/T42 a tracked gitlink under an ignored path is refused, before and after edits inside it", async () => {
    const repo = sb.mkRepo("t42");
    sb.write(repo, ".gitignore", "dist/\nvendor/\n");
    sb.commitAll(repo, "ignore vendor");
    const v = nest(repo, "vendor/sub", "g.txt", "V0");
    sb.git(repo, ["add", "-f", "vendor/sub"]);
    sb.git(repo, ["commit", "-qm", "force-embed"]);

    expect(sb.git(repo, ["ls-files", "-s", "--", "vendor/sub"])).toMatch(/^160000 [0-9a-f]{40} 0\tvendor\/sub\n?$/);
    // exit 0 means "ignored"; a non-zero exit throws here.
    sb.git(repo, ["check-ignore", "-q", "--no-index", "vendor/sub"]);

    const results: Outcome[] = [];
    results.push(await outcomeOf(repo));
    sb.write(v, "g.txt", "V1");
    results.push(await outcomeOf(repo));
    sb.git(v, ["add", "."]);
    sb.git(v, ["commit", "-qm", "v1"]);
    results.push(await outcomeOf(repo));

    expect(results.filter((r) => "ok" in r)).toEqual([]);
    for (const r of results) {
      const err = (r as { err: Error }).err;
      expect(err).toBeInstanceOf(SourceTreeError);
      expect(err.message).toContain("vendor/sub");
    }
  });

  it("WI-4/T43 (i) a nested repo with a separate git dir (.git is a file) is refused", async () => {
    const repo = sb.mkRepo("t43a");
    const w = path.join(repo, "src/w");
    fs.mkdirSync(w, { recursive: true });
    sb.git(w, ["init", "-q", "--separate-git-dir", path.join(sb.root, "t43a-sep")]);
    sb.write(w, "f.txt", "W0");
    sb.git(w, ["add", "."]);
    sb.git(w, ["commit", "-qm", "w0"]);

    expect(fs.lstatSync(path.join(w, ".git")).isFile()).toBe(true);
    expect(sb.git(repo, ["status", "--porcelain=v1", "-uall"]).split("\n")).toContain("?? src/w/");

    const e = await rejectionOf(repo);
    expect(e).toBeInstanceOf(SourceTreeError);
    expect((e as Error).message).toContain("src/w");
  });

  it("WI-4/T43 (ii) a linked worktree of a sibling repo (.git is a file) is refused", async () => {
    const sib = sb.mkRepo("t43b-sib");
    const repo = sb.mkRepo("t43b");
    const w2 = path.join(repo, "src/w2");
    sb.git(sib, ["worktree", "add", "-q", "--detach", w2]);

    expect(fs.lstatSync(path.join(w2, ".git")).isFile()).toBe(true);
    expect(sb.git(repo, ["status", "--porcelain=v1", "-uall"]).split("\n")).toContain("?? src/w2/");

    const e = await rejectionOf(repo);
    expect(e).toBeInstanceOf(SourceTreeError);
    expect((e as Error).message).toContain("src/w2");
  });

  it.each([
    { id: "space", p: "src/a b", forbidden: "src/a\\ b" },
    { id: "newline", p: "src/n\nl", forbidden: "src/n\\nl" },
    { id: "nonascii", p: "src/ü", forbidden: "\\303\\274" },
  ])("WI-4/T44 gitlink path with a $id is named as written", async ({ id, p, forbidden }) => {
    const repo = sb.mkRepo(`t44-${id}`);
    nest(repo, p, "f.txt", "N0");
    expect(sb.git(repo, ["status", "--porcelain=v1", "-z", "-uall"])).toContain(`?? ${p}/\0`);

    const e = await rejectionOf(repo);
    expect(e).toBeInstanceOf(SourceTreeError);
    expect((e as Error).message).toContain(p);
    expect((e as Error).message).not.toContain(forbidden);
  });

  it("WI-4/T45 committed symlinks are not gitlinks: the tree equals the oracle and moves with the link target", async () => {
    const repo = sb.mkRepo("t45");
    sb.write(repo, "lib/k.ts", "K0\n");
    fs.symlinkSync("a.ts", path.join(repo, "src/l"));
    fs.symlinkSync("f.txt", path.join(repo, "src/dl"));
    fs.symlinkSync("../lib", path.join(repo, "src/dir"));
    nest(repo, "dist/n", "f.txt", "D0");
    fs.symlinkSync("../dist/n", path.join(repo, "src/rl"));
    sb.commitAll(repo, "links");

    const linkLines = sb
      .git(repo, ["ls-files", "-s", "--", "src/l", "src/dl", "src/dir", "src/rl"])
      .split("\n")
      .filter(Boolean);
    expect(linkLines).toHaveLength(4);
    for (const line of linkLines) expect(line.startsWith("120000 ")).toBe(true);
    const allLines = sb.git(repo, ["ls-files", "-s"]).split("\n");
    expect(allLines.filter((l) => l.startsWith("160000 "))).toEqual([]);

    const oracle1 = sb.oracle(repo);
    const t1 = (await compute(repo)).tree;
    expect(t1).toBe(oracle1);

    fs.unlinkSync(path.join(repo, "src/l"));
    fs.symlinkSync("x.ts", path.join(repo, "src/l"));
    const t2 = (await compute(repo)).tree;
    sb.commitAll(repo, "retarget");
    const oracle2 = sb.oracle(repo);
    expect(t2).not.toBe(t1);
    expect(t2).toBe(oracle2);
  });
});
