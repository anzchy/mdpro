# 0041. WYSIWYG scroll targets are pinned for a bounded settle window, not reserved in layout

**Status**: Accepted (2026-09-27)

## Context

D22: in an image-heavy document, an outline click right after switching to
WYSIWYG lands in the wrong section, and a mode-switch round trip lands about
one image too high. The forces as understood on 2026-09-27:

- WebKit is assumed not to implement CSS scroll anchoring
  (`overflow-anchor`) — not verified on this WebKit — so content growing
  above the viewport moves the reading position.
- `useMilkdownImages` swaps image sources to `asset://` URLs after render, and
  images carry no `width` / `height`. An image is roughly zero-height until
  its bytes load, so a target computed at click time is computed against a
  short document (and a tail heading is clamped to the short scroll limit).
- The click path wrote `scrollTop` once. The restore path re-applied once, on
  the first image load above the anchor line or at 500 ms.

Two directions were available: **reserve** layout (record image dimensions so
nothing grows), or **pin** the target while layout settles.

## Decision

Pin. `src/utils/scrollAnchor/settlePin.ts#pinDuringLayoutSettle` is shared by
outline clicks (`scrollHeadingToAnchor`, `source: "toc"`) and the mode-switch
restore (`useMilkdownScrollRestore`, `source: "restore"`):

- Triggers: a `ResizeObserver` on `.ProseMirror` (primary) and capture-phase
  image `load` on the scroller (fallback).
- It re-pins only while `scrollTop` still equals the value it last wrote;
  any other value is the user's and ends the pin.
- The window is `SETTLE_PIN_WINDOW_MS` (1500 ms) measured from arm, with one
  final re-pin at the deadline. One pin per scroller; a new pin replaces the
  old.
- One `editor.scroll_anchor.settle` log per window, enums and counts only.

## Consequences

- Outline clicks and mode round trips land on target when images finish
  loading inside the window, without a new image-metadata pipeline.
- **Accepted residual defect:** an image that finishes loading **after** the
  window (a slow disk, a very large image, a document with many images) is
  not corrected; the view drifts by that image's height as before.
- **Cost:** the view can visibly settle — a frame at the wrong place, then the
  pin — where reserved dimensions would have been still from the first frame.
  ResizeObserver runs before paint, which should hide most of it; unmeasured.
- **Cost:** a user scroll during the window ends the pin for good; the pin
  never resumes. Conversely, a user scroll that returns to the pinned value
  before any `scroll` event or trigger observes it goes undetected, so the
  pin keeps acting (a false "ours").
- **Cost:** 1500 ms is a guess, shared by both paths and not yet measured on a
  device (GUI-D22-1/2 in the D22 row). It is one constant to retune, not two.
- Reserving dimensions is not foreclosed; if it lands, the pin becomes a
  no-op (nothing moves, so nothing re-pins) and can be removed.

Related: D22 in `docs/plans/20260912-frontend-backend-sequencing-order.md`,
D17 (the 40 px anchor line), WI-8 (the mode-switch scroll anchor).
