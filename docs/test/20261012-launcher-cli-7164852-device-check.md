# 启动器 CLI 真机验收记录（D105 / D148 / D170 / D174，`7164852`，2026-10-12）

执行方：MacBook 上的子代理经 ssh 驱动 mini，全程只用 CLI，没有点 GUI，也没用 computer use。原始日志和辅助脚本都在 mini 的 `~/.mdpro-redesign/adr047-probe/cli-pass/`（`c0-…` 到 `c8-…`、`teardown-doctor.log`、`poller.log`），不提交。

## 0. 测量条件

| 项 | 值 |
|---|---|
| 机器 | Mac mini，Apple Silicon，macOS 26.4 (25E246) |
| 被测提交 | `7164852`（detached），worktree `/Users/jack/Documents/mac-app/mdpro-wt/verify-7164852`，`git status` 干净 |
| 被测构建 | 已有的 `pnpm control:build --profile verify` 产物，没有重打。清单：`buildId` `d3ce63112316…`，`commit` `7164852`，profile `verify` |
| 包路径 | `src-tauri/target/verify/release/bundle/macos/mdpro-verify.app`（清单在同目录 `build-manifest.json`） |
| 运行父目录 | `~/Library/Application Support/mdpro-verify/runs`（起跑前为空） |
| 预检 | `pgrep -fl 'mdpro.app/Contents/MacOS\|mdpro-verify.app'` 为空，日常 mdpro 没开 |
| 执行方式 | `launch` / `quit` 在已有 tmux server 里新建的会话 `adr047cli` 中执行（`tmux new-session -d -s adr047cli '<cmd> > <log> 2>&1'`，脚本 `tl.sh`），命令结束会话即退出。`doctor`、`clean` 和造文件的脚本直接在 ssh shell 里跑（不需要 GUI）。没碰 `dtrack` / `mdpro` 会话 |
| 夹具 | `tests/manual-fixtures/adr0047-journeys.md` 的副本 `cli-pass/a.md`、`b.md` |
| 造残留文件 | `cli-pass/craft.mjs`：从 worktree 导入 `launchDeps`（`newRunName`/`newNonce`）、`runDir.runsParent`，并用仓库自己的读取函数回读（`readRecordAt`、`readHolder`、`readMarker`）。死 pid 用 `sh -c 'exit 0' & wait` 得到，并用 `kill -0` 确认是 ESRCH |
| 旁观 | `cli-pass/poller.mjs`：从 C4 起每约 1 ms `readdir` 一次运行父目录，记下每个名字的出现和消失（`poller.log`）。C1–C3 时还没开 |
| 随机数检查 | `cli-pass/secretcheck.mjs`：在进程内读 `launch.json` 的 nonce，只打印 `shasum` 前 12 位和命中计数；`clean` 由它代为执行，所以运行目录删除后的日志也在同一进程里查过 |
| 硬规则 | 没有 `export HOME`（结束时 `HOME=/Users/jack`）；记录里没有随机数、token 或摘要原文；运行目录只用 `pnpm control:clean` 删；没碰 mini 主检出、`~/.mdpro`、`~/.claude` |

本轮的运行：R1 `32cdxoloy8d1d6ahawbm0dk9e`（pid 60992，nonce shasum12 `363a656a688a`），R2 `2bf2mf7rl98hfjkdfiis4qg6m`（pid 61554，nonce shasum12 `6f8247c6d2ad`）。

## 1. 结果

