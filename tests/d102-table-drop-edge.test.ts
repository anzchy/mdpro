/**
 * D102 (from the D94 audit).
 *
 * ① D94 refused a table-carrying drop whenever the insert position had a table
 * ancestor. At the table's outer-edge chain — table content start, first row
 * start, last row end, table content end — prosemirror-view's default
 * `replaceRange` lands the slice BESIDE the host table and leaves it intact, so
 * that refusal was needless. The full position scan below is the oracle: at
 * every position of the host document a drop either is refused with the
 * document unchanged, or lands with the host intact and the document still
 * serializing; and the refused set is pinned exactly.
 *
 * ② A paste with a TextSelection whose head sits between two rows would slip
 * past `isInTable` and split the host. The tests below pin why a user cannot
 * hold that selection: every way the view derives a selection from a position
 * (the DOM selection read, `TextSelection.between`, `Selection.near`, mapping
 * through a transaction) moves it into a cell's inline content, and a
 * GapCursor is not valid there (no gapcursor plugin is registered either).
 *
 * Driver: `tests/support/tableDropDriver.ts` (real prosemirror-view drop
 * handler, only `posAtCoords` stubbed). Real Milkdown + the parity list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Node as PmNode } from "@milkdown/kit/prose/model";
import { GapCursor } from "@milkdown/kit/prose/gapcursor";
import { Selection, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { loggingService } from "../src/services/loggingService";
import { useToastStore } from "../src/stores/toastStore";
import {
  destroyParityEditors,
  docOf,
  mountParityEditor,
  posAfter,
  serialize,
  tableShapes,
  viewOf,
} from "./support/raggedTableD64";
import {
  DROPPED_CELLS,
  drop,
  expectLandsAt,
  HOST,
  inTableNonCellPositions,
  MIXED,
} from "./support/tableDropDriver";

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  useToastStore.getState().clearToast();
  logSpy = vi.spyOn(loggingService, "logEventSync").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  useToastStore.getState().clearToast();
  await destroyParityEditors();
});

const dropLogs = () =>
  logSpy.mock.calls
    .map((c) => c[0] as { event: string; status: string })
    .filter((p) => p.event === "editor.table.drop");

const HOST_CELLS = [
  ["X1", "X2"],
  ["y1", "y2"],
];

/** Positions `from`..`to` inclusive. */
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** Position of the last table in `doc`. */
function lastTablePos(doc: PmNode): number {
  let at = -1;
  doc.descendants((node, pos) => {
    if (node.type.name === "table") at = pos;
    return node.type.name !== "table";
  });
  return at;
}

describe("D102 ① — a drop at the table's outer-edge chain lands beside the intact host", () => {
  it.each([
    ["D102-1", 1, "table content start"],
    ["D102-2", 2, "first row start"],
    ["D102-3", 28, "last row end"],
    ["D102-4", 29, "table content end"],
  ])("%s: dropped at %i (%s) — not refused, two tables, host intact, serializes", async (_id, pos) => {
    await expectLandsAt(HOST, pos as number, dropLogs);
  });

  it("D102-5: full scan — every position is refused unchanged or lands safely; the refused set is pinned", async () => {
    const e0 = await mountParityEditor(HOST);
    const size = docOf(e0).content.size;
    await destroyParityEditors();
    expect(size).toBe(30);
    const refused: number[] = [];
    for (const pos of range(0, size)) {
      const e = await mountParityEditor(HOST);
      const before = docOf(e);
      drop(viewOf(e), pos, { html: MIXED });
      const logs = dropLogs();
      if (logs.length > 0) {
        refused.push(pos);
        expect(logs).toHaveLength(1);
        expect(docOf(e).eq(before), `doc changed at ${pos}`).toBe(true);
      } else {
        const cells = tableShapes(docOf(e)).map((s) => s.cells);
        expect(cells, `tables after a drop at ${pos}`).toHaveLength(2);
        expect(cells).toContainEqual(HOST_CELLS);
        expect(cells).toContainEqual(DROPPED_CELLS);
        expect(() => serialize(e), `serialize after a drop at ${pos}`).not.toThrow();
      }
      await destroyParityEditors();
      logSpy.mockClear();
      useToastStore.getState().clearToast();
    }
    // Refused: everything that splits the host — inside the header cells, every
    // interior boundary, and the body cells up to the end of y2's paragraph.
    // Lands: the doc-level edges (0, 30), the outer-edge chain (1, 2, 28, 29),
    // and 27 (y2's cell content end), where the insert also goes after the table.
    expect(refused).toEqual(range(3, 26));
  });

  it("D102-6: a move-drag from outside onto the host's content start lands and the source moves", async () => {
    const e = await mountParityEditor(
      `Pre\n\n| s1 | s2 |\n| -- | -- |\n| t1 | t2 |\n\nPost\n\n${HOST}`,
    );
    const view = viewOf(e);
    const from = posAfter(view, "Pre") - "Pre".length;
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, from, posAfter(view, "Post"))),
    );
    const slice = view.state.selection.content();
    expect(slice.content.child(1).type.name).toBe("table");
    drop(view, lastTablePos(view.state.doc) + 1, { slice });
    expect(dropLogs()).toHaveLength(0);
    const cells = tableShapes(docOf(e)).map((s) => s.cells);
    expect(cells).toHaveLength(2);
    expect(cells).toContainEqual(HOST_CELLS);
    expect(cells).toContainEqual([
      ["s1", "s2"],
      ["t1", "t2"],
    ]);
    expect(() => serialize(e)).not.toThrow();
  });

  it("D102-7: the same move-drag between the host's rows is refused and the source is kept", async () => {
    const e = await mountParityEditor(
      `Pre\n\n| s1 | s2 |\n| -- | -- |\n| t1 | t2 |\n\nPost\n\n${HOST}`,
    );
    const view = viewOf(e);
    const from = posAfter(view, "Pre") - "Pre".length;
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, from, posAfter(view, "Post"))),
    );
    const slice = view.state.selection.content();
    const before = docOf(e);
    // HOST's between-rows boundary is 15 table-relative positions in.
    expect(drop(view, lastTablePos(before) + 15, { slice })).toBe(true);
    expect(docOf(e).eq(before)).toBe(true);
    expect(dropLogs()).toHaveLength(1);
  });
});

