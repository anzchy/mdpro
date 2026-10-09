// @vitest-environment node
/**
 * D49 WI-1.1: `src/utils/tableWiden.ts#widenTable`, the write-side widening
 * helper moved out of `tableFormatter.ts` (refactor, no behaviour change).
 *
 * Law: rows[i] = pad(oracleCells(rawLine_i), W) with W = max(h, widest oracle
 * row); alignments = model.alignments ++ null^(W-h); every row has exactly W
 * cells (rectangular); W === h is a no-op; widen is a fixed point under
 * serialize + re-parse.
 *
 * Matrix: `.claude/tdd-guardian/tests-20261009-111653.md` W-1…W-9. W-11 (the
 * 300k-row no-spread case) lives in `table-widen.slow.test.ts`. No mocks. The
 * generated half is seeded (`D44_SEED`, `mulberry32`); fast-check is not a
 * dependency.
 */

import { describe, expect, it } from "vitest";

import { widenTable } from "../src/utils/tableWiden";
import { parseTableAt, serializeRows, type TableModel } from "../src/utils/tableParser";
import { splitCellTexts } from "../src/utils/tableParser/lines";
import {
  AFTER,
  BEFORE,
  D44_SEED,
  exhaustiveOverflowDomain,
  onlyTable,
  oracleCells,
  pad,
  randomOverflowCases,
  summary,
  widthOf,
  type OverflowCase,
} from "./support/tableOverflowArb";

const RANDOM_COUNT = 500;
const MIN_PARTITION = 200;
const DOMAIN_TIMEOUT_MS = 60_000;
const CLEAN = { count: 0, first: [] };

const DOMAIN: OverflowCase[] = [...exhaustiveOverflowDomain(), ...randomOverflowCases(D44_SEED, RANDOM_COUNT)];

function modelOf(source: string): TableModel {
  const model = parseTableAt(source, 0);
  if (!model) throw new Error(`no table in ${JSON.stringify(source)}`);
  return model;
}

const tag = (c: OverflowCase, msg: string) => `#${c.index} ${JSON.stringify(c.source)} ${msg}`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The independent grid: header plus each body line's own cells, padded to W. */
function oracleGrid(c: OverflowCase): string[][] {
  const w = widthOf(c);
  return [pad(c.header, w), ...c.rows.map((r) => pad(oracleCells(r.line), w))];
}

describe("W-1 an over-wide row widens the table", () => {
  it("pads the header and keeps the overflow cell", () => {
    expect(widenTable(modelOf("| a | b |\n|---|---|\n| 1 | 2 | Z |\n"))).toEqual({
      rows: [
        ["a", "b", ""],
        ["1", "2", "Z"],
      ],
      alignments: [null, null, null],
    });
  });
});

describe("W-2 no-op when nothing overflows (S4)", () => {
  it(
    "returns the model's own texts and alignments over the non-overflow partition",
    () => {
      const bad: string[] = [];
      let partition = 0;
      for (const c of DOMAIN) {
        if (widthOf(c) !== c.h) continue;
        const model = onlyTable(c.source);
        if (!model) {
          bad.push(tag(c, "no single table"));
          continue;
        }
        partition += 1;
        const w = widenTable(model);
        const texts = model.rows.map((row) => row.map((cell) => cell.text));
        if (!same(w.rows, texts) || !same(w.alignments, model.alignments)) {
          bad.push(tag(c, `→ ${JSON.stringify(w)}`));
        }
      }
      expect(summary(bad)).toEqual(CLEAN);
      expect(partition).toBeGreaterThanOrEqual(MIN_PARTITION);
    },
    DOMAIN_TIMEOUT_MS,
  );
});

