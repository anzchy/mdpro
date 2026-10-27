# D323 plan: model-based and property tests for races and lifecycles

opus-imple-1, 2026-10-27. Prep only. Brief: `D323-plan-brief.md`. Written at `origin/master` **`8501affd`**.
Every `file:line` below is at that SHA.
**Rulings folded in** (2026-10-27, `D323-plan-rulings.md`; § 8). `origin/master` has since moved to
`475422c6`, and `git diff --name-only 8501affd 475422c6` touches only `docs/` and `.claude/`, so every
`src/`, `src-tauri/` and `tests/` reference still holds. **Status: approved by plan review** (2026-10-27). gpt-auditor and opus-auditor, two rounds (ADR-0143); the Highs
still open after the cap (X3, X6, H2) were fixed under the user's ruling 「Fix + scoped confirm (Recommended)」 and
every raiser marked them CLOSED. Review records: `~/.mdpro-redesign/herdr-spike/{gpt,opus}-auditor/D323-plan-*.md`.
WIs are granted one at a time when a slot frees.
**Fix 1 folded in** (2026-10-27, `D323-plan-fix1-brief.md`; merged verdict `delegator/D323-plan-r1-verdict.md`).
X1–X7 and the Mediums are answered in **§ 11**, which maps each to the section it changed. `origin/master` is now
`da9456d8`; `git diff --name-only 8501affd da9456d8` still lists only `docs/` and `.claude/` paths, so the code
references hold. Fix-1 references at other SHAs name the SHA.
**Fix 2 folded in** (2026-10-27, `D323-plan-fix2-brief.md`; post-cap, ADR-0129 「Fix + scoped confirm
(Recommended)」). It closes X3 (both halves), X6 and opus H2, and applies Q11 as re-ruled (path (a), the
overlay). **§ 12** maps each to the section it changed. `origin/master` is now `54cd49e6`, and
`git diff --name-only 8501affd 54cd49e6` still lists only `docs/` and `.claude/` paths.

Row: `docs/plans/20260912-frontend-backend-sequencing-order.md:761` (D323). Issue #542 item 4. Evidence:
`docs/knowledge/20261027-acceptance-mechanism-vs-pstack.md` § 建议 4.

---

## 0. Summary

- **Four models**, one per area. Each is written from the ADR, plan or defect text, never from the
  code. Each comes with a property test that generates event interleavings and drives the **real**
  stores, hooks and Rust services, with only the IPC boundary faked. The test then compares the
  observable effects against the model.
- **Interleavings come from a held-IPC scheduler.** Each `invoke` the code makes is held until the
  generated trace releases it. The trace decides what happens during each `await`: a close, a
  reopen, an edit, an external change, or another IPC reply.
- **Tooling: no new dependency** (§ 4). The repo already does seeded generation by hand
  (`tests/support/seededRandom.ts:2-3`: "The repo does not use fast-check by design"). The plan adds a
  small harness: a bounded exhaustive enumerator, a seeded walk and a drop-one minimizer, in TS and
  in Rust. This is a decision not to take a dependency, with two options weighed, so it gets an ADR
  (WI-0).
- **Each model must fail on a real past defect** (§ 6). For each area, a retro-check runs the
  property against the pre-fix SHA, and it must fail with the defect's trace:
  - save: `69ba3a09`, D290 round 1, and `4775f410`, D290 round 3 H4;
  - close: `527579af`, D261 H1 (the real two-close trace, § 6);
  - drafts: `cfd2e7c5`, D305;
  - routing: `9b9cd404`, D319 B8;
  - menu token, frontend: `a118914f`, D261 ③ (the parent of the guard commit `124311c1`).
- **9 WIs, all High tier** (§ 7). Default-lane slices stay under 2 s per file. The exhaustive sweeps
  go in `*.slow.test.ts` (ADR-0050).

---

## 1. Inventory (AC-1)

Notation: **S** = state, **E** = event, **A** = an `await` where another event can arrive, followed
by the guard that runs after it. "—" means no guard runs.

### 1.1 Save lifecycle (frontend; Rust `save_file` is the boundary)

**States**
- **S-clean / S-dirty.** `Document.isModified` plus the baseline `savedContent`. When
  `savedContent === undefined`, the document stays dirty until its next clean point
  (`src/stores/documentStore.ts:29-36`). Dirty is recomputed on every edit (`:172-177`).
- **S-queued / S-saving.** A module-level `saveQueues` map of promise tails, keyed by id
  (`src/services/documentSave.ts:65`). It removes its own entry when the tail settles (`:107-109`).
  No store field marks "saving".
- **Generations** (`src/stores/baselineEpoch.ts:34-45`):
  - `baselineGeneration`: window-wide, only grows.
  - `baselineEpoch[id]` and `baselinePathEpoch[path]`: stamped by `dropBaseline`
    (`documentStore.ts:184-190`), by `closeDocument` (`:254`) and by path moves (`:169,:193,:202`).
  - `lifetimeEpoch[id]`: advances on open (`:165`) and close (`:255`).
  - `replacementEpoch[id]`: advances on an in-place upsert (`:170`; `baselineEpoch.ts:61-66`).
    `applySaveResult`'s own upsert also bumps it (`saveService.ts:269,273` → `documentStore.ts:170`).
- **S-external-pending / S-ignored-deletion.** `externalChangeStore.pending` and `ignoredDeletions`
  (`src/stores/externalChangeStore.ts:92-98`). Ignore on a deleted slot sets the marker
  (`:243-244`). A new event (`:163-165`), a path change or a close (`pruneAgainst`, `:285-300`)
  clears it.
- **S-awaiting-recreate-choice.** React state `recreateRequest` (`src/App.tsx:409,416-419`).

**Events**
- **⌘S.** `handleSave` (`App.tsx:796`) → `performSave` (`saveService.ts:102-118`) →
  `saveActiveDocument` (`documentSave.ts:233-237`) → `runSerializedSave` (`:86-111`) →
  `saveDocumentNow` (`:169`) → `fileService.saveFile` → `invoke("save_file")`
  (`src/services/fileService.ts:86-95`).
- **Menu Save / Save As.** Token-checked at entry only: `saveIfCurrent` (`App.tsx:814-815`;
  `src/utils/menuTargetToken.ts:129-142`).
- **Save As.** `saveDocumentAsNow` (`documentSave.ts:127`) → `invoke("save_file_dialog")`
  (`fileService.ts:110`). An untitled Save falls through to it (`documentSave.ts:172-173`).
- **D290 recreate choice.** `performRecreateChoice` → `saveAfterIgnoredDeletionChoice`
  (`saveService.ts:121`; `documentSave.ts:247-262`).
- **Restart batch save.** `prepareForRelaunch` (`src/hooks/useUpdater.ts:28,123`). It calls
  `saveFile` directly: no queue, no `applySaveResult`.
- **Other events.** Edit (`updateContent`); close (`closeDocument`); reopen or reload (`upsert`);
  `file:changed` modified or deleted (`recordFileChange`); Ignore (`acknowledgeFileChange`).

**Awaits and their guards**

| # | Await | What can arrive during it | Guard after it |
|---|---|---|---|
| A1 | queue tail, `documentSave.ts:101` | close, edit, switch, external event, a second ⌘S | `flushDocumentForSave` returns null for a closed document → `staleSave("closed")` (`:170-171`); the id is captured before the wait (`:234`) |
| A2 | `getPreferences`, `:184` (awaits only when `isTauri()`, `preferencesService.ts:143-149`) | close, close+reopen, path move, reload, edit, external modified/deleted, Ignore | closed `:203`, path `:204`, reloaded `:205`, reopened `:206`, pending change → `ExternalChangePendingError` `:209`, ignored deletion without consent → `RecreateChoiceRequiredError` `:210-213`, stale consent `:214-215` |
| A3 | `save_file`, `:217` | edit, close, close+reopen, reload, external event | no lifetime re-check; `applySaveResult` instead: settle flush (`saveService.ts:237`), `resolveSaveResult`, `baselineMovedSince` → demoted to dirty (`:256-265`), closed → no store write (`:276-278`) |
| A4 | `save_file_dialog`, `:136` | same as A2 | closed, path, reopened, reloaded (`:152-157`), then `applySaveResult` (`:158`) |
| A5 | relaunch loop `saveFile`, `useUpdater.ts:123` | edit, close, reload | guard (`:105`), closed / path / `baselineMovedSince` / content equality (`:113-114`); **no** lifetime or replacement check |

**After the IPC returns**
- **applied:** the document goes clean with `savedContent` set to the written text, and its draft
  is deleted (`saveService.ts:268-271`).
- **edited-during-save:** the document stays dirty and its draft is kept (`:272-275`).
- **demoted:** `isModified:true`, `savedContent:undefined` (`:262`).
- **failure:** a toast reads `Save failed: …` (`:115-116`), the store is untouched and the queue
  settles (`documentSave.ts:102-105`).

### 1.2 Close lifecycle

**Frontend states**
- **Tab clean / dirty:** as in § 1.1.
- **Tab-X prompt pending:** local `pendingCloseId` (`src/components/BottomTabs/BottomTabs.tsx:39`).
- **⌘W prompt pending:** `pendingClose="document"`, `closeTargetRef`, `closeTokenRef`
  (`App.tsx:748-753`).
- **Close commit in flight:** stored nowhere. It exists only as `start` captured at
  `src/hooks/documentCloseCommit.ts:38`, around the await at `:39`.
- **Window close** (`src/hooks/useWindowCloseGuard.ts`): `pendingClose(Ref)` (84-91), `latchRef`
  (`CloseLatch`, 98; type at `windowCloseAttempt.ts:60`), `consentRef` (100), `attemptRef` (103),
  `stagePendingRef` (104), `beganEmptyRef` (105).
- **Prompt choice:** quit outranks close (`src/utils/quitDialogModel.ts`).
- **Quit, frontend** (`src/hooks/useQuitGuard.ts:104-117`): `promptEventRef`, `highestRef`,
  `checkedRef`, `answeredRef`, `snapshotRef`, `backstoppedRef`.

**Rust state.** `QuitCoordinator {last_request_id, request}`
(`src-tauri/src/services/quit_guard/coordinator.rs:67-70`). `Request` carries `id`, `round`,
`recheck_due`, `fallback`, `deadline_ms` and `backstop` (`request.rs:77-96`). The per-window status
is Pending, Queued, Prompted, Deciding, Settled, Drafting or Gone (`request.rs:33-55`), and the
whole machine sits behind `QuitGuard{inner:Mutex}` (`driver.rs:86-87`).

**Events**
- **Tab X.** `handleClose` (`BottomTabs.tsx:41`) → `closeTabById` (`App.tsx:171`) →
  `closeDocumentById` (`src/hooks/useDocument.ts:265`) → `commitDocumentClose`, then
  `closeWindowIfEmptied` (`src/utils/lastTabClose.ts:65`).
- **⌘W.** `handleCloseRequest` (`App.tsx:747`). Confirm runs `handleConfirmClose` (`:709`) →
  `confirmDocumentClose` (`menuTargetToken.ts:110`).
- **Window close.** `onCloseRequested` (`useWindowCloseGuard.ts:139`). Discard is `confirmClose`
  (`:241`), Cancel is `cancelClose` (`:312`), and `requestWindowClose` (`:330`) goes through
  `requestGuardedClose` (`windowCloseAttempt.ts:180`).
- **Rust `close_document`.** `src-tauri/src/commands/file.rs:1836`. It refuses when
  `discard_changes` is false; otherwise it removes the shadow and calls `discard_and_close`
  (`:1813-1814`).
- **Quit, frontend.** `handleRequested` (146, synchronous), `handlePrompt` (156), `handleCancelled`
  (178), `handleBackstop` (188), `confirmQuit` (209), `cancelQuit` (228).
- **Quit, Rust.** `begin` (`coordinator.rs:78`), `on_answer_in` (116), `on_tick` (156),
  `on_window_gone` (193), `start_recheck` (`rounds.rs:129`), `start_backstop` (`backstop.rs:34`).

**Awaits and their guards**

| # | Await | What can arrive during it | Guard after it |
|---|---|---|---|
| C1 | `close_document` IPC, `documentCloseCommit.ts:39` | reopen of the same id, a failed save (`dropBaseline`), an edit | `baselineMovedSince(id,start)` refuses (`:40`); an edit in the same lifetime is discarded by design (`tests/d261-close-commit-stale.test.tsx:178`) |
| C2 | the user on the ⌘W prompt | edit, switch, reopen | token checked once, in `confirmDocumentClose` (`menuTargetToken.ts:113`); an edit is still discarded (`tests/d261-close-confirm-stale.test.tsx:133`) |
| C3 | the user on the tab-X prompt | edit, external reopen of the same file (`file:open-in-window`) | **—** (`BottomTabs.tsx:50-55`: `onClose(pendingCloseId, true)`, no re-check across the prompt; C1 covers only the IPC window) |
| C4 | window `saveWindowState`, `useWindowCloseGuard.ts:181/247` | edit, a second close request, cancel | attempt generation (`:182/:248`), re-decide (`:186`) |
| C5 | `stageSecondaryClose`, `:192/:257` | as C4 | `isCurrent` / `isSafe` (`windowCloseAttempt.ts:150-158`) |
| C6 | Discard: `suspendAndDrainDrafts` `:246` → … → `deleteDiscardedDrafts` `:288` → `close()` `:301` | draft write, edit, re-prompt or cancel | `stillConsented()` before and after each delete (`draftDiscardService.ts:8,24`); latched pass `consentCovers` (`windowCloseAttempt.ts:94-103`) |
| C7 | quit, frontend | — | phase 1 is synchronous by design (`useQuitGuard.ts` header 19-21); the backstop latches before its await (191-192); `isStaleRound` (140-143) |
| C8 | quit, Rust | every window's answer | a re-check round before commit (ADR-0035 decision 1) |

**A close during a save** (D290 H1). If the close lands in A2, the save becomes
`staleSave("closed"|"reopened")` (`documentSave.ts:203-206`). If it lands in A3, `applySaveResult`
treats it as `closedDuringSave`: no store write and no resurrection; a close followed by a reopen
demotes the save. In the reverse order, a save that fails during C1 refuses the close
(`documentCloseCommit.ts:15-17`).

### 1.3 Drafts

**States: Rust, the authority**
- **Bundle.** `DraftBundle{revision, owner, claim, claim_consumed, recovered,…}`
  (`src-tauri/src/services/draft/mod.rs:85-101`), with `DraftOwner`, `DraftClaimToken` and
  `DraftSaveResult{revision, save_order}` (`types.rs:67-73,111,122`).
- **Absent:** `OwnedDeleteOutcome::Absent` (`protection.rs:209`).
- **Written at revision r.** Each save makes a fresh UUID revision (`mod.rs:194`) and a global
  `save_order` taken under the lock (`:41,:188`). It resets `claim` and `recovered`
  (`:198-203`).
- **Claimed.** On recover: `recovered=true`, `owner=caller`, `claim=Some`, `claim_consumed=false`
  (`guarded.rs:133-143`).
- **Consumed.** A save that carries the token sets it once the destination is durable
  (`mod.rs:210-225`).
- **Own vs Protected.** Defined at `protection.rs:31-34`. A Protected bundle is moved to a fresh id
  before any un-tokened write or delete (`:38-48`; legacy pairs `:63-121`).
- **In-use refusal.** `OwnedByLiveWindow`, `OpenInWindow`, `ShadowStoreUnavailable`
  (`types.rs:25-29`; `guarded.rs:60-77`).
- **Locks.** One `DRAFT_LOCK` (`lock.rs:19-24`), a `std::sync::Mutex`: mutual exclusion, **no FIFO
  guarantee** between waiting command tasks. `save_order` is taken only after the lock is acquired
  (`mod.rs:187-188`), and `save_draft` is an `async` command (`commands/draft.rs:104-105`), so two
  writes of one id can take the lock in either order. The same lock is taken by `delete_draft`
  (`protection.rs:258`), guarded recover (`guarded.rs:110`), guarded discard (`guarded.rs:204`) and
  cleanup (`live_listing.rs:206`). The order is gate → lock → shadow (`lock.rs:8`).
  The quit gate's read guard covers the whole write (`quit_guard/mod.rs:100-109`;
  `commands/draft.rs:93`).

**States: frontend.** Module maps `pending`, `suspended` and
`revisions{revision, saveOrder}` (`src/services/draftWriteCoordinator.ts:2-4`). Placement uses
`useDocumentStore` (`src/utils/recoverIntoOpenTab.ts:259,292`).

**Events**
- **Timer save.** `useAutoSave.ts:17-35`: 30 s by default (`editorStore.ts:235`), 5 s minimum
  (`:16`). Rust side: `commands/draft.rs:105` → `save_draft_as_with_token` (`mod.rs:172`).
