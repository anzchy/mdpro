# 用专有名词驱动搜索：在 mdpro 里像专业人士一样 vibe coding

**Date**: 2026-09-17
**Source**: 李笑来《AI 小白课》文稿中的"专有名词与搜索空间扩展词表"（`xiaolai-ai-course-2026/李笑来-AI小白课文稿-2026.md`）
**Method**: Claude（Fable 5.1）先给出一版，Codex（gpt-6-astra，只读模式）读仓库后逐条反驳，Claude 再对每条反驳回仓库核实。本文是核实之后的合成版，不是两份答案的拼接。
**Status**: Active

---

## 0. 一句话结论

**专业用法不是给需求贴术语，而是用术语改变调查顺序：先找调用链和反例，再决定改哪里，最后明确什么证据允许你宣布完成。**

词表里每个词都是一个"在下指令之前先问自己的问题"。外行把词写进需求里；专业人士把词变成三件事：**先查什么**、**用什么反例攻击**、**什么门禁通过才算完**。

---

## 1. 词表与 mdpro 现有结构的对应

mdpro 已经给词表里大部分词建好了物理落点。这张表是"该看哪个文件、该走哪条流程"的路由表。

| 词表里的词 | mdpro 里的落点 | 用它时你在做什么 |
|---|---|---|
| ADR、Trade-off、Real Options | `docs/adr/0001–0007` | 把"为什么这么选"写下来，防止以后被重新争论 |
| Feature Ledger | `docs/feature-ledger.md`、`pnpm ledger:check` | 用五个封闭状态词描述**当前**能力，Stub 不许冒充 Shipped |
| MoSCoW、Opportunity、JTBD | `docs/plans/` | 优先级和验收进计划，**不进账簿** |
| TDD、Edge Case、Test Coverage | `.claude/rules/10-tdd.md`、tdd-guardian 插件 | 先写会失败的测试，再实现 |
| Grill Yourself、Falsification | `tdd-spec-adversary` 代理 | 在实现之前攻击测试矩阵，找"能通过所有测试但仍然错"的实现 |
| CMT、"let codex weigh in" | codex-toolkit 插件；ADR-0003、ADR-0007 都用过 | 让第二个模型**拆穿前提**，而不是背书 |
| Hooks、Skills、Commands、CLAUDE.md | `.claude/hooks/refine_prompt.sh`、`.claude/skills/`、`.claude/commands/` | 把重复流程固化，不靠每次口头提醒 |
| Design Token、Hardcoded Magic Number | `.claude/rules/31-design-tokens.md` | 消灭散落的**视觉**数值；调度参数另当别论（见 §3） |
| MCP、Shadow Store | `src-tauri/src/services/shadow_store.rs`、`src/hooks/useMcpSync.ts` | 理解外部工具和编辑器之间的数据流 |
| Worktree、Spike、Rewrite | `.claude/worktrees/`，Agent 的 `isolation: worktree` | 在隔离目录里做时间盒实验，不污染主分支 |
| Unicode、ZWJ、CJK Boundary | `src/services/tocService.ts`、`src/plugins/milkdown/typoraKeymapPlugin.ts`、`tests/cjk-slug.test.ts` | 已有标题 slug 和 IME 保护；光标、删除、选区**未验证** |
| Reading Stamina | `pnpm-lock.yaml` 里的实际依赖版本 + 对应版本官方文档 | 查 API 契约，不用入门文章代替 |

---

## 2. 使用方法：三步把词变成动作

面对任何一个任务，先过一遍词表六个分区，每区挑一个词问"这次用得上吗"。用得上的词按下面三步展开：

1. **先查什么。** 这个词指向哪条调用链、哪个文件、哪份契约？在写任何代码之前先读它。
2. **用什么反例攻击。** 这个词对应的边缘情况是什么？写出具体输入，而不是"考虑边界"。
3. **什么门禁通过才算完。** 测试、账簿、ADR、真实 app 验收，各自证明什么，各自证明不了什么。

词表第六节的五问（是什么 / 为什么存在 / 什么时候想到 / 与谁相连 / 我还不知道什么）适合对**单个陌生词**做展开。上面三步适合对**一个任务**做展开。两者不冲突。

---

