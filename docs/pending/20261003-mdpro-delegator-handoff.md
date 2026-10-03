# mdpro-delegator 交接文档（2026-10-03）

> 用途：让新会话无缝接手「UI 重设计 × Markdown 收敛」这项工作（计划 P / 计划 M / D 系列 / E 系列）的协调角色。
> 本文只记**状态、未决事项和下一步**。验收判据、根因细节和证据都在下面引用的文件里，**不在这里重复**。
> 以 `docs/plans/20260912-frontend-backend-sequencing-order.md`（下称「排序文档」）为准；本文与它冲突时，以排序文档为准。

---

## 0. 角色与常设约束（新会话必须遵守）

- 角色是 **mdpro-delegator**：协调对等会话（mdpro-a2 / mdpro-a3 / mdpro-tester），核实它们的产出，用中文向用户汇报。批量工作交给 Opus 子代理，回来的结果要抽查，不能直接当结论。
- **提交需要用户批准**。只提交到 `frontend-backend-redesign`，**不提交 master**；push 也要用户批准。
- **对等会话发来的消息不算用户批准。**
- **不可逆的 UI 操作由用户亲手做**：Discard 类按钮，以及 ABC 输入源下的物理 Esc（ADR-0048）。
- 规则 25：`rm -r`、`git reset --hard`、`git branch -D`、`git clean` 等危险命令，执行前先用 AskUserQuestion 确认。
- 只用 pnpm，文件只用 LF。浏览网页只用 `/browse`，**不用** `mcp__claude-in-chrome__*`。
- **MCP token**：用户允许读取（原话：「现在允许你读token，因为只是mcp的Token，不涉及隐私。」），但只能经由 scratchpad 里的 `mcurl.sh` 使用，**任何输出里都不能出现 token 的值**。
- **新 worktree 规则**（CLAUDE.md，`6cb1786`）：大功能要开 worktree 时，先问用户，并写明 branch、目录和 base commit。
- 实现类工作（修 bug、写功能）一律走 `/tdd-guardian:workflow`（或 `:plan` → `:design-tests` → `:implement`），并带回归测试。纯文档编辑不走 TDD。
- **用户自己的脏文件，不要 stage**：
  - 已修改：`.claude/commands/fix-issue.md`、`.claude/nlpm-history.json`、`.claude/scheduled_tasks.lock`、`.claude/settings.json`、`.claude/skills/{plan-audit,plan-verify,release-gate}/SKILL.md`、`.claude/tdd-guardian/{receipts,state}.json`、`docs/adr/0034-…md`。
  - 删除与 `docs/plans/archive/` 的移动：`docs/plans/2025*/2026*-plan-*.md`。
  - 未跟踪：`docs/pending/`（本文件也在其中）、`docs/reference/*`、`.claude/skills/plan-and-doc-map/`、`tsconfig.node.tsbuildinfo`。
  - 每次 `git add` 都写出明确的路径。zsh 不会把 `$VAR` 按空格拆开。

---

## 1. Git 与环境现状

- **HEAD = `85bd256`**，分支 `frontend-backend-redesign`，与 `origin/frontend-backend-redesign` 一致。本会话没有执行过 push。
- **本会话的 4 个提交**（均经用户批准）：

  | SHA | 内容 |
  |---|---|
  | `6cb1786` | docs(claude)：新增「大功能 worktree 先请求用户同意」规则 |
  | `9633720` | chore(test)：覆盖率阈值提到实测地板，lines / functions / branches / statements = 73 / 80 / 91 / 73，涉及 `vitest.config.ts` 和 `.claude/tdd-guardian/config.json`。实测值为 73.62 / 80.80 / 91.38 / 73.62 |
  | `9cf352d` | docs(plans)：WI-0.1 预跑记录 `docs/plans/20261002-wi-0-1-baseline-draft.md`，并修正计划 P、计划 M 和排序文档里的过时说法（含 E6 更正） |
  | `85bd256` | docs(plans)：关闭 3.8 和 D 系列复测，登记 D43–D46，同时更新 CHANGELOG、feature-ledger(.md/.html) 和两份 `docs/test/20261002-*` 记录 |

