import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Document } from "../src/types/document";

const { state, invokeMock, logEventSync } = vi.hoisted(() => {
  type Handler = (event: { preventDefault: () => void }) => unknown;
  return {
    state: { handlers: new Set<Handler>(), closes: 0, visible: true, drafts: new Map<string, string>(), failId: "" },
    invokeMock: vi.fn(async (_command: string, _args?: Record<string, unknown>): Promise<unknown> => null),
    logEventSync: vi.fn(),
  };
});
const win = {
  label: "main",
  onCloseRequested: async (handler: (event: { preventDefault: () => void }) => unknown) => {
    state.handlers.add(handler);
    return () => state.handlers.delete(handler);
  },
  close: async () => { state.closes += 1; },
  innerSize: async () => ({ width: 1000, height: 700 }),
  outerPosition: async () => ({ x: 0, y: 0 }),
  isMaximized: async () => false,
  scaleFactor: async () => 1,
};
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => win }));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (command: string, args?: Record<string, unknown>) => invokeMock(command, args),
}));
vi.mock("../src/services/loggingService", () => ({
  loggingService: { logEventSync, generateActionId: () => "d305-action", logEvent: vi.fn(async () => {}) },
}));

import { useAutoSave } from "../src/hooks/useAutoSave";
import { useWindowCloseGuard } from "../src/hooks/useWindowCloseGuard";
import { useDocumentStore } from "../src/stores/documentStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useEditorStore } from "../src/stores/editorStore";
import { draftWritesSuspended, forgetDraftRevision, rememberDraftRevision, resumeDrafts, suspendAndDrainDrafts } from "../src/services/draftWriteCoordinator";

function revisionFor(id: string): string {
  return `00000000-0000-4000-8000-${id === "A" ? "00000000000a" : id === "B" ? "00000000000b" : "00000000000c"}`;
}
function seedKnownDrafts() {
  for (const id of state.drafts.keys()) rememberDraftRevision(id, revisionFor(id));
}

function doc(id: string): Document {
  return { id, path: `/tmp/${id}.md`, content: `dirty ${id}`, encoding: "UTF-8", lineEnding: "lf", isModified: true, lastSaved: null, fileSize: null };
}
async function settle() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
async function requestClose() {
  await act(async () => { await Promise.all([...state.handlers].map((handler) => handler({ preventDefault() {} }))); });
}
function mount() {
  return renderHook(() => { useAutoSave(5); return useWindowCloseGuard(); });
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  state.handlers.clear(); state.closes = 0; state.visible = true; state.drafts.clear(); state.failId = "";
  for (const id of ["A", "B", "C"]) forgetDraftRevision(id);
  win.label = "main";
  logEventSync.mockClear(); invokeMock.mockReset();
  invokeMock.mockImplementation(async (command, args) => {
    if (command === "window_close_order") state.visible = args?.operation === "restore";
    if (command === "save_draft") state.drafts.set(String(args?.documentId), String(args?.content));
    if (command === "save_draft") return { revision: revisionFor(String(args?.documentId)) };
    if (command === "delete_discarded_draft") {
      const id = String(args?.documentId);
      if (id === state.failId) throw new Error("disk failure");
      return state.drafts.delete(id);
    }
    return null;
  });
  useMilkdownEditorStore.setState({ flushers: {} });
  useEditorStore.setState({ editorView: null });
  useDocumentStore.setState({ documents: [doc("A")], activeDocumentId: "A" });
});
afterEach(() => vi.useRealTimers());

