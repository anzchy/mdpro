/**
 * D95 — the D92 refusal follow-ups at the store level (ADR-0071).
 *
 * ① Only the ACTIVE document's own flush may refuse a tab switch or leaving WYSIWYG
 *   (ADR-0071 decision 1). A failing flusher registered for another document must not
 *   refuse, while every live flusher still runs (D15: a transition never skips one).
 * ③ The refusal log uses the event name of the success path it replaced
 *   (`setActiveDocumentId` → `tab.switch`, `setActiveDocument` → `document.activate`),
 *   and the open-write guard's refusal carries the open's own actionId.
 * ④ Each refused action shows exactly one toast and leaves the active id (both stores),
 *   the view mode and the user's view-mode choice as they were. Autosave is exempt
 *   (decision 4): it drafts the last flushed content and neither refuses nor toasts.
 *
 * Mock boundary: `@tauri-apps/api/{core,event,window,webviewWindow}` and the
 * `loggingService` sink. Every store, hook and guard is real; flusher doubles go through
 * the public `registerFlusher` seam (the real-serializer failure is pinned by
 * `tests/d92-failed-flush-blocks-switch.test.tsx`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const { invokeMock, sink } = vi.hoisted(() => {
  let n = 0;
  return {
    invokeMock: vi.fn(),
    sink: {
      generateActionId: vi.fn(() => `gen-${++n}`),
      logEvent: vi.fn(async () => {}),
      logEventSync: vi.fn(),
      logUiEvent: vi.fn(() => "ui-id"),
      logDialogAction: vi.fn(),
    },
  };
});

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main", listen: async () => () => {} }),
}));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("../src/services/loggingService", () => ({ loggingService: sink }));

import { useAutoSave } from "../src/hooks/useAutoSave";
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

type LogPayload = {
  level: string;
  event: string;
  status: string;
  actionId?: string;
  context?: Record<string, unknown>;
};
const allLogs = (): LogPayload[] => sink.logEventSync.mock.calls.map(([p]) => p as LogPayload);
const logs = (event: string, status: string): LogPayload[] =>
  allLogs().filter((p) => p.event === event && p.status === status);
const refusalLogs = (): LogPayload[] => allLogs().filter((p) => p.context?.cause === "flush-failed");

const activeIds = () => [
  useDocumentStore.getState().activeDocumentId,
  useEditorStore.getState().activeDocumentId,
];

/** Every flusher call, as `<documentId>:<reason>`. */
let flushCalls: string[] = [];
let cleanups: Array<() => void> = [];
function installFlusher(documentId: string, status: "failed" | "clean" | "throw"): void {
  cleanups.push(
    useMilkdownEditorStore.getState().registerFlusher(documentId, (reason) => {
      flushCalls.push(`${documentId}:${reason}`);
      if (status === "throw") throw new Error("serializer");
      return { status };
    }),
  );
}

/** Every message handed to the real toast store's `showToast`, in order. */
let toasts: string[] = [];
function countToasts(): void {
  const real = useToastStore.getState().showToast;
  useToastStore.setState({
    showToast: (message: string, durationMs?: number) => {
      toasts.push(message);
      real(message, durationMs);
    },
  });
}

function seed(list: Document[], active: string | null): void {
  useDocumentStore.setState({ documents: list, activeDocumentId: active });
  useEditorStore.setState({
    activeDocumentId: active,
    viewMode: "wysiwyg",
    userViewModeChoice: { seq: 0, mode: "wysiwyg" },
  });
}

/** ④: nothing the refused action could have moved has moved. */
function expectUnmoved(active: string): void {
  expect(activeIds()).toEqual([active, active]);
  expect(useEditorStore.getState().viewMode).toBe("wysiwyg");
  expect(useEditorStore.getState().userViewModeChoice).toEqual({ seq: 0, mode: "wysiwyg" });
}

const realShowToast = useToastStore.getState().showToast;

beforeEach(() => {
  flushCalls = [];
  toasts = [];
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(null);
  sink.logEventSync.mockClear();
  useMilkdownEditorStore.setState({ getEditor: () => null, flushers: {} });
  useToastStore.setState({ showToast: realShowToast });
  useToastStore.getState().clearToast();
  countToasts();
  seed([doc("doc-a", "/tmp/a.md"), doc("doc-b", "/tmp/b.md"), doc("doc-c", "/tmp/c.md")], "doc-a");
});

