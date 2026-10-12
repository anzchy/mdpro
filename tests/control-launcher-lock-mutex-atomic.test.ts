// @vitest-environment node
/**
 * D170-WI-1: `.lock.mutex` and `.lock.mutex.break` never exist incomplete. A
 * process killed between "the file is created" and "the file is complete" must
 * not leave an empty file: an empty mutex reads as `mutex unreadable` and is
 * never broken (it has no pid), and an empty break file is waited on forever,
 * so every later lock section would report `lock busy`.
 *
 * Real tmp fs, real child processes. The kill is either a real SIGKILL of a
 * child at that point (patched at its fs boundary, whichever way the file is
 * built), or an in-process throw at the same point. EEXIST still means "held"
 * (LA-3), cycles never expose an incomplete file (LA-4), and files left
 * incomplete by older code keep today's refusals (LA-5). Leftover temps block
 * nothing (LA-6). Same shape as D148-WI-3 (`control-launcher-clean-claim-atomic`).
 *
 * Refusal messages are pinned here as literals, never imported.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { withLockMutex } from "../scripts/control/lockMutex.mjs";
import { cleanupParents, freshParent, thrown } from "./support/lockSchedules";

const MUTEX = ".lock.mutex";
const BREAK = ".lock.mutex.break";
const TOKEN = "0123456789abcdef";
const MOD = pathToFileURL(path.resolve(__dirname, "../scripts/control/lockMutex.mjs")).href;
const realWrite = fs.writeFileSync;
const realLink = fs.linkSync;
const realUnlink = fs.unlinkSync;
const realRead = fs.readFileSync;
const realOpen = fs.openSync;
const body = (pid: number, token = TOKEN) => JSON.stringify({ pid, token });
const listing = (p: string) => fs.readdirSync(p).sort();
const isTemp = (n: string) => /^\.lock\.mutex(\.break)?\..+\.tmp$/.test(n);
const noTemps = (p: string) => listing(p).filter((n) => !isTemp(n));

const children: number[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const pid of children.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  cleanupParents();
});

async function deadPid(): Promise<number> {
  const c = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise((resolve) => c.on("exit", resolve));
  return c.pid as number;
}
function sleeper(): number {
  const c = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  children.push(c.pid as number);
  return c.pid as number;
}

/**
 * A child takes the mutex in `parent` and SIGKILLs itself between `target`
 * (the mutex or the break file) being created and being complete: a direct
 * write of `target` creates it empty and dies; a link onto `target` dies first.
 */
const CHILD = `
import fs from "node:fs";
import path from "node:path";
const { LA_PARENT: parent, LA_TARGET: name, LA_MOD: mod } = process.env;
const target = path.join(parent, name);
const die = () => { process.kill(process.pid, "SIGKILL"); for (;;) {} };
const realWrite = fs.writeFileSync;
const realLink = fs.linkSync;
fs.writeFileSync = (file, data, opts) => {
  if (file === target) { fs.closeSync(fs.openSync(file, (opts && opts.flag) || "w", opts && opts.mode)); die(); }
  return realWrite(file, data, opts);
};
fs.linkSync = (from, to) => { if (to === target) die(); return realLink(from, to); };
const { withLockMutex } = await import(mod);
withLockMutex(parent, () => {});
`;
function killedAt(parent: string, target: string) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", CHILD], {
    env: { ...process.env, LA_PARENT: parent, LA_TARGET: target, LA_MOD: MOD },
    encoding: "utf8",
  });
}

/** The same gap in this process: an empty `target` then a throw on a direct write; a throw before a link onto it. */
function crashAt(parent: string, target: string) {
  const file = path.join(parent, target);
  vi.spyOn(fs, "writeFileSync").mockImplementation(((...a: Parameters<typeof fs.writeFileSync>) => {
    if (a[0] === file) {
      const o = (a[2] ?? {}) as fs.WriteFileOptions & { flag?: string; mode?: number };
      fs.closeSync(fs.openSync(file, o.flag ?? "w", o.mode));
      throw new Error("simulated crash");
    }
    return realWrite(...a);
  }) as typeof fs.writeFileSync);
  vi.spyOn(fs, "linkSync").mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
    if (to === file) throw new Error("simulated crash");
    return realLink(from, to);
  }) as typeof fs.linkSync);
}

