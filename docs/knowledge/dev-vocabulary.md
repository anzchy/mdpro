# 开发者专业词汇对照（从 mdpro 的 session 记录中整理）

**为什么有这份文档：** 用户想说话、写东西更像一个有 20 年经验的开发者：用业内的专业词，而不是日常的大白话，并在工作中顺带学会。这份表把**你可能会说的大白话**对应到**专业说法**，每个词都附一句 mdpro session 里真实出现过的原句，让你看到它在实际工作里怎么用。

**怎么做出来的（2026-10-16，mdpro-codex-audit，用 `/echo-sleuth:extract`）：**
- 来源：`~/.claude/projects/-Users-jackcheng-Documents-01-Coding-mac-app-mdpro/` 下全部 74 个 session jsonl。只取 assistant 写的文字（共 11 483 段，6.7 MB），不含代码块、工具输出和系统提示。
- 先统计在 3 个以上 session 中出现过的词和词组，再人工挑出资深开发者常用、新手常说不出来的那些。
- 例句后面的 `xxxxxxxx · 日期` 是 session id 的前 8 位和那条消息的日期，可以用 `ls ~/.claude/projects/-Users-jackcheng-Documents-01-Coding-mac-app-mdpro/<id>*.jsonl` 找回原文。
- 「次数」是该词在多少句话里出现过，大致说明它在这个项目里有多常用。
- 有几个词是本项目自己的用法（lane、receipt、ledger、gate 的具体含义），会在说明里注明。

**用法建议：** 每次想写一句话时，先想左列的大白话，再换成中间列的词。不必背全表，先熟悉「一」和「二」，它们是你每天都在说的。

## 零、把你常说的话改得更专业（取自你自己的消息）

| 你原来的说法 | 更专业的说法 | 为什么 |
|---|---|---|
| merge 回 master 吗？ | Does it **land** on master by fast-forward? | 这里从不产生 merge commit；"land" 说的是结果，"fast-forward" 说的是方式 |
| commit related changes | Commit the related changes as **atomic commits** | 说清楚"每个提交只做一件事" |
| double-clicked already, no window is opened | **Repro:** double-click the file → no window opens. | 先写重现步骤，再写结果，对方马上能复查 |
| check 一下这个 | **Verify** / **sanity-check** / **double-check** this | verify 是正式核对；sanity-check 是快速看有没有明显问题 |
| 汇报下进度 | Give me a **status update** / **Where do things stand?** | 业内最常见的问法 |
| 这个交给 X 处理 | **Assign** this to X / X **owns** this | owns 表示后续都由 X 负责 |
| skip Windows 上的 v0.3.4 device test | **Waive** / **descope** the Windows device check for v0.3.4 | waive 是"这次豁免"；descope 是"移出本次范围" |
| v0.3.5 release as soon as all device tests pass | **Ship** v0.3.5 once the device **gate** is green | ship = 发布给用户；gate = 必须通过的关 |
| 是否到了可 implement 的状态 | Is it **ready to build** / **implementation-ready**? | 评审计划时的标准说法 |
| try reach them again | **Retry** the connection / re-check **reachability** | 远程连接的标准说法 |
| do it for me | Can you **take** this one? | 礼貌地把事情交给对方 |
| 等它完成后再说 | **Hold** until X lands / X is **blocked on** Y | 说明是在等哪个前置条件 |
| 这个问题以后再说 | **Park** it / **Defer** it to v0.3.7 / file a **follow-up** | park 是暂放；defer 要说推到哪里；follow-up 要记录下来 |
| 这个不是 bug，是故意的 | **Working as intended** / it's a **known limit** | 前者说行为正确；后者说明知有限制、暂不修 |
| 再看一遍有没有问题 | Do a second **pass** / a final **review** | pass = 完整过一遍 |

## 一、Git 与分支

