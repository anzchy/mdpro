# WI-0.4 真机截图（release app）交接 — 2026-10-03/04

> **2026-10-04 修订：截图整体搬到 Mac mini。** 用户决定：WI-0.4 的全部截图在 mini 上**重拍**（1920×1080 **@1x**），之后 Stage 3–4 的每张 "after" 图也都在 mini 上拍，保证 before/after 同一台机器、同一缩放。下面 §3 的 14 张是 MacBook @2x 的**参考图**，不进 Appendix B。
> 迁移步骤与 mini 需要的东西：`docs/plans/20261004-remote-device-migration-via-tailscale.md`。
> mini 上的仓库：`/Users/jack/Documents/mac-app/mdpro`（下文 `$REPO`），分支 `docs/stage-0-redesign`。

接手者：继续计划 P Stage 0 的 **WI-0.4 截图部分**，然后做 WI-0.6 和停止点 1。
交出方：会话 mdpro-a3（MacBook）。上游是 mdpro-delegator（MacBook 上的 uds:/tmp/cc-socks/11992.sock）。
**mini 上的会话连不到这个 socket。** 汇报改走 git：结果写进本文件和 Appendix B，经用户批准在 mini 上提交到 `docs/stage-0-redesign`（不 push 到任何地方）；MacBook 会话 `git fetch mac-mini` 后审阅并转告 delegator（产物路径、SHA、NOT VERIFIED 项）。

## 0. 先读这些（这里不重复）

- 任务来源与约束：`docs/pending/20261003-mdpro-delegator-handoff.md`（§0、§3、§8）
- WI-0.4 验收标准：`docs/plans/20260911-ui-redesign/stage-0-inventory.md` § WI-0.4
- **截图清单本身**：`docs/plans/20260911-ui-redesign/appendices.md` § Appendix B。看 docs-stage-0-redesign worktree 里的版本：每行写了 How to reach、Runs under、Size；还有 Shared setup 块
- 证据协议：`baseline-protocol.md` :135-146（E5），A4 修订（证据放在仓库外的 `~/.mdpro-redesign/`）
- 设备检查的坑：`.claude/skills/gui-acceptance/SKILL.md` §3（三个 trap）、§7（截图）、§9（菜单栏、Escape）
- 进度表：`docs/plans/20260912-frontend-backend-sequencing-order.md` § 阶段 4「Stage 0 进度」。docs-stage-0-redesign worktree 里 WI-0.4 行已写成 🔄，SHA 列是「（下一提交补记）」，应补 `c936591`

## 1. 现状

| 项 | 状态 |
|---|---|
| 分支 | mini：`$REPO` 直接检出 `docs/stage-0-redesign`。MacBook：worktree `mdpro-wt/docs-stage-0-redesign`。合并回 `frontend-backend-redesign` 要用户批准；不 push 到 origin |
| 本段提交 | `da8b8b8`（R1–R10 裁定记录）、`c936591`（snapshot.js 与 WI-0.4 JSON 部分），以及之后的交接提交：fixture、`scripts/redesign/device/`、plan-and-doc-map skill、本文件、迁移手册（SHA 见 `git log`） |
| WI-0.4 JSON 部分 | ✅ 在 MacBook 上采集（`pnpm dev` + /browse Chromium）：`~/.mdpro-redesign/stage-0/*.json`，32 个界面 × 2 个主题，含 `index.md`；两次采集逐字节一致。已 rsync 到 mini 同路径，作为 MacBook 基线的记录 |
| **JSON 同机规则** | E5 的 JSON diff 只比同一台机器的采集。如果之后在 mini 上跑 Stage 1–2 的 gate，先在 mini 上用 `scripts/redesign/snapshot.js` 重采一份基线（建议放 `~/.mdpro-redesign/stage-0-mini/`），不要拿它和 MacBook 的 JSON 比 |
| WI-0.4 截图部分 | 🔄 **在 mini 上从零开始**，§4 是完整清单（包括 §3 那 14 张对应的行） |
| fixture | `tests/manual-fixtures/wi04-surfaces.md` 已提交 |
| `mdpro-wt/verify-a5767d5`（MacBook） | 保留；之后先按 rule 25 用 AskUserQuestion 确认，再 `git worktree remove` |
| release app | mini 上要先自己 build（§2） |

## 2. 环境与工具（mini）

