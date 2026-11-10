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
import { classifyPaths, PROSE_PREFIXES, PROSE_ROOT_FILES } from "../../scripts/ci/change-scope.mjs";
import { collectionCases } from "../support/collectionCases";
import { spawnBudget } from "../support/spawnBudget";

const SCRIPT = path.resolve(__dirname, "..", "..", "scripts", "ci", "change-scope.mjs");

describe("ADR95-WI-1 classifyPaths", () => {
  it("answers code for an empty list (fail-safe)", () => {
    expect(classifyPaths([])).toBe("code");
  });

  it.each(collectionCases("tests/tooling/ci-change-scope.test.ts:25", [...PROSE_PREFIXES.map((p) => `${p}x.md`), ...PROSE_ROOT_FILES]))("answers prose for %s alone", (p) => {
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
    ["the design doc, which four tests read", "design/DESIGN.md"],
    ["a design prototype, which a test helper reads", "design/prototypes/011-d260-settings-rail.html"],
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
  const run = (file: string, baseRef = base, summary = false) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), `${file}\n`);
    git("add", file);
    git("commit", "-q", "-m", file);
    const out = path.join(dir, "gh-output");
    fs.writeFileSync(out, "");
    const summaryPath = path.join(dir, "gh-summary");
    fs.writeFileSync(summaryPath, "");
    const env: NodeJS.ProcessEnv = { ...process.env, GITHUB_OUTPUT: out };
    if (summary) env.GITHUB_STEP_SUMMARY = summaryPath;
    else delete env.GITHUB_STEP_SUMMARY;
    const r = spawnSync("node", [SCRIPT, baseRef, "HEAD"], {
      cwd: dir,
      encoding: "utf8",
      env,
      timeout: spawnBudget(1_000),
    });
    return { status: r.status, output: fs.readFileSync(out, "utf8"), summary: fs.readFileSync(summaryPath, "utf8") };
  };
  return { run, dir, base };
}

