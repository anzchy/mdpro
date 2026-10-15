<!-- Device-check record. Condensed by mdpro-delegator from the report written by real-device-tester (dtrack, Mac mini) at ~/.mdpro-redesign/dtrack/reports/report-20261015-s3-recheck.md, triaged by mdpro-a3 (~/.mdpro-redesign/stage-3/prep-s3-recheck-triage.md); brief: ~/.mdpro-redesign/stage-3/brief-3.5c-recheck.md (not in the repo). 9 items, 0 FAIL, 1 NOT EXERCISED. -->

# v0.3.5 macOS re-check: D226 and D230–D236 on build `f8f3f66` (2026-10-15)

Recorded by mdpro-delegator. **Verdict: no FAIL.** D226 and D230–D236 are device-verified on
macOS. The one exception is D235-WI-2's ⌘K over Recovery, which was not exercised and is re-run
in Stage 3 batch 4, cell 8a. This covers the macOS half of the
[0.3.5 gate](../plans/20260912-frontend-backend-sequencing-order.md#release-035-gate) for these
items; the Windows half is a separate run.

## Setup

| Item | Value |
|---|---|
| Machine | Mac mini, dtrack, macOS 26.4 (25E246), Safari 26.4, WebKit 21624.1.16.11.4, 1920×1080 @1x |
| Build | build-only release run 38740104095 of `f8f3f664`. `tauri-app` sha256 `d16e1f816a3864b046b49ddbf6f47d342d5b10151c6305472219708d6161daf5`. releaseId `0.3.4@f8f3f664d950279c3de733978e0ef17f582fad6b` |
| Run | 2026-10-15 21:30–21:56 +0800, no user steps. Settings restored afterwards (theme System, WYSIWYG); quit clean, `dirtyCount 0` |

## Results

| # | Item | Light | Dark | Note |
|---|---|---|---|---|
| 1 | D226 | PASS | PASS | A list starting at 5 shows 5./6.; bytes unchanged. The fixture's second list shows 7./8.: CommonMark continues a list across a blank line, so the fixture was wrong, not the app (triage (1)) |
| 2 | D231 | PASS | PASS | Every Tab stop has an unclipped ring. Enter and Space close clean tabs; Enter on a dirty × opens the confirm. A click in the padding selects the tab |
| 3 | D232 | PASS | PASS | Arrow, Home and End move a visible ring in both editors, Align items included |
| 4 | D234 | PASS | PASS | Panel-coloured inner ring inside the accent edge |
| 5 | D233 | PASS | PASS | Rings on all four sides for the find × and the Go to Line ×. These panels write no app log; the evidence is the shots |
| 6 | D230 | PASS (a, b, c) | not run | (c) ran with Doubao Pinyin, the mini's IME. The fix keys on `isComposing` / keyCode 229, which WebKit sets for any marked-text IME (triage (5)). Windows Microsoft Pinyin is still open |
| 7 | D235 | PASS | — | ⌘⌥T logs `source:"menu"`: the native accelerator takes the key on macOS, as wired (`menu.rs`). Not a defect (triage (2)) |
| 8 | D235-WI-2 | — | ⌘, PASS, ⌘⌥T PASS, **⌘K NOT EXERCISED** | The editor had no keyboard focus behind Recovery, so ⌘K logged nothing. Recovery has no focus trap, so Tab can reach the editor; re-run as batch 4 cell 8a |
| 9 | D236 | PASS 4.83:1 | PASS 7.4 / 7.49:1 | Both placeholders read `#6b7280` in light |

## Findings registered

- **[D243](../plans/20260912-frontend-backend-sequencing-order.md#d243)** (item 8): after a crash
  and a relaunch on the same file, Recovery listed that file's draft. Discard was refused
  silently: `file.draft.discard` fail `in_use`, error `OpenInWindow`.
- **[D244](../plans/20260912-frontend-backend-sequencing-order.md#d244)** (item 2 observation):
  the bottom bar's `+` button draws WebKit's default ring, `#7baff8` at 2.10:1, under rule 33's
  3:1.

## Not covered

The mini runs macOS 26.4, so `focus({ focusVisible: true })` (D232, D234) is not checked on a
WebKit older than Safari 18.4. The macOS 13.1 floor stays unverified for those two rings.
