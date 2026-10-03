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
