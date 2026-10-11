# 跨机器驱动 Claude session：MacBook ↔ Mac mini 调研记录

- 日期：2026-10-11
- 状态：调研记录；**3.1 Remote Control 直发已于 2026-10-11 验证通过（§ 2.3）；3.2 hook 推送已于 2026-10-11 14:03 落地并验证（§ 2.4）**，Warp 镜像仍待用户决定
- 来源：delegator 会话 `f6e5ee76-…` 的 transcript。该会话派出两个研究 subagent：一个查 Claude Code 官方文档（code.claude.com，2026-10-11 抓取），一个查 tmux 官方文档（OpenBSD tmux(1) man page、tmux wiki 的 FAQ 与 Control-Mode 页）。两个 subagent 都没有执行任何改变状态的命令。
- 本文只整理 transcript 里已有的内容。没有调研到的点会直接注明「未调研」。

## 1. 背景

### 两台机器与角色（rule 70）

| Session                                             | 机器                 | Model | 负责                                        |
| --------------------------------------------------- | ------------------ | ----- | ----------------------------------------- |
| mdpro-delegator                                     | MacBook，主 checkout | Fable | 协调、派活、验证并 fast-forward、问用户、写 device brief |
| mdpro-implementor-*（`mdpro-a3`、`mdpro-a6`）         | MacBook            | Opus  | 各自 worktree 里的 WI / D item                |
| mdpro-auditor-*（`mdpro-codex-audit`）               | MacBook            | Opus  | 审计和审计修复                                   |
| mdpro-device-harness（`adr047-verify`，原名 `mdpro-85`） | Mac mini           | Opus  | 设备测试工具链（ADR-0047）                         |
| real-device-tester（tmux session `dtrack`）           | Mac mini           | Opus  | 只做 GUI 真机检查，按 brief 运行，只写报告，不 commit      |

完整表格见 `.claude/rules/70-multi-session-coordination.md`。

### 用户想自动化什么

用户原话（transcript 第 658 行）：

> 用subagent查查tmux 和claude 的official docs，还有什么关键的commands可以帮助我们最大化自动化 rule 70的相关流程，譬如本机的claude session是否可以直接和mini上claude session对话，是否可以把mini的session 在本机Warp上映射过来，等等，避免我在mini上和本机之间来回切换窗口

核心诉求有三条：

1. 本机 delegator 直接和 mini 上的 Claude session（主要是 `dtrack`）对话。
2. 在本机 Warp 里看到 mini 的 session。
3. 用户不必在两台机器之间来回切窗口。

## 2. 现状（已验证可用）

### 2.1 ssh + tmux 驱动 `dtrack`

- **连接**：ssh alias 是 `mac-mini`，用户 `jack`。非交互 ssh 不带 Homebrew 的 PATH，所以要先把 `/opt/homebrew/bin` 放进 `PATH`，或者写全路径 `/opt/homebrew/bin/tmux`。
- **读屏**：`tmux capture-pane -pt dtrack`。发送任何内容之前都先读一次屏。
- **发 brief**：transcript 第 545 行有实际用过的命令序列：

  ```sh
  tmux send-keys -t dtrack "/clear" Enter; sleep 4
  tmux send-keys -t dtrack -l "Read ~/.mdpro-redesign/dtrack/brief-<...>.md and run it end to end. ..."
  sleep 1; tmux send-keys -t dtrack Enter; sleep 8
  tmux capture-pane -pt dtrack | tail -25
  ```

  正文要单独发，隔一段时间后再单独发一个 `Enter`。粘贴一长段文字后紧跟的第一个 `Enter` 不会提交。tmux 研究也认为文本和 Enter 应该分两次调用，中间留间隔：TUI 可能还在处理粘贴，tmux 文档没写这个竞态，属于 \[empirical]。
- **Computer Use 权限提示**：tester 每次 `/clear` 都会丢掉之前的授权，所以每轮都会先停在 mdpro 的权限提示上。常设规则（用户 2026-10-10 决定）如下：

  1. 先用 `capture-pane` 确认列出的 app 只有 `mdpro`。
  2. 再依次发 `tmux send-keys -t dtrack Down` 和 `Enter`，选「Allow for this session」。
  3. 再 `capture-pane` 一次，确认测试继续在跑。

  提示里出现其他 app，或者给出的不是 session 级授权时，不要自己处理，交给用户。
