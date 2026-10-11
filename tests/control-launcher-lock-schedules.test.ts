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
 *
 * D105-WI-2 (EX-3, EX-4): the sections now run inside `.lock.mutex`. Each
 * competitor carries a protocol: c2 and c4 are in-protocol (`"in"`, deferred
 * to just after the caller's mutex unlink, as a waiting process would be);
 * c1, c3 and c5 are raw writers that ignore the mutex (an older checkout).
 * New invariant I8: no `.lock.mutex*` file remains.
 *
 * The schedule domain (competitors, bases, vocabulary, invariant check) lives
 * in `tests/support/lockScheduleCases.ts` (moved verbatim, rule 50).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { A, B, N2, type Shot, cleanupParents, recordBytes, runSchedule } from "./support/lockSchedules";
import {
  BASES,
  CALL,
  COMPETITORS,
  DISPLACED_RE,
  type Fn,
  type Ledger,
  byName,
  readLockBytes,
  setup,
  violations,
} from "./support/lockScheduleCases";

afterEach(() => {
  vi.restoreAllMocks();
  cleanupParents();
});

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
            const r = runSchedule(parent, [{ at: k, protocol: comp.protocol, competitor: comp.make(parent, ledger) }], () => CALL[fn](parent));
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
      const shot1 = (p: string, l: Ledger): Shot => ({ at: "pre-rename", protocol: "raw", competitor: byName("c1").make(p, l) });
      const d = runSchedule(dry.parent, [shot1(dry.parent, dry.ledger)], () => CALL[fn](dry.parent));
      const from = d.firedAt[0];
      if (from === undefined) {
        found.push(`two-shot ${fn}: shot 1 never fired (no rename of .lock)`);
        continue;
      }
      for (const name of ["c2", "c3", "c4"]) {
        for (let k = from; k <= d.calls; k++) {
          const { parent, ledger } = setup(base, fn);
          const comp = byName(name);
          const r = runSchedule(parent, [shot1(parent, ledger), { at: k, protocol: comp.protocol, competitor: comp.make(parent, ledger) }], () => CALL[fn](parent));
          const label = `two-shot ${fn} c1+${name} k=${k}`;
          if (r.fired[0] !== 1 || r.fired[1] !== 1) found.push(`${label}: shots fired ${JSON.stringify(r.fired)}`);
          found.push(...violations(label, parent, r, ledger, base, fn));
        }
      }
    }
    expect(found).toEqual([]);
  });

  // rule 12: D105-WI-2 K-H1-3 (b). The recorded "c2 displaced" specified the D105
  // hole itself: an in-protocol acquire (c2) landing between the rename and the
  // restore. c2 now waits for the mutex, so A's restore succeeds (A throws `lock
  // names run B, not A`) and the deferred c2 is refused by B: `restored`. The raw
  // writer c3 still reaches the displaced restore, so the path stays exercised.
  it("K-H1-3 non-vacuity: the two-shot sweep reaches a displaced restore for the raw c3, and a clean restore for the in-protocol c2", () => {
    const seen: string[] = [];
    for (const fn of Object.keys(CALL) as Fn[]) {
      for (const name of ["c2", "c3"]) {
        const { parent, ledger } = setup(BASES[0], fn);
        const r = runSchedule(
          parent,
          [
            { at: "pre-rename", protocol: "raw", competitor: byName("c1").make(parent, ledger) },
            { at: "pre-link", protocol: byName(name).protocol, competitor: byName(name).make(parent, ledger) },
          ],
          () => CALL[fn](parent),
        );
        const text = typeof r.result === "string" ? r.result : r.result.error;
        const restored =
          text === `lock names run ${B}, not ${A}` &&
          readLockBytes(parent) === recordBytes(B, N2) &&
          JSON.stringify(ledger.outcomes) === JSON.stringify([`c2 lock held by run ${B}`]);
        seen.push(`${fn} ${name} ${DISPLACED_RE.test(text) ? "displaced" : restored ? "restored" : `${text} ${JSON.stringify(ledger.outcomes)}`}`);
      }
    }
    // rule 12: D105-WI-2 K-H1-3 (b), see above: c2 displaced → restored.
    expect(seen).toEqual([
      "releaseLock c2 restored",
      "releaseLock c3 displaced",
      "releaseOrphanLock c2 restored",
      "releaseOrphanLock c3 displaced",
    ]);
  });
});
