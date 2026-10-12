// @vitest-environment node
/**
 * D180: the rule 70 role guard must stop an implementor moving a protected
 * branch (`master`, `release/*`, and `frontend-backend-redesign` until
 * 2026-11-11 per ADR-0084) **by name**, not only while it is checked out. Before
 * D180 the hook only looked at the current branch, so `git branch -f master`,
 * `git update-ref refs/heads/master`, a fetch refspec whose destination is
 * `master`, and `git checkout -B master` all passed from a feature branch or a
 * detached HEAD.
 *
 * The hook is fed PreToolUse JSON on stdin; none of the git commands under test
 * is ever run. Exit 2 = denied, exit 0 = allowed.
 */
import fs from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { bashInput, makeDetachedRepo, makeRepo, makeRoot, runHook } from "./support/roleGuardHarness";

const root = makeRoot("role-guard-d180-");
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const feature = makeRepo(root, "feature", "fix/d180-role-guard-ref-moves");
const onMaster = makeRepo(root, "master", "master");
const detached = makeDetachedRepo(root, "detached");

const SHA = "da2bd0c";
const PROTECTED_NAMES = ["master", "release/0.3", "frontend-backend-redesign"]; // drop the last on 2026-11-11

const run = (role: string | undefined, command: string, cwd = feature) => runHook(role, bashInput(command, cwd), feature);
const impl = (command: string, cwd = feature) => run("implementor", command, cwd);

/** Every ref-moving form, per protected name; each must be denied for an implementor. */
const byNameForms = (n: string): string[] => [
  `git branch -f ${n} ${SHA}`,
  `git branch --force ${n} HEAD`,
  `git branch -D ${n}`,
  `git branch -d ${n}`,
  `git branch --delete ${n}`,
  `git branch -D fix/old ${n}`,
  `git branch -M foo ${n}`,
  `git branch -m ${n} x`,
  `git branch --move ${n} x`,
  `git branch -C foo ${n}`,
  `git update-ref refs/heads/${n} ${SHA}`,
  `git update-ref -d refs/heads/${n}`,
  `git fetch . HEAD:${n}`,
  `git fetch origin +foo:${n}`,
  `git fetch origin foo:refs/heads/${n}`,
  `git fetch origin +refs/heads/foo:refs/heads/${n}`,
  `git checkout -B ${n}`,
  `git checkout -B ${n} origin/${n}`,
  `git switch -C ${n}`,
  `git switch --force-create ${n}`,
  `git switch --force-create=${n}`,
  `git worktree add -B ${n} ../wt`,
];

const BLOCKED: string[] = PROTECTED_NAMES.flatMap(byNameForms);

const PREFIXED_BLOCKED: string[] = [
  `git -C ../feature branch -f master ${SHA}`,
  `git -c core.pager=cat update-ref refs/heads/master ${SHA}`,
  `git -c x=y --no-pager fetch . HEAD:master`,
  `git status && git checkout -B master`,
  `bash -c 'git branch -f master HEAD'`,
  `FOO=1 git update-ref -d refs/heads/release/0.3`,
  `git fetch --depth 1 origin foo:master`,
  `git fetch origin 'refs/heads/*:refs/heads/*'`,
  `git pull origin foo:master`,
];

describe("D180 role-guard: implementor may not move a protected branch by name", () => {
  it.each(BLOCKED)("denies %s", (command) => {
    const r = impl(command);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/master|release\/0\.3|frontend-backend-redesign/);
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
  });

  it.each(PREFIXED_BLOCKED)("denies through prefixes and compound commands: %s", (command) => {
    expect(impl(command).status).toBe(2);
  });

  it("still denies `git push . HEAD:master` (push is blocked outright)", () => {
    const r = impl("git push . HEAD:master");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("push");
  });
});