- **报告**：tester 把报告写到 `~/.mdpro-redesign/dtrack/reports/` 下。
- **安全约束**（rule 70）：
  - 拷文件用 `rsync`，不用 `scp`。
  - 不传 `StrictHostKeyChecking=no`。
  - 不拷 `~/.mdpro` 和 `~/.claude`。
  - 不打印 MCP token。
  - 不通过 ssh 创建、kill 或重启 tester 的 tmux session。

### 2.2 同机器跨 session 消息：ListAgents / SendMessage

- 同一台机器上的 session 用 `ListAgents` 查找对方，用 `SendMessage` 发消息。
- 每个 session 绑定一个 Unix socket，transcript 里能看到 `from="uds:/tmp/cc-socks/<pid>.sock"`。这条路径不经过 Anthropic 服务器。
- delegator 和 implementor、auditor 之间的交接、审计派单都走这条通道。
- `ListAgents` 里 mini 上的 session 显示为「Remote Control · offline」，现在从 MacBook 发不过去。
- transcript 中 delegator 认为 `adr047-verify` 实际在本机列表里。它的跨 session 消息也确实是通过本机 `/tmp/cc-socks` socket 到达的。这一点和 rule 70 表格里写的「Mac mini」不一致，来源：会话内记录，未另行核实。

### 2.3 Remote Control 直发 `dtrack`（2026-10-11 13:46 验证通过）

用户让 `dtrack` 执行了 `/rc` 并 `/rename dtrack`，delegator 这边 `ListAgents` 里它显示为「Remote Control · idle」。delegator 用 `SendMessage` 直接发了一条连通性测试，不经 ssh：

- 消息经 Anthropic 服务器到达 mini。ssh 看屏确认它先被 **held**：「The sending session's permission mode class doesn't match this session's」（dtrack 是 `prompting`，delegator 是 bypass）。用户在 mini 上放行后才进队列。
- dtrack 的回信直接回到 delegator：`ack, 2026-10-11 13:46:18 CST, MDPRO_ROLE=<unset>`。delegator 侧显示发件人为 `bridge:session_…`，说明本 session 已接在 Remote Control 上。
- 要免掉每条消息的手动放行，二选一，都是用户的事：在 mini 的 dtrack 里把 `crossSessionInbound` 设为 `accept`，或让 dtrack 以与 delegator 同类的权限模式启动。
- `dtrack` 这个 session 没设 `MDPRO_ROLE`，role-guard 钩子在它那里没生效；下次重启时用 `MDPRO_ROLE=real-device-tester claude`。
- 仍然要走 ssh + tmux 的两步不变：`/clear`（消息里的 slash 命令只是纯文本），以及 Computer Use 的「Allow for this session」放行。

### 2.4 hook 推送：mini 的 `dtrack` 事件直达本机（2026-10-11 14:03 验证通过）

按 § 3.2 实现，用户决定「用 http 推送通知代替轮询」。当天 14:03:04 与 14:05:03 两条真实 `Stop` 事件到达本机接收器，dtrack **没有重启**，所以新建的项目级 settings 也会被文件监视自动加载。

- **mini 侧**：只新建了 `~/.mdpro-redesign/dtrack/.claude/settings.json`（0600，之前不存在；用户级配置未动，所以只影响在该目录启动的 dtrack）。三个 `type: "http"` hook：`Stop`（无 matcher）、`Notification`（matcher `permission_prompt|idle_prompt|agent_needs_input|elicitation_dialog`）、`SessionStart`（`clear|startup|resume`），都 POST 到 `http://<本机 Tailscale IP>:8787/hook`，header `X-Mdpro-Token`，timeout 10 s。token 以明文放在这个文件里，没有更好的传法。
- **本机侧** `~/.mdpro-redesign/hooks/`：`receiver.py`（python3 标准库，只绑 Tailscale IP，POST 且 token 常量时间比较通过才收；401 / 405 其余拒掉；事件追加到 `events.jsonl`，同时覆盖写 `latest.json`，日志 `receiver.log`），launchd `com.mdpro.hook-receiver` 常驻；`wait-dtrack.sh -t <秒> [-e <正则>]` 阻塞到下一条匹配事件（打印事件，超时 exit 124）；`last-dtrack.sh` 打印最近一条；`build-mini-settings.py` 从 token 文件生成 mini 那份 settings。
- **从 mini 实测**：带 token POST → 200 并落一行；无 token / 错 token → 401；GET → 405。本机 curl 被权限系统挡住，所以这些测试全部从 mini 发起。
- **怎么用**（已写进 rule 70「The Mac mini」）：发 brief 或消息后，后台跑 `wait-dtrack.sh`，事件到了再看；`capture-pane` 只用来看事件说不清的东西（停在哪个提示上、打印了什么），不再每 20 秒轮询一次。Computer Use 放行的信号是 `permission_prompt` 通知（提示挂起约 6 秒后触发）。
- **已知限制**：本机 Tailscale IP 变了要重跑 `build-mini-settings.py` 并 rsync；`Notification` 在 `claude -p` 下是否触发仍未验证；事件里带 `last_assistant_message` 全文，所以 `events.jsonl` 不要公开。

