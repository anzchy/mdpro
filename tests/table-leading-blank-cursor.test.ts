/**
 * @module table-leading-blank-cursor.test
 * D41 WI-1 consumers that resolve a cell at a source offset: the mode-toggle
 * cursor sync (`cursorSync/table.ts`), the Source context menu
 * (`sourceTableContextMenu.ts`) and the active-cell field + highlight
 * (`sourceTableDetection.ts` → `sourceTableCellHighlight.ts`).
 *
 * On af51749 `| | x |` parses with x in column 0 and a zero-width ghost cell
 * after the trailing pipe, so a caret in the blank cell resolves to nothing and
 * a caret on x resolves to column 0.
 *
 * LAW (C1-SYNC-RT, round-trip):
 *  - capture(locate(p)) == p for every (row, col) in each table;
 *  - locate(capture(o)) == start of the cell containing o for every offset o in
 *    a non-zero-width cell `[start, end)`.
 * Cell intervals are hand-written from the fixture strings, not computed by the
 * parser under test. Zero-width cells are excluded (`findCell` stays
 * half-open; plan Risks) — after the fix none of these fixtures has one.
 *
 * Matrix: `.claude/tdd-guardian/tests-20261002-D41.md` cases C1-SYNC-LEAD,
 * C1-SYNC-RT, C1-CTX-LEAD, C1-HL-LEAD. Real `EditorState`/`EditorView`; no mocks.
 */

import { afterEach, describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { captureCellFromSource, locateCellInSource } from "../src/utils/cursorSync/table";
import {
  computeSourceTableContext,
  dispatchSourceTableAction,
} from "../src/plugins/codemirror/sourceTableContextMenu";
import {
  getActiveTableCell,
  tableDetectionExtension,
} from "../src/plugins/codemirror/sourceTableDetection";
import { computeCellHighlightDecorations } from "../src/plugins/codemirror/sourceTableCellHighlight";
import { parseTableAt } from "../src/utils/tableParser";

const T3 = "| a | b | c |\n| - | - | - |\n| d | e | f |\n| g | h | i |\n";
const T3A = T3 + "|  |  |  |\n";
const P2 = "| a | b |\n| - | - |\n| 1 | 2 |\n";
const NOPAD = "|a|b|\n|-|-|\n|c|d|\n";
const LEAD = "| h1 | h2 |\n| - | - |\n| | x |\n";

type Interval = readonly [number, number];
const T3_ROWS: Interval[][] = [
  [[1, 4], [5, 8], [9, 12]],
  [[29, 32], [33, 36], [37, 40]],
  [[43, 46], [47, 50], [51, 54]],
];
/** Hand-written `[start, end)` cell intervals per table row (header first). */
const FIXTURES: Array<{ name: string; doc: string; rows: Interval[][] }> = [
  { name: "LEAD", doc: LEAD, rows: [[[1, 5], [6, 10]], [[23, 24], [25, 28]]] },
  { name: "T3", doc: T3, rows: T3_ROWS },
  { name: "T3A", doc: T3A, rows: [...T3_ROWS, [[57, 59], [60, 62], [63, 65]]] },
  { name: "P2", doc: P2, rows: [[[1, 4], [5, 8]], [[21, 24], [25, 28]]] },
  { name: "NOPAD", doc: NOPAD, rows: [[[1, 2], [3, 4]], [[13, 14], [15, 16]]] },
];

const views: EditorView[] = [];
function viewOn(doc: string, head: number, withDetection: boolean): EditorView {
  const extensions = withDetection ? [markdown(), tableDetectionExtension()] : [markdown()];
  const view = new EditorView({
    state: EditorState.create({ doc, selection: EditorSelection.cursor(head), extensions }),
  });
  views.push(view);
  return view;
}

afterEach(() => {
  while (views.length > 0) views.pop()!.destroy();
});

describe("C1-SYNC-LEAD capture/locate on the blank leading cell", () => {
  it("capture(23) is (0,1,0), capture(26) is (0,1,1), locate((0,1,1)) is 25", () => {
    expect(captureCellFromSource(LEAD, 23)).toEqual({ tableIndex: 0, rowIndex: 1, colIndex: 0 });
    expect(captureCellFromSource(LEAD, 26)).toEqual({ tableIndex: 0, rowIndex: 1, colIndex: 1 });
    expect(locateCellInSource(LEAD, { tableIndex: 0, rowIndex: 1, colIndex: 1 })).toBe(25);
  });
});

describe("C1-SYNC-RT capture/locate round-trip law", () => {
  it("holds for every cell and every in-cell offset of LEAD, T3, T3A, P2, NOPAD", () => {
    const mismatches: string[] = [];
    for (const { name, doc, rows } of FIXTURES) {
      rows.forEach((row, rowIndex) => {
        row.forEach(([start, end], colIndex) => {
          const p = { tableIndex: 0, rowIndex, colIndex };
          const at = locateCellInSource(doc, p);
          if (at !== start) mismatches.push(`${name} locate(${rowIndex},${colIndex}) = ${at}, want ${start}`);
          const back = at === null ? null : captureCellFromSource(doc, at);
          if (JSON.stringify(back) !== JSON.stringify(p)) {
            mismatches.push(`${name} capture(locate(${rowIndex},${colIndex})) = ${JSON.stringify(back)}`);
          }
          for (let o = start; o < end; o += 1) {
            const cap = captureCellFromSource(doc, o);
            const loc = cap === null ? null : locateCellInSource(doc, cap);
            if (loc !== start) mismatches.push(`${name} locate(capture(${o})) = ${loc}, want ${start}`);
          }
        });
      });
    }
    expect(mismatches).toEqual([]);
  });
});

describe("C1-CTX-LEAD Source context menu targets column 1", () => {
  it("(a) computeSourceTableContext at 26 resolves row 1, column 1", () => {
    const view = viewOn(LEAD, 26, false);
    expect(computeSourceTableContext(view.state, 26)?.ctx).toMatchObject({ rowIndex: 1, colIndex: 1 });
  });

  it("(b) delete_column at 26 deletes the h2/x column and keeps h1 and the blank cell", () => {
    const view = viewOn(LEAD, 26, false);
    expect(dispatchSourceTableAction(view, "delete_column", 26)).toBe(true);
    const model = parseTableAt(view.state.doc.toString(), 0);
    expect(model?.rows.map((r) => r.map((c) => c.text))).toEqual([["h1"], [""]]);
  });
});

describe("C1-HL-LEAD active cell and highlight on the blank leading cell", () => {
  function decorationRanges(state: EditorState): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    computeCellHighlightDecorations(state).between(0, state.doc.length, (from, to) => {
      out.push([from, to]);
    });
    return out;
  }

  it("caret 23: the active cell is the blank column-0 cell and exactly it is highlighted", () => {
    const { state } = viewOn(LEAD, 23, true);
    expect(getActiveTableCell(state)).toEqual({ start: 23, end: 24, text: "", row: 1, col: 0 });
    expect(decorationRanges(state)).toEqual([[23, 24]]);
  });

  it("caret 26: the active cell is x in column 1", () => {
    const { state } = viewOn(LEAD, 26, true);
    expect(getActiveTableCell(state)).toEqual({ start: 25, end: 28, text: "x", row: 1, col: 1 });
  });
});
