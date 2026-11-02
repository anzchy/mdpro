/**
 * Purpose: throwaway git fixture trees for the rules-budget-lib self-tests (D355). Each tree is a real repository
 * under os.tmpdir() with its files tracked, so `git ls-files` sees exactly what the case wrote.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearCaches } from "./rules-budget-lib";

export const R70 = ".claude/rules/70-multi-session-coordination.md";
export const R71 = ".claude/rules/71-herdr-mixed-roster.md";

export function fixture(files: Record<string, string>, untracked: Record<string, string> = {}): string {
  clearCaches();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "d355-"));
  const write = (rel: string, body: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  };
  for (const [rel, body] of Object.entries(files)) write(rel, body);
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["-c", "core.quotepath=true", "add", "--", ...Object.keys(files)], { cwd: root });
  for (const [rel, body] of Object.entries(untracked)) write(rel, body);
  return root;
}

export function update(root: string, rel: string, body: string): void {
  clearCaches();
  fs.writeFileSync(path.join(root, rel), body);
}

export const pad = (n: number, ch = "x"): string => ch.repeat(n);
