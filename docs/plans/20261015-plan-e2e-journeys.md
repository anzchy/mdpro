# Plan：固定的 e2e 旅程（e2e journeys），覆盖 macOS 与 Windows，并映射到 feature ledger

- **Opened**：2026-10-15，adr047-verify 起草（delegator 转达用户原话：「关于test fixture/ e2e journey，采纳vmark的思路，看看如何给本project设定e2e journey，同时涵盖各个platform(MacOS/Windows), make a comprehensive plan and save it to docs/plan in md，这个让adr047-verify session去draft plan」）
- **Base**：`master` `1cea653`
- **Status**：⬜ 草案，待用户审定。本计划不改 `src/`、`tests/`；每个工作项落地时再按 rule 70 领取范围
- **上游**：[ADR-0047](../adr/0047-agents-verify-in-the-real-app-through-a-feature-gated-control-channel.md)（Proposed）与 [控制通道计划](20261002-plan-agent-control-channel.md)；[ADR-0100](../adr/0100-the-s2-negative-control-is-a-minimal-confirmdialog-patch.md)；ADR-0089（ledger 的 Windows 差异表）
- **起因**：用户 2026-10-15 问 codex-audit：「当前的Windows和Mac端 device test，每次都是random生成的，我需要固定一组fixture，涵盖App主要的快捷键和各种功能，随着迭代开发，不断完善，fixture需与 feature-ledger 尽量映射，当然有的feature不一定需要UI test。」（[Q&A](../reference/user-question-and-answer.md) 2026-10-15 条）

证据分级沿用控制通道计划：`[实测 …]` 是这次读过的文件或数据，`[推断]` 是推理，未在设备上跑过。

## §0 审核先看（需要用户定的）

| # | 问题 | 推荐 | 备选 |
|---|---|---|---|
| Q1 | 旅程用什么形式写 | **一旅程一个 Markdown 文件，顶部 YAML frontmatter 给机器读，正文步骤表给 agent 和人读**（§4.1）。今天跑设备检查的是 agent（dtrack 的 computer use、Windows 的 SSH 驱动），它们读 brief；等 ADR-0047 的 CLI 存在后，同一文件的 frontmatter 和步骤表也能被执行器读 | VMark 式的 `.mjs` 可执行模块：要等一个能执行它的驱动，mdpro 现在没有（`control-channel` feature 还不存在 `[实测 src-tauri/Cargo.toml]`） |
| Q2 | ledger 怎么引用旅程 | **在「怎么确认」格里加一个 `旅程：EJ-NNN` 或 `无 UI 旅程：<理由>` 标记**，由 `ledger:check` 新增一项检查强制，迁移期用 backlog 块（§4.5） | 给 ledger 加一列：185 行 inventory 加 12 张 Windows 表全部改形，代价大 |
| Q3 | Tier-0 对应测试要不要和旅程共用同一份期望字节 | **要**：旅程的 golden 输出文件也是 Tier-0 的断言来源，双向引用由门禁检查（§4.3） | VMark 式注释链接：它自己的链接已经漂移 `[实测 vmark README 与 ledger]` |
| Q4 | 是否在托管 CI 上跑真机旅程 | **不跑**（§9）。真机旅程在 mini 和 win-desktop 上按 tier 跑；CI 只跑 Tier-0 和门禁 | 加 macOS/Windows 托管 runner：没有控制通道时驱动不了 WebView，且 rule 70 已有设备批次流程 |

需要的 ADR 见 §5.2，编号向 delegator 申请，本计划不预留。

## §1 Outcomes

1. **一套固定、带版本的旅程目录**：每条旅程有永不复用的 id、固定 fixture、macOS 与 Windows 两栏平台状态、步骤、日志行与磁盘字节的期望、以及它证明的 ledger 行。
2. **一套固定的 fixture 语料**，在仓库里、有版本；大文件用生成脚本；每个产出文件有 golden 期望。
3. **每条旅程有一个 Tier-0 对应测试**（jsdom 或 node），每次提交都跑，和旅程用同一份期望。
4. **ledger 的每个 `Shipped` 行**（以及 Windows 表里的 `Shipped`）要么引用一条旅程，要么写明「无 UI 旅程」的理由；门禁检查。
5. **分层运行**：每个 RC 跑 smoke，发版前跑 full，D 项跑定向子集；每次运行留一份按旅程逐条判定的记录。
6. **今天的 ad-hoc brief 逐步变成「在某个构建上跑某个 tier」**，brief 只剩构建身份和 tier 之外的临时项。
7. **旅程坐在 ADR-0047 控制通道之上，不重做它**：通道就绪后，执行器读同一份旅程文件；在那之前，旅程由现有驱动执行。

