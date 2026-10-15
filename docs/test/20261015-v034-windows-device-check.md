# v0.3.4 Windows 真机检查，win-desktop（2026-10-15）

执行方：mdpro-codex-audit，从 MacBook 经 SSH 操作，用项目 skill `remote-windows-device-test`。delegator 转达的用户原话：「Windows device test还是需要做测试」；安装与重启的批准：「Nothing unsaved, go ahead (Recommended)」。没有用 computer use，没有用 TeamViewer。时间均为 +0800，08:23–12:35。

本次是 0.3.3 快捷键逐项记录（[`20261014-shortcuts-windows-device-check.md`](20261014-shortcuts-windows-device-check.md)，下称「0.3.3 记录」）在 0.3.4 上的重跑，路线、fixture 与结论用词相同；另加 delegator 指定的检查 2–8。

证据在 `docs/test/windows-audit-20261015-v034/`：
- `results-log.txt`：逐条运行记录（按键、日志行、DOM 读数），按运行脚本分段；
- `diffs.txt`：每组保存后的 `diff`，原样；
- `menus.txt`：原生菜单树；
- mdpro 窗口截图（`ui.sh shot`，只含 mdpro 窗口；`sb-restored-*.png` 已裁掉窗口外的桌面边）。

没有全屏截图进入证据目录，本次也没有拍过全屏截图。

## 0. 构建身份与前置

| 项 | 值 |
|---|---|
| 构建 | release run 38653861669（build-only），artifact `build-windows-x86_64`。run 的 headSha 显示 `e1dd914`，但 `inputs.ref` 是 `3b16610`，编译的是 `3b16610`（delegator 更正） |
| 安装包 | `mdpro_0.3.4_x64-setup.exe`，SHA-256 `7442c74f743957bc67a6dd84388dcfe795022e078006f8e4c158207841ac4bca`，7,057,549 字节，Mac 与 Windows 两端一致；存为 `C:\Users\jack\mdpro-audit\mdpro_0.3.4_x64-setup-3b16610.exe` |
| 安装 | `/S /D=D:\programs\mdpro`，退出码 0，ProductVersion 0.3.4，文件时间 07:37:58 |
| `app.ready` | 08:23:36，`releaseId` = `0.3.4@3b16610b9031db2f4530282c80c33952258c5fe5` |
| 窗口 | `mdpro.sh debug --yes` → pid 24380，`maximized`，`innerWidth` 1423 |
| 原样设置 | 主题 light（`themeMode` null），`defaultViewMode` wysiwyg，`lastViewMode` source，侧栏 220 px；`keyboardShortcuts` 58 键，与 0.3.3 运行开始时逐键相同 |
| 输入法 | English (US)：`08:24:36.126 fg=mdpro hkl=0x04090409`；全程未变（见 § 3 检查 9） |
| Fixture | 0.3.3 记录同一套 `base.md` / `w.md` / `s.md`，另加 `d204.md`、`d208.md`、`qg.md`、`urw.md`、`urs.md`；放在 `C:\Users\jack\mdpro-audit\fx\v034\` |

**路线。** 与 0.3.3 记录相同：每个按键都是真键（`ui.sh chord`，`clickat` 进编辑器后加 `nofocus:true`），CDP 只放光标、选区和读 DOM。

**结论用词。** 通过 / Windows 不通过 / 一致（无入口） / 未验证，含义同 0.3.3 记录 § 0。「与 0.3.3 同」指结论与证据形态都和 0.3.3 记录那一格一致。

## 1. 对照组（同一次运行）

| 行 | 路线 | 结论 | 证据 |
|---|---|---|---|
| CM-M | 菜单 | 通过 | `menuclick File›Save`：`08:30:49.110 ui.menu.select menu.file.save`，`file.save success` w.md（751 B） |
| CM-H | hook | 通过 | 即 F1 |
| CM-P | Milkdown | 通过 | 即 T1-W |
| CM-C | CodeMirror | 通过 | S 中 CTRL 行输入 `x` → `CTRL control linex`；Ctrl+Z 还原 |

## 2. 结论表（逐行对照 0.3.3）

### File（W）

| 行 | 条目 | 按键 | 0.3.4 | 证据 | 对 0.3.3 |
|---|---|---|---|---|---|
| F1 | New | Ctrl+N | 通过 | `08:31:14.721 file.new`，`tab.open` | 同 |
| F2 | New Window | Ctrl+Shift+N | 通过 | `08:35:16.066 file.new_window`，`window.create` success；窗口 B 用标题栏点击 + Alt+F4 关掉 | 同 |
| F3 | Open | Ctrl+O | 通过 | `08:33:29.092 file.open`，对话框取消 → `file.open cancel` | 同 |
| F4 | Save | Ctrl+S | 通过 | `08:32:35.994 file.save` success，752 B | 同 |
| F5 | Save As | Ctrl+Shift+S | 一致（无入口） | 无日志行，无对话框 | 同 |
| F6 | Close | Ctrl+W | 通过（第二次） | `08:32:05.697 file.close`，`tab.close wasModified false`。第一次没先点进编辑器，键丢了，见 § 4 偏差 1 | 同 |
| F7 | Preferences | Ctrl+, | 通过 | `08:34:27.318 file.preferences`；设置页 49 条，标签与 0.3.3 相同（Image `Ctrl+I`、Strikethrough `Alt+Shift+5`、Source / WYSIWYG `Ctrl+/ (toggle)`）；`settings.close` 关闭 | 同 |

### View

| 行 | 条目 | 按键 | 0.3.4 | 证据 | 对 0.3.3 |
|---|---|---|---|---|---|
| V1 | Source / Cycle，从 W | Ctrl+/ | 通过 | `08:37:55 view.cycle`，wysiwyg→source | 同 |
| V2 | WYSIWYG / Cycle，从 S | Ctrl+/ | 通过 | `08:39:14` source→wysiwyg | 同 |
| V3-W | Toggle Sidebar | Ctrl+Shift+L | 通过 | `08:36:28.256 toggle_sidebar`，220→0，再按恢复 220 | 同 |
| V3-S | Toggle Sidebar | Ctrl+Shift+L | 通过 | 0→220，选区仍为空，`cmsel` 0 | 同 |
| V5 | Toggle Fullscreen | Ctrl+Alt+F | 一致（无入口） | 无日志行，窗口矩形不变 | 同 |
| V6 | Switch Documents | Ctrl+` | 一致（无入口） | 两个标签，无 `tab.switch`，`s.md` 仍是 `bottom-tab--active` | 同 |

