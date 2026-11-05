// @vitest-environment node
/**
 * GH639 fix 1: the merge job's unsharded count check (`checkCollected`, gpt H1) and ADR-0130 Decision 1's union clauses.
 *
 * `vitest list --json` collects every test file without sharding and omits static skips and todos. A test that
 * started (passed, failed, or skipped at run time) carries a numeric `duration` in the JSON report; a static skip or a
 * todo does not. So, file by file, the collection must equal the merged report's started tests: a test that exists in
 * the collection but never ran in any shard fails the merge job.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { profileFor } from "../../scripts/ci/compare-report.mjs";
import { artifactName, checkCollected, checkMerged, collect, describeShard } from "../../scripts/ci/shard-reports.mjs";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh639-fix1-"));
  dirs.push(dir);
  return dir;
}

type Assertion = { title?: string; ancestorTitles?: string[]; status: string; duration?: number };
const passed = (title = "t"): Assertion => ({ title, status: "passed", duration: 1 });

/** A merged JSON report: one file entry per key, each with the given assertions. */
function merged(root: string, files: Record<string, Assertion[]>) {
  return {
    success: true,
    numTotalTests: Object.values(files).flat().length,
    testResults: Object.entries(files).map(([file, assertions]) => ({
      name: path.join(root, file),
      status: "passed",
      assertionResults: assertions.map((item, i) => ({ ancestorTitles: item.ancestorTitles ?? [], title: item.title ?? `t${i}`, status: item.status, ...(item.duration === undefined ? {} : { duration: item.duration }) })),
    })),
  };
}

/** `vitest list --json` output: `count` rows per file, absolute paths. */
function collected(root: string, files: Record<string, number | string[]>) {
  return Object.entries(files).flatMap(([file, rows]) => (typeof rows === "number" ? Array.from({ length: rows }, (_, i) => `t${i}`) : rows).map((name) => ({ name, file: path.join(root, file) })));
}

