// @vitest-environment node
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const SCRIPT = join(ROOT, "scripts/ci/failure-summary.mjs");
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function failedReport(file: string, title: string) {
  return {
    success: false,
    testResults: [{
      name: join(ROOT, file), status: "failed",
      assertionResults: [
        { ancestorTitles: ["suite"], title, status: "failed" },
        { ancestorTitles: ["suite"], title: "passes", status: "passed" },
      ],
    }],
  };
}

async function run(needs: string | undefined, reports: Array<[string, string]> = []) {
  const dir = mkdtempSync(join(tmpdir(), "gh607-summary-"));
  dirs.push(dir);
  const artifacts = join(dir, "artifacts");
  for (const [leg, content] of reports) {
    const legDir = join(artifacts, leg);
    mkdirSync(legDir, { recursive: true });
    writeFileSync(join(legDir, ".ci-vitest-results.json"), content);
  }
  const summary = join(dir, "summary.md");
  const env = { ...process.env, GITHUB_STEP_SUMMARY: summary, NEEDS: needs };
  const result = await new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn("node", [SCRIPT, artifacts], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
  return { result, text: existsSync(summary) ? readFileSync(summary, "utf8") : "" };
}

describe("GH607 diagnostic CI failure summary", () => {
  it("lists every non-success job and each failed test, without passing rows", async () => {
    const needs = JSON.stringify({ scope: { result: "success" }, frontend: { result: "failure" }, "rust-test": { result: "cancelled" }, "prose-checks": { result: "failure" } });
    const { result, text } = await run(needs, [
      ["frontend-ubuntu", JSON.stringify(failedReport("tests/one.test.ts", "first"))],
      ["frontend-macos", JSON.stringify(failedReport("tests/two.test.ts", "second"))],
    ]);
    expect(result.status).toBe(0);
    expect(text.match(/frontend: failure/g)).toHaveLength(1);
    expect(text.match(/rust-test: cancelled/g)).toHaveLength(1);
    expect(text.match(/prose-checks: failure/g)).toHaveLength(1);
    expect(text).toContain("tests/one.test.ts > suite > first");
    expect(text).toContain("tests/two.test.ts > suite > second");
    expect(text).not.toContain("scope: success");
    expect(text).not.toContain("passes");
  }, 60_000);

  it("preserves all non-success results, including skipped and matrix job names", async () => {
    const needs = JSON.stringify({ "frontend (ubuntu-latest)": { result: "failure" }, "rust-test": { result: "skipped" }, scope: { result: "success" } });
    const { result, text } = await run(needs);
    expect(result.status).toBe(0);
    expect(text.match(/frontend \(ubuntu-latest\): failure/g)).toHaveLength(1);
    expect(text.match(/rust-test: skipped/g)).toHaveLength(1);
    expect(text).not.toContain("scope: success");
  }, 60_000);

  it("keeps job diagnostics and exits zero for missing or malformed reports", async () => {
    const needs = JSON.stringify({ frontend: { result: "failure" } });
    for (const reports of [[], [["ubuntu", "{broken"]], [["ubuntu", "{}"]]] as Array<Array<[string, string]>>) {
      const { result, text } = await run(needs, reports);
      expect(result.status).toBe(0);
      expect(text).toContain("frontend: failure");
      expect(text).toContain("no test results");
    }
  }, 60_000);

  it("keeps a later failed test when the first artifact is malformed", async () => {
    const { result, text } = await run(JSON.stringify({ frontend: { result: "failure" } }), [
      ["a-ubuntu", "{broken"],
      ["b-macos", JSON.stringify(failedReport("tests/later.test.ts", "later failure"))],
    ]);
    expect(result.status).toBe(0);
    expect(text).toContain("no test results");
    expect(text.match(/tests\/later\.test\.ts > suite > later failure/g)).toHaveLength(1);
  }, 60_000);

  it("handles missing, malformed, and empty needs without inventing failures", async () => {
    for (const needs of [undefined, "{broken", "{}"] ) {
      const { result, text } = await run(needs);
      expect(result.status).toBe(0);
      expect(text).toContain("no test results");
      expect(text).not.toMatch(/: failure|: cancelled|: skipped/);
    }
  }, 60_000);

  it("emits identical content for the same inputs", async () => {
    const needs = JSON.stringify({ frontend: { result: "failure" } });
    const reports: Array<[string, string]> = [["ubuntu", JSON.stringify(failedReport("tests/one.test.ts", "first"))]];
    const first = await run(needs, reports);
    const second = await run(needs, reports);
    expect(first.result.status).toBe(0);
    expect(second.result.status).toBe(0);
    expect(second.text).toBe(first.text);
  }, 60_000);
});
