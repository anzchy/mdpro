/**
 * `useWysiwygScrollSpy` teardown: the `if (disposed) return;` guard in `recompute`.
 *
 * The cleanup cancels the pending frame, which already stops a stale write on every real
 * platform. To reach the guard on its own, `cancelAnimationFrame` is replaced with a
 * no-op, so the frame scheduled by a scroll survives unmount and is then flushed by hand.
 * The guard must be the only thing that stops the write.
 *
 * Real: `useTOC` → `useWysiwygScrollSpy` → `tocStore`, jsdom DOM, scroll event dispatch.
 * Scripted: layout (`scriptedScrollGeometry`), the parse debounce (fake timers), and rAF
 * (a manual queue, below).
 */
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loggingService } from "../src/services/loggingService";
import type { ScriptedHeading } from "./helpers/scriptedScrollGeometry";
import {
  active, contentOf, expectDistinctKeys, installIoDetector, keyAt, makeHeadings,
  mountContainer, mountSurface, oracle, recordWrites, renderSpy, resetTocStore,
  scrollTo, tick,
} from "./helpers/wysiwygSpyHarness";

/** rAF double: callbacks queue until `flushFrames`; cancel is counted but does nothing. */
let queue: FrameRequestCallback[] = [];
let cancelCalls = 0;

function installInertRaf(): void {
  queue = [];
  cancelCalls = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    queue.push(cb);
    return queue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    cancelCalls += 1;
  });
}

function flushFrames(): void {
  act(() => {
    const pending = queue;
    queue = [];
    for (const cb of pending) cb(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  installIoDetector();
  installInertRaf();
  vi.spyOn(loggingService, "logEventSync").mockImplementation(() => {});
  resetTocStore();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

function setup(headings: ScriptedHeading[]) {
  const container = mountContainer();
  const surface = mountSurface(container, { headings });
  const harness = renderSpy({ content: contentOf(headings), documentId: "doc-a" });
  tick(300);
  expectDistinctKeys("setup", headings.length);
  return { surface, harness };
}

const HEADINGS = makeHeadings(8, () => 300);
/** Heading 3 sits 10px below the scroller top: above the 40px anchor, so it is active. */
const TARGET = 3;

describe("useWysiwygScrollSpy — a frame pending at unmount never writes", () => {
  it("control: with the inert rAF double, a flushed scroll frame does write", () => {
    const { surface } = setup(HEADINGS);
    expect(active()).toBe(keyAt(0));

    scrollTo(surface, surface.scrollTopForHeadingAt(TARGET, 10));
    expect(queue).toHaveLength(1);
    expect(oracle(surface)).toBe(TARGET);

    flushFrames();
    expect(active()).toBe(keyAt(TARGET));
  });

  it("unmount with a frame pending: flushing it leaves activeEntryId and the store untouched", () => {
    const { surface, harness } = setup(HEADINGS);
    const before = active();
    expect(before).toBe(keyAt(0));

    scrollTo(surface, surface.scrollTopForHeadingAt(TARGET, 10));
    expect(queue, "a scroll frame is pending").toHaveLength(1);
    // Fixture guard: had the frame run live, it would have moved the key.
    expect(keyAt(oracle(surface))).not.toBe(before);

    harness.unmount();
    expect(cancelCalls, "cleanup tried to cancel, and the double ignored it").toBe(1);
    expect(queue, "the frame survived unmount").toHaveLength(1);

    const rec = recordWrites();
    flushFrames();
    rec.stop();

    expect(rec.writes).toEqual([]);
    expect(active()).toBe(before);
  });
});
