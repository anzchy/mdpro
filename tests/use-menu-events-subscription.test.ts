/**
 * D31 — one native menu click ran its `menu:action` handler several times.
 *
 * `src/hooks/useMenuEvents.ts` re-subscribed on every App render (a 14-prop
 * dependency array, 7 of them fresh inline arrows) and assigned `unlisten` only
 * inside `.then()`. A cleanup that ran before `listen()` resolved leaked the
 * subscription for good, so the focused window held N live subscriptions and
 * one click ran the handler N times (7 New Window lines for one ⌘⇧N).
 *
 * Laws asserted here:
 *   L-A1 (conservation of subscriptions) — once every pending `listen()` has
 *     settled, the live `menu:action` handler count is `mounted ? 1 : 0`.
 *   L-A2 (exactly-once dispatch) — each emit delivered while the current mount
 *     is registered and the focus gate passes produces exactly one handler call,
 *     on the newest rendered handler identity.
 *
 * Mock boundary: only the three Tauri modules.
 *   - `@tauri-apps/api/event` is a REAL in-memory bus with deferred resolution
 *     (shaped after `tests/use-theme-listener-cancellation.test.ts:34-91`), so
 *     "live subscriptions" is the bus's own `Set` size, never a call record.
 *   - `@tauri-apps/api/window` supplies `{ label, isFocused }`.
 *   - `@tauri-apps/api/core` `invoke` captures `log_event` payloads — the JSONL
 *     line the app writes. `loggingService` and `loggingStore` are real.
 *
 * Not modelled here: two windows receiving one broadcast click. jsdom has one
 * module-global `getCurrentWindow`, and the Tauri JS mocks do not target a
 * window (D30). That case is covered only by the E2E-D31-device run.
 */
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const { bus, win, logs } = vi.hoisted(() => {
  type BusHandler = (event: { payload: unknown }) => void;
  type Pending = { settle: () => void; tag: number };

  const state = {
    handlers: new Map<string, Set<BusHandler>>(),
    pending: [] as Pending[],
    autoResolve: true,
    failure: null as Error | null,
    subscribeCount: 0,
    /** Tag stamped on each `listen()` call (the test's mount id). */
    tag: 0,
    /** Tags whose `listen()` promise has resolved. */
    settledTags: new Set<number>(),
    /** Handler invocations delivered by `emit` (each one runs a focus check). */
    delivered: 0,
  };

  const bus = {
    state,
    count(evt: string): number {
      return state.handlers.get(evt)?.size ?? 0;
    },
    emit(evt: string, payload: unknown): void {
      state.delivered += state.handlers.get(evt)?.size ?? 0;
      [...(state.handlers.get(evt) ?? [])].forEach((handler) => handler({ payload }));
    },
    listen(evt: string, handler: BusHandler): Promise<() => void> {
      state.subscribeCount += 1;
      if (state.failure) return Promise.reject(state.failure);
      const tag = state.tag;
      return new Promise<() => void>((resolve) => {
        const settle = () => {
          const set = state.handlers.get(evt) ?? new Set<BusHandler>();
          set.add(handler);
          state.handlers.set(evt, set);
          state.settledTags.add(tag);
          resolve(() => {
            set.delete(handler);
          });
        };
        if (state.autoResolve) settle();
        else state.pending.push({ settle, tag });
      });
    },
    drain(order: "forward" | "reverse" = "forward"): void {
      const settles = [...state.pending];
      state.pending = [];
      if (order === "reverse") settles.reverse();
      settles.forEach((p) => p.settle());
    },
    /** Resolve only the i-th pending `listen()`. */
    settleAt(i: number): void {
      const [entry] = state.pending.splice(i, 1);
      entry?.settle();
    },
    reset(): void {
      state.handlers.clear();
      state.pending = [];
      state.autoResolve = true;
      state.failure = null;
      state.subscribeCount = 0;
      state.tag = 0;
      state.settledTags.clear();
      state.delivered = 0;
    },
  };

  const win = {
    label: "main",
    focus: "true" as "true" | "false" | "reject" | "deferred",
    rejectWith: new Error("focus check failed") as unknown,
    deferreds: [] as Array<(v: boolean) => void>,
    /** How many times `isFocused()` was called (the harness's quiescence signal). */
    focusChecks: 0,
    reset() {
      win.label = "main";
      win.focus = "true";
      win.rejectWith = new Error("focus check failed");
      win.deferreds = [];
      win.focusChecks = 0;
    },
  };

  const logs: Array<{ payload: Record<string, any>; labelAtLog: string }> = [];

  return { bus, win, logs };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: (evt: string, handler: (event: { payload: unknown }) => void) => bus.listen(evt, handler),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: win.label,
    isFocused: (): Promise<boolean> => {
      win.focusChecks += 1;
      switch (win.focus) {
        case "true":
          return Promise.resolve(true);
        case "false":
          return Promise.resolve(false);
        case "reject":
          return Promise.reject(win.rejectWith);
        case "deferred":
          return new Promise<boolean>((resolve) => {
            win.deferreds.push(resolve);
          });
      }
    },
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: { payload?: Record<string, unknown> }) => {
    if (cmd === "log_event") {
      logs.push({ payload: (args?.payload ?? {}) as Record<string, any>, labelAtLog: win.label });
    }
    return Promise.resolve(null);
  },
}));

