<!-- Device-check record. Condensed by mdpro-delegator from dtrack's report on the Mac mini (~/.mdpro-redesign/dtrack/reports/report-20261016-d244-c7.md), triaged by mdpro-a3 (~/.mdpro-redesign/stage-3/prep-d244-c7-triage.md). Brief: ~/.mdpro-redesign/stage-3/brief-d244-tabwalk-and-c7.md (not in the repo). -->

# D244 Tab walk (12 ringed surfaces) and Stage 3 cell 7, macOS, build `712b655` (2026-10-16)

Recorded by mdpro-delegator. **Verdict: [D244](../plans/20260912-frontend-backend-sequencing-order.md#d244)
passes on device.** All 34 ring stops PASS in both themes. Every ring is exactly the accent
(`#2563eb` light / `#60a5fa` dark), 2 px and uniform, with the brief's outer or inset geometry.
Stage 3 batch 3 cell 7 (the Source lint tooltip) passes too. The walk found three surfaces outside
D244's list, which became [D250](../plans/20260912-frontend-backend-sequencing-order.md#d250) (fixed,
and verified on the v0.3.5 candidate), plus one clip on `+`, which became
[D251](../plans/20260912-frontend-backend-sequencing-order.md#d251).

## Setup

| Item | Value |
|---|---|
| Machine | Mac mini, dtrack, 1920×1080 @1x, input source ABC, `AppleKeyboardUIMode` 2 |
| Build | build-only release run 38768777082 of `712b655a62f19883e67320d87b89e34889605386`; `tauri-app` sha256 `df2f588e4b98cf1b3a982fae39aba2b5b493f20d6a3a2f9e8d9c28fb859ad1be`; releaseId `0.3.4@712b655a…` on both launches |
| Run | 2026-10-16 00:53–01:13 +0800: light pass, then dark. Settings were restored to System / WYSIWYG / 16 px. Shortcuts were reset and then Discarded twice, never saved, so their hash is identical before and after. Both quits were clean, with no drafts. The scratch `surf.md` is byte-identical to the fixture |

## Results

| # | Surface | Ring | Light (read / expected) | Dark (read / expected) |
|---|---|---|---|---|
| 1 | TOC caret, resting row | outer | PASS 4.83 / 4.83 | PASS 6.85 / 6.85 |
| 2, 2b | TOC caret, current (tinted) row | outer | PASS 3.99 / 3.99 | PASS 4.62 / 4.64 |
| 3 | `+` new document | outer | PASS 4.83, **bottom outer row clipped** (F1 → D251) | PASS 6.85, same clip |
| 4, 4b | Settings categories (focus on open, then Tab) | inset + fill | PASS 3.94–3.95 vs fill / ≥ 3.76 | PASS 4.29–4.89 / ≥ 4.26 |
| 5 | Settings × | outer | PASS 5.17 | PASS 6.99 |
| 6 | Font size stepper group | outer, 2 px gap | PASS 5.17 | PASS 6.99 |
| 7 | Stepper − and + | inset, 0 of 132 ring pixels outside the 1 px border | PASS 5.17 | PASS 6.99 |
| 7 | → / ← on the group | — | 16 → 17 → 16 px (`preferences.set`) | — |
| 8 | MCP 📋 (server line, client row) | outer; glyph at full strength on focus | PASS 4.83 | PASS 6.85 |
| 9 | Shortcut value | outer, 2 px gap | PASS 4.91 / 4.89 | PASS 7.18 / 7.21 |
| 10 | Discard on the unsaved-shortcuts banner | outer | PASS 4.71 / 4.72; no `settings.shortcuts.save` | PASS 5.70 / 5.72 |
| 11 | Image menu Apply | outer | PASS 5.17 | PASS 6.99 (fill = ring colour, O3 → D250) |
| 12 | Image menu items | inset | PASS 5.17 | PASS 6.99 |
| 12 | the current size's inner ring | — | NOT VERIFIED: the fixture image has no width, so no size is current | same |
| 13 | Source lint tooltip (Stage 3 batch 3 cell 7, after) | — | PASS: no `#bbb` border, hairline + shadow | PASS |

The image menu is reachable by Tab. No Tab stop left Settings while it was open.

## Findings, as triaged

- **F1 → D251 (SHOULD, after v0.3.5).** `+` loses its bottom outer ring row at the window edge.
  The bottom bar's 35 px content box leaves 3.5 px around the 28 px button, and pattern 2 needs 4.
  The ring stays solid on all four sides. No other control in the bar is affected.
- **O1, O2, O3 → D250 (fixed in v0.3.5).**
  - O1: the three MCP toggles drew no focus at all.
  - O2: the image menu's Custom… width input drew WebKit's default ring.
  - O3: dark Apply used the accent, not D222's fill.
  - All three pass on the v0.3.5 candidate: [record](20261016-v035-candidate-macos-device-check.md).
