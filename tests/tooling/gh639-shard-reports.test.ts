// @vitest-environment node
/**
 * GH639: the merge job's shard collector and completeness check (`scripts/ci/shard-reports.mjs`).
 *
 * `collect` takes the newest attempt of each of the N shards' blob artifacts, checks each artifact's
 * `.ci-shard.json` against its folder name and the merge job's commit, and copies exactly N blobs into an
 * empty folder for `vitest --merge-reports`. `checkMerged` proves the merged report holds every test file
 * once, and as many tests as the shards ran.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { artifactName, checkMerged, collect, describeShard } from "../../scripts/ci/shard-reports.mjs";

const SHA = "a".repeat(40);
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh639-shards-"));
  dirs.push(dir);
  return dir;
}

interface ShardOptions { os?: string; count?: number; profile?: string; sha?: string; blob?: string; meta?: Record<string, unknown> | null; results?: unknown }

/** Lays out one downloaded blob artifact the way upload-artifact stores the shard's four paths. */
function shard(downloads: string, index: number, attempt: number, options: ShardOptions = {}) {
  const runner = options.os ?? "ubuntu-latest";
  const count = options.count ?? 3;
  const folder = path.join(downloads, artifactName(runner, index, attempt));
  fs.mkdirSync(path.join(folder, ".vitest-reports"), { recursive: true });
  fs.writeFileSync(path.join(folder, ".vitest-reports", `blob-${index}-${count}.json`), options.blob ?? `blob ${index} attempt ${attempt}`);
  const meta = { os: runner, shard: index, count, attempt, profile: options.profile ?? "ubuntu+rustfmt", sha: options.sha ?? SHA, ...options.meta };
  if (options.meta !== null) fs.writeFileSync(path.join(folder, ".ci-shard.json"), JSON.stringify(meta));
  fs.writeFileSync(path.join(folder, ".ci-vitest-results.json"), JSON.stringify(options.results ?? { success: true, numTotalTests: 0, testResults: [] }));
  return folder;
}

const listing = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);
const read = (dir: string, name: string) => fs.readFileSync(path.join(dir, name), "utf8");

