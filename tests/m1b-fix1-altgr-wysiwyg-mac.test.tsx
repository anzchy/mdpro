import { act, render, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
vi.hoisted(() => Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true }));
vi.mock("@tauri-apps/api/core", async () => ({ ...(await import("./support/tauriCoreMock")).createTauriCoreMock(), invoke: vi.fn(async () => null), convertFileSrc: (p: string) => `asset://${p}` }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));

import { MilkdownEditor } from "../src/components/Editor/MilkdownEditor";
import { defaultAppliedShortcuts, appliedStoredShortcuts } from "../src/commands/appliedKeymap";
import { useKeyboardShortcuts } from "../src/hooks/useKeyboardShortcuts";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";

beforeEach(() => {
  installIntersectionObserverDouble();
  useEditorStore.setState({ viewMode: "wysiwyg" });
  useDocumentStore.setState({ documents: [{ id: "d1", path: null, content: "alpha", encoding: "UTF-8", lineEnding: "lf", isModified: false, lastSaved: null, fileSize: null }], activeDocumentId: "d1" });
});
afterEach(() => useDocumentStore.setState({ documents: [], activeDocumentId: null }));

it("genuine Mac heading shortcut reaches mounted WYSIWYG with the window hook attached", async () => {
  const applied = defaultAppliedShortcuts("macos");
  const hook = renderHook(() => useKeyboardShortcuts({ shortcuts: appliedStoredShortcuts(applied) }));
  const mounted = render(<MilkdownEditor appliedShortcuts={applied} />);
  let editor: Editor | null = null;
  await waitFor(() => { editor = useMilkdownEditorStore.getState().getEditor() as Editor | null; expect(editor).not.toBeNull(); });
  const view = editor!.action((ctx) => ctx.get(editorViewCtx));
  const event = new KeyboardEvent("keydown", { key: "]", code: "BracketRight", keyCode: 221, metaKey: true, altKey: true, bubbles: true, cancelable: true });
  act(() => { view.dom.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  expect(view.state.doc.firstChild?.type.name).toBe("heading");
  mounted.unmount(); hook.unmount();
});
