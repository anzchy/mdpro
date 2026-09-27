/**
 * D22 — `pinDuringLayoutSettle` robustness gaps named by the coverage audit of the final
 * review: a throwing logger (#1, #1b), a throwing `loadFilter` (#6), and arming on a
 * scroller that is already detached (#9). Each proves the never-throw contract holds at a seam the P-cases
 * in `settle-pin*.test.ts` did not reach.
 *
 * Boundaries: growable geometry fixture, `ResizeObserverDouble`, fake timers, and
 * `@tauri-apps/api/core` (the real logger runs; payloads are read off `invoke("log_event")`).
 * #1 and #1b alone replace `loggingService.logEventSync` with a thrower, because a logger that
 * throws at its own entry point is exactly the failure under test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (_cmd: string, _args?: Record<string, unknown>) => null as unknown),
}));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: invokeMock,
}));

import { loggingService } from "../src/services/loggingService";
import { useLoggingStore } from "../src/stores/loggingStore";
import {
  installResizeObserverDouble,
  type ResizeObserverRegistry,
} from "./helpers/resizeObserverDouble";
import {
  armAt,
  disposeAllPins,
  g12,
  loadOn,
  peekRel,
  settleLogs,
  W,
} from "./helpers/settlePinHarness";

let ro: ResizeObserverRegistry;

beforeEach(() => {
  vi.useFakeTimers();
  ro = installResizeObserverDouble();
  invokeMock.mockClear();
  useLoggingStore.setState({ enabled: true, level: "info" });
});

afterEach(() => {
  disposeAllPins();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("pinDuringLayoutSettle — robustness (review coverage audit)", () => {
  it("#1 a throwing logEventSync does not break the pin: it re-pins, then ends cleanly", () => {
    vi.spyOn(loggingService, "logEventSync").mockImplementation(() => {
      throw new Error("logger down");
    });
    const s = g12(100);
    const { reapply } = armAt(s, 5);

    s.growBody(1, 400);
    expect(() => ro.fire()).not.toThrow();
    expect(peekRel(s, 5)).toBe(40);

    expect(() => vi.advanceTimersByTime(W)).not.toThrow();
    const callsAtEnd = reapply.calls();
    expect(vi.getTimerCount()).toBe(0);
    expect(ro.observed().size).toBe(0);

    s.growBody(2, 400);
    ro.fire();
    loadOn(s.addImage(0));
    expect(reapply.calls(), "ended: nothing re-pins after the deadline").toBe(callsAtEnd);
  });

  it("#1b a throwing logEventSync on replace and dispose: the new pin lives, dispose never throws", () => {
    vi.spyOn(loggingService, "logEventSync").mockImplementation(() => {
      throw new Error("logger down");
    });
    const s = g12(100);
    armAt(s, 5);
    let second: ReturnType<typeof armAt> | undefined;
    expect(() => {
      second = armAt(s, 5); // same-value write, then replaces the first pin (which logs)
    }).not.toThrow();

    s.growBody(1, 400);
    ro.fire();
    expect(peekRel(s, 5), "the replacing pin survived its predecessor's log").toBe(40);
    expect(second?.reapply.calls()).toBe(1);

    expect(() => second?.dispose()).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
    expect(ro.observed().size).toBe(0);
  });

  it("#6 a throwing loadFilter rejects that load, but the pin stays live", () => {
    const s = g12(100);
    const img = s.addImage(1);
    armAt(s, 5, {
      loadFilter: () => {
        throw new Error("filter broke");
      },
    });
    const before = s.scroller.scrollTop;

    s.growBody(1, 400);
    expect(() => loadOn(img)).not.toThrow();
    expect(s.scroller.scrollTop, "the rejected load did not re-pin").toBe(before);

    ro.fire();
    expect(peekRel(s, 5), "a later trigger still re-pins").toBe(40);

    vi.advanceTimersByTime(W);
    const logs = settleLogs(invokeMock);
    expect(logs).toHaveLength(1);
    expect(logs[0].context).toMatchObject({ outcome: "expired", triggers: 1 });
  });

  it("#9 arming on an already-detached scroller ends at once as detached, leaving nothing", () => {
    const s = g12(100);
    const img = s.addImage(1);
    s.wrapper.remove();

    let pin: ReturnType<typeof armAt> | undefined;
    expect(() => {
      pin = armAt(s, 5);
    }).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
    expect(ro.observed().size).toBe(0);
    const logs = settleLogs(invokeMock);
    expect(logs).toHaveLength(1);
    expect(logs[0].context).toMatchObject({ outcome: "detached", triggers: 0, repins: 0 });

    s.growBody(1, 400);
    ro.fire();
    loadOn(img);
    s.scroller.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(W);
    expect(pin?.reapply.calls(), "no listener survived to re-pin").toBe(0);
    expect(settleLogs(invokeMock)).toHaveLength(1);
  });
});