/** Put the DOM caret at document position `pos` and let the view read it back. */
function caretFromDom(view: EditorView, pos: number): Selection {
  const { node, offset } = view.domAtPos(pos);
  const sel = document.getSelection();
  if (!sel) throw new Error("no DOM selection");
  const r = document.createRange();
  r.setStart(node, offset);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  document.dispatchEvent(new Event("selectionchange"));
  return view.state.selection;
}

describe("D102 ② — a selection between rows cannot be held, so a paste cannot slip past isInTable", () => {
  it("D102-8: a DOM caret at any in-table non-cell position is read back inside a cell's text", async () => {
    const e = await mountParityEditor(HOST);
    const view = viewOf(e);
    // jsdom has no layout; the view scrolls the read selection into view.
    // @ts-expect-error -- scrollToSelection is internal: prosemirror-view's .d.ts omits it.
    vi.spyOn(view, "scrollToSelection").mockImplementation(() => {});
    view.focus();
    expect(view.hasFocus()).toBe(true);
    const positions = inTableNonCellPositions(docOf(e));
    expect(positions).toContain(15);
    for (const pos of positions) {
      // Non-vacuous: the DOM point really maps to the boundary position.
      const { node, offset } = view.domAtPos(pos);
      expect(view.posAtDOM(node, offset)).toBe(pos);
      const read = caretFromDom(view, pos);
      expect(read, `read at ${pos}`).toBeInstanceOf(TextSelection);
      expect(read.$head.parent.inlineContent, `head of the read at ${pos}`).toBe(true);
      expect(read.head).not.toBe(pos);
    }
  });

  it("D102-9: between / near / mapping all move a boundary position into a cell's inline content", async () => {
    const e = await mountParityEditor(HOST);
    const view = viewOf(e);
    const doc = docOf(e);
    for (const pos of inTableNonCellPositions(doc)) {
      const $p = doc.resolve(pos);
      expect($p.parent.inlineContent).toBe(false);
      expect(TextSelection.between($p, $p).$head.parent.inlineContent, `between ${pos}`).toBe(true);
      expect(Selection.near($p).$head.parent.inlineContent, `near ${pos}`).toBe(true);
      // Only an explicit TextSelection.create holds the boundary; the next
      // transaction maps it, and mapping normalizes it into a cell.
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
      expect(view.state.selection.head).toBe(pos);
      const at = posAfter(view, "X1");
      view.dispatch(view.state.tr.insertText("z", at));
      expect(view.state.selection.$head.parent.inlineContent, `mapped ${pos}`).toBe(true);
      view.dispatch(view.state.tr.delete(at, at + 1));
      expect(view.state.doc.eq(doc)).toBe(true);
    }
  });

  it("D102-10: a GapCursor is not valid at any in-table non-cell position", async () => {
    const e = await mountParityEditor(HOST);
    const doc = docOf(e);
    for (const pos of inTableNonCellPositions(doc)) {
      // @ts-expect-error -- GapCursor.valid is the static check its plugin uses; not in the .d.ts.
      expect(GapCursor.valid(doc.resolve(pos)), `gap cursor at ${pos}`).toBe(false);
    }
    // No gapcursor plugin is registered, so nothing would create one anyway.
    const keys = viewOf(e).state.plugins.map((p) => (p as unknown as { key: string }).key);
    expect(keys.some((k) => k.startsWith("gapcursor") || k.startsWith("gap-cursor"))).toBe(false);
    // prosemirror-gapcursor's plugin has no named key, so the key check alone is
    // weak. The prop it would create a GapCursor through answers none here.
    const view = viewOf(e);
    for (const pos of inTableNonCellPositions(doc)) {
      const $p = doc.resolve(pos);
      const made = view.someProp("createSelectionBetween", (f) => f(view, $p, $p));
      expect(made instanceof GapCursor, `createSelectionBetween at ${pos}`).toBe(false);
    }
  });
});
