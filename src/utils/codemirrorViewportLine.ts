/**
 * Purpose: **the single geometry seam** between the source (CodeMirror) surface and the
 * outline's scroll spy. `readSpyLineRange` converts pixels into 1-based line numbers and
 * one decision-ready boolean (`atScrollLimit`); everything downstream
 * (`pickActiveKeyByLine`, `retainVisibleActiveKey`, the hook) is pure line arithmetic and
 * is testable without a layout engine.
 *
 * `@module src/utils/codemirrorViewportLine`
 * `@coordinates-with` `src/utils/tocLineSpy.ts` (the consumer of the line range),
 * `src/hooks/useTOC.ts` (imports `SPY_ANCHOR_OFFSET_PX` for the navigate path).
 *
 * ---------------------------------------------------------------------------
 * (b) This is the sole geometry seam, and that is a rule, not an observation
 * ---------------------------------------------------------------------------
 * No other module in `src/` may call `posAtCoords`, `coordsAtPos`, `lineBlockAtHeight`,
 * `elementAtHeight`, `documentTop`, `documentPadding` or `viewportLineBlocks` on behalf
 * of the spy. Every pixel the spy depends on enters here and leaves as an integer. A
 * second seam would be a second thing that cannot be tested in jsdom, and the two would
 * drift apart in exactly the way a reader has no way to notice.
 *
 * ---------------------------------------------------------------------------
 * (a) Why the anchor is 40px below the scroller top, and not the top itself
 * ---------------------------------------------------------------------------
 * Both surfaces use this same anchor. Since D17 WI-4 (ADR-0026) the WYSIWYG spy is
 * geometric — the last heading whose scroller-relative top is at or above
 * `SPY_ANCHOR_OFFSET_PX` (`tocGeometrySpy.ts`) — so the IntersectionObserver-era
 * `-66%` hysteresis band, and the "parity bound" that kept the anchor inside it, are gone.
 *
 * The **load-bearing** reason for the specific value 40 is `yMargin` agreement. Clicking
 * an outline entry in source mode dispatches
 * `EditorView.scrollIntoView(pos, { y: "start", yMargin: SPY_ANCHOR_OFFSET_PX })`; that
 * scroll fires the spy's own listener; the re-sample must land on the heading the user
 * just clicked. Any anchor ≠ that `yMargin` snaps the highlight away from the clicked
 * entry. This is why `useTOC.ts` **imports** the constant instead of repeating `40`.
 *
 * **One bound genuinely constrains the value, and it is not testable in jsdom** — which
 * is exactly why it is recorded here instead of in a case:
 *
 *   - **Degenerate-path bound.** The anchor must stay below the pane height. Above it,
 *     the short-scroller path below goes permanently live and the spy returns `null`
 *     forever on small windows.
 *
 * **The *value* of `SPY_ANCHOR_OFFSET_PX` is pinned by no test case.** V-8b pins only
 * that the adapter and the navigate path **agree** — it passes with the constant set to
 * 137. V-8 pins the same agreement at the real value. No case asserts `40`. The bound
 * above and `yMargin` agreement are therefore the only things constraining it; change it
 * with them in hand, not by reading the suite.
 *
 * ---------------------------------------------------------------------------
 * (a2) `atScrollLimit`, and the conjunct a later reader will want to delete
 * ---------------------------------------------------------------------------
 * The spy's tail clamp — `retainVisibleActiveKey` keeping a clicked heading highlighted
 * — must engage only when the scroller has actually reached the bottom. Applying it on
 * every sample froze the highlight for a whole screenful on every upward scroll. So this
 * seam answers the physical question from the **same scroller it already holds**:
 *
 *   `atScrollLimit = clientHeight > 0 && scrollTop >= (scrollHeight - clientHeight) - TOL`
 *
 * That predicate lives in exactly one place, the exported **`isAtScrollLimit`** below,
 * which `readSpyLineRange` calls and which any other spy surface must call rather than
 * restate (a second copy would drift, and the conjunct below is what drifts first).
 *
 * **`bottomLine === doc.lines` was considered and rejected**, and the rejection carries a
 * standing failure condition that outlives any plan document. Line wrapping is a live user
 * preference (`wordWrapCompartment` in `dynamicExtensions.ts`, re-applied on every editor
 * create). When the final logical line is a long wrapped paragraph it occupies many screen
 * rows, so the bottom probe resolves to the last *logical* line while hundreds of pixels of
 * scrolling remain. That predicate tests **membership in the last logical line**, not
 * **arrival at the scroll limit**, and the freeze survives wherever the final line wraps.
 *
 * **`clientHeight > 0` is NOT redundant with the subtraction. Do not delete it.** An
 * unlaid-out scroller reports `0 / 0 / 0`, so the naive subtraction makes the maximum
 * scroll offset `0` and `scrollTop >= 0` reads as *at the limit* — which re-enables
 * retention permanently, on the shape that `scrollDOM` has for the frame after **every**
 * mode toggle and **every** remount, and reproduces the exact freeze this code exists to
 * fix while every case stays green for the wrong reason. A laid-out *short* document also
 * has a maximum of `0` and there retention must stay **ON**, or clicking any heading in a
 * non-scrollable document snaps the highlight back to the anchor. `clientHeight` is the
 * only thing separating the two. Failing **false** on untrustworthy geometry is the safe
 * direction: it disables retention and lets the picker win, which degrades to "the
 * highlight tracks the anchor", not to "the highlight freezes".
 *
 * ---------------------------------------------------------------------------
 * (c) Three coordinate spaces, and why `posAtCoords`
 * ---------------------------------------------------------------------------
 *   1. **Screen space** — `getBoundingClientRect()`, and what `posAtCoords` takes.
 *   2. **Document space** — origin at the top of the first line, padding excluded. This
 *      is what `lineBlockAtHeight(height)` / `elementAtHeight(height)` take.
 *   3. **Scroller space** — `scrollDOM.scrollTop`.
 *
 * Bridging 1 → 2 costs `y_document = y_screen - view.documentTop`. `posAtCoords` already
 * works in screen space, which is precisely what `getBoundingClientRect()` hands us, so
 * it needs no bridge and cannot get the bridge wrong. `typewriterModePlugin.ts:16-25`
 * assigns `block.top` straight to `scrollTop` and thereby assumes space 2 equals space 3
 * — true only while `documentPadding.top` is 0. **Do not copy that pattern here.**
 *
 * `blockAtHeight` and `visualLineAtHeight` are **pre-6.0 names that do not exist** in
 * `@codemirror/view` 6.39.11; calling either is a compile error and a runtime
 * `TypeError`. The imprecise overload `posAtCoords(coords, false)` returns a `number` and
 * **never `null`**, which is the other half of why it is the right call: the precise
 * overload can answer `null`, and every caller would then need a second degenerate path.
 *
 * ---------------------------------------------------------------------------
 * Degenerate geometry answers `null`. There is exactly one rule.
 * ---------------------------------------------------------------------------
 * `if (topLine > bottomLine) return null` — and a zero-height scroller, a detached
 * scroller, a scroller shorter than the anchor offset, and a genuinely inverted probe
 * pair on a healthy scroller all land on it.
 *
 * **Do not `Math.max` an inverted pair back into agreement.** A zero-height or detached
 * `scrollDOM` is the shape of *every* mode toggle and *every* remount for the frame
 * before layout: the top probe asks for `y = 40`, below the content, where the imprecise
 * overload returns the last position; the bottom probe asks for `y = -1`, above it, where
 * it returns 0. Clamping resolves that to `{doc.lines, doc.lines}`, `pickActiveKeyByLine`
 * then selects the **last** heading, and the outline visibly jumps to the bottom of the
 * document. `null` instead degrades to "retain the current highlight", which the design
 * already handles everywhere else. Same cost, opposite blast radius.
 *
 * ---------------------------------------------------------------------------
 * (d) Integration obligation — DISCHARGED 2026-09-20 by manual QA, and how
 * ---------------------------------------------------------------------------
 * This module reads **two** kinds of browser geometry, so the obligation is larger than
 * a line-arithmetic module's would be. Its real laws are both unverifiable here:
 *
 *   1. the line it returns is **the line the reader sees at the anchor** — from
 *      `getBoundingClientRect()` and `posAtCoords`;
 *   2. `atScrollLimit` is `true` **exactly when the scroller really is at its limit** —
 *      from `scrollDOM.scrollTop`, `scrollDOM.scrollHeight` and `scrollDOM.clientHeight`.
 *
 * jsdom implements no layout: a real `EditorView` reports every height as 0, has no
 * `getClientRects`, and answers `0` for `scrollHeight` / `clientHeight` on every element.
 * The unit cases therefore drive a hand-built `EditorView`-shaped double whose metrics are
 * installed with `Object.defineProperty`, and can only pin the arithmetic, the clamp, the
 * inversion rule and the tolerance predicate. Nothing here reaches macOS rubber-band
 * overscroll, fractional device pixels, or a wrapped final paragraph.
 *
 * **This repo has no integration or e2e lane**, so a green suite here is not evidence
 * that the anchor points where a reader is looking, nor that the browser agrees about
 * the scroll limit. Both were therefore established empirically, against a release
 * bundle driven on a real desktop (plan WI-6, checks QA-A…QA-F; procedure in
 * `.claude/skills/gui-acceptance/SKILL.md`). **Both laws held.** The measurements, kept
 * here because they are the only record of what real WKWebView geometry did:
 *
 *   - **Law 1 — symmetry.** Instrumenting `sample()` with a throttled log over a
 *     111-line fixture produced identical `topLine` for identical `scrollTop` in both
 *     directions (`scrollTop` 320 → line 15 and 640 → line 28, on the down-leg and again
 *     on the up-leg). The pre-fix build froze at the same offsets. Nothing rounds
 *     differently going up.
 *   - **Law 2 — the limit.** `atScrollLimit` was `true` only at `scrollTop === 2019 ===
 *     scrollHeight - clientHeight`, and `false` one wheel-tick off (`scrollTop` 1899).
 *   - **The `clientHeight > 0` conjunct above, which is the part a reader will want to
 *     delete, is the one this pass exists to justify.** A short 14-line document reported
 *     `scrollTop 0 / scrollHeight 732 / clientHeight 732`, i.e. `maxScroll === 0` — the
 *     *same* maximum an unlaid-out `0/0/0` scroller reports. It correctly answered
 *     `true`, retention stayed on, and a clicked heading held through a scroll attempt.
 *     Delete the conjunct and the unlaid-out frame answers `true` as well.
 *
 * Still **not** reached by any of this: macOS rubber-band overscroll, fractional device
 * pixels, and a wrapped final paragraph — the case that killed the rejected
 * `bottomLine === doc.lines` predicate in §(a2) is argued, not measured.
 *
 * Pure apart from reading the view: no React, no store access, no DOM writes, no
 * logging (this runs once per animation frame during a scroll; per-call logging would
 * write thousands of lines).
 */
