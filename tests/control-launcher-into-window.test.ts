// @vitest-environment node
/**
 * D82-WI-3 M2: a delivery counts only when it is seen within the window.
 * Before the fix `awaitDelivery` returned a hit before it checked the
 * deadline, so a read that happened after `start + timeoutMs` (a sleep that
 * ran long) still passed.
 * Matrix: `.claude/tdd-guardian/tests-20261010-103136.md`, "D82-WI-3",
 * IR-M2-1, IR-M2-2, IR-M2-3 (design finding 7: only the one sleep that would
 * land at T is stretched, because T is a multiple of the poll interval).
 *
 * Law: a hit counts iff some read that completed at elapsed <= T saw a
 * complete matching line; with arrival a and reads r_i, pass iff
 * a <= max{ r_i : r_i <= T }. Both bounds inclusive. Monotone in a.
 *
 * Fakes only at `deps.spawn`, `deps.procFacts`, `deps.kill` and the clock;
 * the app log is a real file on a tmp fs.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { last } from "./support/launchHarness";
import { fakeClock } from "./support/launcherFakes";
import { app, appendText, delivered, doc, entry, liveRun } from "./support/intoRun";
import { int, mulberry32, pick } from "./support/seededRandom";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { HANDSHAKE_TIMEOUT_MS } from "../scripts/control/launch.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { POLL_MS } from "../scripts/control/launchCore.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { awaitDelivery } from "../scripts/control/intoDelivery.mjs";

const T: number = HANDSHAKE_TIMEOUT_MS;
const P: number = POLL_MS;
const NOT_DELIVERED = `verdict: fail — into: file not delivered within ${T} ms`;
const PASS = "verdict: pass";

let cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups = [];
});

/**
 * `--into R <doc>` where the app logs the delivery `lineAt` ms after the
 * spawn, and the one sleep that starts at elapsed `from` lands at `from + to`
 * instead of `from + P`. Returns the last line and how often the stretch fired.
 */
async function stretched(lineAt: number, stretch: { from: number; to: number } | null) {
  const d = doc(cleanups);
  const { fx, into, expectInert } = await liveRun(cleanups);
  let t0: number | null = null;
  let fired = 0;
  const sleep = fx.clock.sleep;
  fx.deps.sleep = (ms: number) => {
    const hit = stretch !== null && t0 !== null && fx.clock.now() - t0 === stretch.from && ms === P;
    if (hit) fired += 1;
    return sleep(hit && stretch ? stretch.to : ms);
  };
  const script = app(fx, [{ at: lineAt, text: delivered(d.real) }]);
  const { r, second } = await into((call, child) => {
    t0 = fx.clock.now();
    script(call, child);
  }, { via: "open", file: d.file });
  expectInert(second);
  return { line: last(fx.out), exit: r.exit, fired };
}

describe("D82-WI-3 IR-M2-1: an oversleep past T rejects a late read", () => {
  it("IR-M2-1 the sleep that would land at T lands at T+P; the line arrived at T+P/2: not delivered", async () => {
    const res = await stretched(T + P / 2, { from: T - P, to: 2 * P });
    expect(res).toEqual({ line: NOT_DELIVERED, exit: 1, fired: 1 });
  });
});

describe("D82-WI-3 IR-M2-2: boundary rows at T", () => {
  it("IR-M2-2 (a) line at T-P/2, read at T: pass; (b) line at T, read at T: pass; (c) read at T+1: fail; (d) read at T-1: pass", async () => {
    const rows = [
      await stretched(T - P / 2, null),
      await stretched(T, null),
      await stretched(T - P / 2, { from: T - P, to: P + 1 }),
      await stretched(T - P / 2, { from: T - P, to: P - 1 }),
    ];
    expect(rows.map((x) => x.line)).toEqual([PASS, PASS, NOT_DELIVERED, PASS]);
    expect(rows.map((x) => x.fired)).toEqual([0, 0, 1, 1]);
  });
});

/** One generated schedule for `awaitDelivery` with timeoutMs = 10P. */
type Case = { extras: number[]; arrival: number | null; source: string; noise: { at: number; text: string }[]; partialAt: number | null };
const WINDOW = 10 * P;
const SEED = 2026101001;

