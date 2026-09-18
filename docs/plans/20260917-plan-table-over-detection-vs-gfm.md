# Plan: 源码模式表格「过度识别」（缺陷 C）—— 对照 GFM 参考解析器的调查与修法

Investigated on 2026-09-17 against `micromark-extension-gfm-table@2.1.2`
Branch: `frontend-backend-redesign`
Repo: anzchy/mdpro
Status: DRAFT（只读调查已完成，**未动任何源码**；待批准后进入实现）
上游记录：[ADR-0008](../adr/0008-non-candidate-delimiter-class-measured-against-gfm.md)
§ Consequences 「A new defect is on record with no owner and no plan」

---

## 证据分级约定

沿用[计划 M](./20260912-plan-markdown-source-consolidation.md) 的约定，**不把推断和实测混为一谈**：

| 标记 | 含义 |
|---|---|
| **[实测]** | 本次实际跑过代码核对，附 `file:line` 与实际输出 |
| **[推断]** | 由实测事实推导，未直接验证 |

本次实测方法：把 `src/utils/tableParser/` 与 `tests/support/tableCorpus.ts`
用 `esbuild --bundle --platform=node` 打进临时目录，与 `unified + remark-parse +
remark-gfm`（解析到 `micromark-extension-gfm-table@2.1.2`，经
`node_modules/.pnpm/micromark-extension-gfm@3.0.0` 确认）在同一进程里跑同一批
输入，逐条比对 `table` 节点数与起始 offset。**全部产物落在 scratchpad，仓库未被修改。**

> **为什么 2.1.2 是对的参考。** `package.json:49` 的 `overrides` 把
> `micromark-extension-gfm-table` 钉到 `>=2.1.2`（ADR-0006），而 WYSIWYG 面经
> `@milkdown/preset-gfm` → `remark-gfm@4.0.1` → `micromark-extension-gfm@3.0.0`
> 走的正是这一份。**[实测]** 所以它不是「某个第三方解析器」，它就是 mdpro
> 自己另一半的解析器——两面不一致时，它是对的那一面。

---

## Problem Statement

mdpro 的源码模式表格探测器**比 GFM 多认表**。多认出来的「表」不是只影响显示：
**四条写入链路会把它当成真表重排**，其中两条不需要用户确认，一条直接落盘。

本次实测证实了 ADR-0008 记下的两种形态，**并推翻/收窄了其中一条描述，另外查到
第三种形态和一类方向相反的漏认**。最重要的一条结论先说：

> **[实测]** `delete_row(tableIndex: 0, index: 0)` 作用在一个幻影表上，会把原文
> **静默删掉**，不报错、不提示、不询问。

---

## Part 1 — 实测证据

### 1.1 对照表 **[实测 2026-09-17]**

`mdpro` 列 = `scanTables(linesFromString(src))`（无 `isFenced`）；
`GFM` 列 = remark-gfm 语法树里 `table` 节点数。

| # | 输入 | GFM | mdpro | 判定 |
|---|---|---|---|---|
| S1 | `\| a \|` / `---` / `\| b \|` | **0**（`---` 是 setext 下划线，`\| a \|` 成 `<h2>`） | 1 | **发散** |
| S1′ | `\| a \|` / `----` / `\| b \|` | 0 | 1 | **发散** |
| S1″ | `\| a \|` / `   ---`（1–3 空格） / `\| b \|` | 0 | 1 | **发散** |
| S1‴ | `\| a \|` / `---`（无正文行） | 0 | 1 | **发散** |
| **S1-neg** | `\| a \| b \|` / `---` / `\| 1 \| 2 \|` | 0 | **0** | **一致** ← 见 §1.2 |
| S2 | `\| a \| b \|` / `    \| - \| - \|`（4 空格） / `\| 1 \| 2 \|` | **0**（整段是一个 paragraph） | 1 | **发散** |
| S2′ | 同上，前置空行 | 0 | 1 | **发散** |
| S2″ | 同上，前面接一段 prose | 0 | 1 | **发散** |
| S2‴ | 5 空格缩进分隔行 | 0 | 1 | **发散** |
| **S3** | `\| a \| b \|` / `\t\| - \| - \|`（**Tab**） / `\| 1 \| 2 \|` | **0** | 1 | **发散（新）** |
| **S3′** | `\t\| a \| b \|`（**表头**缩进 Tab） / `\| - \| - \|` / `\| 1 \| 2 \|` | **0** | 1 | **发散（新）** |
| **U1** | `\| b0 \| b1 \|` / `\| h0 \| h1 \| h2 \|` / `\| :-- \| :-: \| :-- \|` / `\| r0 \| r1 \| r2 \|` | **1**（offset 12） | **0** | **反向漏认（新）** |
| **U2** | `> \| a \| b \|` / `> \| - \| - \|` / `> \| 1 \| 2 \|` | **1** | **0** | 反向漏认（已知范围外） |
| A1 | `\| a \|` / `:-:` / `\| b \|` | 1 | 1 | 一致 |
| A2 | `\| a \| b \|` / `--- \| ---` / `\| 1 \| 2 \|` | 1 | 1 | 一致 |
| A3 | 3 空格缩进分隔行 | 1 | 1 | 一致 |
| A4 | 普通表 | 1 | 1 | 一致 |
| F3 | ADR-0007 的重叠夹具（S2 拼两次） | **0** | 1 | 发散（ADR-0008 已记） |

任务书里给的五行全部复现，一行不差。以下三条是任务书/ADR-0008 **没有的**。

### 1.2 修正一：形态 S1 只在**单列**时触发 **[实测]**