describe("D305 window Discard", () => {
  it("keeps a newer close attempt's draft suspension after an older attempt releases", async () => {
    await suspendAndDrainDrafts(["new-attempt"]);
    await suspendAndDrainDrafts(["new-attempt"]);
    resumeDrafts(["new-attempt"]);
    expect(draftWritesSuspended("new-attempt")).toBe(true);
    resumeDrafts(["new-attempt"]);
    expect(draftWritesSuspended("new-attempt")).toBe(false);
  });
  it("deletes a draft written while the prompt was open and never recreates it", async () => {
    const { result, unmount } = mount(); await settle(); await requestClose();
    expect(result.current.pendingClose).toBe("window");
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(state.drafts.get("A")).toBe("dirty A");
    await act(async () => { await result.current.confirmClose(); });
    expect(state.drafts.has("A")).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(state.drafts.has("A")).toBe(false);
    expect(state.closes).toBe(1); unmount();
  });
  it("deletes every consented draft, continuing past a failed deletion", async () => {
    useDocumentStore.setState({ documents: [doc("A"), doc("B"), doc("C")], activeDocumentId: "A" });
    state.drafts.set("A", "dirty A"); state.drafts.set("B", "dirty B"); state.drafts.set("C", "dirty C");
    state.failId = "B";
    seedKnownDrafts();
    const { result, unmount } = mount(); await settle(); await requestClose();
    await act(async () => { await result.current.confirmClose(); });
    expect([...state.drafts.keys()]).toEqual(["B"]);
    expect(state.closes).toBe(1);
    expect(logEventSync.mock.calls.some(([entry]) => entry.event === "draft.discard" && entry.status === "fail")).toBe(true);
    unmount();
  });
  it.each(["A", "C"])("continues deleting when %s fails at a batch edge", async (failedId) => {
    useDocumentStore.setState({ documents: [doc("A"), doc("B"), doc("C")], activeDocumentId: "A" });
    for (const id of ["A", "B", "C"]) state.drafts.set(id, `dirty ${id}`);
    state.failId = failedId;
    seedKnownDrafts();
    const { result, unmount } = mount(); await settle(); await requestClose();
    await act(async () => { await result.current.confirmClose(); });
    expect([...state.drafts.keys()]).toEqual([failedId]);
    expect(state.closes).toBe(1);
    unmount();
  });
  it("Cancel leaves the draft and its timer active", async () => {
    state.drafts.set("A", "older");
    const { result, unmount } = mount(); await settle(); await requestClose();
    act(() => result.current.cancelClose());
    expect(state.drafts.get("A")).toBe("older");
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(state.drafts.get("A")).toBe("dirty A");
    expect(invokeMock.mock.calls.some(([command]) => command === "delete_discarded_draft")).toBe(false);
    unmount();
  });
  it("preserves drafts on Save and on a clean close", async () => {
    for (const savedAfterPrompt of [true, false]) {
      state.drafts.set("A", "retained draft");
      if (!savedAfterPrompt) useDocumentStore.setState({ documents: [{ ...doc("A"), isModified: false }] });
      const { unmount } = mount(); await settle();
      if (savedAfterPrompt) {
        await requestClose();
        act(() => useDocumentStore.setState({ documents: [{ ...doc("A"), isModified: false }] }));
      }
      const closesBefore = state.closes;
      await requestClose();
      expect(state.closes).toBeGreaterThan(closesBefore);
      expect(state.drafts.get("A")).toBe("retained draft");
      expect(invokeMock.mock.calls.some(([command]) => command === "delete_discarded_draft")).toBe(false);
      unmount();
      state.handlers.clear();
      invokeMock.mockClear();
      useDocumentStore.setState({ documents: [doc("A")], activeDocumentId: "A" });
    }
  });
  it("waits for two overlapping writes before deleting, even when the older settles last", async () => {
    const pending: Array<() => void> = [];
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "save_draft") {
        await new Promise<void>((resolve) => pending.push(resolve));
        state.drafts.set(String(args?.documentId), String(args?.content));
        return { revision: revisionFor(String(args?.documentId)) };
      }
      if (command === "delete_discarded_draft") return state.drafts.delete(String(args?.documentId));
      return null;
    });
    const { result, unmount } = mount(); await settle(); await requestClose();
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(pending).toHaveLength(2);
    let completed = false;
    const close = result.current.confirmClose().then(() => { completed = true; });
    await settle();
    expect(completed).toBe(false);
    await act(async () => { pending[1](); await Promise.resolve(); });
    expect(completed).toBe(false);
    await act(async () => { pending[0](); await close; });
    expect(state.drafts.has("A")).toBe(false);
    expect(state.closes).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(state.drafts.has("A")).toBe(false);
    unmount();
  });
  it("resumes drafting after an edit vetoes Discard during the drain", async () => {
    let release!: () => void;
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "save_draft") {
        if (!release) await new Promise<void>((resolve) => { release = resolve; });
        state.drafts.set(String(args?.documentId), String(args?.content));
        return { revision: revisionFor(String(args?.documentId)) };
      }
      if (command === "delete_discarded_draft") return state.drafts.delete(String(args?.documentId));
      return null;
    });
    const { result, unmount } = mount(); await settle(); await requestClose();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    const close = result.current.confirmClose();
    act(() => useDocumentStore.getState().updateDocumentContent("A", "new revision"));
    await act(async () => { release(); await close; });
    expect(result.current.pendingClose).toBe("window");
    expect(state.closes).toBe(0);
    act(() => result.current.cancelClose());
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(state.drafts.get("A")).toBe("new revision");
    expect(invokeMock.mock.calls.some(([command]) => command === "delete_discarded_draft")).toBe(false);
    unmount();
  });
  it("stops the delete batch when a renewed prompt is cancelled during a pending delete", async () => {
    useDocumentStore.setState({ documents: [doc("A"), doc("B")], activeDocumentId: "A" });
    state.drafts.set("A", "dirty A"); state.drafts.set("B", "dirty B");
    seedKnownDrafts();
    let releaseDelete!: () => void;
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "delete_discarded_draft") {
        if (args?.documentId === "A") await new Promise<void>((resolve) => { releaseDelete = resolve; });
        return state.drafts.delete(String(args?.documentId));
      }
      return null;
    });
    const { result, unmount } = mount(); await settle(); await requestClose();
    const close = result.current.confirmClose();
    await settle();
    expect(releaseDelete).toBeTypeOf("function");
    await requestClose();
    act(() => result.current.cancelClose());
    await act(async () => { releaseDelete(); await close; });
    expect(state.drafts.get("B")).toBe("dirty B");
    expect(state.closes).toBe(0);
    unmount();
  });
  it("restores a staged secondary window before re-prompting after a delete-time edit", async () => {
    win.label = "secondary";
    state.drafts.set("A", "dirty A");
    seedKnownDrafts();
    let releaseDelete!: () => void;
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "window_close_order") state.visible = args?.operation === "restore";
      if (command === "delete_discarded_draft") {
        await new Promise<void>((resolve) => { releaseDelete = resolve; });
        return state.drafts.delete(String(args?.documentId));
      }
      return null;
    });
    const { result, unmount } = mount(); await settle(); await requestClose();
    const close = result.current.confirmClose();
    await settle();
    expect(state.visible).toBe(false);
    act(() => useDocumentStore.getState().updateDocumentContent("A", "new unsaved edit"));
    await act(async () => { releaseDelete(); await close; });
    expect(state.visible).toBe(true);
    expect(result.current.pendingClose).toBe("window");
    expect(state.closes).toBe(0);
    unmount();
  });
  it("restores a staged secondary window when consent changes between stage and delete", async () => {
    win.label = "secondary";
    invokeMock.mockImplementation((command, args) => {
      if (command === "window_close_order") {
        state.visible = args?.operation === "restore";
        if (args?.operation === "stage") {
          const staged = Promise.resolve(null);
          void staged.then(() => queueMicrotask(() => {
            useDocumentStore.getState().updateDocumentContent("A", "changed after stage");
          }));
          return staged;
        }
      }
      return Promise.resolve(null);
    });
    const { result, unmount } = mount(); await settle(); await requestClose();
    await act(async () => { await result.current.confirmClose(); });
    expect(state.visible).toBe(true);
    expect(result.current.pendingClose).toBe("window");
    expect(state.closes).toBe(0);
    unmount();
  });

  it("stops a discard batch and leaves the window open when the first draft is stale", async () => {
    useDocumentStore.setState({ documents: [doc("A"), doc("B")], activeDocumentId: "A" });
    state.drafts.set("A", "newer V2"); state.drafts.set("B", "dirty B");
    seedKnownDrafts();
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "delete_discarded_draft") {
        if (args?.documentId === "A") return "stale";
        state.drafts.delete(String(args?.documentId));
        return "deleted";
      }
      return null;
    });
    const { result, unmount } = mount(); await settle(); await requestClose();
    await act(async () => { await result.current.confirmClose(); });
    expect([...state.drafts.entries()]).toEqual([["A", "newer V2"], ["B", "dirty B"]]);
    expect(state.closes).toBe(0);
    expect(result.current.pendingClose).toBe("window");
    unmount();
  });

  it.each([["A", "B"], ["B", "A"]])("keeps per-document revisions when autosaving %s then %s", async (first, second) => {
    const revisions = new Map<string, string>();
    useDocumentStore.setState({ documents: [doc("A"), doc("B")], activeDocumentId: first });
    invokeMock.mockImplementation(async (command, args) => {
      const id = String(args?.documentId);
      if (command === "save_draft") {
        const revision = `00000000-0000-4000-8000-${id === "A" ? "00000000000a" : "00000000000b"}`;
        state.drafts.set(id, String(args?.content)); revisions.set(id, revision);
        return { revision };
      }
      if (command === "delete_discarded_draft") {
        if (args?.expectedRevision !== revisions.get(id)) return "stale";
        state.drafts.delete(id);
        return "deleted";
      }
      return null;
    });
    const { result, unmount } = mount(); await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    act(() => useDocumentStore.setState({ activeDocumentId: second }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect([...state.drafts.keys()].sort()).toEqual(["A", "B"]);
    await requestClose();
    await act(async () => { await result.current.confirmClose(); });
    expect([...state.drafts.keys()]).toEqual([]);
    expect(state.closes).toBe(1);
    unmount();
  });

  it("uses the last disk write when autosave responses settle in reverse order", async () => {
    const firstRevision = "00000000-0000-4000-8000-000000000001";
    const secondRevision = "00000000-0000-4000-8000-000000000002";
    let completeFirst!: () => void;
    let saves = 0;
    let diskRevision = "";
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "save_draft") {
        saves += 1;
        if (saves === 1) {
          diskRevision = firstRevision;
          state.drafts.set("A", String(args?.content));
          await new Promise<void>((resolve) => { completeFirst = resolve; });
          return { revision: firstRevision, saveOrder: 1 };
        }
        diskRevision = secondRevision;
        state.drafts.set("A", String(args?.content));
        return { revision: secondRevision, saveOrder: 2 };
      }
      if (command === "delete_discarded_draft") {
        if (args?.expectedRevision !== diskRevision) return "stale";
        state.drafts.delete("A");
        return "deleted";
      }
      return null;
    });
    const { result, unmount } = mount(); await settle(); await requestClose();
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(saves).toBe(2);
    await act(async () => { completeFirst(); await Promise.resolve(); });
    await act(async () => { await result.current.confirmClose(); });
    expect(state.drafts.has("A")).toBe(false);
    expect(state.closes).toBe(1);
    unmount();
  });
});
