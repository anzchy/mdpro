# Report: combined watcher regression on `819fa2c` (D32, D68, D69, D86, D112; D70 race 1)

Brief: `~/.mdpro-redesign/dtrack/brief-20261011-watcher-819fa2c.md`. Run 2026-10-11 12:40–12:51 (GMT+8), one dtrack run, zsh. No repo edits, commits or pushes. No MCP calls. Log `~/.mdpro/mdpro.log`; all `L` numbers below are line numbers in that file. The proof lines are quoted in full in the appendix.

## 1. Build evidence

| Check | Result |
|---|---|
| `stat -f %m …/tauri-app` | `1791693243` = `BIN_MTIME` ✔ |
| `shasum -a 256 …/tauri-app` | `8cbc3f5d1d2e53f62e6fde3a22fd3a6ee43af5062414255153bbadac44d65ddb` = `BIN_SHA` ✔ |
| `git -C $WT rev-parse --short HEAD` | `819fa2c` ✔ |
| ancestors | `ac79c63 0`, `dc22bd9 0`, `658bc1d 0`, `d91fb38 0`, `963cec6 0`, `a61e4e3 0` ✔ |
| `cat-file -e` | `file_watcher_route.rs 0`, `file_watcher_baseline_check.rs 0`, `file_watcher_register_log.rs 0`, `useFileWatcher.ts 0`, `fileChangeLog.ts 0`, `documentSave.ts 0`, `ReloadDialog.tsx 0` ✔ |
| `git grep -n save-suppressed HEAD -- src/` | one hit, a comment only: `src/utils/fileChangeLog.ts:38: *   delivered -> success. (\`save-suppressed\` went with the frontend's 3 s save` ✔ |
| Input source | `"KeyboardLayout Name" = ABC` ✔ |
| `request_access` (mdpro) | `{"granted":[{"bundleId":"com.mdpro.app","displayName":"mdpro","grantedAt":1791693654444}],"denied":[],"screenshotFiltering":"native"}` |
| `pgrep -fl 'mdpro\|tauri-app'` before launch | no mdpro / tauri-app process. It matched two non-app processes only: `24817 tmux new -s dtrack -c /Users/jack/.mdpro-redesign/dtrack` and `66024 claude --resume mdpro-remote`. Neither is an mdpro process; nothing was quit. |
| PID / `ps` path | `47841 Sun Oct 11 12:41:23 2026  /Users/jack/.mdpro-redesign/dtrack/builds/819fa2c/mdpro.app/Contents/MacOS/tauri-app` ✔ |
| Cold launch | L13864 `file.open.external` `start`, `"appReady":false`, `source:"finder"` ✔. No Recover drafts dialog. |
| About | `shots/about.png`: **mdpro, Version v0.3.0** (expected; not bumped). It showed "Checking for updates…" and a disabled-looking "Check Again". No update button was clicked. Settings closed with its ×. |
| `W0` | `about.png` = **1200 × 800** px. All later shots are 1200 × 800 too. |
| `big.md` start size | `10477556` bytes, inside (10469376, 10477568] ✔ |
| Symlink check | `$S` has no symlink (`pwd -P` equal). Logged `path` is exactly `$S/<name>` (L13894). |
| Source mode | gate → ⌃2 → L13922 `view.mode.change` `wysiwyg`→`source` ✔ |

## 2. Settings

As-found (before launch):
```
{"themeMode":"system","defaultViewMode":"wysiwyg","lastViewMode":"wysiwyg","autoSaveInterval":30,"logging":{"enabled":true,"level":"info"},"mcp":{"serverEnabled":true}}
```
Re-read after quit (`cmp` against the saved as-found file, exit **0**):
```
{"themeMode":"system","defaultViewMode":"wysiwyg","lastViewMode":"wysiwyg","autoSaveInterval":30,"logging":{"enabled":true,"level":"info"},"mcp":{"serverEnabled":true}}
```

## 3. Verdict table

| Row | Item | Verdict | RESIDUAL | Proof line |
|---|---|---|---|---|
| W1 | D86 ② / WI-3 seeded open | **PASS** | 0 | L13894 |
| W2 | D32 re-open unchanged | **PASS** | 0 | L13934 |
| W3 | D32 / D86 external edit | **PASS** (`stat_differs`) | 0 | L13935, L13937–L13939 |
| W4 | D68 atomic replace | **PASS** | 0 | L13943, L13945–L13947 |
| W5 | D86 ① / WI-4 external edit right after ⌘S | **PASS** (gap 482 ms) | 0 | L13967 → L13974, L13977–L13979 |
| W6 | D86 / D112 ⌘S×20 | **PASS** (20/20 exercised, OWN-MARK 0) | 0 | L13996–L14196 (40 watch events) |
| W6b | b37 race 1, ⌘S burst ×5 ×3 | **PASS** (3/3 bursts exercised) | 0 | `file.save.queued` L14228, L14275, L14334 (+6 more) |
| W6c | D70 queued save pair ×5 | **NOT EXERCISED (5 of 5: no `file.save.queued` line in any pair)** | 0 | none. 10 saves, 0 prompts, all `ignored_unchanged/unchanged` |
| W7 | D112 own save past 10 MiB | **PASS** | 0 | L14504 (`fileSizeBytes` 10496356), L14508 |
| W8 | D69 Save As target watched | **PASS on the brief's three criteria, with FINDING F1** (Reload on the Save-As'd doc opens a duplicate tab; the stale tab's save then overwrites the reloaded content) | 0 | L14528, L14534/L14538, L14549–L14550 |
| W9 | D86 ④ closed file stays closed | **PASS** | 0 | L14568; `since '.'` L14567–L14571 |