import { useMenuEvents } from "../src/hooks/useMenuEvents";
import { useLoggingStore } from "../src/stores/loggingStore";

const EVT = "menu:action";
const QUIESCE_MAX_TURNS = 500;

const HANDLER_KEYS = [
  "onNew",
  "onNewWindow",
  "onOpen",
  "onSave",
  "onClose",
  "onExportHtml",
  "onOpenRecent",
  "onToggleSidebar",
  "onHighlight",
  "onInsertTable",
  "onViewModeChange",
  "onCycleViewMode",
  "onThemeModeChange",
  "onOpenPreferences",
] as const;
type HandlerKey = (typeof HANDLER_KEYS)[number];
type Call = { gen: number; key: HandlerKey; args: unknown[] };
type Handlers = Parameters<typeof useMenuEvents>[0];

const calls: Call[] = [];

/** All 14 handlers; each records which render generation's identity ran. */
const makeHandlers = (gen: number, omit?: HandlerKey): Handlers => {
  const h: Record<string, (...args: unknown[]) => void> = {};
  for (const key of HANDLER_KEYS) {
    if (key === omit) continue;
    h[key] = (...args: unknown[]) => {
      calls.push({ gen, key, args });
    };
  }
  return h as Handlers;
};

const mountHook = (h: Handlers, strict = false) =>
  renderHook(({ h: handlers }: { h: Handlers }) => useMenuEvents(handlers), {
    initialProps: { h },
    ...(strict ? { wrapper: StrictMode } : {}),
  });

/** Settle effects, the boundary's `.then()`, the dynamic import and `isFocused()`. */
const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    // Delivery through the bus and the hook's `isFocused()` await can take
    // several macrotask turns under a loaded, coverage-instrumented run. Wait until
    // every delivered event has reached its focus check, then one more turn
    // for the microtasks after it. Bounded: a stuck run falls through to the
    // assertions, which then fail with a real message.
    for (let i = 0; i < QUIESCE_MAX_TURNS && win.focusChecks < bus.state.delivered; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
    await new Promise((r) => setTimeout(r, 0));
  });
};

const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const menuLogs = (event: string) => logs.filter((l) => l.payload.event === event);

