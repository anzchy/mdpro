// @vitest-environment node
/**
 * D148-WI-2: only one `clean` acts on a run's lock. A cleaner claims
 * `<parent>/.clean.<R>` (`{ pid, token }`, created, replaced and removed only
 * inside `.lock.mutex`) right before its first mutation and drops it when it
 * exits. A second `clean R` meanwhile refuses with
 * `driver failure — run R is being cleaned (cleaner pid <n>, .clean.R)` and
 * leaves the lock alone. A marker whose pid is ESRCH is replaced.
 *
 * Real fs, real lock, real sockets. The second cleaner B runs from inside
 * cleaner A's probe calls (or A's `rmSync`), the windows where A is between
 * its reads and its mutations, or between its mutations and its exit. Both
 * cleaners share this process's pid, as a live second process would read.
 * Plan and matrix: `.claude/tdd-guardian/plan-d148-20261011-164204.md`,
 * D148-WI-2, CC-1..CC-8.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { walk } from "../support/launchHarness";
import {
  acquireLock,
  DF,
  disposeAll,
  type Fx,
  makeStaleSocket,
  N2,
  NAME,
  NONCE,
  ORPHAN_NONCE,
  orphanFixture,
  OTHER,
  type Probe,
  RELEASED,
  runFixture,
  secondCleaner,
  SOCK_REMOVED,
  tombsIn,
} from "../support/cleanSockFixtures";
import { outcome, recordBytes, sha256 } from "../support/lockSchedules";

const children: ChildProcess[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const c of children.splice(0)) if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
  await disposeAll();
});

const MARKER = `.clean.${NAME}`;
const REMOVED = `clean: removed ${NAME}`;
const BEING_CLEANED = (pid: number) => `${DF}run ${NAME} is being cleaned (cleaner pid ${pid}, ${MARKER})`;
const TOKEN = "0123456789abcdef";

const lockBytes = (fx: Fx) => (fs.existsSync(fx.lockPath) ? fs.readFileSync(fx.lockPath, "utf8") : null);
const leftovers = (fx: Fx) => ({
  lock: lockBytes(fx),
  markers: fs.readdirSync(fx.parent).filter((n) => n.startsWith(".clean.")),
  mutex: fs.readdirSync(fx.parent).filter((n) => n.startsWith(".lock.mutex")),
  tombs: tombsIn(fx.parent),
});
const CLEAN_END = { lock: null, markers: [], mutex: [], tombs: [] };

/** The pid of a child that has already exited and been reaped (ESRCH). */
const deadPid = () => spawnSync(process.execPath, ["-e", ""]).pid as number;

/** A probe answering `stale`; on call `at` it first runs `window()`. */
function probeWith(at: number, window: () => Promise<void> | void) {
  let calls = 0;
  return async (): Promise<Probe> => {
    calls += 1;
    if (calls === at) await window();
    return "stale";
  };
}

/** Run a second `clean R` (scan [], probe absent) on `fx`, noting `.lock` around it. */
async function runB(fx: Fx) {
  const b = secondCleaner(fx, { probe: async (): Promise<Probe> => "absent", scan: [] });
  const before = lockBytes(fx);
  const r = await b.clean();
  return { out: b.out, exit: r.exit, before, after: lockBytes(fx) };
}