---
## 3. 备选方案

### 3.1 Claude Code Remote Control（`/rc`）+ 跨机器 SendMessage

- **是什么**：让 session 接入 Anthropic 的 Remote Control 通道。这样可以在 claude.ai/code 或手机 app 上看到并操作这个 session，接入的 session 也能收到其他机器发来的消息。
- **怎么启动**：
  - 会话内：`/remote-control` 或 `/rc`。
  - 启动时：`claude --remote-control "<name>"` 或 `claude --rc "<name>"`。
  - server 模式：`claude remote-control --name "<name>"`，可选 `--spawn same-dir|worktree|session` 和 `--capacity <N>`（默认 32）。
  - 来源：<https://code.claude.com/docs/en/remote-control> 、<https://code.claude.com/docs/en/cli-reference>
- **能带来什么**：
  - mini 上的 session 开 Remote Control，本机 delegator 自己也连上 Remote Control 之后，mini session 会出现在本机的 `/list-agents`（别名 `/peers`）里，可以用 `SendMessage` 直接发 brief，不再需要 `tmux send-keys`。
  - 显示 `offline` 只是连接暂时断了，消息会被接受，在对方重连后送达。
  - 发送方也连着 Remote Control 时，对方能回复。发送方没连时消息仍然能发出去，但对方无法回复，文档称这种情况为单向跨机器。
  - 来源：<https://code.claude.com/docs/en/cross-session-messaging>
  - 另外，Computer Use 的权限提示会一直挂着等人处理，可以在手机或 claude.ai/code 上点掉，不用切到 mini 的窗口。来源：同上两页。
- **前提**：
  - 需要 Pro / Max / Team / Enterprise 计划，用 claude.ai 登录，**不支持 API key**。
  - Team 和 Enterprise 需要 Owner 打开 Remote Control 开关。
  - 把 `ANTHROPIC_BASE_URL` 指向别处会导致它不可用。
  - 每台机器分别登录。
  - 来源：<https://code.claude.com/docs/en/remote-control>
- **版本**：跨 session 消息需要 macOS 上 v2.1.224+；要和另一台机器上的 session 主动发起对话需要 v2.1.225+。来源：<https://code.claude.com/docs/en/cross-session-messaging>
- **限制和风险**：
  - 跨机器的消息经过 Anthropic 服务器，不走 tailnet。
  - 别的 session 发来的消息**永远不算同意**：不能替对方回答权限提示，不能修改 settings 或 CLAUDE.md。消息里的 slash 命令会按纯文本送达，不会执行。所以 `/clear` 和权限放行仍然要靠 tmux 或人手操作。（这条是 delegator 的推论，来源：会话内记录，未另行核实。）
  - 消息只能是纯文本。同机器的单条消息上限约一百万字符。短时间连发会在发送端被拒，循环会被限流。
  - 发给 Remote Control session 的消息，即使被拒收或挂起也不会回报，所以对方没有回应不能当作同意（本机 SendMessage 工具说明）。
  - 相关控制项：`crossSessionInbound`（`accept` / `hold` / `refuse`）、`isolatePeerMachines: true`（消息离开本机前要用户批准），以及对 `SendMessage` / `ListAgents` 的 deny 规则。
  - 文档没有说明能否从 `-p` 运行里启动 `/remote-control`。
