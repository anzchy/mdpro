# M2 菜单 spike 真机检查：macOS (a)/(b) 与 Windows (c)–(f)（2026-10-16）

[菜单重组计划](../plans/20261015-plan-menu-reorganisation.md) § 6 的 **M2** 是一次性 spike，
不落地：分支 `spike/menu-m2` @ `02846d6c`（父提交 `33aa6983`，在 `34a03769` 之上补了
`AppHandle::hide` 的 macOS cfg 门）。本记录由 mdpro-a6 起草，依据是两份报告：

- macOS：dtrack 在 Mac mini 上的报告 `~/.mdpro-redesign/dtrack/reports/20261016-m2-macos-dtrack.md`
  （mini 上，未入库），简报 `m2-macos-dtrack-brief.md`；
- Windows：mdpro-delegator 在 win-desktop 上经 SSH（`remote-windows-device-test`）跑的报告
  `~/.mdpro-redesign/prep/m2-windows-report-20261016.md`（未入库），简报 `m2-windows-brief.md`。

原始 JSONL 和窗口截图都留在两台机器的暂存目录里，没有入库；本记录没有收任何全屏截图。
用户对 Windows 一轮的授权（经 delegator 转述）：「Run all, incl. German layout (Recommended)」。

spike 在页面里加了 `spike.m2.*` 日志：每个带修饰键的按键、F 键和 Tab 在捕获和冒泡两个阶段各记一行
（`spike.m2.key`），以及输入、输入法提交、焦点和剪贴板探针的结果。判读方法：
有 `capture` 行说明按键到了页面；冒泡行 `defaultPrevented:true` 说明编辑器快捷键吃掉了它；
没有 `capture` 行说明页面之前的环节（系统、菜单加速键表或 WebView2）拿走了它。

## 1. 被测构建

| 平台 | 构建 | 证明 |
|---|---|---|
| macOS | `02846d6c` release profile，在 mini 的 `verify-02846d6` 工作树构建 | `tauri-app` sha256 `93f7ae65…29ad2c`；`app.ready` `buildId` `91641b8c…8b8e`，`appVersion` 0.3.5，`releaseId` `"unknown"`；随后有 `spike.m2.installed` |
| Windows release | CI `build-windows.yml` run 38868726385（`debug=false`） | `/S /D=D:\programs\mdpro` 安装后 `tauri-app.exe` `96855A5F…E5E0` |
| Windows debug | CI run 38868731321（`debug=true`），只用于 (e) | `tauri-app.exe` `8B835B13…915A` |

**第一次 macOS 运行没有执行任何用例。** 第一次用的是 verify profile，它编进了 `verify-run`
特性（ADR-0047），在没有准备好的私有 run 目录时以 exit 78 拒绝启动；`open -a` 启动后进程
立即退出，日志里一行也没有。简报里「任何 profile 都可以」是错的：**spike 一类不走
verify-run 启动器的构建要用 release profile。** 第二次换成 release profile 后全部执行。

## 2. 结论

