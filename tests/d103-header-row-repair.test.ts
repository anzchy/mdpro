/**
 * D103 (BLOCK) — a deletion that removes every cell of a table's header row must
 * not leave the table unserializable.
 *
 * Deleting a TextSelection that runs from a paragraph before a table into one of
 * its cells (Backspace, Delete, or the source side of a move-drag) removes every
 * `table_header` but keeps the `table_header_row` node, empty. prosemirror-tables'
 * `fixTables` picks the cell type to add from `row.firstChild`; an empty header row
 * has none, so it tries `table_cell`, which Milkdown's header row cannot hold, and
 * appends a body row instead. The header stays empty and the markdown serializer
 * throws, so every flush and ⌘S fails. A copy-drag of a selection from a cell out
 * into a paragraph builds a new table with the same empty header.
 *
 * Asserted here: the header row is filled to the table's width with empty header
 * cells, no spurious body row is added, the document serializes, one undo restores
 * the pre-delete document, and the repair is idempotent and leaves healthy tables
 * alone. Real Milkdown commonmark + gfm + the parity list + history; Backspace and
 * Delete go through the real keymap (a keydown on `view.dom`). Only the logging
 * boundary is spied.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import type { Node as PmNode } from "@milkdown/kit/prose/model";
import { undo } from "@milkdown/kit/prose/history";
import { type Plugin, TextSelection } from "@milkdown/kit/prose/state";
import { loggingService } from "../src/services/loggingService";
import {
  destroyParityEditors,
  docOf,
  mountParityEditor,
  posAfter,
  serialize,
  tableShapes,
  viewOf,
} from "./support/raggedTableD64";
import { drop, HOST } from "./support/tableDropDriver";

const MD = `Pre\n\n${HOST}\nPost\n`;
const REPAIR_EVENT = "editor.table.header_repair";
const REPAIR_KEY_PREFIX = "MDPRO_TABLE_HEADER_REPAIR";

beforeEach(() => {
  vi.spyOn(loggingService, "logEventSync").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await destroyParityEditors();
});

type LogPayload = { level: string; event: string; status: string; context?: unknown };
const repairLogs = (): LogPayload[] =>
  vi
    .mocked(loggingService.logEventSync)
    .mock.calls.map(([p]) => p as LogPayload)
    .filter((p) => p.event === REPAIR_EVENT);

function select(e: Editor, fromNeedle: string, toNeedle: string): void {
  const view = viewOf(e);
  const sel = TextSelection.create(
    view.state.doc,
    posAfter(view, fromNeedle),
    posAfter(view, toNeedle),
  );
  view.dispatch(view.state.tr.setSelection(sel));
}

/** A real keydown through prosemirror-view's handler and the editor's keymaps. */
function press(e: Editor, key: "Backspace" | "Delete"): void {
  const keyCode = key === "Backspace" ? 8 : 46;
  const event = new KeyboardEvent("keydown", { key, keyCode, bubbles: true, cancelable: true });
  viewOf(e).dom.dispatchEvent(event);
}

