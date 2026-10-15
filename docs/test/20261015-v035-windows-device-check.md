# v0.3.5 Windows 真机检查，win-desktop（2026-10-15）

执行方：mdpro-codex-audit，从 MacBook 经 SSH 操作，用项目 skill `remote-windows-device-test`。delegator 转达的用户原话：「now do device checks」；安装：「I have manually installed the newly built exe package, just do the windows device test」。没有用 computer use，没有用 TeamViewer。时间均为 +0800，22:47–23:58。

检查项是 delegator 简报里的 1–8（0.3.5 门禁的 Windows 部分）。结论用词：通过 / Windows 不通过 / 部分 / 未验证，含义同 [`20261015-v034-windows-device-check.md`](20261015-v034-windows-device-check.md)（下称「0.3.4 记录」）§ 0。

证据在 `docs/test/windows-audit-20261015-v035/`：
- `results-log.txt`：逐条运行记录（按键、日志行、DOM 读数），按运行脚本分段；
- `c4-late-mdpro-log.txt`：检查 4 超时那组的 mdpro.log 原文；
- `c4.sh`、`sc.js`：检查 4 的运行脚本与页面探针（`mcpapi.ps1` 在 PC 上本地读 token，不打印，未收入）；
- `menus.txt`：原生菜单树；
- mdpro 窗口截图（`ui.sh shot` / `cdp.sh shot`，只含 mdpro 窗口；`v035-c2-about.png` 已裁掉窗口下沿的桌面边）。

没有全屏截图进入证据目录。

## 0. 构建身份与前置

| 项 | 值 |
|---|---|
| 构建 | f8f3f664（0.3.5 候选；版本号文件尚未 bump，仍报 0.3.4） |
| 安装 | 用户手动安装；`D:\programs\mdpro\tauri-app.exe` LastWriteTime 21:18:30 |
| `app.ready` | 21:41:01.837，`releaseId` = `0.3.4@f8f3f664d950279c3de733978e0ef17f582fad6b` |
| 窗口 | `mdpro.sh debug --yes`（约 22:47）→ `maximized`，`innerWidth` 1423；检查 8 前再 `max` 一次，1407 |
| 输入法 | 运行开始时为 English (US) 布局；检查 6 用 Win+Space 切到微软拼音，结束时再按 Win+Space 切回 |
| Fixture | `d226.md`、`d208.md`、`lk.md`、`t1.md`–`t3.md`，放在 `C:\Users\jack\mdpro-audit\fx\v035\`（副本，提交的原件未动） |

**路线。** 每个按键都是真键（`ui.sh chord`，`clickat` 进编辑器后加 `nofocus:true`）；菜单用 `menuclick` 一次完成打开与点击。CDP 只放光标、选区、读 DOM，以及检查 7 的一次 `__a.text` 输入（见 § 2 检查 7）。

## 1. 结论表

| # | 条目 | 结论 | 证据 |
|---|---|---|---|
| 1 | D224 Settings › About 更新检查 | 通过 | `22:49:02.306 ui.about.update_check success outcome platform-not-offered`（22:48:49.602 开始）。最终页面为「Automatic updates coming soon.」，只有 Close 按钮（`v035-c1-about-settings-final.png`）。附注见 § 3 |
| 2 | D225 mdpro › About | 通过 | 真菜单 `menuclick mdpro›About` → 原生窗口「About mdpro」，UIA 文本 `Name: mdpro / Version: 0.3.4 / Website: GitHub https://github.com/anzchy/mdpro`，按钮「确定」（`v035-c2-about.png`）。该原生菜单项不写日志，证据是 UIA 树 |
| 3 | D226 有序列表起始号 | 通过 | W 中 `d226.md`（5,6,7）与 `d208.md`（5,6）：`ol start=5`，显示 5./6./7.（`v035-c3-d226.png`、`v035-c3-d208.png`）。在 EDIT 行输入 `x` 后 Ctrl+S：`file.save success` 36 B 与 27 B；diff 只有 EDIT 行变化 |
| 4a | D240 Link 打开时 MCP 写入，Enter | 通过 | 22:55：Link 打开，写入从前台 PowerShell 控制台发出（`window_focused:false`），`22:55:01.961 ui.mcp_confirm.held`。Link URL 框内真 Enter → `ui.link-modal.submit`，随后确认框出现，焦点在 Reject。点 Approve → `STATUS 200`，`mcp.confirm success outcome approved`。链接插入见 22:54 那组（`https://x.t=LINK`）（`v035-c4a-prompt.png`） |
| 4b | D240 同上，Escape | 通过 | 23:00：`23:00:03.128` held。真 Esc → `ui.link-modal.cancel`，无 reject 日志，写入仍挂起；确认框随后出现，焦点在 Reject。点 Reject → `STATUS 403`，`mcp.confirm fail outcome rejected`（`v035-c4b-prompt.png`） |
| 4opt | D240 挂起超过 60 s | 通过 | 23:00:55 held，`23:01:55.438 mcp.confirm fail timedOut`，curl `STATUS 408`。23:02:11 Link Enter 后轮询 3 s，确认框没有出现。没有 `ui.mcp_confirm.expired`：Rust 的 `confirm_resolved` 先撤掉了请求，expired 只是兜底路径 |
| 5 | D235 Settings 打开时 Ctrl+K | 部分 | 见 § 2 检查 5 |
| 6 | Link 框内输入法组字时的 Enter | 通过 | 见 § 2 检查 6 |
| 7 | Link 框的 Tab 循环与 Cancel | 通过 | 见 § 2 检查 7 |
| 8 | D231 底部标签：当前标签填充、×、Tab、Enter/Space 关闭、脏文档确认 | 通过 | 见 § 2 检查 8 |

