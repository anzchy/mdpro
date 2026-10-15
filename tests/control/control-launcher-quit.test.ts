// @vitest-environment node
/**
 * ADR-0047 WI-003 WI-7: `quit` — the driver `run(args, deps)`.
 * Matrix: `.claude/tdd-guardian/tests-20261008-144444.md`, "Unit: quit#run",
 * QU-01..QU-09 plus a seeded property over the quit law; Round 3 (WI-R1)
 * QU-R1 (the `outside()` snapshot keeps directory mtimes). QU-INT (real `node`
 * children, real `ps` / `lsof` / `kill`) lives in the `.slow` sibling.
 *
 * Fixture: a run R built by a real LA-01 `launch` under a `makeHome()` home.
 * `deps.kill` (recording, clock-stamped) and `deps.procFacts` (scripted on the
 * fake clock) are the only fakes; the ownership verdict, the lock and the fs
 * are real. Verdict lines are pinned as literals, never imported.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { envGuard, last, launchFixture, LSTART, MAIN, NONCE, walk, type Fixture } from "../support/launchHarness";
import { scriptedProcFacts, timedKill } from "../support/launcherFakes";
import { int, mulberry32 } from "../support/seededRandom";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run as launchRun } from "../../scripts/control/launch.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { POLL_MS, QUIT_GRACE_MS, run as quitRun } from "../../scripts/control/quit.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { runName } from "../../scripts/control/runDir.mjs";

type Result = { exit: number; lines: string[] };
type Liveness = boolean | "unknown";
type Facts = { alive: Liveness; lstart?: string; exe?: string };
/** Facts for a pid at `elapsed` ms after quit started, given the signals it has received. */
type Timeline = (elapsed: number, signals: string[]) => Facts;

const GRACE: number = QUIT_GRACE_MS;
const P: number = POLL_MS;
const PID = 4242;
const OTHER = 5151;
const REUSED_LSTART = "Fri Oct  9 08:00:00 2026";
const FAIL = "verdict: fail — ";
const DF = "verdict: driver failure — ";

let fixtures: Fixture[] = [];
afterEach(() => {
  for (const fx of fixtures) fx.cleanup();
  fixtures = [];
});

const owned = (over: Partial<Facts> = {}): Facts => ({ alive: true, lstart: LSTART, exe: MAIN, ...over });
/** Alive until the named signal arrives, dead on the next poll after it. */
const diesOn =
  (sig: string): Timeline =>
  (_t, s) =>
    owned({ alive: !s.includes(sig) });

/** A launched run R plus quit's own deps. */
async function launched() {
  const fx = launchFixture();
  fixtures.push(fx);
  const r: Result = await launchRun({ file: "/tmp/f.md" }, fx.deps);
  expect(r.exit).toBe(0);
  const kill = timedKill(fx.clock.now);
  const out: string[] = [];
  const t0 = fx.clock.now();
  const lockPath = path.join(fx.parent, ".lock");
  let table: Record<number, Timeline> = { [PID]: () => owned() };
  const procFacts = scriptedProcFacts((pid) => table[pid]?.(fx.clock.now() - t0, kill.signalsTo(pid)));
  const deps = { passwdHome: fx.home, procFacts, kill, now: fx.clock.now, sleep: fx.clock.sleep, out: (l: string) => out.push(l), err: (l: string) => out.push(l) };
  return {
    fx,
    kill,
    out,
    t0,
    lockPath,
    lockBytes: () => fs.readFileSync(lockPath, "utf8"),
    procs: (t: Record<number, Timeline>) => {
      table = t;
    },
    quit: (args: Record<string, unknown> = { run: fx.name }): Promise<Result> => quitRun(args, deps),
    /**
     * Every entry under the real home outside R and the lock, with mtimes.
     * Only the runs parent's own directory mtime is dropped: unlinking `.lock`
     * legitimately touches it (post-red fix). Every other directory keeps its
     * mtime, so a file created and deleted elsewhere is still caught (WI-R1 QU-R1).
     */
    outside: () =>
      walk(fx.real)
        .filter((rel) => !rel.includes(fx.name) && path.basename(rel) !== ".lock")
        .map((rel) => {
          const st = fs.lstatSync(path.join(fx.real, rel));
          return { rel, mtimeMs: path.join(fx.real, rel) === fx.parent ? null : st.mtimeMs };
        }),
    text: () => {
      const log = fx.lay.launcherLog;
      return [...out, fs.existsSync(log) ? fs.readFileSync(log, "utf8") : ""].join("\n");
    },
  };
}
type Q = Awaited<ReturnType<typeof launched>>;

