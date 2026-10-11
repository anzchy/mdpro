/**
 * The K-H1-3 schedule domain of `tests/control-launcher-lock-schedules.test.ts`
 * (D82-WI-1, D105-WI-2 EX-3/EX-4): the release under test, the competitors
 * c1..c5 with their protocols, the bases, the message vocabulary and the
 * I1..I6/I8 invariant check. Moved here verbatim (D105, rule 50: the test file
 * was over 300 lines); the assertions stay in the test file.
 */
import fs from "node:fs";
import {
  acquireLock,
  releaseLock,
  releaseOrphanLock,
  // @ts-expect-error -- plain ESM script, no .d.ts by design
} from "../../scripts/control/lock.mjs";
import { A, B, C, N1, N2, N3, SECRETS, finalFiles, freshParent, lockFile, recordBytes, runSchedule } from "./lockSchedules";

export type Fn = "releaseLock" | "releaseOrphanLock";
export const CALL: Record<Fn, (p: string) => string> = {
  releaseLock: (p) => releaseLock(p, { run: A, nonce: N1 }),
  releaseOrphanLock: (p) => releaseOrphanLock(p, A),
};

/**
 * The records a schedule must conserve: foreign ones alive now (a multiset of
 * bytes). D105-WI-2: `outcomes` logs what the in-protocol competitors were told.
 */
export type Ledger = { foreign: string[]; outcomes: string[] };
export const readLockBytes = (p: string) => {
  try {
    return fs.readFileSync(lockFile(p), "latin1");
  } catch {
    return null;
  }
};
export const drop = (l: Ledger, bytes: string | null) => {
  const i = bytes === null ? -1 : l.foreign.indexOf(bytes);
  if (i >= 0) l.foreign.splice(i, 1);
};

export type Competitor = { name: string; protocol: "in" | "raw"; make: (p: string, l: Ledger) => () => void };
export const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const COMPETITORS: Competitor[] = [
  {
    // rule 12: D105-WI-2 K-H1-3 (a). c1 was a raw unlink then `acquireLock(B)`.
    // `acquireLock` now takes `.lock.mutex`, so it can no longer run in the middle
    // of a release section; c1 is now fully raw (raw unlink, raw `wx` write of
    // B's exact bytes), a writer that ignores the mutex. Same record, same point.
    name: "c1 steal",
    protocol: "raw",
    make: (p, l) => () => {
      drop(l, readLockBytes(p));
      try {
        fs.unlinkSync(lockFile(p));
      } catch {
        // absent
      }
      try {
        fs.writeFileSync(lockFile(p), recordBytes(B, N2), { flag: "wx", mode: 0o600 });
        l.foreign.push(recordBytes(B, N2));
      } catch {
        // EEXIST ignored
      }
    },
  },
  {
    // rule 12: D105-WI-2 K-H1-3 (a). c2 is marked in-protocol; it now also logs
    // its outcome for the EX-4 non-vacuity check.
    name: "c2 acquire",
    protocol: "in",
    make: (p, l) => () => {
      try {
        acquireLock(p, { run: C, nonce: N3 });
        l.foreign.push(recordBytes(C, N3));
        l.outcomes.push("c2 acquired");
      } catch (e) {
        l.outcomes.push(`c2 ${message(e)}`);
      }
    },
  },
  {
    name: "c3 corrupt",
    protocol: "raw",
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
    // rule 12: D105-WI-2 K-H1-3 (a). c4 is marked in-protocol.
    name: "c4 own cycle",
    protocol: "in",
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
    protocol: "raw",
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
export const byName = (n: string) => COMPETITORS.find((c) => c.name.startsWith(n)) as Competitor;

export type Base = { name: string; write: (p: string) => void; owned: Record<Fn, boolean>; foreign: Record<Fn, string | null> };
export const own = (run: string, nonce: string): Base["write"] => (p) => acquireLock(p, { run, nonce });
export const BASES: Base[] = [
  { name: "A-owned", write: own(A, N1), owned: { releaseLock: true, releaseOrphanLock: true }, foreign: { releaseLock: null, releaseOrphanLock: null } },
  { name: "B-owned", write: own(B, N2), owned: { releaseLock: false, releaseOrphanLock: false }, foreign: { releaseLock: recordBytes(B, N2), releaseOrphanLock: recordBytes(B, N2) } },
  { name: "A other nonce", write: own(A, N2), owned: { releaseLock: false, releaseOrphanLock: true }, foreign: { releaseLock: recordBytes(A, N2), releaseOrphanLock: null } },
  { name: "absent", write: () => undefined, owned: { releaseLock: false, releaseOrphanLock: false }, foreign: { releaseLock: null, releaseOrphanLock: null } },
  { name: "corrupt", write: (p) => fs.writeFileSync(lockFile(p), "{", { mode: 0o600 }), owned: { releaseLock: false, releaseOrphanLock: false }, foreign: { releaseLock: "{", releaseOrphanLock: "{" } },
];

export const VOCAB = [
  /^released$/,
  /^absent$/,
  /^lock unreadable$/,
  new RegExp(`^lock names run (${B}|${C}), not ${A}$`),
  new RegExp(`^lock for run ${A} holds another nonce$`),
  /^lock displaced: kept \.lock\.[^/]+\.tomb$/,
];
export const DISPLACED_RE = /^lock displaced: kept (\.lock\.[^/]+\.tomb)$/;

export type Run = ReturnType<typeof runSchedule>;
/** I1..I6 and I8 for one finished combination; I7 is checked by the caller. */
export function violations(label: string, parent: string, r: Run, ledger: Ledger, base: Base, fn: Fn): string[] {
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
  // I8 (D105-WI-2) no mutex or break file outlives the schedule.
  const mutexFiles = fs.readdirSync(parent).filter((n) => n.startsWith(".lock.mutex"));
  if (mutexFiles.length > 0) out.push(`${label}: I8 mutex files left ${JSON.stringify(mutexFiles)}`);
  return out;
}
export function readBaseBytes(base: Base): string | null {
  const p = freshParent();
  base.write(p);
  return fs.existsSync(lockFile(p)) ? fs.readFileSync(lockFile(p), "latin1") : null;
}

export function setup(base: Base, fn: Fn): { parent: string; ledger: Ledger } {
  const parent = freshParent();
  base.write(parent);
  const f = base.foreign[fn];
  return { parent, ledger: { foreign: f === null ? [] : [f], outcomes: [] } };
}
