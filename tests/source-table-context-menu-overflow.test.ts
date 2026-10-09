/**
 * D49 WI-1.2: the source-mode table context menu on a real CodeMirror
 * `EditorView` (jsdom) keeps body cells past the header's column count.
 * `dispatchSourceTableAction` splices `applyEdit`'s widened output into the
 * document and puts the cursor on the target cell.
 *
 * Matrix: `.claude/tdd-guardian/tests-20261009-111653.md` "# WI-1.2",
 * CM-1 to CM-3 (CM-3 is a pin). Integration path; it runs under the `unit`
 * command (matrix finding 7). Only the Tauri boundary is mocked, so the
 * logging WI-1.3 adds stays deterministic. No Range layout shim: the view
 * measures without one here.
 */

import { describe, expect, it, vi } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";

import { tableDetectionExtension } from "../src/plugins/codemirror/sourceTableDetection";
import {
  computeSourceTableContext,
  dispatchSourceTableAction,
} from "../src/plugins/codemirror/sourceTableContextMenu";

vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock(),
);

const T2 = "| a | b |\n|---|---|\n| 1 | 2 | Z |\n| 3 | 4 |\n";
const H = "| a   | b   |     |";
const D = "| --- | --- | --- |";
const R1 = "| 1   | 2   | Z   |";
const R2 = "| 3   | 4   |     |";
const B3 = "|     |     |     |";
const DOC = "Intro\n\n" + T2 + "\nOutro\n";
const POS = DOC.indexOf("2 | Z");

function makeView(doc: string): EditorView {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(0),
    extensions: [markdown(), tableDetectionExtension()],
  });
  return new EditorView({ state });
}

describe("CM-1: reformat on an overflow document keeps Z", () => {
  it("rewrites the table widened and puts the cursor on cell (1,1)", () => {
    expect(POS).toBe(33);
    const view = makeView(DOC);
    expect(dispatchSourceTableAction(view, "reformat_table", POS)).toBe(true);
    expect(view.state.doc.toString()).toBe("Intro\n\n" + [H, D, R1, R2].join("\n") + "\n\nOutro\n");
    expect(view.state.selection.main.head).toBe(54);
    expect(view.state.doc.sliceString(54, 57)).toBe(" 2 ");
    view.destroy();
  });
});

describe("CM-2: insert_row_after on an overflow document keeps Z", () => {
  it("inserts a 3-cell blank row and puts the cursor in it", () => {
    const view = makeView(DOC);
    expect(dispatchSourceTableAction(view, "insert_row_after", POS)).toBe(true);
    expect(view.state.doc.toString()).toBe("Intro\n\n" + [H, D, R1, B3, R2].join("\n") + "\n\nOutro\n");
    expect(view.state.selection.main.head).toBe(74);
    view.destroy();
  });
});

describe("CM-3 (pin): header narrower than delimiter opens no menu and writes nothing", () => {
  it("has no context and leaves the document byte-identical", () => {
    const doc = "| a |\n|---|---|\n| 1 | 2 | Z |\n";
    const pos = doc.indexOf("2");
    const view = makeView(doc);
    expect(computeSourceTableContext(view.state, pos)).toBeNull();
    expect(dispatchSourceTableAction(view, "reformat_table", pos)).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);
    view.destroy();
  });
});
