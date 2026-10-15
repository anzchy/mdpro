// @vitest-environment node
/**
 * D186 round 2 (audit b93 on 56c339f): four Highs that broke "read-only allowlist,
 * fail closed" for real-device-tester.
 * - H1: an option's value is a word, not an option (`branch --format --list x` creates x;
 *   `branch --list --format --delete` only lists, the audit's Low #6).
 * - H2: the tester may not set git config for one command (`-c`, `--config-env`,
 *   GIT_CONFIG_*) or point git at programs and other stores through the environment.
 * - H3: the arguments of every allowed subcommand are checked: options that write
 *   files or run programs are refused, abbreviations included.
 * H4 (parse exceptions) is in tests/tooling/d186-role-guard-tester-fail-closed.test.ts.
 */
import fs from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { bashInput, makeRepo, makeRoot, runHook } from "../support/roleGuardHarness";

const root = makeRoot("role-guard-d186-audit-");
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const repo = makeRepo(root, "scratch", "fix/d186-audit");
const run = (role: string | undefined, command: string) => runHook(role, bashInput(command, repo), repo);

function expectAllowed(command: string, role = "real-device-tester"): void {
  const r = run(role, command);
  expect(r.stderr, command).toBe("");
  expect(r.status, command).toBe(0);
}

function expectRefused(command: string, shown: string): void {
  const r = run("real-device-tester", command);
  expect(r.status, command).toBe(2);
  expect(r.stderr, command).toContain("real-device-tester");
  expect(r.stderr, command).toContain("`git " + shown);
  expect(r.stderr.trim().split("\n"), command).toHaveLength(1);
}

describe("D186 H1: option values are not options", () => {
  it.each([
    ["git branch --format --list d186-bypass", "branch"], ["git branch --sort --list foo", "branch"],
    ["git branch --format --no-delete -d x", "branch"],
    ["git branch --contains -d x", "branch"],
    ["git tag --format --list v9", "tag"], ["git tag --sort --list v9", "tag"],
    ["git config --file --list user.name x", "config"], ["git config -f --list user.name y", "config"],
    ["git config --type --get a b", "config"],
    ["git symbolic-ref -m --no-delete -d HEAD", "symbolic-ref"], ["git notes --ref list add", "notes"],
  ])("refuses %s", (command, shown) => expectRefused(command, shown));

  it.each([
    ["git branch --list --format --delete"], ["git branch --list --sort --force"], ["git branch -l --format='%(refname)' foo"],
    ["git tag --list --format --delete"], ["git tag -l --sort -v:refname"],
    ["git config --default --add --get x"], ["git config -f --edit user.name"],
    ["git symbolic-ref -m -d HEAD"], ["git notes --ref show show"], ["git notes --ref=add list"],
  ])("allows %s", (command) => expectAllowed(command));
});