function serializeError(e: Editor): string | null {
  try {
    serialize(e);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Every table's cell matrix, its TableMap problems and its row types. */
function tables(doc: PmNode) {
  const rowTypes: string[][] = [];
  doc.descendants((node) => {
    if (node.type.name !== "table") return true;
    const types: string[] = [];
    node.forEach((row) => types.push(row.type.name));
    rowTypes.push(types);
    return false;
  });
  return tableShapes(doc).map((s, i) => ({
    cells: s.cells,
    problems: s.problems,
    rows: rowTypes[i],
  }));
}

const repairPlugin = (e: Editor): Plugin | undefined =>
  viewOf(e).state.plugins.find((p) =>
    (p as unknown as { key: string }).key.startsWith(REPAIR_KEY_PREFIX),
  );

describe("D103 — deleting a selection from a paragraph into a table cell", () => {
  // [id, key, to-needle, expected remaining table]. Pre -> y1: the deletion
  // also removes the y1 cell (its empty tail joins 'P'), so the body row keeps
  // only y2 and the table is one column wide. Pre -> X2: both header cells go.
  const cases: [string, "Backspace" | "Delete", string, string[][]][] = [
    ["R-1: Backspace, Pre -> body cell 'y1'", "Backspace", "y1", [[""], ["y2"]]],
    ["R-2: Delete, Pre -> body cell 'y1'", "Delete", "y1", [[""], ["y2"]]],
    ["R-3: Backspace, Pre -> header cell 'X2'", "Backspace", "X2", [["", ""], ["y1", "y2"]]],
    ["R-4: Delete, Pre -> header cell 'X2'", "Delete", "X2", [["", ""], ["y1", "y2"]]],
  ];

  for (const [name, key, toNeedle, expected] of cases) {
    it(`${name}: header refilled, no extra row, serializes`, async () => {
      const e = await mountParityEditor(MD);
      select(e, "P", toNeedle);
      const before = docOf(e);
      press(e, key);

      expect(docOf(e).eq(before)).toBe(false); // the key really deleted
      expect(docOf(e).firstChild?.textContent).toBe("P");
      expect(tables(docOf(e))).toEqual([
        { cells: expected, problems: null, rows: ["table_header_row", "table_row"] },
      ]);
      expect(serializeError(e)).toBeNull();
      // Backspace / Delete through the keymap carry no uiEvent: logged as `edit`.
      expect(repairLogs().map((l) => l.context)).toEqual([
        { count: 1, widths: [expected[0].length], trigger: "edit" },
      ]);
    });
  }

  it("R-5: the repair is logged once, with the count and the width", async () => {
    const e = await mountParityEditor(MD);
    select(e, "P", "y1");
    press(e, "Backspace");
    expect(repairLogs()).toEqual([
      expect.objectContaining({
        level: "info",
        status: "success",
        context: { count: 1, widths: [1], trigger: "edit" },
      }),
    ]);
  });

  it("R-6: one undo restores the exact pre-delete document", async () => {
    const e = await mountParityEditor(MD);
    select(e, "P", "y1");
    const before = docOf(e);
    press(e, "Backspace");
    expect(docOf(e).eq(before)).toBe(false);

    const view = viewOf(e);
    expect(undo(view.state, view.dispatch)).toBe(true);
    expect(docOf(e).eq(before)).toBe(true);
  });

  it("R-7: idempotent — a further pass on the repaired doc changes nothing", async () => {
    const e = await mountParityEditor(MD);
    select(e, "P", "y1");
    press(e, "Backspace");
    const repaired = docOf(e);
    const logsAfterRepair = repairLogs().length;

    const plugin = repairPlugin(e);
    expect(plugin).toBeDefined();
    const view = viewOf(e);
    const tr = view.state.tr.insertText("z", view.state.doc.content.size - 1);
    const next = view.state.apply(tr);
    expect(plugin?.spec.appendTransaction?.([tr], view.state, next) ?? null).toBeNull();

    view.dispatch(view.state.tr.setMeta("noop", true));
    expect(docOf(e)).toBe(repaired);
    expect(repairLogs()).toHaveLength(logsAfterRepair);
  });
});

describe("D103 — a copy-drag from a cell out into a paragraph", () => {
  it("R-8: the table the drop builds is rectangular, has a header, serializes", async () => {
    const e = await mountParityEditor(MD);
    select(e, "y", "Post");
    const view = viewOf(e);
    const slice = view.state.selection.content();
    const before = docOf(e);

    drop(view, view.state.doc.content.size - 1, { slice, move: false });

    expect(docOf(e).eq(before)).toBe(false);
    const shapes = tables(docOf(e));
    // The source table is kept (a copy), the dropped one follows it.
    expect(shapes).toEqual([
      { cells: [["X1", "X2"], ["y1", "y2"]], problems: null, rows: ["table_header_row", "table_row"] },
      { cells: [["", ""], ["1", "y2"]], problems: null, rows: ["table_header_row", "table_row"] },
    ]);
    expect(serializeError(e)).toBeNull();
    expect(repairLogs().map((l) => l.context)).toEqual([
      { count: 1, widths: [2], trigger: "drop", move: false },
    ]);
  });

  it("R-12: a move-drag of Pre -> y1 repairs the source table, logged as a move drop", async () => {
    const e = await mountParityEditor(MD);
    select(e, "P", "y1");
    const view = viewOf(e);
    const slice = view.state.selection.content();

    drop(view, view.state.doc.content.size - 1, { slice });

    for (const shape of tables(docOf(e))) {
      expect(shape.problems).toBeNull();
      expect(shape.rows[0]).toBe("table_header_row");
    }
    expect(serializeError(e)).toBeNull();
    expect(repairLogs().map((l) => l.context)).toEqual([
      { count: 1, widths: [1], trigger: "drop", move: true },
    ]);
  });
});

describe("D103 — tables the repair must leave alone", () => {
  it("R-9: the schema has no header-less table: the header row is required", async () => {
    const e = await mountParityEditor(MD);
    const { nodes } = viewOf(e).state.schema;
    expect(nodes.table.spec.content).toBe("table_header_row table_row+");
    expect(nodes.table.contentMatch.matchType(nodes.table_row)).toBeNull();
  });

  it("R-10: typing in a cell of a healthy table is not repaired or logged", async () => {
    const e = await mountParityEditor(MD);
    const view = viewOf(e);
    view.dispatch(view.state.tr.insertText("!", posAfter(view, "X1")));
    view.dispatch(view.state.tr.insertText("?", posAfter(view, "y2")));
    expect(tables(docOf(e))).toEqual([
      { cells: [["X1!", "X2"], ["y1", "y2?"]], problems: null, rows: ["table_header_row", "table_row"] },
    ]);
    expect(repairLogs()).toEqual([]);
  });

  it("R-11: a short header row that still has a cell is left to fixTables", async () => {
    const e = await mountParityEditor(MD);
    const view = viewOf(e);
    // Delete the X2 header cell outright: the header keeps X1.
    let from = -1;
    let to = -1;
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === "table_header" && node.textContent === "X2") {
        from = pos;
        to = pos + node.nodeSize;
      }
      return from < 0;
    });
    view.dispatch(view.state.tr.delete(from, to));
    // fixTables pads the short header itself (at the row start, its own rule),
    // with a header cell taken from the row's first child; nothing for the repair.
    const [shape] = tables(docOf(e));
    expect(shape.cells[0]).toHaveLength(2);
    expect(shape.cells[0]).toContain("X1");
    expect(shape.rows).toEqual(["table_header_row", "table_row"]);
    expect(shape.problems).toBeNull();
    expect(serializeError(e)).toBeNull();
    expect(repairLogs()).toEqual([]);
  });
});
