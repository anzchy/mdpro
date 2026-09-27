/**
 * D22 WI-1 — self-tests of the growth fixture `tests/helpers/growableScrollGeometry.ts`
 * (cases G-01 to G-05 of `.claude/tdd-guardian/tests-20260927-112500.md`).
 *
 * Law: growth moves content and never the viewport. `growBody(i, px)` shifts exactly the
 * headings after i by px; `scrollTop` and the `scroll` event count do not change;
 * `maxScrollTop()` grows by exactly the total growth. The real-Milkdown rig cases (G-06,
 * G-07) live in `tests/scripted-milkdown-rig.test.ts`.
 *
 * Mocked: `@tauri-apps/api/*` only (the harness import reaches `src/` hooks).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async () => null),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));

import { floorScrollWrites } from "./helpers/flooringScroller";
import { mountGrowableSurface, type GrowableSurface } from "./helpers/growableScrollGeometry";
import { createLcg, DEFAULT_SEED } from "./helpers/headingCorpus";
import { mountScriptedSurface } from "./helpers/scriptedScrollGeometry";
import { makeHeadings, replaceScriptedHeading } from "./helpers/wysiwygSpyHarness";

const COUNT = 12;
const HEADING_HEIGHT = 40;
const GAP = 12;
const BODY = 100;
const VIEW_HEIGHT = 660;

/** The standard growth fixture G12 with every body 100, preset to scrollTop 300. */
function g12(): GrowableSurface {
  const container = document.body.appendChild(document.createElement("div"));
  const surface = mountGrowableSurface(container, { headings: makeHeadings(COUNT, () => BODY) });
  surface.setScrollTopSilently(300);
  return surface;
}

/** A rect's geometry without its `toJSON` closure (functions compare by reference). */
const box = (r: DOMRect | null) =>
  r && { top: r.top, bottom: r.bottom, height: r.height, left: r.left, right: r.right, width: r.width };

const tops = (s: GrowableSurface) => s.headings.map((h) => (s.peekRect(h) as DOMRect).top);

