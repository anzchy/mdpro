# WI-0.1 基线 —— 预跑（2026-10-02，`e471198`）

**状态：预跑（PRE-RUN），不是正式 WI-0.1。** 本文记录 2026-10-02 在 `e471198` 上的一次实测、它暴露的冲突，以及用户当天的裁定（§6）。
按计划 P 的顺序表，WI-0.1 排在第 3 步（阶段 3，含 3.8）出口之后；本次拍在 3.8 结案**之前**，所以只算预跑：
**不豁免顺序、不写 ADR，正式 WI-0.1 在 3.8 结案后按本文 §2、§3 的命令重跑**，届时 WI-0.1 才可能标 ✅。
下文 §1–§5 保留预跑当时的记录（含当时「未应用」「待裁定」的措辞），裁定与已落地的文档修改见 §6。

**依据**（两者冲突时以计划 P 为准，本文只报告冲突、不替它裁决）：

- 计划 P 索引 `docs/plans/20260911-plan-ui-redesign.md`（下称 P）：`:451-453` 顺序表（第 4 步「WI-0.1 re-run」），
  `:473` 死代码删除先于基线，`:475` G0 文件检查改写，`:268-270` T0，`:240` Stage 0 门禁，`:432` 本地验证四件套。
- WI-0.1 的**权威定义**在 P 的 Stage 0 文件 `20260911-ui-redesign/stage-0-inventory.md` § *WI-0.1 — Readiness and baseline gates*
  （本次读取时位于 `:40-45`），验收在同文件 § *Stage 0 acceptance criteria*（`:80-81`、`:85`）。
- G0 的现行文本在 `20260911-ui-redesign/baseline-protocol.md` § *Common gate G0*（本次读取时 `:109-123`）。
- 排期视图 `20260912-frontend-backend-sequencing-order.md`（下称排期文档）：总览表阶段 4 行、§ 阶段 4、§ 贯穿全程的门禁。

> 「重跑」指什么：仓库里**没有**先前 WI-0.1 的产出文件（`$TMPDIR/mdpro-redesign/` 不存在；`git log --all -S"WI-0.1"`
> 只命中计划文档的提交）。被「重跑」的是 `baseline-protocol.md` § *Baseline (observed at `0a3675e`)* 那一组观察事实，
> 以及 WI-0.1 自身五个步骤。本文按这个理解执行。

---

## 1. WI-0.1 要求什么

| # | 要求（出处） | 本次结果 |
|---|---|---|
| R1 | `/tdd-guardian:status`；按 **HEAD** 判断 config 是否就绪（stage-0-inventory § WI-0.1 第 1 条） | **已采集（代理方式）**，见 §3.1 |
| R2 | 在未动的树上跑 G0，记录既有失败（第 2 条；验收 `:81`） | **已采集**：build / test:run / typecheck:tests / coverage / cargo test 全部 exit 0；E31、E39 两行不适用，见 §3.2 |
| R3 | 保存基线快照供 G0 文件集检查（第 3 条原文是 `git status --porcelain`；已被 G0 改写取代，见 §2） | **已采集**（按改写后的三件套），见 §3.3 |
| R4 | 逐条复核 `baseline-protocol.md` 的 Baseline 事实，差异记入 Appendix A（第 4 条） | **部分**：字面量表、死代码候选、门禁与工具、若干热点已复核；热点逐行全扫与写入 Appendix A **待做**，见 §3.4 |
| R5 | 列出从磁盘读 app CSS 的测试：`grep -rln "\.css" tests`（第 5 条） | **已采集**，见 §3.5 |

---

## 2. G0 文件检查改写 —— 实际状态与建议文本（预跑时未应用；**2026-10-02 已按下文采纳**，见 §6）

**P `:475` 把改写写成将来时（"is rewritten before WI-0.1"），但它已经落地**：`baseline-protocol.md` § *Common gate G0*
的「No file outside the work item's declared file set changed」一行及其三个子条（全局基线三件套、每 WI 自有起点、按内容 diff 核对）
由 `d6d8f38`（2026-09-12，WI-0.0 item 1.9）写入；排期文档阶段 1 表 1.9 记 ✅。所以改写本身无需再起草。

