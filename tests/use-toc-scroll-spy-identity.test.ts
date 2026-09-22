/**
 * Purpose: which TOC entry the WYSIWYG scroll spy activates — identity through
 * `useTOC` → `useWysiwygScrollSpy` → `tocStore`, over a scripted Milkdown surface.
 *
 * Migrated in D17 WI-4 (matrix `.claude/tdd-guardian/tests-20260922-210708.md`, section
 * "tests/use-toc-scroll-spy-identity.test.ts (§7) — WI-4"): D17 disproved the IO-record
 * specification; DECISION A is superseded by ADR-0026. The active heading is the LAST
 * heading whose top is at or above `SPY_ANCHOR_OFFSET_PX` below the scroller top, so R3,
 * R3b, C-3 and C-4 now scroll a heading to the anchor instead of delivering IO records,
 * C-2 permutes intermediate scroll positions, C-5 pins the only two cases that keep the
 * key, and C-L1′ checks the rule against an independent oracle over a seeded walk.
 *
 * Doubles: layout and scroll writes (`scriptedScrollGeometry`), rAF (fake timers). The
 * geometric IntersectionObserver double is installed as a detector only. Nothing else
 * is mocked: the Lezer parser, the key matcher, the store and the DOM are real. No
 * literal key string is asserted; standing rule H2 opens every case.
 */
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SPY_ANCHOR_OFFSET_PX as ANCHOR,
  SPY_SCROLL_LIMIT_TOLERANCE_PX as T,
} from "../src/utils/codemirrorViewportLine";
import { CORPUS_ALPHABET, createLcg, DEFAULT_SEED } from "./helpers/headingCorpus";
import type { ScriptedHeading, ScriptedSurface } from "./helpers/scriptedScrollGeometry";
import {
  active, contentOf, entries, expectDistinctKeys, flushMutations, frame, headingReads,
  installIoDetector, keyAt, mountContainer, mountSurface, oracle, oracleIndex, readBudget,
  renderSpy, resetTocStore, scrollAndFrame, scrollHeadingTo, setLaidOut, shiftLayout, tick,
} from "./helpers/wysiwygSpyHarness";

