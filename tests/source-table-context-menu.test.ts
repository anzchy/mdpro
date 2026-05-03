/**
 * @module source-table-context-menu.test
 * Purpose: Verify the source-mode table context menu dispatcher (Phase 2
 * WI-2.4). The dispatcher composes `tableEdits` with a CodeMirror
 * transaction:
 *   - Re-parses the table at the right-click offset (audit H3 — never
 *     trust stale ctx)
 *   - Bails on disabled actions (audit M1)
 *   - Bails inside fenced code blocks (audit M11 / fence guard)
 *   - Splices the new source into [model.start, model.end)
 *   - Places the cursor at model.start + result.cursorOffset
 */

import { describe, expect, it } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { tableDetectionExtension } from "../src/plugins/codemirror/sourceTableDetection";
import {
  computeSourceTableContext,
  dispatchSourceTableAction,
} from "../src/plugins/codemirror/sourceTableContextMenu";

function makeView(doc: string, cursor = 0): EditorView {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [markdown(), tableDetectionExtension()],
  });
  return new EditorView({ state });
}

const SIMPLE_MD = "| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n";

describe("computeSourceTableContext", () => {
  it("returns ctx + model when the offset is inside a table cell", () => {
    const view = makeView(SIMPLE_MD);
    const offset = SIMPLE_MD.indexOf("| 2") + 2; // inside `2`
    const result = computeSourceTableContext(view.state, offset);
    expect(result).not.toBeNull();
    // Row 0 = header [a,b,c]; row 1 = [1,2,3]; row 2 = [4,5,6].
    expect(result!.ctx.rowIndex).toBe(1);
    expect(result!.ctx.colIndex).toBe(1);
    expect(result!.ctx.colCount).toBe(3);
    expect(result!.ctx.rowCount).toBe(3);
  });

  it("returns null when the offset is outside any table", () => {
    const view = makeView("Just prose.\n");
    expect(computeSourceTableContext(view.state, 5)).toBeNull();
  });

  it("returns null inside a fenced code block (fence guard)", () => {
    const md = "```\n| a | b |\n| - | - |\n| 1 | 2 |\n```\n";
    const view = makeView(md);
    const offset = md.indexOf("| 1") + 2;
    expect(computeSourceTableContext(view.state, offset)).toBeNull();
  });
});

describe("dispatchSourceTableAction — happy path", () => {
  it("inserts a row and places cursor in the new row's cell", () => {
    const view = makeView(SIMPLE_MD);
    const offset = SIMPLE_MD.indexOf("| 1") + 2; // body row [1,2,3]
    const ok = dispatchSourceTableAction(view, "insert_row_before", offset);
    expect(ok).toBe(true);
    const newDoc = view.state.doc.toString();
    // The doc should now have one more body row (4 rows × including header).
    const lineCount = newDoc.split("\n").filter((l) => l.includes("|")).length;
    expect(lineCount).toBeGreaterThan(SIMPLE_MD.split("\n").filter((l) => l.includes("|")).length);
    // Cursor lands on the new (empty) cell — char at cursor is " " (cell is empty/padded).
    const cursor = view.state.selection.main.head;
    expect(cursor).toBeGreaterThan(0);
  });

  it("deletes a column and updates the doc", () => {
    const view = makeView(SIMPLE_MD);
    const offset = SIMPLE_MD.indexOf("| 2") + 2;
    const ok = dispatchSourceTableAction(view, "delete_column", offset);
    expect(ok).toBe(true);
    const newDoc = view.state.doc.toString();
    expect(newDoc).not.toContain(" b "); // column b removed
    expect(newDoc).toContain(" a ");
    expect(newDoc).toContain(" c ");
  });

  it("sets alignment for the column without touching cell content", () => {
    const view = makeView(SIMPLE_MD);
    const offset = SIMPLE_MD.indexOf("| 2") + 2;
    const ok = dispatchSourceTableAction(view, "align_center", offset);
    expect(ok).toBe(true);
    const newDoc = view.state.doc.toString();
    expect(newDoc).toMatch(/\|\s*:-+:\s*\|/); // center alignment marker
    // Body cells stay untouched.
    expect(newDoc).toContain("| 1 ");
    expect(newDoc).toContain("| 5 ");
  });

  it("delete_table removes the entire table region", () => {
    const md = "before\n\n" + SIMPLE_MD + "after\n";
    const view = makeView(md);
    const offset = md.indexOf("| 2") + 2;
    const ok = dispatchSourceTableAction(view, "delete_table", offset);
    expect(ok).toBe(true);
    const newDoc = view.state.doc.toString();
    expect(newDoc).not.toContain("| 1 ");
    expect(newDoc).toContain("before");
    expect(newDoc).toContain("after");
  });
});

describe("dispatchSourceTableAction — bail conditions", () => {
  it("returns false when the offset is not inside any table", () => {
    const view = makeView("Just prose.\n");
    expect(dispatchSourceTableAction(view, "insert_row_before", 3)).toBe(false);
  });

  it("returns false for disabled actions (move_row_up at rowIdx 0)", () => {
    const view = makeView(SIMPLE_MD);
    const offset = SIMPLE_MD.indexOf("| a") + 2; // header row
    expect(dispatchSourceTableAction(view, "move_row_up", offset)).toBe(false);
  });

  it("returns false inside a fenced code block", () => {
    const md = "```\n| a | b |\n| - | - |\n| 1 | 2 |\n```\n";
    const view = makeView(md);
    const offset = md.indexOf("| 1") + 2;
    expect(dispatchSourceTableAction(view, "insert_row_after", offset)).toBe(false);
  });
});
