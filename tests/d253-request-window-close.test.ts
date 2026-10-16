/**
 * D253-WI-2 (ADR-0112) — `useWindowCloseGuard().requestWindowClose` goes
 * through the existing close guard.
 *
 * Law: a requested close is decided by the same `onCloseRequested` handler as
 * an OS close. With nothing unsaved the window saves its state and then closes,
 * with no prompt; with a dirty document it prompts and stays open. The hook
 * never calls `destroy()` itself.
 *
 * The fake window models the Tauri v2 boundary as `window.js` implements it:
 * `close()` emits CloseRequested to every registered handler, and when no
 * handler prevented it the wrapper destroys the window (`state.destroyed`).
 * `win.destroy` is a separate spy that only a direct call from our code would
 * reach. Mocked boundaries: `@tauri-apps/api/{window,core}` and the
 * `loggingService` sink. The stores, `dataLossGuards`, the save body and the
 * hook are real. Paired real path: the D253 device check (close the last tab of
 * a secondary window) — no jsdom test can reach the real window plugin.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const { fake, invokeMock, logEventSync } = vi.hoisted(() => {
  type CloseEvent = { preventDefault: () => void };
  type CloseHandler = (event: CloseEvent) => unknown;
  const state = {
    label: "doc-1",
    handlers: new Set<CloseHandler>(),
    closeCalls: 0,
    destroyed: false,
    throwOnGet: false,
    rejectClose: false,
    sequence: [] as string[],
  };
  const destroy = (() => {
    const calls: unknown[] = [];
    const fn = async () => {
      calls.push(1);
    };
    return Object.assign(fn, { calls });
  })();
  const win = {
    get label() {
      return state.label;
    },
    onCloseRequested(handler: CloseHandler): Promise<() => void> {
      state.handlers.add(handler);
      return Promise.resolve(() => {
        state.handlers.delete(handler);
      });
    },
    /** Tauri v2: emit CloseRequested; the wrapper destroys unless prevented. */
    async close(): Promise<void> {
      state.closeCalls += 1;
      if (state.rejectClose) throw new Error("plugin:window|close denied");
      for (const handler of [...state.handlers]) {
        let prevented = false;
        await handler({ preventDefault: () => (prevented = true) });
        if (!prevented && !state.destroyed) {
          state.destroyed = true;
          state.sequence.push("destroyed");
        }
      }
    },
    destroy,
    scaleFactor: async () => {
      state.sequence.push("save");
      return 1;
    },
    innerSize: async () => ({ width: 1024, height: 768 }),
    outerPosition: async () => ({ x: 11, y: 22 }),
    isMaximized: async () => false,
  };
  return {
    fake: {
      state,
      win,
      reset() {
        state.label = "doc-1";
        state.handlers.clear();
        state.closeCalls = 0;
        state.destroyed = false;
        state.throwOnGet = false;
        state.rejectClose = false;
        state.sequence = [];
        destroy.calls.length = 0;
      },
    },
    invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
    logEventSync: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => {
    if (fake.state.throwOnGet) throw new Error("no window in web preview");
    return fake.win;
  },
}));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("../src/services/loggingService", () => ({
  loggingService: { logEventSync, logEvent: vi.fn(async () => {}), generateActionId: vi.fn(() => "test-id") },
}));

import { useWindowCloseGuard } from "../src/hooks/useWindowCloseGuard";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import type { Document } from "../src/types/document";

type LogLine = { event?: string; status?: string; context?: Record<string, unknown> };
const lines = (event: string): LogLine[] =>
  logEventSync.mock.calls.map((c) => c[0] as LogLine).filter((l) => l.event === event);

function dirtyDoc(): Document {
  return { id: "doc-a", path: "/tmp/a.md", content: "unsaved", encoding: "UTF-8", lineEnding: "lf", isModified: true, lastSaved: null, fileSize: null };
}

async function mountGuard() {
  const view = renderHook(() => useWindowCloseGuard());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return view;
}

async function request(view: Awaited<ReturnType<typeof mountGuard>>) {
  await act(async () => {
    await view.result.current.requestWindowClose("last_tab_closed");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  fake.reset();
  invokeMock.mockReset();
  invokeMock.mockImplementation(async () => null);
  logEventSync.mockReset();
  useMilkdownEditorStore.setState({ flushers: {} });
  useEditorStore.setState({ editorView: null });
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

describe("requestWindowClose", () => {
  it("with no document left, saves state and then closes, with no prompt", async () => {
    const view = await mountGuard();
    await request(view);

    expect(fake.state.destroyed).toBe(true);
    expect(fake.state.sequence).toEqual(["save", "destroyed"]);
    expect(view.result.current.pendingClose).toBeNull();
    // The non-main save ran (ADR-0037: skips the global record, still logged).
    expect(lines("window.save_state")).toEqual([
      expect.objectContaining({ status: "success", context: { outcome: "skipped", reason: "not_main" } }),
    ]);
  });

  it("logs the request with the window label and the reason only", async () => {
    const view = await mountGuard();
    await request(view);

    const start = lines("window.close_requested").filter(
      (l) => l.status === "start" && l.context?.action === "last_tab_closed",
    );
    expect(start).toHaveLength(1);
    expect(start[0].context).toEqual({ windowLabel: "doc-1", action: "last_tab_closed" });
  });

  // Amended after red (D253-WI-2, accepted ADR-0112 Decision): the request now
  // re-checks emptiness itself, so a document open when it is made means the
  // user closed a tab, not the window: no close and no window prompt. The race
  // that matters, a document arriving after the request, is covered by
  // d253-close-guard-dirty-after-save and d253-close-attempt-consent.
  it("with a document open at request time, neither closes nor prompts", async () => {
    useDocumentStore.setState({ documents: [dirtyDoc()], activeDocumentId: "doc-a" });
    const view = await mountGuard();
    await request(view);

    expect(view.result.current.pendingClose).toBe(null);
    expect(fake.state.destroyed).toBe(false);
    expect(fake.state.closeCalls).toBe(0);
  });

  it("never calls destroy itself; the close goes through close()", async () => {
    const view = await mountGuard();
    await request(view);
    useDocumentStore.setState({ documents: [dirtyDoc()], activeDocumentId: "doc-a" });
    fake.state.destroyed = false;
    await request(view);

    expect(fake.win.destroy.calls).toHaveLength(0);
    expect(fake.state.closeCalls).toBeGreaterThanOrEqual(2);
  });

  it("in web preview (no window handle) is a logged no-op", async () => {
    fake.state.throwOnGet = true;
    const view = await mountGuard();
    await request(view);

    expect(fake.state.closeCalls).toBe(0);
    expect(view.result.current.pendingClose).toBeNull();
    expect(lines("window.close_requested")).toEqual([
      expect.objectContaining({ status: "cancel", context: { action: "last_tab_closed", outcome: "no_window" } }),
    ]);
  });

  it("a rejected close() is logged as a fail and does not throw", async () => {
    fake.state.rejectClose = true;
    const view = await mountGuard();
    await request(view);

    expect(fake.state.destroyed).toBe(false);
    const fails = lines("window.close_requested").filter((l) => l.status === "fail");
    expect(fails).toHaveLength(1);
    expect(fails[0].context).toEqual({ windowLabel: "doc-1", action: "last_tab_closed", reason: "close_rejected" });
  });
});
