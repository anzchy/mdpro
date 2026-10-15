// @vitest-environment node
/**
 * ADR-0047 WI-003 review fix WI-R2: characterization of `launch` and
 * `launch --into` error paths that no earlier case reached (the WI-9 91%
 * per-file branch floor). Every case pins a verdict line, an exit code, a
 * file tree or lock bytes; none was red, they were written after the WI-R2
 * red record.
 * Matrix: `.claude/tdd-guardian/tests-20261008-144444.md`, "Round 4 changes
 * (review fixes, WI-R2)", LP-R1..LP-R8 and LI-R1..LI-R3.
 *
 * Shared fixture: `tests/support/launchHarness.ts`; fakes only at
 * `deps.spawn`, `deps.procFacts`, `deps.kill`, the clock and the RNG.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appPublishes,
  BUNDLE,
  callRun,
  fileState,
  last,
  launchFixture,
  logLines,
  LSTART,
  MAIN,
  publish,
  treeSnapshot,
  walk,
  type Fixture,
  type FixtureOpts,
} from "../support/launchHarness";
import { fakeProcFacts, fakeSpawn, type SpawnScript } from "../support/launcherFakes";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { HANDSHAKE_TIMEOUT_MS, run } from "../../scripts/control/launch.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { buildLayout } from "../../scripts/control/buildSteps.mjs";

type Result = { exit: number; lines: string[] };
const T: number = HANDSHAKE_TIMEOUT_MS;
const DF = "verdict: driver failure — ";
const OPEN_PID = 5151;

let fixtures: Fixture[] = [];
const fixture = (o: FixtureOpts = {}) => {
  const fx = launchFixture(o);
  fixtures.push(fx);
  return fx;
};
afterEach(() => {
  for (const fx of fixtures) fx.cleanup();
  fixtures = [];
});

const lockPath = (fx: Fixture) => path.join(fx.parent, ".lock");

/** The fixture's real home holds nothing a launch makes. */
const homeTree = (fx: Fixture) => walk(fx.real);

describe("WI-R2 launch: refusals before anything is created", () => {
  it("LP-R1 Library is a regular file: driver failure naming ENOTDIR, no lock, no run dir", async () => {
    const fx = fixture();
    fs.writeFileSync(path.join(fx.real, "Library"), "x");
    const r: Result = await run({ file: "/tmp/f.md" }, fx.deps);
    expect(last(fx.out).startsWith(`${DF}ENOTDIR`)).toBe(true);
    expect(r.exit).toBe(1);
    expect(homeTree(fx)).toEqual(["Library"]);
    expect(fx.spawn.calls).toHaveLength(0);
  });

  it("LP-R2 the doctor facts throw a non-Error: driver failure with its text, nothing created", async () => {
    const fx = fixture();
    fx.deps.collectDoctorFacts = async () => {
      throw "boom";
    };
    const r: Result = await run({ file: "/tmp/f.md" }, fx.deps);
    expect(fx.out).toEqual([`${DF}doctor facts unavailable: boom`]);
    expect(r.exit).toBe(1);
    expect(homeTree(fx)).toEqual([]);
    expect(fx.rng.draws()).toBe(0);
  });

  it("LP-R4 an unknown --via: fail naming it, nothing created, no draw", async () => {
    const fx = fixture();
    const r: Result = await run({ via: "smoke", file: "/tmp/f.md" }, fx.deps);
    expect(fx.out).toEqual(["verdict: fail — unknown --via smoke"]);
    expect(r.exit).toBe(1);
    expect(homeTree(fx)).toEqual([]);
    expect(fx.rng.draws()).toBe(0);
    expect(fx.spawn.calls).toHaveLength(0);
  });
});

