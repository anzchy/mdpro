# D 系列真机复测记录（2026-10-02）

本轮在一个 release 构建上，把排序文档 D 表里只差真机判据的几行一次跑完：D19、D21、D22、D23、D24（DC-M、DC-R、D-1…D-6）、D25（G1、C1）、D27（d3–d6）、D31、D33。执行方是 mdpro-tester 会话加上 delegator 会话（D33、D34 E/G5b 由 delegator 跑，其余由 tester 跑）。排序文档、ledger、CHANGELOG 按本记录改写。

## 0. 测量条件

| 项 | 值 |
|---|---|
| 日期 | 2026-10-02 |
| 机器 | Apple M4，macOS 26.3.1；单块 Retina 屏，可用区 `0,33 1512x949` |
| 被测构建 | release `com.mdpro.app` v0.3.0，`src-tauri/target/release/bundle/macos/mdpro.app`，2026-10-02 10:36 由 `ef91e24` 构建 |
| 与 `e471198` 的差异 | `src/`、`src-tauri/` 无差异（`ef91e24` 之后只动了文档与测试配置） |
| 启动状态 | 每次冷启动都记 `appReady:false`，窗口 label 为 `main` |
| 证据来源 | `~/.mdpro/mdpro.log`（JSONL）、`~/.mdpro/config.json`、AX 窗口 frame、MCP HTTP 返回码 |

## 1. 结论总表

| 条目 | 结论 | 证据 |
|---|---|---|
| D33 D3 | **通过** | 冷启动 `open -a`：一条 `file.open.args_filtered`，`source:"cli"`，级别 info，`accepted:0` |
| D33 D1 | **通过** | `./d33-x.md`：`accepted:1`，经 `single_instance`，级别 info，日志不含路径；文件打开 |
| D33 D2 | **通过** | `./ghost.md`：级别 warn，`unresolved:1`，不开窗口 |
| D34 E / G5b | **通过** | 物理 Esc，ABC 输入法（D34 已于此前关闭，此处只留证据） |
| D21 | **通过** | ⌃2/⌃4 各切 5 次，`ui.toc.resolve.mismatch` 为 0 条 |
| GUI-D22-1 / D22-2 | **通过** | — |
| D23 | **通过** | 开关跨重启保持；⌘S 触发重排并记 `editor.table.auto-reformat-on-save`（由 D24 5b `8b9d8d3` 修复） |
| D19 6a / 6b | **通过** | 另见发现 F1 |
| D24 DC-M | **通过** | 连续改 4 项 → 4 对 `preferences.set` start/success，`context {partial:true}`，日志不含路径。正常退出后冷启动：Source、侧栏隐藏、One Dark、17px、autoReformat 在 UI 与 `config.json` 中全部保持。启动时多一次 `lastViewMode` 的 set，符合预期 |
| D31 | **通过** | ⌘⇧N ×4 → 每次一条 `ui.menu.select new_window` + 一条 `window.create`；`ui.menu.listen` = 5 = 窗口数；主题 浅/深/系统 各一条 select；⌘S 一对 `file.save`；`focus_check` 失败 0 |
| D24 D-4 | **通过** | 新窗口 `geometry:"default"`、`geometryReason:"no_path"`，位于 `156,71 1200x800`；main 留在 `100,100` |
| D24 D-1 | **通过** | b.md 设为 `333,177 1011x655`，关掉后经 `open -a` 重开 → `geometry:"stored"`、`geometryClamped:false`，AX frame 完全一致 |
| D24 D-2 | **通过** | 第二实例传绝对路径 → `app.single_instance`，存储的 `420,210 900x600` 原样还原 |
| D24 D-5 | **通过** | `/tmp` 写法规范化为 `/private/tmp`；符号链接 c-link.md 解析到 c.md 的已存几何 |
| D24 D-3 | **通过** | 预置 `2400x1600 @ 200,200` → `geometryClamped:true`；AX frame `0,33 1512x949` |
| D24 D-6 | **未验证** | 没有接缩放系数为 1 的外接屏 |
| D27 d3 | **通过** | 在另一窗口的陈旧行上点 Recover → `file.draft.recover` fail `in_use` / `OwnedByLiveWindow`；行被移除，不开 tab，草稿保留 |
| D27 d4 | **通过** | 用户点 Discard → `file.draft.discard` fail `in_use` / `OwnedByLiveWindow`；行被移除，草稿保留（418 B） |
| D27 d5 | **通过** | 新窗口 `file.draft.list {hiddenInUse:2, listed:0}`，不弹对话框 |
| D27 d6 | **通过** | 恢复 e（`recovered:true`），约 12 s 后、autosave 之前 `kill -9`；重启后 `file.draft.list {listed:2, relisted:1}`，对话框再次列出 e |
| D25 G1 Approve | **通过** | 提示出现在持有文档的窗口，初始焦点在 Reject；Approve → 202 `{"scheduled":true}`；`mcp.confirm table:insert_table approved` + `mcp.table.insert_table success` |
| D25 G1 Reject | **通过** | 403 `USER_REJECTED`；`outcome:rejected`；文档不变 |
| D25 G1 Timeout | **通过** | 60.004 s 时 408 `CONFIRM_TIMEOUT`；`outcome:timedOut`；提示自行关闭 |
| D25 C1 Cancel | **通过（徽标未验证）** | 窗口 L 有待确认请求时，在窗口 R 的设置里关掉服务 → 503 `CONFIRM_CANCELLED`；先 `mcp.confirm outcome:cancelled`，18 ms 内 `mcp.server.toggle {direction:off, phase:disabled}`；端口停止监听，`server.port` / `server.token` 被删除；再打开 → 47 ms 到 `phase:running`。「Stopping」徽标**未验证**（过渡只有 18 ms，肉眼看不到） |
| D24 DC-R | **失败** | 见 §2，登记为 D43 |