| # | 检查 | 命令 / 退出码 | 结果 | 决定性输出 |
|---|---|---|---|---|
| C0 | 基线 | `doctor` → 0 | **PASS** | 8 个 `[pass]`，`verdict: pass`，没有 `[info] lock leftover` 行 |
| C1 | D105 获取 | `launch a.md` → 0 | **PASS** | `ready: L1 run 32cdxoloy8d1d6ahawbm0dk9e pid 60992` / `verdict: pass`。父目录里只有 `.lock` 和 R1，没有 `.lock.mutex` 和 `.lock.mutex.break`；`kill -0 60992` 成功 |
| C2 | 运行活着时再 `launch b.md` | → 1 | **PASS** | doctor 闸门拒绝：`[FAIL] no run lock: lock held by run 32cd… (live)`，`verdict: fail`。没有新运行目录，没有 mutex 或 break 文件 |
| C3 | `quit R1` | → 0 | **PASS** | `quit: run 32cd… terminated (SIGTERM)` / `verdict: pass`。60992 已是 ESRCH，`.lock` 没了，没有 mutex 或 break 文件 |
| C4 | `clean R1` | → 0 | **PASS** | `clean: removed 32cd…`、`clean: removed stale si.sock`、`verdict: pass`。父目录为空，没有 `.clean.*` 和 `*.tmp` |
| C5 | D174 墓碑和临时文件、D105 墓碑拒绝 | `doctor` → 1；`launch` → 1；`doctor` → 0 | **FAIL**（只有一项：打印的 `rm` 照抄执行不了；其余都符合） | `[FAIL] no run lock: lock leftover blocks launches: .lock.61258-43fd03b05bcd5f92.tomb`。两行 `[info] lock leftover`：`tomb of run 60e7qt7sd9x05mxv35rp4wd2c; blocks launches; remove: rm '~/Library/…/.lock.61258-….tomb'` 和 `temp file, nothing reads it …; remove: rm '~/Library/…/.lock.mutex.61258-….tmp'`。`launch` 被闸门以同一条 FAIL 拒绝，没有建运行目录。**照抄执行打印的命令：`rm: ~/Library/…: No such file or directory`，exit 1**（`c5-rm-verbatim.log`）。只把 `'~/` 换成绝对家目录后两条都删掉了，`doctor` 回到 pass。见 §2.1 |
| C6 | D174 和 ADR-0077：死 mutex | `doctor` → 0；`launch a.md` → 0；`quit` → 0 | **PASS** | `[info] lock leftover .lock.mutex: holder pid 61464 dead; remove: rm '…'`，没有 blocks，`verdict: pass`。`launch` 打出 `ready: L1 run 2bf2mf7rl98hfjkdfiis4qg6m pid 61554`，之后 `.lock.mutex` 没了。`quit` 用 SIGTERM，pass。`clean` 放到 C8 一起做 |
| C7 | D174 break 文件（死 pid，**没有** `.lock.mutex`） | `doctor` → 1；直接调 `acquireLock` → 成功；`rm` 后 `doctor` → 0 | **PASS（按设计），但按 b80 判过严** | `[FAIL] no run lock: lock leftover blocks launches: .lock.mutex.break`；`[info] lock leftover .lock.mutex.break: holder pid 61756 dead; blocks launches; remove: rm '~/…'`。之后从 worktree 用 `node -e` 调 `acquireLock(parent, {run, nonce})`（造的 run 名 `0oocx3ocw49bjv2dyo9whwul0`）：**`acquire OK`，耗时 1 ms**，`.lock` 持有；`releaseLock` 返回 `released`，最后只剩 break 文件。doctor 说 FAIL，真正的获取却成功了。见 §2.2。删掉 break 文件后 `doctor` pass（`rm` 也有 §2.1 的 `~` 问题） |
| C8 | D148 清理认领 | `clean R2`（marker 的 pid 活着）→ 1；杀掉 sleep 后 `clean R2` → 0 | **PASS** | `.clean.2bf2…` 里是活的 `sleep 120`（pid 61646）。doctor 列出 `holder pid 61646 alive, in use`，没给 `rm`。`clean` 拒绝：`verdict: driver failure — run 2bf2… is being cleaned (cleaner pid 61646, .clean.2bf2…)`，R2 还在。`kill 61646` 后：`clean: removed 2bf2…`、`clean: removed stale si.sock`、`verdict: pass`。最后没有 marker，也没有 tmp |
| C9 | D170 观察 | — | **PASS** | 除自己造的文件外，没有一条命令留下 `.lock.mutex*` 或 `.clean.*`（poller 里每个出现的名字最后都消失了，状态快照也都对得上）。**看到过 `*.tmp`**，都只存在 1–2 ms，随后被删：`.lock.mutex.61217-….tmp`、`.clean.32cd….61217-….tmp`（C4 的 clean），`.lock.mutex.61699-….tmp`（C8 第二次 clean）。这就是 writeWhole 的写临时文件再 link 的路径。持续存在的 tmp 只有 C5 造的那一个 |
| C10 | 随机数卫生 | `secretcheck.mjs` | **PASS** | R1、R2 各查 2 次（运行活着时；clean 由检查脚本代跑，跑完后再查一次，覆盖 quit、clean 的日志），`cli-pass/` 下全部日志和脚本里 `hitsOutsideRun=0`。运行目录里只有 `launch.json` 和 `instance.json` 命中（都是运行自己的文件）；`launcher.jsonl`、`launcher-stderr.log` 和 app 在运行目录里的日志都是 0 命中。C7 直接获取用的 nonce 只在进程内，没写进任何文件 |
| 收尾 | — | `doctor` → 0 | **PASS** | 没有 mdpro 或验证进程，没有 `sleep 120`，poller 已杀，运行父目录为空，`/tmp/com_mdpro_app_verify_si.sock` 不存在，`adr047cli` 会话已经没了（`tmux ls` 只有 `dtrack`、`mdpro`），worktree 干净 |

