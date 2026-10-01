/**
 * @module source-table-cursor-cost.test
 * D12 WI-6 (ADR-0043 Decision 4): the Source cursor field reuses its span
 * on a selection-only transaction whose RAW `lineIndexAt(head)` stays in
 * the span, so a reused move costs a constant number of rope reads.
 *
 * LAWS UNDER TEST (matrix CUR-1..CUR-4)
 *  - Cost invariance: rope reads per reused move are exactly
 *    `ROPE_READS_PER_REUSED_MOVE`, whatever R; every other root read is 0.
 *  - Re-locate cost: entering the table or typing builds one row and never
 *    flattens the rope.
 *
 * Rope-count protocol: reset -> dispatch -> snapshot -> assert counts ->
 * oracle / L1. `legacyCursorOracle` calls `toString()` on the watched root,
 * so every count is snapshotted before it runs. All spies are PASSTHROUGH.
 *
 * Matrix: `.claude/tdd-guardian/tests-20260930-D12.md` CUR-1, CUR-2, CUR-4.
 * CUR-3 (the re-locate path) is in `source-table-relocate-cost.test.ts`.
 */

import { describe, expect, it, vi } from "vitest";
import { EditorState, type Extension, type Text } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";

import {
  getActiveTableCell,
  getTableContext,
  tableDetectionExtension,
} from "../src/plugins/codemirror/sourceTableDetection";
import {
  cellAtOffset,
  cellAtResolvedLine,
  locateTableAtOffset,
} from "../src/utils/tableParser/locate";
import { parseRowCells } from "../src/utils/tableParser/rowCells";
import { linesFromText } from "../src/plugins/codemirror/textLineSource";
import type { TableCell, TableSpan } from "../src/utils/tableParser/types";
import {
  costDoc,
  legacyCursorOracle,
  ropeSpy,
  type RopeCounts,
} from "./support/tableSpanOracle";

vi.mock("../src/utils/tableParser/locate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils/tableParser/locate")>();
  const { inFieldWindow } = await import("./support/fieldWindow");
  return {
    ...actual,
    locateTableAtOffset: vi.fn(inFieldWindow(actual.locateTableAtOffset)),
    cellAtOffset: vi.fn(inFieldWindow(actual.cellAtOffset)),
    cellAtResolvedLine: vi.fn(inFieldWindow(actual.cellAtResolvedLine)),
  };
});
vi.mock("../src/utils/tableParser/rowCells", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils/tableParser/rowCells")>();
  return { ...actual, parseRowCells: vi.fn(actual.parseRowCells) };
});

const locateSpy = vi.mocked(locateTableAtOffset);
const wrapperSpy = vi.mocked(cellAtOffset);
const resolvedSpy = vi.mocked(cellAtResolvedLine);
const rowSpy = vi.mocked(parseRowCells);

/** K = 3 (matrix "Orchestrator decision"): reuse check + owner line. */
const ROPE_READS_PER_REUSED_MOVE = { lineAt: 1, line: 2 } as const;
const REUSED_VECTOR: RopeCounts = {
  line: ROPE_READS_PER_REUSED_MOVE.line,
  lineAt: ROPE_READS_PER_REUSED_MOVE.lineAt,
  iterLines: 0,
  sliceString: 0,
  toString: 0,
  iter: 0,
  iterRange: 0,
};
const SIZES = [2_000, 50_000] as const;
const REUSED_MOVES = 20;
const COL_COUNT = 3;
const HEADER_LINE = 2;
const TABLE_START = 17;
const COST_TIMEOUT_MS = 120_000;

function clearSpies(): void {
  locateSpy.mockClear();
  wrapperSpy.mockClear();
  resolvedSpy.mockClear();
  rowSpy.mockClear();
}

function makeState(doc: string, anchor: number, extensions: Extension[]): EditorState {
  return EditorState.create({ doc, selection: { anchor }, extensions });
}

/** Interior of cell `col` of body row `k` (line index k+4, number k+5). */
function bodyHead(doc: Text, k: number, col: number): number {
  const line = doc.line(k + 5);
  return line.from + line.text.indexOf(`r${k}c${col}`) + 1;
}

