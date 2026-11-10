import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Callback = (event: { payload: unknown }) => void;
type Registration = {
  name: string;
  callback: Callback;
  resolve: (unlisten: () => void) => void;
  reject: (reason: Error) => void;
  unlisten: ReturnType<typeof vi.fn>;
};

const { registrations, active, logEventSync } = vi.hoisted(() => ({
  registrations: [] as Registration[],
  active: new Map<string, Set<Callback>>(),
  logEventSync: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, callback: Callback) =>
    new Promise<() => void>((resolve, reject) => {
      const unlisten = vi.fn(() => active.get(name)?.delete(callback));
      registrations.push({ name, callback, resolve, reject, unlisten });
    }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main" }),
}));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    generateActionId: vi.fn(() => "gh750-action"),
    logEventSync,
    logEvent: vi.fn(async () => {}),
  },
}));

import { useMcpEvents } from "../src/hooks/useMcpEvents";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { applyMcpTableAction } from "../src/utils/tableMcp";
import type { Document } from "../src/types/document";

const names = [
  "mcp:write_document",
  "mcp:insert_content",
  "mcp:create_document",
  "mcp:table_action",
];

function doc(id: string, content = "BASE"): Document {
  return {
    id, path: null, content, encoding: "UTF-8", lineEnding: "lf",
    isModified: false, lastSaved: null, fileSize: null,
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  });
}

async function resolveAt(index: number): Promise<void> {
  await settle();
  const registration = registrations[index];
  expect(registration?.name).toBe(names[index % names.length]);
  await act(async () => {
    const set = active.get(registration.name) ?? new Set<Callback>();
    set.add(registration.callback);
    active.set(registration.name, set);
    registration.resolve(registration.unlisten);
  });
}

async function resolveNamed(index: number, name: string): Promise<void> {
  await settle();
  const registration = registrations[index];
  expect(registration?.name).toBe(name);
  await act(async () => {
    const set = active.get(name) ?? new Set<Callback>();
    set.add(registration.callback);
    active.set(name, set);
    registration.resolve(registration.unlisten);
  });
}

function emit(name: string, payload: unknown): void {
  act(() => {
    for (const callback of [...(active.get(name) ?? [])]) callback({ payload });
  });
}

beforeEach(() => {
  registrations.length = 0;
  active.clear();
  logEventSync.mockClear();
  useDocumentStore.setState({ documents: [doc("doc-a")], activeDocumentId: "doc-a" });
  useEditorStore.setState({ activeDocumentId: "doc-a", viewMode: "source", editorView: null });
  useMilkdownEditorStore.setState({ getEditor: () => null, flushers: {} });
});