describe("ADR95-WI-1 change-scope CLI", () => {
  it("writes code=false for a prose-only range", () => {
    const { run } = repoFixture();
    expect(run("docs/adr/0001-x.md")).toEqual({ status: 0, output: "code=false\ndeps=false\neditor=false\npipeline=false\nci=false\nipc=false\nplatform=false\n", summary: "" });
  });

  it("writes code=true when the range touches code", () => {
    const { run } = repoFixture();
    expect(run("src/a.ts")).toEqual({ status: 0, output: "code=true\ndeps=false\neditor=false\npipeline=false\nci=false\nipc=false\nplatform=false\n", summary: "" });
  });

  it("writes code=true and exits 0 when the base cannot be resolved", () => {
    const { run } = repoFixture();
    expect(run("docs/adr/0001-x.md", "0000000000000000000000000000000000000000")).toEqual({
      status: 0,
      output: "code=true\ndeps=true\neditor=true\npipeline=true\nci=true\nipc=true\nplatform=true\n",
      summary: "",
    });
  });

  it("writes a class-activating range to output and summary", () => {
    const { run } = repoFixture();
    expect(run("src/services/editor/port.ts", undefined, true)).toEqual({
      status: 0,
      output: "code=true\ndeps=false\neditor=true\npipeline=false\nci=false\nipc=true\nplatform=false\n",
      summary: "Risk classes: deps=false editor=true pipeline=false ci=false ipc=true platform=false\n",
    });
  }, spawnBudget(1_000));

  it("classifies a changed non-ASCII editor path from git", () => {
    const { run } = repoFixture();
    expect(run("src/plugins/文字.ts")).toEqual({
      status: 0,
      output: "code=true\ndeps=false\neditor=true\npipeline=false\nci=false\nipc=false\nplatform=false\n",
      summary: "",
    });
  }, spawnBudget(1_000));

  it("preserves the legacy code gate for a non-ASCII prose filename", () => {
    const { run } = repoFixture();
    expect(run("docs/adr/文字.md")).toEqual({
      status: 0,
      output: "code=true\ndeps=false\neditor=false\npipeline=false\nci=false\nipc=false\nplatform=false\n",
      summary: "",
    });
  }, spawnBudget(1_000));

  it("classifies a changed editor path containing a newline", () => {
    const { run } = repoFixture();
    expect(run("src/plugins/a\nb.ts")).toEqual({
      status: 0,
      output: "code=true\ndeps=false\neditor=true\npipeline=false\nci=false\nipc=false\nplatform=false\n",
      summary: "",
    });
  }, spawnBudget(1_000));

  it("keeps scope successful when the optional summary cannot be written", () => {
    const { dir, base } = repoFixture();
    const output = path.join(dir, "summary-error-output");
    const r = spawnSync("node", [SCRIPT, base, "HEAD"], {
      cwd: dir, encoding: "utf8", timeout: spawnBudget(1_000),
      env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: path.join(dir, "missing-parent/summary") },
    });
    expect([r.status, fs.readFileSync(output, "utf8"), r.stderr.includes("change-scope: risk summary unavailable")])
      .toEqual([0, "code=true\ndeps=true\neditor=true\npipeline=true\nci=true\nipc=true\nplatform=true\n", true]);
  }, spawnBudget(1_000));

  it.each([
    ["no PR base", "", "HEAD", "no PR base"],
    ["git failed", "bad-ref", "HEAD", "git failed"],
    ["empty diff", "HEAD", "HEAD", "empty diff"],
  ])("forces every class for %s and appends one summary line", (_name, baseRef, headRef, reason) => {
    const { dir } = repoFixture();
    const output = path.join(dir, "output-extra");
    const summary = path.join(dir, "summary-extra");
    const r = spawnSync("node", [SCRIPT, baseRef, headRef], {
      cwd: dir, encoding: "utf8", timeout: spawnBudget(1_000),
      env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary },
    });
    expect([r.status, fs.readFileSync(output, "utf8"), fs.readFileSync(summary, "utf8")]).toEqual([
      0, "code=true\ndeps=true\neditor=true\npipeline=true\nci=true\nipc=true\nplatform=true\n",
      `Risk classes: deps=true editor=true pipeline=true ci=true ipc=true platform=true (all true: ${reason})\n`,
    ]);
  }, spawnBudget(1_000));

  it("writes seven ordered lines to stdout with GITHUB_OUTPUT unset", () => {
    const { dir, base } = repoFixture();
    const env = { ...process.env };
    delete env.GITHUB_OUTPUT;
    delete env.GITHUB_STEP_SUMMARY;
    const r = spawnSync("node", [SCRIPT, base, "HEAD"], {
      cwd: dir, encoding: "utf8", timeout: spawnBudget(1_000),
      env,
    });
    expect([r.status, r.stdout]).toEqual([0, "code=true\ndeps=true\neditor=true\npipeline=true\nci=true\nipc=true\nplatform=true\n"]);
  }, spawnBudget(1_000));

  it.each([
    ["code", 'const line = `code=${scope === "code"}\\n`;', 'const line = "code=bad\\n";'],
    ["class value", "const names = Object.keys(RISK_GLOBS);", "classes.deps = false; const names = Object.keys(RISK_GLOBS);"],
    ["class order", "const names = Object.keys(RISK_GLOBS);", "const names = Object.keys(RISK_GLOBS).reverse();"],
  ])("rejects a changed %s in the existing CLI pin", (_name, before, after) => {
    const { dir } = repoFixture();
    const source = fs.readFileSync(SCRIPT, "utf8");
    expect(source).toContain(before);
    const mutant = path.join(fs.realpathSync(dir), "change-scope-mutant.mjs");
    fs.writeFileSync(mutant, source.replace(before, after));
    const output = path.join(dir, "mutant-output");
    const r = spawnSync("node", [mutant, "bad-ref", "HEAD"], {
      cwd: dir, encoding: "utf8", timeout: spawnBudget(1_000),
      env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: "" },
    });
    expect(r.status).toBe(0);
    expect(fs.readFileSync(output, "utf8")).not.toBe("code=true\ndeps=true\neditor=true\npipeline=true\nci=true\nipc=true\nplatform=true\n");
  }, spawnBudget(1_000));
});