describe("WI-R2 launch: defaults and failures after the run dir exists", () => {
  it("LP-R3 no deps.mainBinary / deps.buildId: the verify bundle's binary and the manifest's buildId", async () => {
    const fx = fixture();
    const main: string = buildLayout(fx.real, "verify").mainBinary;
    fx.deps.procFacts = fakeProcFacts({ pids: { 4242: { alive: true, lstart: LSTART, exe: main } } });
    delete fx.deps.mainBinary;
    delete fx.deps.buildId;
    const r: Result = await run({ file: "/tmp/f.md" }, fx.deps);
    expect(fx.out.slice(-2)).toEqual([`ready: L1 run ${fx.name} pid 4242`, "verdict: pass"]);
    expect(r.exit).toBe(0);
    expect(fx.spawn.calls[0].cmd).toBe(main);
    expect(JSON.parse(fs.readFileSync(fx.lay.launchJson, "utf8"))).toMatchObject({ buildId: "b1", mainBinary: main });
    expect(JSON.parse(fs.readFileSync(fx.lay.ownerJson, "utf8"))).toEqual({ pid: 4242, startTime: LSTART, exeRealpath: main });
  });

  it("LP-R5 owner.json already exists at the cross-check: driver failure, child SIGKILLed, lock released, run dir kept", async () => {
    const script: SpawnScript = (call, child) => {
      appPublishes()(call, child);
      fs.writeFileSync(path.join(callRun(call).run, "owner.json"), "{}");
    };
    const fx = fixture({ script });
    const r: Result = await run({ file: "/tmp/f.md" }, fx.deps);
    expect(last(fx.out).startsWith(`${DF}owner.json: EEXIST`)).toBe(true);
    expect(r.exit).toBe(1);
    expect(fx.spawn.calls[0].child.signals).toEqual(["SIGKILL"]);
    expect(fx.kill.calls).toEqual([]);
    expect(fs.existsSync(lockPath(fx))).toBe(false);
    expect(fs.readFileSync(fx.lay.ownerJson, "utf8")).toBe("{}");
    expect(fs.existsSync(fx.lay.launchJson)).toBe(true);
  });

  const exitBySignal: SpawnScript = (_c, child) => {
    process.nextTick(() => child.emit("exit", null, "SIGTERM"));
  };
  const publishRaw =
    (body: string): SpawnScript =>
    (call) =>
      publish(callRun(call).run, body);
  const ROWS: { row: string; o: FixtureOpts; verdict: string; signals: string[] }[] = [
    { row: "child exits by SIGTERM", o: { script: exitBySignal }, verdict: `${DF}child exited SIGTERM before handshake`, signals: [] },
    {
      row: "instance.json is a directory",
      o: { script: (call) => fs.mkdirSync(path.join(callRun(call).run, "instance.json")) },
      verdict: `${DF}instance.json unreadable`,
      signals: ["SIGKILL"],
    },
    { row: "instance.json is null", o: { script: publishRaw("null") }, verdict: `${DF}instance.json unreadable`, signals: ["SIGKILL"] },
    { row: "instance.json is 5", o: { script: publishRaw("5") }, verdict: `${DF}instance.json unreadable`, signals: ["SIGKILL"] },
    {
      row: "exe unknown",
      o: { procTable: { pids: { 4242: { alive: true, lstart: LSTART } } } },
      verdict: `${DF}process facts: exe unknown`,
      signals: ["SIGKILL"],
    },
  ];
  it.each(ROWS)("LP-R6 $row: driver failure, lock released", async ({ o, verdict, signals }) => {
    const fx = fixture(o);
    const r: Result = await run({ file: "/tmp/f.md" }, fx.deps);
    expect(last(fx.out)).toBe(verdict);
    expect(r.exit).toBe(1);
    expect(fx.spawn.calls[0].child.signals).toEqual(signals);
    expect(fx.kill.calls).toEqual([]);
    expect(fs.existsSync(lockPath(fx))).toBe(false);
    expect(fs.existsSync(fx.lay.ownerJson)).toBe(false);
  });

  it("LP-R7 no file and no mainBinaryArgs: spawn args [], pass; --via open with no file ends at -a <bundle>", async () => {
    const fx = fixture();
    fx.deps.mainBinaryArgs = undefined;
    const r: Result = await run({}, fx.deps);
    expect(fx.spawn.calls[0].args).toEqual([]);
    expect(last(fx.out)).toBe("verdict: pass");
    expect(r.exit).toBe(0);

    const open: SpawnScript = (call, child) => {
      appPublishes({}, OPEN_PID)(call, child);
      child.exitSoon(0);
    };
    const fo = fixture({ script: open, procTable: { pids: { [OPEN_PID]: { alive: true, lstart: LSTART, exe: MAIN } } } });
    const ro: Result = await run({ via: "open" }, fo.deps);
    expect(fo.spawn.calls[0].args.slice(-2)).toEqual(["-a", BUNDLE]);
    expect(last(fo.out)).toBe("verdict: pass");
    expect(ro.exit).toBe(0);
  });

  const THROWS: { row: string; err: unknown }[] = [
    { row: "no code", err: new Error("spawn failed oddly") },
    { row: "numeric code", err: Object.assign(new Error("spawn 7"), { code: 7 }) },
    { row: "empty code", err: Object.assign(new Error("spawn"), { code: "" }) },
  ];
  it.each(THROWS)("LP-R8 spawn throws with $row: driver failure `spawn failed: error`, lock released", async ({ err }) => {
    const fx = fixture({
      script: () => {
        throw err;
      },
    });
    const r: Result = await run({ file: "/tmp/f.md" }, fx.deps);
    expect(last(fx.out)).toBe(`${DF}spawn failed: error`);
    expect(r.exit).toBe(1);
    expect(fs.existsSync(lockPath(fx))).toBe(false);
  });
});

