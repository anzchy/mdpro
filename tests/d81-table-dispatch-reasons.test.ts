/**
 * D81 (added after red): `dispatchTableActionDetailed` says WHY a pick did not
 * apply, so the menu can log it. Real Milkdown, no mocks.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import {
  computeTableContext,
  dispatchTableActionDetailed,
  type TableTarget,
} from "../src/plugins/milkdown/table/contextMenu";
import type { TableActionId } from "../src/plugins/milkdown/table/actionDescriptors";
import {
  caretAfter,
  destroyParityEditors,
  mountParityEditor,
  posAfter,
  typeAtDocEnd,
  viewOf,
} from "./support/raggedTableD64";

const MD = "| H0 | H1 | H2 |\n| --- | --- | --- |\n| A0 | A1 | A2 |\n| B0 | B1 | B2 |\n\nend\n";

afterEach(destroyParityEditors);

function targetAt(e: Editor, needle: string): TableTarget {
  const view = viewOf(e);
  return { pos: posAfter(view, needle), doc: view.state.doc };
}

function detailed(e: Editor, id: TableActionId, target?: TableTarget) {
  const ctx = computeTableContext(viewOf(e));
  expect(ctx, "caret not in a table").not.toBeNull();
  return dispatchTableActionDetailed(e as never, id, ctx!, target);
}

describe("D81: dispatchTableActionDetailed reasons", () => {
  it("R-1 applied with no reason on success", async () => {
    const e = await mountParityEditor(MD);
    caretAfter(e, "A0");
    expect(detailed(e, "align_center", targetAt(e, "B2"))).toEqual({ applied: true });
  });

  it("R-2 stale-position when the doc changed after capture", async () => {
    const e = await mountParityEditor(MD);
    caretAfter(e, "A0");
    const target = targetAt(e, "A1");
    typeAtDocEnd(e, "!");
    expect(detailed(e, "delete_row", target)).toEqual({ applied: false, reason: "stale-position" });
  });

  it("R-3 disabled when the action is disabled at the clicked cell", async () => {
    const e = await mountParityEditor(MD);
    caretAfter(e, "A1");
    expect(detailed(e, "move_row_up", targetAt(e, "H1"))).toEqual({
      applied: false,
      reason: "disabled",
    });
  });

  it("R-4 not-in-table for a target outside every table", async () => {
    const e = await mountParityEditor(MD);
    caretAfter(e, "A0");
    expect(detailed(e, "align_left", targetAt(e, "end"))).toEqual({
      applied: false,
      reason: "not-in-table",
    });
  });

  it("R-5 declined when the command itself declines (WYSIWYG reformat no-op)", async () => {
    const e = await mountParityEditor(MD);
    caretAfter(e, "A0");
    expect(detailed(e, "reformat_table", targetAt(e, "A1"))).toEqual({
      applied: false,
      reason: "declined",
    });
  });

  it("R-6 a target position between cells (row level) is refused as not-in-table (D87: no guessing)", async () => {
    const e = await mountParityEditor(MD);
    caretAfter(e, "A0");
    // Position just before B1's cell node: inside the row, not inside a cell.
    // Before D87 this resolved to the PREVIOUS cell (B0) and acted there.
    const view = viewOf(e);
    const $b1 = view.state.doc.resolve(posAfter(view, "B1"));
    let cellDepth = $b1.depth;
    while (cellDepth > 0 && !/table_(cell|header)/.test($b1.node(cellDepth).type.name)) cellDepth -= 1;
    const target = { pos: $b1.before(cellDepth), doc: view.state.doc };
    expect(computeTableContext(view, view.state.doc.resolve(target.pos))).toBeNull();
    const docBefore = view.state.doc;
    const selBefore = view.state.selection;
    expect(detailed(e, "align_right", target)).toEqual({ applied: false, reason: "not-in-table" });
    // Refused means untouched: no change to the doc, and the caret did not move
    // (a "mutate, then refuse" dispatch would pass the reason check alone).
    expect(view.state.doc.eq(docBefore)).toBe(true);
    expect(view.state.selection.eq(selBefore)).toBe(true);
  });
});
