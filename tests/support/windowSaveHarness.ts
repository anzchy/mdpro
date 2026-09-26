/**
 * Shared harness for the WI-3 (ADR-0031 step 5a) `saveWindowState` suites:
 * `tests/window-state-save-main-only.test.tsx` and
 * `tests/window-state-save-order-redaction.test.tsx`.
 *
 * A copy of the `vi.hoisted` fake in `tests/window-geometry-save-path.test.tsx`
 * (which stays unedited), plus three additions:
 * - `state.label`, read through a getter on `win.label`
 * - `state.order`: `scaleFactor`, `innerSize` and `outerPosition` push their
 *   name when **called**, before they resolve
 * - `state.scaleGate`: when set, `scaleFactor()` awaits it before returning
 *
 * This module imports no application code on purpose. The test files'
 * `vi.mock` factories import it lazily, and a static app import here would
 * make the `@tauri-apps/api/core` factory import a module still evaluating.
 */
import { vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

export type Sized = { width: number; height: number };
export type Positioned = { x: number; y: number };

export interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

export function deferred(): Deferred {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

export const state = {
  label: "main",
  scale: 1,
  size: { width: 1024, height: 768 } as Sized,
  position: { x: 0, y: 0 } as Positioned,
  maximized: false,
  scaleFactorError: null as Error | null,
  order: [] as string[],
  scaleGate: null as Deferred | null,
};

export const win = {
  get label() {
    return state.label;
  },
  scaleFactor: async () => {
    state.order.push("scaleFactor");
    if (state.scaleGate) await state.scaleGate.promise;
    if (state.scaleFactorError) throw state.scaleFactorError;
    return state.scale;
  },
  innerSize: async () => {
    state.order.push("innerSize");
    return { ...state.size };
  },
  outerPosition: async () => {
    state.order.push("outerPosition");
    return { ...state.position };
  },
  isMaximized: async () => state.maximized,
  onCloseRequested: async (_handler: unknown) => () => {},
  close() {},
};

export const invokeMock = vi.fn(async (..._args: unknown[]): Promise<unknown> => null);

export function resetHarness(): void {
  state.label = "main";
  state.scale = 1;
  state.size = { width: 1024, height: 768 };
  state.position = { x: 0, y: 0 };
  state.maximized = false;
  state.scaleFactorError = null;
  state.order = [];
  state.scaleGate = null;
  invokeMock.mockReset();
  invokeMock.mockImplementation(async () => null);
}

/** Configure the window fake for one case. */
export function givenWindow(opts: {
  label?: string;
  scale?: number;
  size?: Sized;
  position?: Positioned;
  maximized?: boolean;
  scaleFactorError?: Error;
}): void {
  if (opts.label !== undefined) state.label = opts.label;
  if (opts.scale !== undefined) state.scale = opts.scale;
  if (opts.size) state.size = opts.size;
  if (opts.position) state.position = opts.position;
  if (opts.maximized !== undefined) state.maximized = opts.maximized;
  if (opts.scaleFactorError) state.scaleFactorError = opts.scaleFactorError;
}

export function callsFor(command: string) {
  return invokeMock.mock.calls.filter(([c]) => c === command);
}

export function windowStatePayload() {
  const call = callsFor("save_window_state")[0];
  return (call?.[1] as { windowState: Record<string, unknown> } | undefined)?.windowState;
}

export function geometryPayload() {
  const call = callsFor("save_window_geometry")[0];
  return (call?.[1] as { geometry: Record<string, unknown> } | undefined)?.geometry;
}

export function logCalls(): Record<string, unknown>[] {
  return callsFor("log_event").map(
    ([, args]) => (args as { payload: Record<string, unknown> }).payload,
  );
}

export function skipLogs(): Record<string, unknown>[] {
  return logCalls().filter(
    (p) =>
      p.event === "window.save_state" &&
      (p.context as Record<string, unknown> | undefined)?.outcome === "skipped",
  );
}

/** Every primitive leaf of a nested value (objects and arrays walked). */
export function deepLeaves(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(deepLeaves);
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(deepLeaves);
  }
  return [value];
}

/**
 * Mount the hook and let its effect's dynamic import settle, then start a save
 * WITHOUT awaiting it and outside any `act` scope (WI3-09). Nesting an
 * unawaited `act` inside the caller's flush `act`s corrupts React's act queue
 * for every later case, so the save is started bare and awaited by `finish`.
 */
export async function mountAndStartSave(
  useHook: () => { saveWindowState: () => Promise<void> },
): Promise<{ finish: () => Promise<void> }> {
  const view = renderHook(() => useHook());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const running = view.result.current.saveWindowState();
  return {
    finish: async () => {
      await act(async () => {
        await running;
      });
      view.unmount();
    },
  };
}

/** Mount the hook, let its effect's dynamic import settle, save, unmount. */
export async function mountAndSave(
  useHook: () => { saveWindowState: () => Promise<void> },
): Promise<unknown> {
  const view = renderHook(() => useHook());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  let settled: unknown = "not-settled";
  await act(async () => {
    settled = await view.result.current.saveWindowState();
  });
  view.unmount();
  return settled;
}
