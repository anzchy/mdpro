/**
 * Purpose: the WYSIWYG (Milkdown / ProseMirror) adapter of the WI-8 scroll
 * anchor — read the anchor from, and apply it to, the element that scrolls.
 * Thin: all mapping arithmetic is in `anchor.ts`.
 *
 * Key decisions:
 *   - **The scroller is `div.milkdown`**, the container Milkdown's core wraps
 *     around `view.dom` (`@milkdown/core` `createViewContainer`). It is the only
 *     element in the chain with `overflow-y: auto` and a bounded height
 *     (MilkdownEditor.css `.milkdown-editor .milkdown`); the two
 *     `overflow: hidden` rules above it only clip. Resolved by
 *     `resolveMilkdownScroller` (from a view) or `findMilkdownScrollerIn`
 *     (from the container, same rule), never hard-coded at call sites.
 *   - **Probe = scroller top + `SPY_ANCHOR_OFFSET_PX`**, the same 40px the
 *     Source spy samples, so both sides anchor the same visual line.
 *   - **Block lookup is geometric** (binary search over top-level child rects)
 *     rather than `posAtCoords`: deterministic in inter-block margins (a probe
 *     in a margin resolves to the NEXT block at fraction 0, mirroring the source
 *     side's blank-line rule).
 *   - **Never throws.** Every entry point catches and returns null / false.
 *   - Outline navigation (`scrollHeadingToAnchor`) lands a heading on the same
 *     probe line, instantly, rounding the target up so sub-pixel `scrollTop` snapping
 *     cannot leave it below the line; it reports success as a boolean so the TOC
 *     only highlights an entry it actually scrolled to.
 *   - **Outline navigation stays pinned while layout settles (D22).** After its write on
 *     the scroller path, `scrollHeadingToAnchor` arms `pinDuringLayoutSettle` (source
 *     `"toc"`, observing `.ProseMirror`), whose `reapply` re-runs the same landing
 *     arithmetic (`headingLandingTop`, shared, never duplicated) against the current
 *     layout. No `loadFilter`: every image `load` re-pins, since the re-pin is
 *     idempotent and growth below a limited heading still raises the limit. `reapply`
 *     checks `heading.isConnected` before reading any rect and returns false for a
 *     replaced heading, which ends the pin. The `scrollIntoView` fallback arms nothing.
 *     The pin is armed without a local try/catch: `pinDuringLayoutSettle` never throws
 *     (settle-pin P-15/P-17), so a pin failure never changes the boolean.
 *
 * @module src/utils/scrollAnchor/milkdown
 * @coordinates-with src/utils/scrollAnchor/anchor.ts
 * @coordinates-with src/utils/scrollAnchor/settlePin.ts (`pinDuringLayoutSettle`)
 * @coordinates-with src/hooks/useMilkdownScrollRestore.ts
 * @coordinates-with src/hooks/useTOC.ts (`scrollHeadingToAnchor`)
 * @coordinates-with src/hooks/useWysiwygScrollSpy.ts (`findMilkdownScrollerIn`)
 * @coordinates-with src/components/Editor/MilkdownEditor.css
 */
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import type { EditorView } from "@milkdown/kit/prose/view";
import { SPY_ANCHOR_OFFSET_PX } from "../codemirrorViewportLine";
import {
  anchorFromBlockGeometry,
  headingAnchorFromGeometry,
  pixelOffsetFromAnchor,
  pixelOffsetFromHeadingAnchor,
  type ScrollAnchor,
  type VerticalSpan,
} from "./anchor";
import { pinDuringLayoutSettle } from "./settlePin";

const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";
const SCROLLER_CLASS = "milkdown";
const VIEW_DOM_SELECTOR = ".ProseMirror";

/** The element that scrolls in WYSIWYG mode, or null before mount. */
export function resolveMilkdownScroller(view: EditorView): HTMLElement | null {
  const parent = view.dom.parentElement;
  return parent && parent.classList.contains(SCROLLER_CLASS) ? parent : null;
}

