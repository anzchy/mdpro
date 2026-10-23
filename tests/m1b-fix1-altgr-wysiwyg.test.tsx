import { act, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { MilkdownEditor } from "../src/components/Editor/MilkdownEditor";
import { defaultAppliedShortcuts, appliedStoredShortcuts } from "../src/commands/appliedKeymap";
import { useKeyboardShortcuts } from "../src/hooks/useKeyboardShortcuts";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";

vi.hoisted(() => Object.defineProperty(window.navigator, "platform", { value: "Win32", configurable: true }));
vi.mock("@tauri-apps/api/core", async () => ({ ...(await import("./support/tauriCoreMock")).createTauriCoreMock(), invoke: vi.fn(async () => null), convertFileSrc: (p: string) => `asset://${p}` }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));

beforeEach(() => {
  installIntersectionObserverDouble();
  useEditorStore.setState({ viewMode: "wysiwyg" });
  useDocumentStore.setState({ documents: [{ id: "d1", path: null, content: "alpha", encoding: "UTF-8", lineEnding: "lf", isModified: false, lastSaved: null, fileSize: null }], activeDocumentId: "d1" });
});
afterEach(() => useDocumentStore.setState({ documents: [], activeDocumentId: null }));

it.each([["[", "KeyF"], ["]", "KeyG"]])("printable AltGr %s passes through mounted WYSIWYG and hook", async (key, code) => {
  const applied = defaultAppliedShortcuts("linux");
  const onSave = vi.fn();
  const hook = renderHook(() => useKeyboardShortcuts({ onSave, shortcuts: appliedStoredShortcuts(applied) }));
  const mounted = render(<MilkdownEditor appliedShortcuts={applied} />);
  let editor: Editor | null = null;
  await waitFor(() => { editor = useMilkdownEditorStore.getState().getEditor() as Editor | null; expect(editor).not.toBeNull(); });
  const view = editor!.action((ctx) => ctx.get(editorViewCtx));
  const event = new KeyboardEvent("keydown", { key, code, ctrlKey: true, altKey: true, bubbles: true, cancelable: true });
  act(() => { view.dom.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(false);
  expect(view.state.doc.firstChild?.type.name).toBe("paragraph");
  expect(view.state.doc.textContent).toBe("alpha");
  expect(onSave).toHaveBeenCalledTimes(0);
  mounted.unmount(); hook.unmount();
});

it("genuine Ctrl+Alt heading reaches mounted WYSIWYG", async () => {
  const applied = defaultAppliedShortcuts("linux");
  const hook = renderHook(() => useKeyboardShortcuts({ shortcuts: appliedStoredShortcuts(applied) }));
  const mounted = render(<MilkdownEditor appliedShortcuts={applied} />);
  let editor: Editor | null = null;
  await waitFor(() => { editor = useMilkdownEditorStore.getState().getEditor() as Editor | null; expect(editor).not.toBeNull(); });
  const view = editor!.action((ctx) => ctx.get(editorViewCtx));
  const event = new KeyboardEvent("keydown", { key: "]", code: "BracketRight", keyCode: 221, ctrlKey: true, altKey: true, bubbles: true, cancelable: true });
  act(() => { view.dom.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  expect(view.state.doc.firstChild?.type.name).toBe("heading");
  mounted.unmount(); hook.unmount();
});

it.each([
  ["table", "| a |\n| --- |\n| b |", "paragraph", "table", "[", "KeyF"],
  ["table", "| a |\n| --- |\n| b |", "paragraph", "table", "]", "KeyG"],
  ["code", "```\nx\n```", "code_block", "code_block", "[", "KeyF"],
  ["code", "```\nx\n```", "code_block", "code_block", "]", "KeyG"],
] as const)("printable AltGr reaches text insertion inside %s for %s", async (_name, content, targetType, rootType, key, code) => {
  useDocumentStore.setState((state) => ({ documents: state.documents.map((d) => ({ ...d, content })) }));
  const applied = defaultAppliedShortcuts("linux");
  const hook = renderHook(() => useKeyboardShortcuts({ shortcuts: appliedStoredShortcuts(applied) }));
  const mounted = render(<MilkdownEditor appliedShortcuts={applied} />);
  let editor: Editor | null = null;
  await waitFor(() => { editor = useMilkdownEditorStore.getState().getEditor() as Editor | null; expect(editor).not.toBeNull(); });
  const view = editor!.action((ctx) => ctx.get(editorViewCtx));
  let pos = -1;
  view.state.doc.descendants((node, at) => {
    if (pos < 0 && node.type.name === targetType) pos = at + 1;
  });
  expect(pos).toBeGreaterThan(0);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
  const event = new KeyboardEvent("keydown", { key, code, ctrlKey: true, altKey: true, bubbles: true, cancelable: true });
  act(() => { view.dom.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(false);
  // jsdom has no native contenteditable insertion. Apply the browser's text
  // insertion only when the keydown was allowed through.
  if (!event.defaultPrevented) view.dispatch(view.state.tr.insertText(key));
  expect(view.state.doc.firstChild?.type.name).toBe(rootType);
  expect(view.state.doc.textContent).toContain(key);
  hook.unmount(); mounted.unmount();
});
