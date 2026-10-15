#!/usr/bin/env node
/**
 * Purpose: decide whether a pull request's range is prose-only, so ci.yml can
 * skip its heavy jobs (ADR-0095).
 *
 * Usage: node scripts/ci/change-scope.mjs <base> <head>
 * Appends `code=true` or `code=false` to $GITHUB_OUTPUT (stdout when unset).
 * It always exits 0. Anything it cannot classify, including an empty range or
 * a git failure, is `code=true`, so an unknown change runs the full CI.
 *
 * Key decisions:
 * - The prose list is an allowlist: a new directory counts as code until
 *   someone checks that no test, script or Rust file reads it.
 * - docs/feature-ledger.*, docs/guide/, CHANGELOG.md, README.md and .claude/
 *   are code, because tests read them.
 *
 * @coordinates-with .github/workflows/ci.yml (the `scope` job)
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

/** Directories whose files nothing executable reads. */
export const PROSE_PREFIXES = [
  "docs/adr/",
  "docs/architecture/",
  "docs/audit/",
  "docs/design/",
  "docs/pending/",
  "docs/plans/",
  "docs/reference/",
  "docs/research/",
  "docs/test/",
];

/** Root-level prose files, matched by exact path. */
export const PROSE_ROOT_FILES = ["AGENTS.md", "CLAUDE.md", "progress.md"];

const isProse = (p) => PROSE_ROOT_FILES.includes(p) || PROSE_PREFIXES.some((prefix) => p.startsWith(prefix));

/**
 * @param {string[]} paths repo-relative paths, as `git diff --name-only` prints them
 * @returns {"prose" | "code"} "prose" only for a non-empty list of prose paths
 */
export function classifyPaths(paths) {
  return paths.length > 0 && paths.every(isProse) ? "prose" : "code";
}

/** Changed paths between the merge base of `base` and `head`, or null when git fails. */
function changedPaths(base, head) {
  const r = spawnSync("git", ["diff", "--name-only", "--no-renames", `${base}...${head}`], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return r.stdout.split("\n").filter((l) => l !== "");
}

function main(argv) {
  const [base, head] = argv;
  const paths = base && head ? changedPaths(base, head) : null;
  const scope = paths === null ? "code" : classifyPaths(paths);
  const line = `code=${scope === "code"}\n`;
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, line);
  else process.stdout.write(line);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv.slice(2));
