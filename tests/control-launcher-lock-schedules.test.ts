// @vitest-environment node
/**
 * D82-WI-1 (H1) K-H1-3: conservation of lock records over every injection
 * schedule of one release, for both `releaseLock` and `releaseOrphanLock`.
 * Real tmp fs; competitors run at a chosen fs call index through pass-through
 * spies on `node:fs` (`tests/support/lockSchedules.ts`).
 * Matrix: `.claude/tdd-guardian/tests-20261010-103136.md`, D82-WI-1 K-H1-3,
 * with the round 3 competitor c5 (a newcomer still writing its lock).
 *
 * Every violation names its combination, and all are compared with one
 * `toEqual([])`, so a failure lists every broken schedule at once.
 */
import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireLock,
  releaseLock,
  releaseOrphanLock,
  // @ts-expect-error -- plain ESM script, no .d.ts by design
} from "../scripts/control/lock.mjs";
import {
  A,
  B,
  C,
  N1,
  N2,
  N3,
  SECRETS,
  type Shot,
  cleanupParents,
  finalFiles,
  freshParent,
  lockFile,
  recordBytes,
  runSchedule,
} from "./support/lockSchedules";

afterEach(() => {
  vi.restoreAllMocks();
  cleanupParents();
});

type Fn = "releaseLock" | "releaseOrphanLock";
const CALL: Record<Fn, (p: string) => string> = {
  releaseLock: (p) => releaseLock(p, { run: A, nonce: N1 }),
  releaseOrphanLock: (p) => releaseOrphanLock(p, A),
};

/** The records a schedule must conserve: foreign ones alive now (a multiset of bytes). */
type Ledger = { foreign: string[] };
const readLockBytes = (p: string) => {
  try {
    return fs.readFileSync(lockFile(p), "latin1");
  } catch {
    return null;
  }
};
const drop = (l: Ledger, bytes: string | null) => {
  const i = bytes === null ? -1 : l.foreign.indexOf(bytes);
  if (i >= 0) l.foreign.splice(i, 1);
};

type Competitor = { name: string; make: (p: string, l: Ledger) => () => void };
const COMPETITORS: Competitor[] = [
  {
    name: "c1 steal",
    make: (p, l) => () => {
      drop(l, readLockBytes(p));
      try {
        fs.unlinkSync(lockFile(p));
      } catch {
        // absent
      }
      try {
        acquireLock(p, { run: B, nonce: N2 });
        l.foreign.push(recordBytes(B, N2));
      } catch {
        // EEXIST ignored
      }
    },
  },
  {
    name: "c2 acquire",
    make: (p, l) => () => {
      try {
        acquireLock(p, { run: C, nonce: N3 });
        l.foreign.push(recordBytes(C, N3));
      } catch {
        // held
      }
    },
  },
  {
    name: "c3 corrupt",
    make: (p, l) => () => {
      try {
        fs.writeFileSync(lockFile(p), "{", { flag: "wx", mode: 0o600 });
        l.foreign.push("{");
      } catch {
        // present
      }
    },
  },
  {
    name: "c4 own cycle",
    make: (p, l) => () => {
      try {
        acquireLock(p, { run: C, nonce: N3 });
      } catch {
        return;
      }
      let released = false;
      try {
        released = releaseLock(p, { run: C, nonce: N3 }) === "released";
      } catch {
        released = false;
      }
      if (!released) l.foreign.push(recordBytes(C, N3));
    },
  },
  {
    name: "c5 half-written",
    make: (p, l) => () => {
      drop(l, readLockBytes(p));
      try {
        fs.unlinkSync(lockFile(p));
      } catch {
        // absent
      }
      fs.writeFileSync(lockFile(p), "", { flag: "wx", mode: 0o600 });
      l.foreign.push("");
    },
  },
];
const byName = (n: string) => COMPETITORS.find((c) => c.name.startsWith(n)) as Competitor;

