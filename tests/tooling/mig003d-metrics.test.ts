// @vitest-environment node
/**
 * MIG-003d (#756): `computeMetrics` is a pure function from recorded GitHub Actions API responses to the plan §17
 * metrics and the spec's time budgets. Cases are the matrix's (`MIG003d-test-matrix.md`); each test names its case.
 */
import { describe, expect, it } from "vitest";
import { percentile } from "../../scripts/ci/metrics-core.mjs";

describe("MIG003d percentiles", () => {
  it("C7: nearest-rank on an even count (p50 200, p90 400, not 250 / 370)", () => {
    expect([percentile([400, 100, 300, 200], 50), percentile([400, 100, 300, 200], 90)]).toEqual([200, 400]);
  });
});

// ---- builders over the GitHub Actions API shapes (fields as recorded in tests/fixtures/mig003d/) ----
import { computeMetrics } from "../../scripts/ci/metrics-core.mjs";
import type { Job, MetricsInput, Report, Run } from "../../scripts/ci/metrics-core.mjs";

const BASE = Date.UTC(2026, 9, 20);
/** The ISO instant `s` seconds after 2026-10-20T00:00:00Z, as the API prints it. */
const T = (s: number) => new Date(BASE + s * 1000).toISOString().replace(".000Z", "Z");
const W = { since: "2026-10-13T00:00:00Z", until: "2026-11-10T23:59:59Z", label: "M0", scopeRefP90: null };

function run(o: { id: number; sha?: string; pr?: number | null; attempt?: number; conclusion?: string | null; start?: number; created?: number; event?: string; status?: string; branch?: string }): Run {
  const start = o.start ?? 0;
  return {
    id: o.id, event: o.event ?? "pull_request", head_sha: o.sha ?? `sha${o.id}`, head_branch: o.branch ?? `branch-${o.pr ?? o.id}`,
    run_attempt: o.attempt ?? 1, status: o.status ?? "completed", conclusion: o.conclusion === undefined ? "success" : o.conclusion,
    run_started_at: T(start), created_at: T(o.created ?? start), updated_at: T(start + 5000),
    pull_requests: o.pr === null ? [] : [{ number: o.pr ?? o.id }],
  };
}
function job(o: { id: number; name: string; attempt?: number; conclusion?: string | null; created?: number; started: number | null; completed: number | null; labels?: string[]; steps?: { name: string; conclusion: string | null }[] }): Job {
  return {
    id: o.id, run_attempt: o.attempt ?? 1, name: o.name, status: o.completed === null ? "in_progress" : "completed",
    conclusion: o.conclusion === undefined ? "success" : o.conclusion, created_at: T(o.created ?? o.started ?? 0),
    started_at: o.started === null ? null : T(o.started), completed_at: o.completed === null ? null : T(o.completed),
    labels: o.labels ?? ["ubuntu-latest"], ...(o.steps ? { steps: o.steps } : {}),
  };
}
let nextJob = 1;
/** The `ci-gate` job of attempt `attempt`, completing `gate` seconds after `start`. */
const gate = (start: number, gate: number, attempt = 1) => job({ id: nextJob++, name: "ci-gate", attempt, started: start + gate - 5, completed: start + gate });
function input(o: Partial<{ ci: Run[]; platform: Run[]; webkit: Run[]; attempts: Record<string, Run[]>; jobs: Record<string, Job[]>; reports: Record<string, Report[] | null> }>): MetricsInput {
  return {
    runs: { "ci.yml": o.ci ?? [], "platform-advisory.yml": o.platform ?? [], "webkit-advisory.yml": o.webkit ?? [] },
    attempts: o.attempts ?? {}, jobs: o.jobs ?? {}, reports: o.reports ?? {},
  };
}

describe("MIG003d PR wall-clock", () => {
  it("C1: one sample per run on each PR's last head SHA, run_started_at to ci-gate completion", () => {
    const m = computeMetrics(input({
      ci: [run({ id: 1, pr: 10, sha: "a", start: 0 }), run({ id: 2, pr: 10, sha: "a", start: 1000, conclusion: "failure" }), run({ id: 3, pr: 11, sha: "b", start: 2000 })],
      jobs: { 1: [gate(0, 600)], 2: [gate(1000, 900)], 3: [gate(2000, 300)] },
    }), W);
    expect(m.wallClock).toEqual({ samples: 3, p50: 600, p90: 900 });
  });
});

/** C1's window: PR 10 (two runs on SHA a) and PR 11 (one run on SHA b); wall-clock samples 600, 900 and 300. */
function c1(extra: { ci?: Run[]; jobs?: Record<string, Job[]>; attempts?: Record<string, Run[]> } = {}) {
  return input({
    ci: [run({ id: 1, pr: 10, sha: "a", start: 0 }), run({ id: 2, pr: 10, sha: "a", start: 1000, conclusion: "failure" }), run({ id: 3, pr: 11, sha: "b", start: 2000 }), ...(extra.ci ?? [])],
    jobs: { 1: [gate(0, 600)], 2: [gate(1000, 900)], 3: [gate(2000, 300)], ...(extra.jobs ?? {}) },
    attempts: extra.attempts ?? {},
  });
}