/** Interior of the `h1` header cell. */
const H1_HEAD = TABLE_START + "| h0 | h".length;

function costSpan(rows: number, end: number): TableSpan {
  return {
    start: TABLE_START,
    end,
    headerLine: HEADER_LINE,
    lastLine: rows + 3,
    rowCount: rows + 1,
    colCount: COL_COUNT,
    alignments: [null, null, null],
    delimiterIsCandidate: true,
  };
}

function field(s: EditorState): { span: TableSpan | null; cell: TableCell | null } {
  return { span: getTableContext(s), cell: getActiveTableCell(s) };
}

interface Move {
  counts: RopeCounts;
  locate: number;
  resolved: number;
  wrapper: number;
  rowCalls: number;
  rowLens: number[];
  sameDoc: boolean;
  got: ReturnType<typeof field>;
  want: ReturnType<typeof field>;
}

/** Reset -> dispatch -> snapshot -> oracle, for one selection move. */
function countedMove(state: EditorState, rope: ReturnType<typeof ropeSpy>, head: number) {
  rope.reset();
  clearSpies();
  const next = state.update({ selection: { anchor: head } }).state;
  const move: Omit<Move, "got" | "want"> = {
    counts: rope.counts(),
    locate: locateSpy.mock.calls.length,
    resolved: resolvedSpy.mock.calls.length,
    wrapper: wrapperSpy.mock.calls.length,
    rowCalls: rowSpy.mock.calls.length,
    rowLens: rowSpy.mock.results.map((r) => (r.value as TableCell[]).length),
    sameDoc: next.doc === state.doc,
  };
  const result: Move = { ...move, got: field(next), want: legacyCursorOracle(next) };
  rope.reset();
  return { next, move: result };
}

interface Cur1Run {
  entry: Move;
  moves: Move[];
  rows: number[];
  exit: Move;
  end: number;
}

const cur1Runs = new Map<number, Cur1Run>();

/** CUR-1/CUR-2 walk: entry E, 20 reused moves, exit X. Memoised per R. */
function cur1(R: number): Cur1Run {
  const hit = cur1Runs.get(R);
  if (hit) return hit;
  let state = makeState(costDoc(R), 0, [markdown(), tableDetectionExtension()]);
  const end = state.doc.line(R + 4).to;
  const rows = Array.from({ length: REUSED_MOVES }, (_, i) =>
    Math.floor(((i + 1) * (R - 1)) / REUSED_MOVES),
  );
  const heads = rows.map((k) => bodyHead(state.doc, k, 1));
  const outro = state.doc.toString().indexOf("outro") + 2;

  const rope = ropeSpy(state.doc);
  try {
    const e = countedMove(state, rope, H1_HEAD);
    state = e.next;
    const moves: Move[] = [];
    for (const head of heads) {
      const m = countedMove(state, rope, head);
      state = m.next;
      moves.push(m.move);
    }
    const x = countedMove(state, rope, outro);
    const run = { entry: e.move, moves, rows, exit: x.move, end };
    cur1Runs.set(R, run);
    return run;
  } finally {
    rope.restore();
  }
}

