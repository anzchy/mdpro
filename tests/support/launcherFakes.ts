/**
 * Shared boundary helpers for the ADR-0047 launcher tests (WI-003). Only the
 * parts a work item needs are added; WI-4 adds `makeStaleSocket`, WI-5 adds
 * `makeHome` and `fakeProcFacts`, WI-6 adds `fakeClock`, `fixedRandom`,
 * `fakeSpawn` and `recordingKill`, WI-7 adds `scriptedProcFacts` and
 * `timedKill`. Parsers,
 * the lock, ownership verdicts and the fs are never faked here.
 */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";

/**
 * Leave a stale unix socket file at `sockPath`: a `node` child listens on it
 * and is SIGKILLed, so the file outlives its listener (no `close()` ran).
 */
export function makeStaleSocket(sockPath: string): Promise<void> {
  const src =
    `const s = require("node:net").createServer();` +
    `s.listen(${JSON.stringify(sockPath)}, () => process.stdout.write("ready"));`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", src], { stdio: ["ignore", "pipe", "inherit"] });
    child.on("error", reject);
    child.stdout.once("data", () => child.kill("SIGKILL"));
    child.on("exit", (_code, signal) =>
      signal === "SIGKILL" ? resolve() : reject(new Error(`listener exited without SIGKILL`)),
    );
  });
}

/**
 * The fixture passwd home (matrix convention "Fixture home", R2): a lexical
 * `/tmp/lXXXXXX/h` symlink to a realpath of exactly `realBytes` bytes, in a
 * different mkdtemp dir, so lexical !== realpath on every platform. Asserts
 * its own postconditions; `cleanup()` removes both mkdtemp dirs.
 */
export function makeHome({ realBytes = 22 }: { realBytes?: number } = {}): {
  home: string;
  real: string;
  cleanup: () => void;
} {
  const base = fs.realpathSync(fs.mkdtempSync("/tmp/l"));
  const k = realBytes - Buffer.byteLength(base) - 1;
  if (k < 1) throw new Error("makeHome: base too long");
  const real = path.join(base, "r".repeat(k));
  fs.mkdirSync(real, { mode: 0o700 });
  const linkDir = fs.mkdtempSync("/tmp/l");
  const home = path.join(linkDir, "h");
  fs.symlinkSync(real, home);
  const cleanup = () => {
    fs.rmSync(linkDir, { recursive: true, force: true });
    fs.rmSync(base, { recursive: true, force: true });
  };
  const ok =
    fs.realpathSync(home) === real &&
    home !== real &&
    Buffer.byteLength(real) === realBytes &&
    !real.includes(home);
  if (!ok) {
    cleanup();
    throw new Error("makeHome: postcondition failed");
  }
  return { home, real, cleanup };
}

type Liveness = boolean | "unknown";
type PidFacts = { alive: Liveness; lstart?: string; exe?: string };
type ProbeResult = "live" | "stale" | "absent" | "unknown";

/** The launcher drivers' `deps.procFacts` boundary shape. */
export type ProcFacts = {
  alive: (pid: number) => Promise<Liveness>;
  lstart: (pid: number) => Promise<string>;
  exe: (pid: number) => Promise<string>;
  scan: () => Promise<number[] | "unknown">;
  probe: (sockPath: string) => Promise<ProbeResult>;
};

/**
 * Canned process facts per pid, plus the verify-binary scan and the socket
 * probe. An unlisted pid is dead with unknown start time and exe. `probe` may
 * be a function, so a test can pass the real `probeSocket`.
 */
export function fakeProcFacts(
  table: {
    pids?: Record<number, PidFacts>;
    scan?: number[] | "unknown";
    probe?: ProbeResult | ((sockPath: string) => Promise<ProbeResult>);
  } = {},
): ProcFacts {
  const pids = table.pids ?? {};
  const probe = table.probe ?? "absent";
  return {
    alive: async (pid) => pids[pid]?.alive ?? false,
    lstart: async (pid) => pids[pid]?.lstart ?? "unknown",
    exe: async (pid) => pids[pid]?.exe ?? "unknown",
    scan: async () => table.scan ?? [],
    probe: async (sockPath) => (typeof probe === "function" ? probe(sockPath) : probe),
  };
}

/**
 * A fake clock (WI-6): `sleep(ms)` advances `now` by `ms`, fires any callback
 * scheduled with `at(t, fn)` whose time has come, and resolves on the next
 * macrotask, so a fake child's queued `exit` / `error` is seen in order.
 */
export type FakeClock = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  at: (t: number, fn: () => void) => void;
};

