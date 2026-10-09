/**
 * @module source-table-cell-highlight.test
 * Purpose: Verify the source-mode cell-highlight decoration (Phase 2
 * WI-2.5). Uses CodeMirror's Decoration system to add a class to the
 * cell text range under the cursor.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView, Decoration } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import {
  sourceTableCellHighlightExtension,
  computeCellHighlightDecorations,
} from "../src/plugins/codemirror/sourceTableCellHighlight";
import { tableDetectionExtension } from "../src/plugins/codemirror/sourceTableDetection";
import { readAppCssNonTheme } from "../src/test/appCss";

function makeView(doc: string, cursor: number): EditorView {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [markdown(), tableDetectionExtension(), sourceTableCellHighlightExtension()],
  });
  return new EditorView({ state });
}

describe("computeCellHighlightDecorations", () => {
  it("returns an empty DecorationSet when not in a table", () => {
    const state = EditorState.create({
      doc: "Just prose.\n",
      selection: EditorSelection.cursor(5),
      extensions: [markdown(), tableDetectionExtension()],
    });
    const decos = computeCellHighlightDecorations(state);
    expect(decos.size).toBe(0);
  });

  it("returns a single decoration covering the active cell when in a table", () => {
    const md = "| a | b |\n| - | - |\n| 1 | 2 |\n";
    const cursor = md.indexOf("| 1") + 2;
    const state = EditorState.create({
      doc: md,
      selection: EditorSelection.cursor(cursor),
      extensions: [markdown(), tableDetectionExtension()],
    });
    const decos = computeCellHighlightDecorations(state);
    expect(decos.size).toBe(1);
  });

  it("returns no decorations when the cursor is in the delimiter row", () => {
    const md = "| a | b |\n| - | - |\n| 1 | 2 |\n";
    // Cursor in the delimiter row (line starts at offset 9, dash at 12)
    const state = EditorState.create({
      doc: md,
      selection: EditorSelection.cursor(13),
      extensions: [markdown(), tableDetectionExtension()],
    });
    const decos = computeCellHighlightDecorations(state);
    expect(decos.size).toBe(0);
  });
});

describe("sourceTableCellHighlightExtension — wiring", () => {
  it("registers an extension that does not throw on construction", () => {
    expect(() => {
      const view = makeView("| a | b |\n| - | - |\n| 1 | 2 |\n", 22);
      // Force render to ensure no exceptions during decoration computation.
      view.requestMeasure();
    }).not.toThrow();
  });

  it("the highlight CSS rule exists in MilkdownEditor.css path or globals", () => {
    // The CSS for the source-mode cell highlight class lives in either
    // the milkdown-editor scope (if shared) or globals (if source-only).
    const ROOT = path.resolve(__dirname, "..");
    // Consult both candidate stylesheets
    const milkdownCss = path.join(ROOT, "src/components/Editor/MilkdownEditor.css");
    const candidates = [
      readAppCssNonTheme(),
      fs.existsSync(milkdownCss) ? fs.readFileSync(milkdownCss, "utf-8") : "",
    ];
    let found = false;
    for (const css of candidates) {
      if (/cm-table-active-cell|source-table-active-cell|cm-active-table-cell/.test(css)) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });
});

// Wider Decoration type for assertion convenience
void Decoration;
