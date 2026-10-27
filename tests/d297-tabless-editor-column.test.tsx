import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { logs, openControl, windowListeners } = vi.hoisted(() => ({
  logs: [] as Array<Record<string, unknown>>,
  openControl: { pending: null as Promise<unknown> | null, calls: 0 },
  windowListeners: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async (command: string, args: Record<string, unknown> = {}) => {
    if (command === "log_event") {
      logs.push(args.payload as Record<string, unknown>);
      return null;
    }
    if (command === "get_logging_settings") return { enabled: true, level: "info" };
    if (command === "open_file") {
      openControl.calls += 1;
      return openControl.pending;
    }
    if (command === "list_drafts" || command === "get_launch_paths") return [];
    throw new Error(`unavailable: ${command}`);
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
  emit: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: "main",
    setTitle: async () => {},
    onCloseRequested: async () => () => {},
    listen: async (name: string, listener: (event: { payload: unknown }) => void) => {
      windowListeners.set(name, listener);
      return () => windowListeners.delete(name);
    },
  }),
}));
import App from "../src/App";
import { SplitView } from "../src/components/Editor/SplitView";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import { makeDoc, typeAtEnd } from "./helpers/milkdownEditorHarness";
import type { Editor as MilkdownInstance } from "@milkdown/kit/core";

const workspaceOf = (container: HTMLElement) => {
  const workspace = container.querySelector(".workspace");
  expect(workspace).not.toBeNull();
  return workspace as HTMLElement;
};

const editorOf = (workspace: HTMLElement) => within(workspace).queryByRole("textbox");

beforeEach(() => {
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("d297-test-action" as `${string}-${string}-${string}-${string}-${string}`);
  document.elementFromPoint = () => null;
  const range = Range.prototype as unknown as Record<string, unknown>;
  range.getClientRects = () => [];
  range.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
  logs.length = 0;
  openControl.pending = null;
  openControl.calls = 0;
  windowListeners.clear();
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
  useEditorStore.setState({ viewMode: "wysiwyg", editorView: null });
  useMilkdownEditorStore.setState({ getEditor: () => null, flushers: {} });
  useLoggingStore.setState({ enabled: true, level: "info" });
});

afterEach(() => vi.restoreAllMocks());

