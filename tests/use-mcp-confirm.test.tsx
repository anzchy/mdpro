/**
 * ADR-0042 WI-7 — `useMcpConfirm`, the per-window MCP write-confirmation queue.
 *
 * Cases HK-1 … HK-13 of `.claude/tdd-guardian/tests-20260929-102912.md`
 * (revision 2). Laws:
 * 1. At most one reply per `requestId`, whatever the user or the events do.
 * 2. Prompts are shown in arrival order.
 * 3. A `confirm_resolved` for the shown id closes it, whatever its outcome.
 * 4. After unmount, zero listeners remain, whenever `listen` settles.
 *
 * The fake bus follows `useQuitGuard.listen.test.ts`: `getCurrentWebviewWindow()
 * .listen` is bus W, `@tauri-apps/api/event` `listen` is a separate global bus G.
 * Mocked: webviewWindow, event, core (`invoke` is recorded) and `loggingService`.
 * The real `mcpConfirmService` and `mcpConfirmModel` run underneath.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

type Cb = (event: { payload: unknown }) => void;
type Registry = Map<string, Set<Cb>>;

const { bus, core } = vi.hoisted(() => ({
  bus: {
    window: new Map() as Map<string, Set<(event: { payload: unknown }) => void>>,
    global: new Map() as Map<string, Set<(event: { payload: unknown }) => void>>,
    rejectListen: new Set<string>(),
    deferred: { value: false },
    pending: [] as Array<() => void>,
  },
  core: {
    replies: [] as Array<{ cmd: string; args: Record<string, unknown> }>,
    reject: { value: null as unknown },
  },
}));

const LEAK_MARKER = "doc-LEAK-42";

function register(registry: Registry, name: string, cb: Cb): Promise<() => void> {
  const settleOne = (ok: (d: () => void) => void, fail: (e: unknown) => void) => {
    if (bus.rejectListen.has(name)) return fail(new Error(`listen failed for ${LEAK_MARKER}`));
    const set = registry.get(name) ?? new Set<Cb>();
    set.add(cb);
    registry.set(name, set);
    ok(() => void set.delete(cb));
  };
  return new Promise<() => void>((ok, fail) => {
    if (bus.deferred.value) bus.pending.push(() => settleOne(ok, fail));
    else settleOne(ok, fail);
  });
}

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({
    label: "main",
    listen: (name: string, cb: Cb) => register(bus.window, name, cb),
  })),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, cb: Cb) => register(bus.global, name, cb)),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    core.replies.push({ cmd, args: { ...args } });
    if (core.reject.value !== null) throw core.reject.value;
    return "resolved";
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
import { useMcpConfirm } from "../src/hooks/useMcpConfirm";
import { confirmRequestOf } from "../src/utils/mcpConfirmModel";

const fx = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/mcp-confirm-contract.json"), "utf8"),
) as { events: { request: string; resolved: string }; outcomes: string[]; samples: Array<Record<string, unknown>> };

const REQUEST = fx.events.request;
const RESOLVED = fx.events.resolved;
const BOTH = [REQUEST, RESOLVED];
const sample = fx.samples[0];
const req = (requestId: string) => ({ ...sample, requestId });

const replies = () => core.replies.filter((r) => r.cmd === "mcp_confirm_reply");
const listenerCount = (name: string) => bus.window.get(name)?.size ?? 0;

/** Every logged payload whose `event` is `name`, from either logging entry point. */
function logsOf(name: string): Array<Record<string, unknown>> {
  const sync = vi.mocked(loggingService.logEventSync).mock.calls.map(([p]) => p as unknown as Record<string, unknown>);
  const ui = vi
    .mocked(loggingService.logUiEvent)
    .mock.calls.map(([event, context, level, status]) => ({ event, context, level, status }));
  return [...sync, ...ui].filter((p) => p.event === name);
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

async function deliverOn(registry: Registry, name: string, payload: unknown): Promise<void> {
  await act(async () => {
    for (const cb of [...(registry.get(name) ?? [])]) cb({ payload });
    await Promise.resolve();
    await Promise.resolve();
  });
}
const deliver = (name: string, payload: unknown) => deliverOn(bus.window, name, payload);

async function mount() {
  const hook = renderHook(() => useMcpConfirm());
  await settle();
  return hook;
}

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => void unhandled.push(reason);
const drainMacrotask = () => new Promise<void>((r) => setTimeout(r, 0));

function setTauri(on: boolean): void {
  if (on) vi.stubGlobal("__TAURI_INTERNALS__", {});
  else Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
}

function resetBus(): void {
  bus.window.clear();
  bus.global.clear();
  bus.rejectListen.clear();
  bus.deferred.value = false;
  bus.pending.length = 0;
  core.replies.length = 0;
  core.reject.value = null;
}

beforeEach(() => {
  resetBus();
  unhandled.length = 0;
  vi.clearAllMocks();
  process.on("unhandledRejection", onUnhandled);
});

afterEach(() => {
  process.off("unhandledRejection", onUnhandled);
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

describe("useMcpConfirm — prompt queue (WI-7)", () => {
  it("HK-1 request → prompt equals the parsed request", async () => {
    const { result } = await mount();
    await deliver(REQUEST, sample);
    expect(result.current.prompt).toStrictEqual(confirmRequestOf(sample));
  });

  it("HK-2 approve → one reply, next prompt shown", async () => {
    const { result } = await mount();
    await deliver(REQUEST, req("r1"));
    await deliver(REQUEST, req("r2"));
    act(() => result.current.approve());
    await settle();
    expect(result.current.prompt?.requestId).toBe("r2");
    expect(replies()).toStrictEqual([
      { cmd: "mcp_confirm_reply", args: { requestId: "r1", approved: true } },
    ]);
  });

  it("HK-3 LAW: FIFO over every answer vector", async () => {
    let checked = 0;
    for (let mask = 0; mask < 8; mask += 1) {
      resetBus();
      const answers = [0, 1, 2].map((bit) => (mask & (1 << bit)) !== 0);
      const { result, unmount } = await mount();
      for (const id of ["r1", "r2", "r3"]) await deliver(REQUEST, req(id));
      const seen: Array<string | null> = [result.current.prompt?.requestId ?? null];
      for (const approved of answers) {
        act(() => (approved ? result.current.approve() : result.current.reject()));
        await settle();
        seen.push(result.current.prompt?.requestId ?? null);
      }
      expect(seen, `mask ${mask}`).toEqual(["r1", "r2", "r3", null]);
      expect(replies().map((r) => r.args)).toEqual(
        ["r1", "r2", "r3"].map((requestId, i) => ({ requestId, approved: answers[i] })),
      );
      unmount();
      checked += 1;
    }
    expect(checked).toBe(8);
  });

  it("HK-4 LAW: one reply per id under double actions in one act", async () => {
    let checked = 0;
    for (const first of [true, false]) {
      for (const second of [true, false]) {
        resetBus();
        const { result, unmount } = await mount();
        await deliver(REQUEST, req("r1"));
        await deliver(REQUEST, req("r2"));
        act(() => {
          const h = result.current;
          if (first) h.approve();
          else h.reject();
          if (second) h.approve();
          else h.reject();
        });
        await settle();
        expect(replies().map((r) => r.args)).toEqual([{ requestId: "r1", approved: first }]);
        expect(result.current.prompt?.requestId).toBe("r2");
        unmount();
        checked += 1;
      }
    }
    expect(checked).toBe(4);
  });

  it("HK-5 confirm_resolved removes only the matching id", async () => {
    const { result } = await mount();
    for (const id of ["r1", "r2", "r3"]) await deliver(REQUEST, req(id));
    await deliver(RESOLVED, { requestId: "r9", outcome: "approved" });
    expect(result.current.prompt?.requestId).toBe("r1");
    await deliver(RESOLVED, { requestId: "r2", outcome: "withdrawn" });
    expect(result.current.prompt?.requestId).toBe("r1");
    await deliver(RESOLVED, { requestId: "r1", outcome: "timedOut" });
    expect(result.current.prompt?.requestId).toBe("r3");
    expect(replies()).toEqual([]);
  });

  it("HK-6 duplicate request id is deduplicated", async () => {
    const { result } = await mount();
    await deliver(REQUEST, req("r1"));
    await deliver(REQUEST, req("r1"));
    act(() => result.current.approve());
    await settle();
    expect(result.current.prompt).toBeNull();
    expect(replies()).toHaveLength(1);
  });

  it("HK-7 malformed payload dropped and logged without its values", async () => {
    const { result } = await mount();
    await deliver(REQUEST, { requestId: "r1" });
    await deliver(REQUEST, req("r2"));
    expect(result.current.prompt?.requestId).toBe("r2");
    const logs = logsOf("mcp.confirm.request");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ status: "fail" });
    expect(logs[0].context).toEqual({ reason: "malformed" });
  });

  it("HK-8 unmount before listen resolves → zero listeners", async () => {
    bus.deferred.value = true;
    const { unmount } = renderHook(() => useMcpConfirm());
    await settle();
    expect(bus.pending).toHaveLength(2);
    unmount();
    for (const settleOne of bus.pending.splice(0)) settleOne();
    await settle();
    for (const name of BOTH) expect(listenerCount(name)).toBe(0);
    await deliver(REQUEST, req("r1"));
    await drainMacrotask();
    expect(replies()).toEqual([]);
    expect(unhandled).toEqual([]);
  });

  it("HK-9 subscription failures counted over every subset, counts only", async () => {
    let checked = 0;
    for (let mask = 1; mask < 4; mask += 1) {
      resetBus();
      vi.mocked(loggingService.logEventSync).mockClear();
      setTauri(true);
      const subset = BOTH.filter((_, bit) => (mask & (1 << bit)) !== 0);
      for (const name of subset) bus.rejectListen.add(name);
      const { result, unmount } = await mount();

      const logs = logsOf("mcp.confirm.listen");
      expect(logs, subset.join(",")).toHaveLength(1);
      expect(logs[0]).toMatchObject({ status: "fail" });
      const { subscribedCount, failedCount } = logs[0].context as Record<string, number>;
      expect(Object.keys(logs[0].context as object).sort()).toEqual(["failedCount", "subscribedCount"]);
      expect(subscribedCount + failedCount).toBe(2);
      expect(failedCount).toBe(subset.length);
      expect(JSON.stringify(logs[0])).not.toContain(LEAK_MARKER);
      for (const name of BOTH) expect(listenerCount(name)).toBe(subset.includes(name) ? 0 : 1);
      if (!subset.includes(REQUEST)) {
        await deliver(REQUEST, req("r1"));
        expect(result.current.prompt?.requestId).toBe("r1");
      }
      unmount();
      checked += 1;
    }
    expect(checked).toBe(3);

    resetBus();
    vi.mocked(loggingService.logEventSync).mockClear();
    (await mount()).unmount();
    expect(logsOf("mcp.confirm.listen")).toEqual([]);

    resetBus();
    setTauri(false);
    for (const name of BOTH) bus.rejectListen.add(name);
    (await mount()).unmount();
    await drainMacrotask();
    expect(logsOf("mcp.confirm.listen")).toEqual([]);
    expect(unhandled).toEqual([]);
  });

  it("HK-10 a failed reply still advances the prompt", async () => {
    core.reject.value = "boom";
    const { result } = await mount();
    await deliver(REQUEST, req("r1"));
    await deliver(REQUEST, req("r2"));
    act(() => result.current.approve());
    await settle();
    await drainMacrotask();
    expect(result.current.prompt?.requestId).toBe("r2");
    expect(unhandled).toEqual([]);
    expect(logsOf("mcp.confirm.reply").filter((l) => l.status === "fail")).toHaveLength(1);
  });

  it("HK-11 action after the prompt was resolved sends nothing", async () => {
    const { result } = await mount();
    await deliver(REQUEST, req("r1"));
    await deliver(RESOLVED, { requestId: "r1", outcome: "timedOut" });
    act(() => result.current.approve());
    await settle();
    expect(replies()).toEqual([]);
    expect(result.current.prompt).toBeNull();
  });

  it("HK-12 only this window's events", async () => {
    const { result } = await mount();
    await deliverOn(bus.global, REQUEST, req("r1"));
    expect(result.current.prompt).toBeNull();
  });

  it("HK-13 LAW: a resolved event of any outcome closes the shown prompt", async () => {
    expect(fx.outcomes).toHaveLength(5);
    expect(fx.outcomes).toEqual(expect.arrayContaining(["withdrawn", "cancelled"]));
    let checked = 0;
    for (const outcome of fx.outcomes) {
      resetBus();
      const { result, unmount } = await mount();
      await deliver(REQUEST, req("r1"));
      await deliver(REQUEST, req("r2"));
      await deliver(RESOLVED, { requestId: "r1", outcome });
      expect(result.current.prompt?.requestId, outcome).toBe("r2");
      await deliver(RESOLVED, { requestId: "r2", outcome });
      expect(result.current.prompt, outcome).toBeNull();
      expect(replies(), outcome).toEqual([]);
      unmount();
      checked += 1;
    }
    expect(checked).toBe(5);

    resetBus();
    const { result } = await mount();
    await deliver(REQUEST, req("r1"));
    await deliver(RESOLVED, { requestId: "r1", outcome: "bogus" });
    expect(result.current.prompt?.requestId).toBe("r1");
  });

  it("logs each user answer with id and operation only, never the title", async () => {
    const { result } = await mount();
    await deliver(REQUEST, req("r1"));
    await deliver(REQUEST, req("r2"));
    act(() => result.current.approve());
    act(() => result.current.reject());
    await settle();
    const approve = logsOf("ui.mcp_confirm.approve");
    const reject = logsOf("ui.mcp_confirm.reject");
    expect(approve.map((l) => l.context)).toEqual([{ requestId: "r1", operation: "replace" }]);
    expect(reject.map((l) => l.context)).toEqual([{ requestId: "r2", operation: "replace" }]);
    expect(JSON.stringify([...approve, ...reject])).not.toContain(String(sample.documentTitle));
  });
});
