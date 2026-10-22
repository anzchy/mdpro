# Audit log

One row per audited range, and one row per Critical or High finding
([ADR-0121](../adr/0121-audit-effort-follows-risk-pre-existing-findings-do-not-block-and-auditors-are-measured.md)
Decision 6). The delegator is the only writer. A row is written when its
merged verdict is posted on the PR, updated at each confirm, and closed at the
final outcome. The rows come from the merged-verdict PR comments.

It starts with audits requested after `811e5047`, the commit that accepted
ADR-0121. WI-009 and WI-4.3a finished under the earlier order and are not
backfilled.

## Ranges

- **Tier**: High / Medium / Low (rule 70 item 4, "Effort follows risk").
- **Base**: `git merge-base master <head>` at audit time. It moves with each rebase, so a row
  lists every base it had.
- **Counts**: each detector's raw `C/H/M/L`, then the merged blocking count `BLOCKING C<n> H<n>`.
- **Outcome**: `landed <sha>` / `superseded by <PR>` / `abandoned` / `open`.

| PR | Item | Tier | Base → head | Rounds | Codex | Fable | security-review | Blocking | Reports | Outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| #521 | D304 | High | `4fccd8ef` → `8543caa3` (r1) → base `f7dc9aac` (rebased `5a3c9117`, tree-identical) | 1 | r1: C0 H0 M0 L0 | r1: C0 H0 M0 L2 | r1 C0 H0 M0 L0 (Opus fork) | C0 H0 | PR #521 comments (both r1 reports, merged r1) | landed `5a3c9117`; `Cargo.lock` only (RUSTSEC-2026-0382/0383); `rust-audit` green |
| #523 | D294 | High | `bd5acfc3..277f329d` | 1 | r1: C0 H0 M3 L1 | r1: C0 H0 M1 L5 | r1 C0 H0 M0 L0 (Opus fork) | C0 H0 | PR #523 comments (both r1 reports, merged r1) | landed `277f329d`; Phase A candidate close ordering, crash effect pending Phase B device run |
| #522 | ADR128 + D302 | High | `57ea75e5..840978b0` (r1) → `b634f430` → `aea3dd20` (r2) → base `d0b90164` (rebased `e5ac9f12`, receipts union only) | 3 | r1: C0 H5 M0 L0 · r2: C0 H1 M1 L0 · r3: C0 H1 M1 L0 | r1: C0 H1 M3 L5 · r2: C0 H0 M2 L1 · r3: C0 H0 M1 L2 | r1 C0 H0 M0 L1 (Opus fork) | r1 C0 H2 · r2 C0 H0 · r3 C0 H0 (A refuted to Medium in the r2 challenge; Codex kept High in r3 without answering the counter-proof) | PR #522 comments (all reports, merged r1–r3) | landed `e5ac9f12`; A residual is a precondition for the AC-9 grant |
| #524 | D255-WI-3a | High | `9f133f1d..5b88bf14` | 1 | r1: C0 H0 M2 L0 | r1: C0 H0 M1 L4 | r1 C0 H0 M0 L0 (Opus fork) | C0 H0 | PR #524 comments (both r1 reports, merged r1) | landed `5b88bf14`; Fable M1 (an inline-mark unwrap peels one marker) and Codex AC-2 PARTIAL carried to D255-WI-3b |
| #525 | D294-R | High | `d78e77d6..2d8d0f93` | 1 | r1: C0 H0 M2 L2 | r1: C0 H0 M1 L5 (fable-auditor, rotated from its handoff first, user: 「Rotate the session first」) | r1 C0 H0 M0 L1 (Opus fork) | C0 H0 | PR #525 comments (both r1 reports, merged r1) | landed `2d8d0f93`; acked main-thread hide + off-by-default `d294-diag-no-hide` control; crash effect pending the ~15-per-variant device round; Fable M1 (dead `stage` arm greened the WI-1 RED) carried as a note |
| #526 | D258 | Low | `524d34bf..b5be763e` | 1 | r1: C0 H0 M0 L0 | — (Low tier: Codex alone, ADR-0121) | — (not High tier) | C0 H0 | PR #526 comment (Codex r1) | landed `b5be763e`; first ADR-0133 Low-tier item (gpt-imple-3, gpt-5.6-sol); rule 33 pattern 2 outline on the native select; device check pending (Tab ring both themes; click ring is a device verdict, WebKit bug 233924) |
| #527 | M4 | High | `ac88149a..2a9fa451` | 1 | r1: C0 H0 M0 L2 | r1: C0 H0 M7 L6 | r1 C0 H0 M0 L1 (Opus fork) | C0 H0 | PR #527 comments (both r1 reports, merged r1) | landed `2a9fa451`; verifier ISSUES on receipts only, landed before the ruling and accepted retroactively under G527-1; Fable M: `rebuild_offmac_root` is Windows/Linux code no gate runs, added to the Windows device check; native AppKit menu batch pending |
| #520 | D297 | High | `8af87ace` → `2a22c991` | 1 | r1: C0 H0 M3 L0 | r1: C0 H0 M2 L4 | r1 C0 H0 M0 L0 (Opus fork) | C0 H0 | PR #520 comments (both r1 reports, merged r1) | landed `2a22c991`; verifier full lane clean (no D302 timeout); `rust-audit` red on new advisories, not in `ci-gate`, registered D304 |
| #519 | D299 | High | `80e5f21c` → base `b036483c` (rebased `d1816eea`, r1) → `87d1e290` (r2) | 2 | r1: C0 H3 M2 L2 (H1 legacy meta marked recovered before the claimed write; H2 placement throw leaves the modal stuck; H3 delayed token write) ; r2: H1, H2 CLOSED, H3 refutation accepted, C0 H0 M3 L2 | r1: C0 H0 M4 L5, then CONFIRMED H1 and H2, REFUTED H3 on challenge; r2: C0 H0 M0 L2 | r1 C0 H0 M0 L1 (Opus fork) | C0 H0 | PR #519 comments (each round's reports, challenges, merged r1–r2) | landed `87d1e290`; receipts accepted under G519-1 (「补证后接受例外 (Recommended)」); CI rust-test rerun once under D303 |
| #518 | D301 | High | `7c97166f` → `b6f3a152` (r1) → base `f7c8c791` (rebased `7367a22a`) → `631ef1c7` → base `fd64d2dd` (rebased `24de0f67`, r2) → `e78a9d49` (r3) | 3 | r1: C0 H1 (late rejection swallowed after delivery) ; refuted Fable H1 pre-existing on challenge; r2: H1-A, H1-B CLOSED, new N1 (pending filter accepts a late soft non-body failure, introduced `ac6a7f7b`) C0 H1 M3; r3: N1 CLOSED, C0 H0 M2 | r1: C0 H1 (`test.scoped` fixture bypass), CONFIRMED Codex H1; r2: C0 H0 M0 L5, then CONFIRMED N1 on challenge; r3: C0 H0 M0 L2 | r1 C0 H0 M1 L2 (Opus fork) | C0 H0 | PR #518 comments (each round's reports, challenges, merged r1–r3) | landed `e78a9d49`; verifier full lane D302-only and WI-1/2/3 receipt lines both accepted by the user (「只因 D302 失败则算通过 (Recommended)」, 「接受为授权例外 (Recommended)」) |
| #516 | ADR-0125 tooling | High | `cee9af46` → `e2f41d9d` (r1) → base `0d34b465` (rebased) → `e990ed93` / `d76fc0bb` (r2) → `a8534877` (r3) | 3 (the ADR-0120 cap; user ruled after r3: 「Land now, defer as a D item」) | r1: C0 H2 (H1 a non-body phase failure counted as RED; H2 receipt checks not repeated at mutation) M3; r2: H2 CLOSED, H1 PARTIAL (soft errors in fixture setup and beforeEach) C0 H1 M6 L1; r3: soft cases CLOSED, H1 PARTIAL (unawaited hard async assertion in setup) C0 H1 M6 L1 | r1: C0 H0 M3 L7, CONFIRMED H1 and H2 on challenge; r2: C0 H0 M2 L5, then CONFIRMED H1 PARTIAL on challenge; r3: C0 H0 M1 L2, then CONFIRMED on challenge | r1 C0 H0 M0 L1; r2 C0 H0 M0 L5; r3 C0 H0 M0 L3 (Opus fork) | C0 H1 after r3, deferred to D301 by the user | PR #516 comments (each round's reports, challenges, merged r1–r3, the ruling) | landed `a8534877` |
| #517 | D291 | Medium | `cee9af46` → `01346270` (r1) → `958061e8` (r2) | 2 | r1: C0 H1 M1 L1 (H1 Recover's early row removal focuses the outgoing tab while placement awaits `get_draft`); r2: H1 CLOSED, C0 H0 M1 L1 | r1: C0 H0 M2 L6, CONFIRMED H1 on challenge (introduced by `dab5b6b1`); r2: H1 CLOSED, C0 H0 M0 L3 | not run (Medium tier) | C0 H0 | PR #517 comments (Codex r1, Fable r1, challenge, merged r1, both r2, merged r2) | landed `958061e8` |
| #515 | D290 | High | `bcfd4415` → `0ee486d2` (r1) → `82dbce98` (r2) → `2dbcff7a` → `4775f410` (r3, rebased) → `ab06bc9e` (r4) | 4 (r4 a user-ruled exception to ADR-0120: 「Allow 4th fix round (Recommended)」) | r1: C0 H2 (H1 close during the preferences await; H2 relaunch batch guarded once); r2: H1, H2 CLOSED, new H3 (an epoch check silently drops a valid Save) C0 H1 M1; r3: H3 CLOSED, new H4 (Reload then typing revives a stale Save over the disk) C0 H1 M1; r4: H4 CLOSED, C0 H0 M1 | r1: H1 confirmed, H2 called pre-existing and rejected because the PR claims the property; r2: C0 H0 M4 L7, CONFIRMED H3 on challenge; r3: C0 H0 M3 L8, CONFIRMED H4 on challenge (master also writes the stale buffer); r4: H4 CLOSED, C0 H0 M3 L8 | r1 C0 H0 M0 L2; r2–r4 delta C0 H0 (Opus fork) | C0 H0 | PR #515 comments (each round's reports plus merged r1–r4) | landed `ab06bc9e` |
| #514 | M3b | High (raised from Medium by gpt-auditor, ADR-0121) | `bcfd4415` → `c5d5c7c9` (r1) → `f9845e90` (r2) | 2 | r1: C0 H1 M4 L1; r2: H1 CLOSED, C0 H0 M4 L1 | r1: C0 H0 M2 L8 (mini + tier-High top-up), CONFIRMED H1 on challenge; r2: H1 CLOSED, C0 H0 M1 L8 | C0 H0 M0 L1 (Opus fork) | C0 H0 | PR #514 comments (Codex r1, Fable r1, merged r1, merged r2) | landed `f9845e90` |
| #513 | D293 | High | `d50d0096` → `bcfd4415` | 1 | C0 H0 M0 L1 (gpt-auditor) | C0 H0 M1 L4 (fable-auditor) | C0 H0 M0 L1 (Opus fork) | C0 H0 | PR #513 comments (Codex r1, Fable r1, merged r1) | landed `bcfd4415` |
| #512 | M3a | High | `9b485752` → `c575e2e4` | 1 | C0 H0 M3 L1 (gpt-auditor) | C0 H0 M6 L6 (fable-auditor) | C0 H0 M0 L0 (Opus fork) | C0 H0 | PR #512 comments (Codex r1, Fable r1, security-review, merged r1) | landed `c575e2e4` |
| #511 | D289 | High | `10806dca` → `9b485752` | 1 | C0 H0 M1 L1 (gpt-auditor) | C0 H0 M3 L4 | C0 H0 M0 L0 (Opus fork) | C0 H0 | PR #511 comments (Fable r1, merged r1, security-review) | landed `9b485752` |
| #510 | D286 | High | `af72940d` → `10806dca` | 1 | C0 H0 M0 L1 (gpt-auditor) | C0 H0 M2 L1 | C0 H0 M0 L0 (Opus fork, run after landing) | C0 H0 | PR #510 comments (Fable r1, merged r1, security-review) | landed `10806dca` |
| #508 | WI-4.3b | High | … → `098d339d` (base `af72940d`, r4) → `aecb0165` (base `f1bac1cd`, r5) | 5 | r4: C0 H3 M1; r5: C0 H1 M2 L1 | r4: C0 H0 M3 L3, confirmed all three on challenge; r5: C0 H0 M3 L4, then CONFIRMED F508-1b on challenge (reproduced) | r5: C0 H0 M0 L1 (Opus fork) | r5: C0 H1 | PR #508 comments (merged r4 6251108116; r5 reports and merged r5) | landed `aecb0165` with F508-1b deferred as D293, user: 「Land now, defer as a D item」 |
| #507 | D284 | High | `06308c46` → `286eae60` | 1 | C0 H0 M0 L0 | C0 H0 M1 L1 | C0 H0 M0 L0 | C0 H0 | PR #507 comments (Codex, security-review, Fable r1, merged r1) | landed `286eae60` |
| #506 | D274 | High | `e04f35f0` → `76d5f04b` | 1 | C0 H0 M0 L0 | C0 H0 M0 L2 | C0 H0 M0 L0 | C0 H0 | PR #506 comments (Codex, security-review, Fable r1, merged r1) | landed `76d5f04b` |