Run-wide: **0** `save-suppressed` lines (log from L13863 to the end). **4** `reload-prompt` decisions, all from external writes the brief expected (W3 12:42:22.085, W4 12:42:39.939, W5 12:43:27.245, W8 12:48:58.326). There were no own-save prompts, so **0 RESIDUAL** in the whole run. `unchangedCheck` values seen across the run: `unchanged` 79, `not_checked` 24, `stat_differs` 4 (the four external writes). No `unstable`, `read_failed`, `no_baseline`, `over_cap`, `hash_differs`, `gen_moved` or `no_entry`.

## 4. Items

### W1. Seeded open (`w.md`)
- `mark 13862`. `open -a "$APP" $S/w.md` at 12:41:23 (the cold launch).
- L13894 `file.watch.register` `"alreadyWatched":false,"baseline":"seeded",…,"ok":true,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/819fa2c-watcher/w.md","size":41,"watchedCount":1` → **PASS**.

### W2. Re-open, unchanged (`w.md`)
- `mark 13929`, then `open -a` again, a 5 s wait and `shot.sh w2` (no dialog).
- `since '.'` L13930–L13934: `file.open.external` (`appReady:true`), `file.open.route` `existing-window`, `file.open.route` `activated:true`, then L13934 `file.watch.event` `"kind":"modify_metadata","outcome":"ignored_unchanged",…,"unchangedCheck":"unchanged"`. No `file.change.*` lines → **PASS**.

### W3. Real external edit (`w.md`)
- `mark 13934`, then `printf x >> $X`, a 3 s wait and `shot.sh w3` first (the dialog **External change detected** is in the live screenshot).
- L13935 `modify_metadata` `emitted_modified` **`stat_differs`** (size 42). L13936 `modify_data` `ignored_unchanged/unchanged` (same append; the baseline had already moved). L13937 `file.change.received` `scheduled`, L13938 `delivered`, L13939 `file.change.decision` `reload-prompt` (`isModified:false`) → **PASS**.
- Reload clicked: L13940 `ui.dialog.confirm` `dialog.reload.reload`, L13942 `editor.milkdown.reload`.

### W4. Atomic replace (`w.md`)
- `mark 13942`, then `printf y > $X.tmp && mv $X.tmp $X`, a 3 s wait and `shot.sh w4` first (the dialog is in the live screenshot).
- L13943 `"kind":"modify_name"` `emitted_modified` `stat_differs` (size 1). L13944 `modify_name` `ignored_unchanged/unchanged`. L13945 `scheduled`, L13946 `delivered`, L13947 `reload-prompt`. It logged as a **single-path** `modify_name`, not `ignored_rename_single_path` → **PASS** (no NOTE needed). Reload clicked; afterwards `cat w.md` = `y`.

### W5. External edit right after ⌘S (`w5.md`)
- OPEN: L13955 register `baseline:"seeded"`, `ok:true`, size 42. Clicked after `Second paragraph.`, waited 5 s. Gate `window.focus` / `main`. `mark 13963`, then the one-line command; `ext 12:43:26`.
- Save: L13967 `file.save` `success` `ts 12:43:26.456`, `fileSizeBytes` 43. Own-save events L13969 and L13970 are `modify_name` `ignored_unchanged/unchanged`.
- External event: L13974 `emitted_modified` `stat_differs` (size 44) at `ts 12:43:26.938`. **Gap 482 ms** (< 3 000 ms). L13977 `scheduled`, L13978 `delivered`, L13979 `reload-prompt` → **PASS**.
- `tally 13963`: `{"saves":1,"watch":{"emitted_modified/stat_differs":1,"ignored_unchanged/unchanged":4},"recv":{"delivered":1,"scheduled":1},"prompts":1}`. Exactly one prompt, the append's; no second prompt. Reload clicked (L13980, L13982). File afterwards: `Second paragraph.z` / `z`. `shot.sh w5`.