`\| a \| b \|` / `---` / `\| 1 \| 2 \|` 两边都是 0 表。原因在
`src/utils/tableParser/parse.ts:141`：

```ts
if (headerCells.length === 0 || headerCells.length !== delimCells.length) {
```

`splitCellTexts("---")` 只产 1 个 cell（`lines.ts:254-286` 只按 `|` 切），表头有 2
个，数量不等直接 `return null`。**一个没有管道符的分隔行永远只有 1 列**，所以：

> **S1 ⟺ 表头恰好 1 列，且分隔行是纯短横线段。**

这是个实质收窄——`:-:`、`--:`、`:--` 都含冒号，都是**真** GFM 分隔行，两边一致
（**[实测]** 三条都是 `gfm=1 mdpro=1`）。真正越界的只有「纯 `-`」这一种，因为它
和 setext 下划线**字面撞车**，而 setext 赢。

顺带一条：语料 `tests/support/tableCorpus.ts` 的 `ncdPipeless` 维度用
`count(2, 3)` 列数配 `pick(["---", ":-:", "----"])`，**三分之二的抽样会被 `:141`
的列数检查挡掉**，只有 `:-:` 那支能产出表——而那一支和 GFM 一致。也就是说
**这个语料维度几乎生成不出 S1**。

### 1.3 修正二：还有第三种形态——**Tab 缩进**，且 ADR-0008 提的修法盖不住它 **[实测]**

ADR-0008 把成因归给「`isDelimiterLine` 先 trim」。这对 S2（空格）成立，但 S3 是
**另一个机制**：

```ts
// src/utils/tableParser/lines.ts:211-215
export function countLeadingSpaces(s: string): number {
  let n = 0;
  while (n < s.length && s[n] === " ") n += 1;
  return n;
}
```

只数 U+0020。CommonMark 里一个 Tab 推进到下一个 4 的倍数，所以 `\t| - | - |` 的
缩进是 **4**，GFM 判为段落续行；而 `countLeadingSpaces` 返回 **0**，
`isTableCandidateLine`（`lines.ts:202-208`）的 `MAX_INDENT` 检查**根本没触发**。

后果有两层，第二层更重要：

1. `isDelimiterLine` 的 `.trim()`（`lines.ts:240`）把 Tab 也吃掉了，所以
   **只给 `isDelimiterLine` 加 `MAX_INDENT` 守卫并不能修掉 S3**。
2. Tab 缩进的**表头**（S3′）也会被 `isTableCandidateLine` 放行。这条完全在
   ADR-0008 描述的机制之外——它不是「分隔行逃掉了邻居守的规则」，而是**那条规则
   本身量错了**。

> **[实测]** 把 `countLeadingSpaces` 换成 Tab 感知的列数计算后，S3 与 S3′ 同时消失。

### 1.4 修正三：反向还有一类**漏认**，很可能比过度识别更常见 **[实测]**

`parseTableAtLine` 先向上走到候选行段（run）的第一行，再要求下一行是分隔行：

```ts
// src/utils/tableParser/parse.ts:127-131
let headerIdx = lineIdx;
while (headerIdx > 0 && isTableCandidateLine(src.line(headerIdx - 1))) {
  headerIdx -= 1;
}
if (!isTableCandidateLine(src.line(headerIdx))) return null;
```

表头**只能是 run 的第一行**。但 GFM 允许表格**打断段落**：

```
| b0 | b1 |            ← 普通段落行（含管道符）
| h0 | h1 | h2 |       ← GFM 从这里开表（offset 12）
| :-- | :-: | :-- |
| r0 | r1 | r2 |
```

**[实测]** `gfm=[12]`，`mdpro=[]`——整张真表被丢掉。配合 `scan.ts:139-142`
「这个 run 开不出表就整段跳过」的剪枝，**任何前面粘着一行含管道符文本的真表，
mdpro 一张也认不出来**。

在 200 份种子语料上按**起始 offset 逐个比对**（排除 fence 与 CRLF 维度，剩 74 份）：

| | 与 GFM 位置完全一致 |
|---|---|
| 当前实现 | **40 / 74** |
| 加上本文 §4 的两处修补 | **44 / 74** |

也就是说：**过度识别只是 34 份不一致里的一小片**，修完还剩 30 份。这个数字是本次
调查最该被记住的一条——它不改变缺陷 C 该修的结论，但它明确了「修完 C ≠ 源码面
和 GFM 对齐」。

> 语料本身是对抗性构造的，这个比例**不能**外推到真实文档。它只能用来排序：
> U1 那一类（真表被漏）在真实 Markdown 里出现的概率，肉眼看远高于 S1/S2/S3。**[推断]**

---

## Part 2 — 成因定位（逐条核对，附 `file:line`）

三种形态，**三个不同的成因**。任务书给的两条成立，第三条是本次新增。

### 2.1 S2（空格缩进）：`isDelimiterLine` 先 trim，逃掉了邻居守的规则 —— **确认** **[实测]**

```ts
// src/utils/tableParser/lines.ts:202-208
export function isTableCandidateLine(line: LineRange): boolean {
  const text = line.text.replace(/\r$/, "");
  if (text.trim().length === 0) return false;
  const indent = countLeadingSpaces(text);
  if (indent > MAX_INDENT) return false;          // ← 邻居守这条
  return hasUnescapedPipe(text);
}
```

```ts
// src/utils/tableParser/lines.ts:239-247
export function isDelimiterLine(line: LineRange): boolean {
  const text = line.text.replace(/\r$/, "").trim();   // ← 先 trim，缩进消失
  if (!text) return false;
  const cells = splitCellTexts(text);
  if (cells.length === 0) return false;
  return cells.every((c) => /^\s*:?-+:?\s*$/.test(c));
}
```

