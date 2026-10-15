// @vitest-environment node
/**
 * D105-WI-1: the outside mutex for the launcher lock
 * (`scripts/control/lockMutex.mjs`, `withLockMutex`). Real tmp fs and real
 * child processes; the only spies are the pass-through `node:fs` ones of
 * `tests/support/lockSchedules.ts` (MX-10).
 * Plan and matrix: `.claude/tdd-guardian/plan-d105-20261011-144108.md`,
 * D105-WI-1, MX-1..MX-10 (MX-11 is in `control-launcher-lock-mutex.slow.test.ts`).
 * Post-plan additions: MX-12 (a replaced mutex is `lock mutex lost`, kept),
 * MX-13 (a non-EEXIST create error is rethrown, fn never runs), MX-14 (the
 * named constants).
 *
 * Refusal messages are pinned here as literals, never imported.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { MUTEX_POLL_MS, MUTEX_WAIT_MS, withLockMutex } from "../../scripts/control/lockMutex.mjs";
import { SECRETS, cleanupParents, freshParent, interleave, thrown } from "../support/lockSchedules";

const MUTEX_URL = pathToFileURL(path.resolve(__dirname, "../../scripts/control/lockMutex.mjs")).href;
const TOKEN = "0123456789abcdef";
const mutexOf = (p: string) => path.join(p, ".lock.mutex");
const breakOf = (p: string) => path.join(p, ".lock.mutex.break");
const holderBody = (pid: number, token = TOKEN) => JSON.stringify({ pid, token });

const children: ChildProcess[] = [];
const scratch: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const c of children.splice(0)) if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
  for (const d of scratch.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  cleanupParents();
});

/** A live child that sleeps until killed. */
function sleeper(): number {
  const c = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  children.push(c);
  return c.pid as number;
}

/** The pid of a child that has already exited (ESRCH to `kill(pid, 0)`). */
async function deadPid(): Promise<number> {
  const c = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise((resolve) => c.on("exit", resolve));
  return c.pid as number;
}

const listing = (p: string) => fs.readdirSync(p).sort();
/** The pid `.lock.mutex` names, or null when it is absent or unparsable. */
function holderPid(p: string): number | null {
  try {
    return JSON.parse(fs.readFileSync(mutexOf(p), "utf8")).pid;
  } catch {
    return null;
  }
}

describe("D105-WI-1 withLockMutex: pass-through and cleanup", () => {
  it("MX-1 returns fn's value and leaves the parent empty", () => {
    const p = freshParent();
    expect(withLockMutex(p, () => 42)).toBe(42);
    expect(listing(p)).toEqual([]);
  });

  it("MX-2 rethrows fn's error unchanged and removes the mutex", () => {
    const p = freshParent();
    expect(thrown(() => withLockMutex(p, () => {
      throw new Error("x");
    }))).toBe("x");
    expect(fs.existsSync(mutexOf(p))).toBe(false);
    expect(listing(p)).toEqual([]);
  });

  it("MX-14 the wait and poll bounds are named, positive, and the poll is shorter than the wait", () => {
    expect(Number.isInteger(MUTEX_WAIT_MS) && MUTEX_WAIT_MS > 0).toBe(true);
    expect(Number.isInteger(MUTEX_POLL_MS) && MUTEX_POLL_MS > 0).toBe(true);
    expect(MUTEX_POLL_MS).toBeLessThan(MUTEX_WAIT_MS);
  });
});

