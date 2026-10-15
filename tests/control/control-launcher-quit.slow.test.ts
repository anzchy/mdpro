// @vitest-environment node
/**
 * ADR-0047 WI-003 WI-7: QU-INT — the real `quit` driver against throwaway
 * `node` children (matrix `.claude/tdd-guardian/tests-20261008-144444.md`,
 * QU-INT and QU-INT-2). Real `ps` / `lsof` (`defaultProcFacts`), real
 * `process.kill`, real clock, real lock, real fs under a `makeHome()` home.
 * Slow lane (ADR-0050): real `lsof` calls and a real grace period.
 *
 * Only children spawned here are ever signalled by the test; every one still
 * running is SIGKILLed in `afterEach`.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { envGuard, last } from "../support/launchHarness";
import { makeHome } from "../support/launcherFakes";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run as quitRun } from "../../scripts/control/quit.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { readExe, readStartTime } from "../../scripts/control/procFacts.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { acquireLock } from "../../scripts/control/lock.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { layout, runName, runsParent } from "../../scripts/control/runDir.mjs";

const IDLE = `setInterval(() => {}, 1e3); process.stdout.write("ready");`;
const STUBBORN = `process.on("SIGTERM", () => {}); ${IDLE}`;
const NONCE = "55".repeat(32);

let children: ChildProcess[] = [];
let cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
  for (const c of cleanups) c();
  children = [];
  cleanups = [];
});

/** A throwaway node child, resolved once its script is running. */
function child(src = IDLE): Promise<number> {
  const c = spawn(process.execPath, ["-e", src], { stdio: ["ignore", "pipe", "ignore"] });
  children.push(c);
  return new Promise((resolve, reject) => {
    c.once("error", reject);
    c.stdout?.once("data", () => resolve(c.pid as number));
  });
}

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw e;
  }
};

/** A hand-written run R: launch.json, instance.json, owner.json, and the lock naming R. */
async function realRun(o: { instancePid: number; ownerPid: number; startTime?: string }) {
  const h = makeHome();
  cleanups.push(h.cleanup);
  const parent: string = runsParent(h.real);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const name: string = runName(Buffer.alloc(16, 0x55));
  const lay: Record<string, string> = layout(parent, name);
  fs.mkdirSync(lay.runDir, { mode: 0o700 });
  fs.writeFileSync(lay.launchJson, JSON.stringify({ nonce: NONCE, buildId: "b1", mainBinary: process.execPath }));
  fs.writeFileSync(lay.instanceJson, JSON.stringify({ nonce: NONCE, pid: o.instancePid, buildId: "b1" }));
  const owner = {
    pid: o.ownerPid,
    startTime: o.startTime ?? (await readStartTime(o.ownerPid)),
    exeRealpath: await readExe(o.ownerPid),
  };
  fs.writeFileSync(lay.ownerJson, JSON.stringify(owner));
  acquireLock(parent, { run: name, nonce: NONCE });
  const out: string[] = [];
  const lockPath = path.join(parent, ".lock");
  const quit = (deps: Record<string, unknown> = {}): Promise<{ exit: number }> =>
    quitRun({ run: name }, { passwdHome: h.home, out: (l: string) => out.push(l), err: (l: string) => out.push(l), ...deps });
  return { name, lay, out, lockPath, owner, quit };
}

describe("WI-7 QU-INT real quit against node children", () => {
  it("Row A: a real child is terminated by SIGTERM; lock released, run dir kept", async () => {
    const pid = await child();
    const r = await realRun({ instancePid: pid, ownerPid: pid });
    expect(r.owner.startTime).not.toBe("unknown");
    expect(r.owner.exeRealpath).toBe(fs.realpathSync(process.execPath));
    const check = envGuard();
    const res = await r.quit();
    expect(last(r.out)).toBe("verdict: pass");
    expect(r.out).toContain(`quit: run ${r.name} terminated (SIGTERM)`);
    expect(res.exit).toBe(0);
    expect(isAlive(pid)).toBe(false);
    expect(fs.existsSync(r.lockPath)).toBe(false);
    expect(fs.existsSync(r.lay.runDir)).toBe(true);
    expect(r.out.join("\n")).not.toContain(NONCE);
    const log = fs.existsSync(r.lay.launcherLog) ? fs.readFileSync(r.lay.launcherLog, "utf8") : "";
    expect(log).not.toContain(NONCE);
    check();
  });

  it("Row B: a forged start time refuses; the child survives", async () => {
    const pid = await child();
    const r = await realRun({ instancePid: pid, ownerPid: pid, startTime: "Thu Jan  1 00:00:00 2026" });
    const lock = fs.readFileSync(r.lockPath, "utf8");
    const res = await r.quit();
    expect(last(r.out)).toBe("verdict: fail — ownership: startTime");
    expect(res.exit).toBe(1);
    expect(isAlive(pid)).toBe(true);
    expect(fs.readFileSync(r.lockPath, "utf8")).toBe(lock);
  });

  it("Row C: owner records P1, instance names P2: refused on pid, both survive", async () => {
    const p1 = await child();
    const p2 = await child();
    const r = await realRun({ instancePid: p2, ownerPid: p1 });
    const lock = fs.readFileSync(r.lockPath, "utf8");
    const res = await r.quit();
    expect(last(r.out)).toBe("verdict: fail — ownership: pid");
    expect(res.exit).toBe(1);
    expect(isAlive(p1)).toBe(true);
    expect(isAlive(p2)).toBe(true);
    expect(fs.readFileSync(r.lockPath, "utf8")).toBe(lock);
  });

  it("QU-INT-2: a child that ignores SIGTERM is killed after a 300 ms grace", async () => {
    const pid = await child(STUBBORN);
    const r = await realRun({ instancePid: pid, ownerPid: pid });
    const res = await r.quit({ graceMs: 300 });
    expect(last(r.out)).toBe("verdict: pass");
    expect(r.out).toContain(`quit: run ${r.name} killed (SIGKILL)`);
    expect(res.exit).toBe(0);
    expect(isAlive(pid)).toBe(false);
    expect(fs.existsSync(r.lockPath)).toBe(false);
    expect(fs.existsSync(r.lay.runDir)).toBe(true);
  });
});