仍然残留旧口径、与改写后 G0 矛盾的有三处，下面是建议替换文本（只是提案，未改任何文件）：

1. **stage-0-inventory § WI-0.1 第 3 条**（现文：「Save `git status --porcelain` to `$TMPDIR/mdpro-redesign/git-status-baseline.txt`. G0's file-set check compares against it.」）
   建议改为：
   > Record the global baseline per `baseline-protocol.md` § *Common gate G0*: the start SHA (`git rev-parse HEAD`), the content of the dirty changes (`git diff --binary > baseline.patch`, `git diff --cached --binary > baseline-staged.patch`), and the untracked inventory (`git status --porcelain --untracked-files=all`). This baseline is for the record only; every work item checks against its **own** start snapshot, never against this one.
2. **stage-0-inventory § Stage 0 acceptance criteria**（`:85` 后半句「and the baseline `git status --porcelain` is saved」）
   建议改为：「and the global baseline (start SHA, dirty-change patches, untracked inventory) is saved」。
3. **baseline-protocol § Common gate G0「No new dependency」行**（现文：「`git diff package.json src-tauri/Cargo.toml` is empty」）
   这是全局工作树相对 index 的检查，不是相对本 WI 起点的检查，和上一行改写后的口径不一致。建议改为：
   > No new dependency: `package.json`, `pnpm-lock.yaml`, `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock` are byte-identical to the work item's own start snapshot, unless one of them is in that work item's declared file set.

   附带事实：P `:475` 说这条「already unsatisfiable」，因为 `package.json` / `pnpm-lock.yaml` 在工作树里被改过。**今天已不成立**：
   `git diff --stat -- package.json pnpm-lock.yaml src-tauri/Cargo.toml src-tauri/Cargo.lock` 输出为空（2026-10-02T09:0xZ），
   旧形式现在是可满足的。改写建议仍然成立，理由换成「口径不一致」，而不是「不可满足」。

**每 WI 起点快照的建议命令**（供 Stage 0→5 每个 WI 第一次编辑前执行；目录放在会话 scratchpad，不进仓库）：

```bash
D=<scratchpad>/wi-<id>; mkdir -p "$D"
/usr/bin/git rev-parse HEAD > "$D/start-sha.txt"
/usr/bin/git diff --binary > "$D/start.patch"
/usr/bin/git diff --cached --binary > "$D/start-staged.patch"
/usr/bin/git status --porcelain --untracked-files=all > "$D/start-status.txt"
/usr/bin/git status --porcelain --untracked-files=all | awk '{print $2}' \
  | while read f; do [ -f "$f" ] && shasum -a 256 "$f"; done > "$D/start-hashes.txt"
```

收尾检查 = 重算 `start-hashes.txt` 并 diff，**再加上**相对 `start-sha` 的 `git diff --name-only`。前者抓「已脏文件被二次改坏」，
后者抓「原本干净的文件被改」。两者并集必须是本 WI 声明文件集的子集。

---

## 3. 实测值

环境：macOS（Darwin 25.3.0）、Apple Silicon、node v22.22.3、pnpm 10.26.1。
⚠️ `cargo test` 与 `pnpm coverage` 是**并发**跑的，所以下面的耗时只是记录，不能当性能数据（E39 也禁止把毫秒数当门禁）。

### 3.1 tdd-guardian 就绪（R1）

- **方式**：没有调用 `/tdd-guardian:status` 技能，因为它会写 `.claude/tdd-guardian/state.json`，而这个文件是用户未提交的改动。
  改为直接读 `git show HEAD:.claude/tdd-guardian/config.json`，再真实执行两条 lane 的命令（§3.2）。