## 3. 六个落到 mdpro 上的案例

每个案例给出：真实落点、用了哪几个词、为什么是这几个、外行提法、可直接粘贴的指令、产出工件与门禁。

### 案例 A：自动保存，先定义不丢数据的时序，再谈重构

**真实落点**：`src/hooks/useAutoSave.ts`、`src-tauri/src/services/draft/mod.rs`、`tests/useAutoSave.test.ts`。

**现状**：前端用异步 `setInterval`，清理定时器不等于撤销已发出的请求；后端用原子重命名落盘，能避免半写文件，但不能单独证明并发请求按新旧顺序落盘。现有测试用 `readFileSync` 读源文件再 `toMatch(/clearInterval/)`，是源码正则测试，没有跑过一次真正的保存生命周期。

**用词**：Constraints + Edge Case + TDD。目标是保存时序正确；JTBD 或 Design Token 回答不了"哪个请求最后生效"。

**关于两个 `5000`**：第 19 行是最小周期下限，第 27 行是距上次保存的容差。它们是调度参数，不是视觉 token。数值相同但语义不同，合并成一个常量反而引入错误。正确做法是先解释各自语义，再决定命名或删除。

**外行提法**："把自动保存写得更健壮，顺便去掉魔法数字。"

**可直接粘贴**：

```text
审计 mdpro 的草稿保存生命周期，先证明风险，不预设需要重写。

从 src/hooks/useAutoSave.ts 追到 save_draft、草稿落盘、
useDocument.ts 的手动保存清理和文档关闭路径。
画出定时触发、请求发出、落盘、删除草稿的时序。

明确并验证：
1. 关闭文档后不再发起新的自动保存；
2. 已在途请求与关闭、手动保存清理如何协调；
3. 同一文档旧内容不能覆盖已保存的新内容；
4. A/B 文档切换时计时状态是否互相影响。

先用 renderHook、假定时器和可控 Promise 替换现有源码正则式测试，
复现实际生产路径可能出现的交错；不要只制造一个 mock 里的竞争。
若前端测试不足以证明落盘顺序，补 Rust 边界测试。

两个 5000 分别说明用途，确认语义后再决定命名或删除。
仅修复已复现的问题；记录没有证明的部分。
```

**工件与门禁**：
- 行为测试、必要的最小修复、保存时序说明；改变既有能力时更新原账簿行。
- 回归测试必须修复前失败、修复后通过；`pnpm test:run`、`pnpm build`。
- Rust 改动补 `cargo test` 和 `cargo check`；涉及恢复行为，还要在 app 里验证恢复结果。

### 案例 B：MCP 同步，区分"线程安全"和"数据够新"

**真实落点**：`src/hooks/useMcpSync.ts`、`src-tauri/src/services/shadow_store.rs`。

**现状**（已核实）：`useMcpSync.ts` 的内容变化检测只拼接 `id:content.length:isModified`，等长替换（`abc` 改成 `xyz`）会被跳过；`lastSyncRef` 在同步成功之前就被更新。后端用 Mutex 保护访问，但 Mutex 只能保护一次操作，不能表达"这个快照是否比之前更新"。

**用词**：Mental Model + Falsification + MCP + E2E。先构建同步模型，再攻击它；不能因为用了 Mutex 就直接开始加更多锁。

**外行提法**："MCP 偶尔不同步，把 debounce 调小。"

**可直接粘贴**：

```text
检查 mdpro 从编辑器到 MCP 读取结果的完整数据链。
先列出编辑器、documentStore、useMcpSync、Rust shadow store
各自保存什么状态，以及什么事件推动状态前进。

用以下反例攻击"编辑后最终能读到最新内容"的判断：
- 文档已 dirty 且上一轮同步完成，abc 改成 xyz，长度不变；
- IPC 同步失败后，内容保持不变，再调用 syncNow；
- 若生产路径允许请求交错，旧快照晚于新快照到达；
- 关闭文档与待发送快照交错。

优先写前两个 hook 行为测试，确认 contentHash 和 lastSyncRef
是否会抑制必要同步。沿调用链排查其他触发器，避免把局部遗漏
误报为整个系统永久不同步。

比较最小修复与引入 revision 的方案。
只有证明存在跨请求顺序问题，才讨论修改 IPC 契约。
最后从真实 MCP 客户端读取，核对内容，而不只检查事件被发出。
```

