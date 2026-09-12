# 提案：用 knip 建立「可达性分类」而非「死代码清单」

**状态**：提案，未实施
**修订**：v2，按 codex 评审重写。v1 的命名与结论强度被判定为不安全，见 §8。

**由来**：阶段 2.1–2.5 的清理全靠人工 grep。2.4 我据此断言
`renderMathInContainer`「失去唯一生产调用方」，写进了代码注释**和**计划文档，
并据此获得了删除批准。该判断是错的且自相矛盾——`prerenderMathForExport` 就在
六行之下调用它，它一直在 HTML 导出的活通路上。删掉会静默破坏导出的数学公式。
（`0ca5a41` / `7e42ae9` 已撤回。）

**本提案的目标不是「清得更干净」，而是让「某处代码是否还活着」这个判断
不再依赖人的记忆和措辞。**

---

## 1. 核心发现：knip 的默认配置查不出 2.4 那一类问题

| 变体 | 配置 | 结果 |
|---|---|---|
| A | `entry` 中不含 `tests/**` | 与 B **逐字节相同** |
| B | `entry` 中含 `tests/**` | 与 A 逐字节相同 |
| C | `"vitest": false` + `"ignore": ["tests/**"]` | 额外报出 `renderMathElement`、`renderMathInContainer`、`tabStore.ts` |

A 与 B 相同不是巧合：**knip 内置的 vitest 插件会把 `tests/**` 自动加回 entry，
静默覆盖我在 `entry` 里的设置**。必须整个关掉插件才能改变入口图。

结论：只要一个符号还有测试在调用，默认配置就判定它「在用」。
**因此必须跑两次 knip——但必须只产出一份报告。**

---

## 2. 两次执行，一份分类报告

v1 打算发布两份平级报告。这是错的：两份对等报告本身就是误读的温床。

设：

- `A` = 生产代码与测试**都**作为入口时的发现
- `B` = **仅**生产代码作为入口时的发现
- `B − A` = 其外部消费者局限于测试的导出

**`B − A` 并不意味着实现是死的。** 它的准确含义只有一句：

> 该 export 对生产模块图不是必需的；测试*可能*是唯一的外部 importer。

这正是 `renderMathInContainer` 的情形：**实现通过模块内调用保持存活**，
只是它的**导出可见性**可能仅为测试而存在。

### 2.1 分类词表（强制）

**禁止使用 `orphan` / `zombie` / `dead` / `delete list` / 「孤儿」/「僵尸」。**
这些词把结论偷运进了观察里——v1 的标题就犯了这个错。

| 分类 | 证明了什么 | 允许的默认动作 |
|---|---|---|
| `unreachable-candidate` | knip 未找到任何已配置的 TS 入口路径 | **调查可达性** |
| `test-exposed-api` | 无生产外部 importer；测试在 import 它 | **收窄或论证可见性** |
| `unused-dependency` | 无已配置的静态包引用 | 检查工具链/配置/运行时加载 |
| `unused-file` | 无已配置的静态 importer | 检查动态/配置/运行时入口 |

**`unreachable-candidate` 也不等于可以安全删除。** 静态分析看不见：
动态 import、运行时注册、Tauri 配置、IPC 字符串契约、生成代码、
**CSS-only 关系**、以及外部消费者。

---

## 3. 把区分编码成机器可读的策略（本提案最关键的一节）

不要依赖文档和命名来传达这个区分——那正是 v1 的做法，也正是 2.4 失败的方式。
报告必须是一份 schema 受限的产物，由 schema 限定允许的动作：

```json
{
  "symbol": "renderMathInContainer",
  "classification": "test-exposed-api",
  "observation": {
    "productionExternalImporters": 0,
    "testExternalImporters": 1,
    "internalProductionReferences": 1
  },
  "productionReachability": "confirmed-live",
  "allowedDefaultAction": "review-export-visibility",
  "prohibitedInference": "implementation-is-dead",
  "candidateActions": [
    "remove-export-and-test-through-public-api",
    "move-test-to-module-local-test",
    "retain-export-with-justification"
  ]
}
```

生成脚本必须带一条不变量：**任何情况下不得自动输出
`delete`、`dead function`、`safe to delete`**。

Markdown 报告对应段落的标题强制为：

> `TEST-EXPOSED API — NOT A DELETION LIST`

CI 措辞强制为：

> 检测到新的 test-exposed API。**这不代表该实现未被使用。**
> 请选择：改为通过生产 API 测试／收窄可见性／登记豁免理由。

