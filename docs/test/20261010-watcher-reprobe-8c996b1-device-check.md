<!-- Delegator ruling, 2026-10-10 (mdpro-delegator) -->
> **Delegator ruling (2026-10-10): D86-x20 = PASS. The D86 WI-4 precondition is met.**
> Saves 10 and 17 were the brief's OWN-MARK case: both of their events arrived while `save_file` still held
> the write-in-progress mark (`file_watcher_gate.rs` `is_self_write`, routed at `file_watcher_route.rs:107`).
> This is the designed path for events that land before `refresh_after_save` updates the baseline. It is pinned by
> `file_watcher_route_own_save_tests.rs` `os2_event_inside_the_save_mark_is_self_write_then_unchanged_after`.
> WI-4 removes only the frontend 3 s window (`useFileWatcher.ts` `SAVE_SUPPRESS_WINDOW_MS`), not this Rust mark.
> In this run `recv` was null, so not one own-save event reached that window.
> The baseline check ran on the other 18/20 saves (`ignored_unchanged/unchanged`). 0 `ignored_rename_single_path`, 0 `emitted_*`, 0 prompts.
> D112-ext and D112-big: PASS as reported.

# Device check: watcher batch on `8c996b1` (D86 ⌘S×20 re-probe, D112 large file, D112 external change)

Date 2026-10-10, 16:56–17:03 (GMT+8). Executor: real-device-tester (Claude Code, computer use plus shell). Brief: `brief-20261010-d86-reprobe-8c996b1.md`. Skill: `.claude/skills/gui-acceptance/SKILL.md` (from `$WT`).
No repo edits, commits or pushes. No MCP calls. The MCP token was never read or printed.

## Verdict table

| Row | Verdict | Evidence |
|---|---|---|
| **D86-x20** (WI-4 gate) | **OWN-MARK (2 of 20)**. Not FAIL, not NOT EXERCISED; strict PASS not met. | `saves` 20. **Proof saves 18/20**: every save except 10 and 17 has an `ignored_unchanged/unchanged` line for its own write. **NOT EXERCISED 0** (no `ignored_rename_single_path` line anywhere; every save has at least one watch line). **OWN-MARK 2**: saves 10 and 17 logged only `self_write/not_checked`. **emitted 0**. **prompts 0**. No dialog, no toast. Delegator to rule on the 2 OWN-MARK saves. |
| **D112-ext** | **PASS** (`unchangedCheck:"stat_differs"`) | L13435 `emitted_modified` / `changeType:"modified"` / `stat_differs`. L13437 `scheduled`, L13438 `delivered`, L13439 `reload-prompt` (all with `eventTimestamp` 1791622866420). External change detected dialog shown (`d112-ext.png`). Ignore clicked (L13440). |
| **D112-big** | **PASS** | `file.save` success `fileSizeBytes` **10496356** (≥ 10489856; equals `stat -f %z`). Two proof lines, `ignored_unchanged/unchanged`, `size` 10496356 (L13464, L13466). No `emitted_*` line. No dialog in 15 s. Timings: `durationMs` **19**; `file.save` start→success **19 ms** (16.136→16.155); success→first `file.watch.event` **21 ms** (16.155→16.176). |

## 1. Build

