// @vitest-environment node
/**
 * D49 WI-1.2, slow tier (ADR-0050): the edit laws L-1 to L-10 over the
 * exhaustive 1688-case overflow domain, and over 200 seeded
 * `randomOverflowCases`. Both domains share
 * `tests/support/tableEditsOverflowLaws.ts`.
 *
 * The seeded half ran in the default lane until D93 / D119: computing its report
 * takes ~2 s under coverage on an idle machine and past the 5 s default
 * timeout under contention, and it adds no line to the unit lane's coverage of
 * `src/utils/` (measured with and without it: identical). Fixture-level edit
 * cases stay in the unit lane (`table-edits-overflow.test.ts`).
 *
 * Matrix: `.claude/tdd-guardian/tests-20261009-111653.md` "# WI-1.2" L-1 to
 * L-10 (L-10 as amended in adversary round 1). L-4, L-6 and L-7 are pins: they
 * hold on 8bb859e too. No mocks; fast-check is not a dependency, so the seeded
 * domain uses the repo's `mulberry32` (`D44_SEED`).
 */

import { describe, expect, it } from "vitest";

import { applyEdit } from "../src/utils/tableEdits";
import {
  D44_SEED,
  EXHAUSTIVE_DOMAIN_SIZE,
  exhaustiveOverflowDomain,
  randomOverflowCases,
  summary,
} from "./support/tableOverflowArb";
import { checkEditLaws, summarizeEditLaws, type EditLawKey } from "./support/tableEditsOverflowLaws";

// The exhaustive domain (1-2 header columns, rows up to h+2 cells) yields
// 1525 overflowing and 163 flush cases, fixed by the generator alone. The
// flush bound was first written as 500 from a misreading of the matrix's
// "over 500 in exhaustive", which can never hold on this domain.
const MIN_OVERFLOWING = 500;
const MIN_FLUSH = 100;
const DOMAIN_TIMEOUT_MS = 120_000;
const CLEAN = { count: 0, first: [] };

describe("D49 edit laws over the exhaustive overflow domain", () => {
  it(
    "L-0 to L-10 hold on every case, and L-8 non-vacuity holds",
    () => {
      const cases = exhaustiveOverflowDomain();
      expect(cases.length).toBe(EXHAUSTIVE_DOMAIN_SIZE);
      const { report, stats } = checkEditLaws(cases, applyEdit);
      expect(summarizeEditLaws(report)).toEqual({
        L0: CLEAN, L1: CLEAN, L2: CLEAN, L3: CLEAN, L4: CLEAN,
        L5: CLEAN, L6: CLEAN, L7: CLEAN, L9: CLEAN, L10: CLEAN,
      });
      expect(stats.overflowing).toBeGreaterThanOrEqual(MIN_OVERFLOWING);
      expect(stats.flush).toBeGreaterThanOrEqual(MIN_FLUSH);
      expect(stats.h1WidenedDeleteColumn).toBeGreaterThanOrEqual(1);
    },
    DOMAIN_TIMEOUT_MS,
  );
});

const RANDOM_COUNT = 200;
const MIN_PER_PARTITION = 50;

let memo: ReturnType<typeof checkEditLaws> | null = null;
const result = () => (memo ??= checkEditLaws(randomOverflowCases(D44_SEED, RANDOM_COUNT), applyEdit, D44_SEED));

const LAWS: Array<[EditLawKey, string]> = [
  ["L0", "every generated case parses to one table spanning its rows"],
  ["L1", "L-1 conservation: non-delete edits keep every non-empty cell"],
  ["L2", "L-2 delete conservation: only the deleted row or column goes"],
  ["L3", "L-3 rectangular: every output line has W' cells"],
  ["L4", "L-4 (pin) reformat is idempotent"],
  ["L5", "L-5 reformat_table agrees with formatTable"],
  ["L6", "L-6 (pin) with no overflow, every edit equals the frozen pre-fix edit"],
  ["L7", "L-7 (pin) moves and insert/delete round-trip to reformat"],
  ["L9", "L-9 positional: the output grid is the reference array operation"],
  ["L10", "L-10 cursor: lands at the start of the specified target cell"],
];

describe(`D49 edit laws over ${RANDOM_COUNT} seeded cases (seed ${D44_SEED})`, () => {
  it.each(LAWS)("%s %s", (key) => {
    expect(summary(result().report[key])).toEqual(CLEAN);
  });

  it("L-8 non-vacuity: both partitions and the h=1 delete_column boundary are exercised", () => {
    const { stats } = result();
    expect(stats.overflowing).toBeGreaterThanOrEqual(MIN_PER_PARTITION);
    expect(stats.flush).toBeGreaterThanOrEqual(MIN_PER_PARTITION);
    expect(stats.h1WidenedDeleteColumn).toBeGreaterThanOrEqual(1);
  });
});
