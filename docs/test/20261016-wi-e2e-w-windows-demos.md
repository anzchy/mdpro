# WI-E2E-W Windows 真机演示 W1–W6，win-desktop（2026-10-16）

执行方：mdpro-codex-audit，从 MacBook 经 SSH 操作。delegator 转达的用户原话：「go ahead with the W1–W6 demos on win-desktop」，并说明这句话涵盖按演示需要重启 mdpro。WI-E2E-W 的负责人是 mdpro-a6，它在做 D246，所以演示由我来跑。没有用 computer use，没有用 TeamViewer。时间均为 +0800，00:20–00:43。

驱动脚本取自 master `712b655a`（含 #476 = `1eece3e8`）。我用 `git archive` 导出到 Mac 的临时目录，从那里运行，再用该目录的 `deploy.sh` 把 `scripts/windows/*` 同步到 PC：`cdp.mjs`、`runi.ps1`、`ui-run.ps1`、`ui.cmd`、`ui.ps1` 上传，哈希一致；其余文件未变。主检出没有切换。已安装的 mdpro 保持 `0.3.4@f8f3f664`。

证据在 `docs/test/windows-audit-20261016-wi-e2e-w/`：
- `results-log.txt`：逐条运行输出。Windows 的 GBK 报错已转成 UTF-8，行尾标 `[GBK]`；
- `w1b-control.jsonl`、`w1b.jsonl`、`w2.jsonl`、`w5.jsonl`：`log.sh raw` 原样取回的 mdpro.log 字节；
- `harness/`：故障注入用的假 ssh（`fakessh.sh`）、APPDATA 启动器与子进程环境探针、快照/恢复/状态脚本。

本次没有截图，也没有任何 token 进入证据目录。

## 0. 总表

「PC 实际」是在 PC 上直接读到的 `$LASTEXITCODE`；「Mac 所见」是 Mac 侧包装脚本的退出码。

| 演示 | 内容 | 结论 | 预期码 | Mac 所见 | PC 实际 |
|---|---|---|---|---|---|
| W1a | 变更型 eval，发送后连接丢失 | 通过 | 3，不重试，只生效一次 | 3，ssh 调用 1 次，页面计数 1 | — |
| W1b | `ui.sh` 真 Ctrl+N，发送后连接丢失 | 通过 | 3，只生效一次 | 3，`tab.open` 恰 1 条（对照组同为 1） | — |
| W1c | 只读调用丢一次回复 | 通过 | 重试一次后成功 | 0，ssh 调用 2 次；每次都丢则 255 | — |
| W2 | `ui.sh` 中途失败 | 通过 | 1，后续步骤不执行 | 1，`ABORTED at step 3`，之后的 Ctrl+N 没有执行 | — |
| W3 | `ui.sh` 超时 | **Windows 不通过（退出码）** | 124 | **1** | 124 |
| W3b | 计划任务信息读不到 | 通过 | 1，`has no result` | 1 | 1 |
| W4a | eval 抛异常 | 通过 | 1 | 1，`&& next` 没有执行 | 1 |
| W4b | CDP 顶层错误 | 通过 | 1，`CDP_ERROR` | 1 | 1 |
| W4c | pull 解码/写入失败 | 通过 | 1，`pull failed`，不留文件 | 1，目录为空（`cdp.sh shot` 同） | — |
| W4f | `CDP_TIMEOUT`（补充） | **Windows 不通过（退出码）** | 3 | **1** | 3 |
| W5 | `log.sh raw` 字节与 mark | 通过（exit 7 为 mark 侧模拟） | 字节数 = 日志增长，7 | 3350 B = 增长，sha256 两端一致；7 | — |
| W6 | `--window` 标签绑定 | **部分** | 0 / 5 / 6 | **一律 1** | **Node 崩溃**（-1073740791 / -1） |
| 隔离 | 快照/恢复，两处 [推断] | 通过，两处都已核实 | — | — | — |

两个新问题，已报给 delegator 申请 D 号（§ 2）：
1. OpenSSH 的 DefaultShell 是 PowerShell，远端非零退出码一律变成 1；
2. `cdp.mjs` 在多页或带标签的探测路径上，Node 在 Windows 上中止。

## 1. 逐项

### W1：变更型调用丢失回复（D228 的真机检查）— 通过

