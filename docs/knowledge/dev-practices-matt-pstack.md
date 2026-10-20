# 好的软件开发习惯：Matt Pocock 的 skills、pstack，以及业内公认的做法

写于 2026-10-16，给想学会资深开发者工作习惯的人看，不是给想背命令的人。每一条都回答四个问题：
**它说的是什么**（白话）、**出自哪里**、**它防止了什么失败**、**mdpro 里在哪里已经这样做**，最后给一句
**资深开发者会怎么说**。词汇对照见同目录的 [`dev-vocabulary.md`](./dev-vocabulary.md)。
mdpro 自己最近五天的实例见 [`dev-practices-from-sessions.md`](./dev-practices-from-sessions.md)。

**来源**（由两个调研 subagent 读原文整理，作者抽查过引文和 mdpro 路径）：
- Matt Pocock 的 skills：本机安装的 `mattpocock-skills` **1.3.1**
  （`~/.claude/plugins/cache/claude-plugins-official/mattpocock-skills/1.3.1/skills/`），每个
  `SKILL.md` 和它引用的文件；公开 README <https://github.com/mattpocock/skills>。下文用 `M/` 代表这个
  skills 目录。
- pstack：[`docs/reference/20261002-The_Complete_Guide_to_pstack_Pt._1.md`](../reference/20261002-The_Complete_Guide_to_pstack_Pt._1.md)
  全文；源码和 README <https://github.com/cursor/plugins/tree/main/pstack>；独立介绍
  <https://flaviocopes.com/pstack>。**Part 2 的原文没取到**，相关内容来自一个第三方转述页
  （<https://youmind.com/vi-VN/landing/x-viral-articles/pstack-guide-part-two>），是二手材料。
- 业内做法：Google 工程实践、DORA、Martin Fowler、Kent Beck、Ousterhout、Anthropic 的 Claude Code
  文档，链接放在每条后面。调研时没能逐个打开验证所有链接，DORA 和 Anthropic 的几页确认过。

---

## 一、一句话看懂两套东西

**Matt Pocock 的 skills** 针对 AI 写代码时的四种失败：
1. 做出来的不是你要的。原因是没沟通清楚，所以开工前先"拷问"需求（grilling）。
2. 用词混乱、名字起得差。所以先定一份词汇表（domain-modeling）。
3. 代码跑不起来。原因是没有反馈，所以用 TDD 和"先做出能复现 bug 的命令"来补。
4. 越写越乱，变成一团泥。所以每天花一点力气维护设计（deep modules）。

把这四条串起来的是他引用的一句话：**"反馈的速度就是你的速度上限"**（the rate of feedback is your
speed limit）。他的 skills 刻意做得小、可组合，跟 Spec-Kit、BMAD 那类重流程框架对着干。

**pstack**（Cursor 的 Lauren Tan，网名 poteto）针对的是"AI 垃圾代码"（AI slop）。核心主张有两个：
1. **验证就是一切**（Part 1）。让 agent 能在真实运行的 app 里自己检查自己的工作，人才不会变成瓶颈。
2. **最贵的错误发生在写代码之前**（Part 2）。agent 理解错了你的意图，或者对系统了解不够。

**两者的共同点：** 都把"缩短反馈回路"当作第一原则，都要求拿证据说话，都主张把反复出现的错误变成自动检查，而不是再写一段规则。

---

## 二、两套流程，按顺序看

### Matt 的流程（`M/engineering/ask-matt/SKILL.md`）

1. **`/grill-with-docs`**：通过对话把想法问清楚，同时写下词汇表（`GLOSSARY.md`）和 ADR。
2. *（只在需要跑起来才能回答的问题上）* **`/prototype`**：做一个一次性原型来回答它，结果存在 `prototype/<name>` 分支。
3. 需要多个 session 才做得完？
   - 是：**`/to-spec`** 写规格，**`/to-tickets`** 切成带依赖关系的票，然后逐张 **`/implement`**，或者用 **`/implement-spec`** 并行做。
   - 否：直接 **`/implement`**。
4. 实现过程中：**`/tdd`** 一次做一个 red → green，做完用 **`/code-review`** 从两个角度审查。
5. **`/pr`**：写 PR 说明，附上改动前后的证据和风险判断。
6. **`/retro`**：复盘。改进的是**工作环境**（检查、规范），不是代码。

另有三个入口会汇入主流程：`/triage`（处理别人报来的问题）、`/diagnosing-bugs`（难查的 bug）、`/wayfinder`（大而模糊、一个 session 做不完的事）。

### pstack 的流程（作者把 README 和 Part 2 合成的顺序）

