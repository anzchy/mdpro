// @vitest-environment node
/**
 * D180 verifier findings (2026-10-12): three more ways an implementor could move a
 * protected branch by name without it being checked out.
 *
 * 1. fetch/pull refspec destinations: git expands a destination that starts with
 *    `heads/` to `refs/heads/…` (and `tags/`, `remotes/` to `refs/tags/…`,
 *    `refs/remotes/…`), so `HEAD:heads/master` moves master.
 * 2. `git rebase <upstream> <branch>` checks out and rewrites <branch> (with
 *    `--root`, the first positional is the branch), not the branch checked out before.
 * 3. `git symbolic-ref refs/heads/master <ref>` turns master into an alias, and
 *    `symbolic-ref -d` on it deletes it.
 *
 * The hook is fed PreToolUse JSON on stdin; none of the git commands is run.
 */
import fs from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { bashInput, makeRepo, makeRoot, runHook } from "./support/roleGuardHarness";

const root = makeRoot("role-guard-d180-2-");
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const feature = makeRepo(root, "feature", "fix/d180-verifier");

const run = (role: string | undefined, command: string) => runHook(role, bashInput(command, feature), feature);

/** [command, the protected branch the refusal must name] */
const BLOCKED: Array<[string, string]> = [
  // 1. heads/ shorthand in refspec destinations
  ["git fetch . HEAD:heads/master", "master"],
  ["git fetch . +HEAD:heads/master", "master"],
  ["git fetch origin +HEAD:heads/release/x", "release/x"],
  ["git fetch origin foo:heads/frontend-backend-redesign", "frontend-backend-redesign"],
  ["git fetch origin 'heads/*:heads/*'", "heads/*"],
  ["git pull origin foo:heads/master", "master"],
  ["git pull . +HEAD:heads/release/0.3", "release/0.3"],
  ["git -C ../feature fetch . HEAD:heads/master", "master"],
  // 2. rebase <upstream> <branch>
  ["git rebase HEAD master", "master"],
  ["git rebase --onto x y release/0.3", "release/0.3"],
  ["git rebase -X theirs origin/foo master", "master"],
  ["git rebase -Xtheirs origin/foo master", "master"],
  ["git rebase --onto=x y master", "master"],
  ["git rebase -s ort origin/foo frontend-backend-redesign", "frontend-backend-redesign"],
  ["git rebase --strategy ort --strategy-option theirs origin/foo master", "master"],
  ["git rebase -i --exec 'make test' HEAD~2 master", "master"],
  ["git rebase -x 'make test' HEAD~2 master", "master"],
  ["git rebase --root master", "master"],
  ["git -c core.pager=cat rebase HEAD release/0.3", "release/0.3"],
  // 3. symbolic-ref writing or deleting a protected ref
  ["git symbolic-ref refs/heads/master refs/heads/fix/x", "master"],
  ["git symbolic-ref heads/master refs/heads/fix/x", "master"],
  ["git symbolic-ref master refs/heads/fix/x", "master"],
  ["git symbolic-ref -m why refs/heads/release/0.3 refs/heads/fix/x", "release/0.3"],
  ["git symbolic-ref -d refs/heads/master", "master"],
  ["git symbolic-ref --delete refs/heads/frontend-backend-redesign", "frontend-backend-redesign"],
  ["git symbolic-ref -q -d heads/master", "master"],
];

const ALLOWED: string[] = [
  // 1. destinations that are not a protected branch
  "git fetch origin foo:heads/fix/x",
  "git fetch origin foo:remotes/origin/master",
  "git fetch origin foo:tags/master",
  "git fetch origin foo:refs/tags/master",
  "git pull origin master",
  // 2. rebases whose branch is not protected
  "git rebase master",
  "git rebase --onto master a b-fix",
  "git rebase master fix/x",
  "git rebase -X theirs master",
  "git rebase -X theirs master fix/x",
  "git rebase -s ort master",
  "git rebase --exec 'git log master' HEAD~2",
  "git rebase -x 'git log master' HEAD~2 fix/x",
  "git rebase --root fix/x",
  "git rebase --root",
  "git rebase --continue",
  "git rebase --abort",
  // 3. symbolic-ref reads, and writes to non-protected names
  "git symbolic-ref HEAD",
  "git symbolic-ref --short HEAD",
  "git symbolic-ref -q HEAD",
  "git symbolic-ref HEAD refs/heads/fix/x",
  "git symbolic-ref -d refs/heads/fix/x",
  "git symbolic-ref refs/heads/master",
  "git symbolic-ref HEAD refs/heads/master",
];

describe("D180 role-guard (verifier findings): more by-name moves of a protected branch", () => {
  it.each(BLOCKED)("denies %s", (command, branch) => {
    const r = run("implementor", command);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^Blocked by role-guard \(implementor\): /);
    expect(r.stderr).toContain(branch);
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
  });

  it.each(ALLOWED)("allows %s", (command) => {
    const r = run("implementor", command);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("allows every blocked form when no role is set", () => {
    for (const [command] of BLOCKED) {
      const r = run(undefined, command);
      expect(r.status, command).toBe(0);
      expect(r.stderr, command).toBe("");
    }
  });
});
