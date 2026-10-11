/**
 * D90: drag-and-drop of a table-carrying slice into a table cell. Drop does not
 * pass through `handlePaste`, so the D83 refusal never saw it.
 *
 * Measured before the fix (real Milkdown, real prosemirror-view drop handler,
 * this driver): prosemirror-view computes `dropPoint` for the slice and calls
 * `tr.replaceRange` there. An HTML slice of paragraph + table + paragraph is
 * open at its paragraph edges, so `dropPoint` keeps the pointer position inside
 * the cell and the replace SPLITS THE HOST TABLE — 3 tables afterwards:
 *   - dropped in a body cell: the host tail has an empty header row and the
 *     markdown serializer throws ("Cannot read properties of undefined (reading
 *     'length')"), so ⌘S fails with "Save failed: editor changes could not be
 *     captured" and the edit-sync flush cannot capture any later edit;
 *   - dropped in a header cell: the tail serializes as `|    | X2 |` — X2 shifted
 *     one column right;
 *   - an internal move-drag also deletes the drag source.
 * A closed pure-table slice is different: `dropPoint` finds no place for a table
 * inside the cell and moves it beside the host table, which stays intact. That
 * drop is left alone.
 *
 * The drop is driven through prosemirror-view's own `drop` handler: a `drop`
 * event dispatched on `view.dom`, with a DataTransfer stub (external drop) or
 * `view.dragging` set (internal drag). Only the layout-dependent
 * `view.posAtCoords` is stubbed (driver: `tests/support/tableDropDriver.ts`).
 * Real Milkdown commonmark + gfm + the parity list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import type { Slice } from "@milkdown/kit/prose/model";
import { type Plugin, TextSelection } from "@milkdown/kit/prose/state";
import { __parseFromClipboard, type EditorView } from "@milkdown/kit/prose/view";
import { loggingService } from "../src/services/loggingService";
import { useToastStore } from "../src/stores/toastStore";
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
import {
  DROP_TOAST,
  drop,
  expectOneRefusal,
  HOST,
  MIXED,
  PASTE_REASON,
  PASTE_TOAST,
  type RefusalLog,
  TABLE,
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

const dropHtml = (e: Editor, needle: string, html: string) =>
  drop(viewOf(e), posAfter(viewOf(e), needle), { html });

const logsOf = (event: string) =>
  logSpy.mock.calls.map((c) => c[0] as RefusalLog).filter((p) => p.event === event);

/** The normalizer's own `handleDrop`, as the editor registered it. */
function handleDropOf(view: EditorView) {
  const plugin = view.state.plugins.find((p: Plugin) =>
    (p as unknown as { key: string }).key.startsWith("MDPRO_TABLE_PASTE_NORMALIZE"),
  );
  const fn = plugin?.props.handleDrop;
  if (!fn) throw new Error("MDPRO_TABLE_PASTE_NORMALIZE handleDrop not registered");
  return fn as (view: EditorView, event: DragEvent, slice: Slice, moved: boolean) => boolean;
}