`MAX_INDENT = 3`（`types.ts:72`，注释写明「CommonMark: 4+ leading spaces is an
indented code block, not a table」）。分隔行从不走 `isTableCandidateLine`——
`parseTableAtLine` 只对它调 `isDelimiterLine`：

```ts
// src/utils/tableParser/parse.ts:133-137
if (headerIdx + 1 >= lineCount) return null;
const headerLine = src.line(headerIdx);
const delimLine = src.line(headerIdx + 1);
if (!isDelimiterLine(delimLine)) return null;
```

而向下收正文行是从 `headerIdx + 2` 起步的（`parse.ts:147`），**分隔行永远不被
候选性检查**。任务书的描述准确。

**[实测]** 谓词级验证：

| 行 | `isDelimiterLine` | `isTableCandidateLine` |
|---|---|---|
| `"    \| - \| - \|"` | `true` | `false` |
| `"---"` | `true` | `false` |
| `":-:"` | `true` | `false` |
| `"\t\| - \| - \|"` | `true` | **`true`** ← §2.3 |

### 2.2 S1（setext）：未实现的优先级规则 —— **确认** **[实测]**

`parse.ts:133-143` 整段没有任何 setext 判断。GFM 的规则是：`-+`（可带 ≤3 空格
缩进、可带尾随空格）紧跟在一个段落行之后 **就是 setext H2 下划线**，且 setext
优先于表格分隔行。由 §1.2，「无管道符且无冒号的分隔行」必然只有 1 列，所以这条
规则可以整体归约成一个字面量判断（见 §4.2）。

### 2.3 S3（Tab）：`countLeadingSpaces` 量错了缩进 —— **新增** **[实测]**

见 §1.3。`lines.ts:211-215` 数的是**字符数**而不是**列数**。

> ⚠️ **修的时候有个坑。** `countLeadingSpaces` 还有第二个调用点：
> `parse.ts:200-202` 用它算 `baseOffset = line.start + indent`，那里要的是
> **字符数**（它是 offset 算术的一部分）。把这一处也换成「列数」会让所有
> cell 的绝对 offset 全错。**必须新增函数，不能原地改语义。**

### 2.4 两条从成因导出的推论

- **模型跨度一定覆盖非表格行。** `parse.ts:169-170`：

  ```ts
  const start = headerLine.start;
  const end = src.line(endLineIdx).end;
  ```

  S1/S2/S3 里这个 `[start, end)` 都横跨了 setext 标题或缩进段落。下面所有写入
  链路替换的就是这个区间。
- **幻影表占用序号。** `scanTables`（`scan.ts:115-146`）按文档顺序产出，
  `tableIndex` 是这个数组的下标。幻影插在前面，后面所有真表的序号全部偏移。

---

## Part 3 — 影响面地图

七个面消费解析器，**四个是写入面**。ADR-0008 点名了三个（lint、MCP、光标同步），
其中两个是只读面；它**漏掉了三条写入链路**，包括唯一一条落盘的。

### 3.1 写入面（按危险度降序）

| # | 面 | 入口 | 解析调用 | 被替换的区间 | 用户损失 |
|---|---|---|---|---|---|
| W1 | **MCP 表格工具** | 外部 MCP 客户端 → `http_server.rs:986-991` → `mcp:table_action` → `useMcpEvents.ts:95` | `tableMcp.ts:128`、`:197` `findAllTables` | `tableMcp.ts:137`、`:216` `source.slice(0, table.start) + … + source.slice(table.end)` | **静默改写乃至删除正文**，无确认、无回执 |
| W2 | **保存时自动重排** | ⌘S（需开 `autoReformatTablesOnSave`） → `useDocument.ts:221-225` | `tableFormatter.ts:48` `findAllTables` | `tableFormatter.ts:52-56` 同上切片 | **改写后直接落盘**（`useDocument.ts:239-246`），且回写内存（`:249-255`） |
| W3 | **源码右键菜单 / ⌘⌥ 快捷键** | `SourceTableContextMenu/index.tsx:223`、`App.tsx:991` | `sourceTableContextMenu.ts:63` `parseTableAtOffset` | `sourceTableContextMenu.ts:97-105` `changes: { from: model.start, to: model.end }` | 在非表格文本上出现完整表格菜单（假可供性）；点任一项即重写整段 |
| W4 | **Tab / Shift-Tab 单元格导航** | `Editor.tsx:109-110, 123` keymap | `sourceTableDetection.ts:73-77` `parseTableAtOffset` | `sourceTableTabNav.ts:104-107` 在 `ctx.end` **插入** | Tab 不再缩进而是跳格；走到「最后一格」会往段落后面插 `\| \|` |

W1/W2/W3 三条替换的都是 `[model.start, model.end)`，写回的是
`serializeRows`（`serialize.ts:41-74`）**重新生成**的网格——分隔行由
`emitDelimiterRow`（`:101-115`）按 `model.alignments` 合成，**原字节一个都不留**。

### 3.2 实测：写入面确实毁内容 **[实测 2026-09-17]**

我没有采信子代理的结论，自己重跑了一遍 `applyMcpTableAction` 与 `formatAllTables`。

**输入（`docA`）**：`"Intro\n\n| a |\n---\n\n| x | y |\n| - | - |\n| 1 | 2 |\n"`
——GFM 眼里是「段落 + `<h2>` + **一张**表」。

`findAllTables(docA)` 实际枚举出**两张**：

```
[ 7, 16, rowCount 1, raw "| a |\n---" ]      ← 幻影（其实是 setext H2）
[18, 47, rowCount 2, raw "| x | y |\n| - | - |\n| 1 | 2 |" ]   ← 真表
```

