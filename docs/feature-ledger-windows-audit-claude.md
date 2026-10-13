# mdpro 0.3.1 Windows 功能审计（Claude 版）

审计日期：2026-10-12（Asia/Shanghai）。对象：用户在 Windows 11（DESKTOP-7576AM2，显示缩放 270%，系统输入法为微软拼音）上安装的 `D:\programs\mdpro\tauri-app.exe`，About / HTTP / MCP 均报 0.3.1。依据：0.3.1 锁定提交 `c8bd2b6` 时的 `docs/feature-ledger.md` Part 1，共 180 行（Windows 仓库已同步到 `a0f87ab`，但本审计按安装包对应的 `c8bd2b6` 版 ledger 对照）。

方法：全程从 MacBook 经 SSH 驱动，不接管任何一台机器的屏幕。页面内操作走 WebView2 远程调试端口（127.0.0.1:9222，CDP，mdpro 以环境变量重启后开启）；原生菜单、键盘、文件对话框、整窗截图由在用户桌面会话内运行的 PowerShell（一次性计划任务 + UI Automation + Win32 SendInput 类调用）完成；证据是页面 DOM、截图和 `%USERPROFILE%\.mdpro\mdpro.log` 的 JSONL 行。只把亲眼看到的行为记为通过；凡未实际操作的一律记「未验证」并写明原因。

## 结论与范围

> **2026-10-13 更正**：168（Hide）、029、031 三行的结论有误或证据不足，已改，计数随之调整。原因是测试脚本的用法，不是 app：菜单在一次 `ui.sh` 运行里打开、在下一次运行里点击，期间菜单已被关掉；029 用的合成反引号键码不对。详见 `.claude/skills/remote-windows-device-test/reference/pitfalls.md` 第 1、2 条。

- 通过：50 行
- 部分：29 行
- 一致（无入口）：17 行
- Windows 不通过：10 行
- 与 ledger 不符：1 行
- 平台不适用：10 行
- 未验证：63 行

「一致（无入口）」= ledger 标 Absent/Stub，本次在菜单全量导出或设置十页逐页读出中确认确实没有入口。

## Windows 专属缺陷（按影响排序）

### W1 应用快捷键在 Windows 全部失效

Ctrl+S / N / O / W、Ctrl+Shift+E / L / N、Ctrl+, 、Ctrl+/、Ctrl+2 / 4、表格 Ctrl+Alt+方向键等一个都不触发：无 `ui.menu.select`、无 `file.save`，磁盘不变。根因在代码：`src/hooks/useKeyboardShortcuts.ts:84-86` 的 `matchesShortcut` 先以 `isMac ? metaKey : ctrlKey` 判主修饰键，紧接着又要求 `wantCtrl === event.ctrlKey`；绑定写的是 `Cmd+S`（wantCtrl=false），而 Windows 按 Ctrl 时 ctrlKey=true，于是永远不匹配。原生菜单加速键也从未触发（键盘焦点在编辑器或标题栏都试过）。同样的动作用鼠标点原生菜单全部正常。页内由编辑器自己处理的键（Ctrl+Z/Y、Ctrl+B/I、Ctrl+1–6、Ctrl+K、Ctrl+F）正常。结果：Windows 用户只能用菜单保存。（键盘输入为合成的 keybd_event；代码根因已独立确认，仍建议真人按一次 Ctrl+S 收口。）

### W2 自己保存后必弹「External change detected」

原子写在 Windows 上表现为 `remove`（被识别为 self_write 抑制）+ `modify_name to`，后者 `ownEvent=false`、`unchangedCheck=unstable` 而作为 modified 发出。每次菜单保存后都弹 Reload/Ignore（work1.md 与 UTF-16 副本各复现）。这违背 ledger 016「自己 ⌘S 不会触发误报」。

### W3 本地图片在 Windows 一律不显示

Windows 上图片走 `http://asset.localhost/…`，而 `tauri.conf.json` 的 CSP `img-src` 只放行 `asset:` 与 `https://asset.localhost`。页面捕获到 `securitypolicyviolation`（img-src）。经 File → Open 的普通路径同样失败；同一 PNG 用 data: URL 正常。影响 044 以及粘贴/拖入图片后的显示（035–040）。

### W4 Exit 绕过退出守卫且不清理服务文件

4 个脏文档时点 mdpro → Exit：进程立即退出，没有提示，日志没有 `app.quit` / quit-guard 行；`%APPDATA%\mdpro\server.port` 与 `server.token` 留在原处。重启后草稿恢复列出了这 4 个文档（30 s 间隔内的改动会丢）。

### W5 路径带 `\\?\` 前缀，标签名显示整条路径

经单实例/再次启动打开的文件，路径一律是 `\\?\C:\…`；底部标签显示 `\\?\C:\Users\jack\mdpro-a…`，多个标签无法区分。草稿恢复、MCP get_open_documents 也带这个前缀。经 File → Open 对话框打开的是普通 `C:\…`。

### W6 Windows 快捷键冲突

ProseMirror 的 `Mod` 在 Windows 是 Ctrl：行内代码 `Mod-Shift-\`` 与删除线 `Ctrl-Shift-\`` 是同一组合，实测得到删除线，行内代码无法用键盘输入；标题 `Mod-2/Mod-4` 与菜单标注的视图切换 Ctrl+2/Ctrl+4 相同。

### W7 macOS 专属界面照搬到 Windows

原生菜单有「mdpro」应用菜单，含 Services / Hide(Ctrl+H) / Hide Others / Show All（Hide 实测有效：窗口隐藏、任务栏按钮保留；Hide Others / Show All / Services 未测；Ctrl+H 被 Hide 占用）；设置 → Keyboard Shortcuts 全部显示 Cmd+…；Advanced 提示 `~/.mdpro/mdpro.log`；新建按钮提示「(⌘N)」；导出对话框建议文件名 `basic.md.html`（双扩展名）；草稿时间戳显示原始 UTC 串。