/**
 * The WYSIWYG scroller found from the editor's container alone, for callers that
 * hold no `EditorView` (the TOC scroll spy). Same rule as
 * `resolveMilkdownScroller`: the parent of the first `.ProseMirror` inside
 * `container`, and only if that parent carries `.milkdown`. Never falls back to
 * the container itself or to a stray `.milkdown` elsewhere; null before mount,
 * after destroy, or on any other shape. Works on a detached container.
 */
export function findMilkdownScrollerIn(container: HTMLElement): HTMLElement | null {
  const viewDom = container.querySelector(VIEW_DOM_SELECTOR);
  const parent = viewDom?.parentElement ?? null;
  if (!parent || parent === container) return null;
  return parent.classList.contains(SCROLLER_CLASS) ? parent : null;
}

/**
 * Outline click-to-navigate (D17 WI-5): scroll `container`'s WYSIWYG scroller so
 * `heading`'s top sits `SPY_ANCHOR_OFFSET_PX` below the scroller top — the line the
 * geometric spy samples, so the spy's next frame agrees with the click. The offset comes
 * from the heading and scroller rects (scroller-relative, never viewport-relative), is
 * **rounded up** (`Math.ceil`) and only then clamped to `[0, scrollHeight − clientHeight]`:
 * WebKit floors a fractional `scrollTop`, which would leave a heading at a sub-pixel
 * offset 40.x px down — past the spy's `top <= 40` line, so it would pick the previous
 * heading. Rounding up lands it at or above the anchor instead. **Instant**
 * (`behavior: "auto"`, and no CSS `scroll-behavior` is set on `.milkdown`): a smooth
 * scroll hands the spy one intermediate position per frame, and at the tail the
 * scroll-limit retention then keeps the heading passed on the way, not the one clicked.
 * With no scroller (unexpected shape), falls back to `scrollIntoView` at the heading top.
 *
 * **Settle pin (D22).** After the scroller write, arms `pinDuringLayoutSettle` so images
 * decoding above (or below) the heading during the settle window cannot carry it off the
 * line: every layout trigger re-lands it with the same arithmetic against the current
 * layout, until the window ends, the user scrolls, a later click re-arms, or the heading
 * is replaced (then it stops rather than chase a detached node). The fallback path arms
 * nothing.
 *
 * Returns true when the scroll was issued (the fallback included), false when it threw —
 * the caller must then not claim the heading is shown. A pin failure does not change the
 * result. Never throws.
 */
export function scrollHeadingToAnchor(container: HTMLElement, heading: Element): boolean {
  let scroller: HTMLElement | null;
  try {
    scroller = findMilkdownScrollerIn(container);
    if (!scroller) {
      heading.scrollIntoView({ behavior: "auto", block: "start" });
      return true;
    }
    scroller.scrollTo({ top: headingLandingTop(scroller, heading), behavior: "auto" });
  } catch {
    // Navigation is best-effort; a failed scroll must not break the outline.
    return false;
  }
  pinHeadingDuringSettle(container, scroller, heading);
  return true;
}

/** `ceil(scrollTop + rel − 40)`, clamped to `[0, scrollHeight − clientHeight]`, from live rects. */
function headingLandingTop(scroller: HTMLElement, heading: Element): number {
  const rel = heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const exact = scroller.scrollTop + rel - SPY_ANCHOR_OFFSET_PX;
  return Math.min(Math.max(Math.ceil(exact), 0), max);
}

/**
 * Arm the settle pin AFTER the first write (it reads `scrollTop` at arm). Never throws:
 * `pinDuringLayoutSettle` catches every failure itself (its never-throw contract, pinned
 * by settle-pin P-15/P-17), so no try/catch is needed here. `.ProseMirror` always exists:
 * `findMilkdownScrollerIn` only returns a scroller that is its parent (`?? scroller` only
 * satisfies the type).
 */
