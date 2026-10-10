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
 * Law L-D (outcome conservation, per outcome) is asserted at S5 by D3, which
 * runs in the slow tier: `use-menu-events-logging.slow.test.ts` (ADR-0050, D124).
 * The log-line shape is asserted at S4 by D4, which runs last in this file over
 * every line this file captured; the slow file runs the same D4 invariants over
 * D3's lines.
 *
 * Mock boundary: only the three Tauri modules, shared with
 * `tests/use-menu-events-subscription.test.ts` (WI-1) through
 * `tests/support/menuEventsHarness.ts`. The event module is a real in-memory
 * bus with deferred resolution; `loggingService` and `loggingStore` are real;
 * `invoke("log_event")` captures the JSONL payload. The hook-side helpers come
 * from `tests/support/menuEventsDomain.ts`.
 *
 * Not modelled here: two windows receiving one broadcast click. jsdom has one
 * module-global `getCurrentWindow`, and the Tauri JS mocks do not target a
 * window (D30). That case is covered only by the E2E-D31-device run.
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

// The 200-lifecycle D3 property (~8–9 s) runs in the slow tier:
// use-menu-events-logging.slow.test.ts (ADR-0050, D124).

// ---------------------------------------------------------------------------
// D4 — property over every captured line in this file (runs last)
// ---------------------------------------------------------------------------

describe("useMenuEvents — D4 property: every ui.menu.* line has the allowed shape (runs last)", () => {
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

    expectMenuLineShape(lines);
  });
});
