/** Run load-guard subprocess fixtures without blocking Vitest's heartbeat. */
import { spawn, type ChildProcess } from "node:child_process";

export function waitForExit(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => child.once("exit", resolve));
}

export function runChild(command: string, args: string[], options: {
  env?: NodeJS.ProcessEnv;
  encoding?: string;
  timeout?: number;
} = {}): Promise<{ status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: options.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (part: Buffer) => { stdout += part.toString(); });
    child.stderr.on("data", (part: Buffer) => { stderr += part.toString(); });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Child fixture timed out: ${command}`));
    }, options.timeout ?? 30000);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, stdout, stderr });
    });
  });
}
