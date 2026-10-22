/** D294: close consent precedes native staging, and superseded staging never hides a prompt. */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fake, invokeMock } = vi.hoisted(() => {
  type Handler = (event: { preventDefault: () => void }) => Promise<void> | void;
  const state = {
    label: "mdpro-a",
    handlers: new Set<Handler>(),
    trace: [] as string[],
    destroyed: false,
    closeCalls: 0,
    visible: true,
    holdAt: "none" as "none" | "hide" | "interval",
    releaseHide: (() => {}) as () => void,
    releaseInterval: (() => {}) as () => void,
    releaseIntervals: [] as Array<() => void>,
    holdFinal: false,
    rejectFinal: false,
    rejectStage: false,
    rejectRestore: false,
    holdFirstRestore: false,
    restoreCalls: 0,
    releaseRestore: (() => {}) as () => void,
    releaseFinal: (() => {}) as () => void,
    stageGeneration: 0,
  };
  const win = {
    get label() { return state.label; },
    onCloseRequested(handler: Handler) {
      state.handlers.add(handler);
      return Promise.resolve(() => state.handlers.delete(handler));
    },
    async close() {
      state.closeCalls += 1;
      state.trace.push("close");
      if (state.rejectFinal && state.closeCalls >= 2) throw new Error("close rejected");
      if (state.holdFinal && state.closeCalls >= 2) await new Promise<void>((resolve) => { state.releaseFinal = resolve; });
      for (const handler of [...state.handlers]) {
        let prevented = false;
        await handler({ preventDefault: () => { prevented = true; } });
        if (!prevented) {
          state.destroyed = true;
          state.trace.push("destroy");
        }
      }
    },
    scaleFactor: async () => { state.trace.push("save"); return 1; },
    innerSize: async () => ({ width: 1024, height: 768 }),
    outerPosition: async () => ({ x: 0, y: 0 }),
    isMaximized: async () => false,
  };
  const invokeMock = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command !== "window_close_order") return null;
    if (args?.operation === "restore") {
      state.restoreCalls += 1;
      if (state.holdFirstRestore && state.restoreCalls === 1) await new Promise<void>((resolve) => { state.releaseRestore = resolve; });
      if (state.rejectRestore) throw new Error("show rejected");
      state.stageGeneration += 1;
      state.visible = true;
      state.trace.push("show");
      return true;
    }
    const generation = ++state.stageGeneration;
    if (state.rejectStage) throw new Error("hide rejected");
    if (state.holdAt === "hide") await new Promise<void>((resolve) => { state.releaseHide = resolve; });
    state.visible = false;
    state.trace.push("hide");
    if (state.holdAt === "interval") await new Promise<void>((resolve) => { state.releaseInterval = resolve; state.releaseIntervals.push(resolve); });
    state.trace.push("interval");
    return generation === state.stageGeneration;
  });
  return { fake: { state, win }, invokeMock };
});

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => fake.win }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (command: string, args?: unknown) => invokeMock(command, args as Record<string, unknown> | undefined),
}));

import { useWindowCloseGuard } from "../src/hooks/useWindowCloseGuard";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import type { Document } from "../src/types/document";
import { closeWindowIfLastTabClosed } from "../src/utils/lastTabClose";

function doc(id: string, dirty: boolean): Document {
  return { id, path: `/tmp/${id}.md`, content: dirty ? "unsaved" : "saved", encoding: "UTF-8", lineEnding: "lf", isModified: dirty, lastSaved: null, fileSize: null };
}

function logged(event: string): Array<{ status: string; context: Record<string, unknown> }> {
  return invokeMock.mock.calls
    .filter(([command]) => command === "log_event")
    .map(([, args]) => args?.payload as { event: string; status: string; context: Record<string, unknown> })
    .filter((payload) => payload?.event === event);
}

async function settle() {
  await act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); });
}

async function mount() {
  const view = renderHook(() => useWindowCloseGuard());
  await settle();
  return view;
}

beforeEach(() => {
  Object.assign(fake.state, { label: "mdpro-a", trace: [], destroyed: false, closeCalls: 0, visible: true, holdAt: "none", releaseIntervals: [], holdFinal: false, rejectFinal: false, rejectStage: false, rejectRestore: false, holdFirstRestore: false, restoreCalls: 0, stageGeneration: 0 });
  fake.state.handlers.clear();
  invokeMock.mockClear();
  useLoggingStore.setState({ enabled: true, level: "info" });
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
  useEditorStore.setState({ editorView: null });
  useMilkdownEditorStore.setState({ flushers: {} });
});

