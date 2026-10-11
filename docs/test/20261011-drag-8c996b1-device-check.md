# Report: in-editor drag and drop on `8c996b1` (D113, D103 C3/C4, D90, D94, D102, D92), 2026-10-11

Brief: `~/.mdpro-redesign/dtrack/brief-20261011-drag-8c996b1.md`. One dtrack run, 10:22–10:32 GMT+8. No repo edits, commits or pushes.

**Headline.** **D113 does not close.** `drag.sh` posted every gesture (exit 0, `drag: scale 1 …` line each time). A control drag on the empty desktop proved the events move the system cursor. Inside mdpro's WYSIWYG editor, though, no gesture ever reached a drop:
- no store change;
- no `editor.table.*` line;
- no log line of any kind other than my own `mcp.read`s and an autosave `draft.write`.

Some gestures left the selection untouched. Others re-selected text, the same failure shape as on `8994bc8`. So every drop item below is **NOT EXERCISED (drag)**, never FAIL, as the brief says. Nothing was damaged.

## 1. Build

| Check | Result |
|---|---|
| `stat -f %m tauri-app` | `1791622276` |
| `shasum -a 256 tauri-app` | `88f0b567bdcd6913eafbc736b696975f4789fc84b393ade0860bbd84c98a5d40` |
| `git -C $WT rev-parse --short HEAD` | `8c996b1` |
| ancestors | `3144d8f 0`, `0b314b9 0`, `8330192 0`, `8994bc8 0` |
| `cat-file -e` | `emptyHeaderRowRepair.ts 0`, `pasteTableNormalize.ts 0`, `flushRefusal.ts 0` |
| input source | `"KeyboardLayout Name" = ABC` |
| `drag-bin` sha256 | `cae138accfa550d58b8db368e777f85cf2a92899097872657ed52dddbcbb8281` = `$DRAGBIN_SHA` ✓ |
| drag smoke `$DRAG 10 10 12 12` | `drag: drag distance below 5 points` + usage, **exit 64** ✓ |
| pre-flight `pgrep -fl 'mdpro\|tauri-app'` | `24817 tmux new -s dtrack -c /Users/jack/.mdpro-redesign/dtrack` and `66024 claude --resume mdpro-remote`. Both match only because their command lines contain "mdpro". Neither is an mdpro app process; no `tauri-app` was running. |
| PID / `ps` path | `28023 Sun Oct 11 10:22:26 2026  /Users/jack/.mdpro-redesign/dtrack/builds/8c996b1/mdpro.app/Contents/MacOS/tauri-app` |
| cold launch | L13502 `{"level":"info","event":"file.open.external","status":"start",…,"context":{"appReady":false,"filePaths":["/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d90-table-drop.md"],"source":"finder"}…}` |
| `app.ready` | L13510 `appVersion":"0.3.0"`, `pid":28023` |
| Recover drafts | none shown |
| About | shot `about.png`: **Version v0.3.0** ("Checking for updates…", no button clicked) |
| `W0` | `about.png` = 1200×800 px. Window bounds `100, 100, 1200, 800` (System Events) at start and at close. |
| MCP | `{"version":"0.3.0","window_focused":true}`, token `${#TOKEN}` = 64 |
| `request_access` | granted `mdpro` (`com.mdpro.app`), denied none, screenshotFiltering `native` |

## 2. Settings

As-found (`jq -c '{themeMode, defaultViewMode, lastViewMode, autoSaveInterval, logging, autoReformatTablesOnSave:.markdown.autoReformatTablesOnSave, mcp:{serverEnabled:.mcp.serverEnabled}}' ~/.mdpro/config.json`; projection from the `eb061fa`-lineage brief `brief-20261010-d86-reprobe-8c996b1.md`):

```
{"themeMode":"system","defaultViewMode":"wysiwyg","lastViewMode":"wysiwyg","autoSaveInterval":30,"logging":{"enabled":true,"level":"info"},"autoReformatTablesOnSave":false,"mcp":{"serverEnabled":true}}
```

- Changed: nothing. MCP was already on, and the view stayed WYSIWYG the whole run.
- Restored re-read: byte-identical (`cmp asfound.json restored.json` → 0).

## 3. Verdict table

