/**
 * Purpose: throwaway git fixture trees for the rules-budget-lib self-tests (D355). Each tree is a real repository
 * under os.tmpdir() with its files tracked, so `git ls-files` sees exactly what the case wrote; `cleanupFixtures()`
 * removes them. `fixture()` awaits git (D302) and loads the tree's tracked files, so callers `await` it.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { clearCaches, loadTrackedFiles } from "./rules-lib-core";

const runFile = promisify(execFile);

export const R70 = ".claude/rules/70-multi-session-coordination.md";
export const R71 = ".claude/rules/71-herdr-mixed-roster.md";

const made: string[] = [];

/** Removes every tree `fixture()` made; call it from `afterAll`. */
export function cleanupFixtures(): void {
  for (const root of made.splice(0)) fs.rmSync(root, { recursive: true, force: true });
}

export async function fixture(files: Record<string, string>, untracked: Record<string, string> = {}): Promise<string> {
  clearCaches();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "d355-"));
  made.push(root);
  const write = (rel: string, body: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  };
  for (const [rel, body] of Object.entries(files)) write(rel, body);
  await runFile("git", ["init", "-q"], { cwd: root });
  await runFile("git", ["-c", "core.quotepath=true", "add", "--", ...Object.keys(files)], { cwd: root });
  for (const [rel, body] of Object.entries(untracked)) write(rel, body);
  await loadTrackedFiles(root);
  return root;
}

export function update(root: string, rel: string, body: string): void {
  clearCaches();
  fs.writeFileSync(path.join(root, rel), body);
}

export const pad = (n: number, ch = "x"): string => ch.repeat(n);
