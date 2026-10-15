// @vitest-environment node
/**
 * ADR-0047 WI-003 WI-6: LA-INT — the real `launch` driver against a node
 * stub "app" (matrix `.claude/tdd-guardian/tests-20261008-144444.md`, LA-INT).
 * Real spawn, real `ps` / `lsof` (`defaultProcFacts`), real clock, real
 * `crypto.randomBytes`, real fs under a `makeHome()` home. Only doctor's
 * bundle / manifest / tree facts and the verify-binary scan are injected as
 * pass: no real bundle exists here, and a real verify app running on the
 * machine must not fail the row. Slow lane (ADR-0050): real handshakes.
 *
 * Every child the driver spawns is captured through a wrapping `spawn` and
 * SIGKILLed in `afterEach`; nothing else is signalled.
 */
import { spawn as realSpawn, execFileSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { envGuard, expectedTotal, last, logLines } from "../support/launchHarness";
import { makeHome } from "../support/launcherFakes";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run } from "../../scripts/control/launch.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { collectFacts, defaultProcFacts } from "../../scripts/control/doctor.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { parseLstart } from "../../scripts/control/procFacts.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { runsParent, SOCKET_PATH_BUDGET } from "../../scripts/control/runDir.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run as quitRun } from "../../scripts/control/quit.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run as cleanRun } from "../../scripts/control/clean.mjs";

const GUARD = "mdpro verify-run guard: refusing to start: ";
const STUB = `
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const mode = process.argv[2];
const run = process.env.MDPRO_VERIFY_RUN, nonce = process.env.MDPRO_VERIFY_NONCE;
const G = ${JSON.stringify(GUARD)};
// WI-R3 (device Check D, 2026-10-09): exit 0 alone was a false pass; delivery is now required.
if (mode === "exit0") { const d = path.join(process.env.HOME, ".mdpro"); fs.mkdirSync(d, { recursive: true }); fs.appendFileSync(path.join(d, "mdpro.log"), JSON.stringify({ event: "file.open.external", status: "success", context: { filePath: process.argv[3], source: "single_instance" } }) + "\\n"); process.exit(0); }
if (mode === "guard") { process.stderr.write(G + "instance.json already exists\\n"); process.exit(78); }
const launch = JSON.parse(fs.readFileSync(path.join(run, "launch.json"), "utf8"));
if (mode !== "silent") {
  const tmp = path.join(run, ".instance.json." + crypto.randomUUID() + ".tmp");
  fs.writeFileSync(tmp, JSON.stringify({ nonce, pid: process.pid, buildId: launch.buildId, run }));
  try { fs.linkSync(tmp, path.join(run, "instance.json")); }
  catch { fs.unlinkSync(tmp); process.stderr.write(G + "instance.json already exists\\n"); process.exit(78); }
  fs.unlinkSync(tmp);
}
setInterval(() => {}, 1e3);
`;

let cleanups: (() => void)[] = [];
let children: ChildProcess[] = [];
afterEach(() => {
  for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
  for (const c of cleanups) c();
  children = [];
  cleanups = [];
});

function realFixture(mode: string, timeoutMs = 5000) {
  const h = makeHome();
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "lstub-"));
  const stub = path.join(stubDir, "stub.cjs");
  fs.writeFileSync(stub, STUB);
  cleanups.push(h.cleanup, () => fs.rmSync(stubDir, { recursive: true, force: true }));
  const out: string[] = [];
  const procFacts = { ...defaultProcFacts(), scan: async () => [] };
  const deps: Record<string, unknown> = {
    passwdHome: h.home,
    repoRoot: stubDir,
    siSockPath: `/tmp/lsi-${process.pid}-int.sock`,
    procFacts,
    collectDoctorFacts: async (d: unknown) => ({
      ...(await collectFacts(d)),
      bundlePresent: true,
      manifest: { ok: true, buildId: "b1", profile: "verify" },
      sourceTreeMatches: true,
    }),
    mainBinary: process.execPath,
    mainBinaryArgs: [stub, mode],
    buildId: "b1",
    handshakeTimeoutMs: timeoutMs,
    spawn: (cmd: string, args: string[], opts: object) => {
      const c = realSpawn(cmd, args, opts);
      children.push(c);
      return c;
    },
    out: (l: string) => out.push(l),
    err: (l: string) => out.push(l),
  };
  const parent: string = runsParent(h.real);
  return { ...h, stub, out, deps, parent };
}

const runDirs = (parent: string) => fs.readdirSync(parent).filter((n) => n !== ".lock").sort();
const isDead = (pid: number) => {
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ESRCH";
  }
};

