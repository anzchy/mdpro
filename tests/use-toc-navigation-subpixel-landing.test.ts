/**
 * D17 final review — WYSIWYG click-to-navigate on sub-pixel geometry.
 *
 * Headings sit at fractional content offsets (bodies of 400.5 px → heading i at 452.5·i)
 * and the scroller floors every `scrollTop` write, as WebKit does. The clicked heading
 * must still be the one the geometric spy picks on the next frame: landing it at 40.5 px
 * (floored `offset − 40`) would put it past the spy's `top <= 40` line and hand the
 * highlight to the previous heading. Away from the scroll limit, so limit retention
 * cannot mask the result.
 */
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loggingService } from "../src/services/loggingService";
import { SPY_ANCHOR_OFFSET_PX as ANCHOR } from "../src/utils/codemirrorViewportLine";
import { floorScrollWrites } from "./helpers/flooringScroller";
import {
  active, contentOf, expectDistinctKeys, frame, installIoDetector, keyAt, makeHeadings,
  mountContainer, mountSurface, renderSpy, resetTocStore, tick,
} from "./helpers/wysiwygSpyHarness";

beforeEach(() => {
  vi.useFakeTimers();
  installIoDetector();
  vi.spyOn(loggingService, "logEventSync").mockImplementation(() => {});
  resetTocStore();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("WYSIWYG navigation on fractional geometry with a flooring scroller", () => {
  it("the clicked heading is still active after the next spy frame", () => {
    const dom = makeHeadings(12, () => 400.5);
    const container = mountContainer();
    const surface = mountSurface(container, { headings: dom, rootTop: 90, viewHeight: 660 });
    floorScrollWrites(surface.scroller);
    const { result } = renderSpy({ content: contentOf(dom), documentId: "doc-a" });
    tick(300);
    expectDistinctKeys("setup", dom.length);
    const k = 7;
    expect(surface.contentOffset(k), "fixture: fractional offset").toBe(3167.5);
    expect(surface.contentOffset(k) - ANCHOR, "fixture: away from the limit").toBeLessThan(
      surface.maxScrollTop() - 100,
    );

    act(() => result.current.navigateToEntry(keyAt(k)!));
    expect(active(), "written by the click").toBe(keyAt(k));
    frame();
    expect(active(), "spy agrees with the click").toBe(keyAt(k));
    expect(surface.relTop(k), "landed at or above the anchor").toBeLessThanOrEqual(ANCHOR);
  });
});
