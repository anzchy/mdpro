// @vitest-environment node
/**
 * WI-2 (ADR-0031 step 5a, Amendment A1) — the pure `lastViewMode` latch.
 *
 * Cases LVL-01 … LVL-06 of `.claude/tdd-guardian/tests-20260926-221500.md`
 * (revision 3).
 *
 * **Laws.**
 * - (L-hold) No write before the first `settled`.
 * - (L-read) A `settled` event never produces a write.
 * - (L-idem) Duplicating any event in place leaves the write sequence unchanged.
 * - (L-trans) After arming, each `observed(m)` with `m ≠ lastSeen` writes `m`
 *   once; `lastSeen` is updated by both `settled` and `observed`. A `settled`
 *   while armed re-baselines (Ambiguity 1).
 *
 * Nothing is mocked and nothing is imported except the module under test.
 * `ViewMode` is a two-value union, so the property cases enumerate every
 * sequence exhaustively instead of sampling.
 */
import { describe, expect, it } from "vitest";
import {
  HOLDING,
  isHolding,
  reduce,
  type LatchEvent,
  type LatchState,
} from "../src/utils/lastViewModeLatch";

type Mode = "wysiwyg" | "source";
type Ev = LatchEvent<Mode>;

const MODES: Mode[] = ["wysiwyg", "source"];
const other = (m: Mode): Mode => (m === "wysiwyg" ? "source" : "wysiwyg");
const settled = (mode: Mode): Ev => ({ kind: "settled", mode });
const observed = (mode: Mode): Ev => ({ kind: "observed", mode });
const ALPHABET: Ev[] = [
  settled("wysiwyg"),
  settled("source"),
  observed("wysiwyg"),
  observed("source"),
];

/** Fold `reduce` from `holding`, collecting one write (or null) per event. */
function run(events: Ev[]): { state: LatchState<Mode>; writes: (Mode | null)[] } {
  let state: LatchState<Mode> = HOLDING;
  const writes: (Mode | null)[] = [];
  for (const e of events) {
    const r: { state: LatchState<Mode>; write: Mode | null } = reduce(state, e);
    state = r.state;
    writes.push(r.write);
  }
  return { state, writes };
}

/** Independent oracle: a straight loop over `lastSeen`, one entry per event. */
function oracle(events: Ev[]): (Mode | null)[] {
  let lastSeen: Mode | null = null;
  return events.map((e) => {
    if (e.kind === "settled") {
      lastSeen = e.mode;
      return null;
    }
    if (lastSeen !== null && e.mode !== lastSeen) {
      lastSeen = e.mode;
      return e.mode;
    }
    return null;
  });
}

/** Every sequence over the four-event alphabet of length 0 … maxLen. */
function allSequences(maxLen: number): Ev[][] {
  const out: Ev[][] = [[]];
  let frontier: Ev[][] = [[]];
  for (let len = 1; len <= maxLen; len++) {
    const next: Ev[][] = [];
    for (const seq of frontier) for (const e of ALPHABET) next.push([...seq, e]);
    out.push(...next);
    frontier = next;
  }
  return out;
}

const label = (seq: Ev[]) =>
  `[${seq.map((e) => `${e.kind === "settled" ? "S" : "O"}(${e.mode[0]})`).join(" ")}]`;
const nonNull = (ws: (Mode | null)[]) => ws.filter((w): w is Mode => w !== null);