- **代价**：零代码。需要用户在 mini 的 `dtrack` 里输入 `/rc`，delegator 侧也执行 `/rc`。消息会经过 Anthropic 服务器。

### 3.2 Claude Code hooks：用 http 推送通知代替轮询（已落地，见 § 2.4）

- **是什么**：在 mini 的 `~/.claude/settings.json` 里配置 `Stop` hook 和 `Notification` hook（matcher `permission_prompt`），hook 类型用 `type: "http"`，把事件 JSON POST 到本机的一个接收器。
- **能带来什么**：`dtrack` 跑完，或者停在权限提示上时，本机能立刻知道。这样可以替换 delegator 现在每 20 秒一次 `capture-pane` 的 Monitor 轮询。
- **文档要点**（来源：<https://code.claude.com/docs/en/hooks> 、<https://code.claude.com/docs/en/hooks-guide> ）：
  - `Stop`：Claude 结束一次回复时触发，用户中断时不触发。输入里有 `stop_hook_active` 和 `last_assistant_message`。
  - `Notification`：输入是 `message`、`title`、`notification_type`。matcher 包括 `permission_prompt`、`idle_prompt`、`auth_success`、`elicitation_dialog`、`agent_needs_input`、`agent_completed`。这个 hook 不能阻塞。`permission_prompt` 要等提示挂了约 6 秒才触发。
  - `SessionStart`：matcher 有 `startup` / `resume` / `clear` / `compact` / `fork`。另外还有 `SessionEnd`、`SubagentStop`、`UserPromptSubmit`。
  - 所有 hook 的公共输入字段：`session_id`、`transcript_path`、`cwd`、`hook_event_name`。
  - `http` 类型的 hook 收到非 2xx 响应也不会阻塞。
  - 环境变量：`CLAUDE_CODE_BRIDGE_SESSION_ID` 只在连着 Remote Control 时才有。
- **前提**：本机要跑一个几十行的接收器，mini 要能通过 tailnet 访问到它。接收器的端口、鉴权等细节都未调研。
- **限制和风险**：
  - 文档没写 `Notification` 在 `claude -p` 下会不会触发。
  - hook 改的是 mini 上的用户级配置，影响 mini 上所有 Claude session。这一点是推论，未调研具体作用域。
- **代价**：一个小接收器加两条 hook 配置。验证通过后要改写 rule 70「The Mac mini」一节。

### 3.3 tmux 侧的事件机制（不改 Claude 配置）

- **静默告警**：

  ```sh
  tmux set-option -w -t =dtrack: monitor-silence 15
  tmux set-hook -t =dtrack alert-silence 'run-shell -b "tmux wait-for -S dtrack-idle"'
  ssh mac-mini "tmux wait-for dtrack-idle"   # 本机阻塞，直到 dtrack 空闲
  ```

- **流式输出**：`tmux pipe-pane -o -t =dtrack:0.0 'cat >> ~/.mdpro-redesign/dtrack/pane.log'`，本机再用 `ssh mac-mini 'tail -f …'` 读这个文件。
- **控制模式**：`tmux -C attach` 会输出 `%output` 行；用 `refresh-client -B` 订阅后会推送 `%subscription-changed`，最多每秒一次。可以作为基于推送的监视器。
- **限制**：
  - 「安静」不等于「完成」，权限提示也是安静的。hook 触发后还得 `capture-pane` 看屏幕才能区分。
  - 这个机制依赖 Claude 的 spinner 在忙的时候持续有输出 \[empirical]。
  - `pipe-pane` 记录的是 TUI 的原始重绘字节流，不是 transcript，只能用来判断 pane 是否有活动。
  - 发键前要看 `#{pane_in_mode}`，大于 0 说明 pane 在 copy mode，键会被 copy mode 吃掉。
  - target 用 `=dtrack` 做精确匹配，最好用 pane id（如 `%3`）。
  - 长 prompt 应该走 `load-buffer` / `paste-buffer -p -r -d`；Claude Code 是否开启 bracketed paste 未知 \[empirical]。
  - man.openbsd.org 描述的是 tmux -current。`wait-for -E`、`set-hook -E/-B` 这些较新的 flag 用之前，先用 `/opt/homebrew/bin/tmux -V` 确认版本。
