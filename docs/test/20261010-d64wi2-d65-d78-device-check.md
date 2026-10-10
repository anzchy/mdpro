# D64 WI-2、D65、D78 真机检查（2026-10-10）

本轮在 Mac mini 上用 `f504e14`（`f504e14db3302952b104afa569e3de1168f5c6ee`）的 release 包，按 brief `20261010-brief-d64wi2-d65-d78.md`，检查 [D64](../plans/20260912-frontend-backend-sequencing-order.md#d64) WI-2（WYSIWYG 载入参差表时在行尾补成矩形，HTTP 表格操作与表内打字不再把没被操作的参差表整行右移）、[D65](../plans/20260912-frontend-backend-sequencing-order.md#d65) WI-2b（WYSIWYG 右键菜单在参差表与普通表上的插入 / 删除）和 [D78](../plans/20260912-frontend-backend-sequencing-order.md#d78)（正文格上的对齐作用于整列，改源码分隔行的冒号）。运行时间 2026-10-10 09:52–10:01（GMT+8），EXEC 为 Claude（Bash + computer-use），没有用到任何用户步骤（U1–U4）。D64 / D65 的 WI-3（`4e7b356`，HTML 粘贴的规范化）在 `f504e14` 之后才提交，不在这个构建里，本轮没有测。

构建：`~/.mdpro-redesign/dtrack/builds/f504e14/mdpro.app`，`git rev-parse HEAD` = `f504e14…`；祖先检查 `a9eec65`（D64 WI-1）、`638f881`（D64 WI-2）、`c1182b2`（D65 WI-2b、D78）都在；`raggedTableWiden.ts`、`contextMenuCommands.ts` 两个文件 `cat-file -e` 都在。`tauri-app` 的 mtime `1791596993`，SHA-256 `047ac45f…eeaf620cb`；包内版本 0.3.0（`/api/status`）。输入源 ABC。启动前没有残留的 `tauri-app` 进程（`pgrep` 只匹配到 tmux 会话与一个 `claude --resume`，是路径或名字的子串，不是 app）。冷启动 PID 18611（`open -a "$APP" d64w.md`，L11866 `file.open.external` `appReady:false`），`file.draft.list` `listed:0`，没有「Recover drafts」对话框。设置开局为 `themeMode:"system"`、`defaultViewMode` / `lastViewMode` 均为 `wysiwyg`、`autoReformatTablesOnSave:false`、MCP `serverEnabled:true`、`autoApproveEdits:false`；全程没有改任何设置，退出后重读与开局逐字节相同。因为保存时自动重排是关的，⌘S 之后的磁盘内容就是 WI-2 的直接证据（全程没有 `editor.table.auto-reformat-on-save`）。MCP 服务开局即为 Running，token 只打印过长度（64）。截图不进仓库，留在 Mini 的 `~/.mdpro-redesign/dtrack/reports/shots/`（14 张，均 1200×800；`shot.sh` 开局自检通过）。

## 结论

| 行 | 判定 | 一句话理由 |
|---|---|---|
| D64-A（载入） | **PASS** | T1–T3 三张参差表在屏幕上都是 4 列、格序正确，没有 `<br />`；store 与夹具逐字节相同（`jq -j` 读，见 F1），`is_dirty:false`，标签无脏点 |
| D64-B（对 T0 `set_cell`） | **PASS** | HTTP 202，L11925 / L11927 两条 `mcp.table.set_cell` `success`；T0 有 `R1`，T1–T3 每行 5 个 `\|`、首个正文行为 `\| e \| f \| X?a \|  \|`，`<br` 0、`:-` 0，9 个记号都在 |
| D64-B4（越界列号被拒） | **NOTE（没有被拒）** | `set_cell` T1 第 1 行第 2 列返回 202、`success`，`NO` 覆盖了 `X1a`。B 的整篇写入已把 store 里 T1 的表头加宽到 4，这一步的前提不再成立，见 F2；不算 WI-2 FAIL |
| D64-C（在 T1 里打字） | **PASS**（有偏差） | 屏幕上 `fk` 出现在 T1，整行不移；但 ⌘S 冲刷之前 store 里没有 `fk`（F3）。冲刷后的 store 与磁盘都是 `\| e \| fk \| NO \|  \|`，T2 / T3 不变 |
| D64-D（⌘S） | **PASS** | `file.save` `success`（L11963，426 B）；T1–T3 各 5 个 `\|` × 4 行，`<br` 0、`:-` 0，`\| R1` 1、`fk` 1；store 等于磁盘，⌘W 不提示。记号是 8 个加 `NO`（B4 所致） |
| D65-insert（参差 T1 → Insert row below） | **PASS** | L12014 `editor.table.insert_row_after` `success`；T1 为 5 个 `\|` × 5 行，9 个记号都在 |
| D65-delete-column（参差 T1） | **PASS** | L12024 `editor.table.delete_column` `success`；T1 为 4 个 `\|`，`X1a`、`X1b` 消失，T0 / T2 / T3 不变 |
| D65-delete-row（参差 T1） | **PASS** | L12033 `editor.table.delete_row` `success`；T1 剩 4 行，只剩 T2 / T3 的记号，其他表不变 |
| D65-delete-row（普通 T0） | **PASS** | L12082 `editor.table.delete_row` `success`；T0 为 3 行、3 个 `\|`，第 2 列仍是 `-:` |
| D78-body（T0 正文格 → Align right） | **PASS** | L12040 `editor.table.align_right` `success`；T0 分隔行 `\| -- \| -- \|` → `\| -- \| -: \|`，`n2` / `b` / `d` 右对齐，其他表没有冒号 |
| D78-header（T2 表头格 → Align center） | **PASS** | L12075 `editor.table.align_center` `success`；T2 分隔行 `\| -- \| :-: \| --- \| --- \|`，其他列无冒号，T0 仍是 `-:` |

所有行号都是 Mini 上 `~/.mdpro/mdpro.log` 的全局行号。D65 / D78 的 6 次菜单操作（L12013–12097）里 `editor.table.*` `fail` 为 **0** 条。

## 逐行证据

### D64 WI-2（scratch `d64w.md`，WYSIWYG）

冷启动直接以 WYSIWYG 打开 d64w（L11901 `editor.milkdown.mount` `contentLength:328`），不需要 ⌃4。夹具为一张普通表 T0 加三张参差表 T1–T3（表头 2 列，正文行最多 4 格，记号 `X1a`…`X3c` 共 9 个）。

1. **A（载入）**：T1、T2、T3 都显示 4 列：`h1 h2 _ _` / `e f X?a _` / `g h X?b X?c`；`e` 前面没有补格，没有 `<br />` 文本（截图 `d64-a`）。`jq -j .content | shasum` = `bd3be48e…`，与夹具相同；`is_dirty` = false，标签无脏点。只打开不写 store。
2. **B（对 T0 `set_cell`）**：`POST /api/v1/set_cell {table_index:0,row:1,col:1,"R1"}` → 202 `{"scheduled":true}`。L11925 `mcp.table.set_cell` `success`、L11926 `editor.milkdown.flush` `outcome:"clean"` `reason:"mcp-table"`、L11927 `mcp.table.set_cell` `success`；L11925–11929 未过滤 0 条 `fail`。store 里 T1–T3 都是：

   ```
   | h1 | h2 |     |     |
   | -- | -- | --- | --- |
   | e  | f  | X1a |     |
   | g  | h  | X1b | X1c |
   ```

   即在**行尾**补格、表头补空格、新列分隔为 `---`。这正是 2026-10-09 真机看到的右移一列、表头补 `<br />`、`:-----` 的反面（[`20261009-d49-d58-device-check.md`](20261009-d49-d58-device-check.md) F1）。屏幕与 A 相同，T0 显示 `R1`（`d64-b`）。
3. **B4**：`set_cell {table_index:1,row:1,col:2,"NO"}` → 202；L11936 / L11938 `mcp.table.set_cell` `success`，没有 `fail` 也没有 `reason`。`diff b-store.md b4-store.md` 只有 `| e  | f  | X1a |     |` → `| e  | f  | NO  |     |`；T1 仍是 5 个 `\|`，`<br` 0、`:-` 0；屏幕上 `NO` 在 T1 第 1 行第 3 列，整行不移（`d64-b4`）。见 F2。
4. **C（表内打字）**：左键点在 T1 第 1 行 `f` 之后，打 `k`。屏幕上成 `fk`，整行不移。出现了 macOS 自动更正气泡 `Fk ×`，在 ⌘S 之前点 × 关掉，文字保持 `fk`（`d64-c`、`d64-c2`）。1.5 s 与再过 3 s 两次读 store 都还是 `| e  | f  | NO  |     |`（`contentLength:426`），L11952 `draft.write` `bytes:426`，`is_dirty` = true。见 F3。
5. **D（⌘S）**：L11960 `editor.milkdown.flush` `reason:"save"`，L11962 / L11963 `file.save` `start` / `success`（`fileSizeBytes:426`，8 ms）；L11959–11970 未过滤 0 条 `fail`。磁盘：

   ```
   | h1 | h2 |     |     |
   | -- | -- | --- | --- |
   | e  | fk | NO  |     |
   | g  | h  | X1b | X1c |
   ```

   T2 / T3 与 B 之后逐字节相同；`<br` 0、`:-` 0、`| R1` 1、`fk` 1、`NO` 1。store 等于磁盘，`is_dirty:false`。⌘W → L11980 `tab.close`、L11981 `file.close`，不提示。

### D65 + D78（scratch `d65.md`，WYSIWYG）

每次操作前都先左键点进目标格，再右键（避开 [D81](../plans/20260912-frontend-backend-sequencing-order.md#d81)），焦点闸都显示 `window.focus main`。

| 步 | 目标 | 菜单打开 | 操作 |
|---|---|---|---|
| 2 Insert row below | T1 `e` | L12013 `colCount:4,colIndex:0,rowCount:3,rowIndex:1` | L12014 `editor.table.insert_row_after` `success` |
| 3 Delete column | T1 `X1a` | L12023 `colCount:4,colIndex:2,rowCount:4,rowIndex:1`（第二次打开，见偏差 6） | L12024 `editor.table.delete_column` `success` |
| 4 Delete row | T1 `g` | L12030 `colCount:3,colIndex:0,rowCount:4,rowIndex:3` | L12033 `editor.table.delete_row` `success` |
| 5 Align right | T0 `d` | L12039 `colCount:2,colIndex:1,rowCount:3,rowIndex:2` | L12040 `editor.table.align_right` `success` |
| 6 Align center | T2 `h2` | L12074 `colCount:4,colIndex:1,rowCount:3,rowIndex:0` | L12075 `editor.table.align_center` `success` |
| 7 Delete row | T0 `a` | L12081 `colCount:2,colIndex:0,rowCount:3,rowIndex:1` | L12082 `editor.table.delete_row` `success` |

菜单报的 `colCount` 是 4，与加宽后的表一致（2026-10-09 的 D49-W 同样报 4，但那时表在 PM 里是参差的，三种操作都 `fail`）。

- **第 2 步**：T1 成 5 行，插入的空行全为空格子，9 个记号都在（`d65-1`）。
- **第 3 步**：T1 成 3 列（4 个 `\|`），剩 `X1c X2a X2b X2c X3a X3b X3c`，T0 / T2 / T3 对 `d65-1.md` 的 diff 为空（`d65-2`）。
- **第 4 步**：T1 剩表头、分隔行与两行正文，只剩 T2 / T3 的 6 个记号，`<br` 0（`d65-3`）。
- **第 5 步（D78-body）**：屏幕上 `n2`、`b`、`d` 右对齐（`d78-1`）。⌃2（L12044 `view.mode.change` wysiwyg→source）看源码第 6 行 `| -- | -: |`（`d78-2`）；第 1 列仍 `--`，T1 / T2 / T3 分隔行没有冒号，`diff d65-3 d78-1` 只动了 T0 的 6–8 行。再 ⌃4（L12058）。
- **第 6 步（D78-header）**：T2 分隔行 `| -- | :-: | --- | --- |`，只有第 2 列带冒号；T0 仍是 `-:`，`diff d78-1 d78-2` 只动了 T2（`d78-3`）。
- **第 7 步**：T0 剩 `| c  |  d |` 一行正文，第 2 列仍是 `-:`；T1–T3 对 `d78-2.md` 的 diff 为空（`d65-4`）。
- **第 8 步（⌘S）**：L12089 / L12090 `file.save` `start` / `success`（386 B，9 ms）；磁盘与第 7 步的 store 只差 `body` 助手多出的末尾换行（F1），`<br` 0，`is_dirty:false`。
- **第 9 步（反向检查）**：L12013–12097 未过滤，6 条 `editor.table.*` 里 `"status":"fail"` 为 **0**。Reformat table 从没点过。

D65 原登记里失败的 Insert column right 本轮没有再测；Delete table 也没有测。

## 新发现

四条都**不改判定**。

### F1：brief 的 `body()` 助手多一个末尾换行（brief 工具问题，不登记 D）

`jq -r .content` 在内容后面再打一个 `\n`，所以以 `\n` 结尾的 store 与文件的哈希永远不同，A.3 照字面比 `shasum` 必然失败；第 8 步的 `diff d65-4.md d65.md` 也是同一个多出的空行。EXEC 改用 `jq -j`（原样输出）比较，与夹具相同。下一份 brief 的助手应改成 `jq -j`。

### F2：B4 的拒绝没有走到——brief 设计问题（不登记 D）

brief 的前提是「store 里 T1 的表头仍是 2 宽」，所以 `col: 2` 应按 [ADR-0064](../adr/0064-mcp-table-actions-widen-and-keep-header-width-coordinates.md) 当作无效 payload 被拒（D64 行里 D64-2 的断言）。但 B 那次 `set_cell` 在 WYSIWYG 路径上以整篇 `replaceAll` 重新序列化了 store，`b-store.md` 里 T1 表头已是 `| h1 | h2 |     |     |`（4 宽）。到 B4 时第 2 列已在表头宽度内，按 ADR-0064「第一次写入加宽后同一列号就合法了」本就该成功，所以这不是 WI-2 的失败，而是步骤顺序让拒绝路径无从观察。拒绝必须在**任何整篇写入之前**看：在新打开的文档上第一步就跑 B4，或换第二份文档。拒绝路径（`mcp.table.set_cell` `fail`、`reason` 为无效 payload）本轮 **NOT VERIFIED**，留到下一轮复核。副作用：`X1a` 被 `NO` 覆盖，C、D 两步的记号检查按 8 个记号加 `NO` 计。

### F3：WYSIWYG 打的字在冲刷之前既不进 MCP store 也不进草稿（→ [D84](../plans/20260912-frontend-backend-sequencing-order.md#d84)，MUST）

C 步打 `k` 之后，标签已脏，但 `/api/documents/{id}` 两次读回（打字后 1.5 s 与 4.5 s）都是打字前的内容（`contentLength:426`），同期 L11952 `draft.write` 也只写了 426 B、不含 `fk`；L11949–11956 只有 `mcp.read` / `draft.write` / `mcp.list`，没有任何来自按键的日志。`fk` 直到 ⌘S 的 `editor.milkdown.flush` `reason:"save"` 才进 store。对照：右键菜单的表格命令（第 2–7 步）都立即更新了 store。

后果有两面：MCP 客户端读到的文档落后于屏幕（是否该先冲刷再读是产品问题）；更要紧的是草稿在脏状态下仍写旧内容，此时若 app 崩溃，恢复出来的草稿缺这几个字。brief 的 C.2（保存前读 store 应见 `fk`）在这个构建上不可能通过，EXEC 按屏幕与冲刷后的 store 判定。严重度 MUST（与草稿相关的数据丢失路径）；用户 2026-10-10 同意登记为 [D84](../plans/20260912-frontend-backend-sequencing-order.md#d84)。

### F4：表格右键菜单比窗口高，删除组点不到（[D67](../plans/20260912-frontend-backend-sequencing-order.md#d67)，已登记）

默认窗口高度下，右键点中的行在窗口里低于约 y≈250 时，菜单底部的 Delete row / column / table 被截到窗口外；菜单在点击处打开，不重新定位也不能滚动。EXEC 只能先把目标行滚到窗口顶部附近再右键（偏差 6）。这就是 D67 的缺陷，修复 `d725053` 尚未落到 `frontend-backend-redesign`，不在本构建里，不另登记。本轮测得的阈值（y≈250）比 D67 行按 `MENU_HEIGHT_MAX` 推算的 y≈312 更靠上。

## 偏差

1. 焦点靠 `open_application` / `set frontmost` 移动（`key.sh`、`kc.sh`），不是点击（已知偏差）。
2. 冷启动之后的文件都经 ⌘O 打开：Go to Folder 输入完整路径，双击建议行，再点 Open；每次都确认有 `file.watch.register` `ok:true`（d65 为 09:56:17.766）；全程没按过 Return / Enter。
3. WI-2 没有自己的日志行，判定靠 store、磁盘与屏幕。
4. D64 的 HTTP 调用用 curl 直接打 `/api/v1/set_cell`。
5. A.3 与第 8 步改用 `jq -j` / 补一个换行后的 `diff` 比较（F1）。
6. D65 第 3 步：第一次在 `X1a` 上右键（L12020，`colIndex:2` 正确）时 Delete column 被截在窗口外；菜单开着时在编辑器右侧空白处滚轮，菜单自行关闭，没有记任何操作（之后到下一次打开前只有 `draft.write`）。把目标行滚到顶部附近后重新打开（L12023）再选。第 4 步 Delete row 是窗口边缘最后一个可见项，点之前放大确认了标签。第 5–7 步同样先把目标滚到顶部附近。滚动本身没有改内容（F4）。
7. D64-C：点 × 关掉了 macOS 自动更正气泡 `Fk ×`，保证 ⌘S 不会接受它；文字仍是 `fk`。
8. D64-C / D 的记号检查按 8 个加 `NO` 计，不是 9 个（F2）。
9. 退出时保存了窗口几何（已知偏差）。
10. computer-use 的放大图（`d64-a-zoom-T1`、标签脏点、`d78-1-zoom`、`d78-2-zoom`、`fk` 的放大）是会话内截取，**不存为文件**；文件证据是对应的 `shot.sh` 截图。

退出：System Events 点 **mdpro › Quit mdpro**，L12100 `app.quit.request`、L12102 `app.quit.check` `answer:"clean"` `dirtyCount:0`、L12112 `app.quit.commit` `deleted:0`、L12113 `app.quit` `success`。没有「Unsaved changes」提示，丢弃 0。之后 `pgrep -fl tauri-app` 为空；`fixture.orig` 的 `shasum -c` OK。

## 未见 / NOT VERIFIED

- **D64-B4 的拒绝路径**（越界列号 `mcp.table.set_cell` `fail`、无效 payload）：**NOT VERIFIED**，调用成功了（F2）。须在任何整篇写入之前复核。
- **D64-C 保存前读 store 见 `fk`**：照 brief 原文 **NOT VERIFIED**，store 在冲刷前不同步按键（F3）；在屏幕、冲刷后的 store 与磁盘上验到。
- **D64 / D65 WI-3**（`4e7b356`，HTML 粘贴参差表在行尾补齐）：**NOT RUN**，不在本构建。
- D65 的 Insert column right、Delete table 本轮没测。

完整的 EXEC 报告（英文，含逐字日志）为 `report-20261010-d64wi2-d65-d78.md`，不进仓库；截图在 Mini 的 `~/.mdpro-redesign/dtrack/reports/shots/`。