| 你会说的 | 专业说法 | 意思和区别 | 例句（session · 日期） | 次数 |
|---|---|---|---|---|
| 合并进 master / merge 回 master | **land (on master)** | 把一个分支的工作正式并入主干。land 强调"落地生效"，不在乎用的是 merge 还是 fast-forward | "This was the first full landing under the new model: branch cut from master, rebased, verified, ff-only, pushed at once." `2cf73399 · 2026-10-12` | 565 |
| 直接把 master 往前挪 | **fast-forward** | 目标分支没有新提交时，直接把指针移到新提交上，不产生 merge commit | "The delegator will back up all five, restore the two changed files with your OK, fast-forward, then copy all five back." `64895729 · 2026-10-15` | 139 |
| 把我的提交挪到最新 master 上面 | **rebase onto** | 把一串提交在新的基点上重放一遍，历史保持一条直线 | "Its subagent is mid-work with nothing committed, so I'll rebase onto the delegator's next docs commit once it finishes." `4a18a219 · 2026-10-12` | 234 |
| 另开一个文件夹干活 | **worktree** | 同一个仓库的第二个工作目录，各自检出不同分支，互不干扰 | "Removing its worktree and local branch needs your confirmation; the delegator will ask you together with other cleanup." `4a18a219 · 2026-10-14` | 634 |
| 改动记录 / 那次提交的编号 | **SHA / commit** | 提交的哈希值；专业交流里直接报 SHA 前 7–8 位 | "It has the lock for the full unit lane now, and the auditor is confirming the four findings on that SHA in parallel." `71891825 · 2026-10-12` | 249 |
| 最新的那个提交 | **HEAD / tip** | 分支当前指向的提交 | "It will run the full unit lane and both Rust lanes once on the tip, since the code trees differ from every earlier run." `d4e11964 · 2026-10-11` | 79 |
| 基于哪个版本 | **parent / base** | parent 是上一个提交；base 是分支开出来的那个点 | "Checking its parent, scope and receipts, and whether it already has a PR." `0c7b6123 · 2026-10-14` | 82 |
| 只挑一个提交拿过来 | **cherry-pick** | 把某个提交单独复制到另一个分支 | "The 19th, the menu-plan review branch, was cherry-picked rather than merged, so I removed its worktree but kept the branch." `0c7b6123 · 2026-10-15` | 5 |
| 改上一个提交 | **amend** | 修改最近一次提交（内容或信息），会改变它的 SHA | "I sent WI-5 back to a3 to amend the commit: rewrite that row as fixed, device check pending." `0c7b6123 · 2026-10-14` | 57 |
| 先把改动收起来 | **stash** | 临时保存未提交的改动，工作区变干净 | "I've asked the delegator to check with you (stash and re-apply, or commit yours first) and not to discard your changes." `4b20fcb5 · 2026-10-13` | 56 |
| 撤回那个提交 | **revert** | 新增一个"反向"提交来抵消旧提交，不改历史 | "A risk to know when deciding: the dialog puts initial focus inside itself, so Esc may close it even on the "reverted" build." `4cee58f4 · 2026-10-14` | 56 |
| 强推 | **force-push / force-with-lease** | 覆盖远端历史；with-lease 只在远端还是你以为的那个提交时才覆盖 | "Its branch then needs a rebase, which I'll push under a new branch name rather than force-push." `0c7b6123 · 2026-10-14` | 19 |
| 把几个提交合成一个 | **squash** | 合并多个提交为一个 | "The verdict is tied to these, so it carries over when mdpro-a3 squashes the commits, as long as they don't change." `4b20fcb5 · 2026-10-12` | 23 |
| 没提交的改动 | **uncommitted / dirty working tree** | 工作区有未提交改动 | "Nothing needed stopping: my queue was already empty, no step or subagent was running, and nothing was left uncommitted." `df8d8546 · 2026-10-14` | 236 |
| 只改了一个文件 | **scope (of the diff)** | 这次改动覆盖的范围；"scope is clean" = 没碰不该碰的文件 | "I also fixed the index's "(see Out of scope)", which named a section that doesn't exist; it now says "(see Constraints)"." `5a793394 · 2026-09-11` | 23 |
| 两个版本内容完全一样 | **tree identity / byte-identical** | 两个提交的文件树哈希相同，所以不必重跑测试 | "All the receipt's test files and the routing file are byte-identical to when the receipt was settled, so it still holds." `4a18a219 · 2026-10-11` | 96 |
| 冲突了 | **conflict / conflicted** | 两边改了同一处，git 无法自动合并 | "The conflict listing failed with a stray "'rtk' is not a git command" error, so I'm checking the rebase state directly." `d4e11964 · 2026-10-11` | 204 |
| 主分支 | **trunk** | 唯一的集成主干（这里就是 master） | "Branch consolidation is implemented. master is the single trunk, every session is on the new baseline, and work is unfrozen." `2cf73399 · 2026-10-12` | 6 |
| 版本号加一 | **bump (the version)** | 提升版本号 | "It isn't landed yet; once it lands, the delegator commits the version bump and locks the release-candidate commit." `4a18a219 · 2026-10-11` | 88 |
| 锁定某个版本 | **pin** | 把依赖或配置固定在某个确切版本 | "I didn't use the shared helper the audit preferred, because already-recorded tests pin the real Save As steps in place." `4a18a219 · 2026-10-13` | 158 |
| 补丁 | **patch** | 一份改动；也指对第三方依赖打的本地修改 | "I'll collect the facts the handoff must contain, each from a command, and save the uncommitted state as a patch next to it:" `4cee58f4 · 2026-10-13` | 204 |
| 依赖锁定文件 | **lockfile** | 记录每个依赖的确切版本，保证每台机器装的一样 | "I installed the dependencies from the lockfile without changing it, and both lanes are running again in the background." `536813b7 · 2026-10-10` | 16 |
| PR 合进去之前要过的检查 | **gate / landing condition** | 必须全部通过才能合入的条件 | "Commit gate is running in the background: the full unit lane with coverage, then typecheck and build, then the slow lane." `a82d81e2 · 2026-10-10` | 460 |
| 交给别人接着做 | **hand off / handoff** | 把工作连同上下文移交给下一个负责人 | "Corrected in the handoff: the Settings search box I first measured doesn't exist in the app; its CSS is never rendered." `348d8ac2 · 2026-10-15` | 628 |

## 二、协作与沟通

