/**
 * D92 — the callers of a tab switch, with a failing flush registered at the
 * `registerFlusher` seam (the real-serializer failure is pinned by
 * `tests/d92-failed-flush-blocks-switch.test.tsx`).
 *
 * Law: when the flush fails, no caller moves the active document — and whatever
 * happens, `documentStore.activeDocumentId` and `editorStore.activeDocumentId` never
 * disagree after the call. A clean flush still switches (controls). Closing a tab is a
 * deliberate discard handled by the close prompt, so it is never blocked.
 *
 * Mock boundary: `@tauri-apps/api/{core,event,window,webviewWindow}` and the
 * `loggingService` sink. Every store, hook and guard is real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

type Cb = (event: { payload: unknown }) => void;

const { listeners, invokeMock, sink } = vi.hoisted(() => ({
  listeners: new Map<string, Set<(event: { payload: unknown }) => void>>(),
  invokeMock: vi.fn(),
  sink: {
    generateActionId: vi.fn(() => "test-id"),
    logEvent: vi.fn(async () => {}),
    logEventSync: vi.fn(),
    logUiEvent: vi.fn(() => "test-id"),
    logDialogAction: vi.fn(),
  },
}));

function register(name: string, cb: Cb): Promise<() => void> {
  const set = listeners.get(name) ?? new Set<Cb>();
  set.add(cb);
  listeners.set(name, set);
  return Promise.resolve(() => set.delete(cb));
}

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main", listen: register }),
}));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, cb: Cb) => register(name, cb),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("../src/services/loggingService", () => ({ loggingService: sink }));

import { useDocument } from "../src/hooks/useDocument";
import { useMcpEvents } from "../src/hooks/useMcpEvents";
import { useOpenInWindow } from "../src/hooks/useOpenInWindow";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useToastStore } from "../src/stores/toastStore";
import type { Document } from "../src/types/document";
import { commitOpenedDocument } from "../src/utils/openWriteGuard";

const TAB_TOAST = "Editor changes could not be captured; stayed on this document";
const VIEW_TOAST = "Editor changes could not be captured; stayed in WYSIWYG";

function doc(id: string, path: string | null, isModified = false, content = `c-${id}`): Document {
  return { id, path, content, encoding: "UTF-8", lineEnding: "lf", isModified, lastSaved: null, fileSize: null };
}

const activeIds = () => [
  useDocumentStore.getState().activeDocumentId,
  useEditorStore.getState().activeDocumentId,
];
const docIds = () => useDocumentStore.getState().documents.map((d) => d.id);
type LogPayload = { level: string; event: string; status: string; context?: Record<string, unknown> };
const logs = (event: string, status: string): LogPayload[] =>
  sink.logEventSync.mock.calls
    .map(([p]) => p as LogPayload)
    .filter((p) => p.event === event && p.status === status);

let flushCalls: string[] = [];
let cleanups: Array<() => void> = [];
/** The active editor's flusher: `failed` (serializer throws) or `clean`. */
function installFlusher(documentId: string, status: "failed" | "clean" | "throw"): void {
  cleanups.push(
    useMilkdownEditorStore.getState().registerFlusher(documentId, (reason) => {
      flushCalls.push(reason);
      if (status === "throw") throw new Error("serializer");
      return { status };
    }),
  );
}

function seed(list: Document[], active: string | null): void {
  useDocumentStore.setState({ documents: list, activeDocumentId: active });
  useEditorStore.setState({ activeDocumentId: active, viewMode: "wysiwyg" });
}

