// @vitest-environment node
import { runChild, waitForExit } from "../support/loadGuardChild";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

const gui = path.resolve(".agents/skills/mdpro-delegator/scripts/gui-lock.sh");
const heavy = path.resolve("scripts/heavy-lock.sh");

it.skipIf(process.platform !== "darwin")("a GUI acquisition holds the heavy lock until its ID-aware release", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gui-heavy-"));
  const sampler = path.join(home, "sampler");
  fs.writeFileSync(sampler, "#!/bin/sh\necho '1 0 16'\n", { mode: 0o700 });
  const lock = path.join(home, "heavy.lock");
  const env = { ...process.env, MDPRO_HEAVY_LOCK_HELD: undefined, HOME: home, MDPRO_HEAVY_LOCK: lock,
    MDPRO_LOAD_GUARD_SAMPLER: sampler, MDPRO_LOAD_GUARD_ACTIVE: path.join(home, "active"),
    MDPRO_LOAD_GUARD_LOG: path.join(home, "log"), MDPRO_HEAVY_LOCK_WAIT_SECS: "0" };
  try {
    const acquired = (await runChild(gui, ["acquire", "batch"], { env, encoding: "utf8", timeout: 5000 }));
    expect(acquired.status).toBe(0);
    expect(fs.existsSync(lock)).toBe(true);
    const contender = (await runChild(heavy, ["/bin/true"], { env, encoding: "utf8", timeout: 5000 }));
    expect(contender.status).toBe(75);
    const id = acquired.stdout.match(/acquisition_id=([0-9a-f-]+)/)?.[1];
    expect(id).toBeTruthy();
    const released = (await runChild(gui, ["release", "batch", "--acquisition-id", id!], { env, encoding: "utf8", timeout: 5000 }));
    expect(released.status).toBe(0);
    expect(fs.existsSync(lock)).toBe(false);
  } finally {
    const owner = path.join(lock, "owner");
    if (fs.existsSync(owner)) {
      const keeperId = fs.readFileSync(owner, "utf8").match(/^cmd=--keeper ([0-9a-f-]+) /m)?.[1];
      if (keeperId) await runChild(heavy, ["--release", keeperId], { env, timeout: 6000 });
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
});

it.skipIf(process.platform !== "darwin")("releasing a GUI keeper leaves no sleeping member of its process group", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gui-keeper-drain-"));
  const lock = path.join(home, "heavy.lock");
  const env = { ...process.env, MDPRO_HEAVY_LOCK_HELD: undefined, HOME: home, MDPRO_HEAVY_LOCK: lock,
    MDPRO_GUARD_TEST: "1", MDPRO_HEAVY_LOCK_WAIT_SECS: "0" };
  let sleeper = 0;
  try {
    const acquired = (await runChild(gui, ["acquire", "keeper-drain"], { env, encoding: "utf8", timeout: 5000 }));
    expect(acquired.status).toBe(0);
    const id = acquired.stdout.match(/acquisition_id=([0-9a-f-]+)/)?.[1];
    expect(id).toBeTruthy();
    const keeper = Number(fs.readFileSync(path.join(lock, "owner"), "utf8").match(/^pid=(\d+)$/m)?.[1]);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    const children = (await runChild("ps", ["-axo", "pid=,ppid="], { encoding: "utf8" }));
    expect(children.status).toBe(0);
    sleeper = Number(children.stdout.split("\n").map((line) => line.trim().split(/\s+/)).find((parts) => Number(parts[1]) === keeper)?.[0]);
    expect(sleeper).toBeGreaterThan(0);
    const released = (await runChild(gui, ["release", "keeper-drain", "--acquisition-id", id!], {
      env, encoding: "utf8", timeout: 5000,
    }));
    expect(released.status).toBe(0);
    expect((await runChild("ps", ["-p", String(sleeper), "-o", "stat="], { encoding: "utf8" })).stdout.trim()).toBe("");
  } finally {
    if (fs.existsSync(path.join(lock, "owner"))) {
      const remainingKeeper = Number(fs.readFileSync(path.join(lock, "owner"), "utf8").match(/^pid=(\d+)$/m)?.[1]);
      if (remainingKeeper) {
        try { process.kill(remainingKeeper, "SIGTERM"); } catch { /* already gone */ }
      }
    }
    if (sleeper) {
      try { process.kill(sleeper, "SIGKILL"); } catch { /* already gone */ }
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
});

it("does not release a keeper whose PID now belongs to another process identity", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gui-keeper-identity-"));
  const lock = path.join(home, "lock");
  const id = "123e4567-e89b-42d3-a456-426614174000";
  const child = spawn("/bin/sleep", ["60"], { detached: true, stdio: "ignore" });
  const done = waitForExit(child);
  fs.mkdirSync(lock);
  const owner = `pid=${child.pid}\nprocess_start=old identity\ncmd=--keeper ${id} ready\n`;
  fs.writeFileSync(path.join(lock, "owner"), owner);
  try {
    const result = (await runChild(heavy, ["--release", id], { env: { ...process.env, MDPRO_HEAVY_LOCK: lock }, timeout: 6000 }));
    expect(result.status).toBe(1);
    expect(() => process.kill(child.pid!, 0)).not.toThrow();
    expect(fs.readFileSync(path.join(lock, "owner"), "utf8")).toBe(owner);
  } finally {
    try { process.kill(-child.pid!, "SIGKILL"); } catch { /* gone */ }
    await done;
    fs.rmSync(home, { recursive: true, force: true });
  }
}, 10000);

it.skipIf(process.platform !== "darwin")("rolls back the heavy keeper when a foreign GUI owner blocks acquisition", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gui-rollback-"));
  const lock = path.join(home, "heavy.lock");
  const guiLock = path.join(home, ".cache/desktop-gui.lock");
  fs.mkdirSync(guiLock, { recursive: true });
  fs.writeFileSync(path.join(guiLock, "owner"), "foreign owner bytes");
  try {
    const result = (await runChild(gui, ["acquire", "batch"], { env: { ...process.env, HOME: home,
      MDPRO_GUARD_TEST: "1", MDPRO_HEAVY_LOCK: lock }, encoding: "utf8", timeout: 5000 }));
    expect(result.status).toBe(75);
    expect(fs.existsSync(lock)).toBe(false);
    expect(fs.readFileSync(path.join(guiLock, "owner"), "utf8")).toBe("foreign owner bytes");
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

it("reclaims a dead keeper before starting a heavy job", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gui-dead-keeper-"));
  const lock = path.join(home, "lock");
  const env = { ...process.env, HOME: home, MDPRO_GUARD_TEST: "1", MDPRO_HEAVY_LOCK_HELD: undefined,
    MDPRO_HEAVY_LOCK: lock, MDPRO_HEAVY_LOCK_WAIT_SECS: "0" };
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, "owner"), "pid=2147483646\ncmd=--keeper dead ready\n");
  try {
    expect((await runChild(heavy, ["/usr/bin/true"], { env, timeout: 5000 })).status).toBe(0);
    expect(fs.existsSync(lock)).toBe(false);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

it.skipIf(process.platform !== "darwin")("refuses GUI acquire and wait while a live heavy owner holds the lock", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gui-heavy-busy-"));
  const lock = path.join(home, "lock");
  fs.mkdirSync(lock);
  const owner = `pid=${process.pid}\ncmd=heavy job\n`;
  fs.writeFileSync(path.join(lock, "owner"), owner);
  const env = { ...process.env, HOME: home, MDPRO_HEAVY_LOCK: lock, MDPRO_GUARD_TEST: "1", MDPRO_GUI_LOCK_WAIT_SECONDS: "0.01" };
  try {
    for (const args of [["acquire", "batch"], ["wait", "batch", "45", "purpose", "tester", "2"]]) {
      expect((await runChild(gui, args, { env, timeout: 5000 })).status).toBe(75);
      expect(fs.existsSync(path.join(home, ".cache/desktop-gui.lock"))).toBe(false);
      expect(fs.readFileSync(path.join(lock, "owner"), "utf8")).toBe(owner);
    }
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