### W8 270% 缩放下窄窗口布局

1672×1136 物理像素的窗口只有约 667 CSS px 宽：侧栏被挤到约 25 CSS px，大纲文字被截断（TA/OI/CC），大纲项无法点击；最大化（1120 CSS px）后正常。

## ledger 本身的错误（大概率与平台无关）

- **055 WYSIWYG 下的脚注**：ledger 写 Absent、「两者都以字面文本显示」。实测 WYSIWYG 把 `[^1]` 渲染成上标 1（`footnote_reference` 节点），把定义渲染成 `dl[data-type=footnote_definition]` 块。应改为 Partial（有渲染、无跳转/回链）。

## 与 Codex 草稿的交叉核对

Codex 草稿（`D:\mac-app\mdpro\docs\feature-ledger-windows-audit.md`，未提交）：已验证 9、部分验证 95、未验证 72、平台不适用 2、与描述不符 2。

**一致的结论**：001、049、080、088、124、144、172 的通过；055 与 ledger 不符；WYSIWYG 数学为字面、Mermaid 为代码块；HTTP 401/200；更新检查 hasUpdate=false；UTF-16 读写。

**Codex 没发现、本次新增的 Windows 缺陷**：W1（全部应用快捷键失效及其代码根因）、W3（CSP 拦截本地图片）、W4（Exit 绕过退出守卫、服务文件残留）、W6（快捷键冲突，代码层面确认）；以及 031 WYSIWYG 插入链接疑似不生效（待真人复核）。

**结论不同的地方**：

- **016**：Codex 把自存后的外部变更提示记作「属于 ledger 已记录的局限」。ledger 016 写的恰恰相反（「自己 ⌘S 不会触发误报」），所以这是 Windows 上的缺陷，不是已知局限。

- **058**：Codex 记「WYSIWYG 表格右键菜单底部超出界面（1203×851）」。本次在 667×445 与 1120×653 CSS px 下菜单都被夹在视口内（top 8、bottom 437）。差异可能来自窗口尺寸或点击位置，未能复现 Codex 的截断。

- **004**：Codex 记「部分验证（保存对话框后保存成功）」。保存功能本身可用，但 Windows 用户最常用的 Ctrl+S 不工作，本次记为 Windows 不通过。

- **168**：Codex 记「Windows 原生 Window 与应用菜单可见」为部分验证。本次先误记为「Hide 是空操作」，2026-10-13 在同一次运行里打开并点击复核：Hide 有效，窗口隐藏、任务栏按钮保留，与 macOS 语义一致。

**Codex 记「未验证」、本次给出确定结论的行**：005、009、011、020、031（不通过）、033（不通过）、035（不通过）、044（不通过）、061（不通过）、079、094、104、140（不通过）、141、173（不通过）。

**Codex 记「部分验证」、本次给出确定结论的行**：004（不通过）、006、010、012、014、016（不通过）、017、018、019、027、028、029（不通过）、030、054、058、059、066、071、077、078、081、089–093、102、105（不通过）、108、109、115、116、133、139、153、154（不通过）、164、168（不通过）。

**Codex 记「已验证」**：001、049、076、080、088、124、144、172 本次同样通过；096（关掉 Include styles 后落盘）本次未复测。

**169**：Codex 记「与描述不符」（ledger 引的是历史上的 404 / latest 0.3.0），本次同样看到检查成功、hasUpdate=false，记为通过——两边观察一致，只是归类不同。

**Codex 报而本次未复测**：UTF-16 文档 Reload 后大纲显示「No headings found」（103）；设置在 1203×851 窗口下底部内容重叠（153）。

## 需要真人确认的清单

- 真人按一次 Ctrl+S（编辑器内）确认不保存（W1，代码根因已确认，仍建议收口）。
- WYSIWYG 选中文字 Ctrl+K 填 example.com 是否生成链接（031）。
- 从资源管理器拖一个 .md 和一张 png 进窗口（007、040）。
- 中文输入法候选框开着时在表格里按 Tab（068）。
- 粘贴一张截图、一张 6 MB PNG、一张 GIF（035–039；显示会受 W3 影响）。
- Windows 设置里切换深浅色，看 System 主题是否跟随（122）。
- 保存过程中强杀进程，看文件是否完整（013）。

## 逐行核对（180 行）