describe("D294 native close ordering", () => {
  it("stages a clean secondary after state save and before final destruction", async () => {
    const view = await mount();
    await act(async () => { await view.result.current.requestWindowClose("last_tab_closed"); });
    await settle();
    expect(fake.state.trace).toEqual(["close", "save", "hide", "interval", "close", "destroy"]);
    expect(fake.state.destroyed).toBe(true);
  });

  it("keeps an unanswered dirty prompt visible without staging", async () => {
    useDocumentStore.setState({ documents: [doc("dirty", true)], activeDocumentId: "dirty" });
    const view = await mount();
    await act(async () => { await fake.win.close(); });
    expect({ visible: fake.state.visible, destroyed: fake.state.destroyed, pending: view.result.current.pendingClose }).toEqual({ visible: true, destroyed: false, pending: "window" });
    expect(fake.state.trace).toEqual(["close"]);
  });

  it("does not stage the main window", async () => {
    fake.state.label = "main";
    const view = await mount();
    await act(async () => { await fake.win.close(); });
    await settle();
    expect(fake.state.destroyed).toBe(true);
    expect(invokeMock.mock.calls.filter(([name]) => name === "window_close_order")).toHaveLength(0);
    expect(view.result.current.pendingClose).toBeNull();
  });

  for (const holdAt of ["hide", "interval"] as const) {
    it(`restores a superseded ${holdAt} before the newer dirty prompt remains open`, async () => {
      fake.state.holdAt = holdAt;
      const view = await mount();
      let closing!: Promise<void>;
      act(() => { closing = view.result.current.requestWindowClose("last_tab_closed"); });
      await settle();
      useDocumentStore.setState({ documents: [doc("new", true)], activeDocumentId: "new" });
      await act(async () => { await fake.win.close(); });
      await settle();
      await act(async () => { (holdAt === "hide" ? fake.state.releaseHide : fake.state.releaseInterval)(); await closing; });
      await settle();
      expect({ visible: fake.state.visible, destroyed: fake.state.destroyed, pending: view.result.current.pendingClose, content: useDocumentStore.getState().documents[0]?.content }).toEqual({ visible: true, destroyed: false, pending: "window", content: "unsaved" });
    });
  }

  it("preserves a clean tab opened while the last-tab close is staged", async () => {
    fake.state.holdAt = "interval";
    const view = await mount();
    let closing!: Promise<void>;
    act(() => { closing = view.result.current.requestWindowClose("last_tab_closed"); });
    await settle();
    useDocumentStore.setState({ documents: [doc("new", false)], activeDocumentId: "new" });
    await act(async () => { fake.state.releaseInterval(); await closing; });
    await settle();
    expect({ visible: fake.state.visible, destroyed: fake.state.destroyed, ids: useDocumentStore.getState().documents.map((d) => d.id) }).toEqual({ visible: true, destroyed: false, ids: ["new"] });
  });

  it("preserves a clean tab opened after staging but before final CloseRequested", async () => {
    fake.state.holdFinal = true;
    const view = await mount();
    let closing!: Promise<void>;
    act(() => { closing = view.result.current.requestWindowClose("last_tab_closed"); });
    await settle();
    expect(fake.state.trace).toContain("interval");
    useDocumentStore.setState({ documents: [doc("late", false)], activeDocumentId: "late" });
    await act(async () => { fake.state.releaseFinal(); await closing; });
    await settle();
    expect({ visible: fake.state.visible, destroyed: fake.state.destroyed, ids: useDocumentStore.getState().documents.map((d) => d.id) }).toEqual({ visible: true, destroyed: false, ids: ["late"] });
  });

  it("waits through pending resize work before requesting final close", async () => {
    fake.state.holdAt = "interval";
    const view = await mount();
    let closing!: Promise<void>;
    act(() => { closing = view.result.current.requestWindowClose("last_tab_closed"); });
    await settle();
    fake.state.trace.push("resize");
    expect(fake.state.destroyed).toBe(false);
    expect(fake.state.trace).toEqual(["close", "save", "hide", "resize"]);
    await act(async () => { fake.state.releaseInterval(); await closing; });
    await settle();
    expect(fake.state.trace).toEqual(["close", "save", "hide", "resize", "interval", "close", "destroy"]);
  });

  it("keeps the window visible when native hiding fails", async () => {
    fake.state.rejectStage = true;
    const view = await mount();
    await act(async () => { await view.result.current.requestWindowClose("last_tab_closed"); });
    await settle();
    expect({ visible: fake.state.visible, destroyed: fake.state.destroyed, closeCalls: fake.state.closeCalls }).toEqual({ visible: true, destroyed: false, closeCalls: 1 });
    expect(logged("window.close_requested")).toContainEqual(expect.objectContaining({ status: "fail", context: { windowLabel: "mdpro-a", action: "close_order_failed" } }));
  });

  it("restores visibility and clears consent after final close rejection", async () => {
    fake.state.rejectFinal = true;
    const view = await mount();
    await act(async () => { await view.result.current.requestWindowClose("last_tab_closed"); });
    await settle();
    expect({ visible: fake.state.visible, destroyed: fake.state.destroyed }).toEqual({ visible: true, destroyed: false });
    expect(logged("window.close_requested")).toContainEqual(expect.objectContaining({ status: "fail", context: { windowLabel: "mdpro-a", action: "close_rejected" } }));
    fake.state.rejectFinal = false;
    await act(async () => { await view.result.current.requestWindowClose("last_tab_closed"); });
    await settle();
    expect(fake.state.trace.filter((step) => step === "hide")).toHaveLength(2);
    expect(fake.state.destroyed).toBe(true);
  });

  it("stages a second secondary close in the same launch", async () => {
    const first = await mount();
    await act(async () => { await first.result.current.requestWindowClose("last_tab_closed"); });
    await settle();
    expect(fake.state.destroyed).toBe(true);
    first.unmount();
    fake.state.handlers.clear();
    Object.assign(fake.state, { label: "mdpro-b", trace: [], destroyed: false, closeCalls: 0, visible: true });
    const second = await mount();
    await act(async () => { await second.result.current.requestWindowClose("last_tab_closed"); });
    await settle();
    expect(fake.state.trace).toEqual(["close", "save", "hide", "interval", "close", "destroy"]);
    expect(fake.state.destroyed).toBe(true);
  });

  it("leaves a last-tab close to the quit guard while quit is pending", async () => {
    const view = await mount();
    await expect(closeWindowIfLastTabClosed({ requestWindowClose: view.result.current.requestWindowClose, quitInProgress: true })).resolves.toBe("keep");
    expect(fake.state.trace).toEqual([]);
    expect(fake.state.destroyed).toBe(false);
  });

  it("shows a new dirty prompt when work arrives after staging but before final re-entry", async () => {
    fake.state.holdFinal = true;
    const view = await mount();
    let closing!: Promise<void>;
    act(() => { closing = view.result.current.requestWindowClose("last_tab_closed"); });
    await settle();
    useDocumentStore.setState({ documents: [doc("late-dirty", true)], activeDocumentId: "late-dirty" });
    await act(async () => { fake.state.releaseFinal(); await closing; });
    await settle();
    expect({ visible: fake.state.visible, destroyed: fake.state.destroyed, pending: view.result.current.pendingClose, content: useDocumentStore.getState().documents[0]?.content }).toEqual({ visible: true, destroyed: false, pending: "window", content: "unsaved" });
  });

  it("does not resurrect a canceled newer prompt after an older veto waits for restore", async () => {
    fake.state.holdAt = "interval";
    fake.state.holdFirstRestore = true;
    const view = await mount();
    let closing!: Promise<void>;
    act(() => { closing = view.result.current.requestWindowClose("last_tab_closed"); });
    await settle();
    useDocumentStore.setState({ documents: [doc("new-dirty", true)], activeDocumentId: "new-dirty" });
    act(() => { fake.state.releaseInterval(); });
    await settle();
    expect(fake.state.restoreCalls).toBe(1);
    await act(async () => { await fake.win.close(); });
    expect(view.result.current.pendingClose).toBe("window");
    act(() => { view.result.current.cancelClose(); });
    await act(async () => { fake.state.releaseRestore(); await closing; });
    await settle();
    expect({ visible: fake.state.visible, destroyed: fake.state.destroyed, pending: view.result.current.pendingClose, content: useDocumentStore.getState().documents[0]?.content }).toEqual({ visible: true, destroyed: false, pending: null, content: "unsaved" });
  });

  it("prompts visibly when dirty work arrives during the interval without another close", async () => {
    fake.state.holdAt = "interval";
    const view = await mount();
    let closing!: Promise<void>;
    act(() => { closing = view.result.current.requestWindowClose("last_tab_closed"); });
    await settle();
    useDocumentStore.setState({ documents: [doc("late", true)], activeDocumentId: "late" });
    await act(async () => { fake.state.releaseInterval(); await closing; });
    await settle();
    expect({ visible: fake.state.visible, destroyed: fake.state.destroyed, pending: view.result.current.pendingClose }).toEqual({ visible: true, destroyed: false, pending: "window" });
  });

  it("lets only the newer of two clean staging attempts destroy", async () => {
    fake.state.holdAt = "interval";
    const view = await mount();
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => { first = view.result.current.requestWindowClose("last_tab_closed"); });
    await settle();
    act(() => { second = view.result.current.requestWindowClose("last_tab_closed"); });
    await settle();
    expect(fake.state.releaseIntervals).toHaveLength(2);
    await act(async () => { fake.state.releaseIntervals[0](); await first; });
    expect(fake.state.destroyed).toBe(false);
    await act(async () => { fake.state.releaseIntervals[1](); await second; });
    await settle();
    expect(fake.state.trace.filter((step) => step === "destroy")).toHaveLength(1);
  });

  it("retries the full native stage after a hide failure", async () => {
    fake.state.rejectStage = true;
    const view = await mount();
    await act(async () => { await view.result.current.requestWindowClose("last_tab_closed"); });
    await settle();
    expect(fake.state.destroyed).toBe(false);
    fake.state.rejectStage = false;
    await act(async () => { await view.result.current.requestWindowClose("last_tab_closed"); });
    await settle();
    expect(fake.state.trace.filter((step) => step === "hide")).toHaveLength(1);
    expect(fake.state.trace).toContain("interval");
    expect(fake.state.destroyed).toBe(true);
  });

  it("stages a Discard only after its dirty prompt is confirmed", async () => {
    useDocumentStore.setState({ documents: [doc("dirty", true)], activeDocumentId: "dirty" });
    const view = await mount();
    await act(async () => { await fake.win.close(); });
    expect(view.result.current.pendingClose).toBe("window");
    expect(fake.state.visible).toBe(true);
    await act(async () => { await view.result.current.confirmClose(); });
    await settle();
    expect(fake.state.trace).toEqual(["close", "save", "hide", "interval", "close", "destroy"]);
  });

  it("restores a changed Discard prompt at final re-entry", async () => {
    fake.state.holdFinal = true;
    useDocumentStore.setState({ documents: [doc("dirty", true)], activeDocumentId: "dirty" });
    const view = await mount();
    await act(async () => { await fake.win.close(); });
    let confirming!: Promise<void>;
    act(() => { confirming = view.result.current.confirmClose(); });
    await settle();
    useDocumentStore.setState({ documents: [{ ...doc("dirty", true), content: "changed" }], activeDocumentId: "dirty" });
    await act(async () => { fake.state.releaseFinal(); await confirming; });
    await settle();
    expect({ visible: fake.state.visible, destroyed: fake.state.destroyed, pending: view.result.current.pendingClose, content: useDocumentStore.getState().documents[0]?.content }).toEqual({ visible: true, destroyed: false, pending: "window", content: "changed" });
  });

  it("requires fresh Discard consent after a rejected final close and changed content", async () => {
    useDocumentStore.setState({ documents: [doc("dirty", true)], activeDocumentId: "dirty" });
    fake.state.rejectFinal = true;
    const view = await mount();
    await act(async () => { await fake.win.close(); });
    await act(async () => { await view.result.current.confirmClose(); });
    await settle();
    expect(fake.state.destroyed).toBe(false);
    useDocumentStore.setState({ documents: [{ ...doc("dirty", true), content: "changed" }], activeDocumentId: "dirty" });
    fake.state.rejectFinal = false;
    await act(async () => { await fake.win.close(); });
    expect(view.result.current.pendingClose).toBe("window");
    await act(async () => { await view.result.current.confirmClose(); });
    await settle();
    expect(fake.state.trace.filter((step) => step === "hide")).toHaveLength(2);
    expect(fake.state.trace.filter((step) => step === "destroy")).toHaveLength(1);
  });

  it("logs a native restore rejection and preserves dirty content without destruction", async () => {
    fake.state.holdAt = "interval";
    fake.state.rejectRestore = true;
    const view = await mount();
    let closing!: Promise<void>;
    act(() => { closing = view.result.current.requestWindowClose("last_tab_closed"); });
    await settle();
    useDocumentStore.setState({ documents: [doc("dirty", true)], activeDocumentId: "dirty" });
    await act(async () => { fake.state.releaseInterval(); await closing; });
    await settle();
    expect(fake.state.destroyed).toBe(false);
    expect(useDocumentStore.getState().documents[0]?.content).toBe("unsaved");
    expect(logged("window.close_requested")).toContainEqual(expect.objectContaining({ status: "fail", context: { windowLabel: "mdpro-a", action: "close_order_failed" } }));
  });
});