**故障注入。** 在 PATH 前面放一个假 `ssh`（`harness/fakessh.sh`）：它先调用真正的 `/usr/bin/ssh`，远端命令真实执行；再记录调用次数，然后返回 255，相当于「发送之后连接断了」。`FAKE_SSH_MODE=always` 每次都这样，`first` 只在第一次这样。

| 步骤 | 结果 |
|---|---|
| W1a：`cdp.sh eval 'window.__w1 = (window.__w1\|\|0) + 1'`，always | `UNKNOWN OUTCOME: transport lost after send; reconcile state before continuing`，退出 **3**；ssh 调用 **1** 次（没有重试）；之后读页面计数为 **1**（生效一次） |
| W1b 对照（无故障）：`focus` → `clickat` 进页面 → 真 Ctrl+N | `tab.open` 1 条，出现一个 Untitled |
| W1b（first，同样步骤） | 退出 **3**；ssh 调用 2 次：第 1 次是 `ui.sh`，第 2 次是它退出时 trap 里的 `mdpro.sh cleanup`（只读）；`w1b.jsonl` 中 `tab.open` 恰 **1** 条，标签变为两个 Untitled |
| W1c 对照：`log.sh mark`（只读），first | 重试一次后成功：退出 0，ssh 调用 2 次 |
| W1c'：同上，always | 重试一次后放弃：退出 255，ssh 调用 2 次 |

另外记一次失败：第一次 W1b 没有先 `clickat` 进页面（当时没有打开的标签），Ctrl+N 没有到达 mdpro（`file.new`、`tab.open` 都是 0）。包装脚本的行为没有问题（退出 3，没有重试），但按键没有被应用，所以这一组作废，加 `clickat` 后重做。0.3.4 记录 F6 也遇到过同样的现象。

### W2：`ui.sh` 中途失败 — 通过

| 步骤 | 结果 |
|---|---|
| `focus`、`clickat`、`menuclick ["NoSuchMenu","X"]`、`wait`、真 Ctrl+N | `ERROR menuclick: menu item not found: NoSuchMenu`，`ABORTED at step 3`，退出 1；`w2.jsonl` 中 `tab.open` 为 0，第 5 步没有执行 |
| W2b：第 1 步是被拒绝的 `keys` op | `ERROR keys: unsupported …`，`ABORTED at step 1`，退出 1 |
| W2c：只读步骤 `tree`（参数错误）加 `onError:"continue"`，再接 `windows` | 记录 `ERROR tree: …` 后继续执行，退出 0 |

附注：W2 之后紧接的一次 `cdp.sh eval` 返回 `CDP_TIMEOUT`，下一次就正常了。推测是失败的 `menuclick` 让菜单栏停在菜单模式，阻塞了页面，直到下一次 `ui.sh` 运行才解除。这是驱动的副作用，记录备查。

### W3：超时 — Windows 不通过（退出码）

| 步骤 | 结果 |
|---|---|
| `ui.sh` 一个 100 s 的 `wait`（`ui-run.ps1` 默认 90 s） | 打印 `TIMEOUT: no ui-out.json after 90 s`，**退出 1**（预期 124）。PC 上没有残留任务，`steps.json`、`ui-out.json` 已删，没有遗留的 ui.ps1 进程 |
| 在 PC 上直接调用 | `runi.ps1` 超时为 **124**；任务退出 7 时为 **7**；`ui-run.ps1 -TimeoutSec 5` 为 **124** |

所以 PC 上的脚本是对的，退出码丢在 ssh 这一跳，见 § 2 问题 1。

### W3b：计划任务结果读不到 — 通过

| 步骤 | 结果 |
|---|---|
| 第一次尝试：任务自己调用 `Unregister-ScheduledTask` 注销自己 | 无效：以 `RunLevel Limited` 运行的任务注销不了自己。第一次的退出 1 是任务本身失败（最后一条命令出错），第二次（末尾加 `Start-Sleep 1`）退出 0。这两次都没有走到「读不到」路径，作废 |
| 改为：`runi` 运行一个 20 s 的任务，6 s 后由**另一个 ssh 会话**注销它 | 注入方 `unregistered at 00:37:19.805`；`runi` 的轮询报 `Get-ScheduledTask` 找不到任务，接着打印 **`runi: mdpro-audit-w3b has no result`**，PC 上退出 **1**（b163 H2 已修） |

### W4：失败要让调用方失败 — 通过

