/**
 * @module tests/support/tableSpanOracle
 * Purpose: Shared support for the D12 table-span suites (ADR-0043), per
 * the test matrix `.claude/tdd-guardian/tests-20260930-D12.md`. It imports
 * the LIVE parser only and is not a frozen file — the frozen oracle is
 * `tests/support/frozenTableParse.ts`.
 *
 * Contents: `textOf` (WI-1); `spanOfModel`, `recordingSource` and
 * `D12_FIXTURES` (WI-2/WI-3); `ropeSpy` (WI-4, TAB-2); and
 * `legacyCursorOracle`, `ropeProtoSpy`, `FENCE_IN_SPAN`, `costDoc` and the
 * re-exported `fieldWindow` helpers (WI-5/WI-6).
 *
 * Not a `*.test.ts`, so vitest does not collect it.
 */

import { Text } from "@codemirror/state";
import { vi } from "vitest";

import {
  isTableCandidateLine,
  type TableLineSource,
} from "../../src/utils/tableParser/lines";
import type { LineRange, TableModel } from "../../src/utils/tableParser/types";
import type { TableSpan } from "../../src/utils/tableParser";
import type { EditorState } from "@codemirror/state";
import { isPositionInFencedCode } from "../../src/plugins/codemirror/sourceTableDetection";
import { findCell } from "../../src/utils/tableParser/find";
import { linesFromString, splitLines } from "../../src/utils/tableParser/lines";
import { parseTableAtOffset } from "../../src/utils/tableParser/parse";
import type { TableCell } from "../../src/utils/tableParser/types";

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

/** The seven root-`Text` methods the rope spies watch (plan S8). */
export const ROPE_METHODS = [
  "line",
  "lineAt",
  "iterLines",
  "sliceString",
  "toString",
  "iter",
  "iterRange",
] as const;

export type RopeMethod = (typeof ROPE_METHODS)[number];
export type RopeCounts = Record<RopeMethod, number>;

export interface RopeSpy {
  /** Calls made on the watched instance since creation or the last reset. */
  counts(): RopeCounts;
  reset(): void;
  /** Remove the instance spies (the module-level mocks are untouched). */
  restore(): void;
}

/**
 * Passthrough `vi.spyOn` on the root `Text` INSTANCE for the seven rope
 * methods. A selection-only transaction keeps the same `Text`, so the spy
 * stays valid across such steps (plan Finding 3). Calls a method makes on
 * a CHILD node have a different `this` and are not counted.
 *
 * Follow the rope-count protocol: reset, dispatch, snapshot `counts()`,
 * and only then run any assertion that reads the document.
 */
