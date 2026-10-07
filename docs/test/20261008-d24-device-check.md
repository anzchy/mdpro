# D24 真机复测记录：第 6 步与 GA-12（2026-10-07 跑，2026-10-08 入库）

本轮在 Mac mini 上用 `fix/dtrack-batch` 的 `987407c`（D24 Part B）release 构建，把 `tests/manual-fixtures/d24-step6-last-view-mode.md` 的 M-1…M-6 跑了一遍：M-1…M-5 通过，M-6 第 1、2 步通过，M-6 第 3 步按简报 NOT RUN。M-5 就是 ADR-0032 GA-12 的真机判据，用的是用户 2026-10-07 接受的新措辞。同一会话还在另一个构建上跑了 D48，那部分属于 `frontend-backend-redesign`，不在本记录里。下面 §「测试报告原文」只收 mini 报告的 D24 部分，原样收录（英文）；排序文档 D24 行、ledger、CHANGELOG 按本记录改写。

## 0. 测量条件

| 项 | 值 |
|---|---|
| 日期 | 2026-10-07（22:45 至 22:51 左右） |
| 机器 | Mac mini |
| 执行方 | 控制台上 Terminal.app 里的 Claude 会话，经 System Events 与 CGEvent 驱动 app |
| 被测构建 | release v0.3.0，分支 `fix/dtrack-batch` 的 `987407c`（`987407cae9e25da810f69f7a4a25e8448dafff3b`），bundle 与 `Contents/MacOS/tauri-app` 的 mtime 均为 2026-10-07 22:39:58；运行中的二进制由 `ps` 确认是这个 bundle |
| 被测代码 | 第 6 步 Part A 在 `e87cbc4`（[ADR-0053](../adr/0053-only-explicit-view-mode-commands-persist-last-view-mode.md)）；Part B 的 `preferences.read` / `window.apply_state` 日志在 `987407c`。两者都在被测构建里 |
| 夹具 | `git show 987407c:tests/manual-fixtures/d24-step6-last-view-mode.md`；文档用副本 `small.md`、`small2.md`，大文档 `big.md` = `seq 1 30000 \| sed 's/^/Line /'`（318 894 B） |
| 证据存放 | 截图在 mini 的 `~/.mdpro-redesign/dtrack/reports/shots/d24-*`，**不入库** |
| 配置 | 跑前备份 `~/.mdpro/config.json`，D24 块结束后按字节还原，`cmp` 相等；还原后 `lastViewMode`、`defaultViewMode` 均为 `wysiwyg`，日志开着 |

**构建之后的提交**：`987407c` 之后本分支只有 `dd5a312`（D25，改 `src-tauri/src/services/logger.rs`、`logger_corrupt_config_tests.rs`、`IntegrationsSettings.tsx`、`McpServerStatus.tsx`）与 `2517852`（文档）。D24 涉及的视图模式与偏好读取代码、以及夹具，在 `987407c` 与 `2517852` 之间没有改动（`git diff --stat 987407c 2517852 -- src/ src-tauri/src tests/manual-fixtures/` 只列出上面四个文件）。

## 1. 复核

协调方核对过：被测构建是 `987407c` 的 release 包，第 6 步代码是 `e87cbc4`，以及下表各项结论。本记录没有另行重读 mini 的 `~/.mdpro/mdpro.log`，下文引用的日志行、偏移量与时间戳都出自 mini 报告原文。

## 2. 逐项结论

