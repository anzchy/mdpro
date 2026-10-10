// @vitest-environment node
/**
 * D44 WI-1: format-on-save drops overflow cells (body cells past the
 * header's column count). `formatAllTables` must widen each table to its own
 * widest row instead of truncating.
 *
 * Matrix: `.claude/tdd-guardian/tests-20261007-155353.md`, unit
 * `tableFormatter.ts#formatAllTables`, fixture cases F-REPRO .. F-IDEMPOTENT-FIXTURE.
 * Pure functions, no mocks. Literals live in `tests/support/tableOverflowFixtures.ts`.
 */

import { describe, expect, it } from "vitest";

import { formatAllTables } from "../src/utils/tableFormatter";
import { parseTableAt } from "../src/utils/tableParser";
import { splitCellTexts } from "../src/utils/tableParser/lines";
import { findAllTables } from "../src/utils/cursorSync/table";
import { frozenFormatAllTables } from "./support/frozenTableFormat";
import {
  CONSERVE_LITERALS,
  MULTI_DISTINCT_EXPECTED,
  MULTI_DISTINCT_INPUT,
  OVERFLOW_FIXTURES,
  REPRO_EXPECTED,
  REPRO_INPUT,
  UNTOUCHED_FENCE,
  fixture,
} from "./support/tableOverflowFixtures";
import { summary } from "./support/tableOverflowArb";

const texts = (src: string, row: number) => parseTableAt(src, 0)!.rows[row].map((c) => c.text);
const expectFormats = (id: string) => {
  const f = fixture(id);
  expect(formatAllTables(f.input, f.isFenced)).toBe(f.expected);
};