/** The read times the schedule produces: 0, then each sleep, until the first read at or past the window. */
function readTimes(extras: number[]): number[] {
  const reads = [0];
  let t = 0;
  for (let i = 0; t < WINDOW; i++) {
    t += P + (extras[i] ?? 0);
    reads.push(t);
  }
  return reads;
}

/** The law's oracle: pass iff the arrival is at or before the last read within the window. */
function oracle(c: Case): boolean {
  if (c.arrival === null) return false;
  const inWindow = readTimes(c.extras).filter((r) => r <= WINDOW);
  return c.arrival <= Math.max(...inWindow);
}

/** Run `awaitDelivery` on a fresh tmp app log under the case's schedule. */
async function deliver(c: Case, dir: string, n: number) {
  const appLog = path.join(dir, `app-${n}.jsonl`);
  const target = path.join(dir, "b.md");
  const clock = fakeClock(1000);
  const start = clock.now();
  let i = 0;
  const d = { now: clock.now, sleep: (ms: number) => clock.sleep(ms + (c.extras[i++] ?? 0)) };
  const write = (at: number, text: string) => {
    if (at === 0) appendText(appLog, text);
    else clock.at(start + at, () => appendText(appLog, text));
  };
  for (const x of c.noise) write(x.at, x.text);
  if (c.arrival !== null) write(c.arrival, delivered(target, c.source));
  if (c.partialAt !== null) write(c.partialAt, `{"event":"file.open.external","status":"success","context":{"filePath":${JSON.stringify(target)}`);
  return (await awaitDelivery(d, { appLog, offset: 0, names: [target], start, timeoutMs: WINDOW })) as { source: string } | null;
}

describe("D82-WI-3 IR-M2-3: seeded window property", () => {
  it(`IR-M2-3 seed ${SEED}, 200 schedules: hit iff seen by a read at elapsed <= T; earlier arrival never fails`, async () => {
    const dir = fs.mkdtempSync("/tmp/irm2");
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const target = path.join(dir, "b.md");
    const noiseKinds = [
      () => delivered(path.join(dir, "other.md")),
      () => entry("file.open.external", "start", { filePath: target, source: "single_instance" }),
      () => '{"event":"file.open.external",\n',
    ];
    const r = mulberry32(SEED);
    const mismatches: unknown[] = [];
    let passes = 0;
    let lateReads = 0;
    let n = 0;
    for (let k = 0; k < 200; k++) {
      const extras = Array.from({ length: 16 }, () => int(r, 0, 2 * P));
      const arrival = r() < 0.1 ? null : int(r, 0, 13 * P);
      const noise = Array.from({ length: int(r, 0, 3) }, () => ({ at: int(r, 0, 13 * P), text: pick(r, noiseKinds)() }));
      // a partial trailing line is written only after the delivery, so it never merges with it
      const partialAt = r() < 0.5 ? (arrival ?? 0) + int(r, 1, 3 * P) : null;
      const c: Case = { extras, arrival, source: pick(r, ["finder", "single_instance"]), noise, partialAt };
      const want = oracle(c);
      const hit = await deliver(c, dir, n++);
      if ((hit !== null) !== want || (hit !== null && hit.source !== c.source)) mismatches.push({ k, c, want, hit });
      if (readTimes(extras).at(-1)! > WINDOW && arrival !== null && !want && arrival <= readTimes(extras).at(-1)!) lateReads += 1;
      if (want && c.arrival !== null) {
        passes += 1;
        if (c.arrival > 0) {
          const earlier = { ...c, arrival: c.arrival - int(r, 1, c.arrival) };
          const again = await deliver(earlier, dir, n++);
          if (again === null) mismatches.push({ k, metamorphic: earlier });
        }
      }
    }
    expect(mismatches).toEqual([]);
    // non-vacuity: both outcomes occur, and some cases have a late read that saw the line
    expect(passes).toBeGreaterThan(20);
    expect(200 - passes).toBeGreaterThan(20);
    expect(lateReads).toBeGreaterThan(0);
  });
});
