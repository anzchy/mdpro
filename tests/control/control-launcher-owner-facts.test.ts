// @vitest-environment node
/**
 * ADR-0047 WI-003 review fix WI-R2: one shared owner-facts gatherer for
 * `quit`, `launch --into` and `doctor`, with the same pid guard everywhere:
 * a pid that is not a positive safe integer is never handed to the process
 * fact boundary, so every fact for it is `unknown` and nothing is spawned or
 * signalled.
 * Matrix: `.claude/tdd-guardian/tests-20261008-144444.md`, "Round 4 changes
 * (review fixes, WI-R2)", OF-R1..OF-R3.
 *
 * The run is a real LA-01 launch on the shared fixture
 * (`tests/support/launchHarness.ts`); its `owner.json` / `instance.json` pid
 * is then rewritten. The procFacts table lists the bad pid's key as a live
 * process with the recorded start time and exe, so only the guard can stop
 * the facts from looking good.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  fileState,
  last,
  launchFixture,
  LSTART,
  MAIN,
  NONCE,
  publish,
  treeSnapshot,
  type Fixture,
} from "../support/launchHarness";
import { fakeProcFacts, fakeSpawn, makeHome, type ProcFacts } from "../support/launcherFakes";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run as launch } from "../../scripts/control/launch.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run as quit } from "../../scripts/control/quit.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run as doctor } from "../../scripts/control/doctor.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { acquireLock } from "../../scripts/control/lock.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { layout, runsParent } from "../../scripts/control/runDir.mjs";

type Result = { exit: number; lines: string[] };

const BAD_PIDS: unknown[] = [0, -1, 1.5, "4242", 2 ** 53];
const ALL_UNKNOWN = "verdict: fail — ownership: pid, alive, startTime, exe";

let cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

/** procFacts that records every pid it is asked about, answering from `inner`. */
function asking(inner: ProcFacts) {
  const asked: unknown[] = [];
  const pf: ProcFacts = {
    ...inner,
    alive: (pid) => (asked.push(pid), inner.alive(pid)),
    lstart: (pid) => (asked.push(pid), inner.lstart(pid)),
    exe: (pid) => (asked.push(pid), inner.exe(pid)),
  };
  return { pf, asked };
}

/** The bad pid's table key reads as a live process with the recorded identity. */
const liveTable = (bad: unknown) =>
  fakeProcFacts({ pids: { [String(bad)]: { alive: true, lstart: LSTART, exe: MAIN } } as Record<number, never> });

/** A live run from a real launch, then its owner and instance pid rewritten to `bad`. */
async function runWithPid(bad: unknown): Promise<Fixture> {
  const fx = launchFixture();
  cleanups.push(fx.cleanup);
  const first: Result = await launch({ file: "/tmp/f.md" }, fx.deps);
  expect(first.exit).toBe(0);
  fx.out.length = 0;
  fs.writeFileSync(fx.lay.ownerJson, JSON.stringify({ pid: bad, startTime: LSTART, exeRealpath: MAIN }));
  fs.unlinkSync(fx.lay.instanceJson);
  publish(fx.lay.runDir, { nonce: NONCE, pid: bad, buildId: "b1" });
  return fx;
}

