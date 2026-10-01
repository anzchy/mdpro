/**
 * D40 — Source-mode (⌃2) Tab / Shift-Tab table-cell navigation is pre-empted by
 * `@uiw/react-codemirror`'s default `keymap.of([indentWithTab])`.
 *
 * Plan: `.claude/tdd-guardian/plan-20261001-231949.md`; matrix:
 * `.claude/tdd-guardian/tests-20261001-231949.md`.
 *
 * Mounts the REAL `Editor` (real `<CodeMirror>` wrapper, real extensions memo, real
 * `sourceTableExtensions` call) and drives keys through `runScopeHandlers`, the same
 * handler path CodeMirror's own keydown listener uses, over every keymap on the view
 * — the wrapper's defaults included. A unit test of `tableTabCommand` alone passes
 * today (TAB-1); only the mounted editor shows the precedence bug.
 *
 * Mocked boundaries: `@tauri-apps/api/core` and `@tauri-apps/api/event` only (jsdom has
 * no Tauri runtime; reached through logging and plugin init, never on the keypress
 * path). No own-module mocks in this file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async () => null),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import type { ReactElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { EditorSelection, StateEffect } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { getIndentUnit, indentUnit } from "@codemirror/language";
import { Editor } from "../src/components/Editor/Editor";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { D12_FIXTURES } from "./support/tableSpanOracle";
// WI-2 additions (fall-through pins, transitions, selection shape).
import { act } from "@testing-library/react";
import { ensureSyntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import {
  getTableContext,
  isPositionInFencedCode,
} from "../src/plugins/codemirror/sourceTableDetection";
import { FULL_PARSE_MS } from "./support/completeTreeState";

// ---------------------------------------------------------------------------
// Hand-written oracle — independent of the parser under test.
// ---------------------------------------------------------------------------
const { T3 } = D12_FIXTURES;
/** Half-open `[start, end)` cells of T3, row-major: a b c / d e f / g h i. */
const T3_CELLS: ReadonlyArray<readonly [number, number]> = [
  [1, 4], [5, 8], [9, 12],
  [29, 32], [33, 36], [37, 40],
  [43, 46], [47, 50], [51, 54],
];
const T3_STARTS = [1, 5, 9, 29, 33, 37, 43, 47, 51];
const T3_LINE_STARTS = [0, 14, 28, 42, 56];
/** T3 after Tab on the last cell appends one blank row (TAB-1). */
const T3_APPENDED =
  "| a | b | c |\n| - | - | - |\n| d | e | f |\n| g | h | i |\n|  |  |  |\n\n";
/** T3 with line 1 indented by one indent unit (what `indentMore` gives at head 2). */
const T3_LINE1_INDENTED = "    | a | b | c |\n| - | - | - |\n| d | e | f |\n| g | h | i |\n";
const INDENT = "    ";
const DOC_ID = "doc-1";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
type Outcome = { handled: boolean; head: number; doc: string };

let unmountEditor: (() => void) | null = null;
let rerenderEditor: ((ui: ReactElement) => void) | null = null;

function seedStores(docId: string, withheld: boolean): void {
  useDocumentStore.setState({ activeDocumentId: docId });
  useEditorStore.setState({
    editorView: null,
    sourceTableVerdicts: withheld ? { [docId]: "withheld" } : {},
  });
}

function mountEditor(
  doc: string,
  { docId = DOC_ID, withheld = false }: { docId?: string; withheld?: boolean } = {},
): EditorView {
  seedStores(docId, withheld);
  const onChange = vi.fn();
  const r = render(<Editor value={doc} onChange={onChange} />);
  unmountEditor = r.unmount;
  rerenderEditor = r.rerender;
  const view = useEditorStore.getState().editorView;
  // Preconditions — a harness failure must never be read as a behaviour failure.
  expect(view).not.toBeNull();
  const v = view!;
  expect(v.state.doc.toString()).toBe(doc);
  expect(getIndentUnit(v.state)).toBe(4);
  expect(v.state.facet(indentUnit)).toBe(INDENT);
  expect(v.state.facet(EditorView.editable)).toBe(true);
  return v;
}