| Item | Verdict | Proof line (L-number) | Notes |
|---|---|---|---|
| D113-A | **NOT EXERCISED (drag)** | none; store unchanged (`cmp` 0) | 2 attempts (default, `--hold-ms 400`). Selection left intact both times. |
| D113-B | **NOT EXERCISED (drag)** | none | 2 attempts with `--copy`. No `header_repair` line, store unchanged. |
| D103-C3 | **NOT EXERCISED (drag)** | none | 2 attempts (plus one exit-64 typo that posted nothing) |
| D90-1 | **NOT EXERCISED (drag)** | none; hash = `$H` | gesture re-selected text `Src before.` → `a` of `a2` |
| D90-2 | **NOT EXERCISED (drag)** | none; hash = `$H` | selection left intact |
| D94-1 | **NOT EXERCISED (drag)** | none; hash = `$H` | selection left intact |
| D94-2 | **NOT EXERCISED (drag)** | none; hash = `$H` | selection left intact |
| D94-3 | **NOT EXERCISED (drag)** | none; hash = `$H` | selection left intact |
| D102-left | **NOT EXERCISED (drag)** (neither "known over-refusal" nor "inserted") | none; hash = `$H`, `ntab` 2 | gesture re-selected only `Src before.` |
| D102-bottom | **NOT EXERCISED (drag)** (neither "known over-refusal" nor "inserted") | none; hash = `$H`, `ntab` 2 | gesture re-selected `Src before.` → `b3` |
| D92 | **NOT EXERCISED (no failing flush at 8c996b1)** | — | 10 `editor.milkdown.flush` lines in L13501–L13738, none `fail` |

`$H` = `8d646a69804da33a5096a3f8e5554073e999872af95cc21cb5f64c5a78d8adb0`. That is the d90 store after prep (`End.!`), equal to `d90-pre.md`.

## 4. Items

**Common.**
- Every focus gate before a key, type, drag or save returned `{"event":"window.focus","context":{"windowId":"main","windowLabel":"main"}}`. The one exception is noted under D113-B.
- Every `$DRAG` line printed `drag: scale 1 points …`.
- No toast appeared in any chained `shot.sh` (taken within ≈0.1 s of the drag).
- **The selection start point was the same for every d90 drop:** hover on the highlighted `Src` of `Src before.` → `pt` = `472 202`.

### Prep (pre-flight 10)

- d90: `D90=f2ea7f776825e5bf`. `!` typed after `End.` → store tail `End.!`.
- OPEN(d103): mark 13561. ⌘O → ⌘⇧G → typed path → double-clicked the suggestion row → **Open**.
  - L13568 `{"event":"file.watch.register","status":"success",…,"ok":true,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d103-empty-header.md","size":288,"watchedCount":2}`
  - L13569 `file.open` success, source dialog.
- `D103=b58def682c12fc34`. `!` typed after `End.`.
- `diff` of disk vs store, for both files: only `End.` → `End.!`. The separators stay `| -- |`.

### D113-A (item 1, d90)

- Selection: `Src before.` through `Src after.`, confirmed by screenshot.
- `d90-pre.md` sha256 `8d646a69…adb0`.
- Points: start `472 202`, target (right of `Gap line.`) `529 613`.
- **Attempt 1.** mark 13606.
  - `$DRAG 472 202 529 613` → `drag: scale 1 points (472,202)->(529,613) steps 20 copy false`, `exit 0`.
  - `since '.'` L13607–L13612 holds only `mcp.read` ×4 (my body reads) and `draft.write` start/success (autosave, 189 bytes, unchanged size).
  - `grep`: `3:Src before.`, `5:| s1 | s2 |`, `9:Src after.`, `18:Gap line.` (order unchanged). `ntab` 2.
- **Retry.** Re-selected, both points re-read (same values), mark 13614.
  - `$DRAG 472 202 529 613 --hold-ms 400` → `drag: scale 1 points (472,202)->(529,613) steps 20 copy false`, `exit 0`.
  - `since '.'` L13615–L13618: `mcp.read` only. Same `grep` output, `ntab` 2.
- `cmp $S/d90-pre.md <(body $D90)` → 0.
- ⌘Z **not pressed** (see § 6: nothing to undo; a ⌘Z would have removed the prep `!`).
- Shot `d113-a`.
- **Control (operator diagnostic, not in the brief):** `$DRAG 1650 250 1750 350` on empty desktop wallpaper.
  - Output: `drag: scale 1 points (1650,250)->(1750,350) steps 20 copy false`, `exit 0`. `pt` before `529 613`, after `1750 350`.
  - So the events are posted and move the system cursor.

