/**
 * D142: an HTML table pasted "as cells" with the caret in a WYSIWYG table cell.
 *
 * Measured before the fix (real paste event on `view.dom`, real Milkdown): for a
 * table whose pasted rows mix a header row and body rows — thead+tbody, a first
 * `<tr>` of `<th>`s, and a tbody-only table (Milkdown's parser invents an empty
 * header row for it) — prosemirror-tables' `insertCells` replaced a body row's
 * cells with header cells, the replace fitter mangled the host rows, and its
 * closing `TableMap.positionAt` threw `RangeError: Index 2 out of range`. The
 * error escaped the paste listener: nothing dispatched, `defaultPrevented` false.
 * A header-only table (the parser invents an empty body row) split the host table
 * around a `<br />` paragraph instead. Plain content pasted over a CellSelection
 * that covers a header cell threw `RangeError: Not a table node` the same way.
 *
 * Fixed: each pasted row takes the cell type of the host row it lands in, and a
 * row the parser invented (no cells) is dropped before preset-gfm's table paste
 * rule reads it — that rule turned the header-only table into the empty paragraph
 * that split the host — so the paste lands as cells:
 * one table, the values where the caret put them, the document serializes, and
 * the paste is consumed. Plain content over a header cell keeps that column's
 * alignment. A table with no cell at all inserts nothing. A table pasted outside
 * any table keeps its header row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { loggingService } from "../src/services/loggingService";
import { useToastStore } from "../src/stores/toastStore";
import {
  caretAfter,
  destroyParityEditors,
  docOf,
  mountParityEditor,
  serialize,
  tableShapes,
  viewOf,
} from "./support/raggedTableD64";
import { type RefusalLog, selectCells } from "./support/tableDropDriver";

let logSpy: ReturnType<typeof vi.spyOn>;
let escaped: unknown[];
const onError = (event: ErrorEvent) => {
  escaped.push(event.error ?? event.message);
  event.preventDefault();
};

beforeEach(() => {
  escaped = [];
  window.addEventListener("error", onError);
  useToastStore.getState().clearToast();
  logSpy = vi.spyOn(loggingService, "logEventSync").mockImplementation(() => {});
});

afterEach(async () => {
  window.removeEventListener("error", onError);
  vi.restoreAllMocks();
  useToastStore.getState().clearToast();
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

const HOST = "| A | B |\n| - | - |\n| c | d |\n";
const THEAD = "<table><thead><tr><th>x</th><th>y</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>";
const TH_ROW = "<table><tr><th>x</th><th>y</th></tr><tr><td>1</td><td>2</td></tr></table>";
const TBODY = "<table><tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody></table>";
const HEAD_ONLY = "<table><thead><tr><th>x</th><th>y</th><th>z</th></tr></thead></table>";

/** The paste was consumed, nothing escaped, nothing was refused, one table is left. */
function expectLandedAsCells(e: Editor, event: Event): void {
  expect(escaped).toEqual([]);
  expect(event.defaultPrevented).toBe(true);
  expect(tableShapes(docOf(e))).toHaveLength(1);
  expect(tableShapes(docOf(e))[0].problems).toBeNull();
  expect(logsOf("editor.table.paste")).toHaveLength(0);
  expect(useToastStore.getState().message).toBeNull();
}

describe("D142 — an HTML table pasted as cells with the caret in a body cell", () => {
  /** label, HTML, host cells after, markdown after, cells retyped, invented rows dropped. */
  const cases: Array<[string, string, string[][], string, number, number]> = [
    [
      "thead + tbody",
      THEAD,
      [["A", "B"], ["x", "y"], ["1", "2"]],
      "| A | B |\n| - | - |\n| x | y |\n| 1 | 2 |\n",
      2,
      0,
    ],
    [
      "a first row of <th> with no thead",
      TH_ROW,
      [["A", "B"], ["x", "y"], ["1", "2"]],
      "| A | B |\n| - | - |\n| x | y |\n| 1 | 2 |\n",
      2,
      0,
    ],
    [
      "tbody only (the parser's invented header row is dropped)",
      TBODY,
      [["A", "B"], ["1", "2"], ["3", "4"]],
      "| A | B |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n",
      0,
      1,
    ],
    [
      "header only (pasted as one body row; the host is not split)",
      HEAD_ONLY,
      [["A", "B", ""], ["x", "y", "z"]],
      "| A | B |   |\n| - | - | - |\n| x | y | z |\n",
      3,
      1,
    ],
  ];

  for (const [label, html, cells, markdown, retyped, dropped] of cases) {
    it(`D142-1: ${label} — lands in the host at the caret, serializes`, async () => {
      const e = await mountParityEditor(HOST);
      caretAfter(e, "c");
      const event = pasteEvent(e, html);
      expectLandedAsCells(e, event);
      expect(tableShapes(docOf(e))[0].cells).toEqual(cells);
      expect(serialize(e)).toBe(markdown);
      expect(serialize(e)).not.toContain("<br");
      const retypeLogs = logsOf("editor.table.paste-retyped");
      expect(retypeLogs.map((l) => l.context?.retyped)).toEqual(retyped ? [retyped] : []);
      const dropLogs = logsOf("editor.table.paste-rows-dropped");
      expect(dropLogs.map((l) => l.context?.droppedRows)).toEqual(dropped ? [dropped] : []);
      for (const log of [...retypeLogs, ...dropLogs]) expect(log.status).toBe("success");
    });
  }

  it("D142-2: body rows pasted with the caret in the header row take the header there", async () => {
    const e = await mountParityEditor(HOST);
    caretAfter(e, "A");
    const event = pasteEvent(e, TBODY);
    expectLandedAsCells(e, event);
    expect(tableShapes(docOf(e))[0].cells).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
    expect(serialize(e)).toBe("| 1 | 2 |\n| - | - |\n| 3 | 4 |\n");
  });

  it("D142-3: a paste whose rows already match the host rows logs no retype", async () => {
    const e = await mountParityEditor(HOST);
    caretAfter(e, "A");
    const event = pasteEvent(e, THEAD);
    expectLandedAsCells(e, event);
    expect(tableShapes(docOf(e))[0].cells).toEqual([
      ["x", "y"],
      ["1", "2"],
    ]);
    expect(logsOf("editor.table.paste-retyped")).toHaveLength(0);
  });
});