export function fakeClock(start = 0): FakeClock {
  let t = start;
  let timers: { at: number; fn: () => void }[] = [];
  const fire = () => {
    const due = timers.filter((x) => x.at <= t);
    timers = timers.filter((x) => x.at > t);
    for (const x of due) x.fn();
  };
  return {
    now: () => t,
    at: (at, fn) => {
      timers.push({ at, fn });
    },
    sleep: async (ms) => {
      t += ms;
      fire();
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
  };
}

/**
 * `deps.randomBytes` returning the listed buffers in order (matrix R1). A draw
 * of a different size than the next buffer, or one draw too many, throws, so
 * the draw order (16 bytes for the run name, then 32 for the nonce) is pinned.
 */
export function fixedRandom(buffers: Uint8Array[]): ((n: number) => Uint8Array) & { draws: () => number } {
  let i = 0;
  const draw = (n: number) => {
    if (i >= buffers.length) throw new Error(`fixedRandom: draw ${i + 1} of ${buffers.length}`);
    const next = buffers[i];
    if (next.length !== n) throw new Error(`fixedRandom: asked ${n} bytes, next is ${next.length}`);
    i += 1;
    return Uint8Array.from(next);
  };
  return Object.assign(draw, { draws: () => i });
}

/** A fake child process handle: records its signals, emits `exit` / `error` on the next tick. */
export class FakeChild extends EventEmitter {
  readonly pid: number;
  readonly signals: string[] = [];
  constructor(pid: number) {
    super();
    this.pid = pid;
  }
  kill(sig: string | number = "SIGTERM"): boolean {
    this.signals.push(String(sig));
    return true;
  }
  unref(): void {}
  exitSoon(code: number): void {
    process.nextTick(() => this.emit("exit", code, null));
  }
  errorSoon(code: string): void {
    process.nextTick(() => this.emit("error", Object.assign(new Error(`spawn ${code}`), { code })));
  }
}

export type SpawnOpts = { env?: Record<string, string | undefined>; stdio?: unknown[]; detached?: boolean };
export type SpawnCall = { cmd: string; args: string[]; opts: SpawnOpts; child: FakeChild; seen: Record<string, unknown> };
export type SpawnScript = (call: SpawnCall, child: FakeChild) => void;

/**
 * A fake `child_process.spawn`. Each call is recorded (with a `seen` bag the
 * script fills with fs facts at call time) before `script` runs; a script
 * that throws makes the spawn itself throw. Pids are handed out in order,
 * the last one repeating.
 */
export function fakeSpawn(
  script: SpawnScript,
  pids: number[] = [4242],
): ((cmd: string, args: string[], opts: SpawnOpts) => FakeChild) & { calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  const spawnFn = (cmd: string, args: string[], opts: SpawnOpts) => {
    const child = new FakeChild(pids[Math.min(calls.length, pids.length - 1)]);
    const call: SpawnCall = { cmd, args: [...args], opts, child, seen: {} };
    calls.push(call);
    script(call, child);
    return child;
  };
  return Object.assign(spawnFn, { calls });
}

/** A recording stand-in for `process.kill` (`deps.kill`). */
export function recordingKill(): ((pid: number, sig?: string | number) => boolean) & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  const kill = (pid: number, sig?: string | number) => {
    calls.push([pid, sig]);
    return true;
  };
  return Object.assign(kill, { calls });
}

/**
 * `deps.procFacts` whose per-pid facts come from `script(pid)`, evaluated at
 * call time (WI-7), so a test can follow a timeline on the fake clock or react
 * to the signals a pid has received. `undefined` reads as dead and unknown.
 */
export function scriptedProcFacts(script: (pid: number) => PidFacts | undefined): ProcFacts {
  return {
    alive: async (pid) => script(pid)?.alive ?? false,
    lstart: async (pid) => script(pid)?.lstart ?? "unknown",
    exe: async (pid) => script(pid)?.exe ?? "unknown",
    scan: async () => [],
    probe: async () => "absent",
  };
}

/** A recording `deps.kill` that also stamps each call with `now()` (WI-7). */
export function timedKill(now: () => number): ((pid: number, sig?: string | number) => boolean) & {
  calls: unknown[][];
  times: number[];
  signalsTo: (pid: number) => string[];
} {
  const calls: unknown[][] = [];
  const times: number[] = [];
  const kill = (pid: number, sig?: string | number) => {
    calls.push([pid, sig]);
    times.push(now());
    return true;
  };
  const signalsTo = (pid: number) => calls.filter((c) => c[0] === pid).map((c) => String(c[1]));
  return Object.assign(kill, { calls, times, signalsTo });
}