| 步骤 | 结果 |
|---|---|
| W4a：`if (true) throw new Error("w4a boom")` | `{"exception": "Error: w4a boom …"}`，退出 1，`&& echo` 没有执行（第一次表达式里没有 `return`，被包成 `return (throw …)` 成了 SyntaxError；同样退出 1，但作废重做） |
| W4b：返回自引用对象（`returnByValue`） | `{"error":"CDP_ERROR","code":-32000,"message":"Object reference chain is too long"}`，Mac 退出 1，PC 实际退出 1（b163 H1 已修） |
| W4c：`pull.sh` 取一个存在的文件，写入只读目录 | `Permission denied` 后打印 `pull failed: could not decode or write …`，退出 1，目录里没有文件，也没有 `.part`（b163 H3 已修）。对照：可写目录下退出 0 |
| W4e：`cdp.sh shot` 写入只读目录 | 同样打印 `pull failed`，退出 1，不留文件 |
| W4d：远端文件不存在 | 读取失败，退出 1，不留文件 |
| W4f：eval 等 30 s（cdp.mjs 的上限是 25 s） | 打印 `"CDP_TIMEOUT"`，**Mac 退出 1**，PC 上 `cdp.mjs` 实际退出 **3**。见 § 2 问题 1 |

### W5：`log.sh raw` — 通过（exit 7 为 mark 侧模拟）

| 步骤 | 结果 |
|---|---|
| `mark` → 在 Source 编辑器里做 5 次（Ctrl+K、Esc）（CDP 键）→ `raw w5.jsonl` | `raw: bytes 2015563..2018913 lines: 15 malformed: 0`。文件 3350 B，等于日志增长；`ui.link-modal.open` 5 条、`cancel` 5 条；首字节 `{`、末字节 `0a`（两端都没有截断的半行） |
| 字节一致 | 本地 sha256 `1ceda17b…7abe97`，与 PC 上同一区间的 sha256（在 PC 上计算）完全一致 |
| 零增长 | 第一次尝试没有生成行（页面没有 `.ProseMirror`）：`raw` 得到 0 B 文件，两端都是空串的 sha256，退出 0 |
| exit 7（mark 侧模拟） | 改本地 `.logmark`：mark 大于文件（truncated）、换创建时间（replaced）、换首行哈希（replaced）、v1 行号 mark，四种情况下 `raw` 与 `since` 都退出 **7**，不写文件；换回真实 mark 后退出 0 |

**未做的部分：** 真实地截断或替换 PC 上的 mdpro.log。那是用户的日志历史，所以只在 mark 侧模拟。两者走的是 `log.sh` 里同一段比较（大小、创建时间、首行哈希），但「日志文件真的被换掉」这一条没有在真机上发生过。

### W6：标签绑定 — 部分

| 步骤 | 结果 |
|---|---|
| 真 Ctrl+Shift+N 开第二个窗口 | `window.create success`，标签 `mdpro-6134535a-186d-4633-926b-cbe3849504b1`；`windows` 列出两个 hwnd |
| 标签探针 | `__TAURI_INTERNALS__.metadata.currentWindow.label` 在 WebView2 上可用：主窗口为 `main`，新窗口为上面的标签。ops.md 中「confirmed on WebView2 only once demo W6 runs」可以去掉 |
| W6a：不带标签，两页 | 打印 `WINDOW_AMBIGUOUS` 和两个候选（标签、id 都对），随后 Node 中止：`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76`，PC 实际退出 **-1073740791**（0xC0000409），Mac 为 1。预期 6 |
| W6b：`--window main` | 绑对了：`{label:"main", tabs:2, w:1407}`，**然后同样中止**，Mac 为 1。预期 0 |
| W6c：`--window <第二个窗口>` | 绑对了：`{label:"mdpro-6134535a-…", tabs:0, w:667}`，然后中止，Mac 为 1 |
| W6d：`--window nosuch` | `WINDOW_NOT_FOUND`，然后中止，Mac 为 1。预期 5 |
| W6e：`--window 'a;b'` | Mac 侧拒绝：`refusing window label`，退出 2 |
| W6f：`ui.sh` 带 `"window"` 字段的步骤 | `ERROR windows: window-bound steps are not available yet … BLOCKED`，`ABORTED at step 1`，退出 1 |
| 不带标签、只有一页（第二个窗口关闭后） | 正常，退出 0（整晚的单页 eval 都是 0） |
| 未验证 | 「多个窗口都不在前台时 `ui.ps1` 拒绝猜测」：没有搭出「mdpro 都不在前台」的状态 |

