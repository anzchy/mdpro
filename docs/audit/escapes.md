# Escapes

Every defect found on a device, or after landing, in code that had passed an
audit ([ADR-0121](../adr/0121-audit-effort-follows-risk-pre-existing-findings-do-not-block-and-auditors-are-measured.md)
Decision 6). The delegator is the only writer. A device record that shows a
FAIL in landed, audited code adds its escape row **in the same commit**
(issue #542 item 5; user, 2026-10-27: 「建议1-7 均采纳」). A row whose fault has
no `file:line` yet waits until its D item is root-caused.

This is the replay set. Before an auditor's model, its agent definition or its
request template changes, the current and the proposed auditor both run on
each escape's audited range at its pre-fix SHA, with the fix and every later
report withheld. An escape counts as caught when a finding names the same file
and the same fault. Below five rows the result is "insufficient evidence", and
the user decides without the numbers.

- **Audited range**: `base..head` as audited, from `audit-log.md`.
- **Found**: device record, user report or a later audit, with date.
- **Fault**: file:line and one sentence. It is what a replay must name to count as caught.
- **Fix**: the D row whose fix confirms the defect.

| # | Audited range | PR | Found | Fault | Fix (D row) |
|---|---|---|---|---|---|
| 1 | `80e5f21c` → base `b036483c` (rebased `d1816eea`, r1) → `87d1e290` (r2) | #519 (D299) | B1 device record, 2026-10-23 (`docs/test/20261023-b1-save-drafts-recovery-device-check.md:17`, `:64-69`, build `ed958b26`) | `src-tauri/src/services/draft/protection.rs:37-56` @ `87d1e290`: `preserve_if_protected_locked`, new in this PR, moves a protected bundle to a fresh id on a same-id autosave. The Recovery row already on screen keeps the old id, so Recover opens the new autosave instead of the draft the row showed (no data loss) | D315 (registered, unfixed) |
| 2 | `1eaa443d..dd2312db` (PR #503's base and final head, from GitHub; corrected 2026-10-27: the earlier `e56bb37b..c3b94cc6` named a head no longer in the repository), audited up to `527579af` (r1) → fix `527579af..dd2312db` (r2); before audit-log.md | #503 (D261-WI-1) | B5c device record, 2026-10-24 (`docs/test/20261024-b5c-menu-focus-device-check.md:13`, `:44`, `:78-95`: Highlight in A then ⌘\` at once ran in B, 2/2) | `src-tauri/src/menu_target.rs:272` @ `dd2312db`: `route` resolves the target from `focus.snapshot()` when the menu event reaches Rust. macOS delivers the item's action about 250 ms after mouse-up, so a window switch inside that gap sends the action to the newly focused window | D319 (Fix 1+2 #533 `9b9cd404`; final Fix 3 #539 `32fa5b96`) |
| 3 | `3d38bf69..ec39e41e` → fix 1 `8d737903` (rebased `583b5842..f6d4f5cd`) → fix 2, rebased `11c9268c..9b9cd404` | #533 (D319 Fix 1+2) | B8 device record, 2026-10-25 (`docs/test/20261025-b8-editor-dialog-menu-device-check.md:16`, `:35`, `:63`: 0 ms race, Highlight 4/4 and Save 2/2 acted in B, no `via:"click_time"`) | `src-tauri/src/menu_capture_state.rs:187-201` @ `9b9cd404`: `end_native_menu` drops `native_session` and `tracking_snapshot` when the last menu closes. AppKit posts DidEndTracking before the item's WillSendAction; ⌘\` then rebuilds the menu, and the late WillSend finds no session, so dispatch falls back to `via:"focused"` (B) | D319 Fix 3, #539 `32fa5b96` (device PASS `docs/test/20261025-b8b-b8c-d319-menu-race-device-check.md`) |
| 4 | `a2386d69..61f89626` (r1) → `c29b7710` (r2) → post-cap `371e2117`, landed `04250e47..17fc6517` | #545 (ADR-0141 WI-2) | picsee-delegator's audit of picsee's port, 2026-10-28, reproduced by herdr-delegator in a temp HOME (batch `repro\vbatch`: `acquire` succeeds, the holder's `release` is refused) | `.agents/skills/mdpro-delegator/scripts/gui-lock.sh:28-30` @ `17fc6517`: `valid_text` rejects only `\n`, `\r` and `\0`, while `read_owner` (`:59`) splits with `str.splitlines()`, which also splits on `\v`, `\f`, `\x1c`–`\x1e`, `\x85`, U+2028 and U+2029; an owner written with one of these parses as malformed, so the holder cannot release and the lock stays held (fails closed) | [D333](../plans/20260912-frontend-backend-sequencing-order.md#d333) |

Held: D314 (B1, Source first key lost after Recovery, 2 of 3) is a candidate. Its introducing range (#517, #519 or
#520) and its fault are not established; it gets a row once D314 is root-caused. Backfilled 2026-10-27 from the device
records B1–B11 by herdr-delegator.

Ruled not escapes in that backfill:
- **Landed before audits began (2026-10-12):** D290 (D107 code), D317 (`EncodingDialog.tsx`, D140), and D155's
  typing step.
- **Pre-existing behaviour that the audited PR did not introduce:**
  - D299: `close_document` deletes by id, a function the PR never touched;
  - D300: master lost that key every time, and D291 only narrowed it;
  - D292, D295 and D297: long-standing; D292's and D295's origin was not traced.
- **A spec gap:** D318. M3b used the preset list command exactly as the menu plan specifies.
- **Caught at Low by the audit,** then narrowed on purpose (Amendment 1): D320, PR #524 Fable L1.
- **Found by the audit, then landed open by ruling:** D313.
- **Not reproduced:** D296 (Minimize present in B6b), D321 (0/5 in B10).
- **Tooling, not product:** D316 (tests write to the real log), D322 (dev builds without a release id).
- **Harmless log noise:** D287.