type Base = { name: string; write: (p: string) => void; owned: Record<Fn, boolean>; foreign: Record<Fn, string | null> };
const own = (run: string, nonce: string): Base["write"] => (p) => acquireLock(p, { run, nonce });
const BASES: Base[] = [
  { name: "A-owned", write: own(A, N1), owned: { releaseLock: true, releaseOrphanLock: true }, foreign: { releaseLock: null, releaseOrphanLock: null } },
  { name: "B-owned", write: own(B, N2), owned: { releaseLock: false, releaseOrphanLock: false }, foreign: { releaseLock: recordBytes(B, N2), releaseOrphanLock: recordBytes(B, N2) } },
  { name: "A other nonce", write: own(A, N2), owned: { releaseLock: false, releaseOrphanLock: true }, foreign: { releaseLock: recordBytes(A, N2), releaseOrphanLock: null } },
  { name: "absent", write: () => undefined, owned: { releaseLock: false, releaseOrphanLock: false }, foreign: { releaseLock: null, releaseOrphanLock: null } },
  { name: "corrupt", write: (p) => fs.writeFileSync(lockFile(p), "{", { mode: 0o600 }), owned: { releaseLock: false, releaseOrphanLock: false }, foreign: { releaseLock: "{", releaseOrphanLock: "{" } },
];

const VOCAB = [
  /^released$/,
  /^absent$/,
  /^lock unreadable$/,
  new RegExp(`^lock names run (${B}|${C}), not ${A}$`),
  new RegExp(`^lock for run ${A} holds another nonce$`),
  /^lock displaced: kept \.lock\.[^/]+\.tomb$/,
];
const DISPLACED_RE = /^lock displaced: kept (\.lock\.[^/]+\.tomb)$/;

type Run = ReturnType<typeof runSchedule>;
/** I1..I6 for one finished combination; I7 is checked by the caller. */
function violations(label: string, parent: string, r: Run, ledger: Ledger, base: Base, fn: Fn): string[] {
  const out: string[] = [];
  const text = typeof r.result === "string" ? r.result : r.result.error;
  const displaced = DISPLACED_RE.exec(text)?.[1];
  const files = finalFiles(parent);
  const tombs = [...files.keys()].filter((n) => n.endsWith(".tomb"));
  // I1 conservation (multiset): each foreign record is at .lock, or in the named tomb.
  const pool = new Map(files);
  for (const bytes of ledger.foreign) {
    const at = [...pool.entries()].find(([n, b]) => b === bytes && (n === ".lock" || n === displaced));
    if (at) pool.delete(at[0]);
    else out.push(`${label}: I1 record ${JSON.stringify(bytes)} lost`);
  }
  // I2 tomb count.
  const wantTombs = displaced ? [displaced] : [];
  if (JSON.stringify(tombs) !== JSON.stringify(wantTombs)) out.push(`${label}: I2 tombs ${JSON.stringify(tombs)} want ${JSON.stringify(wantTombs)}`);
  // I3 vocabulary.
  if (!VOCAB.some((re) => re.test(text))) out.push(`${label}: I3 unexpected ${JSON.stringify(text)}`);
  // I4 released ⇒ the caller's record existed and no copy remains.
  if (text === "released") {
    const mine = base.owned[fn] ? readBaseBytes(base) : null;
    if (mine === null) out.push(`${label}: I4 released without an owned record`);
    else if ([...files.values()].includes(mine)) out.push(`${label}: I4 a copy of the released record remains`);
  }
  // I5 no secret in a message or a directory entry.
  const names = fs.readdirSync(parent).join("\n");
  for (const s of SECRETS) if (text.includes(s) || names.includes(s)) out.push(`${label}: I5 secret leaked`);
  // I6 distinct rename destinations, competitors' included.
  if (new Set(r.renames).size !== r.renames.length) out.push(`${label}: I6 tomb name reused ${JSON.stringify(r.renames)}`);
  return out;
}
function readBaseBytes(base: Base): string | null {
  const p = freshParent();
  base.write(p);
  return fs.existsSync(lockFile(p)) ? fs.readFileSync(lockFile(p), "latin1") : null;
}

