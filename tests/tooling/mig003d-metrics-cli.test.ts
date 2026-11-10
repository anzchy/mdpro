// @vitest-environment node
/**
 * MIG-003d (#756): the CLI around `computeMetrics` — argument refusal, the output directory, the GET-only request
 * layer, `collect` over a recording request, and `main` end to end. Nothing here calls the live API: every request goes
 * to an injected recorder. Cases are the matrix's (`MIG003d-test-matrix.md`); each test names its case.
 */
import { describe, expect, it } from "vitest";
import { parseArgs } from "../../scripts/ci/metrics.mjs";

const args = (s: string) => s.split(" ").filter(Boolean);

describe("MIG003d parseArgs: accepted", () => {
  it("C32: a date-only window (since == until) and the labels M0 and M12; until is the end of its day", () => {
    expect([parseArgs(args("--since 2026-11-10 --until 2026-11-10 --label M0")), parseArgs(args("--label M12 --until 2026-11-10 --since 2026-10-13"))]).toEqual([
      { ok: true, since: "2026-11-10T00:00:00Z", until: "2026-11-10T23:59:59Z", label: "M0", scopeRefP90: null },
      { ok: true, since: "2026-10-13T00:00:00Z", until: "2026-11-10T23:59:59Z", label: "M12", scopeRefP90: null },
    ]);
  });
});

const refused = (s: string) => {
  const r = parseArgs(args(s));
  return r.ok ? "accepted" : "refused";
};

describe("MIG003d parseArgs: the date range", () => {
  it("C30: a missing since or until, a reversed range, or an unreadable date is refused", () => {
    expect([
      "--until 2026-11-10 --label M0",
      "--since 2026-10-13 --label M0",
      "--since 2026-11-10 --until 2026-10-13 --label M0",
      "--since 2026-13-40 --until 2026-11-10 --label M0",
      "--since yesterday --until 2026-11-10 --label M0",
    ].map(refused)).toEqual(["refused", "refused", "refused", "refused", "refused"]);
  });
});

describe("MIG003d parseArgs: impossible dates", () => {
  it("C62: a day or hour that Date would roll over (Feb 30, Apr 31, 24:00) is refused, not moved", () => {
    expect([
      "--since 2026-02-30 --until 2026-11-10 --label M0",
      "--since 2026-04-31 --until 2026-11-10 --label M0",
      "--since 2026-10-13 --until 2026-11-10T24:00:00Z --label M0",
    ].map(refused)).toEqual(["refused", "refused", "refused"]);
  });
});

import { computeMetrics } from "../../scripts/ci/metrics.mjs";
import type { MetricsInput, Run } from "../../scripts/ci/metrics.mjs";

describe("MIG003d parseArgs: the datetime form (M0's --until is ticket a's landing time)", () => {
  it("C63 (raw-green guard): exact instants are kept as given; a run one second after until is dropped; mixed forms compare as instants", () => {
    const r = parseArgs(args("--since 2026-10-13T00:00:00Z --until 2026-11-10T08:12:34Z --label M0"));
    const after: Run = { id: 1, event: "pull_request", head_sha: "a", run_attempt: 1, status: "completed", conclusion: "success", run_started_at: "2026-11-10T08:12:35Z", created_at: "2026-11-10T08:12:35Z", pull_requests: [{ number: 1 }] };
    const recorded: MetricsInput = { runs: { "ci.yml": [after], "platform-advisory.yml": [], "webkit-advisory.yml": [] }, attempts: {}, jobs: {}, reports: {} };
    const m = r.ok ? computeMetrics(recorded, { ...r, label: "M0" }) : null;
    expect([r, m?.rerun.headShas, refused("--since 2026-11-10T12:00:00Z --until 2026-11-10 --label M0")]).toEqual([
      { ok: true, since: "2026-10-13T00:00:00Z", until: "2026-11-10T08:12:34Z", label: "M0", scopeRefP90: null }, 0, "accepted",
    ]);
  }, spawnBudget(200));
});

describe("MIG003d parseArgs: the label", () => {
  it("C31: a label other than M0 or M<n> (n ≥ 1, no leading zero), or no label, is refused", () => {
    expect(["m0", "M01", "MX", "M0/../x", ""].map((l) => refused(`--since 2026-10-13 --until 2026-11-10 ${l ? `--label ${l}` : ""}`))).toEqual(["refused", "refused", "refused", "refused", "refused"]);
  });
});

