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
 * `view.posAtCoords` is stubbed. Real Milkdown commonmark + gfm + the parity list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { Slice } from "@milkdown/kit/prose/model";
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

const DROP_TOAST = "A table can't be dropped inside a table cell. Drop it outside the table.";
const PASTE_TOAST = "A table can't be pasted inside a table cell. Paste it outside the table.";

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

const row = (tag: "th" | "td", cells: string[]) =>
  `<tr>${cells.map((c) => `<${tag}>${c}</${tag}>`).join("")}</tr>`;

const TABLE =
  `<table><thead>${row("th", ["h1", "h2"])}</thead>` +
  `<tbody>${row("td", ["a", "b"])}</tbody></table>`;

const MIXED = `<p>before</p>${TABLE}<p>after</p>`;

/** An existing rectangular table whose values share nothing with the dropped one. */
const HOST = "| X1 | X2 |\n| -- | -- |\n| y1 | y2 |\n";

interface DropOptions {
  /** External drop: the dataTransfer's `text/html`. */
  html?: string;
  /** Internal drag: the slice prosemirror-view holds in `view.dragging`. */
  slice?: Slice;
}

/**
 * Drop at document position `pos` through prosemirror-view's drop handler.
 * Returns whether the event's default was prevented.
 */
function drop(view: EditorView, pos: number, opts: DropOptions): boolean {
  vi.spyOn(view, "posAtCoords").mockReturnValue({ pos, inside: -1 });
  if (opts.slice) {
    (view as unknown as { dragging: unknown }).dragging = { slice: opts.slice, move: true };
  }
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientX: { value: 10 },
    clientY: { value: 20 },
    dataTransfer: {
      value: {
        getData: (type: string) => (type === "text/html" ? (opts.html ?? "") : ""),
        files: [],
        types: opts.html ? ["text/html"] : [],
      },
    },
  });
  view.dom.dispatchEvent(event);
  return event.defaultPrevented;
}

const dropHtml = (e: Editor, needle: string, html: string) =>
  drop(viewOf(e), posAfter(viewOf(e), needle), { html });

type LogPayload = {
  level: string;
  event: string;
  status: string;
  context?: Record<string, unknown>;
};

const logsOf = (event: string) =>
  logSpy.mock.calls.map((c) => c[0] as LogPayload).filter((p) => p.event === event);

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
    const e = await mountParityEditor(`Src para\n\n${HOST}`);
    const view = viewOf(e);
    const slice = __parseFromClipboard(view, "", MIXED, false, view.state.doc.resolve(1));
    if (!slice) throw new Error("no slice parsed");
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, posAfter(view, "Src"))),
    );
    const before = docOf(e);
    drop(view, posAfter(view, "y1"), { slice });
    expect(docOf(e).eq(before)).toBe(true);
    expect(docOf(e).firstChild?.textContent).toBe("Src para");
  });

  it("D90-4: the refusal consumes the drop, logs editor.table.drop (fail, with a reason) and toasts", async () => {
    const e = await mountParityEditor(HOST);
    expect(dropHtml(e, "y1", MIXED)).toBe(true);
    const logs = logsOf("editor.table.drop");
    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe("warn");
    expect(logs[0].status).toBe("fail");
    expect(typeof logs[0].context?.reason).toBe("string");
    expect(String(logs[0].context?.reason).length).toBeGreaterThan(0);
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
    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe("warn");
    expect(logs[0].status).toBe("fail");
    expect(logs[0].context).toEqual({
      reason: "table in a non-cell slice pasted inside a table would split the host table",
      nodes: slice.content.childCount,
    });
    expect(logsOf("editor.table.drop")).toHaveLength(0);
    expect(useToastStore.getState().message).toBe(PASTE_TOAST);
  });
});