describe("MIG003d PR wall-clock exclusions", () => {
  it("C2: a cancelled run on the last head SHA is not a sample", () => {
    const m = computeMetrics(c1({ ci: [run({ id: 4, pr: 10, sha: "a", start: 3000, conclusion: "cancelled" })], jobs: { 4: [gate(3000, 5000)] } }), W);
    expect(m.wallClock).toEqual({ samples: 3, p50: 600, p90: 900 });
  });
});

describe("MIG003d PR wall-clock: the last head SHA", () => {
  it("C3: an older head SHA of the same PR is not a sample", () => {
    const m = computeMetrics(c1({ ci: [run({ id: 5, pr: 10, sha: "a-old", start: -9000 })], jobs: { 5: [gate(-9000, 4000)] } }), W);
    expect(m.wallClock).toEqual({ samples: 3, p50: 600, p90: 900 });
  });
});

/** Runs `fn`, turning a throw into a value, so a crash fails the case's assertion instead of erroring the test. */
function safe<R>(fn: () => R): R | { thrown: string } {
  try {
    return fn();
  } catch (error) {
    return { thrown: error instanceof Error ? error.message : String(error) };
  }
}

describe("MIG003d PR wall-clock: which run is last", () => {
  it("C4 (raw-green guard): an older SHA re-run later is still not the last head SHA (newest by created_at)", () => {
    const m = computeMetrics(c1({ ci: [{ ...run({ id: 5, pr: 10, sha: "a-old", start: 9000, created: -9000 }) }], jobs: { 5: [gate(9000, 4000)] } }), W);
    expect(m.wallClock).toEqual({ samples: 3, p50: 600, p90: 900 });
  });
});

describe("MIG003d PR wall-clock: no ci-gate", () => {
  it("C5: a run whose ci-gate is absent or not completed is not a sample, and nothing is NaN", () => {
    const unfinished = job({ id: 900, name: "ci-gate", started: 3005, completed: null, conclusion: null });
    const m = safe(() => computeMetrics(c1({ ci: [run({ id: 6, pr: 10, sha: "a", start: 3000 }), run({ id: 7, pr: 11, sha: "b", start: 4000 })], jobs: { 6: [], 7: [unfinished] } }), W));
    expect("thrown" in m ? m : m.wallClock).toEqual({ samples: 3, p50: 600, p90: 900 });
  });
});

describe("MIG003d PR wall-clock: attempts", () => {
  it("C6: each attempt of a re-run is a sample, from its own run_started_at to its own attempt's ci-gate", () => {
    const m = computeMetrics(input({
      ci: [run({ id: 8, pr: 12, sha: "c", attempt: 2, start: 6000, created: 5000 })],
      attempts: { 8: [run({ id: 8, pr: 12, sha: "c", attempt: 1, start: 5000, conclusion: "failure" })] },
      jobs: { 8: [gate(5000, 900, 1), gate(6000, 200, 2)] },
    }), W);
    expect(m.wallClock).toEqual({ samples: 2, p50: 200, p90: 900 });
  });
});

describe("MIG003d PR wall-clock: each attempt's own conclusion", () => {
  it("C55: a cancelled attempt 1 is not a sample even when the run (attempt 2) succeeded", () => {
    const m = computeMetrics(input({
      ci: [run({ id: 9, pr: 13, sha: "d", attempt: 2, start: 6000, created: 1000 })],
      attempts: { 9: [run({ id: 9, pr: 13, sha: "d", attempt: 1, start: 1000, conclusion: "cancelled" })] },
      jobs: { 9: [gate(1000, 5000, 1), gate(6000, 300, 2)] },
    }), W);
    expect(m.wallClock).toEqual({ samples: 1, p50: 300, p90: 300 });
  });
});

/** W's bounds in T's seconds: since 2026-10-13T00:00:00Z, until 2026-11-10T23:59:59Z. */
const SINCE = -7 * 86400;
const UNTIL = 21 * 86400 + 86399;

describe("MIG003d window", () => {
  it("C9: a run created one second before since, or one second after until, is in no metric", () => {
    const m = computeMetrics(c1({
      ci: [run({ id: 20, pr: 30, sha: "e", start: SINCE - 1 }), run({ id: 21, pr: 31, sha: "f", start: UNTIL + 1 })],
      jobs: { 20: [gate(SINCE - 1, 4000)], 21: [gate(UNTIL + 1, 4000)] },
    }), W);
    expect(m.wallClock).toEqual({ samples: 3, p50: 600, p90: 900 });
  });
});