describe("D12 WI-6 — CUR-1/CUR-2 reused moves on costDoc(R)", () => {
  it.each(SIZES)(
    "CUR-1 R=%i: every reused move reads the rope exactly {lineAt:1, line:2}",
    (R) => {
      const run = cur1(R);
      // L1 first: the entry, the reused cells and the exit are right.
      expect(run.entry.locate).toBe(1);
      expect(run.entry.got.cell).toMatchObject({ text: "h1", row: 0, col: 1 });
      expect(run.moves.map((m) => m.sameDoc)).toEqual(Array(REUSED_MOVES).fill(true));
      expect(run.moves.map((m) => m.got.cell)).toMatchObject(
        run.rows.map((k) => ({ text: `r${k}c1`, row: k + 1, col: 1 })),
      );
      expect(run.moves.map((m) => m.got.span)).toEqual(
        Array(REUSED_MOVES).fill(costSpan(R, run.end)),
      );
      expect(run.moves.map((m) => m.got)).toEqual(run.moves.map((m) => m.want));
      expect(run.exit.locate).toBe(1);
      expect(run.exit.got).toEqual({ span: null, cell: null });
      expect(run.exit.want).toEqual({ span: null, cell: null });

      // L4: the reuse path, per move and in total.
      const totals = run.moves.reduce(
        (t, m) => ({ lineAt: t.lineAt + m.counts.lineAt, line: t.line + m.counts.line }),
        { lineAt: 0, line: 0 },
      );
      const measured = `measured: first move ${JSON.stringify(run.moves[0].counts)}, 20-move totals ${JSON.stringify(totals)}`;
      expect(run.moves.map((m) => m.counts), measured).toEqual(
        Array(REUSED_MOVES).fill(REUSED_VECTOR),
      );
      expect(run.moves.map((m) => ({ locate: m.locate, resolved: m.resolved, wrapper: m.wrapper }))).toEqual(
        Array(REUSED_MOVES).fill({ locate: 0, resolved: 1, wrapper: 0 }),
      );
      expect(totals).toEqual({
        lineAt: ROPE_READS_PER_REUSED_MOVE.lineAt * REUSED_MOVES,
        line: ROPE_READS_PER_REUSED_MOVE.line * REUSED_MOVES,
      });
    },
    COST_TIMEOUT_MS,
  );

  it("CUR-1: the per-move count vectors are equal at R=2,000 and R=50,000", () => {
    const [small, large] = SIZES.map((R) => cur1(R).moves.map((m) => m.counts));
    expect(small).toEqual(large);
  }, COST_TIMEOUT_MS);

  it.each(SIZES)(
    "CUR-2 R=%i: each reused move builds exactly one row of colCount cells",
    (R) => {
      const run = cur1(R);
      expect(run.moves.map((m) => m.rowCalls)).toEqual(Array(REUSED_MOVES).fill(1));
      expect(run.moves.map((m) => m.rowLens)).toEqual(Array(REUSED_MOVES).fill([COL_COUNT]));
    },
    COST_TIMEOUT_MS,
  );
});

interface Cur4Run {
  move: Move;
  prevSpan: ReturnType<typeof getTableContext>;
}

const cur4Runs = new Map<number, Cur4Run>();

/**
 * CUR-4 walk: entry, the row above, then col 0 of body row R/2 (the
 * fudge). Memoised per R like `cur1`, so every test computes what it reads.
 */
function cur4(R: number): Cur4Run {
  const hit = cur4Runs.get(R);
  if (hit) return hit;
  let state = makeState(costDoc(R), 0, [markdown(), tableDetectionExtension()]);
  const k = R / 2;
  const target = state.doc.line(k + 5).from;
  // Precondition, before any spy: the raw index is the row above.
  expect(linesFromText(state.doc).lineIndexAt(target)).toBe(k + 3);
  const aboveHead = bodyHead(state.doc, k - 1, 1);

  const rope = ropeSpy(state.doc);
  try {
    state = countedMove(state, rope, H1_HEAD).next;
    state = countedMove(state, rope, aboveHead).next;
    const prevSpan = getTableContext(state);
    const { move } = countedMove(state, rope, target);
    const run = { move, prevSpan };
    cur4Runs.set(R, run);
    return run;
  } finally {
    rope.restore();
  }
}

describe("D12 WI-6 — CUR-4 reused move to col 0 of a body row (fudge path)", () => {
  it.each(SIZES)("CUR-4 R=%i: {lineAt:1, line:2}, no re-locate, cell null", (R) => {
    const { move, prevSpan } = cur4(R);
    expect(prevSpan).not.toBeNull();
    // L1 first.
    expect(move.sameDoc).toBe(true);
    expect(move.got).toEqual({ span: prevSpan, cell: null });
    expect(move.got).toEqual(move.want);
    // L4: the reuse path through the fudge.
    expect(move.counts).toEqual(REUSED_VECTOR);
    expect({ locate: move.locate, resolved: move.resolved }).toEqual({ locate: 0, resolved: 1 });
  }, COST_TIMEOUT_MS);

  it("CUR-4: the count vector is equal at both R", () => {
    const [small, large] = SIZES.map((R) => cur4(R).move.counts);
    expect(small).toBeDefined();
    expect(small).toEqual(large);
  }, COST_TIMEOUT_MS);
});
