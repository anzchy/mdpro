# ADR 判定标准：mdpro 现行规则与各家官方指引对照

调研日期：2026-10-11。只采用一手来源，二手来源会单独标明。凡写「未找到官方指引」的地方，都没有拿博客文章代替。

## 1. mdpro 现行标准

出处：`CLAUDE.md` 的「## Architecture Decision Records (ADR)」一节，以及 rule 70 的「Reserving numbers」。

- **触发条件**：「When a decision is consequential, write an ADR.」consequential 指三种情况之一：「expensive to reverse, it constrains later work, or it will be re-litigated by someone who wasn't in the room」。
- **举例**：「picking a rendering surface, adding or refusing a dependency, changing an IPC contract, accepting a known defect, or deciding **not** to build something」。
- **启发式判断**：「Decisions that reach for `AskUserQuestion` are usually ADR-worthy」。
- **位置与编号**：放在 `docs/adr/NNNN-kebab-title.md`，从 `0001` 顺序编号，「never renumbered and never deleted」。
- **结构**（Nygard）：Title → **Status** → **Context** → **Decision** → **Consequences**。Context 写当时的理解，「not as they look in hindsight」。篇幅「Keep it to one page」。
- **状态**：只能取 `Proposed` / `Accepted` / `Superseded by ADR-NNNN` / `Deprecated` 之一，每次改状态都要写日期。
- **不可变**：「An accepted ADR is immutable.」改变主意时，写一篇新 ADR 取代旧的，两篇都留在仓库里。
- **成本**：「Record the costs, not just the benefits.」
- **与计划、规则的关系**：plan 和 rule 链接到 ADR，不重复其中的理由；两者冲突时以 ADR 为准，修改 plan。已写在 `docs/plans/` 里的决策不批量回填，等到它「next disputed, superseded, or built on」时再单独升级为 ADR。
- **编号预留**（rule 70）：写 ADR 之前先通过 delegator 预留编号。delegator 要查遍所有 worktree、所有分支和 mac-mini，再向所有 session 公布。

**实际执行情况**（`docs/adr/` 共 76 篇，本次抽查）：

- Status 行常引用用户原话作为授权证据，例如 0075 的「User's words: 「A：…」」。
- 0076 只取代 ADR-0073 的一个条款（「Supersedes **only** the `verify-release` clause」），即**部分取代**。
- 76 篇里有 54 篇超过 80 行，最长的 0022 有 299 行、0047 有 279 行，与「one page」的要求明显不符。
- 只有 14 篇出现了 alternatives / considered 字样，说明没有固定的「备选方案」章节。
- 没有 `Rejected` 状态，没有决策日志索引文件，`AGENTS.md` 里也没有提到 ADR。

## 2. 各家官方指引

### 2.1 Microsoft

**Azure Well-Architected Framework「Maintain an architecture decision record (ADR)」**（Microsoft Learn，2026-04 更新）
<https://learn.microsoft.com/en-us/azure/well-architected/architect-role/architecture-decision-record>

- **触发条件**：「Only include choices that affect the system's structure, key quality attributes, or are difficult to reverse.」同时要求记录「alternatives that you ruled out」。
- **何时开始**：从 workload 一开始就记，老系统要「retroactively generated based on known past decisions」。
- **必备内容**：Problem statement with context、Options considered、Decision outcome（含 tradeoffs，以及「Record the confidence level of the decision」）、Status。
- **其他要求**：
  - 分阶段的决策要拆成多条记录。
  - 「Avoid hiding consequences」。
  - 「Avoid making decision records design guides」：补充材料用链接给出，但决策本身「must be clear and stand alone」。
- **状态**：Proposed、Accepted、Superseded（原文用「such as」列举，没有限定为封闭集合）。
- **不可变**：「The ADR serves as an append-only log. Don't go back and edit accepted records. If a decision changes, write a new record that supersedes the original and link the two together.」
- **AI agent**：未提及。

**Code With Engineering Playbook「Decision Log」**（Microsoft ISE 公开手册）
<https://microsoft.github.io/code-with-engineering-playbook/design/design-reviews/decision-log/>