describe("MIG003d PR wall-clock raw-green guards", () => {
  it("C8: push and workflow_dispatch runs of ci.yml are not wall-clock samples", () => {
    const m = computeMetrics(c1({
      ci: [run({ id: 22, pr: null, sha: "g", start: 100, event: "push" }), run({ id: 23, pr: null, sha: "h", start: 200, event: "workflow_dispatch" })],
      jobs: { 22: [gate(100, 4000)], 23: [gate(200, 4000)] },
    }), W);
    expect(m.wallClock).toEqual({ samples: 3, p50: 600, p90: 900 });
  });

  it("C56: the end is ci-gate's completed_at, not the run's updated_at", () => {
    const r = { ...run({ id: 24, pr: 32, sha: "i", start: 0 }), updated_at: T(900) };
    expect(computeMetrics(input({ ci: [r], jobs: { 24: [gate(0, 600)] } }), W).wallClock).toEqual({ samples: 1, p50: 600, p90: 600 });
  });

  it("C48: twenty samples 1..20 s give nearest-rank p50 10 and p90 18 (not the maximum)", () => {
    const runs = Array.from({ length: 20 }, (_, i) => run({ id: 100 + i, pr: 100 + i, start: i * 100 }));
    const jobs = Object.fromEntries(runs.map((r, i) => [r.id, [gate(i * 100, i + 1)]]));
    expect(computeMetrics(input({ ci: runs, jobs }), W).wallClock).toEqual({ samples: 20, p50: 10, p90: 18 });
  });
});

describe("MIG003d queue time", () => {
  it("C10: started_at − created_at per job across the three workflows; skipped jobs are out", () => {
    const m = computeMetrics(input({
      ci: [run({ id: 30, pr: 40, start: 0 })],
      webkit: [run({ id: 31, event: "schedule", pr: null, start: 0 })],
      jobs: {
        30: [job({ id: 301, name: "scope", created: 0, started: 2, completed: 10 }), job({ id: 302, name: "skip", conclusion: "skipped", created: 40, started: 40, completed: 40 })],
        31: [job({ id: 311, name: "webkit", created: 10, started: 14, completed: 50 }), job({ id: 312, name: "webkit-2", created: 20, started: 30, completed: 60 })],
      },
    }), W);
    expect(m.queue).toEqual({ samples: 3, p50: 4, p90: 10 });
  });
});

/** C11's window: ubuntu 120 s + 60 s (ci.yml, one of them in attempt 1), macOS 600 s and Windows 300 s (platform), ubuntu 240 s (webkit). */
function c11(extra: { ci?: Run[]; platform?: Run[]; jobs?: Record<string, Job[]> } = {}) {
  return input({
    ci: [run({ id: 40, pr: 50, attempt: 2, start: 1000, created: 0 }), ...(extra.ci ?? [])],
    attempts: { 40: [run({ id: 40, pr: 50, attempt: 1, start: 0, conclusion: "failure" })] },
    platform: [run({ id: 41, event: "schedule", pr: null, start: 0 }), ...(extra.platform ?? [])],
    webkit: [run({ id: 42, event: "schedule", pr: null, start: 0 })],
    jobs: {
      40: [job({ id: 401, name: "rust-test", attempt: 1, started: 0, completed: 120 }), job({ id: 402, name: "rust-test", attempt: 2, started: 1000, completed: 1060 })],
      41: [job({ id: 411, name: "native (macos-latest)", started: 0, completed: 600, labels: ["macos-latest"] }), job({ id: 412, name: "native (windows-latest)", started: 0, completed: 300, labels: ["windows-latest"] })],
      42: [job({ id: 421, name: "webkit", started: 0, completed: 240 })],
      ...(extra.jobs ?? {}),
    },
  });
}

describe("MIG003d runner minutes", () => {
  it("C11: Σ(completed_at − started_at) over the three workflows' jobs, every attempt, split by runner OS", () => {
    expect(computeMetrics(c11(), W).minutes).toEqual({ Linux: 7, macOS: 10, Windows: 5 });
  });
});

/** Every number anywhere in `value`, so a NaN that JSON would print as null is still caught. */
function numbers(value: unknown): number[] {
  if (typeof value === "number") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(numbers);
  return [];
}