## §2 Constraints

- rule 70：只有 real-device-tester（dtrack）在 mini 上跑 GUI；Windows 走 `remote-windows-device-test`；设备检查按区域成批（6–10 项或约 45 分钟），每项写失败条件、必须到达的代码路径和证明它的日志行；没到达路径的记「未执行」不记通过。
- rule 10：前端测试只能放在 `tests/` 下；DOM-free 文件声明 node 环境（ADR-0049）；≥2 s 的放 `*.slow.test.ts`（ADR-0050）。
- CLAUDE.md § Manual test fixtures：手工 fixture 在 `tests/manual-fixtures/`，运行时用副本。本计划新增的旅程 fixture 有自己的目录（§4.2），这条规则要相应补一句（WI-E2E-2）。
- ledger 的状态枚举封闭；`Partial` 必须带 `限制：`；Windows 未验证必须写 `Unknown`（ADR-0089）。
- 日志是 JSONL（`~/.mdpro/mdpro.log`），事件命名见 CLAUDE.md § Logging Rules。这是 mdpro 相对 VMark 的优势：VMark 的旅程不用日志做判据 `[实测 vmark e2e/README.md]`。
- 不预留 ADR / D 编号；落地走 rule 70（分支、verifier、审计、CI）。

## §3 Current Behavior Inventory

### 3.1 mdpro 今天怎么做设备检查 `[实测，见各路径]`

| 项 | 现状 |
|---|---|
| ledger | `docs/feature-ledger.md`：inventory 185 行（Shipped 80 / Partial 63 / Stub 13 / Absent 28 / Unknown 1），12 张「Windows 差异」表 107 行（Unknown 99）。「怎么确认」格写动作、IPC 路径、日志行与真机日期，但**不引用任何测试或旅程 id** |
| `ledger:check` | `scripts/ledger/check.mjs`：表结构、状态枚举、`限制：`、路径可解析、Windows 差异表四项、声明面覆盖（command / route / `MENU_*` / plugin id / store 只需在文中出现）；CI 的 `prose-checks` 跑它 |
| 手工 fixture | `tests/manual-fixtures/` 29 个 `<id>-<slug>.md` + `img/`；`scripts/manual-fixtures/generate-large.mjs` 生成多 MB 文件并 `--check` sha256 |
| macOS 驱动 | `gui-acceptance`（computer use，字节偏移读日志，PASS / FAIL / partial / NOT VERIFIED）；`gui-manual-verify`（人在回路）；dtrack 按 delegator 的 brief 跑 |
| Windows 驱动 | `remote-windows-device-test`：全 SSH，页面输入走 WebView2 DevTools 9222 端口，原生输入（菜单、组合键、文件对话框、截图）走桌面会话里的 PowerShell 驱动；判定需同 run 同路径的对照 |
| 快捷键矩阵 | brief `docs/pending/20261014-brief-shortcuts-matrix.md`（未跟踪，只在主检出）：Settings 页 49 项，路由 M/H/P/C，对照 CM-M/CM-H/CM-P/CM-C，模式 W/S，用例 F1–F7、E1–E11、P1–P17、T1–T8、V1–V6。macOS 记录 86 例 + 8 次对照；Windows 记录与 v0.3.4 Windows 重跑逐行对比 |
| ADR-0047 旅程 | `docs/test/20261002-adr0047-journeys.md`：J1a、J1b、J2、J3、J4a、J4b、J5、J6、J7a、J7b；步骤类别 `cli` / `launcher` / `native` / `human`；「语义投影」比较规则 |
| 控制通道 | WI-000–004 已落地（WI-004 `9940be9`）；WI-005 构建已备、人工基线待排；WI-006–012 未开始；`control-channel` feature 尚不存在 |
| CI | `ci.yml`：PR 上跑 ledger、`pnpm test:run`、cargo，Ubuntu 为主，tag 加 macOS；**没有 Windows 测试** |
| 记录 | `docs/test/` 65 份记录 + 5 个 `windows-audit-*` 证据目录；brief 在 `docs/pending/`，D215 起不跟踪 |