- `stat -f %m …/tauri-app` = `1791622276` ✓; `shasum -a 256` = `88f0b567bdcd6913eafbc736b696975f4789fc84b393ade0860bbd84c98a5d40` ✓ (both equal the delegator's values).
- `git -C $WT rev-parse --short HEAD` = `8c996b1`.
- Ancestors: `658bc1d 0`, `c4da5b9 0`, `d91fb38 0`.
- `cat-file -e`: `file_watcher_baseline_check.rs 0`, `file_watcher_route.rs 0`, `file_watcher_baseline_save.rs 0`, `src/hooks/useFileWatcher.ts 0`, `src/components/common/ReloadDialog.tsx 0`.
- Input source: `"KeyboardLayout Name" = ABC`.
- `request_access(["mdpro"])` → granted `com.mdpro.app` (displayName mdpro), denied none, screenshotFiltering `native`.
- Pre-flight `pgrep -fl 'mdpro|tauri-app'`: no mdpro app process. The pattern matched two non-app processes whose command lines contain "mdpro": `24817 tmux new -s dtrack -c /Users/jack/.mdpro-redesign/dtrack` and `66024 claude --resume mdpro-remote`. Neither was touched. `pgrep -fl tauri-app` was empty (rc 1). See Deviations.
- Cold launch: PID **85302**, `Sat Oct 10 16:56:52 2026  /Users/jack/.mdpro-redesign/dtrack/builds/8c996b1/mdpro.app/Contents/MacOS/tauri-app`.
- Launch lines (mark 13163). The `appReady:false` line is L13165. `file.watch.register` is `ok:true`, `baseline:"seeded"`, and the logged path equals `$S/d86.md` exactly, so `P=$S/d86.md` was used.
```
13165: {"ts":"2026-10-10T16:56:55.554+08:00","level":"info","event":"file.open.external","status":"start","actionId":null,"context":{"appReady":false,"filePaths":["/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md"],"source":"finder"},"durationMs":null,"error":null}
13166: {"ts":"2026-10-10T16:56:55.554+08:00","level":"info","event":"file.open.external.pending","status":"success","actionId":null,"context":{"pendingPaths":["/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md"],"reason":"app_not_ready"},"durationMs":null,"error":null}
13167: {"ts":"2026-10-10T16:56:55.554+08:00","level":"info","event":"file.open.external","status":"success","actionId":null,"context":{"filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","source":"finder"},"durationMs":null,"error":null}
13195: {"ts":"2026-10-10T16:56:56.077+08:00","level":"info","event":"file.watch.register","status":"success","actionId":null,"context":{"alreadyWatched":false,"baseline":"seeded","mtimeMs":1791622579489,"ok":true,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","size":89,"watchedCount":1},"durationMs":null,"error":null}
```
- No Recover drafts dialog.
- About (`shots/about.png`) reads **mdpro, Version v0.3.0**, "Checking for updates…". No update button was clicked. Settings was closed with its **Close** button.
- `shot.sh` check: `about.png` is 1200×800, which is the window and not a panel. **W0** = position (100,100), size 1200×800 (System Events).

## 2. Settings

As found (16:56):
```
{"themeMode":"system","defaultViewMode":"wysiwyg","lastViewMode":"wysiwyg","autoSaveInterval":30,"logging":{"enabled":true,"level":"info"},"autoReformatTablesOnSave":false,"mcp":{"serverEnabled":true}}
```
Re-read after quit (17:02), identical:
```
{"themeMode":"system","defaultViewMode":"wysiwyg","lastViewMode":"wysiwyg","autoSaveInterval":30,"logging":{"enabled":true,"level":"info"},"autoReformatTablesOnSave":false,"mcp":{"serverEnabled":true}}
```

## 3. Scratch files

`$S=~/.mdpro-redesign/dtrack/scratch/8c996b1`, created at 16:56:19. `fixture.orig` is a copy of `tests/manual-fixtures/d37-small-doc.md` (89 bytes). `big.md` was 10477556 bytes, inside (10469376, 10477568]. `start.sha`: `f5517bcdddee83f4d4adea6ebcda50fdf18f9e7ad959cc3ffd5a19ef2be09d38  fixture.orig`.

## 4. Item 1: D86 ⌘S×20 (`d86.md`, Source)

- ⌃2 gate passed (`window.focus` main). L13223 `view.mode.change` `wysiwyg`→`source`. Clicked after `Third paragraph.`, waited 5 s, **mark NA = 13230**.
- 20 iterations. Each one: gate, `type "."`, wait ≥0.5 s, gate, `key.sh s command`, wait 4 s, gate. **All 20 pre-type gates and all 20 pre-⌘S gates passed** (`window.focus`, `windowId` main). Saves were sent at 16:57:49, :58, 16:58:07, :15, :23, :31, :40, :48, :56, 16:59:04, :12, :20, :28, :36, :44, :53, 17:00:01, :09, :17, :26. Spacing was ≈8–9 s because of tool round-trips; every gap is longer than 4 s.
- **Slice: lines 13231–13434.** Event mix in the slice: 40 `file.save` (20 start, 20 success), 40 `file.watch.event`, 20 `ui.shortcut.trigger`, 40 `preferences.set`, 40 `menu.recent_files.sync`, 20 `preferences.read`, 4 `draft.write`. No `file.change.*` line, no warn or error line, no `emitted_*` line, no `reload-prompt`.

`tally 13230 "$P"`:
```
{"saves":20,"watch":{"ignored_unchanged/unchanged":24,"self_write/not_checked":16},"recv":null,"prompts":0}
```
`persave 13230 "$P"` (the brief's function, rows split at `file.save success`):
```
{"1":["ignored_unchanged/unchanged","ignored_unchanged/unchanged","self_write/not_checked"],"2":["ignored_unchanged/unchanged","self_write/not_checked"],"3":["ignored_unchanged/unchanged"],"4":["ignored_unchanged/unchanged","ignored_unchanged/unchanged"],"5":["ignored_unchanged/unchanged","ignored_unchanged/unchanged"],"6":["ignored_unchanged/unchanged","ignored_unchanged/unchanged","self_write/not_checked"],"7":["ignored_unchanged/unchanged"],"8":["ignored_unchanged/unchanged","ignored_unchanged/unchanged","self_write/not_checked"],"9":["ignored_unchanged/unchanged","self_write/not_checked"],"10":["self_write/not_checked","self_write/not_checked"],"11":["ignored_unchanged/unchanged","self_write/not_checked"],"12":["ignored_unchanged/unchanged","self_write/not_checked"],"13":["ignored_unchanged/unchanged","self_write/not_checked"],"14":["ignored_unchanged/unchanged","self_write/not_checked"],"15":["ignored_unchanged/unchanged","self_write/not_checked"],"16":["ignored_unchanged/unchanged","self_write/not_checked","self_write/not_checked"],"17":["self_write/not_checked"],"18":["ignored_unchanged/unchanged"],"19":["ignored_unchanged/unchanged","ignored_unchanged/unchanged","self_write/not_checked"],"20":["ignored_unchanged/unchanged"]}
```
Proof-line `grep -c`: **24**.

**Attribution note (affects how `persave` reads, not the verdict).** A `self_write` event fires while `save_file` still holds the mark. So it is usually logged a few ms **before** that save's own `file.save success` line (for example L13244 at 58.880 vs L13245 at 58.881). The brief's `persave` therefore books most `self_write` lines to the **previous** row. I re-attributed the same events by `file.save start` instead (same jq, `start` in place of `success`):
```
{"1":["ignored_unchanged/unchanged","ignored_unchanged/unchanged"],"2":["self_write/not_checked","ignored_unchanged/unchanged"],"3":["self_write/not_checked","ignored_unchanged/unchanged"],"4":["ignored_unchanged/unchanged","ignored_unchanged/unchanged"],"5":["ignored_unchanged/unchanged","ignored_unchanged/unchanged"],"6":["ignored_unchanged/unchanged","ignored_unchanged/unchanged"],"7":["self_write/not_checked","ignored_unchanged/unchanged"],"8":["ignored_unchanged/unchanged","ignored_unchanged/unchanged"],"9":["self_write/not_checked","ignored_unchanged/unchanged"],"10":["self_write/not_checked","self_write/not_checked"],"11":["self_write/not_checked","ignored_unchanged/unchanged"],"12":["self_write/not_checked","ignored_unchanged/unchanged"],"13":["self_write/not_checked","ignored_unchanged/unchanged"],"14":["self_write/not_checked","ignored_unchanged/unchanged"],"15":["self_write/not_checked","ignored_unchanged/unchanged"],"16":["self_write/not_checked","ignored_unchanged/unchanged"],"17":["self_write/not_checked","self_write/not_checked"],"18":["self_write/not_checked","ignored_unchanged/unchanged"],"19":["ignored_unchanged/unchanged","ignored_unchanged/unchanged"],"20":["self_write/not_checked","ignored_unchanged/unchanged"]}
```
Both attributions agree. Saves **10** and **17** each produced two watch events and **both** were `self_write/not_checked`. Every other save has its own write checked against the baseline as `ignored_unchanged/unchanged`. Each save emits exactly 2 FSEvents (`kind:"modify_name"`, `pathCount:1`). Every one of the 40 was routed through the replaced-file path (none `ignored_rename_single_path`). This is the D68 + D101 change working, unlike `eb061fa`.

In save 10, the second `self_write` (L13328, 59:04.495) is logged in the same millisecond as `file.save success` (L13327, 59:04.495), so the mark was still held. In save 17, both events (L13396/L13397, 01.466) came before success (L13398, 01.470).

Disk after item 1:
```
$ tail -c 40 $P
.

Third paragraph.....................
$ stat -f %z $P
109
```
That is 20 dots after `Third paragraph.` and 109 = 89 + 20 ✓. `shots/d86-after.png`: Source mode, tab `d86.md` clean (no dirty dot), no dialog.

### Save 1 (lines 13233–13237)
```
13233: {"ts":"2026-10-10T16:57:49.510+08:00","level":"info","event":"file.save","status":"start","actionId":"4ba593db-2fa7-4784-a2d8-584ae5fc1d8b","context":{"filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md"},"durationMs":null,"error":null}
13234: {"ts":"2026-10-10T16:57:49.521+08:00","level":"info","event":"file.save","status":"success","actionId":"4ba593db-2fa7-4784-a2d8-584ae5fc1d8b","context":{"filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","fileSizeBytes":90},"durationMs":10,"error":null}
13236: {"ts":"2026-10-10T16:57:49.532+08:00","level":"info","event":"file.watch.event","status":"cancel","actionId":null,"context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1791622669511,"outcome":"ignored_unchanged","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","pathCount":1,"rescan":false,"size":90,"timestamp":1791622669532,"unchangedCheck":"unchanged"},"durationMs":null,"error":null}
13237: {"ts":"2026-10-10T16:57:49.533+08:00","level":"info","event":"file.watch.event","status":"cancel","actionId":null,"context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1791622669511,"outcome":"ignored_unchanged","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","pathCount":1,"rescan":false,"size":90,"timestamp":1791622669533,"unchangedCheck":"unchanged"},"durationMs":null,"error":null}
```
### Save 20 (lines 13427–13430)
```
13427: {"ts":"2026-10-10T17:00:26.320+08:00","level":"info","event":"file.save","status":"start","actionId":"3ff51803-fde3-4e4e-b84a-3b87adc24eba","context":{"filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md"},"durationMs":null,"error":null}
13428: {"ts":"2026-10-10T17:00:26.329+08:00","level":"info","event":"file.watch.event","status":"cancel","actionId":null,"context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1791622826320,"outcome":"self_write","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","pathCount":1,"rescan":false,"size":109,"timestamp":1791622826329,"unchangedCheck":"not_checked"},"durationMs":null,"error":null}
13429: {"ts":"2026-10-10T17:00:26.331+08:00","level":"info","event":"file.save","status":"success","actionId":"3ff51803-fde3-4e4e-b84a-3b87adc24eba","context":{"filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","fileSizeBytes":109},"durationMs":10,"error":null}
13430: {"ts":"2026-10-10T17:00:26.331+08:00","level":"info","event":"file.watch.event","status":"cancel","actionId":null,"context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1791622826320,"outcome":"ignored_unchanged","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","pathCount":1,"rescan":false,"size":109,"timestamp":1791622826331,"unchangedCheck":"unchanged"},"durationMs":null,"error":null}
```
### Save 10 (OWN-MARK; lines 13325–13328)
```
13325: {"ts":"2026-10-10T16:59:04.485+08:00","level":"info","event":"file.save","status":"start","actionId":"9f622591-2e26-486d-8085-dce8de52b7da","context":{"filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md"},"durationMs":null,"error":null}
13326: {"ts":"2026-10-10T16:59:04.493+08:00","level":"info","event":"file.watch.event","status":"cancel","actionId":null,"context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1791622744485,"outcome":"self_write","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","pathCount":1,"rescan":false,"size":99,"timestamp":1791622744493,"unchangedCheck":"not_checked"},"durationMs":null,"error":null}
13327: {"ts":"2026-10-10T16:59:04.495+08:00","level":"info","event":"file.save","status":"success","actionId":"9f622591-2e26-486d-8085-dce8de52b7da","context":{"filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","fileSizeBytes":99},"durationMs":9,"error":null}
13328: {"ts":"2026-10-10T16:59:04.495+08:00","level":"info","event":"file.watch.event","status":"cancel","actionId":null,"context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1791622744485,"outcome":"self_write","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","pathCount":1,"rescan":false,"size":99,"timestamp":1791622744495,"unchangedCheck":"not_checked"},"durationMs":null,"error":null}
```
### Save 17 (OWN-MARK; lines 13395–13398)
```
13395: {"ts":"2026-10-10T17:00:01.458+08:00","level":"info","event":"file.save","status":"start","actionId":"e8dbe142-1668-4d15-951d-1baa5c2606d2","context":{"filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md"},"durationMs":null,"error":null}
13396: {"ts":"2026-10-10T17:00:01.466+08:00","level":"info","event":"file.watch.event","status":"cancel","actionId":null,"context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1791622801458,"outcome":"self_write","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","pathCount":1,"rescan":false,"size":106,"timestamp":1791622801466,"unchangedCheck":"not_checked"},"durationMs":null,"error":null}
13397: {"ts":"2026-10-10T17:00:01.466+08:00","level":"info","event":"file.watch.event","status":"cancel","actionId":null,"context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1791622801458,"outcome":"self_write","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","pathCount":1,"rescan":false,"size":106,"timestamp":1791622801466,"unchangedCheck":"not_checked"},"durationMs":null,"error":null}
13398: {"ts":"2026-10-10T17:00:01.470+08:00","level":"info","event":"file.save","status":"success","actionId":"e8dbe142-1668-4d15-951d-1baa5c2606d2","context":{"filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","fileSizeBytes":106},"durationMs":12,"error":null}
```
### Every `file.watch.event` line in the slice whose outcome is not `ignored_unchanged` (16 lines, all `self_write/not_checked`)
```
13244: {"ts":"2026-10-10T16:57:58.880+08:00","level":"info","event":"file.watch.event","status":"cancel","actionId":null,"context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1791622678871,"outcome":"self_write","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","pathCount":1,"rescan":false,"size":91,"timestamp":1791622678879,"unchangedCheck":"not_checked"},"durationMs":null,"error":null}
13254: {"ts":"2026-10-10T16:58:07.645+08:00","level":"info","event":"file.watch.event","status":"cancel","actionId":null,"context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1791622687637,"outcome":"self_write","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","pathCount":1,"rescan":false,"size":92,"timestamp":1791622687645,"unchangedCheck":"not_checked"},"durationMs":null,"error":null}
13294: {"ts":"2026-10-10T16:58:40.128+08:00","level":"info","event":"file.watch.event","status":"cancel","actionId":null,"context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1791622720120,"outcome":"self_write","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","pathCount":1,"rescan":false,"size":96,"timestamp":1791622720128,"unchangedCheck":"not_checked"},"durationMs":null,"error":null}
13316: {"ts":"2026-10-10T16:58:56.427+08:00","level":"info","event":"file.watch.event","status":"cancel","actionId":null,"context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1791622736417,"outcome":"self_write","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","pathCount":1,"rescan":false,"size":98,"timestamp":1791622736427,"unchangedCheck":"not_checked"},"durationMs":null,"error":null}
13326: {"ts":"2026-10-10T16:59:04.493+08:00","level":"info","event":"file.watch.event","status":"cancel","actionId":null,"context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1791622744485,"outcome":"self_write","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","pathCount":1,"rescan":false,"size":99,"timestamp":1791622744493,"unchangedCheck":"not_checked"},"durationMs":null,"error":null}
13328: {"ts":"2026-10-10T16:59:04.495+08:00","level":"info","event":"file.watch.event","status":"cancel","actionId":null,"context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1791622744485,"outcome":"self_write","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","pathCount":1,"rescan":false,"size":99,"timestamp":1791622744495,"unchangedCheck":"not_checked"},"durationMs":null,"error":null}
13336: {"ts":"2026-10-10T16:59:12.627+08:00","level":"info","event":"file.watch.event","status":"cancel","actionId":null,"context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1791622752619,"outcome":"self_write","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","pathCount":1,"rescan":false,"size":100,"timestamp":1791622752627,"unchangedCheck":"not_checked"},"durationMs":null,"error":null}
13346: {"ts":"2026-10-10T16:59:20.677+08:00","level":"info","event":"file.watch.event","status":"cancel","actionId":null,"context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1791622760670,"outcome":"self_write","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","pathCount":1,"rescan":false,"size":101,"timestamp":1791622760677,"unchangedCheck":"not_checked"},"durationMs":null,"error":null}
13356: {"ts":"2026-10-10T16:59:28.680+08:00","level":"info","event":"file.watch.event","status":"cancel","actionId":null,"context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1791622768670,"outcome":"self_write","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","pathCount":1,"rescan":false,"size":102,"timestamp":1791622768679,"unchangedCheck":"not_checked"},"durationMs":null,"error":null}
13366: {"ts":"2026-10-10T16:59:36.678+08:00","level":"info","event":"file.watch.event","status":"cancel","actionId":null,"context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1791622776669,"outcome":"self_write","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","pathCount":1,"rescan":false,"size":103,"timestamp":1791622776678,"unchangedCheck":"not_checked"},"durationMs":null,"error":null}
13376: {"ts":"2026-10-10T16:59:45.015+08:00","level":"info","event":"file.watch.event","status":"cancel","actionId":null,"context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1791622785006,"outcome":"self_write","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","pathCount":1,"rescan":false,"size":104,"timestamp":1791622785015,"unchangedCheck":"not_checked"},"durationMs":null,"error":null}
13386: {"ts":"2026-10-10T16:59:53.399+08:00","level":"info","event":"file.watch.event","status":"cancel","actionId":null,"context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1791622793391,"outcome":"self_write","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","pathCount":1,"rescan":false,"size":105,"timestamp":1791622793399,"unchangedCheck":"not_checked"},"durationMs":null,"error":null}
13396: {"ts":"2026-10-10T17:00:01.466+08:00","level":"info","event":"file.watch.event","status":"cancel","actionId":null,"context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1791622801458,"outcome":"self_write","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","pathCount":1,"rescan":false,"size":106,"timestamp":1791622801466,"unchangedCheck":"not_checked"},"durationMs":null,"error":null}
13397: {"ts":"2026-10-10T17:00:01.466+08:00","level":"info","event":"file.watch.event","status":"cancel","actionId":null,"context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1791622801458,"outcome":"self_write","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","pathCount":1,"rescan":false,"size":106,"timestamp":1791622801466,"unchangedCheck":"not_checked"},"durationMs":null,"error":null}
13406: {"ts":"2026-10-10T17:00:09.864+08:00","level":"info","event":"file.watch.event","status":"cancel","actionId":null,"context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1791622809855,"outcome":"self_write","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","pathCount":1,"rescan":false,"size":107,"timestamp":1791622809864,"unchangedCheck":"not_checked"},"durationMs":null,"error":null}
13428: {"ts":"2026-10-10T17:00:26.329+08:00","level":"info","event":"file.watch.event","status":"cancel","actionId":null,"context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1791622826320,"outcome":"self_write","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","pathCount":1,"rescan":false,"size":109,"timestamp":1791622826329,"unchangedCheck":"not_checked"},"durationMs":null,"error":null}
```
### Compact view of every `file.save` and `file.watch.event` line in the slice (line, ts, event, status, outcome, unchangedCheck, size, fileSizeBytes, durationMs)
```
13233 ["16:57:49.510","file.save","start",null,null,null,null,null]
13234 ["16:57:49.521","file.save","success",null,null,null,90,10]
13236 ["16:57:49.532","file.watch.event","cancel","ignored_unchanged","unchanged",90,null,null]
13237 ["16:57:49.533","file.watch.event","cancel","ignored_unchanged","unchanged",90,null,null]
13243 ["16:57:58.870","file.save","start",null,null,null,null,null]
13244 ["16:57:58.880","file.watch.event","cancel","self_write","not_checked",91,null,null]
13245 ["16:57:58.881","file.save","success",null,null,null,91,10]
13246 ["16:57:58.881","file.watch.event","cancel","ignored_unchanged","unchanged",91,null,null]
13253 ["16:58:07.636","file.save","start",null,null,null,null,null]
13254 ["16:58:07.645","file.watch.event","cancel","self_write","not_checked",92,null,null]
13255 ["16:58:07.646","file.save","success",null,null,null,92,9]
13256 ["16:58:07.646","file.watch.event","cancel","ignored_unchanged","unchanged",92,null,null]
13263 ["16:58:15.703","file.save","start",null,null,null,null,null]
13264 ["16:58:15.712","file.save","success",null,null,null,93,9]
13265 ["16:58:15.713","file.watch.event","cancel","ignored_unchanged","unchanged",93,null,null]
13266 ["16:58:15.713","file.watch.event","cancel","ignored_unchanged","unchanged",93,null,null]
13273 ["16:58:23.806","file.save","start",null,null,null,null,null]
13274 ["16:58:23.815","file.save","success",null,null,null,94,8]
13275 ["16:58:23.815","file.watch.event","cancel","ignored_unchanged","unchanged",94,null,null]
13276 ["16:58:23.816","file.watch.event","cancel","ignored_unchanged","unchanged",94,null,null]
13283 ["16:58:31.972","file.save","start",null,null,null,null,null]
13284 ["16:58:31.980","file.save","success",null,null,null,95,8]
13285 ["16:58:31.982","file.watch.event","cancel","ignored_unchanged","unchanged",95,null,null]
13286 ["16:58:31.982","file.watch.event","cancel","ignored_unchanged","unchanged",95,null,null]
13293 ["16:58:40.119","file.save","start",null,null,null,null,null]
13294 ["16:58:40.128","file.watch.event","cancel","self_write","not_checked",96,null,null]
13295 ["16:58:40.132","file.save","success",null,null,null,96,12]
13296 ["16:58:40.132","file.watch.event","cancel","ignored_unchanged","unchanged",96,null,null]
13303 ["16:58:48.103","file.save","start",null,null,null,null,null]
13304 ["16:58:48.113","file.save","success",null,null,null,97,9]
13305 ["16:58:48.113","file.watch.event","cancel","ignored_unchanged","unchanged",97,null,null]
13306 ["16:58:48.113","file.watch.event","cancel","ignored_unchanged","unchanged",97,null,null]
13315 ["16:58:56.417","file.save","start",null,null,null,null,null]
13316 ["16:58:56.427","file.watch.event","cancel","self_write","not_checked",98,null,null]
13317 ["16:58:56.427","file.save","success",null,null,null,98,9]
13318 ["16:58:56.427","file.watch.event","cancel","ignored_unchanged","unchanged",98,null,null]
13325 ["16:59:04.485","file.save","start",null,null,null,null,null]
13326 ["16:59:04.493","file.watch.event","cancel","self_write","not_checked",99,null,null]
13327 ["16:59:04.495","file.save","success",null,null,null,99,9]
13328 ["16:59:04.495","file.watch.event","cancel","self_write","not_checked",99,null,null]
13335 ["16:59:12.618","file.save","start",null,null,null,null,null]
13336 ["16:59:12.627","file.watch.event","cancel","self_write","not_checked",100,null,null]
13337 ["16:59:12.630","file.save","success",null,null,null,100,12]
13338 ["16:59:12.630","file.watch.event","cancel","ignored_unchanged","unchanged",100,null,null]
13345 ["16:59:20.669","file.save","start",null,null,null,null,null]
13346 ["16:59:20.677","file.watch.event","cancel","self_write","not_checked",101,null,null]
13347 ["16:59:20.681","file.save","success",null,null,null,101,11]
13348 ["16:59:20.681","file.watch.event","cancel","ignored_unchanged","unchanged",101,null,null]
13355 ["16:59:28.670","file.save","start",null,null,null,null,null]
13356 ["16:59:28.680","file.watch.event","cancel","self_write","not_checked",102,null,null]
13357 ["16:59:28.682","file.save","success",null,null,null,102,12]
13358 ["16:59:28.682","file.watch.event","cancel","ignored_unchanged","unchanged",102,null,null]
13365 ["16:59:36.669","file.save","start",null,null,null,null,null]
13366 ["16:59:36.678","file.watch.event","cancel","self_write","not_checked",103,null,null]
13367 ["16:59:36.679","file.save","success",null,null,null,103,10]
13368 ["16:59:36.679","file.watch.event","cancel","ignored_unchanged","unchanged",103,null,null]
13375 ["16:59:45.006","file.save","start",null,null,null,null,null]
13376 ["16:59:45.015","file.watch.event","cancel","self_write","not_checked",104,null,null]
13377 ["16:59:45.016","file.save","success",null,null,null,104,10]
13378 ["16:59:45.016","file.watch.event","cancel","ignored_unchanged","unchanged",104,null,null]
13385 ["16:59:53.390","file.save","start",null,null,null,null,null]
13386 ["16:59:53.399","file.watch.event","cancel","self_write","not_checked",105,null,null]
13387 ["16:59:53.401","file.save","success",null,null,null,105,11]
13388 ["16:59:53.401","file.watch.event","cancel","ignored_unchanged","unchanged",105,null,null]
13395 ["17:00:01.458","file.save","start",null,null,null,null,null]
13396 ["17:00:01.466","file.watch.event","cancel","self_write","not_checked",106,null,null]
13397 ["17:00:01.466","file.watch.event","cancel","self_write","not_checked",106,null,null]
13398 ["17:00:01.470","file.save","success",null,null,null,106,12]
13405 ["17:00:09.855","file.save","start",null,null,null,null,null]
13406 ["17:00:09.864","file.watch.event","cancel","self_write","not_checked",107,null,null]
13407 ["17:00:09.866","file.save","success",null,null,null,107,10]
13408 ["17:00:09.866","file.watch.event","cancel","ignored_unchanged","unchanged",107,null,null]
13415 ["17:00:17.887","file.save","start",null,null,null,null,null]
13416 ["17:00:17.896","file.save","success",null,null,null,108,9]
13417 ["17:00:17.896","file.watch.event","cancel","ignored_unchanged","unchanged",108,null,null]
13418 ["17:00:17.897","file.watch.event","cancel","ignored_unchanged","unchanged",108,null,null]
13427 ["17:00:26.320","file.save","start",null,null,null,null,null]
13428 ["17:00:26.329","file.watch.event","cancel","self_write","not_checked",109,null,null]
13429 ["17:00:26.331","file.save","success",null,null,null,109,10]
13430 ["17:00:26.331","file.watch.event","cancel","ignored_unchanged","unchanged",109,null,null]
```

## 5. Item 3: D112 external change (`d86.md`, Source, run before item 2)

- Last ⌘S of item 1 at 17:00:26. The replace ran at 17:01:06, 40 s later (≥5 s ✓). No key was sent to mdpro. **mark NC = 13434.**
- `printf … > $S/d86.md.ext.tmp && mv $S/d86.md.ext.tmp $S/d86.md`, rc 0 at 17:01:06.338.
- 3 s wait, then `shot.sh d112-ext` **first**: it shows **External change detected**, "File was modified externally. Reload to update content?", with buttons **Ignore** and **Reload**.
- `since "$FW"`, then the following `ui.dialog.cancel`. **Slice: lines 13435–13440**, all lines in it shown:
```
13435: {"ts":"2026-10-10T17:01:06.420+08:00","level":"info","event":"file.watch.event","status":"success","actionId":null,"context":{"changeType":"modified","detail":"any","info":null,"kind":"modify_name","mtimeMs":1791622866333,"outcome":"emitted_modified","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","pathCount":1,"rescan":false,"size":53,"timestamp":1791622866420,"unchangedCheck":"stat_differs"},"durationMs":null,"error":null}
13436: {"ts":"2026-10-10T17:01:06.420+08:00","level":"info","event":"file.watch.event","status":"cancel","actionId":null,"context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1791622866333,"outcome":"ignored_unchanged","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","pathCount":1,"rescan":false,"size":53,"timestamp":1791622866420,"unchangedCheck":"unchanged"},"durationMs":null,"error":null}
13437: {"ts":"2026-10-10T17:01:06.427+08:00","level":"info","event":"file.change.received","status":"start","actionId":"6437f684-5316-432d-8c6d-246dd3c2473d","context":{"changeType":"modified","eventTimestamp":1791622866420,"outcome":"scheduled","path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","windowLabel":"main"},"durationMs":null,"error":null}
13438: {"ts":"2026-10-10T17:01:06.729+08:00","level":"info","event":"file.change.received","status":"success","actionId":"6437f684-5316-432d-8c6d-246dd3c2473d","context":{"changeType":"modified","eventTimestamp":1791622866420,"outcome":"delivered","path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","windowLabel":"main"},"durationMs":null,"error":null}
13439: {"ts":"2026-10-10T17:01:06.735+08:00","level":"info","event":"file.change.decision","status":"success","actionId":"df2e10f8-5cd0-4c39-9732-77253cdd3edb","context":{"action":"reload-prompt","changeType":"modified","documentId":"7d424caec716e194","eventTimestamp":1791622866420,"isModified":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/d86.md","pathMatchesActive":true,"windowLabel":"main"},"durationMs":null,"error":null}
13440: {"ts":"2026-10-10T17:01:21.803+08:00","level":"info","event":"ui.dialog.cancel","status":"success","actionId":"8ba9b12e-f606-4da3-a048-8c9d331df908","context":{"controlId":"dialog.reload.ignore"},"durationMs":null,"error":null}
```
`tally 13434 "$P"`:
```
{"saves":0,"watch":{"emitted_modified/stat_differs":1,"ignored_unchanged/unchanged":1},"recv":{"delivered":1,"scheduled":1},"prompts":1}
```
- **unchangedCheck that appeared: `stat_differs`.** The second event of the same `mv` (L13436, same ms) is `ignored_unchanged/unchanged`, because the baseline had already advanced, as the brief expects. `decision` has `isModified:false` and `pathMatchesActive:true`.
- **Ignore** was clicked with the mouse (no Enter, no Esc). Then `shots/d112-ext-ignored.png`: the dialog is gone and the editor still shows the old text.
```
$ cat $S/d86.md
# D112 external

Replaced from Terminal at 17:01:06.
```

## 6. Item 2: D112 large file (`big.md`, Source, last)

- The window was already in Source (⌃2 from item 1; ⌃4 had not been pressed). Gate passed, **mark 13440**, OPEN(`$S/big.md`): ⌘O, ⌘⇧G, typed the full path, double-clicked the suggestion row, clicked **Open**.
  - L13442 `file.open` start (`source:"dialog"`).
  - L13445 `file.watch.register`: `ok:true`, **`baseline:"seeded"`**, `size` 10477556, `watchedCount` 2.
  - L13446 `file.open` success, `fileSizeBytes` 10477556, `durationMs` 15.
  - Start→success took 19 s, because the panel stayed open while I worked it.
  - The view stayed in **Source** (window title SOURCE, line gutter shown), with no switch to WYSIWYG.
- Clipboard: `perl … | pbcopy`, then `pbpaste | wc -c` = **18800** ✓.
- Clicked in editor text, gate ✓, ⌘↓ (`kc.sh 125 command`), gate ✓, ⌘V, wait 5 s. The editor ended at line 143931 and the `big.md` tab showed the dirty dot.
- **mark NB = 13456**, gate ✓, ⌘S at 17:02:16, then 15 s untouched. `shots/d112-big.png`: tab clean, no dialog.
- **Slice: lines 13457–13467.** The watcher, save and MCP lines:
```
13459: {"ts":"2026-10-10T17:02:16.136+08:00","level":"info","event":"file.save","status":"start","actionId":"8a20595e-e64d-43d2-9b3d-4a4967a24ea3","context":{"filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/big.md"},"durationMs":null,"error":null}
13460: {"ts":"2026-10-10T17:02:16.155+08:00","level":"info","event":"file.save","status":"success","actionId":"8a20595e-e64d-43d2-9b3d-4a4967a24ea3","context":{"filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/big.md","fileSizeBytes":10496356},"durationMs":19,"error":null}
13464: {"ts":"2026-10-10T17:02:16.176+08:00","level":"info","event":"file.watch.event","status":"cancel","actionId":null,"context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1791622936140,"outcome":"ignored_unchanged","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/big.md","pathCount":1,"rescan":false,"size":10496356,"timestamp":1791622936171,"unchangedCheck":"unchanged"},"durationMs":null,"error":null}
13466: {"ts":"2026-10-10T17:02:16.182+08:00","level":"info","event":"file.watch.event","status":"cancel","actionId":null,"context":{"changeType":null,"detail":"any","info":null,"kind":"modify_name","mtimeMs":1791622936140,"outcome":"ignored_unchanged","ownEvent":false,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8c996b1/big.md","pathCount":1,"rescan":false,"size":10496356,"timestamp":1791622936177,"unchangedCheck":"unchanged"},"durationMs":null,"error":null}
13467: {"ts":"2026-10-10T17:02:16.500+08:00","level":"warn","event":"mcp.sync","status":"fail","actionId":null,"context":{"error":"document e71509dbfd266589 content exceeds 10485760 byte limit (10496356 bytes)"},"durationMs":null,"error":null}
```
The other lines in the slice are 1 `ui.shortcut.trigger`, 2 `preferences.set`, 1 `preferences.read` and 2 `menu.recent_files.sync`. No `file.change.*` line and no `emitted_*` line.

`tally 13456 "$S/big.md"`:
```
{"saves":1,"watch":{"ignored_unchanged/unchanged":2},"recv":null,"prompts":0}
```
`persave 13456 "$S/big.md"`:
```
{"1":["ignored_unchanged/unchanged","ignored_unchanged/unchanged"]}
```
`stat -f %z $S/big.md` = **10496356**. It equals `fileSizeBytes` and 10477556 + 18800, and it is ≥ 10489856 ✓.

Save timing:
- `durationMs`: **19**
- `file.save` start (17:02:16.136) → success (17:02:16.155): **19 ms**
- success (17:02:16.155) → first `file.watch.event` for `big.md` (L13464, 17:02:16.176): **21 ms**

For comparison, `eb061fa` logged `durationMs:22` for a 10.5 MB save.

The `mcp.sync` warn/fail at L13467 ("content exceeds 10485760 byte limit (10496356 bytes)") is expected per `eb061fa` N2 and is not a FAIL. `big.md` was left saved and was not edited further.

## 7. Restore and Close

- Window bounds after item 2: (100,100) 1200×800 = W0. No resize needed.
- Clicked the `d86.md` tab, gate ✓, ⌃4. L13472 `view.mode.change` `source`→`wysiwyg`, `d86.md` active. The 10 MiB document was never rendered in WYSIWYG.
- Quit via **mdpro › Quit mdpro**: L13486 `app.quit.request`, then L13488/L13492 `app.quit.check` `answer:"clean"` `dirtyCount:0`, then L13499 `app.quit` success. There was no Unsaved changes dialog and no Discard.
- `pgrep -fl tauri-app`: empty (rc 1).
- Settings re-read is identical to the as-found values (§2).
- `shasum -a 256 -c start.sha` → `fixture.orig: OK`. `$S` (including `big.md`) and `$WT` were left in place.

## 8. Shots (`reports/shots/`)

`about.png`, `d86-after.png`, `d112-ext.png`, `d112-ext-ignored.png`, `d112-big.png`. All are 1200×800 window captures from `shot.sh`.

## 9. Operator slips

1. **Scratch-file age at launch.** `d86.md` was created at 16:56:19 and the cold launch ran at 16:56:52, 33 s later; the brief asks for ≥35 s. Its `file.watch.register` landed at 16:56:56 (37 s). The first item-1 event came at 16:57:49, 90 s after creation. No creation-flag event appears in any item slice (item 1's 40 events are all `modify_name`), so I judge there was no effect.
2. **Focus gate inside the native Open panel.** The gate before ⌘⇧G returned `window.blur` (main), because the native NSOpenPanel had key focus. I sent ⌘⇧G and typed the path into the panel anyway, since the panel and not the main window is the target there. The gate before ⌘O, and every gate after the panel closed, passed. No document input was affected.
3. **Item 1 cadence.** The 0.5 s wait after typing was ≥0.5 s; tool round-trip time made the real gap longer. The 4 s wait after each ⌘S was a fixed `sleep 4`, plus the round-trip before the next type, so saves were ≈8–9 s apart. No wait was shorter than the brief's minimum.

## 10. Deviations and notes

- **N-a, OWN-MARK on saves 10 and 17.** Quoted in §4. These are the only saves where the baseline was never consulted. The delegator decides whether 18/20 proof plus 2 OWN-MARK meets the WI-4 gate. In total, 16 of 40 events were `self_write`, and they were spread across 14 saves. In 12 of those 14, the second event of the same save still reached the baseline check and logged `ignored_unchanged/unchanged`.
- **N-b, `persave` row skew.** The brief's `persave` splits rows at `file.save success`, but `self_write` events are usually logged just before their own save's `success` line, so they land in the previous row. It does not change any count or verdict here, because both attributions single out saves 10 and 17. A future brief may want to split rows at `file.save start`.
- **N-c, pre-flight `pgrep` false matches.** As in §1, `tmux … dtrack` (24817) and `claude --resume mdpro-remote` (66024) matched `mdpro`. Neither is an mdpro process from outside `builds/*`, so I did not stop. Suggest `pgrep -fl tauri-app` or `pgrep -fl 'mdpro.app'` in future briefs.
- **N-d, stray tool artifact in `$S`.** `$S/.claude/mind.mv2.lock` (created 16:57) was made by the executor's own Claude Code memory plugin when the shell's working directory was in `$S`. It is not app output. I left it in place, since `$S` is kept and it is the plugin's lock.
- **Unnamed `unchangedCheck` values:** none. Only `unchanged`, `not_checked` (with `self_write`) and `stat_differs` appeared.
- No autocorrect bubbles, no toasts, no path corrections (N1): every brief path and symbol existed at HEAD. No Esc, Enter, ⌘Z or Reload was used. No MCP calls were made.
- Focus was never lost: every gate on the main window passed on the first read, so `open_application` was never needed.
