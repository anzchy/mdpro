import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EditorSelection } from "@codemirror/state";
vi.hoisted(() => {
  Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
});
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock());

import { mountEditor, placeCursor, teardownEditor } from "./support/mountSourceEditor";
import { useKeyboardShortcuts } from "../src/hooks/useKeyboardShortcuts";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "../src/types/preferences";
import { useEditorStore } from "../src/stores/editorStore";
import { useDocumentStore } from "../src/stores/documentStore";

afterEach(teardownEditor);

it("M1b WI-12 moves a Source table row on its applied arrow and leaves prose to CodeMirror", () => {
  const doc = "| A | B |\n| --- | --- |\n| one | two |\n";
  const view = mountEditor(doc);
  const onTableAction = vi.fn();
  const { unmount } = renderHook(() => useKeyboardShortcuts({ onTableAction, shortcuts: DEFAULT_KEYBOARD_SHORTCUTS }));
  placeCursor(view, doc.indexOf("one"));
  const tableEvent = new KeyboardEvent("keydown", { key: "ArrowUp", metaKey: true, altKey: true, bubbles: true, cancelable: true });
  act(() => { view.contentDOM.dispatchEvent(tableEvent); });
  expect(tableEvent.defaultPrevented).toBe(true);
  expect(view.state.doc.toString().split("\n").filter((line) => line.includes("---"))).toHaveLength(1);
  expect(view.state.doc.toString().split("\n").filter((line) => line.startsWith("|"))).toHaveLength(4);
  expect(view.state.selection.ranges).toHaveLength(1);
  expect(onTableAction).not.toHaveBeenCalled();
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "plain\ntext" }, selection: { anchor: 2 } });
  const proseEvent = new KeyboardEvent("keydown", { key: "ArrowUp", metaKey: true, altKey: true, bubbles: true, cancelable: true });
  act(() => { view.contentDOM.dispatchEvent(proseEvent); });
  expect(view.state.doc.toString()).toBe("plain\ntext");
  unmount();
});

it.each([
  ["ArrowUp", false, 5, 2], ["ArrowDown", false, 5, 2],
  ["ArrowLeft", false, 4, 3], ["ArrowRight", false, 4, 3],
  ["Backspace", false, 3, 2], ["Backspace", true, 4, 1],
])("M1b WI-12 %s shift=%s changes exactly one Source table dimension", (key, shift, rows, columns) => {
  const doc = "| A | B |\n| --- | --- |\n| one | two |\n| three | four |\n";
  const view = mountEditor(doc);
  placeCursor(view, doc.indexOf("two"));
  const event = new KeyboardEvent("keydown", { key, shiftKey: shift, metaKey: true, altKey: true, bubbles: true, cancelable: true });
  act(() => { view.contentDOM.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  const lines = view.state.doc.toString().split("\n").filter((line) => line.startsWith("|"));
  expect(lines).toHaveLength(rows);
  expect((lines[0].match(/\|/g) ?? []).length - 1).toBe(columns);
  expect(view.state.selection.ranges).toHaveLength(1);
});

it("M1b WI-12 outside tables keeps CodeMirror's add-cursor arrow", () => {
  const prose = "plain\ntext";
  const view = mountEditor(prose);
  placeCursor(view, prose.indexOf("text"));
  // jsdom has no line geometry; supply the adjacent line's cursor position.
  vi.spyOn(view, "moveVertically").mockReturnValue(EditorSelection.cursor(1));
  const event = new KeyboardEvent("keydown", { key: "ArrowUp", metaKey: true, altKey: true, bubbles: true, cancelable: true });
  act(() => { view.contentDOM.dispatchEvent(event); });
  expect(view.state.doc.toString()).toBe(prose);
  expect(view.state.selection.ranges.length).toBeGreaterThan(1);
});

it("M1b WI-12 a withheld table never receives the table arrow action", () => {
  const doc = "| A | B |\n| --- | --- |\n| one | two |\n| three | four |\n";
  const view = mountEditor(doc, { withheld: true });
  placeCursor(view, doc.indexOf("two"));
  const event = new KeyboardEvent("keydown", { key: "ArrowUp", metaKey: true, altKey: true, bubbles: true, cancelable: true });
  act(() => { view.contentDOM.dispatchEvent(event); });
  expect(view.state.doc.toString()).toBe(doc);
});

it.each([
  ["ArrowUp", false, 5, 2], ["ArrowDown", false, 5, 2],
  ["ArrowLeft", false, 4, 3], ["ArrowRight", false, 4, 3],
  ["Backspace", false, 3, 2], ["Backspace", true, 4, 1],
])("table %s shift=%s follows allowed → withheld → allowed and a document switch", (key, shift, rows, columns) => {
  const doc = "| A | B |\n| --- | --- |\n| one | two |\n| three | four |\n";
  const view = mountEditor(doc, { docId: "table-a" });
  vi.spyOn(view, "moveVertically").mockReturnValue(EditorSelection.cursor(1));
  const onTableAction = vi.fn();
  const { unmount } = renderHook(() => useKeyboardShortcuts({ onTableAction, shortcuts: DEFAULT_KEYBOARD_SHORTCUTS }));
  const reset = () => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } });
  const fire = () => {
    placeCursor(view, view.state.doc.toString().indexOf("two"));
    act(() => { view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
      key, shiftKey: shift, metaKey: true, altKey: true, bubbles: true, cancelable: true,
    })); });
  };
  const dimension = () => {
    const lines = view.state.doc.toString().split("\n").filter((line) => line.startsWith("|"));
    expect(lines).toHaveLength(rows);
    expect((lines[0].match(/\|/g) ?? []).length - 1).toBe(columns);
  };
  fire();
  dimension();
  reset();
  act(() => useEditorStore.setState({ sourceTableVerdicts: { "table-a": "withheld" } }));
  fire();
  expect(view.state.doc.toString()).toBe(doc);
  act(() => useEditorStore.setState({ sourceTableVerdicts: {} }));
  fire();
  dimension();
  reset();
  act(() => {
    useDocumentStore.setState({ activeDocumentId: "table-b" });
    useEditorStore.setState({ sourceTableVerdicts: { "table-b": "withheld" } });
  });
  fire();
  expect(view.state.doc.toString()).toBe(doc);
  expect(onTableAction).not.toHaveBeenCalled();
  unmount();
});
