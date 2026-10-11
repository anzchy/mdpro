// @vitest-environment node
/**
 * D105-WI-2 (fixes D105 ①): `acquireLock`, `releaseLock` and
 * `releaseOrphanLock` run inside `.lock.mutex` (`scripts/control/lockMutex.mjs`),
 * so an in-protocol acquire can no longer land between a release's rename
 * and its restore. Real tmp fs; in-protocol competitors are `"in"` shots of
 * `tests/support/lockSchedules.ts` (deferred to just after the caller's
 * mutex unlink, as a waiting process would be). Live mutex holders are real
 * sleeping child processes.
 * Plan and matrix: `.claude/tdd-guardian/plan-d105-20261011-144108.md`,
 * D105-WI-2, EX-1, EX-2, EX-5, EX-6 (EX-3 and EX-4 are in
 * `control-launcher-lock-schedules.test.ts`).
 * Post-plan addition: EX-6 also covers `acquireLock` with a busy mutex.
 *
 * Refusal messages are pinned here as literals, never imported.
 */
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireLock,
  releaseLock,
  releaseOrphanLock,
  // @ts-expect-error -- plain ESM script, no .d.ts by design
} from "../scripts/control/lock.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run as launch } from "../scripts/control/launch.mjs";
import { last, launchFixture, type Fixture } from "./support/launchHarness";
import {
  A,
  B,
  C,
  N1,
  N2,
  N3,
  type Shot,
  cleanupParents,
  freshParent,
  lockFile,
  outcome,
  recordBytes,
  runSchedule,
  tombsIn,
} from "./support/lockSchedules";

const children: ChildProcess[] = [];
const fixtures: Fixture[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const c of children.splice(0)) if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
  for (const fx of fixtures.splice(0)) fx.cleanup();
  cleanupParents();
});

const MUTEX_FILES_RE = /^\.lock\.mutex/;
const mutexFiles = (p: string) => fs.readdirSync(p).filter((n) => MUTEX_FILES_RE.test(n));
const lockBytes = (p: string) => (fs.existsSync(lockFile(p)) ? fs.readFileSync(lockFile(p), "latin1") : null);
const NONCES: Record<string, string> = { [A]: N1, [B]: N2, [C]: N3 };
const short = (run: string) => run[0].toUpperCase();

type Fn = "releaseLock" | "releaseOrphanLock";
const CALL: Record<Fn, (p: string) => string> = {
  releaseLock: (p) => releaseLock(p, { run: A, nonce: N1 }),
  releaseOrphanLock: (p) => releaseOrphanLock(p, A),
};

/** Who holds the lock by the callers' own accounts: successful acquires not yet released. */
type World = { holders: string[]; log: string[] };
const world = (): World => ({ holders: [A], log: [] });
function acq(p: string, w: World, run: string, label: string): void {
  const r = outcome(() => {
    acquireLock(p, { run, nonce: NONCES[run] });
    return "acquired";
  });
  if (r === "acquired") w.holders.push(run);
  w.log.push(`${label} acquire ${short(run)}: ${typeof r === "string" ? r : r.error}`);
}
function rel(p: string, w: World, run: string, label: string): void {
  const r = outcome(() => releaseLock(p, { run, nonce: NONCES[run] }));
  if (r === "released") w.holders = w.holders.filter((h) => h !== run);
  w.log.push(`${label} release ${short(run)}: ${typeof r === "string" ? r : r.error}`);
}
/** S1: a duplicate release of A, then a launch of B (both in protocol). */
const s1 = (p: string, w: World): Shot => ({
  at: "pre-rename",
  protocol: "in",
  competitor: () => {
    rel(p, w, A, "S1");
    acq(p, w, B, "S1");
  },
});
/** S2: a launch of C (in protocol). */
const s2 = (p: string, w: World, at: Shot["at"]): Shot => ({ at, protocol: "in", competitor: () => acq(p, w, C, "S2") });

/** The main release, folded into the world's accounting. */
function mainRelease(p: string, w: World, fn: Fn, shots: Shot[]) {
  const r = runSchedule(p, shots, () => CALL[fn](p));
  if (r.result === "released") w.holders = w.holders.filter((h) => h !== A);
  return r;
}

describe("D105-WI-2 EX-1 an in-protocol acquire never lands inside a release", () => {
  it.each(Object.keys(CALL) as Fn[])("EX-1 %s: A released, S1 finds it absent and B acquires, S2 is refused by B; one holder, no residue", (fn) => {
    const p = freshParent();
    acquireLock(p, { run: A, nonce: N1 });
    const w = world();
    const r = mainRelease(p, w, fn, [s1(p, w), s2(p, w, "pre-link")]);
    expect({
      result: r.result,
      fired: r.fired,
      log: w.log,
      holders: w.holders,
      lock: lockBytes(p),
      tombs: tombsIn(p),
      mutex: mutexFiles(p),
    }).toEqual({
      result: "released",
      fired: [1, 1],
      log: ["S1 release A: absent", "S1 acquire B: acquired", `S2 acquire C: lock held by run ${B}`],
      holders: [B],
      lock: recordBytes(B, N2),
      tombs: [],
      mutex: [],
    });
  });
});

