# D 系列真机复测记录：D31 / D43 / D44 / D46（2026-10-07）

本轮在 Mac mini 上用 `fix/dtrack-batch` 的 release 构建，把 D31、D43、D44、D46 四行剩下的真机判据跑完，四行全部通过。下面 §「测试报告原文」是 mini 上执行会话的报告，原样收录（英文）；排序文档、ledger、CHANGELOG 按本记录改写。

## 0. 测量条件

| 项 | 值 |
|---|---|
| 日期 | 2026-10-07 |
| 机器 | Mac mini，1920×1080 @1x |
| 执行方 | 控制台上 Terminal.app 里的 Claude 会话，经 System Events 与 CGEvent 驱动 app |
| 被测构建 | release v0.3.0，分支 `fix/dtrack-batch` 的 `a55e87f`，bundle mtime 2026-10-07 17:01:07 |
| 证据存放 | 截图与原始证据在 mini 的 `~/.mdpro-redesign/dtrack/reports/shots/`，**不入库**；下文的 `shots/…` 均指该目录 |

**构建之后的提交**：本次真机验证的是 `a55e87f`。其后 `e87cbc4`（D24 第 6 步 Part A，2026-10-07 20:29）改写了 `src/App.tsx` 与 `src/hooks/useKeyboardShortcuts.ts` 里 View 菜单、键盘循环与 Mod-/ 的视图模式处理（`onViewModeChange` / `onCycleViewMode` → `userViewModeCommands`）。D31 依赖的 `src/hooks/useMenuEvents.ts` 菜单订阅机制未被它改动，但四行的真机证据都早于该提交。

## 1. Delegator 复核

MacBook 上的 delegator 会话经 SSH 独立重读了 mini 的 `~/.mdpro/mdpro.log`，确认：

- **D31**：7 条 `ui.menu.select`（3× `new_window`；打字后 1× `new_window`，`windowLabel` 为 `mdpro-2d7ac23a…`，即聚焦窗口；`mdpro-4e69072c…` 上 theme light / dark / system 各一条）；`ui.menu.listen` 6 条 = 6 个不同窗口标签；`ui.menu.focus_check` 0 条；`file.save start` 1 条。另查看了截图 `d31-2-typed-w3`，确认打的字在 mdpro 编辑器里。
- **D43**：恰好一条 warn `menu.recent_files.sync` `{count:10,op:"seed",outcome:"hydration_failed"}`，时间 17:26:54.510。
- **D44**：6 条 `editor.table.format-widened`；保存后的文件含 `| g   | h   | Z   |`；`autoReformatTablesOnSave` 已恢复为 `false`。
- **D46**：`file.open.report fail FileTooLarge` 出现在 url_param（M-1、M-7）、拖放（M-2）、Open Recent（M-4）与冷启动（M-3）各路径；⌘O（M-6）没有这一条，符合设计——⌘O 走 `handleOpenDialog` 自己的 catch。
- **报告末尾 NOTE 的去向**：NOTE 1（拖放失败仍把视图模式切到 WYSIWYG）已登记为 D51（`frontend-backend-redesign` 的 `4d4466d`）。NOTE 2（Rust `file.open fail` 记完整路径）不是新缺陷：D46 的测试矩阵当时就把它列为延后（`.claude/tdd-guardian/tests-20261003-130127.md` 第 192 行，"Rust full-path logs are Deferred"）。NOTE 3、NOTE 4 符合设计。NOTE 5（Open Recent 里同名文件并列）与 NOTE 6（提示框开着时草稿日志 646 条）只记录，暂不立项。

## 2. 测试报告原文

### D-track device checks D31 / D43 / D44 / D46 — Mac mini, 2026-10-07

**Summary: D31 PASS · D43 PASS · D44 PASS · D46 PASS (M-1…M-7 all PASS; M-3 cold-opened via LaunchServices `open -a`, see the M-3 row).** No new defects; NOTEs at the end.

## D31: one menu action = one handler call — **PASS**

Log start offset: `wc -l` = **4266** (all evidence below is from lines 4267+). Cold launch at 17:13:15 (`app.launch start`, `window.open main`, `ui.menu.listen success main`).

