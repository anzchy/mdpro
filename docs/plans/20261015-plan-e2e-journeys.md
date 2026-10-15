# Plan：固定的 e2e 旅程（e2e journeys），覆盖 macOS 与 Windows，并映射到 feature ledger

- **Opened**：2026-10-15，adr047-verify 起草（delegator 转达用户原话：「关于test fixture/ e2e journey，采纳vmark的思路，看看如何给本project设定e2e journey，同时涵盖各个platform(MacOS/Windows), make a comprehensive plan and save it to docs/plan in md，这个让adr047-verify session去draft plan」）
- **Revision**：rev2（2026-10-15），base `master` `42094b2`。rev1 `b02b059` 经用户选定「Codex review first」后送审：Codex `review-plan-mv9470lo-rsc315`，结论 NEEDS REVISION，25 条发现（0 Critical），§0 的 Q1–Q4 保留但须加限定。逐条处置见 §12
- **Status**：⬜ 草案，待用户审定 §0。本计划不改 `src/`、`tests/`；每个工作项落地时再按 rule 70 领取范围
- **上游**：[ADR-0034](../adr/0034-a-local-real-app-journey-lane-runs-before-release.md)（Proposed，本地真机旅程 lane）；[ADR-0047](../adr/0047-agents-verify-in-the-real-app-through-a-feature-gated-control-channel.md)（Proposed）与 [控制通道计划](20261002-plan-agent-control-channel.md)；[ADR-0100](../adr/0100-the-s2-negative-control-is-a-minimal-confirmdialog-patch.md)；[ADR-0089](../adr/0089-the-feature-ledger-records-windows-state-in-a-per-area-difference-table.md)（ledger 的 Windows 差异表）
- **起因**：用户 2026-10-15 问 codex-audit：「当前的Windows和Mac端 device test，每次都是random生成的，我需要固定一组fixture，涵盖App主要的快捷键和各种功能，随着迭代开发，不断完善，fixture需与 feature-ledger 尽量映射，当然有的feature不一定需要UI test。」（[Q&A](../reference/user-question-and-answer.md) 2026-10-15 条）

证据分级沿用控制通道计划：`[实测 …]` 是这次读过的文件或数据，`[推断]` 是推理，未在设备上跑过。

## §0 审核先看（需要用户定的）

