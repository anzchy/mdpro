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
| **3** | 🔄 | **标题身份契约 + TOC 切换（M 提前）**（入口门禁一已交付 `c17c003`；门禁二**六面已全测** 2026-09-15，硬标准「不永久无响应」违反但**已豁免放行** [ADR-0004](../adr/0004-gate2-waiver-for-stage3-entry.md) ⇒ **两道入口门禁均已通过，3.1 可开工**）。**进度（2026-09-18）：3.0 ✅、3.1 ✅、3.2 ✅，3.3–3.8 未开工**，逐行状态见阶段 3 表 | **M** | WI-4.26 依赖的 identity 今天是坏的 |
| **4** | ⬜ | WI-0.1 重跑 → Stage 0→5 全程 | P | 主体工作 |
| **5** | ⬜ | 导出迁移、旧解析器退役、ammonia 评估 | M | 行为变更，需独立回滚边界 |
| **并行** | 🔄 | ESLint（未开始，见 1.10）；**安全收紧：链接点击守卫 C1 已交付并验证**（协议相对链接绕过 `//evil.com/x` → `tauri://evil.com/x`，见 `docs/adr/0002-link-click-routing-and-origin-comparison.md` 与 `docs/adr/0001-wysiwyg-link-scheme-allowlist.md`）；**卫生项已交付**（生成物目录统一入 `.gitignore`；`linkSafety.ts` 与 `useMilkdownLinkClickGuard.ts` 两条 criticalPaths 钉在 100% 行/分支——全局阈值 31/61/82 挡不住只影响这两个文件的回归） | M Part 6 | 不阻塞主线（但见下方 ESLint 例外） |

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
1.4–1.9 已完成并验证；1.1、1.2、1.10 按用户指示改期到独立 PR。

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
| 1.10 | ⏭️ | ⚠️ **建议追加：ESLint 接入**（M 的 P1） | **已决：不进本 PR，单独一个 PR**，并登记为 WI-4.21 的**硬前置**——P 的 WI-4.21 要加 `no-restricted-syntax` 规则、WI-4.26 的验收依赖该规则，而仓库里既无 eslint 配置也无 lint script |

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

