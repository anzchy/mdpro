/**
 * D22 WI-3 — `scrollHeadingToAnchor` keeps the clicked heading pinned while layout above
 * (or below) it settles. Cases S-01 to S-05 and S-05b of
 * `.claude/tdd-guardian/tests-20260927-112500.md`.
 *
 * Law: for a click on heading k, with no user scroll inside the window, after every
 * handled trigger `scrollTop === clamp(ceil(contentOffset(k) − 40), 0, maxScrollTop())`
 * against the CURRENT layout.
 *
 * Boundaries: the growable geometry fixture and `ResizeObserverDouble` (jsdom has neither
 * layout nor ResizeObserver), fake timers, and `@tauri-apps/api/core` (the real logger runs;
 * settle payloads are read off `invoke("log_event")`).
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
import { scrollHeadingToAnchor } from "../src/utils/scrollAnchor/milkdown";
import { floorScrollWrites } from "./helpers/flooringScroller";
import type { GrowableSurface } from "./helpers/growableScrollGeometry";
import { createLcg, DEFAULT_SEED } from "./helpers/headingCorpus";
import {
  installResizeObserverDouble,
  type ResizeObserverRegistry,
} from "./helpers/resizeObserverDouble";
import { g12, landing, loadOn, settleLogs, userScroll, W } from "./helpers/settlePinHarness";

let ro: ResizeObserverRegistry;

beforeEach(() => {
  vi.useFakeTimers();
  ro = installResizeObserverDouble();
  invokeMock.mockClear();
  useLoggingStore.setState({ enabled: true, level: "info" });
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

/** The outline click: `scrollHeadingToAnchor` on the container `g12` mounted into. */
function click(s: GrowableSurface, k: number): boolean {
  const container = s.wrapper.parentElement;
  if (!container) throw new Error("click: surface has no container");
  return scrollHeadingToAnchor(container, s.headings[k]);
}

/** S-01 geometry: bodies 0 for sections 0–10, 1000 for section 11 (scrollHeight 1624). */
const s01 = () => g12((i) => (i === 11 ? 1000 : 0));

const outcomes = () => settleLogs(invokeMock).map((p) => p.context.outcome);

describe("scrollHeadingToAnchor + settle pin — regressions (WI-3)", () => {
  it("S-01 H05 is pulled back onto the line after images above it grow", () => {
    const s = s01();
    expect(s.scrollHeight).toBe(1624); // fixture guard
    expect(s.maxScrollTop()).toBe(964);
    expect(click(s, 5)).toBe(true);
    expect(s.scroller.scrollTop).toBe(220);
    expect(s.relTop(5), "fixture guard: on the line after the click").toBe(40);

    s.growBody(1, 400);
    s.growBody(2, 400);
    s.growBody(3, 400);
    ro.fire();
    expect(s.relTop(5)).toBe(40);
    expect(s.scroller.scrollTop).toBe(1420);
  });

  it("S-02 a limited H09 reaches the line once growth allows it, including growth below it", () => {
    const s = g12(0);
    expect(s.maxScrollTop()).toBe(0); // fixture guard
    expect(click(s, 9)).toBe(true);
    expect(s.scroller.scrollTop).toBe(0);
    const images = s.headings.map((_, i) => s.addImage(i));

    // (a) growth above H09, then a load: at the new limit.
    for (let i = 0; i <= 7; i++) s.growBody(i, 400);
    loadOn(images[3]);
    expect(s.maxScrollTop()).toBe(3164);
    expect(s.scroller.scrollTop, "(a) at the limit").toBe(3164);
    expect(s.relTop(9), "(a) as high as the limit allows").toBe(504);

    // (b) growth BELOW H09 raises the limit; a load there re-pins onto the line.
    s.growBody(11, 1000);
    loadOn(images[11]);
    expect(s.relTop(9), "(b) on the line").toBe(40);
    expect(s.scroller.scrollTop).toBe(3628);
  });

  it("S-03 LAW — seeded click-then-growth sequences land every heading", () => {
    const seed = DEFAULT_SEED ^ 0xd22;
    const rng = createLcg(seed);
    const pick = (n: number) => (rng() >>> 8) % n;
    for (let trial = 0; trial < 25; trial++) {
      const s = g12(() => pick(301));
      const images = s.headings.map((_, i) => s.addImage(i));
      const flooring = trial % 2 === 1;
      if (flooring) floorScrollWrites(s.scroller);
      s.setScrollTopSilently(pick(Math.floor(s.maxScrollTop()) + 1));
      const k = pick(12);
      const expected = () => (flooring ? Math.floor(landing(s, k)) : landing(s, k));
      const tag = `seed=0x${seed.toString(16)} trial=${trial} k=${k} flooring=${flooring}`;

      expect(click(s, k), `${tag} click`).toBe(true);
      expect(s.scroller.scrollTop, `${tag} after click`).toBe(expected());
      const steps = 1 + pick(8);
      for (let step = 0; step < steps; step++) {
        const half = (rng() >>> 16) & 1 ? 0.5 : 0;
        s.growBody(pick(12), 1 + pick(500) + half);
        const trigger = (rng() >>> 16) & 1 ? "ro" : "load";
        if (trigger === "ro") ro.fire();
        else loadOn(images[pick(12)]);
        const msg = `${tag} step=${step} trigger=${trigger}`;
        expect(s.scroller.scrollTop, msg).toBe(expected());
        const limit = flooring ? Math.floor(s.maxScrollTop()) : s.maxScrollTop();
        if (s.scroller.scrollTop < limit) {
          expect(s.relTop(k), `${msg} relTop`).toBeLessThanOrEqual(40);
        }
      }
      vi.advanceTimersByTime(W); // expire this trial's pin before the next surface
    }
  });
});

