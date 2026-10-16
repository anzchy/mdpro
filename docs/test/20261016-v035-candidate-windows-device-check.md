# v0.3.5 候选包 Windows 真机检查（win-desktop，2026-10-16）

检查人：mdpro-codex-audit。方案：`~/.mdpro-redesign/handoff/mdpro-codex-audit-v035-wip/plan-v035-windows-candidate.md`。
用户授权（经 delegator 转述）：「同意，按方案执行 (Recommended)」。全程走 SSH，没有用 computer use 或 TeamViewer，
也没有截全屏；证据只有页面截图（`cdp.sh shot`）和 computed style，放在
[`windows-audit-20261016-v035c/`](./windows-audit-20261016-v035c/)。

## 1. 被测构建

| 项 | 值 |
|---|---|
| 候选包 | release run 38830353983（build-only，head `3315eb3e`），`mdpro_0.3.4_x64-setup.exe`，sha256 `25393059…a174`，在 PC 上核对过 |
| 安装 | `runi.ps1` 在桌面会话里静默安装 `/S /D=D:\programs\mdpro`，退出码 0；`tauri-app.exe` 从 `BBAA1907…` 变成 `84A08CEA…` |
| 证明 | `mdpro.sh debug --yes` 之后的 `app.ready`：**`releaseId` `0.3.4@3315eb3effdbd993f33047039f3ea6f5da4949c7`** |
| 版本号 | `3315eb3e` 没有改版本文件，所以这个包报告的是 0.3.4。它只能验证行为，不能作为 0.3.4 → 0.3.5 canary 的目标 |

窗口已最大化。开始时 innerWidth 是 1067，devicePixelRatio 是 2.7。

## 2. 结论

| 项 | 结论 | 摘要 |
|---|---|---|
| **D246** rm 删除 | **通过** 20/20，另有 2 个对照 | 每套主题 ×10 次永久删除，每次都弹「删除」提示；两次外部修改对照都弹「修改」提示 |
| D246 回收站路径（本方案额外加的） | **未验证** | 走 SSH 时 `SendToRecycleBin` 实际上是永久删除（见 § 3.1），没有走到回收站这条路径 |
| **D249** 引用和 h6 里的行内代码 | **通过** | 浅色 4.88:1，深色 7.20:1；链接里的代码保持强调色 |
| **D250** 焦点环和 Apply | **通过** | 开关环在两套主题、开和关状态下都可见；输入框是强调色边框加柔光；深色 Apply 是 `#1d4ed8`，悬停时更深，焦点环 `#60a5fa` |
| 冒烟：S2 代码底色 | **通过** | 浅色 `#f1f1f1`，深色 `#1c1e22`（行内代码和围栏代码一致） |
| 冒烟：D244 焦点环 | **通过**（抽查） | 图片菜单的按钮和 Settings 侧栏，两套主题都有 2 px 强调色环 |

## 3. 明细

### 3.1 D246（`file_watcher` 删除提示）

做法：每次从 `d246-master.md` 复制一份新文件，用 `ui.sh open`（单实例路由）打开，等 1.5 s，然后在 PC 侧删除；
2.5 s 后用 CDP 读页面文字，再按 Ignore 关掉提示；同时读 `file.change.decision` 日志行。主题用真实原生菜单
`Theme › Light/Dark` 切换（`menuclick`，开菜单和点菜单项在同一次运行里完成）。

| 主题 | `Remove-Item` ×5 | VisualBasic `DeleteFile(…, SendToRecycleBin)` ×5（经 SSH） | 外部修改对照 |
|---|---|---|---|
| 浅色 | 5/5 `File was deleted externally`，`action: deleted-prompt` | 5/5 同上 | `File was modified externally`，`reload-prompt` |
| 深色 | 5/5 同上 | 5/5 同上 | 同上 |

没有一次删除弹出「修改」提示。D246 行里的验收（「每套主题 rm ×5，每次都是删除提示」）已经满足。

**回收站路径没有走到**：事后去回收站找这些文件，一个也没有。复核：
- 在 SSH 会话（session 0）里对一个探针文件调用同样的 `DeleteFile(…SendToRecycleBin)`：文件没了，`$Recycle.Bin` 里没有它的 `$I` 记录。
- 在桌面会话（session 1）里经 `runi.ps1` 调用同样的方法：文件进了回收站（`$IV4CPU5.txt`）。

所以那 10 次「回收站」实际上是永久删除，结论只能算进 rm 一栏。要验证回收站路径（Explorer 的删除是把文件移进
`$Recycle.Bin`，对监视器来说可能是 rename），需要在桌面会话里通过 `runi` 删除并重跑。这需要重新安装候选包、
重启 mdpro，得到用户新的同意后才能做。探针文件已经从回收站里删掉了。

### 3.2 D249（`d249-*.png`、`d249-probe-*.json`）

fixture 里有段落、引用、h6 里的行内代码，引用和 h6 里各有一个链接包着的代码，还有一段围栏代码。下表的像素取自
页面截图（`pix.py`），并和 computed style 对应。

