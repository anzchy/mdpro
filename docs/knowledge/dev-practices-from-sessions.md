# 从 mdpro 最近五天的 session 学到的开发习惯：以 gpt-imple-1 的工作流为例

写于 2026-10-20，接着同目录的 [`dev-practices-matt-pstack.md`](./dev-practices-matt-pstack.md)。那份讲的是业内公认的做法和两套外部方法论；这份讲 **mdpro 自己最近五天真实发生的事**：一项工作怎样从一份 brief 走到 master，中途哪里出了岔子，大家怎么处理。词汇对照见 [`dev-vocabulary.md`](./dev-vocabulary.md)。

每一条照旧回答四个问题：**它说的是什么**（白话）、**在哪里发生的**（可以打开的文件或日志）、**它防止了什么失败**、**资深开发者会怎么说**。

**来源**（全部只读）：
- Codex 实现者 gpt-imple-1 和 gpt-imple-2 的会话。用 `herdr agent list` 找到它们当前的 session id，再按 brief 路径在 `~/.codex/sessions/2026/10/18–20/` 里找到它们 10-18 到 10-20 的 11 个 rollout 文件。
- 它们的 brief、prep、handoff 和 blocker 文件：`~/.mdpro-redesign/herdr-spike/gpt-imple-1/`、`gpt-imple-2/`。adversary 报告：`herdr-spike/delegator/ADR0125-tooling-adversary.md`。
- 真机测试的报告：`~/.mdpro-redesign/device/`（M-4、M-5、W-1a、W-1b、W-3、D294、D297）。
- 规则：`.claude/rules/10-tdd.md`、`70-multi-session-coordination.md`、`71-herdr-mixed-roster.md`。

---

## 一、一项工作从头到尾：gpt-imple-1 的 ADR-0125 工具

**这项工作是什么。** 前端每记一个 RED receipt，都要跑完整个覆盖率 lane：813 个文件、约 12k 个测试，空闲时 154 秒，排在 heavy lock 后面更久。而且这样记下的 RED 是弱证据：verifier 把 M3 和 WI-4.3b 的每个 RED 都标成了 `opaque-failure` / `weak-red`。ADR-0125（用户 2026-10-20 接受：「Accept, fix Mediums first」）决定改成：**一个 RED 只跑一个经过校验的测试文件**，由仓库里的脚本负责，不给插件打补丁。gpt-imple-1 拿到的就是实现这个脚本的 brief。

下表按时间顺序排列，每一步都能在文件里找到。

