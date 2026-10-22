/**
 * D31 — one native menu click ran its `menu:action` handler several times.
 *
 * `src/hooks/useMenuEvents.ts` re-subscribed on every App render (a 14-prop
 * dependency array, 7 of them fresh inline arrows) and assigned `unlisten` only
 * inside `.then()`. A cleanup that ran before `listen()` resolved leaked the
 * subscription for good, so the focused window held N live subscriptions and
 * one click ran the handler N times (7 New Window lines for one ⌘⇧N).
 *
 * Laws asserted here, at fixture level (A1–A8); A9 asserts both over 200 seeded
 * random lifecycles in the slow tier, `use-menu-events-subscription.slow.test.ts`
 * (ADR-0050, D124):
 *   L-A1 (conservation of subscriptions) — once every pending `listen()` has
 *     settled, the live `menu:action` handler count is `mounted ? 1 : 0`.
 *   L-A2 (exactly-once dispatch) — each emit delivered while the current mount
 *     is registered and addressed to its window produces exactly one handler
 *     call, on the newest rendered handler identity.
 *
 * Mock boundary: only the three Tauri modules, through
 * `tests/support/menuEventsHarness.ts` (shared with the logging suite and the
 * slow sibling).
 *   - `@tauri-apps/api/window` supplies `{ label, listen }`; its `listen` is a
 *     REAL in-memory, label-routed bus with deferred resolution (shaped after
 *     `tests/use-theme-listener-cancellation.test.ts:34-91`), so "live
 *     subscriptions" is the bus's own `Set` size, never a call record.
 *   - `@tauri-apps/api/core` `invoke` captures `log_event` payloads — the JSONL
 *     line the app writes. `loggingService` and `loggingStore` are real.
 * The hook-side helpers and the dispatch table come from
 * `tests/support/menuEventsDomain.ts`.
 *
 * Two windows are modelled in `tests/d261-menu-target-routing.test.ts` (D261).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", async () => (await import("./support/menuEventsHarness")).eventModuleMock());
vi.mock("@tauri-apps/api/window", async () => (await import("./support/menuEventsHarness")).windowModuleMock());
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (await import("./support/menuEventsHarness")).invokeCapturingLogs,
}));

import { bus, logs, win } from "./support/menuEventsHarness";
import {
  calls,
  EVT,
  flush,
  macrotask,
  makeHandlers,
  menuLogs,
  mountHook,
  payloadOf,
  resetMenuHarness,
  ROWS,
} from "./support/menuEventsDomain";
import { useLoggingStore } from "../src/stores/loggingStore";
import { collectionCases } from "./support/collectionCases";

beforeEach(() => {
  resetMenuHarness();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Subscription lifecycle
// ---------------------------------------------------------------------------

describe("useMenuEvents — subscription lifecycle (D31)", () => {
  it("A1: a cleanup before listen() resolves leaves nothing live (RED before D31)", async () => {
    bus.state.autoResolve = false;
    const h = mountHook(makeHandlers(0));
    await flush();
    expect(bus.state.subscribeCount, "precondition: listen() attempted").toBe(1);
    expect(bus.count(EVT), "precondition: still pending").toBe(0);

    h.unmount();
    bus.drain();
    await flush();
    bus.emit(EVT, { action: "theme.light" });
    await flush();

    expect(bus.count(EVT)).toBe(0);
    expect(calls).toEqual([]);
    expect(menuLogs("ui.menu.select")).toHaveLength(0);
  });

  it.each(["forward", "reverse"] as const)(
    "A2: six re-renders before resolve leave one live subscription, on the newest identity (%s drain; RED before D31)",
    async (order) => {
      bus.state.autoResolve = false;
      const h = mountHook(makeHandlers(0));
      await flush();
      for (let gen = 1; gen <= 6; gen++) {
        h.rerender({ h: makeHandlers(gen) });
        await flush();
      }
      bus.drain(order);
      await flush();
      bus.emit(EVT, { action: "file.new_window" });
      await flush();

      expect(bus.count(EVT)).toBe(1);
      expect(calls).toEqual([{ gen: 6, key: "onNewWindow", args: [expect.any(String)] }]);
      const select = menuLogs("ui.menu.select");
      expect(select).toHaveLength(1);
      expect(select[0].payload.context.controlId).toBe("menu.file.new_window");
      expect(select[0].payload.actionId).toBe(calls[0].args[0]);
      h.unmount();
    },
  );

  it("A3: an event emitted across a re-render is not dropped (RED before D31)", async () => {
    const h = mountHook(makeHandlers(0));
    await flush();
    bus.state.autoResolve = false;
    h.rerender({ h: makeHandlers(1) });
    bus.emit(EVT, { action: "file.save" });
    await flush();

    expect(calls).toEqual([{ gen: 1, key: "onSave", args: [expect.any(String)] }]);
    expect(bus.count(EVT)).toBe(1);
    expect(bus.state.subscribeCount, "subscribe once per mount").toBe(1);
    const select = menuLogs("ui.menu.select");
    expect(select).toHaveLength(1);
    expect(select[0].payload.context.controlId).toBe("menu.file.save");
    h.unmount();
  });

  it.each(["forward", "reverse"] as const)(
    "A4: StrictMode mount → unmount → mount with listen() pending leaves one live subscription (%s drain; RED before D31)",
    async (order) => {
      bus.state.autoResolve = false;
      const h = mountHook(makeHandlers(0), true);
      await flush();
      bus.drain(order);
      await flush();
      bus.emit(EVT, { action: "theme.dark" });
      await flush();

      expect(bus.count(EVT)).toBe(1);
      expect(calls).toEqual([
        { gen: 0, key: "onThemeModeChange", args: ["dark", expect.any(String)] },
      ]);
      const select = menuLogs("ui.menu.select");
      expect(select).toHaveLength(1);
      expect(select[0].payload.context.controlId).toBe("menu.theme.dark");
      h.unmount();
    },
  );

  it("A5: unmount after resolve removes the live subscription (characterization)", async () => {
    const h = mountHook(makeHandlers(0));
    await flush();
    expect(bus.count(EVT), "precondition: registered").toBe(1);
    h.unmount();
    await flush();
    bus.emit(EVT, { action: "file.new" });
    await flush();

    expect(bus.count(EVT)).toBe(0);
    expect(calls).toEqual([]);
    expect(menuLogs("ui.menu.select")).toHaveLength(0);
  });

  it("A6: a rejected listen() throws nowhere and dispatches nothing", async () => {
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      bus.state.failure = new Error("events unsupported");
      let h: ReturnType<typeof mountHook> | undefined;
      expect(() => {
        h = mountHook(makeHandlers(0));
      }).not.toThrow();
      await flush();
      await macrotask();
      bus.emit(EVT, { action: "file.open" });
      await flush();
      expect(() => h?.unmount()).not.toThrow();
      await flush();
      await macrotask();

      expect(bus.state.subscribeCount).toBe(1);
      expect(bus.count(EVT)).toBe(0);
      expect(calls).toEqual([]);
      expect(menuLogs("ui.menu.select")).toHaveLength(0);
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  // Rule-12 reason for A7 and A7b (D261-WI-1c): the fail-open spec (act when
  // isFocused() rejects) is the defect D261 removes; the focus query no longer
  // exists, so there is no focus await to park on. Both now park on a deferred
  // listen() resolve instead, the one await left on the subscription path.
  it("A7: the handler identity is read at dispatch, not at subscribe (deferred listen)", async () => {
    bus.state.autoResolve = false;
    const h = mountHook(makeHandlers(0));
    await flush();
    expect(bus.state.pending.length, "precondition: parked on listen()").toBe(1);

    h.rerender({ h: makeHandlers(1) });
    await flush();
    bus.drain();
    await flush();
    bus.emit(EVT, { action: "file.export_html" });
    await flush();

    expect(calls).toEqual([{ gen: 1, key: "onExportHtml", args: [expect.any(String)] }]);
    const select = menuLogs("ui.menu.select");
    expect(select).toHaveLength(1);
    expect(select[0].payload.context.controlId).toBe("menu.file.export_html");
    h.unmount();
  });

  it("A7b: an event delivered after unmount, before the late listen() is unlistened, dispatches nothing", async () => {
    bus.state.autoResolve = false;
    const h = mountHook(makeHandlers(0));
    await flush();
    expect(bus.state.pending.length, "precondition: parked on listen()").toBe(1);

    h.unmount();
    bus.drain();
    bus.emit(EVT, { action: "file.save" });
    await flush();

    expect(calls).toEqual([]);
    expect(menuLogs("ui.menu.select")).toHaveLength(0);
    expect(bus.count(EVT)).toBe(0);
  });

  it.each([1, 3])(
    "A8: %i back-to-back emits are neither dropped nor merged (characterization)",
    async (n) => {
      const h = mountHook(makeHandlers(0));
      await flush();
      for (let i = 0; i < n; i++) bus.emit(EVT, { action: "file.new_window" });
      await flush();

      expect(calls).toHaveLength(n);
      expect(calls.every((c) => c.gen === 0 && c.key === "onNewWindow")).toBe(true);
      const select = menuLogs("ui.menu.select");
      expect(select).toHaveLength(n);
      const callIds = calls.map((c) => c.args[0] as string);
      expect(new Set(callIds).size).toBe(n);
      expect([...select.map((l) => l.payload.actionId)].sort()).toEqual([...callIds].sort());
      h.unmount();
    },
  );
});

// ---------------------------------------------------------------------------
// A9 — property over random lifecycles (L-A1, L-A2)
// ---------------------------------------------------------------------------

// The 200-lifecycle A9 property (~8–9 s) runs in the slow tier:
// use-menu-events-subscription.slow.test.ts (ADR-0050, D124).

// ---------------------------------------------------------------------------
// Dispatch table
// ---------------------------------------------------------------------------

describe("useMenuEvents — action → handler dispatch", () => {
  it.each(collectionCases("tests/use-menu-events-subscription.test.ts:266", ROWS))("B1 row $n: $action reaches $key with exact args and controlId", async (row) => {
    win.label = "mdpro-5";
    const h = mountHook(makeHandlers(0));
    await flush();
    bus.emit(EVT, payloadOf(row));
    await flush();

    expect(calls).toEqual([{ gen: 0, key: row.key, args: [...row.args, expect.any(String)] }]);
    const select = menuLogs("ui.menu.select");
    expect(select).toHaveLength(1);
    expect(select[0].payload).toMatchObject({
      level: "info",
      status: "success",
      context: { controlId: row.controlId, ...row.extra },
    });
    expect(select[0].payload.actionId).toBe(calls[0].args[calls[0].args.length - 1]);
    h.unmount();
  });

  it.each([
    { label: "positive control: set-view-mode source", payload: { action: "set-view-mode", value: "source" }, expected: 1 },
    { label: "unknown action", payload: { action: "x.unknown" }, expected: 0 },
    { label: "empty action", payload: { action: "" }, expected: 0 },
    { label: "set-view-mode split", payload: { action: "set-view-mode", value: "split" }, expected: 0 },
    { label: "set-view-mode preview-only", payload: { action: "set-view-mode", value: "preview-only" }, expected: 0 },
    { label: "set-view-mode null", payload: { action: "set-view-mode", value: null }, expected: 0 },
    { label: "set-view-mode no value", payload: { action: "set-view-mode" }, expected: 0 },
    { label: "open_recent null", payload: { action: "file.open_recent", value: null }, expected: 0 },
    { label: "open_recent empty", payload: { action: "file.open_recent", value: "" }, expected: 0 },
  ])("B2: $label → $expected call(s)", async ({ payload, expected }) => {
    const h = mountHook(makeHandlers(0));
    await flush();
    bus.emit(EVT, payload);
    await flush();

    expect(calls).toHaveLength(expected);
    expect(menuLogs("ui.menu.select")).toHaveLength(expected);
    h.unmount();
  });

  it.each(collectionCases("tests/use-menu-events-subscription.test.ts:306", ROWS.filter((r) => r.action !== "file.open_recent")))(
    "B3 row $n: $action with $key absent writes no log line",
    async (row) => {
      const h = mountHook(makeHandlers(0, row.key));
      await flush();
      bus.emit(EVT, payloadOf(row));
      await flush();

      expect(calls).toEqual([]);
      expect(menuLogs("ui.menu.select")).toHaveLength(0);
      h.unmount();
    },
  );

  it("B3 characterization: file.open_recent with onOpenRecent absent logs one line today (flagged in Deferred)", async () => {
    const h = mountHook(makeHandlers(0, "onOpenRecent"));
    await flush();
    bus.emit(EVT, { action: "file.open_recent", value: "/tmp/a.md" });
    await flush();

    expect(calls).toEqual([]);
    expect(menuLogs("ui.menu.select")).toHaveLength(1);
    h.unmount();
  });

  it("B4: logging disabled still dispatches the handler", async () => {
    useLoggingStore.setState({ enabled: false });
    const h = mountHook(makeHandlers(0));
    await flush();
    bus.emit(EVT, { action: "file.new" });
    await flush();

    expect(calls).toEqual([{ gen: 0, key: "onNew", args: [expect.any(String)] }]);
    expect(logs).toHaveLength(0);
    h.unmount();
  });
});
