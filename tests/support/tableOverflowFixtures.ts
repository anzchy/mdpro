/**
 * @module tests/support/tableOverflowFixtures
 * Purpose: the D44 fixture literals, written out byte for byte from the
 * matrix `.claude/tdd-guardian/tests-20261007-155353.md` (never computed by
 * the code under test). Shared by `tests/table-format-overflow.test.ts`
 * (F-* cases, F-IDEMPOTENT-FIXTURE) and `tests/table-format-overflow-log.test.ts`
 * (L-NO-WIDEN-NO-LOG), so the literals exist once.
 *
 * `widths` is the per-table colCount every non-fenced table must have after
 * formatting: the widest `splitCellTexts` count of that table's input lines.
 *
 * Not a `*.test.ts`, so vitest does not collect it.
 */

import type { IsFenced } from "../../src/utils/cursorSync/table";

export interface OverflowFixture {
  id: string;
  input: string;
  expected: string;
  widths: number[];
  isFenced?: IsFenced;
}

const fx = (id: string, input: string, expected: string, ...widths: number[]): OverflowFixture => ({
  id,
  input,
  expected,
  widths,
});

export const REPRO_INPUT = "| a | b |\n| - | - |\n| e | f |\n| g | h |Z\n";
export const REPRO_EXPECTED = "| a   | b   |     |\n| --- | --- | --- |\n| e   | f   |     |\n| g   | h   | Z   |\n";
export const REPRO_HEAD = "| a   | b   |\n| --- | --- |\n| e   | f   |\n| g   | h   |\n";

export const MULTI_DISTINCT_INPUT = "| a | b |\n| - | - |\n| 1 | 2 | P |\n\nMid.\n\n| x |\n| - |\n| 3 | Q | R | S |\n";
export const MULTI_DISTINCT_EXPECTED =
  "| a   | b   |     |\n| --- | --- | --- |\n| 1   | 2   | P   |\n\nMid.\n\n| x   |     |     |     |\n| --- | --- | --- | --- |\n| 3   | Q   | R   | S   |\n";

const FENCE_MD = "```\n| a | b |\n| - | - |\n| g | h | Z |\n```\n\n| x | y |\n| - | - |\n| 3 | 4 |\n";
const FENCE_END = FENCE_MD.indexOf("```\n\n") + 4;

export const UNTOUCHED_FENCE: OverflowFixture = {
  id: "F-UNTOUCHED-FENCE",
  input: FENCE_MD,
  expected: "```\n| a | b |\n| - | - |\n| g | h | Z |\n```\n\n| x   | y   |\n| --- | --- |\n| 3   | 4   |\n",
  widths: [2],
  isFenced: (o) => o >= 0 && o < FENCE_END,
};

