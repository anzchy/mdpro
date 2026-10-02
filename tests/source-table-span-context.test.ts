/**
 * @module source-table-span-context.test
 * D12 WI-5 (ADR-0043 Decisions 1-3): the Source cursor field stores
 * `{ span, cell }`. `getTableContext` returns a `TableSpan` (no cells, no
 * rows, no raw), `getActiveTableCell` returns the cursor's cell, and the
 * cell highlight reads that cell instead of re-parsing.
 *
 * LAWS UNDER TEST
 *  - Oracle equivalence (M3): for every reachable state,
 *    `{ span: getTableContext(s), cell: getActiveTableCell(s) }` deep-equals
 *    `legacyCursorOracle(s)` — fence check, then the whole-document string
 *    parse projected onto the span, plus `findCell`.
 *  - Cost: cells built per selection transaction <= colCount, whatever R.
 *
 * Counters are PASSTHROUGH `vi.fn`s over the real `parseRowCells` and
 * `parseTableAtOffset`: nothing is replaced, and every count is paired with
 * an L1 assertion on the result. The oracle itself goes through the same
 * mocks, so every count is snapshotted before the oracle runs.
 *
 * `getActiveTableCell` is read through the module namespace and called only
 * when it is a function, so before WI-5 lands each case fails on an
 * assertion (the NOT_EXPORTED sentinel) instead of the file crashing.
 *
 * Matrix: `.claude/tdd-guardian/tests-20260930-D12.md` SPAN-1..SPAN-6
 * (SPAN-7 is the title edit in `tests/source-table-detection.test.ts`).
 */

import { isDeepStrictEqual } from "node:util";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";

import * as detection from "../src/plugins/codemirror/sourceTableDetection";
import {
  getTableContext,
  isPositionInFencedCode,
  tableDetectionExtension,
} from "../src/plugins/codemirror/sourceTableDetection";
import { computeCellHighlightDecorations } from "../src/plugins/codemirror/sourceTableCellHighlight";
import { tableTabCommand } from "../src/plugins/codemirror/sourceTableTabNav";
import { parseTableAtLine, parseTableAtOffset } from "../src/utils/tableParser/parse";
import { parseRowCells } from "../src/utils/tableParser/rowCells";
import type { TableCell } from "../src/utils/tableParser/types";
import { completeTreeState } from "./support/completeTreeState";
import { makeCorpus, makeOverlapCorpus, OVERLAP_SEED, SEED } from "./support/tableCorpus";
import {
  costDoc,
  D12_FIXTURES,
  FENCE_IN_SPAN,
  legacyCursorOracle,
} from "./support/tableSpanOracle";

// Passthrough counters over the REAL functions — observe, replace nothing.
vi.mock("../src/utils/tableParser/rowCells", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils/tableParser/rowCells")>();
  return { ...actual, parseRowCells: vi.fn(actual.parseRowCells) };
});
vi.mock("../src/utils/tableParser/parse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils/tableParser/parse")>();
  return {
    ...actual,
    parseTableAtOffset: vi.fn(actual.parseTableAtOffset),
    parseTableAtLine: vi.fn(actual.parseTableAtLine),
  };
});

const rowSpy = vi.mocked(parseRowCells);
const parseSpy = vi.mocked(parseTableAtOffset);
/** D41: Tab probes the head's real line, so SPAN-6 counts this entry point. */
const lineParseSpy = vi.mocked(parseTableAtLine);

const SPAN_CORPUS_COUNT = 60;
const DOMAIN_TIMEOUT_MS = 180_000;
const COST_ROWS = 2000;
/** `costDoc(R).start`: the header begins after "intro paragraph\n\n". */
const COST_TABLE_START = 17;
const COST_MOVES = 20;
const COST_ROW_STRIDE = 100;
const COST_COL_COUNT = 3;
const CELL_CLASS = "cm-table-active-cell";

const NOT_EXPORTED = "getActiveTableCell is not exported" as const;