describe("MIG003d parseArgs: the scope reference and unknown flags", () => {
  it("C34 + C69: --scope-ref-p90 abc, -1 or 10abc, an unknown flag, or a flag with no value is refused; 0 is a reference", () => {
    const base = "--since 2026-10-13 --until 2026-11-10 --label M1";
    const zero = parseArgs(args(`${base} --scope-ref-p90 0`));
    expect([
      ...["--scope-ref-p90 abc", "--scope-ref-p90 -1", "--scope-ref-p90 10abc", "--force yes", "--scope-ref-p90"].map((x) => refused(`${base} ${x}`)),
      zero.ok ? zero.scopeRefP90 : "refused",
    ]).toEqual(["refused", "refused", "refused", "refused", "refused", 0]);
  });
});

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { resolveOutDir } from "../../scripts/ci/metrics.mjs";
import { spawnBudget } from "../support/spawnBudget";

/** Child processes run async (D302: no synchronous child process in a test worker). */
const run = promisify(execFile);
const REPO = path.resolve(__dirname, "../..");
const inside = (dir: string, root: string) => !path.relative(fs.realpathSync(root), dir).startsWith("..");

describe("MIG003d the output directory", () => {
  it("C37: by default it is <home>/.mdpro-redesign/metrics, outside this repository", () => {
    const r = resolveOutDir({}, os.homedir());
    expect({ r, insideRepo: r.ok && r.dir ? inside(r.dir, REPO) : null }).toEqual({ r: { ok: true, dir: path.join(os.homedir(), ".mdpro-redesign", "metrics") }, insideRepo: false });
  }, spawnBudget(200));
});

/** A fresh `git init` repository in the system temp dir (outside every repo), removed by the caller. */
async function tempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mig003d-repo-"));
  await run("git", ["init", "-q", dir]);
  return dir;
}
const porcelain = async (repo: string) => (await run("git", ["-C", repo, "status", "--porcelain", "--ignored"], { encoding: "utf8" })).stdout;

describe("MIG003d the output directory: inside a repository", () => {
  it("C36: a not-yet-existing MDPRO_METRICS_DIR inside a temp git repo is refused and nothing is created there", async () => {
    const repo = await tempRepo();
    try {
      const r = resolveOutDir({ MDPRO_METRICS_DIR: path.join(repo, "metrics", "out") }, os.homedir());
      expect({ ok: r.ok, status: await porcelain(repo), exists: fs.existsSync(path.join(repo, "metrics")) }).toEqual({ ok: false, status: "", exists: false });
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  }, spawnBudget(300));
});

describe("MIG003d the output directory: raw-green guards", () => {
  it("C38 + C64a–c: this repo's tests/, a linked worktree, a symlink into a repo, an ignored path, and a .git dir are all refused", async () => {
    const repo = await tempRepo();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "mig003d-out-"));
    try {
      await run("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "base"]);
      await run("git", ["-C", repo, "worktree", "add", "-q", path.join(outside, "wt")]);
      fs.writeFileSync(path.join(repo, ".gitignore"), "ignored/\n");
      fs.symlinkSync(repo, path.join(outside, "link"));
      const before = await porcelain(repo);
      const dirs = [path.join(REPO, "tests"), path.join(outside, "wt", "out"), path.join(outside, "link", "out"), path.join(repo, "ignored", "out"), path.join(repo, ".git", "out")];
      const oks = dirs.map((d) => resolveOutDir({ MDPRO_METRICS_DIR: d }, os.homedir()).ok);
      expect({ oks, unchanged: (await porcelain(repo)) === before, created: fs.existsSync(path.join(repo, "ignored")) }).toEqual({ oks: [false, false, false, false, false], unchanged: true, created: false });
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
      fs.rmSync(repo, { recursive: true, force: true });
    }
  }, spawnBudget(600));
});

import { makeGhRequest } from "../../scripts/ci/metrics.mjs";

/** A spawn recorder standing in for `gh`: it records each call and answers `answer`. */
function spawnRecorder(answer: { status: number; stdout: string; stderr?: string } = { status: 0, stdout: "[]" }) {
  const calls: { cmd: string; args: string[]; options: object }[] = [];
  const spawn = (cmd: string, args: string[], options: object) => {
    calls.push({ cmd, args, options });
    return { status: answer.status, stdout: Buffer.from(answer.stdout), stderr: Buffer.from(answer.stderr ?? "") };
  };
  return { calls, spawn };
}
const thrown = (fn: () => unknown) => {
  try {
    fn();
    return "no throw";
  } catch (error) {
    return error instanceof Error ? "threw" : "threw a non-Error";
  }
};

describe("MIG003d the request layer: GET only", () => {
  it("C40: POST, DELETE and a lower-case get throw before gh is spawned", () => {
    const rec = spawnRecorder();
    const request = makeGhRequest({ spawn: rec.spawn });
    const path0 = "repos/{owner}/{repo}/actions/runs/1";
    expect({ results: ["POST", "DELETE", "get"].map((m) => thrown(() => request(m, path0))), spawned: rec.calls.length }).toEqual({ results: ["threw", "threw", "threw"], spawned: 0 });
  });
});

