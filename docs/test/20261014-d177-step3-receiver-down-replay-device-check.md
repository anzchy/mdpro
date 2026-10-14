# D177 第 3 步：receiver 停机后补发的真机记录（ADR-0087，2026-10-14）

执行方：adr047-verify 负责停、起 MacBook 上的 receiver 并读取两端状态；mdpro-delegator 负责给 dtrack 发 `/clear` 和每一轮对话。用户选定的做法是「跳过，以「停 receiver」代替（Recommended）」，即用 `launchctl bootout` / `bootstrap` 停、起 receiver 来做这项检查。brief 见 `docs/pending/20261013-brief-item-d177-step3.md`（未提交）。没有点 GUI，dtrack 的 tmux 会话也没有重启。时间都是 +0800，mini 的 push.log 用 UTC（Z）。

## 0. 测量条件

| 项 | 值 |
|---|---|
| MacBook receiver | `~/.mdpro-redesign/hooks/`，代码来自 `07797b6`，launchd `com.mdpro.hook-receiver`（KeepAlive，所以必须用 `bootout` 才能停下） |
| mini 推送端 | `~/.mdpro-redesign/hooks/`，代码来自 `9d0dcc3`，由 dtrack 的 command hook 运行 `push.mjs` |
| 来源与 epoch | `dtrack-mini` / `5pyVtNR8oePsnf_d`，全程没变 |
| 基线 | (a) 时 receiver 在线，dtrack `/clear` 后的 SessionStart 在 08:18:21 以 seq 2 到达。`gaps.json`：`max 2, missing [], dead 0`。`events.jsonl` 有 18 行，N0 = 2 |

## 1. 过程

| 步 | 时间 | 动作 | 证据 |
|---|---|---|---|
| a | 08:18:21 | receiver 在线，delegator 给 dtrack 发 `/clear` | SessionStart `source=clear`，seq 2，`spool_dead 0`、`spool_orphans 0`。同时补上了 10-13 重装后的检查 3–4（seq 接续、无缺口）：PASS |
| b | 08:18:32 | `launchctl bootout gui/501/com.mdpro.hook-receiver` | 退出码 0。`launchctl print` 退出码 113（作业已卸载），没有 `receiver.py` 进程 |
| c | 08:19:03 / 08:19:29 / 08:19:56 | delegator 给 dtrack 发 3 轮短对话，每轮都有回答，08:20:21 空闲 | mini push.log：`flush stop seq=3 network TypeError/ECONNREFUSED` 共 3 行（00:19:13Z、00:19:31Z、00:19:57Z）。起 receiver 前读到 `spool.jsonl` 有 3 条：Stop seq 3 / 4 / 5，`spool_ts` 分别为 00:19:13.174Z、00:19:31.681Z、00:19:57.626Z |
| d | 08:20:47 | `launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.mdpro.hook-receiver.plist` | 退出码 0，pid 57677。receiver.log 08:20:48 `listening on …:8787`。此时 `gaps.json` 仍是 `max 2`：补发要等下一次推送 |
| e | 08:20:57–08:21:04 | dtrack 的下一次 hook 推送，然后是 delegator 的 1 轮对话 | 见 §2 |

## 2. 结果

**PASS。** 停机期间产生的 3 个事件都在 mini 上排队，没有丢。receiver 起来后的第一次推送把它们按顺序补发，后面的新事件接着编号，没有缺口，也没有 dead-letter。

| seq | 事件 | 产生时间（spool_ts） | 到达 receiver | mini push.log |
|---|---|---|---|---|
| 3 | Stop | 00:19:13.174Z | 08:20:57 | `flush sent seq=3 status=200`（00:20:57.957Z） |
| 4 | Stop | 00:19:31.681Z | 08:20:58 | `flush sent seq=4 status=200`（00:20:58.057Z） |
| 5 | Stop | 00:19:57.626Z | 08:20:58 | `flush sent seq=5 status=200`（00:20:58.075Z） |
| 6 | Notification `idle_prompt` | 00:20:57.868Z | 08:20:58 | `flush sent seq=6 status=200`（00:20:58.089Z） |
| 7 | Stop（第 e 步那一轮） | 00:21:04.797Z | 08:21:04 | `flush sent seq=7 status=200`（00:21:04.901Z） |

- receiver.log 里 5 行 `POST /hook -> 200`，`spool=dtrack-mini/5pyVtNR8oePsnf_d#3` 到 `#7`，严格递增。
- 结束时 `gaps.json`：`{"dtrack-mini": {"epoch": "5pyVtNR8oePsnf_d", "max": 7, "missing": [], "dead": 0}}`。`seq-state.json`：`orphans 0, retired [], late_seen [], floor 1`。
- 结束时 mini 的 `spool.jsonl` 为 0 字节（队列已清空）。
- 触发补发的是 seq 6，不是第 e 步那一轮：dtrack 在最后一轮回答后大约 60 秒发出 `idle_prompt` 通知，这是 receiver 起来后的第一次推送。它先把 3–5 按顺序发完，再发自己。第 e 步的 Stop（seq 7）是正常的在线推送。brief 写的「receiver 起来后的下一个事件触发补发」是同一条代码路径（`pushFlush` 先 flush 队列再发新事件），这一项算**已覆盖**，不是「未覆盖」。

## 3. 没有覆盖的

- 未鉴权的 401 探测（重装第 1 步的检查 2）这一轮仍然没有跑（会话内被拒绝），由单测覆盖。
- 4xx 进 dead-letter、epoch 轮换、队列超过上限、补发途中 receiver 再次停机，这几种情况真机都没有造，只有 `tests/d177-*` 的单测覆盖。
- D177 行里列出的未决审计项（三方回收交错、`rfile.read` 无超时、hook 目录里的符号链接、状态损坏重置会丢 floor）和本次检查无关，仍然未决。
