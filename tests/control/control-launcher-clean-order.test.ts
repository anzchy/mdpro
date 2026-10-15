// @vitest-environment node
/**
 * ADR-0047 WI-003 review fix WI-R2: `clean <run>` removes R's contents with
 * `launch.json` LAST, then R, then the lock. An interrupted clean therefore
 * leaves `launch.json` and the lock bytes in place, and the next `clean R`
 * can still prove ownership and finish the job.
 * Matrix: `.claude/tdd-guardian/tests-20261008-144444.md`, "Round 4 changes
 * (review fixes, WI-R2)", CL-R12 and CL-R13.
 *
 * Fixture: a dead owned run R built by hand under a `makeHome()` home (the
 * same shape as `control-launcher-clean.test.ts`). Only `deps.procFacts`,
 * `deps.uid` and, in CL-R12, `deps.rmSync` (a wrapper around the real
 * `fs.rmSync` that throws on one chosen call) are injected; the ownership
 * verdict, the lock and the fs are real.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { last, LSTART, MAIN, NONCE } from "../support/launchHarness";
import { fakeProcFacts, makeHome } from "../support/launcherFakes";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run as cleanRun } from "../../scripts/control/clean.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { acquireLock } from "../../scripts/control/lock.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { layout, runName, runsParent } from "../../scripts/control/runDir.mjs";

type Result = { exit: number; lines: string[] };

const NAME: string = runName(Buffer.alloc(16, 0x11));
const DF = "verdict: driver failure — ";

let disposers: (() => void)[] = [];
afterEach(() => {
  for (const d of disposers.reverse()) d();
  disposers = [];
});

/** A dead owned R: launch.json, instance.json, owner.json, a tmp leftover, prefs, drafts; a lock naming R. */
function fixture() {
  const h = makeHome();
  disposers.push(h.cleanup);
  const parent: string = runsParent(h.real);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const lay: Record<string, string> = layout(parent, NAME);
  fs.mkdirSync(lay.runDir, { mode: 0o700 });
  fs.chmodSync(lay.runDir, 0o700);
  fs.writeFileSync(lay.launchJson, JSON.stringify({ nonce: NONCE, buildId: "b1", mainBinary: MAIN }));
  fs.writeFileSync(lay.instanceJson, JSON.stringify({ pid: 4242, nonce: NONCE, buildId: "b1" }));
  fs.writeFileSync(lay.ownerJson, JSON.stringify({ pid: 4242, startTime: LSTART, exeRealpath: MAIN }));
  fs.writeFileSync(path.join(lay.runDir, `.instance.json.${randomUUID()}.tmp`), "{}");
  fs.mkdirSync(lay.prefsDir, { mode: 0o700 });
  fs.writeFileSync(lay.prefs, "{}");
  fs.mkdirSync(lay.drafts, { recursive: true });
  fs.writeFileSync(path.join(lay.drafts, "d1.md"), "# d1\n");
  acquireLock(parent, { run: NAME, nonce: NONCE });
  const sockDir = fs.mkdtempSync("/tmp/lo");
  disposers.push(() => fs.rmSync(sockDir, { recursive: true, force: true }));
  const out: string[] = [];
  const deps: Record<string, unknown> = {};
  const clean = (): Promise<Result> =>
    cleanRun(
      { run: NAME },
      {
        passwdHome: h.home,
        uid: process.getuid?.(),
        siSockPath: path.join(sockDir, "si.sock"),
        procFacts: fakeProcFacts({ scan: [] }),
        out: (l: string) => out.push(l),
        err: (l: string) => out.push(l),
        ...deps,
      },
    );
  return { lay, out, deps, clean, lockPath: path.join(parent, ".lock") };
}

/** A real `fs.rmSync` that throws `EIO` on call number `failAt` (1-based) and on no other. */
function rmFailingAt(failAt: number) {
  let calls = 0;
  return (p: string, o: fs.RmOptions) => {
    calls += 1;
    if (calls === failAt) throw Object.assign(new Error("injected rm failure"), { code: "EIO" });
    fs.rmSync(p, o);
  };
}

describe("WI-R2 clean: launch.json is removed last, so an interrupted clean can be retried", () => {
  it("CL-R12 for every interruption point: launch.json and the lock survive, and a second clean R passes", async () => {
    const entries = fs.readdirSync(fixture().lay.runDir).length;
    expect(entries).toBe(6);
    for (let k = 0; k < entries; k += 1) {
      const fx = fixture();
      const launch = fs.readFileSync(fx.lay.launchJson, "utf8");
      const lock = fs.readFileSync(fx.lockPath, "utf8");
      fx.deps.rmSync = rmFailingAt(k + 1);
      const r = await fx.clean();
      const state = {
        k,
        last: last(fx.out),
        exit: r.exit,
        launch: fs.existsSync(fx.lay.launchJson) ? fs.readFileSync(fx.lay.launchJson, "utf8") : "launch.json gone",
        lock: fs.existsSync(fx.lockPath) ? fs.readFileSync(fx.lockPath, "utf8") : "lock released",
      };
      expect(state).toEqual({ k, last: `${DF}remove failed: EIO`, exit: 1, launch, lock });

      fx.out.length = 0;
      fx.deps.rmSync = fs.rmSync;
      const again = await fx.clean();
      expect({ k, out: [...fx.out], exit: again.exit }).toEqual({ k, out: [`clean: removed ${NAME}`, "verdict: pass"], exit: 0 });
      expect({ k, runDir: fs.existsSync(fx.lay.runDir), lock: fs.existsSync(fx.lockPath) }).toEqual({ k, runDir: false, lock: false });
    }
  });

  it.skipIf(process.getuid?.() === 0)("CL-R13 a real EACCES inside R keeps launch.json and the lock; after the fix a second clean passes", async () => {
    const fx = fixture();
    const launch = fs.readFileSync(fx.lay.launchJson, "utf8");
    const lock = fs.readFileSync(fx.lockPath, "utf8");
    fs.chmodSync(fx.lay.drafts, 0o500);
    disposers.push(() => fs.existsSync(fx.lay.drafts) && fs.chmodSync(fx.lay.drafts, 0o700));
    const r = await fx.clean();
    expect(last(fx.out)).toBe(`${DF}remove failed: EACCES`);
    expect(r.exit).toBe(1);
    expect(fs.existsSync(fx.lay.launchJson) ? fs.readFileSync(fx.lay.launchJson, "utf8") : "launch.json gone").toBe(launch);
    expect(fs.existsSync(fx.lockPath) ? fs.readFileSync(fx.lockPath, "utf8") : "lock released").toBe(lock);

    fs.chmodSync(fx.lay.drafts, 0o700);
    fx.out.length = 0;
    const again = await fx.clean();
    expect(fx.out).toEqual([`clean: removed ${NAME}`, "verdict: pass"]);
    expect(again.exit).toBe(0);
    expect(fs.existsSync(fx.lay.runDir)).toBe(false);
    expect(fs.existsSync(fx.lockPath)).toBe(false);
  });
});
