/**
 * D22 WI-1 — self-tests of `tests/helpers/scriptedMilkdownRig.ts` (cases G-06 and G-07 of
 * `.claude/tdd-guardian/tests-20260927-112500.md`), split from
 * `scripted-scroll-geometry-growth.test.ts` for the 300-line limit.
 *
 * Law: `growBlock(k, px)` shifts the rects of blocks k+1 and later by exactly px, grows
 * block k's own height by px, and never writes `scrollTop`. Images inside block k report
 * block k's rect. A changed `scrollTop` write dispatches one synchronous `scroll` event.
 *
 * Real Milkdown (commonmark + gfm) is mounted with real timers, then fake timers take
 * over. Mocked: `@tauri-apps/api/*` only. Geometry is scripted (jsdom has no layout); the
 * paired real path is the manual GUI-D22-2.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async () => null),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));

import {
  captureMilkdownScrollAnchor,
  restoreMilkdownScrollAnchor,
} from "../src/utils/scrollAnchor/milkdown";
import { mountScriptedMilkdownRig, type MilkdownRig } from "./helpers/scriptedMilkdownRig";

const RIG_DOC =
  "# A\n\n![one](a.png)\n\n![two](b.png)\n\n## B\n\npara b\n\n## C\n\npara c\n\n## D\n\npara d\n";
/** 80 per block; blocks 1 and 2 (the images) start unsized; block 8 is 2000 tall. */
const HEIGHTS = [80, 0, 0, 80, 80, 80, 80, 80, 2000];
const RIG_OPTIONS = { heights: HEIGHTS, margin: 20, rootTop: 90, viewHeight: 600 };
const BLOCKS = HEIGHTS.length;

let rig: MilkdownRig | null = null;

async function mountRig(): Promise<MilkdownRig> {
  rig = await mountScriptedMilkdownRig(RIG_DOC, RIG_OPTIONS);
  vi.useFakeTimers();
  return rig;
}

/** A rect's geometry without its `toJSON` closure (functions compare by reference). */
const box = (r: DOMRect) => ({ top: r.top, bottom: r.bottom, height: r.height, left: r.left, right: r.right, width: r.width });

function countScrolls(el: HTMLElement): () => number {
  let n = 0;
  el.addEventListener("scroll", () => {
    n += 1;
  });
  return () => n;
}

afterEach(async () => {
  vi.useRealTimers();
  await rig?.destroy();
  rig = null;
  document.body.innerHTML = "";
});

describe("scriptedMilkdownRig — real Milkdown with growable block heights", () => {
  it("G-06: growBlock(1, 300) shifts blocks 2+ by 300, sizes block 1, and leaves scrollTop alone", async () => {
    const r = await mountRig();
    expect(r.view.state.doc.childCount).toBe(BLOCKS); // fixture guard: a Milkdown upgrade fails here
    r.setScrollTopSilently(250);
    const scrolls = countScrolls(r.scroller);
    const before = Array.from({ length: BLOCKS }, (_, k) => r.blockRect(k).top);
    expect(before[3]).toBe(90 + 140 - 250); // guard: tops come from the height table

    r.growBlock(1, 300);

    const after = Array.from({ length: BLOCKS }, (_, k) => r.blockRect(k).top);
    expect(after).toEqual(before.map((t, k) => (k <= 1 ? t : t + 300)));
    expect(r.blockRect(1).height).toBe(300);
    expect(r.scroller.scrollTop).toBe(250);
    expect(scrolls()).toBe(0);

    const imgs = r.images(1);
    expect(imgs).toHaveLength(1);
    expect(box(imgs[0].getBoundingClientRect())).toEqual(box(r.blockRect(1)));
    // Reads go through the element the adapter reads, not only the rig's own accessor.
    expect(r.blockElement(4).getBoundingClientRect().top).toBe(after[4]);
  });

  it("G-06b: growth raises the live scroll limit, and a changed write fires one synchronous scroll", async () => {
    const r = await mountRig();
    const seen: number[] = [];
    r.scroller.addEventListener("scroll", () => seen.push(r.scroller.scrollTop));
    expect(r.scrollHeight).toBe(2660);
    expect(r.scroller.scrollHeight).toBe(2660);
    expect(r.maxScrollTop()).toBe(2060);

    r.growBlock(2, 500);
    expect(r.scroller.scrollHeight).toBe(3160);
    expect(r.maxScrollTop()).toBe(2560);
    expect(seen).toEqual([]);

    r.setScrollTop(2400);
    r.scroller.scrollTop = 2400; // same value: no event
    r.scroller.scrollTop = 99999; // clamped to the grown limit
    expect(seen).toEqual([2400, 2560]);
  });

  it("G-07: round trip through the real adapter with no growth returns to the captured position", async () => {
    const r = await mountRig();
    r.setScrollTop(333);
    const a = captureMilkdownScrollAnchor(r.view, r.scroller, "d");
    expect(a).not.toBeNull();

    r.setScrollTop(0);
    expect(restoreMilkdownScrollAnchor(r.view, r.scroller, a!)).toBe(true);

    expect(r.scroller.scrollTop).toBeCloseTo(333, 6);
    expect(captureMilkdownScrollAnchor(r.view, r.scroller, "d")).toEqual(a);
  });
});
