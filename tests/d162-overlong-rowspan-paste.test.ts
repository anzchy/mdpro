/**
 * D162-WI-3 (audit b68 on 3302941): a pasted rowspan longer than the target
 * CellSelection crashed the cell insert. `pastedCells` grows the pasted rect to
 * the span's full height; prosemirror-tables' `clipCells` then shrinks a cell
 * that sticks out to `newHeight - rowspan` rows instead of `newHeight - row`, so
 * rows lose cells, and `insertCells` resolves its closing CellSelection with
 * `TableMap.positionAt`, which skips a slot covered from above and runs off the
 * row: `RangeError: No cell with offset …` before dispatch. Nothing landed and
 * the paste was not prevented.
 *
 * Swept over CellSelections of 2–4 columns × 2–5 rows of a 4 × 5 host, anchored
 * at its top-left cell, for both overlong-span shapes the audits found, and at
 * the caret in the host's bottom-right cell. Then (ADR-0082 review): interior,
 * bottom and right selections, a table after a paragraph, a short span repeated
 * over a taller selection, and host spans crossing each edge of a caret paste —
 * each asserting the exact final selection, that no cell straddles the pasted
 * rect, and that every host cell wholly outside it keeps its text.
 *
 * Driven through prosemirror-view's own paste listener on a real Milkdown editor
 * built from the parity list, with a window error listener.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { CellSelection, TableMap } from "@milkdown/kit/prose/tables";
import { loggingService } from "../src/services/loggingService";
import { caretAfter, destroyParityEditors, docOf, mountParityEditor, serialize, tableShapes, viewOf } from "./support/raggedTableD64";
import { cellPosOf, selectCells } from "./support/tableDropDriver";
import { allSlots, cellRects, crossing, HSPAN, seedSpan, selectionRect, tableOf, untouchedSlots, VSPAN } from "./support/d162PasteTargets";

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

const COLS = 4;
/** A 4-column × 5-row host: header h1…h4, then body cells r{row}c{col}. */
const HOST = [
  `| ${[1, 2, 3, 4].map((c) => `h${c}`).join(" | ")} |`,
  "| -- | -- | -- | -- |",
  ...[1, 2, 3, 4].map((r) => `| ${[1, 2, 3, 4].map((c) => `r${r}c${c}`).join(" | ")} |`),
  "",
].join("\n");

/** The needle of the host cell at 0-based (row, col); row 0 is the header. */
const needle = (row: number, col: number): string => (row === 0 ? `h${col + 1}` : `r${row}c${col + 1}`);

const SHAPES = {
  /** b68: a tbody-only table, A's rowspan (5) in the left column runs past its one row. */
  tbodyLeftSpan: { html: '<table><tbody><tr><td rowspan="5">A</td><td>B</td></tr></tbody></table>', text: ["A", "B"] },
  /** The earlier audit's: A's rowspan (5) in the right column runs past the 2 rows. */
  rightSpan: {
    html: '<table><tr><td>B</td><td rowspan="5">A</td></tr><tr><td>C</td></tr></table>',
    text: ["A", "B", "C"],
  },
} as const;

/** The common landing contract: nothing escaped, handled, one sound table with the text, serializable. */
function expectLanded(e: Editor, event: Event, text: readonly string[]): void {
  expect(escaped.map(String).join(" | ")).toBe("");
  expect(event.defaultPrevented).toBe(true);
  expect(() => docOf(e).check()).not.toThrow();
  const shapes = tableShapes(docOf(e));
  expect(shapes).toHaveLength(1);
  expect(shapes[0].problems).toBeNull();
  const cells = shapes[0].cells.flat();
  for (const t of text) expect(cells).toContain(t);
  expect(() => serialize(e)).not.toThrow();
}

const GRID = [2, 3, 4].flatMap((cols) => [2, 3, 4, 5].map((rows) => ({ cols, rows })));

