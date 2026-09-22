/**
 * D17 WI-5 — WYSIWYG click-to-navigate lands at heading top − `SPY_ANCHOR_OFFSET_PX`,
 * instantly, and the geometric spy then agrees with the clicked entry.
 * Matrix: WI-5 N-W1…N-W6 of `.claude/tdd-guardian/tests-20260922-210708.md` (Revision 1).
 *
 * `landing(k) = clamp(contentOffset(k) − SPY_ANCHOR_OFFSET_PX, 0, maxScrollTop())`.
 * The fixture (`scriptedScrollGeometry`) emits `scroll` synchronously on every changing
 * write and models `behavior: "smooth"` as 4 frame-stepped writes, so "`scrollTop ===
 * landing(k)` before any frame" is what proves the scroll is instant. The implementation
 * may use the `scrollTop` setter or `scrollTo`; nothing here asserts which.
 */
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loggingService } from "../src/services/loggingService";
import type { HeadingKey } from "../src/types/toc";
import {
  SPY_ANCHOR_OFFSET_PX as ANCHOR,
  SPY_SCROLL_LIMIT_TOLERANCE_PX as T,
} from "../src/utils/codemirrorViewportLine";
import { createLcg, DEFAULT_SEED } from "./helpers/headingCorpus";
import type { ScriptedHeading, ScriptedSurface } from "./helpers/scriptedScrollGeometry";
import {
  active, contentOf, entries, expectDistinctKeys, frame, installIoDetector, keyAt,
  makeHeadings, mountContainer, mountSurface, recordWrites, renderSpy, resetTocStore,
  scrollAndFrame, tick,
} from "./helpers/wysiwygSpyHarness";

const SEED = `seed=0x${DEFAULT_SEED.toString(16)}`;

