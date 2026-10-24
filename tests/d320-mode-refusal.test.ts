import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
});
vi.mock("@tauri-apps/api/window", async () => (await import("./support/menuEventsHarness")).windowModuleMock());
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (await import("./support/menuEventsHarness")).invokeCapturingLogs,
}));

import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { act, renderHook } from "@testing-library/react";
import { sourceFormatKeymap } from "../src/plugins/codemirror/sourceFormatPlugin";
import { dispatchEditorMenuAction } from "../src/hooks/editorMenuActionTable";
import { captureToken } from "../src/utils/menuTargetToken";
import { useEditorStore } from "../src/stores/editorStore";
import { useToastStore } from "../src/stores/toastStore";
import { useTableInsertStore } from "../src/stores/tableInsertStore";
import { logs } from "./support/menuEventsHarness";
import { resetMenuHarness } from "./support/menuEventsDomain";
import { seedStores } from "./support/editorGenerationDomain";
import { mountMilkdownMenuRig, type MilkdownMenuRig } from "./support/editorMenuRig";
import { appliedStoredShortcuts, defaultAppliedShortcuts } from "../src/commands/appliedKeymap";
import { useKeyboardShortcuts } from "../src/hooks/useKeyboardShortcuts";
import { triggerTableInsert } from "../src/utils/tableInsertTrigger";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { EditorSelection } from "@codemirror/state";

let milkdown: MilkdownMenuRig | null = null;
let source: EditorView | null = null;
let root: HTMLElement | null = null;

beforeEach(() => {
  resetMenuHarness(); seedStores(); useToastStore.getState().clearToast();
  useTableInsertStore.getState().clearPending();
});

afterEach(async () => {
  useMilkdownEditorStore.getState().unregisterEditor();
  source?.destroy(); source = null;
  root?.remove(); root = null;
  await milkdown?.destroy(); milkdown = null;
  useToastStore.getState().clearToast();
  useTableInsertStore.getState().clearPending();
});

