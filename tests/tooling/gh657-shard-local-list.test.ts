// @vitest-environment node
/** GH657: shard-local test lists must account for every started test identity. */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { artifactName, checkCollected, collect } from "../../scripts/ci/shard-reports.mjs";
import { entry, job, scalar, steps, stepRun } from "../support/workflowBlocks";

const ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(ROOT, "scripts/ci/shard-reports.mjs");
const WORKFLOW = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
const SHA = "a".repeat(40);
const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh657-shard-"));
  temporary.push(root);
  const downloads = path.join(root, "downloads");
  const mergedPath = path.join(root, "merged.json");
  const files = ["tests/a.test.ts", "tests/b.test.ts", "tests/c.test.ts", "tests/d.test.ts"];
  const names = ["suite > a", "suite > b", "suite > c", "suite > d"];
  for (let i = 1; i <= 4; i++) {
    const dir = path.join(downloads, artifactName("ubuntu-latest", i, 1));
    fs.mkdirSync(path.join(dir, ".vitest-reports"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".vitest-reports", `blob-${i}-4.json`), "blob");
    fs.writeFileSync(path.join(dir, ".ci-shard.json"), JSON.stringify({ os: "ubuntu-latest", shard: i, count: 4, attempt: 1, profile: "ubuntu+rustfmt", sha: SHA }));
    fs.writeFileSync(path.join(dir, ".ci-vitest-tests.json"), JSON.stringify([{ file: path.join(root, files[i - 1]), name: names[i - 1] }]));
  }
  const report = {
    testResults: files.map((file, i) => ({ name: path.join(root, file), assertionResults: [{ ancestorTitles: ["suite"], title: names[i].slice(8), status: "passed", duration: i === 0 ? 0 : 1 }] })),
  };
  fs.writeFileSync(mergedPath, JSON.stringify(report));
  return { root, downloads, mergedPath, files, names, report };
}

function listFile(f: ReturnType<typeof fixture>, shard: number) {
  return path.join(f.downloads, artifactName("ubuntu-latest", shard, 1), ".ci-vitest-tests.json");
}

function setList(f: ReturnType<typeof fixture>, shard: number, rows: unknown) {
  fs.writeFileSync(listFile(f, shard), JSON.stringify(rows));
}

function cli(f: ReturnType<typeof fixture>) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, "union", f.downloads, "4", "ubuntu-latest", f.mergedPath, f.root]);
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

describe("GH657 shard-local identity union", () => {
  it("passes four lists whose file and full-name identities equal the started report", async () => {
    const f = fixture();
    const result = await cli(f);
    expect([result.status, result.stdout, result.stderr]).toEqual([0, "shard test lists PASS (4 files, 4 tests in 4 shards)\n", ""]);
  });

  it("shows the old equal-count false pass but names both sides of an inverse-condition swap", async () => {
    const f = fixture();
    const file = path.join(f.root, f.files[0]);
    setList(f, 1, [{ file, name: "suite > skipped-on-shard" }]);
    const old = checkCollected({ testResults: [{ name: file, assertionResults: [{ ancestorTitles: ["suite"], title: "a", duration: 1 }] }] }, [{ file, name: "suite > skipped-on-shard" }], f.root);
    expect(old).toEqual({ files: 1, tests: 1 });
    const result = await cli(f);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("tests/a.test.ts: suite > skipped-on-shard");
    expect(result.stderr).toContain("tests/a.test.ts: suite > a");
  });

  it("fails closed if the selected shard has no list, even when an older attempt has one", () => {
    const f = fixture();
    fs.rmSync(listFile(f, 3));
    const dest = path.join(f.root, "dest");
    expect(() => collect(f.downloads, dest, 4, "ubuntu-latest", SHA)).toThrow(/shard-3-attempt-1.*ci-vitest-tests\.json/);
    expect(fs.existsSync(dest)).toBe(false);
  });

  it("names a duplicate identity and both shards", async () => {
    const f = fixture();
    setList(f, 4, [{ file: path.join(f.root, f.files[0]), name: f.names[0] }]);
    const result = await cli(f);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/tests\/a\.test\.ts: suite > a.*shards 1 and 4/);
  });

  it("names a listed test that never started and a started test that was never listed", async () => {
    const f = fixture();
    setList(f, 2, [{ file: path.join(f.root, f.files[1]), name: "suite > ghost" }]);
    const result = await cli(f);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("tests/b.test.ts: suite > ghost");
    expect(result.stderr).toContain("tests/b.test.ts: suite > b");
  });

  it("does not collapse repeated full names within a shard", async () => {
    const f = fixture();
    setList(f, 1, [
      { file: path.join(f.root, f.files[0]), name: f.names[0] },
      { file: path.join(f.root, f.files[0]), name: f.names[0] },
    ]);
    const result = await cli(f);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/tests\/a\.test\.ts: suite > a.*2 listed, 1 started/);
  });

  it("refuses a malformed shard list with a named shard", async () => {
    const f = fixture();
    setList(f, 2, [{ file: path.join(f.root, f.files[1]) }]);
    const result = await cli(f);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/shard-2-attempt-1.*malformed.*name/);
  });
});

describe("GH657 workflow", () => {
  const runs = (id: string) => steps(job(WORKFLOW, id)).map((step) => stepRun(step) ?? scalar(step, "uses"));
  it("collects the test list after build and before the shard run, and uploads that list with the blob", () => {
    const all = runs("frontend");
    const build = all.indexOf("pnpm build");
    const list = all.findIndex((run) => run?.includes("vitest list --json=.ci-vitest-tests.json"));
    const shardRun = all.findIndex((run) => run?.includes("vitest run --coverage") && run.includes("--shard=${{ matrix.shard }}/4"));
    expect([build >= 0, list > build, shardRun > list]).toEqual([true, true, true]);
    expect(all[list]).toContain("--shard=${{ matrix.shard }}/4");
    const upload = steps(job(WORKFLOW, "frontend")).find((step) => scalar(entry(step, "with")?.body ?? null, "name")?.startsWith("frontend-blob-")) ?? "";
    expect(entry(entry(upload, "with")?.body ?? null, "path")?.body).toContain(".ci-vitest-tests.json");
  });

  it("runs no serial full test list in merge and checks shard identities after merging", () => {
    const all = runs("frontend-merge");
    expect(all.filter((run) => run?.includes("vitest list --json=.ci-vitest-tests.json"))).toEqual([]);
    const merge = all.findIndex((run) => run?.includes("vitest --merge-reports"));
    const union = all.findIndex((run) => run?.includes("shard-reports.mjs union"));
    expect(union).toBeGreaterThan(merge);
    const step = steps(job(WORKFLOW, "frontend-merge"))[union];
    expect(scalar(step, "if")).toBeNull();
    expect(scalar(step, "continue-on-error")).toBeNull();
  });
});
