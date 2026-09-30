/**
 * @module source-table-detection.test
 * Purpose: Verify the CodeMirror StateField that wraps tableParser
 * (Phase 2 WI-2.2). The field exposes the active TableModel | null
 * for the cursor position; downstream consumers (Tab nav, source-mode
 * context menu, cell highlight) read it instead of re-parsing.
 *
 * Strategy: real EditorState constructed with the markdown language +
 * tableDetectionExtension, then assert the field value at various
 * cursor positions.
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import {
  getTableContext,
  isPositionInFencedCode,
  tableDetectionExtension,
} from "../src/plugins/codemirror/sourceTableDetection";

function makeState(doc: string, cursor: number): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown(), tableDetectionExtension()],
  });
}

describe("sourceTableDetection — getTableContext", () => {
  it("returns null when the cursor is not in a table", () => {
    const state = makeState("Just some prose.\n", 5);
    expect(getTableContext(state)).toBeNull();
  });

  it("returns a TableSpan when the cursor is inside a table", () => {
    const md = "| a | b |\n| - | - |\n| 1 | 2 |\n";
    // cursor in cell `1`
    const state = makeState(md, 22);
    const ctx = getTableContext(state);
    expect(ctx).not.toBeNull();
    expect(ctx!.colCount).toBe(2);
    expect(ctx!.rowCount).toBe(2);
  });

  it("returns null when the cursor is inside a fenced code block", () => {
    const md = "```\n| a | b |\n| - | - |\n| 1 | 2 |\n```\n";
    // cursor inside `| 1 |` line of the fenced code block
    const cursor = md.indexOf("| 1");
    const state = makeState(md, cursor + 2);
    expect(getTableContext(state)).toBeNull();
  });

  it("returns the table when the cursor is OUTSIDE the fence but still in a table", () => {
    const md =
      "```\nignored | text\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n";
    // cursor in body cell `1`
    const cursor = md.lastIndexOf("| 1") + 2;
    const ctx = getTableContext(makeState(md, cursor));
    expect(ctx).not.toBeNull();
    expect(ctx!.colCount).toBe(2);
  });
});

describe("sourceTableDetection — isPositionInFencedCode", () => {
  it("returns true when the position is inside a ``` fence", () => {
    const md = "```\nfoo\nbar\n```\n";
    const state = makeState(md, md.indexOf("foo"));
    expect(isPositionInFencedCode(state, md.indexOf("foo"))).toBe(true);
  });

  it("returns false when the position is outside any fence", () => {
    const md = "outside\n```\ninside\n```\nalso outside\n";
    const state = makeState(md, md.indexOf("outside"));
    expect(isPositionInFencedCode(state, md.indexOf("outside"))).toBe(false);
    expect(
      isPositionInFencedCode(state, md.indexOf("also outside")),
    ).toBe(false);
  });

  it("returns true for ~~~ fences too", () => {
    const md = "~~~\nfoo\n~~~\n";
    const state = makeState(md, md.indexOf("foo"));
    expect(isPositionInFencedCode(state, md.indexOf("foo"))).toBe(true);
  });
});

describe("sourceTableDetection — extension wiring", () => {
  it("returns a CodeMirror Extension", () => {
    const ext = tableDetectionExtension();
    // Extensions are typed as Extension which is a union of Facet/Field/etc.
    // The shape we care about: we can pass it to EditorState.create.
    expect(() =>
      EditorState.create({ doc: "x", extensions: [markdown(), ext] }),
    ).not.toThrow();
  });
});