- **来源**：<https://man.openbsd.org/tmux> 、<https://github.com/tmux/tmux/wiki>
- **研究结论**：hook 方案（3.2）比 tmux 静默检测更准确。

### 3.4 在本机 Warp 里镜像 `dtrack`

- **可行且最简单**：
  - 只读镜像：`ssh -t mac-mini "/opt/homebrew/bin/tmux attach -r -t '=dtrack'"`。`-r` 等于 `-f read-only,ignore-size`，不会改变 Claude pane 的尺寸。

* 需要输入时去掉 `-r`，或者建一个 grouped session：`new-session -t =dtrack -s dtrack-view`，用完后 `kill-session -t =dtrack-view`。这两种方式都可能改变窗口尺寸，从而触发 TUI 重绘。
* tmux FAQ 指出，read-only「is not a security mechanism」。

- **不可行**：
  - 用 ssh 转发 tmux socket，再让本机的 tmux client 直接连。tmux 文档没有提到这种用法。根据 tmux 源码，client 要通过 Unix socket 传递终端 fd，ssh 转发带不过去，而且协议版本不一致会被拒绝 \[source]。
- **未知**：`tmux -CC` 控制模式，wiki 只说 iTerm2 原生支持，Warp 是否支持没有文档。
- **Claude 侧**：
  - `claude attach` / `claude logs` 只适用于用 `--bg` 启动的后台 session，`dtrack` 是普通 tmux session，用不了（推论）。来源：<https://code.claude.com/docs/en/agent-view>
  - Remote Control 不是终端镜像，它提供的是 claude.ai/code 或手机上的视图。
  - Desktop app 的 Code 标签能在 SSH host 上跑 session（<https://code.claude.com/docs/en/desktop> ），但它和 tmux、Remote Control 怎么配合，文档没写。
- **代价**：在 Warp 里固定一个标签页，零代码。

### 3.5 headless `claude -p` over ssh（研究中列出，但不适用于 GUI 测试）

- **可用 flag**：

  - `-p`
  - `--output-format json|stream-json`
  - `--input-format stream-json`
  - `-p --resume <id>`
  - `--session-id <uuid>`
  - `--permission-mode`
  - `--permission-prompts none`（v2.1.259+）
  - `--allowedTools`
  - `--max-turns` / `--max-budget-usd`
  - `--bare`（跳过 hooks、`.mcp.json`、CLAUDE.md 和 auto memory）

  来源：<https://code.claude.com/docs/en/headless> 、<https://code.claude.com/docs/en/cli-reference>
- **示例**（研究者用文档里的 flag 拼出来的，不是官方 recipe）：

  ```sh
  ssh mac-mini 'cd <mdpro path> && claude -p --resume <id> --output-format json --permission-prompts none "<brief>"'
  ```

- **硬限制**：
  - Computer Use 只能在交互式 session 里用，文档原话是 "is not available in non-interactive mode with the `-p` flag"。所以 GUI 真机检查不能改成 `-p`。
  - 文档没有说明怎样预先授权 `mdpro` 这一个 app。`mcp__computer-use__*` allow 规则能不能跳过按 app 的 `request_access` 也不清楚。
  - 同一时间只能有一个 session 持有 computer-use 锁。
  - 来源：<https://code.claude.com/docs/en/computer-use> 、<https://code.claude.com/docs/en/permissions>
- **`-p` session 不可达**：mini 上的 `-p` session 不能通过消息从 MacBook 访问到。

### 3.6 跨机器 `--resume`、cloud session、routines（研究中排除）

- **`--resume`**：
  - transcript 存在 session 所在机器的 `~/.claude/projects/<project>/<session-id>.jsonl`。
  - `claude --resume` 只搜本机，跨机器只能 `ssh mac-mini 'claude --resume <id>'`。
  - 同一个 session 在两个终端里 resume 而不 fork，两边内容会交错写进同一份 transcript。
  - 来源：<https://code.claude.com/docs/en/sessions>
- **cloud session**：跑在 Anthropic 的基础设施上。`claude -p "msg" --cloud <id>` 只能发 follow-up，`--teleport` 只拉 cloud session。来源：<https://code.claude.com/docs/en/claude-code-on-the-web>
- **routines**（`/schedule`）：在云端运行，从 GitHub clone 仓库，访问不到本地机器，所以驱动不了 mini。来源：<https://code.claude.com/docs/en/routines>

