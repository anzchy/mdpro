/**
 * Shared fixtures for the D174 doctor lock-leftover tests: a real runs parent
 * under `makeHome()`, real holder pids (a live child, an exited child, pid 1
 * for EPERM), the `{ pid, token }` and tomb record bodies, and two ways to run
 * the real `doctor` driver over it. Nothing in the launcher is faked; only
 * `deps.procFacts` (unused by the leftover lines) is the stock fake.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fakeProcFacts, makeHome } from "./launcherFakes";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { collectFacts, run } from "../../scripts/control/doctor.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { buildLayout } from "../../scripts/control/buildSteps.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { runsParent } from "../../scripts/control/runDir.mjs";

/** The token every seeded record carries; it must never reach doctor's output. */
export const TOKEN = "0123456789abcdef";
/** A digest a seeded tomb carries; it must never reach doctor's output either. */
export const DIGEST = "d".repeat(64);
export const RUN = "a".repeat(25);
/** Whether `kill(1, 0)` gives EPERM here (it does not under root). */
export const canEperm = process.getuid?.() !== 0;

export const holderBody = (pid: number) => JSON.stringify({ pid, token: TOKEN });
export const tombBody = (run: string) => JSON.stringify({ run, nonceDigest: DIGEST });

type Disposer = () => void | Promise<void>;
export type Env = { home: string; parent: string; repo: string; dispose: () => Promise<void> };

/** A home with an existing runs parent and a non-git repo root holding the verify bundle dir. */
export function makeEnv(): Env {
  const disposers: Disposer[] = [];
  const h = makeHome();
  disposers.push(h.cleanup);
  const parent: string = runsParent(h.real);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const repo = fs.realpathSync(fs.mkdtempSync("/tmp/dlo-"));
  disposers.push(() => fs.rmSync(repo, { recursive: true, force: true }));
  fs.mkdirSync(buildLayout(repo, "verify").app, { recursive: true });
  return {
    home: h.home,
    parent,
    repo,
    dispose: async () => {
      for (const d of disposers.reverse()) await d();
    },
  };
}

/** Write `body` at `<parent>/<name>` (mode 0600). */
export function put(env: Env, name: string, body: string): string {
  const file = path.join(env.parent, name);
  fs.writeFileSync(file, body, { mode: 0o600 });
  return file;
}

/** A child that stays alive until `stop()`. */
export async function liveChild(): Promise<{ pid: number; stop: () => Promise<void> }> {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1e9)"], { stdio: "ignore" });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", () => resolve());
    child.once("error", reject);
  });
  const pid = child.pid as number;
  const stop = () =>
    new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once("exit", () => resolve());
      child.kill("SIGKILL");
    });
  return { pid, stop };
}

/** The pid of a child that has already exited and been reaped (ESRCH). */
export async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise<void>((resolve, reject) => {
    child.once("exit", () => resolve());
    child.once("error", reject);
  });
  return child.pid as number;
}

export type Result = { exit: number; lines: string[] };

/** The real doctor over `env` (its verdict is NOT VERIFIED: the repo is not a git worktree). */
export async function doctor(env: Env): Promise<Result> {
  const lines: string[] = [];
  const r = await run([], {
    repoRoot: env.repo,
    passwdHome: env.home,
    siSockPath: `/tmp/dlo-${process.pid}-absent.sock`,
    procFacts: fakeProcFacts(),
    out: (l: string) => lines.push(l),
  });
  return { exit: r.exit, lines };
}

/**
 * The real doctor whose runs-parent facts are collected for real, with the
 * bundle, manifest and source-tree facts set to their good values, so the
 * verdict depends on the runs parent alone (as in the LA-05 row 3 case).
 */
export async function passingDoctor(env: Env): Promise<Result> {
  const lines: string[] = [];
  const r = await run([], {
    repoRoot: env.repo,
    passwdHome: env.home,
    siSockPath: `/tmp/dlo-${process.pid}-absent.sock`,
    procFacts: fakeProcFacts(),
    collectFacts: async (d: unknown) => ({
      ...(await collectFacts(d)),
      bundlePresent: true,
      manifest: { ok: true, buildId: "b1", profile: "verify" },
      sourceTreeMatches: true,
    }),
    out: (l: string) => lines.push(l),
  });
  return { exit: r.exit, lines };
}

/** Only the `[info] lock leftover …` lines. */
export const leftoverLines = (lines: string[]) => lines.filter((l) => l.startsWith("[info] lock leftover "));
