# 启动器 CLI 真机复验记录（D179，补 D174 的 C5 / C7，`32efba1`，2026-10-12）

执行方：adr047-verify，经 ssh 在 mini 上只跑 CLI，没有点 GUI，也没用 dtrack。原始日志在 mini 的 `~/.mdpro-redesign/adr047-probe/cli-pass32/`，不提交。这是对 [7164852 那一轮](./20261012-launcher-cli-7164852-device-check.md) C5、C7 的复验，造文件、读文件的做法和那一轮相同。

## 0. 测量条件

| 项 | 值 |
|---|---|
| 机器 | Mac mini，Apple Silicon |
| 被测提交 | `32efba1`（含 D179 的 `586a0a0`），detached worktree `/Users/jack/Documents/mac-app/mdpro-wt/verify-32efba1`，`git status` 干净 |
| 被测构建 | `pnpm control:build --profile verify`，清单 `commit` 为 `32efba1`、`buildId` 为 `00e87e7a6596…`。构建前在全新安装上跑 `tests/d162-prosemirror-tables-patch-guard.test.ts`，4/4 通过（D181 的临时要求） |
| 运行父目录 | `~/Library/Application Support/mdpro-verify/runs`，起跑前为空 |
| 造残留文件 | `cli-pass32/craft.mjs`：和 7164852 那一轮是同一个脚本，只把导入路径改成 `verify-32efba1`。死 pid 用 `sh -c 'exit 0' & wait` 得到，并用 `kill -0` 确认已经不存在 |
| 照抄执行 | 从 doctor 的输出里原样取出 `remove: ` 后面的那段，用 `/bin/zsh -c "<行>"` 执行（mini 的登录 shell 是 zsh），不做任何改写 |
| 基线 | `doctor` 退出码 0，`verdict: pass` |

## 1. 结果

| # | 检查 | 命令 / 退出码 | 结果 | 决定性输出 |
|---|---|---|---|---|
| C5 | D174 / D179：墓碑和临时文件，打印的 `rm` 照抄执行 | `doctor` → 1；照抄执行两条 `rm` → 0、0；`doctor` → 0 | **PASS** | `[FAIL] no run lock: lock leftover blocks launches: .lock.74915-….tomb`；两行 `[info] lock leftover`，删除命令现在打印为 `rm ~/'Library/Application Support/mdpro-verify/runs/.lock.74915-….tomb'` 和 `rm ~/'Library/…/.lock.mutex.74915-….tmp'`，`~` 在引号外面。两条都照抄执行成功，exit 0，随后 `doctor` 回到 `verdict: pass`，父目录为空。7164852 上同一步是 exit 1（`No such file or directory`） |
| C7 | D179 / b80：只有 break 文件（死 pid），**没有** `.lock.mutex` | `doctor` → 0；直接调 `acquireLock` → 成功；照抄执行 `rm` → 0 | **PASS** | `[info] lock leftover .lock.mutex.break: holder pid 74955 dead; remove: rm ~/'Library/…/.lock.mutex.break'`。这一行不再写 `blocks launches`，也没有 `[FAIL]`，`verdict: pass`。从 worktree 用 `node` 调 `acquireLock(parent, {run, nonce})`，获取成功，耗时 1 ms。获取后目录里有 `.lock` 和 `.lock.mutex.break`，`releaseLock` 返回 `released`。doctor 的判定和真正的获取现在一致（7164852 上 doctor 判 FAIL，获取却成功）。照抄执行 `rm` 删掉了 break 文件 |
| 收尾 | — | `doctor` → 0 | **PASS** | `verdict: pass`，运行父目录为空，`HOME=/Users/jack`，worktree 干净 |

## 2. 没有覆盖的

- break 文件和死持有者的 `.lock.mutex` 同时存在的情况（D179 规定这时 break 文件算阻塞），只有单测覆盖，真机没造。
- 照抄执行只在 zsh 里跑过。`/bin/sh` 由单测覆盖：`tests/control-launcher-doctor-rm-runnable.test.ts` 把 CLI 打印的行交给 `/bin/sh` 执行。
- [7164852 记录](./20261012-launcher-cli-7164852-device-check.md) §3 列出的未覆盖项（真并发、mutex 等待超时、活着或 EPERM 的 break 持有者等）这次也没有覆盖。