describe("D148-WI-2 a second clean while the first is mid-clean refuses and leaves the lock", () => {
  it("CC-1 run path: B during A's re-probe refuses; R's lock is A's until A releases it", async () => {
    let fx: ReturnType<typeof runFixture> | null = null;
    let b: Awaited<ReturnType<typeof runB>> | null = null;
    fx = runFixture({ probe: probeWith(2, async () => void (b = await runB(fx as Fx))) });
    await makeStaleSocket(fx.siSock);
    const r = await fx.clean();
    expect(b).toEqual({ out: [BEING_CLEANED(process.pid)], exit: 1, before: recordBytes(NAME, NONCE), after: recordBytes(NAME, NONCE) });
    expect({ exit: r.exit, out: fx.out }).toEqual({ exit: 0, out: [REMOVED, SOCK_REMOVED, "verdict: pass"] });
    expect(leftovers(fx)).toEqual(CLEAN_END);
  });

  it("CC-2 orphan path: B during A's re-probe refuses; A releases the orphan lock itself", async () => {
    let fx: ReturnType<typeof orphanFixture> | null = null;
    let b: Awaited<ReturnType<typeof runB>> | null = null;
    fx = orphanFixture({ probe: probeWith(2, async () => void (b = await runB(fx as Fx))) });
    await makeStaleSocket(fx.siSock);
    const r = await fx.clean();
    expect(b).toEqual({
      out: [BEING_CLEANED(process.pid)],
      exit: 1,
      before: recordBytes(NAME, ORPHAN_NONCE),
      after: recordBytes(NAME, ORPHAN_NONCE),
    });
    expect({ exit: r.exit, out: fx.out }).toEqual({ exit: 0, out: [RELEASED, SOCK_REMOVED, "verdict: pass"] });
    expect(leftovers(fx)).toEqual(CLEAN_END);
  });

  it("CC-3 a launch tried after B, still inside A's clean, is refused; A passes", async () => {
    let fx: ReturnType<typeof runFixture> | null = null;
    let b: Awaited<ReturnType<typeof runB>> | null = null;
    let launch: unknown = null;
    fx = runFixture({
      probe: probeWith(2, async () => {
        const f = fx as ReturnType<typeof runFixture>;
        b = await runB(f);
        launch = outcome(() => JSON.stringify(acquireLock(f.parent, { run: OTHER, nonce: N2 })));
      }),
    });
    await makeStaleSocket(fx.siSock);
    const r = await fx.clean();
    // Type-only: TS narrows `b` to `null` (it is assigned inside the probe closure); widen it back.
    b = b as Awaited<ReturnType<typeof runB>> | null;
    expect({ b: b?.out, launch }).toEqual({ b: [BEING_CLEANED(process.pid)], launch: { error: `lock held by run ${NAME}` } });
    expect({ exit: r.exit, out: fx.out }).toEqual({ exit: 0, out: [REMOVED, SOCK_REMOVED, "verdict: pass"] });
    expect(leftovers(fx)).toEqual(CLEAN_END);
  });
});

describe("D148-WI-2 CC-4 law: over every injection point exactly one cleaner cleans R", () => {
  type Cell = { kind: "run" | "orphan"; at: "probe 1" | "rmSync" | "probe 2" };
  const CELLS: Cell[] = [
    { kind: "run", at: "probe 1" },
    { kind: "run", at: "rmSync" },
    { kind: "run", at: "probe 2" },
    { kind: "orphan", at: "probe 1" },
    { kind: "orphan", at: "probe 2" },
  ];

  async function cell({ kind, at }: Cell) {
    let fx: Fx | null = null;
    let b: Promise<Awaited<ReturnType<typeof runB>>> | null = null;
    const startB = () => {
      if (b === null) b = runB(fx as Fx);
    };
    const probe = at === "rmSync" ? probeWith(0, () => {}) : probeWith(at === "probe 1" ? 1 : 2, async () => void (await (startB(), b)));
    const rmSync = ((p: fs.PathLike, o?: fs.RmOptions) => {
      if (at === "rmSync") startB();
      fs.rmSync(p, o);
    }) as typeof fs.rmSync;
    fx = kind === "run" ? runFixture({ probe, rmSync }) : orphanFixture({ probe });
    await makeStaleSocket(fx.siSock);
    await fx.clean();
    const bDone = await (b as unknown as Promise<Awaited<ReturnType<typeof runB>>>);
    const lines = [...fx.out, ...bDone.out];
    const refused = bDone.out[0]?.startsWith(`${DF}run ${NAME} is being cleaned`) ?? false;
    return {
      cell: `${kind} × ${at}`,
      successes: lines.filter((l) => l === REMOVED || l === RELEASED).length,
      refusedChangedLock: refused && bDone.before !== bDone.after,
      end: leftovers(fx),
    };
  }

  it("5 cells: one success report, a refusing cleaner leaves .lock as it found it, nothing left behind", async () => {
    const got = [];
    const want = [];
    for (const c of CELLS) {
      got.push(await cell(c));
      await disposeAll();
      want.push({ cell: `${c.kind} × ${c.at}`, successes: 1, refusedChangedLock: false, end: CLEAN_END });
    }
    expect(got).toEqual(want);
  });
});