**工件与门禁**：
- 状态传播图、失败场景测试、修复；若改变 IPC 契约，新增 ADR。
- 前端测试和构建；涉及 Rust 时运行对应测试与检查。
- E2E 必须核对客户端读到的正文。单元测试通过不等于 MCP 闭环通过。

### 案例 C：表格性能，用隔离实验决定局部重写

**真实落点**：`src/utils/cursorSync/table.ts`、`docs/adr/0007-table-scanner-emits-non-overlapping-models.md`、`tests/table-scan-scaling.test.ts`。

**现状**：`findAllTables` 逐位置调用 `parseTableAt`，一个损坏的表头让扫描退化到逐行探测。ADR-0007 的价值不只是"找到了反例"：它承认给 Codex 的一个成本前提是错的，限定了批准的行为变化，采用两层测试判据，并把 `end + 1` 问题留给独立工作项。**CMT 的价值是拆穿前提，不是让第二个模型背书。** 截至本文写作，ADR-0007 和 scaling 测试尚未纳入 git 跟踪，文档里的 Accepted 不等于实现已交付。

**用词**：Worktree + Spike + Rewrite + Falsification。这里要比较算法和兼容性；单纯列 Trade-off 无法证明性能收益。

**Decision Map**（Situation → Decision → Reason → Expected Outcome）：

> 损坏表格触发重复全量扫描 → 局部替换扫描调度 → 消费者接口可保留且差异可限定 → 在批准例外内改变结果，同时降低随规模增长的成本。

**外行提法**："大表格卡，重写解析器，保持行为完全一致。"

**可直接粘贴**：

```text
为 findAllTables 做一个时间盒 90 分钟的隔离 spike，不直接合并。

先检查 git status。ADR-0007 和 scaling 测试可能未跟踪，
新 worktree 不会自动包含它们；记录基线 commit 和必要文件的内容摘要，
显式带入实验所需文件，不移动、清理或覆盖原工作区。

比较：
A. 保持逐位置扫描，减少重复计算；
B. 只替换扫描调度，按候选区间探测。
保持消费者接口不变。

遵守 ADR-0007：
例外类之外与冻结旧实现逐项相等；
例外类之内分别断言旧输出、新输出、模型互不重叠、
tableIndex 和光标往返，不允许简单跳过差异。
本实验不顺手修 end + 1。

用正常表格、删坏表头、删坏分隔行和递增规模比较。
记录增长曲线与绝对耗时；Node 结果不能替代 macOS WKWebView 验收。
时间到后交付继续修补/局部重写/证据不足的结论与退出条件，
不因原型已经写好就合并。
```

**工件与门禁**：
- 隔离原型、可复现基准、兼容性矩阵、决策记录。
- 两层判据、已有光标同步回归、构建，以及目标运行时性能验收。
- 保留 ADR-0007；若要推翻其中决策，写新 ADR，不修改 Accepted 历史。

### 案例 D：Unicode，从搜索关键词转向操作矩阵

**真实落点**：`src/services/tocService.ts`（`\p{L}\p{N}` 属性正则）、`src/plugins/milkdown/typoraKeymapPlugin.ts`（`view.composing` 保护）、`tests/cjk-slug.test.ts`。

**这个案例先记录一次失误。** Claude 第一版说"`src/` 里没有任何 CJK 处理代码"，这个结论来自一条在 zsh 里根本没有执行成功的 grep（`--include=*.ts` 被当成通配符报错），命令报错被误读成零命中。Codex 读仓库后指出上面三个落点。教训直接对应 §5 反模式第二条：**用搜索缺席证明功能缺席**。

**真正的未知**：已有标题 slug 和 IME 防护，不能外推为"Unicode 支持完整"。光标移动、退格、选区、两种模式往返在组合字符和 ZWJ emoji 上的行为没有被验证过。

**用词**：Unicode + ZWJ + Reading Stamina + E2E。前两个生成具体输入，后两个决定如何查证依赖与真实行为。此时直接引入分词库过早。

**外行提法**："增加 Unicode 支持，把字符处理全部换成 Array.from。"

