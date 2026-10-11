// @vitest-environment node
/**
 * D105-WI-4 (fixes D105 ② and the cleanSocket no-lock limit): after the
 * `stale` re-probe, `clean` re-checks the lock inside `.lock.mutex` and
 * unlinks `si.sock` only when the lock is absent or names the run being
 * cleaned. Otherwise the socket is kept with
 * `[info] si.sock kept: lock held by run <X>` | `… lock unreadable`.
 *
 * Real fs, real lock, real sockets (a pre-bound listener renamed onto
 * `si.sock` stays live, CS-0); the competitors run from inside clean's second
 * probe call, which is the window between the re-probe and the unlink.
 * Plan and matrix: `.claude/tdd-guardian/plan-d105-20261011-144108.md`,
 * D105-WI-4, SG-1..SG-4, SG-6 (SG-5 is in
 * `control-launcher-clean-sisock-lockcheck-law.test.ts`).
 * Post-plan addition: SG-7 (a busy mutex at the re-check keeps the socket).
 */
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { siSock } from "../scripts/control/cleanSocket.mjs";
import {
  acquireLock,
  DF,
  disposeAll,
  makeStaleSocket,
  N2,
  NAME,
  OTHER,
  orphanFixture,
  preBound,
  type Probe,
  probeSocket,
  RELEASED,
  runFixture,
  secondCleaner,
  SOCK_REMOVED,
  tombsIn,
} from "./support/cleanSockFixtures";
import { recordBytes } from "./support/lockSchedules";

const children: ChildProcess[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const c of children.splice(0)) if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
  await disposeAll();
});

const mutexFiles = (p: string) => fs.readdirSync(p).filter((n) => n.startsWith(".lock.mutex"));
const lockBytes = (p: string) => (fs.existsSync(path.join(p, ".lock")) ? fs.readFileSync(path.join(p, ".lock"), "utf8") : null);

/** A probe: call 1 answers `stale`; call 2 runs `window()` (the race), then answers `stale`. */
function racingProbe(window: () => Promise<void> | void) {
  let calls = 0;
  return async (): Promise<Probe> => {
    calls += 1;
    if (calls === 2) await window();
    return "stale";
  };
}

describe("D105-WI-4 a launch that takes the lock during the re-probe keeps its si.sock", () => {
  it("SG-1 (②) A cleans R; meanwhile B orphan-cleans R and C launches and binds: A keeps C's live socket and fails loudly", async () => {
    let fx: ReturnType<typeof runFixture> | null = null;
    let pre = "";
    let bOut: string[] = [];
    const probe = racingProbe(async () => {
      const f = fx as ReturnType<typeof runFixture>;
      const b = secondCleaner(f, { probe: async (): Promise<Probe> => "absent", scan: [] });
      await b.clean();
      bOut = b.out;
      acquireLock(f.parent, { run: OTHER, nonce: N2 });
      fs.renameSync(pre, f.siSock);
    });
    fx = runFixture({ probe });
    await makeStaleSocket(fx.siSock);
    pre = await preBound(fx.dir);
    const r = await fx.clean();
    expect(bOut).toEqual([RELEASED, "verdict: pass"]);
    expect({ exit: r.exit, out: fx.out }).toEqual({
      exit: 1,
      out: [`[info] si.sock kept: lock held by run ${OTHER}`, `${DF}removed ${NAME}, lock not released: lock names run ${OTHER}, not ${NAME}`],
    });
    expect(await probeSocket(fx.siSock)).toBe("live");
    expect(lockBytes(fx.parent)).toBe(recordBytes(OTHER, N2));
    expect(tombsIn(fx.parent)).toEqual([]);
    expect(mutexFiles(fx.parent)).toEqual([]);
  });

  it("SG-2 (no-lock limit) absent R, no lock: a launch during the re-probe keeps its live socket, clean passes", async () => {
    let fx: ReturnType<typeof orphanFixture> | null = null;
    let pre = "";
    const probe = racingProbe(() => {
      const f = fx as ReturnType<typeof orphanFixture>;
      acquireLock(f.parent, { run: OTHER, nonce: N2 });
      fs.renameSync(pre, f.siSock);
    });
    fx = orphanFixture({ lock: "none", probe });
    await makeStaleSocket(fx.siSock);
    pre = await preBound(fx.dir);
    const r = await fx.clean();
    expect({ exit: r.exit, out: fx.out }).toEqual({
      exit: 0,
      out: [`clean: absent ${NAME}`, `[info] si.sock kept: lock held by run ${OTHER}`, "verdict: pass"],
    });
    expect(await probeSocket(fx.siSock)).toBe("live");
    expect(lockBytes(fx.parent)).toBe(recordBytes(OTHER, N2));
    expect(mutexFiles(fx.parent)).toEqual([]);
  });
});

