/**
 * @module tests/support/menuEventsDomain
 * Purpose: the hook-side domain shared by the `useMenuEvents` suites split
 * across the unit and slow tiers (ADR-0050): `use-menu-events-subscription` /
 * `.slow` (A9) and `use-menu-events-logging` / `.slow` (D3). One definition, so
 * the slow property draws from exactly the rows, handlers, labels and focus
 * results the unit cases pin.
 *
 * Contents: `EVT`, `calls` / `makeHandlers` / `mountHook`,
 * `flush` / `macrotask`, the log readers (`menuLogs`, `statuses`,
 * `uiMenuLines`, `collected`, `collectAndClearLogs`), `resetMenuHarness`, the
 * dispatch table `ROWS` / `payloadOf` and `HANDLER_KEYS` (re-exported from
 * menuActionRows.ts), the property pools `FOCI` / `LABELS`,
 * `mulberry32`, and `expectMenuLineShape` (D4's invariants 1-5).
 *
 * Callers must mock `@tauri-apps/api/event`, `@tauri-apps/api/window` and
 * `@tauri-apps/api/core` in the test file itself (see menuEventsHarness.ts);
 * this module imports the hook and so cannot be reached from a mock factory.
 *
 * Not a `*.test.ts`, so vitest does not collect it.
 *
 * @coordinates-with tests/support/menuEventsHarness.ts — bus, win and logs
 * @coordinates-with tests/support/menuActionRows.ts — the dispatch table rows
 */
import { StrictMode } from "react";
import { expect } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useMenuEvents } from "../../src/hooks/useMenuEvents";
import { useLoggingStore } from "../../src/stores/loggingStore";
import { bus, logs, win, type Captured } from "./menuEventsHarness";
import { HANDLER_KEYS, type HandlerKey } from "./menuActionRows";

// The dispatch table and handler keys live in menuActionRows.ts (no src/ imports),
// re-exported here so the useMenuEvents suites import them unchanged (D261-WI-1a).
export { HANDLER_KEYS, ROWS, payloadOf, type HandlerKey, type Row } from "./menuActionRows";

export { mulberry32 } from "./seededRandom";

export const EVT = "menu:action";
const QUIESCE_MAX_TURNS = 500;

export type Call = { gen: number; key: HandlerKey; args: unknown[] };
export type Handlers = Parameters<typeof useMenuEvents>[0];

export const calls: Call[] = [];

/** All 14 handlers (less `omit`); each records which render generation's identity ran. */
export const makeHandlers = (gen: number, omit?: HandlerKey): Handlers => {
  const h: Record<string, (...args: unknown[]) => void> = {};
  for (const key of HANDLER_KEYS) {
    if (key === omit) continue;
    h[key] = (...args: unknown[]) => {
      calls.push({ gen, key, args });
    };
  }
  return h as Handlers;
};

export const mountHook = (h: Handlers, strict = false) =>
  renderHook(({ h: handlers }: { h: Handlers }) => useMenuEvents(handlers), {
    initialProps: { h },
    ...(strict ? { wrapper: StrictMode } : {}),
  });

/** Settle effects, the boundary's `.then()`/`.catch()`, the dynamic import and `isFocused()`. */
export const flush = async () => {
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

export const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export const menuLogs = (event: string) => logs.filter((l) => l.payload.event === event);
export const statuses = (event: string) => menuLogs(event).map((l) => l.payload.status as string);
export const uiMenuLines = () => logs.filter((l) => String(l.payload.event).startsWith("ui.menu."));

/** Every captured line a file has cleared so far; the logging suites' D4 reads it. */
export const collected: Captured[] = [];

export const collectAndClearLogs = () => {
  collected.push(...logs);
  logs.length = 0;
};

/** The shared `beforeEach`: fresh bus, window, logs and calls; logging on at info. */
export const resetMenuHarness = () => {
  bus.reset();
  win.reset();
  logs.length = 0;
  calls.length = 0;
  useLoggingStore.setState({ enabled: true, level: "info" });
};

// ---------------------------------------------------------------------------
// Property pools (A9, D3)
// ---------------------------------------------------------------------------

export const FOCI = ["true", "false", "reject"] as const;
export const LABELS = ["main", "mdpro-2", "mdpro-9"] as const;

// ---------------------------------------------------------------------------
// D4 — the allowed shape of one ui.menu.* line
// ---------------------------------------------------------------------------

const ALLOWED_CONTEXT_KEYS = new Set(["controlId", "windowLabel", "mode", "filePath"]);

/** D4 invariants 1-5 over each `ui.menu.*` line (non-vacuity is the caller's). */
export function expectMenuLineShape(lines: readonly Captured[]): void {
  for (const { payload, labelAtLog } of lines) {
    const at = JSON.stringify(payload);
    const context = (payload.context ?? {}) as Record<string, unknown>;
    const keys = Object.keys(context);
    // 1. allowed key set
    for (const key of keys) expect(ALLOWED_CONTEXT_KEYS.has(key), `invariant 1 key ${key}: ${at}`).toBe(true);
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
}