afterEach(() => {
  for (const c of cleanups) c();
  cleanups = [];
  vi.useRealTimers();
  useToastStore.getState().clearToast();
  useToastStore.setState({ showToast: realShowToast });
});

describe("D95 ① — a non-active document's failing flusher never refuses", () => {
  it.each(["failed", "throw"] as const)(
    "D95-1.1 setActiveDocumentId goes ahead when only doc-b's flusher is %s; every flusher still runs",
    (status) => {
      installFlusher("doc-a", "clean");
      installFlusher("doc-b", status);
      expect(useDocumentStore.getState().setActiveDocumentId("doc-c")).toBe(true);
      expect(useDocumentStore.getState().activeDocumentId).toBe("doc-c");
      expect(toasts).toEqual([]);
      expect(refusalLogs()).toHaveLength(0);
      expect(logs("tab.switch", "success")).toHaveLength(1);
      expect([...flushCalls].sort()).toEqual(["doc-a:tab-switch", "doc-b:tab-switch"]);
    },
  );

  it("D95-1.2 setActiveDocument goes ahead when only a non-active flusher fails", () => {
    installFlusher("doc-a", "clean");
    installFlusher("doc-b", "failed");
    expect(useDocumentStore.getState().setActiveDocument("doc-c")).toBe(true);
    expect(useDocumentStore.getState().activeDocumentId).toBe("doc-c");
    expect(toasts).toEqual([]);
    expect(refusalLogs()).toHaveLength(0);
    expect(logs("document.activate", "success")).toHaveLength(1);
  });

  it("D95-1.3 the active document has no flusher (Source mode), another one fails: the switch goes ahead", () => {
    installFlusher("doc-b", "failed");
    expect(useDocumentStore.getState().setActiveDocumentId("doc-c")).toBe(true);
    expect(useDocumentStore.getState().activeDocumentId).toBe("doc-c");
    expect(toasts).toEqual([]);
  });

  it("D95-1.4 switching TO the document whose flusher fails is not refused either", () => {
    installFlusher("doc-a", "clean");
    installFlusher("doc-b", "failed");
    expect(useDocumentStore.getState().setActiveDocumentId("doc-b")).toBe(true);
    expect(useDocumentStore.getState().activeDocumentId).toBe("doc-b");
    expect(toasts).toEqual([]);
  });

  it("D95-1.5 setViewMode and cycleViewMode leave WYSIWYG when only a non-active flusher fails", () => {
    installFlusher("doc-a", "clean");
    installFlusher("doc-b", "failed");
    useEditorStore.getState().setViewMode("source", "user");
    expect(useEditorStore.getState().viewMode).toBe("source");
    useEditorStore.getState().setViewMode("wysiwyg", "user");
    useEditorStore.getState().cycleViewMode("user");
    expect(useEditorStore.getState().viewMode).toBe("source");
    expect(toasts).toEqual([]);
    expect(refusalLogs()).toHaveLength(0);
    expect(flushCalls.filter((c) => c === "doc-b:view-mode")).toHaveLength(2);
  });

  it("D95-1.6 positive: the ACTIVE document's flusher fails (another is clean) → switch and mode change refused", () => {
    installFlusher("doc-a", "failed");
    installFlusher("doc-b", "clean");
    expect(useDocumentStore.getState().setActiveDocumentId("doc-c")).toBe(false);
    expect(useDocumentStore.getState().setActiveDocument("doc-c")).toBe(false);
    useEditorStore.getState().setViewMode("source", "user");
    useEditorStore.getState().cycleViewMode("user");
    expectUnmoved("doc-a");
    expect(toasts).toEqual([TAB_TOAST, TAB_TOAST, VIEW_TOAST, VIEW_TOAST]);
  });

  it("D95-1.7 close is exempt but still flushes: the active doc's failing flush neither refuses nor toasts", () => {
    installFlusher("doc-a", "failed");
    installFlusher("doc-b", "failed");
    useDocumentStore.getState().closeDocument("doc-a");
    expect(useDocumentStore.getState().documents.map((d) => d.id)).toEqual(["doc-b", "doc-c"]);
    expect(useDocumentStore.getState().activeDocumentId).toBe("doc-b");
    expect(flushCalls).toContain("doc-a:tab-close");
    expect(toasts).toEqual([]);
    expect(refusalLogs()).toHaveLength(0);
  });
});

