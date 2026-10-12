// @vitest-environment node
/**
 * Rule 70 role guard: the PreToolUse hook `.claude/hooks/role-guard.sh` reads
 * the session's role from `MDPRO_ROLE` and refuses the tool calls that role may
 * not make. An implementor never asks the user directly, never pushes, and never
 * commits, merges, rebases, cherry-picks or resets on `master` (the single
 * integration trunk, ADR-0083) or on a `release/*` hotfix branch; the old trunk
 * name `frontend-backend-redesign` stays protected only until 2026-10-19.
 * real-device-tester never changes git state and writes only into its report
 * dir or session scratch.
 *
 * Each case spawns the real hook with Claude Code's PreToolUse JSON on stdin;
 * exit 2 means the call is denied, exit 0 means it is allowed. Branch-dependent
 * cases run against throwaway git repos in os.tmpdir().
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.claude/hooks/role-guard.sh");

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "role-guard-")));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const baseEnv: NodeJS.ProcessEnv = { ...process.env };
for (const k of ["MDPRO_ROLE", "MDPRO_REPORT_DIR", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete baseEnv[k];

function repo(name: string, branch: string): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  const git = (...args: string[]) => {
    const r = spawnSync("git", ["-C", dir, ...args], { env: baseEnv, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  };
  git("init", "-q");
  git("symbolic-ref", "HEAD", `refs/heads/${branch}`);
  return dir;
}

// The `redesign` fixture and every case that uses it are deleted together with
// the name `frontend-backend-redesign` from PROTECTED on 2026-10-19 (ADR-0083).
const redesign = repo("redesign", "frontend-backend-redesign");
const master = repo("master", "master");
const feature = repo("feature", "fix/d99-role-guard");
const featureB = repo("feature-b", "fix/d180-example");
const release = repo("release", "release/0.3");
const releaseLike = repo("release-like", "release-notes-tidy");

const reportDir = path.join(root, "report");
const outside = path.join(root, "outside");
fs.mkdirSync(reportDir, { recursive: true });
fs.mkdirSync(outside, { recursive: true });
fs.symlinkSync(outside, path.join(reportDir, "escape-dir"));
fs.symlinkSync(path.join(outside, "victim.md"), path.join(reportDir, "escape-file.md"));
const home = path.join(root, "home");
fs.mkdirSync(path.join(home, ".mdpro-redesign", "dtrack"), { recursive: true });

type Input = { tool_name: string; tool_input?: Record<string, unknown>; cwd?: string };

function run(role: string | undefined, input: Input | string, extraEnv: NodeJS.ProcessEnv = {}) {
  const env: NodeJS.ProcessEnv = { ...baseEnv, MDPRO_REPORT_DIR: reportDir, ...extraEnv };
  if (role !== undefined) env.MDPRO_ROLE = role;
  const r = spawnSync("/bin/bash", [HOOK], {
    input: typeof input === "string" ? input : JSON.stringify({ cwd: feature, ...input }),
    env,
    encoding: "utf8",
  });
  return { status: r.status, stderr: r.stderr };
}

const bash = (command: string, cwd = feature): Input => ({ tool_name: "Bash", tool_input: { command }, cwd });
const write = (file_path: string, cwd = feature): Input => ({ tool_name: "Write", tool_input: { file_path, content: "x" }, cwd });
const ask: Input = { tool_name: "AskUserQuestion", tool_input: { questions: [] } };

describe("role-guard: roles without restrictions", () => {
  it.each([[undefined], [""], ["delegator"], ["auditor"], ["device-harness"], ["someone-else"]])(
    "MDPRO_ROLE=%s allows everything silently",
    (role) => {
      for (const input of [ask, bash("git push origin master", redesign), bash("git add -A", redesign), write("/etc/hosts")]) {
        const r = run(role, input);
        expect(r.status).toBe(0);
        expect(r.stderr).toBe("");
      }
    },
  );

  it("fails open on malformed JSON", () => {
    expect(run("implementor", "{not json").status).toBe(0);
    expect(run("real-device-tester", "").status).toBe(0);
  });
});

describe("role-guard: implementor", () => {
  const impl = (input: Input) => run("implementor", input);

  it("denies AskUserQuestion and points at the delegator", () => {
    const r = impl(ask);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("mdpro-delegator");
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
  });

  it.each([
    ["git push", feature],
    ["git push origin fix/d99-role-guard", feature],
    ["git -C /somewhere push", feature],
    ["FOO=1 BAR=2 git push", feature],
    ["env FOO=1 git push --force", feature],
    ["git status && git push", feature],
    ["git status; git push", feature],
    ["git log | git push", feature],
    ["false || git push", feature],
    ["git -c core.pager=cat --no-pager push", feature],
    ["bash -c 'git push'", feature],
    ["echo $(git push)", feature],
  ])("denies push: %s", (command, cwd) => {
    const r = impl(bash(command, cwd));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("push");
  });

  it.each([
    ['git commit -m "fix"', redesign],
    ['git commit -m "fix"', master],
    ["git merge fix/d99-role-guard", redesign],
    ["git rebase master", redesign],
    ["git cherry-pick abc123", redesign],
    ["git reset --hard HEAD~1", redesign],
    [`git -C ${redesign} commit -m x`, feature],
    [`cd ${redesign} && git commit -m x`, feature],
    [`git status && git -C ${master} merge foo`, feature],
  ])("denies on a protected branch: %s (cwd %s)", (command, cwd) => {
    const r = impl(bash(command, cwd));
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/master|frontend-backend-redesign/);
  });

  it.each([
    ["git commit -m x", release],
    ["git rebase master", release],
  ])("denies on a release/* hotfix branch: %s (cwd %s)", (command, cwd) => {
    const r = impl(bash(command, cwd));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("release/0.3");
  });

  it.each([
    ["git add -A"],
    ["git add --all"],
    ["git add ."],
    ["git add -u"],
    ["git add --update"],
    ["git add -Av"],
    ["git add src/a.ts && git add ."],
    ["git add .claude/tdd-guardian/state.json"],
    ["git add src/a.ts ./.claude/tdd-guardian/state.json"],
    ['git commit -a -m "x"'],
    ['git commit --all -m "x"'],
    ['git commit -am "x"'],
  ])("denies broad or state.json staging: %s", (command) => {
    expect(impl(bash(command)).status).toBe(2);
  });

  it.each([
    ['git commit -m "push fix"', feature],
    ['git commit -m "git push later; git add -A"', feature],
    ["git commit -m x", feature],
    ['git commit -m "add all"', feature],
    ["git merge frontend-backend-redesign", feature], // deleted with the old trunk name on 2026-10-19
    ["git rebase frontend-backend-redesign", feature], // deleted with the old trunk name on 2026-10-19
    ["git rebase master", featureB],
    ["git merge master", featureB],
    ["git commit -m x", releaseLike],
    ["git reset --soft HEAD~1", feature],
    ["git add src/a.ts tests/a.test.ts", feature],
    ["git add .claude/tdd-guardian/receipts.json", feature],
    ["git status && git log --oneline -5", redesign],
    ["git diff-tree --no-ext-diff --stat -r HEAD~1 HEAD", redesign],
    ["echo git push", feature],
    ["grep -rn 'git push' docs", feature],
    [`git -C ${feature} commit -m x`, redesign],
  ])("allows %s (cwd %s)", (command, cwd) => {
    expect(impl(bash(command, cwd)).status).toBe(0);
  });

  it("allows writes anywhere", () => {
    expect(impl(write("/etc/hosts")).status).toBe(0);
  });
});

describe("role-guard: real-device-tester", () => {
  const tester = (input: Input, env: NodeJS.ProcessEnv = {}) => run("real-device-tester", input, env);

  it.each([
    ["git add report.md"],
    ["git commit -m x"],
    ["git push"],
    ["git merge x"],
    ["git rebase x"],
    ["git reset HEAD"],
    ["git cherry-pick abc"],
    ["git checkout -- file"],
    ["git switch main"],
    ["git restore file"],
    ["git stash"],
    ["git stash pop"],
    ["git worktree add ../x"],
    ["git branch -d x"],
    ["git branch -D x"],
    ["git branch -m x y"],
    ["git tag v1"],
    ["git clean -fd"],
    ["git status && git -C /x commit -m y"],
  ])("denies git state change: %s", (command) => {
    const r = tester(bash(command));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("real-device-tester");
  });

  it.each([
    ["git status"],
    ["git log --oneline -5"],
    ["git show HEAD"],
    ["git diff HEAD~1"],
    ["git rev-parse HEAD"],
    ["git cat-file -p HEAD"],
    ["git branch"],
    ["git stash list"],
    ["git worktree list"],
    ['echo "git commit" >> notes.txt'],
  ])("allows read-only git: %s", (command) => {
    expect(tester(bash(command)).status).toBe(0);
  });

  it.each([
    ["inside the report dir", path.join(reportDir, "run-1.md")],
    ["a new subdir of the report dir", path.join(reportDir, "new", "deep", "run.md")],
    ["the session scratch under /private/tmp", "/private/tmp/claude-501/proj/session/scratchpad/n.md"],
    ["the session scratch under /tmp", "/tmp/claude-501/proj/session/scratchpad/n.md"],
  ])("allows Write %s", (_label, p) => {
    expect(tester(write(p)).status).toBe(0);
  });

  it("allows a relative path that resolves into the report dir", () => {
    expect(tester(write("run-2.md", reportDir)).status).toBe(0);
  });

  it("uses $HOME/.mdpro-redesign/dtrack when MDPRO_REPORT_DIR is unset", () => {
    const env = { MDPRO_REPORT_DIR: "", HOME: home };
    expect(tester(write(path.join(home, ".mdpro-redesign", "dtrack", "r.md")), env).status).toBe(0);
    expect(tester(write(path.join(reportDir, "r.md")), env).status).toBe(2);
  });

  it.each([
    ["a repo source file", path.join(feature, "src", "App.tsx")],
    ["a `..` escape from the report dir", path.join(reportDir, "..", "outside", "x.md")],
    ["a symlinked dir escape", path.join(reportDir, "escape-dir", "x.md")],
    ["a symlinked file escape", path.join(reportDir, "escape-file.md")],
    ["a sibling whose name only shares the prefix", `${reportDir}-evil/x.md`],
    ["a /tmp path that is not session scratch", "/tmp/other/x.md"],
  ])("denies Write to %s", (_label, p) => {
    const r = tester(write(p));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(reportDir);
  });

  it("applies the same rule to Edit and NotebookEdit", () => {
    const target = path.join(outside, "x.md");
    expect(tester({ tool_name: "Edit", tool_input: { file_path: target } }).status).toBe(2);
    expect(tester({ tool_name: "NotebookEdit", tool_input: { notebook_path: target } }).status).toBe(2);
    expect(tester({ tool_name: "Edit", tool_input: { file_path: path.join(reportDir, "a.md") } }).status).toBe(0);
    expect(tester({ tool_name: "NotebookEdit", tool_input: { notebook_path: path.join(reportDir, "a.ipynb") } }).status).toBe(0);
  });
});
