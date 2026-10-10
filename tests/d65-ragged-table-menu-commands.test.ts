/**
 * D65 (ADR-0067 Decision 8): every WYSIWYG table context-menu command succeeds on a
 * formerly ragged table and moves the cells it names, through the commands' own entry
 * points (`computeTableContext` + `dispatchTableAction` from table/contextMenu.ts).
 *
 * Real Milkdown (commonmark + gfm + the exported `tableParityPlugins` + history). No
 * mocks: nothing here reaches Tauri.
 *
 * The table: a short header, one overflow row, one full-width row, one short row.
 * Widened at the row end it is H / R1 / R2 / R3 below. The caret sits in "C3"
 * (row 2, column 2), so every move direction is enabled.
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
  serialize,
  tableShapes,
  viewOf,
} from "./support/raggedTableD64";

const MD = "| h1 | h2 |\n| --- | --- |\n| a | b | A3 |\n| c | d | C3 | C4 |\n| e |\n\nend\n";
const H = ["h1", "h2", "", ""];
const R1 = ["a", "b", "A3", ""];
const R2 = ["c", "d", "C3", "C4"];
const R3 = ["e", "", "", ""];
const B4 = ["", "", "", ""];

afterEach(destroyParityEditors);

async function atC3(): Promise<Editor> {
  const e = await mountParityEditor(MD);
  caretAfter(e, "C3");
  return e;
}

function run(e: Editor, id: TableActionId): boolean {
  const ctx = computeTableContext(viewOf(e));
  expect(ctx, "caret not in a table").not.toBeNull();
  return dispatchTableAction(e as never, id, ctx!);
}

const insertCol = (rows: string[][], at: number) =>
  rows.map((r) => [...r.slice(0, at), "", ...r.slice(at)]);
const swapCols = (rows: string[][], i: number, j: number) =>
  rows.map((r) => r.map((v, k) => (k === i ? r[j] : k === j ? r[i] : v)));

const STRUCTURAL: Array<[TableActionId, string[][]]> = [
  ["insert_row_before", [H, R1, B4, R2, R3]],
  ["insert_row_after", [H, R1, R2, B4, R3]],
  ["insert_column_before", insertCol([H, R1, R2, R3], 2)],
  ["insert_column_after", insertCol([H, R1, R2, R3], 3)],
  ["move_row_up", [H, R2, R1, R3]],
  ["move_row_down", [H, R1, R3, R2]],
  ["move_column_left", swapCols([H, R1, R2, R3], 1, 2)],
  ["move_column_right", swapCols([H, R1, R2, R3], 2, 3)],
  ["delete_row", [H, R1, R3]],
  ["delete_column", [H, R1, R2, R3].map((r) => r.filter((_, k) => k !== 2))],
];

describe("D65: table menu commands on a formerly ragged table", () => {
  it("K-0 the caret context reports the widened size and C3's coordinates", async () => {
    const e = await atC3();
    expect(computeTableContext(viewOf(e))).toEqual({
      rowIndex: 2,
      colIndex: 2,
      rowCount: 4,
      colCount: 4,
      alignment: "left",
    });
  });

  for (const [id, expected] of STRUCTURAL) {
    it(`K-${id} succeeds and leaves the expected rectangular grid`, async () => {
      const e = await atC3();
      expect(run(e, id)).toBe(true);
      const [shape] = tableShapes(docOf(e));
      expect(shape.problems).toBeNull();
      expect(shape.cells).toEqual(expected);
      expect(serialize(e)).not.toContain("<br />");
    });
  }

  const ALIGN: Array<[TableActionId, string, RegExp]> = [
    ["align_left", "left", /^:-+$/],
    ["align_center", "center", /^:-+:$/],
    ["align_right", "right", /^-+:$/],
  ];
  for (const [id, value, delimiter] of ALIGN) {
    it(`K-${id} aligns column 2 only and moves no cell`, async () => {
      const e = await atC3();
      expect(run(e, id)).toBe(true);
      const [shape] = tableShapes(docOf(e));
      expect(shape.problems).toBeNull();
      expect(shape.cells).toEqual([H, R1, R2, R3]);
      for (const row of shape.align) expect(row[2]).toBe(value);
      const delims = serialize(e)
        .split("\n")[1]
        .split("|")
        .slice(1, -1)
        .map((s) => s.trim());
      expect(delims).toHaveLength(4);
      expect(delims[2]).toMatch(delimiter);
      for (const k of [0, 1, 3]) expect(delims[k]).toMatch(/^-+$/);
    });
  }

  // Added after red: align invoked from the HEADER cell of a formerly ragged column.
  // (K-align_* above invoke it from body cell C3.)
  for (const [id, value] of [["align_center", "center"], ["align_right", "right"]] as const) {
    it(`K-${id}-header aligns an added column from its header cell`, async () => {
      const e = await mountParityEditor(MD);
      caretAfter(e, "h2");
      expect(run(e, id)).toBe(true);
      const [shape] = tableShapes(docOf(e));
      expect(shape.problems).toBeNull();
      expect(shape.cells).toEqual([H, R1, R2, R3]);
      for (const row of shape.align) expect(row[1]).toBe(value);
      for (const row of shape.align) expect([row[0], row[2], row[3]]).toEqual([null, null, null]);
    });
  }

  it("K-delete_table succeeds and removes the table", async () => {
    const e = await atC3();
    expect(run(e, "delete_table")).toBe(true);
    expect(tableShapes(docOf(e))).toHaveLength(0);
  });

  it("K-reformat_table is the documented WYSIWYG no-op and changes nothing", async () => {
    const e = await atC3();
    const before = serialize(e);
    expect(run(e, "reformat_table")).toBe(false);
    expect(serialize(e)).toBe(before);
  });
});
