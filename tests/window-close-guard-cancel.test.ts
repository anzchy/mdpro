/**
 * D29 WI-6 (ADR-0033 Decision 4): a cancelled window close re-registers the
 * window. Rust drops a window's MCP entry on `CloseRequested`; when the user
 * then cancels the unsaved prompt, `useWindowCloseGuard` calls
 * `onCloseCancelled`, and App passes `useMcpSync().forceSync`, which sends a
 * hash-bypassing sync that recreates the entry.
 *
 * Matrix: `.claude/tdd-guardian/tests-20260924-131525.md` § WI-6 (revision 3).
 *
 * Law: the callback fires exactly once per window prompt that is cancelled. It
 * never fires for a cancel with no window prompt pending, or for a confirm.
 *
 * The fake window mirrors `window-close-guard-listener.test.ts`: a real `Set` of
 * registered close handlers. Only process boundaries are mocked —
 * `@tauri-apps/api/{window,core}`, `mcpService.syncDocuments` and the
 * `loggingService` sink. Stores, `dataLossGuards` and both hooks are real.
 * Paired integration: G-D29-3 in WI-8 (not run by this lane).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const { fake, invokeMock, logEventSync, syncDocuments } = vi.hoisted(() => {
  type CloseHandler = (event: { preventDefault: () => void }) => unknown;
  const state = { handlers: new Set<CloseHandler>(), subscribeCount: 0, closeCount: 0 };
  const win = {
    label: "mdpro-a",
    onCloseRequested(handler: CloseHandler): Promise<() => void> {
      state.subscribeCount += 1;
      state.handlers.add(handler);
      return Promise.resolve(() => {
        state.handlers.delete(handler);
      });
    },
    close() {
      state.closeCount += 1;
    },
    innerSize: async () => ({ width: 1024, height: 768 }),
    outerPosition: async () => ({ x: 11, y: 22 }),
    isMaximized: async () => false,
    scaleFactor: async () => 1,
  };
  return {
    fake: {
      state,
      win,
      reset() {
        state.handlers.clear();
        state.subscribeCount = 0;
        state.closeCount = 0;
      },
    },
    invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
    logEventSync: vi.fn(),
    syncDocuments: vi.fn(async (..._args: unknown[]): Promise<void> => undefined),
  };
});

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => fake.win }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: { logEventSync, logEvent: vi.fn(async () => {}), generateActionId: vi.fn(() => "test-id") },
}));
vi.mock("../src/services/mcpService", () => ({
  mcpService: { syncDocuments: (...args: unknown[]) => syncDocuments(...args) },
  syncDocuments: (...args: unknown[]) => syncDocuments(...args),
}));

import { useMcpSync } from "../src/hooks/useMcpSync";
import { useWindowCloseGuard } from "../src/hooks/useWindowCloseGuard";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import type { Document } from "../src/types/document";

function dirtyDoc(): Document {
  return { id: "doc-a", path: "/tmp/a.md", content: "unsaved", encoding: "UTF-8", lineEnding: "lf", isModified: true, lastSaved: null, fileSize: null };
}

async function tick() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Fire an OS close request into every live handler, as Tauri would. */
async function requestClose() {
  const handlers = [...fake.state.handlers];
  await act(async () => {
    await Promise.all(handlers.map((handler) => handler({ preventDefault: () => {} })));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mountGuard(onCloseCancelled: () => void) {
  const view = renderHook((props: { cb: () => void }) => useWindowCloseGuard({ onCloseCancelled: props.cb }), {
    initialProps: { cb: onCloseCancelled },
  });
  await tick();
  return view;
}

beforeEach(() => {
  fake.reset();
  invokeMock.mockReset();
  invokeMock.mockImplementation(async () => null);
  logEventSync.mockReset();
  syncDocuments.mockReset();
  syncDocuments.mockImplementation(async () => undefined);
  useMilkdownEditorStore.setState({ flushers: {} });
  useEditorStore.setState({ editorView: null });
  // A dirty document, so a close request prompts.
  useDocumentStore.setState({ documents: [dirtyDoc()], activeDocumentId: "doc-a" });
});

describe("onCloseCancelled", () => {
  it("cancel after a window prompt calls back once", async () => {
    const cb = vi.fn();
    const { result } = await mountGuard(cb);

    await requestClose();
    expect(result.current.pendingClose).toBe("window");
    act(() => {
      result.current.cancelClose();
    });

    expect(result.current.pendingClose).toBeNull();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("cancel with no window prompt (document-close path) does not call back", async () => {
    const cb = vi.fn();
    const { result } = await mountGuard(cb);

    // What handleCancelClose does for a ⌘W document prompt.
    act(() => {
      result.current.cancelClose();
    });
    expect(result.current.pendingClose).toBeNull();
    expect(cb).toHaveBeenCalledTimes(0);

    // Positive control: the same guard does call back for a real window prompt.
    await requestClose();
    act(() => {
      result.current.cancelClose();
    });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("new callback identity neither re-subscribes nor goes stale", async () => {
    const cbs = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
    const { result, rerender } = await mountGuard(cbs[0]);
    for (const cb of cbs.slice(1)) rerender({ cb });
    await tick();

    await requestClose();
    act(() => {
      result.current.cancelClose();
    });

    expect(fake.state.subscribeCount).toBe(1);
    expect(fake.state.handlers.size).toBe(1);
    expect(cbs.map((cb) => cb.mock.calls.length)).toEqual([0, 0, 0, 1]);
  });
});

describe("Law: one callback per cancelled window prompt", () => {
  type Op = "request" | "cancel" | "confirm";
  // [sequence, expected callback count, expected final pendingClose] — every
  // sequence of length 1 to 3. A confirm latches the allow, so the next request
  // passes straight through without a prompt.
  const table: Array<[Op[], number, "window" | null]> = [
    [["request"], 0, "window"],
    [["cancel"], 0, null],
    [["confirm"], 0, null],
    [["request", "request"], 0, "window"],
    [["request", "cancel"], 1, null],
    [["request", "confirm"], 0, null],
    [["cancel", "request"], 0, "window"],
    [["cancel", "cancel"], 0, null],
    [["cancel", "confirm"], 0, null],
    [["confirm", "request"], 0, null],
    [["confirm", "cancel"], 0, null],
    [["confirm", "confirm"], 0, null],
    [["request", "request", "request"], 0, "window"],
    [["request", "request", "cancel"], 1, null],
    [["request", "request", "confirm"], 0, null],
    [["request", "cancel", "request"], 1, "window"],
    [["request", "cancel", "cancel"], 1, null],
    [["request", "cancel", "confirm"], 1, null],
    [["request", "confirm", "request"], 0, null],
    [["request", "confirm", "cancel"], 0, null],
    [["request", "confirm", "confirm"], 0, null],
    [["cancel", "request", "request"], 0, "window"],
    [["cancel", "request", "cancel"], 1, null],
    [["cancel", "request", "confirm"], 0, null],
    [["cancel", "cancel", "request"], 0, "window"],
    [["cancel", "cancel", "cancel"], 0, null],
    [["cancel", "cancel", "confirm"], 0, null],
    [["cancel", "confirm", "request"], 0, null],
    [["cancel", "confirm", "cancel"], 0, null],
    [["cancel", "confirm", "confirm"], 0, null],
    [["confirm", "request", "request"], 0, "window"],
    [["confirm", "request", "cancel"], 0, null],
    [["confirm", "request", "confirm"], 0, null],
    [["confirm", "cancel", "request"], 0, null],
    [["confirm", "cancel", "cancel"], 0, null],
    [["confirm", "cancel", "confirm"], 0, null],
    [["confirm", "confirm", "request"], 0, null],
    [["confirm", "confirm", "cancel"], 0, null],
    [["confirm", "confirm", "confirm"], 0, null],
  ];
  it("the table covers all 39 sequences", () => {
    expect(new Set(table.map(([seq]) => seq.join(","))).size).toBe(39);
  });
  for (const [seq, expected, finalPending] of table) {
    it(`[${seq.join(", ")}] → ${expected} callback(s), pendingClose ${String(finalPending)}`, async () => {
      const cb = vi.fn();
      const { result } = await mountGuard(cb);
      for (const op of seq) {
        if (op === "request") await requestClose();
        else if (op === "cancel") act(() => result.current.cancelClose());
        else await act(async () => result.current.confirmClose());
      }
      expect(cb).toHaveBeenCalledTimes(expected);
      expect(result.current.pendingClose).toBe(finalPending);
    });
  }
});

describe("composition with the real useMcpSync", () => {
  it("cancelled close forces a re-registration sync", async () => {
    const { result } = renderHook(() => {
      const sync = useMcpSync({ routable: true });
      const guard = useWindowCloseGuard({ onCloseCancelled: sync.forceSync });
      return { sync, guard };
    });
    await tick();
    // Baseline: the registry already holds this exact payload.
    act(() => {
      result.current.sync.syncNow();
    });
    const baseline = syncDocuments.mock.calls.at(-1)?.[0];
    syncDocuments.mockClear();

    await requestClose();
    await act(async () => {
      result.current.guard.cancelClose();
    });

    expect(syncDocuments).toHaveBeenCalledTimes(1);
    expect(syncDocuments.mock.calls[0][0]).toEqual(baseline);
    expect(syncDocuments.mock.calls[0][0]).toHaveProperty("routable", true);
  });
});