| 你会说的 | 专业说法 | 意思和区别 | 例句（session · 日期） | 次数 |
|---|---|---|---|---|
| 发消息转告 | **relay** | 把别人的话原样转给第三方 | "Your two answers, as the delegator relayed them: - dtrack restart: you'll restart dtrack's Claude process yourself." `4cee58f4 · 2026-10-12` | 102 |
| 把任务派出去 | **dispatch** | 把一项工作派给某个 agent / 进程去执行 | "With a native alert key, no webview is focused — so a dispatched menu event is dropped in JS and invisible in Rust." `f1c497df · 2026-09-23` | 109 |
| 先等着别动 | **hold / on hold / held behind** | 暂停某件事，等前置条件满足 | "WI-2.2 is done and held behind WI-2.1." `0c7b6123 · 2026-10-14` | 244 |
| 放一边以后再做 | **park / defer** | 暂时搁置，不放弃 | "It's first among the deferred SHOULD items, because every time it fails CI it costs a rerun before a landing." `0c7b6123 · 2026-10-14` | 87 |
| 在排队 | **queued (behind)** | 排在另一件事后面 | "It is not committed or handed off yet: the one full run is still queued behind another session's job on the heavy lock." `4a18a219 · 2026-10-14` | 139 |
| 卡住了，没法继续 | **blocked (on) / blocker** | 被另一件事阻挡；blocker 是必须先解决的问题 | "⌘⇧N gives a second window and ⌘N a new untitled doc — both reachable by keyboard, so the menu-bar blocker won't bite." `2909df5a · 2026-09-23` | 128 |
| 解除卡点 | **unblock** | 让被阻挡的工作可以继续 | "Fixing the proxy or switching it to another node would unblock CI, landings and pushes." `0c7b6123 · 2026-10-14` | 16 |
| 提出来让大家注意 | **flag / raise / surface** | 把问题提出来给决策者看 | "I'm leaving this untested on purpose; that code exists only so the type-checker flags a result kind we forgot to handle." `f1c497df · 2026-09-22` | 243 |
| 决定了 | **rule / ruling** | 负责人对一个争议点做出裁定 | "I've ruled that they still count for this sitting, so you can carry on without a USB keyboard." `046b7b59 · 2026-10-16` | 748 |
| 同意 / 可以做 | **go-ahead / sign-off / approval** | 正式许可开始或结束一件事 | "From now on I'll also wait for its go-ahead, and when you authorize something here I'll say so when I report back." `e0c08544 · 2026-09-22` | 75 |
| 谁负责 | **owner / owns** | 对某项工作或文件负责的人 | "Until then I'm limited to working-tree edits of my own files, none of them in the table-parser area that session owns." `3239cbc0 · 2026-09-30` | 106 |
| 抢占 / 我来做 | **claim** | 声明某块区域或任务由自己负责 | "Before taking that to the delegator I'll check its two claims about the library code myself, then run the failing files." `f077a6d0 · 2026-10-10` | 299 |
| 说明一下进度 | **status / where things stand** | 当前状态的简短汇报 | "I'm checking it myself: re-running the new tests, confirming the removed statics are gone, and looking at the file status." `34252a0d · 2026-09-27` | 283 |
| 顺便提醒你 | **heads-up** | 预先告知可能的影响 | "Heads-up for landing: this commit changes .claude/settings.json, and your main checkout has your own uncommitted edits to it." `4b20fcb5 · 2026-10-13` | 2 |
| 提个醒，有个前提 | **caveat** | 结论成立的附加条件或限制 | "Two caveats I told the delegator about: - The test receipt holds, but its failing run was logged without counts, so it's weaker evidence." `4a18a219 · 2026-10-11` | 24 |
| 跟进的事 | **follow-up** | 这次不做、但要接着做的事 | "A follow-up could have the window confirm the create, or have the route return the error when the chosen window is gone." `2111e493 · 2026-10-14` | 157 |
| 后面再处理的清单 | **backlog / queue** | 待办队列 | "Nothing needed stopping: my queue was already empty, no step or subagent was running, and nothing was left uncommitted." `df8d8546 · 2026-10-14` | 173 |
| 轮到它了 | **turn / precedence** | 执行顺序上的优先权 | "Your decision takes precedence, and the matrix follows it." `2275500d · 2026-10-08` | 3 |
| 先例 | **precedent** | 以前同类情况怎么处理的 | "I've asked the delegator to choose between patch and upgrade, and whether the patch needs its own ADR or the table-patch precedent is enough." `4a18a219 · 2026-10-13` | 5 |
| 交接文档 | **handoff (file)** | 换人时写下的状态说明 | "Corrected in the handoff: the Settings search box I first measured doesn't exist in the app; its CSS is never rendered." `348d8ac2 · 2026-10-15` | 165 |
| 一批一批做 | **batch** | 把一组同类事情一起处理 | "Removing them needs your confirmation, so I'll add them to the delegator's next cleanup batch in my next message to it." `df8d8546 · 2026-10-14` | 337 |
| 退役 / 不用了 | **retire** | 正式停用一个 session、功能或方案 | "Next I'll rebuild and check the ledger, and look for any remaining references to the retired patch." `4a18a219 · 2026-10-14` | 20 |
| 被新方案取代 | **superseded (by)** | 旧决定被新决定替换，但旧的保留作记录 | "It is now marked as superseded by this step. - The feature ledger's own check still passes with no findings." `34252a0d · 2026-09-26` | 34 |

## 三、质量、审查与缺陷

