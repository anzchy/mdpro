// @vitest-environment node
/**
 * D148-WI-4: `clean`'s si.sock lock re-check reads R's run dir as absent only
 * when `lstat` says ENOENT. Any other error (EIO, EACCES) means the run dir may
 * be there — a launch in flight — so the socket is kept and the kept line says
 * why. `releaseOrphanLock` already reads it that way.
 *
 * Real fs, real lock, real mutex, real sockets. Only `fs.lstatSync` of R's run
 * dir is made to fail, from the re-probe on (the window right before the lock
 * re-check), at the fs boundary.
 * Matrix: audit b67 of D148, D148-WI-4, SL-1..SL-2.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DF,
  disposeAll,
  isSocket,
  makeStaleSocket,
  NAME,
  ORPHAN_NONCE,
  orphanFixture,
  type Probe,
  RELEASED,
  SOCK_REMOVED,
  tombsIn,
} from "../support/cleanSockFixtures";
import { recordBytes } from "../support/lockSchedules";

afterEach(async () => {
  vi.restoreAllMocks();
  await disposeAll();
});

const realLstat = fs.lstatSync;
const lockBytes = (p: string) => (fs.existsSync(path.join(p, ".lock")) ? fs.readFileSync(path.join(p, ".lock"), "utf8") : null);
const own = (p: string) => fs.readdirSync(p).filter((n) => n.startsWith(".lock.mutex") || n.startsWith(".clean."));

/** An orphan clean of R (scan [], probe stale) whose `lstat` of R's run dir fails with `code` from the re-probe on. */
async function cleanWithRunDirLstat(code: string) {
  let fx: ReturnType<typeof orphanFixture> | null = null;
  let armed = false;
  let calls = 0;
  const probe = async (): Promise<Probe> => {
    calls += 1;
    if (calls === 2) armed = true;
    return "stale";
  };
  fx = orphanFixture({ probe });
  const runDir = path.join(fx.parent, NAME);
  vi.spyOn(fs, "lstatSync").mockImplementation(((p: fs.PathLike, o?: fs.StatSyncOptions) => {
    if (armed && p === runDir) {
      throw Object.assign(new Error(`${code}: simulated, lstat '${runDir}'`), { code, syscall: "lstat", path: runDir });
    }
    return realLstat(p, o);
  }) as typeof fs.lstatSync);
  await makeStaleSocket(fx.siSock);
  const r = await fx.clean();
  vi.restoreAllMocks();
  return { fx, r, armed };
}

describe("D148-WI-4 the si.sock re-check reads R's run dir as absent only on ENOENT", () => {
  it.each(["EIO", "EACCES"])("SL-1 lstat of R's run dir fails with %s: si.sock kept, the kept line names the error, the lock stays", async (code) => {
    const { fx, r, armed } = await cleanWithRunDirLstat(code);
    expect(armed).toBe(true);
    expect({ exit: r.exit, out: fx.out }).toEqual({
      exit: 1,
      out: [`[info] si.sock kept: run dir lstat failed: ${code}`, `${DF}lock not released: run ${NAME} is launching: run dir appeared`],
    });
    expect(isSocket(fx.siSock)).toBe(true);
    expect(lockBytes(fx.parent)).toBe(recordBytes(NAME, ORPHAN_NONCE));
    expect({ own: own(fx.parent), tombs: tombsIn(fx.parent) }).toEqual({ own: [], tombs: [] });
  });

  it("SL-2 lstat of R's run dir says ENOENT: the stale si.sock is unlinked and the orphan lock released, as before", async () => {
    const { fx, r, armed } = await cleanWithRunDirLstat("ENOENT");
    expect(armed).toBe(true);
    expect({ exit: r.exit, out: fx.out }).toEqual({ exit: 0, out: [RELEASED, SOCK_REMOVED, "verdict: pass"] });
    expect(fs.existsSync(fx.siSock)).toBe(false);
    expect(lockBytes(fx.parent)).toBe(null);
    expect({ own: own(fx.parent), tombs: tombsIn(fx.parent) }).toEqual({ own: [], tombs: [] });
  });
});