- **Recover.** `draft_recovery.rs:259` → `guarded.rs:104-182`. Frontend: `draftService.ts:113`,
  then `recoverIntoOpenTab.ts:239-325`.
- **Delete with optional token.** `commands/draft.rs:238` → `protection.rs:251-311`. Callers: after
  a save (`saveService.ts:163`), the legacy rekey (`recoverIntoOpenTab.ts:165`, un-tokened), and a
  claimed delete (`:312`).
- **Tab Don't Save.** `close_document` → `discard_and_close` (`commands/file.rs:1813-1814`): the
  ordinary delete, **with no revision fence**.
- **Window Discard (D305).** `useWindowCloseGuard.ts:243-305` → `draftDiscardService.ts:6-27` →
  `delete_discarded_draft` (`commands/draft.rs:247`) → `delete_draft_owned`
  (`protection.rs:154-239`).
- **Recovery-dialog Discard.** `guarded.rs:197-230`, an explicit delete.
- **Quit backstop.** `quitDraftBackstop.ts:81-125`: a plain `invoke("save_draft")`, not tracked by
  the coordinator. The commit's delete of discarded ids is at `quit_guard/driver_commit.rs:46-56,80-90`.
- **Age cleanup.** `live_listing.rs:203-238`: recovered, older than 7 days (`:34`), not in use.

**Awaits and their guards**

| # | Await | What can arrive during it | Guard after it |
|---|---|---|---|
| R1 | autosave `save_draft` reply | a second write, Discard, close | suspension checked at `useAutoSave.ts:22` and synchronously at `draftWriteCoordinator.ts:25`; an out-of-order reply is ignored unless `order >= current.saveOrder` (`:35`) |
| R2 | window Discard chain (= C6) | a draft write mid-batch, an edit | Rust reads owner and revision after taking the lock (`protection.rs:207-223`); a `stale` reply stops the batch (`draftDiscardService.ts:15-17`) |
| R3 | `recover_draft` IPC | the target closes, gets edited or is replaced | the store is re-read (`recoverIntoOpenTab.ts:259,262-265`) |
| R4 | `checkDraftUnder`, `:252` | another draft lands under the target id | re-read |
| R5 | `writeClaimed`, `:301` | target identity changes | falls back to a fresh id (`:302-310`) |
| R6 | tab Don't Save `close_document` vs an autosave already sent | the write lands after the delete | **— on the frontend**; Rust serializes on `DRAFT_LOCK` but has no fence ordering this delete before that write (hypothesis H-R6, § 3.3) |

### 1.4 Menu target routing

**States: Rust.** All of these live in `FocusState` behind the `MenuFocus` mutex
(`src-tauri/src/menu_capture_state.rs:31-52`).
- **Focus.** `focused` and `last_focused` (`:32-33`). `apply` (`:82-90`) sets them, and `forget`
  (`:93-101`) clears them.
- **Tracking.** `NativeSession{tree, open_menus, selected, generation}`
  (`src-tauri/src/menu_target_native_session.rs:66-71`), plus `tracking_snapshot`
  (`menu_capture_state.rs:35`, set by `begin_state` at `:123-130`).
- **Ended, unclaimed (Fix 3).** `EndedSession{tree, snapshot, generation}`
  (`native_session.rs:76-80`), created at `:174-183` only when `!selected`.
- **Claimed.** `pending` (`menu_capture_state.rs:36`), set at `native_session.rs:280` or by
  `queue_action` (`menu_capture_state.rs:166`).
- **Consumed.** `take_capture` (`:252-260`).
- **Expired / superseded.** These are transitions, not stored states: `native_session.rs:130-133`
  and `:225-227`.

**Events**
- **AppKit Begin.** `begin_native_menu` (`native_session.rs:113`). A menu outside the tree is
  ignored (`:117-120`). A restart (`:123-128`) expires the ended session (`:130-133`) and then
  takes the snapshot (`:145`).
- **AppKit End.** `end_native_menu` (`:160`). An unselected session is retained as ended
  (`:174-183`).
- **AppKit WillSend(item).** `native_will_send` (`:203`):
  - an item in the current tree drops an active session on another tree as `tree_replaced`
    (`:215-224`), and drops the ended session as `superseded` (`:225-227`);
  - lookup goes current, then active, then ended (`:229-243`);
  - `unmapped` (`:253-256`); `already_selected` (`:258-261`);
  - an ended-tree item takes the Begin snapshot, once (`:265-270`); otherwise the tracking
    snapshot or the arrival focus (`:271-274`).
- **Focus change.** `main.rs:504-511` → `on_focus_event` (`services/window_focus.rs:52`) →
  `apply`, then `refresh_menu_for_focus` (`menu_availability.rs:203-216`, a rebuild).
- **Muda event.** `handle_menu_event` (`menu.rs:342`) → `emit_menu_action` (`:124`) →
  `route_for_event` (`:166`) → `route_selected` (`menu_target.rs:243`).
  - A dead captured owner cancels a Window-class action (`no_focused_window`), and sends an
    App-class one to the live `last_focused` (`:274-280`).
  - `resolve_target` (`:112-127`); `dispatch` (`:149-175`) makes one `emit_to` (`menu.rs:146`).
- **Shortcut.** A WillSend for a current-tree item with no Begin (`native_session.rs:225,274`).
- **Window destroyed.** `forget_window` (`menu_target.rs:49-56`, from `main.rs:382-390`).

**Frontend.** `getCurrentWindow().listen` (`src/hooks/useMenuEvents.ts:82`) drops
`target !== label` as `wrong_target` (`:106-107`). It then calls `captureToken` synchronously
(`:111`), with the token `{windowLabel, documentId, generation}` (`menuTargetToken.ts:46-68`;
`src/stores/editorGeneration.ts:33-44`).

**Awaits and gaps, frontend**

| # | Gap | What can arrive during it | Guard after it |
|---|---|---|---|
| M1 | Insert Table modal (`src/utils/tableInsertTrigger.ts:40`) | switch, editor remount | `abandonIfStale("table_submit")` `:48` |
| M2 | Highlight render tick (`App.tsx:820-822`) | switch | `MilkdownEditor.tsx:238`, `Editor.tsx:196` |
| M3 | ⌘W confirm (= C2) | switch | `menuTargetToken.ts:113`; the window-close branch (`App.tsx:732-734`) takes no token |
| M4 | Save / Save As | switch | checked at entry only (`menuTargetToken.ts:135`), then `await run()` on the captured id |

**Awaits in the Rust and AppKit order.** These are not `await`s but delivery gaps: between Begin
and WillSend (B8: End → focus B → rebuild → WillSend), and between WillSend and the Muda event.

---

## 2. Invariants (AC-2)

Each invariant is written against observable effects: IPC calls made, the boundary fake's disk,
store fields a user sees (`isModified`, content, open tabs), and `emit_to` targets. The source
column is what the model encodes.

### Save (S)

| Id | Invariant | Source |
|---|---|---|
| S1 | A document whose lifetime ended (closed, or closed and reopened) after a save started never has that save's `save_file` issued. | D290 audit round 1 H1 ("a close while a save awaited"), row `:727`; rule 60 (no save fires after close) |
| S2 | No `save_file` is issued to a path with an unanswered or Ignored `deleted` change unless the user chose "save to the original path" for that exact change. | D290 row `:727` (ask before recreating; Ignore does not consent) |
| S3 | No `save_file` is issued while an external change for that document is pending. | D171 (`documentSave.ts:207-208` comment cites it; row D171) |
| S4 | At most one `save_file` is in flight per document id, and saves of one id run in request order. | D70 (`tests/save-serialized-per-document.test.tsx`) |
| S5 | A document reads clean only when its content equals the bytes most recently written for its **current** lifetime and replacement. A reload or edit during the save leaves it dirty, or clean only against the reloaded baseline. | D214 baseline epochs; D290 round 3 H4 (`f3488d0c`) |
| S6 | A failed `save_file` leaves the document dirty with its content unchanged, and produces exactly one user-visible failure. | rule 60 § Data loss ("surface write errors") |
| S7 | A save never writes text older than the text it was asked to save, and never writes to a stale path. | D214 path-move; `documentSave.ts:204` |
| S8 | A Save requested before an in-place **replacement** of the document never issues its `save_file`, even when the user types after the replacement, and even when the replacement has identical text. A replacement is a Reload of the open file, or a draft recovered into the open tab. | D290 row `:727` H4: 「重载（包括内容相同但元数据更新）后继续输入，等待偏好返回的旧保存取消且不写盘；打开文件重载及草稿并入现有标签共用替换代次」 (added in fix 1, X4) |

### Close (C)

| Id | Invariant | Source |
|---|---|---|
| C1 | Dirty content is never discarded unless the user gave Discard for that document's current lifetime. | rule 60 § Data loss; D261 H1 |
| C2 | A close reply never removes a later lifetime of the same id, whether it was reopened during the close IPC or during the prompt. **On the tab × prompt, Confirm after a same-id close-and-reopen is a no-op on the newer lifetime.** | D261 H1, fix `dd2312db`; user ruling on Q2, 「Cancel as stale (Recommended)」 (2026-10-27); today's code is D324 |
| C3 | A closed document receives no save, no draft write and no MCP write after its close commit. | rule 60 § Race conditions (auto-save after close); D290 H1; D305 |
| C4 | A window Discard closes the window only if consent still covers every dirty document at the moment of the close, and otherwise leaves it open. | D253 (consent), D305 row `:743` |
| C5 | Quit commits only after every live window answered the latest round, and each window is re-prompted at most once per quit request. | ADR-0035 decisions 1–3 (Rust; already exercised by `coordinator_*props*` tests, § 3.2) |

### Drafts (D)

