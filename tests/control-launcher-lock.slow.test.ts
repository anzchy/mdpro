// @vitest-environment node
/**
 * D82-WI-1 (H1) K-H1-S: cross-process stress of the atomic lock release, the
 * real-path pairing for the fs-spy schedules in
 * `control-launcher-lock-release.test.ts` / `-lock-schedules.test.ts`.
 * Real child processes and the real fs; no spies. Slow lane (ADR-0050).
 * Matrix: `.claude/tdd-guardian/tests-20261010-103136.md`, D82-WI-1 K-H1-S,
 * with the round 3 invariant (gap R2-1) replacing `stolen ≤ displaced`.
 *
 * Per owned name Aj: an owner loops `acquireLock(Aj)`, and a same-name
 * releaser pair loops `releaseLock(Aj)` / `releaseOrphanLock(Aj)`. Acquirers
 * Bi take, re-read and release their own lock. No releaser targets a B name,
 * so Bi's record may leave `.lock` without Bi's own release only through a
 * tomb: it is restored later (Bi then meets it as `resurrected`), kept by a
 * displaced restore, or still at `.lock` at the end.
 *
 * D131: the non-vacuity guards (an `own` re-read, a pair's `"released"`) need
 * the children's windows to overlap, which a loaded scheduler need not give a
 * fixed round count. The second case injects the non-overlap deterministically.
 * The harness lives in `tests/support/lockStress.ts`.
 *
 * D105-WI-5 (stress guards for the `.lock.mutex` sections; not the red
 * drivers): ST-1 runs the same roles with `strict: true`, which also reports
 * the acquirers' non-own re-reads, the `lock busy` results and the mutex files
 * left at the end. With acquire and release serialised, no record leaves
 * `.lock` behind its owner's back: no tomb, no displaced restore, no
 * resurrection, no lost own release. `lock busy` is vocabulary, never a
 * violation (E39: no timing gate). ST-2 adds a child that SIGKILLs itself
 * inside an acquire's mutex section once; the others break its mutex (ESRCH)
 * and run on, and the end state is clean.
 * Plan and matrix: `.claude/tdd-guardian/plan-d105-20261011-144108.md`,
 * D105-WI-5 ST-1, ST-2.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanupStressDirs, type Observed, runStress } from "./support/lockStress";

const VOCAB = [
  /^released$/,
  /^absent$/,
  /^ok$/,
  /^lock unreadable$/,
  /^lock names run [0-9a-z]{25}, not [0-9a-z]{25}$/,
  /^lock for run [0-9a-z]{25} holds another nonce$/,
  /^lock displaced: kept \.lock\.[^/]+\.tomb$/,
  /^lock held by run [0-9a-z]{25}$/,
];

afterEach(cleanupStressDirs);

function expectInvariants(o: Observed): void {
  const accounted = o.perAcquirer.map(({ counts: c }) => c.lostOwnReleases <= c.resurrected + c.inTombs + c.atLock);
  const badMessages = [...new Set(o.results.filter((r) => !VOCAB.some((re) => re.test(r))))];
  const { results: _results, ...counts } = o;
  const summary = JSON.stringify({ ...counts, accounted, badMessages });
  // rule 12: D131 split the single toEqual over five fields into one expect per
  // field, so a failure names the field instead of a truncated `…(4)`. Every
  // expected value is unchanged.
  expect(accounted, `accounted: ${summary}`).toEqual([true, true]);
  expect(o.tombs, `tombs === displaced: ${summary}`).toBe(o.displaced);
  expect(o.own > 0, `ownSeen: ${summary}`).toBe(true);
  expect(o.releasedByPairs > 0, `releasedSeen: ${summary}`).toBe(true);
  expect(badMessages, `badMessages: ${summary}`).toEqual([]);
}

describe("D82-WI-1 K-H1-S cross-process stress", () => {
  it("K-H1-S no acquirer's record is lost: every failed own release is accounted for by a resurrection, a tomb, or the final .lock", async () => {
    expectInvariants(await runStress());
  }, 120_000);

  it("D131 K-H1-S the guards still hold when each releaser pair ran its fixed rounds before its owner started", async () => {
    expectInvariants(await runStress({ ownersAfterTheirPairs: true }));
  }, 120_000);
});

const BUSY_VOCAB = [
  /^lock busy: mutex held by pid \d+$/,
  /^lock busy: mutex unreadable$/,
  /^lock busy: mutex break file kept \(\.lock\.mutex\.break\)$/,
];

/** ST-1 / ST-2: what the serialised sections must make impossible, read with optional chaining. */
function expectStrict(o: Observed): void {
  const s = o.strict;
  const badMessages = [...new Set(o.results.filter((r) => ![...VOCAB, ...BUSY_VOCAB].some((re) => re.test(r))))];
  const { results: _results, ...counts } = o;
  const summary = JSON.stringify({ ...counts, badMessages });
  expect(
    {
      displaced: o.displaced,
      tombs: o.tombs,
      nonOwnRereads: s?.nonOwnRereads,
      resurrected: s?.resurrected,
      lostOwnReleases: s?.lostOwnReleases,
      mutexFiles: s?.mutexFiles,
      badMessages,
    },
    summary,
  ).toEqual({ displaced: 0, tombs: 0, nonOwnRereads: 0, resurrected: 0, lostOwnReleases: 0, mutexFiles: [], badMessages: [] });
  expect(typeof s?.busy, `busy is counted: ${summary}`).toBe("number");
  expect(o.own > 0, `ownSeen: ${summary}`).toBe(true);
  expect(o.releasedByPairs > 0, `releasedSeen: ${summary}`).toBe(true);
}

describe("D105-WI-5 stress guards for the serialised lock sections", () => {
  it("ST-1 strict: no tomb, no displaced restore, no stolen or vanished re-read, no resurrection, no lost own release, no mutex file left", async () => {
    expectStrict(await runStress({ strict: true }));
  }, 120_000);

  it("ST-2 a child SIGKILLed inside an acquire's mutex section: the others break its mutex and the end state is clean", async () => {
    const o = await runStress({ strict: true, killInsideMutex: true });
    expectStrict(o);
    const k = o.strict?.killer;
    expect({ signal: k?.signal, mutexPidAtKill: k?.mutexPidAtKill }).toEqual({ signal: "SIGKILL", mutexPidAtKill: k?.pid });
    expect(typeof k?.pid).toBe("number");
  }, 120_000);
});
