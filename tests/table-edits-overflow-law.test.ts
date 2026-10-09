// @vitest-environment node
/**
 * D49 WI-1.2: the laws of the source-mode context-menu edits on tables whose
 * body rows overflow the header, over seeded `randomOverflowCases` (the
 * default lane). The exhaustive 1688-case half is
 * `table-edits-overflow-law.slow.test.ts` (ADR-0050).
 *
 * Matrix: `.claude/tdd-guardian/tests-20261009-111653.md` "# WI-1.2" L-1 to
 * L-10, with the adversary-round-1 amendment to L-10. L-4, L-6 and L-7 are
 * pins: they hold on 8bb859e too. No mocks; fast-check is not a dependency,
 * so the domain is seeded with the repo's `mulberry32` (`D44_SEED`).
 */

import { describe, expect, it } from "vitest";

import { applyEdit } from "../src/utils/tableEdits";
import { D44_SEED, randomOverflowCases, summary } from "./support/tableOverflowArb";
import { checkEditLaws, type EditLawKey } from "./support/tableEditsOverflowLaws";

const RANDOM_COUNT = 200;
const MIN_PER_PARTITION = 50;
const CLEAN = { count: 0, first: [] };

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
