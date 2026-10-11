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
 * K-H1-S in `control-launcher-lock.slow.test.ts`.
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
} from "../scripts/control/lock.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { collectFacts } from "../scripts/control/doctor.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { runsParent } from "../scripts/control/runDir.mjs";
import { fakeProcFacts, makeHome } from "./support/launcherFakes";
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
  thrown,
  tombsIn,
} from "./support/lockSchedules";

const DISPLACED_RE = /^lock displaced: kept (\.lock\.[^/]+\.tomb)$/;
const releaseA = (parent: string) => releaseLock(parent, { run: A, nonce: N1 });
const orphanA = (parent: string) => releaseOrphanLock(parent, A);
const FNS = [
  { fn: "releaseLock", call: releaseA },
  { fn: "releaseOrphanLock", call: orphanA },
] as const;

const disposers: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of disposers.splice(0).reverse()) d();
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

describe("D82-WI-1 K-H1-7 doctor ignores tombs", () => {
  it("K-H1-7 leftoverRuns names the real run only; a tomb file and a tomb-named dir are skipped; nothing changes", async () => {
    const h = makeHome();
    disposers.push(h.cleanup);
    const repoRoot = fs.realpathSync(freshParent());
    const parent = runsParent(h.real);
    fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
    const NAME = "7".repeat(25);
    acquireLock(parent, { run: NAME, nonce: N1 });
    fs.mkdirSync(path.join(parent, NAME), { mode: 0o700 });
    fs.writeFileSync(path.join(parent, NAME, "owner.json"), "{}");
    fs.writeFileSync(path.join(parent, ".lock.1234-abcdef.tomb"), JSON.stringify({ run: NAME, nonceDigest: "0".repeat(64) }));
    fs.mkdirSync(path.join(parent, ".lock.1234-abcdef.tomb.d"));
    const before = snapshot(parent);
    const facts = await collectFacts({
      repoRoot,
      passwdHome: h.home,
      siSockPath: `/tmp/kh17-${process.pid}-absent.sock`,
      procFacts: fakeProcFacts(),
    });
    expect(facts.leftoverRuns).toEqual([NAME]);
    expect(snapshot(parent)).toEqual(before);
  });
});

function snapshot(dir: string, rel = ""): { rel: string; bytes: string | null; mtimeMs: number }[] {
  const out: { rel: string; bytes: string | null; mtimeMs: number }[] = [];
  for (const n of fs.readdirSync(path.join(dir, rel)).sort()) {
    const r = path.join(rel, n);
    const st = fs.lstatSync(path.join(dir, r));
    out.push({ rel: r, bytes: st.isFile() ? fs.readFileSync(path.join(dir, r), "latin1") : null, mtimeMs: st.mtimeMs });
    if (st.isDirectory()) out.push(...snapshot(dir, r));
  }
  return out;
}

describe("D82-WI-1 K-H1-8 corrupt or directory locks are never moved aside", () => {
  const BODIES: { row: string; make: (p: string) => void }[] = [
    { row: "a directory", make: (p) => fs.mkdirSync(lockFile(p)) },
    { row: '"{"', make: (p) => fs.writeFileSync(lockFile(p), "{", { mode: 0o600 }) },
    { row: '""', make: (p) => fs.writeFileSync(lockFile(p), "", { mode: 0o600 }) },
    { row: '{"run":5}', make: (p) => fs.writeFileSync(lockFile(p), '{"run":5}', { mode: 0o600 }) },
  ];
  const ROWS = BODIES.flatMap((b) => FNS.map((f) => ({ ...b, ...f })));
  it.each(ROWS)("K-H1-8 $row via $fn: lock unreadable, .lock untouched, zero renames of .lock", ({ make, call }) => {
    const parent = freshParent();
    make(parent);
    const st = fs.lstatSync(lockFile(parent));
    const bytes = st.isFile() ? fs.readFileSync(lockFile(parent)) : null;
    const realRename = fs.renameSync;
    let lockRenames = 0;
    vi.spyOn(fs, "renameSync").mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      if (from === lockFile(parent)) lockRenames++;
      return realRename(from, to);
    }) as never);
    const message = thrown(() => call(parent));
    vi.restoreAllMocks();
    expect(message).toBe("lock unreadable");
    const after = fs.lstatSync(lockFile(parent));
    expect(after.isDirectory()).toBe(st.isDirectory());
    expect(after.mtimeMs).toBe(st.mtimeMs);
    if (bytes) expect(fs.readFileSync(lockFile(parent))).toEqual(bytes);
    expect(fs.readdirSync(parent)).toEqual([".lock"]);
    expect(lockRenames).toBe(0);
  });
});

describe("D82-WI-1 K-H1-9 an unwritable runs parent fails loudly and moves nothing", () => {
  const thrownCode = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return { code: (e as { code?: unknown }).code, message: e instanceof Error ? e.message : String(e) };
    }
    return { code: "no throw", message: "" };
  };
  it.skipIf(process.getuid?.() === 0)("K-H1-9 both functions throw EACCES; bytes, mtime and listing unchanged", () => {
    const rows = FNS.map(({ fn, call }) => {
      const parent = freshParent();
      acquireLock(parent, { run: A, nonce: N1 });
      const bytes = fs.readFileSync(lockFile(parent));
      const mtimeMs = fs.statSync(lockFile(parent)).mtimeMs;
      fs.chmodSync(parent, 0o500);
      let caught;
      try {
        caught = thrownCode(() => call(parent));
      } finally {
        fs.chmodSync(parent, 0o700);
      }
      const leak = SECRETS.some((s) => caught.message.includes(s));
      const same = fs.readFileSync(lockFile(parent)).equals(bytes) && fs.statSync(lockFile(parent)).mtimeMs === mtimeMs;
      return { fn, code: caught.code, leak, same, listing: fs.readdirSync(parent) };
    });
    expect(rows).toEqual(FNS.map(({ fn }) => ({ fn, code: "EACCES", leak: false, same: true, listing: [".lock"] })));
  });
});

describe("D82-WI-1 K-H1-10 a half-written newcomer is restored, never destroyed (round 3, c5)", () => {
  it.each(FNS)("K-H1-10 $fn: c5 at pre-rename → lock unreadable, .lock holds \"\", no tomb", ({ call }) => {
    const parent = freshParent();
    acquireLock(parent, { run: A, nonce: N1 });
    const r = runSchedule(
      parent,
      [
        {
          at: "pre-rename",
          competitor: () => {
            fs.unlinkSync(lockFile(parent));
            fs.writeFileSync(lockFile(parent), "", { flag: "wx", mode: 0o600 });
          },
        },
      ],
      () => call(parent),
    );
    expect(r.fired).toEqual([1]);
    expect(r.result).toEqual({ error: "lock unreadable" });
    expect(fs.readFileSync(lockFile(parent), "utf8")).toBe("");
    expect(fs.readdirSync(parent)).toEqual([".lock"]);
  });
});
