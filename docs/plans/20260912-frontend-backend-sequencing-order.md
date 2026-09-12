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
| **2** | ⬜ | 死代码清理，独立 PR | P（WI-0.1 之前） | 必须在基线捕获前完成，否则基线记录的是将被删除的文件 |
| **3** | ⬜ | **标题身份契约 + TOC 切换（M 提前）** | **M** | WI-4.26 依赖的 identity 今天是坏的 |
| **4** | ⬜ | WI-0.1 重跑 → Stage 0→5 全程 | P | 主体工作 |
| **5** | ⬜ | 导出迁移、旧解析器退役、ammonia 评估 | M | 行为变更，需独立回滚边界 |
| **并行** | ⬜ | ESLint、安全收紧、卫生项 | M Part 6 | 不阻塞主线（但见下方 ESLint 例外） |

**当前状态实测**：计划 P 实现为零（`src/styles/index.css`、`src/styles/sections/`、
`ToggleSwitch.tsx`、`Icon.tsx`、`useTauriEvent.ts` 均不在 HEAD）；M 要收敛的五套引擎全部还在。

---

## 阶段 1 — WI-0.0 chore PR（Stage 0 之前，不含产品代码）

**本阶段状态：🔄 部分完成**（提交 `d6d8f38` + `16fb45c`，分支 `frontend-backend-redesign`）。
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

**本阶段状态：🔄 部分完成**（2.1 提交 `e021f47`；2.2 + 2.3 提交 `a9be7b3`；2.4 在**本提交**完成并验证，余 2.5。分支 `frontend-backend-redesign`）。
SHA 无法在它自己的提交里自引用，故每步的 SHA 记在紧随其后的提交中。
2.2 与 2.3 **合并为一个提交**：行 2.2 直接援引 E26，而 E26 要求「补表征测试」与「删被取代的断言」落在同一提交；
这与本文档「每步独立提交」的通则冲突，按「原计划优先」的规则以 E26 为准。

| # | 状态 | 任务 | 注意 |
|---|---|---|---|
| 2.1 | ✅ | `mathRender.ts` **先**搬出 `src/components/Preview/` → **`src/services/mathRender.ts`** | HTML 导出在用它，先搬再删。落点与 `highlightSyntax.ts`、`sanitizerPolicy.ts` 并列 —— 三者同为导出管线的 HTML 后处理，`exportService.ts` 以 `./` 同级引入 |
| 2.2 | ✅ | 为存活面（`MilkdownEditor.css`、`html_template.rs`）补行为表征测试 | E26：迁移与删除在**同一提交**。Milkdown 面走 jsdom 计算样式（L3，8 组 `{center,right,left,absent}×{th,td}`）；导出面改为在 `html_template.rs` 自己的 `mod tests` 内断言 `build_html` 的**返回文档**（L2 + 跨面 L4 往返），不再跨语言 grep `.rs` 源码。**已知缺口**：jsdom 26 完全不实现 `!important`（已实测：`!important` 规则在前、同特异性普通规则在后时后者获胜），故本 lane 无法守住「给 `[align]` 规则加 `!important` 会压掉 Milkdown 的内联对齐」这一回归；原矩阵的 W1-2 用例因此**无条件通过、对被测产物零敏感**，已移入 Deferred 而非放宽断言 |
| 2.3 | ✅ | 删 `tests/table-alignment-rendering.test.ts` 中读取 `preview.css` 的断言，并**写明退役的是哪条已不存在的产品契约** | 不得声称被另一测试等价覆盖 —— 新表头明确写「nothing here replaces it」。顺带修正表头既有失实描述（原称 Preview 管线「tested via the marked fallback path」，实际并无此测试） |
| 2.4 | ✅ | 删 `Preview.tsx`、`ImageRenderer.tsx`、`usePreview.ts`、`preview.css` | 四文件已删（`git rm`），`src/components/Preview/` 目录随之消失；删前已核实无任何 import，preview.css 的四个类名（`.preview-body/-content/-loading/-image--error`）在目录外零引用。**计划原记的 `markdown.rs:661-664` 漏了一处**：失实描述实为**两处**，`:659` 的「exported HTML **and from the in-app preview**」同属三管线旧说法。改写时避免了一个**新**错误 —— 不能把「三管线」简单改成「WYSIWYG + 导出」：这条 Rust 通路**只喂导出**，WYSIWYG 从不经过它（Milkdown 自行解析，gfm preset 以内联样式设对齐，`MilkdownEditor.css` 是平行的另一套规则）。规则 22：三处 `@coordinates-with`/文档引用同提交更新（`useMilkdownLinkClickGuard.ts:9`、`mathRender.ts:20`、`imagePathUtils.ts:9`），并修正 `table-alignment-rendering.test.ts` 表头时态。**本步新发现的遗留（未擅自处理）**：① `renderMathInContainer` 失去唯一生产调用方，仅余 `tests/math-render.test.ts` 覆盖，已在 `mathRender.ts` 内记 NOTE，是否删除属范围决策；② `--color-preview-bg` 成为只定义不读取的孤儿 token（`globals.css`/`light.css`/`dark.css`）；③ `highlight.js` 在 `src/` 内失去最后一个 importer，`package.json` 仍留该依赖。覆盖率因移除未覆盖文件而**上升**：31.53/62.05/82.36/31.53（前值 31.18/61.57/82.15/31.18），阈值未动 |
| 2.5 | ⬜ | 修 CLAUDE.md 失实描述（数学/脚注实际只在导出，不在 Preview） | 前置警告**已解除**（2.4 时实测）：CLAUDE.md 为完整 351 行，未被截断；目标段落在**第 338 行**原样存在 ——「**canonical Rust render surface** — i.e. the Preview pane and HTML export」。2.4 已删除 Preview，该句须改为仅指导出面 |