| # | 阶段 | 实际发生了什么 | 证据 |
|---|---|---|---|
| 0 | **Prep（不占名额）** | 拿到实现授权之前，先做只读调研，写下打算怎么做。另一个实现者 gpt-imple-2 也为同一项写过 prep，brief 让 gpt-imple-1 "合适的地方用它的接口设计" | `gpt-imple-2/ADR0125-prep.md`，`gpt-imple-1/M3-prep.md` |
| 1 | **Brief（六节）** | delegator 写好完整的 brief：背景（为什么做、用户原话、不能违反哪些 ADR）、范围（能新建和能改的路径，以及明确**不授权**的路径）、验收标准 T-1…T-10（每条是"行为 + 证明"）、范围外、gate 命令、自验收表格式 | `gpt-imple-1/ADR0125-tooling-brief.md` |
| 2 | **一项一个 worktree、一个新 pane** | 分支 `chore/adr0125-unit-red-lane`，基于 master `bcfd4415`。Codex 只能写自己启动目录里的文件，所以换一项工作就换一个 pane | brief § 2，rule 71 § Restart |
| 3 | **先写测试矩阵，再记任何 RED** | 规则当天改了（用户：「加上，gpt-imple-1, gpt-imple-2都适用」）。gpt-imple-1 收到修订时正在跑一个 RED receipt，它立刻中断（exit 130），确认隔离的 store 是空的、没有半条记录，然后写矩阵、进入空闲 | 会话 07:37–07:39；`ADR0125-tooling-test-matrix.md` |
| 4 | **对矩阵做对抗审查** | delegator 让 `tdd-spec-adversary`（Opus）攻击这份矩阵：找出**能通过全部用例但仍然是错的实现**。结果是 28 个漏洞，另有 12 个攻击已被现有用例挡住。排名最高的三个被列为本项的 blocker，其中有对 ADR 的收紧（例如 discard 不能用来藏起改过的 spec） | `delegator/ADR0125-tooling-adversary.md`，brief Amendment 2 |
| 5 | **rebase 后核对前提** | brief 说 master 的新提交只改了文档。gpt-imple-1 自己核对：`bcfd4415..26c08ae7` 改了 `src/` 和 `tests/`，**不是**只改文档。所以旧的 gate 结果不能沿用，要在新基点上重跑 | 会话 07:47 |
| 6 | **RED 先于生产代码** | 扩展后的测试文件在本地是红的（16 个失败，因为脚本还不存在）。它在写任何生产代码之前，用现有的 `unit` lane 记下 `ADR0125-WI-1…6` 六个 receipt | 会话 07:51 |
| 7 | **RED 不对劲时先查原因，不盲目重跑** | 第一次 WI-1 被插件判成 `runner-missing`，因为失败输出里带着 Node 的 "Cannot find module"。它的判断是："repeating the same command would only overwrite the invalid attempt"，于是先抓一份完整日志找出触发的文字，再决定下一步。日志显示是 16 个预期的失败加上 12 000 多个通过，末尾的 `todo` 计数让插件的解析器把它判成 `opaque-failure`。这正是 ADR-0125 要解决的问题，它打算在 handoff 里写明这个限制 | 会话 07:56–08:11 |
| 8 | **实现，然后跑 gate** | 迭代时只跑受影响的文件，不加锁，最多 2 个 worker；提交前在 heavy lock 下跑一次完整覆盖率 lane、typecheck + build 和 `ledger:check` | brief § 5，rule 10 |
| 9 | **Handoff 带自验收表** | 每条 AC 对应一行：证据、决定性的那行输出、receipt、结论。再写上 SHA、parent、三棵树的哈希，以及 `git diff-tree --stat`。T-8 还要附上**前后对比的耗时**，用户要拿它决定下一步 | brief § 6；成品样子见 `M3b-handoff.md` |
| 10 | **两份盲审，合并结论** | gpt-auditor（Codex）和 fable-auditor 各自独立审同一个范围，互相看不到。M3b 的第一轮是 C0 H1，两边都提出了 H1 | `M3b-fix1-brief.md` |
| 11 | **修复轮也是 RED 先行** | H1 的修复先记 RED（`M3-WI-15`），再改代码（见第二章 E 条）。之后两位审计员确认修复，verifier 按树哈希复查，delegator 用 `--ff-only` 合入并立即推送 | `M3b-handoff.md` § Fix round 1；rule 70 § Commits |

**这条流程的核心，一句话：** 先把"怎样算做完"写成能检查的东西（brief 的 AC、测试矩阵），再找人攻击它，然后才写代码；每一步的结论都附上别人能复查的证据。

---

## 二、具体做法

### A. 测试矩阵先于 RED，并且请人来攻击它

- **白话：** 写测试之前，先把每条验收标准要测的情况都列出来：成功、边界、非法输入、生命周期和时序、每一个入口路径、平台差异。然后请一个专门挑错的 agent 扮演"写错实现的人"，看有没有一个错的实现能通过全部用例。
- **在哪里：** ADR-0125 工具的矩阵被找出 28 个漏洞，比如 `./tests/a.test.ts` 和 `tests\a.test.ts` 在 receipt 一侧和环境变量一侧被规范化成不同的形式，或者 APFS 上大小写不同的文件名能通过存在性检查。
- **防止什么：** 测试全绿，实现却是错的。只写"正常情况"的测试，等于让实现者自己出题自己答。
- **资深开发者会说：** "Before we write a single red, let's get the matrix attacked. What wrong implementation passes all of this?"

### B. RED 必须是"数得出来的、因为对的理由而失败"