- **Release 包**：`src-tauri/target/release/bundle/macos/mdpro.app` 由 `ef91e24` 构建，`src/` 和 `src-tauri/` 与 `e471198`、`85bd256` 没有代码差异（后两者之间只改了文档和阈值）。所以这个包仍可用于真机复测。复测前照 gui-acceptance §3 检查三个陷阱。
- **Worktrees**（`git worktree list`）：

  | 路径 | 说明 | 处理 |
  |---|---|---|
  | 主 checkout | `85bd256` | — |
  | `~/.codex/worktrees/d809` | Codex 管理 | 不要碰 |
  | `mdpro-wt/chore-d30-tauri-upgrade-trial` | `1f2de1a`，D30 Tauri 升级试验 | 保留 |
  | `mdpro-wt/d41`（branch `d41-source-tab-gaps`） | 用户说会自己删 | 不要碰 |
  | `mdpro-wt/feat-adr0047-agent-control-channel` | `e471198`，另一会话的 ADR-0047 工作（`docs/adr/0047…`、`docs/plans/20261002-plan-agent-control-channel.md`） | 不要碰 |
  | `mdpro-wt/test-3.8-perf-exit`（branch `test/3.8-perf-exit`） | 3.8 复测用，已完成。创建时没有先问用户，违反了新规则，已向用户说明 | **等用户批准后**执行 `git worktree remove ../mdpro-wt/test-3.8-perf-exit && git branch -d test/3.8-perf-exit` |

- **Scratchpad**（会话专属，会被清空）：`$S=/private/tmp/claude-501/-Users-jackcheng-Documents-01-Coding-mac-app-mdpro/833a7881-d1b9-4e76-80c5-b63f053623e0/scratchpad`
  - `mcurl.sh`：带 token 头的 curl 包装，用于驱动 MCP HTTP API，用法见 `docs/guide/mdpro-mcp-guide.md`。scratchpad 被清空后要按该指南重建，**不要把 token 写进仓库**。
  - `run3/config.backup.json`：用户 `~/.mdpro/config.json` 的备份（SHA-1 `8be44fa1…`，SHA-256 `47cc34fb…`）。目前线上的 config 与它逐字节一致。要做「损坏 config」类测试，先备份，测完还原，再用 sha 校验。
  - `handoff-3.8-and-dtrack.md`、`partA-report.md`：3.8 / D 系列复测的派单和报告原文。
  - tester 的 scratchpad（含 perf 原始采样）：`/private/tmp/claude-501/-Users-jackcheng-Documents-01-Coding-mac-app-mdpro-wt-test-3-8-perf-exit/93f76f69-de30-48ec-8edd-eedcb8a0f9ea/scratchpad`
- **工具坑**：
  - rtk 包装器会改写 git、grep、wc 的输出，所以用 `/usr/bin/git`、`/usr/bin/grep`、`/usr/bin/wc`。它还把覆盖率命令的输出改成了 JSON，结果改从 `coverage/coverage-summary.json` 的 mtime 和 totals 核实。
  - zsh 不会把 `$VAR` 按空格拆开。
- **MCP server**：本会话末尾 `mdpro` MCP server 显示 CONNECTION_CLOSED（app 没开时属于正常现象）。需要时先启动 app，再重连。

---

## 2. 总体阶段状态（详见排序文档）

| 阶段 | 状态 | 要点 |
|---|---|---|
| 1 基础设施 | 🔄 | 1.4–1.10 ✅；1.1（CI 触发）和 1.2（分支保护）⏭️ 移到另一个 PR（E25）；1.3 ⛔ |
| 2 | ✅ | 用户裁定（2026-10-02）：`src/App.css`、`TabBar/`、`Sidebar.tsx`、`FileItem.tsx` 仍在 HEAD 上，但阶段 2 仍算 ✅ |
| 3 | ✅ | 3.0–3.8 全部完成。3.8 出口性能复测记录见 `docs/test/20261002-stage3-exit-perf-retest.md`，D6 性能楔子随之结案 |
| 4 = 计划 P 主体 | ⬜ **已解锁、未开工** | WI-0.1 预跑已完成，正式 WI-0.1 尚未跑（见 §3） |
| 5 = 计划 M 余项 | ⬜ | 5.1–5.5，排在阶段 4 之后 |

**3.8 的保留意见**（已写入测试记录，不阻塞）：
- dense-math.source 上出现过一次（n=1）8–12 s 的卡顿；
- 全程电池供电；
- 观察窗口不足 5 分钟；
- release 包没有 DevTools，切换和关闭耗时的基线口径数字缺失；
- `sample` 栈顶没有采集；
- 只测了单一主题。

---

## 3. 计划 P（`docs/plans/20260911-plan-ui-redesign.md` 及子目录 `docs/plans/20260911-ui-redesign/`）