**可直接粘贴**：

```text
为 mdpro 做一次 Unicode 编辑能力审计，先不增加自定义分词代码。

读取锁文件中的实际 CodeMirror/ProseMirror/Milkdown 版本，
追踪光标、删除、选区、模式切换涉及的坐标单位与转换。
只在具体契约不明确时查对应版本官方文档，记录章节、原文结论
和它在本项目的调用位置；不要用一篇 Unicode 入门文章代替 API 契约。

建立输入×操作矩阵：
输入包括中文无空格文本、e 加组合重音、家庭 ZWJ emoji、旗帜 emoji；
操作包括左右移动、退格、选择替换、IME 确认、两种模式往返。
先记录预期，区分 code unit、code point 与用户看到的字符。

保留已有 CJK slug 测试作为独立能力证据。
在 macOS app 两种编辑模式中执行矩阵；
未执行或依赖行为不明的格标为未验证。
只对已复现缺陷补回归与最小修复。
```

**工件与门禁**：
- 版本化契约摘录、操作矩阵、复现材料、必要的回归测试。
- 纯转换逻辑用自动测试验证；IME 与光标行为用真实 app 验收。
- 更新账簿时遵守五值枚举；不能把整个 Unicode 能力一概升级为 `Shipped`。

### 案例 E：把账簿维护固化，先做可独立运行的门禁，再接自动化

**真实落点**：`scripts/ledger/check.mjs`、`tests/tooling/feature-ledger.test.ts`、`CLAUDE.md` 的 Feature Ledger 段落。

**现状**（已核实）：检查器只验证声明名在 Markdown 中"某处出现"，不证明对应能力行准确。账簿第 149 行说"MCP 驱动的表格编辑 Shipped"，第 231 行说"任何 AI 客户端都无法通过 MCP 走到表格操作"。两行互相矛盾，门禁抓不到。

**用词**：Feature Ledger + Commands + Hooks + Skills。这四个词用于分配职责：机器检查、显式执行、生命周期触发、人工核实说明，四者不能互相冒充。

**外行提法**："写一个强大的 hook，每次提示词都自动检查所有规范。"

**可直接粘贴**：

```text
设计 mdpro 账簿维护的可重复工作流，先交付仓库脚本与说明，
不修改现有 hook。

读取 scripts/ledger/check.mjs、parse.mjs、declared.mjs，
区分现有检查真正保证什么、仅提示什么、完全无法证明什么。
先核对账簿中表格编辑的 MCP/HTTP 两种入口表述，
沿 mdpro_mcp.rs 的工具注册追到 HTTP 路由与前端处理器。

设计三层职责：
- Command：明确运行检查，输出稳定结果和退出码；
- Hook：将来只调用同一个 command，不复制检查逻辑；
- Skill：将来指导人工核实行为、记录限制，不负责自动判定 Shipped。

先为脚本准备有效账簿、非法状态、缺失路径、漏登记声明、
检查执行失败等夹具，验证失败不会变成绿色通过。
说明当前仅按名字出现判断覆盖的局限，不伪称已实现能力级映射。

本次不接入 hook；提供后续接入所需的触发条件与退出码契约。
不要把耗时全量检查默认放进每次 UserPromptSubmit。
```

**工件与门禁**：
- 可独立运行的检查入口、夹具测试、自动化接入说明；必要的账簿措辞修正。
- 新检查应先对坏夹具失败，再对好夹具通过。
- `pnpm ledger:check`；账簿修改后 `pnpm ledger:build`；代码变化跑测试和构建。
- **脚本成功执行、hook 成功触发、行为确实可用，是三个不同的验收项。**

### 案例 F：架构决策，用 Trade-off + Real Options + ADR + CMT

**真实落点**：`CLAUDE.md` 的 Typora-Parity Phase 1 段落（Milkdown 数学公式渲染推迟到 Phase 2）、`docs/adr/`。

**用词**：Trade-off + Real Options + ADR + CMT。"要不要现在建"正是实物期权的场景：先保留选择权，等新信息再加大投入。

**外行提法**："把数学公式渲染加到 WYSIWYG 里。"

**可直接粘贴**：

