/**
 * D253-WI-2c (ADR-0112, merged review) — one active close attempt, and Discard
 * consent that covers exactly what the prompt showed.
 *
 * Laws:
 * - **Attempt generation.** Every new close request (an OS close or
 *   `requestWindowClose`) and every `cancelClose` supersedes the attempt in
 *   flight. A continuation that resumes after an await of a superseded attempt
 *   does nothing: no latch, no close, no prompt. So overlapping requests close
 *   the window exactly once.
 * - **Discard consent.** Discard lets the close through only while the dirty set
 *   is a subset of the one shown, with unchanged content. A document that is new
 *   or changed since the prompt prompts again (`dirty_after_discard`), and the
 *   window stays open.
 * Regression guards: a clean close closes exactly once; Discard over an
 * unchanged dirty set closes exactly once.
 *
 * The fake window models Tauri v2 (`window.js` ~2028): `close()` emits
 * CloseRequested to the handler and destroys (counted in `destroyCount`) unless
 * the handler prevented it. `scaleFactor()` — the first await of the state save —
 * and the guard's own re-entry `close()` can be held by gates that release every
 * waiter. Mocked boundaries: `@tauri-apps/api/{window,core}`, the logging sink.
 * Stores, `dataLossGuards`, the save body and the guard are real. The dirty
 * document is injected as MCP `create_document` does it (`upsertDocument`).
 * Paired real path: the D253 device check.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const { fake, gates, logEventSync } = vi.hoisted(() => {
  type CloseHandler = (event: { preventDefault: () => void }) => unknown;
  type Gate = { hold: boolean; waiting: number; entered: number; release: () => void; wait: () => Promise<void> };
  const makeGate = (): Gate => {
    const resolvers: Array<() => void> = [];
    const gate: Gate = {
      hold: false,
      waiting: 0,
      entered: 0,
      release: () => {
        gate.hold = false;
        for (const r of resolvers.splice(0)) r();
        gate.waiting = 0;
      },
      wait: () => {
        gate.entered += 1;
        if (!gate.hold) return Promise.resolve();
        gate.waiting += 1;
        return new Promise<void>((r) => resolvers.push(r));
      },
    };
    return gate;
  };
  const state = { label: "doc-1", handlers: new Set<CloseHandler>(), closeCalls: 0, destroyCount: 0, reentries: 0 };
  const gates = { save: makeGate(), reentry: makeGate() };
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
        if (!prevented) state.destroyCount += 1;
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
  /** The guard's re-entry close, held by `gates.reentry` when the test asks. */
  const guardClose = async () => {
    state.reentries += 1;
    await gates.reentry.wait();
    await win.close();
  };
  return {
    fake: {
      state,
      win,
      guardClose,
      reset() {
        state.label = "doc-1";
        state.handlers.clear();
        state.closeCalls = 0;
        state.destroyCount = 0;
        state.reentries = 0;
        gates.save = makeGate();
        gates.reentry = makeGate();
      },
    },
    gates,
    logEventSync: vi.fn(),
  };
});

// The hook holds the window from `getCurrentWindow()`; every `close()` it makes
// after the first pass is its re-entry, so route those through the gate.
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    get label() {
      return fake.win.label;
    },
    onCloseRequested: fake.win.onCloseRequested,
    close: () => fake.guardClose(),
    scaleFactor: fake.win.scaleFactor,
    innerSize: fake.win.innerSize,
    outerPosition: fake.win.outerPosition,
    isMaximized: fake.win.isMaximized,
  }),
}));
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

async function until(cond: () => boolean) {
  for (let i = 0; i < 50 && !cond(); i += 1) await settle();
  expect(cond()).toBe(true);
}

async function mount(documents: Document[]) {
  useDocumentStore.setState({ documents, activeDocumentId: documents[0]?.id ?? null });
  const view = renderHook(() => useWindowCloseGuard());
  await settle();
  return view;
}

/** An OS close request (the red button): Tauri emits CloseRequested. */
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