| 阶段 | 命令 | 解决什么问题 |
|---|---|---|
| 0 一次性准备 | `/setup-pstack`，`/create-verification-skill` | 为每个角色选模型；做出能操控 app 的工具和功能地图 |
| 1 进入 | `/poteto-mode` | 按任务挑一套固定做法（playbook），开 todo，规定"没有证据不许说成功" |
| 2 理解 | in-your-own-words、`/teach`、`/recall` | agent 理解错意图，或不了解系统 |
| 3 写规格 | `/technical-writing`（先写 README） | 没有对"做什么、怎样算完成"的共识 |
| 4 探索 | 原型 playbook、`/arena` | 靠争论而不是证据选方案 |
| 5 设计 | `/architect` | 类型和模块形状没想好，后面每个改动都要绕路 |
| 6 计划 | 多阶段计划 playbook | 一次性大改；看起来有进度、其实没有的计划 |
| 7 实现 | `/tdd`，laziness-protocol | 修 bug 不写回归测试；代码越加越多 |
| 8 验证 | `/control-app`（录像、截图作证据）、`/swarm` | "测试过了所以能用"；性能提升其实是噪声 |
| 9 审查 | `/blast-radius`、`/interrogate`（多个模型一起挑错） | 只有一个审查者时的盲点；小改动的意外影响 |
| 10 发布 | shipping playbook | 一摞 PR 中间有一个是坏的 |
| 11 维护 | `/maintain-verification-skill`（每天）、`/reflect` | 验证工具和 app 慢慢对不上；同样的错误反复出现 |

gstack（Garry Tan，mdpro 也在用）是另一种组织方式：按生命周期排开，"不要跳过阶段"。pstack 是一个入口，按原则和证据分派。两者大致一一对应（in-your-own-words ↔ `/office-hours`，`/interrogate` ↔ `/review` + `/codex`，`/reflect` ↔ `/retro`）。最大的差别是 gstack 的 `/browse` 是通用浏览器，而 pstack 要求为项目**专门做**一个控制工具。mdpro 是 Tauri 原生应用，通用浏览器够不到原生窗口，所以 mdpro 自己做了一个（ADR-0047）。

---

## 三、具体做法

每条的格式：**白话** · **出处** · **防止什么** · **mdpro 里** · **你可以这样说**。

### A. 动手之前：把问题弄清楚

**1. 拷问需求（grilling）**
- **白话：** 写代码前，向提需求的人一轮一轮地问，直到每个没定的决定都定下来。每轮只问现在就能回答的问题，每个问题都附上你推荐的答案。
- **出处：** Matt `grilling`："Ask the whole frontier in one round: number each question and give your recommended answer."
- **防止：** "做出来的不是我要的"。大多数这类问题其实是需求问题，不是代码问题。
- **mdpro 里：** 计划先过 `/cc-suite:review-plan`；需要用户拍板的事用 AskUserQuestion 问，并附推荐选项。
- **你可以说：** "Before we write a line, let's walk the decision tree. What's still open?"

**2. 事实自己查，决定才问人**
- **白话：** 能从代码、配置、文档里查到的，不要问人。只拿真正需要对方做选择的问题去打扰他。
- **出处：** Matt `grilling`："Finding facts is your job, never the user's … The decisions are the user's."
- **防止：** 浪费决策者的注意力，或者悄悄替对方做了决定。
- **mdpro 里：** 全局 CLAUDE.md 的 Decision Support 和 AskUserQuestion 的用法说明：只问用户才能决定的事。
- **你可以说：** "I checked the schema myself. The only thing I need from you is whether partial refunds are allowed."

**3. 统一用词（ubiquitous language）**
- **白话：** 每个概念只用一个词，写进词汇表，在对话、文档、代码、测试里都用它。被淘汰的同义词也写下来，标成"不要用"。
- **出处：** Matt `domain-modeling`（来自 Eric Evans 的领域驱动设计）；Fowler <https://martinfowler.com/bliki/UbiquitousLanguage.html>。
- **防止：** 同一个词指两样东西时，bug 就藏在两者之间。
- **mdpro 里：** ledger 的五个状态词（`Shipped/Partial/Stub/Absent/Unknown`，封闭集合）、事件命名 `file.<action>`、rule 70 的角色名。
- **你可以说：** "Is a 'draft' the same thing as a 'backstop' here? Pick one word."

**4. 用具体场景去挑战规则，再对照代码**
- **白话：** 别人说的规则，用刁钻的例子去试，再去看代码实际怎么做。两者对不上，就是一个发现。
- **出处：** Matt `domain-modeling`："Your code cancels entire Orders, but you just said partial cancellation is possible. Which is right?"
- **防止：** 抽象的规则听起来都对，直到碰上边界情况。
- **mdpro 里：** 审查时先核对引用的代码行再下结论；本 session 里审语义搜索计划时，先确认了 `anchor.ts:26` 里 front matter 真的会被解析成分隔线加标题。
- **你可以说：** "Walk me through what happens if they cancel one line of a shipped order."