一个**按 GFM 正确计数**的 MCP 客户端会认为「只有一张表，序号 0」，于是发
`tableIndex: 0`：

| 调用 | 实测结果 |
|---|---|
| `set_cell(0, 0, 0, "HACKED")` | `"Intro\n\n\| HACKED \|\n\| ------ \|\n\n\| x \| y \|…"` —— 标题被改写成表，**真表没被碰** |
| `delete_row(0, 0)` | `"Intro\n\n\n\n\| x \| y \|…"` —— **`\| a \|\n---` 整段从文档里消失** |

`delete_row` 那一条是 BLOCK 的直接证据：幻影 `rowCount` 是 1，删掉唯一一行后
`edits.ts:58-60` 的 `emit` 返回 `{ source: "" }`，于是 `[7, 16)` 被替换成空串。
**没有报错，没有提示。** 而 Rust 侧 `dispatch_table_action`
（`http_server.rs:747-835`）在发出事件后**立刻返回 202**（`:834`），前端
`useMcpEvents.ts:100-108` 拿到 `null` 也只写一行 `warn` 日志——**客户端无法区分
「被拒绝」和「已执行」**。

`formatAllTables` 同样毁内容，**不需要 MCP 参与**：

| 输入 | `formatAllTables` 实测输出 |
|---|---|
| `"\| a \|\n---\n\| b \|\n"` | `"\| a   \|\n\| --- \|\n\| b   \|\n"` —— H2 不再是 H2 |
| `"\| a \| b \|\n    \| - \| - \|\n\| 1 \| 2 \|\n"` | `"\| a   \| b   \|\n\| --- \| --- \|\n\| 1   \| 2   \|\n"` —— 4 空格缩进被抹掉 |

**缓解因素（诚实记账）**：`autoReformatTablesOnSave` 默认 **false**
（`src/types/preferences.ts:305-308` `DEFAULT_MARKDOWN_CONFIG`），是 Settings
里的显式开关；W3/W4 是用户主动触发、单个 CodeMirror 事务、⌘Z 可撤销。
**W1 和 W2 是无人值守的**，且 W2 的改写会随保存进入磁盘。

### 3.3 只读面

| # | 面 | 解析调用 | 用户看到什么 |
|---|---|---|---|
| R1 | 列数校验提示 | `lintTableColumnCount.ts:60` `scanTables` | 在非表格文本上出现黄色 gutter 三角 + 下划线「Table row has N cells but header has M.」（`:81-87`）。诊断区间由 `table.start` 推出（`:67, :71-74`），**下划线画在段落上** |
| R2 | 当前单元格高亮 | `sourceTableCellHighlight.ts:36` → `getTableContext` | `cm-table-active-cell` 底色刷在标题/段落的一段上，光标一动就跟着走 |
| R3 | 跨模式表格光标同步 | `cursorSync/table.ts:131, :170` `scanTables`；WYSIWYG 侧 `tableMilkdown.ts:40-50` 走 ProseMirror `table` 节点 | 源码面与 WYSIWYG 面**用两个解析器各自编号**。⌃2↔⌃4 切换后光标落进错的表（偏移量 = 前面幻影的个数），或静默不动（`tableMilkdown.ts:96` / `cursorSync/table.ts:172` 返回空），而 pending 槽位照样被消费 |

R3 是这个缺陷最贴 mdpro 产品定位的一条：**源码面和 WYSIWYG 面对「这里有没有表」
给出不同答案**，而 WYSIWYG 面用的正是 §0 那个参考解析器。

### 3.4 查过、确认**不受影响**的面 **[实测]**

- WYSIWYG 表格右键菜单：`plugins/milkdown/table/contextMenu.ts:36, 102` 用
  prosemirror-tables 的 `findTable`，不碰 `tableParser`。
- HTML 导出 / 渲染：Rust `pulldown-cmark`（`src-tauri/src/services/markdown.rs`）
  与 `marked` 兜底，`src-tauri/` 全树无 `tableParser` 引用。
- `src/utils/tableEdits/` 是纯函数，只返回 `EditResult`，自己不 dispatch。
- `TableInsertModal` / `insert_table`（`tableMcp.ts:57-78`）走追加，不调扫描器。
- fenced code 已被挡住：两条 MCP 路径与保存路径都传了 `makeIsFenced`
  （`tableMcp.ts:128, 197`、`useDocument.ts:224`）。

---

## Part 4 — 严重度判定

### 4.1 判定：**BLOCK**（写入面）/ **SHOULD**（只读面）

按 `.claude/rules/60-review-checklist.md` 的评级：

> **BLOCK** | Data loss, security, or silent failure | Must fix before commit

**理由（一段话）**：`.claude/rules/60-review-checklist.md` 的 Critical Pass 里
「Data Loss Paths」一条要求「Document close with unsaved changes prompts the user
— no silent discard」，本缺陷违反的是同一条原则的更强形式——**用户既没关文档也
没做任何操作，正文就被删掉了**：§3.2 实测显示，一个按 GFM 正确计数的 MCP 客户端
发出合法的 `delete_row(tableIndex: 0)`，会让一个 setext H2 从文档里整段消失，
Rust 侧已经返回 202、前端只留一行 warn 日志，客户端和用户都拿不到任何信号；同一
机制在 `autoReformatTablesOnSave` 打开时会在每次 ⌘S 把 setext 标题和缩进段落重写
成表格并**直接落盘**。这不是「诊断报错了」或「光标跳错了」这一类可观察可纠正的
偏差，而是 rubric 定义里三个 BLOCK 关键词占了两个——data loss 与 silent failure。
只读面（R1–R3）单独看是 SHOULD：它们只是显示错、跳错，用户能看见也能纠正。

