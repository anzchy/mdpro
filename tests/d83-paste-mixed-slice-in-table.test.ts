/**
 * D83 (BLOCK path): an HTML paste whose caret is inside a table, carrying a slice
 * prosemirror-tables does not take as cells — e.g. paragraph, table, paragraph.
 *
 * Measured before the fix (real Milkdown, this driver): `handlePaste` declines
 * the slice (`pastedCells` → null), and `replaceSelection` cannot put a table in
 * a cell, so it closes the cell, row and table — it SPLITS THE HOST TABLE around
 * the pasted content. The host's trailing fragment is ragged and `fixTables`
 * repairs it at the row start:
 *   - caret in a header cell: the tail serializes as `|    | X2 |` — X2 shifted
 *     one column right;
 *   - caret in a body cell: the tail has an empty header row and the serializer
 *     throws — the document can no longer be saved.
 * End-padding the pasted table first changes neither outcome (it already came out
 * rectangular), so the paste is refused: the document is left unchanged, the
 * refusal is logged as `editor.table.paste` (a "start" and a "fail" under one
 * actionId), and a toast says why.
 *
 * Shapes prosemirror-tables takes itself (a CellSelection, or a slice its
 * `pastedCells` accepts) are left to it, untouched by the normalizer.
 *
 * Paste is driven the way prosemirror-view's doPaste does it (same driver as
 * tests/table-paste-normalize.test.ts): parseFromClipboard → handlePaste →
 * replaceSelection(With). Real Milkdown commonmark + gfm + the parity list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { Fragment, Slice } from "@milkdown/kit/prose/model";
import { type Plugin, TextSelection } from "@milkdown/kit/prose/state";
import { CellSelection } from "@milkdown/kit/prose/tables";
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
import { expectOneRefusal, PASTE_TOAST, type RefusalLog } from "./support/tableDropDriver";

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

function paste(e: Editor, text: string, html: string | null, preferPlain: boolean): void {
  const view = viewOf(e);
  const slice = __parseFromClipboard(view, text, html, preferPlain, view.state.selection.$from);
  const event = new Event("paste") as ClipboardEvent;
  if (view.someProp("handlePaste", (f) => f(view, event, slice ?? Slice.empty))) return;
  if (!slice) return;
  const single =
    slice.openStart === 0 && slice.openEnd === 0 && slice.content.childCount === 1
      ? slice.content.firstChild
      : null;
  const tr = single
    ? view.state.tr.replaceSelectionWith(single, preferPlain)
    : view.state.tr.replaceSelection(slice);
  view.dispatch(tr.scrollIntoView().setMeta("paste", true).setMeta("uiEvent", "paste"));
}

const pasteHtml = (e: Editor, html: string) => paste(e, "", html, false);

/** The normalizer's own `transformPasted`, as the editor registered it. */
function transformPastedOf(view: EditorView): (slice: Slice, view: EditorView, plain: boolean) => Slice {
  const plugin = view.state.plugins.find((p: Plugin) =>
    (p as unknown as { key: string }).key.startsWith("MDPRO_TABLE_PASTE_NORMALIZE"),
  );
  const fn = plugin?.props.transformPasted;
  if (!fn) throw new Error("MDPRO_TABLE_PASTE_NORMALIZE transformPasted not registered");
  return fn as (slice: Slice, view: EditorView, plain: boolean) => Slice;
}

/** `editor.table.paste` calls the spy saw. */
const tablePasteLogs = () =>
  logSpy.mock.calls
    .map((c) => c[0] as RefusalLog)
    .filter((p) => p.event === "editor.table.paste");

const row = (tag: "th" | "td", cells: string[]) =>
  `<tr>${cells.map((c) => `<${tag}>${c}</${tag}>`).join("")}</tr>`;

/** Header h1,h2; body rows of 3 and 1 cells — one overflow row, one short row. */
const RAGGED =
  `<table><thead>${row("th", ["h1", "h2"])}</thead>` +
  `<tbody>${row("td", ["a", "b", "c"])}${row("td", ["d"])}</tbody></table>`;

const MIXED = `<p>before</p>${RAGGED}<p>after</p>`;

const RECT_MIXED =
  `<p>before</p><table><thead>${row("th", ["h1", "h2"])}</thead>` +
  `<tbody>${row("td", ["a", "b"])}</tbody></table><p>after</p>`;

/** An existing rectangular table whose values share nothing with the pasted one. */
const HOST = "| X1 | X2 |\n| -- | -- |\n| y1 | y2 |\n";

/** Serialized table lines that start with an empty cell (`|` then only spaces then `|`). */
const leadingEmptyCellLines = (md: string) => md.split("\n").filter((l) => /^\|\s*\|/.test(l));

/** A copy source: header s1/s2, then two body rows q and r. */
const SOURCE = "| s1 | s2 |\n| -- | -- |\n| q1 | q2 |\n| r1 | r2 |\n";
const SOURCE_CELLS = [
  ["s1", "s2"],
  ["q1", "q2"],
  ["r1", "r2"],
];