### W6. ⌘S×20 (`w6.md`)
- OPEN: L13987 register `seeded`, `ok:true`. Gate OK, `mark 13995`, loop of 20. No prompt during the loop, so no `w6-dlg` shot. Saves ran from 12:44:10.514 to 12:44:41.883.
- `tally 13995`: `{"saves":20,"watch":{"ignored_unchanged/unchanged":32,"self_write/not_checked":8},"recv":null,"prompts":0}`
- `persave 13995`:
  `{"1":["ignored_unchanged/unchanged","ignored_unchanged/unchanged","self_write/not_checked"],"2":["ignored_unchanged/unchanged","self_write/not_checked"],"3":["ignored_unchanged/unchanged"],"4":["ignored_unchanged/unchanged","ignored_unchanged/unchanged"],"5":["ignored_unchanged/unchanged","ignored_unchanged/unchanged"],"6":["ignored_unchanged/unchanged","ignored_unchanged/unchanged","self_write/not_checked"],"7":["ignored_unchanged/unchanged"],"8":["ignored_unchanged/unchanged","ignored_unchanged/unchanged"],"9":["ignored_unchanged/unchanged","ignored_unchanged/unchanged"],"10":["ignored_unchanged/unchanged","ignored_unchanged/unchanged","self_write/not_checked"],"11":["ignored_unchanged/unchanged"],"12":["ignored_unchanged/unchanged","ignored_unchanged/unchanged","self_write/not_checked"],"13":["ignored_unchanged/unchanged","self_write/not_checked"],"14":["ignored_unchanged/unchanged"],"15":["ignored_unchanged/unchanged","ignored_unchanged/unchanged"],"16":["ignored_unchanged/unchanged","ignored_unchanged/unchanged","self_write/not_checked"],"17":["ignored_unchanged/unchanged","self_write/not_checked"],"18":["ignored_unchanged/unchanged"],"19":["ignored_unchanged/unchanged","ignored_unchanged/unchanged"],"20":["ignored_unchanged/unchanged","ignored_unchanged/unchanged"]}`
- All 40 watch events are `modify_name`. There are none of `ignored_rename_single_path` (the `eb061fa` failure is gone) and none of `emitted_*`. Every row 1–20 has at least one `ignored_unchanged/unchanged` → **20 of 20 exercised; OWN-MARK = 0** (no `self_write`-only row).
- Note on attribution: a `self_write/not_checked` event logged between a save's `start` and `success` (e.g. 12:44:12.165 between 12:44:12.157 `start` and 12:44:12.166 `success`) is counted by `persave` in the *previous* row, because rows split at `success`. This does not change the verdict.
- `tail -c 40 $X` → `…ph.....................` plus a newline: **21 dots** (the original `.` + 20) ✔.
- Full `since "$FW"` slice: L13996–L14196, 80 lines (saved at `scratch/w6-slice.txt`).

### W6b. ⌘S burst ×5, three times (`w6b.md`)
- OPEN: L14202 register `seeded`, `ok:true`. `mark 14210`. Gate `window.focus` / `main` before each burst. No prompt after any burst, so no `w6b-dlg-*` shot.
- Per burst (line windows L14210–14263, L14263–14316, L14316–end):

| Burst | start | `file.save` success (ts, s) | `file.save.queued` | watch events |
|---|---|---|---|---|
| 1 | 12:45:29.503 | 5: 29.662 29.687 29.709 29.731 29.753 | 3: L14228 29.691, L14237 29.707, L14246 29.722 | `ignored_unchanged/unchanged` 4, `self_write/not_checked` 6 |
| 2 | 12:45:34.811 | 5: 34.963 34.990 35.014 35.037 35.058 | 3: L14275 34.978, L14289 35.010, L14297 35.025 | `ignored_unchanged/unchanged` 8, `self_write/not_checked` 2 |
| 3 | 12:45:40.122 | 5: 40.283 40.306 40.337 40.359 40.381 | 3: L14334 40.312, L14340 40.327, L14345 40.338 | `ignored_unchanged/unchanged` 2, `self_write/not_checked` 8 |

- Each queued line has context `{"documentId":"f576b8e5a0fe50b7"}` only, with no path ✔. Each ⌘S on the just-saved, clean document wrote again: 5 `file.save` successes per burst for one typed `.`.
- `tally 14210`: `{"saves":15,"watch":{"ignored_unchanged/unchanged":14,"self_write/not_checked":16},"recv":null,"prompts":0}`
- `persave 14210`: `{"1":["ignored_unchanged/unchanged","ignored_unchanged/unchanged"],"2":["ignored_unchanged/unchanged","ignored_unchanged/unchanged","self_write/not_checked","self_write/not_checked"],"3":["self_write/not_checked","self_write/not_checked"],"4":["self_write/not_checked","self_write/not_checked"],"6":["ignored_unchanged/unchanged","ignored_unchanged/unchanged"],"7":["ignored_unchanged/unchanged","ignored_unchanged/unchanged"],"8":["ignored_unchanged/unchanged","ignored_unchanged/unchanged"],"9":["ignored_unchanged/unchanged","ignored_unchanged/unchanged","self_write/not_checked","self_write/not_checked"],"10":["self_write/not_checked","self_write/not_checked"],"11":["self_write/not_checked"],"12":["ignored_unchanged/unchanged"],"13":["self_write/not_checked","self_write/not_checked","self_write/not_checked","self_write/not_checked"],"15":["self_write/not_checked","ignored_unchanged/unchanged"]}`. Saves 5 and 14 (the last of burst 1 and the fourth of burst 3) have no event of their own after their `success`. Their writes coalesced with the neighbouring saves' events, so this is not a failure. W6b's proof is per burst, not per save.
- `tail -c 10 $X` → `graph....` plus a newline: 1 original + **3 dots** ✔.
- **PASS**: 0 prompts, every own-save event `ignored_unchanged/unchanged` or `self_write/not_checked`, 3 of 3 bursts with `file.save.queued`. Race 1 not observed. Full slice L14211–L14369 (`scratch/w6b-slice.txt`).