- **白话：** 一个先失败的测试，只有在它是因为**断言**不成立而失败时才算数。因为找不到模块、环境出错、选错了元素而失败，都不是你要的 RED。
- **在哪里：**
  - M3b 修复轮：第一次 GREEN 尝试暴露出测试选择器的问题（弹窗的可访问名称是 `Insert Table ⌘⌥T`，选择器没匹配上）。gpt-imple-1 把生产代码恢复原样、改成 `/Insert Table/`，**重新确认同样的 RED 并重新记录** `M3-WI-15`，然后才把修复放回去。
  - ADR-0125 本身：完整 lane 的输出让插件解析不出计数，RED 被判成 `opaque-failure`。新方案要求 lane 打印标准格式的 `Tests  F failed | P passed (T)`，并且只接受 `assertion-failure` 类型的 RED。
- **防止什么：** "vacuous RED"，看起来先红后绿，其实测试从来没测到那个行为。
- **资深开发者会说：** "That red fails for the wrong reason. Revert the fix, fix the selector, and re-record the red before you put the fix back."

### C. 超出授权范围就停下，并且说清楚需要什么

- **白话：** 做到一半发现要改 brief 没授权的文件时，不要悄悄改，也不要绕过去。停下来，写清楚为什么需要、需要哪几个文件，等新的授权。
- **在哪里：** gpt-imple-2 做 D290 时，发现新对话框要在统一的对话框顺序模型里加第七个位置，而现有的独立 oracle 和测试 harness 都把六个 ID 写死了。它没有动任何文件，写了一份 blocker，列出需要放开的 7 个测试路径，并说明哪 4 个"可能需要、先放开以免再停一次"：`gpt-imple-2/D290-scope-blocker.md`。
- **防止什么：** 范围蔓延（scope creep），以及评审时才发现改了不该改的文件。
- **资深开发者会说：** "This needs paths outside my grant. Here's the list and why; I'll resume at the red once the grant is revised."

### D. brief 的前提可能是错的：先核对，不对就停

- **白话：** 上游给的说法（"master 只加了文档"）也要自己验证，因为后面的捷径是建立在这个前提上的。
- **在哪里：**
  - gpt-imple-1（会话 07:47）：核对后发现基点的变化包含代码，于是放弃沿用旧的 gate 结果，在新基点上重跑。
  - gpt-imple-2（`D290-fix2-rebase-blocker.md`）：rebase 之后 `:src` 和 `:tests` 的树哈希都变了（`git diff --stat` 显示 15 个代码和测试文件、+1330 / −129 行），旧的 lane 证据不再"tree-identical"。它按规则停在这里，列出前后两组哈希，请 delegator 决定是在新基点上重建证据，还是恢复 rebase 前的分支。另外，rebase 在 `receipts.json` 上冲突时，它按 receipt id 合并：保住上游的 421 条，加上本分支的 3 条，共享的记录逐条核对一致。
- **防止什么：** 拿着已经不成立的证据去合入。"树没变所以不用重跑"是项目里很省时间的捷径，但前提必须用哈希证明，不能靠别人的一句话。
- **资深开发者会说：** "The brief's premise doesn't hold: `:src` and `:tests` moved. The old evidence isn't tree-identical, so I've stopped before running anything."

### E. 不要丢掉返回值，让类型替你把关

- **白话：** 一个包装函数调用了下层函数，却把下层的返回值扔掉了，上层就永远不知道下层失败了。
- **在哪里：** M3b 的 H1（两位审计员都提出了）：`editor.paragraph.table` 的包装函数调用 `pending(rows, cols)`，但没有返回它的结果。在已有的表格里插入表格时，`runInsertTable` 返回 `false`，包装函数返回 `undefined`，而 `TableInsertModal` 把"不是 `false`"都当成成功。于是弹窗关闭，记一条成功日志，界面上没有任何失败提示。修复是把结果返回出去，并把签名写成明确的 `boolean | void`，这样以后再丢掉结果，typecheck 能直接报出来（`M3b-fix1-brief.md` F1-3）。
- **防止什么：** 静默失败（silent failure）：操作没成功，用户和日志却都以为成功了。
- **资深开发者会说：** "The adapter swallows the callback's `false`. Return it, and make the contract explicit in the type so a dropped result fails typecheck."

### F. 证据要走对路线：同一条路线上要有一个通过的对照

