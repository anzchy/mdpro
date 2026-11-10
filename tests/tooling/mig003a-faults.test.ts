// @vitest-environment node
/** MIG003a: mutation controls over the real shard and gate commands. */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collect, checkShardReports } from "../../scripts/ci/shard-reports.mjs";
import * as comparator from "../../scripts/ci/compare-report.mjs";
import { job, steps, stepRun } from "../support/workflowBlocks";
import { spawnBudget } from "../support/spawnBudget";

const ROOT = path.resolve(__dirname, "../..");
const SHA = "a".repeat(40);
const compare = (comparator as unknown as { compare: (...args: unknown[]) => { passed: number } }).compare;
const control = () => JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/mig003a/fault-control.json"), "utf8")) as {
  blob: boolean; report: boolean; scope: string; pending: string; mergedStarted: boolean;
};
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function layout(blob: boolean, report: boolean) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mig003a-fault-"));
  dirs.push(root);
  const downloads = path.join(root, "downloads");
  const artifact = path.join(downloads, "frontend-blob-ubuntu-latest-shard-1-attempt-1");
  fs.mkdirSync(path.join(artifact, ".vitest-reports"), { recursive: true });
  if (blob) fs.writeFileSync(path.join(artifact, ".vitest-reports/blob-1-1.json"), "blob");
  fs.writeFileSync(path.join(artifact, ".ci-shard.json"), JSON.stringify({ os: "ubuntu-latest", shard: 1, count: 1, attempt: 1, profile: "ubuntu", sha: SHA }));
  if (report) fs.writeFileSync(path.join(artifact, ".ci-vitest-results.json"), JSON.stringify({ testResults: [] }));
  return { root, downloads, artifact };
}
function gate(scopeResult: string, mergeResult = "success") {
  const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
  const script = stepRun(steps(job(workflow, "ci-gate"))[0]);
  if (!script) throw Error("ci-gate decision step absent");
  const needs = Object.fromEntries(["scope", "prose-checks", "frontend", "frontend-merge", "rust-test"].map((name) =>
    [name, { result: name === "scope" ? scopeResult : name === "frontend-merge" ? mergeResult : "success", outputs: name === "scope" ? { code: "true" } : {} }]));
  return new Promise<{ status: number | null; stdout: string }>((resolve, reject) => {
    const child = spawn("bash", ["-e", "-o", "pipefail", "-c", script], {
      cwd: ROOT, timeout: spawnBudget(1_000), env: { ...process.env, NEEDS: JSON.stringify(needs) },
    });
    let stdout = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout }));
  });
}
function reportWith(status: string, duration?: number) {
  return { success: true, testResults: [{ name: path.join(ROOT, "tests/tooling/fault.test.ts"), status: "passed",
    assertionResults: [{ ancestorTitles: ["fault"], title: "required identity", status, ...(duration === undefined ? {} : { duration }) }] }] };
}

describe("MIG003a fault fixtures", () => {
  it("accepts the complete artifact and rejects the missing blob mutation", () => {
    const good = layout(control().blob, true);
    expect(collect(good.downloads, path.join(good.root, "dest"), 1, "ubuntu-latest", SHA)).toBe("ubuntu");
    const bad = layout(false, true);
    fs.rmSync(bad.artifact, { recursive: true });
    expect(() => collect(bad.downloads, path.join(bad.root, "dest"), 1, "ubuntu-latest", SHA))
      .toThrow(/blob artifact missing/);
  });
  it("accepts the shard report and rejects missing or empty report mutations", () => {
    const good = layout(true, control().report);
    expect(collect(good.downloads, path.join(good.root, "dest"), 1, "ubuntu-latest", SHA)).toBe("ubuntu");
    for (const variant of ["missing", "empty"]) {
      const bad = layout(true, true);
      const file = path.join(bad.artifact, ".ci-vitest-results.json");
      if (variant === "missing") fs.rmSync(file);
      else fs.writeFileSync(file, "");
      expect(() => collect(bad.downloads, path.join(bad.root, "dest"), 1, "ubuntu-latest", SHA))
        .toThrow(/\.ci-vitest-results\.json missing or empty/);
    }
  });
  it("accepts the git failure fail-safe but rejects a crashed scope job at the real gate", async () => {
    expect((await gate(control().scope)).status).toBe(0);
    const failed = await gate("failure");
    expect(failed.status).toBe(1);
    expect(failed.stdout).toContain("ci-gate: a job ended in failure, was cancelled, or skipped without scope's code=false");
  }, spawnBudget(1_000));
  it("runs change-scope on a git failure as the classifier green control", async () => {
    const result = await new Promise<{ status: number | null; stdout: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(ROOT, "scripts/ci/change-scope.mjs"), "bad-ref", "HEAD"], {
        cwd: ROOT, timeout: spawnBudget(1_000), env: { ...process.env, GITHUB_OUTPUT: "", GITHUB_STEP_SUMMARY: "" },
      });
      let stdout = "";
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
      child.on("error", reject);
      child.on("close", (status) => resolve({ status, stdout }));
    });
    expect(result).toEqual({ status: 0, stdout: "code=true\ndeps=true\neditor=true\npipeline=true\nci=true\nipc=true\nplatform=true\n" });
  }, spawnBudget(1_000));
  it("rejects required pending and todo identities through the real comparator", () => {
    const inventory = { schemaVersion: 1, tests: [{ id: ["tests/tooling/fault.test.ts", "fault", "required identity"], prerequisite: "rustfmt" }], exclusions: [] };
    expect(compare("ci", reportWith(control().pending, 1), inventory, "ubuntu+rustfmt", ROOT).passed).toBe(1);
    for (const status of ["pending", "todo"]) {
      expect(() => compare("ci", reportWith(status), inventory, "ubuntu+rustfmt", ROOT))
        .toThrow(new RegExp(`Inventory test incomplete:.*required identity.*${status}`));
    }
  });
  it("rejects a collected identity missing from merged started identities", () => {
    const good = layout(true, true);
    fs.writeFileSync(path.join(good.artifact, ".ci-vitest-results.json"), JSON.stringify(reportWith("passed", 1)));
    expect(checkShardReports(good.downloads, 1, "ubuntu-latest", reportWith("passed", control().mergedStarted ? 1 : undefined), ROOT))
      .toEqual({ files: 1, tests: 1 });
    expect(() => checkShardReports(good.downloads, 1, "ubuntu-latest", reportWith("passed"), ROOT))
      .toThrow(/merged started identities differ from shard reports:.*required identity/);
  });
  it("turns ci-gate red when either pending mutation fails frontend-merge", async () => {
    expect((await gate("success", "success")).status).toBe(0);
    for (const mutation of ["required pending or todo", "merged started identity mismatch"]) {
      const failed = await gate("success", "failure");
      expect(failed.status, mutation).toBe(1);
      expect(failed.stdout).toContain("ci-gate: a job ended in failure, was cancelled, or skipped without scope's code=false");
    }
  }, spawnBudget(1_000));
});