/** A live run from a real launch; `into(script)` runs `--into` with a fresh second-process spawn. */
async function liveRun() {
  const fx = fixture();
  const first: Result = await run({ file: "/tmp/f.md" }, fx.deps);
  expect(first.exit).toBe(0);
  fx.out.length = 0;
  const into = (script: SpawnScript, args: Record<string, unknown> = {}) => {
    const second = fakeSpawn(script, [6000]);
    fx.deps.spawn = second;
    return { second, result: run({ into: fx.name, file: "/tmp/g.md", ...args }, fx.deps) as Promise<Result> };
  };
  return { fx, into };
}

describe("WI-R2 launch --into: refusals and second-process failures", () => {
  it("LI-R1 owner.json and launch.json gone: every ownership fact fails, nothing spawned", async () => {
    const { fx, into } = await liveRun();
    fs.unlinkSync(fx.lay.ownerJson);
    fs.unlinkSync(fx.lay.launchJson);
    const tree = treeSnapshot(fx.lay.runDir);
    const { second, result } = into((_c, child) => child.exitSoon(0));
    const r = await result;
    expect(last(fx.out)).toBe("verdict: fail — ownership: nonce, pid, alive, startTime, exe");
    expect(r.exit).toBe(1);
    expect(second.calls).toHaveLength(0);
    expect(treeSnapshot(fx.lay.runDir)).toEqual(tree);
  });

  const SPAWN_FAILS: { row: string; script: SpawnScript; code: string }[] = [
    {
      row: "spawn throws ENOENT",
      script: () => {
        throw Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
      },
      code: "ENOENT",
    },
    { row: "child emits error EACCES", script: (_c, child) => child.errorSoon("EACCES"), code: "EACCES" },
  ];
  it.each(SPAWN_FAILS)("LI-R2 $row: driver failure naming the code, logged, lock unchanged", async ({ script, code }) => {
    const { fx, into } = await liveRun();
    const lock = fileState(lockPath(fx));
    const { result } = into(script);
    const r = await result;
    expect(last(fx.out)).toBe(`${DF}spawn failed: ${code}`);
    expect(r.exit).toBe(1);
    expect(logLines(fx.lay.runDir).at(-1)).toMatchObject({ event: "launcher.into", phase: "result", outcome: `spawn failed: ${code}` });
    expect(fileState(lockPath(fx))).toEqual(lock);
    expect(fx.kill.calls).toEqual([]);
  });

  it.each([
    { via: undefined, signals: ["SIGKILL"] },
    { via: "open", signals: [] },
  ])("LI-R3 the second process never exits (via $via): timeout; only a direct child is SIGKILLed", async ({ via, signals }) => {
    const { fx, into } = await liveRun();
    const lock = fileState(lockPath(fx));
    const { second, result } = into(() => {}, via ? { via } : {});
    const r = await result;
    expect(last(fx.out)).toBe(`${DF}second process timeout after ${T} ms`);
    expect(r.exit).toBe(1);
    expect(second.calls[0].child.signals).toEqual(signals);
    expect(fx.kill.calls).toEqual([]);
    expect(fileState(lockPath(fx))).toEqual(lock);
  });
});
