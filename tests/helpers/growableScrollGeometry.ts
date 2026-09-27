/**
 * Purpose: the growable sibling of `scriptedScrollGeometry` (D22 WI-1) — the same scripted
 * Milkdown-shaped surface, plus layout that grows AFTER the first scroll write (an image
 * decoding below a heading). Contract: WI-1 of `.claude/tdd-guardian/tests-20260927-112500.md`
 * (decision F1). `scriptedScrollGeometry.ts` is fingerprinted by the D17-WI-3 receipt and
 * must stay byte-identical, so growth lives here rather than as an option there.
 *
 * DOM built by `mountGrowableSurface` (identical to `mountScriptedSurface`):
 *   container > div (wrapper) > div.milkdown (the scroller) > .ProseMirror > hN…
 * `addImage(i)` additionally inserts an `<img>` right after heading i.
 *
 * Geometry:
 * - Heading i's content offset is the sum of every earlier heading's
 *   `height + gap + bodyHeight`, where `bodyHeight` is the scripted one PLUS every
 *   `growBody` applied to that section. It is derived at read time, never cached.
 * - `scrollHeight` (on the scroller and on the returned surface) is a live getter over the
 *   same sum; `maxScrollTop()` = `max(0, scrollHeight − viewHeight)`, also live. With no
 *   growth every value equals `mountScriptedSurface`'s.
 * - Rects: scroller (and container) at `rootTop`; heading i at
 *   `rootTop + contentOffset(i) − scrollTop`.
 * - An image added in section i sits at the top of that section's body:
 *   `rootTop + contentOffset(i) + height(i) + gap − scrollTop`. Its height is the growth
 *   applied to section i so far (0 while "unloaded").
 *
 * Growth rule — `growBody(i, px)` (px ≥ 0, finite):
 * - adds `px` to section i's body, so every heading AFTER i (and every image in a later
 *   section) moves down by `px`; heading i and earlier do not move;
 * - `scrollTop` is NOT changed and NO `scroll` event is dispatched. This models WebKit
 *   without scroll anchoring (`overflow-anchor`): content moves under a fixed viewport.
 *
 * Scroll writes (same as `scriptedScrollGeometry`):
 * - The `scrollTop` setter clamps to `[0, maxScrollTop()]` (the CURRENT limit) and
 *   dispatches ONE `scroll` event on the scroller **synchronously, inside the write**, only
 *   when the clamped value changed (F4: a listener sees the new value before the writer's
 *   next statement runs).
 * - `scrollTo({ top, behavior })` and `heading.scrollIntoView` write the same way;
 *   `behavior: "smooth"` performs `SMOOTH_SCROLL_STEPS` writes, one per animation frame.
 * - `setScrollTopSilently` presets the position with no event.
 *
 * Wrappers: the scroller's own `scrollTop` descriptor, `scrollTo`, `headings[]` and
 * `peekRect` behave as in the base fixture, so `floorScrollWrites` (flooringScroller.ts)
 * and `replaceScriptedHeading` (wysiwygSpyHarness.ts) work on this surface unchanged.
 */
import {
  DEFAULT_GAP,
  DEFAULT_ROOT_TOP,
  DEFAULT_VIEW_HEIGHT,
  SMOOTH_SCROLL_STEPS,
  type ScriptedSurface,
  type ScriptedSurfaceOptions,
} from "./scriptedScrollGeometry";

export interface GrowableSurface extends ScriptedSurface {
  /** Live: the current content height. */
  readonly scrollHeight: number;
  /** Add `px` to section i's body; later content moves down, the viewport does not. */
  growBody(i: number, px: number): void;
  /** Insert an `<img>` at the top of section i's body; its rect follows layout. */
  addImage(i: number): HTMLImageElement;
}