describe("D95 ③ — the refusal log names the refused entry's own event and actionId", () => {
  it("D95-3.1 setActiveDocumentId refused → `tab.switch` fail (its success event), no `document.activate`", () => {
    installFlusher("doc-a", "failed");
    useDocumentStore.getState().setActiveDocumentId("doc-b");
    const refusals = refusalLogs();
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({ level: "warn", event: "tab.switch", status: "fail" });
    expect(refusals[0].context).toMatchObject({ entry: "setActiveDocumentId", fromDocumentId: "doc-a", toDocumentId: "doc-b" });
  });

  it("D95-3.2 setActiveDocument refused → `document.activate` fail (its success event), no `tab.switch`", () => {
    installFlusher("doc-a", "failed");
    useDocumentStore.getState().setActiveDocument("doc-b");
    const refusals = refusalLogs();
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({ level: "warn", event: "document.activate", status: "fail" });
    expect(refusals[0].context).toMatchObject({ entry: "setActiveDocument", fromDocumentId: "doc-a", toDocumentId: "doc-b" });
    expect(logs("tab.switch", "fail")).toHaveLength(0);
  });

  it("D95-3.3 the open-write guard's refusal carries the open's actionId, not a fresh one", () => {
    installFlusher("doc-a", "failed");
    commitOpenedDocument(doc("doc-n", "/tmp/n.md"), "file-open", { actionId: "open-42" });
    const refusals = refusalLogs();
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({ event: "tab.switch", status: "fail", actionId: "open-42" });
    expect(refusals[0].context).toMatchObject({ entry: "open-write-guard" });
  });

  it("D95-3.4 without a caller actionId the guard's refusal still gets a generated one", () => {
    installFlusher("doc-a", "failed");
    commitOpenedDocument(doc("doc-n", "/tmp/n.md"), "file-open");
    const refusals = refusalLogs();
    expect(refusals).toHaveLength(1);
    expect(refusals[0].actionId).toMatch(/^gen-\d+$/);
  });
});

describe("D95 ④ — one toast per refused action, nothing moves", () => {
  it("D95-4.1 a refused tab switch toasts once and keeps both stores and the view mode", () => {
    installFlusher("doc-a", "failed");
    useDocumentStore.getState().setActiveDocumentId("doc-b");
    expect(toasts).toEqual([TAB_TOAST]);
    expectUnmoved("doc-a");
  });

  it("D95-4.2 a refused ⌃2 toasts once and keeps the mode and the user's choice", () => {
    installFlusher("doc-a", "failed");
    useEditorStore.getState().setViewMode("source", "user");
    expect(toasts).toEqual([VIEW_TOAST]);
    expectUnmoved("doc-a");
  });

  it("D95-4.3 a refused open through the guard toasts once; the tab is written but inactive", () => {
    installFlusher("doc-a", "failed");
    commitOpenedDocument(doc("doc-n", "/tmp/n.md"), "file-open", { actionId: "open-1" });
    expect(toasts).toEqual([TAB_TOAST]);
    expect(useDocumentStore.getState().documents.map((d) => d.id)).toContain("doc-n");
    expectUnmoved("doc-a");
  });

  it("D95-4.4 autosave is exempt: it drafts the last flushed content, refuses nothing and toasts nothing", async () => {
    vi.useFakeTimers();
    seed([doc("doc-a", "/tmp/a.md", true, "LAST-FLUSHED"), doc("doc-b", "/tmp/b.md")], "doc-a");
    installFlusher("doc-a", "failed");
    const { unmount } = renderHook(() => useAutoSave(5));
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    const drafts = invokeMock.mock.calls.filter((call) => call[0] === "save_draft");
    expect(drafts).toHaveLength(1);
    expect(drafts[0][1]).toMatchObject({ documentId: "doc-a", content: "LAST-FLUSHED", originalPath: "/tmp/a.md" });
    expect(toasts).toEqual([]);
    expect(refusalLogs()).toHaveLength(0);
    expectUnmoved("doc-a");
    unmount();
  });
});
