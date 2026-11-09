// @vitest-environment node
import { runChild, waitForExit } from "../support/loadGuardChild";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { registeredWrapperScenario } from "../support/loadGuardRegistered";
import { spawnBudget } from "../support/spawnBudget";

const backstop = path.resolve("scripts/load-guard/backstop.py");
const wrapperScript = path.resolve("scripts/heavy-lock.sh");
const installer = path.resolve("scripts/load-guard/install.py");

// GH727: worst alone 1 884 ms.
it("stops an unwrapped allowlisted runner after two critical readings", async ({ signal }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "load-backstop-"));
  const child = spawn("/bin/sleep", ["60"], { detached: true, stdio: "ignore" });
  try {
    expect(child.pid).toBeTypeOf("number");
    const pid = child.pid!;
    const processes = path.join(dir, "processes.json");
    fs.writeFileSync(processes, JSON.stringify([{ pid, ppid: process.pid, pgid: pid,
      uid: process.getuid!(), command: "/Applications/Xcode.app/Contents/Developer/usr/bin/xctest " +
        path.join(dir, "Packages/PicseeKit/.build/debug/PicseeKitPackageTests.xctest"), cwd: dir }]));
    const sampler = path.join(dir, "sampler");
    fs.writeFileSync(sampler, "#!/bin/sh\necho '4 0 11.680 5.568 73'\n", { mode: 0o700 });
    const env = { ...process.env, MDPRO_GUARD_TEST: "1", MDPRO_LOAD_GUARD_TEST_ROOT: dir,
      MDPRO_LOAD_GUARD_PROCESSES: processes, MDPRO_LOAD_GUARD_SAMPLER: sampler,
      MDPRO_LOAD_GUARD_LOG: path.join(dir, "log"), MDPRO_LOAD_GUARD_ACTIVE: path.join(dir, "active"),
      MDPRO_LOAD_GUARD_STATE: path.join(dir, "state.json") };
    const first = (await runChild("python3", [backstop, "--once"], { env, encoding: "utf8", signal }));
    expect(first.status).toBe(0);
    expect(() => process.kill(pid, 0)).not.toThrow();
    const second = (await runChild("python3", [backstop, "--once"], { env, encoding: "utf8", signal }));
    expect(second.status).toBe(0);
    await waitForExit(child, signal);
    expect(() => process.kill(pid, 0)).toThrow();
    const records = fs.readFileSync(path.join(dir, "log"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(records.filter((record) => record.event === "stop")).toHaveLength(1);
    expect(records.find((record) => record.event === "stop")?.readings).toMatchObject({
      availableGiB: "11.680", vmStatFreeGiB: "5.568", memorystatusLevel: "73",
    });
  } finally {
    try { process.kill(-child.pid!, "SIGKILL"); } catch { /* already gone */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, spawnBudget(1_884));

const registeredOutcome = { registrations: 1, registeredAliveAfterTicks: true, looseStopped: true, wrapperCode: 76, stops: 2, wrapperStops: 1, looseStops: 1 };

// GH727: worst alone 3 364 ms.
it("leaves a registered wrapper to stop itself while stopping an unwrapped runner", async ({ signal }) => {
  expect(await registeredWrapperScenario(0, signal)).toEqual(registeredOutcome);
}, spawnBudget(3_364));

// GH727 (#731): under load the two backstop ticks can land after the wrapper's own monitor has stopped it.
// GH727: worst alone 5 449 ms.
it("leaves a registered wrapper alive across backstop ticks 2.5 s apart", async ({ signal }) => {
  expect(await registeredWrapperScenario(2_500, signal)).toEqual(registeredOutcome);
}, spawnBudget(5_449));

// GH727: worst alone 8 842 ms.
it("leaves a registered wrapper alive across ticks further apart than the old 5 s wrapped command", async ({ signal }) => {
  expect(await registeredWrapperScenario(6_000, signal)).toEqual(registeredOutcome);
}, spawnBudget(8_842));

// GH727: worst alone 238 ms.
it("refuses a foreign launchd plist and round-trips only its own template", async ({ signal }) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "load-guard-install-"));
  const agents = path.join(home, "Library/LaunchAgents");
  const plist = path.join(agents, "com.mdpro.load-guard.plist");
  fs.mkdirSync(agents, { recursive: true });
  fs.writeFileSync(plist, "foreign plist bytes");
  const env = { ...process.env, HOME: home };
  try {
    const refused = (await runChild("python3", [installer, "install"], { env, encoding: "utf8", signal }));
    expect(refused.status).toBe(1);
    expect(fs.readFileSync(plist, "utf8")).toBe("foreign plist bytes");
    fs.unlinkSync(plist);
    const installed = (await runChild("python3", [installer, "install"], { env, encoding: "utf8", signal }));
    expect(installed.status).toBe(0);
    expect(fs.readFileSync(plist, "utf8")).toContain("mdpro-load-guard-managed");
    const removed = (await runChild("python3", [installer, "uninstall"], { env, encoding: "utf8", signal }));
    expect(removed.status).toBe(0);
    expect(fs.existsSync(plist)).toBe(false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}, spawnBudget(238));

// GH727: worst alone 181 ms.
it("refuses a foreign plist that copies the managed marker", async ({ signal }) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "load-guard-foreign-marker-"));
  const agents = path.join(home, "Library/LaunchAgents");
  const plist = path.join(agents, "com.mdpro.load-guard.plist");
  fs.mkdirSync(agents, { recursive: true });
  const foreign = "<plist>foreign mdpro-load-guard-managed</plist>";
  fs.writeFileSync(plist, foreign);
  const env = { ...process.env, HOME: home };
  try {
    expect((await runChild("python3", [installer, "install"], { env, encoding: "utf8", signal })).status).toBe(1);
    expect(fs.readFileSync(plist, "utf8")).toBe(foreign);
    expect((await runChild("python3", [installer, "uninstall"], { env, encoding: "utf8", signal })).status).toBe(1);
    expect(fs.readFileSync(plist, "utf8")).toBe(foreign);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}, spawnBudget(181));

