# D42 真机检查 G-D42-1～4：App 级对话框按打开顺序叠放（2026-10-08）

D42 的修复在 `190e081`（[ADR-0062](../adr/0062-app-level-dialogs-render-in-open-order.md)），经合并提交 `5313e02` 进入 `frontend-backend-redesign`。本记录收 Mac mini 上的一轮真机检查，被测为 `5313e02` 的 release 包，按 dtrack brief `~/.mdpro-redesign/dtrack/brief-20261008-d42.md` 跑 [`tests/manual-fixtures/d42-dialog-open-order.md`](../../tests/manual-fixtures/d42-dialog-open-order.md) 的四项检查：**四项全部通过**。D42 据此关闭。

## 0. 测量条件

| 项 | 值 |
|---|---|
| 日期 | 2026-10-08，约 19:11–19:20（GMT+8） |
| 机器 | Mac mini |
| 执行方 | 控制台会话里的 Claude Code（Bash + computer-use），全自动；只有 Esc 由用户按物理键（见 §2 偏差 1） |
| 被测构建 | release，`5313e02`（`5313e02553e33be1d09e5eff723f786a2753285c`），`~/.mdpro-redesign/dtrack/builds/5313e02/mdpro.app`；`Contents/MacOS/tauri-app` mtime 2026-10-08 19:07:25；pid 39799，`ps` 确认二进制在 `builds/5313e02/` 下 |
| 输入源 | ABC（KeyboardLayout ID 252），[ADR-0048](../adr/0048-escape-swallowed-by-an-ime-is-not-recovered-from-keyup.md) |
| 夹具 | `git show 5313e02:tests/manual-fixtures/d42-dialog-open-order.md` 复制到 mini 的 `~/.mdpro-redesign/dtrack/scratch/d42/d42.md`；入库原件未打开；全程只用 `open -a` 开出的那一个窗口 |
| 设置 | 日志开；MCP Running（`localhost:55045`），Auto-approve 关；没有改任何设置 |
| 证据存放 | mini 的 `~/.mdpro-redesign/dtrack/reports/report-20261008-d42.md`（报告原文），截图 `~/.mdpro-redesign/dtrack/reports/shots/d42-g1.png`、`d42-g2.png`、`d42-g3.png`、`d42-g3b.png`、`d42-g4.png`，**都不入库** |

## 1. 逐项结论

「谁在上」以 `ui.dialog.stack` 的 `order` 为主证据（最后一项在最上），截图为辅。行号是 mini 上 `~/.mdpro/mdpro.log` 的行号，取自报告原文。

| 判据 | 结果 | `order` | 要点 |
|---|---|---|---|
| G-D42-1 先「Unsaved changes」，再外部改文件 → Reload 在上 | **通过** | `["confirm","reload"]`（8146） | 截图里只看得到「External change detected」，完全盖住「Unsaved changes」。第一次 Esc → `ui.dialog.cancel` `controlId:"dialog.reload.ignore"`（8163），两次 Esc 之间没有 `ui.dialog.escape`，「Unsaved changes」仍开；第二次 Esc → `ui.dialog.escape {dialog:"confirm",outcome:"cancel"}`（8173）。ADR-0045 Cost e 没有出现 |
| G-D42-2 先 Reload，再 ⌘W → 「Unsaved changes」在上 | **通过** | `["reload","confirm"]`（8184） | Esc → `ui.dialog.escape {dialog:"confirm",outcome:"cancel"}`（8190），Reload 仍开；点 Ignore → `ui.dialog.cancel dialog.reload.ignore`（8195） |
| G-D42-3 先 MCP 确认框，再 ⌘W → 「Unsaved changes」在上 | **通过** | `["mcp","confirm"]`（8204） | 点 Keep editing（8205）后 MCP 框仍在、可答（`d42-g3b.png`）；点 Reject → `mcp.confirm` `outcome:"rejected"`（8209，`waitedMs` 28870），客户端 403 `USER_REJECTED`；文档里没有插入的 `MCP ` |
| G-D42-4 先开设置，再来 MCP 确认框 → MCP 框在上 | **通过** | `["settings","mcp"]`（8221） | Esc → `ui.dialog.escape {dialog:"mcp_write_confirm",outcome:"reject"}`（8228），403 `USER_REJECTED`（8231，`waitedMs` 34107）；Esc 之后设置仍开，再用 Close 关掉；文档不变 |

**D42 的结论**：四种打开顺序下，后打开的对话框都画在上面，Esc 都给了它，被盖住的那个保持打开、随后照常可答。D42 关闭。

**本轮没有覆盖的**：

- 真实点标题栏之后的叠放与 Esc：G-D42-3/4 用激活应用代替（偏差 2）。
- Recovery 与 Encoding 两个框参与的顺序：不在四项检查里，只有单元测试（含 `tests/d42-app-dialog-open-order.slow.test.tsx` 的穷举）。
- MCP 确认框被盖住后等满 60 s 超时（408）：ADR-0062 已接受的代价，没有上真机。

## 2. 偏差与附带发现

1. **每次 Esc 都是用户按的物理键。** brief 原定的 osascript 路径（`tell application "System Events" to key code 53`）4 次全失败：焦点闸门都通过（最后一条窗口行是 `window.focus`，System Events 的前台进程是 `tauri-app`），`osascript` 退出码 0，但没有任何 escape / cancel 日志行、也没有框关闭；每次改由用户按物理 Esc，预期的日志行随即出现。原因未查（一个未证实的猜测：Bash 工具的沙箱里 `osascript` 拿不到 Terminal 的辅助功能授权，事件被静默丢弃）。这条已记入 gui-acceptance §9（`bd10e93`）。
2. **G-D42-3/4 靠激活应用重新聚焦，不是点标题栏。** r4 发现 Terminal 在前台时 computer-use 点标题栏到不了 mdpro，所以用 `open_application("mdpro")`；本轮验证的是激活之后的叠放与 Esc 去向。
3. **G-D42-4 从插入到拒绝用了 34 s**，超过 brief 的 30 s 目标，原因是等物理 Esc；没有出现 408，结论成立。
4. **退出时点了 Discard changes。** 菜单 Quit 弹出「Unsaved changes – Quit without saving?」，执行方选不保存；被丢弃的只是 scratch 副本上的改动，`bd10e93` 的 gui-acceptance 规则允许。
5. **自动保存的 `file.write` 行（19:12:44、19:13:14 起每 30 s 一条，3415 字节）不是写 `d42.md`。** 盘上的 `d42.md` 始终没有打进去的字。查明：这些行由 `save_draft` 命令记（`src-tauri/src/commands/draft.rs`，`save_draft_logged`），`useAutoSave` 每 30 s 调它把缓冲区存成**草稿**；日志事件名却叫 `file.write`，`filePath` 填的是原文件路径，读起来像在写原文件。同一时段文件监视器没有对这些写入报任何事件，也印证了它们没有碰 `d42.md`。不丢数据、不覆盖外部改动，只是日志误导；与 D38 记录 NOTE 6 同属一类。去向另行登记，不归 D42。
6. **单个对话框打开时没有 dialog 日志行**，`ui.dialog.stack` 只在开着两个及以上时记，与 ADR-0062 的设计一致；只记录。
7. 报告里其余的执行细节（`mcurl` 加了 `-w '%{http_code}'` 以记下状态码、截图用 `screencapture -x` 落盘、每次物理 Esc 之后用激活应用把焦点拉回）不影响结论。
