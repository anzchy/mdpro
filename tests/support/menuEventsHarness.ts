/**
 * @module tests/support/menuEventsHarness
 * Purpose: the Tauri boundary fakes for the `useMenuEvents` suites, shared by
 * the unit and slow tiers (ADR-0050): `use-menu-events-subscription` /
 * `.slow` (A1–A9, B1–B4), `use-menu-events-logging` / `.slow` (B1b–D4) and
 * `d261-menu-target-routing`.
 *
 * Contents:
 *   - `bus` — a REAL in-memory, target-routed `menu:action` bus with deferred
 *     `listen()` resolution (shaped after
 *     `tests/use-theme-listener-cancellation.test.ts`), so "live subscriptions"
 *     is the bus's own `Set` size, never a call record. It also keeps the D3
 *     outcome model (`liveTags`, `resolvedWhileLive`, `resolvedAfterCleanup`,
 *     `rejected`).
 *   - Routing (D261): a listener made through the window mock's `listen` is
 *     registered under the label `win.label` had when `listen()` was called,
 *     like Tauri's window-scoped listener. `emitTo(label, …)` reaches only that
 *     label's listeners, as Rust's `emit_to` does; `emitAny(…)` reaches every
 *     listener, to deliver a payload the target filter must refuse. A listener
 *     made through the EVENT module's global `listen` is an `Any` listener and
 *     receives every emit, targeted or not (tauri `event/listener.rs:346-351`),
 *     so a hook that went back to the global `listen` is visible here.
 *   - `bus.emit(evt, payload)` is the ordinary path: Rust's `emit_to` this
 *     window (`win.label` now) with `target` stamped to that label.
 *   - `win` — `{ label }`. There is no `isFocused`: D261 removed the focus
 *     query, and a hook that called one would throw here.
 *   - `logs` — every `invoke("log_event")` payload, with the label at log time.
 *   - `eventModuleMock`, `windowModuleMock`, `invokeCapturingLogs` — the bodies
 *     of the three `vi.mock` factories.
 *
 * Key decisions:
 *   - **No `src/` or Tauri imports.** `vi.mock` factories are hoisted, so each
 *     test file still declares its own mocks and reaches this module with a
 *     dynamic import inside the factory. A module that imported the hook would
 *     re-enter the factory that is loading it.
 *
 * Not a `*.test.ts`, so vitest does not collect it.
 *
 * @coordinates-with tests/support/menuEventsDomain.ts — the hook-side helpers
 */

type BusHandler = (event: { payload: unknown }) => void;
type Pending = { settle: () => void; tag: number };
/** One live listener: its handler and the window label it listens as. */
type Entry = { handler: BusHandler; label: string };

/** The label an event-module (global) listener registers under: it hears every emit. */
export const ANY_TARGET = "\u0000any";

const state = {
  handlers: new Map<string, Set<Entry>>(),
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
  /** Handler invocations the bus has started. */
  delivered: 0,
  /** Handler invocations that have returned (the flush's quiescence signal). */
  handled: 0,
};

function deliver(evt: string, payload: unknown, accepts: (label: string) => boolean): void {
  const targets = [...(state.handlers.get(evt) ?? [])].filter((e) => accepts(e.label));
  state.delivered += targets.length;
  for (const entry of targets) {
    entry.handler({ payload });
    state.handled += 1;
  }
}

export const bus = {
  state,
  count(evt: string): number {
    return state.handlers.get(evt)?.size ?? 0;
  },
  /** Rust's `emit_to(label)`: that label's listeners, and every `Any` listener. */
  emitTo(label: string, evt: string, payload: unknown): void {
    deliver(evt, payload, (l) => l === label || l === ANY_TARGET);
  },
  /** Every listener, whatever its label: a payload the target filter must refuse. */
  emitAny(evt: string, payload: unknown): void {
    deliver(evt, payload, () => true);
  },
  /** The ordinary click: `emit_to` the current `win.label`, with `target` stamped to it. */
  emit(evt: string, payload: object): void {
    bus.emitTo(win.label, evt, { ...payload, target: win.label });
  },
  listen(evt: string, handler: BusHandler, label: string = win.label): Promise<() => void> {
    state.subscribeCount += 1;
    if (state.failure) {
      state.rejected += 1;
      return Promise.reject(state.failure);
    }
    const tag = state.tag;
    const entry: Entry = { handler, label };
    return new Promise<() => void>((resolve) => {
      const settle = () => {
        if (state.liveTags.has(tag)) state.resolvedWhileLive += 1;
        else state.resolvedAfterCleanup += 1;
        const set = state.handlers.get(evt) ?? new Set<Entry>();
        set.add(entry);
        state.handlers.set(evt, set);
        state.settledTags.add(tag);
        resolve(() => {
          set.delete(entry);
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
    state.handled = 0;
  },
};

export const win = {
  label: "main",
  reset() {
    win.label = "main";
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions read arbitrary payload fields
export type Captured = { payload: Record<string, any>; labelAtLog: string };

export const logs: Captured[] = [];

/** Body of the `@tauri-apps/api/event` mock: the global listener hears every emit. */
export const eventModuleMock = () => ({
  listen: (evt: string, handler: BusHandler) => bus.listen(evt, handler, ANY_TARGET),
});

/** Body of the `@tauri-apps/api/window` mock: `listen` is scoped to the label at call time. */
export const windowModuleMock = () => ({
  getCurrentWindow: () => {
    const label = win.label;
    return {
      label,
      listen: (evt: string, handler: BusHandler) => bus.listen(evt, handler, label),
    };
  },
});

/** The `invoke` of the `@tauri-apps/api/core` mock: captures `log_event` lines. */
export const invokeCapturingLogs = (cmd: string, args?: { payload?: Record<string, unknown> }) => {
  if (cmd === "log_event") {
    logs.push({ payload: (args?.payload ?? {}) as Captured["payload"], labelAtLog: win.label });
  }
  return Promise.resolve(null);
};
