// @vitest-environment node
/**
 * D82-WI-2 (H2): `clean` keeps the lock until it has finished with `si.sock`,
 * and re-probes the socket right before unlinking it.
 * Matrix: `.claude/tdd-guardian/tests-20261010-103136.md`, D82-WI-2:
 * CS-0, CS-1, CS-2, CS-3, CS-3b, CS-6, CS-6b, CS-7, CS-7b. CS-4 and CS-5 live
 * in `control-launcher-clean-sisock-law.test.ts`.
 *
 * The competitor models a launch: `acquireLock(B)`, and only on success it
 * moves a real listening socket onto `si.sock` (a rename keeps it live, CS-0).
 * It fires from a pass-through `vi.spyOn(fs, "unlinkSync")` when the path is
 * `si.sock`; every fs action stays real. No sleeps. Since D105-WI-4 the
 * unlink runs inside `.lock.mutex`, so the hooks wait for it (`mutexGate`).
 */
import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ABSENT,
  acquireLock,
  B,
  DF,
  disposeAll,
  FAIL,
  isSocket,
  makeStaleSocket,
  mutexGate,
  N2,
  NAME,
  NONCE,
  ORPHAN_NONCE,
  orphanFixture,
  OTHER,
  preBound,
  type Probe,
  probeSocket,
  RELEASED,
  runFixture,
  type Scan,
  scriptedProbe,
  SOCK_REMOVED,
  tombsIn,
  type Fx,
} from "./support/cleanSockFixtures";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { readLock } from "../scripts/control/lock.mjs";

const realRename = fs.renameSync;
const realUnlink = fs.unlinkSync;

afterEach(async () => {
  vi.restoreAllMocks();
  await disposeAll();
});

const thrown = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return "acquired";
};

/** A launch racing `clean`: take the lock as B; only then move a live listener onto `si.sock`. */
function competitor(fx: Fx, pre: string) {
  const rec = { acquire: null as string | null, installed: false };
  const fire = () => {
    rec.acquire = thrown(() => acquireLock(fx.parent, { run: B, nonce: N2 }));
    if (rec.acquire === "acquired") {
      realRename(pre, fx.siSock);
      rec.installed = true;
    }
  };
  return { rec, fire };
}

/** Pass-through `unlinkSync` spy: `before` / `after` run once around the real unlink of `si.sock`. */
// rule 12: D105-WI-4 (harness only; no assertion changed). clean's `si.sock` unlink
// now runs inside `.lock.mutex`, where the hooks' `acquireLock` would be a re-entry
// refused at once. The hooks model in-protocol processes (a launch, a racing
// owner), so they wait for the mutex: `mutexGate` runs them right after its real
// unlink, `before` then `after`. That is still before clean's lock release, so
// `lockAtUnlink` (read by `before`) sees the same lock; SG-6 pins the mutex at
// the unlink itself. Without a mutex they run exactly as before.
function onSockUnlink(fx: Fx, hooks: { before?: () => void; after?: () => void }) {
  let fired = 0;
  const gate = mutexGate(fx.parent);
  vi.spyOn(fs, "unlinkSync").mockImplementation(((p: fs.PathLike) => {
    const mine = p === fx.siSock && fired === 0;
    if (mine) {
      fired += 1;
      gate.run(() => hooks.before?.());
    }
    realUnlink(p);
    if (mine) gate.run(() => hooks.after?.());
    gate.unlinked(p);
  }) as typeof fs.unlinkSync);
  return () => fired;
}

describe("D82-WI-2 CS-0 harness precondition", () => {
  it("CS-0 a renamed bound socket stays live at its new path", async () => {
    const fx = runFixture();
    const pre = await preBound(fx.dir);
    realRename(pre, fx.siSock);
    expect(await probeSocket(fx.siSock)).toBe("live");
  });
});