**5. 只为重要的决定写 ADR**
- **白话：** 将来的人会质疑的决定，写一份简短记录：背景、选项、结论、代价。Matt 的标准是三条同时成立才写：难以撤回、没有背景会让人意外、是真正的权衡。
- **出处：** Matt `domain-modeling/ADR-FORMAT.md`；Nygard <https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions>。
- **防止：** 后来的人把故意的选择当成 bug "修掉"，或者重新提出早已否决的方案。
- **mdpro 里：** CLAUDE.md § ADR。要求比 Matt 更严：列出所有备选和落选理由；接受后正文不可修改，要改就写新的 ADR 来取代它（supersede）。`docs/adr/` 里约 110 份。
- **你可以说：** "This is a one-way door with a non-obvious reason, so it deserves an ADR."

**6. 把"不做"也记下来**
- **白话：** 拒绝一个需求时，写下长期成立的理由。下次有人再提，先翻记录。
- **出处：** Matt `triage/OUT-OF-SCOPE.md`："those aren't real rejections, they're deferrals."
- **防止：** 同一场争论每隔几个月重来一次。
- **mdpro 里：** CLAUDE.md § Constraints（只做本地文件，只导出 HTML）；E39"不做 benchmark 工具"、"不用 Stryker"这类明确不做的决定；ADR 的 `Rejected` 状态。
- **你可以说：** "We turned this down in March. Here's the write-up. Has anything changed?"

**7. 先做一次性原型（spike / prototype）**
- **白话：** 纸上说不清的问题，做一个最小的、用完就扔的程序来回答，再把答案带回正式代码。界面问题可以并排做几个版本，切换着比较。
- **出处：** Matt `prototype`："A prototype is throwaway code that answers a question. The question decides the shape."；pstack："Prototype before you commit."
- **防止：** 对着抽象设计长时间争论，或者锁死在第一个想法上。
- **mdpro 里：** rule 70 规定 UI 问题必须做成原型让用户选，放在不合入 master 的 `prototype/<id>-<slug>` 分支。
- **你可以说：** "Let's spike three layouts behind a toggle and pick one, instead of arguing about mockups."

**8. 查原始资料，不信二手转述**
- **白话：** 决定依赖外部库或 API 的某个事实时，去读官方文档或源码，并注明出处。
- **出处：** Matt `research`："Follow every claim back to the source that owns it."；`teach`："Never trust your parametric knowledge."
- **防止：** 博客过时或转述走样。
- **mdpro 里：** 计划和 ADR 要求注明来源；本文件自己也标注了 pstack Part 2 是二手材料。
- **你可以说：** "Don't trust the tutorial. What does the changelog for that version actually say?"

**9. 让 agent 先用自己的话复述问题**
- **白话：** 开工前，让 agent 用它自己的话把要解决的问题讲一遍，而不是你直接塞给它一个方案。
- **出处：** pstack Part 2 的 in-your-own-words。
- **防止：** 误解要到代码审查时才暴露；你自己没检查过的假设把 agent 带偏。
- **mdpro 里：** 用户在 `/echo-sleuth:extract` 那次就要求先"用你自己的话说出我的目的"，确认后才开工。
- **你可以说：** "Before you start, tell me in your own words what problem you're solving."

### B. 切分工作

**10. 规格写清"不做什么"，"完成"要能检查**
- **白话：** 规格从用户角度写，列出用户故事，**明确写出不在范围内的东西**。每张票最后附一份可以逐条独立验证的验收清单。
- **出处：** Matt `to-spec`、`triage/AGENT-BRIEF.md`："Every agent brief must have concrete, testable acceptance criteria."；Scrum 的 Definition of Done。
- **防止：** 镀金（做多了）和过早宣布完成。
- **mdpro 里：** 计划都有 Non-goals 一节；CLAUDE.md 规定 "Verified means its own gates passed, not that the code is written"；状态行必须在同一个提交里更新。
- **你可以说：** "'Search should work' isn't a criterion. What command, and what output proves it?"

**11. 描述行为，不写文件路径**
- **白话：** 票里写系统应该做什么、哪些接口要变，不写"改第 150 行"。代码会在有人接手之前就变了。
- **出处：** Matt `triage/AGENT-BRIEF.md`："Don't reference file paths: they go stale."
- **防止：** 票放几周后，里面的指引全部失效。
- **你可以说：** "Write the ticket against the contract, not against line 150 of handler.ts."

**12. 垂直切片 / 曳光弹（vertical slices / tracer bullets）**
- **白话：** 每一块工作都从数据层一路贯通到界面和测试，薄但完整，能单独演示。不要先把"整个后端"做完再做前端。
- **出处：** Matt `to-tickets`："a narrow but COMPLETE path through every layer … vertical, NOT a horizontal slice."；《程序员修炼之道》。
- **防止：** 集成问题拖到最后才暴露。
- **mdpro 里：** WI 和 D 通常就是端到端的；CLAUDE.md 的提交拆分顺序（Rust → services → stores → hooks → components）是在**一个切片内**按层排提交。目前没有规则明确写出"垂直切片"这个要求。
- **你可以说：** "Make the first slice tiny but end-to-end: one command, one button, one log line."