describe("MIG003d the request layer: the gh argv", () => {
  it("C41: paginate is `api --paginate --slurp <path>`, otherwise `api <path>`; no shell, no method or field flags; JSON is parsed", () => {
    const rec = spawnRecorder({ status: 0, stdout: '{"total_count":0}' });
    const request = makeGhRequest({ spawn: rec.spawn });
    const p1 = "repos/{owner}/{repo}/actions/workflows/ci.yml/runs?per_page=100";
    const results = [request("GET", p1, { paginate: true }), request("GET", "repos/{owner}/{repo}/actions/runs/1/attempts/1")];
    expect({
      results,
      calls: rec.calls.map((c) => ({ cmd: c.cmd, args: c.args, shell: (c.options as { shell?: unknown }).shell ?? false })),
    }).toEqual({
      results: [{ total_count: 0 }, { total_count: 0 }],
      calls: [
        { cmd: "gh", args: ["api", "--paginate", "--slurp", p1], shell: false },
        { cmd: "gh", args: ["api", "repos/{owner}/{repo}/actions/runs/1/attempts/1"], shell: false },
      ],
    });
  });
});

describe("MIG003d the request layer: the path", () => {
  it("C42 + C61: a path starting with -, holding whitespace, or outside repos/ (graphql) throws before gh is spawned", () => {
    const rec = spawnRecorder();
    const request = makeGhRequest({ spawn: rec.spawn });
    const bad = ["-XPOST", "--method=DELETE", "repos/{owner}/{repo}/actions/runs -f x=1", "repos/a\nb", "graphql", "/repos/x"];
    expect({ results: bad.map((p) => thrown(() => request("GET", p))), spawned: rec.calls.length }).toEqual({ results: bad.map(() => "threw"), spawned: 0 });
  });
});

const caught = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof Error ? { message: error.message, status: (error as Error & { status?: number }).status ?? null } : null;
  }
};

