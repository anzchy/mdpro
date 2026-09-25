/**
 * D16F WI-10 — `useQuitGuard` listener registration (FIX row 22).
 *
 * A sibling of `useQuitGuard.test.ts` (which is already past 300 lines), with
 * its own copy of the fake bus. The bus here can reject a `listen` per event
 * name, and can defer every registration until the test settles it.
 *
 * Law:
 * - Round trip: after unmount, zero quit listeners remain and no reply is sent,
 *   whatever rejected and whenever it settled.
 * - Under Tauri, a registration failure is logged exactly once per mount as
 *   `app.quit.listen` fail with `subscribedCount + failedCount == 4`, counts
 *   only — even when it settles after unmount. (ADR-0035 WI-8 added the fourth
 *   subscription, `app:quit-backstop`.)
 * - Outside Tauri, nothing is logged.
 *
 * Mocked: `@tauri-apps/api/{webviewWindow,core}` and `loggingService` only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

type Cb = (event: { payload: unknown }) => void;

const { bus, core } = vi.hoisted(() => ({
  bus: {
    listeners: new Map<string, Set<Cb>>(),
    rejectListen: new Set<string>(),
    deferred: { value: false },
    pending: [] as Array<() => void>,
  },
  core: { replies: [] as Array<{ cmd: string; args: Record<string, unknown> }> },
}));

/** A rejection reason carrying an id-like marker the log must never contain. */
const LEAK_MARKER = "doc-LEAK-42";

function register(name: string, cb: Cb): Promise<() => void> {
  const outcome = (): { ok: true; dispose: () => void } | { ok: false } => {
    if (bus.rejectListen.has(name)) return { ok: false };
    const set = bus.listeners.get(name) ?? new Set<Cb>();
    set.add(cb);
    bus.listeners.set(name, set);
    return { ok: true, dispose: () => void set.delete(cb) };
  };
  const settle = (resolve: (d: () => void) => void, reject: (e: unknown) => void) => {
    const result = outcome();
    if (result.ok) resolve(result.dispose);
    else reject(new Error(`listen failed for ${LEAK_MARKER}`));
  };
  return new Promise<() => void>((resolve, reject) => {
    if (bus.deferred.value) bus.pending.push(() => settle(resolve, reject));
    else settle(resolve, reject);
  });
}

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({
    label: "main",
    listen: (name: string, cb: Cb) => register(name, cb),
  })),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    core.replies.push({ cmd, args: { ...args } });
    return null;
  }),
}));

vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: vi.fn(async () => {}),
    logUiEvent: vi.fn(),
    logDialogAction: vi.fn(),
    generateActionId: vi.fn(() => "test-action-id"),
  },
}));

import { loggingService } from "../src/services/loggingService";
import { useQuitGuard } from "../src/hooks/useQuitGuard";
import { useDocumentStore } from "../src/stores/documentStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";

const REQUESTED = "app:quit-requested";
const PROMPT = "app:quit-prompt";
const CANCELLED = "app:quit-cancelled";
const ALL = [REQUESTED, PROMPT, CANCELLED];
const BACKSTOP = "app:quit-backstop";
const ALL_FOUR = [REQUESTED, PROMPT, CANCELLED, BACKSTOP];

const quitReplies = () =>
  core.replies.filter((r) => r.cmd === "quit_guard_reply" && r.args.answer !== "delivered");

const listenerCount = (name: string) => bus.listeners.get(name)?.size ?? 0;

/** Every `app.quit.listen` payload handed to the logging boundary. */
const listenLogs = () =>
  vi
    .mocked(loggingService.logEventSync)
    .mock.calls.map(([payload]) => payload)
    .filter((payload) => payload.event === "app.quit.listen");

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

async function deliver(name: string, payload: unknown): Promise<void> {
  await act(async () => {
    for (const cb of [...(bus.listeners.get(name) ?? [])]) cb({ payload });
    await Promise.resolve();
    await Promise.resolve();
  });
}

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => void unhandled.push(reason);

/** Let a macrotask pass so a pending `unhandledRejection` would have fired. */
const drainMacrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setTauri(on: boolean): void {
  if (on) vi.stubGlobal("__TAURI_INTERNALS__", {});
  else Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
}

beforeEach(() => {
  bus.listeners.clear();
  bus.rejectListen.clear();
  bus.deferred.value = false;
  bus.pending.length = 0;
  core.replies.length = 0;
  unhandled.length = 0;
  vi.clearAllMocks();
  useMilkdownEditorStore.setState({ flushers: {} });
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
  process.on("unhandledRejection", onUnhandled);
});