describe("lastViewModeLatch#reduce (WI-2, pure)", () => {
  it("LVL-01: holding + observed(m) writes nothing and stays holding, for every ViewMode", () => {
    for (const m of MODES) {
      const r = reduce(HOLDING, observed(m));
      expect(r, `observed(${m})`).toEqual({ state: HOLDING, write: null });
      expect(isHolding(r.state), `observed(${m}) stays holding`).toBe(true);
    }
  });

  it("LVL-02: settled(m) from holding arms with lastSeen m and no write", () => {
    for (const m of MODES) {
      const armed = reduce(HOLDING, settled(m));
      expect(armed.write, `settled(${m})`).toBeNull();
      expect(isHolding(armed.state), `settled(${m}) leaves holding`).toBe(false);
      expect(reduce(armed.state, observed(m)).write, `then observed(${m})`).toBeNull();
      expect(reduce(armed.state, observed(other(m))).write, `then observed(other)`).toBe(
        other(m),
      );
    }
  });

  it("LVL-03: armed(m) + observed(m) writes nothing (idempotence)", () => {
    for (const m of MODES) {
      const same = run([settled(m), observed(m), observed(m), observed(m)]).writes.slice(1);
      expect(same, `settled(${m}) then observed(${m}) x3`).toEqual([null, null, null]);
      const o = other(m);
      const flip = run([settled(m), observed(o), observed(o), observed(o)]).writes.slice(1);
      expect(flip, `settled(${m}) then observed(${o}) x3`).toEqual([o, null, null]);
    }
  });

  it("LVL-04: a settled event while armed re-baselines and does not write", () => {
    const a = run([
      settled("source"),
      observed("wysiwyg"),
      settled("source"),
      observed("source"),
    ]).writes.slice(1);
    expect(a, "re-settle to the value just left").toEqual(["wysiwyg", null, null]);

    const b = run([
      settled("source"),
      observed("wysiwyg"),
      settled("wysiwyg"),
      observed("source"),
    ]).writes.slice(1);
    expect(b, "re-settle to the current value").toEqual(["wysiwyg", null, "source"]);
  });

  it("LVL-05: L-hold, L-read and L-trans hold over every event sequence up to length 7", () => {
    const seqs = allSequences(7);
    expect(seqs.length).toBe(21845);

    const holdViolations: string[] = [];
    const readViolations: string[] = [];
    const oracleViolations: string[] = [];
    for (const seq of seqs) {
      const { writes } = run(seq);
      const firstSettled = seq.findIndex((e) => e.kind === "settled");
      writes.forEach((w, i) => {
        if (w === null) return;
        // (i) L-hold: every write comes strictly after the first settled.
        if (firstSettled === -1 || i <= firstSettled) holdViolations.push(`${label(seq)}@${i}`);
        // (ii) L-read: a write only answers an observed event, with its own mode.
        const e = seq[i];
        if (e.kind !== "observed" || w !== e.mode) readViolations.push(`${label(seq)}@${i}`);
      });
      // (iii) L-trans: the writes equal the independent oracle's.
      const expected = oracle(seq);
      if (JSON.stringify(writes) !== JSON.stringify(expected)) {
        oracleViolations.push(
          `${label(seq)} got ${JSON.stringify(writes)} want ${JSON.stringify(expected)}`,
        );
      }
    }
    expect(holdViolations.slice(0, 5), "L-hold: write before first settled").toEqual([]);
    expect(readViolations.slice(0, 5), "L-read: write not caused by observed(mode)").toEqual([]);
    expect(oracleViolations.slice(0, 5), "L-trans: writes differ from oracle").toEqual([]);
  });

  it("LVL-06: stutter invariance (L-idem) across every sequence up to length 6", () => {
    const violations: string[] = [];
    for (const seq of allSequences(6)) {
      const base = nonNull(run(seq).writes);
      for (let i = 0; i < seq.length; i++) {
        const stuttered = [...seq.slice(0, i + 1), seq[i], ...seq.slice(i + 1)];
        const got = nonNull(run(stuttered).writes);
        if (JSON.stringify(got) !== JSON.stringify(base)) {
          violations.push(`${label(seq)} dup@${i}: ${JSON.stringify(got)} vs ${JSON.stringify(base)}`);
        }
      }
    }
    expect(violations.slice(0, 5), "L-idem: duplicating an event changed the writes").toEqual([]);
  });
});