| 项 | 结论 | 摘要 |
|---|---|---|
| **(a)** macOS ⌘H 与无键 Hide（C2、D13） | **通过** 6/6（含对照） | 应用菜单「Hide mdpro」不带快捷键，「Hide Others ⌥⌘H」不变；⌘H 在 WYSIWYG 和 Source 都到达页面，应用不隐藏；菜单项 Hide mdpro 仍能隐藏（`spike.m2.hide` `ok:true`），之后 ⌘H 仍不隐藏 |
| **(b)** macOS ⌃Tab、⌃⇧Tab、F6（D11） | **通过** 6/6 | 两种模式下都到达页面，`defaultPrevented:false`，焦点不离开编辑器，Source 里没有插入 Tab |
| **(c)** Windows 输入、输入法、菜单复制后粘贴（C10、U10） | **通过** 10/10 | 菜单 Copy 和 Ctrl+C 之后打字、Ctrl+V、微软拼音输入在两种模式下都正常：**VMark #1354 的症状不存在** |
| (c) 剪贴板 API（§ 5.7） | **写通过，读不通过** | 从菜单点击调用 `writeText`、`write`（html+text，粘贴后为粗体）、`execCommand` copy/cut 都成功；`navigator.clipboard.read` 无论从菜单还是从带用户激活的按钮都会弹出 WebView2 权限提示，关掉后是 `NotAllowedError`；`execCommand('paste')` 返回 `false`（预期） |
| **(d1)** Windows Ctrl+Shift+0 | **不通过：系统拿走** | 按键从未到达 mdpro；这台 PC 的输入法热键 `HKCU\Control Panel\Input Method\Hot Keys\00000104`（Ctrl+Shift+0，目标为日语输入法）先拦走了它。同一轮的对照 Ctrl+Shift+9、Ctrl+Shift+K 都到达了 |
| **(d2)** 德语 QWERTZ 的 AltGr 字符 | **WYSIWYG 通过，Source 不通过** | WYSIWYG 打出 `@ { [ ] } \ €`；Source 里 AltGr+8 `[`、AltGr+9 `]`、AltGr+ß `\` 被编辑器快捷键吃掉（`defaultPrevented:true`，没有输入），只剩 `@{}€`。已登记为 **D264**，并入 M1b |
| (d3) 德语布局下的 D9 按键 | 测量 | 见 § 3.3 |
| **(e)** WebView2 浏览器按键（C16） | release **通过**；debug 一项**不通过** | release：Ctrl+Shift+I 不开 DevTools，F6、Ctrl+Tab、Ctrl+Shift+K/Q/[/] 都到达编辑器。debug：Ctrl+Shift+I 打开 DevTools，其余与 release 相同 |
| **(f)** 原生窗口有焦点时的菜单加速键（K4） | **未执行到** | 在 Windows 上点标题栏不会让焦点离开 WebView2；Ctrl+S 和 Ctrl+/ 都由页面快捷键处理。K4 的「原生窗口焦点」这一情形仍然没有验证 |
| **K3**：变灰的菜单项是否仍吞掉快捷键（D3） | **无法回答** | 用的是 Ctrl+Shift+0，而这台 PC 上它在到达菜单和页面之前就被系统拿走（d1），启用、变灰、重新启用三种状态下都既不触发菜单项也不到达页面。点击菜单项本身能触发。要回答需换一个系统不占用的组合键并重新构建 spike |

Windows 计数（报告的表格行）：28 通过（含两行预期为 `false` 的 paste），6 不通过
（async read 菜单和按钮、d1 两种模式、d2 Source、debug 的 Ctrl+Shift+I），1 未执行到 (f)，
K3 三行无法回答，3 行测量。macOS：CM-K、A0–A4 和 B1–B3 × 两种模式共 12 个用例全部通过（dtrack 报告的摘要写作 13）。

## 3. 明细

### 3.1 macOS（dtrack，第二次运行，release profile）

焦点闸门（`lastfocus` 为 `window.focus main`）在每次按键前第一次检查即成立。
行号均为 mini 上 `~/.mdpro/mdpro.log` 的行号。

| 用例 | 结论 | 证据 |
|---|---|---|
| CM-K 对照（⌘/） | 通过 | L36822 capture `key:"/"`、`meta:true`；L36824 `ui.shortcut.trigger` `view.cycle`；L36827 `view.mode.change` wysiwyg→source |
| A0 应用菜单 | 通过 | 截图 `m2mac-a0-appmenu`：「Hide mdpro」无快捷键，「Hide Others ⌥⌘H」，「Quit mdpro ⌘Q」 |
| A1 ⌘H（W） | 通过 | L36853 capture `key:"h"`、`meta:true`、`mode:"wysiwyg"`；L36854 冒泡 `defaultPrevented:false`；没有 `window.blur`，窗口仍在 |
| A2 ⌘H（S） | 通过 | L36866 capture `mode:"source"`，目标 `cm-content`；冒泡 `defaultPrevented:false`；编辑器什么也没做（这个构建的 Source 没有 `Mod-h`，M1b 才加） |
| A3 菜单 Hide mdpro | 通过 | L36868 `spike.m2.hide` `{"ok":true}`；L36869 `window.blur`；`open_application` 后 L36870 `window.focus`，同一个 pid |
| A4 再按 ⌘H（W） | 通过 | L36887 capture `key:"h"`；没有 blur |
| B1–B3（W） | 通过 | ⌃Tab L36889/36890、⌃⇧Tab L36891/36892、F6 L36893/36894（`code:"F6"`），冒泡都是 `defaultPrevented:false`，光标不动 |
| B1–B3（S） | 通过 | L36906–36911，目标 `cm-content`，`defaultPrevented:false`，文本不变（没有插入 Tab，标签页不脏） |

附注：`key.sh` 发出的 ⌘/ 记为 `code:"NumpadDivide"`、`key:"/"`（osascript 的副作用），
不影响判读；需要真实 `Slash` 码时用 `kc.sh 44 command`。运行结束后 `$S/m2.md` 与夹具逐字节相同，
退出时 `app.quit.check` `dirtyCount:0`。

### 3.2 Windows (c) 与剪贴板（release，无 DevTools 端口）

所有按键和菜单步骤都走 `ui.sh` 真实输入。驱动用 `keybd_event` 发虚拟键，所以每条
`spike.m2.key` 的 `code` 都是空串，只按 `key` 判读；AltGr 以左 Ctrl+Alt 发出，所以
`altGraph` 恒为 `false`。两种编辑器都自己处理 `paste` 事件，不产生 `insertFromPaste`，
粘贴行按编辑器里的文本（截图）判读。

| 用例 | W | S | 证据 |
|---|---|---|---|
| c1 打 `abc` | 通过 | 通过 | 各 4 条 `insertText` |
| c2 菜单 Copy → 打 `xyz` → Ctrl+V | 通过 | 通过 | W 行变成 `xyzbeta`；S 第 11 行 `abcxyzalpha`。菜单 Copy 会向页面注入一个合成的 Control+`c` keydown |
| c3 Ctrl+C → 打 `xyz` → Ctrl+V | 通过 | 通过 | `xyzgamma` / `…alphaxyzgamma` |
| c4 拼音 `nihao` + 空格 | 通过 | 通过 | `compositionend` `你好`（W 17:22:24，S 17:24:56）。另一套分词式拼音方案把 `nihao` 切成 `ni'ha'o`，是该方案本身的行为，按键都按顺序送达 |
| c5 菜单 Copy 后再做 c4 | 通过 | 通过 | `compositionend` `你好`，之后 Ctrl+V 粘出复制的词 |

| 剪贴板探针 | 菜单 | 按钮（有用户激活） |
|---|---|---|
| async `writeText` | 通过（W、S） | 通过 |
| async `write`（text/html + text/plain） | 通过，粘贴为粗体 | 通过，粗体 |
| async `read` / `readText` | **不通过（权限提示）**：弹出「http://tauri.localhost 想要 查看复制到剪贴板的文本和图像 [阻止][允许]」，等待到关闭后 `NotAllowedError`（81 s） | **不通过（权限提示）**：同样的提示，关闭后 `NotAllowedError` |
| `execCommand('copy')` | 通过（W、S），`returned:true` | 通过 |
| `execCommand('cut')` | 通过，选区被剪下 | 通过 |
| `execCommand('paste')` | `returned:false`（预期） | `returned:false`（预期） |

权限提示都是用 ✕ 关闭的，没有点「允许」或「阻止」，因此没有在真实应用共用的 WebView2
配置里留下站点权限。

### 3.3 Windows (d)：Ctrl+Shift+0 与德语布局

| 用例 | 结论 | 证据 |
|---|---|---|
| d1 Ctrl+Shift+0，US（W、S） | 系统拿走 | 只有 Control 和 Shift 的 keydown，没有 `0`/`)`，没有 `k3.fired`；对照 Ctrl+Shift+9（`(`）和 Ctrl+Shift+K 在同一轮被捕获 |
| d2 德语 AltGr Q 7 8 9 0 ß E（W） | 通过 | `@ { [ ] } \ €` 各一条 `insertText`，没有命令运行，段落其余内容不变 |
| d2（S） | 不通过 | `[`、`]`、`\` 的冒泡行 `defaultPrevented:true` 且没有输入；对照为同一轮同一路径的 W 行 |
| d3 德语下 Ctrl+Shift+K / Q / US `[` `]` 位置 | 测量 | K→`K`，Q→`Q`；US `[` 位置（ü 键）→`Ü`，US `]` 位置（+ 键）→`*`；VK_OEM_4（ß 键）→`?`，VK_OEM_6（´）→`Dead`。在 Source 里 Ctrl+Shift+K 运行了 CodeMirror 的 deleteLine |
| 附加：德语下切换视图 | 测量 | Ctrl+`#`（US `/` 位置）无反应；Ctrl+Shift+7（`/`）触发 `Cmd+/` 切换视图：mdpro 自己的快捷键按字符匹配 |
| 附加：US 布局 Ctrl+Alt+7（W） | 测量 | 冒泡 `defaultPrevented`，段落变成有序列表（Milkdown `Mod-Alt-7`）；德语下同样的物理键打出 `{`，不运行命令 |

d2 的原因（代码阅读，已写入 D264）：Windows 把 AltGr 报告为 `ctrlKey`+`altKey`，`key` 为字符本身。
`@codemirror/view` 6.39.11 的 `runHandlers` 先按字符名直接匹配（`Ctrl-Alt-[`），它的 AltGr
保护（`dist/index.js:8944`）只跳过 base-key 回退，不跳过直接匹配。于是 Source 经 basic-setup
加载的 `Ctrl-Alt-[` foldAll、`Ctrl-Alt-]` unfoldAll（`@codemirror/language/dist/index.js:1505-1506`）
和 `Mod-Alt-\` indentSelection（`@codemirror/commands/dist/index.js:1777`）吃掉了这三个字符。

### 3.4 Windows (e)：release 与 debug，无 DevTools 端口

| 按键 | release | debug |
|---|---|---|
| Ctrl+Shift+I | 通过：有 capture，没有 DevTools 窗口 | **不通过**：capture 后 `window.blur`，打开「DevTools - tauri.localhost/」（已关闭） |
| F6 | 通过：有 capture，没有 blur，目标仍在编辑器 | 通过 |
| Ctrl+Tab、Ctrl+Shift+K/Q/[/] | 通过：各有 capture（Tab、K、Q、`{`、`}`） | 通过（先打 `x` 证明焦点在编辑器） |

判断依据是日志和随后删除的全屏截图核对；没有保留全屏截图。

### 3.5 Windows (f) 与 K3

| 用例 | 结论 | 证据 |
|---|---|---|
| f：点标题栏 → Ctrl+S；点标题栏 → Ctrl+/ | 未执行到 | 点标题栏后没有 blur，两个组合键都被页面捕获（目标 `cm-content`，`focused:true`），经 `ui.shortcut.trigger` 运行了 `file.save` 和 `view.mode.change` |
| f 对照：编辑器内 Ctrl+S | 通过 | `ui.shortcut.trigger` `file.save` → `file.save` 17:53:21 |
| k1 菜单项启用，Ctrl+Shift+0 | 都没有 | 没有 `k3.fired`，没有 capture（同 d1） |
| k2 变灰（`k3.toggle enabled:false ok:true` 17:37:48），Ctrl+Shift+0 | 都没有 | 菜单里显示为 `[disabled]`；没有 `k3.fired`，没有 capture；对照 Ctrl+Shift+9 被捕获 |
| k3 重新启用（`enabled:true` 17:38:50），Ctrl+Shift+0 | 都没有 | 同上；直接点击菜单项能触发 `k3.fired`（17:37:46 和 17:38:54） |

## 4. 这次运行决定了什么

- **C2 / D13**：macOS 上去掉 Hide 的 ⌘H 之后，⌘H 到达页面且不隐藏应用，无键的 Hide mdpro
  仍可用。`rust-hide` 只在 macOS 有（`AppHandle::hide` 在 tauri 2.12.1 里是 macOS 专有；
  spike 的第一次 Windows 构建因此以 E0599 失败）。已写入计划的 C2、`route` 行和 M1b（`9d8cb9e8`）。
- **D11**：⌃Tab 和 F6 在 macOS 两种模式下都到达页面，没有编辑器占用。
- **U10**：Windows 上没有 VMark #1354 的症状，倾向维持选项 A（保留预定义剪贴板项）。由用户决定。
- **§ 5.7 剪贴板 API**：从菜单写剪贴板可以用 async API（含 `text/html`）或 `execCommand`；
  **读剪贴板不能用 web API**（会弹权限提示），所以若要自建 Windows 的菜单 Paste，只能走原生途径
  （预定义菜单项，或需另立 ADR 的 `clipboard-manager` 插件）。写入 M0。
- **C16**：release 版的 WebView2 不把 Ctrl+Shift+I、F6 留给浏览器；只有 debug 版会打开 DevTools。
- **K5**：Windows 本身不保留 Ctrl+Shift+0，但输入法热键可以先拦走它，所以 off-Mac 不能让编辑器
  命令只依赖它。已写入 K5（`9d8cb9e8`）。
- **D264**（新缺陷，并入 M1b）：德语等 AltGr 布局下 Source 打不出 `[ ] \`。
- **仍未回答**：K3 / D3（变灰的带键菜单项是否仍吞键）需换一个系统不占用的组合键重跑；
  K4 的原生窗口焦点情形 (f) 需要另一种让 WebView2 失焦的操作。

## 5. 范围外的观察（均未验证）

以下是 Windows 一轮顺带看到的现象，没有复现，也没有判定，**均为未验证**。若确认属实，由
delegator 登记 D 号。

- WYSIWYG 打字时 `editor.milkdown.mount` 反复出现（内容长度 99→100→105…），像是每次编辑都重新挂载。
- 用 Ctrl+/ 从 WYSIWYG 切到 Source 后，焦点停在 `body` 而不是 CodeMirror；按键到达页面，但在点击之前进不了编辑器。
- 仅 debug 构建、仅见一次：重启后没有标签页，外部打开（`file.open.route outcome:broadcast`、`file.open.external success`）没有产生标签页，也没有前端日志行；用 **+** 新建标签页正常。release 上没有复现。
- debug 构建上 UIA `FindAll` 超时四次（`max`、`windows`、`shot` 步骤）。

另：mini 上有一个不在屏幕内的 CoreServicesUIAgent 窗口（「Verifying "mdpro-verify"…」，进度条不动），
这次没有挡住点击，之后的 GUI 运行应先检查它。

## 6. 恢复状态

- **Windows**：重新安装官方 0.3.5（`tauri-app.exe` `E545761E…85CE1D`，与运行前相同）；设置快照用
  `robocopy /MIR` 恢复（config.json 与快照一致，草稿 0 个）；输入法恢复为 zh-Hans-CN（两套拼音）和
  en-US，德语布局已删除；没有残留的计划任务和 DevTools 窗口；全屏截图在 PC 和 Mac 上都已删除。
  PC 上留下的安装包、夹具副本、窗口截图和设置快照目录按 rule 25 未删除，清单在 Windows 报告里。
- **macOS**：退出时没有提示、没有残留进程；退出前把视图模式切回 WYSIWYG，持久化的模式与启动时一致；
  `$S` 保留。
- spike 分支 `spike/menu-m2` 和它的工作树在本记录落地后按 rule 25 删除。
