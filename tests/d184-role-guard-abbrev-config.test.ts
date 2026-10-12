// @vitest-environment node
/**
 * D184: two ways an implementor still moved a protected branch past the rule 70
 * role guard (.claude/hooks/role-guard.sh + role_guard_refs.py).
 *
 * (a) Abbreviated long options. git's parse-options accepts any unambiguous prefix
 *     of a subcommand's long option (`git branch --forc master HEAD`), and a prefix
 *     of an `--no-` form; an exact name wins over a longer one sharing its prefix
 *     (`switch --force` is not `--force-create`). Option tables come from
 *     `git <sub> --git-completion-helper-all` (git 2.50.1, hidden options included).
 * (b) `rebase.updateRefs` set for one command: `git -c`, `--config-env`,
 *     `GIT_CONFIG_COUNT/KEY_n/VALUE_n`, `GIT_CONFIG_PARAMETERS`. git booleans:
 *     true/yes/on or a non-zero integer (case-insensitive); a bare `-c key` is true;
 *     `=` (empty) is false. Section and key names are case-insensitive; the last
 *     setting wins; `--no-update-refs` on the command line overrides config.
 *
 * Coordinator rulings (2026-10-12): an ambiguous prefix whose candidates include an
 * option the module inspects is refused (git rejects it anyway); an ambiguous
 * prefix none of whose candidates is inspected is allowed. A missing
 * role_guard_opts.py fails closed like a missing role_guard_refs.py.
 *
 * The hook is fed PreToolUse JSON on stdin; none of the git commands is run.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { HOOK, bashInput, makeRepo, makeRoot, runHook, runHookAt } from "./support/roleGuardHarness";

const root = makeRoot("role-guard-d184-");
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const feature = makeRepo(root, "feature", "fix/d184-role-guard-abbrev-config");
const onMaster = makeRepo(root, "master", "master");

const run = (role: string | undefined, command: string, cwd = feature, env: NodeJS.ProcessEnv = {}) =>
  runHook(role, bashInput(command, cwd), cwd, env);

function expectRefused(r: { status: number | null; stderr: string }, text: string | RegExp) {
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/^Blocked by role-guard \(implementor\): /);
  if (typeof text === "string") expect(r.stderr).toContain(text);
  else expect(r.stderr).toMatch(text);
  expect(r.stderr.trim().split("\n")).toHaveLength(1);
}

/** (a) unambiguous abbreviations of options the module gates on: [command, refusal text] */
const ABBREV_BLOCKED: Array<[string, string]> = [
  ["git branch --forc master HEAD", "master"],
  ["git branch --forc release/0.3 HEAD", "release/0.3"],
  ["git branch --dele master", "master"],
  ["git branch --d release/1", "release/1"],
  ["git branch --mo master gone", "master"],
  ["git branch --mov fix/x master", "master"],
  ["git branch --cop fix/x master", "master"],
  ["git branch --no-li --forc master HEAD", "master"],
  ["git update-ref --std", "stdin"],
  ["git update-ref --s", "stdin"],
  ["git symbolic-ref --del refs/heads/master", "master"],
  ["git symbolic-ref --d master", "master"],
  ["git fetch origin --refm='+refs/heads/*:refs/heads/*'", "refs/heads/*"],
  ["git fetch --refm 'refs/heads/*:refs/heads/*' origin", "refs/heads/*"],
  ["git pull --refm=+refs/heads/x:refs/heads/master origin x", "master"],
  ["git switch --force-c master", "master"],
  ["git switch --force-cr=master HEAD~1", "master"],
  ["git worktree add --lock --reas x ../wt-r master && git -C ../wt-r commit -m x", "master"],
  ["git rebase --u master", "update-refs"],
  ["git rebase --upd master", "update-refs"],
  ["git rebase --ont origin/x upstream master", "master"],
  ["git rebase --o origin/x upstream master", "master"],
  ["git rebase --ont=origin/x upstream master", "master"],
  ["git rebase --roo master", "master"],
  ["git rebase --exe 'make test' upstream master", "master"],
  ["git rebase --strategy-o theirs upstream master", "master"],
  ["git add --al", "stages files"],
  ["git add --a", "stages files"],
  ["git add --upd", "stages files"],
  ["git add --u", "stages files"],
  ["bash -lc 'git branch --forc master HEAD'", "master"],
  ["env -u FOO git branch --dele master", "master"],
];

