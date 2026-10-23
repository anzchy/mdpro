import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { MilkdownEditor } from "../src/components/Editor/MilkdownEditor";
import { openFind, getFindState, replaceFind, setFindQuery } from "../src/plugins/milkdown/find/findPlugin";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";

vi.mock("@tauri-apps/api/core", async () => ({ ...(await import("./support/tauriCoreMock")).createTauriCoreMock(), invoke: vi.fn(async () => null), convertFileSrc: (path: string) => `asset://${path}` }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));

const documentRecord = (id: string, content: string) => ({ id, path: null, content, encoding: "UTF-8" as const, lineEnding: "lf" as const, isModified: false, lastSaved: null, fileSize: null });

beforeEach(() => {
  installIntersectionObserverDouble();
  useEditorStore.setState({ viewMode: "wysiwyg" });
  useDocumentStore.setState({ documents: [documentRecord("a", "cat cat"), documentRecord("b", "dog")], activeDocumentId: "a" });
});
afterEach(() => useDocumentStore.setState({ documents: [], activeDocumentId: null }));

it("mounts a focused find bar and decorations in the shipped host, then clears them on switch", async () => {
  const mounted = render(<MilkdownEditor />);
  let editor: Editor | null = null;
  await waitFor(() => { editor = useMilkdownEditorStore.getState().getEditor() as Editor | null; expect(editor).not.toBeNull(); });
  const view = editor!.action((ctx) => ctx.get(editorViewCtx));
  act(() => { openFind(view, false); setFindQuery(view, "cat"); });
  expect(await screen.findByRole("textbox", { name: "Find" })).toHaveFocus();
  expect(getFindState(view.state).open).toBe(true);
  expect(document.querySelectorAll(".mdpro-find-match")).toHaveLength(2);
  act(() => useDocumentStore.getState().setActiveDocument("b"));
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "Find" })).toBeNull());
  expect(document.querySelectorAll(".mdpro-find-match")).toHaveLength(0);
  mounted.unmount();
});

it("closes the bar and invalidates the old view on a same-document reload", async () => {
  const mounted = render(<MilkdownEditor />);
  let editor: Editor | null = null;
  await waitFor(() => { editor = useMilkdownEditorStore.getState().getEditor() as Editor | null; expect(editor).not.toBeNull(); });
  const old = editor!.action((ctx) => ctx.get(editorViewCtx));
  act(() => { openFind(old, false); setFindQuery(old, "cat"); });
  expect(document.querySelectorAll(".mdpro-find-match")).toHaveLength(2);
  act(() => {
    useDocumentStore.setState((state) => ({ documents: state.documents.map((entry) => entry.id === "a" ? { ...entry, content: "new text" } : entry) }));
    useMilkdownEditorStore.getState().reloadEditor("a", "test");
  });
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "Find" })).toBeNull());
  expect(document.querySelectorAll(".mdpro-find-match")).toHaveLength(0);
  expect(old.isDestroyed).toBe(true);
  mounted.unmount();
});

it("clears find on a Source switch and refuses an old-view replacement", async () => {
  const mounted = render(<MilkdownEditor />);
  let editor: Editor | null = null;
  await waitFor(() => { editor = useMilkdownEditorStore.getState().getEditor() as Editor | null; expect(editor).not.toBeNull(); });
  const old = editor!.action((ctx) => ctx.get(editorViewCtx));
  act(() => { openFind(old, false); setFindQuery(old, "cat"); });
  expect(document.querySelectorAll(".mdpro-find-match")).toHaveLength(2);
  act(() => { useEditorStore.setState({ viewMode: "source" }); mounted.unmount(); });
  await waitFor(() => expect(old.isDestroyed).toBe(true));
  expect(document.querySelectorAll(".mdpro-find-match")).toHaveLength(0);
  expect(replaceFind(old, "dog", true)).toBe(false);
  expect(useDocumentStore.getState().documents[0].content).toBe("cat cat");
});

it("runs find controls and Replace All through the mounted bar", async () => {
  useDocumentStore.setState((state) => ({ documents: state.documents.map((entry) => entry.id === "a" ? { ...entry, content: "Cat cat scatter" } : entry) }));
  const mounted = render(<MilkdownEditor />);
  let editor: Editor | null = null;
  await waitFor(() => { editor = useMilkdownEditorStore.getState().getEditor() as Editor | null; expect(editor).not.toBeNull(); });
  const view = editor!.action((ctx) => ctx.get(editorViewCtx));
  act(() => { openFind(view, false); setFindQuery(view, "cat"); });
  const find = screen.getByRole("textbox", { name: "Find" });
  expect(screen.getByText("1 of 3")).toBeVisible();
  fireEvent.keyDown(find, { key: "Enter" });
  expect(screen.getByText("2 of 3")).toBeVisible();
  fireEvent.keyDown(find, { key: "Enter", shiftKey: true });
  expect(screen.getByText("1 of 3")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Next match" }));
  expect(screen.getByText("2 of 3")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Aa" }));
  expect(screen.getByText("2 of 2")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Whole word" }));
  expect(screen.getByText("1 of 1")).toBeVisible();
  act(() => openFind(view, true));
  fireEvent.change(screen.getByRole("textbox", { name: "Replace" }), { target: { value: "dog" } });
  fireEvent.click(screen.getByRole("button", { name: "Replace All" }));
  expect(view.state.doc.textContent).toBe("Cat dog scatter");
  mounted.unmount();
});

it("prefills from selection, replaces the current match, and closes on Escape", async () => {
  const mounted = render(<MilkdownEditor />);
  let editor: Editor | null = null;
  await waitFor(() => { editor = useMilkdownEditorStore.getState().getEditor() as Editor | null; expect(editor).not.toBeNull(); });
  const view = editor!.action((ctx) => ctx.get(editorViewCtx));
  act(() => {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 4)));
    openFind(view, true);
  });
  expect(screen.getByRole("textbox", { name: "Replace" })).toHaveFocus();
  expect(screen.getByRole("textbox", { name: "Find" })).toHaveValue("cat");
  expect(screen.getByText("1 of 2")).toBeVisible();
  act(() => { view.focus(); openFind(view, true); });
  expect(screen.getByRole("textbox", { name: "Replace" })).toHaveFocus();
  fireEvent.change(screen.getByRole("textbox", { name: "Replace" }), { target: { value: "dog" } });
  fireEvent.click(screen.getByRole("button", { name: /^Replace$/ }));
  expect(view.state.doc.textContent).toBe("dog cat");
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Find" }), { key: "Escape" });
  expect(screen.queryByRole("textbox", { name: "Find" })).toBeNull();
  expect(document.activeElement).toBe(view.dom);
  mounted.unmount();
});
