// @vitest-environment node
import { runChild, waitForExit } from "../support/loadGuardChild";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

const backstop = path.resolve("scripts/load-guard/backstop.py");
const guard = path.resolve("scripts/load-guard/guard.py");
it("resets overload streaks, preserves mixed groups, and rate-limits pressure snapshots", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backstop-states-"));
  const pure = spawn("/bin/sleep", ["60"], { detached: true, stdio: "ignore" });
  const mixed = spawn("/bin/sleep", ["60"], { detached: true, stdio: "ignore" });
  const pureDone = waitForExit(pure);
  const mixedDone = waitForExit(mixed);
  try {
    const processes = path.join(dir, "processes");
    const runner = (pid: number) => ({ pid, ppid: process.pid, pgid: pid, uid: process.getuid!(), cwd: dir,
      command: "/Applications/Xcode.app/Contents/Developer/usr/bin/xctest " + path.join(dir, "PicseeKitPackageTests.xctest") });
    fs.writeFileSync(processes, JSON.stringify([runner(pure.pid!), runner(mixed.pid!),
      { ...runner(mixed.pid!), pid: 2147483646, command: "/usr/bin/codesign --sign identity" }]));
    const sampler = path.join(dir, "sampler");
    const env: NodeJS.ProcessEnv = { ...process.env, MDPRO_GUARD_TEST: "1", MDPRO_LOAD_GUARD_TEST_ROOT: dir,
      MDPRO_LOAD_GUARD_PROCESSES: processes, MDPRO_LOAD_GUARD_SAMPLER: sampler,
      MDPRO_LOAD_GUARD_ACTIVE: path.join(dir, "active"), MDPRO_LOAD_GUARD_STATE: path.join(dir, "state"),
      MDPRO_LOAD_GUARD_LOG: path.join(dir, "log") };
    fs.writeFileSync(path.join(dir, "ps"), `#!/bin/sh\nif [ "$*" = '-axo pgid=,%cpu=' ]; then echo '${pure.pid} ${90 * os.cpus().length}'; echo '${mixed.pid} ${90 * os.cpus().length}'; else exec /bin/ps "$@"; fi\n`, { mode: 0o700 });
    env.PATH = `${dir}:${process.env.PATH}`;
    const tick = async (pressure: number, busy: number) => {
      fs.writeFileSync(sampler, `#!/bin/sh\necho '${pressure} ${busy} 16'\n`, { mode: 0o700 });
      expect((await runChild("python3", [backstop, "--once"], { env, encoding: "utf8", timeout: 4000 })).status).toBe(0);
    };
    for (const [pressure, cpu] of [[4, 96], [1, 97], [4, 90], [1, 95], [1, 95], [1, 95], [1, 96], [1, 97]]) {
      (await tick(pressure, cpu));
      expect(() => process.kill(pure.pid!, 0)).not.toThrow();
      expect(() => process.kill(mixed.pid!, 0)).not.toThrow();
    }
    (await tick(1, 98));
    await pureDone;
    expect(() => process.kill(pure.pid!, 0)).toThrow();
    expect(() => process.kill(mixed.pid!, 0)).not.toThrow();
    const records = fs.readFileSync(path.join(dir, "log"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(records.filter((r) => r.event === "stop")).toHaveLength(1);
    expect(records.find((r) => r.event === "stop")?.reason).toBe("cpu");
    expect(records.filter((r) => r.event === "snapshot")).toHaveLength(1);
  } finally {
    for (const pid of [pure.pid, mixed.pid]) try { process.kill(-pid!, "SIGKILL"); } catch { /* gone */ }
    await Promise.all([pureDone, mixedDone]);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it("cleans stale and reused registration identities without covering their groups", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-stale-"));
  const child = spawn("/bin/sleep", ["60"], { detached: true, stdio: "ignore" });
  const done = waitForExit(child);
  try {
    const active = path.join(dir, "active");
    fs.mkdirSync(active);
    fs.writeFileSync(path.join(active, `${child.pid}.json`), JSON.stringify({ pgid: child.pid, pid: child.pid, uid: process.getuid!(), start: "reused" }));
    fs.writeFileSync(path.join(active, "2147483646.json"), JSON.stringify({ pgid: 2147483646, pid: 2147483646, uid: process.getuid!(), start: "dead" }));
    const result = (await runChild("python3", [guard, "registered"], { env: { ...process.env, MDPRO_LOAD_GUARD_ACTIVE: active }, encoding: "utf8" }));
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([]);
    expect(fs.readdirSync(active)).toEqual([]);
    expect(() => process.kill(child.pid!, 0)).not.toThrow();
  } finally {
    try { process.kill(-child.pid!, "SIGKILL"); } catch { /* gone */ }
    await done;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it("rechecks group membership immediately before TERM and preserves a newly mixed group", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-membership-"));
  const child = spawn("/bin/sleep", ["60"], { detached: true, stdio: "ignore" });
  const done = waitForExit(child);
  try {
    const fifo = path.join(dir, "processes");
    expect((await runChild("mkfifo", [fifo])).status).toBe(0);
    const sampler = path.join(dir, "sampler");
    fs.writeFileSync(sampler, "#!/bin/sh\necho '4 0 16'\n", { mode: 0o700 });
    const state = path.join(dir, "state");
    fs.writeFileSync(state, JSON.stringify({ memory: 1, cpu: 0, lastSnapshot: Date.now() / 1000 }));
    const runner = { pid: child.pid, ppid: process.pid, pgid: child.pid, uid: process.getuid!(), cwd: dir,
      command: "/Applications/Xcode.app/Contents/Developer/usr/bin/xctest " + path.join(dir, "PicseeKitPackageTests.xctest") };
    const back = spawn("python3", [backstop, "--once"], { env: { ...process.env,
      MDPRO_GUARD_TEST: "1", MDPRO_LOAD_GUARD_TEST_ROOT: dir, MDPRO_LOAD_GUARD_PROCESSES: fifo,
      MDPRO_LOAD_GUARD_STATE: state, MDPRO_LOAD_GUARD_SAMPLER: sampler,
      MDPRO_LOAD_GUARD_ACTIVE: path.join(dir, "active"), MDPRO_LOAD_GUARD_LOG: path.join(dir, "log") }, stdio: "ignore" });
    const backDone = waitForExit(back);
    // Each FIFO read is a separate OS inventory snapshot. The second adds a
    // protected member, after initial classification but before any signal.
    fs.writeFileSync(fifo, JSON.stringify([runner]));
    await new Promise((resolve) => setTimeout(resolve, 50));
    fs.writeFileSync(fifo, JSON.stringify([runner, { ...runner, pid: 2147483646, command: "/usr/bin/codesign --sign identity" }]));
    expect(await backDone).toBe(0);
    expect(() => process.kill(child.pid!, 0)).not.toThrow();
    expect(fs.existsSync(path.join(dir, "log"))).toBe(false);
  } finally {
    try { process.kill(-child.pid!, "SIGKILL"); } catch { /* gone */ }
    await done;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