describe("D82-WI-2 the lock is held while si.sock is unlinked", () => {
  it.each([
    ["CS-1 run()", "run" as const, [`clean: removed ${NAME}`, SOCK_REMOVED, "verdict: pass"]],
    ["CS-2 absentRun orphan", "orphan" as const, [RELEASED, SOCK_REMOVED, "verdict: pass"]],
  ])("%s: a launch at the unlink is refused, and the stale socket alone is removed", async (_id, kind, expected) => {
    const fx = kind === "run" ? runFixture() : orphanFixture();
    await makeStaleSocket(fx.siSock);
    const pre = await preBound(fx.dir);
    const c = competitor(fx, pre);
    let lockAtUnlink: unknown = null;
    const fired = onSockUnlink(fx, {
      before: () => {
        lockAtUnlink = readLock(fx.parent);
        c.fire();
      },
    });
    const r = await fx.clean();
    vi.restoreAllMocks();
    expect({ out: fx.out, exit: r.exit, fired: fired() }).toEqual({ out: expected, exit: 0, fired: 1 });
    expect(lockAtUnlink).toEqual({ state: "held", run: NAME });
    expect(c.rec).toEqual({ acquire: `lock held by run ${NAME}`, installed: false });
    expect(await probeSocket(fx.siSock)).toBe("absent");
    expect(fs.existsSync(fx.lockPath)).toBe(false);
    expect(tombsIn(fx.parent)).toEqual([]);
    expect(fx.out.join("\n")).not.toContain(NONCE);
    expect(fx.out.join("\n")).not.toContain(ORPHAN_NONCE);
  });
});

describe("D82-WI-2 a re-probe right before the unlink decides", () => {
  it("CS-3 run(): first probe stale, re-probe live: the socket is kept with the pinned info line", async () => {
    const probe = scriptedProbe(["stale", "live"]);
    const fx = runFixture({ probe });
    await makeStaleSocket(fx.siSock);
    const r = await fx.clean();
    expect(fx.out).toEqual([`clean: removed ${NAME}`, "[info] si.sock kept: re-probe live", "verdict: pass"]);
    expect(r.exit).toBe(0);
    expect(isSocket(fx.siSock)).toBe(true);
    expect(fs.existsSync(fx.lockPath)).toBe(false);
    expect(probe.calls.length).toBe(2);
  });

  it("CS-7 absentRun with no lock: first probe stale, re-probe live: kept", async () => {
    const probe = scriptedProbe(["stale", "live"]);
    const fx = orphanFixture({ lock: "none", probe });
    await makeStaleSocket(fx.siSock);
    const r = await fx.clean();
    expect(fx.out).toEqual([ABSENT, "[info] si.sock kept: re-probe live", "verdict: pass"]);
    expect(r.exit).toBe(0);
    expect(isSocket(fx.siSock)).toBe(true);
    expect(probe.calls.length).toBe(2);
  });

  it("CS-7b run() with no .lock: first probe stale, re-probe live: kept", async () => {
    const probe = scriptedProbe(["stale", "live"]);
    const fx = runFixture({ probe });
    fs.unlinkSync(fx.lockPath);
    await makeStaleSocket(fx.siSock);
    const r = await fx.clean();
    expect({ exit: r.exit, out: fx.out }).toEqual({
      exit: 0,
      out: [`clean: removed ${NAME}`, "[info] si.sock kept: re-probe live", "verdict: pass"],
    });
    expect(isSocket(fx.siSock)).toBe(true);
    expect(fs.existsSync(fx.lay.runDir)).toBe(false);
    expect(fs.existsSync(fx.lockPath)).toBe(false);
    expect(tombsIn(fx.parent)).toEqual([]);
    expect(probe.calls.length).toBe(2);
  });
});

type Row = { id: string; first: Probe; scan?: Scan; file?: boolean };
const ROWS: Row[] = [
  { id: "live", first: "live" },
  { id: "absent", first: "absent" },
  { id: "unknown", first: "unknown" },
  { id: "stale+scan hit", first: "stale", scan: [4242] },
  { id: "stale+scan unknown", first: "stale", scan: "unknown" },
  { id: "stale+regular file", first: "stale", file: true },
];
const RUN_OUT: Record<string, string[]> = {
  live: [`${FAIL}si.sock live`],
  absent: [`clean: removed ${NAME}`, "verdict: pass"],
  unknown: [`clean: removed ${NAME}`, "[info] si.sock kept: probe unknown", "verdict: pass"],
  "stale+scan hit": [`clean: removed ${NAME}`, "[info] si.sock kept: verify binary running", "verdict: pass"],
  "stale+scan unknown": [`clean: removed ${NAME}`, "[info] si.sock kept: process scan unknown", "verdict: pass"],
  "stale+regular file": [`clean: removed ${NAME}`, "[info] si.sock kept: not a socket", "verdict: pass"],
};
const ORPHAN_OUT: Record<string, string[]> = {
  live: [`${FAIL}orphan lock kept: si.sock live`],
  absent: [RELEASED, "verdict: pass"],
  unknown: [`${FAIL}orphan lock kept: si.sock probe unknown`],
  "stale+scan hit": [`${FAIL}orphan lock kept: verify binary running`],
  "stale+scan unknown": [`${FAIL}orphan lock kept: process scan unknown`],
  "stale+regular file": [RELEASED, "[info] si.sock kept: not a socket", "verdict: pass"],
};