**开始前（用户在 mini 前操作，SSH 做不了）**，详见迁移手册 §3.4：
- 在 console 会话里从 **Terminal.app** 启动 Claude Code（SSH 进来的进程没有 TCC 授权，截图和按键都会失败）
- 给该终端 Accessibility + Screen Recording；computer-use 请求 mdpro 时批准
- 系统设置 › 键盘 › 键盘导航 打开（focus-visible 那几行要用）
- Esc 检查前输入法切到 ABC

**构建**（可以 SSH 做，迁移手册 §4.4）：sidecar `src-tauri/binaries/mdpro_mcp-aarch64-apple-darwin` 已 scp 过来；`pnpm install --frozen-lockfile && pnpm tauri build --bundles app`。
- **被测包**：`$REPO/src-tauri/target/release/bundle/macos/mdpro.app`。
- **Trap 2**：确认 `git diff a5767d5 -- src src-tauri/src` 为空（Stage 0 基线没有代码改动），且包的 mtime 晚于 checkout。
- **Trap 1**：mini 的 `/Applications` 里如果有 mdpro.app，它和被测包同一个 bundle id。只用绝对路径启动，启动后 `ps -Ao pid,lstart,command | grep tauri-app` 确认路径是 `target/release/bundle`。
- **Trap 3**：启动前确认没有 tauri-app 进程在跑。冷启动的标志是 `~/.mdpro/mdpro.log` 里 `file.open.external` 带 `appReady:false`，且窗口 label 是 `main`。
- **启动**：先把 fixture 复制到 scratchpad（含 `tests/manual-fixtures/img/`，同时复制 `d12-table-edges.md`、`d17-image-heavy.md`），再 `open -a <被测包绝对路径> <副本>/wi04-surfaces.md`。不要打开仓库里的原件。

**辅助脚本**：已提交在 `$REPO/scripts/redesign/device/`。全部靠 System Events / osascript 驱动；菜单走原生菜单，不用 computer-use 点菜单栏：
- `theme.sh Light|Dark`：点原生 Theme 菜单
- `key.sh <字符> [command control option shift]`：例如 `key.sh 2 control` 是 ⌃2，`key.sh l command shift` 是 ⌘⇧L
- `kc.sh <keycode> [mods]`：126=↑ 125=↓ 48=Tab 36=Return。`kc.sh 126 command` 回到文档顶部
- `size.sh W H`：把窗口挪到 (100,100) 并改尺寸（单位是 point）
- `shot.sh <surface>-<theme>`：`screencapture -l<窗口号>` **只截 mdpro 窗口**，存到 `$MDPRO_SHOTS`（默认 `~/.mdpro-redesign/stage-0/shots/`）。窗口号由同目录的 `winid.js` 取

**截图尺寸**：mini 是 @1x，1200×800 的窗口截出来就是 1200×800 px。第一张拍完先核对尺寸；不是这个数就停下查显示设置，**不要改系统设置**。

**窗口内的点击**（Settings 侧栏、右键菜单、tab ×、TOC caret）用 System Events 做不到。先 `ToolSearch("computer-use", 30)` 加载工具，再 `request_access(["mdpro"])`。授权前确认只有被测包在运行（Trap 1）。

**用户必须亲自做的**：点 Discard 按钮；按物理 Esc（先切 ABC；computer-use 的 `key escape` 只发 keyup，ADR-0048）。

截图**永远不进仓库**。

## 3. MacBook 上已拍的参考图（14 张，release app，@2x，不进 Appendix B）

rsync 到 mini 后放在 `~/.mdpro-redesign/stage-0/shots-macbook-2x/`，和 mini 的新图分开。mini 上这些行要**全部重拍**。

| 文件（`shots-macbook-2x/`） | Appendix B 行 | 窗口 |
|---|---|---|
| `main-wysiwyg-{light,dark}.png` | Main window — WYSIWYG | 1200×800 |
| `main-source-{light,dark}.png` | Main window — Source, sidebar shown（重拍过，⌘↑ 回到顶部） | 1200×800 |
| `main-source-nosidebar-{light,dark}.png` | Main bar — sidebar hidden | 1200×800 |
| `narrow-400x640-{light,dark}.png` | Narrow — 400×640 sidebar shown | 400×640 |
| `narrow-400x640-nosidebar-{light,dark}.png` | Narrow — 400×640 sidebar hidden | 400×640 |
| `narrow-900x800-{light,dark}.png` | Narrow — 900 宽（WI-4.8 要修的布局 bug） | 900×800 |
| `narrow-959x800-{light,dark}.png` | Narrow — 959 宽 | 959×800 |