describe("MIG003d runner minutes: boundaries", () => {
  it("C68 (raw-green guard): minutes are Σ seconds / 60, never rounded per job", () => {
    const m = computeMetrics(input({
      ci: [run({ id: 43, pr: 51 }), run({ id: 44, pr: 52 })],
      jobs: { 43: [job({ id: 431, name: "a", started: 0, completed: 30 }), job({ id: 432, name: "b", started: 0, completed: 30 })], 44: [job({ id: 441, name: "c", started: 0, completed: 90, labels: ["macos-latest"] })] },
    }), W);
    expect(m.minutes).toEqual({ Linux: 1, macOS: 1.5 });
  });

  it("C58: an in-progress run's job (completed_at null) adds nothing, and every number in the result is finite", () => {
    const m = computeMetrics(c11({
      ci: [run({ id: 45, pr: 53, status: "in_progress", conclusion: null, start: 5000 })],
      jobs: { 45: [job({ id: 451, name: "frontend", started: 5000, completed: null, conclusion: null }), job({ id: 452, name: "queued", started: null, completed: null, conclusion: null })] },
    }), W);
    expect({ minutes: m.minutes, notFinite: numbers(m).filter((n) => !Number.isFinite(n)) }).toEqual({ minutes: { Linux: 7, macOS: 10, Windows: 5 }, notFinite: [] });
  });
});

import rerun from "../fixtures/mig003d/rerun-42853708661.json";

describe("MIG003d relisted jobs (recorded run 42853708661)", () => {
  it("C71: a job listed under attempt 2 that started before attempt 2's run_started_at is a copy, counted once", () => {
    // Attempt 2 relists six attempt-1 jobs under new ids with attempt 1's times; 13 jobs really ran, for 2837 s in all.
    const m = computeMetrics(input({ ci: [rerun.run as Run], attempts: { [rerun.run.id]: rerun.attempts as Run[] }, jobs: { [rerun.run.id]: rerun.jobs as Job[] } }), W);
    expect({ linuxSeconds: Math.round((m.minutes.Linux ?? 0) * 60), queueSamples: m.queue.samples }).toEqual({ linuxSeconds: 2837, queueSamples: 13 });
  });
});

describe("MIG003d rerun rate", () => {
  it("C12: share of PR head SHAs with a run_attempt > 1; attempt 3 counts once, a second run is not a rerun", () => {
    const m = computeMetrics(input({
      ci: [
        run({ id: 50, pr: 60, sha: "A" }), run({ id: 51, pr: 61, sha: "B", attempt: 3 }), run({ id: 52, pr: 62, sha: "C" }), run({ id: 53, pr: 62, sha: "C", start: 10 }),
        run({ id: 54, pr: null, sha: "P", attempt: 2, event: "push" }),
      ],
    }), W);
    expect(m.rerun).toEqual({ headShas: 3, rerun: 1, rate: 1 / 3 });
  });
});

describe("MIG003d advisory nightly pass rate", () => {
  it("C19: schedule runs only; success over completed runs that were not cancelled", () => {
    const nightly = (id: number, conclusion: string, event = "schedule") => run({ id, pr: null, event, conclusion });
    const m = computeMetrics(input({ platform: [nightly(60, "success"), nightly(61, "success"), nightly(62, "failure"), nightly(63, "cancelled"), nightly(64, "success", "workflow_dispatch")] }), W);
    expect(m.nightly?.["platform-advisory.yml"]).toEqual({ runs: 3, passRate: 2 / 3 });
  });
});

describe("MIG003d nightly raw-green guards", () => {
  const nightly = (id: number, conclusion: string | null, status = "completed") => run({ id, pr: null, event: "schedule", conclusion, status });
  it("C59: a timed_out nightly counts as not passing", () => {
    expect(computeMetrics(input({ webkit: [nightly(70, "success"), nightly(71, "timed_out")] }), W).nightly["webkit-advisory.yml"]).toEqual({ runs: 2, passRate: 0.5 });
  });
  it("C58 (nightly part): an in_progress schedule run is not in the denominator", () => {
    expect(computeMetrics(input({ webkit: [nightly(72, "success"), nightly(73, null, "in_progress")] }), W).nightly["webkit-advisory.yml"]).toEqual({ runs: 1, passRate: 1 });
  });
  it("C18: a workflow with no runs reports zero runs and no rate, and no OS minutes", () => {
    const m = computeMetrics(input({ ci: [run({ id: 74, pr: 74 })], jobs: { 74: [gate(0, 60)] } }), W);
    expect({ nightly: m.nightly, minutes: m.minutes }).toEqual({
      nightly: { "platform-advisory.yml": { runs: 0, passRate: null }, "webkit-advisory.yml": { runs: 0, passRate: null } },
      minutes: { Linux: 5 / 60 },
    });
  });
});

