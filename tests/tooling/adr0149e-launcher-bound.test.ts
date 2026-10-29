// @vitest-environment node
/**
 * ADR0149E-F1H1 (fix 1, opus-auditor round one H1): the entry's OS-lock launcher bound is
 * derived from the bounds it wraps (the replay's runs, the lanes' own timeouts), and any
 * stop of the receipt operation (the launcher bound, SIGTERM to the entry) kills the
 * operation's process group and removes its replay worktree, so the next replay proceeds.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import * as locks from "../../scripts/tdd/receipt-locks.mjs";
import { createReceiptRepo, entryScript, pluginVersion, type ReceiptRepo } from "./adr0149eRepo";

vi.setConfig({ testTimeout: 240_000 });
let repo: ReceiptRepo, scratch: string;
beforeEach(async (context) => { repo = await createReceiptRepo(context.signal); scratch = mkdtempSync(join(tmpdir(), "mdpro-f1h1-")); });
afterEach(async () => { await repo.close(); rmSync(scratch, { recursive: true, force: true }); });

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (check: () => boolean, ms: number) => { const end = Date.now() + ms; while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); return check(); };
const replayWorktrees = async () => (await repo.git("worktree", "list", "--porcelain")).stdout.split("\n").filter((line) => line.includes("-replay-"));

/** A receipt whose base run blocks for 60 s while `flag` exists; its Vitest worker writes `pidFile`. */
async function blockingReceipt(flag: string, pidFile: string) {
  repo.write("src/calc.mjs", "export const v = () => 1;\n");
  await repo.commit("base");
  await repo.git("branch", "-f", "master", "HEAD");
  repo.write("tests/new.test.ts", `import { existsSync, writeFileSync } from "node:fs";\nimport { expect, it } from "vitest";\nimport { v } from "../src/calc.mjs";\nit("v", () => {\n  writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\n  if (existsSync(${JSON.stringify(flag)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60_000);\n  expect(v()).toBe(2);\n});\n`);
  await repo.commit("spec");
  const recorded = await repo.entry("record", "--id", "A", "--test", "tests/new.test.ts");
  expect(recorded.status, recorded.output).toBe(0);
  repo.write("src/calc.mjs", "export const v = () => 2;\n");
  await repo.commit("fix");
  unlinkSync(pidFile);
  writeFileSync(flag, "block");
}

describe("ADR0149E-F1H1 the launcher bound covers what it wraps", () => {
  it("derives the bound from the replay runs and the lane timeouts, never the old 660 s", () => {
    expect(locks.launcherBoundMs).toBeTypeOf("function");
    expect(locks.guardianBoundMs).toBeTypeOf("function");
    expect(locks.launcherBoundMs("replay", { MDPRO_REPLAY_TIMEOUT_MS: "900000" }, 900_000)).toBeGreaterThanOrEqual(3 * 900_000);
    expect(locks.launcherBoundMs("replay", { MDPRO_REPLAY_TIMEOUT_MS: "1000" }, 900_000)).toBeGreaterThanOrEqual(3 * 1000);
    expect(locks.guardianBoundMs(900_000)).toBeGreaterThan(900_000);
    for (const action of ["record", "verify"]) expect(locks.launcherBoundMs(action, {}, 900_000)).toBeGreaterThan(locks.guardianBoundMs(900_000));
    expect(locks.launcherBoundMs("replay", { MDPRO_UNIT_RED_LAUNCH_TIMEOUT_MS: "5000" }, 900_000)).toBe(5000);
  });
});

describe.skipIf(!pluginVersion)("ADR0149E-F1H1 a stopped replay leaves nothing behind", () => {
  it("at the launcher bound: kills the run, removes the worktree, and the next replay proceeds", async () => {
    const flag = join(scratch, "block"), pidFile = join(scratch, "pid"), root = join(scratch, "wt");
    await blockingReceipt(flag, pidFile);
    const env = { MDPRO_REPLAY_ROOT: root, MDPRO_UNIT_RED_KILL_GRACE_MS: "500" };
    const stopped = await repo.run(process.execPath, [entryScript, "replay", "--id", "A", "--cwd", repo.root], { ...env, MDPRO_UNIT_RED_LAUNCH_TIMEOUT_MS: "9000" }, 45_000);
    expect(stopped.status).not.toBe(0);
    expect(stopped.output).toMatch(/stopped at the launcher bound \(9000 ms\)/);
    const worker = existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8")) : 0;
    expect(worker).toBeGreaterThan(0);
    expect(await until(() => !alive(worker), 3000)).toBe(true);
    expect(await replayWorktrees()).toEqual([]);
    unlinkSync(flag);
    const again = await repo.run(process.execPath, [entryScript, "replay", "--id", "A", "--cwd", repo.root], env, 60_000);
    expect(again.output).not.toMatch(/already exists/);
    expect(again.status, again.output).toBe(0);
  });

  it("on SIGTERM to the entry: dies by SIGTERM, kills the run and removes the worktree", async () => {
    const flag = join(scratch, "block"), pidFile = join(scratch, "pid"), root = join(scratch, "wt");
    await blockingReceipt(flag, pidFile);
    const cli = spawn(process.execPath, [entryScript, "replay", "--id", "A", "--cwd", repo.root], { cwd: repo.root, detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, VITEST_MAX_WORKERS: "1", MDPRO_REPLAY_ROOT: root, MDPRO_UNIT_RED_KILL_GRACE_MS: "500" } });
    const closed = new Promise<NodeJS.Signals | null>((done) => cli.once("close", (_code, signal) => done(signal)));
    let worker = 0;
    try {
      expect(await until(() => existsSync(pidFile), 60_000)).toBe(true);
      worker = Number(readFileSync(pidFile, "utf8"));
      process.kill(cli.pid!, "SIGTERM");
      expect(await Promise.race([closed, new Promise((r) => setTimeout(() => r("still running"), 20_000))])).toBe("SIGTERM");
      expect(await until(() => !alive(worker), 5000)).toBe(true);
      expect(await replayWorktrees()).toEqual([]);
    } finally {
      try { process.kill(-cli.pid!, "SIGKILL"); } catch {}
      if (worker && alive(worker)) { try { process.kill(worker, "SIGKILL"); } catch {} }
      await repo.git("worktree", "prune");
    }
  });
});
