/**
 * @module source-table-tab-nav.test
 * Purpose: Verify the source-mode Tab/Shift-Tab keymap (Phase 2 WI-2.3).
 * Mirrors the WYSIWYG WI-1.4 contract — Tab cycles cells, last-cell
 * Tab appends a new row, Shift-Tab cycles backward, no-op outside the
 * table or inside a fenced code block.
 */

import { describe, expect, it, vi } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import type { Command } from "@codemirror/view";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { completeTreeState } from "./support/completeTreeState";
import { D12_FIXTURES, ropeSpy } from "./support/tableSpanOracle";

// Passthrough: the real parser runs; the spy only counts (D12 WI-4).
vi.mock("../src/utils/tableParser/parse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils/tableParser/parse")>();
  return { ...actual, parseTableAtOffset: vi.fn(actual.parseTableAtOffset) };
});

const { parseTableAtOffset } = await import("../src/utils/tableParser/parse");
const { sourceTableTabKeymap, tableTabCommand, tableShiftTabCommand } = await import(
  "../src/plugins/codemirror/sourceTableTabNav"
);
const { tableDetectionExtension } = await import(
  "../src/plugins/codemirror/sourceTableDetection"
);

const parseSpy = vi.mocked(parseTableAtOffset);

function makeView(doc: string, cursor: number, detection = true): EditorView {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: detection ? [markdown(), tableDetectionExtension()] : [markdown()],
  });
  return new EditorView({ state });
}

/**
 * `makeView` for a fenced document: the detection field is created over a
 * complete syntax tree, so the fence check cannot miss under CPU load
 * (see `tests/support/completeTreeState.ts`).
 */
function makeCompleteView(doc: string, cursor: number): EditorView {
  const state = completeTreeState(
    doc,
    EditorSelection.single(cursor),
    markdown(),
    tableDetectionExtension(),
  );
  return new EditorView({ state });
}

describe("tableTabCommand — happy path", () => {
  it("returns false (no-op) when cursor is not in a table", () => {
    const view = makeView("Just prose.\n", 5);
    expect(tableTabCommand(view)).toBe(false);
  });

  it("moves cursor to the next cell on Tab", () => {
    const md = "| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n";
    // cursor in cell `1` (offset around 30)
    const cursorIn1 = md.indexOf("| 1") + 2;
    const view = makeView(md, cursorIn1);
    expect(tableTabCommand(view)).toBe(true);
    const newPos = view.state.selection.main.head;
    // New cursor should land somewhere within cell `2`
    const cell2Start = md.indexOf("| 2") + 1;
    const cell2End = cell2Start + 4;
    expect(newPos).toBeGreaterThanOrEqual(cell2Start);
    expect(newPos).toBeLessThanOrEqual(cell2End);
  });

  it("on the last cell of the last row, appends a new row and moves into it", () => {
    const md = "| a | b |\n| - | - |\n| 1 | 2 |\n";
    // cursor in last cell (`2` of body row)
    const cursor = md.lastIndexOf("| 2") + 2;
    const view = makeView(md, cursor);
    expect(tableTabCommand(view)).toBe(true);
    const docAfter = view.state.doc.toString();
    // A new row should have appeared with empty cells
    const lines = docAfter.split("\n").filter((l) => l.trim());
    expect(lines.length).toBeGreaterThan(3); // header + delim + 2 body rows
    // Cursor should be in the newly appended row's first cell
    const newPos = view.state.selection.main.head;
    expect(newPos).toBeGreaterThan(cursor);
  });
});

describe("tableShiftTabCommand", () => {
  it("returns false when not in a table", () => {
    const view = makeView("Just prose.\n", 5);
    expect(tableShiftTabCommand(view)).toBe(false);
  });

  it("moves cursor to the previous cell on Shift-Tab", () => {
    const md = "| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n";
    const cursorIn3 = md.lastIndexOf("3");
    const view = makeView(md, cursorIn3);
    expect(tableShiftTabCommand(view)).toBe(true);
    const newPos = view.state.selection.main.head;
    // Should land in cell `2` (which is at md.lastIndexOf('2'))
    const cell2Pos = md.lastIndexOf("2");
    expect(newPos).toBeLessThanOrEqual(cell2Pos + 1);
  });

  it("returns false (no-op) at the first cell of the header", () => {
    const md = "| a | b |\n| - | - |\n| 1 | 2 |\n";
    const cursor = md.indexOf("a"); // first header cell
    const view = makeView(md, cursor);
    expect(tableShiftTabCommand(view)).toBe(false);
  });
});

describe("tab nav — fence regression", () => {
  it("Tab inside a fenced code block returns false (lets the editor's default tab insert)", () => {
    const md = "```\n| a | b |\n| - | - |\n| 1 | 2 |\n```\n";
    const cursor = md.indexOf("| 1") + 2;
    const view = makeView(md, cursor);
    expect(tableTabCommand(view)).toBe(false);
  });
});