- **结果**：HEAD 上是 v2：`schemaVersion: 2`、`enabled: true`，两条 lane 为 `unit`（`pnpm exec vitest run --coverage`）和 `rust`
  （`cargo test --manifest-path src-tauri/Cargo.toml`），`coverageThresholds` 31/61/82/31（预跑时的值；2026-10-02 已上调到 73/80/91/73，见 §6），`requireMutation: false`，3 条 criticalPaths；
  `git diff HEAD -- .claude/tdd-guardian/config.json` 为空。两条 lane 的命令都实际跑通了。
- **待补**：如果要以技能输出为准，需由用户运行 `/tdd-guardian:status`。

### 3.2 未动树上的 G0（R2）

| G0 行 | 命令 | 起止（UTC） | 结果 |
|---|---|---|---|
| build | `pnpm build` | 09:05:57 → 09:06:01 | **exit 0**。两条 Vite 警告：`@tauri-apps/api/window.js` 同时被动态和静态导入；有 chunk > 500 kB。都是既有警告 |
| test | `pnpm test:run` | 09:14:26 → 09:15:13 | **exit 0** · 316 个测试文件全部通过 · **4378 passed / 5 todo / 0 failed / 0 skipped**（共 4383）· 45.74 s |
| typecheck（P `:432`） | `pnpm typecheck:tests` | 09:06:01 → 09:06:05 | **exit 0** |
| coverage（E27） | `pnpm coverage` | 09:06:05 → 09:07:58 | **exit 0** · 用例数同上 · Lines **73.62%**（11594/15748）· Statements **73.62%**（11594/15748）· Functions **80.80%**（745/922）· Branches **91.38%**（3668/4014） |
| cargo test | `cd src-tauri && cargo test` | 09:05:59 → 09:13:38 | **exit 0** · **1112 passed / 0 failed / 2 ignored**（lib 1077+1 ignored；`mdpro_mcp` bin 13；集成测试 1+10+6+0(1 ignored, `perf_render_corpus`)+1+4；doc-tests 0）· 459 s · 2 条编译警告，其一为 `src/services/open_route/plan_tests.rs:6` 的未用 import `std::collections::HashSet` |
| 无新依赖 | `git diff --stat -- package.json pnpm-lock.yaml src-tauri/Cargo.toml src-tauri/Cargo.lock` | 09:0x | **空** |
| Milkdown 浏览器套件（E31） | — | — | **不适用**：仓库里没有浏览器模式配置（没有 `@vitest/browser`/playwright，`vitest*.config.*` 里也没有 `browser:`）。G0 原文是「once it exists」 |
| 性能确定性断言（E39） | — | — | **不适用**：渲染隔离断言属于 Stage 4 的工作项，今天还不存在 |
| 无截图 / 未提交未推送 | — | — | 本次没有提交，也没有推送 |

**既有失败：无。** 5 个 todo 分别在 `tests/caret-anchor-law.test.ts`（1）、`tests/data-loss-logic.test.ts`（2）、`tests/data-loss-behavior.test.ts`（2），
vitest 的单文件行把它们显示为「skipped」，汇总行显示为 todo。

### 3.3 全局基线（R3，按改写后的 G0）

- **起点 SHA**：`e4711989d78a7c75901efccb496cdd560219d4df`（分支 `frontend-backend-redesign`），记录于 2026-10-02T09:00:54Z。
- **脏改动内容**：`baseline.patch` 7 927 371 字节，sha256 `9238ca59…bb3165fa97c`；`baseline-staged.patch` 0 字节（index 无暂存）。
  体积几乎全部来自 `.claude/tdd-guardian/receipts.json`（+222 050 行）。
- **状态清单（40 行）**：11 个 ` M`、9 个 ` D`（`docs/plans/` 下 9 份计划移入 archive）、20 个 `??`。
  ` M` 的 11 个是：`.claude/commands/fix-issue.md`、`.claude/nlpm-history.json`、`.claude/scheduled_tasks.lock`、`.claude/settings.json`、
  三个 `.claude/skills/*/SKILL.md`、`.claude/tdd-guardian/receipts.json`、`.claude/tdd-guardian/state.json`、
  `docs/adr/0034-…`、`docs/plans/archive/20250329-…`。**`src/`、`src-tauri/`、`tests/`（夹具目录除外）、依赖清单全部干净。**
