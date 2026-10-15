// @vitest-environment node
/**
 * D75(a): the PreToolUse(Bash) guard `.claude/hooks/block-target-scan.sh`
 * refuses recursive grep / find walks that reach `src-tauri/target`.
 *
 * Two bypasses existed: any occurrence of the word `target` anywhere in the
 * command allowed it (`grep -rn "e.target" .` walked the whole build tree), and
 * option arguments were taken as paths (`grep -rn -e foo` with no path, which
 * searches `.`). Each case spawns the real hook with Claude Code's JSON stdin
 * against a throwaway project dir; exit 2 means the call is denied.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.claude/hooks/block-target-scan.sh");

const project = fs.mkdtempSync(path.join(os.tmpdir(), "target-hook-"));
for (const d of ["src", "src-tauri/target", "src-tauri/src", "tests"]) fs.mkdirSync(path.join(project, d), { recursive: true });
afterAll(() => fs.rmSync(project, { recursive: true, force: true }));

function run(command: string, cwd = project) {
  const r = spawnSync("/bin/bash", [HOOK], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: project },
    encoding: "utf8",
  });
  return { status: r.status, stderr: r.stderr };
}

describe("D75(a) block-target-scan hook", () => {
  it.each([
    // the word `target` no longer opens the gate by itself
    ['grep -rn "e.target" .'],
    ["grep -r --include=*.ts target ."],
    ["find . -name '*.rs' | grep target"],
    ["echo target; grep -rn foo ."],
    ["grep -rn --exclude-dir=node_modules foo ."],
    // option arguments are not paths; no path left means `.`
    ["grep -rn -e foo"],
    ["grep -rn -e foo -e bar"],
    ["grep -rn -A 3 foo"],
    ["grep -rnf patterns.txt"],
    ["grep -rn --regexp foo"],
    ["grep -rn -e target"],
    // a filter on output is not a prune: find still walks target
    ["find . -not -path '*/target/*' -name '*.rs'"],
    ["find . ! -path '*/target/*'"],
    ["grep -rn foo src-tauri"],
  ])("blocks %s", (command) => {
    const r = run(command);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("src-tauri/target");
  });

  it.each([
    ["grep -rn --exclude-dir=target foo ."],
    ["grep -rn --exclude-dir target foo ."],
    ["grep -rn --exclude-dir='*target*' foo ."],
    ["grep -rn --exclude-dir={node_modules,target} foo ."],
    ['grep -rn "e.target" src tests'],
    ["grep -rn -e foo src"],
    ["grep -rn -A 3 foo src"],
    ["grep -n target README.md"],
    ["find . -path ./src-tauri/target -prune -o -name '*.rs' -print"],
    ["find . -name target -prune -o -print"],
    ["find src -name '*.ts'"],
    ["rg target ."],
  ])("allows %s", (command) => {
    expect(run(command).status).toBe(0);
  });

  it("allows a recursive grep of `.` when cwd is a source dir, not the root", () => {
    expect(run("grep -rn foo .", path.join(project, "src")).status).toBe(0);
  });
});