describe("GH639 collect", () => {
  it("copies exactly one blob per shard and returns the shards' profile", () => {
    const root = tmp();
    const downloads = path.join(root, "downloads");
    const dest = path.join(root, ".vitest-reports");
    for (const index of [1, 2, 3]) shard(downloads, index, 1);
    expect(collect(downloads, dest, 3, "ubuntu-latest", SHA)).toBe("ubuntu+rustfmt");
    expect(listing(dest)).toEqual(["blob-1-3.json", "blob-2-3.json", "blob-3-3.json"]);
    for (const index of [1, 2, 3]) expect(read(dest, `blob-${index}-3.json`)).toBe(`blob ${index} attempt 1`);
  });

  it("takes a re-run shard's newest attempt and keeps the other shards' first attempt", () => {
    const root = tmp();
    const downloads = path.join(root, "downloads");
    const dest = path.join(root, ".vitest-reports");
    shard(downloads, 1, 1);
    shard(downloads, 2, 1, { blob: "stale A" });
    shard(downloads, 2, 2, { blob: "fresh B" });
    shard(downloads, 3, 1);
    collect(downloads, dest, 3, "ubuntu-latest", SHA);
    expect(listing(dest)).toEqual(["blob-1-3.json", "blob-2-3.json", "blob-3-3.json"]);
    expect([1, 2, 3].map((index) => read(dest, `blob-${index}-3.json`))).toEqual(["blob 1 attempt 1", "fresh B", "blob 3 attempt 1"]);
  });

  it("orders attempts by number, so attempt 10 beats attempt 9", () => {
    const root = tmp();
    const downloads = path.join(root, "downloads");
    const dest = path.join(root, ".vitest-reports");
    shard(downloads, 1, 9, { blob: "attempt 9" });
    shard(downloads, 1, 10, { blob: "attempt 10" });
    shard(downloads, 2, 1);
    shard(downloads, 3, 1);
    collect(downloads, dest, 3, "ubuntu-latest", SHA);
    expect(read(dest, "blob-1-3.json")).toBe("attempt 10");
  });

  it("merges a later run attempt's merge job from first-attempt shard artifacts alone", () => {
    const root = tmp();
    const downloads = path.join(root, "downloads");
    const dest = path.join(root, ".vitest-reports");
    for (const index of [1, 2, 3]) shard(downloads, index, 1);
    expect(collect(downloads, dest, 3, "ubuntu-latest", SHA)).toBe("ubuntu+rustfmt");
    expect(listing(dest)).toHaveLength(3);
  });

  it("refuses when a shard's artifact is missing, and writes nothing", () => {
    const root = tmp();
    const downloads = path.join(root, "downloads");
    const dest = path.join(root, ".vitest-reports");
    shard(downloads, 1, 1);
    shard(downloads, 3, 1);
    expect(() => collect(downloads, dest, 3, "ubuntu-latest", SHA)).toThrow(/shard 2.*missing/);
    expect(listing(dest)).toEqual([]);
  });

  it("refuses an artifact that holds no blob file, and writes nothing", () => {
    const root = tmp();
    const downloads = path.join(root, "downloads");
    const dest = path.join(root, ".vitest-reports");
    shard(downloads, 1, 1);
    shard(downloads, 2, 1);
    const third = shard(downloads, 3, 1);
    fs.rmSync(path.join(third, ".vitest-reports", "blob-3-3.json"));
    expect(() => collect(downloads, dest, 3, "ubuntu-latest", SHA)).toThrow(/frontend-blob-ubuntu-latest-shard-3-attempt-1.*blob-3-3\.json/);
    expect(listing(dest)).toEqual([]);
  });

  it("refuses an empty blob file, and writes nothing", () => {
    const root = tmp();
    const downloads = path.join(root, "downloads");
    const dest = path.join(root, ".vitest-reports");
    shard(downloads, 1, 1);
    shard(downloads, 2, 1, { blob: "" });
    shard(downloads, 3, 1);
    expect(() => collect(downloads, dest, 3, "ubuntu-latest", SHA)).toThrow(/frontend-blob-ubuntu-latest-shard-2-attempt-1.*empty/);
    expect(listing(dest)).toEqual([]);
  });

  it.each([
    ["shard", { shard: 3 }],
    ["shard", { shard: "2" }],
    ["os", { os: "macos-latest" }],
    ["count", { count: 4 }],
    ["attempt", { attempt: 2 }],
    ["profile", { profile: "" }],
    ["sha", { sha: "abc" }],
  ])("refuses shard 2's metadata when its %s disagrees with the folder (%j), and writes nothing", (field, meta) => {
    const root = tmp();
    const downloads = path.join(root, "downloads");
    const dest = path.join(root, ".vitest-reports");
    shard(downloads, 1, 1);
    shard(downloads, 2, 1, { meta });
    shard(downloads, 3, 1);
    expect(() => collect(downloads, dest, 3, "ubuntu-latest", SHA)).toThrow(new RegExp(`shard-2-attempt-1.*\\b${field}\\b`));
    expect(listing(dest)).toEqual([]);
  });

  it.each([
    ["missing", null],
    ["malformed", "{not json"],
  ])("refuses shard 2's .ci-shard.json when it is %s, and writes nothing", (_label, content) => {
    const root = tmp();
    const downloads = path.join(root, "downloads");
    const dest = path.join(root, ".vitest-reports");
    shard(downloads, 1, 1);
    const second = shard(downloads, 2, 1, { meta: null });
    if (content !== null) fs.writeFileSync(path.join(second, ".ci-shard.json"), content);
    shard(downloads, 3, 1);
    expect(() => collect(downloads, dest, 3, "ubuntu-latest", SHA)).toThrow(/shard-2-attempt-1.*\.ci-shard\.json/);
    expect(listing(dest)).toEqual([]);
  });

  it("refuses a shard built from another commit than the merge job's, and writes nothing", () => {
    const root = tmp();
    const downloads = path.join(root, "downloads");
    const dest = path.join(root, ".vitest-reports");
    shard(downloads, 1, 1);
    shard(downloads, 2, 1, { sha: "b".repeat(40) });
    shard(downloads, 3, 1);
    expect(() => collect(downloads, dest, 3, "ubuntu-latest", SHA)).toThrow(/shard-2-attempt-1.*\bsha\b/);
    expect(listing(dest)).toEqual([]);
  });

  it("refuses shards whose runner profiles differ, and writes nothing", () => {
    const root = tmp();
    const downloads = path.join(root, "downloads");
    const dest = path.join(root, ".vitest-reports");
    shard(downloads, 1, 1);
    shard(downloads, 2, 1, { profile: "ubuntu" });
    shard(downloads, 3, 1);
    expect(() => collect(downloads, dest, 3, "ubuntu-latest", SHA)).toThrow(/profile.*ubuntu\+rustfmt.*ubuntu/);
    expect(listing(dest)).toEqual([]);
  });

  it.each([
    ["another runner's artifact", "frontend-blob-macos-latest-shard-1-attempt-1"],
    ["a shard index above the count", "frontend-blob-ubuntu-latest-shard-4-attempt-1"],
    ["shard zero", "frontend-blob-ubuntu-latest-shard-0-attempt-1"],
    ["a junk name", "frontend-blob-ubuntu-latest-shard-x"],
  ])("refuses %s in the downloads, and writes nothing", (_label, name) => {
    const root = tmp();
    const downloads = path.join(root, "downloads");
    const dest = path.join(root, ".vitest-reports");
    for (const index of [1, 2, 3]) shard(downloads, index, 1);
    fs.mkdirSync(path.join(downloads, name));
    expect(() => collect(downloads, dest, 3, "ubuntu-latest", SHA)).toThrow(new RegExp(`unexpected.*${name}`));
    expect(listing(dest)).toEqual([]);
  });

  it("refuses a destination that already holds a blob, and leaves it unchanged", () => {
    const root = tmp();
    const downloads = path.join(root, "downloads");
    const dest = path.join(root, ".vitest-reports");
    for (const index of [1, 2, 3]) shard(downloads, index, 1);
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, "blob-2-3.json"), "stale");
    expect(() => collect(downloads, dest, 3, "ubuntu-latest", SHA)).toThrow(/not empty/);
    expect(listing(dest)).toEqual(["blob-2-3.json"]);
    expect(read(dest, "blob-2-3.json")).toBe("stale");
  });

  it("returns the macOS leg's own profile verbatim", () => {
    const root = tmp();
    const downloads = path.join(root, "downloads");
    const dest = path.join(root, ".vitest-reports");
    for (const index of [1, 2, 3]) shard(downloads, index, 1, { os: "macos-latest", profile: "macos+rustfmt" });
    expect(collect(downloads, dest, 3, "macos-latest", SHA)).toBe("macos+rustfmt");
    expect(listing(dest)).toEqual(["blob-1-3.json", "blob-2-3.json", "blob-3-3.json"]);
  });
});