/** A platform-advisory run with one native job on `os`, `secs` long, whose `rust-cache hit` step concluded `hit`. */
let nextRun = 1000;
function native(os: "macos-latest" | "windows-latest", seconds: number, hit: string | null, conclusion = "success") {
  const id = nextRun++;
  const steps = hit === null ? [{ name: "Run Swatinem/rust-cache@v2", conclusion: "success" }] : [{ name: "Run Swatinem/rust-cache@v2", conclusion: "success" }, { name: "rust-cache hit", conclusion: hit }];
  return { run: run({ id, pr: null, event: "schedule", start: 0 }), jobs: [job({ id: id * 10, name: `native (${os})`, labels: [os], created: 0, started: 10, completed: 10 + seconds, conclusion, steps })] };
}
function lanes(parts: { platform?: ReturnType<typeof native>[]; webkit?: ReturnType<typeof native>[]; ci?: { run: Run; jobs: Job[] }[] }) {
  const all = [...(parts.platform ?? []), ...(parts.webkit ?? []), ...(parts.ci ?? [])];
  return input({
    platform: (parts.platform ?? []).map((p) => p.run), webkit: (parts.webkit ?? []).map((p) => p.run), ci: (parts.ci ?? []).map((p) => p.run),
    jobs: Object.fromEntries(all.map((p) => [p.run.id, p.jobs])),
  });
}
const budget = (m: ReturnType<typeof computeMetrics>, lane: string) => m.budgets?.find((b) => b.lane === lane);

describe("MIG003d budgets: native", () => {
  it("C20: native macOS p90 over warm legs against 30 min", () => {
    const m = computeMetrics(lanes({ platform: [900, 1000, 1100, 1200, 1300].map((s) => native("macos-latest", s, "success")) }), W);
    expect(budget(m, "native-macOS")).toEqual({ lane: "native-macOS", samples: 5, p90: 1300, budget: 1800, status: "ok" });
  });
});

const warmMac = () => [900, 1000, 1100, 1200, 1300].map((s) => native("macos-latest", s, "success"));

describe("MIG003d budgets: the warm-cache filter", () => {
  it("C21: a leg whose rust-cache hit step was skipped, or that has no such step, is not in the native p90", () => {
    const m = computeMetrics(lanes({ platform: [...warmMac(), native("macos-latest", 3000, "skipped"), native("macos-latest", 3500, null)] }), W);
    expect(budget(m, "native-macOS")).toEqual({ lane: "native-macOS", samples: 5, p90: 1300, budget: 1800, status: "ok" });
  });
});

describe("MIG003d budgets: native guards and job conclusion", () => {
  it("C22 (raw-green guard): only the step named exactly `rust-cache hit` marks a warm leg", () => {
    const near = (name: string) => ({ ...native("macos-latest", 3000, "success"), jobs: [{ ...native("macos-latest", 3000, null).jobs[0], steps: [{ name, conclusion: "success" }] }] });
    const m = computeMetrics(lanes({ platform: [...warmMac(), near("rust-cache hit (extra)"), near("Rust-cache hit")] }), W);
    expect(budget(m, "native-macOS")?.samples).toBe(5);
  });

  it("C49 (raw-green guard): twenty warm legs 100..2000 s give p90 1800, ok (not the maximum)", () => {
    const m = computeMetrics(lanes({ platform: Array.from({ length: 20 }, (_, i) => native("macos-latest", (i + 1) * 100, "success")) }), W);
    expect(budget(m, "native-macOS")).toEqual({ lane: "native-macOS", samples: 20, p90: 1800, budget: 1800, status: "ok" });
  });

  it("C67a: a warm leg that was cancelled is not a sample", () => {
    const m = computeMetrics(lanes({ platform: [...warmMac(), native("macos-latest", 3500, "success", "cancelled")] }), W);
    expect(budget(m, "native-macOS")).toEqual({ lane: "native-macOS", samples: 5, p90: 1300, budget: 1800, status: "ok" });
  });
});

describe("MIG003d budgets: per OS, and fewer than five runs", () => {
  it("C29: five warm macOS legs are ok while four warm Windows legs are insufficient data", () => {
    const m = computeMetrics(lanes({ platform: [...warmMac(), ...[100, 200, 300, 4000].map((s) => native("windows-latest", s, "success"))] }), W);
    expect([budget(m, "native-macOS")?.status, budget(m, "native-Windows")]).toEqual(["ok", { lane: "native-Windows", samples: 4, p90: null, budget: 1800, status: "insufficient data" }]);
  });
});

/** A webkit-advisory run with one ubuntu job: queued `queued` s, then running `seconds` s. */
function webkitRun(seconds: number, queued = 0) {
  const id = nextRun++;
  return { run: run({ id, pr: null, event: "schedule", start: 0 }), jobs: [job({ id: id * 10, name: "webkit", created: 0, started: queued, completed: queued + seconds })] };
}

describe("MIG003d budgets: WebKit", () => {
  it("C23: four WebKit runs report insufficient data", () => {
    const m = computeMetrics(lanes({ webkit: [100, 200, 300, 400].map((s) => webkitRun(s)) }), W);
    expect(budget(m, "webkit")).toEqual({ lane: "webkit", samples: 4, p90: null, budget: 600, status: "insufficient data" });
  });
});