- 三件套存放在会话 scratchpad 的 `wi01/` 下（`start-sha.txt`、`baseline.patch`、`baseline-staged.patch`、`untracked-and-status.txt`、`dirty-hashes-before.txt`）。
  **scratchpad 会被清掉**；如果这份基线要作为 Stage 0 的正式记录，需要用户决定存到哪里（见 §5 第 3 项）。

**⚠️ 实测到的并发漂移（这正是改写后 G0 要防的情况）。** 在 09:00:54Z 记基线、09:15Z 复核之间，有 5 个未跟踪文件从本工作树消失：
`docs/adr/0047-…control-channel.md`、`docs/plans/20261002-plan-agent-control-channel.md`、`docs/test/20261002-adr0047-journeys.md`、
`docs/test/20261002-adr0047-spike.md`、`tests/manual-fixtures/adr0047-journeys.md`。这些文件现在作为未跟踪文件出现在
`mdpro-wt/feat-adr0047-agent-control-channel` 里，是另一个会话移过去的。本次执行的命令都没有碰它们
（只跑了 build/test/coverage/cargo，外加只读的 git 命令）。其余 35 行的状态和内容哈希前后一致。
结论：在一个多会话共享的工作树上，「全局基线」只在记录的那一刻成立。每个 WI 的起点快照必须在**该 WI 第一次编辑前**现拍，
不能沿用本文这一份。

### 3.4 Baseline 事实复核（R4，部分）

| 事实（baseline-protocol） | 记录值 | 今天（HEAD `e471198`） | 判定 |
|---|---|---|---|
| `globals.css` 行数 / 颜色字面量 / px 字号 | 1917 / 48 / 88 | **1955 / 48 / 89** | **漂移**：`8050803`、`d211550`、`3a78ed1`（MCP ADR-0039/0040/0042）在原 :498 后加 6 行、原 :1373 后加 32 行，其中一处是新的 `font-size: 12px` |
| 其余 6 个 CSS 文件 | 269/1/1、116/2/3、65/0/1、39/0/0、25/0/1、16/0/1 | 完全相同 | 一致 |
| `globals.css` 非 `var()` 的 border-radius / transition / z-index / box-shadow | 47 / 7 / 5 / 1 | 47 / 7 / 5 / 1 | 一致 |
| 强调色填充 `:1032`、`:1747` | — | 现位于 **`:1037`、`:1784`**（内容不变，都是 `rgba(37, 99, 235, 0.1)`） | 行号漂移 |
| 「只有两条 `:focus-visible`（`:572`、`:648`）」 | 2 | **3 条**：新增 `:500 .mcp-confirm-dialog .toolbar-button:focus-visible`；原两条现在在 `:577`、`:653` | **事实失效** |
| `.toast` `:819`；`.settings-sidebar` `:904`；`.settings-category-btn` `:937` | — | `:824`、`:909`、`:942` | 行号漂移 |
| `.toolbar-recent*` 起于 `:397` | — | `:396` | 行号漂移 |
| 死代码候选：`src/App.css`、`src/components/TabBar/`、`Sidebar/Sidebar.tsx`、`FileItem.tsx` | 存在 | **仍在 HEAD** | 一致，但见 §4 冲突 C2 |
| Preview 已删、`mathRender.ts` 迁到 `src/services/` | — | `src/components/Preview` 不在 HEAD；`src/services/mathRender.ts` 在 | 一致 |
| 计划 P 的产物（`src/styles/index.css`、`src/styles/sections/`、`ToggleSwitch.tsx`、`Icon.tsx`、`useTauriEvent.ts`） | 排期文档称「均不在 HEAD」 | `git cat-file -e HEAD:<path>` 全部失败，`git ls-tree` 里也没有同名文件 | 一致：计划 P 的实现仍为零 |
| `stryker.config.json` 不在 HEAD；`tsconfig.test.json`、`tests/setup.ts` 在 | — | 一致 | 一致 |
| coverage 阈值是「实测地板」 | 31/61/82/31（地板 31.18/61.57/82.15/31.18） | 实测 **73.62/80.80/91.38/73.62** | 阈值仍有效（命令会失败），但已经不是地板了，见 §5 第 2 项。**2026-10-02 已上调到 73/80/91/73**（§6） |