// GH727: worst alone 2 558 ms.
it("keeps one wrapper stop record when the wrapper crosses its threshold before the backstop", async ({ signal }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "load-wrapper-first-"));
  const sampler = path.join(dir, "sampler");
  const counter = path.join(dir, "admitted");
  fs.writeFileSync(sampler, `#!/bin/sh\nif [ -e '${counter}' ]; then echo '4 0 16'; else touch '${counter}'; echo '1 0 16'; fi\n`, { mode: 0o700 });
  const log = path.join(dir, "log");
  const env = { ...process.env, MDPRO_HEAVY_LOCK_HELD: undefined,
    MDPRO_HEAVY_LOCK: path.join(dir, "lock"), MDPRO_LOAD_GUARD_SAMPLER: sampler,
    MDPRO_LOAD_GUARD_ACTIVE: path.join(dir, "active"), MDPRO_LOAD_GUARD_LOG: log,
    MDPRO_LOAD_GUARD_INTERVAL_SECS: "0.05" };
  const loose = spawn("/bin/sleep", ["60"], { detached: true, stdio: "ignore" });
  try {
    const wrapped = await runChild(wrapperScript, ["/bin/sleep", "5"], { env, timeout: 5000, signal });
    expect(wrapped.status).toBe(76);
    expect(fs.existsSync(env.MDPRO_HEAVY_LOCK)).toBe(false);
    expect(fs.readdirSync(env.MDPRO_LOAD_GUARD_ACTIVE)).toEqual([]);
    const processes = path.join(dir, "processes");
    fs.writeFileSync(processes, JSON.stringify([{ pid: loose.pid, ppid: process.pid, pgid: loose.pid,
      uid: process.getuid!(), cwd: dir, command: "/Applications/Xcode.app/Contents/Developer/usr/bin/xctest " + path.join(dir, "PicseeKitPackageTests.xctest") }]));
    const backEnv = { ...env, MDPRO_GUARD_TEST: "1", MDPRO_LOAD_GUARD_TEST_ROOT: dir,
      MDPRO_LOAD_GUARD_PROCESSES: processes, MDPRO_LOAD_GUARD_STATE: path.join(dir, "state") };
    expect((await runChild("python3", [backstop, "--once"], { env: backEnv, signal })).status).toBe(0);
    expect((await runChild("python3", [backstop, "--once"], { env: backEnv, signal })).status).toBe(0);
    await waitForExit(loose, signal);
    expect(() => process.kill(loose.pid!, 0)).toThrow();
    const records = fs.readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(records.filter((r) => r.event === "stop")).toHaveLength(2);
    expect(records.filter((r) => r.event === "stop" && r.cmd.startsWith("sleep sha256:"))).toHaveLength(1);
  } finally {
    try { process.kill(-loose.pid!, "SIGKILL"); } catch { /* gone */ }
    await waitForExit(loose);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, spawnBudget(2_558));
