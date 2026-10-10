/**
 * @module tests/support/menuEventsHarness
 * Purpose: the Tauri boundary fakes for the `useMenuEvents` suites, shared by
 * the unit and slow tiers (ADR-0050): `use-menu-events-subscription` /
 * `.slow` (A1–A9, B1–B4) and `use-menu-events-logging` / `.slow` (B1b–D4).
 *
 * Contents:
 *   - `bus` — a REAL in-memory `menu:action` bus with deferred `listen()`
 *     resolution (shaped after `tests/use-theme-listener-cancellation.test.ts`),
 *     so "live subscriptions" is the bus's own `Set` size, never a call record.
 *     It also keeps the D3 outcome model (`liveTags`, `resolvedWhileLive`,
 *     `resolvedAfterCleanup`, `rejected`).
 *   - `win` — `{ label, isFocused }` with a scriptable focus result.
 *   - `logs` — every `invoke("log_event")` payload, with the label at log time.
 *   - `eventModuleMock`, `windowModuleMock`, `invokeCapturingLogs` — the bodies
 *     of the three `vi.mock` factories.
 *
 * Key decisions:
 *   - **No `src/` or Tauri imports.** `vi.mock` factories are hoisted, so each
 *     test file still declares its own three mocks and reaches this module with
 *     a dynamic import inside the factory. A module that imported the hook would
 *     re-enter the factory that is loading it.
 *
 * Not a `*.test.ts`, so vitest does not collect it.
 *
 * @coordinates-with tests/support/menuEventsDomain.ts — the hook-side helpers
 */

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

export const bus = {
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

export const win = {
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions read arbitrary payload fields
export type Captured = { payload: Record<string, any>; labelAtLog: string };

export const logs: Captured[] = [];

/** Body of the `@tauri-apps/api/event` mock. */
export const eventModuleMock = () => ({
  listen: (evt: string, handler: BusHandler) => bus.listen(evt, handler),
});

/** Body of the `@tauri-apps/api/window` mock. */
export const windowModuleMock = () => ({
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
});

/** The `invoke` of the `@tauri-apps/api/core` mock: captures `log_event` lines. */
export const invokeCapturingLogs = (cmd: string, args?: { payload?: Record<string, unknown> }) => {
  if (cmd === "log_event") {
    logs.push({ payload: (args?.payload ?? {}) as Captured["payload"], labelAtLog: win.label });
  }
  return Promise.resolve(null);
};
