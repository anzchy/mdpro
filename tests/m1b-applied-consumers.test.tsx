import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { Editor } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { MilkdownEditor } from "../src/components/Editor/MilkdownEditor";
import { defaultAppliedShortcuts } from "../src/commands/appliedKeymap";
import { useDocumentStore } from "../src/stores/documentStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useEditorStore } from "../src/stores/editorStore";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async () => null),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));

beforeEach(() => {
  installIntersectionObserverDouble();
  useMilkdownEditorStore.setState({ getEditor: () => null, flushers: {} });
  useEditorStore.setState({ viewMode: "wysiwyg" });
  useDocumentStore.setState({
    documents: [{ id: "doc-a", path: null, content: "alpha", encoding: "UTF-8", lineEnding: "lf", isModified: false, lastSaved: null, fileSize: null }],
    activeDocumentId: "doc-a",
  });
});
afterEach(() => useDocumentStore.setState({ documents: [], activeDocumentId: null }));

it("waits for the applied snapshot before mounting WYSIWYG, then keeps selection on rerender", async () => {
  const applied = defaultAppliedShortcuts("macos");
  const r = render(<MilkdownEditor appliedShortcuts={null} />);
  expect(screen.getByRole("status", { name: "Loading keyboard shortcuts" })).toBeVisible();
  expect(document.querySelector(".ProseMirror")).toBeNull();
  r.rerender(<MilkdownEditor appliedShortcuts={applied} />);
  let editor: Editor | null = null;
  await waitFor(() => {
    editor = useMilkdownEditorStore.getState().getEditor() as Editor | null;
    expect(editor).not.toBeNull();
  }, { timeout: 5000 });
  const view = editor!.action((ctx) => ctx.get(editorViewCtx));
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
  r.rerender(<MilkdownEditor appliedShortcuts={applied} />);
  expect(useMilkdownEditorStore.getState().getEditor()).toBe(editor);
  expect(view.state.selection.from).toBe(2);
  expect(view.state.doc.textContent).toBe("alpha");
  r.unmount();
});