describe("D170-WI-1 a process killed while taking the mutex leaves no incomplete file", () => {
  it("LA-1a SIGKILL between the mutex being created and complete: no .lock.mutex, and the next section runs", () => {
    const p = freshParent();
    const killed = killedAt(p, MUTEX);
    expect({ signal: killed.signal, stderr: killed.stderr }).toEqual({ signal: "SIGKILL", stderr: "" });
    expect(listing(p)).not.toContain(MUTEX);
    expect(thrown(() => withLockMutex(p, () => {
      throw new Error("ran");
    }, { waitMs: 50 }))).toBe("ran");
    expect(noTemps(p)).toEqual([]);
  });

  it("LA-1b SIGKILL between the break file being created and complete: no .lock.mutex.break, and the next section breaks the dead holder", async () => {
    const p = freshParent();
    const dead = body(await deadPid());
    fs.writeFileSync(path.join(p, MUTEX), dead, { mode: 0o600 });
    const killed = killedAt(p, BREAK);
    expect({ signal: killed.signal, stderr: killed.stderr }).toEqual({ signal: "SIGKILL", stderr: "" });
    expect(noTemps(p)).toEqual([MUTEX]);
    expect(fs.readFileSync(path.join(p, MUTEX), "utf8")).toBe(dead);
    expect(thrown(() => withLockMutex(p, () => {
      throw new Error("ran");
    }, { waitMs: 50 }))).toBe("ran");
    expect(noTemps(p)).toEqual([]);
  });

  it("LA-2a a throw at that point while taking the mutex: rethrown, fn never runs, nothing left; the next section runs", () => {
    const p = freshParent();
    crashAt(p, MUTEX);
    let ran = false;
    expect(thrown(() => withLockMutex(p, () => {
      ran = true;
    }))).toBe("simulated crash");
    vi.restoreAllMocks();
    expect({ ran, listing: listing(p) }).toEqual({ ran: false, listing: [] });
    expect(withLockMutex(p, () => "ok")).toBe("ok");
    expect(listing(p)).toEqual([]);
  });

  it("LA-2b a throw at that point while taking the break file: rethrown, the dead holder's mutex kept as it was, no break file, no temp", async () => {
    const p = freshParent();
    const dead = body(await deadPid());
    fs.writeFileSync(path.join(p, MUTEX), dead, { mode: 0o600 });
    crashAt(p, BREAK);
    expect(thrown(() => withLockMutex(p, () => "ran"))).toBe("simulated crash");
    vi.restoreAllMocks();
    expect(listing(p)).toEqual([MUTEX]);
    expect(fs.readFileSync(path.join(p, MUTEX), "utf8")).toBe(dead);
    expect(withLockMutex(p, () => "ok")).toBe("ok");
    expect(listing(p)).toEqual([]);
  });
});

describe("D170-WI-1 EEXIST still means held, and the refused call leaves nothing of its own", () => {
  /** After the first write in `p` of a temp beside `name` (not `name` itself), plant `bytes` at `name`. */
  function plantBeforeLink(p: string, name: string, bytes: string) {
    const state = { injected: false };
    vi.spyOn(fs, "writeFileSync").mockImplementation(((...a: Parameters<typeof fs.writeFileSync>) => {
      realWrite(...a);
      const n = path.basename(String(a[0]));
      if (!state.injected && path.dirname(String(a[0])) === p && n.startsWith(`${name}.`) && n.endsWith(".tmp") && (name === BREAK || !n.startsWith(`${BREAK}.`))) {
        state.injected = true;
        realWrite(path.join(p, name), bytes, { mode: 0o600 });
      }
    }) as typeof fs.writeFileSync);
    return state;
  }

  it("LA-3a a mutex appearing before the link: lock busy naming its live pid, fn never runs, that mutex byte-identical, no temp", () => {
    const p = freshParent();
    const pid = sleeper();
    const theirs = body(pid);
    const plant = plantBeforeLink(p, MUTEX, theirs);
    let ran = false;
    const msg = thrown(() => withLockMutex(p, () => {
      ran = true;
    }, { waitMs: 50 }));
    vi.restoreAllMocks();
    expect({ injected: plant.injected, msg, ran }).toEqual({ injected: true, msg: `lock busy: mutex held by pid ${pid}`, ran: false });
    expect(fs.readFileSync(path.join(p, MUTEX), "utf8")).toBe(theirs);
    expect(listing(p)).toEqual([MUTEX]);
  });

  it("LA-3b a break file appearing before the link: lock busy naming the break file, both files byte-identical, no temp", async () => {
    const p = freshParent();
    const dead = body(await deadPid());
    fs.writeFileSync(path.join(p, MUTEX), dead, { mode: 0o600 });
    const theirs = body(sleeper(), "fedcba9876543210");
    const plant = plantBeforeLink(p, BREAK, theirs);
    const msg = thrown(() => withLockMutex(p, () => "ran", { waitMs: 50 }));
    vi.restoreAllMocks();
    expect({ injected: plant.injected, msg }).toEqual({ injected: true, msg: `lock busy: mutex break file kept (${BREAK})` });
    expect(fs.readFileSync(path.join(p, MUTEX), "utf8")).toBe(dead);
    expect(fs.readFileSync(path.join(p, BREAK), "utf8")).toBe(theirs);
    expect(listing(p)).toEqual([MUTEX, BREAK]);
  });
});

