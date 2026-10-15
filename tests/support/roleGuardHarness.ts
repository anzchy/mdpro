/**
 * Shared harness for the rule 70 role-guard hook tests
 * (tests/tooling/role-guard-hook.test.ts, tests/tooling/d180-role-guard-ref-moves.test.ts).
 *
 * Each case spawns the real `.claude/hooks/role-guard.sh` with Claude Code's
 * PreToolUse JSON on stdin; exit 2 means denied, exit 0 allowed. Branch-dependent
 * cases run against throwaway git repos under a temp root the caller removes.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.claude/hooks/role-guard.sh");

export const baseEnv: NodeJS.ProcessEnv = { ...process.env };
for (const k of ["MDPRO_ROLE", "MDPRO_REPORT_DIR", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete baseEnv[k];

export type Input = { tool_name: string; tool_input?: Record<string, unknown>; cwd?: string };

/** A fresh temp root; the caller removes it in `afterAll`. */
export function makeRoot(prefix = "role-guard-"): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function gitIn(dir: string, ...args: string[]): void {
  const r = spawnSync("git", ["-C", dir, ...args], { env: baseEnv, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
}

/** An empty repo under `root` whose HEAD points at `branch` (unborn). */
export function makeRepo(root: string, name: string, branch: string): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  gitIn(dir, "init", "-q");
  gitIn(dir, "symbolic-ref", "HEAD", `refs/heads/${branch}`);
  return dir;
}

/** A repo under `root` with one commit on `master` and HEAD detached at it. */
export function makeDetachedRepo(root: string, name: string): string {
  const dir = makeRepo(root, name, "master");
  gitIn(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init");
  gitIn(dir, "checkout", "-q", "--detach");
  return dir;
}

/**
 * `<root>/repo` with two commits on `master`, checked out, and a linked worktree
 * `<root>/fix-x` on a new branch `fix/x` (the D180 verifier's probe setup).
 */
export function makeMainWithWorktree(root: string): { main: string; fixX: string } {
  const main = makeRepo(root, "repo", "master");
  for (const m of ["a", "b"]) gitIn(main, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", m);
  const fixX = path.join(root, "fix-x");
  gitIn(main, "worktree", "add", "-q", "-b", "fix/x", fixX);
  return { main, fixX };
}

/** Runs the hook once. `defaultCwd` fills `cwd` when the input has none. */
export function runHook(
  role: string | undefined,
  input: Input | string,
  defaultCwd: string,
  env: NodeJS.ProcessEnv = {},
): { status: number | null; stderr: string } {
  const full: NodeJS.ProcessEnv = { ...baseEnv, ...env };
  if (role !== undefined) full.MDPRO_ROLE = role;
  const r = spawnSync("/bin/bash", [HOOK], {
    input: typeof input === "string" ? input : JSON.stringify({ cwd: defaultCwd, ...input }),
    env: full,
    encoding: "utf8",
  });
  return { status: r.status, stderr: r.stderr };
}

export const bashInput = (command: string, cwd: string): Input => ({ tool_name: "Bash", tool_input: { command }, cwd });

/** Like `runHook`, but runs a copy of the hook at `hookPath` (D180 fail-closed cases). */
export function runHookAt(
  hookPath: string,
  role: string | undefined,
  input: Input,
  defaultCwd: string,
): { status: number | null; stderr: string } {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  if (role !== undefined) env.MDPRO_ROLE = role;
  const r = spawnSync("/bin/bash", [hookPath], { input: JSON.stringify({ cwd: defaultCwd, ...input }), env, encoding: "utf8" });
  return { status: r.status, stderr: r.stderr };
}