**13. 先重构让改动变容易，再做那个容易的改动**
- **白话：** 现有结构让新功能很别扭时，先在不改行为的前提下调整结构（单独一个提交），然后新功能就只是一个小改动。
- **出处：** Matt `to-tickets` 引 Kent Beck："Make the change easy, then make the easy change."
- **防止：** 重构和功能混在一个提交里，难审、难撤回。
- **mdpro 里：** 原子提交规则；纯移动文件单独一个 `refactor` 提交。
- **你可以说：** "First PR moves the logic behind one interface with no behaviour change. Second PR adds the feature."

**14. 先扩后缩（expand–contract）**
- **白话：** 要改动几千处调用的大改（改名、改类型），先让新旧写法并存，分批迁移调用方，最后删掉旧写法。全程构建不断。
- **出处：** Matt `to-tickets`；pstack 的 migrate-callers-then-delete-legacy-apis。
- **防止：** 一步到位的大改一旦出错就全面崩溃。
- **你可以说：** "Don't rename the column in one shot. Expand, migrate per package, then contract."

**15. 把工作当成依赖图，控制同时在做的数量**
- **白话：** 每张票写明要等哪些票先完成；前置都完成了就可以开工，互不依赖的可以并行。同时进行中的事情要设上限，先做完再开新的。
- **出处：** Matt `implement-spec`："The tickets are not a list of steps. They are a task graph."；看板 WIP 限制 <https://dora.dev/capabilities/wip-limits/>。
- **防止：** 按习惯而不是按真实依赖排顺序；同时开太多事，结果什么都没做完。
- **mdpro 里：** ADR-0097 和 rule 70：每个 session 最多一个未合入的实现项，全机最多两个；空闲时从队列拉 prep 工作。
- **你可以说：** "We're at the two-item cap. Finish and land before pulling the next one."

**16. 计划切成能验证的小步**
- **白话：** 计划是一串 PR 大小的步骤，每一步结束时都处在一个能跑起来检查的状态。
- **出处：** pstack："Long, detailed plans can create an illusion of progress."；DORA 小批量 <https://dora.dev/capabilities/working-in-small-batches/>。
- **mdpro 里：** 计划里的 WI 都写了测试行和完成条件；原子提交。
- **你可以说：** "Split it: the Rust command in one commit, the TS wrapper in the next."

### C. 写代码：测试与设计

**17. 红 → 绿 TDD，一次一个切片**
- **白话：** 先为下一个小行为写一个会失败的测试，亲眼看它失败，再写刚好够让它通过的代码，然后重复。不要一次写一堆测试。
- **出处：** Matt `tdd`："Red before green."；Kent Beck；pstack `/tdd`。
- **防止：** 没见过失败的测试什么都证明不了；先写完所有测试，测的是一个想象中的设计。
- **mdpro 里：** rule 10；tdd-guardian 的 receipt 证明确实先红过；修 bug 必须带回归测试。**区别：** Matt 把重构放在循环之外，留到审查阶段；mdpro 和经典 TDD 是 red → green → refactor。
- **你可以说：** "Show me it red first, then the smallest change that turns it green."

**18. 测行为，不测实现；只在系统边界 mock**
- **白话：** 测试像真实调用方一样调用代码，检查看得见的结果，不去碰私有方法。只伪造你控制不了的东西：网络、时间、随机数、Tauri IPC。
- **出处：** Matt `tdd/mocking.md`："Mock at system boundaries only."；测试金字塔 <https://martinfowler.com/articles/practical-test-pyramid.html>。
- **防止：** 测试绑死实现，一重构就红，大家开始无视红灯；mock 了自己的逻辑，测试就只是在测 mock。
- **mdpro 里：** rule 10 的 Anti-patterns："Mock only at boundaries"、"No snapshot tests for logic"。
- **你可以说：** "That test asserts its own mock. Mock Tauri, not the store."

**19. 期望值要来自独立的来源**
- **白话：** 如果测试用和代码一样的算法算出期望值，它永远不会和代码不一致。用已知的字面值、手算的例子或者规格里的数。
- **出处：** Matt `tdd`："Expected values must come from an independent source of truth."
- **防止：** 同义反复的测试按构造必然通过，恰好藏住它声称覆盖的那个 bug。
- **mdpro 里：** tdd-guardian 的 spec-adversary：专门去找"能通过全部测试、但实现是错的"那种写法。
- **你可以说：** "Don't reduce in the test. The answer is 15, so write 15."