### D113-B / D103 C4 (item 2, d103 section D)

- Before the tab click, the batch failed: Finder was frontmost after the desktop control drag. `open_application("mdpro")` → gate `window.focus main` ✓.
- Selection: caret between `d` and `1` → shift+click after `Post D`, confirmed by screenshot.
- `c4-pre.md` sha256 `9ec2685d…f5e4` (= the prep store).
- Points: start (`Post D`) `483 700`, target (right of `Tail D.`) `506 737`.
- **Attempt 1.** mark 13638.
  - `$DRAG 483 700 506 737 --copy` → `drag: scale 1 points (483,700)->(506,737) steps 20 copy true`, `exit 0`.
  - The filtered `since` is empty; the unfiltered `since '.'` is empty (L13639 not yet written; `wc -l` 13638).
  - `cmp c4-pre <(body)` → 0.
- **Retry.** Re-selected, points re-read (same), mark 13642.
  - `$DRAG 483 700 506 737 --copy --hold-ms 400` → `… steps 20 copy true`, `exit 0`.
  - Filtered and unfiltered `since` both empty (`wc -l` 13642). `cmp` → 0.
- `c4-post.md` = `c4-pre.md` (`cmp` 0).
- Routine steps 4–6 (⌘S, ⌘Z, ⌘⇧Z) **not run**: nothing changed (see § 6).
- Shot `c4`.
- No `"move":true` line appeared either, so "NOT EXERCISED (copy modifier)" does not apply. The drop path was never reached.

### D103 C3 (item 3, d103 section C)

- Selection: caret after `P` of `Pre C` (← ×4) → shift+click after `c1`, confirmed by screenshot and zoom.
- `c3-pre.md` sha256 `9ec2685d…f5e4`.
- Points: start (`re C`) `484 268`, target (right of `Tail C.`) `508 460`.
- **Attempt 1.** mark 13650.
  - `$DRAG 484 268 508 460` → `drag: scale 1 points (484,268)->(508,460) steps 20 copy false`, `exit 0`.
  - `since` filtered and unfiltered both empty (`wc -l` 13650). `cmp` → 0.
- **Retry.** Re-selected, points re-read (same), mark 13654.
  - First command: `$DRAG 484 268 $P2 --hold-ms 400` → `drag: expected 4 coordinates, got 3`, **exit 64**. zsh did not word-split `$P2`; nothing was posted.
  - Re-run at mark 13656: `$DRAG 484 268 508 460 --hold-ms 400` → `drag: scale 1 points (484,268)->(508,460) steps 20 copy false`, `exit 0`.
  - `since` filtered and unfiltered empty (`wc -l` 13656). `cmp` → 0.
  - L13651–L13656 lie between the marks: `mcp.read` ×4 and `draft.write` start/success only.
- `sec c3-post.md C` is unchanged from the fixture: `Pre C` / `| C1 | C2 |` / `| -- | -- |` / `| c1 | c2 |` / `Post C` / `Tail C.`.
- Shot `c3`.

### D90 (item 4, d90)

- `H=8d646a69804da33a5096a3f8e5554073e999872af95cc21cb5f64c5a78d8adb0`.
- Every drop was re-selected first (click after `Src before.`, ⌘←, shift+click after `Src after.`), and every selection was zoom-checked.
- **D90-1** (onto text `a2`): target `574 501`, mark 13676.
  - `$DRAG 472 202 574 501; $DEV/shot.sh d90-1` → `drag: scale 1 points (472,202)->(574,501) steps 20 copy false`, `exit 0`, `d90-1 1200 800`.
  - Hash after 1 s = `$H`.
  - Filter `editor\.table\.(drop|paste)|editor\.milkdown\.flush|file\.save`: empty.
  - `since '.'` L13677–L13678: `mcp.read` only.
  - No toast. Shot `d90-1` shows the gesture **re-selected text** from the start of `Src before.` to the `a` of `a2`.
