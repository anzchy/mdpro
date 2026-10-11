/**
 * D155: the WYSIWYG table menu's "Insert row above" on the HEADER row split the
 * table in two.
 *
 * preset-gfm's `addRowBeforeCommand` → `addRowWithAlignment` inserts a body
 * `table_row` at table index `rect.top`, which is 0 on the header row. Milkdown's
 * table content is `table_header_row table_row+`, so ProseMirror closes the table
 * before the body row and the saved file gains an extra empty table above the
 * original.
 *
 * Expected (Typora's behaviour, recorded in the D155 row): a new EMPTY header row
 * on top, and the old header's contents move down into a new first body row whose
 * cells keep each column's alignment. One table, the delimiter row unchanged, one
 * undo step, and the caret in the (now empty) header cell of the same column.
 * Insert row above on a body row and Insert row below anywhere stay preset-gfm's.
 *
 * Driven through the real menu dispatch (`dispatchTableAction` with a right-click
 * target, as tests/d141-menu-insert-column-alignment.test.ts), on real Milkdown
 * commonmark + gfm + the parity list. Only the logging IPC is stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import type { Node as PmNode } from "@milkdown/kit/prose/model";
import { loggingService } from "../src/services/loggingService";
import {
  computeTableContext,
  dispatchTableAction,
  dispatchTableActionFromKeyboard,
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
  viewOf,
} from "./support/raggedTableD64";

beforeEach(() => {
  vi.spyOn(loggingService, "logEventSync").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await destroyParityEditors();
});

const PLAIN = "| H0 | H1 |\n| -- | -- |\n| A0 | A1 |\n| B0 | B1 |\n\nend\n";
const ALIGNED = "| H0 | H1 |\n| :-: | --: |\n| A0 | A1 |\n| B0 | B1 |\n\nend\n";
const HOSTS = [
  { name: "plain", md: PLAIN, colons: ["none", "none"], align: [null, null] },
  { name: "aligned", md: ALIGNED, colons: ["center", "right"], align: ["center", "right"] },
];

/** The delimiter cells of the first table in the serialized markdown. */
function delimiterCells(md: string): string[] {
  const line = md.split("\n").find((l) => /^\|\s*:?-+:?\s*\|/.test(l));
  if (!line) throw new Error(`no delimiter row in:\n${md}`);
  return line.split("|").slice(1, -1).map((c) => c.trim());
}

function colonOf(cell: string): string {
  const l = cell.startsWith(":");
  const r = cell.endsWith(":");
  if (l && r) return "center";
  if (l) return "left";
  if (r) return "right";
  return "none";
}

function countTables(doc: PmNode): number {
  let n = 0;
  doc.descendants((node) => {
    if (node.type.name === "table") n += 1;
    return node.type.name !== "table";
  });
  return n;
}

/** Row type names of the first table, top to bottom. */
function rowTypes(doc: PmNode): string[] {
  const out: string[] = [];
  doc.descendants((node) => {
    if (node.type.name !== "table") return true;
    node.forEach((row) => out.push(row.type.name));
    return false;
  });
  return out;
}

function runAt(e: Editor, id: TableActionId, needle: string): boolean {
  const view = viewOf(e);
  const target = { pos: posAfter(view, needle), doc: view.state.doc };
  const ctx = computeTableContext(view);
  expect(ctx, "caret not in a table").not.toBeNull();
  return dispatchTableAction(e as never, id, ctx!, target as never);
}

/** The table is whole, saves, and keeps its column alignment. */
function expectOneHealthyTable(e: Editor, colons: string[], align: unknown[]): void {
  const doc = docOf(e);
  expect(countTables(doc)).toBe(1);
  const types = rowTypes(doc);
  expect(types[0]).toBe("table_header_row");
  expect(types.slice(1).every((t) => t === "table_row")).toBe(true);
  const [shape] = tableShapes(doc);
  expect(shape.problems).toBeNull();
  for (const row of shape.align) expect(row).toEqual(align);
  const md = serialize(e);
  expect(delimiterCells(md).map(colonOf)).toEqual(colons);
}

