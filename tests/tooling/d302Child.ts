/**
 * Purpose: Run nested test subprocesses without blocking a Vitest worker, and
 * reap their entire process group before an owning test removes its fixture.
 * @coordinates-with tests/tooling/unit-red-phase.test.ts, tests/tooling/d302-owner-descendant.test.ts
 */
import { spawn } from "node:child_process";

export interface ChildResult { status: number | null; stdout: string; stderr: string }
export interface ChildOptions { cwd: string; env?: NodeJS.ProcessEnv; timeout?: number; encoding?: "utf8" }

function groupAlive(pid: number) { try { process.kill(-pid, 0); return true; } catch { return false; } }
function signalGroup(pid: number, signal: NodeJS.Signals) { try { process.kill(-pid, signal); } catch {} }
async function drainGroup(pid: number) {
  if (!groupAlive(pid)) return;
  signalGroup(pid, "SIGTERM");
  const start = Date.now();
  while (groupAlive(pid) && Date.now() - start < 500) await new Promise((resolve) => setTimeout(resolve, 20));
  if (groupAlive(pid)) signalGroup(pid, "SIGKILL");
  while (groupAlive(pid) && Date.now() - start < 2_500) await new Promise((resolve) => setTimeout(resolve, 20));
  if (groupAlive(pid)) throw Error(`D302 child group ${pid} did not close`);
}

/** One runner belongs to one Vitest test context; never reuse it after close. */
export function createOwnerChildRunner(signal: AbortSignal) {
  let closed = false;
  const groups = new Set<number>();
  const pending = new Set<Promise<ChildResult>>();
  function run(command: string, args: string[], options: ChildOptions): Promise<ChildResult> {
    if (closed || signal.aborted) return Promise.reject(Error("D302 owner closed"));
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, detached: true, signal, stdio: ["ignore", "pipe", "pipe"] });
    const pid = child.pid;
    if (pid) groups.add(pid);
    const promise = new Promise<ChildResult>((done, reject) => {
      let stdout = "", stderr = "", timedOut = false;
      child.stdout?.setEncoding("utf8"); child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
      child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
      child.on("error", (error) => { stderr += error.message; });
      const timeout = options.timeout && pid ? setTimeout(() => { timedOut = true; void drainGroup(pid).catch(() => {}); }, options.timeout) : null;
      timeout?.unref();
      const onAbort = () => { if (pid) void drainGroup(pid).catch(() => {}); };
      signal.addEventListener("abort", onAbort, { once: true });
      child.once("close", async (status) => {
        if (timeout) clearTimeout(timeout);
        signal.removeEventListener("abort", onAbort);
        try {
          if (pid && (timedOut || closed || signal.aborted)) await drainGroup(pid);
          if (closed || signal.aborted) reject(Error("D302 owner cancelled"));
          else done({ status: timedOut ? null : status, stdout, stderr });
        } catch (error) { reject(error); }
      });
    });
    pending.add(promise);
    promise.then(() => pending.delete(promise), () => pending.delete(promise));
    return promise;
  }
  async function close() {
    closed = true;
    await Promise.all([...groups].map(drainGroup));
    await Promise.allSettled([...pending]);
  }
  return { run, close, get closed() { return closed || signal.aborted; } };
}
