/**
 * Shared plumbing for the D177 hook-spool tests: temp dirs, free ports, a
 * receiver.py child process, and small file readers. Everything binds to
 * 127.0.0.1 and lives under os.tmpdir(); no real hook dir or token is touched.
 */
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const HOOKS_DIR = path.join(REPO_ROOT, "scripts", "device", "hooks");
export const RECEIVER = path.join(HOOKS_DIR, "receiver.py");
export const PUSH = path.join(HOOKS_DIR, "push.mjs");
export const BUILDER = path.join(HOOKS_DIR, "build-mini-settings.mjs");
export const LAST = path.join(HOOKS_DIR, "last-dtrack.sh");
export const WAIT = path.join(HOOKS_DIR, "wait-dtrack.sh");

export function makeTemp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `d177-${prefix}-`));
}

export function fakeToken(): string {
  return `fake-${crypto.randomBytes(16).toString("hex")}`;
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port });
    sock.once("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => resolve(false));
  });
}

export async function waitFor(cond: () => boolean | Promise<boolean>, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return cond();
}

export interface Receiver {
  child: ChildProcess;
  port: number;
  dir: string;
  url: string;
}

/** Starts receiver.py on `dir` (token file must already exist) and waits until it listens. */
export async function startReceiver(dir: string, home: string): Promise<Receiver> {
  const port = await freePort();
  const child = spawn("python3", [RECEIVER], {
    env: {
      ...process.env,
      HOME: home,
      MDPRO_HOOK_DIR: dir,
      MDPRO_HOOK_BIND: "127.0.0.1",
      MDPRO_HOOK_PORT: String(port),
    },
    stdio: "ignore",
  });
  const up = await waitFor(() => child.exitCode === null && canConnect(port), 5000);
  if (!up) {
    child.kill("SIGKILL");
    throw new Error(`receiver did not listen on ${port} (exit ${child.exitCode})`);
  }
  return { child, port, dir, url: `http://127.0.0.1:${port}/hook` };
}

export async function stopReceiver(r: Receiver | undefined): Promise<void> {
  if (!r || r.child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => r.child.once("exit", () => resolve()));
  r.child.kill("SIGTERM");
  const ok = await Promise.race([exited.then(() => true), new Promise<boolean>((res) => setTimeout(() => res(false), 2000))]);
  if (!ok) r.child.kill("SIGKILL");
}

export function readJsonl(file: string): Record<string, unknown>[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

export function readText(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

export function rmTemp(dir: string | undefined): void {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
}
