# Settings → Keyboard Shortcuts：Windows 逐项真机记录，win-desktop（2026-10-14 → 15）

执行方：mdpro-codex-audit，从 MacBook 经 SSH 操作，用项目 skill `remote-windows-device-test`。用户的话（delegator 转达）：「目前在Windows上要逐个测试Settings -> Keyboard Shortcuts中每个快捷键是否正常Work，Mac 版本也要逐个测试，这个功能分配给codex-audit session处理」。矩阵、路线和期望结果：`docs/pending/20261014-brief-shortcuts-matrix.md`（未提交）§ 2–4。没有用 computer use，没有用 TeamViewer。时间均为 +0800，22:17–00:30。

证据在 `docs/test/windows-audit-20261014-shortcuts/`：
- `results-log.txt`：逐条运行记录（每条的按键、日志行、DOM 读数）；
- `diffs.txt`：两个 fixture 每组保存后的 `diff`，原样；
- mdpro 窗口截图（`ui.sh shot`，只含 mdpro 窗口）与页面截图（`cdp.sh shot`）。

没有全屏截图进入证据目录。为查焦点问题拍过两张临时全屏截图，看完即删（见 § 4 偏差 2）。

## 0. 构建身份与前置

| 项 | 值 |
|---|---|
| 构建 | release run 38570340338（build-only），`50c67c5`，`mdpro_0.3.3_x64-setup.exe` |
| 安装包 | SHA-256 `74955540c06a8a9603d661f8dc4761d66eefebaeba3f75484310f79d4f336f7c`，存为 `C:\Users\jack\mdpro-audit\mdpro_0.3.3_x64-setup-50c67c5.exe`，Mac 与 Windows 两端哈希一致 |
| 安装 | 安装前日志显示 21:47 启动后没有任何文档活动，没有打开的文档；`Stop-Process tauri-app` → `/S /D=D:\programs\mdpro`，退出码 0，ProductVersion 0.3.3 |
| `app.ready` | `releaseId` = `0.3.3@50c67c5a30ee4cf1a9fca491b2df41c7e178c694` |
| 窗口 | `mdpro.sh debug --yes`，`maximized`，`innerWidth` 1423 |
| 原样设置 | `keyboardShortcuts` = 默认值（矩阵 § 3），`defaultViewMode` wysiwyg，`lastViewMode` source，主题 light，侧栏 220 px |
| 输入法 | zh-Hans-CN（微软拼音，HKL `0x08040804`）与 en-US。00:00 前按 zh-CN 运行；23:47 按用户的话「Windows中需要把输入法切换为ABC，目前是中文输入法」把 mdpro 窗口切到 English (US)，`kl.txt`：`23:46:55 fg=mdpro hkl=0x08040804` → `23:47:16 fg=mdpro hkl=0x04090409`。E3–E5 W 在切换后重做 |
| Fixture | 矩阵 § 3.1 的 `w.md`（WYSIWYG）和 `s.md`（Source），放在 `C:\Users\jack\mdpro-audit\fx\shortcuts\`，经 `ui.sh open` 打开 |

**路线。** 每个按键都是真键（`ui.sh chord`，在 `clickat` 进编辑器后加 `nofocus:true`）。CDP 只用来放光标或选区、读 DOM，不发按键。每组先 `log.sh mark`，再查 `ui.shortcut|ui.menu|file.|view.mode` 日志行。按真键时 Ctrl+Alt 组合到达页面时为 `ctrlKey`+`altKey`，`getModifierState("AltGraph")` 为 false，`isTrusted` true。

**结论用词。**
- **通过**：按键做了设置页写的事。
- **Windows 不通过**：Windows 上的行为与设置页或 macOS 不符。
- **一致（无入口）**：该模式下没有任何绑定，按下后什么都没发生（没有日志行，文件没变）。矩阵预期两平台都是这样，属设置页的条目没有实现，不是 Windows 特有。
- **未验证**：没有走到要测的路径。

## 1. 对照组（同一次运行）

| 行 | 路线 | 结论 | 证据 |
|---|---|---|---|
| CM-M | 菜单 | 通过 | `menuclick File›Save`：`22:23:14.073 ui.menu.select menu.file.save`，`file.save success` w.md |
| CM-H | hook | 通过 | Ctrl+N：`22:23:54.226 ui.shortcut.trigger file.new`，新 Untitled 标签 |
| CM-P | Milkdown | 通过 | 选中 `alpha`，Ctrl+B → `<strong>alpha</strong>`（即 T1-W） |
| CM-C | CodeMirror | 通过 | 在 S 的 CTRL 行输入 `x` → `CTRL control linex`；Ctrl+Z → `CTRL control line` |

## 2. 结论表

### File（W）

| 行 | 条目 | 按键 | 结论 | 证据 |
|---|---|---|---|---|
| F1 | New | Ctrl+N | 通过 | 即 CM-H |
| F2 | New Window | Ctrl+Shift+N | 通过 | `22:29:18.683 ui.shortcut.trigger file.new_window`，`window.create`，焦点到窗口 B；B 用标题栏点击 + Alt+F4 关掉 |
| F3 | Open | Ctrl+O | 通过 | `22:27:47.822 file.open`，「打开」对话框，取消 |
| F4 | Save | Ctrl+S | 通过 | `22:25:58.213 file.save`，`file.save success` w.md |
| F5 | Save As | Ctrl+Shift+S | 一致（无入口） | 无日志行，无对话框，只有主窗口（同路线对照 F4 通过） |
| F6 | Close | Ctrl+W | 通过 | `22:24:42.259 file.close`，`tab.close wasModified false` |
| F7 | Preferences | Ctrl+, | 通过 | `22:27:53.663 file.preferences`，设置窗口打开 |

### View

| 行 | 条目 | 按键 | 结论 | 证据 |
|---|---|---|---|---|
| V1 / V4a | Source / Cycle，从 W | Ctrl+/ | 通过 | `22:33:34.435 ui.shortcut.trigger view.cycle` → `view.mode.change wysiwyg→source` |
| V2 / V4b | WYSIWYG / Cycle，从 S | Ctrl+/ | 通过 | `22:36:02.267 view.mode.change source→wysiwyg`（CodeMirror `viewModeKeymap`，按设计不写 hook 行） |
| V3-W | Toggle Sidebar | Ctrl+Shift+L | 通过 | `22:31:15.609 view.toggle_sidebar`，侧栏 220→0，再按一次恢复 |
| V3-S | Toggle Sidebar | Ctrl+Shift+L | 通过 | `22:34:25.554 view.toggle_sidebar`，220→0；选区不变（`""`，没有 `cm-selectionBackground`） |
| V5 | Toggle Fullscreen | Ctrl+Alt+F | 一致（无入口） | 无日志行，窗口矩形不变 `-11,-11,3862,2110` |
| V6 | Switch Documents | Ctrl+` | 一致（无入口） | 两个标签，活动标签不变，无 `tab.switch` |

