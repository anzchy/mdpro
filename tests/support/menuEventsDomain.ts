/**
 * @module tests/support/menuEventsDomain
 * Purpose: the hook-side domain shared by the `useMenuEvents` suites split
 * across the unit and slow tiers (ADR-0050): `use-menu-events-subscription` /
 * `.slow` (A9), `use-menu-events-logging` / `.slow` (D3) and
 * `d261-menu-target-routing`. One definition, so the slow property draws from
 * exactly the rows, handlers, labels and targets the unit cases pin.
 *
 * Contents: `EVT`, `calls` / `callTokens` / `makeHandlers` / `mountHook`,
 * `flush` / `macrotask`, the log readers (`menuLogs`, `statuses`,
 * `uiMenuLines`, `collected`, `collectAndClearLogs`), `resetMenuHarness`, the
 * dispatch table `ROWS` / `payloadOf` and `HANDLER_KEYS` (re-exported from
 * menuActionRows.ts), the property pools `TARGETS` / `LABELS`,
 * `mulberry32`, and `expectMenuLineShape` (D4's invariants 1-6).
 *
 * The handler's trailing D261 token is recorded in `callTokens`, index-aligned
 * with `calls`, and kept out of `calls[i].args`: `args` stays the D31 shape
 * `[...value args, actionId]`, and the token cases read `callTokens`.
 *
 * Callers must mock `@tauri-apps/api/window` and `@tauri-apps/api/core` in
 * the test file itself, and may mock `@tauri-apps/api/event` (see
 * menuEventsHarness.ts); this module imports the hook and so cannot be reached
 * from a mock factory.
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
/** The token each call received (`undefined` when none), index-aligned with `calls`. */
export const callTokens: unknown[] = [];

/** A D261 menu-target token: the only object argument a handler receives. */
const isToken = (arg: unknown): boolean =>
  typeof arg === "object" && arg !== null && "windowLabel" in arg && "generation" in arg;

/** All 14 handlers (less `omit`); each records which render generation's identity ran. */
export const makeHandlers = (gen: number, omit?: HandlerKey): Handlers => {
  const h: Record<string, (...args: unknown[]) => void> = {};
  for (const key of HANDLER_KEYS) {
    if (key === omit) continue;
    h[key] = (...args: unknown[]) => {
      const last = args[args.length - 1];
      const hasToken = isToken(last);
      calls.push({ gen, key, args: hasToken ? args.slice(0, -1) : args });
      callTokens.push(hasToken ? last : undefined);
    };
  }
  return h as Handlers;
};

export const mountHook = (h: Handlers, strict = false) =>
  renderHook(({ h: handlers }: { h: Handlers }) => useMenuEvents(handlers), {
    initialProps: { h },
    ...(strict ? { wrapper: StrictMode } : {}),
  });

/** Settle effects, the boundary's `.then()`/`.catch()` and every delivery. */
export const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    // Under a loaded, coverage-instrumented run, wait until every delivery the
    // bus started has returned, then one more turn for the microtasks after
    // it. Bounded: a stuck run falls through to the assertions, which then
    // fail with a real message.
    for (let i = 0; i < QUIESCE_MAX_TURNS && bus.state.handled < bus.state.delivered; i++) {
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
  callTokens.length = 0;
  useLoggingStore.setState({ enabled: true, level: "info" });
};

// ---------------------------------------------------------------------------
// Property pools (A9, D3)
// ---------------------------------------------------------------------------

/** Whom a payload is addressed to, relative to the mount it reaches (D261). */
export const TARGETS = ["self", "other", "missing"] as const;
export const LABELS = ["main", "mdpro-2", "mdpro-9"] as const;

// ---------------------------------------------------------------------------
// D4 — the allowed shape of one ui.menu.* line
// ---------------------------------------------------------------------------

const ALLOWED_CONTEXT_KEYS = new Set(["controlId", "windowLabel", "mode", "filePath", "reason", "stage"]);
/** Allowed only on a `ui.menu.select` `cancel` line (D261's wrong_target / stale). */
const CANCEL_ONLY_KEYS = new Set(["reason", "stage"]);

/** D4 invariants 1-6 over each `ui.menu.*` line (non-vacuity is the caller's). */
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
    // 3. listen carries exactly { windowLabel }; no focus_check line exists (D261)
    if (payload.event === "ui.menu.listen") {
      expect(keys, `invariant 3: ${at}`).toEqual(["windowLabel"]);
    }
    expect(payload.event, `invariant 3 (no focus_check): ${at}`).not.toBe("ui.menu.focus_check");
    // 4. info level
    expect(payload.level, `invariant 4: ${at}`).toBe("info");
    // 5. select lines carry the writing window's label
    if (payload.event === "ui.menu.select") {
      expect(typeof context.windowLabel, `invariant 5 (present): ${at}`).toBe("string");
      expect(context.windowLabel, `invariant 5 (equals labelAtLog): ${at}`).toBe(labelAtLog);
    }
    // 6. reason / stage only on a select cancel line
    for (const key of keys.filter((k) => CANCEL_ONLY_KEYS.has(k))) {
      expect(
        payload.event === "ui.menu.select" && payload.status === "cancel",
        `invariant 6 (${key} only on a select cancel): ${at}`,
      ).toBe(true);
    }
  }
}
