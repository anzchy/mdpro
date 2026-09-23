# 两计划综合实施顺序（UI redesign × Markdown 真源收敛）

**状态**：SEQUENCING — 由 `docs/plans/20260911-plan-ui-redesign.md`（计划 P）与
`docs/plans/20260912-plan-markdown-source-consolidation.md`（计划 M）综合而成。
**作用**：本文只定义**先后顺序**。每个工作项的验收条件、文件集合与门禁细则仍以两个原计划为准；
两者冲突时，以原计划为准，并回来修正本文。

**核心结论**：计划 M 的**标题身份契约与 TOC 切换提前到计划 P 之前**；M 的其余部分不动。
理由是 P 的 WI-4.26 要求「按 heading identity 协调折叠状态」，而今天的 heading identity
是**可证明会碰撞**的，先做 P 等于把坏身份冻进一份已批准计划的验收条件里。

---

## 总览：六个阶段

**状态图例**：✅ 已完成并验证 ｜ 🔄 部分完成 ｜ ⬜ 未开始 ｜ ⏭️ 已改期到另一个 PR ｜ ⛔ 常驻约束（非任务）

**状态维护规则**：一个独立 WI **实现并验证完毕**后，在**同一个提交里**更新它在本文的状态、
提交 SHA 与被证伪的结论；不要留到后续清理批次。「验证完毕」指它自己的门禁跑绿，不是代码写完。
本效力范围内的所有提交都进 `frontend-backend-redesign` 分支，不直接进 `master`。

| 阶段 | 状态 | 内容 | 归属 | 为什么在这个位置 |
|---|---|---|---|---|
| **1** | 🔄 | WI-0.0（已收窄为**本地测试工具链与基线校准**）；CI 触发器与分支保护另起一个 PR | P | 本地可验证；**合并门禁仍不存在**，「故意失败的检查挡住合并」这类验收归后续 PR |
| **2** | ✅ | 死代码清理，独立 PR | P（WI-0.1 之前） | 必须在基线捕获前完成，否则基线记录的是将被删除的文件 |
| **3** | 🔄 | **标题身份契约 + TOC 切换（M 提前）**（入口门禁一已交付 `c17c003`；门禁二**六面已全测** 2026-09-15，硬标准「不永久无响应」违反但**已豁免放行** [ADR-0004](../adr/0004-gate2-waiver-for-stage3-entry.md) ⇒ **两道入口门禁均已通过，3.1 可开工**）。**进度（2026-09-20）：3.0–3.7 ✅ 全部交付并验证，3.8 ⬜ 未动工**（此前本格记「3.3–3.8 未开工」，写于 2026-09-18，其后 3.3+3.4 `909612b`、3.5 `318b72c`/`2a0e1a4`/`7c892e0`、3.6、3.7 相继交付，本格未同步，属状态失实，于此更正）。3.8 的阻塞项曾是 **D6.3(c)**；**2026-09-21：D6.3(c) 的代码与单测已落地**，3.8 现在等的是 D6 的真机复测，而不是这次实现，见阶段 3 表与 D6 行。**2026-09-22 续记：3.8 仍 ⬜。** D6.3(c) 结构分判据（`703a6b4`）与 D6.3(d) 最长行判据（`1e68461`）已落地并经真机矩阵复测确认拦下 `very-long-line.source`（旧构建挂起 259 483 ms → 现 15 ms 进 Source，`6b45000`）；降级事件进日志（`3eb60a7`）；Source 模式 153–183 s 卡顿查明是 `tocService` 的逐标题前缀重扫、已修（`3d37b86`，组件实测 152 551 → 24 ms，归因更正 `72adeac`）。**仍欠**：3.8 逐面出口复测本身；Source 面没有护栏判据（ADR-0022 设计已 Accepted、未实现）；D12/D13 未修。**2026-09-22 再续记：Source 面护栏判据已落地**（[ADR-0022](../adr/0022-source-mode-gets-its-own-guard-keyed-on-table-row-density.md)，`aac8097`：表格行起始数 > 50 000 时卸掉四个源码表格扩展并停用表格右键菜单/快捷键，每份文档每会话判一次；全套单测 2232 通过；真机 MQ-1..MQ-4 已于同日在 `c9a1698` release bundle 上跑完、四项通过（`docs/test/20260922-adr0022-mq.md`；WYSIWYG 入口「恰好 2 个提示」目测 NOT VERIFIED））；D13 已修（`c06c7b5`，上句「D13 未修」已过期）；D12 仍未修（护栏只限制 50 000 行以上的损害范围）。3.8 仍欠 | **M** | WI-4.26 依赖的 identity 今天是坏的 |
| **4** | ⬜ | WI-0.1 重跑 → Stage 0→5 全程 | P | 主体工作 |
| **5** | ⬜ | 导出迁移、旧解析器退役、ammonia 评估 | M | 行为变更，需独立回滚边界 |
| **并行** | 🔄 | ~~ESLint（未开始，见 1.10）~~ → **2026-09-22 结案：不接 ESLint**，规则 50 §1 改由 TypeScript 解析器脚本把关（`3fb07b6`，[ADR-0023](../adr/0023-one-lint-rule-enters-as-a-typescript-parser-script.md)），见 1.10；**安全收紧：链接点击守卫 C1 已交付并验证**（协议相对链接绕过 `//evil.com/x` → `tauri://evil.com/x`，见 `docs/adr/0002-link-click-routing-and-origin-comparison.md` 与 `docs/adr/0001-wysiwyg-link-scheme-allowlist.md`）；**卫生项已交付**（生成物目录统一入 `.gitignore`；`linkSafety.ts` 与 `useMilkdownLinkClickGuard.ts` 两条 criticalPaths 钉在 100% 行/分支——全局阈值 31/61/82 挡不住只影响这两个文件的回归） | M Part 6 | 不阻塞主线（但见下方 ESLint 例外） |

**当前状态实测**：计划 P 实现为零（`src/styles/index.css`、`src/styles/sections/`、
`ToggleSwitch.tsx`、`Icon.tsx`、`useTauriEvent.ts` 均不在 HEAD）；M 要收敛的五套引擎全部还在。

