/**
 * D91 ④⑤: a refused table paste or drop logs a `start` and a `fail` under one
 * actionId (rule 20), shows per-operation copy that names what is actually
 * checked — the host table would be split — and logs a reason saying the same.
 *
 * The old copy ("A table can't be pasted inside a table cell") was wrong: a
 * pure table pasted into a cell is supported (D83-3), and since D94 / D102 the
 * refusal also covers drops at in-table boundaries, which are not "in a cell".
 *
 * Real Milkdown commonmark + gfm + the parity list. Paste goes through the
 * registered `handlePaste` (view.someProp); drop through prosemirror-view's own
 * drop handler (`tests/support/tableDropDriver.ts`). Only `logEventSync` (IPC)
 * and `posAtCoords` (layout) are stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __parseFromClipboard } from "@milkdown/kit/prose/view";
import { loggingService } from "../src/services/loggingService";
import { useToastStore } from "../src/stores/toastStore";
import {
  caretAfter,
  destroyParityEditors,
  docOf,
  mountParityEditor,
  posAfter,
  viewOf,
} from "./support/raggedTableD64";
import {
  DROP_REASON,
  DROP_TOAST,
  drop,
  HOST,
  MIXED,
  PASTE_REASON,
  PASTE_TOAST,
  type RefusalLog,
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

const logsOf = (event: string) =>
  logSpy.mock.calls.map((c) => c[0] as RefusalLog).filter((p) => p.event === event);

describe("D91 ⑤ — the refusal copy names the split, per operation", () => {
  it("D91-1: the copy strings say the table would be split, not 'inside a table cell'", () => {
    expect(PASTE_TOAST).toBe("This paste would split the current table. Paste it outside the table.");
    expect(DROP_TOAST).toBe("This drop would split the current table. Drop it outside the table.");
    for (const copy of [PASTE_TOAST, DROP_TOAST]) expect(copy).not.toMatch(/cell/i);
  });

  it("D91-2: a refused paste shows the paste copy", async () => {
    const e = await mountParityEditor(HOST);
    caretAfter(e, "y1");
    const view = viewOf(e);
    const slice = __parseFromClipboard(view, "", MIXED, false, view.state.selection.$from);
    if (!slice) throw new Error("no slice parsed");
    const event = new Event("paste") as ClipboardEvent;
    expect(view.someProp("handlePaste", (f) => f(view, event, slice))).toBe(true);
    expect(useToastStore.getState().message).toBe(PASTE_TOAST);
  });

  it("D91-3: a drop refused at an interior boundary (not in a cell) shows the drop copy", async () => {
    const e = await mountParityEditor(HOST);
    // 15: HOST's between-rows boundary — no cell around it (D94).
    expect(drop(viewOf(e), 15, { html: MIXED })).toBe(true);
    expect(useToastStore.getState().message).toBe(DROP_TOAST);
  });
});

describe("D91 ④ — the refusal logs start + fail under one actionId", () => {
  function expectPair(logs: RefusalLog[], reason: string, nodes: number): void {
    expect(logs.map((l) => l.status)).toEqual(["start", "fail"]);
    const [start, fail] = logs;
    expect(typeof start.actionId).toBe("string");
    expect(String(start.actionId).length).toBeGreaterThan(0);
    expect(fail.actionId).toBe(start.actionId);
    expect(fail.level).toBe("warn");
    expect(fail.context).toEqual({ reason, nodes });
    expect(start.context).toEqual({ nodes });
  }

  it("D91-4: a refused paste logs editor.table.paste start then fail, one actionId, the split reason", async () => {
    const e = await mountParityEditor(HOST);
    caretAfter(e, "y1");
    const view = viewOf(e);
    const slice = __parseFromClipboard(view, "", MIXED, false, view.state.selection.$from);
    if (!slice) throw new Error("no slice parsed");
    const event = new Event("paste") as ClipboardEvent;
    view.someProp("handlePaste", (f) => f(view, event, slice));
    expectPair(logsOf("editor.table.paste"), PASTE_REASON, slice.content.childCount);
    expect(logsOf("editor.table.drop")).toHaveLength(0);
  });

  it("D91-5: a refused drop logs editor.table.drop start then fail, one actionId, the split reason", async () => {
    const e = await mountParityEditor(HOST);
    expect(drop(viewOf(e), posAfter(viewOf(e), "y1"), { html: MIXED })).toBe(true);
    expectPair(logsOf("editor.table.drop"), DROP_REASON, 3);
    expect(logsOf("editor.table.paste")).toHaveLength(0);
  });

  it("D91-6: two refusals get two distinct actionIds", async () => {
    const e = await mountParityEditor(HOST);
    drop(viewOf(e), posAfter(viewOf(e), "y1"), { html: MIXED });
    drop(viewOf(e), posAfter(viewOf(e), "X1"), { html: MIXED });
    const ids = logsOf("editor.table.drop").map((l) => l.actionId);
    expect(ids).toHaveLength(4);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).toBe(ids[3]);
    expect(ids[0]).not.toBe(ids[2]);
  });

  it("D91-7: a paste or drop the plugin does not refuse logs nothing under either event (no noise)", async () => {
    const e = await mountParityEditor(`Anchor\n\n${HOST}`);
    caretAfter(e, "Anchor");
    const view = viewOf(e);
    const slice = __parseFromClipboard(view, "", MIXED, false, view.state.selection.$from);
    if (!slice) throw new Error("no slice parsed");
    const event = new Event("paste") as ClipboardEvent;
    expect(view.someProp("handlePaste", (f) => f(view, event, slice)) ?? false).toBe(false);
    drop(view, posAfter(view, "Anchor"), { html: MIXED });
    expect(logsOf("editor.table.paste")).toHaveLength(0);
    expect(logsOf("editor.table.drop")).toHaveLength(0);
    expect(docOf(e).textContent).toContain("after");
  });
});
