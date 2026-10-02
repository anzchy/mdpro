/**
 * D41 WI-4 — bare-view cases for the Tab gate change.
 *
 *  - C2-OWN-M1BLANK (amendment 5): at M1_BLANK caret 6 (header, column 0,
 *    below a blank line) the detection FIELD stays null — D41 does not change
 *    `getTableContext` — while Tab, which now classifies real lines itself,
 *    navigates into cell `a` at 7. After the press the field sees the table.
 *  - C2-DET: `hasTableDetection(state)` reports whether the detection field is
 *    installed. Imported as a namespace so a missing export fails an assertion
 *    rather than the module load.
 *
 * Matrix `.claude/tdd-guardian/tests-20261002-D41.md`. No mocks.
 */
import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import * as detection from "../src/plugins/codemirror/sourceTableDetection";
import { tableTabCommand } from "../src/plugins/codemirror/sourceTableTabNav";
import { D12_FIXTURES } from "./support/tableSpanOracle";

const { M1_BLANK, T3 } = D12_FIXTURES;

describe("D41 WI-4 — Tab gate is local to Tab", () => {
  it("C2-OWN-M1BLANK: the field is null at caret 6, yet Tab navigates to 7", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: M1_BLANK,
        selection: EditorSelection.cursor(6),
        extensions: [markdown(), detection.tableDetectionExtension()],
      }),
    });
    expect(detection.getTableContext(view.state)).toBeNull();
    expect(detection.getActiveTableCell(view.state)).toBeNull();
    expect(tableTabCommand(view)).toBe(true);
    expect({ head: view.state.selection.main.head, doc: view.state.doc.toString() }).toEqual({
      head: 7,
      doc: M1_BLANK,
    });
    expect(detection.getTableContext(view.state)?.headerLine).toBe(2);
    view.destroy();
  });
});

describe("D41 WI-4 — hasTableDetection", () => {
  it("C2-DET: true with the detection extension, false without", () => {
    const has = (detection as Record<string, unknown>).hasTableDetection;
    expect(typeof has).toBe("function");
    const check = has as (s: EditorState) => boolean;
    const withField = EditorState.create({ doc: T3, extensions: [markdown(), detection.tableDetectionExtension()] });
    const without = EditorState.create({ doc: T3, extensions: [markdown()] });
    expect([check(withField), check(without)]).toEqual([true, false]);
  });
});