describe("D105-WI-4 the lock re-check, its other outcomes", () => {
  it("SG-3 B releases R's lock during the re-probe and nobody takes it: the stale socket is removed, A passes", async () => {
    let fx: ReturnType<typeof runFixture> | null = null;
    let bOut: string[] = [];
    const probe = racingProbe(async () => {
      const b = secondCleaner(fx as ReturnType<typeof runFixture>, { probe: async (): Promise<Probe> => "absent", scan: [] });
      await b.clean();
      bOut = b.out;
    });
    fx = runFixture({ probe });
    await makeStaleSocket(fx.siSock);
    const r = await fx.clean();
    expect(bOut).toEqual([RELEASED, "verdict: pass"]);
    expect({ exit: r.exit, out: fx.out }).toEqual({ exit: 0, out: [`clean: removed ${NAME}`, SOCK_REMOVED, "verdict: pass"] });
    expect(await probeSocket(fx.siSock)).toBe("absent");
    expect(lockBytes(fx.parent)).toBeNull();
    expect(mutexFiles(fx.parent)).toEqual([]);
  });

  it("SG-4 the lock turns unreadable during the re-probe: the socket is kept, the release fails as unreadable", async () => {
    let fx: ReturnType<typeof runFixture> | null = null;
    const probe = racingProbe(() => fs.writeFileSync((fx as ReturnType<typeof runFixture>).lockPath, "{"));
    fx = runFixture({ probe });
    await makeStaleSocket(fx.siSock);
    const r = await fx.clean();
    expect({ exit: r.exit, out: fx.out }).toEqual({
      exit: 1,
      out: ["[info] si.sock kept: lock unreadable", `${DF}removed ${NAME}, lock not released: lock unreadable`],
    });
    expect(fs.lstatSync(fx.siSock).isSocket()).toBe(true);
    expect(lockBytes(fx.parent)).toBe("{");
  });

  it("SG-6 the unlink happens while .lock.mutex names this process", async () => {
    const fx = runFixture({ probe: async (): Promise<Probe> => "stale" });
    await makeStaleSocket(fx.siSock);
    const realUnlink = fs.unlinkSync;
    const atUnlink: unknown[] = [];
    vi.spyOn(fs, "unlinkSync").mockImplementation(((p: fs.PathLike) => {
      if (p === fx.siSock) {
        try {
          atUnlink.push(JSON.parse(fs.readFileSync(path.join(fx.parent, ".lock.mutex"), "utf8")).pid);
        } catch (e) {
          atUnlink.push(e instanceof Error ? e.message.split(":")[0] : String(e));
        }
      }
      realUnlink(p);
    }) as typeof fs.unlinkSync);
    const r = await fx.clean();
    vi.restoreAllMocks();
    expect(atUnlink).toEqual([process.pid]);
    expect(fx.out).toEqual([`clean: removed ${NAME}`, SOCK_REMOVED, "verdict: pass"]);
    expect(r.exit).toBe(0);
  });

  it("SG-7 a busy mutex at the re-check keeps the socket and names the holder", async () => {
    const fx = runFixture();
    await makeStaleSocket(fx.siSock);
    const c = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
    children.push(c);
    fs.writeFileSync(path.join(fx.parent, ".lock.mutex"), JSON.stringify({ pid: c.pid, token: "0123456789abcdef" }), { mode: 0o600 });
    const d = { siSockPath: fx.siSock, procFacts: { probe: async () => "stale" }, lockMutexWaitMs: 50 };
    const line = await siSock(d, "stale", [], { parent: fx.parent, run: NAME });
    expect(line).toBe(`[info] si.sock kept: lock busy: mutex held by pid ${c.pid}`);
    expect(fs.lstatSync(fx.siSock).isSocket()).toBe(true);
  });
});