- **D90-2** (onto text `h2`): target `576 451`, mark 13680.
  - `drag: scale 1 points (472,202)->(576,451) steps 20 copy false`, `exit 0`, shot `d90-2`.
  - Hash = `$H`. Filter empty. `since '.'` L13681–L13682: `mcp.read` only.
  - No toast. Selection left intact. `h2`/`h3` did not move.

### D94 (item 5, d90)

**Rule positions.** I zoomed on the host table. `pt` readings were checked against the scale-1 window shot (window origin 100,100):
- a1|a2 vertical rule at x = 555;
- header|a rule at y = 482;
- a|b rule at y = 533.

| Case | Target `pt` | mark | `drag:` line, exit | hash | since '.' | shot |
|---|---|---|---|---|---|---|
| D94-1 vertical rule a1\|a2, row a mid | `555 508` | 13682 | `(472,202)->(555,508) steps 20 copy false`, 0 | `$H` | L13683–L13684 `mcp.read` only | `d94-1` (selection intact) |
| D94-2 rule a\|b, column 2 mid | `607 533` | 13686 | `(472,202)->(607,533) steps 20 copy false`, 0 | `$H` | L13687–L13688 `mcp.read` only | `d94-2` (selection intact) |
| D94-3 rule header\|a, column 3 mid | hover `pt` `708 483`; drag aimed at `708 482` | 13690 | `(472,202)->(708,482) steps 20 copy false`, 0 | `$H` | L13691–L13692 `mcp.read` only | `d94-3` (selection intact) |

D94-3: hovering could not land exactly on the 1 px rule (`pt` read 481 then 483). The y was taken from the scale-1 `screencapture` (pixels = points; see § 5). No filtered lines and no toast in any case.

### D102 (item 6, d90, record only)

| Case | Target `pt` | mark | `drag:` line, exit | hash | `ntab` | since '.' | shot |
|---|---|---|---|---|---|---|---|
| D102-left (left border, row b) | `460 558` | 13692 | `(472,202)->(460,558) steps 20 copy false`, 0 | `$H` | 2 | L13693–L13696 `mcp.read` only | `d102-left`: re-selected `Src before.` only |
| D102-bottom (bottom border under b3) | `708 584` | 13698 | `(472,202)->(708,584) steps 20 copy false`, 0 | `$H` | 2 | L13699–L13702 `mcp.read` only | `d102-bottom`: re-selected `Src before.` → `b3` |

The drop was neither refused nor inserted, so no D102 observation was possible. The host table is intact.

**6.3 save:** gate ✓, mark 13702, ⌘S.
- L13704 `editor.milkdown.flush` success `outcome:"clean","reason":"save"`
- L13706 `{"event":"file.save","status":"start",…"filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d90-table-drop.md"}`
- L13707 `{"event":"file.save","status":"success",…"fileSizeBytes":189},"durationMs":10}`
- L13708 flush success `save-settle`

`ntab $S/d90-table-drop.md` = 2. The disk file differs from the fixture only by `End.!`.

### D92 (item 7)

There are 10 `editor.milkdown.flush` lines in L13501–L13738, all `success`. No step produced a failing flush, so ⌃2 and the tab-switch probe were not run. **NOT EXERCISED (no failing flush at 8c996b1)**, the expected outcome.

### Restore and Close

1. W0 was unchanged (`100, 100, 1200, 800`).
2. The view mode stayed WYSIWYG (no `view.mode.change` this run).
3. The MCP server was not touched.
4. mdpro › Quit mdpro (mark 13714):
   - L13715 `app.quit.request` → L13717 `app.quit.check` `answer:"dirty","dirtyCount":1` → "Unsaved changes / Quit without saving?" appeared.
   - Clicked **Discard changes** (count 1: `d103-empty-header.md`, scratch copy with the prep `!`).
   - L13727 `app.quit.answer` `answer:"discard","idCount":1` … L13737 `app.quit` success, L13738 `mcp.http_server.stop`.
5. `pgrep -fl tauri-app` returned nothing.
6. Settings re-read was identical (§ 2).
7. `shasum -a 256 -c start.sha`: `fx/d103-empty-header.md: OK`, `fx/d90-table-drop.md: OK`. The fixture originals under `$FXD` were never opened.

**Final scratch files:**
- `d90-table-drop.md` = `$H` (fixture + `!`);
- `d103-empty-header.md` = `01f91259…cdc206c` (= fixture; the `!` was discarded).

