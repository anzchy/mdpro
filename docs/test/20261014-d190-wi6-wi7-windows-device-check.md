# D190 WI-6 / WI-7：Windows 按键、菜单、标签与录制器，win-desktop 真机记录（2026-10-14）

执行方：mdpro-delegator 派出的子代理，从 MacBook 经 SSH 操作，用项目 skill `remote-windows-device-test`。brief：`docs/pending/20261014-brief-win-d190-wi6-wi7.md`（未提交），K1–K5 对应 WI-6，L1–L8 对应 WI-7。没有用 computer use，没有用 TeamViewer，没有在 Windows 端跑 Claude。时间均为 +0800。证据在 `docs/test/windows-audit-20261014-d190-wi6-wi7/`：窗口截图的裁切（菜单），`cdp.sh shot` 的页面视口截图（不含桌面），`menus.txt`（原生菜单树），`l2-shortcuts.txt`（设置 → 快捷键全文）。没有全屏截图进入证据目录。

**前提。** 开始时 `mdpro.sh status` 为 `tauri-app: 0`，mdpro 没有在运行，因此没有用户文档打开，`debug --yes` 不会关掉任何未保存内容。

## 0. 构建身份与前置检查

| 项 | 值 |
|---|---|
| 构建 | build-windows.yml run 38567925348，master `9845907`，artifact `mdpro-windows-0.3.2` |
| 安装包 | `mdpro_0.3.2_x64-setup.exe`，8046754 字节，SHA-256 `e169ae1cb0b96d03010be0d00b3aa328a29ff95d51cb13e26c2aa597af043fc3`（Mac 端 `shasum -a 256` 与 Windows 端 `Get-FileHash` 一致）。存为 `C:\Users\jack\mdpro-audit\mdpro_0.3.2_x64-setup-9845907.exe`，用 `base64 -b 76 -i <file> \| ssh win-desktop '$s = $input \| Out-String; …WriteAllBytes…'` 传输，29 s |
| Authenticode | `NotSigned` |
| 安装 | 安装前再查一次 `tauri-app` = 0 → `setup.exe /S /D=D:\programs\mdpro`，退出码 0（21:09:37–21:09:39），安装后 `tauri-app` = 0 |
| `tauri-app.exe` 安装前 | LastWriteTime `2026-10-14T12:07:56+08:00`，SHA-256 `66B7F346EE9DA5F52C991DF78CC8948075932A9A52B95D850603CAD980B39030`（与 W2 记录里 `0742ee3` 构建的哈希相同，即安装前机器上是 0742ee3 构建） |
| `tauri-app.exe` 安装后 | LastWriteTime `2026-10-14T21:05:42+08:00`（安装包内文件时间），SHA-256 `CE1EA7704A8C2EA00153EFEA341471166E293D11FF9DC76F232F131593311A04` |
| `app.ready` | `21:10:17.990 app.ready success {"appVersion": "0.3.2", "buildId": "unknown", "pid": 25852, "platform": "windows", "releaseId": "unknown", "startupTimeMs": 3691}`。brief 期望 `releaseId` 为 `0.3.2@9845907…`，实际为 `unknown`，原样记录；构建身份只能靠上面的安装包哈希和 exe 哈希确认 |
| About | Settings → About：`Version v0.3.2` |
| 窗口 | `mdpro.sh debug --yes` 后 `maximized`，`innerWidth` **1407**（`devicePixelRatio` 1.8），重启后 1423。不是 skill 写的约 1120：这台机器当前缩放不是 270 %。1407 远大于 960 的侧栏折叠阈值（#416），侧栏正常 |
| 输入法 | `Get-WinUserLanguageList`：zh-Hans-CN（微软拼音，前台线程 HKL `0x08040804`）、en-US（`00000409`）。**没有德语布局** |
| config 备份 | `%USERPROFILE%\.mdpro\config.json.d190wi67-before` |
| Fixture | `%WIN_DIR%\fx\d190wi67\basic.md`（标题、两个段落、两项列表、2×2 表格，102 字节），`push.sh` → `hash ok`。经 File → Open 打开（普通 `C:\…` 路径）：`21:14:59.553 file.open success {… "fileSizeBytes": 102, "source": "dialog"}`；打开时为 Source（`lastViewMode` = source），用 View → WYSIWYG 切到 WYSIWYG：`21:15:39.863 view.mode.change success {"fromMode": "source", … "toMode": "wysiwyg"}` |