| # | 问题 | 推荐（rev2，含 Codex 的限定） | 备选 |
|---|---|---|---|
| Q1 | 旅程用什么形式写 | **一旅程一个 Markdown 文件。机器读的元数据放在文件开头一个 ` ```json journey ` 代码块里，步骤表给 agent 和人读**（§4.1）。阶段 A 由 agent 按步骤表执行；把步骤编译成可执行输入**明确推迟**到 WI-E2E-9，接 ADR-0047 WI-011 的 `run-journey` 输入格式，不另造。rev1 写的是 YAML frontmatter，改成 JSON 块是因为仓库没有 YAML 依赖、`prose-checks` 也不装依赖（§4.8），JSON 用 node 自带的解析器就够 | (a) YAML frontmatter：要么加一个 YAML 依赖并在 `prose-checks` 装 pnpm，要么手写 YAML 子集解析器。(b) VMark 式 `.mjs`：技术上可行（现有 SSH / CDP / 原生驱动都能执行动作），不选的理由是取舍：今天的两个执行者（dtrack 的 computer use、Windows SSH 驱动）读的是自然语言步骤，可执行模块要先为两个平台各写适配层，并且会与 WI-011 的编排器重复 |
| Q2 | ledger 怎么引用旅程 | **格内标记**：inventory 行写在「怎么确认」，Windows 差异表写在「说明」（该表没有「怎么确认」列 `[实测 scripts/ledger/windowsDiff.mjs:39-40]`）。门禁按**每个平台的有效状态**检查，包括 Windows 表里没有的行（ADR-0089：省略等于声称与 macOS 同状态且已在 Windows 验证）；豁免按身份记在一个基线文件里，只许减少（§4.5） | 给 ledger 加一列：185 行 inventory 与 12 张 Windows 表（共 118 行）全部改形 |
| Q3 | Tier-0 与旅程是否共用期望 | **共用同一份 golden 数据，但每一层只断言它看得见的那一部分**：Tier-0 断言真实编辑器的序列化结果与发往 IPC 的载荷（内容、编码、换行），Rust 测试断言由该载荷写出的字节，真机断言磁盘字节（§4.3）。假 fs 不得自己产出 golden 字节 | 注释链接（VMark 的做法）：ledger 从不引用 Tier-0 文件，计数也已过时（§3.2） |
| Q4 | 是否在托管 CI 上跑真机旅程 | **阶段 A 不跑**。这是范围与成本上的决定，不是做不到：控制通道选型之前没有驱动能在托管 runner 上操作 WebView，设备时间也要先实测（§9）。CI 只跑 Tier-0 与门禁 | 加 macOS / Windows 托管 runner，周跑 |

需要的 ADR 见 §5.2，编号向 delegator 申请，本计划不预留。

## §1 Outcomes

1. **一套固定、带版本的旅程目录**：每条旅程有永不复用的 id、固定 fixture、macOS 与 Windows 两栏平台状态、步骤、日志与磁盘字节的期望，以及它证明的 ledger 行和该行里的哪些不变量。
2. **一套固定的 fixture 语料**：在仓库里、有版本；大文件和 CRLF 文件由确定性的生成脚本产出；每个用例的期望输出有 golden。
3. **每条旅程有一个每次提交都跑的快速不变量测试**（Tier-0），另可加 slow lane 的补充；与旅程共用 golden 数据，各层断言各自看得见的部分。
4. **ledger 里每个在某平台上有效状态为 `Shipped` 的行**，在该平台要么引用一条旅程，要么给出带测试引用的「无 UI 旅程」理由；门禁检查，豁免只减不增。
5. **分层运行，结论可聚合**：每个 RC 跑 smoke、发版前跑 full、D 项跑定向子集；每次运行留一份机器可读的运行清单。必跑用例未执行或受阻时，整次运行算 INCOMPLETE，不算通过。
6. **今天的 ad-hoc brief 逐步变成「在某个构建上跑某个 tier」**；在旧的 RC 回归组和 watcher 合跑组迁入目录、且与旧门禁并跑一次得到等价结果之前，旧门禁不撤。
7. **旅程坐在 ADR-0034 的 app lane 与 ADR-0047 的控制通道之上，不重做它们**：目录就是 ADR-0034 那条 lane 的内容；通道就绪后，WI-011 的编排器读同一份旅程文件。

## §2 Constraints

- rule 70：只有 real-device-tester（dtrack）在 mini 上跑 GUI；Windows 走 `remote-windows-device-test`；设备检查按区域成批（6–10 项或约 45 分钟）；每项写失败条件、必须到达的代码路径和证明它的日志行；没到达路径的记「未执行」，不记通过；**合跑组（watcher 回归、RC 回归）不拆**。
- rule 10：前端测试只能放在 `tests/` 下；DOM-free 文件声明 node 环境（ADR-0049）；≥2 s 的放 `*.slow.test.ts`（ADR-0050），slow lane 不在默认运行和每次提交的 `unit` lane 里 `[实测 vitest.config.ts:12-17,29-30]`。
- CLAUDE.md § Manual test fixtures：手工 fixture 在 `tests/manual-fixtures/`，运行时用副本。本计划的旅程 fixture 有自己的目录（§4.2），这条规则要相应补一句（WI-E2E-2）。
- ledger 的状态枚举封闭；`Partial` 必须带 `限制：`；Windows 未验证必须写 `Unknown`，差异表里省略的行等于「与 macOS 同状态且已在 Windows 验证」（ADR-0089；`docs/feature-ledger.md` 第 57 行附近的说明）。
- 日志是 JSONL（`~/.mdpro/mdpro.log`），事件命名见 CLAUDE.md § Logging Rules。mdpro 有结构化日志，rule 70 本来就要求每项给出证明路径的日志行；VMark 的 runner 和 save 旅程不用日志做判据（其余 46 条旅程的实现没读到，不作断言）。
- 门禁脚本与 `ledger:check` 一样，不引入依赖（§4.8）。
- 不预留 ADR / D 编号；落地走 rule 70（分支、verifier、审计、CI）。

## §3 Current Behavior Inventory

### 3.1 mdpro 今天怎么做设备检查 `[实测，见各路径]`

| 项 | 现状 |
|---|---|
| ledger | `docs/feature-ledger.md`：inventory 185 行（Shipped 80 / Partial 63 / Stub 13 / Absent 28 / Unknown 1）；12 张「Windows 差异」表共 118 行，其中 11 行 `N/A`，其余 107 行里 Unknown 99。「怎么确认」格写动作、IPC 路径、日志行与真机日期，**部分行用散文引用了测试文件**（例如 `tests/d138-saveas-reload-in-place.test.ts`），但**没有机器可核对的旅程引用** |
| `ledger:check` | `scripts/ledger/check.mjs`：表结构、状态枚举、`限制：`、路径可解析、Windows 差异表四项、声明面覆盖（command / route / `MENU_*` / plugin id / store 只要在文中出现）。backlog 机制只是去掉标记块后重算覆盖，并打印 hollow-pass 数；**不读任何历史基线，也不拒绝新增** `[实测 check.mjs:47-55,113-119]`。CI 的 `prose-checks` 用浅克隆和裸 node 跑它，不装 pnpm `[实测 .github/workflows/ci.yml:52-60]` |
| 手工 fixture | `tests/manual-fixtures/` 29 个 `<id>-<slug>.md` + `img/`；`scripts/manual-fixtures/generate-large.mjs` 生成多 MB 文件并 `--check` sha256 |
| macOS 驱动 | `gui-acceptance`（computer use，按字节偏移读日志，PASS / FAIL / partial / NOT VERIFIED）；`gui-manual-verify`（人在回路）；dtrack 按 delegator 的 brief 跑 |
| Windows 驱动 | `remote-windows-device-test`：全 SSH，页面输入走 WebView2 DevTools 9222 端口，原生输入走桌面会话里的 PowerShell。已知缺口，都是 Codex 指出、经 codex-audit 复核的：`common.sh:22-26` 在 ssh 退出 255 后把任何命令重试一次，**包括变更**（delegator 已另行登记 D 项）；`log.sh:5-19` 截断 context（240 字符）和 error（120 字符），丢掉 `level` 与 `actionId`，静默跳过坏 JSON；`cdp.mjs:25-32` 取第一个页面，`ui.ps1:49-58` 取前台或第一个 mdpro 窗口，不能按窗口标签定位；`ui.ps1:159` 出错后继续，`cdp.mjs:93-103` 打印求值异常后仍退出 0 |
| 快捷键矩阵 | brief `docs/pending/20261014-brief-shortcuts-matrix.md`（未跟踪，只在主检出）：Settings 页 49 项，路由 M/H/P/C，对照 CM-M/CM-H/CM-P/CM-C，模式 W/S，用例 F1–F7、E1–E11、P1–P17、T1–T8、V1–V6；brief 明说「没有绑定」就是没兑现 Settings 页的承诺（`:54-58`）。macOS 记录 86 例 + 8 次对照；Windows 记录与 v0.3.4 Windows 重跑。两版输出不同：v0.3.4 保留 `-` 列表标记，v0.3.3 产出 `*`（`docs/test/20261015-v034-windows-device-check.md:28,68-72`） |
| ADR-0034 | Proposed：一条本地 `app` lane 跑真机旅程，作为发版清单的一项而非强制门禁；被测的是 release profile 的 bundle；判据是状态和日志，不看像素；每条入口路由一条旅程；首批旅程为 D29 的三条（Finder 路由、单实例路由、双窗口里脏的那个赢）、D20 G1、ADR-0032 的偏好往返（决定 1、3、5–7） |
| ADR-0047 旅程 | `docs/test/20261002-adr0047-journeys.md`：J1a、J1b、J2、J3、J4a、J4b、J5、J6、J7a、J7b；步骤类别 `cli` / `launcher` / `native` / `human`（`:34-39`）；**按顺序在共享会话里跑**，不是各自重置的独立测试（`:91-99`）；「语义投影」比较规则（`:379` 起），其白名单不含 watcher、MCP、TOC 和多数编辑器事件，并要求报告未知事件（`:390-417`） |
| 控制通道 | WI-000–004 已落地（WI-004 `9940be9`）；WI-005 构建已备、人工基线待排；WI-006–012 未开始。WI-011 已规划 `run-journey <id>`：执行 `cli` 与 `launcher` 步，遇到 `native` / `human` 停下等人，产出带步骤类别与证据类别的逐步结论（计划 `:682-701`）。`control-channel` feature 尚不存在 |
| CI | `ci.yml`：PR 上跑 ledger、`pnpm test:run`、cargo，Ubuntu 为主，tag 加 macOS；**没有 Windows 测试** |
| 记录 | `docs/test/` 下 65 份记录 + 6 个 `windows-audit-*` 证据目录；brief 在 `docs/pending/`，D215 起不跟踪 |
| 可复用的测试夹具 | `tests/helpers/milkdownEditorHarness.tsx`（真实 Milkdown 编辑器）；`tests/support/menuEventsHarness.ts`（菜单事件总线）。保存路径上，JS 经 IPC 发出内容、编码和换行元数据（`src/services/documentSave.ts:109-115`），最终编码由 Rust 完成（`src-tauri/src/commands/file.rs:289-308`） |

问题：每次设备检查的步骤和 fixture 由写 brief 的人临时定，同一功能两次检查不可比；ledger 的「怎么确认」是散文，没有机器能核对的链接；Windows 一侧几乎全是 Unknown；Windows 驱动在多窗口、日志判据和重试上还不足以支撑字节级判定。

### 3.2 VMark 怎么做 `[实测 xiaolai/vmark@main e0a982d，经 gh api 读；Codex 逐条核对]`

- **旅程**：`e2e/journeys/NN-slug.mjs`，导出 `{ name, run(client, ctx) }`，可选 `coverageRequired`、`platforms`。共 47 个文件，编号 01–48，缺 26。README 原话：「numbers are never reused: there is no `26-*` … No journey file has ever been deleted」（`e2e/README.md:24-28`；「从未删除」是 README 的说法，快照里没有 git 历史可以证实）。返回 `{skip}` 为 SKIP，抛错为 FAIL，`platforms` 不含当前平台为 `N/A`（不算覆盖丢失）；`coverageRequired` 的旅程若 SKIP，整轮变红（`e2e/run-journeys.mjs:156-266`）。
- **判据**：经 `execute_js` 读 DOM。save 旅程按 UTF-8 解码后比较整个文件（`10-save-to-disk.mjs:100-124`）；autosave 旅程仍是子串比较，README 自己点出了这一点（`README.md:80-82`）。用 poll 代替固定 sleep，teardown 有一处明确的 400 ms 例外。失败时截图；不带过滤的整轮运行最后核对标签栏是否恢复原状。
- **驱动**：第三方 `tauri-plugin-mcp-bridge`，只在 debug 构建、`127.0.0.1:9323`、WebSocket；端口被占时拒绝启动（`src-tauri/src/app_plugins.rs:126-174`）。文档里的报文示例不带凭证；插件本体没读到，是否完全没有鉴权未证实。
- **Tier-0**：`src/test/tier0/*.test.ts(x)` 13 套，外加 `harness.ts`。工作流注释说它用真实的 store 与服务、有状态的假 fs，每个 PR 都跑（`tier0-e2e.yml:9-12`；测试本体没读到）。与旅程的链接只靠注释；ledger 从不引用 Tier-0 文件。
- **ledger 与门禁**：`.claude/feature-ledger.md` 用固定字段的块，在 `tests:` 字段写旅程路径。`scripts/check-feature-map.mjs` 不只查路径存在：它还查 spine 的形状、内容和默认值，源文件归属唯一，feature 与块的对应关系，以及 Verified 提交是否是祖先（`:5-22,79-105`）。但它不做语义覆盖检查。ledger 的 `e2e-journeys` 块写着「38 个旅程」，实际 47 个（`ledger.md:3467-3476`）。这种散文计数，双向链接门禁也查不出来。
- **调度**：`tier0-e2e.yml` 每周一 cron 加手动触发，矩阵为 Ubuntu 与 macOS，跑全部旅程；失败时开一个滚动 issue，成功后关掉它。`check-gate-liveness.mjs` 防止定时门禁悄悄停跑；它记录了上线头五天一次都没跑过。
- **短板**：没有 Windows 的 CI 腿（其 ledger 声称 bridge 兼容 Windows，`ledger.md:3473`，运行可靠性未证实）；原生对话框不驱动（`README.md:147-149`）；只覆盖 debug 构建；不变量对照表在维护者本地，不在仓库里（`README.md:105-110`）。

### 3.3 取舍

| 采纳 | 理由 |
|---|---|
| 永不复用的编号，文件不删（退役写 `retired`） | 记录和 ledger 里的引用永远指得回去 |
| 每条旅程有 Tier-0 对应测试，每次提交跑 | 真机贵，回归要在提交时就抓住 |
| `coverageRequired` 与 `N/A` 区分 | 平台不适用不算覆盖丢失；必跑的跳过要变红。本计划进一步规定聚合规则（§4.6） |
| 整块字节比较、poll 不 sleep、运行后恢复状态 | 判据可复现 |
| 门禁加存活检查 | 防止目录、ledger 与实际脱节 |
| 计数从目录里生成，不手写 | 堵住「ledger 写 38、实际 47」这类漂移；双向链接本身查不出散文计数 |

| 不采纳或改进 | 理由 |
|---|---|
| 运行时生成 fixture → **入库的固定语料 + golden 期望**；大文件和 CRLF 文件仍由确定性生成器产出 | 用户要「固定一组 fixture」。VMark 的生成代码与期望也在源码里，同样可复现；区别在于固定语料让人能直接打开那份文件，Tier-0、Rust 测试和真机读的是同一份字节 |
| 注释链接 → **元数据字段 + 双向门禁 + 生成的计数** | ledger 从不引用 Tier-0，计数会过时 |
| 只查块内路径 → **按平台有效状态查双向一致，豁免按身份记基线** | 见 §4.5 |
| 不用日志 → **日志是一等判据，按旅程声明投影** | mdpro 有结构化 JSONL 日志 |
| 只覆盖 debug 构建 → **smoke 在 release 包上跑** | ADR-0034 决定 3；mdpro 的发版门禁本来就在 release 包上做 |
| 托管 CI 周跑 → **阶段 A 在自有设备上按 RC / 发版 / D 项跑** | 见 Q4 |
| 没有 Windows CI 腿 → **每条旅程有 macOS 与 Windows 两栏** | 用户要求 |

## §4 Target Rules

### 4.1 旅程格式

文件 `tests/journeys/EJ-NNN-<slug>.md`。前缀 `EJ`（e2e journey）用来区别 ADR-0047 的 `J1a…J7b` 和快捷键矩阵的 `F1…E11`。id 三位数字，按发放顺序编号，**永不复用，文件永不删除**；退役的旅程保留文件，元数据写 `"status": "retired"` 和原因。

文件开头第一个代码块是元数据，语言标记为 `json journey`：

```json journey
{
  "id": "EJ-012",
  "title": "Save keeps the bytes and clears the dirty marker",
  "status": "active",
  "area": "文件",
  "tier": ["smoke", "full"],
  "platforms": {
    "macos":   { "status": "required" },
    "windows": { "status": "required" }
  },
  "fixtures": ["save-basic"],
  "tier0": ["tests/journeys/tier0/EJ-012-save.test.ts"],
  "rust": ["src-tauri/src/commands/file_save_golden_tests.rs"],
  "projection": "tests/journeys/projections/EJ-012.json",
  "ledger": [
    { "row": "保存", "cases": ["S1", "S2"],
      "covers": ["写盘字节等于编辑器内容", "保存后清除脏标记"],
      "partial": "不含：保存失败提示、原子写、保存中再编辑" }
  ],
  "cases": [
    { "id": "S1", "mode": "W", "intended": "⌘S 写出 expected/EJ-012-S1.md" },
    { "id": "S2", "mode": "S", "intended": "同上，Source 模式",
      "knownDefect": null }
  ],
  "supersedes": [],
  "group": null
}
```

- `platforms.<p>.status` 取 `required` / `optional` / `n/a` 之一；`n/a` 必须带 `reason`。
- `group` 用于必须按顺序在共享会话里跑的旅程（ADR-0047 的 spike 组、watcher 合跑组、RC 回归组）：同组旅程带 `group` 和 `order`，组作为一个整体运行，不拆开跑（rule 70）。
- `ledger[].covers` 写该行里被这条旅程证明的那几条不变量，用短语，取自该行的「怎么确认」；`partial` 写该行里没有被证明的部分。没有 `partial` 就是声称覆盖全行（Codex 发现 6：「保存」一行包含排队保存、保存中编辑、关闭标签、错误和原子写，一个普通 ⌘S 用例证明不了全部）。
- 用例 id 在一条旅程里唯一，引用写成 `EJ-030/F2`。快捷键矩阵已有的 F1…V6 原样保留。用例也永不复用：删掉的用例在 `cases` 里留着，并标 `"status": "retired"`。

正文各节：

| 节 | 内容 |
|---|---|
| Why | 这条旅程证明什么；Tier-0 和 Rust 测试分别覆盖到哪一步为止，为什么剩下的部分 jsdom 证明不了 |
| Setup | 预置偏好、隔离方式（§4.7）、打开哪个 fixture 的副本、窗口与模式 |
| Steps | 表格：`# · 类别 · 动作 · macOS 输入 · Windows 输入 · 期望日志 · 期望状态`。类别沿用 ADR-0047 的四类 `cli` / `launcher` / `native` / `human`，另加 `page`（在页面里做的动作：Windows 经 DevTools，macOS 经 computer use，阶段 B 由 CLI 做） |
| Oracle | 判据：日志按 `projection` 文件声明的投影比较（§4.4）；磁盘字节与 golden 整块相等；状态（标签、模式、对话框是否在） |
| Controls | 同一次运行里的对照，沿用 CM-M / CM-H / CM-P / CM-C 的思路。对照不成立时，该用例记「未执行」 |
| Failure condition | 一句话写明什么算 FAIL |
| Cleanup | 恢复到启动前的状态，并在运行后核对；失败时也要执行 |

**步骤表在阶段 A 是给 agent 读的结构化散文，不是可执行规范。** 把步骤编译成可执行输入（选择器、等待条件、断言）明确推迟到 WI-E2E-9，届时按 WI-011 `run-journey` 的输入格式定义，并用一个 ` ```json steps ` 块承载；阶段 A 不预先发明这套格式。

**判定词汇**（统一 macOS 与 Windows 现有的两套）：

| 用例结论 | 含义 |
|---|---|
| `PASS` | 到达了路径，判据成立，对照成立 |
| `FAIL` | 到达了路径，判据不成立 |
| `XFAIL` | 按 `knownDefect: Dnnn` 预期的失败，且失败的样子与登记的一致 |
| `XPASS` | 标了 `knownDefect` 却通过了：要人看，确认后在同一提交里去掉 `knownDefect` 并更新 D 行 |
| `未执行` | 没到达路径，或对照不成立 |
| `BLOCKED` | 环境问题（驱动、设备、构建），要写原因 |
| `N/A` | 元数据声明了这个平台不适用 |

**已知缺陷不改写需求**（Codex 发现 17）：`intended` 永远写功能应有的行为。「快捷键没有绑定」这类已知缺陷记成 `knownDefect: Dnnn`，结论是 `XFAIL`，不把期望改成「什么都不发生」。门禁要求每个 `knownDefect` 指向一个存在的 D 行。

### 4.2 fixture 语料

- 目录 `tests/journeys/fixtures/<fixture-id>/`：放输入文件，`expected/` 下放每个用例的 golden 输出。
- **golden 的键**：`<旅程>-<用例>[.<模式>][.<平台>].<ext>`。只有当平台差异是**有意的、并且写了原因**时，才分平台存放（例如换行策略）；其余情况下两个平台共用一份 golden，出现差异就是缺陷（Codex 发现 18）。影响输出的偏好写进用例的 Setup。
- **哪份算规范输出**：WI-E2E-3 开工时，在 `fixture.json` 里写明每份 golden 取自哪一次已判 PASS 的记录、哪个构建；v0.3.3 和 v0.3.4 不一致的地方（例如列表标记 `*` 与 `-`），以 golden 生成时 `master` 上的行为为准，并在 `fixture.json` 里记下这条差异。
- 每个目录有 `fixture.json`：用途、哪些旅程用它、每个文件的 sha256、golden 的来源。门禁核对 sha256 和引用。
- 大文件（多 MB）和 CRLF 文件不入库（CRLF 会被 `.gitattributes` 归一化），入库的是生成脚本：扩展 `scripts/manual-fixtures/generate-large.mjs`，或写一个同构的 `scripts/journeys/generate.mjs`，用 `--check` 校验 sha256。
- 运行时一律用副本（与 CLAUDE.md 现行规则一致）。
- `tests/manual-fixtures/` 留给一次性的 D 检查；一个 manual fixture 被两次以上的检查复用时，搬进旅程语料。

### 4.3 Tier-0 与分层断言

每层只断言自己看得见的那部分（Codex 发现 15）：

| 层 | 位置 | 断言 | 每次提交 |
|---|---|---|---|
| 前端 Tier-0 | `tests/journeys/tier0/EJ-NNN-<slug>.test.ts(x)` | 用真实编辑器（`milkdownEditorHarness`）和真实菜单总线（`menuEventsHarness`）从 `menu:action` 或快捷键钩子开始；断言序列化结果，以及发往 IPC 的载荷（内容、编码、换行元数据），都与 golden 一致；断言前端日志事件（在 `loggingService` 边界 mock） | 是 |
| Rust | 旅程元数据的 `rust:` 列出的测试 | 以相同的载荷调用命令层，断言写出的字节等于 golden；断言 Rust 日志事件 | 是（`rust` lane） |
| 真机 | 旅程本身 | 磁盘字节等于 golden；完整日志投影；窗口和对话框状态 | 按 tier |

- 只在边界 mock（Tauri `invoke` / event、fs）。**假 fs 不得自己产出 golden 字节**：前端层只能断言发出去的载荷，不能断言假 fs 写出来的结果，否则测的是假 fs 自己的实现。
- **每条旅程至少有一个快速、每次提交都跑的不变量测试**；更费时的穷举放进 `*.slow.test.ts` 作为补充，不能拿它充当唯一的对应测试（Codex 发现 3）。
- 文件首行写 `// Tier-0 for EJ-NNN`，旅程元数据的 `tier0:` 指回它；门禁双向核对。
- 原生菜单、原生对话框、IME、窗口焦点这些 jsdom 够不着的部分，Why 一节写明 Tier-0 覆盖到哪一步为止。

### 4.4 日志判据：按旅程声明的投影

ADR-0047 的语义投影是为 spike 的十条旅程写的，它的白名单没有 watcher、MCP、TOC 和多数编辑器事件（Codex 发现 7）。本计划不复用一份全局白名单，而是：

- **每条旅程一个投影文件** `tests/journeys/projections/EJ-NNN.json`，带 `projectionVersion`。它声明：要比较的事件和字段；每个字段的归一化方式（时间戳、耗时、pid、几何一律丢弃；窗口标签映射成 `W1/W2`；路径映射成 `<RUN>/…`）；次数（精确或至少）；哪些顺序是代码保证的；以及哪些事件只属于前端、哪些只属于 Rust。
- **保留 ADR-0047 的两条硬规则**：任何 `fail` / `warn` / `error` 行都算进比较；投影外出现的事件要逐条列出，不能静默忽略。
- 归一化器 `scripts/journeys/projection.mjs` 本身有测试，覆盖归一化、计数、顺序和意外失败（WI-E2E-1）。
- 期望日志在步骤表里写成 `event {status, 关键 context}`，与今天 brief 的写法一致，便于迁移。
- **字节判据**：与 golden 整块相等，包括末尾换行；不允许子串匹配。截图只作辅助证据，不作判据（不做像素比对，§9；ADR-0034 决定 6）。

### 4.5 ledger 映射与门禁

**标记位置**：inventory 行写在「怎么确认」格；Windows 差异表写在「说明」格。标记有三种：

- `旅程：EJ-012`：覆盖全行；
- `旅程（部分）：EJ-012`：部分覆盖，旅程元数据的 `partial` 写明缺什么；
- `无 UI 旅程（<类别>）：<理由>；测试：<path>[, <path>]`。

**有效状态**：门禁为每个能力、每个平台算出有效状态。macOS 取 inventory 的状态；Windows 有差异行时取差异行的状态，没有时继承 inventory 的状态（ADR-0089 的规则），`N/A` 不参与。

`ledger:check` 新增 `checkJourneyCoverage`：

1. 每个能力，在每个有效状态为 `Shipped` 的平台上，必须有一个标记。标记写在 inventory 格时对两个平台都算；Windows 差异表里的标记只对 Windows 算。
2. 引用的 `EJ-NNN` 必须存在且 `status: active`。旅程元数据的 `ledger[].row` 必须正好是这一行「能力」格的原文（双向一致）。这一平台在旅程里不得是 `n/a`。
3. 写 `旅程：` 的不得对应带 `partial` 的元数据；写 `旅程（部分）：` 的必须对应带 `partial` 的。
4. 「无 UI 旅程」的类别是封闭集：`rust-only`（效果只在 Rust 内部）、`pure-transform`（纯函数变换，例如单条渲染规则）、`os-owned`（由系统负责，例如系统快捷键）、`not-user-visible`。每个都必须带至少一个能解析的 `测试：` 路径。**一条用户可见的完整链路不能整体豁免**（例如「导出 HTML」整条链路），只能逐条豁免其中的纯不变量（Codex 发现 19）。门禁判断不了「完整链路」，这条由审查执行，写进 rule 60 的清单（WI-E2E-4）。
5. **backlog 按身份记基线，只许减少**（Codex 发现 10）。`tests/journeys/ledger-backlog.baseline.json` 列出豁免的身份 `{area, platform, 能力}`。门禁要求：当前缺标记的身份集合 ⊆ 基线。往基线里加身份的提交，在 CI 上会被拒（对照 base 版本的基线，§4.8）。第一次采用时，基线在建立它的那次提交里生成。能力改名的处理：基线文件的 `renames` 里写 `{from, to}`，并且 `from` 必须已从 ledger 消失；否则改名就等于「删一个、加一个」，加的那个会被拒。
6. 门禁输出两个数，并且**分开报**：迁移进度（基线里还剩几个身份）与运行时覆盖（§4.6 的存活报告）。迁移进度下降，不代表任何东西在设备上通过了。

新增 `pnpm journeys:check`（`scripts/journeys/check.mjs`）：元数据 schema；id 唯一并已在 `tests/journeys/REGISTRY.md` 登记；REGISTRY 只增不删；旅程文件不得删除；用例 id 唯一，且不得复用；`supersedes` 指向的旧 id 存在、没有环、也不再被别处当作现行引用；`knownDefect` 指向的 D 行存在；fixture 和 golden 的 sha256 一致；生成器 `--check` 通过；`tier0` 与 `rust` 文件存在，且首行指回；投影文件能被解析；README 里的旅程计数由目录生成，并与之一致。

### 4.6 分层、聚合与运行清单

| Tier | 何时 | 范围 | 平台 | 谁跑 |
|---|---|---|---|---|
| T0 | 每次提交 | 全部 Tier-0 与 Rust 对应测试 | CI（Ubuntu）与本机 | `unit`、`rust` lane |
| smoke | 每个 RC 锁定的 SHA，在 release 包上 | 每个 ledger 区域至少一条主路径，或写明豁免；目标是每个平台 ≤45 分钟，由 WI-E2E-5 的试点实测后再定 | macOS + Windows | dtrack；Windows SSH 驱动 |
| full | 发版前 | 全部 `active` 旅程，按区域分批，每批 ≤45 分钟；`group` 整组跑 | macOS + Windows | 同上 |
| targeted | D 项落地后 | 该 D 项所在区域的旅程子集，加 D 项自己的临时检查 | 受影响的平台 | 同上 |

**聚合规则**（Codex 发现 5）：

- **一条旅程在一个平台上的结论**：它的所有 `required` 用例都是 `PASS` 或 `XFAIL`，且对照成立，则为 PASS；任何一个是 `FAIL` 或 `XPASS`（待人确认），则为 FAIL；其余情况（某个必跑用例 `未执行`、`BLOCKED` 或缺失）为 INCOMPLETE。`optional` 用例不影响结论，但要记录。
- **一次运行的结论**：所有选中的旅程都是 PASS，则为 PASS；有 FAIL，则为 FAIL；否则为 INCOMPLETE。**INCOMPLETE 不是绿的**，不能拿它支持发版或给 ledger 行写真机日期。
- `XFAIL` 不算该用例的覆盖。ledger 行如果依赖带 `knownDefect` 的用例，就不能是 `Shipped`。

**运行清单**（Codex 发现 8）：每次运行生成 `docs/test/journey-runs/<runId>.json` 和一份人读的 `.md`。`runId` = `<date>-<tier>-<platform>-<sha7>-<n>`。清单内容：

- 构建身份：SHA、二进制 sha256、profile、平台和系统版本；
- 每条旅程的修订（旅程文件的 git blob sha）、投影版本、fixture 与 golden 的 sha256；
- 每个用例的结论，以及证据引用（日志行号或字节区间、golden 比较结果、截图名）；
- 聚合结论；
- 未完成的原因，运行中断时也要写。

清单的 schema 由 `journeys:check` 校验。

**存活**：`journeys:check --freshness` 读运行清单，报告每条 `smoke` 旅程在每个平台上最近一次 PASS 的情况。**只有当清单里的旅程修订、投影版本和 golden 哈希与当前目录一致时，才算这条旅程的 PASS**；旅程或 golden 改过之后，旧的 PASS 就不新鲜了。从没跑过的、之后又失败过的、证据缺失的、平台不适用的，各自单列。先只警告，WI-E2E-8 再与用户定是否改为阻塞。

**与 rule 70 合跑组的关系**（Codex 发现 21）：watcher 回归（D32 / D68 / D69 / D86）和 RC 回归保持原样整组运行。WI-E2E-6 把它们迁成 `group` 之后，新旧两套在同一个 RC 上并跑一次，结论逐项等价，旧的才撤下。在那之前，smoke 只是**附加**的，不替代任何现有门禁。

### 4.7 平台驱动与运行生命周期

| 阶段 | macOS | Windows |
|---|---|---|
| A（现在） | dtrack 按旅程文件走：`page` 步用 computer use，`native` 步用 `key.sh` 或点菜单，`launcher` 步用 `open -a <bundle 绝对路径>` 或二进制，`human` 步交给用户（例如 IME、物理 Esc）；日志按字节偏移切片 | `remote-windows-device-test`：`page` 步走 DevTools 9222 `cdp.sh eval`，`native` 步走桌面会话里的 PowerShell 驱动 `ui.sh`，`launcher` 步用 `runi.ps1`；日志用原始 JSONL 捕获（见下） |
| B（WI-011 之后） | WI-011 的 `run-journey` 执行 `cli` / `launcher` / `page` 步；`native` / `human` 仍用 A 阶段的手段 | 同左，前提是选中的驱动支持 WebView2（WI-006 核实；ADR-0034 决定 2 只要求 macOS） |

**Windows 驱动在阶段 A 的前置加固**（WI-E2E-W；归属由 delegator 指派，因为它改的是 skill 的脚本）：

1. **变更不重试**（Codex 发现 14；对应的工具缺陷 delegator 已另行登记 D 项）：读操作可以重试；变更类操作（UI 输入、CDP 求值、文件写入）只执行一次，或者必须证明是幂等的。变更的响应丢失时，结论是「结果未知」：停止依赖它的后续步骤，先核对状态，再决定继续还是记 `BLOCKED`。`ui.ps1` 出错和 `cdp.mjs` 求值异常都要返回非零退出码。
2. **原始日志捕获**（Codex 发现 12）：新增一个取原始 JSONL 的命令，按字节偏移取片段；保留全部字段；记录文件身份（路径、大小、首行哈希），用来发现轮转或截断；坏 JSON 行要计数并报出来。现有的格式化输出只给人看，不作判据。
3. **按窗口标签定位**（Codex 发现 13）：每次变更之前，先把窗口标签绑定到 CDP target 和 HWND，并做身份核对（在 target 里读当前窗口的标签，与期望的标签比对）。这项做好之前，Windows 上的多窗口用例（J6 / J7 一类）一律记 `BLOCKED`，不能用前台窗口代替。

**运行生命周期**（两个平台都要遵守；Codex 发现 23）：

| 阶段 | 内容 |
|---|---|
| 授权 | 运行前确认谁拥有这台设备，以及重启用户的 mdpro 是否已获授权（Windows skill 要求 `SKILL.md:13-24`）；同一台设备同时只跑一个运行 |
| 构建身份 | 记录 SHA 和二进制 sha256，与运行清单一致；不一致就停 |
| 现场快照 | 记下偏好、草稿目录、最近文件列表，以及窗口是否最大化 |
| 隔离 | macOS 把 `HOME` 指向临时目录（WI-005 P3 的做法）；Windows 的配置隔离方式由 WI-E2E-W 核实，在那之前用「现场快照加运行后恢复」 |
| 就绪 | 确认日志在写（标记一行，再读回来）；按路由先做对照 |
| 视口 | 窗口尺寸作为参数写进旅程 Setup，不写死旧的尺寸 |
| 清理 | 无论成败都执行：恢复现场快照，删除临时副本；Windows 上按 skill 要求不带 DevTools 重启 |

### 4.8 CI 改动

`prose-checks` 今天用浅克隆和裸 node（Codex 发现 11）。本计划需要：

- `actions/checkout` 加 `fetch-depth: 0`，或者显式 fetch base ref，用于 REGISTRY 只增、旅程不删、backlog 基线只减这三项历史检查。
- base 的取法：PR 上用 `github.event.pull_request.base.sha`；tag 和手动触发时，用与 `origin/master` 的 merge-base。**base 解析不出来时，检查失败，不跳过。**
- `scripts/journeys/check.mjs` 与 `ledger:check` 一样不引入依赖，用 `node scripts/journeys/check.mjs` 直接跑，不需要 pnpm。这是 Q1 推荐 JSON 元数据块的原因。
- 在本机跑时，base 默认取与 `master` 的 merge-base。

### 4.9 与 ADR-0034、ADR-0047 的关系

- **目录就是 ADR-0034 那条 `app` lane 的内容**（Codex 发现 22）。ADR-0034 是 Proposed。它的决定 3（release profile 的 bundle）、5（每个入口路由一条旅程）、6（看状态和日志，不看像素）与本计划一致；它的决定 7 列出的首批旅程（D29 的三条、D20 G1、ADR-0032 的偏好往返）作为 EJ 条目收进目录（WI-E2E-6）。ADR-0034 的「`pnpm test:app` 一条命令」要等阶段 B 才有执行器；阶段 A 的等价物是「按 tier 跑并产出运行清单」。ADR 提议 P1 写明它与 ADR-0034 的关系：补充或取代哪几条。
- **旅程不依赖控制通道就能开始**：目录、fixture、Tier-0、门禁和阶段 A 的执行，都与通道无关。
- **ADR-0047 的 J1a–J7b 是通道选型的筛选集**（spike 的 S1–S5），不是功能覆盖。它们以 `group: "adr0047-spike"` 的形式按原顺序收进目录（`supersedes` 指向原 id），并保留共享会话的顺序。`docs/test/20261002-adr0047-journeys.md` 仍是 spike 的历史证据；**WI-005 的基线比较做完之前，它的判据冻结**，目录条目只引用它，不改它。
- **WI-011 与 WI-012 在开工前修订验收**：WI-011 的 `run-journey` 读本目录的文件，WI-E2E-9 是对它的扩展，不另起一个命令；WI-012 的 Feature Map 直接读目录和 ledger 标记，不另建映射。这一点写进 ADR 提议 P3。
- **WI-005 的人工基线**不受影响，照 ADR-0100 执行。

## §5 Decision Log

### 5.1 本计划内的决定（草案，待用户审定）

| # | 决定 | 被否的选项及理由 |
|---|---|---|
| D1 | 旅程用 Markdown，元数据放在 JSON 块里；可执行化推迟到 WI-011 | YAML frontmatter：要加依赖，或者手写解析器。`.mjs`：要为两个平台各写适配层，并且与 WI-011 重复 |
| D2 | id `EJ-NNN`，永不复用，退役不删，用例 id 也不复用 | 按区域分号段：区域会改名、会合并 |
| D3 | 固定入库的 fixture 加 golden；大文件和 CRLF 文件用生成器 | 只在运行时生成：同样可复现，但用户要能打开的固定文件，三层要共用同一份字节 |
| D4 | 三层共用 golden 数据，每层断言自己看得见的部分；用元数据双向链接 | 注释链接 |
| D5 | ledger 格内标记；按平台有效状态检查；豁免按身份记基线 | 加列；按数量记 backlog |
| D6 | 阶段 A 不在托管 CI 上跑真机 | 托管 runner 周跑：驱动还没有，成本还没量过 |
| D7 | 日志是一等判据，投影按旅程声明 | 只看 DOM 和字节；复用 ADR-0047 的全局白名单 |
| D8 | 聚合规则下 INCOMPLETE 不是绿；`XFAIL` 不算覆盖 | 只要没有 FAIL 就算绿 |
| D9 | smoke 先附加，与旧门禁等价之后才替代 | 立刻替代 RC 回归：违反 rule 70 的合跑组规则 |

### 5.2 需要的 ADR（提议，编号向 delegator 申请）

| 提议 | 内容 | 为什么要 ADR |
|---|---|---|
| P1 | 旅程目录是设备检查与 ledger 映射的唯一来源：格式、永不复用的 id、golden fixture、判定词汇、聚合规则；写明与 ADR-0034（Proposed）的关系 | 约束以后所有设备检查和 brief，会被反复挑战 |
| P2 | `ledger:check` 按平台有效状态强制旅程标记或带测试的豁免；backlog 按身份只减；`prose-checks` 取完整历史 | 改变 ledger 的门禁契约和 CI |
| P3 | ADR-0047 WI-011 的 `run-journey` 读本目录；WI-012 的 Feature Map 读目录与 ledger 标记（部分修订 ADR-0047 的相关条款。ADR-0047 仍是 Proposed，也可以在它验收时一并写入） | 两套映射、两个编排器会漂移 |

## §6 Work Items

| WI | 名称 | 依赖 | 估计 | 需真机 |
|---|---|---|---|---|
| WI-E2E-0 | 区域与不变量矩阵（prep） | 用户审定 §0 | S | 否 |
| WI-E2E-1 | 旅程格式、REGISTRY、投影归一化器、`journeys:check`、CI 改动 | WI-E2E-0，ADR P1 | M | 否 |
| WI-E2E-2 | fixture 语料与 golden、生成脚本、CLAUDE.md 补一句 | WI-E2E-1 | S | 否 |
| WI-E2E-W | Windows 驱动加固：变更不重试、原始日志、窗口绑定、错误码、配置隔离核实 | 无（可与 1、2 并行；由 delegator 指派） | M | 是（Windows） |
| WI-E2E-3 | 第一批：快捷键矩阵编成旅程，加 Tier-0 与 Rust 对应测试 | WI-E2E-1、2；Windows 腿还依赖 W | L | 是 |
| WI-E2E-4 | ledger 映射与 `checkJourneyCoverage`、身份基线、rule 60 加一条 | WI-E2E-1，ADR P2 | M | 否 |
| WI-E2E-5 | 每个平台一次试点实测，定 smoke 集与运行清单，首轮 smoke（附加运行） | WI-E2E-3、W | M | 是 |
| WI-E2E-6 | 收编 ADR-0034 首批旅程、ADR-0047 spike 组、RC 与 watcher 合跑组；与旧门禁并跑一次 | WI-E2E-1；spike 组还要等 WI-005 比较完成 | M | 是 |
| WI-E2E-7 | 按区域补齐旅程，清空基线 | WI-E2E-4 | L（分批） | 是 |
| WI-E2E-8 | 存活报告与工具：skill 和 brief 模板改为读旅程；与用户定存活是否阻塞 | WI-E2E-5 | S | 否 |
| WI-E2E-9 | 阶段 B：WI-011 `run-journey` 执行旅程 | ADR-0047 WI-011，ADR P3 | M | 是 |

### WI-E2E-0 区域与不变量矩阵（prep）
- **Goal**：在写任何旅程之前，先知道覆盖要做多大（Codex 发现 24）。
- **Acceptance**
  1. 一张表：12 个 ledger 区域 × 每个在某平台上有效状态为 `Shipped` 的行 → 拟定的旅程（或跨区域旅程）、拟定的豁免类别、需要哪个驱动能力。
  2. 标出 smoke 的候选：每个区域一条主路径。
  3. 由此重估旅程数量与 full 的批数，替换 §9 的推断。
- **Touched**：只是 prep 文档，可放 `~/.mdpro-redesign/prep/`；结论回填到本计划。

### WI-E2E-1 旅程格式、REGISTRY、投影与 `journeys:check`
- **Goal**：把 §4.1、§4.4、§4.5（`journeys:check` 部分）、§4.6（清单 schema）、§4.8 落成可校验的契约。
- **Acceptance**
  1. `tests/journeys/README.md` 写明格式、判定词汇、聚合规则和 id 规则（引用 ADR P1）；README 里的计数由脚本生成。
  2. `tests/journeys/REGISTRY.md` 列出所有发放过的 id，包括已退役的。
  3. `scripts/journeys/check.mjs` 和 `pnpm journeys:check`，**每条规则都对应一个先失败后通过的测试**（`tests/journeys-check.test.ts`，node 环境）：坏 JSON；缺字段或枚举非法；`n/a` 没有 reason；id 重复；id 未登记；REGISTRY 删行；删了旅程文件；用例 id 重复或被复用；`supersedes` 指向不存在的 id、成环，或旧 id 仍被当作现行引用；`knownDefect` 指向不存在的 D；fixture 或 golden 的 sha256 不符；生成器 `--check` 失败；`tier0` / `rust` 文件不存在，或没有指回（只有单向引用）；投影文件解析失败；计数不一致；运行清单 schema 不合法，或中断的运行没有写原因。
  4. `scripts/journeys/projection.mjs` 有测试，覆盖归一化、计数、顺序、未知事件报告和意外失败行。
  5. `ci.yml` 的 `prose-checks` 按 §4.8 修改；在 PR、tag 和手动触发三种情况下各验证一次 base 的解析；base 缺失时失败。
  6. 样例旅程 `EJ-001`（冷启动打开文件，即 ADR-0047 J1a，含 `launcher` 步）通过检查。
- **Tests (first)**：上面每条规则先 RED 后 GREEN（rule 10）。
- **Touched**：`scripts/journeys/`、`tests/journeys/`、`tests/journeys-check.test.ts`、`package.json`、`.github/workflows/ci.yml`。
- **Risks**：schema 太严会卡住第一批迁移。缓解：`status: draft` 的旅程只做结构检查。
- **Rollback**：删掉脚本和 CI 步骤；目录文件本身无害。

### WI-E2E-2 fixture 语料与 golden
- **Acceptance**
  1. `fixture.json` 的格式（含 golden 来源）和 sha256 校验并入 `journeys:check`。
  2. 生成脚本覆盖大文件和 CRLF fixture，`--check` 通过。
  3. CLAUDE.md § Manual test fixtures 补一句：被复用的 fixture 搬进旅程语料。
- **Tests (first)**：sha256 不符、引用缺失、golden 键格式不对，各先写一个 RED 测试。

### WI-E2E-W Windows 驱动加固
- **Acceptance**
  1. §4.7 的三项都实现：变更单次执行、结果未知时停止；原始 JSONL 捕获；窗口标签与 CDP target、HWND 绑定，变更前核对身份。每一项都在 win-desktop 上演示一次。其中「响应丢失」用注入的方式演示：转发后断开链路，驱动报告「结果未知」，且不重放。
  2. `ui.ps1` 出错和 `cdp.mjs` 求值异常都返回非零退出码，有测试或演示。
  3. 核实 Windows 上的配置隔离办法（例如换一个 `APPDATA` 或配置目录）；做不到的话，写清楚「现场快照加恢复」的确切步骤。
- **Touched**：`.claude/skills/remote-windows-device-test/`；修重试的部分与 delegator 已登记的那个 D 项合并处理，不重复。

### WI-E2E-3 第一批：快捷键矩阵
- **Goal**：把今天最成熟的矩阵编成第一批旅程。依据：Settings 页 49 项、macOS 记录 86 例、Windows 记录与 v0.3.4 重跑。
- **Acceptance**
  1. 按设置页分类，每类一条旅程（File、Edit、Paragraph、Format、View）；用例沿用矩阵的 id，并保留模式（`EJ-0xx/F2`，模式 W / S 写进用例）；对照 CM-* 写进 Controls。
  2. 每个用例写清 `intended`。今天没有绑定的项写 `knownDefect`，指向对应的 D 行（没有的话由 delegator 登记），结论记 `XFAIL`，不把它改写成期望。
  3. golden 按 §4.2 的键存放，`fixture.json` 写明每份取自哪一次 PASS 记录和哪个构建；v0.3.3 / v0.3.4 的差异按 §4.2 处理。
  4. 每条旅程都有 Tier-0（前端载荷和序列化）与 Rust（写出的字节）对应测试。
  5. 用旅程文件在两个平台各跑一次（Windows 腿在 WI-E2E-W 之后），产出运行清单，与 2026-10-14/15 的矩阵记录逐用例对比，每处差异都写出解释。
- **Risks**：分类旅程只覆盖 5 个区域，其余区域靠 WI-E2E-7（见 WI-E2E-0 的矩阵）。

### WI-E2E-4 ledger 映射与门禁
- **Acceptance**
  1. `checkJourneyCoverage` 的六条规则（§4.5）各有一个 RED 测试。有效状态的计算要覆盖：inventory 是 Shipped 而 Windows 没有差异行（继承）；有差异行；`N/A`；标记只写在差异表里。
  2. 基线文件在采用它的那次提交里生成；用测试证明以下情况会被拒：新增身份；`renames` 的 `from` 仍在 ledger 里；一个旧豁免被一个新豁免顶替（数量不变，身份变了）。
  3. 第一批旅程覆盖到的行加上标记（全行或部分）；能说清的行写「无 UI 旅程」，带类别和测试路径。
  4. rule 60 的清单加一条：不能把一条用户可见的完整链路整体豁免。
  5. `pnpm ledger:check` 与 `ledger:build` 通过。

### WI-E2E-5 试点与首轮 smoke
- **Acceptance**
  1. 每个平台挑一条有代表性的旅程做试点，分开记录实现工时、无人值守耗时、操作者时间和设备占用时间（Codex 发现 25）；据此确定 smoke 集的大小。
  2. smoke 集定义写进 `tests/journeys/README.md`：每个区域一条主路径，或写明豁免。
  3. 在下一个 RC 的 release 包上，两个平台各跑一次 smoke，作为**附加运行**；运行清单落地，聚合结论如实记录（INCOMPLETE 照记）。
  4. 不撤下任何现有门禁。

### WI-E2E-6 收编 ADR-0034 / ADR-0047 旅程与合跑组
- **Acceptance**
  1. ADR-0034 决定 7 的五条旅程写成 EJ 条目；入口路由按 ADR-0034 决定 5 各占一条。
  2. J1a–J7b 写成 `group: "adr0047-spike"`，保持原顺序，用 `supersedes` 指向原 id；步骤与 `docs/test/20261002-adr0047-journeys.md` 一致。WI-005 的比较完成之前不改原文档。
  3. watcher 合跑组（D32 / D68 / D69 / D86）和 RC 回归组定义为 `group`。
  4. 在同一个 RC 上，新旧两套各跑一次，逐项对照，结论等价。这之后，sequencing doc 里 `#release-031-gate` 一类段落才改为引用旅程组。

### WI-E2E-7 按区域补齐
- **Acceptance**：每批一个 ledger 区域（遵守 rule 70 的批次规则）。每批结束时，基线里的身份减少；新旅程在两个平台上各有一次聚合结论为 PASS 的运行，或者写明 `N/A`。Windows 表里的行由 `Unknown` 改为有判定的状态时，在同一个提交里改 ledger，并引用运行清单。

### WI-E2E-8 存活报告与工具
- **Acceptance**：`journeys:check --freshness` 按 §4.6 的匹配规则输出，并进 release-gate skill；`gui-acceptance`、`remote-windows-device-test` 和 delegator 的 brief 模板改为「读旅程文件执行，产出运行清单」；与用户定存活警告是否升级为阻塞。

### WI-E2E-9 阶段 B 执行器
- **Acceptance**
  1. 定义 ` ```json steps ` 块，格式与 WI-011 `run-journey` 的输入一致；WI-011 的验收在它开工前改为「读本目录」。
  2. `run-journey EJ-NNN` 执行 `cli` / `launcher` / `page` 步，按 §4.4 判定，产出 §4.6 的运行清单。
  3. 失败路径测试：变更超时 → 结果未知，不重试；`native` / `human` 步上停下；中断的运行要在清单里写原因。
  4. 在同一个构建上，与阶段 A 的执行结果做投影比较，相等才算完成。ADR-0047 若选「只读探针」，本项改为只自动化判据部分。

## §7 Testing Procedures

- 计划本身没有代码。各 WI 的门禁按 rule 10、rule 60、rule 70 执行。
- 真机项按 §4.6 的 tier 跑，按 §4.7 的生命周期执行；运行清单放 `docs/test/journey-runs/`。Windows 的证据目录沿用 `docs/test/windows-audit-<date>-<who>/`。
- 截图名带运行 id 作前缀（教训：2026-10-15 的 F2 复查把旧的 `r3.png` / `r4.png` 覆盖了）。

## §8 Rollout

1. 用户审定 Q1–Q4 和 ADR P1–P3。
2. WI-E2E-0（prep），然后 WI-E2E-1、2（不需真机）；WI-E2E-W 并行进行。
3. WI-E2E-3（快捷键矩阵，第一批真机）和 WI-E2E-4（ledger 门禁，基线起步）。
4. WI-E2E-5：试点之后，在下一个 RC 上**附加**跑 smoke。
5. WI-E2E-6：合跑组迁入并与旧门禁并跑，等价之后才替代。WI-E2E-7 按区域推进，WI-E2E-8 收尾。
6. WI-E2E-9 等 ADR-0047 WI-011。

与在途工作的先后：不抢 ADR-0047 WI-005 的人工基线；不占 rule 70 的实现名额，除非 delegator 发放；真机部分的排期服从 dtrack 和 win-desktop 的可用时间。

## §9 成本与刻意不做的

**成本**（分开四类，Codex 发现 25；数字在 WI-E2E-0 和 WI-E2E-5 实测之前都是 `[推断]`）

| 类 | 估计 |
|---|---|
| 实现工时 | WI-E2E-1、4 各约 1–2 天；W 约 1–2 天；每条旅程连同 Tier-0 和 Rust 对应测试约半天到一天；阶段 B 另计 |
| 无人值守耗时 | smoke 约 45 分钟/平台/RC；full = 4–6 批 × 45 分钟 × 2 个平台 ≈ **每次发版 6–9 设备小时**，这还没算构建、传输安装、准备、对照、物理输入、重试、证据审阅和清理 |
| 操作者时间 | `human` 步（IME、物理 Esc）每次运行都要有人在场；delegator 写 brief、审记录的时间 |
| 稀缺设备时间 | mini 和 win-desktop 同时只能跑一个运行；参照：v0.3.4 的 Windows 检查从 08:23 跑到 12:35，含额外检查 |

另有维护成本：每个改变行为的提交都要同时改旅程或 golden（与 ledger 是同一条纪律）；迁移期间旧 brief 与运行清单并存，直到 WI-E2E-8。

**不做**
- 阶段 A 的托管 CI 真机旅程（Q4；是范围与成本的决定，等驱动和实测数字出来再议）。
- Linux（产品目标是 macOS 与 Windows）。
- 像素级截图比对。
- 性能与长时稳定性测试（E39：不建基准框架）。
- 真实 IME 的自动化：IME 步骤保持 `human`（D219 的教训）。
- 原生文件对话框的完全自动化：保持 `native`。
- 不替代 ADR-0047 的选型筛选：J1a–J7b 在 spike 里的角色不变。

## §10 Open Questions

1. Q1–Q4（§0）。
2. 候选驱动是否支持 Windows WebView2：WI-006 核实，影响 WI-E2E-9 的 Windows 一栏。
3. smoke 是否也在 debug 构建上跑（开发期更快），还是只在 release 包上跑。
4. Windows 的配置隔离能做到什么程度（WI-E2E-W 第 3 条）。

## §11 What this plan could not verify

- VMark 的旅程与不变量对照表在维护者本地，不在仓库里；VMark 其余 46 条旅程和 Tier-0 测试的本体没读到，所以「从不用日志」「Tier-0 只 mock `@tauri-apps/*`」「bridge 无鉴权」都未证实。
- 旅程数量与设备耗时都是估计，要到 WI-E2E-0 和 WI-E2E-5 才有实数。
- `docs/pending/` 下的快捷键 brief 只在主检出、未跟踪；WI-E2E-3 开工时以它和已提交的记录为准。
- Windows 驱动的三个缺口是读代码得出的；codex-audit 把 v0.3.4 Windows 运行里 E3 多出的 `z` 和 D208 里重复的 `x` 推断为重放的变更，未证实。

## §12 Revision log

**rev2**（2026-10-15，base `42094b2`）：按 Codex `review-plan-mv9470lo-rsc315` 修订。codex-audit 的报告在 `~/.mdpro-redesign/prep/codex-review-e2e-journeys-plan.md`。

| 发现 | 严重度 | 处置 |
|---|---|---|
| 1 Windows 表没有「怎么确认」列，继承的状态没人查 | High，阻塞 | §4.5：Windows 标记写在「说明」；按平台计算有效状态，包括继承 |
| 2 丢了 `launcher`；阶段 B 与 WI-011 重复 | High | §4.1 保留 `launcher`；§4.9、WI-E2E-9 改为扩展 WI-011 |
| 3 每次提交与 slow lane 矛盾 | Medium | §4.3：每条旅程必须有一个快速的每次提交测试 |
| 4 计数与基线有误 | Low | §3.1 改为 118 / 11 / 107、6 个目录、ledger 已有散文测试引用；base 改为 `42094b2` |
| 5 没有聚合规则 | High，阻塞 | §4.6：聚合规则，INCOMPLETE 不是绿；迁移进度与运行时覆盖分开报 |
| 6 行级链接会夸大覆盖 | High | §4.1 `covers` / `partial`；§4.5 部分覆盖标记 |
| 7 投影不够用 | High | §4.4：每条旅程一个带版本的投影，分前端和 Rust，保留未知事件报告，归一化器有测试 |
| 8 存活没有证据契约 | High | §4.6：运行清单；存活要求旅程修订和 golden 一致 |
| 9 检查规则缺验收 | Medium | WI-E2E-1 第 3 条：规则到测试的清单 |
| 10 backlog 只降没人强制 | High，阻塞 | §4.5 第 5 条：按身份的基线，含改名的处理；WI-E2E-4 第 2 条 |
| 11 CI 撑不住历史检查 | High，阻塞 | §4.8：`fetch-depth`、base 的取法、缺 base 即失败、不加依赖 |
| 12 Windows `log.sh` 撑不住判据 | High | §4.7 加固第 2 条，WI-E2E-W |
| 13 Windows 不能按窗口定位 | High | §4.7 加固第 3 条；做好之前多窗口用例记 BLOCKED |
| 14 重试会重放变更 | High，阻塞 | §4.7 加固第 1 条；工具缺陷由 delegator 另行登记 D 项 |
| 15 共用 golden 需要分层断言 | Medium | §4.3 分层表；假 fs 不得自己产出 golden |
| 16 可执行步骤契约未定义 | High | §0 Q1、§4.1：阶段 A 是结构化散文，可执行化明确推迟到 WI-E2E-9；改了否决 `.mjs` 的理由 |
| 17 已知缺陷会变成需求 | High | §4.1：`intended` / `knownDefect` / `XFAIL` / `XPASS` |
| 18 golden 选取不明确 | Medium | §4.2：golden 的键、规范来源、平台差异的规则 |
| 19 「无 UI 旅程」没有边界 | Medium | §4.5 第 4 条：封闭的类别、必须引用测试、链路不能整体豁免 |
| 20 采纳 / 否决理由不准 | Medium | §3.3、§5.1 重写理由；计数由目录生成 |
| 21 smoke 提前替代 RC 回归 | High，阻塞 | §4.6、WI-E2E-5/6、§8：先附加，等价之后才替代 |
| 22 未与 ADR-0034 对齐；spike 组是有序的 | High | §4.9、WI-E2E-6：收编 ADR-0034 首批旅程；`group` 保持顺序；WI-005 判据冻结 |
| 23 Windows 运行生命周期 | High | §4.7 生命周期表 |
| 24 覆盖估计与盘点对不上 | Medium | WI-E2E-0 矩阵 |
| 25 成本不完整 | Medium | §9 四类成本；WI-E2E-5 试点实测 |
| VMark 说法 1：`check-feature-map` 只查路径 | 错 | §3.2 改正 |
| VMark 说法 2：VMark 无 Windows | 言过 | 改为「没有 Windows 的 CI 腿」 |
| VMark 说法 3：运行时生成就不入版本、不可复现 | 错 | §3.3、D3 改了理由 |
| VMark 说法 4：VMark 的链接已漂移 | 言过 | 改为只说过时的散文计数和 ledger 从不引用 Tier-0 |

这次修订改变了 §4.5（标记位置、有效状态、基线）和 §4.6（聚合、替代顺序）的形状，也新增了 WI-E2E-0 和 WI-E2E-W；方向（Q1–Q4）没变，只是 Q1 的元数据从 YAML 改为 JSON。是否要先做一次简短复审再交用户，由 delegator 定。
