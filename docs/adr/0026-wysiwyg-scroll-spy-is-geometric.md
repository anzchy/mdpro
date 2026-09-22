# 0026. WYSIWYG scroll spy is geometric, anchored at the same 40 px as Source

## Status

**Proposed** (2026-09-22). Closes **D17** on
`docs/plans/20260912-frontend-backend-sequencing-order.md`; WI-7 real-device
acceptance passed 2026-09-23 (`docs/test/20260922-d17-gui-acceptance.md`). Supersedes the inline **DECISION A** for the WYSIWYG surface
(formerly in the `src/hooks/useWysiwygScrollSpy.ts` header). Builds on
[ADR-0014](./0014-toc-addresses-headings-by-document-order.md) (entries are
addressed by document order), [ADR-0017](./0017-source-scroll-spy-bottom-of-document-asymmetry.md)
and [ADR-0018](./0018-bottom-of-document-stranded-heading-count.md) (retention
only at the scroll limit).

## Context

DECISION A made the WYSIWYG outline highlight follow an `IntersectionObserver`.
It watched each heading through a band covering the top third of the scroller
(`rootMargin: 0px 0px -66% 0px`). It kept the last key whenever no heading was
inside the band. The D17 reproduction (`docs/test/20260922-d15-d17-repro-guide.md`)
showed two consequences:

- **The restored position is ignored after a mode switch.** The scroll restore
  lands in the middle of a long section, where no heading is inside the band. The
  observer's first records say nothing about which heading is above the viewport.
  The highlight stays on the document title.
- **Scrolling up inside a long section leaves the next heading lit.** It also
  stays lit for as long as the band is empty, because the kept key is only
  replaced when a heading enters the band.

The observer reports *changes in intersection*, not *position*, so neither case
can be fixed by tuning the margin. Source mode already answers the same question
geometrically: the last heading at or above the line 40 px below the scroller
top (`SPY_ANCHOR_OFFSET_PX`). It keeps the active heading only at the scroll
limit (ADR-0017/0018). The two modes also changed the highlight at different
lines (33 % vs 40 px), which the ledger recorded as a limitation.

## Decision

1. **Position, not intersection.** On every trigger, the WYSIWYG spy reads the
   scroller's rect and binary-searches the headings (`pickActiveHeadingIndex`,
   `src/utils/tocGeometrySpy.ts`). The active heading is the last one whose top
   is at or above scroller top + `SPY_ANCHOR_OFFSET_PX`, the same rule as
   Source. The search reads about ⌈log2 n⌉ + 2 rects per frame.
2. **Retention only at the scroll limit.** At the limit, the current heading is
   kept only when its top is in the closed interval `[anchor, clientHeight]`
   (`retainAtScrollLimit`, reusing `isAtScrollLimit` from
   `codemirrorViewportLine.ts`). This is the ADR-0017 rule, applied to the DOM.
3. **Triggers.** A capture-phase passive `scroll` listener on the container, a
   `MutationObserver` re-arm when headings are rebuilt, and a `ResizeObserver`
   where it exists. Each trigger schedules a single rAF recompute. The first pass
   on mount runs immediately. No `IntersectionObserver` is constructed, and the
   IO-only helper `pickActiveKey` is deleted.
4. **Click-to-navigate is instant and lands at the anchor.** An outline click
   scrolls, in one instant write, by the offset derived from the heading's and
   the scroller's rects (heading top − scroller top − `SPY_ANCHOR_OFFSET_PX`),
   rounded up so the heading lands at or above the anchor despite sub-pixel
   `scrollTop` snapping, then clamped to `[0, scrollHeight − clientHeight]`. It
   no longer uses smooth `scrollIntoView`, so the spy's next frame agrees with
   the click (Source parity).

## Consequences

- **Gives:**
  - The highlight follows the restored position after ⌃2/⌃4.
  - It follows scrolling in both directions inside long sections.
  - Both modes switch at the same line.
  - The decision is a pure function, `selectActiveHeading`, which is
    unit-tested, including a seeded 240-step law walk.
- **Costs:**
  - **Visible behaviour change.** The highlight now changes when a heading
    reaches 40 px from the top, not 33 % of the viewport. Users who were used to
    the earlier switch will notice.
  - **Smooth scrolling is lost** on outline clicks in WYSIWYG. A pinned
    click-target alternative would have kept the animation, but it contradicts
    ADR-0017's "retention only at the limit".
  - **Layout reads on every scroll frame.** They are bounded (about log n rects),
    but IO did them off the main thread.
  - **Bottom-of-document asymmetry now applies to WYSIWYG too.** The last few
    headings cannot reach the anchor (ADR-0018), in both modes.
  - **Sub-pixel landing risk.** A heading at a fractional offset, landed by
    an exact target that WebKit then floors, would sit at 40.x px — past the
    `top <= 40` line — and the spy would pick the previous heading. Rounding
    the target up (`Math.ceil`) mitigates it in the scripted-geometry tests, at
    the price of landing up to 1 px above the anchor. WI-7 (Retina, 100 %
    zoom) saw 12 of 12 clicks keep their own heading lit; fractional zoom was
    not tested.
  - **A click lands correctly only against settled layout.** WebKit has no CSS
    scroll anchoring, so a click made while images are still loading (right
    after ⌃4) computes its offset against zero-height images, and the content
    then grows under the fixed `scrollTop`. WI-7 reproduced it on an
    image-heavy document. The one-shot write inherits this from the earlier
    `scrollIntoView`; it is tracked as D22, not solved here.
  - **The search assumes document-order tops.** A heading that is
    `display:none`, or positioned out of flow, breaks the monotonic ordering the
    binary search relies on, and it can pick the wrong heading.
- **Forecloses:** returning to an intersection band without a new ADR. Any
  future change to the anchor must move Source and WYSIWYG together.
- **Verified by WI-7 (2026-09-23), not by jsdom:** real layout, the real Milkdown
  scroller, and the interaction with `useMilkdownScrollRestore`. jsdom has no
  layout; the tests use scripted geometry.
