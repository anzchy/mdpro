<!-- Device-check record. dtrack's report on the Mac mini (~/.mdpro-redesign/dtrack/reports/20261016-rc-035.md), committed verbatim by mdpro-delegator. Brief: ~/.mdpro-redesign/stage-3/brief-rc-035.md (not in the repo). Gate: PASS. -->

# 0.3.5 RC regression on `67715ea` (watcher: combined A1 + D246 rm cells) (2026-10-16)

Brief: `briefs/stage-3/brief-rc-035.md` (mdpro-delegator). It runs part A sections A0, A1 and A3 of `briefs/20261014-brief-rc-032.md` (A2 skipped as instructed), then the D246 cells of `briefs/stage-3/brief-d246-rm-cells.md`, 5 per theme. Runner: dtrack session on the mini, one sitting, 12:40 to 12:57 GMT+8. Three launches: part A (PID 57469), D246 light (PID 63650) and D246 dark (PID 65563). Every launch logged `releaseId 0.3.5@67715ea28eb12534f59e7ae99d9c87998fc0f0bd`.

**Summary.** **Gate: PASS.**
- **A1:** 12 rows PASS (W1, W2, W3, W4, W4d, W4r, W8, W5, W6, W6b, W7, W9). D152 is NOT EXERCISED 3 of 3, the same as recorded on 0.3.2: each variant got the correct *modified* prompt, but notify logged only `modify_name`, never `remove`. **FAIL 0. RESIDUAL 0.**
- **D246:** **10/10 "deleted", 0 "modified".** Light 5/5 and dark 5/5. All 10 samples reached the fix path: a trailing `modify_metadata` on the path that was already gone, logged `debounced`.
- **Version and teardown:** About reads **v0.3.5**, and `app.ready` shows 0.3.5. Every quit logged `app.quit.check` `clean`. The drafts dir is empty, and the settings equal the as-found values.

## 1. Build evidence
| Check | Result |
|---|---|
| `stat -f %m tauri-app` | `1792124938` = `2026-10-16T12:28:58` (matches) |
| `shasum -a 256 tauri-app` | `4dced058ec9478f35adf84912e69722d820bd9a03a804976a29a481f740585de` (matches) |
| `Info.plist` `CFBundleShortVersionString` | `0.3.5` |
| `git -C $WT rev-parse HEAD` | `67715ea28eb12534f59e7ae99d9c87998fc0f0bd` |
| ancestors 819fa2c ac79c63 658bc1d d91fb38 eafccb4 0d25ce2 8b57388 650061d 402e8eb cfa9503 8a19778 e4230d0 bcba314 eeee04f 3f0d07b, plus **cf65fe52** (D246) | all `0` |
| fixtures | `$FX` = `$WT/tests/manual-fixtures`: `d173-two-windows.md` 56 B, `d185-alias-spelling.md` 59 B, `wi04-surfaces.md` 1027 B |
| input source | `ABC` (`AppleCurrentKeyboardLayoutInputSourceID` `com.apple.keylayout.ABC`) |
| pre-flight `pgrep -fl 'mdpro\|tauri-app'` | only `4281 tmux new -s dtrack …` (a name match, not the app); no app process. Screen unlocked. |
| `request_access` | granted: `mdpro` (`com.mdpro.app`) |
| part A launch | PID **57469**, started Fri Oct 16 12:42:13 2026, `/Users/jack/.mdpro-redesign/dtrack/builds/67715ea/mdpro.app/Contents/MacOS/tauri-app`; L34802 `app.ready` `appVersion 0.3.5` |
| Recover drafts | none shown |
| About | shot `r035-about`: **Version v0.3.5** (still "Checking for updates…"; no update button clicked) |
| `W0` | `{100,100}` size `1200×800` |
| `big.md` start size | `10477556` (in (10469376, 10477568]) |
| `$S` / `readlink $L` | `$S` = `scratch/67715ea-rc035-a`; `readlink $L` = `/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a` (made per A0.4; unused because A2 was skipped) |
| run files → first use | generated 12:41:36, cold launch 12:42:13 (37 s) |
| logged path form | L34824, the first `file.watch.register` path, is exactly `$S/w.md` |
| view mode | L34851 `view.mode.change` `wysiwyg → source`; all A1 rows ran in source mode |

## 2. Settings
- As-found (`$S/asfound.json`): `{"themeMode":"system","defaultViewMode":"wysiwyg","lastViewMode":"wysiwyg","autoSaveInterval":30,"logging":{"enabled":true,"level":"info"},"mcp":{"serverEnabled":true}}`
- After A3 (`$S/restored.json`): `cmp` equal. After the D246 teardown (`$S/restored2.json`): `cmp` equal. The full `config.json` differs from the as-found copy only in the app-maintained recent-files list.
- A3: ⌃4 back to WYSIWYG (L35622). `W0` was unchanged at `100,100,1200,800`. Quit via mdpro › Quit mdpro: L35638 `app.quit.check` `answer:"clean"` `dirtyCount:0`; L35649 `app.quit`. **Discard changes count: 0** (no dialog). `pgrep -fl tauri-app`: none.

## 3. Verdict table
| Row | Verdict | RESIDUAL | Proof L# | 0.3.2 |
|---|---|---|---|---|
| W1 seeded open | PASS | 0 | L34823 hold, L34824 register `seeded` | PASS |
| W2 re-open unchanged | PASS | 0 | L34864 `ignored_unchanged/unchanged` | PASS |
| W3 external edit | PASS (`stat_differs`) | 0 | L34865 → L34870 | PASS |
| W4 atomic replace | PASS (*modified*) | 0 | L34876 `modify_name` `emitted_modified` → L34881 | PASS |
| W4d delete while open | PASS (*deleted*) | 0 | L34903 `remove` `emitted_deleted` → L34907 `deleted-prompt` | PASS |
| W4r rename while open (D107) | PASS (*deleted*) | 0 | L34935 `modify_name` `emitted_deleted` `not_checked` → L34939 | PASS |
| W8 Save As target | PASS | 0 | L34963 register `seeded`; L34975 prompt on append; L34986 own-save, no prompt on the second ⌘S | PASS |
| W5 ext edit right after ⌘S | PASS (gap 493 ms) | 0 | L35014 save → L35023 `emitted_modified` → L35029 | PASS |
| W6 ⌘S×20 | PASS (saves 20, prompts 0, notices 20; OWN-MARK 0) | 0 | mark 35050, range 35051–35290 | PASS |
| W6b ⌘S burst ×3 | PASS (queued 3/3/3, prompts 0) | 0 | L35320…L35464 queued | PASS |
| W7 own save past 10 MiB | PASS (`fileSizeBytes 10496356`) | 0 | L35518 → L35524/L35525 `ignored_unchanged/unchanged` | PASS |
| W9 closed file stays closed | PASS | 0 | L35557 unregister, L35558 release `backendReleased` gc0 | PASS |
| D152 safe save | **NOT EXERCISED (3 of 3)**: no `remove` event; correct behaviour each time | 0 | L35578, L35589, L35600 (`modify_name` only) | NOT EXERCISED 3/3 |
| **D246 light** | **PASS 5/5** (trailing-modify route 5/5) | – | § 5 | – |
| **D246 dark** | **PASS 5/5** (trailing-modify route 5/5) | – | § 5 | – |

D173, D185 (A2): **not run**, as the brief instructs.

## 4. Per row (A1)
Verbatim lines for every L-number cited are in the appendix. Shots are in `reports/shots/`. Part A shots carry the prefix `r035-`, because the plain names from 0.3.2 already exist.

### W1
`mark` → 34791; `open -a "$APP" $X` (the cold launch). L34823 `file.watch.hold` `transition:"first"`, `groupConsumers:1`, `windowLabel:"main"`; L34824 `file.watch.register` `ok:true`, `baseline:"seeded"`, `seedCheck:"unchanged"`, size 41.

