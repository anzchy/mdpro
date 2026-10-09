// @vitest-environment node
/**
 * ADR-0047 WI-003 WI-6: `launch --via open`, `launch --into <run>` (decision
 * D1) and the `process.env` invariant across every mode (LA-18).
 * Matrix: `.claude/tdd-guardian/tests-20261008-144444.md`, WI-6, LO-01, LO-02,
 * LI-01..LI-04, LA-18. Shared fixture: `tests/support/launchHarness.ts`.
 *
 * Laws pinned here: the launcher never signals a process it did not spawn
 * (`deps.kill` stays `[]` on every path); `--into` is read-only on run
 * identity (`treeSnapshot(R)`, `.lock` and the parent listing unchanged); a
 * run's nonce never reaches stdout, stderr or `launcher.jsonl`.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appPublishes,
  BUNDLE,
  ENV_KEYS,
  envGuard,
  fileState,
  GUARD,
  last,
  launchFixture,
  launcherText,
  logLines,
  LSTART,
  MAIN,
  NONCE,
  publish,
  treeSnapshot,
  type Fixture,
  type FixtureOpts,
} from "./support/launchHarness";
import { fakeProcFacts, fakeSpawn, type SpawnScript } from "./support/launcherFakes";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { HANDSHAKE_TIMEOUT_MS, run } from "../scripts/control/launch.mjs";

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
// WI-R3 (device Check D, 2026-10-09): exit 0 alone was a false pass; delivery is now required.
const openArgv = (runReal: string, nonce: string, file: string, newInstance = true) => [
  ...(newInstance ? ["-n"] : []),
  "--env",
  `MDPRO_VERIFY_RUN=${runReal}`,
  "--env",
  `MDPRO_VERIFY_NONCE=${nonce}`,
  "--env",
  `HOME=${runReal}`,
  "--env",
  `CFFIXED_USER_HOME=${runReal}`,
  "-a",
  BUNDLE,
  file,
];

/** `open` that exits 0 and whose app publishes pid 5151. */
const openPublishes: SpawnScript = (call, child) => {
  appPublishes({}, OPEN_PID)(call, child);
  child.exitSoon(0);
};
const openProcTable = (exe = MAIN) => ({
  pids: { [OPEN_PID]: { alive: true as const, lstart: LSTART, exe } },
});

const viaOpen = (fx: Fixture): Promise<Result> => run({ via: "open", file: "/tmp/f.md" }, fx.deps);

describe("WI-6 launch#run --via open", () => {
  it("LO-01 exact open argv with realpath --env values, then the cross-check", async () => {
    const fx = fixture({ script: openPublishes, procTable: openProcTable() });
    const check = envGuard();
    const r = await viaOpen(fx);
    expect(fx.spawn.calls).toHaveLength(1);
    expect(r.exit).toBe(0);
    const call = fx.spawn.calls[0];
    const lexicalRunDir = path.join(fx.home, "Library", "Application Support", "mdpro-verify", "runs", fx.name);
    const real = fs.realpathSync(lexicalRunDir);
    expect(call.cmd).toBe("open");
    expect(call.args).toEqual(openArgv(real, NONCE, "/tmp/f.md"));
    expect(real).not.toBe(lexicalRunDir);
    expect(real.startsWith(fx.real + path.sep)).toBe(true);
    for (const a of call.args) expect(a).not.toContain(fx.home);
    expect(call.opts.env).toBeUndefined();
    expect(JSON.parse(fs.readFileSync(fx.lay.ownerJson, "utf8")).pid).toBe(OPEN_PID);
    expect(fx.out.slice(-2)).toEqual([`ready: L1 run ${fx.name} pid ${OPEN_PID}`, "verdict: pass"]);
    expect(r.exit).toBe(0);
    expect(launcherText(fx)).not.toContain(NONCE);
    expect(fx.kill.calls).toEqual([]);
    check();
  });

  const ROWS: { row: number; script: SpawnScript; exe?: string; verdict: string }[] = [
    { row: 1, script: (_c, child) => child.exitSoon(1), verdict: `${DF}open exited 1` },
    { row: 2, script: (_c, child) => child.exitSoon(0), verdict: `${DF}handshake timeout after ${T} ms` },
    { row: 3, script: openPublishes, exe: "/other/tauri-app", verdict: `${DF}process facts: exe mismatch` },
    {
      row: 4,
      script: (call) => {
        throw Object.assign(new Error("spawn open ENOENT"), { code: "ENOENT", spawnargs: call.args });
      },
      verdict: `${DF}spawn failed: ENOENT`,
    },
  ];
  it.each(ROWS)("LO-02 row $row: --via open failures never kill and release the lock", async ({ script, exe, verdict }) => {
    const fx = fixture({ script, procTable: openProcTable(exe) });
    const check = envGuard();
    const r = await viaOpen(fx);
    expect(last(fx.out)).toBe(verdict);
    expect(r.exit).toBe(1);
    expect(fx.kill.calls).toEqual([]);
    expect(fx.spawn.calls[0].child.signals).toEqual([]);
    expect(fs.existsSync(lockPath(fx))).toBe(false);
    expect(fs.existsSync(fx.lay.launchJson)).toBe(true);
    expect(fs.existsSync(fx.lay.ownerJson)).toBe(false);
    expect(launcherText(fx)).not.toContain(NONCE);
    check();
  });
});

