/**
 * `scrollHeadingToAnchor` (src/utils/scrollAnchor/milkdown.ts): outline navigation in
 * WYSIWYG mode.
 *
 * Specification, restated here independently of `src/`:
 * - landing = scrollTop + (heading top − scroller top) − 40, clamped to
 *   [0, scrollHeight − clientHeight], applied with one `scrollTo({ behavior: "auto" })`;
 * - the unclamped landing is rounded UP (`Math.ceil`) before clamping, so a floored
 *   `scrollTop` write cannot leave the heading below the 40px anchor;
 * - no Milkdown scroller → `heading.scrollIntoView({ behavior: "auto", block: "start" })`;
 * - never throws: a rect read or a `scrollTo` that throws leaves `scrollTop` as it was;
 * - returns true when the scroll was issued (including the fallback), false when it caught.
 *
 * Geometry comes from `scriptedScrollGeometry`: rootTop 90, viewHeight 660, gap 12.
 * With 8 headings of height 40 and body 300, heading i's content offset is 352·i,
 * scrollHeight is 2816 and the scroll limit is 2156.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { scrollHeadingToAnchor } from "../src/utils/scrollAnchor/milkdown";
import { floorScrollWrites } from "./helpers/flooringScroller";
import { mountScriptedSurface, type ScriptedSurface } from "./helpers/scriptedScrollGeometry";
import { makeHeadings, mountContainer } from "./helpers/wysiwygSpyHarness";

afterEach(() => {
  document.body.innerHTML = "";
});

function setup(initialScrollTop: number) {
  const container = mountContainer();
  const surface = mountScriptedSurface(container, { headings: makeHeadings(8, () => 300) });
  surface.setScrollTopSilently(initialScrollTop);
  const scrollToSpy = vi.spyOn(surface.scroller, "scrollTo");
  return { container, surface, scrollToSpy };
}

function fixtureGuard(surface: ScriptedSurface): void {
  expect(surface.scrollHeight).toBe(2816);
  expect(surface.maxScrollTop()).toBe(2156);
  expect(surface.rootTop).not.toBe(0);
}

describe("scrollHeadingToAnchor — landing and clamping", () => {
  it("lands the heading 40px below the scroller top: 137 + (1056 − 137) − 40 = 1016", () => {
    const { container, surface, scrollToSpy } = setup(137);
    fixtureGuard(surface);
    expect(scrollHeadingToAnchor(container, surface.headings[3]), "success returns true").toBe(true);
    expect(surface.scroller.scrollTop).toBe(1016);
    expect(scrollToSpy).toHaveBeenCalledTimes(1);
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 1016, behavior: "auto" });
  });

  it("the landing depends on where the heading is, not only on scrollTop (heading 5 → 1720)", () => {
    const { container, surface } = setup(137);
    scrollHeadingToAnchor(container, surface.headings[5]);
    expect(surface.scroller.scrollTop).toBe(1720);
  });

  it("clamps below at 0: heading 0 from scrollTop 500 would land at −40", () => {
    const { container, surface, scrollToSpy } = setup(500);
    scrollHeadingToAnchor(container, surface.headings[0]);
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
    expect(surface.scroller.scrollTop).toBe(0);
  });

  it("clamps above at the scroll limit: heading 7 would land at 2424, limit is 2156", () => {
    const { container, surface, scrollToSpy } = setup(300);
    expect(scrollHeadingToAnchor(container, surface.headings[7]), "a clamped landing is a success").toBe(true);
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 2156, behavior: "auto" });
    expect(surface.scroller.scrollTop).toBe(2156);
  });
});

describe("scrollHeadingToAnchor — sub-pixel geometry", () => {
  // Bodies of 300.5 px put heading i at 352.5·i: heading 3 at 1057.5. From 137 the exact
  // landing is 1017.5; a floored write (WebKit) would leave the heading at 40.5 px, past
  // the spy's `top <= 40` line. Rounding the target up lands it at 39.5 instead.
  it("fractional offset + flooring scrollTop: the heading lands at or above the 40px anchor", () => {
    const container = mountContainer();
    const surface = mountScriptedSurface(container, { headings: makeHeadings(8, () => 300.5) });
    surface.setScrollTopSilently(137);
    floorScrollWrites(surface.scroller);
    expect(surface.contentOffset(3), "fixture: fractional offset").toBe(1057.5);
    expect(surface.contentOffset(3) - 40, "fixture: away from the limit").toBeLessThan(surface.maxScrollTop());
    scrollHeadingToAnchor(container, surface.headings[3]);
    expect(surface.relTop(3), "heading top relative to the scroller").toBeLessThanOrEqual(40);
    expect(surface.relTop(3), "off by less than one pixel").toBeGreaterThan(39);
  });
});

describe("scrollHeadingToAnchor — no scroller falls back to scrollIntoView", () => {
  it("no `.ProseMirror` in the container: scrollIntoView moves the container, returns true", () => {
    const container = mountContainer();
    const heading = document.createElement("h2");
    container.appendChild(heading);
    let containerTop = 0;
    Object.defineProperty(container, "scrollTop", { configurable: true, get: () => containerTop });
    const intoView = vi.fn(() => {
      containerTop = 480;
    });
    heading.scrollIntoView = intoView;
    expect(scrollHeadingToAnchor(container, heading)).toBe(true);
    expect(intoView).toHaveBeenCalledTimes(1);
    expect(intoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
    expect(container.scrollTop, "the scripted scrollIntoView ran").toBe(480);
  });

  it("`.ProseMirror`'s parent is not `.milkdown`: scrollIntoView moves that parent, not scrollTo", () => {
    const container = mountContainer();
    const parent = document.createElement("div");
    const view = document.createElement("div");
    view.className = "ProseMirror";
    const heading = document.createElement("h2");
    view.appendChild(heading);
    parent.appendChild(view);
    container.appendChild(parent);
    let parentTop = 0;
    Object.defineProperty(parent, "scrollTop", { configurable: true, get: () => parentTop });
    const intoView = vi.fn(() => {
      parentTop = 256;
    });
    heading.scrollIntoView = intoView;
    const scrollTo = vi.fn();
    parent.scrollTo = scrollTo;
    expect(scrollHeadingToAnchor(container, heading)).toBe(true);
    expect(intoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
    expect(parent.scrollTop).toBe(256);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("scrollIntoView throws: no throw, returns false", () => {
    const container = mountContainer();
    const heading = document.createElement("h2");
    container.appendChild(heading);
    heading.scrollIntoView = () => {
      throw new Error("detached");
    };
    expect(scrollHeadingToAnchor(container, heading)).toBe(false);
  });
});

describe("scrollHeadingToAnchor — never throws", () => {
  it("heading.getBoundingClientRect throws: no throw, scrollTop unchanged, no scrollTo", () => {
    const { container, surface, scrollToSpy } = setup(250);
    const heading = surface.headings[3];
    heading.getBoundingClientRect = () => {
      throw new Error("detached");
    };
    let ok: boolean | undefined;
    expect(() => {
      ok = scrollHeadingToAnchor(container, heading);
    }).not.toThrow();
    expect(ok, "a caught failure returns false").toBe(false);
    expect(surface.scroller.scrollTop).toBe(250);
    expect(scrollToSpy).not.toHaveBeenCalled();
  });

  it("scroller.scrollTo throws: no throw, scrollTop unchanged", () => {
    const { container, surface } = setup(250);
    const failing = vi.fn(() => {
      throw new Error("scrollTo failed");
    });
    surface.scroller.scrollTo = failing as unknown as HTMLElement["scrollTo"];
    let ok: boolean | undefined;
    expect(() => {
      ok = scrollHeadingToAnchor(container, surface.headings[3]);
    }).not.toThrow();
    expect(ok, "a caught failure returns false").toBe(false);
    expect(failing).toHaveBeenCalledTimes(1);
    expect(surface.scroller.scrollTop).toBe(250);
  });
});