**20. 深模块（deep modules）和"删除测试"**
- **白话：** 好的模块用一个小而简单的接口藏住大量复杂度。判断方法：想象把它删掉。如果复杂度会散到调用方，它在发挥作用；如果什么都没少，它只是一层转手。
- **出处：** Matt `codebase-design`："Imagine deleting the module. If complexity vanishes, it was a pass-through."；Ousterhout《A Philosophy of Software Design》。
- **防止：** 一堆浅的小包装，知识散落在各处，人和 agent 都难以理解。
- **mdpro 里：** rule 50 的三层 IPC（Rust 命令 → 注册 → 有类型的 TS 封装）。**注意：** rule 50 的 300 行上限可能诱使人拆出浅模块，Ousterhout 会反对这样拆。
- **你可以说：** "Its interface is as big as its body. Can we hide more behind it?"

**21. 有两个实现才算真正的接缝**
- **白话：** 只有当至少两样东西真会接到这个接口上时（通常是生产实现和测试实现），才值得抽一个接口出来。
- **出处：** Matt `codebase-design/DEEPENING.md`："One adapter means a hypothetical seam. Two adapters means a real one."（"seam"一词来自 Michael Feathers）
- **防止：** 为想象中的将来做抽象（YAGNI）。
- **你可以说：** "Who's the second adapter? If there isn't one, drop the interface."

**22. 设计做两遍**
- **白话：** 重要接口先画出几个差别很大的方案（最简的、最灵活的、对常见调用方最顺手的），比较之后再定。第一个想法很少是最好的。
- **出处：** Matt `codebase-design/DESIGN-IT-TWICE.md`；pstack `/architect`：让不同模型画方案，再由另一个模型来评判。
- **mdpro 里：** ADR 必须写出所有备选方案和落选理由。
- **你可以说：** "Before we lock this API, give me a minimal version and a caller-optimised one to compare."

**23. 少写、能删就删、类型先行**
- **白话：** 用能解决问题的最小改动，优先删除；先把类型和数据结构想对；让非法状态在类型上无法表示；在边界做校验，核心保持纯净。
- **出处：** pstack 的 laziness-protocol、subtract-before-you-add、type-system-discipline、boundary-discipline；YAGNI/KISS <https://martinfowler.com/bliki/Yagni.html>。
- **防止：** agent 特别容易写多；类型问题要等逻辑写完才发现。
- **mdpro 里：** rule 60 "No dead code"；rule 60 的 IPC 信任边界（Rust 里校验前端传来的一切）。
- **你可以说：** "Who needs this today? If no one, delete it."

### D. 查 bug

**24. 先做出能复现 bug 的命令，再推理原因**
- **白话：** 先做出一条命令：bug 在时它失败，修好后它通过，而且要快、要稳定。在这条命令出现之前，不要读代码猜原因。
- **出处：** Matt `diagnosing-bugs`："If you catch yourself reading code to build a theory before this command exists, stop."
- **防止：** 修了也无法验证是否真的修好。
- **mdpro 里：** 审计降级 High 必须附上复现或反证（rule 70，用户 2026-10-16 的决定）；b178 的 H-1 就是用内存中的交错复现证实的。
- **你可以说：** "What's the one command that goes red on this bug? Until we have it, we're guessing."

**25. 可被推翻的假设，一次只改一个变量**
- **白话：** 把失败用例缩到最小；列 3–5 个按可能性排序的假设，每个都带一个"如果是它，那么改 X 就会怎样"的预测；然后一次只改一个变量去验证。
- **出处：** Matt `diagnosing-bugs`："If you cannot state the prediction, the hypothesis is a vibe."
- **你可以说：** "If it's the cache, clearing it should make the bug vanish. Let's try exactly that and nothing else."

**26. 修复前先写回归测试；找不到地方写测试，本身就是发现**
- **白话：** 把最小复现变成一个失败的测试，修好后看它变绿。如果代码里没有合适的地方放这个测试，把这一点记成设计问题。
- **出处：** Matt `diagnosing-bugs`："If no correct seam exists, that itself is the finding."
- **mdpro 里：** rule 10 更严：每个 bug 修复**必须**有回归测试，接缝不好找也要写。
- **你可以说：** "The fix isn't done until there's a test that would have caught it."

### E. 验证：在真实的 app 里证明它能用

**27. 让 agent 自己验证（pstack 的核心）**
- **白话：** 给 agent 一套能驱动真实 app 的工具（启动、截图、按键、等待界面稳定），让它改完自己检查，一直改到检查通过。"能编译"不算验证。
- **出处：** pstack Part 1 "Verification is all you need"、"Build the Lever"；Claude Code 最佳实践 <https://code.claude.com/docs/en/best-practices>。
- **防止：** 每个改动都要等人去点一遍，人成了瓶颈；agent 对从没运行过的东西报告"成功"。
- **mdpro 里：** ADR-0047（agent 通过只在开发构建里开放的控制通道，在真实 app 里验证）；`scripts/control/` 的启动器；`/gui-acceptance`；Windows 上的 `cdp.sh` / `ui.sh`。rule 70 要求每个真机检查项写明能证明代码路径被走到的那行日志，没走到就记为"not exercised"，不算通过。
- **你可以说：** "Don't tell me it works. Show me the log line that proves the path ran."

