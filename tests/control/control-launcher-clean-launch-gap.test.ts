// @vitest-environment node
/**
 * D148-WI-1: `clean <C>` never releases the lock of a launch whose run dir is
 * not made yet. `launch` makes the run dir inside the acquire's `.lock.mutex`
 * section, and `releaseOrphanLock` (and `clean`'s si.sock re-check) re-check,
 * inside their own sections, that the run dir is still absent.
 *
 * Real fs, real lock, real launch driver (spawn, procFacts, clock faked at the
 * boundary by `launchFixture`), real clean driver. The racing `clean` is
 * started from a pass-through `fs` spy at the exact point of the gap, so its
 * synchronous part (the `lstat` of C and the lock read) runs there and the
 * rest after the launch yields.
 * Plan and matrix: `.claude/tdd-guardian/plan-d148-20261011-164204.md`,
 * D148-WI-1, LG-1..LG-5.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { last, launchFixture, NONCE, type Fixture } from "../support/launchHarness";
import { fakeProcFacts } from "../support/launcherFakes";
import {
  disposeAll,
  makeStaleSocket,
  NAME,
  ORPHAN_NONCE,
  orphanFixture,
  preBound,
  type Probe,
  probeSocket,
} from "../support/cleanSockFixtures";
import { cleanupParents, freshParent, lockFile, outcome, recordBytes, tombsIn } from "../support/lockSchedules";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run as launchRun } from "../../scripts/control/launch.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run as cleanRun } from "../../scripts/control/clean.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { acquireLock, releaseOrphanLock } from "../../scripts/control/lock.mjs";

type Result = { exit: number; lines: string[] };
const DF = "verdict: driver failure — ";

let fixtures: Fixture[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const fx of fixtures.splice(0)) fx.cleanup();
  cleanupParents();
  await disposeAll();
});

const fixture = () => {
  const fx = launchFixture();
  fixtures.push(fx);
  return fx;
};
const lockBytes = (p: string) => (fs.existsSync(lockFile(p)) ? fs.readFileSync(lockFile(p), "utf8") : null);
const mutexFiles = (p: string) => fs.readdirSync(p).filter((n) => n.startsWith(".lock.mutex"));

/** A `clean <fx.name>` on the launch's home: scan `[]`, probe `absent`, its own output. */
function racingClean(fx: Fixture) {
  const out: string[] = [];
  const start = (): Promise<Result> =>
    cleanRun(
      { run: fx.name },
      {
        passwdHome: fx.home,
        uid: process.getuid?.(),
        siSockPath: `/tmp/lgap-${process.pid}-absent.sock`,
        procFacts: fakeProcFacts({ scan: [], probe: "absent" }),
        out: (l: string) => out.push(l),
        err: (l: string) => out.push(l),
      },
    );
  return { out, start };
}

const realWrite = fs.writeFileSync;
const realMkdir = fs.mkdirSync;

/** Start `fire()` once, at `at`: right after the real `.lock` write, or right before the real run-dir mkdir. */
function injectAt(fx: Fixture, at: "after-lock-write" | "before-run-dir-mkdir", fire: () => void) {
  let fired = false;
  const lock = lockFile(fx.parent);
  vi.spyOn(fs, "writeFileSync").mockImplementation(((...a: Parameters<typeof fs.writeFileSync>) => {
    realWrite(...a);
    if (at === "after-lock-write" && !fired && a[0] === lock) {
      fired = true;
      fire();
    }
  }) as typeof fs.writeFileSync);
  vi.spyOn(fs, "mkdirSync").mockImplementation(((...a: Parameters<typeof fs.mkdirSync>) => {
    if (at === "before-run-dir-mkdir" && !fired && a[0] === fx.lay.runDir) {
      fired = true;
      fire();
    }
    return realMkdir(...a);
  }) as typeof fs.mkdirSync);
  return () => fired;
}