## 2. 观察

### 2.1 FAIL（C5，也影响 C6、C7 的打印行）：doctor 给的 `rm` 命令照抄执行不了

- **现象**：doctorLeftovers 生成的是绝对路径，单引号括起来。但 CLI 层对每一行都做家目录替换，把 `/Users/jack` 换成了 `~`，结果是 `rm '~/Library/Application Support/…'`。`~` 在单引号里不展开，所以照抄执行会报 `No such file or directory` 并 exit 1。文件没删，doctor 仍然 FAIL。这不会造成破坏（删不掉，也不会删错），但 D174 要提供的「照着做就能清掉」的指引被它抵消了。
- **代码路径**：
  - `scripts/control/doctorLeftovers.mjs:167`（`shellQuote`）和 `:195`（``remove: rm ${shellQuote(e.path)}``）。模块头特意写了「the passwd home's realpath, never `~`」。
  - 这一行之后经过 `scripts/control/launcherCli.mjs:140`（`out = … redact(line, paths)`）。
  - 进入 `scripts/control/launcherFormat.mjs:49`（`replaceAll(out, homeDir, "~")`），这个替换不看引号。
- **单测为什么没发现**：leftoverLine 的单测看的是带绝对路径的原始行，CLI 的 redact 是另一层，没有测试把两层合起来看 `rm` 行。
- **修法方向**（交给 delegator 定）：
  - 让 `remove:` 动作不经过家目录替换；
  - 或者把引号放在 `~/` 之后：`rm ~/'Library/…'`；
  - 并补一个 CLI 层的测试：从 `main("doctor")` 的输出里取出 `rm` 行，在 sh 里真的执行一次。
- 已登记为 [D179](../plans/20260912-frontend-backend-sequencing-order.md#d179)，同一项并入 §2.2 的 b80。

### 2.2 b80（C7）：doctor 对孤立的 break 文件拒绝过严

只有 `.lock.mutex.break`（死 pid）、没有 `.lock.mutex` 时，doctor 判 `blocks launches`（`doctorLeftovers.mjs:155`：`if (e.kind === "break") return e.state !== "alive";`）。但 `lockMutex.mjs:102` 的 `enter()` 只在建 mutex 碰到 EEXIST（`:109`）时才看 break 文件（`:117`、`:129`）。mutex 不存在时直接建成，所以获取能成功，真机实测 1 ms 拿到锁。结论：doctor 对孤立的 break 文件拒绝过严（audit b80，Medium，并入 [D179](../plans/20260912-frontend-backend-sequencing-order.md#d179)）。修法：break 文件只在 `.lock.mutex` 也存在时才算阻塞。C7 判为按设计通过，按 b80 过严，不判 FAIL。

### 2.3 其他（不阻塞）

- C2 的拒绝来自 launch 里的 doctor 闸门（`lock held by run … (live)`），没走到 `acquireLock` 的「lock held」分支。
- C6 的 break 过程（`.lock.mutex.break` 的创建和删除，以及新 mutex）快于 poller 的 1 ms 间隔，`poller.log` 只看到 `.lock.mutex` 在 `.lock` 和 R2 出现的同一时刻消失。破锁是从结果推断的：launch 通过，旧 mutex 没了，什么都没留下。
- quit 的 release 在 poller 里能看到墓碑协议：`.lock.61612-….tomb` 出现，和 `.lock` 一起在同一毫秒内消失。墓碑没有留下。
- C8 里 `.clean.2bf2…` 存在时 doctor 仍是 pass，因为 marker 只阻塞 `clean`。这和 doctorLeftovers 的设计一致。

## 3. 没有覆盖的

- **两个进程真并发**：两个 launch 同时争 mutex、两个 clean 同时认领、launch 和 clean 在锁与运行目录之间的空档里竞争（D148-WI-1），都没有真机测。本轮是串行命令加人工造文件，竞争窗口只有单测覆盖。
- **break 文件持有者活着或 unknown（EPERM）、mutex 无法解析或不是普通文件、mutex 持有者 pid 被复用**：都没有造。
- **mutex 等待超时（`lock busy: …`，2000 ms）**：没有触发。
- **clean 在 si.sock 前重查锁（D105-WI-4）时锁指向别的 run**：没有造出来。两次 clean 都走「锁仍是 R」，删了陈旧 si.sock。
- **`--into`、`--via open`**：不在本轮范围内。
- **C1–C3 期间 poller 还没开**：那段时间没有毫秒级旁观，只看了命令前后的快照。
