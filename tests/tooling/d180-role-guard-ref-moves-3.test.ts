// @vitest-environment node
/**
 * D180 round 3 (Codex audit b88 on 51df302): routes past the rule 70 role guard.
 *
 * H. `bash -lc '…'` (any short-option cluster holding `c`, or `-c` after other
 *    options) skipped every check, because only a standalone `-c` was recursed into.
 * 4. `env -u NAME` / `--unset NAME` / `-S 'cmd'` hid the git word behind an env value.
 * 5. `--git-dir` / `--work-tree` / `GIT_DIR=` point git at another checkout, whose
 *    HEAD must decide the current-branch checks; unresolvable means refused.
 * 6. `fetch --refmap <spec>` maps fetched refs onto local ones.
 * 7. Glob destinations must be judged against the protected namespace, not samples.
 * 8. `git branch -f --list master` only lists (listing wins).
 * b. `rebase --update-refs` moves every branch inside the rebased range.
 * c. Switch-then-mutate within one command chain.
 *
 * The hook is fed PreToolUse JSON on stdin; none of the git commands is run.
 * Repos sit side by side under one temp root, so `../master` from `feature` names
 * the repo whose HEAD is `master`.
 */
import fs from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { bashInput, makeDetachedRepo, makeRepo, makeRoot, runHook } from "../support/roleGuardHarness";

const root = makeRoot("role-guard-d180-3-");
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const feature = makeRepo(root, "feature", "fix/d180-round-3");
makeRepo(root, "master", "master");
makeDetachedRepo(root, "detached");

const run = (role: string | undefined, command: string) => runHook(role, bashInput(command, feature), feature);

/** [command, text the one-line refusal must contain] */
const BLOCKED: Array<[string, string]> = [
  // H. shell wrappers with clustered or later -c
  ["bash -lc 'git push'", "push"],
  ["sh -ec 'git -C ../master commit -m x'", "master"],
  ["bash -l -c 'git branch -f master HEAD'", "master"],
  ["zsh -xc 'git update-ref refs/heads/master da2bd0c'", "master"],
  ["bash -o pipefail -c 'git push'", "push"],
  ["bash --login -c 'git push'", "push"],
  ["dash -euxc 'git push'", "push"],
  ["bash --norc -lc \"bash -ec 'git push'\"", "push"],
  // 4. env options that take a value
  ["env -u FOO git push", "push"],
  ["env -u FOO -u BAR git push", "push"],
  ["env --unset FOO git branch -f master HEAD", "master"],
  ["env -uFOO -i git push", "push"],
  ["env -S 'git push'", "push"],
  ["env -C ../master git commit -m x", "master"],
  ["env --chdir ../master git reset --hard HEAD~1", "master"],
  // 5. another checkout's HEAD
  ["git --git-dir=../master/.git update-ref HEAD HEAD~1", "master"],
  ["git --git-dir ../master/.git reset --hard HEAD~1", "master"],
  ["git --work-tree=../master --git-dir=../master/.git commit -m x", "master"],
  ["GIT_DIR=../master/.git git commit -m x", "master"],
  ["env GIT_DIR=../master/.git git rebase foo", "master"],
  ["git -C ../master --git-dir=.git branch -m x", "master"],
  ["git --git-dir=../nowhere/.git reset --hard HEAD~1", "unresolv"],
  ["git --git-dir=../nowhere/.git update-ref HEAD HEAD~1", "unresolv"],
  // 6. --refmap
  ["git fetch origin --refmap='+refs/heads/*:refs/heads/*' master", "refs/heads/*"],
  ["git fetch origin --refmap=+refs/heads/foo:refs/heads/master foo", "master"],
  ["git fetch --refmap 'refs/heads/*:heads/*' origin", "heads/*"],
  // 7. globs over the protected namespace
  ["git fetch origin '+refs/heads/release/0.*:refs/heads/release/0.*'", "release/0.*"],
  ["git fetch origin 'refs/heads/release/v*:refs/heads/release/v*'", "release/v*"],
  ["git fetch origin 'refs/heads/re?ease/1:refs/heads/re?ease/1'", "re?ease/1"],
  ["git fetch origin 'refs/heads/*:heads/*'", "heads/*"],
  // b. rebase --update-refs
  ["git rebase --update-refs master", "update-refs"],
  ["git rebase -i --update-refs HEAD~3", "update-refs"],
  ["git rebase master --update-refs", "update-refs"],
  ["git rebase --update-ref master", "update-refs"],
  // c. switch, then mutate, in one chain
  ["git checkout master && git reset --hard HEAD~1", "master"],
  ["git switch master; git commit -m x", "master"],
  ["git checkout -f master && git update-ref HEAD HEAD~1", "master"],
  ["git switch --force master && git merge foo", "master"],
  ["git worktree add ../w master && git -C ../w reset --hard HEAD~1", "master"],
  ["git worktree add ../w release/0.3 && cd ../w && git commit -m x", "release/0.3"],
  ["git worktree add ../master-wt master && cd ../master-wt && git cherry-pick abc", "master"],
];

const ALLOWED: string[] = [
  // H
  "bash -l script.sh",
  "bash script.sh -c x",
  "bash -lc 'git status'",
  "bash -c 'echo git push'",
  // 4
  "env -u FOO git status",
  "env --unset=FOO git commit -m x",
  // 5
  "git --git-dir=.git commit -m x",
  "git --git-dir=../master/.git log --oneline -3",
  "git --git-dir=../detached/.git reset --hard HEAD~1",
  "GIT_DIR=../detached/.git git commit -m x",
  // 6
  "git fetch origin --refmap='+refs/heads/*:refs/remotes/origin/*' master",
  "git fetch origin --refmap= master",
  // 7
  "git fetch origin '+refs/heads/fix/*:refs/heads/fix/*'",
  "git fetch origin 'refs/heads/feature-*:refs/heads/feature-*'",
  "git fetch origin '+refs/heads/*:refs/remotes/origin/*'",
  // 8
  "git branch -f --list master",
  "git branch --list -f master",
  "git branch -fl master",
  "git branch -l -D master",
  // b
  "git rebase --no-update-refs master",
  // c
  "git checkout master && git log",
  "git checkout --detach master && git reset --hard HEAD~1",
  "git checkout master -- src/a.ts && git commit -m x",
  "git checkout fix/x && git commit -m x",
  "git worktree add ../w fix/x && git -C ../w commit -m x",
];

describe("D180 round 3 role-guard: implementor routes that are now refused", () => {
  it.each(BLOCKED)("denies %s", (command, text) => {
    const r = run("implementor", command);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^Blocked by role-guard \(implementor\): /);
    expect(r.stderr).toContain(text);
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
  });

  it.each(ALLOWED)("allows %s", (command) => {
    const r = run("implementor", command);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("allows every refused form when no role is set", () => {
    for (const [command] of BLOCKED) {
      const r = run(undefined, command);
      expect(r.status, command).toBe(0);
      expect(r.stderr, command).toBe("");
    }
  });
});

describe("D180 round 3 role-guard: real-device-tester through clustered shell -c", () => {
  it.each([["bash -lc 'git commit -m x'"], ["sh -l -c 'git stash'"], ["env -u FOO git reset HEAD"]])(
    "denies %s",
    (command) => {
      const r = run("real-device-tester", command);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("real-device-tester");
    },
  );

  it("still allows read-only git through a wrapper", () => {
    expect(run("real-device-tester", "bash -lc 'git status'").status).toBe(0);
  });
});