**待做**：`baseline-protocol.md` § *Hotspots feeding work items* 的逐行全扫（sub-12px 字号 10 处、transition 10 处、settings rows、
icons、syntax、fonts、large-file warning 的行号），以及按 WI-0.1 第 4 条把差异写进 `appendices.md` 的 Appendix A。
这两项都是改既有文档，本次按指令不做。复核命令：`/usr/bin/git diff 0a3675e HEAD -U0 -- <file>` 取偏移，再逐条 `sed -n <line>p`。

### 3.5 从磁盘读 CSS 的测试（R5）

命令 `/usr/bin/grep -rln '\.css' tests`，共 **10** 个文件：

- 读 `src/styles/globals.css`（Stage 1 拆分会受影响的）：`design-tokens-accent-danger`、`settings-row-layout`、`source-scroll-layout`、
  `source-table-cell-highlight`。这 4 个与 `stage-1-split.md` 列的完全一致。`design-tokens-accent-danger` 还读 `themes/light.css`、`themes/dark.css`。
- 只读 `MilkdownEditor.css`：`highlight-rendering`、`milkdown-image-resize`、`milkdown-table-cell-highlight`、`milkdown-table-resize-handle`、`wide-table-fit-to-width`。
- `table-alignment-rendering`：读 `MilkdownEditor.css`；`globals.css` 和 `preview.css` 只出现在注释里（`:23`、`:39`）。

---

## 4. 冲突与失效陈述

| # | 位置 | 陈述 | 实测 | 性质 |
|---|---|---|---|---|
| C1 | P `:453`；排期文档总览表阶段 3 行 / 3.8 行（`:154`）；`20260919-sequencing-progress-review.md:84` | WI-0.1 重跑排在第 4 步，**在第 3 步（M 提前交付）完成之后**；progress review 明说「阶段 3 出口成立后再重跑」 | 排期文档阶段 3 仍是 🔄，**3.8 ⬜**（D6 未结案、ADR-0004 的豁免不覆盖 3.8）；另有 worktree `mdpro-wt/test-3.8-perf-exit` 正在进行中 | **顺序冲突**：本次基线是在第 3 步出口**之前**拍的，按 P 的顺序只能算预跑 |
| C2 | P `:473` vs 排期文档 § 阶段 2 | P：死代码候选「are deleted in the standalone cleanup PR at order 2, before WI-0.1」 | 阶段 2 记 ✅，但只删了 Preview 那一组；`src/App.css`、`src/components/TabBar/`、`Sidebar/Sidebar.tsx`、`FileItem.tsx` 仍在 HEAD（排期文档也写了「C 只缩小 A8」） | **P 与排期文档不一致**。按规则以 P 为准，那么阶段 2 不算完成，或者 P 的措辞超出了原意。需要用户裁定 |
| C3 | P `:475` | 「G0's file check is rewritten before WI-0.1」（将来时） | `d6d8f38` 已改写 baseline-protocol § Common gate G0 | P 的陈述过期（已完成） |
| C4 | P `:475` | 「Seven tracked files are ` M` right now」；「`package.json` and `pnpm-lock.yaml` are both modified」 | 今天 11 个 ` M` + 9 个 ` D`；依赖清单四个文件全部干净 | 过期的观察值 |
| C5 | stage-0-inventory § WI-0.1 第 1 条 | 「`git show HEAD:…config.json` has no `schemaVersion` and no `lanes`」 | HEAD 是 v2（P `:479` 自己也记了「Resolved — re-verified 2026-09-12」） | Stage 0 文件过期，与 P 索引矛盾 |
| C6 | stage-0-inventory § WI-0.1 第 3 条、验收 `:85` | 存 `git status --porcelain` | 已被 G0 改写取代 | 与 baseline-protocol 矛盾，建议文本见 §2 |
| C7 | P `:429`、decisions E37 | `useMcpSync.ts:139` 以 `content.length` 作哈希 | 缺陷仍在，但已移到 **`:199`**（`${d.id}:${d.content.length}:${d.isModified}`） | 行号过期；E37 未修，与排期文档一致 |
| C8 | P `:429`、E38 | `tocStore.ts:86-88` 的 `setEntries` 清空 `collapsedIds` | `setEntries(entries, documentId)` 现在在 `:153`，按 heading 协调（阶段 3.5 `2a0e1a4`） | P 的缺陷描述已过期；E38 作为前置已兑现，与 P `:252` 一致 |
| C9 | 排期文档 § Stage 5 准入（`:292`） | E6「实测仍未修」 | `2cb2e01` 已让 `set_preferences` 在加载失败时传播错误、不再回落默认值（`commands/preferences.rs` 文档注释「A failed load is propagated, never defaulted」）；TODOS.md 记的备份 `config.json.corrupt-<ts>` + toast 策略没有实现 | **可能部分过期**，本次未完整核实。不属 WI-0.1 范围，只在这里登记。**2026-10-02 已核实**，结论见 §6 第 6 项 |
| C10 | baseline-protocol § Baseline 多处 | 热点行号、「only two `:focus-visible`」 | 见 §3.4 | 事实漂移，需要写入 Appendix A |