| 你会说的 | 专业说法 | 意思和区别 | 例句（session · 日期） | 次数 |
|---|---|---|---|---|
| 找问题的审查 | **audit / review** | audit 偏系统性核查，review 偏阅读意见 | "I didn't use the shared helper the audit preferred, because already-recorded tests pin the real Save As steps in place." `4a18a219 · 2026-10-13` | 1394 |
| 发现的问题 | **finding** | 审查得出的一条具体问题 | "When it finishes I'll check the findings against the code, report them to mdpro-delegator, and give you a short summary." `fa0caf81 · 2026-10-10` | 742 |
| 问题严重程度 | **severity (Critical / High / Medium / Low)** | 问题的等级，决定是否阻挡合入 | "Final spot-check of the highest-severity plan P findings and plan M's own line-number citations before I write the report." `4ff686e5 · 2026-09-13` | 74 |
| 调低严重等级 | **downgrade** | 把 High 改成 Medium 等；要附反证 | "The auditor downgraded three of Codex's High findings to Medium after reading the code, and none were registered as D items." `4a18a219 · 2026-10-11` | 76 |
| 反驳的证据 | **counter-proof** | 证明某条问题在正常路径上不会发生的证据 | "Whenever the auditor downgrades a Critical or High finding, it must now attach a reproduction or a counter-proof." `fc72c634 · 2026-10-16` | 2 |
| 把问题再现出来 | **reproduce / repro** | 按步骤让 bug 再次出现 | "I'll first try to reproduce it the way you'd actually merge cells: the table right-click menu and the MCP table command." `df8d8546 · 2026-10-12` | 164 |
| 根本原因 | **root cause** | 导致问题的最底层原因，而不是表面症状 | "The root cause was plugin order: the table library handles every paste over a cell selection before mdpro's own check could run." `d4e11964 · 2026-10-11` | 20 |
| 以前好的，现在坏了 | **regression** | 原来正常的功能被新改动弄坏 | "When the build is green, I'll take its macOS artifact to the Mac mini for the release-candidate device regression." `0c7b6123 · 2026-10-14` | 121 |
| 回归测试 | **regression test** | 专门防止某个 bug 复发的测试 | "All three would go through tdd-guardian, with the diagnostic tests reworked into the regression tests first." `f1c497df · 2026-09-22` | 53 |
| 不稳定、时好时坏的测试 | **flaky / intermittent** | 同样代码有时过有时不过 | "The earlier failure was probably one of the flakes both sessions have reported, or the other session in the middle of an edit." `89b5e352 · 2026-09-23` | 102 |
| 边界情况 | **edge case / boundary** | 极端输入：空、最大、并发等 | "The plan covers where to fan the event out to each spelling, edge cases, tests, and any question that needs a ruling." `4a18a219 · 2026-10-14` | 18 |
| 两个操作抢先后 | **race (condition)** | 结果取决于两件事谁先发生 | "I've fixed the race the audit flagged as High, so an outside change during a save or reload is no longer treated as saved." `c731c9b5 · 2026-10-16` | 91 |
| 悄悄失败 | **silent failure / swallowed error** | 出错了但没人知道 | "The bad case is when nothing else touches that file and you then press ⌘S: the save silently overwrites the missed edit." `4a18a219 · 2026-10-11` | 104 |
| 出错时宁可拒绝 | **fail closed** | 不确定时选择最安全的结果（拒绝、不发送） | "Back then the problem was that a corrupt config switches off all file logging, and you chose option C: - Logging stays fail-closed." `3cce7367 · 2026-10-07` | 11 |
| 出错时照常放行 | **fail open** | 不确定时放行；通常是缺陷 | "On the fail-open focus check, I'm keeping today's behaviour and making failures visible in the log." `34252a0d · 2026-09-25` | 8 |
| 最后一道保险 | **backstop / safety net** | 前面都漏了时兜底的机制 | "Autosave and the save-on-quit backstop only write drafts, and MCP edits change the editor's text without saving the file." `4b20fcb5 · 2026-10-12` | 18 |
| 抽查 | **spot-check** | 不全查，挑几处核对 | "Before accepting it I'll spot-check one heavy row with the new binary myself and re-verify the lock diff independently." `6148f53d · 2026-09-13` | 55 |
| 简单冒烟检查 | **smoke test / smoke check** | 最基本"能不能跑起来"的检查 | "Then I'll rebase it onto the latest master, run the smoke test again on that commit, and hand it to the delegator for merging." `4cee58f4 · 2026-10-14` | 24 |
| 走到了那段代码 | **exercise / reach (the code path)** | 测试真正执行到了要测的代码 | "I read both machines' logs and write the verdict: pass, fail, or "not exercised" if the queued events never replayed." `4cee58f4 · 2026-10-13` | 33 |
| 代码执行的路线 | **code path** | 一次操作在代码里实际走过的路线 | "Three things are still open: - ⌘K over Recovery didn't reach its code path, because the editor had no keyboard focus." `fc72c634 · 2026-10-15` | 17 |
| 已知问题，接受它 | **known limit / accepted cost** | 明知存在、决定暂不修的限制 | "Things to know: - Known limit: if WYSIWYG rewrites a file's formatting when opening it, undoing can still show unsaved." `c731c9b5 · 2026-10-16` | 32 |
| 假的通过 | **vacuous pass / false positive** | 测试过了但其实什么都没验证 | "These are false positives too: an escaped backtick throws off my checker, and the same pattern was already in the plan." `c5f1d832 · 2026-10-16` | 13 |
| 证明某事的证据 | **evidence / receipt** | 可复查的记录（日志行、截图、测试结果） | "The evidence fits this: - The editor's change event never fired while the tester typed. - Only a lone space got through." `f1c497df · 2026-09-22` | 150 |
| 副作用 | **side effect** | 一个操作顺带造成的其它变化 | "I'm now checking a side effect: what happens to the local copies in other checkouts when they fast-forward onto the untracking commit." `64895729 · 2026-10-14` | 16 |
| 不变量 | **invariant** | 任何时候都必须成立的条件 | "The red is right: every pin fails, and only the token-level contrast invariants pass." `098d2f57 · 2026-10-16` | 6 |
| 不确定的结果 | **non-deterministic** | 同样输入结果不一样 | "If that can't be made deterministic, the subagent will stop and report rather than write a test that always passes." `ec3e4217 · 2026-09-28` | 11 |

