// @vitest-environment node
/**
 * D174-WI-2: lock leftovers in the verdict. A leftover that the next
 * launch's acquire refuses on, and that nothing will ever clear, fails the
 * `no run lock` check (`lock leftover blocks launches: <names>`), so doctor's
 * verdict is `fail` and `launch`'s doctor gate refuses before it creates
 * anything: any tomb; a `.lock.mutex` that is unreadable, irregular or held by
 * an unknown (EPERM) pid; a `.lock.mutex.break` in any state but a live
 * holder, but only beside a mutex whose holder is dead (D179-WI-2: acquire
 * reads the break file only then). Everything else stays `[info]` only:
 * temps, a mutex whose holder is dead (the next section breaks it) or alive
 * (in use), a break file on its own, and every `.clean.<run>` marker (it
 * never touches launch).
 *
 * The bundle, manifest and source-tree facts are set to their good values;
 * the runs-parent facts are collected for real (as LA-05 row 3 does). Real
 * pids: a live child, an exited child, pid 1 for EPERM.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, afterEach, describe, expect, it } from "vitest";
import { last, launchFixture } from "../support/launchHarness";
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
  tombBody,
  type Env,
} from "../support/lockLeftovers";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { collectFacts } from "../../scripts/control/doctor.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run as launchRun } from "../../scripts/control/launch.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { acquireLock } from "../../scripts/control/lock.mjs";

const MUTEX = ".lock.mutex";
const BREAK = ".lock.mutex.break";
const CLEAN = `.clean.${RUN}`;
const TOMB = ".lock.4242-89abcdef01234567.tomb";
const NEXT = "  next: remove the blocking lock leftovers listed below, then pnpm control:doctor";
const lockLines = (lines: string[]) => lines.filter((l) => / no run lock(:|$)/.test(l));

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

/**
 * One seed: a file name and how to write it (a dir, or a body built from the
 * live / dead pid). `stuck` marks a break file that blocks beside a
 * `deadMutex` seed and nowhere else (D179-WI-2).
 */
type Seed = { row: string; name: string; dir?: true; body?: () => string; eperm?: true; stuck?: true; deadMutex?: true };
const BLOCKING: Seed[] = [
  { row: "a readable tomb", name: TOMB, body: () => tombBody(RUN) },
  { row: "an empty tomb", name: TOMB, body: () => "" },
  { row: "an empty mutex", name: MUTEX, body: () => "" },
  { row: "a mutex that is a directory", name: MUTEX, dir: true },
  { row: "a mutex held by pid 1 (EPERM)", name: MUTEX, body: () => holderBody(1), eperm: true },
];
const NON_BLOCKING: Seed[] = [
  { row: "a mutex temp", name: ".lock.mutex.4242-fedcba9876543210.tmp", body: () => holderBody(live.pid) },
  { row: "a clean temp", name: `.clean.${RUN}.4242-fedcba9876543210.tmp`, body: () => "" },
  // rule 12: these three break seeds sat in BLOCKING under D174-WI-2; a break file alone does
  // not block acquire (lockMutex enter() reads it only on EEXIST), so D179-WI-2 moves them (b80).
  { row: "a break file with a dead holder", name: BREAK, body: () => holderBody(dead), stuck: true },
  { row: "a partial break file", name: BREAK, body: () => '{"pid":', stuck: true },
  { row: "a break file held by pid 1 (EPERM)", name: BREAK, body: () => holderBody(1), eperm: true, stuck: true },
  // rule 12: `deadMutex` added (D179-WI-2) so LV-06 can pair it with a stuck break file.
  { row: "a mutex with a dead holder", name: MUTEX, body: () => holderBody(dead), deadMutex: true },
  { row: "a mutex with a live holder", name: MUTEX, body: () => holderBody(live.pid) },
  { row: "a break file with a live holder", name: BREAK, body: () => holderBody(live.pid) },
  { row: "a clean marker with a live holder", name: CLEAN, body: () => holderBody(live.pid) },
  { row: "a clean marker with a dead holder", name: CLEAN, body: () => holderBody(dead) },
  { row: "an empty clean marker", name: CLEAN, body: () => "" },
  { row: "a clean marker held by pid 1 (EPERM)", name: CLEAN, body: () => holderBody(1), eperm: true },
];
function seed(e: Env, s: Seed): void {
  if (s.dir) fs.mkdirSync(path.join(e.parent, s.name));
  else put(e, s.name, (s.body as () => string)());
}
const runnable = (s: Seed) => canEperm || !s.eperm;

