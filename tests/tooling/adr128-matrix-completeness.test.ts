// @vitest-environment node
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { job, scalar, steps, stepRun } from "../support/workflowBlocks";
// @ts-expect-error -- plain ESM repo tool has no declaration file
import { checkCriticalCoverage } from "../../scripts/ci/check-critical-coverage.mjs";
// @ts-expect-error -- plain ESM repo tool has no declaration file
import { compare } from "../../scripts/ci/compare-report.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const reportFile = path.join(root, "tests/example.test.ts");
const id = (title: string) => ["tests/example.test.ts", "suite", title];
const report = (results: Array<{ title: string; status: string }>) => ({ success: true, testResults: [{ name: reportFile, status: "passed", assertionResults: results.map(({ title, status }) => ({ ancestorTitles: ["suite"], title, status })) }] });
const inventory = (tag: string, title = "required") => ({ schemaVersion: 1, tests: [{ id: id(title), prerequisite: tag }], exclusions: [] });
function child(args: string[], env: NodeJS.ProcessEnv = process.env) {
  return new Promise<{ status: number | null; stdout: string }>(done => {
    const profile = args[0]?.endsWith("/runner-profile.mjs");
    const emptyHome = profile ? fs.mkdtempSync(path.join(os.tmpdir(), "adr128-profile-empty-")) : null;
    const childEnv = emptyHome ? { ...env, HOME: emptyHome, PATH: "" } : env;
    execFile(process.execPath, args, { cwd: root, env: childEnv, encoding: "utf8" }, (error, stdout) => {
      if (emptyHome) fs.rmSync(emptyHome, { recursive: true, force: true });
      done({ status: error ? (typeof error.code === "number" ? error.code : null) : 0, stdout });
    });
  });
}

describe("ADR128 matrix completeness", () => {
  it("rejects a branch-only critical-path drop when lines remain 100%", () => {
    const metric = (pct: number) => ({ total: 100, covered: pct, skipped: 0, pct });
    const summary = { "/repo/src/a.ts": { lines: metric(100), branches: metric(99.99) } };
    const config = { criticalPaths: [{ glob: "src/**/*.ts", thresholds: { lines: 100, branches: 100 } }] };
    expect(() => checkCriticalCoverage(summary, config)).toThrow(/branches/);
  });
  it("rejects a partial report and a missing inventory ID beside a passing peer", () => {
    const list = inventory("plugin");
    expect(() => compare("ci", { success: true, testResults: [{ name: reportFile, status: "passed" }] }, list, "ubuntu", root)).toThrow(/Malformed/);
    expect(() => compare("ci", report([{ title: "ordinary", status: "passed" }]), list, "ubuntu", root)).toThrow(/not collected/);
  });
  it("rejects unexplained skips on both CI profiles", () => {
    for (const profile of ["ubuntu", "macos"]) {
      const macStatus = profile === "ubuntu" ? "skipped" : "passed";
      const results = report([{ title: "required", status: macStatus }, { title: "unlisted", status: "skipped" }]);
      expect(() => compare("ci", results, inventory("macos"), profile, root), profile).toThrow(/Unexplained skip/);
    }
  });
  it("rejects a failed inventory case for each prerequisite group", () => {
    for (const tag of ["plugin", "macos", "hook-token", "rustfmt"]) {
      expect(() => compare("verify", report([{ title: "required", status: "failed" }]), inventory(tag), "macos", root), tag).toThrow(/did not pass/);
    }
  });
  it("computes Ubuntu and macOS runner profiles from the actual CLI", async () => {
    const script = path.join(root, "scripts/ci/runner-profile.mjs");
    expect((await child([script], { ...process.env, RUNNER_OS: "Linux" })).stdout.trim()).toBe("ubuntu");
    expect((await child([script], { ...process.env, RUNNER_OS: "macOS" })).stdout.trim()).toBe("macos");
  });
  it("fails each real local prerequisite probe when its resource is absent", async () => {
    const script = pathToFileURL(path.join(root, "scripts/ci/verify-inventory.mjs")).href;
    const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), "adr128-prereq-"));
    try {
      for (const tag of ["plugin", "macos", "hook-token", "rustfmt"]) {
        const code = `Object.defineProperty(process,'platform',{value:'linux'});const m=await import(${JSON.stringify(script)});process.stdout.write(String(m.hasPrerequisite(${JSON.stringify(tag)})));`;
        const result = await child(["--input-type=module", "-e", code], { ...process.env, HOME: emptyHome, PATH: "" });
        expect(result.status, tag).toBe(0);
        expect(result.stdout.trim(), tag).toBe("false");
      }
    } finally { fs.rmSync(emptyHome, { recursive: true, force: true }); }
  });
  it("keeps workflow gate commands ordered and the frontend job failure authoritative", () => {
    const text = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
    const frontend = job(text, "frontend");
    const commands = steps(frontend).map(stepRun);
    const coverage = commands.indexOf("pnpm exec vitest run --coverage --reporter=default --reporter=json --outputFile=.ci-vitest-results.json");
    const critical = commands.indexOf("node scripts/ci/check-critical-coverage.mjs");
    const comparator = commands.findIndex((command) => command?.startsWith("node scripts/ci/compare-report.mjs ci "));
    expect(coverage).toBeGreaterThanOrEqual(0);
    expect(critical).toBeGreaterThan(coverage);
    expect(comparator).toBeGreaterThan(critical);
    expect(scalar(frontend, "continue-on-error")).toBeNull();
  });
});