**标签 → HWND 的两个方案**（pitfalls 22）：

| 方案 | 做法 | 结果 |
|---|---|---|
| (a) 几何匹配 | 页面 `screenX/screenY/outerWidth/outerHeight` × `devicePixelRatio`（1.8）对比 `windows` 的 rect（格式为 x, y, 宽, 高） | **可用**。第二个窗口：页面 [164, 207, 1364, 988]，窗口 156,156 起、1216×839，即右下角 1372,995；左右下各内缩 8 px，上方 51 px 是标题栏和菜单。主窗口：页面 [0, 43, 2533, 1125]，窗口 −8,−8 起、2548×1138，同样一致。纯读取，不改变任何东西 |
| (b) 标题匹配 | 在该页调用 `invoke("plugin:window\|set_title", {label, value:"mdpro W6-6134535a"})` | **可用**。capability 允许，`windows` 随即列出 `'mdpro W6-6134535a'`。改 `document.title` 不影响原生标题。缺点：会改变用户看到的标题，必须改回（已改回 `mdpro`） |

建议用 (a)：只读、不留痕迹。代价是要处理 8 px 边框和标题栏偏移，窗口重叠时要按包含关系判断。

收尾：第二个窗口用 `invoke("plugin:window|close")` 按标签关闭（`window.close_requested … no_unsaved_closing`、`allowed_close`）。之后 `menuinfo` 为 `count=-1`，这是 pitfalls 已记录的「第二个窗口关闭后 GetMenu 失效」，重启后消失。

### 配置隔离：快照与恢复一次，两处 [推断] — 通过

运行 id `e2e-20261016-1`，按 `reference/config-isolation.md` 的步骤进行。

| 步骤 | 结果 |
|---|---|
| 关闭 mdpro（`close.ps1`），进程数 0 | 快照：`dot-mdpro` 的 robocopy 退出 1（已复制），`appdata-mdpro` 退出 0；`config.json` 哈希 `F417022A…` 与快照一致 |
| 新发现 | mdpro **退出时会删掉** `%APPDATA%\mdpro\server.port` 和 `server.token`，所以关着的 mdpro 的快照里只有空的 `drafts\`。文档表格里「MCP server files: port and token — Yes」应注明：关闭状态下这两个文件不存在，每次启动重新写 |
| **[推断] 2：改 APPDATA 不会移动 `%APPDATA%\mdpro`** | 已核实。`launch-appdata.cmd` 先 `set APPDATA=C:\Users\jack\mdpro-audit\fakeappdata` 再 `start` mdpro：`app.ready` 00:29:15.435（pid 15128），真正的 `%APPDATA%\mdpro\server.port/token` 在 00:29:15 被重写，假目录始终为空（0 项）。同样方式 `start` 的子进程确实看到 `APPDATA=C:\Users\jack\mdpro-audit\fakeappdata`（`envprobe.cmd`），所以环境变量传到了子进程，mdpro 照样不用它 |
| 演示期间 | `config.json` 被运行改动，变成 `826C9D80…`（窗口状态等） |
| 恢复（mdpro 已关闭）：`/MIR /XF mdpro.log` | `dot-mdpro` 退出 3（复制了文件，并有多余项），`appdata-mdpro` 退出 0；`config.json` 回到 `F417022A…`，与快照一致 |
| **[推断] 1：`/MIR /XF mdpro.log` 不动日志** | 已核实。恢复前后 mdpro.log 的大小 2033627、创建时间、最后写入时间 00:42:08.070、sha256 `21062406…` 完全相同。robocopy 把它列为「多余」，但因为 `/XF` 既不复制也不清除 |
| 重启（`mdpro.sh normal --yes`） | 退出 0，9222 已关闭，`maximized`；`config.json` 仍是 `F417022A…`；没有残留的计划任务 |

**未做：** 步骤 7「删除快照」。快照目录里有 MCP token，删除属于 rule 25，要用户确认。

## 2. 新问题（已报 delegator，请分配 D 号；负责人 WI-E2E-W / mdpro-a6）

1. **远端退出码在 ssh 上一律变成 1。** win-desktop 的 OpenSSH `DefaultShell` 是 `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`（5.1）。`win` / `win_read` 发出的命令在这个外层 PowerShell 里执行，最后一条是原生程序（`powershell -File …`、`node cdp.mjs …`）时，失败一律以 1 退出。证据：
   - `ssh win-desktop 'exit 124'` → 124；
   - `ssh win-desktop 'powershell -NoProfile -Command "exit 124"'` → 1，`-File` 同样 → 1；
   - `ssh win-desktop 'cmd /c exit 7; exit $LASTEXITCODE'` → 7。

   **影响：** 非零仍然是非零，所以 N1 的「Windows 失败会让 Mac 调用方失败」成立。但分类丢了：124、3（`CDP_TIMEOUT`）、4、5、6 到 Mac 都变成 1。最要紧的是 `CDP_TIMEOUT`：它的意思是「结果未知，先核对，不要重跑」，到了 Mac 却像「已执行且失败」，按 ops.md 处理的调用方可能重跑一个其实已经生效的变更，属于 D228 那一类。Mac 侧产生的码不受影响：ssh 255 → 3（W1），以及 `log.sh` 的 7（W5）。修法方向：每条远端命令末尾加 `; exit $LASTEXITCODE`。
2. **`cdp.mjs` 的标签探测路径让 Node 在 Windows 上中止**（Node v24.15.0）。只要走到探测各页标签那一段（带 `--window`，或有多个页面），结果打印出来之后 Node 就以 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76` 中止，退出 0xC0000409。所以 `cdp.sh --window X eval … && next` 永远不会执行 `next`，成功的绑定也看起来失败。推测原因：探测连接 `ws.close()` 之后紧接着 `process.exit()`，libuv 的句柄还在关闭中。单页、不带标签的路径不受影响。