function expectTabRefusal(from: string, to: string): void {
  expect(useToastStore.getState().message).toBe(TAB_TOAST);
  const refusals = logs("tab.switch", "fail");
  expect(refusals).toHaveLength(1);
  expect(refusals[0].level).toBe("warn");
  expect(refusals[0].context).toMatchObject({
    cause: "flush-failed",
    fromDocumentId: from,
    toDocumentId: to,
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
}

async function emit(name: string, payload: unknown): Promise<void> {
  await settle();
  await act(async () => {
    for (const cb of [...(listeners.get(name) ?? [])]) cb({ payload });
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  listeners.clear();
  flushCalls = [];
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(null);
  useMilkdownEditorStore.setState({ getEditor: () => null, flushers: {} });
  useToastStore.getState().clearToast();
  seed([doc("doc-a", "/tmp/a.md"), doc("doc-b", "/tmp/b.md")], "doc-a");
});

afterEach(() => {
  for (const c of cleanups) c();
  cleanups = [];
  useToastStore.getState().clearToast();
});

describe("D92 — documentStore actions", () => {
  it("D92-S1 setActiveDocumentId refuses on a failed flush and reports false", () => {
    installFlusher("doc-a", "failed");
    const before = useDocumentStore.getState().documents;
    const switched = useDocumentStore.getState().setActiveDocumentId("doc-b");
    expect(switched).toBe(false);
    expect(useDocumentStore.getState().activeDocumentId).toBe("doc-a");
    expect(useDocumentStore.getState().documents).toBe(before);
    expect(flushCalls).toEqual(["tab-switch"]);
    expectTabRefusal("doc-a", "doc-b");
    expect(logs("tab.switch", "success")).toHaveLength(0);
  });

  it("D92-S2 a throwing flusher refuses the same way", () => {
    installFlusher("doc-a", "throw");
    expect(useDocumentStore.getState().setActiveDocumentId("doc-b")).toBe(false);
    expect(useDocumentStore.getState().activeDocumentId).toBe("doc-a");
    expectTabRefusal("doc-a", "doc-b");
  });

  it("D92-S3 control: a clean flush switches and reports true; the same id is a no-op true without a flush", () => {
    installFlusher("doc-a", "clean");
    expect(useDocumentStore.getState().setActiveDocumentId("doc-a")).toBe(true);
    expect(flushCalls).toEqual([]);
    expect(useDocumentStore.getState().setActiveDocumentId("doc-b")).toBe(true);
    expect(useDocumentStore.getState().activeDocumentId).toBe("doc-b");
    expect(useToastStore.getState().message).toBeNull();
    expect(logs("tab.switch", "success")).toHaveLength(1);
  });

  it("D92-S4 setActiveDocument (document.activate) refuses on a failed flush too", () => {
    installFlusher("doc-a", "failed");
    expect(useDocumentStore.getState().setActiveDocument("doc-b")).toBe(false);
    expect(useDocumentStore.getState().activeDocumentId).toBe("doc-a");
    expectTabRefusal("doc-a", "doc-b");
    expect(logs("document.activate", "success")).toHaveLength(0);
  });

  it("D92-S5 closing the active tab is never blocked by a failed flush", () => {
    installFlusher("doc-a", "failed");
    useDocumentStore.getState().closeDocument("doc-a");
    expect(docIds()).toEqual(["doc-b"]);
    expect(useDocumentStore.getState().activeDocumentId).toBe("doc-b");
    expect(useToastStore.getState().message).toBeNull();
  });
});

describe("D92 — editorStore", () => {
  it("D92-E1 leaving WYSIWYG refuses on a failed flush; Source → WYSIWYG never flushes", () => {
    installFlusher("doc-a", "failed");
    useEditorStore.getState().setViewMode("source", "user");
    expect(useEditorStore.getState().viewMode).toBe("wysiwyg");
    expect(useToastStore.getState().message).toBe(VIEW_TOAST);
    expect(flushCalls).toEqual(["view-mode"]);

    useEditorStore.setState({ viewMode: "source" });
    useToastStore.getState().clearToast();
    useEditorStore.getState().setViewMode("wysiwyg", "user");
    expect(useEditorStore.getState().viewMode).toBe("wysiwyg");
    expect(flushCalls).toEqual(["view-mode"]);
    expect(useToastStore.getState().message).toBeNull();
  });
});

describe("D92 — useDocument callers keep both stores together", () => {
  it("D92-H1 setActiveDocumentById refused: both stores stay on doc-a", () => {
    installFlusher("doc-a", "failed");
    const { result } = renderHook(() => useDocument());
    act(() => result.current.setActiveDocumentById("doc-b"));
    expect(activeIds()).toEqual(["doc-a", "doc-a"]);
    expectTabRefusal("doc-a", "doc-b");
  });

  it("D92-H2 createDocument refused: the new tab exists, both stores stay on doc-a", async () => {
    installFlusher("doc-a", "failed");
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === "create_document" ? doc("doc-new", null) : null,
    );
    const { result } = renderHook(() => useDocument());
    await act(async () => {
      await result.current.createDocument();
    });
    expect(docIds()).toContain("doc-new");
    expect(activeIds()).toEqual(["doc-a", "doc-a"]);
    expectTabRefusal("doc-a", "doc-new");
  });

  it("D92-H3 upsertAndActivateDocument refused: both stores stay on doc-a", () => {
    installFlusher("doc-a", "failed");
    const { result } = renderHook(() => useDocument());
    act(() => result.current.upsertAndActivateDocument(doc("doc-r", "/tmp/r.md", true)));
    expect(docIds()).toContain("doc-r");
    expect(activeIds()).toEqual(["doc-a", "doc-a"]);
  });

  it("D92-H4 control: setActiveDocumentById with a clean flush moves both stores", () => {
    installFlusher("doc-a", "clean");
    const { result } = renderHook(() => useDocument());
    act(() => result.current.setActiveDocumentById("doc-b"));
    expect(activeIds()).toEqual(["doc-b", "doc-b"]);
  });

  it("D92-H5 closeActiveDocument is not blocked by a failed flush", async () => {
    installFlusher("doc-a", "failed");
    const { result } = renderHook(() => useDocument());
    await act(async () => {
      await result.current.closeActiveDocument(true);
    });
    expect(docIds()).toEqual(["doc-b"]);
    expect(useDocumentStore.getState().activeDocumentId).toBe("doc-b");
  });
});

describe("D92 — the open-write guard (ADR-0028) never switches away from a failed flush", () => {
  it("D92-O1 focusing an existing dirty tab is refused: both stores stay on doc-a, nothing written", () => {
    seed([doc("doc-a", "/tmp/a.md"), doc("doc-c", "/tmp/c.md", true, "C-BUF")], "doc-a");
    installFlusher("doc-a", "failed");
    const result = commitOpenedDocument(doc("doc-c", "/tmp/c.md", false, "DISK"), "file-open");
    expect(result.kind).toBe("focused-dirty");
    expect(useDocumentStore.getState().documents.find((d) => d.id === "doc-c")!.content).toBe("C-BUF");
    expect(activeIds()).toEqual(["doc-a", "doc-a"]);
    expectTabRefusal("doc-a", "doc-c");
  });

  it("D92-O2 a fresh open is written but not activated: both stores stay on doc-a", () => {
    installFlusher("doc-a", "failed");
    const decoded = doc("doc-n", "/tmp/n.md");
    const result = commitOpenedDocument(decoded, "file-open");
    expect(result).toEqual({ kind: "written", document: decoded, largeFile: false });
    expect(docIds()).toContain("doc-n");
    expect(activeIds()).toEqual(["doc-a", "doc-a"]);
    expectTabRefusal("doc-a", "doc-n");
  });

  it("D92-O3 control: a clean flush activates the opened document in both stores", () => {
    installFlusher("doc-a", "clean");
    commitOpenedDocument(doc("doc-n", "/tmp/n.md"), "file-open");
    expect(activeIds()).toEqual(["doc-n", "doc-n"]);
    expect(useToastStore.getState().message).toBeNull();
  });

  it("D92-O4 the guard's logs say whether the tab was activated", () => {
    seed([doc("doc-a", "/tmp/a.md"), doc("doc-c", "/tmp/c.md", true, "C-BUF")], "doc-a");
    installFlusher("doc-a", "failed");
    commitOpenedDocument(doc("doc-c", "/tmp/c.md", false, "DISK"), "file-open");
    expect(logs("file.open.focus_dirty", "success")[0].context).toMatchObject({ activated: false });

    installFlusher("doc-a", "clean");
    commitOpenedDocument(doc("doc-c", "/tmp/c.md", false, "DISK"), "file-open");
    expect(logs("file.open.focus_dirty", "success")[1].context).toMatchObject({ activated: true });
  });
});

describe("D92 — event-driven callers", () => {
  function mountOpenInWindow() {
    return renderHook(() => {
      const { openDocumentFromPath } = useDocument();
      return useOpenInWindow({ openDocumentFromPath });
    });
  }

  it("D92-R1 file:open-in-window focusing another tab is refused: both stores stay on doc-a", async () => {
    installFlusher("doc-a", "failed");
    mountOpenInWindow();
    await emit("file:open-in-window", { windowLabel: "main", documentId: "doc-b", path: "/tmp/b.md" });
    expect(activeIds()).toEqual(["doc-a", "doc-a"]);
    expectTabRefusal("doc-a", "doc-b");
    expect(logs("file.open.route", "success")).toHaveLength(0);
  });

  it("D92-R2 control: file:open-in-window with a clean flush focuses doc-b in both stores", async () => {
    installFlusher("doc-a", "clean");
    mountOpenInWindow();
    await emit("file:open-in-window", { windowLabel: "main", documentId: "doc-b", path: "/tmp/b.md" });
    expect(activeIds()).toEqual(["doc-b", "doc-b"]);
  });

  it("D92-M1 mcp:create_document with a failed flush keeps both stores on doc-a", async () => {
    installFlusher("doc-a", "failed");
    renderHook(() => useMcpEvents());
    await emit("mcp:create_document", { document_id: "doc-m", content: "", window_label: null });
    expect(docIds()).toContain("doc-m");
    expect(activeIds()).toEqual(["doc-a", "doc-a"]);
    expectTabRefusal("doc-a", "doc-m");
  });

  it("D92-M2 control: mcp:create_document with a clean flush activates doc-m in both stores", async () => {
    installFlusher("doc-a", "clean");
    renderHook(() => useMcpEvents());
    await emit("mcp:create_document", { document_id: "doc-m", content: "", window_label: null });
    expect(activeIds()).toEqual(["doc-m", "doc-m"]);
  });
});
