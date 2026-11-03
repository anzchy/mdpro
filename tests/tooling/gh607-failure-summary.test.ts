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
  it("renders artifact-derived Markdown and HTML as inert text", async () => {
    const report = failedReport("tests/<img onerror=alert(1)>_x.test.ts", "`pipe|#*_&\\ <progress>");
    report.testResults[0].assertionResults[0].ancestorTitles = ["![alt](https://example.invalid)", "[repair](https://example.invalid)"];
    const { result, text } = await run(JSON.stringify({ "<img onerror=alert(1)>": { result: "failure|<progress>" } }), [
      ["<progress>", "{broken"],
      ["valid", JSON.stringify(report)],
    ]);
    expect(result.status).toBe(0);
    for (const raw of ["![alt]", "[repair](https://example.invalid)", "`pipe|#*_&\\"]) expect(text).not.toContain(raw);
    expect(text).toContain("\\<img");
    expect(text).toContain("\\[repair\\]");
    expect(text).toContain("\\`");
    expect(text).toContain("\\|");
    expect(text).toContain("no test results (\\<progress\\>)");
  }, 60_000);

  it("caps each artifact-derived field independently", async () => {
    const long = (letter: string) => letter.repeat(400);
    const cases: Array<[string, string | undefined, Array<[string, string]>]> = [
      ["title", undefined, [["one", JSON.stringify(failedReport("tests/one.test.ts", long("T")))]]],
      ["job name", JSON.stringify({ [long("J")]: { result: "failure" } }), []],
      ["test path", undefined, [["one", JSON.stringify(failedReport(`tests/${long("P")}.test.ts`, "failed"))]]],
      ["ancestor", undefined, [["one", JSON.stringify({ ...failedReport("tests/one.test.ts", "failed"), testResults: [{ ...failedReport("tests/one.test.ts", "failed").testResults[0], assertionResults: [{ ancestorTitles: [long("A")], title: "failed", status: "failed" }] }] })]]],
      ["job result", JSON.stringify({ frontend: { result: long("R") } }), []],
      ["fallback directory", undefined, [["D".repeat(200), "{broken"]]],
    ];
    for (const [label, needs, reports] of cases) {
      const { result, text } = await run(needs, reports);
      expect(result.status, label).toBe(0);
      expect(text, label).toContain("[truncated]");
      expect(text, label).not.toContain(long(label === "title" ? "T" : label === "job name" ? "J" : label === "test path" ? "P" : label === "ancestor" ? "A" : label === "job result" ? "R" : "D").slice(0, 180));
    }
  }, 60_000);

  it("bounds oversized reports and the number of reports", async () => {
    const huge = await run(undefined, [["huge", JSON.stringify(failedReport("tests/one.test.ts", "X".repeat(1_100_000)))]]);
    expect(huge.result.status).toBe(0);
    expect(huge.text).toContain("[truncated]");
    expect(huge.text).not.toContain("X".repeat(200));
    const reports = Array.from({ length: 25 }, (_, index): [string, string] => [
      `leg-${String(index).padStart(2, "0")}`, JSON.stringify(failedReport("tests/one.test.ts", `failure-${index}`)),
    ]);
    const many = await run(undefined, reports);
    expect(many.result.status).toBe(0);
    expect(many.text).toContain("[truncated]");
    expect(many.text).toContain("failure-0");
    expect(many.text).not.toContain("failure-24");
  }, 60_000);

  it("caps total summary output with an explicit truncation note", async () => {
    const report = failedReport("tests/one.test.ts", "failed");
    report.testResults[0].assertionResults = Array.from({ length: 200 }, (_, index) => ({ ancestorTitles: ["suite"], title: `failure-${index}-${"B".repeat(100)}`, status: "failed" }));
    const { result, text } = await run(undefined, [["many", JSON.stringify(report)]]);
    expect(result.status).toBe(0);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(16_000);
    expect(text).toContain("[truncated]");
  }, 60_000);

});
