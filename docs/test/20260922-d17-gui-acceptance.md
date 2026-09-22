# D17 GUI acceptance (WI-7): WYSIWYG geometric scroll spy

- **Date**: 2026-09-22 / 23
- **Build**: `src-tauri/target/release/bundle/macos/mdpro.app` (release, built 23:28 from the
  uncommitted D17 working tree on `frontend-backend-redesign`; bundle postdates every D17 source file)
- **Runner**: the mdpro-agent-2 session, computer use, judged from zoomed screenshots ("eye")
- **Fixtures** (outside the repo): `~/mdpro-repro/repro-a.md` (1 H1 + 12 `##` × 15 paragraphs),
  `~/mdpro-repro/repro-img.md` (1 H1 + 10 `##`, each with a local 1000 px-wide PNG, 500–740 px tall)
- **Window sizes**: 1200×800 and 1000×940. At 800 px wide the sidebar collapses to a strip and
  ⌘⇧L does not restore it, so 800 px wide was not usable.
- **Rule under test** (ADR-0026): the active heading is the last one whose top is at or above
  the scroller top + 40 px. At the scroll limit the current heading is kept.

## Verdicts (plan WI-7 criteria)

| # | Criterion | Result |
|---|---|---|
| 1 | ⌃2→⌃4 landing mid-section: the section's own heading is lit (3 of 3) | **pass** (eye). Parked in the middle of H06, H03, H09 and H11; all 4 stayed lit after the round trip. |
| 2 | Scrolling up inside a long section switches as soon as the upper heading crosses the anchor | **pass** (eye). H06 stayed lit from P15 up to P01, then switched to H05 when the H06 heading fell below the line. |
| 3 | Symmetric probe, down and up | **pass**. 8 steps of 8 ticks each way; the same offset gave the same entry. |
| 4 | Clicking the last and second-to-last headings: the highlight holds | **pass** (eye). H03, H08, H11 and H12 each landed at about 40 px and were still lit after 2 s. |
| 5 | Click identity: the clicked entry is lit, never the one above it | **pass** (eye). 8 of 8. |
| 6 | Cold open with no restore: lit without scrolling | **pass** (eye). The first entry was lit; `ui.toc.coordination.reset` appeared with no mismatch. |
| 7 | Two window aspect ratios | **pass** (eye). At 1000×940, criteria 1 and 4 were repeated; at the bottom H12 stays lit (retention at the limit). |
| 8 | Image-heavy document: the highlight follows the settle re-apply | **pass** (eye) for the spy: cold open, a down and up pass at 3 notches per step, both window sizes, with no hysteresis or flicker. See **D22** below for the click landing. |

### Extra checks (not plan criteria)

| Check | Result |
|---|---|
| No `ui.toc.*` line per scroll, and no `ui.toc.navigate` fail | **pass** (log, byte windows from offsets 3740607 and 3792128) |
| No `ui.toc.resolve.mismatch` on a mode switch | **FAIL, and not caused by D17**. It fires once per ⌃2→⌃4 (repro-a: 5 of 5, `{entryCount:13, domCount:0, resolvedCount:0}`; repro-img: 4 of 4). The first pass runs before `.ProseMirror` exists. The pre-D17 spy did the same, and `tests/use-toc-navigation-identity-landing-guards.test.ts` N-3/N-5 pin it. Filed as **D21**. |
| Clicking an outline entry right after ⌃2→⌃4 on repro-img | **FAIL, and not caused by D17 (from reading the code; not measured on the old build)**. Clicking H05 landed inside the H02 section, twice, in the same place. Clicking H09 had no visible effect. The highlight matched wherever the view actually was. Filed as **D22**. |

## D22: why a click during image settle lands wrong

WebKit does not implement CSS scroll anchoring (`overflow-anchor`). `useMilkdownImages` swaps
image sources to `asset://` after the editor renders, so right after ⌃4 every image has zero
height.

- A click in that window computes its `scrollTop` against the short document. For H09 that
  target is clamped to the scroll limit, so the click looks like it did nothing.
- As the images above the target load, the content grows underneath the fixed `scrollTop`. H05
  ends up about four image-heights lower, which puts the view inside H02.
- The click has no re-pin. The mode-switch restore's single settle re-apply
  (`useMilkdownScrollRestore`) only re-applies the restore anchor, and only while `scrollTop` is
  still its own value, so after a click it correctly does nothing.

The same cause explains the round-trip drift. Parked with H09 at the top, a round trip with no
click came back about one image-height high: the one re-apply fires at the first image load
above the probe, and later loads shift the content again. The pre-D17 click path
(`scrollIntoView({behavior:"smooth"})`) computed its target once at the start as well.

## Other observations

- **Repeated menu logging**: 85 `ui.menu.select` events for 10 mode changes, several per
  keypress. This was seen again on repro-img. It needs its own row.
- **Content shift on repro-a**: each ⌃2→⌃4 round trip moves the content about 5 px down.
- **H10 on repro-img is unreachable by scrolling**: at the bottom H09 stays lit. This is the
  accepted asymmetry (ADR-0017/0018), now in both modes.
- **Borderline stops were correct**: headings 45–70 px down kept the heading above them lit.

## Outcome

Every plan WI-7 criterion passes, so D17 is verified. D21 and D22 are behaviour that existed
before D17 and are tracked in their own rows in
`docs/plans/20260912-frontend-backend-sequencing-order.md`.