const rewrite = (file: string, over: Record<string, unknown>, drop: string[] = []) => {
  const body = { ...JSON.parse(fs.readFileSync(file, "utf8")), ...over };
  for (const k of drop) delete body[k];
  fs.writeFileSync(file, JSON.stringify(body));
};

/** A refusal: the verdict line, exit 1, no signal, lock bytes and run dir intact. */
async function expectRefused(q: Q, reason: string, args?: Record<string, unknown>) {
  const lock = q.lockBytes();
  const r = await q.quit(args);
  expect(last(q.out)).toBe(`${FAIL}${reason}`);
  expect(r.exit).toBe(1);
  expect(q.kill.calls).toEqual([]);
  expect(q.lockBytes()).toBe(lock);
  expect(fs.existsSync(q.fx.lay.runDir)).toBe(true);
}

describe("WI-7 quit#run refusals", () => {
  it.each([
    ["nonce", (q: Q) => rewrite(q.fx.lay.instanceJson, { nonce: "33".repeat(32) })],
    ["alive", (q: Q) => q.procs({ [PID]: () => owned({ alive: false }) })],
    ["startTime", (q: Q) => q.procs({ [PID]: () => owned({ lstart: "Thu Oct  8 14:44:45 2026" }) })],
    ["exe", (q: Q) => q.procs({ [PID]: () => owned({ exe: "/other" }) })],
  ])("QU-01 single fault %s: refused naming only it, no signal", async (check, fault) => {
    const q = await launched();
    fault(q);
    const before = q.outside();
    await expectRefused(q, `ownership: ${check}`);
    expect(q.outside()).toEqual(before);
    expect(q.text()).not.toContain(NONCE);
  });

  it("QU-02 pid reuse names both startTime and exe", async () => {
    const q = await launched();
    q.procs({ [PID]: () => owned({ lstart: REUSED_LSTART, exe: "/usr/bin/vim" }) });
    await expectRefused(q, "ownership: startTime, exe");
  });

  it("QU-07 owner.json deleted: pid, alive, startTime, exe", async () => {
    const q = await launched();
    fs.unlinkSync(q.fx.lay.ownerJson);
    await expectRefused(q, "ownership: pid, alive, startTime, exe");
  });

  it("QU-07 instance.json deleted: nonce, pid", async () => {
    const q = await launched();
    fs.unlinkSync(q.fx.lay.instanceJson);
    await expectRefused(q, "ownership: nonce, pid");
  });

  it.each([
    ["A instance pid 5151, owner pid 4242", (q: Q) => rewrite(q.fx.lay.instanceJson, { pid: OTHER })],
    [
      "B instance pid 4242, owner pid 5151",
      (q: Q) => {
        rewrite(q.fx.lay.ownerJson, { pid: OTHER, startTime: REUSED_LSTART, exeRealpath: "/usr/bin/vim" });
        q.procs({ [PID]: () => owned(), [OTHER]: () => owned({ lstart: REUSED_LSTART, exe: "/usr/bin/vim" }) });
      },
    ],
    ["C instance.json has no pid", (q: Q) => rewrite(q.fx.lay.instanceJson, {}, ["pid"])],
  ])("QU-08 row %s: ownership: pid, neither pid signalled", async (_row, fault) => {
    const q = await launched();
    q.procs({ [PID]: () => owned(), [OTHER]: () => owned() });
    fault(q);
    await expectRefused(q, "ownership: pid");
  });
});

