/**
 * D108 ② — the header cells the empty-header repair (D103) adds take their alignment
 * from the first body row by LOGICAL column, not by child index.
 *
 * The repair fills the header to the table's `TableMap` width, which counts colspan.
 * Taking the alignment for header column `col` from `firstBody.maybeChild(col)` shifts
 * every column after a colspan cell one place left: a first body row
 * `[A center colspan=2][B right]` gave `[center, right, null]` instead of
 * `[center, center, right]`. Colspan only reaches a table through sanitized HTML paste,
 * but the column count and the alignments must still line up.
 *
 * Real Milkdown commonmark + gfm + the parity list + history; the table is appended
 * with an empty header row the way D100's transaction does. Only logging is spied.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { loggingService } from "../src/services/loggingService";
import {
  destroyParityEditors,
  docOf,
  mountParityEditor,
  tableShapes,
  viewOf,
} from "./support/raggedTableD64";

type Align = "left" | "center" | "right" | null;
interface CellSpec {
  text: string;
  align?: Align;
  colspan?: number;
}

beforeEach(() => {
  vi.spyOn(loggingService, "logEventSync").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await destroyParityEditors();
});

/** Append a table with an empty header row and the given body rows. */
function appendTable(e: Editor, rows: CellSpec[][]): void {
  const view = viewOf(e);
  const s = view.state.schema;
  const cell = ({ text, align = null, colspan = 1 }: CellSpec) =>
    s.nodes.table_cell.create(
      { alignment: align, colspan },
      s.nodes.paragraph.create(null, text ? s.text(text) : null),
    );
  const table = s.nodes.table.create(null, [
    s.nodes.table_header_row.create(null, []),
    ...rows.map((r) => s.nodes.table_row.create(null, r.map(cell))),
  ]);
  view.dispatch(view.state.tr.insert(view.state.doc.content.size, table));
}

const headerAlign = (e: Editor): unknown[] => tableShapes(docOf(e))[0].align[0];

describe("D108 ② — header alignment follows the first body row's logical columns", () => {
  it("C-1: canonical repro — colspan cell first: [center x2][right] -> [center, center, right]", async () => {
    const e = await mountParityEditor("Intro\n");
    appendTable(e, [
      [{ text: "A", align: "center", colspan: 2 }, { text: "B", align: "right" }],
      [{ text: "c", align: "left" }, { text: "d", align: "left" }, { text: "e", align: "left" }],
    ]);

    const [shape] = tableShapes(docOf(e));
    expect(shape.width).toBe(3);
    expect(shape.problems).toBeNull();
    expect(shape.cells[0]).toEqual(["", "", ""]);
    expect(headerAlign(e)).toEqual(["center", "center", "right"]);
  });

  it("C-2: colspan cell last: [left][right x2] -> [left, right, right]", async () => {
    const e = await mountParityEditor("Intro\n");
    appendTable(e, [
      [{ text: "a", align: "left" }, { text: "B", align: "right", colspan: 2 }],
      [{ text: "c" }, { text: "d" }, { text: "e" }],
    ]);
    expect(headerAlign(e)).toEqual(["left", "right", "right"]);
  });

  it("C-3: a first body row narrower than the table leaves the uncovered columns null", async () => {
    const e = await mountParityEditor("Intro\n");
    appendTable(e, [
      [{ text: "a", align: "center" }],
      [{ text: "b", align: "right" }, { text: "c", align: "right" }, { text: "d", align: "right" }],
    ]);
    expect(headerAlign(e)).toEqual(["center", null, null]);
  });

  it("C-4: no colspan — alignments copied column for column", async () => {
    const e = await mountParityEditor("Intro\n");
    appendTable(e, [
      [{ text: "a", align: "right" }, { text: "b" }, { text: "c", align: "center" }],
    ]);
    expect(headerAlign(e)).toEqual(["right", null, "center"]);
  });
});
