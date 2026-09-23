/**
 * D16 WI-6 — the window-close guard listener.
 *
 * Three defects live in the `onCloseRequested` subscription this hook replaces
 * (`src/App.tsx:381-450` before the extraction):
 *
 *   1. LEAK. `unlisten` is assigned only after `await import(...)` and
 *      `await onCloseRequested(...)` settle. A cleanup that runs before they do
 *      leaves `unlisten` undefined, so the handler the subscription eventually
 *      registers is never removed. Once two handlers are live, a Discard latches
 *      `allowWindowClose`, the first handler consumes the latch, and the second
 *      prompts again.
 *   2. CHURN. The effect depended on `saveWindowState`, which depended on
 *      `activeDocument` — a `useMemo` over `documents`. Every keystroke (and
 *      every MCP write) tore the listener down and re-subscribed it, which is
 *      what makes defect 1 fire constantly rather than rarely.
 *   3. (Rev 1) STALE GEOMETRY. Dropping `activeDocument` from the deps while
 *      still reading it from the render closure would freeze the active document
 *      at subscription time, and per-file geometry would be written against
 *      whichever document was open when the listener subscribed.
 *
 * The fake `getCurrentWindow()` below holds a real `Set` of registered handlers
 * and (when `autoResolve` is off) resolves `onCloseRequested` only when the test
 * says so, so the leak is observable as boundary state rather than inferred.
 * Only the process boundaries are mocked: `@tauri-apps/api/{window,core}` and
 * `loggingService`. The stores, `dataLossGuards` and the hook itself are real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const { fake, invokeMock, logEventSync } = vi.hoisted(() => {
  type CloseHandler = (event: { preventDefault: () => void }) => unknown;

  const state = {
    /** Handlers the boundary considers live. A leak shows up here as an extra entry. */
    handlers: new Set<CloseHandler>(),
    /** Subscriptions whose promise has not been resolved yet. */
    pending: [] as Array<() => void>,
    /** When false, `onCloseRequested` stays pending until the test drains `pending`. */
    autoResolve: true,
    /** How many times the hook called `onCloseRequested` at all. */
    subscribeCount: 0,
    /** How many times the hook asked the OS window to close. */
    closeCount: 0,
  };

  const win = {
    label: "main",
    onCloseRequested(handler: CloseHandler): Promise<() => void> {
      state.subscribeCount += 1;
      return new Promise<() => void>((resolve) => {
        const settle = () => {
          state.handlers.add(handler);
          resolve(() => {
            state.handlers.delete(handler);
          });
        };
        if (state.autoResolve) settle();
        else state.pending.push(settle);
      });
    },
    close() {
      state.closeCount += 1;
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
        state.handlers.clear();
        state.pending = [];
        state.autoResolve = true;
        state.subscribeCount = 0;
        state.closeCount = 0;
      },
    },
    invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
    logEventSync: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => fake.win }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync,
    logEvent: vi.fn(async () => {}),
    generateActionId: vi.fn(() => "test-id"),
  },
}));

import { useWindowCloseGuard } from "../src/hooks/useWindowCloseGuard";
import { useDocumentStore } from "../src/stores/documentStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import type { Document } from "../src/types/document";

function doc(id: string, path: string | null, isModified = false): Document {
  return {
    id,
    path,
    content: `content of ${id}`,
    encoding: "UTF-8",
    lineEnding: "lf",
    isModified,
    lastSaved: null,
    fileSize: null,
  };
}

function seed(documents: Document[], activeDocumentId: string | null) {
  useDocumentStore.setState({ documents, activeDocumentId });
}

/**
 * The hook's host. App.tsx re-renders on every `documents` change (it reads them
 * through `useDocument`), so the host subscribes the same way — otherwise the
 * churn defect would be invisible here.
 */
function mountGuard() {
  return renderHook(() => {
    useDocumentStore((s) => s.documents);
    return useWindowCloseGuard();
  });
}