describe("W-3 rectangular, and agrees with the independent oracle (S4)", () => {
  it(
    "every row has W cells and equals the source line's own cells",
    () => {
      const bad: string[] = [];
      let widened = 0;
      for (const c of DOMAIN) {
        const model = onlyTable(c.source);
        if (!model || model.rowCount !== 1 + c.rows.length) {
          bad.push(tag(c, `input rowCount ${model?.rowCount}`));
          continue;
        }
        const width = widthOf(c);
        if (width > c.h) widened += 1;
        const w = widenTable(model);
        if (!same(w.rows, oracleGrid(c))) bad.push(tag(c, `rows ${JSON.stringify(w.rows)}`));
        if (w.alignments.length !== width || w.rows.some((row) => row.length !== w.alignments.length)) {
          bad.push(tag(c, `not rectangular at W=${width}: ${JSON.stringify(w)}`));
        }
        if (!same(w.alignments.slice(0, c.h), model.alignments)) {
          bad.push(tag(c, `header alignments ${JSON.stringify(w.alignments)}`));
        }
        if (w.alignments.slice(c.h).some((a) => a !== null)) {
          bad.push(tag(c, `overflow alignments ${JSON.stringify(w.alignments)}`));
        }
      }
      expect(summary(bad)).toEqual(CLEAN);
      expect(widened).toBeGreaterThanOrEqual(MIN_PARTITION);
    },
    DOMAIN_TIMEOUT_MS,
  );
});

describe("W-4 a blank overflow cell counts as a column (ADR-0052 §2)", () => {
  it("widens to 4 with blank cells", () => {
    expect(widenTable(modelOf("| a | b |\n|---|---|\n| 1 | 2 | | |\n"))).toEqual({
      rows: [
        ["a", "b", "", ""],
        ["1", "2", "", ""],
      ],
      alignments: [null, null, null, null],
    });
  });
});

describe("W-5 an empty body row `|` adds nothing", () => {
  it("is padded to the header's width when alone", () => {
    expect(widenTable(modelOf("| a | b |\n|---|---|\n|\n"))).toEqual({
      rows: [
        ["a", "b"],
        ["", ""],
      ],
      alignments: [null, null],
    });
  });

  it("is padded to the widened width next to an overflow row", () => {
    expect(widenTable(modelOf("| a | b |\n|---|---|\n|\n| 1 | 2 | Z |\n")).rows).toEqual([
      ["a", "b", ""],
      ["", "", ""],
      ["1", "2", "Z"],
    ]);
  });
});

describe("W-6 an escaped pipe in an overflow cell stays one cell", () => {
  it("keeps `a\\|b` with its escape", () => {
    const w = widenTable(modelOf("| a | b |\n|---|---|\n| 1 | 2 | a\\|b |\n"));
    expect(w.rows[1]).toEqual(["1", "2", "a\\|b"]);
    expect(w.alignments.length).toBe(3);
  });
});

describe("W-7 the two splitters agree on a code-span pipe (RC-6, not code-span meaning)", () => {
  it("splits the backticked pipe the way splitCellTexts does", () => {
    const line = "| `x|y` | b |";
    const w = widenTable(modelOf(`| a |\n|---|\n${line}\n`));
    expect(w.rows[1]).toEqual(["`x", "y`", "b"]);
    expect(w.rows[1]).toEqual(splitCellTexts(line).map((s) => s.trim()));
    expect(w.rows[0]).toEqual(["a", "", ""]);
  });
});

describe("W-8 CRLF: no `\\r` inside any cell", () => {
  it("reads the overflow without the line's trailing `\\r`", () => {
    const w = widenTable(modelOf("| a | b |\r\n|---|---|\r\n| 1 | 2 | Z\r\n| 3 | 4 |\r\n"));
    expect(w.rows).toEqual([
      ["a", "b", ""],
      ["1", "2", "Z"],
      ["3", "4", ""],
    ]);
    expect(w.rows.flat().some((t) => t.includes("\r"))).toBe(false);
  });
});

describe("W-9 widen is a fixed point under serialize and re-parse (S5)", () => {
  it(
    "widenTable(parse(serializeRows(widenTable(m)))) equals widenTable(m)",
    () => {
      const bad: string[] = [];
      for (const c of DOMAIN) {
        const model = onlyTable(c.source);
        if (!model) {
          bad.push(tag(c, "no single table"));
          continue;
        }
        try {
          const w = widenTable(model);
          const m2 = onlyTable(BEFORE + serializeRows(w.rows, w.alignments) + "\n" + AFTER);
          const w2 = m2 ? widenTable(m2) : null;
          if (!same(w2, w)) bad.push(tag(c, `${JSON.stringify(w)} → ${JSON.stringify(w2)}`));
        } catch (error) {
          bad.push(tag(c, `threw ${error instanceof Error ? error.message : String(error)}`));
        }
      }
      expect(summary(bad)).toEqual(CLEAN);
    },
    DOMAIN_TIMEOUT_MS,
  );
});