describe("MIG003d budgets: WebKit guards", () => {
  it("C24 (raw-green guard): p90 601 s is over budget and still a value; 600 s exactly is ok", () => {
    const over = computeMetrics(lanes({ webkit: [100, 200, 300, 400, 601].map((s) => webkitRun(s)) }), W);
    const edge = computeMetrics(lanes({ webkit: [100, 200, 300, 400, 600].map((s) => webkitRun(s)) }), W);
    expect([budget(over, "webkit"), budget(edge, "webkit")?.status]).toEqual([{ lane: "webkit", samples: 5, p90: 601, budget: 600, status: "over budget" }, "ok"]);
  });
  it("C26 (raw-green guard): queue time is not in job wall time (queued 500 s, ran 400 s → 400)", () => {
    const m = computeMetrics(lanes({ webkit: [100, 200, 300, 350].map((s) => webkitRun(s)).concat([webkitRun(400, 500)]) }), W);
    expect(budget(m, "webkit")?.p90).toBe(400);
  });
});

/** A ci.yml run (event `event`) whose `scope` job ran `seconds` s. */
function scopeRun(seconds: number, event = "pull_request") {
  const id = nextRun++;
  return { run: run({ id, pr: event === "pull_request" ? id : null, event, start: 0 }), jobs: [job({ id: id * 10, name: "scope", created: 0, started: 1, completed: 1 + seconds })] };
}
const scopes = (values: number[], event?: string) => values.map((s) => scopeRun(s, event));

describe("MIG003d budgets: scope", () => {
  it("C27: scope's PR p90 against the caller's reference + 5 s, with the delta", () => {
    const ok = computeMetrics(lanes({ ci: scopes([10, 11, 12, 13, 14]) }), { ...W, scopeRefP90: 10 });
    const over = computeMetrics(lanes({ ci: scopes([10, 11, 12, 13, 16]) }), { ...W, scopeRefP90: 10 });
    expect([budget(ok, "scope"), budget(over, "scope")?.status]).toEqual([{ lane: "scope", samples: 5, p90: 14, budget: 15, delta: 4, status: "ok" }, "over budget"]);
  });
});

describe("MIG003d budgets: scope samples", () => {
  it("C67b: scope jobs of push runs are not in the PR scope budget", () => {
    const m = computeMetrics(lanes({ ci: [...scopes([10, 11, 12, 13, 14]), ...scopes([100, 100, 100, 100, 100], "push")] }), { ...W, scopeRefP90: 10 });
    expect(budget(m, "scope")).toEqual({ lane: "scope", samples: 5, p90: 14, budget: 15, delta: 4, status: "ok" });
  });
});

describe("MIG003d budgets: scope without a reference", () => {
  it("C28: no --scope-ref-p90 gives `no reference`, the p90 still reported and no budget or delta", () => {
    const m = computeMetrics(lanes({ ci: scopes([10, 11, 12, 13, 14]) }), W);
    expect(budget(m, "scope")).toEqual({ lane: "scope", samples: 5, p90: 14, budget: null, delta: null, status: "no reference" });
  });
});

describe("MIG003d budgets: scope guard", () => {
  it("C67c (raw-green guard): four PR scope jobs and no reference read insufficient data, checked first", () => {
    expect(budget(computeMetrics(lanes({ ci: scopes([10, 11, 12, 13]) }), W), "scope")?.status).toBe("insufficient data");
  });
});

// ---- flake: reports are the stripped `.ci-vitest-results.json` of named artifacts (identities and statuses only) ----
type T3 = [file: string, fullName: string, status: string];
const report = (artifact: string, tests: T3[]): Report => ({ artifact, tests: tests.map(([file, fullName, status]) => ({ file, fullName, status })) });
const blob = (shard: number, attempt: number, tests: T3[], os = "ubuntu-latest") => report(`frontend-blob-${os}-shard-${shard}-attempt-${attempt}`, tests);
/** A frontend shard job, as ci.yml names it. */
const shardJob = (id: number, shard: number, attempt: number, conclusion: string, start: number, os = "ubuntu-latest") =>
  job({ id, name: `frontend (${os}, ${shard})`, attempt, conclusion, started: start, completed: start + 60, labels: [os] });

/** SHA B, one run, two attempts; both attempts' shard-1 reports are present (ruling 1: the seam takes any recorded data). */
function twoAttempts(a1: T3[], a2: T3[], order: "asc" | "desc" = "asc") {
  const reports = [blob(1, 1, a1), blob(1, 2, a2)];
  return input({
    ci: [run({ id: 80, pr: 90, sha: "B", attempt: 2, start: 1000, created: 0 })],
    attempts: { 80: [run({ id: 80, pr: 90, sha: "B", attempt: 1, start: 0, conclusion: "failure" })] },
    jobs: { 80: [shardJob(801, 1, 1, "failure", 10), shardJob(802, 1, 2, "success", 1010)] },
    reports: { 80: order === "asc" ? reports : reports.reverse() },
  });
}

