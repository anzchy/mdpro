/**
 * @module source-table-span-reuse-guards.test
 * D12 WI-6 (ADR-0043 Decision 4): the reuse guard's boundaries. Each case
 * names the mutant it kills: the adjusted owning row (M1), off-by-one span
 * bounds, reuse before the fence check, ignoring `delimiterIsCandidate`,
 * reusing on `docChanged`, and keying on `anchor` instead of `head`.
 *
 * Every locate count (passthrough) is snapshotted before the oracle runs,
 * and every state is also compared with `legacyCursorOracle`.
 *
 * Matrix: `.claude/tdd-guardian/tests-20260930-D12.md` REUSE-3..REUSE-6.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";

import {
  getActiveTableCell,
  getTableContext,
  isPositionInFencedCode,
  tableDetectionExtension,
} from "../src/plugins/codemirror/sourceTableDetection";
import {
  tableShiftTabCommand,
  tableTabCommand,
} from "../src/plugins/codemirror/sourceTableTabNav";
import { locateTableAtOffset } from "../src/utils/tableParser/locate";
import { linesFromText } from "../src/plugins/codemirror/textLineSource";
import type { TableSpan } from "../src/utils/tableParser/types";
import { completeTreeState } from "./support/completeTreeState";
import { D12_FIXTURES, FENCE_IN_SPAN, legacyCursorOracle } from "./support/tableSpanOracle";

vi.mock("../src/utils/tableParser/locate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils/tableParser/locate")>();
  return { ...actual, locateTableAtOffset: vi.fn(actual.locateTableAtOffset) };
});

const locateSpy = vi.mocked(locateTableAtOffset);

beforeEach(() => {
  locateSpy.mockClear();
});

const { NEP, M1_NEP, M1_PIPED, M1_BLANK, AFTER_TAIL, T3, PIPELESS, PIPELESS_CHAIN, P2, INTRO_TABLE, FENCED_TABLE } =
  D12_FIXTURES;
const LANGUAGE = markdown();
const DETECTION = tableDetectionExtension();

/**
 * The field is created over a COMPLETE syntax tree, so fence-dependent
 * cases cannot flake when the create-time parse runs out of time under
 * load (see `tests/support/completeTreeState.ts`).
 */
function makeState(doc: string, anchor: number, head = anchor): EditorState {
  return completeTreeState(doc, { anchor, head }, LANGUAGE, DETECTION);
}

function field(s: EditorState) {
  return { span: getTableContext(s), cell: getActiveTableCell(s) };
}

/** Dispatch, then snapshot the locate count BEFORE the oracle runs. */
function step(s: EditorState, spec: TransactionSpec) {
  locateSpy.mockClear();
  const next = s.update(spec).state;
  const locate = locateSpy.mock.calls.length;
  const got = field(next);
  return { next, locate, got, want: legacyCursorOracle(next) };
}

/** Chain a cursor move from `from` (which must be in a table) to `to`. */
function move(doc: string, from: number, to: number) {
  const prev = makeState(doc, from);
  expect(getTableContext(prev)).not.toBeNull();
  return step(prev, { selection: { anchor: to } });
}

/** Run a Tab command on a view built from `s`; report what it did. */
function press(s: EditorState, cmd: typeof tableTabCommand) {
  const view = new EditorView({ state: s });
  try {
    const before = view.state.doc;
    const handled = cmd(view);
    const { anchor, head } = view.state.selection.main;
    return { handled, docSame: view.state.doc === before, anchor, head };
  } finally {
    view.destroy();
  }
}

const span = (o: Partial<TableSpan> & Pick<TableSpan, "start" | "end" | "headerLine" | "lastLine" | "rowCount" | "colCount">): TableSpan => ({
  alignments: Array(o.colCount).fill(null),
  delimiterIsCandidate: true,
  ...o,
});
const P2_SPAN = span({ start: 0, end: 29, headerLine: 0, lastLine: 2, rowCount: 2, colCount: 2 });
const body = (doc: string) => doc.indexOf("| 1") + 2;

