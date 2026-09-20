/**
 * Purpose: WI-1 — the pure line-based active-entry picker
 * `src/utils/tocLineSpy.ts#pickActiveKeyByLine`. Implements §1 cases P-1 … P-10 of
 * `.claude/tdd-guardian/tests-20260919-151931.md`.
 *
 * WI-1b appends §2 cases R-1 … R-11 for the second export of the same module,
 * `retainVisibleActiveKey` — the visible-current-entry retention that stops the
 * tail-clamp regression (amendment A-1). No P-* case above is edited (§0.15, rule 12).
 *
 * ---------------------------------------------------------------------------
 * SPY-WI-3 — the `atScrollLimit` gate (matrix `.claude/tdd-guardian/tests-20260920-081500.md`)
 * ---------------------------------------------------------------------------
 * `retainVisibleActiveKey` gained a **sixth parameter**, `atScrollLimit`, and returns
 * `picked` immediately when it is `false`. The unconditional retention it replaces was
 * the **directional freeze**: scrolling *up* kept the previously-active heading for a
 * whole screenful, because that heading is still inside `[topLine, bottomLine]` for the
 * entire distance it takes to leave the viewport.
 *
 * Two consequences for this file, both stated rather than hidden:
 *
 *  1. **Every recorded R-* call site gains a sixth argument.** That is shape churn: no
 *     expected value moves, because each recorded row either exits through a guard that
 *     runs before the new gate or is run with `atScrollLimit === true`, which is
 *     byte-for-byte today's behaviour. Where a recorded case gained a `false` twin, the
 *     twin is a *new* assertion alongside the recorded one, never a replacement.
 *  2. **R-10 is split into R-10a / R-10b.** The recorded R-10 demanded, for *every*
 *     descending step where the previously-current entry is still visible, that the
 *     index be UNCHANGED — with no scroll-limit condition anywhere. That is the freeze,
 *     recorded as a law. R-10a keeps it verbatim under `atScrollLimit === true`; R-10b
 *     runs the same sweep under `false` and inverts it. The recorded assertions are
 *     preserved in R-10a, not edited.
 *
 * New cases R-12 … R-20 are appended. `buildRetainTableWithLimit` is the recorded
 * 36-row table crossed with `[true, false]` — **not** a reshuffle of a larger cross,
 * so the `true` half reproduces the recorded results exactly and the LCG draw sequence
 * and printed seed survive byte-for-byte (matrix §4).
 *
 * ---------------------------------------------------------------------------
 * Constraints honoured (matrix §0)
 * ---------------------------------------------------------------------------
 * - **Lane `unit`** (§0.1), file under `tests/` (§0.2). Mock boundary: **none** — the
 *   function under test is pure, so there is nothing to mock and nothing is mocked.
 * - **No new dependency** (§0.3, gate G0). `fast-check` is forbidden; the S4/S5/S6
 *   domain below is a hand-written table plus the in-tree LCG from
 *   `tests/helpers/headingCorpus.ts`, and every property failure message prints the
 *   `topLine` and the seed so a red is reproducible.
 * - **No `Object.hasOwn`** (§0.4) — `lib: ["ES2020"]` rejects it (TS2550).
 * - **Standing rule H2** (§0.5): every case asserts its entry keys are pairwise
 *   distinct before asserting anything about them. A duplicate key would make
 *   conservation, monotonicity and the duplicate-heading case all pass vacuously.
 *   The keys come from the test-local `mintKey` counter (the
 *   `tests/toc-element-resolution.test.ts:68-70` idiom); the counter is a convention,
 *   not a proof, so H2 is asserted anyway.
 * - **No literal key string is ever asserted** (§0.6). Every expectation is identity
 *   against an element of the entries array, distinctness, membership, or absence.
 *
 * Deviation from the plan, stated rather than hidden: the plan names this file
 * `tests/toc-line-spy-picker.test.ts`; the WI-1 dispatch names it
 * `tests/toc-line-spy.test.ts`. The filename carries no behaviour — both are inside
 * the `tests/**\/*.test.ts` glob — and the dispatch is the later instruction.
 */
import { describe, expect, it } from "vitest";

import { pickActiveKeyByLine, retainVisibleActiveKey } from "../src/utils/tocLineSpy";
import { asAnchorSlug, asHeadingKey } from "../src/types/toc";
import type { HeadingKey, TOCEntry } from "../src/types/toc";
import { createLcg, DEFAULT_SEED } from "./helpers/headingCorpus";

// ---------------------------------------------------------------------------
// Test-local fixtures
// ---------------------------------------------------------------------------

type Level = TOCEntry["level"];

/** Test-local, never reset. No assertion ever compares against the value it makes. */
let keySequence = 0;
function mintKey(): HeadingKey {
  keySequence += 1;
  return asHeadingKey(`test-hk-${keySequence}`);
}

function makeEntry(lineNumber: number, level: Level, text: string): TOCEntry {
  return {
    key: mintKey(),
    anchorSlug: asAnchorSlug(`slug-${keySequence}`),
    level,
    text,
    lineNumber,
    offset: lineNumber * 10,
    children: [],
  };
}

/**
 * Entries at the given line numbers, each with a distinct text and a cycling level.
 * Text and level vary so that a picker that (wrongly) read either would produce a
 * different answer here than in the P-8 twin, where both are flattened.
 */
function entriesAtLines(lines: readonly number[]): TOCEntry[] {
  return lines.map((line, i) =>
    makeEntry(line, ((i % 6) + 1) as Level, `Heading ${line}-${i}`),
  );
}

/** Standing rule H2 (§0.5). */
function expectDistinctKeys(entries: readonly TOCEntry[]): void {
  const keys = entries.map((e) => e.key);
  expect(new Set(keys).size).toBe(keys.length);
}

/** Index of `key` in `entries`, or `-1` for `null`. Never asserts a key literal. */
function indexOfResult(entries: readonly TOCEntry[], key: HeadingKey | null): number {
  if (key === null) return -1;
  return entries.findIndex((e) => e.key === key);
}

/**
 * The specified rule, re-expressed: "the last entry **in the given order** whose
 * `lineNumber <= topLine`". Written as filter-then-take-last rather than as a reverse
 * scan, so it is a restatement of the spec and not a transcription of the
 * implementation. Used only where the matrix asks the expectation to be *computed*
 * from the rule (P-10).
 */
function referenceLastAtOrAbove(
  entries: readonly TOCEntry[],
  topLine: number,
): HeadingKey | null {
  const eligible = entries.filter((e) => e.lineNumber <= topLine);
  if (eligible.length === 0) return null;
  return eligible[eligible.length - 1].key;
}

// ---------------------------------------------------------------------------
// The shared 44-point anchor sweep (P-6, P-7, P-8)
// ---------------------------------------------------------------------------

/**
 * Adjacent pairs (`1,2`, `7,8`, `30,31`) are deliberate: an off-by-one that survives
 * isolated headings dies on two headings one line apart.
 */
const SWEEP_LINES: readonly number[] = [1, 2, 7, 8, 30, 31];

/** 12 values drawn from the in-tree LCG in `[0, 40]`. Seed printed on every failure. */
function lcgDraws(count: number): number[] {
  const next = createLcg(DEFAULT_SEED);
  const drawn: number[] = [];
  for (let i = 0; i < count; i++) drawn.push(next() % 41);
  return drawn;
}

/**
 * 44 points: 13 named (each heading line, each ±1, line 0, and 100 beyond the last),
 * the 12 computed ±1 neighbours, 7 gap midpoints (below-first, the five inter-heading
 * gaps, and one past the last heading), and 12 LCG draws. Duplicates are kept on
 * purpose — monotonicity must also hold across equal `topLine` values.
 */
const ANCHOR_SWEEP: readonly number[] = [
  // 13 named points
  0, 1, 2, 3, 6, 7, 8, 9, 29, 30, 31, 32, 100,
  // 12 computed neighbours
  ...SWEEP_LINES.reduce<number[]>((acc, l) => acc.concat([l - 1, l + 1]), []),
  // 7 gap midpoints
  0.5, 1.5, 4.5, 7.5, 19, 30.5, 35.5,
  // 12 LCG draws
  ...lcgDraws(12),
];