### Stage 0（当前入口）
- **WI-0.1 基线**：预跑已在 `e471198` 上完成，记录在 `docs/plans/20261002-wi-0-1-baseline-draft.md`：
  - build 通过；
  - 316 个测试文件，4378 通过，5 todo；
  - cargo 1112 通过，2 ignored；
  - 依赖未变。

  用户裁定 1–4 见该文件 §6：
  1. 这次只算预跑；
  2. 阈值提到实测值附近（已在 `9633720` 落实）；
  3. 阶段 2 仍为 ✅；
  4. 同意。

  **正式 WI-0.1 要在开工时的 HEAD 上重跑**，并按 `baseline-protocol.md` 落盘。
- **WI-0.2**：字面量清单。**WI-0.3**：QA 矩阵。**WI-0.5**：CSS 文件地图和规则 33 提案。这三项都是纯读代码加写文档，可以并行。
- **WI-0.4**：基线截图，需要 computer use 和 release 包，并且要拍浅色、深色两个主题。
- **WI-0.6**：设计评审。
- **停止点 1**：需要用户明确批准；A1–A12 和 Q1–Q14 要么回答、要么豁免。**Q15、Q16 仍未决。**

### 已知会挡住后续 WI 的前置项
- **WI-4.21**：依赖 E23。MCP 事件要按窗口路由（`emit_to`），目前 `http_server.rs` 里是 `window_label: None`。
- **WI-4.26**：依赖 E37 修复（`src/hooks/useMcpSync.ts:199` 用 `content.length` 当 hash）。
- **WI-4.19**：迁移 `useMenuEvents` 时，要保留或有意删除 `ui.menu.listen`（见排序文档 D31 行末）。另外 `stage-4c-foundation.md` 里的 listen 站点清单已经过期。
- **Stage 5 入口**：需要用户先对 E6 做出裁定（见 §5）。

### 本会话核实并写进计划的更正（`9cf352d`）
- G0 已在 `d6d8f38` 里重写。
- E38 已在 `2a0e1a4` 修好（`tocStore.ts:153`）。
- guardian config 已是 v2。
- E6 半修，详见 §5。

---

## 4. D 系列（缺陷轨道）全量状态

完整描述和证据见排序文档的 D 表；真机证据见 `docs/test/`，最新两份是 `20261002-dtrack-device-retest.md` 和 `20261002-stage3-exit-perf-retest.md`。

### 已关闭 / 已修好
D1, D2, D5, D6（性能楔子；排除项保留为观察项）, D7–D18, D20, D21, D22, D23, D26, D27, D29, D33, D34, D35, D37, D40, D41。

### 仍开着

| D | 级别 | 状态 | 关闭它还差什么 |
|---|---|---|---|
| D19 | MUST | ✅ 已修复，未关闭 | 判据 6a/6b 已于 10-02 通过。还差**判据 1**（保存面板开着时，经 MCP `write_document` 写入；现在可以用 `mcurl.sh`）和**判据 7**（保存过程中关标签，手工很难插进去，可能需要 MCP 或人为放慢） |
| D24 | BLOCK | 🔧 第 1–5b 步完成 | DC-R 失败，另立 D43。**D-6 NOT VERIFIED**（需要缩放系数为 1 的外接屏）。**第 6 步没做**（ADR-0031） |
| D25 | MUST | 🔧 issue 3 完成 | 剩 ADR-0042 issue 1（坏配置时开关显示「关」，并出现两条重复提示）、issue 2（pinning 测试），以及未接线的偏好项（autoApproveEdits、快捷键、导出目录/样式、图片目录、startOnLaunch）。「Stopping」徽标和 Dock 跳动 NOT VERIFIED |
| D28 | SHOULD | 🔧 代码已修（`7ef68d8`） | 没有真机项。需要观察 unit 车道是否还有间歇性红 |
| D30 | — | 提案中 | ADR-0034 处于 Proposed；**用户本地对 ADR-0034 有改动，不要碰**。worktree 是 `chore-d30-tauri-upgrade-trial` |
| D31 | MUST | 🔧 计数判据通过 | 补跑「每个窗口打字约 30 s」，并核对每条 `ui.menu.select` 的 `windowLabel` 是否为当时聚焦的窗口 |
| D32 | SHOULD | 👁 诊断日志已落地 | 真机 D32-R0…R7 没跑；机制（xattr 被报成 `Modify(Metadata)`）尚未证实 |
| D36 | SHOULD | 🔎 未修 | 源码模式下只移动光标时，光标不同步到影子存储 |
| D38 | SHOULD | 🔎 未修 | 两个确认框排队时，第二次批准后光标跳到末尾 |
| D39 | SHOULD | 🔎 未修 | 晚解析的围栏导致 tableContext 短暂过期 |
| D42 | SHOULD | 🔎 未修 | Reload 提示被「Unsaved changes」对话框盖住（`App.tsx` 按 DOM 顺序绘制） |
| **D43** | MUST | 🔎 新，未修 | config 损坏时，新窗口把全应用的「最近打开」菜单替换成只有它自己的文件；预期的 `preferences.recent_files.buffer` warn 也没出现。可能根因（读代码，**尚未经测试证实**）：菜单是全应用共享、最后写入者胜出；`App.tsx:176-180` 的 effect 依赖 `[recentFiles, viewMode]`；`useRecentFiles` 是按窗口的状态 |
| **D44** | MUST | 🔎 新，未修 | 打开「保存时自动重排表格」后，单元格多于表头的行，多出的格会被静默丢掉。修法二选一：先提示用户，或保留/补齐列。**需要用户选** |
| **D45** | SHOULD | 🔎 新，未修 | 关掉所有 tab 后，WebContent 的 RSS 停在约 1.755 GB。可能只是 WebKit 留着已释放的内存不还；要定性需要能控制 GC 的 debug 包 |
| **D46** | MUST | 🔎 新，根因已确认 | 外部打开超过 10 MB 的文件时没有任何提示，还留下一个空窗口。根因：`src/hooks/useDocument.ts:82-92` 的 `openDocumentFromPath` 吞掉了非编码类错误、返回 null。⌘O 路径正常；拖放路径 NOT VERIFIED。feature-ledger「10 MB 上限」一行已降为 Partial |