describe("D12 WI-6 — REUSE-3 M1 mutant killers: body row -> header col 0", () => {
  it.each([
    ["(a) M1_NEP 18 -> 5", M1_NEP, 18, 5, 8],
    ["(b) M1_PIPED body -> 5", M1_PIPED, body(M1_PIPED), 5, 6],
    ["(c) M1_BLANK body -> 6", M1_BLANK, body(M1_BLANK), 6, 7],
  ] as const)("REUSE-3 %s: field null and re-located; Tab gates on the real line and navigates (D41)", (_n, doc, from, to, tabHead) => {
    const r = move(doc, from, to);
    expect(r.got).toEqual({ span: null, cell: null });
    expect(r.got).toEqual(r.want);
    expect(r.locate).toBe(1);
    expect(press(r.next, tableTabCommand)).toMatchObject({ handled: true, docSame: true, head: tabHead });
  });

  it("REUSE-3 (d) M1_LINE0 = NEP 18 -> 0: a legitimate reuse", () => {
    const r = move(NEP, 18, 0);
    expect(r.got).toEqual({
      span: span({ start: 0, end: 23, headerLine: 0, lastLine: 3, rowCount: 3, colCount: 2 }),
      cell: { start: 0, end: 2, text: "a", row: 0, col: 0 },
    });
    expect(r.got).toEqual(r.want);
    expect(r.locate).toBe(0);
  });
});

describe("D12 WI-6 — REUSE-4 reuse-guard boundaries", () => {
  it("(a) M1_PIPED -> 2 (headerLine-1) and (b) AFTER_TAIL -> 32 (lastLine+1): null, re-located", () => {
    for (const r of [move(M1_PIPED, body(M1_PIPED), 2), move(AFTER_TAIL, 22, 32)]) {
      expect(r.got).toEqual({ span: null, cell: null });
      expect(r.got).toEqual(r.want);
      expect(r.locate).toBe(1);
    }
  });

  it("(c) AFTER_TAIL -> 30 (lastLine.end+1): span kept, cell null, no re-locate", () => {
    const r = move(AFTER_TAIL, 22, 30);
    expect(r.got).toEqual({ span: P2_SPAN, cell: null });
    expect(r.got).toEqual(r.want);
    expect(r.locate).toBe(0);
  });

  it("(d) T3 body -> 2 (header) and body -> 52 (last row): non-null, no re-locate", () => {
    const t3 = span({ start: 0, end: 55, headerLine: 0, lastLine: 3, rowCount: 3, colCount: 3 });
    const results = [move(T3, 30, 2), move(T3, 30, 52)];
    expect(results.map((r) => r.got)).toMatchObject([
      { span: t3, cell: { text: "a", row: 0, col: 0 } },
      { span: t3, cell: { text: "i", row: 2, col: 2 } },
    ]);
    expect(results.map((r) => r.got)).toEqual(results.map((r) => r.want));
    expect(results.map((r) => r.locate)).toEqual([0, 0]);
  });

  it("(e) FENCE_IN_SPAN 2 -> 32: the raw line is in the span but fenced -> null", () => {
    const r = move(FENCE_IN_SPAN, 2, 32);
    expect(isPositionInFencedCode(r.next, 32)).toBe(true);
    expect(r.got).toEqual({ span: null, cell: null });
    expect(r.got).toEqual(r.want);
  });

  it("(f) PIPELESS 2 -> 12: a pipe-less delimiter always re-locates -> null", () => {
    const r = move(PIPELESS, 2, 12);
    expect(r.got).toEqual({ span: null, cell: null });
    expect(r.got).toEqual(r.want);
    expect(r.locate).toBe(1);
  });

  it("(g) PIPELESS_CHAIN 2 -> 12: re-locates onto the second table", () => {
    const r = move(PIPELESS_CHAIN, 2, 12);
    expect(r.got).toEqual({
      span: { start: 10, end: 25, headerLine: 2, lastLine: 4, rowCount: 2, colCount: 1, alignments: ["center"], delimiterIsCandidate: false },
      cell: { start: 11, end: 14, text: "b", row: 0, col: 0 },
    });
    expect(r.got).toEqual(r.want);
    expect(r.locate).toBe(1);
  });
});

