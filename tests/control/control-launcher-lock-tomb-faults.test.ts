// @vitest-environment node
/**
 * D82-WI-9: the tomb protocol's error paths in `scripts/control/lock.mjs`
 * `releaseAtomically` never lose the primary outcome.
 *
 * - S-1: a restore `linkSync` that fails with anything (not only EEXIST)
 *   throws `lock displaced: kept <tomb>`; a non-EEXIST failure appends its
 *   code, e.g. ` (EPERM)`. The other run's record stays in the named tomb.
 * - S-2: a failing tomb `unlinkSync` is best-effort. On the success path the
 *   release returns `released; tomb kept: <tomb>` (D105-WI-3; it was a silent
 *   "released"), and that tomb refuses the next acquire; on the restore path
 *   the mismatch is still thrown, with `; tomb kept: <tomb>` appended, and
 *   quit's verdict is unchanged.
 *
 * Schedule: `.lock` is A's at the pre-check; just before the
 * `renameSync(.lock)` it is swapped to B's, so the tomb check refuses and the
 * restore runs. Faults are pass-through `node:fs` spies; every other fs call
 * is real (tmp dir).
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { acquireLock, readLock, releaseLock, releaseOrphanLock } from "../../scripts/control/lock.mjs";
import { A, B, C, N1, N2, N3, cleanupParents, freshParent, lockFile, outcome, recordBytes, tombsIn } from "../support/lockSchedules";
import { atDeath, cleanupQuitFixtures, diesOn, launched, PID } from "../support/quitHarness";

afterEach(() => {
  vi.restoreAllMocks();
  cleanupParents();
  cleanupQuitFixtures();
});

const TOMB_RE = /^\.lock\.\d+-[0-9a-f]{16}\.tomb$/;
const FNS = [
  { fn: "releaseLock", call: (parent: string) => releaseLock(parent, { run: A, nonce: N1 }) },
  { fn: "releaseOrphanLock", call: (parent: string) => releaseOrphanLock(parent, A) },
] as const;

const fault = (code: string, op: string) => Object.assign(new Error(`${code}: injected fault, ${op}`), { code });
const isTomb = (p: unknown) => typeof p === "string" && p.endsWith(".tomb");

/** Swap `lock` to B's record just before its first `renameSync`, so the restore path runs. */
function swapBeforeRename(lock: string): void {
  const realRename = fs.renameSync;
  let swaps = 0;
  vi.spyOn(fs, "renameSync").mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
    if (from === lock && swaps++ === 0) fs.writeFileSync(lock, recordBytes(B, N2));
    return realRename(from, to);
  }) as never);
}

/** Every `unlinkSync` of a tomb throws `code`; any other unlink is real. */
function failTombUnlink(code: string): void {
  const realUnlink = fs.unlinkSync;
  vi.spyOn(fs, "unlinkSync").mockImplementation(((p: fs.PathLike) => {
    if (isTomb(p)) throw fault(code, "unlink");
    return realUnlink(p);
  }) as never);
}

/** A's lock, swapped to B's at the rename, released by `call` with no fault: the control message. */
function controlMismatch(call: (parent: string) => string): string | { error: string } {
  const parent = freshParent();
  acquireLock(parent, { run: A, nonce: N1 });
  swapBeforeRename(lockFile(parent));
  const r = outcome(() => call(parent));
  vi.restoreAllMocks();
  return r;
}

describe("D82-WI-9 S-1: a non-EEXIST restore failure names the tomb", () => {
  const CASES = FNS.flatMap((f) => ["EPERM", "EIO"].map((code) => ({ ...f, code })));
  it.each(CASES)("$fn, link $code: throws `lock displaced: kept <tomb> ($code)`, B stays in the tomb, .lock absent", ({ call, code }) => {
    const parent = freshParent();
    acquireLock(parent, { run: A, nonce: N1 });
    const lock = lockFile(parent);
    swapBeforeRename(lock);
    const realLink = fs.linkSync;
    let faulted = false;
    // rule 12: D170-WI-1 creates `.lock.mutex` by a link too, before the restore, so the one fault is aimed at the
    // first link onto `.lock` (the restore) and every other link is real (was `mockImplementationOnce` on any link).
    vi.spyOn(fs, "linkSync").mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      if (to !== lock || faulted) return realLink(from, to);
      faulted = true;
      throw fault(code, "link");
    }) as never);

    const r = outcome(() => call(parent));
    vi.restoreAllMocks();

    const tombs = tombsIn(parent);
    expect(tombs).toHaveLength(1);
    expect(tombs[0]).toMatch(TOMB_RE);
    expect(r).toEqual({ error: `lock displaced: kept ${tombs[0]} (${code})` });
    expect(fs.readFileSync(path.join(parent, tombs[0]), "utf8")).toBe(recordBytes(B, N2));
    expect(fs.existsSync(lock)).toBe(false);
    expect(fs.readdirSync(parent)).toEqual(tombs);
  });
});