import type { EditorView } from "@codemirror/view";

/**
 * Distance in CSS pixels below the scroller's top edge at which the spy samples "which
 * heading is the reader under". **Shared, never copied** — `useTOC.ts` passes this same
 * value as `scrollIntoView`'s `yMargin` so a click and the scroll sample it triggers
 * agree by construction. See the header for the two bounds on this value and for the
 * fact that no test case pins it.
 */
export const SPY_ANCHOR_OFFSET_PX = 40;

/**
 * Slack in CSS pixels when deciding whether the scroller has reached its scroll limit.
 * One pixel, to absorb the fractional `scrollTop` / `scrollHeight` a fractional-device-
 * pixel or zoomed layout produces.
 *
 * **Unlike {@link SPY_ANCHOR_OFFSET_PX}, this value IS pinned by cases** (V-19's boundary
 * table asserts each row against this constant). The two are not alike and must not be
 * confused: the anchor offset has a cross-module agreement obligation with `useTOC.ts`'s
 * `yMargin` and no case fixes its value, whereas this constant has no such partner and
 * its size *is* the behavioural boundary. Changing it changes V-19 with it.
 *
 * It is still a judgment call with no automated evidence behind it: if a Retina or
 * fractionally-zoomed layout leaves more than one pixel of residual scroll at the bottom,
 * the tail clamp silently fails to engage. WI-6 QA-B / QA-C are the only detectors.
 */