### W2
mark 34859; `open -a` again (L34860/L34862 `file.open.external`, then two `file.open.route` lines). L34864 `modify_metadata` `ignored_unchanged/unchanged`. `since '.'` 34860–34864 has 5 lines: no decision, no prompt. Shot `r035-w2`.

### W3
mark 34864; `printf x >> $X`. L34865 `modify_metadata` `emitted_modified` `stat_differs` `changeType:"modified"`; L34866 `modify_data` `ignored_unchanged`; L34868 scheduled; L34869 delivered; L34870 `reload-prompt`. Shot `r035-w3`: *modified* body. Reload (L34871 `dialog.reload.reload`, L34874 `file.reload`).

### W4
mark 34875; `printf y > $X.tmp && mv $X.tmp $X`. L34876 `kind:"modify_name"` `emitted_modified` `stat_differs` `changeType:"modified"`; L34877 a second `modify_name` `ignored_unchanged`; L34879/L34880/L34881 scheduled / delivered / `reload-prompt`. Shot `r035-w4`: *modified* body, not *deleted*. Reload (L34882); `cat $X` = `y`.

### W4d
OPEN `wd.md`: L34890 hold, L34892 register `seeded`. mark 34902; `rm`. L34903 `kind:"remove"` `emitted_deleted` `changeType:"deleted"` `not_checked`; L34905/L34906 scheduled / delivered; L34907 `deleted-prompt`. Shot `r035-w4d`: "File was deleted externally. Save to a new location if needed." The D246 route was the **direct delete**: there was no trailing modify line for `wd.md`. Ignore (L34908). ⌘W: **no** Unsaved changes dialog (L34912 `tab.close` `wasModified:false`); L34914 unregister, L34915 release `backendReleased`.

### W4r (D107)
OPEN `wr.md`: L34923 hold, L34924 register `seeded`. mark 34934; `mv wr.md wr-moved.md`. L34935 `kind:"modify_name"` `emitted_deleted` `changeType:"deleted"` `unchangedCheck:"not_checked"`; L34937/L34938 scheduled / delivered; L34939 `deleted-prompt`. Shot `r035-w4r`: *deleted* body. Control W4 (same run) stayed *modified*. Ignore (L34940). ⌘W, no dialog (L34944 `wasModified:false`).

### W8 (D69 / D138)
⌘N; clicked into the editor; typed `D69 new` (it appeared). `NA` = 34956; ⌘S opened the save panel. There: ⌘⇧G, typed `$S`, double-clicked the `67715ea-rc035-a` row (the `-link` row was not chosen), name `w8-new.md`, clicked **Save**.
- L34959 hold `first`; L34962 `file.save` success 7 B; **L34963 `file.watch.register` `baseline:"seeded"`**; L34964 `file.save.notice` `spellings:1`, `emitted:1`, `failed:0`; L34965 `file.change.received` outcome **`captured`** (status `start`), as on 0.3.2 (N1 there).
- Append (mark 34969): L34970 `emitted_modified` `stat_differs`; L34973/L34974 scheduled / delivered; L34975 `reload-prompt`. Shot `r035-w8`. Reload (L34976/L34979). Shot `r035-w8-tabs`: **one** `w8-new.md` tab (D138), text `D69 newx`.
- Second ⌘S (mark 34980, after `key.sh .`): L34984 success 9 B; L34985 notice; L34986 `own-save` (cancel); L34988–L34991 four lines, all `ignored_unchanged/unchanged`; no decision. File = `D69 newx.`
- `file.watch.reconcile` lines after `NA`: **0**. tally from 34956: `{"saves":2,"watch":{"emitted_modified/stat_differs":1,"ignored_unchanged/unchanged":5},"recv":{"captured":1,"delivered":1,"own-save":1,"scheduled":1},"prompts":1}` (the one prompt is the append).

### W5
OPEN `w5.md`: L34999 hold, L35000 register. mark 35010. One line: `key.sh z; ⌘S; printf z >> w5.md` (`ext 12:46:17`).
- L35014 `file.save` success, ts **12:46:17.035**, 42 B; L35015 notice; L35016 `own-save`; L35017/L35018 `ignored_unchanged`.
- L35023 `modify_name` `emitted_modified` `stat_differs`, ts **12:46:17.528**: **gap 493 ms** (< 3 000).
- L35027 scheduled, L35028 delivered, L35029 `reload-prompt`. Shot `r035-w5`: *modified* body. Reload.
- `save-suppressed` lines since launch: **0**.
- tally: `{"saves":1,"watch":{"emitted_modified/stat_differs":1,"ignored_unchanged/unchanged":4},"recv":{"delivered":1,"own-save":1,"scheduled":1},"prompts":1}`
- The typed `z` replaced the trailing `.` (see slip 1), so the save wrote 42 B, not 43 B. The edit still landed and saved (`Second paragraphz`); the row's chain is unaffected.

### W6
OPEN `w6.md`. mark 35050. The 20× loop ran from 12:46:59 to 12:47:31; no dialog.
- tally: `{"saves":20,"watch":{"ignored_unchanged/unchanged":38,"self_write/not_checked":2},"recv":{"own-save":20},"prompts":0}`
- persave (split at `file.save` success): rows 1–20 all present, with no row "0". Every row contains `ignored_unchanged/unchanged`; rows 4 and 17 also contain one `self_write/not_checked`. perstart (split at `start`): every row also has `ignored_unchanged/unchanged`. **OWN-MARK 0.** NOT EXERCISED 0.
- `file.save.notice` lines: **20**, all `[spellings 1, emitted 1, failed 0]`. `file.change.decision` in 35051–35290: 0. `tail -c 40`: `Second paragraph.....................` (20 dots).
- First watch lines (save 1): L35057/L35058 `modify_name` `ignored_unchanged/unchanged`, 12:46:59.670. Last (save 20): L35284/L35285 `modify_name` `ignored_unchanged/unchanged`, 12:47:30.817. Every non-`ignored_unchanged` line is `self_write/not_checked` (2 lines).

### W6b
OPEN `w6b.md`. mark 35306; three bursts (start lines 35306 / 35369 / 35432, end 35495), with the gate before each (all `main`):
| burst | `file.save.queued` | saves | watch lines | notices | decisions |
|---|---|---|---|---|---|
| 1 | 3 (L35320, L35333, L35338) | 5 | 10 | 5 | 0 |
| 2 | 3 (L35384, L35398, L35409) | 5 | 10 | 5 | 0 |
| 3 | 3 (L35446, L35461, L35464) | 5 | 10 | 5 | 0 |
- persave: `{"1":["ignored_unchanged/unchanged","ignored_unchanged/unchanged"],"2":["ignored_unchanged/unchanged","ignored_unchanged/unchanged","self_write/not_checked"],"3":["ignored_unchanged/unchanged"],"4":["ignored_unchanged/unchanged","ignored_unchanged/unchanged"],"5":["ignored_unchanged/unchanged","ignored_unchanged/unchanged"],"6":["ignored_unchanged/unchanged","ignored_unchanged/unchanged","self_write/not_checked"],"7":["ignored_unchanged/unchanged","self_write/not_checked"],"8":["ignored_unchanged/unchanged","self_write/not_checked"],"9":["ignored_unchanged/unchanged","self_write/not_checked"],"10":["ignored_unchanged/unchanged"],"11":["ignored_unchanged/unchanged","ignored_unchanged/unchanged"],"12":["ignored_unchanged/unchanged","ignored_unchanged/unchanged","self_write/not_checked"],"13":["ignored_unchanged/unchanged","self_write/not_checked"],"14":["ignored_unchanged/unchanged","self_write/not_checked"],"15":["ignored_unchanged/unchanged"]}`
- tally: `{"saves":15,"watch":{"ignored_unchanged/unchanged":22,"self_write/not_checked":8},"recv":{"own-save":15},"prompts":0}`. `tail -c 10`: `graph....` + newline (three dots added, one per burst).