问题：每次设备检查的步骤和 fixture 由写 brief 的人临时定，同一功能两次检查不可比；ledger 的「怎么确认」是散文，没有机器能核对的链接；Windows 一侧几乎全是 Unknown。

### 3.2 VMark 怎么做 `[实测 xiaolai/vmark@main，经 gh api 读]`

- **旅程**：`e2e/journeys/NN-slug.mjs`，`export default { name, run(client, ctx) }`，可选 `coverageRequired`、`platforms`。47 个文件，编号 01–48 缺 26，README 原话：「numbers are never reused: there is no `26-*` … No journey file has ever been deleted」（`e2e/README.md:24-28`）。返回 `{skip}` 为 SKIP，抛错为 FAIL，`platforms` 不含当前平台为 `N/A`（不算覆盖丢失）；`coverageRequired` 的旅程 SKIP 会让整轮变红（`e2e/run-journeys.mjs:156-260`）。
- **判据**：经 `execute_js` 读 DOM；磁盘字节整块比较；`poll` 不用固定 sleep；失败截图；最后核对标签栏恢复原状。**不用日志做判据。**
- **驱动**：第三方 `tauri-plugin-mcp-bridge`，只在 debug 构建、`127.0.0.1:9323`、WebSocket、无鉴权（`src-tauri/src/app_plugins.rs:126-170`）。
- **Tier-0**：`src/test/tier0/*.test.ts(x)` 13 套，真实 store 与服务、只假 `@tauri-apps/*`（有状态的内存 fs），断言假磁盘上的字节；每个 PR 跑。与旅程的链接只靠注释，部分单向。
- **ledger**：`.claude/feature-ledger.md` 的块在 `tests:` 字段里写 `e2e e2e/journeys/10-save-to-disk.mjs`；门禁 `scripts/check-feature-map.mjs` 只查路径存在；Tier-0 从不被 ledger 引用。
- **调度**：`tier0-e2e.yml` 每周一 cron + 手动，Ubuntu 与 macOS 矩阵，跑全部旅程；失败开一个滚动 issue；`check-gate-liveness.mjs` 防止定时门禁悄悄停跑（因为上线头五天一次都没跑过）。
- **短板**：ledger 写「38 个旅程」实际 47 个，门禁看不出来；没有 Windows；原生对话框不驱动；只覆盖 debug 构建；fixture 运行时生成、不入版本；周跑。

### 3.3 取舍

| 采纳 | 理由 |
|---|---|
| 永不复用的编号、文件从不删除（退役写 `retired`） | 记录和 ledger 里的引用永远指得回去 |
| 每条旅程有 Tier-0 对应测试，每次提交跑 | 真机贵，回归要在提交时就抓住 |
| `coverageRequired` 与 `N/A` 区分 | 平台不适用不算覆盖丢失；必须跑的旅程跳过要变红 |
| 整块字节比较、poll 不 sleep、运行后恢复状态 | 判据可复现 |
| 门禁 + 存活检查 | 防止目录、ledger 与实际脱节 |

| 不采纳或改进 | 理由 |
|---|---|
| fixture 运行时生成 → **入版本的 fixture + golden 期望** | 用户要「固定一组 fixture」；golden 让 Tier-0 和旅程共用一份期望 |
| 注释链接 → **frontmatter 字段 + 双向门禁** | VMark 的链接已漂移 |
| 只查路径存在 → **查双向一致**：ledger 行引用的旅程，其 frontmatter 也要指回这一行 | 堵住「ledger 写 38、实际 47」那类漂移 |
| 不用日志 → **日志行是一等判据** | mdpro 有结构化 JSONL 日志，rule 70 本来就要求每项给出证明路径的日志行 |
| 只 debug 构建 → **release 包也跑 smoke** | mdpro 的发版门禁本来就在 release 包上做 |
| 托管 CI 周跑 → **按 RC / 发版 / D 项在自有设备上跑** | 见 Q4 |
| 无 Windows → **每条旅程有 macOS 与 Windows 两栏** | 用户要求 |

## §4 Target Rules

### 4.1 旅程格式

文件 `tests/journeys/EJ-NNN-<slug>.md`。`EJ`（e2e journey）区别于 ADR-0047 的 `J1a…J7b` 与快捷键矩阵的 `F1…E11`；三位数字，**按发放顺序，永不复用，文件永不删除**。退役的旅程保留文件，frontmatter 写 `status: retired` 和原因。

