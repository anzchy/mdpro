/**
 * ADR-0031 WI-4 — the `theme:changed` subscription in `src/hooks/useTheme.ts`.
 *
 * The cleanup at `useTheme.ts:36-38` already calls `unlisten()`. The defect is
 * narrower than "no cancellation": `unlisten` is assigned only inside `.then()`,
 * so a cleanup that runs BEFORE `listen()` resolves leaves the handler the
 * boundary registers afterwards live forever.
 *
 * The user-visible symptom is not "a listener leaked". A leaked handler is by
 * definition one that was never torn down, so it keeps a closure over the old
 * `mode === "system"`; the next OS theme event passes that stale guard and
 * overwrites an explicit choice. The bug report reads: "I chose Dark and it
 * flipped back to Light on its own."
 *
 * Two laws are asserted here:
 *   Law 1 (handler conservation) — once every pending `listen()` has settled,
 *     the live `theme:changed` handler count is 1 if the hook is mounted in
 *     `system` mode and 0 otherwise.
 *   Law 2 — no `theme:changed` event may write `resolvedTheme` while the
 *     store's mode is not `"system"`. Not implied by Law 1: there are real
 *     windows (a store write not yet flushed into a React teardown) in which a
 *     handler is legitimately still registered while the mode has changed.
 *     Satisfiable only by reading the store at fire time.
 *
 * Mock boundary: `@tauri-apps/api/event` only, and it is a REAL in-memory event
 * bus (shaped after `tests/window-close-guard-listener.test.ts:31-85`), not a
 * `vi.fn()`. `themeStore` and `preferencesService`'s browser branch are real, so
 * every assertion lands on store state or on the bus's own `Set` — never on a
 * call record, which a hook that registers and never removes would satisfy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const { bus } = vi.hoisted(() => {
  type BusHandler = (event: { payload: unknown }) => void;

  const state = {
    /** Handlers the boundary considers live. A leak shows up here as an extra entry. */
    handlers: new Map<string, Set<BusHandler>>(),
    /** Subscriptions whose promise has not been resolved yet. */
    pending: [] as Array<() => void>,
    /** When false, `listen()` stays pending until the test drains `pending`. */
    autoResolve: true,
    /** When set, `listen()` rejects with it (the web-preview / no-events case). */
    failure: null as Error | null,
    /** How many times the hook called `listen()` at all. */
    subscribeCount: 0,
  };

  return {
    bus: {
      state,
      count(evt: string): number {
        return state.handlers.get(evt)?.size ?? 0;
      },
      emit(evt: string, payload: unknown): void {
        [...(state.handlers.get(evt) ?? [])].forEach((handler) => handler({ payload }));
      },
      listen(evt: string, handler: BusHandler): Promise<() => void> {
        state.subscribeCount += 1;
        if (state.failure) return Promise.reject(state.failure);
        return new Promise<() => void>((resolve) => {
          const settle = () => {
            const set = state.handlers.get(evt) ?? new Set<BusHandler>();
            set.add(handler);
            state.handlers.set(evt, set);
            resolve(() => {
              set.delete(handler);
            });
          };
          if (state.autoResolve) settle();
          else state.pending.push(settle);
        });
      },
      /** Resolve every in-flight `listen()`, in registration or reverse order. */
      drain(order: "forward" | "reverse" = "forward"): void {
        const settles = [...state.pending];
        state.pending = [];
        if (order === "reverse") settles.reverse();
        settles.forEach((settle) => settle());
      },
      reset(): void {
        state.handlers.clear();
        state.pending = [];
        state.autoResolve = true;
        state.failure = null;
        state.subscribeCount = 0;
      },
    },
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: (evt: string, handler: (event: { payload: unknown }) => void) => bus.listen(evt, handler),
}));

import { useTheme } from "../src/hooks/useTheme";
import { useThemeStore } from "../src/stores/themeStore";

const EVT = "theme:changed";

/** Flush React effects and the microtask queue the boundary's `.then()` rides on. */
const tick = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

/** Let node surface any unhandled rejection (it fires on a macrotask turn). */
const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const mountTheme = () => renderHook(() => useTheme());

beforeEach(() => {
  bus.reset();
  // jsdom provides no `matchMedia`. Without this stub `getSystemTheme` throws and
  // the catch at `useTheme.ts:16-18` sets "light" anyway — making every baseline
  // accidental rather than chosen. `matches: false` => a deterministic "light".
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  useThemeStore.setState({ mode: "system", resolvedTheme: "light", activeTheme: null });
});

