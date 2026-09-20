# 0017. Source-mode scroll spy: retention is gated on the scroll limit, and the bottom of the document is asymmetric

## Status

Accepted — 2026-09-20

Superseded by [ADR-0018](./0018-bottom-of-document-stranded-heading-count.md) —
2026-09-20. The decision below stands unchanged; ADR-0018 corrects the claim that
scrolling to the bottom leaves the highlight on the *second-to-last* heading.
Manual QA measured the third-to-last, and the count is not fixed.

## Context

Source mode picks the active outline heading by line number: the last heading at
or above the line sitting `SPY_ANCHOR_OFFSET_PX` (40px) below the top of the
CodeMirror scroller. On top of that picker, `retainVisibleActiveKey`
(`src/utils/tocLineSpy.ts`) held the already-active heading whenever its line fell
inside the visible range `[topLine, bottomLine]`.

That retention rule was written for one situation: the **tail clamp**. The last
heading of a document can never be brought to the anchor, because the document
ends first. Without retention, clicking it would be undone by the very scroll the
click triggers — the highlight would snap back to whatever sits at the anchor.
Manual QA confirmed the clamp is load-bearing for both the last and the
second-to-last heading.

The defect was that the rule ran on **every** sample rather than only in the tail
situation. Scrolling down, the active heading sits above `topLine` and moves
further above, so the picker wins and tracking looks correct. Scrolling **up**,
it falls below `topLine` while still on screen, so it was retained for a whole
screenful. Measured on 2026-09-20 against a freshly built release bundle with a
111-line fixture: scrolling up to first-visible-line 30 and then 17 left the
heading at line 34 highlighted both times, where lines 22 and 8 were correct.
Waiting 2.5s did not correct it, so it was not a debounce artifact.

Two candidate predicates were considered for narrowing retention.

**Rejected: `bottomLine === doc.lines`** — "retain only when the last logical line
is visible". This was rejected as incomplete, and the reason is a standing failure
condition rather than a matter of taste. Source mode supports line wrapping via
`wordWrapCompartment` (`src/components/Editor/extensions/dynamicExtensions.ts`),
driven by a user preference and re-applied in
`src/components/common/settings/editorPrefApply.ts`. When the final logical line is
a long wrapped paragraph it occupies many screen rows, so `bottomLine` can equal
the document line count while hundreds of pixels of scrolling remain. The
predicate tests *membership in the last logical line*, not *arrival at the scroll
limit*, so the directional freeze survives anywhere the final line wraps enough.

**Accepted: measure the physical condition.** `readSpyLineRange`
(`src/utils/codemirrorViewportLine.ts`) computes, from the scroller it already
holds, whether it has reached its scroll limit, and `SpyLineRange` carries that as
a boolean. The seam owns the geometry; the hook receives a decision-ready sample
and never recomputes one.

One part of that predicate is easy to mistake for redundancy and must not be
removed. A scroller that has not been laid out reports `0/0/0`, whose maximum
scroll offset is also `0` — so the naive subtraction alone reads as "at the
limit", which would re-enable retention permanently and reproduce the freeze this
work exists to remove. But a laid-out short document that genuinely fits in the
viewport *also* has a maximum scroll offset of `0`, and there retention must stay
**on**, or clicking any heading in a non-scrollable document snaps the highlight
back to the first heading. `clientHeight` is the only thing that distinguishes the
two, hence the separate `clientHeight > 0` conjunct. Failing *false* on
untrustworthy geometry is the safe direction: it disables retention and lets the
picker win.

## Decision

Retention is gated on the scroller having physically reached its scroll limit,
within a named tolerance (`SPY_SCROLL_LIMIT_TOLERANCE_PX`, 1 CSS pixel), and is
skipped entirely otherwise.

We accept the product asymmetry this produces, and state the policy explicitly:

> **Ordinary scrolling selects the section at the anchor. A heading the user
> explicitly clicked survives at a clamped destination.**

Three requirements cannot hold simultaneously:

1. Selection depends only on viewport geometry.
2. Scrolling to the bottom always selects the final heading.
3. Clicking the second-to-last heading preserves it, when its destination is that
   same bottom-of-document position.

At the bottom of a document, (2) and (3) demand **different answers from identical
geometry**, which (1) forbids. No predicate over viewport geometry can satisfy all
three; only additional state — remembering that a selection came from a click
rather than from a scroll — could, and we are not introducing it.

We give up (2). Scrolling to the very bottom leaves the highlight on the
second-to-last heading; the final heading lights up when clicked.

## Consequences

**Costs, which are the point of recording this:**

- **Scrolling to the bottom does not highlight the final heading.** This is the
  most visible cost and it will be filed as a bug by a future QA pass, by a user,
  or by whoever next reads the outline code. It is a deliberate trade, not an
  oversight. Re-opening it means paying for (1) — the extra state above — and that
  price should be named in the ADR that supersedes this one.
- **The two modes still change highlight at different scroll positions.** WYSIWYG
  waits for a heading to descend to 33% of the viewport (`rootMargin: -66%`);
  source switches at 40px below the top. Source can therefore lead WYSIWYG by one
  heading, and switching modes mid-document visibly jumps the highlight. This fix
  makes the difference *direction-independent*; it does not remove it. The 40px
  must equal the `yMargin` used by click-to-navigate, or clicking a heading would
  be undone by its own scroll.
- **`retainVisibleActiveKey` now takes a sixth parameter and `SpyLineRange` a third
  field.** Every call site and every test double must supply the scroll metrics.
  Test doubles that omit them silently exercise the unlaid-out shape, which reads
  as "not at the limit" — so the fixture helpers install the metrics explicitly and
  a precondition helper fails the case when an override is lost.
- **The geometry is read once per animation frame during a scroll.** The predicate
  reuses the scroller already in hand and adds no second `getBoundingClientRect`
  and no extra layout read, but it does read three scroll properties per sample.

**Benefits:**

- Upward and downward scrolling are symmetric about the same anchor.
- The tail clamp survives intact for both clamped click targets.
- The wrapped-final-line case that killed the rejected predicate is handled,
  because the condition measured is physical rather than line-based.

**Standing precondition, in the ADR-0003 sense:** if line wrapping is ever removed
from source mode, the rejected `bottomLine === doc.lines` predicate becomes viable
again — but it would still be the wrong instrument, because it answers a different
question. Re-proposing it requires disproving the wrapping argument above, not
merely noting that wrapping is gone.

**Verification obligation:** this repo has no integration or e2e lane, so the
jsdom unit tests cannot prove the real CodeMirror geometry behaves as modelled.
That obligation is discharged by manual GUI acceptance (WI-6, QA-A…QA-F) against a
built bundle, not by the unit lane. `src/utils/codemirrorViewportLine.ts`'s header
records it as **UNMET** until that pass runs.