可选的前瞻性防护：一条 ESLint 规则，禁止生产模块导出「仅被测试 import」的符号，
并为有意保留的测试缝隙提供显式 allowlist。但跨图条件 ESLint 表达不完整，
**权威判定仍是上面的 knip 比对脚本**。

---

## 4. 门禁：ratchet，而不是「第一天不设门禁」

v1 说「不接 CI 门禁」。这只在**有 owner 且有到期条件**时成立，
否则它会烂成没人看的装饰性噪音。baseline 稳定后引入 ratchet：

- 新增 unused file → 失败
- 新增 unused dependency → 失败
- 新增 test-exposed export 且未登记豁免 → 失败
- **不**因存量 baseline 仍然存在而失败
- **不**自动要求删除任何一条发现
- baseline 增长，或某条目在无对应代码/配置改动的情况下消失 → 失败
- baseline 缩减单独汇报，不作为门禁

豁免必须是结构化条目，**裸 ignore glob 不合格，因为它销毁证据链**：

```json
{
  "path": "src/example.ts",
  "reason": "由运行时注册表按 Tauri 事件名加载",
  "evidence": "注册位置或配置路径",
  "owner": "editor",
  "reviewAfter": "2026-12-01"
}
```

---

## 5. 已核实的发现与裁决

每一条都经 grep 独立验证，未直接采信 knip。

### 5.1 `src/components/Editor/plugins/inlineEditPlugin.ts` — 建议删除

6 行再导出 shim，**文件第 1 行自述**
`TODO(003-redesign-plugin-system): Deprecated. Use src/plugins/milkdown/inlineEditPlugin.ts instead.`
真实消费者（`plugins/index.ts:9`、`MilkdownEditor.tsx:24`）全部直接 import
`plugins/milkdown/inlineEditPlugin.ts`。自述废弃与零 importer 两项证据一致。
**删除前仍需确认**：无动态/配置化 import，无对外兼容承诺。

### 5.2 `src/components/Editor/extensions/` 五文件 — 建议整体删除

`heading` `highlight` `link` `widgets` `wysiwyg`。对外 0 引用；
唯一内部边是 `wysiwyg.ts:6 → ./widgets`，而 `wysiwyg.ts` 自身无 importer。
对照组 `dynamicExtensions` / `markdown` / `search` / `syntax` 均由 `Editor.tsx` 引用，仍在用。

**必须作为一个图连通分量整体删除，不是五个独立文件**——逐个删会在中间状态留下
悬空引用。删除前确认无动态注册表或生成式 import，并确保四个存活兄弟文件不被波及。

### 5.3 `src/components/TabBar/` + `src/stores/tabStore.ts` — **暂不批准删除**

静态证据指向「被取代的实现」：

- `BottomTabs` 才是活的文档标签栏：`App.tsx:8` 导入、`App.tsx:1150` 挂载，
  props 为 `documents` / `activeDocumentId` / `onSelect` / `onClose` / `onNewDocument`
- `App.tsx` 中**不存在**对 `TabBar` 或 `tabStore` 的任何引用
- `tab.open` / `tab.close` / `tab.switch` 在 `tabStore.ts`（166/211/242/310）与
  `documentStore.ts`（34/51/91）各有一份，活代码走 `documentStore`

**但仍不批准删除**，原因有二：

1. **尚未完成运行时验证**——没有实际跑起来证明哪一个实现挂载。
2. **风险等级高于其余三项**：标签涉及选中态、脏文档、关闭行为，属数据丢失范畴。

删除前必须补的调查步骤：检查路由表、懒加载、插件注册表、组件映射表、
Tauri 事件、菜单 action 分发、feature flag、配置驱动加载；然后实跑验证
open / switch / close / dirty-close / restore / overflow 六种行为。

> React 组件可以活着却对静态分析不可见的途径包括：`React.lazy` 与计算式动态
> import、组件注册表与查找映射、插件系统、路由/配置驱动的组件选择、
> barrel 再导出加别名、生成式 import、按字符串选择行为的 Tauri/浏览器事件、
> 运行时 loader、以及经由工厂或依赖注入间接创建的 JSX。
> **CSS 选择器和日志事件名只能证明某个行为存在，不能证明某个组件实现了它。**

### 5.4 `@types/katex` — 大概率可删

`node_modules/katex/katex.d.ts` 存在，说明 katex 自带类型声明。
属**依赖清理**，不是可达性问题。定论方式：移除后跑 `pnpm build` 与
`pnpm typecheck:tests`，绿则删。