function setup(base: Base, fn: Fn): { parent: string; ledger: Ledger } {
  const parent = freshParent();
  base.write(parent);
  const f = base.foreign[fn];
  return { parent, ledger: { foreign: f === null ? [] : [f] } };
}

describe("D82-WI-1 K-H1-3 conservation over every schedule", () => {
  it("K-H1-3 single-shot sweep: 5 bases × c1..c5 × every k × both functions", () => {
    const found: string[] = [];
    let combos = 0;
    for (const fn of Object.keys(CALL) as Fn[]) {
      for (const base of BASES) {
        const dry = setup(base, fn);
        const n = runSchedule(dry.parent, [], () => CALL[fn](dry.parent)).calls;
        for (const comp of COMPETITORS) {
          for (let k = 0; k <= n; k++) {
            const { parent, ledger } = setup(base, fn);
            const r = runSchedule(parent, [{ at: k, competitor: comp.make(parent, ledger) }], () => CALL[fn](parent));
            const label = `single ${fn} ${base.name} ${comp.name} k=${k}`;
            combos++;
            found.push(...violations(label, parent, r, ledger, base, fn));
            const i7 = base.name === "A-owned" && /^c[234]/.test(comp.name);
            if (i7 && r.result !== "released") found.push(`${label}: I7 got ${JSON.stringify(r.result)}`);
          }
        }
      }
    }
    expect(combos).toBeGreaterThan(100);
    expect(found).toEqual([]);
  });

  it("K-H1-3 two-shot sweep: A-owned, c1 at pre-rename, then c2/c3/c4 at every later index, both functions", () => {
    const found: string[] = [];
    const base = BASES[0];
    for (const fn of Object.keys(CALL) as Fn[]) {
      const dry = setup(base, fn);
      const shot1 = (p: string, l: Ledger): Shot => ({ at: "pre-rename", competitor: byName("c1").make(p, l) });
      const d = runSchedule(dry.parent, [shot1(dry.parent, dry.ledger)], () => CALL[fn](dry.parent));
      const from = d.firedAt[0];
      if (from === undefined) {
        found.push(`two-shot ${fn}: shot 1 never fired (no rename of .lock)`);
        continue;
      }
      for (const name of ["c2", "c3", "c4"]) {
        for (let k = from; k <= d.calls; k++) {
          const { parent, ledger } = setup(base, fn);
          const r = runSchedule(parent, [shot1(parent, ledger), { at: k, competitor: byName(name).make(parent, ledger) }], () => CALL[fn](parent));
          const label = `two-shot ${fn} c1+${name} k=${k}`;
          if (r.fired[0] !== 1 || r.fired[1] !== 1) found.push(`${label}: shots fired ${JSON.stringify(r.fired)}`);
          found.push(...violations(label, parent, r, ledger, base, fn));
        }
      }
    }
    expect(found).toEqual([]);
  });

  it("K-H1-3 non-vacuity: the two-shot sweep reaches a displaced restore for c2 and c3", () => {
    const seen: string[] = [];
    for (const fn of Object.keys(CALL) as Fn[]) {
      for (const name of ["c2", "c3"]) {
        const { parent, ledger } = setup(BASES[0], fn);
        const r = runSchedule(
          parent,
          [
            { at: "pre-rename", competitor: byName("c1").make(parent, ledger) },
            { at: "pre-link", competitor: byName(name).make(parent, ledger) },
          ],
          () => CALL[fn](parent),
        );
        const text = typeof r.result === "string" ? r.result : r.result.error;
        seen.push(`${fn} ${name} ${DISPLACED_RE.test(text) ? "displaced" : text}`);
      }
    }
    expect(seen).toEqual([
      "releaseLock c2 displaced",
      "releaseLock c3 displaced",
      "releaseOrphanLock c2 displaced",
      "releaseOrphanLock c3 displaced",
    ]);
  });
});