/** Position before the cell holding `needle`. */
function cellPosOf(view: EditorView, needle: string): number {
  const $p = view.state.doc.resolve(posAfter(view, needle));
  let d = $p.depth;
  while (d > 0 && !/table_(cell|header)/.test($p.node(d).type.name)) d -= 1;
  return $p.before(d);
}

/**
 * Select the cells from `fromNeedle` to `toNeedle` as a CellSelection and copy
 * them through prosemirror-view's own copy handler; returns the clipboard HTML.
 */
function copyCells(view: EditorView, fromNeedle: string, toNeedle: string): string {
  const sel = CellSelection.create(view.state.doc, cellPosOf(view, fromNeedle), cellPosOf(view, toNeedle));
  view.dispatch(view.state.tr.setSelection(sel));
  const data = new Map<string, string>();
  const event = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { clearData: () => data.clear(), setData: (t: string, v: string) => data.set(t, v) },
  });
  view.dom.dispatchEvent(event);
  const html = data.get("text/html");
  if (!html) throw new Error("copy produced no text/html");
  return html;
}

/** D83-3: RAGGED pasted as cells at (1, 0), end-padded to width 3. */
const D83_3_CELLS = [
  ["X1", "X2", ""],
  ["h1", "h2", ""],
  ["a", "b", "c"],
  ["d", "", ""],
];

/** D83-3's host rows as serialized: values in their columns (delimiter row not pinned). */
const D83_3_ROWS = ["| X1 | X2 |    |", "| h1 | h2 |    |", "| a  | b  | c  |", "| d  |    |    |"];

describe("D83 — a table-carrying slice that would split the host table is refused", () => {
  it("D83-1: caret in a body cell — the document is left unchanged", async () => {
    const e = await mountParityEditor(HOST);
    caretAfter(e, "y1");
    const before = docOf(e);
    expect(() => pasteHtml(e, MIXED)).not.toThrow();
    expect(docOf(e).eq(before)).toBe(true);
    expect(tableShapes(docOf(e))).toHaveLength(1);
  });

  it("D83-2: caret in a header cell — the document is left unchanged", async () => {
    const e = await mountParityEditor(HOST);
    caretAfter(e, "X1");
    const before = docOf(e);
    expect(() => pasteHtml(e, MIXED)).not.toThrow();
    expect(docOf(e).eq(before)).toBe(true);
  });

  it("D83-5: after the refused body-cell paste the markdown still serializes, byte-identical, no <br", async () => {
    const e = await mountParityEditor(HOST);
    const mdBefore = serialize(e);
    caretAfter(e, "y1");
    pasteHtml(e, MIXED);
    expect(() => serialize(e)).not.toThrow();
    const md = serialize(e);
    expect(md).not.toContain("<br");
    expect(md).toBe(mdBefore);
  });

  it("D83-6: serialized host rows keep every value in its column — no leading empty cell (header caret)", async () => {
    const e = await mountParityEditor(HOST);
    caretAfter(e, "X1");
    pasteHtml(e, MIXED);
    const md = serialize(e);
    expect(leadingEmptyCellLines(md)).toEqual([]);
    const lines = md.split("\n").filter((l) => l.startsWith("|") && !/^\|\s*:?-+/.test(l));
    const cells = lines.map((l) =>
      l
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((c) => c.trim()),
    );
    expect(cells).toEqual([
      ["X1", "X2"],
      ["y1", "y2"],
    ]);
  });

  it("D83-8: the refusal is logged as editor.table.paste (start + fail, with a reason) and toasted", async () => {
    const e = await mountParityEditor(HOST);
    caretAfter(e, "y1");
    pasteHtml(e, MIXED);
    const logs = tablePasteLogs();
    expectOneRefusal(logs);
    expect(typeof logs[1].context?.reason).toBe("string");
    expect(String(logs[1].context?.reason).length).toBeGreaterThan(0);
    expect(useToastStore.getState().message).toBe(PASTE_TOAST);
  });

  it("D83-9: a rectangular table in a mixed slice is refused too — the split does not need raggedness", async () => {
    const e = await mountParityEditor(HOST);
    caretAfter(e, "y1");
    const before = docOf(e);
    pasteHtml(e, RECT_MIXED);
    expect(docOf(e).eq(before)).toBe(true);
    expectOneRefusal(tablePasteLogs());
  });

  it("D83-10: with a text range selected in the cell, the refusal does not delete the selection", async () => {
    const e = await mountParityEditor(HOST);
    const view = viewOf(e);
    const end = posAfter(view, "y1");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end - 2, end)));
    const before = docOf(e);
    const selBefore = view.state.selection;
    expect(selBefore.empty).toBe(false);
    pasteHtml(e, MIXED);
    expect(docOf(e).eq(before)).toBe(true);
    // The selected range is neither deleted nor collapsed by the refusal.
    expect(view.state.selection.eq(selBefore)).toBe(true);
  });
});