/** (a) ambiguous prefixes with an inspected option among the candidates: refused */
const AMBIGUOUS_BLOCKED: string[] = [
  "git branch --for master HEAD", // --force, --format
  "git branch --fo master HEAD",
  "git branch --co fix/x master", // --color, --column, --contains, --copy
  "git branch --c fix/x master",
  "git branch --m master gone", // --merged, --move
  "git switch --forc master", // --force, --force-create
  "git fetch origin --ref='+refs/heads/*:refs/heads/*'", // --refetch, --refmap
  "git pull --r origin", // --rebase, --recurse-submodules, --refmap
  "git rebase --r master", // --root, --rebase-merges, --reapply-cherry-picks, …
  "git rebase --strat ours upstream master", // --strategy, --strategy-option
  "git commit --a -m x", // --all, --amend, --author, --allow-empty, …
  "git commit --al -m x", // --all, --allow-empty, --allow-empty-message
];

/** Push shares prefixes (--force / --force-with-lease / --force-if-includes) but is always refused. */
const PUSH_BLOCKED = ["git push --force-with-lease", "git push --forc", "git push --force-i"];

/** (a) controls: listing, exact names, harmless ambiguity, detach, no-deref */
const ABBREV_ALLOWED: string[] = [
  "git branch --list master",
  "git branch --contains master",
  "git branch --cont master",
  "git branch --lis",
  "git branch --lis -f master",
  "git branch --l -D master",
  "git branch --form=x --lis",
  "git branch --no-s", // --no-set-upstream, --no-set-upstream-to, --no-show-current, --no-sort: none inspected
  "git fetch --p origin", // --porcelain, --prefetch, --progress, --prune, --prune-tags
  "git rebase --no-v master", // --no-verify, --no-verbose
  "git switch --force master", // exact name wins over --force-create
  "git checkout --d master && git commit -m x",
  "git checkout --deta master && git commit -m x",
  "git switch --det master && git commit -m x",
  "git branch --forc fix/other HEAD",
  "git rebase --ont origin/x upstream fix/other",
];

/** (b) rebase.updateRefs set for one command: refused */
const CONFIG_BLOCKED: string[] = [
  "git -c rebase.updateRefs=true rebase master",
  "git -c rebase.updaterefs rebase master",
  "git -c REBASE.UPDATEREFS=yes rebase master",
  "git -c rebase.updateRefs=On rebase master",
  "git -c rebase.updateRefs=1 rebase master",
  "git -c rebase.updateRefs=2 rebase master",
  "git -c rebase.updateRefs=false -c rebase.updateRefs=true rebase master",
  "git -c rebase.updateRefs=true -C . rebase master",
  "MYVAR=true git --config-env=rebase.updateRefs=MYVAR rebase master",
  "export RU=true; git --config-env=rebase.updateRefs=RU rebase master",
  "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=rebase.updateRefs GIT_CONFIG_VALUE_0=true git rebase master",
  "env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=REBASE.updateRefs GIT_CONFIG_VALUE_0=yes git rebase master",
  "GIT_CONFIG_PARAMETERS=\"'rebase.updateRefs'='true'\" git rebase master",
  "GIT_CONFIG_PARAMETERS=\"'rebase.updateRefs=true'\" git rebase master",
  "bash -lc 'git -c rebase.updateRefs=true rebase master'",
  "env -u FOO git -c rebase.updateRefs=true rebase master",
];

