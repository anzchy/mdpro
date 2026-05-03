/**
 * @module source-table-tab-nav.test
 * Purpose: Verify the source-mode Tab/Shift-Tab keymap (Phase 2 WI-2.3).
 * Mirrors the WYSIWYG WI-1.4 contract — Tab cycles cells, last-cell
 * Tab appends a new row, Shift-Tab cycles backward, no-op outside the
 * table or inside a fenced code block.
 */

import { describe, expect, it } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import {
  sourceTableTabKeymap,
  tableTabCommand,
  tableShiftTabCommand,
} from "../src/plugins/codemirror/sourceTableTabNav";
import { tableDetectionExtension } from "../src/plugins/codemirror/sourceTableDetection";

function makeView(doc: string, cursor: number): EditorView {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [markdown(), tableDetectionExtension()],
  });
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