## 四、测试

| 你会说的 | 专业说法 | 意思和区别 | 例句（session · 日期） | 次数 |
|---|---|---|---|---|
| 测试先失败再通过 | **red → green** | TDD：先写会失败的测试，再写代码让它通过 | "Next come the test matrix, then the red → green work items, then review, and then I'll ask you before committing." `34252a0d · 2026-09-26` | 25 |
| 测试流水线的一条 | **lane** | 一组固定的检查命令（unit、rust、typecheck…） | "That move only changed docs and rules, so the lane results still apply. - Review: approved with notes, nothing High." `536813b7 · 2026-10-10` | 640 |
| 全部测试 | **full suite** | 整套测试一起跑 | "Checked: I ran the full suite with coverage twice, calling the binaries directly so I saw the real exit codes." `3239cbc0 · 2026-09-30` | 64 |
| 测试用的样例文件 | **fixture** | 测试用的固定输入数据 | "Next I'm opening the second fixture, which should route to a second window, and listing documents through the sidecar." `3239cbc0 · 2026-09-30` | 132 |
| 测试框架 / 驱动工具 | **harness** | 运行测试、驱动应用的那套工具 | "Variants render; fixing two harness bugs (baseline's selected row and the switcher label), then zooming in on the icons." `098d2f57 · 2026-10-16` | 49 |
| 假的替身 | **mock / stub** | mock 记录调用并可断言；stub 只返回固定值 | "Before running RED, I'm adding no-op stub modules, so the tests fail on their assertions rather than on missing imports." `348d8ac2 · 2026-10-15` | 77 |
| 测试的判断语句 | **assertion** | 测试里检查"结果应该等于什么"的那句 | "Confirmed: the harness assertion fails even when no launcher code runs, and the spread form still catches a real change." `2275500d · 2026-10-08` | 209 |
| 覆盖率 | **coverage** | 测试执行到了多少代码 | "It is the coverage probe I recorded before starting; other plan files in that folder are gitignored, but this one isn't." `5de59c4c · 2026-10-08` | 316 |
| 变异测试 | **mutation testing** | 故意改坏代码，看测试能否发现 | "Mutation testing is off in this project's config, so it didn't run. - Final review: approved with notes after the earlier fixes." `5de59c4c · 2026-10-07` | 17 |
| 找漏洞式地审测试 | **adversarial review** | 假设自己是写错实现的人，看测试能不能抓到 | "The adversary agent is now looking for a wrong implementation that would still pass every case, running in the background." `536813b7 · 2026-10-10` | 117 |
| 基准 | **baseline** | 对比用的起点数据 | "Variants render; fixing two harness bugs (baseline's selected row and the switcher label), then zooming in on the icons." `098d2f57 · 2026-10-16` | 140 |
| 演练一遍 | **rehearsal / dry run** | 正式执行前不产生后果的试跑 | "After that I'll run the build-only release rehearsal and send the Mac mini check and the Windows check on its artifacts." `0c7b6123 · 2026-10-14` | 36 |
| 金丝雀检查 | **canary** | 先在小范围试，确认没问题再全面推 | "M2 stays prep-only for now, because the Mac mini's test session is busy with the canary check." `d31233f5 · 2026-10-16` | 45 |
| 端到端 | **end-to-end** | 从用户操作一直到最终结果的全流程测试 | "To finish, I'll run one real end-to-end smoke test inside tmux: open the release app, resize it, take a window-only screenshot and check its size." `f077a6d0 · 2026-10-04` | 6 |
| 无界面运行 | **headless** | 不开窗口、在后台跑浏览器或应用 | "Where I'm stuck: before changing anything I need to confirm that headless Chromium reports focus as well." `f077a6d0 · 2026-10-07` | 10 |
| 冷启动 | **cold launch / cold start** | 应用完全关闭后第一次启动 | "Cold launch still switches first, because there's no open document yet to protect." `f077a6d0 · 2026-10-09` | 21 |
| 快照 | **snapshot** | 某一时刻状态的完整副本，用于之后恢复或对比 | "The refusal happens before anything is written. - The snapshot diff showed changes, but none came from your double-click." `5de59c4c · 2026-10-07` | 101 |
| 记录 / 凭证 | **receipt** | tdd-guardian 记下的"这个测试先红后绿"的证明 | "All the receipt's test files and the routing file are byte-identical to when the receipt was settled, so it still holds." `4a18a219 · 2026-10-11` | 1040 |