describe("D148-WI-2 the clean marker itself", () => {
  it("CC-5 a marker left by a dead cleaner is replaced; the clean passes and drops it", async () => {
    const fx = runFixture({ probe: async (): Promise<Probe> => "absent" });
    fs.writeFileSync(path.join(fx.parent, MARKER), JSON.stringify({ pid: deadPid(), token: TOKEN }), { mode: 0o600 });
    const r = await fx.clean();
    expect({ exit: r.exit, out: fx.out }).toEqual({ exit: 0, out: [REMOVED, "verdict: pass"] });
    expect(leftovers(fx)).toEqual(CLEAN_END);
  });

  it("CC-6 a marker held by a live process refuses before any removal: R, the lock and the marker unchanged", async () => {
    const fx = runFixture({ probe: async (): Promise<Probe> => "absent" });
    const c = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
    children.push(c);
    const marker = path.join(fx.parent, MARKER);
    fs.writeFileSync(marker, JSON.stringify({ pid: c.pid, token: TOKEN }), { mode: 0o600 });
    const before = { run: walk(fx.lay.runDir), lock: lockBytes(fx), marker: fs.readFileSync(marker, "utf8") };
    const r = await fx.clean();
    expect({ exit: r.exit, out: fx.out }).toEqual({ exit: 1, out: [BEING_CLEANED(c.pid as number)] });
    expect({ run: walk(fx.lay.runDir), lock: lockBytes(fx), marker: fs.readFileSync(marker, "utf8") }).toEqual(before);
  });

  it("CC-7 an unreadable marker refuses and is kept", async () => {
    const fx = runFixture({ probe: async (): Promise<Probe> => "absent" });
    const marker = path.join(fx.parent, MARKER);
    fs.writeFileSync(marker, "{", { mode: 0o600 });
    const before = walk(fx.lay.runDir);
    const r = await fx.clean();
    expect({ exit: r.exit, out: fx.out }).toEqual({ exit: 1, out: [`${DF}clean marker unreadable (${MARKER})`] });
    expect(fs.readFileSync(marker, "utf8")).toBe("{");
    expect(walk(fx.lay.runDir)).toEqual(before);
    expect(lockBytes(fx)).toBe(recordBytes(NAME, NONCE));
  });

  it("CC-8 while R is removed the marker holds only this cleaner's { pid, token }, never the nonce", async () => {
    const seen: string[] = [];
    let fx: ReturnType<typeof runFixture> | null = null;
    const rmSync = ((p: fs.PathLike, o?: fs.RmOptions) => {
      if (seen.length === 0) seen.push(fs.readFileSync(path.join((fx as Fx).parent, MARKER), "utf8"));
      fs.rmSync(p, o);
    }) as typeof fs.rmSync;
    fx = runFixture({ probe: async (): Promise<Probe> => "absent", rmSync });
    const r = await fx.clean();
    expect(r.exit).toBe(0);
    const rec = JSON.parse(seen[0]);
    expect(Object.keys(rec).sort()).toEqual(["pid", "token"]);
    expect(rec.pid).toBe(process.pid);
    expect(rec.token).toMatch(/^[0-9a-f]{16}$/);
    for (const secret of [NONCE, sha256(NONCE)]) expect(seen[0]).not.toContain(secret);
    expect(fx.out).toEqual([REMOVED, "verdict: pass"]);
  });
});