| | 底色 | 引用 / h6 代码 | 链接里的代码 | 普通 / 围栏代码 |
|---|---|---|---|---|
| 浅色 | `#f1f1f1` | `#636976`，**4.88:1** | `#2563eb`，4.58:1 | `#1a1a1a`，15.41:1 |
| 深色 | `#1c1e22` | `#a2abb8`，**7.20:1** | `#60a5fa`，6.56:1 | 13.48:1 |

Milkdown 渲染出来的结构是 `<code><a>…</a></code>`，所以强调色来自 `a`。

### 3.3 D250（`d250-*.png` / `.json`）

焦点只用真实的 Tab 键移动（`ui.sh chord`，`nofocus`），没有拨动任何 MCP 开关。三个开关在检查前后都是
on / off / off。

| 对象 | 浅色 | 深色 |
|---|---|---|
| Integrations 三个开关（Tab 第 10–12 次） | `:focus-visible`，`outline solid 2px #2563eb`，offset 2px；像素：环 ×7，白色间隙 ×7，然后是轨道 | 环 `#60a5fa` ×7，间隙 `#141821` ×7；开状态的轨道也是 `#60a5fa`，靠间隙分开 |
| 图片菜单 Custom… 宽度输入框 | 边框 `#2563eb`，`box-shadow` 柔光（0.14，2px），没有 outline；像素 `#e0e9fc` 柔光，然后是 `#2563eb` 边框 | 边框 `#60a5fa`，柔光 0.22 2px；像素 `#253751`，然后是 `#60a5fa` |
| Apply（Tab 聚焦） | 底色 `#2563eb`，白字；环 2px `#2563eb`，offset 2px | 底色 **`#1d4ed8`**，白字，环 **`#60a5fa`**；像素：环 ×7，间隙 ×7，`#1d4ed8` |
| Apply 静止（深色） | — | `#1d4ed8`，没有环 |
| Apply 悬停 | `#245ad2`（比 `#2563eb` 深），`:hover` 为 true | **`#1a45be`**（比 `#1d4ed8` 深），白字，环还在 |

悬停是这样做的：CDP 把鼠标移到 Apply 上，按下右键（`__a.click(…,{button:"right"})`），不会触发应用；
前后的图片宽度都没变。

### 3.4 冒烟

- **S2**：见 § 3.2 的底色。行内代码和围栏代码的底色一致，浅色 `#f1f1f1`，深色 `#1c1e22`。
- **D244**：
  - 图片菜单的 25%、50%、75%、100%、Custom… 依次用 Tab 聚焦，都是 `solid 2px` 强调色、offset −2px（浅色 `#2563eb`，深色 `#60a5fa`）。
  - Settings 侧栏的 Editor 和 Export：同样的环（`d244-*-rail.png`）。
  - 注意（工具问题，不算缺陷）：每次 `ui.sh` 运行前，窗口会先 blur 一次。浅色那次逐键发送时，图片菜单在第 2 次 Tab 后关了。改成把多个 Tab 放在同一次运行里发（只有一次 blur），菜单就一直开着：第 2、3、5 次 Tab 分别停在 50%、75%、Custom…。所以把它记为工具引起，不记失败。

## 4. 恢复到正式版 v0.3.4

1. 用 `close.ps1` 关闭 mdpro（24 个标签，没有脏文档），`tauri-app` 为 0。
2. `runi.ps1` 静默安装发布资产 `rel-v0.3.4-setup.exe`（sha256 `747ee705…5140`，在 PC 上核对过），退出码 0；同版本的重装没有被跳过，没有用到卸载这条后备路径。`tauri-app.exe` 变成 `108B614E…`，`mdpro_mcp.exe` 变成 `BECE1079…`；`Uninstall\mdpro` 仍是 0.3.4，位置 `D:\programs\mdpro`。
3. 用 `mdpro.sh normal --yes` 普通模式启动一次（没有开 9222）：`app.ready` **`releaseId` `0.3.4@3b16610b9031db2f4530282c80c33952258c5fe5`**，`appVersion` 0.3.4。关于对话框没有打开，因为普通模式下没有 CDP。之后关闭 mdpro。
4. 配置从 `snap\v035-cand-1` 恢复（`robocopy /MIR /XF mdpro.log`）。`config.json` 从 `E95F2E08…` 变回 **`F417022A…`**，草稿 0 个，日志保留。
5. 已删除：`inst\` 下两个安装包、快照 `snap\v035-cand-1`（里面有 MCP token）、回收站探针。
   保留：`inst\part-aa`，这个文件在本次运行之前就有，等用户处理；`fx\v035c\` 下的 fixture。

结束状态：正式版 v0.3.4（`3b16610b`）装在 `D:\programs\mdpro`，mdpro **未运行**，9222 关闭，没有
`mdpro-audit-*` 计划任务，`config.json` `F417022A…`。和开始时相比，唯一有意的区别是：装的是正式版，而不是手装的 `f8f3f664`。