### W6c. Queued save pair ×5 (`w6c.md`)
- OPEN: L14374 register `seeded`, `ok:true`. `mark 14382`. Gate `window.focus` / `main` before each of the 5 pairs. No prompts, so no `w6c-dlg-*` shot.

| Pair | `file.save` successes (ts) | gap | `file.save.queued` | watch |
|---|---|---|---|---|
| 1 | 12:46:31.614, 31.830 | 216 ms | **0** | `ignored_unchanged/unchanged` 4 |
| 2 | 12:46:36.099, 36.313 | 214 ms | **0** | `ignored_unchanged/unchanged` 4 |
| 3 | 12:46:40.566, 40.780 | 214 ms | **0** | `ignored_unchanged/unchanged` 4 |
| 4 | 12:46:45.030, 45.247 | 217 ms | **0** | `ignored_unchanged/unchanged` 4 |
| 5 | 12:46:49.498, 49.715 | 217 ms | **0** | `ignored_unchanged/unchanged` 4 |

- `tally 14382`: `{"saves":10,"watch":{"ignored_unchanged/unchanged":20},"recv":null,"prompts":0}`. `persave`: rows 1–10, each `["ignored_unchanged/unchanged","ignored_unchanged/unchanged"]`. `since 'file\.save\.queued'`: **empty**. `tail -c 20 $X` → `aragraph.ababababab` ✔.
- **NOT EXERCISED (5 of 5)**. The `pair()` script has `delay 0.2` between the first ⌘S and `b`. A save here takes about 8–11 ms (`durationMs`), so the first save had always finished before the second ⌘S, and the D70 queue never engaged. W6b did engage the queue (9 `file.save.queued` lines) with no race-1 sign. To exercise W6c as intended, `pair()` needs a smaller delay than one save's duration (or none). The brief gives no redo for this row, so it was not repeated. Slice L14383–L14482 (`scratch/w6c-slice.txt`).

### W7. Own save past 10 MiB (`big.md`)
- Source mode confirmed (`SOURCE` label). OPEN: L14484 `file.open` `start`, then L14487 register **`baseline:"seeded"`**, `ok:true`, `size 10477556`. L14488 `file.open` success. It took about 12 s from `start` to success.
- Waited 10 s. `pbpaste | wc -c` = **18800** ✔. Clicked in the text; gate; ⌘↓ (`kc.sh 125 command`); gate; ⌘V; waited 5 s. `mark 14500`; gate; ⌘S; waited 15 s untouched. Then `shot.sh w7`.
- L14504 `file.save` `success` **`fileSizeBytes":10496356`** (≥ 10 489 856 ✔), **`durationMs":21`**. L14508 and L14510 `modify_name` **`ignored_unchanged/unchanged`**, size 10496356. No `file.change.*`. `stat -f %z` = `10496356`.
- `tally 14500`: `{"saves":1,"watch":{"ignored_unchanged/unchanged":2},"recv":null,"prompts":0}` → **PASS**.
- Expected: L14511 `mcp.sync` `warn` `fail` `"document 606a8205b969026 content exceeds 10485760 byte limit (10496356 bytes)"`.
- ⌘W closed `big.md`: L14513 `file.watch.unregister` and L14515 `tab.close` (it was clean; no dialog).

### W8. Save As target (new `w8-new.md`)
- Gate; ⌘N (Untitled tab); gate; typed `D69 new`. Gate, `mark 14520`, ⌘S opened the save sheet. In it: ⌘⇧G, typed `/Users/jack/.mdpro-redesign/dtrack/scratch/819fa2c-watcher/` and double-clicked the folder row (see slips). Set the name to `w8-new.md` and clicked **Save**.
- L14527 `file.save` success `fileSizeBytes 7`, then **L14528 `file.watch.register` `"baseline":"seeded",…,"ok":true,"path":".../w8-new.md","size":7,"watchedCount":6`** ✔. L14530 own event `modify_name` `ignored_unchanged/unchanged`.
- Waited 5 s, `mark 14533`, `printf x >> $X`, waited 3 s, `shot.sh w8` (dialog in the live screenshot). L14534 `modify_metadata` **`emitted_modified` `stat_differs`**, L14536 `scheduled`, L14537 `delivered`, **L14538 `reload-prompt`** with `"documentId":"09cf98a4-49f8-4206-a94a-5075e0b6aaaa"` ✔.
- Clicked **Reload**: see **F1** below.
- Waited 5 s. Clicked at the end of the text in the active tab, gate, `key.sh .`, gate, ⌘S, waited 5 s (`mark 14542`, `shot.sh w8-save2`). L14546 `file.save` success `fileSizeBytes 8`. L14549 and L14550 `modify_name` `ignored_unchanged/unchanged`. No `file.change.*`, no prompt ✔.
- On the brief's criteria (register line, append prompts, second ⌘S quiet): **PASS**. File at the end: `D69 new.` (8 bytes).