describe("D44 overflow cells are kept as new columns", () => {
  it("F-REPRO: the reported defect keeps Z in a third column", () => {
    expect(formatAllTables(REPRO_INPUT)).toBe(REPRO_EXPECTED);
  });

  it("F-NO-TRAILING-PIPE: no closing pipe, and no edge pipes at all", () => {
    expectFormats("F-NO-TRAILING-PIPE (a)");
    expectFormats("F-NO-TRAILING-PIPE (b)");
  });

  it("F-WIDEST-WINS: every row widens to the widest row (5)", () => expectFormats("F-WIDEST-WINS"));

  it("F-ROW-ATTRIBUTION: each overflow cell stays on its own row", () => expectFormats("F-ROW-ATTRIBUTION"));

  it("F-DELIM-LOOKALIKE-ROW: a body row spelled like a delimiter is still a row", () => {
    const f = fixture("F-DELIM-LOOKALIKE-ROW");
    const out = formatAllTables(f.input);
    expect(out).toBe(f.expected);
    expect(texts(out, 1)).toEqual(["-", "-", "-"]);
  });

  it("F-PIPELESS-DELIM: single-column table with a pipeless delimiter widens", () =>
    expectFormats("F-PIPELESS-DELIM"));

  it("F-HEADER-ONLY: an empty body is not widened", () => expectFormats("F-HEADER-ONLY"));

  it("F-ALIGN: original alignments kept, new column gets default alignment", () => {
    const f = fixture("F-ALIGN");
    const out = formatAllTables(f.input);
    expect(out).toBe(f.expected);
    expect(parseTableAt(out, 0)!.alignments).toEqual(["left", "center", "right", null]);
  });

  it("F-ESCAPED-PIPE: an escaped pipe inside an overflow cell stays one cell", () => {
    const f = fixture("F-ESCAPED-PIPE");
    const out = formatAllTables(f.input);
    expect(out).toBe(f.expected);
    expect(parseTableAt(out, 0)!.colCount).toBe(3);
  });

  it("F-ESCAPED-BACKSLASH-PIPE: an escaped backslash before a pipe leaves the pipe a separator", () => {
    const f = fixture("F-ESCAPED-BACKSLASH-PIPE");
    const out = formatAllTables(f.input);
    expect(out).toBe(f.expected);
    expect(parseTableAt(out, 0)!.colCount).toBe(4);
    expect(texts(out, 1)).toEqual(["1", "2", "c\\\\", "d"]);
    expect(formatAllTables(out)).toBe(out);
  });

  it("F-ESCAPED-ODD-BACKSLASH-PIPE: three backslashes then a pipe keep the pipe escaped", () => {
    const f = fixture("F-ESCAPED-ODD-BACKSLASH-PIPE");
    const out = formatAllTables(f.input);
    expect(out).toBe(f.expected);
    expect(parseTableAt(out, 0)!.colCount).toBe(3);
    expect(texts(out, 1)).toEqual(["1", "2", "d\\\\\\| e"]);
    expect(formatAllTables(out)).toBe(out);
  });

  it("F-TRAILING-BACKSLASH: a dangling escape keeps its bytes", () => {
    const f = fixture("F-TRAILING-BACKSLASH");
    const out = formatAllTables(f.input);
    expect(out).toBe(f.expected);
    expect(texts(out, 1)[2]).toBe("Z\\");
    expect(formatAllTables(out)).toBe(out);
  });

  it("F-CRLF: overflow on a CRLF middle row is kept, the table is rewritten with LF", () =>
    expectFormats("F-CRLF"));

  it("F-CJK: non-ASCII overflow keeps its bytes; widths stay UTF-16", () => {
    const f = fixture("F-CJK");
    const out = formatAllTables(f.input);
    expect(out).toBe(f.expected);
    expect(formatAllTables(out)).toBe(out);
  });

  it("F-BLANK-OVERFLOW: blank overflow cells count (D-1); trailing spaces do not", () => {
    expectFormats("F-BLANK-OVERFLOW (a)");
    expectFormats("F-BLANK-OVERFLOW (b)");
    expectFormats("F-BLANK-OVERFLOW (c)");
  });

  it("F-D41-COMBO: a blank first cell plus overflow keeps every cell in its column", () => {
    expectFormats("F-D41-COMBO (a)");
    expectFormats("F-D41-COMBO (b)");
  });

  it("F-INDENT: indented table widens, indent dropped as before", () => expectFormats("F-INDENT"));

  it("F-UNTOUCHED-FENCE: a fenced overflow table stays verbatim", () => {
    expect(formatAllTables(UNTOUCHED_FENCE.input, UNTOUCHED_FENCE.isFenced)).toBe(UNTOUCHED_FENCE.expected);
  });

  it("F-UNTOUCHED-MULTI: only the overflow table widens, wherever it sits", () => {
    expectFormats("F-UNTOUCHED-MULTI (c1)");
    expectFormats("F-UNTOUCHED-MULTI (c2)");
  });

  it("F-MULTI-DISTINCT-W: each table widens to its own width (3 and 4)", () => {
    const out = formatAllTables(MULTI_DISTINCT_INPUT);
    expect(out).toBe(MULTI_DISTINCT_EXPECTED);
    expect(findAllTables(out).map((t) => t.colCount)).toEqual([3, 4]);
  });
});

describe("D44 tables without overflow are unchanged", () => {
  it("F-CONSERVE-LITERALS: byte-identical to the literal and to the pre-fix formatter", () => {
    for (const f of CONSERVE_LITERALS) {
      const out = formatAllTables(f.input);
      expect(out, f.id).toBe(f.expected);
      expect(out, f.id).toBe(frozenFormatAllTables(f.input));
    }
  });
});

describe("D44 idempotence and width over every fixture", () => {
  it("F-IDEMPOTENT-FIXTURE: f(f(x)) === f(x) and each table has its listed width", () => {
    const bad: string[] = [];
    for (const f of [...OVERFLOW_FIXTURES, ...CONSERVE_LITERALS]) {
      const once = formatAllTables(f.input, f.isFenced);
      if (formatAllTables(once, f.isFenced) !== once) bad.push(`${f.id}: not idempotent`);
      // Cross-check the listed literal against the input's own lines.
      const widest = findAllTables(f.input, f.isFenced).map((t) =>
        Math.max(...t.raw.split("\n").map((l) => splitCellTexts(l).length)),
      );
      if (JSON.stringify(widest) !== JSON.stringify(f.widths)) bad.push(`${f.id}: literal ${f.widths} vs input ${widest}`);
      const got = findAllTables(once, f.isFenced).map((t) => t.colCount);
      if (JSON.stringify(got) !== JSON.stringify(f.widths)) bad.push(`${f.id}: colCount ${got} want ${f.widths}`);
    }
    expect(summary(bad)).toEqual({ count: 0, first: [] });
  });
});