describe("MIG003d flake", () => {
  it("C13: a test identity failed in attempt 1 and passed in attempt 2 is a flake; one failed in both is not", () => {
    const m = computeMetrics(twoAttempts([["tests/a.test.ts", "x", "failed"], ["tests/a.test.ts", "y", "failed"]], [["tests/a.test.ts", "x", "passed"], ["tests/a.test.ts", "y", "failed"]]), W);
    expect(m.flake).toEqual({ candidates: 1, flakyTests: ["ubuntu-latest tests/a.test.ts > x"], flakyShas: 1, rate: 1 });
  });
});

describe("MIG003d flake: order", () => {
  it("C14: passed in attempt 1 and failed in attempt 2 is not a flake", () => {
    const m = computeMetrics(twoAttempts([["tests/a.test.ts", "x", "passed"]], [["tests/a.test.ts", "x", "failed"]]), W);
    expect(m.flake).toEqual({ candidates: 1, flakyTests: [], flakyShas: 0, rate: 0 });
  });
});

describe("MIG003d flake: identity and ordering", () => {
  it("C15 (raw-green guard): failed on ubuntu and passed on macOS in the same attempt is not a flake (identity carries OS)", () => {
    const m = computeMetrics(input({
      ci: [run({ id: 81, pr: 91, sha: "E", attempt: 2, start: 1000, created: 0 })],
      attempts: { 81: [run({ id: 81, pr: 91, sha: "E", attempt: 1, start: 0, conclusion: "failure" })] },
      reports: { 81: [blob(1, 1, [["tests/a.test.ts", "x", "failed"]]), blob(1, 1, [["tests/a.test.ts", "x", "passed"]], "macos-latest")] },
    }), W);
    expect(m.flake).toEqual({ candidates: 1, flakyTests: [], flakyShas: 0, rate: 0 });
  });

  it("C51b (raw-green guard): failed, failed, then passed over three attempts is a flake", () => {
    const m = computeMetrics(input({
      ci: [run({ id: 82, pr: 92, sha: "F", attempt: 3, start: 2000, created: 0 })],
      attempts: { 82: [run({ id: 82, pr: 92, sha: "F", attempt: 1, start: 0, conclusion: "failure" }), run({ id: 82, pr: 92, sha: "F", attempt: 2, start: 1000, conclusion: "failure" })] },
      reports: { 82: [blob(1, 1, [["tests/a.test.ts", "x", "failed"]]), blob(1, 2, [["tests/a.test.ts", "x", "failed"]]), blob(1, 3, [["tests/a.test.ts", "x", "passed"]])] },
    }), W);
    expect(m.flake).toEqual({ candidates: 1, flakyTests: ["ubuntu-latest tests/a.test.ts > x"], flakyShas: 1, rate: 1 });
  });

  it("C51a: the reports' array order does not decide failed-then-passed; the attempt does", () => {
    const m = computeMetrics(twoAttempts([["tests/a.test.ts", "x", "failed"]], [["tests/a.test.ts", "x", "passed"]], "desc"), W);
    expect(m.flake).toEqual({ candidates: 1, flakyTests: ["ubuntu-latest tests/a.test.ts > x"], flakyShas: 1, rate: 1 });
  });
});

const perShard = (shard: number, tests: T3[], os = "ubuntu-latest") => report(`frontend-vitest-${os}-shard-${shard}`, tests);
/** SHA D, two runs of one attempt each (R1 created at `r1`, R2 at `r2`), each with its own shard-1 per-shard report. */
function twoRuns(first: T3[], second: T3[], r1 = 0, r2 = 5000) {
  return input({
    ci: [run({ id: 84, pr: 94, sha: "D", start: r2 }), run({ id: 83, pr: 94, sha: "D", start: r1 })],
    jobs: { 83: [shardJob(831, 1, 1, "failure", r1 + 10)], 84: [shardJob(841, 1, 1, "success", r2 + 10)] },
    reports: { 83: [perShard(1, first)], 84: [perShard(1, second)] },
  });
}

describe("MIG003d flake across runs (ruling 1, G3 option A)", () => {
  it("C51c: run R1 failed x and the later run R2 passed it, on one SHA, from each run's per-shard report: a flake", () => {
    const m = computeMetrics(twoRuns([["tests/a.test.ts", "x", "failed"]], [["tests/a.test.ts", "x", "passed"]]), W);
    expect(m.flake).toEqual({ candidates: 1, flakyTests: ["ubuntu-latest tests/a.test.ts > x"], flakyShas: 1, rate: 1 });
  });
});

