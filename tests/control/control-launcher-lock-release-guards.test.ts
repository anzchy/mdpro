// @vitest-environment node
/**
 * D82-WI-1 (H1): the guard rows of the atomic lock release, moved verbatim
 * from `control-launcher-lock-release.test.ts` (D105, rule 50: that file was
 * over 300 lines). Real tmp fs; `scripts/control/lock.mjs`.
 * Matrix: `.claude/tdd-guardian/tests-20261010-103136.md`, D82-WI-1:
 * K-H1-7 (doctor ignores tombs), K-H1-8 (corrupt or directory locks are never
 * moved aside), K-H1-9 (an unwritable runs parent), and the round 3 case
 * K-H1-10 (a half-written newcomer is restored).
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
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { collectFacts } from "../../scripts/control/doctor.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { runsParent } from "../../scripts/control/runDir.mjs";
import { fakeProcFacts, makeHome } from "../support/launcherFakes";
import { A, N1, SECRETS, cleanupParents, freshParent, lockFile, runSchedule, thrown } from "../support/lockSchedules";
import { collectionCases } from "../support/collectionCases";

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
  it.each(collectionCases("tests/control/control-launcher-lock-release-guards.test.ts:85", ROWS))("K-H1-8 $row via $fn: lock unreadable, .lock untouched, zero renames of .lock", ({ make, call }) => {
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