export const SPY_SCROLL_LIMIT_TOLERANCE_PX = 1;

/**
 * Has a scroller reached (or overshot) its scroll limit, within
 * `SPY_SCROLL_LIMIT_TOLERANCE_PX`? The **one** copy of this check in `src/` — every spy
 * surface calls it rather than restating it, so the two cannot drift apart.
 *
 * `clientHeight > 0` is a **separate conjunct and is not redundant** with the subtraction
 * (ADR-0017, header §(a2)): an unlaid-out scroller reports `0/0/0`, whose maximum scroll
 * offset is also 0, and a laid-out short document has the same zero maximum but must
 * answer `true`. `clientHeight` is the only thing that tells the two apart. NaN input
 * answers `false`, the safe direction.
 */
export function isAtScrollLimit(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): boolean {
  return (
    clientHeight > 0 && scrollTop >= scrollHeight - clientHeight - SPY_SCROLL_LIMIT_TOLERANCE_PX
  );
}

/** 1-based, inclusive on both ends, and always `topLine <= bottomLine`. */
export interface SpyLineRange {
  /** Line at the anchor, i.e. `SPY_ANCHOR_OFFSET_PX` below the scroller's top edge. */
  topLine: number;
  /** Line at the scroller's bottom edge. */
  bottomLine: number;
  /**
   * The scroller has reached (or overshot) its scroll limit, within
   * `SPY_SCROLL_LIMIT_TOLERANCE_PX`; `false` whenever the geometry is untrustworthy. See
   * header section (a2) — the `clientHeight > 0` conjunct is load-bearing.
   */
  atScrollLimit: boolean;
}

