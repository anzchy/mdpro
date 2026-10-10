/**
 * D81: a WYSIWYG table context-menu action lands on the RIGHT-CLICKED cell, not on
 * the cell that holds the caret. Browsers do not move the caret on right-click, so
 * the menu captures the clicked position (`posAtCoords`) together with the doc it
 * was resolved against, and `dispatchTableAction` acts on that position. A position
 * captured against an older doc is stale and is refused.
 *
 * Real Milkdown (commonmark + gfm + `tableParityPlugins` + history). No mocks.
 * Every targeted case puts the caret in a DIFFERENT cell than the clicked one.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import {
  computeTableContext,
  dispatchTableAction,
} from "../src/plugins/milkdown/table/contextMenu";
import type { TableActionId } from "../src/plugins/milkdown/table/actionDescriptors";
import {
  caretAfter,
  destroyParityEditors,
  docOf,
  mountParityEditor,
  posAfter,
  serialize,
  tableShapes,
  typeAtDocEnd,
  viewOf,
} from "./support/raggedTableD64";

const MD = "| H0 | H1 | H2 |\n| --- | --- | --- |\n| A0 | A1 | A2 |\n| B0 | B1 | B2 |\n\nend\n";
const H = ["H0", "H1", "H2"];
const A = ["A0", "A1", "A2"];
const B = ["B0", "B1", "B2"];

afterEach(destroyParityEditors);

/** The target a right-click on the cell holding `needle` would capture. */
function targetAt(e: Editor, needle: string): { pos: number; doc: unknown } {
  const view = viewOf(e);
  return { pos: posAfter(view, needle), doc: view.state.doc };
}

function runAt(e: Editor, id: TableActionId, target: { pos: number; doc: unknown }): boolean {
  const ctx = computeTableContext(viewOf(e));
  expect(ctx, "caret not in a table").not.toBeNull();
  return dispatchTableAction(e as never, id, ctx!, target as never);
}

describe("D81: table menu acts on the right-clicked cell", () => {
  it("D81-1 align_right on column 1 while the caret is in column 0", async () => {
    const e = await mountParityEditor(MD);
    caretAfter(e, "A0");
    expect(runAt(e, "align_right", targetAt(e, "A1"))).toBe(true);
    const [shape] = tableShapes(docOf(e));
    expect(shape.cells).toEqual([H, A, B]);
    for (const row of shape.align) expect(row[1]).toBe("right");
    for (const row of shape.align) expect(row[0]).not.toBe("right");
    for (const row of shape.align) expect(row[2]).not.toBe("right");
    // The caret ends in the clicked cell (as a left-click then the action would).
    expect(computeTableContext(viewOf(e))).toMatchObject({ rowIndex: 1, colIndex: 1 });
  });

  it("D81-2 delete_row on body row 2 while the caret is in body row 1", async () => {
    const e = await mountParityEditor(MD);
    caretAfter(e, "A1");
    expect(runAt(e, "delete_row", targetAt(e, "B1"))).toBe(true);
    const [shape] = tableShapes(docOf(e));
    expect(shape.problems).toBeNull();
    expect(shape.cells).toEqual([H, A]);
  });

  it("D81-3 delete_column on column 1 while the caret is in column 0", async () => {
    const e = await mountParityEditor(MD);
    caretAfter(e, "A0");
    expect(runAt(e, "delete_column", targetAt(e, "A1"))).toBe(true);
    const [shape] = tableShapes(docOf(e));
    expect(shape.problems).toBeNull();
    expect(shape.cells).toEqual([H, A, B].map((r) => [r[0], r[2]]));
  });

  it("D81-4 a position captured against an older doc is stale and refused", async () => {
    const e = await mountParityEditor(MD);
    caretAfter(e, "A0");
    const target = targetAt(e, "A1");
    typeAtDocEnd(e, "!"); // an unrelated edit while the menu is open (e.g. MCP)
    const before = serialize(e);
    expect(runAt(e, "align_right", target)).toBe(false);
    expect(serialize(e)).toBe(before);
    const [shape] = tableShapes(docOf(e));
    for (const row of shape.align) expect(row).not.toContain("right");
  });

  it("D81-5 an action disabled at the clicked cell is refused and the caret does not move", async () => {
    const e = await mountParityEditor(MD);
    caretAfter(e, "A0"); // move_column_right would be enabled here
    const selBefore = viewOf(e).state.selection.toJSON();
    const before = serialize(e);
    expect(runAt(e, "move_column_right", targetAt(e, "A2"))).toBe(false);
    expect(serialize(e)).toBe(before);
    expect(viewOf(e).state.selection.toJSON()).toEqual(selBefore);
  });

  it("D81-6 without a target (keyboard path) the action still acts on the caret cell", async () => {
    const e = await mountParityEditor(MD);
    caretAfter(e, "A0");
    const ctx = computeTableContext(viewOf(e));
    expect(dispatchTableAction(e as never, "align_right", ctx!)).toBe(true);
    const [shape] = tableShapes(docOf(e));
    for (const row of shape.align) expect(row[0]).toBe("right");
    for (const row of shape.align) expect(row[1]).not.toBe("right");
  });

  it("D81-7 a target position outside the doc range is refused", async () => {
    const e = await mountParityEditor(MD);
    caretAfter(e, "A0");
    const before = serialize(e);
    const target = { pos: docOf(e).content.size + 50, doc: docOf(e) };
    expect(runAt(e, "align_right", target)).toBe(false);
    expect(serialize(e)).toBe(before);
  });

  it("D81-8 a target position outside any table is refused", async () => {
    const e = await mountParityEditor(MD);
    caretAfter(e, "A0");
    const before = serialize(e);
    expect(runAt(e, "align_right", targetAt(e, "end"))).toBe(false);
    expect(serialize(e)).toBe(before);
  });
});
