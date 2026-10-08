// @vitest-environment node
/**
 * ADR-0047 WI-003 WI-6: `launch` — `parseGuardReason` (pure) and the plain
 * direct-exec driver `run(args, deps)`.
 * Matrix: `.claude/tdd-guardian/tests-20261008-144444.md`, WI-6, LG-01..LG-03
 * and LA-01..LA-17. `--via open`, `--into` and LA-18 live in
 * `control-launcher-launch-modes.test.ts`; LA-INT in the `.slow` sibling.
 *
 * Real fs under a `makeHome()` home; spawn, procFacts, kill, clock and (where
 * a case says so) doctor facts are faked at the boundary. Verdict lines are
 * pinned as literals, never imported.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appPublishes,
  envGuard,
  expectedTotal,
  fileState,
  GUARD,
  last,
  launchFixture,
  launcherText,
  logLines,
  LSTART,
  MAIN,
  mode,
  NONCE,
  passFacts,
  publish,
  sha256,
  walk,
  type Fixture,
  type FixtureOpts,
} from "./support/launchHarness";
import { fakeProcFacts } from "./support/launcherFakes";
import { bytes, int, mulberry32, pick, str } from "./support/seededRandom";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { HANDSHAKE_TIMEOUT_MS, POLL_MS, parseGuardReason, run } from "../scripts/control/launch.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { checkBudget, SOCKET_PATH_BUDGET } from "../scripts/control/runDir.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { buildPreferences } from "../scripts/control/preset.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { collectFacts } from "../scripts/control/doctor.mjs";

type Result = { exit: number; lines: string[] };
const T: number = HANDSHAKE_TIMEOUT_MS;
const P: number = POLL_MS;
const DF = "verdict: driver failure — ";

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

const launch = (fx: Fixture, args: Record<string, unknown> = { file: "/tmp/f.md" }): Promise<Result> =>
  run(args, fx.deps);
const lockPath = (fx: Fixture) => path.join(fx.parent, ".lock");
const handle = (fx: Fixture, i = 0) => fx.spawn.calls[i].child;

/** The failure postcondition shared by every after-acquire failure. */
function expectReleasedAndKept(fx: Fixture) {
  expect(fs.existsSync(lockPath(fx))).toBe(false);
  expect(fs.existsSync(fx.lay.launchJson)).toBe(true);
  expect(fs.existsSync(fx.lay.ownerJson)).toBe(false);
  expect(fx.kill.calls).toEqual([]);
}

describe("WI-6 launch#parseGuardReason (pure)", () => {
  it("LG-01 debug echo, release-only, none", () => {
    expect(
      parseGuardReason(
        `{"event":"app.launch","level":"info"}\n{"event":"verify_run.guard"}\n${GUARD}instance.json already exists\n`,
      ),
    ).toBe("instance.json already exists");
    expect(parseGuardReason(`${GUARD}HOME is not canonical`)).toBe("HOME is not canonical");
    expect(parseGuardReason("thread 'main' panicked\n")).toBe("unknown");
    expect(parseGuardReason("")).toBe("unknown");
  });

  it("LG-02 last guard line wins; prefix must start the line; empty reason is unknown", () => {
    expect(parseGuardReason(`${GUARD}A\nlog\n${GUARD}B\r\n`)).toBe("B");
    expect(parseGuardReason(`x ${GUARD}C\n`)).toBe("unknown");
    expect(parseGuardReason(`${GUARD}\n`)).toBe("unknown");
  });

  it("LG-03 noise insertion never changes the reason (seed 2026100807)", () => {
    const r = mulberry32(2026100807);
    for (let i = 0; i < 300; i++) {
      const reason = str(r, "abcdefghijklmnopqrstuvwxyz", 1, 1) + str(r, "abcdefghijklmnopqrstuvwxyz ", 0, 39);
      const before = Array.from({ length: int(r, 0, 10) }, (_, k) => JSON.stringify({ event: `app.e${k}`, n: int(r, 0, 99) }));
      const after = Array.from({ length: int(r, 0, 3) }, () => pick(r, ["log line", "", "  panicked", "{}"]));
      const eol = pick(r, ["", "\n", "\r\n"]);
      const noisy = [...before, `${GUARD}${reason}`, ...after].join(pick(r, ["\n", "\r\n"])) + eol;
      expect(parseGuardReason(noisy), noisy).toBe(reason.trim());
    }
  });
});