```yaml
---
id: EJ-012
title: Save keeps the bytes and clears the dirty marker
status: active            # active | draft | retired
area: 文件                 # ledger 的区域标题
ledger:                   # 它证明的 ledger 行，用「能力」格原文
  - 保存
tier: [smoke, full]       # smoke | full | targeted
platforms:
  macos:   { status: required }
  windows: { status: required }
  # status: required | optional | n/a；n/a 必须带 reason
fixtures: [save-basic]    # tests/journeys/fixtures/<id>/
tier0: tests/journeys/tier0/EJ-012-save.test.ts
supersedes: []            # 旧 id（如 shortcut 矩阵的 F4、ADR-0047 的 J4b）
---
```

正文：

| 节 | 内容 |
|---|---|
| Why | 这条旅程证明什么，为什么 jsdom 证明不了 |
| Setup | 预置偏好、打开哪个 fixture 副本、窗口与模式 |
| Steps | 表格：`# · 类别 · 动作 · macOS 输入 · Windows 输入 · 期望日志行 · 期望状态`。类别沿用 ADR-0047 的 `cli` / `native` / `human`，加上 `page`（可经 DevTools 或驱动在页面里做） |
| Oracle | 判据：日志行（事件名、status、context 的必要字段，按 §4.4 归一化）；磁盘字节与 `expected/` 下的 golden 文件整块相等；状态（标签、模式、对话框是否在） |
| Controls | 同 run 的对照（沿用 CM-M/CM-H/CM-P/CM-C 的思路）：对照不过，该旅程记「未执行」 |
| Failure condition | 一句话，写明 FAIL 是什么，而不是「看起来不对」 |
| Cleanup | 恢复到启动状态；运行后核对 |

一条旅程可以带多个**用例**（case），用例 id 写成 `EJ-030/F2`，保留快捷键矩阵已有的 F1…E11，记录逐用例判定。用例也永不复用。

判定词汇（统一 macOS 与 Windows 现有两套）：`PASS` / `FAIL` / `未执行`（没到达路径或对照不过）/ `N/A`（平台不适用，frontmatter 已声明）/ `BLOCKED`（环境问题，带原因）。`FAIL (no binding)` 这类细分写在用例备注里。

### 4.2 fixture 语料

- 目录 `tests/journeys/fixtures/<fixture-id>/`：输入文件，以及 `expected/` 下每条旅程产出的 golden 文件（文件名带旅程 id）。
- 每个目录有 `fixture.json`：用途、哪些旅程用它、每个文件的 sha256。门禁核对 sha256 与引用。
- 大文件（多 MB）不入库，入库的是生成脚本：扩展现有的 `scripts/manual-fixtures/generate-large.mjs` 或同构的 `scripts/journeys/generate.mjs`，`--check` 校验 sha256。
- 运行时永远用副本（与 CLAUDE.md 现行规则相同）：macOS 复制到 `$S`，Windows 复制到驱动的 scratch 目录。
- 换行：fixture 在仓库里是 LF（`.gitattributes`）；需要 CRLF 的 fixture 由生成脚本产出，不入库，避免被 git 归一化。
- `tests/manual-fixtures/` 保留给一次性的 D 检查；一个 manual fixture 被两条以上检查复用时，搬进旅程语料。

### 4.3 Tier-0 对应测试

- 位置 `tests/journeys/tier0/EJ-NNN-<slug>.test.ts(x)`（在 vitest 的 `tests/**` 范围内，rule 10 允许）。
- 首行注释 `// Tier-0 for EJ-NNN`；旅程 frontmatter 的 `tier0:` 指向它。**门禁双向核对。**
- 读同一个 fixture，断言同一份 `expected/` golden 字节，以及同一组日志事件（经 `loggingService` 边界的 mock 记录）。只在边界 mock（Tauri `invoke` / event、fs），不 mock 被测逻辑（rule 10 反模式）。
- 原生菜单、原生对话框、IME、窗口焦点这类 jsdom 到不了的部分，Tier-0 从 `menu:action` 事件或对应的 Rust 命令开始；Rust 一侧的同类断言写成 `cargo test`（例如 D217 的 `window_focus` 测试）。旅程的 Why 一节写明 Tier-0 覆盖到哪一步为止。
- 每次提交跑（`unit` 与 `rust` lane 不变）；超过 2 s 的放 `*.slow.test.ts`。