function pinHeadingDuringSettle(container: HTMLElement, scroller: HTMLElement, heading: Element): void {
  pinDuringLayoutSettle({
    scroller,
    observed: container.querySelector(VIEW_DOM_SELECTOR) ?? scroller,
    source: "toc",
    reapply: () => {
      if (!heading.isConnected) return false; // replaced: stop, never measure it
      scroller.scrollTo({ top: headingLandingTop(scroller, heading), behavior: "auto" });
      return true;
    },
  });
}

function childRects(view: EditorView): Array<() => VerticalSpan | null> {
  const readers: Array<() => VerticalSpan | null> = [];
  view.state.doc.forEach((_node, offset) => {
    readers.push(() => {
      const dom = view.nodeDOM(offset);
      if (!(dom instanceof HTMLElement)) return null;
      const rect = dom.getBoundingClientRect();
      return { top: rect.top, height: rect.height };
    });
  });
  return readers;
}

/** Index of the first top-level block whose bottom is below `probeY`. */
function blockAtProbe(readers: Array<() => VerticalSpan | null>, probeY: number): number {
  let lo = 0;
  let hi = readers.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const span = readers[mid]();
    if (span && span.top + span.height <= probeY) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function headingTops(view: EditorView): number[] {
  return Array.from(view.dom.querySelectorAll(HEADING_SELECTOR), (el) => el.getBoundingClientRect().top);
}

/** Capture the anchor at the probe line. Null for an unlaid-out scroller or any failure. */
export function captureMilkdownScrollAnchor(
  view: EditorView,
  scroller: HTMLElement,
  documentId: string,
): ScrollAnchor | null {
  try {
    if (scroller.clientHeight <= 0) return null;
    const probeY = scroller.getBoundingClientRect().top + SPY_ANCHOR_OFFSET_PX;
    const readers = childRects(view);
    let block = null;
    if (readers.length > 0) {
      const index = blockAtProbe(readers, probeY);
      const span = readers[index]();
      if (span) block = anchorFromBlockGeometry(index, readers.length, span, probeY);
    }
    const docRect = view.dom.getBoundingClientRect();
    const heading = headingAnchorFromGeometry(headingTops(view), docRect.top, docRect.bottom, probeY);
    if (!block && !heading) return null;
    return { documentId, block, heading };
  } catch {
    return null;
  }
}

function targetY(view: EditorView, anchor: ScrollAnchor): number | null {
  const block = anchor.block;
  if (block && block.blockCount === view.state.doc.childCount) {
    const span = childRects(view)[block.blockIndex]?.();
    if (span) return pixelOffsetFromAnchor(block.fraction, span);
  }
  if (!anchor.heading) return null;
  const docRect = view.dom.getBoundingClientRect();
  return pixelOffsetFromHeadingAnchor(anchor.heading, headingTops(view), docRect.top, docRect.bottom);
}

/**
 * Scroll so the anchored position sits at the probe line. Returns false —
 * leaving the scroller untouched — when neither tier's counts agree.
 */
export function restoreMilkdownScrollAnchor(
  view: EditorView,
  scroller: HTMLElement,
  anchor: ScrollAnchor,
): boolean {
  try {
    const y = targetY(view, anchor);
    if (y === null) return false;
    const probeY = scroller.getBoundingClientRect().top + SPY_ANCHOR_OFFSET_PX;
    scroller.scrollTop += y - probeY;
    return true;
  } catch {
    return false;
  }
}

/** Entry point for `capture.ts`: capture from a live Milkdown editor instance. */
export function captureMilkdownScrollAnchorFromEditor(
  editor: Editor,
  documentId: string,
): ScrollAnchor | null {
  try {
    const view = editor.action((ctx) => ctx.get(editorViewCtx));
    const scroller = resolveMilkdownScroller(view);
    return scroller ? captureMilkdownScrollAnchor(view, scroller, documentId) : null;
  } catch {
    return null;
  }
}