describe("WI-6 launch#run direct exec: success and spawn-time state", () => {
  it("LA-01 happy path reaches L1 (budget boundary, draws, files, argv, no signals)", async () => {
    const fx = fixture();
    expect(Buffer.byteLength(fx.real)).toBe(22);
    const r = await launch(fx);
    expect(r.exit).toBe(0);
    expect(fx.out.slice(-2)).toEqual([`ready: L1 run ${fx.name} pid 4242`, "verdict: pass"]);
    expect(fx.name).toMatch(/^[0-9a-z]{25}$/);
    expect(fs.readdirSync(fx.parent).sort()).toEqual([".lock", fx.name]);
    expect(mode(fx.lay.runDir)).toBe(0o700);
    for (const rel of ["Library", "Library/Application Support", "Library/Application Support/mdpro-verify", "Library/Application Support/mdpro-verify/runs"]) {
      expect(mode(path.join(fx.real, rel)), rel).toBe(0o700);
    }
    expect(mode(fx.lay.launchJson)).toBe(0o600);
    expect(JSON.parse(fs.readFileSync(fx.lay.launchJson, "utf8"))).toEqual({ nonce: NONCE, buildId: "b1", mainBinary: MAIN });
    expect(JSON.parse(fs.readFileSync(fx.lay.prefs, "utf8"))).toEqual(buildPreferences({ viewMode: "source" }));
    expect(mode(fx.lay.ownerJson)).toBe(0o600);
    expect(JSON.parse(fs.readFileSync(fx.lay.ownerJson, "utf8"))).toEqual({ pid: 4242, startTime: LSTART, exeRealpath: MAIN });
    expect(JSON.parse(fs.readFileSync(lockPath(fx), "utf8"))).toEqual({ run: fx.name, nonceDigest: sha256(NONCE) });
    const call = fx.spawn.calls[0];
    expect([call.cmd, call.args]).toEqual([MAIN, ["/tmp/f.md"]]);
    expect(call.opts.detached).toBe(true);
    expect(typeof call.opts.stdio?.[2]).toBe("number");
    expect(fs.existsSync(fx.lay.stderrLog)).toBe(true);
    const runEnv = String(call.opts.env?.MDPRO_VERIFY_RUN);
    expect(Buffer.byteLength(path.join(runEnv, "ctl.sock"))).toBe(expectedTotal(fx.home));
    expect(expectedTotal(fx.home)).toBe(SOCKET_PATH_BUDGET);
    expect(fx.kill.calls).toEqual([]);
    expect(handle(fx).signals).toEqual([]);
    expect(fx.rng.draws()).toBe(2);
    expect(fx.out.join("\n")).not.toContain(NONCE);
    const events = logLines(fx.lay.runDir);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(e.event.startsWith("launcher.")).toBe(true);
    expect(events.map((e) => e.event)).toContain("launcher.launch");
    expect(launcherText(fx)).not.toContain(NONCE);
  });

  it("LA-02 instance.json absent when spawn is called; launch.json and prefs present", async () => {
    const fx = fixture({
      script: (call, child) => {
        call.seen.instance = fs.existsSync(path.join(String(call.opts.env?.MDPRO_VERIFY_RUN), "instance.json"));
        call.seen.launch = fs.existsSync(path.join(String(call.opts.env?.MDPRO_VERIFY_RUN), "launch.json"));
        call.seen.prefs = fs.existsSync(path.join(String(call.opts.env?.MDPRO_VERIFY_RUN), ".mdpro", "config.json"));
        appPublishes()(call, child);
      },
    });
    expect((await launch(fx)).exit).toBe(0);
    expect(fx.spawn.calls[0].seen).toEqual({ instance: false, launch: true, prefs: true });
  });

  it("LA-03 spawn env carries the four realpaths; process.env unchanged", async () => {
    const fx = fixture();
    const check = envGuard();
    expect((await launch(fx)).exit).toBe(0);
    const env = fx.spawn.calls[0].opts.env ?? {};
    const lexicalRunDir = path.join(path.join(fx.home, "Library", "Application Support", "mdpro-verify", "runs"), fx.name);
    const real = fs.realpathSync(lexicalRunDir);
    expect([env.HOME, env.CFFIXED_USER_HOME, env.MDPRO_VERIFY_RUN]).toEqual([real, real, real]);
    expect(real).not.toBe(lexicalRunDir);
    expect(real.startsWith(fx.real + path.sep)).toBe(true);
    for (const k of ["HOME", "CFFIXED_USER_HOME", "MDPRO_VERIFY_RUN", "MDPRO_VERIFY_NONCE"]) {
      expect(String(env[k])).not.toContain(fx.home);
    }
    expect(env.MDPRO_VERIFY_NONCE).toBe(JSON.parse(fs.readFileSync(fx.lay.launchJson, "utf8")).nonce);
    expect(env.PATH).toBe(process.env.PATH);
    check();
  });

  it("LA-04 run-name collision refuses, never reuses, releases its own lock", async () => {
    const fx = fixture();
    fs.mkdirSync(fx.lay.runDir, { recursive: true });
    fs.writeFileSync(path.join(fx.lay.runDir, "sentinel.txt"), "keep");
    const r = await launch(fx);
    expect(last(fx.out)).toBe(`${DF}run dir already exists: ${fx.name}`);
    expect(r.exit).toBe(1);
    expect(fx.spawn.calls).toHaveLength(0);
    expect(fs.readFileSync(path.join(fx.lay.runDir, "sentinel.txt"), "utf8")).toBe("keep");
    expect(fs.readdirSync(fx.lay.runDir)).toEqual(["sentinel.txt"]);
    expect(fs.existsSync(lockPath(fx))).toBe(false);
  });
});