describe("sourceTableTabKeymap", () => {
  it("exports an array of CodeMirror keymap entries for Tab and Shift-Tab", () => {
    expect(Array.isArray(sourceTableTabKeymap)).toBe(true);
    const tabEntry = sourceTableTabKeymap.find((k) => k.key === "Tab");
    const shiftTabEntry = sourceTableTabKeymap.find((k) => k.key === "Shift-Tab");
    expect(tabEntry).toBeDefined();
    expect(shiftTabEntry).toBeDefined();
    expect(typeof tabEntry!.run).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// D12 WI-4 (ADR-0043 Decision 5): Tab / Shift-Tab build their own model on
// keypress. `getTableContext` stays the null gate; each gate-passing press
// then makes one `parseTableAtOffset` call at the pre-press head.
//
// Counting note (matrix): on the WI-4 tree the detection field still parses
// on every dispatched selection change, INSIDE the press. So the per-press
// count keeps only calls whose offset is the pre-press head. WI-5's SPAN-6
// tightens this to a total of exactly 1.
// ---------------------------------------------------------------------------

const { T3, NEP, FENCED_TABLE } = D12_FIXTURES;
/** T3 cell starts in row-major order: a b c / d e f / g h i. */
const T3_STARTS = [1, 5, 9, 29, 33, 37, 43, 47, 51];

/** One press, counted: parse calls at the pre-press head, rope snapshot. */
function press(view: EditorView, cmd: Command) {
  const headBefore = view.state.selection.main.head;
  const rope = ropeSpy(view.state.doc);
  parseSpy.mockClear();
  const handled = cmd(view);
  const parses = parseSpy.mock.calls.filter(([, o]) => o === headBefore).length;
  const allParses = parseSpy.mock.calls.length;
  const counts = rope.counts();
  rope.restore();
  return { handled, parses, allParses, counts, head: view.state.selection.main.head };
}

describe("D12 WI-4 — Tab / Shift-Tab materialise their own model", () => {
  it("TAB-1: Tab walks a 3x3 table in row-major order, then appends one row", () => {
    const view = makeView(T3, 2);
    const results = Array.from({ length: 9 }, () => press(view, tableTabCommand));
    expect(results.map((r) => r.handled)).toEqual(Array(9).fill(true));
    expect(results.map((r) => r.head)).toEqual([5, 9, 29, 33, 37, 43, 47, 51, 58]);
    expect(view.state.doc.toString()).toBe(
      "| a | b | c |\n| - | - | - |\n| d | e | f |\n| g | h | i |\n|  |  |  |\n\n",
    );
  });

  it("TAB-2: one parse at the pre-press head per press, and no press flattens the rope", () => {
    const view = makeView(T3, 2);
    parseSpy.mockClear(); // discard the field's create-time parse
    const tabs = Array.from({ length: 9 }, () => press(view, tableTabCommand));
    expect(tabs.map((r) => r.parses)).toEqual(Array(9).fill(1));
    expect(tabs.map((r) => r.counts.toString)).toEqual(Array(9).fill(0));
    expect(tabs.map((r) => r.head)).toEqual([5, 9, 29, 33, 37, 43, 47, 51, 58]);

    const back = makeView(T3, 34);
    parseSpy.mockClear();
    const r = press(back, tableShiftTabCommand);
    expect(r.parses).toBe(1);
    expect(r.counts.toString).toBe(0);
    expect(r.handled).toBe(true);
    expect(r.head).toBe(29);
  });

  it("TAB-3: Shift-Tab then Tab round-trips every non-first cell", () => {
    for (let j = 1; j < T3_STARTS.length; j += 1) {
      const view = makeView(T3, T3_STARTS[j] + 1);
      expect(tableShiftTabCommand(view)).toBe(true);
      expect(view.state.selection.main.head).toBe(T3_STARTS[j - 1]);
      expect(tableTabCommand(view)).toBe(true);
      expect(view.state.selection.main.head).toBe(T3_STARTS[j]);
      expect(view.state.doc.toString()).toBe(T3);
    }
  });

  it("TAB-4: Tab at column 0 of a no-edge-pipe body row moves to the next cell (Finding 1)", () => {
    const view = makeView(NEP, 12);
    expect(tableTabCommand(view)).toBe(true);
    expect(view.state.selection.main.head).toBe(15);
    expect(view.state.doc.toString()).toBe(NEP);
  });

  it.each([
    ["prose", "Just prose.\n", 5, true],
    ["fenced table", FENCED_TABLE, 26, true],
    ["withheld (no detection field)", T3, 2, false],
  ] as const)("TAB-5: %s falls through with 0 parses", (_name, doc, head, detection) => {
    for (const cmd of [tableTabCommand, tableShiftTabCommand]) {
      const view =
        doc === FENCED_TABLE ? makeCompleteView(doc, head) : makeView(doc, head, detection);
      parseSpy.mockClear();
      const r = press(view, cmd);
      expect(r.handled).toBe(false);
      expect(r.allParses).toBe(0);
      expect(r.head).toBe(head);
      expect(view.state.doc.toString()).toBe(doc);
    }
  });

  it.each([
    ["Tab on the delimiter row", 16, "tab"],
    ["Shift-Tab on the first header cell", 2, "shift"],
  ] as const)("TAB-6: %s passes the gate, parses once, returns false", (_n, head, which) => {
    const view = makeView(T3, head);
    parseSpy.mockClear();
    const r = press(view, which === "tab" ? tableTabCommand : tableShiftTabCommand);
    expect(r.handled).toBe(false);
    expect(r.parses).toBe(1);
    expect(r.head).toBe(head);
    expect(view.state.doc.toString()).toBe(T3);
  });
});
