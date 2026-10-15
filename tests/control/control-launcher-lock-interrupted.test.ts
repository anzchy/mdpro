// @vitest-environment node
/**
 * D105-WI-3: the two cases the tomb protocol used to keep silent now report.
 *
 * - A crash between a release's rename and its restore leaves the record in a
 *   tomb and `.lock` absent. The next `acquireLock` refuses, naming the tomb:
 *   `lock interrupted: kept <tomb> (run <run>|unreadable)`. Nothing is
 *   auto-restored (D2). The tomb check runs first, before the held check.
 * - A failed unlink of the releaser's own tomb returns
 *   `released; tomb kept: <tomb>`, and that tomb refuses the next acquire too.
 *
 * Real tmp fs and real child processes; the only spy is the tomb-unlink fault
 * (`failTombUnlink`, `tests/support/lockSchedules.ts`).
 * Plan and matrix: `.claude/tdd-guardian/plan-d105-20261011-144108.md`,
 * D105-WI-3, SL-1..SL-4 and SL-8 (SL-5..SL-7 are in
 * `control-launcher-lock-interrupted-report.test.ts`).
 * Post-plan addition: SL-3b (an unreadable tomb is named `(unreadable)`).
 *
 * Refusal messages are pinned here as literals, never imported.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireLock,
  releaseLock,
  releaseOrphanLock,
  // @ts-expect-error -- plain ESM script, no .d.ts by design
} from "../../scripts/control/lock.mjs";
import {
  A,
  B,
  C,
  N1,
  N2,
  N3,
  cleanupParents,
  failTombUnlink,
  freshParent,
  lockFile,
  outcome,
  recordBytes,
  tombsIn,
} from "../support/lockSchedules";

afterEach(() => {
  vi.restoreAllMocks();
  cleanupParents();
});

const D = "d".repeat(25);
const N4 = "ef".repeat(32);
const LOCK_URL = pathToFileURL(path.resolve(__dirname, "../../scripts/control/lock.mjs")).href;
const TOMB_RE = /^\.lock\.\d+-[0-9a-f]{16}\.tomb$/;
const mutexFiles = (p: string) => fs.readdirSync(p).filter((n) => n.startsWith(".lock.mutex"));
const lockBytes = (p: string) => (fs.existsSync(lockFile(p)) ? fs.readFileSync(lockFile(p), "latin1") : null);
const acquireC = (p: string) => outcome(() => JSON.stringify(acquireLock(p, { run: C, nonce: N3 })));

/** The pid of a child that has already exited and been reaped (ESRCH). */
const deadPid = () => spawnSync(process.execPath, ["-e", ""]).pid as number;
/** A `.lock.mutex` left behind by a dead process. */
const deadMutex = (p: string) =>
  fs.writeFileSync(path.join(p, ".lock.mutex"), JSON.stringify({ pid: deadPid(), token: "0123456789abcdef" }), { mode: 0o600 });
/** A raw-built tomb holding `bytes`, named the way `lock.mjs` names its tombs. */
function rawTomb(p: string, bytes: string): string {
  const name = `.lock.${deadPid()}-0123456789abcdef.tomb`;
  fs.writeFileSync(path.join(p, name), bytes, { mode: 0o600 });
  return name;
}

