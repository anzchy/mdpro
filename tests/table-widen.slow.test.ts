// @vitest-environment node
/**
 * @module table-widen.slow.test
 * Slow tier (ADR-0050) of `table-widen.test.ts`: W-11, no spread in the width
 * computation. A 300 001-row table must widen without `RangeError` — the
 * width is a `reduce`, never `Math.max(...rows)`, whose argument spread
 * overflows the stack at this size. Parsing that table is what makes it slow.
 *
 * Matrix: `.claude/tdd-guardian/tests-20261009-111653.md`, "Adversary round 1
 * — amendments" item 4 (W-11).
 *
 * WI-1.1 added the `widenTable` half. WI-1.2 added the `applyEdit(…,
 * "reformat_table")` half, when the edits began to widen.
 */

import { describe, expect, it } from "vitest";

import { widenTable } from "../src/utils/tableWiden";
import { parseTableAt } from "../src/utils/tableParser";
import { applyEdit } from "../src/utils/tableEdits";

const BODY_ROWS = 300_000;
const W11_TIMEOUT_MS = 120_000;

describe("W-11 widenTable has no spread in its width computation", () => {
  it(
    "widens a 300k-row table whose last row overflows",
    () => {
      const source = "| a | b |\n|---|---|\n" + "| 1 | 2 |\n".repeat(BODY_ROWS) + "| 1 | 2 | Z |\n";
      const model = parseTableAt(source, 0);
      expect(model?.rowCount).toBe(BODY_ROWS + 2);
      let alignments: unknown[] = [];
      expect(() => {
        alignments = widenTable(model!).alignments;
      }).not.toThrow();
      expect(alignments.length).toBe(3);
    },
    W11_TIMEOUT_MS,
  );

  it(
    "reformat_table on the 300k-row table does not throw and keeps the overflow",
    () => {
      const source = "| a | b |\n|---|---|\n" + "| 1 | 2 |\n".repeat(BODY_ROWS) + "| 1 | 2 | Z |\n";
      const model = parseTableAt(source, 0)!;
      const ctx = { rowIndex: 1, colIndex: 0, rowCount: model.rowCount, colCount: model.colCount, alignment: "left" as const };
      let out = "";
      expect(() => {
        out = applyEdit(model, ctx, "reformat_table")!.source;
      }).not.toThrow();
      expect(out.endsWith("| 1   | 2   | Z   |")).toBe(true);
    },
    W11_TIMEOUT_MS,
  );
});
