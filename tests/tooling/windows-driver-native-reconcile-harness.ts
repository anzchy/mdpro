import { execFile, spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { linuxStartTicks } from "./windows-driver-native-linux-start";
import { supervisorFixture } from "./windows-driver-native-supervisor-harness";

const execFileAsync = promisify(execFile);

// Runs the real native-reconcile.ps1 inside a supervisor fixture copy. Only the kernel-job
// and Scheduler OS boundaries are substitutes (see windows-driver-native-supervisor-harness.ts),
// plus, on Linux, the process start time (windows-driver-native-linux-start.ts).
export const RUN = "a".repeat(32);
export const latchPath = (dir: string) => path.join(dir, "native-session-blocked.json");
export const runPath = (dir: string, id: string, ...rest: string[]) => path.join(dir, "runs", id, ...rest);
export async function exists(file: string) { try { await access(file); return true; } catch { return false; } }

export async function reconcileDir(scenario = "success") { return (await supervisorFixture(scenario)).dir; }

/** A latch in ui-run.ps1's outcome shape, plus the run's directory and owned-process manifest. */
export async function writeLatch(dir: string, id: string, fields: Record<string, unknown> = {}, manifest: unknown = []) {
  await mkdir(runPath(dir, id), { recursive: true });
  const latch = { runId: id, status: "failed", phase: "fixture", step: 1, op: "clickat", elapsedMs: 1, completedSteps: 0,
    inputOutcome: "none", heldInput: "released", cleanup: "failed", ...fields };
  await writeFile(latchPath(dir), JSON.stringify(latch));
  if (manifest !== null) await writeFile(runPath(dir, id, "owned-processes.json"), JSON.stringify(manifest));
  return latch;
}

export function reconcile(dir: string, args: string[], env: Record<string, string> = {}) {
  const child = spawn("pwsh", ["-NoProfile", "-File", path.join(dir, "native-reconcile.ps1"), ...args], {
    env: { ...process.env, TEST_ROOT: dir, TEST_RUN_ID: RUN, TEST_SCENARIO: "reconcile", ...env },
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", (v) => { stdout += String(v); }); child.stderr.on("data", (v) => { stderr += String(v); });
  return new Promise<{ status: number | null; stdout: string; stderr: string; result: Record<string, unknown> | null }>((done) => {
    child.on("close", (status) => {
      let result: Record<string, unknown> | null = null;
      try { result = JSON.parse(stdout.trim().split("\n").at(-1) ?? ""); } catch { result = null; }
      done({ status, stdout, stderr, result });
    });
  });
}

/**
 * The pid, birth and exe of a live process, read the way NativeJobScope.Snapshot records them; on Linux the
 * birth is the kernel start time the fixture's reconcile also reads (windows-driver-native-linux-start.ts).
 */
export async function identity(pid: number) {
  const [birth, exe] = (await execFileAsync("pwsh", ["-NoProfile", "-Command", `${linuxStartTicks}
    $p=Get-Process -Id ${pid}; if ($IsLinux) { (Get-LinuxStartTicks ${pid}).ToString() } else { $p.StartTime.ToUniversalTime().Ticks.ToString() }; $p.Path`],
  { encoding: "utf8" })).stdout.trim().split(/\r?\n/);
  return { pid, birth, exe };
}
