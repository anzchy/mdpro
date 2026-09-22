/**
 * Purpose: scripted layout for a Milkdown-shaped scroll surface, because jsdom has no
 * layout and never moves or emits on a scroll write. Contract: §0 "Fixture contract for
 * `scriptedScrollGeometry`" of `.claude/tdd-guardian/tests-20260922-210708.md` (Revision 1).
 *
 * DOM built by `mountScriptedSurface`:
 *   container > div (wrapper) > div.milkdown (the scroller) > .ProseMirror > hN…
 * Nothing but headings is inserted into `.ProseMirror`; paragraph bodies exist only as
 * pixel heights (`bodyHeight`), which is all a geometric spy can see anyway.
 *
 * Geometry:
 * - Heading i has a fixed **content offset**: the sum of every earlier heading's
 *   `height + gap + bodyHeight`. `scrollHeight` is the total of all of them.
 * - The scroller's rect top is `rootTop` (non-zero by default: 90, as in the D17 seed),
 *   so any implementation mixing viewport and scroller-relative coordinates is caught.
 * - Heading i's rect top is `rootTop + contentOffset(i) − scrollTop`, derived at read time.
 * - The container's rect equals the scroller's (the IO double uses it as `root`); it is
 *   not counted.
 *
 * Scroll writes:
 * - The `scrollTop` setter clamps to `[0, maxScrollTop()]` and dispatches ONE `scroll`
 *   event on the scroller **synchronously**, and only when the clamped value changed —
 *   browsers fire nothing for a same-value write. Stated deviation: real engines deliver
 *   `scroll` at the next rendering step; a spy that samples at frame time and coalesces
 *   sees the same frame either way.
 * - `scroller.scrollTo({ top, behavior })` and `heading.scrollIntoView({ behavior })`
 *   (block "start" → target `contentOffset(i)`) perform one such write, unless
 *   `behavior: "smooth"`, which performs 4 writes, one per `requestAnimationFrame`, each
 *   emitting `scroll`, ending exactly at the (clamped) target.
 * - `setScrollTopSilently` presets the position with no event (models layout that
 *   arrives before any listener, e.g. H-1).
 *
 * Rect reads: every `getBoundingClientRect` call on the scroller or on a heading
 * increments a counter the test owns (`rectReads`, `resetRectReads`). `peekRect` reads
 * the same geometry without counting — for oracles and for the IO double.
 */

export interface ScriptedHeading {
  /** `h1`…`h6`. */
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  /** Rendered height of the heading element, px. */
  height: number;
  /** Pixels of body content between this heading's bottom gap and the next heading. */
  bodyHeight: number;
}

export interface ScriptedSurfaceOptions {
  headings: readonly ScriptedHeading[];
  /** Viewport y of the scroller's top edge. Default 90. */
  rootTop?: number;
  /** Scroller `clientHeight`. Default 660. */
  viewHeight?: number;
  /** Gap below every heading, px. Default 12. */
  gap?: number;
  /** Scroller width for rects. Default 800. */
  width?: number;
}

export interface ScriptedSurface {
  wrapper: HTMLElement;
  scroller: HTMLElement;
  proseMirror: HTMLElement;
  headings: HTMLElement[];
  rootTop: number;
  viewHeight: number;
  scrollHeight: number;
  /** px from the scroller's content top to heading i's top. */
  contentOffset(i: number): number;
  maxScrollTop(): number;
  /** Heading i's top relative to the scroller's top edge (what the anchor is measured in). */
  relTop(i: number): number;
  /** `scrollTop` that puts heading i's top `rel` px below the scroller top (unclamped). */
  scrollTopForHeadingAt(i: number, rel: number): number;
  setScrollTopSilently(value: number): void;
  /** Uncounted rect of the scroller, a heading, or the container; null for anything else. */
  peekRect(el: Element): DOMRect | null;
  rectReads: { scroller: number; headings: number[] };
  resetRectReads(): void;
}

export const DEFAULT_ROOT_TOP = 90;
export const DEFAULT_VIEW_HEIGHT = 660;
export const DEFAULT_GAP = 12;
/** Number of frame-stepped writes a `behavior: "smooth"` scroll performs. */
export const SMOOTH_SCROLL_STEPS = 4;

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

/**
 * Build the surface, script its geometry, and append it to `container` in ONE insert
 * (what `@milkdown/react` does after the spy armed), so a MutationObserver on the
 * container sees a single subtree mutation.
 */
export function mountScriptedSurface(
  container: HTMLElement,
  options: ScriptedSurfaceOptions,
): ScriptedSurface {
  const rootTop = options.rootTop ?? DEFAULT_ROOT_TOP;
  const viewHeight = options.viewHeight ?? DEFAULT_VIEW_HEIGHT;
  const gap = options.gap ?? DEFAULT_GAP;
  const width = options.width ?? 800;

  const wrapper = document.createElement("div");
  const scroller = document.createElement("div");
  scroller.className = "milkdown";
  const proseMirror = document.createElement("div");
  proseMirror.className = "ProseMirror";

  const offsets: number[] = [];
  let y = 0;
  const headings: HTMLElement[] = options.headings.map((spec) => {
    const el: HTMLElement = document.createElement(`h${spec.level}`);
    el.textContent = spec.text;
    proseMirror.appendChild(el);
    offsets.push(y);
    y += spec.height + gap + spec.bodyHeight;
    return el;
  });
  const scrollHeight = y;
  const maxScrollTop = () => Math.max(0, scrollHeight - viewHeight);
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
  Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: () => scrollHeight });
  scroller.scrollTo = ((arg?: ScrollToOptions | number, y2?: number) => {
    if (typeof arg === "number") scrollToTarget(y2 ?? scrollTop, undefined);
    else scrollToTarget(arg?.top ?? scrollTop, arg?.behavior);
  }) as HTMLElement["scrollTo"];

  const scrollerRect = () => rect(rootTop, viewHeight, width);
  const headingRect = (i: number) =>
    rect(rootTop + offsets[i] - scrollTop, options.headings[i].height, width);

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
      scrollToTarget(offsets[i], behavior);
    }) as HTMLElement["scrollIntoView"];
  });

  scroller.appendChild(proseMirror);
  wrapper.appendChild(scroller);
  container.appendChild(wrapper);

  return {
    wrapper,
    scroller,
    proseMirror,
    headings,
    rootTop,
    viewHeight,
    scrollHeight,
    contentOffset: (i) => offsets[i],
    maxScrollTop,
    relTop: (i) => offsets[i] - scrollTop,
    scrollTopForHeadingAt: (i, rel) => offsets[i] - rel,
    setScrollTopSilently: (v) => {
      scrollTop = clamp(v);
    },
    peekRect: (el) => {
      if (el === scroller || el === container) return scrollerRect();
      const i = headings.indexOf(el as HTMLElement);
      return i < 0 ? null : headingRect(i);
    },
    rectReads,
    resetRectReads: () => {
      rectReads.scroller = 0;
      rectReads.headings.fill(0);
    },
  };
}