- **白话：** 用工具模拟输入得出的结论，只对那条输入路线成立。判"不通过"之前，要在同一条路线、同一次运行里，找一个**应该通过而且确实通过**的对照，证明是功能坏了，而不是工具坏了。
- **在哪里（真机测试）：**
  - W-1a：真实按键 Ctrl+Shift+L 到不了页面，侧栏不切换。同一条路线上，真实的 Ctrl+Shift+H 和 Ctrl+Shift+N 都能用，从页面路线发送的 Ctrl+Shift+L 也能切换侧栏，所以这个 FAIL 才成立。
  - W-1b：测试工具 `ui.sh chord` 发送按键时扫描码是 0，页面看到的 `event.code` 是空的，而快捷键匹配器的"物理键"那一步正是看 `event.code` 的。如果直接用这个工具测，结论会是错的。于是改用一个带扫描码的临时脚本，页面才看到真实的 `Digit7` / `KeyQ` / `AltRight`。
  - "没测到"要直说：W-1b 里，Settings 录制器存的是逻辑键 `Cmd+Shift+/`，所以真正走到的是"逻辑匹配"那一步，"物理键匹配"那一步记为 **not exercised**，不算通过。
- **防止什么：** 把工具的局限当成产品的 bug（假阴性），或者把没走到的代码当成测过了（假阳性）。
- **资深开发者会说：** "I need a passing control on the same route before I'll call this a fail." / "The harness sends scan code 0, so `event.code` is empty; that route can't exercise the physical-key pass."

### G. 一个 bug 在每个平台上都要复查，结论也要分平台写

- **白话：** 在一个平台上发现的问题，到另一个平台上用同样的步骤再走一遍，结论分开写。
- **在哪里：**
  - D297：新窗口（⌘⇧N / Ctrl+Shift+N）里没有标签页，却有一个能输入的编辑器。在里面打的字，关窗口时不提示就丢了。Windows 上先发现，Mac 上复现 2/2，日志都是 `window.close_requested {"action":"no_unsaved_closing"}`。原因也一致：编辑器挂载时 `documentId:null`，输入不产生任何 tab / editor / draft 事件，窗口永远不会变"脏"。差别是 Mac 上必须先点一下窗口才能输入。
  - D296：Keyboard Shortcuts 里缺少 Window 分组，只在 Mac 上出现；Windows 上能看到 Minimize Ctrl+M 和 Close Window Alt+F4。
- **防止什么：** 一个平台修好了就以为都好了；或者反过来，一个平台的现象被当成所有平台的问题。
- **资深开发者会说：** "Confirmed on both platforms, same log line. The only difference is focus: on the Mac the window needs a click first."

### H. 反复出现的痛点做成工具，并且测量改动前后的数字

- **白话：** 同一种麻烦出现第三次，就别再靠人小心了，做一个工具或检查。做完之后用数字证明它真的改善了。
- **在哪里：** ADR-0125 就是这样来的：RED receipt 又慢又不可信，这个问题出现了很多次，于是写成仓库脚本。它的 T-8 要求实测"一个文件的 RED → GREEN 要几秒"，并测一个真实的仓库测试文件，作为用户决定是否把 lane 挪到 Mac mini 的依据。
- **防止什么：** 规则越写越长，错误却还在重复；"感觉快了"其实没快。
- **资深开发者会说：** "This is the third time the full lane made a red opaque. Let's turn it into tooling, and measure before and after so the pilot decision rests on numbers."

### I. agent 停下来了，不等于做完了

- **白话：** 一个 agent 显示"空闲"或"完成"，只说明它不动了，不说明它把事做完了。要去看它应该写出的那个报告文件。
- **在哪里：** rule 71：gpt-imple-2 曾因为输出长度限制停了两天（2026-10-18），状态看起来是空闲。所以规则要求：被唤醒后先读预期的报告文件；文件不在，再读 pane 最近的输出。
- **防止什么：** 把"进程不动了"当成"任务完成"，几天后才发现什么都没交付。
- **资深开发者会说：** "Settled isn't done. Where's the handoff file?"

### J. 重型命令每个提交只跑一次，并且排队