beforeEach(() => {
  bus.reset();
  win.reset();
  logs.length = 0;
  calls.length = 0;
  useLoggingStore.setState({ enabled: true, level: "info" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Dispatch table (menu.rs:254-277 plus file.open_recent)
// ---------------------------------------------------------------------------

type Row = {
  n: number;
  action: string;
  value?: string;
  key: HandlerKey;
  args: unknown[];
  controlId: string;
  extra: Record<string, unknown>;
};

const ROWS: Row[] = [
  { n: 1, action: "file.new", key: "onNew", args: [], controlId: "menu.file.new", extra: {} },
  { n: 2, action: "file.new_window", key: "onNewWindow", args: [], controlId: "menu.file.new_window", extra: {} },
  { n: 3, action: "file.open", key: "onOpen", args: [], controlId: "menu.file.open", extra: {} },
  { n: 4, action: "file.save", key: "onSave", args: [], controlId: "menu.file.save", extra: {} },
  { n: 5, action: "file.close", key: "onClose", args: [], controlId: "menu.file.close", extra: {} },
  { n: 6, action: "file.export_html", key: "onExportHtml", args: [], controlId: "menu.file.export_html", extra: {} },
  { n: 7, action: "file.preferences", key: "onOpenPreferences", args: [], controlId: "menu.file.preferences", extra: {} },
  { n: 8, action: "cycle-view-mode", key: "onCycleViewMode", args: [], controlId: "menu.view.cycle", extra: {} },
  { n: 9, action: "set-view-mode", value: "source", key: "onViewModeChange", args: ["source"], controlId: "menu.view.set_mode", extra: { mode: "source" } },
  { n: 10, action: "set-view-mode", value: "wysiwyg", key: "onViewModeChange", args: ["wysiwyg"], controlId: "menu.view.set_mode", extra: { mode: "wysiwyg" } },
  { n: 11, action: "view.toggle_sidebar", key: "onToggleSidebar", args: [], controlId: "menu.view.toggle_sidebar", extra: {} },
  { n: 12, action: "format.highlight", key: "onHighlight", args: [], controlId: "menu.format.highlight", extra: {} },
  { n: 13, action: "paragraph.table", key: "onInsertTable", args: [], controlId: "menu.format.insert_table", extra: {} },
  { n: 14, action: "theme.light", key: "onThemeModeChange", args: ["light"], controlId: "menu.theme.light", extra: {} },
  { n: 15, action: "theme.dark", key: "onThemeModeChange", args: ["dark"], controlId: "menu.theme.dark", extra: {} },
  { n: 16, action: "theme.system", key: "onThemeModeChange", args: ["system"], controlId: "menu.theme.system", extra: {} },
  { n: 17, action: "file.open_recent", value: "/tmp/a.md", key: "onOpenRecent", args: ["/tmp/a.md"], controlId: "menu.file.open_recent", extra: { filePath: "/tmp/a.md" } },
];

const payloadOf = (row: Row) =>
  row.value === undefined ? { action: row.action } : { action: row.action, value: row.value };

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

  it("A7: the handler identity is read after the focus-check await, not before (RED before D31)", async () => {
    win.focus = "deferred";
    const h = mountHook(makeHandlers(0));
    await flush();
    bus.emit(EVT, { action: "file.export_html" });
    await flush();
    expect(win.deferreds.length, "precondition: parked on isFocused()").toBe(1);

    h.rerender({ h: makeHandlers(1) });
    await act(async () => {
      win.deferreds[0](true);
    });
    await flush();

    expect(calls).toEqual([{ gen: 1, key: "onExportHtml", args: [expect.any(String)] }]);
    const select = menuLogs("ui.menu.select");
    expect(select).toHaveLength(1);
    expect(select[0].payload.context.controlId).toBe("menu.file.export_html");
    h.unmount();
  });

  it("A7b: an event parked on the focus check when the window unmounts dispatches nothing", async () => {
    win.focus = "deferred";
    const h = mountHook(makeHandlers(0));
    await flush();
    bus.emit(EVT, { action: "file.save" });
    await flush();
    expect(win.deferreds.length, "precondition: parked on isFocused()").toBe(1);

    h.unmount();
    await act(async () => {
      win.deferreds[0](true);
    });
    await flush();

    expect(calls).toEqual([]);
    expect(menuLogs("ui.menu.select")).toHaveLength(0);
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

const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const EMIT_POOL: Array<{ payload: { action: string; value?: string }; known: boolean }> = [
  ...ROWS.map((row) => ({ payload: payloadOf(row), known: true })),
  { payload: { action: "x.unknown" }, known: false },
];
const OPS = ["rerender", "settleOne", "setAutoResolve", "emit", "unmount", "mount"] as const;
const FOCI = ["true", "false", "reject"] as const;
const LABELS = ["main", "mdpro-2", "mdpro-9"] as const;

async function runLifecycleSequence(seed: number, seq: number): Promise<void> {
  const rand = mulberry32(seed);
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
  bus.reset();
  win.reset();
  logs.length = 0;
  calls.length = 0;

  const ops: string[] = [];
  const where = () => `seed=${seed} seq=${seq} ops=${JSON.stringify(ops)}`;
  let hook: ReturnType<typeof mountHook> | null = null;
  let gen = 0;
  let currentGen = 0;
  let mountId = 0;
  let expectedTotal = 0;
  const registered = () => hook !== null && bus.state.settledTags.has(mountId);

  const mount = async () => {
    mountId += 1;
    bus.state.tag = mountId;
    currentGen = ++gen;
    win.label = pick(LABELS);
    hook = mountHook(makeHandlers(currentGen));
    await flush();
  };

  const emitAndCheck = async (payload: { action: string; value?: string }, known: boolean, focus: (typeof FOCI)[number]) => {
    win.focus = focus;
    const before = calls.length;
    const expected = registered() && focus !== "false" && known ? 1 : 0;
    bus.emit(EVT, payload);
    await flush();
    const produced = calls.slice(before);
    expect(produced.length, `emit ${JSON.stringify(payload)} focus=${focus}: ${where()}`).toBe(expected);
    expect(produced.every((c) => c.gen === currentGen), `newest identity: ${where()}`).toBe(true);
    expectedTotal += expected;
  };

  ops.push("mount");
  bus.state.autoResolve = rand() < 0.5;
  await mount();

  const steps = 1 + Math.floor(rand() * 30);
  for (let s = 0; s < steps; s++) {
    const op = pick(OPS);
    if (op === "rerender" && hook) {
      ops.push("rerender");
      currentGen = ++gen;
      (hook as ReturnType<typeof mountHook>).rerender({ h: makeHandlers(currentGen) });
      await flush();
    } else if (op === "settleOne") {
      if (bus.state.pending.length > 0) {
        const idx = Math.floor(rand() * bus.state.pending.length);
        ops.push(`settle(${idx})`);
        bus.settleAt(idx);
        await flush();
      } else ops.push("settle(-)");
    } else if (op === "setAutoResolve") {
      const v = rand() < 0.5;
      ops.push(`auto(${v})`);
      bus.state.autoResolve = v;
    } else if (op === "emit") {
      const e = pick(EMIT_POOL);
      const focus = pick(FOCI);
      ops.push(`emit(${e.payload.action},${focus})`);
      await emitAndCheck(e.payload, e.known, focus);
    } else if (op === "unmount" && hook) {
      ops.push("unmount");
      (hook as ReturnType<typeof mountHook>).unmount();
      hook = null;
      await flush();
    } else if (op === "mount" && !hook) {
      ops.push("mount");
      await mount();
    } else {
      ops.push(`skip(${op})`);
    }
    expect(bus.count(EVT), `L-A1 bound: ${where()}`).toBeLessThanOrEqual(hook ? 1 : 0);
  }

  ops.push("drain");
  bus.drain();
  await flush();
  expect(bus.count(EVT), `L-A1 after settle-all: ${where()}`).toBe(hook ? 1 : 0);

  ops.push("final-emit");
  await emitAndCheck({ action: "file.new" }, true, "true");

  const select = menuLogs("ui.menu.select");
  expect(calls.length, `total calls: ${where()}`).toBe(expectedTotal);
  expect(select.length, `total select logs: ${where()}`).toBe(expectedTotal);
  const callIds = calls.map((c) => c.args[c.args.length - 1] as string).sort();
  const logIds = select.map((l) => l.payload.actionId as string).sort();
  expect(logIds, `actionId multiset: ${where()}`).toEqual(callIds);

  if (hook) (hook as ReturnType<typeof mountHook>).unmount();
  await flush();
}

describe("useMenuEvents — A9 property: conservation and exactly-once dispatch", () => {
  it("A9: holds over 200 seeded random lifecycles (seed via D31_SEED)", async () => {
    const baseSeed = Number(process.env.D31_SEED ?? 0xd31);
    for (let i = 0; i < 200; i++) {
      await runLifecycleSequence((baseSeed + i * 0x9e3779b1) >>> 0, i);
    }
  }, 180_000);
});

// ---------------------------------------------------------------------------
// Dispatch table
// ---------------------------------------------------------------------------

describe("useMenuEvents — action → handler dispatch", () => {
  it.each(ROWS)("B1 row $n: $action reaches $key with exact args and controlId", async (row) => {
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

  it.each(ROWS.filter((r) => r.action !== "file.open_recent"))(
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