## 2. 检查 5–8 细节

### 检查 5：D235，Settings 打开时按 Ctrl+K — 部分

| 步骤 | 结果 |
|---|---|
| 对照：编辑器内（无模态）真 Ctrl+K | Link 打开，焦点在 `link-insert-input`；`23:48:56.627 ui.link-modal.open`。真 Esc → `23:49:02.350 ui.link-modal.cancel` |
| 真菜单 `menuclick mdpro›Preferences...` | `23:49:09.127 ui.menu.select menu.file.preferences`，Settings 打开，焦点在 `settings-category-btn is-active` |
| Settings 打开时真 Ctrl+K | 没有 Link 弹出，只有 `settings-dialog` 一个模态，焦点不变（`v035-c5-settings-ctrlk.png`）。**没有** `ui.dialog.open cancel reason modal-open action format.hyperlink` 日志 |

行为上通过：Link 没有叠在 Settings 上。但 Settings 持有键盘焦点，Ctrl+K 根本没到编辑器的 keymap，`refuseModalOpenWhileModalOpen` 的拒绝路径**没有被走到**，所以记「部分」。要走到这条路径，需要一个模态打开而编辑器仍持有焦点的场景（D235-WI-2 的 Recovery 情形），本次没有搭出来。

### 检查 6：微软拼音组字时的 Enter — 通过

| 步骤 | 结果 |
|---|---|
| 第一次：真键 `nihao` + Enter | **未组字**：没有 `compositionstart`，值直接是 `nihao`，Enter 提交了链接（`23:50:27.570 ui.link-modal.submit urlLength 5`，落在 fixture 副本上）。当时布局是 English (US)，这一组不算数 |
| Shift 后再输入 | 仍未组字（English (US) 布局下 Shift 无作用） |
| Win+Space 切到微软拼音，真键 `nihao` | `compositionstart`，keydown `Process isComposing=true keyCode=229`，框内为 `ni'h'ao`（`v035-c6-composing3.png`） |
| 组字中真 Enter | `compositionend`，**Link 仍打开**，没有 submit 日志。这一次框内值为空（见下） |
| 对照 A：`nihao` + Space | 选候选，值 `你好奥`，Link 仍打开 |
| 对照 B：`nihao` + 组字中 Enter | `compositionend:nihao`，值 `nihao`，**Link 仍打开** |
| 组字结束后真 Enter | `Enter isComposing=false keyCode=13`，提交：`23:52:26.625 ui.link-modal.submit urlLength 5`；这是本次 Link 会话（23:50:49 打开）唯一的 submit |

组字中的 Enter 两次都只结束组字、不提交；组字结束后的 Enter 正常提交。第一次组字后框内值为空，对照 B 没有复现，原因不明（刚切换输入法后的第一次组字）；不作为 mdpro 的问题记录。

### 检查 7：Link 框的 Tab 循环与 Cancel — 通过