**28. 功能地图（feature map）**
- **白话：** 一份可搜索的清单，列出每个功能做什么、用户怎么进入、怎么用工具驱动它、有哪些坑。作者把它叫作代码的"物化记忆"。
- **出处：** pstack Part 1 "Keep agents smart with Feature Maps"。
- **mdpro 里：** [`docs/feature-ledger.md`](../feature-ledger.md) 起的就是这个作用，每行有"怎么确认"一栏；`pnpm ledger:check` 检查路径和状态词。
- **还缺的：** pstack 每天运行 `/maintain-verification-skill`，让地图跟上 app 的变化。mdpro 没有定期检查"怎么确认"那一栏是否仍然成立。CLAUDE.md 自己也承认 ledger 的检查"cannot tell you a sentence is still true"。

**29. 把验证工具当基础设施来维护**
- **白话：** 验证工具每天维护、本身也要测试。一个从没见过失败的检查，可能根本没接上。
- **出处：** pstack "Treat verification as critical infrastructure"；Matt `setup-ts-deep-modules`："a config that doesn't fail on a violation is worthless."
- **mdpro 里：** rule 70 "a failure verdict needs a passing control on the same route in the same run"（Windows skill 第 5 条同理）。
- **你可以说：** "Add a deliberate bad import and show me the lint fail before we trust it."

### F. 审查、合入、发布

**30. 两个角度审查：合不合规范，做没做对**
- **白话：** 第一遍问代码是否符合项目规范；第二遍问它是否做了票上要求的：没漏、没多、没错。两遍分开，谁也遮不住谁的问题。
- **出处：** Matt `code-review`："Code that follows every standard but implements the wrong thing → Standards pass, Spec fail."
- **mdpro 里：** rule 60（规范）加 Codex mini audit 和 landing verifier（是否达成、是否越界）。
- **你可以说：** "Clean code, but the ticket asked for partial refunds and this only does full ones."

**31. 作者不审自己，最好换一个模型来审**
- **白话：** 至少要有另一个人审过才能合入，作者不能批准自己的改动。对 agent 来说，审查者最好是**另一个模型或另一个 session**，因为同一个模型和它自己有相同的盲点。
- **出处：** Google 代码审查 <https://google.github.io/eng-practices/review/>；pstack `/interrogate`（多个模型一起审一个 diff）；Matt `retro`："The review agent should be responsible for imposing coding standards, not the implementation agent."
- **mdpro 里：** ADR-0085、rule 70 第 4 条：Codex（另一家的模型）审计，零 Critical、零 High 才能合入；implementor、delegator、auditor 三个角色分开。
- **你可以说：** "The author doesn't land their own branch. The delegator does, after the audit."

**32. 用严重等级决定什么挡住合入**
- **白话：** 每个 diff 过一份写好的清单，问题按固定等级分类，由等级决定是否必须修。
- **出处：** Google <https://google.github.io/eng-practices/review/reviewer/looking-for.html>。
- **mdpro 里：** rule 60（BLOCK / MUST / SHOULD / NOTE）；审计用 Critical / High / Medium / Low。
- **你可以说：** "That's a data-loss path, so it's a BLOCK under rule 60, not a SHOULD."

**33. 主干开发、短分支、小提交**
- **白话：** 大家都频繁合入同一条主干；分支只活几小时到几天；每个提交只做一件事。
- **出处：** DORA <https://dora.dev/capabilities/trunk-based-development/>；Google 小 CL <https://google.github.io/eng-practices/review/developer/small-cls.html>。
- **防止：** 分支越老，冲突和集成意外越多。
- **mdpro 里：** ADR-0083（master 是唯一主干）；只用 `git merge --ff-only`，不要 merge commit；一项工作一个短分支 `<type>/<id>-<slug>`；ADR-0084（远端分支合入 30 天后删除）。
- **你可以说：** "Rebase onto master and hand it off today. Don't let it sit for a week."

**34. CI 是合入的关卡**
- **白话：** 每个改动都在干净的机器上自动构建和测试，红了就不能合入。"在我机器上能跑"不算数。
- **出处：** Fowler <https://martinfowler.com/articles/continuousIntegration.html>；DORA。
- **mdpro 里：** ADR-0095（PR 的 head SHA 上 `ci-gate` 必须是绿的）；登记过的偶发失败测试最多重跑一次（D196）。
- **你可以说：** "CI is red on the head SHA, so it doesn't land, even if it passed locally."

