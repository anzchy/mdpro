// @vitest-environment node
/**
 * ADR-0047 WI-003 review fix WI-R1: `clean <run>` when the run dir R is
 * absent — the orphaned lock and the stale `si.sock` with no run dir.
 * Matrix: `.claude/tdd-guardian/tests-20261008-144444.md`, "Round 3 changes",
 * CL-R1..CL-R9, and DR-R2 (the doctor's stale-socket hint, run literally).
 *
 * Fixture: a `makeHome()` home with a runs parent and no R; a `.lock` is
 * written per case. Only `deps.procFacts` (scan, probe — or the real
 * `probeSocket` for a real socket) is injected; the lock and the fs are real.
 * Lines are pinned as literals, never imported.
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { last, sha256, walk } from "./support/launchHarness";
import { fakeProcFacts, makeHome, makeStaleSocket } from "./support/launcherFakes";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run as cleanRun } from "../scripts/control/clean.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { evaluate } from "../scripts/control/doctorChecks.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { acquireLock } from "../scripts/control/lock.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { probeSocket } from "../scripts/control/procFacts.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { runName, runsParent } from "../scripts/control/runDir.mjs";

type Result = { exit: number; lines: string[] };
type ProcTable = NonNullable<Parameters<typeof fakeProcFacts>[0]>;

const NAME: string = runName(Buffer.alloc(16, 0x11));
const OTHER: string = runName(Buffer.alloc(16, 0x33));
const OTHER_VERIFY = 7777;
const FAIL = "verdict: fail — ";
const RELEASED = `clean: absent ${NAME}; released orphan lock`;
const ABSENT = `clean: absent ${NAME}`;
const SOCK_REMOVED = "clean: removed stale si.sock";

let disposers: (() => void)[] = [];
afterEach(() => {
  for (const d of disposers.reverse()) d();
  disposers = [];
});

type FxOpts = { lock?: "this" | "other" | "corrupt" | "none"; procs?: ProcTable; realSocket?: boolean };

/** A home whose runs parent holds no R, plus a lock per `o.lock` and a short si.sock path. */
function fixture(o: FxOpts = {}) {
  const h = makeHome();
  disposers.push(h.cleanup);
  const parent: string = runsParent(h.real);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const lockPath = path.join(parent, ".lock");
  const lock = o.lock ?? "this";
  if (lock === "this") acquireLock(parent, { run: NAME, nonce: "ab".repeat(32) });
  if (lock === "other") acquireLock(parent, { run: OTHER, nonce: "cd".repeat(32) });
  if (lock === "corrupt") fs.writeFileSync(lockPath, "{", { mode: 0o600 });
  const sockDir = fs.mkdtempSync("/tmp/lo");
  disposers.push(() => fs.rmSync(sockDir, { recursive: true, force: true }));
  const siSock = path.join(sockDir, "si.sock");
  const out: string[] = [];
  const procs = { scan: [], ...o.procs } as ProcTable;
  const procFacts = fakeProcFacts(o.realSocket ? { ...procs, probe: (p: string) => probeSocket(p) } : procs);
  const clean = (run: string = NAME): Promise<Result> =>
    cleanRun(
      { run },
      { passwdHome: h.home, uid: process.getuid?.(), siSockPath: siSock, procFacts, out: (l: string) => out.push(l), err: (l: string) => out.push(l) },
    );
  const lockBytes = () => (fs.existsSync(lockPath) ? sha256(fs.readFileSync(lockPath, "latin1")) : null);
  return { ...h, parent, lockPath, sockDir, siSock, out, clean, lockBytes };
}

/** Every entry under `root` (never through a link): rel, mode, mtime, content. */
function snapshot(root: string) {
  return walk(root).map((rel) => {
    const st = fs.lstatSync(path.join(root, rel));
    const content = st.isFile() ? sha256(fs.readFileSync(path.join(root, rel), "latin1")) : null;
    return { rel, mode: st.mode, mtimeMs: st.mtimeMs, content };
  });
}
/** Like `snapshot` without the lock and without directory mtimes (an unlink touches its parent). */
const shape = (root: string) =>
  snapshot(root)
    .filter((e) => path.basename(e.rel) !== ".lock")
    .map((e) => (fs.lstatSync(path.join(root, e.rel)).isDirectory() ? { ...e, mtimeMs: null } : e));