- **触发条件**：「significant decisions are made that affect the structure and characteristics of the solution」。spike 的结论也可以写成 ADR。
- **谁决定**：团队在 PR 里讨论 Proposed 状态的 ADR，接受后合并。
- **必备章节**：编号与标题、Date、Status、Context、Decision（以「We will…」开头）、Consequences。
- **编号冲突**：多人并行写 ADR 时，建议用工作项 ID 作编号，避免冲突。
- **索引**：另设一个 `decision-log.md` 汇总表。
- **状态**：Proposed / Accepted / Deprecated / Superseded。
- **不可变**：页面只说「可被取代」，没有写明已接受的 ADR 不得编辑。
- **AI agent**：未提及。

**Cloud Adoption Framework**：没有找到 CAF 专属的 ADR 模板或判定标准。CAF 的 decision guides 是技术选型指南，不是决策记录规范，因此不作为本文依据。

### 2.2 Google

**Google Cloud Architecture Center「Architecture decision records overview」**
<https://docs.cloud.google.com/architecture/architecture-decision-records>

- **触发条件**（三选一）：「there's no existing basis for a decision」；「two or more engineering options and you want to document your thoughts and reasons」；团队的方案没有记录在团队能看到的地方。
- **建议内容**：作者与团队、Context and problem、功能与非功能需求、受影响的 CUJ、Overview of the key options、Decision and reasons、可选的时间戳。
- **状态**：页面没有定义状态生命周期。
- **变更**：要求「include the previous decision and why a change is made」，但没有写明「已接受即不可变」。
- **存放**：「close to your application code, ideally in the same version control system」，可以再把关键决策同步到 wiki。
- **AI agent**：未提及。

**《Software Engineering at Google》第 10 章「Documentation」**（官方出版物）
<https://abseil.io/resources/swe-book/html/ch10.html>

- **要求**：「Most teams at Google require an approved design document before starting work on any major project.」
- **内容**：goals、实现策略，以及「key decisions … with an emphasis on their individual trade-offs」，还有 alternatives，模板还要求考虑安全、隐私和国际化。
- **生命周期**：批准后归档为历史记录，发布前回看目标是否仍然成立。
- **所有权**：「Documents without owners become stale」，文档也要有明确的 owner。

**「Design Docs at Google」（Malte Ubl）**
<https://www.industrialempathy.com/posts/design-docs-at-google/>

这是**个人博客，不是 Google 官方文件**，只作参照。

- **何时写**：问题或方案存在歧义时才写，否则「little value」。如果五个问题中有三个回答「是」，就值得写；这五个问题包括「design uncertain」「contentious」「senior input helpful」等。
- **章节**：Context and scope、Goals and non-goals、Design、Alternatives considered、Cross-cutting concerns。
- **后续更新**：已发布系统的变更通常写成 amendment，原文档链接过去，而不是改写原文。

### 2.3 Meta

**未找到官方指引。** engineering.fb.com 上没有关于 design doc、RFC 或决策记录流程的文章。二手来源（Pragmatic Engineer）认为 Meta 整体上不重视文档，但这不是官方说法，因此不作为依据。

### 2.4 Anthropic（Claude / Claude Code）

**Claude Code docs「Best practices」**
<https://code.claude.com/docs/en/best-practices>

- CLAUDE.md 的「✅ Include」表里有「Architectural decisions specific to your project」。
- 「❌ Exclude」表里有「Information that changes frequently」和「Long explanations」。
- 精简原则：「Would removing this cause Claude to make mistakes? If not, cut it.」
- 长文档用链接给出（「link to docs instead」），按需加载的知识放进 skills。
- 「Hooks are deterministic」：必须每次都执行的规则应该做成 hook，因为 CLAUDE.md 只是 advisory。

**Claude Code docs「How Claude remembers your project」**
<https://code.claude.com/docs/en/memory>

- 项目 CLAUDE.md 应包含「architectural decisions」。
- 「target under 200 lines per CLAUDE.md file」。
- 只对部分代码有效的内容放进 path-scoped `.claude/rules/`。
- 要定期清理相互矛盾的指令：「Claude may pick one arbitrarily」。
- 可以用 `@path` 导入文件。

**Anthropic Engineering「Effective context engineering for AI agents」**（2025-09-29）
<https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents>

- compaction 会保留「architectural decisions, unresolved bugs, and implementation details」。
- 推荐 structured note-taking，例如 NOTES.md，即把笔记持久化在 context 之外。

**Anthropic Engineering「Effective harnesses for long-running agents」**（2025-11-26）
<https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents>

- agent 只能修改 feature list 里的 `passes` 字段，「It is unacceptable to remove or edit tests」。
- 选用 JSON，是因为模型「less likely to inappropriately change or overwrite」JSON。
- 这说明「不可变记录」需要靠格式或工具来强制。