export function ropeSpy(doc: Text): RopeSpy {
  const target = doc as unknown as Record<RopeMethod, (...args: unknown[]) => unknown>;
  const spies = ROPE_METHODS.map((m) => [m, vi.spyOn(target, m)] as const);
  return {
    counts() {
      const out = {} as RopeCounts;
      for (const [m, spy] of spies) out[m] = spy.mock.calls.length;
      return out;
    },
    reset() {
      for (const [, spy] of spies) spy.mockClear();
    },
    restore() {
      for (const [, spy] of spies) spy.mockRestore();
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
  FENCED_TABLE: "```\n| a | b |\n| - | - |\n| 1 | 2 |\n```\n",
} as const;

export type D12FixtureName = keyof typeof D12_FIXTURES;

// ---------------------------------------------------------------------------
// WI-5 additions (matrix SPAN-1..SPAN-6).
// ---------------------------------------------------------------------------

/**
 * Matrix `FENCE_IN_SPAN`: line 2 is a table-candidate line AND opens a
 * fence, so a locate from line 0 spans lines 0-3 while offset 32 (inside
 * `| 1 | 2 |`) is fenced. Kept out of `D12_FIXTURES` so the pure-parser
 * suites that sweep that object keep their domain.
 */
export const FENCE_IN_SPAN = "| a | b |\n| - | - |\n```x | y\n| 1 | 2 |\n```\n";

/**
 * Matrix `costDoc(R)`: a paragraph and a blank line, then a 3-column table
 * with R body rows, then a trailing paragraph. The table never starts at
 * line 0 (plan S4). `headerLine 2`, `lastLine R+3`, `start 17`; body row k
 * is line `k+4`.
 */
export function costDoc(rows: number): string {
  let body = "";
  for (let k = 0; k < rows; k += 1) body += `| r${k}c0 | r${k}c1 | r${k}c2 |\n`;
  return (
    "intro paragraph\n\n" +
    "| h0 | h1 | h2 |\n| --- | --- | --- |\n" +
    body +
    "\noutro\n"
  );
}

/** What the Source cursor context must equal: span plus active cell. */
export interface CursorContext {
  span: TableSpan | null;
  cell: TableCell | null;
}

/**
 * The M3 oracle — the LEGACY path, not a fresh `EditorState.create`:
 *  1. `head = selection.main.head`;
 *  2. fenced → `{ span: null, cell: null }`;
 *  3. otherwise parse the whole document from a string copy at `head`;
 *  4. project the model onto the 8 span fields, plus `findCell`.
 *
 * It calls `state.doc.toString()` on the watched root `Text` and, inside a
 * test file that mocks `parse` / `rowCells`, goes through those mocks.
 * Rope-count protocol: snapshot every counter BEFORE calling this.
 */
export function legacyCursorOracle(state: EditorState): CursorContext {
  const head = state.selection.main.head;
  if (isPositionInFencedCode(state, head)) return { span: null, cell: null };
  const text = state.doc.toString();
  const model = parseTableAtOffset(linesFromString(text), head);
  return {
    span: spanOfModel(splitLines(text), model),
    cell: model ? findCell(model, head) : null,
  };
}

// ---------------------------------------------------------------------------
// WI-6 additions (matrix CUR-3: `ropeProtoSpy`, `fieldWindow`).
// ---------------------------------------------------------------------------

export { fieldWindow, inFieldWindow } from "./fieldWindow";
import { fieldWindow as window6 } from "./fieldWindow";

export interface RopeProtoSpy {
  /**
   * Calls whose `this` is exactly `root` since creation or the last reset.
   * With `windowOnly`, only calls made while `fieldWindow` was open.
   */
  countsFor(root: Text, opts?: { windowOnly?: boolean }): RopeCounts;
  reset(): void;
  restore(): void;
}

/**
 * Passthrough `vi.spyOn` on the PROTOTYPE of `sample` for the seven rope
 * methods. This is how a NEW root `Text`, created by a `docChanged`
 * transaction, is counted: `countsFor(next.doc)` keeps only calls whose
 * `this` is that root, so recursive calls on children are excluded. Each
 * call also records whether `fieldWindow` was open.
 *
 * Follow the rope-count protocol, and `restore()` when done: the spy is
 * installed on a shared prototype.
 */
export function ropeProtoSpy(sample: Text): RopeProtoSpy {
  type Fn = (this: unknown, ...args: unknown[]) => unknown;
  const proto = Object.getPrototypeOf(sample) as Record<RopeMethod, Fn>;
  const entries = ROPE_METHODS.map((m) => {
    const original = proto[m];
    const windows: boolean[] = [];
    const spy = vi.spyOn(proto, m);
    spy.mockImplementation(function (this: unknown, ...args: unknown[]) {
      windows.push(window6.active);
      return original.apply(this, args);
    } as never);
    return { m, spy, windows };
  });
  return {
    countsFor(root, opts = {}) {
      const out = {} as RopeCounts;
      for (const { m, spy, windows } of entries) {
        let n = 0;
        spy.mock.contexts.forEach((ctx, i) => {
          if (ctx === root && (!opts.windowOnly || windows[i])) n += 1;
        });
        out[m] = n;
      }
      return out;
    },
    reset() {
      for (const { spy, windows } of entries) {
        spy.mockClear();
        windows.length = 0;
      }
    },
    restore() {
      for (const { spy } of entries) spy.mockRestore();
    },
  };
}