**本阶段状态：🔄 进行中**（截至 2026-09-18）。两道入口门禁均已通过；
**3.0 ✅ 已交付并验证**（`c17c003`，订正 `07d763c`，runner 收紧 `549d22f`）；
**3.1 ✅**（`05396db`）、**3.2 ✅**（随本表所在的提交落地）；**3.3–3.8 六行尚未动工**，逐行状态见下表。
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
| **3.0** | ✅ | **M 阶段 0：冻结契约** —— 语法矩阵、代表性语料、安全样例、性能基线 | ⚠️ 语料与性能基线**都是入口门禁**（见上）。语料为从零构建任务，**已交付** `c17c003`，双语 runner 随后收紧：钉死的缺陷必须记录实测输出，修好后若不同步从 `currentlyFailsOn` 与 `currentlyProduces` 删除即报红（语料 25 例）；性能基线**六面已全测**（2026-09-15），硬标准「不永久无响应」违反但**已豁免放行**（ADR-0004）——基线本身已**可复现**：生成器按字节忠实移植入库 `scripts/perf/generate-corpus.mjs`，`--check` 当场断言 M 的记录表，两次独立运行、以及与原生成器产物，均 11/11 逐字节一致（决定输出的是算法而非种子） |
| 3.1 | ✅ | 确立三概念身份模型：`anchorSlug` / `headingKey` / 位置 | **2026-09-18 完成并验证，已提交 `05396db`。** 新增 `src/utils/headingIdentity.ts`（128 行）与 `src/types/toc.ts`（118 行），测试 `tests/heading-identity-model.test.ts` 35 例 + `tests/helpers/headingCorpus.ts`。自身闸门全绿：unit lane 1617 例 0 失败、`tsc --noEmit` 与 `pnpm typecheck:tests` 均 exit 0、`headingIdentity.ts` 行/分支覆盖 100%。**未接线任何调用面**，`src`/`tests`/`src-tauri`/`package.json` 的已跟踪 diff 为空（本人复核，非取自 agent 报告）。**一项 HIGH 规格分离发现待你确认**：红→绿之间改动了 B9 一条断言，原因是矩阵 B9 与 B1 **自相矛盾**、任何实现都无法同时满足（B1 要求 `["x","x","x-1"] → ["x","x-1","x-1-1"]`，其中第三个标题正是 base `x-1` 的首次出现却不得拿到裸 base）；B1 为规范侧，故已**同步修正矩阵 B9 与计划 `:65`**，缺陷不残留在规格里。**决策**：`TOCEntry` 按计划留在 `tocStore.ts`，推迟到 3.5 随字段拆分一起搬。原勘察：**2026-09-18 实测落点**：`src/types/toc.ts` **不存在**；`TOCEntry` 现定义在 `src/stores/tocStore.ts:6-27`，三处引用**全是 `import type`**（`useTOC.ts:4`、`Sidebar/index.tsx:1`、`TOCSidebar.tsx:2`），无运行时耦合 —— 搬不搬这个接口是 3.1 要明确回答的一项，不是可以顺手做掉的事 |
| 3.2 | ✅ | 修 slug 两类碰撞 —— **三个活面一次性改齐**：`tocService.ts:101`、`exportService.ts:47`、`markdown.rs:23`，并配跨语言 parity 测试 | 原记「两个面」**少算了**：实测共**五份** slug 实现，**三活两死**。两死为 `toc.rs:36`（命令零调用方，且 TS 传 `document_id`／Rust 收 `content`，参数不匹配）与 `tocStore.ts:120` `generateAnchorId`（零引用；却是五份里唯一防碰撞正确的，但剥除 CJK，只能作去重逻辑参照）。两死面**不在 3.2 内**：M 明记 `toc.rs` 退役属第 5 步、不提前。后缀碰撞 `x, x-1, x-1` 五面皆有；fallback `"heading"` 从不注册**仅 TS 两面**有 —— 故这是一条活的 TS↔Rust 分歧，parity 测试须覆盖它。**⚠️ 2026-09-18 实测推翻「Rust 免疫」这一说法**：Rust 确实在**计数之前**替换 `"heading"`（所以 emoji 在前的形状它是对的），但它**用计数而非 taken 集合**，因此仍会撞上字面量。实测 `# heading-1 / # 🎉 / # 🎊` 在修复前的 Rust 面产出 `["heading-1","heading","heading-1"]` —— **重复**。本人直接读 HEAD 的 `markdown.rs:43-49` 逐步复核，非取自 agent 报告。结论：Rust 免疫的只是语料里那几个**特定形状**，不是这个缺陷类。**2026-09-18 完成并验证（B1+B2+B3+B4 一并落地）**：B1（`tocService.ts` + `exportService.ts` 改用 `src/utils/headingIdentity.ts` 共享分配器）、B2（`markdown.rs` 端口，taken 集合 + 单调 hint）、B3（[ADR-0003](../adr/0003-export-fragment-sanitizer-scope.md) B′：`SANITIZE_DOM: false`，并改名 `sanitizeRenderedHtml` → `sanitizeExportFragment` 以显式化「只处理片段、永不进活 DOM」的作用域）、B4（失效注释、CHANGELOG、ledger）。新增 ADDENDUM A 的两个语料用例（`literal-then-emoji`、`literal-suffix-then-two-emoji`）。**B3 的解锁条件已满足**：[ADR-0011](../adr/0011-remove-name-from-export-sanitizer-allowlist.md) 于 2026-09-18 **Accepted**（`1f3379d`），`name` 随之从 `BASE_ATTRS` 移除 —— `SANITIZE_DOM: false` 与保留 `name` **只有同时存在才危险**，故两者必须同批落地，不得只落其一。ADR-0003 的 `<form>` 前置条件**已复核仍成立**（`form` 在 `sanitizerPolicy.ts` 中只出现在「Deliberately ABSENT」注释里），且已从散文改为**行为断言**钉住。**闸门全绿（本人独立复跑，非取自 agent 报告）**：unit lane 431 套 / 1665 例，1661 通过 0 失败 4 todo；覆盖率 lines 33.98 / functions 66.20 / branches 85.01 / statements 33.98，四项均过阈（31/61/82/31）；`cargo test` 275 通过 1 忽略；`typecheck:tests`、`tsc --noEmit`、`cargo fmt --check` 均 exit 0；`ledger:check` 166 行 / 183 条路径断言 / **0 findings** / 94-94 命名覆盖。**21 个面已按约定同步解钉**（7 面属 slug 算法，14 面属 B′）；语料剩余钉子经本人从 fixture 重算为 **9 个**，与 `heading-identity-fixture-integrity.test.ts` 的 `EXPECTED_SURVIVING_PINS` 逐条一致：`crlf-doc|tocOffsets`、`crlf-two-lines|tocOffsets`（3.4）、`fenced-hash|toc`、`link-in-heading|toc`、`setext-noncolliding|toc`、`setext-title|toc`（3.3）、`formatted-bold|exportFallback`、`inline-code|exportFallback`、`link-in-heading|exportFallback`（A1 既定降级）。**2026-09-18 实测**：3.0 的语料已把这两类碰撞逐一钉成「已知缺陷」并记下实测输出，故 3.2 的收尾动作是从 `currentlyFailsOn` 与 `currentlyProduces` **同步删除 10 个用例上的 21 个面**，少删一处双语 runner 即报红。其中 **7 个面属 slug 算法**（`suffix-collision` 三面，`emoji-then-literal`、`two-emoji-only` 各两面），**14 个面属 [ADR-0003](../adr/0003-export-fragment-sanitizer-scope.md) 的 B′**（`trailing-hashes`、`leading-trailing-punct` 与五个 `clobber-*`，各 `exportCanonical` + `exportFallback` 两面）—— 后者是 DOMPurify `SANITIZE_DOM` 剥掉锚点，**slug 本身是对的**，与碰撞无关但同属 3.2 |
| 3.3 | ⬜ | 用共享 remark 配置替换正则解析器 | 覆盖围栏、Setext、格式化标题、重复、CJK、emoji、**CRLF、slug 唯一性**（后两项原缺，按 M 的第二层测试清单补齐）。**回滚点：TOC 实现开关，不动正文**（原缺）。⚠️ remark **不可直接导入**：实测顶层 `node_modules` 无 `remark-parse`，它只是 `@milkdown/kit` 的传递依赖 ⇒ 本步开场需独立 `chore(deps)`。**2026-09-18 实测订正「必然双实例」**：这三个包已作为 `@milkdown/kit` 的传递依赖躺在 pnpm store 里，版本为 `unified@11.0.5` / `remark-parse@11.0.0` / `remark-gfm@4.0.1`；直接依赖**钉到同一版本**即共用单实例、零新增下载包，M 要求的「与 Milkdown 插件集合一致性验证」压力随之大降 —— 但这是**选择的结果，不是默认行为**，版本一漂就退回双实例。另注：G0 的「无新依赖」按 `package.json` 直接依赖计，**仍须一条 ADR 走例外**，ADR-0006 的例外只覆盖既有传递依赖的补丁号提升且明文不外推 |
| 3.4 | ⬜ | 位置映射：UTF-16 offset + 行号；修 CRLF 每行少算 1 | `text\r\n# 标题` 应为 6 而非 5。3.0 语料已钉死两例 `tocOffsets` 面：`crlf-doc`（实测 5／应为 6）与 `crlf-two-lines`（实测 4／应为 6，证明**误差会累积**）；`lf-two-lines` 是对照组，证明 LF 下算术正确、缺陷只在 CRLF |
| 3.5 | ⬜ | 身份协调：`tocStore.setEntries` 保留折叠态与活动项（**从 WI-4.26 移入**） | **2026-09-18 实测**：`tocStore.ts:87` 的 `setEntries` **硬重置两者**（`activeEntryId: null` + 新建空 `collapsedIds`），唯一调用方是 `useTOC.ts:83` 的 300 ms 去抖解析 ⇒ **每一轮击键都抹掉折叠态与高亮**，哪怕标题集合根本没变。`TOCState`（`:32-44`）**无任何文档 id 字段**，`clearEntries` 定义了却零调用 ⇒ 今天「切文档不串味」恰恰是**这次重置**的副产品；3.5 拿掉重置后，协调键若不带文档作用域，A 文档折叠的 `intro` 会**永久**漏进 B 文档 |
| 3.6 | ⬜ | 真实导航：修 `useTOC` WYSIWYG 首个命中即 `break` | 点第二个重复标题必须到第二个。**2026-09-18 实测两处订正**：① 同一个 `break` 循环有**两处** —— `:141-148`（导航）与 `:228-234`（滚动监视的 observer 注册）；只修导航会留下重复标题的**高亮**仍然错，且 `headingElementsRef` 会把 N 个条目塌成同一个 DOM 元素。② 更上游：`data-heading-id` 全仓只由 `exportService.ts:71`（导出渲染器）写出、`sanitizerPolicy.ts:98` 放行，**编辑器侧无任何面发出它**，故 `:128` / `:220` 的 id 选择器在 WYSIWYG **恒不命中**，文本匹配是唯一通路 ⇒「改用 id」不是一行改动，它要求 Milkdown 先渲染出身份属性。Source 模式走 `:103-120` 的**行号**通路、根本不碰 DOM，本就对重复标题免疫 |
| 3.7 | ⬜ | 三层测试：协调算法单测 / 语义契约测试 / **用户行为测试** | 第三层不可省。**无既有安全网**：`tocStore`、`useTOC`、`TOCSidebar` 三者的测试文件数**均为 0**（与本文第 428–430 行一致），三层全部是新建，不存在可继承的表征测试 |
| 3.8 | ⬜ | 出口复测大文档性能（基线已在入口门禁 2 取得） | ⚠️ **ADR-0004 改了本行的比较方式**：入口基线里含一个**不收敛**的阻塞（9.96 MB 形态），整体聚合比较无法把第 3 步的回归与既有卡死区分开。**本行必须逐面比较，并逐个点名排除已卡死的形态**，不得比聚合值。**豁免只到入口为止，不覆盖本行。** P 的「零额外 React commit」**不能**替代 —— 此话 P 自己也说了（`20260911-plan-ui-redesign.md`「The performance gates are not interchangeable」），非本文自创。**「过期解析结果」已从本行移出**：它是 M 的迁移红线第 3 条「异步结果必须携带文档 ID 与修订号」，属数据正确性不变量，不是性能指标，须由 3.7 第三层行为测试断言。**2026-09-18 复核：D6 仍未修**（`App.tsx:512` 的 `if (bytes <= 500 * 1024) return;` 一字未动），而 ADR-0004 的豁免**不覆盖本行** ⇒ D6 必须先于本行结案；计划 M 至今**没有承载它的工作项**（M 里唯一一处 D6 提及在 `:519`，只是重述这笔债被挂着），这个缺口本身需要有人补 |

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
另有一条**硬前置至今未满足**：WI-4.21 依赖的 ESLint 在仓库内仍然零存在
（无配置文件、无 `lint` script、`package.json` 中 eslint 出现 0 次），
它同时是 WI-4.26 一条验收的前提 —— 见下方「三个两个计划都未记载的问题 ①」。

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
| **D1**（既有） | MUST | **未修复** | 计时器跨越文件选择器。实测导出报告 72 745 ms，其中 72 154 ms 是人工停留，净成本 591 ms；**经由对话框的 `durationMs` 全部不可用** | 门禁二记录 `:210`。记录只点名 `file.rs:1098`，**实测同一形态共三处**（见下，且出数字的不是被点名那处）。无修复提交。「既有」在仓库内无更早出处：`git log --all -S '**D1**'` 只命中 `c92b1ba` |
| **D2** | —（未定级：登记入表时已修复） | ✅ 已修复并验证 | 日志设置的两条失败路径：① `src-tauri/src/commands/logging.rs` 的无锁 read-modify-write（丢失更新）；② `src/services/loggingService.ts` 的 IPC 失败 fail-open，**把显式关掉日志的用户静默改回开启** | 五个提交 `ba9fdb7`、`a089c55`、`061feff`、`560db38`、`dae10d5`。**「全部未推送、分支领先 5 个」已过期**：2026-09-18 以 `git ls-remote` 核实，`origin/frontend-backend-redesign` 的尖端就是本地 HEAD `e030a2c`，五个提交均已在远端。门禁数字与两处残留见下 |
| **D5** | BLOCK | **未修复** | `src-tauri/tauri.conf.json:28` 的 CSP 无 `connect-src`，`default-src 'self'` 因此拒绝 `ipc://localhost`；打包构建每次启动约 20 条 console 错误。Tauri 回退 postMessage，**功能不受影响**（`invoke`/`listen` 实测正常），但噪音淹没真实错误 | 门禁二记录 `:208`（`c92b1ba`）。已核 HEAD：`:28` 现值仍为 `"default-src 'self'; img-src 'self' asset: https://asset.localhost https: data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-eval'"`，无 `connect-src`。无修复提交。⚠️ `pnpm tauri dev` 的宽松 dev CSP **完全掩盖它**，只能在打包构建里复现 |
| **D6** | MUST | **已豁免（仅入口）**，缺陷本身开放 | **护栏机制有效；错的是阈值与判据变量。**`large-table.wysiwyg.md` 仅 471 880 B，低于门槛因而被放行挂进 PM DOM，阻塞主线程约 56 s。该文档为**单表 45 744 单元格** —— 代价随单元格数呈二次方，与字节数几乎无关 | 门禁二记录 `:209`。已核 HEAD：`src/App.tsx:512` 仍是 `if (bytes <= 500 * 1024) return;`，阈值未动。豁免范围见 [ADR-0004](../adr/0004-gate2-waiver-for-stage3-entry.md) 与本文第 128 行。机制有效性与 56 s 的归因见下 |
| **D7** | MUST | **未修复** | Rust 侧 logger 缓存 fail-open：`src-tauri/src/services/logger.rs:25` 的 `.unwrap_or_default()` —— 读取日志设置失败时回落到默认值而不是关闭。**D2 只修了前端那一半** | [ADR-0005](../adr/0005-lock-span-invariant-is-review-enforced.md) 第 108–111 行把它点名为「a separate defect with no ADR of its own yet」，`CHANGELOG.md` 也已披露 —— 但此前**没有编号、不在任何表里**。无提交 |
| **D8** | SHOULD | **未修复** | MCP 端口/令牌路径的文档失实 + 本机孤儿文件：`src-tauri/src/bin/mdpro_mcp.rs:9` 写「reads ~/.mdpro/server.port and ~/.mdpro/server.token」，实际代码走平台数据目录 | 失实点与路径更正见下。⚠️ 孤儿文件**只登记，不擅自删除** |
| **D9** | BLOCK | ✅ **已修复并验证**（残留一项见右） | 源码模式表格识别**宽于 GFM**，三种形态被当成表格：① 单列表头 + `---`（GFM 判为 setext 二级标题）；② 分隔行缩进 ≥4 列；③ 分隔行**或表头行**以 Tab 开头（`countLeadingSpaces` 只数 U+0020，Tab 整个逃过 `MAX_INDENT`）。后果是**静默数据丢失**：幻影表格占据 `tableIndex 0`，外部 MCP 客户端调 `delete_row(0,0)` 删掉的是标题而不是表格行 | 三个 ADR：[0007](../adr/0007-table-scanner-emits-non-overlapping-models.md)、[0008](../adr/0008-non-candidate-delimiter-class-measured-against-gfm.md)、[0009](../adr/0009-narrow-source-table-detection-to-gfm.md)；计划 [`20260917-plan-table-over-detection-vs-gfm.md`](./20260917-plan-table-over-detection-vs-gfm.md)。实测复现与修后语料对照见 ADR-0009。**残留**：Rust 侧 `http_server.rs:834` 仍在应用之前就回 `202`，被拒绝或不存在的 `tableIndex` 依旧向客户端报成功，唯一痕迹是 `~/.mdpro/mdpro.log` 里一行 `ui.table.write_refused` |

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

- ① 尚欠一次人工 QA（设置 → 高级 → 关闭日志开关）。**没有任何测试道能覆盖它**，✅ 不含这一项。
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

## 三个两个计划都未记载的问题

**① WI-4.21 依赖一个不存在的 ESLint —— 这是真正的跨计划缺口。**
WI-4.21 要加 `no-restricted-syntax` lint 规则，WI-4.26 收窄后**剩下的验收之一**
就是「WI-4.21 的 lint 规则拒绝 `useTOC.ts` 的零参数调用」。但实测 HEAD：
无 eslint 配置文件、`package.json` 中 eslint 出现 0 次、无 `lint` script。
M 把 ESLint 列为「与 P0 无关的独立改进项 P1」，P 则默认它存在。
**建议并入阶段 1 的 chore PR** —— 那里已经在动 `package.json` 和测试工具链，且它是 WI-4.21 的硬前置。

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