**总结**：Anthropic 没有关于 ADR 本身的官方判定标准，即**没有「何时写 ADR」的官方指引**。官方只说明了决策信息应该放在哪里（CLAUDE.md 的简短条目、通过链接按需加载），以及 agent 如何保留决策（compaction、笔记文件）。

### 2.5 OpenAI（Codex）

**Codex docs「AGENTS.md」**
<https://learn.chatgpt.com/docs/agent-configuration/agents-md>（原 developers.openai.com/codex/guides/agents-md）

- 没有关于 ADR 或决策记录的指引。
- 最接近的一句是「Document public utilities in `docs/` when you change behavior.」
- 指令文件总大小上限 `project_doc_max_bytes` 默认为「32 KiB」。

**Cookbook「Using PLANS.md for multi-hour problem solving」**
<https://developers.openai.com/cookbook/articles/codex_exec_plans>

- **何时用**：「When writing complex features or significant refactors」时使用 ExecPlan。
- **Decision Log**：「Record every decision made while working on the plan」，格式为 `Decision / Rationale / Date/Author`。
- **可变性**：ExecPlan 是「living document」，可以改，但改动要在文末注明「the change and the reason why」。
- **自包含**：「Every ExecPlan must be fully self-contained.」

**「Harness engineering: leveraging Codex in an agent-first world」**
<https://openai.com/index/harness-engineering/>

- WebFetch 返回 403，以下内容来自 openai.com 域内检索摘要，**未能逐字核对**。
- 复杂工作写成 execution plan，「with progress and decision logs that are checked into the repository」，放在 `docs/exec-plans/{active,completed}`。
- AGENTS.md 只是约 100 行的索引，`docs/` 才是 system of record。
- 不在仓库里的知识（Google Docs、聊天记录、人的记忆）对 agent 来说等于不存在。

**总结**：OpenAI 没有 ADR 判定标准，即**没有「何时写 ADR」的官方指引**。它的做法是把决策记在**可变的** plan 内的 decision log 里。

### 2.6 参照：Nygard、adr.github.io、AWS

**Michael Nygard「Documenting Architecture Decisions」**（2011）
<https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions>

- **触发条件**：「architecturally significant」，即「affect the structure, non-functional characteristics, dependencies, interfaces, or construction techniques」。
- **章节**：Title / Context / Decision（「We will…」）/ Status / Consequences。Consequences 应包含「positive, negative, and neutral」三类。
- **篇幅**：「one or two pages long」。
- **编号**：「Numbers will not be reused.」
- **推翻决策时**：「keep the old one around, but mark it as superseded」。

**adr.github.io 与 MADR**
<https://adr.github.io/>、<https://adr.github.io/madr/>

- **定义**：AD 是「a justified design choice that addresses a functional or non-functional requirement」。
- **触发条件**：MADR 的说法很宽，「any decisions that might have an impact on the architecture somehow」。
- **章节**：Context and Problem Statement、Decision Drivers、**Considered Options**、Decision Outcome、Consequences、**Confirmation**、Pros and Cons。
- **元数据**：`decision-makers` / `consulted` / `informed`。
- **状态**：`proposed | rejected | accepted | deprecated | … | superseded by ADR-0123`。

**AWS Prescriptive Guidance「ADR process」**（标注：AWS）
<https://docs.aws.amazon.com/prescriptive-guidance/latest/architectural-decision-records/adr-process.html>

- **触发条件**：「every architecturally significant decision」，范围列为 Structure / NFR / Dependencies / Interfaces / Construction techniques。
- **谁决定**：每篇 ADR 有一个 owner，团队评审后决定接受、返工或拒绝。
- **被拒绝时**：「adds a reason for the rejection to prevent future discussions」。
- **被接受时**：加上时间戳、版本和 stakeholders 列表。
- **不可变**：「When the team accepts an ADR, it becomes immutable」，被拒绝的 ADR 同样不可变。
- **代码评审**：评审代码时要引用 ADR，违反 ADR 的改动应被打回。

## 3. 对比表

