// @vitest-environment node
/**
 * D184 (b), delegator ruling 2: `git pull` that rebases runs `git rebase`, which
 * reads `rebase.updateRefs` from the command's `-c` / `--config-env` /
 * GIT_CONFIG_* settings. With that setting true, an implementor's pull is refused
 * unless the command line itself turns rebasing off (`--no-rebase`,
 * `--rebase=false|no|off|0`, the last of them winning). A bare `pull` is refused
 * too: `pull.rebase` / `branch.<name>.rebase` in the repo's config may make it
 * rebase, and the guard cannot read that config (fail closed).
 *
 * The hook is fed PreToolUse JSON on stdin; none of the git commands is run.
 */
import fs from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { bashInput, makeRepo, makeRoot, runHook } from "./support/roleGuardHarness";

const root = makeRoot("role-guard-d184-pull-");
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const feature = makeRepo(root, "feature", "fix/d184-pull-rebase");
const run = (role: string | undefined, command: string) => runHook(role, bashInput(command, feature), feature);

const BLOCKED: string[] = [
  "git -c rebase.updateRefs=true pull --rebase origin master",
  "git -c rebase.updateRefs=true pull -r",
  "git -c rebase.updateRefs=true pull --rebase=merges",
  "git -c rebase.updateRefs=true pull --reb origin",
  "git -c rebase.updateRefs=true pull -qr",
  "git -c rebase.updateRefs=true pull",
  "git -c rebase.updateRefs=true -c pull.rebase=true pull",
  "git -c rebase.updateRefs=true pull --no-rebase --rebase",
  "MYVAR=yes git --config-env=rebase.updateRefs=MYVAR pull --rebase",
  "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=rebase.updateRefs GIT_CONFIG_VALUE_0=true git pull -r",
  "GIT_CONFIG_PARAMETERS=\"'rebase.updateRefs'='true'\" git pull --rebase",
  "bash -lc 'git -c rebase.updateRefs=true pull --rebase'",
];

const ALLOWED: string[] = [
  "git -c rebase.updateRefs=true pull --no-rebase",
  "git -c rebase.updateRefs=true pull --no-reb origin",
  "git -c rebase.updateRefs=true pull --rebase=false",
  "git -c rebase.updateRefs=true pull --rebase=no",
  "git -c rebase.updateRefs=true pull --rebase --no-rebase",
  "git -c rebase.updateRefs=false pull --rebase",
  "git pull --rebase",
  "git -c core.pager=cat pull -r",
];

describe("D184 (b) role-guard: pull that rebases with rebase.updateRefs set", () => {
  it.each(BLOCKED)("denies %s", (command) => {
    const r = run("implementor", command);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^Blocked by role-guard \(implementor\): /);
    expect(r.stderr).toMatch(/rebase\.updateRefs/i);
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
  });

  it.each(ALLOWED)("allows %s", (command) => {
    const r = run("implementor", command);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("allows every refused form when no role is set", () => {
    for (const command of BLOCKED) {
      const r = run(undefined, command);
      expect(r.status, command).toBe(0);
      expect(r.stderr, command).toBe("");
    }
  });
});