describe("GH639 fix 1 checkCollected", () => {
  it("refuses a collected test that no shard ran", () => {
    const root = tmp();
    expect(() => checkCollected(merged(root, { "tests/a.test.ts": [passed(), passed()] }), collected(root, { "tests/a.test.ts": 3 }), root)).toThrow(/tests\/a\.test\.ts.*3.*2/);
  });

  it("does not count a static skip as started, so it cannot mask a test no shard ran", () => {
    const root = tmp();
    const report = merged(root, { "tests/a.test.ts": [passed(), passed(), { status: "skipped" }] });
    expect(() => checkCollected(report, collected(root, { "tests/a.test.ts": 3 }), root)).toThrow(/tests\/a\.test\.ts.*3.*2/);
  });

  it("counts a test that skipped at run time, which has a duration, as started", () => {
    const root = tmp();
    const report = merged(root, { "tests/a.test.ts": [passed(), passed(), { status: "skipped", duration: 0.2 }] });
    expect(checkCollected(report, collected(root, { "tests/a.test.ts": 3 }), root)).toEqual({ files: 1, tests: 3 });
  });

  it("compares file by file, so a surplus in one file cannot hide a test missing from another", () => {
    const root = tmp();
    const report = merged(root, { "tests/a.test.ts": [passed(), passed(), passed()], "tests/b.test.ts": [passed()] });
    let message = "";
    try {
      checkCollected(report, collected(root, { "tests/a.test.ts": 2, "tests/b.test.ts": 2 }), root);
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain("tests/a.test.ts: 2 collected, 3 started");
    expect(message).toContain("tests/b.test.ts: 2 collected, 1 started");
  });

  it("refuses a collected file the merged report lacks, and a merged file with started tests the collection lacks", () => {
    const root = tmp();
    const report = merged(root, { "tests/a.test.ts": [passed()] });
    expect(() => checkCollected(report, collected(root, { "tests/a.test.ts": 1, "tests/gone.test.ts": 2 }), root)).toThrow("tests/gone.test.ts: 2 collected, 0 started");
    const extra = merged(root, { "tests/a.test.ts": [passed()], "tests/extra.test.ts": [passed()] });
    expect(() => checkCollected(extra, collected(root, { "tests/a.test.ts": 1 }), root)).toThrow("tests/extra.test.ts: 0 collected, 1 started");
  });

  it("passes a realistic mix of passed, static skip, todo and run-time skip across CJK and spaced paths", () => {
    const root = tmp();
    const report = merged(root, {
      "tests/a.test.ts": [passed(), passed(), { status: "skipped" }, { status: "todo" }],
      "tests/中文 b.test.ts": [passed(), { status: "skipped", duration: 0.1 }],
      "tests/tooling/c d.test.ts": [passed()],
    });
    expect(checkCollected(report, collected(root, { "tests/a.test.ts": 2, "tests/中文 b.test.ts": 2, "tests/tooling/c d.test.ts": 1 }), root)).toEqual({ files: 3, tests: 5 });
  });

  it("passes a file whose every test is a static skip or a todo, which the collection omits", () => {
    const root = tmp();
    const report = merged(root, { "tests/a.test.ts": [passed(), passed()], "tests/mac-only.test.ts": [{ status: "skipped" }, { status: "skipped" }, { status: "skipped" }, { status: "todo" }] });
    expect(checkCollected(report, collected(root, { "tests/a.test.ts": 2 }), root)).toEqual({ files: 1, tests: 2 });
  });

  it("counts rows, not distinct titles, so a dropped repeat of a parameterised title fails", () => {
    const root = tmp();
    const report = merged(root, { "tests/p.test.ts": [{ ...passed("case"), ancestorTitles: ["x"] }, { ...passed("case"), ancestorTitles: ["x"] }] });
    expect(() => checkCollected(report, collected(root, { "tests/p.test.ts": ["x > case", "x > case", "x > case"] }), root)).toThrow("tests/p.test.ts: 3 collected, 2 started");
  });

  it("keys files by their path under the root, not their basename", () => {
    const root = tmp();
    const report = merged(root, { "tests/a/x.test.ts": [passed()], "tests/b/x.test.ts": [passed(), passed()] });
    let message = "";
    try {
      checkCollected(report, collected(root, { "tests/a/x.test.ts": 2, "tests/b/x.test.ts": 1 }), root);
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain("tests/a/x.test.ts: 2 collected, 1 started");
    expect(message).toContain("tests/b/x.test.ts: 1 collected, 2 started");
    expect(message).not.toContain(root);
  });

  it("counts a started test timed at zero", () => {
    const root = tmp();
    const report = merged(root, { "tests/a.test.ts": [{ title: "z", status: "passed", duration: 0 }, { title: "y", status: "passed", duration: 3 }] });
    expect(checkCollected(report, collected(root, { "tests/a.test.ts": 2 }), root)).toEqual({ files: 1, tests: 2 });
  });

  it.each([
    ["a collection that is not an array", (root: string) => [merged(root, {}), { file: "x" }]],
    ["a collected row without a file", (root: string) => [merged(root, {}), [{ name: "t" }]]],
    ["a collection given as a string", (root: string) => [merged(root, {}), "tests/a.test.ts"]],
    ["a merged report without testResults", (root: string) => [{ success: true }, collected(root, { "tests/a.test.ts": 1 })]],
  ] as const)("refuses %s", (_label, inputs) => {
    const root = tmp();
    const [report, list] = inputs(root);
    expect(() => checkCollected(report, list, root)).toThrow(/malformed/);
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

describe("GH639 fix 1 shard-reports count", () => {
  it("reads the merged report and the collection from disk, and fails with exit 1 and no stdout on a mismatch", async () => {
    const root = tmp();
    const write = (name: string, value: unknown) => {
      fs.writeFileSync(path.join(root, name), JSON.stringify(value));
      return path.join(root, name);
    };
    const report = write("merged.json", merged(root, { "tests/a.test.ts": [passed(), passed()], "tests/mac-only.test.ts": [{ status: "skipped" }] }));
    const ok = await cli(["count", report, write("tests.json", collected(root, { "tests/a.test.ts": 2 })), root]);
    expect([ok.status, ok.stdout, ok.stderr]).toEqual([0, "collected tests PASS (1 files, 2 tests)\n", ""]);
    const bad = await cli(["count", report, write("tests.json", collected(root, { "tests/a.test.ts": 3 })), root]);
    expect([bad.status, bad.stdout]).toEqual([1, ""]);
    expect(bad.stderr).toMatch(/^shard-reports count FAIL: .*tests\/a\.test\.ts: 3 collected, 2 started/);
  });
});

const FIELDS = { os: "ubuntu-latest", shard: "2", count: "4", attempt: "1", profile: "ubuntu+rustfmt", sha: "a".repeat(40) };

describe("GH639 fix 1 runner profile validation (opus L1)", () => {
  it.each(["ubuntu\nx=1", "$(id)", "ubuntu+rustfmt\n", "windows"])("describeShard refuses the profile %j", (profile) => {
    expect(() => describeShard({ ...FIELDS, profile })).toThrow(/profile/);
  });

  const printable = ["ubuntu", "macos"].flatMap((host) => ["", "+rustfmt"].flatMap((fmt) => ["", "+codex-cli"].map((codex) => `${host}${fmt}${codex}`)));
  it.each([...printable, "ubuntu+codex-cli+rustfmt", "windows", "", "$(id)"])("describeShard accepts %j exactly when compare-report's profileFor does", (profile) => {
    let known = true;
    try {
      profileFor(profile);
    } catch {
      known = false;
    }
    if (known) expect(describeShard({ ...FIELDS, profile }).profile).toBe(profile);
    else expect(() => describeShard({ ...FIELDS, profile })).toThrow(/profile/);
    expect(known).toBe(printable.includes(profile));
  });

  it("collect refuses a shard whose metadata profile would inject a line into $GITHUB_OUTPUT, and copies no blob", () => {
    const root = tmp();
    const downloads = path.join(root, "downloads");
    const dest = path.join(root, ".vitest-reports");
    const sha = "b".repeat(40);
    for (const index of [1, 2, 3, 4]) {
      const folder = path.join(downloads, artifactName("ubuntu-latest", index, 1));
      fs.mkdirSync(path.join(folder, ".vitest-reports"), { recursive: true });
      fs.writeFileSync(path.join(folder, ".vitest-reports", `blob-${index}-4.json`), `blob ${index}`);
      fs.writeFileSync(path.join(folder, ".ci-shard.json"), JSON.stringify({ os: "ubuntu-latest", shard: index, count: 4, attempt: 1, profile: "ubuntu\nx=1", sha }));
    }
    expect(() => collect(downloads, dest, 4, "ubuntu-latest", sha)).toThrow(/profile/);
    expect(fs.existsSync(dest) ? fs.readdirSync(dest) : []).toEqual([]);
  });
});

/** Four shard artifacts at attempt 1, shard i running `parts[i]`, in the layout ci.yml's upload stores. */
function fourShards(downloads: string, root: string, parts: Array<Record<string, Assertion[]>>) {
  parts.forEach((files, i) => {
    const folder = path.join(downloads, artifactName("ubuntu-latest", i + 1, 1));
    fs.mkdirSync(path.join(folder, ".vitest-reports"), { recursive: true });
    fs.writeFileSync(path.join(folder, ".vitest-reports", `blob-${i + 1}-4.json`), `blob ${i + 1}`);
    fs.writeFileSync(path.join(folder, ".ci-shard.json"), JSON.stringify({ os: "ubuntu-latest", shard: i + 1, count: 4, attempt: 1, profile: "ubuntu+rustfmt", sha: "c".repeat(40) }));
    fs.writeFileSync(path.join(folder, ".ci-vitest-results.json"), JSON.stringify(merged(root, files)));
  });
}

describe("GH639 fix 1 ADR-0130 Decision 1 union clauses at N = 4", () => {
  const PARTS: Array<Record<string, Assertion[]>> = [{ "tests/a.test.ts": [passed()] }, { "tests/b.test.ts": [passed()] }, { "tests/c.test.ts": [passed()] }, { "tests/d.test.ts": [passed()] }];
  const all = Object.assign({}, ...PARTS) as Record<string, Assertion[]>;
  const listed = (root: string, files: string[]) => files.map((file) => ({ file: path.join(root, file) }));

  it("passes when the four shards partition the listed files", () => {
    const root = tmp();
    fourShards(path.join(root, "downloads"), root, PARTS);
    expect(checkMerged(path.join(root, "downloads"), 4, "ubuntu-latest", merged(root, all), listed(root, Object.keys(all)), root)).toEqual({ files: 4, tests: 4 });
  });

  it("fails a test file missing from every shard", () => {
    const root = tmp();
    fourShards(path.join(root, "downloads"), root, PARTS);
    expect(() => checkMerged(path.join(root, "downloads"), 4, "ubuntu-latest", merged(root, all), listed(root, [...Object.keys(all), "tests/e.test.ts"]), root)).toThrow(/no shard ran: tests\/e\.test\.ts/);
  });

  it("fails a test file reported by two shards", () => {
    const root = tmp();
    fourShards(path.join(root, "downloads"), root, [PARTS[0], { ...PARTS[1], "tests/d.test.ts": [passed()] }, PARTS[2], PARTS[3]]);
    expect(() => checkMerged(path.join(root, "downloads"), 4, "ubuntu-latest", merged(root, all), listed(root, Object.keys(all)), root)).toThrow(/tests\/d\.test\.ts ran in shards 2 and 4/);
  });

  it("fails when shard 4's artifact is missing", () => {
    const root = tmp();
    fourShards(path.join(root, "downloads"), root, PARTS.slice(0, 3));
    expect(() => collect(path.join(root, "downloads"), path.join(root, ".vitest-reports"), 4, "ubuntu-latest", "c".repeat(40))).toThrow(/shard 4 of 4.*missing/);
  });
});