## 五、工程概念

| 你会说的 | 专业说法 | 意思和区别 | 例句（session · 日期） | 次数 |
|---|---|---|---|---|
| 保存在硬盘上的那份 | **baseline / on disk** | 磁盘上的版本，作为"干净"的对照 | "So a save or reload reply that arrives late can still mark the document as matching the file on disk when it doesn't." `84b9f940 · 2026-10-16` | 57 |
| 完全一样 | **byte-exact / byte-for-byte** | 每个字节都相同 | "That line is not an assertion, and the file is back byte-for-byte as recorded, but the verdict can't be reset." `34252a0d · 2026-09-24` | 19 |
| 来回一趟 | **round trip** | 读出再写回（或请求再响应）一次 | "That covers the serialisation cases, not the round-trip ones, and I said so rather than agreeing and quietly failing." `f1c497df · 2026-09-23` | 37 |
| 正在进行中的 | **in flight** | 已发出、还没返回的请求或操作 | "While dtrack runs, no handoff is in flight, so I'll commit the Mac shortcut record and the gate's re-lock note." `0c7b6123 · 2026-10-14` | 63 |
| 稍后才完成 | **settle** | 异步操作最终完成（成功或失败） | "All the receipt's test files and the routing file are byte-identical to when the receipt was settled, so it still holds." `4a18a219 · 2026-10-11` | 119 |
| 把缓存写出去 | **flush** | 把暂存的数据立刻写出 | "After a save returns, the fix first flushes pending WYSIWYG edits, then re-reads the document." `f1c497df · 2026-09-22` | 59 |
| 防抖 | **debounce** | 一连串事件只在停下来后处理一次 | "The likely fix is that when one kind of notice fires, it clears the other kinds' debounce entries for that path." `c5f1d832 · 2026-10-15` | 24 |
| 触发 | **fire / emit** | 事件被发出 | "The auditor also confirmed the platform simulation is live and that Ctrl+Alt+T without AltGraph correctly still fires." `71891825 · 2026-10-13` | 91 |
| 覆盖掉 | **overwrite / clobber** | 新内容替换旧内容；clobber 带"意外弄丢"的意味 | "The bad case is when nothing else touches that file and you then press ⌘S: the save silently overwrites the missed edit." `4a18a219 · 2026-10-11` | 102 |
| 卡死 | **hang / stall / wedged** | 程序不动了，也不报错 | "The fix is to let Node's event loop finish closing the sockets by itself, with a bounded fallback exit for a socket that hangs." `fc72c634 · 2026-10-16` | 56 |
| 死锁 | **deadlock** | 两边互相等对方，永远不动 | "No path takes the config lock and then the cell lock, so cell → config can't deadlock." `64895729 · 2026-10-14` | 6 |
| 内存泄漏 | **leak** | 资源用完没释放 | "When it arrives, I'll check the results against the saved evidence and confirm no nonce leaked before I pass them on." `2275500d · 2026-10-09` | 21 |
| 没人管的残留 | **orphan / leftover** | 原主已不在的文件、进程或数据 | "Earlier work items left oversized test files in place and recorded them as leftovers, so I'm doing the same here." `34252a0d · 2026-09-26` | 94 |
| 多次执行结果一样 | **idempotent** | 重复调用不会产生额外效果 | "Idempotent. Cleaning a run that's already gone reports absent and exits 0." `2275500d · 2026-10-08` | 2 |
| 要么全成功要么全不做 | **atomic** | 操作不可分割 | "The bug: when an outside editor saves a file atomically, the watcher gets a rapid burst of events: create, remove, rename." `4a18a219 · 2026-10-11` | 19 |
| 原样转成字节存储 | **serialize** | 把对象变成可传输或存储的格式 | "The test showed that Milkdown's serializer already widens ragged tables on its own, which changes the cost analysis in the draft." `f077a6d0 · 2026-10-09` | 19 |
| 统一格式 | **normalise** | 把不同写法变成同一种标准形式 | "The one known limit: two spellings that differ only in Unicode normalisation are still treated as different files." `4a18a219 · 2026-10-14` | 13 |
| 过滤危险内容 | **sanitize** | 去掉可能有害的输入或输出 | "The export template has zero JS and the Rust sanitizer is the final boundary, so DOM clobbering has no victim." `4ff686e5 · 2026-09-14` | 12 |
| 白名单 | **allowlist** | 只允许列出的项通过 | "Next come the failing tests for the read-only allowlist, and then it stops for me to record the receipt." `df8d8546 · 2026-10-12` | 16 |
| 来源说明 | **provenance** | 一份数据从哪里来、是否可信 | "I'll reword the report, add an explicit provenance line to the patch, and confirm the patch stays unapplied." `6148f53d · 2026-09-13` | 5 |
| 一次性随机数 | **nonce** | 只用一次的随机值，防止重放 | "When it arrives, I'll check the results against the saved evidence and confirm no nonce leaked before I pass them on." `2275500d · 2026-10-09` | 13 |
| 指纹 / 校验值 | **fingerprint / checksum** | 内容的哈希，用来判断是否变化 | "The gap: our own ⌘S stays quiet only if, after saving, the watcher records a fingerprint (hash) of the bytes it wrote." `536813b7 · 2026-10-10` | 51 |
| 两边不一致了 | **drift / diverge** | 本应一致的两份东西慢慢不同 | "One tightening — citing a function survives edits better than a line number that has already drifted a few lines:" `f1c497df · 2026-09-23` | 27 |
| 把两边对齐 | **reconcile** | 让两份不一致的数据重新一致 | "The resolution of two disagreeing statements is the commit history, not the most charitable reading that reconciles them." `5a793394 · 2026-09-12` | 5 |
| 接口约定 | **contract** | 双方都要遵守的输入输出约定 | "It also adds a Rust contract check that a decode error carries the file path, which the decode-failure exit depends on." `34252a0d · 2026-09-24` | 44 |
| 代码的拼接处 | **seam** | 可以替换或测试的切入点 | "They only held the test seam: a stub that returned paths unchanged, plus a no-behaviour-change extraction." `df8d8546 · 2026-10-14` | 12 |
| 信任边界 | **trust boundary** | 外部输入进入系统的地方，必须校验 | "Trust boundary is right: label from window.label(), ids validated all-or-nothing before any deletion." `f1c497df · 2026-09-23` | 35 |
| 退路 / 后备方案 | **fallback** | 主方案失败时的替代 | "The fallback alert needs no document list, no save path, no editor integration — just one app-modal two-button decision." `f1c497df · 2026-09-23` | 53 |
| 紧急出口 | **escape hatch** | 正常规则之外，留给特殊情况的出口 | "The planner is now working in the background, breaking the escape hatch into work items and deciding how the item should behave in each quit phase." `34252a0d · 2026-09-25` | 10 |
| 承重的 | **load-bearing** | 看着不起眼，但删了就会出问题的部分 | "Before I write it into a permanent doc, let me verify the load-bearing claims, including the ones it makes about our code." `f1c497df · 2026-09-23` | 15 |
| 什么都不做 | **no-op** | 执行了但没有效果的操作 | "Before running RED, I'm adding no-op stub modules, so the tests fail on their assertions rather than on missing imports." `348d8ac2 · 2026-10-15` | 5 |
| 依赖的上游 | **upstream / downstream** | 上游是你依赖的；下游是依赖你的 | "The download was denied, so I'll read the upstream change through a page fetch instead, and finish reading the installed scan loop." `6148f53d · 2026-09-16` | 48 |
| 不保证，尽量做 | **best-effort** | 尽力而为，失败不报错 | "That's the trade-off the project accepted for best-effort platforms (a needless prompt rather than a missed change), but users should be told." `4b20fcb5 · 2026-10-11` | 2 |
| 一次性丢掉的 | **throwaway** | 做完验证就扔的代码或分支 | "I'll run the table on the pristine build first, then add a temporary diagnostic in the throwaway worktree to settle it properly." `2909df5a · 2026-09-23` | 44 |
| 先试做一个 | **spike / prototype** | 为了回答一个问题而做的试验性实现 | "First I'm checking which spike commit the existing mini build came from, and whether its app code matches the spike head." `046b7b59 · 2026-10-16` | 251 |
| 试点 | **pilot / trial** | 小范围先跑一次看效果 | "It records your repo-settings decision for after a successful pilot: keep only rebase-merge and require linear history." `4b20fcb5 · 2026-10-13` | 86 |
| 迁移 | **migrate / migration** | 从旧格式或旧系统换到新的 | "Either way, paths that earlier Windows installs already saved with the prefix (recent files, window states, drafts) aren't migrated." `df8d8546 · 2026-10-13` | 40 |
| 回滚 | **rollback / roll back** | 退回到之前的状态 | "For the second gap, the expected behaviour is that the pending value is rolled back, so the "Not saved" note disappears." `34252a0d · 2026-09-26` | 20 |
| 冻结 | **freeze** | 某段时间内不再接受改动 | "Where Codex is right and I was incomplete: A alone does not close the hole — a renderer can ack the prompt and then freeze." `f1c497df · 2026-09-23` | 48 |
| 把旧数据补上 | **backfill** | 对已有的旧数据补做新规则 | "I'll commit the rule and the log first, then dispatch the recall subagent to backfill every past session." `0c7b6123 · 2026-10-14` | 16 |
| 预算 / 上限 | **budget / ceiling / cap** | 资源或时间的允许上限 | "When it starts you'll decide the patch budget, the UI delegate question and the one-time network download." `4cee58f4 · 2026-10-15` | 37 |
| 怪毛病 | **quirk / pitfall** | 平台的特殊行为；容易踩的坑 | "Before running anything, I'm reading the new driver reference: ops.md, the pitfalls entries, and config-isolation.md." `84b9f940 · 2026-10-15` | 17 |
| 遮住了 | **mask / shadow** | 一个东西挡住另一个，导致看不见或不生效 | "Separately, the rtk hook in your global Claude settings rewrites cargo test output into a one-line summary, which can mask real results." `6148f53d · 2026-09-13` | 7 |
| 把一个并到另一个里 | **fold into** | 合并进已有的东西 | "A definition that's never used is lost outright; a used one is probably folded into the link, which changes the text without losing the URL." `4a18a219 · 2026-10-13` | 6 |
| 不再需要讨论 | **moot** | 已经无关紧要 | "Also existing, and not D188's. - The link-definition ruling is mostly moot. Milkdown removes definitions before the empty-line reader ever runs, so it never sees them as blocks." `4a18a219 · 2026-10-13` | 1 |
| 排除了 | **rule out** | 确认某个可能性不成立 | "After implementing it, one reproduction on your machine should confirm or rule out that guess before we choose a fix." `34252a0d · 2026-09-26` | 18 |
| 同步 / 拦截的保护 | **guard** | 阻止错误情况发生的检查 | "It goes through the existing window-close guard, so unsaved work is still checked and the window state is still saved." `c731c9b5 · 2026-10-16` | 360 |
| 锁住防止同时运行 | **lock / mutex** | 保证同一时间只有一个执行者 | "When the extended tests are ready I'll ask it for a heavy-lock turn to record the three receipts, each one a full unit run." `4cee58f4 · 2026-10-12` | 48 |