/** `getActiveTableCell(state)`, or a sentinel while it does not exist. */
function activeCell(state: EditorState): TableCell | null | typeof NOT_EXPORTED {
  const fn = detection.getActiveTableCell;
  return typeof fn === "function" ? fn(state) : NOT_EXPORTED;
}

function makeState(doc: string, anchor: number): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor },
    extensions: [markdown(), tableDetectionExtension()],
  });
}

/** A fence opener that can put a table inside a code block. */
const FENCE_MARKER = /```|~~~/;

/**
 * `makeState` for a document that may contain a fence: the detection field
 * is created over a complete syntax tree, so the fence check cannot miss
 * under CPU load (see `tests/support/completeTreeState.ts`). Documents with
 * no fence keep the plain `EditorState.create` path.
 */
function makeFenceSafeState(doc: string, anchor: number): EditorState {
  if (!FENCE_MARKER.test(doc)) return makeState(doc, anchor);
  return completeTreeState(doc, { anchor }, markdown(), tableDetectionExtension());
}

beforeEach(() => {
  rowSpy.mockClear();
  parseSpy.mockClear();
});

const { P2, NEP, M1_NEP, T3, FENCED_TABLE } = D12_FIXTURES;

describe("D12 WI-5 — the field stores { span, cell }", () => {
  it(
    "SPAN-1: every-offset equivalence to the legacy oracle (corpora + fixtures)",
    () => {
      const fencePre = makeFenceSafeState(FENCE_IN_SPAN, 0);
      expect(isPositionInFencedCode(fencePre, 32)).toBe(true);
      expect(isPositionInFencedCode(fencePre, 2)).toBe(false);

      const docs: [string, string][] = [
        ...makeCorpus(SEED, SPAN_CORPUS_COUNT).map(
          (d): [string, string] => [`corpus#${d.index}`, d.source],
        ),
        ...makeOverlapCorpus(OVERLAP_SEED, SPAN_CORPUS_COUNT).map(
          (d): [string, string] => [`overlap#${d.index}`, d.source],
        ),
        // CRLF_LAST_CR is excluded: EditorState normalises its final `\r`.
        ...Object.entries(D12_FIXTURES).filter(([name]) => name !== "CRLF_LAST_CR"),
        ["FENCE_IN_SPAN", FENCE_IN_SPAN],
      ];

      const disagreements: { id: string; offset: number | "base"; got: unknown; want: unknown }[] = [];
      const stats = { states: 0, fencedNull: 0, nonNullSpan: 0, nonNullCell: 0 };
      const check = (id: string, offset: number | "base", s: EditorState) => {
        const got = { span: getTableContext(s), cell: activeCell(s) };
        const want = legacyCursorOracle(s);
        stats.states += 1;
        if (isPositionInFencedCode(s, s.selection.main.head)) stats.fencedNull += 1;
        if (want.span !== null) stats.nonNullSpan += 1;
        if (want.cell !== null) stats.nonNullCell += 1;
        if (!isDeepStrictEqual(got, want)) disagreements.push({ id, offset, got, want });
      };

      for (const [id, doc] of docs) {
        const base = makeFenceSafeState(doc, 0);
        check(id, "base", base);
        for (let o = 0; o <= base.doc.length; o += 1) {
          check(id, o, base.update({ selection: { anchor: o } }).state);
        }
        // The counters are not read here; drop their history per document.
        rowSpy.mockClear();
        parseSpy.mockClear();
      }

      expect(stats.fencedNull).toBeGreaterThanOrEqual(1);
      expect(stats.nonNullSpan).toBeGreaterThanOrEqual(1);
      expect(stats.nonNullCell).toBeGreaterThanOrEqual(1);
      expect({ count: disagreements.length, first: disagreements.slice(0, 2) }).toEqual({
        count: 0,
        first: [],
      });
    },
    DOMAIN_TIMEOUT_MS,
  );

  it("SPAN-2: cells built per selection move <= colCount on a 2,000-row table", () => {
    let state = makeState(costDoc(COST_ROWS), COST_TABLE_START + 3);
    const built: number[] = [];
    const cells: unknown[] = [];
    const expected: Partial<TableCell>[] = [];
    for (let m = 0; m < COST_MOVES; m += 1) {
      const k = COST_ROW_STRIDE * m;
      // Body row k is line index k+4, i.e. 1-based line number k+5.
      const head = state.doc.line(k + 5).from + `| r${k}c0 | `.length;
      rowSpy.mockClear();
      state = state.update({ selection: { anchor: head } }).state;
      // Snapshot the count before anything else reads the document.
      built.push(
        rowSpy.mock.results.reduce((n, r) => n + (r.value as TableCell[]).length, 0),
      );
      cells.push(activeCell(state));
      expected.push({ text: `r${k}c1`, row: k + 1, col: 1 });
    }
    expect(built).toEqual(Array(COST_MOVES).fill(COST_COL_COUNT));
    expect(cells).toMatchObject(expected);
  });

  it("SPAN-3: a span has no cells, rows or raw — at compile time and at runtime", () => {
    const s = makeState(P2, 22);
    expect(getTableContext(s)).not.toBeNull();
    // @ts-expect-error — TableSpan has no cells (ADR-0043 D1)
    void getTableContext(s)!.cells;
    // @ts-expect-error — TableSpan has no rows (ADR-0043 D1)
    void getTableContext(s)!.rows;
    // @ts-expect-error — TableSpan has no raw (ADR-0043 D1)
    void getTableContext(s)!.raw;
    expect("cells" in getTableContext(s)!).toBe(false);
  });

  it.each([
    ["(a) P2 body cell", P2, 22, [{ from: 21, to: 24, class: CELL_CLASS }]],
    ["(b) P2 delimiter", P2, 12, []],
    ["(c) prose", "Just prose.\n", 5, []],
    ["(d) fenced table", FENCED_TABLE, 26, []],
    ["(e) NEP col 0 of a body row (Finding 1)", NEP, 12, [{ from: 12, to: 14, class: CELL_CLASS }]],
    ["(f) M1_NEP col 0 of the header", M1_NEP, 5, []],
  ] as const)("SPAN-4 %s: at most one decoration, from the active cell, 0 parses", (_n, doc, head, want) => {
    const state = makeFenceSafeState(doc, head);
    parseSpy.mockClear();
    const set = computeCellHighlightDecorations(state);
    const parses = parseSpy.mock.calls.length;

    const got: { from: number; to: number; class: unknown }[] = [];
    set.between(0, state.doc.length, (from, to, value) => {
      got.push({ from, to, class: value.spec.class });
    });
    expect(parses).toBe(0);
    expect(set.size).toBe(want.length);
    expect(got).toEqual(want);
  });

  it("SPAN-5: with no detection field both readers return null", () => {
    const s = EditorState.create({ doc: T3, selection: { anchor: 2 } });
    expect(getTableContext(s)).toBeNull();
    expect(activeCell(s)).toBeNull();
  });

  it("SPAN-6: Tab makes exactly one parse per press (the field no longer parses)", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: T3,
        selection: EditorSelection.cursor(2),
        extensions: [markdown(), tableDetectionExtension()],
      }),
    });
    const presses = Array.from({ length: 9 }, () => {
      lineParseSpy.mockClear();
      const handled = tableTabCommand(view);
      const parses = lineParseSpy.mock.calls.length;
      return { handled, parses, head: view.state.selection.main.head };
    });
    expect(presses.map((p) => p.parses)).toEqual(Array(9).fill(1));
    expect(presses.map((p) => p.handled)).toEqual(Array(9).fill(true));
    expect(presses.map((p) => p.head)).toEqual([5, 9, 29, 33, 37, 43, 47, 51, 58]);
    expect(view.state.doc.toString()).toBe(T3 + "|  |  |  |\n"); // D41 defect (b)
    view.destroy();
  });
});