describe("scrollHeadingToAnchor + settle pin — the user and later clicks win (WI-3)", () => {
  it("S-04 click, then a user scroll, then growth — no correction", () => {
    const s = s01();
    click(s, 5);
    userScroll(s, 500);
    s.growBody(1, 400);
    ro.fire();
    vi.advanceTimersByTime(W);
    expect(s.scroller.scrollTop).toBe(500);
    const logs = settleLogs(invokeMock);
    expect(logs).toHaveLength(1);
    expect(logs[0].context).toMatchObject({ outcome: "user-scroll", source: "toc" });
  });

  it("S-05 two quick clicks — the second heading ends on the line", () => {
    const s = s01();
    click(s, 5);
    expect(s.scroller.scrollTop).toBe(220);
    click(s, 7);
    expect(s.scroller.scrollTop).toBe(324);
    s.growBody(1, 400);
    ro.fire();
    expect(s.relTop(7)).toBe(40);
    expect(s.relTop(5)).not.toBe(40);
    expect(outcomes(), "the H05 pin saw the H07 write as a scroll").toEqual(["user-scroll"]);
  });

  it("S-05b replacement proven by position, with no scroll event to self-cancel", () => {
    const s = g12(0);
    expect(s.maxScrollTop()).toBe(0); // fixture guard: every click is a same-value write
    let scrolls = 0;
    s.scroller.addEventListener("scroll", () => (scrolls += 1));
    click(s, 8);
    click(s, 9);
    click(s, 10);
    expect(scrolls, "no click moved the scroller").toBe(0);
    expect(ro.observed().size, "one observed element").toBe(1);
    expect(ro.instances().filter((r) => !r.disconnected)).toHaveLength(1);

    const images = s.headings.map((_, i) => s.addImage(i));
    for (let i = 0; i <= 7; i++) s.growBody(i, 400);
    s.growBody(11, 1000);
    loadOn(images[11]);
    expect(s.relTop(10)).toBe(40);
    expect(s.scroller.scrollTop).toBe(3680);
    expect(s.relTop(9)).toBe(-12);

    vi.advanceTimersByTime(W);
    expect(outcomes()).toEqual(["replaced", "replaced", "expired"]);
    for (const p of settleLogs(invokeMock)) expect(p.context.source).toBe("toc");
  });
});