| Id | Invariant | Source |
|---|---|---|
| D1a | A document's draft on disk is never replaced by text from an **older editor snapshot** than the text it holds. Snapshot age is the order of the `DraftTick` / `QuitBackstop` events that read the text, not the order the writes took the lock. | rule 60 § Data loss: "Draft recovery … does not overwrite a newer version with an older draft" (split out in fix 1, X2) |
| D1b | The frontend's record of a document's draft is the newest disk write by save order, whatever order the replies arrive in. | ADR-0127 decision 4; D305 "uses the last disk write when autosave responses settle in reverse order" |
| D2 | A Protected bundle (another session's, unowned, or holding an unconsumed claim) is never overwritten or deleted in place by an operation without its claim. It is moved instead, at most once per session. The two explicit exceptions are guarded Discard and age cleanup. | ADR-0127 decision 4 (`:84,:104-123`) |
| D3 | A window Discard deletes only drafts owned by that window whose revision is the one agreed when consent was given. A newer write by the same window survives, stops the remaining deletes and keeps the window open. | D305 row `:743`; fix 2 `198f013c` |
| D4 | After a window Discard completes with no later write, no draft remains for any document it discarded, so next launch's Recovery does not offer it. | D305 row `:743` |
| D5 | A stale or foreign claim token writes the destination but deletes nothing at the source id. | ADR-0127 `:104-106` |
| D6 | Recover places into the calling window's target only if the target is still the same lifetime and clean; otherwise into a fresh id. Text is durable under the destination before the source is deleted. | ADR-0127 decision 1 |

**D1a and D1b can disagree** when two writes of one id take `DRAFT_LOCK` in reverse order (§ 1.3
Locks): D1b then holds and D1a fails. **D1a governs** (ruling Q10, 2026-10-27: it is the rule 60
data-loss line), so a reproduction on the real frontend is a live bug under ruling Q3.
**D1a is a frontend issuance property** (fix 2, opus H2). The Rust service cannot hold it by
construction: `save_draft` takes `document_id, content, original_path, title, claim_token` and no
snapshot age, sequence or base revision (`commands/draft.rs:104-111`), and the service writes whatever
`content` reaches the lock (`services/draft/mod.rs:186-200`). Whether two writes of one id are ever in
flight together is decided by what the frontend issues, so D1a is proved in WI-4 only. WI-5 checks the
service half of D1b: the last write processed under the lock is on disk, with the highest `save_order`
and a fresh revision. Making the service enforce D1a would change the `save_draft` IPC contract, which
needs its own ADR and is outside D323.

### Menu target routing (M)

| Id | Invariant | Source |
|---|---|---|
| M1 | A menu action whose item was selected in a tracking session runs only in the window that was focused at that session's Begin, whatever focus changes, rebuilds or End notifications arrive before the WillSend. | D319 row `:757` (Fix 3); D261 row `:698` |
| M2 | A shortcut (WillSend for a current-tree item with no Begin) runs in the window focused at its WillSend. | D319 row `:757` ("新菜单无 Begin 的快捷键以新选择时焦点为准") |
| M3 | Each click produces at most one `emit_to`, to exactly one window. A capture is consumed once. | D261 row `:698` (① 每次点击恰一条 `menu.action.dispatch`) |
| M4 | If the captured window is gone, a Window-class action is dropped and an App-class action goes to the live `last_focused`, then `any_live`, then nowhere. | D261 ruling (delegator, 2026-10-17), row `:698` |
| M5 | On the frontend, the final mutation of Insert Table, Highlight or close confirm runs only if the token taken at receipt still matches (window, document, editor generation). Otherwise nothing changes. | D261 row `:698` ③ |

### Progress (P): added after attack round 1, G1

The invariants above are safety properties, so a no-op implementation satisfies all of them.
Progress clauses rule that out. Each one is checked on every trace whose suffix after the event is
undisturbed. **Undisturbed** means that no close, reopen, reload, external change or **edit** to
the same document arrives before the **last** release the operation needs. For a save, that is the
`save_file` reply, not the `get_preferences` one (attack r2 N6).

| Id | Clause | Source |
|---|---|---|
| P-S | An undisturbed `Save` of a dirty, pathed document issues exactly one `save_file`, with the document's text at Save time. After an ok release the document reads clean. After an err release it stays dirty and exactly one failure toast is shown. | D70, rule 60 |
| P-C | An undisturbed `CloseTab(discard)` or `Confirm` removes exactly that tab. An undisturbed `WindowDiscard` closes the window and issues one `delete_discarded_draft` per discarded draft. **Named exception:** when the flush failed both at the prompt and at the Discard, a `Switch` between them changes the active editor's document, so the Discard re-prompts instead of closing; that is not a progress failure. | D261, D305; the exception is D253 row `:690` H3 (「flush 失败时 … consent 带上活动编辑器的 doc 对象，flush 失败时比对它」, `D253-WI-7`) |
| P-D | An undisturbed `DraftTick` on a dirty document issues exactly one `save_draft`. An undisturbed `Recover` places the text in exactly one tab, and it is durable under that tab's id. | ADR-0127 decision 1, D305 |
| P-M | Every `Muda(x)` that follows a WillSend claiming `x` yields exactly one `emit_to`. A Window-class action with a dead owner yields zero and logs `no_focused_window`. | D261 ① |

**The oracle checks equality, not containment, but only over spec-effect commands** (amended after
attack r2 N2). Commands fall into two classes, and each class assignment cites a clause:
- **Spec-effect.** These are what the ADRs and defect rows talk about: `save_file`,
  `save_file_dialog`, `save_draft` (including the claim-bearing write the plan calls
  `save_draft_claimed`, ADR-0127 decision 1), `delete_draft`, `delete_discarded_draft`,
  `close_document`, `recover_draft`, `quit_guard_reply` and `emit_to`. The multiset the SUT issued,
  with its spec arguments (id, path, text, revision, target), must **equal** the model's prediction
  after each step, and so must the **spec-effect part** of the held set. This is how G8 is enforced.
- **Mechanism.** These are calls no spec names, such as `get_preferences`, `check_draft` and
  `log_event`. The model does not predict them, so it never learns them from the code (§ 5 rule 1).
  **They are outside every equality check** (fix 1, X5): neither their count nor their order nor
  their presence in the held set is compared with anything. Three things are checked instead:
  - **Liveness.** `Release` for them is enabled from the SUT's held set, and every held mechanism
    call is either released or reported at the end of the trace.
  - **Permitted response handling.** A mechanism release answers `ok` with a per-test default (for
    `get_preferences`, the defaults with auto-reformat off). `err` is generated only where a clause
    names the behaviour on failure; none does today.
  - **Effects only through spec-effect calls.** Whatever a mechanism call changes is judged by the
    spec-effect calls and the user-visible fields that follow it.

  A mechanism call that would decide a spec effect is promoted to spec-effect, but only with a
  clause. The same rule is stated in § 4.1 and in AC-1.4b and AC-2.2b.

---

## 3. Approach per area (AC-3)

Three options were on the table:
- **(P)** a pure model plus a property test that drives the real store, hook or service at the IPC
  boundary;
- **(M)** a model-only check, which explores the model itself and never runs product code;
- **(X)** an existing test made exhaustive.

**(M) is rejected everywhere.** It proves the model consistent, not the code. The four costliest
defects were all the code departing from an intent nobody disputed.

### 3.1 Save: (P)

- **Drives** the real `documentSave` exports (`saveActiveDocument`, `saveAfterIgnoredDeletionChoice`,
  Save As), `performSave` with its injected deps (`saveService.ts:40-47`), `useDocumentStore` and
  `externalChangeStore`. It also drives `prepareForRelaunch`, as a second entry.
- **Mocks** only `@tauri-apps/api/core`, with `isTauri()` returning true so that A2 really awaits
  (`preferencesService.ts:144`), plus `@tauri-apps/api/window` and `/event`.
- **Holds three IPCs** in the scheduler: `get_preferences`, `save_file` and `save_file_dialog`. The
  pattern is `tests/support/externalChangeIpc.ts`.
- **Alphabet:**
  - `Save`, `SaveAs`, `Edit(t)`, `Close`, `Reopen`, `Reload(same|diff)`;
  - `Ext(modified|deleted)`, `Ignore`, `RecreateChoice(original|cancel)`;
  - `Release(prefs|save_file|dialog, ok|err)`.
- **Event definitions from the spec** (fix 1, X7 and opus M8). `Reopen(id)` is enabled only for a
  **closed** id and starts a new lifetime. An open of an id that is still open is `Activate(id)`:
  it changes no lifetime, because opening an already-open file only brings its tab forward
  (CLAUDE.md events table, `file:open-in-window`). `Reload(same|diff)` is the in-place replacement
  of S8.
- **Compares** against a model state of `{lifetime, replacement, content, baseline, pendingExt,
  ignoredDeletion, consent, queue}` and the multiset of `save_file` calls the model permits. Each
  name is defined in the model file's glossary from the spec (§ 5 rule 8), not from the code's
  `lifetimeEpoch` / `replacementEpoch`: a lifetime is "from an open to the close that ends it" (D261
  H1), and a replacement is the S8 event.
- **Why not (X).** `tests/d290-ignored-deletion-save-choice.test.tsx:231,273` already uses
  `it.each` over 4 and 5 hand-picked interleavings at A2. Making those exhaustive covers A2 only.
  A1, A3 and A5 and every two-event combination are what the defects lived in. The existing cases
  become pinned traces in the new default-lane file; they are not deleted.

### 3.2 Close: (P) for the frontend, (X) for the Rust quit guard

**Frontend (P)**
- **Drives** `useDocument().closeDocumentById` through `renderHook`, which reaches
  `commitDocumentClose`. It also drives `confirmDocumentClose`, and `useWindowCloseGuard` through
  `renderHook` (the `tests/d305-window-discard.test.tsx` harness).
- **Holds** `close_document`, `save_file`, `save_draft` and `delete_discarded_draft`.
- **Alphabet:**
  - `CloseTab(id, discard)`, `PromptTabX`, `ConfirmTabX`;
  - `CmdW`, `Confirm`, `Cancel`;
  - `WindowClose`, `WindowDiscard`, `WindowCancel`;
  - `Edit`, `Reopen(id)` and `Activate(id)` (defined as in § 3.1), `Save`, `DraftTick`,
    `Release(...)`;
  - `Switch(id)` and `FlushFail` (the serializer fails on the next flush), so that the Q4 switch
    trace and P-C's D253 H3 exception can be driven (fix 1, opus M1);
  - `McpWrite(id)` (the `mcp:write_document` listener) and `QuitBackstop` (the untracked
    `invoke("save_draft")`, `quitDraftBackstop.ts:81-125`), so that C3's MCP clause and its
    backstop clause can fire (attack G7).
- **Compares** against a model of open lifetimes, consent records and the boundary disk.
  Invariants C1–C4, and C3 jointly with S1.

**Rust quit guard (X)**
- `QuitCoordinator` is pure and already has property-style tests: `coordinator_props_tests.rs`,
  `coordinator_{phase2,recheck,escape,backstop}_props_tests.rs`, `driver_prop_tests.rs` and others
  under `src-tauri/src/services/quit_guard/`. They use seed loops and domain walks (for example
  `driver_escape_prop_tests.rs:84`).
- WI-8 does not rewrite them. It audits their domain against C5 and the ADR-0035 text, and extends
  the walk to the missing events (window gone mid-round, a stale-round answer, a late backstop
  reply), only where the audit shows a gap. A new model would duplicate a working one.

### 3.3 Drafts: (P) at two layers

**Rust layer (the authority for D2, D3, D5)**
- **Drives** the real draft service functions under `draft_test_home.rs` / `HOME_LOCK`:
  `save_draft_as_with_token`, `delete_draft` with an optional token, `delete_draft_owned`,
  `recover` (guarded), `discard_draft_guarded_with`, a new session, and cleanup.
- **Fake:** nothing below the service, because it writes to a temp HOME.
- **Alphabet:** `Save(window, id, text)`, `SaveTok(window, dest, token, text)`, `Delete(id, token?)`,
  `OwnedDelete(window, id, rev)`, `Recover(window, id)`, `GuardedDiscard(id)`, `NewSession`,
  `Cleanup(age)`, where window ∈ {A, B} and id ∈ {d1, d2}. The service is called in trace order, and
  trace order **is** lock order. **There is no `snap` argument** (fix 2, opus H2): the service receives
  no snapshot age (`commands/draft.rs:104-111`), so a model variable the SUT never sees cannot be an
  oracle input. Two `Save`s of one id in either order are just two writes; the model expects the
  **last one processed** to be on disk with the higher `save_order` and a fresh revision (the
  service half of D1b, `mod.rs:187-194`). Which text is newer is a frontend question (D1a, WI-4, § 2).
- **Compares** the bundles on disk against a model of `{owner, rev, save_order, claim, consumed,
  protected}` per id.

**Frontend layer (D1a, D1b, D4, D6, and C3 for drafts)**
- **Drives** `draftWriteCoordinator`, `useAutoSave` (fake timers), the Discard sequence of
  `useWindowCloseGuard`, and `recoverIntoOpenTab` against the real `useDocumentStore`.
- **Alphabet** (added after attack G4):
  - `Edit(id)`, `DraftTick(id)`;
  - `WindowClose`, `WindowDiscard`, `WindowCancel`;
  - `CloseTab(id, discard)`, `QuitBackstop`;
  - `Recover(draft)`, `CloseTarget`, `EditTarget`, `ReplaceTarget(same-id upsert)`;
  - `Release(save_draft|delete_discarded_draft|recover_draft|check_draft|save_draft_claimed, k, ok|err)`.
- **Observables:**
  - the fake's disk;
  - the arguments of every `save_draft` and `delete_discarded_draft`, including the `revision`
    each delete carries. That argument is how D1b is observed, not the coordinator's `revisions`
    map (attack G6). D1a is observed on the fake's disk: the text it holds against the snapshot
    order of the ticks;
  - the open tabs and their content.
- **Fakes** the IPC boundary with a draft-store fake written from ADR-0127 (§ 5, rule 7). The fake
  is itself a model, so it is kept minimal and cross-checked: WI-5's Rust property and WI-4's fake
  share one trace table of expected outcomes (`tests/fixtures/d323-draft-traces.json`, read by both
  sides). This is the same pattern as the contract JSON already under `tests/fixtures/`.
- **Every row of that table is hand-authored** and cites its ADR-0127 or D305 clause. The rows are
  committed in WI-4, before WI-5 runs anything. No row is ever filled in from a run of the Rust
  service or of the fake (attack G9).

**Hypothesis H-R6, to probe and not assumed.** A tab Don't Save whose `close_document` lands while
an already-sent autosave write is in flight may leave a draft for a closed document. The ordinary
`delete_draft` (`commands/file.rs:1813-1814`) has no revision fence, and the frontend does not
suspend drafts for a tab close. It stays a hypothesis until a trace reproduces it. If one does, the
WI pins it as an expected failure, reports it, and continues (§ 7 "Finding a live bug"; ruling Q3).

### 3.4 Menu routing: (P) for Rust, (X) for the frontend

**Rust (P)**
- **Drives** `MenuFocus` (`apply`, `forget`, `begin_native_menu`, `end_native_menu`,
  `native_will_send`), then the **real dispatch body**: `discard_native_only_capture` (`menu.rs:419`,
  called first, as `handle_menu_event` does at `:342-345`), then the new `dispatch_menu_action`
  (WI-6, fix 1, X3). That function holds `emit_menu_action`'s whole body, **`menu.rs:125-166`**
  (fix 2, gpt X3: the closure ends at `:165` and the `route_for_event` call is at `:166`), unchanged
  apart from the accessor substitutions S1–S8 listed under AC-6.0: the guard derivation, the `emit`
  closure that calls `menu_availability::emit_to_window` with `guard_focus`, the cancel flag, the
  filtered log and `route_for_event`. The test supplies only the innermost native emit, in place of
  `app.emit_to(target, "menu:action", p)`, so a `guard_focus` → `focus` swap at `:142` is inside the
  tested code.
  - The alphabet includes `Muda(y)` for a `y` other than the captured id.
  - **Gated actions and mode reports** (fix 2, opus H1). `guard_focus` reaches only
    `emit_to_window(…, focus, …)`, which uses it once, as `focused` (`menu_availability.rs:177`), and
    `dispatch_if_allowed` reads `focused` only for a row whose macOS v2 availability is not `Both`
    (`:121-135`). `file.save` and `format.highlight` are `"v2": "both"` in `menu_layout.json`, so a
    trace that clicks only them cannot see the swap. The click alphabet is therefore
    `x ∈ {file.save (Both), paragraph.table (W), edit.deleteWord (S)}` (each row's v2 value checked in
    `8501affd:src-tauri/src/menu_layout.json`), plus `ModeReport(w, wysiwyg|source)` events. The
    harness holds one real `MenuState::default()` and applies a report through
    `publish_op(RecentOp::Refresh, Some(ModeReport{…}), |_, _| Ok(()))`, the pattern of
    `menu_availability_m4_integration_tests.rs:23-38`. Setup reports A `wysiwyg` and B `source`, so
    the two windows' modes differ. The model's M1–M4 expectation for a gated row adds the mode rule
    from the layout row: an emit to the owner only if the owner's last report allows it; otherwise
    zero emits.
- **Uses** synthetic `NativeTree`s (HashMaps of `usize` addresses, empty `keep_alive`). No
  `NSNotification` and no AppKit.
- **AppKit's ordering is an input event.** The trace generator emits `Begin(tree)`, `End`,
  `Focus(w)`, `Blur(w)`, `Rebuild` (new tree, new generation), `WillSend(item@tree_k)`,
  `Shortcut(item)`, `Destroy(w)` and `Muda(id)` in any order AppKit could produce. Excluded are
  orders AppKit cannot produce, such as WillSend before any Begin for a menu click (that is the
  Shortcut event instead).
- **Compares** the `emit_to` targets against model M1–M4.
- **The B8 trace is pinned twice** (fix 2, opus H1):
  - `B8(file.save)`: `Focus(A) Begin(T1) End Blur(A) Focus(B) Rebuild(T2) WillSend(x@T1) Muda(x)`
    with `x = file.save` → exactly one emit, to A (as `d319_f3_b8_order_routes_to_click_owner_once`).
  - `B8(paragraph.table)`: the same order with `x = paragraph.table`, after the setup reports A
    `wysiwyg` and B `source` → exactly one emit, to A, logged `decision:"click_time"`, and no
    `ui.menu.availability` cancel. Only this pin sees the `guard_focus` hand-off (AC-6.5).

**Frontend (X)**
- `tests/support/editorGenerationDomain.ts` already holds a generation property, and
  `menu-target-token.test.ts` asserts that "staleness is absorbing".
- WI-7 extends that domain with the M1–M4 gaps (modal submit, render tick, confirm, Save entry),
  enumerates it exhaustively with up to 4 disturbances (§ 4.1's bound, not a raw length), and
  asserts M5 on the store effect.
- The window-close branch of `handleConfirmClose`, which takes no token (`App.tsx:732-734`), is
  **not** a WI-7 case. Both reviewers answered Q4 YES (§ 8): it stays token-free under C4. Its
  switch trace needs `useWindowCloseGuard` mounted, which only WI-3's harness does, so it is pinned
  there as AC-3.5.

---

## 4. Tooling decision (AC-4)

**Recommendation: an in-repo harness, no new dependency, recorded in an ADR (WI-0).**

| | `fast-check` 4.10.2 | In-repo harness |
|---|---|---|
| Size | 1.52 MB unpacked, plus `pure-rand` ^8 (64 KB) | about 250 lines of TS under `tests/support/raceModel/` and about 150 lines of Rust in one `#[cfg(test)]` module |
| Licence | MIT (and MIT for pure-rand) | repo |
| Maintenance | active: 4.8 in May, 4.9 in July, 4.10.0–4.10.2 in September 2026; one maintainer-led project (dubzzz) | ours. The pieces are tiny and already half exist: `seededRandom.ts`, `seededSequences.ts`, `mulberry32` in `tableCorpus.ts` |
| vitest integration | `@fast-check/vitest` 0.5.0 and 0.4.x peer `vitest ^4.1`. **The repo is on vitest 3.2.4**, so it would pin 0.2.4 (peers ^1–^4) or call `fc.assert` directly | plain `it`; the seed or trace index in the case title |
| Async interleavings | `fc.scheduler()` / `fc.asyncModelRun` are built for this: the best argument for it | a held-IPC scheduler (§ 4.1). The repo already holds IPC replies by hand (`tests/support/externalChangeIpc.ts`) |
| Seeds and shrinking | integrated shrinking; `seed` and `path` replay | enumeration by increasing length: the first counterexample is **minimal by construction**. Seeded walks get a drop-one minimizer (ddmin-lite, about 40 lines) |
| Failure replay | `{seed, path}` printed; rerun with `fc.assert(..., {seed, path})` | the trace is printed as an event list; replay is `replay([...])` in one pinned `it`. That is also how a found counterexample becomes a permanent regression case |
| Rust side | none; it would still need `proptest` (a second dependency, second ADR) or hand-rolled code | **the same harness shape on both sides**, matching the quit-guard prop tests that already exist (`driver_escape_prop_tests.rs:84`, `coordinator_props_tests.rs:244`) |
| Dependency gate | needs an ADR, a `package.json` and lockfile change, and a `patches/` and D181 check | none |

**Why the in-repo harness wins**
- **The alphabets are small.** They run 8 to 16 events, and every recorded defect needed at most 4
  disturbances: D290 H1 was Save, Close, Release; D261 H1 was Close, a second completed Close,
  Reopen and Edit before the first Release (4, corrected in fix 1); D305
  was Prompt, DraftTick, Discard; D319 was Begin, End, Focus, Rebuild, WillSend, after which the
  order is fixed.
- **Bounded exhaustive enumeration beats random sampling** at that size (small-scope hypothesis).
  Every interleaving with up to 4 disturbances, after guard pruning, is checked, not a sample.
- **It needs no shrinking**, because it enumerates shortest first.
- **One shape covers both TS and Rust**, and Rust has to be hand-rolled anyway.
- **Precedent.** The repo's own record says "by design" (`seededRandom.ts:2-3`), and the
  dependency gate history ran ADR-0020 → ADR-0023 (no new dependency).

**What it gives up**
- Integrated shrinking for long random walks. The drop-one minimizer is weaker.
- `fc.scheduler`'s ready-made promise scheduling, which has to be rebuilt as the held-IPC
  scheduler.
- A community-tested generator library.

If a later area needs long traces (more than 8 events) with rich data, reopen this choice; the ADR
names that as the reconsideration trigger.

### 4.1 Harness (WI-1): what it is

- **`enumerate(setup, alphabet, k, enabled)`.** Amended after attack G3. The bound is on
  **disturbances**, not on raw length:
  - **Setup** is a fixed prefix outside the bound: the initial focus, opening d1 and d2, and the
    first edit.
  - **Disturbances** are at most `k` non-`Release` events, the trigger included.
  - **Releases** are added as the held set allows, at every position and in every order, so a
    trace's raw length is not capped.
  - Traces are yielded by number of disturbances, then by total length, then lexicographically, so
    the first counterexample is still minimal.
  - `k = 4` is the slow-lane target and the default lane's quick sweep uses the largest `k` that
    WI-1's and each area WI's measurement fits under 2 s (possibly 0: pinned traces only). The cap
    rules are in § 7 "Sweep caps".
  - **Every retro trace and every pinned defect trace is replayed explicitly** in the default
    lane's pinned file, whatever the sweep's cap, so no defect trace depends on the bound (fix 1, X7
    and gpt M1). In addition, each must lie inside its area's **uncapped** slow bound, and an AC
    checks the counts mechanically (fix-1 counts, trigger included):
    - B8 has 2 disturbances after the click skeleton (Blur(A)/Focus(B) as one focus change, plus
      Rebuild);
    - D305 has 2 (DraftTick, WindowDiscard after WindowClose);
    - D305 fix 2 has 3;
    - D290 round-1 H1 has 2; D290 round-3 H4 (`Save, Reload, Edit`) has 3;
    - **D261 H1 has 4**, not 2: `CloseTab#1(d1)`, `CloseTab#2(d1)` (released to completion),
      `Reopen(d1)`, `Edit(d1)`, then `Release(close#1)` (opus F1; the shape of
      `tests/d261-close-commit-stale.test.tsx:91-109`). Its 3-disturbance prefix without the Edit
      already breaks C2. **The close area's slow sweep is therefore never capped below `k = 4`**;
      if it exceeds 180 s, the id set shrinks first (§ 7).
  - For routing, a **completed** click skeleton `Begin, End, WillSend, Muda` counts as one
    disturbance. It is still emitted as **four separate events**, and any other events may sit
    between them (attack r2 N3). A lone `Begin`, or `Begin End` with no WillSend, counts as a
    disturbance of its own. Other focus orders, a second Rebuild and Destroy(A) mid-session
    therefore fall inside `k = 4`. Pinned: `Focus(A) Begin(T1) End Focus(B) Shortcut(y) Muda(y)` →
    B (the ended session is superseded).
- **`enabled` comes from both sides.** `Release(cmd, k)` is enabled for each call **actually held
  by the SUT**, not only those the model predicts. After each step the harness compares the
  **spec-effect part** of the SUT's held set and issued-IPC multiset with the model's prediction,
  and any difference is a `TraceFailure` (attack G8). Mechanism calls are excluded from that
  comparison and checked only for liveness and permitted responses (§ 2, fix 1, X5). Every other
  event's `enabled` comes from the model.
- **`walk(seed, setup, alphabet, len, enabled)`.** A seeded random walk using `mulberry32`.
- **`minimize(trace, fails)`.** Repeatedly drops one event while the failure persists. It never
  drops setup.
- **`heldIpc()`.** Wraps the core mock. Each `invoke(cmd)` named in `hold` is queued as a
  deferred, and `release(cmd, k, outcome)` settles the **k-th held call of that command, for any
  k** (attack G2).
  - **For stateful boundary commands, processing and reply are separate events** (attack r2 N1).
    This applies to `save_draft`, `delete_*`, `recover_draft` and `save_file`:
    - `Process(cmd, k)`: the fake takes its lock and applies the call. A `save_draft` gets its
      `save_order` and revision here.
    - `Reply(cmd, k, outcome)`: the result reaches the frontend.
  - **Any held, unprocessed call may process whenever the lock is free** (fix 1, X2; replaces the
    earlier per-command FIFO rule, which cited no clause). The fake applies a `Process` atomically,
    so the lock is free between events, and `Process(cmd, k)` is enabled for every held call not
    yet processed, of any command that shares `DRAFT_LOCK`, in any order. `save_order` and the
    revision are assigned **at that step**, as `mod.rs:187-188` does after acquiring the lock. The
    only orders excluded are those a clause excludes: the quit gate (ADR-0035) and `Reply` before
    its own `Process`. `save_file` takes no shared lock and follows the same any-order rule.
  - `Reply` may come in any order after its own `Process`.
  - **Pinned processing orders**, each with independent text and revision assertions (texts t1
    from the first tick and t2 from the second):
    - `P1 P2 R2 R1`: disk holds t2; the next `delete_discarded_draft` carries t2's revision (D1b).
    - `P2 P1 R1 R2` and `P2 P1 R2 R1`: `P1` writes the older snapshot t1 over t2. D1b holds (the
      record is t1's revision, save order n+1); **D1a fails**. These orders exist only if the real
      frontend issues the second write while the first is still held, which is what the property
      finds out (autosave ticks, `QuitBackstop`). If it does, the trace is a live bug under Q3:
      pinned as `it.fails("D3xx: …")`, reported and registered (Q10: D1a governs). WI-5 does not
      re-test D1a: the service receives no snapshot age (§ 2, fix 2). It checks only that the fake's
      `Process` rule matches the service's (the last write processed wins, with the higher
      `save_order` and a fresh revision), through shared-table rows that carry no snapshot order.
  - `flush()` drains microtasks. Other commands use per-test defaults.
- **Observable sinks.** Each SUT adapter records:
  - IPC calls with their arguments;
  - the boundary fake's disk;
  - user-visible store fields;
  - **toasts**, through the toast store or the injected `performSave` deps (attack G6, so S6 and
    P-S can count them);
  - `emit_to` targets.
- **`runTrace(trace, sut, model)`.** Applies each event to both the SUT and the model, checks
  invariants after each step, and throws `TraceFailure{trace, step, invariant, expected, actual}`
  with the printed trace.
- **Rust mirror.** `src-tauri/src/test_support/race_model.rs` (`#[cfg(test)]`): an `enumerate` over
  an `enum Event` slice with an `enabled` closure, and `minimize`.

---

## 5. A model that mirrors the code (AC-5)

The trap: a model written by reading `documentSave.ts` agrees with `documentSave.ts`, bugs
included. Eight rules keep each model independent.

1. **The source is text, not code.** Each model file opens with a `Spec:` block quoting the clauses
   it encodes: the ADR decision, the defect row's 验收/修复 column, rule 60 lines. Every transition
   in the model carries a comment naming its clause. A transition with no clause is not allowed. If
   the spec is silent, the case goes to the delegator as a question (§ 8), not into the model from
   the code.
2. **No imports from `src/`.** This holds even for types (precedent: `dialogOpenOrderOracle.ts:7-9`,
   "this file NEVER imports the code under test, not even its types"). Ids and enums are restated,
   and one cross-check test compares them with the module's exports, so drift fails loudly.
3. **The model is written first, from the spec, and § 1 of this plan is not an input to it.**
   § 1 transcribes the code; it is for the SUT adapter's author. The WI order is: model file plus
   its hand-worked expected traces (the defect traces from the device records and audit reports),
   then the SUT adapter. The model and its expected traces go into the RED receipt commit, so the
   reviewer sees them before any green. (Amended in fix 1, opus M8: the earlier "before the code is
   opened" was not achievable for a writer who has read § 1.)
4. **The oracle reads observable effects only.** That means:
   - which IPCs were issued, with which arguments;
   - the boundary fake's disk;
   - the store fields a user sees (`isModified`, content, open ids);
   - `emit_to` targets.

   It never reads `baselineEpoch`, `lifetimeEpoch`, `saveQueues` or `pending`. Those are the code's
   mechanism, and asserting them makes the model a copy of it.
5. **Each model must catch a real past defect** (§ 6). A model that passes on the pre-fix SHA either
   mirrors the code or does not cover the defect. Either way the WI is not done.
6. **A disagreement is resolved by citation.** When model and code disagree, the handoff quotes the
   spec text that decides it. "The code does X" is never a reason to change the model. A model
   change needs a clause, and a code-is-wrong finding goes to the delegator as a new D item.
7. **Boundary fakes are models too.** The TS draft-store fake (§ 3.3) is written from ADR-0127, not
   from `protection.rs`. It shares its trace table with the Rust property, so the fake and the real
   service are checked against the same expected outcomes.
8. **Every model state variable has a glossary entry that cites a clause** (fix 1, opus M8). The
   glossary sits in the `Spec:` block. A variable that shares a name with a code field (lifetime,
   replacement) is defined by its clause (D261 H1, D290 H4), and the cross-check test of rule 2
   never compares it with the code's epoch fields. A transition that needs code behaviour the spec
   does not state (such as the in-place upsert of an open id) is not modelled; the event is defined
   so that it does not arise (`Activate`, § 3.1), or it goes to the delegator as a question.

---

## 6. Retro-checks (AC-6)

For each area: the pre-fix SHA, the trace that must fail there, the invariant it must break, and
proof that the SHA is the right one. Each retro-check runs in a detached `verify-<sha7>` worktree.
The new support files and the test file are copied in, unchanged except for a named adapter where
an API moved. The run must fail on the named invariant at the named step. Then the same test passes
at the WI's own head.

| Area | Pre-fix SHA | Why it is the pre-fix state | Trace | Must fail |
|---|---|---|---|---|
| Save | **`69ba3a09`**: parent of `3ec32908` "fix(save): recheck document before deferred writes" (D290 round 1). Before any D290 code is `2dbcff7a` | At `69ba3a09`, `saveDocumentNow` has no lifetime re-check after `getPreferences`: `git show 69ba3a09:src/services/documentSave.ts` lines 157-186 go from `getPreferences` straight to `saveFile` | `Save`, `Close`, `Release(prefs, ok)` | **S1**: `save_file` issued for a closed document |
| Save (second, S8) | `4775f410`: parent of `f3488d0c` "cancel stale saves after document replacement" (round 3 H4; `git log -1 --format=%P f3488d0c` = `4775f410`) | `git show 4775f410:src/services/documentSave.ts:190-208`: after `getPreferences` it checks closed, path and lifetime, and cancels a reload only when `!current.isModified && current.content !== doc.content`, so a reload followed by typing falls through to `saveFile` (`:209`). `f3488d0c` adds the `replacementEpoch` check | `Save`, `Reload(diff)`, `Edit`, `Release(prefs, ok)`; a second pinned trace uses `Reload(same)` with no Edit | **S8**: a `save_file` is issued for the Save requested before the replacement. At `f3488d0c` and at HEAD it is cancelled as `reloaded`. (Fix 1, X4: the earlier "S5 or S7" was not entailed; S5 permits the demoted dirty result, and S7 holds literally) |
| Close | **`527579af`**: parent of `dd2312db` "fix(close): a held close reply never removes a reopened document" (D261 H1) | `git show 527579af:src/hooks/useDocument.ts:262-273`: `closeDocumentById` awaits `closeDocument` and then removes the id from the store with no epoch check. At the fix, `commitDocumentClose` refuses when `baselineMovedSince(id, start)` (`documentCloseCommit.ts:38-40`), which the completed second close stamps (`documentStore.ts:254`) | **The real D261 H1 shape** (fix 1, X7; `tests/d261-close-commit-stale.test.tsx:91-109`): `CloseTab#1(d1, discard)` held; `CloseTab#2(d1, discard)`, `Release(close#2)`, so d1 is gone; `Reopen(d1)`, a new lifetime; `Edit(d1)`; `Release(close#1)`. 4 disturbances | **C2** (the reopened d1 is removed) and **C1** (its typed text is discarded). At HEAD close #1 is refused as `stale`. The 3-disturbance prefix without the Edit fails C2 alone and is pinned too |
| Drafts | **`cfd2e7c5`**: parent of `3c2289ae` "fix(draft): delete owned drafts after window discard", the first D305 commit; `cfd2e7c5` is a docs commit | `useWindowCloseGuard.confirmClose` exists (`git show cfd2e7c5:src/hooks/useWindowCloseGuard.ts:234`) and deletes no draft | `Edit(d1)`, `WindowClose`, `DraftTick`, `Release(save_draft)`, `WindowDiscard` | **D4**: a draft for d1 remains on the boundary fake's disk |
| Routing | **`9b9cd404`** (Fix 1+2). `ae1742d4`, the parent of Fix 3 `32fa5b96`, has identical source: `git diff 9b9cd404 ae1742d4 -- src-tauri` is empty | `end_native_menu` discards the session (`git show 9b9cd404:src-tauri/src/menu_capture_state.rs:187-201`), so a WillSend from the old tree is unmapped and routes by arrival focus | B8 with `x = file.save` (a `Both` row): `Focus(A) Begin(T1) End Blur(A) Focus(B) Rebuild(T2) WillSend(x@T1) Muda(x)` | **M1**: the emit goes to B. (This holds only for a `Both` row. For `paragraph.table` the old code is expected to route to B, where B's `source` report fails the W row: zero emits with `wrong_mode`, which breaks P-M rather than sending to B. WI-6 runs it as a second retro line and quotes the reason it observes; it is evidence, not a RED condition. Fix 2) |
| Menu token, frontend (WI-7) | **`a118914f`**: parent of `124311c1` "fix(menu): deferred menu mutations check their target before acting" (fix 1, X1; `git log -1 --format=%P 124311c1`) | At `a118914f` the token exists and `useMenuEvents` captures and dispatches it (`useMenuEvents.ts:111-112`), but `highlightRequest` is a bare number (`App.tsx:105,791,813`; `Editor.tsx:37,164`; `MilkdownEditor.tsx:108,217`) and no editor calls `abandonIfStale`: `git grep abandonIfStale a118914f -- src/components` is empty. `124311c1` adds it (`Editor.tsx:170`, `MilkdownEditor.tsx:226`). `527579af`, the SHA the earlier draft named, already has it, so it cannot fail | stale Highlight: `Receipt(highlight)` in d1, `Switch(d2)`, `RenderTick` | **M5**: the highlight mark is applied in d2 |

**Every retro-check runs a control trace too** (attack G10). At the old SHA, the same harness
also runs one trace that must **pass**. For routing that trace is `Focus(A) Click(x)` with no focus
change, which must reach A. For save it is an undisturbed `Save`, and for close an undisturbed
`CloseTab`. **For drafts it is an undisturbed `DraftTick` on dirty d1, which issues exactly one
`save_draft`** (P-D; fix 1, opus M6). The WindowDiscard half of P-C is not a control at `cfd2e7c5`,
because `delete_discarded_draft` arrived with the fix; a progress clause is used as a control only
where its clause predates the fix. For the menu token it is `Receipt(highlight) RenderTick` in d1,
which applies the mark once. This shows the harness, the mocks (for example `isTauri()` returning true, which
`preferencesService.ts:143-144` needs at `69ba3a09`) and the adapter work there.

The retro counts only when both of these hold:
- the control passes;
- the defect trace fails with a `TraceFailure` naming the expected invariant and step.

A TypeError, a missing export or a compile error voids the run, and the adapter is fixed. The
model and the trace are never changed to get there.

**Adapters across API moves**
- **Routing.** At `9b9cd404` the API is `native_selection_id` (`menu_capture_state.rs:208`);
  `native_will_send` and `menu_target_native_session.rs` arrive with Fix 3. The Rust property
  therefore drives through a test-only trait `CaptureDriver {focus, blur, begin, end, will_send,
  muda, emits}`. Its HEAD impl lives in the new test module; the retro impl (about 30 lines) is
  written in the verify worktree for the old API and recorded in the handoff verbatim. The model,
  the alphabet and the property are byte-identical across both.
- **Save, close, drafts.** The TS entries named above exist at each pre-fix SHA, so no adapter is
  expected. If one turns out to be needed, it is named the same way.
- **Routing `Muda` at the old SHA.** `dispatch_menu_action` (WI-6) does not exist at `9b9cd404`,
  but `git diff --stat 9b9cd404 8501affd -- src-tauri/src/menu.rs src-tauri/src/menu_availability.rs`
  is empty. The retro driver's `muda` is therefore WI-6's extracted body as it stands at HEAD, copied
  into the verify worktree's test module with **the same substitutions S1–S8** listed under AC-6.0
  (fix 2, gpt X3; the earlier "three" undercounted). It is quoted in the handoff, and its
  identity with `9b9cd404:src-tauri/src/menu.rs:125-166`, apart from exactly S1–S8, is shown by
  the same diff check as AC-6.0.
- **Menu token at `a118914f`.** One adapter line differs. `Receipt(highlight)` drives the real
  `useMenuEvents` dispatch, whose `onHighlight` handler is the adapter: at HEAD it sets
  `{seq, token}` as `App.tsx:820-822` does, and at `a118914f` it increments a number as
  `a118914f:src/App.tsx:791,813` does. Each mirrors that SHA's own App handler, not a test choice.
  `RenderTick` re-renders the real `Editor` and `MilkdownEditor` with that prop.
  `tests/support/editorGenerationDomain.ts` is absent at `a118914f` and is copied in as support,
  like the harness. If the controls cannot pass there, the RED falls back as AC-7.4 states.
- **The D305 retro at `cfd2e7c5`.** That SHA predates `tests/d305-window-discard.test.tsx`. WI-4's
  SUT adapter must therefore be self-contained: it mounts `useWindowCloseGuard` with its own
  `@tauri-apps/api/window` and `core` mocks, built from `tests/support/raceModel/heldIpc.ts`. The
  later harness is never copied into the verify worktree.
- **The old-SHA adapter is written against the control traces first.** It is frozen once the
  controls pass, and only then is the defect trace run. The handoff quotes the adapter.
- **The routing adapter is constrained** (attack G9 and r2 N5; the earlier "shape checks" claim was
  wrong):
  - It passes the real `NativeTree` addresses straight to the old `native_selection_id`
    (`9b9cd404:src-tauri/src/menu_capture_state.rs:208`) and adds no lookup logic of its own.
  - It has **two** controls: a current-tree item with no focus change, which must reach A; and an
    **old-tree item with no rebuild and no focus change**, `Focus(A) Begin(T1) End WillSend(x@T1)
    Muda(x)`, which must also reach A. An adapter that makes old-tree items "unmapped" fails the
    second control.
  - The retro quotes the old code's own `menu.capture` / `ui.menu` log reason for the B8 trace.
- **Draft Rust layer (WI-5).** It has no required retro, because the brief names D305's for drafts
  and that is the TS layer. An optional one, against D299's base `b036483c`, needs a token-less
  adapter; the implementor reports whether it ran.

---

## 7. Work items (AC-7)

**Tier.** Every WI below is **High** (ADR-0121). The tests pin document save, close and draft
behaviour, the paths under `src-tauri` are High, and tests outside "presentation-only" are an
unlisted path. **Difficulty: hard** (ADR-0138).

**Lane budgets**
- **Default lane:** each `*.test.ts` stays under 2 s under coverage. It holds the pinned traces:
  the retro traces, the existing hand cases re-expressed, and every counterexample ever found.
- **`slow` lane** (`*.slow.test.ts`, ADR-0050): the exhaustive sweeps and walks.
- **Rust:** the `rust` lane (one test module per area) holds the pinned traces and a quick sweep
  under 2 s. **A Rust sweep that takes more than 2 s is `#[ignore]`d** and runs in the push/manual
  lane (`cargo test … -- --ignored`), the Rust counterpart of ADR-0050 (ruling Q5). Each such test
  is named `*_slow_sweep`, so the lane can select it by name. **That lane does not exist today**
  (`.claude/tdd-guardian/config.json` has `unit`, `unit-red`, `slow`, `rust`, `rust-verify-run`,
  `clippy`, `fmt`, `integration`), so WI-1 adds it as `rust-slow` (fix 1, opus M2).
- **Sweep caps** (ruling Q8; rewritten in fix 1 for gpt M1 and opus M3). The budgets below are
  targets, not facts: no area sweep exists until its WI, so **each area WI measures its own sweeps
  under coverage** (WI-1 measures only the toy alphabets). The rules:
  1. **Slow lane.** `k = 4` unless the file exceeds 180 s. Then, in this order: shrink the id or
     window set by one where the model is symmetric in it (the reduction is stated); then cap at
     `k = 3`. **Never below `k = 3`**, and never below `k = 4` for close (§ 4.1). A file still over
     180 s at the floor is split by trigger event into several slow files, each under 180 s.
  2. **Default lane.** The quick sweep uses the largest `k` that fits 2 s, which may be 0. At 0 the
     file holds pinned traces only.
  3. **Every AC that says "up to 4 disturbances" means up to the file's recorded cap.** The cap,
     the reduction and the measured time go in the file header and in the handoff. The handoff
     also names **what is lost**: the traces with more disturbances than the cap are unchecked by
     the sweep. Every pinned and retro trace is still replayed in the default lane, so no defect
     trace is among them.

**Order.** WI-0 → WI-1 → (WI-2, WI-6) → WI-3 → WI-4 → WI-5 → WI-7 → WI-8. Save and routing come
first because they carry the clearest retro-checks. Close builds on the save scheduler, and drafts
build on the close Discard harness. Only one WI is in flight per implementor (slot cap two).

### WI-0: ADR "race properties use an in-repo bounded enumerator, not fast-check"
- **Paths:** `docs/adr/NNNN-…md` (number from the delegator).
- **Content:** Context (D323; the G0 no-new-dependency check, which still binds per ruling Q7; the
  vitest 3.2.4 constraint; no Rust PBT; the "by design" precedent);
  Options (fast-check, fast-check plus proptest, in-repo); Decision; Consequences, including what is
  given up (§ 4); the reconsideration trigger.
- **AC:** the ADR passes plan review by gpt-auditor and opus-auditor, and the user accepts it.
- **Tier and lane:** docs; no receipt.

### WI-1: harness (TS and Rust)
- **Paths:**
  - `tests/support/raceModel/{enumerate,walk,minimize,heldIpc,runTrace}.ts`
  - `tests/tooling/race-model-harness.test.ts` (it imports nothing from `src/`)
  - `src-tauri/src/test_support/race_model.rs` with its `mod` line (or `src-tauri/src/race_model_tests.rs`)
  - `.claude/tdd-guardian/config.json`: the new `rust-slow` lane (push and manual triggers,
    `cargo test --manifest-path src-tauri/Cargo.toml -- --ignored slow_sweep` under `heavy-lock`)
- **ACs:**
  - **AC-1.1** `enumerate` over alphabet {a, b, c}, `k = 3`, no releases and everything enabled,
    yields exactly 39 traces, in length-then-lex order. With one held IPC per `a`, every release
    position and order is generated, including reverse order (G2, G3).
  - **AC-1.2** `enabled` pruning removes exactly the traces whose prefix is disabled.
  - **AC-1.3** On a planted toy bug (a counter whose async op skips its re-check after an await),
    `enumerate` finds the 3-event counterexample first, and `minimize` on a 12-event failing walk
    returns a 1-minimal trace.
  - **AC-1.4** `heldIpc.release(cmd, k)` settles exactly the k-th held call for any k, and an
    unreleased call never resolves.
  - **AC-1.4b** A mismatch in the **spec-effect** part of the held set or the IPC multiset between
    the SUT and the model raises a `TraceFailure` (G8). An extra, missing or reordered
    **mechanism** call raises nothing; a mechanism call still held at the end of a trace is
    reported (§ 2, fix 1, X5). Both halves have a toy case.
  - **AC-1.4c** `Process` is any-order (fix 1, X2): with two held calls of one command and one of
    another, all 3! processing orders are generated, and each `Process` assigns the next save order
    at that step. A toy store in which the second-processed write wins is caught when the
    first-ticked write is processed last.
  - **AC-1.5** A `TraceFailure` message contains the trace and the step.
  - **AC-1.6** The Rust mirror satisfies AC-1.1 and AC-1.3.
  - **AC-1.7** Composite disturbances (fix 1, opus M5). A declared skeleton `[b, e, w, m]` counts
    as one disturbance once complete, a prefix of it counts as one of its own, and other events
    interleave between its parts. Over `{skeleton, f}` with `k = 2`, the yielded set equals a
    hand-listed expected set, including `b f e w m` and `b e f w m`.
  - **AC-1.8** `rust-slow` runs an `#[ignore]`d `*_slow_sweep` toy test and skips the rest; the
    handoff quotes the decisive line.
- **RED:** `D323-WI-1a` (TS), `D323-WI-1b` (Rust).
- **Budget:** under 1 s; default lane plus the `rust` lane.

### WI-2: save model and property
- **Paths:**
  - `tests/support/saveRaceModel.ts` (the model, with a `Spec:` block)
  - `tests/support/saveRaceSut.ts` (the adapter)
  - `tests/save-race-properties.test.ts` (pinned)
  - `tests/save-race-properties.slow.test.ts` (exhaustive)
- **ACs:**
  - **AC-2.1** S1–S8 and P-S hold on every trace with up to the slow file's recorded cap of
    disturbances (target 4, floor 3; § 7 Sweep caps) over the § 3.1 alphabet. The default lane's
    quick sweep uses its own measured `k`.
  - **AC-2.2** Seeded walks, 200 seeds × 10 disturbances, all hold (slow).
  - **AC-2.2b** Spec-effect IPC multiset equality and spec-effect held-set equality are checked
    after every step (§ 2, § 4.1, G8). `get_preferences` and `log_event` are excluded: they are
    released from the SUT's held set, answered with the default preferences, and checked only for
    liveness (fix 1, X5). A mutation of the adapter that drops one `save_file` is caught, and an
    undisturbed `Save` that holds `get_preferences` (`documentSave.ts:184`) passes.
  - **AC-2.3** The pinned file replays the 9 interleavings now covered by
    `d290-ignored-deletion-save-choice.test.tsx:231,273` and `useUpdater.test.ts:126`, plus both
    retro traces.
  - **AC-2.4** Retro: at `69ba3a09` the property fails S1 on `Save, Close, Release(prefs)`. At
    `4775f410` it fails **S8** on `Save, Reload(diff), Edit, Release(prefs)` (fix 1, X4). The S8
    trace passes at `f3488d0c`, in a `verify-f3488d0` worktree, and at the WI's head. At both
    pre-fix SHAs the control trace passes (§ 6), and the handoff carries the output.
  - **AC-2.5** Model independence: no `src/` import in the model, and the enum cross-check test
    passes.
- **RED:** `D323-WI-2a` (the pinned file `tests/save-race-properties.test.ts`). **Each RED comes from the
  retro run** (ruling Q1): the WI's test files at the pre-fix SHA in a detached `verify-<sha7>` worktree
  (here `verify-69ba3a0` and `verify-4775f41`), failing with an assertion (`TraceFailure`). No no-op
  adapter is used, because a RED that no defect produced proves only the harness.
  **Slow files get no receipt id** (fix 2, Q11 re-ruled): `scripts/tdd/unit-red-lane.mjs` rejects
  `*.slow.test.*` (`validateFiles`, `:71`), so `D323-WI-2b`, `-3b` and `-4b` are dropped. A slow file's
  RED is its default-lane slice's: the pinned file replays every retro trace (§ 4.1), and that is what
  the receipt records.

  **This RED rule applies to WI-2 through WI-7.** The handoff records the receipt command, its
  worktree and its decisive output line.

  **How a retro RED is recorded** (Q11, re-ruled 2026-10-27 in `D323-plan-fix2-brief.md`: **path (a),
  the overlay**; it replaces the fix-1 proposal and rulings-2 Q11).
  1. **Which trees need the overlay.** `red-receipt.mjs record` loads the lane from the tested tree's
     own `.claude/tdd-guardian/config.json` (`record` passes `--lane unit-red` to the plugin with that cwd,
     `scripts/tdd/red-receipt.mjs:196-207`; `verify` loads it the same way, `:176-180`). At `69ba3a09`,
     `4775f410`, `527579af` and `a118914f` that config has no `unit-red` lane and
     `scripts/tdd/{red-receipt,unit-red-lane,phase-runner-source}.mjs` are absent (added in `cbd81fd4`).
     `cfd2e7c5` (WI-4) and `9b9cd404` (WI-6, a Rust receipt anyway) have both and need no overlay.
     Checked with `git cat-file -e <sha>:scripts/tdd/unit-red-lane.mjs` and
     `git show <sha>:.claude/tdd-guardian/config.json | grep -c '"unit-red"'`.
  2. **The overlay.** Into the `verify-<sha7>` tree, without committing anything there: copy HEAD's
     three `scripts/tdd/*.mjs` files (untracked), and add HEAD's `unit-red` lane entry to that tree's
     `.claude/tdd-guardian/config.json` (an uncommitted edit of a tracked file). All three trees use
     `vitest ^3.2.4`, as HEAD does, so the phase runner's imports resolve.
  3. **Record there**, with the overlaid entry script: from inside `verify-<sha7>`,
     `node scripts/tdd/red-receipt.mjs record --id D323-WI-2a --test tests/save-race-properties.test.ts`.
  4. **Carry the record verbatim** into the WI branch's `.claude/tdd-guardian/receipts.json`, in the RED
     commit. `verify` fingerprints only the record's relative `test_files` against the WI tree
     (`red-receipt.mjs:216-240` → `verifyAll`, tdd-guardian 0.10.2 `lib/verification.js:797-843`) and does not
     compare `head_sha`, so it reports `SEPARATION-HELD` when the
     receipted test file is byte-identical on the WI branch or has only added lines.
  5. **Disclosure.** The overlay files, the config edit and the copied support files are non-test changes
     in the verify tree, so the record carries them in `dirty_source`, and `verify` reports
     `implementation-already-present` (Medium, `verification.js:718-726`). The handoff names that finding,
     lists the `dirty_source` entries, and says they are the overlay and the copied harness, not product
     code. The verify SHA stays in the record's `head_sha`.
  6. **Per-SHA adapter lines sit outside the receipted test file** (opus r2 M1). A changed recorded line
     breaks separation, so an adapter that differs by SHA (WI-7's `onHighlight`, § 6) lives in a support
     file, never in `tests/<file>.test.ts(x)`.
  7. If ADR-0145's implementation lands before a WI's RED, its mechanism governs instead, and the
     handoff says so.
- **Budget:** pinned under 2 s; slow under 180 s (the Q8 limit; the earlier 120 s was a typo).

### WI-3: close model and property (frontend)
- **Paths:**
  - `tests/support/closeRaceModel.ts` and `tests/support/closeRaceSut.tsx`
  - `tests/close-race-properties.test.tsx` and `tests/close-race-properties.slow.test.tsx`
- **ACs:**
  - **AC-3.1** C1–C4 and P-C (with its D253 H3 exception), plus S1 jointly as C3, hold with up to
    the slow file's recorded cap, which is never below 4 for close (§ 4.1). `McpWrite`,
    `QuitBackstop`, `Switch` and `FlushFail` are in the alphabet.
  - **AC-3.2** The pinned file replays `d261-close-commit-stale` (112, 136, 159, 178),
    `d261-close-confirm-stale` (118, 133, 148) and the D253 overlap cases.
  - **AC-3.3** Retro (fix 1, X7): at `527579af`, the D261 H1 trace of § 6 (`CloseTab#1(d1)`,
    `CloseTab#2(d1)`, `Release(close#2)`, `Reopen(d1)`, `Edit(d1)`, `Release(close#1)`) fails C2 and
    C1, and its prefix without the Edit fails C2. Both pass at `dd2312db` and at the WI's head. The
    control trace passes at `527579af`. The earlier single-close trace is dropped: with d1 still
    open, its `Reopen` is an `Activate` (§ 3.1), and removing the tab is then correct.
  - **AC-3.4** The tab × case is `PromptTabX(d1)`, then `CloseTab(d1)` and `Reopen(d1)` (an
    external reopen of the same file into the same id), then `ConfirmTabX`. The model expects a
    **no-op on the newer lifetime** (C2, user ruling on Q2). Today's code discards it
    (`BottomTabs.tsx:50-55`), which is **D324**. The trace is pinned as
    `it.fails("D324: tab × confirm after same-id reopen is a no-op …")`, and the D324 fix flips it.
  - **AC-3.5** Q4's switch trace (fix 1; both reviewers YES, § 8). `Edit(d1)`, `Edit(d2)`,
    `WindowClose` (consent `{d1→v1, d2→v2}`), `Switch(d1→d2)`, `WindowDiscard`: the window closes
    (P-C), because a switch changes no content and C4's consent still covers
    every dirty document (`windowCloseAttempt.ts:94-103`). With `FlushFail` before both the prompt
    and the Discard, the same trace re-prompts instead (P-C's D253 H3 exception). Moved here from
    WI-7, whose token domain cannot drive `confirmClose` (opus M1).
  - **AC-3.6** Same-id reopen while the window prompt waits (fix 1; gpt Q4 note). `Edit(d1)` to v1,
    `WindowClose` (consent `{d1→v1}`), `CloseTab(d1, discard)` with its release, `Reopen(d1)` as a
    **new lifetime** that is dirty with the same text v1 (a recovered draft), then `WindowDiscard`.
    Consent is keyed by id and content and has no lifetime stamp, so it covers the new lifetime.
    The model expects **C1**: dirty content of a lifetime the user never consented to is not
    discarded. **Entry path** (fix 2, opus r2 M3): the plan names no UI path that closes a tab while
    the window-close prompt is up, so the hook-level `CloseTab` here is reachable only through
    `closeDocumentById` called directly. A reproduction is therefore reported as **hypothesis H-C6**,
    like H-R6: pinned as `it.fails("H-C6: …")` with the trace, reported to the delegator, and **not**
    registered as a D item until someone names an entry that runs behind the prompt (for example a
    `file:changed` deletion or an MCP close, if either reaches `closeDocumentById` then). If one is
    named, the delegator decides whether it extends D324 or is a new D item.
- **RED:** `D323-WI-3a` (pinned file), from the retro at `verify-527579a`, recorded with the § 7 WI-2
  overlay. The slow file has no receipt id (fix 2).
- **Budget:** pinned under 2 s; slow under 180 s.

### WI-4: drafts, frontend layer
- **Paths:**
  - `tests/support/draftRaceModel.ts`
  - `tests/support/draftStoreFake.ts` (the ADR-0127 fake)
  - `tests/fixtures/d323-draft-traces.json`
  - `tests/draft-race-properties.test.tsx` and `tests/draft-race-properties.slow.test.tsx`
- **ACs:**
  - **AC-4.1** D1a, D1b, D4, D6, P-D and C3 (drafts) hold with up to the slow file's recorded cap
    over the § 3.3 frontend alphabet, with `Process` any-order (§ 4.1).
  - **AC-4.1b** Pinned traces (fix 1, X2) include, for two DraftTicks of d1 with texts t1 then t2:
    `P1 P2 R2 R1` (disk t2; the next `delete_discarded_draft` carries t2's revision, D1b), and
    `P2 P1 R1 R2` and `P2 P1 R2 R1` (D1a: disk must not end at t1). They also include
    `QuitBackstop` against an in-flight `DraftTick` in both processing orders, and the D305 fix-2
    mid-batch write. D1b is observed through the `revision` argument of `delete_discarded_draft`,
    D1a on the fake's disk. A D1a failure on the real frontend is a live bug (Q3, Q10).
  - **AC-4.2** The pinned file replays the 12 `d305-window-discard` cases (82-324) and the
    D299-WI-3 and WI-6 placement cases.
  - **AC-4.3** Retro: at `cfd2e7c5`, D4 fails on the trace in § 6, the control trace (an
    undisturbed `DraftTick` gives one `save_draft`, § 6) passes, and the adapter is
    self-contained.
  - **AC-4.3b** `tests/fixtures/d323-draft-traces.json` is hand-authored, one clause cited per row,
    and committed in this WI, before WI-5.
  - **AC-4.4** H-R6 is probed: `CloseTab(discard)` during a held `save_draft`, in both
    `Process`/`Reply` orders. If a trace reproduces a draft left for the closed document, it is
    pinned as an expected failure, reported, and given a D number. Otherwise the handoff records
    H-R6 as not reproduced, with the traces tried (ruling Q3).
- **RED:** `D323-WI-4a` (pinned file), from the retro at `verify-cfd2e7c`. `cfd2e7c5` already has the
  `unit-red` lane and the entry scripts, so no overlay is needed. The slow file has no receipt id (fix 2).
- **Budget:** pinned under 2 s; slow under 180 s.

### WI-5: drafts, Rust layer
- **Paths:** `src-tauri/src/services/draft/d323_model_prop_tests.rs` with its `mod` line in
  `draft/mod.rs` (`#[cfg(test)]` only). It reads `tests/fixtures/d323-draft-traces.json` through
  `include_str!`.
- **ACs:**
  - **AC-5.1** What the service contract carries holds for every trace with up to the sweep's
    recorded cap over the § 3.3 alphabet, with windows {A, B}, ids {d1, d2} and two sessions (fix 2,
    opus H2; replaces the fix-1 D1a clause):
    - **the last write processed under the lock wins**: after any sequence of `Save`s of one id, the
      bundle on disk holds the last-processed write's `text`, with the highest `save_order` and a
      revision no earlier write had (the service half of D1b);
    - **D2, D3 and D5** as written;
    - **D4's and D6's service halves**: after the owned deletes of a Discard with no later write, no
      bundle remains for those ids; a claimed write is durable under the destination before the
      source is deleted.

    **D1a is not asserted here.** `save_draft` receives no snapshot age (`commands/draft.rs:104-111`),
    so D1a cannot hold at the service by construction. It is a frontend issuance property, proved in
    WI-4 (AC-4.1, AC-4.1b). No reversed-snapshot trace is generated or pinned in WI-5.
  - **AC-5.2** Every row of the shared trace table gives the same outcome here as in WI-4's fake. The
    table has **no row keyed on snapshot order**: a row names the calls in processing order and their
    texts, and its expected outcome is the D1b service half or a D2–D6 clause. The WI-4 rows for
    `P2 P1 …` (AC-4.1b) are frontend-only and are not in the shared table.
  - **AC-5.3** The existing `d305_owned_delete_tests` and `d299_*_tests` traces are among the pinned
    traces.
  - **AC-5.4** The optional retro against `b036483c` is reported as ran or not ran, with the reason.
- **RED:** `D323-WI-5`, recorded after `cargo fmt` (rule 10, D187). It is the optional retro at
  `b036483c` if that runs. If it does not, it is a shared-table row whose clause the HEAD code is
  shown to honour by a mutation (one line reverted), recorded in the handoff, with the receipt
  exception named there for the delegator.
- **Budget:** pinned plus quick sweep under 2 s in the `rust` lane. The full sweep is
  `d323_draft_model_slow_sweep`, `#[ignore]`d, run by `rust-slow`, under 180 s (rulings Q5, Q8).

### WI-6: menu routing, Rust layer
- **Paths, split by platform** (ruling Q6). PR CI's `rust-test` runs on ubuntu only, and macOS runs
  only on tags (`.github/workflows/ci.yml:142`).
  - `src-tauri/src/menu_route_model_tests.rs`, `#[cfg(test)]`, **Linux-runnable**. It holds M2–M4
    and P-M over the cross-platform part of the logic:
    - `MenuFocus::{apply, forget, begin_tracking, end_tracking, will_send_action_id, take_capture,
      peek_capture, capture_matches}`;
    - `resolve_target` and `route_selected`;
    - `discard_native_only_capture` and the extracted `dispatch_menu_action` below.

    Shortcuts, focus changes, destroy, `Muda(y≠x)` and the dead-owner fallbacks all run there, and
    PR CI runs them.
  - `src-tauri/src/menu_capture_model_tests.rs`, `#[cfg(all(test, target_os="macos"))]`. It holds
    the `CaptureDriver` trait with its HEAD impl, plus M1 and the native session (B8, ended
    sessions, rebuilds). PR CI never runs this file. It is proved by the landing verifier's `rust`
    lane on the Mac mini, and the handoff names that run.
  - Each file gets its `mod` line in `menu_capture_state.rs` or `main.rs`.
  - Production (fix 2 lists them here too): `src-tauri/src/menu_dispatch.rs` (new) and
    `src-tauri/src/menu.rs` (`emit_menu_action` reduced to its accessors, plus the `mod` line);
    `docs/test/cards/D323-WI6-menu-dispatch.md` (new, AC-6.6).
- **Production change, granted in principle** (ruling Q9; G5 and r2 N4), **scope restated in
  fix 1** (X3: the derivation alone, `:127-134`, left the `guard_focus` hand-off at `:138-142`
  untestable). The extraction is a **dispatch seam**, not just the derivation:
  - **New function** `dispatch_menu_action(focus: &MenuFocus, live: &[String], menus:
    Option<&MenuState>, layout: Result<&MenuLayout, String>, id: &str, action: &str, value:
    Option<String>, native_emit: impl FnMut(&str, &MenuActionPayload) -> Result<(), ()>, log: impl
    FnMut(LogEntryPayload))`, in a new module `src-tauri/src/menu_dispatch.rs`, declared inside
    `menu` with `#[path = "menu_dispatch.rs"] mod menu_dispatch;` as `menu_target` is
    (`menu.rs:118-119`). As a child of `menu` it can call the private `discard_native_only_capture`
    and the `pub(super)` `menu_availability::emit_to_window`. `menu.rs` is already 483 lines (rule
    50), so it only loses lines. The function holds `emit_menu_action`'s whole body,
    **`menu.rs:125-166`** (fix 2, gpt X3: `:165` closes `log_event` and `:166` is the
    `route_for_event` call), **moved, not rewritten**: the two cells, the guard derivation, the
    `emit` closure with its `emit_to_window(layout, action, label, guard_focus, menus, …)` call, the
    availability-cancel flag, the filtered log and `route_for_event`, with only the substitutions
    S1–S8 of AC-6.0.
  - **What stays in `emit_menu_action`** is only the `AppHandle` accessors that S1–S8 take out of
    the body: `:127-128` (`try_state::<MenuFocus>()` and the `UNMANAGED_FOCUS` fallback), `:134`
    (`webview_windows()`), `:136` (`try_state::<MenuState>()`), `menu_layout()`, the native emit
    `|target, p| app.emit_to(target, "menu:action", p).map_err(|_| ())` and `logger::log_event`,
    then one `dispatch_menu_action(…)` call. That is about 10 lines with no branch of their own.
  - **What a test drives.** `discard_native_only_capture(&focus, id)` (`menu.rs:419`), as
    `handle_menu_event` does first (`:342-345`), then `dispatch_menu_action` with the real
    `MenuFocus`, a constructed `MenuState` (`menu_recent.rs:96`) or `None`, the real parsed layout,
    and a recording `native_emit`. The sink therefore sits where `app.emit_to` sits, **below**
    `emit_to_window` and its guard.
  - **AC-6.0, refactor equivalence** (rewritten in fix 1; it is **not** a behaviour oracle, gpt H3).
    Two checks, both required:
    1. **Moved-lines identity** (range corrected in fix 2, gpt X3). A diff check, quoted in the
       handoff, that the body of `dispatch_menu_action` equals `8501affd:src-tauri/src/menu.rs:125-166`
       line for line, apart from exactly these substitutions and nothing else (each line number is at
       `8501affd`):

       | # | Line | Before | After |
       |---|---|---|---|
       | S1 | `:127-128` | `let managed = app.try_state::<MenuFocus>();` / `let focus = managed.as_deref().unwrap_or(&UNMANAGED_FOCUS);` | both lines removed from the body; `focus: &MenuFocus` is a parameter (the two lines move unchanged into `emit_menu_action`) |
       | S2 | `:134` | `let live: Vec<String> = app.webview_windows().into_keys().collect();` | removed; `live: &[String]` is a parameter (the line moves into `emit_menu_action`) |
       | S3 | `:136` | `let menus = app.try_state::<MenuState>();` | removed; `menus: Option<&MenuState>` is a parameter |
       | S4 | `:137` | `let result = match menu_layout() {` | `let result = match layout {`. `menu_layout()` is a `OnceLock` cache with no side effect (`menu_layout.rs:239-245`), so evaluating it in the caller before routing changes no log and no outcome |
       | S5 | `:143` | `menus.as_deref(),` | `menus,` |
       | S6 | `:146` | `app.emit_to(target, "menu:action", p).map_err(\|_\| ())` | `native_emit(target, p)` |
       | S7 | `:163` | `logger::log_event(entry);` | `log(entry);` |
       | S8 | `:166` | `focus.route_for_event(id, action, value, &live, emit, log_event);` | `focus.route_for_event(id, action, value, live, emit, log_event);` |

       The check is mechanical: apply S1–S8 to the `8501affd` range with a script quoted in the
       handoff, then `diff` the result against the new body (after `cargo fmt` on both sides). Any
       other difference fails AC-6.0. Line `:124`, the old signature, and `:167`, its closing brace,
       are outside the range.
    2. **Existing tests unchanged.** `menu_target_tests`, the `d319_*` tests and the
       `menu_availability` tests pass unchanged on the new seam.

    The copied before-image oracle of the earlier draft is dropped: once the closure moves, it can
    no longer be a byte copy (opus F3). The independent behaviour oracle is the M1–M4 model of
    AC-6.1.
  - **The residual wiring**, the ~10 accessor lines that no unit test can reach without an
    `AppHandle`, is covered by AC-6.0's identity check and by the device AC-6.6. A third option was
    considered: making `emit_menu_action` generic over `R: Runtime` and driving it with
    `tauri::test`'s MockRuntime. It lost because it needs tauri's `test` feature, which
    `src-tauri/Cargo.toml:22` lacks, and that is a dependency-feature change needing its own ADR.
- **ACs:**
  - **AC-6.1** M1–M4 and P-M hold for every trace the AC-6.4 predicate admits, with up to the
    sweep's recorded cap of disturbances (a completed Click counts as one), over the § 3.4 alphabet,
    with windows {A, B} and trees {T1, T2, T3}. Every `Muda` goes through
    `discard_native_only_capture` and `dispatch_menu_action`, with `Muda(y≠x)` in the alphabet. The
    alphabet includes the gated actions `paragraph.table` (W) and `edit.deleteWord` (S) and
    `ModeReport(w, wysiwyg|source)` events against a real `MenuState` (fix 2, opus H1), so the sweep
    can kill the AC-6.5 mutant; the handoff names the sweep's first counterexample under the swap.
  - **AC-6.2** Both pinned B8 traces of § 3.4 route to A exactly once: `B8(file.save)` (the same
    expectation as `d319_f3_b8_order_routes_to_click_owner_once`) and `B8(paragraph.table)` with A
    reporting `wysiwyg` and B `source` (one emit to A, `decision:"click_time"`, no
    `ui.menu.availability` cancel in the TestHome log, read as
    `menu_availability_m4_integration_tests.rs:118-121` does).
  - **AC-6.3** Retro: at `9b9cd404`, with the old-API driver, both controls of § 6 route to A, and
    only then does M1 fail on `B8(file.save)` with the emit to B (a `Both` row, § 6). The adapter
    and the old code's log reason are quoted in the handoff. `B8(paragraph.table)` is run there too
    and its observed reason quoted, as evidence only (§ 6 routing row).
  - **AC-6.4** (`unit`; narrowed in fix 1, X6.) The trace generator's admissible-order predicate is
    written down, and each exclusion cites the D319 B8/B8b device records
    (`docs/test/20261025-b8-editor-dialog-menu-device-check.md`,
    `docs/test/20261025-b8b-b8c-d319-menu-race-device-check.md`), not the code. The claim is only
    "M1–M4 hold on every admitted order". **It does not claim that the predicate equals AppKit's
    feasible set**: that stays unproved by D323. Where the records are silent, the predicate admits
    the order, so it over-approximates. Extra admitted orders add traces and can only produce
    spurious failures, which go to the delegator, never silent passes.
  - **AC-6.5** A planted `guard_focus` → `focus` swap at the `emit_to_window` call inside
    `dispatch_menu_action` (`8501affd:menu.rs:142`) **fails `B8(paragraph.table)`** (fix 2, opus H1;
    the earlier "B8 goes to B" was wrong). Under the swap, `emit_to_window` passes the current focus,
    B, as `focused` (`menu_availability.rs:177`), `dispatch_if_allowed` sees `focused ≠ target` on a
    W row and cancels with `stale_target` (`:121-146`), so the pin observes **zero** native emits
    instead of one to A, no D261 dispatch log (the cancel flag filters it), and a
    `ui.menu.availability` cancel with `"reason":"stale_target"` in the TestHome log. P-M fails.
    `B8(file.save)` still passes under the swap, because a `Both` row never reads `focused`
    (`:121-122`, `149`); the handoff shows both results. It is a mutation run, reverted, and the
    AC-6.1 sweep's counterexample under the same swap is quoted with it.
  - **AC-6.6** (`device`, ADR-0144 decision 1, "a native menu or window order"; fix 1, X6 and
    opus M7; card outline rewritten in fix 2 to decision 2's schema, gpt X6 and opus r2 M2.) WI-6
    changes the production path of every native menu click. After the extraction, the real app on the
    handoff SHA must still route the D319 race orders to the click owner. Card
    `docs/test/cards/D323-WI6-menu-dispatch.md`, written in WI-6. Its outline, which the card follows
    section for section:

    **Controlling AC.** D319 row, `docs/plans/20260912-frontend-backend-sequencing-order.md#d319`
    (`:757` at `8501affd` and at `54cd49e6`), 验收 column, quoted verbatim, these sentences:
    > 菜单重建时仅旧菜单已开始的选择保留原焦点，新菜单无 Begin 的快捷键以新选择时焦点为准
    >
    > `menu.action.dispatch` 在焦点后来变动时记 `via:"click_time"`。
    >
    > Fix 3：菜单跟踪已结束、尚未选中时保留该树与 Begin 时焦点；只出现在这棵旧树（不在当前树、不在活动会话）的菜单项的 WillSend 取回该焦点，一次即消费；新的 Begin 使其过期（`expired`），当前树的项（快捷键）使其作废（`superseded`）
    >
    > 真机仍须在安装版上复测 D261 第 2 步（0/300 ms 各 3 次），以及两个不同路径、同名 `README.md` 的最近文件时 A 中 Save／Highlight 后立即切到 B 仍恰一次落在 A（`via:"click_time"`）

    The card narrows how these are checked; it adds no behaviour. The Paragraph › Table… step is the
    first sentence and the Fix 3 clause applied to a mode-gated item, the one item class where the
    `guard_focus` hand-off is visible (AC-6.5).

    **Setup.**
    - The verify bundle of the handoff SHA, launched by its full path; exactly one mdpro process from
      that path; `app.ready` gives the pid and `releaseId` (rule 71, ADR-0144 decision 4).
    - The desktop GUI lock held for the whole run, and the user's per-run picsee word (ADR-0134
      decision 6).
    - `~/.mdpro/config.json` copied to the evidence folder before launch, and restored from that copy
      after quit, with `cmp` against it reported as OK.
    - The input source recorded (`input-source-before.txt`) and switched to ABC; restored after quit,
      with `cmp`.
    - Fixtures: two copies of `tests/manual-fixtures/d173-two-windows.md`, at `<run>/d319/a/README.md`
      and `<run>/d319/b/README.md`, with only B's title changed to `WINDOW B CONTROL`; both hashes in
      `fixtures-before.sha256`.
    - A opened, then B in a second window, so the recent list holds **two distinct-path `README.md`
      entries**; `recent-readmes.txt` records both paths.
    - Both windows dirty before every race (A gets a marker `A-RACE-n`, B an unsaved edit). A in
      WYSIWYG and B in Source, each confirmed by its `ui.menu.mode_report` line.
    - The timing tool: the compiled CGEvent tool from B8c,
      `~/.mdpro-redesign/device/B8c-evidence/menu-race.m` (git blob `a0355a93`, sha256 `6def599d…`),
      built to `menu-race`. Usage `menu-race title-x item-x item-y gap-ms switch(0|1)`: it checks the
      Accessibility grant, posts HID mouse down and up on the menu title and the item, stamps `item_up`,
      then posts ⌘\` after `gap-ms` and stamps `switch_key`. Coordinates come from a screenshot probe,
      as B8c's `file-menu-probe.png`. **Measured gap at `gap-ms = 0`: 11–13 ms item-up to key** (B8c
      Save runs, `save-r1-gap0.tool`: `item_up 23:36:47.594`, `switch_key 23:36:47.607`); at 300:
      313–319 ms. Computer Use cannot set a sub-50 ms gap (B8c record `:52`), so every timed step is
      `cli`.

    **Steps** (each run takes a byte-exact `~/.mdpro/mdpro.log` slice and a screenshot, as B8c's
    `run-menu.py` did):
    1. `cli`: take the lock, back up the config, record the input source, write the fixtures and
       their hashes.
    2. `cli`: launch by full path; `ps` shows one process; read `app.ready`.
    3. `computer-use`: switch the input source to ABC; open A's and B's `README.md` in two windows;
       set A to WYSIWYG and B to Source; screenshot the recent list.
    4. `cli`, ×3: File › Save in A at `gap-ms = 0` with the switch (`menu-race … 0 1`), A holding
       `A-RACE-n` and B dirty. Between runs, `computer-use` replaces A's marker with the next one.
    5. `cli`, ×3: Format › Highlight Selection in A at `gap-ms = 0` (D261 step 2), with A's `First`
       selected; between runs `computer-use` undoes the highlight and reselects.
    6. `cli`, ×3: the same Highlight at `gap-ms = 300` (the D319 row's 300 ms repetitions).
    7. `cli`, ×3: Paragraph › Table… in A (WYSIWYG) at `gap-ms = 0`; between runs `computer-use`
       dismisses the Insert Table dialog in A with Esc.
    8. `computer-use`: the shortcut control. Open a menu in A and cancel it with Esc, focus B, make
       an edit, press ⌘S.
    9. `cli` and `computer-use`: ⌘Q, choose Discard changes for the scratch fixtures only; confirm no
       mdpro process; restore the config and the input source with `cmp`; release the lock.

    **Failure condition.** Any of these fails the card:
    - in steps 4, 5 or 7, a `menu.action.dispatch` whose `target` is not A's label (`main`), more
      than one dispatch for one click, or a dispatch without `via:"click_time"` in a run where B's
      `window.focus` precedes it;
    - in step 4, `b/README.md`'s hash changes, or `a/README.md` does not end with that run's marker;
    - in step 5, B's text is highlighted or B's hash changes;
    - in step 7, a `ui.menu.availability` cancel for `paragraph.table` (the AC-6.5 mutant's
      signature), no dispatch, or the Insert Table dialog appearing in B;
    - in step 6, a dispatch not to A, or more than one;
    - in step 8, the save landing in A, or any `menu.action.dispatch` to A;
    - `app.ready.releaseId` not resolving to the handoff identity, or more than one mdpro process.

    **Not exercised, never PASS.** A 0 ms run whose log shows B's `window.focus` **after** the
    dispatch did not race, and neither did a run whose `switch_key − item_up` exceeds 50 ms, or whose
    `menu.capture` chain lacks begin → end → will_send `ended` → route `decision:"click_time"` (it
    never reached the Fix 3 path through `dispatch_menu_action`). Such a run is recorded NOT
    EXERCISED with its reason and repeated, up to three extra attempts per step; the step needs three
    racing runs.

    **Proof.**
    - **Log**, per racing run in steps 4, 5 and 7: B `window.focus` before the dispatch; `menu.capture`
      begin → end → will_send `ended` → store `source:"ended"` → route `decision:"click_time"`; exactly
      one `menu.action.dispatch {action, target:"main", via:"click_time"}`; and no
      `ui.menu.availability` cancel. Step 6: one dispatch to `main` via `focused`, before B's focus.
    - **Shortcut path, step 8.** Expected: `ui.shortcut.trigger {action:"file.save"}` and `file.save`
      success for `b/README.md`, with **no** `menu.action.dispatch`. ⌘S is handled in the webview
      (`useKeyboardShortcuts.ts:144-145`, `loggingService.logShortcut` → `ui.shortcut.trigger`,
      `loggingService.ts:95-96`), as B8c's ⌘⇧M was (record `:36`, `:46`). This step therefore proves
      M2 in the app, **not** the `dispatch_menu_action` seam; the card says so. If the log instead
      shows a `menu.action.dispatch` to B via `focused`, the step also passes and the report notes it.
    - **Effect:** step 4, the file bytes of both READMEs against `fixtures-before.sha256` and the
      markers; step 5, screenshots of A highlighted and B plain, plus B's hash; step 7, a screenshot
      of the Insert Table dialog in A, and B unchanged; step 8, `b/README.md` written. A screenshot
      never proves a negative alone: B's unchanged state is proved by its hash.
    - Per run, the tool file with `item_up` and `switch_key`.

    The tester role runs it in round one on the handoff identity (ADR-0144 decisions 3–5); the
    delegator confirmed the `device` tag (ruling Q12). D323's prep brief predates ADR-0144, but that
    does not exempt WI-6, which is granted after it.
- **RED:** `D323-WI-6`, from the retro at `verify-9b9cd40` (macOS, on the mini). AC-6.0 is a
  refactor-equivalence check with no RED, and it is named in the handoff as such.
- **Budget:** each file's pinned traces plus quick sweep under 2 s. The full sweeps are
  `menu_route_model_slow_sweep` and `menu_capture_model_slow_sweep`, `#[ignore]`d, run by
  `rust-slow` (ruling Q5).
- **Tier:** High, `src-tauri` with a production refactor (ruling Q9). WI-6 carries one `device` AC,
  AC-6.6, so it holds its slot through the round-one device run.

### WI-7: menu target token, frontend (existing test made exhaustive)
- **Paths:**
  - `tests/support/editorGenerationDomain.ts` (extend)
  - `tests/menu-target-token.test.ts` (pinned)
  - `tests/menu-target-token.slow.test.ts` (new)
- **ACs:**
  - **AC-7.1** M5 holds with up to the slow file's recorded cap of disturbances over receipt,
    switch, remount, edit, submit, render tick and confirm, and an undisturbed submit mutates
    exactly once (progress).
  - **AC-7.2** Moved to **AC-3.5** in fix 1 (opus M1): the Q4 switch trace needs
    `useWindowCloseGuard`, which this WI's token domain does not mount. Q4's answer (no token; C4)
    is recorded in § 8.
  - **AC-7.3** The existing generation property still passes unchanged.
  - **AC-7.4** Retro (fix 1, X1): at `a118914f`, the stale-Highlight trace of § 6 fails M5 (the mark
    lands in d2), for both the Source `Editor` and the WYSIWYG `MilkdownEditor`. Its control
    (`Receipt(highlight) RenderTick` in d1) passes. The trace passes at `124311c1` and at the WI's
    head. **Fallback, only if the controls cannot pass at `a118914f`** under § 6's adapter rules:
    the handoff names a receipt exception for the delegator, with the failing control's output.
    The current-head property and every pinned trace stay; no weaker RED is invented. The
    `527579af` Highlight retro of the earlier draft is withdrawn: the guard is already present
    there (`git grep abandonIfStale 527579af -- src/components` finds `Editor.tsx` and
    `MilkdownEditor.tsx`).
- **RED:** `D323-WI-7` (`tests/menu-target-token.test.ts`), from the AC-7.4 retro in `verify-a118914`,
  recorded with the § 7 WI-2 overlay. The `onHighlight` adapter sits in the support file, not in the
  receipted test file. The slow file has no receipt id.
- **Budget:** pinned under 2 s; slow under 60 s.

### WI-8: quit guard, an existing property audited against C5
- **Paths:** the existing `src-tauri/src/services/quit_guard/coordinator_*props*_tests.rs`, extended
  in place only.
- **ACs:**
  - **AC-8.1** A written mapping from each ADR-0035 decision to the existing tests that cover it.
  - **AC-8.2** Each uncovered event (window gone mid-round, a stale-round answer, a late backstop
    reply) gets an added walk step, or a counter-proof that an existing step covers it.
- **RED:** `D323-WI-8`, only if a step is added. An audit with no gap closes with no receipt.
- **Budget:** under 5 s, `rust` lane.

**Every WI's gates**
- The rule 10 per-commit lanes: unit with coverage, `typecheck:tests`, and build under
  `heavy-lock`.
- The `slow` lane for its own slow file:
  `scripts/heavy-lock.sh pnpm exec vitest run --config vitest.slow.config.ts tests/<file>.slow.test.ts`.
- `rust` and `clippy` when `src-tauri` changed.
- **Ledger.** Not touched: the WIs add tests and change no behaviour. **The sequencing row D323 is
  updated in the commit that finishes each WI.**

**Finding a live bug**
- The WI does not fix it, since that is out of scope.
- It records the minimal trace and pins it as an expected failure, with the D number in the name:
  `it.fails("D3xx: …")` in TS, or `#[ignore = "D3xx: …"]` in Rust (ruling Q3). The lane stays green
  and the bug stays visible.
- It reports the trace to the delegator, who registers the D item. **The WI then continues.**
- **A hypothesis (H-R6) is reported as a hypothesis** until a trace reproduces it.

---

## 8. Questions: resolved (rulings 2026-10-27, `D323-plan-rulings.md`, `D323-plan-rulings-2.md`, fix-2 brief)

| Q | Ruling | Folded into |
|---|---|---|
| Q1 RED for a property over correct code | The RED comes from the retro run: the pre-fix SHA in a detached `verify-<sha7>` worktree, failing with an assertion. No no-op adapter | § 7: WI-2 RED rule (WI-2…7), WI-3…7 RED lines |
| Q2 tab × after a same-id reopen | **User:** 「Cancel as stale (Recommended)」. Confirm is a no-op on the newer lifetime. Today's `BottomTabs.tsx:50-55` is **D324**; its fix is its own item | § 2 C2; AC-3.4 (pinned `it.fails`, D324) |
| Q3 live bugs | Pinned as an expected failure with the D number in the name, reported and registered; the WI continues. H-R6 stays a hypothesis until a trace reproduces it | § 3.3 H-R6; § 7 "Finding a live bug"; AC-4.4 |
| Q4 window-close branch with no token | **Both reviewers YES** (round 1, 2026-10-27): C4 covers a same-window document switch; the branch stays token-free | § 3.4; AC-3.5 (switch trace, moved from WI-7); AC-3.6 (same-id reopen against C1) |
| Q5 Rust sweeps over 2 s | `#[ignore]`d `*_slow_sweep` in the push/manual lane, the Rust counterpart of ADR-0050 | § 7 lane budgets; WI-5, WI-6 |
| Q6 platform | PR CI `rust-test` is ubuntu-only (`ci.yml:142`). The macOS-only tests are proved by the verifier's `rust` lane on the mini, and a Linux-runnable part is split out | WI-6 paths (two files) |
| Q7 G0 | G0 still binds. No dependency satisfies it, and WI-0 still records the rejection of `fast-check` | § 4 (unchanged); WI-0 context cites G0 |
| Q8 budgets | Measure in WI-1; cap at `k = 3` where a file exceeds 180 s, with the cap in the file header | § 7 lane budgets |
| Q9 extraction in WI-6 | Granted in principle: the one behaviour-neutral extraction of `menu.rs:124-148`, with a test pinning old and new outputs; High tier; scope checked by the plan review | WI-6, AC-6.0. **Scope as reviewed** (fix 1 X3, fix 2): the seam `dispatch_menu_action` holds `menu.rs:125-166` with substitutions S1–S8; AC-6.0 is a moved-lines identity diff plus existing tests unchanged, not an old-and-new output test; the behaviour oracle is AC-6.1/6.2/6.5 |
| Re-attack | No third round; N1–N6 go to the plan review as written | § 9 |

**Q4, the plan's answer, for the reviewers.** The window-close branch (`App.tsx:732-734`) should take
**no menu target token**, and the governing invariant should be **C4**. The plan expects this for
three reasons:
- **The window cannot be a stale target.** The prompt is rendered in that window, and its Confirm
  is that window's click. The token's window field can never be stale.
- **The document and generation fields would be wrong here.** A window close is not about one
  document. A token-based no-op on a document switch would refuse a close whose consent covers
  every dirty document.
- **The dangerous change is already handled.** That change is a new dirty document or an edit
  after the prompt, and `confirmClose` already re-decides it through consent (`consentCovers`,
  `windowCloseAttempt.ts:94-103`) and the attempt generation (`useWindowCloseGuard.ts:248`).

**The reviewers' answer (round 1): YES, both.**
- **gpt-auditor:** `windowCloseAttempt.ts:78-103` assesses all dirty documents, not the active id, so
  `consentCovers` stays true across a switch; `attemptRef` is unchanged, and the latched pass rechecks
  consent (`useWindowCloseGuard.ts:139-175,286-301`). A switch alone authorizes or discards nothing.
- **opus-auditor:** `handleConfirmClose` (`App.tsx:709-739`) → `confirmClose`
  (`useWindowCloseGuard.ts:241`) → the frozen `consentRef` → `consentCovers`, re-checked after every
  await. The one switch-sensitive arm is D253 H3 (flush failed at both ends), where the Discard
  re-prompts and nothing is lost.

**Folded in:** the branch stays token-free under C4. The switch trace is pinned in WI-3 as AC-3.5,
not in WI-7: the fix-1 brief asked for WI-7, but WI-7's token domain cannot drive `confirmClose`
(opus M1), and only WI-3 mounts `useWindowCloseGuard`. P-C gains the D253 H3 exception. gpt's
separate note, a same-id close and reopen while the prompt waits, is AC-3.6, pinned against C1 and
related to D324.

**Questions from fix 1, now ruled**

| Q | Question | Ruling | Folded into |
|---|---|---|---|
| Q10 | When two writes of one draft take `DRAFT_LOCK` in reverse order, D1a and D1b disagree. Which governs? | **D1a governs** (rulings-2): a trace that leaves the older text last is a live bug under Q3 | § 2 (D1a is a frontend property, fix 2), § 4.1, AC-4.1b. Not WI-5 (opus r2 H2) |
| Q11 | How does a retro RED recorded in a `verify-<sha7>` worktree reach the WI branch? | **Re-ruled in the fix-2 brief: path (a), the overlay.** Copy HEAD's `scripts/tdd/{red-receipt,unit-red-lane,phase-runner-source}.mjs` and the `unit-red` lane entry into the verify tree, uncommitted; record there; carry the record verbatim; the handoff names the `implementation-already-present` / `dirty_source` disclosure. Per-SHA adapter lines sit outside the receipted test file. Slow files get no receipt ids (`D323-WI-2b`, `-3b`, `-4b` dropped). Replaces the rulings-2 Q11 text | § 7 WI-2 "How a retro RED is recorded"; WI-2, WI-3, WI-4, WI-7 RED lines |
| Q12 | AC-6.6's `device` tag and card outline | **Confirmed `device`** (rulings-2); the outline is rewritten in fix 2 to ADR-0144 decision 2's schema | WI-6 AC-6.6 |

---

## 9. Attack round 1: responses

Attack report: `D323-attack.md` (tdd-guardian:tdd-spec-adversary, Opus, fresh context). There are
10 gaps. All are accepted and none is rejected.

| Gap | Response | Where |
|---|---|---|
| G1 safety-only | Progress clauses P-S, P-C, P-D, P-M; the oracle checks equality, not containment | § 2 Progress; AC-2.1, 3.1, 4.1, 6.1, 7.1 |
| G2 FIFO-only releases | `release(cmd, k)` for any k; reverse-order pinned trace | § 4.1; AC-1.4, AC-4.1b |
| G3 bounds | Disturbance bound with setup outside it and releases unbounded; every defect trace inside the slow bound; budget ruling Q8 | § 4.1; AC-2.1, 3.1, 4.1, 5.1, 6.1; Q8 |
| G4 no draft alphabet | Frontend draft alphabet and observables listed | § 3.3 |
| G5 routing below the glue | Drive `route_for_event` and the guard derivation, or extract it under a revised grant; `Muda(y≠x)` | § 3.4; AC-6.1 |
| G6 unobservable S6 and D1 | Toast sink; D1 (now D1b) observed through the `revision` argument of `delete_discarded_draft` | § 4.1 sinks; § 3.3; AC-4.1b |
| G7 vacuous C3 clauses | `McpWrite`, `QuitBackstop` in the close and draft alphabets | § 3.2, § 3.3 |
| G8 model-only pruning | Releases enabled from the SUT's held set; held-set and multiset mismatch fails | § 4.1; AC-1.4b, AC-2.2b |
| G9 fake and adapter by construction | Hand-authored trace rows committed before WI-5; adapter frozen against the control first | § 3.3; § 6; AC-4.3b, AC-6.3 |
| G10 retro fails for the wrong reason | A control trace per retro; only a `TraceFailure` counts | § 6; AC-2.4, 3.3, 4.3, 6.3 |

The cases were added, so one re-attack round followed (rule 71 step 3). The report is in
`D323-attack-r2.md`.

### Round 2: responses

| Gap | Status after round 2 | Response | Where |
|---|---|---|---|
| G2 / N1 (High) | amended | `Process` and `Reply` are separate events for stateful boundary commands; pinned `P1 P2 R2 R1` | § 4.1 `heldIpc` |
| N2 (High) | amended | Spec-effect and mechanism command classes; equality applies to spec-effect only, and each class cites a clause | § 2 Progress |
| N3 (Medium) | amended | The skeleton is four separable events; a partial click is its own disturbance; pinned shortcut-supersedes trace | § 4.1 |
| G5 / N4 (Medium) | **Resolved by ruling Q9** (extraction granted in principle; the scope goes to the plan review) | The extraction is certain; the emit sink goes below `emit_to_window` (AC-6.5); without a grant G5 stays open and is recorded | § 7 WI-6; Q9 |
| G9 / N5 (Medium) | amended | The adapter passes real tree addresses to `native_selection_id`; a second control on an old-tree item; the old log reason is quoted | § 6; AC-6.3 |
| N6 (Low) | amended | "Undisturbed" defined up to the last release; Edit is a disturbance | § 2 Progress |
| G3 (conditional) | **Resolved by ruling Q8** | Measure in WI-1, then cap at `k = 3` above 180 s | § 7 lane budgets |

Rule 71 step 3 allows no third attack round. N1, N2, N3, N5 and N6 were amended after round 2 and
have **not** been re-attacked. Per the rulings, there is no third round, and they go to the plan
review (gpt-auditor and opus-auditor) as written.

## 10. Out of scope
- Any test or production code, which is all in this plan's WIs after a grant.
- Fixing anything a property finds; that gets a new D item.
- ADR-0047 control channel, ADR-0144, ADR-0145.
- A snapshot or sequence argument to `save_draft` that would let the Rust service enforce D1a. That is
  an IPC contract change and needs its own ADR (fix 2, opus H2).
- Device checks **of the models**. The models take AppKit's order as an input, and D323 does not
  claim that AC-6.4's predicate equals AppKit's feasible set (fix 1, X6). WI-6's production
  refactor is **not** out of scope for ADR-0144: its AC-6.6 is `device`.

---

## 11. Plan review round 1: responses (fix 1, 2026-10-27)

Reports: `gpt-auditor/D323-plan-r1.md` (C0 H6 M1 L0) and `opus-auditor/D323-plan-r1.md` (C0 H4 M8 L4).
Merged verdict: `delegator/D323-plan-r1-verdict.md`. Every new `file:line` was checked at `8501affd`, or at
the SHA it names, with `git show` / `git grep` (commands in `D323-plan-fix1-handoff.md`).

### Highs

| # | Finding | Close taken | Where |
|---|---|---|---|
| X1 | WI-7's retro at `527579af` cannot fail: the M5 guard is already there | Both reports proposed the same close: the retro moves to `a118914f`, the parent of `124311c1`. There the token is dispatched but no editor checks it. The adapter is limited to one line, the `onHighlight` handler, mirroring each SHA's App. gpt's alternative (a receipt exception plus a current-head property) is kept only as the fallback if the controls fail | § 0; § 6 table row and adapter bullet; AC-7.4; WI-7 RED |
| X2 | The draft `Process` FIFO premise is false (its Rust clause, `snap`, is withdrawn in fix 2: § 12 H2) | Both closes satisfied. `Process` is any-order for every held call of every `DRAFT_LOCK` command, and the save order is assigned at that step (gpt). The P2-first orders are pinned with independent text and revision assertions (opus's `P2 P1 R1 R2` / `P2 P1 R2 R1` and gpt's "both processing orders"). D1 is split into D1a (rule 60) and D1b (ADR-0127), their conflict is stated, and the delegator rules as Q10 (opus). The Rust layer sees the reversal through trace order and `snap` | § 1.3 Locks; § 2 D1a/D1b; § 3.3; § 4.1 `heldIpc`; AC-1.4c, AC-4.1, AC-4.1b, AC-5.1; Q10 |
| X3 | The Q9 extraction cannot meet AC-6.5, and a wider one breaks AC-6.0's oracle | Both satisfied: gpt's first option (a testable dispatch seam that keeps the real callsite body and guard in the path) in the shape opus specified (`dispatch_menu_action` holding `:125-163`, a native-emit sink, `discard_native_only_capture` first). AC-6.0 is refactor-equivalence only, by a moved-lines identity diff plus existing tests unchanged; the copied oracle is dropped (opus). The residual accessor lines are covered by AC-6.0's identity check and the device AC-6.6. MockRuntime is recorded as the losing option | § 3.4 Rust; WI-6 production change, AC-6.0, AC-6.1, AC-6.5 |
| X4 | The second save retro `4775f410` has no invariant it must break (gpt only) | Accepted with gpt's close: new **S8**, sourced from the D290 row's H4 text, not from code. RED at `4775f410`, GREEN at `f3488d0c` and at head. "S5 or S7" is withdrawn; gpt's trace through `saveService.ts:256-274` shows S5 permits the demoted result | § 2 S8; § 6 row; AC-2.1, AC-2.4; § 4.1 counts |
| X5 | N2 is still contradictory: whole held-set equality against mechanism calls (gpt only) | Accepted with gpt's close: equality covers spec-effect calls only, in the multiset and the held set. Mechanism calls are checked for liveness and permitted responses only. The same rule is stated in § 2, § 4.1, AC-1.4b and AC-2.2b, with a positive case (an undisturbed Save holding `get_preferences` passes) | § 2 oracle; § 4.1 `enabled`; AC-1.4b, AC-2.2b |
| X6 | AC-6.4's native-order feasibility sits outside ADR-0144's device proof (gpt only; opus M7 is the same point at Medium) | Accepted, with both of gpt's options applied to different claims. **Narrowed:** AC-6.4 is `unit` and claims only "M1–M4 on every admitted order"; AppKit feasibility is stated as unproved, and the predicate over-approximates. **Device:** the production refactor gets AC-6.6, tagged `device`, with a card outline derived from D319's controlling AC, run by the tester role in round one on the handoff identity. § 10 no longer exempts WI-6 | AC-6.4, AC-6.6; § 10; Q12 |
| X7 | The close retro trace cannot both fail at `527579af` and pass at the fix (opus only) | Accepted with opus's close. The trace is the real D261 H1 shape (two closes, reopen, edit, release; `tests/d261-close-commit-stale.test.tsx:91-109`). `Reopen` is defined from the spec as enabled only for a closed id, with `Activate` for an open one. The count is corrected to 4, the close sweep is never capped below `k = 4`, and every retro trace is also replayed explicitly whatever the cap | § 3.1, § 3.2 event definitions; § 4.1 counts; § 6 row; AC-3.3; § 7 Sweep caps |

**Q4.** Both reviewers answered YES, and both traces are recorded in § 8. The switch trace is pinned in WI-3
(AC-3.5) and not in WI-7, as § 8 explains. The same-id reopen while the window prompt waits is AC-3.6,
against C1, linked to D324.

### Mediums and Lows

| Item | Taken / left | Where, or why left |
|---|---|---|
| gpt M1: the `k = 3` fallback leaves the k = 4 ACs unchanged | **Taken** | § 7 Sweep caps rule 3; every "up to 4" AC now reads "up to the recorded cap", and the handoff states what is lost |
| opus M1: Q4 switch not drivable by any WI | **Taken** | `Switch`, `FlushFail` in § 3.2; P-C exception (D253 H3); AC-3.5 |
| opus M2: no Rust slow lane | **Taken** | WI-1 adds `rust-slow` to `.claude/tdd-guardian/config.json`; AC-1.8; WI-5 and WI-6 name it |
| opus M3: budgets cannot be judged yet; k and time contradictions | **Taken** | measurement moved to each area WI; pinned-only default fallback; the order of fallbacks (reduce the id set, then `k = 3`, then split the file); AC-2.1's `k = 2` and WI-2's 120 s corrected |
| opus M4: how a verify-worktree receipt reaches the branch | **Taken as a proposal**, ruling Q11 | § 7 WI-2 "How a retro RED is recorded". The receipt tooling's behaviour across trees is the delegator's to rule, so the plan does not settle it alone |
| opus M5: composite disturbances untested in the harness | **Taken** | AC-1.7 |
| opus M6: drafts retro control unnamed | **Taken** | § 6 controls: an undisturbed `DraftTick`; progress clauses are controls only where they predate the fix |
| opus M7: ADR-0144 not named for WI-6 | **Taken** (merged with X6) | AC-6.6 |
| opus M8: model-independence leaks (names, upsert semantics, § 1 as input) | **Taken** | § 5 rule 3 reworded (§ 1 is not a model input), new rule 8 (a glossary with a clause per variable); `Activate` removes the upsert semantics; the H3 arm is now a spec clause (D253 row) |
| opus L1: `menu.rs` is already 483 lines | **Taken** | `dispatch_menu_action` goes to a new `menu_dispatch.rs` |
| opus L2: WI-7 "to length 4" | **Taken** | § 3.4 now says disturbances |
| opus L3: duplicate RED lines; AC-6.5 before 6.4 | **Taken** | WI-5 and WI-6 have one RED line each; ACs reordered |
| opus L4: `save_draft_claimed` has no class | **Taken** | spec-effect, § 2 |
| Left | none | — |

### Rejected approaches in fix 1
- **Keeping `527579af` for WI-7 with a receipt exception as the primary path.** A real pre-fix SHA exists
  (`a118914f`), so an exception would be a weaker RED than the defect allows.
- **Keeping per-command FIFO and adding only reversed replies.** This was the N1 half-close. A std `Mutex`
  gives no FIFO, and ADR-0127 says only "under the draft lock".
- **Extracting only the guard derivation (`:127-134`), as the earlier draft read Q9.** It leaves the
  `guard_focus` hand-off in `AppHandle` code, so a swap there is invisible.
- **A copied `8501affd` before-image as AC-6.0's oracle.** Once the closure moves, it cannot be a byte copy,
  and an adapted copy is not independent.
- **Making `emit_menu_action` generic over `Runtime` with MockRuntime.** It needs tauri's `test` feature,
  which is a dependency-feature ADR, for about 8 accessor lines that the identity check and AC-6.6 cover.
- **Defining `Reopen` of an open id as a new lifetime.** That copies the code's in-place-upsert semantics
  into the model, which opus F1 and M8 both reject.
- **Keeping "S5 or S7" for the H4 retro.** Neither is entailed (gpt H1), and naming two invariants hides
  which one the defect breaks.
- **Exempting WI-6 from ADR-0144 because the prep brief predates it.** gpt H6 is right that the WI is granted
  after acceptance.

---

## 12. Plan review round 2: responses (fix 2, 2026-10-27, post-cap)

Reports: `gpt-auditor/D323-plan-r2.md` (C0 H2 M0 L0) and `opus-auditor/D323-plan-r2.md` (C0 H2 M3 L3).
User ruling (ADR-0129): 「Fix + scoped confirm (Recommended)」. Each raiser confirms on the fix diff only.
Code references are at `8501affd` unless a SHA is named; commands in `D323-plan-fix2-handoff.md`.

### Highs

| # | Raiser | Close taken | Where |
|---|---|---|---|
| X3, range half | gpt | AC-6.0's identity range and the old-SHA retro adapter range are **`menu.rs:125-166`** (the closure ends at `:165`, `route_for_event` is at `:166`). The substitutions are listed in full as S1–S8, by line, before and after; the check is a scripted apply-then-diff. The retro adapter uses the same S1–S8 | § 3.4 Rust; § 6 adapter bullet; WI-6 production change, AC-6.0 |
| X3, mutant half (H1) | opus | `B8(file.save)` cannot see the `guard_focus` swap: `file.save` and `format.highlight` are `"v2": "both"`, and `dispatch_if_allowed` reads `focused` only for non-`Both` rows (`menu_availability.rs:121-135`). New pin `B8(paragraph.table)` (W) with A `wysiwyg`, B `source`: one emit to A at HEAD; under the swap, zero emits plus a `stale_target` cancel. Gated actions (`paragraph.table` W, `edit.deleteWord` S) and `ModeReport` events against a real `MenuState` join § 3.4's alphabet so the sweep can kill the mutant. "B8 goes to B" is corrected in AC-6.5; the § 6 routing row and AC-6.3 now say the emit goes to B only for a `Both` row | § 3.4 alphabet and pins; § 6 routing row; AC-6.1, AC-6.2, AC-6.3, AC-6.5 |
| X6 | gpt (opus M2) | The AC-6.6 outline is rewritten to ADR-0144 decision 2's schema with all five M2 changes: the 0 ms race is `cli` through B8c's CGEvent tool (path, hashes, usage, measured 11–13 ms item-up to key); a Setup section (two dirty windows from `tests/manual-fixtures/d173-two-windows.md`, two distinct-path `README.md` recent entries, config backup and restore, input source); the D319 row quoted verbatim with its anchor, Fix 3 clause included; the shortcut step's expected log path (`ui.shortcut.trigger`, no `menu.action.dispatch`) with the statement that it proves M2, not the seam; the row's 0 ms ×3 and 300 ms ×3 repetitions; and a gated-row race (Paragraph › Table…) | WI-6 AC-6.6 |
| H2 | opus | AC-5.1 asserts only what the service contract carries: the last write processed under the lock wins (the service half of D1b), D2, D3, D5, and the service halves of D4 and D6. D1a is stated as a frontend issuance property, proved in WI-4. The `snap` argument and the reversed-`snap` pins are removed from § 3.3 and WI-5; AC-5.2's shared table has no row keyed on snapshot order. § 4.1's "WI-5 shows whether the real service behaves as the fake does" is rewritten to match | § 2 D1a/D1b paragraph; § 3.3 Rust alphabet; § 4.1 pinned orders; AC-5.1, AC-5.2; § 10 |

### Q11, re-ruled

Path (a), the overlay, written into § 7 WI-2 "How a retro RED is recorded" (seven numbered points) and the
RED lines of WI-2, WI-3, WI-4 and WI-7. `D323-WI-2b`, `-3b` and `-4b` are dropped.

### Mediums and Lows (opus round 2)

| Item | Taken / left | Where, or why left |
|---|---|---|
| M1 (Q11 cannot record at 4 of 5 retro SHAs; slow files) | **Taken** (the Q11 re-ruling) | § 7 WI-2 points 1–6 |
| M2 (card outline) | **Taken** (the X6 close) | AC-6.6 |
| M3 (AC-3.6 has no entry path behind the window prompt) | **Taken** | AC-3.6: a reproduction is hypothesis **H-C6**, pinned and reported, not registered until an entry path is named |
| L1 (Q10–Q12 still "open") | **Taken** | § 2 paragraph; § 8 table "Questions from fix 1, now ruled" |
| L2 (§ 8 Q9 row stale) | **Taken** | § 8 Q9 "Folded into" states the reviewed scope; the ruling text is kept as ruled |
| L3 (AC-3.4 after 3.5 and 3.6) | **Taken** | WI-3 order |
| Left: the CGEvent tool lives outside the repo (`~/.mdpro-redesign/device/B8c-evidence/menu-race.m`) | **Left** | Moving it into the repo (for example `scripts/device/`) is tooling scope outside D323. The card pins it by git blob and sha256, so a changed tool is visible. The delegator may register it |

### Rejected approaches in fix 2
- **Keeping D1a at the Rust layer with a `snap` test argument.** The service never receives it, so the
  assertion would fail by construction and register a defect the contract entails.
- **Adding a snapshot argument to `save_draft`.** It is an IPC contract change and needs its own ADR.
- **Pinning AC-6.5 on `format.clearFormat`.** Also W, and valid, but `paragraph.table` already has a
  production precedent for a mode-gated click test (`menu_availability_m4_integration_tests.rs:215-245`)
  and a menu item the card can drive (Paragraph › Table…).
- **Running the 0 ms race through Computer Use.** B8c shows it cannot set a sub-50 ms gap; such a run
  would never reach `click_time` and would be NOT EXERCISED.
- **Using ⌘S as proof of the seam.** It is handled in the webview and never reaches `dispatch_menu_action`.
- **Q11 path (b), a gate exception per WI.** The re-ruling chose the overlay.