describe("GH750 MCP listener lifecycle", () => {
  it("S1 releases all four late registrations after immediate cleanup", async () => {
    const { unmount } = renderHook(() => useMcpEvents());
    unmount();

    for (let i = 0; i < names.length; i += 1) await resolveAt(i);

    expect(registrations.map((registration) => registration.name)).toEqual(names);
    expect(registrations.map((registration) => registration.unlisten.mock.calls.length)).toEqual([1, 1, 1, 1]);
    for (const name of names) expect(active.get(name)?.size).toBe(0);

    emit("mcp:write_document", {
      document_id: "doc-a", content: "STALE", window_label: "main",
    });
    emit("mcp:create_document", {
      document_id: "doc-created", content: "STALE", window_label: "main",
    });
    expect(useDocumentStore.getState().getDocumentById("doc-a")?.content).toBe("BASE");
    expect(useDocumentStore.getState().getDocumentById("doc-created")).toBeUndefined();
  });

  it("C2 releases registrations settled before and after cleanup exactly once", async () => {
    const { unmount } = renderHook(() => useMcpEvents());
    await resolveAt(0);
    await resolveAt(1);
    expect(active.get(names[0])?.size).toBe(1);
    expect(active.get(names[1])?.size).toBe(1);

    unmount();
    await resolveAt(2);
    await resolveAt(3);

    expect(registrations.map((registration) => registration.unlisten.mock.calls.length)).toEqual([1, 1, 1, 1]);
    for (const name of names) expect(active.get(name)?.size).toBe(0);
    emit("mcp:write_document", {
      document_id: "doc-a", content: "STALE", window_label: "main",
    });
    expect(useDocumentStore.getState().getDocumentById("doc-a")?.content).toBe("BASE");
  });

  it("C3/C7/C10 applies mounted events and releases each listener once on normal cleanup", async () => {
    useDocumentStore.setState({
      documents: [doc("doc-a", "| a | b |\n|---|---|\n| 1 | 2 |\n")],
      activeDocumentId: "doc-a",
    });
    const { unmount } = renderHook(() => useMcpEvents());
    for (let i = 0; i < names.length; i += 1) await resolveAt(i);

    const replacement = "| a | b |\n|---|---|\n| 3 | 4 |\n";
    emit("mcp:write_document", {
      document_id: "doc-a", content: replacement, window_label: "main",
    });
    expect(useDocumentStore.getState().getDocumentById("doc-a")?.content).toBe(replacement);
    const beforeInsert = useDocumentStore.getState().getDocumentById("doc-a")!.content;
    emit("mcp:insert_content", {
      document_id: "doc-a", text: "X", position: "end", window_label: "main",
    });
    expect(useDocumentStore.getState().getDocumentById("doc-a")?.content).toBe(beforeInsert + "X");
    const beforeTable = useDocumentStore.getState().getDocumentById("doc-a")!.content;
    const tablePayload = { rows: 2, cols: 2 };
    const once = applyMcpTableAction(beforeTable, "insert_table", tablePayload);
    expect(once).not.toBeNull();
    emit("mcp:table_action", {
      document_id: "doc-a", action: "insert_table",
      payload: tablePayload,
      window_label: "main",
    });
    expect(useDocumentStore.getState().getDocumentById("doc-a")?.content).toBe(once);
    emit("mcp:create_document", {
      document_id: "doc-created", content: "NEW", window_label: "main",
    });
    expect(useDocumentStore.getState().getDocumentById("doc-created")?.content).toBe("NEW");
    expect(useDocumentStore.getState().activeDocumentId).toBe("doc-created");
    expect(useEditorStore.getState().activeDocumentId).toBe("doc-created");

    const editorDispatch = vi.fn();
    useEditorStore.setState({
      editorView: {
        state: { doc: { length: 3 }, update: vi.fn() },
        dispatch: editorDispatch,
      } as unknown as ReturnType<typeof useEditorStore.getState>["editorView"],
    });
    const before = useDocumentStore.getState().documents.map((document) => document.content);
    const activeBefore = useEditorStore.getState().activeDocumentId;
    unmount();
    expect(registrations.map((registration) => registration.unlisten.mock.calls.length)).toEqual([1, 1, 1, 1]);
    for (const name of names) expect(active.get(name)?.size).toBe(0);
    emit("mcp:create_document", {
      document_id: "too-late", content: "STALE", window_label: "main",
    });
    emit("mcp:table_action", {
      document_id: "doc-created", action: "insert_table",
      payload: { rows: 2, cols: 2 },
      window_label: "main",
    });
    expect(useDocumentStore.getState().documents.map((document) => document.content)).toEqual(before);
    expect(useDocumentStore.getState().getDocumentById("too-late")).toBeUndefined();
    expect(useEditorStore.getState().activeDocumentId).toBe(activeBefore);
    expect(editorDispatch).not.toHaveBeenCalled();
  });

  it("C5 keeps the newer mount live while the old mount settles late", async () => {
    const oldMount = renderHook(() => useMcpEvents());
    oldMount.unmount();
    const newMount = renderHook(() => useMcpEvents());
    for (let i = 0; i < names.length; i += 1) await resolveNamed(i + 1, names[i]);
    for (let i = 0; i < names.length; i += 1) await resolveNamed(i === 0 ? 0 : i + 4, names[i]);

    expect(registrations).toHaveLength(8);
    for (const name of names) expect(active.get(name)?.size).toBe(1);
    emit("mcp:write_document", {
      document_id: "doc-a", content: "FRESH", window_label: "main",
    });
    expect(useDocumentStore.getState().getDocumentById("doc-a")?.content).toBe("FRESH");
    newMount.unmount();
    expect(registrations.map((registration) => registration.unlisten.mock.calls.length)).toEqual(
      [1, 1, 1, 1, 1, 1, 1, 1],
    );
    emit("mcp:write_document", {
      document_id: "doc-a", content: "STALE", window_label: "main",
    });
    expect(useDocumentStore.getState().getDocumentById("doc-a")?.content).toBe("FRESH");
  });

  it("S2 logs a rejected registration and releases earlier subscriptions", async () => {
    const { unmount } = renderHook(() => useMcpEvents());
    await resolveAt(0);
    await settle();
    expect(registrations[1].name).toBe(names[1]);
    await act(async () => {
      registrations[1].reject(new Error("listener unavailable"));
      await Promise.resolve();
    });
    unmount();

    expect(registrations).toHaveLength(2); // sequential setup stops at rejection
    expect(registrations[0].unlisten).toHaveBeenCalledTimes(1);
    expect(active.get(names[0])?.size).toBe(0);
    expect(logEventSync).toHaveBeenCalledWith(expect.objectContaining({
      event: "mcp.listen", status: "fail",
    }));
    emit("mcp:write_document", {
      document_id: "doc-a", content: "STALE", window_label: "main",
    });
    expect(useDocumentStore.getState().getDocumentById("doc-a")?.content).toBe("BASE");
  });

  it.each([
    [0, false], [1, false], [2, false], [3, false],
    [0, true], [1, true], [2, true], [3, true],
  ])("C9 characterizes rejection at position %i, after cleanup=%s", async (position, afterCleanup) => {
    const { unmount } = renderHook(() => useMcpEvents());
    for (let i = 0; i < position; i += 1) await resolveAt(i);
    await settle();
    expect(registrations[position]?.name).toBe(names[position]);
    if (afterCleanup) unmount();
    await act(async () => {
      registrations[position].reject(new Error("listener unavailable"));
      await Promise.resolve();
    });
    if (!afterCleanup) unmount();
    await settle();

    expect(registrations).toHaveLength(position + 1);
    for (let i = 0; i < position; i += 1) {
      expect(registrations[i].unlisten).toHaveBeenCalledTimes(1);
      expect(active.get(names[i])?.size).toBe(0);
    }
    expect(logEventSync.mock.calls.filter(([line]) => line.event === "mcp.listen" && line.status === "fail")).toHaveLength(1);
    emit("mcp:write_document", {
      document_id: "doc-a", content: "STALE", window_label: "main",
    });
    expect(useDocumentStore.getState().getDocumentById("doc-a")?.content).toBe("BASE");
  });

  it("C6 leaves a still-mounted editor buffer unchanged after this hook cleans up", async () => {
    const dispatch = vi.fn();
    useEditorStore.setState({
      editorView: {
        state: { doc: { length: 4 }, update: vi.fn() },
        dispatch,
      } as unknown as ReturnType<typeof useEditorStore.getState>["editorView"],
    });
    const { unmount } = renderHook(() => useMcpEvents());
    unmount();
    await resolveAt(0);
    emit("mcp:write_document", {
      document_id: "doc-a", content: "STALE", window_label: "main",
    });
    expect(useDocumentStore.getState().getDocumentById("doc-a")?.content).toBe("BASE");
    expect(dispatch).not.toHaveBeenCalled();
    for (let i = 1; i < names.length; i += 1) await resolveAt(i);
  });
});
