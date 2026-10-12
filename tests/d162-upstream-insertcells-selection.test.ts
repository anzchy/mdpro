// @vitest-environment node
/**
 * D162-WI-3, upstream bug (b): prosemirror-tables 1.8.5 `insertCells` picks its
 * closing CellSelection's corners with `TableMap.positionAt(row, col)`
 * (dist/index.js `insertCells`, the `tr.setSelection` line). `positionAt` is an
 * insertion position: it skips a slot covered from above and returns the next
 * cell in the row, or the row's end. When the inserted rect's bottom-right slot
 * is covered by a span from above, the head lands one cell to the right — a
 * wider selection — or, at the table's right edge, past the row, where
 * `CellSelection` throws `RangeError: No cell with offset …` before dispatch.
 *
 * Called directly with cells that need no clipping, so the clip bug (a) cannot
 * mask or cause it; this fails on an unpatched 1.8.5 and passes on
 * `patches/prosemirror-tables@1.8.5.patch` (ADR-0082).
 *
 * Law: for every target position, the insert dispatches once, selects exactly
 * the inserted rect, leaves the table sound, and keeps every host slot outside
 * the rect as it was.
 */
import { describe, expect, it } from "vitest";
import type { Node as PmNode } from "@milkdown/kit/prose/model";
import { EditorState, type Transaction } from "@milkdown/kit/prose/state";
import { __insertCells, CellSelection, TableMap } from "@milkdown/kit/prose/tables";
import { cell, hostTable, row, schema, slotsOutside } from "./support/upstreamTableSchema";

type Cells = Parameters<typeof __insertCells>[4];

const WIDTH = 4;
const HEIGHT = 5;
/** The table is the doc's first child, so its content starts at 1. */
const TABLE_START = 1;

const SHAPES: Record<string, () => Cells> = {
  /** The span in the right column: the rect's bottom-right slot is covered from above. */
  rightSpan: () => ({ width: 2, height: 2, rows: [row(cell("B"), cell("A", 2)), row(cell("C"))] }),
  /** A 3-row span on the right of a 2-wide, 3-tall block. */
  rightSpan3: () => ({
    width: 2,
    height: 3,
    rows: [row(cell("B"), cell("A", 3)), row(cell("C")), row(cell("D"))],
  }),
  /** The span in the left column: positionAt happens to be right here (control). */
  leftSpan: () => ({ width: 2, height: 2, rows: [row(cell("A", 2), cell("B")), row(cell("C"))] }),
};

function stateOf(table: PmNode): EditorState {
  return EditorState.create({ doc: schema.nodes.doc.create(null, [table]) });
}

/** Insert `cells` at (top, left); returns the dispatched transactions. */
function insert(state: EditorState, cells: Cells, top: number, left: number): Transaction[] {
  const out: Transaction[] = [];
  const rect = { left, top, right: left + cells.width, bottom: top + cells.height };
  __insertCells(state, (tr) => out.push(tr), TABLE_START, rect, cells);
  return out;
}

function selectedRect(sel: CellSelection) {
  const table = sel.$anchorCell.node(-1);
  const start = sel.$anchorCell.start(-1);
  return TableMap.get(table).rectBetween(sel.$anchorCell.pos - start, sel.$headCell.pos - start);
}

describe("D162-WI-3 upstream (b) — insertCells selects exactly the inserted rect", () => {
  it("a right-column span inserted at the table's right edge does not throw", () => {
    const state = stateOf(hostTable(WIDTH, HEIGHT));
    expect(() => insert(state, SHAPES.rightSpan(), 0, 2)).not.toThrow();
  });

  it("a right-column span inserted in the interior selects 2 columns, not 3", () => {
    const state = stateOf(hostTable(WIDTH, HEIGHT));
    const [tr] = insert(state, SHAPES.rightSpan(), 1, 1);
    expect(tr.selection).toBeInstanceOf(CellSelection);
    expect(selectedRect(tr.selection as CellSelection)).toEqual({ left: 1, top: 1, right: 3, bottom: 3 });
  });

  for (const [name, make] of Object.entries(SHAPES)) {
    const { width, height } = make();
    for (let top = 0; top < HEIGHT; top += 1) {
      for (let left = 0; left <= WIDTH - width; left += 1) {
        it(`${name} at (${top}, ${left}): one dispatch, exact selection, sound, outside kept`, () => {
          const host = hostTable(WIDTH, HEIGHT);
          const rect = { left, top, right: left + width, bottom: top + height };
          const before = slotsOutside(host, rect);
          let trs: Transaction[] = [];
          expect(() => {
            trs = insert(stateOf(host), make(), top, left);
          }).not.toThrow();
          expect(trs).toHaveLength(1);
          const tr = trs[0];
          expect(tr.selection).toBeInstanceOf(CellSelection);
          expect(selectedRect(tr.selection as CellSelection)).toEqual(rect);
          const table = tr.doc.child(0);
          const map = TableMap.get(table);
          expect(map.problems ?? null).toBeNull();
          expect(map.width).toBe(WIDTH);
          expect(map.height).toBe(Math.max(HEIGHT, rect.bottom));
          const after = slotsOutside(table, rect);
          for (const [slot, text] of before) expect(`${slot}=${after.get(slot)}`).toBe(`${slot}=${text}`);
          expect(table.textContent).toContain("A");
        });
      }
    }
  }
});