describe("one active close attempt", () => {
  it("two overlapping requestWindowClose calls close the window exactly once", async () => {
    const view = await mount([]);
    gates.save.hold = true;
    // The second request starts once the first is parked in the save: two
    // simultaneous first-time `import()`s of the mocked window module race
    // vitest's mocker and get the real module, a harness artefact.
    await act(async () => {
      void view.result.current.requestWindowClose("last_tab_closed");
    });
    await until(() => gates.save.waiting === 1);
    await act(async () => {
      void view.result.current.requestWindowClose("last_tab_closed");
    });
    await until(() => gates.save.waiting === 2);

    await act(async () => {
      gates.save.release();
    });
    await settle();

    expect(fake.state.destroyCount).toBe(1);
    expect(fake.state.reentries).toBe(1 + 2); // two requests, one re-entry
    expect(view.result.current.pendingClose).toBeNull();
  });

  it("two overlapping OS close requests close the window exactly once", async () => {
    const view = await mount([doc("a")]);
    gates.save.hold = true;
    await act(async () => {
      void fake.win.close();
    });
    await until(() => gates.save.waiting === 1);
    await act(async () => {
      void fake.win.close();
    });
    await until(() => gates.save.waiting === 2);

    await act(async () => {
      gates.save.release();
    });
    await settle();

    expect(fake.state.destroyCount).toBe(1);
    expect(fake.state.reentries).toBe(1);
    expect(view.result.current.pendingClose).toBeNull();
  });

  it("cancelClose, then the stale continuation wakes: no latch, no close, no prompt", async () => {
    const view = await mount([doc("a")]);
    gates.save.hold = true;
    await act(async () => {
      void fake.win.close();
    });
    await until(() => gates.save.waiting === 1);

    act(() => {
      view.result.current.cancelClose();
    });
    await act(async () => {
      gates.save.release();
    });
    await settle();

    expect(fake.state.reentries).toBe(0);
    expect(fake.state.destroyCount).toBe(0);
    expect(view.result.current.pendingClose).toBeNull();

    // No latch was left behind: a later dirty close still prompts.
    act(() => {
      useDocumentStore.getState().upsertDocument(doc("b", true));
    });
    await osClose();
    expect(fake.state.destroyCount).toBe(0);
    expect(view.result.current.pendingClose).toBe("window");
  });
});

describe("Discard consent covers exactly the prompted documents", () => {
  async function promptOn(documents: Document[]) {
    const view = await mount(documents);
    await osClose();
    expect(view.result.current.pendingClose).toBe("window");
    return view;
  }

  it("a new dirty document arriving during Discard's save prompts again, no close", async () => {
    const view = await promptOn([doc("a", true)]);
    gates.save.hold = true;
    let confirming: Promise<void> = Promise.resolve();
    await act(async () => {
      confirming = view.result.current.confirmClose();
    });
    await until(() => gates.save.waiting === 1);

    act(() => {
      useDocumentStore.getState().upsertDocument(doc("mcp", true));
    });
    await act(async () => {
      gates.save.release();
      await confirming;
    });
    await settle();

    expect(fake.state.destroyCount).toBe(0);
    expect(view.result.current.pendingClose).toBe("window");
    expect(actionLines("dirty_after_discard")).toHaveLength(1);
    expect(actionLines("dirty_after_discard")[0].context).toEqual({ windowLabel: "doc-1", action: "dirty_after_discard" });
  });

  it("a prompted document whose content changes between the latch and re-entry prompts again, no close", async () => {
    const view = await promptOn([doc("a", true, "shown")]);
    gates.reentry.hold = true;
    await act(async () => {
      void view.result.current.confirmClose();
    });
    await until(() => gates.reentry.waiting === 1);

    act(() => {
      useDocumentStore.getState().updateDocumentContent("a", "typed after the prompt");
    });
    await act(async () => {
      gates.reentry.release();
    });
    await settle();

    expect(fake.state.destroyCount).toBe(0);
    expect(view.result.current.pendingClose).toBe("window");
    expect(actionLines("dirty_after_discard")).toHaveLength(1);
  });

  it("regression: Discard over an unchanged dirty set closes exactly once", async () => {
    const view = await promptOn([doc("a", true), doc("b", true), doc("c")]);
    await act(async () => {
      await view.result.current.confirmClose();
    });
    await settle();

    expect(fake.state.destroyCount).toBe(1);
    expect(view.result.current.pendingClose).toBeNull();
  });

  it("regression: Discard still closes when a prompted document was saved meanwhile (a subset)", async () => {
    const view = await promptOn([doc("a", true), doc("b", true)]);
    act(() => {
      useDocumentStore.getState().markDocumentModified("b", false);
    });
    await act(async () => {
      await view.result.current.confirmClose();
    });
    await settle();

    expect(fake.state.destroyCount).toBe(1);
  });
});

describe("regression: a clean close", () => {
  it("closes exactly once, with no prompt", async () => {
    const view = await mount([doc("a")]);
    await osClose();
    expect(fake.state.destroyCount).toBe(1);
    expect(fake.state.reentries).toBe(1);
    expect(view.result.current.pendingClose).toBeNull();
  });
});