### 4.2 关于「要不要现在修」的诚实补充

严重度不等于优先级，这两件事必须分开记：

- **触发概率低。** S1 要求「恰好 1 列 + 纯短横线分隔行」；S2/S3 要求 4+ 列缩进
  的分隔行。没有任何用户报告。
- **最危险的两条都有额外前置条件。** W2 需要用户主动打开一个默认关闭的开关；
  W1 需要有 MCP 客户端在驱动这个文档。
- **但 W1 的前置条件正在变成默认。** MCP 面在 feature-ledger 里是
  `MCP 驱动的表格编辑 | Shipped`（`docs/feature-ledger.md:149`）。「agent 在后台
  改文档」正是这个能力存在的理由，也正是「无人值守的静默删除」最容易发生的场景。

结论：**不是 P0 停机，但也不该继续挂在 ADR-0008 里当无主项。** 建议见 Part 6。

---

## Part 5 — 修法与代价

### 5.1 原型已跑通，两处改动 **[实测]**

我在 scratchpad 里复制了一份 `tableParser/` 打了补丁（**仓库未动**），与当前实现
和 GFM 三方对比。补丁只有两处：

**FIX-B（缩进，覆盖 S2 + S3）** —— 新增列数计算并在 `isDelimiterLine` 加守卫：

```ts
/** CommonMark indent columns: space=1, tab advances to next multiple of 4. */
export function countIndentColumns(s: string): number {
  let col = 0;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === " ") col += 1;
    else if (ch === "\t") col += 4 - (col % 4);
    else break;
  }
  return col;
}
```

- `lines.ts:205` `countLeadingSpaces` → `countIndentColumns`（**只此一处**）
- `lines.ts:239` 起，在 `.trim()` **之前**加：
  `if (countIndentColumns(rawText) > MAX_INDENT) return false;`
- **`parse.ts:201` 的 `countLeadingSpaces` 保持不变**（见 §2.3 的坑）

**FIX-A（setext 优先，覆盖 S1）** —— `parse.ts:137` 的 `isDelimiterLine` 检查之后加一行：

```ts
// 无管道符、无冒号的纯短横线段在 GFM 里是 setext 下划线，setext 优先。
if (/^\s*-+\s*$/.test(delimLine.text.replace(/\r$/, ""))) return null;
```

为什么可以无条件拒绝：`parseTableAtLine` 走到这里时，`headerIdx` 一定是一个非空
候选行（`parse.ts:131` 保证），也就是一个段落行——setext 下划线**总有段落可依附**。
而 `:-:` / `--:` / `:--` 含冒号，不匹配这个正则，真表不受影响。

### 5.2 实测：补丁修掉了什么、没修掉什么

| 夹具 | GFM | 当前 | 打补丁后 | 判定 |
|---|---|---|---|---|
| S1 / S1′ / S1″ | 0 | 1 | **0** | FIXED |
| S2 / S2‴（5 空格） | 0 | 1 | **0** | FIXED |
| S3 / S3′（Tab） | 0 | 1 | **0** | FIXED |
| F3 重叠夹具 | 0 | 1 | **0** | FIXED |
| Tab 缩进的**正文行** | 1 表 1 行 | 1 表 **2** 行 | 1 表 **1** 行 | FIXED |
| A1 `:-:` / A2 `--- \| ---` / A3 3 空格 / A4 普通表 | 1 | 1 | 1 | **未受影响** |
| U1（表格打断段落） | 1 | 0 | 0 | **没修**（§5.4） |
| U2（引用块内表格） | 1 | 0 | 0 | **没修**（设计上超范围，`index.ts:46-49`） |

语料位置比对：**40/74 → 44/74**（§1.4）。

### 5.3 代价一：修完之后，一部分「错的表」会变成「没有表」 **[实测]**

这是本次最反直觉的一条，必须写进 ADR。以种子语料第 10 号文档为例：

```
 GFM  : 表起始 [269]         ← 文末那张真表
 当前 : 表起始 [[160, 223]]  ← 一张幻影，且**不是** 269 那张
 补丁 : []
```

当前实现**本来就没认出 269 那张真表**——它认的是 160 那个幻影。原因是
`scan.ts:139-142` 的剪枝：

```ts
// No table starts this run, so no line in it can start one either
// (they all walk up to `i`). Skip the whole run.
i += 1;
while (i < lineCount && isTableCandidateLine(source.line(i))) i += 1;
```

这个断言对**当前**谓词组合成立。补丁让 run 起点的探测从「成功（产出幻影）」变成
「失败」，于是整个 run 被跳过，run 内后面那张真表也跟着丢了。

**这是把「改错表」换成「不改表」，对四条写入面是严格变安全的**（不动总比动错好），
但它是一次**用户可见的行为变化**：今天在源码模式下渲染出表格的文档，明天不再有。

### 5.4 代价二：修完之后 mdpro 仍然和 GFM 不一致

30/74 的残余不一致里，主力是 U1 那一类——**表格打断段落**。修它要动
`parse.ts:127-131` 的「表头必须是 run 第一行」假设，进而动摇
`scan.ts:139-142` 的剪枝，也就是动摇 ADR-0007 的 Decision。**本计划不碰它**，
但必须在 ADR 里写明：缺陷 C 修完 ≠ 源码面与 GFM 对齐。

### 5.5 代价三：现有测试会红，而且红的是「正确写着的」测试

这是最容易被低估的一项工作量：