| Step | Result | Observed / evidence |
|---|---|---|
| 1. ⌘⇧N ×3, one at a time | PASS | Window count 1→2→3→4, one per press. Each press logged exactly one `ui.menu.select` `menu.file.new_window` (windowLabel `main`, then `mdpro-2d7ac23a…`, then `mdpro-4fd85f81…`, which is always the window focused at the time) and one new `ui.menu.listen success` (`mdpro-2d7ac23a…`, `mdpro-4fd85f81…`, `mdpro-730d6dc6…`). Shot: `shots/d31-1-three-windows.png` |
| 2. ~30 s continuous typing in each window | DONE | ⌘N gave each window an Untitled doc; then 30 s of continuous `keystroke` text per window (offset 4429; ~137–142 chunks of ~50 chars each). Shots: `shots/d31-2-typed-w1..w4.png` show the text (w1…w4 markers). Note: a first attempt (offset 4368) typed nothing into the app, because without a real mouse click the empty WYSIWYG doc had no editor focus. The real pass used a CGEvent click first. |
| 3. Focus one window, ⌘⇧N once | PASS | Focused `mdpro-2d7ac23a-52d0-4dc3-97e3-083ed7247dce` (log offset 4469: `window.focus` → that label). ⌘⇧N at offset 4473: windows 4→5; exactly one line `{"event":"ui.menu.select","context":{"controlId":"menu.file.new_window","windowLabel":"mdpro-2d7ac23a-52d0-4dc3-97e3-083ed7247dce"}}` at 17:19:50.674; new window `mdpro-4e69072c-0067-408f-b8f1-ea379908548c` (`window.create success`, `ui.menu.listen success`). The select label equals the focused label. Shot: `shots/d31-3-new-window.png` |
| 4. Theme Light / Dark / System | PASS | Offset 4504, focused window `mdpro-4e69072c…`. Exactly one `ui.menu.select` per click: `menu.theme.light` 17:19:59.064, `menu.theme.dark` 17:20:01.231, `menu.theme.system` 17:20:03.389, all `windowLabel: mdpro-4e69072c-0067-408f-b8f1-ea379908548c`. Theme left on **System**. |
| 5. ⌘S on a dirty doc | PASS | Scratch copy `scratch/d31-save.md` opened (window `mdpro-ed3d8b16…`), " dirty" appended. Offset 4559: `ui.shortcut.trigger {action:file.save, shortcut:Cmd+S}`, then exactly one `file.save start {filePath:…/scratch/d31-save.md}`, then `file.save success {fileSizeBytes:586}`. The file md5 changed and the text is on disk. No `ui.menu.select` for save, so there was no second handler path. Shots: `shots/d31-5-dirty.png`, `shots/d31-5-saved.png` |
| 6. Counts (4267..4576) | PASS | `ui.menu.listen success` = **6**; distinct window labels = **6** (`main`, `mdpro-2d7ac23a…`, `mdpro-4fd85f81…`, `mdpro-730d6dc6…`, `mdpro-4e69072c…`, `mdpro-ed3d8b16…`). `ui.menu.focus_check fail` = **0**. No warn/error lines in the range. |

No click produced two different `windowLabel`s, so there is no new defect.

## D43: Open Recent survives a corrupt config — **PASS**

Log start offset: `wc -l` = **4739** (cold launch; the app was quit first after the user discarded the four D31 test docs). Step-3 offset: **4895**.

| Step | Result | Observed / evidence |
|---|---|---|
| 1. Cold launch, `open -a <full path>` b.md, c.md, d.md | PASS | Three new windows: b → `mdpro-a5504d7e…`, c → `mdpro-56da2060…`, d → `mdpro-d0fe1881-b70f-49f4-8975-0505b2d03fa5` (`file.open.route outcome:new-window`, `file.open.url_param success`). `menu.recent_files.sync op:record` count 7→8→9→10. Shot: `shots/d43-1-three-windows.png` |
| 2. Backup and corrupt config | DONE | `cp ~/.mdpro/config.json scratch/config.backup.json` (cmp equal, 4655 bytes). Overwrote it with `{not json` (9 bytes, also saved as `scratch/corrupt.json`). |
| 3. `open -a <app> a.md` | PASS | New window `mdpro-faf9dad7-bd22-48db-b529-f10062224229`; `file.open success a.md`. |
| 4. Open Recent in every window | PASS | Read through System Events with each of the 5 windows focused in turn (`main`, b, c, d, a). Every window shows the same list: **a.md, d.md, c.md, b.md**, d31-save.md, wi04-surfaces.md, wi04-surfaces.md, d12-table-above-b.md, d12-table-above.md, d17-image-heavy.md. With the d.md window (`mdpro-d0fe1881…`) focused, the opened menu shows a.md first (shot: `shots/d43-4-open-recent-d-window.png`). |
| 5. Log + file bytes | PASS | Exactly one: `{"ts":"2026-10-07T17:26:54.510+08:00","level":"warn","event":"menu.recent_files.sync","status":"fail","context":{"count":10,"op":"seed","outcome":"hydration_failed"}}`. `cmp ~/.mdpro/config.json scratch/corrupt.json` showed them equal after the menu checks, so the corrupt bytes were not overwritten. |
| 6. Restore | DONE | `cp scratch/config.backup.json ~/.mdpro/config.json`; `cmp` equal (RESTORE VERIFIED). |