/** `Line.number` is 1-based, so the floor is 1 and never 0. */
function clampLine(line: number, lineCount: number): number {
  return Math.min(Math.max(line, 1), lineCount);
}

/**
 * Read the range of document lines currently spanned by the source editor's viewport,
 * from the anchor down to the bottom edge.
 *
 * Returns `null` — never throws — for an absent view, a destroyed view whose geometry
 * calls throw, and every degenerate scroller shape. `null` means "no usable sample";
 * the caller's contract is to retain whatever it is already showing.
 */
export function readSpyLineRange(view: EditorView | null): SpyLineRange | null {
  if (!view) return null;

  try {
    const scroller = view.scrollDOM;
    if (!scroller) return null;

    const rect = scroller.getBoundingClientRect();
    // `rect.left + 1` and not `rect.left`: the scroller's left edge lands in the gutter
    // in a real browser, and the gutter resolves to the wrong line.
    const x = rect.left + 1;
    const doc = view.state.doc;
    const lineCount = doc.lines;

    // The imprecise overload is total — `number`, never `null`. See the header.
    const topPos = view.posAtCoords({ x, y: rect.top + SPY_ANCHOR_OFFSET_PX }, false);
    // `rect.bottom - 1` and not `rect.bottom`: the bottom edge itself is off the element
    // and resolves past EOF.
    const bottomPos = view.posAtCoords({ x, y: rect.bottom - 1 }, false);

    const topLine = clampLine(doc.lineAt(topPos).number, lineCount);
    const bottomLine = clampLine(doc.lineAt(bottomPos).number, lineCount);

    // The one degenerate rule. Both probes are always dispatched first, so a pair that
    // inverts on a *healthy* scroller is caught too, not just a degenerate rect.
    if (topLine > bottomLine) return null;

    // Same scroller, no second `getBoundingClientRect`, no extra layout read. The
    // predicate — and its load-bearing `clientHeight > 0` conjunct — lives in
    // `isAtScrollLimit`; see header (a2).
    const { scrollTop, scrollHeight, clientHeight } = scroller;
    const atScrollLimit = isAtScrollLimit(scrollTop, scrollHeight, clientHeight);

    return { topLine, bottomLine, atScrollLimit };
  } catch {
    // A destroyed view throws from its geometry calls. A scroll handler that propagates
    // that kills the listener; returning `null` degrades to "retain".
    return null;
  }
}