### 4.4 判据：日志与字节

- 日志判据复用 ADR-0047 旅程文档的「语义投影」：只看白名单事件和任何 fail / warn / error 行；去掉时间戳、耗时、pid、几何；窗口标签、路径映射成 `W1/W2`、`D1`、`<RUN>`；同事件的字段要相等；顺序只在代码保证的地方比；次数精确（`draft.write` 至少一次）。
- 期望日志行在步骤表里写成 `event {status, 关键 context}`，与今天 brief 的写法一致，便于迁移。
- 字节判据：与 golden 整块相等（包括末尾换行）；不允许子串匹配（VMark 的 autosave 旅程仍是子串比较，其 README 自己点出了这一点（`e2e/README.md:80-82`））。
- 截图只作辅助证据，不作判据（mdpro 不做像素比对，见 §9）。

### 4.5 ledger 映射与门禁

- 每个 `Shipped` 行（inventory 与 Windows 差异表）的「怎么确认」格必须含 `旅程：EJ-NNN[, EJ-MMM]`，或 `无 UI 旅程：<理由>`（例如纯导出格式、只有 Rust 内部效果、由 Tier-0 完整覆盖）。`Partial` 行建议引用，不强制。
- `ledger:check` 新增 `checkJourneyCoverage`：
  1. 引用的 `EJ-NNN` 存在且 `status: active`；
  2. 该旅程 frontmatter 的 `ledger:` 列表含这一行的「能力」原文（双向）；
  3. Windows 表的 `Shipped` 行所引用的旅程，其 `platforms.windows.status` 不是 `n/a`；
  4. 迁移期：`<!-- ledger:journey-backlog -->` 块里列出的行暂时豁免，按「hollow pass」报数（与现有 `coverage-backlog` 同一机制），数字只降不升。
- 新增 `pnpm journeys:check`（`scripts/journeys/check.mjs`），进 CI `prose-checks`：frontmatter schema、id 唯一且登记在 `tests/journeys/REGISTRY.md`（只增不删：CI 对比 merge-base 的版本，删行即失败）、fixture 与 golden 的 sha256、Tier-0 文件存在且首行指回、`supersedes` 指向的旧 id 不再被别处引用为现行。
- 运行存活：`journeys:check --freshness` 读 `docs/test/` 的运行记录，报告每条 `smoke` 旅程在每个平台上最近一次 PASS 的构建；超过两个已发布版本没有 PASS 的列为警告。先只警告，不阻塞（WI-E2E-8 再定）。

### 4.6 分层与运行

| Tier | 何时 | 范围 | 平台 | 谁跑 |
|---|---|---|---|---|
| T0 | 每次提交 | 全部 Tier-0 对应测试 | CI（Ubuntu）与本机 | lane |
| smoke | 每个 RC 锁定的 SHA；release 包 | 约 10 条，覆盖每个区域的主路径（目标 ≤45 分钟/平台，符合 rule 70 批次上限） | macOS + Windows | dtrack；Windows SSH 驱动 |
| full | 发版前（RC 回归代替今天的 ad-hoc 回归） | 全部 `active` 旅程，按区域分批，每批 ≤45 分钟 | macOS + Windows | 同上 |
| targeted | D 项落地后 | 该 D 项所在区域的旅程子集，加 D 项自己的临时检查 | 受影响的平台 | 同上 |

- 一次运行 = 一个构建身份（SHA、binary sha256、平台）+ 一个 tier + 一份记录 `docs/test/<date>-journeys-<tier>-<platform>-<sha7>.md`：逐旅程、逐用例判定，引用日志行号和 golden 比较结果。
- rule 70 的「合跑」（watcher 回归 D32/D68/D69/D86、RC 回归）变成固定的旅程组，不拆。
- brief 简化为：构建身份、tier 或旅程列表、临时项。临时项若会复用，下一次就转成旅程。

### 4.7 平台驱动

| 阶段 | macOS | Windows |
|---|---|---|
| A（现在） | dtrack 按旅程文件走：`page` 步用 computer use，`native` 步用 `key.sh` / 菜单点击，`human` 步交给用户（如 IME、物理 Esc）；日志按字节偏移切片 | `remote-windows-device-test`：`page` 步走 DevTools 9222 `cdp.sh eval`，`native` 步走桌面会话 PowerShell 驱动 `ui.sh`；日志 `log.sh mark/since` |
| B（ADR-0047 WI-011 之后） | `control-mdpro` 执行 `page` 与 `cli` 步；`native` / `human` 仍由 A 阶段的手段 | 同左，前提是选中的驱动支持 Windows（候选 A 的 crate 是否支持 WebView2 待 WI-006 核实 `[推断]`） |

