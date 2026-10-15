// @vitest-environment node
/**
 * D75(b): `scripts/heavy-lock.sh` must not release the machine-wide lock while
 * the job it guards still has processes running.
 *
 * The bug: on INT/TERM the wrapper sent TERM to its direct child only and
 * removed the lock at once, so grandchildren (rustc, vitest workers) kept
 * running while a queued session acquired the lock. Each case runs the real
 * script against a private lock dir (never the shared one) with a child shell
 * that backgrounds a `sleep` grandchild, signals the wrapper, and checks the
 * grandchild at the moment the lock dir disappears.
 *
 * Runs under both /bin/bash (3.2, what a stock Mac has) and the `bash` on PATH.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/heavy-lock.sh");
const POLL_MS = 5;
const DEADLINE_MS = 15_000;

const SHELLS = [...new Set(["/bin/bash", spawnSync("/usr/bin/which", ["bash"], { encoding: "utf8" }).stdout.trim()])]
  .filter((s) => s !== "" && fs.existsSync(s));

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** A private lock dir, and no inherited HELD flag (that would skip the lock). */
function lockEnv(lock: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, MDPRO_HEAVY_LOCK: lock, ...extra };
  delete env.MDPRO_HEAVY_LOCK_HELD;
  return env;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(probe: () => T | undefined, what: string): Promise<T> {
  const end = Date.now() + DEADLINE_MS;
  for (;;) {
    const v = probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(POLL_MS);
  }
}

const leftovers: number[] = [];
const tmpDirs: string[] = [];
afterEach(() => {
  for (const pid of leftovers.splice(0)) if (alive(pid)) process.kill(pid, "SIGKILL");
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe.each(SHELLS)("D75(b) heavy-lock signal handling under %s", (shell) => {
  it.each(["SIGINT", "SIGTERM"] as const)(
    "%s: the grandchild is gone before the lock dir is removed",
    async (signal) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "heavy-lock-"));
      tmpDirs.push(dir);
      const lock = path.join(dir, "lock");
      const gcFile = path.join(dir, "gc.pid");
      const job = `sleep 60 & echo $! > "${gcFile}"; wait`;
      const env = lockEnv(lock);
      const wrapper = spawn(shell, [SCRIPT, "/bin/bash", "-c", job], { env, stdio: "ignore" });
      const exited = new Promise((r) => wrapper.on("exit", r));

      const gc = await until(() => {
        const t = fs.existsSync(gcFile) ? fs.readFileSync(gcFile, "utf8").trim() : "";
        return t === "" ? undefined : Number(t);
      }, "the grandchild pid");
      leftovers.push(gc);
      expect(fs.existsSync(lock)).toBe(true);
      expect(alive(gc)).toBe(true);

      wrapper.kill(signal);
      const gcAliveAtRelease = await until(() => (fs.existsSync(lock) ? undefined : alive(gc)), "lock release");

      expect(gcAliveAtRelease, "grandchild still running when the lock was released").toBe(false);
      await exited;
      expect(alive(gc)).toBe(false);
    },
    DEADLINE_MS + 5_000,
  );

  it(
    "a grandchild that ignores TERM is KILLed after the grace period, before release",
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "heavy-lock-"));
      tmpDirs.push(dir);
      const lock = path.join(dir, "lock");
      const gcFile = path.join(dir, "gc.pid");
      const job = `/bin/bash -c 'trap "" TERM; echo $$ > "${gcFile}"; while :; do sleep 0.05; done' & wait`;
      const env = lockEnv(lock, { MDPRO_HEAVY_LOCK_KILL_GRACE_SECS: "1" });
      const wrapper = spawn(shell, [SCRIPT, "/bin/bash", "-c", job], { env, stdio: "ignore" });
      const exited = new Promise((r) => wrapper.on("exit", r));

      const gc = await until(() => {
        const t = fs.existsSync(gcFile) ? fs.readFileSync(gcFile, "utf8").trim() : "";
        return t === "" ? undefined : Number(t);
      }, "the grandchild pid");
      leftovers.push(gc);

      wrapper.kill("SIGTERM");
      const gcAliveAtRelease = await until(() => (fs.existsSync(lock) ? undefined : alive(gc)), "lock release");

      expect(gcAliveAtRelease, "TERM-ignoring grandchild still running at release").toBe(false);
      await exited;
    },
    DEADLINE_MS + 5_000,
  );

  it("a normal run still releases the lock and propagates the exit code", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "heavy-lock-"));
    tmpDirs.push(dir);
    const lock = path.join(dir, "lock");
    const env = lockEnv(lock);
    const r = spawnSync(shell, [SCRIPT, "/bin/bash", "-c", 'echo "held=$MDPRO_HEAVY_LOCK_HELD"; exit 7'], {
      env,
      encoding: "utf8",
    });
    expect(r.status).toBe(7);
    expect(r.stdout).toBe("held=1\n");
    expect(r.stderr).toBe("");
    expect(fs.existsSync(lock)).toBe(false);
  });
});