```text
Milkdown 的 $…$ 数学渲染目前被推迟到 Phase 2。请按 ADR 格式
（Status / Context / Decision / Consequences）起草 docs/adr/0008：
- 至少三个候选：现在做 / 等 Phase 2 / 永远只在导出做。
- Context 只写当时已知的事实，不写事后诸葛。
- Consequences 必须写代价和被关闭的路径，不许只写好处。
- 起草完成后 let codex weigh in：让它专门找 Context 里
  被当成事实的"惯例"，以及被两个模型共同默认的前提。
```

**工件与门禁**：
- 一份 Proposed 状态的 ADR。Accepted 之后不可修改，改主意写新 ADR 并 supersede。
- Codex 的意见是输入不是裁决；两个模型一致不等于前提正确（ADR-0007 的教训）。

---

## 4. 两版答案的分工

| | Claude 第一版 | Codex 版 |
|---|---|---|
| 形态 | "词表到项目落点"的路由表 | "用词改变调查顺序"的操作方法 |
| 适合 | 入门时知道该看哪个文件 | 动手前知道先查什么、用什么反例、什么门禁算完 |
| 弱点 | 有一处结论建立在失败的命令上；把调度参数误归为 Design Token；把 MoSCoW 混进账簿 | 未读 `refine_prompt.sh` 和 tdd-guardian 实现，案例 E 对现有 hook 不作评价 |

两者都保留在本文里。§1 来自第一版并按 Codex 纠正修订，§3 案例 A 到 E 来自 Codex 并经仓库核实，案例 F 来自第一版。

---

## 5. 反模式：用了这些词但仍然是外行做法

- **术语堆砌代替问题定义。** "用 JTBD、TDD、CMT 优化架构"，却没有指定要保护的行为、失败样例和停止条件。
- **用搜索缺席证明功能缺席。** 没搜到关键词就加实现；忽略依赖、别名、调用链和真实操作。本文案例 D 就是一次现场示范。
- **让第二个模型投票。** 两个模型共享同一个错误前提，再把一致意见写成 ADR。ADR-0007 已展示这种风险。
- **把门禁绿色当业务正确。** 正则发现 `clearInterval` 不证明关闭安全；账簿路径存在不证明功能可用；Mutex 存在不证明数据最新。
- **让试验和自动化扩大权限。** Spike 写完直接合并，Worktree 当作运行环境隔离，或 hook 自动把能力标成 `Shipped`，都跳过了本来要建立的证据链。
- **把优先级写进状态列。** `Must` 是 MoSCoW 的优先级，`Shipped` 是账簿的当前状态。两者进不同文件。

---

## 6. 把它变成日常动作

- **写指令前先过一遍词表六个分区**，每区挑一个词问"这次用得上吗"，然后按 §2 三步展开。
- **每次 `AskUserQuestion` 级别的决定都值一份 ADR**。词表里的 Trade-off、Opportunity Cost 就是 Consequences 该写的内容。
- **用过三次的指令固化成 `.claude/commands/` 里的一条命令**。Command 先于 Hook，Hook 只调用 Command。
- **每季度把词表当 Unknown Unknown 探测器重跑一遍**，但只把它当线索：命中说明有落点，不命中不说明没有。
- **让 Codex 复核时，明确要它找前提而不是找错字**。指令里写"找 Context 里被当成事实的惯例"。

---

## 附：本文核实过的仓库事实（2026-09-17）

| 说法 | 核实方式 | 结果 |
|---|---|---|
| `tocService.ts` 有 Unicode 属性正则 | grep `\p{` | 第 104 行命中 |
| `typoraKeymapPlugin.ts` 有 IME 保护 | grep `composing` | 第 140 行命中 |
| `useAutoSave.test.ts` 是源码正则测试 | 读文件 | 第 13 行 `readFileSync`，第 28 行起 `toMatch` |
| `useMcpSync.ts` 变更检测只看长度 | 读文件 | 第 139 行 |
| ADR-0007 未纳入 git | `git ls-files` | 未跟踪 |
| 账簿 MCP 表格编辑两行矛盾 | grep | 第 149 行 Shipped，第 231 行说 MCP 走不到 |
| 两个 `5000` 语义不同 | 读文件 | 第 19 行下限，第 27 行容差 |