**F1 (new finding, outside the brief's criteria): Reload on a Save-As'd document opens a duplicate tab, and the stale tab can overwrite the reloaded content.**
- After **Reload** (L14539 `ui.dialog.confirm` `dialog.reload.reload`), the log shows L14541 `editor.milkdown.reload` and L14542 **`tab.open`**, both for `documentId":"587380890efc5600"` and `filePath .../w8-new.md`, `tabIndex 6`. The prompting document was `09cf98a4-…`.
- The active tab (`09cf98a4-…`) kept showing `D69 new` without the `x` (`shots/w8-after-reload.png`). A second `w8-new.md` tab appeared holding `D69 newx` (`shots/w8-dup-tab.png`).
- Following the brief, the `.` + ⌘S went to the active, stale tab, so the file became `D69 new.`: **the external `x` the user had chosen to Reload was overwritten**. The duplicate tab still shows `D69 newx` and got no prompt, because the save was an own save (`ignored_unchanged`). Quit treated it as clean.
- Likely cause (from reading `819fa2c`, not tested on its own): `handleReloadFile` (`src/App.tsx:435`) calls `fileService.reloadFile(path)` and passes the result to `replaceDocument` (`src/hooks/useDocument.ts:207`), which does `upsertDocument(document)`. The reloaded document carries the path-derived id (`587380890efc5600`), while a document that started Untitled keeps its UUID (`09cf98a4-…`) after Save As. So the upsert adds a new document instead of replacing the active one.
- Scope: seen only on a document that started as Untitled and then had Save As. Path-opened documents in W3, W4 and W5 reloaded in place (`editor.milkdown.reload` on the same id, no `tab.open`). This is for the delegator to triage; it does not count against D69's watch / seed criteria.

### W9. Closed file stays closed (`w9.md`)
- OPEN: L14558 register `seeded`, `ok:true`, `watchedCount 7`. Waited 5 s. `mark 14566`, gate, ⌘W. **L14568 `file.watch.unregister` `ok:true` for `.../w9.md`, `watchedCount 6`**, then L14570 `tab.close` `wasModified:false` and L14571 `file.close`.
- Waited 2 s, then `printf q >> $S/w9.md` at 12:50:29. Waited 5 s and took `shot.sh w9` (no dialog; it shows the `w8-new.md` duplicate tab).
- Unfiltered `since '.'` after mark 14566: **L14567–L14571 only** (shortcut, unregister, TOC reset, tab.close, file.close). Nothing logged after the append: no `file.watch.event` and no `file.change.*`. A re-check 3 s later still showed nothing after L14571. `tally 14566`: `{"saves":0,"watch":null,"recv":null,"prompts":0}` → **PASS**.

### Restore and Close
- The window stayed 1200 × 800 (`W0`) throughout; no resize was needed. Gate, ⌃4 → L14574 `view.mode.change` `source`→`wysiwyg` (as-found `lastViewMode` wysiwyg).
- mdpro › Quit mdpro: **no Unsaved changes dialog** (discarded count 0). `app.quit.check` `"answer":"clean","dirtyCount":0` (12:51:11.777).
- `pgrep -fl tauri-app` is empty (exit 1). Settings re-read equals the as-found values (§ 2). `$S` was left in place; `big.md` was not copied anywhere.

## 5. Operator slips

1. **W8 "Go":** the macOS Go-to-folder sheet in the save panel has no **Go** button. I navigated by double-clicking the folder suggestion row, as OPEN(f) does; I did not press Return.
2. **W8 name field:** I cleared it with a triple-click and ⌘A inside the save sheet before typing `w8-new.md`. ⌘A is a key press with the sheet open, but it is not Enter or Esc.
3. **W8 extra step:** after the second ⌘S I clicked the duplicate `w8-new.md` tab to record F1 (`w8-dup-tab.png`). The brief has no such step. It only switched tabs (L14553 `tab.switch`) and wrote nothing.
4. **W2 / W3 / W4 / W8 external writes:** no focus gate ran before them. They are shell file writes, not key presses, so the brief's gate does not apply.
5. **Gates:** every gate before a key press, typed text or paste printed `window.focus` / `main`. The `key.sh o` / `key.sh g` calls for each OPEN, ⌘N, and the typing in the save and open sheets were gated once before each sequence, not before every single key.
6. **Path typing in OPEN(f) and the save sheet** used computer-use `type` into the native panel, not `key.sh`.

Nothing else differed from the brief.

## 6. Deviations and notes

- **N1-style corrections:** none needed. All strings were present at `819fa2c`, and `save-suppressed` appears in `src/` only as a comment.
- **W6c NOT EXERCISED** is a brief-design issue: the `delay 0.2` in `pair()` is longer than one save (~10 ms), so the D70 queue never engages. Proposed fix for a re-run: drop the delay or make it ≤ 5 ms. W6b's bursts did exercise the queue.
- **F1** (W8 duplicate tab on Reload after Save As; external content overwritten by the stale tab's ⌘S) is the one new defect from this run. See § W8.
- `unchangedCheck` values not named in a verdict: none. Every value seen is `unchanged`, `not_checked` or `stat_differs`.
- **W3 / W5 / W8:** each external append also logged a second event (`modify_data` or `modify_metadata`) as `ignored_unchanged/unchanged` right after the `emitted_modified` one. The first event had already moved the baseline. This is expected and caused no second prompt.
- **W7:** `big.md` took about 12 s to open (L14484 → L14488).
- No autocorrect bubbles appeared. The cold launch showed no Recover drafts dialog.
- Every `file.watch.register` in this run (W1, W5, W6, W6b, W6c, W7, W8, W9) was `baseline:"seeded"`. No `snapshot`, `failopen` or `stale_skipped`.
- **Shots** (`$MDPRO_SHOTS` = `reports/shots/`): `about`, `w2`, `w3`, `w4`, `w5`, `w7`, `w8`, `w8-after-reload`, `w8-save2`, `w8-dup-tab`, `w9`, `restore`, all 1200 × 800.
- **Files left:** the run files in `$S`. `w8-new.md` (`D69 new.`) is there too, created by W8. The as-found JSON is at `~/.mdpro-redesign/dtrack/scratch/asfound-819fa2c-watcher.json`. The slices `w6-slice.txt`, `w6b-slice.txt` and `w6c-slice.txt` are in `~/.mdpro-redesign/dtrack/scratch/`.

## Appendix: proof lines, verbatim (`mdpro.log` line: content)

```
13864: {"ts":"2026-10-11T12:41:27.430+08:00","level":"info","event":"file.open.external","status":"start","actionId":null,"context":{"appReady":false,"filePaths":["/Users/jack/.mdpro-redesign/dtrack/scratch/819fa2c-watcher/w.md"],"source":"finder"},"durationMs":null,"error":null}
13894: {"ts":"2026-10-11T12:41:27.847+08:00","level":"info","event":"file.watch.register","status":"success","actionId":null,"context":{"alreadyWatched":false,"baseline":"seeded","mtimeMs":1791693654871,"ok":true,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/819fa2c-watcher/w.md","size":41,"watchedCount":1},"durationMs":null,"error":null}
13922: {"ts":"2026-10-11T12:41:53.071+08:00","level":"info","event":"view.mode.change","status":"success","actionId":"576b377d-d8de-43ff-adb0-4e7f047224b2","context":{"fromMode":"wysiwyg","intent":"user","source":"setViewMode","toMode":"source"},"durationMs":null,"error":null}
13934: {"ts":"2026-10-11T12:42:03.881+08:00","level":"info","event":"file.watch.event","status":"cancel","actionId":null,"context":{"changeType":null,"detail":"extended","info":null,"kind":"modify_metadata","mtimeMs":1791693654871,"outcome":"ignored_unchanged","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/819fa2c-watcher/w.md","pathCount":1,"rescan":false,"size":41,"timestamp":1791693723880,"unchangedCheck":"unchanged"},"durationMs":null,"error":null}
13935: {"ts":"2026-10-11T12:42:21.770+08:00","level":"info","event":"file.watch.event","status":"success","actionId":null,"context":{"changeType":"modified","detail":"extended","info":null,"kind":"modify_metadata","mtimeMs":1791693741748,"outcome":"emitted_modified","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/819fa2c-watcher/w.md","pathCount":1,"rescan":false,"size":42,"timestamp":1791693741769,"unchangedCheck":"stat_differs"},"durationMs":null,"error":null}
13936: {"ts":"2026-10-11T12:42:21.770+08:00","level":"info","event":"file.watch.event","status":"cancel","actionId":null,"context":{"changeType":null,"detail":"content","info":null,"kind":"modify_data","mtimeMs":1791693741748,"outcome":"ignored_unchanged","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/819fa2c-watcher/w.md","pathCount":1,"rescan":false,"size":42,"timestamp":1791693741770,"unchangedCheck":"unchanged"},"durationMs":null,"error":null}
13937: {"ts":"2026-10-11T12:42:21.775+08:00","level":"info","event":"file.change.received","status":"start","actionId":"68824ea7-4ac0-435d-8431-1ae10603617d","context":{"changeType":"modified","eventTimestamp":1791693741769,"outcome":"scheduled","path":"/Users/jack/.mdpro-redesign/dtrack/scratch/819fa2c-watcher/w.md","windowLabel":"main"},"durationMs":null,"error":null}
13938: {"ts":"2026-10-11T12:42:22.077+08:00","level":"info","event":"file.change.received","status":"success","actionId":"68824ea7-4ac0-435d-8431-1ae10603617d","context":{"changeType":"modified","eventTimestamp":1791693741769,"outcome":"delivered","path":"/Users/jack/.mdpro-redesign/dtrack/scratch/819fa2c-watcher/w.md","windowLabel":"main"},"durationMs":null,"error":null}
13939: {"ts":"2026-10-11T12:42:22.085+08:00","level":"info","event":"file.change.decision","status":"success","actionId":"c2ea0ad8-7c66-47e7-b1cd-44819fc19357","context":{"action":"reload-prompt","changeType":"modified","documentId":"2133a3143cd5f892","eventTimestamp":1791693741769,"isModified":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/819fa2c-watcher/w.md","pathMatchesActive":true,"windowLabel":"main"},"durationMs":null,"error":null}
13943: {"ts":"2026-10-11T12:42:39.627+08:00","level":"info","event":"file.watch.event","status":"success","actionId":null,"context":{"changeType":"modified","detail":"any","info":null,"kind":"modify_name","mtimeMs":1791693759573,"outcome":"emitted_modified","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/819fa2c-watcher/w.md","pathCount":1,"rescan":false,"size":1,"timestamp":1791693759626,"unchangedCheck":"stat_differs"},"durationMs":null,"error":null}
13945: {"ts":"2026-10-11T12:42:39.629+08:00","level":"info","event":"file.change.received","status":"start","actionId":"3c722d4c-6867-40ef-814a-63cf738d506c","context":{"changeType":"modified","eventTimestamp":1791693759626,"outcome":"scheduled","path":"/Users/jack/.mdpro-redesign/dtrack/scratch/819fa2c-watcher/w.md","windowLabel":"main"},"durationMs":null,"error":null}
13946: {"ts":"2026-10-11T12:42:39.932+08:00","level":"info","event":"file.change.received","status":"success","actionId":"3c722d4c-6867-40ef-814a-63cf738d506c","context":{"changeType":"modified","eventTimestamp":1791693759626,"outcome":"delivered","path":"/Users/jack/.mdpro-redesign/dtrack/scratch/819fa2c-watcher/w.md","windowLabel":"main"},"durationMs":null,"error":null}
13947: {"ts":"2026-10-11T12:42:39.939+08:00","level":"info","event":"file.change.decision","status":"success","actionId":"597b8b3e-5320-400a-91bf-95b386dd6262","context":{"action":"reload-prompt","changeType":"modified","documentId":"2133a3143cd5f892","eventTimestamp":1791693759626,"isModified":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/819fa2c-watcher/w.md","pathMatchesActive":true,"windowLabel":"main"},"durationMs":null,"error":null}
13967: {"ts":"2026-10-11T12:43:26.456+08:00","level":"info","event":"file.save","status":"success","actionId":"fad60c37-139e-4eea-af7a-03e4363e4c5b","context":{"filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/819fa2c-watcher/w5.md","fileSizeBytes":43},"durationMs":11,"error":null}
13974: {"ts":"2026-10-11T12:43:26.938+08:00","level":"info","event":"file.watch.event","status":"success","actionId":null,"context":{"changeType":"modified","detail":"any","info":null,"kind":"modify_name","mtimeMs":1791693806927,"outcome":"emitted_modified","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/819fa2c-watcher/w5.md","pathCount":1,"rescan":false,"size":44,"timestamp":1791693806937,"unchangedCheck":"stat_differs"},"durationMs":null,"error":null}
13977: {"ts":"2026-10-11T12:43:26.940+08:00","level":"info","event":"file.change.received","status":"start","actionId":"a1d9c21d-fc56-4992-bcfa-aa3ca661dcd9","context":{"changeType":"modified","eventTimestamp":1791693806937,"outcome":"scheduled","path":"/Users/jack/.mdpro-redesign/dtrack/scratch/819fa2c-watcher/w5.md","windowLabel":"main"},"durationMs":null,"error":null}
13978: {"ts":"2026-10-11T12:43:27.241+08:00","level":"info","event":"file.change.received","status":"success","actionId":"a1d9c21d-fc56-4992-bcfa-aa3ca661dcd9","context":{"changeType":"modified","eventTimestamp":1791693806937,"outcome":"delivered","path":"/Users/jack/.mdpro-redesign/dtrack/scratch/819fa2c-watcher/w5.md","windowLabel":"main"},"durationMs":null,"error":null}
13979: {"ts":"2026-10-11T12:43:27.245+08:00","level":"info","event":"file.change.decision","status":"success","actionId":"685c05ac-8ff6-471f-b1e4-ffbc649a2d26","context":{"action":"reload-prompt","changeType":"modified","documentId":"d9426c79227fe49","eventTimestamp":1791693806937,"isModified":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/819fa2c-watcher/w5.md","pathMatchesActive":true,"windowLabel":"main"},"durationMs":null,"error":null}
14487: {"ts":"2026-10-11T12:47:21.258+08:00","level":"info","event":"file.watch.register","status":"success","actionId":null,"context":{"alreadyWatched":false,"baseline":"seeded","mtimeMs":1791693654885,"ok":true,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/819fa2c-watcher/big.md","size":10477556,"watchedCount":6},"durationMs":null,"error":null}
14504: {"ts":"2026-10-11T12:47:52.879+08:00","level":"info","event":"file.save","status":"success","actionId":"2ba59231-6712-4456-9519-f6eaaad55d16","context":{"filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/819fa2c-watcher/big.md","fileSizeBytes":10496356},"durationMs":21,"error":null}
14508: {"ts":"2026-10-11T12:47:52.897+08:00","level":"info","event":"file.watch.event","status":"cancel","actionId":null,"context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1791694072862,"outcome":"ignored_unchanged","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/819fa2c-watcher/big.md","pathCount":1,"rescan":false,"size":10496356,"timestamp":1791694072892,"unchangedCheck":"unchanged"},"durationMs":null,"error":null}
14510: {"ts":"2026-10-11T12:47:52.905+08:00","level":"info","event":"file.watch.event","status":"cancel","actionId":null,"context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1791694072862,"outcome":"ignored_unchanged","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/819fa2c-watcher/big.md","pathCount":1,"rescan":false,"size":10496356,"timestamp":1791694072900,"unchangedCheck":"unchanged"},"durationMs":null,"error":null}
14511: {"ts":"2026-10-11T12:47:53.224+08:00","level":"warn","event":"mcp.sync","status":"fail","actionId":null,"context":{"error":"document 606a8205b969026 content exceeds 10485760 byte limit (10496356 bytes)"},"durationMs":null,"error":null}
14527: {"ts":"2026-10-11T12:48:48.297+08:00","level":"info","event":"file.save","status":"success","actionId":"d9b8418d-1e8c-4feb-a5e5-a905e4cb0eb5","context":{"filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/819fa2c-watcher/w8-new.md","fileSizeBytes":7},"durationMs":8,"error":null}
14528: {"ts":"2026-10-11T12:48:48.298+08:00","level":"info","event":"file.watch.register","status":"success","actionId":null,"context":{"alreadyWatched":false,"baseline":"seeded","mtimeMs":1791694128289,"ok":true,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/819fa2c-watcher/w8-new.md","size":7,"watchedCount":6},"durationMs":null,"error":null}
14534: {"ts":"2026-10-11T12:48:58.014+08:00","level":"info","event":"file.watch.event","status":"success","actionId":null,"context":{"changeType":"modified","detail":"extended","info":null,"kind":"modify_metadata","mtimeMs":1791694138003,"outcome":"emitted_modified","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/819fa2c-watcher/w8-new.md","pathCount":1,"rescan":false,"size":8,"timestamp":1791694138014,"unchangedCheck":"stat_differs"},"durationMs":null,"error":null}
14538: {"ts":"2026-10-11T12:48:58.326+08:00","level":"info","event":"file.change.decision","status":"success","actionId":"b8bb5fcb-1add-4801-93db-5ba30bcf260d","context":{"action":"reload-prompt","changeType":"modified","documentId":"09cf98a4-49f8-4206-a94a-5075e0b6aaaa","eventTimestamp":1791694138014,"isModified":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/819fa2c-watcher/w8-new.md","pathMatchesActive":true,"windowLabel":"main"},"durationMs":null,"error":null}
14539: {"ts":"2026-10-11T12:49:05.805+08:00","level":"info","event":"ui.dialog.confirm","status":"success","actionId":"70c95235-ae14-4628-83b9-8575e74dc4b3","context":{"controlId":"dialog.reload.reload"},"durationMs":null,"error":null}
14541: {"ts":"2026-10-11T12:49:05.812+08:00","level":"info","event":"editor.milkdown.reload","status":"success","actionId":"e6eadb16-aa7f-43f6-9e66-32be25c6b5b8","context":{"documentId":"587380890efc5600","droppedPendingEdit":false,"generation":1,"reason":"file-reload"},"durationMs":null,"error":null}
14542: {"ts":"2026-10-11T12:49:05.812+08:00","level":"info","event":"tab.open","status":"success","actionId":"82bf4708-bb82-4089-86eb-77fbb03539f2","context":{"documentId":"587380890efc5600","filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/819fa2c-watcher/w8-new.md","tabIndex":6},"durationMs":null,"error":null}
14546: {"ts":"2026-10-11T12:49:38.502+08:00","level":"info","event":"file.save","status":"success","actionId":"19d5bb74-1069-42f7-b932-ab14a22f72e9","context":{"filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/819fa2c-watcher/w8-new.md","fileSizeBytes":8},"durationMs":11,"error":null}
14549: {"ts":"2026-10-11T12:49:38.513+08:00","level":"info","event":"file.watch.event","status":"cancel","actionId":null,"context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1791694178490,"outcome":"ignored_unchanged","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/819fa2c-watcher/w8-new.md","pathCount":1,"rescan":false,"size":8,"timestamp":1791694178513,"unchangedCheck":"unchanged"},"durationMs":null,"error":null}
14550: {"ts":"2026-10-11T12:49:38.514+08:00","level":"info","event":"file.watch.event","status":"cancel","actionId":null,"context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1791694178490,"outcome":"ignored_unchanged","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/819fa2c-watcher/w8-new.md","pathCount":1,"rescan":false,"size":8,"timestamp":1791694178514,"unchangedCheck":"unchanged"},"durationMs":null,"error":null}
14568: {"ts":"2026-10-11T12:50:27.607+08:00","level":"info","event":"file.watch.unregister","status":"success","actionId":null,"context":{"alreadyWatched":true,"mtimeMs":1791693654871,"ok":true,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/819fa2c-watcher/w9.md","size":42,"watchedCount":6},"durationMs":null,"error":null}
14574: {"ts":"2026-10-11T12:50:54.887+08:00","level":"info","event":"view.mode.change","status":"success","actionId":"ac75751a-7b79-4610-b0c6-953f479cf8ed","context":{"fromMode":"source","intent":"user","source":"setViewMode","toMode":"wysiwyg"},"durationMs":null,"error":null}
```