---

## 5. WI-0.1 标 ✅ 之前需要用户裁定的事项

1. **C1 —— 现在拍的基线算不算数？** 按 P 的顺序，WI-0.1 重跑应在阶段 3（3.8）出口之后。
   选项：(a) 本次只作预跑，3.8 结案后按本文命令重跑一次再标 ✅；(b) 用户显式豁免顺序，接受本次为正式基线（建议同时写 ADR，理由是它改了 P 的顺序决定）。
2. **coverage 阈值**：实测 73.62/80.80/91.38/73.62，阈值仍是 31/61/82/31。G0 的「no metric fell below its recorded threshold」
   能防的退化只剩 lines 约 42 个百分点以外的部分。是否在 Stage 0 把两处（`vitest.config.ts` 和 guardian config）重设到新地板，需要用户决定。这会改配置，不在本草稿范围内。
3. **基线存放位置**：三件套目前在会话 scratchpad（会被清掉）。是否存到持久位置，以及放在哪里（不进仓库）。
4. **C2**：阶段 2 的「✅」和 P `:473` 的「dead-code candidates are deleted」，哪个对。
5. **§2 的三处建议文本**是否采纳，以及 C5/C6/C7/C10 这些过期陈述是否在同一个文档提交里修正。
6. **R1**：是否要用 `/tdd-guardian:status` 的技能输出替代本文的代理核查（这会写 `state.json`）。

---

## 6. 用户裁定（2026-10-02）与已落地的文档修改

| §5 项 | 裁定 | 落地 |
|---|---|---|
| 1（C1 顺序） | **(a) 预跑。** 正式 WI-0.1 在 3.8 结案后重跑；不豁免、不写 ADR | 本文标题与状态；排期文档总览表阶段 4 行、§ 阶段 4 各加 2026-10-02 登记 |
| 2（阈值） | **上调到实测地板** lines 73 / functions 80 / branches 91 / statements 73（实测 73.62 / 80.80 / 91.38 / 73.62，向下取整） | `vitest.config.ts:28` 与 `.claude/tdd-guardian/config.json` 由用户侧改好（不在本次文档修改内）；把 31/61/82/31 说成现行值的文档加了日期注记：P 索引 tdd-guardian 段、`decisions.md` E11、`baseline-protocol.md` § Gates and tools、计划 M Part 6、排期文档 1.8 行与「并行」行 |
| 3（基线存放） | **未裁定** | 预跑的三件套仍只在会话 scratchpad；正式重跑时再定 |
| 4（C2 阶段 2） | **阶段 2 维持 ✅。** `src/App.css`、`src/components/TabBar/`、`Sidebar/Sidebar.tsx`、`Sidebar/FileItem.tsx` 仍在 HEAD **不重开阶段 2**：P 的 order-2 段本身写明 Stage 2 的死代码守卫仍覆盖 `App.css` 与 `TabBar` | P order-2 段（「Amendments this decision forces」首段）末尾加一句注记指向本裁定，删除措辞本身未改 |
| 5（§2 建议文本与过期陈述） | **采纳，同一次文档修改里改完** | 见下方清单 |
| 6（R1 技能输出） | **未裁定** | — |