## 3. 偏差与附注

1. 作废重做的几组：W1b 第一次（没有 `clickat`）、W3b 前两次（任务注销不了自己）、W4a 第一次（表达式没有 `return`）、W4c 第一次（远端文件不存在，失败在读取而不是写入）、W5 第一次（页面没有 `.ProseMirror`）。结论都取自重做的那一组。
2. 本机 shell 是 zsh，`${PIPESTATUS[0]}` 为空；有两处「exit」读数因此是空的，已改用 `$?` 或 `${pipestatus[1]}` 重读。
3. W5 的 exit 7 是在 mark 侧模拟的（§ 1 W5）。

## 4. 恢复与清理

- mdpro 以普通模式运行（`0.3.4@f8f3f664`，9222 关闭，最大化）；`config.json` 与开始时相同（`F417022A…`）；没有 `mdpro-audit-*` 计划任务；没有草稿。
- 与开始时的不同：开始时打开着 d226.md、d208.md 两个标签（上一晚 v0.3.5 检查留下的 fixture 副本），现在 mdpro 启动后没有打开的文档。演示中的两个 Untitled 新文档是空的，随 mdpro 关闭而消失。
- 输入法没有改动。
- `C:\Users\jack\mdpro-audit\` 新增：`snap\e2e-20261016-1\`（**含 MCP token**）、`fakeappdata\`（空）、`launch-appdata.cmd`、`envprobe.cmd`、`out\childenv.txt`、`out\e124.ps1`。删除这些、删除整个文件夹，以及删除上一晚中止上传的安装包，都属于 rule 25，等用户确认，没有做。

## 5. D247 落地后复查（2026-10-16 07:44–07:47，驱动取自 `05dc6b8e`）

驱动用 `git archive 05dc6b8e` 取到 scratchpad 再部署（主 checkout 未动）。`deploy.sh` 报告 Windows 侧 9 个脚本全部 `same`（D247 只改了 Mac 侧 `common.sh`）。开始时 PC 上 **mdpro 没有在运行**（`mdpro.sh status`：`tauri-app: 0`，9222 关闭）；与 § 4 记录的「普通模式运行」不同，是这期间被关掉的，本次没有启动它。

| 码 | 动作 | 到 Mac 的退出码 | 证据 | 结论 |
|---|---|---|---|---|
| 4 | `cdp.sh eval 1`（9222 关闭） | 4 | 输出 `"CDP_PORT_CLOSED: nothing on 127.0.0.1:9222; …"` | 通过（修复前是 1） |
| 5 | `cdp.sh --window nope eval 1` | 4 | 同上 `CDP_PORT_CLOSED`：`cdp.mjs` 先查端口，mdpro 没开就走不到窗口查找 | 未验证（没走到 WINDOW_NOT_FOUND 路径；要走到需以 debug 模式启动 mdpro） |
| 124 | `ui.sh '[{"op":"wait","ms":100000}]'`（runi.ps1 90 s 超时） | 124 | 输出 `TIMEOUT: no ui-out.json after 90 s`，07:45:18 → 07:46:56 | 通过（修复前是 1，见 § 1 W3） |
| 1 | `pull.sh` 一个不存在的文件 | 1 | PowerShell 的 `FileNotFoundException`（`MethodInvocationException`），报错里能看到包装头 `…ITCODE = 0; [Convert]::ToBase64String(…`；本地没有生成文件 | 通过（失败的 cmdlet/方法仍是 1） |
| 0 | `pull.sh C:\Users\jack\mdpro-audit\runi.ps1`；`mdpro.sh status`、`deploy.sh` | 0 | 拉回文件的 sha256 与 `05dc6b8e` 的 `runi.ps1` 相同（`6f08e316ca21d003…`） | 通过 |

- 124 那一步之后：没有 `mdpro-audit-*` 计划任务，`steps.json`、`ui-out.json` 都不在；被停的任务没有留下进程（07:45–07:47 之间没有新建的 powershell/cmd 进程）。
- 没有改 mdpro 的设置，也没有向桌面发送任何输入（wait 步骤只是睡眠）。
- PC 上没有新增文件：`deploy.sh` 全部 `same`，没有复制任何脚本。

## 6. D248 落地后复查，并补 D247 的码 5（2026-10-16 09:29–09:37，驱动取自 `dfac490f`）

用户原话（经 delegator 转达）：「OK,Restarting mdpro on the Windows PC」。驱动用 `git archive dfac490f` 取到 scratchpad 再部署（主 checkout 未动），`deploy.sh` 只更新了 `cdp.mjs`（`hash ok`），其余 8 个 `same`。PC 上 Node v24.15.0。开始时 mdpro **没有运行**（`tauri-app: 0`，9222 关闭）；`config.json` 为 `F417022A…`，先复制一份到 `out\d248-config.json`。`mdpro.sh debug --yes` 退出 0（一页，标签 `main`，`maximized`，innerWidth 1067）。

**结论：D248 在真机上没有修好。** 只要一次运行里开过两个以上 WebSocket，答案打印之后 Node 仍然以 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76` 中止（PC 上 `$LASTEXITCODE` = -1073740791，即 0xC0000409）。D248 的 70 映射是生效的：Mac 一律收到 70，不再是 1 或 9。

| 检查 | 窗口数 | 到 Mac 的退出码 | 证据 | 结论 |
|---|---|---|---|---|
| `cdp.sh --window main eval 1 && echo next` ×3 | 1 | 70、70、70；`next` 一次也没打印 | 每次先打印 `1`，然后是上面的 Assertion | **Windows 不通过** |
| `cdp.sh --window nope eval 1`（D247 遗留的码 5） | 1 | 5 | `WINDOW_NOT_FOUND`，候选只有 `main`；没有 Assertion | 通过（只开了一个探测连接） |
| `cdp.sh eval 1 && echo next` ×3（对照：不带标签，单页） | 1 | 0、0、0；`next` 每次都打印 | 没有 Assertion | 通过 |
| 两个窗口、不带标签 `cdp.sh eval 1` | 2 | 70（应为 6） | 先打印 `WINDOW_AMBIGUOUS` 和两个候选（`main`、`mdpro-7f1bcb85-…`），然后 Assertion | **Windows 不通过** |
| 两个窗口 `--window nope` | 2 | 70（应为 5） | 先打印 `WINDOW_NOT_FOUND`，然后 Assertion | **Windows 不通过** |
| 两个窗口 `--window main eval 1 && echo next` ×3 | 2 | 70、70、70；`next` 一次也没打印 | 同上 | **Windows 不通过** |
| 两个窗口 `--window mdpro-7f1bcb85-… eval 'return location.href'` | 2 | 70 | 绑对了（`"http://tauri.localhost/"`），然后 Assertion | **Windows 不通过** |
| PC 上直接运行 `node cdp.mjs --window main eval64 MQ==` | 1 | — | `$LASTEXITCODE=-1073740791` | 同上，确认不是 Mac 侧问题 |

第二个窗口由真实的 Ctrl+Shift+N 打开（`window.create success`，标签 `mdpro-7f1bcb85-7019-4ea5-807b-34f92627ab2e`，`windows` 列出两个 hwnd）。

**诊断（PC 上的临时脚本 `out\d248diag.mjs`，已删除）**：依次对同一页打开 N 个 WebSocket，每个都 `close()` 并等到 `close` 事件，再按不同方式退出。

| N | 退出方式 | 3 次的 `$LASTEXITCODE` |
|---|---|---|
| 1 | 收到 close 事件后立即 `process.exit(0)` | 0（1 次） |
| 2 | 收到 close 事件后立即 `process.exit(0)` | -1073740791 ×3 |
| 2 | 500 ms 后再 `process.exit(0)` | 0 ×3 |
| 2 | 不调用 `process.exit`，设 `process.exitCode = 0` 让事件循环自然结束 | 0 ×3 |
| 3 | 同上，自然结束 | 0 ×3 |

每个 `close` 事件都在 5–7 ms 内到达，所以「等到 close 事件」本身做到了；问题是 close 事件到达时 libuv 的句柄还没有关完，此时调用 `process.exit` 仍然触发断言。修法方向（交给负责人 mdpro-a6）：关闭之后不要立即 `process.exit`，改为设 `process.exitCode` 并让事件循环自然结束（仍需为挂住的连接保留一个有界的兜底退出），或在退出前留出一段延迟。macOS 上的测试（`windows-driver-cdp-clean-exit.test.ts`）无法复现这一点：它证明的是「等到了 close」，而 Windows 上这还不够。

**恢复与清理**

- 第二个窗口按标签用 `plugin:window|close` 关闭（`no_unsaved_closing`、`allowed_close`）；随后 `runi.ps1` + `close.ps1` 关闭 mdpro（`allowed_close`、`app.quit success`），`tauri-app` 为 0，9222 关闭。结束状态与开始时相同：**mdpro 未运行**。
- `config.json` 被本次运行改成 `24EEC63A…`，已用开始时的副本恢复为 `F417022A…`，副本随后删除。
- 没有 `mdpro-audit-*` 计划任务，没有草稿（`%APPDATA%\mdpro\drafts` 为空）。`out\d248diag.mjs` 已删除；PC 上留下的只有更新后的 `cdp.mjs`（即 `dfac490f` 的版本）。
- 附注：这次最大化窗口的 rect 为 `-13,-13,3866,2090`，与 § 1 W6 记录的 `2548×1138` 不同，PC 的显示设置在此期间有变化；innerWidth 为 1067。

## 7. D248 第二次修复后复查（2026-10-16 10:08–10:13，驱动取自 `5e0dd18e`）

用户原话（经 delegator 转达）：「Yes, restart (Recommended)」，只覆盖这次复查的 mdpro 重启。驱动用 `git archive 5e0dd18e` 取到 scratchpad 再部署，`deploy.sh` 只更新了 `cdp.mjs`。开始时 mdpro **没有运行**，9222 关闭，没有计划任务，`config.json` 为 `F417022A…`（先复制一份）。`mdpro.sh debug --yes` 退出 0（一页 `main`，`maximized`，innerWidth 1067）。

**结论：D248 在真机上修好了。** 所有路径都没有出现 `Assertion failed … UV_HANDLE_CLOSING`，也没有 0xC0000409 或 70。

| 检查 | 窗口数 | 到 Mac 的退出码 | 证据 | 结论 |
|---|---|---|---|---|
| `cdp.sh --window main eval 1 && echo next` ×3 | 1 | 0、0、0；每次都打印 `next` | 打印 `1` | 通过 |
| `cdp.sh --window nope eval 1` | 1 | 5 | `WINDOW_NOT_FOUND` | 通过 |
| `cdp.sh eval 1 && echo next`（对照） | 1 | 0 | 打印 `1`、`next` | 通过 |
| 不带标签 `cdp.sh eval 1` | 2 | 6 | `WINDOW_AMBIGUOUS`，候选 `main` 与 `mdpro-6c0e4940-…` | 通过 |
| `cdp.sh --window nope eval 1` | 2 | 5 | `WINDOW_NOT_FOUND` | 通过 |
| `cdp.sh --window main eval 1 && echo next` ×3 | 2 | 0、0、0；每次都打印 `next` | 打印 `1` | 通过 |
| `cdp.sh --window mdpro-6c0e4940-… eval 'return location.href' && echo next` | 2 | 0 | `"http://tauri.localhost/"`、`next` | 通过 |
| PC 上直接运行 `node cdp.mjs --window main eval64 MQ==`，两窗口 | 2 | — | `$LASTEXITCODE=0`，耗时 187 ms（远在 2 s 兜底之前，即靠事件循环排空结束）；不带标签 `$LASTEXITCODE=6` | 通过，确认不是被包装层掩盖 |

第二个窗口由真实的 Ctrl+Shift+N 打开（`window.create success`，标签 `mdpro-6c0e4940-e585-4e80-8f42-977cc617034d`，`windows` 列出两个 hwnd）。

**恢复与清理**

- 第二个窗口按标签用 `plugin:window|close` 关闭（`no_unsaved_closing`、`allowed_close`；这次 `cdp.sh` 本身也以 0 退出）；随后 `runi.ps1` + `close.ps1` 关闭 mdpro（`app.quit success`），`tauri-app` 为 0，9222 关闭。结束状态与开始时相同：**mdpro 未运行**。
- `config.json` 被本次运行改成 `24EEC63A…`，已用开始时的副本恢复为 `F417022A…`，副本随后删除。
- 没有 `mdpro-audit-*` 计划任务，没有草稿。PC 上留下的只有更新后的 `cdp.mjs`（`5e0dd18e` 的版本）。

## 8. D248-WI-4 落地后复查（2026-10-16 10:37–10:42，驱动取自 `34b4e1c3`）

用户原话（经 delegator 转达）：「Yes, restart mdpro on the Windows PC for the re-check」，只覆盖这次复查的 mdpro 重启。驱动用 `git archive 34b4e1c3` 取到 scratchpad 再部署，`deploy.sh` 只更新了 `cdp.mjs`。开始时 mdpro **没有运行**，9222 关闭，没有计划任务，`config.json` 为 `F417022A…`（先复制一份）。

**结论：全部通过。** 没有任何一次出现 `Assertion failed … UV_HANDLE_CLOSING`、0xC0000409 或 70。

| 检查 | 窗口数 | 到 Mac 的退出码 | 证据 | 结论 |
|---|---|---|---|---|
| mdpro 关闭时 `cdp.sh eval 1` | 0 | 4 | `CDP_PORT_CLOSED: nothing on 127.0.0.1:9222; …`；PC 上直接运行 `$LASTEXITCODE=4` | 通过 |
| `mdpro.sh debug --yes` | — | 0 | 一页 `main`，`maximized`，innerWidth 1067 | — |
| `cdp.sh --window main eval 1 && echo next` ×3 | 1 | 0、0、0；每次都打印 `next` | 打印 `1` | 通过 |
| `cdp.sh --window nope eval 1` | 1 | 5 | `WINDOW_NOT_FOUND` | 通过 |
| 不带标签 `cdp.sh eval 1` | 2 | 6 | `WINDOW_AMBIGUOUS` | 通过 |
| `cdp.sh --window nope eval 1` | 2 | 5 | `WINDOW_NOT_FOUND` | 通过 |
| `cdp.sh --window main eval 1 && echo next` ×3 | 2 | 0、0、0；每次都打印 `next` | 打印 `1` | 通过 |
| `cdp.sh --window mdpro-6e0611d7-… eval 'return location.href' && echo next` | 2 | 0 | `"http://tauri.localhost/"`、`next` | 通过 |
| PC 上直接运行，两窗口 | 2 | — | `--window main`：`$LASTEXITCODE=0`，143 ms；不带标签：`$LASTEXITCODE=6` | 通过 |

第二个窗口由真实的 Ctrl+Shift+N 打开（标签 `mdpro-6e0611d7-aa9f-4dbe-9fc4-f51b1957eebf`，`windows` 列出两个 hwnd）。

**恢复与清理**

- 第二个窗口按标签用 `plugin:window|close` 关闭（`allowed_close`，`cdp.sh` 以 0 退出）；随后 `runi.ps1` + `close.ps1` 关闭 mdpro（`app.quit success`），`tauri-app` 为 0，9222 关闭。结束状态与开始时相同：**mdpro 未运行**。
- `config.json` 被本次运行改成 `D474EA49…`，已用开始时的副本恢复为 `F417022A…`，副本随后删除。
- 没有 `mdpro-audit-*` 计划任务，没有草稿。PC 上留下的只有更新后的 `cdp.mjs`（`34b4e1c3` 的版本）。
