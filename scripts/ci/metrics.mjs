#!/usr/bin/env node
/**
 * Purpose: MIG-003d (#756) — the delegator's local, read-only CI metrics: plan §17's numbers and each lane against its
 * provisional time budget (spec r3 § Time budgets, § Metrics), for any window.
 *
 * Usage: node scripts/ci/metrics.mjs --since <YYYY-MM-DD[THH:MM:SSZ]> --until <…> --label <M0|Mn> [--scope-ref-p90 <s>]
 *   Writes <label>-<UTC date>.json and .md to $MDPRO_METRICS_DIR, else ~/.mdpro-redesign/metrics; exit 2 refused, 1 the run failed.
 *
 * Pipeline: parseArgs → resolveOutDir → collect (gh api GETs) → computeMetrics (the pure seam, metrics-core.mjs) → write
 *   JSON + renderSummary.
 *
 * Key decisions:
 * - The seam is computeMetrics over recorded API responses, in metrics-core.mjs with no child process (ruling 2); this
 *   file is the thin I/O wrapper and re-exports percentile and computeMetrics.
 * - makeGhRequest is the only API caller: GET only, `repos/` paths only, no shell, so the script cannot change GitHub.
 * - Flake counts wherever both sides exist on one head SHA, across runs or attempts; a candidate run whose failed shard
 *   left no report makes the whole number `unavailable(<n> runs)` (ruling 1, G3). A list cut short is refused (G24).
 * - On a re-run, jobs not re-run are relisted under the new attempt with attempt 1's start; they are copies (C71).
 * - Reports are cut to test identities on read, and the output dir is refused inside any git work tree (no file content,
 *   no repo write).
 *
 * @coordinates-with scripts/ci/metrics-core.mjs — the pure seam; collect fetches exactly what it reads.
 * @coordinates-with .github/workflows/ci.yml — the job names (`ci-gate`, `frontend (<os>, <n>)`, `scope`) and the
 *   `frontend-blob-*-attempt-*` / `frontend-vitest-<os>-shard-<n>` artifact names it reads.
 * @coordinates-with .github/workflows/platform-advisory.yml, webkit-advisory.yml (MIG-003 tickets b and c, not yet on
 *   master; a 404 reads as no runs) — the native legs' `rust-cache hit` step and the WebKit lane.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ADVISORY, BLOB, PER_SHARD, candidates, computeMetrics } from "./metrics-core.mjs";

export { computeMetrics, percentile } from "./metrics-core.mjs";


const FLAGS = { "--since": "since", "--until": "until", "--label": "label", "--scope-ref-p90": "scopeRefP90" };
const END_OF_DAY = "T23:59:59Z";
/** The label also names the output files, so it is held to this form (no path, no leading zero). */
const LABEL = /^M(0|[1-9]\d*)$/;

/** `--since`/`--until` take `YYYY-MM-DD` (since: the day's start, until: its end) or `YYYY-MM-DDTHH:MM:SSZ`. */
function parseDate(value, isUntil) {
  if (typeof value !== "string") return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value + (isUntil ? END_OF_DAY : "T00:00:00Z") : value;
  // Round-tripping through Date refuses what it would roll over (Feb 30 → Mar 2, 24:00 → the next day).
  const ms = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(iso) ? Date.parse(iso) : NaN;
  return !Number.isNaN(ms) && new Date(ms).toISOString() === iso.replace("Z", ".000Z") ? iso : null;
}

/** The CLI's arguments, or the reason to refuse them (nothing is fetched or written after a refusal). */
export function parseArgs(argv) {
  const got = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = FLAGS[argv[i]];
    if (!key || key in got || argv[i + 1] === undefined) return { ok: false, error: `unknown, repeated or empty option: ${argv[i]}` };
    got[key] = argv[i + 1];
  }
  if (got.scopeRefP90 !== undefined && !/^\d+(\.\d+)?$/.test(got.scopeRefP90)) return { ok: false, error: "--scope-ref-p90 takes seconds (a number ≥ 0)" };
  const [since, until] = [parseDate(got.since, false), parseDate(got.until, true)];
  if (!since || !until) return { ok: false, error: "--since and --until each need YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ" };
  if (Date.parse(since) > Date.parse(until)) return { ok: false, error: `the range is reversed: ${since} is after ${until}` };
  if (!LABEL.test(got.label ?? "")) return { ok: false, error: "--label must be M0 or M<n> (n ≥ 1)" };
  return { ok: true, since, until, label: got.label, scopeRefP90: got.scopeRefP90 === undefined ? null : Number(got.scopeRefP90) };
}