### 5.5 暂不处理，仅建 baseline

23 个 unused exports + 22 个 unused exported types，绝大多数是可见性冗余。
其中 `Sidebar/index.tsx` 导出 `Sidebar` / `TOCSidebar` 无人使用，形态与 TabBar 相似，
值得单独排查，**不纳入本提案**。

### 5.6 三个死 IPC 面 —— 但 **`export_html` 不批准删除**

阶段 3 的标题身份语料（计划 M，`c17c003`）附带测出三个零调用方的 IPC 面。
按 §8 要求的证据格式登记 **[实测] 2026-09-12**：

```text
主张：以下三者无生产调用方
生产入口点定义：src/App.tsx 及其可达模块图；src-tauri/src/commands/mod.rs 的 handlers()
符号引用：
- export_html
  - 定义：          src-tauri/src/commands/export.rs:42
  - 注册：          src-tauri/src/commands/mod.rs:17
  - TS wrapper：    src/services/exportService.ts:109（invoke 在 :114）
  - 内部引用：      无
  - 外部生产引用：  无（`exportHtml` 全仓库仅两处命中：定义 :109，及 :121 的一句文档注释）
  - 测试引用：      无
- preview_html
  - 定义：          src-tauri/src/commands/export.rs:125
  - 注册：          src-tauri/src/commands/mod.rs:19
  - TS wrapper：    src/services/exportService.ts:134 `previewHtml`（invoke 在 :135）
  - 内部引用：      无
  - 外部生产引用：  无（`previewHtml` 全仓库仅命中定义本身）
  - 测试引用：      无
- 动态/配置/IPC 检查：两个命令名在 TS 侧仅出现于上述 wrapper 的字符串字面量；
  唯一上游 `usePreview` 已在阶段 2 死代码清理中删除（计划 M §2.4）
结论：三者静态不可达；但 export_html 的裁决不是「删」——见下
```

这正是 §7 描述的情形：**一个 Rust command 仅因唯一调用方是 TS 里的一个字符串而显得「未使用」**，
必须两侧合看，不能采信任一侧工具的单独输出。

**裁决分两半：**

- `preview_html` + `previewHtml`：与计划 M §2.4「Preview 面板已死」一致。
  但计划 M 已将其退役排在**第 5 步**且明确不提前，故本提案只**登记进 baseline**，不主张现在删。
- `export_html` + `exportHtml`：**明确不批准删除，理由与可达性无关。**
  它是全仓库**唯一保留全部标题锚点**的导出实现 —— `sanitize_html`（ammonia）不做 DOM-clobbering 剥离，
  而活的导出路径（`App.tsx:587` → `exportRenderedHtml` → `exportService.ts:89` 的 DOMPurify）**会剥离**。
  计划 M 的「待决：导出锚点被 DOMPurify 剥离」已把改走 `export_html` 列为**选项 C**。
  **在该决策落定之前删掉它，等于删掉一个候选修复方案。**

⇒ 本条是 §2.1 词表存在理由的一个实例：`unreachable-candidate` **不等于**可删除。
这里的阻断理由既不是动态 import，也不是运行时注册，而是**一个尚未做出的设计决策** ——
静态分析在原理上看不见这一类。建议按 §4 登记结构化豁免：

```json
{
  "path": "src-tauri/src/commands/export.rs::export_html",
  "reason": "唯一保留标题锚点的导出实现；是计划 M 的 DOMPurify 锚点剥离决策的候选方案 C",
  "evidence": "docs/plans/20260912-plan-markdown-source-consolidation.md 「待决：导出锚点被 DOMPurify 剥离」",
  "owner": "export",
  "reviewAfter": "WI-3.2 决策落定"
}
```

**附带发现（与 §6 的「治理文档正在描述一个已死的组件」同类）**：
`src-tauri/src/services/html_template.rs:293` 的注释写着
`Cross-surface agreement over the ACTUAL export path: export_html`，**该断言已失实** ——
实际导出路径是 `export_rendered_html`。但缺陷**仅限命令名**：该测试的断言目标
`build_html` 确实在活路径上（`export.rs:161` 由 `export_rendered_html` 调用），**测试本身依然有效**，
不属于「测试在表征一条死路径」。按规则 22 不做顺手改动，留待下次真正编辑该文件时同提交修正。

---

## 6. 本提案自身的两个盲区