每条旅程的步骤表给出两个平台各自的输入（`⌘S` / `Ctrl+S`）；平台差异写在步骤里，不另起一条旅程，除非流程本身不同。

### 4.8 与 ADR-0047 的关系

- **旅程不依赖控制通道就能开始**：目录、fixture、Tier-0、门禁、阶段 A 的执行都与通道无关，可以先做。
- **ADR-0047 的 J1a–J7b 是通道选型的筛选集**（spike 的 S1–S5），不是功能覆盖。本计划把它们收进目录，作为 `EJ` 条目，`supersedes: [J1a]` 等，以便 spike 之后的重验也读同一份文件；它们在 spike 里的角色不变。
- **WI-012（verification skill 与 Feature Map）与本计划的 ledger 映射重叠**：Feature Map 应当直接读旅程目录与 ledger 的 `旅程：` 标记，而不是另建一套映射。这一点要在 WI-012 开工前改其验收（见 §5.2 的 ADR 提议 P3）。
- **WI-005 的人工基线**不受影响，照 ADR-0100 跑。

## §5 Decision Log

### 5.1 本计划内的决定（草案，待用户审定）

| # | 决定 | 被否的选项 |
|---|---|---|
| D1 | 旅程用 Markdown + YAML frontmatter | 可执行 `.mjs`（无执行器）；纯 YAML（agent 难读步骤） |
| D2 | id `EJ-NNN`，永不复用，退役不删 | 按区域分号段（区域会改名、合并） |
| D3 | fixture 入版本，配 golden；大文件只入生成脚本 | 运行时生成（VMark） |
| D4 | Tier-0 与旅程共用 golden 与日志判据，双向门禁 | 注释链接 |
| D5 | ledger 用「怎么确认」格内标记，不加列 | 加列 |
| D6 | 不在托管 CI 跑真机旅程 | 周跑托管 runner |
| D7 | 日志行是一等判据，复用语义投影 | 只用 DOM 与字节 |

### 5.2 需要的 ADR（提议，编号向 delegator 申请）

| 提议 | 内容 | 为什么要 ADR |
|---|---|---|
| P1 | 旅程目录是设备检查与 ledger 映射的唯一来源：格式、永不复用的 id、golden fixture、判定词汇 | 约束以后所有设备检查和 brief，会被反复挑战 |
| P2 | `ledger:check` 强制 `Shipped` 行引用旅程或给出「无 UI 旅程」理由，迁移期 backlog 只降不升 | 改变 ledger 的门禁契约 |
| P3 | ADR-0047 WI-012 的 Feature Map 读旅程目录，不另建映射（部分修订 ADR-0047 的相关条款；ADR-0047 仍是 Proposed，也可在其验收时一并写入） | 两套映射会漂移 |

## §6 Work Items

| WI | 名称 | 依赖 | 估计 | 需真机 |
|---|---|---|---|---|
| WI-E2E-1 | 旅程格式、REGISTRY、`journeys:check` | 用户审定 Q1–Q4，ADR P1 | M | 否 |
| WI-E2E-2 | fixture 语料与 golden、生成脚本、CLAUDE.md 规则补句 | WI-E2E-1 | S | 否 |
| WI-E2E-3 | 第一批：快捷键矩阵编成旅程（macOS + Windows）及 Tier-0 | WI-E2E-1、2 | L | 是 |
| WI-E2E-4 | ledger 映射与 `checkJourneyCoverage`，backlog 块 | WI-E2E-1，ADR P2 | M | 否 |
| WI-E2E-5 | smoke 集、运行记录模板、两平台首轮 smoke | WI-E2E-3 | M | 是 |
| WI-E2E-6 | 收编 ADR-0047 J1a–J7b 与 RC / watcher 合跑组 | WI-E2E-1 | M | 是 |
| WI-E2E-7 | 按区域补齐旅程，清空 backlog | WI-E2E-4 | L（分批） | 是 |
| WI-E2E-8 | 存活报告转为门禁、skill 与 brief 模板改为读旅程 | WI-E2E-5 | S | 否 |
| WI-E2E-9 | 阶段 B：`control-mdpro` 执行旅程 | ADR-0047 WI-011，ADR P3 | M | 是 |