/**
 * Where the files go (Q4): `MDPRO_METRICS_DIR`, else `<home>/.mdpro-redesign/metrics`. Refused when the directory, or
 * its nearest existing ancestor, is inside any git work tree or git dir: git itself answers, so worktrees, symlinks
 * and ignored paths are judged the way git sees them.
 */
export function resolveOutDir(env, home) {
  const dir = path.resolve(env.MDPRO_METRICS_DIR || path.join(home, ".mdpro-redesign", "metrics"));
  let existing = dir;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  if (spawnSync("git", ["-C", existing, "rev-parse", "--git-dir"], { env: gitEnv, stdio: "ignore" }).status === 0) {
    return { ok: false, error: `refusing to write inside a git repository: ${dir}` };
  }
  return { ok: true, dir };
}

/** Room for a 28-day paginated run list (about 400 runs) and an artifact zip. */
const MAX_BUFFER = 512 * 1024 * 1024;

/** A REST path under repos/, with no whitespace, so gh cannot read it as a flag, a field or another endpoint. */
const SAFE_PATH = /^repos\/\S+$/;

/** The only `gh api` caller: GET only, so the CLI cannot change anything on GitHub. */
export function makeGhRequest({ spawn = spawnSync } = {}) {
  return (method, apiPath, { paginate = false, binary = false } = {}) => {
    if (method !== "GET") throw new Error(`refusing a non-GET request: ${method}`);
    if (!SAFE_PATH.test(apiPath)) throw new Error(`refusing an API path: ${JSON.stringify(apiPath)}`);
    const args = paginate ? ["api", "--paginate", "--slurp", apiPath] : ["api", apiPath];
    const out = spawn("gh", args, { shell: false, maxBuffer: MAX_BUFFER });
    if (out.status !== 0) {
      // A spawn failure (gh missing: ENOENT; output past maxBuffer: ENOBUFS) has no status and its cause in out.error.
      const stderr = out.error ? out.error.message : String(out.stderr ?? "").trim();
      const http = /HTTP (\d{3})/.exec(stderr);
      throw Object.assign(new Error(`gh api ${apiPath} failed: ${stderr}`), { status: http ? Number(http[1]) : null });
    }
    return binary ? Buffer.from(out.stdout) : JSON.parse(String(out.stdout));
  };
}

const WORKFLOWS = ["ci.yml", ...ADVISORY];
const ACTIONS = "repos/{owner}/{repo}/actions";
/**
 * A paginated list, as `gh api --paginate --slurp` gives it: one object per page, each holding `key`. A list cut short
 * (the API stops a `created` search at 1000 results) is refused rather than measured (ruling 1, G24).
 */
function pages(request, apiPath, key) {
  const slurped = request("GET", apiPath, { paginate: true });
  const items = slurped.flatMap((page) => page[key]);
  const total = slurped[0]?.total_count ?? items.length;
  if (total > items.length) throw new Error(`${apiPath}: total_count ${total} but ${items.length} received; narrow the window`);
  return items;
}

/**
 * Everything computeMetrics reads, by GET (plan §17): each workflow's runs created in the window, every run's jobs of
 * every attempt, each earlier attempt's run record, and the vitest reports of flake candidates.
 */
export async function collect(request, window, { tmpRoot = os.tmpdir() } = {}) {
  const input = { runs: {}, attempts: {}, jobs: {}, reports: {} };
  for (const file of WORKFLOWS) {
    try {
      input.runs[file] = pages(request, `${ACTIONS}/workflows/${file}/runs?created=${window.since}..${window.until}&per_page=100`, "workflow_runs");
    } catch (error) {
      // Q5: an advisory workflow not yet on the default branch has no runs; every other failure stops the run.
      if (!(ADVISORY.includes(file) && error?.status === 404)) throw error;
      input.runs[file] = [];
    }
  }
  for (const run of Object.values(input.runs).flat()) {
    input.jobs[run.id] = pages(request, `${ACTIONS}/runs/${run.id}/jobs?filter=all&per_page=100`, "jobs");
    for (let n = 1; n < run.run_attempt; n += 1) (input.attempts[run.id] ??= []).push(request("GET", `${ACTIONS}/runs/${run.id}/attempts/${n}`));
  }
  const work = fs.mkdtempSync(path.join(tmpRoot, "mig003d-"));
  try {
    for (const run of candidates(input).flat()) {
      const listed = pages(request, `${ACTIONS}/runs/${run.id}/artifacts?per_page=100`, "artifacts");
      input.reports[run.id] = listed.filter((a) => !a.expired && (BLOB.test(a.name) || PER_SHARD.test(a.name))).map((a) => ({ artifact: a.name, tests: readReport(request, a, work) }));
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  return input;
}

const REPORT = ".ci-vitest-results.json";
/** One artifact's vitest report, kept to test identities and outcomes: no message or failure text leaves this function. */
function readReport(request, artifact, work) {
  const dir = path.join(work, String(artifact.id));
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "a.zip"), request("GET", `${ACTIONS}/artifacts/${artifact.id}/zip`, { binary: true }));
  if (spawnSync("unzip", ["-q", "-o", "a.zip", REPORT], { cwd: dir, stdio: "ignore" }).status !== 0) throw new Error(`artifact ${artifact.name}: no ${REPORT}`);
  const report = JSON.parse(fs.readFileSync(path.join(dir, REPORT), "utf8"));
  return report.testResults.flatMap((f) => f.assertionResults.map((t) => ({ file: f.name, fullName: t.fullName, status: t.status })));
}