| 判据 | 结果 | 要点（证据见 §4 原文） |
|---|---|---|
| M-1 显式命令各写一次 | **通过** | ⌃2、⌃4、再按 ⌃4、View → Cycle View Mode、源码编辑器里 ⌘/：`view.mode.change` 4 条，全是 `intent:"user"`；`preferences.set` 4 对 start/success；第 3 步只记 `ui.menu.select`，不切换、不写。盘上依次 `source`、`wysiwyg`、`wysiwyg`、`source`、`wysiwyg` |
| M-2 大文档降级不写盘 | **通过** | 对照组 ⌘O `small2.md` 得 K = 1；⌘O `big.md`：恰一条 `editor.large_document.degrade`（`trigger:"structure"`、`elements:30000`）、恰一条 `wysiwyg→source` `intent:"programmatic"`，`preferences.set` success = 1 = K，盘上仍 `wysiwyg`。提示条在 M-4 第 2 步同一路径上截到 |
| M-3 拖放、Finder 打开、`?open=` 不写盘 | **通过**（第 2 步开进了新窗口，已记录） | 拖放：一条 `source→wysiwyg` programmatic，盘上 `source` 不变。第 2 步关最后一个文档时 `view_mode_restore_on_close` 读一次并以 programmatic 套回 `source`；随后 `open -a` 按 `file.open.route outcome:"new-window"` 开进新窗口，不是空着的 `main`，所以这一步只有 1 条 `view.mode.change`（夹具预期 2 条，并写明开进新窗口时记录即可）。第 3 步 `?open=` 新窗口无 `view.mode.change`。三步都没有 `intent:"user"`，盘上始终 `source` |
| M-4 用户切换挺过降级与重启 | **通过** | 空窗口 ⌃4 写一次；⌘O `big.md` 降级只写最近文件；⌘Q 无提示退出；无文件重启后空窗口是 **WYSIWYG**，恰一条 `preferences.last_view_mode` `{"outcome":"settled","reason":"read_applied"}`；盘上始终 `wysiwyg` |
| M-5 冷启动读取计数（**ADR-0032 GA-12**） | **通过** | 无文档冷启动：`preferences.read` 恰为 `app_hydrate` 与 `view_mode_startup_settle` 两条，`window.apply_state` 恰一条 `{"monitor":"reported","outcome":"applied"}`。带文件冷启动：恰一条 `app_hydrate`，无 settle 读，`window.apply_state` 恰一条 `applied`。关掉最后一个文档：恰一条 `view_mode_restore_on_close`，无 `window.apply_state`。三种情形都没有 `failed` 读或 `skipped` 的 apply；全程没开设置 |
| M-6 第 1 步 `?open=` 副窗口 | **通过**（settle 读 0 次） | 一条 `app_hydrate`，0 条 `view_mode_startup_settle`（文档先于 settle 落地，`file.open.url_param success` 晚 hydrate 9 ms），一条 `window.apply_state` `{"outcome":"skipped","reason":"not_main"}`，没有 `applied` / `maximized`。本轮另三个 `?open=` 窗口（偏移 6009、6223、6286）同样如此 |
| M-6 第 2 步 ⌘⇧N（`main` 已有文档） | **通过** | 一条 `app_hydrate`、一条 `view_mode_startup_settle`、一条 `skipped` / `not_main` |
| M-6 第 3 步 `pnpm dev` 浏览器 | **NOT RUN** | 只走 browser 分支，由 `tests/preferences-tauri-detection.test.ts` 覆盖；没起 dev server。浏览器里视图切换能用、日志不落盘这一条**没有真机证据** |

**GA-12 的结论**：按 2026-10-07 改写后的判据（每个窗口一次 `app_hydrate`；`main` 一次 `window.apply_state`，副窗口那一条是 `skipped` / `not_main`；没有文档就 settle 的窗口另加一次 `view_mode_startup_settle`；带文件启动的窗口 hook 不读），M-5 的三种情形与 M-6 第 1、2 步全部吻合，GA-12 真机通过。

**本轮没有覆盖的 D24 判据**（不因本轮而关）：

- M-6 第 3 步（浏览器分支），见上表。
- 0032/GA-1 的首帧子项：开进新窗口的文件首帧就是存的模式、还是先闪一下再切，从 2026-09-27 起一直没测，本轮也没测。
- D-6（缩放系数为 1 的外接屏上的按文件几何还原）：2026-10-02 因为没有外接屏 NOT VERIFIED，本轮没碰。ledger「按文件记忆窗口几何」行仍记着这一条。
- M-3 第 2 步的「运行中 `open -a` 落进空窗口」这条子路径没有走到：路由按设计开了新窗口。夹具把这种情况列为可接受，盘上值也没变。

## 3. 报告 NOTE 的去向（只记录，不是修复）

报告末尾 7 条 NOTE 里，NOTE 1、2 是 D48 的事，不在此处理。其余：