function countScrolls(el: HTMLElement): () => number {
  let n = 0;
  el.addEventListener("scroll", () => {
    n += 1;
  });
  return () => n;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("growableScrollGeometry — growth moves content, never the viewport", () => {
  it("G-01: growBody(2, 400) shifts only headings 3+ by exactly 400 and leaves scrollTop alone", () => {
    const surface = g12();
    const before = tops(surface);
    expect(before[3] - before[2]).toBe(HEADING_HEIGHT + GAP + BODY); // fixture guard

    surface.growBody(2, 400);

    expect(tops(surface)).toEqual(before.map((t, j) => (j <= 2 ? t : t + 400)));
    expect(surface.scroller.scrollTop).toBe(300);
  });

  it("G-02: growth fires no scroll event, and the scroll limit and live scrollHeight rise exactly", () => {
    const surface = g12();
    const scrolls = countScrolls(surface.scroller);
    expect(surface.maxScrollTop()).toBe(1164);
    expect(surface.scroller.scrollHeight).toBe(1824);
    expect(surface.scrollHeight).toBe(1824);

    surface.growBody(2, 400);

    expect(scrolls()).toBe(0);
    expect(surface.maxScrollTop()).toBe(1564);
    expect(surface.scroller.scrollHeight).toBe(2224);
    expect(surface.scrollHeight).toBe(2224);
  });

  it("G-03 LAW: offset spacing and the scroll limit hold across 50 seeded random growth steps", () => {
    const surface = g12();
    const rng = createLcg(DEFAULT_SEED);
    const body = Array.from({ length: COUNT }, () => BODY);
    const scrolls = countScrolls(surface.scroller);

    for (let step = 0; step < 50; step++) {
      const i = rng() % COUNT;
      const px = 1 + (rng() % 600) + (step % 2 === 1 ? 0.5 : 0);
      surface.growBody(i, px);
      body[i] += px;
      const where = `seed ${DEFAULT_SEED} step ${step} (growBody(${i}, ${px}))`;

      for (let k = 0; k < COUNT - 1; k++) {
        expect(surface.contentOffset(k + 1) - surface.contentOffset(k), `${where}, gap ${k}`).toBe(
          HEADING_HEIGHT + GAP + body[k],
        );
      }
      const total = body.reduce((sum, b) => sum + HEADING_HEIGHT + GAP + b, 0);
      expect(surface.maxScrollTop(), where).toBe(Math.max(0, total - VIEW_HEIGHT));
      expect(surface.scroller.scrollTop, where).toBe(300);
    }
    expect(scrolls()).toBe(0);
  });

  it("G-04: addImage's rect follows layout, and its load reaches a capture listener on the scroller", () => {
    const surface = g12();
    const img = surface.addImage(2);

    expect(surface.proseMirror.contains(img)).toBe(true);
    expect(img.getBoundingClientRect().top).toBe(90 + 304 + 52 - 300); // 146

    surface.growBody(1, 400);
    expect(img.getBoundingClientRect().top).toBe(546);

    const targets: EventTarget[] = [];
    surface.scroller.addEventListener("load", (e) => targets.push(e.target as EventTarget), true);
    img.dispatchEvent(new Event("load")); // non-bubbling, like a real image load
    expect(targets).toEqual([img]);
  });

  it("G-05: with no growth, geometry is identical to mountScriptedSurface", () => {
    const headings = makeHeadings(8, () => 300);
    const a = mountScriptedSurface(document.body.appendChild(document.createElement("div")), { headings });
    const b = mountGrowableSurface(document.body.appendChild(document.createElement("div")), { headings });

    for (const s of [a, b]) {
      expect(s.scrollHeight).toBe(2816);
      expect(s.scroller.scrollHeight).toBe(2816);
      expect(s.maxScrollTop()).toBe(2156);
    }
    for (const top of [0, 1016]) {
      a.setScrollTopSilently(top);
      b.setScrollTopSilently(top);
      expect(b.headings.map((h) => box(b.peekRect(h)))).toEqual(a.headings.map((h) => box(a.peekRect(h))));
      expect(box(b.peekRect(b.scroller))).toEqual(box(a.peekRect(a.scroller)));
    }
  });
});

describe("growableScrollGeometry — existing wrappers keep working (F1)", () => {
  it("G-01b: a changed scrollTop write fires ONE synchronous scroll (F4); floorScrollWrites floors it", () => {
    const surface = g12();
    floorScrollWrites(surface.scroller);
    const seen: number[] = [];
    surface.scroller.addEventListener("scroll", () => seen.push(surface.scroller.scrollTop));

    surface.scroller.scrollTo({ top: 510.7, behavior: "auto" });
    expect(seen).toEqual([510]); // delivered inside the write, value already applied
    surface.scroller.scrollTop = 510.2; // floors to the same value: no event
    expect(seen).toEqual([510]);

    surface.growBody(0, 1000);
    surface.scroller.scrollTop = 2000; // the grown limit (2164) admits it
    expect(seen).toEqual([510, 2000]);
  });

  it("G-01c: replaceScriptedHeading's fresh element follows growth made after the swap", () => {
    const surface = g12();
    const { fresh } = replaceScriptedHeading(surface, 4);
    const before = fresh.getBoundingClientRect().top;

    surface.growBody(3, 250);

    expect(fresh.getBoundingClientRect().top).toBe(before + 250);
    expect((surface.peekRect(fresh) as DOMRect).top).toBe(before + 250);
  });

  it("G-01d: heading.scrollIntoView lands on the grown offset", () => {
    const surface = g12();
    surface.growBody(0, 300);
    surface.headings[5].scrollIntoView({ behavior: "auto", block: "start" });
    expect(surface.scroller.scrollTop).toBe(5 * (HEADING_HEIGHT + GAP + BODY) + 300);
  });
});
