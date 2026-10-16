/**
 * D253-WI-3 (ADR-0112) — a user close that empties a secondary window closes it.
 *
 * Law: after a user close resolves, the window is asked to close exactly when
 * its label is not "main", no document is left and no quit is in progress; the
 * request then goes through the close guard (save state, close; or prompt).
 *
 * Rendering `App` in jsdom is impractical (see `app-open-route-wiring.test.ts`),
 * so the three user-close paths are composed here exactly as `src/App.tsx`
 * composes them: ⌘W / File → Close is `decideCloseRequest(activeDocumentAfterFlush())`
 * then `closeActiveDocument(true)` or the "document" prompt, or "noop" when no
 * document is active; the dialog's Discard is `closeActiveDocument(true)`; the
 * tab × is `closeDocumentById(id, true)`. Each is followed by
 * `closeWindowIfLastTabClosed`. That App really is wired this way is pinned as
 * source text by `d253-app-last-tab-wiring.test.ts`.
 *
 * Real: `useDocument`, `useWindowCloseGuard`, the stores, `dataLossGuards`,
 * `lastTabClose`. Mocked boundaries: `@tauri-apps/api/{window,core,event}` and
 * the `loggingService` sink. The fake window models Tauri v2's `close()` →
 * CloseRequested → destroy-unless-prevented (as in `d253-request-window-close`).
 * Paired real path: the D253 device check.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const { fake, logEventSync } = vi.hoisted(() => {
  type CloseHandler = (event: { preventDefault: () => void }) => unknown;
  const state = { label: "doc-1", handlers: new Set<CloseHandler>(), closeCalls: 0, destroyed: false };
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
    async close(): Promise<void> {
      state.closeCalls += 1;
      for (const handler of [...state.handlers]) {
        let prevented = false;
        await handler({ preventDefault: () => (prevented = true) });
        if (!prevented) state.destroyed = true;
      }
    },
    scaleFactor: async () => 1,
    innerSize: async () => ({ width: 1024, height: 768 }),
    outerPosition: async () => ({ x: 11, y: 22 }),
    isMaximized: async () => false,
    setTitle: async () => {},
  };
  return {
    fake: {
      state,
      win,
      reset(label: string) {
        state.label = label;
        state.handlers.clear();
        state.closeCalls = 0;
        state.destroyed = false;
      },
    },
    logEventSync: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => fake.win }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "close_document") return { success: true, documentId: args?.documentId };
    return null;
  }),
}));
vi.mock("../src/services/loggingService", () => ({
  loggingService: { logEventSync, logEvent: vi.fn(async () => {}), generateActionId: vi.fn(() => "test-id") },
}));

import { useDocument } from "../src/hooks/useDocument";
import { useWindowCloseGuard } from "../src/hooks/useWindowCloseGuard";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import type { Document } from "../src/types/document";
import { activeDocumentAfterFlush, decideCloseRequest } from "../src/utils/dataLossGuards";
import { closeWindowIfLastTabClosed } from "../src/utils/lastTabClose";

function doc(id: string, isModified = false): Document {
  return { id, path: `/tmp/${id}.md`, content: "x", encoding: "UTF-8", lineEnding: "lf", isModified, lastSaved: null, fileSize: 1 };
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Mount the App-side pieces for a window with this label and these documents. */
async function mountWindow(label: string, documents: Document[], quitInProgress = false) {
  fake.reset(label);
  useDocumentStore.setState({ documents, activeDocumentId: documents[0]?.id ?? null });
  const view = renderHook(() => ({ document: useDocument(), guard: useWindowCloseGuard() }));
  await settle();
  let promptOpen = false;

  const afterUserClose = () =>
    closeWindowIfLastTabClosed({
      requestWindowClose: view.result.current.guard.requestWindowClose,
      quitInProgress,
    });

  return {
    view,
    get promptOpen() {
      return promptOpen;
    },
    /** App.handleCloseRequest (⌘W, File → Close). */
    async cmdW() {
      await act(async () => {
        const decision = decideCloseRequest(activeDocumentAfterFlush());
        if (decision === "prompt") promptOpen = true;
        else if (decision === "close") await view.result.current.document.closeActiveDocument(true).then(afterUserClose);
        else await afterUserClose();
      });
      await settle();
    },
    /** App.handleConfirmClose, target "document" (Discard). */
    async discard() {
      promptOpen = false;
      await act(async () => {
        await view.result.current.document.closeActiveDocument(true);
        await afterUserClose();
      });
      await settle();
    },
    /** App.handleCancelClose (Keep editing). */
    keepEditing() {
      promptOpen = false;
    },
    /** BottomTabs × → App's onClose. */
    async tabX(id: string) {
      await act(async () => {
        await view.result.current.document.closeDocumentById(id, true).then(afterUserClose);
      });
      await settle();
    },
  };
}