| 维度 | mdpro | Microsoft（WAF + Playbook） | Google（Cloud AC + SWE book） | Meta | Anthropic | OpenAI | 参照（Nygard / MADR / AWS） |
|---|---|---|---|---|---|---|---|
| 触发条件 | 难以撤回、约束后续工作、会被重新争论；问过用户的决策通常值得写 | 影响结构、关键质量属性或难以撤回 | 没有既有依据、有两个以上选项、方案没有记录在案 | 未找到 | 无 ADR 标准；CLAUDE.md 收录「project-specific architectural decisions」 | 无 ADR 标准；复杂功能或重大重构用 ExecPlan，计划中的所有决策都记入 log | 架构重要性：结构、NFR、依赖、接口、构建手段 |
| 谁决定 | 用户；Status 行引用原话 | 团队在 PR 中接受 | 团队；design doc 需批准 | 未找到 | 未涉及 | Date/Author 字段 | AWS：owner 加团队评审；MADR：decision-makers 字段 |
| 必备章节 | Status / Context / Decision / Consequences | 另加 **Options considered** 和**置信度** | 另加需求、CUJ、**key options** | 未找到 | 未涉及 | Decision / Rationale / Date | MADR 另加 **Considered Options** 和 Confirmation |
| 状态生命周期 | Proposed / Accepted / Superseded by / Deprecated | 同 mdpro（WAF 只是举例） | 未定义 | 未找到 | 未涉及 | 无（plan 是 living document） | MADR 和 AWS 另有 **Rejected** |
| 不可变与取代 | 已接受即不可变，取代时新写一篇；实践中存在部分取代 | append-only，取代时互相链接 | 写明前一个决策及变更原因；amendment 方式 | 未找到 | 用格式或工具强制不可编辑（JSON passes 示例） | 可变，但要注明改动原因 | Nygard / AWS 均为不可变；AWS 规定 Rejected 也不可变 |
| 与计划、规则的关系 | plan 和 rule 链接 ADR，冲突时以 ADR 为准 | 决策须能独立成立，设计细节用链接给出 | 存放在代码旁，可同步到 wiki | 未找到 | CLAUDE.md 只写短条目，长文档用链接 | AGENTS.md 作索引，`docs/` 作 system of record | AWS：代码评审时引用 ADR 把关 |
| 对 AI agent 的指引 | rule 70：编号须预留，提问走 delegator | 无 | 无 | 未找到 | 决策要放进仓库或 memory；compaction 会保留决策；必须遵守的规则用 hook | 不在仓库里的知识对 agent 不存在；decision log 随 plan 提交 | 无 |

## 4. 差异与建议

标 **[agent]** 的建议会改变在本仓库工作的 agent 的行为。

1. **触发条件：保持，并补一条。** mdpro 的「expensive to reverse / constrains later work / re-litigated」已经覆盖了 Microsoft 的「difficult to reverse」，比 Nygard 和 AWS 的五类清单更好执行。Google 有一条 mdpro 没有：「two or more engineering options」。

   建议在 consequential 定义后补一句：「…, or two or more viable options were weighed and the reasons would otherwise be lost.」**[agent]** 这会让 agent 在比较过多个方案后更倾向于写 ADR。

2. **「Options considered」章节：新增。** Microsoft、Google、MADR 和 Malte Ubl 都把备选方案列为必备内容，mdpro 只要求 Nygard 的四节，实际只有 14/76 篇写了备选方案。

   建议把结构改为：「Status → Context → **Options considered** (one line each, why rejected) → Decision → Consequences」。**[agent]** 写 ADR 的 agent 需要多写一节。

3. **`Rejected` 状态：新增。** MADR 和 AWS 都有这个状态，并要求写明拒绝理由「to prevent future discussions」，这正好对应 mdpro 自己定的「re-litigated」触发条件。现在被拒绝的提议在 mdpro 里没有合法状态，只能用「决定不做」的 Accepted 来表达。

   建议把状态枚举改为 `Proposed / Accepted / Rejected / Superseded by ADR-NNNN / Deprecated`。**[agent]**

4. **部分取代：修改，承认现有做法。** 0076 只取代了 0073 的一个条款，现行措辞「Superseded by ADR-NNNN」只覆盖整篇取代。

   建议补充：「A new ADR may supersede one named clause; the old ADR's status then reads `Accepted; clause X superseded by ADR-NNNN (date)`.」这样旧 ADR 的状态行仍然可以改，与 Microsoft 的「link the two together」一致。**[agent]**

5. **不可变规则的边界：修改。** 现行规则禁止修改已接受的 ADR，但取代时又要求修改旧 ADR 的 Status 行。Microsoft、AWS 和 Nygard 都允许这种修改。

   建议写明：「Immutable except the Status line and a forward link to the superseding ADR.」**[agent]** 能消除 agent 在这一点上的犹豫。