beforeEach(() => {
  vi.useFakeTimers();
  installIoDetector();
  vi.spyOn(loggingService, "logEventSync").mockImplementation(() => {});
  resetTocStore();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

function setup(dom: ScriptedHeading[], gap?: number) {
  const container = mountContainer();
  const surface = mountSurface(container, { headings: dom, rootTop: 90, viewHeight: 660, gap });
  const { result } = renderSpy({ content: contentOf(dom), documentId: "doc-a" });
  tick(300);
  expectDistinctKeys("setup", dom.length);
  const navigate = (key: HeadingKey) => act(() => result.current.navigateToEntry(key));
  return { surface, navigate };
}

function landing(surface: ScriptedSurface, i: number): number {
  return Math.max(0, Math.min(surface.contentOffset(i) - ANCHOR, surface.maxScrollTop()));
}

const h = (level: ScriptedHeading["level"], text: string, height: number, bodyHeight: number) =>
  ({ level, text, height, bodyHeight }) as ScriptedHeading;

/** 12 × `##` (40 px + 12 gap + 400 body): the tail heading cannot reach the anchor. */
function clickTail() {
  const ctx = setup(makeHeadings(12));
  const { surface } = ctx;
  const tail = 11;
  expect(active(), "arm-time key is heading 0").toBe(keyAt(0));
  expect(surface.contentOffset(tail) - ANCHOR, "fixture: tail unreachable").toBeGreaterThan(
    surface.maxScrollTop(),
  );
  ctx.navigate(keyAt(tail)!);
  expect(surface.scroller.scrollTop, "instant: at max before any frame").toBe(surface.maxScrollTop());
  for (let f = 0; f < 5; f++) {
    frame();
    expect(active(), `after frame ${f + 1}`).toBe(keyAt(tail));
  }
  expect(surface.scroller.scrollTop).toBe(surface.maxScrollTop());
  return { ...ctx, tail };
}

describe("WI-5 WYSIWYG navigation lands at the anchor, instantly", () => {
  it("N-W1: click ## Tail → lands at max and stays Tail after every frame", () => {
    clickTail();
  });

  it("N-W2: click a mid-document heading → scrollTop = offset − anchor, key holds", () => {
    const { surface, navigate } = setup(makeHeadings(12));
    expect(active()).toBe(keyAt(0));
    const target = surface.contentOffset(7) - ANCHOR;
    expect(target, "fixture: not clamped").toBeLessThan(surface.maxScrollTop());

    navigate(keyAt(7)!);
    expect(surface.scroller.scrollTop, "before the frame").toBe(target);
    expect(surface.relTop(7), "fixture-read guard").toBe(ANCHOR);
    frame();
    expect(surface.scroller.scrollTop, "after the frame").toBe(target);
    expect(active()).toBe(keyAt(7));
  });

  it("N-W3: click the second duplicate → lands on it and stays on it", () => {
    const { surface, navigate } = setup([h(1, "Intro", 40, 1500), h(1, "Intro", 40, 1500)]);
    expect(entries()[0].text).toBe(entries()[1].text);
    expect(landing(surface, 1)).not.toBe(landing(surface, 0));

    navigate(keyAt(1)!);
    expect(surface.scroller.scrollTop).toBe(landing(surface, 1));
    for (let f = 0; f < 4; f++) {
      frame();
      expect(active(), `frame ${f + 1}`).toBe(keyAt(1));
      expect(surface.scroller.scrollTop).toBe(landing(surface, 1));
    }
  });

  it("N-W4: after the tail click, scrolling up past the tolerance releases it", () => {
    const { surface, tail } = clickTail();
    const max = surface.maxScrollTop();
    scrollAndFrame(surface, max - T);
    expect(active(), "within tolerance: kept").toBe(keyAt(tail));
    scrollAndFrame(surface, max - T - 1);
    expect(active(), "past tolerance: released to the oracle").toBe(keyAt(tail - 1));
  });

  it("N-W5: a heading followed immediately by a short heading → the clicked one holds", () => {
    const GAP = 12;
    const dom = [h(2, "Lead", 40, 400), h(6, "A", 20, 0), h(6, "B", 20, 400), h(2, "After", 40, 1200)];
    const { surface, navigate } = setup(dom, GAP);
    const [A, B] = [1, 2];
    expect(dom[A].height + GAP, "fixture: the pair is closer than the anchor").toBeLessThan(ANCHOR);
    expect(surface.contentOffset(A) - ANCHOR).toBeLessThan(surface.maxScrollTop() - T);

    navigate(keyAt(A)!);
    expect(surface.scroller.scrollTop).toBe(surface.contentOffset(A) - ANCHOR);
    expect(surface.relTop(A)).toBe(ANCHOR);
    expect(surface.relTop(B)).toBeGreaterThan(ANCHOR);
    frame();
    expect(active()).toBe(keyAt(A));
  });

  it("N-W6: LAW navigation lands and holds for every entry, in order and shuffled", () => {
    const dom = [
      h(1, "Title", 40, 300),
      h(2, "One", 40, 400),
      h(6, "A", 20, 0),
      h(6, "B", 20, 400),
      h(2, "Dup", 40, 400),
      h(2, "Dup", 40, 400),
      h(2, "Two", 40, 600),
      h(2, "Tail A", 40, 150),
      h(2, "Tail B", 40, 200),
    ];
    const { surface, navigate } = setup(dom);
    const n = dom.length;
    const max = surface.maxScrollTop();
    const tailPair = [n - 2, n - 1];

    // Fixture preconditions.
    expect(surface.rootTop).not.toBe(0);
    const nearTop = dom.map((_, i) => i).filter((i) => surface.contentOffset(i) <= ANCHOR);
    expect(nearTop, "only the H1 within the anchor of the content top").toEqual([0]);
    for (const i of tailPair) {
      expect(surface.contentOffset(i) - ANCHOR, `tail ${i} clamps`).toBeGreaterThan(max);
      expect(surface.contentOffset(i) - max, `tail ${i} visible at max`).toBeLessThanOrEqual(
        surface.viewHeight,
      );
    }
    const landings = dom.map((_, i) => landing(surface, i));
    const nonTail = landings.filter((_, i) => !tailPair.includes(i));
    expect(new Set(nonTail).size, "landings distinct outside the tail pair").toBe(nonTail.length);
    expect(tailPair.map((i) => landings[i])).toEqual([max, max]);
    expect(nonTail).not.toContain(max);

    const rng = createLcg(DEFAULT_SEED);
    const shuffled = dom.map((_, i) => i);
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = rng() % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const orders = [dom.map((_, i) => i), shuffled];

    for (const [o, order] of orders.entries()) {
      for (const k of order) {
        const where = `order ${o} k=${k} (${SEED})`;
        navigate(keyAt(k)!);
        expect(surface.scroller.scrollTop, `${where}: before any frame`).toBe(landings[k]);
        act(() => {
          surface.scroller.dispatchEvent(new Event("scroll"));
        });
        const rec = recordWrites();
        frame();
        rec.stop();
        expect(surface.scroller.scrollTop, `${where}: unchanged by the frame`).toBe(landings[k]);
        expect(active(), `${where}: key holds`).toBe(keyAt(k));
        expect(rec.writes, `${where}: no store write in the frame`).toEqual([]);
      }
    }
  });
});