## Gate exceptions

A user ruling that lets a landing pass a gate it would otherwise fail
([ADR-0129](../adr/0129-a-high-that-survives-the-audit-cap-is-classified-tracked-and-expires.md)
Decision 8). The delegator records each one when it is granted, whatever the round or the count.

- **Scope**: either `this landing only` (with the PR and SHA) or `until <condition>`.
- **Closed**: set when a this-landing-only exception lands, or when an until-condition first holds.
- An open `until` row is listed at every release checkpoint.

| Id | PR | Gate waived | Scope | Owner | Ruling | Closed |
|---|---|---|---|---|---|---|
| G518-1 | #518 | verifier full frontend lane: exit 1 solely on `[vitest-worker]: Timeout calling "onTaskUpdate"`, every test passing, with `ci-gate` green on the same head | until D302 is fixed | gpt-imple-1 (D302 folded into the ADR-0128 rollout) | 「只因 D302 失败则算通过 (Recommended)」 | closed at landing `e5ac9f12` (D302 fixed) |
| G518-2 | #518 | receipts D301-WI-1/2/3: recorded lines changed by the brief's mechanical `spawnSync` → `await execFile` conversion | this landing only (`e78a9d49`) | — | 「接受为授权例外 (Recommended)」 | closed at landing `e78a9d49` |
| G519-1 | #519 | receipts D299-WI-1/2/3 SEPARATION-BROKEN, WI-6 had no original RED; compensating D299-WI-3R/6R; `check-pending` lists D299-WI-3 | this landing only (PR #519, `87d1e290`) | — | 「补证后接受例外 (Recommended)」 | closed at landing `87d1e290` |
| G527-1 | #527 | verifier `check-pending`: receipts `M4-WI-6` and `M4-WI-6b` have no verdict (historical, superseded by the held `M4-WI-6c`–`6g`); `M4-WI-6h` Help RED was green, not recorded, and the Help dialog test covers the behaviour | this landing only (PR #527, `2a9fa451`) | — | 「Accept retroactively (Recommended)」, given after the delegator had already landed on the verifier's ISSUES. That was a breach of rule 70 item 2, and from now on the delegator asks before landing on any ISSUES | closed at landing `2a9fa451` |
| G523-1 | #523 | receipt D294-WI-3 SEPARATION-BROKEN (`spec-changed-under-green`); compensating D294-WI-3R (prompt-cancel ordering reverted alone → assertion RED, restored → SEPARATION-HELD); `check-pending` lists D294-WI-3 | this landing only (PR #523, `277f329d`) | — | 「Accept after evidence (Recommended)」 | closed at landing `277f329d` |
| G522-1 | #522 | receipts D302-WI-4/5/9 SEPARATION-BROKEN (tests and implementation in one file, or fixtures corrected later); compensating D302-WI-4R/5R/9R assertion REDs, SEPARATION-HELD; `check-pending` lists D302-WI-4/5/9 | this landing only (PR #522, `e5ac9f12`) | — | 「Accept after evidence (Recommended)」 | closed at landing `e5ac9f12` |

