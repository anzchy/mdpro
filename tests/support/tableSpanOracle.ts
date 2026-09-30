/**
 * @module tests/support/tableSpanOracle
 * Purpose: Shared support for the D12 table-span suites (ADR-0043), per
 * the test matrix `.claude/tdd-guardian/tests-20260930-D12.md`. It imports
 * the LIVE parser only and is not a frozen file — the frozen oracle is
 * `tests/support/frozenTableParse.ts`.
 *
 * WI-1 lands only `textOf`. `spanOfModel`, `legacyCursorOracle`,
 * `recordingSource`, the rope spies and `D12_FIXTURES` arrive with the
 * work items that first consume them.
 *
 * Not a `*.test.ts`, so vitest does not collect it.
 */

import { Text } from "@codemirror/state";

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
