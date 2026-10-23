import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { MilkdownEditor } from "../src/components/Editor/MilkdownEditor";
import { dispatchEditorMenuAction } from "../src/hooks/editorMenuActionTable";
import { getFindState } from "../src/plugins/milkdown/find/findPlugin";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { captureToken } from "../src/utils/menuTargetToken";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";
import { isMacPlatform } from "../src/utils/platformLabels";
import { defaultAppliedShortcuts } from "../src/commands/appliedKeymap";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", async () => ({ ...(await import("./support/tauriCoreMock")).createTauriCoreMock(), invoke: vi.fn(async () => null), convertFileSrc: (path: string) => `asset://${path}` }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));

beforeEach(() => {
  installIntersectionObserverDouble();
  useEditorStore.setState({ viewMode: "wysiwyg" });
  useDocumentStore.setState({ documents: [{ id: "a", path: null, content: "cat cat", encoding: "UTF-8", lineEnding: "lf", isModified: false, lastSaved: null, fileSize: null }], activeDocumentId: "a" });
});
afterEach(() => useDocumentStore.setState({ documents: [], activeDocumentId: null }));

it("routes the four native menu actions to the shipped WYSIWYG find state", async () => {
  vi.mocked(invoke).mockClear();
  const mounted = render(<MilkdownEditor />);
  let editor: Editor | null = null;
  await waitFor(() => { editor = useMilkdownEditorStore.getState().getEditor() as Editor | null; expect(editor).not.toBeNull(); });
  const view = editor!.action((ctx) => ctx.get(editorViewCtx));
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 8)));
  act(() => { expect(dispatchEditorMenuAction("editor.edit.find", captureToken("main"))).toBe(true); });
  expect(getFindState(view.state).open).toBe(true);
  act(() => { dispatchEditorMenuAction("editor.edit.findNext", captureToken("main")); });
  expect(getFindState(view.state).current).toBe(0);
  act(() => { dispatchEditorMenuAction("editor.edit.findPrevious", captureToken("main")); });
  expect(getFindState(view.state).current).toBe(0);
  act(() => { dispatchEditorMenuAction("editor.edit.replace", captureToken("main")); });
  expect(getFindState(view.state).replacing).toBe(true);
  const menuLogs = vi.mocked(invoke).mock.calls
    .filter(([command]) => command === "log_event")
    .map(([, args]) => (args as { payload: { event: string; context: { controlId?: string } } }).payload)
    .filter((payload) => payload.event === "ui.menu.select");
  expect(menuLogs.map((payload) => payload.context.controlId)).toEqual([
    "editor.edit.find", "editor.edit.findNext", "editor.edit.findPrevious", "editor.edit.replace",
  ]);
  mounted.unmount();
});

it("uses applied chords while editor or Find input owns focus", async () => {
  const mounted = render(<MilkdownEditor />);
  let editor: Editor | null = null;
  await waitFor(() => { editor = useMilkdownEditorStore.getState().getEditor() as Editor | null; expect(editor).not.toBeNull(); });
  const view = editor!.action((ctx) => ctx.get(editorViewCtx));
  const primary = isMacPlatform() ? { metaKey: true } : { ctrlKey: true };
  fireEvent.keyDown(view.dom, { key: "f", ...primary });
  const find = await screen.findByRole("textbox", { name: "Find" });
  expect(find).toHaveFocus();
  fireEvent.change(find, { target: { value: "cat" } });
  expect(getFindState(view.state).current).toBe(0);
  fireEvent.keyDown(find, { key: "g", ...primary });
  expect(getFindState(view.state).current).toBe(1);
  fireEvent.keyDown(find, { key: "g", shiftKey: true, ...primary });
  expect(getFindState(view.state).current).toBe(0);
  fireEvent.keyDown(find, { key: "h", ...primary });
  expect(screen.getByRole("textbox", { name: "Replace" })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Replace" }), { key: "Escape" });
  expect(screen.queryByRole("textbox", { name: "Find" })).toBeNull();
  mounted.unmount();
});

it("recognizes a customized shifted digit while the Find input owns focus", async () => {
  const applied = defaultAppliedShortcuts(isMacPlatform() ? "macos" : "linux");
  applied.bindings.editFindNext = { state: "bound", chord: "Cmd+Shift+1" };
  const mounted = render(<MilkdownEditor appliedShortcuts={applied} />);
  let editor: Editor | null = null;
  await waitFor(() => { editor = useMilkdownEditorStore.getState().getEditor() as Editor | null; expect(editor).not.toBeNull(); });
  const view = editor!.action((ctx) => ctx.get(editorViewCtx));
  act(() => { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 4))); dispatchEditorMenuAction("editor.edit.find", captureToken("main")); });
  const find = screen.getByRole("textbox", { name: "Find" });
  fireEvent.keyDown(find, { key: "!", code: "Digit1", shiftKey: true, ...(isMacPlatform() ? { metaKey: true } : { ctrlKey: true }) });
  expect(getFindState(view.state).current).toBe(1);
  mounted.unmount();
});

it("ignores an unassigned next chord and refuses stale or modal menu targets", async () => {
  const applied = defaultAppliedShortcuts(isMacPlatform() ? "macos" : "linux");
  applied.bindings.editFindNext = { state: "unassigned" };
  const mounted = render(<MilkdownEditor appliedShortcuts={applied} />);
  let editor: Editor | null = null;
  await waitFor(() => { editor = useMilkdownEditorStore.getState().getEditor() as Editor | null; expect(editor).not.toBeNull(); });
  const view = editor!.action((ctx) => ctx.get(editorViewCtx));
  act(() => { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 4))); dispatchEditorMenuAction("editor.edit.find", captureToken("main")); });
  const find = screen.getByRole("textbox", { name: "Find" });
  fireEvent.keyDown(find, { key: "g", ...(isMacPlatform() ? { metaKey: true } : { ctrlKey: true }) });
  expect(getFindState(view.state).current).toBe(0);
  const stale = { ...captureToken("main"), generation: -1 };
  act(() => { dispatchEditorMenuAction("editor.edit.replace", stale); });
  expect(getFindState(view.state).replacing).toBe(false);
  const modal = document.body.appendChild(document.createElement("div")); modal.setAttribute("aria-modal", "true");
  act(() => { dispatchEditorMenuAction("editor.edit.replace", captureToken("main")); });
  expect(getFindState(view.state).replacing).toBe(false);
  modal.remove(); mounted.unmount();
});

it("moves two native menu navigation actions through distinct matches", async () => {
  const mounted = render(<MilkdownEditor />);
  let editor: Editor | null = null;
  await waitFor(() => { editor = useMilkdownEditorStore.getState().getEditor() as Editor | null; expect(editor).not.toBeNull(); });
  const view = editor!.action((ctx) => ctx.get(editorViewCtx));
  act(() => { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 4))); dispatchEditorMenuAction("editor.edit.find", captureToken("main")); });
  expect(getFindState(view.state).matches).toHaveLength(2);
  act(() => { dispatchEditorMenuAction("editor.edit.findNext", captureToken("main")); });
  expect(getFindState(view.state).current).toBe(1);
  act(() => { dispatchEditorMenuAction("editor.edit.findPrevious", captureToken("main")); });
  expect(getFindState(view.state).current).toBe(0);
  mounted.unmount();
});