it.each([
  ["Cmd+Option+Shift+M", "M"],
  ["Cmd+Option+Shift+J", "J"],
] as const)("D320 available Source Math Block applied key %s edits once without toast", (chord, key) => {
  const applied = defaultAppliedShortcuts();
  applied.bindings.paragraphMathBlock = { state: "bound", chord };
  root = document.body.appendChild(document.createElement("div"));
  source = new EditorView({ parent: root, state: EditorState.create({
    doc: "alpha", extensions: [keymap.of(sourceFormatKeymap(true, applied))],
  }) });
  useEditorStore.setState({ viewMode: "source" });
  source.dispatch({ selection: EditorSelection.single(0, 5) });
  let toastCount = 0;
  const unsubscribe = useToastStore.subscribe((state, previous) => {
    if (state.message && state.message !== previous.message) toastCount += 1;
  });
  if (key === "J") {
    expect(press(source.contentDOM, "M", { metaKey: true, altKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    expect(source.state.doc.toString()).toBe("alpha");
  }
  expect(press(source.contentDOM, key, { metaKey: true, altKey: true, shiftKey: true }).defaultPrevented).toBe(true);
  expect(source.state.doc.toString()).toBe("$$\nalpha\n$$");
  expect(toastCount).toBe(0);
  expect(useToastStore.getState().message).toBeNull();
  expect(logs.filter((line) => line.payload.event === "ui.editor.command" &&
    line.payload.context?.command === "paragraph.mathBlock")).toHaveLength(1);
  expect(outcomes()).toHaveLength(0);
  unsubscribe();
});

it.each([
  ["Cmd+Shift+T", "T", { metaKey: true, shiftKey: true }],
  ["Cmd+Option+Y", "Y", { metaKey: true, altKey: true }],
] as const)("D320 available WYSIWYG Table window key %s opens and inserts once without toast", async (chord, key, mods) => {
  const applied = defaultAppliedShortcuts();
  applied.bindings.paragraphTable = { state: "bound", chord };
  milkdown = await mountMilkdownMenuRig("alpha", applied);
  useMilkdownEditorStore.getState().registerEditor(() => milkdown?.editor ?? null);
  useEditorStore.setState({ viewMode: "wysiwyg" });
  const before = milkdown.view.state.doc.toJSON();
  let toastCount = 0;
  let modalCount = 0;
  const unsubscribeToast = useToastStore.subscribe((state, previous) => {
    if (state.message && state.message !== previous.message) toastCount += 1;
  });
  const unsubscribeTable = useTableInsertStore.subscribe((state, previous) => {
    if (state.pendingCallback && state.pendingCallback !== previous.pendingCallback) modalCount += 1;
  });
  const hook = renderHook(() => useKeyboardShortcuts({
    shortcuts: appliedStoredShortcuts(applied),
    onInsertTable: () => triggerTableInsert(),
  }));
  if (key === "Y") {
    act(() => { expect(press(milkdown!.view.dom, "T", { metaKey: true, shiftKey: true }).defaultPrevented).toBe(false); });
    expect(useTableInsertStore.getState().pendingCallback).toBeNull();
  }
  act(() => { expect(press(milkdown!.view.dom, key, mods).defaultPrevented).toBe(true); });
  expect(milkdown.view.state.doc.toJSON()).toEqual(before);
  expect(modalCount).toBe(1);
  expect(logs.filter((line) => line.payload.event === "ui.shortcut.trigger" &&
    line.payload.context?.action === "paragraph.table")).toHaveLength(1);
  expect(toastCount).toBe(0);
  expect(useToastStore.getState().message).toBeNull();
  expect(useTableInsertStore.getState().pendingCallback).not.toBeNull();
  act(() => { useTableInsertStore.getState().pendingCallback!(1, 2); });
  expect(milkdown.view.state.doc.toJSON().content.filter((node: { type: string }) => node.type === "table")).toHaveLength(1);
  hook.unmount();
  unsubscribeToast();
  unsubscribeTable();
});

function outcomes() {
  return logs.filter((line) => line.payload.event === "ui.menu.select");
}

function press(target: HTMLElement, key: string, mods: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { key, ...mods, bubbles: true, cancelable: true });
  Object.defineProperty(event, "keyCode", { value: /^[A-Z]$/.test(key) ? key.charCodeAt(0) : 0 });
  target.dispatchEvent(event);
  return event;
}

it.each([
  ["paragraph.mathBlock", "Source"], ["edit.deleteWord", "Source"],
  ["paragraph.table", "WYSIWYG"], ["format.clearFormat", "WYSIWYG"],
] as const)("D320 menu %s refuses with one mode toast and one cancel", async (id, required) => {
  milkdown = await mountMilkdownMenuRig("alpha");
  useEditorStore.setState({ viewMode: required === "Source" ? "wysiwyg" : "source" });
  const before = milkdown.view.state.doc.toString();
  expect(dispatchEditorMenuAction(`editor.${id}`, captureToken("main"))).toBe(true);
  expect(milkdown.view.state.doc.toString()).toBe(before);
  expect(useToastStore.getState().message).toBe(`Available in ${required} mode only`);
  expect(outcomes()).toHaveLength(1);
  expect(outcomes()[0].payload).toMatchObject({ status: "cancel", context: { reason: "wrong_mode" } });
  expect(outcomes()[0].payload.context?.controlId).toBe(`editor.${id}`);
});

it("D320 WYSIWYG Math Block key refuses visibly without editing", async () => {
  milkdown = await mountMilkdownMenuRig("alpha");
  useEditorStore.setState({ viewMode: "wysiwyg" });
  const before = milkdown.view.state.doc.toString();
  const event = press(milkdown.view.dom, "M", { metaKey: true, altKey: true, shiftKey: true });
  expect(event.defaultPrevented).toBe(true);
  expect(milkdown.view.state.doc.toString()).toBe(before);
  expect(useToastStore.getState().message).toBe("Available in Source mode only");
  expect(outcomes()).toHaveLength(1);
  expect(outcomes()[0].payload).toMatchObject({ status: "cancel", context: { reason: "wrong_mode" } });
});

it("D320 a custom Delete Word key in WYSIWYG refuses once", async () => {
  const base = defaultAppliedShortcuts();
  const applied = { ...base, bindings: {
    ...base.bindings, editDeleteWord: { state: "bound" as const, chord: "Cmd+Shift+D" },
  } };
  milkdown = await mountMilkdownMenuRig("alpha", applied);
  useEditorStore.setState({ viewMode: "wysiwyg" });
  const before = milkdown.view.state.doc.toString();
  expect(press(milkdown.view.dom, "D", { metaKey: true, shiftKey: true }).defaultPrevented).toBe(true);
  expect(milkdown.view.state.doc.toString()).toBe(before);
  expect(useToastStore.getState().message).toBe("Available in Source mode only");
  expect(outcomes()).toHaveLength(1);
  expect(outcomes()[0].payload.context?.controlId).toBe("editor.edit.deleteWord");
});

it("D320 a remapped Math Block key replaces its old binding", async () => {
  const base = defaultAppliedShortcuts();
  const applied = { ...base, bindings: {
    ...base.bindings, paragraphMathBlock: { state: "bound" as const, chord: "Cmd+Option+Shift+J" },
  } };
  milkdown = await mountMilkdownMenuRig("alpha", applied);
  useEditorStore.setState({ viewMode: "wysiwyg" });
  expect(press(milkdown.view.dom, "M", { metaKey: true, altKey: true, shiftKey: true }).defaultPrevented).toBe(false);
  expect(outcomes()).toHaveLength(0);
  expect(press(milkdown.view.dom, "J", { metaKey: true, altKey: true, shiftKey: true }).defaultPrevented).toBe(true);
  expect(milkdown.view.state.doc.textContent).toBe("alpha");
  expect(useToastStore.getState().message).toBe("Available in Source mode only");
  expect(outcomes()).toHaveLength(1);
});

it.each([
  ["T", { metaKey: true, shiftKey: true }, "paragraph.table"],
  ["\\", { metaKey: true }, "format.clearFormat"],
] as const)("D320 Source %s key refuses visibly without editing", (key, mods, id) => {
  root = document.body.appendChild(document.createElement("div"));
  source = new EditorView({ parent: root, state: EditorState.create({
    doc: "alpha", extensions: [keymap.of(sourceFormatKeymap(true))],
  }) });
  useEditorStore.setState({ viewMode: "source" });
  useEditorStore.getState().setEditorView(source);
  const event = press(source.contentDOM, key, mods);
  expect(event.defaultPrevented).toBe(true);
  expect(source.state.doc.toString()).toBe("alpha");
  expect(useToastStore.getState().message).toBe("Available in WYSIWYG mode only");
  expect(useTableInsertStore.getState().pendingCallback).toBeNull();
  expect(outcomes()).toHaveLength(1);
  expect(outcomes()[0].payload).toMatchObject({ status: "cancel", context: { reason: "wrong_mode" } });
  expect(outcomes()[0].payload.context?.controlId).toBe(`editor.${id}`);
});
