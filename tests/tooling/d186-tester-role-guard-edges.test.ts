// @vitest-environment node
/**
 * D186 edge calls agreed with the delegator (2026-10-12), added after the red receipt
 * D186-WI-1 was recorded on tests/tooling/d186-tester-role-guard.test.ts:
 * - allowed: `config <name>` (one argument is a read), the new `config get` /
 *   `config list` forms, `notes list`, `notes show`;
 * - refused: the new config write forms, bare `git stash`, bare `git worktree`, notes writes;
 * - git's global options, including the value-taking `--attr-source <tree>` and
 *   `--namespace <name>`, never hide the subcommand (for the implementor too).
 */
import fs from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { bashInput, makeRepo, makeRoot, runHook } from "../support/roleGuardHarness";

const root = makeRoot("role-guard-d186-edges-");
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const repo = makeRepo(root, "scratch", "fix/d186-edges");
const run = (role: string | undefined, command: string) => runHook(role, bashInput(command, repo), repo);

describe("D186 tester edges: allowed", () => {
  it.each([
    ["git config user.name"], ["git config --global user.email"], ["git config --type=bool core.bare"],
    ["git config get user.name"], ["git config get --all remote.origin.fetch"], ["git config list"],
    ["git config list --show-origin"], ["git notes list"], ["git notes show HEAD"],
    ["git notes --ref=review show HEAD"], ["git --attr-source HEAD status"], ["git -p log -1"],
  ])("allows %s", (command) => {
    const r = run("real-device-tester", command);
    expect(r.stderr, command).toBe("");
    expect(r.status, command).toBe(0);
  });
});

describe("D186 tester edges: refused, naming the subcommand", () => {
  it.each([
    ["git config set user.name x", "config"], ["git config unset user.name", "config"],
    ["git config rename-section a b", "config"], ["git config remove-section a", "config"],
    ["git config edit", "config"], ["git config", "config"],
    ["git stash", "stash"], ["git worktree", "worktree"],
    ["git notes add -m x", "notes"], ["git notes remove HEAD", "notes"], ["git notes prune", "notes"],
    ["git notes --ref=review append -m x", "notes"],
    ["git --attr-source HEAD fetch", "fetch"], ["git --namespace ns gc", "gc"],
    ["git --no-pager -P --bare --literal-pathspecs --no-optional-locks fetch", "fetch"],
  ])("refuses %s", (command, sub) => {
    const r = run("real-device-tester", command);
    expect(r.status, command).toBe(2);
    expect(r.stderr, command).toContain("real-device-tester");
    expect(r.stderr, command).toContain("`git " + sub);
    expect(r.stderr.trim().split("\n"), command).toHaveLength(1);
  });
});

describe("D186 global options: implementor", () => {
  it("`git --attr-source HEAD push` is refused like `git push`", () => {
    const r = run("implementor", "git --attr-source HEAD push origin fix/d186-edges");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("push");
  });

  it("`git --attr-source HEAD status` is allowed", () => {
    const r = run("implementor", "git --attr-source HEAD status");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
});

describe("D186 tester edges: short clusters, option values and `--` separators", () => {
  it.each([
    ["git branch --list -- foo"], ["git tag -n5 'v*'"], ["git tag --sort v:refname"], ["git tag --verify v1"],
    ["git config -f x user.name"], ["git reflog -n 5"],
  ])("allows %s", (command) => {
    const r = run("real-device-tester", command);
    expect(r.stderr, command).toBe("");
    expect(r.status, command).toBe(0);
  });

  it.each([
    ["git branch -lD x", "branch -lD"], ["git branch --contains x --delete y", "branch --delete"],
    ["git branch --no-list -- foo", "branch foo"], ["git branch -t foo origin/foo", "branch -t"],
    ["git tag -l -d v1", "tag -d"], ["git config -fx user.name y", "config y"], ["git config --type bool x y", "config y"],
    ["git config user.name --add", "config --add"], ["git config -le", "config -le"],
    ["git symbolic-ref -qd HEAD", "symbolic-ref --delete"], ["git symbolic-ref -m msg HEAD refs/heads/x", "symbolic-ref refs/heads/x"],
    ["git remote -v add o u", "remote add"], ["git notes --ref x add", "notes add"], ["git stash -p", "stash -p"],
    ["git --exec-path=x commit -m y", "commit"],
    // Was "allows" until audit b93 H2: the tester may not pass `-c` at all (delegator ruling).
    ["git -c alias.log=commit log", "log` with `-c alias.log=commit"],
  ])("refuses %s, naming `git %s`", (command, shown) => {
    const r = run("real-device-tester", command);
    expect(r.status, command).toBe(2);
    expect(r.stderr, command).toContain(`real-device-tester runs read-only git only; \`git ${shown}\` is not on the allowlist`);
    expect(r.stderr.trim().split("\n"), command).toHaveLength(1);
  });
});
