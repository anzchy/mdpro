/**
 * D17 WI-4 — the geometric WYSIWYG spy at the scroll limit, and index coherence (L6).
 * Matrix: WI-4 H-17, H-17b, H-23 of `.claude/tdd-guardian/tests-20260922-210708.md`.
 *
 * At the limit a heading that can never reach the anchor keeps the highlight while its
 * scroller-relative top is in `[SPY_ANCHOR_OFFSET_PX, clientHeight]` (Source T-11 parity,
 * ADR-0017 asymmetry). Every top is measured relative to the scroller — the fixture's
 * scroller sits at a non-zero viewport y, so viewport coordinates give a different answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loggingService } from "../src/services/loggingService";
import {
  SPY_ANCHOR_OFFSET_PX,
  SPY_SCROLL_LIMIT_TOLERANCE_PX as T,
} from "../src/utils/codemirrorViewportLine";
import { resolveHeadingElements } from "../src/utils/tocElementResolution";
import type { ScriptedHeading } from "./helpers/scriptedScrollGeometry";
import {
  active, contentOf, entries, expectDistinctKeys, installIoDetector, keyAt,
  makeHeadings, mountContainer, mountSurface, oracle, preset, renderSpy, resetTocStore,
  scrollAndFrame, tick,
} from "./helpers/wysiwygSpyHarness";

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

function setup(dom: ScriptedHeading[], opts: { gap?: number; content?: string } = {}) {
  const container = mountContainer();
  const surface = mountSurface(container, { headings: dom, rootTop: 90, viewHeight: 660, gap: opts.gap });
  renderSpy({ content: opts.content ?? contentOf(dom), documentId: "doc-a" });
  tick(300);
  expectDistinctKeys("setup");
  return { container, surface };
}

const h2 = (text: string, height: number, bodyHeight: number): ScriptedHeading => ({
  level: 2,
  text,
  height,
  bodyHeight,
});

describe("WI-4 geometric WYSIWYG spy — scroll limit and index coherence", () => {
  it("H-17: tail parity with Source T-11 — kept at max − T, released at max − T − 1", () => {
    // P (block 300) sits at rel 0 at max; the tail (block 360) at rel 300 never reaches the anchor.
    const dom = [...makeHeadings(6), h2("P", 40, 248), h2("Tail", 40, 308)];
    const { surface } = setup(dom);
    const [P, TAIL] = [6, 7];
    const max = surface.maxScrollTop();
    expect(surface.contentOffset(P)).toBe(max);
    scrollAndFrame(surface, surface.scrollTopForHeadingAt(2, 10));
    preset(keyAt(TAIL));
    scrollAndFrame(surface, max);
    expect(active()).toBe(keyAt(TAIL));
    scrollAndFrame(surface, max - T);
    expect(oracle(surface)).toBe(P);
    expect(active(), "(a) at the limit within tolerance: kept").toBe(keyAt(TAIL));
    scrollAndFrame(surface, max - T - 1);
    expect(oracle(surface)).toBe(P);
    expect(active(), "(b) off the limit: released to the oracle").toBe(keyAt(P));
  });

  describe("H-17b: retention measures currentTop relative to the scroller", () => {
    // gap 0: P (1px) at rel anchor−1, Q at rel anchor, tail (block 40) at rel 620 — at max.
    const dom = [...makeHeadings(6), h2("P", 1, 0), h2("Q", 40, 540), h2("Tail", 40, 0)];
    const [P, Q, TAIL] = [6, 7, 8];

    function atMaxGuards(surface: ReturnType<typeof mountSurface>) {
      expect(surface.scroller.scrollTop).toBe(surface.maxScrollTop());
      expect(surface.relTop(P)).toBe(SPY_ANCHOR_OFFSET_PX - 1);
      expect(surface.relTop(Q)).toBe(SPY_ANCHOR_OFFSET_PX);
      expect(surface.relTop(TAIL)).toBe(620);
      expect(surface.rootTop + surface.relTop(TAIL)).toBeGreaterThan(surface.viewHeight);
      expect(oracle(surface)).toBe(Q);
    }

    it("(a) the tail at rel 620 (viewport 710 > clientHeight) is kept", () => {
      const { surface } = setup(dom, { gap: 0 });
      scrollAndFrame(surface, surface.scrollTopForHeadingAt(2, 10));
      preset(keyAt(TAIL));
      scrollAndFrame(surface, surface.maxScrollTop());
      atMaxGuards(surface);
      expect(active()).toBe(keyAt(TAIL));
    });

    it("(b) P at rel anchor−1 (viewport 129 ∈ [anchor, 660]) is released to Q", () => {
      const { surface } = setup(dom, { gap: 0 });
      scrollAndFrame(surface, surface.scrollTopForHeadingAt(2, 10));
      preset(keyAt(P));
      scrollAndFrame(surface, surface.maxScrollTop());
      atMaxGuards(surface);
      expect(surface.rootTop + surface.relTop(P)).toBe(129);
      expect(active()).toBe(keyAt(Q));
    });
  });

  describe("H-23: an unresolved (tier-3) entry never shifts the index space (L6)", () => {
    // entries [A, Ghost, B, C]; DOM [A, B, C]. off(B)=452, off(C)=1204, max=696.
    const dom = [h2("A", 40, 400), h2("B", 40, 700), h2("C", 40, 100)];
    const content = "## A\n\nbody\n\n## Ghost\n\nbody\n\n## B\n\nbody\n\n## C\n\nbody";
    const keyOf = (text: string) => entries().find((e) => e.text === text)!.key;
    // DOM indices (the resolved list), used only for the oracle.
    const [DB] = [1];

    function mount() {
      const ctx = setup(dom, { content });
      expect(entries().map((e) => e.text)).toEqual(["A", "Ghost", "B", "C"]);
      const byKey = resolveHeadingElements(entries(), ctx.container).byKey;
      expect([...byKey.keys()]).toEqual([keyOf("A"), keyOf("B"), keyOf("C")]);
      expect(byKey.has(keyOf("Ghost"))).toBe(false);
      return ctx;
    }

    it("(a) B at the anchor, off the limit → B (an entries-index mixup yields Ghost)", () => {
      const { surface } = mount();
      scrollAndFrame(surface, surface.scrollTopForHeadingAt(DB, SPY_ANCHOR_OFFSET_PX));
      expect(surface.scroller.scrollTop).toBeLessThan(surface.maxScrollTop() - T);
      expect(active()).toBe(keyOf("B"));
    });

    it("(b) rel(B) ≤ anchor < rel(C), off the limit → B, never C", () => {
      const { surface } = mount();
      scrollAndFrame(surface, 552);
      expect(surface.relTop(DB)).toBeLessThanOrEqual(SPY_ANCHOR_OFFSET_PX);
      expect(surface.relTop(2)).toBeGreaterThan(SPY_ANCHOR_OFFSET_PX);
      expect(active()).toBe(keyOf("B"));
    });

    it("(c) C preset, scrolled to max (oracle B, C visible) → C retained", () => {
      const { surface } = mount();
      scrollAndFrame(surface, 100);
      preset(keyOf("C"));
      scrollAndFrame(surface, surface.maxScrollTop());
      expect(oracle(surface)).toBe(DB);
      expect(surface.relTop(2)).toBeGreaterThanOrEqual(SPY_ANCHOR_OFFSET_PX);
      expect(active()).toBe(keyOf("C"));
    });

    it("(d) Ghost preset, scrolled to max → released to the oracle B", () => {
      const { surface } = mount();
      scrollAndFrame(surface, 100);
      preset(keyOf("Ghost"));
      expect(active()).toBe(keyOf("Ghost"));
      scrollAndFrame(surface, surface.maxScrollTop());
      expect(active()).toBe(keyOf("B"));
    });
  });
});
