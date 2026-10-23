import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const ipc = vi.hoisted(() => vi.fn());
vi.hoisted(() => {
  Object.defineProperty(window.navigator, "platform", { value: "Win32", configurable: true });
});
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(), invoke: ipc,
}));

import { TextSelection } from "@milkdown/kit/prose/state";
import { serializerCtx } from "@milkdown/kit/core";
import { mountScriptedMilkdownRig, type MilkdownRig } from "./helpers/scriptedMilkdownRig";
import { defaultAppliedShortcuts, appliedStoredShortcuts } from "../src/commands/appliedKeymap";
import { useKeyboardShortcuts } from "../src/hooks/useKeyboardShortcuts";
import { mountEditor, teardownEditor } from "./support/mountSourceEditor";
import { renderHook } from "@testing-library/react";
import { milkdownHighlightCommand } from "../src/plugins/milkdown/milkdownHighlightCommand";
import { TableInsertModal } from "../src/components/Editor/TableInsertModal";
import { useTableInsertStore } from "../src/stores/tableInsertStore";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { doc, seedStores } from "./support/editorGenerationDomain";

let rig: MilkdownRig | null = null;
afterEach(async () => { await rig?.destroy(); rig = null; teardownEditor(); useTableInsertStore.getState().clearPending(); useMilkdownEditorStore.getState().unregisterEditor(); ipc.mockReset(); });

