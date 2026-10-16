/**
 * D253-WI-2b (ADR-0112, review hardening) — emptiness and cleanliness are
 * re-checked after every await on the way to a window close.
 *
 * Law: the window never closes, and the allow latch is never set, while a
 * dirty document is open in it at the moment the close commits. A document
 * that turns dirty (or arrives dirty) during `saveWindowState` makes the guard
 * prompt instead (`pendingClose: "window"`, logged `dirty_after_state_save`);
 * a document that arrives during a caller's close await, or before
 * `requestWindowClose("last_tab_closed")` reaches `close()`, means no close.
 * Latch provenance: only an explicit Discard (`confirmClose`) lets a close
 * through over dirty documents. A latch set by the clean save-and-close path is
 * re-decided on re-entry; if anything is dirty by then, the guard prompts and
 * clears the latch. The dirty document is injected as MCP `create_document`
 * does it, through `useDocumentStore.upsertDocument`.
 *
 * Mocked boundaries: `@tauri-apps/api/{window,core,event}` and the
 * `loggingService` sink. `scaleFactor()` — the first await of the state save —
 * and `close_document` can be held open by a gate so the test can change the
 * store in the middle. The fake window models Tauri v2's `close()` →
 * CloseRequested → destroy-unless-prevented. Stores, `dataLossGuards`, the save
 * body, `useDocument`, the guard and `lastTabClose` are real.
 * Paired real path: the D253 device check.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const { fake, gates, logEventSync } = vi.hoisted(() => {
  type CloseHandler = (event: { preventDefault: () => void }) => unknown;
  type Gate = { hold: boolean; entered: boolean; release: () => void; wait: () => Promise<void> };
  const makeGate = (): Gate => {
    let resolve: () => void = () => {};
    const gate: Gate = {
      hold: false,
      entered: false,
      release: () => resolve(),
      wait: () => {
        gate.entered = true;
        if (!gate.hold) return Promise.resolve();
        return new Promise<void>((r) => {
          resolve = r;
        });
      },
    };
    return gate;
  };
  const state = { label: "doc-1", handlers: new Set<CloseHandler>(), closeCalls: 0, destroyed: false };
  const gates = { save: makeGate(), closeDocument: makeGate(), reentry: makeGate() };
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
      // The guard's own re-entry (`void close()` after the latch) can be held.
      if (state.closeCalls >= 2) await gates.reentry.wait();
      for (const handler of [...state.handlers]) {
        let prevented = false;
        await handler({ preventDefault: () => (prevented = true) });
        if (!prevented) state.destroyed = true;
      }
    },
    scaleFactor: async () => {
      await gates.save.wait();
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
        gates.save = makeGate();
        gates.closeDocument = makeGate();
        gates.reentry = makeGate();
      },
    },
    gates,
    logEventSync: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => fake.win }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "close_document") {
      await gates.closeDocument.wait();
      return { success: true, documentId: args?.documentId };
    }
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
import { closeWindowIfLastTabClosed } from "../src/utils/lastTabClose";

type LogLine = { event?: string; status?: string; context?: Record<string, unknown> };
const closeLines = (): LogLine[] =>
  logEventSync.mock.calls.map((c) => c[0] as LogLine).filter((l) => l.event === "window.close_requested");

function doc(id: string, isModified = false): Document {
  return { id, path: `/tmp/${id}.md`, content: "x", encoding: "UTF-8", lineEnding: "lf", isModified, lastSaved: null, fileSize: 1 };
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function until(cond: () => boolean) {
  for (let i = 0; i < 50 && !cond(); i += 1) await settle();
  expect(cond()).toBe(true);
}

async function mount(documents: Document[]) {
  useDocumentStore.setState({ documents, activeDocumentId: documents[0]?.id ?? null });
  const view = renderHook(() => ({ document: useDocument(), guard: useWindowCloseGuard() }));
  await settle();
  return view;
}

/** An OS close (red button) after the race: a set latch would let it straight through. */
async function osClose() {
  await act(async () => {
    await fake.win.close();
  });
  await settle();
}

beforeEach(() => {
  fake.reset();
  logEventSync.mockReset();
  useMilkdownEditorStore.setState({ flushers: {} });
  useEditorStore.setState({ editorView: null });
});

