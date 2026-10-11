/**
 * D108 ① — pins an accepted interaction between the empty-header repair (D103) and
 * Milkdown preset-commonmark's `syncListOrderPlugin`.
 *
 * `syncListOrderPlugin.appendTransaction` returns null for any batch in which some
 * transaction has `addToHistory === false` or is not `isGeneric` (carries any meta).
 * ProseMirror stamps every appended transaction with `appendedTransaction` meta, and the
 * repair plugin runs first, so in a batch where the repair appends, the list plugin sees
 * [root, repair] and bails. A single transaction that both deletes the first item of an
 * ordered list and empties a table header therefore leaves the remaining item labelled
 * `2.` until the next ordinary transaction, whose batch the list plugin does process.
 *
 * Accepted, not fixed (D108): the repair cannot become part of the root transaction from
 * `appendTransaction`, and the same bail already happens for any batch in which
 * `fixTables` (or any other plugin) appends. If this test starts failing because the
 * label is right immediately, the transient is gone: update the test and the ledger line.
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
  posAfter,
  serialize,
  tableShapes,
  viewOf,
} from "./support/raggedTableD64";

const MD = "1. one\n2. two\n\n| X1 | X2 |\n| -- | -- |\n| y1 | y2 |\n";
const REPAIR_EVENT = "editor.table.header_repair";

beforeEach(() => {
  vi.spyOn(loggingService, "logEventSync").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await destroyParityEditors();
});

const repairCount = () =>
  vi
    .mocked(loggingService.logEventSync)
    .mock.calls.filter(([p]) => (p as { event: string }).event === REPAIR_EVENT).length;

const labels = (doc: PmNode): string[] => {
  const out: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === "list_item") out.push(String(node.attrs.label));
    return true;
  });
  return out;
};

function findFirst(doc: PmNode, type: string): { pos: number; node: PmNode } {
  let hit: { pos: number; node: PmNode } | null = null;
  doc.descendants((node, pos) => {
    if (!hit && node.type.name === type) hit = { pos, node };
    return !hit;
  });
  if (!hit) throw new Error(`no ${type}`);
  return hit;
}

/** Delete the first list item, and (optionally) every cell of the header row, in ONE tr. */
function deleteFirstItemTr(e: Editor, alsoEmptyHeader: boolean): Transaction {
  const { state } = viewOf(e);
  const tr = state.tr;
  if (alsoEmptyHeader) {
    // The header row comes after the list: delete it first so the list positions hold.
    const header = findFirst(state.doc, "table_header_row");
    tr.delete(header.pos + 1, header.pos + header.node.nodeSize - 1);
  }
  const item = findFirst(state.doc, "list_item");
  tr.delete(item.pos, item.pos + item.node.nodeSize);
  return tr;
}

describe("D108 ① — ordered-list labels in a batch where the header repair appends", () => {
  it("L-0: the fixture starts numbered 1., 2.", async () => {
    const e = await mountParityEditor(MD);
    expect(labels(docOf(e))).toEqual(["1.", "2."]);
  });

  it("L-1 (control): deleting the first item alone renumbers the rest in the same batch", async () => {
    const e = await mountParityEditor(MD);
    viewOf(e).dispatch(deleteFirstItemTr(e, false));
    expect(labels(docOf(e))).toEqual(["1."]);
    expect(repairCount()).toBe(0);
  });

  it("L-2: deleting the first item AND emptying the header leaves '2.' for that batch", async () => {
    const e = await mountParityEditor(MD);
    viewOf(e).dispatch(deleteFirstItemTr(e, true));

    // The repair ran (header refilled, document serializes)...
    expect(repairCount()).toBe(1);
    expect(tableShapes(docOf(e)).map((s) => s.cells)).toEqual([[["", ""], ["y1", "y2"]]]);
    expect(() => serialize(e)).not.toThrow();
    // ...and the list plugin skipped the batch: the label is stale.
    expect(labels(docOf(e))).toEqual(["2."]);
  });

  it("L-3: the next ordinary transaction renumbers the list", async () => {
    const e = await mountParityEditor(MD);
    const view = viewOf(e);
    view.dispatch(deleteFirstItemTr(e, true));
    expect(labels(docOf(e))).toEqual(["2."]);

    view.dispatch(view.state.tr.insertText("!", posAfter(view, "two")));
    expect(labels(docOf(e))).toEqual(["1."]);
    expect(repairCount()).toBe(1); // the follow-up appended no repair
  });
});
