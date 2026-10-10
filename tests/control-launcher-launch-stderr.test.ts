// @vitest-environment node
/**
 * D82-WI-3 M1: a stderr log that cannot be opened is a spawn failure, not a
 * throw. Before the fix `spawnLogged` opened `launcher-stderr.log` outside its
 * `try`, so EACCES / ENOENT escaped `launch.run()` past `fail()`: the lock
 * leaked, and `--into` reported through `formatError` instead of a verdict.
 * Matrix: `.claude/tdd-guardian/tests-20261010-103136.md`, "D82-WI-3",
 * LP-M1-a, LP-M1-b, LP-M1-c.
 *
 * Law: none (a failure-mapping adapter; its contract is the partition open
 * fails / spawn fails / success, covered by LP-M1-c).
 *
 * Fakes only at `deps.spawn`, `deps.procFacts`, `deps.kill`, the clock, and
 * (LP-M1-a only) one fs fault spy on `openSync`; LP-M1-b is the real-path
 * pairing with a real EACCES from `chmodSync(0o400)`.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { last, launchFixture, launcherText, logLines, MAIN, mode, NONCE, type Fixture } from "./support/launchHarness";
import { fakeSpawn } from "./support/launcherFakes";
import { app, liveRun, type Result } from "./support/intoRun";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run } from "../scripts/control/launch.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { spawnDirect } from "../scripts/control/launchProcess.mjs";

const DF = "verdict: driver failure — ";
const IS_ROOT = process.getuid?.() === 0;

let cleanups: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const c of cleanups) c();
  cleanups = [];
});

/** Pass-through `openSync` that throws `code` only for a path ending in `launcher-stderr.log`. */
function failStderrOpen(code: string) {
  const real = fs.openSync;
  vi.spyOn(fs, "openSync").mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => {
    if (String(p).endsWith("launcher-stderr.log")) throw Object.assign(new Error(`open ${code}`), { code });
    return (real as (...a: unknown[]) => number)(p, ...rest);
  }) as typeof fs.openSync);
}

describe("D82-WI-3 LP-M1-a: launch with a stderr log it cannot open", () => {
  it.each([
    { row: "direct exec", args: { file: "/tmp/f.md" } },
    { row: "--via open", args: { via: "open", file: "/tmp/f.md" } },
  ])("LP-M1-a $row: resolves to the pinned driver-failure verdict, releases the lock, spawns and signals nothing", async ({ args }) => {
    const fx: Fixture = launchFixture();
    cleanups.push(fx.cleanup);
    failStderrOpen("EACCES");
    const r: Result = await run(args, fx.deps);
    expect(r.exit).toBe(1);
    expect(last(fx.out)).toBe(`${DF}spawn failed: EACCES`);
    expect(fs.existsSync(path.join(fx.parent, ".lock"))).toBe(false);
    expect(fx.spawn.calls).toEqual([]);
    expect(fx.kill.calls).toEqual([]);
    expect(launcherText(fx)).not.toContain(NONCE);
  });
});

describe("D82-WI-3 LP-M1-b: --into with a real EACCES on R's stderr log", () => {
  it.skipIf(IS_ROOT)("LP-M1-b the pinned verdict; .lock, owner, instance and launch bytes unchanged; nothing spawned", async () => {
    const { fx, into, expectInert } = await liveRun(cleanups);
    expect(fs.existsSync(fx.lay.stderrLog)).toBe(true);
    const logBytes = fs.readFileSync(fx.lay.stderrLog);
    fs.chmodSync(fx.lay.stderrLog, 0o400);
    const { r, second } = await into(app(fx, []), { file: "/tmp/f.md" });
    expect(r.exit).toBe(1);
    expect(last(fx.out)).toBe(`${DF}spawn failed: EACCES`);
    expect(second.calls).toEqual([]);
    expectInert(second);
    expect(mode(fx.lay.stderrLog)).toBe(0o400);
    expect(fs.readFileSync(fx.lay.stderrLog)).toEqual(logBytes);
    const intoRecs = logLines(fx.lay.runDir).filter((e) => e.event === "launcher.into") as Record<string, unknown>[];
    expect(intoRecs.at(-1)).toMatchObject({ phase: "result", outcome: "spawn failed: EACCES" });
    expect(launcherText(fx)).not.toContain(NONCE);
  });
});

describe("D82-WI-3 LP-M1-c: spawnDirect partitions on the stderr log", () => {
  const tmp = () => {
    const dir = fs.mkdtempSync("/tmp/lpm1");
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
  };
  const attempt = (stderrLog: string) => {
    const spawn = fakeSpawn(() => {});
    const realClose = fs.closeSync;
    let closes = 0;
    vi.spyOn(fs, "closeSync").mockImplementation(((fd: number) => {
      closes += 1;
      realClose(fd);
    }) as typeof fs.closeSync);
    // a throw is captured as its code, so "returns instead of throwing" is an L1 claim on the value
    let res: unknown;
    try {
      res = spawnDirect({ spawn, mainBinary: MAIN }, { stderrLog, file: "/tmp/f.md", env: {} });
    } catch (e) {
      res = { threw: e instanceof Error && "code" in e ? String(e.code) : String(e) };
    } finally {
      vi.restoreAllMocks();
    }
    return { res, spawns: spawn.calls.length, closes };
  };

  it("LP-M1-c (i) a log in a missing directory: { failed: ENOENT }, no spawn, no close", () => {
    const { res, spawns, closes } = attempt(path.join(tmp(), "missing", "launcher-stderr.log"));
    expect({ res, spawns, closes }).toEqual({ res: { failed: "ENOENT" }, spawns: 0, closes: 0 });
  });

  it.skipIf(IS_ROOT)("LP-M1-c (ii) an existing 0o400 log: { failed: EACCES }, no spawn, no close", () => {
    const log = path.join(tmp(), "launcher-stderr.log");
    fs.writeFileSync(log, "");
    fs.chmodSync(log, 0o400);
    const { res, spawns, closes } = attempt(log);
    expect({ res, spawns, closes }).toEqual({ res: { failed: "EACCES" }, spawns: 0, closes: 0 });
  });

  it("LP-M1-c (iii) a writable path: a child, one spawn, one close, the log created at 0o600", () => {
    const log = path.join(tmp(), "launcher-stderr.log");
    const { res, spawns, closes } = attempt(log);
    expect(res).toHaveProperty("child");
    expect(res).not.toHaveProperty("failed");
    expect({ spawns, closes }).toEqual({ spawns: 1, closes: 1 });
    expect(mode(log)).toBe(0o600);
  });
});