function rect(top: number, height: number, width: number): DOMRect {
  return {
    top,
    bottom: top + height,
    height,
    left: 0,
    right: width,
    width,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/** Build, script and insert the surface in ONE append, like `mountScriptedSurface`. */
export function mountGrowableSurface(
  container: HTMLElement,
  options: ScriptedSurfaceOptions,
): GrowableSurface {
  const rootTop = options.rootTop ?? DEFAULT_ROOT_TOP;
  const viewHeight = options.viewHeight ?? DEFAULT_VIEW_HEIGHT;
  const gap = options.gap ?? DEFAULT_GAP;
  const width = options.width ?? 800;
  const specs = options.headings;

  const wrapper = document.createElement("div");
  const scroller = document.createElement("div");
  scroller.className = "milkdown";
  const proseMirror = document.createElement("div");
  proseMirror.className = "ProseMirror";

  const grown = specs.map(() => 0);
  const headings: HTMLElement[] = specs.map((spec) => {
    const el: HTMLElement = document.createElement(`h${spec.level}`);
    el.textContent = spec.text;
    proseMirror.appendChild(el);
    return el;
  });

  const section = (i: number) => specs[i].height + gap + specs[i].bodyHeight + grown[i];
  const contentOffset = (i: number) => {
    let y = 0;
    for (let j = 0; j < i; j++) y += section(j);
    return y;
  };
  const scrollHeight = () => contentOffset(specs.length);
  const maxScrollTop = () => Math.max(0, scrollHeight() - viewHeight);
  const clamp = (v: number) => Math.max(0, Math.min(v, maxScrollTop()));

  let scrollTop = 0;
  const rectReads = { scroller: 0, headings: headings.map(() => 0) };

  const write = (value: number) => {
    const next = clamp(value);
    if (next === scrollTop) return;
    scrollTop = next;
    scroller.dispatchEvent(new Event("scroll"));
  };

  const scrollToTarget = (target: number, behavior: ScrollBehavior | undefined) => {
    if (behavior !== "smooth") {
      write(target);
      return;
    }
    const from = scrollTop;
    const to = clamp(target);
    const step = (n: number) => {
      requestAnimationFrame(() => {
        write(n === SMOOTH_SCROLL_STEPS ? to : from + ((to - from) * n) / SMOOTH_SCROLL_STEPS);
        if (n < SMOOTH_SCROLL_STEPS) step(n + 1);
      });
    };
    step(1);
  };

  Object.defineProperty(scroller, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => write(v),
  });
  Object.defineProperty(scroller, "clientHeight", { configurable: true, get: () => viewHeight });
  Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: scrollHeight });
  scroller.scrollTo = ((arg?: ScrollToOptions | number, y2?: number) => {
    if (typeof arg === "number") scrollToTarget(y2 ?? scrollTop, undefined);
    else scrollToTarget(arg?.top ?? scrollTop, arg?.behavior);
  }) as HTMLElement["scrollTo"];

  const scrollerRect = () => rect(rootTop, viewHeight, width);
  const headingRect = (i: number) =>
    rect(rootTop + contentOffset(i) - scrollTop, specs[i].height, width);
  const images = new Map<Element, number>();
  const imageRect = (i: number) =>
    rect(rootTop + contentOffset(i) + specs[i].height + gap - scrollTop, grown[i], width);

  scroller.getBoundingClientRect = () => {
    rectReads.scroller += 1;
    return scrollerRect();
  };
  container.getBoundingClientRect = scrollerRect;
  headings.forEach((el, i) => {
    el.getBoundingClientRect = () => {
      rectReads.headings[i] += 1;
      return headingRect(i);
    };
    el.scrollIntoView = ((arg?: boolean | ScrollIntoViewOptions) => {
      const behavior = typeof arg === "object" ? arg.behavior : undefined;
      scrollToTarget(contentOffset(i), behavior);
    }) as HTMLElement["scrollIntoView"];
  });

  scroller.appendChild(proseMirror);
  wrapper.appendChild(scroller);
  container.appendChild(wrapper);

  const checkIndex = (i: number, what: string) => {
    if (!Number.isInteger(i) || i < 0 || i >= specs.length) {
      throw new Error(`${what}: no section ${i} (have ${specs.length})`);
    }
  };

  return {
    wrapper,
    scroller,
    proseMirror,
    headings,
    rootTop,
    viewHeight,
    get scrollHeight() {
      return scrollHeight();
    },
    contentOffset,
    maxScrollTop,
    relTop: (i) => contentOffset(i) - scrollTop,
    scrollTopForHeadingAt: (i, rel) => contentOffset(i) - rel,
    setScrollTopSilently: (v) => {
      scrollTop = clamp(v);
    },
    peekRect: (el) => {
      if (el === scroller || el === container) return scrollerRect();
      const img = images.get(el);
      if (img !== undefined) return imageRect(img);
      const i = headings.indexOf(el as HTMLElement);
      return i < 0 ? null : headingRect(i);
    },
    rectReads,
    resetRectReads: () => {
      rectReads.scroller = 0;
      rectReads.headings.fill(0);
    },
    growBody: (i, px) => {
      checkIndex(i, "growBody");
      if (!Number.isFinite(px) || px < 0) throw new Error(`growBody: px must be ≥ 0, got ${px}`);
      grown[i] += px; // no scrollTop write, no scroll event
    },
    addImage: (i) => {
      checkIndex(i, "addImage");
      const img = document.createElement("img");
      img.getBoundingClientRect = () => imageRect(i);
      images.set(img, i);
      headings[i].after(img);
      return img;
    },
  };
}
