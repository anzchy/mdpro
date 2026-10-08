// @vitest-environment node
/**
 * ADR-0047 WI-003 WI-9: the last stdout line of every verb is a verdict.
 * Matrix: `.claude/tdd-guardian/tests-20261008-144444.md`, RX-06.
 *
 * Each row rebuilds one outcome from its source case (DC-01, DC-02, LA-01,
 * LA-07, LA-12, LA-15, LA-17, LO-02, LI-03, LI-04, QU-01, QU-03, QU-08,
 * QU-09, CL-06, CL-08) with the same fakes, and checks only the law: the last
 * non-empty line matches the verdict grammar and the exit is 0 iff `pass`.
 * The exact verdict text stays pinned in the source rows' own files.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appPublishes, GUARD, launchFixture, LSTART, MAIN, passFacts, type Fixture, type FixtureOpts } from "./support/launchHarness";
import { fakeProcFacts, fakeSpawn, scriptedProcFacts, timedKill, type SpawnScript } from "./support/launcherFakes";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { evaluate } from "../scripts/control/doctorChecks.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run as launchRun } from "../scripts/control/launch.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run as quitRun } from "../scripts/control/quit.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run as cleanRun } from "../scripts/control/clean.mjs";

const VERDICT = /^verdict: (pass|fail|driver failure|NOT VERIFIED)( — .*)?$/;
const OPEN_PID = 5151;
type Outcome = { out: string[]; exit: number };
type Facts = Record<string, unknown>;

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

const doctorRow = (patch: (f: Facts) => void) => async (): Promise<Outcome> => {
  const f = passFacts();
  patch(f);
  const r = evaluate(f);
  return { out: r.lines, exit: r.exit };
};
const launchRow = (o: FixtureOpts, args: Record<string, unknown> = {}, prep: (fx: Fixture) => void = () => {}) => async () => {
  const fx = fixture(o);
  prep(fx);
  const r = await launchRun({ file: "/tmp/f.md", ...args }, fx.deps);
  return { out: fx.out, exit: r.exit };
};
const intoRow = (script: SpawnScript, args: Record<string, unknown> = {}) => async () => {
  const fx = fixture();
  expect((await launchRun({ file: "/tmp/f.md" }, fx.deps)).exit).toBe(0);
  fx.out.length = 0;
  fx.deps.spawn = fakeSpawn(script, [6000]);
  const r = await launchRun({ into: fx.name, file: "/tmp/g.md", ...args }, fx.deps);
  return { out: fx.out, exit: r.exit };
};
/** A launched run, then quit with pid 4242's facts from `timeline(elapsed, signals)`. */
const quitRow =
  (timeline: (t: number, s: string[]) => { alive: boolean | "unknown"; lstart?: string; exe?: string } | undefined, prep: (fx: Fixture) => void = () => {}) =>
  async () => {
    const fx = fixture();
    expect((await launchRun({ file: "/tmp/f.md" }, fx.deps)).exit).toBe(0);
    prep(fx);
    const out: string[] = [];
    const kill = timedKill(fx.clock.now);
    const t0 = fx.clock.now();
    const procFacts = scriptedProcFacts((pid) => (pid === 4242 ? timeline(fx.clock.now() - t0, kill.signalsTo(pid)) : undefined));
    const deps = { passwdHome: fx.home, procFacts, kill, now: fx.clock.now, sleep: fx.clock.sleep, out: (l: string) => out.push(l), err: (l: string) => out.push(l) };
    const r = await quitRun({ run: fx.name }, deps);
    return { out, exit: r.exit };
  };
const owned = (over = {}) => ({ alive: true as const, lstart: LSTART, exe: MAIN, ...over });
const rewrite = (file: string, over: Record<string, unknown>) =>
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), ...over }));
/** A launched run with no owner.json, then clean with pid 5151's liveness and the scan given. */
const cleanRow = (instance: boolean, alive: boolean | "unknown" | null, scan: number[] | "unknown", times = 1) => async () => {
  const fx = fixture();
  expect((await launchRun({ file: "/tmp/f.md" }, fx.deps)).exit).toBe(0);
  fs.unlinkSync(fx.lay.ownerJson);
  if (instance) rewrite(fx.lay.instanceJson, { pid: OPEN_PID });
  else fs.unlinkSync(fx.lay.instanceJson);
  const out: string[] = [];
  const procFacts = fakeProcFacts({ scan, ...(alive === null ? {} : { pids: { [OPEN_PID]: { alive } } }) });
  const deps = { passwdHome: fx.home, uid: process.getuid?.(), siSockPath: `/tmp/lsi-${process.pid}-absent.sock`, procFacts, out: (l: string) => out.push(l), err: (l: string) => out.push(l) };
  let r = { exit: -1 };
  for (let i = 0; i < times; i++) r = await cleanRun({ run: fx.name }, deps);
  return { out, exit: r.exit };
};

