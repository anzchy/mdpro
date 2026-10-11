/**
 * D136: a table-carrying slice that prosemirror-tables does not take as cells
 * (`pastedCells` → null — e.g. paragraph, table, paragraph), pasted while the
 * selection is a CellSelection.
 *
 * Measured before the fix (real Milkdown, this driver): prosemirror-tables'
 * `handlePaste` — registered by gfm's `tableEditing`, ahead of the parity list —
 * takes every CellSelection paste. It fits the whole slice into one cell
 * (`fitSlice`), so only "before" lands in each selected body cell; the table and
 * "after" are dropped with no notice. A selection that covers a header cell
 * throws `RangeError: Not a table node` out of `insertCells` instead. D83's
 * refusal never ran: its `handlePaste` sits after `tableEditing`'s.
 *
 * Fixed: refused like D83 — document and selection unchanged, `editor.table.paste`
 * logged as `start` + `fail` under one actionId with the CellSelection reason, and
 * a toast that says the content cannot go over selected cells. A pure cell-shaped
 * slice (copied cells) over a CellSelection still fills those cells.
 *
 * Paste is driven the way prosemirror-view's doPaste does it (same driver as
 * tests/d83-paste-mixed-slice-in-table.test.ts). Only `logEventSync` is stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { Slice } from "@milkdown/kit/prose/model";
import { __parseFromClipboard } from "@milkdown/kit/prose/view";
import { loggingService } from "../src/services/loggingService";
import { useToastStore } from "../src/stores/toastStore";
import { destroyParityEditors, docOf, mountParityEditor, tableShapes, viewOf } from "./support/raggedTableD64";
import {
  CELL_PASTE_REASON,
  CELL_PASTE_TOAST,
  copyCells,
  expectOneRefusal,
  HOST,
  MIXED,
  type RefusalLog,
  selectCells,
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

function pasteHtml(e: Editor, html: string): void {
  const view = viewOf(e);
  const slice = __parseFromClipboard(view, "", html, false, view.state.selection.$from);
  const event = new Event("paste") as ClipboardEvent;
  if (view.someProp("handlePaste", (f) => f(view, event, slice ?? Slice.empty))) return;
  if (!slice) return;
  view.dispatch(view.state.tr.replaceSelection(slice).setMeta("paste", true).setMeta("uiEvent", "paste"));
}

const tablePasteLogs = () =>
  logSpy.mock.calls.map((c) => c[0] as RefusalLog).filter((p) => p.event === "editor.table.paste");

/** A copy source below the host: header s1/s2, then body rows q and r. */
const SOURCE = "| s1 | s2 |\n| -- | -- |\n| q1 | q2 |\n| r1 | r2 |\n";

describe("D136 — a mixed slice over a CellSelection is refused", () => {
  const cases: Array<[string, string, string]> = [
    ["a single body cell", "y1", "y1"],
    ["two body cells", "y1", "y2"],
    ["a single header cell", "X1", "X1"],
    ["the whole table (header and body)", "X1", "y2"],
  ];

  for (const [label, from, to] of cases) {
    it(`D136-1: over ${label} — doc and selection unchanged, refusal logged and toasted`, async () => {
      const e = await mountParityEditor(HOST);
      const view = viewOf(e);
      selectCells(view, from, to);
      const before = docOf(e);
      const selBefore = view.state.selection;
      expect(() => pasteHtml(e, MIXED)).not.toThrow();
      expect(docOf(e).eq(before)).toBe(true);
      expect(view.state.selection.eq(selBefore)).toBe(true);
      const logs = tablePasteLogs();
      expectOneRefusal(logs);
      expect(logs[0].level).toBe("info");
      expect(logs[1].level).toBe("warn");
      expect(logs[1].context?.reason).toBe(CELL_PASTE_REASON);
      expect(logs[1].context?.nodes).toBe(3);
      expect(useToastStore.getState().message).toBe(CELL_PASTE_TOAST);
    });
  }
});

describe("D136 — what prosemirror-tables takes over a CellSelection is left to it", () => {
  it("D136-2: copied body cells pasted over a two-cell body selection fill those cells", async () => {
    const e = await mountParityEditor(`${HOST}\n${SOURCE}`);
    const view = viewOf(e);
    const html = copyCells(view, "q1", "q2");
    selectCells(view, "y1", "y2");
    pasteHtml(e, html);
    expect(tablePasteLogs()).toHaveLength(0);
    expect(useToastStore.getState().message).toBeNull();
    const shapes = tableShapes(docOf(e));
    expect(shapes[0].cells).toEqual([
      ["X1", "X2"],
      ["q1", "q2"],
    ]);
    expect(shapes[1].cells[1]).toEqual(["q1", "q2"]);
  });

  it("D136-3: a single copied cell over a two-cell selection is repeated into both", async () => {
    const e = await mountParityEditor(`${HOST}\n${SOURCE}`);
    const view = viewOf(e);
    const html = copyCells(view, "r1", "r1");
    selectCells(view, "y1", "y2");
    pasteHtml(e, html);
    expect(tablePasteLogs()).toHaveLength(0);
    expect(tableShapes(docOf(e))[0].cells[1]).toEqual(["r1", "r1"]);
  });

  it("D136-4: a slice carrying no table over a body CellSelection is not refused", async () => {
    const e = await mountParityEditor(HOST);
    const view = viewOf(e);
    selectCells(view, "y1", "y1");
    pasteHtml(e, "<p>plain</p>");
    expect(tablePasteLogs()).toHaveLength(0);
    expect(useToastStore.getState().message).toBeNull();
    expect(tableShapes(docOf(e))[0].cells[1]).toEqual(["plain", "y2"]);
  });
});
