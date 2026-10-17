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
 *   - a payload addressed to another window runs nothing and writes one
 *     `ui.menu.select` `cancel` / `wrong_target` line (C1, D261);
 *   - no `ui.menu.focus_check` line is ever written: D261 removed the focus
 *     query and its fail-open path (C2, and D4 invariant 3).
 *
 * Law L-D (outcome conservation, per outcome) is asserted at S5 by D3, which
 * runs in the slow tier: `use-menu-events-logging.slow.test.ts` (ADR-0050, D124).
 * The log-line shape is asserted at S4 by D4, which runs last in this file over
 * every line this file captured; the slow file runs the same D4 invariants over
 * D3's lines.
 *
 * Mock boundary: only the three Tauri modules, shared with
 * `tests/use-menu-events-subscription.test.ts` (WI-1) through
 * `tests/support/menuEventsHarness.ts`. The window module's `listen` is a real
 * in-memory, label-routed bus with deferred resolution; `loggingService` and
 * `loggingStore` are real; `invoke("log_event")` captures the JSONL payload.
 * The hook-side helpers come from `tests/support/menuEventsDomain.ts`. Two
 * windows are modelled in `tests/d261-menu-target-routing.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", async () => (await import("./support/menuEventsHarness")).eventModuleMock());
vi.mock("@tauri-apps/api/window", async () => (await import("./support/menuEventsHarness")).windowModuleMock());
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (await import("./support/menuEventsHarness")).invokeCapturingLogs,
}));

import { bus, win } from "./support/menuEventsHarness";
import {
  calls,
  collectAndClearLogs,
  collected,
  EVT,
  expectMenuLineShape,
  flush,
  macrotask,
  makeHandlers,
  menuLogs,
  mountHook,
  payloadOf,
  resetMenuHarness,
  ROWS,
  statuses,
} from "./support/menuEventsDomain";

beforeEach(() => {
  resetMenuHarness();
});

afterEach(() => {
  collectAndClearLogs();
  vi.restoreAllMocks();
});

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
// C — the target filter (D261; replaces the focus gate)
// ---------------------------------------------------------------------------

// Rule-12 reason for C1–C3 (D261-WI-1c): the fail-open spec (act when
// isFocused() rejects) is the defect D261 removes; the focus query no longer
// exists. C1 ("an unfocused window runs nothing and logs nothing") becomes the
// target filter, which logs one wrong_target cancel; C2 and C3 (one
// focus_check fail line per rejected focus check, with a fixed reason) are
// replaced by "no focus_check line is ever written", since a spec about the
// focus check's failure has no subject.
describe("useMenuEvents — target filter (D261)", () => {
  it("C1: a payload for another window runs no handler and writes one wrong_target cancel each", async () => {
    win.label = "mdpro-3";
    const h = mountHook(makeHandlers(0));
    await flush();
    for (const action of ["file.new_window", "file.save", "theme.light"]) {
      bus.emitAny(EVT, { action, target: "mdpro-9" });
      await flush();
    }

    expect(calls).toEqual([]);
    const select = menuLogs("ui.menu.select");
    expect(select.map((l) => [l.payload.status, l.payload.context])).toEqual(
      Array(3).fill(["cancel", { windowLabel: "mdpro-3", reason: "wrong_target" }]),
    );

    // Positive control: the same mount acts on a payload addressed to it.
    bus.emit(EVT, { action: "file.save" });
    await flush();
    expect(calls).toEqual([{ gen: 0, key: "onSave", args: [expect.any(String)] }]);
    expect(menuLogs("ui.menu.select").filter((l) => l.payload.status === "success")).toHaveLength(1);
    h.unmount();
  });

  it("C2: no ui.menu.focus_check line is ever written, acting or refusing", async () => {
    win.label = "mdpro-3";
    const h = mountHook(makeHandlers(0));
    await flush();
    for (let i = 0; i < 3; i++) {
      bus.emit(EVT, { action: "file.new" });
      bus.emitAny(EVT, { action: "file.new", target: "mdpro-2" });
      bus.emitAny(EVT, { action: "file.new" });
      await flush();
    }

    expect(calls).toHaveLength(3);
    expect(menuLogs("ui.menu.select")).toHaveLength(9);
    expect(menuLogs("ui.menu.focus_check")).toHaveLength(0);
    h.unmount();
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

// The 200-lifecycle D3 property (~8–9 s) runs in the slow tier:
// use-menu-events-logging.slow.test.ts (ADR-0050, D124).

// ---------------------------------------------------------------------------
// D4 — property over every captured line in this file (runs last)
// ---------------------------------------------------------------------------

describe("useMenuEvents — D4 property: every ui.menu.* line has the allowed shape (runs last)", () => {
  it("D4: every captured ui.menu.* line obeys invariants 1-6", () => {
    const lines = collected.filter((l) => String(l.payload.event).startsWith("ui.menu."));

    // Non-vacuity: every event/status class the earlier cases produce is present.
    const kinds = new Set(lines.map((l) => `${l.payload.event}/${l.payload.status}`));
    for (const kind of [
      "ui.menu.select/success",
      "ui.menu.listen/success",
      "ui.menu.listen/cancel",
      "ui.menu.listen/fail",
      // D261: focus_check/fail no longer exists (rule-12 reason at C above);
      // the wrong_target cancel is the class that took its place.
      "ui.menu.select/cancel",
    ]) {
      expect(kinds.has(kind), `collected lines include ${kind}`).toBe(true);
    }
    const selectIds = new Set(
      lines.filter((l) => l.payload.event === "ui.menu.select").map((l) => l.payload.context?.controlId),
    );
    for (const row of ROWS) expect(selectIds.has(row.controlId), `select for ${row.controlId}`).toBe(true);

    expectMenuLineShape(lines);
  });
});
