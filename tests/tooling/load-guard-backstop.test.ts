// @vitest-environment node
import { runChild, waitForExit } from "../support/loadGuardChild";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

const backstop = path.resolve("scripts/load-guard/backstop.py");
const wrapperScript = path.resolve("scripts/heavy-lock.sh");
const installer = path.resolve("scripts/load-guard/install.py");

it("stops an unwrapped allowlisted runner after two critical readings", async () => {
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
    const first = (await runChild("python3", [backstop, "--once"], { env, encoding: "utf8" }));
    expect(first.status).toBe(0);
    expect(() => process.kill(pid, 0)).not.toThrow();
    const second = (await runChild("python3", [backstop, "--once"], { env, encoding: "utf8" }));
    expect(second.status).toBe(0);
    await waitForExit(child);
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
});

it("leaves a registered wrapper to stop itself while stopping an unwrapped runner", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "load-backstop-together-"));
  const active = path.join(dir, "active");
  const log = path.join(dir, "log");
  const wrapperSampler = path.join(dir, "wrapper-sampler");
  const backstopSampler = path.join(dir, "backstop-sampler");
  const counter = path.join(dir, "counter");
  fs.writeFileSync(wrapperSampler, `#!/bin/sh\nif [ ! -e '${counter}' ]; then touch '${counter}'; echo '1 0 16'; else echo '4 0 16'; fi\n`, { mode: 0o700 });
  fs.writeFileSync(backstopSampler, "#!/bin/sh\necho '4 0 16'\n", { mode: 0o700 });
  const common = { ...process.env, MDPRO_HEAVY_LOCK_HELD: undefined, MDPRO_GUARD_TEST: "1", MDPRO_LOAD_GUARD_TEST_ROOT: dir,
    MDPRO_LOAD_GUARD_ACTIVE: active, MDPRO_LOAD_GUARD_LOG: log };
  const wrapped = spawn(wrapperScript, ["/bin/bash", "-c", "sleep 5"], {
    env: { ...common, MDPRO_HEAVY_LOCK: path.join(dir, "lock"), MDPRO_LOAD_GUARD_SAMPLER: wrapperSampler,
      MDPRO_LOAD_GUARD_INTERVAL_SECS: "0.8" }, stdio: "ignore",
  });
  const loose = spawn("/bin/sleep", ["60"], { detached: true, stdio: "ignore" });
  try {
    const deadline = Date.now() + 3000;
    while ((!fs.existsSync(active) || fs.readdirSync(active).length === 0) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(fs.readdirSync(active).length).toBe(1);
    const registration = JSON.parse(fs.readFileSync(path.join(active, fs.readdirSync(active)[0]), "utf8"));
    const processes = path.join(dir, "processes.json");
    fs.writeFileSync(processes, JSON.stringify([registration.pgid, loose.pid].map((pid) => ({
      pid, ppid: process.pid, pgid: pid, uid: process.getuid!(), cwd: dir,
      command: "/Applications/Xcode.app/Contents/Developer/usr/bin/xctest " +
        path.join(dir, "Packages/PicseeKit/.build/debug/PicseeKitPackageTests.xctest"),
    }))));
    const env = { ...common, MDPRO_LOAD_GUARD_SAMPLER: backstopSampler, MDPRO_LOAD_GUARD_PROCESSES: processes,
      MDPRO_LOAD_GUARD_STATE: path.join(dir, "state") };
    expect((await runChild("python3", [backstop, "--once"], { env })).status).toBe(0);
    expect((await runChild("python3", [backstop, "--once"], { env })).status).toBe(0);
    expect(() => process.kill(registration.pid, 0)).not.toThrow();
    await waitForExit(loose);
    expect(() => process.kill(loose.pid!, 0)).toThrow();
    const code = await waitForExit(wrapped);
    expect(code).toBe(76);
    const records = fs.readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(records.filter((record) => record.event === "stop")).toHaveLength(2);
    expect(records.filter((record) => record.event === "stop" && record.cmd.includes("sleep 5"))).toHaveLength(1);
  } finally {
    wrapped.kill("SIGTERM");
    try { process.kill(-loose.pid!, "SIGKILL"); } catch { /* already gone */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 15000);

it("refuses a foreign launchd plist and round-trips only its own template", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "load-guard-install-"));
  const agents = path.join(home, "Library/LaunchAgents");
  const plist = path.join(agents, "com.mdpro.load-guard.plist");
  fs.mkdirSync(agents, { recursive: true });
  fs.writeFileSync(plist, "foreign plist bytes");
  const env = { ...process.env, HOME: home };
  try {
    const refused = (await runChild("python3", [installer, "install"], { env, encoding: "utf8" }));
    expect(refused.status).toBe(1);
    expect(fs.readFileSync(plist, "utf8")).toBe("foreign plist bytes");
    fs.unlinkSync(plist);
    const installed = (await runChild("python3", [installer, "install"], { env, encoding: "utf8" }));
    expect(installed.status).toBe(0);
    expect(fs.readFileSync(plist, "utf8")).toContain("mdpro-load-guard-managed");
    const removed = (await runChild("python3", [installer, "uninstall"], { env, encoding: "utf8" }));
    expect(removed.status).toBe(0);
    expect(fs.existsSync(plist)).toBe(false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

it("refuses a foreign plist that copies the managed marker", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "load-guard-foreign-marker-"));
  const agents = path.join(home, "Library/LaunchAgents");
  const plist = path.join(agents, "com.mdpro.load-guard.plist");
  fs.mkdirSync(agents, { recursive: true });
  const foreign = "<plist>foreign mdpro-load-guard-managed</plist>";
  fs.writeFileSync(plist, foreign);
  const env = { ...process.env, HOME: home };
  try {
    expect((await runChild("python3", [installer, "install"], { env, encoding: "utf8" })).status).toBe(1);
    expect(fs.readFileSync(plist, "utf8")).toBe(foreign);
    expect((await runChild("python3", [installer, "uninstall"], { env, encoding: "utf8" })).status).toBe(1);
    expect(fs.readFileSync(plist, "utf8")).toBe(foreign);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

it("keeps one wrapper stop record when the wrapper crosses its threshold before the backstop", async () => {
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
    const wrapped = await runChild(wrapperScript, ["/bin/sleep", "5"], { env, timeout: 5000 });
    expect(wrapped.status).toBe(76);
    expect(fs.existsSync(env.MDPRO_HEAVY_LOCK)).toBe(false);
    expect(fs.readdirSync(env.MDPRO_LOAD_GUARD_ACTIVE)).toEqual([]);
    const processes = path.join(dir, "processes");
    fs.writeFileSync(processes, JSON.stringify([{ pid: loose.pid, ppid: process.pid, pgid: loose.pid,
      uid: process.getuid!(), cwd: dir, command: path.join(dir, "target/debug/deps/tests-123") }]));
    const backEnv = { ...env, MDPRO_GUARD_TEST: "1", MDPRO_LOAD_GUARD_TEST_ROOT: dir,
      MDPRO_LOAD_GUARD_PROCESSES: processes, MDPRO_LOAD_GUARD_STATE: path.join(dir, "state") };
    expect((await runChild("python3", [backstop, "--once"], { env: backEnv })).status).toBe(0);
    expect((await runChild("python3", [backstop, "--once"], { env: backEnv })).status).toBe(0);
    await waitForExit(loose);
    expect(() => process.kill(loose.pid!, 0)).toThrow();
    const records = fs.readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(records.filter((r) => r.event === "stop")).toHaveLength(2);
    expect(records.filter((r) => r.event === "stop" && r.cmd.includes("/bin/sleep 5"))).toHaveLength(1);
  } finally {
    try { process.kill(-loose.pid!, "SIGKILL"); } catch { /* gone */ }
    await waitForExit(loose);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