1. **NOTE 4 / M-3 第 2 步开了新窗口**：`file.open.route outcome:"new-window", matchCount:0`。运行中的 `open -a` 一律经 `route_external_open`，没有命中已开窗口就开新窗口，这是 D29 的设计，不是缺陷。夹具 M-3 的预期「两条 programmatic」写的是落进空窗口的情形，下次改夹具时可以把「开新窗口 = 1 条」写成显式预期。
2. **NOTE 5 / `?open=` 窗口 settle 读 0 次**：本轮四个 `?open=` 窗口都是文档先到、hook 不读；⌘⇧N 的空窗口读 1 次。在改写后的 GA-12 判据允许的「0 或 1 次」之内（PRL-05）。
3. **NOTE 3 / `file.write` 草稿行带真实 `filePath`**：报告在同一会话的 D48 块（`5154220` 构建）里看到，脏文档自动保存期间的 `file.write {documentId, filePath:…/d48.md}` 不清除脏点、盘上文件也没变，所以是草稿 / 影子写入，不是保存。事件名叫 `file.write` 又带着文档的真实路径，读日志的人容易当成一次保存。这条与 D24 无关，只记录、暂不立项。
4. **NOTE 6 / 源码编辑器里的 ⌘/ 没有 `ui.shortcut.trigger`**：读代码可知，焦点在源码编辑器里时 ⌘/ 由 `src/components/Editor/Editor.tsx` 的 CodeMirror `Mod-/` 绑定直接调 `userViewModeCommands.cycle()`，`src/hooks/useKeyboardShortcuts.ts` 那条带 `logShortcut` 的分支有 `!inCodeMirror` 守卫，不会再跑。所以只有 `view.mode.change … source:"cycleViewMode"`，`intent:"user"` 照样记着。只是日志少一条，不是 D24 的失败。
5. **NOTE 7 / M-2 提示条一闪而过**：319 KB 的打开用了约 6 s，提示条只停几秒，单张截图会漏，连拍能截到。属于测量手段，不是缺陷。

## 4. 测试报告原文（只收 D24 部分）

以下摘自 mini 报告 `20261007-d24-d48-device-checks.md`，原样收录。只做了三处删节：摘要行删去 D48 部分；删去 Block 2（D48）、D48 的构建行与 D48 之后的配置比对；NOTE 只留 3–7（编号保持原样）。标题层级下调两级。

### Device checks D24 (step 6 + GA-12) — Mac mini, 2026-10-07 (round 2)

**Summary: D24 M-1…M-5 PASS, M-6 steps 1–2 PASS, M-6 step 3 NOT RUN (browser-only).**

Brief: `~/.mdpro-redesign/dtrack/brief-20261007-d24-d48.md`. Fixture: `git show 987407c:tests/manual-fixtures/d24-step6-last-view-mode.md`. Scratch: `~/.mdpro-redesign/dtrack/scratch/r2/` (`small.md`, `small2.md`, `big.md` = `seq 1 30000 | sed 's/^/Line /'`, 318,894 B; `d48.md`; `config.backup.json`). Screenshots: `~/.mdpro-redesign/dtrack/reports/shots/d24-*` and `d48-*`. All clicks and keys were sent through System Events and a CGEvent mouse helper. All offsets below are `wc -l < ~/.mdpro/mdpro.log` taken before the step, and only the lines after each offset were read. Before each block, `pgrep` showed no mdpro running, and `ps` showed the block's binary (`…/builds/987407c/mdpro.app/Contents/MacOS/tauri-app`, then `…/builds/5154220/…`).

Before starting: Default View Mode = `wysiwyg`, `logging.enabled = true`, disk `lastViewMode = wysiwyg`. Config backed up to `scratch/r2/config.backup.json` (`cmp` equal).

#### Block 1 — D24 on 987407c