- `tests/table-scan-enumeration.test.ts:206` `SCAN-noncandidate-delimiter`
  **按字面量把两边都钉死了**（`:194` 注释：「by literal, against the frozen copy
  — the divergence is pinned on BOTH」）。ADR-0008 明确说这个测试
  「remains correct as written」——它现在钉的是**当前的错误行为**，修 C 必然让它红。
  它不是写错了，它是**记录了一个即将作废的事实**，要连同理由一起重写。
- `tests/table-scan-enumeration.test.ts:271` `SCAN-oracle` 对着**冻结的旧实现
  字节副本**断言完全一致。修 C 之后这个 oracle 的语义从「重构不改行为」变成
  「这里故意改了行为」，必须显式开豁免口子，不能整体删掉。
- 语料维度 11（`ncdPipeless` / `ncdIndented`）存在的**唯一理由**就是生成这个类。
  修完之后这两支的期望值全变。而 ADR-0008 已经记下：改 `makeCorpus` 会移动
  `mulberry32` 流并让 `CORPUS_TOTAL_BYTES = 64568` 作废，**出路是另起一个带自己
  种子和字节总数的生成器**，保持 `makeCorpus` 逐字节不变。

### 5.6 两种形态该合修还是分修

**建议分成两个 WI，可以独立上线；FIX-A 更安全，先走。**

| | FIX-A（setext / S1） | FIX-B（缩进 / S2+S3） |
|---|---|---|
| 改动面 | `parse.ts` 一行 | `lines.ts` 两处 + 新函数 |
| 触发条件 | 仅单列（§1.2），最窄 | 任意列数，较宽 |
| 是否改变候选 run 结构 | **否**（`---` 本来就不是候选行） | **否**（4 空格本来就不是候选行；但 Tab 那一支**是**——S3′ 会让一个原本是候选行的表头变成非候选，run 结构**会变**） |
| §5.3 的「错表→无表」 | 会发生 | 会发生 |
| 单独上线安全吗 | **安全** | **安全，但 Tab 那一支要单独出验收用例** |

两者互不依赖，实测证明**分别打、一起打，对 §5.2 那张表的结果相同**。

---

## Part 6 — 工作项分解

> 全部落在 `frontend-backend-redesign` 分支。每个 WI 的状态在**完成并验证的
> 同一个 commit 里**回写 `docs/plans/20260912-frontend-backend-sequencing-order.md`。

### WI-C0 — 写入边界兜底守卫（**可选，但如果 C1/C2 要排到后面，就做它**）

**状态**：DONE-VERIFIED（2026-09-18）。`src/utils/tableWriteGuard.ts` +
`tests/table-write-guard.test.ts`（30 例），接入 W1–W4 共 6 个调用点。
用户选了「全修」，所以 C1+C2+C3 先落地，本项因此**不再是把 BLOCK 降成 SHOULD 的
那道闸，而是防止解析器日后再次放宽的纵深防御**——这一点写进了模块头，没有粉饰。

本条的两条验收在 C1/C2 落地后**已经不成立**，如实记录而非假装通过：

- 验收 1 失效：§3.2 的 `docA` 上幻影已经不存在，`tableIndex: 0` 现在就是那张真表，
  所以 `delete_row(0, 0)` 应该**成功**，返回 `null` 反而是错的。改为直接断言守卫
  自身的契约。
- 验收 5 失效：它预设 C0 顶替 C1/C2；实际 C3 已按授权改写了
  `tests/table-scan-enumeration.test.ts`。

**本条正文提的判据是错的，实现没有照抄**：要求「分隔行自身是
`isTableCandidateLine`」两个方向都错——单列表的分隔行可以写成没有竖线的 `:-:`，
是真 GFM 表，这条判据会**拒绝真表**（已实测：`isTableCandidateLine(":-:") === false`，
`isDelimiterLine(":-:") === true`）；而 Tab 缩进表头（S3′）的分隔行完全正常，这条
判据又**放它过去**。实现改为表头缩进 + 表头候选 + 分隔行缩进 + setext 排除 +
`isDelimiterLine` + 正文行候选。

**实测误伤率 0**：两套语料 400 篇、扣掉围栏后 81 + 127 = 208 个模型，守卫一个都没拒。
同一次测量里对 GFM 的过度识别为 **0 处 / 0 字节**（欠识别仍有 62–63 处，不影响写入）。

**做什么**：不动解析器。在**写入前**加一道拒绝：若模型的分隔行
（`model` 对应的 `headerIdx + 1` 行）自身不是 `isTableCandidateLine`，则四条写入
面一律拒绝并记日志。只读面（R1–R3）保持现状。

**为什么值得单列**：它把 BLOCK 降成 SHOULD，改动量小于 C1+C2 之和，**且不触发
§5.5 的测试重写**——只读枚举不变，`SCAN-*` 全绿。

**验收**：
1. §3.2 的 `docA` 上，`delete_row(0, 0)` 与 `set_cell(0,0,0,"X")` 返回 `null`，
   文档逐字节不变；真表（`tableIndex: 1`）仍可正常编辑。
2. `formatAllTables` 在 S1/S2/S3 三个输入上返回**与输入逐字节相同**的字符串。
3. W3 右键菜单在幻影上不再出现（或全项 disabled），W4 的 Tab 回落到默认缩进。
4. 新增 `tests/table-write-guard.test.ts`，四条写入面各一条，先红后绿。
5. 只读面行为不变：`tests/table-scan-enumeration.test.ts` 全绿，**一行未改**。

### WI-C1 — FIX-A：setext 优先于表格分隔行

**状态**：DONE-VERIFIED（2026-09-18）。`parse.ts` 一处 `isSetextUnderline` 守卫；`:-:` / `--:` / `:--` 单列表回归护栏在 `tests/table-gfm-narrowing.test.ts` 里。