/** A vitest JSON report over `files`, each `[relative path, test count]`, at `root`. */
function report(root: string, files: Array<[string, number]>) {
  return {
    success: true,
    numTotalTests: files.reduce((sum, [, tests]) => sum + tests, 0),
    testResults: files.map(([file, tests]) => ({
      name: path.join(root, file),
      status: "passed",
      assertionResults: Array.from({ length: tests }, (_, i) => ({ ancestorTitles: [], title: `t${i}`, status: "passed" })),
    })),
  };
}

const fileList = (root: string, files: string[]) => files.map((file) => ({ file: path.join(root, file) }));

/** Three shard artifacts at attempt 1 whose JSON reports run `parts[i]`. */
function shards(downloads: string, root: string, parts: Array<Array<[string, number]>>) {
  parts.forEach((files, i) => shard(downloads, i + 1, 1, { results: report(root, files) }));
}

const PARTS: Array<Array<[string, number]>> = [[["tests/a.test.ts", 2], ["tests/b.test.ts", 1]], [["tests/c.test.ts", 4]], [["tests/tooling/d.test.ts", 3]]];
const ALL = PARTS.flat();

describe("GH639 checkMerged", () => {
  it("passes when the shards partition the listed files and the merge holds them all", () => {
    const root = tmp();
    const downloads = path.join(root, "downloads");
    shards(downloads, root, PARTS);
    const result = checkMerged(downloads, 3, "ubuntu-latest", report(root, ALL), fileList(root, ALL.map(([file]) => file)), root);
    expect(result).toEqual({ files: 4, tests: 10 });
  });

  it("refuses a listed test file that no shard ran", () => {
    const root = tmp();
    const downloads = path.join(root, "downloads");
    shards(downloads, root, PARTS);
    const listed = fileList(root, [...ALL.map(([file]) => file), "tests/x.test.ts"]);
    expect(() => checkMerged(downloads, 3, "ubuntu-latest", report(root, ALL), listed, root)).toThrow(/tests\/x\.test\.ts/);
  });

  it("refuses a test file that two shards both ran", () => {
    const root = tmp();
    const downloads = path.join(root, "downloads");
    const parts: Array<Array<[string, number]>> = [PARTS[0], [...PARTS[1], ["tests/a.test.ts", 2]], PARTS[2]];
    shards(downloads, root, parts);
    expect(() => checkMerged(downloads, 3, "ubuntu-latest", report(root, ALL), fileList(root, ALL.map(([file]) => file)), root)).toThrow(/tests\/a\.test\.ts.*shards 1 and 2/);
  });

  it("refuses a merged report that lacks a file a shard ran", () => {
    const root = tmp();
    const downloads = path.join(root, "downloads");
    shards(downloads, root, PARTS);
    const merged = report(root, ALL.filter(([file]) => file !== "tests/c.test.ts"));
    expect(() => checkMerged(downloads, 3, "ubuntu-latest", merged, fileList(root, ALL.map(([file]) => file)), root)).toThrow(/merged report.*tests\/c\.test\.ts/);
  });

  it("refuses a merged test count that differs from the shards' sum", () => {
    const root = tmp();
    const downloads = path.join(root, "downloads");
    shards(downloads, root, PARTS);
    const merged = { ...report(root, ALL), numTotalTests: 9 };
    expect(() => checkMerged(downloads, 3, "ubuntu-latest", merged, fileList(root, ALL.map(([file]) => file)), root)).toThrow(/9.*10/);
  });

  it("compares CJK and spaced paths relative to the root", () => {
    const root = tmp();
    const downloads = path.join(root, "downloads");
    const parts: Array<Array<[string, number]>> = [[["tests/中文 a.test.ts", 2]], PARTS[1], PARTS[2]];
    shards(downloads, root, parts);
    const all = parts.flat();
    expect(checkMerged(downloads, 3, "ubuntu-latest", report(root, all), fileList(root, all.map(([file]) => file)), root)).toEqual({ files: 3, tests: 9 });
    const missing = fileList(root, [...all.map(([file]) => file), "tests/中文 b.test.ts"]);
    expect(() => checkMerged(downloads, 3, "ubuntu-latest", report(root, all), missing, root)).toThrow(/tests\/中文 b\.test\.ts/);
  });

  it("reads each shard's report from the same newest attempt that collect merges", () => {
    for (const [stale, fresh] of [[1, 2], [9, 10]]) {
      const root = tmp();
      const downloads = path.join(root, "downloads");
      shard(downloads, 1, 1, { results: report(root, PARTS[0]) });
      shard(downloads, 2, stale, { results: report(root, [["tests/b2.test.ts", 4]]) });
      shard(downloads, 2, fresh, { results: report(root, [["tests/b2.test.ts", 5]]) });
      shard(downloads, 3, 1, { results: report(root, PARTS[2]) });
      const all: Array<[string, number]> = [...PARTS[0], ["tests/b2.test.ts", 5], ...PARTS[2]];
      expect(checkMerged(downloads, 3, "ubuntu-latest", report(root, all), fileList(root, all.map(([file]) => file)), root), `attempt ${fresh}`).toEqual({ files: 4, tests: 11 });
    }
  });

  it("refuses a file the shards ran that the test file list does not hold", () => {
    const root = tmp();
    const downloads = path.join(root, "downloads");
    shards(downloads, root, PARTS);
    const listed = fileList(root, ALL.map(([file]) => file).filter((file) => file !== "tests/tooling/d.test.ts"));
    expect(() => checkMerged(downloads, 3, "ubuntu-latest", report(root, ALL), listed, root)).toThrow(/not in the test file list.*tests\/tooling\/d\.test\.ts/);
  });
});