/** Every widening fixture (RED on HEAD) plus F-HEADER-ONLY and F-BLANK-OVERFLOW (c). */
export const OVERFLOW_FIXTURES: readonly OverflowFixture[] = [
  fx("F-REPRO", REPRO_INPUT, REPRO_EXPECTED, 3),
  fx("F-NO-TRAILING-PIPE (a)", "| a | b |\n| - | - |\n| g | h | Z\n", "| a   | b   |     |\n| --- | --- | --- |\n| g   | h   | Z   |\n", 3),
  fx("F-NO-TRAILING-PIPE (b)", "a | b\n- | -\ng | h | Z\n", "| a   | b   |     |\n| --- | --- | --- |\n| g   | h   | Z   |\n", 3),
  fx(
    "F-WIDEST-WINS",
    "| a | b |\n| - | - |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 | 7 | 8 |\n| 9 |\n",
    "| a   | b   |     |     |     |\n| --- | --- | --- | --- | --- |\n| 1   | 2   | 3   |     |     |\n| 4   | 5   | 6   | 7   | 8   |\n| 9   |     |     |     |     |\n",
    5,
  ),
  fx(
    "F-ROW-ATTRIBUTION",
    "| h | i |\n| - | - |\n| 1 | 2 | P |\n| 3 | 4 |\n| 5 | 6 | Q | R |\n",
    "| h   | i   |     |     |\n| --- | --- | --- | --- |\n| 1   | 2   | P   |     |\n| 3   | 4   |     |     |\n| 5   | 6   | Q   | R   |\n",
    4,
  ),
  fx("F-DELIM-LOOKALIKE-ROW", "| a | b |\n| - | - |\n| - | - | - |\n", "| a   | b   |     |\n| --- | --- | --- |\n| -   | -   | -   |\n", 3),
  fx("F-PIPELESS-DELIM", "| a |\n:-:\n| b | Z |\n", "| a   |     |\n| :-: | --- |\n| b   | Z   |\n", 2),
  fx("F-HEADER-ONLY", "| a | b |\n| - | - |\n", "| a   | b   |\n| --- | --- |\n", 2),
  fx(
    "F-ALIGN",
    "| a | b | c |\n| :- | :-: | -: |\n| 1 | 2 | 3 | Z |\n",
    "| a   | b   | c   |     |\n| :-- | :-: | --: | --- |\n| 1   | 2   | 3   | Z   |\n",
    4,
  ),
  fx("F-ESCAPED-PIPE", "| a | b |\n| - | - |\n| 1 | 2 | a \\| b |\n", "| a   | b   |        |\n| --- | --- | ------ |\n| 1   | 2   | a \\| b |\n", 3),
  fx(
    "F-ESCAPED-BACKSLASH-PIPE",
    "| a | b |\n| - | - |\n| 1 | 2 | c\\\\| d |\n",
    "| a   | b   |     |     |\n| --- | --- | --- | --- |\n| 1   | 2   | c\\\\ | d   |\n",
    4,
  ),
  fx(
    "F-ESCAPED-ODD-BACKSLASH-PIPE",
    "| a | b |\n| - | - |\n| 1 | 2 | d\\\\\\| e |\n",
    "| a   | b   |         |\n| --- | --- | ------- |\n| 1   | 2   | d\\\\\\| e |\n",
    3,
  ),
  fx("F-TRAILING-BACKSLASH", "| a | b |\n| - | - |\n| g | h |Z\\\n", "| a   | b   |     |\n| --- | --- | --- |\n| g   | h   | Z\\  |\n", 3),
  fx(
    "F-CRLF",
    "| a | b |\r\n| - | - |\r\n| g | h |Z\r\n| e | f |\r\n",
    "| a   | b   |     |\n| --- | --- | --- |\n| g   | h   | Z   |\n| e   | f   |     |\r\n",
    3,
  ),
  fx("F-CJK", "| 名前 | 值 |\n| - | - |\n| a | b | 中文字Z |\n", "| 名前  | 值   |      |\n| --- | --- | ---- |\n| a   | b   | 中文字Z |\n", 3),
  fx("F-BLANK-OVERFLOW (a)", "| a | b |\n| - | - |\n| g | h | |\n", "| a   | b   |     |\n| --- | --- | --- |\n| g   | h   |     |\n", 3),
  fx(
    "F-BLANK-OVERFLOW (b)",
    "| a | b |\n| - | - |\n| g | h | | |\n",
    "| a   | b   |     |     |\n| --- | --- | --- | --- |\n| g   | h   |     |     |\n",
    4,
  ),
  fx("F-BLANK-OVERFLOW (c)", "| a | b |\n| - | - |\n| g | h |   \n", "| a   | b   |\n| --- | --- |\n| g   | h   |\n", 2),
  fx("F-D41-COMBO (a)", "| a | b |\n| - | - |\n| | x | Z\n", "| a   | b   |     |\n| --- | --- | --- |\n|     | x   | Z   |\n", 3),
  fx("F-D41-COMBO (b)", "| a | b |\n| - | - |\n| | x | Z |\n", "| a   | b   |     |\n| --- | --- | --- |\n|     | x   | Z   |\n", 3),
  fx("F-INDENT", "  | a | b |\n  | - | - |\n  | g | h | Z |\n", "| a   | b   |     |\n| --- | --- | --- |\n| g   | h   | Z   |\n", 3),
  UNTOUCHED_FENCE,
  fx(
    "F-UNTOUCHED-MULTI (c1)",
    "| a | b |\n| - | - |\n| 1 | 2 |\n\nMid.\n\n| x | y |\n| - | - |\n| 3 | 4 | Z |\n\nEnd.\n",
    "| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\nMid.\n\n| x   | y   |     |\n| --- | --- | --- |\n| 3   | 4   | Z   |\n\nEnd.\n",
    2,
    3,
  ),
  fx(
    "F-UNTOUCHED-MULTI (c2)",
    "| x | y |\n| - | - |\n| 3 | 4 | Z |\n\nMid.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n",
    "| x   | y   |     |\n| --- | --- | --- |\n| 3   | 4   | Z   |\n\nMid.\n\n| a   | b   |\n| --- | --- |\n| 1   | 2   |\n",
    3,
    2,
  ),
  fx("F-MULTI-DISTINCT-W", MULTI_DISTINCT_INPUT, MULTI_DISTINCT_EXPECTED, 3, 4),
];

/** F-CONSERVE-LITERALS: tables with no overflow; byte-identical to the pre-fix formatter. */
export const CONSERVE_LITERALS: readonly OverflowFixture[] = [
  fx("(i) short row", "| a | b | c |\n| - | - | - |\n| 1 |\n", "| a   | b   | c   |\n| --- | --- | --- |\n| 1   |     |     |\n", 3),
  fx("(ii) trailing whitespace", "| a | b |\n| - | - |\n| g | h |   \n", "| a   | b   |\n| --- | --- |\n| g   | h   |\n", 2),
  fx("(iii) D41 LEAD", "| h1 | h2 |\n| - | - |\n| | x |\n", "| h1  | h2  |\n| --- | --- |\n|     | x   |\n", 2),
  fx("(iv) alignment width 6", "| a | b |\n| :-: | -: |\n| longer | 2 |\n", "| a      | b   |\n| :----: | --: |\n| longer | 2   |\n", 2),
  fx("(v) escaped pipe in header columns", "| h1 | h2 |\n| -- | -- |\n| a \\| b | c |\n", "| h1     | h2  |\n| ------ | --- |\n| a \\| b | c   |\n", 2),
  fx(
    "(vi) prose",
    "Before.\n\n|a|longheader|\n|-|-|\n|1|2|\n\nAfter.\n",
    "Before.\n\n| a   | longheader |\n| --- | ---------- |\n| 1   | 2          |\n\nAfter.\n",
    2,
  ),
];

/** Looks a fixture up by id; throws on a typo so a case cannot silently test nothing. */
export function fixture(id: string): OverflowFixture {
  const found = OVERFLOW_FIXTURES.find((f) => f.id === id);
  if (!found) throw new Error(`no fixture ${id}`);
  return found;
}
