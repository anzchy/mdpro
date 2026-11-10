/**
 * Purpose: MIG-003d (#756) — the pure seam of scripts/ci/metrics.mjs: recorded GitHub Actions API responses in, plan
 * §17's metrics and the lane budgets (spec r3 § Time budgets, § Metrics) out. No I/O and no child process, so a test
 * of the numbers loads nothing that spawns (ruling 2: GH727's oracle follows imports file by file).
 *
 * Key decisions: see metrics.mjs's header; the definitions each sit on their function below.
 *
 * @coordinates-with scripts/ci/metrics.mjs — the CLI that fetches with `collect` and calls computeMetrics; it also
 *   reads ADVISORY, BLOB, PER_SHARD and candidates so it fetches exactly what this module reads.
 */

/** Nearest-rank percentile (Q3): the value at 1-based rank ceil(p/100 · n) of the sorted list; null when empty. */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(1, Math.ceil((p / 100) * sorted.length)) - 1];
}

/** The conclusions a sample counts: success and failure; `cancelled` and every other conclusion is out (plan §17). */
const COUNTED = new Set(["success", "failure"]);
const secs = (from, to) => (Date.parse(to) - Date.parse(from)) / 1000;
const stat = (values) => ({ samples: values.length, p50: percentile(values, 50), p90: percentile(values, 90) });

/** Every attempt of a run: the earlier ones from the attempts API, then the run itself (its latest attempt). */
const attemptsOf = (input, run) => [...(input.attempts[run.id] ?? []).filter((a) => a.run_attempt < run.run_attempt), run];
const prKey = (run) => (run.pull_requests?.[0] ? `#${run.pull_requests[0].number}` : `branch:${run.head_branch}`);

/** PR wall-clock samples (plan §17), in seconds. */
function wallClock(input) {
  const prRuns = input.runs["ci.yml"].filter((r) => r.event === "pull_request");
  // A PR's last head SHA is the head_sha of its newest run by created_at; a fork PR has no number, so its branch keys it.
  const last = new Map();
  for (const run of [...prRuns].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))) last.set(prKey(run), run.head_sha);
  const samples = [];
  for (const run of prRuns) {
    if (last.get(prKey(run)) !== run.head_sha) continue;
    for (const attempt of attemptsOf(input, run).filter((a) => COUNTED.has(a.conclusion))) {
      const ciGate = realJobs(input, run).find((j) => j.name === "ci-gate" && j.run_attempt === attempt.run_attempt && j.completed_at);
      if (ciGate) samples.push(secs(attempt.run_started_at, ciGate.completed_at));
    }
  }
  return stat(samples);
}

/**
 * A run's jobs that really ran. A re-run relists the jobs it did not re-run under the new attempt, with new ids and the
 * old times (seen on run 42853708661), so a job of attempt k > 1 that started before attempt k began is a copy.
 */
function realJobs(input, run) {
  const starts = new Map(attemptsOf(input, run).map((a) => [a.run_attempt, Date.parse(a.run_started_at)]));
  return (input.jobs[run.id] ?? []).filter((j) => j.run_attempt === 1 || !j.started_at || Date.parse(j.started_at) >= (starts.get(j.run_attempt) ?? 0));
}

/** Every finished job of every run in the window, across the three workflows; skipped, unfinished and copied jobs left out. */
function allJobs(input) {
  return Object.values(input.runs).flat().flatMap((run) => realJobs(input, run).filter((j) => j.conclusion !== "skipped" && j.started_at && j.completed_at));
}

const OS_PREFIXES = [["ubuntu", "Linux"], ["macos", "macOS"], ["windows", "Windows"]];
/** The runner OS a job's labels name (`ubuntu-latest` → Linux), else `other`. */
const runnerOs = (j) => OS_PREFIXES.find(([prefix]) => j.labels.some((l) => l.toLowerCase().startsWith(prefix)))?.[1] ?? "other";

/** Runner minutes by OS: Σ job wall time / 60, never rounded per job. */
function minutes(jobs) {
  const out = {};
  for (const j of jobs) out[runnerOs(j)] = (out[runnerOs(j)] ?? 0) + secs(j.started_at, j.completed_at) / 60;
  return out;
}