describe("D83 — slices prosemirror-tables takes itself are left to it", () => {
  it("D83-3: a pure ragged table slice in a cell is skipped by the normalizer and lands rectangular", async () => {
    const e = await mountParityEditor(HOST);
    caretAfter(e, "y1");
    const view = viewOf(e);
    const slice = __parseFromClipboard(view, "", RAGGED, false, view.state.selection.$from);
    const rawTable = slice?.content.firstChild;
    if (!rawTable) throw new Error("no table parsed");
    // Re-running transformPasted on the raw table must hand back the very same
    // slice — no header-cell padding (padding made insertCells throw, P-6).
    const raw = new Slice(Fragment.from(rawTable), 0, 0);
    expect(transformPastedOf(view)(raw, view, false)).toBe(raw);
    expect(() => pasteHtml(e, RAGGED)).not.toThrow();
    for (const shape of tableShapes(docOf(e))) expect(shape.problems).toBeNull();
    expect(tablePasteLogs()).toHaveLength(0);
    // The values landed as cells from the caret's cell (1, 0), end-padded by
    // prosemirror-tables to the paste's width; the header row is kept.
    const shapes = tableShapes(docOf(e));
    expect(shapes).toHaveLength(1);
    expect(shapes[0].cells).toEqual(D83_3_CELLS);
    const md = serialize(e).trimEnd().split("\n");
    expect([md[0], ...md.slice(2)]).toEqual(D83_3_ROWS);
  });

  it("D83-4: an open slice of table rows is passed through untouched", async () => {
    const e = await mountParityEditor(HOST);
    caretAfter(e, "y1");
    const view = viewOf(e);
    const hostTable = docOf(e).firstChild;
    if (!hostTable || hostTable.type.name !== "table") throw new Error("host table missing");
    const bodyRow = hostTable.child(1);
    const rows = new Slice(Fragment.from([bodyRow, bodyRow]), 1, 1);
    expect(transformPastedOf(view)(rows, view, false)).toBe(rows);
  });

  it("D83-4b: copied open body rows pasted in a cell land as cells at the caret, host values kept", async () => {
    const e = await mountParityEditor(`${HOST}\n${SOURCE}`);
    const view = viewOf(e);
    // A real copy: a CellSelection over the source table's two body rows,
    // through prosemirror-view's own copy handler — an open slice of rows.
    const html = copyCells(view, "q1", "r2");
    expect(html).toContain("data-pm-slice");
    const parsed = __parseFromClipboard(view, "", html, false, view.state.doc.resolve(posAfter(view, "y2")));
    expect(parsed?.openStart).toBeGreaterThan(0);
    expect(parsed?.content.firstChild?.type.name).not.toBe("paragraph");
    caretAfter(e, "y2");
    paste(e, "", html, false);
    expect(tablePasteLogs()).toHaveLength(0);
    const shapes = tableShapes(docOf(e));
    expect(shapes).toHaveLength(2);
    for (const shape of shapes) expect(shape.problems).toBeNull();
    // Written from the caret's cell (1, 1): q1 in column 1, q2 widening to
    // column 2; r1/r2 in a new row at the same columns. X1, X2 and y1 kept.
    expect(shapes[0].cells).toEqual([
      ["X1", "X2", ""],
      ["y1", "q1", "q2"],
      ["", "r1", "r2"],
    ]);
    // The copy source is untouched.
    expect(shapes[1].cells).toEqual(SOURCE_CELLS);
    const hostLines = serialize(e).split("\n").slice(0, 4);
    expect(hostLines[0]).toMatch(/^\| X1 \| X2 \| +\|$/);
    expect(hostLines[2]).toBe("| y1 | q1 | q2 |");
    expect(hostLines[3]).toMatch(/^\| +\| r1 \| r2 \|$/);
  });

  it("D83-11: a mixed slice over a CellSelection is left to prosemirror-tables — not refused", async () => {
    const e = await mountParityEditor(HOST);
    const view = viewOf(e);
    const $cell = view.state.doc.resolve(posAfter(view, "y1"));
    const cellPos = $cell.before($cell.depth - 1);
    view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, cellPos)));
    expect(() => pasteHtml(e, MIXED)).not.toThrow();
    expect(tablePasteLogs()).toHaveLength(0);
    for (const shape of tableShapes(docOf(e))) expect(shape.problems).toBeNull();
    // prosemirror-tables fits the whole slice into the selected cell (1, 0):
    // the paste lands there, every other host value is kept.
    const shapes = tableShapes(docOf(e));
    expect(shapes).toHaveLength(1);
    expect(shapes[0].cells[0]).toEqual(["X1", "X2"]);
    expect(shapes[0].cells[1][1]).toBe("y2");
    expect(shapes[0].cells[1][0]).toMatch(/^before/);
  });

  it("D83-7: the same mixed slice pasted outside any table is end-padded, not refused (control)", async () => {
    const e = await mountParityEditor("Intro.\n\nAnchor\n");
    caretAfter(e, "Anchor");
    pasteHtml(e, MIXED);
    const shapes = tableShapes(docOf(e));
    expect(shapes).toHaveLength(1);
    expect(shapes[0].problems).toBeNull();
    expect(shapes[0].cells).toEqual([
      ["h1", "h2", ""],
      ["a", "b", "c"],
      ["d", "", ""],
    ]);
    expect(tablePasteLogs()).toHaveLength(0);
  });
});