**缺陷另有一轨**：本效力范围内实测到、但**不属于任何阶段工作项**的缺陷登记在下方
「[D 系列缺陷轨](#d-系列缺陷轨)」。它们不是工作项，故**不在上面的六阶段表里占行**；
本表也不为它们创设验收条件。

---

## 阶段 1 — WI-0.0 chore PR（Stage 0 之前，不含产品代码）

**本阶段状态：🔄 部分完成**（提交 `d6d8f38` + `16fb45c`）。
⚠️ 订正：此前写作「分支 `frontend-backend-redesign`」属描述失实——这**两个提交都在 `master` 上**，
早于本分支切出（分支规则由本分支的首个提交 `0d025a8` 引入，在它们之后）。
因此它们不违反「本效力范围内所有提交都进 `frontend-backend-redesign`」，那条规则当时还不存在。
1.4–1.9 已完成并验证；1.1、1.2 按用户指示改期到独立 PR。1.10 原同属改期，**2026-09-22 以「不接 ESLint」结案**（`3fb07b6`，ADR-0023），见 1.10 行。

| # | 状态 | 任务 | 完成条件 |
|---|---|---|---|
| 1.1 | ⏭️ | `ci.yml` 恢复 `pull_request` + `push: master` 触发；拆分/缓存 `cargo install cargo-audit` | Linux 路径跑绿 |
| 1.2 | ⏭️ | **重新加分支保护** —— 仅 `frontend` 与 `rust-test` 两个 job 设为 required | 用一个故意失败的检查证明它**确实挡住合并** |
| 1.3 | ⛔ | **永不**恢复 `ai-verifier` 为 required | 它是 `workflow_dispatch`-only，恢复即永久阻塞所有 PR |
| 1.4 | ✅ | `vitest.config.ts`：`coverage.include` = `src/**/*.{ts,tsx}`、`all: true`、测试匹配放宽到 `.test.tsx` | 已验证：分母由 97898 行收敛到 11212 行；另加 `@vitejs/plugin-react` 钉住 JSX transform，否则 `tests/` 下的 `.tsx` 会退回 classic transform 并死在未定义的 `React` |
| 1.5 | ✅ | `tsconfig` 纳入 `tests/`；新建 `tests/setup.ts`（显式 `afterEach(cleanup)`） | 已验证：种子测试 `tests/reload-dialog.test.tsx` 既被发现又被类型检查。**未**把 `tests/` 加进 `tsconfig.json`，而是新建 `tsconfig.test.json` + `pnpm typecheck:tests`——`pnpm build` 跑的是裸 `tsc`，否则测试夹具的类型错误会变成发布阻塞 |
| 1.6 | ✅ | 四个 E7/E28 test-only devDependencies | 已验证：无新增 runtime 依赖；lockfile 改动 1329 → 187 行 |
| 1.7 | ✅ | **Stryker 的第一个决定不是范围，而是「是否入库」** | **已决：不入库。** 撤掉两个 devDeps 与其后 1329 行 lockfile 改动，`requireMutation: false` 且删除 `mutationCommand`/`mutationGateOn`。理由不是「覆盖率太低不配跑变异测试」（该论点是错的），而是 E29 的前置条件未满足：本 PR 只交付测试基础设施，允许清单模块尚无行为测试 |
| 1.8 | ✅ | tdd-guardian config v1→v2 迁移，四项阈值重置到实测地板 | **已测并写入 31/61/82/31**（lines/functions/branches/statements；实测 31.18 / 61.57 / 82.15 / 31.18，向下取整）。注意这是**加种子测试与修正 fixture 之后**重测的值，不是先前的 30.87。明确记录旧的 40/45/35/40 是未校准历史配置，非偷偷降低。**必须同时写入 `vitest.config.ts`**，否则 `pnpm coverage` 不会因低覆盖率失败 |
| 1.9 | ✅ | **G0 文件检查改写**（必须在 WI-0.1 前） | 改为：全局基线存起点 SHA + 脏改动内容 + 未跟踪清单；每 WI 存自己起点；按**内容差异**核对本 WI 声明文件集 |
| 1.10 | ✅ | ⚠️ ~~建议追加：ESLint 接入~~（M 的 P1）→ **已决：不接 ESLint** | **2026-09-22 结案（`3fb07b6`：`scripts/lint/no-bare-store-hook.mjs` + `tests/lint-no-bare-store-hook.test.ts`，同提交把 `AdvancedSettings.tsx` 改为逐字段 selector），见 [ADR-0023](../adr/0023-one-lint-rule-enters-as-a-typescript-parser-script.md)（Accepted，取代 [ADR-0020](../adr/0020-eslint-enters-as-a-single-rule-devdependency.md)）。** 这条硬前置**不再存在**：规则改用仓库内脚本 + 已经装好的 `typescript` 编译器 API 实现，不新增任何依赖、不动 `package.json`（连 `scripts` 段也不动，加 script key 同样会挂 G0），因此**不需要给 G0 开第二个例外**。两条关键事实推翻了 ADR-0020：一是 `eslint` + `@eslint/js` **根本解析不了 TypeScript**（默认解析器是 Espree，`@eslint/js` 只给配置不给解析器），ADR-0020 全文未提；二是 `typescript` 本来就是直接 devDependency（`package.json:67`，`~5.8.3`），AST 精度与零依赖不冲突。门禁挂在 `tests/` 下的测试上，搭现成的 `unit` lane，不新增 lane |

**已完成、勿重做**：两个 job 的 `timeout-minutes: 30`。

---

## 阶段 2 — 死代码清理独立 PR（WI-0.1 之前）

严格按此顺序，**每步独立提交**：

**本阶段状态：✅ 全部完成**（2.1 `e021f47`；2.2 + 2.3 `a9be7b3`；2.4 `15b9d35`；2.4 遗留 ③ `highlight.js` 单独提交 `bb5d1a2`；2.5 + 2.4 遗留 ② `0ca5a41`；2.4 遗留 ① 结案于 `7e42ae9`。分支 `frontend-backend-redesign`）。
遗留 ① **已结案，但结论与原判相反**：原记的「`renderMathInContainer` 失去唯一生产调用方」是**错误结论，已撤回**。
`prerenderMathForExport` 在其下方数行直接调用它，它位于 `exportService.ts` → `prerenderMathForExport` → `renderMathInContainer`
这条**实时导出通路**上，删除会直接破坏 HTML 导出中的数学渲染。真实问题远小于原判：它仅**无模块外调用方**，
与 `renderMathElement` 一样是「为测试而 export」的可见性异味，且 `mathmlOnly = false` 分支只被测试走到（导出恒传 `true`）。
按用户决定：**只修正 `mathRender.ts` 中的失实 NOTE，不改动代码、不动测试**。
knip 引入仍作为独立提案开放，提案见 [`20260912-proposal-knip-dead-code-detection.md`](./20260912-proposal-knip-dead-code-detection.md)（`c0415a3`）。
SHA 无法在它自己的提交里自引用，故每步的 SHA 记在紧随其后的提交中。
这是对 CLAUDE.md「SHA 必须记在完成该工作项的同一提交里」的一处**物理性收窄**，不是豁免：
除 SHA 之外的状态（✅/🔄、结论、被推翻的判断）仍须在同一提交内更新。

2.2 与 2.3 **合并为一个提交**：行 2.2 直接援引 E26，而 E26 要求「补表征测试」与「删被取代的断言」落在同一提交；
这与本文档「每步独立提交」的通则冲突，按「原计划优先」的规则以 E26 为准。

**本分支上不属于任何阶段工作项的提交**（登记于此，避免它们在排期视图里无落点）：

| 提交 | 内容 | 归属 |
|---|---|---|
| `c0415a3` | knip 死代码检测提案（独立文档，298 行） | 阶段 2 遗留 ① 的衍生物，不是工作项；提案本身未获批准 |
| `bee0770` | 导出锚点收敛到 B′ | 计划 M 的**待决问题 5**。**2026-09-15 产品确认采纳，记入 [ADR-0003](../adr/0003-export-fragment-sanitizer-scope.md)**；由 WI-3.2 实施，决议本身不含代码改动 |
| `07d763c` | 订正 `c17c003` 夹具中对两个 `render_markdown` 的混淆注释 | 阶段 3 入口门禁一的后续订正 |
| `0436bad` | CLAUDE.md 新增 ADR 规范 | 项目治理规则，不属任何阶段 |

| # | 状态 | 任务 | 注意 |
|---|---|---|---|
| 2.1 | ✅ | `mathRender.ts` **先**搬出 `src/components/Preview/` → **`src/services/mathRender.ts`** | HTML 导出在用它，先搬再删。落点与 `highlightSyntax.ts`、`sanitizerPolicy.ts` 并列 —— 三者同为导出管线的 HTML 后处理，`exportService.ts` 以 `./` 同级引入 |
| 2.2 | ✅ | 为存活面（`MilkdownEditor.css`、`html_template.rs`）补行为表征测试 | E26：迁移与删除在**同一提交**。Milkdown 面走 jsdom 计算样式（L3，8 组 `{center,right,left,absent}×{th,td}`）；导出面改为在 `html_template.rs` 自己的 `mod tests` 内断言 `build_html` 的**返回文档**（L2 + 跨面 L4 往返），不再跨语言 grep `.rs` 源码。**已知缺口**：jsdom 26 完全不实现 `!important`（已实测：`!important` 规则在前、同特异性普通规则在后时后者获胜），故本 lane 无法守住「给 `[align]` 规则加 `!important` 会压掉 Milkdown 的内联对齐」这一回归；原矩阵的 W1-2 用例因此**无条件通过、对被测产物零敏感**，已移入 Deferred 而非放宽断言 |
| 2.3 | ✅ | 删 `tests/table-alignment-rendering.test.ts` 中读取 `preview.css` 的断言，并**写明退役的是哪条已不存在的产品契约** | 不得声称被另一测试等价覆盖 —— 新表头明确写「nothing here replaces it」。顺带修正表头既有失实描述（原称 Preview 管线「tested via the marked fallback path」，实际并无此测试） |
| 2.4 | ✅ | 删 `Preview.tsx`、`ImageRenderer.tsx`、`usePreview.ts`、`preview.css` | 四文件已删（`git rm`），`src/components/Preview/` 目录随之消失；删前已核实无任何 import，preview.css 的四个类名（`.preview-body/-content/-loading/-image--error`）在目录外零引用。**计划原记的 `markdown.rs:661-664` 漏了一处**：失实描述实为**两处**，`:659` 的「exported HTML **and from the in-app preview**」同属三管线旧说法。改写时避免了一个**新**错误 —— 不能把「三管线」简单改成「WYSIWYG + 导出」：这条 Rust 通路**只喂导出**，WYSIWYG 从不经过它（Milkdown 自行解析，gfm preset 以内联样式设对齐，`MilkdownEditor.css` 是平行的另一套规则）。规则 22：三处 `@coordinates-with`/文档引用同提交更新（`useMilkdownLinkClickGuard.ts:9`、`mathRender.ts:20`、`imagePathUtils.ts:9`），并修正 `table-alignment-rendering.test.ts` 表头时态。**本步新发现的遗留（未擅自处理）**：① `renderMathInContainer` 当时判为「失去唯一生产调用方」——**该判断错误，已在 2.5 撤回**（它仍在导出通路上，详见本阶段状态说明）；② `--color-preview-bg` 成为只定义不读取的孤儿 token（`globals.css`/`light.css`/`dark.css`）；③ `highlight.js` 在 `src/` 内失去最后一个 importer，`package.json` 仍留该依赖。覆盖率因移除未覆盖文件而**上升**：31.53/62.05/82.36/31.53（前值 31.18/61.57/82.15/31.18），阈值未动 |
| 2.5 | ✅ | 修 CLAUDE.md 失实描述（数学/脚注实际只在导出，不在 Preview），并一并删除孤儿 token `--color-preview-bg`（2.4 遗留 ②） | **实际范围远大于计划所记的「CLAUDE.md 一处」：共 6 个文件 9 处 Preview 失实描述**。CLAUDE.md 三处（`:83` 目录树、`:102` 技术表「JS preview」、`:338` Phase 1 渲染面）；`docs/guide/tables.md:37` 携带**与 `markdown.rs` 同一条**「WYSIWYG + Preview + 导出」三面对齐假命题（2.4 只修了 Rust 侧，文档侧漏网）；`docs/guide/md-engine-architecture.md` 七处；两个**治理文件** `.claude/rules/30-ui-consistency.md`（跨模式一致性含 Preview）与 `31-design-tokens.md`（`preview.css` 帧归属）。② token 三处声明（`globals.css`/`light.css`/`dark.css`）同提交删除，其唯一读取方 `ImageRenderer.tsx:8` 已随 2.4 删除；按规则 31 第 4 条在 `docs/design/mdpro-ui-old/DESIGN.md` 决策日志登记并留恢复指针 `15b9d35^`。**避免了一个新错误**：`md-engine-architecture.md:61` 的 `marked + DOMPurify` 行不能随 Preview 一起删 —— marked 仍作为 `exportService.ts` 的导出回退存活，删行会造出新的失实，故改写为「仅导出回退」。**顺带修正同文件内非 Preview 类失实**（规则 22「编辑时发现即同提交修复」）：CLAUDE.md 目录树的 `WysiwygView`（无此文件，实为 `MilkdownEditor.tsx`）；`md-engine-architecture.md` 全篇 `split`/`editor-only`/`preview-only` 模式名（`src/types/editor.ts` 实为 `ViewMode = "wysiwyg" \| "source"`），以及 500KB 降级目标模式名（`App.tsx:512` 实测提示为 Source mode）。`SplitView.tsx` 经核实已只渲染单个 CodeMirror 全宽面，不再是「split」 |

**不在本 PR**：`marked` 降级移除（带独立回归测试的行为变更，单独交付）；`toc.rs` / `preview_html`（留到阶段 5）。

**不要指望**：删 Preview 并不能让 Stage 2 死代码守卫退役 —— 它还覆盖 `src/App.css` 与 `src/components/TabBar/`，
A8 也还登记着其他候选。C 只缩小 A8，不消灭整个例外机制。

---

## 阶段 3 — M 提前交付：标题身份契约 + TOC 切换

**本阶段状态：🔄 进行中**（截至 2026-09-20）。两道入口门禁均已通过；
**3.0 ✅ 已交付并验证**（`c17c003`，订正 `07d763c`，runner 收紧 `549d22f`）；
**3.1 ✅**（`05396db`）、**3.2 ✅**（随本表所在的提交落地）；
**3.3 + 3.4 ✅**（ADR-0012 已把两行并为一个工作项，2026-09-18 同批交付，`909612b`）；
**3.5 ✅**（WI-3.5.1–3.5.8 已交付并验证，2026-09-19 按层分三个提交落地：契约与匹配器 `318b72c`、协调行为与账簿 `2a0e1a4`、死生成器守卫与计数订正 `7c892e0`）；
**3.6 ✅**（3.6 的前提已于 2026-09-19 开工前复核，推翻本表原记的两处判断，计划落在 `.claude/tdd-guardian/plan-20260919-102711.md`，详见 3.6 行；**2026-09-20 人工 GUI 验收在真机 bundle 上跑完，scroll-spy 全部判据通过，本行结案**。两项遗留均已剥离出本行：判据 ④ 的切模式跳顶查明为**全应用缺失滚动恢复机制**的既有缺失功能，另立 WI-8（**2026-09-22 WI-8 已实现，`c9a1698`**：过渡前在 `runViewModeTransition` 单点捕获顶部可见行，按顶层块对位、块数不符退标题级、两级都不符停在开头；恢复分两处——Source 在 `onCreateEditor`、WYSIWYG 在 `useMilkdownScrollRestore`（等两帧且滚动容器有高度，图片加载后补一次）；全套单测 2345 通过 / 0 失败，两套 tsc 通过，红收据 WI-8-wiring SEPARATION-HELD（红只证明接线：记红时前半实现已在工作区）；**GUI 验收 2026-09-22 在 `c9a1698` release bundle 上执行**（`docs/test/20260922-wi8-gui-acceptance.md`）：位置保持判据全部通过（±3 行、10 次往返 0 行漂移、图片加载后无位移）；双主题、大段粘贴未测，双主题、大段粘贴两项 NOT VERIFIED；恢复后大纲高亮在 D14 修复（`00842dd`）后复测为**条件性失败**——落在一节中间时停在 H01，记为 **D17**（`docs/test/20260922-d14-gui-acceptance.md` G6），**2026-09-22 已修复**（ADR-0026，jsdom 回归已验证，真机 WI-7 已于 2026-09-23 验收 8/8，见 D17 行）；风险 ③「恢复滚动回写 `activeEntryId`」靠与大纲共用 40px 探针在构造上对齐，真机未核）；判据 ⑦ 双主题受菜单栏占用阻塞，保留 NOT VERIFIED，因本批零 `.css`/`.tsx` 而非承重）；
**3.7 ✅**；**3.8 ⬜ 未动工** —— 它依赖 D6 关闭。**2026-09-20 更新：D6.1 的真机 sweep 已跑完并经独立复核**（`docs/plans/20260920-d61-wkwebview-sweep-record.md`，含同日追加的「D6.1-b 最终汇总」与「D6.1-b 复核修正」两节）；**D6.2 已裁定，写入 [ADR-0016](../adr/0016-large-document-guard-predicate-is-a-source-structure-score.md)，状态 **Accepted**（2026-09-20，经对抗式审议后签署）**。现在挡住 3.8 的不再是 sweep，而是 **D6.3(c)** —— 按 ADR-0016 落地新判据并重写测试矩阵，须走 TDD 工作流。**2026-09-21 更新：D6.3(c) 的实现已完成** —— 判据换成结构分、`fileSize` 退出输入类型、文案改写、两个测试文件重写，单测与 `tsc --noEmit` 全绿。**但 3.8 不因此解锁**：ADR-0004 把 D6 的结案系在门禁二的 3.8 出口复测上，不能用一次绿色测试套件代替（见 ADR-0004 与本表 D6 行）。**2026-09-22 订正**：此处原写「那是逐面复测、只能由用户在真机跑」。前半句对，后半句是本表自己加的，ADR-0004 里没有。ADR-0004「Consequences / Step 3.8 is now harder」实际要求的是**逐面比较、并点名排除已知楔住的形状**，理由是入口基线里含一段不收敛的阻塞、整机聚合比较无法把 step-3 的回归和这段既有楔子分开 —— 它约束的是**比较方法**，不是**谁来跑**。「只能由用户」与事实也不符：3.6 的真机 GUI 验收（2026-09-20）与 D6.1 的真机 sweep 都是在真机 bundle 上由 agent 跑完的。真正跑不动的只有被菜单栏占用挡住的双主题那一条，它按 `gui-acceptance` §8 记为 NOT VERIFIED，而不是整批推给用户。按本文章程「计划与 ADR 冲突时以 ADR 为准、并订正计划」，本句照 ADR-0004 原文改正。这不放松 3.8 的门槛 —— 出口复测**依然欠着**，只是它欠的是一次逐面、排除楔住形状的真机复测，不是一次只有用户能做的复测。**2026-09-21 再更新：D6.3(d) 已完成，3.8 仍不解锁。** 同日的真机复测发现 D6.3(c) 自己引入了一次**保护倒退** —— 一份 9 961 475 B、4 行、结构分只有 3 的文档，旧字节判据会拦、结构分判据却放行，而它实测冷开挂起 **259 483 ms**（`docs/test/20260921-d5-d6-real-device-measurement.md`）。[ADR-0019](../adr/0019-large-document-guard-adds-a-longest-line-trigger.md)（Accepted 2026-09-21）在同一趟扫描里补了第二个计数器「最长行」与第二条阈值 1 000 000 UTF-16 码元，任一条超了就降级；它**扩展**而非取代 ADR-0016，Decision 1 冻结的四项不变量全部保持。单测 64 例全绿、`tsc --noEmit` 与 `pnpm build` 通过、判据模块覆盖率仍 100%。**这依然不是 3.8 的出口复测** —— 理由与上一句完全相同，且这次更该记住：上一次正是「绿色单测」与一个被误引的 0 ms 数字，让一份会挂起四分钟的文档被判为安全。
**2026-09-20 补记**：计划 M 的 **D6.3 抽出了护栏判据**（`src/utils/largeDocumentGuard.ts`，34 个用例，此前零覆盖），
但**阈值与判据变量一个字节都没动** —— 那是 D6.2 的裁定，仍被 ADR-0006 冻结。**这不推进 3.8。**<br>**2026-09-21 续记：这一句到此为止。** D6.3(c) 已把判据变量换成结构分、阈值换成 25 000，`LARGE_DOCUMENT_THRESHOLD_BYTES` 与 `fileSize` 一并从代码中删除。上面这段记的是 2026-09-20 的状态，按日期保留原文，不改写。
逐行状态见下表。
按本文第 18–20 行的规则，每个 WI 的状态与 SHA 随**完成它的那个提交**一起写入本表，不留到清理批次。
一个 WI 的行写不进**它自己那个提交**的 SHA（自指），故本表只对**先前**提交记 SHA；
当前 WI 的 SHA 由完成它的提交本身承载，`git log --follow` 即可取回。

**入口门禁（两道，均须先于 3.1）。** 本文原先把性能验收排成 3.8（收尾行），与计划 M 冲突。
按本文章程「两者冲突时以原计划为准」，以 M 为准改正：

1. **代表性语料就位** —— M `问题 4` 已决为「从零新建」（`tests/image-test/` 实测仅 4 个文件且未跟踪，
   是图片夹具，无可扩充基础）。M 的第二层「语义契约测试」完全依赖它。
2. **大文档性能基线实测** —— M：「第 3 步的**前置验收**必须实测大文档」，覆盖切文档与关文档。
   这是**进入**阶段 3 的条件，不是离开它的条件。
   **「过期解析结果」已不在本条内**：M 在 `7fcaf8c` 把它从入口实测项改为第 3 步的**出口**条件。
   理由是该危险**今天不存在**（TOC 解析纯同步，打开文档的异步结果自带各自 document id），
   而它恰恰由第 3 步引入异步解析时创造——要求进入前先实测一个进入后才会被造出来的危险，
   是一条无法满足的循环依赖。详见 M「阶段 3 入口门禁二 · 现状确认：过期解析结果」。
   **现状：六面已全测**（2026-09-15，记录见 M
   [`20260915-stage3-gate2-record.md`](./20260915-stage3-gate2-record.md)）。
   三条硬标准里「六面各有数字」与「10MB 拒绝正确」已达成，
   **「不崩溃、不永久无响应」违反**：9.96 MB 文档把渲染器打满且不收敛，
   最长一次主线程阻塞 79,197 ms，期间 UI 可验证不可交互。
   **2026-09-16：该条获豁免，本门禁按「入口已通过」处理，3.1 可以开工**——
   见 [ADR-0004](../adr/0004-gate2-waiver-for-stage3-entry.md)。
   豁免的依据是缺陷与第 3 步**正交**（卡死在 500 KB 护栏生效之后、profile 落在依赖里），
   不是判定缺陷可接受：**D6 与 10 MB 卡死仍挂账**，且豁免**不延伸到 3.8 与发布**。

| # | 状态 | 任务 | 说明 |
|---|---|---|---|
| **3.0** | ✅ | **M 阶段 0：冻结契约** —— 语法矩阵、代表性语料、安全样例、性能基线 | ⚠️ 语料与性能基线**都是入口门禁**（见上）。语料为从零构建任务，**已交付** `c17c003`，双语 runner 随后收紧：钉死的缺陷必须记录实测输出，修好后若不同步从 `currentlyFailsOn` 与 `currentlyProduces` 删除即报红（语料 **28 例**——原记「25 例」写于 `c17c003` 当时，此后 3.2/3.4 各自补过案例；`tests/render-fixtures/heading-identity.json` 与 `tests/heading-identity-fixture-integrity.test.ts` 的 `EXPECTED_CASE_NAMES` 今天都是 28，对不上即报红）；性能基线**六面已全测**（2026-09-15），硬标准「不永久无响应」违反但**已豁免放行**（ADR-0004）——基线本身已**可复现**：生成器按字节忠实移植入库 `scripts/perf/generate-corpus.mjs`，`--check` 当场断言 M 的记录表，两次独立运行、以及与原生成器产物，均 11/11 逐字节一致（决定输出的是算法而非种子） |
| 3.1 | ✅ | 确立三概念身份模型：`anchorSlug` / `headingKey` / 位置 | **2026-09-18 完成并验证，已提交 `05396db`。** 新增 `src/utils/headingIdentity.ts`（128 行）与 `src/types/toc.ts`（118 行），测试 `tests/heading-identity-model.test.ts` 35 例 + `tests/helpers/headingCorpus.ts`。自身闸门全绿：unit lane 1617 例 0 失败、`tsc --noEmit` 与 `pnpm typecheck:tests` 均 exit 0、`headingIdentity.ts` 行/分支覆盖 100%。**未接线任何调用面**，`src`/`tests`/`src-tauri`/`package.json` 的已跟踪 diff 为空（本人复核，非取自 agent 报告）。**一项 HIGH 规格分离发现待你确认**：红→绿之间改动了 B9 一条断言，原因是矩阵 B9 与 B1 **自相矛盾**、任何实现都无法同时满足（B1 要求 `["x","x","x-1"] → ["x","x-1","x-1-1"]`，其中第三个标题正是 base `x-1` 的首次出现却不得拿到裸 base）；B1 为规范侧，故已**同步修正矩阵 B9 与计划 `:65`**，缺陷不残留在规格里。**决策**：`TOCEntry` 按计划留在 `tocStore.ts`，推迟到 3.5 随字段拆分一起搬。原勘察：**2026-09-18 实测落点**：`src/types/toc.ts` **不存在**；`TOCEntry` 现定义在 `src/stores/tocStore.ts:6-27`，三处引用**全是 `import type`**（`useTOC.ts:4`、`Sidebar/index.tsx:1`、`TOCSidebar.tsx:2`），无运行时耦合 —— 搬不搬这个接口是 3.1 要明确回答的一项，不是可以顺手做掉的事 |
| 3.2 | ✅ | 修 slug 两类碰撞 —— **三个活面一次性改齐**：`tocService.ts:101`、`exportService.ts:47`、`markdown.rs:23`，并配跨语言 parity 测试 | 原记「两个面」**少算了**：实测共**五份** slug 实现，**三活两死**。两死为 `toc.rs:36`（命令零调用方，且 TS 传 `document_id`／Rust 收 `content`，参数不匹配）与 `tocStore.ts:120` `generateAnchorId`（零引用；却是五份里唯一防碰撞正确的，但剥除 CJK，只能作去重逻辑参照）。两死面**不在 3.2 内**：M 明记 `toc.rs` 退役属第 5 步、不提前。后缀碰撞 `x, x-1, x-1` 五面皆有；fallback `"heading"` 从不注册**仅 TS 两面**有 —— 故这是一条活的 TS↔Rust 分歧，parity 测试须覆盖它。**⚠️ 2026-09-18 实测推翻「Rust 免疫」这一说法**：Rust 确实在**计数之前**替换 `"heading"`（所以 emoji 在前的形状它是对的），但它**用计数而非 taken 集合**，因此仍会撞上字面量。实测 `# heading-1 / # 🎉 / # 🎊` 在修复前的 Rust 面产出 `["heading-1","heading","heading-1"]` —— **重复**。本人直接读 HEAD 的 `markdown.rs:43-49` 逐步复核，非取自 agent 报告。结论：Rust 免疫的只是语料里那几个**特定形状**，不是这个缺陷类。**2026-09-18 完成并验证（B1+B2+B3+B4 一并落地）**：B1（`tocService.ts` + `exportService.ts` 改用 `src/utils/headingIdentity.ts` 共享分配器）、B2（`markdown.rs` 端口，taken 集合 + 单调 hint）、B3（[ADR-0003](../adr/0003-export-fragment-sanitizer-scope.md) B′：`SANITIZE_DOM: false`，并改名 `sanitizeRenderedHtml` → `sanitizeExportFragment` 以显式化「只处理片段、永不进活 DOM」的作用域）、B4（失效注释、CHANGELOG、ledger）。新增 ADDENDUM A 的两个语料用例（`literal-then-emoji`、`literal-suffix-then-two-emoji`）。**B3 的解锁条件已满足**：[ADR-0011](../adr/0011-remove-name-from-export-sanitizer-allowlist.md) 于 2026-09-18 **Accepted**（`1f3379d`），`name` 随之从 `BASE_ATTRS` 移除 —— `SANITIZE_DOM: false` 与保留 `name` **只有同时存在才危险**，故两者必须同批落地，不得只落其一。ADR-0003 的 `<form>` 前置条件**已复核仍成立**（`form` 在 `sanitizerPolicy.ts` 中只出现在「Deliberately ABSENT」注释里），且已从散文改为**行为断言**钉住。**闸门全绿（本人独立复跑，非取自 agent 报告）**：unit lane 431 套 / 1665 例，1661 通过 0 失败 4 todo；覆盖率 lines 33.98 / functions 66.20 / branches 85.01 / statements 33.98，四项均过阈（31/61/82/31）；`cargo test` 275 通过 1 忽略；`typecheck:tests`、`tsc --noEmit`、`cargo fmt --check` 均 exit 0；`ledger:check` 166 行 / 183 条路径断言 / **0 findings** / 94-94 命名覆盖。**21 个面已按约定同步解钉**（7 面属 slug 算法，14 面属 B′）；语料剩余钉子经本人从 fixture 重算为 **9 个**，与 `heading-identity-fixture-integrity.test.ts` 的 `EXPECTED_SURVIVING_PINS` 逐条一致：`crlf-doc\|tocOffsets`、`crlf-two-lines\|tocOffsets`（3.4）、`fenced-hash\|toc`、`link-in-heading\|toc`、`setext-noncolliding\|toc`、`setext-title\|toc`（3.3）、`formatted-bold\|exportFallback`、`inline-code\|exportFallback`、`link-in-heading\|exportFallback`（A1 既定降级）。**2026-09-18 实测**：3.0 的语料已把这两类碰撞逐一钉成「已知缺陷」并记下实测输出，故 3.2 的收尾动作是从 `currentlyFailsOn` 与 `currentlyProduces` **同步删除 10 个用例上的 21 个面**，少删一处双语 runner 即报红。其中 **7 个面属 slug 算法**（`suffix-collision` 三面，`emoji-then-literal`、`two-emoji-only` 各两面），**14 个面属 [ADR-0003](../adr/0003-export-fragment-sanitizer-scope.md) 的 B′**（`trailing-hashes`、`leading-trailing-punct` 与五个 `clobber-*`，各 `exportCanonical` + `exportFallback` 两面）—— 后者是 DOMPurify `SANITIZE_DOM` 剥掉锚点，**slug 本身是对的**，与碰撞无关但同属 3.2 |
| 3.3 | ✅ | ~~用共享 remark 配置替换正则解析器~~ → **改用既有 Lezer 解析器**；**与 3.4 合并为一个工作项** | **2026-09-18 完成并验证（`909612b`）。3.3 与 3.4 是同一次交付，见 3.4 行。** 自身闸门全绿（本人独立复跑）：`pnpm exec vitest run` **1732 通过 / 0 失败 / 4 todo，106 个文件**；`cargo test` 275 通过 1 忽略；`pnpm typecheck:tests` 与 `pnpm exec tsc --noEmit` 均 exit 0；`ledger:check` 166 行 / 184 条路径断言 / 0 findings / 94-94 命名覆盖，`ledger:build` exit 0。`tocService.ts` 253 行（上限 300），`markdownLanguage.parser` 走八个标题节点、相减 `HeaderMark` 子节点、按 frontmatter 长度重定基、行号只数 `\n`。**钉子账目：3.0 语料原存 9 个钉子，本次解钉 5 个**（`crlf-doc\|tocOffsets`、`crlf-two-lines\|tocOffsets`、`fenced-hash\|toc`、`setext-noncolliding\|toc`、`setext-title\|toc`），**恰余 4 个**（`formatted-bold\|exportFallback`、`inline-code\|exportFallback`、`link-in-heading\|exportFallback` 三条属 A1 既定降级，`link-in-heading\|toc` 一条见下）。**3.3 的开放问题已由实测回答：`link-in-heading\|toc` 并未被本次替换修好。** `HeaderMark` 相减只拿掉 `#` 串，`LinkMark` / `URL` / 链接文字仍留在节点范围内，抽出的文本就是字面的 `[text](https://example.com) tail`；修它需要剥除行内标记节点，会改变 `HeadingInfo.text` 的全仓语义，归属推迟的「行内标记剥除」工作，钉子**保留**。**⚠️ 反方向曾开一个缺陷，实测非推断，已在同批堵上（WI-9）**：`#` 后跟**制表符**而非空格的 ATX 标题（`#⇥Title`）一度完全不进大纲，旧行正则的 `\s+` 是认的。CommonMark §4.2 允许该写法，Rust 导出面（pulldown-cmark）也照认并产出 `<h1 id="tabbed">Tabbed</h1>`（实测），但 `@codemirror/lang-markdown` 6.5.0 的 Lezer 语法把该行解析成 `Paragraph`。该形状**不在 3.0 语料内**，所以没有任何既有钉子会因它报红——是 3.8 的成本测量顺带发现的，不是测试发现的。**修法：只在送去解析的副本上把该制表符改成空格**（`TAB_AFTER_HEADER_MARK = /^( {0,3}#{1,6})\t/gm`，捕获并回填标记，**等长替换**，故 offset 与行号一个都不动；`{0,3}` 而非 `*`，因为 4 个空格是缩进代码块）。红票 `WI-9` 在改源码**之前**录得 `assertion-failure`（1732 中 4 条红），改后 `verify` 报 `SEPARATION-HELD`。新增钉子 `tab-heading` 进 3.0 语料（27→28 条，四个面一起钉），回归测试 `tests/toc-lezer-parser.test.ts` B19 五例：1/2/6 级、0–3 空格缩进可、4 空格不可、offset/行号与空格写法逐位相同、围栏内不产生幻影标题、`# \tBoth` 与 `#\tA\tB` 证明重写不会越界。**残留（已知，未修）**：嵌在引用块或列表项里的制表符标题（`> #⇥Title`）仍漏，重写锚在行首。**另一项实测差异（正向）**：引用块与列表项里的标题（`> # Quoted`、`- # InList`）现在开始进大纲，旧正则锚在 `^#` 上看不见它们。**L6 定律域订正（HIGH，红→绿之间改动了一条已记录断言）**：`tests/toc-position-laws.test.ts` 的 L6 frontmatter 定律带着一条**未言明的前置条件**，在 2 个本身就以 `---` 开头的基准文档上把一个**正确**的实现判红。其定义域已由显式谓词 `SELF_FENCED` 收窄，排除项按名字与个数被断言钉住，并新增 L7 钉住那两个文档实际产出什么；理由记在 `.claude/tdd-guardian/tests-20260918-152840.md` 第 4 修订与 L6 的「Outcome after WI-3」行，故 `receipt.js verify` 在该文件上报 `SEPARATION-BROKEN`。**解析成本（观察值，非门禁）见 3.8 行下方小节。** ⚠️ **原行说明（保留作记录）**：**本行由 [ADR-0012](../adr/0012-lezer-parser-for-toc-headings.md)（Accepted 2026-09-18，`1f3379d`）改写**：按本文章程，计划与 ADR 冲突时以 ADR 为准、计划被订正。**remark 依赖已被拒绝，不申请 G0 例外**：`@codemirror/lang-markdown`（`^6.2.5`）**已是直接依赖**，其 `markdownLanguage.parser` 可在纯字符串上无头运行（不需要 `EditorState`、不碰 DOM），且**已经**在 Source 模式解析同一份内容做高亮。2026-09-18 实测：`fenced-hash` → `[]`、`setext-noncolliding` → `Alpha`、`setext-title` → `Title`、`crlf-doc` → 6、`crlf-two-lines` → 6、`lf-two-lines` → 4 —— **3.3 与 3.4 的五个钉子全部产出期望值**，故一次解析器替换即可解钉两行，拆开做反而意味着「修好了 offset 却故意不解 offset 的钉子」。原记的双实例风险、`chore(deps)` 开场、G0 例外 ADR **一并作废**。保留：覆盖围栏、Setext、格式化标题、重复、CJK、emoji、CRLF、slug 唯一性；**回滚点仍是 TOC 实现开关，不动正文**。新增成本见 ADR-0012 的 Consequences（仓库自此有第三个 Markdown 解析器；Lezer 并非 CommonMark 参考实现，其扩展集由 `@codemirror/lang-markdown` 决定，小版本变动无任何构建环节会报警；标题文本的 `HeaderMark` 相减是我们自己的代码，不是库的） |
| 3.4 | ✅ | 位置映射：UTF-16 offset + 行号；修 CRLF 每行少算 1 —— **已并入 3.3，同一次解析器替换交付** | **2026-09-18 随 3.3 同批完成并验证（`909612b`）**，ADR-0012 把两行并成一个工作项，故闸门与钉子账目**不重复记**，见 3.3 行。两例 `tocOffsets` 钉子（`crlf-doc`、`crlf-two-lines`）均已解钉，对照组 `lf-two-lines` 未钉且保持绿。ADR-0012 决策 4 兑现：**未新建** `src/utils/headingPosition.ts`。四条位置定律作为验收套件落在 `tests/toc-position-laws.test.ts`（L6 的定义域订正见 3.3 行）。以下为原行说明，保留作记录：`text\r\n# 标题` 应为 6 而非 5。3.0 语料已钉死两例 `tocOffsets` 面：`crlf-doc`（实测 5／应为 6）与 `crlf-two-lines`（实测 4／应为 6，证明**误差会累积**）；`lf-two-lines` 是对照组，证明 LF 下算术正确、缺陷只在 CRLF。⚠️ **[ADR-0012](../adr/0012-lezer-parser-for-toc-headings.md) 决策 4：不再新建 `src/utils/headingPosition.ts`** —— 该映射器一落地即是死代码，因为 Lezer 节点的 `from` **本身就是**源串的 UTF-16 下标（`\r` 计入），正是 `src/types/toc.ts` 里 `offsetUtf16` 要的那个数。原计划的四条**位置定律**（offset 往返、offset 与行号一致、CRLF 蜕变律、单调性）**全部保留**作为验收套件：它们写的是 `parseHeadingsFromContent` 的**输出**而非内部实现，故解析器换掉后依然成立。另：2026-09-18 复核发现现有实现的 offset **已经**是 UTF-16 单位（`line.length` 即 UTF-16 码元），缺陷只是 `:90` 的 `+1` 对 CRLF 少算一个字符；行号在 CRLF 下**本来就是对的** —— 原记「UTF-16 offset 与行号都是新工作」夸大了范围 |
| 3.5 | ✅ | 身份协调：`tocStore.setEntries` 保留折叠态与活动项（**从 WI-4.26 移入**） | **2026-09-19 交付并验证。WI-3.5.1–3.5.8 全部落地，按架构层拆成三个提交**：`318b72c`（契约修订 + `headingCoordination.ts` 匹配器 + 匹配器单测 + 契约摘要钉子）、`2a0e1a4`（store / hooks / 组件的耦合改动 + 六份行为测试 + 账簿与 CHANGELOG）、`7c892e0`（`dead-slug-removal.test.ts` 守卫 + 五份语料文件与两份 Rust `//!` 的计数订正）。**为什么不是逐层八个提交**：`TOCEntry` 拆成 `key` + `anchorSlug` 并删掉 `id` / `isActive`，同时 `clearEntries` 被 `resetCoordination` 取代，store / hooks / 组件三层**互相编译不过**——拆开只会造出三个编译不过的中间提交，故合成一个。契约与匹配器是纯新增、可独立审阅，故先行。**账簿与 CHANGELOG 与行为改动同提交**（规则 60），代价是这两份文件当时同时带着另一个会话的未提交改动，`git add -p` 在本环境不可用，故用「按行隔离 → 暂存 → 还原」把别人的 8 行账簿行与 1 行 CHANGELOG 挡在提交外；`feature-ledger.html` 由隔离后的 markdown 重新 `ledger:build` 生成，未手改。**已交付的内容**：新增 `src/utils/headingCoordination.ts`（两趟匹配 `coordinateHeadingKeys`，已列入 `criticalPaths`，行/分支 100/100）；`TOCEntry` 拆成 `key: HeadingKey` + `anchorSlug: AnchorSlug`，**`id` 与 `isActive` 一并删除**；`setEntries(entries, documentId)` 改为协调而非重置，`clearEntries` **已不存在**，由 `resetCoordination(documentId)` 取代（清平铺三元组、`documentId: null`、从 `byDocument` 清出该 id，发且只发一条 `ui.toc.coordination.reset`）；300 行上限逼出两处抽取 `src/stores/tocCoordination.ts` 与 `src/stores/tocHierarchy.ts`（`buildTOCHierarchy` 迁入后仍从 `tocStore.ts` 再导出，**没有任何导入路径改变**；一并迁入的死函数 `generateAnchorId` 随后由 **WI-3.5.8 删除** —— 它自 WI-3.2 起就零调用点，且会剥掉 CJK，留在这个「专门负责把 key 与 slug 分开」的文件里是个陷阱。删除连带订正了 5 份测试文件里 6 处注释：它们都按 `src/stores/tocStore.ts:120` 的旧位置引用它，而且都断言了一个**数量**（「两个死生成器」「parity 覆盖全部五个」），只抹掉符号名会留下一句变假的话，故数量一并改为「一个」「四个」。新增 `tests/dead-slug-removal.test.ts` 四例守住它不回来 —— 含反空洞断言与保守性断言，扫 `src/`、`tests/`、`src-tauri/src/`、`src-tauri/tests/`）；`useTOC` 收必填 `documentId` 并改用按字段选择器；`useDocument.ts` / `useMcpEvents.ts` 共 10 个 `resetCoordination` 调用点（8 处整体重置、2 处仅清出），**保存路径与击键路径刻意不重置**；`TOCSidebar.tsx` 的折叠 / 高亮 / React key 改挂 `entry.key`，`href` 改挂 `entry.anchorSlug`。**契约本身被改过一次，是有意且写在明处的**：WI-3.5.2 **修订了 `src/types/toc.ts` RESET 条款 (c)**，加入唯一一条具名例外「同序号、同层级连续性策略」—— 改名保键，代价是同一槽位的「删+插」与「改名」逐字节相同、因而会继承被删标题的折叠 / 高亮态。条款 (a)(b) 与七行编辑类型表一字未动，并由 `tests/heading-identity-model.test.ts` 的 D2a 以 SHA-256 摘要钉死（摘要取自**修订后**的文件）。**这条「接受一个已知缺陷」按 CLAUDE.md 的口径欠一份 ADR，本批未写**（计划未把它派给任何工作项），下一份 ADR 号从 0014 起，0001–0013 不得重编。**自测结果（2026-09-19 收尾复核，主会话独立重跑，非转述）**：unit lane **114 文件 / 1846 例，1842 通过 / 0 失败 / 4 todo**；覆盖率 40.55 / 69.33 / 85.03 / 40.55，四项均高于门槛 31 / 61 / 82 / 31（删掉未覆盖的死函数后 `tocHierarchy.ts` 由 51.35% 行、50% 函数升至 100/100）；三条 `criticalPaths` 全部 100/100 未动；`pnpm typecheck:tests` 与 `pnpm exec tsc --noEmit` 均 exit 0；`ledger:check` 166 行 / 188 条路径断言 / 0 findings / 96-96 命名覆盖。**`cargo test` 已跑**（WI-3.5.8 动了两份 `src-tauri/tests/` 的 `//!` 注释）：exit 0，275 通过 / 1 ignored。以下为原行实测记录，保留：**2026-09-18 实测**：`tocStore.ts:87` 的 `setEntries` **硬重置两者**（`activeEntryId: null` + 新建空 `collapsedIds`），唯一调用方是 `useTOC.ts:83` 的 300 ms 去抖解析 ⇒ **每一轮击键都抹掉折叠态与高亮**，哪怕标题集合根本没变。`TOCState`（`:32-44`）**无任何文档 id 字段**，`clearEntries` 定义了却零调用 ⇒ 今天「切文档不串味」恰恰是**这次重置**的副产品；3.5 拿掉重置后，协调键若不带文档作用域，A 文档折叠的 `intro` 会**永久**漏进 B 文档 |
| 3.6 | ✅ | 真实导航：WYSIWYG 里改按文档序对位寻址（**原题「修 `useTOC` 首个命中即 `break`」低估了工作量，理由见右**） | 点第二个重复标题必须到第二个。**2026-09-18 实测两处订正**：① 同一个 `break` 循环有**两处** —— `:141-148`（导航）与 `:228-234`（滚动监视的 observer 注册）；只修导航会留下重复标题的**高亮**仍然错，且 `headingElementsRef` 会把 N 个条目塌成同一个 DOM 元素。② 更上游：`data-heading-id` 全仓只由 `exportService.ts:71`（导出渲染器）写出、`sanitizerPolicy.ts:98` 放行，**编辑器侧无任何面发出它**，故 `:128` / `:220` 的 id 选择器在 WYSIWYG **恒不命中**，文本匹配是唯一通路 ⇒「改用 id」不是一行改动，它要求 Milkdown 先渲染出身份属性。Source 模式走 `:103-120` 的**行号**通路、根本不碰 DOM，本就对重复标题免疫。<br><br>**CORRECTED 2026-09-19（开工前重读 `useTOC.ts` 全文 290 行 + 读 `node_modules` 实测）——上面 ① 的行号全部过期，② 的结论是错的。**<br>**①订正：是三处，不是两处**，且 3.5 之后行号全变了：`:167-174` 导航的文本扫描（`break` 在 `:172`）、`:206-226` observer 回调（`break` 在 `:223`）、`:242-267` observe 注册（`break` 在 `:258`，`headingElementsRef.current.set(anchorSlug, heading)` 在 `:264`，该 Map 在 `:79` 声明为按 anchorSlug 键）。「只修导航高亮仍错」这个判断仍然成立。<br>**②订正：`data-heading-id` 的出处改为 `exportService.ts:81` / `sanitizerPolicy.ts:142`（Rust 侧 `markdown.rs:643` 写出、`:427-432` 放行）。「编辑器侧无任何面发出 `data-heading-id`」这半句仍然对；「故 id 选择器恒不命中」这半句是错的 —— Milkdown 自己给每个标题发 `id`。** `MilkdownEditor.tsx:177` 用 `.use(commonmark)`，`@milkdown/preset-commonmark@7.18.0` 的 heading schema 在 `lib/index.js:560-568` 的 `toDOM` 里写入 `id: node.attrs.id \|\| getId(node)`，`getId` 默认是同文件 `:521-523` 的 `defaultHeadingIdGenerator`：`node.textContent.toLowerCase().trim().replace(/\s+/g, "-")`。全仓 `grep headingIdGenerator`（`src`/`tests`/`docs`/`.claude/rules`）**零命中** ⇒ 从未被覆盖过。<br>**这是第四个活体 slug 生成器**，而且就长在本行要导航的那个 DOM 上 —— heading-identity 语料完全不知道它存在（`tests/heading-identity-faces.test.ts:4` 写的是「PARITY SURFACE — THREE LIVE FACES, and only three」，parity / fixture-integrity / `render-fixtures/heading-identity.json` 三处均无一字提 Milkdown）。WI-3.5.8 删掉的是**死的**那个第四，其守卫 `tests/dead-slug-removal.test.ts` 只扫仓库树，故未被证伪；但**「只有三个活体面」这句话对运行中的应用已经为假**。<br>它与 `slugBase` 有两处分歧：**㈠ 标点不剥**；**㈡ 去重后缀的形状不同**。<br>**这两条是跑出来的，不是读出来的。** 在 `tests/` 下临时挂了一个探针用例，用 `@milkdown/kit/core` + `commonmark` 在 jsdom 里真挂一个编辑器，喂一篇含重复、含标点、含 CJK 的 markdown，然后读 `querySelectorAll("h1..h6")` 的 `id`，读完即删（未提交）。**实测输出**：`Introduction`→`introduction`、`Hello, World!`→`hello,-world!`、`Q&A`→`q&a`、`foo_bar`→`foo_bar`、`第一章 概述`→`第一章-概述`、两个 `Intro`→`intro` 与 **`intro-#2`**；`data-heading-id` 七个全为 `null`。**探针推翻了我先前按源码推的一条判断**：我原以为 Milkdown「完全没有去重」，实际它有，只是后缀是 `-#2` 而不是我们的 `-1`。去重不在 `defaultHeadingIdGenerator` 里，在同文件 `:2119-2161` 的 `syncHeadingIdPlugin`：一个 ProseMirror 插件，在 view 建立时以及**每次 doc 变化时**重算全文标题 id（`:2127-2146`），用 `idMap` 计数、第二个起追加 `` `-#${n}` ``（`:2132-2137`），并以 `setNodeMarkup` **派发一个 `addToHistory:false` 的事务把 id 写回节点属性**（`:2140-2147`）；`:2129` 的 `if (node.textContent.trim().length === 0) return;` 意味着**空标题根本不分配 id**。<br>**于是重复标题的分歧恰好落在最要命的位置**：我们给第二个 `Intro` 的 anchorSlug 是 `intro-1`，DOM 上却是 `intro-#2` ⇒ `querySelector("#intro-1")` 必然落空 ⇒ 静默掉进文本扫描 ⇒ 首个命中 ⇒ **点第二个重复标题永远跳到第一个**。本行要修的那个症状，根因正是两套 slug 算法在去重后缀上不一致，而不只是那句 `break`。<br>**后果：id 选择器是时灵时不灵的。** 无标点且不重复时命中，否则静默落到文本扫描；observer 回调 `:207-208` 收进 `visibleHeadings` 的是 **Milkdown 的 slug**，而 `:221` 拿**我们的** `anchorSlug` 去查，两个命名空间只在两套算法碰巧一致时才对得上 ⇒ WYSIWYG 的滚动高亮**只在一部分标题上生效**。按标点分叉的「时对时错」比一律失效更难发现：任何单次手测都照不出来。<br>**⇒ 本行动工前必须先定「DOM 用什么寻址」**（按文档序的序号对应 / 把 `headingIdGenerator` 配成我们的分配器 / 加 Milkdown 插件盖 `data-heading-id`），三条路的代价不同，不是实现细节。另外「只有三个活体面」那句假话，要么本行一并订正、要么指名推给后续工作项，不得默不作声。Source 模式的免疫仍然成立，行号订正为 `:127-144`<br><br>**2026-09-19 实施并验证（WI-3.6.1–3.6.6）。本行记 🔄 而不是 ✅，差的是最后一步人工 QA，见末尾。**<br>**选定的寻址方式是三条候选里的第一条：按文档序对位。** 决策本身、以及另外两条为什么被否，记在 [ADR-0014](../adr/0014-toc-addresses-headings-by-document-order.md)，本行不复述。落地形态：新增纯函数模块 `src/utils/tocElementResolution.ts`（203 行，无 React、无 Tauri、无全局状态、无模块级可变状态），把条目列表与 `container.querySelector(".ProseMirror")` 底下的 `h1…h6` 对位。**这是「分配」不是「查找」**——每个 DOM 元素至多被占用一次，于是「两条目录项指向同一个元素」在构造上就不可能，而不是靠一句谁都可能忘了写的事后检查。数量相等时按下标直接拉链，不看文字也不看层级（一层，常见情形）；数量不等时按（层级 + 归一化文字）做**只进不退**的贪心分配，且**只有匹配成功才推进游标**，匹配不上的条目不占用任何元素（二层）；没对上的条目点了不动、也不会被高亮，并按 `(entryCount, domCount)` 签名的变化**边沿触发**一条 `ui.toc.resolve.mismatch` 警告（三层）。`useTOC.ts` 里**两处 id 选择器、两处「首个命中即 `break`」、以及 `proseMirror \|\| container` 兜底全部删除**：全文现在 0 处 `data-heading-id`、0 处 `CSS.escape`、0 处 `getAttribute`、0 处 `querySelector`，唯一剩下的 `.id` 是解析器自己那个 `asAnchorSlug(h.id)`。`observerRef` 一并删掉，observer 改成闭包局部量，于是每一次构造恰好配一次 `disconnect`。290 → 289 行，仍在 300 行上限内。另外顺手收窄了源码模式那个分支的判据（`viewMode === "source" && tocEntry?.lineNumber` → 先判模式、再在拿到 editorView 后判条目），使源码模式**在任何情况下都不会掉进 WYSIWYG 通路**，由一条 `not.toHaveBeenCalled()` 的穿透探针钉住。<br>**原行里有一句要撤回。**「⇒『改用 id』不是一行改动，它要求 Milkdown 先渲染出身份属性」——这句把出路指向了一条本行**明确否掉**的路。让 Milkdown 渲染我们的身份属性（无论是把 `headingIdGenerator` 配成我们的分配器，还是加一个插件去写属性）各有两个单独就足够致命的问题，逐条记在 ADR-0014 的 Rejected (b) / (c) 两节里。真正的出路是**一个 id 都不读**。**本行标题同样低估了工作量**：那句 `break` 是三步查找里的第三步，根因是两套去重算法的后缀方案不一致（我们 `intro-1`、Milkdown `intro-#2`）外加第一步的 `data-heading-id` 在编辑面上从来就是 `null`；只删 `break` 一个字也修不好。<br>**「只有三个活体面」那句假话由 WI-3.6.5 就地订正，没有推给后续工作项，而且波及面比预想的大：九个文件**（`tests/heading-identity-faces.test.ts`、`heading-identity-parity.test.ts`、`heading-identity-fixture-integrity.test.ts`、`dead-slug-removal.test.ts`、`src/utils/headingIdentity.ts`、`src/stores/tocHierarchy.ts`、`src-tauri/tests/heading_slug_generation.rs`、`src-tauri/tests/heading_identity_parity.rs`、`src-tauri/src/services/markdown.rs`）。**同一句「THREE LIVE FACES, and only three」在 Rust 侧的 `heading_slug_generation.rs` 里一字不差地又写了一遍**，只改 TS 侧会留下另一份假话。订正的方式是**限定而不是收编**：改成「三个 **mdpro 自己拥有** 的面」，并把实测到的第四个活体面（Milkdown 的复合 id：`defaultHeadingIdGenerator` + `syncHeadingIdPlugin`）作为记录写进去，同时明写**不要**把它加进 parity 语料——mdpro 既不产出也不消费那些 id，钉住一个没有产品契约撑着的第三方输出，只会在人家发补丁版本时无故变红。`dead-slug-removal.test.ts` 的「四个生成器」这个数**没改**，因为它数的是**树内**生成器，本来就对；补的是一段 SCOPE 说明：Milkdown 那个面住在 `node_modules`，按构造就在 `SWEEP_ROOTS` 之外，不要为了「补全」去放宽扫描根。**全部改动只动注释散文**：主会话独立复核 `git diff -U0`，九个文件加起来**非注释行改动为 0**，`expect(` / `it(` / `describe(` / `assert!` / `#[test]` 的计数逐文件 HEAD 与工作树完全相等。<br>**顺带查明一件关于红收据的事，值得记下来**：`verify --id WI-3.2b` 仍报 `SEPARATION-HELD`，但这**不是**这次改动没动规格的证据。收据的 `fingerprintFile` 按**每一行非空行**取指纹，不剥注释、不走 AST —— 改注释和改断言在它眼里没有区别；它这次没红，是因为该收据在 2026-09-18 已对着绿泳道**结案（settled）**，结案的收据不再复判。而且逐条手算子序列后发现：本次触及的五份被指纹文件**在 HEAD 时就已经是 BROKEN**，与这次改动无关。**结论：已结案收据上的 `SEPARATION-HELD` 是历史记录，不是对这些文件的实时守卫**；真正的证据是上面那两条独立复核（非注释行 0、断言计数不变）。<br>**交付物**：新增 `src/utils/tocElementResolution.ts`；改 `src/hooks/useTOC.ts`；新增 `tests/toc-element-resolution.test.ts`（31 例）、`tests/use-toc-navigation-identity.test.ts`（16 例）、`tests/use-toc-scroll-spy-identity.test.ts`（7 例）、`tests/use-toc-source-mode-navigation.test.ts`（7 例）与三份 helper；新增 [ADR-0014](../adr/0014-toc-addresses-headings-by-document-order.md)；`docs/feature-ledger.md` 的大纲侧栏行与 `CHANGELOG.md` 同批更新（规则 60）。<br>**自测结果（主会话独立重跑，非转述）**：unit lane **1907 例全绿**；`pnpm exec tsc --noEmit` 与 `pnpm typecheck:tests` 均 exit 0；覆盖率 41.56 / 69.93 / 85.51 / 41.56，四项均高于门槛 31 / 61 / 82 / 31；三条 `criticalPaths` 全部 100/100；`useTOC.ts` 行 100 / 函数 100 / 分支 96.22。四个工作项的红收据逐个 `verify`，全部 `SEPARATION-HELD`。**额外自查了一轮变异测试**（非流程要求）：三个「看着对其实错」的实现——匹配失败也推进游标、`pickActiveKey` 改成遍历 `visibleKeys`、在一层前面插一条 `element.id` 快路——全部被杀死，但**每一个都只被恰好一个用例杀死**（依次是 `E-10`、`K-1`、`E-L5`）。谁要精简这套测试，先看这三条。<br>**⚠️ 仍欠人工 QA，所以本行不是 ✅**：在 `pnpm tauri dev` 里分别点两条同名标题、并滚动看高亮是否跟住。这不是走过场——本仓**没有任何自动化泳道跑真实的 `IntersectionObserver` 或真实的 `scrollIntoView`**（jsdom 两者都不实现，`Element.prototype.scrollIntoView` 连 `typeof` 都是 `undefined`，`vi.spyOn` 直接抛），上面所有关于跳转与高亮的断言都建立在测试替身上。人工那一趟是这次重写在真实应用里成立的唯一证据<br>**落地提交（本地，未推送）**：`d00d13e` 纯函数寻址模块与 ADR-0014；`f947ec1` 九文件「活体面」注释订正；`e48bad0` `useTOC.ts` 改接寻址器，连同 CHANGELOG、账簿大纲侧栏行与本行。<br>**2026-09-19 人工 QA 已跑：本行要验的都过了，但揪出另一处缺陷，修完了，本行仍是 🔄。** QA 结论是上面那笔重写成立——WYSIWYG 下点两条同名标题各去各处、滚动高亮也跟得住。**但源码模式下 TOC 高亮完全不跟滚动**（点击能动，因为导航路径直接调 `setActiveEntry`）。**这不是本行的回归**，复核后确认从 `4570de3`（`feat(editor): cut ViewMode from 4 to 2`）起就死了：那次砍掉预览面，而预览面是当时唯一给 IntersectionObserver 提供真实 `h1`–`h6` 的非 WYSIWYG 面，于是 spy 被关掉而不是改嫁到 CodeMirror。三层根因，逐层读码证实：① `App.tsx:140` 传 `enableSpyScrolling: viewMode !== "source"`，`useTOC.ts:191` 直接早退；② 只翻这个开关没用，`tocElementResolution.ts:122` 从 `.ProseMirror` 起扫，`#source-container` 下返回 `[]`；③ IntersectionObserver 对这个面**结构上就是错的工具**——CodeMirror 渲染的是 `div.cm-line`，没有任何 `h1`–`h6`，而且视口是虚拟化的，屏外的行根本不在 DOM 里。<br>**修复的记录本是另一份计划**：`.claude/tdd-guardian/plan-20260919-151931.md` 与测试矩阵 `tests-20260919-151931.md`（67 例；经 spec-adversary 两轮攻击，4 gaps + 2 notes + 1 minor 全部在第三轮补齐，记录在 `attack-20260919-163149.md`）。本表第 114 行记的 `plan-20260919-102711.md` **没有过期**，那是上面文档序寻址那笔的计划；这里是 QA 之后新开的第二份，两份并存。<br>**已交付 WI-1 / 1b / 2 / 3 / 4 / 5 / 5b / 6**，每一项都走红收据、绿泳道、双 typecheck，且由主会话独立复跑而非转述：新增 `src/utils/tocLineSpy.ts`（纯选择器 + 可见性保持）、`src/utils/codemirrorViewportLine.ts`（**唯一**读 CodeMirror 几何的地方）、`src/utils/tocSpyMode.ts`（`resolveSpyMode` 分派）、`src/hooks/useSourceScrollSpy.ts`、`src/hooks/useWysiwygScrollSpy.ts`（原 observer effect 逐字搬出，`useTOC.ts` 293 行会破 300 行上限，故 WI-5b 是强制项）；**删掉 `App.tsx:140`** 那个身兼二职的开关。unit lane **1974 例 / 1970 通过 / 0 失败 / 4 todo，125 个文件**；`pnpm exec tsc --noEmit` 与 `pnpm typecheck:tests` 均 exit 0；`ledger:check` 166 行 / 194 条路径断言 / 0 findings / 96-96 命名覆盖。红收据逐个 `verify`：WI-1 / 1b / 3 / 4 / 5 全 `SEPARATION-HELD`，**WI-2 是 `SEPARATION-BROKEN`**——原因查到底了，是 `fakeCodemirrorView.ts` 的 `throwOnProbe` 在录红之后才从「按调用次数计数」改成「按探针坐标判定」，主会话自己重算行指纹确认**只动了那一个 helper 的 6 行、零条断言位移**。<br>**记在明处的代价**：两种模式换高亮的线不同（WYSIWYG 33%、源码顶端下 40px ≈ 5%），最多差一条标题，向上滚差距更大，中途切模式会可见地跳一条；已写进账簿大纲侧栏行的第四条 `限制：`。**本行改 ✅ 的唯一条件是人工 QA 复跑**（WI-7，QA-1…QA-9，重复标题语料已备在 `scratchpad/wi36-duplicate-headings.md`）——理由和上面那一趟一样：本仓没有任何泳道跑真实 `IntersectionObserver` 或真实滚动，WI-2 / WI-4 全部建立在几何替身上。**这一批同样未提交、未推送。**<br><br>**2026-09-20 WI-6 人工 QA 已跑完：方向性缺陷确认修复，但本行仍是 🔄。** 语料 `scratchpad/wi36-duplicate-headings.md`（111 行，标题在 L1/8/22/34/46/60/74/86/99）+ 新建的 `scratchpad/wi6-short-doc.md`（14 行，三标题，短于视口故不可滚动）。**逐条判定**：①「上下滚都跟住」**过** —— 同一 `scrollTop` 在下行程与上行程给出**逐字节相同**的 `topLine`（首可见 15 → Setup、28 → Details，两个方向各测一次完全一致），旧构建在首可见 28 处显示的是 Middle marker one；②「同名标题挑对那一个」**过**（钳位处命中第三个 `Setup`，L86）；③「点了就停住，含 `## Tail`」**过**（L99 与 L86 都停住）；③b「离开底部释放钳位」**过**（上滚 3 格后 picker 重新接管）；④「切模式后高亮合理」**partial** —— 高亮对新位置是对的、**没有**卡在 EOF，但内容仍跳回文首，这是 WI-7 判据 4 记下的**既有**缺陷，本次修复不触及；⑤「每进一次源码模式恰好一条 `spy.attach`、滚动时零日志」**过** —— 去掉仪表后重跑，一次冷启动 + 六次滚动手势 + 一次点击只产生 **1 条** `ui.toc.spy.attach`、**0 条**滚动日志，⌃4/⌃2 往返恰好 1 detach + 1 attach；⑥「无可感帧率代价」**未客观测量**，手感无卡顿；⑦**双主题（规则 34）NOT VERIFIED** —— Theme 菜单坐标被菜单栏工具 iBar Pro 占用，按 `gui-acceptance` §9 不与之争、也不申请该工具的权限；本次缺陷是行为性而非视觉性，故不影响上述结论。**2026-09-20 复查：该阻塞仍在**（再点一次 Theme 菜单，仍返回「would land on 'iBar Pro'」），**但它对本批改动不承重** —— 本批改动集里 `.css` 与 `.tsx` 文件数**均为 0**（全部是 `.ts`：三个 util、两个 hook、六份测试），没有任何样式或标记变更，故不存在可被主题影响的回归面。仍按 `gui-acceptance` §8 记 NOT VERIFIED 而**不**私自升格为 pass。<br>**`clientHeight > 0` 那个「看着多余」的合取项拿到了实证。** 短文档实测 `scrollTop=0 scrollHeight=732 clientHeight=732 maxScroll=0 atScrollLimit=true`：`maxScroll` 与未布局滚动条同为 0，**唯一**把两者分开的就是 `clientHeight`。同一篇文档里点 `Short doc beta` 后停住不动、等 3 秒不回弹、再试图滚动仍不回弹 ⇒ 保持逻辑在不可滚动文档上确实**保持开启**，正是 ADR-0017 与 `codemirrorViewportLine.ts` 头部 §(a2) 声称、并预言「后来的读者会想删掉」的那一条。**⇒ `codemirrorViewportLine.ts` 头部 §(d) 记的集成义务（obligation 2）到此解除**，头部 UNMET 标记应随本次提交一并改写。<br>**⚠️ 第一轮跑出了一个假 FAIL，已当场撤回，原因记在此处以免重演。** 第一轮完整复现了旧缺陷并已经以「QA-A FAILS」上报，读日志窗口后才查明：macOS 单实例把 `open -a` 路由进了一个**在重新构建之前就已启动**的进程（日志特征 `file.open.external` 带 `appReady: true`、新开 `mdpro-<uuid>` 窗口而 `main` 失焦），该进程执行的是被覆盖前的旧映像，**而 `ps`/`pgrep` 仍报新构建的路径** —— `gui-acceptance` §4 的 `ps` 检查在结构上照不出这件事。缓解办法是**先 `pkill` 再构建**，已连同「不要用字符串搜索二进制验新鲜度（Tauri 把前端资产压缩内嵌，`atScrollLimit` 与既有的 `ui.toc.spy.attach` 一样搜不到）」一起补进 `.claude/skills/gui-acceptance/SKILL.md` 新增的 §3 Trap 3。第一轮保留为旧缺陷的**干净对照**。<br>**⚠️ QA 反过来查出 ADR-0017 正文有一句与实测不符。** 其 Decision 节写「Scrolling to the very bottom leaves the highlight on the **second-to-last** heading」；实测滚到底（第 111 行在屏）高亮落在 **Middle marker two（L74，倒数第三）**，倒数第二的 `Setup`（L86）与最后的 `Tail`（L99）都在屏且都未高亮。正确的表述是「落在锚点上方最后一条标题」，被落下几条取决于最后一屏能装下几条。**ADR Accepted 后不可变**，故只记录、未就地改；如何订正（新开一份 superseding ADR，还是在别处记勘误）需用户定夺，ADR 编号 0016 仍为 D6.2 保留、下一个可用号是 0018。<br>**2026-09-20 结案：本行改 ✅。** 判据 ⑦ 双主题仍为 NOT VERIFIED（iBar Pro 占用菜单栏坐标，未按 §9 去申请该工具的权限），但本批改动集**零 `.css`、零 `.tsx`**（三个 util、两个 hook、六份测试，全是 `.ts`），不存在主题相关回归面，故按 §8 保留为「未验」而非私自升格为 pass，且不阻塞结案。**本批仍未提交、未推送**；`src/hooks/useSourceScrollSpy.ts` 上的临时诊断 `TEMP-WI6-DIAG` 已完全移除（回到 231 行，构建产物哈希 `index-DwapGNr-.js` 与加仪表前一致），双 typecheck 与 5 份 spy 测试 84 例全绿。<br>**判据 ④「切模式内容跳顶」已查明根因，并按用户裁定另立工作项、不计入本行。** 调查结论经逐条核实源码而非采信 subagent 报告：`src/App.tsx:1155-1164` 是 `viewMode === "wysiwyg" ? <MilkdownEditor/> : <SplitView/>`，**两个不同的组件类型**，React 因此在每次 ⌃2/⌃4 都卸载整棵子树再挂载另一棵（不是 CSS 隐藏）；`Editor.tsx:147-155` 的卸载副作用清空 `editorView`，`@uiw/react-codemirror` 随之销毁 `EditorView`，下次进 Source 由 `onCreateEditor`（`:168-201`）新建一个 `scrollTop` 为 0 的视图。唯一的过渡前捕获缝 `runViewModeTransition`（`src/stores/editorStore.ts:36-49`）只存表格单元格；`:198` 的 `view.dispatch` 未带 `scrollIntoView`，也不滚动。**⇒ 这不是滚动恢复机制坏了，而是整个应用根本没有滚动恢复机制**，属早于本工作项存在的缺失功能，而非 3.6 的回归。建议编号 **WI-8**，要点：捕获侧单点（`runViewModeTransition`，仿 `pendingTableCell` 的 document-scoped 模块槽，载荷存 `headingKey` 而非像素 —— 两个surface 字体行高内容宽度都不同，像素不可移植），恢复侧不可避免分两处（`Editor.tsx` 的 `onCreateEditor` 旁 + 新建 `useMilkdownScrollAnchorRestore.ts`，因 `MilkdownEditor.tsx` 已 315 行超 300 行上限）；跨模式映射**无需发明**，`readSpyLineRange`→`pickActiveKeyByLine`→`resolveHeadingElements` 与 `useTOC.ts:186-243` 的 `scrollToHeading` 已具备双向能力。**三条必须先记下的风险**：① 精度天花板只到标题级，单标题下的长小节会明显落错；② 两个 surface 在挂载那一帧都未布局，恢复时机是真正的工程难点；③ 恢复触发的 `scrollIntoView` 会被 `useSourceScrollSpy` 采样并回写 `activeEntryId`，**可能回归本次刚验收的修复**。<br>**ADR-0017 的「second-to-last」订正已落地**：按用户裁定新开 [ADR-0018](../adr/0018-bottom-of-document-stranded-heading-count.md) supersede 之（0016 仍为 D6.2 保留、未消耗）。0017 仅改 Status 行并回链，正文一字未动；其决策不变，改的只是「滚到底落在倒数第几条」这一描述 —— 实测倒数第三，且**被落下几条并非定值**，取决于最后一屏能装下几条标题。<br>**顺带清理三处死代码**（与本次调查同源，均为已跟踪文件，可随时 `git restore` 回滚）：`ScrollPosition` 三件套（`src/types/editor.ts` 的类型 + `editorStore` 的两个 slot 与两个 setter，零读零写）、`TabState.scrollTop`（只在建 tab 时写字面量 0，`saveTabState` 除测试外无调用者）、`src/hooks/useScrollSync.ts`（预览面板删除后遗留，全仓无 import）。删后双 typecheck 全绿、全量单测 **PASS (2026) FAIL (0)**。注意 `useScrollSync.ts` 里的 `editorScroller`/`handleEditorScroll` 是**子串误报**，不是 store 字段的读者。 |
| 3.7 | ✅ | 三层测试 —— **2026-09-19 再次重写：两项欠账均已交付，本行改记 ✅**（范围曾于同日先收窄为「只剩第二层与第三层导航」，那次收窄的两条欠账本身也已被推翻或兑现，见右） | **本行已被 3.5 部分兑现，故重写范围，避免读成「已做完」或「与 3.5 重复」。3.5 已交付：第一层**（`coordinateHeadingKeys` 的匹配器单测，跑在不透明键上、与解析器无关，`tests/heading-coordination.test.ts`）**与第三层的折叠那一半**（`tests/toc-sidebar-collapse.test.tsx`：击键后仍折叠、改名后仍折叠、重复标题各自独立）—— 规则 10 要求缺陷修复自带回归测试，这些正是没有修复就会红的用例，故不能推到本行。**本行仍欠的两项**：① **第二层语义契约测试**，对着 3.0 的真实语料跑（围栏、Setext、格式化标题、重复标题、CJK、CRLF、slug 唯一性），今天的协调测试刻意不碰解析器，所以这一层一条都还没有；② **第三层的导航那一半**，即点重复标题必须落到对的那一个 —— 它依赖 3.6 先把 WYSIWYG 的首个命中即 `break` 修掉，无法早于 3.6 结案。另 3.8 行提到的「过期解析结果」不变量仍挂在本行第三层。**原行记录保留**：**无既有安全网** —— `tocStore`、`useTOC`、`TOCSidebar` 三者的测试文件数当时**均为 0**（与本文后面「**确实为零的是**」一段一致；原记的「第 428–430 行」已失效，行号会随每次编辑烂掉，故改引内容），三层全部是新建，不存在可继承的表征测试；3.5 落地后前两者已各自有测试文件，`TOCSidebar` 有折叠行为测试<br><br>**2026-09-19 结案。上一版记的两项欠账，一项本来就是假的，另一项已由 3.6 交付。**<br>**① 第二层「一条都还没有」是错的，而且写下时就已经错了。** 该句描述的是 `909612b`（2026-09-18）之前的树。实测：`tests/heading-identity-parity.test.ts` 把语料的 `toc` 面逐例喂给真实的 `parseHeadingsFromContent`，**当场跑出 28 条 `toc slugs for …` 断言**（另有 4 条 `toc offsets for …`），零失败；全仓共 **9 个测试文件**调用该解析器。本行点名的七个题目逐一有专属用例——围栏 `fenced-hash`（`#` 在围栏内，标题数为 0）、Setext `setext-noncolliding` / `setext-title`、格式化标题 `formatted-bold` / `inline-code` / `link-in-heading`、重复标题 `dup-cjk` / `suffix-collision` / `two-emoji-only`、CJK `cjk-basic` / `punctuation-cjk`（外加整份 `tests/cjk-slug.test.ts`）、CRLF `crlf-doc` / `crlf-two-lines` / `lf-two-lines`、slug 唯一性 `suffix-collision` / `clobber-*` 五例。**同一张表里的 3.3、3.4 两行本来就与这句话矛盾**，只是没人把两边读到一起。<br>**② 第三层导航那一半已由 3.6 交付。** `tests/use-toc-navigation-identity.test.ts` 的 R1 断言的是**元素身份**（`receivers.map((r) => r.el)` 等于 `[fixture.headings[1]]`）而不是文字，跑在实测到的 `intro` / `intro-#2` 分歧上；高亮那一半在 `tests/use-toc-scroll-spy-identity.test.ts` 的 R3b。上一版写的「依赖 3.6 先把首个命中即 `break` 修掉」在依赖方向上没错，但 3.6 的结论是**根因不在那句 `break`**（见 3.6 行与 [ADR-0014](../adr/0014-toc-addresses-headings-by-document-order.md)）。<br>**③ 挂在本行第三层的「过期解析结果」不变量已结案，结论不是「补一个修订号」。** 行为那一半早已成立：取消发生在 `useTOC.ts` 的 effect cleanup，`setEntries` 带 document id，由 `tests/use-toc-document-scope.test.ts` 的 U-L1 用**否定式归档断言**钉住（A→B→A 之后 `byDocument.has("doc-b")` 为 `false`，这是唯一能把「B 落过又被覆盖」与「B 从未落地」分开的断言）。至于计划 M 红线 3 的**字面**要求（修订号），经外部复议后判为**不应实现**：记在 [ADR-0015](../adr/0015-toc-staleness-is-closed-by-cancellation-not-a-revision-number.md)，`ba13def`。复议顺带纠正了本仓一处流传的错误说法——`tocStore.setEntries`（`src/stores/tocStore.ts:151-203`）在 document id 不匹配时是**归档旧文档、接受新写入**，**全函数没有拒绝路径**；id 买到的是归属与隔离，不是新鲜度。守卫由 `tests/toc-parse-synchrony-invariant.test.ts`（今天绿、破坏前提即红）承接。<br>**⚠️ 人工 QA 只挂在 3.6 行，本行不重复挂账。** 第三层导航与高亮的断言全部建立在测试替身上（jsdom 既不实现 `IntersectionObserver` 也不实现 `scrollIntoView`）。本行 ✅ 的含义是**三层测试存在且各自门禁通过**；这些断言在真实应用里是否成立，由 3.6 的 🔄 承担，QA 失败时回退的是 3.6 而不是本行。 |
| 3.8 | ⬜ | 出口复测大文档性能（基线已在入口门禁 2 取得） | ⚠️ **ADR-0004 改了本行的比较方式**：入口基线里含一个**不收敛**的阻塞（9.96 MB 形态），整体聚合比较无法把第 3 步的回归与既有卡死区分开。**本行必须逐面比较，并逐个点名排除已卡死的形态**，不得比聚合值。**豁免只到入口为止，不覆盖本行。** P 的「零额外 React commit」**不能**替代 —— 此话 P 自己也说了（`20260911-plan-ui-redesign.md`「The performance gates are not interchangeable」），非本文自创。**「过期解析结果」已从本行移出**：它是 M 的迁移红线第 3 条「异步结果必须携带文档 ID 与修订号」，属数据正确性不变量，不是性能指标，须由 3.7 第三层行为测试断言。**2026-09-18 复核：D6 仍未修**（`App.tsx:512` 的 `if (bytes <= 500 * 1024) return;` 一字未动），而 ADR-0004 的豁免**不覆盖本行** ⇒ D6 必须先于本行结案；计划 M 至今**没有承载它的工作项**（M 里唯一一处 D6 提及在 `:519`，只是重述这笔债被挂着），这个缺口本身需要有人补<br><br>**2026-09-19：那个「需要有人补」的缺口已补 —— 计划 M 现在有 D6 工作项了**（`20260912-plan-markdown-source-consolidation.md` 的 `### WI-D6` 一节，紧接在门禁二记录之后）。补的是**工作项**，不是**修复**；本行仍记 ⬜，且**在可预见的时间内不是我能推进的**，理由如下。<br>**D6 的判据重选被一条 Accepted 的 ADR 挡着，不是被拖着。** [ADR-0006](../adr/0006-bump-micromark-gfm-table-for-quadratic-edit-map.md)`:97-103` 已经把诊断做完：护栏**机制**有效（本地日志里 76 次 Milkdown 工厂调用，`initialMarkdownLength` 最大 430,614，超 500 KB 次数为 0），错的是**阈值**与**判据变量**（cost tracks cells in the largest single table, not bytes）；但同一份 ADR `:190-193` 明写这件事 **still unmeasured**，且重选判据仍取决于一次 real WKWebView 上的 sweep。**在拿到那次真机 sweep 之前写死任何新阈值，都是和 ADR-0006 对着干，而且是把一个没有测量支撑的数字钉进用户能感知的护栏。**<br>**本仓测不了这件事，这是查证过的而不是推测的**：`.claude/tdd-guardian/config.json` 只有 `unit`（vitest/jsdom）与 `rust`（cargo）两条泳道；`package.json` 无 playwright / puppeteer；`scripts/perf/` 只有生成器、没有 runner；`src-tauri/tests/perf_render_corpus.rs` 是 `#[ignore]` 且只测 Rust 侧。门禁二里每一个 Milkdown 数字都是**手工用 Web Inspector 取的**。⇒ **D6.1 只有用户能跑；它与 3.6 行的人工 QA 是本阶段仅剩的两件必须离开测试运行器的事。**<br>**另记一件实施前必须知道的事**：`src/App.tsx:507-516` 这条护栏**今天一个测试都没有** —— 全仓 `tests/` 下无任何用例断言「超阈自动切源码模式」或提到 500 KB 阈值，也没有任何测试文件渲染 `App.tsx`。D6.3 是从零建网。**⚠️ 上面这句写于 `23ae6ef` 之前，今天已作废，见下一段。**<br><br>**2026-09-20：D6.3 已交付，上面那句「一个测试都没有」现已为假。** 实测而非推断：护栏判定早已**不在** `App.tsx` 里，而是被提取成纯函数 `decideLargeDocumentGuard({viewMode, fileSize, content})`（`src/utils/largeDocumentGuard.ts:82`，返回联合类型 `LargeDocumentGuardDecision`，`:71`），`App.tsx:513` 只是调用它并对 `decision.action` 做穷尽 `switch`。两份测试今天随提取一起进仓：`tests/large-document-guard.test.ts`（613 行，`23ae6ef`「extract the large-document guard predicate into a pure function」）与 `tests/large-document-guard-call-site.test.ts`（403 行，`15f27a0`「call the extracted large-document guard from App」），共 **34 例、全绿**（`vitest run` 两文件 34 passed，exit 0）。所以「没有任何测试文件渲染 `App.tsx`」仍然属实，但它**不再构成缺口**——判定逻辑已被搬出组件，用不着渲染 `App.tsx` 就能测；call-site 那份则以源码文本断言调用点形状与穷尽性。**记这一笔的理由**：上一句在写下时是对的，删掉它会抹掉「这个缺口存在过、并且是被提取重构关掉的」这条证据；而留着不标注，会让下一个读者去建一张已经存在的网。**D6 本身仍未结案**：D6.3 关了，D6.1（真机 sweep）与 D6.2（判据/阈值重选 + ADR-0016）仍开着。<br><br>**2026-09-20：Rust 渲染面已复测，本行仍记 ⬜。**<br>**先纠正本行自己的一句话。** 上文「`perf_render_corpus.rs` 是 `#[ignore]`」属实，但据此推出「本行无从推进」过宽：那个 `#[ignore]` 是**环境标记**（语料在 `.gitignore` 里），不是测试坏了。语料本地就在，`node scripts/perf/generate-corpus.mjs --check` 当场回「OK: reproduces plan M's recorded table (11/11)」，11 份字节数与门禁二记录逐字节相同 ⇒ **输入完全同一**，可直接与 2026-09-15 的表比。于是照 M §2.5 用**与基线同一个 `test [unoptimized + debuginfo]` profile**（release 的数字与基线不可比）跑了 `cargo test --test perf_render_corpus -- --ignored --nocapture`，`repeats=5`、取中位，exit 0、`1 passed; 0 failed`、166.48 s（基线 164.80 s）。<br>**这不是空跑对照，是真回归测试**：`markdown.rs` 自基线以来被 `32346a4`（「fix slug collisions on three live faces and keep anchors」，`f947ec1`）改过；`Cargo.lock` 未动 ⇒ 无依赖漂移，比较被隔离在 mdpro 自己的代码上。<br>**结果（render_p50 / sanitize_p50，毫秒，前→后）**：`dense-math.source` 1982.5→1920.4 (−3.1%) / 5908.3→5584.2 (−5.5%)；`large-table.source` 2351.6→2327.6 (−1.0%) / 10307.5→10598.0 (+2.8%)；`many-short-nodes.source` 2205.3→2150.3 (−2.5%) / 5536.3→5499.2 (−0.7%)；`normal-prose.source` 998.9→1022.6 (+2.4%) / 680.3→733.4 (+7.8%)；`very-long-line.source` 925.9→940.9 (+1.6%) / 439.4→446.3 (+1.6%)；五份 wysiwyg 形态均在 ±4.1% 内。**11 份 `html_bytes` 全部与基线逐字节相同**（含 `dense-math.source` 的 20,997,592），与 slug 分配器文档里「OUTPUT-IDENTICAL, not an approximation」的自述一致。<br>**预测与判读，含仪器的局限。** 事先（未见数字时）记下的可证伪预测是：摊还 O(n)，每标题一次 `HashSet` 插入加一次 `String` 分配 ⇒ 五个零标题形态与 `sanitize_html`（未改动）应为噪声，`normal-prose`（3,007 标题）可忽略，`dense-math`（70,886 标题）至多**几十毫秒**上升；**出现倍数即证伪并指控分配器**。实测无倍数，`dense-math` 反而低 62.1 ms。**但不能就此宣称预测被证实。** 用「这次修复不可能碰到」的面估噪声底：零标题形态的 render 落在 [−2.5%, +1.6%]，未改动的 `sanitize_html` 落在 [−5.5%, +7.8%]。**噪声底（±8%，在 1920 ms 上约 ±154 ms）比预测要分辨的效应（几十毫秒）还大**，所以这次测量能排除倍数级回归，**排除不了几十毫秒的变化**。真正有力的证据是 `html_bytes` 全等，而不是这些毫秒数。<br>**本行为何仍是 ⬜（三条，缺一不可）**：① **D6 未结案**，ADR-0004 的豁免按其自身措辞不覆盖本行；② 这次只测了 **Rust 渲染面**，而门禁二记录里那两个病态数字（`very-long-line` 关文档主线程阻塞 **79,197 ms**、切到 `large-table.wysiwyg` **55,766 ms**）都在 **WYSIWYG/WKWebView 面**，只能由 D6.1 真机 sweep 取得；③ ADR-0006 `:190-193` 在那次 sweep 之前禁止写死任何新阈值。<br>**合规性说明**：`perf_render_corpus.rs` 按设计不断言任何阈值（E39/G0 禁止把毫秒数变成阻塞门禁），所以**跑它是合规的；用它的数字去写一个阈值则不合规**。本条只记录观察值。 |

### 3.3 解析成本：观察值，**不是门禁**

计划 M 的记录表（`20260912-plan-markdown-source-consolidation.md:535-547`）是对着**行正则**测的，
换成 Lezer 之后 3.8 行的出口比较少了一个有效的「after」数，故在此补测。
**这几个数只作观察，不得升格为门禁**：决定 E39 禁止把毫秒阈值作为阻塞条件，
[ADR-0004](../adr/0004-gate2-waiver-for-stage3-entry.md) 的豁免也**明确不延伸到 3.8**。

方法：语料取自入库的 `scripts/perf/generate-corpus.mjs`（`--check` 本次 exit 0，11/11 逐字节复现记录表）。
「before」是 `git show HEAD:src/services/tocService.ts` 里的行正则实现，**仅在 scratchpad 中重建**，
从未签出到工作树；「after」是现行 Lezer 实现。两者都调用真实的 `stripFrontmatter` 与
`createAnchorSlugAllocator`，在 vitest/jsdom 下同一进程内交替计时，先跑预热再取样。

| 语料 | 体量 / 标题数 | before（行正则）中位数 | after（Lezer）中位数 | 倍数 | 取样数 |
|---|---|---|---|---|---|
| `normal-prose.source` | 9.96 MB / 3,007 | 7.29 ms | **2,067.82 ms** | ~280× | n=21（预热 3） |
| `normal-prose.wysiwyg` | 474 KB / 143 | 0.28 ms | **34.94 ms** | ~125× | n=51（预热 5） |
| `normal-prose.wysiwyg.crlf` | 476 KB / 143 | 0.28 ms | 34.51 ms | ~125× | n=51（预热 5） |
| `dense-math.wysiwyg` | 472 KB / 3,444 | 1.99 ms | 406.51 ms | ~204× | n=21（预热 3） |

硬件与工具链：Apple M4 / 24 GB / macOS 26.3.1 / Node v22.22.3 /
`@codemirror/lang-markdown` 6.5.0（声明范围 `^6.2.5`，实测解析到 6.5.0）。
**换机器数会变，倍数比绝对值更耐读。**

三条读这张表时必须一起读的注记：

1. **Lezer 侧稳定，正则侧不稳定。** 独立复跑一次（源码层 n=11）得 2,163.51 ms 与 35.37 ms，
   与上表相差约 5%；而正则侧的中位数在两次运行间为 7.29 / 10.25 ms —— 它已逼近计时器粒度与 GC 噪声，
   **所以「~280×」应读作「两个数量级」，不应读作一个三位有效数字的比值**。
2. **两个解析器在本语料上标题数完全一致**（3,007 / 143 / 3,444），因为这些形状既不含 setext 标题、
   也不含围栏里的 `#`。**这是语料的性质，不是契约** —— 它恰恰说明本语料**测不出**本次修的那几类缺陷。
3. **`useTOC.ts` 的解析跑在 300 ms 去抖里。** 9.96 MB 文档上一次解析约 2.07 s，
   **已远超它自己的去抖窗口**，且是主线程同步调用。这不构成本行的阻塞判定
   （该形态正是 ADR-0004 记在案的既有卡死形态，且 500 KB 护栏之外），
   但它是 3.8 出口复测**必须逐面点名**的形态之一，不得并进聚合值里。

**身份契约至少要规定**（**以计划 M 的契约条款为准，本文只作索引**）：标题前后编辑普通段落 →
折叠状态保留、位置更新；重复标题彼此独立；删除标题 → 清理其折叠与活动状态；
切换文档 → 清空状态，不因两个文档都有 `intro` 而继承；无法可靠匹配 → 重置而非猜测转移。

其中「重命名/插入/移动的保留规则明确写死」一条，此前**只存在于本文**，
而本文按章程不得新增验收标准。该要求本身成立（它直接来自 M 对 `headingKey`
「约定范围内跨修订协调」的限定），故已**收编进计划 M 的契约段**，本文改为引用而非主张。

**边界**：`App.tsx` 只许改自身所需的接线（文档 id、修订号），不夹带布局或生命周期重构。

**必须登记**：导出此时**仍是旧语义**，该中间状态进语法矩阵，对外**不得宣称「语义已统一」**。
共享 remark 配置与 Milkdown 实际插件集合也需一致性验证。

---

## 阶段 4 — 计划 P 主体

**本阶段状态：⬜ 未开始**（2026-09-18 实测：计划 P 的 Stage 1 产物 `src/styles/index.css`、
`src/styles/sections/`、`ToggleSwitch.tsx`、`Icon.tsx`、`useTauriEvent.ts` **均不在 HEAD**，
实现为零，不是「部分完成」）。
~~另有一条**硬前置至今未满足**：WI-4.21 依赖的 ESLint 在仓库内仍然零存在。~~
**2026-09-22 更正：这条前置已经消失，不是被满足，是被取消。** WI-4.21 需要的是
一条规则，不是一个 linter；规则改由仓库脚本 + 已装好的 `typescript` 编译器 API
实现（[ADR-0023](../adr/0023-one-lint-rule-enters-as-a-typescript-parser-script.md)）。
仓库里确实仍然没有 eslint，而这**不再阻塞任何东西** —— 见下方「三个两个计划都未记载的问题 ①」。

**2026-09-22 登记：两个 Stage 4 工作项的「selector 那一半」已提前在树里，阶段状态仍记 ⬜。**
这不是 Stage 4 开工 —— Stage 0 停止点 1 未过，WI-0.1 基线未跑 —— 而是别处的工作顺带兑现了它们的一部分，
不登记的话 Stage 4 开工时会重做：

- **WI-4.21 的 selector 半**：两处违规之一 `AdvancedSettings.tsx` 与防回归规则随 `3fb07b6` 落地
  （规则形态按 ADR-0023 是 `scripts/lint/no-bare-store-hook.mjs`，不是 P 原写的 `no-restricted-syntax`；P 已同步订正）。
  **MCP 窗口路由半（E23，`http_server.rs` 的 `window_label: None`）一字未动**，WI-4.21 仍是基础链第一项。
- **WI-4.26 的 `useTOC` selector 半**：随阶段 3.5（`2a0e1a4`）落地，`src/hooks/useTOC.ts` 现为八个逐字段 selector。
  **E37 的等长替换漏同步（`useMcpSync.ts` 以 `content.length` 作变更哈希）仍未修**，WI-4.26 剩下的就是它。

### Stage 0（仅改计划文档）

WI-0.1 基线 → WI-0.2 字面量清点 → WI-0.3 QA 矩阵 → WI-0.4 基线截图 →
WI-0.5 CSS 文件图 + rule 33 提案 → WI-0.6 设计评审

→ **停止点 1：用户显式批准，A1–A12 / Q1–Q14 全部回答或豁免**（Q15、Q16 仍开放，无提案）

### Stage 1（交付物 A，零视觉变更）

WI-1.0 测试工具**验证**（安装已在 1.6 完成）→ WI-1.1 `index.css` + `appCss` helper → WI-1.2 搬入 partials

*WI-1.2 第一个提交先删 `.toolbar-recent*` 与 rule 31 z-index 表中的 Recent 行，纯搬移证明以此提交为基准。*

### Stage 2（交付物 A）

WI-2.1 tokenization 守卫（先 RED）→ WI-2.2 等值 token → WI-2.3 迁移 class (a) 字面量

→ **停止点 2（交付物 A）**

### Stage 3（交付物 B）

WI-3.0 `--color-border` 当填充审计 → WI-3.1 主题 token 重调 → WI-3.2 class (b) 字面量 →
WI-3.3 焦点环 → WI-3.4 macOS 13.1 floor → WI-3.5 文档/证据/QA

→ **停止点 3：强制视觉签收**

### Stage 4（交付物 C）—— 最复杂，严格串行顺序

| 序 | 工作项 | 前置 |
|---|---|---|
| 1 | WI-4.11 已开文件守卫 | 无（Stage 4 第一个） |
| 2 | WI-4.14 WYSIWYG 跟随外部写入 | 4.11，且在 lane 分叉前 |
| 3 | WI-4.1 Source 语法高亮 | Lane A，独立 |
| 4 | WI-4.2 Icon 封装 | Lane B 头 |
| 5 | WI-4.13 错误 toast | 4.2 |
| 6 | WI-4.3 设置行契约 + ToggleSwitch | Lane C 头，需 4.13 |
| 7 | WI-4.4 Running badge / toggle track | 4.3 |
| 8 | WI-4.7 设置 rail | 4.4 |
| 9 | WI-4.15 菜单键盘契约 | 独立 |
| 10 | WI-4.21 MCP 窗口路由 + Zustand selectors | 基础链第一 |
| 11 | WI-4.18 ViewMode 持久化 | 4.21 |
| 12 | WI-4.23 文档身份 + open coordinator | 4.11 + 4.18 |
| 13 | WI-4.19 取消安全订阅原语 | 九个 `listen()` 点全迁 |
| 14 | WI-4.17 文件监视尾事件投递 | 4.19 |
| 15 | WI-4.16 IPC 错误契约 | 4.17 + 4.13 |
| 16 | WI-4.24 open result union | 4.16 + 4.23 |
| 17 | WI-4.20 命令日志包装 | 4.16 |
| 18 | **WI-4.22 文件大小棘轮 + `App.tsx` 生命周期缝** | 基础链最后 ★ |
| 19 | WI-4.25 插入模态所有权令牌 | 4.15 + 4.22 |
| 20 | **WI-4.26**（已收窄：仅 E37 变更检测 + `useTOC` selector） | 4.22 → 4.26 → 4.8 **严格串行** |
| 21 | WI-4.6 破坏性确认 | 4.13 |
| 22 | **WI-4.8 主栏 + 状态条** | 4.2 / 4.13 / 4.6 / 4.21 / 4.19 / 4.14 / 4.22 / 4.26 全部先落地 |
| 23 | WI-4.5 分段控件 | 4.8（挂在主栏里） |
| 24 | WI-4.9 空状态 | 4.8 |
| 25 | WI-4.10 外部变更对话框 | 4.9 |
| 26 | WI-4.12 拖放目标 | 4.10 + 4.19 + 4.9 + 4.22 |
| 27 | T31 性能证据与预算 | 4.26 + 4.8（只记录，不阻塞） |

★ **18 落地后立即重写剩余所有 App 任务的文件集合** —— 九个任务不得继续按 WI-4.22 之前的行号执行。
同一时段只保留一个修改 `App.tsx` 的实施 PR。

→ **停止点 4：强制视觉签收**

### Stage 5（交付物 D）

**准入**：E6 `config.json` 覆写修复必须已作为独立 PR 落地（**实测仍未修**）。

WI-5.1 Rust 模型 → WI-5.2 TS 类型 → WI-5.3 运行时应用 → WI-5.4 设置行 → WI-5.5 设计系统转正（最后）

→ **停止点 5**

---

## 阶段 5 — M 剩余部分

**本阶段状态：⬜ 未开始**（2026-09-18 实测：M 要收敛的五套引擎全部还在；
`toc.rs` 与 `preview_html` 未退役；`marked` 导出降级仍在 `exportService.ts:104`）。

| # | 状态 | 任务 |
|---|---|---|
| 5.1 | ⬜ | M 阶段 3：TS 导出并行验证（MDAST→HAST→HTML，以旧 Rust 输出为差异参照，**ammonia 保留**） |
| 5.2 | ⬜ | 移除 `marked` 导出降级（改显式报错 + 重试）—— 独立交付 |
| 5.3 | ⬜ | M 阶段 4：切换并移除 pulldown-cmark；退役 `toc.rs`、`preview_html` |
| 5.4 | ⬜ | M 阶段 5：编辑保真分级推进（⚠️ 已保存数据的损失无法靠代码回滚恢复） |
| 5.5 | ⬜ | M 阶段 6：**仅当** TS 净化覆盖全部出口且安全评估通过，才评估删 ammonia |

---

## 贯穿全程的门禁

- **G0 在每个工作项末尾和每个阶段末尾都跑**（唯一的带标号门禁，无 G1/G2）：
  build / test / cargo test / 文件集越界 / 无新依赖 / 无截图 / coverage /
  Milkdown 浏览器套件 / 性能确定性断言 / 未提交未推送。
  FPS、堆、毫秒级阈值**永远不进 G0**。
  ⚠️ 由此产生一个执行点缺口：M 的大文档性能验收正是用解析时间 / 峰值内存 / 主线程阻塞表达的，
  它**不进 G0**，但也不能因此无人执行。**裁定：它是阶段 3 的入口门禁（见阶段 3 开头），不由 G0 把关。**
  两者不冲突 —— G0 是每工作项的常规门，它是一次性的入阶段门。
  ⚠️ **订正把关方**：此前写作「由阶段停止点把关」是错的——**五个停止点全部位于阶段 4（计划 P 主体）内部**，
  阶段 3 之前没有任何停止点，照此该门禁在文本上无人把关。
  实际约束来自 M 自身：「阶段 3 入口门禁二」写明门禁未达成前 3.1 不可进入；
  进入 3.1 之前须把达成证据回写到本文。
  **2026-09-16 结清**：六面证据已回写（见阶段 3 开头），违反的那条标准经
  [ADR-0004](../adr/0004-gate2-waiver-for-stage3-entry.md) 豁免，**3.1 准予开工**。
- **五个停止点**：Stage 0、2、3、4、5 结束 —— 发停止报告，提交拆分方案，
  **等用户明确回复才能开始下一阶段**。

---

## D 系列缺陷轨

**这是一张登记表，不是工作项表。** 它只记录「已实测证实、却不属于任何阶段工作项」的缺陷：
编号、级别、当前状态、证据在哪、修没修。**本表不创设验收条件** —— 按本文章程，验收条件仍在
计划 P / M 与各 ADR 里；本表与它们冲突时以原计划与 ADR 为准，并回来修正本表。

**编号不连续，且这是历史事实、不是丢了行**：{D1, D5, D6} 来自门禁二记录
[`20260915-stage3-gate2-record.md`](./20260915-stage3-gate2-record.md) 第 206–210 行的缺陷表，
那张表就只有这三个。**D3 / D4 从未存在过** —— 仓库里没有这两个标签，也从没有过，
**永久留空，不得回填、不得挪作他用**。D2 / D7 / D8 由本表登记（D2 的编号是采纳既有会话标签，见下）。

**先认下这笔记账缺口**：在本节新增之前，D 系列在本文里**只出现过一处** ——
阶段 3 入口门禁二段落（第 128 行）的「D6 与 10 MB 卡死仍挂账」。D1、D5 在排期视图里完全不可见；D2 已修完，却连编号都没进过任何表。
排期文档看不见的挂账等于没有挂账，这是一个真实的缺口，本节是来补这一笔的。

**状态写法**：沿用总览的图例（✅ 已完成并验证 ｜ ⬜ 未开始 ｜ ⛔ 常驻约束），但图例是为**任务**设计的，
对缺陷只有 ✅ 能直接借用（D2）。其余两种**明写文字，不造新字形**：
「**未修复**」用于无人在做、也不属于任何工作项的缺陷 —— 不用 ⬜，因为 ⬜ 会被读成「已排期、未开始」，那是失实；
「**已豁免（仅入口）**」用于 D6 —— 它既非未开始也非已完成，而是被 ADR-0004 按范围放行，图例里没有对应值。

| ID | 级别 | 状态 | 缺陷 | 证据与提交 |
|---|---|---|---|---|
| **D1**（既有） | MUST | **已修复** | 计时器跨越文件选择器。实测导出报告 72 745 ms，其中 72 154 ms 是人工停留，净成本 591 ms；**经由对话框的 `durationMs` 全部不可用** | 门禁二记录 `:210`。记录只点名 `file.rs:1098`，**实测同一形态共三处**（见下，且出数字的不是被点名那处）。「既有」在仓库内无更早出处：`git log --all -S '**D1**'` 只命中 `c92b1ba`。**修复（2026-09-22）**：三处全部改掉，两种改法 —— open 路径计时器移到选择器之后，两条导出路径把「渲染+净化」这一段**在选择器打开前收进 `Duration`**，选择器关闭后再起第二段，`duration_ms = render_span + write_start.elapsed()`，人工停留正好落在两段之间的缝里。回归测试 `src-tauri/tests/timer_excludes_dialog_dwell.rs`（4 例，RED 1→GREEN 4），见下。修复提交 `ea02d23` |
| **D2** | —（未定级：登记入表时已修复） | ✅ 已修复并验证 | 日志设置的两条失败路径：① `src-tauri/src/commands/logging.rs` 的无锁 read-modify-write（丢失更新）；② `src/services/loggingService.ts` 的 IPC 失败 fail-open，**把显式关掉日志的用户静默改回开启** | 五个提交 `ba9fdb7`、`a089c55`、`061feff`、`560db38`、`dae10d5`。**「全部未推送、分支领先 5 个」已过期**：2026-09-18 以 `git ls-remote` 核实，`origin/frontend-backend-redesign` 的尖端就是本地 HEAD `e030a2c`，五个提交均已在远端。门禁数字与两处残留见下 |
| **D5** | BLOCK | ✅ **已修复**（代码层已验证；**打包复现未做**，见右） | `src-tauri/tauri.conf.json:28` 的 CSP 无 `connect-src`，`default-src 'self'` 因此拒绝 `ipc://localhost`；打包构建每次启动约 20 条 console 错误。Tauri 回退 postMessage，**功能不受影响**（`invoke`/`listen` 实测正常），但噪音淹没真实错误 | 门禁二记录 `:208`（`c92b1ba`）。⚠️ `pnpm tauri dev` 走 Vite dev server，**根本收不到这条 CSP 头**，所以完全掩盖它，只能在打包构建里复现。<br><br>**修复（2026-09-20）**：`:28` 增补 `connect-src 'self' ipc: http://ipc.localhost`，`default-src` 保持 `'self'` 不动。回归测试 `tests/tauri-csp-ipc-connect-src.test.ts`（6 例，RED 4→GREEN 6）：它复刻 Tauri 的 `convertFileSrc` 算法生成真实 IPC URL，再按 CSP 指令回落规则判定是否放行，因此不是字符串比对；并反向锁住两条——不得靠放宽 `default-src` 来修、`connect-src` 不得含 `*`/`http:`/`https:`/`data:`/`blob:`。<br><br>**本行原描述的两处机制订正（读 Tauri 2.9.5 源码所得）**：① 「Tauri 回退 postMessage」属实，但回退由 `scripts/ipc-protocol.js` 的**模块级 `customProtocolIpcFailed` 闩锁**实现——首次失败后永久走 postMessage。所以那约 20 条**不是每次调用都报**，而是启动瞬间并发的一批 `invoke` 在闩锁置位前全部被拒；此后静默。每条被拒会产生两笔记录（WebKit 的 CSP 拒绝 + Tauri 自己的 `console.warn`）。② 代价不止「噪音」：这批调用每个都要白跑一次失败的 `fetch` 往返才回退，给启动加了一段可测但未测量的延迟。③ 另核实 Tauri **不会**自动补这条指令——`connect-src` 在 tauri 2.9.5 crate 源码中零出现，`manager::set_csp` 只替换 script/style 的 nonce 与 hash。<br><br>**打包层证据（2026-09-20，已做）**：`pnpm tauri build --bundles app` 成功产出 `src-tauri/target/release/bundle/macos/mdpro.app`，对其可执行文件 `Contents/MacOS/tauri-app` 取 `strings` 命中 `default-src 'self'; connect-src 'self' ipc: http://ipc.localhost; …` —— **新策略确实随 bundle 出厂**，不只是仓库里的一行配置。（该次构建在 bundle 产出之后于 updater 签名步骤失败，原因是未设 `TAURI_SIGNING_PRIVATE_KEY`，与本缺陷无关，`.app` 不受影响。）<br><br>⚠️ **运行时判据仍未验**：「打包启动后 console 无 CSP 拒绝」只有启动该 `.app` 并开 Web Inspector 能证 —— 且须在开启 Inspector 后重载一次，因为报错发生在启动瞬间、Inspector 打开前的消息不保留。配置层测试与上面的 `strings` 都证明不了它。按 `gui-acceptance` §8，此项记为 **NOT VERIFIED**，不得静默升级为通过<br><br>**2026-09-22 复测**（[`docs/test/20260922-d5-runtime-console.md`](../test/20260922-d5-runtime-console.md)，两个二进制严格分列，均出自干净 worktree @`44607d8`）：**release 包（sha256 `0440b48f…fb03`）仍 NOT VERIFIED**——`Cargo.toml` 的 `tauri` 只开 `protocol-asset`，未开 `devtools` feature，窗口级 `"devtools": true` 在 release 无效，⌘⌥I 无反应、右键无「Inspect Element」；只有 `strings` 静态证据。**debug 包（`--debug --bundles app`，sha256 `3ae2dd0a…9b04`，**不同的二进制**）重载一次后：CSP 拒绝 0 条、postMessage 回退警告 0 条**，`get_app_version` / `get_preferences` 正常返回。要关掉 release 这一项，须开 devtools 的构建，或由前端自己把回退信号写进日志 |
| **D6** | MUST | **已豁免（仅入口）**，缺陷本身开放 | **护栏机制有效；错的是阈值与判据变量。**`large-table.wysiwyg.md` 仅 471 880 B，低于门槛因而被放行挂进 PM DOM，阻塞主线程约 56 s。该文档为**单表 45 744 单元格** —— 代价随单元格数呈二次方，与字节数几乎无关 | 门禁二记录 `:209`。已核 HEAD（2026-09-20）：判据已由 D6.3(a) 抽到 `src/utils/largeDocumentGuard.ts`，`src/App.tsx:511-532` 只剩薄调用点；**阈值本身未动**，`LARGE_DOCUMENT_THRESHOLD_BYTES = 500 * 1024` 与 `<=` 边界原样保留，等 D6.2 裁定。豁免范围见 [ADR-0004](../adr/0004-gate2-waiver-for-stage3-entry.md) 与本文第 128 行。机制有效性与 56 s 的归因见下。<br><br>**2026-09-20 实测订正两处旧述（D6.1 sweep + 复核）**：① 「阻塞主线程约 56 s」**未复现** —— 真机同窗口切换三次为 11 793 / 11 792 / 10 790 ms（CPU 采样），日志侧独立推算 11 234 / 11 055 / 10 348 ms，冷开 12 004 ms。差异**不归因于任何修复**：仪器、操作与代码状态均与门禁二不同。② 「代价随单元格数呈二次方，与字节数几乎无关」—— **后半句成立，前半句不足以作判据**。五个 fixture 字节数对齐在 471 862–473 540 B 而打开代价横跨 ~0–12 004 ms（字节被证伪）；但零表格的 `many-short-nodes.wysiwyg.md`（32 657 行、0 单元格）同样阻塞约 7 409 ms，故**单元格数不能作为唯一风险变量**。**D6.2 裁定见 [ADR-0016](../adr/0016-large-document-guard-predicate-is-a-source-structure-score.md)（Accepted）**：判据改为**结构元素数 = 行数 + 单元格数**（单趟扫描，不重解析 Markdown），阈值 **25 000**，多表按**全文合计**，降级动作维持「toast + 切源码」但文案必须改，`fileSize` 退出判据输入。实现是 **D6.3(c)**，**2026-09-21 落地**。<br><br>**D6.3(c) 实现记录（2026-09-21）**：判据现为 `score = 换行数 + (竖线数 - 表格行起始数)`，单趟前向扫描、常数辅助空间、不解析 Markdown；阈值 `LARGE_DOCUMENT_STRUCTURE_THRESHOLD = 25_000`，`<=` 放行方向保留；`fileSize` 已从 `LargeDocumentGuardInput` 整体删除（不是留着不用）；toast 改为「This document is too complex for WYSIWYG. Switched to Source mode for performance.」。**对 D6.1 五份语料重算并与实测阻塞严格同序**：`large-table.wysiwyg` 57 190 → 12 004 ms（**旧判据放行，正是本行记的漏判，现已拦下**）、`many-short-nodes.wysiwyg` 32 657 → 7 409 ms（零表格，旧判据同样放行，现已拦下）、`dense-math.wysiwyg` 20 664 → 1 793 ms（放行）、`very-long-line.wysiwyg` 3 → 0 ms（放行）、`normal-prose.wysiwyg` 2 574（放行）；25 000 这条线落在 1.8 s 与 7.4 s 之间。分数由独立重写的参考实现复算，与模块输出在 11 份语料上逐一相符。<br><br>**D6.3(d) 实现记录（2026-09-21）**：同日真机复测（`docs/test/20260921-d5-d6-real-device-measurement.md`）发现 **D6.3(c) 自己引入了一次保护倒退** —— 上面 ③ 记的那份 9 961 475 B、4 行、结构分 3 的文档，旧字节判据会拦，结构分判据放行，而它冷开挂起 **259 483 ms（4 分 19 秒）**、UI 至少 120 s 不可读、CPU 98.5–100%。当初判它安全所依据的「实测 0 ms」是**误引** —— 那 0 ms 属于 471 862 B 的 `.wysiwyg` 变体，与它差 21 倍，`.source` 变体当时根本没测过。[ADR-0019](../adr/0019-large-document-guard-adds-a-longest-line-trigger.md)（Accepted 2026-09-21）在**同一趟扫描**里补第二个计数器 `longestLine`（UTF-16 码元）与第二条阈值 `LARGE_DOCUMENT_LINE_LENGTH_THRESHOLD = 1_000_000`，`<=` 放行，**任一条超了就降级**；ADR-0016 Decision 1 冻结的四项不变量（一趟扫描、常数辅助空间、不解析 Markdown、不分词）全部保持，故 ADR-0019 **扩展**而非取代 ADR-0016。降级载荷加 `longestLine` 与 `trigger: "structure" \| "line-length" \| "both"`，放行分支仍不带任何数字。toast 文案未动。门禁：单测 64 例全绿（51 + 13）、`tsc --noEmit` 通过、`pnpm build` 通过、判据模块行/分支/函数/语句 100%（22 分支）、`pnpm ledger:check` 0 findings。<br>**本行仍不改 ✅。** ADR-0004 把 D6 的结案系在门禁二 3.8 的**逐面出口复测**上；绿色单测证明的是判据按 ADR-0016 实现了，不是重文档在真机 WYSIWYG 下不再卡。**尚待：**① 3.8 出口复测（逐面，不得汇总，只能由用户在真机跑）；② 阈值只拟合在五份约 472 KB、各一次有效测量、同一台机器的语料上；③ 结构分对**行内结构**失明 —— 9 961 475 B 的 `very-long-line.source.md` 结构分只有 3，旧字节判据会拦、结构分判据放行，ADR-0016 明列接受此倒挂。**2026-09-21 订正：这一条已被实测推翻并修复** —— 该语料实测冷开挂起 259 483 ms，ADR-0019 补的最长行判据现在拦下它；残余失明面（多条各 90 万字符的行仍然全放行）见 ADR-0019 Consequences；④ 误判降级在 `~/.mdpro/mdpro.log` 里不留痕迹 —— **2026-09-22 已修**（`3eb60a7`：`src/utils/largeDocumentDegradeLog.ts` 构造载荷，带 `trigger`、两项实测值与阈值，不带任何文档内容；Source 模式仍不判、不记，见下）。<br><br>**2026-09-22 真机矩阵复测**（`docs/test/20260921-d6-matrix-retest.md`，`6b45000`）：ADR-0019 的回归已确认 —— `very-long-line.source.md` 现被最长行判据拦下、15 ms 进 Source（旧构建挂起 259 483 ms）；七个未验格子里两格已填、三格各取一形态、两格仍未验。该记录 §6.2 把 Source 模式 153–183 s 卡顿归为「现有护栏架构够不着的 WebKit 代价」，**此推断已被推翻**（`72adeac` 追加 §7）：栈顶 `operationStringIndexOfWithIndexWithOneChar` 就是我们自己的 `indexOf("\n", i)`，真因是 `tocService` 逐标题前缀重扫，`3d37b86` 修复（组件级 152 551 → 24 ms，未做整机真机复测）。**本行仍不改 ✅**：Source 面依旧没有护栏判据（设计见 ADR-0022，未实现），3.8 逐面出口复测未做<br><br>**2026-09-22 续记（`aac8097`）：⌃2 这一面现在有判据了。** [ADR-0022](../adr/0022-source-mode-gets-its-own-guard-keyed-on-table-row-density.md) 已实现：`src/utils/largeDocumentGuard.ts` 的 Source 分支在同一趟扫描里数表格行起始数，`SOURCE_TABLE_ROW_THRESHOLD = 50_000`、`<=` 放行；超过返回 `withhold-table-extensions`，**不切模式**，只卸掉四个源码表格扩展（`src/plugins/codemirror/sourceTableExtensions.ts`）、停用表格右键菜单与表格快捷键，一次 toast + 一条 warn 级 `editor.large_document.source_tables_withheld`。按计划修正 A1，App 在 Source 下**每份文档每会话只判一次**（`src/utils/sourceTableVerdict.ts`，裁定存 `editorStore.sourceTableVerdicts`），与 ADR-0022 Consequences「Source 打开路径上一趟」一致 —— 计划风险项「每次按键都扫一遍」由 A1 **解决**，不是接受。WYSIWYG 分支一个字节未动。门禁：全套单测 2232 通过 / 0 失败，两套 tsc 配置通过，`pnpm build` 通过；真机 MQ-1..MQ-4 **2026-09-22 已在 `c9a1698` release bundle 上执行、四项通过**（`docs/test/20260922-adr0022-mq.md`；WYSIWYG 入口双提示目测 NOT VERIFIED——单槽 3 s 提示无法截屏采样，日志两行齐全）。上一句「Source 面依旧没有护栏判据」自`aac8097`起过期（保留原文作历史）。**状态仍为「已豁免（仅入口）」、不改 ✅**：D6 的结案系在 3.8 逐面出口复测上，本次只补上 ⌃2 缺判据的那半，3.8 未做、MQ 未跑 |
| **D7** | MUST | **已修复** | Rust 侧 logger 缓存 fail-open：`src-tauri/src/services/logger.rs` 的 `.unwrap_or_default()` —— 读取日志设置失败时回落到默认值（`enabled: true`）而不是关闭。**D2 只修了前端那一半** | [ADR-0005](../adr/0005-lock-span-invariant-is-review-enforced.md) 第 108–111 行把它点名为「a separate defect with no ADR of its own yet」，`CHANGELOG.md` 也已披露 —— 但此前**没有编号、不在任何表里**。**记录只点了一处，实际是两处**：除 `.unwrap_or_default()` 外，`get_log_settings` 在互斥量中毒时同样回落到 `LogSettings::default()`，是同一个 fail-open 换一个触发条件；只修点名的那一处会把缺陷类留着。中毒那一处按「取回锁内的值」修（`PoisonError::into_inner`），不是换一个回落值 —— 锁中毒不构成丢弃用户设置的理由。回归测试 R1（fail-closed）、R6/R7（中毒）；R2/R3/R8 在旧代码下即为绿，故不编码修复。修复提交 `0ae5797` |
| **D8** | SHOULD | ✅ **已修复**（仅文档；孤儿文件按约定保留） | MCP 端口/令牌路径的文档失实 + 本机孤儿文件：`src-tauri/src/bin/mdpro_mcp.rs:9` 写「reads ~/.mdpro/server.port and ~/.mdpro/server.token」，实际代码走平台数据目录 `dirs::data_dir()/mdpro/`（macOS：`~/Library/Application Support/mdpro/`） | **修复（2026-09-22，仅文档，无行为变化，本提交）**：已核代码——读取方 `mdpro_mcp.rs:36-40` `ServerConfig::load()` 与写入方 `http_server.rs:42-44` `config_dir()` 均为 `dirs::data_dir().join("mdpro")`；写于 `:136`/`:141`、清理于 `:165-166`（下方 D8 条目里的 `:85`/`:90`/`:114-115` 已过期）。改正位置（每处写明数据目录与 macOS 具体路径）：`src-tauri/src/bin/mdpro_mcp.rs:9-11`（`//!`）；`specs/007-mcp-server/` 下 `contracts/http-api.yaml`、`quickstart.md`、`tasks.md`、`research.md`、`data-model.md`、`plan.md`、`spec.md`；`.claude/skills/mcp-dev/SKILL.md`（配置块、Rust 示例、curl 示例）；`.codex/skills/mdpro-dev/references/mcp.md`（配置块、curl 示例）；`CHANGELOG.md` 两条旧条目原地更正并加 `[Unreleased] ### Fixed` 条目（下方记的 `:66`/`:210` 已过期）。**记录只点名一处，实际分布在 11 个文件**；两份 skill 文档的 curl 配方最危险——孤儿文件还在，照旧文档会读到 3 月的旧 token 而不是报「找不到文件」（推断，未实测）。验证：对 `src-tauri/src CHANGELOG.md specs docs/guide README* .claude/skills .codex` grep `.mdpro/server`，除 CHANGELOG 两条 *Corrected* 注记外 0 命中；`cargo check` 通过。⚠️ 孤儿文件**只登记，不删除**：`~/.mdpro/server.port`（5 B）与 `~/.mdpro/server.token`（64 B，mode 600），均为 3 月 31 日，仍在原处 |
| **D9** | BLOCK | ✅ **已修复并验证**（残留一项见右） | 源码模式表格识别**宽于 GFM**，三种形态被当成表格：① 单列表头 + `---`（GFM 判为 setext 二级标题）；② 分隔行缩进 ≥4 列；③ 分隔行**或表头行**以 Tab 开头（`countLeadingSpaces` 只数 U+0020，Tab 整个逃过 `MAX_INDENT`）。后果是**静默数据丢失**：幻影表格占据 `tableIndex 0`，外部 MCP 客户端调 `delete_row(0,0)` 删掉的是标题而不是表格行 | 三个 ADR：[0007](../adr/0007-table-scanner-emits-non-overlapping-models.md)、[0008](../adr/0008-non-candidate-delimiter-class-measured-against-gfm.md)、[0009](../adr/0009-narrow-source-table-detection-to-gfm.md)；计划 [`20260917-plan-table-over-detection-vs-gfm.md`](./20260917-plan-table-over-detection-vs-gfm.md)。实测复现与修后语料对照见 ADR-0009。**残留**：Rust 侧 `http_server.rs:834` 仍在应用之前就回 `202`，被拒绝或不存在的 `tableIndex` 依旧向客户端报成功，唯一痕迹是 `~/.mdpro/mdpro.log` 里一行 `ui.table.write_refused`；残留项设计草案见 [ADR-0024](../adr/0024-mcp-table-actions-report-their-outcome-by-ack-round-trip.md)（**Accepted** 2026-09-22：采纳 ack 往返，附修订 A–E——持久化同步后才回 applied、拒绝与部分应用分开、有界结果保留 + 状态查询、ack 归属/生命周期、request_id 幂等键；未实现，待立 WI）；行号订正：`dispatch_table_action` `http_server.rs:787`，202 在 `:874`（原记 `:834` 已过期）；草案顺带发现：表格路径缺 #238 式的确认框后复查（确认框期间文档关闭仍 emit 并回 202），已并入 ADR-0024 Decision 1，随同一 WI 实现 |
| **D10** | BLOCK | ✅ **已修复** | MCP 文档偏移量的**单位从未真正定下来**，三个子缺陷同源：**(a)** `new_cursor = insert_offset + text.len()` —— 字节 + 字节，却当作字符偏移发布；**(b)** Rust 按 Unicode 标量索引（`char_indices().nth`）、前端按 UTF-16 码元索引（JS 字符串 / CodeMirror 位置），**遇到星平面字符两侧把同一段文字插到不同位置**，影子存储与编辑器真的分叉，不只是回报的数字不对；**(c)** `useMcpSync.ts` 的 `getCursorPosition()` 硬编码 `return 0`，所以 `InsertPosition::Cursor` 在 Rust 侧永远解析成文档开头 | 根因是**规格自相矛盾**，不是编码疏忽：`specs/007-mcp-server/data-model.md:27` 说 cursor 是「character offset from start」，十七行之后 `:44` 又把合法性写成 `≤ content.len()`（Rust 里是**字节**），两边各自挑了一个合理的单位、挑得不一样。决策记入 [ADR-0021](../adr/0021-mcp-document-offsets-are-utf16-code-units.md)（Accepted 2026-09-22）：**统一为 UTF-16 码元**，由 Rust 侧转换。修复提交 `b891842`（ADR + Rust + 前端 + 规格更正 + 台账同一提交）。详见下方 D10 条目 |
| **D11** | MUST | ✅ **已修复** | 源码模式光标路径**每动一次光标就把整张表复制一遍**。`parseTableAtLine` 结尾是急求值的 `raw: src.slice(start, end)`；而 `sourceTableDetection.ts` 的 `tableContextField` 在 `docChanged \|\| selection` 时重跑——即每次按键、每次点击、每次方向键——却从不读 `.raw`。整篇一张表的文档（语料 `large-table.source.md`，约 25 万行 / 9.96 MB）因此每次光标移动付一次全文档拷贝 | 从目标条 3「D6 剩下的窟窿按面收，尤其是 Source 模式那一面」的成本面盘查中查出。**不是新引入的**：Phase 4 WI-3B 把扫描改成走 rope 时漏了 `raw` 这一个字段。修复提交 `11b7dab`（parse.ts + 两个测试文件 + 计划 + 台账 + CHANGELOG 同一提交）；顺带查出的账簿渲染截断由 `3825663` 立闸。详见下方 D11 条目 |
| **D12** | MUST | 🔎 **已定位并实测，未修**；50 000 行以上**已由护栏限损**（`aac8097`；真机 MQ-1..MQ-4 2026-09-22 在 release bundle 上通过，见 `docs/test/20260922-adr0022-mq.md`，WYSIWYG 入口的「恰好 2 个提示」未能目测） | 源码模式光标路径**每动一次光标就分配一整张表的对象图**。D11 只摘掉了字符串拷贝，对象图从来不是同一个缺陷，它还在。实测（2026-09-22，Node，每档独立进程、`--expose-gc`，合成 9 785 220 字符 / 232 981 行的四列表格文档）：一次 `parseTableAtOffset` 返回 `cells.length` = **931 924**，**解析本身**保留 **120 458 072 B**；而 `computeContext` 每个事务都重建一次行源，所以**一次光标移动的真实代价是 `linesFromText` + 解析 = 139 037 640 B**。（本行最初写的「堆增量 148.1 MB」把行源构造算进了解析头上，高估约 23%，2026-09-22 已更正。）密度扫描显示 1 000 行以上**严格线性**：129 ± 1 B/单元格、517 ± 4 B/行，5 000 行以上各点与最大点相差不到 1%——**这条曲线没有拐点，所以它给的是兑换率，不是阈值**。`sourceTableDetection.ts:63-77` 的 `tableContextField` 在每个 `docChanged \|\| selection` 事务上重跑它 —— 即每次击键、点击、方向键。**且这块内存不是白分配的**：`find.ts:19` 的 `findCell` 对 `model.cells` 做线性扫描，由 `sourceTableCellHighlight.ts:48-50` 在每次光标移动时调用，所以数组是被**消费**的，不能像 D11 那样改成惰性了事。真正的修法是让单元格查找只解析光标所在的那一行，而这会改动 `find.ts` / `sourceTableTabNav` / `sourceTableContextMenu` / `cursorSync/table` 共同依赖的 `TableModel` 契约 —— 属于设计决定，不是补丁。**故本行只登记，不在本批修复。** [ADR-0022](../adr/0022-source-mode-gets-its-own-guard-keyed-on-table-row-density.md) 把它记为「护栏能限制损害范围，但修不好它」。**2026-09-22：ADR-0022 四项决议全部 Accepted**，Decision 3 阈值定为 **50 000 表格行**（`2ec1321`；维护者从 2 万 / 5 万 / 10 万三档中选定，明记为政策判断而非测量值——曲线线性无拐点）。**护栏本身尚未实现**，Source 模式仍然不判、不降级、不记日志；它只约束本缺陷的损害范围，不是 D12 的修复。**2026-09-22 续记（`aac8097`）：护栏已实现**，上一句「尚未实现」自此过期（保留原文）。表格行起始数 > 50 000 的文档在 Source 下卸掉四个表格扩展（识别、Tab 键位、单元格高亮、列数检查器），所以 `tableContextField` 与 `findCell` 在这类文档上不再每次光标移动重跑；**50 000 行及以下一切照旧**，每次光标移动的对象图代价原样还在（上限约 30.0 MB/次）。另有已接受的限制：挂载时、裁定落地前仍做一次表格解析；裁定按会话粘住；围栏代码块里以 `\|` 开头的行也计入（高估）。**状态不改 ✅**：护栏只限损、不修代价（ADR-0022 原话），真机 MQ-1..MQ-4 已通过（见上），但护栏不是修复，故沿用 🔎 并明写限损。 | 证据是计数与堆字节，不是毫秒（E39/G0）。复现：见 ADR-0022 Context 第 2 条。 |
| **D13** | SHOULD | ✅ **已修复** | **D11 把 `TableModel.raw` 改成惰性，但列数检查器把它强制求值了，所以 lint 这条路径一分钱没省。**`src/plugins/codemirror/lintTableColumnCount.ts:67` 读 `table.raw`；在「整篇就是一张表」的文档上，这一次 `slice()` 拷贝**整篇 9 785 219 个字符**，再 `.split("\n")` 成 232 982 个字符串，发生在挂载后 750 ms 的 lint 定时器上。**修法**：lint 改为经 `TableLineSource.line(i)` 逐行走表，不再读 `raw`；**不改 `TableModel` 契约**——逐行走表只需 `start` 与 `rowCount`。**`line()` 预算顺带订正**：修前 2R + 5 全部花在 `scanTables` 内（旧循环读 `raw`，零次 `line()`），只改 lint 会变成 **3R + 5**（R = 100 实测 305）；`src/utils/tableParser/parse.ts#parseTableAtLine` 原先对每个表体行取两次，现改为下行时即留存，`scanTables` 降到 R + 5，总数回到 **2R + 5**（100 / 2 000 / 232 981 行实测 205 / 4 005 / 465 967，与修前逐一相等），`slice()` 由 1 降到 **0**，`.raw` 读取 0 次。 | 回归测试 `tests/lint-table-column-count-no-raw.test.ts`：计数代理包真实行源，断言 slice 0 次、`raw` 读取 0 次、rope 上 `sliceString` / `toString` 0 次，在 `44607d8` 上前两条红（实得 1）；`line()` ≤ 2R + 5 在两档规模上断言。输出等价：`tests/support/legacyLintColumnCount.ts` 是修前 lint 循环的冻结副本，16 份语料（含 CRLF、EOF 无换行、仅表头、转义竖线、CJK/星平面）× 两种行源 + 200 份种子语料逐条 deep-equal；CRLF 下 `to` 覆盖行尾 `\r` 的旧行为原样保留。修复于本提交（2026-09-22）。**未动**：`src/utils/tableWriteGuard.ts:104` 仍在每次 MCP 表格写入前读一次 `raw`（每次写入一次，不在定时器上）。证据是调用计数，不是毫秒（E39/G0）。 |
| **D14** | MUST | ✅ **已修复并验证**（`00842dd`；真机 G1/G2/G3/G5 通过，G4 仅以源码替代路径验证，见右） | **WYSIWYG 大纲高亮不跟随滚动**：冷启动打开、不切模式，滚动 WYSIWYG，大纲高亮停在原处。带 frontmatter 时日志另有一行 `ui.toc.resolve.mismatch` `{entryCount: 10, domCount: 11, resolvedCount: 10}`——frontmatter 在 WYSIWYG 里渲染成水平线 + 一行标题级元素，大纲解析不计它；但**不带 frontmatter 同样复现**，所以 mismatch 不是全部原因 | 发现于 WI-8 GUI 验收（`docs/test/20260922-wi8-gui-acceptance.md`，2026-09-22），**在 `44607d8` 对照 bundle 上同样复现，早于 WI-8**。与 3.6 的「2026-09-20 真机 bundle scroll-spy 全部判据通过」相矛盾：要么 3.6 之后回归，要么当日判据没覆盖这个路径——**未查**。候选（未验证）：`src/hooks/useWysiwygScrollSpy.ts` 的观察器 `root` 是 `#container`、`rootMargin: "0px 0px -66% 0px"`，而 WYSIWYG 的滚动容器是 `div.milkdown`。它挡住了 WI-8 判据 I（恢复后大纲高亮）的判定。**2026-09-22 定位并修复（`00842dd`）**：上面那条候选（`root` 不是滚动容器 / `rootMargin` 百分比）**被否掉**——祖先根照样收到嵌套滚动的相交变化，WebKit `IntersectionObserver.cpp` 按根高度解析上下边距，默认窗口判定带约 260px。真因是时序：`useWysiwygScrollSpy` 在 Milkdown 异步建好 `.ProseMirror` 之前就装了观察器，观察零个标题，之后只有 `entries` 变化才重装，切模式时 `entries` 不变，于是一直死着；日志 22 条 `ui.toc.resolve.mismatch` 里 20 条 `domCount:0`，都与 `editor.milkdown.mount` 同毫秒。修法：容器上的 MutationObserver 在标题元素列表变了时重装（`src/utils/tocSurfaceWatch.ts`），同时覆盖 Milkdown 替换标题节点后挂在旧节点上的情形。`tests/use-wysiwyg-scroll-spy-late-surface.test.ts` T1–T8，红收据 `D14` 分离成立。**真机验收 2026-09-22**（release bundle `ee3c5407…`，`docs/test/20260922-d14-gui-acceptance.md`）：冷启动、⌃2→⌃4、切标签、1200×800 与 1512×643 两种宽高比都跟随，`rootMargin` 宽度假说在真 WebKit 上也被排除；每次挂载至多一条 `domCount:0` mismatch、冷启动 0 条。G4（在 WYSIWYG 里改标题）因 **D15** 无法按原样验，改在源码里改标题再 ⌃4，高亮落到改后的那条。WI-8 判据 I 复测为**条件性失败**，另立 **D17**。**另记两条，不属 D14**：①长节内上滚、标题在判定带上方时高亮保留成下一条（带状判定的固有局限，源码按锚点采样没有这个问题）（2026-09-22 随 D17 修复：WYSIWYG 改为与源码同一锚点的几何判定，见 D17 行）；② 2 条 `domCount:11 / entryCount:10` 是 frontmatter 被 Milkdown 渲染成标题级元素的真实错配 |
| **D15** | BLOCK | ✅ **已修复**（本提交；jsdom 回归已验证；真机 GUI 验收 6/6 PASS，`tauri-app` a1fc155f…，合成输入 + ABC，见 [20260922-d15-gui-acceptance.md](../test/20260922-d15-gui-acceptance.md)；实体键盘、WeType、浅色主题未测） | **WYSIWYG 里打的字显示了，却不进文档**：4 s 后仍无脏标记，⌃2 源码里没有，⌘S 写出的文件也没有（只进了一个孤立的 `\xa0` 空格）；日志里没有任何内容或文件事件 | 发现于 D14 真机验收（`docs/test/20260922-d14-gui-acceptance.md`），`00842dd` 与对照 `c9a1698` 都复现，早于 WI-8 / D14。**输入全部是 computer-use 合成 CGEvent**；「WeType 拼音组合态未提交」的解释已被切到 ABC 后的复测**否掉**。**未用实体键盘复现**；2026-09-20 日志里有一次 WYSIWYG 编辑正常进了 store（`contentLength` 5254→5255）。读代码未发现丢弃 `markdownUpdated` 的守卫（`MilkdownEditor.tsx:184-216`，`documentStore.ts:66-71`）；**没有测试钉住 Milkdown 事务 → `markdownUpdated` → `documentStore` 这条链**。下一步：人用实体键盘在 WYSIWYG 打字后 ⌃2 看一眼——这一眼决定它是 BLOCK 还是测试工具假象。**2026-09-22 定位并修复（本提交）**：Codex 按复现指南复现（`docs/test/20260922-d15-d17-repro-result.md`），随后在 jsdom 里用真实 `MilkdownEditor` 复现，**不依赖合成输入**，故 BLOCK 确认、「测试工具假象」排除。上面「读代码未发现丢弃守卫」一句**是错的**：丢弃不在守卫里，在注册的生命周期里。`MilkdownEditor.tsx` 的 listener 注册 effect 依赖 `[editor, activeDocumentId]`，而 `useEditor` 每次渲染都返回新的包装对象，所以**第一次重渲染**就跑 cleanup 把回调置为 disposed，`registeredInstanceRef` 又挡住重新注册；打开文档约 300 ms 后 `useTOC` 的 `setEntries` 必然触发一次 App 重渲染，此后所有编辑都被丢弃。2026-09-20 那次正常进 store 的编辑，推断是落在这次重渲染之前（未核实）。另两处加重因素：`@milkdown/plugin-listener` 跳过 `addToHistory === false` 的事务，且每个事务新建的 200 ms 防抖在销毁时从不取消（即 D18）。**修法**：删掉 effect 与 listener 插件，改为应用自有的 ProseMirror 插件（`src/plugins/milkdown/editSync/plugin.ts` + `controller.ts`），在编辑器构建时绑定所属文档 id；有文档变化的事务立即标脏，单个可取消的 200 ms 序列化定时器合并写入，修订号保证旧写入不覆盖新 flush；`milkdownEditorStore.flushPendingEdits` 在保存 / 另存、离开 WYSIWYG、切标签、关标签、关窗口前同步 flush，flush 失败则保存中止并报错、不写旧内容。**顺带**：关窗口的未保存判定从「只看活动文档」改为**所有打开的文档**。测试：`tests/milkdown-edit-sync-controller.test.ts`（21）、`tests/wysiwyg-edit-persistence.test.tsx`（16，真实 MilkdownEditor + 真实 useTOC）、`tests/wysiwyg-flush-sites.test.tsx`（11）、`tests/flush-call-sites.test.ts`、`tests/data-loss-logic.test.ts` 增 3 例；W5 分类站点 15→16（新增 WYSIWYG 序列化写入，`ordinary`）。红收据 `D15-WI-2`、`D15-WI-3` 分离成立；`D15-WI-1` 唯一发现是被一并指纹的 D17 诊断文件移出了 `tests/`（WI-1 自身规格未改）。**终审补修（同一提交）**：① 同 id 整体替换后 WYSIWYG 编辑器不重建、仍显示旧内容，而新控制器会在下一次击键时把旧内容写回——D15 之前 listener 已死所以不写，**这是修复本身引入的丢数据路径**；改为 `milkdownEditorStore.reloadEditor` 按文档记代数、编辑器以 `id#代数` 为 key 重建，旧控制器 `discard()` 不写直接作废。接入重新加载（文件监视）、⌘O / 对话框 / 换编码重开同一文件、草稿恢复、MCP `write_document`（后者在 WYSIWYG 下此前只打到为 null 的 CodeMirror，同样会被写回覆盖），入口统一为 `src/utils/wholesaleReplace.ts`；② flush 失败在关标签 / 关窗口时按「有未保存改动」处理（此前被忽略）；③ 删掉只被测试调用的 `resolve*` 组合函数，原 G3 用例随之删除并在新文件按 App 的实际组合重写，**其中「干净文档 flush 失败 → 直接关」几行被有意改为「提示」**。回归：`tests/d15-review-followups.test.tsx`（9）、`tests/d15-close-guards.test.ts`（7）、`tests/d15-reopen-in-place.test.tsx`（5），红收据 `D15-WI-5`、`D15-WI-6` 分离成立。**未做**：真机复测（实体键盘 + 合成输入各一次）；⌘Q 仍绕过未保存提示（D16，未动） |
| **D16** | BLOCK | 🔄 **已修，待真机验收**（[ADR-0025](../adr/0025-app-quit-is-deferred-through-a-native-terminate-hook.md)，2026-09-23 Accepted） | **有未保存改动时经 AppleScript 退出，没有未保存提示**：文档是脏的（源码里改过标题），`quit` 直接退出，未写文件，日志也没有 `app.quit` | 发现于 D14 真机验收，同上记录。**2026-09-22 spike 查明**（一次性 worktree，`[SPIKE-d16]` 原型，4 次真机埋点运行）：⌘Q、菜单 Quit、Dock quit、AppleScript `quit` 全都走 AppKit `-[NSApplication terminate:]`，而 tao 0.34.5 的 `TaoAppDelegateParent` 没实现 `applicationShouldTerminate:`，于是直奔 `applicationWillTerminate:`——`RunEvent::ExitRequested` 从不触发，窗口的 `onCloseRequested`（D15 全文档检查的唯一入口）也不触发，脏文档被静默丢弃；`main.rs` 挂在 `ExitRequested` 下的 `app.quit` 日志、MCP 关闭与 `cleanup_server_config` 同样全被跳过，所以每次退出都留下过期的 `server.port` / `server.token`。原记「AppleScript 走的可能是另一条路径」**已推翻**：四条路一条路。定案见 ADR-0025（运行时给 delegate 类补 `applicationShouldTerminate:`，返回 `NSTerminateLater`，两阶段协调器，清理移到 `RunEvent::Exit`），其代价与未覆盖项（多窗口、系统注销期限、实体 ⌘Q）是实现工作的验收项。**2026-09-23 修正定案**：[ADR-0027](../adr/0027-a-quit-ack-timeout-draws-a-native-alert.md) 取代 ADR-0025 §3——原本「窗口 2 秒内不应答即当作 cancel」会让 app 在本项目实测的 7.4 s / 12.0 s / 259 s 主线程卡顿期间静默拒绝退出，且因为卡住的正是 webview，一个对话框都画不出来；而 WKWebView 的 WebContent 是独立进程，macOS 根本不会把 mdpro 标成「无响应」，用户拿不到系统的强制退出提示，只剩 ⌥⌘⎋。现在超时改为由 Rust 主线程弹原生 NSAlert（Keep Open / Quit Without Saving），且该请求归 fallback 独占——恢复过来的 webview 迟到的应答一律忽略。**实施进度（走 tdd-guardian，plan `plan-20260922-213257-d16.md` Rev 3）**：WI-1 ✅ 已完成——退出清理搬到 `RunEvent::Exit`（`src-tauri/src/services/app_exit.rs`，5 例单测，含「只删 `server.port`/`server.token`、草稿与同目录其它文件逐字节不变」），`server.port`/`server.token` 不再每次退出都残留；真机端到端（G1）未跑。WI-2 ✅ 已完成——纯协调器状态机（`src-tauri/src/services/quit_guard/coordinator.rs` + `types.rs`，无 `AppHandle`、无 objc、无时钟，时间由入参传入），38 例单测分 6 个同级规格文件，含一条穷举性质（8019 组合）；红收据分离成立。**验收判据修正**：Rev 3 里「`QuitAnyway` 在另一窗口已 `discard(["x1"])` 之后仍提交空 id 集」这一形状**按构造不可达**——`discard` 只从 `Prompted` 窗口收，而窗口只在一阶段全部应答后才被 prompt，此时没有窗口还是 `Pending`，`on_tick` 再也超不了时；改由 `f3b` 用同一协调器**上一个请求**里已接受的 `discard` 来钉同一条守恒声明（更强：`discard_document_ids` 挂在 `Request` 上且提交时 `mem::take`）。**另修一处代理未发现的缺陷**：`begin()` 原先把「窗口列表为空 → `TerminateNow`」判在「已有请求 → `AlreadyPending`」之前，而 fallback 独占的请求会拒掉 `on_window_gone`，于是「窗口全没了但原生对话框还挂着」时第二次 terminate 会绕过没人应答的对话框直接退出，违反 ADR-0025 §2；两者顺序对调，回归 `c17`/`c18`，红收据 `WI-2b` 分离成立。WI-5 ✅ 已完成（`0f7d5f3`，**本行补记，非当次提交**）——关窗口、⌘Q、更新重启三条退出路收敛到 `src/utils/dataLossGuards.ts` 一条未保存判定规则。WI-8 ✅ 已完成（`166c76d`，**本行补记，非当次提交**）——`prepareForRelaunch` 先 `assessWindowUnsaved("relaunch")` flush 再读 store，未命名文档在任何写入之前就拦下重启，任一保存失败即停；3 例新单测（含 240 组合穷举），既有 6 例逐字节未动。WI-6 ✅ 已完成——OS 关窗监听搬进 `src/hooks/useWindowCloseGuard.ts`（185 行），用 `cancelled` 标志修掉「订阅在卸载后才 resolve 就漏一个 handler」，effect 依赖改为稳定的 `useCallback(…, [])`，因此**每个窗口只订阅一次**（此前每次编辑都多挂一个，连打十个字会弹十次确认）；`App.tsx` 1236 → 1142 行；10 例新单测，红收据分离成立，全量 2754 例 0 失败（已独立复跑）。**判据偏差已核**：`tests/data-loss-logic.test.ts` 两条源码文本断言被改写——`decideWindowClose(` → `windowCloseDecisionAfterFlush(`、`hasUnsavedChanges: hasUnsavedChangesAfterFlush()` → `windowCloseDecisionAfterFlush({ allowWindowClose:`。读代码确认 `windowCloseDecisionAfterFlush` 本身就是 `assessWindowUnsaved("window-close")` 后再判定，所以新断言钉的是同一条「按 flush 后的全文档状态判定、绝不按 render 状态」性质，且多钉了 latch 入参；D15 的回归钉子没有被悄悄退休。WI-3 ✅ 已完成——驱动层 `src-tauri/src/services/quit_guard/driver.rs`（`plan()` 每次输入只取一次锁，`run()` 在无锁状态下执行副作用）、`quit_guard_reply` IPC 命令、`WindowEvent::Destroyed` 路由与草稿写入闸门；18 例单测（含 112 组枚举场景），`cargo test` 342 通过 0 失败（**我已用重定向 `$HOME` 独立复跑**，避免测试日志污染真机验收的字节窗口）。**已核的三条安全性质**：窗口标签取自 `window.label()` 而非 payload（渲染进程无法替别的窗口丢弃草稿）；`validate_discard_ids` 只允许 `discard` 带 id、上限 64、一个非法 id 拒掉整张表而不是删一半；提交顺序是**先置 flag、再删草稿、最后回复**，自动保存无法在删除与退出之间把草稿复活。日志只记数量，不记 id 也不记正文。**分离收据判为 SEPARATION-BROKEN**：代理在记录红灯之后跑了 `cargo fmt`，rustfmt 的换行重排被逐行指纹读成删除。我另行核对：红灯输出里点名的每一条断言现在都还在（`reply_tests.rs:42` 的那条只是我先前按渲染后的消息去 grep 才看似缺失，`draft_gate_tests.rs` 的 g3 是 `#[tokio::test]` 所以不计入 `#[test]`），rustfmt 也不会删断言——**判定为格式化产物，不是规格被改写**，但收据无法为这一点背书，如实记录。**已采纳代理的一处偏离**：计划第 255 行仍写着超时后 `EmitAll(Cancelled)` + `Reply(false)`，这早于 Rev 3，与本计划第 98 行及已提交的 WI-2 协调器（`on_tick` 返回 `NativeFallback`）矛盾；按 CLAUDE.md「ADR 与计划冲突时 ADR 为准、计划改正」，改的是计划不是代码。`TauriQuitEffects` 的 `reply` / `native_fallback` 目前是空实现，原生钩子与 NSAlert 属 WI-4，所以**本次提交之后 ⌘Q 行为一个字节都没变**，账本该行状态记为 `Stub`。**驱动层与原生钩子（WI-3/WI-4 起）仍未接，脏文档退出仍被静默丢弃**。**WI-4（本行所在提交）**：`applicationShouldTerminate:` 已用 `class_addMethod` 加到**运行中**的 tao 委托类上，IMP 返回 `ns_reply_for(begin(...))`；只有 host 槽为空（按构造不可达）才 fail-open 成 `NSTerminateNow`——ADR-0025 的取舍是「可退出」好过「挂死在没人应答的 Later 上」。`reply` / `native_fallback` 不再是空实现。**objc2 前提仍成立**：没加任何新 crate，`Cargo.lock` 里 `objc2` / `objc2-app-kit` / `objc2-foundation` 各仍只有一份。Rust 371 通过、0 失败，`cargo fmt --check` 干净。**代理报告 clippy 无警告，我复跑发现有一条**：`macos.rs` 从 `super` 导入了 `NS_TERMINATE_LATER` 却没用（该常量实际由 `mod.rs:54` 的 `ns_reply_for` 使用），已由我删掉死导入并复跑至 clippy 干净——行为无变化，但「代理报告的门禁结果」这次确实不准。**如实记录三点减分项**：(1) WI4-M4 在红灯阶段就是通过的——故意写错的桩无条件返回 `NoDelegate`，恰好就是该用例所断言的，它现在测的是真代码，但从未失败过，证明力弱于其余十二条；(2) 测试矩阵早于 ADR-0027，没有任何 Rev 3 用例，回退映射的测试是照计划 Rev 3 验收条款写的；(3) `macos_tests.rs` 352 行，超出规则 50 §6 的 300 行，当时拆分会改动绿灯收据记录过的文件，留作后续。**一处与 ADR-0027 文本的偏离需真机确认**：Escape 在该警告框上不做任何事——AppKit 只会把 Escape 绑给标题字面为 "Cancel" 的按钮，而 Keep Open 必须占 Return 默认位，丢弃按钮的 key equivalent 已显式清空；方向是安全的（误触不会丢数据），但与 ADR「同一个按钮既是 Return 默认又是 Escape 动作」的写法不符。**日志污染，须传给真机验收**：WI-4 的红灯收据运行时 `receipt.js record` 自己跑了一次 `cargo test` 且忽略了 `HOME` 重定向，向 `~/.mdpro/mdpro.log` 追加了约 172 KB 的 `app.quit.*` 测试行，**污染区间 4,604,300 → 4,776,573 字节，真机验收须排除该区间**；此后每次收据调用都自带 `HOME`，我自己的三次复跑日志增量均为 0。收据判为 specification held，另有一条 MEDIUM：记录红灯时已有 27 个非测试文件处于已修改状态（经核对均为本次之前就存在的工作区变动与并行 WI-7 代理的 `src/` 文件，无一是退出守卫的实现代码）。**六项只能真机确认**：真实委托类解析到 tao 的 `TaoAppDelegateParent` 且安装 `outcome: "added"`（G15）、`replyToApplicationShouldTerminate:` 真能解掉挂起的 `NSTerminateLater`（G2/G13）、提示前的 app/窗口激活、NSAlert 本身（是否弹出、措辞、按钮顺序、`runModal` 的嵌套 run loop 不与驱动死锁）、ADR-0027 全序列对**打包后 `.app`** 的验证、以及 `WindowEvent::CloseRequested` 路由（G20）。**WI-7（本行所在提交）**：webview 应答方接上了。`useQuitGuard.ts` 用 WI-6 的 `cancelled` 旗标 + disposer 模式**只订阅一次** `app:quit-requested` / `app:quit-prompt` / `app:quit-cancelled`——三个 handler 的 `useCallback` 依赖链最终都落到 `[]`，我逐个核对过，effect 不会每次渲染重订阅（这正是 WI-6 修掉的那个缺陷）。脏判不另起一套：走 `assessWindowUnsaved`，它在 `dataLossGuards.ts:189-193` 对两个 store 都用 `.getState()` 取值并先 flush Milkdown 待提交编辑，所以读的是触发时的状态而非渲染时的闭包。已应答的 requestId 再收到 prompt 会被忽略，窗口不会重复应答。`quitDialogModel.ts` 是纯函数：退出提示优先于 ⌘W 的关窗提示。**跨语言契约我静态核对过，比代理报告的更强**：代理把「`QuitEventPayload` 是否真按 camelCase 序列化」列为只能真机确认，实际上 `effects.rs:33-35` 的 `#[serde(rename_all = "camelCase")]` 与 `useQuitGuard.ts:70` 读的 `payload.requestId` 两侧可直接对读，契约成立（真机仍是最终证据）。前端 2773 用例 2769 通过 0 失败（基线 2754 + 新增 19），`tsc --noEmit` 干净，账本门禁 169 行 / 227 处路径声明 / 0 findings / 97/97。收据判为 specification held，另有一条 MEDIUM：记录红灯时 26 个非测试文件已处于已修改状态——**其中两个是代理自己为了拿到「可计数的红」而写的签名桩** （`useQuitGuard.ts` / `quitDialogModel.ts`），如实记录；首次红灯记录曾判 `opaque-failure`（套件根本加载不了），加桩后重记才得到 `assertion-failure — 2773 中 17 个失败`。**本次提交后 ⌘Q 才第一次真的会提示**（WI-4 的原生钩子 + 本项的应答方合起来才闭环），但**真机验收仍未跑**，账本该行维持 `Partial`。 |
| **D17** | SHOULD | ✅ **已修复并验证**（本提交；jsdom 回归 + WI-7 真机验收 8/8 通过，[`docs/test/20260922-d17-gui-acceptance.md`](../test/20260922-d17-gui-acceptance.md)；验收中发现的两处早于 D17 的问题另立 D21、D22） | **切模式恢复滚动后，若落在一节中间，大纲高亮停在 H01**：真机 3/3；恢复后判定带里有标题时正确 | 发现于 D14 真机验收（WI-8 判据 I 的复测）。推断机制：spy 在新 Milkdown 视图 scrollTop 0 时装好，H01 相交成为活动项；WI-8 随后把视图恢复到节中间，H01 离开判定带、没有标题进来，「可见集为空时保留上一条」于是一直保着 H01。与「长节内上滚高亮停在下一条」是同一个带状判定的局限；修法候选：可见集为空时按几何回退到「判定带顶端之上最后一条标题」（与源码模式的锚点采样同义）。<br><br>**2026-09-22 修复（本提交，[ADR-0026](../adr/0026-wysiwyg-scroll-spy-is-geometric.md)，计划 `.claude/tdd-guardian/plan-20260922-210708.md`）**：**根因**是带状判定本身——`IntersectionObserver` 只报相交变化、不报位置，判定带（`rootMargin: "0px 0px -66% 0px"`）里没有标题时「保留上一条」一直保着旧键，**且没有任何几何回退**；上面的推断机制成立，「长节内上滚停在下一条」（D14 行另记 ①）是同一根因。**修法**不是补回退，而是整个换成几何判定：`src/hooks/useWysiwygScrollSpy.ts` 不再建 IO，改为容器上捕获阶段的被动 `scroll` 监听 + 原 MutationObserver 重装 + ResizeObserver，都只排一次 rAF 重算；每帧二分查找「顶端 ≤ 滚动面顶端 + `SPY_ANCHOR_OFFSET_PX`（40px）的最后一条标题」，与源码同一锚点；只在滚到底时保留（`isAtScrollLimit`，ADR-0017/0018 规则搬到 DOM）。纯逻辑 `src/utils/tocGeometrySpy.ts`，`findMilkdownScrollerIn` / `scrollHeadingToAnchor` 在 `src/utils/scrollAnchor/milkdown.ts`，D7 告警搬到 `src/utils/tocResolveMismatch.ts`，`pickActiveKey` 删除。**连带 WI-5**：WYSIWYG 点击跳转改为瞬间落到「标题顶端 − 40px」，否则平滑滚动的中间帧会把途经标题写成活动项、点末尾标题保不住（丢掉动画记为 ADR-0026 的代价）。**可见行为变化**：WYSIWYG 高亮换线从 33% 处改为 40px，与源码一致（原台账第四条限制随之消失）。测试：`tests/use-wysiwyg-scroll-spy-d17.test.ts`（D17 回归）、`toc-geometry-spy*.test.ts`、`is-at-scroll-limit.test.ts`、`milkdown-find-scroller.test.ts`、`use-wysiwyg-scroll-spy-{geometric,lifecycle,limit}.test.ts`、`use-toc-navigation-wysiwyg-landing.test.ts` 等；约 20 条既有用例按 ADR-0026 迁移（规格变更，非回归）。红收据 `D17-WI-1/2/3/5` 分离成立；`D17-WI-4` **分离失败**（`spec-changed-under-green`：`tests/use-toc-scroll-spy-identity.test.ts` 在红绿之间改了期望——即上述计划内迁移，理由见 ADR-0026，不是隐藏回归的改动）。**未做**：WI-7 真机验收（真实布局、真实 Milkdown 滚动面、与 `useMilkdownScrollRestore` 的配合）；jsdom 只有脚本化几何 |
| **D18** | MUST | ✅ **已修复**（随 D15，本提交；jsdom 回归已验证；真机 GUI 验收日志 0 条 `editorView not found`，见同一记录） | **打字后 200 ms 内切标签或切模式，那次编辑丢失，并记一条 `Context "editorView" not found`**：`@milkdown/plugin-listener` 每个事务新建一个 200 ms 防抖，编辑器销毁时从不取消；防抖到期时 ctx 已拆，`ctx.get(editorViewCtx)` 抛错，编辑没写回 | 发现于 D15 诊断（jsdom 用例 f）。并入 D15 同一修法：序列化器在视图初始化时取一次，销毁时只用已取的序列化器与视图状态同步 flush，不再 `ctx.get`；切标签 / 切模式前另有显式 flush。回归：`tests/wysiwyg-edit-persistence.test.tsx` P-f、P-unmount |
| **D19** | MUST | ✅ **已修复**（本提交；jsdom 回归通过；WI-6 真机验收 2026-09-23：判据 2/3/4/5 通过，判据 1 与 6a/6b NOT VERIFIED，见 [`docs/test/20260923-d19-gui-acceptance.md`](../test/20260923-d19-gui-acceptance.md)） | **保存进行中又有编辑写入 store，保存完成时把它覆盖回保存前的内容并标为干净**：`src/hooks/useDocument.ts` 的 `saveActiveDocument` / `saveActiveDocumentAs` 在 `await` 之后用 `await` 之前的快照 `upsertDocument({...doc, isModified: false})` | D15 终审发现（2026-09-22），**早于 D15**。原记「WYSIWYG 下被 edit-sync 控制器兜住：控制器发现 store 被改掉后，下一次 flush 把编辑写回并重新标脏」——**这句是错的**（保留原文）：WI-1 的 R-wysiwyg-timer 证明，200 ms 定时器**已经写进 store** 的编辑不会被下一次 flush 救回（`controller.ts` `write()` 在 `revision <= lastWrittenRevision` 时直接返回 clean，关标签前的 flush 之后仍是旧内容、干净），只有保存返回时**还挂在定时器里**的编辑会被救回（R-wysiwyg-pending）；所以 WYSIWYG 与源码模式、MCP 写入一样会丢。**顺带查出**：旧代码对保存中被关掉的文档照样 `upsertDocument`，把关掉的标签**复活**（R-closed）。<br><br>**2026-09-23 修复（本提交，计划 `.claude/tdd-guardian/plan-20260922-232521-d19.md`）**：纯函数 `src/utils/saveResult.ts#resolveSaveResult` 在 `await` 之后重读 store，按 `closed`（先判）/ `applied`（内容仍等于快照）/ `edited-during-save` 三分；`src/services/saveService.ts#applySaveResult` 同步落地，两条保存路径都走它。保存中被编辑：内容与脏标记原样保留，只更新 `path` / `lastSaved`，草稿保留；被关掉：什么都不写；`delete_draft` 只在 `applied` 时发。开了保存时自动重排：磁盘写重排后的快照，store 只在保存期间未被编辑时才换成它。回归：`tests/save-edited-during-await.test.tsx`、`tests/save-edited-during-await-wysiwyg.test.tsx`、`tests/save-result.test.ts`、`tests/apply-save-result.test.ts`、`tests/save-failure-paths-during-await.test.tsx`。**已接受的限制**：保存进行中把文档关掉、再按同一 id 从磁盘重开，且重开读到的内容与保存快照不同（如重开读盘早于 `save_file` 写盘），结果判为 `edited-during-save` 且不重新标脏——标签显示干净，而 store 与磁盘不一致，直到下一次编辑或保存（W2-reopened-clean；R-reopened-old 有意不断言 `isModified`）；重开内容与快照相同则按 `applied` 处理（R-reopened-same）。保存面板是模态时手工到不了，需要关闭、重开与慢 `save_file` 同时发生。**2026-09-23 WI-6 真机验收**（release bundle `d82c0aab…3492`，冷启动 PID 68055，证据是 `~/.mdpro/mdpro.log` 的字节窗口 + `od -c` 磁盘文件，[`docs/test/20260923-d19-gui-acceptance.md`](../test/20260923-d19-gui-acceptance.md)）：**判据 2 通过**，走的是**无对话框的 ⌘S 路径**——已有路径的文件上 ⌘S 后紧接着敲字，脏点保留、编辑器留住这个字、磁盘只有保存快照，日志恰好 1 条 `file.save {editedDuringSave:true}`，在 IPC 成功后 13 ms（WYSIWYG 未试在途编辑）；**判据 3**（第二次 ⌘S 不弹框、脏点清除）两模式通过；**判据 4**（`editedDuringSave:true` 恰 1 条、`closedDuringSave` 0 条、日志无文档内容）通过；**判据 5**（未命名文档另存为走 `applied`）两模式通过。**判据 1 NOT VERIFIED**：NSSavePanel 是 app 模态，点编辑器不换焦点、按键全进文件名框，两模式皆然，所以「面板开着时编辑落进编辑器」这一幕手工到不了；退路 MCP `write_document` 未做——本会话的权限层拒绝读 `~/.mdpro/server.token`，**未绕开，也不改由别的会话代读**，需用户批准后重跑。**判据 6a/6b NOT VERIFIED**：被一个早于 D19 的缺陷挡住（自动重排开关根本不生效），另立 **D23**；其中「编辑器留住编辑」那一半已随判据 2 通过，「磁盘是重排后的文本」那一半在 D23 修好前无从成立。**判据 7**（保存中关标签）未做：未命名文档面板模态，有标题文档的 `save_file` 只要 15–20 ms，手工插不进去；`closedDuringSave` 计数 0 与之一致。仅深色主题跑过 |
| **D20** | MUST | 🔬 **已定位并定案，未修**（[ADR-0028](../adr/0028-reopening-a-dirty-open-file-focuses-it-instead-of-reloading.md)，2026-09-23 Proposed） | **⌘O / 打开对话框 / 换编码重开一个已打开且有未保存改动的文件，改动被静默丢弃**：`openDocumentFromPath` 等按路径派生的同一 id `upsertDocument` 覆盖内容并清脏，不提示 | D15-WI-6 实现时发现（2026-09-22），**早于 D15**，源码模式同样存在。D15 之后编辑器会随之重建显示磁盘内容，所以丢失是确定的、可见的。修法是 App 层的产品决定：重开脏文档前提示「放弃改动并重新载入 / 保留」，或脏时只激活不重载。**2026-09-23 定案**（[ADR-0028](../adr/0028-reopening-a-dirty-open-file-focuses-it-instead-of-reloading.md)，Proposed，用户在 AskUserQuestion 里选的是「Focus tab；换编码时提示」）：①⌘O / 打开对话框 / Finder「打开方式」/ 单实例 file:open 遇到**脏**文档一律只切到那个标签，不重载、不提示；②换编码重开是唯一会提示的入口——重新解码正是这条命令的目的，静默不重载会显得命令坏了，所以给「放弃改动并重新载入 / 取消」两选一，不给「先保存」（那会先按旧编码写盘再读回，是另一件事）；③**干净**文档仍按现在重载（改动只按 `isModified` 分叉，保住「重开即刷新」，脏点就是用户能看见的区别）——这一条用户没明说，是我按最小改动定的，写进 ADR 待复核；④脏的判定必须**先 flush 再读 store**（走 D16 WI-5 的 `assessWindowUnsaved`），否则还在 200 ms edit-sync 定时器里的 WYSIWYG 编辑会被读成干净、照样丢——这正是本条要防的；flush 失败按脏处理；⑤判定读 `useDocumentStore.getState()`，不能用捕获值：读盘夹在用户手势和写入之间，是 D15/D19 同一类竞态。**未实现** |
| **D21** | SHOULD | 🔎 **已定位（读代码），未修** | **每次 ⌃2→⌃4 都记一条假的 `ui.toc.resolve.mismatch` 警告**：`src/hooks/useWysiwygScrollSpy.ts` 的首轮 `arm(false)` 在 `@milkdown/react` 建出 `.ProseMirror` 之前运行，按 `domCount: 0` 上报；随后 MutationObserver 重新 arm 解析出全部标题，高亮本身正确 | D17-WI-7 真机验收发现（2026-09-22，repro-a，5 次切换 5 条警告，`{entryCount:13, domCount:0, resolvedCount:0}`）。**早于 D17**：HEAD 的 IO 实现同样在首轮上报，且 `tests/use-toc-navigation-identity-landing-guards.test.ts` N-3/N-5 钉住「无 `.ProseMirror` 时恰好一条」。代价是 D7 警告被噪声淹没。修法：首轮在 `.ProseMirror` 缺席时也不上报（与重新 arm 一致），并以陈述理由改写 N-3/N-5 |
| **D22** | SHOULD | 🔎 **已定位（读代码），未修** | **图片多的文档里，切到 WYSIWYG 后立刻点大纲，落点错位**：点 H05 落进 H02 一节，点 H09 看似无效；高亮与实际位置一致，错的是落点 | D17-WI-7 真机验收发现（2026-09-22，repro-img，复现 2/2）。**早于 D17（读代码推断，未在旧包实测）**：WebKit 不实现 CSS scroll anchoring（`overflow-anchor`），`useMilkdownImages` 在渲染后才把图片换成 `asset://`，点击时图片高度为 0——目标按短文档算（H09 被夹到滚动上限），图片随后在固定 `scrollTop` 下方撑开。`src/utils/scrollAnchor/milkdown.ts` 的点击跳转只写一次，无重钉；`useMilkdownScrollRestore` 的单次沉降重放只管模式切换的恢复锚，因此往返无点击也会偏高约一张图（同因）。旧实现 `scrollIntoView({behavior:"smooth"})` 同样只在开始时算一次目标。修法候选：点击与恢复共用「布局沉降期内把目标标题钉在锚线」的助手（`.ProseMirror` ResizeObserver / 图片 `load`，只在 `scrollTop` 仍是自己写的值时重钉，限时），需走 tdd-guardian，触及 WI-8 锚的恢复方式 |
| **D23** | MUST | 🔎 **已定位（真机 + 读代码），未修** | **「保存时自动重排表格」开关是死的**：⌘, → Markdown 勾上后，日志不记 `preferences.set`，`~/.mdpro/config.json` 的 `markdown` 仍是 `{"autoPair":true}`，换个窗口打开设置显示未勾；⌘S 后表格照旧不重排，也没有 `editor.table.auto-reformat-on-save` | D19-WI-6 真机验收发现（2026-09-23，[`docs/test/20260923-d19-gui-acceptance.md`](../test/20260923-d19-gui-acceptance.md)）。**早于 D19**。机制：`src-tauri/src/models/preferences.rs` 的 `MarkdownConfig` 只有 `auto_pair`，前端的 `autoReformatTablesOnSave` 过不了 `get_preferences` 的往返，于是 `src/hooks/useDocument.ts` 里 `prefs.markdown?.autoReformatTablesOnSave` 在 Tauri 应用里恒为假。**未查明**：勾选为什么连一条 `preferences.set` 都没留下——这可能是同一个缺陷的另一半，也可能是第二个缺陷，修之前要先弄清。修法：`MarkdownConfig` 补 `auto_reformat_tables_on_save`（serde 默认 false）+ 一条不打补丁就红的往返回归测试，然后回头补 D19 的判据 6a/6b。**它挡住的**：D19 判据 6a/6b |

**D1 · 记录点名一处，实测是三处，而且出数字的不是被点名的那处。**
门禁二记录只写了 `file.rs:1098`（open 路径）。实测「计时器起点在文件选择器**之前**」这一形态共三处：

- `src-tauri/src/commands/file.rs:1098`（`open_file_dialog`，选择器在 `:1108`）
- `src-tauri/src/commands/export.rs:49`（`export_html`，选择器在 `:63`）
- `src-tauri/src/commands/export.rs:147`（`export_rendered_html`，选择器在 `:163`）

记录里 72 745 ms 那个数字**来自导出路径，不是它点名的 open 路径**。按记录去修只会修掉三分之一，
而且修掉的恰好不是出数字的那一处 —— 这一点必须写出来，否则下一个人会以为改完 `:1098` 就结案。
**已核对并排除的第四处**：`file.rs:1170`（`save_file`）确有同一行 `let start = std::time::Instant::now();`，
但它**不跨越选择器** —— 保存对话框在 `save_file_dialog`（`:1290`）内，于 `:1306` 先关闭，再调用 `save_file`。
保存路径的计时本来就是对的，**不要顺手一起改**。

**修复记录（2026-09-22）。** 先补一件上面没说的事：**全仓对话框共六处，不是三处**。
`grep -rn 'rfd::' src-tauri/src/` 另外命中 `preferences.rs:84`（`pick_export_folder`）与
`http_server.rs:963`（`show_write_confirmation`，由三个 MCP 处理器经 `spawn_blocking` 调用）。
这两处**本来就没有缺陷** —— 它们根本不计时；`http_server.rs` 全文 `Instant::now()` 零命中，
所以连「调用方的计时器跨越被调用方的对话框」这种间接形态也不成立。因此「同一形态共三处」现在
是**扫遍六处之后的结论**，不再是抽查。

两种改法，按「选择器之前有没有真活」分：

- `open_file_dialog`：选择器之前只有一行 Start 日志，没有值得计量的工作，所以计时器直接移到
  选择器之后。取消分支的 `duration_ms` 改为 **`None`** —— 取消时程序什么也没做，写 `0`
  会和「测过、确实是 0 ms」无法区分。
- `export_html` / `export_rendered_html`：渲染与净化发生在选择器**之前**，天真地把
  `Instant::now()` 下移会把这段代价整个丢掉，而它恰恰是唯一值得测的数。改为
  `render_span = render_start.elapsed()`（在选择器打开前收口）+ 选择器关闭后的
  `write_start`，成功/失败分支报 `render_span + write_start.elapsed()`，
  取消分支报 `render_span`（渲染真的发生过，只是不再叠加人工停留）。

**回归测试是源码文本判据**，`src-tauri/tests/timer_excludes_dialog_dwell.rs`，4 例，RED 1 → GREEN 4。
选这个形式的理由写在文件头：三处都内联调用 `rfd`，单测根本进不去（会阻塞在真实窗口服务器上）；
把计时算术抽成可测函数，测到的是**算术**，而缺陷是**计时器相对于对话框的位置**，抽完照样看不见。
缺陷是位置性的，判据就得是位置性的 —— 与前端 `tests/large-document-guard-call-site.test.ts`
和 C8b' 阈值字面量判据同一个理由。不变量：**任何打开原生对话框的函数里，对话框之前开的计时器
必须在对话框之前关掉**，实现为对「函数起点到 `rfd::` 之间」这段文本数 `Instant::now()` 与
`.elapsed()` 的个数是否相等。T1 是回归例（旧代码下三处全红，且它是**独立重新发现**这三处的，
不是照着本行抄的清单）；T2 钉住扫描确实覆盖到六个对话框函数，防止扫描器悄悄匹配不到而让 T1 空过；
T3 钉住 `save_file` 被排除的**理由**（它被计时，但它不含 `rfd::`），这样谁要是把对话框挪进
`save_file`，失败的是测试而不是下一次门禁；T4 钉住 `http_server.rs` 无计时器，把上面那条间接
形态的前提显式化。

**未解决：** T1 看不见「调用方计时器跨越被调用方对话框」。今天不存在这种路径，T4 把这个前提钉住了；
真出现时是 T4 先红，届时要么扩 T1 去跟调用链，要么手工论证。

**D6 · 豁免只到入口；伴生形态刻意不给编号。**
[ADR-0004](../adr/0004-gate2-waiver-for-stage3-entry.md) Decision 第 2 条写明「**缺陷是被挂账，不是被关闭**」，
第 3 条把豁免限定在**入口** —— 不延伸到 3.8 的出口复测，不延伸到发布。本文第 128 行与 3.8 行已各自记着这一点，
本节与它们互指，**不改写它们的结论**。ADR-0004 的 Consequences 另记一笔：D6 的修复
「目前不属于任何工作项，需要在计划 M 里自带一个」；ADR 记的是这笔债存在，它不创设那个工作项。

- **伴生形态：9.96 MB 主线程楔子（无编号，且刻意不给编号）** —— 不收敛，实测持续 3 小时 49 分
  （dev 构建 4330/4330 采样）与另一进程 7858/7858 采样，**没有毫秒数，因为它从未结束**。
  ADR-0004 要求「treat D6 as the live defect and the 10 MB wedge as the tail case, not the reverse」，
  故它登记为 D6 的子行而非独立编号 —— 给它一个编号就会把注意力从半兆字节那半边引开。

**⚠️ 一处必须先更正的合并错误（本节前一版、以及 ADR-0004 第 21–24 行都犯了）。**
**79 197 ms 与 55 766 ms 都不属于 9.96 MB 楔子**，它们是 **472 KB WYSIWYG 档**的数字，
且两者都**结束了**：门禁二记录 `:30`、`:31`、`:98` 写明 79 197 ms 是「关闭 `very-long-line.wysiwyg`
触发的重挂载」，`:29`、`:99` 写明 55 766 ms 是「切到 `large-table.wysiwyg`」。
把它们挂到 10 MB 档上，会让读者以为那个楔子是有界的 —— 它不是，这正是它危险的地方。
ADR-0004 已 Accepted、不可修改，更正走后继 ADR，见 [ADR-0006](../adr/0006-bump-micromark-gfm-table-for-quadratic-edit-map.md)。

**两个档是两个缺陷、两个真因、两个修法** —— 门禁二记录 §6.3/§6.4 把它们分成 (A)/(B) 是对的，
错的只是 §6.4 对 (B) 的归因。经 jsdom 复现与本机日志双向核实后：

| | **(A) 472 KB WYSIWYG** | **(B) 9.96 MB Source** |
|---|---|---|
| 行为 | 有界，会结束 | 不收敛 |
| 真因 | `micromark-extension-gfm-table@2.1.1` `lib/edit-map.js` 的 `addImplementation` 先线性扫描 `editMap.map` 再 push，随单元格数增长 → O(cells²)；全表 45 744 格时实测 1.36e10 次数组比较 | 项目代码：`lintTableColumnCount.ts:38` → `cursorSync/table.ts:79 findAllTables` → `tableParser/parse.ts:39 splitLines` 全文重切 + `:112 source[i]` 逐字符 + `:125 findLineIndex` 每次线性扫行 ⇒ O(行 ×(字符 + 行)) |
| 触发点 | Milkdown 挂载时的 markdown→mdast 解析 | `@codemirror/lint` 构造时的 `setTimeout(run, 750)`，经 `Editor.tsx:124` |
| 修法 | 升级传递依赖到 **2.1.2**（上游 2026-09-11 发布，commit `4f43ead`） | 改我们自己的代码，不涉及依赖 |
| 状态 | ✅ 已修（`package.json` `pnpm.overrides` 钉 `>=2.1.2`，见 ADR-0006） | ✅ **已修**（2026-09-18）：`parse.ts` 不再持有 `splitLines` / `findLineIndex` / `source[i]`，行模型抽到 `tableParser/lines.ts`（`splitLines` + `lineIndexAt` + `linesFromString`）与 `tableParser/scan.ts`，CodeMirror 侧由 `textLineSource.ts` 直接喂行、不再 `doc.toString()`。回归测试是缩放律而非墙钟：`tests/table-scan-scaling.test.ts` |

**§6.4 的「落在依赖里」结论已被证伪。** 该结论依据的是 `src/` 内不存在
`charAt`/`charCodeAt`/`split("")`/`fromCharCode` —— 这个 grep 是对的，但它**漏了
`source[i]` 方括号取值**，而 JSC 对码点 > U+00FF 的单字符取值同样会分配 JSString，
正是 `operationSingleCharacterString` 那个栈顶。逐字符循环在**项目代码**里，不在依赖里。

**Milkdown 已从 (B) 排除，证据是日志而非推理。**`MilkdownEditor.tsx:163` 在 `Editor.make()`
之前记录 `initialMarkdownLength`。全部历史 **76 次**工厂调用中最大值 **430 614**，
**超过 500 KB 的 0 次** —— 护栏机制从未放行过一个大文档。2026-09-15 22:44:40 那一秒可见赛跑
结果：`.294` 工厂在 len=0 触发 → `.388` `file.open` 成功 9 961 503 B → `.985` 内容变为
8 821 491 且 `editorLoading:true, hasInstance:false`（`useEditor` 正在重建）→ `41.094`
`view.mode.change → source`。**护栏赢了 109 ms**，工厂再未触发。故 D6 的正确说法是
「阈值与判据变量选错」，而不是「护栏无效」。

**现场配置：楔死的不是一个文件，是四个，各占一个窗口。** 日志显示 2026-09-15 22:44:40–22:46:47
从 Finder 连开四个 `.perf-corpus/*.source.md`（`large-table` 8 821 491 / `many-short-nodes`
8 927 702 / `very-long-line` 7 583 751 / `dense-math` 9 110 964 字符），**每个都新开一个窗口**
（`window.open` 每次一个新 `windowLabel`，即记录 §10 第 2 条那个行为），四窗并存；
随后日志 **22:46:47 → 22:56:43 整整 9.9 分钟无任何记录**。独立窗口即独立 WKWebView 进程，
这解释了记录里为何是**两个**楔死 PID 而不是一个。

**(B) 不只是 10 MB 档的问题。** 同一个二次方在 **472 KB 档的 Source 模式**下已经是多秒卡顿
（jsdom/V8 实测 lint 单次回调：prose 1.6 s、large-table 15.3 s、dense-math 22.7 s、
many-short-nodes 44.8 s）。**它是发布质量问题，不是只在 10 MB 尾部才出现的边角。**
另有一条：`large-table.source` 在**未编辑**时因首个探针一次吞掉整张表而有界；
一旦在首行插入一个字符，表头与分隔行的列数不再匹配，`parse.ts:61` 返回 null，
捷径消失，它也加入二次方阵营。**「某些形态安全」只在用户不碰它的前提下成立。**

**上一段描述的是修复前的形态，(B) 已于 2026-09-18 修复**（见上表「状态」行）。
「首个探针吞掉整张表所以有界、一改就退化」这条**捷径依赖**正是被拆掉的东西：
扫描成本不再取决于表格能否解析成功。**但 D6 本身仍未修** —— 它是 WYSIWYG 侧
`App.tsx:512` 的判据变量选错（字节数 vs 单元格数），与 (B) 是两条通路，不要因为
(B) 修好了就认为 D6 可以结案。

**D2 · 编号是采纳、不是新造；两处残留未清。**
编号取自 `.claude/tdd-guardian/receipts.json` 中已 durable 的会话前缀 `D2-WI-1`…`D2-WI-4`
（记于 2026-09-15，`head_sha aa5f820`）。**它不在门禁二记录的 D 表里** —— 那张表只有 D1/D5/D6。
所以这是一次**采纳既有会话标签**，不是新造编号；但本表确实是它第一次被写成缺陷轨的一行。
修复形态：`apply_logging_settings` 的 `preferences_rw_lock()` 守卫跨越
load → 结构更新 → `save_preferences` → `logger::set_log_settings` 四步；
前端 `FAIL_CLOSED_SETTINGS = { enabled: false, level: "info" }`。
门禁：`cargo test` 263 passed／vitest 1419 passed + 4 todo（93 文件）／`tsc --noEmit` 0／
`clippy --all-targets` 0 warnings／rustfmt clean／覆盖率 32.26/63.29/83.25/32.26（阈值 31/61/82/31），
两条 criticalPaths 均 100/100。**残留两项**：

- ① ✅ **已人工验证（2026-09-22）**：release 包（干净 worktree @`44607d8`，sha256 `0440b48f…fb03`）上关掉日志后，新标签 / 切标签 / ⌃2 / 输入 / ⌘S / ⌃4 / 退出 / **重启后再来一轮**，`~/.mdpro/mdpro.log` 增量均为 **0 B**，`config.json` 与设置界面都保持关闭；重新打开后立即恢复写入（+31 行）。证据：[`docs/test/20260922-d2-logging-toggle-qa.md`](../test/20260922-d2-logging-toggle-qa.md)。**顺带两条待立项观察**（不是 D2 失败）：(a) 打开日志这一跳本身不留痕——`AdvancedSettings.tsx` 在 `setLoggingSettings` 生效前记 `ui.toggle.change`，所以关有记录、开被吞；(b) 每次 ⌃2/⌃4 写 **10 条** `ui.menu.select menu.view.set_mode`、只有 1 条 `view.mode.change`，疑似 10 个存活的 `menu:action` 监听器（`useMenuEvents.ts:86`），是按窗口还是泄漏未查。
- ② GS-1 锁跨度不变量是**评审强制、无测试强制**的，见
  [ADR-0005](../adr/0005-lock-span-invariant-is-review-enforced.md) —— 缩窄守卫会在**全套测试全绿**
  的情况下重新引入数据丢失。这不是 D2 没修完，是这次修复自带的一个已被记录的洞。

**D8 · 失实点的确切位置，以及一处必须先更正的引用。**
实际代码走平台数据目录：`src-tauri/src/bin/mdpro_mcp.rs:36-40` 的 `ServerConfig::load()` 用
`dirs::data_dir().join("mdpro")`；写入方 `src-tauri/src/services/http_server.rs:42-44` 的
`config_dir()` 同样是 `dirs::data_dir()`，写于 `:85`/`:90`，清理于 `:114-115`。
同一条失实在 `CHANGELOG.md:66` 与 `CHANGELOG.md:210` **重复两次**，修文档时要一起改。
**更正**：此前口头引用的路径 `src-tauri/src/mdpro_mcp.rs` **不存在**，正确路径是
`src-tauri/src/bin/mdpro_mcp.rs`（`bin/` 少不得，按错路径去 grep 会得出「代码不存在」的错误结论）。
本机残留 `~/.mdpro/server.port`（5 B）与 `~/.mdpro/server.token`（64 B，mode 600），均为 3 月 31 日；
活的一对在 `~/Library/Application Support/mdpro/`。⚠️ **孤儿文件只登记、不擅自删除** ——
它是失实文档曾经生效过的现场证据，删掉就只剩一句没有落点的描述。

**维护规则**（与本文第 18–20 行的状态维护规则同源，不是另立一套）：修好一条缺陷时，
**在同一个提交里**更新它在本表的状态与修复 SHA，并写明被证伪的结论；不要留到后续清理批次。
「修复完毕」同样指它自己的门禁跑绿，不是代码写完。新缺陷从本表**当前最大编号续起**；
**D3 / D4 永久留空**，已有编号（D1 / D5 / D6）不得重编、不得复用。

---

**D10 · 三个缺陷是同一个：单位从来没定过。**

登记时看起来是三条独立的 MCP 缺陷，查下去是一条 —— **规格在同一页上给同一个字段写了两个单位**。
`data-model.md:27` 的文档注释说 `cursor` 是「character offset from start」；`:44` 的合法性规则写
`cursor: Must be ≤ content.len()`，而 Rust `String` 的 `len()` 是**字节数**。而且「character」本身
还是歧义的 —— Unicode 标量，还是 UTF-16 码元？两边各自挑，挑得不一样：

| 一侧 | 实际单位 | 出处 |
|---|---|---|
| Rust `http_server.rs` | Unicode 标量 | `char_offset_to_byte` 用 `char_indices().nth(n)` |
| 前端 `useMcpEvents.ts` | UTF-16 码元 | `content.slice(0, offset)` 是 JS 字符串索引；`selection.main.head` 是 CodeMirror 位置 |

**基本多文种平面（BMP）之内两者完全一致** —— 全部 ASCII、全部 CJK 都一致，所以这个分歧一直没被发现。
只有星平面字符能把它们分开：一个 emoji 是 **1 个标量、2 个 UTF-16 码元**。旧测试用的全是
`"hello"` / `"你好世界"` / `"café"`，**没有一个能区分这两种单位**，这才是它活到今天的原因。

危害不止「回报的数字不对」。`insert_content` 会**乐观地**先用 Rust 偏移把新内容写进影子存储，
再发事件让前端用 JS 偏移去应用 —— 越过一个 emoji 之后，**同一段文字被插进了文档的两个不同位置**。
前端随后的 sync 会覆盖影子存储，所以最终损害是「一次读到错内容」加「一个永久错的 `newCursor`」，
但中间那一刻两份文档确实不一致。

**决策见 [ADR-0021](../adr/0021-mcp-document-offsets-are-utf16-code-units.md)**（Accepted 2026-09-22）：
统一为 UTF-16 码元，**由 Rust 侧改**。理由不是 UTF-16 更好 —— 抽象地看它更差，是把 1990 年代的
编码决定泄漏进 2026 年的 JSON API —— 而是前端的单位**不是自由选择**（CodeMirror 位置就是 JS 字符串
偏移），Rust 侧的单位**是**自由选择（它本来就要转成字节偏移）。这笔代价 ADR 里明写了，没有只列好处。

**改动：**

- Rust：`char_offset_to_byte` → `utf16_offset_to_byte`，并**新增逆函数** `byte_offset_to_utf16`。
  逆函数此前**根本不存在**，这正是 `new_cursor` 会被写成「字节 + 字节」的原因 —— 没有能写对的工具。
  偏移算术抽成 `resolve_insert(content, cursor, position, text) -> (byte_offset, new_cursor)`，
  因为处理器本身要 `AppState` 和活的 `AppHandle`，抽出来才测得到（与 `file.rs` 里
  `discard_and_close` 从 `close_document` 抽出来同一个理由）。
- 前端：新增 `src/utils/mcpCursor.ts` 的 `resolveMcpCursor(content, isActive, head)`，
  `useMcpSync` 与 `useMcpEvents` **共用同一个函数**。这一点是刻意的：两段**写法一致的 if**
  今天一致、明天就会漂；一个共用函数漂不了。`useMcpSync` 不再硬编码 `0`，改读活的 CodeMirror 光标。

**测试：** Rust 10 例（M1–M10，RED 7→GREEN），前端 12 例（RED 4→GREEN）。
其中 **M10 是定律例** —— 两个转换函数在每一个字符边界上互为逆 —— 没有它，两个函数完全可能
朝同一个方向一起错，而上面每一个举例都照样通过。前端 12 例里有 2 例是**源码文本判据**，
钉住两个 hook 都走共用函数：「代码住在哪里」这个性质，行为测试看不见。
旧的 5 例 `char_offset_*` 测试原样改指向新函数（13 处调用点），输入全是 BMP，
**每一个期望值一字未改** —— 这本身就是「单位改动在星平面以下不可见」的证据。

**未解决，明写而不吸收：**

1. **WYSIWYG 模式下根本读不到光标。** 只有 CodeMirror 的 `Editor.tsx` 会写
   `editorStore.editorView`；Milkdown 用的是它自己的 `editorViewCtx`（`MilkdownEditor.tsx:273`），
   从不回写 store。所以 WYSIWYG 下 `editorView` 是 `null`，两侧**一致地**解析成 0 ——
   一致性这条修好了，「插在光标处」在 WYSIWYG 下仍然是插在文档开头。这是 D10(c) **没有**关掉的那半，
   要关它得把 ProseMirror 选区接进 editorStore，是另一件事。**不得把它算进本条的已修复范围。**
2. **存储的光标会过期。** `useMcpSync` 在文档数量、活动文档、内容变化时重新同步，**不在光标移动时**。
   只移动光标不打字，影子存储里留的是旧位置。改成每次移动都同步就是每次击键一次 IPC，这个代价
   判为不值得付。
3. **`newCursor` 仍然是预测而非观测** —— HTTP 响应在前端应用事件之前就返回了，这是乐观发射设计的
   固有性质，不是本次引入的。
4. **纯 BMP 客户端完全看不出区别**，也就意味着这个修复**基本无法靠手工测试验证**，
   证据全压在回归测试上。

---

**D11 · 一个字段没跟上 rope 改造，于是光标路径还在复制整篇文档。**

Phase 4 WI-3B 把表格扫描从「拿一个字符串」改成「走 `TableLineSource`」，目的就是让源码模式
不再因为文档大而变慢。改造漏了一个字段：`TableModel.raw`。`parseTableAtLine` 结尾仍然是

    raw: src.slice(start, end)

急求值，每次解析都跑。而**读它的人和跑它的人不是同一批**：

| 调用点 | 触发频率 | 读 `.raw` 吗 |
|---|---|---|
| `src/plugins/codemirror/sourceTableDetection.ts:76`（`tableContextField`） | **每次按键 / 点击 / 方向键** | 否 |
| `src/plugins/codemirror/sourceTableContextMenu.ts:75` | 每次右键 | 否 |
| `src/utils/tableParser/scan.ts:130`（整篇扫描，每次 lint） | 每表一次 | 否 |
| `src/utils/tableParser/tableEdits/edits.ts:62` | 每次编辑 | 否 |
| `src/plugins/codemirror/lintTableColumnCount.ts:67` | 每次 lint | **是**，随即 `.split("\n")` |
| `src/utils/tableWriteGuard.ts:104` | 每次写入前 | **是**，随即 `.split("\n")` |

也就是说：**唯一按键频率的那个调用点，恰好是不读它的那个。** 在整篇就是一张表的文档上
（`large-table.source.md`，约 25 万行 / 9.96 MB），这是每移动一次光标复制约 9.96 MB。

修法是把 `raw` 改成**惰性记忆化 getter**，对外类型仍是 `string`，两个真读它的调用点一行不改、
仍然各付一次拷贝。公开类型不变是有意的：`raw` 会被展开（spread）和 `JSON.stringify`，
挪到原型上会让它从这两种操作里**静默消失**，所以测试专门钉了它仍是可枚举自有属性。

**证据是计数，不是毫秒。** E39/G0 禁止把时长变成门禁，理由也成立——毫秒阈值在忙碌的机器上
会假红，于是被一路调高到失去意义。这里要钉的性质不是「快」，而是**「光标路径的整表拷贝次数为 0」**，
这个数可以精确数、且与机器无关。`tests/table-parser-lazy-raw.test.ts` 用一个计数版
`TableLineSource` 包住真实的 `linesFromString`（而不是手搓假对象——假的会让一个已经读错行的
解析器也通过），断言光标路径 `slice()` 调用 0 次、`.raw` 读两次只切一次。

**顺带收回了一处当初明写「做不到」的让步。** `tests/table-line-source-conformance.test.ts`
的 CONF-scan-cost 原本要求 `sliceString === 0`，被拒绝并降级成 `=== models.length`，理由
白纸黑字写在那里：*「a scan that finds 10 tables cannot slice zero times without changing
`parse.ts`」*。D11 改的正是 `parse.ts`，所以两处断言（scan 与 probe）都恢复成矩阵原本的字面值 0。
这**不是**为了让代码过关而改测试——让步的理由已经失效，原来的主张重新成立，两处都写明了来龙去脉。

**顺带查出并修掉的另一件事：账簿的渲染稿一直在少东西。**`docs/feature-ledger.md` 第 167 行的代码片段里有一个**没转义的竖线**，而 GFM 是先按竖线切单元格、再解析行内代码的——所以那一格从竖线处就断了，全账簿最长的一行有约六成内容（包括关于源码模式的全部保留意见）从来没出现在 `feature-ledger.html` 里。闸门看不见它：行照样解析、单元格照样四个、状态照样合法、路径照样都在，`ledger:check` 报的是 0 findings。三处转义随 `11b7dab` 落地，渲染稿从 143.2 KB 涨到 147.3 KB，涨的全是早就写好、从未显示过的内容；防止再犯的检查 `no-raw-pipe-in-code` 在 `3825663`。

**同一提交里按规则 22 修掉的失实注释：** `src/utils/tableParser/parse.ts` 的文件头一直宣称
CodeMirror 调用点「never materialise the document」，而它自己的返回值每次都在 materialise。

**未解决，明写而不吸收：**

1. **真机整机复测仍未做。** 这是 ⌃2 这一面定位到的第二处代价（第一处是 `tocService` 的 O(n²)，
   提交 `3d37b86`）。两处都只有单点对照，**没有**重新测过整机冷开。在没重测之前，
   「源码模式现在要多久」仍然是未知数。
2. **本条没有给源码模式立任何判据。** `largeDocumentGuard.ts:260` 对非 wysiwyg 一律放行这件事
   一个字没动。D6 关于「⌃2 这一面没有设计」的那半**依然开放**，不得因本条已修而视作收口。
   **2026-09-22 补记（`aac8097`）：这半已由 [ADR-0022](../adr/0022-source-mode-gets-its-own-guard-keyed-on-table-row-density.md) 的实现补上** —— 上文引的 `largeDocumentGuard.ts:260` 已过期，Source 分支现按表格行起始数 > 50 000 卸掉表格扩展（见 D6 / D12 行）。补上的是「有判据」，不是「已验收」：真机 MQ-1..MQ-4 已于 2026-09-22 在 release bundle 上跑完（WYSIWYG 入口双提示目测 NOT VERIFIED），D6 仍系于 3.8。
3. **惰性 getter 会把 `src` 一直挂住**，直到模型本身被回收——所以一个长命的模型现在留住的是
   整篇文档的行索引，而不只是那张表的文本。唯一长命的持有者是检测用的 StateField，它的 source
   包的是 CodeMirror 的 rope，而那个 rope 本来就被 EditorState 持有着，所以实际代价接近零。
   这是明知的取舍，不是疏忽。

---

## 三个两个计划都未记载的问题

**① ~~WI-4.21 依赖一个不存在的 ESLint~~ —— 已于 2026-09-22 结案，且结案方式与当初的建议相反。**
原文记的缺口是真的：WI-4.21 要一条 `no-restricted-syntax` 规则，而 HEAD 上无 eslint 配置、
无 `lint` script、`package.json` 中 eslint 出现 0 次。原文给的解法（并入阶段 1 的 chore PR）
已经不可行 —— 那个 PR 于 2026-09-12 落地，G0 从 WI-0.1 起对 `package.json` **从零起算**。
**实际结案：不装 ESLint。** 见 [ADR-0023](../adr/0023-one-lint-rule-enters-as-a-typescript-parser-script.md)。

**但本条还藏着一个必须改的验收项。** 原文写 WI-4.26 剩下的验收之一是
「WI-4.21 的 lint 规则拒绝 `useTOC.ts` 的零参数调用」。**该调用已经不存在了** ——
`src/hooks/useTOC.ts:131-138` 现在是八个逐字段 selector，`:127-130` 是解释这次改动的注释，
其中那句 `useTOCStore()` 是**注释里的文字**，不是调用。照原文验收会得到一个失败，
而失败的原因是缺陷没了、不是规则坏了 —— 这正是「按文本找」和「按语法找」的分野：
纯文本扫描在本仓库对这条规则的**查准率是 4 分之 1**（4 个命中里 1 真 3 假，
3 个假阳性分别是这条注释、一个 docblock、和一个 `expect(...)` 里的字符串字面量，
而那条注释恰恰就是规则 50 §1 的文档）。
**验收改为**：规则必须拒绝一条**测试内以字符串给出的**零参数调用（红），
并且必须对上述三处文本命中**不报**（这才是验收的实质）；对真实 `src/` 树的断言是
**零发现**，因为当时唯一的真实违规 `src/components/common/settings/AdvancedSettings.tsx:21`
在同一批工作里已被改为逐字段 selector。

**② 阶段 3 的语料不是「选一个」，是「从零建」。**（**已回写进 M 的问题 4 并结案**）
M 的待决问题 4 把 `tests/image-test/` 当候选，但实测它共 4 个文件
（`quick-test.md`、一张 PNG、两个 `.DS_Store`）且**未被跟踪**，是图片路径夹具，与标题语法无关。
HEAD 里唯一跟踪的 fixture 是 `tests/render-fixtures/phase1.json`。
M 的第二层「语义契约测试」完全依赖这份语料，所以 3.0 是一个实打实的构建任务，不是筛选任务。

**③ 标题契约的既有测试网很薄，但不是零 —— 本条原先两处失实，已更正。**

- 原记「只有 `cjk-slug.test.ts` 碰 slug」**不实**：`markdown-editor-core.test.ts:63` 也钉了
  `["intro", "intro-1", "intro-2"]`，`:119` 钉了导出侧 `id="intro-1"`；Rust 侧 `toc.rs:164-233`
  还有一组 `duplicate`/`duplicate-1`。所以改动 slug 会同时惊动 TS 与 Rust 两边的现存断言。
- 原记 `cjk-slug.test.ts` 是「**把缺陷钉死**的那个文件」**不实，已撤回**：`:53-59` 只喂单个
  `# 🎉🎊` 并断言 `"heading"`，那是期望行为；回退碰撞需 `# 🎉` 与 `# Heading` 共存才触发。
  修复后该用例仍绿。**3.2 是新增碰撞用例，不是改写既有用例** —— 这一点直接影响 E26 的适用：
  没有「被取代的断言」要删，因此 3.2 不受 E26 的同提交约束。

**确实为零的是**：没有 `tocStore` 测试文件，没有 `useTOC` 测试文件，
没有任何用例覆盖 CRLF 偏移、代码围栏、Setext、导航与滚动同步。
好处是这几块回归风险小；代价是阶段 3 必须自带全部表征测试，没有现成安全网可继承。