- **白话：** 完整测试、typecheck、build、`cargo test` 都很吃 CPU，多个 session 共用一台机器。迭代时只跑受影响的文件（不加锁，最多 2 个 worker），提交前在锁下跑一次全量。
- **在哪里：** rule 10 § How much to run；gpt-imple-1 的 brief § 5 把四条 gate 命令写死。它调用 receipt CLI 时直接调用，因为配置的 lane 自己会拿锁，套两层会嵌套等待（会话 07:51）。
- **防止什么：** 机器过载（10 核机器曾经负载 45），所有人都变慢；同一棵树被重复测试。
- **资深开发者会说：** "One full run per commit, under the lock. Everything else is targeted."

### K. 测完要还原，并且用哈希证明还原了

- **白话：** 测试改过的设置、草稿、键盘布局、测试文件，结束时都要恢复，并且用校验值证明恢复成功，不能只说"恢复了"。
- **在哪里：** W-3 到 W-1b 在 Windows 上：运行前用 robocopy 给 mdpro 的配置拍快照；结束时 `/MIR` 恢复，`config.json` 哈希 `6278C048` 和快照一致，草稿数两边都是 0；测试文件逐个和 `.pristine` 副本比哈希；临时加的德语键盘布局，测完删掉，并核对语言列表和测试前一致。快照里有 MCP token，所以它从不拉回 Mac；删除快照属于递归删除，要先等用户的确认（rule 25）。
- **防止什么：** 测试把用户的环境改坏了，下一轮测试的起点也被污染。
- **资深开发者会说：** "Restored and verified: config hash matches the snapshot, fixtures match pristine."

### L. 把 bug 写成"重现步骤 + 一条日志"

- **白话：** 报一个 bug 时，先写步骤，再写结果，再附上证明代码走到了那里的那一行日志。别人照着做一遍就能复查。
- **在哪里：** W-1b 发现的草稿问题，写成了这样：打字 → 等 `draft.write` → Ctrl+Z 回到干净 → 标签页开着直接退出 → 下次启动 `file.draft.list listed:1`，并弹出 Recover drafts，里面是已经撤销的文字。对照：同样的步骤，但先关标签页 → `listed:0`。复现 2/2。
- **防止什么：** "我这边好好的"；接手的人要花一小时才能复现。
- **资深开发者会说：** "Repro, 2 of 2: steps, then the log line. The control (closing the tab first) comes back clean."

---

## 三、和 Matt / pstack 的做法对照

| 本文 | 对应的外部做法（见 `dev-practices-matt-pstack.md`） | mdpro 多做了什么 |
|---|---|---|
| A 测试矩阵 + 对抗审查 | Matt `/tdd` 的 red → green；pstack 的 `/interrogate` | 在**写测试之前**就攻击矩阵，并且由另一个模型来攻击 |
| B 数得出来的 RED | `/tdd` "a test you never saw fail proves nothing" | receipt 记录失败的类型和计数；ADR-0125 只接受 `assertion-failure` |
| C/D 超出范围或前提不对就停 | pstack 的 in-your-own-words（先确认理解） | 写成 blocker 文件，列出需要的路径或哈希证据 |
| F 走对路线、同路线对照 | pstack `/control-app`："测试过了不等于能用" | 记 "not exercised"；对每个测试工具的局限单独说明 |
| H 痛点变工具 + 测量 | Matt `/retro`、pstack `/reflect`：改的是环境，不是代码 | 用 ADR 记录决定，用 T-8 的实测数字决定下一步 |
| I 停下不等于完成 | pstack "没有证据不许说成功" | 读预期的报告文件，而不是看状态 |

---

## 四、版本说明

- 本文基于 2026-10-16 到 2026-10-20 的 session，由 claude-imple-1 应用户要求整理（2026-10-20）。gpt-imple-1 的 ADR-0125 工具在写本文时**还没完成**：会话停在 08:11，`WI-1` 已记成 `opaque-failure`，`WI-2` 正在跑。第一章第 8–11 步用 M3b（已完成）的文件说明后半程的样子。
- 文中的时间都是 `+08:00` 的当地时间。Codex 会话里的时间戳是 UTC（07:37 UTC = 15:37 当地时间）；第一章引用的"会话 07:37"等都是 rollout 文件里的原始 UTC 时间戳。
- 规则以 `.claude/rules/` 为准；本文和规则不一致时，规则赢。
