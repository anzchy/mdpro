/**
 * D17 WI-4 — the WYSIWYG scroll spy is geometric: the active heading is the LAST heading
 * whose top is at or above `SPY_ANCHOR_OFFSET_PX` below the scroller top (ADR-0026).
 * Matrix: WI-4 H-1…H-12 of `.claude/tdd-guardian/tests-20260922-210708.md`.
 *
 * Real: `useTOC` → `useWysiwygScrollSpy` → `tocStore`, jsdom DOM, MutationObserver, scroll
 * event dispatch. Scripted: layout and scroll writes (`scriptedScrollGeometry`), rAF (fake
 * timers), ResizeObserver (`resizeObserverDouble`). The geometric IntersectionObserver
 * double is installed only as a detector (matrix §0).
 */
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loggingService } from "../src/services/loggingService";
import { useTOCStore } from "../src/stores/tocStore";
import {
  SPY_ANCHOR_OFFSET_PX,
  SPY_SCROLL_LIMIT_TOLERANCE_PX as T,
} from "../src/utils/codemirrorViewportLine";
import { createLcg, DEFAULT_SEED } from "./helpers/headingCorpus";
import { installResizeObserverDouble } from "./helpers/resizeObserverDouble";
import type { ScriptedHeading } from "./helpers/scriptedScrollGeometry";
import {
  active, contentOf, entries, expectDistinctKeys, flushMutations, frame, installIoDetector,
  keyAt, makeHeadings, mountContainer, mountSurface, oracle, oracleIndex, preset,
  recordWrites, renderSpy, replaceScriptedHeading, resetTocStore, scrollAndFrame,
  scrollHeadingTo, setLaidOut, shiftLayout, tick, headingReads, readBudget,
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

function setup(headings: ScriptedHeading[], rootTop?: number, beforeRender?: (s: ReturnType<typeof mountSurface>) => void) {
  const container = mountContainer();
  const surface = mountSurface(container, { headings, rootTop });
  beforeRender?.(surface);
  const harness = renderSpy({ content: contentOf(headings), documentId: "doc-a" });
  tick(300);
  expectDistinctKeys("setup", headings.length);
  return { container, surface, harness };
}

/** Seeded draw in `[0, m)` from the LCG's high bits (its low bits have short periods). */
const draw = (lcg: () => number, m: number) => (lcg() >>> 8) % m;

const indexOfActive = () => entries().findIndex((e) => e.key === active());

/**
 * H-3 / H-6 tail fixture: 8 regular sections, then X (block 300 — rel 0 at max, the
 * oracle there), Y (rel 300 at max), W (rel 620), and the tail T (rel 640).
 */
const TAIL = [
  ...makeHeadings(8),
  { level: 2 as const, text: "X", height: 40, bodyHeight: 248 },
  { level: 2 as const, text: "Y", height: 40, bodyHeight: 268 },
  { level: 2 as const, text: "W", height: 8, bodyHeight: 0 },
  { level: 2 as const, text: "Tail", height: 8, bodyHeight: 0 },
];
const [X, Y, W, TL] = [8, 9, 10, 11];

describe("WI-4 geometric WYSIWYG spy (H-1…H-12)", () => {
  it("H-1: arm-time recompute with no scroll event → heading 3", () => {
    setup(makeHeadings(6), undefined, (s) => s.setScrollTopSilently(s.scrollTopForHeadingAt(3, 10)));
    frame();
    expect(active()).toBe(keyAt(3));
  });

  it("H-2: anchor boundary relative to ROOT_TOP 90 — rel anchor → k, rel anchor+1 → k−1", () => {
    const { surface } = setup(makeHeadings(6), 90);
    scrollHeadingTo(surface, 3, SPY_ANCHOR_OFFSET_PX);
    expect(surface.scroller.scrollTop).toBeLessThan(surface.maxScrollTop() - T);
    expect(active()).toBe(keyAt(3));
    scrollHeadingTo(surface, 3, SPY_ANCHOR_OFFSET_PX + 1);
    expect(active()).toBe(keyAt(2));
  });

  it("H-3: translation invariance over ROOT_TOP ∈ {0, 90, 333, −50}, incl. at-limit retention", () => {
    const runs: number[][] = [];
    for (const rootTop of [0, 90, 333, -50]) {
      document.body.innerHTML = "";
      resetTocStore();
      const { surface, harness } = setup(TAIL, rootTop);
      const max = surface.maxScrollTop();
      expect(surface.contentOffset(X)).toBe(max); // X at rel 0 at max: the oracle there
      const lcg = createLcg(DEFAULT_SEED);
      const seq: number[] = [];
      for (let s = 0; s < 10; s++) {
        scrollAndFrame(surface, draw(lcg, max - T));
        seq.push(indexOfActive());
      }
      for (const held of [Y, W, TL]) {
        scrollAndFrame(surface, surface.scrollTopForHeadingAt(2, 10));
        preset(keyAt(held));
        scrollAndFrame(surface, max);
        expect(oracle(surface), `seed ${DEFAULT_SEED} rootTop ${rootTop}`).toBe(X);
        expect(indexOfActive(), `at-limit retention exercised, held ${held}`).not.toBe(X);
        seq.push(indexOfActive());
      }
      runs.push(seq);
      harness.unmount();
    }
    expect(new Set(runs[0].slice(0, 10)).size, "off-limit keys not constant").toBeGreaterThan(1);
    for (const run of runs.slice(1)) expect(run, `seed ${DEFAULT_SEED}`).toEqual(runs[0]);
  });

  it("H-4: 20 scroll events in one frame → one sample, one write, bounded reads (n=1000)", () => {
    const n = 1000;
    const { surface } = setup(makeHeadings(n));
    scrollHeadingTo(surface, 1, 10);
    expect(active()).toBe(keyAt(1));
    surface.resetRectReads();
    const rec = recordWrites();
    const target = surface.scrollTopForHeadingAt(5, SPY_ANCHOR_OFFSET_PX);
    act(() => {
      for (let j = 0; j < 10; j++) {
        surface.scroller.scrollTop = target + (9 - j) * 3;
        surface.scroller.dispatchEvent(new Event("scroll"));
      }
    });
    frame();
    rec.stop();
    expect(rec.writes).toEqual([keyAt(5)]);
    expect(headingReads(surface)).toBeLessThanOrEqual(readBudget(n));
    expect(surface.rectReads.scroller).toBeLessThanOrEqual(1);
  });

  it("H-5: no write while the key is unchanged", () => {
    const { surface } = setup(makeHeadings(8, () => 2000));
    const rec = recordWrites();
    scrollHeadingTo(surface, 3, 10);
    expect(rec.writes).toEqual([keyAt(3)]); // positive guard
    for (let k = 1; k <= 20; k++) {
      scrollAndFrame(surface, surface.contentOffset(3) - SPY_ANCHOR_OFFSET_PX + k * 88);
      expect(oracle(surface)).toBe(3);
    }
    rec.stop();
    expect(rec.writes).toHaveLength(1);
  });

  it("H-6: fixed point under 30 seeded invalidations, 12 seeded geometries (L3)", async () => {
    const ro = installResizeObserverDouble();
    const lcg = createLcg(DEFAULT_SEED);
    let content = contentOf(TAIL);
    const { surface, harness } = setup(TAIL);
    const max = surface.maxScrollTop();
    for (let g = 0; g < 12; g++) {
      if (g < 9) {
        scrollAndFrame(surface, draw(lcg, max - T));
      } else {
        scrollAndFrame(surface, surface.scrollTopForHeadingAt(1, 10));
        preset(keyAt([Y, W, TL][g - 9]));
        scrollAndFrame(surface, max);
      }
      frame();
      const k0 = active();
      const rec = recordWrites();
      for (let s = 0; s < 30; s++) {
        const kind = draw(lcg, 4);
        if (kind === 0) act(() => void surface.scroller.dispatchEvent(new Event("scroll")));
        else if (kind === 1) {
          replaceScriptedHeading(surface, draw(lcg, TAIL.length));
          await flushMutations(); // MutationObserver re-arm
        } else if (kind === 2) ro.fire();
        else {
          content += "\n";
          harness.rerender({ content, documentId: "doc-a" });
          tick(300);
        }
        frame();
        expect(active(), `seed ${DEFAULT_SEED} geometry ${g} step ${s} kind ${kind}`).toBe(k0);
      }
      rec.stop();
      expect(rec.writes, `seed ${DEFAULT_SEED} geometry ${g}`).toEqual([]);
    }
  });

  it("H-7: 240 seeded jumps over 20 headings — conservation and history independence", () => {
    const n = 20;
    const { surface } = setup(makeHeadings(n, (i) => 150 + ((i * 97) % 400)));
    const collapsed = useTOCStore.getState().collapsedIds;
    const lcg = createLcg(DEFAULT_SEED);
    const max = surface.maxScrollTop();
    const seen = new Set<string>();
    for (let s = 0; s < 240; s++) {
      const prev = active();
      scrollAndFrame(surface, draw(lcg, 8) === 0 ? max : draw(lcg, max + 1));
      const label = `seed ${DEFAULT_SEED} step ${s}`;
      const key = active();
      expect(entries().some((e) => e.key === key), `${label} (i)`).toBe(true);
      const want = keyAt(oracle(surface));
      if (surface.scroller.scrollTop < max - T) expect(key, `${label} (ii)`).toBe(want);
      else expect([want, prev], `${label} (iii)`).toContain(key);
      expect(useTOCStore.getState().collapsedIds, `${label} (iv)`).toBe(collapsed);
      seen.add(String(key));
    }
    expect(seen.size, "(v)").toBeGreaterThanOrEqual(10);
  });

  it("H-8: restore into heading 4's body, then re-apply into heading 7's body", () => {
    const { surface } = setup(makeHeadings(10));
    const intoBody = (i: number) => surface.contentOffset(i) + 40 + 12 + 100;
    act(() => {
      surface.scroller.scrollTop = intoBody(4);
      surface.scroller.dispatchEvent(new Event("scroll"));
    });
    frame();
    expect(active()).toBe(keyAt(4));
    act(() => {
      surface.scroller.scrollTop = intoBody(7);
      surface.scroller.dispatchEvent(new Event("scroll"));
    });
    frame();
    expect(active()).toBe(keyAt(7));
  });

  it("H-9: unlaid-out at arm → nothing written; RO reports layout → heading 3", () => {
    const ro = installResizeObserverDouble();
    const container = mountContainer();
    const surface = mountSurface(container, { headings: makeHeadings(8) });
    surface.setScrollTopSilently(surface.scrollTopForHeadingAt(3, SPY_ANCHOR_OFFSET_PX));
    setLaidOut(surface, false);
    const content = contentOf(makeHeadings(8));
    const harness = renderSpy({ content, documentId: "doc-a", enableSpyScrolling: false });
    tick(300);
    expectDistinctKeys("H-9", 8);
    preset(keyAt(0));
    const rec = recordWrites();
    harness.rerender({ content, documentId: "doc-a", enableSpyScrolling: true }); // arm
    frame();
    expect(rec.writes).toEqual([]);
    expect(active()).toBe(keyAt(0));
    setLaidOut(surface, true);
    ro.fire();
    frame();
    rec.stop();
    expect(active()).toBe(keyAt(3));
  });

  it("H-10: no ResizeObserver in the environment → no throw, heading 2", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    expect(globalThis.ResizeObserver).toBeUndefined();
    const { surface } = setup(makeHeadings(6));
    expect(() => scrollHeadingTo(surface, 2, 10)).not.toThrow();
    expect(active()).toBe(keyAt(2));
  });

  it("H-11: RO follows the late surface; a layout shift with no scroll moves the key", async () => {
    const ro = installResizeObserverDouble();
    const container = mountContainer();
    const headings = makeHeadings(8);
    renderSpy({ content: contentOf(headings), documentId: "doc-a" });
    tick(300);
    expectDistinctKeys("H-11", 8);
    const surface = mountSurface(container, { headings });
    await flushMutations();
    expect(ro.observed().has(surface.scroller)).toBe(true);
    expect(ro.observed().has(surface.proseMirror)).toBe(true);
    scrollHeadingTo(surface, 3, 10);
    const before = active();
    expect(before).toBe(keyAt(3));
    const shifted = shiftLayout(surface, 300);
    const want = oracleIndex(headings.length, shifted);
    ro.fire();
    frame();
    expect(active()).toBe(keyAt(want));
    expect(active()).not.toBe(before);
  });

  it("H-12: document switch nulls the key → recompute with no scroll → doc-b heading 1", () => {
    const headings = makeHeadings(6);
    const { surface, harness } = setup(headings);
    scrollHeadingTo(surface, 2, 10);
    const docAKey = active();
    expect(docAKey).toBe(keyAt(2));
    surface.setScrollTopSilently(surface.scrollTopForHeadingAt(1, 10));
    const docB = headings.map((h, i) => ({ ...h, text: `Other ${i}` }));
    harness.rerender({ content: contentOf(docB), documentId: "doc-b" });
    tick(300);
    frame();
    expectDistinctKeys("H-12 doc-b", 6);
    expect(entries()[1].text).toBe("Other 1");
    expect(active()).toBe(keyAt(1));
    expect(active()).not.toBe(docAKey);
  });
});
