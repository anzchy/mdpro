/**
 * @module tests/support/tableSpanOracle
 * Purpose: Shared support for the D12 table-span suites (ADR-0043), per
 * the test matrix `.claude/tdd-guardian/tests-20260930-D12.md`. It imports
 * the LIVE parser only and is not a frozen file — the frozen oracle is
 * `tests/support/frozenTableParse.ts`.
 *
 * WI-1 landed `textOf`; WI-2/WI-3 add `spanOfModel`, `recordingSource` and
 * `D12_FIXTURES`. `legacyCursorOracle` and the rope spies arrive with the
 * work items that first consume them (WI-5/WI-6).
 *
 * Not a `*.test.ts`, so vitest does not collect it.
 */

import { Text } from "@codemirror/state";

import {
  isTableCandidateLine,
  type TableLineSource,
} from "../../src/utils/tableParser/lines";
import type { LineRange, TableModel } from "../../src/utils/tableParser/types";
import type { TableSpan } from "../../src/utils/tableParser";

/**
 * A CodeMirror `Text` holding `src` verbatim. Splitting on `\n` only keeps
 * any `\r`, as in `tests/table-line-source-conformance.test.ts` — so a
 * CRLF document reaches the `Text` adapter with its carriage returns, and
 * a final line may end in `\r`. `Text.of` needs a non-empty array;
 * `"".split("\n")` is `[""]`.
 */
export function textOf(src: string): Text {
  return Text.of(src.split("\n"));
}

/**
 * The projection of a `TableModel` onto the 8 `TableSpan` fields.
 *
 * `headerLine` / `lastLine` are found by matching the model's `start` /
 * `end` against the line list — never with `lineIndexAt(model.start)`,
 * which under LF resolves a line start to the line ABOVE (Finding 1) and
 * would make this oracle wrong in the same direction as the bug.
 */
export function spanOfModel(
  lines: readonly LineRange[],
  model: TableModel | null,
): TableSpan | null {
  if (model === null) return null;
  const headerLine = lines.findIndex((l) => l.start === model.start);
  const lastLine = lines.findIndex((l) => l.end === model.end);
  return {
    start: model.start,
    end: model.end,
    headerLine,
    lastLine,
    rowCount: model.rowCount,
    colCount: model.colCount,
    alignments: model.alignments,
    delimiterIsCandidate: isTableCandidateLine(lines[headerLine + 1]),
  };
}

/** A `TableLineSource` wrapper that records what the parser asked for. */
export interface RecordingSource extends TableLineSource {
  /** Every `line(i)` index, in call order. */
  readonly lineIndices: number[];
  readonly lineIndexAtCalls: number;
  readonly iterLinesCalls: number;
  readonly sliceCalls: number;
  /** Zero every counter (the index list is emptied in place). */
  reset(): void;
}

/**
 * Extends the `countingSource` pattern of
 * `tests/table-parser-lazy-raw.test.ts`: a thin delegating wrapper over a
 * REAL adapter — never a hand-built fake — that records the `line()`
 * index sequence plus `lineIndexAt` / `iterLines` / `slice` counts.
 *
 * Calls an adapter makes on ITSELF (the `Text` adapter's internal
 * `this.line(index - 1)` inside `lineIndexAt`) are not seen; see plan
 * Finding 3.
 */
export function recordingSource(inner: TableLineSource): RecordingSource {
  const lineIndices: number[] = [];
  let lineIndexAtCalls = 0;
  let iterLinesCalls = 0;
  let sliceCalls = 0;
  return {
    get length() {
      return inner.length;
    },
    get lineCount() {
      return inner.lineCount;
    },
    line(i: number) {
      lineIndices.push(i);
      return inner.line(i);
    },
    lineIndexAt(o: number) {
      lineIndexAtCalls += 1;
      return inner.lineIndexAt(o);
    },
    iterLines() {
      iterLinesCalls += 1;
      return inner.iterLines();
    },
    slice(start: number, end: number) {
      sliceCalls += 1;
      return inner.slice(start, end);
    },
    get lineIndices() {
      return lineIndices;
    },
    get lineIndexAtCalls() {
      return lineIndexAtCalls;
    },
    get iterLinesCalls() {
      return iterLinesCalls;
    },
    get sliceCalls() {
      return sliceCalls;
    },
    reset() {
      lineIndices.length = 0;
      lineIndexAtCalls = 0;
      iterLinesCalls = 0;
      sliceCalls = 0;
    },
  };
}

/**
 * The named D12 fixtures (matrix "Named fixtures" table), shared by the
 * WI-2/3/5/6 suites. Strings are verbatim from the matrix.
 */
export const D12_FIXTURES = {
  NEP: "a | b\n- | -\nc | d\ne | f\n",
  NEP_CRLF: "a | b\r\n- | -\r\nc | d\r\n",
  NEP_EOF: "a | b\n- | -\nc | d",
  NEP_TAIL: "a | b\n- | -\nc | d\nplain\n",
  M1_NEP: "para\na | b\n- | -\n1 | 2\n",
  M1_PIPED: "para\n| a | b |\n| - | - |\n| 1 | 2 |\n",
  M1_BLANK: "para\n\n| a | b |\n| - | - |\n| 1 | 2 |\n",
  PIPELESS: "| h |\n:-:\n| b |\n| c |\n",
  PIPELESS_CHAIN: "| h |\n:-:\n| b |\n:-:\n| c |\n",
  PIPED_DELIM: "| h |\n| :-: |\n| b |\n",
  SETEXT: "| h |\n---\n| b |\n",
  CRLF: "| a | b |\r\n| - | - |\r\n| 1 | 2 |\r\n",
  EOF: "| a | b |\n| - | - |\n| 1 | 2 |",
  CRLF_LAST_CR: "| a | b |\r\n| - | - |\r\n| 1 | 2 |\r",
  HEADER_ONLY: "| a | b |\n| - | - |\n",
  ESC: "| a\\|b | c |\n| - | - |\n| x\\|y | z |\n",
  CJK: "| 汉字 | 𝄞 |\n| - | - |\n| 👍🏽 | 한글 |\n",
  PAD_TRUNC: "| a | b | c |\n| - | - | - |\n| 1 |\n| 1 | 2 | 3 | 4 |\n",
  P2: "| a | b |\n| - | - |\n| 1 | 2 |\n",
  AFTER_TAIL: "| a | b |\n| - | - |\n| 1 | 2 |\nafter\n",
  INTRO_TABLE: "intro\n\n| a | b |\n| - | - |\n| 1 | 2 |\n",
  T3: "| a | b | c |\n| - | - | - |\n| d | e | f |\n| g | h | i |\n",
} as const;

export type D12FixtureName = keyof typeof D12_FIXTURES;
