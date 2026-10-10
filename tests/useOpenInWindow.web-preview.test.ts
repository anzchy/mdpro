/**
 * D29 / ADR-0033 WI-5 regression (receipt WI-5b) — `useOpenInWindow` outside Tauri.
 *
 * Defect: the hook called `getCurrentWebviewWindow()` synchronously in its effect. In a
 * browser-only preview (`pnpm dev`, no `window.__TAURI_INTERNALS__`) the real getter
 * throws (`webview.js` dereferences `__TAURI_INTERNALS__.metadata`); an error thrown in
 * an effect unmounts the React root, and App mounts this hook unconditionally.
 *
 * Mock boundary: `@tauri-apps/api/{webviewWindow,core,event,window}` and the
 * `loggingService` sink. Stores are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import { createElement } from "react";

const { sink, getter } = vi.hoisted(() => ({
  sink: {
    generateActionId: vi.fn(() => "test-id"),
    logEvent: vi.fn(async () => {}),
    logEventSync: vi.fn(),
    logUiEvent: vi.fn(() => "test-id"),
    logDialogAction: vi.fn(),
  },
  getter: vi.fn(() => {
    // Same shape as the real failure: reading `.metadata` of an undefined global.
    throw new TypeError("Cannot read properties of undefined (reading 'metadata')");
  }),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: getter }));
vi.mock("@tauri-apps/api/core", async () => ({ ...(await import("./support/tauriCoreMock")).createTauriCoreMock(), invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "mdpro-a" }) }));
vi.mock("../src/services/loggingService", () => ({ loggingService: sink }));

import { useOpenInWindow } from "../src/hooks/useOpenInWindow";
import { useDocumentStore } from "../src/stores/documentStore";

const listenFails = () =>
  sink.logEventSync.mock.calls
    .map(([p]) => p as Record<string, unknown>)
    .filter((p) => p.event === "file.open.route.listen" && p.status === "fail");

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

const noop = async () => null;

function Probe() {
  const { routable } = useOpenInWindow({ openPathOutcome: noop });
  return createElement("p", null, `routable:${String(routable)}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

describe("useOpenInWindow — getter throws (web preview)", () => {
  it("outside Tauri: no throw, routable false, no listen-fail log, clean unmount", async () => {
    expect("__TAURI_INTERNALS__" in window).toBe(false);
    const { result, unmount } = renderHook(() => useOpenInWindow({ openPathOutcome: noop }));
    await settle();
    expect(getter).toHaveBeenCalled();
    expect(result.current.routable).toBe(false);
    expect(listenFails()).toHaveLength(0);
    expect(() => unmount()).not.toThrow();
  });

  it("outside Tauri: the surrounding React tree still renders", async () => {
    const { unmount } = render(
      createElement("main", null, createElement("h1", null, "mdpro shell"), createElement(Probe)),
    );
    await settle();
    expect(screen.getByRole("heading", { name: "mdpro shell" })).toBeTruthy();
    expect(screen.getByText("routable:false")).toBeTruthy();
    expect(listenFails()).toHaveLength(0);
    expect(() => unmount()).not.toThrow();
  });

  it("inside Tauri: getter throwing logs one listen failure and stays unroutable", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    const { result, unmount } = renderHook(() => useOpenInWindow({ openPathOutcome: noop }));
    await settle();
    expect(result.current.routable).toBe(false);
    expect(listenFails()).toHaveLength(1);
    expect(listenFails()[0]).toEqual(
      expect.objectContaining({ level: "error", context: expect.objectContaining({ eventName: "file:open-in-window" }) }),
    );
    expect(() => unmount()).not.toThrow();
    // D29-R5: the log carries the reason, not just the fact of failure.
    const context = listenFails()[0].context as Record<string, unknown>;
    expect(String(context.error)).toContain("reading 'metadata'");
  });

  it("inside Tauri: a rejected listen logs the rejection reason and stays unroutable", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    getter.mockImplementationOnce(
      () => ({ label: "mdpro-a", listen: () => Promise.reject(new Error("listen denied by capability")) }) as never,
    );
    const { result, unmount } = renderHook(() => useOpenInWindow({ openPathOutcome: noop }));
    await settle();
    expect(result.current.routable).toBe(false);
    expect(listenFails()).toHaveLength(1);
    const context = listenFails()[0].context as Record<string, unknown>;
    expect(context.windowLabel).toBe("mdpro-a");
    expect(context.error).toBe("listen denied by capability");
    expect(() => unmount()).not.toThrow();
  });
});
