/**
 * D253-WI-6 (audit b180, H2) — a second close request while the window prompt is
 * up must not widen what Discard consents to.
 *
 * Law: Discard covers only the documents dirty when the prompt on screen was
 * raised. A document dirtied after that (an MCP create, or a write into a clean
 * document) is never covered, however many close requests arrive while the
 * prompt is up: the latched Discard pass prompts again (`dirty_after_discard`)
 * and the window stays open. Regression guard: a repeat request with nothing
 * new still lets Discard close the window once.
 *
 * The fake window models Tauri v2 (`window.js` ~2028): `close()` emits
 * CloseRequested to the handler and destroys (`destroyCount`) unless the handler
 * prevented it. Mocked boundaries: `@tauri-apps/api/{window,core}` and the
 * logging sink. Stores, `dataLossGuards`, the save body and the guard are real.
 * Paired real path: the D253 device check.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const { fake, logEventSync } = vi.hoisted(() => {
  type CloseHandler = (event: { preventDefault: () => void }) => unknown;
  const state = { handlers: new Set<CloseHandler>(), closeCalls: 0, destroyCount: 0 };
  const win = {
    label: "doc-1",
    onCloseRequested(handler: CloseHandler): Promise<() => void> {
      state.handlers.add(handler);
      return Promise.resolve(() => {
        state.handlers.delete(handler);
      });
    },
    async close(): Promise<void> {
      state.closeCalls += 1;
      for (const handler of [...state.handlers]) {
        let prevented = false;
        await handler({ preventDefault: () => (prevented = true) });
        if (!prevented) state.destroyCount += 1;
      }
    },
    scaleFactor: async () => 1,
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
        state.closeCalls = 0;
        state.destroyCount = 0;
      },
    },
    logEventSync: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => fake.win }));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async () => null),
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
const actionLines = (action: string): LogLine[] =>
  logEventSync.mock.calls
    .map((c) => c[0] as LogLine)
    .filter((l) => l.event === "window.close_requested" && l.context?.action === action);

function doc(id: string, isModified = false, content = "x"): Document {
  return { id, path: `/tmp/${id}.md`, content, encoding: "UTF-8", lineEnding: "lf", isModified, lastSaved: null, fileSize: 1 };
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(documents: Document[]) {
  useDocumentStore.setState({ documents, activeDocumentId: documents[0]?.id ?? null });
  const view = renderHook(() => useWindowCloseGuard());
  await settle();
  return view;
}

/** An OS close request (the red button, or ⌘Q's per-window close): CloseRequested. */
async function osClose() {
  await act(async () => {
    await fake.win.close();
  });
  await settle();
}

async function discard(view: Awaited<ReturnType<typeof mount>>) {
  await act(async () => {
    await view.result.current.confirmClose();
  });
  await settle();
}

beforeEach(() => {
  fake.reset();
  logEventSync.mockReset();
  useMilkdownEditorStore.setState({ flushers: {} });
  useEditorStore.setState({ editorView: null });
});

describe("a second close request during the prompt does not widen Discard's consent", () => {
  it("B created dirty (MCP create shape) after the prompt, then a second request: Discard prompts again, no close", async () => {
    const view = await mount([doc("a", true, "shown")]);
    await osClose();
    expect(view.result.current.pendingClose).toBe("window");

    act(() => {
      useDocumentStore.getState().upsertDocument(doc("b", true, "written by MCP"));
    });
    await osClose(); // the second request, while the prompt is still up
    expect(view.result.current.pendingClose).toBe("window");

    await discard(view);

    expect(fake.state.destroyCount).toBe(0);
    expect(view.result.current.pendingClose).toBe("window");
    expect(actionLines("dirty_after_discard")).toHaveLength(1);
    expect(actionLines("dirty_after_discard")[0].context).toEqual({ windowLabel: "doc-1", action: "dirty_after_discard" });
  });

  it("a clean B written to after the prompt, then a second request: Discard prompts again, no close", async () => {
    const view = await mount([doc("a", true, "shown"), doc("b", false, "clean")]);
    await osClose();
    expect(view.result.current.pendingClose).toBe("window");

    act(() => {
      useDocumentStore.getState().updateDocumentContent("b", "written after the prompt");
      useDocumentStore.getState().markDocumentModified("b", true);
    });
    await osClose();
    expect(view.result.current.pendingClose).toBe("window");

    await discard(view);

    expect(fake.state.destroyCount).toBe(0);
    expect(view.result.current.pendingClose).toBe("window");
    expect(actionLines("dirty_after_discard")).toHaveLength(1);
  });

  it("regression: a repeat request with nothing new still lets Discard close once", async () => {
    const view = await mount([doc("a", true, "shown"), doc("b", false, "clean")]);
    await osClose();
    await osClose();
    expect(view.result.current.pendingClose).toBe("window");

    await discard(view);

    expect(fake.state.destroyCount).toBe(1);
    expect(view.result.current.pendingClose).toBeNull();
    expect(actionLines("dirty_after_discard")).toHaveLength(0);
  });
});
