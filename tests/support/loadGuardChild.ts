/**
 * Purpose: run subprocess fixtures without blocking Vitest's heartbeat. Each child gets its own process group; a
 * timeout or the test's abort signal (Vitest's `context.signal`, #727) TERMs the group, KILLs it after
 * STOP_GRACE_MS, and rejects.
 */
import { spawn, type ChildProcess } from "node:child_process";

/** How long a stopped fixture's group gets between TERM and KILL. */
export const STOP_GRACE_MS = 1_000;

/** Resolve with the child's exit code. On abort, KILL its group (or the child, when it has none) and reject. */
export function waitForExit(child: ChildProcess, signal?: AbortSignal): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    const abort = () => {
      try { process.kill(-child.pid!, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      reject(new Error(`Child fixture aborted: pid ${child.pid}`));
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    child.once("exit", (code) => { signal?.removeEventListener("abort", abort); resolve(code); });
  });
}

export function runChild(command: string, args: string[], options: {
  env?: NodeJS.ProcessEnv;
  encoding?: string;
  timeout?: number;
  /** A test's `context.signal`: aborting it stops the child and rejects (#727). */
  signal?: AbortSignal;
} = {}): Promise<{ status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // Its own process group, so a stop reaches every descendant.
    const child = spawn(command, args, { env: options.env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", (part: Buffer) => { stdout += part.toString(); });
    child.stderr.on("data", (part: Buffer) => { stderr += part.toString(); });
    let grace: NodeJS.Timeout | undefined;
    // TERM the whole group, then KILL whatever is still there after the grace.
    const stop = (why: string) => {
      try { process.kill(-child.pid!, "SIGTERM"); } catch { /* group already gone */ }
      grace ??= setTimeout(() => { try { process.kill(-child.pid!, "SIGKILL"); } catch { /* drained */ } }, STOP_GRACE_MS);
      reject(new Error(`Child fixture ${why}: ${command}`));
    };
    const timer = setTimeout(() => stop("timed out"), options.timeout ?? 30000);
    const abort = () => stop("aborted");
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (status, signal) => {
      clearTimeout(timer); // a stop's KILL grace still runs: a descendant may outlive the pipes
      options.signal?.removeEventListener("abort", abort);
      resolve({ status, signal, stdout, stderr });
    });
  });
}