describe("D180 role-guard: moves that depend on where HEAD points", () => {
  it.each([
    [`git branch -m x`, "renames the checked-out master away"],
    [`git branch -M x`, "renames the checked-out master away (force)"],
    [`git update-ref HEAD ${SHA}`, "writes through HEAD into refs/heads/master"],
  ])("denies on master: %s (%s)", (command) => {
    expect(impl(command, onMaster).status).toBe(2);
  });

  it.each([
    `git branch -f master ${SHA}`,
    `git update-ref refs/heads/master ${SHA}`,
    `git fetch . HEAD:master`,
    `git checkout -B master`,
  ])("denies from a detached HEAD: %s", (command) => {
    expect(impl(command, detached).status).toBe(2);
  });

  it.each([
    [`git update-ref HEAD ${SHA}`, feature],
    [`git branch -m x`, feature],
    [`git commit -m x`, detached],
    [`git reset --hard ${SHA}`, detached],
    [`git update-ref --no-deref HEAD ${SHA}`, onMaster],
    [`git checkout master`, feature],
    [`git switch master`, feature],
  ])("allows %s (cwd %s)", (command, cwd) => {
    expect(impl(command, cwd).status).toBe(0);
  });
});

const ALLOWED: string[] = [
  `git branch -f fix/d180-foo ${SHA}`,
  `git branch -D fix/old`,
  `git branch -m fix/a fix/b`,
  `git branch -c master fix/from-master`,
  `git branch fix/new master`,
  `git branch --list master`,
  `git branch -l 'release/*'`,
  `git branch --contains master`,
  `git update-ref refs/heads/fix/x ${SHA}`,
  `git update-ref -d refs/heads/fix/x`,
  `git update-ref refs/remotes/origin/master ${SHA}`,
  `git fetch origin`,
  `git fetch origin master`,
  `git fetch origin master:refs/remotes/origin/master`,
  `git fetch origin +refs/heads/*:refs/remotes/origin/*`,
  `git fetch . master:fix/x`,
  `git fetch git@github.com:anzchy/master`,
  `git checkout -B fix/x`,
  `git checkout -B fix/x master`,
  `git switch -C fix/x master`,
  `git worktree add -B fix/x ../wt master`,
  `git log master`,
  `git rev-parse master`,
  `git merge-base --is-ancestor master HEAD`,
  `git diff master...HEAD`,
  `git branch -f masterpiece ${SHA}`,
  `git branch -f release-notes ${SHA}`,
  `git update-ref refs/heads/fix/master ${SHA}`,
];

describe("D180 role-guard: controls that must stay allowed", () => {
  it.each(ALLOWED)("allows %s for an implementor", (command) => {
    const r = impl(command);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("allows every blocked form when no role is set (the delegator runs unguarded)", () => {
    for (const command of [...BLOCKED, ...PREFIXED_BLOCKED, "git branch -m x", `git update-ref HEAD ${SHA}`]) {
      const r = run(undefined, command, onMaster);
      expect(r.status, command).toBe(0);
      expect(r.stderr, command).toBe("");
    }
  });

  it("allows every blocked form for the delegator and auditor roles", () => {
    for (const role of ["delegator", "auditor"]) {
      for (const command of [...BLOCKED, ...PREFIXED_BLOCKED]) {
        expect(run(role, command).status, `${role}: ${command}`).toBe(0);
      }
    }
  });
});

// Ruling (coordinator, 2026-10-12): `update-ref --stdin` takes its refs from
// stdin, which the hook cannot read, so an implementor may not run it in any form.
const STDIN_BLOCKED: string[] = [
  `git update-ref --stdin`,
  `git update-ref -z --stdin`,
  `git update-ref --stdin -z`,
  `printf 'update refs/heads/master ${SHA}\\n' | git update-ref --stdin`,
  `git -C ../feature update-ref --stdin`,
  `git -c core.pager=cat update-ref --stdin`,
  `bash -c 'git update-ref --stdin < /dev/null'`,
  `FOO=1 env BAR=2 git update-ref --stdin`,
  `git status && git update-ref -z --stdin`,
];

describe("D180 role-guard: `git update-ref --stdin` is unparseable, so implementors may not run it", () => {
  it.each(STDIN_BLOCKED)("denies %s", (command) => {
    const r = impl(command);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^Blocked by role-guard \(implementor\): .*update-ref --stdin/);
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
  });

  it("still allows a plain `git update-ref refs/heads/fix/x <sha>`", () => {
    const r = impl(`git update-ref refs/heads/fix/x ${SHA}`);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("allows every --stdin form when no role is set", () => {
    for (const command of STDIN_BLOCKED) {
      const r = run(undefined, command);
      expect(r.status, command).toBe(0);
      expect(r.stderr, command).toBe("");
    }
  });
});
