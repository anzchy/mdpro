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
 * D105-WI-2: a shot is `protocol: "raw"` (default) or `"in"`. A raw
 * competitor models a writer that ignores `.lock.mutex` (an older checkout):
 * it fires at its point even inside the caller's held mutex. An `"in"`
 * competitor follows the protocol, so it would wait for the mutex: when its
 * point falls while the caller holds `.lock.mutex` (between the caller's
 * successful `wx` create and its unlink), it is deferred and fires right after
 * the real unlink of `.lock.mutex`, in shot order. An `"in"` shot whose point
 * never came fires at `finish()`, after the numeric k = n shots, in shot order.
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

// D105-WI-1: `writeFileSync` / `openSync` are counted too, so a schedule can
// land between the `.lock.mutex` (or `.lock.mutex.break`) create and the next
// step. Sweeps recompute their index range by a dry run; named points are unaffected.
const METHODS = ["readFileSync", "renameSync", "linkSync", "unlinkSync", "lstatSync", "writeFileSync", "openSync"] as const;
type Method = (typeof METHODS)[number];

/** Where a shot fires: a global call index, or a named point. */
export type At = number | "pre-rename" | "pre-mutate" | "pre-link";
// rule 12: D105-WI-2 adds the optional `protocol` (default "raw", today's behaviour).
export type Shot = { at: At; competitor: () => void; protocol?: "in" | "raw" };

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

/**
 * D105-WI-2: `acquireLock`'s observable contract without `.lock.mutex` — a `wx`
 * create of the exact record, else `lock held by run X` / `lock unreadable` — as
 * a launch from an older checkout would behave. A competitor that fires inside a
 * lock section uses it: `acquireLock` there is now a re-entry and refuses at once.
 */
export function rawAcquire(parent: string, run: string, nonce: string): void {
  try {
    fs.writeFileSync(lockFile(parent), recordBytes(run, nonce), { flag: "wx", mode: 0o600 });
  } catch (e) {
    if ((e as { code?: unknown }).code !== "EEXIST") throw e;
    let held: unknown = null;
    try {
      held = JSON.parse(fs.readFileSync(lockFile(parent), "utf8"))?.run;
    } catch {
      // unreadable
    }
    throw new Error(typeof held === "string" && held !== "" ? `lock held by run ${held}` : "lock unreadable");
  }
}

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
  // D105-WI-2: before the restore, `finish()` also fires every `"in"` shot still deferred, or whose point never came, in shot order.
  finish(): void;
};

export function interleave(parent: string, shots: Shot[]): Interleave {
  const lock = lockFile(parent);
  const inParent = (p: unknown) => typeof p === "string" && (p === parent || p.startsWith(parent + path.sep));
  const real = Object.fromEntries(METHODS.map((m) => [m, fs[m]])) as Record<Method, (...a: unknown[]) => unknown>;
  const state = { calls: 0, fired: shots.map(() => 0), firedAt: shots.map(() => undefined as number | undefined), renames: [] as string[] };
  let inside = false;
  // D105-WI-2: `.lock.mutex` held by the caller (not by a competitor), and the "in" shots waiting for it.
  const mutex = path.join(parent, ".lock.mutex");
  const deferred = shots.map(() => false);
  let held = false;
  const fire = (i: number, idx: number) => {
    if (deferred[i]) return;
    if (shots[i].protocol === "in" && held) {
      deferred[i] = true;
      state.firedAt[i] = idx;
      return;
    }
    state.fired[i]++;
    state.firedAt[i] = idx;
    inside = true;
    try {
      shots[i].competitor();
    } finally {
      inside = false;
    }
  };
  /** Fire every deferred "in" shot, in shot order, at the index it was due. */
  const wake = () =>
    shots.forEach((_, i) => {
      if (!deferred[i]) return;
      deferred[i] = false;
      fire(i, state.firedAt[i] as number);
    });
  /** The caller's own create / unlink of `.lock.mutex`: real call, then track `held`. */
  const track = (m: Method, args: unknown[]) => {
    const value = real[m](...args);
    held = m === "writeFileSync";
    if (!held) wake();
    return value;
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
      if (!inside && args[0] === mutex && (m === "writeFileSync" || m === "unlinkSync")) return track(m, args);
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
      held = false; // D105-WI-2: the caller is done, so nothing it holds can defer a shot any more.
      shots.forEach((s, i) => {
        if (state.fired[i] === 0 && typeof s.at === "number" && s.at >= state.calls) fire(i, state.calls);
      });
      // D105-WI-2: then every "in" shot still waiting, or whose point never came.
      shots.forEach((s, i) => {
        if (state.fired[i] !== 0 || s.protocol !== "in") return;
        deferred[i] = false;
        fire(i, state.firedAt[i] ?? state.calls);
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

/**
 * D105-WI-3: every `unlinkSync` of a `.tomb` path throws `code`; any other unlink
 * is real. The caller restores it (`vi.restoreAllMocks()`).
 */
export function failTombUnlink(code: string): void {
  const realUnlink = fs.unlinkSync;
  vi.spyOn(fs, "unlinkSync").mockImplementation(((p: fs.PathLike) => {
    if (typeof p === "string" && p.endsWith(".tomb")) throw Object.assign(new Error(`${code}: injected fault, unlink`), { code });
    return realUnlink(p);
  }) as never);
}