describe("D105-WI-1 withLockMutex: refusals", () => {
  it("MX-3 re-entry in one process is refused at once (waiting would deadlock); the outer section completes", () => {
    const p = freshParent();
    let inner = "not run";
    const outer = withLockMutex(p, () => {
      inner = thrown(() => withLockMutex(p, () => "inner ran", { waitMs: 10_000 }));
      return "outer";
    });
    expect(inner).toBe("lock busy: mutex held by this process");
    expect(outer).toBe("outer");
    expect(listing(p)).toEqual([]);
  });

  it("MX-4 a live holder is waited on, then refused naming its pid; fn never runs and the bytes stay", () => {
    const p = freshParent();
    const pid = sleeper();
    fs.writeFileSync(mutexOf(p), holderBody(pid), { mode: 0o600 });
    const before = fs.readFileSync(mutexOf(p));
    let ran = false;
    const msg = thrown(() => withLockMutex(p, () => {
      ran = true;
    }, { waitMs: 50 }));
    expect(msg).toBe(`lock busy: mutex held by pid ${pid}`);
    expect(ran).toBe(false);
    expect(fs.readFileSync(mutexOf(p)).equals(before)).toBe(true);
    expect(listing(p)).toEqual([".lock.mutex"]);
  });

  it("MX-7 an unreadable mutex is never broken, however old: lock busy, entry and bytes unchanged", () => {
    const DAY_AGO = new Date(Date.now() - 24 * 3600 * 1000);
    const ROWS: { row: string; make: (f: string) => void }[] = [
      { row: '"{"', make: (f) => fs.writeFileSync(f, "{", { mode: 0o600 }) },
      { row: '""', make: (f) => fs.writeFileSync(f, "", { mode: 0o600 }) },
      { row: "a directory", make: (f) => fs.mkdirSync(f) },
      { row: "pid -1", make: (f) => fs.writeFileSync(f, holderBody(-1), { mode: 0o600 }) },
      { row: "pid not a number", make: (f) => fs.writeFileSync(f, JSON.stringify({ pid: "1", token: TOKEN }), { mode: 0o600 }) },
      { row: "no token", make: (f) => fs.writeFileSync(f, JSON.stringify({ pid: 1 }), { mode: 0o600 }) },
    ];
    const got = ROWS.map(({ row, make }) => {
      const p = freshParent();
      make(mutexOf(p));
      fs.utimesSync(mutexOf(p), DAY_AGO, DAY_AGO);
      const st = fs.lstatSync(mutexOf(p));
      const bytes = st.isFile() ? fs.readFileSync(mutexOf(p), "latin1") : null;
      let ran = false;
      const msg = thrown(() => withLockMutex(p, () => {
        ran = true;
      }, { waitMs: 30 }));
      const after = fs.lstatSync(mutexOf(p));
      const same = after.isDirectory() === st.isDirectory() && after.mtimeMs === st.mtimeMs && (bytes === null || fs.readFileSync(mutexOf(p), "latin1") === bytes);
      return { row, msg, ran, same, listing: listing(p) };
    });
    expect(got).toEqual(ROWS.map(({ row }) => ({ row, msg: "lock busy: mutex unreadable", ran: false, same: true, listing: [".lock.mutex"] })));
  });

  it("MX-8 an existing break file is waited on and never broken, even when its pid is dead; both files stay", async () => {
    const p = freshParent();
    const dead = await deadPid();
    fs.writeFileSync(mutexOf(p), holderBody(dead), { mode: 0o600 });
    fs.writeFileSync(breakOf(p), holderBody(dead, "fedcba9876543210"), { mode: 0o600 });
    const mutexBytes = fs.readFileSync(mutexOf(p));
    const breakBytes = fs.readFileSync(breakOf(p));
    const msg = thrown(() => withLockMutex(p, () => "ran", { waitMs: 30 }));
    expect(msg).toBe("lock busy: mutex break file kept (.lock.mutex.break)");
    expect(fs.readFileSync(mutexOf(p)).equals(mutexBytes)).toBe(true);
    expect(fs.readFileSync(breakOf(p)).equals(breakBytes)).toBe(true);
    expect(listing(p)).toEqual([".lock.mutex", ".lock.mutex.break"]);
  });

  it("MX-12 a mutex replaced under the holder is `lock mutex lost`, and the replacement is kept", () => {
    const p = freshParent();
    const foreign = holderBody(process.pid, "fedcba9876543210");
    const msg = thrown(() => withLockMutex(p, () => fs.writeFileSync(mutexOf(p), foreign)));
    expect(msg).toBe("lock mutex lost");
    expect(fs.readFileSync(mutexOf(p), "utf8")).toBe(foreign);
  });

  it("MX-13 a create error other than EEXIST is rethrown as-is and fn never runs", () => {
    const missing = path.join(freshParent(), "no-such-parent");
    let ran = false;
    const msg = thrown(() => withLockMutex(missing, () => {
      ran = true;
    }));
    expect(msg).toMatch(/^ENOENT/);
    expect(ran).toBe(false);
    expect(fs.existsSync(missing)).toBe(false);
  });
});

