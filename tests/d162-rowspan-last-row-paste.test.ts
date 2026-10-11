/**
 * D162: an HTML table whose LAST row has no cells because a rowspan from above
 * covers it. b51 (D149/D150, b87ee70) rightly stopped treating a covered row as
 * invented, so `pasteInventedRows.ts` left it empty — but preset-gfm's
 * `tablePasteRule` (priority 50, after mdpro's rule) reads
 * `colsCount = table.lastChild.childCount` and swaps a table whose last row has
 * no cells for an empty paragraph:
 *   - outside a table, the whole table (and its text) became an empty paragraph;
 *   - inside a table, the slice then carried no table, so neither the cell paste
 *     nor the D83/D136 refusal saw one, and an empty paragraph replaced the caret
 *     position, splitting the host table.
 *
 * Fixed: a trailing run of covered, cell-less rows is uncovered (the covering
 * rowspans are shortened to stop above it) and then filled like any other
 * invented row, so no content moves, the row count is kept, and gfm's rule
 * never sees a last row without cells.
 *
 * Driven through prosemirror-view's own paste listener on a real Milkdown editor
 * built from the parity list, with a window error listener.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import type { Node as PmNode } from "@milkdown/kit/prose/model";
import { loggingService } from "../src/services/loggingService";
import { caretAfter, destroyParityEditors, docOf, mountParityEditor, serialize, tableShapes, viewOf } from "./support/raggedTableD64";
import type { RefusalLog } from "./support/tableDropDriver";

let logSpy: ReturnType<typeof vi.spyOn>;
let escaped: unknown[];
const onError = (event: ErrorEvent) => {
  escaped.push(event.error ?? event.message);
  event.preventDefault();
};

beforeEach(() => {
  escaped = [];
  window.addEventListener("error", onError);
  logSpy = vi.spyOn(loggingService, "logEventSync").mockImplementation(() => {});
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

const logsOf = (event: string) =>
  logSpy.mock.calls.map((c) => c[0] as RefusalLog).filter((p) => p.event === event);

/** Top-level node type names of the document. */
const topLevel = (doc: PmNode): string[] => {
  const out: string[] = [];
  doc.forEach((n) => out.push(n.type.name));
  return out;
};

/** Each row's rowspans, for the first table of `doc`. */
function rowspans(doc: PmNode): number[][] {
  const out: number[][] = [];
  doc.descendants((node) => {
    if (node.type.name !== "table") return true;
    node.forEach((row) => {
      const r: number[] = [];
      row.forEach((cell) => r.push(Number(cell.attrs.rowspan ?? 1)));
      out.push(r);
    });
    return false;
  });
  return out;
}

const INTRO = "Intro.\n";
/** The audit repro: the header cell spans the only body row, which has no cells. */
const REPRO = '<table><tr><th rowspan="2">A</th></tr><tr></tr></table>';
/** A covered empty last row below a row that has cells. */
const TAIL_AFTER_CELLS = '<table><tr><th rowspan="3">A</th><th>B</th></tr><tr><td>C</td></tr><tr></tr></table>';
/** Two covered empty rows at the end. */
const TWO_COVERED_TAIL =
  '<table><tr><th rowspan="3">A</th><th rowspan="3">B</th></tr><tr></tr><tr></tr></table>';

/** Nothing escaped, the document is schema-valid, and it holds exactly one sound table. */
function expectOneValidTable(e: Editor): ReturnType<typeof tableShapes>[number] {
  expect(escaped).toEqual([]);
  expect(() => docOf(e).check()).not.toThrow();
  const shapes = tableShapes(docOf(e));
  expect(shapes).toHaveLength(1);
  expect(shapes[0].problems).toBeNull();
  return shapes[0];
}

describe("D162 — a covered, cell-less last row pasted outside any table", () => {
  it("D162-1: the repro lands as a table; A survives in it and in the markdown", async () => {
    const e = await mountParityEditor(INTRO);
    caretAfter(e, "Intro.");
    const event = pasteEvent(e, REPRO);
    expect(event.defaultPrevented).toBe(true);
    const shape = expectOneValidTable(e);
    expect(shape.cells).toEqual([["A"], [""]]);
    // The span is shortened to stop above the uncovered row; nothing overlaps.
    expect(rowspans(docOf(e))).toEqual([[1], [1]]);
    expect(topLevel(docOf(e))).toEqual(["paragraph", "table"]);
    expect(serialize(e)).toContain("| A |");
  });

  it("D162-2: the saved markdown reloads to the same table", async () => {
    const e = await mountParityEditor(INTRO);
    caretAfter(e, "Intro.");
    pasteEvent(e, REPRO);
    const md = serialize(e);
    const reloaded = await mountParityEditor(md);
    expect(tableShapes(docOf(reloaded)).map((s) => s.cells)).toEqual([[["A"], [""]]]);
    expect(serialize(reloaded)).toBe(md);
  });

  it("D162-3: a covered empty last row below a row with cells — every cell kept, no row moves", async () => {
    const e = await mountParityEditor(INTRO);
    caretAfter(e, "Intro.");
    pasteEvent(e, TAIL_AFTER_CELLS);
    const shape = expectOneValidTable(e);
    expect(shape.cells).toEqual([["A", "B"], ["C"], ["", ""]]);
    // A spanned rows 0–2; it now stops at row 1, so C stays beside it and row 2 is filled.
    expect(rowspans(docOf(e))).toEqual([[2, 1], [1], [1, 1]]);
    expect(logsOf("editor.table.paste-rows-filled").map((l) => l.context?.filledRows)).toEqual([1]);
  });

  it("D162-4: two covered empty rows at the end — both kept as filled rows, A and B kept", async () => {
    const e = await mountParityEditor(INTRO);
    caretAfter(e, "Intro.");
    pasteEvent(e, TWO_COVERED_TAIL);
    const shape = expectOneValidTable(e);
    expect(shape.cells).toEqual([["A", "B"], ["", ""], ["", ""]]);
    expect(rowspans(docOf(e))).toEqual([[1, 1], [1, 1], [1, 1]]);
  });
});

describe("D162 — a covered, cell-less last row pasted inside a table", () => {
  const HOST = "| P | Q |\n| - | - |\n| c | d |\n";

  it("D162-5: the repro pastes as a cell at the caret — no empty paragraph, the host is not split", async () => {
    const e = await mountParityEditor(HOST);
    caretAfter(e, "c");
    const event = pasteEvent(e, REPRO);
    expect(event.defaultPrevented).toBe(true);
    const shape = expectOneValidTable(e);
    expect(topLevel(docOf(e))).toEqual(["table"]);
    // The filled row is the cell paste's to drop; A lands in the caret's cell.
    expect(shape.cells).toEqual([
      ["P", "Q"],
      ["A", "d"],
    ]);
    expect(serialize(e)).toBe("| P | Q |\n| - | - |\n| A | d |\n");
  });

  it("D162-6: a covered empty last row below a row with cells pastes its cells, rows in place", async () => {
    const e = await mountParityEditor(HOST);
    caretAfter(e, "c");
    pasteEvent(e, TAIL_AFTER_CELLS);
    const shape = expectOneValidTable(e);
    expect(topLevel(docOf(e))).toEqual(["table"]);
    const rowOf = (text: string) => shape.cells.findIndex((row) => row.includes(text));
    expect(rowOf("A")).toBe(1);
    expect(rowOf("B")).toBe(1);
    expect(rowOf("C")).toBe(2);
  });
});