**做什么**：§5.1 的 FIX-A 一行；补 `parse.ts` 的 `///` 文档说明这条优先级规则。

**验收**：
1. `parseTableAt("| a |\n---\n| b |\n", 0) === null`；`----`、` ---`、`   ---`、
   `    ---`、`--- `（尾空格）、无正文行六个变体同。
2. `:-:` / `--:` / `:--` 单列表仍返回模型（**回归护栏**，缺这条就是过度修正）。
3. `| a | b |` / `---` / `| 1 | 2 |` 行为不变（本来就是 `null`，钉住 §1.2）。
4. 新增夹具对照 remark-gfm 的期望值以**字面量**写死，并在注释里注明测量日期与
   `micromark-extension-gfm-table` 版本。
5. `SCAN-noncandidate-delimiter` 的 pipeless 半边按新行为重写，注释解释
   「这里为什么从 1 变成 0」并回链本文与新 ADR。
6. §5.3 的「错表→无表」至少有一条显式用例，**不允许当成意外**。

### WI-C2 — FIX-B：缩进按 CommonMark 列数计，Tab 一并算

**状态**：DONE-VERIFIED（2026-09-18）。缩进在 `.trim()` **之前**量，表头与分隔行都量；`countIndentColumns` / `countLeadingSpaces` 拆到新文件 `src/utils/tableParser/commonmark.ts`，两者只差一次误换就会让 Tab 缩进行的每个单元格偏移，文件里写了「不要互换」的告警。

两条验收当时判定为**写不出来**，如实上报而非造假：(a) `parse.ts:201` 的 baseOffset 陷阱原理上真实，但 FIX-B 之后能走到 `parseRowCells` 的行缩进都 ≤3 列且不可能含 Tab，观察不到；(b)「带 Tab 缩进正文行的真表」在 FIX-B 之后不存在，于是 `NARROW-cell-offsets` 改钉可达的最大缩进，外加一条 `countIndentColumns("\t") !== countLeadingSpaces("\t")` 的直接断言。


**做什么**：§5.1 的 FIX-B。**`parse.ts:201` 不动**（§2.3 的坑，在 PR 描述里点名）。

**验收**：
1. S2（4 空格）、S2‴（5 空格）、S3（Tab 分隔行）、S3′（Tab 表头）四条都返回
   `null` / 0 表。
2. A3（3 空格）仍返回模型（**边界护栏**：3 过、4 不过）。
3. `countIndentColumns` 单元测试覆盖 `""` / `" "` / `"   "` / `"    "` / `"\t"` /
   `" \t"` / `"\t\t"` / 非空白起首，逐个钉列数。
4. 一条断言 `parse.ts` 的 cell 绝对 offset **未变**——用一个 Tab 缩进正文行的
   真表，比对每个 `TableCell.start/end`。这条是 §2.3 那个坑的回归测试。
5. `SCAN-noncandidate-delimiter` 的 indented 半边按新行为重写，同 C1 第 5 条。

### WI-C3 — 语料与 oracle 的对齐（C1/C2 的共同尾款）

**状态**：DONE-VERIFIED（2026-09-18）。`SCAN-oracle` 由「全语料逐字节同一」改写为「类外精确同一 + 类内只许删幻影」，divergent 38 个下标、dropped 42、`invented === []` 全部按字面量钉死。`tests/table-scan-enumeration.test.ts` 有 64 行录制行被改（收据 `TS-WI-3` → SEPARATION-BROKEN，事前授权、事后逐条核对）。


**做什么**：按 ADR-0008 给的出路，**另起**一个带自己种子与字节总数的生成器覆盖
新期望，`makeCorpus` 与 `CORPUS_TOTAL_BYTES = 64568` **逐字节不动**；给
`SCAN-oracle` 开一个**具名的、写明理由的**豁免，而不是删掉它。

**验收**：
1. `makeCorpus` 的输出 SHA 与改动前一致（用脚本断言，不靠肉眼）。
2. `SCAN-oracle` 的豁免是白名单形式，列出每一条豁免文档及其理由链接。
3. `pnpm test:run` 全绿。

### WI-C4 — ADR + ledger（**和 C1/C2 同一个 commit，不是后续清理**）

**状态**：DONE-VERIFIED（2026-09-18，主会话手写）。`docs/adr/0009-narrow-source-table-detection-to-gfm.md`；`docs/feature-ledger.md` 新增「源码模式的表格识别范围」行，状态 `Partial`，`限制：` 写明欠识别那一半没修（74 处里吻合 44 处，修前 40 处）；`CHANGELOG.md` 一条 `### Fixed`。`pnpm ledger:check` 166 行 / 180 条路径断言 / 0 findings / 94-94 覆盖，`pnpm ledger:build` 已重跑。


**做什么**：

1. 新写 `docs/adr/0009-table-detector-narrowed-to-gfm.md`，Nygard 结构。
   Context 必须包含：§1.2 的收窄、§1.3 的第三形态、§1.4 的反向漏认与 40/74→44/74、
   §5.3 的「错表→无表」、§5.4 的「修完仍不一致」。
   **Consequences 要写代价**：用户可见的行为变化、`SCAN-*` 的重写、
   U1 类漏认仍未修。ADR-0008 的 Status 加一行指向它（**Context 不得修改**）。