### 未登记的 NOTE（复测中观察到，用户未要求登记）
- **F2**：⌘⇧N 新开的窗口都落在 `156,71`，没有层叠。ledger 里「新窗口会层叠」的说法已在 `85bd256` 更正。
- **F3**：有重复的日志行。
- **F4**：`mcp.http_server.stop` 只在退出时记录。
- **F5**：MCP 确认框外点击会被当作 Reject。

---

## 5. E 系列（计划 P 决策登记 E1–E39）中仍未了结的项

| E | 状态 | 说明 |
|---|---|---|
| **E6** | ⚠️ 半修，**待用户裁定** | `2cb2e01` 已经让所有读-改-写路径在加载失败时不再覆盖 config.json（`preferences.rs:79/:176`、`window.rs:116`、`logging.rs:104`、`preferences_mcp.rs:47`；测试在 `preferences_tests.rs:167/:207`）。但 TODOS P1 要求的「备份 + toast」策略**没做**。加载失败是静默的（`App.tsx:239`），写入失败**会**弹 toast（`preferencesService.ts:84-93`；子代理曾说是静默的，已更正）。**我的建议：判为「未满足」**，进入 Stage 5 前把备份和加载失败 toast 补上 |
| E23 | 未做 | MCP 事件 `emit_to` 路由，挡住 WI-4.21 |
| E25 | 延后 | CI 触发和分支保护（阶段 1 的 1.1/1.2）移到另一个 PR |
| E37 | 未修 | `useMcpSync.ts:199` 用 `content.length` 当 hash，挡住 WI-4.26 |
| E38 | ✅ | `2a0e1a4` |
| E11 / E27 | ✅ 已调整 | 覆盖率阈值改为 73/80/91/73（`9633720`） |
| E26 / E29 / E39 | 内联决策 | Stryker 不采用、不建 benchmarking harness 等。下次被质疑或被依赖时再提升为 ADR，**不要批量回填** |
| 其余 | — | 是后续 Stage 的设计决策，开工到对应 WI 时再看 |

相关 ADR：
- 0004：3.8 按表面逐一比较，挂起的形态按名称排除；
- 0023：不用 ESLint；
- 0031 / 0032：偏好按依赖顺序恢复，并作为 GUI 验收判据；
- 0034：D30，Proposed；
- 0042：MCP 确认；
- 0045：Esc 交给 DOM 顺序中最后一个对话框；
- 0047：agent control channel，另一会话负责；
- 0048：被 IME 吞掉的 Esc 不做恢复。

---

## 6. 待用户裁定 / 批准的事项（新会话开场先问）