**Files in `$S`:**
- `asfound.json`, `restored.json`;
- `d90-prep.md`, `d103-prep.md`, `d90-pre.md`;
- `c4-pre.md`, `c4-post.md`, `c3-pre.md`, `c3-post.md` (each pre = post);
- `start.sha`.

**Shots in `$R/shots`:** `about`, `d113-a`, `c4`, `c3`, `d90-1`, `d90-2`, `d94-1`, `d94-2`, `d94-3`, `d102-left`, `d102-bottom`, plus `host-rules` (an extra scale-1 shot for the rule positions).

## 5. Operator slips

1. **Fixture age.** The scratch copies were made at epoch 1791685335. The cold launch came 11 s later, not ≥ 35 s. Effect: none seen. `file.watch.register` seeded the baselines normally (L13532, L13568), and no reload prompt appeared.
2. **Desktop control drag (not in the brief).** After D113-A, I ran one `$DRAG 1650 250 1750 350` on empty wallpaper to tell "events not posted" from "events posted but ignored".
   - Side effect: Finder became frontmost, so the next computer-use click was refused.
   - Recovered with `open_application("mdpro")` and a gate ✓.
   - No document was touched.
3. **C3 retry exit 64.** The coordinates were passed as one zsh variable, giving `expected 4 coordinates, got 3`. Nothing was posted. Re-run with literal numbers, as the brief allows.
4. **Undo counts differ from the brief.**
   - D113-A step 6 used zero ⌘Z, not one.
   - The D103 routine steps 4–6 (⌘S, ⌘Z, ⌘⇧Z) were skipped for C4 and C3.
   - Reason: no drop changed the store, so a ⌘Z would have undone the prep `!` instead and broken the like-for-like `cmp`.
   - Result: d103 was never saved; it was discarded at quit. d90 was saved only at 6.3.
5. **D94-3 target.** y = 482 came from the scale-1 `screencapture` of the window (pixels = points, origin 100,100). The hovered `pt` read 481, then 483.
6. **D102 retries not taken.** For items 4–6, only one attempt per drop (no `--hold-ms 400` retry). After items 1–3, where each retry behaved identically, a retry was not expected to change the outcome.
7. **Projection source.** The `eb061fa` brief itself is not in `dtrack/`. I used the same projection as in `brief-20261010-d86-reprobe-8c996b1.md` § 0.7, which cites `eb061fa`.
8. **`start.sha`.** It was written fresh by pre-flight step 5, replacing any earlier file of that name in `$S`.

## 6. Deviations and notes

- **Main finding: the D113 driver reaches the OS but no WebKit drop occurs in mdpro on `8c996b1`.** Evidence:
  - the desktop control drag moved the cursor;
  - inside the editor, the gestures either left the selection intact (D113-A, B, C3, D90-2, D94-1..3) or turned into a text re-selection (D90-1, D102-left, D102-bottom);
  - no `editor.table.*` line, no store change, no toast.
  - The "selection intact" shape suggests the mouse-down landed inside the selection and WebKit began a drag that never delivered a drop. That is inferred from the shots only; no `dragstart` instrumentation exists to confirm it.
- **Untested hypothesis for the delegator / adr047-verify:** `src-tauri/tauri.conf.json:21` sets `"dragDropEnabled": true` on the main window.
  - `src/App.tsx:733` listens with `onDragDropEvent` for file drops.
  - With Tauri's native drag-drop handler enabled, the native view may be taking the in-page drag session before WebKit can deliver HTML5 `drop` to ProseMirror.
  - Not verified. The config was read only; nothing was changed.
- **Incidental log lines (not drag-related):**
  - L13556 `ui.about.update_check` `error`/`fail`: "Could not fetch a valid release JSON from the remote". This was the About pane's automatic check; no button was clicked.
  - `ui.toc.resolve.mismatch` `warn`/`fail` on each tab switch (L13581, L13602, L13634, L13668).
- Autocorrect bubbles: none. Path corrections (N1): none. Every brief path existed: `$DEV`, `$DRAG`, `$FXD`, the guide § 5 preamble, and the three `src/` files.
- No toast was seen in any shot. No `editor.milkdown.flush` `fail` and no `file.save` `fail` in the run.
- ⌥ hygiene: every `drag.sh` run exited 0 after its `drag:` line, so the release click / `kc.sh 58` recovery was never needed.
