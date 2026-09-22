/**
 * D17 WI-4 — lifecycle, trigger and cost guarantees of the geometric WYSIWYG spy.
 * Matrix: WI-4 H-13…H-16, H-18…H-22 of `.claude/tdd-guardian/tests-20260922-210708.md`
 * (H-17 lives in `use-wysiwyg-scroll-spy-limit.test.ts`).
 *
 * Real: `useTOC` → `useWysiwygScrollSpy` → `tocStore`, jsdom DOM, MutationObserver, scroll
 * event dispatch. Scripted: layout and scroll writes, rAF (fake timers), ResizeObserver.
 * The geometric IntersectionObserver double is a detector only.
 */
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loggingService } from "../src/services/loggingService";
import { createLcg, DEFAULT_SEED } from "./helpers/headingCorpus";
import { constructedObservers } from "./helpers/geometricIntersectionObserver";
import { mountMilkdownDom } from "./helpers/milkdownHeadingDom";
import { installResizeObserverDouble } from "./helpers/resizeObserverDouble";
import type { ScriptedHeading } from "./helpers/scriptedScrollGeometry";
import {
  active, contentOf, entries, expectDistinctKeys, flushMutations, frame,
  headingReads, installIoDetector, keyAt, makeHeadings, mountContainer, mountSurface, oracle,
  oracleIndex, preset, readBudget, recordWrites, renderSpy, replaceScriptedHeading,
  resetTocStore, scrollAndFrame, scrollHeadingTo, scrollTo, tick,
} from "./helpers/wysiwygSpyHarness";

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  installIoDetector();
  logSpy = vi.spyOn(loggingService, "logEventSync").mockImplementation(() => {});
  resetTocStore();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

function setup(headings: ScriptedHeading[]) {
  const container = mountContainer();
  const surface = mountSurface(container, { headings });
  const harness = renderSpy({ content: contentOf(headings), documentId: "doc-a" });
  tick(300);
  expectDistinctKeys("setup", headings.length);
  return { container, surface, harness };
}

const ROOT_TOP = 90;
const mismatchLogs = () =>
  logSpy.mock.calls.filter((c) => (c[0] as { event: string }).event === "ui.toc.resolve.mismatch");

