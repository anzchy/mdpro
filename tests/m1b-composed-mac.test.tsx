import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const ipc = vi.hoisted(() => vi.fn());
vi.hoisted(() => {
  Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
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
import { milkdownHighlightCommand } from "../src/plugins/milkdown/milkdownHighlightCommand";
import { TableInsertModal } from "../src/components/Editor/TableInsertModal";
import { useTableInsertStore } from "../src/stores/tableInsertStore";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { doc, seedStores } from "./support/editorGenerationDomain";

let rig: MilkdownRig | null = null;
afterEach(async () => { await rig?.destroy(); rig = null; teardownEditor(); useTableInsertStore.getState().clearPending(); useMilkdownEditorStore.getState().unregisterEditor(); ipc.mockReset(); });

it.each(["wysiwyg", "source"] as const)("v2 macOS composed %s Image opens once on the new chord and never on the old chord", async (mode) => {
  seedStores();
  useDocumentStore.setState({ documents: [doc("d1", "alpha")], activeDocumentId: "d1" });
  useEditorStore.setState({ viewMode: mode });
  ipc.mockImplementation(async (command: string) => command === "pick_image" ? null : undefined);
  const applied = defaultAppliedShortcuts("macos");
  const hook = renderHook(() => useKeyboardShortcuts({ shortcuts: appliedStoredShortcuts(applied) }));
  let target: HTMLElement;
  let content: () => string;
  if (mode === "wysiwyg") {
    rig = await mountScriptedMilkdownRig("alpha", { heights: [30], appliedShortcuts: applied });
    useMilkdownEditorStore.getState().registerEditor(() => rig?.editor ?? null);
    target = rig.view.dom;
    content = () => rig!.editor.action((ctx) => ctx.get(serializerCtx)(rig!.view.state.doc));
  } else {
    const view = mountEditor("alpha", { docId: "d1", appliedShortcuts: applied });
    target = view.contentDOM;
    content = () => view.state.doc.toString();
  }
  const press = (shiftKey: boolean, ctrlKey: boolean) => act(() => target.dispatchEvent(new KeyboardEvent("keydown", {
    key: "i", code: "KeyI", keyCode: 73, metaKey: true, shiftKey, ctrlKey, bubbles: true, cancelable: true,
  })));
  const before = content();
  press(false, true);
  expect(content()).toBe(before);
  expect(ipc.mock.calls.filter(([command]) => command === "pick_image")).toHaveLength(0);
  press(true, false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(ipc.mock.calls.filter(([command]) => command === "pick_image")).toHaveLength(1);
  expect(content()).toBe(before);
  hook.unmount();
});

const CASES = [
  ["Quote", "B", true, false, "> alpha\n", "> alpha", false],
  ["Strike", "X", true, false, "~~alpha~~\n", "~~alpha~~", true],
  ["Code Fences", "C", false, true, "```\nalpha\n```\n", "```\nalpha\n```", false],
] as const;

it.each(CASES)("v2 macOS WYSIWYG %s acts once with the window listener", async (_name, key, shift, alt, expected, _sourceExpected, select) => {
  const applied = defaultAppliedShortcuts("macos");
  rig = await mountScriptedMilkdownRig("alpha", { heights: [30], appliedShortcuts: applied });
  const onSave = vi.fn();
  const hook = renderHook(() => useKeyboardShortcuts({ onSave, shortcuts: appliedStoredShortcuts(applied) }));
  if (select) rig.view.dispatch(rig.view.state.tr.setSelection(TextSelection.create(rig.view.state.doc, 1, 6)));
  const dispatch = vi.spyOn(rig.view, "dispatch");
  const event = new KeyboardEvent("keydown", { key, code: `Key${key}`, keyCode: key.charCodeAt(0), metaKey: true, shiftKey: shift, altKey: alt, bubbles: true, cancelable: true });
  act(() => { rig!.view.dom.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  expect(rig.editor.action((ctx) => ctx.get(serializerCtx)(rig!.view.state.doc))).toBe(expected);
  if (_name === "Quote" || _name === "Code Fences") expect(dispatch).toHaveBeenCalledTimes(1);
  expect(onSave).toHaveBeenCalledTimes(0);
  hook.unmount();
});

it.each(CASES)("v2 macOS Source %s acts once with the window listener", (_name, key, shift, alt, _wysiwygExpected, expected) => {
  const applied = defaultAppliedShortcuts("macos");
  const view = mountEditor("alpha", { appliedShortcuts: applied });
  view.dispatch({ selection: { anchor: 0, head: 5 } });
  const dispatch = vi.spyOn(view, "dispatch");
  const onSave = vi.fn();
  const hook = renderHook(() => useKeyboardShortcuts({ onSave, shortcuts: appliedStoredShortcuts(applied) }));
  const event = new KeyboardEvent("keydown", { key, code: `Key${key}`, keyCode: key.charCodeAt(0), metaKey: true, shiftKey: shift, altKey: alt, bubbles: true, cancelable: true });
  act(() => { view.contentDOM.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  expect(view.state.doc.toString()).toBe(expected);
  if (_name === "Quote" || _name === "Code Fences") expect(dispatch).toHaveBeenCalledTimes(1);
  expect(onSave).toHaveBeenCalledTimes(0);
  hook.unmount();
});

it.each(["wysiwyg", "source"] as const)("v2 macOS old Option+Cmd+Q does not Quote in composed %s", async (mode) => {
  const applied = defaultAppliedShortcuts("macos");
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
    key: "q", code: "KeyQ", keyCode: 81, metaKey: true, altKey: true, bubbles: true, cancelable: true,
  })));
  expect(content()).toBe(before);
  hook.unmount();
});

it.each(["wysiwyg", "source"] as const)("v2 macOS disabled and system entries leave app commands alone in composed %s", async (mode) => {
  const applied = defaultAppliedShortcuts("macos");
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
    ["o", { metaKey: true, shiftKey: true }], // Open Quickly: unassigned
    ["d", { metaKey: true, shiftKey: true }], // Delete Word: unassigned
    ["ArrowUp", { metaKey: true }], ["ArrowDown", { metaKey: true }], // OS navigation
    ["Tab", { ctrlKey: true }], // Switch Documents: unavailable
    ["f", { metaKey: true, altKey: true }], // Fullscreen: system owned
  ] as const) {
    act(() => target.dispatchEvent(new KeyboardEvent("keydown", {
      key, ...mods, bubbles: true, cancelable: true,
    })));
    expect(content(), key).toBe(before);
    expect(appAction, key).toHaveBeenCalledTimes(0);
  }
  hook.unmount();
});

it.each([
  ["Increase Heading", "]", "=", "# alpha"],
  ["Decrease Heading", "[", "-", "### alpha"],
] as const)("v2 macOS %s uses Option+Cmd in both composed editors while old Cmd chord leaves the heading", async (_name, key, oldKey, expected) => {
  const applied = defaultAppliedShortcuts("macos");
  const hook = renderHook(() => useKeyboardShortcuts({ shortcuts: appliedStoredShortcuts(applied) }));
  const press = (target: HTMLElement, value: string, altKey: boolean) => act(() => target.dispatchEvent(new KeyboardEvent("keydown", {
    key: value, code: value === "]" ? "BracketRight" : value === "[" ? "BracketLeft" : "Equal",
    keyCode: value === "]" ? 221 : value === "[" ? 219 : value === "=" ? 187 : 189,
    metaKey: true, altKey, bubbles: true, cancelable: true,
  })));
  rig = await mountScriptedMilkdownRig("## alpha", { heights: [30], appliedShortcuts: applied });
  press(rig.view.dom, oldKey, false);
  expect(rig.editor.action((ctx) => ctx.get(serializerCtx)(rig!.view.state.doc))).toBe("## alpha\n");
  press(rig.view.dom, key, true);
  expect(rig.editor.action((ctx) => ctx.get(serializerCtx)(rig!.view.state.doc))).toBe(`${expected}\n`);
  await rig.destroy();
  rig = null;
  const view = mountEditor("## alpha", { appliedShortcuts: applied });
  view.dispatch({ selection: { anchor: 4 } });
  press(view.contentDOM, oldKey, false);
  expect(view.state.doc.toString()).toBe("## alpha");
  press(view.contentDOM, key, true);
  expect(view.state.doc.toString()).toBe(expected);
  hook.unmount();
});

it("v2 macOS Highlight leaves old Shift+Cmd+H inert and applies one mark on Shift+Cmd+M in W and S", async () => {
  const applied = defaultAppliedShortcuts("macos");
  rig = await mountScriptedMilkdownRig("alpha", { heights: [30], appliedShortcuts: applied });
  rig.view.dispatch(rig.view.state.tr.setSelection(TextSelection.create(rig.view.state.doc, 1, 6)));
  const onHighlight = vi.fn(() => milkdownHighlightCommand(rig!.view));
  const hook = renderHook(() => useKeyboardShortcuts({ onHighlight, shortcuts: appliedStoredShortcuts(applied) }));
  const press = (target: HTMLElement, key: string) => act(() => target.dispatchEvent(new KeyboardEvent("keydown", {
    key, code: `Key${key.toUpperCase()}`, keyCode: key.toUpperCase().charCodeAt(0),
    metaKey: true, shiftKey: true, bubbles: true, cancelable: true,
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

it("v2 macOS old Ctrl+Shift+backtick no longer applies Strike in either composed editor", async () => {
  const applied = defaultAppliedShortcuts("macos");
  const hook = renderHook(() => useKeyboardShortcuts({ shortcuts: appliedStoredShortcuts(applied) }));
  const press = (target: HTMLElement) => act(() => target.dispatchEvent(new KeyboardEvent("keydown", {
    key: "`", code: "Backquote", keyCode: 192, ctrlKey: true, shiftKey: true,
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

it("v2 macOS Table opens its modal on Shift+Cmd+T in W, while old Option+Cmd+T and Source stay inert", async () => {
  const applied = defaultAppliedShortcuts("macos");
  const modal = render(<TableInsertModal appliedShortcuts={applied} />);
  const hook = renderHook(() => useKeyboardShortcuts({
    onInsertTable: () => useTableInsertStore.getState().requestInsert(() => {}),
    shortcuts: appliedStoredShortcuts(applied),
  }));
  const press = (target: HTMLElement, shiftKey: boolean, altKey: boolean) => act(() => target.dispatchEvent(new KeyboardEvent("keydown", {
    key: "t", code: "KeyT", keyCode: 84, metaKey: true, shiftKey, altKey,
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

it("v2 macOS Paragraph uses physical Shift+Cmd+0 in W and S; old Cmd+0 leaves the heading", async () => {
  const applied = defaultAppliedShortcuts("macos");
  const hook = renderHook(() => useKeyboardShortcuts({ shortcuts: appliedStoredShortcuts(applied) }));
  const press = (target: HTMLElement, shiftKey: boolean) => act(() => target.dispatchEvent(new KeyboardEvent("keydown", {
    key: shiftKey ? ")" : "0", code: "Digit0", keyCode: 48, metaKey: true, shiftKey,
    bubbles: true, cancelable: true,
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

it("v2 macOS Math Block uses Option+Shift+Cmd+M in Source; old Option+Cmd+B and W are inert", async () => {
  const applied = defaultAppliedShortcuts("macos");
  const hook = renderHook(() => useKeyboardShortcuts({ shortcuts: appliedStoredShortcuts(applied) }));
  const press = (target: HTMLElement, key: string, shiftKey: boolean) => act(() => target.dispatchEvent(new KeyboardEvent("keydown", {
    key, code: `Key${key.toUpperCase()}`, keyCode: key.toUpperCase().charCodeAt(0),
    metaKey: true, altKey: true, shiftKey, bubbles: true, cancelable: true,
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