describe("the guard re-decides after the state save", () => {
  it("a document turning dirty during saveWindowState of an OS close prompts instead of closing, with no latch", async () => {
    const view = await mount([doc("a")]);
    gates.save.hold = true;
    let closing: Promise<void> = Promise.resolve();
    await act(async () => {
      closing = fake.win.close();
    });
    await until(() => gates.save.entered);

    act(() => {
      useDocumentStore.getState().markDocumentModified("a", true);
    });
    await act(async () => {
      gates.save.release();
      await closing;
    });
    await settle();

    expect(fake.state.destroyed).toBe(false);
    expect(view.result.current.guard.pendingClose).toBe("window");
    expect(closeLines().filter((l) => l.context?.action === "dirty_after_state_save")).toHaveLength(1);

    await osClose();
    expect(fake.state.destroyed).toBe(false);
  });

  it("a dirty document upserted during saveWindowState of a last-tab close prompts, with no latch", async () => {
    const view = await mount([]);
    gates.save.hold = true;
    let closing: Promise<void> = Promise.resolve();
    await act(async () => {
      closing = view.result.current.guard.requestWindowClose("last_tab_closed");
    });
    await until(() => gates.save.entered);

    act(() => {
      useDocumentStore.getState().upsertDocument(doc("mcp", true));
    });
    await act(async () => {
      gates.save.release();
      await closing;
    });
    await settle();

    expect(fake.state.destroyed).toBe(false);
    expect(view.result.current.guard.pendingClose).toBe("window");
    const dirty = closeLines().filter((l) => l.context?.action === "dirty_after_state_save");
    expect(dirty).toHaveLength(1);
    expect(dirty[0].context).toEqual({ windowLabel: "doc-1", action: "dirty_after_state_save" });

    await osClose();
    expect(fake.state.destroyed).toBe(false);
  });

  it("a clean save with nothing arriving still closes (the re-check does not over-prompt)", async () => {
    const view = await mount([]);
    await act(async () => {
      await view.result.current.guard.requestWindowClose("last_tab_closed");
    });
    await settle();
    expect(fake.state.destroyed).toBe(true);
    expect(view.result.current.guard.pendingClose).toBeNull();
  });
});

describe("latch provenance: only a Discard overrides a dirty document", () => {
  it("a dirty document arriving after the clean-save latch, before re-entry, prompts and clears the latch", async () => {
    const view = await mount([]);
    gates.reentry.hold = true;
    await act(async () => {
      await view.result.current.guard.requestWindowClose("last_tab_closed");
    });
    await until(() => gates.reentry.entered);

    act(() => {
      useDocumentStore.getState().upsertDocument(doc("mcp", true));
    });
    await act(async () => {
      gates.reentry.release();
    });
    await settle();

    expect(fake.state.destroyed).toBe(false);
    expect(view.result.current.guard.pendingClose).toBe("window");
    const dirty = closeLines().filter((l) => l.context?.action === "dirty_after_state_save");
    expect(dirty).toHaveLength(1);
    expect(dirty[0].context).toEqual({ windowLabel: "doc-1", action: "dirty_after_state_save" });

    // Latch cleared: the next OS close is decided afresh and does not pass through.
    // (Harness fix, added after the red: `wait` reads the original gate's `hold`,
    // so the copy below alone would leave the next close parked forever.)
    gates.reentry.hold = false;
    gates.reentry = { ...gates.reentry, hold: false };
    await osClose();
    expect(fake.state.destroyed).toBe(false);
  });

  it("a Discard latch still closes a window with dirty documents (regression guard)", async () => {
    const view = await mount([doc("a", true)]);
    await osClose();
    expect(view.result.current.guard.pendingClose).toBe("window");
    expect(fake.state.destroyed).toBe(false);

    await act(async () => {
      await view.result.current.guard.confirmClose();
    });
    await settle();

    expect(fake.state.destroyed).toBe(true);
    expect(view.result.current.guard.pendingClose).toBeNull();
  });
});

describe("emptiness is re-read after every await", () => {
  it("requestWindowClose('last_tab_closed') on a window that is no longer empty does not close it", async () => {
    const view = await mount([doc("late")]);
    await act(async () => {
      await view.result.current.guard.requestWindowClose("last_tab_closed");
    });
    await settle();

    expect(fake.state.closeCalls).toBe(0);
    expect(fake.state.destroyed).toBe(false);
    expect(closeLines()).toEqual([
      expect.objectContaining({ status: "cancel", context: { windowLabel: "doc-1", action: "last_tab_closed", outcome: "not_empty" } }),
    ]);
  });

  it("a document added during closeActiveDocument's await means no close request", async () => {
    const view = await mount([doc("a")]);
    gates.closeDocument.hold = true;
    let closing: Promise<unknown> = Promise.resolve();
    await act(async () => {
      closing = view.result.current.document.closeActiveDocument(true).then(() =>
        closeWindowIfLastTabClosed({ requestWindowClose: view.result.current.guard.requestWindowClose, quitInProgress: false }),
      );
    });
    await until(() => gates.closeDocument.entered);

    act(() => {
      useDocumentStore.getState().upsertDocument(doc("opened"));
    });
    await act(async () => {
      gates.closeDocument.release();
      await closing;
    });
    await settle();

    expect(useDocumentStore.getState().documents.map((d) => d.id)).toEqual(["opened"]);
    expect(fake.state.closeCalls).toBe(0);
    expect(fake.state.destroyed).toBe(false);
  });
});