| ID | 区域 | 能力 | ledger 状态 | 本次结论 | 证据 | Codex 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| 001 | 文件与文档管理 | 新建文档 | Shipped | 通过 | File → New（真实鼠标点原生菜单）→ menu.file.new → 新 Untitled 标签。Ctrl+N 无效，见 W1。 | 已验证 |
| 002 | 文件与文档管理 | 打开文件 | Partial | 部分 | File → Open… 弹原生「打开」对话框，载入 image2.md（file.open source=dialog，路径无 \\?\ 前缀）。.md 过滤与重开已开文件未测。Ctrl+O 无效（W1）。 | 部分验证 |
| 003 | 文件与文档管理 | 最近打开 | Partial | 部分 | File → Open Recent 子菜单列出最近文件（UIA 读出 3 项，后续 recent_files.sync count 递增）。多窗口写盘顺序未测。 | 部分验证 |
| 004 | 文件与文档管理 | 保存 | Shipped | Windows 不通过 | File → Save（菜单点击）可存盘（file.save success，磁盘含 SAVEPROBE2）；但 Ctrl+S 在编辑器内不保存——无日志、磁盘不变（W1 根因）。另：每次自存都弹假的外部变更提示（见 016）。 | 部分验证 |
| 005 | 文件与文档管理 | 另存为 | Stub | 通过 | 与描述一致：无 Save As 菜单项；Untitled + File → Save 弹原生「另存为」，取消记 file.save cancel。 | 未验证 |
| 006 | 文件与文档管理 | 关闭文档 | Shipped | 通过 | 脏 Untitled 上 File → Close 弹「Unsaved changes / Keep editing / Discard changes」，Discard 关闭。Ctrl+W 无效（W1）。 | 部分验证 |
| 007 | 文件与文档管理 | 拖拽打开文件 | Partial | 未验证 | 需要从资源管理器真实拖放，脚本未做（转人工清单）。 | 未验证 |
| 008 | 文件与文档管理 | Finder 文件关联 | Partial | 平台不适用 | Finder 关联为 macOS；Windows 的 .md 关联未检查。 | 平台不适用 |
| 009 | 文件与文档管理 | 单实例启动路由 | Partial | 通过 | mdpro 运行中以文件参数再启动 tauri-app.exe：进程仍为 1 个，日志 app.single_instance → file.open.route → file.open success。注意路径变为 \\?\C:\…（见 W2）。 | 未验证 |
| 010 | 文件与文档管理 | 编码自动检测 | Shipped | 通过 | UTF-16LE+BOM+CRLF 文件：中文与 emoji 正常显示，大纲列出标题，日志 encoding UTF-16LE。 | 部分验证 |
| 011 | 文件与文档管理 | 编码选择对话框 | Partial | 通过 | GBK 文件弹「Can't open this file as UTF-8」，按钮 UTF-16LE / UTF-16BE / Cancel，初始焦点在 Cancel，Esc 关闭。 | 未验证 |
| 012 | 文件与文档管理 | 保存时保留原编码 | Shipped | 通过 | UTF-16LE 副本编辑后 File → Save：首字节 FF FE 保留，3 个 CRLF、0 个裸 LF，追加文字在。 | 部分验证 |
| 013 | 文件与文档管理 | 原子写入保存 | Shipped | 未验证 | 需要在保存中强杀进程，未做。 | 未验证 |
| 014 | 文件与文档管理 | 10MB 文件大小上限 | Partial | 通过 | 10,485,761 B 被拒（日志 file too large），页面出现「Failed to open file」toast（MutationObserver 捕获）。恰 10 MiB 未测。 | 部分验证 |
| 015 | 文件与文档管理 | 大文件提示横幅 | Absent | 未验证 | 未构造大于阈值的可打开文件。 | 部分验证 |
| 016 | 文件与文档管理 | 外部变更监听 | Partial | Windows 不通过 | 真实外部追加约 300ms 内被侦测（modify_any → reload-prompt）。但 mdpro 自己保存后同样弹「External change detected」：原子写在 Windows 产生 remove（self_write 已抑制）+ modify_name to（ownEvent=false, unchangedCheck=unstable → emitted_modified）。work1.md 与 UTF-16 副本各复现一次。 | 部分验证 |
| 017 | 文件与文档管理 | 外部变更重载提示 | Shipped | 通过 | 外部追加后点 Reload：file.reload，editor.milkdown.reload generation 2，新行可见。 | 部分验证 |
| 018 | 文件与文档管理 | 未保存改动确认 | Shipped | 通过 | 关脏文档的确认框初始焦点在「Keep editing」（document.activeElement）。经 CDP 发的 Enter 未关框，真实 Enter 未测。 | 部分验证 |
| 019 | 文件与文档管理 | 草稿自动保存 | Shipped | 通过 | 改动后不保存，draft.write 每 30 s 一次（157 B）。 | 部分验证 |
| 020 | 文件与文档管理 | 启动时草稿恢复：`list_drafts` / `recover_draft`  | Partial | 通过 | 强杀后重启弹「Recover drafts」，每条有 Recover / Discard；Discard 删除，Recover 恢复内容（reason draft-recovery）。时间戳显示为原始 UTC ISO 串（含 100ns 位）。 | 未验证 |
| 021 | 文件与文档管理 | 按 id 读取单份草稿 | Partial | 未验证 | 内部命令，未调。 | 未验证 |
| 022 | 文件与文档管理 | 保存后清理草稿 | Shipped | 未验证 | 未做保存后重启核对。 | 未验证 |
| 023 | 文件与文档管理 | 陈旧草稿清理 | Partial | 未验证 | 需 7 天旧草稿，未做。 | 未验证 |
| 024 | 文件与文档管理 | 文件增删重命名 | Absent | 一致（无入口） | 菜单与标签上无删除/重命名入口（UIA 菜单全量导出）。 | 部分验证 |
| 025 | 编辑 / WYSIWYG | WYSIWYG 编辑 | Partial | 部分 | WYSIWYG 编辑、模式切换正常；整体替换后的焦点边界未测。 | 部分验证 |
| 026 | 编辑 / WYSIWYG | 行内源码显隐 | Shipped | 未验证 | 未测光标进出时的语法展开。 | 未验证 |
| 027 | 编辑 / WYSIWYG | 粗体 / 斜体 | Shipped | 通过 | WYSIWYG Ctrl+B / Ctrl+I（页内键位）→ strong / em。 | 部分验证 |
| 028 | 编辑 / WYSIWYG | 标题 1–6 与正文 | Shipped | 通过 | Ctrl+3 → h3，Ctrl+0 → p（页内键位）。 | 部分验证 |
| 029 | 编辑 / WYSIWYG | 行内代码 | Shipped | 部分 | Mod-Shift-` 与 Ctrl-Shift-` 在 Windows 是同一组合，冲突在代码层面确认（W6）。实测得到 <del>，但用的是键码不正确的合成键（2026-10-13 更正），哪个绑定胜出需用真实按键复核。 | 部分验证 |
| 030 | 编辑 / WYSIWYG | 删除线 | Shipped | 通过 | Ctrl+Shift+` → <del>。 | 部分验证 |
| 031 | 编辑 / WYSIWYG | 插入链接（WYSIWYG） | Shipped | 未验证 | WYSIWYG 选中后 Ctrl+K 弹「Insert Link」并记 ui.link-modal.submit，但文档里没有生成任何 <a>（两次）。源码模式同样流程成功（见 080），故疑为 WYSIWYG 插入路径问题；建议人工复核一次。 | 未验证 |
| 032 | 编辑 / WYSIWYG | 链接 URL 消毒 | Shipped | 部分 | 源码模式 example.com 自动补成 https://example.com；javascript:alert(1) 未生成链接（但无错误提示）。 | 未验证 |
| 033 | 编辑 / WYSIWYG | 高亮选区 | Partial | Windows 不通过 | WYSIWYG 下 Ctrl+Shift+H 无效（走菜单加速键，W1）；Format → Highlight Selection 菜单未测。 | 未验证 |
| 034 | 编辑 / WYSIWYG | `==text==` 往返 | Shipped | 未验证 | fixture 中 ==marked== 在 WYSIWYG 显示为高亮，存盘往返未测。 | 部分验证 |
| 035 | 编辑 / WYSIWYG | 图片粘贴 | Shipped | Windows 不通过 | 未实际粘贴；但本地图片在 Windows 一律被 CSP 拦截（见 044），粘贴后的图片也无法显示。 | 未验证 |
| 036 | 编辑 / WYSIWYG | 图片粘贴校验 | Shipped | 未验证 | 未粘贴图片。 | 未验证 |
| 037 | 编辑 / WYSIWYG | 上传进度占位 | Shipped | 未验证 | 未粘贴图片。 | 未验证 |
| 038 | 编辑 / WYSIWYG | 未保存文档禁粘贴守卫 | Shipped | 未验证 | 未粘贴图片。 | 未验证 |
| 039 | 编辑 / WYSIWYG | 批量多图粘贴 | Shipped | 未验证 | 未粘贴图片。 | 未验证 |
| 040 | 编辑 / WYSIWYG | 图片拖放插入 | Shipped | 未验证 | 需真实拖放；显示同受 044 影响。 | 未验证 |
| 041 | 编辑 / WYSIWYG | 编辑器内拖拽文字 / 表格 | Absent | 未验证 | 未测页内拖拽。 | 部分验证 |
| 042 | 编辑 / WYSIWYG | 图片缩放菜单 | Shipped | 未验证 | 图片无法加载（044），未测缩放菜单。 | 未验证 |
| 043 | 编辑 / WYSIWYG | 图片宽度写回 Markdown | Shipped | 未验证 | 同上。 | 未验证 |
| 044 | 编辑 / WYSIWYG | 本地图片渲染 | Shipped | Windows 不通过 | 相对路径图片显示为破图。页面捕获 securitypolicyviolation img-src：CSP 只放行 asset: 与 https://asset.localhost，Windows 实际 URL 是 http://asset.localhost/…。经 File → Open（普通路径）打开同样失败；同一 PNG 以 data: URL 能正常加载。 | 未验证 |
| 045 | 编辑 / WYSIWYG | 粘贴 HTML 消毒 | Shipped | 未验证 | 未设置剪贴板 HTML。 | 未验证 |
| 046 | 编辑 / WYSIWYG | 粘贴参差表格（WYSIWYG） | Partial | 未验证 | 未测。 | 未验证 |
| 047 | 编辑 / WYSIWYG | 空表头行自动补齐（WYSIWYG） | Partial | 未验证 | 未测。 | 未验证 |
| 048 | 编辑 / WYSIWYG | 链接点击守卫 | Shipped | 未验证 | 点外链会在用户机器打开浏览器，未做。 | 未验证 |
| 049 | 编辑 / WYSIWYG | 撤销 / 重做 | Shipped | 通过 | Ctrl+Z 撤销；Ctrl+Y 与 Ctrl+Shift+Z 都能重做（页内）。原生 Edit 菜单 Redo 标为 Ctrl+Y。 | 已验证 |
| 050 | 编辑 / WYSIWYG | 剪切 / 复制 / 粘贴 / 全选 | Shipped | 部分 | Edit 菜单有 Undo/Redo/Cut/Copy/Paste/Select All（Windows 标 Ctrl+…）；逐项未点。 | 未验证 |
| 051 | 编辑 / WYSIWYG | 插件架构（注册表管理插件生命周期） | Partial | 未验证 | 架构项，不在运行态范围。 | 未验证 |
| 052 | 编辑 / WYSIWYG | 拼写检查 | Stub | 未验证 | 未键入拼错的词。 | 部分验证 |
| 053 | 编辑 / WYSIWYG | 专注模式 / 打字机模式 | Stub | 一致（无入口） | 十个设置页里没有专注/打字机开关（逐页读出）。 | 部分验证 |
| 054 | 编辑 / WYSIWYG | WYSIWYG 下的数学公式排版 | Absent | 通过 | 与描述一致：WYSIWYG 下 $E=mc^2$ 与 $$…$$ 为字面文本。 | 部分验证 |
| 055 | 编辑 / WYSIWYG | WYSIWYG 下的脚注渲染 | Absent | 与 ledger 不符 | WYSIWYG 渲染了脚注：引用为上标 1（footnote_reference），定义为 dl footnote_definition 块。ledger 说两者都是字面文本——不成立（很可能各平台皆然）。 | 与描述不符 |
| 056 | 编辑 / WYSIWYG | WYSIWYG 下的查找替换 | Absent | 未验证 | 未在 WYSIWYG 按 Ctrl+F。 | 部分验证 |
| 057 | 表格 | 插入表格对话框 | Shipped | 未验证 | Format → Insert Table 点击未弹框（当时一次在源码模式，一次菜单点击可能未命中），未能确认。 | 未验证 |
| 058 | 表格 | 表格右键菜单（WYSIWYG） | Partial | 通过 | WYSIWYG 右键单元格出表格菜单（插入/移动/重排/删除 12 项），菜单被夹在视口内。 | 部分验证 |
| 059 | 表格 | 表格右键菜单（源码） | Partial | 通过 | 源码右键单元格出同一菜单，首列「Move column left」置灰。 | 部分验证 |
| 060 | 表格 | 插入行 / 列 | Shipped | 部分 | 右键「Insert row below」4→5 行（editor.table.insert_row_after）。⌘⌥↑ 等快捷键在 Windows 无效（W1）。 | 部分验证 |
| 061 | 表格 | 删除行 / 列 / 整表 | Shipped | Windows 不通过 | 删除快捷键 ⌘⌥⌫ 在 Windows 不可达（W1）；右键删除项存在未点。 | 未验证 |
| 062 | 表格 | 移动行 / 列 | Shipped | 部分 | 菜单有上/下/左/右移；首个表体行的「Move row up」可用（ledger 说首行置灰，可能指表头行）。 | 未验证 |
| 063 | 表格 | 列对齐 | Partial | 未验证 | 未测对齐。 | 部分验证 |
| 064 | 表格 | 重排表格 | Partial | 未验证 | 未测。 | 未验证 |
| 065 | 表格 | 保存时自动重排 | Partial | 未验证 | 未测。 | 未验证 |
| 066 | 表格 | Tab 单元格导航 | Partial | 通过 | 源码表格单元格 Tab：光标从 a1 移到 b1 格首。WYSIWYG 未测。 | 部分验证 |
| 067 | 表格 | Esc 退出表格 | Shipped | 未验证 | 未测。 | 未验证 |
| 068 | 表格 | 输入法安全的表格导航 | Shipped | 未验证 | 需要真人输入法操作。 | 未验证 |
| 069 | 表格 | 源码模式的表格识别范围 | Partial | 未验证 | 未测。 | 未验证 |
| 070 | 表格 | 列数校验提示 | Shipped | 未验证 | 未测。 | 未验证 |
| 071 | 表格 | 当前单元格高亮 | Shipped | 通过 | 源码表格当前格有 cm-table-active-cell 高亮。 | 部分验证 |
| 072 | 表格 | 列宽拖拽 | Shipped | 未验证 | 未拖列宽。 | 未验证 |
| 073 | 表格 | 跨模式单元格光标同步 | Shipped | 未验证 | 未测。 | 部分验证 |
| 074 | 表格 | 宽表格滚动 | Shipped | 未验证 | 未测。 | 未验证 |
| 075 | 表格 | HTTP 驱动的表格编辑 | Partial | 未验证 | HTTP 表格端点未调。 | 部分验证 |
| 076 | 源码模式 | 源码编辑 | Shipped | 通过 | 源码模式有语法着色、行号、当前行高亮（截图）。 | 已验证 |
| 077 | 源码模式 | 查找与替换 | Shipped | 通过 | 源码 Ctrl+F 打开 CodeMirror 查找替换面板，Esc 关闭。Ctrl+G/Ctrl+H 未测（Ctrl+H 也是原生菜单「Hide」的加速键）。 | 部分验证 |
| 078 | 源码模式 | 源码模式标题级别 | Shipped | 通过 | 源码 Ctrl+3 → 「### 」。 | 部分验证 |
| 079 | 源码模式 | 提升 / 降低标题级别 | Shipped | 通过 | Ctrl+- 降一级（####），Ctrl+= 升回（###）。 | 未验证 |
| 080 | 源码模式 | 源码模式插入链接 | Shipped | 通过 | 源码选中后 Ctrl+K → Insert Link → [srcword](https://example.com)。 | 已验证 |
| 081 | 源码模式 | 隐藏 Markdown 语法标记 | Shipped | 通过 | 源码模式非光标行的「## Section 5」显示为 H2 徽标。 | 部分验证 |
| 082 | 源码模式 | 行注释切换 | Shipped | 未验证 | 真实 Ctrl+Alt+/ 两次，行无变化；Windows 上 Ctrl+Alt 即 AltGr，无法判定是键未到还是命令无效。 | 未验证 |
| 083 | 源码模式 | 代码块缩进 / 反缩进 | Shipped | 未验证 | 未测。 | 未验证 |
| 084 | 源码模式 | 括号自动配对 | Partial | 未验证 | Markdown 页有开关，未切换验证。 | 部分验证 |
| 085 | 源码模式 | 自动换行与缩进宽度 | Partial | 未验证 | Editor 页有 Tab Size / Word Wrap，未切换验证。 | 部分验证 |
| 086 | 源码模式 | 代码块主题 | Shipped | 部分 | Appearance 页有 Default / One Dark；未切换验证。 | 部分验证 |
| 087 | 源码模式 | 大文档性能保护 | Partial | 未验证 | 未构造大文档。 | 未验证 |
| 088 | 导出 | 导出 HTML | Shipped | 通过 | File → Export HTML…（菜单）→ 原生「另存为」→ 27,178 B（file.export_rendered）。建议文件名为 basic.md.html（双扩展名）。⌘⇧E 无效（W1）。 | 已验证 |
| 089 | 导出 | 数学公式 | Partial | 通过 | 导出含 2 个 <math>（一个 display=block），全文件无 <script>。 | 部分验证 |
| 090 | 导出 | 脚注 | Partial | 通过 | 导出脚注引用 → #1（存在），↩ 回链 → #fnref-1。 | 部分验证 |
| 091 | 导出 | 自动链接与 emoji | Shipped | 通过 | 裸 URL 成链接，:smile: → 😄。 | 部分验证 |
| 092 | 导出 | GFM 渲染 | Shipped | 通过 | 导出含任务复选框、<del>、<mark>、<table>。 | 部分验证 |
| 093 | 导出 | Mermaid 图表 | Stub | 通过 | 与描述一致：mermaid 仍是代码块（language-mermaid），无 SVG。 | 部分验证 |
| 094 | 导出 | 导出消毒 | Shipped | 通过 | 导出无 <script>、无 javascript: href。 | 未验证 |
| 095 | 导出 | 默认导出目录 | Stub | 未验证 | Export 页有 Browse…，未测。 | 未验证 |
| 096 | 导出 | 内嵌样式开关 | Stub | 未验证 | Export 页有开关；本次导出含 2 个 <style>，未切开关对照。 | 已验证 |
| 097 | 导出 | 预览面板（Preview） | Absent | 一致（无入口） | View 菜单只有 Source / WYSIWYG，无预览。 | 部分验证 |
| 098 | 导出 | 导出 HTML 片段命令 | Partial | 未验证 | 内部命令。 | 未验证 |
| 099 | 导出 | PDF 导出 | Absent | 一致（无入口） | File 菜单无 PDF。 | 部分验证 |
| 100 | 导出 | Word / DOCX 导出 | Absent | 一致（无入口） | File 菜单无 Word/DOCX。 | 部分验证 |
| 101 | 导出 | 打印 | Absent | 一致（无入口） | File 菜单无 Print；Ctrl+P 未测。 | 部分验证 |
| 102 | 导出 | 引文 / BibTeX | Absent | 通过 | 与描述一致：[@citekey] 在编辑器与导出中均为字面文本。 | 部分验证 |
| 103 | 导航与界面 | 大纲侧栏 | Partial | 部分 | 最大化后点大纲「Section 5」滚到该标题（scroll_anchor source=toc）。窗口较窄时侧栏被挤成约 25 CSS px，大纲项不可点（W5）。UTF-16 Reload 后大纲为空（Codex 报）未复测。 | 部分验证 |
| 104 | 导航与界面 | 切换侧栏 | Shipped | 通过 | View → Toggle Sidebar 隐藏/显示（220px），每次一条 preferences.set。⌘⇧L 无效（W1）。 | 未验证 |
| 105 | 导航与界面 | 底部标签条 | Shipped | Windows 不通过 | 标签名显示完整的 \\?\C:\Users\jack\mdpro-a… 而不是文件名，多个标签无法区分（W2）；新建按钮提示「New Document (⌘N)」。 | 部分验证 |
| 106 | 导航与界面 | 视图模式切换 | Shipped | 部分 | View 菜单 Source/WYSIWYG 正常（menu.view.set_mode）；Ctrl+/、Ctrl+2/4 无效（W1），且 Ctrl+2/4 与标题快捷键冲突（W3）。 | 部分验证 |
| 107 | 导航与界面 | 恢复上次视图模式 | Partial | 未验证 | 未做重启核对。 | 未验证 |
| 108 | 导航与界面 | 切模式保留滚动位置 | Partial | 通过 | 长文档停在 Section 5，WYSIWYG → Source 后仍在顶部（scroll_anchor capture → restore tier block）。 | 部分验证 |
| 109 | 导航与界面 | 模式徽标 | Shipped | 通过 | 侧栏顶部显示 SOURCE / WYSIWYG（Windows 无红绿灯）。 | 部分验证 |
| 110 | 导航与界面 | Toast 通知 | Partial | 部分 | toast「Failed to open file」出现且自动消失；关闭按钮未检查。 | 部分验证 |
| 111 | 导航与界面 | 加载指示 | Shipped | 未验证 | 未捕获加载指示。 | 部分验证 |
| 112 | 导航与界面 | 窗口拖拽区 | Shipped | 平台不适用 | Windows 使用原生标题栏，非 overlay 拖拽区。 | 未验证 |
| 113 | 导航与界面 | 字数统计 | Absent | 一致（无入口） | 界面无字数显示（截图）。 | 部分验证 |
| 114 | 导航与界面 | 文档内导航 | Absent | 未验证 | 未点链接。 | 部分验证 |
| 115 | 导航与界面 | 双向链接与反向链接 | Absent | 通过 | 与描述一致：[[wikilink]] 为字面文本（编辑器与导出）。 | 部分验证 |
| 116 | 导航与界面 | 标签 | Absent | 通过 | 与描述一致：#tag 为普通文本。 | 部分验证 |
| 117 | 导航与界面 | 全局 / 跨文件搜索 | Absent | 一致（无入口） | 菜单无跨文件搜索。 | 部分验证 |
| 118 | 导航与界面 | 文件树 / vault | Absent | 一致（无入口） | 侧栏只有大纲。 | 部分验证 |
| 119 | 导航与界面 | 命令面板 | Absent | 一致（无入口） | 菜单无命令面板。 | 部分验证 |
| 120 | 导航与界面 | 演示模式 | Absent | 一致（无入口） | 无演示入口。 | 部分验证 |
| 121 | 主题与排版 | 浅色 / 深色 / 跟随系统 | Partial | 部分 | Theme → Dark：html.theme-dark，背景 rgb(15,17,21)；Theme → Light 复原。暗色下编辑区滚动条仍为浅色原生样式。落盘与重启未测。 | 未验证 |
| 122 | 主题与排版 | 跟随系统主题变化 | Partial | 未验证 | 需改 Windows 系统外观，未做。 | 未验证 |
| 123 | 主题与排版 | 编辑器字体 | Partial | 部分 | Editor 页有 System Default / Serif / Monospace，未切换。 | 部分验证 |
| 124 | 主题与排版 | 字号 | Shipped | 通过 | 设置页 + 使编辑器 16px → 17px 即时生效，− 复原。 | 已验证 |
| 125 | 主题与排版 | 行高 | Partial | 部分 | 选项存在（1.2–2.0），未切换。 | 部分验证 |
| 126 | 主题与排版 | 内容宽度 | Partial | 部分 | 选项存在（Narrow/Medium/Wide/Full），未切换。 | 部分验证 |
| 127 | 主题与排版 | 自定义主题 CSS | Absent | 一致（无入口） | Appearance 只有代码块主题。 | 部分验证 |
| 128 | 主题与排版 | 界面本地化 | Absent | 一致（无入口） | 界面全英文，无语言设置。 | 部分验证 |
| 129 | 主题与排版 | RTL / 竖排书写 | Unknown | 部分 | 阿拉伯语/希伯来语文字在 WYSIWYG 中可显示；方向与光标行为未测。 | 未验证 |
| 130 | MCP 集成 | MCP 服务开关 | Partial | 部分 | Integrations 显示 Running、localhost:55045；未切开关。 | 部分验证 |
| 131 | MCP 集成 | 启动时自动运行 | Stub | 未验证 | Stub，未测。 | 部分验证 |
| 132 | MCP 集成 | 自动批准 AI 编辑 | Stub | 未验证 | Stub，未测。 | 部分验证 |
| 133 | MCP 集成 | 四个 MCP 工具 | Shipped | 通过 | mdpro_mcp.exe：initialize（mdpro MCP Server 0.3.1），tools/list 恰为四个工具，get_open_documents 返回标签列表（路径带 \\?\）。 | 部分验证 |
| 134 | MCP 集成 | HTTP 表格端点 | Partial | 未验证 | 表格端点未调。 | 部分验证 |
| 135 | MCP 集成 | 影子存储同步 | Partial | 部分 | get_open_documents 反映 UI 中的脏状态与标题。 | 部分验证 |
| 136 | MCP 集成 | 写入确认对话框 | Partial | 未验证 | 未触发写入确认。 | 未验证 |
| 137 | MCP 集成 | 客户端配置安装器 | Shipped | 部分 | 四个客户端的 Install 按钮存在；未点击（会改用户的客户端配置）。 | 未验证 |
| 138 | MCP 集成 | 连接测试与端口复制 | Shipped | 部分 | Test Connection 按钮可点，结果文本未捕获；端口显示 localhost:55045。 | 部分验证 |
| 139 | MCP 集成 | 令牌与来源校验 | Shipped | 通过 | /api/status：无 token 401、错 token 401、正确 X-MDPRO-Token 200、异域 Origin 403。 | 部分验证 |
| 140 | MCP 集成 | 退出时清理服务配置 | Shipped | Windows 不通过 | 经 mdpro → Exit 退出后，%APPDATA%\mdpro\server.port 与 server.token 仍在（且该退出没有任何 app.quit 日志）。 | 未验证 |
| 141 | MCP 集成 | 通过 HTTP 新建文档 | Partial | 通过 | POST /api/documents/new → 201，界面多出「# from HTTP」新标签。 | 未验证 |
| 142 | MCP 集成 | MCP 服务器信息查询 | Partial | 未验证 | 内部命令。 | 部分验证 |
| 143 | MCP 集成 | 验证构建的 MCP 端口 | Shipped | 平台不适用 | ADR-0047 验证构建只在 macOS。 | 未验证 |
| 144 | 日志与诊断 | 结构化 JSONL 日志 | Shipped | 通过 | %USERPROFILE%\.mdpro\mdpro.log 为可逐行解析的 JSONL，事件带 actionId 与 start/success。 | 已验证 |
| 145 | 日志与诊断 | 日志开关 | Shipped | 部分 | Advanced 页有开关；提示文字写的是 macOS 路径「~/.mdpro/mdpro.log」。未切换。 | 部分验证 |
| 146 | 日志与诊断 | 日志级别 | Shipped | 部分 | 级别选项存在（Debug/Info/Warn/Error），未切换。 | 部分验证 |
| 147 | 日志与诊断 | DevTools | Shipped | 部分 | 正式包的 WebView2 远程调试端口可用（由环境变量开启）；右键 Inspect / F12 未测。 | 未验证 |
| 148 | 日志与诊断 | 构建身份 | Partial | 平台不适用 | 构建身份/验证构建在 macOS 流程。 | 部分验证 |
| 149 | 日志与诊断 | 验证构建（独立身份） | Partial | 平台不适用 | 同上。 | 未验证 |
| 150 | 日志与诊断 | 验证运行启动守卫 | Partial | 平台不适用 | 同上。 | 未验证 |
| 151 | 日志与诊断 | 持久化根登记表 | Partial | 平台不适用 | 同上。 | 未验证 |
| 152 | 日志与诊断 | 验证运行启动器 | Shipped | 平台不适用 | 同上。 | 未验证 |
| 153 | 偏好设置 | 设置对话框 | Partial | 通过 | 设置对话框十个分页，最大化（1120×653 CSS px）时都在视口内。 | 部分验证 |
| 154 | 偏好设置 | 快捷键改键 | Stub | Windows 不通过 | Keyboard Shortcuts 页在 Windows 上全部显示「Cmd+…」；且这些绑定在 Windows 一个都不生效（W1）。 | 部分验证 |
| 155 | 偏好设置 | 默认视图模式 | Partial | 部分 | General 页有 Default View Mode（WYSIWYG/Source）；未改。 | 部分验证 |
| 156 | 偏好设置 | 自动保存间隔 | Partial | 部分 | Off/30s/1min/2min/5min 选项存在；默认 30 s 已由 019 证实。 | 部分验证 |
| 157 | 偏好设置 | 图片目录与外链复制 | Stub | 未验证 | Stub，未测。 | 部分验证 |
| 158 | 偏好设置 | 偏好写入的原子性 | Partial | 未验证 | 未测。 | 未验证 |
| 159 | 偏好设置 | 图片配置读写命令 | Stub | 未验证 | Stub，未测。 | 未验证 |
| 160 | 窗口与标签页 | 新建窗口 | Partial | 部分 | File → New Window 开出第二窗口（window.create，位于 76,76）；层叠未测（需第三个窗口）。⌘⇧N 无效（W1）。 | 部分验证 |
| 161 | 窗口与标签页 | 多窗口文档 | Shipped | 未验证 | 跨窗口保存未测。 | 部分验证 |
| 162 | 窗口与标签页 | 全局窗口状态持久化 | Partial | 未验证 | 未做位置/大小重启核对。 | 未验证 |
| 163 | 窗口与标签页 | 按文件记忆窗口几何 | Partial | 未验证 | 未测。 | 未验证 |
| 164 | 窗口与标签页 | 原生 Window 菜单 | Shipped | 通过 | Window 菜单 Minimize(Ctrl+M) / Maximize / Close(Alt+F4)；Window → Close 关掉第二窗口（no_unsaved_closing → allowed_close）。 | 部分验证 |
| 165 | 窗口与标签页 | 标签栏配置 `TabBarConfig` | Stub | 一致（无入口） | 设置里没有标签栏配置。 | 未验证 |
| 166 | 窗口与标签页 | 标签页进阶能力 | Stub | 未验证 | 未在标签上右键/中键。 | 未验证 |
| 167 | 平台集成 | 原生 macOS 菜单栏 | Shipped | 平台不适用 | Windows 有原生菜单栏：mdpro / File / Edit / View / Format / Theme / Window / Help，结构照搬 macOS（含「mdpro」应用菜单）。 | 平台不适用 |
| 168 | 平台集成 | 应用菜单基础项 | Shipped | 通过 | Windows 上 mdpro 菜单有 About / Preferences / Services / Hide(Ctrl+H) / Hide Others / Show All / Exit。Hide（同一次运行里打开并点击）使窗口隐藏、任务栏按钮保留，与 macOS 一致；Hide Others / Show All / Services 未测。2026-10-13 更正：原记「Hide 是空操作」是脚本误用。 | 部分验证 |
| 169 | 平台集成 | 应用内更新检查 | Partial | 通过 | About 打开即检查：「You're up to date」（ui.about.update_check hasUpdate=false）。 | 与描述不符 |
| 170 | 平台集成 | 重启应用更新 | Shipped | 未验证 | 当前无可用更新。 | 未验证 |
| 171 | 平台集成 | 重启前保存守卫 | Shipped | 未验证 | 无可用更新，无法触发重启。 | 未验证 |
| 172 | 平台集成 | 版本号显示 | Shipped | 通过 | About 显示 Version v0.3.1；HTTP /api/status 与 MCP initialize 均为 0.3.1。 | 已验证 |
| 173 | 平台集成 | 退出守卫：原生钩子、逐窗口提示与回复通道 `quit_guard_reply` | Partial | Windows 不通过 | 有 4 个脏文档时点 mdpro → Exit：进程立即退出，没有任何退出提示，日志没有 app.quit 或 quit-guard 事件。重启后只能靠草稿恢复（≤30 s 内的改动会丢）。 | 未验证 |
| 174 | 平台集成 | 退出卡住时的逃生口：mdpro 菜单 → Stop Waiting and Qu | Shipped | 部分 | 「Stop Waiting and Quit…」菜单项存在；未点。 | 部分验证 |
| 175 | 平台集成 | 云同步 | Absent | 一致（无入口） | 设置无账号/同步项。 | 部分验证 |
| 176 | 平台集成 | 协作编辑 | Absent | 未验证 | 立场项，未测。 | 部分验证 |
| 177 | 平台集成 | 版本历史 | Absent | 一致（无入口） | 无历史版本入口。 | 部分验证 |
| 178 | 平台集成 | 第三方插件市场 | Absent | 一致（无入口） | 设置无插件市场。 | 部分验证 |
| 179 | 平台集成 | 移动端 | Absent | 平台不适用 | 移动端。 | 未验证 |
| 180 | 平台集成 | Windows 构建 | Unknown | 部分 | 0.3.1 Windows 安装包能装能跑，核心编辑、保存（菜单）、导出、MCP/HTTP 可用；但有 W1–W7 等 Windows 专属缺陷（快捷键全失效、自存误报、本地图片被 CSP 拦截、退出绕过守卫等），不能写成 Shipped。 | 部分验证 |

## 证据

位于 [`test/windows-audit-20261012-claude/`](test/windows-audit-20261012-claude/)：

- `run-notes.md`：逐项运行记录（动作、日志行、DOM 读数），本报告的结论都能在这里找到出处。
- `export-basic.html`：File → Export HTML 的实际产物，用于 088–094。
- `wysiwyg-basic-footnotes.png`：WYSIWYG 渲染脚注（055）、整条路径的标签名（W5）。
- `image-blocked-by-csp.png`：相对路径图片显示为破图（044 / W3）。
- `theme-dark-source.png`：Theme → Dark，源码模式与 H2 徽标（121、081）。
- `narrow-window-sidebar-collapsed.png`：270% 缩放下窄窗口侧栏被挤压（W8）。
- `native-file-menu.png`、`native-mdpro-app-menu.png`：Windows 原生菜单，含 macOS 风格的 Services / Hide（167、168）。

## 运行记录与清理

- 测试文件全部在 `C:\Users\jack\mdpro-audit\fx\`（副本），未改动用户自己的文档。审计中产生的 4 份草稿已在恢复对话框里 Discard。
- 为接入调试端口，mdpro 被正常关闭后以 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 重启；审计结束后以普通方式重启，端口关闭。
- 只读接口、不改用户配置：未点客户端配置 Install、未改日志开关与级别、未改系统主题。字号改动已复原。
- 工具脚本已整理为项目 skill `.claude/skills/remote-windows-device-test/`（未随本提交），可复用。