describe("D12 WI-6 — REUSE-5 docChanged always re-locates and runs the fence check", () => {
  it.each([
    ["(a) insert a row", P2, 22, { changes: { from: 29, insert: "\n| 3 | 4 |" }, selection: { anchor: 22 } }, { span: { lastLine: 3, rowCount: 3 } }],
    ["(b) delete the delimiter", P2, 22, { changes: { from: 10, to: 20 }, selection: { anchor: 12 } }, { span: null }],
    ["(c) pipe below the table", `${P2}plain\n`, 22, { changes: { from: 30, insert: "|" }, selection: { anchor: 22 } }, { span: { lastLine: 3, end: 36 } }],
    ["(d) type in the cell", P2, 22, { changes: { from: 22, insert: "x" }, selection: { anchor: 23 } }, { span: { end: 30 }, cell: { start: 21, end: 25, text: "x1", row: 1, col: 0 } }],
  ] as const)("REUSE-5 %s: one re-locate, equal to the oracle", (_n, doc, at, spec, want) => {
    const r = step(makeState(doc, at), spec as TransactionSpec);
    expect(r.locate).toBe(1);
    expect(r.got).toMatchObject(want);
    expect(r.got).toEqual(r.want);
  });

  it("REUSE-5 (e) an edit above the table with NO selection key re-locates", () => {
    const r = step(makeState(INTRO_TABLE, 29), { changes: { from: 0, insert: "x\n" } });
    expect(r.next.selection.main.head).toBe(31);
    expect(r.locate).toBe(1);
    expect(r.got).toEqual({
      span: span({ start: 9, end: 38, headerLine: 3, lastLine: 5, rowCount: 2, colCount: 2 }),
      cell: { start: 30, end: 33, text: "1", row: 1, col: 0 },
    });
    expect(r.got).toEqual(r.want);
  });

  it.each([
    ["(f1) typing inside a fenced table", FENCED_TABLE, 26, { changes: { from: 26, insert: "x" }, selection: { anchor: 27 } }, 27],
    ["(f2) a fence opened above a live table", P2, 22, { changes: { from: 0, insert: "```\n" } }, 26],
  ] as const)("REUSE-5 %s: null, and Tab / Shift-Tab fall through", (_n, doc, at, spec, headAfter) => {
    const r = step(makeState(doc, at), spec as TransactionSpec);
    // Preconditions: fenced, and the unfenced walk WOULD find a table.
    expect(r.next.selection.main.head).toBe(headAfter);
    expect(isPositionInFencedCode(r.next, headAfter)).toBe(true);
    expect(locateTableAtOffset(linesFromText(r.next.doc), headAfter)).not.toBeNull();
    expect(r.locate).toBeLessThanOrEqual(1);

    expect(r.got).toEqual({ span: null, cell: null });
    expect(r.got).toEqual(r.want);
    const text = r.next.doc.toString();
    for (const cmd of [tableTabCommand, tableShiftTabCommand]) {
      expect(press(r.next, cmd)).toEqual({ handled: false, docSame: true, anchor: headAfter, head: headAfter });
    }
    expect(r.next.doc.toString()).toBe(text);
  });
});

describe("D12 WI-6 — REUSE-6 range selections use head, never anchor/from", () => {
  const fromZero = (doc: string, anchor: number, head: number) =>
    step(makeState(doc, 0), { selection: { anchor, head } });

  it("(a) AFTER_TAIL {anchor:22, head:32}: null, Tab swallows (D41 mixed-selection)", () => {
    const r = fromZero(AFTER_TAIL, 22, 32);
    expect(r.got).toEqual({ span: null, cell: null });
    expect(r.got).toEqual(r.want);
    expect(press(r.next, tableTabCommand)).toEqual({ handled: true, docSame: true, anchor: 22, head: 32 });
  });

  it("(b) AFTER_TAIL {anchor:32, head:22}: the head's cell; Tab swallows (D41 mixed-selection)", () => {
    const r = fromZero(AFTER_TAIL, 32, 22);
    expect(r.got).toEqual({ span: P2_SPAN, cell: { start: 21, end: 24, text: "1", row: 1, col: 0 } });
    expect(r.got).toEqual(r.want);
    expect(press(r.next, tableTabCommand)).toEqual({ handled: true, docSame: true, anchor: 32, head: 22 });
  });

  it("(c) T3 {anchor:2, head:52}: cell i", () => {
    const r = fromZero(T3, 2, 52);
    expect(r.got).toEqual({
      span: span({ start: 0, end: 55, headerLine: 0, lastLine: 3, rowCount: 3, colCount: 3 }),
      cell: { start: 51, end: 54, text: "i", row: 2, col: 2 },
    });
    expect(r.got).toEqual(r.want);
  });

  it("(d) chained shift-extend from (b): head 30 then head 25, both reused", () => {
    const b = fromZero(AFTER_TAIL, 32, 22);
    const s1 = step(b.next, { selection: { anchor: 32, head: 30 } });
    const s2 = step(s1.next, { selection: { anchor: 32, head: 25 } });
    expect(s1.got).toEqual({ span: P2_SPAN, cell: null });
    expect(s2.got).toEqual({ span: P2_SPAN, cell: { start: 25, end: 28, text: "2", row: 1, col: 1 } });
    expect([s1.got, s2.got]).toEqual([s1.want, s2.want]);
    expect([s1.locate, s2.locate]).toEqual([0, 0]);
  });
});
