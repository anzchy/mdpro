// @vitest-environment node
/**
 * D82-WI-1 (H1): releasing the one-run lock is atomic. `releaseLock` and
 * `releaseOrphanLock` move `.lock` aside to a per-call tomb before checking
 * ownership, so no interleaving lets them delete a lock that another run took.
 * Real tmp fs; the interleavings are pass-through spies on `node:fs`
 * (`tests/support/lockSchedules.ts`), no sleeps.
 * Matrix: `.claude/tdd-guardian/tests-20261010-103136.md`, D82-WI-1:
 * K-H1-1, K-H1-2, K-H1-4, K-H1-5, K-H1-6, K-H1-7, K-H1-8, K-H1-9, and the
 * round 3 case K-H1-10. K-H1-3 is in `control-launcher-lock-schedules.test.ts`,
 * K-H1-S in `control-launcher-lock.slow.test.ts`. K-H1-7..K-H1-10 moved
 * verbatim to `control-launcher-lock-release-guards.test.ts` (D105, rule 50:
 * this file was over 300 lines).
 *
 * K-01..K-R3 stay unedited in `control-launcher-lock.test.ts`.
 */
import fs from "node:fs";
import path from "node:path";
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
  SECRETS,
  cleanupParents,
  freshParent,
  lockFile,
  recordBytes,
  runSchedule,
  tombsIn,
} from "../support/lockSchedules";

const DISPLACED_RE = /^lock displaced: kept (\.lock\.[^/]+\.tomb)$/;
const releaseA = (parent: string) => releaseLock(parent, { run: A, nonce: N1 });
const orphanA = (parent: string) => releaseOrphanLock(parent, A);
const FNS = [
  { fn: "releaseLock", call: releaseA },
  { fn: "releaseOrphanLock", call: orphanA },
] as const;

afterEach(() => {
  vi.restoreAllMocks();
  cleanupParents();
});

/** c1: unlink `.lock` with the real fs, then take it for B. Returns B's bytes. */
const steal = (parent: string, sink: { bytes?: Buffer }) => () => {
  fs.unlinkSync(lockFile(parent));
  // rule 12: D105-WI-2. Was `acquireLock(B)`, which now takes `.lock.mutex` and so
  // cannot run inside the release section. A raw `wx` write of B's exact bytes
  // (a writer that ignores the mutex) keeps the steal at the same point.
  fs.writeFileSync(lockFile(parent), recordBytes(B, N2), { flag: "wx", mode: 0o600 });
  sink.bytes = fs.readFileSync(lockFile(parent));
};

describe("D82-WI-1 a stolen-and-reacquired lock survives the release", () => {
  it.each(FNS)("K-H1-1/K-H1-2 $fn: throws the mismatch literal and B's lock stays byte-for-byte", ({ call }) => {
    const parent = freshParent();
    acquireLock(parent, { run: A, nonce: N1 });
    const sink: { bytes?: Buffer } = {};
    const r = runSchedule(parent, [{ at: "pre-mutate", competitor: steal(parent, sink) }], () => call(parent));
    expect(r.fired).toEqual([1]);
    expect(r.result).toEqual({ error: `lock names run ${B}, not ${A}` });
    expect(fs.readFileSync(lockFile(parent))).toEqual(sink.bytes);
    expect(fs.readdirSync(parent)).toEqual([".lock"]);
  });
});

describe("D82-WI-1 K-H1-4 double release is idempotent at every injection index", () => {
  it.each(FNS)("K-H1-4 outer releaseLock, inner $fn: one released, one absent, parent empty", ({ call: inner }) => {
    const table: unknown[] = [];
    const expected: unknown[] = [];
    const dry = freshParent();
    acquireLock(dry, { run: A, nonce: N1 });
    const n = runSchedule(dry, [], () => releaseA(dry)).calls;
    for (let k = 0; k <= n; k++) {
      const parent = freshParent();
      acquireLock(parent, { run: A, nonce: N1 });
      let innerResult: unknown = "not run";
      const r = runSchedule(
        parent,
        [
          {
            at: k,
            // rule 12: D105-WI-2. The inner release follows the protocol, so it
            // waits for the outer's `.lock.mutex`: "in" defers it to just after
            // the outer's mutex unlink when k falls inside the section.
            protocol: "in",
            competitor: () => {
              innerResult = thrownOr(() => inner(parent));
            },
          },
        ],
        () => releaseA(parent),
      );
      table.push({ k, pair: [r.result, innerResult].map(String).sort(), listing: fs.readdirSync(parent) });
      expected.push({ k, pair: ["absent", "released"], listing: [] });
    }
    expect(table).toEqual(expected);
  });
});

function thrownOr(fn: () => string): string {
  try {
    return fn();
  } catch (e) {
    return `threw: ${e instanceof Error ? e.message : String(e)}`;
  }
}