describe("MIG003d flake: availability", () => {
  it("C51d (raw-green guard): R1 passed and the later R2 failed is not a flake, whatever the run ids or list order", () => {
    const m = computeMetrics(twoRuns([["tests/a.test.ts", "x", "passed"]], [["tests/a.test.ts", "x", "failed"]]), W);
    expect(m.flake).toEqual({ candidates: 1, flakyTests: [], flakyShas: 0, rate: 0 });
  });

  it("C16: two candidate runs whose reports expired give unavailable(2 runs), never 0", () => {
    const m = computeMetrics(input({
      ci: [run({ id: 85, pr: 95, sha: "G", attempt: 2 }), run({ id: 86, pr: 96, sha: "H", attempt: 2 })],
      reports: { 85: null, 86: null },
    }), W);
    expect(m.flake).toBe("unavailable(2 runs)");
  });
});

describe("MIG003d flake: what counts as unavailable", () => {
  it("C52a (raw-green guard): a null report on a run that is not a candidate leaves flake measured", () => {
    const m = computeMetrics(input({ ci: [run({ id: 87, pr: 97, sha: "J" }), ...twoAttempts([], []).runs["ci.yml"]], reports: { 87: null, 80: [blob(1, 1, []), blob(1, 2, [])] }, jobs: twoAttempts([], []).jobs, attempts: twoAttempts([], []).attempts }), W);
    expect(m.flake).toEqual({ candidates: 1, flakyTests: [], flakyShas: 0, rate: 0 });
  });

  it("C52b (raw-green guard): one SHA with two candidate runs, both expired, is unavailable(2 runs): n counts runs, not SHAs", () => {
    const m = computeMetrics(input({ ci: [run({ id: 88, pr: 98, sha: "K", attempt: 2 }), run({ id: 89, pr: 98, sha: "K", start: 10 })], reports: { 88: null, 89: null } }), W);
    expect(m.flake).toBe("unavailable(2 runs)");
  });

  it("C50: a shard that failed in attempt 1 and has no report for that attempt makes its run unavailable", () => {
    // As ci.yml really uploads: blobs only for successful shards, and shard 2's per-shard report overwritten by attempt 2.
    const m = computeMetrics(input({
      ci: [run({ id: 90, pr: 99, sha: "L", attempt: 2, start: 1000, created: 0 })],
      attempts: { 90: [run({ id: 90, pr: 99, sha: "L", attempt: 1, start: 0, conclusion: "failure" })] },
      jobs: { 90: [shardJob(901, 1, 1, "success", 10), shardJob(902, 2, 1, "failure", 10), shardJob(903, 2, 2, "success", 1010)] },
      reports: { 90: [blob(1, 1, [["tests/a.test.ts", "x", "passed"]]), blob(2, 2, [["tests/b.test.ts", "y", "passed"]]), perShard(1, [["tests/a.test.ts", "x", "passed"]]), perShard(2, [["tests/b.test.ts", "y", "passed"]])] },
    }), W);
    expect(m.flake).toBe("unavailable(1 runs)");
  });
});

describe("MIG003d flake: identities", () => {
  it("C17 (raw-green guard): no SHA with more than one run or attempt gives zero candidates, not unavailable", () => {
    // c1() would not do: its SHA a has two runs, so it is a candidate (and, without reports, unavailable).
    const m = computeMetrics(input({ ci: [run({ id: 1, pr: 10, sha: "a" }), run({ id: 3, pr: 11, sha: "b" })], reports: { 1: null, 3: null } }), W);
    expect(m.flake).toEqual({ candidates: 0, flakyTests: [], flakyShas: 0, rate: 0 });
  });

  it("C53: Vitest's absolute runner path becomes the repo-relative file in the identity", () => {
    const abs = "/home/runner/work/mdpro/mdpro/tests/a.test.ts";
    const m = computeMetrics(twoAttempts([[abs, "x", "failed"]], [[abs, "x", "passed"]]), W);
    expect({ flake: m.flake, leaks: JSON.stringify(m).includes("/home/runner") }).toEqual({
      flake: { candidates: 1, flakyTests: ["ubuntu-latest tests/a.test.ts > x"], flakyShas: 1, rate: 1 }, leaks: false,
    });
  });
});

describe("MIG003d PR wall-clock: a relisted ci-gate (added in cycle 30)", () => {
  it("C73: when attempt 2 re-ran only a job outside ci-gate's needs, the relisted attempt-1 ci-gate is no sample for attempt 2", () => {
    const copied = { ...gate(0, 600, 2), id: 9999 };
    const m = computeMetrics(input({
      ci: [run({ id: 91, pr: 100, sha: "M", attempt: 2, start: 2000, created: 0 })],
      attempts: { 91: [run({ id: 91, pr: 100, sha: "M", attempt: 1, start: 0 })] },
      jobs: { 91: [gate(0, 600, 1), copied] },
    }), W);
    expect(m.wallClock).toEqual({ samples: 1, p50: 600, p90: 600 });
  });
});
