/**
 * @module tests/support/tabOwnershipOracle
 * Purpose: shared oracles for the D41 Tab-ownership suites
 * (`tests/source-editor-tab-d41-ownership.test.tsx`,
 * `tests/source-editor-tab-d41-prop-own.test.tsx`).
 *
 *  - `indentOracle`: what a FALL-THROUGH press must leave behind — the real
 *    `indentMore` / `indentLess` run on a bare `EditorState` (same doc, same
 *    selection, indent unit 4, multiple selections allowed). Independent of
 *    the table code: no detection field, no table keymap.
 *  - `completeTree`: force the mounted view's markdown parse to the end and
 *    adopt it (completeTreeState steps 1-2), so fence checks never depend on
 *    CPU load.
 *  - `swallowContexts`: the `context` of every `ui.table.tab_swallowed` log.
 *
 * Not a `*.test.ts`, so vitest does not collect it.
 */
import { EditorSelection, EditorState, type Transaction } from "@codemirror/state";
import { indentLess, indentMore } from "@codemirror/commands";
import { ensureSyntaxTree, indentUnit, syntaxTreeAvailable } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import { expect, type MockInstance } from "vitest";
import { FULL_PARSE_MS } from "./completeTreeState";

/** A selection: ranges (a range without `head` is a cursor) and the main index. */
export interface Sel {
  ranges: ReadonlyArray<{ anchor: number; head?: number }>;
  main: number;
}

export interface SelState {
  doc: string;
  ranges: Array<{ anchor: number; head: number }>;
  mainIndex: number;
}

/** The state `indentMore` (Tab) or `indentLess` (Shift-Tab) produces from `doc` at `sel`. */
export function indentOracle(doc: string, sel: Sel, shift: boolean): SelState {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.create(
      sel.ranges.map((r) => EditorSelection.range(r.anchor, r.head ?? r.anchor)),
      sel.main,
    ),
    extensions: [indentUnit.of("    "), EditorState.allowMultipleSelections.of(true)],
  });
  const command = shift ? indentLess : indentMore;
  command({
    state,
    dispatch: (tr: Transaction) => {
      state = tr.state;
    },
  });
  return {
    doc: state.doc.toString(),
    ranges: state.selection.ranges.map((r) => ({ anchor: r.anchor, head: r.head })),
    mainIndex: state.selection.mainIndex,
  };
}

/** Complete and adopt the mounted view's syntax tree (completeTreeState steps 1-2). */
export function completeTree(view: EditorView): void {
  expect(ensureSyntaxTree(view.state, view.state.doc.length, FULL_PARSE_MS)).not.toBeNull();
  view.dispatch({});
  expect(syntaxTreeAvailable(view.state, view.state.doc.length)).toBe(true);
}

/** Contexts of every `ui.table.tab_swallowed` call seen by a `logEventSync` spy. */
export function swallowContexts(spy: MockInstance): unknown[] {
  return (spy.mock.calls as Array<[{ event: string; context?: unknown }]>)
    .map(([p]) => p)
    .filter((p) => p.event === "ui.table.tab_swallowed")
    .map((p) => p.context);
}