Other non-info lines in the step-3 range (not failures of D43; listed for the record):
- `{"ts":"…17:26:54.389","level":"warn","event":"window.open","context":{"filePath":"…/scratch/a.md","geometry":"default","geometryReason":"read_failed",…}}`: window geometry fell back to default because config was unreadable.
- `{"ts":"…17:26:54.533","level":"error","event":"preferences.set","status":"fail","error":"ParseError"}`: a partial preferences write was refused rather than overwriting the corrupt file. This is consistent with the bytes-unchanged expectation.

## D44: format-on-save keeps overflow cells (source mode) — **PASS**

Log start offset: `wc -l` = **4940**; save offset **4999**. Copy: `scratch/d44.md` (pristine copy kept as `scratch/d44.orig.md`).

| Step | Result | Observed / evidence |
|---|---|---|
| 1. ⌘, → Markdown → tick "Auto-Reformat Tables on Save" | DONE | It was **off** beforehand (`autoReformatTablesOnSave: false`). After the tick: `preferences.set success`, config line → `true`. Shots: `shots/d44-1-markdown-tab.png`, `shots/d44-1-ticked.png` |
| 2. Open copy, ⌃2, space + delete at end of line 8, ⌘S | DONE | `file.open.url_param success d44.md` (window `mdpro-32825500…`); `view.mode.change {fromMode:wysiwyg,toMode:source}`. Clicked the end of line 8 ("…then press ⌘S."), End, typed a space (`shots/d44-2-space-typed.png`), Backspace, then ⌘S. Line 8 shows no diff afterwards. |
| 3. Diff saved vs original | PASS | Only the six table blocks changed (diff below). The saved tables are **byte-identical** to the fixture's "Expected bytes on disk" block (scripted `diff`, empty). Table 1 → 3 cols with `Z` in the g row; table 2 → 4 cols; table 3 keeps `:--`/`:-:`/`--:` and adds `---`; table 4 keeps `a \| b` as one cell; table 5 keeps `中文字Z` byte for byte; table 6 has `x` in col 2 and `Z` in col 3. The fenced block is unchanged (scripted `diff` empty). Shot: `shots/d44-3-saved.png` |
| 4. Log | PASS | Exactly one `editor.table.format-widened` per widened table (6 tables in the fixture, 6 lines), each with only `start`/`end`/`fromColCount`/`toColCount` and **no cell text**: 2→3 (826–866), 1→4 (901–930), 3→4 (1012–1061), 2→3 (1116–1154), 2→3 (1205–1242), 2→3 (1322–1353). Then one `editor.table.auto-reformat-on-save`, one `file.save start`, and `file.save success fileSizeBytes:2223`. |
| 5. Setting restored | DONE | Unticked; config line → `false`. Shot: `shots/d44-5-unticked.png` |