### WI-E2E-1 旅程格式、REGISTRY 与 `journeys:check`
- **Goal**：§4.1 的格式落成可校验的契约。
- **Acceptance**
  1. `tests/journeys/README.md` 写明格式、判定词汇、id 规则（原文引用 ADR P1）。
  2. `tests/journeys/REGISTRY.md` 列出所有发放过的 id（含 retired）。
  3. `scripts/journeys/check.mjs` 与 `pnpm journeys:check`：frontmatter schema、id 唯一且已登记、REGISTRY 只增不删（对比 merge-base）、`tier0` 存在且首行指回、fixture 引用存在。每条规则有一个先失败后通过的测试（`tests/journeys-check.test.ts`，node 环境）。
  4. CI `prose-checks` 跑它。
  5. 一条样例旅程 `EJ-001`（冷启动打开文件，即 ADR-0047 J1a）通过检查。
- **Tests (first)**：校验器的每条规则 RED → GREEN（rule 10）。
- **Touched**：`scripts/journeys/`、`tests/journeys/`、`package.json`、`.github/workflows/ci.yml`。
- **Risks**：schema 过严会让第一批迁移卡住 → `status: draft` 的旅程只做结构检查。
- **Rollback**：删脚本和 CI 步骤；目录文件无害。

### WI-E2E-2 fixture 语料与 golden
- **Acceptance**
  1. `tests/journeys/fixtures/<id>/fixture.json` 格式与 sha256 校验进 `journeys:check`。
  2. 生成脚本覆盖大文件与 CRLF fixture，`--check` 通过。
  3. CLAUDE.md § Manual test fixtures 加一句：复用的 fixture 搬进旅程语料。
- **Tests (first)**：sha256 不符、引用缺失各一个 RED。

### WI-E2E-3 第一批：快捷键矩阵
- **Goal**：今天最成熟的矩阵（49 项设置、86 例 macOS 记录、Windows 记录与 v0.3.4 重跑）变成第一批旅程。
- **Acceptance**
  1. 按设置页分类成旅程：File、Edit、Paragraph、Format、View 各一条，每条按模式（W / S）的用例保留矩阵 id（`EJ-0xx/F2`），对照 CM-* 写在 Controls 节。
  2. 每条旅程两栏平台输入；Windows 独有问题（D224–D226）作为用例或备注。
  3. golden：`base.md` 与各模式保存后的期望文件，取自 2026-10-14/15 记录里已判 PASS 的 diff。
  4. Tier-0：每条旅程一套，从 `menu:action` / 快捷键钩子开始断言同一 golden 与日志事件。
  5. 用旅程文件在两个平台各跑一次，记录与 2026-10-14/15 的矩阵记录逐用例对比，差异逐条解释。
- **Risks**：矩阵里的「FAIL (no binding)」是 Settings 页的事实，不是回归 → 用例标 `expected: no-binding`，直到 D 项修复后改期望。

### WI-E2E-4 ledger 映射与门禁
- **Acceptance**
  1. `checkJourneyCoverage` 四条规则（§4.5）各有 RED 测试。
  2. 第一批旅程覆盖的 ledger 行加上 `旅程：` 标记；其余 `Shipped` 行进 backlog 块，门禁报出 hollow-pass 数。
  3. 可明确「无 UI 旅程」的行写理由（预计包括纯 Rust 内部、导出格式细节等）。
  4. `pnpm ledger:check` 与 `ledger:build` 通过。

### WI-E2E-5 smoke 集与首轮
- **Acceptance**
  1. smoke 集定义（约 10 条，每个区域至少一条主路径），写在 `tests/journeys/README.md`。
  2. 运行记录模板 `docs/test/<date>-journeys-<tier>-<platform>-<sha7>.md`。
  3. 在下一个 RC 的 release 包上，macOS 与 Windows 各跑一次 smoke，记录落地。
  4. 每条旅程平均耗时记入目录，供分批用。

### WI-E2E-6 收编 ADR-0047 旅程与合跑组
- **Acceptance**：J1a–J7b 写成 `EJ` 条目（`supersedes`），步骤与 `docs/test/20261002-adr0047-journeys.md` 一致；watcher 合跑组（D32 / D68 / D69 / D86）与 RC 回归组定义为固定旅程组；sequencing doc 的 `#release-031-gate` 一类段落改为引用旅程组。

