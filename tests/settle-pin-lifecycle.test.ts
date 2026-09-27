/**
 * D22 WI-2 — `pinDuringLayoutSettle` lifecycle: one pin per scroller, full teardown on every
 * exit, failure exits (reapply false / throws, scroller detached), no ResizeObserver,
 * `loadFilter`, and exactly one log per window.
 * Cases P-12 to P-19 of `.claude/tdd-guardian/tests-20260927-112500.md` (P-16b added: the
 * R2-1 heading-detached-inside-reapply path).
 *
 * Boundaries: growable geometry fixture, `ResizeObserverDouble`, fake timers, and
 * `@tauri-apps/api/core` (the real logger runs; payloads are read off `invoke("log_event")`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (_cmd: string, _args?: Record<string, unknown>) => null as unknown),
}));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: invokeMock,
}));

import { useLoggingStore } from "../src/stores/loggingStore";
import type { GrowableSurface } from "./helpers/growableScrollGeometry";
import {
  installResizeObserverDouble,
  type ResizeObserverRegistry,
} from "./helpers/resizeObserverDouble";
import {
  armAt,
  counted,
  disposeAllPins,
  g12,
  landing,
  loadOn,
  peekRel,
  settleLogs,
  userScroll,
  W,
  type Armed,
} from "./helpers/settlePinHarness";

let ro: ResizeObserverRegistry;
const settleCount = () => settleLogs(invokeMock).length;

beforeEach(() => {
  vi.useFakeTimers();
  ro = installResizeObserverDouble();
  useLoggingStore.setState({ enabled: true, level: "info" });
});

afterEach(() => {
  disposeAllPins();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("pinDuringLayoutSettle — one pin per scroller (WI-2)", () => {
  it("P-12 replace — a second pin on the same scroller wins", () => {
    const s = g12(100);
    const a = armAt(s, 5);
    armAt(s, 7); // writes landing(7) first (a scroll event), then arms B
    s.growBody(1, 400);
    ro.fire();
    vi.advanceTimersByTime(W);
    expect(peekRel(s, 7)).toBe(40);
    expect(peekRel(s, 5)).not.toBe(40);
    expect(a.reapply.calls()).toBe(0);
    expect(settleLogs(invokeMock).map((p) => p.context.outcome)).toEqual([
      "user-scroll",
      "expired",
    ]);
  });

  it("P-13 pins on different scrollers do not replace each other", () => {
    const a = g12(100);
    const b = g12(100);
    armAt(a, 5);
    armAt(b, 3);
    a.growBody(1, 400);
    b.growBody(1, 400);
    ro.fire();
    expect(peekRel(a, 5)).toBe(40);
    expect(peekRel(b, 3)).toBe(40);
  });
});

type Exit = (s: GrowableSurface, pin: Armed) => Armed[];

const EXITS: Array<[string, Exit, number]> = [
  ["a expiry", () => (vi.advanceTimersByTime(W), []), 1],
  ["b event user scroll", (s) => (userScroll(s, 500), []), 1],
  ["c dispose()", (_s, pin) => (pin.dispose(), []), 1],
  [
    "d replace, then dispose the replacement",
    (s) => {
      const second = armAt(s, 5); // same-value write: no scroll event
      second.dispose();
      return [second];
    },
    2,
  ],
  [
    "e trigger-time user scroll",
    (s) => {
      s.setScrollTopSilently(600);
      s.growBody(1, 400);
      ro.fire();
      return [];
    },
    1,
  ],
];

describe("pinDuringLayoutSettle — teardown (WI-2)", () => {
  it.each(EXITS)("P-14 (%s) leaves nothing behind, even after a later user write", (_n, exit, logs) => {
    const s = g12(100);
    const pin = armAt(s, 5);
    const pins = [pin, ...exit(s, pin)];
    const callsAtExit = pins.map((p) => p.reapply.calls());
    const payloads0 = settleCount();
    expect(payloads0).toBe(logs);

    userScroll(s, 50);
    s.growBody(2, 400);
    ro.fire();
    loadOn(s.addImage(0));
    vi.advanceTimersByTime(10 * W);

    expect(ro.observed().size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(pins.map((p) => p.reapply.calls())).toEqual(callsAtExit);
    expect(s.scroller.scrollTop).toBe(50);
    expect(settleCount()).toBe(payloads0);
    if (_n.startsWith("e")) {
      expect(settleLogs(invokeMock)[0].context).toMatchObject({
        outcome: "user-scroll",
        triggers: 0,
        repins: 0,
      });
    }
  });
});

describe("pinDuringLayoutSettle — failure exits (WI-2)", () => {
  it.each([
    ["false", () => false],
    [
      "throws",
      () => {
        throw new Error("gone");
      },
    ],
  ])("P-15 reapply %s — no throw, the pin stops, outcome detached", (_n, inner) => {
    const s = g12(100);
    const reapply = counted(inner);
    armAt(s, 5, { reapply });
    s.growBody(1, 400);
    expect(() => ro.fire()).not.toThrow();
    s.growBody(2, 100);
    ro.fire();
    vi.advanceTimersByTime(W);
    expect(reapply.calls()).toBe(1);
    expect(s.scroller.scrollTop).toBe(720);
    expect(vi.getTimerCount()).toBe(0);
    expect(ro.observed().size).toBe(0);
    const logs = settleLogs(invokeMock);
    expect(logs).toHaveLength(1);
    expect(logs[0].context).toMatchObject({ outcome: "detached", triggers: 1, repins: 1 });
  });

  it("P-16 scroller detached mid-window — detected before reapply, not counted (F3)", () => {
    const s = g12(100);
    const { reapply } = armAt(s, 5);
    s.wrapper.remove();
    s.growBody(1, 400);
    expect(() => ro.fire()).not.toThrow();
    expect(() => vi.advanceTimersByTime(W)).not.toThrow();
    expect(reapply.calls()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(ro.observed().size).toBe(0);
    const logs = settleLogs(invokeMock);
    expect(logs).toHaveLength(1);
    expect(logs[0].context).toMatchObject({ outcome: "detached", triggers: 0, repins: 0 });
  });

  it("P-16b heading detached — found inside reapply, which returns false (F3, R2-1 option a)", () => {
    const s = g12(100);
    const heading = s.headings[5];
    const reapply = counted(() => {
      if (!heading.isConnected) return false;
      s.scroller.scrollTo({ top: landing(s, 5), behavior: "auto" });
      return true;
    });
    armAt(s, 5, { reapply });
    heading.remove();
    s.growBody(1, 400);
    ro.fire();
    vi.advanceTimersByTime(W);
    expect(s.scroller.scrollTop).toBe(720);
    expect(reapply.calls()).toBe(1);
    const logs = settleLogs(invokeMock);
    expect(logs).toHaveLength(1);
    expect(logs[0].context).toMatchObject({ outcome: "detached", triggers: 1, repins: 1 });
  });
});

describe("pinDuringLayoutSettle — triggers (WI-2)", () => {
  it("P-17 no ResizeObserver global — load alone re-pins, and arming does not throw", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const s = g12(100);
    expect(() => armAt(s, 5)).not.toThrow();
    const img = s.addImage(2);
    s.growBody(1, 400);
    loadOn(img);
    expect(peekRel(s, 5)).toBe(40);
  });

  it("P-18 loadFilter gates `load` only, and receives the image", () => {
    const s = g12(100);
    const a = s.addImage(1);
    const b = s.addImage(9);
    armAt(s, 5, { loadFilter: (img) => img === a });
    s.growBody(1, 400);
    loadOn(b);
    expect(s.scroller.scrollTop).toBe(720);
    loadOn(a);
    expect(peekRel(s, 5)).toBe(40);
    s.growBody(2, 100);
    ro.fire();
    expect(peekRel(s, 5)).toBe(40);
  });
});

describe("pinDuringLayoutSettle — one log per window (WI-2)", () => {
  it.each([
    ["a dispose twice", (pin: Armed) => (pin.dispose(), pin.dispose()), "disposed"],
    ["b expiry, then dispose", (pin: Armed) => (vi.advanceTimersByTime(W), pin.dispose()), "expired"],
  ])("P-19 (%s) logs exactly once", (_n, run, outcome) => {
    const s = g12(100);
    run(armAt(s, 5));
    const logs = settleLogs(invokeMock);
    expect(logs).toHaveLength(1);
    expect(logs[0].context.outcome).toBe(outcome);
  });
});
