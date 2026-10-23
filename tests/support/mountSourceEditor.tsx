/**
 * @module tests/support/mountSourceEditor
 * Purpose: shared mounted Source-editor harness for the Tab / Shift-Tab table
 * navigation tests (D41 WI-0). Extracted from the D40 file
 * `tests/source-editor-tab-precedence.test.tsx`, which keeps its own copy.
 *
 * Mounts the REAL `Editor` (real `<CodeMirror>` wrapper, real extensions memo)
 * and drives keys through `runScopeHandlers(view, KeyboardEvent, "editor")` —
 * the handler path CodeMirror's own keydown listener uses, over every keymap on
 * the view, the wrapper's `indentWithTab` included. Because that fallback always
 * returns true, callers assert doc + ranges + mainIndex, never `handled`, to
 * tell a swallow from a fall-through.
 *
 * Boundary mocks are NOT declared here: `vi.mock` is only hoisted in the test
 * file, so each consumer mocks `@tauri-apps/api/core` and
 * `@tauri-apps/api/event` itself (see `tests/source-editor-tab-leading-blank.test.tsx`).
 *
 * Not a `*.test.tsx`, so vitest does not collect it.
 */
import { cleanup, render } from "@testing-library/react";
import { EditorSelection } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { getIndentUnit, indentUnit } from "@codemirror/language";
import { expect, vi } from "vitest";

import { Editor } from "../../src/components/Editor/Editor";
import { useDocumentStore } from "../../src/stores/documentStore";
import { useEditorStore } from "../../src/stores/editorStore";
import type { AppliedShortcuts } from "../../src/types/keyboardShortcuts";

export const INDENT = "    ";
export const DOC_ID = "doc-1";

/** What one key press leaves behind. `handled` is informational only (see header). */
export interface PressOutcome {
  handled: boolean;
  head: number;
  doc: string;
  ranges: Array<{ anchor: number; head: number }>;
  mainIndex: number;
}

let unmountEditor: (() => void) | null = null;

/** Seed the stores the Editor reads on mount. */
export function seedStores(docId: string = DOC_ID, withheld = false): void {
  useDocumentStore.setState({ activeDocumentId: docId });
  useEditorStore.setState({
    editorView: null,
    sourceTableVerdicts: withheld ? { [docId]: "withheld" } : {},
  });
}

/**
 * Mount the real Editor on `doc` and return its live view. The preconditions
 * (indent unit 4, editable, doc === input) are asserted here so a harness
 * failure can never be read as a behaviour failure.
 */
export function mountEditor(
  doc: string,
  { docId = DOC_ID, withheld = false, appliedShortcuts }: { docId?: string; withheld?: boolean; appliedShortcuts?: AppliedShortcuts | null } = {},
): EditorView {
  seedStores(docId, withheld);
  const r = render(<Editor value={doc} onChange={vi.fn()} appliedShortcuts={appliedShortcuts} />);
  unmountEditor = r.unmount;
  const view = useEditorStore.getState().editorView;
  expect(view).not.toBeNull();
  const v = view!;
  expect(v.state.doc.toString()).toBe(doc);
  expect(getIndentUnit(v.state)).toBe(4);
  expect(v.state.facet(indentUnit)).toBe(INDENT);
  expect(v.state.facet(EditorView.editable)).toBe(true);
  return v;
}

/** Unmount the editor and reset the stores. Call from `afterEach`. */
export function teardownEditor(): void {
  // Runs Editor's cleanup effect → `pluginRegistry.cleanup()` on the singleton.
  unmountEditor?.();
  unmountEditor = null;
  cleanup();
  useEditorStore.setState({ editorView: null, sourceTableVerdicts: {} });
  useDocumentStore.setState({ activeDocumentId: null });
}

/** Snapshot of the view's doc and selection. */
export function snapshot(view: EditorView, handled = false): PressOutcome {
  const sel = view.state.selection;
  return {
    handled,
    head: sel.main.head,
    doc: view.state.doc.toString(),
    ranges: sel.ranges.map((r) => ({ anchor: r.anchor, head: r.head })),
    mainIndex: sel.mainIndex,
  };
}

/** Press Tab (or Shift-Tab) through every keymap on the view. */
export function press(view: EditorView, shift: boolean): PressOutcome {
  const handled = runScopeHandlers(
    view,
    new KeyboardEvent("keydown", { key: "Tab", shiftKey: shift }),
    "editor",
  );
  return snapshot(view, handled);
}

/** Collapse the selection to one cursor at `h`. */
export function placeCursor(view: EditorView, h: number): void {
  view.dispatch({ selection: EditorSelection.cursor(h) });
}

/** Replace the whole doc with `text` and put one cursor at `h`. */
export function resetDoc(view: EditorView, text: string, h: number): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: EditorSelection.cursor(h),
  });
}

/** Set a multi-range selection; a range without `head` is a cursor. */
export function select(
  view: EditorView,
  ranges: ReadonlyArray<{ anchor: number; head?: number }>,
  mainIndex = 0,
): void {
  view.dispatch({
    selection: EditorSelection.create(
      ranges.map((r) => EditorSelection.range(r.anchor, r.head ?? r.anchor)),
      mainIndex,
    ),
  });
}