const na = (v, unit = "") => (v === null || v === undefined ? "n/a" : `${v}${unit}`);
const pct = (rate) => (rate === null ? "n/a" : `${Math.round(rate * 100)}%`);
/** Why flake reads unavailable today (ruling 1, G3); the workflow follow-up is the delegator's. */
const UNAVAILABLE_WHY = "a failed shard uploads no blob and its re-run overwrites the per-shard report, so a re-run's failed side is gone";

/** The short markdown summary written beside the JSON: numbers and test identities only, never test output. */
export function renderSummary(m) {
  const f = m.flake;
  const flakeLines = typeof f === "string"
    ? [`- Flake: ${f}`, `  - Why: ${UNAVAILABLE_WHY}.`]
    : [`- Flake: ${f.flakyShas} of ${f.candidates} candidate head SHAs (${pct(f.rate)} of all)`, ...f.flakyTests.map((t) => `  - ${t}`)];
  return [
    `# CI metrics ${m.label}`,
    "",
    `Window: ${m.window.since} → ${m.window.until}`,
    "",
    `- PR wall-clock: P50 ${na(m.wallClock.p50, " s")}, P90 ${na(m.wallClock.p90, " s")} (${m.wallClock.samples} samples)`,
    `- Queue time: P50 ${na(m.queue.p50, " s")}, P90 ${na(m.queue.p90, " s")} (${m.queue.samples} jobs)`,
    `- Runner minutes: ${Object.entries(m.minutes).map(([o, v]) => `${o} ${Math.round(v * 10) / 10}`).join(", ")}`,
    `- Rerun rate: ${m.rerun.rerun} of ${m.rerun.headShas} head SHAs (${pct(m.rerun.rate)})`,
    ...flakeLines,
    ...Object.entries(m.nightly).map(([file, n]) => `- Nightly ${file}: ${n.runs} runs, pass rate ${pct(n.passRate)}`),
    "",
    "| Lane | Samples | P90 (s) | Budget (s) | Status |",
    "|---|---|---|---|---|",
    ...m.budgets.map((b) => `| ${b.lane} | ${b.samples} | ${na(b.p90)} | ${na(b.budget)} | ${b.status} |`),
    "",
    `Scope delta vs reference p90: ${na(m.budgets.find((b) => b.lane === "scope")?.delta, " s")}`,
    "",
  ].join("\n");
}

const EXIT_REFUSED = 2;
/** A fetch, an artifact read or the computation failed: nothing is written. */
const EXIT_RUN_FAILED = 1;

/** Fetch, compute and write `<dir>/<label>-<UTC date of now>.json` and `.md`. */
export async function main(argv, deps = {}) {
  const { env = process.env, home = os.homedir(), request = makeGhRequest(), now = new Date(), tmpRoot } = deps;
  const { stdout = (s) => process.stdout.write(s), stderr = (s) => process.stderr.write(s) } = deps;
  const window = parseArgs(argv);
  const out = window.ok ? resolveOutDir(env, home) : window;
  if (!out.ok) {
    stderr(`metrics: ${out.error}\n`);
    return EXIT_REFUSED;
  }
  let metrics;
  try {
    metrics = computeMetrics(await collect(request, window, { tmpRoot }), window);
  } catch (error) {
    stderr(`metrics: ${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT_RUN_FAILED;
  }
  fs.mkdirSync(out.dir, { recursive: true });
  const base = path.join(out.dir, `${window.label}-${now.toISOString().slice(0, 10)}`);
  fs.writeFileSync(`${base}.json`, `${JSON.stringify(metrics, null, 2)}\n`);
  fs.writeFileSync(`${base}.md`, renderSummary(metrics));
  stdout(`metrics: wrote ${base}.json and ${base}.md\n`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main(process.argv.slice(2));
}
