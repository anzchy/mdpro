# ADR-0047 WI-002 验收 8 后半：验证包 About 面板真机记录（2026-10-09）

计划：[`docs/plans/20261002-plan-agent-control-channel.md`](../plans/20261002-plan-agent-control-channel.md) § 9 WI-002 第 8 项（验证包点「检查更新」不会装上正式版）。
执行方：mini 上的 dtrack 会话按 brief 跑，computer use 只授权 `mdpro-verify` 一个 app。主会话核对了报告和截图。本文件只做摘要，逐行日志和截图留在 mini 上，不提交。

## 0. 测量条件

| 项 | 值 |
|---|---|
| 机器 | Mac mini，Apple Silicon，macOS 26.4 (25E246) |
| 被测提交 | `e457cdb`（About 面板误判修复），工作区没有跟踪文件改动 |
| 被测构建 | `pnpm control:build --profile verify` 打的 `mdpro-verify.app`；`buildId` `13b68953797ef057d9d1d1efd31814ba08aa396535e492fef2c625a9e5b30fc6`（从运行的 `launch.json` 读，`doctor` 不打印这个值） |
| 运行 | `5htcq7hxs33nqgo5lwur2fbhe`，pid 39143 |
| 夹具 | `tests/manual-fixtures/adr0047-journeys.md` 的副本 `scratch/about-e457cdb/a.md` |
| 证据（mini） | `~/.mdpro-redesign/dtrack/reports/20261009-about-e457cdb.md`，截图与命令输出在 `shots/about-e457cdb/` |

硬规则同 WI-003 那两轮：不改 `HOME`，报告里不写随机数，运行目录只用 `pnpm control:clean` 删，真实 `~/.mdpro` 与 `~/Library/Application Support/mdpro` 首尾各取一次 `stat` 元数据比对。

## 1. 结果

| 步 | 检查 | 结果 |
|---|---|---|
| 0 | 预检：HEAD `e457cdb`，没有在跑的验证进程，`control:doctor` 8 项都过 | **通过** |
| U | `control:launch a.md` → L1 就绪；⌘, → About，等 5 秒截图 `U-about.png` | **通过**。更新区写的是 “mdpro / Version v0.3.0 / Automatic updates coming soon.”；没有 “Couldn't reach the update server…”，没有 Check Again，没有 Install Update / Restart to Apply |
| U | 关掉设置再开 About，约 0.5 秒截图 `U-about-2.png` | **通过**。马上显示同一句（走缓存），不再发起检查 |
| U | 启动后新增日志里匹配 `update\|about` 的行 | **通过**。只有一条 `ui.about.update_check` `status:"start"`，`forceRefresh:false`；没有 `fail` |
| 收尾 | 随机数检查（证据目录、`launcher.jsonl`、`launcher-stderr.log` 都没命中）；`control:quit`、`control:clean`、`control:doctor` 都是 `verdict: pass`；真实数据元数据前后无差异；`HOME` 始终是 `/Users/jack` | **通过** |

## 2. 结论与旁注

- 验证包没有更新地址，About 面板现在把它当成“更新未开放”，而不是网络错误；界面上没有任何能触发下载或安装的按钮。WI-002 第 8 项两半都已通过。
- 第二次打开设置会回到 General，需要再点一次 About。这是现有行为，不是这次修复引入的。
- 主会话亲自看过 `U-about.png`。
