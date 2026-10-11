/**
 * D149 / D150: an HTML table pasted with the caret in a paragraph, outside any
 * table. Milkdown's table content is `table_header_row table_row+`, so the HTML
 * parser invents an empty body row for a header-only table and an empty header
 * row for a tbody-only one; preset-gfm's `tablePasteRule` then read them:
 *   - D149: a header-only table (last row has no cells) was swapped for an empty
 *     paragraph — the header text was lost, silently.
 *   - D150: a tbody-only table's empty header row was filled with `table_header`
 *     cells of the schema default `alignment: "left"`, saved as `| :- | :- |`.
 *
 * Also the b51 audit of D142 (`pasteInventedRows.ts`):
 *   - a row with no cells because rowspans above cover it is not invented, and
 *     must not be dropped (the rows below it would move up);
 *   - the paste rule also runs on a drop, and decided by the selection, not the
 *     drop target: a header-only table dropped outside the host table while a
 *     cell held the caret came out with no body row, a table `check()` rejects.
 *
 * Driven through prosemirror-view's own paste / drop listeners on a real Milkdown
 * editor built from the parity list, with a window error listener.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { loggingService } from "../src/services/loggingService";
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
import { drop, type RefusalLog } from "./support/tableDropDriver";

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

/** The markdown lines of the first table in `md`. */
const tableLines = (md: string): string[] => md.split("\n").filter((l) => l.startsWith("|"));

const INTRO = "Intro.\n";
const HEAD_ONLY = "<table><thead><tr><th>x</th><th>y</th><th>z</th></tr></thead></table>";
const TBODY = "<table><tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody></table>";
const THEAD = "<table><thead><tr><th>x</th><th>y</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>";

/** Nothing escaped, the document is schema-valid, and it holds exactly one table. */
function expectOneValidTable(e: Editor): ReturnType<typeof tableShapes>[number] {
  expect(escaped).toEqual([]);
  expect(() => docOf(e).check()).not.toThrow();
  const shapes = tableShapes(docOf(e));
  expect(shapes).toHaveLength(1);
  expect(shapes[0].problems).toBeNull();
  return shapes[0];
}

describe("D149 — a header-only HTML table pasted outside any table", () => {
  it("D149-1: pastes as a table — the header x/y/z and one empty body row", async () => {
    const e = await mountParityEditor(INTRO);
    caretAfter(e, "Intro.");
    const event = pasteEvent(e, HEAD_ONLY);
    expect(event.defaultPrevented).toBe(true);
    const shape = expectOneValidTable(e);
    expect(shape.cells).toEqual([
      ["x", "y", "z"],
      ["", "", ""],
    ]);
    expect(shape.align).toEqual([
      [null, null, null],
      [null, null, null],
    ]);
    const lines = tableLines(serialize(e));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("| x | y | z |");
    expect(lines[1]).toBe("| - | - | - |");
    expect(lines[2].replace(/\s/g, "")).toBe("||||");
  });

  it("D149-2: the saved markdown reloads to the same table", async () => {
    const e = await mountParityEditor(INTRO);
    caretAfter(e, "Intro.");
    pasteEvent(e, HEAD_ONLY);
    const md = serialize(e);
    const reloaded = await mountParityEditor(md);
    expect(tableShapes(docOf(reloaded)).map((s) => s.cells)).toEqual([
      [
        ["x", "y", "z"],
        ["", "", ""],
      ],
    ]);
    expect(serialize(reloaded)).toBe(md);
  });

  it("D149-3: a table with no cell at all pastes nothing — not an empty paragraph", async () => {
    const e = await mountParityEditor(INTRO);
    caretAfter(e, "Intro.");
    const before = docOf(e);
    pasteEvent(e, "<table></table>");
    expect(escaped).toEqual([]);
    expect(docOf(e).eq(before)).toBe(true);
    expect(logsOf("editor.table.paste-rows-dropped").map((l) => l.context?.droppedRows)).toEqual([2]);
  });
});

describe("D150 — a tbody-only HTML table pasted outside any table", () => {
  it("D150-1: the invented header row is empty and carries no alignment; every body row is kept", async () => {
    const e = await mountParityEditor(INTRO);
    caretAfter(e, "Intro.");
    pasteEvent(e, TBODY);
    const shape = expectOneValidTable(e);
    expect(shape.cells).toEqual([
      ["", ""],
      ["1", "2"],
      ["3", "4"],
    ]);
    expect(shape.align[0]).toEqual([null, null]);
    const lines = tableLines(serialize(e));
    expect(lines).toHaveLength(4);
    expect(lines[1]).not.toContain(":");
    expect(lines[1].replace(/\s/g, "")).toMatch(/^\|-+\|-+\|$/);
    expect(lines.slice(2)).toEqual(["| 1 | 2 |", "| 3 | 4 |"]);
  });
});

describe("D149 / D150 guards — tables with a real header pasted outside any table", () => {
  it("G-1: thead + tbody is unchanged", async () => {
    const e = await mountParityEditor(INTRO);
    caretAfter(e, "Intro.");
    pasteEvent(e, THEAD);
    const shape = expectOneValidTable(e);
    expect(shape.cells).toEqual([
      ["x", "y"],
      ["1", "2"],
    ]);
    expect(serialize(e)).toContain("| x | y |\n| - | - |\n| 1 | 2 |\n");
    expect(logsOf("editor.table.paste-rows-dropped")).toHaveLength(0);
  });

  it("G-2: an alignment the copied header sets is kept", async () => {
    const e = await mountParityEditor(INTRO);
    caretAfter(e, "Intro.");
    pasteEvent(
      e,
      '<table><thead><tr><th style="text-align: center">x</th><th>y</th></tr></thead>' +
        "<tbody><tr><td>1</td><td>2</td></tr></tbody></table>",
    );
    const shape = expectOneValidTable(e);
    expect(shape.align[0]).toEqual(["center", null]);
    expect(tableLines(serialize(e))[1]).toBe("| :-: | - |");
  });
});

describe("b51 — the in-table trim of D142", () => {
  const HOST = "| A | B |\n| - | - |\n| c | d |\n";

  it("B51-1: a row that rowspans cover is not dropped as invented; the rows below stay below it", async () => {
    const e = await mountParityEditor(HOST);
    caretAfter(e, "c");
    pasteEvent(
      e,
      '<table><tr><td rowspan="2">r</td><td rowspan="2">s</td></tr><tr></tr>' +
        "<tr><td>t</td><td>u</td></tr></table>",
    );
    expect(escaped).toEqual([]);
    const shapes = tableShapes(docOf(e));
    expect(shapes).toHaveLength(1);
    const rowOf = (text: string) => shapes[0].cells.findIndex((row) => row.includes(text));
    // r/s land at the caret's row (1) and span rows 1–2; t/u land at row 3.
    expect(rowOf("r")).toBe(1);
    expect(rowOf("t")).toBe(3);
  });

  it("B51-2: a header-only table dropped outside the host table, with the caret in a cell, lands as a valid table", async () => {
    const e = await mountParityEditor(`${HOST}\nAfter.\n`);
    caretAfter(e, "c");
    const view = viewOf(e);
    drop(view, posAfter(view, "After."), { html: HEAD_ONLY });
    expect(escaped).toEqual([]);
    expect(() => docOf(e).check()).not.toThrow();
    const shapes = tableShapes(docOf(e));
    expect(shapes).toHaveLength(2);
    expect(shapes[0].cells).toEqual([
      ["A", "B"],
      ["c", "d"],
    ]);
    expect(shapes[1].cells).toEqual([
      ["x", "y", "z"],
      ["", "", ""],
    ]);
  });
});