## 1. 结论

| 行 | 项 | 结论 |
|---|---|---|
| K1 | 行内代码 Ctrl+Shift+` | 通过 |
| K2 | 删除线 Alt+Shift+5 | 通过（输入法未切换） |
| K3 | 标题 Ctrl+2 / Ctrl+4 | 通过 |
| K4 | 视图切换 Ctrl+/ ×2 | 通过 |
| K5 | View 菜单标签 | 通过 |
| L1 | 应用菜单无 macOS 项 | 通过 |
| L2 | 设置 → 快捷键标签 | 通过 |
| L3 | 录制器吃下 Ctrl+Shift+N | 通过（含同路线对照） |
| L4 | 录制器拒绝 Win 键 | 通过（Win+K 被系统截获、未到达应用；拒绝路径用 Win+Y 走到，见下） |
| L5 | 新建按钮提示与日志路径 | 通过 |
| L6 | 导出文件名 | 通过 |
| L7 | 草稿时间 | 通过（进程结束方式见偏差 1） |
| L8 | 德语布局 Ctrl+Shift+7 | 未验证（未安装德语布局） |

没有 Windows 不通过项。

## 2. 逐行证据

键盘行都用真键（`ui.sh chord`，keybd_event）。做法：先一次真点击（`clickat 846,233`）把 OS 键盘焦点放进编辑器（之后 `getSelection` 在第一段、`document.activeElement` 为 `ProseMirror-focused`），再用 CDP 设 DOM 选区（不移动 OS 焦点），然后 `chord … nofocus:true`。

- **K1 通过。** 选中 "bravo"（`getSelection().toString()` = `bravo`），真键 `ctrl+shift+backtick`。第一段变为 `alpha <code>bravo</code> charlie delta`：只有 code，没有 `<del>`。
- **K2 通过。** 选中 "charlie"，真键 `alt+shift+5`。第一段变为 `alpha <code>bravo</code> <del>charlie</del> delta`。**输入法没有切换**：桌面会话里的只读探针（`kl.ps1`，读前台窗口线程的 `GetKeyboardLayout`）在按键前 `21:17:53.881 fg=mdpro hkl=0x08040804`，按键后 `21:18:27.795 fg=mdpro hkl=0x08040804`。`HKCU:\Keyboard Layout\Toggle` 没有任何值（Windows 默认：单独按左 Alt+Shift 才切换语言；中间按了 5 就不触发）。
- **K3 通过。** 光标放在 "echo foxtrot golf" 第 3 个字符处。真键 `ctrl+2` 后标题列表 `["H1:basic","H2:echo foxtrot golf"]`，`.ProseMirror` 仍在、无 `.cm-editor`；真键 `ctrl+4` 后 `["H1:basic","H4:echo foxtrot golf"]`，仍是 WYSIWYG。这段时间的日志里没有任何 `view.mode.change`。
- **K4 通过。** 真键 `ctrl+slash` 两次：
  `21:20:34.739 ui.shortcut.trigger success {"action": "view.cycle", "shortcut": "Cmd+/"}` → `21:20:35.448 view.mode.change success {"fromMode": "wysiwyg", "intent": "user", "source": "cycleViewMode", "toMode": "source"}`（DOM：`.cm-editor` 出现）；
  `21:21:03.462 ui.shortcut.trigger success {"action": "view.cycle", …}` → `21:21:03.523 view.mode.change success {"fromMode": "source", … "toMode": "wysiwyg"}`（DOM：`.ProseMirror` 回来）。日志里的 `"shortcut": "Cmd+/"` 是内部存储名，不是界面文字。
- **K5 通过。** 真点击打开 View 菜单（`menuclick ["View"]`，同一次运行内截图后 Esc）：`Cycle View Mode  Ctrl+/`、`Source`、`✓ WYSIWYG`、`Toggle Sidebar  Ctrl+Shift+L`；Source / WYSIWYG 没有快捷键文字，没有 Ctrl+2 / Ctrl+4（`k5-view-menu.png`，`menus.txt` 同）。
- **L1 通过。** 真点击打开 mdpro 菜单：`About`、`Preferences...  Ctrl+,`、`Exit`、`Stop Waiting and Quit…`。没有 Services、Hide、Hide Others、Show All（`l1-app-menu.png`，`menus.txt` 同）。
- **L2 通过。** mdpro → Preferences...（真菜单点击，`21:23:09.981 ui.menu.select success {"controlId": "menu.file.preferences"}`）→ Keyboard Shortcuts。面板全文（`l2-shortcuts.txt`）116 行，`grep -E "Cmd|⌘|Option|⌥|⌃|⇧"` 无匹配。Source、WYSIWYG 均为 `Ctrl+/ (toggle)`，Cycle View Mode `Ctrl+/`，Strikethrough `Alt+Shift+5`，Code `Ctrl+Shift+\``（`l2-shortcuts-format-view.png`）。
- **L3 通过。** 点 Select Word 的值（滚到可见后点击，按钮文字变为 `Press keys...`），真键 `ctrl+shift+n`。结果：值变为 `Ctrl+Shift+N`，该行标为 `has-conflict`（与 New Window 冲突），出现 `Unsaved shortcut changes` 横幅；`windows` 只有主窗口；这段日志没有 `ui.shortcut.trigger`，没有 `window.create`，原生菜单加速键也没有触发。**同路线对照（同一次运行）**：第一次尝试时录制器没有进入录制状态（见操作失误 4），同一个真键 `ctrl+shift+n` 打开了新窗口：`21:25:17.592 ui.shortcut.trigger success {"action": "file.new_window", "shortcut": "Cmd+Shift+N"}` → `21:25:17.714 window.create success`。录制改动随后用横幅的 Discard 丢弃，Select Word 回到 `Ctrl+D`。
- **L4 通过（路线调整）。** 先在页面上加了一个只记录、不拦截的 capture 阶段 keydown/keyup 记录器，然后点 Select Line（`Press keys...`），真键 `win+k`。**Win+K 没有到达应用**：前台变为系统的 `快速设置`（投屏面板），页面记录器为空，录制器仍是 `Press keys...`；随后 Esc 关掉面板，录制取消，值仍是 `Ctrl+L`。Win+K 是 Windows 11 的系统保留键，应用不可能把它存成 Cmd+K。为了真正走到拒绝路径，补做 `win+y`（系统未占用）：页面收到 `{"k":"Meta","meta":true}`、`{"k":"y","meta":true}`，录制器仍是 `Press keys...`，没有存任何值（`recordedShortcut` 的 off-Mac `metaKey` 分支）。同路线对照是 L3（Ctrl 组合被录下）。真 Esc 取消录制，Select Line 仍为 `Ctrl+L`。
- **L5 通过。** 底栏新建按钮（`+`）的 `title` 为 `New Document (Ctrl+N)`（DOM 读取；`ui.ps1` 没有只移动鼠标的 op，所以没有截原生悬停提示）。Settings → Advanced：`Write structured logs to %USERPROFILE%\.mdpro\mdpro.log`（`l5-advanced.png`）。
- **L6 通过。** File → Export HTML...（`menuat`，见操作失误 4 之后的菜单句柄问题；坐标先在单独一次运行里截图取得，`l6-filemenu.png`）：`21:40:13.918 ui.menu.select success {"controlId": "menu.file.export_html"}`，`21:40:13.960 file.export_rendered start {"theme": "light", "title": "basic.md"}`。另存为对话框文件名 `basic.html`，保存类型 `HTML (*.html)`（`l6-export-filename.png`，只裁了文件名两行，侧栏有用户文件夹名，没有保留）。取消：`21:40:18.667 file.export_rendered cancel`。
- **L7 通过。** 底栏 `+` 新建 Untitled，输入 `L7 draft time probe`：`21:41:55.419 draft.write success {"bytes": 20, "documentId": "a3e82edb-…"}`。mdpro → Exit（`menuat`）：`app.quit.menu_exit success {"outcome": "requested", "windowCount": 1}`，`app.quit.check {"answer": "dirty", "dirtyCount": 2}`，页面弹出 `Unsaved changes / Quit without saving? / Keep editing / Discard changes`。没有点它，而是 mdpro → Stop Waiting and Quit…：`21:43:03.774 app.quit.escape success {"outcome": "fallback", …}` → `app.quit.fallback success {"answer": "quitWithoutSaving"}` → `app.quit.commit success {… "deleted": 0, …}` → `app.quit success`。Windows 上没有出现原生提示框，直接退出。之后 `tauri-app: 0`，`%APPDATA%\mdpro\drafts\` 里两个草稿都在。`mdpro.sh debug --yes` 重启：`21:43:54.698 file.draft.list success {"listed": 2}`，Recover drafts 对话框（`l7-recover-drafts.png`）：

  | 草稿 | 草稿文件里的 `lastModified`（UTC） | 对话框显示 |
  |---|---|---|
  | basic | `2026-10-14T13:41:00.283913100+00:00` | `2026/10/14 21:41:00` |
  | Untitled | `2026-10-14T13:42:55.403865900+00:00` | `2026/10/14 21:42:55` |

  页面 `navigator.language` = `zh-CN`，时区 `Asia/Shanghai`。显示的是本地时间（UTC+8），不是原始 ISO 串；9 位小数的时间串也解析成功。两个草稿都是本次创建的，随后各点 Discard：`file.draft.discard success {"deleted": true}` ×2，草稿目录为空。
- **L8 未验证。** 只装了 zh-Hans-CN 和 en-US，没有德语布局；按指示没有安装。

## 3. 操作失误与 harness 问题

1. **安装包第一次传输写了空文件。** macOS 的 `base64` 不接受位置参数，要 `-i <file>`；第一次 Windows 端写出 0 字节（`E3B0C442…`），立即用 `-i` 重传，哈希一致。
2. **第一次 File → Open 失败两次。** 第一次 `menuclick` 读到的 `Open...` 坐标是 `0,0`（下拉菜单还没展开），什么也没打开；第二次对话框 1.5 s 内还不是前台，`filedialog` 报 `file name box not found`；第三次单独 `filedialog` 成功。
3. **`sips -c` 居中裁切**（pitfall 20 已写），裁出了表格中部。删掉后改用 `ffmpeg crop` 从左上角裁。
4. **L3 第一次录制器没进入录制状态。** 按钮在设置面板滚动区之外，`__a.click` 按坐标点到了别处（返回值仍是 `Ctrl+D`，我没在按键前核对），于是真键 Ctrl+Shift+N 打开了一个空的新窗口。这次结果改作 L3 的对照。新窗口没有文档，在它自己的页面里调用 Tauri 的 `plugin:window|close` 关闭，走了应用正常的关闭流程：`window.close_requested success {"action": "no_unsaved_closing"}`。之后主窗口 `menuinfo` 为 `count=-1`（pitfall 10），后面的菜单改用 `menuat`；重启后句柄恢复（`count=8`）。之后所有设置面板点击都先 `scrollIntoView` 并用 `elementFromPoint` 核对命中。
5. 横幅的 Discard 也因为不在视口内第一次没点中，同样处理后成功。
6. **`MDPRO_WIN_OUT` 没有每次都导出**，`log.sh` 的 mark 文件在两个目录间错开，一次 `since` 打印了过旧的区间。没有结论依赖那次输出。
7. **一张临时全屏截图。** 为定位新窗口拍了一张，拉回后在 PC 和 Mac 两端立即删除，只看过从中裁出的新窗口区域，没有进入证据目录。另存为对话框的未裁原图（侧栏有用户文件夹名）也已两端删除。
8. **CDP 挂起约 4 分钟。** Win+K / Esc 之后 `/json/list` 一直失败（`/json/version` 正常，应用照常写草稿），按 pitfall 18 排查后自行恢复，返回同一个页面 id。
9. **坐标空间在运行之间变化。** 头几次 `ui.sh` 报主窗口 `rect=-8,-8,2548,1138`、菜单栏 y = 32；之后报 `-11,-11,3862,2110`、菜单栏 y = 48（比例 1.5）。看起来是计划任务进程的 DPI 虚拟化不一致。`menuclick` 自己取坐标不受影响；`clickat` / `menuat` 的坐标必须在同一种空间里重新取，新窗口的关闭按钮因此没有用点击关闭。

## 4. 偏差与说明

1. **L7 的进程结束方式。** brief 写「kill the process」。skill 没有规定 kill 方法；pitfalls #15 写的是 Exit 之后重启会出现 Recover drafts。这个构建的 Exit 走 quit guard（ADR-0090），确认提示会丢弃并删除草稿，所以用了应用自己的 Stop Waiting and Quit…（ADR-0036 / ADR-0090：Quit Without Saving，不删草稿）。没有用 `Stop-Process` 或任何强杀。L7 要验证的是重启后对话框的时间显示，这条路线走到了它（`file.draft.list listed 2` 和对话框）。
2. **L4 用 Win+Y 补做**，原因见 L4。Win+K 本身在 Windows 11 上永远到不了应用。
3. **`releaseId` 为 `unknown`**，不是 brief 写的 `0.3.2@9845907…`。
4. **innerWidth 1407，不是约 1120**：显示缩放已不是 skill 记录的 270 %（dpr 1.8）。窗口已最大化，侧栏未折叠。
5. **报告位置。** 按派发指示写在 `docs/test/`，没有另写 brief 里说的 `C:\Users\jack\mdpro-audit\20261014-d190-wi6-wi7-report.md`。
6. **附带观察（不在行内判定中）：**
   - 设置里 Image 显示 `Ctrl+I`，与 Italic 相同：默认值 `Cmd+Ctrl+I` 在 Windows 上合并成一个 Ctrl（`platformLabels.ts` 的设计）。该行没有被标 `has-conflict`，因为存储值不同。
   - 打开 Settings → About 会自动检查更新：`ui.about.update_check success {"hasUpdate": false}`。
   - Exit 在 Windows 上确实走 quit guard（`app.quit.menu_exit` → 提示），Stop Waiting and Quit… 在提示期间直接退出、不出原生框（`app.quit.fallback quitWithoutSaving`）。

## 5. 收尾与 config diff

- 草稿：两个都 Discard，`%APPDATA%\mdpro\drafts\` 为空；最后一次启动 `file.draft.list listed 0`。
- 快捷键：L3 的改动用 Discard 丢弃，L4 没有存值；Select Word `Ctrl+D`、Select Line `Ctrl+L`，没有点过 Save。字体、主题都没有动。
- `lastViewMode`：本次改成了 wysiwyg，已用 View → Source 改回 `source`。
- fixture `basic.md` 没有保存过，磁盘哈希与上传时相同。
- `mdpro.sh normal --yes`：`port 9222 closed`，`maximized`，`tauri-app: 1`，`21:47:03.370 app.ready success {"appVersion": "0.3.2", … "releaseId": "unknown"}`。`mdpro.sh cleanup` 后计划任务 `mdpro-audit-*` 为 0。
- `Compare-Object config.json config.json.d190wi67-before`（`=>` 为备份侧，`<=` 为当前侧）：

```
    "C:\\Users\\jack\\mdpro-audit\\fx\\d190\\w5 test.md",   =>
    "C:\\Users\\jack\\mdpro-audit\\fx\\d190\\w4.md"         =>
    "width": 2532,                                          =>
    "height": 1079,                                         =>
    "x": -8,                                                =>
    "y": -8,                                                =>
    "C:\\Users\\jack\\mdpro-audit\\fx\\d190wi67\\basic.md", <=
    "C:\\Users\\jack\\mdpro-audit\\fx\\d190\\w5 test.md"    <=
    "width": 2560,                                          <=
    "height": 1349,                                         <=
    "x": -7,                                                <=
    "y": -7,                                                <=
```

  只剩 `recentFiles`（basic.md 进了列表，挤掉末尾的 w4.md，都是 fixture）和主窗口保存的几何（关窗时应用自己写的）。没有手动还原，理由同 W2 记录；备份留在 PC 上。

## 6. 留在 win-desktop 上的东西

- mdpro `9845907` 构建装在 `D:\programs\mdpro`，normal 模式运行，最大化，没有 DevTools 端口，没有打开文档（启动时 Source 模式、空白）。
- `C:\Users\jack\mdpro-audit\`：安装包 `mdpro_0.3.2_x64-setup-9845907.exe`（7.7 MB）；`fx\d190wi67\basic.md`（未改）；只读探针 `kl.ps1` 和它的输出 `out\kl.txt`；本次的窗口截图副本 `k5-view-menu.png`、`l1-app-menu.png`、`l6-filemenu.png`、`s67-a.png`、`s67-hang.png` 和页面截图 `l2-shortcuts-format-view.png`、`l5-advanced.png`、`l7-recover-drafts.png`。没有全屏截图。删除文件夹属于 rule 25 操作，没有做。
- `%USERPROFILE%\.mdpro\config.json.d190wi67-before`（备份）。
- 没有残留计划任务。任何 token 都没有读取或打印。
