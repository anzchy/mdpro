import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
});
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (await import("./support/menuEventsHarness")).invokeCapturingLogs,
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { act, cleanup, render, renderHook } from "@testing-library/react";
import { EditorSelection } from "@codemirror/state";
import { selectParentSyntax, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { Editor } from "../src/components/Editor/Editor";
import { TextSelection } from "@milkdown/kit/prose/state";
import { useKeyboardShortcuts } from "../src/hooks/useKeyboardShortcuts";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { rowById } from "../src/commands/commandTable";
import { rowStateOf } from "../src/components/common/settings/shortcuts/rowState";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "../src/types/preferences";
import { displayedShortcut } from "../src/utils/platformLabels";
import { logs } from "./support/menuEventsHarness";
import { mountMilkdownMenuRig } from "./support/editorMenuRig";

const originalPlatform = navigator.platform;
let unmountEditor: (() => void) | null = null;
let unmountHook: (() => void) | null = null;
const onSave = vi.fn();

function mount(doc = "alpha"): EditorView {
  useDocumentStore.setState({ activeDocumentId: "d255-key" });
  useEditorStore.setState({ viewMode: "source", editorView: null, sourceTableVerdicts: {} });
  const rendered = render(<Editor value={doc} onChange={vi.fn()} />);
  unmountEditor = rendered.unmount;
  const hook = renderHook(() => useKeyboardShortcuts({ onSave }));
  unmountHook = hook.unmount;
  const view = useEditorStore.getState().editorView;
  expect(view).not.toBeNull();
  return view!;
}

function press(view: EditorView, key: string, mods: KeyboardEventInit): KeyboardEvent {
  // Browser keydown reports an uppercase letter when Shift is held.
  if (mods.shiftKey && /^[a-z]$/.test(key)) key = key.toUpperCase();
  const event = new KeyboardEvent("keydown", {
    keyCode: /^[A-Z]$/.test(key) ? key.charCodeAt(0) : 0,
    key, bubbles: true, cancelable: true, ...mods,
  });
  act(() => { view.contentDOM.dispatchEvent(event); });
  return event;
}

beforeEach(() => {
  Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
  logs.length = 0;
  onSave.mockClear();
});

afterEach(() => {
  unmountHook?.();
  unmountEditor?.();
  unmountHook = null;
  unmountEditor = null;
  cleanup();
  useEditorStore.setState({ editorView: null, viewMode: "wysiwyg", sourceTableVerdicts: {} });
  useDocumentStore.setState({ activeDocumentId: null });
  Object.defineProperty(window.navigator, "platform", { value: originalPlatform, configurable: true });
});

it.each([
  ["format.strong", "b", { metaKey: true }, "**alpha**"],
  ["format.emphasis", "i", { metaKey: true }, "*alpha*"],
  ["format.code", "`", { metaKey: true, shiftKey: true }, "`alpha`"],
  ["format.strike", "`", { ctrlKey: true, shiftKey: true }, "~~alpha~~"],
  ["paragraph.codeFences", "c", { metaKey: true, altKey: true }, "```\nalpha\n```"],
  ["paragraph.orderedList", "o", { metaKey: true, altKey: true }, "1. alpha"],
  ["paragraph.unorderedList", "u", { metaKey: true, altKey: true }, "- alpha"],
  ["paragraph.mathBlock", "b", { metaKey: true, altKey: true }, "$$\nalpha\n$$"],
])("WI-7 %s uses its Mac v1 key once in the composed editor", (id, key, mods, want) => {
  const view = mount();
  view.dispatch({ selection: EditorSelection.single(0, 5) });
  const event = press(view, key, mods);
  expect(event.defaultPrevented).toBe(true);
  expect(view.state.doc.toString()).toBe(want);
  expect(onSave).not.toHaveBeenCalled();
  expect(logs.filter((entry) => entry.payload.event === "ui.editor.command"
    && entry.payload.context?.command === id)).toHaveLength(1);
});

it("WI-7 Cmd+I beats selectParentSyntax; Cmd+L selects a line; Shift+Cmd+D deletes a word", () => {
  const view = mount("alpha beta");
  view.dispatch({ selection: EditorSelection.single(0, 5) });
  expect(press(view, "i", { metaKey: true }).defaultPrevented).toBe(true);
  expect(view.state.doc.toString()).toBe("*alpha* beta");
  view.dispatch({ selection: EditorSelection.cursor(2) });
  expect(press(view, "l", { metaKey: true }).defaultPrevented).toBe(true);
  expect(view.state.selection.main.from).toBe(0);
  expect(view.state.selection.main.to).toBe(view.state.doc.length);
  view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
  expect(press(view, "d", { metaKey: true, shiftKey: true }).defaultPrevented).toBe(true);
  expect(view.state.doc.toString()).toBe("*alpha* ");
  expect(onSave).not.toHaveBeenCalled();
});

it("WI-7 off-Mac Ctrl+Shift+backtick is Code and Alt+Shift+5 is Strike", () => {
  Object.defineProperty(window.navigator, "platform", { value: "Win32", configurable: true });
  const view = mount();
  view.dispatch({ selection: EditorSelection.single(0, 5) });
  expect(press(view, "`", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
  expect(view.state.doc.toString()).toBe("`alpha`");
  view.dispatch({ selection: EditorSelection.single(1, 6) });
  expect(press(view, "5", { altKey: true, shiftKey: true }).defaultPrevented).toBe(true);
  expect(view.state.doc.toString()).toBe("`~~alpha~~`");
  expect(onSave).not.toHaveBeenCalled();
});

it.each([
  ["format.strong", "b", { ctrlKey: true }, "**alpha**"],
  ["format.emphasis", "i", { ctrlKey: true }, "*alpha*"],
  ["paragraph.codeFences", "c", { ctrlKey: true, altKey: true }, "```\nalpha\n```"],
  ["paragraph.mathBlock", "b", { ctrlKey: true, altKey: true }, "$$\nalpha\n$$"],
  ["paragraph.orderedList", "o", { ctrlKey: true, altKey: true }, "1. alpha"],
  ["paragraph.unorderedList", "u", { ctrlKey: true, altKey: true }, "- alpha"],
])("WI-7 off-Mac %s uses Ctrl as the v1 primary modifier", (id, key, mods, want) => {
  Object.defineProperty(window.navigator, "platform", { value: "Win32", configurable: true });
  const view = mount();
  view.dispatch({ selection: EditorSelection.single(0, 5) });
  const event = press(view, key, mods);
  expect(event.defaultPrevented).toBe(true);
  expect(view.state.doc.toString()).toBe(want);
  expect(logs.filter((entry) => entry.payload.event === "ui.editor.command"
    && entry.payload.context?.command === id)).toHaveLength(1);
});

it("WI-7 off-Mac Ctrl+L selects a line and Ctrl+Shift+D deletes a word", () => {
  Object.defineProperty(window.navigator, "platform", { value: "Win32", configurable: true });
  const view = mount("alpha beta");
  view.dispatch({ selection: EditorSelection.cursor(2) });
  expect(press(view, "l", { ctrlKey: true }).defaultPrevented).toBe(true);
  expect(view.state.selection.main.to).toBe(10);
  view.dispatch({ selection: EditorSelection.cursor(10) });
  expect(press(view, "d", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
  expect(view.state.doc.toString()).toBe("alpha ");
});

it("WI-7 WYSIWYG Cmd+B still applies a strong mark once", async () => {
  const rig = await mountMilkdownMenuRig("alpha");
  try {
    const view = rig.view;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
    const event = new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true, cancelable: true });
    act(() => { view.dom.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.firstChild?.firstChild?.marks.filter((mark) => mark.type.name === "strong")).toHaveLength(1);
  } finally {
    await rig.destroy();
  }
});

it("WI-7 a refused multiline Italic key does not fall through to selectParentSyntax", () => {
  const doc = "pre\nalpha\nbeta\npost";
  const view = mount(doc);
  view.dispatch({ selection: EditorSelection.single(4, 14) });
  const prior = view.state.selection;
  expect(selectParentSyntax(view)).toBe(true);
  expect(view.state.selection.eq(prior)).toBe(false);
  view.dispatch({ selection: prior });
  expect(press(view, "i", { metaKey: true }).defaultPrevented).toBe(true);
  expect(view.state.doc.toString()).toBe(doc);
  expect(view.state.selection.eq(prior)).toBe(true);
  expect(logs.filter((entry) => entry.payload.event === "ui.editor.command"
    && entry.payload.context?.command === "format.emphasis"
    && entry.payload.status === "cancel")).toHaveLength(1);
});

it("WI-7 consecutive Delete Word keys each make one separate undo step", () => {
  const view = mount("one two three");
  view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
  press(view, "d", { metaKey: true, shiftKey: true });
  expect(view.state.doc.toString()).toBe("one two ");
  press(view, "d", { metaKey: true, shiftKey: true });
  expect(view.state.doc.toString()).toBe("one ");
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("one two ");
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("one two three");
});

it("WI-8 Settings gives every new v1 Source command a key and capability", () => {
  for (const id of [
    "format.strong", "format.emphasis", "format.code", "format.strike",
    "paragraph.codeFences", "paragraph.orderedList", "paragraph.unorderedList",
    "paragraph.mathBlock", "edit.selectLine", "edit.deleteWord",
  ]) {
    const row = rowById(id)!;
    const value = DEFAULT_KEYBOARD_SHORTCUTS[row.prefField!];
    const expectedCapability = ["paragraph.mathBlock", "edit.selectLine", "edit.deleteWord",
      "paragraph.orderedList", "paragraph.unorderedList"].includes(id) ? "Source only" : null;
    for (const platform of ["macos", "windows", "linux"] as const) {
      const state = rowStateOf({
        row, platform, version: 1, local: DEFAULT_KEYBOARD_SHORTCUTS,
        saved: DEFAULT_KEYBOARD_SHORTCUTS, applied: null, conflicts: new Set(),
      });
      expect(state, `${id}/${platform}`).toMatchObject({ kind: "configurable", value, capability: expectedCapability });
      expect(displayedShortcut(row.prefField!, value, platform === "macos")).not.toBe("Not available");
    }
  }
  const quote = rowById("paragraph.quote")!;
  expect(rowStateOf({ row: quote, platform: "macos", version: 1,
    local: DEFAULT_KEYBOARD_SHORTCUTS, saved: DEFAULT_KEYBOARD_SHORTCUTS,
    applied: null, conflicts: new Set() })).toEqual({ kind: "unavailable" });
  expect(displayedShortcut("formatStrike", DEFAULT_KEYBOARD_SHORTCUTS.formatStrike, false)).toBe("Alt+Shift+5");
});