describe("WI-4 geometric WYSIWYG spy — lifecycle (H-13…H-16, H-18…H-22)", () => {
  it("H-13: a captured `.tableWrapper` scroll never acts as the scroller", () => {
    const { surface } = setup(makeHeadings(8, () => 300));
    scrollHeadingTo(surface, 2, 10);
    expect(active()).toBe(keyAt(2));
    const wrapper = document.createElement("div");
    wrapper.className = "tableWrapper";
    wrapper.getBoundingClientRect = () => ({ top: ROOT_TOP + 400, bottom: ROOT_TOP + 600 }) as DOMRect;
    Object.defineProperty(wrapper, "clientHeight", { get: () => 200 });
    Object.defineProperty(wrapper, "scrollHeight", { get: () => 800 });
    surface.proseMirror.appendChild(wrapper);
    // Fixture guard: measured from the wrapper's top, a different heading would win.
    expect(oracleIndex(8, (i) => surface.relTop(i) - 400)).not.toBe(2);
    const rec = recordWrites();
    act(() => void wrapper.dispatchEvent(new Event("scroll")));
    frame();
    rec.stop();
    expect(rec.writes).toEqual([]);
    expect(active()).toBe(keyAt(2));
  });

  it.each([1, 2, 1000, 3000])("H-14: rect reads bounded for n=%i headings", (n) => {
    const { surface } = setup(makeHeadings(n));
    const lcg = createLcg(DEFAULT_SEED);
    surface.resetRectReads();
    act(() => {
      surface.scroller.scrollTop = ((lcg() >>> 8) % (surface.maxScrollTop() + 1));
      surface.scroller.dispatchEvent(new Event("scroll"));
    });
    frame();
    expect(headingReads(surface), `seed ${DEFAULT_SEED}`).toBeLessThanOrEqual(readBudget(n));
    expect(surface.rectReads.scroller).toBeLessThanOrEqual(1);
    expect(active()).toBe(keyAt(oracle(surface)));
  });

  it("H-15: no per-frame logging over 200 steps; a mismatched mount logs D7 once", () => {
    const { surface, harness } = setup(makeHeadings(20));
    const lcg = createLcg(DEFAULT_SEED);
    logSpy.mockClear();
    for (let s = 0; s < 200; s++) scrollAndFrame(surface, (lcg() >>> 8) % surface.maxScrollTop());
    expect(logSpy).not.toHaveBeenCalled();
    harness.unmount();
    document.body.innerHTML = "";
    resetTocStore();
    const container = mountContainer();
    mountSurface(container, { headings: makeHeadings(3) });
    renderSpy({ content: contentOf(makeHeadings(4)), documentId: "doc-b" });
    tick(300);
    expect(mismatchLogs()).toHaveLength(1);
  });

  type Variant = "a-unmount" | "b-source" | "c-container" | "d-three-events" | "guard";
  it.each<Variant>(["a-unmount", "b-source", "c-container", "d-three-events", "guard"])(
    "H-16 (%s): a pending frame never writes after teardown",
    (variant) => {
      const ro = installResizeObserverDouble();
      const observe = vi.spyOn(MutationObserver.prototype, "observe");
      const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
      const container = mountContainer();
      const other = mountContainer("other-container");
      const listenerSpies = [container, other].map((el) => ({
        add: vi.spyOn(el, "addEventListener"),
        remove: vi.spyOn(el, "removeEventListener"),
      }));
      const headings = makeHeadings(8);
      const surface = mountSurface(container, { headings });
      const harness = renderSpy({ content: contentOf(headings), documentId: "doc-a" });
      tick(300);
      expectDistinctKeys("H-16", 8);
      const before = active();
      expect(before).toBe(keyAt(0));
      const rec = recordWrites();
      const target = surface.scrollTopForHeadingAt(4, 10);
      const content = contentOf(headings);
      if (variant === "d-three-events") {
        act(() => {
          for (let j = 2; j >= 0; j--) {
            surface.scroller.scrollTop = target + j;
            surface.scroller.dispatchEvent(new Event("scroll"));
          }
        });
      } else scrollTo(surface, target);
      if (variant === "a-unmount" || variant === "d-three-events") harness.unmount();
      if (variant === "b-source") harness.rerender({ content, documentId: "doc-a", viewMode: "source" });
      if (variant === "c-container") {
        harness.rerender({ content, documentId: "doc-a", containerId: "other-container" });
      }
      frame();
      frame();
      rec.stop();
      if (variant === "guard") {
        expect(active()).toBe(keyAt(4));
        return;
      }
      expect(rec.writes).toEqual([]);
      expect(active()).toBe(before);
      if (variant !== "a-unmount" && variant !== "d-three-events") harness.unmount();
      const scrollCount = (kind: "add" | "remove") =>
        listenerSpies.reduce(
          (n, spies) => n + spies[kind].mock.calls.filter((c) => c[0] === "scroll").length,
          0,
        );
      expect(scrollCount("add")).toBeGreaterThan(0);
      expect(scrollCount("remove")).toBe(scrollCount("add"));
      expect(disconnect.mock.calls.length).toBe(observe.mock.calls.length);
      expect(ro.disconnectCount()).toBe(ro.constructCount());
    },
  );

  it("H-18: no IntersectionObserver is constructed in any mode", () => {
    const headings = makeHeadings(6);
    const { surface, harness } = setup(headings);
    scrollHeadingTo(surface, 2, 10);
    expect(active()).toBe(keyAt(2));
    const content = contentOf(headings);
    harness.rerender({ content, documentId: "doc-a", viewMode: "source" });
    frame();
    harness.rerender({ content, documentId: "doc-a", enableSpyScrolling: false });
    frame();
    expect(constructedObservers()).toHaveLength(0);
  });

  it("H-19: no `.milkdown` scroller (legacy shape) → no write, no throw, 0 heading reads", () => {
    const fixture = mountMilkdownDom([
      { level: 2, text: "One" },
      { level: 2, text: "Two" },
      { level: 2, text: "Three" },
    ]);
    let reads = 0;
    for (const h of fixture.headings) {
      h.getBoundingClientRect = () => {
        reads += 1;
        return { top: 0, bottom: 10, height: 10 } as DOMRect;
      };
    }
    fixture.headings[0].getBoundingClientRect(); // guard: the counter is wired
    expect(reads).toBe(1);
    reads = 0;
    renderSpy({ content: "## One\n\n## Two\n\n## Three", documentId: "doc-a" });
    tick(300);
    expectDistinctKeys("H-19", 3);
    preset(keyAt(0));
    const rec = recordWrites();
    expect(() => {
      act(() => void fixture.container.dispatchEvent(new Event("scroll")));
      frame();
    }).not.toThrow();
    rec.stop();
    expect(rec.writes).toEqual([]);
    expect(active()).toBe(keyAt(0));
    expect(reads).toBe(0);
  });

  it("H-20: a zero-size heading rect → no throw; conservation holds; non-adjacent = oracle", () => {
    const { surface } = setup(makeHeadings(8));
    surface.headings[3].getBoundingClientRect = () =>
      ({ top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0, x: 0, y: 0 }) as DOMRect;
    const withoutHidden = () =>
      oracleIndex(8, (i) => (i === 3 ? Number.POSITIVE_INFINITY : surface.relTop(i)));
    for (const i of [1, 0, 2, 4, 5, 6]) {
      expect(() => scrollHeadingTo(surface, i, 10)).not.toThrow();
      expect(withoutHidden(), "fixture guard").toBe(i);
      expect(entries().some((e) => e.key === active()), `conservation at ${i}`).toBe(true);
      if (i !== 2 && i !== 4) expect(active(), `position ${i}`).toBe(keyAt(i));
    }
  });

  it("H-21: a replaced scroller is re-resolved; the old one is never read", async () => {
    const { surface: old } = setup(makeHeadings(8));
    scrollHeadingTo(old, 1, 10);
    expect(active()).toBe(keyAt(1));
    const next = mountSurface(document.createElement("div"), { headings: makeHeadings(8, () => 300) });
    act(() => old.scroller.replaceWith(next.scroller));
    await flushMutations();
    old.resetRectReads();
    next.resetRectReads();
    scrollHeadingTo(next, 5, 10);
    expect(active()).toBe(keyAt(5));
    expect(old.rectReads.scroller).toBe(0);
    expect(headingReads(old)).toBe(0);
  });

  it("H-22: an unrelated edit does not recompute; a heading replacement does", async () => {
    const { surface } = setup(makeHeadings(8));
    scrollHeadingTo(surface, 2, 10);
    surface.resetRectReads();
    const rec = recordWrites();
    act(() => {
      surface.proseMirror.appendChild(document.createElement("p"));
      (surface.headings[1].firstChild as Text).nodeValue = "Section 1 edited";
    });
    await flushMutations();
    frame();
    expect(headingReads(surface)).toBe(0);
    expect(rec.writes).toEqual([]);
    replaceScriptedHeading(surface, 2); // guard
    await flushMutations();
    frame();
    rec.stop();
    expect(headingReads(surface)).toBeGreaterThan(0);
  });
});
