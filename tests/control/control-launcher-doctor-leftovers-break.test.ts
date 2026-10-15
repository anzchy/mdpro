// @vitest-environment node
/**
 * D179-WI-2 (audit finding b80): doctor's verdict on `.lock.mutex.break`
 * matches what `lockMutex.enter()` does. `enter()` reads the break file only
 * when creating `.lock.mutex` hits EEXIST and the mutex holder is provably
 * dead (ESRCH): then `breakDead` cannot create the break file and the
 * section waits, `lock busy: mutex break file kept (.lock.mutex.break)`,
 * until a human removes it. With no mutex, the create succeeds and the break
 * file is never looked at (proved on a device: acquireLock OK in 1 ms beside
 * a dead-pid break file). With a live, unknown or unreadable mutex, the wait
 * is on the mutex, and the mutex is what doctor names.
 *
 * So a break file in any state but a live holder blocks launches exactly
 * when a `.lock.mutex` with a dead holder sits beside it. Each case runs the
 * real doctor and the real `acquireLock` on the same runs parent, so the two
 * cannot disagree. Real pids: a live child, an exited child, pid 1 for EPERM.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { last } from "../support/launchHarness";
import {
  RUN,
  canEperm,
  deadPid,
  holderBody,
  leftoverLines,
  liveChild,
  makeEnv,
  passingDoctor,
  put,
  type Env,
} from "../support/lockLeftovers";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { acquireLock } from "../../scripts/control/lock.mjs";

const MUTEX = ".lock.mutex";
const BREAK = ".lock.mutex.break";
const SHORT_WAIT_MS = 50;
const lockLines = (lines: string[]) => lines.filter((l) => / no run lock(:|$)/.test(l));
const lineOf = (lines: string[], name: string) => leftoverLines(lines).find((l) => l.startsWith(`[info] lock leftover ${name}: `));

let live: { pid: number; stop: () => Promise<void> };
let dead: number;
beforeAll(async () => {
  live = await liveChild();
  dead = await deadPid();
});
afterAll(async () => live.stop());

let disposers: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const d of disposers.reverse()) await d();
  disposers = [];
});
function env(): Env {
  const e = makeEnv();
  disposers.push(e.dispose);
  return e;
}

/** What acquireLock does on the parent: "ok" or its error message. */
function acquire(e: Env): string {
  try {
    acquireLock(e.parent, { run: RUN, nonce: "ab".repeat(32) }, { mutexWaitMs: SHORT_WAIT_MS });
    return "ok";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

type Stuck = { row: string; seed: (e: Env) => void; eperm?: true };
const STUCK: Stuck[] = [
  { row: "a dead holder", seed: (e) => put(e, BREAK, holderBody(dead)) },
  { row: "a partial record", seed: (e) => put(e, BREAK, '{"pid":') },
  { row: "pid 1 (EPERM)", seed: (e) => put(e, BREAK, holderBody(1)), eperm: true },
  { row: "a directory", seed: (e) => fs.mkdirSync(path.join(e.parent, BREAK)) },
];
const runnable = (s: Stuck) => canEperm || !s.eperm;

describe("D179-WI-2 a break file on its own blocks nothing", () => {
  it.each(STUCK.filter(runnable))("LB-01 a break file with $row and no .lock.mutex: [info] line, no blocks, verdict pass, acquire succeeds", async (s) => {
    const e = env();
    s.seed(e);
    const r = await passingDoctor(e);
    const line = lineOf(r.lines, BREAK);
    expect(line).toBeDefined();
    expect(line).not.toContain("blocks launches");
    expect(lockLines(r.lines)).toEqual(["[pass] no run lock"]);
    expect({ verdict: last(r.lines), exit: r.exit }).toEqual({ verdict: "verdict: pass", exit: 0 });
    expect(acquire(e)).toBe("ok");
  });
});

describe("D179-WI-2 a break file beside a dead mutex blocks launches", () => {
  it.each(STUCK.filter(runnable))("LB-02 a break file with $row beside a dead-holder mutex: only the break file is named, acquire refuses on it", async (s) => {
    const e = env();
    s.seed(e);
    put(e, MUTEX, holderBody(dead));
    const r = await passingDoctor(e);
    expect(lockLines(r.lines)).toEqual([`[FAIL] no run lock: lock leftover blocks launches: ${BREAK}`]);
    expect(lineOf(r.lines, BREAK)).toContain("; blocks launches");
    expect(lineOf(r.lines, MUTEX)).not.toContain("blocks launches");
    expect({ verdict: last(r.lines), exit: r.exit }).toEqual({ verdict: "verdict: fail", exit: 1 });
    expect(acquire(e)).toBe(`lock busy: mutex break file kept (${BREAK})`);
  });

  it("LB-03 removing that break file lets the next acquire break the dead mutex and succeed", async () => {
    const e = env();
    put(e, BREAK, holderBody(dead));
    put(e, MUTEX, holderBody(dead));
    fs.unlinkSync(path.join(e.parent, BREAK));
    expect(acquire(e)).toBe("ok");
  });
});

describe("D179-WI-2 beside any other mutex the break file is not what blocks", () => {
  it("LB-04 a dead break file beside a live-holder mutex: in use, verdict pass (the wait ends when the holder leaves)", async () => {
    const e = env();
    put(e, BREAK, holderBody(dead));
    put(e, MUTEX, holderBody(live.pid));
    const r = await passingDoctor(e);
    expect(lockLines(r.lines)).toEqual(["[pass] no run lock"]);
    expect(lineOf(r.lines, BREAK)).not.toContain("blocks launches");
    expect(acquire(e)).toBe(`lock busy: mutex held by pid ${live.pid}`);
  });

  it("LB-05 a dead break file beside an unreadable mutex: only the mutex is named", async () => {
    const e = env();
    put(e, BREAK, holderBody(dead));
    put(e, MUTEX, "");
    const r = await passingDoctor(e);
    expect(lockLines(r.lines)).toEqual([`[FAIL] no run lock: lock leftover blocks launches: ${MUTEX}`]);
    expect(acquire(e)).toBe("lock busy: mutex unreadable");
  });

  it("LB-06 a live break file beside a dead mutex: in use, not blocking", async () => {
    const e = env();
    put(e, BREAK, holderBody(live.pid));
    put(e, MUTEX, holderBody(dead));
    const r = await passingDoctor(e);
    expect(lockLines(r.lines)).toEqual(["[pass] no run lock"]);
    expect(lineOf(r.lines, BREAK)).toBe(`[info] lock leftover ${BREAK}: holder pid ${live.pid} alive, in use`);
  });
});