const FIELDS = { os: "ubuntu-latest", shard: "2", count: "3", attempt: "1", profile: "ubuntu+rustfmt", sha: SHA };

describe("GH639 describeShard", () => {
  it("turns the writer step's string arguments into the metadata collect expects", () => {
    expect(describeShard(FIELDS)).toEqual({ os: "ubuntu-latest", shard: 2, count: 3, attempt: 1, profile: "ubuntu+rustfmt", sha: SHA });
  });

  it.each([
    ["os", ""],
    ["shard", ""],
    ["shard", "0"],
    ["shard", "4"],
    ["shard", "1.5"],
    ["count", "x"],
    ["attempt", "0"],
    ["profile", ""],
    ["sha", ""],
    ["sha", "A".repeat(40)],
    ["sha", "a".repeat(39)],
  ])("refuses %s %j", (field, value) => {
    expect(() => describeShard({ ...FIELDS, [field]: value })).toThrow(new RegExp(`\\b${field}\\b`));
  });
});

const SCRIPT = path.resolve(__dirname, "../../scripts/ci/shard-reports.mjs");

function cli(args: string[]) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

describe("GH639 shard-reports CLI", () => {
  it("collect prints only the profile on success, and nothing on stdout with exit 1 on failure", async () => {
    const root = tmp();
    const downloads = path.join(root, "downloads");
    for (const index of [1, 2, 3]) shard(downloads, index, 1);
    const ok = await cli(["collect", downloads, path.join(root, "out"), "3", "ubuntu-latest", SHA]);
    expect(ok).toMatchObject({ status: 0, stdout: "ubuntu+rustfmt\n" });
    expect(listing(path.join(root, "out"))).toEqual(["blob-1-3.json", "blob-2-3.json", "blob-3-3.json"]);
    const bad = await cli(["collect", downloads, path.join(root, "out2"), "3", "ubuntu-latest", "b".repeat(40)]);
    expect(bad.status).toBe(1);
    expect(bad.stdout).toBe("");
    expect(bad.stderr).toMatch(/shard-reports collect FAIL: .*sha/);
    expect(listing(path.join(root, "out2"))).toEqual([]);
  });

  it("describe prints the metadata JSON, and check reads the merged report and file list from disk", async () => {
    const described = await cli(["describe", "ubuntu-latest", "2", "3", "1", "ubuntu+rustfmt", SHA]);
    expect(described.status).toBe(0);
    expect(JSON.parse(described.stdout)).toEqual({ os: "ubuntu-latest", shard: 2, count: 3, attempt: 1, profile: "ubuntu+rustfmt", sha: SHA });
    expect((await cli(["describe", "ubuntu-latest", "2", "3", "1", "ubuntu+rustfmt", ""])).status).toBe(1);

    const root = tmp();
    const downloads = path.join(root, "downloads");
    shards(downloads, root, PARTS);
    fs.writeFileSync(path.join(root, "merged.json"), JSON.stringify(report(root, ALL)));
    fs.writeFileSync(path.join(root, "list.json"), JSON.stringify(fileList(root, ALL.map(([file]) => file))));
    const checked = await cli(["check", downloads, "3", "ubuntu-latest", path.join(root, "merged.json"), path.join(root, "list.json"), root]);
    expect(checked).toMatchObject({ status: 0, stdout: "shard reports PASS (4 files, 10 tests in 3 shards)\n" });
    fs.writeFileSync(path.join(root, "list.json"), JSON.stringify(fileList(root, [...ALL.map(([file]) => file), "tests/x.test.ts"])));
    const failed = await cli(["check", downloads, "3", "ubuntu-latest", path.join(root, "merged.json"), path.join(root, "list.json"), root]);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toMatch(/tests\/x\.test\.ts/);
  });

  it("leaves the failure summary able to list a failed test from one shard's JSON artifact", async () => {
    const root = tmp();
    const artifacts = path.join(root, "artifacts");
    const leg = path.join(artifacts, "frontend-vitest-ubuntu-latest-shard-2");
    fs.mkdirSync(leg, { recursive: true });
    const failed = { success: false, testResults: [{ name: path.join(root, "tests/shard-two.test.ts"), status: "failed", assertionResults: [{ ancestorTitles: ["suite"], title: "breaks", status: "failed" }] }] };
    fs.writeFileSync(path.join(leg, ".ci-vitest-results.json"), JSON.stringify(failed));
    const summary = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, [path.resolve(__dirname, "../../scripts/ci/failure-summary.mjs"), artifacts], { env: { ...process.env, GITHUB_STEP_SUMMARY: "", NEEDS: JSON.stringify({ frontend: { result: "failure" } }) }, stdio: ["ignore", "pipe", "ignore"] });
      let out = "";
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => { out += chunk; });
      child.on("error", reject);
      child.on("close", () => resolve(out));
    });
    expect(summary).toContain("- tests/shard-two.test.ts > suite > breaks");
    expect(summary).toContain("- frontend: failure");
  });
});
