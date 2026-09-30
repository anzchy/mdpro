/**
 * @module source-table-relocate-cost.test
 * D12 WI-6 (ADR-0043): the re-locate path's cost. Entering the table (a
 * selection-only move E) and typing in a cell (a `docChanged` transaction
 * T) each re-locate exactly once, build exactly one row, and never flatten
 * the rope: root `toString`, `sliceString` and `iterLines` are 0, whatever
 * R. `line` counts (the O(R) walk) are observed, not bounded — typing is
 * not fixed by ADR-0043.
 *
 * Two configurations: (i) detection only, where every root read is the
 * field's; (ii) with `markdown()`, counted through `fieldWindow` so lezer's
 * `DocInput.read` is excluded. T creates a NEW root `Text`, so rope counts
 * come from `ropeProtoSpy(...).countsFor(next.doc)`.
 *
 * Rope-count protocol: reset -> dispatch -> snapshot -> assert -> oracle.
 *
 * Matrix: `.claude/tdd-guardian/tests-20260930-D12.md` CUR-3.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState, type Extension, type TransactionSpec } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";

import {
  getActiveTableCell,
  getTableContext,
  tableDetectionExtension,
} from "../src/plugins/codemirror/sourceTableDetection";
import { locateTableAtOffset } from "../src/utils/tableParser/locate";
import { parseRowCells } from "../src/utils/tableParser/rowCells";
import type { TableCell } from "../src/utils/tableParser/types";
import { costDoc, legacyCursorOracle, ropeProtoSpy, type RopeCounts } from "./support/tableSpanOracle";

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
const rowSpy = vi.mocked(parseRowCells);

const SIZES = [2_000, 50_000] as const;
const COL_COUNT = 3;
/** `costDoc(R).start`: the header begins after "intro paragraph\n\n". */
const TABLE_START = 17;
/** Interior of the `h1` header cell. */
const H1_HEAD = TABLE_START + "| h0 | h".length;
const COST_TIMEOUT_MS = 120_000;

let restoreLater: (() => void)[] = [];
afterEach(() => {
  for (const r of restoreLater) r();
  restoreLater = [];
});

function clearSpies(): void {
  locateSpy.mockClear();
  rowSpy.mockClear();
}

function makeState(doc: string, anchor: number, extensions: Extension[]): EditorState {
  return EditorState.create({ doc, selection: { anchor }, extensions });
}

function field(s: EditorState) {
  return { span: getTableContext(s), cell: getActiveTableCell(s) };
}

interface Relocate {
  locate: number;
  rowCalls: number;
  rowLen: number | undefined;
  roots: Pick<RopeCounts, "toString" | "sliceString" | "iterLines">;
  /** Non-vacuity: the (windowed) spy saw the walker's `line` reads. */
  linesSeen: boolean;
}

const CONFIGS = [
  ["(i) detection only, unfiltered", false],
  ["(ii) markdown + detection, fieldWindow", true],
] as const;

/** Reset -> dispatch -> snapshot over the prototype spy, for one transaction. */
function countedRelocate(
  state: EditorState,
  spec: TransactionSpec,
  windowOnly: boolean,
) {
  const proto = ropeProtoSpy(state.doc);
  restoreLater.push(() => proto.restore());
  proto.reset();
  clearSpies();
  const next = state.update(spec).state;
  const c = proto.countsFor(next.doc, { windowOnly });
  const snap: Relocate = {
    locate: locateSpy.mock.calls.length,
    rowCalls: rowSpy.mock.calls.length,
    rowLen: (rowSpy.mock.results[0]?.value as TableCell[] | undefined)?.length,
    roots: { toString: c.toString, sliceString: c.sliceString, iterLines: c.iterLines },
    linesSeen: c.line > 0,
  };
  proto.restore();
  return { next, snap };
}

const RELOCATE_SNAPSHOT: Relocate = {
  locate: 1,
  rowCalls: 1,
  rowLen: COL_COUNT,
  roots: { toString: 0, sliceString: 0, iterLines: 0 },
  linesSeen: true,
};

describe("D12 WI-6 — CUR-3 re-locate path cost", () => {
  for (const [label, withMarkdown] of CONFIGS) {
    it.each(SIZES)(`CUR-3 ${label} R=%i: move E and typing T each re-locate once`, (R) => {
      const ext = withMarkdown ? [markdown(), tableDetectionExtension()] : [tableDetectionExtension()];

      // Move E: from the intro paragraph into the h1 header cell.
      const e = countedRelocate(makeState(costDoc(R), 0, ext), { selection: { anchor: H1_HEAD } }, withMarkdown);
      expect(e.snap).toEqual(RELOCATE_SNAPSHOT);
      expect(field(e.next).cell).toMatchObject({ text: "h1", row: 0, col: 1 });
      expect(field(e.next)).toEqual(legacyCursorOracle(e.next));

      // Typing T: one character inserted in cell 1 of body row R/2.
      const k = R / 2;
      const text = costDoc(R);
      const p = text.indexOf(`r${k}c1 |`);
      const before = makeState(text, p + 1, ext);
      const preEnd = before.doc.line(R + 4).to;
      const t = countedRelocate(
        before,
        { changes: { from: p, insert: "x" }, selection: { anchor: p + 1 } },
        withMarkdown,
      );
      expect(t.snap).toEqual(RELOCATE_SNAPSHOT);
      const got = field(t.next);
      expect(got.cell).toMatchObject({ text: `xr${k}c1`, row: k + 1, col: 1 });
      expect(got.span).toMatchObject({ lastLine: R + 3, end: preEnd + 1 });
      expect(got).toEqual(legacyCursorOracle(t.next));
    }, COST_TIMEOUT_MS);
  }
});