## 4. 对比表

| 方案                                     | 解决什么                      | 前提                                      | 主要限制                                                 | 代价               |
| -------------------------------------- | ------------------------- | --------------------------------------- | ---------------------------------------------------- | ---------------- |
| 现状：ssh + tmux send-keys / capture-pane | 发 brief、读屏、放行权限提示         | ssh alias、PATH                          | 靠轮询；Enter 时机脆弱；用户仍要到 mini 看                          | 已在用              |
| Remote Control `/rc` + SendMessage     | 本机直接给 mini 发消息；手机或网页点权限提示 | 订阅计划 + claude.ai 登录，两端都 `/rc`，v2.1.225+ | 经过 Anthropic 服务器；消息不能答权限提示，也不能执行 `/clear`；对方无回应不等于同意 | 零代码              |
| Stop / Notification http hook          | 完成和卡住时推送，替代轮询             | mini settings 加 hook，本机加接收器             | `-p` 下行为未知；接收器细节未调研                                  | 小量代码 + 改 rule 70 |
| tmux silence + wait-for / pipe-pane    | 不改 Claude 配置的空闲信号         | tmux 版本支持                               | 安静 ≠ 完成；pipe-pane 只是重绘流                              | 几条命令             |
| Warp 只读镜像 `ssh -t … attach -r`         | 本机看到 dtrack 画面            | 无                                       | 只读；可写模式会触发重绘；`-CC` 在 Warp 里未知                        | 零代码              |
| headless `claude -p`                   | 非 GUI 任务的程序化驱动            | 无                                       | 不能用 Computer Use，不适合 dtrack                          | —                |

## 5. 建议（早先会话的建议，**待用户决定**）

早先的 delegator 会话（transcript 第 694 行）建议按以下顺序推进：

1. 用户在 mini 的 `dtrack` 里执行 `/rc`，本机 delegator 也执行 `/rc`，验证两边能互发消息。零代码，当天就能试。
2. 在 mini 的 `~/.claude/settings.json` 里加 `Stop` 和 `Notification(permission_prompt)` 两个 http hook，本机跑一个几十行的接收器。验证通过后，把 rule 70「Mac mini」一节里的 `capture-pane` 轮询改成 hook 通知。
3. 在 Warp 里固定一个 `ssh -t … attach -r` 标签页，作为 `dtrack` 的只读镜像。

它同时指出有两点绕不开：

- Computer Use 只能在交互式 session 里用；每次 `/clear` 后的「Allow for this session」仍然要人点，只是可以改成在手机上点。
- session 不能跨机器 `--resume`。

当时给了用户三个选项：

1. 直接做第 1 步验证。
2. 先让 Codex 评一轮。
3. 先把研究原文存到 `docs/reference/`。

到这次会话的后续摘要（第 2326 行）为止，记录仍是「Automation decision (Remote Control `/rc`, hooks, Warp mirror) still unchosen by the user」。

> **状态：待用户决定。** 本文只是第 3 个选项（存档研究）的产物，不代表已经选定任何方案，rule 70 也没有修改。

## 6. 参考链接

Claude Code 官方文档（2026-10-11 抓取）：

- <https://code.claude.com/docs/en/cross-session-messaging>
- <https://code.claude.com/docs/en/remote-control>
- <https://code.claude.com/docs/en/cli-reference>
- <https://code.claude.com/docs/en/hooks>
- <https://code.claude.com/docs/en/hooks-guide>
- <https://code.claude.com/docs/en/headless>
- <https://code.claude.com/docs/en/computer-use>
- <https://code.claude.com/docs/en/permissions>
- <https://code.claude.com/docs/en/sessions>
- <https://code.claude.com/docs/en/agent-view>
- <https://code.claude.com/docs/en/desktop>
- <https://code.claude.com/docs/en/claude-code-on-the-web>
- <https://code.claude.com/docs/en/routines>
- <https://code.claude.com/docs/en/worktrees>

tmux：

- <https://man.openbsd.org/tmux> （描述的是 tmux -current，用前请核对本机版本）
- <https://github.com/tmux/tmux/wiki> （FAQ、Control-Mode）

仓库内：

- `.claude/rules/70-multi-session-coordination.md`（session 表、Mac mini 规则、Computer Use 自动放行规则）