/** A live run R from an LA-01 launch; `into(...)` swaps in a second-process spawn fake. */
async function liveRun(o: FixtureOpts = {}) {
  const fx = fixture(o);
  const first = await run({ file: "/tmp/f.md" }, fx.deps);
  expect(first.exit).toBe(0);
  fx.out.length = 0;
  const firstCall = fx.spawn.calls[0];
  const snap = {
    tree: treeSnapshot(fx.lay.runDir),
    lock: fileState(lockPath(fx)),
    list: fs.readdirSync(fx.parent),
  };
  // WI-R3 (device Check D, 2026-10-09): exit 0 alone was a false pass; delivery is now required.
  const appOwned = (t: ReturnType<typeof treeSnapshot>) =>
    t.filter((e) => e.rel !== path.join(".mdpro", "mdpro.log")).map((e) => (e.rel === ".mdpro" ? { ...e, mtimeMs: 0 } : e));
  // WI-R3 (device Check D, 2026-10-09): exit 0 alone was a false pass; delivery is now required.
  const expectUnchanged = (appWroteLog = false) => {
    // WI-R3 (device Check D, 2026-10-09): exit 0 alone was a false pass; delivery is now required.
    if (appWroteLog) expect(appOwned(treeSnapshot(fx.lay.runDir))).toEqual(appOwned(snap.tree));
    else expect(treeSnapshot(fx.lay.runDir)).toEqual(snap.tree);
    expect(fileState(lockPath(fx))).toEqual(snap.lock);
    expect(fs.readdirSync(fx.parent)).toEqual(snap.list);
  };
  // WI-R3 (device Check D, 2026-10-09): exit 0 alone was a false pass; delivery is now required.
  const deliver = (source: string) => {
    fs.mkdirSync(path.dirname(fx.lay.appLog), { recursive: true });
    fs.appendFileSync(fx.lay.appLog, `${JSON.stringify({ event: "file.open.external", status: "success", context: { filePath: "/tmp/g.md", source } })}\n`);
  };
  const into = (script: SpawnScript, args: Record<string, unknown> = {}) => {
    const second = fakeSpawn(script, [6000]);
    fx.deps.spawn = second;
    return { second, result: run({ into: fx.name, file: "/tmp/g.md", ...args }, fx.deps) as Promise<Result> };
  };
  return { fx, firstCall, expectUnchanged, into, deliver };
}

