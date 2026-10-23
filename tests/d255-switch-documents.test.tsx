/** D255 Switch Documents: real document, editor and MRU stores. */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { menuWindow } = vi.hoisted(() => ({ menuWindow: {
  label: "A",
  handlers: {} as Record<string, (event: { payload: { action: string; target: string } }) => void>,
} }));
vi.mock("@tauri-apps/api/core", async () => (await import("./support/tauriCoreMock")).createTauriCoreMock());
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({
  label: menuWindow.label,
  listen: async (_name: string, handler: (event: { payload: { action: string; target: string } }) => void) => {
    menuWindow.handlers[menuWindow.label] = handler;
    return () => { delete menuWindow.handlers[menuWindow.label]; };
  },
}) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
import { useDocument } from "../src/hooks/useDocument";
import { useMenuEvents } from "../src/hooks/useMenuEvents";
import { useKeyboardShortcuts } from "../src/hooks/useKeyboardShortcuts";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "../src/types/preferences";
import { switchToMostRecentDocument } from "../src/hooks/switchDocuments";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useTabStore } from "../src/stores/tabStore";
import { useToastStore } from "../src/stores/toastStore";
import { loggingService } from "../src/services/loggingService";
import { doc } from "./support/editorGenerationDomain";

const ids = ["a", "b", "c"];
const documents = ids.map((id) => ({ ...doc(id, id), path: `/tmp/${id}.md` }));
const mru = () => useTabStore.getState().tabs.map((t) => [t.documentId, t.lastActiveAt]);
const active = () => ({
  document: useDocumentStore.getState().activeDocumentId,
  editor: useEditorStore.getState().activeDocumentId,
  tab: useTabStore.getState().tabs.find((t) => t.id === useTabStore.getState().activeTabId)?.documentId,
});

beforeEach(() => {
  useMilkdownEditorStore.setState({ flushers: {} });
  useMilkdownEditorStore.getState().unregisterEditor();
  useDocumentStore.setState({ documents, activeDocumentId: "a" });
  useEditorStore.setState({ activeDocumentId: "a" });
  useTabStore.setState({ tabs: [], activeTabId: null, closedTabs: [] });
  useToastStore.getState().clearToast();
  menuWindow.label = "A";
  menuWindow.handlers = {};
});

