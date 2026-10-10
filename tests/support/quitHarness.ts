/**
 * The `quit` fixture for the D82-WI-5 lock-release tests: a run R built by a
 * real LA-01 `launch` under a `makeHome()` home, plus quit's own deps. The
 * same shape as `launched()` in `tests/control-launcher-quit.test.ts` (kept
 * there unedited, since that file's assertions are recorded); `deps.kill` and
 * `deps.procFacts` are the only fakes, the lock and the fs are real.
 *
 * Matrix: `.claude/tdd-guardian/tests-20261010-103136.md`, D82-WI-5.
 */
import fs from "node:fs";
import path from "node:path";
import { expect } from "vitest";
import { launchFixture, LSTART, MAIN, walk, type Fixture } from "./launchHarness";
import { scriptedProcFacts, timedKill } from "./launcherFakes";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run as launchRun } from "../../scripts/control/launch.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run as quitRun } from "../../scripts/control/quit.mjs";

export const PID = 4242;
export type Result = { exit: number; lines: string[] };
export type Liveness = boolean | "unknown";
export type Facts = { alive: Liveness; lstart?: string; exe?: string };
/** Facts for a pid at `elapsed` ms after quit started, given the signals it has received. */
export type Timeline = (elapsed: number, signals: string[]) => Facts;

export const owned = (over: Partial<Facts> = {}): Facts => ({ alive: true, lstart: LSTART, exe: MAIN, ...over });

/** Alive until `sig` arrives, dead on the next poll after it. */
export const diesOn =
  (sig: string): Timeline =>
  (_t, s) =>
    owned({ alive: !s.includes(sig) });

/** `timeline`, but `mutate()` runs once, the first time it reports death (the release point). */
export function atDeath(timeline: Timeline, mutate: () => void): Timeline {
  let done = false;
  return (t, s) => {
    const f = timeline(t, s);
    if (f.alive === false && !done) {
      done = true;
      mutate();
    }
    return f;
  };
}

const fixtures: Fixture[] = [];
export function cleanupQuitFixtures(): void {
  for (const fx of fixtures.splice(0)) fx.cleanup();
}

/** A launched run R plus quit's own deps. */
export async function launched() {
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
    lockPath,
    procs: (t: Record<number, Timeline>) => {
      table = t;
    },
    quit: (args: Record<string, unknown> = { run: fx.name }): Promise<Result> => quitRun(args, deps),
    /** `.lock`'s bytes, or null when it is absent. */
    lockState: (): string | null => (fs.existsSync(lockPath) ? fs.readFileSync(lockPath, "utf8") : null),
    /** Every `.tomb` entry in the runs parent. */
    tombs: () => fs.readdirSync(fx.parent).filter((n) => n.endsWith(".tomb")).sort(),
    /** Every entry under the real home outside R and the lock (a tomb shows up here). */
    outside: () => walk(fx.real).filter((rel) => !rel.includes(fx.name) && path.basename(rel) !== ".lock"),
    /** Quit's stdout/stderr plus R's `launcher.jsonl`: text that must carry no secret. */
    text: () => {
      const log = fx.lay.launcherLog;
      return [...out, fs.existsSync(log) ? fs.readFileSync(log, "utf8") : ""].join("\n");
    },
  };
}
export type Q = Awaited<ReturnType<typeof launched>>;
