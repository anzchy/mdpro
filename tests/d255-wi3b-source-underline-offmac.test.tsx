import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(window.navigator, "platform", { value: "Win32", configurable: true });
});
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock());

import { EditorSelection } from "@codemirror/state";
import { Editor } from "../src/components/Editor/Editor";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";

afterEach(() => {
  cleanup();
  useEditorStore.setState({ editorView: null, viewMode: "wysiwyg" });
  useDocumentStore.setState({ activeDocumentId: null });
});

it("AC-6 composed off-Mac Ctrl+U runs Source underline once", () => {
  useDocumentStore.setState({ activeDocumentId: "d1" });
  useEditorStore.setState({ viewMode: "source", editorView: null });
  render(<Editor value="alpha" onChange={vi.fn()} />);
  const editor = useEditorStore.getState().editorView!;
  editor.dispatch({ selection: EditorSelection.single(0, 5) });
  const event = new KeyboardEvent("keydown", { key: "u", ctrlKey: true, bubbles: true, cancelable: true });
  act(() => { editor.contentDOM.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  expect(editor.state.doc.toString()).toBe("<u>alpha</u>");
});
