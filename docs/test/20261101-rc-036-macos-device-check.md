<!-- Device-check record. gpt-auditor's report on the Mac mini (~/.mdpro-redesign/device/RC036-macos-report.md), committed verbatim below by herdr-delegator. Brief: ~/.mdpro-redesign/device/brief-RC036-macos.md with its Rerun 2 section and the two continuation files (not in the repo). Gate: PASS, accepted by the user with two partial rows tracked in #581. -->

# 0.3.6 RC regression on macOS, locked app tree `fc61e93c` (2026-11-01)

**Gate: PASS** (user, 2026-11-01: 「Accept Now, create a github issue about the two partial rows」). **Regressions: 0 proven.**

## Delegator check

- **Lock by app tree, not commit** (user: 「现在就开始MacOS回归」). Locked SHA `fc61e93c`; `src` `448fea8b…`, `src-tauri` `93c7488b…`, `package.json` `83a3c1ec…`. Every commit still to land before the cut must leave these three unchanged, or the regression is rerun. The release check proves it on the locked release SHA.
- **Identity.** Two valid launches from the verify bundle, both `app.ready` `releaseId 0.3.5-dev@fc61e93c768aa6d01936c08e07afd6a1e0f4945c`; binary `66db0485…e2b6`. Run 1 (`RC036-macos-report-run1.md`) was voided at the identity gate because `pnpm device:identity --file` opened the installed app; that is the tooling defect [D350](../plans/20260912-frontend-backend-sequencing-order.md#d350), and Rerun 2 launched with `open -n -a <bundle>`.
- **Physical Esc** (D317) was pressed by the user on request (「Esc pressed」); the tester proved one `ui.dialog.escape`, one `ui.dialog.cancel` and `focus-return {focus:"editor"}`.
- **Load.** The heavy-lock keeper for this batch died mid-run; the delegator reclaimed the stale lock for picsee, then re-held it once picsee yielded on the user's word 「先让picsee release gui lock 和heavy lock，mdpro完成之后，picsee再继续相关gui test和heavy test」. Every D319 timing row ran with the 1-minute load below 8 (about 1.9–2.6); no row was counted while the load was above it.
- **Partial rows, accepted and tracked in [#581](https://github.com/anzchy/mdpro/issues/581):**
  - **W4d** (delete while open): safe outcome, but the external open made a second window instead of a tab, so the card's topology was not proved. It passed on 0.3.5. Whether this is a behaviour change is the open question in #581.
  - **B9 D305:** Discard deleted exactly the second window's two drafts and kept the control draft, but the relaunch Recovery listing was not shown.
- **D152** is NOT EXERCISED 3/3 (`modify_name` only), unchanged since 0.3.2; not a regression.
- **Known issues** D292, D294 and D313 were not counted. D294 did not reproduce in B9.
- **Cleanup** verified in the report: config restored (`cmp` 0), drafts empty, no mdpro process, both locks free (`gui-lock.sh status` FREE, no heavy lock).

---

# RC036 macOS regression — locked tree `fc61e93c`

**Tester:** gpt-auditor · **Run:** 2026-11-01 16:50–18:19 +0800 · **Overall:** no proven regression on the rows completed. Two rows remain partial, and D152 remains not exercised. This report supersedes `RC036-macos-report-run1.md`, whose installed-app launch was voided at the identity gate. The valid run used the verify bundle throughout.

## Build, identity, and evidence

| Check | Result |
|---|---|
| Locked SHA | `fc61e93c768aa6d01936c08e07afd6a1e0f4945c`, detached `verify-fc61e93` worktree |
| `src` tree | `448fea8bf178c6709e5dac6ab02b76f436f11352` |
| `src-tauri` tree | `93c7488b7520e91037416f8522e82919cb16aa62` |
| `package.json` blob | `83a3c1ec9a781b5c4ee52576cd1ad9178196c353` |
| Bundle | `/Users/jack/Documents/mac-app/mdpro-wt/verify-fc61e93/src-tauri/target/release/bundle/macos/mdpro.app` |
| Binary SHA-256 | `66db04850aafa9dbf5a695f801bf55ab257e453f69ff32f6bb1cb9ef11b9e2b6` |
| Bundle version and release ID | `CFBundleShortVersionString=0.3.5`; `0.3.5-dev@fc61e93c768aa6d01936c08e07afd6a1e0f4945c`. The version bump is deliberately later than this locked app-tree check. |
| Build | App bundle produced; `pnpm tauri build --bundles app` then exited 1 at expected updater signing: public key present, private key absent. `RC036-macos-evidence/build.log`. |
| Valid launches | PID 5427 at 16:50 and PID 45075 at 18:18, both from the exact verify bundle. Both `app.ready` entries had the release ID above. The second launch checked the restored default Quote shortcut. |
| Evidence | `RC036-macos-evidence/logs/mdpro-final.log` (104,689 lines; line numbers below), `screenshots/`, `timing/`, `work/`, and `config.json.before`. Timing fixtures and source code stayed in the evidence directory. |

The run used the GUI acquisition `02cd1117-80c0-47c0-873b-7a7e1fe3788b`. Before every timing-sensitive D319 row, `uptime` 1-minute load was below 8 (about 1.9–2.6). The initial >8 load was reported in `RC036-macos-waiting-load.md` and no timing row was counted during that interval. The user pressed physical Esc for D317 after `RC036-macos-waiting-esc.md` was sent; the physical key produced the expected keydown receipts.

## Part A — watcher regression

| Item | Verdict | Proof and limit |
|---|---|---|
| W1 seeded open | PASS | Opened scratch `work/w.md`; `file.watch.register baseline:"seeded"`; no prompt on open. |
| W2 unchanged reopen | PASS | Reopened unchanged scratch file; unchanged watcher decision, no reload prompt. |
| W3 external edit | PASS | External edit emitted Modified and one reload prompt; Reload displayed the changed bytes. |
| W4 atomic replace | PASS | Atomic replacement of scratch file surfaced the modified-file prompt, not silent overwrite. |
| W4d delete | PARTIAL / NOT EXERCISED as written | Delete was observed safely, but the external-open route created a second window instead of the prescribed tab. The exact card topology was not proved. No regression claim. |
| W4r rename | PASS | Rename/move of scratch file produced the deleted-path handling and preserved the open document until answered. |
| W8 Save As | PASS | Save As to a new scratch path updated watch registration; later external change reached the new file. |
| W5 save then edit within 3 s | PASS | Redone at 17:53:18–20: Cmd-S success, external edit emitted Modified 2.493 s later (`102179`, `102189`), and reload prompt at `102194`; Reload worked. The earlier slow attempt is void for this timing row. |
| W6 twenty saves | PASS | Twenty successive saves of scratch copy produced self-write/unchanged watcher decisions without a reload prompt. |
| W6b queued bursts | PASS | Three burst series, with extra control saves, produced no self-write prompt. |
| W7 >10 MiB | PASS | `work/big.md` over 10 MiB opened, changed externally, and produced a reload prompt without truncation. |
| W9 close/unwatch | PASS | Closing the scratch tab unregistered its watcher; subsequent external edit did not reopen/prompt. |
| D152 safe save, three variants | NOT EXERCISED (3/3) | macOS emitted `modify_name` rather than the required `remove` event in the safe-save attempts. This was also unexercised on 0.3.5. |

**Regressions: 0 proven.** Eleven rows passed, W4d has a topology gap, and D152 was unreachable under the event sequence received. The source-vs-WYSIWYG coverage differs from the older watcher card where noted in the run log; no claim is made for an unproved mode variant.

## Part B — 0.3.6 scope re-check

| Item | Verdict | Proof and limit |
|---|---|---|
| B1 D290 | PASS | Both `mv` and `rm` of a scratch original: Cancel then Original gave `file.save.recreate_choice` (`99254`, `99272`, `99340`, `99358`); no pre-choice save. |
| B1 D255-WI-3d Save As | PASS | New target saved; already-open target and symlink alias refused; deleted original reached panel; cancellation wrote nothing and target hashes stayed unchanged. |
| B1 D214 | PASS | Undo to saved cleared dirty in both modes; Ignore after external change then Undo kept the changed/dirty distinction. |
| B1 D163 | PASS | Deliberate permission denial produced `file.save fail`, kept dirty state, and left scratch bytes unchanged. |
| B2 D246 H-1/H-2 | PASS | rm/recreate coalesced to Modified; unreadable-file path emitted Modified with `unchangedCheck:"read_failed"`, not Deleted. |
| B2 D171 | PASS | Background dirty file change was held until activation; Cmd-S was blocked pending the prompt. |
| B2 D101 | PASS | Covered by Part A W6's 20-save loop; no reload prompt. |
| B3 D258 and WI-4.3b | PASS | Both-theme Tab focus ring screenshots; load failure fixed text and save-failure rollback with a temporarily unreadable config. `b3-*-settings-focus.png`, `b3-dark-preferences-failure.png`. Loading transient was too brief to capture, as in the prior PASS record. |
| B3 D260/D262/D257/D227 | PASS | Rail, narrow Settings window, About/prefs navigation, shortcut conflict, Link/Table inputs and Outline checked in both themes. Screenshots `b3-*`; the prior failure rows were not repeated. |
| B3 D222 | PASS | Flat pixels in `b3-light-selected-outline.png` are foreground `#2354C1`, background `#D9E2F9`; WCAG ratio computed from decoded RGB is **5.209:1**, matching the previous PASS. |
| B5/B5b M4 tree | PASS | Native File/Edit/Paragraph/Format/View/Themes/Window/Help tree inspected in WYSIWYG and Source; mode-specific enabled states and checked modes followed the active editor. |
| B5/B5b Switch Documents; Themes/Help | PASS | MRU document switched once; theme and Help menu selections produced their respective success lines. |
| B5/B5b WI-3c find/replace | PASS | WYSIWYG Find, Next/Previous wrap, Replace and Replace All; editor-focused one-step Undo and Redo restored/reapplied document bytes. |
| B5c M3a | PASS | Focused W and S native availability differed correctly; minimizing both windows yielded `ui.menu.build disabledCount:6` (`103287`), Table and Math disabled and no mode check. `b5c-source-paragraph-menu.png`, `b5c-no-focus-*.png`. |
| B5c D261 step 1 | PASS | W then S Format Highlight menu click dispatched/select-success once to the focused window (`102378–79`, `102428–29`); only its fixture gained `==highlight==`. |
| B5c D261 step 4 | PASS with unreachable Save As subcase | Table submission after document switch canceled `reason:"stale",stage:"table_submit"` (`102480`); close-confirm after switch canceled `stage:"close_confirm"` (`102515`). Native Save As sheet prevented switching, the safe outcome noted in the prior record. |
| B5c M3b | PASS for reachable matrix | Both modes: inline marks, Link/Image picker, H1–H6, Paragraph, heading increase/decrease, fences, Quote, lists, Indent/Outdent, Select Word/Line, Find routing; W Table/Clear Format, S Math/Delete Word/table keys. Native dispatch/select and saved effects inspected in `work/b5c/m3b-{w,s}.md`. Modal-open refusals and W Link stale callback were logged; S Link stale is separately B9 below. |
| B6 WYSIWYG v2 chords | PASS | Cmd-I/U, Shift-Cmd-X, Cmd-backslash, Cmd-D/L, Option-Cmd-[ / ], Shift-Cmd-I each had the editor effect once on copied `work/b6/shortcuts.md`; Image picker canceled. |
| B6 M1a migration | PASS | Custom v1 Quote `Cmd+Option+9` survived; `preferences.shortcuts.migrate` changedCount 14 (`100654`), changed defaults moved to v2. Original config was restored for the later default Quote control and again at final cleanup. |
| B6 D165 | PASS | Under Settings, Unsaved changes and External change dialogs, Cmd-W/N/O each canceled `reason:"modal-open"` (e.g. `103651–56`, `104414–18`, `104478–82`); dialog remained until explicit dismissal. |
| B6b Source and WYSIWYG remaining chords | PASS with configuration note | Source marks, fences, lists, quote, Math, selection, Image and Delete Word; W inline Code, fences, lists, quote, and wrong-mode Math refusal. Saved `work/b6b/{source,wysiwyg}.md`. First sweep used the intentionally custom migrated Quote chord `Cmd+Option+9`; after restoring original config/relaunch, `Cmd+Shift+B` yielded `> quote target line` in `work/b6b/default-quote.md`. Source Cmd-D and W inline Code prove by effect, as their owners do not log by design. |
| B6b M7 list | PASS | Groups/rows, unavailable and capability labels, fixed keys, F6 conflict refusal and F7 save observed. Reopened Settings and a *new window* both showed `Export HTML Active: Cmd+Shift+E · after restart: F7`; Minimize is known D296. |
| B8 D317 | PASS with control-tab deviation | Physical Esc `100857–59`; W and S synthetic Esc, Cancel, backdrop and explanatory-text-then-Esc all produced one `ui.dialog.cancel` and `ui.dialog.focus-return focus:"editor"` (`104107`, `104163`, `104235`, `104283`, `104332`, `104381`); unclicked `Q` landed at preserved caret, and Undo/Save restored bytes. The original two-tab control topology was not fully reconstructed in these later variants. |
| B8 D318 | PASS | Menu and key ordered↔bullet in both directions, nested parent conversion with bullet children retained, one Undo to original, `no_change` on already-bulleted item (`103944`), save/close/reopen hash `fcfc77e4…`, then restored original. |
| B8 D320 | PASS | W Math and S Table/Clear Format key chords each showed the one mode-only toast and `ui.menu.select cancel reason:"wrong_mode"` (`101238`, `101296–97`, `103626`); wrong-mode native items grey. S Math and W Clear Format positive controls edited correctly without toast; fixture bytes restored. |
| B8b/B8c D319 0 ms race and static control | PASS | Fresh `uptime` before each timing row, below threshold 8. Highlight **5/5** at 0 ms (`hl-gap0-r1`, `r2-retry`, `r3`, `r4`, `r5`): B focus preceded dispatch, but each `format.highlight` targeted A/main `via:"click_time"`; A highlighted. Save **2/2** at 0 ms: B focus preceded `file.save`, yet A/main saved and B bytes stayed unchanged. Static A control highlighted via `focused`. Evidence in `timing/*.log`, `*.tool`, `*.png`. An initial r2 attempt missed the native item and is void (no dispatch). |
| B9 D305 | PARTIAL / NOT EXERCISED for relaunch listing | Two second-window drafts existed, then Discard deleted exactly those two (`101996`, `102000`); first-window control draft remained and PID 5427 stayed alive (prior D294 observation did not reproduce). The original card's one-row Recovery listing at relaunch was not shown: clean Quit offered no Keep Draft path for the still-dirty control, and the test copy was explicitly discarded before final quit. `b9-d305-close-prompt.png`. |
| B9 M3b Source link-stale | PASS | Link modal opened with `screen:"source"`, then switched to WYSIWYG; `ui.link-insert.cancel reason:"view-mode-changed"` (`102091`, `102099`), bytes unchanged. |
| About and quit | PASS | About displayed `Version v0.3.5`, matching this pre-bump bundle. Every counted final quit window logged `app.quit.check answer:"clean"` (`104523–36`, `104679`, `104682`) and `app.quit success` (`104688`); no mdpro main process or draft file remained. |

**Regressions: 0 proven.** B9 D305 is incomplete because its relaunch Recovery listing was not obtained. B5c's Save As switch was natively unreachable as in the earlier pass. All other listed rows had their decisive effect; the B8 D317 control-tab topology and B6b custom-first shortcut sweep are disclosed above.

**Prior non-PASS rows outside this re-check:** B1 D299 partial, D291/D273 step 5 fail, D241 not exercised; B2 D178 not exercised; B5/B5b M3a/D261/M3b not exercised there but completed in B5c; B5c D261 step 2 fail, superseded by B8b/B8c D319; B6 Source/M7 not exercised there, completed in B6b; B8 original D319 fail, superseded by B8b/B8c; B9 D299 partial, D241 partial, D158 not exercised. Known D292/D294/D313 were not counted as regressions.

## Cleanup, lock, and TDD Guardian

- Scratch documents only were edited. `verify-fc61e93` remains in place; no repository file was edited or committed. The three locked tree/blob identities above were unchanged. The input source was ABC throughout this run.
- The last `app.quit` was 18:19:01.993, with clean checks and no remaining `tauri-app` process. `~/Library/Application Support/mdpro/drafts/` was empty. `~/.mdpro/config.json` was copied from `RC036-macos-evidence/config.json.before`; final `cmp` returned 0 after the last quit.
- `.agents/skills/mdpro-delegator/scripts/gui-lock.sh release RC036-macos --acquisition-id 02cd1117-80c0-47c0-873b-7a7e1fe3788b` reported `REFUSED: GUI released but heavy keeper could not be released`. Subsequent `gui-lock.sh status` reported `FREE`; keeper PID 27471 was gone. `scripts/heavy-lock.sh true` exited 0 and reclaimed the stale heavy lock, as in the earlier void run.
- `$tdd-guardian:tdd-guardian-workflow` config validation passed with no warnings in the initial session. This is empirical device QA, with no code work item, test implementation or repository diff to feed the plan→red→green→coverage→mutation→review chain. No code-change gate was claimed green and no commit/push was run. The applicable device gates were identity, row receipts, byte effects, and cleanup above.