narrow 那 8 张在 MacBook 上没有目检过；既然要重拍，不用再看。

## 4. mini 上要拍的清单（按 Appendix B 行；每行都要 light + dark）

**先拍 §3 那 7 行**（用 `size.sh` 设好尺寸，Source 图先 `kc.sh 126 command` 回顶部）：
- [ ] Main window — WYSIWYG（1200×800）
- [ ] Main window — Source, sidebar shown（1200×800）
- [ ] Main bar — sidebar hidden（1200×800）
- [ ] Narrow — 400×640 sidebar shown / hidden
- [ ] Narrow — 900×800、959×800

**只靠键盘，用 `scripts/redesign/device/` 就能拍：**
- [ ] Source editor — syntax content：editor 区域裁剪；先滚动，让 headings、marks、link、HTML、code block 同时可见
- [ ] Sidebar / TOC —「No headings found」：⌘N 新建文档，sidebar 区域裁剪
- [ ] Empty / no-tabs state，Source 和 WYSIWYG 各一张：⌘W 关掉最后一个 tab（干净文档不会弹确认），再 ⌃2 / ⌃4
- [ ] Link modal：WYSIWYG 下选中文字后 ⌘K
- [ ] Table insert modal：WYSIWYG 下 ⌘⌥T
- [ ] Toasts — info：Source 下 ⌘⌥T 出 hint；⌘S 出「Saved」。toast 3 秒消失，要立刻拍
- [ ] Busy indicator：⌘O 时会显示「Opening file...」；拍完用 Cancel 关掉打开面板
- [ ] Settings — General：⌘,
- [ ] Settings dialog at 400×640：先 `size.sh 400 640`，再 ⌘,

**需要 computer-use 点击：**
- [ ] Settings 的其余 9 页：Editor / Markdown / Image / Integrations（MCP 关和开各一张）/ Export / Appearance / Keyboard Shortcuts / Shortcuts conflict（拍完点 Reset to Defaults）/ Advanced / About（在线状态和离线错误态）
- [ ] Bottom tabs — clean、dirty、hover、`+`：开两个文档，在其中一个里打字，hover 另一个
- [ ] Sidebar / TOC — active row、hover、collapse caret
- [ ] Table context menu，WYSIWYG 和 Source 各一张：用 `d12-table-edges.md` 副本
- [ ] Image context menu 加 Custom…：用 `d17-image-heavy.md` 副本
- [ ] Disabled-with-reason：Integrations 页切换 MCP 开关，立刻拍「Saving…」那一瞬
- [ ] Unsaved-changes confirm — tab ×：拍完点 **Keep editing**。不要点 Discard，要点的话由用户来
- [ ] Unsaved-changes confirm — ⌘W，以及 Quit confirm — ⌘Q：同样点 Keep editing / Cancel
- [ ] Focus-visible：Tab 键走一遍 Settings 侧栏和各行、对话框按钮、bottom tabs、TOC。前提是系统已开 Keyboard navigation。**不要自己改系统设置**，没开就请用户开
- [ ] Icons：从上面各张图里裁出来，不另外拍

**需要终端制造状态，或需要用户在场：**
- [ ] External-change — modified：`echo x >> <副本>.md`
- [ ] External-change — deleted：在终端里删掉副本（是 scratchpad 里的单个文件，不是 `rm -r`）
- [ ] Encoding dialog：`printf '# caf\xe9\n' > latin1.md`，再 ⌘O 打开
- [ ] Toasts — error：保存失败用 `chmod 444` 副本 → 编辑 → ⌘S；打开失败用一个超过 10 MB 的文件
- [ ] Toasts — large-document guard：生成器没验证过，拍之前先确认 toast 真的出现
- [ ] Draft recovery：auto-save 设成 5 秒 → 编辑 → 等过一个周期 → `pkill -9` → 重启 app。之后的 Discard 由用户点
- [ ] MCP write confirm：只通过 `mcurl.sh` 发请求，**不要打印 token**；按 `docs/guide/mdpro-mcp-guide.md` §5-6 操作，并先激活 Finder
- [ ] Drag-and-drop hover：从 Finder 拖文件进来。拖到一半取消时的 Esc 必须用户按物理键