| 步骤 | 结果 |
|---|---|
| 空 URL 时真 Tab ×4、Shift+Tab | 焦点在 `link-insert-input` ↔ Cancel 之间循环，始终不离开对话框。Insert 在 URL 为空时 `disabled=true`，所以不在 Tab 序列里 |
| Tab 到 Cancel，真 Enter | Link 关闭，`23:53:25.398 ui.link-modal.cancel`；编辑器 `innerHTML` 的 md5 前后相同（`f16862f3…`），文档未变 |
| 补充：URL 填入 `x.t`（`__a.text`，避开输入法）后真 Tab ×3 | Cancel → Insert → `link-insert-input`，循环包含 Insert；真 Esc 关闭 |

### 检查 8：D231 底部标签 — 通过

| 步骤 | 结果 |
|---|---|
| 经单实例路径打开 `t1.md`–`t3.md` | `tab.open` ×3（23:54:22 / 28 / 35） |
| 当前标签填充 | `t3.md` 为 `bottom-tab--active`，背景 `color(srgb 0.827 0.830 0.843)`；其他标签透明。× 在当前标签上 opacity 0.5，其他标签 0（悬停/聚焦时显示） |
| 从 t1 的标签按钮起真 Tab ×5 | t1 × → t2 标签 → t2 × → t3 标签 → t3 ×，每一个 × 聚焦时 `:focus-visible`、opacity 1、`outline solid` 强调色（2 CSS px）。标签按钮自身 `outline:none`，环画在父级 `.bottom-tab:has(.bottom-tab__select:focus-visible)` 上，实测父级 `outline solid` 强调色（`v035-c8-tabwalk.png`） |
| t2 × 上真 Enter | `23:56:22.785 tab.close t2.md wasModified false` |
| t1 × 上真 Space | `23:56:35.250 tab.close t1.md wasModified false` |
| t3 改脏后，t3 × 上真 Enter | 确认框「Unsaved changes」出现，按钮「Keep editing」「Discard」，焦点在 Keep editing（`v035-c8-dirty-confirm.png`） |
| 回答 Cancel：Keep editing 上真 Enter | `23:57:10.765 ui.dialog.cancel dialog.confirm.cancel`，t3 仍打开且为脏 |

## 3. 偏差与附注

1. **检查 1 的中间态。** 约 12.7 s 的检查过程中，页面显示「Checking for updates...」和一个 **Check Again** 按钮；结束后才变成最终文案、只剩 Close。最终状态符合 D224，中间态记此备查。
2. **检查 4 的工具链教训。**
   - 发出写入的控制台在收到回复前一直占着前台，所以每次点击前先用 `focus` op。
   - 一次 `focus`（轻按 Alt）关掉了 Link（`22:57:09.134 ui.link-modal.cancel`）；随后确认框出现，我按 Link 输入框位置的盲点击落在 MCP 背景上，得到 403。这次 403 是工具链造成的，不计入结论。
   - 两组因工具链延迟超过 60 s：22:54 那组读数晚于截止时间；22:59 那组确认框出现 90 ms 后 408 就把它关了。结论取自 22:55 / 23:00 两组。
3. **检查 6 的第一组未组字**，提交了一个 `nihao` 链接到 `lk.md` 副本；该副本最后被 Discard，见 § 4。
4. **检查 5 只得「部分」**，原因见 § 2。

## 4. 恢复与清理

- 脏的 fixture 副本 `lk.md`、`t3.md` 经 × → Discard 关闭（`23:57:41.672`、`23:57:55.155 tab.close wasModified true`）；剩下的 `d226.md`、`d208.md` 已保存。
- `mdpro.sh normal --yes` → `maximized`，9222 已关闭，mdpro 以普通模式运行；`23:58:10.363 app.ready releaseId 0.3.4@f8f3f664…`，`file.draft.list listed 0`（无草稿）。`mdpro.sh cleanup` 后没有残留的 `mdpro-audit-*` 计划任务。**f8f3f664 保持安装。**
- 输入法：检查 6 结束时 Win+Space 切回，未再读 `hkl` 复核。
- `C:\Users\jack\mdpro-audit\` 留下：`fx\v035\`（副本已被本次改动）、探针脚本、`out\`、窗口截图，以及一份未使用、可能不完整的 `mdpro_0.3.4_x64-setup-f8f3f66.exe`（用户自行安装后我中止了上传）。删除属于 rule 25 操作，没有做。

## 5. 汇总

- 1–4、6–8 通过；5 为「部分」：行为正确（Settings 上不会再叠出 Link），但拒绝路径的日志在这条路线上走不到。
- 本次没有发现新的 Windows 问题。
