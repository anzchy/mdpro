/**
 * D100 — prosemirror-tables' `fixTables` is not idempotent on a table whose
 * `table_header_row` has no cells. It picks the cell type to add from
 * `row.firstChild`; an empty header row has none, so it tries `table_cell`,
 * which Milkdown's header row (`(table_header)*`) cannot hold, and the insert
 * lands as a new body row instead. The header stays empty, the serializer throws,
 * and the next pass that sees the table appends another body row.
 *
 * The transaction is the one D97 used to break the serializer
 * (tests/d97-tab-close-after-failed-flush.test.tsx, `breakingTr`): append a
 * table whose header row has no cells. Asserted: the header row is filled to the
 * table's width, no body row is appended, the document serializes, and a further
 * transaction changes nothing. Real Milkdown commonmark + gfm + the parity list +
 * history; only the logging boundary is spied.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import type { Node as PmNode } from "@milkdown/kit/prose/model";
import type { Transaction } from "@milkdown/kit/prose/state";
import { loggingService } from "../src/services/loggingService";
import {
  destroyParityEditors,
  docOf,
  mountParityEditor,
  serialize,
  tableShapes,
  viewOf,
} from "./support/raggedTableD64";

const REPAIR_EVENT = "editor.table.header_repair";

beforeEach(() => {
  vi.spyOn(loggingService, "logEventSync").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await destroyParityEditors();
});

const repairLogs = () =>
  vi
    .mocked(loggingService.logEventSync)
    .mock.calls.map(([p]) => p as { event: string; context?: unknown })
    .filter((p) => p.event === REPAIR_EVENT);

/** Append a table: an empty header row, then one body row per entry of `rows`. */
function appendTableTr(e: Editor, rows: string[][]): Transaction {
  const view = viewOf(e);
  const s = view.state.schema;
  const cell = (text: string) =>
    s.nodes.table_cell.create(null, s.nodes.paragraph.create(null, text ? s.text(text) : null));
  const table = s.nodes.table.create(null, [
    s.nodes.table_header_row.create(null, []),
    ...rows.map((r) => s.nodes.table_row.create(null, r.map(cell))),
  ]);
  return view.state.tr.insert(view.state.doc.content.size, table);
}

function rowTypes(doc: PmNode): string[][] {
  const out: string[][] = [];
  doc.descendants((node) => {
    if (node.type.name !== "table") return true;
    const types: string[] = [];
    node.forEach((row) => types.push(row.type.name));
    out.push(types);
    return false;
  });
  return out;
}

describe("D100 — a transaction that leaves a table's header row without cells", () => {
  it("D100-1: the D97 table — header filled to width 1, no body row appended", async () => {
    const e = await mountParityEditor("Intro\n");
    viewOf(e).dispatch(appendTableTr(e, [["LOSTCELL"]]));

    const shapes = tableShapes(docOf(e));
    expect(shapes.map((s) => ({ cells: s.cells, problems: s.problems }))).toEqual([
      { cells: [[""], ["LOSTCELL"]], problems: null },
    ]);
    expect(rowTypes(docOf(e))).toEqual([["table_header_row", "table_row"]]);
    expect(() => serialize(e)).not.toThrow();
    expect(serialize(e)).toContain("LOSTCELL");
    expect(repairLogs()).toHaveLength(1);
    expect(repairLogs()[0].context).toEqual({ count: 1, widths: [1], trigger: "edit" });
  });

  it("D100-2: a wider table — header filled to the widest row", async () => {
    const e = await mountParityEditor("Intro\n");
    viewOf(e).dispatch(appendTableTr(e, [["a", "b", "c"], ["d", "e", "f"]]));

    expect(tableShapes(docOf(e)).map((s) => s.cells)).toEqual([
      [["", "", ""], ["a", "b", "c"], ["d", "e", "f"]],
    ]);
    expect(repairLogs()).toEqual([
      expect.objectContaining({ context: { count: 1, widths: [3], trigger: "edit" } }),
    ]);
    expect(() => serialize(e)).not.toThrow();
  });

  it("D100-3: a further transaction changes nothing and logs nothing", async () => {
    const e = await mountParityEditor("Intro\n");
    const view = viewOf(e);
    view.dispatch(appendTableTr(e, [["LOSTCELL"]]));
    const repaired = docOf(e);

    view.dispatch(view.state.tr.setMeta("noop", true));
    view.dispatch(view.state.tr.insertText("!", 1)); // an edit outside the table
    expect(tableShapes(docOf(e)).map((s) => s.cells)).toEqual([[[""], ["LOSTCELL"]]]);
    expect(docOf(e).lastChild?.eq(repaired.lastChild as PmNode)).toBe(true);
    expect(repairLogs()).toHaveLength(1);
  });

  it("D100-4: a table with no cell at all is left to fixTables, which removes it", async () => {
    const e = await mountParityEditor("Intro\n");
    viewOf(e).dispatch(appendTableTr(e, [[]]));

    expect(tableShapes(docOf(e))).toEqual([]);
    expect(() => serialize(e)).not.toThrow();
    expect(repairLogs()).toEqual([]);
  });
});
