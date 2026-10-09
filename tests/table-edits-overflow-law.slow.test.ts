// @vitest-environment node
/**
 * D49 WI-1.2, slow tier (ADR-0050): the edit laws L-1 to L-10 over the
 * exhaustive 1688-case overflow domain. The seeded half runs in the default
 * lane (`table-edits-overflow-law.test.ts`); both share
 * `tests/support/tableEditsOverflowLaws.ts`.
 *
 * Matrix: `.claude/tdd-guardian/tests-20261009-111653.md` "# WI-1.2" L-1 to
 * L-10 (L-10 as amended in adversary round 1). L-4, L-6 and L-7 are pins.
 */

import { describe, expect, it } from "vitest";

import { applyEdit } from "../src/utils/tableEdits";
import { EXHAUSTIVE_DOMAIN_SIZE, exhaustiveOverflowDomain } from "./support/tableOverflowArb";
import { checkEditLaws, summarizeEditLaws } from "./support/tableEditsOverflowLaws";

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