Evidence lines (offset 4999+):
```
{"ts":"2026-10-07T17:28:59.826+08:00","level":"info","event":"editor.table.format-widened","status":"success","actionId":null,"context":{"end":1353,"fromColCount":2,"start":1322,"toColCount":3},"durationMs":null,"error":null}
{"ts":"2026-10-07T17:28:59.826+08:00","level":"info","event":"editor.table.format-widened","status":"success","actionId":null,"context":{"end":1242,"fromColCount":2,"start":1205,"toColCount":3},"durationMs":null,"error":null}
{"ts":"2026-10-07T17:28:59.827+08:00","level":"info","event":"editor.table.format-widened","status":"success","actionId":null,"context":{"end":1154,"fromColCount":2,"start":1116,"toColCount":3},"durationMs":null,"error":null}
{"ts":"2026-10-07T17:28:59.827+08:00","level":"info","event":"editor.table.format-widened","status":"success","actionId":null,"context":{"end":1061,"fromColCount":3,"start":1012,"toColCount":4},"durationMs":null,"error":null}
{"ts":"2026-10-07T17:28:59.827+08:00","level":"info","event":"editor.table.format-widened","status":"success","actionId":null,"context":{"end":930,"fromColCount":1,"start":901,"toColCount":4},"durationMs":null,"error":null}
{"ts":"2026-10-07T17:28:59.828+08:00","level":"info","event":"editor.table.format-widened","status":"success","actionId":null,"context":{"end":866,"fromColCount":2,"start":826,"toColCount":3},"durationMs":null,"error":null}
{"ts":"2026-10-07T17:28:59.828+08:00","level":"info","event":"file.save","status":"start","actionId":"bd068788-2657-483b-a7c0-b9c6db040701","context":{"filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/d44.md"},"durationMs":null,"error":null}
```

Saved-vs-original diff:
```diff
19,22c19,22
< | a | b |
< | - | - |
< | e | f |
< | g | h |Z
---
> | a   | b   |     |
> | --- | --- | --- |
> | e   | f   |     |
> | g   | h   | Z   |
26,28c26,28
< | x |
< | - |
< | 3 | Q | R | S |
---
> | x   |     |     |     |
> | --- | --- | --- | --- |
> | 3   | Q   | R   | S   |
32,34c32,34
< | a | b | c |
< | :- | :-: | -: |
< | 1 | 2 | 3 | Z |
---
> | a   | b   | c   |     |
> | :-- | :-: | --: | --- |
> | 1   | 2   | 3   | Z   |
38,40c38,40
< | a | b |
< | - | - |
< | 1 | 2 | a \| b |
---
> | a   | b   |        |
> | --- | --- | ------ |
> | 1   | 2   | a \| b |
44,46c44,46
< | 名前 | 值 |
< | - | - |
< | a | b | 中文字Z |
---
> | 名前  | 值   |      |
> | --- | --- | ---- |
> | a   | b   | 中文字Z |
50,52c50,52
< | a | b |
< | - | - |
< | | x | Z |
---
> | a   | b   |     |
> | --- | --- | --- |
> |     | x   | Z   |
```

## D46: externally opening a file over 10 MiB

Fixtures: `node scripts/manual-fixtures/generate-large.mjs ~/.mdpro-redesign/dtrack/scratch --check` → `d46-over-10mib.md` 10485761 B sha256 `2f7153cb…c3b295` ok; `d46-exactly-10mib.md` 10485760 B sha256 `03a3d9bb…0a0f8` ok.
Order run: M-1, M-7, M-2, M-5, M-6, M-4, then M-3 last (M-3 needs a quit, which hits an unsaved-changes prompt, so it was batched to the end to interrupt the user only once).