describe("D82-WI-1 K-H1-5 displaced restore (two-shot schedule)", () => {
  it.each(FNS)("K-H1-5 $fn: throws `lock displaced: kept <tomb>`, C keeps .lock, the tomb keeps B", ({ call }) => {
    const parent = freshParent();
    acquireLock(parent, { run: A, nonce: N1 });
    const b: { bytes?: Buffer; mtimeMs?: number } = {};
    let cBytes: Buffer | undefined;
    const r = runSchedule(
      parent,
      [
        {
          at: "pre-rename",
          competitor: () => {
            fs.unlinkSync(lockFile(parent));
            // rule 12: D105-WI-2. Raw `wx` writes replace `acquireLock(B)` here and
            // `acquireLock(C)` below: an in-protocol acquire can no longer run inside
            // the section, so only a writer that ignores `.lock.mutex` displaces.
            fs.writeFileSync(lockFile(parent), recordBytes(B, N2), { flag: "wx", mode: 0o600 });
            b.bytes = fs.readFileSync(lockFile(parent));
            b.mtimeMs = fs.statSync(lockFile(parent)).mtimeMs;
          },
        },
        {
          at: "pre-link",
          competitor: () => {
            fs.writeFileSync(lockFile(parent), recordBytes(C, N3), { flag: "wx", mode: 0o600 });
            cBytes = fs.readFileSync(lockFile(parent));
          },
        },
      ],
      () => call(parent),
    );
    expect(r.fired).toEqual([1, 1]);
    const message = typeof r.result === "object" ? r.result.error : `returned ${r.result}`;
    const m = DISPLACED_RE.exec(message);
    expect(m).not.toBeNull();
    for (const s of SECRETS) expect(message).not.toContain(s);
    expect(fs.readFileSync(lockFile(parent))).toEqual(cBytes);
    expect(tombsIn(parent)).toEqual([m?.[1]]);
    const tomb = path.join(parent, m?.[1] ?? "missing");
    expect(fs.readFileSync(tomb)).toEqual(b.bytes);
    expect(fs.statSync(tomb).mtimeMs).toBe(b.mtimeMs);
  });
});

describe("D82-WI-1 K-H1-6 no residue on the non-displaced paths", () => {
  type Row = { fn: string; row: string; setup: (p: string) => void; call: (p: string) => string };
  const ROWS: Row[] = [];
  for (const { fn, call } of FNS) {
    ROWS.push({ fn, row: "owned", setup: (p) => acquireLock(p, { run: A, nonce: N1 }), call });
    ROWS.push({ fn, row: "absent", setup: () => undefined, call });
    ROWS.push({ fn, row: "other run", setup: (p) => acquireLock(p, { run: B, nonce: N2 }), call });
    if (fn === "releaseLock") {
      ROWS.push({ fn, row: "another nonce", setup: (p) => acquireLock(p, { run: A, nonce: N2 }), call });
    }
    ROWS.push({ fn, row: "corrupt", setup: (p) => fs.writeFileSync(lockFile(p), "{", { mode: 0o600 }), call });
  }
  const EXPECTED: Record<string, { result: string; listing: string[] }> = {
    owned: { result: "released", listing: [] },
    absent: { result: "absent", listing: [] },
    "other run": { result: `lock names run ${B}, not ${A}`, listing: [".lock"] },
    "another nonce": { result: `lock for run ${A} holds another nonce`, listing: [".lock"] },
    corrupt: { result: "lock unreadable", listing: [".lock"] },
  };

  it("K-H1-6 every outcome row: exact result, exact listing, mismatch bytes and mtime unchanged", () => {
    const got = ROWS.map(({ fn, row, setup, call }) => {
      const parent = freshParent();
      setup(parent);
      const kept = fs.existsSync(lockFile(parent));
      const before = kept ? { bytes: fs.readFileSync(lockFile(parent)), mtimeMs: fs.statSync(lockFile(parent)).mtimeMs } : null;
      const result = thrownOr(() => call(parent)).replace(/^threw: /, "");
      const after = fs.existsSync(lockFile(parent))
        ? { bytes: fs.readFileSync(lockFile(parent)), mtimeMs: fs.statSync(lockFile(parent)).mtimeMs }
        : null;
      const unchanged = EXPECTED[row].listing.length ? after !== null && before !== null && after.bytes.equals(before.bytes) && after.mtimeMs === before.mtimeMs : null;
      return { fn, row, result, listing: fs.readdirSync(parent), unchanged };
    });
    const want = ROWS.map(({ fn, row }) => ({
      fn,
      row,
      ...EXPECTED[row],
      unchanged: EXPECTED[row].listing.length ? true : null,
    }));
    expect(got).toEqual(want);
  });
});