function press(view: EditorView, shift: boolean): Outcome {
  const handled = runScopeHandlers(
    view,
    new KeyboardEvent("keydown", { key: "Tab", shiftKey: shift }),
    "editor",
  );
  return { handled, head: view.state.selection.main.head, doc: view.state.doc.toString() };
}

function placeCursor(view: EditorView, h: number): void {
  view.dispatch({ selection: EditorSelection.cursor(h) });
}

function resetDoc(view: EditorView, text: string, h: number): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: EditorSelection.cursor(h),
  });
}

/** Index of the T3 cell containing `h`, or -1 when `h` is in no cell. */
function cellIndexOf(h: number): number {
  return T3_CELLS.findIndex(([s, e]) => h >= s && h < e);
}

/** Greatest T3 line start `<= h`. */
function lineStartOf(h: number): number {
  return T3_LINE_STARTS.filter((ls) => ls <= h).pop()!;
}

beforeEach(() => {
  seedStores(DOC_ID, false);
});

afterEach(() => {
  // Runs Editor's cleanup effect → `pluginRegistry.cleanup()` on the singleton.
  unmountEditor?.();
  unmountEditor = null;
  rerenderEditor = null;
  cleanup();
  useEditorStore.setState({ editorView: null, sourceTableVerdicts: {} });
  useDocumentStore.setState({ activeDocumentId: null });
});