describe("MIG003d the request layer: gh failures", () => {
  it("C75: a non-zero gh exit throws an Error whose status is the HTTP code in stderr (null when there is none)", () => {
    const p0 = "repos/{owner}/{repo}/actions/workflows/x.yml/runs";
    const r404 = caught(() => makeGhRequest({ spawn: spawnRecorder({ status: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)\n" }).spawn })("GET", p0));
    const rNet = caught(() => makeGhRequest({ spawn: spawnRecorder({ status: 1, stdout: "", stderr: "error connecting to api.github.com\n" }).spawn })("GET", p0));
    expect([r404?.status, rNet?.status, r404?.message.includes(p0), typeof rNet?.message]).toEqual([404, null, true, "string"]);
  });
});

describe("MIG003d the request layer: binary", () => {
  it("C76: {binary: true} returns stdout as a Buffer, unparsed (an artifact zip)", () => {
    const rec = spawnRecorder({ status: 0, stdout: "PK\u0003\u0004not json" });
    let out: unknown;
    try {
      out = makeGhRequest({ spawn: rec.spawn })("GET", "repos/{owner}/{repo}/actions/artifacts/9/zip", { binary: true });
    } catch {
      out = "threw";
    }
    expect([Buffer.isBuffer(out), Buffer.isBuffer(out) ? out.subarray(0, 2).toString() : null, rec.calls[0]?.args]).toEqual([true, "PK", ["api", "repos/{owner}/{repo}/actions/artifacts/9/zip"]]);
  });
});

import { collect } from "../../scripts/ci/metrics.mjs";
import type { Request } from "../../scripts/ci/metrics.mjs";

const ACT = "repos/{owner}/{repo}/actions";
const WIN = { since: "2026-10-13T00:00:00Z", until: "2026-11-10T23:59:59Z" };
const runsPath = (file: string) => `${ACT}/workflows/${file}/runs?created=${WIN.since}..${WIN.until}&per_page=100`;
const wRun = (id: number, sha: string, run_attempt = 1, event = "pull_request") => ({ id, head_sha: sha, run_attempt, event, status: "completed", conclusion: "success", created_at: "2026-11-01T00:00:00Z", run_started_at: "2026-11-01T00:00:00Z", pull_requests: [{ number: id }] });
const notFound = (p: string) => Object.assign(new Error(`gh api ${p} failed: (HTTP 404)`), { status: 404 });

/** A recording request over `routes` (exact path → response); any other path is a 404, the way gh reports it. */
function recording(routes: Record<string, unknown>) {
  const calls: { method: string; path: string; options?: object }[] = [];
  const request: Request = (method, p, options) => {
    calls.push({ method, path: p, options });
    if (p in routes) {
      const r = routes[p];
      if (r instanceof Error) throw r;
      return r;
    }
    throw notFound(p);
  };
  return { calls, request };
}

/** ci.yml: 101 re-run (attempt 2), 102 alone, 103 and 104 on one SHA; one run per advisory workflow. */
function world(over: Record<string, unknown> = {}) {
  const ci = [wRun(101, "a", 2), wRun(102, "b"), wRun(103, "c"), wRun(104, "c")];
  const routes: Record<string, unknown> = {
    [runsPath("ci.yml")]: [{ total_count: 4, workflow_runs: ci }],
    [runsPath("platform-advisory.yml")]: [{ total_count: 1, workflow_runs: [wRun(201, "n", 1, "schedule")] }],
    [runsPath("webkit-advisory.yml")]: [{ total_count: 1, workflow_runs: [wRun(301, "n", 1, "schedule")] }],
    [`${ACT}/runs/101/attempts/1`]: { ...wRun(101, "a"), run_attempt: 1 },
  };
  for (const id of [101, 102, 103, 104, 201, 301]) routes[`${ACT}/runs/${id}/jobs?filter=all&per_page=100`] = [{ total_count: 0, jobs: [] }];
  for (const id of [101, 103, 104]) routes[`${ACT}/runs/${id}/artifacts?per_page=100`] = [{ total_count: 0, artifacts: [] }];
  return { ...routes, ...over };
}

describe("MIG003d collect: what it asks for", () => {
  it("C43: only GETs; the three run lists, every run's jobs, each earlier attempt, and artifacts for flake candidates only", async () => {
    const rec = recording(world());
    const input = await collect(rec.request, WIN);
    const expected = Object.keys(world()).sort();
    expect({
      methods: [...new Set(rec.calls.map((c) => c.method))],
      paths: rec.calls.map((c) => c.path).sort(),
      runs: Object.fromEntries(Object.entries(input.runs ?? {}).map(([f, l]) => [f, l.map((r) => r.id)])),
      attempts: Object.fromEntries(Object.entries(input.attempts ?? {}).map(([id, l]) => [id, l.map((a) => a.run_attempt)])),
    }).toEqual({
      methods: ["GET"],
      paths: expected,
      runs: { "ci.yml": [101, 102, 103, 104], "platform-advisory.yml": [201], "webkit-advisory.yml": [301] },
      attempts: { 101: [1] },
    });
  }, spawnBudget(200));
});

describe("MIG003d collect: an absent advisory workflow", () => {
  it("C44: platform-advisory.yml 404s → its runs are [] and collect resolves (Q5)", async () => {
    const routes = world();
    delete routes[runsPath("platform-advisory.yml")];
    delete routes[`${ACT}/runs/201/jobs?filter=all&per_page=100`];
    let runs: unknown = "threw";
    try {
      runs = (await collect(recording(routes).request, WIN)).runs["platform-advisory.yml"];
    } catch {
      // the expectation below names the miss
    }
    expect(runs).toEqual([]);
  }, spawnBudget(200));
});

const rejection = async (p: Promise<unknown>) => p.then(() => "resolved", (e: unknown) => (e instanceof Error ? (e as Error & { status?: number }).status ?? "no status" : "non-Error"));

describe("MIG003d collect: failures that must stop it (raw-green guard)", () => {
  it("C60 (collect): a 404 on ci.yml's runs and a 500 on a jobs call both reject with their status", async () => {
    const no = world();
    delete no[runsPath("ci.yml")];
    const err = world({ [`${ACT}/runs/102/jobs?filter=all&per_page=100`]: Object.assign(new Error("gh api failed: (HTTP 500)"), { status: 500 }) });
    expect([await rejection(collect(recording(no).request, WIN)), await rejection(collect(recording(err).request, WIN))]).toEqual([404, 500]);
  }, spawnBudget(200));
});

const gateJob = (id: number, run_attempt: number, started: string, completed: string) => ({ id, run_attempt, name: "ci-gate", status: "completed", conclusion: "success", created_at: started, started_at: started, completed_at: completed, labels: ["ubuntu-latest"] });

describe("MIG003d collect: slurped pages and every attempt's jobs (raw-green guard)", () => {
  it("C57: runs on two pages are both read, and attempt 1's ci-gate (served only by filter=all) gives its own sample", async () => {
    const reRun = { ...wRun(101, "a", 2), run_started_at: "2026-11-01T01:00:00Z" };
    const routes = world({
      [runsPath("ci.yml")]: [{ total_count: 2, workflow_runs: [reRun] }, { total_count: 2, workflow_runs: [wRun(102, "b")] }],
      [`${ACT}/runs/101/jobs?filter=all&per_page=100`]: [{ total_count: 2, jobs: [gateJob(1, 1, "2026-11-01T00:01:00Z", "2026-11-01T00:10:00Z"), gateJob(2, 2, "2026-11-01T01:01:00Z", "2026-11-01T01:05:00Z")] }],
      [`${ACT}/runs/102/jobs?filter=all&per_page=100`]: [{ total_count: 1, jobs: [gateJob(3, 1, "2026-11-01T00:01:00Z", "2026-11-01T00:20:00Z")] }],
    });
    const input = await collect(recording(routes).request, WIN);
    const m = computeMetrics(input, { ...WIN, label: "M0" });
    expect({ ids: input.runs["ci.yml"].map((r) => r.id), wallClock: m.wallClock }).toEqual({ ids: [101, 102], wallClock: { samples: 3, p50: 600, p90: 1200 } });
  }, spawnBudget(200));
});

const rejectionMessage = async (p: Promise<unknown>) => p.then(() => "resolved", (e: unknown) => (e instanceof Error ? e.message : "non-Error"));

describe("MIG003d collect: a truncated run list (ruling 1, G24)", () => {
  it("C72: total_count 1200 with 1000 runs received rejects, naming the workflow and both counts", async () => {
    const many = Array.from({ length: 1000 }, (_, i) => wRun(10_000 + i, `s${i}`, 1, "push"));
    const routes = world({ [runsPath("ci.yml")]: [{ total_count: 1200, workflow_runs: many }] });
    const message = await rejectionMessage(collect(recording(routes).request, WIN));
    expect([message.includes("ci.yml"), message.includes("1200"), message.includes("1000")]).toEqual([true, true, true]);
  }, spawnBudget(200));
});

const SENTINEL = "SENTINEL-DOC-CONTENT-7f3a";
/** A real artifact zip holding a vitest JSON report with one failed and one passed test, the failure text a sentinel. */
async function reportZip() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mig003d-zip-"));
  try {
    const report = { testResults: [{ name: "/home/runner/work/mdpro/mdpro/tests/a.test.ts", message: SENTINEL, assertionResults: [
      { fullName: "a > fails", status: "failed", failureMessages: [SENTINEL] },
      { fullName: "a > passes", status: "passed", failureMessages: [] },
    ] }] };
    fs.writeFileSync(path.join(dir, ".ci-vitest-results.json"), JSON.stringify(report));
    await run("zip", ["-q", "r.zip", ".ci-vitest-results.json"], { cwd: dir });
    return fs.readFileSync(path.join(dir, "r.zip"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const art = (id: number, name: string, expired = false) => ({ id, name, expired });
const TESTS = [
  { file: "/home/runner/work/mdpro/mdpro/tests/a.test.ts", fullName: "a > fails", status: "failed" },
  { file: "/home/runner/work/mdpro/mdpro/tests/a.test.ts", fullName: "a > passes", status: "passed" },
];

describe("MIG003d collect: which artifacts are read", () => {
  it("C54a: only frontend-blob-*-attempt-* and frontend-vitest-<os>-shard-<n> are downloaded (binary), and each report is cut to identities", async () => {
    const zip = await reportZip();
    const rec = recording(world({
      [`${ACT}/runs/103/artifacts?per_page=100`]: [{ total_count: 4, artifacts: [art(9001, "frontend-vitest-macos-latest-shard-1"), art(9002, "frontend-blob-macos-latest-shard-1-attempt-1"), art(9003, "frontend-vitest-macos-latest"), art(9004, "coverage-macos")] }],
      [`${ACT}/artifacts/9001/zip`]: zip,
      [`${ACT}/artifacts/9002/zip`]: zip,
    }));
    const input = await collect(rec.request, WIN);
    expect({
      downloads: rec.calls.filter((c) => c.path.endsWith("/zip")).map((c) => [c.path, c.options]),
      reports: input.reports,
    }).toEqual({
      downloads: [[`${ACT}/artifacts/9001/zip`, { binary: true }], [`${ACT}/artifacts/9002/zip`, { binary: true }]],
      reports: { 101: [], 103: [{ artifact: "frontend-vitest-macos-latest-shard-1", tests: TESTS }, { artifact: "frontend-blob-macos-latest-shard-1-attempt-1", tests: TESTS }], 104: [] },
    });
  }, spawnBudget(600));
});

const shardRan = (id: number) => ({ ...gateJob(id, 1, "2026-11-01T00:01:00Z", "2026-11-01T00:09:00Z"), name: "frontend (macos-latest, 1)", labels: ["macos-latest"] });

describe("MIG003d collect: an expired artifact", () => {
  it("C54b: an artifact marked expired is never downloaded, and the run it would have covered reads unavailable", async () => {
    const rec = recording(world({
      [`${ACT}/runs/103/jobs?filter=all&per_page=100`]: [{ total_count: 1, jobs: [shardRan(7)] }],
      [`${ACT}/runs/103/artifacts?per_page=100`]: [{ total_count: 1, artifacts: [art(9001, "frontend-vitest-macos-latest-shard-1", true)] }],
    }));
    let flake: unknown = "collect rejected";
    try {
      flake = computeMetrics(await collect(rec.request, WIN), { ...WIN, label: "M0" }).flake;
    } catch {
      // the expectation below names the miss
    }
    expect({ downloads: rec.calls.filter((c) => c.path.endsWith("/zip")).length, flake }).toEqual({ downloads: 0, flake: "unavailable(1 runs)" });
  }, spawnBudget(200));
});

describe("MIG003d collect: no temp files left (raw-green guard)", () => {
  it("C70: the injected temp root is empty after a good run and after a request fails following a download", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mig003d-tmproot-"));
    try {
      const zip = await reportZip();
      const good = { [`${ACT}/runs/103/artifacts?per_page=100`]: [{ total_count: 1, artifacts: [art(9001, "frontend-vitest-macos-latest-shard-1")] }], [`${ACT}/artifacts/9001/zip`]: zip };
      const ok = await rejection(collect(recording(world(good)).request, WIN, { tmpRoot }));
      const afterGood = fs.readdirSync(tmpRoot);
      const bad = world({ ...good, [`${ACT}/runs/104/artifacts?per_page=100`]: Object.assign(new Error("(HTTP 500)"), { status: 500 }) });
      const failed = await rejection(collect(recording(bad).request, WIN, { tmpRoot }));
      expect({ ok, afterGood, failed, afterBad: fs.readdirSync(tmpRoot) }).toEqual({ ok: "resolved", afterGood: [], failed: 500, afterBad: [] });
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  }, spawnBudget(600));
});

import { main } from "../../scripts/ci/metrics.mjs";

const M0_ARGS = "--since 2026-10-13 --until 2026-11-10 --label M0";
/** `main` in a fresh metrics dir outside every repo, over a recording request; the dir is removed after `inspect`. */
async function runMain<T>(argv: string, routes: Record<string, unknown>, inspect: (r: { code: number; dir: string; files: string[]; out: string; err: string; calls: number }) => T, now = new Date("2026-11-11T05:00:00Z"), env: Record<string, string> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mig003d-main-"));
  const dir = path.join(root, "metrics");
  try {
    const rec = recording(routes);
    let out = "";
    let err = "";
    const code = await main(args(argv), { env: { MDPRO_METRICS_DIR: dir, ...env }, home: root, request: rec.request, now, tmpRoot: root, stdout: (s) => (out += s), stderr: (s) => (err += s) });
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
    return inspect({ code, dir, files, out, err, calls: rec.calls.length });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe("MIG003d main: a good run", () => {
  it("C35: exit 0 and exactly <label>-<date>.json and .md in the metrics dir; the JSON is the metrics object", async () => {
    const want = computeMetrics(await collect(recording(world()).request, WIN), { ...WIN, label: "M0", scopeRefP90: null });
    const got = await runMain(M0_ARGS, world(), (r) => ({
      code: r.code,
      files: r.files,
      json: r.files.includes("M0-2026-11-11.json") ? JSON.parse(fs.readFileSync(path.join(r.dir, "M0-2026-11-11.json"), "utf8")) : null,
    }));
    expect(got).toEqual({ code: 0, files: ["M0-2026-11-11.json", "M0-2026-11-11.md"], json: JSON.parse(JSON.stringify(want)) });
  }, spawnBudget(300));
});

describe("MIG003d main: refusals", () => {
  it("C30 + C31 + C36 (main): a reversed range, a bad label, or a metrics dir inside a repo → exit 2, no request, nothing written, stderr says why", async () => {
    const shape = (r: { code: number; files: string[]; err: string; calls: number }) => ({ code: r.code, files: r.files, calls: r.calls, said: r.err.trim().length > 0 });
    const refusedShape = { code: 2, files: [], calls: 0, said: true };
    const repo = await tempRepo();
    try {
      const settle = (p: Promise<unknown>) => p.catch(() => "main rejected");
      const results = [
        await settle(runMain("--since 2026-11-10 --until 2026-10-13 --label M0", world(), shape)),
        await settle(runMain("--since 2026-10-13 --until 2026-11-10 --label M01", world(), shape)),
        await settle(runMain(M0_ARGS, world(), shape, undefined, { MDPRO_METRICS_DIR: path.join(repo, "metrics") })),
      ];
      expect({ results, repo: await porcelain(repo) }).toEqual({ results: [refusedShape, refusedShape, refusedShape], repo: "" });
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  }, spawnBudget(300));
});

describe("MIG003d main: a fetch that fails", () => {
  it("C60 + C72 (main): a 500 on a jobs call, a 404 on ci.yml, or a truncated list → exit 1, nothing written, stderr names it", async () => {
    const shape = (r: { code: number; files: string[]; err: string }) => ({ code: r.code, files: r.files, said: r.err });
    const settle = (p: Promise<{ code: number; files: string[]; said: string }>) => p.then((r) => ({ ...r, said: r.said.length > 0 }), () => "main rejected");
    const noCi = world();
    delete noCi[runsPath("ci.yml")];
    const many = Array.from({ length: 1000 }, (_, i) => wRun(10_000 + i, `s${i}`, 1, "push"));
    const results = [
      await settle(runMain(M0_ARGS, world({ [`${ACT}/runs/102/jobs?filter=all&per_page=100`]: Object.assign(new Error("(HTTP 500)"), { status: 500 }) }), shape)),
      await settle(runMain(M0_ARGS, noCi, shape)),
      await settle(runMain(M0_ARGS, world({ [runsPath("ci.yml")]: [{ total_count: 1200, workflow_runs: many }] }), shape)),
    ];
    const failed = { code: 1, files: [], said: true };
    expect(results).toEqual([failed, failed, failed]);
  }, spawnBudget(300));
});

import { renderSummary } from "../../scripts/ci/metrics.mjs";
import type { Metrics } from "../../scripts/ci/metrics.mjs";

const METRICS: Metrics = {
  label: "M0",
  window: { since: "2026-10-13T00:00:00Z", until: "2026-11-10T08:12:34Z" },
  wallClock: { samples: 12, p50: 600, p90: 1260 },
  queue: { samples: 40, p50: 4, p90: 31 },
  minutes: { Linux: 120.5, macOS: 300, Windows: 0 },
  rerun: { headShas: 20, rerun: 3, rate: 0.15 },
  flake: "unavailable(2 runs)",
  nightly: { "platform-advisory.yml": { runs: 0, passRate: null }, "webkit-advisory.yml": { runs: 7, passRate: 6 / 7 } },
  budgets: [
    { lane: "native-macOS", samples: 6, p90: 2000, budget: 1800, status: "over budget" },
    { lane: "scope", samples: 9, p90: 12, budget: null, delta: null, status: "no reference" },
  ],
};

describe("MIG003d renderSummary", () => {
  it("C74: the md names the label and window, each §17 number, each budget row, and why the flake is unavailable", () => {
    const lines = renderSummary(METRICS).split("\n");
    const has = (s: string) => lines.some((l) => l.includes(s));
    expect([
      "# CI metrics M0",
      "2026-10-13T00:00:00Z → 2026-11-10T08:12:34Z",
      "PR wall-clock: P50 600 s, P90 1260 s (12 samples)",
      "Queue time: P50 4 s, P90 31 s (40 jobs)",
      "Runner minutes: Linux 120.5, macOS 300, Windows 0",
      "Rerun rate: 3 of 20 head SHAs (15%)",
      "Flake: unavailable(2 runs)",
      "a failed shard uploads no blob and its re-run overwrites the per-shard report",
      "webkit-advisory.yml: 7 runs, pass rate 86%",
      "platform-advisory.yml: 0 runs, pass rate n/a",
      "| native-macOS | 6 | 2000 | 1800 | over budget |",
      "| scope | 9 | 12 | n/a | no reference |",
    ].filter((s) => !has(s))).toEqual([]);
  }, spawnBudget(200));
});

describe("MIG003d main: over budget is a flag, not a failure (raw-green guard)", () => {
  it("C25 (main): five WebKit runs of 700 s each → the webkit row reads over budget and main still exits 0", async () => {
    const wk = [401, 402, 403, 404, 405].map((id) => wRun(id, "w", 1, "schedule"));
    const over: Record<string, unknown> = { [runsPath("webkit-advisory.yml")]: [{ total_count: 5, workflow_runs: wk }] };
    for (const r of wk) over[`${ACT}/runs/${r.id}/jobs?filter=all&per_page=100`] = [{ total_count: 1, jobs: [{ ...gateJob(r.id, 1, "2026-11-01T00:00:00Z", "2026-11-01T00:11:40Z"), name: "webkit" }] }];
    const got = await runMain(M0_ARGS, world(over), (r) => ({
      code: r.code,
      webkit: (JSON.parse(fs.readFileSync(path.join(r.dir, "M0-2026-11-11.json"), "utf8")) as Metrics).budgets.find((b) => b.lane === "webkit"),
    }));
    expect(got).toEqual({ code: 0, webkit: { lane: "webkit", samples: 5, p90: 700, budget: 600, status: "over budget" } });
  }, spawnBudget(300));
});

describe("MIG003d main: no file content (raw-green guard)", () => {
  it("C39 + C65: with a report whose failure text is a sentinel, neither file, stdout nor stderr holds it, nor a results/assertionResults/failureMessages key", async () => {
    const zip = await reportZip();
    const withReports = world({
      [`${ACT}/runs/103/artifacts?per_page=100`]: [{ total_count: 1, artifacts: [art(9001, "frontend-vitest-macos-latest-shard-1")] }],
      [`${ACT}/runs/104/artifacts?per_page=100`]: [{ total_count: 1, artifacts: [art(9002, "frontend-vitest-macos-latest-shard-1")] }],
      [`${ACT}/artifacts/9001/zip`]: zip,
      [`${ACT}/artifacts/9002/zip`]: zip,
    });
    const got = await runMain(M0_ARGS, withReports, (r) => {
      const text = r.files.map((f) => fs.readFileSync(path.join(r.dir, f), "utf8")).join("\n") + r.out + r.err;
      return { code: r.code, files: r.files.length, leaks: [SENTINEL, '"results"', '"assertionResults"', '"failureMessages"', '"message"'].filter((s) => text.includes(s)) };
    });
    expect(got).toEqual({ code: 0, files: 2, leaks: [] });
  }, spawnBudget(600));
});

describe("MIG003d main: the date in the file name (raw-green guard)", () => {
  it("C66: now 2026-11-10T23:30:00Z under TZ=Asia/Shanghai (already the 11th there) names the files M0-2026-11-10", async () => {
    const tz = process.env.TZ;
    process.env.TZ = "Asia/Shanghai";
    try {
      const narrow = world();
      const until = { since: WIN.since, until: "2026-11-01T23:59:59Z" };
      for (const f of ["ci.yml", "platform-advisory.yml", "webkit-advisory.yml"]) {
        narrow[`${ACT}/workflows/${f}/runs?created=${until.since}..${until.until}&per_page=100`] = narrow[runsPath(f)];
      }
      const files = await runMain("--since 2026-10-13 --until 2026-11-01 --label M0", narrow, (r) => r.files, new Date("2026-11-10T23:30:00Z"));
      expect(files).toEqual(["M0-2026-11-10.json", "M0-2026-11-10.md"]);
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  }, spawnBudget(300));
});

describe("MIG003d the spawned CLI (raw-green guard)", () => {
  it("C33: node scripts/ci/metrics.mjs with a reversed range exits non-zero, stderr says why, and the metrics dir stays empty", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mig003d-cli-"));
    try {
      const r = await run(process.execPath, [path.join(REPO, "scripts/ci/metrics.mjs"), ...args("--since 2026-11-10 --until 2026-10-13 --label M0")], {
        env: { ...process.env, MDPRO_METRICS_DIR: path.join(root, "metrics") },
        encoding: "utf8",
      }).then(() => ({ status: 0, stderr: "" }), (e: { code?: number; stderr?: string }) => ({ status: e.code ?? null, stderr: e.stderr ?? "" }));
      expect({ status: r.status, said: /since|until|range/i.test(r.stderr), files: fs.readdirSync(root) }).toEqual({ status: 2, said: true, files: [] });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, spawnBudget(600));
});

describe("MIG003d main: what it prints", () => {
  it("C77: on success stdout names both written paths", async () => {
    const got = await runMain(M0_ARGS, world(), (r) => r.files.map((f) => r.out.includes(path.join(r.dir, f))));
    expect(got).toEqual([true, true]);
  }, spawnBudget(300));
});

describe("MIG003d the request layer: gh cannot run", () => {
  it("C79: when gh is not installed (spawn error ENOENT, no status, no output) the thrown message names the cause", () => {
    const spawn = () => ({ status: null, stdout: null as unknown as Buffer, stderr: null as unknown as Buffer, error: Object.assign(new Error("spawnSync gh ENOENT"), { code: "ENOENT" }) });
    const r = caught(() => makeGhRequest({ spawn })("GET", "repos/{owner}/{repo}/actions/runs/1"));
    expect([r?.message.includes("ENOENT"), r?.status]).toEqual([true, null]);
  });
});

describe("MIG003d renderSummary: the scope delta", () => {
  it("C80: the md gives scope's delta against the reference p90 the caller passed, and n/a without one", () => {
    const withRef: Metrics = { ...METRICS, budgets: [{ lane: "scope", samples: 9, p90: 12, budget: 14, delta: 3, status: "ok" }] };
    const has = (m: Metrics, s: string) => renderSummary(m).split("\n").some((l) => l.includes(s));
    expect([has(withRef, "Scope delta vs reference p90: 3 s"), has(METRICS, "Scope delta vs reference p90: n/a")]).toEqual([true, true]);
  }, spawnBudget(200));
});