/** Let the effect's dynamic import + subscription promises settle. */
async function tick() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Resolve every subscription the fake is holding open. */
async function settlePendingSubscriptions() {
  await act(async () => {
    fake.state.pending.splice(0).forEach((settle) => settle());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Fire an OS close request into every live handler, as Tauri would. */
async function requestClose() {
  const preventDefault = vi.fn();
  const handlers = [...fake.state.handlers];
  await act(async () => {
    await Promise.all(handlers.map((handler) => handler({ preventDefault })));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return preventDefault;
}

function geometryCalls() {
  return invokeMock.mock.calls.filter(([command]) => command === "save_window_geometry");
}

beforeEach(() => {
  fake.reset();
  invokeMock.mockReset();
  invokeMock.mockImplementation(async () => null);
  logEventSync.mockReset();
  useMilkdownEditorStore.setState({ flushers: {} });
  seed([doc("doc-a", "/tmp/a.md")], "doc-a");
});

describe("WI-6 R1 — the unlisten race (regression)", () => {
  it("leaves zero live handlers when the subscription resolves after unmount", async () => {
    fake.state.autoResolve = false;
    const { unmount } = mountGuard();
    await tick();

    // The subscription is in flight and nothing is registered yet.
    expect(fake.state.subscribeCount).toBe(1);
    expect(fake.state.handlers.size).toBe(0);

    unmount();
    await settlePendingSubscriptions();

    // The handler the boundary registered after teardown must be gone again.
    expect(fake.state.handlers.size).toBe(0);
  });

  it("leaves zero live handlers when the host re-renders before the first resolve", async () => {
    fake.state.autoResolve = false;
    const { unmount } = mountGuard();
    await tick();

    await act(async () => {
      useDocumentStore.getState().updateDocumentContent("doc-a", "typed while pending");
    });
    await tick();
    unmount();
    await settlePendingSubscriptions();

    expect(fake.state.handlers.size).toBe(0);
  });
});

describe("WI-6 R2 — one listener for the life of the window", () => {
  it("does not re-subscribe when the active document's content changes ten times", async () => {
    const view = mountGuard();
    await tick();
    expect(fake.state.handlers.size).toBe(1);

    for (let i = 0; i < 10; i += 1) {
      await act(async () => {
        useDocumentStore.getState().updateDocumentContent("doc-a", `edit ${i}`);
      });
    }
    await tick();

    expect(fake.state.subscribeCount).toBe(1);
    expect(fake.state.handlers.size).toBe(1);
    view.unmount();
  });

  it("removes its handler on unmount", async () => {
    const view = mountGuard();
    await tick();
    expect(fake.state.handlers.size).toBe(1);

    view.unmount();
    await tick();
    expect(fake.state.handlers.size).toBe(0);
  });
});

describe("WI-6 R3 — close behaviour is unchanged", () => {
  it("a dirty window is prevented from closing and raises the prompt", async () => {
    seed([doc("doc-a", "/tmp/a.md", true)], "doc-a");
    const { result } = mountGuard();
    await tick();

    const preventDefault = await requestClose();

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(result.current.pendingClose).toBe("window");
    expect(fake.state.closeCount).toBe(0);
    expect(geometryCalls()).toHaveLength(0);
    expect(logEventSync.mock.calls.map(([entry]) => entry.event)).toContain(
      "window.close_requested",
    );
  });

  it("a clean window saves its state and closes, without prompting", async () => {
    const { result } = mountGuard();
    await tick();

    const preventDefault = await requestClose();

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(result.current.pendingClose).toBeNull();
    expect(fake.state.closeCount).toBe(1);
    expect(geometryCalls()).toHaveLength(1);
    expect(logEventSync.mock.calls.map(([entry]) => entry.event)).toContain(
      "window.close_requested",
    );
  });

  it("a latched allow passes straight through and consumes the latch", async () => {
    seed([doc("doc-a", "/tmp/a.md", true)], "doc-a");
    const { result } = mountGuard();
    await tick();

    // The user confirmed Discard: the guard latches, saves state and closes.
    await act(async () => {
      await result.current.confirmClose();
    });
    expect(fake.state.closeCount).toBe(1);
    expect(result.current.pendingClose).toBeNull();

    // The OS then re-issues the close request — it must go through untouched.
    const preventDefault = await requestClose();
    expect(preventDefault).not.toHaveBeenCalled();

    // …and the latch is spent, so the next request prompts again rather than
    // letting a second (leaked) handler close a dirty window silently.
    const second = await requestClose();
    expect(second).toHaveBeenCalledTimes(1);
    expect(result.current.pendingClose).toBe("window");
  });

  it("cancelling the prompt clears it and leaves the window open", async () => {
    seed([doc("doc-a", "/tmp/a.md", true)], "doc-a");
    const { result } = mountGuard();
    await tick();

    await requestClose();
    expect(result.current.pendingClose).toBe("window");

    act(() => {
      result.current.cancelClose();
    });

    expect(result.current.pendingClose).toBeNull();
    expect(fake.state.closeCount).toBe(0);
  });
});

describe("WI-6 R4 — (Rev 1) geometry is keyed to the document active at close time", () => {
  it("saves the geometry of the tab switched to after the listener subscribed", async () => {
    seed([doc("doc-a", "/tmp/a.md"), doc("doc-b", "/tmp/b.md")], "doc-a");
    const view = mountGuard();
    await tick();
    expect(fake.state.subscribeCount).toBe(1);

    // Switch tabs through the store. `documents` is untouched, so the host does
    // not re-render and the listener has no chance to re-subscribe.
    act(() => {
      useDocumentStore.getState().setActiveDocumentId("doc-b");
    });
    await tick();

    await requestClose();

    const calls = geometryCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({
      filePath: "/tmp/b.md",
      geometry: { x: 11, y: 22, width: 1024, height: 768 },
    });
    expect(fake.state.subscribeCount).toBe(1);
    expect(fake.state.handlers.size).toBe(1);
    view.unmount();
  });

  it("writes no per-file geometry for an untitled document", async () => {
    seed([doc("doc-a", null)], "doc-a");
    const view = mountGuard();
    await tick();

    await requestClose();

    expect(geometryCalls()).toHaveLength(0);
    expect(fake.state.closeCount).toBe(1);
    view.unmount();
  });
});