**35. PR 附证据，并说明能不能撤回**
- **白话：** PR 用最小的清晰图示说明改了什么，附上改动前后的证据，并说明撤回有多难（这扇门能不能走回头）、会影响多大范围。
- **出处：** Matt `pr`："You can walk back through two-way doors, but not one-way doors."；pstack `/blast-radius`。
- **mdpro 里：** 审计结论贴在 PR 评论里；降级必须附复现或反证。
- **你可以说：** "This one drops a column, so it's a one-way door. I want a second reviewer and a backup."

**36. 先小范围发布（金丝雀），检查的是真正发出去的那个包**
- **白话：** 先发给一小部分人或一台机器，确认没问题再扩大。自动检查直接针对发布出去的产物，而不只是源码。
- **出处：** Fowler <https://martinfowler.com/bliki/CanaryRelease.html>；gstack `/canary`。
- **mdpro 里：** ADR-0073（发布流程先验证上传的草稿，再自动公开）；`build-only` → `draft` 的演练模式；v0.3.x 的 canary 检查。
- **你可以说：** "Rehearse with mode=build-only before the real draft."

**37. 可复现的构建：锁住工具和依赖版本**
- **白话：** 同样的源码在任何机器上构建出同样的结果：固定工具版本、锁定依赖、不让"最新版"悄悄混进来。
- **出处：** <https://reproducible-builds.org/>。
- **mdpro 里：** `packageManager` 固定 pnpm 10.26.1；提交 `pnpm-lock.yaml` 和 `Cargo.lock`；补丁或 lockfile 变了要 `--frozen-lockfile` 重装；D181 guard 拒绝在过期的 `node_modules` 上构建。
- **你可以说：** "Install with --frozen-lockfile. If the lockfile has to change, that's its own commit."

**38. 语义化版本和随手写的 changelog**
- **白话：** 版本号有含义（主.次.补丁）；用户能看到的变化当场写进 changelog 的 Unreleased，发布时再归档。
- **出处：** <https://semver.org>、<https://keepachangelog.com/en/1.1.0/>。
- **mdpro 里：** rule 40 和 `/bump`（三个版本文件同步）；`CHANGELOG.md` 的 `## [Unreleased]`。
- **你可以说：** "Add it under Unreleased now, not at release time."

### G. 复盘与持续改进

**39. 复盘改环境：机械性的错误变成自动检查**
- **白话：** 出了问题，问的是"环境里什么地方让这个错误有机会发生"。固定模式的错误加 lint、hook 或 CI；需要判断的，写进审查规范。能做检查就不要只写规则。
- **出处：** Matt `retro`："Default to building the check over writing the rule."；pstack "Encode lessons in structure"；Google 无责复盘 <https://sre.google/sre-book/postmortem-culture/>。
- **防止：** 规则靠人记，人会忘；检查会自己执行（防呆，poka-yoke）。
- **mdpro 里：** `role-guard.sh`、`receipt-rustfmt-guard.sh` 这些 hook 都是由事故变成的检查；`progress.md` 的事后分析；rule 70 在每条规则旁边写明当初的事故。
- **你可以说：** "We've hit this three times. Let's add a hook instead of another paragraph in the rules."

**40. 把检查往前移（shift-left）**
- **白话：** 问题发现得越早越便宜：编辑时有类型和 lint，提交前有测试，写代码前有设计评审。
- **出处：** DORA <https://dora.dev/capabilities/test-automation/>。
- **mdpro 里：** PreToolUse hook；`pnpm ledger:check`；先用 `/cc-suite:review-plan` 审计划再动手。语义搜索计划在一行代码都没写之前，就审出了 8 个 High。
- **你可以说：** "Catch it in the plan, not on the user's machine."

**41. 结构化日志**
- **白话：** 日志写成结构化数据（JSON），事件名一致，记开始、成功和失败，方便调试连不上调试器的正式版本。
- **出处：** DORA <https://dora.dev/capabilities/monitoring-and-observability/>。
- **mdpro 里：** rule 20；`~/.mdpro/mdpro.log`（JSONL）；真机检查用日志行作证据。
- **你可以说：** "Log a start and a fail with the error. A silent catch is a bug."

### H. 和 agent 一起工作的习惯

**42. 管理上下文：只在阶段边界换场**
- **白话：** 模型（和人）在信息聚焦、不过载时想得最好。相关的思考放在一起，只在两个工作阶段之间清理或交接，不在中途。所有摘要都会丢细节。
- **出处：** Matt `ask-matt/PHASE-BOUNDARIES.md`："Every move except Continue turns a primary source into a secondary source."；Anthropic <https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents>。
- **mdpro 里：** rule 70 的 session 轮换（压缩 5 次、10 次时提醒写交接文档）；全局 CLAUDE.md 的 Orchestration（大量输出交给 subagent，只带回摘要）。
- **你可以说：** "Don't compact mid-implementation. Finish this phase, then decide."