describe("WI-6 launch#run --into <run> (D1)", () => {
  it("LI-01 direct exec into a live run: same env, exit 0, run identity untouched", async () => {
    const { fx, firstCall, expectUnchanged, into, deliver } = await liveRun();
    const check = envGuard();
    // WI-R3 (device Check D, 2026-10-09): exit 0 alone was a false pass; delivery is now required.
    const { second, result } = into((_c, child) => (deliver("single_instance"), child.exitSoon(0)));
    const r = await result;
    const env = second.calls[0].opts.env ?? {};
    for (const k of ENV_KEYS) expect(env[k], k).toBe(firstCall.opts.env?.[k]);
    expect([second.calls[0].cmd, second.calls[0].args]).toEqual([MAIN, ["/tmp/g.md"]]);
    // WI-R3 (device Check D, 2026-10-09): exit 0 alone was a false pass; delivery is now required.
    expect(fx.out.slice(-3)).toEqual([`into: run ${fx.name} second process exited 0`, `into: run ${fx.name} file delivered (source single_instance)`, "verdict: pass"]);
    expect(r.exit).toBe(0);
    // WI-R3 (device Check D, 2026-10-09): exit 0 alone was a false pass; delivery is now required.
    expectUnchanged(true);
    expect(fx.rng.draws()).toBe(2);
    expect(fx.kill.calls).toEqual([]);
    check();
  });

  const ROWS: { row: string; prep: (fx: Fixture) => void; verdict: string; name?: string }[] = [
    {
      row: "startTime differs",
      prep: (fx) => (fx.deps.procFacts = fakeProcFacts({ pids: { 4242: { alive: true, lstart: "Fri Oct  9 01:00:00 2026", exe: MAIN } } })),
      verdict: "verdict: fail — ownership: startTime",
    },
    {
      row: "pid dead",
      prep: (fx) => (fx.deps.procFacts = fakeProcFacts({ pids: { 4242: { alive: false, lstart: LSTART, exe: MAIN } } })),
      verdict: "verdict: fail — ownership: alive",
    },
    {
      row: "instance nonce differs",
      prep: (fx) => {
        fs.unlinkSync(fx.lay.instanceJson);
        publish(fx.lay.runDir, { nonce: "33".repeat(32), pid: 4242, buildId: "b1" });
      },
      verdict: "verdict: fail — ownership: nonce",
    },
    {
      row: "exe differs",
      prep: (fx) => (fx.deps.procFacts = fakeProcFacts({ pids: { 4242: { alive: true, lstart: LSTART, exe: "/other/tauri-app" } } })),
      verdict: "verdict: fail — ownership: exe",
    },
    {
      row: "instance pid 5151, owner pid 4242",
      prep: (fx) => {
        fs.unlinkSync(fx.lay.instanceJson);
        publish(fx.lay.runDir, { nonce: NONCE, pid: 5151, buildId: "b1" });
      },
      verdict: "verdict: fail — ownership: pid",
    },
    { row: "R does not exist", prep: () => {}, name: "z".repeat(25), verdict: "verdict: fail — into: run not found" },
    { row: "R = ../x", prep: () => {}, name: "../x", verdict: "verdict: fail — invalid run name" },
  ];
  it.each(ROWS)("LI-02 ownership failure refuses ($row)", async ({ prep, verdict, name }) => {
    const { fx, into } = await liveRun();
    prep(fx);
    const tree = treeSnapshot(fx.lay.runDir);
    const { second, result } = into((_c, child) => child.exitSoon(0), name ? { into: name } : {});
    const r = await result;
    expect(last(fx.out)).toBe(verdict);
    expect(r.exit).toBe(1);
    expect(second.calls).toHaveLength(0);
    expect(treeSnapshot(fx.lay.runDir)).toEqual(tree);
    expect(fx.kill.calls).toEqual([]);
  });

  it.each([
    { row: "exit 1", script: ((_c, child) => child.exitSoon(1)) as SpawnScript, verdict: "verdict: fail — second process exited 1" },
    {
      row: "exit 78 with a guard line",
      script: ((call, child) => {
        fs.writeSync(call.opts.stdio?.[2] as number, `${GUARD}instance.json already exists\n`);
        child.exitSoon(78);
      }) as SpawnScript,
      verdict: "verdict: fail — second process exited 78: guard refused: instance.json already exists",
    },
  ])("LI-03 second process non-zero exit is a fail ($row)", async ({ script, verdict }) => {
    const { fx, firstCall, expectUnchanged, into } = await liveRun();
    const check = envGuard();
    const { second, result } = into(script);
    const r = await result;
    expect(last(fx.out)).toBe(verdict);
    expect(r.exit).toBe(1);
    expect(fx.kill.calls).toEqual([]);
    expect(firstCall.child.signals).toEqual([]);
    expect(second.calls[0].child.signals).toEqual([]);
    expectUnchanged();
    check();
    const nonce = JSON.parse(fs.readFileSync(fx.lay.launchJson, "utf8")).nonce;
    expect(launcherText(fx)).not.toContain(nonce);
    for (const e of logLines(fx.lay.runDir)) expect(e.event.startsWith("launcher.")).toBe(true);
  });

  it.each([
    { row: "A", code: 0, verdict: "verdict: pass", exit: 0 },
    { row: "B", code: 1, verdict: "verdict: fail — second process exited 1", exit: 1 },
  ])("LI-04 row $row: --into --via open", async ({ code, verdict, exit }) => {
    const { fx, firstCall, expectUnchanged, into, deliver } = await liveRun();
    const check = envGuard();
    // WI-R3 (device Check D, 2026-10-09): exit 0 alone was a false pass; delivery is now required.
    const { second, result } = into((_c, child) => (code === 0 && deliver("finder"), child.exitSoon(code)), { via: "open" });
    const r = await result;
    const runReal = String(firstCall.opts.env?.MDPRO_VERIFY_RUN);
    expect(second.calls[0].cmd).toBe("open");
    // WI-R3 (device Check D, 2026-10-09): exit 0 alone was a false pass; delivery is now required.
    expect(second.calls[0].args).toEqual(openArgv(runReal, NONCE, "/tmp/g.md", false));
    expect(last(fx.out)).toBe(verdict);
    expect(r.exit).toBe(exit);
    expect(fx.kill.calls).toEqual([]);
    expect(second.calls[0].child.signals).toEqual([]);
    // WI-R3 (device Check D, 2026-10-09): exit 0 alone was a false pass; delivery is now required.
    expectUnchanged(code === 0);
    check();
    expect(launcherText(fx)).not.toContain(NONCE);
  });
});

