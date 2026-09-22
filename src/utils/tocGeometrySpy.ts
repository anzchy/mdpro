/**
 * Purpose: the **pixel-space** active-heading selection for the WYSIWYG
 * (Milkdown) surface — the geometric twin of `tocLineSpy.ts`, applying the same
 * rule Source applies: "the heading the reader is under is the last one whose
 * top has reached `SPY_ANCHOR_OFFSET_PX` below the scroller's top edge".
 *
 * Three exports, pure by construction and by requirement: no DOM, no React, no
 * store, no globals, **no logging** (called once per animation frame).
 *
 *   1. `pickActiveHeadingIndex(count, topAt, anchorPx)` — last index `i` with
 *      `topAt(i) <= anchorPx`, else `null`. Binary search (upper bound), so it
 *      takes an **accessor** rather than an array: the caller reads O(log n) live
 *      rects per frame instead of n.
 *   2. `retainAtScrollLimit(...)` — `retainVisibleActiveKey`'s five checks, in
 *      the same order, in pixels: keep the already-active heading only when the
 *      scroller is at its limit and that heading's scroller-relative top lies in
 *      the **closed** interval `[anchorPx, clientHeight]`.
 *   3. `selectActiveHeading(sample, currentIndex)` — the composition, with
 *      `SPY_ANCHOR_OFFSET_PX` and `isAtScrollLimit` imported (never restated).
 *
 * Why its own module: `tocElementResolution.ts` works on DOM elements and
 * `tocLineSpy.ts` on line numbers; a pixel coordinate is a third space and
 * mixing them in one file is how a caller passes one where another was meant.
 *
 * ---------------------------------------------------------------------------
 * Coordinates
 * ---------------------------------------------------------------------------
 * Every top is **scroller-relative** (`rect.top − scrollerRect.top`), never a
 * viewport coordinate. `currentIndex`/`picked` index the same resolved list
 * that `topAt` reads.
 *
 * ---------------------------------------------------------------------------
 * Precondition, and what happens outside it
 * ---------------------------------------------------------------------------
 * Tops are expected **non-decreasing** in index order (document order). On such
 * input the result equals a linear scan with last-wins, so ties at the anchor
 * go to the **last** tied index, matching `pickActiveKeyByLine`. The picker is
 * nonetheless **total** and **sound**: it never throws, and any non-null index
 * `i` it returns satisfies `0 <= i < count` and `topAt(i) <= anchorPx` (it only
 * ever returns an index whose probe passed). On decreasing input (e.g. a
 * `display:none` heading with a zero rect) it returns *some* sound index, not
 * necessarily the last one that qualifies.
 *
 * Degenerate input — there is no normalisation; every row falls out of `<=`:
 *
 *   | Input                          | Result                                  |
 *   |--------------------------------|-----------------------------------------|
 *   | `count` 0 (or negative)        | `null`, and `topAt` is never called     |
 *   | `anchorPx` `NaN`               | `null` — every `<=` against NaN fails   |
 *   | `anchorPx` `−Infinity`         | `null`                                  |
 *   | `anchorPx` `+Infinity`         | `count − 1` (finite tops)               |
 *   | a `NaN` top                    | that probe fails `<=`, i.e. it is       |
 *   |                                | treated as lying below the anchor line: |
 *   |                                | `[0, NaN, 20]` @ 100 → `0`              |
 *   | every top `NaN`                | `null`                                  |
 *
 * Cost: at most `⌈log2(count + 1)⌉ <= ⌈log2 count⌉ + 1` calls to `topAt`.
 *
 * ---------------------------------------------------------------------------
 * `retainAtScrollLimit` — the guard table (same order as `tocLineSpy.ts`)
 * ---------------------------------------------------------------------------
 *   | # | Condition                            | Answer   |
 *   |---|--------------------------------------|----------|
 *   | 1 | `picked === current`                 | `picked` |
 *   | 2 | `current === null`                   | `picked` |
 *   | 3 | `!atScrollLimit` (directional freeze)| `picked` |
 *   | 4 | `currentTop` unresolvable (null,     | `picked` |
 *   |   | undefined, NaN, ±Infinity)           |          |
 *   | 5 | `currentTop ∈ [anchorPx, clientHeight]` | `current`, else `picked` |
 *
 * Laws (pinned by tests): idempotence, non-invention (result ∈ {picked,
 * current, null}; null only when picked is null), and projection
 * (`atScrollLimit === false ⇒ picked`). Like Source, it does **not** select the
 * final heading on reaching the bottom (ADR-0017 asymmetry).
 *
 * ---------------------------------------------------------------------------
 * `selectActiveHeading` — `null` means "keep what is shown"
 * ---------------------------------------------------------------------------
 * Bad geometry — `clientHeight <= 0`, or a non-finite `scrollTop` /
 * `clientHeight` — returns `null` without reading any heading. A `null` pick
 * (anchor above the first heading) also returns `null`. The retain-on-null step
 * is the caller's, exactly as in Source. `currentTop` is read only when it can
 * change the answer (at the limit, `current` non-null and different from the
 * pick, and in range), so the per-frame read budget stays O(log n) + 1.
 *
 * @module src/utils/tocGeometrySpy
 * @coordinates-with src/utils/tocLineSpy.ts
 * @coordinates-with src/utils/codemirrorViewportLine.ts
 */