afterEach(() => {
  process.off("unhandledRejection", onUnhandled);
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

describe("useQuitGuard — listener registration failure (WI-10)", () => {
  it("partial rejection under Tauri keeps the working listeners and logs counts", async () => {
    setTauri(true);
    bus.rejectListen.add(PROMPT);
    renderHook(() => useQuitGuard());
    await settle();

    await deliver(REQUESTED, { requestId: 41 });

    // Level 5: the listener that did subscribe still answers.
    expect(quitReplies()).toEqual([
      { cmd: "quit_guard_reply", args: { requestId: 41, answer: "clean" } },
    ]);
    // Level 6: exactly one counts-only fail log.
    const logs = listenLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ event: "app.quit.listen", status: "fail", level: "error" });
    // ADR-0035 changes the spec: a fourth subscription (app:quit-backstop) is counted.
    expect(logs[0].context).toEqual({ subscribedCount: 3, failedCount: 1 });
    expect(JSON.stringify(logs[0])).not.toContain(LEAK_MARKER);
  });

  it("all four rejected under Tauri: no prompt, no unhandled rejection, logs {0, 4}", async () => {
    setTauri(true);
    for (const name of ALL) bus.rejectListen.add(name);
    // ADR-0035 changes the spec: "all rejected" now includes the fourth subscription.
    bus.rejectListen.add(BACKSTOP);
    const { result } = renderHook(() => useQuitGuard());
    await settle();
    await drainMacrotask();

    expect(result.current.quitPrompt).toBeNull();
    expect(unhandled).toEqual([]);
    const logs = listenLogs();
    expect(logs).toHaveLength(1);
    // ADR-0035 changes the spec: four subscriptions, all rejected.
    expect(logs[0].context).toEqual({ subscribedCount: 0, failedCount: 4 });
    expect(JSON.stringify(logs[0])).not.toContain(LEAK_MARKER);
  });

  it("non-Tauri rejection is silent: no log, no-op handlers, no replies", async () => {
    setTauri(false);
    for (const name of ALL) bus.rejectListen.add(name);
    const { result } = renderHook(() => useQuitGuard());
    await settle();
    await drainMacrotask();

    expect(result.current.quitPrompt).toBeNull();
    act(() => {
      result.current.confirmQuit();
      result.current.cancelQuit();
    });
    expect(quitReplies()).toEqual([]);
    expect(unhandled).toEqual([]);
    expect(listenLogs()).toEqual([]);
  });

  it("subscribe/unsubscribe round trip leaves zero listeners and replies only while mounted", async () => {
    setTauri(true);
    // 1. cancelled rejects; mount, settle, unmount.
    bus.rejectListen.add(CANCELLED);
    const first = renderHook(() => useQuitGuard());
    await settle();
    expect(listenerCount(REQUESTED)).toBe(1);
    first.unmount();
    for (const name of ALL) expect(listenerCount(name)).toBe(0);

    // 2. nobody is listening any more.
    await deliver(REQUESTED, { requestId: 50 });
    expect(quitReplies()).toEqual([]);

    // 3. clean remount answers exactly once.
    bus.rejectListen.clear();
    const second = renderHook(() => useQuitGuard());
    await settle();
    await deliver(REQUESTED, { requestId: 51 });
    expect(quitReplies()).toEqual([
      { cmd: "quit_guard_reply", args: { requestId: 51, answer: "clean" } },
    ]);
    second.unmount();

    // 4. unmount before registration resolves, then resolve.
    bus.deferred.value = true;
    const third = renderHook(() => useQuitGuard());
    third.unmount();
    for (const settleOne of bus.pending.splice(0)) settleOne();
    await settle();
    for (const name of ALL) expect(listenerCount(name)).toBe(0);
  });

  it("[ADV1-7] a failure settling after unmount is still logged once, and nothing leaks", async () => {
    setTauri(true);
    bus.deferred.value = true;
    bus.rejectListen.add(PROMPT);
    const { unmount } = renderHook(() => useQuitGuard());
    unmount();

    for (const settleOne of bus.pending.splice(0)) settleOne();
    await settle();
    await drainMacrotask();

    for (const name of ALL) expect(listenerCount(name)).toBe(0);
    expect(unhandled).toEqual([]);
    await deliver(REQUESTED, { requestId: 60 });
    expect(quitReplies()).toEqual([]);

    const logs = listenLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ event: "app.quit.listen", status: "fail", level: "error" });
    // ADR-0035 changes the spec: a fourth subscription (app:quit-backstop) is counted.
    expect(logs[0].context).toEqual({ subscribedCount: 3, failedCount: 1 });
  });
});

describe("useQuitGuard — four subscriptions (ADR-0035 WI-8)", () => {
  it("LS-1: every subset of rejected listens is counted, and the counts sum to 4", async () => {
    let checked = 0;
    for (let mask = 1; mask < 1 << ALL_FOUR.length; mask += 1) {
      bus.listeners.clear();
      bus.rejectListen.clear();
      vi.mocked(loggingService.logEventSync).mockClear();
      setTauri(true);
      const subset = ALL_FOUR.filter((_, bit) => (mask & (1 << bit)) !== 0);
      for (const name of subset) bus.rejectListen.add(name);

      const { unmount } = renderHook(() => useQuitGuard());
      await settle();

      const logs = listenLogs();
      expect(logs, `subset ${subset.join(",")}`).toHaveLength(1);
      const { subscribedCount, failedCount } = logs[0].context as Record<string, number>;
      expect(subscribedCount + failedCount).toBe(4);
      expect(failedCount, `subset ${subset.join(",")}`).toBe(subset.length);
      for (const name of ALL_FOUR) {
        expect(listenerCount(name)).toBe(subset.includes(name) ? 0 : 1);
      }
      unmount();
      checked += 1;
    }
    // The empty subset logs nothing: no failure, no line.
    bus.rejectListen.clear();
    vi.mocked(loggingService.logEventSync).mockClear();
    const clean = renderHook(() => useQuitGuard());
    await settle();
    expect(listenLogs()).toEqual([]);
    clean.unmount();
    expect(checked).toBe(15);
  });

  it("LS-2: an unmount before the four listeners resolve leaves zero on the bus", async () => {
    setTauri(true);
    bus.deferred.value = true;
    const { unmount } = renderHook(() => useQuitGuard());
    await settle();
    expect(bus.pending).toHaveLength(4);
    unmount();

    for (const settleOne of bus.pending.splice(0)) settleOne();
    await settle();

    for (const name of ALL_FOUR) expect(listenerCount(name)).toBe(0);
  });
});