describe("D105-WI-1 withLockMutex: a dead holder is broken, and only a dead one", () => {
  it("MX-5 a holder whose pid has exited is broken: fn runs, no mutex and no break file remain", async () => {
    const p = freshParent();
    fs.writeFileSync(mutexOf(p), holderBody(await deadPid()), { mode: 0o600 });
    expect(withLockMutex(p, () => "ok")).toBe("ok");
    expect(listing(p)).toEqual([]);
  });

  it("MX-9 the breaker's own mutex is never broken by a second process while the breaker is alive", async () => {
    const p = freshParent();
    fs.writeFileSync(mutexOf(p), holderBody(await deadPid()), { mode: 0o600 });
    const src =
      `import { withLockMutex } from ${JSON.stringify(MUTEX_URL)};` +
      `try { withLockMutex(${JSON.stringify(p)}, () => {}, { waitMs: 50 }); process.stdout.write("entered"); }` +
      `catch (e) { process.stdout.write(e instanceof Error ? e.message : String(e)); }`;
    const seen = withLockMutex(p, () => {
      const atStart = fs.readFileSync(mutexOf(p), "utf8");
      const child = spawnSync(process.execPath, ["--input-type=module", "-e", src], { encoding: "utf8" });
      return { atStart, child: child.stdout, atEnd: fs.readFileSync(mutexOf(p), "utf8") };
    });
    expect(JSON.parse(seen.atStart).pid).toBe(process.pid);
    expect(seen.child).toBe(`lock busy: mutex held by pid ${process.pid}`);
    expect(seen.atEnd).toBe(seen.atStart);
    expect(listing(p)).toEqual([]);
  });
});

describe("D105-WI-1 withLockMutex: exclusion across processes", () => {
  it("MX-6 a section waits for another process's section to end, then runs holding the mutex itself", async () => {
    const p = freshParent();
    const marks = fs.mkdtempSync(path.join(os.tmpdir(), "lkm-"));
    scratch.push(marks);
    const entered = path.join(marks, "entered");
    const src =
      `import { withLockMutex } from ${JSON.stringify(MUTEX_URL)};` +
      `import { writeFileSync } from "node:fs";` +
      `withLockMutex(${JSON.stringify(p)}, () => { writeFileSync(${JSON.stringify(entered)}, ""); const t = Date.now() + 200; while (Date.now() < t) {} });`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", src], { stdio: "ignore" });
    children.push(child);
    const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
    for (let i = 0; i < 1000 && !fs.existsSync(entered); i++) await new Promise((r) => setTimeout(r, 10));
    expect(fs.existsSync(entered)).toBe(true);
    const got = withLockMutex(p, () => ({ value: "got", holder: holderPid(p) }), { waitMs: 5000 });
    expect(got).toEqual({ value: "got", holder: process.pid });
    expect(await exited).toBe(0);
    expect(listing(p)).toEqual([]);
  });
});

describe("D105-WI-1 the mutex files carry no credential", () => {
  it("MX-10 at every fs step of a break-and-hold, each of our mutex and break files is exactly { pid, token }", async () => {
    const dead = await deadPid();
    const setup = () => {
      const p = freshParent();
      fs.writeFileSync(mutexOf(p), holderBody(dead), { mode: 0o600 });
      return p;
    };
    const dry = setup();
    const il0 = interleave(dry, []);
    try {
      withLockMutex(dry, () => undefined);
    } finally {
      il0.finish();
    }
    const n = il0.calls;
    const seen: { file: string; body: string }[] = [];
    for (let k = 0; k <= n; k++) {
      const p = setup();
      const capture = () => {
        for (const [file, f] of [["mutex", mutexOf(p)], ["break", breakOf(p)]] as const) {
          try {
            seen.push({ file, body: fs.readFileSync(f, "utf8") });
          } catch {
            // absent at this step
          }
        }
      };
      const il = interleave(p, [{ at: k, competitor: capture }]);
      try {
        withLockMutex(p, capture);
      } finally {
        il.finish();
      }
    }
    const ours = seen.filter(({ body }) => {
      try {
        return JSON.parse(body).pid === process.pid;
      } catch {
        return false;
      }
    });
    expect(ours.some((s) => s.file === "mutex")).toBe(true);
    expect(ours.some((s) => s.file === "break")).toBe(true);
    const bad = ours.filter(({ body }) => {
      const rec = JSON.parse(body);
      const exact = JSON.stringify(Object.keys(rec).sort()) === JSON.stringify(["pid", "token"]) && /^[0-9a-f]{16}$/.test(rec.token);
      return !exact || /nonce|digest|run/i.test(body) || SECRETS.some((s) => body.includes(s));
    });
    expect(bad).toEqual([]);
  });
});
