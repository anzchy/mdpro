/**
 * D24 review — S4 law for the `applyWindowState` effect.
 *
 * Over the wa5 domain of `tests/window-state-apply.test.ts` (labels × states ×
 * work areas, reconstructed below; a test file is not importable without
 * re-registering its cases), the effect:
 *   1. carries out exactly `windowStateAction(ownsGlobalWindowState(label), s, wa)`;
 *   2. never calls a window method for a non-`main` label;
 *   3. for `main`, makes exactly the window calls that action names.
 *
 * Work areas reach the effect as a Retina monitor (physical = logical × 2), so
 * the law also covers the physical → logical conversion. Mocks only at
 * boundaries: `@tauri-apps/api/window` and `@tauri-apps/api/core` `invoke`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { win } = vi.hoisted(() => {
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
      setSize: vi.fn(async (_s: unknown) => {}),
      setPosition: vi.fn(async (_p: unknown) => {}),
      maximize: vi.fn(async () => {}),
      unmaximize: vi.fn(async () => {}),
      currentMonitor: vi.fn(async (): Promise<unknown> => null),
      LogicalSize,
      LogicalPosition,
    },
  };
});

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: win.label,
    setSize: win.setSize,
    setPosition: win.setPosition,
    maximize: win.maximize,
    unmaximize: win.unmaximize,
  }),
  currentMonitor: win.currentMonitor,
  LogicalSize: win.LogicalSize,
  LogicalPosition: win.LogicalPosition,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

import { applyAndReportWindowState } from "../src/services/windowStateApplier";
import { useLoggingStore } from "../src/stores/loggingStore";
import {
  ownsGlobalWindowState,
  windowStateAction,
  type WindowGeometry,
  type WindowStateRecord,
  type WorkArea,
} from "../src/utils/windowGeometry";

// The wa5 domain, transcribed from tests/window-state-apply.test.ts.
const NEAR_MISS_LABELS = [
  "mdpro-abc",
  "",
  "Main",
  "MAIN",
  "main ",
  " main",
  "main-2",
  "mainwindow",
  "mdpro-main",
  "mdpro-3f2a9c1e-7b4d-4e2a-9f1c-0a1b2c3d4e5f",
];
const LABELS = ["main", ...NEAR_MISS_LABELS];
const RECTS: WindowGeometry[] = [
  { x: 200, y: 200, width: 2400, height: 1600 },
  { x: 100, y: 100, width: 1200, height: 800 },
  { x: -500, y: -200, width: 1200, height: 800 },
  { x: 5000, y: 5000, width: 800, height: 600 },
  { x: 0, y: 0, width: 1, height: 1 },
  { x: 0, y: 0, width: 99999, height: 99999 },
];
const STATES: WindowStateRecord[] = [
  ...RECTS.flatMap((r) => [
    { ...r, isMaximized: false },
    { ...r, isMaximized: true },
  ]),
  { width: 1200, height: 800, x: 100, y: 100, isMaximized: false },
];
const WORK_AREAS: Array<WorkArea | null> = [
  { x: 0, y: 0, width: 1440, height: 900 },
  { x: 0, y: 0, width: 1728, height: 1117 },
  { x: 1440, y: -200, width: 1920, height: 1080 },
  { x: 0, y: 0, width: 320, height: 240 },
  null,
];

const SCALE = 2;
const retinaMonitor = (wa: WorkArea) => ({
  scaleFactor: SCALE,
  workArea: {
    position: { x: wa.x * SCALE, y: wa.y * SCALE },
    size: { width: wa.width * SCALE, height: wa.height * SCALE },
  },
});

const windowMethods = [win.setSize, win.setPosition, win.maximize, win.unmaximize];

beforeEach(() => {
  vi.clearAllMocks();
  useLoggingStore.setState({ enabled: true, level: "debug" });
});

describe("applyWindowState — S4 law over the wa5 domain (D24 review)", () => {
  it("law: the effect carries out windowStateAction, and non-main windows are never touched", async () => {
    let checked = 0;
    for (const label of LABELS) {
      for (const s of STATES) {
        for (const wa of WORK_AREAS) {
          for (const fn of windowMethods) fn.mockClear();
          win.label = label;
          win.currentMonitor.mockImplementation(async () => (wa ? retinaMonitor(wa) : null));
          const tag = `label=${JSON.stringify(label)} s=${JSON.stringify(s)} wa=${JSON.stringify(wa)}`;

          const expected = windowStateAction(ownsGlobalWindowState(label), s, wa);
          const result = await applyAndReportWindowState(s);

          expect(result, tag).toEqual(expected);
          if (label !== "main") {
            for (const fn of windowMethods) expect(fn, tag).not.toHaveBeenCalled();
          } else if (expected.kind === "maximize") {
            expect(win.maximize, tag).toHaveBeenCalledTimes(1);
            expect(win.setSize, tag).not.toHaveBeenCalled();
            expect(win.setPosition, tag).not.toHaveBeenCalled();
          } else if (expected.kind === "set") {
            const g = expected.geometry;
            expect(win.setSize.mock.calls, tag).toEqual([[new win.LogicalSize(g.width, g.height)]]);
            expect(win.setPosition.mock.calls, tag).toEqual([[new win.LogicalPosition(g.x, g.y)]]);
            expect(win.maximize, tag).not.toHaveBeenCalled();
          }
          expect(win.unmaximize, tag).not.toHaveBeenCalled();
          checked += 1;
        }
      }
    }
    expect(checked).toBe(LABELS.length * STATES.length * WORK_AREAS.length);
  });
});