2. `docs/feature-ledger.md` 需要重写的行（**行为变了就改行，这是完成的一部分**）：
   - `:139` `重排表格 | Partial` —— 复核 `限制：` 是否要补「不再把 setext 标题
     与缩进段落识别为表」
   - `:140` `保存时自动重排 | Shipped`
   - `:144` `列数校验提示 | Shipped`
   - `:145` `当前单元格高亮 | Shipped`
   - `:149` `MCP 驱动的表格编辑 | Shipped`
   - `:231` `HTTP 表格端点 | Partial`
3. `CHANGELOG.md` `## [Unreleased]` 记一条 **Fixed**，写清「哪些文档会不再显示
   为表格」——这是用户唯一能提前知道的渠道。

**验收**：`pnpm ledger:check` 通过；markdown 变了就跑 `pnpm ledger:build`。

---

## Part 7 — 优先级建议（诚实版）

**建议：做 WI-C0，把 C1/C2 排进下一个可用档期，不要插队。**

理由，按权重：

1. **BLOCK 级后果 + 低概率触发 = 先堵写入面，不急着改语义。** WI-C0 消掉全部
   data-loss 路径，改动最小，**且不碰 §5.5 那一堆测试**。这是性价比最高的一刀。
2. **C1/C2 的真实成本在测试和记录，不在那三行代码。** 原型证明代码改动是三行；
   `SCAN-noncandidate-delimiter` 重写 + `SCAN-oracle` 豁免 + 语料第二生成器 +
   一份新 ADR，才是工作量的主体。插队做它会把 ADR-0008 明确放行的
   WI-3B / WI-4 / WI-5 一起堵住。
3. **「记下来先不修」对 C1/C2 不成立，对整体成立。** §3.2 的删除是实测出来的，
   不是理论风险，所以「全都不修」不是一个诚实的选项。但「先修写入面、语义修正
   排期做」是——因为幻影只要不被写，它就退回成 R1–R3 那三个 SHOULD 级的显示问题。
4. **如果只能做一件事，做 WI-C0。** 如果能做两件，做 C0 + C1（FIX-A 最窄最安全）。
5. **U1 那一类漏认（§1.4）可能比缺陷 C 更值得修**，但它要动 ADR-0007 的
   Decision，必须独立立项、独立评议，**不要夹带在本计划里**。

一句话：这是一个**后果严重但触发很窄**的缺陷。它值得一个兜底守卫和一个排期，
不值得一次停机。把它写成 P0 会是对本次调查结果的夸大。

---

## Part 8 — 未决问题

以下是本次**没能定论**的，按影响排序。不要在没回答前把它们当已知。

1. **U1 类漏认在真实文档里到底有多常见？**
   种子语料是对抗性构造的，74 份里 34 份不一致这个比例**不能**外推。要一个真实
   语料（比如仓库自己的 `docs/**/*.md`）跑一遍位置比对才有数。这个数字直接决定
   §5.4 的那条尾巴该不该立项。**[未测]**

2. **§5.3 的「错表→无表」会不会打到真实用户文档？**
   需要在真实语料上统计「打补丁后表格数减少」的文档数与形态。如果非零，
   CHANGELOG 和 ADR 的措辞要跟着改。**[未测]**

3. **WI-C0 的守卫条件是不是恰好？**
   「分隔行自身必须是候选行」能挡住 S1/S2，但 **S3′（Tab 缩进表头）的分隔行是
   正常的**，守卫挡不住它。C0 到底要不要一并检查表头缩进，我没测。
   如果不查，C0 就不是完整的写入面兜底。**[未测，且是 C0 能否独立成立的关键]**

4. **`micromark-extension-gfm-table@2.1.1` 为什么还在 pnpm store 里？**
   `node_modules/.pnpm/` 下 2.1.1 和 2.1.2 并存。经
   `micromark-extension-gfm@3.0.0` 确认 remark-gfm 走的是 2.1.2 **[实测]**，
   但 2.1.1 是谁拉进来的、会不会有第二条解析路径走它，我没查。
   如果存在第二条，「参考解析器只有一个」这个前提就要打折。

5. **W4（Tab 导航）算不算写入面？**
   它在 `ctx.end` **插入**而不是替换（`sourceTableTabNav.ts:104-107`），是四条里
   唯一不替换 `[start, end)` 的。我按「会改文档」归进了写入面，但它的危险度明显
   低一档。是否要进 C0 的守卫范围，留给实现时定。

6. **Rust 侧 202-before-apply 该不该一起改？**
   `http_server.rs:834` 在前端真正应用之前就返回 202，客户端无法区分
   「被拒绝」和「已执行」。这是一个**独立于缺陷 C** 的 IPC 契约问题
   （规则 60「MCP tool handlers validate all incoming arguments」的邻居条款）。
   本计划没有处理它，但 C0 会让「被拒绝」变成常态，**使这个问题更明显**。
   建议单独立项。

---

## 附：本次实测清单（可复现）

| 验证 | 方法 | 结论所在 |
|---|---|---|
| GFM vs mdpro 表格计数，18 个夹具 | esbuild 打包 + remark-gfm 同进程比对 | §1.1 |
| 谓词级真值表 | 直接调 `isDelimiterLine` / `isTableCandidateLine` | §2.1 |
| 补丁前后三方对比，16 个夹具 | scratchpad 内打补丁副本 | §5.2 |
| 语料位置比对 40/74 → 44/74 | `makeCorpus(SEED, 200)`，排除 fence/crlf 维度 | §1.4 |
| MCP 写入毁内容 | 直接调 `applyMcpTableAction` | §3.2 |
| 保存重排毁内容 | 直接调 `formatAllTables` | §3.2 |
| `autoReformatTablesOnSave` 默认值 | `src/types/preferences.ts:305-308` | §3.2 |

**仓库在本次调查中未被修改。** 所有补丁副本、打包产物与脚本都在 scratchpad。