describe("D155: Insert row above on the header row", () => {
  for (const h of HOSTS) {
    for (const cell of ["H0", "H1"]) {
      it(`D155 ${h.name} host, target header cell ${cell}`, async () => {
        const e = await mountParityEditor(h.md);
        caretAfter(e, "B1");
        expect(runAt(e, "insert_row_before", cell)).toBe(true);

        expectOneHealthyTable(e, h.colons, h.align);
        const [shape] = tableShapes(docOf(e));
        expect(shape.cells).toEqual([
          ["", ""],
          ["H0", "H1"],
          ["A0", "A1"],
          ["B0", "B1"],
        ]);

        // The caret sits in the new, empty header cell of the clicked column.
        const ctx = computeTableContext(viewOf(e));
        expect(ctx).not.toBeNull();
        expect(ctx!.rowIndex).toBe(0);
        expect(ctx!.colIndex).toBe(cell === "H0" ? 0 : 1);
      });
    }

    it(`D155 ${h.name} host: one undo restores the original document`, async () => {
      const e = await mountParityEditor(h.md);
      caretAfter(e, "H0");
      const before = docOf(e);
      expect(runAt(e, "insert_row_before", "H0")).toBe(true);
      const { undo } = await import("@milkdown/kit/prose/history");
      const view = viewOf(e);
      expect(undo(view.state, view.dispatch)).toBe(true);
      expect(docOf(e).eq(before)).toBe(true);
    });
  }

  it("D155 header inline marks move down with the text", async () => {
    const e = await mountParityEditor("| **H0** | `H1` |\n| -- | -- |\n| A0 | A1 |\n\nend\n");
    caretAfter(e, "A0");
    expect(runAt(e, "insert_row_before", "H0")).toBe(true);
    expectOneHealthyTable(e, ["none", "none"], [null, null]);
    const md = serialize(e);
    expect(md).toMatch(/\|\s*\*\*H0\*\*\s*\|\s*`H1`\s*\|/);
    const [shape] = tableShapes(docOf(e));
    expect(shape.cells[0]).toEqual(["", ""]);
  });

  it("D155 the keyboard path (no target) does the same", async () => {
    const e = await mountParityEditor(ALIGNED);
    caretAfter(e, "H1");
    expect(dispatchTableActionFromKeyboard(e as never, "insert_row_before")).toBe(true);
    expectOneHealthyTable(e, ["center", "right"], ["center", "right"]);
    const [shape] = tableShapes(docOf(e));
    expect(shape.cells.slice(0, 2)).toEqual([["", ""], ["H0", "H1"]]);
  });
});

describe("D155 guards: the other row inserts are unchanged", () => {
  const GUARDS: Array<{ id: TableActionId; cell: string; cells: string[][] }> = [
    { id: "insert_row_before", cell: "A0", cells: [["H0", "H1"], ["", ""], ["A0", "A1"], ["B0", "B1"]] },
    { id: "insert_row_before", cell: "B1", cells: [["H0", "H1"], ["A0", "A1"], ["", ""], ["B0", "B1"]] },
    { id: "insert_row_after", cell: "H1", cells: [["H0", "H1"], ["", ""], ["A0", "A1"], ["B0", "B1"]] },
    { id: "insert_row_after", cell: "B0", cells: [["H0", "H1"], ["A0", "A1"], ["B0", "B1"], ["", ""]] },
  ];
  for (const h of HOSTS) {
    for (const g of GUARDS) {
      it(`D155 guard ${g.id} at ${g.cell} on ${h.name} host`, async () => {
        const e = await mountParityEditor(h.md);
        caretAfter(e, "A0");
        expect(runAt(e, g.id, g.cell)).toBe(true);
        expectOneHealthyTable(e, h.colons, h.align);
        expect(tableShapes(docOf(e))[0].cells).toEqual(g.cells);
      });
    }
  }
});