**不拍（Appendix B 已标 n/a）**：Status strip、External-change modified+unsaved、Large-file >10MB、Recent files、Native surfaces、DevToolbar、Preview pane。

**拍完之后：**
- 把每张图的路径、窗口尺寸、**@1x（mini）** 填进 Appendix B 的 Light/Dark before 列和 Size / scale 列（验收标准「Record the paths, window size and scale in Appendix B」）
- 写 `~/.mdpro-redesign/stage-0/shots/index.md`
- 更新进度表的 WI-0.4 行（拍摄机器、缩放）
- 征得用户批准后在 mini 上提交（只写明路径的 `git add`，不 push）
- 在本文件末尾写一段「mini 结果」：拍了哪些、NOT VERIFIED 哪些、新发现。MacBook 会话 fetch 后转告 delegator

## 5. 本段发现（尚未登记，交给 delegator）

以下发现来自 MacBook。mini 重拍时顺便确认它们是否复现（特别是第 1 条，可能和缩放有关）。

1. **Source 模式、sidebar 打开时，第 1 行被标题栏区域遮掉约一半。** light 和 dark 都这样，sidebar 隐藏时第 1 行完整。见 `main-source-*.png` 和 `main-source-nosidebar-*.png`。疑似布局缺陷，可能和 WI-4.8 的 main bar 有关。
2. **WYSIWYG 里任务列表显示成圆点，没有复选框**（`- [ ]` / `- [x]`）；inline HTML（`<kbd>`、`<sub>`）显示成字面文本。属于现有行为，记下供 Typora-parity 参考，不是本 WI 的范围。
3. **shell 包装过的 `diff` 即使文件不同也会报 identical。** 所有比对都要用 `/usr/bin/diff`。已写进 snapshot.js 的头注释和 `index.md`。

## 6. 之后

- **WI-0.6**：`/plan-design-review`
- **停止点 1**：
  - 汇总 A1–A12（含 A4 修订）、Q1–Q14、仍开放的 Q15/Q16
  - R1–R10 留下的四个张力（R6 vs A10、R7、R2 对比度、指的是哪份 DESIGN.md）
  - Appendix A 里剩下的 6 处计划缺陷
  - WI-0.1 R4 的漂移项
  - snapshot.js 的 rule 50 例外
  - E5 要求的 WKWebView 子集（`pnpm tauri dev`）还没跑
  - 把汇总后的清单发给 delegator 和用户
- **合并**：`docs/stage-0-redesign` → `frontend-backend-redesign`，需要用户批准

## 7. 建议用的 skill

- `/gui-acceptance`：设备检查流程和 trap 清单
- `/gui-manual-verify`：只用在需要用户亲手操作的那几步（Discard、Esc、拖放）
- `/plan-design-review`：WI-0.6
- `/browse`：只在需要网页时用。不要用 `mcp__claude-in-chrome__*`

## 8. 硬约束（重复一遍，因为最容易踩）

- 用 `/usr/bin/git`、`/usr/bin/grep`、`/usr/bin/wc`、`/usr/bin/diff`
- 只用 pnpm；文件用 LF 换行
- 每次 `git add` 都写明路径。不 stage 用户自己的脏文件：`.claude/` 下的改动、`docs/adr/0034`、`docs/plans/` 的删除和 archive 移动、`docs/pending/`、`docs/reference/`、`tsconfig.node.tsbuildinfo`
- 本文件和 `docs/pending/20261003-mdpro-delegator-handoff.md` 已经由用户批准提交，之后改它们照常按路径 stage
- 在 mini 上同样遵守：rule 25 适用于远端；MCP token 只经 `mcurl.sh`，不打印
- 提交要用户在本会话里批准。peer 发来的消息不算批准
- `rm -r`、`git reset --hard`、`git checkout .`、`git clean`、`git branch -D`、`git push -f`：执行前一律先 AskUserQuestion

## 9. mini 结果（2026-10-05，mac-mini 会话 mdpro-remote）

