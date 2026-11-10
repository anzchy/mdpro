// @vitest-environment node
/**
 * GH639: ci.yml's sharded frontend lane.
 *
 * `frontend` runs the vitest suite in four shards per runner (ADR-0130 Decision 1), each writing a blob report. `frontend-merge`
 * merges them, enforces the coverage thresholds and the inventory on the merged result only, and proves no
 * test file was lost. `ci-gate` needs both, so a failed, cancelled or skipped shard or merge fails the gate.
 */
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { promisify } from "node:util";
import { entry, job, jobIds, keys as keysOf, list, scalar, steps, stepRun } from "../support/workflowBlocks";

const ROOT = path.resolve(__dirname, "../..");
const TEXT = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
const SHARDS = 4;
const SHARD_RUN = "pnpm exec vitest run --coverage --coverage.thresholds.lines=0 --coverage.thresholds.functions=0 --coverage.thresholds.branches=0 --coverage.thresholds.statements=0 --shard=${{ matrix.shard }}/4 --reporter=default --reporter=blob --reporter=json --outputFile.blob=.vitest-reports/blob-${{ matrix.shard }}-4.json --outputFile.json=.ci-vitest-results.json";

const DESCRIBE_RUN = 'node scripts/ci/shard-reports.mjs describe "${{ matrix.os }}" "${{ matrix.shard }}" 4 "${{ github.run_attempt }}" "$PROFILE" "$(git rev-parse HEAD)" > .ci-shard.json';
const BLOB_NAME = "frontend-blob-${{ matrix.os }}-shard-${{ matrix.shard }}-attempt-${{ github.run_attempt }}";

const COLLECT_RUN = 'profile="$(node scripts/ci/shard-reports.mjs collect .vitest-blobs .vitest-reports 4 "${{ matrix.os }}" "$(git rev-parse HEAD)")"\necho "profile=$profile" >> "$GITHUB_OUTPUT"';
const MERGE_RUN = "pnpm exec vitest --merge-reports --coverage --reporter=default --reporter=json --outputFile.json=.ci-vitest-results.json";
const CRITICAL_RUN = "node scripts/ci/check-critical-coverage.mjs";
const COMPARE_RUN = 'node scripts/ci/compare-report.mjs ci .ci-vitest-results.json tests/ci-inventory.json "$PROFILE" "$PWD"';
const LIST_RUN = "pnpm exec vitest list --filesOnly --json=.ci-vitest-files.json";
const CHECK_RUN = 'node scripts/ci/shard-reports.mjs check .vitest-blobs 4 "${{ matrix.os }}" .ci-vitest-results.json .ci-vitest-files.json "$PWD"';
const UNION_RUN = 'node scripts/ci/shard-reports.mjs union .vitest-blobs 4 "${{ matrix.os }}" .ci-vitest-results.json "$PWD"';