### W7
OPEN `big.md`: L35500 hold, **L35501 register `baseline:"seeded"`**, size 10477556; L35502 `file.open` 23 ms. `pbpaste | wc -c` = 18800. Click, ⌘↓, ⌘V (gates `main`). mark 35514; ⌘S.
- L35518 `file.save` success **`fileSizeBytes:10496356`** (≥ 10 485 760); L35519 notice; L35520 `own-save`; L35524/L35525 `modify_name` `ignored_unchanged/unchanged`.
- After 35514: no decision, no prompt. Shot `r035-w7`. `stat` = 10496356.
- ⌘W: L35530 `tab.close` `wasModified:false`; L35532 unregister; L35533 release `backendReleased`.

### W9
OPEN `w9.md` (L35541 hold, L35542 register). mark 35552; ⌘W. L35555 `tab.close`; **L35557 `file.watch.unregister`**; **L35558 `file.watch.release` `outcome:"backendReleased"` `groupConsumers:0` `transition:"release"`**. Then `printf q`, wait 5 s. `since '.'` 35553–35561: no `emitted_*`, no decision (the last line, L35561, is the frontend release). Shot `r035-w9`.

### D152
OPEN `s152.md` (L35566 hold, L35567 register).
| k | mark | events for `$X` | decision | body | `cat` after Reload |
|---|---|---|---|---|---|
| 1 (python `os.replace`) | 35577 | L35578 `modify_name` `emitted_modified` `stat_differs` `modified`; L35579 `modify_name` `ignored_unchanged` | L35583 `reload-prompt` | *modified* | `safe save one` |
| 2 (`printf` + `mv`) | 35588 | L35589 `modify_name` `emitted_modified` `stat_differs` `modified`; L35590 `modify_name` `ignored_unchanged` | L35594 `reload-prompt` | *modified* | `safe save two` |
| 3 (python) | 35599 | L35600 `modify_name` `emitted_modified` `stat_differs` `modified`; L35601 `modify_name` `ignored_unchanged` | L35605 `reload-prompt` | *modified* | `safe save three` |
- Event kinds: all three variants logged `modify_name` only; no `create`, no `remove`. `emitted_deleted` / `changeType:"deleted"` / `deleted-prompt` for `s152` after 35577: **0**.
- Verdict: NOT EXERCISED 3 of 3, identical to 0.3.2 and 0.3.1. Shots `r035-d152-1..3`. ⌘W: L35613, L35615 unregister, L35616 release.

## 5. D246 cells: `rm` of an open, clean file (5 per theme)
**Setup.** `scratch/s3/<th>/rm-<th>-{1..5}.md` = `cp` of `$FX/wi04-surfaces.md`, made more than 3 s before each launch. Each theme had its own cold launch on `scratch/s3/<th>/surf.md`:
- light: mark 35650, PID 63650, L35661 `app.ready` 0.3.5@67715ea…, L35700 `ui.menu.select` `menu.theme.light`;
- dark: mark 36117, PID 65563, L36127 `app.ready` 0.3.5@67715ea…, L36167 `menu.theme.dark`.

Each sample ran the same steps:
1. `open -a $APP rm-<th>-<n>.md`, wait 3 s.
2. Gate: `file.watch.register` `ok:true` for the path (all 10 passed).
3. `rm`, then poll for the decision line.
4. Shots `d246-rm-<th>-<n>-1`, `-2`, wait 2 s, `-settled`.
5. **Ignore**, ⌘W, wait ≥ 1 s.

Each sample used a fresh file, and no file was recreated.

**Prompt text, all 30 shots:** "External change detected / File was deleted externally. Save to a new location if needed." I cropped the dialog area of every shot. All 15 light crops are pixel-identical (one md5), and so are all 15 dark crops (one md5). I viewed one crop per theme (`light-3-1`, `dark-5-1`) and read the full `-settled` shot of light 1–5 and dark 1. No *modified* prompt appeared in any shot, including the settled ones.