| Step | Result | Offset | Observed / evidence |
|---|---|---|---|
| M-1 | **PASS** | 5020 | `open -a <full path> scratch/d46-over-10mib.md` → `file.open.route outcome:new-window`; new window `mdpro-8a7f247a-9bb3-4e17-854c-78210df2d30b` (6→7 windows) with toast **"Failed to open file"** (exact, no path) and no tab (`shots/d46-m1-seq-02.png`). Window usable: ⌘N in it → `ui.shortcut.trigger file.new`, `tab.open success` Untitled (`shots/d46-m1-cmdN.png`). Exactly one each: `{"ts":"2026-10-07T17:29:57.778+08:00","level":"error","event":"file.open.report","status":"fail","context":{"reason":"FileTooLarge"}}` and `{"ts":"2026-10-07T17:29:57.779+08:00","level":"error","event":"file.open.url_param","status":"fail","context":{"documentId":null,"fileBasename":"d46-over-10mib.md","hasContent":false,"windowLabel":"mdpro-8a7f247a-…"},"error":"openDocumentFromPath returned null"}`. The url_param context carries the basename only, with no path (its other keys are `documentId:null`, `hasContent:false` and `windowLabel`). |
| M-7 | **PASS** | 5059 | Re-ran the M-1 open with timestamped captures (`shots/d46-m7-seq-00..23.png`; dark-pixel count of the toast text region per frame). Fail logged 17:31:11.054. Toast absent at 17:31:10.901, **present 17:31:11.275 → 13.909**, **gone at 14.354** and after. Visible about 2.9–3.3 s. One toast at a time (single toast box in every frame, `shots/d46-m7-seq-04.png`). M-1's own coarse sequence agrees (present frames 00–03, gone from 04). |
| M-2 | **PASS** | 5104 | Dirty Untitled doc ("M-2 dirty content line", source mode) in window `mdpro-8817dc36…`. Real CGEvent drag from Finder → drop on the editor. One toast "Failed to open file" (`shots/d46-m2-after-drop2.png`); tab content intact (Milkdown remount `contentLength:22`, text visible) and dirty dot still shown; exactly one `{"ts":"2026-10-07T17:32:50.894+08:00","level":"error","event":"file.open.drop","status":"fail","context":{"filePath":"…/scratch/d46-over-10mib.md","openedInNewWindow":false},"error":"open failed"}` plus one `file.open.report fail {reason:FileTooLarge}`. See NOTE 3 (view mode flipped). The first drag attempt (offset 5099) landed on a different Finder window and is not counted; see NOTE 5. |
| M-5 | **PASS** | 5127 | `open -a <full path> scratch/d46-exactly-10mib.md` → `file.open success fileSizeBytes:10485760`, `tab.open`, `file.open.url_param success`. No failure toast. The only toast was the informational "This document is too complex for WYSIWYG. Switched to Source mode for performance." (`shots/d46-m5-1.png`). |
| M-6 | **PASS** | 5175 | ⌘O → ⌘⇧G path → Open. **Exactly one** toast "Failed to open file" (`shots/d46-m6-seq-00..06` present, 07+ gone; `shots/d46-m6-seq-02.png`). Log: `ui.shortcut.trigger file.open`, `file.open start {source:dialog}`, `{"ts":"2026-10-07T17:33:55.639+08:00","level":"error","event":"file.open","status":"fail","context":{"filePath":"…/scratch/d46-over-10mib.md"},"error":"file too large: … size=10485761"}`. There is no `file.open.report` line on this path (see NOTE 4). |
| M-4 | **PASS** | 5182 / 5202 | ⌘O opened `scratch/m4-small.md` (580 B), ⌘W closed it (`tab.close wasModified:false`, no prompt). `cp d46-over-10mib.md m4-small.md` (10485761 B). File → Open Recent → `m4-small.md` (top entry): `ui.menu.select {controlId:menu.file.open_recent}`, `file.open fail … size=10485761`, one `{"ts":"2026-10-07T17:34:44.624+08:00","level":"error","event":"file.open.report","status":"fail","context":{"reason":"FileTooLarge"}}`. One toast (`shots/d46-m4-seq-2.png`); no `tab.open`; the tab bar still shows only `d46-exactly-10mib.md`. |
| M-3 | **PASS** | 5208 / 5934 | ⌘Q → unsaved prompt for the M-2 test doc (window `mdpro-8817dc36…`). **The user clicked Discard** (`ui.dialog.confirm dialog.quit.confirm`, then `app.quit.commit success {deleted:1}`, `app.quit success` at 20:22:08). Cold open with the app not running: a Finder AppleScript `open … using <full-path app>` was refused by Finder ('The application "(null)" does not have permission to open "d46-over-10mib.md"'; the app never launched, and no mdpro log lines). A Finder double-click would go to the .md default handler (PyCharm), not this bundle. So the cold open used `open -a <full path> scratch/d46-over-10mib.md`, the LaunchServices open-documents event that Finder also sends. The log records it as `source:"finder"`. Log: `app.launch start` 20:23:35.993 → `file.open.external {appReady:false, source:finder}` → `file.open.external.pending {reason:app_not_ready}` → `app.launch_state.set count:1` → `window.open main` → `app.launch_state.take count:1` → `file.open fail … size=10485761` → `{"ts":"2026-10-07T20:23:36.378+08:00","level":"error","event":"file.open.report","status":"fail","context":{"reason":"FileTooLarge"}}`. **`main` shows "Failed to open file"**, with no tab (`shots/d46-m3-seq-02.png`); the toast is present in frames 01–05 (~0.4 s apart) and gone from 06. The window stayed afterwards (1 window, `shots/d46-m3-final.png`). |

**D46 overall: PASS.**

