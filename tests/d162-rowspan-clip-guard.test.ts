/**
 * D162 follow-up (audit b63): `pasteInventedRows.ts` `completed()` clipped every
 * rowspan to the table's own height whenever any invented row was filled — even
 * when the table had no covered, cell-less tail. A rowspan that runs past the
 * pasted table's last row (legal HTML; prosemirror-tables pastes it over a
 * CellSelection) was cut short, and the cell paste then threw
 * `RangeError: No cell with offset …`: nothing landed and the event was not
 * prevented. D162's parent (b87ee70) pasted it fine.
 *
 * Fixed: spans are clipped only when a covered tail exists.
 *
 * Driven through prosemirror-view's own paste listener on a real Milkdown editor
 * built from the parity list, with a window error listener.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { loggingService } from "../src/services/loggingService";
import { destroyParityEditors, docOf, mountParityEditor, serialize, tableShapes, viewOf } from "./support/raggedTableD64";
import { selectCells } from "./support/tableDropDriver";

let escaped: unknown[];
const onError = (event: ErrorEvent) => {
  escaped.push(event.error ?? event.message);
  event.preventDefault();
};

beforeEach(() => {
  escaped = [];
  window.addEventListener("error", onError);
  vi.spyOn(loggingService, "logEventSync").mockImplementation(() => {});
});

afterEach(async () => {
  window.removeEventListener("error", onError);
  vi.restoreAllMocks();
  await destroyParityEditors();
});

/** Paste `html` through prosemirror-view's own paste listener; returns the event. */
function pasteEvent(e: Editor, html: string): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (t: string) => (t === "text/html" ? html : ""), types: ["text/html"], files: [] },
  });
  viewOf(e).dom.dispatchEvent(event);
  return event;
}

/** A 6-row × 2-column host: header h1/h2, then body rows a1/b1 … a5/b5. */
const HOST = [
  "| h1 | h2 |",
  "| -- | -- |",
  ...[1, 2, 3, 4, 5].map((n) => `| a${n} | b${n} |`),
  "",
].join("\n");

/** The audit repro: A's rowspan (5) runs past the pasted table's 2 rows; row 2 is invented. */
const OVERLONG_SPAN = '<table><tr><td>B</td><td rowspan="5">A</td></tr><tr><td>C</td></tr></table>';

describe("D162 b63 — a rowspan longer than the pasted table is not clipped", () => {
  it("D162-7: pasted over a CellSelection of the whole host — handled, A/B/C land, nothing escapes", async () => {
    const e = await mountParityEditor(HOST);
    const view = viewOf(e);
    selectCells(view, "h1", "b5");
    let event: Event | undefined;
    expect(() => {
      event = pasteEvent(e, OVERLONG_SPAN);
    }).not.toThrow();
    expect(escaped.map(String).join(" | ")).toBe("");
    expect(event?.defaultPrevented).toBe(true);
    expect(() => docOf(e).check()).not.toThrow();
    const shapes = tableShapes(docOf(e));
    expect(shapes).toHaveLength(1);
    expect(shapes[0].problems).toBeNull();
    const text = shapes[0].cells.flat();
    expect(text).toContain("A");
    expect(text).toContain("B");
    expect(text).toContain("C");
    expect(() => serialize(e)).not.toThrow();
  });
});
