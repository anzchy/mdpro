<!-- Device-check record. Condensed by mdpro-delegator from dtrack's reports on the Mac mini (~/.mdpro-redesign/dtrack/reports/report-20261015-d240-mcp-held.md, report-20261015-s3-3-menus-modals-toasts.md, report-20261015-s3-4-dialogs.md), triaged by mdpro-a6 (D240) and mdpro-a3 (~/.mdpro-redesign/stage-3/prep-s3-3-triage.md, prep-s3-4-triage.md). Briefs: docs/pending/20261015-brief-d240-mcp-held.md and ~/.mdpro-redesign/stage-3/brief-3.5b-{3,4}-*.md (not in the repo). -->

# v0.3.5 macOS checks on build `f8f3f66`: D240, and Stage 3 batches 3 and 4 (2026-10-15)

Recorded by mdpro-delegator. **Verdict:** D240 passes on the held-prompt behaviour. Neither
Stage 3 batch has a Stage 3 defect. Batch 4 found one new defect,
[D246](../plans/20260912-frontend-backend-sequencing-order.md#d246), and confirmed
[D243](../plans/20260912-frontend-backend-sequencing-order.md#d243) for Recover.

## Setup

| Item | Value |
|---|---|
| Machine | Mac mini, dtrack, macOS 26.4, 1920×1080 @1x, input source ABC |
| Build | build-only release run 38740104095 of `f8f3f664`; `tauri-app` sha256 `d16e1f816a3864b046b49ddbf6f47d342d5b10151c6305472219708d6161daf5`; releaseId `0.3.4@f8f3f664d950279c3de733978e0ef17f582fad6b` on every launch |
| Runs | D240 22:3x–22:48, the Escape control 22:49–22:51, batch 3 22:5x–23:11 (restarted once after outside input, with the user's word), batch 4 23:31–23:55 (+0800). Every teardown was clean |

## D240: an MCP prompt waits while another dialog is open

| Case | Verdict | Proof |
|---|---|---|
| M1: Insert Link open, then a write | **PASS** | No prompt over Link; `ui.mcp_confirm.held`; after Link closed, the prompt showed with Reject focused; Approve gave 200. (The brief expected Enter to insert a link with nothing selected; ⌘K links the *selected* text, as in v0.3.4.) |
| M2: Escape in Link while a write is held | **NOT EXERCISED** | A scripted Esc doesn't reach mdpro dialogs (see below). The safe half held: no reject, and curl stayed pending until a Reject click (403). Windows check 4b covered this case with real keys |
| M3: Settings open, then a write | **PASS** | Held under Settings, shown with Reject focused after Settings closed |
| M4: a held write times out | **PASS** | 408 `CONFIRM_TIMEOUT` at 60.005 s; no prompt ever drawn; no reject; document unchanged. No `ui.mcp_confirm.expired` line, which is expected: Rust's `confirm_resolved timedOut` drops the request first, so the trail is `ui.mcp_confirm.held` and then Rust's `mcp.confirm` `timedOut` |
| M5: control, no dialog | **PASS** | The prompt showed in about 1.3 s with no held line; Reject gave 403 |

**Scripted Escape.** Neither a scripted `key code 53` nor computer-use Escape closes Insert Link or
Settings. This is the same on the released v0.3.4 (`3b16610`) and on `f8f3f66`, and nothing is
logged for it. The WI-004 record already showed this harness limit, where a physical Esc worked
(H2, `ui.dialog.escape`). It is not an app regression.

## Stage 3 batches 3 and 4 (after shots)

| Batch | Expected | Unexpected | Not run / not verified |
|---|---|---|---|
| 3: menus, modals, Source find, toasts | 22 | 2: the save-error toast text, both themes | 1: cell 7, the Source tooltip (the fixture has no column-count error) |
| 4: dialogs | 13 | 2: the encoding dialog, both themes | 1: extchange-deleted, light (F2) |

The three UNEXPECTED groups are intended changes that the briefs failed to list:
- **The save-error toast** now reads "Save failed: permission denied: <path>" instead of "[object Object]". That is [D163](../plans/20260912-frontend-backend-sequencing-order.md#d163).
- **The encoding dialog** is D52 / ADR-0057.
- **The cell 8 timestamp format** is D190-WI-7.

Batch 3 also found that a toast has no width cap: [D245](../plans/20260912-frontend-backend-sequencing-order.md#d245).

**F2 → D246:** in light, `rm` on an open file twice gave the "modified" prompt instead of
"deleted". Dark was correct.

**Cell 8a:** Tab never entered the Recovery card. Stops 1–9 went through the outline behind the
overlay, then to the resize handle. So ⌘K over Recovery is NOT EXERCISED, and this is evidence for
WI-4.6b.

**Cell 8b:** Recover, with the draft's file already open, was refused silently (`file.draft.recover`
fail `in_use` / `OpenInWindow`), and the draft was listed again on the next launch. This is D243.