const BASE = "1acb988e";
const runFile = promisify(execFile);
const show = async (file: string) => (await runFile("git", ["show", `${BASE}:${file}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })).stdout;
const scopeWithoutRiskOutputs = (text: string) => ["deps", "editor", "pipeline", "ci", "ipc", "platform"].reduce(
  (remaining, name) => remaining.replace(`  ${name}: \${{ steps.scope.outputs.${name} }}\n`, ""), text);
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** Runs a step's `run:` the way GitHub's default bash shell does (`bash -e`), with its expressions substituted. */
function bash(script: string, cwd: string, values: Record<string, string>, env: NodeJS.ProcessEnv = {}) {
  const text = Object.entries(values).reduce((acc, [expr, value]) => acc.replaceAll(`\${{ ${expr} }}`, value), script);
  expect(text).not.toMatch(/\$\{\{/);
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", text], { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

/** A throwaway git checkout holding a copy of shard-reports.mjs; resolves to its directory and HEAD. */
async function checkout() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh639-step-"));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, "scripts/ci"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "scripts/ci/shard-reports.mjs"), path.join(dir, "scripts/ci/shard-reports.mjs"));
  // shard-reports.mjs imports compare-report.mjs for the runner profile check (GH639 fix 1).
  fs.copyFileSync(path.join(ROOT, "scripts/ci/compare-report.mjs"), path.join(dir, "scripts/ci/compare-report.mjs"));
  const git = ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false"];
  const init = "git init -q && git add -A && git " + git.join(" ") + " commit -q -m init && git rev-parse HEAD";
  const { status, stdout } = await bash(init, dir, {});
  expect(status).toBe(0);
  return { dir, sha: stdout.trim() };
}

const matrix = (id: string) => entry(entry(job(TEXT, id), "strategy")?.body ?? null, "matrix")?.body ?? null;
const withOf = (step: string | null) => entry(step, "with")?.body ?? null;
const uploads = (id: string) => steps(job(TEXT, id)).filter((step) => scalar(step, "uses") === "actions/upload-artifact@v4");
const findRun = (id: string, run: string) => steps(job(TEXT, id)).find((step) => stepRun(step) === run) ?? null;

describe("GH639 frontend shards", () => {
  it("runs four fail-slow shards, each with the exact blob-reporting vitest command", () => {
    expect(list(matrix("frontend"), "shard")).toEqual(["1", "2", "3", "4"]);
    expect(scalar(entry(job(TEXT, "frontend"), "strategy")?.body ?? null, "fail-fast")).toBe("false");
    const step = findRun("frontend", SHARD_RUN);
    expect(step, SHARD_RUN).not.toBeNull();
    expect(scalar(step, "if")).toBeNull();
    expect(scalar(step, "continue-on-error")).toBeNull();
    expect(list(matrix("frontend"), "shard")).toHaveLength(SHARDS);
  });

  it("writes .ci-shard.json after the run and uploads the blob, metadata and JSON under an attempt-named artifact", () => {
    const all = steps(job(TEXT, "frontend"));
    const vitest = all.findIndex((step) => stepRun(step) === SHARD_RUN);
    const writer = all.findIndex((step) => stepRun(step) === DESCRIBE_RUN);
    const upload = all.findIndex((step) => scalar(withOf(step), "name") === BLOB_NAME);
    expect(vitest).toBeGreaterThanOrEqual(0);
    expect(writer).toBeGreaterThan(vitest);
    expect(upload).toBeGreaterThan(writer);
    for (const index of [writer, upload]) {
      expect(scalar(all[index], "if")).toBeNull();
      expect(scalar(all[index], "continue-on-error")).toBeNull();
    }
    const options = withOf(all[upload]);
    expect(scalar(all[upload], "uses")).toBe("actions/upload-artifact@v4");
    expect(entry(options, "path")?.body.split("\n").map((line) => line.trim()).filter(Boolean)).toEqual([".vitest-reports", ".ci-shard.json", ".ci-vitest-results.json"]);
    expect(scalar(options, "include-hidden-files")).toBe("true");
    expect(scalar(options, "if-no-files-found")).toBe("error");
    expect(scalar(options, "overwrite")).toBeNull();
  });

  it("always uploads each shard's own JSON for the failure summary, replacing an earlier attempt's", () => {
    const upload = uploads("frontend").find((step) => scalar(withOf(step), "name") === "frontend-vitest-${{ matrix.os }}-shard-${{ matrix.shard }}") ?? null;
    expect(upload).not.toBeNull();
    expect(scalar(upload, "if")).toBe("always()");
    const options = withOf(upload);
    expect(scalar(options, "path")).toBe(".ci-vitest-results.json");
    expect(scalar(options, "include-hidden-files")).toBe("true");
    expect(scalar(options, "if-no-files-found")).toBe("error");
    expect(scalar(options, "overwrite")).toBe("true");
  });
});

describe("GH639 frontend-merge", () => {
  it("needs every shard, runs only on their success for code changes, and has a budget", () => {
    const merge = job(TEXT, "frontend-merge");
    expect(list(merge, "needs")).toEqual(["scope", "frontend"]);
    // No status function, so GitHub adds the implicit success(): a failed, cancelled or skipped shard skips the merge.
    expect(scalar(merge, "if")).toBe("needs.scope.outputs.code == 'true'");
    expect(scalar(merge, "continue-on-error")).toBeNull();
    expect(scalar(merge, "timeout-minutes")).toBe("15");
    expect(scalar(merge, "runs-on")).toBe("${{ matrix.os }}");
    expect(scalar(entry(merge, "strategy")?.body ?? null, "fail-fast")).toBe("false");
    expect(keysOf(matrix("frontend-merge"))).toEqual(["os"]);
  });

  it("checks out the same commit as the shards on pull requests and on other events", () => {
    const checkouts = (id: string) => steps(job(TEXT, id)).filter((step) => scalar(step, "uses") === "actions/checkout@v6").map((step) => [scalar(step, "if"), scalar(withOf(step), "ref")]);
    expect(checkouts("frontend-merge")).toEqual(checkouts("frontend"));
    expect(checkouts("frontend-merge")).toEqual([["github.event_name == 'pull_request'", "${{ github.event.pull_request.head.sha }}"], ["github.event_name != 'pull_request'", null]]);
    expect(steps(job(TEXT, "frontend-merge")).findIndex((step) => scalar(step, "uses") === "actions/checkout@v6")).toBe(0);
  });

  it("downloads, collects, merges, then runs every check on the merged report, in that exact order", () => {
    const shape = steps(job(TEXT, "frontend-merge")).map((step) => stepRun(step) ?? scalar(step, "uses"));
    expect(shape).toEqual([
      "actions/checkout@v6",
      "actions/checkout@v6",
      "pnpm/action-setup@v4",
      "actions/setup-node@v6",
      "pnpm install --frozen-lockfile",
      "actions/download-artifact@v4",
      COLLECT_RUN,
      MERGE_RUN,
      CRITICAL_RUN,
      COMPARE_RUN,
      LIST_RUN,
      CHECK_RUN,
      UNION_RUN,
      "actions/upload-artifact@v4",
    ]);
    const collectStep = findRun("frontend-merge", COLLECT_RUN);
    expect(scalar(collectStep, "id")).toBe("shards");
    for (const run of [COLLECT_RUN, MERGE_RUN, CRITICAL_RUN, COMPARE_RUN, LIST_RUN, CHECK_RUN, UNION_RUN]) {
      const step = findRun("frontend-merge", run);
      expect(scalar(step, "if"), run).toBeNull();
      expect(scalar(step, "continue-on-error"), run).toBeNull();
      // opus L1: the comparator takes the shards' profile through env, never as an expression inside run:.
      expect(keysOf(entry(step, "env")?.body ?? null), run).toEqual(run === COMPARE_RUN ? ["PROFILE"] : []);
    }
    for (const run of [SHARD_RUN, DESCRIBE_RUN, MERGE_RUN, CRITICAL_RUN, COMPARE_RUN, LIST_RUN, CHECK_RUN, UNION_RUN]) {
      expect(run).not.toMatch(/\|\||\||;|&&|set \+e|exit 0/);
    }
    expect(steps(job(TEXT, "frontend-merge")).some((step) => /(^|[\s"'])coverage\//.test(step))).toBe(false);
  });

  it("fails the collect step, and writes no profile, when collect fails", async () => {
    const { dir } = await checkout();
    fs.mkdirSync(path.join(dir, ".vitest-blobs"));
    const output = path.join(dir, "github-output");
    fs.writeFileSync(output, "");
    const result = await bash(COLLECT_RUN, dir, { "matrix.os": "ubuntu-latest" }, { GITHUB_OUTPUT: output });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/shard 1 of 4.*missing/);
    expect(fs.readFileSync(output, "utf8")).toBe("");
  });

  it("feeds the shards' real metadata writer and upload layout through the collect step, for each runner", async () => {
    const writer = findRun("frontend", DESCRIBE_RUN);
    const upload = steps(job(TEXT, "frontend")).find((step) => scalar(withOf(step), "name") === BLOB_NAME) ?? null;
    const paths = (entry(withOf(upload), "path")?.body ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
    for (const [runner, profile] of [["ubuntu-latest", "ubuntu+rustfmt"], ["macos-latest", "macos+rustfmt"]]) {
      const { dir, sha } = await checkout();
      for (const index of [1, 2, 3, 4]) {
        const values = { "matrix.os": runner, "matrix.shard": String(index), "github.run_attempt": "1" };
        const work = fs.mkdtempSync(path.join(dir, `shard-${index}-`));
        fs.mkdirSync(path.join(work, ".vitest-reports"));
        fs.writeFileSync(path.join(work, ".vitest-reports", `blob-${index}-4.json`), `bytes ${runner} ${index}`);
        fs.writeFileSync(path.join(work, ".ci-vitest-results.json"), "{}");
        fs.symlinkSync(path.join(dir, "scripts"), path.join(work, "scripts"));
        const written = await bash(stepRun(writer ?? "") ?? "", work, values, { PROFILE: profile });
        expect(written.status, written.stderr).toBe(0);
        const name = Object.entries(values).reduce((acc, [expr, value]) => acc.replaceAll(`\${{ ${expr} }}`, value), BLOB_NAME);
        // upload-artifact stores each path relative to the paths' common ancestor, the workspace.
        for (const item of paths) fs.cpSync(path.join(work, item), path.join(dir, ".vitest-blobs", name, item), { recursive: true });
      }
      const output = path.join(dir, "github-output");
      fs.writeFileSync(output, "");
      const collected = await bash(COLLECT_RUN, dir, { "matrix.os": runner }, { GITHUB_OUTPUT: output });
      expect(collected.status, collected.stderr).toBe(0);
      expect(fs.readFileSync(output, "utf8")).toBe(`profile=${profile}\n`);
      expect(fs.readdirSync(path.join(dir, ".vitest-reports")).sort()).toEqual(["blob-1-4.json", "blob-2-4.json", "blob-3-4.json", "blob-4-4.json"]);
      expect(fs.readFileSync(path.join(dir, ".vitest-reports", "blob-2-4.json"), "utf8")).toBe(`bytes ${runner} 2`);
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
    }
  });
});

const DECISION = "Every job succeeded, or skipped for a prose-only change";

/** A `needs` object as GitHub passes it to ci-gate; `results` overrides individual job results. */
function needs(code: "true" | "false", results: Record<string, string | undefined>) {
  const base: Record<string, string | undefined> = { scope: "success", "prose-checks": "success", frontend: "success", "frontend-merge": "success", "rust-test": "success", ...results };
  const out: Record<string, unknown> = {};
  for (const [id, result] of Object.entries(base)) if (result !== undefined) out[id] = { result, outputs: id === "scope" ? { code } : {} };
  return JSON.stringify(out);
}

describe("GH639 ci-gate", () => {
  it.each([
    ["every job succeeded", "true", {}, 0],
    ["a prose-only change skipped the code jobs", "false", { frontend: "skipped", "frontend-merge": "skipped", "rust-test": "skipped" }, 0],
    ["the merge failed", "true", { "frontend-merge": "failure" }, 1],
    ["the merge was cancelled", "true", { "frontend-merge": "cancelled" }, 1],
    ["the merge skipped although scope said code", "true", { "frontend-merge": "skipped" }, 1],
    ["a shard failed and the merge skipped", "true", { frontend: "failure", "frontend-merge": "skipped" }, 1],
    ["a shard was cancelled and the merge skipped", "true", { frontend: "cancelled", "frontend-merge": "skipped" }, 1],
    ["a shard failed while the merge reports success", "true", { frontend: "failure" }, 1],
    ["the merge result is absent", "true", { "frontend-merge": undefined }, 1],
  ] as const)("decides the gate when %s", async (_label, code, results, expected) => {
    const step = steps(job(TEXT, "ci-gate")).find((item) => scalar(item, "name") === DECISION) ?? null;
    const run = stepRun(step ?? "") ?? "";
    const result = await bash(run, ROOT, {}, { NEEDS: needs(code, results) });
    expect(result.status, result.stdout + result.stderr).toBe(expected);
  });

  it("needs the merge job beside every job it needed before, and still not rust-audit", () => {
    const gate = job(TEXT, "ci-gate");
    expect(list(gate, "needs")).toEqual(["scope", "prose-checks", "frontend", "frontend-merge", "rust-test"]);
    expect(scalar(gate, "if")).toBe("always()");
  });

  it("keeps the failure summary's download pattern, which matches the shard and merged JSON but not the blobs", () => {
    const download = steps(job(TEXT, "ci-gate")).find((step) => scalar(step, "uses") === "actions/download-artifact@v4") ?? null;
    const pattern = scalar(withOf(download), "pattern") ?? "";
    expect(pattern).toBe("frontend-vitest-*");
    const glob = new RegExp(`^${pattern.replace("*", ".*")}$`);
    const names = [...uploads("frontend"), ...uploads("frontend-merge")].map((step) => scalar(withOf(step), "name") ?? "");
    expect(names).toEqual([BLOB_NAME, "frontend-vitest-${{ matrix.os }}-shard-${{ matrix.shard }}", "frontend-vitest-${{ matrix.os }}"]);
    expect(names.map((name) => glob.test(name))).toEqual([false, true, true]);
  });
});

describe("GH639 nothing else weakened", () => {
  it("keeps one shard count everywhere", () => {
    const counts = [
      String(list(matrix("frontend"), "shard")?.length),
      /--shard=\$\{\{ matrix\.shard \}\}\/(\d+)/.exec(SHARD_RUN)?.[1],
      / (\d+) "\$\{\{ github\.run_attempt \}\}"/.exec(DESCRIBE_RUN)?.[1],
      /collect \S+ \S+ (\d+) /.exec(COLLECT_RUN)?.[1],
      /check \S+ (\d+) /.exec(CHECK_RUN)?.[1],
    ];
    expect(counts).toEqual(Array(5).fill(String(SHARDS)));
  });

  it("leaves vitest.config.ts byte-identical, adds no vitest config, and overrides thresholds only on the shard run", async () => {
    expect(fs.readFileSync(path.join(ROOT, "vitest.config.ts"), "utf8")).toBe(await show("vitest.config.ts"));
    const { stdout } = await runFile("git", ["ls-tree", "--name-only", BASE], { cwd: ROOT, encoding: "utf8" });
    const configs = (text: string) => text.split("\n").filter((name) => /^vitest.*\.config\./.test(name)).sort();
    expect(configs(fs.readdirSync(ROOT).join("\n"))).toEqual(configs(stdout));
    expect(SHARD_RUN.match(/--coverage\.thresholds\.\w+=\S+/g)).toEqual(["lines", "functions", "branches", "statements"].map((key) => `--coverage.thresholds.${key}=0`));
    expect(TEXT.match(/coverage\.thresholds/g)).toHaveLength(4);
  }, 30_000);

  it("keeps every other job byte-identical to the base", async () => {
    const base = await show(".github/workflows/ci.yml");
    expect(scopeWithoutRiskOutputs(job(TEXT, "scope") ?? "")).toBe(job(base, "scope"));
    for (const id of ["prose-checks", "rust-test", "rust-audit"]) expect(job(TEXT, id), id).toBe(job(base, id));
    expect(jobIds(TEXT)).toEqual(["scope", "prose-checks", "frontend", "frontend-merge", "rust-test", "rust-audit", "ci-gate"]);
  }, 30_000);

  const jobMutations: Array<[string, (text: string) => string, string]> = [
    ["scope non-output byte", (text: string) => text.replace("timeout-minutes: 5", "timeout-minutes: 6"), "scope"],
    ["scope seventh output", (text: string) => text.replace("      platform: ${{ steps.scope.outputs.platform }}", "      platform: ${{ steps.scope.outputs.platform }}\n      seventh: ${{ steps.scope.outputs.seventh }}"), "scope"],
    ...["prose-checks", "rust-test", "rust-audit"].map((id) =>
      [`${id} byte`, (text: string) => text.replace(`  ${id}:\n`, `  ${id}:\n    mutation: true\n`), id] as [string, (text: string) => string, string]),
  ];
  it.each(jobMutations)("rejects mutation of %s", async (_label, mutate, id) => {
    const base = await show(".github/workflows/ci.yml");
    const mutated = mutate(TEXT);
    expect(mutated).not.toBe(TEXT);
    const candidate = id === "scope" ? scopeWithoutRiskOutputs(job(mutated, id) ?? "") : job(mutated, id);
    expect(candidate).not.toBe(job(base, id));
  }, 30_000);

  it("keeps each shard's setup steps as they were, unconditioned, once each, and none of them in the merge job", async () => {
    const base = steps(job(await show(".github/workflows/ci.yml"), "frontend"));
    const now = steps(job(TEXT, "frontend"));
    const profileIndex = base.findIndex((step) => scalar(step, "id") === "runner-profile");
    expect(now.slice(0, profileIndex + 1)).toEqual(base.slice(0, profileIndex + 1));
    const once = ["pnpm build", "pnpm typecheck:tests", "node scripts/lint/conditional-tests.mjs", "git rev-parse HEAD"];
    for (const run of once) {
      expect(now.filter((step) => stepRun(step) === run), run).toHaveLength(1);
      expect(scalar(findRun("frontend", run), "if"), run).toBeNull();
      expect(findRun("frontend-merge", run), run).toBeNull();
    }
    expect(now.filter((step) => scalar(step, "id") === "runner-profile")).toHaveLength(1);
  }, 30_000);

  it("runs the critical-coverage and inventory checks exactly once per leg, in the merge job", () => {
    for (const script of ["scripts/ci/check-critical-coverage.mjs", "scripts/ci/compare-report.mjs"]) {
      const where = jobIds(TEXT).flatMap((id) => steps(job(TEXT, id)).filter((step) => stepRun(step)?.includes(script)).map(() => id));
      expect(where, script).toEqual(["frontend-merge"]);
    }
  });

  it("widens no permission and downloads only this run's blobs", () => {
    for (const id of jobIds(TEXT)) expect(entry(job(TEXT, id), "permissions"), id).toBeNull();
    expect(keysOf(entry(TEXT, "permissions")?.body ?? null)).toEqual(["contents"]);
    const download = steps(job(TEXT, "frontend-merge")).find((step) => scalar(step, "uses") === "actions/download-artifact@v4") ?? null;
    expect(keysOf(withOf(download))).toEqual(["pattern", "path"]);
    expect(scalar(withOf(download), "pattern")).toBe("frontend-blob-${{ matrix.os }}-*");
    expect(scalar(withOf(download), "path")).toBe(".vitest-blobs");
  });

  it("uploads the merged report on every outcome, replacing an earlier attempt's", () => {
    const [upload] = uploads("frontend-merge");
    expect(scalar(upload ?? null, "if")).toBe("always()");
    expect(scalar(withOf(upload ?? null), "path")).toBe(".ci-vitest-results.json");
    expect(scalar(withOf(upload ?? null), "include-hidden-files")).toBe("true");
    expect(scalar(withOf(upload ?? null), "if-no-files-found")).toBe("error");
    expect(scalar(withOf(upload ?? null), "overwrite")).toBe("true");
  });
});

/** The `#` comment block directly above the line `marker` in ci.yml. */
function commentAbove(marker: string) {
  const lines = TEXT.split("\n");
  const at = lines.indexOf(marker);
  expect(at, marker).toBeGreaterThan(0);
  let start = at;
  while (start > 0 && lines[start - 1].trim().startsWith("#")) start--;
  return lines.slice(start, at).join("\n");
}

describe("GH639 fix 1 runner profiles reach the shell through env (opus L1)", () => {
  it("passes each profile output through env, and no run: expands a profile expression", () => {
    expect(scalar(entry(findRun("frontend", DESCRIBE_RUN), "env")?.body ?? null, "PROFILE")).toBe("${{ steps.runner-profile.outputs.profile }}");
    expect(scalar(entry(findRun("frontend-merge", COMPARE_RUN), "env")?.body ?? null, "PROFILE")).toBe("${{ steps.shards.outputs.profile }}");
    const runs = jobIds(TEXT).flatMap((id) => steps(job(TEXT, id)).map((step) => stepRun(step) ?? ""));
    expect(runs.filter((run) => /\$\{\{[^}]*outputs\.profile/.test(run))).toEqual([]);
  });

  it("runs the real describe and compare steps with a $( in the profile without executing it", async () => {
    const { dir } = await checkout();
    const values = { "matrix.os": "ubuntu-latest", "matrix.shard": "1", "github.run_attempt": "1" };
    const described = await bash(DESCRIBE_RUN, dir, values, { PROFILE: "$(touch pwned)" });
    expect(described.status).not.toBe(0);
    expect(described.stderr).toMatch(/profile/);
    const compared = await bash(COMPARE_RUN, dir, {}, { PROFILE: "ubuntu$(touch pwned)" });
    expect(compared.status).not.toBe(0);
    expect(fs.existsSync(path.join(dir, "pwned"))).toBe(false);
  });
});

describe("GH639 fix 1 ADR-0130 citation", () => {
  it("cites ADR-0130 above jobs:, above frontend-merge and above the shard list, and no comment still says three shards", () => {
    for (const marker of ["jobs:", "  frontend-merge:", "        shard: [1, 2, 3, 4]"]) expect(commentAbove(marker), marker).toContain("ADR-0130");
    const comments = ["frontend", "frontend-merge"].flatMap((id) => (job(TEXT, id) ?? "").split("\n")).concat(commentAbove("  frontend-merge:").split("\n")).filter((line) => line.trim().startsWith("#"));
    expect(comments.length).toBeGreaterThan(0);
    expect(comments.filter((line) => /\/3\b|three shards|every `3`/i.test(line))).toEqual([]);
  });
});

describe("GH639 the tag matrix", () => {
  /** Evaluates the one `os` expression shape ci.yml uses, for a given github.ref. */
  function evaluate(expression: string, ref: string) {
    const match = /^\$\{\{ \(startsWith\(github\.ref, '([^']+)'\) && fromJSON\('(\[[^']*\])'\)\) \|\| fromJSON\('(\[[^']*\])'\) \}\}$/.exec(expression);
    expect(match, expression).not.toBeNull();
    const [, prefix, tagged, otherwise] = match ?? [];
    return JSON.parse(ref.startsWith(prefix) ? tagged : otherwise) as string[];
  }

  it("gives shards and merge the same runners as rust-test: both on a v tag, ubuntu otherwise", () => {
    const os = (id: string) => scalar(matrix(id), "os") ?? "";
    expect(os("frontend")).toBe(os("rust-test"));
    expect(os("frontend-merge")).toBe(os("rust-test"));
    expect(evaluate(os("frontend-merge"), "refs/tags/v1.2.3")).toEqual(["ubuntu-latest", "macos-latest"]);
    for (const ref of ["refs/pull/7/merge", "refs/heads/master", "refs/tags/x1"]) expect(evaluate(os("frontend-merge"), ref), ref).toEqual(["ubuntu-latest"]);
  });
});