describe("WI-6 LA-INT real driver against a node stub app", () => {
  it("LA-INT-1 a plain launch reaches L1 with real ps/lsof facts", async () => {
    const fx = realFixture("publish");
    const check = envGuard();
    const r = await run({ file: "/tmp/f.md" }, fx.deps);
    expect(last(fx.out)).toBe("verdict: pass");
    expect(r.exit).toBe(0);
    const [name] = runDirs(fx.parent);
    const runDir = path.join(fx.parent, name);
    expect(fx.out).toContainEqual(expect.stringMatching(new RegExp(`^ready: L1 run ${name} pid \\d+$`)));
    const owner = JSON.parse(fs.readFileSync(path.join(runDir, "owner.json"), "utf8"));
    const ps = execFileSync("ps", ["-p", String(owner.pid), "-o", "lstart="], { env: { ...process.env, LC_ALL: "C" } });
    expect(owner.startTime).toBe(parseLstart(String(ps)));
    expect(owner.exeRealpath).toBe(fs.realpathSync(process.execPath));
    const launch = JSON.parse(fs.readFileSync(path.join(runDir, "launch.json"), "utf8"));
    const inst = JSON.parse(fs.readFileSync(path.join(runDir, "instance.json"), "utf8"));
    expect(inst.nonce).toBe(launch.nonce);
    expect(Buffer.byteLength(path.join(inst.run, "ctl.sock"))).toBe(expectedTotal(fx.home));
    expect(expectedTotal(fx.home)).toBe(SOCKET_PATH_BUDGET);
    const lexical = path.join(runsParent(fx.home), name);
    expect(inst.run).toBe(fs.realpathSync(lexical));
    expect(inst.run).not.toBe(lexical);
    for (const e of logLines(runDir)) expect(e.event.startsWith("launcher.")).toBe(true);
    expect(fs.readFileSync(path.join(runDir, "launcher.jsonl"), "utf8")).not.toContain(launch.nonce);
    expect(fx.out.join("\n")).not.toContain(launch.nonce);
    check();
  });

  it("LA-INT-2 a second plain launch refuses while run 1 is live; --into passes", async () => {
    const fx = realFixture("publish");
    expect((await run({ file: "/tmp/f.md" }, fx.deps)).exit).toBe(0);
    const [name] = runDirs(fx.parent);
    const lock = fs.readFileSync(path.join(fx.parent, ".lock"), "utf8");
    const owner = fs.readFileSync(path.join(fx.parent, name, "owner.json"), "utf8");
    fx.out.length = 0;
    const second = await run({ file: "/tmp/f.md" }, fx.deps);
    expect(last(fx.out)).toBe("verdict: fail");
    expect(second.exit).toBe(1);
    expect(runDirs(fx.parent)).toEqual([name]);
    fx.out.length = 0;
    fx.deps.mainBinaryArgs = [fx.stub, "exit0"];
    const into = await run({ into: name, file: "/tmp/g.md" }, fx.deps);
    expect(last(fx.out)).toBe("verdict: pass");
    expect(into.exit).toBe(0);
    expect(fs.readFileSync(path.join(fx.parent, ".lock"), "utf8")).toBe(lock);
    expect(fs.readFileSync(path.join(fx.parent, name, "owner.json"), "utf8")).toBe(owner);
  });

  it("LA-INT-3 a stub that never publishes: timeout, the stub is dead, no lock", async () => {
    const fx = realFixture("silent", 300);
    const r = await run({ file: "/tmp/f.md" }, fx.deps);
    expect(last(fx.out)).toBe("verdict: driver failure — handshake timeout after 300 ms");
    expect(r.exit).toBe(1);
    const pid = children[0].pid as number;
    const deadline = Date.now() + 2000;
    while (!isDead(pid) && Date.now() < deadline) await new Promise((res) => setTimeout(res, 20));
    expect(isDead(pid)).toBe(true);
    expect(fs.existsSync(path.join(fx.parent, ".lock"))).toBe(false);
  });

  it("LA-INT-4 a stub that exits 78 with the guard line", async () => {
    const fx = realFixture("guard");
    const r = await run({ file: "/tmp/f.md" }, fx.deps);
    expect(last(fx.out)).toBe("verdict: driver failure — guard refused: instance.json already exists");
    expect(r.exit).toBe(1);
    expect(fs.existsSync(path.join(fx.parent, ".lock"))).toBe(false);
  });

  it("LA-INT-5 launch, quit, clean, launch again with the real RNG: fresh name and nonce", async () => {
    const fx = realFixture("publish");
    const verbDeps = { passwdHome: fx.home, procFacts: fx.deps.procFacts, out: fx.deps.out, err: fx.deps.err };
    const nonceOf = (name: string) => JSON.parse(fs.readFileSync(path.join(fx.parent, name, "launch.json"), "utf8")).nonce;

    expect((await run({ file: "/tmp/f.md" }, fx.deps)).exit).toBe(0);
    const [first] = runDirs(fx.parent);
    const firstNonce = nonceOf(first);
    expect((await quitRun({ run: first }, verbDeps)).exit).toBe(0);
    const cleaned = await cleanRun({ run: first }, { ...verbDeps, siSockPath: fx.deps.siSockPath });
    expect(cleaned.exit).toBe(0);
    expect(runDirs(fx.parent)).toEqual([]);

    expect((await run({ file: "/tmp/f.md" }, fx.deps)).exit).toBe(0);
    const [second] = runDirs(fx.parent);
    const secondNonce = nonceOf(second);
    expect(second).not.toBe(first);
    expect(secondNonce).not.toBe(firstNonce);
    expect(firstNonce).toMatch(/^[0-9a-f]{64}$/);
    expect(secondNonce).toMatch(/^[0-9a-f]{64}$/);
  });
});
