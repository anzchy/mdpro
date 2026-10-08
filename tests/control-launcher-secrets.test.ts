// @vitest-environment node
/**
 * ADR-0047 WI-003 WI-9: no secret on any failure path, and no write outside a
 * run dir. Matrix: `.claude/tdd-guardian/tests-20261008-144444.md`, RX-08 and
 * RX-09 ("Unit: launcherLog#append").
 *
 * RX-08 drives the real failure paths (spawn, procFacts faked as in their
 * source rows) over 50 seeded nonces: the nonce never reaches stdout, stderr
 * or `launcher.jsonl`. RX-09 stubs HOME and TMPDIR to fresh empty dirs and
 * moves the cwd to a third; every verb, with and without a run dir, leaves all
 * three empty. Fixtures are made before the stubs, with literal `/tmp` paths.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appPublishes,
  GUARD,
  last,
  launchFixture,
  launcherText,
  logLines,
  LSTART,
  MAIN,
  passFacts,
  sha256,
  walk,
  type Fixture,
  type FixtureOpts,
} from "./support/launchHarness";
import { fakeProcFacts, fakeSpawn, scriptedProcFacts, timedKill, type SpawnScript } from "./support/launcherFakes";
import { bytes, mulberry32 } from "./support/seededRandom";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run as launchRun } from "../scripts/control/launch.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run as quitRun } from "../scripts/control/quit.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run as cleanRun } from "../scripts/control/clean.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { collectFacts, run as doctorRun } from "../scripts/control/doctor.mjs";

type Result = { exit: number; lines: string[] };
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

const openTable = { pids: { [OPEN_PID]: { alive: true as const, lstart: LSTART, exe: MAIN } } };
const throwWithArgv: SpawnScript = (call) => {
  throw Object.assign(new Error("spawn open ENOENT"), { code: "ENOENT", spawnargs: call.args });
};

/** A launched run R; `into` swaps in a second-process spawn and calls `--into R`. */
async function intoRun(nonceBytes: Uint8Array, script: SpawnScript, args: Record<string, unknown> = {}) {
  const fx = fixture({ nonceBytes });
  expect((await launchRun({ file: "/tmp/f.md" }, fx.deps)).exit).toBe(0);
  fx.deps.spawn = fakeSpawn(script, [6000]);
  await launchRun({ into: fx.name, file: "/tmp/g.md", ...args }, fx.deps);
  return fx;
}

type Path = { id: string; go: (nb: Uint8Array) => Promise<Fixture>; verdict: string };
const plain = (o: FixtureOpts, args: Record<string, unknown>) => async (nonceBytes: Uint8Array) => {
  const fx = fixture({ ...o, nonceBytes });
  await launchRun({ file: "/tmp/f.md", ...args }, fx.deps);
  return fx;
};
const PATHS: Path[] = [
  { id: "LO-02 row 1", go: plain({ script: (_c, child) => child.exitSoon(1), procTable: openTable }, { via: "open" }), verdict: "verdict: driver failure — open exited 1" },
  { id: "LO-02 row 4", go: plain({ script: throwWithArgv, procTable: openTable }, { via: "open" }), verdict: "verdict: driver failure — spawn failed: ENOENT" },
  { id: "LA-10 nonce", go: plain({ script: appPublishes({ nonce: "33".repeat(32) }) }, {}), verdict: "verdict: driver failure — handshake mismatch: nonce" },
  {
    id: "LA-17 row B",
    go: plain({ script: () => { throw Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }); } }, {}),
    verdict: "verdict: driver failure — spawn failed: ENOENT",
  },
  { id: "LI-03 exit 1", go: (nb) => intoRun(nb, (_c, child) => child.exitSoon(1)), verdict: "verdict: fail — second process exited 1" },
  {
    id: "LI-03 exit 78",
    go: (nb) =>
      intoRun(nb, (call, child) => {
        fs.writeSync(call.opts.stdio?.[2] as number, `${GUARD}instance.json already exists\n`);
        child.exitSoon(78);
      }),
    verdict: "verdict: fail — second process exited 78: guard refused: instance.json already exists",
  },
  { id: "LI-04 row B", go: (nb) => intoRun(nb, (_c, child) => child.exitSoon(1), { via: "open" }), verdict: "verdict: fail — second process exited 1" },
];