## Build and environment

- Repo HEAD: `a55e87f015dd2a32b088fca716366d7df63a9215` (`fix(table): keep overflow cells when auto-reformat on save runs`, committed 2026-10-07T16:52:34+08:00), branch `fix/dtrack-batch`, no source diffs in the working tree (only untracked tool files).
- App under test: `/Users/jack/Documents/mac-app/mdpro/src-tauri/target/release/bundle/macos/mdpro.app`, version 0.3.0, bundle mtime **2026-10-07 17:01:07** (postdates HEAD). Every launch and `open -a` used this full path; `ps` confirmed `…/bundle/macos/mdpro.app/Contents/MacOS/tauri-app`. No other mdpro was running.
- Driving: System Events keystrokes and menu clicks to process `tauri-app`, a CGEvent click/drag helper, and `screencapture`. All runs used copies in `~/.mdpro-redesign/dtrack/scratch/`.
- State left behind: app quit; `~/.mdpro/config.json` was restored from backup after D43 (cmp verified); `autoReformatTablesOnSave` is back to `false`. Since the restore the config only differs in recent-file array entries (this session's opens). Theme is **System** (last D31 click).

## NOTEs (observations, not fixes)

1. **A failed drop flips the window from Source to WYSIWYG** (M-2): `view.mode.change {fromMode:source,toMode:wysiwyg}` is logged in the same ms as `file.open.drop start`, before the size check fails, and the window stays in WYSIWYG. Content was intact here (plain text). Untested inference: per ADR-0052, WYSIWYG drops overflow table cells on load, so a dirty source-mode doc with overflow cells that receives a rejected drop might lose them on the next save. Worth a targeted check.
   - Filed as D51 on `frontend-backend-redesign` (`4d4466d`): root cause is `src/App.tsx` `handleFileDrop` calling `setViewMode(defaultViewMode)` before opening.
2. **The Rust `file.open fail` line logs the full path** in both `context.filePath` and the `error` string ("file too large: /Users/…/d46-over-10mib.md size=10485761") on every path (url_param, drop, dialog, recent, cold). The frontend `file.open.url_param` line is basename-only as specified. The toast never shows a path.
3. **The ⌘O dialog path logs no `file.open.report`** (M-6: only `file.open start {source:dialog}` and the Rust `file.open fail`), whereas url_param, drop, Open Recent and cold-launch all log `file.open.report fail {reason:FileTooLarge}`. The toast still appeared exactly once.
   - Expected: ⌘O reports through its own catch (D46 row).
4. **The D31 `ui.menu.focus_check` count is 0 lines of *any* status**, so "0 fail" can't tell "no failure" from "event never emitted" in this build.
   - `ui.menu.focus_check` is only emitted on failure, so 0 lines is the pass condition.
5. **Open Recent lists `wi04-surfaces.md` twice** (two entries with the same basename, presumably different directories), which can't be told apart in the menu.
6. While the M-3 quit prompt stayed up (~2h47m), autosave drafted the unchanged 22-byte dirty Untitled doc every ~30 s (646 `file.write` lines). This is harmless log noise.
7. D43 side effects with the corrupt config: `window.open` warn `geometryReason:"read_failed"` (default geometry), and `preferences.set` **error** `ParseError` (a partial write refused, consistent with the bytes-unchanged expectation). `menu.recent_files.sync` logs a `fail`/warn line and then a `success` line for the same `seed` op.
8. M-1: the failed-open window shows an empty Source-mode editor surface (line number "1") while the tab bar has no tab. ⌘N then works normally.
9. M-5: opening the exactly-10 MiB file shows the informational toast "This document is too complex for WYSIWYG. Switched to Source mode for performance." (not a failure toast).
10. Harness issues, none affecting verdicts. (a) The first D31 typing pass sent keystrokes to Terminal, because an empty new WYSIWYG doc has no editor focus without a real click; it was redone with CGEvent clicks. (b) The first M-2 drag dropped onto another Finder window and moved `d46-over-10mib.md` into `dtrack/`; it was moved back (sha256 re-verified `2f7153…`) and the drag redone. (c) Finder AppleScript `open … using` was refused, as described in M-3.
11. After the D31 quit (the user discarded 4 test docs; the backstop logged `drafted`), the next launch's `file.draft.list` showed `listed:0`, so discarded docs left no recoverable drafts. This is consistent with Discard.