**其一：knip 不分析 CSS。** 删除 `TabBar/` 会在 `globals.css` 留下约 12 行
无消费者的样式规则，两次执行都看不见。即本提案推荐的删除动作会制造出
本提案检测不到的无引用代码。
**每个删除 WI 必须手工附带一个 CSS 清理步骤**，并检查该组件独占的样式与文档。

附带发现：`.claude/rules/32-component-patterns.md:106` 记录了
`.tab-bar__scroll-container` 这一「标签栏水平滚动条」例外，而该类名只存在于
`globals.css` 与 `TabBar.tsx`——**治理文档正在描述一个已死的组件**，
与阶段 2.5 清掉的九条失实声明同类。同段 76 行的 `.tab--active` 无问题
（`BottomTabs.tsx` 确实在用）。

**其二：knip 只看 TypeScript 一侧。** 见下节。

---

## 7. TS 与 Rust：不要合并成一张图

Tauri IPC 通过 command/event 名称、序列化、配置与生成绑定跨越边界，
**不要尝试自动合并可达性图**。改为维护契约清单并对不变量设门禁：

```text
前端 invoke / 事件收发
        ↕ 精确的 command 或 event 标识符
Rust 注册 / handler
        ↕ 对应的 capability 权限
两侧各自的测试
```

- 每个前端 `invoke("command_name")` 都有已注册的 Rust command
- 每个已注册 command 要么被调用，要么是有意对外暴露，要么登记豁免
- 每个 emit / listen 的事件都有成对的对侧
- capabilities 与 command 暴露面一致
- 重命名必须同时更新两侧
- 测试引用生产契约常量或生成绑定，**不复制字符串字面量**

没有这一层，**一个 Rust command 会仅仅因为唯一调用方是 TS 里的一个字符串
而显得「未使用」**；反之一个前端 IPC wrapper 也会在其 Rust handler 已消失时
仍显得存活。

Rust 侧工具：`cargo check` 的 `dead_code` 警告、clippy、
`cargo udeps`（通常需 nightly，可放定时任务）。

工具选型：knip 作为 TS 侧主工具是合适的（`ts-prune` 偏窄且仅面向导出；
`madge` 适合模块图与环检测，不覆盖 unused files/exports/dependencies；
ESLint 擅长局部词法问题，不建模全程序入口可达性）。
但 **knip 的插件行为必须锁版本并加以验证**——vitest 插件这次的静默覆盖就是证据。

---

## 8. 流程改动：写下「无生产调用方」之前必须附证据

这是本提案中**唯一能预防（而非事后发现）2.4 那类错误**的条款。

任何人（含 AI agent）在声称某符号「无生产调用方」之前，必须附上一份
**带行号的调用方清单**，且把每个引用分类：

```text
主张：无生产调用方
生产入口点定义：[...]
符号引用：
- 定义：           file:line
- 内部引用：       file:line
- 外部生产引用：   无
- 测试引用：       file:line
- 动态/配置/IPC 检查：[...]
结论：[...]
```

**我当初那句话会在「内部引用」这一行当场失败**——`prerenderMathForExport`
就在六行之下。

核心规则：

> **绝不从「缺少外部 import」或某条 unused-export 发现，推断实现已死。**
> 必须先把每个引用归类为：内部生产 / 外部生产 / 测试 / 配置运行时 / 仅定义。

此外，**删除提案必须点名一个行为级测试**，用以证明没有移除任何用户可见路径。
对 `renderMathInContainer` 而言，一个包含数学公式的 HTML 导出测试，
即便有人再次误读符号图，也会当场暴露它仍然活着。

---

## 9. 落地步骤

1. `pnpm add -D knip`，**锁定版本**。
2. 写两份 config（两次执行），外加一个比对脚本产出**单一分类报告**
   （§2.1 词表 + §3 schema + 禁用词不变量）。
3. 全部现存发现写入 baseline。
4. 先 report-only，但**指定 owner 与到期日**，到期后启用 §4 的 ratchet。
5. §5 的删除**不属于本提案**，各自作为独立 WI 走 tdd-guardian，
   且每个 WI 附带 §6 的 CSS/文档清理步骤与 §8 的证据清单。

## 10. 验收

- 两次执行产出**有差异**的输入，并归并为**一份**分类报告。
  若两次输出相同，说明 vitest 插件又把 `tests/**` 加了回去、配置无效——
  **这正是 A/B 变体最初失败的原因，必须作为一条显式断言来验证。**
- 报告中不出现任何禁用词（`delete` / `dead` / `safe to delete` / 孤儿 / 僵尸）。
- baseline 建立后空跑一次应为 0 新增发现。
