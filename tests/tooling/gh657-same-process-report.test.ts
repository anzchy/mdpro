// @vitest-environment node
/** GH657 fix 2: each shard's run report is the source of collected and started identities. */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { artifactName } from "../../scripts/ci/shard-reports.mjs";

const ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(ROOT, "scripts/ci/shard-reports.mjs");
const temporary: string[] = [];
afterEach(() => { for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

type Assertion = { ancestorTitles: string[]; title: string; status: string; duration?: number };
type Report = { testResults: Array<{ name: string; assertionResults: Assertion[] }> };
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh657-process-"));
  temporary.push(root);
  const downloads = path.join(root, "downloads");
  const file = path.join(root, "tests/dynamic.test.ts");
  const stale = `cwd ${fs.mkdtempSync(path.join(root, "list-"))}`;
  const actual = `cwd ${fs.mkdtempSync(path.join(root, "run-"))}`;
  const report: Report = { testResults: [{ name: file, assertionResults: [{ ancestorTitles: ["suite"], title: actual, status: "passed", duration: 1 }] }] };
  const merged = path.join(root, "merged.json");
  fs.writeFileSync(merged, JSON.stringify(report));
  for (let shard = 1; shard <= 2; shard++) {
    const dir = path.join(downloads, artifactName("ubuntu-latest", shard, 1));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ".ci-shard.json"), JSON.stringify({ os: "ubuntu-latest", shard, count: 2, attempt: 1, profile: "ubuntu+rustfmt", sha: "a".repeat(40) }));
    fs.writeFileSync(path.join(dir, ".ci-vitest-tests.json"), JSON.stringify(shard === 1 ? [{ file, name: `suite > ${stale}` }] : []));
    fs.writeFileSync(path.join(dir, ".ci-vitest-results.json"), JSON.stringify(shard === 1 ? report : { testResults: [] }));
  }
  return { root, downloads, file, stale, actual, report, merged };
}

function run(f: ReturnType<typeof fixture>) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, "union", f.downloads, "2", "ubuntu-latest", f.merged, f.root]);
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

it("accepts a per-process temporary path in a name using the run report", async () => {
  const f = fixture();
  const result = await run(f);
  expect([result.status, result.stdout, result.stderr]).toEqual([0, "shard test reports PASS (1 files, 1 tests in 2 shards)\n", ""]);
});

it("fails if the selected shard JSON report is missing", async () => {
  const f = fixture();
  fs.rmSync(path.join(f.downloads, artifactName("ubuntu-latest", 1, 1), ".ci-vitest-results.json"));
  const result = await run(f);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/shard-1-attempt-1.*ci-vitest-results\.json/);
});

it("names duplicate identities collected by different shards", async () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.downloads, artifactName("ubuntu-latest", 2, 1), ".ci-vitest-results.json"), JSON.stringify(f.report));
  const result = await run(f);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`tests/dynamic.test.ts: suite > ${f.actual}`);
  expect(result.stderr).toContain("shards 1 and 2");
});

it("allows duration-less static skips and todos, but counts only started tests", async () => {
  const f = fixture();
  f.report.testResults[0].assertionResults.push(
    { ancestorTitles: ["suite"], title: "static skip", status: "skipped" },
    { ancestorTitles: ["suite"], title: "todo", status: "todo" },
  );
  fs.writeFileSync(path.join(f.downloads, artifactName("ubuntu-latest", 1, 1), ".ci-vitest-results.json"), JSON.stringify(f.report));
  fs.writeFileSync(f.merged, JSON.stringify(f.report));
  const result = await run(f);
  expect([result.status, result.stdout, result.stderr]).toEqual([0, "shard test reports PASS (1 files, 1 tests in 2 shards)\n", ""]);
});

it("names a duration-less pending assertion that never started", async () => {
  const f = fixture();
  f.report.testResults[0].assertionResults.push({ ancestorTitles: ["suite"], title: "queued but unstarted", status: "pending" });
  fs.writeFileSync(path.join(f.downloads, artifactName("ubuntu-latest", 1, 1), ".ci-vitest-results.json"), JSON.stringify(f.report));
  fs.writeFileSync(f.merged, JSON.stringify(f.report));
  const result = await run(f);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("tests/dynamic.test.ts: suite > queued but unstarted");
});

it("names a collected assertion that did not start and is not a static skip", async () => {
  const f = fixture();
  f.report.testResults[0].assertionResults.push({ ancestorTitles: ["suite"], title: "never started", status: "failed" });
  fs.writeFileSync(path.join(f.downloads, artifactName("ubuntu-latest", 1, 1), ".ci-vitest-results.json"), JSON.stringify(f.report));
  fs.writeFileSync(f.merged, JSON.stringify(f.report));
  const result = await run(f);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("tests/dynamic.test.ts: suite > never started");
});

it("fails when the merged started set omits a shard's started identity", async () => {
  const f = fixture();
  fs.writeFileSync(f.merged, JSON.stringify({ testResults: [] }));
  const result = await run(f);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`tests/dynamic.test.ts: suite > ${f.actual}`);
  expect(result.stderr).toContain("1 shard, 0 merged");
});