describe("D148-WI-1 a clean racing a launch's acquire never frees the launch's lock", () => {
  it.each(["after-lock-write", "before-run-dir-mkdir"] as const)(
    "LG-1 clean <C> started %s: the launch passes, clean refuses, C's lock stays",
    async (at) => {
      const fx = fixture();
      const c = racingClean(fx);
      let pending: Promise<Result> | null = null;
      const fired = injectAt(fx, at, () => {
        pending = c.start();
      });
      const launched = await launchRun({ file: "/tmp/f.md" }, fx.deps);
      const cleaned = await (pending as unknown as Promise<Result>);
      vi.restoreAllMocks();
      expect(fired()).toBe(true);
      expect({ launch: last(launched.lines), clean: c.out, cleanExit: cleaned.exit }).toEqual({
        launch: "verdict: pass",
        clean: [`${DF}lock not released: run ${fx.name} is launching: run dir appeared`],
        cleanExit: 1,
      });
      expect(lockBytes(fx.parent)).toBe(recordBytes(fx.name, NONCE));
      expect(mutexFiles(fx.parent)).toEqual([]);
      expect(tombsIn(fx.parent)).toEqual([]);
    },
  );

  it("LG-2 the run dir is made inside the acquire's .lock.mutex section, after the lock record", async () => {
    const fx = fixture();
    const seen: unknown[] = [];
    vi.spyOn(fs, "mkdirSync").mockImplementation(((...a: Parameters<typeof fs.mkdirSync>) => {
      if (a[0] === fx.lay.runDir) {
        let mutexPid: unknown = null;
        try {
          mutexPid = JSON.parse(fs.readFileSync(path.join(fx.parent, ".lock.mutex"), "utf8")).pid;
        } catch (e) {
          mutexPid = e instanceof Error ? e.message.split(":")[0] : String(e);
        }
        seen.push({ mutexPid, lock: lockBytes(fx.parent) });
      }
      return realMkdir(...a);
    }) as typeof fs.mkdirSync);
    const r = await launchRun({ file: "/tmp/f.md" }, fx.deps);
    vi.restoreAllMocks();
    expect(seen).toEqual([{ mutexPid: process.pid, lock: recordBytes(fx.name, NONCE) }]);
    expect(last(r.lines)).toBe("verdict: pass");
  });

  it("LG-3 R's run dir appears and a live socket is bound during the re-probe: socket kept, lock kept, loud refusal", async () => {
    let fx: ReturnType<typeof orphanFixture> | null = null;
    let pre = "";
    let calls = 0;
    const probe = async (): Promise<Probe> => {
      calls += 1;
      if (calls === 2) {
        const f = fx as ReturnType<typeof orphanFixture>;
        fs.mkdirSync(path.join(f.parent, NAME), { mode: 0o700 });
        fs.renameSync(pre, f.siSock);
      }
      return "stale";
    };
    fx = orphanFixture({ probe });
    await makeStaleSocket(fx.siSock);
    pre = await preBound(fx.dir);
    const r = await fx.clean();
    expect({ exit: r.exit, out: fx.out }).toEqual({
      exit: 1,
      out: [`[info] si.sock kept: run ${NAME} is launching`, `${DF}lock not released: run ${NAME} is launching: run dir appeared`],
    });
    expect(await probeSocket(fx.siSock)).toBe("live");
    expect(lockBytes(fx.parent)).toBe(recordBytes(NAME, ORPHAN_NONCE));
    expect(mutexFiles(fx.parent)).toEqual([]);
    expect(tombsIn(fx.parent)).toEqual([]);
  });
});

describe("D148-WI-1 releaseOrphanLock requires the run dir to be absent, inside its section", () => {
  const R = "r".repeat(25);
  const N = "ab".repeat(32);
  const ENTRIES: [string, (p: string) => void][] = [
    ["a directory", (p) => fs.mkdirSync(p, { mode: 0o700 })],
    ["a file", (p) => fs.writeFileSync(p, "x")],
    ["a dangling symlink", (p) => fs.symlinkSync("/nonexistent-d148", p)],
  ];

  it.each(ENTRIES)("LG-4 an entry named R (%s): refused, lock byte-identical, nothing left behind", (_kind, make) => {
    const p = freshParent();
    acquireLock(p, { run: R, nonce: N });
    make(path.join(p, R));
    const before = lockBytes(p);
    expect(outcome(() => releaseOrphanLock(p, R))).toEqual({ error: `run ${R} is launching: run dir appeared` });
    expect(lockBytes(p)).toBe(before);
    expect(tombsIn(p)).toEqual([]);
    expect(mutexFiles(p)).toEqual([]);
  });

  it("LG-5 no entry named R: the orphan lock is released", () => {
    const p = freshParent();
    acquireLock(p, { run: R, nonce: N });
    expect(outcome(() => releaseOrphanLock(p, R))).toBe("released");
    expect(fs.readdirSync(p)).toEqual([]);
  });
});
