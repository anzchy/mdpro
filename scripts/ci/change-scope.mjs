#!/usr/bin/env node
/**
 * Purpose: decide whether a pull request's range is prose-only for ci.yml's
 * heavy jobs (ADR-0095), and report informational risk classes (MIG003a).
 *
 * Usage: node scripts/ci/change-scope.mjs <base> <head>
 * Appends `code=true|false` and six risk-class lines to $GITHUB_OUTPUT
 * (stdout when unset), plus one summary line when GITHUB_STEP_SUMMARY is set.
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

const RISK_GLOBS = {
  deps: ["package.json", "pnpm-lock.yaml", "patches/**", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "scripts/deps/**"],
  editor: ["src/plugins/**", "src/components/Editor/**", "src/services/editor/**", "src/utils/cursorSync/**", "src/utils/*[Mm]ilkdown*", "src/utils/editorMenu*"],
  pipeline: ["src/plugins/milkdown/commonmarkPreset.ts", "src/plugins/milkdown/gfmPreset.ts", "src/plugins/milkdown/linkDefinitions/**", "src/plugins/milkdown/listSpread/**", "src/plugins/milkdown/emptyParagraph/**", "src/plugins/milkdown/table/**", "src/services/sanitizerPolicy.ts", "src/services/exportService.ts", "src/services/mathRender.ts", "src/services/highlightSyntax.ts"],
  ci: [".github/**", "scripts/ci/**", "scripts/heavy-lock.sh", "vitest*.ts", "tests/ci-inventory.json", "tests/webkit/**"],
  ipc: ["src-tauri/src/commands/**", "src-tauri/src/lib.rs", "src-tauri/capabilities/**", "src/services/**"],
  platform: ["src-tauri/**"],
};

/** Small repo-relative glob matcher; `*` never crosses a slash and `**` does. */
function matchesGlob(file, glob) {
  const pattern = glob.split(/(\*\*|\*|\[Mm\])/g).map((part) => {
    if (part === "**") return "[\\s\\S]*";
    if (part === "*") return "[^/]*";
    if (part === "[Mm]") return "[Mm]";
    return part.replace(/[\\^$+?.()|{}[\]]/g, "\\$&");
  }).join("");
  return new RegExp(`^${pattern}$`).test(file);
}

/** Advisory risk classes for a list of repo-relative changed paths. */
export function classifyRiskClasses(paths) {
  const result = Object.fromEntries(Object.entries(RISK_GLOBS).map(([name, globs]) =>
    [name, paths.some((file) => globs.some((glob) => matchesGlob(file, glob)))]));
  result.editor ||= result.pipeline;
  return result;
}

/** Changed paths between the merge base of `base` and `head`, or null when git fails. */
function changedPaths(base, head) {
  const r = spawnSync("git", ["diff", "--name-only", "--no-renames", `${base}...${head}`], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return r.stdout.split("\n").filter((l) => l !== "");
}

/** Unquoted paths for risk classes; the legacy quoted read above preserves `code`. */
function changedRiskPaths(base, head) {
  const r = spawnSync("git", ["diff", "--name-only", "-z", "--no-renames", `${base}...${head}`], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return r.stdout.split("\0").filter((l) => l !== "");
}

function main(argv) {
  if (process.env.GITHUB_JOB === "scope") throw Error("MIG003a classifier fault");
  const [base, head] = argv;
  const paths = base && head ? changedPaths(base, head) : null;
  const scope = paths === null ? "code" : classifyPaths(paths);
  const line = `code=${scope === "code"}\n`;
  const riskPaths = paths === null ? null : changedRiskPaths(base, head);
  const forced = !base || !head ? "no PR base" : riskPaths === null ? "git failed" : riskPaths.length === 0 ? "empty diff" : "";
  const classes = forced ? Object.fromEntries(Object.keys(RISK_GLOBS).map((name) => [name, true])) : classifyRiskClasses(riskPaths);
  const names = Object.keys(RISK_GLOBS);
  const output = line + names.map((name) => `${name}=${classes[name]}\n`).join("");
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, output);
  else process.stdout.write(output);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        `Risk classes: ${names.map((name) => `${name}=${classes[name]}`).join(" ")}${forced ? ` (all true: ${forced})` : ""}\n`);
    } catch {
      process.stderr.write("change-scope: risk summary unavailable\n");
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv.slice(2));