6. **「one page」：修改，二选一。** 76 篇中有 54 篇超过 80 行。Nygard 写的是「one or two pages」，Microsoft 写的是「pithy … avoid making decision records design guides」并把细节放在链接里。

   建议改为：「One or two pages; evidence and investigation go in a linked record (`docs/test/`, `docs/plans/`), not in the ADR.」也可以干脆删掉这条篇幅限制。**[agent]** 会影响 agent 写 ADR 的篇幅。

7. **谁决定：保持，并写成明文。** 在 Status 行引用用户原话是 mdpro 的独有做法，比 MADR 的 `decision-makers` 字段更强。不过目前只是惯例，没有写进规则。

   建议补充：「Status names who accepted it; a user decision quotes the user's words.」**[agent]**

8. **置信度：新增，可选。** 这是 Microsoft 独有的要求（「Record the confidence level」）。mdpro 有不少「accepting a known defect」类的 ADR，例如 0070 和 0075，标注低置信度可以给以后的复议留下依据。建议在 Consequences 末尾加一行可选的「Confidence: low/medium/high」。

9. **决策日志索引：新增。** Microsoft Playbook 用 `decision-log.md` 作索引，OpenAI 用 AGENTS.md 作 map，Anthropic 建议用链接按需加载。mdpro 有 76 篇 ADR，但没有索引，`AGENTS.md` 也没有提到 ADR。

   建议新增 `docs/adr/README.md`，列出编号、标题、状态以及取代关系，由 `pnpm ledger:check` 之类的脚本校验。同时在 AGENTS.md 里加一行指向它。**[agent]** Codex 和其他 agent 会因此读到 ADR。

10. **编号预留：保持。** rule 70 的中心化预留是 mdpro 针对多 session 环境的做法，各家都没有类似规定。Microsoft Playbook 建议用工作项 ID 编号来避免冲突，可以作为 delegator 不在线时的备选方案，但不必改变现行做法。

11. **与 plan 的关系：保持。** OpenAI 把决策记在可变的 plan decision log 里，与 mdpro「plan 链接 ADR、冲突时以 ADR 为准」的分层并不矛盾。plan 内的小决策可以照 OpenAI 的写法记在 plan 里，达到 consequential 标准时才升级为 ADR。现行的「Promote one to an ADR when it is next disputed…」已经覆盖这一点。

12. **代码评审中引用 ADR：新增，可选。** AWS 要求评审时引用 ADR 把关。建议在 rule 60 的检查清单中加一项：「Diff does not contradict an Accepted ADR; if it must, a superseding ADR lands first.」**[agent]**

## 5. 参考链接

- Microsoft WAF ADR：<https://learn.microsoft.com/en-us/azure/well-architected/architect-role/architecture-decision-record>
- Microsoft Code With Engineering Playbook，Decision Log：<https://microsoft.github.io/code-with-engineering-playbook/design/design-reviews/decision-log/>
- Google Cloud ADR overview：<https://docs.cloud.google.com/architecture/architecture-decision-records>
- Software Engineering at Google，第 10 章：<https://abseil.io/resources/swe-book/html/ch10.html>
- Malte Ubl，Design Docs at Google（个人博客）：<https://www.industrialempathy.com/posts/design-docs-at-google/>
- Claude Code Best practices：<https://code.claude.com/docs/en/best-practices>
- Claude Code Memory：<https://code.claude.com/docs/en/memory>
- Anthropic，Effective context engineering：<https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents>
- Anthropic，Effective harnesses for long-running agents：<https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents>
- Codex AGENTS.md：<https://learn.chatgpt.com/docs/agent-configuration/agents-md>
- OpenAI Cookbook，PLANS.md / ExecPlans：<https://developers.openai.com/cookbook/articles/codex_exec_plans>
- OpenAI，Harness engineering（返回 403，内容来自检索摘要）：<https://openai.com/index/harness-engineering/>
- Nygard，Documenting Architecture Decisions：<https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions>
- adr.github.io：<https://adr.github.io/>；MADR：<https://adr.github.io/madr/>
- AWS Prescriptive Guidance，ADR process：<https://docs.aws.amazon.com/prescriptive-guidance/latest/architectural-decision-records/adr-process.html>
- Meta：未找到官方来源。
