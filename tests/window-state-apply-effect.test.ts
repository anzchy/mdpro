// @vitest-environment node
/**
 * WI-4 (D24 follow-up) — the `applyWindowState` effect, extracted from App.tsx
 * into `src/services/windowStateApplier.ts`.
 *
 * Cases we1, we1b, we2-we6 of the matrix
 * `.claude/tdd-guardian/tests-20260926-062337.md`.
 *
 * Law: no non-`main` window is moved or resized by hydration (the Finding 0
 * regression: every window was forced to 100,100 / 1200x800), and for `main`
 * the window calls are exactly the ones the pure action names.
 *
 * Mocks only at boundaries: `@tauri-apps/api/window` (no window server in
 * jsdom) and `@tauri-apps/api/core` `invoke` (the `log_event` IPC); the real
 * `loggingService` runs, with `useLoggingStore` opened to every level. Paired
 * real paths: device checks D-2 and D-4 (gui-acceptance, later session).
 *
 * D24 review: the `-L1` cases assert the action `applyAndReportWindowState`
 * returns (Level 1) for the same inputs as we1-we6, and `ws1`/`ws2` pin the
 * degenerate-scale fallback. The recorded we1/we4 `toBeUndefined` lines keep
 * `applyWindowState` itself `void`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { win, ipc } = vi.hoisted(() => {
  class LogicalSize {
    constructor(
      public width: number,
      public height: number,
    ) {}
  }
  class LogicalPosition {
    constructor(
      public x: number,
      public y: number,
    ) {}
  }
  return {
    win: {
      label: "main",
      throwOnGet: false,
      setSize: vi.fn(async (_s: unknown) => {}),
      setPosition: vi.fn(async (_p: unknown) => {}),
      maximize: vi.fn(async () => {}),
      currentMonitor: vi.fn(async (): Promise<unknown> => null),
      LogicalSize,
      LogicalPosition,
    },
    ipc: { invoke: vi.fn(async (_cmd: string, _args?: unknown): Promise<unknown> => null) },
  };
});

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => {
    if (win.throwOnGet) throw new Error("not in tauri");
    return {
      label: win.label,
      setSize: win.setSize,
      setPosition: win.setPosition,
      maximize: win.maximize,
    };
  },
  currentMonitor: win.currentMonitor,
  LogicalSize: win.LogicalSize,
  LogicalPosition: win.LogicalPosition,
}));
vi.mock("@tauri-apps/api/core", async () => ({ ...(await import("./support/tauriCoreMock")).createTauriCoreMock(), invoke: ipc.invoke }));

import { applyAndReportWindowState, applyWindowState } from "../src/services/windowStateApplier";
import { useLoggingStore } from "../src/stores/loggingStore";

interface LoggedEntry {
  level?: string;
  event?: string;
  context?: Record<string, unknown>;
}

const RETINA_MONITOR = {
  scaleFactor: 2,
  workArea: { position: { x: 0, y: 0 }, size: { width: 2880, height: 1800 } },
};
const DEFAULT_STATE = { width: 1200, height: 800, x: 100, y: 100, isMaximized: false };

const entries = (): LoggedEntry[] =>
  ipc.invoke.mock.calls
    .filter((call) => call[0] === "log_event")
    .map((call) => (call[1] as { payload: LoggedEntry }).payload);
const applyStateEntries = () => entries().filter((e) => e.event === "window.apply_state");
const skipEntries = () =>
  applyStateEntries().filter((e) => e.context?.outcome === "skipped");

function expectOneSkipLog() {
  const logged = applyStateEntries();
  expect(logged).toHaveLength(1);
  expect(logged[0].context).toEqual({ outcome: "skipped", reason: "not_main" });
}

beforeEach(() => {
  vi.clearAllMocks();
  win.label = "main";
  win.throwOnGet = false;
  win.currentMonitor.mockImplementation(async () => RETINA_MONITOR);
  useLoggingStore.setState({ enabled: true, level: "debug" });
});

describe("applyWindowState — non-owner windows are never moved (WI-4)", () => {
  // we1 — S2: the fixture that produced the defect (the 100,100 default state)
  it("we1: label mdpro-x logs one skip and does not touch the window", async () => {
    win.label = "mdpro-x";

    await expect(applyWindowState(DEFAULT_STATE)).resolves.toBeUndefined();

    expectOneSkipLog();
    // Level 6 supplement
    expect(win.setSize).not.toHaveBeenCalled();
    expect(win.setPosition).not.toHaveBeenCalled();
    expect(win.maximize).not.toHaveBeenCalled();
  });

  // we1b — S3: the effect must use the shared gate, not a local re-implementation
  it.each(["", "Main", "main ", "mainwindow"])(
    "we1b: near-miss label %j skips through the effect",
    async (label) => {
      win.label = label;

      await applyWindowState(DEFAULT_STATE);

      expectOneSkipLog();
      expect(win.setSize).not.toHaveBeenCalled();
      expect(win.setPosition).not.toHaveBeenCalled();
    },
  );

  // we2 — S3: the gate precedes the maximize branch in the effect
  it("we2: a non-owner with isMaximized is skipped, not maximized", async () => {
    win.label = "mdpro-y";

    await applyWindowState({ ...DEFAULT_STATE, isMaximized: true });

    expectOneSkipLog();
    expect(win.maximize).not.toHaveBeenCalled();
    expect(win.setSize).not.toHaveBeenCalled();
    expect(win.setPosition).not.toHaveBeenCalled();
  });
});

describe("applyWindowState — `main` keeps today's behaviour (WI-4)", () => {
  // we3 — S1: monitor data → logical work area → clamp → window calls
  it("we3: main converts the monitor to logical points and applies the clamped geometry", async () => {
    await applyWindowState({ width: 2400, height: 1600, x: 200, y: 200, isMaximized: false });

    expect(win.setSize).toHaveBeenCalledTimes(1);
    expect(win.setSize.mock.calls[0][0]).toEqual(new win.LogicalSize(1440, 900));
    expect(win.setPosition).toHaveBeenCalledTimes(1);
    expect(win.setPosition.mock.calls[0][0]).toEqual(new win.LogicalPosition(0, 0));
    expect(win.maximize).not.toHaveBeenCalled();
    expect(skipEntries()).toHaveLength(0);
  });

  // we4 — S3: outside Tauri the effect never throws
  it("we4: when the window API throws, the effect resolves and logs no error", async () => {
    win.throwOnGet = true;

    await expect(applyWindowState(DEFAULT_STATE)).resolves.toBeUndefined();

    expect(entries().filter((e) => e.level === "error")).toHaveLength(0);
  });

  // we5 — S2: the maximize arm
  it("we5: main + isMaximized maximizes once and does nothing else", async () => {
    await applyWindowState({ x: 9000, y: 9000, width: 100, height: 100, isMaximized: true });

    expect(win.maximize).toHaveBeenCalledTimes(1);
    expect(win.setSize).not.toHaveBeenCalled();
    expect(win.setPosition).not.toHaveBeenCalled();
    expect(skipEntries()).toHaveLength(0);
  });

  // we6 — S2: the null work-area partition reaches the window
  it("we6: main with no monitor applies the record-as-work-area fallback", async () => {
    win.currentMonitor.mockImplementation(async () => null);

    await applyWindowState({ x: -50, y: 10, width: 300, height: 200, isMaximized: false });

    expect(win.setSize).toHaveBeenCalledTimes(1);
    expect(win.setSize.mock.calls[0][0]).toEqual(new win.LogicalSize(600, 400));
    expect(win.setPosition).toHaveBeenCalledTimes(1);
    expect(win.setPosition.mock.calls[0][0]).toEqual(new win.LogicalPosition(-50, 10));
    expect(win.maximize).not.toHaveBeenCalled();
    expect(skipEntries()).toHaveLength(0);
  });
});

describe("applyAndReportWindowState — the action carried out (D24 review, Level 1)", () => {
  it("we1-L1: label mdpro-x returns skip", async () => {
    win.label = "mdpro-x";
    expect(await applyAndReportWindowState(DEFAULT_STATE)).toEqual({ kind: "skip" });
    expectOneSkipLog();
  });

  it.each(["", "Main", "main ", "mainwindow"])("we1b-L1: near-miss %j returns skip", async (label) => {
    win.label = label;
    expect(await applyAndReportWindowState(DEFAULT_STATE)).toEqual({ kind: "skip" });
  });

  it("we2-L1: a maximized non-owner returns skip", async () => {
    win.label = "mdpro-y";
    const state = { ...DEFAULT_STATE, isMaximized: true };
    expect(await applyAndReportWindowState(state)).toEqual({ kind: "skip" });
  });

  it("we3-L1: main returns the clamped set it applied", async () => {
    const state = { width: 2400, height: 1600, x: 200, y: 200, isMaximized: false };
    expect(await applyAndReportWindowState(state)).toEqual({
      kind: "set",
      geometry: { x: 0, y: 0, width: 1440, height: 900 },
    });
  });

  it("we4-L1: when the window API throws, it resolves to null", async () => {
    win.throwOnGet = true;
    expect(await applyAndReportWindowState(DEFAULT_STATE)).toBeNull();
  });

  it("we5-L1: main + isMaximized returns maximize", async () => {
    const state = { x: 9000, y: 9000, width: 100, height: 100, isMaximized: true };
    expect(await applyAndReportWindowState(state)).toEqual({ kind: "maximize" });
    expect(win.maximize).toHaveBeenCalledTimes(1);
  });

  it("we6-L1: main with no monitor returns the record-as-work-area set", async () => {
    win.currentMonitor.mockImplementation(async () => null);
    const state = { x: -50, y: 10, width: 300, height: 200, isMaximized: false };
    expect(await applyAndReportWindowState(state)).toEqual({
      kind: "set",
      geometry: { x: -50, y: 10, width: 600, height: 400 },
    });
  });
});

describe("applyWindowState — degenerate monitor scale falls back to 1 (D24 review)", () => {
  // ws1/ws2 — S3: Infinity once produced a 0x0 work area (every field / Infinity)
  it.each([Number.POSITIVE_INFINITY, Number.NaN])("ws: scaleFactor %s behaves as 1", async (scaleFactor) => {
    win.currentMonitor.mockImplementation(async () => ({ ...RETINA_MONITOR, scaleFactor }));
    const state = { width: 3000, height: 2000, x: 200, y: 200, isMaximized: false };

    await applyWindowState(state);

    expect(win.setSize).toHaveBeenCalledTimes(1);
    expect(win.setSize.mock.calls[0][0]).toEqual(new win.LogicalSize(2880, 1800));
    expect(win.setPosition.mock.calls[0][0]).toEqual(new win.LogicalPosition(0, 0));
  });
});
