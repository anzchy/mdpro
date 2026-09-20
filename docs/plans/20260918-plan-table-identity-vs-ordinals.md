# Plan: 表格「序号寻址」缺陷 —— 让客户端、渲染器与编辑器对「第 N 张表」达成一致

Opened 2026-09-18
Branch: `frontend-backend-redesign`
Repo: anzchy/mdpro
Status: **DRAFT（只读复现已完成，未动任何源码；等待排期）**
上游记录：[ADR-0013](../adr/0013-under-detection-shifts-table-ordinals.md)
—— 该记录撤回了 [ADR-0009](../adr/0009-narrow-source-table-detection-to-gfm.md)
「漏检不会造成坏写入」的前提，并明确「修法是表格身份，不是再打一个检测器补丁」。

本文件存在的唯一理由：ADR-0008 曾以「a new defect is on record with no owner and
no plan」收尾，ADR-0009 因此被迫补做测量。ADR-0013 同样推迟了修复，**不能再留下
一个无主缺陷**。这里就是它的主人。

---

## 证据分级约定

沿用[计划 M](./20260912-plan-markdown-source-consolidation.md) 的约定：

| 标记 | 含义 |
|---|---|
| **[实测]** | 实际跑过代码核对，附 `file:line` 与实际输出 |
| **[推断]** | 由实测事实推导，未直接验证 |

---

## 1. 缺陷陈述

**[实测] 2026-09-18，运行 shipped code：**

```
const doc =
  "| b0 | b1 |\n| h0 | h1 | h2 |\n| :-- | :-: | :-- |\n| r0 | r1 | r2 |\n" +
  "\n| c0 | c1 |\n| --- | --- |\n| v0 | v1 |\n";

GFM                -> 2 张表；table 0 起点 offset 12
findAllTables(doc) -> 1 张表；tables[0] 起点 offset 67   ← 即 GFM 的 table 1
applyMcpTableAction(doc, "delete_row", { tableIndex: 0, index: 0 })
                   -> 删掉了 GFM table 1 的表头，GFM table 0 原封不动
```

已固化为 `tests/table-gfm-narrowing.test.ts` 的
`NARROW-underdetection-shifts-ordinals`（**缺陷回执**：断言的是错误行为）。

**根因不是漏检本身。** `src/utils/tableMcp.ts:203`（`setCell` 在 130 行有同一行代码）直接拿调用方给的序号取表：

```ts
const table = tables[tableIndex];
```

序号由两个互不相识的解析器各自数出来。只要两边对「哪些算表」有任何分歧，
序号就会错位——漏检错 −1，幻影错 +1（后者即 ADR-0009 已修的那半）。
`guardTableWrite` 拦不住：被误伤的表结构合法，守卫没有可反对的东西。
并且 `http_server.rs:834` 在前端应用之前就已返回 `202`，调用方被告知成功。

---

## 2. 为什么「继续收窄检测器」不是修法

**[推断]** 把剩余 30/74 的位置分歧补到 0，只是把窗口关小，不是关上。
任何残留分歧都能复现同一个 bug，而「两个解析器永远逐字一致」是不可维护的不变量。
真正的缺陷是：**一个按位置生效的操作，走在一个由双方各自计算的序号上。**

---

## 3. 候选修法（未决，需要各自的取舍记录）

| 方案 | 做法 | 代价 |
|---|---|---|
| **A. 按偏移寻址** | 协议改为 `{ start, end }` 或 `{ offset }`，序号只用于展示 | 破坏 HTTP/MCP 现有契约；调用方需先读文档拿偏移 |
| **B. 稳定身份** | 每张表发一个 id（内容哈希 + 出现序），读接口返回 id，写接口只收 id | 需要读写两侧都改；id 在编辑后如何延续要单独定义 |
| **C. 服务端校验** | 写请求附带调用方看到的表头/列数，落地前比对，不符即拒 | 最小改动，但只能*拒绝*不能*纠正*；仍需改协议 |
| **D. 对齐解析器** | 让 Source 检测器逐字对齐 GFM | 已论证不足以修复（§2），单独做无意义 |

**倾向 [推断]：C 作为止血（可先上，向后兼容），A 或 B 作为终局。** 未定，
选定时写 ADR。

---

## 4. 排期前必须先做的事（按顺序）

1. **测量暴露面。** ADR-0013 明确记录了「未测量」：语料里 30/74 文档位置不一致，
   但其中**有多少在分歧点之后还有表**（即真正可被误伤的形状）从未数过。
   这个数字决定本计划的优先级，也是唯一能把「边缘情况」和「日常事故」分开的证据。
   语料与方法沿用 `20260917-plan-table-over-detection-vs-gfm.md`。
2. **数清 ordinal 路径的调用方。** **[实测]** `src/utils/tableMcp.ts` 里
   `const table = tables[tableIndex]` 出现两次——`setCell`（第 130 行）与
   `applyMcpTableAction`（第 203 行），两条都是跨进程序号寻址，两条都在本缺陷
   的射程内。`formatAllTables`（保存时自动重排）、Source 右键菜单、Tab 导航
   是否也如此，尚未核实。多一个调用方就多一份紧迫性。
3. **给 `202`-before-apply 契约定主。** ADR-0009 与 ADR-0013 都点了它却都没修，
   它现在同时为两个缺陷承重。本计划实施时若不一并处理，写入失败仍然静默。

---

## 5. 验收（实施时才生效）

- `NARROW-underdetection-shifts-ordinals` **必须失败并被有意重写** —— 它是缺陷
  回执，修好之后留着它就是在断言 bug 还在。
- 新增：调用方按 GFM 数出的序号/身份，与 mdpro 落地的目标表一致，覆盖漏检、
  幻影、以及两者混合的文档。
- 写入失败必须能被调用方看见（与第 4.3 条联动）。
- `docs/feature-ledger.md` 中表格编辑相关行的 `限制：` 相应更新——ADR-0013 已写明，
  在此修好之前任何「Shipped 且无限制」的表述都与该记录冲突。