### WI-E2E-7 按区域补齐
- **Acceptance**：每批一个 ledger 区域（符合 rule 70 的批次规则）；每批结束时 backlog 数下降，且新旅程在两个平台各有一次 PASS 或写明 `N/A` / `未执行` 的原因。Windows 表里由 `Unknown` 转为有判定的行，在同一提交改 ledger。

### WI-E2E-8 存活报告与工具
- **Acceptance**：`journeys:check --freshness` 的输出进 release-gate skill；`gui-acceptance`、`remote-windows-device-test` 与 delegator 的 brief 模板改为「读旅程文件执行」；用户确认是否把存活警告升为阻塞。

### WI-E2E-9 阶段 B 执行器
- **Acceptance**：`control-mdpro journey run EJ-NNN` 执行 `page` / `cli` 步并按 §4.4 判定；在同一构建上与阶段 A 的人工/agent 执行结果做语义投影比较，相等才算完成。依赖 ADR-0047 选型结果；若选「只读探针」，本项改为只自动化判据部分。

## §7 Testing Procedures

- 计划本身无代码。各 WI 的门禁按 rule 10 / rule 60 / rule 70。
- 真机项按 §4.6 的 tier 跑，记录在 `docs/test/`；Windows 记录的证据目录沿用 `docs/test/windows-audit-<date>-<who>/`。
- 截图命名加运行 id 前缀（2026-10-15 F2 复查把旧的 `r3.png` / `r4.png` 覆盖了的教训）。

## §8 Rollout

1. 用户审定 Q1–Q4 与 ADR P1–P3。
2. WI-E2E-1、2（无真机）。
3. WI-E2E-3（快捷键矩阵，第一批真机）与 WI-E2E-4（ledger 门禁，backlog 起步）。
4. WI-E2E-5：下一个 RC 起用 smoke 代替 ad-hoc RC 回归。
5. WI-E2E-6、7 按区域推进；WI-E2E-8 收尾。
6. WI-E2E-9 等 ADR-0047 WI-011。

与在途工作的先后：不抢 ADR-0047 WI-005 的人工基线；不占用 rule 70 的实现名额，除非 delegator 发放；WI-E2E-3 的真机部分要排在 dtrack 配额允许的时候。

## §9 成本与刻意不做的

**成本**
- 目录维护：预计 35–50 条旅程覆盖 80 个 Shipped 行 `[推断]`；每个改变行为的提交要同时改旅程或 golden（与 ledger 同一纪律）。
- 设备时间：smoke 约 45 分钟/平台/RC；full 约 4–6 批 × 45 分钟 × 2 平台/发版 `[推断]`。dtrack 的会话用量有上限，full 要提前排。
- Tier-0：每条旅程一套测试，`unit` lane 变长；超过 2 s 的进 slow lane。
- 迁移期两套并存：旧 brief 与旅程记录同时存在，直到 WI-E2E-8。

**不做**
- 托管 CI 上的真机旅程（Q4）。
- Linux（产品目标是 macOS 与 Windows）。
- 像素级截图比对。
- 性能与长时稳定性测试（E39 不建基准框架）。
- 真实 IME 自动化：IME 步骤保持 `human`（D219 的教训）。
- 原生文件对话框的完全自动化：保持 `native`，Windows 由 PowerShell 驱动，macOS 由 computer use。
- 不替代 ADR-0047 的选型筛选：J1a–J7b 在 spike 里的角色不变。

## §10 Open Questions

1. Q1–Q4（§0）。
2. 候选驱动是否支持 Windows WebView2：WI-006 核实，影响 WI-E2E-9 的 Windows 一栏。
3. 「无 UI 旅程」的理由是否需要一个封闭的类别表（例如 `rust-only` / `export-format` / `tier0-complete`），便于门禁统计。
4. smoke 是否也在 debug 构建上跑（开发期更快），还是只在 release 包上。

## §11 What this plan could not verify

- VMark 的旅程与不变量对照表在维护者本地 `dev-docs/e2e-tier0-matrix.md`，不在仓库里，未读到。
- 旅程数量与设备耗时是估计，WI-E2E-5 才有实测。
- `docs/pending/` 的快捷键 brief 只在主检出、未跟踪；WI-E2E-3 开工时以它和已提交的记录为准。