describe("WI-6 launch#run gates: doctor, budget, order, lock race", () => {
  const R = "r".repeat(25);
  /** Real doctor facts from fs and fake procFacts; bundle, manifest and tree pass. */
  const hybrid = async (d: unknown) => ({
    ...(await collectFacts(d)),
    bundlePresent: true,
    manifest: { ok: true, buildId: "b1", profile: "verify" },
    sourceTreeMatches: true,
  });
  /** A run R holding the lock, with owner pid 4242. */
  function seedRun(fx: Fixture, lockBody?: string) {
    const dir = path.join(fx.parent, R);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, "launch.json"), JSON.stringify({ nonce: "55".repeat(32), buildId: "b1", mainBinary: MAIN }));
    publish(dir, { nonce: "55".repeat(32), pid: 4242, buildId: "b1" });
    fs.writeFileSync(path.join(dir, "owner.json"), JSON.stringify({ pid: 4242, startTime: LSTART, exeRealpath: MAIN }));
    fs.writeFileSync(path.join(fx.parent, ".lock"), lockBody ?? JSON.stringify({ run: R, nonceDigest: sha256("55".repeat(32)) }));
  }
  const ROWS: { row: number; seed: boolean; lock?: string; table: Parameters<typeof fakeProcFacts>[0]; expectText?: string }[] = [
    { row: 1, seed: true, table: { pids: { 4242: { alive: true, lstart: LSTART, exe: MAIN } } } },
    { row: 2, seed: true, table: { pids: { 4242: { alive: false } } }, expectText: `  next: pnpm control:clean ${R}` },
    { row: 3, seed: false, table: { scan: [4242] } },
    { row: 4, seed: false, table: { probe: "live" } },
    { row: 5, seed: false, table: { scan: "unknown" } },
    { row: 6, seed: false, table: { probe: "unknown" } },
    { row: 7, seed: true, lock: "{", table: {}, expectText: "[FAIL] no run lock: lock unreadable" },
  ];
  it.each(ROWS)("LA-05 row $row: a live, stale or unknown signal refuses before parent, lock and spawn", async (row) => {
    const fx = fixture({ procTable: row.table });
    fx.deps.collectDoctorFacts = hybrid;
    if (row.seed) seedRun(fx, row.lock);
    const before = row.seed ? { list: fs.readdirSync(fx.parent), lock: fileState(lockPath(fx)) } : null;
    const r = await launch(fx);
    expect(fx.spawn.calls).toHaveLength(0);
    expect(last(fx.out)).toBe("verdict: fail");
    expect(r.exit).toBe(1);
    if (before) {
      expect(fs.readdirSync(fx.parent)).toEqual(before.list);
      expect(fileState(lockPath(fx))).toEqual(before.lock);
    } else {
      expect(fs.existsSync(path.join(fx.home, "Library"))).toBe(false);
    }
    if (row.expectText) expect(fx.out).toContain(row.expectText);
    expect(fx.rng.draws()).toBe(0);
  });

  it.each([
    { name: "sourceTree mismatch", patch: { sourceTreeMatches: false }, verdict: "verdict: NOT VERIFIED" },
    { name: "bundle absent", patch: { bundlePresent: false }, verdict: "verdict: fail" },
  ])("LA-06 doctor blocking failure ($name) refuses before the lock", async ({ patch, verdict }) => {
    const fx = fixture({ facts: { ...passFacts(), ...patch } });
    const r = await launch(fx);
    expect(fs.existsSync(lockPath(fx))).toBe(false);
    expect(fx.spawn.calls).toHaveLength(0);
    expect(last(fx.out)).toBe(verdict);
    expect(r.exit).toBe(1);
  });

  it("LA-12 driver refuses a home one byte over the budget, creating nothing and drawing nothing", async () => {
    const fx = fixture({ realBytes: 23 });
    expect(expectedTotal(fx.home)).toBe(SOCKET_PATH_BUDGET + 1);
    const r = await launch(fx);
    expect(last(fx.out)).toBe(`verdict: fail — run path budget exceeded: ${SOCKET_PATH_BUDGET + 1} > ${SOCKET_PATH_BUDGET} bytes`);
    expect(r.exit).toBe(1);
    const text = fx.out.join("\n") + fx.err.join("\n");
    expect(text).not.toContain(fx.home);
    expect(text).not.toContain(fx.real);
    expect(fx.spawn.calls).toHaveLength(0);
    expect(fx.rng.draws()).toBe(0);
    expect(fs.existsSync(path.join(fx.home, "Library"))).toBe(false);
    expect(walk(fx.real).filter((p) => p.endsWith(".lock"))).toEqual([]);
  });

  it("LA-13 the budget is measured on the home's realpath, not its lexical path", async () => {
    const fx = fixture({ realBytes: 25 });
    expect(checkBudget(fx.home).ok).toBe(true);
    expect(expectedTotal(fx.home)).toBe(SOCKET_PATH_BUDGET + 3);
    const r = await launch(fx);
    expect(last(fx.out)).toBe(`verdict: fail — run path budget exceeded: ${SOCKET_PATH_BUDGET + 3} > ${SOCKET_PATH_BUDGET} bytes`);
    expect(r.exit).toBe(1);
    expect(fx.spawn.calls).toHaveLength(0);
    expect(fs.existsSync(path.join(fx.real, "Library"))).toBe(false);
  });

  it("LA-14 row a: doctor runs before the budget check", async () => {
    const fx = fixture({ realBytes: 23, facts: { ...passFacts(), sourceTreeMatches: false } });
    await launch(fx);
    expect(last(fx.out)).toBe("verdict: NOT VERIFIED");
    expect(fx.out.join("\n")).not.toContain("run path budget");
  });

  it("LA-14 row b: the budget check runs before the parent is created", async () => {
    const fx = fixture({ realBytes: 23 });
    await launch(fx);
    expect(String(last(fx.out))).toMatch(/^verdict: fail — run path budget exceeded: /);
    expect(fs.existsSync(path.join(fx.home, "Library"))).toBe(false);
  });

  it("LA-14 row c: acquire runs before the run dir is made", async () => {
    const fx = fixture();
    fs.mkdirSync(fx.parent, { recursive: true });
    fs.writeFileSync(lockPath(fx), JSON.stringify({ run: "a".repeat(25), nonceDigest: "99".repeat(32) }));
    await launch(fx);
    expect(last(fx.out)).toBe(`${DF}lock held by run ${"a".repeat(25)}`);
    expect(fs.readdirSync(fx.parent)).toEqual([".lock"]);
  });

  it("LA-14 row d: the parent tree is created (0700) before the wx acquire", async () => {
    const fx = fixture();
    expect(fs.existsSync(path.join(fx.home, "Library"))).toBe(false);
    await launch(fx);
    expect(fx.out).toContain(`ready: L1 run ${fx.name} pid 4242`);
    expect(mode(fx.parent)).toBe(0o700);
  });

  it("LA-14 row e: lock, run dir, launch.json and prefs all exist at spawn time", async () => {
    const fx = fixture({
      script: (call, child) => {
        const run = String(call.opts.env?.MDPRO_VERIFY_RUN);
        call.seen.state = [
          fs.existsSync(path.join(path.dirname(run), ".lock")),
          fs.existsSync(run),
          fs.existsSync(path.join(run, "launch.json")),
          fs.existsSync(path.join(run, ".mdpro", "config.json")),
        ];
        appPublishes()(call, child);
      },
    });
    await launch(fx);
    expect(fx.spawn.calls).toHaveLength(1);
    expect(fx.spawn.calls[0].seen.state).toEqual([true, true, true, true]);
  });

  it.each([
    { row: "A", body: JSON.stringify({ run: "a".repeat(25), nonceDigest: "99".repeat(32) }), verdict: `${DF}lock held by run ${"a".repeat(25)}` },
    { row: "B", body: "{", verdict: `${DF}lock unreadable` },
  ])("LA-15 row $row: a lock taken between doctor and acquire is never touched", async ({ body, verdict }) => {
    const fx = fixture();
    fs.mkdirSync(fx.parent, { recursive: true });
    fs.writeFileSync(lockPath(fx), body);
    const before = { list: fs.readdirSync(fx.parent), lock: fileState(lockPath(fx)) };
    const r = await launch(fx);
    expect(last(fx.out)).toBe(verdict);
    expect(r.exit).toBe(1);
    expect(fileState(lockPath(fx))).toEqual(before.lock);
    expect(fs.readdirSync(fx.parent)).toEqual(before.list);
    expect(fx.spawn.calls).toHaveLength(0);
    expect(fx.kill.calls).toEqual([]);
  });
});