## 2. D24 DC-R 失败（→ D43）

**复现**：

1. 经 `open -a` 打开 b、c、d（此时 `config.json` 的 `recentFiles=[d,c,b,g1,f,e,a,…]`）。
2. 用非法 JSON 覆盖 `config.json`。
3. 经 `open -a` 打开 a.md（开出新窗口）。
4. 文件 → 最近打开：**只列出 a.md**；把焦点切回较早的 d.md 窗口后仍然只有 a.md。

**预期**：本会话的条目加上 a.md。

**另一半通过**：损坏的字节在打开和退出后都没被改动——新窗口的 `preferences.set` 以 `ParseError` 失败，什么都没写。

**未出现的日志**：App.tsx 的 catch 路径本应记一条 `preferences.recent_files.buffer` warn，但日志里没有。

**可能的根因**（读代码得出，未经测试确认；App.tsx:176-180 已由 delegator 确认）：最近文件列表是每个窗口自己的 React state（`src/hooks/useRecentFiles.ts`），而原生菜单是全应用唯一的。每个窗口都经 `set_recent_files_menu`（App.tsx:176-180）推自己的列表，最后写的窗口赢。偏好读不出来时，新窗口从空列表起步，于是 `[a.md]` 覆盖了整个应用菜单。焦点回到旧窗口也不会重推，因为 effect 的依赖只有 `[recentFiles, viewMode]`。

**复测须知（2026-10-07 补记，D43 修复后）**：这条 warn 永远记不下来——配置损坏时 `get_logging_settings` 也失败，前端 logger 落到 fail-closed（`enabled:false`），前端日志全部丢弃。修复后复测应看 Rust 侧的 `menu.recent_files.sync` warn（`outcome: "hydration_failed"`），Rust logger 用的是启动时缓存的设置。步骤见 `tests/manual-fixtures/d43-recent-menu.md`，决定见 [ADR-0051](../adr/0051-rust-owns-the-session-recent-files-list.md)。

## 3. D 条目之外的发现

| # | 级别 | 发现 | 处理 |
|---|---|---|---|
| F1 | 可能丢数据 | 开着保存时自动重排，表格某行单元格多于表头时，⌘S 会丢掉多出的格：`\| g \| h \|Z` → `\| g    \| h   \|`，「Z」消失，没有任何提示。这是 GFM 的截断语义，但是静默的 | **已登记为 D44** |
| F2 | NOTE | 每个 ⌘⇧N 新窗口都落在 `156,71`，没有错位层叠 | 仅记录，未登记 |
| F3 | NOTE（Low，已知） | 对 in-use 草稿点 Recover / Discard 会记两条：一条前端行，一条后端 success 带 `outcome in_use` | 仅记录，未登记 |
| F4 | NOTE | `mcp.http_server.stop` 只在应用退出时记（`app_exit.rs:67`）；设置里关服务记的是 `mcp.server.toggle phase:disabled` | 仅记录，未登记 |
| F5 | NOTE | 确认提示待决时，在该窗口内提示框外的任何点击都算 Reject（403，`ui.mcp_confirm.reject`） | 仅记录，未登记 |

同日的 3.8 出口复测（`20261002-stage3-exit-perf-retest.md`）据其结果登记了 D45（关完所有 tab 后 WebContent RSS 不回落）和 D46（经 `open -a` 外部打开 >10 MB 文件，无提示且留下空窗口）。

## 4. 本轮未测（设计上不在范围）

- D28：没有真机条目。
- D24 步骤 6：尚未实现。
- D25 的 ADR-0042 问题 1/2：尚未实现。
- 未被消费的偏好项（INERT prefs）：尚未接线。

## 5. 收尾

- `config.json` 已还原，字节一致（SHA-1 `8be44fa1`，SHA-256 `47cc34fb`；delegator 用 `cmp` 复核）。
- 草稿目录为空。
- MCP 服务已重新打开。
