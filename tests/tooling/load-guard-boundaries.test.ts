// @vitest-environment node
import { runChild, waitForExit } from "../support/loadGuardChild";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";

const script = path.resolve("scripts/heavy-lock.sh");
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function fixture(readings: string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-boundary-"));
  dirs.push(dir);
  const sampler = path.join(dir, "sampler");
  const sequence = path.join(dir, "sequence");
  fs.writeFileSync(sequence, readings.join("\n") + "\n");
  fs.writeFileSync(sampler, `#!/bin/sh\nhead -n 1 '${sequence}'\nif [ "$(wc -l < '${sequence}')" -gt 1 ]; then tail -n +2 '${sequence}' > '${sequence}.next'; mv '${sequence}.next' '${sequence}'; fi\n`, { mode: 0o700 });
  const env = { ...process.env, MDPRO_HEAVY_LOCK_HELD: undefined, MDPRO_VITEST_WORKER_HEAP_MIB: undefined,
    MDPRO_HEAVY_LOCK: path.join(dir, "lock"), MDPRO_LOAD_GUARD_ACTIVE: path.join(dir, "active"),
    MDPRO_LOAD_GUARD_LOG: path.join(dir, "log"), MDPRO_LOAD_GUARD_SAMPLER: sampler,
    MDPRO_LOAD_GUARD_INTERVAL_SECS: "0.05", MDPRO_HEAVY_LOCK_KILL_GRACE_SECS: "1" };
  return { dir, env };
}
function records(dir: string) {
  return fs.readFileSync(path.join(dir, "log"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
}
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(probe: () => boolean) {
  const deadline = Date.now() + 6000;
  while (!probe() && Date.now() < deadline) await delay(10);
  expect(probe()).toBe(true);
}

it("resets a critical memory streak and preserves the child's own exit", async () => {
  const h = fixture(["1 0 16 0", "4 0 16 0", "1 0 16 0"]);
  const result = (await runChild(script, ["/bin/sh", "-c", "sleep 1; exit 7"], { env: h.env, timeout: 5000 }));
  expect(result.status).toBe(7);
  expect(records(h.dir).filter((r) => r.event === "stop")).toHaveLength(0);
});

it("applies strict CPU and attribution boundaries and resets the streak", async () => {
  const cases = [
    { readings: ["1 95 16 95", "1 95 16 95", "1 95 16 95"], status: 0 },
    { readings: ["1 95.01 16 90", "1 95.01 16 90", "1 95.01 16 90"], status: 76 },
    { readings: ["1 96 16 90", "1 97 16 90", "1 90 16 90", "1 96 16 90", "1 0 16 0"], status: 0 },
    { readings: ["1 100 16 80", "1 100 16 80", "1 100 16 80"], status: 0 },
    { readings: ["1 100 16 79.99", "1 100 16 79.99", "1 100 16 79.99"], status: 0 },
  ];
  for (const c of cases) {
    const h = fixture(["1 0 16 0", ...c.readings]);
    const result = (await runChild(script, ["/bin/sh", "-c", "sleep 1.5"], { env: h.env, timeout: 5000 }));
    expect(result.status, c.readings.join(",")).toBe(c.status);
    expect(records(h.dir).filter((r) => r.event === "stop")).toHaveLength(c.status === 76 ? 1 : 0);
  }
}, 15000);

it("guard-only enforces CPU stop and admission while preserving a foreign lock", async () => {
  for (const readings of [["1 0 16 0", "1 100 16 90"], ["4 0 16 0"]]) {
    const h = fixture(readings);
    fs.mkdirSync(h.env.MDPRO_HEAVY_LOCK);
    const owner = `pid=${process.pid}\nforeign=原文\n`;
    fs.writeFileSync(path.join(h.env.MDPRO_HEAVY_LOCK, "owner"), owner);
    const result = (await runChild(script, ["--guard-only", "/bin/sh", "-c", "echo ${MDPRO_HEAVY_LOCK_HELD:-unset}; sleep 2"], {
      env: { ...h.env, MDPRO_HEAVY_LOCK_WAIT_SECS: "1" }, encoding: "utf8", timeout: 5000,
    }));
    expect(result.status).toBe(readings.length === 1 ? 75 : 76);
    expect(result.stdout).toBe(readings.length === 1 ? "" : "unset\n");
    expect(fs.readFileSync(path.join(h.env.MDPRO_HEAVY_LOCK, "owner"), "utf8")).toBe(owner);
  }
});

it("isolates nested wrapper fixtures from an inherited outer coverage lock", async () => {
  const inherited = process.env.MDPRO_HEAVY_LOCK_HELD;
  process.env.MDPRO_HEAVY_LOCK_HELD = "1";
  try {
    const h = fixture(["1 0 16 0", "4 0 16 0"]);
    const result = (await runChild(script, ["/bin/sleep", "3"], { env: h.env, timeout: 5000 }));
    expect(result.status).toBe(76);
    expect(records(h.dir).filter((r) => r.event === "stop")).toHaveLength(1);
  } finally {
    if (inherited === undefined) delete process.env.MDPRO_HEAVY_LOCK_HELD;
    else process.env.MDPRO_HEAVY_LOCK_HELD = inherited;
  }
});

it("holds admission through sustained high CPU until the sampler cools down", async () => {
  const h = fixture(["1 100 16 0", "1 100 16 0", "1 100 16 0", "1 0 16 0"]);
  const result = (await runChild(script, ["/bin/cat", path.join(h.dir, "sequence")], { env: h.env, encoding: "utf8", timeout: 5000 }));
  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe("1 0 16 0");
});

it("sends TERM, honors grace, and drains stubborn descendants before a queued job enters", async () => {
  const h = fixture(["1 0 16 0", "4 0 16 0"]);
  const worker = path.join(h.dir, "worker.py");
  fs.writeFileSync(worker, `import os,signal,time,pathlib\np=pathlib.Path(${JSON.stringify(h.dir)})\nsignal.signal(signal.SIGTERM,lambda *_: (p/'term').write_text(str(time.time())))\n(p/'pid').write_text(str(os.getpid()))\nwhile True: time.sleep(.01)\n`);
  const wrapper = spawn(script, ["/bin/bash", "-c", `python3 '${worker}' & wait`], { env: h.env, stdio: "ignore" });
  const done = waitForExit(wrapper);
  let pid = 0;
  try {
    await until(() => fs.existsSync(path.join(h.dir, "pid")));
    pid = Number(fs.readFileSync(path.join(h.dir, "pid"), "utf8"));
    await until(() => fs.existsSync(path.join(h.dir, "term")));
    const termAt = Number(fs.readFileSync(path.join(h.dir, "term"), "utf8")) * 1000;
    expect(() => process.kill(pid, 0)).not.toThrow();
    const queued = spawn(script, ["python3", "-c", `import os,sys;\ntry: os.kill(${pid},0); sys.exit(9)\nexcept ProcessLookupError: sys.exit(0)`], {
      env: { ...h.env, MDPRO_LOAD_GUARD_SAMPLER: undefined, MDPRO_GUARD_TEST: "1" }, stdio: "ignore",
    });
    const queuedDone = waitForExit(queued);
    expect(await done).toBe(76);
    expect(Date.now() - termAt).toBeGreaterThanOrEqual(900);
    expect(() => process.kill(pid, 0)).toThrow();
    expect(await queuedDone).toBe(0);
    expect(fs.existsSync(h.env.MDPRO_HEAVY_LOCK)).toBe(false);
    expect(fs.readdirSync(h.env.MDPRO_LOAD_GUARD_ACTIVE)).toEqual([]);
    const stop = records(h.dir).filter((r) => r.event === "stop");
    expect(stop).toHaveLength(1);
    expect(stop[0].topRss.length).toBeLessThanOrEqual(8);
    expect(stop[0].topRss[0]).toMatchObject({ pid: expect.any(Number), ppid: expect.any(Number), rssMiB: expect.any(Number), elapsed: expect.any(String), command: expect.any(String) });
  } finally {
    wrapper.kill("SIGTERM");
    if (pid) try { process.kill(pid, "SIGKILL"); } catch { /* gone */ }
  }
}, 12000);