describe("D162-WI-3 — an overlong rowspan pasted over a CellSelection lands", () => {
  for (const [name, shape] of Object.entries(SHAPES)) {
    for (const { cols, rows } of GRID) {
      it(`${name} over ${cols} × ${rows}: handled, lands, selects exactly the target`, async () => {
        const e = await mountParityEditor(HOST);
        const view = viewOf(e);
        selectCells(view, needle(0, 0), needle(rows - 1, cols - 1));
        const event = pasteEvent(e, shape.html);
        expectLanded(e, event, shape.text);
        const sel = view.state.selection;
        expect(sel).toBeInstanceOf(CellSelection);
        if (!(sel instanceof CellSelection)) return;
        const table = sel.$anchorCell.node(-1);
        const start = sel.$anchorCell.start(-1);
        const rect = TableMap.get(table).rectBetween(sel.$anchorCell.pos - start, sel.$headCell.pos - start);
        expect(rect).toEqual({ left: 0, top: 0, right: cols, bottom: rows });
        expect(TableMap.get(table).width).toBe(COLS);
      });
    }
  }
});

describe("D162-WI-3 — an overlong rowspan pasted at the caret lands", () => {
  for (const [name, shape] of Object.entries(SHAPES)) {
    it(`${name} at the caret in the bottom-right cell: handled, lands`, async () => {
      const e = await mountParityEditor(HOST);
      caretAfter(e, needle(4, COLS - 1));
      const event = pasteEvent(e, shape.html);
      expectLanded(e, event, shape.text);
    });
  }
});

/** A 2-row source whose 2-row span repeats when pasted over a taller selection. */
const SHORT = {
  html: '<table><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></table>',
  text: ["A", "B", "C"],
} as const;

/** The same 2 × 2 block with the span on the right: its bottom-right slot is covered from above. */
const SHORT_RIGHT = {
  html: '<table><tr><td>B</td><td rowspan="2">A</td></tr><tr><td>C</td></tr></table>',
  text: ["A", "B", "C"],
} as const;

type Target = { top: number; left: number; right: number; bottom: number };

/** No cell straddles `rect`'s edge; every slot in `kept` has its old text; the table is COLS × `height`. */
function expectContained(e: Editor, rect: Target, kept: Map<string, string>, height: number): void {
  const table = tableOf(docOf(e));
  expect(crossing(table, rect)).toEqual([]);
  const after = allSlots(table);
  for (const [slot, text] of kept) expect(`${slot}=${after.get(slot)}`).toBe(`${slot}=${text}`);
  const map = TableMap.get(table);
  expect({ width: map.width, height: map.height }).toEqual({ width: COLS, height });
}

/** Select `rect` by its corner cells, paste `html`; returns the event and the pre-paste untouched slots. */
async function pasteOver(md: string, rect: Target, html: string) {
  const e = await mountParityEditor(md);
  const kept = untouchedSlots(tableOf(docOf(e)), rect);
  selectCells(viewOf(e), needle(rect.top, rect.left), needle(rect.bottom - 1, rect.right - 1));
  return { e, kept, event: pasteEvent(e, html) };
}

const TARGETS: Record<string, Target> = {
  interior: { top: 1, left: 1, right: 3, bottom: 4 },
  bottom: { top: 3, left: 0, right: 3, bottom: 5 },
  right: { top: 0, left: 2, right: 4, bottom: 3 },
  bottomRight: { top: 2, left: 1, right: 4, bottom: 5 },
};

describe("D162-WI-3 — an overlong rowspan over interior, bottom and right selections", () => {
  for (const [name, shape] of Object.entries(SHAPES)) {
    for (const [where, rect] of Object.entries(TARGETS)) {
      it(`${name} over the ${where} selection: lands inside it, selects it, leaves the rest`, async () => {
        const { e, kept, event } = await pasteOver(HOST, rect, shape.html);
        expectLanded(e, event, shape.text);
        expect(selectionRect(viewOf(e))).toEqual(rect);
        expectContained(e, rect, kept, 5);
        const a = cellRects(tableOf(docOf(e))).find((c) => c.text === "A");
        expect(a?.rect.top).toBe(rect.top);
      });
    }
  }
});

describe("D162-WI-3 — the table need not open the document", () => {
  for (const [name, shape] of Object.entries(SHAPES)) {
    it(`${name} over the right selection of a table after a paragraph: lands, selects it, leaves the rest`, async () => {
      const rect = TARGETS.right;
      const { e, kept, event } = await pasteOver(`Intro paragraph.\n\n${HOST}`, rect, shape.html);
      expectLanded(e, event, shape.text);
      expect(selectionRect(viewOf(e))).toEqual(rect);
      expectContained(e, rect, kept, 5);
      expect(docOf(e).firstChild?.textContent).toBe("Intro paragraph.");
    });
  }
});

