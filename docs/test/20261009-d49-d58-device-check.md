# D49 + D58 表格编辑真机检查（2026-10-09）

本轮在 Mac mini 上用 `1c1b3b6`（`1c1b3b6c55f6f5d79b7fe6e6a93f0fd4cf2426f3`）的 release 包，按 brief `20261009-brief-d49-d58.md`，检查 [D49](../plans/20260912-frontend-backend-sequencing-order.md#d49)（`58398ec`；ADR-0063、ADR-0064：源码右键菜单与 `/api/v1/*` 表格操作先加宽、不丢多于表头的单元格）和 [D58](../plans/20260912-frontend-backend-sequencing-order.md#d58)（`d785ec9`；ADR-0065：HTTP `mcp:table_action` 打到活动的 WYSIWYG 文档时先冲刷、先改编辑器再写 store）。运行时间 14:47–14:59（GMT+8），全程自动，没有用到任何用户步骤（U1–U4）。MCP 服务开局即为 Running，未切换；token 从未打印。夹具已提交为 [`tests/manual-fixtures/d49-table-widen.md`](../../tests/manual-fixtures/d49-table-widen.md)（T0 为普通表，T1–T3 为同样的参差表：表头 2 列，行有 3 格和 4 格，带唯一记号 `X<表号><a|b|c>`，共 9 个）。截图不进仓库，留在 Mini 的 `~/.mdpro-redesign/dtrack/reports/shots/`。

## 结论

| 行 | 判定 | 一句话理由 |
|---|---|---|
| D49-S | **PASS** | S1/S2/S3 各记一条 `editor.table.edit-widened` 2→4；9 个记号都在；T0 逐字节不变。S3 的菜单项靠键盘选中（偏差 3、F4） |
| D49-H | **PASS** | H1/H2 返回 202，各两条 `success` 加一条 `edit-widened`；H3 被拒（`invalid payload`），sha 不变；H2 后 9 个记号都在 |
| D49-W | **FAIL** | WYSIWYG 下三个右键操作都记 `editor.table.<action>` `warn`/`fail`，什么都没改。没有可见文字丢失；X 记号**保留**（新发现 F2）。转 [D65](../plans/20260912-frontend-backend-sequencing-order.md#d65) |
| D58-S | **PASS** | 两处改动都在；没有 `mcp-table` 冲刷。**NOTE**：打的 `kq1` 被光标跳动拆开，见 F3 |
| D58-R | **PASS** | 第 3 次试验记 `editor.milkdown.flush` `outcome:"written"`，在前端 `success` 之前；store 与屏幕都有 `kq1kq2kq3` 和 `R3`。但见 F1 |
| D58-RF | **PASS** | 202；`clean` 的 `mcp-table` 冲刷之后前端 `fail` `reason:"invalid payload"`；sha 不变；屏幕无 `NO` |
| D58-N | **PASS** | 没有 `mcp-table` 冲刷；n1 两条 `success`，有 `R1`、无 `kq1`；n2 有 `kq1` 且 T0 仍为 `\| a \| b \|`；切到 n1 后显示 `R1`，store 不变 |
| D58 其余拒绝分支（`flush failed`、`editor unavailable`、`replaceAll` no-op / 抛错、`storeReconciled`） | **NOT RUN** | 只有单元测试，没有真机触发手段（brief 原定如此） |

D58-R 三次试验都走 route A（osascript 按键），按键每次都落下：

| 试验 | osascript | curl `time_total` | HTTP | `mcp-table` 冲刷（行号） | 1.5 s 后的 store |
|---|---|---|---|---|---|
| 1 | 119 ms | 0.001233 s | 202 | `clean`（10593） | `Last line.kq1`，`\| a  \| R1 \|` |
| 2 | 119 ms | 0.001501 s | 202 | `clean`（10612） | `Last line.kq1kq2`，`\| a  \| R2 \|` |
| 3 | 121 ms | 0.001436 s | 202 | **`written`**（10625） | `Last line.kq1kq2kq3`，`\| a  \| R3 \|` |

整段日志里只有一条 `written` 的 `mcp-table` 冲刷，即全局第 10625 行（日志切片第 330 行）；第 1、2 次是 `clean`，对竞态什么也证明不了，第 3 次是唯一合格的试验：

```
10625: {"ts":"2026-10-09T14:55:58.500+08:00","level":"info","event":"editor.milkdown.flush","status":"success","actionId":"af8048bb-e3fc-4f92-b858-5563232c42b9","context":{"documentId":"5cd3f4d199be5f0c","outcome":"written","reason":"mcp-table"},"durationMs":null,"error":null}
```

## ADR-0065 的状态

按 brief 的规则（D58-R 与 D58-N 为 PASS，D58-RF 不是 FAIL），本次真机结果**支持把 [ADR-0065](../adr/0065-mcp-table-actions-flush-first-and-commit-the-editor-before-the-store.md) 改为 Accepted**。但 F1 正落在同一条 `mcp:table_action` → WYSIWYG 提交路径上，EXEC 建议先查 F1。

**用户裁定（2026-10-09）：先保持 Proposed，查清 F1 再定。** 用户原话：「先保持 Proposed，查清 F1 再定 (Recommended)」。

**随后（同日）改为 Accepted。** [D64](../plans/20260912-frontend-backend-sequencing-order.md#d64) 的单元级复现确认 F1 在 D58 之前就存在（`d785ec9^` 上输出逐字节相同，见下文 F1 的「事后定位」），不是 ADR-0065 引入的；D58-R、D58-N 均 PASS。用户原话：「改为 Accepted (Recommended)」。

## 新发现

### F1：D58 的 WYSIWYG 提交路径把同一文档里**非目标**参差表的单元格右移一列 → [D64](../plans/20260912-frontend-backend-sequencing-order.md#d64)

r.md（活动、WYSIWYG、参差夹具）。D58-R 第 1 次试验对 **T0** 发 `set_cell`（冲刷 `clean`，第 10593 行），紧接着日志出现两条 `editor.milkdown.mount`（事后定位：不是重新挂载，见下），store 内容从 338 字符重新序列化为 549 字符：

```
10595: {"ts":"2026-10-09T14:54:54.623+08:00","level":"info","event":"editor.milkdown.mount","status":"success","actionId":"bc935d54-1f3c-4404-a6d5-b5ba89f7eb5f","context":{"contentLength":338,"documentId":"5cd3f4d199be5f0c","hasContent":true},"durationMs":null,"error":null}
10596: {"ts":"2026-10-09T14:54:54.838+08:00","level":"info","event":"editor.milkdown.mount","status":"success","actionId":"66d49ebd-9072-41c8-b866-da61d0d8b1d3","context":{"contentLength":549,"documentId":"5cd3f4d199be5f0c","hasContent":true},"durationMs":null,"error":null}
```

没有被操作的 T1、T2、T3 在 store 里都变成下面这样（`r-after-t1.md`，T1）：3 格的那一行整体右移一列，前面补了一个 `<br />` 格；表头补了 `<br />`，新列对齐为 `:-----`：

```
| h1     | h2 | <br /> | <br /> |
| ------ | -- | :----- | :----- |
| <br /> | e  | f      | X1a    |
| g      | h  | X1b    | X1c    |
```

夹具里这一行是 `| e | f | X1a |`，现在 `e` 落在 `h2` 下、`f` 落在空表头下。没有记号丢失，但「格 → 列」的含义被破坏。屏幕上同样错位（`d58-r-2`、`d58-r-3b`、`d58-rf-1`）；试验前 T1–T3 显示正常。第 2、3 次试验没有继续错位（`r-after-t1.md` 与 `r-after-t3.md` 只差 T0 第 1 行和最后一行）。

**对照（D58-N）**：在 n2 里普通的 WYSIWYG 打字（n2 上没有任何 MCP 操作）同样把整篇重新序列化，但 T1–T3 加宽得**正确**，在行尾补空格、没有 `<br />`（`n2-after.md`，T1）：

```
| h1 | h2 |     |     |
| -- | -- | --- | --- |
| e  | f  | X1a |     |
| g  | h  | X1b | X1c |
```

所以错位跟着 MCP 表格操作的提交 / 重新挂载路径走，与普通的 edit-sync 无关。EXEC 没有进一步隔离（不许改仓库）。是否由 `d785ec9`（D58）引入，尚不知道。

**事后定位（2026-10-09，单元级复现，不是本次真机的一部分）**：根因是 prosemirror-tables 的 `fixTables`（Milkdown GFM `tableEditing` 的 `appendTransaction`），不是 D58 引入。`replaceAll` 换掉整篇，所有表都算「改过」，`fixTables` 把参差表补成矩形，其中一行的缺格补在行首（prosemirror-tables 1.8.5 `dist/index.js:844`），空格序列化为 `<br />`、新表头格默认左对齐成 `:-----`；edit-sync 再把它写回 store。对照组没错位，只因那次按键落在 T1–T3 之外；在参差表里打字同样错位。两条 `editor.milkdown.mount` 是 `useMilkdownDebugLogging.ts` 随 store 长度变化重发的日志，不是重新挂载。同一复现在 HEAD `618d8e1` 与 `d785ec9^` 上输出逐字节相同。详见 [D64](../plans/20260912-frontend-backend-sequencing-order.md#d64)。

### F2：WYSIWYG 载入时**保留并显示**多出表头的单元格 → [D65](../plans/20260912-frontend-backend-sequencing-order.md#d65)

`d49-w-0`（以及冷启动时 r.md 的画面）里 X1a…X3c 显示在多出来的格里；brief 按 ADR-0052 / ADR-0063:71 的说法预期 2 列、看不到 X。D49-W 全程 w.md 的 store 与夹具逐字节相同（`w-after.md`）。按 brief 的标注规则，这是**新发现**（X 保留），不是「已知限制」。

D49-W 本身判 FAIL：菜单在这些参差表上报 `colCount:4`，三个操作全部失败、什么都没改：

```
10747: {"ts":"2026-10-09T14:57:54.455+08:00","level":"info","event":"ui.table-context-menu.open","status":"success","actionId":"a85296b3-6b91-46b9-aded-171cc01a42c7","context":{"colCount":4,"colIndex":0,"rowCount":3,"rowIndex":1},"durationMs":null,"error":null}
10748: {"ts":"2026-10-09T14:58:01.108+08:00","level":"warn","event":"editor.table.insert_row_after","status":"fail","actionId":"a60c0807-f309-4d9e-b0de-cafbdf2333bc","context":{"colIndex":0,"rowIndex":1},"durationMs":null,"error":null}
10754: {"ts":"2026-10-09T14:58:17.921+08:00","level":"warn","event":"editor.table.insert_column_after","status":"fail","actionId":"a013b82d-a2f4-44df-8979-9a33e99fa1c9","context":{"colIndex":0,"rowIndex":0},"durationMs":null,"error":null}
10762: {"ts":"2026-10-09T14:58:48.096+08:00","level":"warn","event":"editor.table.delete_column","status":"fail","actionId":"55389c90-57ae-4bf4-a837-202e02fe79ae","context":{"colIndex":0,"rowIndex":0},"durationMs":null,"error":null}
```

没有 `edit-widened`（符合预期）；`xs` 始终 9 个；没有可见文字丢失（`d49-w-1`～`d49-w-3`）。

### F3：Source 模式下打字途中到达的 `set_cell` 把光标移到偏移 0 → [D66](../plans/20260912-frontend-backend-sequencing-order.md#d66)

D58-S 之后 m.md 的 store：第 1 行 `q1# D49 / D58 table check`，第 31 行 `Last line.k`，T0 为 `| a   | R1  |`。`d58-s-1` 显示光标停在第 1 行的 `q1` 之后。每个字符都在、顺序也对，`R1` 也在，所以按 brief 的 FAIL 规则（缺一处改动或有 `fail` 行）仍是 PASS；但字落错了地方。ADR-0065 不测光标，故记为 NOTE。WYSIWYG 的 D58-R 试验没有被拆开。

### F4：表格右键菜单在 1200×800 窗口里被截断，删除组用鼠标点不到 → [D67](../plans/20260912-frontend-backend-sequencing-order.md#d67)

`clampPosition` 按 `MENU_HEIGHT_MAX = 480` 夹位置，但 15 项的菜单比这更高。在窗口 y≈312 以下右键，菜单从夹紧后的顶端展开，「Delete row / column / table」落到窗口下沿之外；滚轮也滚不出来（`max-height: calc(100vh - 16px)` 没有触发）。源码（`SourceTableContextMenu`）与 WYSIWYG（`TableContextMenu`）都如此。本轮用键盘绕过（偏差 3）。

## 偏差

1. **开局之后改用 File › Open（⌘O）打开文件，没有照 brief 用 `open -a "$APP"`。** 第一次 `open -a "$APP" s.md` 打到正在运行的 app 上，被路由进一个**新窗口**，且是默认的 WYSIWYG 模式：
   ```
   10369: {"ts":"2026-10-09T14:49:28.696+08:00","level":"info","event":"file.open.route","status":"success","actionId":null,"context":{"matchCount":0,"outcome":"new-window","source":"finder","windowLabel":null},"durationMs":null,"error":null}
   ```
   这破坏了 brief「全程一个窗口」的前提，s.md 也在 WYSIWYG 里载入过一次（store 完好，9 个记号）。EXEC 用关闭按钮关掉该窗口（第 10419 行 `window.close`，文档未改、无提示），之后 s、h、m、n1、n2、w 都经 ⌘O → Go to Folder → Open 在 `main` 里以标签打开，沿用窗口当前模式；s.md 从未动过的磁盘副本重新读入（同一 doc id）。**对这个构建，brief 里的 `open -a` 步骤需要改写。**
2. 焦点靠激活 / `set frontmost` 移动，从不点标题栏（r4）。有一次在焦点闸命令里误跑了 `open -a mdpro`，只激活了运行中的 PID 45500，没有起第二个进程（`ps` 核过）。
3. **S3、W3 的「Delete column」靠菜单内键盘选中**（End → Delete table，↑ → Delete column，Return），因为该项被截到窗口外（F4）。菜单打开时焦点在第一项，End / 方向键 / Enter 由菜单自己处理；只有 `move_*` 项会被禁用（`actionGate.ts`），所以 End/↑ 的落点是确定的。全程没用 Esc。
4. 竞态按键是 System Events 按键（route A 可用，没用到 route B）；200 ms 窗口只由第 10625 行的 `written` 证明，不靠秒表。
5. 没有 ⌘S、Esc、⌘Z。从不右键多出来的列。视图模式按块切换（⌃2 于第 10359 行，⌃4 于第 10566 行），结束时本来就是 WYSIWYG，无需恢复。MCP 未切换。退出会保存窗口几何。
6. D58-S 按类比套用 brief 给 route B 定的「拆成片段」规则（route A 在 Source 里被拆开）。
7. 为够到 T3 和 `Last line.` 滚动过编辑器与菜单（不涉及设置）。

退出时「Unsaved changes」点了 **Discard changes**，丢弃 s、h、m、r、n1、n2 六份 scratch 副本的改动（`dirtyCount:6`，第 10783 / 10793 / 10794 行）；磁盘上 `fixture.md` 与七份副本的 shasum 仍相同（`f56c46f3…`），没有写盘。

## 证据

都在 Mini 的 `~/.mdpro-redesign/dtrack/reports/shots/d49-d58-evidence/`，不进仓库：

| 文件 | 内容 |
|---|---|
| `fixture.md` | 运行时生成的夹具，与本仓库 `tests/manual-fixtures/d49-table-widen.md` 逐字节相同（shasum `f56c46f3…`） |
| `s-before.md`、`s-after.md` | D49-S 前后的 s.md store |
| `r-after-t1.md`、`r-after-t3.md` | D58-R 第 1、3 次试验后的 r.md store（F1 的错位） |
| `n1-after.md`、`n2-after.md` | D58-N 之后的 n1 / n2 store（n2 为 F1 的对照） |
| `w-after.md` | D49-W 之后的 w.md store（与夹具相同） |
| `mdpro-log-10296-10794.jsonl` | 整轮的日志切片，全局第 10296–10794 行（切片第 *n* 行 = 全局第 *n* + 10295 行）；不含 token |

截图（同在 `reports/shots/`，均为 1200×800）：`pre-panel`、`d49-s-1-1`、`d49-s-2-1`、`d49-s-3-1`、`d49-h-1`、`d58-s-1`、`d58-r-1`、`d58-r-2`、`d58-r-3`、`d58-r-3b`、`d58-rf-1`、`d58-n-1`、`d58-n-2`、`d49-w-0`、`d49-w-1`、`d49-w-2`、`d49-w-3`。`shot.sh` 开局自检 PASS（⌘O 面板打开时拍到的是 1200×800 主窗口，不是 880×448 的面板）。

完整的 EXEC 报告（英文）是 Mini 上的 `~/.mdpro-redesign/dtrack/reports/report-20261009-d49-d58.md`。
