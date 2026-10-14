# D190 W1 · W1b · W3 · W4 · W5：win-desktop 真机记录（2026-10-14）

执行方：mdpro-delegator 派出的子代理，从 MacBook 经 SSH 操作，用项目 skill `remote-windows-device-test`。brief 见 `docs/pending/20261014-brief-windows-d190-w1-w5.md`（未提交）。没有用 computer use，没有在 Mac 上点 GUI，也没有在 Windows 端跑 Claude。时间均为 +0800。证据放在 `docs/test/windows-audit-20261014-delegator/`：只有窗口截图（已裁剪，没有全屏截图）和 `menus.txt`。

**用户授权（brief 警告 1）。** delegator 于 2026-10-14 约 10:35 用 AskUserQuestion 问「Is anything unsaved in mdpro on win-desktop right now?」，用户答：「Nothing unsaved, go ahead」。该授权只覆盖本批次的安装和重启。W4 里每次退出时，打开的都只是 fixture 文档。

## 0. 构建身份与前置检查

| 项 | 值 |
|---|---|
| 构建 | GitHub Actions run 38501024081（build-windows.yml，`master`），`headSha` `c53c05e760debb5361048f9e8004d54d385b3951`，conclusion success |
| 安装包 | artifact `mdpro-windows-0.3.1` → `mdpro_0.3.1_x64-setup.exe`，8051373 字节，SHA-256 `2cae195daaeee8e6e84f44211d6bc5a9c652345e0f8ec7e25c41a187a6fdaba4`（Mac 端与 Windows 端 `Get-FileHash` 一致）。存为 `C:\Users\jack\mdpro-audit\mdpro_0.3.1_x64-setup-c53c05e.exe` |
| Authenticode | `Get-AuthenticodeSignature` → `NotSigned`（见 NOTE 1） |
| 安装 | 先用 `close.ps1` 发 WM_CLOSE 关掉 mdpro（进程数 → 0），然后 `setup.exe /S /D=D:\programs\mdpro`，退出码 0，就地覆盖 0.3.1 |
| `tauri-app.exe` LastWriteTime | 安装前 `2026-10-11T20:20:00+08:00` → 安装后 `2026-10-14T10:38:42+08:00`；SHA-256 `4923BAA0…72F858` |
| `app.ready` | `{"appVersion": "0.3.1", "buildId": "unknown", "pid": 51060, "platform": "windows", "releaseId": "unknown", "startupTimeMs": 1908}`（brief 已预期 buildId 为 unknown） |
| logging | `{"enabled":true,"level":"info"}`；`mcp.serverEnabled` 为 `true` |
| 窗口 | 每次启动后都执行了 `max`，`innerWidth` 1120，`tauri-app: 1` |
| config 备份 | `%USERPROFILE%\.mdpro\config.json.d190-before` |
| Fixtures | `%WIN_DIR%\fx\d190\`：w1.md、w3.md、w4.md、`w5 test.md`、assets\x.png，每个文件上传后都报 `hash ok` |
| 菜单（`menus.txt`） | mdpro 菜单最后两项是 `Exit`、`Stop Waiting and Quit…`，都不带加速键；File → `New Window | Ctrl+Shift+N`；其余项都标 `Ctrl+…` |

## 1. 结论

| 项 | 结论 | 证据行（`log.sh since`，原文） | 对照 | 截图 |
|---|---|---|---|---|
| W1 对照 `ctrl+b` | 通过（对照） | 没有日志行（编辑器 keymap）；DOM 出现 `strong` = `alpha hl beta`，再按 `ctrl+b` 后消失 | — | — |
| W1 `ctrl+shift+h` | 通过 | `11:20:22.913 ui.shortcut.trigger success {"action": "format.highlight", "shortcut": "Cmd+Shift+H"}`；出现 `mark` = `alpha hl beta` | ctrl+b 通过 | — |
| W1 `ctrl+s` | 通过 | `11:20:55.562 ui.shortcut.trigger success {"action": "file.save", "shortcut": "Cmd+S"}` · `11:20:55.572 file.save success {"filePath": "C:\\…\\d190\\w1.md", "fileSizeBytes": 24}`；W2 提示框 → Ignore | 同上 | — |
| W1 `ctrl+shift+l` | 通过 | `11:21:44.870 ui.shortcut.trigger success {"action": "view.toggle_sidebar", …}`（`.sidebar` 消失）；`11:22:19.091` 再按一次，侧栏恢复，宽 220 | 同上 | — |
| W1 `ctrl+slash` | 通过 | `11:22:53.561 ui.shortcut.trigger success {"action": "view.cycle", "shortcut": "Cmd+/"}` · `view.mode.change success {"fromMode": "wysiwyg", … "toMode": "source"}`；再按一次切回 | 同上 | — |
| W1 `ctrl+comma` | 通过 | `11:23:44.610 ui.shortcut.trigger success {"action": "file.preferences", "shortcut": "Cmd+,"}`；Settings 对话框打开，按 `esc` 关闭，没有改任何设置 | 同上 | — |
| W1 `ctrl+n` | 通过 | `11:24:33.012 ui.shortcut.trigger success {"action": "file.new", "shortcut": "Cmd+N"}` · `tab.open success {… "filePath": null, "tabIndex": 1}`；当前标签为 Untitled | 同上 | — |
| W1 `ctrl+w` | 通过 | `11:25:05.951 ui.shortcut.trigger success {"action": "file.close", "shortcut": "Cmd+W"}` · `tab.close success {… "wasModified": false}` | 同上 | — |
| W1 `ctrl+o` | 通过 | `11:25:46.780 ui.shortcut.trigger success {"action": "file.open", "shortcut": "Cmd+O"}` · `file.open start {"source": "dialog"}` · `11:25:49.859 file.open cancel`（打开对话框，同一次运行里取消） | 同上 | — |
| W1 `ctrl+shift+e` | 通过 | `11:26:17.990 ui.shortcut.trigger success {"action": "file.export_html", "shortcut": "Cmd+Shift+E"}` · `file.export_rendered start` · `11:26:20.905 file.export_rendered cancel`（另存为对话框，取消） | 同上 | — |
| W1 `ctrl+alt+t` | 通过 | `11:26:48.120 ui.shortcut.trigger success {"action": "paragraph.table", "shortcut": "Cmd+Option+T"}` · `ui.table-modal.open`；点 Insert → `ui.table-modal.submit success {"cols": 3, "rows": 3}`，插入了表格 | 同上 | — |
| W1 `ctrl+alt+up` | 通过 | `11:28:08.289 ui.shortcut.trigger success {"action": "editor.table.insert_row_before", "shortcut": "Cmd+Option+Up"}`；`tr` 3 → 4，按 `ctrl+z` 后回到 3 | 同上 | — |
| W1 AltGr 防护 | 通过 | 合成 `{key:"t",ctrlKey,altKey,modifierAltGraph:true}` 后，`log.sh since 'ui.shortcut'` **没有输出**。前置检查：合成事件的 `getModifierState("AltGraph")` 为 `true`，说明守卫确实被走到 | 同一路径（页面合成）、同一次运行，去掉 AltGraph 再发：`11:29:21.443 ui.shortcut.trigger success {"action": "paragraph.table", …}`（随后 Cancel 关闭弹窗） | — |
| W1 Win 防护 | 通过 | 合成 `{key:"s",metaKey:true}`，与上一条同一次 eval：没有 `ui.shortcut` 行 | 同上 | — |
| W1b `ctrl+shift+n` | 通过 | `11:29:54.679 ui.shortcut.trigger success {"action": "file.new_window", "shortcut": "Cmd+Shift+N"}` · `11:29:54.701 window.create success {"filePath": null, "geometry": "default", … "windowId": "mdpro-4da328a4-…"}`；`ui.sh windows` 列出 **2** 个窗口 | W1 的 ctrl+b（本次运行） | `w1b-second-window.png` |
| W1b 事实 | — | (a) `menus.txt`：`New Window | Ctrl+Shift+N`。(b) **没有** `ui.menu.select menu.file.new_window`，一次按键只开了一个窗口，原生加速键没有同时触发（W1 的每一行也都没有 `ui.menu.select`）。第二个窗口用它自己的 Window → Close 关掉（`window.close_requested success {"action": "no_unsaved_closing"}`），之后执行 `mdpro.sh debug --yes` 重启，再做 W3 | — | — |
| W3-A（File → Open） | 通过 | `11:40:08.609 file.open success {"encoding": "UTF-8", "filePath": "C:\\…\\d190\\w3.md", "fileSizeBytes": 27, "source": "dialog"}`；DOM：`src` `http://asset.localhost/C%3A%2FUsers%2Fjack%2Fmdpro-audit%2Ffx%2Fd190%2Fassets%2Fx.png`，`complete` true，`naturalWidth` 64，`__v` = `[]`（没有 img-src 违规） | data: URL 的同一张 PNG 用 `new Image()` 加载：`{loaded:true,w:64}`；对该 asset URL 跑 `cspProbe`：`{loaded:true,width:64,violations:[]}`（见操作失误 3） | `w3-a.png`（显示 64×64 红色方块） |
| W3-B（single-instance） | 通过 | `11:43:58.561 file.open.external start {"filePaths": ["C:\\…\\d190\\w3.md"], "source": "single_instance"}` · `11:43:58.896 file.open success {… "fileSizeBytes": 27}`；DOM 中的 `src` 与 A 相同，`naturalWidth` 64，`__v` = `[]`。先关掉了 A 的标签 | 同上 | `w3-b.png` |
| W4a 菜单 | 通过 | `menus.txt`：`Exit`，紧接着是 `Stop Waiting and Quit…`，两者都没有加速键；Stop Waiting 没有点 | — | — |
| W4b 取消 | 通过 | `11:47:02.396 app.quit.menu_exit success {"outcome": "requested", "windowCount": 1}` · `app.quit.request start` · `app.quit.check success {"answer": "dirty", "dirtyCount": 1, … "phase": "check"}` · `app.quit.prompt start` · `11:47:37.943 ui.dialog.cancel success {"controlId": "dialog.quit.cancel", …}` · `11:47:37.950 app.quit.cancel cancel {"reason": "cancelled", "requestId": 1}`。对话框为 `Unsaved changes / Quit without saving? / Keep editing / Discard changes`；进程仍在（`tauri-app: 1`），文本仍是 `quit guard dirty` | `srv` → True True | `w4b-prompt.png` |
| W4c Escape（事实） | 应用没有退出 | `11:48:48.068 ui.dialog.escape success {"dialog": "confirm", "outcome": "cancel"}` · `app.quit.cancel cancel {"reason": "cancelled", "requestId": 2}`；`tauri-app: 1`。Escape 等同取消，与代码一致，不是发现项 | 同上 | — |
| W4d 放弃修改 | 通过 | `11:49:56.600 app.quit.answer success {"answer": "discard", "idCount": 1}` · `app.quit.recheck start` · `app.quit.backstop success {"draftedCount": 0, …}` · `11:49:56.609 app.quit.commit success {"backstop": true, … "deleted": 1, …}` · `11:49:56.613 app.quit success {}` · `11:49:56.637 mcp.http_server.stop success {"outcome": "stopped"}`；`tauri-app: 0`；`srv` → False False。重启后 `file.draft.list success {… "listed": 0 …}`，没有出现 Recover drafts | `srv` 在 Exit 前为 True True | — |
| W4e 干净退出 | 通过 | File → Save（`ui.menu.select menu.file.save` · `file.save success`，W2 → Ignore），然后 Exit：`11:53:43.285 app.quit.menu_exit success` · `app.quit.check success {"answer": "clean", "dirtyCount": 0 …}` · `app.quit.commit success {… "deleted": 0 …}` · `app.quit success {}` · `mcp.http_server.stop success`；没有提示框，`tauri-app: 0`，`srv` → False False | 同上 | — |
| W4f 关闭最后一个窗口 | 通过 | WM_CLOSE（`close.ps1`）：`11:55:47.866 window.close_requested success {"action": "no_unsaved_closing"}` · `11:55:47.946 app.quit success {}` · `11:55:47.948 mcp.http_server.stop success {"outcome": "stopped"}`；没有 `app.quit.commit`（符合预期）；`tauri-app: 0`，`srv` → False False | `srv` 为 True True | — |
| W5a 已运行的应用 | 通过 | `11:58:34.592 file.open.external start {"filePaths": ["C:\\Users\\jack\\mdpro-audit\\fx\\d190\\w5 test.md"], "source": "single_instance"}` · `11:58:34.593 file.open.external success {"filePath": "C:\\Users\\jack\\mdpro-audit\\fx\\d190\\w5 test.md", "source": "single_instance"}`；`act` → name `w5 test.md`，title `C:\Users\jack\mdpro-audit\fx\d190\w5 test.md`；没有 `\\?\` | File → Open 同一文件：标签 `w5 test.md`，title 为普通 `C:\…`（先做对照，再关掉该标签） | `w5-tab.png` |
| W5b 首次启动 | 通过 | 先经 Exit 干净退出（`tauri-app: 0`，`srv` False False），再 `ui.sh open`：`12:00:10.495 file.open.cli success {"filePaths": ["C:\\Users\\jack\\mdpro-audit\\fx\\d190\\w5 test.md"], "source": "cli"}` · `12:00:10.789 file.open success {… "w5 test.md", "fileSizeBytes": 15}`；截图里标签名为 `w5 test.md` | 同 5a | `w5-first-tabstrip.png`（只裁了标签栏） |

汇总：W1（12 个快捷键 + 2 个防护）、W1b、W3-A/B、W4a/b/d/e/f、W5a/b 均**通过**；W4c 记为事实（Escape = 取消）。没有 Windows 不通过项，也没有未验证项。

## 2. 收尾与 config diff

- 执行 `mdpro.sh normal --yes`：`tauri-app: 1`，没有 DevTools 端口（`port 9222 closed`），已最大化。`file.draft.list success {"listed": 0 …}`，没有要放弃的草稿。`mdpro.sh cleanup` 后没有残留的计划任务。
- `Compare-Object config.json config.json.d190-before` **不为空**。第一次比较时：
  - `lastViewMode`：备份为 `"source"`，当前为 `"wysiwyg"`。本次运行为了做 W1 用 View → WYSIWYG 切过视图，收尾时已用 View → Source 切回，重新读取为 `source`。
  - `recentFiles`：多了 4 个 d190 fixture（w5 test.md、w4.md、w3.md、w1.md），挤掉了列表末尾的 4 条旧记录：`\\?\C:\…\fx\work1.md`、`\\?\C:\…\fx\utf16.md`、`D:\mac-app\mdpro\docs\windows-audit-fixture-20261012.md`、`D:\mac-app\mdpro\docs\test\windows-audit-20261012\utf16le.md`。`work16.md` 只是位置变了。
  - `windowStates`：多了 `…\d190\w5 test.md` 和 `…\d190\w1.md` 两项（x -7、y -7、2016×1175）。
  - 切回视图后还剩 27 行差异，都是应用自己维护的 recentFiles 和 windowStates，Settings 里的项一项没变。这些没有手动还原：mdpro 运行时去编辑它的 config 有风险，而且这属于应用的正常写入。备份 `config.json.d190-before` 还留在 PC 上，可以用来还原。

## 3. 操作失误与 harness 问题

1. **brief 里的路径写法会产生非法 JSON。** `'$FXW'\\w1.md` 把单反斜杠的 `C:\Users\…` 直接拼进 `ui.sh` 的 JSON 步骤，`ui.ps1` 解析失败，没有写出 `ui-out.json`，结果报 `TIMEOUT: no ui-out.json after 90 s`，前后 3 次。改用 `FXJ='C:\\Users\\jack\\mdpro-audit\\fx\\d190'` 后正常。这几次失败的运行都没有执行任何步骤，第一个 Open 对话框是在下一次运行里填好的。
2. **`shot` 的 `out` 用相对路径会报 GDI+ 错误**（计划任务的工作目录不可写），要用 `C:\Users\jack\mdpro-audit\out\…` 这样的绝对路径，再用 `pull.sh` 取回。
3. **`__a.cspProbe` 会在 URL 后面追加 `?probe=…`**，data: URL 因此被破坏，返回 `{loaded:false, violations:[]}`。这是 harness 的问题，不是应用的问题。W3 的对照改为：同一页面用 `new Image()` 加载这张 PNG 的 data: URL，以及对该 asset URL 跑 `cspProbe`，两者都加载成功。
4. **`menuclick` 与 `filedialog` 放在同一次运行里时，有一次因为打开对话框出现得慢而失败**（`file name box not found`），把 `filedialog` 单独放到下一次运行就好了。`filedialog` 不是菜单，拆开不违反警告 5。
5. **W1b 之后第一次 `mdpro.sh debug --yes` 拒绝重启**（"mdpro did not close"）。窗口在 11:33:04 销毁，`app.quit` 到 11:33:10 才出现（约 6 s，超过脚本 10 s 的等待窗口），随后进程退出，再执行一次就成功了。其他几次退出都在 0.1 s 内完成，只有这次（前面关过第二个窗口）慢。见 NOTE 3。
6. **安装包传输**：用 `[Console]::In.ReadToEnd()` 的 ssh 管道卡住了 15 分钟以上（远端没有收到 stdin EOF），已终止本地 ssh。改用 `base64 -b 76 | ssh '… $input | Out-String …'`，52 s 传完，哈希一致。
7. 报告路径按 delegator 的指示定为 `docs/test/20261014-d190-w1-w5-windows-device-check.md`，不是 brief 写的 `20261014-windows-d190-w1-w5.md`。

## 4. NOTE

1. 安装包 Authenticode 状态为 `NotSigned`。brief 说的「signed NSIS installer since #426」应该指 updater 签名（`1ee5176` 传入的是 updater signing key），不是代码签名证书。这次静默安装没有触发 SmartScreen。
2. 每次 **File → Open 和 single-instance 打开**（不只是保存后）都会立刻弹出 "External change detected"：`file.change.pending {"source": "open-check"}`，`file.watch.register {"baseline": "failopen", "seedCheck": "failopen_seed"}`，接着 `file.change.decision {"action": "reload-prompt"}`。这和 W2 同一族，按指示每次都点 Ignore，不作为发现项，供 W2 修复时参考。
3. 关掉第二个窗口后，主窗口的退出要慢约 6 s（见失误 5）。只观察到一次，没有复现。
4. Insert Table 弹窗在 Windows 上显示 `⌘⌥T`（属于 W7 的 Mac 专用 chrome，已知）。
5. 关掉第二个窗口之后，`ctrl+s` 仍然可用（`11:32:04.017 ui.shortcut.trigger … file.save`）。

## 5. 留在 win-desktop 上的东西

- mdpro 0.3.1（`c53c05e` 构建）已装在 `D:\programs\mdpro`，以 normal 模式运行，没有 DevTools 端口，没有打开文档，处于 Source 视图。
- `C:\Users\jack\mdpro-audit\`：安装包 `mdpro_0.3.1_x64-setup-c53c05e.exe`（7.7 MB）、`fx\d190\`（4 个 md 和 `assets\x.png`）、本次 `cdp.sh shot` 留下的副本 `w3-a.png`、`w3-b.png`、`w4b-prompt.png`、`w5-tab.png`。本次 `out\` 下的两张截图已删除。删除整个文件夹属于 rule 25 操作，没有做。
- `%USERPROFILE%\.mdpro\config.json.d190-before`（备份）。
- server.token 只用 `Test-Path` 检查过，没有读过内容。