describe("D162-WI-3 — a short span repeated over a taller selection ends inside it", () => {
  for (const rect of [
    { top: 1, left: 1, right: 3, bottom: 4 },
    { top: 1, left: 1, right: 3, bottom: 5 },
    { top: 0, left: 2, right: 4, bottom: 5 },
  ]) {
    const rows = rect.bottom - rect.top;
    it(`over rows ${rect.top}–${rect.bottom - 1}: ${Math.ceil(rows / 2)} copies of A, none past the last row`, async () => {
      const { e, kept, event } = await pasteOver(HOST, rect, SHORT.html);
      expectLanded(e, event, SHORT.text);
      expect(selectionRect(viewOf(e))).toEqual(rect);
      expectContained(e, rect, kept, 5);
      const as = cellRects(tableOf(docOf(e))).filter((c) => c.text === "A");
      expect(as.map((c) => c.rect.top)).toEqual(
        Array.from({ length: Math.ceil(rows / 2) }, (_, i) => rect.top + 2 * i),
      );
    });
  }
});

/** Host spans (seeded by a first paste) that straddle the caret paste's rect; `keeps` is a slot outside it whose text must survive. */
const HOST_SPANS = [
  { edge: "top", seed: VSPAN, at: needle(1, 1), caret: needle(2, 0), left: 0, keeps: "1,1" },
  { edge: "bottom", seed: VSPAN, at: needle(3, 1), caret: needle(2, 0), left: 0, keeps: null },
  { edge: "left", seed: HSPAN, at: needle(3, 0), caret: needle(2, 1), left: 1, keeps: "3,0" },
  { edge: "right", seed: HSPAN, at: needle(3, 2), caret: needle(2, 1), left: 1, keeps: null },
] as const;

describe("D162-WI-3 — a paste at the caret splits host spans that cross its rect", () => {
  for (const [name, shape] of Object.entries({ SHORT, SHORT_RIGHT })) for (const span of HOST_SPANS) {
    it(`${name} beside a host span crossing the ${span.edge} edge: split, the paste selected, the rest kept`, async () => {
      const e = await mountParityEditor(HOST);
      const view = viewOf(e);
      seedSpan(view, cellPosOf(view, span.at), span.seed);
      const rect = { top: 2, left: span.left, right: span.left + 2, bottom: 4 };
      const before = allSlots(tableOf(docOf(e)));
      expect(crossing(tableOf(docOf(e)), rect)).toHaveLength(1);
      const kept = untouchedSlots(tableOf(docOf(e)), rect);
      caretAfter(e, span.caret);
      const event = pasteEvent(e, shape.html);
      expectLanded(e, event, shape.text);
      expect(selectionRect(view)).toEqual(rect);
      expectContained(e, rect, kept, 5);
      if (span.keeps) expect(allSlots(tableOf(docOf(e))).get(span.keeps)).toBe(before.get(span.keeps));
    });
  }

  it("an overlong span at the caret beside a host span crossing its left edge", async () => {
    const e = await mountParityEditor(HOST);
    const view = viewOf(e);
    seedSpan(view, cellPosOf(view, needle(2, 1)), HSPAN);
    const open = { top: 1, left: 2, right: 4, bottom: 99 };
    expect(crossing(tableOf(docOf(e)), open)).toHaveLength(1);
    const kept = untouchedSlots(tableOf(docOf(e)), open);
    caretAfter(e, needle(1, 2));
    const event = pasteEvent(e, SHAPES.rightSpan.html);
    expectLanded(e, event, SHAPES.rightSpan.text);
    const a = cellRects(tableOf(docOf(e))).find((c) => c.text === "A");
    expect(a?.rect).toMatchObject({ top: 1, left: 3, right: 4 });
    const rect = { top: 1, left: 2, right: 4, bottom: a?.rect.bottom ?? -1 };
    expect(selectionRect(view)).toEqual(rect);
    expectContained(e, rect, kept, Math.max(5, rect.bottom));
  });
});
