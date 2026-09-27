/**
 * D22 WI-2 — `pinDuringLayoutSettle`: re-pinning, the law, idempotence, order independence,
 * user-scroll cancel, self-cancel (F4), flooring, and the observed element.
 * Cases P-01 to P-09 and P-11 of `.claude/tdd-guardian/tests-20260927-112500.md`.
 *
 * Boundaries: the growable geometry fixture and `ResizeObserverDouble` (jsdom has neither
 * layout nor ResizeObserver), fake timers, and `@tauri-apps/api/core` (the real logger runs;
 * payloads are read off `invoke("log_event")`).
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
import { floorScrollWrites } from "./helpers/flooringScroller";
import { createLcg, DEFAULT_SEED } from "./helpers/headingCorpus";
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
} from "./helpers/settlePinHarness";

let ro: ResizeObserverRegistry;

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

describe("pinDuringLayoutSettle — re-pinning (WI-2)", () => {
  it("P-01 growth above the target, then a ResizeObserver fire, re-pins onto the line", () => {
    const s = g12(100);
    armAt(s, 5);
    expect(s.scroller.scrollTop).toBe(720); // fixture guard
    s.growBody(1, 400);
    ro.fire();
    expect(s.scroller.scrollTop).toBe(1120);
    expect(peekRel(s, 5)).toBe(40);
  });

  it("P-02 LAW — the target holds after every step of a seeded growth sequence", () => {
    const rng = createLcg(DEFAULT_SEED);
    const pick = (n: number) => (rng() >>> 8) % n;
    for (let run = 0; run < 30; run++) {
      const s = g12(() => pick(401));
      const k = pick(12);
      const images = s.headings.map((_, i) => s.addImage(i));
      const pin = armAt(s, k);
      const steps = 1 + pick(20);
      for (let step = 0; step < steps; step++) {
        s.growBody(pick(12), 1 + pick(500));
        const trigger = rng() & 1 ? "ro" : "load";
        if (trigger === "ro") ro.fire();
        else loadOn(images[pick(12)]);
        const msg = `seed=${DEFAULT_SEED} run=${run} step=${step} k=${k} trigger=${trigger}`;
        expect(s.scroller.scrollTop, msg).toBe(landing(s, k));
      }
      pin.dispose();
      s.wrapper.remove();
    }
  });

  it("P-03 idempotence — a trigger with no growth writes nothing and fires no scroll", () => {
    const s = g12(100);
    const img = s.addImage(3);
    armAt(s, 5);
    let scrolls = 0;
    s.scroller.addEventListener("scroll", () => (scrolls += 1));
    ro.fire();
    ro.fire();
    ro.fire();
    loadOn(img);
    expect(s.scroller.scrollTop).toBe(720);
    expect(scrolls).toBe(0);
    s.growBody(1, 400);
    ro.fire();
    ro.fire();
    expect(s.scroller.scrollTop).toBe(1120);
    expect(scrolls).toBe(1);
  });

  it("P-04 S6 — the final position does not depend on growth order", () => {
    const M: Array<[number, number]> = [
      [0, 300],
      [2, 150.5],
      [6, 420],
      [9, 200],
      [3, 75],
    ];
    const shuffled = [...M];
    const rng = createLcg(DEFAULT_SEED);
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = (rng() >>> 8) % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    expect(shuffled).not.toEqual(M); // fixture guard: the orders really differ
    const a = g12(100);
    const b = g12(100);
    armAt(a, 7);
    armAt(b, 7);
    for (let i = 0; i < M.length; i++) {
      a.growBody(...M[i]);
      ro.fire();
      b.growBody(...shuffled[i]);
      ro.fire();
    }
    expect(a.scroller.scrollTop).toBe(landing(a, 7));
    expect(b.scroller.scrollTop).toBe(a.scroller.scrollTop);
  });
});

describe("pinDuringLayoutSettle — cancel rules (WI-2)", () => {
  it("P-05 a user scroll (event) cancels at once, even when the user scrolls back", () => {
    const s = g12(100);
    const img = s.addImage(3);
    const { reapply } = armAt(s, 5);
    userScroll(s, 500);
    const afterFirst = settleLogs(invokeMock);
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0].context).toMatchObject({ outcome: "user-scroll", triggers: 0, repins: 0 });
    userScroll(s, 720);
    s.growBody(1, 400);
    ro.fire();
    loadOn(img);
    vi.advanceTimersByTime(W);
    expect(s.scroller.scrollTop).toBe(720);
    expect(peekRel(s, 5)).toBe(440);
    expect(reapply.calls()).toBe(0);
    expect(settleLogs(invokeMock)).toHaveLength(1);
  });

  it("P-06 the pin's own synchronous scroll event does not cancel it (F4)", () => {
    const s = g12(100);
    const { reapply } = armAt(s, 5);
    s.growBody(1, 400);
    ro.fire();
    s.growBody(2, 300);
    ro.fire();
    expect(peekRel(s, 5)).toBe(40);
    expect(reapply.calls()).toBe(2);
    expect(settleLogs(invokeMock)).toHaveLength(0);
  });

  it("P-07 a synthetic scroll event with scrollTop unchanged does not cancel", () => {
    const s = g12(100);
    armAt(s, 5);
    s.scroller.dispatchEvent(new Event("scroll"));
    s.scroller.dispatchEvent(new Event("scroll"));
    s.growBody(1, 400);
    ro.fire();
    expect(peekRel(s, 5)).toBe(40);
  });

  it("P-08 a user scroll without an event is caught at the next trigger (not counted)", () => {
    const s = g12(100);
    const { reapply } = armAt(s, 5);
    s.setScrollTopSilently(600);
    s.growBody(1, 400);
    ro.fire();
    vi.advanceTimersByTime(W);
    expect(s.scroller.scrollTop).toBe(600);
    expect(reapply.calls()).toBe(0);
    const logs = settleLogs(invokeMock);
    expect(logs).toHaveLength(1);
    expect(logs[0].context).toMatchObject({ outcome: "user-scroll", triggers: 0, repins: 0 });
  });

  it("P-09 flooring engine — the pin reads back the value it actually wrote", () => {
    const s = g12(100);
    floorScrollWrites(s.scroller);
    const reapply = counted(() => {
      s.scroller.scrollTo({ top: s.contentOffset(5) - 40, behavior: "auto" });
      return true;
    });
    armAt(s, 5, { reapply });
    s.growBody(1, 400.5);
    ro.fire();
    s.growBody(2, 100);
    ro.fire();
    expect(s.scroller.scrollTop).toBe(Math.floor(s.contentOffset(5) - 40));
    expect(reapply.calls()).toBe(2);
  });
});

describe("pinDuringLayoutSettle — observed element (WI-2)", () => {
  it("P-11 observes `observed` (.ProseMirror), and a fire on it re-pins", () => {
    const s = g12(100);
    armAt(s, 5);
    expect(ro.observed().has(s.proseMirror)).toBe(true);
    s.growBody(1, 400);
    ro.fire();
    expect(peekRel(s, 5)).toBe(40);
  });
});