1. **E6**：按计划字面判为已满足，还是要求补上 TODOS 的备份 + toast 策略？（建议：判为未满足，补上。）
2. **删除 `mdpro-wt/test-3.8-perf-exit` worktree 和它的分支**：规则 25 要求先确认，命令见 §1。
3. **D44 修法**：保存前提示用户，还是保留/补齐多出的列？
4. **下一步工作的排法**：建议见 §7。
5. 计划 P 停止点 1 之前要回答的 **Q15 / Q16**。

---

## 7. 建议的下一步（按优先级）

1. **修 MUST 级新缺陷**。每项走 `/tdd-guardian:workflow`，先写 RED 回归测试；同一提交里更新排序文档的行和 ledger；修完后真机复验（见 §8）。
   - **D46**（根因已确认，改动最小）：`openDocumentFromPath` 不再吞掉 too-large 类错误，外部打开路径要弹 toast，并且不留空窗口。
   - **D43**：先写测试证实根因，再修「最近打开」菜单的全局/按窗口归属问题。
   - **D44**：等用户选定修法再动。
2. **计划 P Stage 0 并行启动**：
   - 在当时的 HEAD 上正式重跑 WI-0.1；
   - WI-0.2、WI-0.3、WI-0.5 交给 Opus 子代理并行做（纯读代码、写文档）；
   - WI-0.4 截图另排一次 computer-use 会话；
   - 全部完成后进入停止点 1，交给用户审批。
3. **E6 修复**（如果用户判为未满足），赶在 Stage 5 之前完成。
4. **E23、E37 修复**，赶在 WI-4.21、WI-4.26 之前完成，可以穿插在 Stage 0–3 期间做。
5. **补齐真机项**，让 D19、D31 能关闭（见 §8）。
6. SHOULD 级的 D36、D38、D39、D42、D45 排在后面；D32 需要先跑 R0–R7。

---

## 8. 真机验证清单（完整）

全部用 `/gui-acceptance`，并遵守以下通用要求：
- 用 release 包（或注明是 debug 包），复测前排除 gui-acceptance §3 的三个陷阱；
- fixture 放在 `tests/manual-fixtures/`，**跑的时候用 scratchpad 里的副本**；
- 日志按字节偏移切片；
- 碰 config 的测试，先备份 `~/.mdpro/config.json`，测完还原并校验 sha；
- Discard 按钮和物理 Esc 由用户亲手操作；
- 无法执行的判据记为 NOT VERIFIED，并写明阻塞原因，不能悄悄升级为通过。

### A. 现在就能跑（release 包 `ef91e24` 即可）
| # | 项 | 内容 | 关闭什么 |
|---|---|---|---|
| A1 | D19 判据 1 | 「另存为」面板开着时，经 `mcurl.sh` 调用 MCP `write_document` 写入。验证保存完成后编辑没有被覆盖、文档仍标脏，`editedDuringSave` 日志恰好 1 条。Source 和 WYSIWYG 两种模式都要跑 | D19（还需 A2） |
| A2 | D19 判据 7 | 保存过程中关闭该标签：用大文档拉长 `save_file` 耗时，或在保存时经 MCP 触发关闭。验证不丢数据，`closedDuringSave` 计数正确。手工确实插不进去时记 NOT VERIFIED 并说明原因 | D19 |
| A3 | D31 补跑 | 开 4–5 个窗口，每个窗口打字约 30 s 制造重渲染，然后按 ⌘⇧N、切换主题、⌘S。每次按键恰好对应 1 条 `ui.menu.select`，且其 `windowLabel` 等于当时聚焦的窗口 | D31 |
| A4 | D46 拖放路径 | 把 over-10mib.md 从 Finder 拖进窗口，需要先申请 Finder 授权。修复前先记下当前行为 | D46 证据补全 |
| A5 | D25 「Stopping」徽标 | 在服务停止的过渡期间观察徽标；过渡只有约 18 ms，可能只能靠日志或录屏佐证。Dock 跳动对测试工具不可观察，保持 NOT VERIFIED | D25 子项 |
| A6 | D32 R0–R7 | 外部打开另一个文件、路由到别的窗口后，干净文件是否弹出 External change 提示。用诊断日志证实或推翻 xattr 假设 | D32 定性 |
| A7 | 3.8 卡顿复现 | 插电后在 dense-math.source 上观察 ≥5 min；如果再出现 8–12 s 卡顿，立刻 `sample <pid>` 取栈顶 | 3.8 保留意见 |
| A8 | 双主题补测 | 3.8 和 D 系列复测只跑了单一主题。规则 34 要求 Reload 提示、MCP 确认框、toast 这类 UI 在浅色和深色下各看一次 | 规则 34 |