/** (b) controls: falsy values, other keys, command-line override, count 0 */
const CONFIG_ALLOWED: string[] = [
  "git -c rebase.updateRefs=true rebase --no-update-refs master",
  "git -c rebase.updateRefs=true rebase --no-upd master",
  "git -c rebase.updateRefs=false rebase master",
  "git -c rebase.updateRefs=no rebase master",
  "git -c rebase.updateRefs=OFF rebase master",
  "git -c rebase.updateRefs=0 rebase master",
  "git -c rebase.updateRefs= rebase master",
  "git -c rebase.updateRefs=true -c rebase.updateRefs=false rebase master",
  "git -c core.pager=cat rebase master",
  "git -c rebase.autosquash=true rebase master",
  "git -c branch.rebase.updateRefs=true rebase master",
  "git -c rebase.updateRefs=true log master",
  "MYVAR=false git --config-env=rebase.updateRefs=MYVAR rebase master",
  "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=rebase.updateRefs GIT_CONFIG_VALUE_0=false git rebase master",
  "GIT_CONFIG_COUNT=0 GIT_CONFIG_KEY_0=rebase.updateRefs GIT_CONFIG_VALUE_0=true git rebase master",
];

describe("D184 (a) role-guard: abbreviated long options", () => {
  it.each(ABBREV_BLOCKED)("denies %s", (command, text) => {
    expectRefused(run("implementor", command), text);
  });

  it.each(AMBIGUOUS_BLOCKED)("denies the ambiguous prefix in %s", (command) => {
    expectRefused(run("implementor", command), "ambiguous");
  });

  it.each(PUSH_BLOCKED)("denies %s (push, whatever the option)", (command) => {
    expectRefused(run("implementor", command), "push");
  });

  it.each(ABBREV_ALLOWED)("allows %s", (command) => {
    const r = run("implementor", command);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("allows `update-ref --no-d HEAD` on master (--no-deref leaves the branch alone)", () => {
    const r = run("implementor", "git update-ref --no-d HEAD HEAD~1", onMaster);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("still denies `update-ref HEAD` on master without --no-deref (control)", () => {
    expectRefused(run("implementor", "git update-ref --de HEAD HEAD~1", onMaster), "master");
  });
});

describe("D184 (b) role-guard: rebase.updateRefs set for one command", () => {
  it.each(CONFIG_BLOCKED)("denies %s", (command) => {
    expectRefused(run("implementor", command), /rebase\.updateRefs/i);
  });

  it.each([["--config-env=rebase.updateRefs=MYVAR"], ["--config-env rebase.updateRefs=MYVAR"]])(
    "denies `git %s rebase master` with MYVAR=true in the environment",
    (opt) => {
      expectRefused(run("implementor", `git ${opt} rebase master`, feature, { MYVAR: "true" }), /rebase\.updateRefs/i);
    },
  );

  it("allows `--config-env=rebase.updateRefs=MYVAR` with MYVAR=false in the environment", () => {
    const r = run("implementor", "git --config-env=rebase.updateRefs=MYVAR rebase master", feature, { MYVAR: "false" });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it.each(CONFIG_ALLOWED)("allows %s", (command) => {
    const r = run("implementor", command);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });
});

describe("D184 role-guard: no role set", () => {
  it("allows every refused form", () => {
    const all = [...ABBREV_BLOCKED.map(([c]) => c), ...AMBIGUOUS_BLOCKED, ...PUSH_BLOCKED, ...CONFIG_BLOCKED];
    for (const command of all) {
      const r = run(undefined, command, feature, { MYVAR: "true" });
      expect(r.status, command).toBe(0);
      expect(r.stderr, command).toBe("");
    }
  });
});

describe("D184 role-guard: role_guard_opts.py fails closed", () => {
  function hooksDir(name: string): string {
    const dir = path.join(root, name, ".claude", "hooks");
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(HOOK, path.join(dir, "role-guard.sh"));
    fs.copyFileSync(path.join(path.dirname(HOOK), "role_guard_refs.py"), path.join(dir, "role_guard_refs.py"));
    return dir; // role_guard_opts.py deliberately absent
  }

  it("refs intact, opts absent: implementor `git status` is refused in one line", () => {
    const dir = hooksDir("opts-absent");
    const r = runHookAt(path.join(dir, "role-guard.sh"), "implementor", bashInput("git status", feature), feature);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("role-guard: refs module missing or broken, refusing git status");
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
  });

  it("refs intact, opts absent: no role set still allows `git status`", () => {
    const dir = hooksDir("opts-absent-norole");
    const r = runHookAt(path.join(dir, "role-guard.sh"), undefined, bashInput("git status", feature), feature);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });
});
