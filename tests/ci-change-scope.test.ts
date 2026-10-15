// @vitest-environment node
/**
 * ADR95-WI-1: PR CI skips its heavy jobs only for a prose-only change
 * (ADR-0095).
 *
 * Law: `classifyPaths` answers "prose" only when the list is non-empty and
 * every path sits under a prose prefix that no test, script or Rust file reads.
 * Anything else, including an empty list and a git failure, answers "code", so
 * an unknown change always runs the full CI.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyPaths, PROSE_PREFIXES, PROSE_ROOT_FILES } from "../scripts/ci/change-scope.mjs";

const SCRIPT = path.resolve(__dirname, "..", "scripts", "ci", "change-scope.mjs");

describe("ADR95-WI-1 classifyPaths", () => {
  it("answers code for an empty list (fail-safe)", () => {
    expect(classifyPaths([])).toBe("code");
  });

  it.each([...PROSE_PREFIXES.map((p) => `${p}x.md`), ...PROSE_ROOT_FILES])("answers prose for %s alone", (p) => {
    expect(classifyPaths([p])).toBe("prose");
  });

  it("answers prose when every path is prose", () => {
    expect(classifyPaths(["docs/adr/0095-x.md", "docs/plans/p.md", "progress.md", "CLAUDE.md"])).toBe("prose");
  });

  it.each([
    ["the feature ledger, which tests read", "docs/feature-ledger.md"],
    ["the rendered ledger", "docs/feature-ledger.html"],
    ["docs/guide, which a menu test reads", "docs/guide/keyboard-shortcuts.md"],
    ["CHANGELOG.md, which release tests read", "CHANGELOG.md"],
    ["README.md", "README.md"],
    ["a .claude rule (hooks are tested)", ".claude/rules/70-multi-session-coordination.md"],
    ["a source file", "src/App.tsx"],
    ["a workflow", ".github/workflows/ci.yml"],
    ["a prose prefix nested below the root", "src/docs/adr/x.md"],
    ["a sibling that only shares the prefix's letters", "docs/adrx/y.md"],
    ["a prose root file name in a subdirectory", "docs/CLAUDE.md"],
  ])("answers code for %s", (_label, p) => {
    expect(classifyPaths([p])).toBe("code");
    expect(classifyPaths(["docs/adr/0095-x.md", p])).toBe("code");
  });
});

describe("D215-WI-1 docs/research/ is prose", () => {
  // The four research notes moved out of the repo root into docs/research/; nothing
  // executable reads them, so a range that only touches them skips the heavy jobs.
  it("answers prose for a note in docs/research/", () => {
    expect(classifyPaths(["docs/research/milkdown-research.md"])).toBe("prose");
    expect(classifyPaths(["docs/adr/0095-x.md", "docs/research/tauri-mac-app-best-practices.md"])).toBe("prose");
  });

  it("still answers code for a sibling that only shares the prefix's letters", () => {
    expect(classifyPaths(["docs/researchx/y.md"])).toBe("code");
  });
});

/** A throwaway repo with one base commit; returns a helper that commits `file` on a branch and runs the CLI. */
function repoFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-scope-"));
  const git = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  fs.writeFileSync(path.join(dir, "seed.txt"), "seed\n");
  git("add", "seed.txt");
  git("commit", "-q", "-m", "base");
  const base = git("rev-parse", "HEAD");
  const run = (file: string, baseRef = base) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), `${file}\n`);
    git("add", file);
    git("commit", "-q", "-m", file);
    const out = path.join(dir, "gh-output");
    fs.writeFileSync(out, "");
    const r = spawnSync("node", [SCRIPT, baseRef, "HEAD"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, GITHUB_OUTPUT: out },
    });
    return { status: r.status, output: fs.readFileSync(out, "utf8") };
  };
  return { run };
}

describe("ADR95-WI-1 change-scope CLI", () => {
  it("writes code=false for a prose-only range", () => {
    const { run } = repoFixture();
    expect(run("docs/adr/0001-x.md")).toEqual({ status: 0, output: "code=false\n" });
  });

  it("writes code=true when the range touches code", () => {
    const { run } = repoFixture();
    expect(run("src/a.ts")).toEqual({ status: 0, output: "code=true\n" });
  });

  it("writes code=true and exits 0 when the base cannot be resolved", () => {
    const { run } = repoFixture();
    expect(run("docs/adr/0001-x.md", "0000000000000000000000000000000000000000")).toEqual({
      status: 0,
      output: "code=true\n",
    });
  });
});