describe("WI-6 launch#run direct exec: handshake failures", () => {
  it("LA-07 row A: handshake timeout kills the handle, releases the lock, keeps the run dir", async () => {
    const fx = fixture({ script: () => {} });
    const r = await launch(fx);
    expect(fx.clock.now()).toBe(T);
    expect(handle(fx).signals.length).toBeGreaterThan(0);
    expectReleasedAndKept(fx);
    expect(fs.existsSync(fx.lay.instanceJson)).toBe(false);
    expect(last(fx.out)).toBe(`${DF}handshake timeout after ${T} ms`);
    expect(r.exit).toBe(1);
  });

  it("LA-07 row B: a publish one poll before the deadline reaches L1", async () => {
    const fx = fixture({
      script: (call, child) => fx.clock.at(T - P, () => appPublishes()(call, child)),
    });
    const r = await launch(fx);
    expect(fx.out).toContain(`ready: L1 run ${fx.name} pid 4242`);
    expect(r.exit).toBe(0);
  });

  const DEBUG_ECHO = `{"event":"app.launch","level":"info"}\n{"event":"verify_run.guard"}\n${GUARD}instance.json already exists\n`;
  it.each([
    { text: DEBUG_ECHO, reason: "instance.json already exists" },
    { text: "panic\n", reason: "unknown" },
  ])("LA-08 child exits 78: reason $reason from the guard line in launcher-stderr.log", async ({ text, reason }) => {
    const fx = fixture({
      script: (call, child) => {
        fs.writeSync(call.opts.stdio?.[2] as number, text);
        child.exitSoon(78);
      },
    });
    const r = await launch(fx);
    expect(last(fx.out)).toBe(`${DF}guard refused: ${reason}`);
    expect(handle(fx).signals).toEqual([]);
    expectReleasedAndKept(fx);
    expect(fs.readFileSync(fx.lay.stderrLog, "utf8")).toContain(text);
    expect(r.exit).toBe(1);
  });

  it.each([1, 0])("LA-09 child exits %i before the handshake: no wait for the timeout", async (code) => {
    const fx = fixture({ script: (_call, child) => child.exitSoon(code) });
    const r = await launch(fx);
    expect(last(fx.out)).toBe(`${DF}child exited ${code} before handshake`);
    expect(fx.clock.now()).toBeLessThan(T);
    expectReleasedAndKept(fx);
    expect(r.exit).toBe(1);
  });

  it.each([
    { field: "nonce", script: appPublishes({ nonce: "33".repeat(32) }), verdict: `${DF}handshake mismatch: nonce` },
    { field: "buildId", script: appPublishes({ buildId: "b2" }), verdict: `${DF}handshake mismatch: buildId` },
    { field: "pid", script: appPublishes({}, 9999), verdict: `${DF}handshake mismatch: pid` },
    {
      field: "malformed",
      script: ((call) => publish(String(call.opts.env?.MDPRO_VERIFY_RUN), "{")) as FixtureOpts["script"],
      verdict: `${DF}instance.json unreadable`,
    },
  ])("LA-10 handshake mismatch ($field) kills only the handle", async ({ script, verdict }) => {
    const fx = fixture({ script });
    const r = await launch(fx);
    expect(last(fx.out)).toBe(verdict);
    expect(handle(fx).signals.length).toBeGreaterThan(0);
    expectReleasedAndKept(fx);
    expect(launcherText(fx)).not.toContain("33".repeat(32));
    expect(launcherText(fx)).not.toContain(NONCE);
    expect(r.exit).toBe(1);
  });

  it.each([
    { row: "startTime unknown", pf: { alive: true, lstart: "unknown", exe: MAIN }, verdict: `${DF}process facts: startTime unknown` },
    { row: "exe mismatch", pf: { alive: true, lstart: LSTART, exe: "/other/tauri-app" }, verdict: `${DF}process facts: exe mismatch` },
  ])("LA-11 owner record only after a verified match ($row)", async ({ pf, verdict }) => {
    const fx = fixture({ procTable: { pids: { 4242: pf as { alive: true; lstart: string; exe: string } } } });
    const r = await launch(fx);
    expect(last(fx.out)).toBe(verdict);
    expect(handle(fx).signals.length).toBeGreaterThan(0);
    expectReleasedAndKept(fx);
    expect(r.exit).toBe(1);
  });

  const other = (name: string) => JSON.stringify({ run: name, nonceDigest: sha256("44".repeat(32)) });
  it.each(["A", "B", "C"])("LA-16 row %s: failure cleanup releases only the lock this launch wrote", async (row) => {
    let replacement = "";
    const fx = fixture({
      script: (call) => {
        if (row === "C") return;
        const lock = path.join(path.dirname(String(call.opts.env?.MDPRO_VERIFY_RUN)), ".lock");
        replacement = other(row === "A" ? "b".repeat(25) : path.basename(String(call.opts.env?.MDPRO_VERIFY_RUN)));
        fs.writeFileSync(lock, replacement);
      },
    });
    const r = await launch(fx);
    expect(last(fx.out)).toBe(`${DF}handshake timeout after ${T} ms`);
    expect(handle(fx).signals.length).toBeGreaterThan(0);
    expect(fx.kill.calls).toEqual([]);
    if (row === "C") expect(fs.existsSync(lockPath(fx))).toBe(false);
    else expect(fs.readFileSync(lockPath(fx), "utf8")).toBe(replacement);
    expect(r.exit).toBe(1);
  });

  it.each([
    { row: "A", verdict: `${DF}launch.json field buildId must be a non-empty string`, spawns: 0 },
    { row: "B", verdict: `${DF}spawn failed: ENOENT`, spawns: 1 },
    { row: "C", verdict: `${DF}spawn failed: EACCES`, spawns: 1 },
  ])("LA-17 row $row: every failure after acquire and before the handshake releases the lock", async ({ row, verdict, spawns }) => {
    const fx = fixture({
      script: (_call, child) => {
        if (row === "B") throw Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
        child.errorSoon("EACCES");
      },
    });
    if (row === "A") fx.deps.buildId = "";
    const r = await launch(fx);
    expect(last(fx.out)).toBe(verdict);
    expect(fx.spawn.calls).toHaveLength(spawns);
    expect(r.exit).toBe(1);
    expect(fs.existsSync(lockPath(fx))).toBe(false);
    expect(fs.existsSync(fx.lay.runDir)).toBe(true);
    expect(fx.kill.calls).toEqual([]);
    for (const e of logLines(fx.lay.runDir)) expect(e.event.startsWith("launcher.")).toBe(true);
    expect(launcherText(fx)).not.toContain(NONCE);
  });

  it("LA-17 companion: a seeded nonce never reaches stdout or launcher.jsonl on a mismatch (seed 2026100811)", async () => {
    const r = mulberry32(2026100811);
    for (let i = 0; i < 5; i++) {
      const nonceBytes = bytes(r, 32);
      const nonce = Buffer.from(nonceBytes).toString("hex");
      const fx = fixture({ nonceBytes, script: appPublishes({ nonce: "33".repeat(32) }) });
      await launch(fx);
      expect(last(fx.out)).toBe(`${DF}handshake mismatch: nonce`);
      expect(launcherText(fx)).not.toContain(nonce);
    }
  });
});