describe("D170-WI-1 law: take and release is a round trip that never exposes an incomplete file", () => {
  it("LA-4 over 20 cycles (every other one breaking a dead holder), after every fs step each present mutex or break file is a whole { pid, token }, and nothing is left", async () => {
    const p = freshParent();
    const dead = body(await deadPid());
    const bad: string[] = [];
    let inside = false;
    const check = (step: string) => {
      if (inside) return;
      inside = true;
      try {
        for (const name of [MUTEX, BREAK]) {
          let bytes: string;
          try {
            bytes = realRead(path.join(p, name), "utf8");
          } catch {
            continue;
          }
          let whole = false;
          try {
            const rec = JSON.parse(bytes);
            whole = Number.isSafeInteger(rec.pid) && rec.pid > 0 && /^[0-9a-f]{16}$/.test(rec.token);
          } catch {
            // incomplete
          }
          if (!whole) bad.push(`${step}: ${name} = ${JSON.stringify(bytes)}`);
        }
      } finally {
        inside = false;
      }
    };
    const after = <F extends (...a: never[]) => unknown>(name: string, real: F) =>
      vi.spyOn(fs, name as "writeFileSync").mockImplementation(((...a: never[]) => {
        try {
          return real(...a);
        } finally {
          check(name);
        }
      }) as never);
    after("writeFileSync", realWrite);
    after("linkSync", realLink);
    after("unlinkSync", realUnlink);
    after("openSync", realOpen);
    const tokens = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      // Added after the red (D170-WI-1): the planted dead holder is this test's own setup, written by the real
      // writeFileSync, which opens through the spied fs.openSync; the check must not judge that write.
      inside = true;
      if (i % 2 === 1) realWrite(path.join(p, MUTEX), dead, { mode: 0o600 });
      inside = false;
      const held = withLockMutex(p, () => ({ listing: listing(p), rec: JSON.parse(realRead(path.join(p, MUTEX), "utf8")) }));
      expect(held.listing).toEqual([MUTEX]);
      expect(held.rec.pid).toBe(process.pid);
      tokens.add(held.rec.token);
      expect(listing(p)).toEqual([]);
    }
    vi.restoreAllMocks();
    expect(bad).toEqual([]);
    expect(tokens.size).toBe(20);
  });
});

describe("D170-WI-1 files left incomplete by older code keep today's refusals", () => {
  it.each([
    ["empty", ""],
    ["truncated", '{"pid":4'],
  ])("LA-5a %s mutex: lock busy: mutex unreadable, bytes kept, fn never runs, no temp", (_k, bytes) => {
    const p = freshParent();
    fs.writeFileSync(path.join(p, MUTEX), bytes, { mode: 0o600 });
    let ran = false;
    const msg = thrown(() => withLockMutex(p, () => {
      ran = true;
    }, { waitMs: 30 }));
    expect({ msg, ran }).toEqual({ msg: "lock busy: mutex unreadable", ran: false });
    expect(fs.readFileSync(path.join(p, MUTEX), "utf8")).toBe(bytes);
    expect(listing(p)).toEqual([MUTEX]);
  });

  it.each([
    ["empty", ""],
    ["truncated", '{"pid":4'],
  ])("LA-5b %s break file beside a dead holder: lock busy naming the break file, both kept, no temp", async (_k, bytes) => {
    const p = freshParent();
    const dead = body(await deadPid());
    fs.writeFileSync(path.join(p, MUTEX), dead, { mode: 0o600 });
    fs.writeFileSync(path.join(p, BREAK), bytes, { mode: 0o600 });
    expect(thrown(() => withLockMutex(p, () => "ran", { waitMs: 30 }))).toBe(`lock busy: mutex break file kept (${BREAK})`);
    expect(fs.readFileSync(path.join(p, MUTEX), "utf8")).toBe(dead);
    expect(fs.readFileSync(path.join(p, BREAK), "utf8")).toBe(bytes);
    expect(listing(p)).toEqual([MUTEX, BREAK]);
  });
});

describe("D170-WI-1 leftover temps block nothing", () => {
  it("LA-6 partial and whole leftover temps of both files: a section breaks a dead holder and runs; the temps are left as they were", async () => {
    const p = freshParent();
    fs.writeFileSync(path.join(p, MUTEX), body(await deadPid()), { mode: 0o600 });
    const temps = new Map([
      [`${MUTEX}.99999-deadbeef.tmp`, '{"pid":'],
      [`${MUTEX}.${process.pid}-0badc0de.tmp`, body(process.pid)],
      [`${BREAK}.99999-deadbeef.tmp`, ""],
      [`${BREAK}.${process.pid}-0badc0de.tmp`, body(process.pid)],
    ]);
    for (const [n, b] of temps) fs.writeFileSync(path.join(p, n), b, { mode: 0o600 });
    expect(withLockMutex(p, () => "ok", { waitMs: 50 })).toBe("ok");
    expect(listing(p)).toEqual([...temps.keys()].sort());
    for (const [n, b] of temps) expect(fs.readFileSync(path.join(p, n), "utf8")).toBe(b);
  });
});