**不在本 PR**：`marked` 降级移除（带独立回归测试的行为变更，单独交付）；`toc.rs` / `preview_html`（留到阶段 5）。

**不要指望**：删 Preview 并不能让 Stage 2 死代码守卫退役 —— 它还覆盖 `src/App.css` 与 `src/components/TabBar/`，
A8 也还登记着其他候选。C 只缩小 A8，不消灭整个例外机制。

---

## 阶段 3 — M 提前交付：标题身份契约 + TOC 切换

| # | 任务 | 说明 |
|---|---|---|
| **3.0** | **M 阶段 0：冻结契约** —— 语法矩阵、代表性语料、安全样例、性能基线 | ⚠️ 语料**必须先于 3.3 就位**（见问题 ②） |
| 3.1 | 确立三概念身份模型：`anchorSlug` / `headingKey` / 位置 | 不让一个 `id` 同时承诺三种稳定性 |
| 3.2 | 修 `generateUniqueId` 两类碰撞 —— **两个面同时修**（`tocService.ts` 与 `exportService.ts` 中的实现逐字节相同） | 后缀碰撞 `x, x-1, x-1`；fallback `"heading"` 从不注册 |
| 3.3 | 用共享 remark 配置替换正则解析器 | 覆盖围栏、Setext、格式化标题、重复、CJK、emoji |
| 3.4 | 位置映射：UTF-16 offset + 行号；修 CRLF 每行少算 1 | `text\r\n# 标题` 应为 6 而非 5 |
| 3.5 | 身份协调：`tocStore.setEntries` 保留折叠态与活动项（**从 WI-4.26 移入**） | |
| 3.6 | 真实导航：修 `useTOC` WYSIWYG 首个命中即 `break` | 点第二个重复标题必须到第二个 |
| 3.7 | 三层测试：协调算法单测 / 语义契约测试 / **用户行为测试** | 第三层不可省 |
| 3.8 | 大文档性能验收：切文档、关文档、过期解析结果 | P 的「零额外 React commit」**不能**替代 |

**身份契约至少要规定**：标题前后编辑普通段落 → 折叠状态保留、位置更新；重复标题彼此独立；
删除标题 → 清理其折叠与活动状态；切换文档 → 清空状态，不因两个文档都有 `intro` 而继承；
无法可靠匹配 → 重置而非猜测转移；重命名/插入/移动的保留规则明确写死，不默认承诺任意编辑后无损识别。

**边界**：`App.tsx` 只许改自身所需的接线（文档 id、修订号），不夹带布局或生命周期重构。

**必须登记**：导出此时**仍是旧语义**，该中间状态进语法矩阵，对外**不得宣称「语义已统一」**。
共享 remark 配置与 Milkdown 实际插件集合也需一致性验证。

---

## 阶段 4 — 计划 P 主体

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

| # | 任务 |
|---|---|
| 5.1 | M 阶段 3：TS 导出并行验证（MDAST→HAST→HTML，以旧 Rust 输出为差异参照，**ammonia 保留**） |
| 5.2 | 移除 `marked` 导出降级（改显式报错 + 重试）—— 独立交付 |
| 5.3 | M 阶段 4：切换并移除 pulldown-cmark；退役 `toc.rs`、`preview_html` |
| 5.4 | M 阶段 5：编辑保真分级推进（⚠️ 已保存数据的损失无法靠代码回滚恢复） |
| 5.5 | M 阶段 6：**仅当** TS 净化覆盖全部出口且安全评估通过，才评估删 ammonia |

---

## 贯穿全程的门禁

- **G0 在每个工作项末尾和每个阶段末尾都跑**（唯一的带标号门禁，无 G1/G2）：
  build / test / cargo test / 文件集越界 / 无新依赖 / 无截图 / coverage /
  Milkdown 浏览器套件 / 性能确定性断言 / 未提交未推送。
  FPS、堆、毫秒级阈值**永远不进 G0**。
- **五个停止点**：Stage 0、2、3、4、5 结束 —— 发停止报告，提交拆分方案，
  **等用户明确回复才能开始下一阶段**。

---

## 三个两个计划都未记载的问题

**① WI-4.21 依赖一个不存在的 ESLint —— 这是真正的跨计划缺口。**
WI-4.21 要加 `no-restricted-syntax` lint 规则，WI-4.26 收窄后**剩下的验收之一**
就是「WI-4.21 的 lint 规则拒绝 `useTOC.ts` 的零参数调用」。但实测 HEAD：
无 eslint 配置文件、`package.json` 中 eslint 出现 0 次、无 `lint` script。
M 把 ESLint 列为「与 P0 无关的独立改进项 P1」，P 则默认它存在。
**建议并入阶段 1 的 chore PR** —— 那里已经在动 `package.json` 和测试工具链，且它是 WI-4.21 的硬前置。

**② 阶段 3 的语料不是「选一个」，是「从零建」。**
M 的待决问题 4 把 `tests/image-test/` 当候选，但它**未被跟踪**，内容只有 `quick-test.md` 和 `assets/`。
HEAD 里唯一的 fixture 是 `tests/render-fixtures/phase1.json`。
M 的第二层「语义契约测试」完全依赖这份语料，所以 3.0 是一个实打实的构建任务，不是筛选任务。

**③ 标题契约的既有测试网几乎为零，这是双刃的。**
HEAD 的 `tests/` 里只有 `cjk-slug.test.ts` 碰 slug，而它恰恰是**把缺陷钉死**的那个文件。
没有 TOC 测试文件，没有 heading 测试文件。好处是回归风险小；
代价是阶段 3 必须自带全部表征测试，没有现成安全网可继承。
