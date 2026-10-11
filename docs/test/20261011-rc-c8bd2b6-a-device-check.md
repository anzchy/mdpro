<!-- Device-check record. Condensed by mdpro-delegator from the report written by real-device-tester (dtrack, Mac mini); brief: docs/pending/20261011-brief-rc-c8bd2b6-a.md (untracked). 15 PASS / 0 FAIL / 0 RESIDUAL; D152 outcome verified, Remove path not exercised (accepted by the user's ruling); W4r KNOWN (D107); item 10 NOT EXERCISED by design. Findings registered: D163 (F1), D164 (F2), D165 (F3). -->

# 0.3.1 RC regression, part A, on `c8bd2b6` (D32, D68, D69, D86, D112, D138, D152, gate items 6–10): report (2026-10-11)

| Field | Value |
|---|---|
| Build | `c8bd2b6` (`c8bd2b63481a3a03552a259c7845c04cc47ea1ea`), the locked 0.3.1 candidate; About shows **mdpro, Version v0.3.1** |
| Bundle | `tauri-app` sha256 `16dfdd304e18639b3dfac4fc9bb03d00e34c90bcc20d080be6da02bb079f4e39` = `BIN_SHA` ✔; `stat -f %m` `1791717725` = `BIN_MTIME` ✔; `git -C $WT rev-parse HEAD` = `c8bd2b63481a3a03552a259c7845c04cc47ea1ea` ✔; ancestors `819fa2c` `ac79c63` `658bc1d` `d91fb38` `bbf5a5b` `eafccb4` `b3eb3a4` all `0` ✔; sidecar `mdpro_mcp` `-rwxr-xr-x` 8012832 B ✔ |
| Brief | `docs/pending/20261011-brief-rc-c8bd2b6-a.md` (on the mini: `~/.mdpro-redesign/dtrack/briefs/20261011-brief-rc-c8bd2b6-a.md`) |
| Tester | real-device-tester (tmux `dtrack`, Mac mini), one run in zsh, no other GUI session; no repo edits, commits or pushes |
| Date | 2026-10-11, 19:29–19:47 (+08:00) |
| Report origin | mini `~/.mdpro-redesign/dtrack/reports/20261011-rc-c8bd2b6-a.md`; MacBook copy `~/.mdpro-redesign/reports-in/20261011-rc-c8bd2b6-a.md` (453 lines) |
| Log | `L` numbers are lines of the mini's `~/.mdpro/mdpro.log`; the run's slice is L15503–L16517. Shots are in the tester's `reports/shots/`, all 1200 × 800 |
| User's ruling | 「D152 按结果接受，F1 留到 0.3.2，继续 B 部分 (Recommended)」（2026-10-11） |

## 1. Build and settings

| Check | Result |
|---|---|
| Input source | `"KeyboardLayout Name" = ABC` ✔ |
| `request_access(mdpro)` | granted `com.mdpro.app`, denied none |
| pre-launch `pgrep -fl 'mdpro\|tauri-app'` | two non-app hits only (`tmux new -s dtrack …`, `claude --resume mdpro-remote`); nothing to quit |
| Cold launch | PID **5088**, path `…/dtrack/builds/c8bd2b6/mdpro.app/Contents/MacOS/tauri-app`; L15504 `file.open.external` `appReady:false` `source:"finder"`; L15524 `file.draft.list` `listed:0` (no Recover drafts). Later launches 12035 (6), 12647 (after `kill -9`), 14818 (after 7 quit), all from `builds/c8bd2b6/` |
| About | `about.png`: v0.3.1, "Checking for updates…", greyed **Check Again**; nothing clicked |
| `W0` | `{100,100}`, 1200 × 800; same at the end |
| `big.md` start size | `10477556`, inside (10469376, 10477568] ✔ |
| Symlink check | `pwd -P` = `$S`; logged path is exactly `$S/w.md` (L15534) |
| Source mode | L15562 `view.mode.change` `wysiwyg`→`source` `intent:"user"` |
| Settings | as-found `{"themeMode":"system","defaultViewMode":"wysiwyg","lastViewMode":"wysiwyg","autoSaveInterval":30,"logging":{"enabled":true,"level":"info"},"mcp":{"serverEnabled":true}}`; re-read after the final quit, `cmp` exit **0** |

## 2. Verdict table (report § 3, all rows)

| Row | Verdict | RESIDUAL | Proof line |
|---|---|---|---|
| W1 seeded open | **PASS** | 0 | L15534 |
| W2 re-open unchanged | **PASS** | 0 | L15574 |
| W3 external edit | **PASS** (`stat_differs`) | 0 | L15575 → L15576 / L15577 → L15578 |
| W4 atomic replace | **PASS** (`modify_name`, `changeType:"modified"`) | 0 | L15583 → L15586 / L15587 → L15588 |
| W4d delete while open | **PASS** | 0 | L15606 → L15609 |
| W4r rename while open | **KNOWN (D107)** (`ignored_rename_single_path`, no prompt) | 0 | L15629 |
| W8 D69/D138 Save As target | **PASS** | 0 | L15649 / L15650; L15656 → L15660; L15664; L15668–L15674 |
| W5 external edit right after ⌘S | **PASS** (gap 488 ms) | 0 | L15693 → L15700, L15703 / L15704 → L15705 |
| W6 ⌘S×20 | **PASS** (20/20 exercised, OWN-MARK 10) | 0 | L15725–L15920 |
| W6b ⌘S burst ×3 | **PASS** (3/3 bursts exercised) | 0 | `file.save.queued` L15955, L16003, L16055 (+6 more) |
| W7 own save past 10 MiB | **PASS** | 0 | L16114, L16119 / L16120 |
| W9 closed file stays closed | **PASS** | 0 | L16141; `since '.'` L16140–L16144 |
| D152 safe save | **NOT EXERCISED (3 of 3: no `remove` event for `$X`; each variant proved D68 instead)**. No FAIL condition was seen. | 0 | L16158, L16167, L16176 (all `modify_name`) |
| 6 prefs | **PASS** | – | L16191; L16235; `p6-prefs.png` |
| 6 drafts | **PASS** | – | L16257; L16275; L16292; L16294; L16295 |
| 7 close | **PASS** | – | L16329; L16331; L16334 |
| 7 quit | **PASS** | – | L16352; L16354; L16360; L16377 |
| 8a (observation) | Save **succeeded** as the code predicts (`Saved`, mode stays 444). See **F2**. | – | L16439 |
| 8b save failure | **PASS**, with **F1** (the toast text is `Save failed: [object Object]`) | – | L16476 |
| 9 MCP start | **PASS** | – | L16385; L16415 |
| 10 update restart | **NOT EXERCISED (by design)** | – | – |

**Rulings on the two non-PASS rows.**
- **D152: outcome verified, Remove path not exercised.** All 3 of 3 variants prompted *modified*, never *deleted*, and Reload brought in the new text. The `Remove` routing that `eafccb4` changed was not reached, because the mini's FSEvents reports a rename over an existing watched path as `modify_name` only. Accepted by the user's ruling 「D152 按结果接受，F1 留到 0.3.2，继续 B 部分 (Recommended)」, with the unit tests `file_watcher_route_remove_present_tests.rs` rm_a–rm_e as the path evidence.
- **Item 10: NOT EXERCISED by design.** This build has nothing to install; it is covered by the post-publication install leg (the 0.2.6 / 0.3.0 canary on the real endpoint, with a dirty document open).

Run-wide figures: `save-suppressed` **0** lines (L15503 to the end). `unchangedCheck`: `unchanged` 71, `not_checked` 27, `stat_differs` 7; no `unstable`, `read_failed`, `no_baseline`, `over_cap`, `hash_differs`, `gen_moved` or `no_entry`. Ten decisions: nine `reload-prompt` (w.md ×2 W3/W4, w8-new.md W8, w5.md W5, s152.md ×3 D152, s8a.md ×2 the 8a chmods / F2) and one `deleted-prompt` (wd.md, W4d). Every decision came from an external action: **no own-save prompts, 0 RESIDUAL**.

## 3. Evidence per item (condensed)

### W1–W3. D32 (`w.md`)
- **W1**: `mark 15502`, `open -a` at the cold launch. L15534 `file.watch.register` `"baseline":"seeded","ok":true`, `size:41`.
- **W2**: `mark 15569`. L15574 `kind:"modify_metadata"`, `outcome:"ignored_unchanged"`, `unchangedCheck:"unchanged"`; `since '.'` L15570–L15574 has no `file.change.*`; `w2.png` no prompt.
- **W3**: `mark 15574`, `printf x >>`. L15575 `modify_data` `emitted_modified` `stat_differs` `changeType:"modified"` → L15576 `scheduled` → L15577 `delivered` → L15578 `reload-prompt`. `w3.png`: *File was modified externally. Reload to update content?*; Reload clicked.

### W4, W4d, W4r. D68 (`w.md`, `wd.md`, `wr.md`)
- **W4**: `mark 15582`, `printf y > tmp && mv`. L15583 `kind:"modify_name"` `emitted_modified` `stat_differs` `changeType:"modified"`; L15584 / L15585 `ignored_unchanged/unchanged`; L15586 `scheduled`, L15587 `delivered`; L15588 `reload-prompt`. `w4.png` modified body; after Reload `cat w.md` = `y`.
- **W4d**: OPEN L15597 `seeded`; `mark 15605`, `rm`. L15606 `kind:"remove"` `emitted_deleted` `changeType:"deleted"` `not_checked` → L15607 `scheduled`, L15608 `delivered` → L15609 `deleted-prompt`. `w4d.png`: **External change detected** / *File was deleted externally. Save to a new location if needed.* After Ignore the tab kept its text; ⌘W closed without an Unsaved changes dialog (L15612 unregister, L15614 `tab.close` `wasModified:false`).
- **W4r**: OPEN L15620 `seeded`; `mark 15628`, `mv wr.md wr-moved.md`. L15629 `modify_name` `ignored_rename_single_path` `not_checked`, nothing else; `w4r.png` no prompt → KNOWN (D107, landed after the candidate, not in 0.3.1). ⌘W: L15631 unregister, L15633 `tab.close` `wasModified:false`.

### W8. D69 / D138 Save As target (`w8-new.md`)
- First attempt cancelled (slip S1, L15642 `file.save` `cancel`). Redo `mark 15644`: L15649 `file.save` `success` `fileSizeBytes:7` → L15650 `file.watch.register` `"baseline":"seeded","ok":true`; L15652 `modify_name` `ignored_unchanged/unchanged`.
- Append at `mark 15655`: L15656 `modify_metadata` `emitted_modified` `stat_differs` → L15658 `scheduled`, L15659 `delivered` → L15660 `reload-prompt` (`w8.png`). Reload: L15664 `file.reload` `success`.
- `w8-tabs.png`: tabs `w.md`, `w8-new.md`, so **one** `w8-new.md` tab (D138 fixed; the 819fa2c F1 does not reproduce), text `D69 newx`.
- Second ⌘S at `mark 15664`: L15668 `file.save` `success` `fileSizeBytes:9`, L15671–L15674 four `ignored_unchanged/unchanged`, no decision, no prompt. File reads `D69 newx.`

### W5, W6, W6b, W7, W9. D86 / D112 own saves and close
- **W5** (`w5.md`): `mark 15689`. L15693 `file.save` `success` `ts 19:35:20.265`; L15695 / L15696 own save `ignored_unchanged/unchanged`; L15700 `modify_name` `emitted_modified` `stat_differs` `ts 19:35:20.753` (**gap 488 ms** < 3 000); L15703 `scheduled`, L15704 `delivered`, L15705 `reload-prompt` (`w5.png`). `tally 15689`: `{"saves":1,"watch":{"emitted_modified/stat_differs":1,"ignored_unchanged/unchanged":4},"recv":{"delivered":1,"scheduled":1},"prompts":1}`.
- **W6** (`w6.md`): `mark 15722`, loop over L15723–L15924 (proof L15725–L15920). `tally`: `{"saves":20,"watch":{"ignored_unchanged/unchanged":30,"self_write/not_checked":10},"recv":null,"prompts":0}`. Every save has at least one watch line after it; OWN-MARK = 10; 0 prompts. `tail -c 40` shows 21 dots.
- **W6b** (`w6b.md`): `mark 15937`. Burst 1 L15937–L15990, `file.save.queued` L15955, L15963, L15971; burst 2 L15990–L16043, L16003, L16015, L16024; burst 3 L16043–L16096, L16055, L16068, L16071. 0 prompts each. `tally`: `{"saves":15,"watch":{"ignored_unchanged/unchanged":17,"self_write/not_checked":13},"recv":null,"prompts":0}`; no `stat_differs` / `hash_differs`.
- **W7** (`big.md`): OPEN L16101 register `"baseline":"seeded","size":10477556`; `mark 16110`, ⌘S. L16114 `file.save` `success` `fileSizeBytes:10496356` (≥ 10 485 760); L16119 / L16120 `modify_name` `ignored_unchanged/unchanged`. No decision; `w7.png` no prompt; `stat -f %z` = `10496356`. ⌘W: L16123 unregister, L16125 `tab.close`.
- **W9** (`w9.md`): OPEN L16131 `seeded`; `mark 16139`, ⌘W, `printf q >>` 2 s later. L16141 `file.watch.unregister`, L16143 `tab.close`, L16144 `file.close`. Unfiltered `since '.'` L16140–L16144 has no `file.watch.event` and no `file.change.*`; `w9.png` no prompt.

### D152. External editor's safe save (`s152.md`)
OPEN L16149 `seeded`.

| k | mark | Events for `$X` | Decision | Body | `cat $X` after Reload |
|---|---|---|---|---|---|
| 1 (python `os.replace`) | 16157 | L16158 `modify_name` / `emitted_modified` / `stat_differs` / `modified`; L16159 `modify_name` / `ignored_unchanged` / `unchanged` | L16162 `reload-prompt` | modified (`d152-1.png`) | `safe save one` |
| 2 (`printf > .s152.tmp && mv`) | 16166 | L16167 same; L16168 `ignored_unchanged` / `unchanged` | L16171 `reload-prompt` | modified (`d152-2.png`) | `safe save two` |
| 3 (python, `three`) | 16175 | L16176 same; L16177 `ignored_unchanged` / `unchanged` | L16180 `reload-prompt` | modified (`d152-3.png`) | `safe save three` |

No variant logged `create`, `remove`, `emitted_deleted` or `deleted-prompt` (grep after L16149: 0). All arrived as `modify_name` with `pathCount:1`. See the ruling under § 2.

### 6. Preferences and drafts survive (`p6.md`)
- Prefs: `mark 16184`, Default View Mode → **Source**; L16191 `preferences.set` `success`. Quit: L16194 `app.quit.check` `answer:"clean"` `dirtyCount:0`, L16202 `app.quit.commit`, L16203 `app.quit` (discard count 0). Relaunch PID 12035: L16221 `draft.list` `listed:0`; L16235 `view.mode.change` `toMode:"source"` `intent:"programmatic"`; `p6-prefs.png` **Source** / **30 seconds**.
- Drafts: typed ` DRAFT-P6`, `mark 16255`; L16256 `draft.write` `start`, L16257 `success` `bytes:51`; file `md5` unchanged. `kill -9 12035`, relaunch PID 12647: L16275 `file.draft.list` `listed:1`; `p6-recover.png` lists `p6`. Recover: L16292 `ui.dialog.confirm` `dialog.recovery.recover`; L16294 `file.draft.recover` `outcome:"ok"`; L16295 `file.watch.register` (`baseline:"snapshot"`, N3); L16296 a second `file.draft.recover` success (N4). `p6-tab.png`: one dirty tab `p6.md`, `Second paragraph. DRAFT-P6`. ⌘W → Discard: L16302 confirm, L16305 `tab.close` `wasModified:true`; `md5` unchanged. Restore: L16313 `preferences.set` → `wysiwyg` / `30`.

### 7. Dirty close and dirty quit
- Close (`c7.md`): `mark 16327`, ⌘W; `c7-dlg.png` **Unsaved changes** / **Keep editing** / **Discard changes**. Keep editing: L16329 `ui.dialog.cancel`; tab stays dirty. ⌘W → Discard: L16331 confirm, L16334 `tab.close` `wasModified:true`; `md5` unchanged.
- Quit (`q7.md`): `mark 16350`; `q7-dlg.png` *Quit without saving?*. L16351 `app.quit.request`, L16352 `app.quit.check` `"answer":"dirty","dirtyCount":1`, L16354 `app.quit.prompt`. Keep editing: L16357 / L16358 cancel, L16360 `app.quit.cancel`; app kept running. Quit → Discard: L16367 / L16369 confirm, L16370 answer `discard`, L16377 `app.quit.commit` `success`, L16378 `app.quit`. Relaunch PID 14818: L16396 `draft.list` `listed:0`; `q7-relaunch.png` no Recover drafts.

### 8. Save failure surfaces
- **8a** (`s8a.md`, observation): typed `A`, `chmod 444` → L16431 `modify_metadata` `detail:"ownership"` `emitted_modified` `not_checked` (mtime unchanged) → L16432 / L16433 → L16434 `reload-prompt` (**F2**, `s8a-chmod-dlg.png`); Ignore L16435. ⌘S at `mark 16435`: L16439 `file.save` `success` `fileSizeBytes:44`; L16441 / L16442 `ignored_unchanged/unchanged`; toast **`Saved`** (`s8a.png`), mode stays `-r--r--r--`. `chmod 644` raised a second identical prompt (L16447 / L16451); ⌘W closed the tab behind it (L16453 unregister, L16455 `tab.close`, **F3**, slip S4); Ignore L16459.
- **8b** (`ro/s8b.md`): typed `B`, `chmod 555 ro`, `mark 16472`, ⌘S. L16476 `file.save` `fail` (level `error`), error `permission denied: …/c8bd2b6-rc-a/ro/s8b.md`. `s8b.png`: toast **`Save failed: [object Object]`** (**F1**); tab stays dirty, `md5` unchanged, no temp file in `ro`. `chmod 755 ro`, ⌘S: L16480 `file.save` `success` `fileSizeBytes:25`, toast `Saved` (`s8b-resave.png`).

### 9. MCP server (launch PID 14818)
L16385 `mcp.http_server.start` `success` `{"phase":"running","port":55045}`. `server.port` `-rw-r--r--` 5 B; `server.token` `-rw-------` 64 B; the helper printed only the token's length. No-token call → **401**; `mark 16413`, token call → **200**, L16415 `mcp.list` `success` `{"documentCount":0}`. One extra token call (slip S3): L16416 / L16417, 200. The token value appears nowhere in the report or this record.

### 10. Update restart with unsaved documents
NOT EXERCISED by design; covered by the post-publication install leg (see § 2).

### Restore and close
`W0` re-checked. L16496 `view.mode.change` `source`→`wysiwyg`. Quit: L16516 `app.quit.commit`, L16517 `app.quit`, discard count 0. `pgrep -fl tauri-app` empty; settings `cmp` 0; `ro` back to `drwxr-xr-x`, `s8a.md` back to `-rw-r--r--`; `$S` left in place, `big.md` not copied anywhere.

## 4. Findings

| Finding | D | Severity / release / owner | What |
|---|---|---|---|
| F1 (8b) | [D163](../plans/20260912-frontend-backend-sequencing-order.md#d163) | MUST, 0.3.2, mdpro-a3 | The save-failure toast reads `Save failed: [object Object]`. Rust returned `permission denied: …/ro/s8b.md` (L16476); the frontend formats the error object instead of its message. Evidence `s8b.png`. The brief's criteria still pass (toast starts `Save failed:`, tab dirty, file unchanged) |
| F2 (8a) | [D164](../plans/20260912-frontend-backend-sequencing-order.md#d164) | SHOULD, 0.3.2, mdpro-a6 | A permission-only `chmod` on an open, unchanged file raises the *modified* prompt: L16431 (and L16447) `modify_metadata` / `detail:"ownership"` / `emitted_modified` / `unchangedCheck:"not_checked"`, size and mtime unchanged; `reload-prompt` L16434, L16451. The ownership detail bypasses the D32 unchanged check. Evidence `s8a-chmod-dlg.png` |
| F3 | [D165](../plans/20260912-frontend-backend-sequencing-order.md#d165) | SHOULD, 0.3.2, mdpro-a3 | ⌘W closes the tab behind an open External-change dialog (L16455 `tab.close` while the L16451 prompt was up); the dialog is left with no document behind it (`s8a-chmod644-orphan-dlg.png`). Ignore dismissed it cleanly (L16459); Reload on the orphaned dialog was not tested |

Notes from the report (no D number): N3 the recovered draft's watch registers with `baseline:"snapshot"` (L16295), every other register was `seeded`; N4 two `file.draft.recover` success lines (L16294, L16296), one tab; N5 on the discard path L16372 `app.quit.check` reads `"answer":"clean","dirtyCount":1,"discardedUnchangedCount":1`, quit committed correctly; N6 the app menu shows **Stop Waiting and Quit…** under Quit mdpro (not clicked); N7 the *deleted* dialog's default button is **Reload** (not clicked); N8 `persave` row `"0"` in W6 / W6b holds one `self_write/not_checked`, logged between save 1's `start` and `success`. N2 suggests a forced-`unlink` probe (`rm $X; sleep 0.05; printf … > $X`) if the D152 `Remove` path is ever to be reached on the device.

## 5. Operator slips (report § 5, verbatim)

- **S1 (W8).** After ⌘N, the `D69 new` typed with `key.sh` did not reach the editor: the new tab had no editor focus, although the gate said `window.focus main`. The ⌘S save panel then opened for an empty Untitled. I clicked **Cancel** (L15642 `file.save` `cancel`, `source:"dialog"`), clicked into the editor, retyped, and redid the step from `mark 15644`. No file was written by the first attempt.
- **S2 (order).** Item 9 ran right after item 7's relaunch, before item 8. The brief says item 9 "uses the launch from item 7", and I took it before any other action. Items 8a / 8b then ran in the same launch.
- **S3 (item 9).** I made one extra token-authenticated `GET /api/documents` (`-o /dev/null`, `200`, L16416 / L16417). The token was never printed.
- **S4 (8a).** The `chmod 644` restore raised a second *modified* prompt (L16451). I pressed ⌘W about 2 s later without taking a screenshot first and without clicking Ignore. The s8a tab closed (L16453 unregister, L16455 `tab.close` `wasModified:false`) while the dialog stayed up. I then took `s8a-chmod644-orphan-dlg.png` and clicked **Ignore** (L16459 `dialog.reload.ignore`). This deviates from "shot first, then Ignore", and it exposed F3.

## Appendix

Not reproduced here (about 160 lines of full JSONL proof lines, up to 1.3 KB each). It lives in the report's Appendix: § A.1 proof lines verbatim (L15504 … L16517) and § A.2 the W6 / W6b `tally` / `persave` JSON, in `~/.mdpro-redesign/reports-in/20261011-rc-c8bd2b6-a.md` on the MacBook and `~/.mdpro-redesign/dtrack/reports/20261011-rc-c8bd2b6-a.md` on the mini.