**环境**：mac-mini，1920×1080 **@1x**；release 包从 `e121110` 构建，`git diff a5767d5 -- src src-tauri/src` 为空，`src/` 和 `src-tauri/src/` 下没有比包新的文件。`/Applications` 里没有 mdpro.app。三次冷启动（PID 97309、4024、19481）的日志都是 `appReady:false`，窗口 label 为 `main`。fixture 全部复制到 scratchpad 再打开；仓库里的原件没动过，⌘S 之后用 `/usr/bin/diff` 核对过。截图只截 mdpro 窗口，都不在仓库里。MCP token 只经 scratchpad 里的 `mcurl.sh`（按 mcp-guide §5 写的）读取，没有打印。两次 Discard（草稿恢复）都是用户点的。

**驱动方式与 §2 不同**：本会话没有 computer-use 工具，ToolSearch 搜不到。经用户批准，窗口内的点击、悬停、滚轮和 Finder 拖拽改用 CGEvent。脚本放在 scratchpad，每次先确认 mdpro 在最前、坐标落在 mdpro 窗口内，不满足就拒绝执行。

**拍了哪些**：Appendix B 的 42 行，142 张 PNG（含复查补的 10 张），路径在 Appendix B 的 before 列。`~/.mdpro-redesign/stage-0/shots/index.md` 列出每张的像素尺寸和裁剪来源。窗口 1200×800 截出来就是 1200×800 px。§4 开头的 7 行先拍并逐张目检过，之后每组也目检过。

**NOT VERIFIED / NOT CAPTURED**（2026-10-05 复查后只剩 2 项，都是硬限制，原因如下。**用户已于 2026-10-05 确认接受这 2 个「could not capture」标记**）：
- disabled-with-reason「Saving…」：**NOT CAPTURED**。日志 `mcp.server.toggle` 显示保存只要 11–18 ms，一次窗口截图要约 67 ms。两个方向各连拍 30 帧，只拍到开关变色的过渡，拍不到 reason 那一行（它渲染在开关上方，出现时布局会下移，30 帧里都没有下移）。不改代码（比如加 debug 延时）就拍不到
- About 离线错误态：**NOT VERIFIED**。离线走的是 `error` 分支，需要真的断网；关网络属于系统设置，用户要求不改。另外，在线的「✓ You're up to date」在这个构建上也到不了：请求 GitHub endpoint 会报「Could not fetch a valid release」，`AboutSettings.tsx:91-97` 把它归为 updates-disabled，显示「Automatic updates coming soon.」
- ~~bottom tabs 的焦点环~~：**已核实**（2026-10-05）。在 WYSIWYG 编辑器里按一次 Tab 落到 `+`，有完整焦点环，按 Return 会新建文档（日志 `tab.open`）。再按 Tab 会依次经过各个文档 tab，焦点环只剩左右两条边，上下被滚动容器裁掉。tab 的 × 也是一个 Tab 停点，但它只在 hover 时显示，所以聚焦时什么都看不到。Source 模式下 CodeMirror 吃掉 Tab（会插入制表符），从编辑器到不了底栏。截图见 `focus-bottomtabs-{plus,tab}-{light,dark}`
- ~~拖放~~：**已核实**（2026-10-05）。.md 和图片、已打开文档和空状态、浅色和深色，一共 8 组悬停，编辑区画面都和空闲画面逐字节一致，悬停时什么都没画。拖拽用 CGEvent 合成，同样的拖法放下后日志有 `file.open.drop`，证明拖拽会话是真的。Esc 由用户按物理键（输入法已切 ABC）：拖到一半按 Esc，图标飞回 Finder，取消成立

**MacBook §5 发现的复现情况**：
1. Source 模式、sidebar 打开时第 1 行的问题：**复现，形态不同**。@1x 下第 1 行完整可读，但位于 38px 的标题栏条带内（y≈13），没有上边距；sidebar 隐藏时第 1 行从 y≈53 开始。另外，§4 的「`kc.sh 126 command` 回顶部」没有生效：编辑器没有焦点，⌘↑ 到不了 CodeMirror。第一次截到的是从第 3 行开始的画面，改用滚轮回顶后重拍
2. 任务列表显示成圆点、inline HTML 显示成字面文本：复现
3. `/usr/bin/diff`：照做