beforeEach(() => {
  vi.useFakeTimers();
  installIoDetector();
  resetTocStore();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

const h = (level: ScriptedHeading["level"], text: string, bodyHeight = 400): ScriptedHeading => ({
  level,
  text,
  height: 40,
  bodyHeight,
});

function setup(headings: ScriptedHeading[], where: string) {
  const container = mountContainer();
  const surface = mountSurface(container, { headings });
  const harness = renderSpy({ content: contentOf(headings), documentId: "doc-a" });
  tick(300);
  expectDistinctKeys(where, headings.length);
  return { container, surface, harness };
}

// A heading can reach the anchor only if `maxScrollTop` ≥ its offset − anchor; with two
// 400px bodies heading 1 sits at 208px at the scroll limit, 168px short of the 40px
// anchor. The last heading therefore carries a 700px body.
const REACH_BODY = 700;
const INTRO_TWICE = [h(1, "Intro"), h(1, "Intro", REACH_BODY)];
const THREE_DISTINCT = [h(1, "Alpha"), h(2, "Beta"), h(2, "Gamma")];

describe("§7 useTOC WYSIWYG scroll spy — which entry is active", () => {
  it("R3: REGRESSION — a heading whose Milkdown id diverges from our slug activates at the anchor", () => {
    const { surface } = setup([h(1, "Intro"), h(1, "Hello, World!", REACH_BODY)], "R3");
    surface.headings[1].id = "hello,-world!"; // the measured Milkdown id; read by nothing
    // Wrong-reason guard: the case must not pass by the two namespaces agreeing.
    expect(entries()[1].anchorSlug as string).not.toBe(surface.headings[1].id);
    expect(active()).toBe(keyAt(0)); // positive guard: the arm-time oracle
    scrollHeadingTo(surface, 1, ANCHOR);
    expect(surface.relTop(1), "fixture guard: the heading reached the anchor").toBe(ANCHOR);
    expect(active()).toBe(keyAt(1));
  });

  it("R3b: REGRESSION — the second duplicate at the anchor activates the second entry", () => {
    const { surface } = setup(INTRO_TWICE, "R3b");
    scrollHeadingTo(surface, 1, ANCHOR);
    expect(surface.relTop(1), "fixture guard: the heading reached the anchor").toBe(ANCHOR);
    expect(active()).toBe(keyAt(1));
    // "Activated something" is not "activated the right thing".
    expect(active()).not.toBe(keyAt(0));
  });

  it("R3b (added row): the first duplicate at/above the anchor with the second below → the first", () => {
    const { surface } = setup(INTRO_TWICE, "R3b added");
    scrollHeadingTo(surface, 1, ANCHOR);
    expect(active()).toBe(keyAt(1)); // guard: the move below is a real change
    scrollAndFrame(surface, 0);
    expect(surface.relTop(0)).toBeLessThanOrEqual(ANCHOR);
    expect(surface.relTop(1)).toBeGreaterThan(ANCHOR);
    expect(active()).toBe(keyAt(0));
  });

  it("C-2: the same final scrollTop via 3 permuted intermediate sequences in one frame → one key", () => {
    const dom = [h(1, "One"), h(2, "Two"), h(2, "Three"), h(3, "Four")];
    const { surface } = setup(dom, "C-2");
    const a = surface.scrollTopForHeadingAt(3, 10);
    const b = surface.scrollTopForHeadingAt(1, 10);
    const c = surface.scrollTopForHeadingAt(3, 300);
    const final = surface.scrollTopForHeadingAt(2, 10);
    expect(new Set([0, a, b, c, final]).size).toBe(5);
    expect(oracleIndex(4, (i) => surface.contentOffset(i) - final), "fixture guard").toBe(2);

    const seen: Array<string | null> = [];
    for (const order of [[a, b, c], [c, a, b], [b, c, a]]) {
      scrollAndFrame(surface, 0);
      expect(active(), `reset before ${order.join(",")}`).toBe(keyAt(0));
      surface.resetRectReads();
      act(() => {
        for (const top of [...order, final]) surface.scroller.scrollTop = top;
      });
      frame();
      expect(headingReads(surface), "one recompute per frame").toBeLessThanOrEqual(readBudget(4));
      seen.push(active());
    }
    expect(seen).toEqual([keyAt(2), keyAt(2), keyAt(2)]);
  });

  it("C-3: GUARD — after a rebuild the stale element (scripted at the anchor) is never read", async () => {
    const container = mountContainer();
    const first = mountSurface(container, { headings: INTRO_TWICE });
    const { rerender } = renderSpy({ content: contentOf(INTRO_TWICE), documentId: "doc-a" });
    tick(300);
    expectDistinctKeys("C-3", 2);
    scrollHeadingTo(first, 1, ANCHOR);
    expect(first.relTop(1), "fixture guard: the heading reached the anchor").toBe(ANCHOR);
    expect(active()).toBe(keyAt(1));

    const stale = first.headings[1];
    let staleReads = 0;
    stale.getBoundingClientRect = () => {
      staleReads += 1;
      return { top: first.rootTop + ANCHOR, bottom: first.rootTop + ANCHOR + 40, height: 40 } as DOMRect;
    };
    first.wrapper.remove();
    const rebuilt = [...INTRO_TWICE, h(1, "Third", REACH_BODY)];
    const second = mountSurface(container, { headings: rebuilt });
    rerender({ content: contentOf(rebuilt), documentId: "doc-a" });
    tick(300);
    await flushMutations();
    expectDistinctKeys("C-3 rebuilt", 3);
    expect(document.contains(stale)).toBe(false);

    scrollHeadingTo(second, 2, 10);
    expect(second.relTop(2), "fixture guard: the heading reached rel 10").toBe(10);
    expect(staleReads).toBe(0);
    expect(active()).toBe(keyAt(oracle(second)));
    expect(active()).toBe(keyAt(2));
  });

  it("C-4: scrolling up promotes heading 0 from heading 1", () => {
    const { surface } = setup(THREE_DISTINCT, "C-4");
    scrollHeadingTo(surface, 1, ANCHOR);
    expect(active()).toBe(keyAt(1));
    scrollHeadingTo(surface, 1, ANCHOR + 1);
    expect(active()).toBe(keyAt(0));
  });

  describe("C-5: the key is kept only when there is nothing to pick", () => {
    it("(a) the first heading's top is below the anchor → the non-null key is kept", () => {
      const { surface } = setup(THREE_DISTINCT, "C-5a");
      scrollHeadingTo(surface, 1, ANCHOR);
      expect(active()).toBe(keyAt(1)); // starts from a non-null key
      const shifted = shiftLayout(surface, 200);
      scrollAndFrame(surface, 0);
      expect(oracleIndex(3, shifted), "fixture guard: nothing above the anchor").toBeNull();
      expect(active()).toBe(keyAt(1));
    });

    it("(b) clientHeight 0 → kept; laid out again, the same position picks the oracle", () => {
      const { surface } = setup(THREE_DISTINCT, "C-5b");
      scrollHeadingTo(surface, 1, ANCHOR);
      expect(active()).toBe(keyAt(1));
      setLaidOut(surface, false);
      scrollAndFrame(surface, 0);
      expect(active()).toBe(keyAt(1));
      setLaidOut(surface, true); // positive guard: not a frozen spy
      act(() => void surface.scroller.dispatchEvent(new Event("scroll")));
      frame();
      expect(active()).toBe(keyAt(0));
    });
  });

  it("C-L1′: LAW over a seeded 240-step walk with content changes at steps 80 and 160", async () => {
    const SEED_LABEL = `seed=0x${DEFAULT_SEED.toString(16)}`;
    const rng = createLcg(DEFAULT_SEED);
    const draw = (m: number) => (rng() >>> 8) % m;
    const makeDom = () =>
      Array.from({ length: 8 }, () =>
        h((draw(6) + 1) as ScriptedHeading["level"], CORPUS_ALPHABET[draw(CORPUS_ALPHABET.length)], 100 + draw(500)),
      );

    const container = mountContainer();
    let dom = makeDom();
    let surface: ScriptedSurface = mountSurface(container, { headings: dom });
    const { rerender } = renderSpy({ content: contentOf(dom), documentId: "doc-a" });
    tick(300);
    expectDistinctKeys(`C-L1′ initial (${SEED_LABEL})`, 8);
    let previous = active();
    let atLimitSteps = 0;

    for (let step = 1; step <= 240; step++) {
      const label = `step ${step} (${SEED_LABEL})`;
      if (step === 80 || step === 160) {
        dom = [...dom.slice(1), ...makeDom().slice(0, 1)];
        surface.wrapper.remove();
        surface = mountSurface(container, { headings: dom });
        rerender({ content: contentOf(dom), documentId: "doc-a" });
        tick(300);
        await flushMutations();
        expectDistinctKeys(`C-L1′ ${label}`, 8);
      } else {
        const max = surface.maxScrollTop();
        scrollAndFrame(surface, draw(8) === 0 ? max - draw(T + 1) : draw(max + 1));
      }
      const key = active();
      expect(key === null || entries().some((e) => e.key === key), `${label}: conservation`).toBe(true);
      const expected = keyAt(oracle(surface));
      const atLimit = surface.scroller.scrollTop >= surface.maxScrollTop() - T;
      if (!atLimit) expect(key, `${label}: off the limit, key = oracle`).toBe(expected);
      else {
        atLimitSteps += 1;
        expect([expected, previous], `${label}: at the limit`).toContain(key);
      }
      previous = key;
    }
    expect(atLimitSteps, "the walk must reach the limit, or its clause is untested").toBeGreaterThan(0);
  });
});