// ---------------------------------------------------------------------------
// RED cases (WI-1). On 8a73eeb the wrapper's `indentWithTab` runs before the
// table keymap, so every in-cell Tab indents the line instead of moving.
// ---------------------------------------------------------------------------
describe("D40 — table Tab keymap precedence in the mounted Source editor", () => {
  it("R1: Tab in header cell `a` moves to cell `b`, text unchanged", () => {
    const view = mountEditor(T3);
    placeCursor(view, 2);
    expect(press(view, false)).toEqual({ handled: true, head: 5, doc: T3 });
  });

  it("R2: Shift-Tab in body cell `e` moves to cell `d`, text unchanged", () => {
    const view = mountEditor(T3);
    placeCursor(view, 34);
    expect(press(view, true)).toEqual({ handled: true, head: 29, doc: T3 });
  });

  it("R3: 8 Tabs out and 8 Shift-Tabs back visit every cell and conserve the text", () => {
    const view = mountEditor(T3);
    placeCursor(view, 2);
    const outcomes: Outcome[] = [];
    for (let i = 0; i < 8; i++) outcomes.push(press(view, false));
    for (let i = 0; i < 8; i++) outcomes.push(press(view, true));
    expect(outcomes.map((o) => o.handled)).toEqual(Array(16).fill(true));
    expect(outcomes.map((o) => o.head)).toEqual([
      5, 9, 29, 33, 37, 43, 47, 51,
      47, 43, 37, 33, 29, 9, 5, 1,
    ]);
    expect(outcomes.map((o) => o.doc)).toEqual(Array(16).fill(T3));
  });

  it("R4: the real DOM keydown path agrees with runScopeHandlers", () => {
    const view = mountEditor(T3);
    placeCursor(view, 2);
    const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(ev);
    expect({ head: view.state.selection.main.head, doc: view.state.doc.toString() }).toEqual({
      head: 5,
      doc: T3,
    });
    // L4 supplement only: also true on the base, because indentWithTab consumes it too.
    expect(ev.defaultPrevented).toBe(true);
  });

  it("R5: Tab on the last cell appends exactly one blank row", () => {
    const view = mountEditor(T3);
    placeCursor(view, 52);
    expect(press(view, false)).toEqual({ handled: true, head: 58, doc: T3_APPENDED });
  });

  it("R6: a re-render (wrapper reconfigure) keeps table Tab precedence", () => {
    const view = mountEditor(T3);
    const spy = vi.spyOn(view, "dispatch");
    rerenderEditor!(<Editor value={T3} onChange={vi.fn()} />);
    // Preconditions (L4): same view instance, and a reconfigure really ran.
    expect(useEditorStore.getState().editorView).toBe(view);
    const sawReconfigure = spy.mock.calls.some(([s]) =>
      [(s as { effects?: unknown } | undefined)?.effects]
        .flat()
        .some((e) => (e as StateEffect<unknown> | undefined)?.is?.(StateEffect.reconfigure)),
    );
    expect(sawReconfigure).toBe(true);
    spy.mockRestore();
    placeCursor(view, 2);
    expect(press(view, false)).toEqual({ handled: true, head: 5, doc: T3 });
  });

  it("PROP-TAB: Tab over every offset of T3 equals the partition oracle", () => {
    const view = mountEditor(T3);
    const actual: Outcome[] = [];
    const expected: Outcome[] = [];
    for (let h = 0; h <= T3.length; h++) {
      resetDoc(view, T3, h);
      actual.push(press(view, false));
      const k = cellIndexOf(h);
      if (k >= 0 && k < 8) {
        expected.push({ handled: true, head: T3_STARTS[k + 1], doc: T3 });
      } else if (k === 8) {
        expected.push({ handled: true, head: 58, doc: T3_APPENDED });
      } else {
        const ls = lineStartOf(h);
        expected.push({
          handled: true,
          head: h + INDENT.length,
          doc: T3.slice(0, ls) + INDENT + T3.slice(ls),
        });
      }
    }
    expect(actual).toEqual(expected);
  });

  it("PROP-SHIFT: Shift-Tab over every offset of T3 conserves the text and moves only from non-first cells", () => {
    const view = mountEditor(T3);
    const actual: Outcome[] = [];
    const expected: Outcome[] = [];
    for (let h = 0; h <= T3.length; h++) {
      resetDoc(view, T3, h);
      actual.push(press(view, true));
      const k = cellIndexOf(h);
      expected.push(
        k >= 1
          ? { handled: true, head: T3_STARTS[k - 1], doc: T3 }
          : { handled: true, head: h, doc: T3 },
      );
    }
    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// WI-2 pins. Fall-through: when the table command returns false the wrapper's
// default indentMore / indentLess runs unchanged (no own law — third-party
// behaviour pinned by example). Transitions and selection shape (decision A:
// Tab in a table navigates from the main head and collapses the selection).
// ---------------------------------------------------------------------------
describe("D40 — fall-through to the default indent", () => {
  it("P1: Tab outside a table indents", () => {
    const view = mountEditor("Just prose.\n");
    placeCursor(view, 5);
    expect(press(view, false)).toEqual({ handled: true, head: 9, doc: "    Just prose.\n" });
  });

  it("P2: Shift-Tab outside a table dedents", () => {
    const view = mountEditor("    Just prose.\n");
    placeCursor(view, 9);
    expect(press(view, true)).toEqual({ handled: true, head: 5, doc: "Just prose.\n" });
  });

  it("P3: Tab in a fenced code line indents only that line", () => {
    const view = mountEditor("```\nlet x = 1;\n```\n");
    placeCursor(view, 5);
    expect(press(view, false)).toEqual({
      handled: true,
      head: 9,
      doc: "```\n    let x = 1;\n```\n",
    });
  });

  it("P4: a table inside a fence falls through to indent, not cell navigation", () => {
    const { FENCED_TABLE } = D12_FIXTURES;
    const view = mountEditor(FENCED_TABLE);
    expect(ensureSyntaxTree(view.state, view.state.doc.length, FULL_PARSE_MS)).not.toBeNull();
    view.dispatch({}); // LanguageState adopts the completed tree (completeTreeState step 2).
    expect(syntaxTreeAvailable(view.state, view.state.doc.length)).toBe(true);
    placeCursor(view, 26);
    expect(isPositionInFencedCode(view.state, 26)).toBe(true);
    expect(getTableContext(view.state)).toBeNull();
    expect(press(view, false)).toEqual({
      handled: true,
      head: 30,
      doc: "```\n| a | b |\n| - | - |\n    | 1 | 2 |\n```\n",
    });
  });

  it("P5: a withheld document falls through to indent", () => {
    const view = mountEditor(T3, { docId: DOC_ID, withheld: true });
    expect(getTableContext(view.state)).toBeNull();
    placeCursor(view, 2);
    expect(press(view, false)).toEqual({ handled: true, head: 6, doc: T3_LINE1_INDENTED });
  });

  it("P7: Shift-Tab on the first header cell falls through to dedent", () => {
    const H2 = "  | a | b | c |\n| - | - | - |\n| d | e | f |\n| g | h | i |\n";
    const view = mountEditor(H2);
    placeCursor(view, 4);
    expect(getTableContext(view.state)).not.toBeNull();
    expect(press(view, true)).toEqual({ handled: true, head: 2, doc: T3 });
  });

  it("P8: Tab on the delimiter row falls through to indent", () => {
    const view = mountEditor(T3);
    placeCursor(view, 16);
    expect(getTableContext(view.state)).not.toBeNull();
    expect(press(view, false)).toEqual({
      handled: true,
      head: 20,
      doc: "| a | b | c |\n    | - | - | - |\n| d | e | f |\n| g | h | i |\n",
    });
  });
});

describe("D40 — verdict transitions keep the right Tab owner", () => {
  it("P9: a verdict flipping to withheld after mount turns table Tab into indent", () => {
    const view = mountEditor(T3, { docId: DOC_ID });
    placeCursor(view, 2);
    expect(press(view, false)).toEqual({ handled: true, head: 5, doc: T3 });
    act(() => {
      expect(useEditorStore.getState().recordSourceTableVerdict(DOC_ID, "withheld")).toBe(true);
    });
    expect(useEditorStore.getState().editorView).toBe(view);
    expect(getTableContext(view.state)).toBeNull();
    placeCursor(view, 2);
    expect(press(view, false)).toEqual({ handled: true, head: 6, doc: T3_LINE1_INDENTED });
  });

  it("P9b: withheld → live via an active-document switch restores table Tab", () => {
    const view = mountEditor(T3, { docId: DOC_ID, withheld: true });
    expect(getTableContext(view.state)).toBeNull();
    act(() => {
      useDocumentStore.setState({ activeDocumentId: "doc-2" });
    });
    placeCursor(view, 2);
    expect(getTableContext(view.state)).not.toBeNull();
    expect(useEditorStore.getState().editorView).toBe(view);
    expect(press(view, false)).toEqual({ handled: true, head: 5, doc: T3 });
  });
});

describe("D40 — selection shape inside a table (decision A)", () => {
  function pressShape(view: EditorView) {
    const { handled, head, doc } = press(view, false);
    return { handled, ranges: view.state.selection.ranges.length, head, doc };
  }

  it("SEL-1: multi-cursor Tab in a table navigates from the main cursor", () => {
    const view = mountEditor(T3);
    view.dispatch({
      selection: EditorSelection.create([EditorSelection.cursor(2), EditorSelection.cursor(34)], 0),
    });
    expect(view.state.selection.ranges.length).toBe(2);
    expect(pressShape(view)).toEqual({ handled: true, ranges: 1, head: 5, doc: T3 });
  });

  it("SEL-1b: multi-cursor Tab uses the main range, not ranges[0]", () => {
    const view = mountEditor(T3);
    view.dispatch({
      selection: EditorSelection.create([EditorSelection.cursor(2), EditorSelection.cursor(34)], 1),
    });
    expect(view.state.selection.ranges.length).toBe(2);
    expect(view.state.selection.main.head).toBe(34);
    expect(pressShape(view)).toEqual({ handled: true, ranges: 1, head: 37, doc: T3 });
  });

  it("SEL-2: range-selection Tab in a table navigates from the head and collapses", () => {
    const view = mountEditor(T3);
    view.dispatch({ selection: EditorSelection.single(2, 31) });
    const { handled, head, doc } = press(view, false);
    expect({ handled, empty: view.state.selection.main.empty, head, doc }).toEqual({
      handled: true,
      empty: true,
      head: 33,
      doc: T3,
    });
  });
});

// Sanity: the oracle constants agree with each other (not with the parser).
it("oracle: T3 constants are self-consistent", () => {
  expect(T3.length).toBe(56);
  expect(T3_CELLS.map(([s]) => s)).toEqual(T3_STARTS);
  expect(T3_LINE1_INDENTED).toBe(INDENT + T3);
});
