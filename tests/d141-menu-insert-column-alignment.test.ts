/**
 * D141: the WYSIWYG table menu's "Insert column left / right" must not invent an
 * alignment for the column it adds.
 *
 * The menu ran preset-gfm's `addColBeforeCommand` / `addColAfterCommand`, i.e.
 * prosemirror-tables' `addColumn`, which fills the new column with
 * `createAndFill()` — the schema default `alignment: "left"`. The serializer reads
 * a column's alignment from the header row, so `| -- | -- |` saved as
 * `| -- | -- | :- |` after one ordinary menu action.
 *
 * Expected (the MCP `add_column` convention, src/utils/tableEdits/edits.ts): every
 * cell of the inserted column carries `alignment: null` and its delimiter has no
 * colon; the existing columns keep theirs. "Insert row above / below" is pinned
 * too: preset-gfm's `addRowWithAlignment` copies each column's header alignment,
 * so the delimiter row does not change.
 *
 * Driven through the real menu dispatch (`dispatchTableAction` with a right-click
 * target, as tests/d81-table-menu-clicked-cell.test.ts), on real Milkdown
 * commonmark + gfm + the parity list. Only the logging IPC is stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@milkdown/kit/core";
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

const UNALIGNED = "| H0 | H1 |\n| -- | -- |\n| A0 | A1 |\n\nend\n";
const ALIGNED = "| H0 | H1 |\n| :-: | --: |\n| A0 | A1 |\n\nend\n";

/** The delimiter cells of the first table in the serialized markdown. */
function delimiterCells(md: string): string[] {
  const line = md.split("\n").find((l) => /^\|\s*:?-+:?\s*\|/.test(l));
  if (!line) throw new Error(`no delimiter row in:\n${md}`);
  return line.split("|").slice(1, -1).map((c) => c.trim());
}

/** Colon pattern of a delimiter cell: "none" | "left" | "center" | "right". */
function colonOf(cell: string): string {
  const l = cell.startsWith(":");
  const r = cell.endsWith(":");
  if (l && r) return "center";
  if (l) return "left";
  if (r) return "right";
  return "none";
}

function runAt(e: Editor, id: TableActionId, needle: string): boolean {
  const view = viewOf(e);
  const target = { pos: posAfter(view, needle), doc: view.state.doc };
  const ctx = computeTableContext(view);
  expect(ctx, "caret not in a table").not.toBeNull();
  return dispatchTableAction(e as never, id, ctx!, target as never);
}

type Case = {
  name: string;
  md: string;
  id: "insert_column_before" | "insert_column_after";
  cell: string;
  /** Expected delimiter colons after the insert, the new column marked by index. */
  expected: string[];
  newCol: number;
};

const CASES: Case[] = [
  { name: "unaligned, after header cell H0", md: UNALIGNED, id: "insert_column_after", cell: "H0", newCol: 1, expected: ["none", "none", "none"] },
  { name: "unaligned, before header cell H0", md: UNALIGNED, id: "insert_column_before", cell: "H0", newCol: 0, expected: ["none", "none", "none"] },
  { name: "unaligned, after body cell A1 (last column)", md: UNALIGNED, id: "insert_column_after", cell: "A1", newCol: 2, expected: ["none", "none", "none"] },
  { name: "unaligned, before body cell A1", md: UNALIGNED, id: "insert_column_before", cell: "A1", newCol: 1, expected: ["none", "none", "none"] },
  { name: "aligned, after header cell H1 (last column)", md: ALIGNED, id: "insert_column_after", cell: "H1", newCol: 2, expected: ["center", "right", "none"] },
  { name: "aligned, before header cell H0", md: ALIGNED, id: "insert_column_before", cell: "H0", newCol: 0, expected: ["none", "center", "right"] },
  { name: "aligned, after body cell A0", md: ALIGNED, id: "insert_column_after", cell: "A0", newCol: 1, expected: ["center", "none", "right"] },
  { name: "aligned, before body cell A1", md: ALIGNED, id: "insert_column_before", cell: "A1", newCol: 1, expected: ["center", "none", "right"] },
];

describe("D141: menu Insert column adds an unaligned column", () => {
  for (const c of CASES) {
    it(`D141 ${c.name}`, async () => {
      const e = await mountParityEditor(c.md);
      caretAfter(e, "A0");
      expect(runAt(e, c.id, c.cell)).toBe(true);

      // The saved file: existing columns keep their colons, the new one has none.
      expect(delimiterCells(serialize(e)).map(colonOf)).toEqual(c.expected);

      const [shape] = tableShapes(docOf(e));
      expect(shape.problems).toBeNull();
      expect(shape.width).toBe(3);
      // Every cell of the inserted column — header and body — is unaligned and empty.
      for (const row of shape.align) expect(row[c.newCol]).toBeNull();
      for (const row of shape.cells) expect(row[c.newCol]).toBe("");
    });
  }

  it("D141 the keyboard path (no target) runs the same command", async () => {
    const e = await mountParityEditor(ALIGNED);
    caretAfter(e, "A1");
    expect(dispatchTableActionFromKeyboard(e as never, "insert_column_after")).toBe(true);
    expect(delimiterCells(serialize(e)).map(colonOf)).toEqual(["center", "right", "none"]);
    const [shape] = tableShapes(docOf(e));
    for (const row of shape.align) expect(row[2]).toBeNull();
  });

  it("D141 undo removes the inserted column in one step", async () => {
    const { undo } = await import("@milkdown/kit/prose/history");
    const e = await mountParityEditor(ALIGNED);
    caretAfter(e, "A0");
    const before = serialize(e);
    expect(runAt(e, "insert_column_after", "A0")).toBe(true);
    const view = viewOf(e);
    expect(undo(view.state, view.dispatch)).toBe(true);
    expect(serialize(e)).toBe(before);
  });
});

describe("D141: menu Insert row keeps the delimiter row", () => {
  const ROW_CASES: Array<{ id: TableActionId; cell: string }> = [
    { id: "insert_row_before", cell: "A1" },
    { id: "insert_row_after", cell: "A1" },
    { id: "insert_row_after", cell: "H0" },
  ];
  for (const md of [UNALIGNED, ALIGNED]) {
    for (const r of ROW_CASES) {
      it(`D141 ${r.id} at ${r.cell} on ${md === ALIGNED ? "aligned" : "unaligned"} host`, async () => {
        const e = await mountParityEditor(md);
        caretAfter(e, "A0");
        const before = delimiterCells(serialize(e)).map(colonOf);
        expect(runAt(e, r.id, r.cell)).toBe(true);
        const [shape] = tableShapes(docOf(e));
        expect(shape.problems).toBeNull();
        expect(shape.align.length).toBe(3);
        // Every row's cells carry the column's header alignment.
        for (const row of shape.align) expect(row).toEqual(shape.align[0]);
        expect(delimiterCells(serialize(e)).map(colonOf)).toEqual(before);
      });
    }
  }
});