describe("WI-R1 clean#run absent R with a lock naming R (orphan)", () => {
  it("CL-R1 the orphan lock is released; nothing else in the home changes", async () => {
    const fx = fixture();
    const before = shape(fx.real);
    const r = await fx.clean();
    expect(fx.out).toEqual([RELEASED, "verdict: pass"]);
    expect(r.exit).toBe(0);
    expect(fs.existsSync(fx.lockPath)).toBe(false);
    expect(shape(fx.real)).toEqual(before);
  });

  it("CL-R9 idempotent: a second clean reports plain absent and changes nothing", async () => {
    const fx = fixture();
    expect((await fx.clean()).exit).toBe(0);
    const before = snapshot(fx.real);
    fx.out.length = 0;
    const second = await fx.clean();
    expect(fx.out).toEqual([ABSENT, "verdict: pass"]);
    expect(second.exit).toBe(0);
    expect(snapshot(fx.real)).toEqual(before);
  });

  it.each([
    ["scan hit", { scan: [OTHER_VERIFY] }, "orphan lock kept: verify binary running"],
    ["scan unknown", { scan: "unknown" as const }, "orphan lock kept: process scan unknown"],
    ["probe unknown", { probe: "unknown" as const }, "orphan lock kept: si.sock probe unknown"],
  ])("CL-R4 %s: refused in one line, lock bytes and home unchanged", async (_id, procs, reason) => {
    const fx = fixture({ procs: procs as ProcTable });
    const before = snapshot(fx.real);
    const lock = fx.lockBytes();
    const r = await fx.clean();
    expect(fx.out).toEqual([`${FAIL}${reason}`]);
    expect(r.exit).toBe(1);
    expect(fx.lockBytes()).toBe(lock);
    expect(snapshot(fx.real)).toEqual(before);
  });

  it("CL-R4 live si.sock (real listener): refused, lock and listener kept", async () => {
    const fx = fixture({ realSocket: true });
    const server = net.createServer();
    await new Promise<void>((res) => server.listen(fx.siSock, res));
    try {
      const before = snapshot(fx.real);
      const r = await fx.clean();
      expect(fx.out).toEqual([`${FAIL}orphan lock kept: si.sock live`]);
      expect(r.exit).toBe(1);
      expect(snapshot(fx.real)).toEqual(before);
      expect(await probeSocket(fx.siSock)).toBe("live");
    } finally {
      await new Promise<void>((res) => server.close(() => res()));
    }
  });

  it("CL-R6 orphan lock and a stale si.sock (real): both removed", async () => {
    const fx = fixture({ realSocket: true });
    await makeStaleSocket(fx.siSock);
    const r = await fx.clean();
    expect(fx.out).toEqual([RELEASED, SOCK_REMOVED, "verdict: pass"]);
    expect(r.exit).toBe(0);
    expect(fs.existsSync(fx.lockPath)).toBe(false);
    expect(fs.existsSync(fx.siSock)).toBe(false);
  });

  it("CL-R8 a the lock vanishes during the probe: plain absent, pass", async () => {
    const fx = fixture({ procs: { probe: async () => (fs.unlinkSync(fx.lockPath), "absent") } });
    const r = await fx.clean();
    expect(fx.out).toEqual([ABSENT, "verdict: pass"]);
    expect(r.exit).toBe(0);
  });

  it("CL-R8 b the lock is retaken by another run during the probe: driver failure, its bytes kept", async () => {
    let otherLock: string | null = null;
    const fx = fixture({
      procs: {
        probe: async () => {
          fs.unlinkSync(fx.lockPath);
          acquireLock(fx.parent, { run: OTHER, nonce: "ef".repeat(32) });
          otherLock = fx.lockBytes();
          return "absent";
        },
      },
    });
    const r = await fx.clean();
    expect(last(fx.out)).toBe(`verdict: driver failure — lock not released: lock names run ${OTHER}, not ${NAME}`);
    expect(r.exit).toBe(1);
    expect(fx.lockBytes()).toBe(otherLock);
  });
});