describe("WI-R2 ownerFacts: the pid guard on every path", () => {
  it.each(BAD_PIDS.map((pid) => ({ pid })))("OF-R1 launch --into with owner pid $pid: all facts unknown, no spawn", async ({ pid }) => {
    const fx = await runWithPid(pid);
    const { pf, asked } = asking(liveTable(pid));
    fx.deps.procFacts = pf;
    const second = fakeSpawn((_c, child) => child.exitSoon(0), [6000]);
    fx.deps.spawn = second;
    const tree = treeSnapshot(fx.lay.runDir);
    const lock = fileState(path.join(fx.parent, ".lock"));
    const r: Result = await launch({ into: fx.name, file: "/tmp/g.md" }, fx.deps);
    expect(last(fx.out)).toBe(ALL_UNKNOWN);
    expect(r.exit).toBe(1);
    expect(second.calls).toHaveLength(0);
    expect(fx.kill.calls).toEqual([]);
    expect(asked).toEqual([]);
    expect(treeSnapshot(fx.lay.runDir)).toEqual(tree);
    expect(fileState(path.join(fx.parent, ".lock"))).toEqual(lock);
  });

  it.each(BAD_PIDS.map((pid) => ({ pid })))("OF-R2 quit with owner pid $pid: all facts unknown, nothing signalled", async ({ pid }) => {
    const fx = await runWithPid(pid);
    const { pf, asked } = asking(liveTable(pid));
    fx.deps.procFacts = pf;
    const lock = fs.readFileSync(path.join(fx.parent, ".lock"), "utf8");
    const r: Result = await quit({ run: fx.name }, fx.deps);
    expect(last(fx.out)).toBe(ALL_UNKNOWN);
    expect(r.exit).toBe(1);
    expect(fx.kill.calls).toEqual([]);
    expect(asked).toEqual([]);
    expect(fs.readFileSync(path.join(fx.parent, ".lock"), "utf8")).toBe(lock);
  });

  const R = "r".repeat(25);
  const ROWS: { row: string; owner: unknown; inst: unknown; table: Parameters<typeof fakeProcFacts>[0]; line: string }[] = [
    {
      row: "owner.json missing, instance pid dead",
      owner: null,
      inst: { pid: 5151, nonce: NONCE },
      table: { pids: { 5151: { alive: false } } },
      line: `[FAIL] no run lock: stale lock names run ${R}`,
    },
    {
      row: "owner pid 0",
      owner: { pid: 0, startTime: LSTART, exeRealpath: MAIN },
      inst: { pid: 0, nonce: NONCE },
      table: { pids: { 0: { alive: true, lstart: LSTART, exe: MAIN } } },
      line: `[FAIL] no run lock: stale lock names run ${R}`,
    },
    {
      row: "liveness unknown",
      owner: { pid: 5151, startTime: LSTART, exeRealpath: MAIN },
      inst: { pid: 5151, nonce: NONCE },
      table: { pids: { 5151: { alive: "unknown" } } },
      line: `[FAIL] no run lock: lock held by run ${R} (liveness unknown)`,
    },
    {
      row: "alive but start time differs",
      owner: { pid: 5151, startTime: LSTART, exeRealpath: MAIN },
      inst: { pid: 5151, nonce: NONCE },
      table: { pids: { 5151: { alive: true, lstart: "Fri Oct  9 01:00:00 2026", exe: MAIN } } },
      line: `[FAIL] no run lock: lock held by run ${R} (liveness unknown)`,
    },
  ];
  it.each(ROWS)("OF-R3 doctor lock liveness: $row", async ({ owner, inst, table, line }) => {
    const h = makeHome();
    cleanups.push(h.cleanup);
    const parent: string = runsParent(h.real);
    const lay: Record<string, string> = layout(parent, R);
    fs.mkdirSync(lay.runDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(lay.launchJson, JSON.stringify({ nonce: NONCE, buildId: "b1", mainBinary: MAIN }));
    fs.writeFileSync(lay.instanceJson, JSON.stringify({ ...(inst as object), buildId: "b1" }));
    if (owner !== null) fs.writeFileSync(lay.ownerJson, JSON.stringify(owner));
    acquireLock(parent, { run: R, nonce: NONCE });
    const lines: string[] = [];
    const r: Result = await doctor([], {
      repoRoot: h.real,
      passwdHome: h.home,
      siSockPath: path.join(h.real, "si.sock"),
      procFacts: fakeProcFacts(table),
      out: (l: string) => lines.push(l),
    });
    expect(lines.filter((l) => l.startsWith("[FAIL] no run lock"))).toEqual([line]);
    expect(r.exit).toBe(1);
  });
});