const ratio = (n, d) => (d === 0 ? null : n / d);
/** PR runs of ci.yml grouped by head SHA. */
function byHeadSha(input) {
  const groups = new Map();
  for (const run of input.runs["ci.yml"].filter((r) => r.event === "pull_request")) groups.set(run.head_sha, [...(groups.get(run.head_sha) ?? []), run]);
  return groups;
}

/** Rerun rate (plan §17): head SHAs with any run_attempt > 1, over head SHAs; a SHA counts once however many reruns. */
function rerun(input) {
  const groups = [...byHeadSha(input).values()];
  const rerunShas = groups.filter((runs) => runs.some((r) => r.run_attempt > 1)).length;
  return { headShas: groups.length, rerun: rerunShas, rate: ratio(rerunShas, groups.length) };
}

export const BLOB = /^frontend-blob-(.+)-shard-(\d+)-attempt-(\d+)$/;
/** Vitest's report names a file by the runner's absolute path; the identity keeps it from `tests/` on. */
const repoRelative = (file) => file.replaceAll("\\", "/").replace(/^.*?\/(?=tests\/)/, "");
export const PER_SHARD = /^frontend-vitest-(.+)-shard-(\d+)$/;
const SHARD_JOB = /^frontend \((.+), (\d+)\)$/;
/** The attempts in which a run's `frontend (<os>, <shard>)` job really ran, keyed `<os>/<shard>`. */
function shardAttempts(input, run) {
  const out = new Map();
  for (const j of realJobs(input, run)) {
    const m = SHARD_JOB.exec(j.name);
    if (m && COUNTED.has(j.conclusion)) out.set(`${m[1]}/${m[2]}`, [...(out.get(`${m[1]}/${m[2]}`) ?? []), j]);
  }
  return out;
}

/**
 * A run's reports as observations in time: run creation, then attempt. A blob artifact names its attempt; the per-shard
 * artifact is overwritten on a re-run, so it holds the last attempt in which that shard's job really ran.
 */
function observations(input, run) {
  const shards = shardAttempts(input, run);
  return (input.reports[run.id] ?? []).flatMap((rep) => {
    const b = BLOB.exec(rep.artifact);
    const s = PER_SHARD.exec(rep.artifact);
    if (!b && !s) return [];
    const ran = s ? (shards.get(`${s[1]}/${s[2]}`) ?? []).map((j) => j.run_attempt) : [];
    const attempt = b ? Number(b[3]) : Math.max(...ran, ran.length ? 0 : run.run_attempt);
    return [{ created: Date.parse(run.created_at), os: (b ?? s)[1], shard: Number((b ?? s)[2]), attempt, tests: rep.tests }];
  });
}

/**
 * Whether a run's reports cover every attempt of every frontend shard job that really ran. A failed shard uploads no
 * blob and its per-shard report is overwritten by the re-run, so its failed side is often missing (ruling 1, G3).
 */
function covered(input, run) {
  if (!input.reports[run.id]) return false;
  const have = new Set(observations(input, run).map((o) => `${o.os}/${o.shard}/${o.attempt}`));
  return [...shardAttempts(input, run)].every(([key, jobs]) => jobs.every((j) => have.has(`${key}/${j.run_attempt}`)));
}

/**
 * Test-level flake (plan §17): on one head SHA, a test identity (OS, file, full name) that failed and then passed.
 * Candidates are SHAs with more than one run or attempt.
 */
export const candidates = (input) => [...byHeadSha(input).values()].filter((runs) => runs.length > 1 || runs.some((r) => r.run_attempt > 1));
function flake(input) {
  const groups = candidates(input);
  const unavailable = groups.flat().filter((run) => !covered(input, run)).length;
  if (unavailable > 0) return `unavailable(${unavailable} runs)`;
  const flaky = new Set();
  let flakyShas = 0;
  for (const runs of groups) {
    const failed = new Set();
    const found = new Set();
    const observed = runs.flatMap((run) => observations(input, run));
    observed.sort((a, b) => a.created - b.created || a.attempt - b.attempt);
    for (const { os, tests } of observed) {
      for (const t of tests) {
        const id = `${os} ${repoRelative(t.file)} > ${t.fullName}`;
        if (t.status === "failed") failed.add(id);
        else if (t.status === "passed" && failed.has(id)) found.add(id);
      }
    }
    found.forEach((id) => flaky.add(id));
    if (found.size) flakyShas += 1;
  }
  return { candidates: groups.length, flakyTests: [...flaky].sort(), flakyShas, rate: ratio(flakyShas, byHeadSha(input).size) };
}