describe("WI-7 quit#run signalling", () => {
  it.each([
    ["A dies at t0 + 100", 100],
    ["B dies at the last poll before escalation", GRACE - P],
  ])("QU-03 row %s: SIGTERM honoured, lock released, run dir kept", async (_row, deathAt) => {
    const q = await launched();
    q.procs({ [PID]: (t) => owned({ alive: t < deathAt }) });
    const before = q.outside();
    const check = envGuard();
    const r = await q.quit();
    expect(last(q.out)).toBe("verdict: pass");
    expect(q.out).toContain(`quit: run ${q.fx.name} terminated (SIGTERM)`);
    expect(r.exit).toBe(0);
    expect(q.kill.calls).toEqual([[PID, "SIGTERM"]]);
    expect(fs.existsSync(q.lockPath)).toBe(false);
    expect(fs.existsSync(q.fx.lay.runDir)).toBe(true);
    expect(fs.existsSync(q.fx.lay.ownerJson)).toBe(true);
    expect(q.outside()).toEqual(before);
    expect(q.text()).not.toContain(NONCE);
    check();
  });

  it("QU-04 SIGTERM ignored escalates to SIGKILL at t0 + grace", async () => {
    const q = await launched();
    q.procs({ [PID]: diesOn("SIGKILL") });
    const r = await q.quit();
    expect(last(q.out)).toBe("verdict: pass");
    expect(q.out).toContain(`quit: run ${q.fx.name} killed (SIGKILL)`);
    expect(r.exit).toBe(0);
    expect(q.kill.calls).toEqual([
      [PID, "SIGTERM"],
      [PID, "SIGKILL"],
    ]);
    expect(q.kill.times).toEqual([q.t0, q.t0 + GRACE]);
    expect(fs.existsSync(q.lockPath)).toBe(false);
    expect(fs.existsSync(q.fx.lay.runDir)).toBe(true);
    expect(q.text()).not.toContain(NONCE);
  });

  it.each([
    ["A alive forever", (): Liveness => true, "still alive after SIGKILL"],
    ["B liveness unknown after SIGTERM", (): Liveness => "unknown", "liveness unknown after SIGKILL"],
  ])("QU-05 row %s: the lock is kept", async (_row, after, reason) => {
    const q = await launched();
    q.procs({ [PID]: (_t, s) => owned({ alive: s.length === 0 ? true : after() }) });
    const lock = q.lockBytes();
    const r = await q.quit();
    expect(last(q.out)).toBe(`${DF}pid ${PID} ${reason}`);
    expect(r.exit).toBe(1);
    expect(q.kill.calls).toEqual([
      [PID, "SIGTERM"],
      [PID, "SIGKILL"],
    ]);
    expect(q.lockBytes()).toBe(lock);
    expect(fs.existsSync(q.fx.lay.runDir)).toBe(true);
  });

  it.each([
    ["A lstart changes at t0 + 100", (t: number) => owned({ lstart: t >= 100 ? REUSED_LSTART : LSTART }), "reused during grace"],
    ["B exe changes at the last poll", (t: number) => owned({ exe: t >= GRACE - P ? "/usr/bin/vim" : MAIN }), "reused during grace"],
    ["C lstart unknown at t0 + 100", (t: number) => owned({ lstart: t >= 100 ? "unknown" : LSTART }), "identity unknown during grace"],
  ])("QU-09 row %s: no SIGKILL, lock kept", async (_row, timeline, reason) => {
    const q = await launched();
    q.procs({ [PID]: timeline });
    const lock = q.lockBytes();
    const r = await q.quit();
    expect(last(q.out)).toBe(`${DF}pid ${PID} ${reason}`);
    expect(r.exit).toBe(1);
    expect(q.kill.calls).toEqual([[PID, "SIGTERM"]]);
    expect(q.lockBytes()).toBe(lock);
    expect(fs.existsSync(q.fx.lay.runDir)).toBe(true);
  });
});