describe("D90 — a table-carrying drop that would split the host table is refused", () => {
  it("D90-1: mixed slice dropped in a body cell — document unchanged, one table, still serializes", async () => {
    const e = await mountParityEditor(HOST);
    const before = docOf(e);
    const mdBefore = serialize(e);
    expect(() => dropHtml(e, "y1", MIXED)).not.toThrow();
    expect(docOf(e).eq(before)).toBe(true);
    expect(tableShapes(docOf(e))).toHaveLength(1);
    expect(() => serialize(e)).not.toThrow();
    expect(serialize(e)).toBe(mdBefore);
  });

  it("D90-2: mixed slice dropped in a header cell — document unchanged, no value shift", async () => {
    const e = await mountParityEditor(HOST);
    const before = docOf(e);
    dropHtml(e, "X1", MIXED);
    expect(docOf(e).eq(before)).toBe(true);
    expect(tableShapes(docOf(e)).map((s) => s.cells)).toEqual([
      [
        ["X1", "X2"],
        ["y1", "y2"],
      ],
    ]);
  });

  it("D90-3: an internal move-drag into a cell is refused and the drag source is kept", async () => {
    const e = await mountParityEditor(
      `Pre\n\n| s1 | s2 |\n| -- | -- |\n| t1 | t2 |\n\nPost\n\n${HOST}`,
    );
    const view = viewOf(e);
    // A real drag source: the user's selection from "Pre" through "Post", spanning
    // paragraph + the source table + paragraph, outside the host table.
    const from = posAfter(view, "Pre") - "Pre".length;
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, from, posAfter(view, "Post"))),
    );
    const slice = view.state.selection.content();
    expect(slice.content.childCount).toBe(3);
    expect(slice.content.child(1).type.name).toBe("table");
    const before = docOf(e);
    drop(view, posAfter(view, "y1"), { slice });
    expect(docOf(e).eq(before)).toBe(true);
    const cells = tableShapes(docOf(e)).map((s) => s.cells);
    expect(cells).toEqual([
      [
        ["s1", "s2"],
        ["t1", "t2"],
      ],
      [
        ["X1", "X2"],
        ["y1", "y2"],
      ],
    ]);
    expect(docOf(e).firstChild?.textContent).toBe("Pre");
  });

  it("D90-4: the refusal consumes the drop, logs editor.table.drop (start + fail, with a reason) and toasts", async () => {
    const e = await mountParityEditor(HOST);
    expect(dropHtml(e, "y1", MIXED)).toBe(true);
    const logs = logsOf("editor.table.drop");
    expectOneRefusal(logs);
    expect(logs[1].level).toBe("warn");
    expect(typeof logs[1].context?.reason).toBe("string");
    expect(String(logs[1].context?.reason).length).toBeGreaterThan(0);
    expect(logsOf("editor.table.paste")).toHaveLength(0);
    expect(useToastStore.getState().message).toBe(DROP_TOAST);
  });

  it("D90-5: a pointer position the view cannot resolve is not refused", async () => {
    const e = await mountParityEditor(HOST);
    const view = viewOf(e);
    vi.spyOn(view, "posAtCoords").mockReturnValue(null);
    const slice = __parseFromClipboard(view, "", MIXED, false, view.state.doc.resolve(1));
    if (!slice) throw new Error("no slice parsed");
    const event = new Event("drop") as DragEvent;
    expect(handleDropOf(view)(view, event, slice, false)).toBe(false);
    expect(logsOf("editor.table.drop")).toHaveLength(0);
  });
});

describe("D90 — drops that do not split the host are left to prosemirror-view", () => {
  it("D90-6: the same mixed slice dropped outside any table lands (control)", async () => {
    const e = await mountParityEditor("Intro\n\nAnchor\n");
    dropHtml(e, "Anchor", MIXED);
    const shapes = tableShapes(docOf(e));
    expect(shapes).toHaveLength(1);
    expect(shapes[0].cells).toEqual([
      ["h1", "h2"],
      ["a", "b"],
    ]);
    expect(docOf(e).textContent).toContain("after");
    expect(logsOf("editor.table.drop")).toHaveLength(0);
    expect(useToastStore.getState().message).toBeNull();
  });

  it("D90-7: inline content dropped into a cell lands in that cell", async () => {
    const e = await mountParityEditor(HOST);
    dropHtml(e, "y1", "<b>bold</b>");
    expect(tableShapes(docOf(e)).map((s) => s.cells)).toEqual([
      [
        ["X1", "X2"],
        ["y1bold", "y2"],
      ],
    ]);
    expect(logsOf("editor.table.drop")).toHaveLength(0);
  });

  it("D90-8: a closed pure-table slice dropped on a cell lands beside the host, host intact", async () => {
    const e = await mountParityEditor(HOST);
    dropHtml(e, "y1", TABLE);
    const cells = tableShapes(docOf(e)).map((s) => s.cells);
    expect(cells).toHaveLength(2);
    expect(cells).toContainEqual([
      ["X1", "X2"],
      ["y1", "y2"],
    ]);
    expect(cells).toContainEqual([
      ["h1", "h2"],
      ["a", "b"],
    ]);
    expect(() => serialize(e)).not.toThrow();
    expect(logsOf("editor.table.drop")).toHaveLength(0);
  });
});

describe("D90 — the shared refusal keeps the paste refusal as it was", () => {
  it("D90-9: a refused paste still logs editor.table.paste with its shape and the paste toast", async () => {
    const e = await mountParityEditor(HOST);
    caretAfter(e, "y1");
    const view = viewOf(e);
    const slice = __parseFromClipboard(view, "", MIXED, false, view.state.selection.$from);
    if (!slice) throw new Error("no slice parsed");
    const event = new Event("paste") as ClipboardEvent;
    expect(view.someProp("handlePaste", (f) => f(view, event, slice))).toBe(true);
    const logs = logsOf("editor.table.paste");
    expectOneRefusal(logs);
    expect(logs[1].level).toBe("warn");
    expect(logs[1].context).toEqual({ reason: PASTE_REASON, nodes: slice.content.childCount });
    expect(logsOf("editor.table.drop")).toHaveLength(0);
    expect(useToastStore.getState().message).toBe(PASTE_TOAST);
  });
});
