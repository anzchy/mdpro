// @vitest-environment node
/**
 * D105-WI-3: a release whose own tomb could not be unlinked
 * (`released; tomb kept: <tomb>`) is reported by the command that released.
 * The release itself succeeded, so the verdict stays as it was; the report is
 * a `[warn] lock tomb kept: <tomb>` line:
 * - `clean` (present and absent run): after the removed/absent line, before
 *   `verdict: pass`;
 * - `quit`: after the stop line, before `verdict: pass`;
 * - `launch`'s failure cleanup: on stderr, the driver-failure verdict unchanged.
 *
 * Real fs, real lock; the fault is `failTombUnlink`
 * (`tests/support/lockSchedules.ts`), installed after the fixture took its lock.
 * Plan and matrix: `.claude/tdd-guardian/plan-d105-20261011-144108.md`,
 * D105-WI-3, SL-5..SL-7. Post-plan addition: SL-9 (`launch`'s `fail()`).
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run as launch } from "../../scripts/control/launch.mjs";
import { NAME, RELEASED, disposeAll, orphanFixture, runFixture, tombsIn } from "../support/cleanSockFixtures";
import { last, launchFixture, type Fixture } from "../support/launchHarness";
import { failTombUnlink } from "../support/lockSchedules";
import { atDeath, cleanupQuitFixtures, diesOn, launched, PID } from "../support/quitHarness";

const fixtures: Fixture[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const fx of fixtures.splice(0)) fx.cleanup();
  cleanupQuitFixtures();
  await disposeAll();
});

const TOMB_RE = /^\.lock\.\d+-[0-9a-f]{16}\.tomb$/;
/** The one tomb in `parent`; fails the test unless there is exactly one, well named. */
function oneTomb(parent: string): string {
  const tombs = tombsIn(parent);
  expect(tombs).toHaveLength(1);
  expect(tombs[0]).toMatch(TOMB_RE);
  return tombs[0];
}

describe("D105-WI-3 clean reports a kept own tomb", () => {
  it("SL-5 present run: removed line, the warn line, verdict pass; .lock absent", async () => {
    const fx = runFixture();
    failTombUnlink("EPERM");
    const r = await fx.clean();
    vi.restoreAllMocks();
    const tomb = oneTomb(fx.parent);
    expect(fx.out).toEqual([`clean: removed ${NAME}`, `[warn] lock tomb kept: ${tomb}`, "verdict: pass"]);
    expect(r.exit).toBe(0);
    expect(fs.existsSync(fx.lockPath)).toBe(false);
  });

  it("SL-6 absent run with an orphan lock: released-orphan line, the warn line, verdict pass", async () => {
    const fx = orphanFixture();
    failTombUnlink("EPERM");
    const r = await fx.clean();
    vi.restoreAllMocks();
    const tomb = oneTomb(fx.parent);
    expect(fx.out).toEqual([RELEASED, `[warn] lock tomb kept: ${tomb}`, "verdict: pass"]);
    expect(r.exit).toBe(0);
    expect(fs.existsSync(fx.lockPath)).toBe(false);
  });

  it("SL-6 control: no fault, no warn line", async () => {
    const fx = orphanFixture();
    await fx.clean();
    expect(fx.out).toEqual([RELEASED, "verdict: pass"]);
    expect(tombsIn(fx.parent)).toEqual([]);
  });
});

describe("D105-WI-3 quit reports a kept own tomb", () => {
  it("SL-7 confirmed-dead run: the stop line, the warn line, verdict pass", async () => {
    const q = await launched();
    q.procs({ [PID]: atDeath(diesOn("SIGTERM"), () => failTombUnlink("EPERM")) });
    const r = await q.quit();
    vi.restoreAllMocks();
    const tomb = oneTomb(q.fx.parent);
    expect(q.out.slice(-3)).toEqual([`quit: run ${q.fx.name} terminated (SIGTERM)`, `[warn] lock tomb kept: ${tomb}`, "verdict: pass"]);
    expect(r.exit).toBe(0);
    expect(q.lockState()).toBeNull();
  });
});

describe("D105-WI-3 launch's failure cleanup reports a kept own tomb", () => {
  it("SL-9 run-dir collision after acquire: stderr carries the warn line, the verdict is unchanged", async () => {
    const fx = launchFixture();
    fixtures.push(fx);
    fs.mkdirSync(fx.lay.runDir, { recursive: true });
    failTombUnlink("EPERM");
    const r = await launch({ file: "/tmp/f.md" }, fx.deps);
    vi.restoreAllMocks();
    const tomb = oneTomb(fx.parent);
    expect(fx.err).toEqual([`[warn] lock tomb kept: ${tomb}`]);
    expect(last(fx.out)).toBe(`verdict: driver failure — run dir already exists: ${fx.name}`);
    expect(r.exit).toBe(1);
    expect(fs.existsSync(path.join(fx.parent, ".lock"))).toBe(false);
  });
});
