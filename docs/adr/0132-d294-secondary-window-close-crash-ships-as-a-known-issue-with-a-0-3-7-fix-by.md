# 0132. The D294 secondary-window close crash ships in 0.3.6 as a known issue, with a 0.3.7 fix-by

## Status

Accepted, 2026-10-22. Decided by the user, recorded by herdr-delegator. The user's words: 「Accept (Recommended)」. Reviewed over three rounds by gpt-auditor (`review-plan`) and Opus (`mdpro-fable-auditor`, plan mode), blind in round one: r1 C0 H2 / C0 H2, r2 C0 H1 / C0 H0, r3 C0 H0 / C0 H0.

Proposed 2026-10-22 by herdr-delegator. It applies a ruling the user gave before the last device
round, which said what would happen if that round showed no clear difference between the variants:
「One bounded test round, then B (Recommended)」.

**Revision 2** follows the first review: gpt-auditor C0 H2 M2 L0, Opus C0 H2 M5 L2. Both reviewers raised the same two
Highs:
- the compensating control overstated the draft timer;
- the ADR-0129 extension was incomplete: no severity class, no carry, and tracking that stopped too early.

The user then classified D294: 「High, carried to 0.3.7 (Recommended)」. **Revision 3** follows the
round-two confirms: gpt-auditor C0 H1 (X1 PARTIAL, the "bounded by the draft interval" sentence),
Opus C0 H0 M3 L1. It removes that sentence, names who judges a fix's mechanism, and puts the presence
check inline in the D294 row.

## Context

**D294.** On macOS, closing a secondary window can crash mdpro.
- The crash is on the main thread inside the system's WebKit, shortly after the close is allowed.
- At the 600 pt minimum width it reproduced in 1 of 5 closes before any mitigation existed. The
  original top frame was `ScrollingTree::takePendingScrollUpdates`.

**Three rounds since then:**

| Round | Build | Close ordering | Crashes / counted closes |
|---|---|---|---|
| Phase A, device round "Phase B" | `277f329d` | hide, then a 50 ms wait, then close | 1/30 |
| D294-R, variant A | `2d8d0f93` | main-thread hide, acknowledged, then 50 ms, then close (now the default) | 1/16 |
| D294-R, variant B | `2d8d0f93` with `d294-diag-no-hide` | no hide, 50 ms, then close | 0/16 |

**What the crashes since Phase A have in common:**
- every one is `EXC_BAD_ACCESS` at `0x638`;
- the top frame is `WebKit::WebPageProxy::dispatchSetObscuredContentInsets`, in a queued RunLoop
  task;
- each comes about 14–15 ms after the close is allowed.

**What the counts can and cannot show:**
- They cannot separate the variants. 0 crashes in 16 still fits a true rate of about 17 %, and that
  bound assumes the trials are independent, which clustered launches only approximate.
- Across every build that hides first, 2 of 46 counted closes crashed. That is a description of two
  different builds' runs, not a measured rate.
- The acknowledgement guarantees that the native hide has run before the wait, which Phase A's
  logging did not show. Its 0–1 ms is the acknowledgement's overhead, and this round showed no
  reduction in crashes from it.

**What the Codex consult found:**
- It ranked a bounded investigation (C) first, shipping as a known issue (B) second, and a reaper or
  pool (A) last. It added option D, disabling secondary windows.
- It found no public WebKit primitive that drains this pending work.
- Wry already detaches and retains the `WKWebView` at teardown.

The 0.3.6 release is waiting on this decision.