export const ADVISORY = ["platform-advisory.yml", "webkit-advisory.yml"];
/** Nightly pass rate per advisory workflow: schedule runs; success over completed runs not cancelled or skipped. */
function nightly(input) {
  const out = {};
  for (const file of ADVISORY) {
    const done = input.runs[file].filter((r) => r.event === "schedule" && r.status === "completed" && !["cancelled", "skipped"].includes(r.conclusion));
    out[file] = { runs: done.length, passRate: ratio(done.filter((r) => r.conclusion === "success").length, done.length) };
  }
  return out;
}

/** Spec § Time budgets (MIG003-r2-D27), in seconds: reported, never an exit failure. */
const NATIVE_BUDGET = 30 * 60;
const WEBKIT_BUDGET = 10 * 60;
const SCOPE_ALLOWANCE = 5;
/** Below this many samples a p90 would mislead, so the row says `insufficient data`. */
const MIN_SAMPLES = 5;
/** One budget row: the lane's job wall-time p90 (started_at → completed_at, so queue time is never in it). */
function budgetRow(lane, jobs, budget) {
  const values = jobs.map((j) => secs(j.started_at, j.completed_at));
  if (values.length < MIN_SAMPLES) return { lane, samples: values.length, p90: null, budget, status: "insufficient data" };
  const p90 = percentile(values, 90);
  return { lane, samples: values.length, p90, budget, status: p90 > budget ? "over budget" : "ok" };
}

/** `scope` on PRs: the risk classes may add ≤ 5 s over the pre-MIG-003 p90 the caller passes (`--scope-ref-p90`). */
function scopeRow(jobs, ref) {
  const hasRef = typeof ref === "number";
  const row = budgetRow("scope", jobs, hasRef ? ref + SCOPE_ALLOWANCE : null);
  if (row.status === "insufficient data") return { ...row, delta: null };
  if (!hasRef) return { ...row, delta: null, status: "no reference" };
  return { ...row, delta: row.p90 - ref };
}

/** A warm native leg: its step named exactly `rust-cache hit` succeeded (spec r3 :169). Skipped or absent is cold. */
const warm = (j) => (j.steps ?? []).some((step) => step.name === "rust-cache hit" && step.conclusion === "success");

function budgets(input, scopeRef) {
  const jobsOf = (file, event) => input.runs[file].filter((r) => !event || r.event === event).flatMap((run) => realJobs(input, run)).filter((j) => COUNTED.has(j.conclusion) && j.started_at && j.completed_at);
  const nativeJobs = jobsOf("platform-advisory.yml").filter(warm);
  return [
    budgetRow("native-macOS", nativeJobs.filter((j) => runnerOs(j) === "macOS"), NATIVE_BUDGET),
    budgetRow("native-Windows", nativeJobs.filter((j) => runnerOs(j) === "Windows"), NATIVE_BUDGET),
    budgetRow("webkit", jobsOf("webkit-advisory.yml"), WEBKIT_BUDGET),
    scopeRow(jobsOf("ci.yml", "pull_request").filter((j) => j.name === "scope"), scopeRef),
  ];
}

/**
 * The seam: recorded API responses in, the metrics object out. Pure; no I/O.
 * @param {import("./metrics.d.mts").MetricsInput} input
 * @param {import("./metrics.d.mts").Window} window
 */
export function computeMetrics(recorded, window) {
  const [from, to] = [Date.parse(window.since), Date.parse(window.until)];
  const inWindow = (r) => Date.parse(r.created_at) >= from && Date.parse(r.created_at) <= to;
  const runs = Object.fromEntries(Object.entries(recorded.runs).map(([file, list]) => [file, list.filter(inWindow)]));
  const input = { ...recorded, runs };
  return {
    label: window.label,
    window: { since: window.since, until: window.until },
    wallClock: wallClock(input),
    queue: stat(allJobs(input).map((j) => secs(j.created_at, j.started_at))),
    minutes: minutes(allJobs(input)),
    rerun: rerun(input),
    flake: flake(input),
    nightly: nightly(input),
    budgets: budgets(input, window.scopeRefP90),
  };
}