describe("D142 — plain content over a CellSelection that covers a header cell (from D136)", () => {
  it("D142-4: over the header cell alone — fills it and keeps the column's alignment", async () => {
    const e = await mountParityEditor("| A | B |\n| :-: | - |\n| c | d |\n");
    selectCells(viewOf(e), "A", "A");
    const event = pasteEvent(e, "<p>plain</p>");
    expectLandedAsCells(e, event);
    expect(tableShapes(docOf(e))[0].cells).toEqual([
      ["plain", "B"],
      ["c", "d"],
    ]);
    expect(serialize(e)).toBe("| plain | B |\n| :---: | - |\n|   c   | d |\n");
  });

  it("D142-5: over the whole table — every selected cell gets the content", async () => {
    const e = await mountParityEditor(HOST);
    selectCells(viewOf(e), "A", "d");
    const event = pasteEvent(e, "<p>plain</p>");
    expectLandedAsCells(e, event);
    expect(tableShapes(docOf(e))[0].cells).toEqual([
      ["plain", "plain"],
      ["plain", "plain"],
    ]);
    expect(serialize(e)).toBe("| plain | plain |\n| ----- | ----- |\n| plain | plain |\n");
  });
});

describe("D142 — rows retyped per host row, and tables with no cell", () => {
  it("D142-7: one pasted cell over a header and a body cell lands in both, typed for each row", async () => {
    const e = await mountParityEditor(HOST);
    selectCells(viewOf(e), "A", "c");
    const event = pasteEvent(e, "<table><tr><td>q</td></tr></table>");
    expectLandedAsCells(e, event);
    expect(tableShapes(docOf(e))[0].cells).toEqual([
      ["q", "B"],
      ["q", "d"],
    ]);
    const table = docOf(e).child(0);
    expect(table.child(0).child(0).type.name).toBe("table_header");
    expect(table.child(1).child(0).type.name).toBe("table_cell");
    expect(serialize(e)).toBe("| q | B |\n| - | - |\n| q | d |\n");
    expect(logsOf("editor.table.paste-retyped").map((l) => l.context?.retyped)).toEqual([1]);
  });

  /** The parser gives each an empty header row and an empty body row: two dropped. */
  const empties: Array<[string, string, number]> = [
    ["<table></table>", "<table></table>", 2],
    ["a table of one empty row", "<table><tr></tr></table>", 2],
  ];
  for (const [label, html, rows] of empties) {
    it(`D142-8: ${label} in a cell inserts nothing and does not split the host`, async () => {
      const e = await mountParityEditor(HOST);
      caretAfter(e, "c");
      const before = docOf(e);
      const event = pasteEvent(e, html);
      expect(escaped).toEqual([]);
      expect(event.defaultPrevented).toBe(true);
      expect(docOf(e).eq(before)).toBe(true);
      expect(serialize(e)).toBe(HOST);
      expect(logsOf("editor.table.paste-rows-dropped").map((l) => l.context?.droppedRows)).toEqual([rows]);
    });
  }
});

describe("D142 — a table pasted outside any table is untouched", () => {
  it("D142-6: keeps its header row", async () => {
    const e = await mountParityEditor("Intro.\n");
    caretAfter(e, "Intro.");
    pasteEvent(e, THEAD);
    expect(escaped).toEqual([]);
    const shapes = tableShapes(docOf(e));
    expect(shapes).toHaveLength(1);
    expect(shapes[0].cells).toEqual([
      ["x", "y"],
      ["1", "2"],
    ]);
    const table = docOf(e).child(1);
    expect(table.type.name).toBe("table");
    expect(table.child(0).type.name).toBe("table_header_row");
    expect(serialize(e)).toContain("| x | y |\n| - | - |\n| 1 | 2 |\n");
    expect(logsOf("editor.table.paste-retyped")).toHaveLength(0);
  });

  it("D142-9: a tbody-only table keeps the header row the parser gives it; no row is dropped", async () => {
    const e = await mountParityEditor("Intro.\n");
    caretAfter(e, "Intro.");
    pasteEvent(e, TBODY);
    expect(escaped).toEqual([]);
    const shapes = tableShapes(docOf(e));
    expect(shapes).toHaveLength(1);
    expect(shapes[0].cells).toEqual([
      ["", ""],
      ["1", "2"],
      ["3", "4"],
    ]);
    expect(logsOf("editor.table.paste-rows-dropped")).toHaveLength(0);
  });
});