describe("WI-6 launch: process.env invariant across every mode and outcome", () => {
  type Cell = { cell: string; go: () => Promise<unknown> };
  const plain = (o: FixtureOpts) => () => run({ file: "/tmp/f.md" }, fixture(o).deps);
  const open = (o: FixtureOpts) => () => run({ via: "open", file: "/tmp/f.md" }, fixture(o).deps);
  const intoCell = (prep: (fx: Fixture) => void, script: SpawnScript, args: Record<string, unknown> = {}) => async () => {
    const { fx, into } = await liveRun();
    prep(fx);
    return into(script, args).result;
  };
  const CELLS: Cell[] = [
    { cell: "plain success", go: plain({}) },
    { cell: "plain timeout", go: plain({ script: () => {} }) },
    { cell: "plain nonce mismatch", go: plain({ script: appPublishes({ nonce: "33".repeat(32) }) }) },
    { cell: "open success", go: open({ script: openPublishes, procTable: openProcTable() }) },
    ...ROWS_LO02().map((script, i) => ({
      cell: `open LO-02 row ${i + 1}`,
      go: open({ script, procTable: openProcTable(i === 2 ? "/other/tauri-app" : MAIN) }),
    })),
    { cell: "into success", go: intoCell(() => {}, (_c, child) => child.exitSoon(0)) },
    {
      cell: "into refusal (startTime)",
      go: intoCell(
        (fx) => (fx.deps.procFacts = fakeProcFacts({ pids: { 4242: { alive: true, lstart: "Fri Oct  9 01:00:00 2026", exe: MAIN } } })),
        (_c, child) => child.exitSoon(0),
      ),
    },
    { cell: "into second exit 1", go: intoCell(() => {}, (_c, child) => child.exitSoon(1)) },
    { cell: "into via open success", go: intoCell(() => {}, (_c, child) => child.exitSoon(0), { via: "open" }) },
    { cell: "into via open exit 1", go: intoCell(() => {}, (_c, child) => child.exitSoon(1), { via: "open" }) },
  ];
  it.each(CELLS)("LA-18 process.env identical before and after: $cell", async ({ go }) => {
    const check = envGuard();
    await go();
    check();
  });
});

/** The four LO-02 scripts, for LA-18. */
function ROWS_LO02(): SpawnScript[] {
  return [
    (_c, child) => child.exitSoon(1),
    (_c, child) => child.exitSoon(0),
    openPublishes,
    (call) => {
      throw Object.assign(new Error("spawn open ENOENT"), { code: "ENOENT", spawnargs: call.args });
    },
  ];
}