**§2 / §4 对应的文档修改（均为带日期的注记，旧文本以删除线或原样保留）：**

- C6：`stage-0-inventory.md` § WI-0.1 第 3 条换成 §2 的建议文本 1；Stage 0 验收的「baseline `git status --porcelain` is saved」换成建议文本 2。
- §2 建议文本 3：`baseline-protocol.md` § Common gate G0「No new dependency」一行换成按本 WI 起点逐字节比对四个依赖文件；旧文本删除线保留，WI-0.0 的历史说明原样保留。
- C3/C4：P「G0's file check is rewritten before WI-0.1」段加订正 —— 改写已在 `d6d8f38` 落地；「Seven tracked files are ` M`」与「already unsatisfiable」均已过期。
- C5：`stage-0-inventory.md` § WI-0.1 第 1 条加订正 —— HEAD 是 v2；`baseline-protocol.md` § Gates and tools「HEAD … is v1」处同样加了订正（本草稿 §4 未单列，属同一过期事实）。
- C7（E37）：`useMcpSync.ts:139` → **`:199`**（已 grep 核实，仍以 `content.length` 作哈希，未修）。P 决策表 E37 行、P 评审段、`decisions.md` E37、`risks.md`、`stage-4a-components.md`、`stage-4c-foundation.md` 各加注记。
- C8（E38）：已核实 `2a0e1a4` 之后 `setEntries(entries, documentId)` 在 `tocStore.ts:153`，跨重解析保留折叠状态与当前项。P 决策表 E38 行、P 评审段、`decisions.md` E38、`risks.md`、`stage-4c-foundation.md` 各加注记，说明 `tocStore.ts:86-88` 的描述已不是现行代码。
- C10（热点行号漂移）与 R4 的 Appendix A 写入：**本次未做**，留给正式 WI-0.1。

**第 6 项 —— C9（E6）核实结果**（已写进排期文档 § Stage 5 准入的 2026-10-02 订正）：

- **已修**（`2cb2e01`，2026-09-23，ADR-0031 第 1 步；与第 2–4 步同一提交，不是只含 E6 的独立 PR）：所有读-改-写 `config.json` 的路径在
  `load_preferences()` 失败时传播错误、不写文件 —— `set_preferences`（`commands/preferences.rs:79`）、`save_window_state`（`:176`）、
  `save_window_geometry`（`commands/window.rs:116`）、`apply_logging_settings`（`commands/logging.rs:104`）、`persist_server_enabled`
  （`services/preferences_mcp.rs:47`）；`commands/preferences_tests.rs:167`、`:207` 钉住损坏文件字节不变。
  `stage-5-source-font.md` 的准入原文「a `config.json` parse failure no longer leads to any write over the file」在 Rust 层成立。
- **未修**：TODOS.md P1（2026-09-11 定）的策略 —— 改名备份为 `config.json.corrupt-<timestamp>`、以默认值继续、一次 toast、本会话保存照常 —— 没有实现。
  现行行为是该条目明确否决的「拒绝一切写入」。加载时不提示（`src/App.tsx:239` 的 catch 只吞错误）；每次写入失败由 `preferencesService.ts:84-93` 记日志并弹 toast（`useLastViewModePersistence.ts:98` 只是吞掉其后的重抛）。
- **E6 未标结案**，Stage 5 准入维持原状：准入按 P 字面已满足、按 TODOS 策略未满足，以哪个为准需用户另行裁定。