describe("D186 H2: no per-command config, no program or store redirection", () => {
  it.each([
    ["git -c core.fsmonitor='git update-ref refs/heads/x HEAD; false' --no-optional-locks status", "status"],
    ["git -c core.pager=cat log -1", "log"], ["git --config-env=core.pager=X log", "log"],
    ["git --config-env core.pager=X log", "log"], ["git --exec-path=/tmp/x status", "status"],
    ["GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.pager GIT_CONFIG_VALUE_0=x git log", "log"],
    ["env GIT_CONFIG_PARAMETERS=\"'core.pager'='x'\" git log", "log"], ["GIT_CONFIG_GLOBAL=/tmp/x git log", "log"],
    ["GIT_CONFIG=/tmp/x git status", "status"],
    ["GIT_EXTERNAL_DIFF=/tmp/x git diff", "diff"], ["GIT_PAGER='sh -c x' git log", "log"],
    ["PAGER='rm -f x' git log", "log"], ["GIT_EDITOR=/tmp/x git status", "status"],
    ["GIT_SSH_COMMAND=/tmp/x git remote show origin", "remote"], ["GIT_ASKPASS=/tmp/x git remote show origin", "remote"],
    ["GIT_EXEC_PATH=/tmp git status", "status"], ["GIT_INDEX_FILE=/tmp/i git status", "status"],
    ["GIT_OBJECT_DIRECTORY=/tmp/o git log", "log"], ["GIT_ALTERNATE_OBJECT_DIRECTORIES=/tmp/o git log", "log"],
    ["GIT_TRACE=/tmp/t git status", "status"],
    ["GIT_CONFIG_PARAMETERS=\"'core.pager'='x'\" bash -c 'git log'", "log"],
    ["env GIT_EXTERNAL_DIFF=/tmp/x bash -lc 'git diff'", "diff"],
    ["env -S 'GIT_EXTERNAL_DIFF=/tmp/x git diff'", "diff"],
    ["export GIT_EXTERNAL_DIFF=/tmp/x; git diff", "diff"], ["export PAGER='sh -c x' && git log", "log"],
    ["bash -c 'export GIT_CONFIG_COUNT=1; git status'", "status"],
  ])("refuses %s", (command, shown) => expectRefused(command, shown));

  it.each([
    ["GIT_DIR=.git git status"], ["GIT_WORK_TREE=. GIT_DIR=.git git log -1"], ["GIT_OPTIONAL_LOCKS=0 git status"],
    ["env GIT_PAGER=cat git log -1"], ["PAGER=less git log -1"], ["git --no-pager -C . --no-optional-locks status"],
    ["git --exec-path"], ["env -u GIT_PAGER git log -1"],
  ])("allows %s", (command) => expectAllowed(command));

  it.each([["git -c core.pager=x log"], ["GIT_EXTERNAL_DIFF=/tmp/x git diff"], ["export GIT_PAGER=x; git log"]])(
    "implementor: %s stays allowed",
    (command) => expectAllowed(command, "implementor"),
  );
});

describe("D186 H3: arguments of allowed subcommands that write files or run programs", () => {
  it.each([
    ["git diff HEAD~1 HEAD --output=x.txt", "diff"], ["git log -1 --output=x.txt", "log"],
    ["git show --output x.txt HEAD", "show"], ["git diff --output=.claude/hooks/role-guard.sh", "diff"],
    ["git diff --outp=x", "diff"], ["git log --out x", "log"], ["git whatchanged --output=x", "whatchanged"],
    ["git diff-tree --output=x HEAD", "diff-tree"], ["git diff-files --output=x", "diff-files"],
    ["git diff-index --output=x HEAD", "diff-index"], ["git shortlog --output=x", "shortlog"],
    ["git diff --ext-diff", "diff"], ["git log -p --ext", "log"], ["git show --textconv HEAD:a", "show"],
    ["git cat-file --textconv HEAD:a", "cat-file"], ["git cat-file --filters HEAD:a", "cat-file"],
    ["git blame --textconv a", "blame"], ["git grep --textconv x", "grep"],
    ["git grep -O x", "grep"], ["git grep -nOvim x", "grep"], ["git grep --open-files-in-pager=vim x", "grep"],
    ["git grep --open x", "grep"], ["git help -w log", "help"], ["git help --web log", "help"],
    ["git help --we log", "help"], ["git help -i log", "help"], ["git help --info log", "help"],
    ["git stash show --output=x", "stash"], ["git stash show --ext-diff", "stash"],
    ["git reflog show --output=x", "reflog"], ["git log --upload-pack=x", "log"],
  ])("refuses %s", (command, shown) => expectRefused(command, shown));

  it.each([
    ["git diff --text"], ["git diff --no-ext-diff"], ["git log --no-textconv -p"], ["git diff --stat --output-indicator-new=+"],
    ["git rev-list --filter=blob:none HEAD"], ["git blame --contents f a"], ["git grep -n foo"], ["git grep -o foo"],
    ["git help log"], ["git help -a"], ["git verify-commit HEAD"], ["git var -l"], ["git log --exclude=x --all"],
    ["git cat-file -p HEAD"], ["git show --stat HEAD"],
  ])("allows %s", (command) => expectAllowed(command));
});