**43. 协调者不亲自干活**
- **白话：** 主 session 负责分派任务、做决定，把大量的阅读和执行交给 sub-agent，保持自己的上下文干净。
- **出处：** pstack "Coordinator, not doer"。
- **mdpro 里：** delegator 的角色；landing verifier 和 number registrar 两个 subagent。
- **你可以说：** "Send the full test run to a subagent and bring back only the failures."

**44. 一个事实只放一处，其他地方只放链接**
- **白话：** 每个事实只有一个权威位置，其他地方链接过去，不复制。交接文档和票指向规格、提交和 ADR，而不是把内容粘贴进来。
- **出处：** Matt `writing-for-agents`："Keep each meaning in a single source of truth."
- **防止：** 副本会慢慢对不上，过期的副本比没有更糟。
- **mdpro 里：** CLAUDE.md "Plans and rules link to ADRs rather than restating the reasoning"；sequencing doc 只记顺序和状态，验收标准留在原计划里。
- **你可以说：** "Link the ADR. Don't paraphrase it in the ticket."

**45. 写指令时说要什么，删掉不起作用的句子**
- **白话：** 在文档和提示词里写你要的行为，而不是你禁止的行为。删掉不改变读者做法的句子。不常用的内容放到单独的文件里，需要时再链接（渐进式披露）。
- **出处：** Matt `writing-for-agents`："Prompt the positive."
- **mdpro 里：** 规则文件按路径自动加载（`paths:` frontmatter）。**还缺的：** rule 70 约 24 KB，其中一部分可以变成 hook。
- **你可以说：** "This file is 2,000 lines. Move the reference parts out and keep the steps on top."

**46. 角色分开，危险操作要确认**
- **白话：** 每个参与者只拿它的角色需要的权限；不可撤回的操作要人明确确认。按团队分工来塑造系统的边界（康威定律）。
- **出处：** 最小权限 <https://csrc.nist.gov/glossary/term/least_privilege>；Fowler 的康威定律 <https://martinfowler.com/bliki/ConwaysLaw.html>；pstack never-block-on-the-human（只在不可撤回前停下来问）。
- **mdpro 里：** rule 25（`rm -rf`、强推、`reset --hard` 要确认）；`MDPRO_ROLE` 和 role-guard；rule 70 的区域独占（"two sessions on one file is a coordination bug"）。
- **你可以说：** "Show me the exact command and what it could destroy, and offer the safer alternative."

**47. 分享前先去掉密钥**
- **白话：** 命令、日志、交接文档里经常带着 token。贴出去之前替换成 `<REDACTED>`；凭据放在环境变量里，不出现在任何粘贴内容中。
- **出处：** Matt `diagnosing-bugs`、`handoff`："Redact every secret first."
- **mdpro 里：** rule 70 "never print the MCP token or the hook receiver token"；Windows 快照里有 MCP token，用完即删。
- **你可以说：** "Strip the auth header before you paste that log into the issue."

**48. 学习的方法：主动回忆，间隔练习**
- **白话：** 学一个主题，用刚好超出你现有水平的小课；练习时不看资料，凭记忆回想；把练习分散在不同时间。读完时"好像懂了"的感觉消退得很快。
- **出处：** Matt `teach`："Fluency can give the user an illusory sense of mastery."
- **用在这份文档上：** 不要只是重读。合上文件，试着凭记忆说出第 17、20、27 条各防止什么问题，过几天再试一次。

---

## 四、mdpro 还没做到的（调研发现）

- **没有运行时的功能开关（feature flag）。** 只有编译期的 cargo feature（控制通道只在开发构建里）。原型用的是一次性分支。参见 <https://martinfowler.com/articles/feature-toggles.html>。
- **"垂直切片"没有写成规则**，虽然实际上一直这样做。
- **功能地图没有定期校验。** 没有任何东西定期检查 ledger 的"怎么确认"一栏是否仍然成立。
- **规则以文字为主。** 按"能做检查就别写规则"的原则，rule 70 里的一部分可以变成 hook。

## 五、版本说明

- Matt 的 skills 1.3.1 把词汇表文件名从 `CONTEXT.md` 改成了 `GLOSSARY.md`，`implement-spec`、`pr`、`retro` 也已经从测试版转为正式。仓库里的
  [`docs/guide/20261016-matt-skills-vs-xiaolai-plugins-v036.md`](../guide/20261016-matt-skills-vs-xiaolai-plugins-v036.md)
  是按 1.2.3 写的，这两处已经过时。
- `resolving-merge-conflicts` 在 1.3.1 里被删了，安装的文件里没有写原因。

## 附：各条来源

两份完整的调研笔记（每条都有原文引用和路径）是本文的依据。它们没有放进仓库，只保存在作者 session 的 scratchpad 里（`kb/matt.md`、`kb/pstack-and-practices.md`）。要核对某条引文，请到上面列出的 `M/` 路径或 pstack 链接里查原文。
