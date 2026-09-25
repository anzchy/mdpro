/**
 * D31 WI-2 — window targeting pinned, plus structured logging for device checks.
 *
 * The D31 device logs could not say which window wrote each `ui.menu.select`
 * line, so "exactly one window acted" was inferred from the code, not observed.
 * This file specifies the evidence the device re-check reads:
 *   - every `ui.menu.select` carries `windowLabel` (B1b, D1, D4 invariant 5);
 *   - one `ui.menu.listen` line per `listen()` attempt: `success` when it
 *     resolves while the mount is live, `cancel` when it resolves after cleanup,
 *     `fail` when it rejects — whether or not cleanup already ran (D2, D3);
 *   - one `ui.menu.focus_check` `fail` line per event whose `isFocused()`
 *     rejects, while the gate keeps failing open (C2, C3);
 *   - an unfocused window runs nothing and logs nothing (C1, characterization).
 *
 * Law L-D (outcome conservation, per outcome) is asserted at S5 by D3; the
 * log-line shape is asserted at S4 over every captured line by D4, which runs
 * last in this file.
 *
 * Mock boundary: only the three Tauri modules, same shape as
 * `tests/use-menu-events-subscription.test.ts` (WI-1). The event module is a
 * real in-memory bus with deferred resolution; `loggingService` and
 * `loggingStore` are real; `invoke("log_event")` captures the JSONL payload.
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
    failure: null as unknown,
    subscribeCount: 0,
    /** Tag stamped on each `listen()` call (the test's mount id). */
    tag: 0,
    /** Tags whose `listen()` promise has resolved. */
    settledTags: new Set<number>(),
    /** Tags whose mount is currently live (maintained by the D3 model). */
    liveTags: new Set<number>(),
    /** D3 model: attempts that resolved while / after their mount was live, or rejected. */
    resolvedWhileLive: 0,
    resolvedAfterCleanup: 0,
    rejected: 0,
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
      if (state.failure) {
        state.rejected += 1;
        return Promise.reject(state.failure);
      }
      const tag = state.tag;
      return new Promise<() => void>((resolve) => {
        const settle = () => {
          if (state.liveTags.has(tag)) state.resolvedWhileLive += 1;
          else state.resolvedAfterCleanup += 1;
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
      state.liveTags.clear();
      state.resolvedWhileLive = 0;
      state.resolvedAfterCleanup = 0;
      state.rejected = 0;
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
type Captured = { payload: Record<string, any>; labelAtLog: string };

const calls: Call[] = [];
/** Every captured line from every test in this file, inspected by D4. */
const collected: Captured[] = [];

const makeHandlers = (gen: number): Handlers => {
  const h: Record<string, (...args: unknown[]) => void> = {};
  for (const key of HANDLER_KEYS) {
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

/** Settle effects, the boundary's `.then()`/`.catch()` and `isFocused()`. */
const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < QUIESCE_MAX_TURNS && win.focusChecks < bus.state.delivered; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
    await new Promise((r) => setTimeout(r, 0));
  });
};

const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const menuLogs = (event: string) => logs.filter((l) => l.payload.event === event);
const statuses = (event: string) => menuLogs(event).map((l) => l.payload.status as string);
const uiMenuLines = () => logs.filter((l) => String(l.payload.event).startsWith("ui.menu."));

const collectAndClearLogs = () => {
  collected.push(...logs);
  logs.length = 0;
};

beforeEach(() => {
  bus.reset();
  win.reset();
  logs.length = 0;
  calls.length = 0;
  useLoggingStore.setState({ enabled: true, level: "info" });
});

afterEach(() => {
  collectAndClearLogs();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Row table (menu.rs:254-277 plus file.open_recent), shared with WI-1's B1
// ---------------------------------------------------------------------------

type Row = {
  n: number;
  action: string;
  value?: string;
  controlId: string;
  extra: Record<string, unknown>;
};

const ROWS: Row[] = [
  { n: 1, action: "file.new", controlId: "menu.file.new", extra: {} },
  { n: 2, action: "file.new_window", controlId: "menu.file.new_window", extra: {} },
  { n: 3, action: "file.open", controlId: "menu.file.open", extra: {} },
  { n: 4, action: "file.save", controlId: "menu.file.save", extra: {} },
  { n: 5, action: "file.close", controlId: "menu.file.close", extra: {} },
  { n: 6, action: "file.export_html", controlId: "menu.file.export_html", extra: {} },
  { n: 7, action: "file.preferences", controlId: "menu.file.preferences", extra: {} },
  { n: 8, action: "cycle-view-mode", controlId: "menu.view.cycle", extra: {} },
  { n: 9, action: "set-view-mode", value: "source", controlId: "menu.view.set_mode", extra: { mode: "source" } },
  { n: 10, action: "set-view-mode", value: "wysiwyg", controlId: "menu.view.set_mode", extra: { mode: "wysiwyg" } },
  { n: 11, action: "view.toggle_sidebar", controlId: "menu.view.toggle_sidebar", extra: {} },
  { n: 12, action: "format.highlight", controlId: "menu.format.highlight", extra: {} },
  { n: 13, action: "paragraph.table", controlId: "menu.format.insert_table", extra: {} },
  { n: 14, action: "theme.light", controlId: "menu.theme.light", extra: {} },
  { n: 15, action: "theme.dark", controlId: "menu.theme.dark", extra: {} },
  { n: 16, action: "theme.system", controlId: "menu.theme.system", extra: {} },
  { n: 17, action: "file.open_recent", value: "/tmp/a.md", controlId: "menu.file.open_recent", extra: { filePath: "/tmp/a.md" } },
];

const payloadOf = (row: Row) =>
  row.value === undefined ? { action: row.action } : { action: row.action, value: row.value };

// ---------------------------------------------------------------------------
// B1b / D1 — the window label on every select line
// ---------------------------------------------------------------------------

describe("useMenuEvents — ui.menu.select carries windowLabel (WI-2)", () => {
  it.each(ROWS)("B1b row $n: $action logs the exact context with windowLabel (RED before WI-2)", async (row) => {
    win.label = "mdpro-5";
    const h = mountHook(makeHandlers(0));
    await flush();
    bus.emit(EVT, payloadOf(row));
    await flush();

    const select = menuLogs("ui.menu.select");
    expect(select).toHaveLength(1);
    expect(select[0].payload.context).toEqual({
      controlId: row.controlId,
      windowLabel: "mdpro-5",
      ...row.extra,
    });
    h.unmount();
  });

  it.each(["mdpro-2", "mdpro-7"])("D1: ui.menu.select carries windowLabel %s (RED before WI-2)", async (label) => {
    win.label = label;
    const h = mountHook(makeHandlers(0));
    await flush();
    bus.emit(EVT, { action: "file.new_window" });
    await flush();

    const select = menuLogs("ui.menu.select");
    expect(select).toHaveLength(1);
    expect(select[0].payload.context).toEqual({
      controlId: "menu.file.new_window",
      windowLabel: label,
    });
    h.unmount();
  });
});

// ---------------------------------------------------------------------------
// C — the focus gate
// ---------------------------------------------------------------------------

describe("useMenuEvents — focus gate (WI-2)", () => {
  it("C1: an unfocused window runs no handler and writes no select line (characterization)", async () => {
    win.focus = "false";
    const h = mountHook(makeHandlers(0));
    await flush();
    for (const action of ["file.new_window", "file.save", "theme.light"]) {
      bus.emit(EVT, { action });
      await flush();
    }

    expect(calls).toEqual([]);
    expect(menuLogs("ui.menu.select")).toHaveLength(0);
    expect(menuLogs("ui.menu.focus_check")).toHaveLength(0);

    // Positive control: the same mount acts once focused.
    win.focus = "true";
    bus.emit(EVT, { action: "file.save" });
    await flush();
    expect(calls).toEqual([{ gen: 0, key: "onSave", args: [expect.any(String)] }]);
    expect(menuLogs("ui.menu.select")).toHaveLength(1);
    h.unmount();
  });

  it("C2: a rejected isFocused() fails open and logs one focus_check fail per event (RED before WI-2)", async () => {
    win.label = "mdpro-3";
    win.focus = "reject";
    win.rejectWith = new Error("ipc down");
    const h = mountHook(makeHandlers(0));
    await flush();
    for (let i = 0; i < 3; i++) {
      bus.emit(EVT, { action: "file.new" });
      await flush();
    }

    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.key === "onNew")).toBe(true);
    const checks = menuLogs("ui.menu.focus_check");
    expect(checks).toHaveLength(3);
    for (const line of checks) {
      expect(line.payload.status).toBe("fail");
      expect(line.payload.level).toBe("info");
      expect(line.payload.context).toEqual({ windowLabel: "mdpro-3" });
    }
    expect(menuLogs("ui.menu.select")).toHaveLength(3);
    h.unmount();
  });

  it("C3 METAMORPHIC: the focus_check error is a fixed reason, independent of the raw error", async () => {
    const runOnce = async (rejectWith: unknown) => {
      logs.length = 0;
      win.focusChecks = 0;
      bus.state.delivered = 0;
      win.focus = "reject";
      win.rejectWith = rejectWith;
      const h = mountHook(makeHandlers(0));
      await flush();
      bus.emit(EVT, { action: "file.new" });
      await flush();
      const checks = menuLogs("ui.menu.focus_check");
      expect(checks).toHaveLength(1);
      const payload = checks[0].payload;
      h.unmount();
      await flush();
      collectAndClearLogs();
      return payload;
    };

    const run1 = await runOnce(new Error("/Users/alice/secret.md EACCES"));
    const run2 = await runOnce("plain string");

    expect(typeof run1.error).toBe("string");
    expect(run1.error.length).toBeGreaterThan(0);
    expect(run1.error).toBe(run2.error);
    const serialized = JSON.stringify(run1);
    expect(serialized).not.toContain("/Users/alice");
    expect(serialized).not.toContain("EACCES");
  });
});

// ---------------------------------------------------------------------------
// D2 — listen lifecycle lines
// ---------------------------------------------------------------------------

const expectListenShape = () => {
  for (const line of menuLogs("ui.menu.listen")) {
    expect(line.payload.level).toBe("info");
    expect(line.payload.context).toEqual({ windowLabel: "mdpro-4" });
  }
};

describe("useMenuEvents — ui.menu.listen lifecycle lines (WI-2)", () => {
  beforeEach(() => {
    win.label = "mdpro-4";
  });

  it("D2(a): a normal mount logs exactly one success (RED before WI-2)", async () => {
    const h = mountHook(makeHandlers(0));
    await flush();

    expect(statuses("ui.menu.listen")).toEqual(["success"]);
    expectListenShape();
    h.unmount();
  });

  it("D2(b): a cleanup before resolve logs one cancel and zero success (RED before WI-2)", async () => {
    bus.state.autoResolve = false;
    const h = mountHook(makeHandlers(0));
    await flush();
    h.unmount();
    bus.drain();
    await flush();

    expect(statuses("ui.menu.listen")).toEqual(["cancel"]);
    expectListenShape();
  });

  it("D2(c): a rejected listen() logs one fail with a fixed reason (RED before WI-2)", async () => {
    bus.state.failure = new Error("/private/x boom");
    const h = mountHook(makeHandlers(0));
    await flush();
    await macrotask();

    expect(statuses("ui.menu.listen")).toEqual(["fail"]);
    const [line] = menuLogs("ui.menu.listen");
    expect(typeof line.payload.error).toBe("string");
    expect(line.payload.error.length).toBeGreaterThan(0);
    expect(line.payload.error).not.toContain("/private/x");
    expect(line.payload.error).not.toContain("boom");
    expect(JSON.stringify(line.payload)).not.toContain("/private/x");
    expectListenShape();
    h.unmount();
  });

  it("D2(d): five re-renders still log exactly one success (RED before WI-2)", async () => {
    const h = mountHook(makeHandlers(0));
    await flush();
    for (let gen = 1; gen <= 5; gen++) {
      h.rerender({ h: makeHandlers(gen) });
      await flush();
    }

    expect(statuses("ui.menu.listen")).toEqual(["success"]);
    expectListenShape();
    h.unmount();
  });

  it("D2(e): StrictMode with a rejecting listen() logs fail twice, never cancel (RED before WI-2)", async () => {
    bus.state.failure = new Error("events unsupported");
    const h = mountHook(makeHandlers(0), true);
    await flush();
    await macrotask();

    expect(statuses("ui.menu.listen")).toEqual(["fail", "fail"]);
    expect(bus.state.subscribeCount).toBe(2);
    expectListenShape();
    h.unmount();
  });
});

// ---------------------------------------------------------------------------
// D3 — property: per-outcome listen conservation and log-neutral re-render
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

const EMIT_POOL: Array<{ action: string; value?: string }> = [
  ...ROWS.map(payloadOf),
  { action: "x.unknown" },
];
const OPS = ["rerender", "settleOne", "setAutoResolve", "setFailure", "emit", "unmount", "mount"] as const;
const FOCI = ["true", "false", "reject"] as const;
const LABELS = ["main", "mdpro-2", "mdpro-9"] as const;

async function runLoggingSequence(seed: number, seq: number): Promise<void> {
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
  let mountId = 0;
  let expectedFocusFails = 0;
  const registered = () => hook !== null && bus.state.settledTags.has(mountId);

  const mount = async () => {
    mountId += 1;
    bus.state.tag = mountId;
    bus.state.liveTags.add(mountId);
    win.label = pick(LABELS);
    hook = mountHook(makeHandlers(++gen));
    await flush();
  };

  const emit = async (payload: { action: string; value?: string }, focus: (typeof FOCI)[number]) => {
    win.focus = focus;
    if (registered() && focus === "reject") expectedFocusFails += 1;
    bus.emit(EVT, payload);
    await flush();
  };

  ops.push("mount");
  bus.state.autoResolve = rand() < 0.5;
  await mount();

  const steps = 1 + Math.floor(rand() * 30);
  for (let s = 0; s < steps; s++) {
    const op = pick(OPS);
    if (op === "rerender" && hook) {
      ops.push("rerender");
      const before = uiMenuLines().length;
      (hook as ReturnType<typeof mountHook>).rerender({ h: makeHandlers(++gen) });
      await flush();
      expect(uiMenuLines().length - before, `invariant 6 (re-render is log-neutral): ${where()}`).toBe(0);
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
    } else if (op === "setFailure") {
      const v = rand() < 0.5;
      ops.push(`fail(${v})`);
      bus.state.failure = v ? new Error(`/Users/x/secret-${seq} boom`) : null;
    } else if (op === "emit") {
      const payload = pick(EMIT_POOL);
      const focus = pick(FOCI);
      ops.push(`emit(${payload.action},${focus})`);
      await emit(payload, focus);
    } else if (op === "unmount" && hook) {
      ops.push("unmount");
      bus.state.liveTags.delete(mountId);
      (hook as ReturnType<typeof mountHook>).unmount();
      hook = null;
      await flush();
    } else if (op === "mount" && !hook) {
      ops.push("mount");
      await mount();
    } else {
      ops.push(`skip(${op})`);
    }
  }

  ops.push("drain");
  bus.drain();
  await flush();
  await macrotask();

  ops.push("final-emit");
  await emit({ action: "file.new" }, "true");

  const listenStatuses = statuses("ui.menu.listen");
  const n = (status: string) => listenStatuses.filter((s) => s === status).length;
  expect(n("success"), `invariant 1 (#success === resolvedWhileLive): ${where()}`).toBe(
    bus.state.resolvedWhileLive,
  );
  expect(n("cancel"), `invariant 2 (#cancel === resolvedAfterCleanup): ${where()}`).toBe(
    bus.state.resolvedAfterCleanup,
  );
  expect(n("fail"), `invariant 3 (#fail === rejected): ${where()}`).toBe(bus.state.rejected);
  expect(listenStatuses.length, `invariant 4 (one outcome per attempt): ${where()}`).toBe(
    bus.state.subscribeCount,
  );
  const focusFails = menuLogs("ui.menu.focus_check").filter((l) => l.payload.status === "fail");
  expect(focusFails.length, `invariant 5 (#focus_check fail): ${where()}`).toBe(expectedFocusFails);

  if (hook) (hook as ReturnType<typeof mountHook>).unmount();
  await flush();
  collectAndClearLogs();
}

describe("useMenuEvents — D3 property: listen outcome conservation", () => {
  it("D3: holds over 200 seeded random lifecycles (seed via D31_SEED)", async () => {
    const baseSeed = Number(process.env.D31_SEED ?? 0xd31);
    for (let i = 0; i < 200; i++) {
      await runLoggingSequence((baseSeed + i * 0x9e3779b1) >>> 0, i);
    }
  }, 180_000);
});

// ---------------------------------------------------------------------------
// D4 — property over every captured line in this file (runs last)
// ---------------------------------------------------------------------------

describe("useMenuEvents — D4 property: every ui.menu.* line has the allowed shape (runs last)", () => {
  const ALLOWED = new Set(["controlId", "windowLabel", "mode", "filePath"]);

  it("D4: every captured ui.menu.* line obeys invariants 1-5", () => {
    const lines = collected.filter((l) => String(l.payload.event).startsWith("ui.menu."));

    // Non-vacuity: every event/status class the earlier cases produce is present.
    const kinds = new Set(lines.map((l) => `${l.payload.event}/${l.payload.status}`));
    for (const kind of [
      "ui.menu.select/success",
      "ui.menu.listen/success",
      "ui.menu.listen/cancel",
      "ui.menu.listen/fail",
      "ui.menu.focus_check/fail",
    ]) {
      expect(kinds.has(kind), `collected lines include ${kind}`).toBe(true);
    }
    const selectIds = new Set(
      lines.filter((l) => l.payload.event === "ui.menu.select").map((l) => l.payload.context?.controlId),
    );
    for (const row of ROWS) expect(selectIds.has(row.controlId), `select for ${row.controlId}`).toBe(true);

    for (const { payload, labelAtLog } of lines) {
      const at = JSON.stringify(payload);
      const context = (payload.context ?? {}) as Record<string, unknown>;
      const keys = Object.keys(context);
      // 1. allowed key set
      for (const key of keys) expect(ALLOWED.has(key), `invariant 1 key ${key}: ${at}`).toBe(true);
      // 2. filePath only on open_recent select
      if ("filePath" in context) {
        expect(
          payload.event === "ui.menu.select" && context.controlId === "menu.file.open_recent",
          `invariant 2: ${at}`,
        ).toBe(true);
      }
      // 3. listen / focus_check carry exactly { windowLabel }
      if (payload.event === "ui.menu.listen" || payload.event === "ui.menu.focus_check") {
        expect(keys, `invariant 3: ${at}`).toEqual(["windowLabel"]);
      }
      // 4. info level
      expect(payload.level, `invariant 4: ${at}`).toBe("info");
      // 5. select lines carry the writing window's label
      if (payload.event === "ui.menu.select") {
        expect(typeof context.windowLabel, `invariant 5 (present): ${at}`).toBe("string");
        expect(context.windowLabel, `invariant 5 (equals labelAtLog): ${at}`).toBe(labelAtLog);
      }
    }
  });
});