afterEach(() => {
  useThemeStore.setState({ mode: "system", resolvedTheme: "light", activeTheme: null });
});

describe("useTheme — theme:changed subscription lifecycle (ADR-0031 WI-4)", () => {
  it("WI4-A: a cleanup that beats listen() leaves no handler and no store write", async () => {
    bus.state.autoResolve = false;

    const { unmount } = mountTheme();
    await tick();

    // Precondition: the subscription is genuinely in flight, not already settled.
    expect(bus.state.subscribeCount).toBe(1);
    expect(bus.count(EVT)).toBe(0);
    expect(useThemeStore.getState().resolvedTheme).toBe("light");

    unmount();
    bus.drain();
    await tick();

    bus.emit(EVT, { theme: "dark" });

    expect(bus.count(EVT)).toBe(0);
    expect(useThemeStore.getState().resolvedTheme).toBe("light");
  });

  it("WI4-B: the listener still updates resolvedTheme while mounted, and stops at unmount", async () => {
    const { unmount } = mountTheme();
    await tick();

    await act(async () => {
      bus.emit(EVT, { theme: "dark" });
    });
    expect(useThemeStore.getState().resolvedTheme).toBe("dark");

    unmount();
    await tick();
    bus.emit(EVT, { theme: "light" });

    expect(useThemeStore.getState().resolvedTheme).toBe("dark");
  });

  it("WI4-C: Law 1 — every sequence ending unmounted leaves zero handlers", async () => {
    // 1. mount -> unmount
    {
      const h = mountTheme();
      await tick();
      h.unmount();
      bus.drain();
      await tick();
      expect(bus.count(EVT), "sequence 1: mount -> unmount").toBe(0);
    }

    // 2. mount -> setMode(dark) -> setMode(system) -> unmount, with mid-sequence checkpoints
    {
      bus.reset();
      useThemeStore.setState({ mode: "system", resolvedTheme: "light" });
      const h = mountTheme();
      await tick();
      expect(bus.count(EVT), "sequence 2: mounted in system mode").toBe(1);

      await act(async () => {
        useThemeStore.getState().setMode("dark");
      });
      await tick();
      expect(bus.count(EVT), "sequence 2: after setMode(dark)").toBe(0);

      await act(async () => {
        useThemeStore.getState().setMode("system");
      });
      await tick();
      expect(bus.count(EVT), "sequence 2: back in system mode").toBe(1);

      h.unmount();
      bus.drain();
      await tick();
      expect(bus.count(EVT), "sequence 2: after unmount").toBe(0);
    }

    // 3. rapid remount x3 with the boundary pending throughout, drained at the end
    {
      bus.reset();
      bus.state.autoResolve = false;
      useThemeStore.setState({ mode: "system", resolvedTheme: "light" });
      for (let i = 0; i < 3; i += 1) {
        const h = mountTheme();
        await tick();
        h.unmount();
      }
      bus.drain();
      await tick();
      expect(bus.state.subscribeCount, "sequence 3: three subscriptions were attempted").toBe(3);
      expect(bus.count(EVT), "sequence 3: rapid remount x3").toBe(0);
    }

    // 4. (mount -> unmount) x2, pending drained only after BOTH unmounts
    {
      bus.reset();
      bus.state.autoResolve = false;
      useThemeStore.setState({ mode: "system", resolvedTheme: "light" });
      const a = mountTheme();
      await tick();
      a.unmount();
      const b = mountTheme();
      await tick();
      b.unmount();
      bus.drain();
      await tick();
      expect(bus.count(EVT), "sequence 4: interleaved mount/unmount x2").toBe(0);
    }

    // 5. mount -> setMode(light) -> unmount (never resubscribes)
    {
      bus.reset();
      useThemeStore.setState({ mode: "system", resolvedTheme: "light" });
      const h = mountTheme();
      await tick();
      await act(async () => {
        useThemeStore.getState().setMode("light");
      });
      await tick();
      h.unmount();
      bus.drain();
      await tick();
      expect(bus.count(EVT), "sequence 5: mount -> setMode(light) -> unmount").toBe(0);
    }
  });

  it("WI4-D: a mode change tears the listener down and resolves without the bus", async () => {
    for (const mode of ["dark", "light"] as const) {
      bus.reset();
      useThemeStore.setState({ mode: "system", resolvedTheme: "light" });
      const h = mountTheme();
      await tick();
      expect(bus.count(EVT), `${mode}: mounted in system mode`).toBe(1);

      await act(async () => {
        useThemeStore.getState().setMode(mode);
      });
      await tick();

      expect(useThemeStore.getState().resolvedTheme, `${mode}: resolved by the else branch`).toBe(
        mode,
      );
      expect(bus.count(EVT), `${mode}: no handler survives the mode change`).toBe(0);

      // An explicit theme choice must not be overridden by an OS event.
      const opposite = mode === "dark" ? "light" : "dark";
      bus.emit(EVT, { theme: opposite });
      expect(useThemeStore.getState().resolvedTheme, `${mode}: OS event ignored`).toBe(mode);

      h.unmount();
      await tick();
    }
  });

  it("WI4-E: a rejecting listen() leaves no handler and no unhandled rejection", async () => {
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      bus.state.failure = new Error("events unsupported");

      const h = mountTheme();
      await tick();
      await macrotask();

      expect(bus.state.subscribeCount, "listen() was attempted").toBe(1);
      expect(bus.count(EVT)).toBe(0);
      expect(useThemeStore.getState().resolvedTheme).toBe("light");

      h.unmount();
      await tick();
      await macrotask();

      expect(bus.count(EVT)).toBe(0);
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it.each(["forward", "reverse"] as const)(
    "WI4-F: a sequence ending mounted leaves exactly one LIVE handler and no orphan (%s drain)",
    async (order) => {
      bus.state.autoResolve = false;

      const h1 = mountTheme();
      await tick();
      h1.unmount();

      const h2 = mountTheme();
      await tick();

      expect(bus.state.subscribeCount, "both subscriptions are in flight").toBe(2);

      bus.drain(order);
      await tick();

      // Law 1, the `= 1` half: exactly one handler, and it is listen2's.
      expect(bus.count(EVT), `${order}: exactly one live handler after the drain`).toBe(1);

      await act(async () => {
        bus.emit(EVT, { theme: "dark" });
      });
      // Liveness: the survivor is the mounted hook's handler, not a leaked corpse
      // that happens to make the count right.
      expect(useThemeStore.getState().resolvedTheme, `${order}: the survivor is live`).toBe("dark");

      await act(async () => {
        useThemeStore.getState().setMode("dark");
      });
      await tick();

      expect(bus.count(EVT), `${order}: the mode change removes the handler`).toBe(0);
      expect(useThemeStore.getState().resolvedTheme).toBe("dark");

      // Law 2, the orphan route. The user chose Dark; the OS says Light; Dark stands.
      bus.emit(EVT, { theme: "light" });
      expect(
        useThemeStore.getState().resolvedTheme,
        `${order}: an explicit Dark choice is not overwritten`,
      ).toBe("dark");

      h2.unmount();
      bus.drain();
      await tick();
    },
  );

  it("WI4-G: Law 2 — a live handler declines to write once the store's mode changed", async () => {
    const h = mountTheme();
    await tick();
    expect(bus.count(EVT), "the handler is registered").toBe(1);

    // Deliberately OUTSIDE act(): React must not flush the effect teardown. This
    // is the production window — `setThemeMode` writes the store, then awaits an
    // IPC, and an OS `theme:changed` can be delivered during that await.
    useThemeStore.setState({ mode: "dark", resolvedTheme: "dark" });

    // Precondition guard, not decoration: if React has already flushed and the
    // handler is gone, the assertion below would pass vacuously. A failure here
    // means the window closed and the case needs redesigning.
    expect(bus.count(EVT), "precondition: the window is open").toBe(1);

    bus.emit(EVT, { theme: "light" });

    expect(useThemeStore.getState().resolvedTheme).toBe("dark");

    // Positive control: the guard must decline, not be permanently off.
    await act(async () => {
      useThemeStore.getState().setMode("system");
    });
    await tick();
    // Re-entering system mode runs `applySystemTheme`, which resolves to "light"
    // under the stubbed matchMedia. Flip the baseline so the emit below is not
    // vacuously satisfied by a handler that never writes at all.
    await act(async () => {
      useThemeStore.getState().setResolvedTheme("dark");
    });
    expect(bus.count(EVT), "the listener is back").toBe(1);

    await act(async () => {
      bus.emit(EVT, { theme: "light" });
    });
    expect(useThemeStore.getState().resolvedTheme).toBe("light");

    h.unmount();
    await tick();
  });
});