const remaining = () => useDocumentStore.getState().documents.length;

beforeEach(() => {
  logEventSync.mockReset();
  useMilkdownEditorStore.setState({ flushers: {} });
  useEditorStore.setState({ editorView: null });
});

describe("closing the last tab of a secondary window", () => {
  it("⌘W on the last clean tab of doc-1 closes the window through the guard", async () => {
    const w = await mountWindow("doc-1", [doc("a")]);
    await w.cmdW();
    expect(remaining()).toBe(0);
    expect(fake.state.closeCalls).toBeGreaterThanOrEqual(1);
    expect(fake.state.destroyed).toBe(true);
  });

  it("⌘W on the last tab of main leaves the empty state and requests nothing", async () => {
    const w = await mountWindow("main", [doc("a")]);
    await w.cmdW();
    expect(remaining()).toBe(0);
    expect(fake.state.closeCalls).toBe(0);
    expect(fake.state.destroyed).toBe(false);
  });

  it("closing a tab that is not the last requests nothing", async () => {
    const w = await mountWindow("doc-1", [doc("a"), doc("b")]);
    await w.cmdW();
    expect(remaining()).toBe(1);
    expect(fake.state.closeCalls).toBe(0);
  });

  it("the tab × on the last tab of doc-1 closes the window", async () => {
    const w = await mountWindow("doc-1", [doc("a")]);
    await w.tabX("a");
    expect(remaining()).toBe(0);
    expect(fake.state.destroyed).toBe(true);
  });

  it("the tab × on a tab that is not the last requests nothing", async () => {
    const w = await mountWindow("doc-1", [doc("a"), doc("b")]);
    await w.tabX("b");
    expect(remaining()).toBe(1);
    expect(fake.state.closeCalls).toBe(0);
  });

  it("dirty last tab: Discard closes the tab, then the window", async () => {
    const w = await mountWindow("doc-1", [doc("a", true)]);
    await w.cmdW();
    expect(w.promptOpen).toBe(true);
    expect(fake.state.closeCalls).toBe(0);
    await w.discard();
    expect(remaining()).toBe(0);
    expect(fake.state.destroyed).toBe(true);
  });

  it("dirty last tab: Keep editing closes nothing", async () => {
    const w = await mountWindow("doc-1", [doc("a", true)]);
    await w.cmdW();
    w.keepEditing();
    await settle();
    expect(remaining()).toBe(1);
    expect(fake.state.closeCalls).toBe(0);
    expect(fake.state.destroyed).toBe(false);
  });

  it("⌘W on an already-empty doc-1 closes it", async () => {
    const w = await mountWindow("doc-1", []);
    await w.cmdW();
    expect(fake.state.destroyed).toBe(true);
  });

  it("⌘W on an already-empty main does nothing", async () => {
    const w = await mountWindow("main", []);
    await w.cmdW();
    expect(fake.state.closeCalls).toBe(0);
    expect(fake.state.destroyed).toBe(false);
  });

  it("while a quit is in progress, emptying doc-1 requests no close", async () => {
    const w = await mountWindow("doc-1", [doc("a")], true);
    await w.cmdW();
    expect(remaining()).toBe(0);
    expect(fake.state.closeCalls).toBe(0);
  });

  it("returns the decision it acted on", async () => {
    await mountWindow("doc-1", []);
    const requestWindowClose = vi.fn(async () => {});
    await expect(closeWindowIfLastTabClosed({ requestWindowClose, quitInProgress: false })).resolves.toBe("close-window");
    await expect(closeWindowIfLastTabClosed({ requestWindowClose, quitInProgress: true })).resolves.toBe("keep");
    expect(requestWindowClose.mock.calls).toEqual([["last_tab_closed"]]);
  });
});