### B. 需要特殊条件
| # | 项 | 条件 | 内容 |
|---|---|---|---|
| B1 | D24 D-6 | 缩放系数为 1 的外接屏 | 窗口几何跨屏恢复 |
| B2 | 3.8 基线口径数字 | debug 包（`CARGO_TARGET_DIR=target/gate2-bundle pnpm tauri build --debug --bundles app`） | 用 DevTools 量 tab 切换、关闭和最长任务的耗时 |
| B3 | D45 定性 | 能控制 GC 的 debug 包 | 区分泄漏与 WebKit 不归还内存 |

### C. 修复后必须真机复验
| # | 项 | 复验内容 |
|---|---|---|
| C1 | D46 修复 | 三条路径（`open -a` 外部打开、⌘O、拖放）打开 over-10mib.md：都有 toast，都不留空窗口或空 tab，日志不含路径或内容 |
| C2 | D43 修复 | 重跑 D24 DC-R：recentFiles 有 7 项以上、开着 b/c/d 三个窗口时，把 config.json 改成非法 JSON，再 `open -a` 打开 a.md。「最近打开」应为本会话条目加 a.md；切换焦点后菜单也正确；有 `preferences.recent_files.buffer` warn；损坏的字节没有被改写。**测前备份 config，测后还原** |
| C3 | D44 修复 | 打开自动重排后对 `\| g \| h \|Z` 按 ⌘S，按用户选定的修法验证（有提示，或保留了「Z」）；同时回归 D19 的 6a/6b |
| C4 | E6 修复 | config 损坏时冷启动：会生成备份文件，用户能看到加载失败的 toast，原有的损坏字节不被覆盖 |
| C5 | E23 / E37 修复 | 多窗口下 MCP 写入只落到所属窗口；改动不改长度的内容（例如同长度替换）也能触发同步 |
| C6 | 任何修复之后 | 按 gui-acceptance §10，**整张判据表全部重跑**，不能只跑失败的那一条 |

### D. 计划 P Stage 0
| # | 项 | 内容 |
|---|---|---|
| D1 | WI-0.4 | 按 WI-0.3 的 QA 矩阵拍浅色、深色基线截图。截图**不进仓库**，优先用 `zoom` 截局部，尽量少截全屏，保护用户隐私 |

---

## 9. 建议调用的 skills

| Skill | 用途 |
|---|---|
| `/tdd-guardian:workflow`（或 `:plan` → `:design-tests` → `:implement` → `:gate` → `:review`） | D46、D43、D44、E6、E23、E37 的修复，以及计划 P 各 WI 的实现。先确认 `.claude/tdd-guardian/config.json` 是 `enabled: true` 且车道可用；不满足时请用户运行 `/tdd-guardian:init` |
| `/tdd-guardian:status` / `:probe` | 开工前查看 guardian 状态 |
| `/gui-acceptance` | §8 全部真机项 |
| `/cc-suite:review-plan` | 计划 P Stage 0 产出的 QA 矩阵、CSS 地图、规则 33 提案等计划类文档，交给 Codex 独立审查 |
| `/browse` | 任何网页浏览（禁止 claude-in-chrome） |
| `/bump` | 发版时同步三个版本号文件 |
| `/mattpocock-skills:handoff` | 下一次交接 |

---

## 10. 关键文件索引

- 排序与状态：`docs/plans/20260912-frontend-backend-sequencing-order.md`
- 计划 P：`docs/plans/20260911-plan-ui-redesign.md`，以及 `docs/plans/20260911-ui-redesign/`（baseline-protocol、decisions、risks、stage-0-inventory … stage-5-source-font、appendices）
- 计划 M：`docs/plans/20260912-plan-markdown-source-consolidation.md`
- WI-0.1 预跑：`docs/plans/20261002-wi-0-1-baseline-draft.md`
- 真机记录：`docs/test/20261002-dtrack-device-retest.md`、`docs/test/20261002-stage3-exit-perf-retest.md`，以及更早的 `docs/test/2026092*-*.md`
- 功能台账：`docs/feature-ledger.md`（改完跑 `pnpm ledger:check` 和 `pnpm ledger:build`）
- 变更日志：`CHANGELOG.md`（`## [Unreleased]`）
- 待办：`TODOS.md`（E6 的 P1 备份 + toast 策略）
- 经验：`progress.md`
- MCP 手工驱动：`docs/guide/mdpro-mcp-guide.md`
- 早先的交接：`docs/pending/20260927-adr0040-handoff.md`