describe("D82-WI-9 S-2: a failing tomb unlink on the success path", () => {
  it.each(FNS)("$fn: still returns released, .lock absent, the tomb (A's own record) is no lock", ({ call }) => {
    const parent = freshParent();
    acquireLock(parent, { run: A, nonce: N1 });
    failTombUnlink("EPERM");

    const r = outcome(() => call(parent));
    vi.restoreAllMocks();

    const tombs = tombsIn(parent);
    // rule 12: D105-WI-3. Was `expect(r).toBe("released")`. D105 names that silent
    // "released" as a defect: a kept own tomb is now reported in the result.
    expect(r).toBe(`released; tomb kept: ${tombs[0]}`);
    expect(fs.existsSync(lockFile(parent))).toBe(false);
    expect(tombs).toHaveLength(1);
    expect(fs.readFileSync(path.join(parent, tombs[0]), "utf8")).toBe(recordBytes(A, N1));
    // Nothing reads a tomb as a lock: the lock reads absent.
    expect(readLock(parent)).toEqual({ state: "absent" });
    // rule 12: D105-WI-3. Was `expect(acquireLock(C)).toEqual({ run: C })` and C's
    // bytes at .lock. Any tomb now refuses the next acquire (D105-WI-3, D2: nothing
    // auto-cleans), naming the tomb and the run it holds; .lock stays absent.
    expect(outcome(() => JSON.stringify(acquireLock(parent, { run: C, nonce: N3 })))).toEqual({
      error: `lock interrupted: kept ${tombs[0]} (run ${A})`,
    });
    expect(fs.existsSync(lockFile(parent))).toBe(false);
  });
});

describe("D82-WI-9 S-2: a failing tomb unlink on the restore path", () => {
  it.each(FNS)("$fn: still throws the fault-free mismatch, appends `; tomb kept: <tomb>`, B is back at .lock", ({ call }) => {
    const control = controlMismatch(call);
    expect(control).toEqual({ error: `lock names run ${B}, not ${A}` });

    const parent = freshParent();
    acquireLock(parent, { run: A, nonce: N1 });
    const lock = lockFile(parent);
    swapBeforeRename(lock);
    failTombUnlink("EPERM");

    const r = outcome(() => call(parent));
    vi.restoreAllMocks();

    const tombs = tombsIn(parent);
    expect(tombs).toHaveLength(1);
    expect(tombs[0]).toMatch(TOMB_RE);
    const msg = typeof r === "string" ? r : r.error;
    expect(msg.startsWith((control as { error: string }).error)).toBe(true);
    expect(r).toEqual({ error: `${(control as { error: string }).error}; tomb kept: ${tombs[0]}` });
    expect(fs.readFileSync(lock, "utf8")).toBe(recordBytes(B, N2));
    expect(readLock(parent)).toEqual({ state: "held", run: B });
  });
});

describe("D82-WI-9 S-2: quit's verdict ignores a failing restore-path tomb unlink", () => {
  /** quit R; at R's death `.lock` is R's, swapped to B's just before release renames it. */
  async function quitWithSwap(withFault: boolean) {
    const q = await launched();
    q.procs({ [PID]: atDeath(diesOn("SIGTERM"), () => {
      swapBeforeRename(q.lockPath);
      if (withFault) failTombUnlink("EPERM");
    }) });
    const r = await q.quit();
    vi.restoreAllMocks();
    const name = q.fx.name;
    return { exit: r.exit, lines: q.out.map((l) => l.split(name).join("<R>")), lock: q.lockState(), tombs: q.tombs() };
  }

  it("QU-WI9-1 taken-over verdict and lock are identical with and without the fault", async () => {
    const clean = await quitWithSwap(false);
    const faulty = await quitWithSwap(true);
    expect(clean.tombs).toEqual([]);
    expect(faulty.tombs).toHaveLength(1);
    expect(faulty.exit).toBe(clean.exit);
    expect(faulty.lines).toEqual(clean.lines);
    expect(faulty.lock).toBe(recordBytes(B, N2));
    expect(clean.lock).toBe(recordBytes(B, N2));
  });
});