### Paragraph

| 行 | W | S | 对 0.3.3 |
|---|---|---|---|
| P1–P17 | 与 0.3.3 同（P10 打开 Insert Table：`08:47:27.527 paragraph.table`，`p10-table-modal.png`，取消） | 与 0.3.3 同；P1–P7 每按一次恰好一条 `ui.shortcut.trigger` | W 有一处不同：P16/P17 的列表标记保存后仍是 `-`，0.3.3 改写成 `*`。这是 D204 的修复，属预期改进 |

保存后 diff：`diffs.txt` 的 Paragraph 两段（W 08:48:20 785 B；S 08:56:03 777 B）。S 的 diff 与 0.3.3 `s.paraS2.md` 逐行相同。

### Format

| 行 | 条目 | 按键 | W | S | 对 0.3.3 |
|---|---|---|---|---|---|
| T1 | Bold | Ctrl+B | 通过：`**alpha**` | 一致（无入口） | 同 |
| T2 | Italic | Ctrl+I | 通过：`*bravo*` | 一致（无入口）：文件不变；CodeMirror 把选区扩到整行（`selectParentSyntax`） | 同 |
| T3 | Underline | Ctrl+U | 一致（无入口） | 一致（无入口）：文件不变，选区被撤回为空（CodeMirror `undoSelection`） | 同 |
| T4 | Code | Ctrl+Shift+` | 通过：`` `delta` `` | 一致（无入口） | 同 |
| T5 | Strikethrough | Alt+Shift+5 | 通过：`~~echo~~` | 一致（无入口） | 同 |
| T6 | Hyperlink | Ctrl+K | 通过：Insert Link 对话框（`t6-w-link-modal.png`），真键输入 `x.t`，Insert → `[foxtrot](https://x.t)` | 通过：`10:13:49.415 ui.shortcut.trigger format.hyperlink`，对话框（`t6-s-link-modal.png`），Cancel 关闭 | 同 |
| T7 | Image | Ctrl+I | **Windows 不通过**：执行的是 Italic → `*T7 image line*` | 一致（无入口） | 同（0.3.3 记录 § 3 第 1 条，仍在） |
| T8 | Clear Format | Ctrl+\ | 一致（无入口）：整行选中，`**golf**` 不变 | 一致（无入口）：整行选中，文件不变 | 同 |

保存后 diff：W 与 0.3.3 的 Format 段逐行相同；S 无 diff（`diffs.txt`）。

### Edit

| 行 | 条目 | 按键 | W | S | 对 0.3.3 |
|---|---|---|---|---|---|
| E1 | Copy As Markdown | Ctrl+Shift+C | 一致（无入口）：选中 `hotel`，剪贴板按键前后都是 `SENTINEL-E1W2`；对照 Ctrl+C → `clip=hotel` | 一致（无入口）：前后都是 `SENTINEL-E1S`（10:34:22 / 10:35:33）；对照 Ctrl+C → `clip=hotel`（10:36:05） | 同 |
| E2 | Paste As Plain Text | Ctrl+Shift+V | 通过（WebView2 原生）：粗体 `hotel` 粘成纯文本，`innerHTML` 不带 `<strong>` | 通过（同上）：`E2 paste target linehotel` | 同 |
| E3 | Select Line | Ctrl+L | 一致（无入口）：选区为空，`z` 插在光标处 | 一致（无入口） | 同 |
| E4 | Select Word | Ctrl+D | 一致（无入口）：`indzia` | 通过：选中 `india`，`z` 替换 → `E4 select word z` | 同 |
| E5 | Delete Word | Ctrl+Shift+D | 一致（无入口）：`julizet` | 一致（无入口）：`julizet` | 同 |
| E6 | Jump to Top | Ctrl+Up | **Windows 不通过**：`q` 落进上一段（`kiqlo`） | **Windows 不通过**：`q` 落在 LAST 上方的空行 | 同（0.3.3 记录 § 3 第 3 条，仍在） |
| E7 | Jump to Bottom | Ctrl+Down | **Windows 不通过**：`q` 落在下一段开头（`qCTRL…`） | **Windows 不通过**：`q` 落在第 2 行 | 同 |
| E8 | Find | Ctrl+F | 一致（无入口）：WebView2 自带查找栏（`e8-w.png`），点进去输入 `kilo` → `1/2`（`e8w2-findbar.png`） | 通过：CodeMirror 搜索面板，焦点在搜索框，`kilo` → 3 个匹配（`e8-s.png`） | 同 |
| E9 | Find Next | Ctrl+G | 一致（无入口）：WebView2 查找栏 `1/2` → `2/2`（`e9w-findbar.png`） | 通过：偏移 8 → 14 | 同 |
| E10 | Find Previous | Ctrl+Shift+G | 一致（无入口）：`2/2` → `1/2`（`e10w-findbar.png`） | 通过：回到偏移 8（`e10-s.png`） | 同 |
| E11 | Replace | Ctrl+H | 一致（无入口）（`e11-w.png`） | 一致（无入口）（`e11-s.png`） | 同 |

本次用小写 `z` / `q` 作探针，0.3.3 用大写；W 的查找栏只有 2 个匹配，因为 E6 的 `q` 已把第一个 `kilo` 改成 `kiqlo`。Edit 组 diff：`diffs.txt`。

## 3. delegator 指定的检查

| # | 检查 | 结论 | 证据 |
|---|---|---|---|
| 2 | Edit › Undo / Redo **菜单点击** | **通过**（两种模式） | 0.3.3 上菜单点击是空操作。0.3.4 上：W（urs.md，新开文档按默认模式进 W）输入 `xy` → Undo 回到 `UR line` → Redo 回到 `UR linexy`；S（urw.md，View › Source）同样。撤销的都是当前活动文档，不涉及其他标签。前后 `kl.txt` 都是 `hkl=0x04090409`（11:03:55 / 11:05:00 / 11:06:16 / 11:09:46 / 11:10:53 / 11:12:42），输入法没有被切换，也没有丢键。菜单点击不写 `ui.menu.select`（预定义项由 muda 回放按键），但 urw 的草稿字节数 23 → 21 → 23 跟着变了 |
| 3 | 原生菜单树 | 通过 | `menus.txt` 与 0.3.3（`windows-audit-20261014-d190-wi6-wi7/menus.txt`）只差 Open Recent 列表；仍是 Edit › Redo `Ctrl+Y`，Help › mdpro Help `[disabled]` |
| 4 | 单实例 | 通过 | `ui.sh open s.md`：进程仍是 24380；`08:39:43 app.single_instance`，`file.open.route outcome broadcast`，`tab.open` |
| 5 | 退出守卫（mdpro › Exit） | 通过 | qg.md 改脏后 Exit：`12:29:50.931 app.quit.request` → `app.quit.check dirtyCount 3` → `app.quit.prompt`，页面弹出「Unsaved changes / Quit without saving?」（Keep editing / Discard changes，`qg-prompt.png`）。Keep editing：`12:30:41.010 ui.dialog.cancel dialog.quit.cancel` → `app.quit.cancel`，进程 24380 仍在，`QG linex` 未丢。再次 Exit → Discard changes（真点击）：`12:32:41.904 app.quit.answer discard idCount 3` → `app.quit.backstop` → `app.quit.commit deleted 3` → `12:32:41.915 app.quit`；进程退出，`%APPDATA%\mdpro\drafts\` 为 0 |
| 6 | D204 / D208 保存字节 | 通过 | d204.md（W 中在 `EDIT here` 行尾输入后 Ctrl+S）：`-`、`+`、`1)` 三种标记原样保留，只有被编辑的那一行变化；d208.md：起始 `5.` 原样保留（`12:09:50 file.save success`，28 B）。见 `diffs.txt`。**另见 D226**：W 中把 d208 显示成 `1. five / 2. six`（`about.png`），只是显示，字节无误 |
| 7 | D217（新窗口只聚焦一次） | 通过 | F2 时 `window.create` 08:35:16.709 之后，`mdpro-359b78a8-…` 恰好一条 `window.focus`（08:35:16.717）；08:35:32 的 blur/focus 来自我的点击 |
| 8 | About 与更新检查 | **Windows 不通过：D224、D225** | 见下 |
| 9 | Ctrl+Shift 组之后的输入法 | 通过 | 全程 `kl.txt` 都是 `hkl=0x04090409`，最后一次 12:35:09 |

**检查 8 细节。**
- **D224（更新检查在 Windows 上总是失败）。** 设置 › About 打开即自动检查：`12:24:20.730 ui.about.update_check start` → `12:24:43.865 ui.about.update_check fail`，错误为 ``None of the fallback platforms `["windows-x86_64-nsis", "windows-x86_64"]` were found in the response `platforms` object``，页面显示「Couldn't get update information. Try again later.」（`settings-about.png`）。同一台机器上 0.3.1 / 0.3.3 的同一检查都是 `success hasUpdate:false`（10-12 09:50、10-12 23:02、10-14 21:39）。原因已在源码核实：df2a879（ADR-0047 WI-004，固定 Tauri 2.12.1 套件）把 tauri-plugin-updater 从 2.9.0 升到 2.13.1；2.9.0 只在 `should_update` 为真时才查平台，2.13.1 的 `check()` 先调 `get_urls`（`updater.rs:675`）再判断版本（`:677`）。而本项目的 `latest.json` 按设计只含 macOS（D-3，`scripts/release/assetNames.mjs:34–37`；已发布的 0.3.1 / 0.3.2 / 0.3.3 的 `latest.json` 都只有 `darwin-aarch64`、`darwin-x86_64`）。所以 0.3.4 在 Windows（及 Linux）上每次检查都报错；macOS 不受影响。用户裁定「Ship 0.3.4, fix in 0.3.5 (Recommended)」，见 ADR-0102。
- **D225（mdpro › About 在 Windows 上无反应）。** 两次真点击 `menuclick mdpro›About`（12:17、12:19）：没有新窗口（`windows` 只列出主窗口），前台仍是 mdpro，日志无任何行。同一批次里 Preferences… 与 Exit 的菜单点击都生效。该项是 `PredefinedMenuItem::about(app, None, None)`（`menu.rs:100`）。**0.3.3 上是否相同：没有证据。** 0.3.3 及更早的 Windows 记录只列出过菜单里有 About（`windows-audit-20261014-*/menus.txt`、`feature-ledger-windows-audit-claude.md` 第 168 行），没有点过它。

## 4. 偏差与操作失误

1. **F6 第一次没先点进编辑器**，`chord` 的 `focus` 步骤按了一下 Alt，Ctrl+W 丢失；点进编辑器后重做通过。属操作失误。
2. **第一批 Format W 作废。** 当时 w.md 处于 Source（视图模式在标签间共享），按键没有改动 W 内容（09:25:33 重新挂载时内容长度仍为 785），中止后用 `menuclick View›WYSIWYG` 切回重做。
3. **SSH 链路很慢且多次中断。** Tailscale 走 hkg 中继，每次调用 7–40 s，09:45–09:50、10:24–10:30、10:37 前后、11:38–11:46 四次完全断开。用户在 Windows 与 mini 上重启 Tailscale 后恢复（仍是中继）。处理办法：每步后检查链路，断开即停在当前步，恢复后从停下的那一步重做；坐标取不到时不再点击（`run.sh` 的数字校验）。由此带来的副作用：
   - E3-S 一次链路中断后，`z` 多打了一次，落在 E3 行（`linezz`），见 `diffs.txt`；
   - E1-S 的第一次「按键后剪贴板」读数被恢复脚本开头重新写入的哨兵覆盖，作废，在同一选区上整组重做（哨兵 → Ctrl+Shift+C → 读 → Ctrl+C 对照）；
   - D208：一次 `Broken pipe` 后 `ui.sh` 重放，`x` 打了两次、保存两次（12:00:58、12:09:50）；结论只看起始 `5.`，不受影响。
4. **定位方式导致的重做。** CodeMirror 只渲染视口内的行，`**` 也是单独的 span，粗体所在行按整行文字找不到。T8-W、T8-S、E1-W、E2-W、E7-S、E8-W 先因找不到行而跳过（没有按键），之后改用 `selectNodeContents` 或行内单词定位重做。E1-W 第一次跳过时，后续的 Ctrl+C 对照没有选区，E2 粘贴进了哨兵文本（`E2 paste target lineSENTINEL-E1W`），所以 E2-W 的结论取自重做那一次的 `hotel`。
5. **Discard 第一次没生效。** 用 CDP 点击时没有等待点击完成，对话框仍开着；之后改为按钮位置的真点击。
6. F2 打开并关闭过第二个窗口；之后的菜单点击都成功，没有用到 `menuat`。

## 5. 顺带核实：D189 侧栏宽度（用户在运行中提问）

用户问：「当 Windows 中的 mdpro 刚刚打开且不是全屏，并且没有打开新的 markdown 文档时，它的侧边栏占用的宽度是不是很宽，导致 editor 区域很窄？」——是，属已登记的 D189（issue #416），不是 0.3.4 引入的。

| 窗口状态 | `innerWidth` | 侧栏 | 编辑区 |
|---|---|---|---|
| 最大化 | 1423 | 220 | 1203 |
| 还原，无文档 | 667 | **532** | **135** |
| 还原，有文档 | 667 | 225 | 442 |

原因：`src/styles/sections/responsive.css:3` 在 `max-width: 960px` 下把列改成 `1fr`，但 `grid-template-areas` 仍是 `"sidebar main"`，侧栏占了 1fr，main 落进隐式的 `auto` 列（自 df097cc 起）。截图：`sb-restored-empty.png`、`sb-restored-doc.png`。D189 已于今天落地（9b7e948），修复在 0.3.4 之后的构建里，本次的 0.3.4（3b16610）不含。

## 6. 恢复与清理

- `keyboardShortcuts`、`themeMode`、`defaultViewMode`、`showSidebar` 与开始时相同。`lastViewMode` 被运行改成 wysiwyg，重启后用 View › Source 改回 source，复查一致。
- 检查 5 的 Discard 退出时删除了 3 份草稿；`%APPDATA%\mdpro\drafts\` 为 0。
- `mdpro.sh normal --yes` → `maximized`，9222 已关闭，mdpro 以普通模式运行（pid 34688）；`mdpro.sh cleanup` 后没有残留的 `mdpro-audit-*` 计划任务。**0.3.4（3b16610）保持安装。**
- 输入法保持 English (US)（`12:35:09 hkl=0x04090409`）。
- `C:\Users\jack\mdpro-audit\` 留下：两个安装包，`fx\v034\`（fixture 已被本次改动），探针脚本，`out\` 与窗口截图。删除该文件夹属于 rule 25 操作，没有做。

## 7. 汇总

- 快捷键矩阵在 0.3.4 上与 0.3.3 **逐行一致**。唯一的差异是 D204 带来的预期改进：W 保存后保留列表标记。0.3.3 记录 § 3 的三条 Windows 问题（T7 Image 与 Italic 同键、Insert Table 标题显示 `⌘⌥T`、Ctrl+Up/Down）在 0.3.4 上依旧存在。
- 0.3.4 新通过的项：
  - Edit 菜单 Undo / Redo 的点击（0.3.3 上是空操作）；
  - 退出守卫；
  - D204 / D208 保存字节；
  - D217。
- 新登记的问题：
  - **D224** 更新检查在 Windows / Linux 上总报错，由 updater 2.13.1 引入的回归，按用户裁定在 0.3.5 修；
  - **D225** mdpro › About 无反应；
  - **D226** W 中有序列表起始号显示为 1。