describe("D105-WI-3 a crash inside a release is reported at the next acquire", () => {
  it("SL-1 a tomb with B's record, no .lock, a dead mutex holder: acquire refuses naming the tomb and B; nothing moves", () => {
    const p = freshParent();
    deadMutex(p);
    const tomb = rawTomb(p, recordBytes(B, N2));
    expect(acquireC(p)).toEqual({ error: `lock interrupted: kept ${tomb} (run ${B})` });
    expect(lockBytes(p)).toBeNull();
    expect(fs.readFileSync(path.join(p, tomb), "latin1")).toBe(recordBytes(B, N2));
    expect(mutexFiles(p)).toEqual([]);
    expect(fs.readdirSync(p)).toEqual([tomb]);
  });

  it("SL-2 a releaser SIGKILLed between its rename and its restore: the next acquire refuses naming the tomb and B", () => {
    const p = freshParent();
    acquireLock(p, { run: A, nonce: N1 });
    const child = [
      'import fs from "node:fs";',
      `const P = ${JSON.stringify(p)}; const lock = P + "/.lock";`,
      "const realRename = fs.renameSync;",
      "fs.renameSync = (from, to) => {",
      "  if (from !== lock) return realRename(from, to);",
      "  fs.unlinkSync(lock);",
      `  fs.writeFileSync(lock, ${JSON.stringify(recordBytes(B, N2))}, { flag: "wx", mode: 0o600 });`,
      "  realRename(from, to);",
      '  process.kill(process.pid, "SIGKILL");',
      "};",
      `const { releaseLock } = await import(${JSON.stringify(LOCK_URL)});`,
      `releaseLock(P, { run: ${JSON.stringify(A)}, nonce: ${JSON.stringify(N1)} });`,
    ].join("\n");
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", child], { encoding: "utf8" });
    expect({ signal: run.signal, stderr: run.stderr }).toEqual({ signal: "SIGKILL", stderr: "" });
    const tombs = tombsIn(p);
    expect(tombs).toHaveLength(1);
    expect(tombs[0]).toMatch(TOMB_RE);

    expect(acquireC(p)).toEqual({ error: `lock interrupted: kept ${tombs[0]} (run ${B})` });
    expect(fs.readFileSync(path.join(p, tombs[0]), "latin1")).toBe(recordBytes(B, N2));
    expect(lockBytes(p)).toBeNull();
    expect(mutexFiles(p)).toEqual([]);
  });

  it("SL-3 a held .lock plus a tomb: the tomb check comes first, so the refusal names the tomb, not the holder", () => {
    const p = freshParent();
    acquireLock(p, { run: C, nonce: N3 });
    const tomb = rawTomb(p, recordBytes(B, N2));
    expect(outcome(() => JSON.stringify(acquireLock(p, { run: D, nonce: N4 })))).toEqual({
      error: `lock interrupted: kept ${tomb} (run ${B})`,
    });
    expect(lockBytes(p)).toBe(recordBytes(C, N3));
    expect(fs.readdirSync(p).sort()).toEqual([".lock", tomb].sort());
  });

  it("SL-3b an unreadable tomb is named as unreadable, bytes kept", () => {
    const p = freshParent();
    const tomb = rawTomb(p, "{");
    expect(acquireC(p)).toEqual({ error: `lock interrupted: kept ${tomb} (unreadable)` });
    expect(fs.readFileSync(path.join(p, tomb), "latin1")).toBe("{");
    expect(fs.readdirSync(p)).toEqual([tomb]);
  });

  it("SL-8 a dead mutex holder with no tomb and no .lock: acquire succeeds (a crash outside the window loses nothing)", () => {
    const p = freshParent();
    deadMutex(p);
    expect(acquireC(p)).toBe(JSON.stringify({ run: C }));
    expect(lockBytes(p)).toBe(recordBytes(C, N3));
    expect(mutexFiles(p)).toEqual([]);
  });
});

describe("D105-WI-3 a failed own-tomb unlink is reported by the release and refuses the next acquire", () => {
  const FNS = [
    { fn: "releaseLock", call: (p: string) => releaseLock(p, { run: A, nonce: N1 }) },
    { fn: "releaseOrphanLock", call: (p: string) => releaseOrphanLock(p, A) },
  ];
  it.each(FNS)("SL-4 $fn: returns `released; tomb kept: <tomb>`, .lock absent, the tomb holds A; acquire C then refuses naming it", ({ call }) => {
    const p = freshParent();
    acquireLock(p, { run: A, nonce: N1 });
    failTombUnlink("EPERM");
    const r = outcome(() => call(p));
    vi.restoreAllMocks();

    const tombs = tombsIn(p);
    expect(tombs).toHaveLength(1);
    expect(tombs[0]).toMatch(TOMB_RE);
    expect(r).toBe(`released; tomb kept: ${tombs[0]}`);
    expect(lockBytes(p)).toBeNull();
    expect(fs.readFileSync(path.join(p, tombs[0]), "latin1")).toBe(recordBytes(A, N1));
    expect(acquireC(p)).toEqual({ error: `lock interrupted: kept ${tombs[0]} (run ${A})` });
    expect(fs.readdirSync(p)).toEqual(tombs);
  });
});