import { isAtScrollLimit, SPY_ANCHOR_OFFSET_PX } from "./codemirrorViewportLine";

/** One frame's geometry, as the WYSIWYG spy samples it. */
export interface GeometrySample {
  /** Number of resolved headings `topAt` can read. */
  count: number;
  /** Scroller-relative top of heading `index`, in CSS pixels. */
  topAt: (index: number) => number;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * The last index `i` in `[0, count)` with `topAt(i) <= anchorPx`, or `null`.
 * Upper-bound binary search; see the module header for the precondition, the
 * soundness guarantee on unordered input, and the degenerate-input table.
 */
export function pickActiveHeadingIndex(
  count: number,
  topAt: (index: number) => number,
  anchorPx: number,
): number | null {
  let lo = 0;
  let hi = count;
  // Invariant: every index < lo passed its probe path; the answer is lo − 1.
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (topAt(mid) <= anchorPx) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? lo - 1 : null;
}

/**
 * Keep `current` when the scroller is at its limit and `current`'s
 * scroller-relative top is inside `[anchorPx, clientHeight]`; otherwise
 * `picked`. Five checks, in `retainVisibleActiveKey`'s order — see the header.
 */
export function retainAtScrollLimit(
  picked: number | null,
  current: number | null,
  currentTop: number | null | undefined,
  clientHeight: number,
  anchorPx: number,
  atScrollLimit: boolean,
): number | null {
  if (picked === current) return picked;
  if (current === null) return picked;
  if (!atScrollLimit) return picked;
  if (typeof currentTop !== "number" || !Number.isFinite(currentTop)) return picked;
  return currentTop >= anchorPx && currentTop <= clientHeight ? current : picked;
}

/**
 * The index to highlight for this frame, or `null` for "keep what is shown"
 * (bad geometry, or the anchor above the first heading).
 */
export function selectActiveHeading(
  sample: GeometrySample,
  currentIndex: number | null,
): number | null {
  const { count, topAt, scrollTop, scrollHeight, clientHeight } = sample;
  if (!Number.isFinite(scrollTop) || !Number.isFinite(clientHeight) || clientHeight <= 0) {
    return null;
  }
  const picked = pickActiveHeadingIndex(count, topAt, SPY_ANCHOR_OFFSET_PX);
  const atLimit = isAtScrollLimit(scrollTop, scrollHeight, clientHeight);
  const needsTop =
    atLimit &&
    currentIndex !== null &&
    currentIndex !== picked &&
    Number.isInteger(currentIndex) &&
    currentIndex >= 0 &&
    currentIndex < count;
  const currentTop = needsTop ? topAt(currentIndex) : undefined;
  return retainAtScrollLimit(
    picked,
    currentIndex,
    currentTop,
    clientHeight,
    SPY_ANCHOR_OFFSET_PX,
    atLimit,
  );
}