it.each(["wysiwyg", "source"] as const)("v2 off-Mac composed %s Image opens once on Ctrl+Shift+I", async (mode) => {
  seedStores();
  useDocumentStore.setState({ documents: [doc("d1", "alpha")], activeDocumentId: "d1" });
  useEditorStore.setState({ viewMode: mode });
  ipc.mockImplementation(async (command: string) => command === "pick_image" ? null : undefined);
  const applied = defaultAppliedShortcuts("linux");
  const hook = renderHook(() => useKeyboardShortcuts({ shortcuts: appliedStoredShortcuts(applied) }));
  let target: HTMLElement;
  if (mode === "wysiwyg") {
    rig = await mountScriptedMilkdownRig("alpha", { heights: [30], appliedShortcuts: applied });
    useMilkdownEditorStore.getState().registerEditor(() => rig?.editor ?? null);
    target = rig.view.dom;
  } else {
    target = mountEditor("alpha", { docId: "d1", appliedShortcuts: applied }).contentDOM;
  }
  // CodeMirror reads the shifted key value that a real keyboard reports.
  target.addEventListener("keydown", (event) => {
    if (event.shiftKey && event.key === "i") Object.defineProperty(event, "key", { value: "I" });
  }, { capture: true });
  const press = (shiftKey: boolean) => act(() => target.dispatchEvent(new KeyboardEvent("keydown", {
    key: "i", code: "KeyI", keyCode: 73, ctrlKey: true, shiftKey, bubbles: true, cancelable: true,
  })));
  // The stored v1 Image sentinel has no physical key. Ctrl+I remains Italic.
  press(false);
  expect(ipc.mock.calls.filter(([command]) => command === "pick_image")).toHaveLength(0);
  press(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(ipc.mock.calls.filter(([command]) => command === "pick_image")).toHaveLength(1);
  hook.unmount();
});

it.each(["wysiwyg", "source"] as const)("v2 off-Mac old Ctrl+Alt+Q no longer Quotes in composed %s", async (mode) => {
  const applied = defaultAppliedShortcuts("linux");
  const hook = renderHook(() => useKeyboardShortcuts({ shortcuts: appliedStoredShortcuts(applied) }));
  let target: HTMLElement;
  let content: () => string;
  if (mode === "wysiwyg") {
    rig = await mountScriptedMilkdownRig("alpha", { heights: [30], appliedShortcuts: applied });
    target = rig.view.dom;
    content = () => rig!.editor.action((ctx) => ctx.get(serializerCtx)(rig!.view.state.doc));
  } else {
    const view = mountEditor("alpha", { appliedShortcuts: applied });
    target = view.contentDOM;
    content = () => view.state.doc.toString();
  }
  const before = content();
  act(() => target.dispatchEvent(new KeyboardEvent("keydown", {
    key: "q", code: "KeyQ", keyCode: 81, ctrlKey: true, altKey: true, bubbles: true, cancelable: true,
  })));
  expect(content()).toBe(before);
  hook.unmount();
});

it.each(["wysiwyg", "source"] as const)("v2 off-Mac old Ctrl+Alt+C no longer inserts Code Fences in composed %s", async (mode) => {
  const applied = defaultAppliedShortcuts("linux");
  const hook = renderHook(() => useKeyboardShortcuts({ shortcuts: appliedStoredShortcuts(applied) }));
  let target: HTMLElement;
  let content: () => string;
  if (mode === "wysiwyg") {
    rig = await mountScriptedMilkdownRig("alpha", { heights: [30], appliedShortcuts: applied });
    rig.view.dispatch(rig.view.state.tr.setSelection(TextSelection.create(rig.view.state.doc, 1, 6)));
    target = rig.view.dom;
    content = () => rig!.editor.action((ctx) => ctx.get(serializerCtx)(rig!.view.state.doc));
  } else {
    const view = mountEditor("alpha", { appliedShortcuts: applied });
    view.dispatch({ selection: { anchor: 0, head: 5 } });
    target = view.contentDOM;
    content = () => view.state.doc.toString();
  }
  act(() => target.dispatchEvent(new KeyboardEvent("keydown", {
    key: "c", code: "KeyC", keyCode: 67, ctrlKey: true, altKey: true, bubbles: true, cancelable: true,
  })));
  expect(content()).toBe(mode === "source" ? "alpha" : "alpha\n");
  hook.unmount();
});

it.each(["wysiwyg", "source"] as const)("v2 off-Mac old Strike Ctrl+Shift+backtick belongs to inline Code in composed %s", async (mode) => {
  const applied = defaultAppliedShortcuts("linux");
  const hook = renderHook(() => useKeyboardShortcuts({ shortcuts: appliedStoredShortcuts(applied) }));
  let target: HTMLElement;
  let content: () => string;
  if (mode === "wysiwyg") {
    rig = await mountScriptedMilkdownRig("alpha", { heights: [30], appliedShortcuts: applied });
    rig.view.dispatch(rig.view.state.tr.setSelection(TextSelection.create(rig.view.state.doc, 1, 6)));
    target = rig.view.dom;
    content = () => rig!.editor.action((ctx) => ctx.get(serializerCtx)(rig!.view.state.doc));
  } else {
    const view = mountEditor("alpha", { appliedShortcuts: applied });
    view.dispatch({ selection: { anchor: 0, head: 5 } });
    target = view.contentDOM;
    content = () => view.state.doc.toString();
  }
  act(() => target.dispatchEvent(new KeyboardEvent("keydown", {
    key: "~", code: "Backquote", keyCode: 192, ctrlKey: true, shiftKey: true,
    bubbles: true, cancelable: true,
  })));
  expect(content()).toBe(mode === "source" ? "`alpha`" : "`alpha`\n");
  hook.unmount();
});

it.each(["wysiwyg", "source"] as const)("v2 off-Mac disabled and system rows never dispatch an app command in composed %s", async (mode) => {
  const applied = defaultAppliedShortcuts("linux");
  const appAction = vi.fn();
  const hook = renderHook(() => useKeyboardShortcuts({
    onOpen: appAction, onSave: appAction, onCycleViewMode: appAction,
    shortcuts: appliedStoredShortcuts(applied),
  }));
  let target: HTMLElement;
  let content: () => string;
  if (mode === "wysiwyg") {
    rig = await mountScriptedMilkdownRig("alpha", { heights: [30], appliedShortcuts: applied });
    target = rig.view.dom;
    content = () => rig!.editor.action((ctx) => ctx.get(serializerCtx)(rig!.view.state.doc));
  } else {
    const view = mountEditor("alpha", { appliedShortcuts: applied });
    target = view.contentDOM;
    content = () => view.state.doc.toString();
  }
  const before = content();
  for (const [key, mods] of [
    ["o", { ctrlKey: true, shiftKey: true }], // Open Quickly: unassigned
    ["d", { ctrlKey: true, shiftKey: true }], // Delete Word: unassigned
    ["ArrowUp", { ctrlKey: true }], ["ArrowDown", { ctrlKey: true }], // OS navigation
    ["Tab", { ctrlKey: true }], // Switch Documents: unavailable
    ["F11", {}], // Fullscreen: unavailable
  ] as const) {
    act(() => target.dispatchEvent(new KeyboardEvent("keydown", {
      key, ...mods, bubbles: true, cancelable: true,
    })));
    expect(content(), key).toBe(before);
    expect(appAction, key).toHaveBeenCalledTimes(0);
  }
  for (const [key, expected] of [["2", "## alpha"], ["4", "#### alpha"]] as const) {
    act(() => target.dispatchEvent(new KeyboardEvent("keydown", {
      key, code: `Digit${key}`, keyCode: key.charCodeAt(0), ctrlKey: true,
      bubbles: true, cancelable: true,
    })));
    expect(content()).toBe(mode === "source" ? expected : `${expected}\n`);
    expect(appAction, key).toHaveBeenCalledTimes(0);
  }
  hook.unmount();
});

it.each([
  ["Quote", "Q", "> alpha\n", false],
  ["Strike", "X", "~~alpha~~\n", true],
  ["Code Fences", "K", "```\nalpha\n```\n", false],
] as const)("v2 off-Mac WYSIWYG %s has one composed Ctrl+Shift owner", async (_name, key, expected, select) => {
  const applied = defaultAppliedShortcuts("linux");
  rig = await mountScriptedMilkdownRig("alpha", { heights: [30], appliedShortcuts: applied });
  const onSave = vi.fn();
  const hook = renderHook(() => useKeyboardShortcuts({ onSave, shortcuts: appliedStoredShortcuts(applied) }));
  if (select) rig.view.dispatch(rig.view.state.tr.setSelection(TextSelection.create(rig.view.state.doc, 1, 6)));
  const dispatch = vi.spyOn(rig.view, "dispatch");
  const event = new KeyboardEvent("keydown", { key, code: `Key${key}`, keyCode: key.charCodeAt(0), ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
  act(() => { rig!.view.dom.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  expect(rig.editor.action((ctx) => ctx.get(serializerCtx)(rig!.view.state.doc))).toBe(expected);
  if (_name === "Quote" || _name === "Code Fences") expect(dispatch).toHaveBeenCalledTimes(1);
  expect(onSave).toHaveBeenCalledTimes(0);
  hook.unmount();
});

it("v2 off-Mac Paragraph uses Ctrl+Shift+0 in W and S; old Ctrl+0 leaves the heading alone", async () => {
  const applied = defaultAppliedShortcuts("linux");
  const hook = renderHook(() => useKeyboardShortcuts({ shortcuts: appliedStoredShortcuts(applied) }));
  const press = (target: HTMLElement, shiftKey: boolean) => act(() => target.dispatchEvent(new KeyboardEvent("keydown", {
    key: shiftKey ? ")" : "0", code: "Digit0", keyCode: 48, ctrlKey: true, shiftKey, bubbles: true, cancelable: true,
  })));
  rig = await mountScriptedMilkdownRig("## alpha", { heights: [30], appliedShortcuts: applied });
  press(rig.view.dom, false);
  expect(rig.editor.action((ctx) => ctx.get(serializerCtx)(rig!.view.state.doc))).toBe("## alpha\n");
  press(rig.view.dom, true);
  expect(rig.editor.action((ctx) => ctx.get(serializerCtx)(rig!.view.state.doc))).toBe("alpha\n");
  await rig.destroy();
  rig = null;
  const source = mountEditor("## alpha", { appliedShortcuts: applied });
  source.dispatch({ selection: { anchor: 4 } });
  press(source.contentDOM, false);
  expect(source.state.doc.toString()).toBe("## alpha");
  press(source.contentDOM, true);
  expect(source.state.doc.toString()).toBe("alpha");
  hook.unmount();
});

it("v2 off-Mac Highlight uses Ctrl+Shift+M once in W and S; old Ctrl+Shift+H is inert", async () => {
  const applied = defaultAppliedShortcuts("linux");
  rig = await mountScriptedMilkdownRig("alpha", { heights: [30], appliedShortcuts: applied });
  rig.view.dispatch(rig.view.state.tr.setSelection(TextSelection.create(rig.view.state.doc, 1, 6)));
  const onHighlight = vi.fn(() => milkdownHighlightCommand(rig!.view));
  const hook = renderHook(() => useKeyboardShortcuts({ onHighlight, shortcuts: appliedStoredShortcuts(applied) }));
  const press = (target: HTMLElement, key: string) => act(() => target.dispatchEvent(new KeyboardEvent("keydown", {
    key, code: `Key${key.toUpperCase()}`, keyCode: key.toUpperCase().charCodeAt(0),
    ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
  })));
  press(rig.view.dom, "h");
  expect(rig.view.state.doc.firstChild?.firstChild?.marks).toHaveLength(0);
  press(rig.view.dom, "m");
  expect(rig.view.state.doc.firstChild?.firstChild?.marks.map((mark) => mark.type.name)).toEqual(["highlight"]);
  expect(onHighlight).toHaveBeenCalledTimes(1);
  await rig.destroy();
  rig = null;
  const source = mountEditor("alpha", { appliedShortcuts: applied });
  source.dispatch({ selection: { anchor: 0, head: 5 } });
  press(source.contentDOM, "h");
  expect(source.state.doc.toString()).toBe("alpha");
  press(source.contentDOM, "m");
  expect(source.state.doc.toString()).toBe('<mark style="background: #FF5582A6;">alpha</mark>');
  expect(onHighlight).toHaveBeenCalledTimes(1);
  hook.unmount();
});

it("v2 off-Mac old Alt+Shift+5 no longer applies Strike in either composed editor", async () => {
  const applied = defaultAppliedShortcuts("linux");
  const hook = renderHook(() => useKeyboardShortcuts({ shortcuts: appliedStoredShortcuts(applied) }));
  const press = (target: HTMLElement) => act(() => target.dispatchEvent(new KeyboardEvent("keydown", {
    key: "5", code: "Digit5", keyCode: 53, altKey: true, shiftKey: true,
    bubbles: true, cancelable: true,
  })));
  rig = await mountScriptedMilkdownRig("alpha", { heights: [30], appliedShortcuts: applied });
  rig.view.dispatch(rig.view.state.tr.setSelection(TextSelection.create(rig.view.state.doc, 1, 6)));
  press(rig.view.dom);
  expect(rig.editor.action((ctx) => ctx.get(serializerCtx)(rig!.view.state.doc))).toBe("alpha\n");
  await rig.destroy();
  rig = null;
  const source = mountEditor("alpha", { appliedShortcuts: applied });
  source.dispatch({ selection: { anchor: 0, head: 5 } });
  press(source.contentDOM);
  expect(source.state.doc.toString()).toBe("alpha");
  hook.unmount();
});

it("v2 off-Mac Table opens its modal on Ctrl+Shift+T in W, while old Ctrl+Alt+T and Source stay inert", async () => {
  const applied = defaultAppliedShortcuts("linux");
  const modal = render(<TableInsertModal appliedShortcuts={applied} />);
  const hook = renderHook(() => useKeyboardShortcuts({
    onInsertTable: () => useTableInsertStore.getState().requestInsert(() => {}),
    shortcuts: appliedStoredShortcuts(applied),
  }));
  const press = (target: HTMLElement, shiftKey: boolean, altKey: boolean) => act(() => target.dispatchEvent(new KeyboardEvent("keydown", {
    key: "t", code: "KeyT", keyCode: 84, ctrlKey: true, shiftKey, altKey,
    bubbles: true, cancelable: true,
  })));
  rig = await mountScriptedMilkdownRig("alpha", { heights: [30], appliedShortcuts: applied });
  press(rig.view.dom, false, true);
  expect(screen.queryByRole("dialog")).toBeNull();
  press(rig.view.dom, true, false);
  expect(screen.getByRole("dialog").textContent).toContain("Insert Table");
  act(() => useTableInsertStore.getState().clearPending());
  await rig.destroy();
  rig = null;
  const source = mountEditor("alpha", { appliedShortcuts: applied });
  press(source.contentDOM, false, true);
  press(source.contentDOM, true, false);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(source.state.doc.toString()).toBe("alpha");
  hook.unmount();
  modal.unmount();
});

it.each([
  ["Increase Heading", "]", "=", "# alpha"],
  ["Decrease Heading", "[", "-", "### alpha"],
] as const)("v2 off-Mac %s uses Ctrl+Alt in W and S; old Ctrl chord leaves the heading", async (_name, key, oldKey, expected) => {
  const applied = defaultAppliedShortcuts("linux");
  const hook = renderHook(() => useKeyboardShortcuts({ shortcuts: appliedStoredShortcuts(applied) }));
  const press = (target: HTMLElement, value: string, altKey: boolean) => act(() => target.dispatchEvent(new KeyboardEvent("keydown", {
    key: value, code: value === "]" ? "BracketRight" : value === "[" ? "BracketLeft" : value === "=" ? "Equal" : "Minus",
    keyCode: value === "]" ? 221 : value === "[" ? 219 : value === "=" ? 187 : 189,
    ctrlKey: true, altKey, bubbles: true, cancelable: true,
  })));
  rig = await mountScriptedMilkdownRig("## alpha", { heights: [30], appliedShortcuts: applied });
  press(rig.view.dom, oldKey, false);
  expect(rig.editor.action((ctx) => ctx.get(serializerCtx)(rig!.view.state.doc))).toBe("## alpha\n");
  press(rig.view.dom, key, true);
  expect(rig.editor.action((ctx) => ctx.get(serializerCtx)(rig!.view.state.doc))).toBe(`${expected}\n`);
  await rig.destroy();
  rig = null;
  const source = mountEditor("## alpha", { appliedShortcuts: applied });
  source.dispatch({ selection: { anchor: 4 } });
  press(source.contentDOM, oldKey, false);
  expect(source.state.doc.toString()).toBe("## alpha");
  press(source.contentDOM, key, true);
  expect(source.state.doc.toString()).toBe(expected);
  hook.unmount();
});

it("v2 off-Mac Math Block uses Ctrl+Alt+Shift+M in Source; old Ctrl+Alt+B and W are inert", async () => {
  const applied = defaultAppliedShortcuts("linux");
  const hook = renderHook(() => useKeyboardShortcuts({ shortcuts: appliedStoredShortcuts(applied) }));
  const press = (target: HTMLElement, key: string, shiftKey: boolean) => act(() => target.dispatchEvent(new KeyboardEvent("keydown", {
    key, code: `Key${key.toUpperCase()}`, keyCode: key.toUpperCase().charCodeAt(0),
    ctrlKey: true, altKey: true, shiftKey, bubbles: true, cancelable: true,
  })));
  rig = await mountScriptedMilkdownRig("alpha", { heights: [30], appliedShortcuts: applied });
  press(rig.view.dom, "b", false);
  press(rig.view.dom, "m", true);
  expect(rig.editor.action((ctx) => ctx.get(serializerCtx)(rig!.view.state.doc))).toBe("alpha\n");
  await rig.destroy();
  rig = null;
  const source = mountEditor("alpha", { appliedShortcuts: applied });
  source.dispatch({ selection: { anchor: 0, head: 5 } });
  press(source.contentDOM, "b", false);
  expect(source.state.doc.toString()).toBe("alpha");
  press(source.contentDOM, "m", true);
  expect(source.state.doc.toString()).toBe("$$\nalpha\n$$");
  hook.unmount();
});

it.each([
  ["Ordered List", "[", "o", "1. alpha\n", "1. alpha"],
  ["Unordered List", "]", "u", "- alpha\n", "- alpha"],
] as const)("v2 off-Mac %s uses Ctrl+Shift in both composed editors, with no old Ctrl+Alt action", async (_name, key, oldKey, wysiwygExpected, sourceExpected) => {
  const applied = defaultAppliedShortcuts("linux");
  const hook = renderHook(() => useKeyboardShortcuts({ shortcuts: appliedStoredShortcuts(applied) }));
  const event = (old: boolean) => new KeyboardEvent("keydown", {
    key: old ? oldKey : key === "[" ? "{" : "}", code: old ? `Key${oldKey.toUpperCase()}` : key === "[" ? "BracketLeft" : "BracketRight",
    keyCode: old ? oldKey.toUpperCase().charCodeAt(0) : key === "[" ? 219 : 221,
    ctrlKey: true, shiftKey: !old, altKey: old, bubbles: true, cancelable: true,
  });
  rig = await mountScriptedMilkdownRig("alpha", { heights: [30], appliedShortcuts: applied });
  act(() => { rig!.view.dom.dispatchEvent(event(true)); });
  expect(rig.editor.action((ctx) => ctx.get(serializerCtx)(rig!.view.state.doc))).toBe("alpha\n");
  act(() => { rig!.view.dom.dispatchEvent(event(false)); });
  expect(rig.editor.action((ctx) => ctx.get(serializerCtx)(rig!.view.state.doc))).toBe(wysiwygExpected);
  await rig.destroy();
  rig = null;
  const view = mountEditor("alpha", { appliedShortcuts: applied });
  view.dispatch({ selection: { anchor: 0, head: 5 } });
  act(() => { view.contentDOM.dispatchEvent(event(true)); });
  expect(view.state.doc.toString()).toBe("alpha");
  act(() => { view.contentDOM.dispatchEvent(event(false)); });
  expect(view.state.doc.toString()).toBe(sourceExpected);
  hook.unmount();
});

it.each([
  ["Strike", "X", "~~alpha~~"],
  ["Code Fences", "K", "```\nalpha\n```"],
  ["Quote", "Q", "> alpha"],
] as const)("v2 off-Mac Source %s acts once with the window listener", (_name, key, expected) => {
  const applied = defaultAppliedShortcuts("linux");
  const view = mountEditor("alpha", { appliedShortcuts: applied });
  view.dispatch({ selection: { anchor: 0, head: 5 } });
  const dispatch = vi.spyOn(view, "dispatch");
  const onSave = vi.fn();
  const hook = renderHook(() => useKeyboardShortcuts({ onSave, shortcuts: appliedStoredShortcuts(applied) }));
  const event = new KeyboardEvent("keydown", { key, code: `Key${key}`, keyCode: key.charCodeAt(0), ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
  act(() => { view.contentDOM.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  expect(view.state.doc.toString()).toBe(expected);
  if (_name === "Quote" || _name === "Code Fences") expect(dispatch).toHaveBeenCalledTimes(1);
  expect(onSave).toHaveBeenCalledTimes(0);
  hook.unmount();
});