| Check | Result | Observed / evidence |
|---|---|---|
| M-1 explicit commands write once each | **PASS** | Offset **6053**. `small.md` opened in WYSIWYG, disk `wysiwyg`. Disk after each step: ⌃2 `source`, ⌃4 `wysiwyg`, ⌃4 again `wysiwyg`, View → Cycle View Mode `source`, ⌘/ (cursor clicked into the Source editor) `wysiwyg`. `view.mode.change` = 4 lines, all `intent:"user"`: `{"fromMode":"wysiwyg","intent":"user","source":"setViewMode","toMode":"source"}` 22:45:37.446; `source→wysiwyg setViewMode` 22:45:39.783; `wysiwyg→source cycleViewMode` 22:45:48.904; `source→wysiwyg cycleViewMode` 22:46:01.204. `preferences.set` = 4 start/success pairs, one right after each change (e.g. 22:45:37.453 start, 22:45:37.462 success). Step 3 logged `ui.menu.select menu.view.set_mode wysiwyg` and nothing else (no view change, no write). Shots: `d24-m1-0-open.png`, `d24-m1-1-src.png`, `d24-m1-4-cycle.png`, `d24-m1-5-cmdslash.png` |
| M-2 large-document degrade does not write | **PASS** | Control at offset **6107**: ⌘O `small2.md` (dialog) → **K = 1** `preferences.set` success, no `view.mode.change`. Step 2 at offset **6128**: ⌘O `big.md`. `file.open success … big.md, fileSizeBytes 318894` 22:46:57.212; exactly one `{"event":"editor.large_document.degrade","status":"fail","context":{…"elements":30000,…"structureThreshold":25000,"trigger":"structure"}}` 22:46:57.221; exactly one `{"fromMode":"wysiwyg","intent":"programmatic","source":"setViewMode","toMode":"source"}`; `preferences.set` success = **1** (= K). Disk after: `wysiwyg`. The toast was gone before my screenshot here (`d24-m2-2-big.png` shows Source, no toast). I caught it on the same open path in M-4 step 2: "This document is too complex for WYSIWYG. Switched to Source mode for performance." (`d24-m4-2-big-toast.png`) |
| M-3 drop, Finder open and `?open=` do not write | **PASS** (step 2 opened a new window, recorded) | Setup: closed all 3 docs with ⌘W (offset 6152). Each `tab.close` has `wasModified:false`. The close of the last doc logged `preferences.read view_mode_restore_on_close` and then `view.mode.change source→wysiwyg programmatic`. Then I closed the empty secondary window with its red button (`no_unsaved_closing`). ⌃2 in empty `main` → disk `source` (one `intent:"user"` change, one write; this is setup). **Step 1** (offset **6197**): computer-use CGEvent drag of `small.md` from a Finder icon-view window onto the mdpro window worked. `file.open.drop start {"dropTarget":"window",…small.md}` → `success {"openedInNewWindow":false}`; one `{"fromMode":"source","intent":"programmatic","source":"setViewMode","toMode":"wysiwyg"}` 22:48:02.472; `preferences.set` success = 1 (recent files); disk `source`. Shot `d24-m3-1-drop.png`. **Step 2** (offset **6223**): ⌘W → `preferences.read view_mode_restore_on_close` + `{"fromMode":"wysiwyg","intent":"programmatic","source":"setViewMode","toMode":"source"}` 22:48:12.164. Then `open -a <987407c app> small2.md` **opened a new window** (`file.open.route outcome:"new-window"`, window `mdpro-ddb1f4d6…`), not the empty `main`. The new window opened directly in WYSIWYG and logged no `view.mode.change`. So this step has 1 `view.mode.change` line, not 2. `preferences.set` success = 1; disk `source`. **Step 3** (offset **6286**): `open -a … small.md` with a doc open → new window `mdpro-29794d22…`. No `view.mode.change`, `preferences.set` success = 1, disk `source`. No `intent:"user"` line in steps 1–3. Shots `d24-m3-2-open.png`, `d24-m3-3-open.png` |
| M-4 user switch survives degrade + relaunch | **PASS** | Step 1 (offset **6330**): clicked into `main` (empty; `window.focus main`). ⌃2: `main` was already in Source, so nothing was logged. ⌃4 → `{"fromMode":"source","intent":"user",…"toMode":"wysiwyg"}`, 1 write, disk `wysiwyg`. Step 2 (offset **6346**): ⌘O `big.md` → degrade `trigger:"structure"` 22:49:01.659, `wysiwyg→source programmatic`, 1 write (recent files), disk `wysiwyg`, toast shot `d24-m4-2-big-toast.png`. Step 3 (offset **6367**): ⌘Q with `big.md` open. Every window answered `clean`, `app.quit success` 22:49:31.581, no prompt. Disk `wysiwyg`. Step 4 (offset **6397**): `open -a <app>` with no file → the empty window is in **WYSIWYG** (`d24-m4-4-relaunch.png`). Exactly one `{"event":"preferences.last_view_mode","context":{"outcome":"settled","reason":"read_applied"}}` 22:49:42.543. Disk `wysiwyg` throughout |
| M-5 cold-start read counts (GA-12) | **PASS** | **Case 1, no document** (offset **6439**; quit first, then `open -a <app>`): `preferences.read` = exactly `{"outcome":"ok","purpose":"app_hydrate"}` 22:50:00.167 and `{"outcome":"ok","purpose":"view_mode_startup_settle"}` 22:50:00.483. `window.apply_state` = exactly one, `{"monitor":"reported","outcome":"applied"}` 22:50:00.173. **Case 2, launched with a file** (offset **6481**; `open -a <app> small.md` cold, routed through `app.launch_state.take count:1`): `preferences.read` = exactly `{"outcome":"ok","purpose":"app_hydrate"}` 22:50:18.510, with no `view_mode_startup_settle`. `window.apply_state` = exactly `{"monitor":"reported","outcome":"applied"}` 22:50:18.517. **Case 3, closing the last document** (offset **6528**; only `small.md` open in `main`, ⌘W): `preferences.read` = exactly `{"outcome":"ok","purpose":"view_mode_restore_on_close"}` 22:50:32.285. No `window.apply_state` line. No `failed` or `skipped` reads in any case. Settings was not opened. Shots `d24-m5-1-cold-empty.png`, `d24-m5-2-cold-file.png`, `d24-m5-3-close-last.png` |
| M-6 step 1: `?open=` secondary window | **PASS** (zero settle reads) | Offset **6562** (`small.md` in `main` via ⌘O, then `open -a … small2.md` → new window `mdpro-95ab8e84…`): one `{"outcome":"ok","purpose":"app_hydrate"}` 22:50:53.867. **Zero** `view_mode_startup_settle` reads, because the document landed first (`file.open.url_param success` 22:50:53.876). One `window.apply_state` `{"outcome":"skipped","reason":"not_main"}` 22:50:53.870, with no `applied`/`maximized` from it. The same pattern (app_hydrate only, zero settle, `skipped/not_main`) appeared on the other three `?open=` windows in this run (offsets 6009, 6223, 6286). Shot `d24-m6-1-open-param.png` |
| M-6 step 2: ⌘⇧N with a doc in `main` | **PASS** | Offset **6608** (`window.focus main`, `small.md` open there): `ui.menu.select menu.file.new_window windowLabel:"main"` 22:51:08.471 → `window.create` `mdpro-a68a13dc…`. Then one `{"outcome":"ok","purpose":"app_hydrate"}` 22:51:08.623, one `{"outcome":"ok","purpose":"view_mode_startup_settle"}` 22:51:08.943, and one `window.apply_state` `{"outcome":"skipped","reason":"not_main"}` 22:51:08.631. Shot `d24-m6-2-new-window.png` |
| M-6 step 3: `pnpm dev` in a browser | **NOT RUN** | Browser-only branch, covered by `tests/preferences-tauri-detection.test.ts`. No dev server was started |

