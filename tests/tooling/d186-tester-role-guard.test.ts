// @vitest-environment node
/**
 * D186: real-device-tester's git check is a read-only ALLOWLIST that fails closed
 * (delegator ruling, 2026-10-12). The old denylist let state-changing calls through
 * (`fetch`, `config user.name x`, `remote add`, `gc`, `notes add`, `symbolic-ref HEAD x`,
 * `update-index`, `replace`, …) and read `branch --list --no-list foo` as a listing,
 * though git, last flag winning, creates `foo`.
 *
 * Allowed: a fixed set of read-only subcommands, plus the read-only forms of branch,
 * tag, stash, worktree, remote, config, symbolic-ref and reflog. Everything else,
 * including an unknown subcommand, is refused in one line naming the subcommand.
 * Long options are read the way git reads them: any unambiguous prefix, the last
 * `--x` / `--no-x` winning. Implementor and no-role behaviour do not change.
 *
 * The hook only parses the command, it never runs git, so every call is checked
 * from one empty scratch repo.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { bashInput, makeRepo, makeRoot, runHook } from "../support/roleGuardHarness";

const root = makeRoot("role-guard-d186-");
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const repo = makeRepo(root, "scratch", "fix/d186-scratch");
const sub = path.join(root, "scratch", "nested");
fs.mkdirSync(sub, { recursive: true });

const run = (role: string | undefined, command: string) => runHook(role, bashInput(command, repo), repo);
const tester = (command: string) => run("real-device-tester", command);

function expectAllowed(command: string): void {
  const r = tester(command);
  expect(r.stderr, command).toBe("");
  expect(r.status, command).toBe(0);
}

function expectRefused(command: string, subcommand: string): void {
  const r = tester(command);
  expect(r.status, command).toBe(2);
  expect(r.stderr, command).toContain("real-device-tester");
  expect(r.stderr, command).toContain("`git " + subcommand);
  expect(r.stderr.trim().split("\n"), command).toHaveLength(1);
}

describe("D186 tester allowlist: read-only subcommands pass", () => {
  it.each([
    ["git status"], ["git log --oneline -5"], ["git show HEAD"], ["git diff HEAD~1"],
    ["git diff-tree --no-commit-id --stat -r HEAD"], ["git diff-files"], ["git diff-index HEAD"],
    ["git rev-parse --abbrev-ref HEAD"], ["git rev-list --count HEAD"], ["git ls-files"],
    ["git ls-tree HEAD"], ["git cat-file -p HEAD"], ["git blame README.md"], ["git describe --tags"],
    ["git name-rev HEAD"], ["git show-ref"], ["git for-each-ref refs/heads"], ["git merge-base HEAD master"],
    ["git grep foo"], ["git shortlog -sn"], ["git whatchanged -1"], ["git version"], ["git help log"],
    ["git var GIT_EDITOR"], ["git check-ignore a.log"], ["git check-attr -a a.md"], ["git count-objects -v"],
    ["git verify-commit HEAD"], ["git verify-tag v1"], ["git --version"], ["git --no-pager log -1"],
  ])("allows %s", (command) => expectAllowed(command));
});

describe("D186 tester allowlist: read-only forms of state-changing subcommands pass", () => {
  it.each([
    ["git branch"], ["git branch -a"], ["git branch -r"], ["git branch -v"], ["git branch --list"],
    ["git branch -l 'fix/*'"], ["git branch --list 'fix/*'"], ["git branch --contains x"], ["git branch --merged"],
    ["git branch --show-current"], ["git branch --no-list --list foo"],
    ["git tag"], ["git tag -l"], ["git tag --list 'v*'"], ["git tag --contains HEAD"],
    ["git stash list"], ["git stash show"], ["git stash show -p stash@{0}"],
    ["git worktree list"], ["git worktree list --porcelain"],
    ["git remote"], ["git remote -v"], ["git remote show origin"], ["git remote get-url origin"],
    ["git remote get-url --push origin"],
    ["git config --get user.name"], ["git config --get-all remote.origin.fetch"],
    ["git config --get-regexp '^user'"], ["git config --list"], ["git config -l"],
    ["git config --global --get user.email"],
    ["git symbolic-ref HEAD"], ["git symbolic-ref --short HEAD"], ["git symbolic-ref -q HEAD"],
    ["git reflog"], ["git reflog show"], ["git reflog show --oneline HEAD"], ["git reflog -n 5"],
  ])("allows %s", (command) => expectAllowed(command));
});

describe("D186 tester allowlist: wrappers do not change the verdict", () => {
  it.each([
    [`git -C ${sub} status`], [`git -C ${sub} branch -a`], ["bash -lc 'git log --oneline -3'"],
    ["bash -lc 'git config --get user.name'"], ["env GIT_PAGER=cat git remote -v"],
    ["env -u FOO git stash list"], ["git status && git worktree list | head -5"],
  ])("allows %s", (command) => expectAllowed(command));

  it.each([
    [`git -C ${sub} fetch`, "fetch"], ["bash -lc 'git config user.name x'", "config"],
    ["env A=1 git remote add o https://example.invalid/r.git", "remote"], ["sh -c 'git gc'", "gc"],
    ["git status && git fetch origin", "fetch"], ["git log -1; git notes add -m x", "notes"],
    [`git -C ${sub} config user.name x`, "config"], [`git --git-dir=${sub}/.git gc`, "gc"],
    [`git --work-tree=${sub} --git-dir=${sub}/.git remote add o https://example.invalid/r.git`, "remote"],
    [`git -c core.pager=cat --no-pager config --unset user.name`, "config"],
  ])("refuses %s", (command, s) => expectRefused(command, s));
});

describe("D186 tester allowlist: state-changing calls the denylist let through are refused", () => {
  it.each([
    ["git fetch", "fetch"], ["git fetch origin", "fetch"], ["git ls-remote origin", "ls-remote"], ["git pull", "pull"],
    ["git config user.name x", "config"], ["git config --unset x", "config"], ["git config --add x y", "config"],
    ["git config --unset-all x", "config"], ["git config --replace-all x y", "config"],
    ["git config --rename-section a b", "config"], ["git config --remove-section a", "config"],
    ["git config --edit", "config"],
    ["git remote add o https://example.invalid/r.git", "remote"], ["git remote set-url origin x", "remote"],
    ["git remote remove origin", "remote"], ["git remote rename origin up", "remote"],
    ["git remote prune origin", "remote"], ["git remote update", "remote"], ["git remote set-head origin -a", "remote"],
    ["git worktree add ../w", "worktree"], ["git worktree remove w", "worktree"], ["git worktree prune", "worktree"],
    ["git worktree lock w", "worktree"], ["git worktree move w v", "worktree"],
    ["git symbolic-ref HEAD refs/heads/x", "symbolic-ref"], ["git symbolic-ref -d HEAD", "symbolic-ref"],
    ["git symbolic-ref --delete HEAD", "symbolic-ref"],
    ["git update-index --assume-unchanged a", "update-index"], ["git gc", "gc"], ["git prune", "prune"],
    ["git repack -a -d", "repack"], ["git notes add -m x", "notes"], ["git replace a b", "replace"],
    ["git stash", "stash"], ["git stash push", "stash"], ["git stash drop", "stash"], ["git stash pop", "stash"],
    ["git stash apply", "stash"], ["git stash clear", "stash"], ["git stash -u", "stash"], ["git stash create", "stash"],
    ["git reflog expire --all", "reflog"], ["git reflog delete HEAD@{0}", "reflog"], ["git reflog drop main", "reflog"],
    ["git tag v1", "tag"], ["git tag -d v1", "tag"], ["git tag -a v1 -m x", "tag"], ["git tag -f v1 HEAD", "tag"],
    ["git branch foo", "branch"], ["git branch --list --no-list foo", "branch"], ["git branch -d x", "branch"],
    ["git branch --set-upstream-to=o/x", "branch"], ["git branch -u o/x", "branch"],
    ["git branch --unset-upstream", "branch"], ["git branch --edit-description", "branch"],
    ["git init", "init"], ["git clone https://example.invalid/r.git", "clone"], ["git bisect start", "bisect"],
    ["git submodule update --init", "submodule"], ["git hash-object -w a", "hash-object"],
    ["git read-tree HEAD", "read-tree"], ["git sparse-checkout set a", "sparse-checkout"],
    ["git maintenance run", "maintenance"], ["git frobnicate", "frobnicate"], ["git -c alias.st=status st", "st"],
  ])("refuses %s", (command, s) => expectRefused(command, s));
});

describe("D186 tester allowlist: what the denylist already refused stays refused", () => {
  it.each([
    ["git add a", "add"], ["git commit -m x", "commit"], ["git push", "push"], ["git merge x", "merge"],
    ["git rebase x", "rebase"], ["git reset HEAD", "reset"], ["git cherry-pick a", "cherry-pick"],
    ["git checkout -- f", "checkout"], ["git switch main", "switch"], ["git restore f", "restore"],
    ["git clean -fd", "clean"], ["git revert a", "revert"], ["git rm f", "rm"], ["git mv a b", "mv"],
    ["git am p.patch", "am"], ["git apply p.patch", "apply"], ["git update-ref refs/heads/x HEAD", "update-ref"],
    ["git branch -D x", "branch"], ["git branch -m x y", "branch"], ["git branch -f x HEAD", "branch"],
  ])("refuses %s", (command, s) => expectRefused(command, s));
});

describe("D186 tester allowlist: abbreviated long options, the last flag winning", () => {
  it.each([
    ["git branch --li foo"], ["git branch --lis 'fix/*'"], ["git branch --contai x"], ["git branch --show-c"],
    ["git config --get-r x"], ["git config --li"], ["git config --get-a x"], ["git tag --li 'v*'"],
    ["git worktree list --porc"], ["git remote --verb"], ["git remote get-url --pu origin"],
    ["git symbolic-ref --sho HEAD"], ["git symbolic-ref -d --no-delete HEAD"], ["git symbolic-ref --del --no-del HEAD"],
  ])("allows %s", (command) => expectAllowed(command));

  it.each([
    ["git branch --li --no-li foo", "branch"], ["git branch --list --no-l foo", "branch"],
    ["git branch --dele x", "branch"], ["git branch --set-u=o/x", "branch"], ["git branch --unset-u", "branch"],
    ["git config --unse x", "config"], ["git config --ad x y", "config"], ["git config --repl x y", "config"],
    ["git config --get --unset x", "config"],
    ["git tag --dele v1", "tag"], ["git symbolic-ref --del HEAD", "symbolic-ref"],
    ["git symbolic-ref --no-delete -d HEAD", "symbolic-ref"],
  ])("refuses %s", (command, s) => expectRefused(command, s));
});

describe("D186: implementor and no-role behaviour unchanged", () => {
  it.each([
    ["git fetch origin"], ["git config user.name x"], ["git remote add o https://example.invalid/r.git"],
    ["git branch --list --no-list foo"], ["git stash"], ["git frobnicate"],
  ])("implementor on a fix/ branch: %s is allowed", (command) => {
    const r = run("implementor", command);
    expect(r.stderr, command).toBe("");
    expect(r.status, command).toBe(0);
  });

  it("implementor: `git branch -f master HEAD` is still refused", () => {
    const r = run("implementor", "git branch -f master HEAD");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("master");
  });

  it.each([["git fetch origin"], ["git config user.name x"], ["git branch --list --no-list foo"], ["git gc"]])(
    "no role: %s is allowed silently",
    (command) => {
      const r = run(undefined, command);
      expect(r.stderr, command).toBe("");
      expect(r.status, command).toBe(0);
    },
  );
});