### Paragraph

| 行 | 条目 | 按键 | W | S |
|---|---|---|---|---|
| P1–P6 | Heading 1–6 | Ctrl+1–6 | 通过：`#`…`######` | 通过：`#`…`######`，每次按键恰好一条 `ui.shortcut.trigger paragraph.heading<n>`，没有重复应用 |
| P7 | Paragraph | Ctrl+0 | 通过：`# P7` → `P7` | 通过：一条 `paragraph.paragraph` |
| P8 | Increase Heading | Ctrl+= | 一致（无入口）：不变 | 通过：`###` → `##` |
| P9 | Decrease Heading | Ctrl+- | 一致（无入口）：不变 | 通过：`##` → `###` |
| P10 | Table | Ctrl+Alt+T | 通过：`22:43:29.719 ui.shortcut.trigger paragraph.table`，Insert Table 对话框打开后取消。**但对话框标题栏显示 `⌘⌥T`，见 § 3.2** | （只测 W） |
| P11 | Code Fences | Ctrl+Alt+C | 通过：包进 ``` 代码块 | 一致（无入口）：不变 |
| P12 | Math Block | Ctrl+Alt+B | 一致（无入口） | 一致（无入口） |
| P13 | Quote | Ctrl+Alt+Q | 一致（无入口） | 一致（无入口） |
| P14 | Ordered List | Ctrl+Alt+O | 一致（无入口） | 一致（无入口） |
| P15 | Unordered List | Ctrl+Alt+U | 一致（无入口） | 一致（无入口） |
| P16 | Indent | Ctrl+] | 通过：第二项嵌套 | 通过：缩进 4 格 |
| P17 | Outdent | Ctrl+[ | 通过：嵌套项回到顶层 | 通过（第二次）：`  - P17 outdent item` → `- P17 outdent item`。第一次的点击落在窗口底边附近（y=2066），光标不在该行，作废后居中重做 |

两个文件的保存后 diff：`diffs.txt` 的 Paragraph 段。

### Format

| 行 | 条目 | 按键 | W | S |
|---|---|---|---|---|
| T1 | Bold | Ctrl+B | 通过：`**alpha**` | 一致（无入口） |
| T2 | Italic | Ctrl+I | 通过：`*bravo*` | 一致（无入口） |
| T3 | Underline | Ctrl+U | 一致（无入口） | 一致（无入口） |
| T4 | Code | Ctrl+Shift+` | 通过：`` `delta` `` | 一致（无入口） |
| T5 | Strikethrough | Alt+Shift+5 | 通过：`~~echo~~`；按键前后 `kl.txt` 都是 `fg=mdpro hkl=0x08040804`，输入法没有切换 | 一致（无入口） |
| T6 | Hyperlink | Ctrl+K | 通过：Insert Link 对话框，真键输入 `x.t` 后 Insert → `[foxtrot](https://x.t)` | 通过：`23:01:58.095 ui.shortcut.trigger format.hyperlink`，Insert Link 对话框（`t6-s-link-modal.png`），用它的 Cancel 关闭 |
| T7 | Image | **Ctrl+I** | **Windows 不通过**：选中 `T7 image line` 后按设置页写的 Ctrl+I，执行的是 Italic → `*T7 image line*`；没有任何图片动作，见 § 3.1 | 一致（无入口） |
| T8 | Clear Format | Ctrl+\ | 一致（无入口）：整行选中，`**golf**` 不变 | 一致（无入口）：keydown `\` 的 `defaultPrevented` 为 false，没有处理器 |

S 的 T1–T5、T7、T8 与 T6 走同一路线，T6 通过。

### Edit

| 行 | 条目 | 按键 | W | S |
|---|---|---|---|---|
| E1 | Copy As Markdown | Ctrl+Shift+C | 一致（无入口）：选中 `hotel`，剪贴板按键前后都是哨兵 `SENTINEL-E1`；没有打开 inspector（CDP 仍只有一个页面） | 一致（无入口）：剪贴板仍是 `SENTINEL-E1S`；同一选区的对照 Ctrl+C → `clip=hotel` |
| E2 | Paste As Plain Text | Ctrl+Shift+V | 通过（WebView2 原生，非 mdpro 绑定）：从粗体 `hotel` 复制后粘到 E2 行尾，得到 `linehotel`，不带 `<strong>`；没有 `ui.shortcut` 行 | 通过（同上，WebView2 原生） |
| E3 | Select Line | Ctrl+L | 一致（无入口）：选区为空，`Z` 插在光标处 | 一致（无入口） |
| E4 | Select Word | Ctrl+D | 一致（无入口）：选区为空 | 通过：选中 `india`（CodeMirror `Mod-d`），`Z` 替换它 → `E4 select word Z` |
| E5 | Delete Word | Ctrl+Shift+D | 一致（无入口）：`juliet` 没删 | 一致（无入口） |
| E6 | Jump to Top | Ctrl+Up | **Windows 不通过**：光标在最后一行，`Q` 落进上一段（`kiQlo`），是 WebView2 原生的「上一段」 | **Windows 不通过**：`Q` 落在 LAST 上方的空行（第 65 行），不是第 1 行 |
| E7 | Jump to Bottom | Ctrl+Down | **Windows 不通过**：光标在 H1 开头，`Q` 落在下一段开头（`QCTRL…`） | **Windows 不通过**：`Q` 落在第 2 行（H1 后的空行），不是最后一行 |
| E8 | Find | Ctrl+F | 一致（无入口）：mdpro 没有 WYSIWYG 查找，也没有 `ui.shortcut` 行。打开的是 **WebView2 自带的查找栏**（右上，`e8-w.png`），点进去输入 `kilo` → `2/2`（`e8w3-findbar.png`） | 通过：CodeMirror 搜索面板打开，焦点在搜索框，输入 `kilo` → 3 个匹配（`e8-s.png`） |
| E9 | Find Next | Ctrl+G | 一致（无入口）：在 WebView2 查找栏里 `2/2` → `1/2`（`e9w2-findbar.png`），是 WebView2 原生的 | 通过：第一次选中 E8 行第 1 个 `kilo`（偏移 8），第二次第 2 个（偏移 14），读的是 `.cm-searchMatch-selected` |
| E10 | Find Previous | Ctrl+Shift+G | 一致（无入口）：WebView2 查找栏 `1/2` → `2/2`（`e10w2-findbar.png`） | 通过：回到偏移 8（`e10-s.png`） |
| E11 | Replace | Ctrl+H | 一致（无入口）：什么都没发生（`e11-w.png`） | 一致（无入口）（`e11-s.png`） |

Edit 组两个文件的 diff：`diffs.txt` 的 Edit 段。

## 3. Windows 特有的问题（交 delegator 登记）

1. **T7 Image 与 Italic 同为 `Ctrl+I`，按下执行 Italic。** 设置页 Image 显示 `Ctrl+I`（`Cmd+Ctrl+I` 在非 Mac 上把 Cmd 和 Ctrl 都映射成 Ctrl），与 Italic 同键。W 中按它执行的是 Italic，Image 在 Windows 上没有可按的键。
2. **Insert Table 对话框标题栏显示 macOS 标签 `⌘⌥T`。** Ctrl+Alt+T 打开对话框正常（P10 通过），但对话框里的快捷键提示没有走平台标签。
3. **Ctrl+Up / Ctrl+Down 不跳到文首或文末**，两种模式都是（E6、E7）。W 是 WebView2 原生的按段移动；S 是 CodeMirror 在 Windows 上只绑 `Mod-Home` / `Mod-End`。设置页写的是 Ctrl+Up / Ctrl+Down。

两平台一致的「无入口」条目（设置页提供了重新绑定，但按下什么都不做）：
- Save As；Toggle Fullscreen；Switch Documents；
- Math Block、Quote、Ordered List、Unordered List；
- Underline、Clear Format；
- Copy As Markdown、Select Line、Delete Word、Replace。

只在一种模式里有效：
- Increase/Decrease Heading 只在 S；
- Code Fences 只在 W；
- Select Word、Find、Find Next、Find Previous 只在 S。在 W 里，Find 系列由 WebView2 自带的查找栏接住。
- Paste As Plain Text 两种模式都只是 WebView2 原生行为。

与矩阵 § 5 的桌面判断一致，新增的是 § 3.2 和 WebView2 查找栏。

## 4. 偏差与操作失误

1. **T6-S 之后的对话框吞键。** T6-S 打开 Insert Link 对话框后，同批的 T7-S、T8-S 和 Ctrl+S 是在对话框开着时按的。发现后用对话框的 Cancel 关掉，这三步作废重做（T7 23:07，T8 23:09，保存 23:09:11）。
2. **前台被别的窗口占走（23:20–23:30）。** T5-W 第一次（23:17:42）`echo` 没变；随后的重试里，页面连对照键都没收到，`document.hasFocus()` 为 false。两张临时全屏截图显示一个 Chrome 窗口（23:20:05 启动）在 mdpro 前面。那段时间发出的几个键（`alt+shift+5`、`ctrl+shift+5`、`alt+5`）到了那个窗口。重试里有一次 `clickat 1617,828`，可能落在它页面的正文文字上；之后没有再向它发送输入。两张截图看完即删。运行在 23:25 暂停，用户确认没在用这台机器（「Continue now」）后，`focus` + `max` 恢复，T5-W 按 D190 K2 的同一路线重做并通过。最初记的「未验证」作废。
3. **中文输入法下 E4 的 `Z` 落进了 E5。** 第一批 E3–E5 W 里 E5 得到两个 `Z`、E4 没有；切到 English (US) 后单独重做，三行各得一个，作废第一批。E4/E5 两行因此多了几个 `Z`，见 `diffs.txt`。
4. **CodeMirror 只渲染视口内的行。** E1-S 第一次在 00:06 找不到 E 行（DOM 里只有 36 行），选区失败，Ctrl+C 对照也没复制到东西，作废。把 `.cm-scroller` 滚到底后重做。
5. **WebView2 查找栏的焦点。** 每次 `ui.sh` 运行都会让查找栏失去键盘焦点，第一次输入的 `kilo` 没进去；在同一次运行里先点它的输入框再输入，之后正常。
6. 运行过程中关闭过第二个窗口（F2 的窗口 B）；之后的菜单点击都成功，没有用到 `menuat`。

## 5. 恢复与清理

- `keyboardShortcuts` 与原样逐键相同（JSON 比较 `same`）。`defaultViewMode` wysiwyg、`lastViewMode` source、主题 light、侧栏 220 px，都与开始时一致。
- 两个 fixture 标签用 Ctrl+W 关闭：`00:28:39.017 tab.close … s.md "wasModified": false`，`00:28:40.636 tab.close … w.md "wasModified": false`。`%APPDATA%\mdpro\drafts\` 为空。
- `mdpro.sh normal --yes` → `maximized`，9222 关闭；`mdpro.sh cleanup`。mdpro 以普通模式运行，v0.3.3 候选（`50c67c5`）保持安装。
- **输入法保持 English (US)**，按用户要求，没有切回微软拼音。
- `C:\Users\jack\mdpro-audit\` 留下：安装包，`fx\shortcuts\`（`w.md`、`s.md` 已被本次改动），只读探针 `kl.ps1`、`clip.ps1`，切换输入法的 `il.ps1`，`out\kl.txt`、`out\clip.txt`，以及 mdpro 窗口截图。删除该文件夹属于 rule 25 操作，没有做。