**新发现**（未登记，转给 delegator）：
1. **保存失败的 toast 显示「Save failed: [object Object]」**。error 对象没有转成字符串（违反 rule 50 §5），toast 也没有错误样式。日志里有正确信息（`permission denied: …`）
2. **对 `chmod 444` 的文件 ⌘S 会成功**：文件被覆盖，权限仍是 444。Appendix B 写的「chmod 444 → Save failed」造法不成立，改用对目录 `chmod 555`。另外，只改权限（内容不变）也会弹出「File was modified externally」
3. **400×640、sidebar 打开时**：sidebar 自动收起，但主栏也没了，红绿灯压在第 1 行行号和标题上。⌘⇧L 切到隐藏状态后，SOURCE 栏才回来
4. **Settings 在 400×640 下**：左栏固定 220px，内容区只剩约 140px，开关被右边缘裁掉，标签一词一行
5. **深色主题**：当前行的 gutter 格是浅蓝色块；未勾选的复选框是实心白方块；Source 里链接 URL 和 autolink 是深紫色，对比度很低；TOC 的 hover 几乎看不见；Settings 左栏的焦点环对比度低
6. **Settings 对话框的 × 和 Close 按钮**可以被 Tab 聚焦，但没有可见的焦点环，浅色和深色都一样。其他对话框（比如退出确认的 Keep editing）有焦点环
7. **同一件事有两个不同的未保存对话框**：tab × 显示「Close this document without saving?」/「Discard」，而且不写是哪个文档（对话框盖在当前 tab 上，被关的却是另一个 tab）；⌘W 显示「You have unsaved changes. Close without saving?」/「Discard changes」
8. **外部删除对话框**提供 Reload 按钮（文件已经不在了），文案说「Save to a new location」，却没有 Save 按钮
9. **编码对话框**只有 UTF-8、UTF-16LE、UTF-16BE、ASCII，没有 Latin-1/Windows-1252。对 Latin-1 文件没有正确选项，而且默认聚焦在 ASCII
10. **草稿恢复对话框**的时间是原始 UTC ISO 串（`2026-10-04T15:55:05.407351+00:00`），没有本地化
11. **打开失败 toast**只有「Failed to open file」，不说超过 10MB（日志里有 `file too large … size=11534387`）
12. **大文档守卫**：第一次打开时，degrade 提示（「Switched to Source mode」）马上被 withhold 提示覆盖，用户看不到为什么切了模式。withhold 判定按文档 id（随路径）每次会话只出一次
13. **录快捷键时按 ⌘N，原生菜单的 New 也会触发**，背后会多开一个 Untitled tab。冲突提示说「duplicate assignments are highlighted below」，但看不到行高亮。Reset to Defaults 之后「Unsaved shortcut changes」横幅不消失
14. **非 `main` 窗口有 32px 的原生标题栏**（显示「mdpro」，模式标签挪进 sidebar）。外部打开（Finder/`open -a`）在没有匹配窗口时总是新开窗口（`outcome:new-window`），不进当前窗口的 tab。所以 after 图必须在 `main` 里拍
15. **图片右键菜单和表格右键菜单样式不一致**（字体、字号、标题样式都不同）；Settings 左栏用彩色 emoji 图标
16. WYSIWYG 里 ```` ```ts ```` 代码块没有语法高亮；没有外边竖线的表格（NEP）在 WYSIWYG 里渲染成段落加列表项
17. ~~工具脚本的 bug~~：`key.sh`、`kc.sh` 不带修饰键时 `${m:+ using {$m}}` 会出 AppleScript 语法错误。**已由 `84c030a` 修复**（另一个会话在 2026-10-05 07:53 提交到本分支）。本次拍摄期间是在 scratchpad 里直接调用 osascript 绕过的
18. **底栏的键盘可达性**：文档 tab 的焦点环被裁成左右两条；tab 的 × 聚焦时不可见；Source 模式下 Tab 出不了 CodeMirror（见上面 NOT VERIFIED 一节的已核实项）
19. **mdpro 窗口会被挪动**：中途发现窗口从 (100,100) 跑到了 (0,92)，原因不明（可能和 Finder 窗口操作有关）。点击脚本只检查坐标落在窗口内，不检查是否点中目标控件，导致一次「Saving…」重拍误点到正文（只移动了光标）。之后每批操作前都先用 `size.sh` 复位窗口

**本次产物**：本节、Appendix B（before 列加一条 shared-setup 说明，订正 fixture 那句过期文字，2026-10-05 复查后又改了 4 行）、进度表的 WI-0.4 行。WI-0.4 仍是 🔄：截图部分完成；E5 要求的 WKWebView JSON 子集，没做（剩下 2 项「could not capture」已经用户确认）。

## 10. E5 JSON：mini 基线、WKWebView 子集、release 对比（2026-10-05，mdpro-remote）

**环境**：mini，`docs/stage-0-redesign` 在 `838fd10`，`git diff a5767d5 -- src src-tauri/src` 为空。开工前退出了 release 版 mdpro（PID 19481）；`pnpm tauri dev` 跑完后已经退出（Vite 1420 也关了）。`snapshot.js` 没有改动。产物都在仓库外，复跑用的脚本放在各自目录的 `tools/` 里。

**① mini 上的 Chromium 基线**（同机规则）：`~/.mdpro-redesign/stage-0/json-mini/`。用 `pnpm dev --port 15420` 加 gstack `/browse`，32 个界面 × 2 个主题，共 64 个文件，全部 `ok: true`。第二次完整采集后 `/usr/bin/diff -r`：**exit 0，0 行**。顺便和 MacBook 的 64 个文件比了一下（只作参考，不算 gate）：**逐字节一致**。

**② WKWebView 子集**：`json-mini-wkwebview/`。`pnpm tauri dev` 的 debug app，窗口 `main`，1200×800（`innerWidth×innerHeight` = 1200×800，dpr 1）。界面是 `main-source`、`settings-general`、`link-modal`，light 和 dark 各一次，共 6 个文件，全部 `ok: true`，各阶段都生效（1、5、4 个）。驱动方式：右键 → Inspect Element，把 Web Inspector 分离成独立窗口，往 console 粘贴一行加载器（从 Vite 拉 `snapshot.js` 再 eval）；采集期间把 mdpro 窗口提到前面，保证页面有焦点；最后用 `copy()` 加 `pbpaste` 取回结果。
- **确定性：没通过，只差一个字段。** run 2 和 run 1 比，`/usr/bin/diff -r` exit 1，唯一的差异是 `main-source-light` 的 `.cm-line` → `count`（68 对 44）。又补跑了 5 次 `main-source`：light 是 68、44、44、68、68；dark 是 68、68、68、68（另有一次等待超时，没出文件）。这个数是 CodeMirror 已经渲染的行数（虚拟视口），取决于首次测量有没有完成；被采集元素的样式不变。Chromium 下每次都是 44。`settings-general` 和 `link-modal` 两次采集完全一致。
- 和 mini 的 Chromium JSON 比（不同引擎，只作参考）：`main-source` 差 178 行，`link-modal` 差 174 行，`settings-general` 差 1076 行。比如 WebKit 的默认 `outline-width` 是 3px（Chromium 是 0px），通用字体解析成 `system-ui`（Chromium 是 `Arial`），文字宽度也不同。所以 Stage 1–2 必须有 WKWebView 这一份基线，不能拿 Chromium 的代替。

**③ release 对比：做不了**（按用户要求，没有为了采集去改代码或构建配置）：
- release 的右键菜单只有「Reload」，没有「Inspect Element」。`src-tauri/Cargo.toml` 里的 `tauri` 只开了 `protocol-asset`，没有 `devtools` feature，所以 release 里没有编进 Web Inspector。`tauri.conf.json` 的 `"devtools": true` 在 release 里不起作用。我也没找到别的注入或执行 JS 的途径：MCP 和 IPC 都没有 eval；Safari 远程检查需要 WebView 是 inspectable 的，release 不是，这条没有实测。
- 就算能注入，`snapshot.js` 的 `main-source` 和 `link-modal` 也是靠 `.dev-toolbar input[type=file]` 打开 fixture，而 `DevToolbar.tsx:28` 在 `import.meta.env.DEV` 为假时什么都不渲染，所以这两个界面在 release 页面里连 setup 都过不了。
- 因此 **dev 和 release 的 JSON 没法比，「dev 采集能否代表 release」还没有证据**。已知 dev 独有的差异是 DevToolbar（"DEV MODE" + New/Open）。它在 `main-source` 里被当作 CHROME 选择器采集，所以 dev 的 JSON 本身就包含它。其他候选差异（CSS 合并顺序、压缩、资源路径、环境分支、窗口配置）都没法验证。

**需要用户决定**：
1. `.cm-line` 的 `count`：(a) 改 `snapshot.js`，对虚拟渲染的 `.cm-line` 不记录 count，或者先等 CodeMirror 测量完成再采；(b) 不改脚本，把这个字段作为已知的不确定项，在比对时排除。选好之后重采子集并重做确定性检查，通过了再把 WI-0.4 标 ✅。
2. release 对比：(a) 接受用 dev 采集代替，并记下这个前提；(b) 另做一个开了 `devtools` feature 的验证构建（改构建配置，按 CLAUDE.md 应写 ADR），并让 `snapshot.js` 能在没有 DevToolbar 的情况下打开 fixture；(c) 等 MacBook 那边把 DevToolbar 从 tauri dev 去掉之后再议。

## 11. §10 两个决定的结果（2026-10-07，MacBook 记录）

**决定**（用户，2026-10-05）：
1. `.cm-line` 的 `count` 选 (a)，改 `snapshot.js`。改动在 MacBook 上完成：`174fce7`（schema 2，`VIRTUALIZED` 选择器不再记录 `count`；fixture 改从隐藏的 `[data-testid=dev-open-file]` 打开，没有它时退回 `.dev-toolbar` 输入框）。
2. release 对比由 Codex 参与讨论后定为 (a+)：
   - E5 gate 继续用 dev 采集的 JSON；
   - 另在 mini 上对同一批界面做 tauri dev 和 release 的同机截图逐像素对比：main Source、一个 Settings 页、一个弹窗，浅色和深色。焦点、滚动和等待都固定，避开光标闪烁；
   - 有差异先重拍；只有稳定又解释不了的差异，才升级到 (b)（开 `devtools` 的验证构建，并写 ADR）；
   - 「dev 采集能代表 release」记为抽样校准的前提，不是已证明的等价。
   - **这项对比推迟到 `docs/stage-0-redesign` 合并之后再做**，因为 dev 一侧必须包含 `1703dbb`（去掉可见的 DevToolbar）。

**分工**（用户，2026-10-06）：mini 只做真机测试，代码和文档都在 MacBook 上改（迁移手册 §5，`310ff3e`）。

**结果**（mini 报告在仓库外 `~/.mdpro-redesign/stage-0/reports/`，MacBook 核对过目录和 diff）：
- **Chromium，schema 2，MacBook 采集**（`json-macbook-s2/`）：64 个文件都是 `ok: true`。两次完整采集 `/usr/bin/diff -r` 为空。和 schema 1 比，只差 `schema` 行和 18 个文件里 `.cm-line` 的 `count` 行。
- **WKWebView，schema 2，mini 采集**（`20261007-wkwebview-schema2.md`）：`.cm-line` 的跳动没有了。但 run 1 的 `settings-general-dark` 少了 General 按钮的焦点环。原因是采集工具先往 Web Inspector 粘贴加载器，再把 mdpro 窗口提到前面；脚本跑得比窗口激活快时，WebKit 不匹配 `:focus`。延迟 2 秒启动后 4/4 都有焦点环，而且和 run 2 逐字节一致。
- **焦点保护，`b235ec7`**：`snapshot.js` 开始前最多等 8 秒 `document.hasFocus()`，等不到就是 `ok:false`；每个阶段失焦也记为错误。
  - MacBook：把 `hasFocus` 强制为 false 时文件是 `ok:false` 并写明原因；64 个 Chromium 文件重采后和 `json-macbook-s2/` 逐字节一致。
  - mini（`20261007-wkwebview-focus-guard.md`）：两次采集 6/6 都是 `ok: true`，12 次采集都一次成功。两次之间 `/usr/bin/diff -r` 为空，和 `json-mini-wkwebview-s2-run2/` 也为空。
- **当前基线**（都是 schema 2，只比同机采集）：
  - MacBook Chromium：`json-macbook-s2/`；
  - mini WKWebView 子集：`json-mini-wkwebview-s3/`。
  - schema 1 的几套（`stage-0/*.json`、`json-mini/`、`json-mini-wkwebview/`）作废，因为它们还带 `.cm-line` 的 `count`。
  - mini 跑 Chromium gate 前，先用 schema 2 在 mini 上重采。

**合并之后要做**（④ 选了保留 `1703dbb`）：重算 `css-file-map.md` 的行号（删掉第 13 行 `dev-toolbar.css`，后面的行号减 39）；在合并后的代码上重采两套基线；pure-move 证明的基准换成包含 `1703dbb` 的提交；然后做上面的 release 截图对比。
