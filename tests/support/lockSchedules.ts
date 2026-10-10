/**
 * Deterministic fs interleavings for the D82-WI-1 lock-release tests
 * (`scripts/control/lock.mjs`). Shared by the unit and slow lock tests so the
 * schedule domain is never copied (ADR-0050).
 *
 * `interleave(parent, shots)` puts pass-through spies on the default `node:fs`
 * object (the one `lock.mjs` imports). Every fs action stays real: a spy only
 * counts the calls whose path is inside `parent`, runs each shot's competitor
 * once at its chosen point, then calls the real method. A competitor's own fs
 * calls pass straight through (a re-entrancy guard) and are not counted, but
 * the rename recorder logs them too.
 *
 * Matrix: `.claude/tdd-guardian/tests-20261010-103136.md`, D82-WI-1.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";

export const A = "a".repeat(25);
export const B = "b".repeat(25);
export const C = "c".repeat(25);
export const N1 = "ab".repeat(32);
export const N2 = "01".repeat(32);
export const N3 = "cd".repeat(32);
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const SECRETS = [N1, N2, N3, sha256(N1), sha256(N2), sha256(N3)];

const METHODS = ["readFileSync", "renameSync", "linkSync", "unlinkSync", "lstatSync"] as const;
type Method = (typeof METHODS)[number];

/** Where a shot fires: a global call index, or a named point. */
export type At = number | "pre-rename" | "pre-mutate" | "pre-link";
export type Shot = { at: At; competitor: () => void };

const dirs: string[] = [];
export function freshParent(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "lk-"));
  dirs.push(d);
  return d;
}
export function cleanupParents(): void {
  for (const d of dirs.splice(0)) {
    try {
      fs.chmodSync(d, 0o700);
    } catch {
      // already gone
    }
    fs.rmSync(d, { recursive: true, force: true });
  }
}
export const lockFile = (parent: string) => path.join(parent, ".lock");
export const tombsIn = (parent: string) => fs.readdirSync(parent).filter((n) => n.endsWith(".tomb")).sort();

/** The exact bytes `acquireLock` writes for `{ run, nonce }`. */
export const recordBytes = (run: string, nonce: string) => JSON.stringify({ run, nonceDigest: sha256(nonce) });

export function thrown(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return "no throw";
}

/** Run `fn`, returning its value or `{ error: message }`. */
export function outcome(fn: () => string): string | { error: string } {
  try {
    return fn();
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export type Interleave = {
  /** Calls counted so far (inside `parent`, outside a competitor). */
  readonly calls: number;
  /** How many times each shot fired, by shot index. */
  readonly fired: number[];
  /** The global index at which each shot fired (undefined if it never did). */
  readonly firedAt: (number | undefined)[];
  /** Destination basenames of every `renameSync` into `parent`, competitors' included. */
  readonly renames: string[];
  /** Fire every numeric shot that has not fired yet (k = n: after the run), then restore. */
  finish(): void;
};

export function interleave(parent: string, shots: Shot[]): Interleave {
  const lock = lockFile(parent);
  const inParent = (p: unknown) => typeof p === "string" && (p === parent || p.startsWith(parent + path.sep));
  const real = Object.fromEntries(METHODS.map((m) => [m, fs[m]])) as Record<Method, (...a: unknown[]) => unknown>;
  const state = { calls: 0, fired: shots.map(() => 0), firedAt: shots.map(() => undefined as number | undefined), renames: [] as string[] };
  let inside = false;
  const fire = (i: number, idx: number) => {
    state.fired[i]++;
    state.firedAt[i] = idx;
    inside = true;
    try {
      shots[i].competitor();
    } finally {
      inside = false;
    }
  };
  const hits = (at: At, m: Method, args: unknown[], idx: number) => {
    if (typeof at === "number") return at === idx;
    if (at === "pre-link") return m === "linkSync";
    if (at === "pre-rename") return m === "renameSync" && args[0] === lock;
    return (m === "renameSync" || m === "unlinkSync") && args[0] === lock;
  };
  const spies = METHODS.map((m) =>
    vi.spyOn(fs, m).mockImplementation(((...args: unknown[]) => {
      if (m === "renameSync" && inParent(args[1])) state.renames.push(path.basename(String(args[1])));
      if (!inside && inParent(args[0])) {
        const idx = state.calls++;
        shots.forEach((s, i) => {
          if (state.fired[i] === 0 && hits(s.at, m, args, idx)) fire(i, idx);
        });
      }
      return real[m](...args);
    }) as never),
  );
  return {
    get calls() {
      return state.calls;
    },
    fired: state.fired,
    firedAt: state.firedAt,
    renames: state.renames,
    finish() {
      shots.forEach((s, i) => {
        if (state.fired[i] === 0 && typeof s.at === "number" && s.at >= state.calls) fire(i, state.calls);
      });
      for (const s of spies) s.mockRestore();
    },
  };
}

/**
 * Run `release` under `shots`; always restores the spies.
 * @returns the release outcome plus the recorder state
 */
export function runSchedule(parent: string, shots: Shot[], release: () => string) {
  const il = interleave(parent, shots);
  let result: string | { error: string };
  try {
    result = outcome(release);
  } finally {
    il.finish();
  }
  return { result, calls: il.calls, fired: [...il.fired], firedAt: [...il.firedAt], renames: [...il.renames] };
}

/** Every regular file directly in `parent`, by name → bytes (a `.lock` directory is skipped). */
export function finalFiles(parent: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const n of fs.readdirSync(parent).sort()) {
    const p = path.join(parent, n);
    if (fs.lstatSync(p).isFile()) out.set(n, fs.readFileSync(p, "latin1"));
  }
  return out;
}