const SORTED_SWEEP: readonly number[] = [...ANCHOR_SWEEP].sort((a, b) => a - b);

function sweepLabel(topLine: number, i: number): string {
  return `topLine=${topLine} (sorted index ${i}, seed ${DEFAULT_SEED})`;
}

// ---------------------------------------------------------------------------
// §1 — pickActiveKeyByLine
// ---------------------------------------------------------------------------

describe("pickActiveKeyByLine", () => {
  it("P-1: topLine equal to each heading's own lineNumber selects that heading", () => {
    const lines = [1, 5, 9, 40];
    const entries = entriesAtLines(lines);
    expectDistinctKeys(entries);

    for (let i = 0; i < entries.length; i++) {
      const result = pickActiveKeyByLine(entries, entries[i].lineNumber);
      expect(
        result,
        `boundary index ${i} at lineNumber ${entries[i].lineNumber}`,
      ).toBe(entries[i].key);
    }
  });

  it("P-2: last-wins strictly inside a gap", () => {
    const entries = entriesAtLines([1, 5, 9]);
    expectDistinctKeys(entries);

    const result = pickActiveKeyByLine(entries, 7);
    expect(result).toBe(entries[1].key);
    // "picked something" must not be mistaken for "picked the right thing".
    expect(result).not.toBe(entries[2].key);
    expect(result).not.toBe(entries[0].key);
  });

  it("P-3: topLine strictly above the first heading returns null", () => {
    const entries = entriesAtLines([3, 10]);
    expectDistinctKeys(entries);

    for (const topLine of [0, 1, 2]) {
      expect(pickActiveKeyByLine(entries, topLine), `topLine=${topLine}`).toBeNull();
    }
    // Wrong-reason guard: null is a boundary, not a constant.
    expect(pickActiveKeyByLine(entries, 3)).toBe(entries[0].key);
  });

  it("P-4: empty entries returns null without throwing", () => {
    const entries: readonly TOCEntry[] = [];

    for (const topLine of [-1, 0, 1, 1000]) {
      expect(() => pickActiveKeyByLine(entries, topLine)).not.toThrow();
      // `toBeNull` and not `toBeFalsy`: undefined must not pass for null.
      expect(pickActiveKeyByLine(entries, topLine), `topLine=${topLine}`).toBeNull();
    }
  });

  it("P-5: duplicate headings resolve to two different keys", () => {
    const first = makeEntry(3, 2, "Intro");
    const second = makeEntry(40, 2, "Intro");
    const entries = [first, second];
    expectDistinctKeys(entries);
    // The duplication really is a duplication in every field but position.
    expect(second.text).toBe(first.text);
    expect(second.level).toBe(first.level);

    const at3 = pickActiveKeyByLine(entries, 3);
    const at39 = pickActiveKeyByLine(entries, 39);
    const at40 = pickActiveKeyByLine(entries, 40);
    const at41 = pickActiveKeyByLine(entries, 41);

    expect(at3).toBe(entries[0].key);
    expect(at39).toBe(entries[0].key);
    expect(at40).toBe(entries[1].key);
    expect(at41).toBe(entries[1].key);
    expect(at40).not.toBe(at39);
  });

  it("P-6: LAW monotonicity — the chosen index never decreases across the sweep", () => {
    const entries = entriesAtLines(SWEEP_LINES);
    expectDistinctKeys(entries);
    expect(ANCHOR_SWEEP.length).toBe(44);

    // Wrong-reason guard (b): the table straddles both ends of the heading range.
    expect(ANCHOR_SWEEP.some((t) => t < 1)).toBe(true);
    expect(ANCHOR_SWEEP.some((t) => t > 31)).toBe(true);

    const idx = SORTED_SWEEP.map((topLine) =>
      indexOfResult(entries, pickActiveKeyByLine(entries, topLine)),
    );

    for (let i = 1; i < idx.length; i++) {
      expect(idx[i], sweepLabel(SORTED_SWEEP[i], i)).toBeGreaterThanOrEqual(idx[i - 1]);
    }

    // Wrong-reason guard (a): a constant function, `return null` and
    // `return entries[0].key` all satisfy monotonicity and all fail this.
    expect(new Set(idx).size, `index set: ${JSON.stringify([...new Set(idx)])}`).toBe(7);
  });

  it("P-7: LAW conservation — every result is null or a key present in entries", () => {
    const entries = entriesAtLines(SWEEP_LINES);
    expectDistinctKeys(entries);

    const results = SORTED_SWEEP.map((topLine) => pickActiveKeyByLine(entries, topLine));

    results.forEach((r, i) => {
      const present = r === null || entries.some((e) => e.key === r);
      expect(present, sweepLabel(SORTED_SWEEP[i], i)).toBe(true);
    });

    // Wrong-reason guard: conservation is satisfied vacuously by `return null`.
    expect(results.filter((r) => r !== null).length).toBeGreaterThan(30);
  });

  it("P-8: LAW independence from text and level (metamorphic)", () => {
    const entriesA = entriesAtLines(SWEEP_LINES);
    // Run B: same lines, every text flattened to "same", every level to 2, every
    // anchorSlug to the same slug, and freshly minted distinct keys.
    const entriesB: TOCEntry[] = SWEEP_LINES.map((line) => ({
      key: mintKey(),
      anchorSlug: asAnchorSlug("same"),
      level: 2 as Level,
      text: "same",
      lineNumber: line,
      offset: line * 10,
      children: [],
    }));
    expectDistinctKeys(entriesA);
    expectDistinctKeys(entriesB);
    expect(new Set(entriesB.map((e) => e.text)).size).toBe(1);
    expect(new Set(entriesB.map((e) => e.level)).size).toBe(1);

    const resultsA = SORTED_SWEEP.map((t) => pickActiveKeyByLine(entriesA, t));
    const resultsB = SORTED_SWEEP.map((t) => pickActiveKeyByLine(entriesB, t));
    const idxA = resultsA.map((r) => indexOfResult(entriesA, r));
    const idxB = resultsB.map((r) => indexOfResult(entriesB, r));

    expect(idxB, `seed ${DEFAULT_SEED}`).toEqual(idxA);

    // Wrong-reason guard (a): an all-constant pair must not satisfy the relation.
    expect(new Set(idxA).size).toBe(7);
    // Wrong-reason guard (b): run B really is a different entries array — the key
    // sequences differ, so this is not an array compared with itself.
    expect(resultsB).not.toEqual(resultsA);
  });

  it("P-9: guard/determinism — degenerate topLine values are total and stable", () => {
    const entries = entriesAtLines([1, 5, 9]);
    expectDistinctKeys(entries);

    const table: ReadonlyArray<readonly [number, HeadingKey | null]> = [
      [NaN, null],
      [-1, null],
      [-Infinity, null],
      [0, null],
      [Infinity, entries[2].key],
      [2.5, entries[0].key],
      [4.999, entries[0].key],
      [5.000001, entries[1].key],
      [Number.MAX_SAFE_INTEGER, entries[2].key],
    ];

    for (const [topLine, expected] of table) {
      expect(() => pickActiveKeyByLine(entries, topLine)).not.toThrow();
      const first = pickActiveKeyByLine(entries, topLine);
      expect(first, `topLine=${String(topLine)}`).toBe(expected);
      // Determinism: same input, same output.
      const second = pickActiveKeyByLine(entries, topLine);
      expect(second, `topLine=${String(topLine)} (second call)`).toBe(first);
    }
  });

  it("P-10: out-of-order entries are total, not thrown on", () => {
    const entries = entriesAtLines([9, 1, 5]);
    expectDistinctKeys(entries);
    const before = entries.map((e) => e.lineNumber);

    for (const topLine of [0, 1, 5, 7, 9, 20]) {
      expect(() => pickActiveKeyByLine(entries, topLine)).not.toThrow();
      // Expectation computed from the stated rule, not transcribed from the module.
      expect(pickActiveKeyByLine(entries, topLine), `topLine=${topLine}`).toBe(
        referenceLastAtOrAbove(entries, topLine),
      );
    }

    // The documented fallback, spelled out so the rule above cannot drift silently.
    expect(pickActiveKeyByLine(entries, 0)).toBeNull();
    expect(pickActiveKeyByLine(entries, 1)).toBe(entries[1].key);
    expect(pickActiveKeyByLine(entries, 5)).toBe(entries[2].key);
    expect(pickActiveKeyByLine(entries, 7)).toBe(entries[2].key);
    expect(pickActiveKeyByLine(entries, 9)).toBe(entries[2].key);
    expect(pickActiveKeyByLine(entries, 20)).toBe(entries[2].key);

    // An internal `entries.sort()` would satisfy nothing above and mutate the caller.
    expect(entries.map((e) => e.lineNumber)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// §2 — retainVisibleActiveKey (WI-1b)
// ---------------------------------------------------------------------------

/** The production fixture §2 names: a 100-line document with headings at 1, 40, 90. */
const TAIL_LINES: readonly number[] = [1, 40, 90];

/**
 * The **measured field reproduction** (2026-09-20): 111 lines, headings at these nine
 * lines. Every R-12 … R-16 case asserts `entriesAtLines(FIELD_LINES)` really produced
 * them, so a silent fixture drift cannot turn a regression case green.
 */
const FIELD_LINES: readonly number[] = [1, 8, 22, 34, 46, 60, 74, 86, 99];
const FIELD_DOC_LINES = 111;

/** Rule H2 plus a line-number precondition: the fixture is what the case claims. */
function expectFieldFixture(entries: readonly TOCEntry[]): void {
  expectDistinctKeys(entries);
  expect(entries.map((e) => e.lineNumber)).toEqual([...FIELD_LINES]);
}

/**
 * A `readonly TOCEntry[]` that counts every property read made through it.
 *
 * Used by R-17's ordering supplement, which is the only assertion in this file able to
 * tell "the new gate runs **before** `entries.find`" from "it runs after": both orders
 * return the same key, and only the array scan distinguishes them.
 *
 * **Hazard, recorded because it has already been got wrong once**: `expectDistinctKeys`
 * (`.map`) and the `pickActiveKeyByLine` call that computes `picked` both traverse the
 * same array. If the counter were read without a reset it would be non-zero before the
 * call under test and the case would red for the wrong reason. Callers MUST `reset()`
 * immediately before the `retainVisibleActiveKey` call and `count()` immediately after,
 * with nothing in between.
 */
function countingEntries(entries: readonly TOCEntry[]): {
  readonly proxy: readonly TOCEntry[];
  readonly reset: () => void;
  readonly count: () => number;
} {
  let accesses = 0;
  const proxy = new Proxy(entries as TOCEntry[], {
    get(target, prop, receiver) {
      accesses += 1;
      return Reflect.get(target, prop, receiver) as unknown;
    },
  }) as readonly TOCEntry[];
  return {
    proxy,
    reset: () => {
      accesses = 0;
    },
    count: () => accesses,
  };
}

/** A key deliberately absent from any `entries` array — the document-swap simulation. */
function staleKeyNotIn(entries: readonly TOCEntry[]): HeadingKey {
  const stale = asHeadingKey("key-from-a-closed-document");
  expect(entries.some((e) => e.key === stale)).toBe(false);
  return stale;
}

interface RetainRow {
  readonly index: number;
  readonly picked: HeadingKey | null;
  readonly currentKey: HeadingKey | null;
  readonly topLine: number;
  readonly bottomLine: number;
}

/**
 * R-7's table: `picked` × `currentKey` ∈ {e0, e1, e2, null, stale} × three ranges =
 * 75 combinations, pruned to 36 by the in-tree LCG (§0.3 — no `fast-check`). The prune
 * is a seeded Fisher–Yates, so the 36 rows are fixed; every failure message below
 * prints the row index and the seed, so a red is reproducible.
 */
function buildRetainTable(
  entries: readonly TOCEntry[],
  staleKey: HeadingKey,
): RetainRow[] {
  const candidates: ReadonlyArray<HeadingKey | null> = [
    entries[0].key,
    entries[1].key,
    entries[2].key,
    null,
    staleKey,
  ];
  const ranges: ReadonlyArray<readonly [number, number]> = [
    [1, 100],
    [40, 78],
    [50, 60],
  ];

  const all: Array<Omit<RetainRow, "index">> = [];
  for (const picked of candidates) {
    for (const currentKey of candidates) {
      for (const [topLine, bottomLine] of ranges) {
        all.push({ picked, currentKey, topLine, bottomLine });
      }
    }
  }
  expect(all.length).toBe(75);

  const next = createLcg(DEFAULT_SEED);
  for (let i = all.length - 1; i > 0; i--) {
    const j = next() % (i + 1);
    const swap = all[i];
    all[i] = all[j];
    all[j] = swap;
  }

  return all.slice(0, 36).map((row, index) => ({ index, ...row }));
}

interface RetainRowWithLimit extends RetainRow {
  readonly atScrollLimit: boolean;
}

/**
 * SPY-WI-3: the recorded 36 rows **crossed** with `[true, false]` = 72.
 *
 * Deliberately not a reshuffle of a 150-combination cross (matrix §4). Re-running the
 * Fisher–Yates over a bigger domain would move which 36 rows survive, which would in
 * turn move `firstResults` and put the recorded non-vacuity thresholds
 * (`size >= 3`, `> 20` non-null) at risk — and the first person to hit that red would
 * *relax* a non-vacuity guard, which is itself a specification move. Crossing instead
 * makes the `true` half reproduce the recorded results exactly, so "expectations
 * unchanged" is literally checkable, and the LCG draw sequence and the printed seed
 * are preserved byte-for-byte.
 *
 * Rows `0 … 35` are the `true` half, `36 … 71` the `false` half; `row.index` stays the
 * base index so a failure message points at the same row in both halves.
 */
function buildRetainTableWithLimit(
  entries: readonly TOCEntry[],
  staleKey: HeadingKey,
): RetainRowWithLimit[] {
  const base = buildRetainTable(entries, staleKey);
  return [
    ...base.map((row) => ({ ...row, atScrollLimit: true })),
    ...base.map((row) => ({ ...row, atScrollLimit: false })),
  ];
}

function rowLabel(row: RetainRow, entries: readonly TOCEntry[]): string {
  return (
    `row ${row.index} (seed ${DEFAULT_SEED}): picked=#${indexOfResult(entries, row.picked)}` +
    ` current=#${indexOfResult(entries, row.currentKey)}` +
    ` range=[${row.topLine}, ${row.bottomLine}]`
  );
}

function limitRowLabel(row: RetainRowWithLimit, entries: readonly TOCEntry[]): string {
  return `${rowLabel(row, entries)} atScrollLimit=${row.atScrollLimit}`;
}

// ---------------------------------------------------------------------------
// The composition sweep shared by R-10a and R-10b
// ---------------------------------------------------------------------------
//
// Lifted out of the recorded R-10 body **unchanged except for two additions**: the
// `atScrollLimit` parameter, and `picked` exposed on the step record (it was computed
// locally before). R-10b's two-branch clause cannot be written without `picked`.

const COMPOSITION_DOC_LINES = 40;
const compositionBottomFor = (topLine: number): number =>
  Math.min(topLine + 25, COMPOSITION_DOC_LINES);

interface CompositionStep {
  readonly topLine: number;
  readonly previousIndex: number;
  readonly index: number;
  /** What the raw picker chose for this step. Needed by R-10b's inverted clause. */
  readonly picked: HeadingKey | null;
  /** Behavioural: the pipeline genuinely held the previous key against a live pick. */
  readonly retained: boolean;
  /** Geometric: the previously-current entry is still inside [top, bottom]. */
  readonly previousStillVisible: boolean;
}

function compositionSweep(
  entries: readonly TOCEntry[],
  topLines: readonly number[],
  start: HeadingKey | null,
  atScrollLimit: boolean,
): CompositionStep[] {
  let current = start;
  return topLines.map((topLine) => {
    const bottomLine = compositionBottomFor(topLine);
    const previousCurrent = current;
    const previousEntry =
      previousCurrent === null
        ? undefined
        : entries.find((e) => e.key === previousCurrent);
    const picked = pickActiveKeyByLine(entries, topLine);
    const retained = retainVisibleActiveKey(
      picked,
      previousCurrent,
      entries,
      topLine,
      bottomLine,
      atScrollLimit,
    );
    current = retained ?? previousCurrent; // the retain-on-null step, driven here.
    return {
      topLine,
      previousIndex: indexOfResult(entries, previousCurrent),
      index: indexOfResult(entries, current),
      picked,
      retained:
        retained === previousCurrent && picked !== previousCurrent && picked !== null,
      previousStillVisible:
        previousEntry !== undefined &&
        previousEntry.lineNumber >= topLine &&
        previousEntry.lineNumber <= bottomLine,
    };
  });
}

const ASCENDING_TOPS: readonly number[] = Array.from(
  { length: COMPOSITION_DOC_LINES + 1 },
  (_, i) => i,
);

/**
 * The ascending phase, asserted identically for both booleans.
 *
 * Verified by tracing, not assumed: retention can never fire while scrolling down —
 * the previously-current heading always sits at or above `topLine`, and the only
 * equality case exits through the `picked === currentKey` short-circuit. So both
 * recorded assertions hold for either value of the boolean, and R-10a and R-10b can
 * share this phase rather than each asserting half of it.
 */
function expectAscendingPhase(ascending: readonly CompositionStep[]): void {
  for (const step of ascending) {
    expect(step.index, `ascending topLine=${step.topLine}`).toBeGreaterThanOrEqual(
      step.previousIndex,
    );
  }

  // Wrong-reason guard (a): the sweep really visits every heading (plus the
  // pre-first-heading `null` state) — 6 headings + null = 7 distinct indices.
  const ascendingIndices = ascending.map((s) => s.index);
  expect(
    new Set(ascendingIndices).size,
    `distinct: ${JSON.stringify([...new Set(ascendingIndices)])}`,
  ).toBe(7);
}

describe("retainVisibleActiveKey", () => {
  it("R-1: TAIL CLAMP — the entry the user just clicked is not snatched away", () => {
    const entries = entriesAtLines(TAIL_LINES);
    // Clause 1 — H2.
    expectDistinctKeys(entries);

    const topLine = 78; // the EOF clamp: line 90 cannot reach the anchor.
    const bottomLine = 100;
    const currentKey = entries[2].key; // the line-90 heading the user clicked.
    const picked = pickActiveKeyByLine(entries, topLine);

    // Clause 2 — the disagreement is real, so the case cannot pass because the raw
    // picker already chose the tail heading.
    expect(picked).toBe(entries[1].key);
    expect(picked).not.toBe(currentKey);

    // Clause 3 — the retention precondition is genuinely exercised, so the case
    // cannot pass through the `picked === currentKey` short-circuit.
    expect(entries[2].lineNumber).toBeGreaterThan(topLine);
    expect(entries[2].lineNumber).toBeLessThanOrEqual(bottomLine);

    // Clause 4 — identity against the tail entry's own key. Kills `return picked`.
    // SPY-WI-3: run with `atScrollLimit === true`. This case **is** the tail clamp —
    // the user clicked line 90 and `scrollIntoView` parked the scroller at its limit —
    // so `true` is the condition the case always meant and could not previously state.
    expect(
      retainVisibleActiveKey(picked, currentKey, entries, topLine, bottomLine, true),
    ).toBe(entries[2].key);

    // Clause 5 — NEGATIVE CONTROL: with the tail heading below the scroller's bottom
    // edge the retention must not fire. Kills a hardcoded `return currentKey`.
    expect(entries[2].lineNumber).toBeGreaterThan(79);
    expect(retainVisibleActiveKey(picked, currentKey, entries, topLine, 79, true)).toBe(
      picked,
    );
    expect(retainVisibleActiveKey(picked, currentKey, entries, topLine, 79, true)).toBe(
      entries[1].key,
    );
  });

  it("R-2: current entry scrolled off the top returns picked", () => {
    const topLine = 40;
    const bottomLine = 100;

    for (const currentLine of [1, 20, 39]) {
      for (const atScrollLimit of [true, false]) {
        const entries = entriesAtLines([currentLine, 40, 90]);
        expectDistinctKeys(entries);
        const currentKey = entries[0].key;
        const picked = entries[1].key;
        const label = `currentLine=${currentLine} atScrollLimit=${atScrollLimit}`;

        // Wrong-reason guard: the band really is above the anchor.
        expect(entries[0].lineNumber, label).toBeLessThan(topLine);

        const result = retainVisibleActiveKey(
          picked,
          currentKey,
          entries,
          topLine,
          bottomLine,
          atScrollLimit,
        );
        expect(result, label).toBe(picked);
        expect(result, label).not.toBe(currentKey);
      }
    }
    // SPY-WI-3 (matrix §2 [R3]): the `true` rows above are this file's kill for a
    // **widened** clamp. An implementation that keeps the gate but drops the range
    // test would retain here — the current entry is above `topLine`, i.e. scrolled
    // off — where every row expects `picked`. Under `false` the new gate answers
    // first, so these rows do NOT exit through a guard that precedes it; the plan's
    // claim that they do is wrong, and R-17 records what actually happens.
  });

  it("R-3: currentKey === null returns picked unchanged", () => {
    const entries = entriesAtLines(TAIL_LINES);
    expectDistinctKeys(entries);

    const pickedValues: ReadonlyArray<HeadingKey | null> = [
      entries[0].key,
      entries[2].key,
      null,
    ];

    for (const picked of pickedValues) {
      for (const atScrollLimit of [true, false]) {
        expect(
          retainVisibleActiveKey(picked, null, entries, 40, 100, atScrollLimit),
          `picked=#${indexOfResult(entries, picked)} atScrollLimit=${atScrollLimit}`,
        ).toBe(picked);
      }
    }
  });

  it("R-4: stale currentKey returns picked, never the stale key", () => {
    const entries = entriesAtLines(TAIL_LINES);
    expectDistinctKeys(entries);
    // Wrong-reason guard first: the key really is absent from `entries`.
    const currentKey = staleKeyNotIn(entries);
    const picked = entries[1].key;

    for (const atScrollLimit of [true, false]) {
      const result = retainVisibleActiveKey(
        picked,
        currentKey,
        entries,
        40,
        100,
        atScrollLimit,
      );

      expect(result, `atScrollLimit=${atScrollLimit}`).toBe(picked);
      // Conservation, stated locally.
      expect(
        entries.some((e) => e.key === result),
        `atScrollLimit=${atScrollLimit}`,
      ).toBe(true);
    }
  });

  it("R-5: picked === currentKey is returned unchanged, in range and out", () => {
    const entries = entriesAtLines(TAIL_LINES);
    expectDistinctKeys(entries);
    const key = entries[1].key;

    for (const atScrollLimit of [true, false]) {
      // In range.
      expect(
        retainVisibleActiveKey(key, key, entries, 40, 100, atScrollLimit),
        `atScrollLimit=${atScrollLimit}`,
      ).toBe(entries[1].key);
      // Out of range — the row with content: the equality short-circuit runs before the
      // range test, so an entry that is both current and scrolled past is not blanked.
      expect(entries[1].lineNumber).toBeLessThan(50);
      expect(
        retainVisibleActiveKey(key, key, entries, 50, 60, atScrollLimit),
        `atScrollLimit=${atScrollLimit}`,
      ).toBe(entries[1].key);
    }
  });

  it("R-6: the range endpoints are inclusive on both sides", () => {
    const topLine = 40;
    const bottomLine = 78;
    const table: ReadonlyArray<readonly [number, "picked" | "current"]> = [
      [39, "picked"],
      [40, "current"],
      [78, "current"],
      [79, "picked"],
    ];

    for (const [currentLine, expected] of table) {
      const entries = entriesAtLines([1, currentLine]);
      expectDistinctKeys(entries);
      const picked = entries[0].key;
      const currentKey = entries[1].key;
      expect(picked, `currentLine=${currentLine}`).not.toBe(currentKey);
      expect(entries[1].lineNumber, `currentLine=${currentLine}`).toBe(currentLine);

      // Recorded rows, run at the limit: the closed interval is unchanged there.
      const result = retainVisibleActiveKey(
        picked,
        currentKey,
        entries,
        topLine,
        bottomLine,
        true,
      );
      expect(result, `currentLine=${currentLine} expects ${expected}`).toBe(
        expected === "picked" ? picked : currentKey,
      );

      // SPY-WI-3 — the `false` twin: the interval question is never asked, so every
      // row answers `picked`, including the two the recorded table retains on.
      const offLimit = retainVisibleActiveKey(
        picked,
        currentKey,
        entries,
        topLine,
        bottomLine,
        false,
      );
      expect(offLimit, `currentLine=${currentLine} atScrollLimit=false`).toBe(picked);
    }
  });

  it("R-7: LAW idempotence — a second application changes nothing", () => {
    const entries = entriesAtLines(TAIL_LINES);
    expectDistinctKeys(entries);
    const staleKey = staleKeyNotIn(entries);
    // SPY-WI-3 shape churn: the recorded 36 rows crossed with the boolean = 72.
    const table = buildRetainTableWithLimit(entries, staleKey);
    expect(table.length).toBe(72);

    const firstResults = table.map((row) =>
      retainVisibleActiveKey(
        row.picked,
        row.currentKey,
        entries,
        row.topLine,
        row.bottomLine,
        row.atScrollLimit,
      ),
    );

    table.forEach((row, i) => {
      const second = retainVisibleActiveKey(
        firstResults[i],
        row.currentKey,
        entries,
        row.topLine,
        row.bottomLine,
        row.atScrollLimit,
      );
      expect(second, limitRowLabel(row, entries)).toBe(firstResults[i]);
    });

    // Wrong-reason guard: idempotence is satisfied trivially by a constant function
    // and by the identity function. Three distinct outputs rule both out (with R-1's
    // directional clauses ruling out the identity).
    expect(
      new Set(firstResults).size,
      `seed ${DEFAULT_SEED}; results: ${JSON.stringify(
        firstResults.map((r) => indexOfResult(entries, r)),
      )}`,
    ).toBeGreaterThanOrEqual(3);
  });

  it("R-8: LAW non-invention — every result is picked, currentKey or null", () => {
    const entries = entriesAtLines(TAIL_LINES);
    expectDistinctKeys(entries);
    const staleKey = staleKeyNotIn(entries);
    const table = buildRetainTableWithLimit(entries, staleKey);

    const firstResults = table.map((row) =>
      retainVisibleActiveKey(
        row.picked,
        row.currentKey,
        entries,
        row.topLine,
        row.bottomLine,
        row.atScrollLimit,
      ),
    );

    table.forEach((row, i) => {
      const result = firstResults[i];
      // Conjunct 1 — reference containment in the three admissible values.
      expect([row.picked, row.currentKey, null], limitRowLabel(row, entries)).toContain(
        result,
      );

      // Conjunct 2 — conservation. DEVIATION from the matrix's tightened wording,
      // stated rather than hidden: the matrix asserts "if non-null it must be a key
      // present in `entries`", but the same matrix puts `staleKey` in the *picked*
      // dimension of this very table, and the contract says "otherwise return
      // `picked`". A stale `picked` is therefore returned verbatim and is by
      // construction absent from `entries`, so the tightened clause is false on those
      // rows for a correct implementation. (It is also unreachable in production:
      // `pickActiveKeyByLine` conserves, so `picked` is always null or live — P-7.)
      // The carve-out below is *stricter* than a disjunction: where the result is not
      // in `entries` it must be exactly the row's own stale `picked`.
      const resultIsLive = result !== null && entries.some((e) => e.key === result);
      if (!resultIsLive && result !== null) {
        expect(result, limitRowLabel(row, entries)).toBe(row.picked);
        expect(
          entries.some((e) => e.key === row.picked),
          limitRowLabel(row, entries),
        ).toBe(false);
      } else {
        expect(result === null || resultIsLive, limitRowLabel(row, entries)).toBe(true);
      }
    });

    // Wrong-reason guard: the law is vacuous under `return null`. SPY-WI-4 — the
    // recorded threshold is RE-DERIVED PER HALF, not relaxed. SPY-WI-3 doubled this
    // table from 36 rows to 72 (`existing36 × [true, false]`) but left the literal `20`
    // spanning both halves, which made the guard half as demanding as the one that was
    // recorded: 21 non-null results out of 72 would have satisfied it even if an entire
    // boolean branch returned `null` throughout. Same form as R-19's, deliberately.
    const half = table.length / 2;
    expect(
      firstResults.slice(0, half).filter((r) => r !== null).length,
      `seed ${DEFAULT_SEED} (atScrollLimit=true)`,
    ).toBeGreaterThan(20);
    expect(
      firstResults.slice(half).filter((r) => r !== null).length,
      `seed ${DEFAULT_SEED} (atScrollLimit=false)`,
    ).toBeGreaterThan(20);
  });

  it("R-9: DECOMPOSITION — retain-on-null is downstream, not inside this function", () => {
    // (a) picked === null and the current entry is inside the range → the current key.
    const entriesA = entriesAtLines(TAIL_LINES);
    expectDistinctKeys(entriesA);
    expect(entriesA[1].lineNumber).toBeGreaterThanOrEqual(40);
    expect(entriesA[1].lineNumber).toBeLessThanOrEqual(78);
    // SPY-WI-3: run at the limit. The `false` counterpart of this row is new
    // specification and lives in R-20(b), where its safety argument is written down.
    expect(retainVisibleActiveKey(null, entriesA[1].key, entriesA, 40, 78, true)).toBe(
      entriesA[1].key,
    );

    // (b) picked === null and the current entry is outside it → null, NOT currentKey.
    // Folding the hook's retain-on-null step into this function returns `currentKey`
    // here and fails. Unchanged for **both** booleans.
    const entriesB = entriesAtLines(TAIL_LINES);
    expectDistinctKeys(entriesB);
    expect(entriesB[1].lineNumber).toBe(40);
    for (const atScrollLimit of [true, false]) {
      expect(
        retainVisibleActiveKey(null, entriesB[1].key, entriesB, 50, 60, atScrollLimit),
        `atScrollLimit=${atScrollLimit}`,
      ).toBeNull();
    }
  });

  it("R-10a: LAW composition AT THE LIMIT — a monotone anchor sweep never moves backwards except on a genuine scroll-past", () => {
    const entries = entriesAtLines(SWEEP_LINES);
    expectDistinctKeys(entries);

    const ascending = compositionSweep(entries, ASCENDING_TOPS, null, true);
    expectAscendingPhase(ascending);

    const finalKey = entries[5].key;
    expect(ascending[ascending.length - 1].index).toBe(5);

    const descending = compositionSweep(
      entries,
      [...ASCENDING_TOPS].reverse(),
      finalKey,
      true,
    );

    let positiveAssertions = 0;
    for (const step of descending) {
      if (step.previousStillVisible) {
        // MANDATORY POSITIVE ASSERTION: where the previously-current entry is still
        // inside [topLine, bottomLine] the index must be UNCHANGED — not merely
        // permitted to be. Dropping retention fails right here.
        expect(step.index, `descending topLine=${step.topLine} (retention step)`).toBe(
          step.previousIndex,
        );
        positiveAssertions += 1;
      } else {
        expect(step.index, `descending topLine=${step.topLine}`).toBeLessThanOrEqual(
          step.previousIndex,
        );
      }
    }
    expect(positiveAssertions).toBeGreaterThan(0);

    // Wrong-reason guard (b): retention is counted BEHAVIOURALLY — from what the
    // pipeline actually did, not from what the entries array would have permitted.
    const retentionSteps = [...ascending, ...descending].filter((s) => s.retained).length;
    expect(retentionSteps).toBeGreaterThan(0);
    expect(descending.filter((s) => s.retained).length).toBeGreaterThan(0);
  });

  it("R-10b: LAW composition OFF THE LIMIT — the descending sweep follows the picker instead of freezing", () => {
    // The recorded R-10 (now R-10a) demanded the index be UNCHANGED on every step where
    // the previously-current entry is still visible, with no scroll-limit condition
    // anywhere. That assertion **is** the directional freeze, written down as a law.
    // This case runs the identical sweep with `atScrollLimit === false` and inverts it.
    const entries = entriesAtLines(SWEEP_LINES);
    expectDistinctKeys(entries);

    const ascending = compositionSweep(entries, ASCENDING_TOPS, null, false);
    expectAscendingPhase(ascending);

    const finalKey = entries[5].key;
    expect(ascending[ascending.length - 1].index).toBe(5);

    const descending = compositionSweep(
      entries,
      [...ASCENDING_TOPS].reverse(),
      finalKey,
      false,
    );

    let nullPickVisibleSteps = 0;
    let visibleSteps = 0;
    for (const step of descending) {
      if (!step.previousStillVisible) {
        expect(step.index, `descending topLine=${step.topLine}`).toBeLessThanOrEqual(
          step.previousIndex,
        );
        continue;
      }
      visibleSteps += 1;
      if (step.picked === null) {
        // The sweep's own retain-on-null step, not a retention decision by the unit
        // under test: the gate returned `picked === null` and `?? previousCurrent` held
        // the index. This is the composition-level twin of R-20(b), and it is the
        // reason the clause below is guarded rather than universal.
        //
        // Reached exactly once, at `topLine === 0`: `ASCENDING_TOPS` starts at 0,
        // `compositionBottomFor(0)` is 25, and `SWEEP_LINES` starts at line 1 — so no
        // entry is `<= 0` while the line-1 heading is still inside [0, 25]. A
        // universal "index === indexOfResult(picked)" clause asserts `0 === -1` here
        // and is red on a CORRECT implementation.
        expect(
          step.index,
          `descending topLine=${step.topLine} (null pick)`,
        ).toBe(step.previousIndex);
        nullPickVisibleSteps += 1;
        continue;
      }
      expect(
        step.index,
        `descending topLine=${step.topLine} (follows the picker)`,
      ).toBe(indexOfResult(entries, step.picked));
    }

    // Load-bearing: pins the carve-out to that single step so it cannot silently grow
    // to swallow the sweep.
    expect(nullPickVisibleSteps, `seed ${DEFAULT_SEED}`).toBe(1);
    // The recorded `positiveAssertions > 0` guard, carried across: the visible branch
    // is genuinely reached, so the clause above is not vacuous.
    expect(visibleSteps).toBeGreaterThan(0);

    // Wrong-reason guard (b), INVERTED rather than re-derived. Under `false` the
    // behavioural conjunction `retained === previousCurrent && picked !== previousCurrent`
    // is identically false by construction, so the recorded `> 0` cannot hold; asserting
    // `0` is the honest statement, and the positive burden moves to the guard below.
    expect([...ascending, ...descending].filter((s) => s.retained).length).toBe(0);

    // The new positive guard: steps where the previous entry is STILL VISIBLE and the
    // index nevertheless dropped — i.e. the freeze did not happen. Traced over the
    // fully determined 41-point sweep: exactly 5 (topLine 30, 29, 7, 6, 1). `> 3` is
    // satisfiable and tight; the nearest failing threshold is `> 5`.
    const followedThePicker = descending.filter(
      (s) => s.previousStillVisible && s.index < s.previousIndex,
    );
    expect(
      followedThePicker.length,
      `steps: ${JSON.stringify(followedThePicker.map((s) => s.topLine))}`,
    ).toBeGreaterThan(3);
  });

  it("R-11: reads neither text nor level (metamorphic)", () => {
    const entriesA = entriesAtLines(TAIL_LINES);
    expectDistinctKeys(entriesA);
    // Run B: identical keys and lineNumbers (so the same picked/currentKey references
    // are valid in both runs), every text flattened to "same", every level to 2.
    const entriesB: TOCEntry[] = entriesA.map((e) => ({
      ...e,
      anchorSlug: asAnchorSlug("same"),
      level: 2 as Level,
      text: "same",
    }));
    expect(new Set(entriesA.map((e) => e.text)).size).toBe(entriesA.length);
    expect(new Set(entriesB.map((e) => e.text)).size).toBe(1);
    expect(new Set(entriesB.map((e) => e.level)).size).toBe(1);
    expect(entriesB.map((e) => e.key)).toEqual(entriesA.map((e) => e.key));

    const staleKey = staleKeyNotIn(entriesA);
    const table = buildRetainTableWithLimit(entriesA, staleKey);

    const resultsA = table.map((row) =>
      retainVisibleActiveKey(
        row.picked,
        row.currentKey,
        entriesA,
        row.topLine,
        row.bottomLine,
        row.atScrollLimit,
      ),
    );
    const resultsB = table.map((row) =>
      retainVisibleActiveKey(
        row.picked,
        row.currentKey,
        entriesB,
        row.topLine,
        row.bottomLine,
        row.atScrollLimit,
      ),
    );

    expect(resultsB, `seed ${DEFAULT_SEED}`).toEqual(resultsA);

    // Non-vacuity guards reused from R-7/R-8.
    expect(resultsA.filter((r) => r !== null).length).toBeGreaterThan(20);
    expect(new Set(resultsA).size).toBeGreaterThanOrEqual(3);
  });

  // -------------------------------------------------------------------------
  // SPY-WI-3 — R-12 … R-20: the `atScrollLimit` gate
  // -------------------------------------------------------------------------

  it("R-12: REGRESSION — current entry visible but the scroller is NOT at its limit returns picked", () => {
    const entries = entriesAtLines(FIELD_LINES);
    expectFieldFixture(entries); // clause 1 — H2 plus the fixture's own line numbers.

    interface Row {
      readonly label: string;
      readonly topLine: number;
      readonly bottomLine: number;
      readonly currentIndex: number;
      readonly expectedIndex: number;
      /** Row 1 is the direction that already worked; its current entry is off-screen. */
      readonly currentIsVisible: boolean;
    }

    const rows: readonly Row[] = [
      {
        label: "row 1 (downward — the direction that already worked)",
        topLine: 43,
        bottomLine: 68,
        currentIndex: 2, // heading@22
        expectedIndex: 3, // heading@34
        currentIsVisible: false,
      },
      {
        label: "row 2 (upward, one gap)",
        topLine: 32,
        bottomLine: 57,
        currentIndex: 3, // heading@34
        expectedIndex: 2, // heading@22
        currentIsVisible: true,
      },
      {
        label: "row 3 (upward, two gaps)",
        topLine: 19,
        bottomLine: 44,
        currentIndex: 3, // heading@34
        expectedIndex: 1, // heading@8
        currentIsVisible: true,
      },
    ];

    for (const row of rows) {
      const currentKey = entries[row.currentIndex].key;
      // `picked` is computed by the REAL picker, never transcribed.
      const picked = pickActiveKeyByLine(entries, row.topLine);

      // Clause 2 — the disagreement is real, so the row cannot exit through the
      // `picked === currentKey` short-circuit.
      expect(picked, row.label).not.toBe(currentKey);
      expect(picked, row.label).toBe(entries[row.expectedIndex].key);

      // Clause 3 — the retention precondition is genuinely exercised (or, for row 1,
      // genuinely is not), so the red against the old implementation is semantic.
      const currentLine = entries[row.currentIndex].lineNumber;
      const visible = currentLine >= row.topLine && currentLine <= row.bottomLine;
      expect(visible, `${row.label}: currentLine=${currentLine}`).toBe(
        row.currentIsVisible,
      );

      // Clause 4 — the gate.
      const result = retainVisibleActiveKey(
        picked,
        currentKey,
        entries,
        row.topLine,
        row.bottomLine,
        false,
      );
      expect(result, row.label).toBe(picked);
      expect(result, row.label).not.toBe(currentKey);
    }
  });

  it("R-13: TAIL CLAMP PRESERVED — the same geometry with atScrollLimit === true retains", () => {
    const entries = entriesAtLines(FIELD_LINES);
    expectFieldFixture(entries);

    // R-12 row 2 verbatim.
    const currentKey = entries[3].key; // heading@34
    const picked = pickActiveKeyByLine(entries, 32);
    expect(picked).toBe(entries[2].key); // heading@22
    expect(picked).not.toBe(currentKey);

    // One shared argument tuple, spread with each boolean: "the boolean is the only
    // difference" is executable here, not a comment.
    const shared: readonly [
      HeadingKey | null,
      HeadingKey | null,
      readonly TOCEntry[],
      number,
      number,
    ] = [picked, currentKey, entries, 32, 57];

    expect(retainVisibleActiveKey(...shared, true)).toBe(entries[3].key);
    expect(retainVisibleActiveKey(...shared, false)).toBe(picked);
  });

  it("R-14: short non-scrollable document — a clicked heading survives, and no heading is invented", () => {
    // `SHORT_DOC_SCROLL` (laid out, content fits) produces `atScrollLimit === true`.
    const entries = entriesAtLines([1, 5, 9]);
    expectDistinctKeys(entries);
    const topLine = 1;
    const bottomLine = 12;

    // (a) three GENUINELY IDENTICAL calls — same arguments, nothing fed back, no state
    // between them. This is the file's kill for a stateful one-shot latch ("retain
    // only on the first frame after a click"): identical inputs must give identical
    // outputs, so any hidden state shows up on call 2.
    const currentKey = entries[1].key; // the line-5 heading the user clicked.
    const picked = pickActiveKeyByLine(entries, topLine);
    expect(picked).toBe(entries[0].key);
    expect(picked).not.toBe(currentKey);
    expect(entries[1].lineNumber).toBeGreaterThanOrEqual(topLine);
    expect(entries[1].lineNumber).toBeLessThanOrEqual(bottomLine);

    for (let i = 0; i < 3; i++) {
      expect(
        retainVisibleActiveKey(picked, currentKey, entries, topLine, bottomLine, true),
        `call ${i}`,
      ).toBe(entries[1].key);
    }

    // (b) nothing clicked yet: the answer is the picker's, at the anchor.
    const fresh = retainVisibleActiveKey(
      picked,
      null,
      entries,
      topLine,
      bottomLine,
      true,
    );
    expect(fresh).toBe(entries[0].key);
    // The load-bearing negative: "at the limit, select the last heading" is a
    // plausible-looking implementation that the bottom-of-document asymmetry invites.
    expect(fresh).not.toBe(entries[2].key);
  });

  it("R-15: leaving the bottom — only the boolean changes, and the picker takes over", () => {
    const entries = entriesAtLines(FIELD_LINES);
    expectFieldFixture(entries);

    const topLine = 78;
    const bottomLine = FIELD_DOC_LINES;
    const currentKey = entries[8].key; // heading@99, the clicked tail heading.
    const picked = pickActiveKeyByLine(entries, topLine);
    expect(picked).toBe(entries[6].key); // heading@74

    // (i) the bottom line is unchanged across the transition AND still equal to the
    // last line — the exact condition the rejected `bottomLine === doc.lines`
    // predicate would have keyed on, which is why that predicate cannot see this
    // transition at all.
    expect(bottomLine).toBe(FIELD_DOC_LINES);
    expect(FIELD_DOC_LINES).toBe(111);

    // (ii) one shared tuple, only the boolean substituted.
    const shared: readonly [
      HeadingKey | null,
      HeadingKey | null,
      readonly TOCEntry[],
      number,
      number,
    ] = [picked, currentKey, entries, topLine, bottomLine];

    const sample1 = retainVisibleActiveKey(...shared, true);
    const sample2 = retainVisibleActiveKey(...shared, false);

    expect(sample1).toBe(entries[8].key);
    expect(sample2).toBe(entries[6].key);
    // (iii)
    expect(sample1).not.toBe(sample2);
  });

  it("R-16: the per-frame loop — both clamped click targets survive repeated sampling", () => {
    const entries = entriesAtLines(FIELD_LINES);
    expectFieldFixture(entries);

    const topLine = 78;
    const bottomLine = FIELD_DOC_LINES;
    // `pick` is computed ONCE and held FIXED across all three samples — that is what
    // the hook does when the range does not change. Feeding the previous *result* back
    // in as `picked` would make it equal `currentKey` on sample 2 and short-circuit
    // before the gate, leaving samples 2 and 3 asserting nothing.
    const pick = pickActiveKeyByLine(entries, topLine);

    // (ii) both targets genuinely disagree with the picker.
    expect(pick).toBe(entries[6].key); // heading@74
    expect(pick).not.toBe(entries[8].key);
    expect(pick).not.toBe(entries[7].key);

    const results: Array<HeadingKey | null> = [];
    for (const targetIndex of [8, 7]) {
      const target = entries[targetIndex].key;
      expect(entries[targetIndex].lineNumber).toBeGreaterThanOrEqual(topLine);
      expect(entries[targetIndex].lineNumber).toBeLessThanOrEqual(bottomLine);

      let cur: HeadingKey | null = target;
      for (let i = 0; i < 3; i++) {
        // (i) proves the `picked === currentKey` short-circuit was NOT taken on any
        // sample. Without it the loop can go vacuous again, silently.
        expect(pick, `target #${targetIndex} sample ${i}`).not.toBe(cur);
        cur = retainVisibleActiveKey(pick, cur, entries, topLine, bottomLine, true);
        expect(cur, `target #${targetIndex} sample ${i}`).toBe(target);
      }
      results.push(cur);
    }

    // (iii) the two targets must give DIFFERENT answers, so "stable" cannot be
    // satisfied by a function that pins one key forever.
    expect(new Set(results).size).toBe(2);
  });

  it("R-17: the whole guard table holds for both booleans, and the gate runs before entries.find", () => {
    const entries = entriesAtLines(TAIL_LINES);
    expectDistinctKeys(entries);
    const staleKey = staleKeyNotIn(entries);

    interface GuardRow {
      readonly guard: string;
      readonly picked: HeadingKey | null;
      readonly currentKey: HeadingKey | null;
      readonly topLine: number;
      readonly bottomLine: number;
      /**
       * Which guard actually fires when `atScrollLimit === false`. Corrected against
       * the real implementation: with the gate placed before `entries.find`, only the
       * first two rows exit through a guard that PRECEDES it. The plan's claim that
       * all four do is wrong, and this column is what records the truth.
       */
      readonly firesUnderFalse: "precedes the gate" | "the new gate";
    }

    const rows: readonly GuardRow[] = [
      {
        guard: "picked === currentKey",
        picked: entries[1].key,
        currentKey: entries[1].key,
        topLine: 50,
        bottomLine: 60,
        firesUnderFalse: "precedes the gate",
      },
      {
        guard: "currentKey === null",
        picked: entries[0].key,
        currentKey: null,
        topLine: 40,
        bottomLine: 100,
        firesUnderFalse: "precedes the gate",
      },
      {
        guard: "currentKey absent from entries",
        picked: entries[1].key,
        currentKey: staleKey,
        topLine: 40,
        bottomLine: 100,
        firesUnderFalse: "the new gate",
      },
      {
        guard: "current entry above topLine",
        picked: entries[1].key,
        currentKey: entries[0].key,
        topLine: 40,
        bottomLine: 100,
        firesUnderFalse: "the new gate",
      },
    ];

    // Preconditions for rows 1 and 4, so neither passes by accident.
    expect(entries[1].lineNumber).toBeLessThan(50); // row 1 really is out of range.
    expect(entries[0].lineNumber).toBeLessThan(40); // row 4 really is above topLine.

    for (const row of rows) {
      for (const atScrollLimit of [true, false]) {
        const label = `${row.guard} atScrollLimit=${atScrollLimit}`;
        expect(
          retainVisibleActiveKey(
            row.picked,
            row.currentKey,
            entries,
            row.topLine,
            row.bottomLine,
            atScrollLimit,
          ),
          label,
        ).toBe(row.picked);
      }
    }

    // ---------------------------------------------------------------------
    // Ordering supplement — the only assertion here that can tell
    // "gate before `find`" from "gate after `find`".
    // ---------------------------------------------------------------------
    // HAZARD: `expectDistinctKeys` and the `pickActiveKeyByLine` calls above both
    // traverse this array. The counter is therefore reset IMMEDIATELY before the call
    // under test and read IMMEDIATELY after, with nothing in between. Do not insert a
    // precondition into the two-line window below.
    for (const row of rows.filter((r) => r.firesUnderFalse === "the new gate")) {
      const counted = countingEntries(entries);

      counted.reset();
      const offLimit = retainVisibleActiveKey(
        row.picked,
        row.currentKey,
        counted.proxy,
        row.topLine,
        row.bottomLine,
        false,
      );
      const accessesOffLimit = counted.count();

      counted.reset();
      const atLimit = retainVisibleActiveKey(
        row.picked,
        row.currentKey,
        counted.proxy,
        row.topLine,
        row.bottomLine,
        true,
      );
      const accessesAtLimit = counted.count();

      expect(offLimit, `${row.guard} (off limit)`).toBe(row.picked);
      expect(atLimit, `${row.guard} (at limit)`).toBe(row.picked);
      // The claim: no array scan at all on the common per-frame path.
      expect(accessesOffLimit, `${row.guard}: accesses off the limit`).toBe(0);
      // Positive control — the counter is live, so the `0` above means something.
      expect(accessesAtLimit, `${row.guard}: accesses at the limit`).toBeGreaterThan(0);
    }
  });

  it("R-18: LAW idempotence for both booleans, and the rows that MUST differ between them", () => {
    const entries = entriesAtLines(TAIL_LINES);
    expectDistinctKeys(entries);
    const staleKey = staleKeyNotIn(entries);
    const table = buildRetainTable(entries, staleKey);
    expect(table.length).toBe(36);

    const call = (row: RetainRow, atScrollLimit: boolean): HeadingKey | null =>
      retainVisibleActiveKey(
        row.picked,
        row.currentKey,
        entries,
        row.topLine,
        row.bottomLine,
        atScrollLimit,
      );

    const trueResults = table.map((row) => call(row, true));
    const falseResults = table.map((row) => call(row, false));

    for (const atScrollLimit of [true, false]) {
      const first = atScrollLimit ? trueResults : falseResults;
      table.forEach((row, i) => {
        const second = retainVisibleActiveKey(
          first[i],
          row.currentKey,
          entries,
          row.topLine,
          row.bottomLine,
          atScrollLimit,
        );
        expect(
          second,
          `${rowLabel(row, entries)} atScrollLimit=${atScrollLimit}`,
        ).toBe(first[i]);
      });
    }

    // `true` half — the RECORDED thresholds, verbatim. They are satisfiable here
    // because the `true` half is the old table run against the old behaviour.
    expect(
      new Set(trueResults).size,
      `seed ${DEFAULT_SEED}; results: ${JSON.stringify(
        trueResults.map((r) => indexOfResult(entries, r)),
      )}`,
    ).toBeGreaterThanOrEqual(3);
    expect(
      trueResults.filter((r) => r !== null).length,
      `seed ${DEFAULT_SEED}`,
    ).toBeGreaterThan(20);

    // `false` half — idempotence is trivially true there (the second application is a
    // no-op by construction), so the threshold guards would be theatre. It carries the
    // STRONGER clause instead: the constant projection, over the whole domain.
    table.forEach((row, i) => {
      expect(
        falseResults[i],
        `${rowLabel(row, entries)} atScrollLimit=false`,
      ).toBe(row.picked);
    });

    // Cross-branch discrimination. Neither recorded threshold proves that ANY row
    // actually retains — `new Set(...).size >= 3` and `> 20 non-null` are both
    // satisfied by the `picked` dimension alone, so the whole law suite is green for
    // `return picked`, i.e. for the clamp DELETED rather than narrowed.
    //
    // Which rows must differ is fully determined by the retention rule, so derive it
    // from the rule rather than from a sample of the table. The in-file precedent is
    // `referenceLastAtOrAbove`. Seed-immune, and additionally red on a WIDENED clamp
    // (drop the range test and out-of-range rows land in `differing` but not in
    // `expected`, which no count form can see).
    const shouldDiffer = (r: RetainRow): boolean => {
      if (r.currentKey === null || r.picked === r.currentKey) return false;
      const cur = entries.find((e) => e.key === r.currentKey);
      return (
        cur !== undefined &&
        cur.lineNumber >= r.topLine &&
        cur.lineNumber <= r.bottomLine
      );
    };
    const expected = table.filter(shouldDiffer);
    const differing = table.filter((_, i) => trueResults[i] !== falseResults[i]);
    expect(differing, `seed ${DEFAULT_SEED}`).toEqual(expected);
    // `toEqual([])` against `[]` would be vacuously green on an empty table.
    expect(expected.length, `seed ${DEFAULT_SEED}`).toBeGreaterThan(0);
  });

  it("R-19: LAW non-invention holds for both booleans", () => {
    const entries = entriesAtLines(TAIL_LINES);
    expectDistinctKeys(entries);
    const staleKey = staleKeyNotIn(entries);
    const table = buildRetainTableWithLimit(entries, staleKey);
    expect(table.length).toBe(72);

    const results = table.map((row) =>
      retainVisibleActiveKey(
        row.picked,
        row.currentKey,
        entries,
        row.topLine,
        row.bottomLine,
        row.atScrollLimit,
      ),
    );

    table.forEach((row, i) => {
      const result = results[i];
      expect([row.picked, row.currentKey, null], limitRowLabel(row, entries)).toContain(
        result,
      );

      // The recorded stale-`picked` carve-out, preserved verbatim: `staleKey` is in
      // this table's *picked* dimension, the contract says "otherwise return `picked`",
      // so a stale `picked` comes back verbatim and is by construction absent from
      // `entries`. Where the result is not in `entries` it must be exactly the row's
      // own stale `picked` — stricter than a disjunction.
      const resultIsLive = result !== null && entries.some((e) => e.key === result);
      if (!resultIsLive && result !== null) {
        expect(result, limitRowLabel(row, entries)).toBe(row.picked);
        expect(
          entries.some((e) => e.key === row.picked),
          limitRowLabel(row, entries),
        ).toBe(false);
      } else {
        expect(result === null || resultIsLive, limitRowLabel(row, entries)).toBe(true);
      }
    });

    // The recorded threshold, unchanged, re-derived on each half rather than relaxed.
    const half = table.length / 2;
    expect(
      results.slice(0, half).filter((r) => r !== null).length,
      `seed ${DEFAULT_SEED} (atScrollLimit=true)`,
    ).toBeGreaterThan(20);
    expect(
      results.slice(half).filter((r) => r !== null).length,
      `seed ${DEFAULT_SEED} (atScrollLimit=false)`,
    ).toBeGreaterThan(20);
  });

  it("R-20: DECOMPOSITION — retain-on-null stays downstream under both booleans", () => {
    const entries = entriesAtLines(TAIL_LINES);
    expectDistinctKeys(entries);
    const currentKey = entries[1].key; // heading@40
    expect(entries[1].lineNumber).toBe(40);

    // (a) picked === null, current entry OUTSIDE the range → null for both booleans.
    // Folding the hook's retain-on-null step into this function answers `currentKey`
    // here and fails.
    for (const atScrollLimit of [true, false]) {
      expect(
        retainVisibleActiveKey(null, currentKey, entries, 50, 60, atScrollLimit),
        `(a) atScrollLimit=${atScrollLimit}`,
      ).toBeNull();
    }

    // (b) picked === null, current entry INSIDE the range.
    expect(retainVisibleActiveKey(null, currentKey, entries, 40, 78, true)).toBe(
      entries[1].key,
    );
    // NEW SPECIFICATION, and why it is safe: with retention disabled a `null` pick
    // passes straight through, and the hook's `next !== null` filter
    // (`src/hooks/useSourceScrollSpy.ts:151`) keeps the highlight where it is. So
    // scrolling above the first heading still does not blank the outline — the
    // decomposition does the work, not this function.
    expect(retainVisibleActiveKey(null, currentKey, entries, 40, 78, false)).toBeNull();
  });
});
