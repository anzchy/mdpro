// @vitest-environment node
/** GH639 fix 1: runner profile validation and four-shard file partition checks retained after the obsolete count CLI was removed. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { profileFor } from "../../scripts/ci/compare-report.mjs";
import { artifactName, checkMerged, collect, describeShard } from "../../scripts/ci/shard-reports.mjs";

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