D24 cleanup: ⌘Q first, so a quit-time preferences write could not land after the restore. All windows answered `clean` and there was no prompt. Pre-restore `cmp` differed (char 233, line 9), as expected after the run. Then `cp scratch/r2/config.backup.json ~/.mdpro/config.json`, and **`cmp` equal**. After the restore: `lastViewMode wysiwyg`, `defaultViewMode wysiwyg`, `logging.enabled true`.

#### Builds, config

| | SHA (`git rev-parse`) | Bundle mtime |
|---|---|---|
| D24 app `builds/987407c/mdpro.app` | `987407cae9e25da810f69f7a4a25e8448dafff3b` | Oct 7 22:39:58 2026 (bundle and `Contents/MacOS/tauri-app`) |

- **Config `cmp`**: after the D24 restore, `cmp ~/.mdpro/config.json scratch/r2/config.backup.json` → **equal**.

#### NOTEs (not fixes)

3. **Auto-save writes during a dirty session do not clear the dirty state.** `file.write {documentId:a4bc…, filePath:…/d48.md}` 7391 B appears at 22:52:04.863 and 22:53:34.858, but the tab stayed dirty and `d48.md` on disk never got `D48-dirty`. So those writes are draft/shadow writes, not saves. The event name `file.write`, carrying the real `filePath`, reads like a save in the log, so anyone judging these runs should not take it as one.
4. **M-3 step 2 opened a new window rather than the empty `main`** (`file.open.route outcome:"new-window", matchCount:0`), the case the fixture says to record. As a result only one programmatic `view.mode.change` appeared (the close), not two. The new window starts in WYSIWYG without logging a switch.
5. **M-6 step 1 race**: in all four `?open=` windows this session the document landed before the settle, so there were **zero** `view_mode_startup_settle` reads. The ⌘⇧N window (no document) had one.
6. ⌘/ (Cycle View Mode) changed the mode and logged `view.mode.change … source:"cycleViewMode"`, but no `ui.shortcut.trigger` or `ui.menu.select` line, unlike ⌃2/⌃4/menu clicks. This is only a logging gap, not a D24 failure.
7. The M-2 toast lasts only a few seconds and fires about 6 s after the ⌘O dialog closes (the 319 KB open took 22:46:50.994 → 22:46:57.212). A single screenshot can miss it, and a burst caught it.