## 六、常用说法与句式

| 你会说的 | 专业说法 | 意思和区别 | 例句（session · 日期） | 次数 |
|---|---|---|---|---|
| 模拟的按键和真键盘一样 | **travels the same path as …** | 两种输入在系统里走完全相同的路线，所以测试结论可信 | "A key injected by remote-desktop software travels the same path into the app as a key from a USB keyboard." `046b7b59 · 2026-10-16` | 0 |
| 这个问题不影响结论 | **doesn't change the verdict** | 某个细节存在，但不改变最终判断 | "I don't have an ADR in progress, so this changes nothing for me; if I ever need one, I'll ask the delegator for a number first." `fa0caf81 · 2026-10-10` | 12 |
| 没真正测到 | **not exercised** | 测试没走到要验证的路径，不能算通过 | "⌘A selected the whole page instead of the editor's text, so focus never reached the editor and the typing went nowhere." `d4e11964 · 2026-10-11` | 37 |
| 顺手改的 | **drive-by (change)** | 不在本次范围内、顺便做的小改动 | "One comes with a cheap hardening I may take in my next watcher commit, disclosed as a drive-by." `4a18a219 · 2026-10-11` | 6 |
| 马上 | **straight away** | 立即 | "The quit writes a draft of that edit, then deletes it straight away, because the document is still on the discard list." `34252a0d · 2026-09-24` | 18 |
| 简单说 | **in short / in practice** | 总结或说实际情况 | "Its effect now runs earlier during startup, which changes nothing in practice. - Inconsistency (low): the same refusal is logged two different ways." `4b20fcb5 · 2026-10-10` | 7 |
| 记录在案 | **for the record** | 明确写下来供以后查 | "One thing to note for the record, not a WI-002 defect: if the preferences file is malformed, it loads defaults for nothing." `5de59c4c · 2026-10-07` | 4 |
| 权衡 | **trade-off** | 得到一样、放弃一样 | "That's the trade-off the project accepted for best-effort platforms (a needless prompt rather than a missed change), but users should be told." `4b20fcb5 · 2026-10-11` | 4 |
| 代价 | **cost** | 一个决定要付出的东西，不只是钱 | "The cost is that Source-mode undo history, cursor position and the open search panel no longer survive a tab switch." `4a18a219 · 2026-10-14` | 28 |
| 结论 | **verdict** | 检查或审查的最终判断（PASS / FAIL / READY） | "No assertion or value changed, and those two lines were put back exactly as recorded, but the verdict can't be cleared." `34252a0d · 2026-09-25` | 188 |
| 决定性的 | **decisive** | 能直接决定结论的那个测试或证据 | "Its verifier is re-running the decisive tests and the build on that commit, and the earlier Codex audit carries over to it." `4cee58f4 · 2026-10-12` | 103 |
| 独立的 | **independent** | 不依赖被检查者自己的说法 | "Before accepting it I'll spot-check one heavy row with the new binary myself and re-verify the lock diff independently." `6148f53d · 2026-09-13` | 104 |
| 照原样 | **verbatim** | 一字不改 | "It holds the question verbatim, my answer condensed to one to four sentences, and a pointer to anything longer." `4a18a219 · 2026-10-14` | 18 |
| 以防万一 | **belt and braces / defence in depth** | 多加一层保护 | "Bound entry.error in the logger, where it protects every error path in the app, with the validate_id cap as defence in depth." `f1c497df · 2026-09-23` | 0 |

## 七、写作习惯（从这些 session 里能看出来的）

- **先结论，后理由。** "PARTIAL, so the gate fails. Two cases remain: …"，而不是先讲过程。
- **说清楚证据。** 用 "I reproduced it", "the log line shows", "I checked it against the code"，不说 "I think it's fine"。
- **区分"做了"和"没做"。** "Verified on device" 和 "not exercised" 是两回事；没测到就直说。
- **带上限定。** "known limit", "caveat", "in practice"，让结论的边界清楚。
- **动词要具体。** land / rebase / spot-check / downgrade / defer，比 do / handle / fix it 更准确。
- **用对方能直接执行的形式。** 给出 SHA、文件:行号、确切命令，而不是"那个提交""那个文件"。