Evidence:
- [`docs/test/20261022-d294r-device-check.md`](../test/20261022-d294r-device-check.md);
- the [D294 row](../plans/20260912-frontend-backend-sequencing-order.md#d294);
- `~/.mdpro-redesign/device/D294R-report.md`, `~/.mdpro-redesign/device/D294-phaseB-report.md`, and
  the consult `~/.mdpro-redesign/herdr-spike/gpt-auditor/D294-options.md`, which are outside the
  repository.

## Options considered

1. **Keep chasing a fix in 0.3.6 (C).** This option lost.
   - Two rounds of ordering changes produced no measurable effect, and no candidate with a stated
     mechanism remains. Earlier detachment and a reaper are both speculative.
   - Each further round costs about an hour of device time and still cannot show a difference smaller
     than the one already missed.
2. **Ship as a known issue (B, chosen).** The user chose this branch before the round.
3. **Revert to Phase A (hide without the acknowledgement).** This option lost.
   - It crashed in the same frame, and neither ordering showed a reduction over the other.
   - The acknowledged ordering is already landed, audited and logged per attempt, which is better
     evidence for an upstream report.
4. **Disable secondary windows (D).** This option lost.
   - It removes a shipped feature, and changes how external opens are routed.
   - It is containment for a crash seen in 2 of 46 counted closes at the minimum width, and nobody
     has measured the rate at ordinary widths.
   - It also leaves the other close and quit paths unexamined.
5. **Make the no-hide variant the default.** This option lost.
   - It does not crash less in any way the counts can show: 0/16 against 1/16.
   - It brings a visible defect: the emptied secondary window stays on screen for about 0.5–1 s after
     the click.

## Decision

1. **The default ordering stays:** the landed `hide_ack` ordering (`2d8d0f93`): main-thread hide,
   acknowledged, then 50 ms, then the close.
2. **D294 is High, not Critical** (the user: 「High, carried to 0.3.7 (Recommended)」).
   - It needs a secondary window to be closed. It has been seen only at the minimum width, not on
     an ordinary path.
   - Autosave can recover only edits held in a document's last successfully written draft. It gives no
     general time bound on loss (decision 4).
3. **0.3.6 ships with D294 open:**
   - a `CHANGELOG.md` Known issues line under `## [Unreleased]`;
   - the owner is herdr-delegator until a grant moves it.

   **Fix-by 0.3.7 is an explicit carry.** ADR-0129 decision 4 defaults a reproduced data-loss
   defect to the lowest unreleased version, 0.3.6. The user's two rulings carry it to 0.3.7:
   「One bounded test round, then B (Recommended)」 and 「High, carried to 0.3.7 (Recommended)」.
4. **The compensating control is partial.** `src/hooks/useAutoSave.ts` drafts each window's
   **active** dirty document at the interval set in Settings: 30 s by default, and up to 5 min.
   With autosave Off, it drafts nothing. A draft is offered for recovery at the next launch. These
   edits are lost:
   - edits made since the last draft;
   - edits in a dirty background tab after its last draft;
   - everything unsaved when autosave is Off.

   A tab switch restarts the interval. The quit-time drafters do not run on a crash. The Known
   issues line states this in user terms.
5. **An upstream report is filed**, but only after the user approves its text and its tracker.
   Filing it is an outward-facing action.
6. **The `d294-diag-no-hide` feature stays**, off by default and never in a release build. It is
   there to reproduce the crash upstream and for a 0.3.7 investigation.
7. **D294 joins ADR-0129 decision 5's tracked set, by this ADR.** It stays in that set across fixes,
   backports, reverts and re-ruled fix-bys, exactly as an audit finding does. Its presence check
   on a locked release SHA works like this:
   - **The fault path** is the secondary-window close in `src-tauri/src/commands/window_close_order.rs`
     (stage, then `allowed_close`), ending in WebKit's `dispatchSetObscuredContentInsets` at `0x638`.
   - **Present** is the default.
   - **Absent** only when both hold:
     - the tree contains a fix with a stated mechanism that changes that path. The delegator judges
       the mechanism when it runs the checkpoint, and the merged two-auditor verdict on the fix's PR
       must not dispute it;
     - a device run on that SHA, on the affected macOS, shows 0 crashes in at least 30 counted
       closes at the minimum width, with the build and variant confirmed from the logs.
   - A clean device run alone, or a missing one, is **unknown**, which counts as present.
   - Each release checkpoint records the outcome in the D294 row. At its fix-by, it needs a new
     ruling, as ADR-0129 requires.

## Consequences

- **A known crash ships in a release.** A user who closes secondary windows can lose every unsaved
  edit that no draft holds, in every window. That means all of them when autosave is Off. The Known issues line publishes that, through the
  in-app update notes.
- **The rate is not measured.** 2 of 46 counted closes at the minimum width, across two builds, is
  all that is known. The rate at ordinary widths is unknown.
- **The tracked set grows beyond audit findings.** This ADR enrols a device-found defect in ADR-0129's
  checkpoint by name. Doing the same for another defect needs its own record.
- **The fix may not be ours to make.** The crash is in system WebKit. If upstream doesn't move,
  0.3.7 needs a new mitigation idea, or a re-ruled fix-by.
- **Device evidence is harder than it should be.** The app shows no build SHA (`buildId`
  `"unknown"`), so every round has to confirm its build from the worktree and the logs.
- **The diagnostic feature has to be kept.** It is a second build configuration of the close path.
  Its tests run only under `--features d294-diag-no-hide`.
