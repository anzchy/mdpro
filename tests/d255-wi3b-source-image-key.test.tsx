import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.hoisted(() => {
  Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
});
import { Editor } from "../src/components/Editor/Editor";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { doc, seedStores } from "./support/editorGenerationDomain";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(), invoke,
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));

afterEach(() => {
  cleanup();
  useEditorStore.setState({ editorView: null, viewMode: "wysiwyg" });
  useDocumentStore.setState({ activeDocumentId: null });
  invoke.mockReset();
});

it("AC-7/11 macOS Source Ctrl+Cmd+I opens the picker once from the real keymap", async () => {
  seedStores();
  useDocumentStore.setState({ documents: [doc("d1", "alpha")], activeDocumentId: "d1" });
  useEditorStore.setState({ viewMode: "source" });
  invoke.mockImplementation(async (command: string) => command === "pick_image" ? null : undefined);
  render(<Editor value="alpha" onChange={vi.fn()} />);
  const editor = useEditorStore.getState().editorView!;
  const event = new KeyboardEvent("keydown", {
    key: "i", metaKey: true, ctrlKey: true, bubbles: true, cancelable: true,
  });
  act(() => editor.contentDOM.dispatchEvent(event));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(event.defaultPrevented).toBe(true);
  expect(invoke.mock.calls.filter(([command]) => command === "pick_image")).toHaveLength(1);
  expect(editor.state.doc.toString()).toBe("alpha");
});

it("AC-7/11 read-only Source Image key cannot open the picker or change content", async () => {
  seedStores();
  useDocumentStore.setState({ documents: [doc("d1", "alpha")], activeDocumentId: "d1" });
  useEditorStore.setState({ viewMode: "source" });
  render(<Editor value="alpha" readOnly onChange={vi.fn()} />);
  const editor = useEditorStore.getState().editorView!;
  const event = new KeyboardEvent("keydown", {
    key: "i", metaKey: true, ctrlKey: true, bubbles: true, cancelable: true,
  });
  act(() => editor.contentDOM.dispatchEvent(event));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(invoke.mock.calls.filter(([command]) => command === "pick_image")).toHaveLength(0);
  expect(editor.state.doc.toString()).toBe("alpha");
});
