// @vitest-environment node
/**
 * The D180 verifier's probe list, kept as a regression file
 * (~/.mdpro-redesign/reviews/d180-verifier-probes-8bc6a83.md, mdpro-landing-verifier
 * on 8bc6a83, 2026-10-12). Commands are copied verbatim; `<scratch main>` is the
 * scratch repo's main checkout.
 *
 * Setup: a scratch repo `repo` with `master` checked out and a linked worktree
 * `fix-x` on `fix/x`; every probe runs from `fix-x` as MDPRO_ROLE=implementor.
 * Exit 2 = denied, 0 = allowed. The last extra probe,
 * `git -c rebase.updateRefs=true rebase master`, was allowed on 8bc6a83 and is
 * D184 (b): it must be denied.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { HOOK, bashInput, makeMainWithWorktree, makeRoot, runHook, runHookAt } from "../support/roleGuardHarness";

const root = makeRoot("role-guard-d180-probes-");
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const { main, fixX } = makeMainWithWorktree(root);

const run = (role: string | undefined, command: string) => runHook(role, bashInput(command, fixX), fixX);

/** The 28 rows: [command, expected exit] */
const PROBES: Array<[string, 0 | 2]> = [
  ["git branch -f master HEAD", 2],
  ["bash -lc 'git branch -f master HEAD'", 2],
  ["bash -ec 'git branch -f master HEAD'", 2],
  ["bash -l -c 'git branch -f master HEAD'", 2],
  ["env -u FOO git branch -f master HEAD", 2],
  ["git fetch . HEAD:heads/master", 2],
  ["git fetch . +HEAD:heads/release/x", 2],
  ["git fetch --update-head-ok --refmap=+refs/heads/fix/x:refs/heads/master . fix/x", 2],
  ["git fetch origin '+refs/heads/release/0.*:refs/heads/release/0.*'", 2],
  ["git rebase HEAD master", 2],
  ["git rebase --update-refs master", 2],
  ["git symbolic-ref refs/heads/master refs/heads/fix/x", 2],
  ["git checkout master && git reset --hard HEAD~1", 2],
  ["git worktree add ../w master && git -C ../w reset --hard HEAD~1", 2],
  [`git --git-dir=${main}/.git update-ref HEAD HEAD~1`, 2],
  ["git status", 0],
  ["git add src/a.ts", 0],
  ["git commit -m x", 0],
  ["git rebase master", 0],
  ["git fetch origin", 0],
  ["git fetch origin master", 0],
  ["git branch -f --list master", 0],
  ["git branch -f fix/other HEAD", 0],
  ["bash -lc 'git status'", 0],
  ["git worktree add ../x -b fix/x master", 0],
  ["git checkout -b fix/y master", 0],
  ["git log master", 0],
  ["git diff-tree master", 0],
];

/** The verifier's extra probes, all denied (the last one since D184). */
const EXTRA_DENIED: string[] = [
  "sh -c 'cd ../repo && git reset --hard HEAD~1'",
  "git pull . fix/x:master",
  "GIT_DIR=../repo/.git git update-ref HEAD HEAD~1",
  "git branch -M fix/x master",
  "git branch --force master HEAD",
  "git -C ../repo commit --amend",
  "zsh -xc 'git branch -f master HEAD'",
  "git worktree add -B master ../w2",
  "git switch -C master",
  "git checkout -B master",
  "(git branch -f master HEAD)",
  "echo $(git branch -f master HEAD)",
  "git fetch . HEAD:master",
];
const D184_EXTRA = "git -c rebase.updateRefs=true rebase master";

describe("D180 verifier probes (8bc6a83), implementor from fix/x", () => {
  it.each(PROBES)("%s exits %d", (command, expected) => {
    const r = run("implementor", command);
    expect(r.status).toBe(expected);
    if (expected === 0) expect(r.stderr).toBe("");
    else expect(r.stderr).toMatch(/^Blocked by role-guard \(implementor\): /);
  });

  it.each(EXTRA_DENIED)("extra probe %s is denied", (command) => {
    const r = run("implementor", command);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^Blocked by role-guard \(implementor\): /);
  });

  it(`extra probe ${D184_EXTRA} is denied (D184 b)`, () => {
    const r = run("implementor", D184_EXTRA);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^Blocked by role-guard \(implementor\): /);
  });
});

describe("D180 verifier probes: fail-closed rows", () => {
  const dir = path.join(root, "absent", ".claude", "hooks");
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(HOOK, path.join(dir, "role-guard.sh")); // role_guard_refs.py removed
  const hook = path.join(dir, "role-guard.sh");

  it("role_guard_refs.py removed, implementor, `git status` exits 2 with the fail-closed line", () => {
    const r = runHookAt(hook, "implementor", bashInput("git status", fixX), fixX);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(
      "role-guard: refs module missing or broken, refusing git status; fix .claude/hooks/role_guard_refs.py",
    );
  });

  it("role_guard_refs.py removed, no MDPRO_ROLE, `git status` exits 0", () => {
    const r = runHookAt(hook, undefined, bashInput("git status", fixX), fixX);
    expect(r.status).toBe(0);
  });
});