describe("WI-9 RX-08 no secret on a failure path (50 nonces, seed 2026100811)", () => {
  it.each(PATHS)("$id", async ({ go, verdict }) => {
    const r = mulberry32(2026100811);
    for (let i = 0; i < 50; i++) {
      const nb = bytes(r, 32);
      const nonce = Buffer.from(nb).toString("hex");
      const fx = await go(nb);
      expect(JSON.parse(fs.readFileSync(fx.lay.launchJson, "utf8")).nonce).toBe(nonce);
      expect(last(fx.out)).toBe(verdict);
      expect(launcherText(fx)).not.toContain(nonce);
      for (const e of logLines(fx.lay.runDir)) expect(e.event.startsWith("launcher.")).toBe(true);
      fx.cleanup();
      fixtures = fixtures.filter((f) => f !== fx);
    }
  });
});

/** Every entry under `root` with its bytes digest: the RX-09 "nothing changed" snapshot. */
const snapshot = (root: string) =>
  walk(root).map((rel) => {
    const st = fs.lstatSync(path.join(root, rel));
    return { rel, kind: st.isDirectory() ? "d" : "f", bytes: st.isFile() ? sha256(fs.readFileSync(path.join(root, rel), "latin1")) : null };
  });

describe("WI-9 RX-09 nothing written outside a run dir, nothing at all without one", () => {
  let pool: { plain: Fixture; over: Fixture; raced: Fixture; refused: Fixture };
  let stubbed: { home: string; tmp: string; cwd: string };
  let savedCwd = "";
  beforeEach(() => {
    // Fixtures first, with literal /tmp prefixes, before anything is stubbed.
    pool = { plain: fixture(), over: fixture({ realBytes: 23 }), raced: fixture(), refused: fixture({ procTable: { scan: [4242] } }) };
  });
  beforeEach(() => {
    stubbed = { home: fs.mkdtempSync("/tmp/rh-"), tmp: fs.mkdtempSync("/tmp/rt-"), cwd: fs.mkdtempSync("/tmp/rc-") };
    vi.stubEnv("HOME", stubbed.home);
    vi.stubEnv("TMPDIR", stubbed.tmp);
    savedCwd = process.cwd();
    process.chdir(stubbed.cwd);
    expect(os.tmpdir()).toBe(stubbed.tmp);
    expect(fs.realpathSync(process.cwd())).toBe(fs.realpathSync(stubbed.cwd));
  });
  afterEach(() => {
    try {
      process.chdir(savedCwd);
    } finally {
      vi.unstubAllEnvs();
      for (const d of Object.values(stubbed)) fs.rmSync(d, { recursive: true, force: true });
    }
  });

  const expectStubsEmpty = () => {
    expect(fs.readdirSync(stubbed.home)).toEqual([]);
    expect(fs.readdirSync(stubbed.tmp)).toEqual([]);
    expect(fs.readdirSync(stubbed.cwd)).toEqual([]);
  };
  /** A step that creates no run dir: real tree unchanged, output on stdout or stderr. */
  async function noRunDir(fx: Fixture, step: () => Promise<Result>, verdict: string) {
    const before = snapshot(fx.real);
    const r = await step();
    expect(last(fx.out)).toBe(verdict);
    expect(r.exit).toBe(1);
    expect(snapshot(fx.real)).toEqual(before);
    expectStubsEmpty();
  }
  const quitDeps = (fx: Fixture) => {
    const kill = timedKill(fx.clock.now);
    const procFacts = scriptedProcFacts((pid) =>
      pid === 4242 ? { alive: !kill.signalsTo(pid).includes("SIGTERM"), lstart: LSTART, exe: MAIN } : undefined,
    );
    return { passwdHome: fx.home, procFacts, kill, now: fx.clock.now, sleep: fx.clock.sleep, out: fx.deps.out, err: fx.deps.err };
  };
  const cleanDeps = (fx: Fixture) => ({
    passwdHome: fx.home,
    uid: process.getuid?.(),
    siSockPath: `/tmp/lsi-${process.pid}-absent.sock`,
    procFacts: fakeProcFacts({ scan: [] }),
    out: fx.deps.out,
    err: fx.deps.err,
  });

  it("doctor with DC-01 facts", async () => {
    const fx = pool.plain;
    const before = snapshot(fx.real);
    const r = await doctorRun({}, { passwdHome: fx.home, repoRoot: fx.real, collectFacts: async () => passFacts(), out: fx.deps.out });
    expect(last(fx.out)).toBe("verdict: pass");
    expect(r.exit).toBe(0);
    expect(snapshot(fx.real)).toEqual(before);
    expectStubsEmpty();
  });

  it("launch refused by doctor (LA-05 row 3)", async () => {
    const fx = pool.refused;
    fx.deps.collectDoctorFacts = async (d: unknown) => ({
      ...(await collectFacts(d)),
      bundlePresent: true,
      manifest: { ok: true, buildId: "b1", profile: "verify" },
      sourceTreeMatches: true,
    });
    await noRunDir(fx, () => launchRun({ file: "/tmp/f.md" }, fx.deps), "verdict: fail");
  });

  it("launch refused by the budget (LA-12)", async () => {
    const fx = pool.over;
    await noRunDir(fx, () => launchRun({ file: "/tmp/f.md" }, fx.deps), "verdict: fail — run path budget exceeded: 104 > 103 bytes");
  });

  it("launch losing the acquire race (LA-15 row A)", async () => {
    const fx = pool.raced;
    fs.mkdirSync(fx.parent, { recursive: true });
    fs.writeFileSync(path.join(fx.parent, ".lock"), JSON.stringify({ run: "a".repeat(25), nonceDigest: "99".repeat(32) }));
    await noRunDir(fx, () => launchRun({ file: "/tmp/f.md" }, fx.deps), `verdict: driver failure — lock held by run ${"a".repeat(25)}`);
  });

  it("quit with no run named and no lock (QU-06 b)", async () => {
    const fx = pool.plain;
    await noRunDir(fx, () => quitRun({}, quitDeps(fx)), "verdict: fail — no run named and no lock");
  });

  it("clean ../x (CL-07)", async () => {
    const fx = pool.plain;
    await noRunDir(fx, () => cleanRun({ run: "../x" }, cleanDeps(fx)), "verdict: fail — invalid run name");
  });

  it("the full LA-01 → QU-03 → CL-01 cycle writes only under <parent>/<R> and <parent>/.lock", async () => {
    const fx = pool.plain;
    const runsRel = path.relative(fx.real, fx.parent);
    const tree = new Set<string>();
    for (let p = runsRel; p !== "."; p = path.dirname(p)) tree.add(p);
    const inside = (rel: string) =>
      tree.has(rel) || rel === path.join(runsRel, ".lock") || rel === path.join(runsRel, fx.name) || rel.startsWith(path.join(runsRel, fx.name) + path.sep);

    expect((await launchRun({ file: "/tmp/f.md" }, fx.deps)).exit).toBe(0);
    expect(walk(fx.real).filter((rel) => !inside(rel))).toEqual([]);
    expectStubsEmpty();
    expect((await quitRun({ run: fx.name }, quitDeps(fx))).exit).toBe(0);
    expect(walk(fx.real).filter((rel) => !inside(rel))).toEqual([]);
    expectStubsEmpty();
    expect((await cleanRun({ run: fx.name }, cleanDeps(fx))).exit).toBe(0);
    expect(walk(fx.real).filter((rel) => !inside(rel))).toEqual([]);
    expectStubsEmpty();
  });
});