describe("D297 tabless editor column", () => {
  it("has no WYSIWYG editor or focusable text input with no active document", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
    const workspace = workspaceOf(container);
    expect(editorOf(workspace)).toBeNull();
    expect(workspace.querySelector('[contenteditable="true"]')).toBeNull();
    expect(useMilkdownEditorStore.getState().getEditor()).toBeNull();
    await user.keyboard("y");
    expect(useDocumentStore.getState().documents).toEqual([]);
    expect(workspace.contains(document.activeElement)).toBe(false);
  });

  it("leaves Source tabless typing unable to create or dirty a document", async () => {
    const user = userEvent.setup();
    useEditorStore.setState({ viewMode: "source" });
    const { container } = render(<App />);
    const workspace = workspaceOf(container);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
    await user.click(workspace);
    await user.keyboard("中文y");
    expect(editorOf(workspace)).toBeNull();
    expect(workspace.querySelector('[contenteditable="true"]')).toBeNull();
    expect(useDocumentStore.getState().documents).toEqual([]);
    expect(useDocumentStore.getState().activeDocumentId).toBeNull();
    expect(workspace.contains(document.activeElement)).toBe(false);
  });

  it("current Source readOnly wiring preserves the empty document store", async () => {
    const user = userEvent.setup();
    useEditorStore.setState({ viewMode: "source" });
    const { container } = render(<SplitView markdown="" onChange={() => {}} readOnly />);
    const source = container.querySelector('[role="textbox"]');
    await waitFor(() => expect(source).toHaveAttribute("contenteditable", "false"));
    await act(async () => (source as HTMLElement).focus());
    await user.keyboard("中文y");
    expect(useDocumentStore.getState().documents).toEqual([]);
    expect(useDocumentStore.getState().activeDocumentId).toBeNull();
  });

  it("creates a document from the tabless window and mounts an editable WYSIWYG editor", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const workspace = workspaceOf(container);
    await user.click(screen.getByRole("button", { name: "New document" }));
    await waitFor(() => expect(editorOf(workspace)).toHaveAttribute("contenteditable", "true"));
    const activeId = useDocumentStore.getState().activeDocumentId;
    expect(activeId).not.toBeNull();
    await act(async () => editorOf(workspace)!.focus());
    await act(async () => typeAtEnd(useMilkdownEditorStore.getState().getEditor() as MilkdownInstance, "y"));
    await waitFor(() => expect(useDocumentStore.getState().getActiveDocument()?.content).toContain("y"));
    expect(useDocumentStore.getState().getActiveDocument()?.isModified).toBe(true);
    expect(workspace.contains(document.activeElement)).toBe(true);
  });

  it("opens a file into a tabless Source window and lets the active document be edited", async () => {
    const user = userEvent.setup();
    useEditorStore.setState({ viewMode: "source" });
    const { container } = render(<App />);
    const workspace = workspaceOf(container);
    const opened = makeDoc("opened", "中文", "/tmp/opened.md");
    await act(async () => {
      useDocumentStore.getState().upsertDocument(opened);
      useDocumentStore.getState().setActiveDocumentId(opened.id);
      useEditorStore.getState().setActiveDocumentId(opened.id);
    });
    await waitFor(() => expect(editorOf(workspace)).toHaveAttribute("contenteditable", "true"));
    await act(async () => editorOf(workspace)!.focus());
    await user.keyboard("z");
    await waitFor(() => expect(useDocumentStore.getState().getActiveDocument()?.content).toContain("z"));
    expect(useDocumentStore.getState().getActiveDocument()?.isModified).toBe(true);
    expect(workspace.contains(document.activeElement)).toBe(true);
  });

  it("keeps the tabless column inert while a routed file open awaits its reply", async () => {
    const user = userEvent.setup();
    const opened = makeDoc("pending", "from disk", "/tmp/pending.md");
    let resolveOpen!: (value: unknown) => void;
    openControl.pending = new Promise((resolve) => { resolveOpen = resolve; });
    const { container } = render(<App />);
    const workspace = workspaceOf(container);
    await waitFor(() => expect(windowListeners.has("file:open")).toBe(true));
    await act(async () => windowListeners.get("file:open")!({ payload: [opened.path] }));
    await waitFor(() => expect(openControl.calls).toBe(1));
    await user.keyboard("y");
    expect(editorOf(workspace)).toBeNull();
    expect(useDocumentStore.getState().documents).toEqual([]);
    expect(useDocumentStore.getState().activeDocumentId).toBeNull();
    await act(async () => resolveOpen({ document: opened, recoveredDraft: null, changedSinceRead: false }));
    await waitFor(() => expect(useDocumentStore.getState().activeDocumentId).toBe(opened.id));
    await waitFor(() => expect(editorOf(workspace)).toHaveAttribute("contenteditable", "true"));
    expect(useDocumentStore.getState().getActiveDocument()?.content).toBe("from disk");
  });

  it("unmounts the editor after the main window's last tab closes", async () => {
    const doc = makeDoc("last", "before");
    useDocumentStore.setState({ documents: [doc], activeDocumentId: doc.id });
    const { container } = render(<App />);
    const workspace = workspaceOf(container);
    await waitFor(() => expect(editorOf(workspace)).toHaveAttribute("contenteditable", "true"));
    await act(async () => editorOf(workspace)!.focus());
    await act(async () => useDocumentStore.getState().closeDocument(doc.id));
    await waitFor(() => expect(editorOf(workspace)).toBeNull());
    expect(useDocumentStore.getState().documents).toEqual([]);
    expect(useDocumentStore.getState().activeDocumentId).toBeNull();
    expect(workspace.contains(document.activeElement)).toBe(false);
  });

  it("keeps both view modes empty across mode changes and stale active IDs", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const workspace = workspaceOf(container);
    const doc = makeDoc("present", "kept");
    for (const mode of ["source", "wysiwyg", "source"] as const) {
      await act(async () => useEditorStore.setState({ viewMode: mode }));
      await user.keyboard("x");
      expect(editorOf(workspace)).toBeNull();
      expect(workspace.contains(document.activeElement)).toBe(false);
      expect(useDocumentStore.getState().documents).toEqual([]);
      expect(useDocumentStore.getState().activeDocumentId).toBeNull();
    }
    await act(async () => useDocumentStore.setState({ documents: [doc], activeDocumentId: "missing" }));
    await user.keyboard("x");
    expect(editorOf(workspace)).toBeNull();
    expect(useDocumentStore.getState().documents).toEqual([doc]);
  });

  it("logs once per resolved no-document transition, including unresolved ID changes", async () => {
    const doc = makeDoc("A", "kept");
    useDocumentStore.setState({ documents: [doc], activeDocumentId: null });
    const { rerender } = render(<App />);
    const noDocumentEvents = () => logs.filter((entry) => entry.event === "ui.editor.no_document");
    await waitFor(() => expect(noDocumentEvents()).toHaveLength(1));
    for (const id of ["unknown-1", "unknown-2", null]) {
      await act(async () => useDocumentStore.setState({ activeDocumentId: id }));
      rerender(<App />);
      expect(noDocumentEvents()).toHaveLength(1);
    }
    await act(async () => useEditorStore.setState({ viewMode: "source" }));
    rerender(<App />);
    expect(noDocumentEvents()).toHaveLength(1);
    await act(async () => useDocumentStore.setState({ activeDocumentId: doc.id }));
    expect(noDocumentEvents()).toHaveLength(1);
    for (const id of ["unknown-3", "unknown-4"]) {
      await act(async () => useDocumentStore.setState({ activeDocumentId: id }));
      rerender(<App />);
      expect(noDocumentEvents()).toHaveLength(2);
    }
    for (const entry of noDocumentEvents()) {
      expect(entry).toMatchObject({
        event: "ui.editor.no_document",
        status: "success",
        actionId: "d297-test-action",
        context: { state: "no_document" },
      });
      expect(Object.keys(entry.context as Record<string, unknown>)).toEqual(["state"]);
    }
  });
});