describe("D105-WI-2 EX-2 exclusivity over every injection point", () => {
  it("EX-2 S1 at pre-rename, S2 at every later index, both functions: at most one holder, and .lock is that holder's", () => {
    const found: string[] = [];
    let combos = 0;
    for (const fn of Object.keys(CALL) as Fn[]) {
      const dryP = freshParent();
      acquireLock(dryP, { run: A, nonce: N1 });
      const dry = mainRelease(dryP, world(), fn, [s1(dryP, world())]);
      const from = dry.firedAt[0];
      if (from === undefined) {
        found.push(`${fn}: S1 never reached pre-rename`);
        continue;
      }
      for (let k = from; k <= dry.calls; k++) {
        const p = freshParent();
        acquireLock(p, { run: A, nonce: N1 });
        const w = world();
        const r = mainRelease(p, w, fn, [s1(p, w), s2(p, w, k)]);
        const label = `${fn} k=${k}`;
        combos++;
        if (r.fired[0] !== 1 || r.fired[1] !== 1) found.push(`${label}: fired ${JSON.stringify(r.fired)}`);
        if (w.holders.length > 1) found.push(`${label}: holders ${w.holders.map(short).join(",")} ${JSON.stringify(r.result)}`);
        const want = w.holders.length === 1 ? recordBytes(w.holders[0], NONCES[w.holders[0]]) : null;
        if (lockBytes(p) !== want) found.push(`${label}: .lock ${JSON.stringify(lockBytes(p))} want ${JSON.stringify(want)}`);
        if (mutexFiles(p).length > 0) found.push(`${label}: mutex files ${JSON.stringify(mutexFiles(p))}`);
      }
    }
    expect(combos).toBeGreaterThan(4);
    expect(found).toEqual([]);
  });
});

/** A live child that sleeps until killed. */
function sleeper(): number {
  const c = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  children.push(c);
  return c.pid as number;
}
const holdMutex = (p: string, pid: number) =>
  fs.writeFileSync(path.join(p, ".lock.mutex"), JSON.stringify({ pid, token: "0123456789abcdef" }), { mode: 0o600 });

describe("D105-WI-2 EX-5 / EX-6 a busy mutex refuses and changes nothing", () => {
  it("EX-5 launch with the mutex held by a live process: driver failure naming its pid, no run dir, no lock", async () => {
    const fx = launchFixture();
    fixtures.push(fx);
    fs.mkdirSync(fx.parent, { recursive: true, mode: 0o700 });
    const pid = sleeper();
    holdMutex(fx.parent, pid);
    const r = await launch({ file: "/tmp/f.md" }, { ...fx.deps, lockMutexWaitMs: 50 });
    expect(r.exit).toBe(1);
    expect(last(fx.out)).toBe(`verdict: driver failure — lock busy: mutex held by pid ${pid}`);
    expect(fs.existsSync(fx.lay.runDir)).toBe(false);
    expect(fs.existsSync(lockFile(fx.parent))).toBe(false);
    expect(fx.spawn.calls).toHaveLength(0);
  });

  const ROWS = [
    { fn: "releaseLock", call: (p: string) => releaseLock(p, { run: A, nonce: N1 }, { mutexWaitMs: 50 }) },
    { fn: "releaseOrphanLock", call: (p: string) => releaseOrphanLock(p, A, { mutexWaitMs: 50 }) },
    { fn: "acquireLock", call: (p: string) => JSON.stringify(acquireLock(p, { run: C, nonce: N3 }, { mutexWaitMs: 50 })) },
  ];
  it.each(ROWS)("EX-6 $fn with the mutex held by a live process: lock busy, .lock byte-identical, no tomb", ({ call }) => {
    const p = freshParent();
    acquireLock(p, { run: A, nonce: N1 });
    const before = { bytes: fs.readFileSync(lockFile(p)), mtimeMs: fs.statSync(lockFile(p)).mtimeMs };
    const pid = sleeper();
    holdMutex(p, pid);
    expect(outcome(() => call(p))).toEqual({ error: `lock busy: mutex held by pid ${pid}` });
    expect(fs.readFileSync(lockFile(p)).equals(before.bytes)).toBe(true);
    expect(fs.statSync(lockFile(p)).mtimeMs).toBe(before.mtimeMs);
    expect(tombsIn(p)).toEqual([]);
    expect(fs.readdirSync(p).sort()).toEqual([".lock", ".lock.mutex"]);
  });
});