describe("D174-WI-2 doctor verdict: which leftovers block", () => {
  it("LV-01 an empty runs parent passes", async () => {
    const r = await passingDoctor(env());
    expect(lockLines(r.lines)).toEqual(["[pass] no run lock"]);
    expect({ verdict: last(r.lines), exit: r.exit }).toEqual({ verdict: "verdict: pass", exit: 0 });
  });

  it.each(BLOCKING.filter(runnable))("LV-02 $row fails no run lock, names the file, verdict fail", async (s) => {
    const e = env();
    seed(e, s);
    const r = await passingDoctor(e);
    const line = `[FAIL] no run lock: lock leftover blocks launches: ${s.name}`;
    expect(lockLines(r.lines)).toEqual([line]);
    expect(r.lines[r.lines.indexOf(line) + 1]).toBe(NEXT);
    expect(r.lines.filter((l) => l.startsWith("[FAIL] "))).toEqual([line]);
    expect(leftoverLines(r.lines)).toHaveLength(1);
    expect({ verdict: last(r.lines), exit: r.exit }).toEqual({ verdict: "verdict: fail", exit: 1 });
  });

  it.each(NON_BLOCKING.filter(runnable))("LV-03 $row is reported but passes", async (s) => {
    const e = env();
    seed(e, s);
    const r = await passingDoctor(e);
    expect(lockLines(r.lines)).toEqual(["[pass] no run lock"]);
    expect(leftoverLines(r.lines)).toHaveLength(1);
    expect({ verdict: last(r.lines), exit: r.exit }).toEqual({ verdict: "verdict: pass", exit: 0 });
  });

  it("LV-04 several blockers are named in name order; a dead mutex beside a dead break file is not one of them", async () => {
    const e = env();
    put(e, MUTEX, holderBody(dead));
    put(e, BREAK, holderBody(dead));
    put(e, TOMB, tombBody(RUN));
    put(e, ".lock.mutex.4242-fedcba9876543210.tmp", "");
    const r = await passingDoctor(e);
    expect(lockLines(r.lines)).toEqual([`[FAIL] no run lock: lock leftover blocks launches: ${TOMB}, ${BREAK}`]);
    expect(leftoverLines(r.lines)).toHaveLength(4);
    expect(r.exit).toBe(1);
  });

  it("LV-05 a stale .lock beside a tomb keeps the stale-lock line and next step (the lock is judged first)", async () => {
    const e = env();
    acquireLock(e.parent, { run: RUN, nonce: "ab".repeat(32) });
    put(e, TOMB, tombBody(RUN));
    const r = await passingDoctor(e);
    const line = `[FAIL] no run lock: stale lock names run ${RUN}`;
    expect(lockLines(r.lines)).toEqual([line]);
    expect(r.lines[r.lines.indexOf(line) + 1]).toBe(`  next: pnpm control:clean ${RUN}`);
    expect(leftoverLines(r.lines)).toEqual([expect.stringMatching(new RegExp(`^\\[info\\] lock leftover ${TOMB.replace(/\./g, "\\.")}: `))]);
    expect(r.exit).toBe(1);
  });

  // rule 12: LV-06 (D174-WI-2) gains the break-beside-dead-mutex pair, the one case acquire refuses on a break file (D179-WI-2).
  it("LV-06 conjunction law: over every pair of distinct-name seeds, doctor fails exactly when one of them blocks, or a stuck break file sits beside a dead mutex", async () => {
    const all = [...BLOCKING.map((s) => ({ s, blocks: true })), ...NON_BLOCKING.map((s) => ({ s, blocks: false }))].filter(
      (x) => runnable(x.s),
    );
    let pairs = 0;
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const [a, b] = [all[i], all[j]];
        if (a.s.name === b.s.name) continue;
        const e = makeEnv();
        try {
          seed(e, a.s);
          seed(e, b.s);
          const r = await passingDoctor(e);
          const pairBlocks = (a.s.stuck && b.s.deadMutex) || (b.s.stuck && a.s.deadMutex);
          // rule 12: was `a.blocks || b.blocks` under D174-WI-2; see LV-06 note above.
          const want = a.blocks || b.blocks || pairBlocks ? 1 : 0;
          expect(r.exit, `${a.s.row} + ${b.s.row}`).toBe(want);
          expect(leftoverLines(r.lines), `${a.s.row} + ${b.s.row}`).toHaveLength(2);
          pairs++;
        } finally {
          await e.dispose();
        }
      }
    }
    expect(pairs).toBeGreaterThan(50);
  });
});

describe("D174-WI-2 launch's doctor gate", () => {
  const realFacts = async (d: unknown) => ({
    ...(await collectFacts(d)),
    bundlePresent: true,
    manifest: { ok: true, buildId: "b1", profile: "verify" },
    sourceTreeMatches: true,
  });

  it("LV-07 a tomb refuses launch at the gate: verdict fail, the leftover line printed, no run dir, no spawn", async () => {
    const fx = launchFixture();
    disposers.push(fx.cleanup);
    fs.mkdirSync(fx.parent, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(fx.parent, TOMB), tombBody(RUN), { mode: 0o600 });
    fx.deps.collectDoctorFacts = realFacts;
    const r = await launchRun({ file: "/tmp/f.md" }, fx.deps);
    expect(last(fx.out)).toBe("verdict: fail");
    expect(r.exit).toBe(1);
    expect(fx.out).toContain(`[FAIL] no run lock: lock leftover blocks launches: ${TOMB}`);
    expect(fs.existsSync(fx.lay.runDir)).toBe(false);
    expect(fs.readdirSync(fx.parent)).toEqual([TOMB]);
    expect(fx.spawn.calls).toHaveLength(0);
  });

  it("LV-08 a mutex with a dead holder does not refuse launch: the acquire breaks it and the launch passes", async () => {
    const fx = launchFixture();
    disposers.push(fx.cleanup);
    fs.mkdirSync(fx.parent, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(fx.parent, MUTEX), holderBody(dead), { mode: 0o600 });
    fx.deps.collectDoctorFacts = realFacts;
    const r = await launchRun({ file: "/tmp/f.md" }, fx.deps);
    expect(last(fx.out)).toBe("verdict: pass");
    expect(r.exit).toBe(0);
    expect(fs.existsSync(path.join(fx.parent, MUTEX))).toBe(false);
  });
});
