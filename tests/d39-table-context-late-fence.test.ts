/**
 * @module d39-table-context-late-fence.test
 * D39: the cursor's table context (and its cell highlight) must be cleared
 * by the transaction in which the incremental markdown parse first reaches
 * a code fence around the head, even when that transaction changes neither
 * the document nor the selection. Before the fix the field recomputed only
 * on `docChanged || selection`, so a stale span survived until the next
 * cursor move.
 *
 * Technique (same as `source-table-fence-late-tree.test.ts`): a fenced
 * table-shaped block placed well past `Work.InitViewport` is absent from
 * the tree at create time; `ensureSyntaxTree` completes the parse, and an
 * empty transaction adopts the complete tree (`LanguageState.apply`).
 *
 * Guards (hold before and after the fix): a tree advance that does not put
 * the head in a fence keeps the same span and cell objects; a plain table
 * with no fence behaves as before.
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ensureSyntaxTree, syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";

import {
  getActiveTableCell,
  getTableContext,
  isPositionInFencedCode,
  tableDetectionExtension,
} from "../src/plugins/codemirror/sourceTableDetection";
import { sourceTableCellHighlightExtension } from "../src/plugins/codemirror/sourceTableCellHighlight";
import { FULL_PARSE_MS } from "./support/completeTreeState";

const EXTENSIONS = [markdown(), tableDetectionExtension()];
const PREFIX = Array.from(
  { length: 200 },
  (_, i) => `Plain paragraph number ${i} with ordinary prose and no table syntax.\n\n`,
).join("");
const FENCE = "```\n| a | b |\n| - | - |\n| 1 | 2 |\n```\n";
const TABLE = "| x | y |\n| - | - |\n| 3 | 4 |\n\n";

const FENCED_DOC = PREFIX + FENCE;
const IN_FENCED_HEADER = FENCED_DOC.indexOf("| a | b |", PREFIX.length) + 2;

function field(s: EditorState) {
  return { span: getTableContext(s), cell: getActiveTableCell(s) };
}

function create(doc: string, head: number, extensions = EXTENSIONS): EditorState {
  return EditorState.create({ doc, selection: { anchor: head }, extensions });
}

/** Completes the parse, then dispatches an idle (no doc, no selection) transaction. */
function idleAfterFullParse(state: EditorState): EditorState {
  expect(ensureSyntaxTree(state, state.doc.length, FULL_PARSE_MS)).not.toBeNull();
  const idle = state.update({}).state;
  expect(syntaxTree(idle)).not.toBe(syntaxTree(state));
  return idle;
}

/** Counts the cell-highlight marks the view would draw. */
function highlightCount(view: EditorView): number {
  let n = 0;
  for (const source of view.state.facet(EditorView.decorations)) {
    const set = typeof source === "function" ? source(view) : source;
    set.between(0, view.state.doc.length, (_from, _to, deco) => {
      if (deco.spec.class === "cm-table-active-cell") n += 1;
    });
  }
  return n;
}

describe("D39 — a tree-only advance into a fence clears the table context", () => {
  it("clears span and cell in the idle transaction, before any cursor move", () => {
    const state = create(FENCED_DOC, IN_FENCED_HEADER);
    expect(syntaxTreeAvailable(state, IN_FENCED_HEADER)).toBe(false);
    expect(getTableContext(state)).not.toBeNull();
    expect(getActiveTableCell(state)).not.toBeNull();

    const idle = idleAfterFullParse(state);

    expect(isPositionInFencedCode(idle, IN_FENCED_HEADER)).toBe(true);
    expect(idle.selection.main.head).toBe(IN_FENCED_HEADER);
    expect(field(idle)).toEqual({ span: null, cell: null });
  });

  it("drops the cell highlight in the idle dispatch", () => {
    const view = new EditorView({
      state: create(FENCED_DOC, IN_FENCED_HEADER, [...EXTENSIONS, sourceTableCellHighlightExtension()]),
    });
    try {
      expect(isPositionInFencedCode(view.state, IN_FENCED_HEADER)).toBe(false);
      expect(highlightCount(view)).toBe(1);

      expect(ensureSyntaxTree(view.state, view.state.doc.length, FULL_PARSE_MS)).not.toBeNull();
      view.dispatch({});

      expect(isPositionInFencedCode(view.state, IN_FENCED_HEADER)).toBe(true);
      expect(highlightCount(view)).toBe(0);
    } finally {
      view.destroy();
    }
  });
});

describe("D39 guards — unchanged context is kept as-is", () => {
  it("a tree advance that does not fence the head keeps the same span and cell objects", () => {
    const doc = TABLE + PREFIX + FENCE;
    const head = doc.indexOf("| 3 |") + 2;
    const state = create(doc, head);
    const before = field(state);
    expect(before.span).not.toBeNull();
    expect(before.cell).not.toBeNull();
    expect(syntaxTreeAvailable(state, doc.length - 2)).toBe(false);

    const idle = idleAfterFullParse(state);

    expect(isPositionInFencedCode(idle, head)).toBe(false);
    expect(getTableContext(idle)).toBe(before.span);
    expect(getActiveTableCell(idle)).toBe(before.cell);
  });

  it("a tree advance with no table context keeps it null", () => {
    const head = 5; // in the prose prefix
    const state = create(FENCED_DOC, head);
    expect(field(state)).toEqual({ span: null, cell: null });

    const idle = idleAfterFullParse(state);

    expect(field(idle)).toEqual({ span: null, cell: null });
  });

  it("a plain table with no fence: idle keeps the objects, a move re-reads the cell, an edit recomputes", () => {
    const doc = TABLE;
    const state = create(doc, doc.indexOf("| 3 |") + 2);
    const before = field(state);
    expect(before.cell?.text ?? null).not.toBeNull();

    const idle = state.update({}).state;
    expect(getTableContext(idle)).toBe(before.span);
    expect(getActiveTableCell(idle)).toBe(before.cell);

    const moved = idle.update({ selection: { anchor: doc.indexOf("4 |") } }).state;
    expect(getTableContext(moved)).toBe(before.span);
    expect(getActiveTableCell(moved)).not.toEqual(before.cell);

    const edited = moved.update({ changes: { from: 0, insert: "prose\n\n" } }).state;
    expect(getTableContext(edited)).not.toBeNull();
    expect(getTableContext(edited)).not.toBe(before.span);
  });
});