describe("WI-R1 clean#run absent R: other locks are never touched", () => {
  it("CL-R2 a lock naming another run: plain absent, lock bytes and a stale si.sock (real) kept", async () => {
    const fx = fixture({ lock: "other", realSocket: true });
    await makeStaleSocket(fx.siSock);
    const lock = fx.lockBytes();
    const before = snapshot(fx.real);
    const r = await fx.clean();
    expect(fx.out).toEqual([ABSENT, "verdict: pass"]);
    expect(r.exit).toBe(0);
    expect(fx.lockBytes()).toBe(lock);
    expect(snapshot(fx.real)).toEqual(before);
    expect(await probeSocket(fx.siSock)).toBe("stale");
  });

  it("CL-R3 a corrupt lock: refused as ownership: lock, bytes kept", async () => {
    const fx = fixture({ lock: "corrupt" });
    const before = snapshot(fx.real);
    const r = await fx.clean();
    expect(last(fx.out)).toBe(`${FAIL}ownership: lock`);
    expect(r.exit).toBe(1);
    expect(fs.readFileSync(fx.lockPath, "utf8")).toBe("{");
    expect(snapshot(fx.real)).toEqual(before);
  });
});

describe("WI-R1 clean#run absent R and no lock: the stale si.sock (real sockets)", () => {
  it("CL-R5 scan []: the stale socket is removed", async () => {
    const fx = fixture({ lock: "none", realSocket: true });
    await makeStaleSocket(fx.siSock);
    const r = await fx.clean();
    expect(fx.out).toEqual([ABSENT, SOCK_REMOVED, "verdict: pass"]);
    expect(r.exit).toBe(0);
    expect(fs.existsSync(fx.siSock)).toBe(false);
    expect(fs.existsSync(fx.lockPath)).toBe(false);
  });

  it.each([
    ["scan hit", [OTHER_VERIFY] as number[] | "unknown", "[info] si.sock kept: verify binary running"],
    ["scan unknown", "unknown" as const, "[info] si.sock kept: process scan unknown"],
  ])("CL-R7 %s: the stale socket is kept", async (_id, scan, info) => {
    const fx = fixture({ lock: "none", realSocket: true, procs: { scan } });
    await makeStaleSocket(fx.siSock);
    const r = await fx.clean();
    expect(fx.out).toEqual([ABSENT, info, "verdict: pass"]);
    expect(r.exit).toBe(0);
    expect(await probeSocket(fx.siSock)).toBe("stale");
  });
});

describe("WI-R1 DR-R2 the doctor's stale-socket hint is a command that works", () => {
  it.each([
    ["no lock", "none" as const, null],
    ["an orphan lock", "this" as const, { state: "held", run: NAME, live: false }],
  ])("%s, no run dirs: running the hinted command removes the stale si.sock", async (_id, lock, lockFact) => {
    const fx = fixture({ lock, realSocket: true });
    await makeStaleSocket(fx.siSock);
    const { lines } = evaluate({ lock: lockFact ?? { state: "absent" }, siSock: "stale", leftoverRuns: [], siSockPath: fx.siSock });
    const hint = (lines as string[]).find((l) => l.startsWith("[info] stale si.sock"));
    const run = /\(pnpm control:clean ([0-9a-z]{25}) removes it/.exec(hint ?? "")?.[1];
    expect(run, hint).toBeDefined();
    const r = await fx.clean(run);
    expect(r.exit).toBe(0);
    expect(fx.out).toContain(SOCK_REMOVED);
    expect(fs.existsSync(fx.siSock)).toBe(false);
    expect(fs.existsSync(fx.lockPath)).toBe(false);
  });
});