describe("WI-7 quit#run run selection (QU-06)", () => {
  it("(a) no run named: quits the run the lock names", async () => {
    const q = await launched();
    q.procs({ [PID]: diesOn("SIGTERM") });
    const r = await q.quit({});
    expect(last(q.out)).toBe("verdict: pass");
    expect(q.out).toContain(`quit: run ${q.fx.name} terminated (SIGTERM)`);
    expect(r.exit).toBe(0);
    expect(fs.existsSync(q.lockPath)).toBe(false);
  });

  it("(b) no run named and no lock: refusal, exit 1", async () => {
    const q = await launched();
    fs.unlinkSync(q.lockPath);
    const r = await q.quit({});
    expect(last(q.out)).toBe(`${FAIL}no run named and no lock`);
    expect(r.exit).toBe(1);
    expect(q.kill.calls).toEqual([]);
    expect(fs.existsSync(q.fx.lay.runDir)).toBe(true);
  });

  it("(c) quitting R2 while the lock names R leaves the lock untouched", async () => {
    const q = await launched();
    const r2: string = runName(Buffer.alloc(16, 0x33));
    const dir = path.join(q.fx.parent, r2);
    const n2 = "44".repeat(32);
    fs.mkdirSync(dir, { mode: 0o700 });
    fs.writeFileSync(path.join(dir, "launch.json"), JSON.stringify({ nonce: n2, buildId: "b1", mainBinary: MAIN }));
    fs.writeFileSync(path.join(dir, "instance.json"), JSON.stringify({ nonce: n2, pid: OTHER, buildId: "b1" }));
    fs.writeFileSync(path.join(dir, "owner.json"), JSON.stringify({ pid: OTHER, startTime: LSTART, exeRealpath: MAIN }));
    q.procs({ [PID]: () => owned(), [OTHER]: diesOn("SIGTERM") });
    const lock = q.lockBytes();
    const r = await q.quit({ run: r2 });
    expect(last(q.out)).toBe("verdict: pass");
    expect(q.out).toContain(`quit: run ${r2} terminated (SIGTERM)`);
    expect(r.exit).toBe(0);
    expect(q.kill.calls).toEqual([[OTHER, "SIGTERM"]]);
    expect(q.lockBytes()).toBe(lock);
    expect(JSON.parse(lock).run).toBe(q.fx.name);
    expect(fs.existsSync(dir)).toBe(true);
    expect(q.out.join("\n")).not.toContain(n2);
  });

  it("(d) an invalid run name refuses", async () => {
    const q = await launched();
    const r = await q.quit({ run: "BAD" });
    expect(last(q.out)).toBe(`${FAIL}invalid run name`);
    expect(r.exit).toBe(1);
    expect(q.kill.calls).toEqual([]);
  });
});

describe("WI-7 quit#run law (property)", () => {
  it("signals only the owner pid, as a prefix of [SIGTERM, SIGKILL]; lock gone iff confirmed dead (seed 2026100807)", async () => {
    const rnd = mulberry32(2026100807);
    for (let i = 0; i < 24; i += 1) {
      const q = await launched();
      const honours = int(rnd, 0, 2); // 0 ignores both, 1 dies on SIGTERM, 2 dies on SIGKILL only
      const deathAt = int(rnd, 0, GRACE + 2 * P);
      const swapAt = rnd() < 0.3 ? int(rnd, 0, GRACE) : Infinity;
      q.procs({
        [PID]: (t, s) => {
          const dead = (honours === 1 && s.includes("SIGTERM") && t >= deathAt) || (honours === 2 && s.includes("SIGKILL"));
          return owned({ alive: !dead, lstart: t >= swapAt ? REUSED_LSTART : LSTART });
        },
      });
      const r = await q.quit();
      const sigs = q.kill.calls.map((c) => c[1]);
      expect(q.kill.calls.every((c) => c[0] === PID)).toBe(true);
      expect(["SIGTERM", "SIGKILL"].slice(0, sigs.length)).toEqual(sigs);
      expect(fs.existsSync(q.fx.lay.runDir)).toBe(true);
      expect(fs.existsSync(q.lockPath)).toBe(r.exit !== 0);
      expect(last(q.out)).toEqual(r.exit === 0 ? "verdict: pass" : expect.stringMatching(/^verdict: driver failure — /));
    }
  });
});

describe("WI-R1 QU-R1 the outside() snapshot", () => {
  it("catches a file created and deleted in a directory outside R other than the runs parent", async () => {
    const q = await launched();
    const dir = path.dirname(q.fx.parent);
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(dir, past, past);
    const before = q.outside();
    const f = path.join(dir, "transient");
    fs.writeFileSync(f, "x");
    fs.unlinkSync(f);
    expect(q.outside()).not.toEqual(before);
  });
});