describe("D255 Switch Documents", () => {
  it("uses the applied v2 Ctrl+Tab to switch MRU, while v1 stays keyless", () => {
    const { result } = renderHook(() => useDocument());
    act(() => result.current.setActiveDocumentById("b"));
    act(() => result.current.setActiveDocumentById("c"));
    const { unmount } = renderHook(() => useKeyboardShortcuts({
      onSwitchDocuments: switchToMostRecentDocument,
      shortcutsVersion: 2,
      shortcuts: { ...DEFAULT_KEYBOARD_SHORTCUTS, viewSwitchDocuments: "Ctrl+Tab" },
    }));
    const press = (key: string) => {
      const event = new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true });
      act(() => window.dispatchEvent(event));
      return event.defaultPrevented;
    };
    expect(press("Tab")).toBe(true);
    expect(active()).toEqual({ document: "b", editor: "b", tab: "b" });
    unmount();
    const old = renderHook(() => useKeyboardShortcuts({
      onSwitchDocuments: switchToMostRecentDocument,
      shortcutsVersion: 1,
      shortcuts: { ...DEFAULT_KEYBOARD_SHORTCUTS, viewSwitchDocuments: "Ctrl+Tab" },
    }));
    expect(press("Tab")).toBe(false);
    expect(active()).toEqual({ document: "b", editor: "b", tab: "b" });
    old.unmount();
  });
  it("zero tabs logs a no-op and leaves every active identity empty", () => {
    const log = vi.spyOn(loggingService, "logEventSync");
    useDocumentStore.setState({ documents: [], activeDocumentId: null });
    useEditorStore.setState({ activeDocumentId: null });
    switchToMostRecentDocument("zero-tabs");
    expect(active()).toEqual({ document: null, editor: null, tab: undefined });
    expect(useTabStore.getState().tabs).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "tab.switch", status: "cancel", actionId: "zero-tabs", context: { reason: "one_tab" } }));
    log.mockRestore();
  });

  it("tied MRU ranks choose stable document order", () => {
    useDocumentStore.setState({ documents, activeDocumentId: "a" });
    useTabStore.getState().syncDocuments(documents, "a");
    useTabStore.setState((state) => ({ tabs: state.tabs.map((tab) =>
      tab.documentId === "a" ? tab : { ...tab, lastActiveAt: 7 }) }));
    switchToMostRecentDocument("tie");
    expect(active()).toEqual({ document: "b", editor: "b", tab: "b" });
  });

  it("a menu event for A switches A's MRU when focus moved to B, while a B event is ignored", async () => {
    const log = vi.spyOn(loggingService, "logMenuSelect");
    const docs = renderHook(() => useDocument());
    act(() => docs.result.current.setActiveDocumentById("b"));
    act(() => docs.result.current.setActiveDocumentById("c"));
    renderHook(() => useMenuEvents({ onSwitchDocuments: switchToMostRecentDocument }));
    await act(async () => { await Promise.resolve(); });
    menuWindow.label = "B";
    act(() => menuWindow.handlers.A({ payload: { action: "view.switch_documents", target: "B" } }));
    expect(active()).toEqual({ document: "c", editor: "c", tab: "c" });
    act(() => menuWindow.handlers.A({ payload: { action: "view.switch_documents", target: "A" } }));
    expect(active()).toEqual({ document: "b", editor: "b", tab: "b" });
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
  it("chooses the most recent other tab and repeated commands alternate, including same-clock activations", () => {
    vi.spyOn(Date, "now").mockReturnValue(100);
    try {
      const { result } = renderHook(() => useDocument());
      act(() => result.current.setActiveDocumentById("b"));
      act(() => result.current.setActiveDocumentById("c"));
      const api = result.current as typeof result.current & { switchToMostRecentDocument?: () => void };
      act(() => api.switchToMostRecentDocument?.());
      expect(active()).toEqual({ document: "b", editor: "b", tab: "b" });
      act(() => api.switchToMostRecentDocument?.());
      expect(active()).toEqual({ document: "c", editor: "c", tab: "c" });
      expect(new Set(mru().map(([, at]) => at)).size).toBe(3);
    } finally { vi.restoreAllMocks(); }
  });

  it("one tab is a no-op and leaves identities and content intact", () => {
    const log = vi.spyOn(loggingService, "logEventSync");
    useDocumentStore.setState({ documents: [documents[0]], activeDocumentId: "a" });
    const { result } = renderHook(() => useDocument());
    const api = result.current as typeof result.current & { switchToMostRecentDocument?: () => void };
    act(() => api.switchToMostRecentDocument?.());
    expect(active()).toEqual({ document: "a", editor: "a", tab: "a" });
    expect(useDocumentStore.getState().getDocumentById("a")?.content).toBe("a");
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "tab.switch", status: "cancel", context: { reason: "one_tab" } }));
    log.mockRestore();
  });

  it("a failed outgoing editor flush preserves all identities and MRU, then retry switches", () => {
    const { result } = renderHook(() => useDocument());
    act(() => result.current.setActiveDocumentById("b"));
    act(() => result.current.setActiveDocumentById("c"));
    const before = mru();
    const unregister = useMilkdownEditorStore.getState().registerFlusher("c", () => ({ status: "failed" }));
    const api = result.current as typeof result.current & { switchToMostRecentDocument?: () => void };
    act(() => api.switchToMostRecentDocument?.());
    expect(active()).toEqual({ document: "c", editor: "c", tab: "c" });
    expect(mru()).toEqual(before);
    expect(useToastStore.getState().message).toMatch(/could not|failed|try again/i);
    unregister();
    act(() => api.switchToMostRecentDocument?.());
    expect(active()).toEqual({ document: "b", editor: "b", tab: "b" });
  });
});