const openOk: SpawnScript = (call, child) => {
  appPublishes({}, OPEN_PID)(call, child);
  child.exitSoon(0);
};
const openTable = (exe = MAIN) => ({ pids: { [OPEN_PID]: { alive: true as const, lstart: LSTART, exe } } });
const throwing = (spawnargs: boolean): SpawnScript => (call) => {
  throw Object.assign(new Error("spawn ENOENT"), { code: "ENOENT", ...(spawnargs ? { spawnargs: call.args } : {}) });
};
const lockAt = (body: string) => (fx: Fixture) => {
  fs.mkdirSync(fx.parent, { recursive: true });
  fs.writeFileSync(path.join(fx.parent, ".lock"), body);
};

const ROWS: [string, () => Promise<Outcome>][] = [
  ["DC-01", doctorRow(() => {})],
  ["DC-02 bundle absent", doctorRow((f) => (f.bundlePresent = false))],
  ["DC-02 manifest missing", doctorRow((f) => (f.manifest = { ok: false, why: "missing" }))],
  ["DC-02 manifest not JSON", doctorRow((f) => (f.manifest = { ok: false, why: "not valid JSON" }))],
  ["DC-02 buildId unknown", doctorRow((f) => (f.manifest = { ok: true, buildId: "unknown", profile: "verify" }))],
  ["DC-02 profile release", doctorRow((f) => (f.manifest = { ok: true, buildId: "b1", profile: "release" }))],
  ["DC-02 sourceTree", doctorRow((f) => (f.sourceTreeMatches = false))],
  ["DC-02 lock live", doctorRow((f) => (f.lock = { state: "held", run: "r".repeat(25), live: true }))],
  ["DC-02 verify pid", doctorRow((f) => (f.verifyPids = [4242]))],
  ["DC-02 si.sock live", doctorRow((f) => (f.siSock = "live"))],
  ["LA-01", launchRow({})],
  ["LA-07", launchRow({ script: () => {} })],
  ["LA-12", launchRow({ realBytes: 23 })],
  ["LA-15 A", launchRow({}, {}, lockAt(JSON.stringify({ run: "a".repeat(25), nonceDigest: "99".repeat(32) })))],
  ["LA-15 B", launchRow({}, {}, lockAt("{"))],
  ["LA-17 A", launchRow({}, {}, (fx) => (fx.deps.buildId = ""))],
  ["LA-17 B", launchRow({ script: throwing(false) })],
  ["LA-17 C", launchRow({ script: (_c, child) => child.errorSoon("EACCES") })],
  ["LO-02 1", launchRow({ script: (_c, child) => child.exitSoon(1), procTable: openTable() }, { via: "open" })],
  ["LO-02 2", launchRow({ script: (_c, child) => child.exitSoon(0), procTable: openTable() }, { via: "open" })],
  ["LO-02 3", launchRow({ script: openOk, procTable: openTable("/other/tauri-app") }, { via: "open" })],
  ["LO-02 4", launchRow({ script: throwing(true), procTable: openTable() }, { via: "open" })],
  ["LI-03 exit 1", intoRow((_c, child) => child.exitSoon(1))],
  [
    "LI-03 exit 78",
    intoRow((call, child) => {
      fs.writeSync(call.opts.stdio?.[2] as number, `${GUARD}instance.json already exists\n`);
      child.exitSoon(78);
    }),
  ],
  ["LI-04 A", intoRow((_c, child) => child.exitSoon(0), { via: "open" })],
  ["LI-04 B", intoRow((_c, child) => child.exitSoon(1), { via: "open" })],
  ["QU-01 alive", quitRow(() => owned({ alive: false }))],
  ["QU-01 startTime", quitRow(() => owned({ lstart: "Thu Oct  8 14:44:45 2026" }))],
  ["QU-03", quitRow((_t, s) => owned({ alive: !s.includes("SIGTERM") }))],
  ["QU-08 A", quitRow(() => owned(), (fx) => rewrite(fx.lay.instanceJson, { pid: OPEN_PID }))],
  ["QU-09 A", quitRow((t) => owned({ lstart: t >= 100 ? "Fri Oct  9 08:00:00 2026" : LSTART }))],
  ["QU-09 C", quitRow((t) => owned({ lstart: t >= 100 ? "unknown" : LSTART }))],
  ["CL-06", cleanRow(true, false, [], 2)],
  ["CL-08 A", cleanRow(true, true, [])],
  ["CL-08 B", cleanRow(true, false, [OPEN_PID])],
  ["CL-08 C", cleanRow(true, false, [7777])],
  ["CL-08 D", cleanRow(true, false, "unknown")],
  ["CL-08 E", cleanRow(true, "unknown", [])],
  ["CL-08 F", cleanRow(true, false, [])],
  ["CL-08 G", cleanRow(false, null, [])],
  ["CL-08 H", cleanRow(false, null, "unknown")],
  ["CL-08 I", cleanRow(false, null, [7777])],
];

describe("WI-9 RX-06 the last stdout line is a verdict for every outcome", () => {
  it.each(ROWS)("%s", async (_id, go) => {
    const { out, exit } = await go();
    const lines = out.filter((l) => l.trim() !== "");
    const final = String(lines.at(-1));
    expect(final).toMatch(VERDICT);
    expect(exit === 0).toBe(final === "verdict: pass");
    expect([0, 1]).toContain(exit);
  });
});