**Per-sample grep** (brief's fields: `[L, event, kind, detail, outcome, unchangedCheck, changeType, action]`). Every sample had exactly the same shape, so it is shown once. Each sample also logged extra `file.change.received` `other-path` lines, one for each earlier empty window (see N2).
```
[remove, file, emitted_deleted, not_checked, deleted]        ← direct delete
[modify_metadata, extended, debounced, not_checked, null]    ← trailing modify on the gone path (D246 route)
file.change.received scheduled → delivered (deleted)
file.change.decision deleted-prompt, changeType deleted
```
| Sample | `remove` L# (`emitted_deleted`) | trailing modify L# (outcome) | decision L# | route | save prompt on ⌘W |
|---|---|---|---|---|---|
| light-1 | L35749 | L35750 `modify_metadata` `debounced` | L35755 `deleted-prompt` | trailing modify | no (`wasModified:false`) |
| light-2 | L35821 | L35822 `modify_metadata` `debounced` | L35828 | trailing modify | no |
| light-3 | L35894 | L35895 `modify_metadata` `debounced` | L35902 | trailing modify | no |
| light-4 | L35968 | L35969 `modify_metadata` `debounced` | L35977 | trailing modify | no |
| light-5 | L36043 | L36044 `modify_metadata` `debounced` | L36053 | trailing modify | no |
| dark-1 | L36216 | L36217 `modify_metadata` `debounced` | L36222 | trailing modify | no |
| dark-2 | L36288 | L36289 `modify_metadata` `debounced` | L36295 | trailing modify | no |
| dark-3 | L36361 | L36362 `modify_metadata` `debounced` | L36369 | trailing modify | no |
| dark-4 | L36435 | L36436 `modify_metadata` `debounced` | L36444 | trailing modify | no |
| dark-5 | L36510 | L36511 `modify_metadata` `debounced` | L36520 | trailing modify | no |

**Whole-run checks, per theme:**
- `file.watch.event`: 5 `emitted_deleted` (one per sample, on the `remove` line, `not_checked`) and 5 `debounced`. No other outcome.
- `file.change.received`: scheduled 5, delivered 5, `other-path` 15, all `changeType:"deleted"`.
- `file.change.decision`: 5 `deleted-prompt`.
- Lines for any `rm-(light|dark)-*` path with `emitted_modified` or `changeType:"modified"`: **0**.

**Per theme:** light **5 of 5 pass**, 5 of 5 reached the trailing-modify path. Dark **5 of 5 pass**, 5 of 5 reached it. (Batch 4 had seen the trailing modify in light 2/2 and not in dark; here dark showed it every time.) A1's W4d, in `$S`, took the direct route only.

**Teardown.**
- Theme restored with `theme.sh System` (L36540 `menu.theme.system`; config `themeMode` `"system"`).
- Quit via the menu: 12 `app.quit.check`, all `answer:"clean"` `dirtyCount:0`; `app.quit.commit` `drafted:0`; L36586 `app.quit`.
- `pgrep -fl tauri-app`: none. Drafts dir `~/Library/Application Support/mdpro/drafts`: empty.
- `cmp scratch/s3/light/surf.md` and `…/dark/surf.md` against `$FX/wi04-surfaces.md`: both identical.
- The light launch's quit (before the dark launch) was also clean: 12 checks `clean`, `drafted 0`, drafts 0.

## 6. Operator slips
1. **W5: the typed `z` replaced the trailing `.`.** After OPEN, my click at the end of `Second paragraph.` left the `.` selected: the zoom showed it highlighted, and the other `.` in line 3 had the green selection-match mark. I did not catch this before the one-liner ran, so the file reads `Second paragraphz` + `\n` + `z` (42 B save). The row's proof chain is complete and unaffected. The same selected-dot state appeared after the W6b OPEN. I saw it there and clicked the same spot once more, which collapsed the selection (zoom checked) before `mark`. From then on I zoomed after every caret click.
2. **The OPEN gate.** I used the computer-use `key` tool for ⌘O / ⌘⇧G, typing and the suggestion double-click (the A1 OPEN sequence). `lastfocus` was not re-run between ⌘O and ⌘⇧G: after ⌘O it reads `window.blur` `main` while the panel is up. The `gate` before each step's first key into the editor always printed `window.focus` `main`.
3. **Shot names:** part A shots are `r035-<name>` (plain `about`, `w2`…`d152-*` already exist from 0.3.2). The D246 shots use the brief's names; none existed before.
4. **D246 opened windows, not tabs** (see N2). I followed the brief's ⌘W per sample, which closed the tab and left an empty window. I did not close those windows, so each theme ended with 6 windows (`surf.md` plus 5 empty ones).
5. **Wrong tool name:** one call to a non-existent tool (`computer_batch` without its prefix) errored, and nothing was sent.

## 7. Deviations and notes
- **N1: new `file.change.pending` lines.** 0.3.5 logs `file.change.pending` `action:"recorded"` (`source:"watcher"`, `seq`, `followed:false`) with each external change. When the dialog is answered, it logs `action:"acknowledged"` (`reason:"reloaded"` / `"ignored"`). Part A had 19 `recorded` and 19 `acknowledged`. These lines are new since 0.3.2 and caused no prompt. `tally` does not count them.
- **N2 (D246): `open -a` on a file that is not open opens a new window**, labelled `mdpro-<uuid>`, not a new tab in `main`. The brief says "It opens as a new tab". On ⌘W the window stays open and empty. Each later `rm` therefore logged one `file.change.received` `outcome:"other-path"` per empty window left from earlier samples. The verdict is unaffected: the deleted prompt showed in the window holding the file, and the `-settled` shot shows it was not replaced.
- **N3: Save As still logs `captured`** (L34965), the same as 0.3.2 N1.
- **N4: close ordering is unchanged from 0.3.2 N2.** `file.watch.unregister` comes before `file.watch.release` on a last-holder close (for example L34914 → L34915, L35557 → L35558), at the same timestamp. A second, frontend `file.watch.release` (`source:"frontend"`) follows, for example L34918.
- **N5: TOC after a reload.** After the W3/W4 reloads of `w.md`, the sidebar read "No headings found in this document" (seen behind the ⌘O panel); at that point `w.md` held only `y` (after W4), so it had no heading. This is consistent with the content, not a defect. It is recorded only because 0.3.2 N6 flagged TOC-after-reload.
- **D152 (N6):** notify reports `modify_name` for all three safe-save forms on this machine. D152's `remove` branch was not reached, the same as on 0.3.2 and 0.3.1.
- `unchangedCheck` values in part A: `unchanged` 77, `not_checked` 12, `stat_differs` 7. No `hash_differs`, `unstable`, `read_failed`, `no_baseline` or `over_cap`. No `save-suppressed`. **RESIDUAL total: 0.**
- `config.json`'s recent-files list held entries from an earlier session's run under `~/mdpro-s3-scratch/v035/dark/` (`rm-dark-1..5.md`, `surf.md`, `d249.md`). That run predates this one and is not part of it. This run replaced those entries with its own `scratch/s3/…` paths. That list is not part of the compared settings.
- No token was read or printed.

## Appendix: proof lines (verbatim, `~/.mdpro/mdpro.log` on the mini; `actionId`, `durationMs:null` and `error:null` trimmed)
```
L34802: {"ts":"2026-10-16T12:42:17.025+08:00","level":"info","event":"app.ready","status":"success","context":{"appVersion":"0.3.5","buildId":"unknown","pid":57469,"platform":"macos","releaseId":"0.3.5@67715ea28eb12534f59e7ae99d9c87998fc0f0bd","startupTimeMs":202},"durationMs":202,"error":null}
L34823: {"ts":"2026-10-16T12:42:17.213+08:00","level":"info","event":"file.watch.hold","status":"success","context":{"gen":1,"groupConsumers":1,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/w.md","rawConsumers":1,"transition":"first","windowLabel":"main"}}
L34824: {"ts":"2026-10-16T12:42:17.213+08:00","level":"info","event":"file.watch.register","status":"success","context":{"alreadyWatched":false,"baseline":"seeded","mtimeMs":1792125696928,"ok":true,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/w.md","seedCheck":"unchanged","size":41,"watchedCount":1}}
L34851: {"ts":"2026-10-16T12:42:40.818+08:00","level":"info","event":"view.mode.change","status":"success","context":{"fromMode":"wysiwyg","intent":"user","source":"setViewMode","toMode":"source"}}
L34864: {"ts":"2026-10-16T12:42:52.553+08:00","level":"info","event":"file.watch.event","status":"cancel","context":{"changeType":null,"detail":"extended","info":null,"kind":"modify_metadata","mtimeMs":1792125696928,"outcome":"ignored_unchanged","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/w.md","pathCount":1,"rescan":false,"size":41,"timestamp":1792125772552,"unchangedCheck":"unchanged"}}
L34865: {"ts":"2026-10-16T12:43:03.364+08:00","level":"info","event":"file.watch.event","status":"success","context":{"changeType":"modified","detail":"extended","info":null,"kind":"modify_metadata","mtimeMs":1792125783352,"outcome":"emitted_modified","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/w.md","pathCount":1,"rescan":false,"size":42,"timestamp":1792125783364,"unchangedCheck":"stat_differs"}}
L34866: {"ts":"2026-10-16T12:43:03.365+08:00","level":"info","event":"file.watch.event","status":"cancel","context":{"changeType":null,"detail":"content","info":null,"kind":"modify_data","mtimeMs":1792125783352,"outcome":"ignored_unchanged","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/w.md","pathCount":1,"rescan":false,"size":42,"timestamp":1792125783365,"unchangedCheck":"unchanged"}}
L34868: {"ts":"2026-10-16T12:43:03.372+08:00","level":"info","event":"file.change.received","status":"start","context":{"changeType":"modified","eventTimestamp":1792125783364,"outcome":"scheduled","path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/w.md","windowLabel":"main"}}
L34869: {"ts":"2026-10-16T12:43:03.678+08:00","level":"info","event":"file.change.received","status":"success","context":{"changeType":"modified","eventTimestamp":1792125783364,"outcome":"delivered","path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/w.md","windowLabel":"main"}}
L34870: {"ts":"2026-10-16T12:43:03.678+08:00","level":"info","event":"file.change.decision","status":"success","context":{"action":"reload-prompt","changeType":"modified","documentId":"60a5cdedcf369b48","eventTimestamp":1792125783364,"isModified":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/w.md","pathMatchesActive":true,"windowLabel":"main"}}
L34876: {"ts":"2026-10-16T12:43:20.069+08:00","level":"info","event":"file.watch.event","status":"success","context":{"changeType":"modified","detail":"any","info":null,"kind":"modify_name","mtimeMs":1792125799903,"outcome":"emitted_modified","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/w.md","pathCount":1,"rescan":false,"size":1,"timestamp":1792125800068,"unchangedCheck":"stat_differs"}}
L34877: {"ts":"2026-10-16T12:43:20.069+08:00","level":"info","event":"file.watch.event","status":"cancel","context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1792125799903,"outcome":"ignored_unchanged","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/w.md","pathCount":1,"rescan":false,"size":1,"timestamp":1792125800069,"unchangedCheck":"unchanged"}}
L34881: {"ts":"2026-10-16T12:43:20.378+08:00","level":"info","event":"file.change.decision","status":"success","context":{"action":"reload-prompt","changeType":"modified","documentId":"60a5cdedcf369b48","eventTimestamp":1792125800068,"isModified":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/w.md","pathMatchesActive":true,"windowLabel":"main"}}
L34890: {"ts":"2026-10-16T12:43:48.804+08:00","level":"info","event":"file.watch.hold","status":"success","context":{"gen":2,"groupConsumers":1,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/wd.md","rawConsumers":1,"transition":"first","windowLabel":"main"}}
L34892: {"ts":"2026-10-16T12:43:48.807+08:00","level":"info","event":"file.watch.register","status":"success","context":{"alreadyWatched":false,"baseline":"seeded","mtimeMs":1792125696928,"ok":true,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/wd.md","seedCheck":"unchanged","size":42,"watchedCount":2}}
L34903: {"ts":"2026-10-16T12:43:56.108+08:00","level":"info","event":"file.watch.event","status":"success","context":{"changeType":"deleted","detail":"file","info":null,"kind":"remove","mtimeMs":null,"outcome":"emitted_deleted","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/wd.md","pathCount":1,"rescan":false,"size":null,"timestamp":1792125836108,"unchangedCheck":"not_checked"}}
L34905: {"ts":"2026-10-16T12:43:56.111+08:00","level":"info","event":"file.change.received","status":"start","context":{"changeType":"deleted","eventTimestamp":1792125836108,"outcome":"scheduled","path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/wd.md","windowLabel":"main"}}
L34906: {"ts":"2026-10-16T12:43:56.418+08:00","level":"info","event":"file.change.received","status":"success","context":{"changeType":"deleted","eventTimestamp":1792125836108,"outcome":"delivered","path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/wd.md","windowLabel":"main"}}
L34907: {"ts":"2026-10-16T12:43:56.418+08:00","level":"info","event":"file.change.decision","status":"success","context":{"action":"deleted-prompt","changeType":"deleted","documentId":"7a12bfc48159db38","eventTimestamp":1792125836108,"isModified":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/wd.md","pathMatchesActive":true,"windowLabel":"main"}}
L34912: {"ts":"2026-10-16T12:44:07.774+08:00","level":"info","event":"tab.close","status":"success","context":{"documentId":"7a12bfc48159db38","filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/wd.md","wasModified":false}}
L34914: {"ts":"2026-10-16T12:44:07.776+08:00","level":"info","event":"file.watch.unregister","status":"success","context":{"alreadyWatched":true,"mtimeMs":null,"ok":true,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/wd.md","size":null,"watchedCount":1}}
L34915: {"ts":"2026-10-16T12:44:07.776+08:00","level":"info","event":"file.watch.release","status":"success","context":{"gen":2,"groupConsumers":0,"outcome":"backendReleased","path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/wd.md","rawConsumers":0,"transition":"release","windowLabel":"main"}}
L34923: {"ts":"2026-10-16T12:44:24.053+08:00","level":"info","event":"file.watch.hold","status":"success","context":{"gen":3,"groupConsumers":1,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/wr.md","rawConsumers":1,"transition":"first","windowLabel":"main"}}
L34924: {"ts":"2026-10-16T12:44:24.054+08:00","level":"info","event":"file.watch.register","status":"success","context":{"alreadyWatched":false,"baseline":"seeded","mtimeMs":1792125696928,"ok":true,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/wr.md","seedCheck":"unchanged","size":42,"watchedCount":2}}
L34935: {"ts":"2026-10-16T12:44:31.559+08:00","level":"info","event":"file.watch.event","status":"success","context":{"changeType":"deleted","detail":"any","info":null,"kind":"modify_name","mtimeMs":null,"outcome":"emitted_deleted","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/wr.md","pathCount":1,"rescan":false,"size":null,"timestamp":1792125871559,"unchangedCheck":"not_checked"}}
L34939: {"ts":"2026-10-16T12:44:31.869+08:00","level":"info","event":"file.change.decision","status":"success","context":{"action":"deleted-prompt","changeType":"deleted","documentId":"8081385e208f732f","eventTimestamp":1792125871559,"isModified":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/wr.md","pathMatchesActive":true,"windowLabel":"main"}}
L34944: {"ts":"2026-10-16T12:44:42.423+08:00","level":"info","event":"tab.close","status":"success","context":{"documentId":"8081385e208f732f","filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/wr.md","wasModified":false}}
L34946: {"ts":"2026-10-16T12:44:42.425+08:00","level":"info","event":"file.watch.unregister","status":"success","context":{"alreadyWatched":true,"mtimeMs":null,"ok":true,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/wr.md","size":null,"watchedCount":1}}
L34947: {"ts":"2026-10-16T12:44:42.425+08:00","level":"info","event":"file.watch.release","status":"success","context":{"gen":3,"groupConsumers":0,"outcome":"backendReleased","path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/wr.md","rawConsumers":0,"transition":"release","windowLabel":"main"}}
L34962: {"ts":"2026-10-16T12:45:17.935+08:00","level":"info","event":"file.save","status":"success","context":{"filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/w8-new.md","fileSizeBytes":7},"durationMs":9,"error":null}
L34963: {"ts":"2026-10-16T12:45:17.936+08:00","level":"info","event":"file.watch.register","status":"success","context":{"alreadyWatched":false,"baseline":"seeded","mtimeMs":1792125917926,"ok":true,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/w8-new.md","seedCheck":"unchanged","size":7,"watchedCount":2}}
L34964: {"ts":"2026-10-16T12:45:17.936+08:00","level":"info","event":"file.save.notice","status":"success","context":{"emitted":1,"failed":0,"filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/w8-new.md","spellings":1}}
L34965: {"ts":"2026-10-16T12:45:17.941+08:00","level":"info","event":"file.change.received","status":"start","context":{"changeType":"modified","eventTimestamp":1792125917936,"outcome":"captured","path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/w8-new.md","windowLabel":"main"}}
L34970: {"ts":"2026-10-16T12:45:25.740+08:00","level":"info","event":"file.watch.event","status":"success","context":{"changeType":"modified","detail":"extended","info":null,"kind":"modify_metadata","mtimeMs":1792125925728,"outcome":"emitted_modified","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/w8-new.md","pathCount":1,"rescan":false,"size":8,"timestamp":1792125925739,"unchangedCheck":"stat_differs"}}
L34975: {"ts":"2026-10-16T12:45:26.049+08:00","level":"info","event":"file.change.decision","status":"success","context":{"action":"reload-prompt","changeType":"modified","documentId":"faff6f8a-7f05-451f-bc94-fbad6a98a44b","eventTimestamp":1792125925739,"isModified":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/w8-new.md","pathMatchesActive":true,"windowLabel":"main"}}
L34984: {"ts":"2026-10-16T12:45:46.120+08:00","level":"info","event":"file.save","status":"success","context":{"filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/w8-new.md","fileSizeBytes":9},"durationMs":9,"error":null}
L34985: {"ts":"2026-10-16T12:45:46.120+08:00","level":"info","event":"file.save.notice","status":"success","context":{"emitted":1,"failed":0,"filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/w8-new.md","spellings":1}}
L34986: {"ts":"2026-10-16T12:45:46.122+08:00","level":"info","event":"file.change.received","status":"cancel","context":{"changeType":"modified","eventTimestamp":1792125946120,"outcome":"own-save","path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/w8-new.md","windowLabel":"main"}}
L34988: {"ts":"2026-10-16T12:45:46.131+08:00","level":"info","event":"file.watch.event","status":"cancel","context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1792125946111,"outcome":"ignored_unchanged","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/w8-new.md","pathCount":1,"rescan":false,"size":9,"timestamp":1792125946131,"unchangedCheck":"unchanged"}}
L34999: {"ts":"2026-10-16T12:46:05.037+08:00","level":"info","event":"file.watch.hold","status":"success","context":{"gen":5,"groupConsumers":1,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/w5.md","rawConsumers":1,"transition":"first","windowLabel":"main"}}
L35000: {"ts":"2026-10-16T12:46:05.038+08:00","level":"info","event":"file.watch.register","status":"success","context":{"alreadyWatched":false,"baseline":"seeded","mtimeMs":1792125696928,"ok":true,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/w5.md","seedCheck":"unchanged","size":42,"watchedCount":3}}
L35014: {"ts":"2026-10-16T12:46:17.035+08:00","level":"info","event":"file.save","status":"success","context":{"filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/w5.md","fileSizeBytes":42},"durationMs":8,"error":null}
L35015: {"ts":"2026-10-16T12:46:17.035+08:00","level":"info","event":"file.save.notice","status":"success","context":{"emitted":1,"failed":0,"filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/w5.md","spellings":1}}
L35016: {"ts":"2026-10-16T12:46:17.035+08:00","level":"info","event":"file.change.received","status":"cancel","context":{"changeType":"modified","eventTimestamp":1792125977035,"outcome":"own-save","path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/w5.md","windowLabel":"main"}}
L35017: {"ts":"2026-10-16T12:46:17.036+08:00","level":"info","event":"file.watch.event","status":"cancel","context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1792125977027,"outcome":"ignored_unchanged","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/w5.md","pathCount":1,"rescan":false,"size":42,"timestamp":1792125977036,"unchangedCheck":"unchanged"}}
L35023: {"ts":"2026-10-16T12:46:17.528+08:00","level":"info","event":"file.watch.event","status":"success","context":{"changeType":"modified","detail":"any","info":null,"kind":"modify_name","mtimeMs":1792125977518,"outcome":"emitted_modified","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/w5.md","pathCount":1,"rescan":false,"size":43,"timestamp":1792125977528,"unchangedCheck":"stat_differs"}}
L35029: {"ts":"2026-10-16T12:46:17.838+08:00","level":"info","event":"file.change.decision","status":"success","context":{"action":"reload-prompt","changeType":"modified","documentId":"ed6e1e798378b812","eventTimestamp":1792125977528,"isModified":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/w5.md","pathMatchesActive":true,"windowLabel":"main"}}
L35501: {"ts":"2026-10-16T12:48:46.710+08:00","level":"info","event":"file.watch.register","status":"success","context":{"alreadyWatched":false,"baseline":"seeded","mtimeMs":1792125696940,"ok":true,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/big.md","seedCheck":"unchanged","size":10477556,"watchedCount":6}}
L35518: {"ts":"2026-10-16T12:49:29.792+08:00","level":"info","event":"file.save","status":"success","context":{"filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/big.md","fileSizeBytes":10496356},"durationMs":18,"error":null}
L35519: {"ts":"2026-10-16T12:49:29.792+08:00","level":"info","event":"file.save.notice","status":"success","context":{"emitted":1,"failed":0,"filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/big.md","spellings":1}}
L35520: {"ts":"2026-10-16T12:49:29.793+08:00","level":"info","event":"file.change.received","status":"cancel","context":{"changeType":"modified","eventTimestamp":1792126169792,"outcome":"own-save","path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/big.md","windowLabel":"main"}}
L35524: {"ts":"2026-10-16T12:49:29.808+08:00","level":"info","event":"file.watch.event","status":"cancel","context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1792126169778,"outcome":"ignored_unchanged","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/big.md","pathCount":1,"rescan":false,"size":10496356,"timestamp":1792126169803,"unchangedCheck":"unchanged"}}
L35525: {"ts":"2026-10-16T12:49:29.814+08:00","level":"info","event":"file.watch.event","status":"cancel","context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1792126169778,"outcome":"ignored_unchanged","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/big.md","pathCount":1,"rescan":false,"size":10496356,"timestamp":1792126169810,"unchangedCheck":"unchanged"}}
L35530: {"ts":"2026-10-16T12:49:49.109+08:00","level":"info","event":"tab.close","status":"success","context":{"documentId":"e305e8708a822351","filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/big.md","wasModified":false}}
L35532: {"ts":"2026-10-16T12:49:49.112+08:00","level":"info","event":"file.watch.unregister","status":"success","context":{"alreadyWatched":true,"mtimeMs":1792126169778,"ok":true,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/big.md","size":10496356,"watchedCount":5}}
L35533: {"ts":"2026-10-16T12:49:49.112+08:00","level":"info","event":"file.watch.release","status":"success","context":{"gen":8,"groupConsumers":0,"outcome":"backendReleased","path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/big.md","rawConsumers":0,"transition":"release","windowLabel":"main"}}
L35541: {"ts":"2026-10-16T12:50:03.988+08:00","level":"info","event":"file.watch.hold","status":"success","context":{"gen":9,"groupConsumers":1,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/w9.md","rawConsumers":1,"transition":"first","windowLabel":"main"}}
L35542: {"ts":"2026-10-16T12:50:03.990+08:00","level":"info","event":"file.watch.register","status":"success","context":{"alreadyWatched":false,"baseline":"seeded","mtimeMs":1792125696928,"ok":true,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/w9.md","seedCheck":"unchanged","size":42,"watchedCount":6}}
L35557: {"ts":"2026-10-16T12:50:11.860+08:00","level":"info","event":"file.watch.unregister","status":"success","context":{"alreadyWatched":true,"mtimeMs":1792125696928,"ok":true,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/w9.md","size":42,"watchedCount":5}}
L35558: {"ts":"2026-10-16T12:50:11.861+08:00","level":"info","event":"file.watch.release","status":"success","context":{"gen":9,"groupConsumers":0,"outcome":"backendReleased","path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/w9.md","rawConsumers":0,"transition":"release","windowLabel":"main"}}
L35578: {"ts":"2026-10-16T12:50:45.534+08:00","level":"info","event":"file.watch.event","status":"success","context":{"changeType":"modified","detail":"any","info":null,"kind":"modify_name","mtimeMs":1792126245522,"outcome":"emitted_modified","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/s152.md","pathCount":1,"rescan":false,"size":14,"timestamp":1792126245534,"unchangedCheck":"stat_differs"}}
L35579: {"ts":"2026-10-16T12:50:45.535+08:00","level":"info","event":"file.watch.event","status":"cancel","context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1792126245522,"outcome":"ignored_unchanged","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/s152.md","pathCount":1,"rescan":false,"size":14,"timestamp":1792126245535,"unchangedCheck":"unchanged"}}
L35583: {"ts":"2026-10-16T12:50:45.845+08:00","level":"info","event":"file.change.decision","status":"success","context":{"action":"reload-prompt","changeType":"modified","documentId":"682b64b4b0315f7","eventTimestamp":1792126245534,"isModified":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/s152.md","pathMatchesActive":true,"windowLabel":"main"}}
L35589: {"ts":"2026-10-16T12:51:04.688+08:00","level":"info","event":"file.watch.event","status":"success","context":{"changeType":"modified","detail":"any","info":null,"kind":"modify_name","mtimeMs":1792126264665,"outcome":"emitted_modified","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/s152.md","pathCount":1,"rescan":false,"size":14,"timestamp":1792126264687,"unchangedCheck":"stat_differs"}}
L35594: {"ts":"2026-10-16T12:51:04.999+08:00","level":"info","event":"file.change.decision","status":"success","context":{"action":"reload-prompt","changeType":"modified","documentId":"682b64b4b0315f7","eventTimestamp":1792126264687,"isModified":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/s152.md","pathMatchesActive":true,"windowLabel":"main"}}
L35600: {"ts":"2026-10-16T12:51:20.203+08:00","level":"info","event":"file.watch.event","status":"success","context":{"changeType":"modified","detail":"any","info":null,"kind":"modify_name","mtimeMs":1792126280102,"outcome":"emitted_modified","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/s152.md","pathCount":1,"rescan":false,"size":16,"timestamp":1792126280203,"unchangedCheck":"stat_differs"}}
L35605: {"ts":"2026-10-16T12:51:20.514+08:00","level":"info","event":"file.change.decision","status":"success","context":{"action":"reload-prompt","changeType":"modified","documentId":"682b64b4b0315f7","eventTimestamp":1792126280203,"isModified":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/67715ea-rc035-a/s152.md","pathMatchesActive":true,"windowLabel":"main"}}
L35622: {"ts":"2026-10-16T12:51:38.116+08:00","level":"info","event":"view.mode.change","status":"success","context":{"fromMode":"source","intent":"user","source":"setViewMode","toMode":"wysiwyg"}}
L35638: {"ts":"2026-10-16T12:51:45.535+08:00","level":"info","event":"app.quit.check","status":"success","context":{"answer":"clean","dirtyCount":0,"discardedUnchangedCount":0,"flushFailed":false,"phase":"check","requestId":1}}
L35649: {"ts":"2026-10-16T12:51:45.554+08:00","level":"info","event":"app.quit","status":"success","context":{}}
L35661: {"ts":"2026-10-16T12:52:11.678+08:00","level":"info","event":"app.ready","status":"success","context":{"appVersion":"0.3.5","buildId":"unknown","pid":63650,"platform":"macos","releaseId":"0.3.5@67715ea28eb12534f59e7ae99d9c87998fc0f0bd","startupTimeMs":201},"durationMs":201,"error":null}
L35700: {"ts":"2026-10-16T12:52:21.604+08:00","level":"info","event":"ui.menu.select","status":"success","context":{"controlId":"menu.theme.light","windowLabel":"main"}}
L36127: {"ts":"2026-10-16T12:54:49.761+08:00","level":"info","event":"app.ready","status":"success","context":{"appVersion":"0.3.5","buildId":"unknown","pid":65563,"platform":"macos","releaseId":"0.3.5@67715ea28eb12534f59e7ae99d9c87998fc0f0bd","startupTimeMs":208},"durationMs":208,"error":null}
L36167: {"ts":"2026-10-16T12:54:55.895+08:00","level":"info","event":"ui.menu.select","status":"success","context":{"controlId":"menu.theme.dark","windowLabel":"main"}}
L36540: {"ts":"2026-10-16T12:56:33.442+08:00","level":"info","event":"ui.menu.select","status":"success","context":{"controlId":"menu.theme.system","windowLabel":"mdpro-49834792-fa54-4d2b-8bd4-c8202682f6c5"}}
L36586: {"ts":"2026-10-16T12:56:40.639+08:00","level":"info","event":"app.quit","status":"success","context":{}}
L35749: {"ts":"2026-10-16T12:52:38.247+08:00","level":"info","event":"file.watch.event","status":"success","context":{"changeType":"deleted","detail":"file","info":null,"kind":"remove","mtimeMs":null,"outcome":"emitted_deleted","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/s3/light/rm-light-1.md","pathCount":1,"rescan":false,"size":null,"timestamp":1792126358247,"unchangedCheck":"not_checked"}}
L35750: {"ts":"2026-10-16T12:52:38.247+08:00","level":"info","event":"file.watch.event","status":"cancel","context":{"changeType":null,"detail":"extended","info":null,"kind":"modify_metadata","mtimeMs":null,"outcome":"debounced","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/s3/light/rm-light-1.md","pathCount":1,"rescan":false,"size":null,"timestamp":1792126358247,"unchangedCheck":"not_checked"}}
L35755: {"ts":"2026-10-16T12:52:38.553+08:00","level":"info","event":"file.change.decision","status":"success","context":{"action":"deleted-prompt","changeType":"deleted","documentId":"972b1f6bb17f861f","eventTimestamp":1792126358247,"isModified":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/s3/light/rm-light-1.md","pathMatchesActive":true,"windowLabel":"mdpro-5e63ade2-4c7a-426f-ba3d-bd5fb6f0372d"}}
L35821: {"ts":"2026-10-16T12:53:05.681+08:00","level":"info","event":"file.watch.event","status":"success","context":{"changeType":"deleted","detail":"file","info":null,"kind":"remove","mtimeMs":null,"outcome":"emitted_deleted","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/s3/light/rm-light-2.md","pathCount":1,"rescan":false,"size":null,"timestamp":1792126385681,"unchangedCheck":"not_checked"}}
L35822: {"ts":"2026-10-16T12:53:05.681+08:00","level":"info","event":"file.watch.event","status":"cancel","context":{"changeType":null,"detail":"extended","info":null,"kind":"modify_metadata","mtimeMs":null,"outcome":"debounced","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/s3/light/rm-light-2.md","pathCount":1,"rescan":false,"size":null,"timestamp":1792126385681,"unchangedCheck":"not_checked"}}
L35828: {"ts":"2026-10-16T12:53:05.989+08:00","level":"info","event":"file.change.decision","status":"success","context":{"action":"deleted-prompt","changeType":"deleted","documentId":"569c736b842e5fea","eventTimestamp":1792126385681,"isModified":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/s3/light/rm-light-2.md","pathMatchesActive":true,"windowLabel":"mdpro-e587c377-0518-463e-9eb6-4362936a581d"}}
L35894: {"ts":"2026-10-16T12:53:31.130+08:00","level":"info","event":"file.watch.event","status":"success","context":{"changeType":"deleted","detail":"file","info":null,"kind":"remove","mtimeMs":null,"outcome":"emitted_deleted","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/s3/light/rm-light-3.md","pathCount":1,"rescan":false,"size":null,"timestamp":1792126411130,"unchangedCheck":"not_checked"}}
L35895: {"ts":"2026-10-16T12:53:31.131+08:00","level":"info","event":"file.watch.event","status":"cancel","context":{"changeType":null,"detail":"extended","info":null,"kind":"modify_metadata","mtimeMs":null,"outcome":"debounced","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/s3/light/rm-light-3.md","pathCount":1,"rescan":false,"size":null,"timestamp":1792126411131,"unchangedCheck":"not_checked"}}
L35902: {"ts":"2026-10-16T12:53:31.437+08:00","level":"info","event":"file.change.decision","status":"success","context":{"action":"deleted-prompt","changeType":"deleted","documentId":"2b7f2185351051ff","eventTimestamp":1792126411130,"isModified":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/s3/light/rm-light-3.md","pathMatchesActive":true,"windowLabel":"mdpro-1ecb966d-db59-453e-84af-077072c36d65"}}
L35968: {"ts":"2026-10-16T12:53:48.202+08:00","level":"info","event":"file.watch.event","status":"success","context":{"changeType":"deleted","detail":"file","info":null,"kind":"remove","mtimeMs":null,"outcome":"emitted_deleted","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/s3/light/rm-light-4.md","pathCount":1,"rescan":false,"size":null,"timestamp":1792126428202,"unchangedCheck":"not_checked"}}
L35969: {"ts":"2026-10-16T12:53:48.202+08:00","level":"info","event":"file.watch.event","status":"cancel","context":{"changeType":null,"detail":"extended","info":null,"kind":"modify_metadata","mtimeMs":null,"outcome":"debounced","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/s3/light/rm-light-4.md","pathCount":1,"rescan":false,"size":null,"timestamp":1792126428202,"unchangedCheck":"not_checked"}}
L35977: {"ts":"2026-10-16T12:53:48.508+08:00","level":"info","event":"file.change.decision","status":"success","context":{"action":"deleted-prompt","changeType":"deleted","documentId":"746b135924d73907","eventTimestamp":1792126428202,"isModified":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/s3/light/rm-light-4.md","pathMatchesActive":true,"windowLabel":"mdpro-3338529d-dc13-4452-9a3a-11d03101b16e"}}
L36043: {"ts":"2026-10-16T12:54:05.471+08:00","level":"info","event":"file.watch.event","status":"success","context":{"changeType":"deleted","detail":"file","info":null,"kind":"remove","mtimeMs":null,"outcome":"emitted_deleted","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/s3/light/rm-light-5.md","pathCount":1,"rescan":false,"size":null,"timestamp":1792126445471,"unchangedCheck":"not_checked"}}
L36044: {"ts":"2026-10-16T12:54:05.472+08:00","level":"info","event":"file.watch.event","status":"cancel","context":{"changeType":null,"detail":"extended","info":null,"kind":"modify_metadata","mtimeMs":null,"outcome":"debounced","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/s3/light/rm-light-5.md","pathCount":1,"rescan":false,"size":null,"timestamp":1792126445472,"unchangedCheck":"not_checked"}}
L36053: {"ts":"2026-10-16T12:54:05.778+08:00","level":"info","event":"file.change.decision","status":"success","context":{"action":"deleted-prompt","changeType":"deleted","documentId":"f62b5067eac1e141","eventTimestamp":1792126445471,"isModified":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/s3/light/rm-light-5.md","pathMatchesActive":true,"windowLabel":"mdpro-e1b0bc33-25d2-4797-bf13-fc6bc7e05ed0"}}
L36216: {"ts":"2026-10-16T12:55:05.899+08:00","level":"info","event":"file.watch.event","status":"success","context":{"changeType":"deleted","detail":"file","info":null,"kind":"remove","mtimeMs":null,"outcome":"emitted_deleted","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/s3/dark/rm-dark-1.md","pathCount":1,"rescan":false,"size":null,"timestamp":1792126505899,"unchangedCheck":"not_checked"}}
L36217: {"ts":"2026-10-16T12:55:05.900+08:00","level":"info","event":"file.watch.event","status":"cancel","context":{"changeType":null,"detail":"extended","info":null,"kind":"modify_metadata","mtimeMs":null,"outcome":"debounced","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/s3/dark/rm-dark-1.md","pathCount":1,"rescan":false,"size":null,"timestamp":1792126505900,"unchangedCheck":"not_checked"}}
L36222: {"ts":"2026-10-16T12:55:06.204+08:00","level":"info","event":"file.change.decision","status":"success","context":{"action":"deleted-prompt","changeType":"deleted","documentId":"3c12d9760e827760","eventTimestamp":1792126505899,"isModified":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/s3/dark/rm-dark-1.md","pathMatchesActive":true,"windowLabel":"mdpro-58130314-640f-4b33-afa5-d80b8ad98273"}}
L36288: {"ts":"2026-10-16T12:55:23.968+08:00","level":"info","event":"file.watch.event","status":"success","context":{"changeType":"deleted","detail":"file","info":null,"kind":"remove","mtimeMs":null,"outcome":"emitted_deleted","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/s3/dark/rm-dark-2.md","pathCount":1,"rescan":false,"size":null,"timestamp":1792126523968,"unchangedCheck":"not_checked"}}
L36289: {"ts":"2026-10-16T12:55:23.969+08:00","level":"info","event":"file.watch.event","status":"cancel","context":{"changeType":null,"detail":"extended","info":null,"kind":"modify_metadata","mtimeMs":null,"outcome":"debounced","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/s3/dark/rm-dark-2.md","pathCount":1,"rescan":false,"size":null,"timestamp":1792126523969,"unchangedCheck":"not_checked"}}
L36295: {"ts":"2026-10-16T12:55:24.273+08:00","level":"info","event":"file.change.decision","status":"success","context":{"action":"deleted-prompt","changeType":"deleted","documentId":"f126c80eb3c8aec3","eventTimestamp":1792126523968,"isModified":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/s3/dark/rm-dark-2.md","pathMatchesActive":true,"windowLabel":"mdpro-4c9b7b95-b317-4877-9642-e65af40b54ce"}}
L36361: {"ts":"2026-10-16T12:55:39.886+08:00","level":"info","event":"file.watch.event","status":"success","context":{"changeType":"deleted","detail":"file","info":null,"kind":"remove","mtimeMs":null,"outcome":"emitted_deleted","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/s3/dark/rm-dark-3.md","pathCount":1,"rescan":false,"size":null,"timestamp":1792126539886,"unchangedCheck":"not_checked"}}
L36362: {"ts":"2026-10-16T12:55:39.887+08:00","level":"info","event":"file.watch.event","status":"cancel","context":{"changeType":null,"detail":"extended","info":null,"kind":"modify_metadata","mtimeMs":null,"outcome":"debounced","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/s3/dark/rm-dark-3.md","pathCount":1,"rescan":false,"size":null,"timestamp":1792126539887,"unchangedCheck":"not_checked"}}
L36369: {"ts":"2026-10-16T12:55:40.193+08:00","level":"info","event":"file.change.decision","status":"success","context":{"action":"deleted-prompt","changeType":"deleted","documentId":"3161a4b590c8d6f2","eventTimestamp":1792126539886,"isModified":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/s3/dark/rm-dark-3.md","pathMatchesActive":true,"windowLabel":"mdpro-d9287d58-f32d-4723-b1ee-6fabb137524c"}}
L36435: {"ts":"2026-10-16T12:55:55.494+08:00","level":"info","event":"file.watch.event","status":"success","context":{"changeType":"deleted","detail":"file","info":null,"kind":"remove","mtimeMs":null,"outcome":"emitted_deleted","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/s3/dark/rm-dark-4.md","pathCount":1,"rescan":false,"size":null,"timestamp":1792126555494,"unchangedCheck":"not_checked"}}
L36436: {"ts":"2026-10-16T12:55:55.494+08:00","level":"info","event":"file.watch.event","status":"cancel","context":{"changeType":null,"detail":"extended","info":null,"kind":"modify_metadata","mtimeMs":null,"outcome":"debounced","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/s3/dark/rm-dark-4.md","pathCount":1,"rescan":false,"size":null,"timestamp":1792126555494,"unchangedCheck":"not_checked"}}
L36444: {"ts":"2026-10-16T12:55:55.800+08:00","level":"info","event":"file.change.decision","status":"success","context":{"action":"deleted-prompt","changeType":"deleted","documentId":"974af9909bc82249","eventTimestamp":1792126555494,"isModified":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/s3/dark/rm-dark-4.md","pathMatchesActive":true,"windowLabel":"mdpro-e604cf1e-4978-4615-a914-07028b0c9b6b"}}
L36510: {"ts":"2026-10-16T12:56:10.903+08:00","level":"info","event":"file.watch.event","status":"success","context":{"changeType":"deleted","detail":"file","info":null,"kind":"remove","mtimeMs":null,"outcome":"emitted_deleted","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/s3/dark/rm-dark-5.md","pathCount":1,"rescan":false,"size":null,"timestamp":1792126570903,"unchangedCheck":"not_checked"}}
L36511: {"ts":"2026-10-16T12:56:10.904+08:00","level":"info","event":"file.watch.event","status":"cancel","context":{"changeType":null,"detail":"extended","info":null,"kind":"modify_metadata","mtimeMs":null,"outcome":"debounced","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/s3/dark/rm-dark-5.md","pathCount":1,"rescan":false,"size":null,"timestamp":1792126570904,"unchangedCheck":"not_checked"}}
L36520: {"ts":"2026-10-16T12:56:11.209+08:00","level":"info","event":"file.change.decision","status":"success","context":{"action":"deleted-prompt","changeType":"deleted","documentId":"9345068309d33443","eventTimestamp":1792126570903,"isModified":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/s3/dark/rm-dark-5.md","pathMatchesActive":true,"windowLabel":"mdpro-49834792-fa54-4d2b-8bd4-c8202682f6c5"}}
```