## Findings

- **Id**: `F<PR>-<n>`, stable once posted.
- **Detectors**: Codex, Fable, `security-review`, or several of them.
- **Class**: the bug class it names. The same class raised on a second PR goes into
  `REVIEW.md` or becomes a lint-test D item.
- **Outcome**: `fixed <sha>` / `refuted` (with the counter-proof's link) / `pre-existing D<n>` /
  `ruled by the user` (quoted).

| Id | PR | Severity | Detectors | Class | file:line | Outcome |
|---|---|---|---|---|---|---|
| F519-1 | #519 | High | Codex; Fable confirmed | a failed legacy conversion marked the source recovered before the claimed bundle write could fail, hiding the pair on every later launch | `src-tauri/src/services/draft/recovery.rs:52` | fixed `87d1e290` (receipt D299-FX1-WI-1) |
| F519-2 | #519 | High | Codex; Fable confirmed | a throw during claimed-path placement left the row at "Recovering…" with the modal open | `src/utils/recoverIntoOpenTab.ts` | fixed `87d1e290` (receipt D299-FX1-WI-2) |
| F519-3 | #519 | High | Codex; Fable refuted | a delayed token write overwriting newer own text | claimed-write path | refuted (trace counter-proof, PR #519 merged r1 comment) |
| F518-1 | #518 | High | Codex; Fable confirmed | a non-body rejection settling after result delivery (`onTestFinished`, a body timer after the test ends) was swallowed by the new rejection observer | `scripts/tdd/phase-runner-source.mjs` | fixed `ac6a7f7b` (receipt D301-FX1-WI-1) |
| F518-2 | #518 | High | Fable; Codex refuted the pre-existing claim | a `test.scoped` fixture override bypassed the fixture wrapper, so its setup ran as body | `scripts/tdd/phase-runner-source.mjs` | fixed `ac6a7f7b` (receipt D301-FX1-WI-2) |
| F518-3 | #518 | High | Codex; Fable confirmed | the fix's pending-only filter accepted a real late soft non-body failure (soft assertions fulfil, so no rejection was seen) | `scripts/tdd/unit-red-lane.mjs:38` | fixed `e78a9d49` (receipt D301-FX2-WI-1) |
| F516-1 | #516 | High | Codex; Fable confirmed (r1–r3) | the focused RED lane counted a failure outside the test body as an assertion RED. r1: a thrown cleanup or hook; r2: `expect.soft` in fixture setup or beforeEach; r3: an unawaited hard `.resolves` in setup | `scripts/tdd/unit-red-lane.mjs`, `scripts/tdd/phase-runner-source.mjs` | r1 and r2 cases fixed `e990ed93`, `a8534877`; r3 remainder deferred to D301 (user: 「Land now, defer as a D item」) |
| F516-2 | #516 | High | Codex; Fable confirmed | receipt protections were checked before the run and the lock, not at mutation: a delayed same-id record overwrote a settled receipt, and discard deleted an edited genuine RED | `scripts/tdd/red-receipt.mjs` | fixed `e990ed93` (receipts ADR0125-FIX1-WI-3, -5, -9) |
| F517-1 | #517 | High | Codex; Fable confirmed | Recover's early row removal let the new body-open focus fallback focus the outgoing tab while placement awaited `get_draft`, so the first key edited the wrong document | `src/components/common/RecoveryDialog.tsx`, `src/utils/focusActiveEditor.ts`, `src/App.tsx:443-455` | fixed `699086e0` (receipts D291-WI-4, -WI-5) |
| F514-1 | #514 | High | Codex; Fable confirmed (rated Medium on reachability: no emitter of `editor.paragraph.table` yet) | the Insert Table menu adapter dropped the insertion result, so a failed insert inside a table closed the modal as a success | `src/utils/editorMenuCommands.ts:126` | fixed `f9845e90` (receipt M3-WI-15) |
| F508-1 | #508 | High | Codex; Fable confirmed | a late or stale settings read/write overrides a newer confirmed value (1a: timeout rollback after a late success; 1b: an older read applied after newer writes) | `src/components/common/settings/settingsWriterRegistry.ts`; r5 remainder `AdvancedSettings.tsx:50-53`, `loggingService.ts:138-141` | 1a fixed `aecb0165`; 1b partial, deferred D293 (user: 「Land now, defer as a D item」) |
| F508-2 | #508 | High | Codex; Fable confirmed | a remounted Image page's queued write resets sibling leaves to defaults | `settingsWriterRegistry.ts`, Image settings page | fixed `aecb0165` |
| F508-3 | #508 | High | Codex; Fable confirmed | a whole-group write from one window overwrites another window's newer save | `settingsWriterRegistry.ts`, `src-tauri/src/commands/preferences.rs` | fixed `aecb0165` |

## Fresh-context cost

The first ten audit requests after ADR-0131 (2026-10-22), one row each: how long a fresh-context request costs. Codex rows take tokens from the session's final usage line; Fable rows from the subagent's usage.

| # | Date | Item · round | Auditor | Reset check (session id changed?) | Duration | Input tokens | Cached | Output |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-10-22 | ADR-0132 r1 | gpt-auditor | yes (`01a16248…` → `01a1624b…`) | 289 s | not captured | not captured | not captured |
| 2 | 2026-10-22 | ADR-0132 r2 | gpt-auditor | yes (`01a16251…` → `01a16256…`) | 143 s | not captured | not captured | not captured |
| 3 | 2026-10-22 | ADR-0132 r3 | gpt-auditor | yes (→ `01a1625a…`) | 101 s | not captured | not captured | not captured |

Token counts were not captured for rows 1–3: the Codex pane shows only a context percentage. From row 4 on, read the session's final usage with `/status` before the next reset.

| 4 | 2026-10-22 | ADR-0133 r1 | gpt-auditor | new pane (ADR-0133: argv flags + `Context 0% used`) | 193 s | 980,536 | 883,456 | 4,214 |
| 5 | 2026-10-22 | ADR-0133 r1 | Opus (plan mode) | fresh subagent | 107 s | 79,691 total | — | — |
| 6 | 2026-10-22 | ADR-0133 r2 | gpt-auditor | new pane | 269 s | 1,541,219 | 1,419,008 | 5,181 |
| 7 | 2026-10-22 | ADR-0133 r2 | Opus (plan mode) | fresh subagent | 94 s | 74,655 total | — | — |
| 8 | 2026-10-22 | ADR-0133 r3 | gpt-auditor | new pane | 106 s | 667,395 | 572,928 | 2,990 |
| 9 | 2026-10-22 | ADR-0133 r3 | Opus (plan mode) | fresh subagent | 32 s | 62,447 total | — | — |
| 10 | 2026-10-22 | D258 r1 (PR #526) | gpt-auditor | new pane | 260 s | 1,420,288 | 1,282,304 | 6,280 |

From row 4 on, Codex rows come from the request's own rollout in `~/.codex/sessions` (one process per request since ADR-0133), and Opus rows from the subagent's reported total. The ten rows are complete.
