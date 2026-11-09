// @vitest-environment node
/** GH727: the measured spawn budget helper and per-test child cancellation (tests/support). */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { runChild, waitForExit } from "../support/loadGuardChild";
import { spawnBudget } from "../support/spawnBudget";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const tempDir = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh727-spawn-")); dirs.push(dir); return dir; };
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function readPid(file: string, ms = 5_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : "";
    if (/^\d+$/.test(text)) return Number(text);
    await delay(20);
  }
  throw new Error(`no pid in ${file}`);
}
function alive(pid: number) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
async function goneWithin(pid: number, ms: number) {
  const end = Date.now() + ms;
  while (alive(pid) && Date.now() < end) await delay(20);
  return !alive(pid);
}
/** Settles to "resolved" | "rejected" | "pending" within `ms`, so a hung child cannot hang the test. */
function outcome(promise: Promise<unknown>, ms: number) {
  return Promise.race([promise.then(() => "resolved", () => "rejected"), delay(ms).then(() => "pending")]);
}

describe("spawnBudget", () => {
  it("is ten times the worst alone-run duration, rounded up to 5 s, never below 15 s", () => {
    expect(spawnBudget(760)).toBe(15_000);
    expect(spawnBudget(2_400)).toBe(25_000);
  });

  it("steps at the 15 s floor and at each 5 s boundary", () => {
    expect([spawnBudget(0), spawnBudget(1_500), spawnBudget(1_501), spawnBudget(2_000)]).toEqual([15_000, 15_000, 20_000, 20_000]);
  });

  it("refuses a measurement that is not a finite, non-negative number", () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => spawnBudget(bad)).toThrow(RangeError);
  });
});

describe("runChild cancellation", () => {
  it("keeps its result contract when the signal never aborts", async () => {
    const controller = new AbortController();
    const result = await runChild("/bin/sh", ["-c", "echo out; echo err >&2; exit 3"], { signal: controller.signal });
    expect(result).toEqual({ status: 3, signal: null, stdout: "out\n", stderr: "err\n" });
  }, spawnBudget(1_000));

  it("rejects on abort and leaves no child running", async () => {
    const dir = tempDir(), pidFile = path.join(dir, "pid"), controller = new AbortController();
    const run = runChild("/bin/sh", ["-c", `echo $$ > '${pidFile}'; exec /bin/sleep 60`], { signal: controller.signal });
    const pid = await readPid(pidFile);
    controller.abort();
    expect({ settled: await outcome(run, 3_000), gone: await goneWithin(pid, 2_000) }).toEqual({ settled: "rejected", gone: true });
  }, spawnBudget(1_000));

  it("never lets a child run when the signal is already aborted", async () => {
    const dir = tempDir(), pidFile = path.join(dir, "pid"), controller = new AbortController();
    controller.abort();
    const settled = await outcome(runChild("/bin/sh", ["-c", `echo $$ > '${pidFile}'; exec /bin/sleep 60`], { signal: controller.signal }), 3_000);
    await delay(300);
    expect({ settled, wrote: fs.existsSync(pidFile) }).toEqual({ settled: "rejected", wrote: false });
  }, spawnBudget(1_000));

  it("stops the child's descendants too", async () => {
    const dir = tempDir(), pidFile = path.join(dir, "grandpid"), controller = new AbortController();
    const run = runChild("/bin/sh", ["-c", `/bin/sleep 60 & echo $! > '${pidFile}'; wait`], { signal: controller.signal });
    const grandchild = await readPid(pidFile);
    controller.abort();
    expect({ settled: await outcome(run, 3_000), gone: await goneWithin(grandchild, 2_000) }).toEqual({ settled: "rejected", gone: true });
  }, spawnBudget(1_000));

  it("kills a child that ignores TERM after a short grace", async () => {
    const dir = tempDir(), pidFile = path.join(dir, "pid"), controller = new AbortController();
    const run = runChild("/bin/sh", ["-c", `trap '' TERM; echo $$ > '${pidFile}'; while :; do /bin/sleep 0.1; done`], { signal: controller.signal });
    const pid = await readPid(pidFile);
    controller.abort();
    expect({ settled: await outcome(run, 3_000), gone: await goneWithin(pid, 3_000) }).toEqual({ settled: "rejected", gone: true });
  }, spawnBudget(3_000));
});

describe("waitForExit cancellation", () => {
  it("rejects promptly on abort and stops the background child", async () => {
    const child = spawn("/bin/sleep", ["60"], { detached: true, stdio: "ignore" }), controller = new AbortController();
    try {
      const wait = waitForExit(child, controller.signal);
      controller.abort();
      expect({ settled: await outcome(wait, 200), gone: await goneWithin(child.pid!, 2_000) }).toEqual({ settled: "rejected", gone: true });
    } finally {
      try { process.kill(-child.pid!, "SIGKILL"); } catch { /* gone */ }
    }
  }, spawnBudget(1_000));
});