describe("D82-WI-2 CS-3b no re-probe off the unlink path", () => {
  it.each([
    ["run()", "run" as const, RUN_OUT],
    ["absentRun orphan", "orphan" as const, ORPHAN_OUT],
  ])("%s: today's lines, the socket or file untouched, one probe per row", async (_id, kind, expected) => {
    const got = [];
    for (const row of ROWS) {
      const probe = scriptedProbe([row.first, "stale"]);
      const o = { probe, scan: row.scan ?? [] };
      const fx = kind === "run" ? runFixture(o) : orphanFixture(o);
      if (row.file) fs.writeFileSync(fx.siSock, "x");
      else await makeStaleSocket(fx.siSock);
      await fx.clean();
      const kept = row.file ? fs.readFileSync(fx.siSock, "utf8") === "x" : isSocket(fx.siSock);
      got.push({ id: row.id, out: fx.out, kept, probes: probe.calls.length });
    }
    expect(got).toEqual(ROWS.map((r) => ({ id: r.id, out: expected[r.id], kept: true, probes: 1 })));
  });
});

describe("D82-WI-2 a release that fails after the socket was removed", () => {
  it("CS-6 run(): the socket line, then the pinned driver-failure verdict last", async () => {
    const fx = runFixture();
    await makeStaleSocket(fx.siSock);
    let n2Bytes = "";
    onSockUnlink(fx, {
      after: () => {
        realUnlink(fx.lockPath);
        acquireLock(fx.parent, { run: NAME, nonce: N2 });
        n2Bytes = fs.readFileSync(fx.lockPath, "utf8");
      },
    });
    const r = await fx.clean();
    vi.restoreAllMocks();
    expect({ exit: r.exit, out: fx.out }).toEqual({
      exit: 1,
      out: [SOCK_REMOVED, `${DF}removed ${NAME}, lock not released: lock for run ${NAME} holds another nonce`],
    });
    expect(n2Bytes).not.toBe("");
    expect(fs.readFileSync(fx.lockPath, "utf8")).toBe(n2Bytes);
    expect(fs.existsSync(fx.siSock)).toBe(false);
    expect(fs.existsSync(fx.lay.runDir)).toBe(false);
    expect(tombsIn(fx.parent)).toEqual([]);
    for (const s of [NONCE, N2]) expect(fx.out.join("\n")).not.toContain(s);
  });

  it("CS-6b absentRun orphan: the socket line, then the orphan driver-failure verdict last", async () => {
    const fx = orphanFixture();
    await makeStaleSocket(fx.siSock);
    const listing = fs.readdirSync(fx.parent).sort();
    let otherBytes = "";
    onSockUnlink(fx, {
      after: () => {
        realUnlink(fx.lockPath);
        acquireLock(fx.parent, { run: OTHER, nonce: N2 });
        otherBytes = fs.readFileSync(fx.lockPath, "utf8");
      },
    });
    const r = await fx.clean();
    vi.restoreAllMocks();
    expect({ exit: r.exit, out: fx.out }).toEqual({
      exit: 1,
      out: [SOCK_REMOVED, `${DF}lock not released: lock names run ${OTHER}, not ${NAME}`],
    });
    expect(otherBytes).not.toBe("");
    expect(fs.readFileSync(fx.lockPath, "utf8")).toBe(otherBytes);
    expect(() => fs.lstatSync(fx.siSock)).toThrow(/ENOENT/);
    expect(fs.readdirSync(fx.parent).sort()).toEqual(listing);
    for (const s of [ORPHAN_NONCE, N2]) expect(fx.out.join("\n")).not.toContain(s);
  });
});
