// @vitest-environment node
/**
 * D184 round 2 (audit b91 on 639e511): git reads boolean options in order, so the
 * last of `--x` / `--no-x` (or a short alias such as `-l`, `-d`) wins. After D184
 * expanded abbreviations, the guard still tested `"--x" in args`, so a later
 * `--no-x` was ignored. Four audit Highs, each denied at b20111b and allowed at
 * 639e511, then one `--x --no-x` / `--no-x --x` pair per converted option.
 * Bit options in `git branch`: `--no-delete` clears only what `-d`/`--delete` set,
 * so `-D --no-delete` still deletes.
 *
 * Medium (same audit): inline `VAR=x` / `env VAR=x` before `bash -c '…'` reach the
 * nested git, so GIT_CONFIG_* and GIT_DIR must be carried into the nested script.
 *
 * Setup as in tests/tooling/d180-verifier-probes.test.ts: `repo` on master, `fix-x` on fix/x.
 * The hook is fed PreToolUse JSON on stdin; none of the git commands is run.
 */
import fs from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { bashInput, makeMainWithWorktree, makeRoot, runHook } from "../support/roleGuardHarness";

const root = makeRoot("role-guard-d184-last-");
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const { main, fixX } = makeMainWithWorktree(root);
const run = (role: string | undefined, command: string, cwd = fixX) => runHook(role, bashInput(command, cwd), cwd);

/** [command, cwd]: the four audit b91 Highs */
const AUDIT: Array<[string, string]> = [
  ["git branch --lis --no-lis --force master HEAD~1", fixX],
  ["git update-ref --no-d --de HEAD HEAD~1", main],
  ["git rebase --roo --no-roo origin/fix master", fixX],
  ["git checkout --d --no-d master && git reset --hard HEAD~1", fixX],
];

/** [command, cwd] refused: the later flag turns the protected move back on */
const BLOCKED: Array<[string, string]> = [
  // branch --list / -l
  ["git branch --list --no-list -f master HEAD", fixX],
  ["git branch -l --no-list -f master HEAD", fixX],
  // branch --force
  ["git branch --no-forc --forc master HEAD", fixX],
  ["git branch --no-force --force master HEAD", fixX],
  // branch --delete (bit 1) / -D (bit 2)
  ["git branch --no-dele --dele master", fixX],
  ["git branch -D --no-delete master", fixX],
  // branch --move
  ["git branch --no-mov --mov fix/x master", fixX],
  // branch --copy
  ["git branch --copy --no-copy -f master HEAD", fixX],
  ["git branch --no-cop --cop fix/x master", fixX],
  // update-ref --deref / --no-deref
  ["git update-ref --no-deref --deref HEAD HEAD~1", main],
  // update-ref --stdin
  ["git update-ref --no-std --std", fixX],
  ["git update-ref --no-stdin --stdin", fixX],
  // symbolic-ref --delete / -d
  ["git symbolic-ref --no-del --del refs/heads/master", fixX],
  ["git symbolic-ref -qd master", fixX],
  // fetch --multiple
  ["git fetch --multiple --no-multiple origin x:master", fixX],
  ["git fetch --mul --no-mul origin x:master", fixX],
  // rebase --root
  ["git rebase --root --no-root origin/fix master", fixX],
  ["git rebase --no-roo --roo master", fixX],
  // checkout --detach
  ["git checkout --detach --no-detach master && git reset --hard HEAD~1", fixX],
  // switch --detach / -d
  ["git switch --detach --no-detach master && git commit -m x", fixX],
  ["git switch -d --no-det master && git commit -m x", fixX],
  // worktree add --detach / -d
  ["git worktree add --detach --no-detach ../wd master && git -C ../wd commit -m x", fixX],
  ["git worktree add -d --no-det ../we master && git -C ../we commit -m x", fixX],
];

/** [command, cwd] allowed: the later flag turns the protected move off */
const ALLOWED: Array<[string, string]> = [
  ["git branch --no-lis --lis -f master", fixX],
  ["git branch --no-list -l -f master", fixX],
  ["git branch --forc --no-forc master HEAD", fixX],
  ["git branch --dele --no-dele master", fixX],
  ["git branch --mov --no-mov fix/x master", fixX],
  ["git branch --cop --no-cop fix/x master", fixX],
  ["git update-ref --de --no-d HEAD HEAD~1", main],
  ["git update-ref --deref --no-deref HEAD HEAD~1", main],
  ["git update-ref --std --no-std refs/heads/fix/x HEAD", fixX],
  ["git symbolic-ref --del --no-del refs/heads/master", fixX],
  ["git symbolic-ref -d --no-delete master", fixX],
  ["git fetch --no-mul --mul origin x:master", fixX],
  ["git rebase --no-roo --roo fix/other", fixX],
  ["git rebase --root --no-root master fix/x", fixX],
  ["git checkout --no-detach --detach master && git reset --hard HEAD~1", fixX],
  ["git switch --no-det --det master && git commit -m x", fixX],
  ["git switch -fd master && git commit -m x", fixX],
  ["git worktree add --no-det --det ../wf master && git -C ../wf commit -m x", fixX],
  ["git worktree add -fd ../wg master && git -C ../wg commit -m x", fixX],
];

/** Medium: inline assignments before a nested shell reach its git */
const NESTED_BLOCKED: string[] = [
  "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=rebase.updateRefs GIT_CONFIG_VALUE_0=true bash -c 'git rebase master'",
  "env GIT_CONFIG_PARAMETERS=\"'rebase.updateRefs=true'\" bash -lc 'git rebase master'",
  "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=rebase.updateRefs GIT_CONFIG_VALUE_0=true sh -c 'cd . && git pull -r'",
  "GIT_DIR=../repo/.git bash -c 'git commit -m x'",
];
const NESTED_ALLOWED: string[] = [
  "MYVAR=false bash -c 'git --config-env=rebase.updateRefs=MYVAR rebase master'",
  "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=rebase.updateRefs GIT_CONFIG_VALUE_0=false bash -c 'git rebase master'",
  "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=rebase.updateRefs GIT_CONFIG_VALUE_0=true bash -c 'git status'",
];

function expectRefused(r: { status: number | null; stderr: string }) {
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/^Blocked by role-guard \(implementor\): /);
  expect(r.stderr.trim().split("\n")).toHaveLength(1);
}

function expectAllowed(r: { status: number | null; stderr: string }) {
  expect(r.status).toBe(0);
  expect(r.stderr).toBe("");
}

describe("D184 round 2 role-guard: the last of --x / --no-x wins", () => {
  it.each(AUDIT)("audit b91: denies %s", (command, cwd) => expectRefused(run("implementor", command, cwd)));
  it.each(BLOCKED)("denies %s", (command, cwd) => expectRefused(run("implementor", command, cwd)));
  it.each(ALLOWED)("allows %s", (command, cwd) => expectAllowed(run("implementor", command, cwd)));
});

describe("D184 round 2 role-guard: inline assignments reach a nested shell's git", () => {
  it.each(NESTED_BLOCKED)("denies %s", (command) => expectRefused(run("implementor", command)));
  it.each(NESTED_ALLOWED)("allows %s", (command) => expectAllowed(run("implementor", command)));
});

describe("D184 round 2 role-guard: no role set", () => {
  it("allows every refused form", () => {
    for (const [command, cwd] of [...AUDIT, ...BLOCKED, ...NESTED_BLOCKED.map((c): [string, string] => [c, fixX])]) {
      const r = run(undefined, command, cwd);
      expect(r.status, command).toBe(0);
      expect(r.stderr, command).toBe("");
    }
  });
});
