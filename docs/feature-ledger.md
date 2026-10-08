# 功能账簿

**mdpro** · 首次建账 2026-09-17 · 分支 `frontend-backend-redesign`

一份文档，两个任务。

- **逐条查验。** Part 1 是 mdpro 声称拥有的每一项能力、它**实际**处在什么状态、代码在哪、以及怎么在跑着的 app 里确认它。它是写来对着 app 从头走到尾的。
- **找出缺口。** Part 2 和 Part 3 把 mdpro 摆在另外十个编辑器旁边，明说什么是缺的、什么是**故意**不做的、什么是别人都没有的。

这份账簿描述 **mdpro 现在有什么**。它不是 changelog：一个缺陷的修复是一次提交，不是一行；给每个缺陷开一行，这份文档就没人能读了。它也不是计划：工作项的先后与验收在 `docs/plans/`，决策在 `docs/adr/`，什么时候变的在 `CHANGELOG.md`。

## 状态图例

状态是下面五个词之一，而这个区分正是本文的全部意义：

| 状态 | 含义 |
|---|---|
| `Shipped` | 已实现，且在 app 里验证可用 |
| `Partial` | 能用，**但有一条写明的限制** |
| `Stub` | 类型、接缝或 UI 存在，行为不存在 |
| `Absent` | 没建 |
| `Unknown` | 从依赖继承、从未在此测过——**不做任何声称** |

**Stub 不是功能。这份账簿写 Stub 的地方，就不要对外描述 mdpro「有」这个东西。**

枚举是封闭的。`Shipped（仅导出）` 不是一种细微差别，是一次失败——`pnpm ledger:check` 会因此拒绝整份文档。细微差别写进「怎么确认」那一格。

`Partial` **必须**在「怎么确认」里带一条 `限制：`，写明那条限制是什么。不写明限制的 Partial，正是这条规则要挡住的东西。

## 怎么写「在哪」这一格

路径一律**从仓库根写起**，放在反引号里：`src/plugins/milkdown/imagePastePlugin.ts`，不是 `imagePastePlugin.ts`，也不是 `milkdown/imagePastePlugin.ts`。

分区相对的短写法被考虑过并且否决了：**它让同一条路径因为上面的标题不同而含义不同，于是把一行挪到另一个分区就悄悄改掉了它的声称。** 啰嗦是有意的——这一列是给「决定该去哪儿看」的人读的。

三条禁令，每一条都是因为它会**悄悄**烂掉：

- **不写行号。** `src/App.tsx:412` 在下一次编辑该文件时就过期了，而路径解析检查抓不到它——文件还在。行号那一级的细节写进「怎么确认」的散文里。
- **不写计数。** 「16 个动作」是一个有半衰期的事实。
- **不写构建产物。** `dist/`、`target/`、`coverage/` 下的路径在每一次全新 clone 上都是红的。

## 门禁

```bash
pnpm ledger:check     # 三项机器检查，有发现就退出 1
pnpm ledger:build     # 渲染 docs/feature-ledger.html
```

`ledger:check` 问三个问题：**每一条路径声称都能解析、每一个状态格都在五值枚举内、app 声明的每一个名字都被写进了某一行。** 第三项是关键的那一项——它抓的是「**没有人为它写过一行**的那个界面」。今天它覆盖 `#[tauri::command]`、`http_server.rs` 的路由、`menu.rs` 的 `MENU_*` id、`pluginConfig.ts` 的插件 id、以及 `src/stores/` 下的每一个 store。

它**不能**问一个句子是不是真的。路径能解析，不代表那一行描述的行为还存在。

## 怎么维护

**改变行为的那一次提交，重写它的那一行。** 不是后续的清理批次——留到清理批次的状态列，是没有人能信任的状态列。这跟 `CLAUDE.md` 里对 sequencing doc 的要求是同一条规则。

一次审计 pass 写成一个带日期的小节，**追加，不覆盖**，并且必须以一段「**这次没有关掉什么**」结尾。声称自己做了一次全面扫描，正是上一次 pass 存在的意义所要记录的那种过度声称。

---

## Part 1 — mdpro 现在有什么

对着 app 从头走到尾。每一行的「怎么确认」都是一个动作，不是一句「看代码」。

### 文件与文档管理

| 能力 | 状态 | 在哪 | 怎么确认 |
|---|---|---|---|
| 新建文档 | Shipped | `src-tauri/src/commands/file.rs` | ⌘N（`menu.file.new` → `create_document`），底部标签条出现一个空的 Untitled 文档 |
| 打开文件 | Partial | `src-tauri/src/commands/file.rs`, `src/hooks/useDocument.ts`, `src/utils/openWriteGuard.ts` | ⌘O（`menu.file.open` → `open_file_dialog` → `open_file`），原生对话框只列出 .md / .markdown，选中后内容载入编辑器。再打开一个**已经开着**的文件（D20，ADR-0028）：目标干净就从磁盘重新载入（「重开即刷新」照旧），日志一条 `file.open.reload_clean`；目标有脏点就**只切到那个标签**，缓冲区和脏点原样不动、不提示，日志一条 `file.open.focus_dirty`。WYSIWYG 里刚打、还在 200 ms 同步定时器里的字也算脏：判定前先 flush，flush 失败按脏处理。Open Recent 与启动路径、`?open=` 走同一个守卫 `commitOpenedDocument`。2026-09-24 真机验收（`docs/test/20260924-d20-gui-acceptance.md` G1 / G4）：脏标签 + ⌘O 只聚焦、缓冲区与脏点保留、磁盘字节不变；干净标签 + ⌘O 从磁盘重新载入。限制：想用磁盘内容覆盖一个脏标签，得先把它关掉；路径相同但 id 不同的干净标签（另存为形态：文档 id 不随路径改变）仍会被再开成第二个同路径标签，与修复前一致 |
| 最近打开 | Partial | `src-tauri/src/menu.rs`, `src-tauri/src/menu_recent.rs`, `src-tauri/src/menu_recent_merge.rs`, `src-tauri/src/commands/menu.rs`, `src/hooks/useRecentFiles.ts`, `src/hooks/useRecentFilesMenuRefresh.ts`, `src/services/recentFilesMenuService.ts`, `src/utils/recentFiles.ts` | 限制：写盘仍由各窗口各自发出，两个窗口几乎同时写时可能乱序落盘，磁盘上的 `recentFiles` 会比本次会话的列表落后一条，直到该窗口下次写入；菜单与 Rust 内存中的列表不受影响（[ADR-0051](adr/0051-rust-owns-the-session-recent-files-list.md)）。2026-10-07 起（[D43](plans/20260912-frontend-backend-sequencing-order.md#d43)）本次会话的列表由 Rust 的 `MenuState` 持有：各窗口经 `sync_recent_files_menu` 发操作（`seed` / `record` / `refresh`）而不是整张列表，Rust 合并、重建菜单并返回合并后的列表，窗口显示并保存这份回复。配置文件坏掉时新窗口不再把菜单换成只有它自己的文件，而是本会话条目加新文件，焦点在哪个窗口都一样；Rust 记一条 `menu.recent_files.sync` warn，`outcome: "hydration_failed"`（前端日志在配置损坏时 fail-closed，记不下来，所以原预期的 `preferences.recent_files.buffer` warn 看不到）；损坏的配置字节不被改写（之后的写入以 `ParseError` 失败）。2026-10-07 在 `a55e87f` 的 release 包上真机验证（`docs/test/20261007-dtrack-device-checks.md`，`tests/manual-fixtures/d43-recent-menu.md`）：配置改坏后再开 a.md，五个窗口逐个聚焦，菜单都是同一份 10 条列表（a、d、c、b 在前），恰一条 `hydration_failed` warn，损坏字节未被改写。真机 GA 2026-09-27 在 `8b9d8d3` 的 release 包上跑过（见 [D24](plans/20260912-frontend-backend-sequencing-order.md#d24)），ADR-0032 GA-11、GA-12 通过：已存两条时冷启动一次带三个文件，合并成五条而不是一条；再开一个已在表里的文件，它移到表头、不重复；普通启动不写盘（`open -a` 代替 Finder / Dock 拖放，走同一个 open-documents 事件）。列表写进 `~/.mdpro/config.json` 的 `recentFiles`，退出重开还在。启动时偏好读完之前打开的文件先进缓冲，读完后随 `seed` 一起交给 Rust 合并（去重，上限 10），不会拿一条的列表盖掉存量；读偏好失败时不写盘；普通启动不写 `recentFiles`。File → Open Recent 最多 10 条历史，菜单项 id 形如 `menu.file.recent.0`，点任意一条直接打开该文件 |
| 保存 | Shipped | `src-tauri/src/commands/file.rs`, `src/services/saveService.ts`, `src/utils/saveResult.ts` | 改几个字后 ⌘S（`menu.file.save` → `save_file`），标签上的脏点消失。保存进行中的编辑不被覆盖（D19）：在一个已有路径的文件上按 ⌘S，紧接着在同一次输入里再敲一个字符——脏点仍在、编辑器里有这个字符，`cat` 磁盘文件里没有它，日志多一条 `file.save` `{editedDuringSave:true}`；再按 ⌘S 脏点消失（WI-6 2026-09-23 真机实测）。**别在另存为面板开着时试**：NSSavePanel 是 app 模态，点编辑器不换焦点、按键全进文件名框。保存完成时由 `resolveSaveResult` 重读 store：内容未变才清脏，变了只记 `path` / `lastSaved`，保存中被关掉的标签不会复活 |
| 另存为 | Stub | `src-tauri/src/commands/file.rs`, `src/types/preferences.ts` | ⌘⇧S 按下去没有任何反应；偏好设置里有 fileSaveAs 这一项，但没有处理器也没有菜单项。未命名文档按 ⌘S 会经 `save_file_dialog` 弹出原生保存对话框，那条路是通的 |
| 关闭文档 | Shipped | `src-tauri/src/commands/file.rs` | 有未保存改动时按 ⌘W（`menu.file.close` → `close_document`），先弹确认再关 |
| 拖拽打开文件 | Partial | `src/App.tsx`, `src/utils/openWriteGuard.ts` | 从 Finder 拖一个 .md 文件丢进窗口，直接打开。拖一个**已经开着**的文件进来：干净则从磁盘重新载入，有脏点则只切到那个标签、改动不丢（与 ⌘O 同一守卫 `commitOpenedDocument`，日志 `file.open.focus_dirty` / `file.open.reload_clean`）。2026-09-24 真机验收（`docs/test/20260924-d20-gui-acceptance.md` G3）：从 Finder 把脏文件拖进窗口，只切到该标签、改动保留，`file.open.drop` 记 `openedInNewWindow:false`。限制：路径相同但 id 不同的干净标签（另存为形态：文档 id 不随路径改变）仍会被再开成第二个同路径标签，与修复前一致 |
| Finder 文件关联 | Partial | `src-tauri/tauri.conf.json`, `src-tauri/src/main.rs`, `src-tauri/src/services/open_route/lookup.rs`, `src-tauri/src/services/open_route/plan.rs`, `src-tauri/src/services/open_route/tauri_glue.rs`, `src/hooks/useOpenInWindow.ts` | 在 Finder 里双击任意 .md 文件，由 mdpro 打开。mdpro 未运行时，文件进首个窗口 `main`。mdpro 已在运行时，`RunEvent::Opened`（`src-tauri/src/main.rs`）把每个路径交给 `route_external_open`（D29，ADR-0033 Accepted）：路径两侧 canonicalize 后在 MCP shadow store 里找已开着它的窗口，只算 `routable` 且仍存活的窗口，多个命中依次按有脏点、最近聚焦、最小 label 取一个。命中就取消最小化、显示并聚焦那个窗口，`emit_to` 只给它发 `file:open-in-window`，`src/hooks/useOpenInWindow.ts` 按 documentId 切到那个标签，不读盘不写入（标签已不在才走 `openDocumentFromPath`）。没有命中，或 emit 出错，照旧开进新窗口，日志后跟一条新窗口的 `window.open`。日志 `file.open.external {appReady:true, source:"finder"}` 与 `file.open.route`（outcome 为 existing-window / new-window，前端另记 focused-tab / opened-path / ignored-label），不带内容。2026-09-25 在 `3b6c157` 的 release 包上真机验收 G-D29-1..7 全部通过（`docs/test/20260925-r7-d29-d24-gui-acceptance.md`）：聚焦已开窗口与标签、取消最小化（这一路约 545 ms，平时约 5 ms）、`emit_to` 投递、`/tmp` 与符号链接别名不出重复标签都实测过。限制：进行中的打开不可见，两次很快的双击仍可能开出两个窗口；关闭提示正开着的窗口不可路由，会另开新窗口；webview 卡死时这次打开被吞掉，没有超时或回退；Finder 打开一个干净但已过时的标签只聚焦、不再从磁盘刷新（⌘O 仍会刷新）；没有命中时兜底开出的新窗口会读该文件存下的几何（经 `restore_geometry_for`，没有记录则按屏幕适配默认尺寸、由窗口服务器层叠），这一还原 2026-10-02 真机验证通过（D24 D-1：`open -a` 重开 b.md 得 `geometry:"stored"`、AX frame 一致，`docs/test/20261002-dtrack-device-retest.md`，见「按文件记忆窗口几何」行）；超过 10 MB 的文件从 Finder / `open -a` 打开时被拒绝，弹一次「Failed to open file」、窗口保留（[D46](plans/20260912-frontend-backend-sequencing-order.md#d46)，2026-10-07 已修并在 `a55e87f` 的 release 包上真机验证，运行中与冷启动两种情形都试过，`docs/test/20261007-dtrack-device-checks.md`） |
| 单实例启动路由 | Partial | `src-tauri/src/launch.rs`, `src-tauri/src/launch_args.rs`, `src-tauri/src/main.rs`, `src-tauri/src/services/open_route/plan.rs`, `src-tauri/src/services/open_route/tauri_glue.rs`, `src/hooks/useOpenInWindow.ts`, `src/utils/openWriteGuard.ts` | mdpro 已在运行时再以带文件参数的方式启动第二个进程，不会留下第二个进程：单实例插件回调（`src-tauri/src/main.rs`）把这批路径交给 `route_external_open`（`Source::SingleInstance`）。已在某个可路由窗口开着的路径，与「Finder 文件关联」行同一规则：聚焦那个窗口，经 `file:open-in-window` 切到那个标签，不读不写（D29，ADR-0033 Accepted；2026-09-25 真机验收通过，`docs/test/20260925-r7-d29-d24-gui-acceptance.md`：`/tmp` 原样路径与符号链接绝对路径都路由到已开的标签，只有 `main` 时对未开过的路径记 `broadcast` 并进 `main` 成新标签）。没有命中的路径保持原行为：只有窗口 `main` 一个窗口时发 `file:open` 给它（日志 `file.open.route` outcome `broadcast`），路径经 `commitOpenedDocument`：已开着且有脏点就只切到那个标签、改动保留，干净则重新载入；已有别的窗口时（`has_windows_with_documents`），开进新窗口。前端启动后向 `get_launch_paths` 取启动时的待打开路径。相对路径参数按**第二个进程**的 cwd 解析（D33，`src-tauri/src/launch_args.rs` 的 `single_instance_args`）；第二个进程的 cwd 为空或是相对路径时，相对参数被丢弃并计入 `relative_without_cwd`，不会回落到第一个进程的 cwd。每次启动记恰一条只含计数、不含路径的 `file.open.args_filtered`（`source` 为 `cli` 或 `single_instance`；除 flag 外有参数被丢则为 `warn`）。这一修复 2026-10-02 已在 `ef91e24` 的 release 包上真机验证（D33 D1–D3，`docs/test/20261002-dtrack-device-retest.md`）：在另一个目录里对运行中的 release 包执行 `<bundle>/Contents/MacOS/tauri-app ./x.md`，应打开 `x.md`，且 `grep args_filtered ~/.mdpro/mdpro.log \| tail -1 \| jq .` 显示 `source: single_instance`、`accepted: 1`、`level: info`（对照：`./ghost.md` 应记 `warn`、`unresolved: 1`）。限制：进行中的打开不可见，两次很快的启动仍可能开出两个窗口；关闭提示正开着的窗口不可路由；webview 卡死时这次打开被吞掉；命中已开窗口时只聚焦，干净但过时的标签不再从磁盘刷新；`file:open` 进 `main` 这一支的「脏则聚焦」只在 jsdom 里验证过（`tests/d20-reopen-dirty-hook.test.tsx`），真机 NOT VERIFIED——macOS 上 Finder 双击走的是 `RunEvent::Opened`，不走本回调，见「Finder 文件关联」行 |
| 编码自动检测 | Shipped | `src-tauri/src/services/encoding.rs` | 打开一个 UTF-16LE 文件，正常显示而不是乱码 |
| 编码选择对话框 | Partial | `src/components/common/EncodingDialog.tsx`, `src/App.tsx`, `src/utils/openWriteGuard.ts` | 打开一个无法确定编码的文件，弹出 UTF-8 / UTF-16LE / UTF-16BE / ASCII 四选一，选中后重新解码。解不出来的文件如果**正开着且有脏点**，不弹本对话框，只切到那个标签（`focusDirtyOpenAt`，日志 `file.open.focus_dirty`，`entry: decode-failure`）；干净的照常弹。对话框开着期间目标被弄脏（如 MCP 写入）再选编码，会被拒绝：改动保留、标签被聚焦，弹一条 toast「Kept your unsaved changes; the file was not re-decoded」，不写入最近打开。限制：有脏点的文档不能换编码重开——没有「放弃改动并重新载入」确认，留给将来专门的 Reopen with encoding 命令；错误走 `parseEncodingError` 的字符串兜底时拿不到路径，经 ⌘O 对话框这条路仍可能对脏文件弹出本对话框；解码失败出口只按路径匹配，另存为后路径已变、但 id 仍等于该路径派生 id 的脏文档不会被聚焦，本对话框照常弹出，选编码后被拒并弹 toast（ADR-0028 Known gaps (d)，不丢数据，要修得让 Rust 在 `FileError::EncodingError` 里带回路径派生 id）；换编码被拒的 toast 只在 jsdom 里验证过（`tests/d20-reopen-dirty-hook.test.tsx`、`tests/d20-encoding-refusal-message.test.ts`），真机 NOT VERIFIED（需要 MCP 写入，未取得令牌授权）。2026-09-24 真机验收 G5（`docs/test/20260924-d20-gui-acceptance.md`）：脏文件的磁盘字节改成非法 UTF-8 后 ⌘O，不弹本对话框、只切到该标签，日志 `file.open.focus_dirty {entry:"decode-failure", matchedBy:"path"}`，真实 IPC 带回的是含路径的结构化错误 |
| 保存时保留原编码 | Shipped | `src-tauri/src/commands/file.rs` | 打开一个带 BOM 的 UTF-16 + CRLF 文件，⌘S 后用 `file` 或 hexdump 看，BOM、编码、换行符都没变 |
| 原子写入保存 | Shipped | `src-tauri/src/commands/file.rs` | 保存期间强杀进程，原文件要么是旧内容要么是新内容，不会被截断成半截；文件权限位保持不变 |
| 10MB 文件大小上限 | Partial | `src-tauri/src/commands/file.rs`, `src/hooks/useDocument.ts`, `src/utils/openFailure.ts` | 尝试打开一个超过 10MB 的 .md，被明确拒绝而不是卡住。2026-10-02 阶段 3.8 出口复测（`docs/test/20261002-stage3-exit-perf-retest.md`）：10 485 761 B 被拒，恰好 10 MiB 放行；⌘O 弹「Failed to open file」、不开标签。2026-10-07 起从 Finder / `open -a` 外部打开失败（含超限）也会弹一次「Failed to open file」，日志 `file.open.report` fail 的 `context.reason` 给出原因（如 `FileTooLarge`），窗口保留（[D46](plans/20260912-frontend-backend-sequencing-order.md#d46)）。2026-10-07 在 `a55e87f` 的 release 包上真机验证（`docs/test/20261007-dtrack-device-checks.md`，M-1..M-7）：`open -a`、拖放、Open Recent、冷启动与 ⌘O 打开超限文件都恰弹一次提示、不开标签，恰好 10 MiB 放行。限制：拖放一个超限文件被拒后，窗口仍从源码切到了 WYSIWYG（切换发生在大小检查之前）；Rust 侧 `file.open` fail 日志仍带完整路径 |
| 大文件提示横幅 | Absent | — | 无论打开多大的 .md，这条横幅都不会出现——它是一段够不到的死代码。`useDocument.ts` 里 `LARGE_FILE_BYTES` 是 `10 * 1024 * 1024`，只在 `fileSize > LARGE_FILE_BYTES` 时提示；而 `src-tauri/src/commands/file.rs` 的 `MAX_FILE_SIZE` 是同一个 10MB，`metadata.len() > MAX_FILE_SIZE` 的文件一律以 `FileError::FileTooLarge` 拒开，两边比的又是同一个 `metadata.len()`。两道阈值相等，于是能触发横幅的文件永远打不开，能打开的文件永远触发不了横幅。想看到它只能先改其中一个常数 |
| 外部变更监听 | Partial | `src-tauri/src/services/file_watcher.rs`, `src-tauri/src/services/file_watcher_gate.rs`, `src-tauri/src/services/file_watcher_log.rs`, `src-tauri/src/services/file_watcher_register_log.rs`, `src/hooks/useFileWatcher.ts`, `src/hooks/useFileChangeDecisionLog.ts`, `src/utils/fileChangeLog.ts`, `src/utils/currentWindowLabel.ts` | 在外部编辑器改同一个文件并保存，mdpro 侦测到；自己 ⌘S 不会触发误报（Rust 侧自写闸 + 前端 3 s 保存抑制）。**前端不复核磁盘状态**：`check_file_modified` 命令与 `fileService.checkFileModified` 包装都在，但前端没有任何调用方（此前本行说前端用它复核，是错的）；重载判定 `decideFileChange` 只看路径与 changeType，不看 mtime。**诊断日志（D32 第一步，2026-09-26）**：`tail -f ~/.mdpro/mdpro.log \| jq 'select(.event\|startswith("file.watch.") or startswith("file.change."))'` 能看到四种行 —— 每个 notify 事件恰一条 `file.watch.event`（含被去抖、自写、忽略的，带 `kind` / `detail` / `outcome` / `mtimeMs` / `size` / `timestamp`）；每次开 / 关文件一条 `file.watch.register` / `file.watch.unregister`（带 `ok`，失败时 `error` / `warn` 级）；notify 回调报错一条 `file.watch.error`（`warn`；macOS 的 FSEvents 后端不经回调报错，Mac 上预期不出现）；前端监听器每个事件一条 `file.change.received`（`other-path` / `save-suppressed` / `scheduled` / `delivered`）；每个不同的重载判定一条 `file.change.decision`。这些行**临时记完整路径**，D32 关闭时删除或降级。只加了日志，行为未变。限制：内容没变也可能误报——2026-09-25 真机上，一个干净、mtime 未变的文件在外部打开**另一个**文件之后两次弹出「External change detected」（D32，`docs/test/20260925-r7-d29-d24-gui-acceptance.md`）；机制未证实，并列假设有扩展属性写入被报成 `Modify(Metadata)`、FSEvents 流在登记别的路径时回放、切回标签时陈旧事件再弹一次等，靠上面的日志在真机复现中区分，见 `docs/plans/20260912-frontend-backend-sequencing-order.md` 的 D32 行；经「恢复草稿」打开的文件可能根本没被监听（恢复命令已移到 `src-tauri/src/commands/draft_recovery.rs`，它与其下的 `src-tauri/src/services/draft/guarded.rs` 都不调 `watch`，未证实） |
| 外部变更重载提示 | Shipped | `src/components/common/ReloadDialog.tsx` | 在外部编辑器改同一个文件并保存，mdpro 弹出「Reload / Ignore」，选 Reload 走 `reload_file`。「Unsaved changes」对话框开着时它画在那个对话框下面、看不见，关掉对话框才露出来（D42，已登记未修，不丢数据） |
| 未保存改动确认 | Shipped | `src/components/common/ConfirmDialog.tsx`, `src/hooks/useDialogEscape.ts`, `src/utils/dataLossGuards.ts`, `src/hooks/useWindowCloseGuard.ts` | 在有脏改动时 ⌘W 或关窗口，弹出「Discard changes / Keep editing」。判定前先 flush WYSIWYG 里未落盘的编辑；关窗口时看**所有**打开的标签，任一脏即提示（此前只看活动标签）。OS 关窗监听只订阅一次：连打十个字后关窗口只弹一次（D16 WI-6 之前每次编辑都会多挂一个 handler，弹多次）。⌘Q / 菜单 Quit 确实不走这个对话框，但**不再是不提示**：它走的是原生退出守卫那一行的逐窗口提示（D16 WI-7，2026-09-23 真机验收 G2 通过）。Esc = Keep editing（D34，2026-10-02 `ef91e24` debug 包真机通过，物理键 + ABC 输入源）：Esc 走共用的 document 级捕获监听 `useDialogEscape`，与点 Keep editing 同一路径、同样记 `ui.dialog.cancel`，另记一条 `ui.dialog.escape`；MCP 确认框叠在它上面时，第一次 Esc 拒绝确认框、第二次才取消它（G5b 真机通过）。若不在栈上的模态框（重新载入、草稿恢复、编码、设置）在 DOM 里排在它后面并开着，Esc 让给那个框、不取消本对话框（D34 WI-6），那个框仍只在焦点在其内部时自己处理 Esc——这条让位路径仅单元测试验证。外部改动的重新载入提示排在它之前，会被它盖住，关掉它才露出来（D42）。WeType 等吞掉 Esc keydown 的输入法下 Esc 什么都不做，只能点按钮（[ADR-0048](adr/0048-escape-swallowed-by-an-ime-is-not-recovered-from-keyup.md)，已接受）|
| 草稿自动保存 | Shipped | `src/hooks/useAutoSave.ts`, `src-tauri/src/commands/draft.rs` | 不要先去偏好里改间隔——直接改点内容后不保存、等半分钟，`save_draft` 已把草稿写到盘上（默认间隔就是 30 秒）。本行此前让人「在偏好里把间隔设为 30 秒」再验，那一步能通过只是因为 30 秒本就是默认值：那次设置当时根本没落盘（D24，2026-09-27 第 5b 步起偏好写入才落盘）。D27 起每份草稿还记下写它的窗口（本次启动的会话 id + 窗口 label，ADR-0038 §1），供下面「启动时草稿恢复」判断草稿是否正被占用；2026-10-02 真机 D27 d3/d4 间接证实了这一点（在另一窗口的旧对话框上点 Recover / Discard 被拒，日志 `in_use` / `OwnedByLiveWindow`，`docs/test/20261002-dtrack-device-retest.md`）。旧版本写的草稿没有这个字段，照常读取 |
| 启动时草稿恢复：`list_drafts` / `recover_draft` / `discard_recovery_draft` | Partial | `src/components/common/RecoveryDialog.tsx`, `src/App.tsx`, `src/services/draftService.ts`, `src/utils/draftRecoveryOutcome.ts`, `src-tauri/src/commands/draft_recovery.rs`, `src-tauri/src/services/draft/guarded.rs`, `src-tauri/src/services/draft/live_listing.rs`, `src-tauri/src/services/draft/owner.rs`, `src-tauri/src/services/draft/visibility.rs`, `src-tauri/src/services/draft/lock.rs` | 有脏文档时强杀 mdpro 再启动，每个窗口挂载时先 `cleanup_old_drafts` 再 `list_drafts`，*Recover drafts* 对话框列出可恢复草稿，每条都有 Recover / Discard。D27 起（ADR-0038，本提交）：**正被占用的草稿不列出**——写它的窗口还活着（同一次启动、该 label 的窗口仍在），或它的文档 id / 路径已在任一窗口开着（含当前窗口，路径按 ADR-0033 的 `same_file` 比较）。**点击时再查一遍**：Recover 走 `recover_draft`，Discard 走新命令 `discard_recovery_draft`（不再调 `delete_draft`；保存成功后删草稿仍用 `delete_draft`），两者都在 Rust 里持进程级草稿锁从检查到写 / 删；草稿此刻被占用或已不在，这一行就**静默消失**，不开文档、不弹提示；其它错误保留该行并弹 toast「Failed to recover draft」/「Failed to discard draft」。恢复成功会把草稿记到当前窗口名下并刷新它的时间戳。**已恢复的草稿，若恢复它的窗口已经死掉**（恢复后、下一次自动保存前崩溃），会重新列出。已提交的退出之后 Recover 被拒。日志 `file.draft.list` / `.recover` / `.discard` 只带计数与 `outcome`（`ok` / `in_use` / `not_found` / `error`），不含 id、路径、标题或窗口 label。**怎么确认**：窗口 A 恢复一份草稿后开窗口 B，B 的对话框里不应有这一行；A 里开着一份脏文档，在 B 的旧对话框上点它的 Recover，这一行消失、B 里不出现第二份。限制：没有跨窗口的自动化测试（需要 ADR-0034 的 app 车道），`live_context` 这层 Tauri 胶水只能靠真机验（D27 d3–d6 已于 2026-10-02 在 `ef91e24` 的 release 包上真机通过，`docs/test/20261002-dtrack-device-retest.md`）；已打开的对话框不会因别的窗口的操作而刷新（没有 `drafts:changed` 广播），失效的行要点了才消失；旧版本写的、没有所属窗口的草稿只靠影子存储判断是否开着，在同步防抖窗口内可能漏判，且对它们而言对话框仍在每个窗口各弹一次；这类无主草稿一旦恢复就一直隐藏；丢弃一份已不存在的草稿按成功处理（返回 `false`），不报 NotFound |
| 按 id 读取单份草稿 | Partial | `src-tauri/src/commands/draft.rs` | 限制：`get_draft` 在 `handlers()` 里注册着、函数体也实现好了，但 `src/` 与 `tests/` 里都找不到调用点——草稿恢复实际走的是 `list_drafts` + `recover_draft`。在 DevTools 里手写 `invoke("get_draft", …)` 能拿到结果，UI 上没有任何操作会触发它 |
| 保存后清理草稿 | Shipped | `src/hooks/useDocument.ts`, `src/services/saveService.ts` | ⌘S 真正写盘之后重启，`delete_draft` 已清掉草稿，恢复对话框不再列出这个文件。**只在保存写下的正是当前内容时才删草稿**（`applySaveResult` 的 `applied` 分支）：保存进行中又改了文档，草稿保留（D19）；标签在保存中被关掉时保存不删草稿，草稿去留由关闭路径决定（丢弃关闭经 `discard_and_close` 会删掉它）。已接受的边界：保存进行中把文档关掉再按同一 id 从磁盘重开，且重开读到的内容与保存快照不同，结果按「保存中被编辑」处理而不会重新标脏——标签显示干净、store 与磁盘不一致，直到下一次编辑或保存。重开内容与快照相同则按正常保存处理 |
| 陈旧草稿清理 | Partial | `src-tauri/src/commands/draft_recovery.rs`, `src-tauri/src/services/draft/live_listing.rs` | 每个窗口挂载时调一次 `cleanup_old_drafts`，删掉超过 7 天未动、且已恢复过的草稿，恢复列表不会无限增长；未恢复的、旧格式（两文件）的和损坏的草稿不清。D27 起（ADR-0038 §5）清理**跳过正被占用的草稿**（所属窗口仍活着，或文档正开着），恢复会刷新时间戳，所以开一个新窗口不会再删掉另一个窗口刚恢复的旧草稿；影子存储读不了时一份都不删。整个扫描与删除持草稿锁。日志 `file.draft.cleanup` 只带 `deleted` / `skippedLive` 两个计数。限制：跳过规则只有单元测试——D27 d3–d6 已于 2026-10-02 真机通过，但它们测的是恢复列表与点击时复查，没有直接演练清理跳过，这条仍算真机未验；超过 7 天、所属窗口已死的已恢复草稿仍会被清掉 |
| 文件增删重命名 | Absent | — | 没有任何从 app 内删除或重命名磁盘文件的入口——没有文件树，标签上的 `×` 只关标签不动文件。仓库里 `remove_file` 的全部命中都是内部清理（原子写入的临时文件、MCP 的端口/令牌文件、一个测试），没有一条是用户可触发的 |

### 编辑 / WYSIWYG

| 能力 | 状态 | 在哪 | 怎么确认 |
|---|---|---|---|
| WYSIWYG 编辑 | Partial | `src/components/Editor/MilkdownEditor.tsx`, `src/plugins/milkdown/editSync/plugin.ts`, `src/plugins/milkdown/editSync/controller.ts`, `src/utils/milkdownFocusCarry.ts`, `src/utils/caretAnchor.ts`, `src/hooks/useMilkdownFocusRestore.ts` | 限制：整体替换重建（MCP 插入 / write_document、外部重载）后，只有重建前已聚焦的编辑器——或焦点在一个关闭后会把焦点还给本编辑器的确认框里（D38，[ADR-0055](adr/0055-a-confirm-prompt-returning-into-the-editor-carries-the-caret.md)；此时不抢确认框焦点，关框后回到原光标）——才拿回焦点；光标按新旧文档的结构 diff 映射，同一次渲染里的两次 MCP 编辑按合并 diff 落点、改写区内的光标落到区首；超过 12 000 000 的文档跳过 diff，按原偏移夹紧；10 s TTL 的余量（约 7 s）只在一台 M 系列机器上量过一次。原因与代价见 [ADR-0044](adr/0044-mcp-insert-in-wysiwyg-is-a-wholesale-replace.md)。⌃4（`menu.view.wysiwyg`）切到所见即所得，直接在渲染后的文本上编辑，撤销历史完整；编辑器实例挂在 `milkdownEditorStore` 上，表格与插入类操作都从那里取 view。在 WYSIWYG 里打一个字，标签**立即**出现脏标记；随即 ⌃2 或 ⌘S，源码与写出的文件里都有这个字（D15 修复前编辑在打开约 300 ms 后就不再进文档）。打字后马上切标签，切回去字还在（D18）。外部改了文件后重新载入，WYSIWYG 显示新内容，再打字不会把旧内容写回（入口 `src/utils/wholesaleReplace.ts`）。D37（2026-10-01）：在 WYSIWYG 里把光标放在文中打字，让外部客户端对这篇文档调 `insert_content` 或 `write_document`，重建后**立刻**接着打字——字落在原来的位置、一个不丢（修复前真机一次插入后丢了 18 个字符），`grep focus.restore ~/.mdpro/mdpro.log \| tail -1 \| jq .` 看到 `outcome: restored` 与 `durationMs`。2026-10-01 在 release 包上真机复核 8/8 通过（[D37](plans/20260912-frontend-backend-sequencing-order.md#d37)）：9,318,971 B 的长段落文档 `durationMs` 为 8；结构元素超过 25,000 的大文档会先被大文档保护切到源码模式，碰不到这条路径 |
| 行内源码显隐 | Shipped | `src/plugins/milkdown/inlineEditPlugin.ts` | 光标移进一个链接或行内代码，原始语法展开；移出去自动收起（插件 `inline-edit`）。⌃` 手动切换 |
| 粗体 / 斜体 | Shipped | `src/plugins/milkdown/typoraKeymapPlugin.ts` | 选中一段文字按 ⌘B 或 ⌘I，样式立刻切换；这组键来自插件 `typora-keymap` |
| 标题 1–6 与正文 | Shipped | `src/plugins/milkdown/typoraKeymapPlugin.ts` | 光标停在某段按 ⌘1…⌘6 变成对应标题，⌘0 变回正文 |
| 行内代码 | Shipped | `src/plugins/milkdown/typoraKeymapPlugin.ts` | 选中文字按 ⌘⇧`，变成等宽的行内代码 |
| 删除线 | Shipped | `src/plugins/milkdown/typoraKeymapPlugin.ts` | 选中文字按 ⌃⇧`，出现删除线，源码里是 `~~text~~` |
| 插入链接（WYSIWYG） | Shipped | `src/components/Editor/LinkInsertModal.tsx` | WYSIWYG 下选中文字按 ⌘K，弹出由 `linkInsertStore` 驱动的应用内模态框，填 URL 后确认 |
| 链接 URL 消毒 | Shipped | `src/plugins/milkdown/typoraKeymapPlugin.ts` | 在 ⌘K 框里填 `javascript:alert(1)` 被拒；填 `example.com` 自动补成 `https://example.com` |
| 高亮选区 | Partial | `src/plugins/milkdown/milkdownHighlightCommand.ts`, `src/plugins/codemirror/highlightPlugin.ts`, `src/plugins/core/pluginConfig.ts` | 限制：⌘⇧H 依焦点产生两种不同语法。先点进源码编辑区让 CodeMirror 持有焦点再按 ⌘⇧H，走插件 keymap，而 `pluginConfig.ts` 的 registry 配置压过插件默认值，插入原始 `<mark style=…>`；焦点不在 CodeMirror 时按 ⌘⇧H 走 `App.tsx` → `highlightCommand(view)`，发出 `==…==`。两次操作对比源码即可看到。菜单入口是 Format → Highlight Selection（`menu.format.highlight`），CodeMirror 侧的插件 id 是 `highlight` |
| `==text==` 往返 | Shipped | `src/plugins/milkdown/highlightMarkPlugin.ts` | 在源码里写 `==foo==`，⌃4 切到 WYSIWYG 显示为高亮块，⌘S 存盘后源码仍是 `==foo==` |
| 图片粘贴 | Shipped | `src/plugins/milkdown/imagePastePlugin.ts`, `src-tauri/src/commands/image.rs` | 截个图后 ⌘V（插件 `image-paste`），`upload_image` 把图片写进文档同级的 assets/ 目录，正文里自动插入引用 |
| 图片粘贴校验 | Shipped | `src/plugins/milkdown/imagePastePlugin.ts` | 粘贴一张 6MB 的 PNG，toast 指出被拒绝的原因；粘贴 GIF 同样被按格式拒绝 |
| 上传进度占位 | Shipped | `src/plugins/milkdown/imagePasteDecorations.ts` | 粘贴一张较大的图，落点处先出现「Uploading image…」占位，写完后替换成图片 |
| 未保存文档禁粘贴守卫 | Shipped | `src/plugins/milkdown/imagePastePlugin.ts` | 在未命名文档里粘贴图片，toast 提示「Save the document before pasting images」 |
| 批量多图粘贴 | Shipped | `src-tauri/src/commands/image.rs` | 一次选中多张图再 ⌘V，`upload_images_batch` 一趟处理完，收到一条汇总 toast，例如「3 images pasted, 1 failed」 |
| 图片拖放插入 | Shipped | `src/App.tsx` | 从 Finder 拖一张 png 丢到编辑区，光标处插入 Markdown 图片引用 |
| 图片缩放菜单 | Shipped | `src/components/Editor/ImageContextMenu.tsx`, `src/plugins/milkdown/imageResizePlugin.ts` | 右键点一张图，选 25% / 50% / 75% / 100%，或在自定义框里填 1–200 之间的数 |
| 图片宽度写回 Markdown | Shipped | `src/plugins/milkdown/imageResizePlugin.ts` | 设完宽度 ⌘S，源码里出现 `{mdpro-width=50%}` 标记；导出 HTML 后变成行内 style，且鼠标悬停时 tooltip 不显示这段标记 |
| 本地图片渲染 | Shipped | `src/hooks/useMilkdownImages.ts`, `src-tauri/src/commands/image.rs` | 写一个相对路径 `![](./assets/a.png)`，`resolve_image_path` 把它解析成 asset:// URL，图片直接显示；刚粘贴完的图也立刻可见 |
| 粘贴 HTML 消毒 | Shipped | `src/components/Editor/MilkdownEditor.tsx` | 从网页复制一段带 `<script>` 或 `onclick` 的富文本粘进来，脚本与事件属性被剥掉 |
| 链接点击守卫 | Shipped | `src/hooks/useMilkdownLinkClickGuard.ts` | 点 https 链接会交给系统浏览器；点 `file:` 链接不会打开任何东西，并记进日志 |
| 撤销 / 重做 | Shipped | `src/components/Editor/Editor.tsx`, `src-tauri/src/menu.rs` | ⌘Z 撤销、⌘⇧Z 重做，两种模式下都生效 |
| 剪切 / 复制 / 粘贴 / 全选 | Shipped | `src-tauri/src/menu.rs` | ⌘X / ⌘C / ⌘V / ⌘A，走原生 Edit 菜单 |
| 插件架构（注册表管理插件生命周期） | Partial | `src/plugins/core/pluginRegistry.ts`, `src/plugins/core/pluginConfig.ts`, `src/plugins/index.ts`, `src/components/Editor/MilkdownEditor.tsx` | 限制：`getMilkdownPlugins()` 零调用点，registry 只管 CodeMirror；三个 Milkdown 插件是被 `MilkdownEditor.tsx` 直接 import 进去的，它们在 `pluginConfig.ts` 里的 `enabled` 开关是装饰品。把 image-paste 的 enabled 改成 false 再粘贴图片，图片照样粘进来 |
| 拼写检查 | Stub | `src/plugins/codemirror/spellCheckPlugin.ts` | 插件 id `spell-check`：`codemirrorExtension: () => []`，`displayName` 字面写着 "Spell Check (Stub)"。故意拼错一个词，不会有任何标注 |
| 专注模式 / 打字机模式 | Stub | `src/plugins/codemirror/focusModePlugin.ts`, `src/plugins/codemirror/typewriterModePlugin.ts`, `src/plugins/core/pluginConfig.ts` | 插件 id `focus-mode` 与 `typewriter-mode`：注册了，默认关，没有任何设置 UI 能打开。翻遍 ⌘, 的十个设置页也找不到开关 |
| WYSIWYG 下的数学公式排版 | Absent | — | ⌃4 切到 WYSIWYG，输入 `$E=mc^2$` 仍是字面文本，不会排版。Phase 2，决策 B3 |
| WYSIWYG 下的脚注渲染 | Absent | — | ⌃4 下输入 `[^1]` 与脚注定义，两者都以字面文本显示，没有跳转也没有回链。同 B3 |
| WYSIWYG 下的查找替换 | Absent | — | ⌃4 下按 ⌘F 不会出现查找面板；⌃2 切回源码模式才有 |

### 表格

| 能力 | 状态 | 在哪 | 怎么确认 |
|---|---|---|---|
| 插入表格对话框 | Shipped | `src/components/Editor/TableInsertModal/index.tsx`, `src/plugins/milkdown/table/insertTable.ts` | ⌘⌥T 或 Format → Insert Table（`menu.format.insert_table`），弹出由 `tableInsertStore` 驱动的对话框：在 10×10 网格上悬停选行列，或直接填 1–50 的数字，下方有实时读数 |
| 表格右键菜单（WYSIWYG） | Shipped | `src/components/Editor/TableContextMenu/index.tsx` | ⌃4 下右键点表格，出现分五组共 15 个操作（插入 4、移动 4、对齐 3、格式 1、删除 3），方向键可以在菜单里上下走 |
| 表格右键菜单（源码） | Shipped | `src/components/Editor/SourceTableContextMenu/index.tsx` | ⌃2 下右键点一段 Markdown 表格，同样的 15 个操作（插入 4、移动 4、对齐 3、格式 1、删除 3），直接改原始文本 |
| 插入行 / 列 | Shipped | `src/plugins/milkdown/table/actionDescriptors.ts` | 光标停在某个单元格，⌘⌥↑ / ⌘⌥↓ 上下加行，⌘⌥← / ⌘⌥→ 左右加列 |
| 删除行 / 列 / 整表 | Shipped | `src/plugins/milkdown/table/actionDescriptors.ts` | ⌘⌥⌫ 删当前行或列，⌘⌥⇧⌫ 删整张表 |
| 移动行 / 列 | Shipped | `src/plugins/milkdown/table/actionDescriptors.ts` | 右键菜单里选上移 / 下移 / 左移 / 右移；在第一行或最后一列时对应项是灰的 |
| 列对齐 | Shipped | `src/plugins/milkdown/table/actionDescriptors.ts` | 右键菜单里选左 / 中 / 右对齐，三者互斥，当前那个有选中标记，源码分隔行的冒号随之变化 |
| 重排表格 | Partial | `src/utils/tableEdits/applyEdit.ts`, `src/plugins/milkdown/table/contextMenu.ts` | 限制：WYSIWYG 下 `contextMenu.ts` 直接返回 false，菜单项可点但静默无操作；只有源码模式真正生效。源码下这一项（及其他会重写表格行的右键编辑，`src/utils/tableEdits/edits.ts`）仍按 GFM 截断：某行单元格多于表头时，多出的格被静默丢掉——与 ⌘S 自动重排（D44 后会保留并补齐列）不一致，延后处理，已登记为 D49（`frontend-backend-redesign` 的 `320ae71`；[ADR-0052](adr/0052-format-on-save-widens-tables-to-the-widest-row.md)）。⌃2 下对一张列宽参差的表用「重排表格」，竖线对齐；⌃4 下点同一项，什么都不会发生 |
| 保存时自动重排 | Partial | `src/hooks/useDocument.ts`, `src/services/saveService.ts`, `src/components/common/settings/MarkdownSettings.tsx`, `src-tauri/src/models/preferences.rs` | 限制：⌃4（WYSIWYG）下 ⌘S 仍保不住多于表头的单元格——remark-gfm 载入时就把它们丢了；D44 的修复只在 ⌃2 源码模式生效；源码右键菜单里会重写表格行的编辑与 MCP/HTTP 表格操作仍按表头截断（另立 D49）。**D44（2026-10-07 代码已修，同日在 `a55e87f` 的 release 包上 ⌃2 真机验证，`docs/test/20261007-dtrack-device-checks.md`，`tests/manual-fixtures/d44-overflow-cells.md`：六张表都加宽，存盘字节与预期一致，恰 6 条 `editor.table.format-widened`）**：某行单元格多于表头时，⌘S 重排不再丢格，而是把整张表加宽到最宽那一行——表头补空格、新列对齐为 `---`、短行补空格，并记一条 `editor.table.format-widened`（只有起止偏移和列数，无单元格文本）；不提示（[ADR-0052](adr/0052-format-on-save-widens-tables-to-the-widest-row.md)）。2026-10-02 真机发现时多出的格被静默丢掉。2026-10-02 在 `ef91e24` 的 release 包上真机验证（D23、D19 6a/6b，`docs/test/20261002-dtrack-device-retest.md`）：⌘, → Markdown 里勾上，关掉设置再打开仍是勾着的，`~/.mdpro/config.json` 的 `markdown` 里有 `autoReformatTablesOnSave: true`；随后 ⌘S，磁盘写的是重排后的表格，内容真的变了时日志有一条 `editor.table.auto-reformat-on-save`。`useDocument.ts` 每次保存都现读偏好，所以改了不用重启。接线：磁盘写重排后的快照，编辑器只在保存期间没被编辑时才换成它（D19）；围栏代码块里的 `\|` 行不当表格重写。首格为空的行（`\| \| x \|`）重排后 `x` 仍在第 2 列——D41（2026-10-02）之前解析器把空首格丢掉，重排会把整行左移一列，属数据损坏，已修，等真机复核。**历史**：本行此前是 Stub——2026-09-23 WI-6 真机实测这个开关是死的（D23），根因是 D24 那道环境探测（查 `window.__TAURI__`，而本项目没开 `withGlobalTauri`），写入一次也没抵达 Rust；2026-09-27（ADR-0031 第 5b 步，`8b9d8d3`）改用 `isTauri()` 后才接通。更早还把账算在 Rust `MarkdownConfig` 缺 `auto_reformat_tables_on_save` 上，那个缺口 2026-09-23 已由 ADR-0031 步骤 4（WI-5）补上，但它从来不是拦路石 |
| Tab 单元格导航 | Partial | `src/plugins/milkdown/typoraKeymapPlugin.ts`, `src/plugins/codemirror/sourceTableTabNav.ts`, `src/plugins/codemirror/sourceTableTabOwnership.ts` | ⌃4 下在单元格里按 Tab 跳下一格、⇧Tab 跳上一格；在最后一格按 Tab 会新建一行并把光标放进去。⌃2 下同样跳格（D40 已修，2026-10-02 release 包 @ `a12937d` 真机确认）。⌃2 下空单元格里也能跳格，末格 Tab 只追加一行、不多出空行，一次 ⌘Z 撤销；分隔行、首个表头格 ⇧Tab、表格 / 散文混合选区按 Tab 被吞；⌘S 自动重排不再把空首格的内容左移（D41，2026-10-02 release 包 @ `ef91e24` 真机 8/8 通过；多表格光标、守卫拒绝、withheld 文档只有单元测试）。限制：⌃2 下碰到表格却无法跳格时（分隔行、首个表头格 ⇧Tab、写入守卫拒绝、选区跨表格与散文、光标分属两个表格）按键被吞掉，什么都不变，只在 `~/.mdpro/mdpro.log` 记一条 `ui.table.tab_swallowed`——所以 ⌘A 后在含表格的文档里按 Tab 不会缩进；超出检测上限、被 withheld 的大文档里 Tab 仍会缩进表格行；紧贴在含 `\|` 的散文行下方的表格不被识别，Tab 照常缩进（ADR-0046）|
| Esc 退出表格 | Shipped | `src/plugins/milkdown/typoraKeymapPlugin.ts` | 光标在表格任意单元格里按 Esc，跳出表格 |
| 输入法安全的表格导航 | Shipped | `src/plugins/milkdown/typoraKeymapPlugin.ts` | 用中文输入法打字、候选框还开着时按 Tab，不会跳格而是交给输入法；围栏代码块里的 Tab 同样保持缩进语义 |
| 源码模式的表格识别范围 | Partial | `src/utils/tableParser/lines.ts`, `src/utils/tableParser/parse.ts`, `src/utils/tableParser/commonmark.ts` | 限制：与 GFM 不一致的另一半没有修——紧跟在一段文字后面、中间不空行的表格，GFM 认，mdpro 不认；实测语料 74 处里吻合 44 处（修之前是 40 处）。⌃2 下在一行 `\| a \|` 底下写一行 `---`，右键点它不再出现表格菜单，因为 GFM 把这两行当成一个二级标题；把 `---` 换成 `:-:` 就又是表格。分隔行或表头行前面加一个 Tab 或 4 个空格，同样不再算表格。为什么这么改见 `docs/adr/0009-narrow-source-table-detection-to-gfm.md` |
| 列数校验提示 | Shipped | `src/plugins/codemirror/lintTableColumnCount.ts` | ⌃2 下删掉某个**表体行**（不是表头行、也不是分隔行）的一个 `\|`，该行被标出与表头列数不符。删哪一行不是小事：从表头或分隔行删 `\|` 会让整张表不再被识别为表格，于是一条提示都不出现——那是另一条代码路径，也正是 2000 行表格上曾经卡住编辑器的那条 |
| 当前单元格高亮 | Shipped | `src/plugins/codemirror/sourceTableCellHighlight.ts` | ⌃2 下把光标移进表格，所在单元格有可见的高亮 |
| 列宽拖拽 | Shipped | `src/components/Editor/MilkdownEditor.tsx` | ⌃4 下拖动两列之间的竖线改列宽；只在本次会话有效，不写进 Markdown |
| 跨模式单元格光标同步 | Shipped | `src/hooks/useMilkdownTableCursorRestore.ts`, `src/stores/editorStore.ts` | 把光标放进第 3 行第 2 格，⌃2 / ⌃4 来回切，光标仍在同一格 |
| 宽表格滚动 | Shipped | `src/components/Editor/MilkdownEditor.css` | 插一张 15 列的表，横向滚动条出现在表格自己的容器上，整个编辑区不跟着横移 |
| HTTP 驱动的表格编辑 | Partial | `src/hooks/useMcpEvents.ts`, `src-tauri/src/services/http_server.rs` | 限制：只能从 HTTP 端点驱动，走不到 MCP——`mdpro_mcp.rs` 只注册了 get_open_documents、read_document、write_document、insert_content 四个工具，表格操作不在其中，AI 客户端调不到（与「HTTP 表格端点」是同一道墙的两面）。开着 mdpro，用 curl 带 token 打 `/api/v1/insert_table`、`/api/v1/set_cell`、`/api/v1/add_row`、`/api/v1/delete_row`、`/api/v1/add_column`、`/api/v1/delete_column`，后端发 `mcp:table_action`，`useMcpEvents.ts` 收下并把改动落到当前可见的编辑器里。D41 修复前（2026-10-02 之前），对首格为空的行（如 `\| \| x \|`）调 `set_cell` 会写进错误的列——第 0 列会覆盖 `x`；`add_row`/`delete_column` 同样错列。D41 解析器修复后这三个端点都落在正确的列。限制补充：这些表格操作（`src/utils/tableMcp.ts`）仍按 GFM 截断——目标表某行单元格多于表头时，任何一次编辑都会把多出的格静默丢掉，与 ⌘S 自动重排（D44 后保留并补齐列）不一致；延后处理，已登记为 D49（`frontend-backend-redesign` 的 `320ae71`；[ADR-0052](adr/0052-format-on-save-widens-tables-to-the-widest-row.md)） |

### 源码模式

| 能力 | 状态 | 在哪 | 怎么确认 |
|---|---|---|---|
| 源码编辑 | Shipped | `src/components/Editor/Editor.tsx` | ⌃2（`menu.view.source`）切到原始 Markdown，有语法着色、行号和当前行高亮 |
| 查找与替换 | Shipped | `src/components/Editor/extensions/search.ts` | ⌃2 下 ⌘F 打开查找面板，⌘G / ⌘⇧G 跳下一个 / 上一个，⌘H 打开替换 |
| 源码模式标题级别 | Shipped | `src/plugins/codemirror/headingPlugin.ts` | 光标停在某行按 ⌘1…⌘6（插件 `heading`）前面补上对应数量的 `#`，⌘0 清掉；光标不会跳位 |
| 提升 / 降低标题级别 | Shipped | `src/plugins/codemirror/headingPlugin.ts` | 在一行上反复按 ⌘- 一路降到 H6 就停住，反复按 ⌘= 一路升回纯文本 |
| 源码模式插入链接 | Partial | `src/plugins/codemirror/linkPlugin.ts`, `src/components/Editor/LinkInsertModal.tsx` | 限制：走 `window.prompt`，而 rule 30 §6 禁止它，打包后很可能根本不弹窗；WYSIWYG 的 ⌘K 走 `LinkInsertModal`，是好的那条路。用 `pnpm tauri build` 出的包在 ⌃2 下按 ⌘K，与 `pnpm tauri dev` 下的表现对比即可看出。这条路的插件 id 是 `link` |
| 隐藏 Markdown 语法标记 | Shipped | `src/plugins/codemirror/wysiwygDecorationsPlugin.ts` | ⌃2 下光标不在的行（插件 `wysiwyg-decorations`），`## ` 收成 `H2` 徽标，列表项收成 `•`，引用收成 `>`，围栏收成 ``` 徽标；光标移回该行恢复原始语法 |
| 行注释切换 | Shipped | `src/components/Editor/Editor.tsx` | ⌃2 下 ⌘⌥/ 把当前行注释掉，再按一次取消 |
| 代码块缩进 / 反缩进 | Shipped | `src/plugins/milkdown/codeBlockIndentCommand.ts` | 在围栏代码块里选中几行按 Tab 整体缩进 4 空格，⇧Tab 反缩进 |
| 括号自动配对 | Partial | `src/components/common/settings/MarkdownSettings.tsx` | 限制：真机未验（ADR-0032 GUI 验收）。输入 `(` 自动补 `)`；在 ⌘, → Markdown 里关掉，当场就不再自动补（走 CodeMirror compartment）；2026-09-27（ADR-0031 第 5b 步，`8b9d8d3`）起这一项落盘——关掉设置再打开仍显示「关」，重启后启动水合经 `applyAutoPair` 仍是关着的。此前（D24）只改得动本次会话 |
| 自动换行与缩进宽度 | Partial | `src/components/common/settings/EditorSettings.tsx` | 限制：真机未验（ADR-0032 GUI 验收）。在 ⌘, → Editor 里切换 word wrap 与 2 / 4 空格，编辑器当场生效；2026-09-27（ADR-0031 第 5b 步，`8b9d8d3`）起两项都落盘——关掉设置再打开仍是所选的值，重启后启动水合经 `applyEditorPref` 还原。此前（D24）只改得动本次会话，重开即回到默认（换行开、4 空格） |
| 代码块主题 | Shipped | `src/components/common/settings/AppearanceSettings.tsx` | 2026-10-02 在 `ef91e24` 的 release 包上真机验证（D24 DC-M，`docs/test/20261002-dtrack-device-retest.md`）：换成 One Dark 后正常退出、冷启动，UI 与 `config.json` 都保持。在 ⌘, → Appearance 里把代码主题从 Default 换成 One Dark，⌃2 下的着色立刻变；2026-09-27（ADR-0031 第 5b 步，`8b9d8d3`）起这一项落盘——关掉设置再打开仍是 One Dark，重启后启动水合经 `applyCodeTheme` 还原着色。此前（D24）只改得动本次会话 |
| 大文档性能保护 | Partial | `src/utils/largeDocumentGuard.ts`, `src/utils/largeDocumentDegradeLog.ts`, `src/utils/sourceTableWithheldLog.ts`, `src/utils/sourceTableVerdict.ts`, `src/stores/editorStore.ts`, `src/plugins/codemirror/sourceTableExtensions.ts`, `src/hooks/useSourceTablesWithheld.ts`, `src/App.tsx` | 限制：⌃4 与 ⌃2 **各有一条判据**，三个计数都在同一趟前向扫描里算完，不解析 Markdown、不额外分配内存。**⌃4 这一面**是**两个计数对两条阈值，任一条超了就降级**——结构元素数（ADR-0016，`docs/adr/0016-large-document-guard-predicate-is-a-source-structure-score.md`）= 换行数 +（竖线数 − 表格行起始数），阈值 25,000；最长行长度（ADR-0019，`docs/adr/0019-large-document-guard-adds-a-longest-line-trigger.md`）以 UTF-16 码元计，阈值 1,000,000。两条都是 `<=` 放行；`fileSize` 已从判据输入里彻底删除，字节数不再参与判断。ADR-0019 是对 ADR-0016 的**扩展而非取代**。降级会写一条 `editor.large_document.degrade`（warn / fail）到 `~/.mdpro/mdpro.log`，载荷带 `trigger`、`elements`、`longestLine`、当时生效的两条阈值与文档 id `documentId`（UUID，非内容）。**⌃2 这一面**（[ADR-0022](adr/0022-source-mode-gets-its-own-guard-keyed-on-table-row-density.md)，已实现；真机 MQ-1..MQ-4 见本行末）：同一趟扫描多数一个「表格行起始数」（行首跳过空格与制表符后第一个字符是 `\|` 的行；NBSP 与 `\r` 不跳过），阈值 `SOURCE_TABLE_ROW_THRESHOLD = 50_000`，`<=` 放行；超过则**不切模式**，只对这份文档卸掉源码模式的四个表格扩展（表格识别、Tab 键位、单元格高亮、列数检查器，四个一起卸），表格右键菜单与表格快捷键也对它停用（右键出系统原生菜单、不解析表格），弹一次「This document has too many table rows. Table editing tools are turned off for it.」并写一条 warn 级 `editor.large_document.source_tables_withheld`（载荷带 `tableRows`、`sourceTableRowThreshold` 与 `documentId`）。⌃2 下**每份文档每个会话只判一次**（裁定存在 editorStore 的 `sourceTableVerdicts`，首个裁定生效），不是每次按键重扫；⌃4 行为不变。仍然是 Partial 的几点：**（1）⌃4 两条阈值的证据都很薄**——结构阈值只拟合在五份约 472 KB 的语料上，每份一次有效测量、同一台机器；行长阈值干脆**没有拟合**，实测只有两个点（359,285 码元 / 155 ms 放行，7,583,742 码元 / 259,483 ms 拦下），1,000,000 是在这中间整整一个数量级的空白里随手取的整数；**（2）⌃4 除了换行和行长以外，对行内结构仍然失明**——一份 12 行、每行 900,000 字符的文档结构分是 11、最长行 900,000，两条阈值都过得去，却带着 10.8 MB 行内内容进了 ⌃4；**（3）竖线算术两个方向都会错**——围栏代码块里的 `\|` 被当成单元格、以 `\|` 开头的代码行也被算成表格行起始（高估，⌃2 的计数原样继承），省略首尾竖线的表格行被少算（低估）；**（4）⌃2 的 50,000 是政策判断不是读数**（按实测兑换率约合一次光标移动 30.0 MB；密度曲线在 1,000 行以上严格线性、没有拐点，只能给兑换率给不出阈值；50,000 约为唯一实测会卡的文档 232,981 行的五分之一）；**（5）⌃2 护栏只限制损害范围，不修代价**——50,000 行以下的文档一切照旧，D12 的对象图（见下）原样还在；每次打开时的解析代价也不受这条护栏约束；**（6）⌃2 裁定按会话粘住**——删掉行降回阈值以下，工具要重开文档才回来；编辑或同一 id 外部重载涨过阈值，也沿用打开时的裁定；**（7）挂载时、裁定落地之前仍会做一次表格解析**。⌃2 上定位过的代价：**`tocService` 的 O(n²) 已修**——过去对每个标题都把文档从头切一遍数换行，TOC 不分模式都解析；同机对照（dense-math.source.md，性能语料未入库，9,110,964 字符、70,886 个标题）行号计算 152,551 ms → 24 ms，输出校验和一致。**表格整表拷贝已修（D11）**——`TableModel.raw` 过去是急求值的 `src.slice(start, end)`，而源码模式的光标上下文路径（`src/plugins/codemirror/sourceTableDetection.ts` 里的 `tableContextField`，`docChanged \|\| selection` 两者之一成立就重跑）从不读它；现在是惰性记忆化 getter。**对象图没修（D12）**：实测（2026-09-22，Node，每档独立进程、`--expose-gc`，合成 9,785,220 字符 / 232,981 行的四列表格文档）一次 `parseTableAtOffset` 返回 931,924 个单元格、保留 120,458,072 B，一次光标移动连同行源重建是 139,037,640 B；`src/utils/tableParser/find.ts` 的 `findCell` 对 `model.cells` 线性扫描，由 `src/plugins/codemirror/sourceTableCellHighlight.ts` 在每次光标移动时调用，要修得改单元格查找的契约，属于设计决定。**列数检查器强制求值 `raw` 已修（D13）**——`src/plugins/codemirror/lintTableColumnCount.ts` 改为逐行走表，`slice()` 由 1 降到 0。**整机复测 2026-10-02 做了**（阶段 3.8 出口复测，`ef91e24` 的 release 包，`docs/test/20261002-stage3-exit-perf-retest.md`）：9.96 MB 的五份 Source 档全部打开并在 ≤15 s 内回到空闲（large-table.source 打开 25 ms 并卸掉表格扩展），门禁二时的不收敛未再出现；dense-math.source 首次切标签有过一次 8–12 s 的输入延迟（n=1，未复现，没取 `sample`）；关掉所有标签后 WebContent RSS 停在约 1.75 GB 不回落（[D45](plans/20260912-frontend-backend-sequencing-order.md#d45)，疑似泄漏，未修）。release 包没有 DevTools，所以 ⌃2 这一面只有这些观察值，没有逐次就绪毫秒数。⌃4 确认：用 `node scripts/perf/generate-corpus.mjs <目录>` 生成语料，在 ⌃4 下打开 `large-table.wysiwyg.md`（471,880 B，结构分 57,190）或 `many-short-nodes.wysiwyg.md`（471,867 B、零表格，结构分 32,657）：都会弹出「This document is too complex for WYSIWYG. Switched to Source mode for performance.」并自动切到源码模式——这两份在旧的 500KB 字节阈值下都是放行的，正是 ADR-0004 记的 D6 漏判。再打开 `very-long-line.source.md`（9,961,475 B，结构分只有 3，最长行 7,583,742 码元）：也会弹同一条提示并降级，由行长这条触发——这份语料实测冷开阻塞 259,483 ms（`docs/test/20260921-d5-d6-real-device-measurement.md`）。打开 `dense-math.wysiwyg.md`（471,942 B，结构分 20,664）或 `very-long-line.wysiwyg.md`（471,862 B，结构分 3，最长行 359,285 码元）则两条阈值都不触发，停在 ⌃4。四份 472 KB 语料的结构分与 D6.1 实测冷开阻塞严格同序（`docs/plans/20260920-d61-wkwebview-sweep-record.md`：12,004 ms / 7,409 ms / 1,793 ms / 0 ms）。确认日志：降级后跑 `grep large_document.degrade ~/.mdpro/mdpro.log \| tail -1 \| jq .`，应看到 `context.trigger` 为 `structure` / `line-length` / `both` 三者之一。D11 肉眼看不出来，改用计数确认：`npx vitest run tests/table-parser-lazy-raw.test.ts`。⌃2 确认：单测 `npx vitest run tests/large-document-guard.test.ts tests/large-document-guard-call-site.test.ts tests/source-tables-withheld-log.test.ts tests/editorStore-source-tables-withheld.test.ts tests/source-table-verdict.test.ts tests/source-table-extensions.test.ts tests/use-source-tables-withheld.test.ts tests/source-table-context-menu-withheld.test.tsx`（全套 2352 通过、0 失败）；真机 MQ-1..MQ-4（⌃2 打开 `large-table.source.md`：恰好一次提示、装订线无表格三角、Tab 为原生缩进、右键出原生菜单、表格快捷键不改文本；敲 20 个字后 `grep -c editor.large_document.source_tables_withheld ~/.mdpro/mdpro.log` 只多 1；小表格文档工具照常；两份文档来回切换工具跟着文档走）**2026-09-22 已在 `c9a1698` release bundle 上执行、四项通过**（`docs/test/20260922-adr0022-mq.md`）；唯一未验：WYSIWYG 打开大表格文档时「降级提示 + 护栏提示」两个提示能否都被看到——提示是单槽 3 s，后一个替换前一个，截屏采样不到，日志两行齐全 |

### 导出

| 能力 | 状态 | 在哪 | 怎么确认 |
|---|---|---|---|
| 导出 HTML | Shipped | `src-tauri/src/commands/export.rs`, `src/utils/headingIdentity.ts` | ⌘⇧E 或 File → Export HTML（`menu.file.export_html`）；前端先用 `render_markdown` 渲染，再把 body 交给 `export_rendered_html` 落盘，产出一个带样式、可单独打开的 .html 文件。标题锚点在一篇文档内唯一：导出 `# x` / `# x` / `# x-1` 三行，得到的 `id` 是 `x` / `x-1` / `x-1-1`（第三行不再和第二行撞成同一个 `x-1`）；只有 emoji 的标题得到 `heading`、`heading-1`，不会出现空的或以 `-` 开头的 `id`。三个活着的 slug 生成面（`tocService.ts`、`exportService.ts`、`markdown.rs`）由 `tests/render-fixtures/heading-identity.json` 和它的两个 runner 钉住。标题叫 `Title` / `Name` / `Body` / `Location` / `Forms` 时锚点同样存在：导出 `# Title` 后在 HTML 里能看到 `<h1 id="title">`，早先它会被 DOMPurify 的 `SANITIZE_DOM` 悄悄剥成只剩 `data-heading-id`，ADR-0003 B′ 关掉了那道防护（`src/services/sanitizerPolicy.ts` 的 `sanitizeExportFragment`，只给导出用、绝不进 App 活 DOM） |
| 数学公式 | Partial | `src/services/mathRender.ts`, `src-tauri/src/services/markdown.rs` | 限制：只在 Rust 渲染面／导出排版，导出走 MathML；WYSIWYG 与源码模式下 `$…$` 是字面文本。写 `$$E=mc^2$$` 后 ⌘⇧E，用浏览器打开导出的 HTML 能看到排版好的公式，且页面不加载任何 JS |
| 脚注 | Partial | `src-tauri/src/services/markdown.rs` | 限制：同上，只在导出渲染，WYSIWYG 下 `[^1]` 是字面文本。写一组 `[^1]` 引用与定义后 ⌘⇧E，导出的 HTML 里点引用跳到脚注，脚注末尾的 `↩` 能跳回来 |
| 自动链接与 emoji | Shipped | `src-tauri/src/services/markdown.rs` | 正文里写一个裸的 `https://example.com` 和一个 `:smile:`，⌘⇧E 后前者变成可点链接，后者变成 emoji |
| GFM 渲染 | Shipped | `src-tauri/src/services/markdown.rs` | 导出含表格、任务列表、`~~删除线~~` 和 `==高亮==` 的文档，四者在 HTML 里都正确呈现 |
| Mermaid 图表 | Stub | `src-tauri/src/services/markdown.rs`, `src/services/sanitizerPolicy.ts` | 写一个 mermaid 围栏代码块（三反引号 + `mermaid`），三种模式下它都只是代码块，导出后也仍是代码块。消毒策略里有一整套 SVG 标签白名单是为 Mermaid 开的，Rust 侧还有 `test_sanitize_preserves_mermaid_svg` 在绿着——但 `package.json` 里没有 mermaid 依赖。这道门守着一个不存在的渲染器；那个测试证明的是消毒器不会剥掉 SVG，不是 mdpro 能画图 |
| 导出消毒 | Shipped | `src-tauri/src/services/markdown.rs`, `src/services/sanitizerPolicy.ts` | 文中嵌一段 `<script>` 或 `<a href="javascript:…">`，导出的 HTML 里已被剥除；`style` 属性一律不放行；写 `<a name="x">` 或 `<img name="body">`，导出后 `name` 属性不见了（ADR-0011，`id` 才是受支持的写法）。JS 侧的 `sanitizeExportFragment` 只用于导出落盘，`SANITIZE_DOM` 刻意关着——这是与 ammonia 的一处有记录的分歧，不是漏配；`<form>` 必须留在白名单之外，这条前置条件由 `tests/sanitizer-policy.test.ts` 用行为断言守着 |
| 默认导出目录 | Stub | `src/components/common/settings/ExportSettings.tsx` | 持久化但未被消费（D25）。在 ⌘, → Export 里用 Browse（`pick_export_folder`）选一个目录，框里显示出来了，2026-09-27（第 5b 步）起它也真的写进 `config.json`、关掉设置再打开还在；但导出侧根本没有读它的地方（`export_rendered_html` 只收 bodyHtml / title / theme），⌘⇧E 照旧每次问路径。此前它还从没落过盘（D24） |
| 内嵌样式开关 | Stub | `src/components/common/settings/ExportSettings.tsx` | 持久化但未被消费（D25）。在 ⌘, → Export 里关掉「include styles」，2026-09-27（第 5b 步）起这个值落盘、关掉设置再打开仍是「关」；但没有任何地方读它，导出的 HTML 里内联 CSS 照旧在。此前它还从没落过盘（D24） |
| 预览面板（Preview） | Absent | — | ⌃2 与 ⌃4 之间切不出第三种视图——预览窗格在 Stage-2 死代码清理里被删了。遗留的 `preview_html` 命令仍然注册着、`exportService.previewHtml` 也还在，但零调用点；同一条渲染管线上的 `render_markdown` 反而是活的，导出时由 `exportRenderedHtml` 调用 |
| 导出 HTML 片段命令 | Partial | `src-tauri/src/commands/export.rs`, `src/services/exportService.ts` | 限制：`export_html` 与它的包装 `exportService.exportHtml` 在前端零调用点，⌘⇧E 走的是 `export_rendered_html`。不删它是一条写下来的决定，不是忘了清理——理由在 knip 死代码提案 §5.6（`docs/plans/20260912-proposal-knip-dead-code-detection.md`），与可达性无关；ADR-0003 自己也写明这条理由「自成一套、不受该记录影响」。别把两件事接到一起：ADR-0003 那个失效条件——一旦 `<form>` 进入消毒白名单就必须重新评估——管的是导出消毒里关掉 `SANITIZE_DOM` 的那条决定，不是 `export_html` 的去留 |
| PDF 导出 | Absent | — | File 菜单里没有 PDF 项，⌘⇧E 只产出 HTML。这是立场不是缺口——曾评估过 headless Chromium，因体积被否 |
| Word / DOCX 导出 | Absent | — | File 菜单里没有 Word / DOCX 项。立场 |
| 打印 | Absent | — | ⌘P 没有反应，File 菜单里也没有 Print 项。全仓库没有任何 `window.print` 或打印命令；要打印只能先 ⌘⇧E 导出 HTML，再在浏览器里打。这条**不是**已记录的立场——PDF 导出是被评估后否掉的，打印从没被评估过 |
| 引文 / BibTeX | Absent | — | 写 `[@citekey]` 不会被解析，导出后仍是字面文本；没有文献库设置页 |

### 导航与界面

| 能力 | 状态 | 在哪 | 怎么确认 |
|---|---|---|---|
| 大纲侧栏 | Partial | `src/components/Sidebar/TOCSidebar.tsx`, `src/hooks/useTOC.ts`, `src/services/tocService.ts`, `src/utils/lineCounter.ts`, `src/stores/tocStore.ts`, `src/stores/tocCoordination.ts`, `src/stores/tocHierarchy.ts`, `src/utils/headingCoordination.ts`, `src/utils/tocElementResolution.ts`, `src/utils/tocSpyMode.ts`, `src/utils/tocLineSpy.ts`, `src/utils/codemirrorViewportLine.ts`, `src/hooks/useWysiwygScrollSpy.ts`, `src/utils/tocGeometrySpy.ts`, `src/utils/tocResolveMismatch.ts`, `src/utils/scrollAnchor/milkdown.ts`, `src/utils/scrollAnchor/settlePin.ts`, `src/utils/tocSurfaceWatch.ts`, `src/hooks/useSourceScrollSpy.ts`, `src-tauri/src/commands/toc.rs` | 打开一篇有 H1–H6 的文档，侧栏列出层级目录（`useTOC` 调前端的 `parseHeadingsFromContent` 解析，锚点由 `src/utils/headingIdentity.ts` 分配，结果存在 `tocStore`）；点任一条跳过去（WYSIWYG 下，点击后 1.5 s 内上方图片撑开时标题仍被钉回 40 px 锚线，用户一滚动即停手——D22、[ADR-0041](adr/0041-wysiwyg-scroll-targets-are-pinned-for-a-bounded-settle-window.md)；真机 GUI-D22-1 于 2026-10-02 通过（`docs/test/20261002-dtrack-device-retest.md`）；限制：窗口过后才加载完的图片不校正），滚动时当前标题自动高亮（**WYSIWYG 与源码两种模式都有；2026-09-22 起两种模式用同一条规则——滚动面顶端往下 40px 的锚点，见本行末 D17 那条**），父节点可折叠。**2026-09-19 起，折叠态与滚动高亮不再被击键抹掉**（身份协调，`src/utils/headingCoordination.ts` 的两趟匹配 + `tocStore.setEntries`；协调与文档作用域的纯逻辑拆在 `src/stores/tocCoordination.ts`、层级构建拆在 `src/stores/tocHierarchy.ts`，是 300 行上限所迫的抽取，`tocStore.ts` 原样再导出，导入路径没变）：折叠一节、在正文里敲一个字符、等一秒让 300 ms 去抖解析跑完，那一节仍是折叠的，高亮也还在；把那条标题改个名（文字变、层级与在标题里的序号不变），折叠态跟着走，而锚点 `href` 随文字改变——这正是 key ≠ slug。**切到另一篇文档不是重置，是存档再取回**：离开 A 时 A 的折叠集合与活动项存进 `byDocument`，B 用 B 自己那份；切回 A，A 那两样原样回来（`src/stores/tocCoordination.ts` 的 `swapDocument`，由 `tests/toc-store-coordination.test.ts` 的 S6「A → B → A」钉住）。所以两篇文档之间不串味——哪怕它们有一个 slug 相同的标题，键也按文档 id 作用域；**关掉**文档才从 `byDocument` 清出。**按契约重置的是「整份内容被换掉」那一类，共八条**，在 `tocStore.resetCoordination` 的注释里逐条点名：`openDocumentFromPath` / `openDocumentFromDialog` / `openDocumentWithEncoding` / `upsertAndActivateDocument`（草稿恢复、dev 打开）这四条打开路径算在内，是因为 `Document.id` 是路径的哈希而 `upsertDocument` 原地替换，重开一个已经开着的文件会在同一个 id 下把缓冲区换掉；再加 `createDocument`、`replaceDocument`（从磁盘重新加载，外部改动重载也走这条）、以及 MCP `write_document` / `create_document` 两条。**⌘S 保存、普通击键、MCP `insert_content` 与 `table_action` 都不重置。**这条划分由 `tests/wholesale-path-partition.test.ts` 每次跑都从 `src/` 重新推导，来了第十一个调用方就红到有人给它归类为止。**这里有一笔记在明处的代价**：同一个槽位上「删一条再插一条」与「改名」在输入上无法区分，所以新插进去的那条会继承被删标题的折叠 / 高亮状态——写在 `src/types/toc.ts` 的 RESET 条款 (c) 里。**限制：标题里的行内标记不会被剥掉。** 写 `## [锚点规范](https://example.com) 附注`，侧栏那一条的文字就是字面的 `[锚点规范](https://example.com) 附注`，而不是「锚点规范 附注」——解析时只减掉了 `#` 号本身（`HeaderMark`），`LinkMark` / `URL` / `EmphasisMark` / `CodeMark` 都留在节点范围里。这是 ADR-0012 写明留给后续工作的，由共享语料 `tests/render-fixtures/heading-identity.json` 里的 `link-in-heading` 一条钉住。**解析器在 2026-09-18 由行正则换成了 Lezer**（ADR-0012，走 `@codemirror/lang-markdown` 里 Source 模式本就在跑的那棵树，不引入新依赖）：于是 setext 标题（`标题` 下一行写 `=====`）开始出现在大纲里，围栏代码块里的 `#` 行不再被误当成标题，CRLF 文档点击跳转也落到正确位置，引用块和列表项里的标题（`> # 标题`）也开始出现——这些以前都是错的。换解析器时**反方向差点开一个口子，已在同一次改动里堵上**：`#` 后面跟制表符而不是空格的标题（`#⇥标题`）一度完全不进大纲，而 CommonMark §4.2 认这种写法、Rust 导出侧（pulldown-cmark）也照认并给它 `<h1 id="tabbed">`，是 `@codemirror/lang-markdown` 6.5.0 的 Lezer 语法把这一行当成了普通段落。解法是在**只送去解析的那份副本**上把该制表符改成空格：等长替换，不挪动任何 offset，点击跳转仍落在原文正确位置。四个面（大纲、Rust 导出、canonical 导出、`marked` 兜底）由语料里的 `tab-heading` 一条一起钉住。`#` 后先空格再制表符不受影响。**第二条限制：嵌在引用块或列表项里的制表符标题（`> #⇥标题`）仍然漏掉**——那条重写锚在行首的 `#` 串上，看不见前面的 `>` 或 `-`。代价记在 `docs/plans/20260912-frontend-backend-sequencing-order.md` 3.3 行：解析成本比行正则高两个数量级，非门禁。**2026-09-22 去掉了一个与解析器无关的二次代价**：每个标题的行号此前算作 `countNewlines(forParse.slice(0, node.from))`——对每一个标题都把整段前缀切出来从头扫一遍，代价是文档大小 × 标题数。标题密集的大文档因此会整个卡住：性能语料 dense-math.source.md（未入库，9,110,964 字符、70,886 个标题）光行号一项就要 152,551 ms。现在由 `src/utils/lineCounter.ts` 的单游标一趟扫完，同机同批 offset 测得 24 ms，输出逐条一致。「一趟」这条不变量由 `tests/line-counter.test.ts` 的 S1 用**扫描字符数**钉住而不是用毫秒（E39/G0 禁止毫秒门禁），所以它是确定性的：任何按调用重扫前缀的实现都必然红。**Rust 侧的 `get_document_headings` 命令仍然注册着，但零调用点**——它收 `content`，而前端包装 `tocService.getDocumentHeadings` 传的是 `document_id`，就算有人去调也调不通；2026-09-18 由 WI-3.2 复核。此前本行写「`get_document_headings` 解析」，那是错的。**2026-09-19 起，WYSIWYG 里两条同名标题各走各的**：点第一条去第一处、点第二条去第二处，慢慢往下滚时高亮也落在正确的那一条。此前两条都跳第一处、高亮永远停在第一条。根因不是那句「找到第一个文字相同的就 break」，而是两套去重算法对不上——我们给第二个 `# Intro` 起名 `intro-1`，Milkdown 的 `syncHeadingIdPlugin` 起名 `intro-#2`（`@milkdown/preset-commonmark@7.18.0/lib/index.js:2119-2161`），所以按 id 查必然落空，只剩那条按文字找第一个的兜底在干活；而它先试的 `data-heading-id` 在编辑面上每个标题都是 `null`，这个属性从来没人写过。现在改成按文档顺序对位（`src/utils/tocElementResolution.ts`，决策记在 [ADR-0014](adr/0014-toc-addresses-headings-by-document-order.md)）：每趟重算、不落库、不读也不写任何 DOM 属性，每个标题元素至多被占用一次，所以「两条目录项指向同一个元素」在构造上就不可能。**第三条限制：目录项数与编辑器里实际渲染出的标题数对不上时，对不上的那几条点了不动，但不会跳到别的标题去。**两种已知情形上面都提过：标题里带行内标记（`## [锚点规范](https://example.com) 附注` 的字面文字永远匹配不上 Milkdown 渲染出的 `锚点规范 附注`），以及 `> #⇥标题` 这种我们解析器看不见、Milkdown 却渲染出来的写法。这是有意选的代价——点了没反应，用户看得见也报得出来；静悄悄跳到错的标题，看不见。源码模式的跳转不走这条路径（按 `lineNumber` 交给 CodeMirror），不受影响。由 `tests/toc-element-resolution.test.ts`、`tests/use-toc-navigation-identity.test.ts`、`tests/use-toc-scroll-spy-identity.test.ts`、`tests/use-toc-source-mode-navigation.test.ts` 钉住。**2026-09-19 起，源码模式的滚动高亮回来了**：在源码（CodeMirror）里上下滚，大纲高亮跟着内容走；此前只有点击能移动高亮，滚动完全不动。**这不是新坏的，是从 `4570de3`（`feat(editor): cut ViewMode from 4 to 2`）起就死的**——那次砍掉了预览面，而预览面是当时唯一给 IntersectionObserver 提供真实 `h1`–`h6` 元素的面，于是 spy 被关掉、而不是改嫁到 CodeMirror 上；本行此前不加模式限定地宣称「滚动时当前标题自动高亮」，在源码模式下整整错了这么久。`App.tsx` 里那句 `viewMode !== "source"` 的总开关已删除，改由 `src/utils/tocSpyMode.ts` 的 `resolveSpyMode` 按 `viewMode` 分派：WYSIWYG 当时仍走 IntersectionObserver（逐字搬进 `src/hooks/useWysiwygScrollSpy.ts`，行为未变；**2026-09-22 起已换成几何判定，不再有 IntersectionObserver**，见本行末 D17 那条），源码走按行采样（`src/hooks/useSourceScrollSpy.ts`）——取滚动面顶端往下 40px 那个锚点落在第几行，再选出「行号 ≤ 锚点行」里最后一条标题（纯逻辑在 `src/utils/tocLineSpy.ts`，唯一读 CodeMirror 几何的地方收在 `src/utils/codemirrorViewportLine.ts`，滚动监听用 requestAnimationFrame 节流、每帧至多一次写入，日志只在挂载与卸载各记一条，不按帧刷）。两种模式任何时刻只有一套机制在跑，来回切模式不留下另一套的监听器或 observer。**锚点上方还没有标题时保留上一条高亮、不闪空**，WYSIWYG 现在也是这一条（跨模式手感一致，规则 30）；同名标题按行号各走各的。本行此前记过「向上滚时源码高亮与 WYSIWYG 的差距更大」，那不是阈值差异，是一个真实缺陷：`retainVisibleActiveKey` 的保留规则每帧都跑，而不是只在文末夹紧时跑，于是向上滚时已激活的标题落到锚点下方却仍在屏幕内，就被整整一屏地粘住不放。2026-09-20 由 GUI 实测发现并修掉（把保留收窄到「滚动面确实到底」才生效，见 [ADR-0017](adr/0017-source-scroll-spy-bottom-of-document-asymmetry.md)）。那 40px 必须与点击跳转的落点相等（源码是 `yMargin`，WYSIWYG 是 `scrollHeadingToAnchor` 的「标题顶端 − 40px」），否则点一条标题会被自己的滚动立刻把高亮甩到别处。**第四条限制（原第五条；原第四条「两种模式换高亮的线不同」已随 D17 消失）：两种模式都一样——滚到文档最底部时，高亮停在倒数第二条标题（够不到锚点的可能不止一条，见 [ADR-0018](adr/0018-bottom-of-document-stranded-heading-count.md)），最后一条要点一下才亮。** 2026-09-22 起 WYSIWYG 也按这条规则（[ADR-0026](adr/0026-wysiwyg-scroll-spy-is-geometric.md)），此前只有源码如此。 因为文档到底了，锚点再也升不到最后一条标题那一行。三条要求无法同时成立——选择只取决于视口几何、滚到底必然选中最后一条、点倒数第二条能保住它（而它的落点正是同一个「到底」位置）——同样的几何不可能给出两个答案，除非再引入额外状态。接受的取舍是：普通滚动选锚点所在的那一节，而**明确点过的、仍在屏幕内的标题，在夹紧的落点上保得住**（[ADR-0017](adr/0017-source-scroll-spy-bottom-of-document-asymmetry.md)）。由 `tests/use-toc-source-scroll-spy.test.ts`（T-1…T-11，其中 T-1 是在修复前必红的回归用例，T-11 钉住「点住的文末标题挺过自己的滚动、上滚越过容差后才放开」）、`tests/toc-line-spy.test.ts`、`tests/codemirror-viewport-line.test.ts`、`tests/toc-spy-mode-routing.test.ts`、`tests/use-source-scroll-spy.test.ts`（H-18 是方向性缺陷的回归用例，H-19 钉住「钩子只服从几何缝隙给出的布尔值、不自己再算一个」）钉住。**2026-09-22 修掉 D14：WYSIWYG 的滚动高亮此前在冷启动打开和切到 WYSIWYG 之后是死的**——本行开头「WYSIWYG 与源码两种模式都有」在这两条路径上不成立。原因不是 `rootMargin`（WebKit 按根高度解析上下边距，默认窗口下判定带约 260px），而是 spy 装观察器时 Milkdown 还没异步建好 `.ProseMirror`，于是观察了零个标题，之后没有任何东西让它重装；`~/.mdpro/mdpro.log` 里 22 条 `ui.toc.resolve.mismatch` 有 20 条 `domCount:0`，都紧挨 `editor.milkdown.mount`。Milkdown 替换标题元素后，观察器同样会挂在已脱离文档的旧节点上。现在 `src/hooks/useWysiwygScrollSpy.ts` 在容器上加一个 MutationObserver：只在增删的节点是或包含 `h1`–`h6` / `.ProseMirror`、且标题元素列表确实变了时才重装（纯判断在 `src/utils/tocSurfaceWatch.ts`），普通打字不触发标题扫描；`rootMargin` 与保留上一条高亮的规则都不变。冷挂载那一刻仍会记一条 `domCount:0` 的 mismatch（`tests/use-toc-navigation-identity.test.ts` N-3/N-5 钉住的既有行为，未改）。（D21 后来改了首轮上报：2026-10-02 真机 ⌃2/⌃4 往返 5 次记 0 条 `ui.toc.resolve.mismatch`，`docs/test/20261002-dtrack-device-retest.md`；冷启动那一刻未单独复测。）由 `tests/use-wysiwyg-scroll-spy-late-surface.test.ts` T1–T8 钉住；2026-09-22 在 release bundle 上真机验收：冷启动、⌃2→⌃4、切标签、两种窗口宽高比都跟随（`docs/test/20260922-d14-gui-acceptance.md`）。**2026-09-22 修掉 D17：WYSIWYG 的滚动高亮改为几何判定**（[ADR-0026](adr/0026-wysiwyg-scroll-spy-is-geometric.md)，取代原 DECISION A）。此前切模式恢复滚动后若落在一节中间，高亮停在第一条；长节内往上滚，高亮停在下一条——IntersectionObserver 只报相交变化、不报位置，判定带（视口上 33%）里没有标题时就一直保着上一条，而且没有按几何回退。现在 `src/hooks/useWysiwygScrollSpy.ts` 不再建 IntersectionObserver：容器上一个捕获阶段的被动 `scroll` 监听、原有的 MutationObserver 重装、以及一个 ResizeObserver（平台有时），都只排一次 requestAnimationFrame 重算；每帧读一次滚动面（`src/utils/scrollAnchor/milkdown.ts` 的 `findMilkdownScrollerIn`，每帧现找、不缓存）的矩形，再二分查找「顶端在滚动面顶端往下 40px 处或以上的最后一条标题」——与源码同一个 `SPY_ANCHOR_OFFSET_PX`。纯逻辑在 `src/utils/tocGeometrySpy.ts`（`pickActiveHeadingIndex` / `retainAtScrollLimit` / `selectActiveHeading`），到底判定与源码共用 `src/utils/codemirrorViewportLine.ts` 的 `isAtScrollLimit`，只在滚到底时保留已激活标题（ADR-0017）；只服务旧观察器的 `pickActiveKey` 已从 `src/utils/tocElementResolution.ts` 删除，D7 的 mismatch 告警搬到 `src/utils/tocResolveMismatch.ts`。**看得见的变化**：WYSIWYG 的高亮现在在标题升到顶端下方 40px 时换，不再是 33% 处，与源码一致，切模式时高亮不再跳一条。**点击跳转也改了**：WYSIWYG 里点大纲一条，瞬间跳到「标题顶端 − 40px」（`scrollHeadingToAnchor`，夹在可滚动范围内），不再平滑滚动——平滑滚动的中间帧会把途经的标题写成活动项，点末尾标题时就保不住它；丢掉动画是记在 ADR-0026 里的代价。二分查找假定标题顶端按文档顺序不减，`display:none` 的标题会打破这一点（ADR-0026 Consequences）。由 `tests/toc-geometry-spy.test.ts`、`tests/toc-geometry-spy-retain.test.ts`、`tests/is-at-scroll-limit.test.ts`、`tests/milkdown-find-scroller.test.ts`、`tests/use-wysiwyg-scroll-spy-d17.test.ts`（D17 回归）、`tests/use-wysiwyg-scroll-spy-geometric.test.ts`、`tests/use-wysiwyg-scroll-spy-lifecycle.test.ts`、`tests/use-wysiwyg-scroll-spy-limit.test.ts`、`tests/use-toc-navigation-wysiwyg-landing.test.ts` 钉住。2026-09-22/23 在 release bundle 上真机验收通过（WI-7，8/8：切模式落在节中间、长节内上滚、点末尾两条、冷启动、图片多的文档、两种窗口宽高比，`docs/test/20260922-d17-gui-acceptance.md`）。**第五条限制（D22，已缓解）：图片多的文档里，切到 WYSIWYG 后图片还没撑开就点大纲，曾会落错位置**（点 H05 落进 H02，点靠后的标题看似无效）。现在点击后 1.5 s 内布局每变一次就把目标钉回锚线（ADR-0041）；限制：窗口（1.5 s）过后才加载完的图片仍不校正；真机 GUI-D22-1 已于 2026-10-02 通过。据推测 WebKit 不做 CSS scroll anchoring（未在本 WebKit 上验证） |
| 切换侧栏 | Shipped | `src/App.tsx`, `src/hooks/useSidebarPreference.ts` | 真机 GA 2026-09-27 在 `8b9d8d3` 的 release 包上跑过（见 [D24](plans/20260912-frontend-backend-sequencing-order.md#d24)）：⌘⇧L 一次只写一次、盘上 `showSidebar:false`，重启后侧栏仍收起（日志 `ui.sidebar.preference` 为 `applied_stored`），启动时不写盘。⌘⇧L 或 View → Toggle Sidebar（`menu.view.toggle_sidebar`）当场收起 / 展开左侧面板（落在 `editorStore` 上），并写一次 `showSidebar`；2026-09-27（ADR-0031 第 5b 步，`8b9d8d3`）起这次写入落盘，重启后侧栏保持上次状态。启动时偏好还没读完就按下的切换会被记住，最后一次意图胜出：读完时若它与盘上值不同只写一次，相同就不写；读偏好失败时只留在内存、不写盘；写入失败不回滚可见状态（偏好服务已弹过一次提示）。此前（D24）那次写入被丢掉，重启一律回到展开 |
| 底部标签条 | Shipped | `src/components/BottomTabs/BottomTabs.tsx` | 底部有 `+` 新建、每个文档一个标签（整条标签条就是 `documentStore` 的投影），脏文档带圆点，悬停出 `×`，鼠标悬停显示完整路径，标签多了可横向滚动 |
| 视图模式切换 | Shipped | `src/stores/editorStore.ts`, `src/components/Editor/Editor.tsx` | ⌘/（`menu.view.cycle`）在 WYSIWYG 与源码之间来回切；⌃2 / ⌃4 直达，焦点在 CodeMirror 里时也生效 |
| 恢复上次视图模式 | Partial | `src/hooks/useLastViewModePersistence.ts`, `src/utils/lastViewModeLatch.ts`, `src/stores/editorStore.ts`, `src/App.tsx`, `src/components/Editor/Editor.tsx`, `docs/adr/0053-only-explicit-view-mode-commands-persist-last-view-mode.md` | 限制：一条设计上接受的代价（ADR-0053 Consequences，单测 LVI-11 钉住）：**启动时已有文件打开**的窗口里，用户显式选了屏幕上已经是的那个模式，不会写盘——锁存拿用户的选择去比屏幕上的模式而不是盘上的值，于是盘上若是另一个模式，下次空窗口启动恢复的仍是用户刚拒绝的那个，直到下一次显式切换才纠正。**只有显式视图命令会写 `lastViewMode`**（[ADR-0053](adr/0053-only-explicit-view-mode-commands-persist-last-view-mode.md)）：View → Source / WYSIWYG（⌃2 / ⌃4）、View → Cycle View Mode、可改键的循环快捷键（默认 ⌘/，CodeMirror 外）、源码编辑器里的 `Mod-/`；这四条经 `editorStore.ts` 的 `userViewModeCommands` 以 `"user"` 意图调用。**不写盘的自动切换**：大文档自动降级到源码、拖放打开、Finder / 运行中 `open -a` 打开、启动参数打开、副窗口 `?open=`——它们调 `setViewMode` 不带意图，默认 `"programmatic"`，未标意图的新调用点同样不写（fail closed）。显式命令即使没改模式也算一次选择（D-3），重复写由锁存的 `lastSeen` 去重挡住。启动时盘上值读到之前不写盘（ADR-0031 第 5a 步，原样保留）；空窗口启动、或关掉最后一个文档时，读盘并以程序意图套用存的值，不写盘。确认：空窗口里按 ⌃4 → 打开一份结构分超过 25,000 的文档（弹提示、自动降到源码）→ 关掉它 → 退出再空窗口启动，应仍是 WYSIWYG（修复前是 Source），盘上值不变；`jq -c 'select(.event=="view.mode.change") \| .context' ~/.mdpro/mdpro.log` 每条都带 `intent`（`user` / `programmatic`），盘上值看 `jq .lastViewMode ~/.mdpro/config.json`。逐步场景见 `tests/manual-fixtures/d24-step6-last-view-mode.md`。2026-10-07 在 `987407c` 的 release 包上真机通过 M-1…M-4（[D24](plans/20260912-frontend-backend-sequencing-order.md#d24)，`docs/test/20261008-d24-device-check.md`）：四条显式命令各写一次、全带 `intent:"user"`，重复选同一模式不写；大文档降级、拖放、运行中 `open -a`、`?open=` 只记 `intent:"programmatic"`，盘上值不变；⌃4 → 降级 → 退出 → 无文件重启仍是 WYSIWYG，记一条 `read_applied`。运行中 `open -a` 落进空窗口这条子路径没走到（路由开了新窗口）。单测：`tests/view-mode-intent.test.ts`、`tests/last-view-mode-intent.test.ts`、`tests/view-mode-user-entry-points.test.tsx`、`tests/view-mode-intent-call-site.test.ts`；穷举律在 `pnpm test:slow` |
| 切模式保留滚动位置 | Partial | `src/utils/scrollAnchor/anchor.ts`, `src/utils/scrollAnchor/capture.ts`, `src/utils/scrollAnchor/source.ts`, `src/utils/scrollAnchor/milkdown.ts`, `src/utils/scrollAnchor/settlePin.ts`, `src/hooks/useMilkdownScrollRestore.ts` | 在长文档中段停住，⌃2 / ⌃4 来回切，顶部可见的那块内容应仍在顶部（此前一律跳回文档开头）；`~/.mdpro/mdpro.log` 每次切换各有一行 `editor.scroll_anchor.capture` 与 `editor.scroll_anchor.restore`。限制：按顶层块对位，块数两边对不上退到标题级，两级都对不上就停在开头、不猜位置；超过 WYSIWYG 阈值的文档只有标题级；GUI 验收 2026-09-22 在 `c9a1698` release bundle 上跑过（`docs/test/20260922-wi8-gui-acceptance.md`）：±3 行精度、10 次往返 0 行漂移、图片加载后无位移均通过——但「图片加载后无位移」那项只用了一张图，恰好落在当时唯一的一次重放里；锚线以上多张图时会偏高（D22）。D22 起恢复在 1.5 s 沉降窗口内每次布局变化都重钉（[ADR-0041](adr/0041-wysiwyg-scroll-targets-are-pinned-for-a-bounded-settle-window.md)），多图情形真机 GUI-D22-2 于 2026-10-02 通过（`docs/test/20261002-dtrack-device-retest.md`），窗口过后才加载完的图片不校正；大段粘贴、双主题未测，恢复后大纲高亮因 WYSIWYG 大纲高亮不跟随滚动的既有缺陷（冷启动不切模式亦复现，D14）无法判定，三项 NOT VERIFIED |
| 模式徽标 | Shipped | `src/components/Sidebar/index.tsx` | 左上红绿灯旁边显示当前是 WYSIWYG 还是 Source，切换时跟着变 |
| Toast 通知 | Partial | `src/components/common/Toast.tsx`, `src/stores/toastStore.ts`, `src/App.tsx` | 限制：关闭按钮只在传了 `onClose` 时渲染，而 `App.tsx` 从不传，所以 toast 无法手动关掉。⌘S 弹出的提示上找不到 `×`，只能等 3 秒自动消失；连续触发时是替换而不是堆叠 |
| 加载指示 | Shipped | `src/components/common/LoadingSpinner.tsx` | 打开一个较大的文件时出现「Opening file…」；导出时是「Exporting HTML…」 |
| 窗口拖拽区 | Shipped | `src/App.tsx` | 按住窗口顶部空白条拖动，整个窗口跟着走（标题栏是无边框 overlay 样式） |
| 字数统计 | Absent | — | 窗口里找不到任何位置显示字数或字符数，没有状态栏。`wordCount` / `word_count` / `charCount` 在 `src/` 与 `src-tauri/src/` 下零命中。Part 2 的十个对照物**无一例外**都有这一项 |
| 文档内导航 | Absent | — | 点一个 `./other.md` 链接或 `#fragment` 锚点，什么都不会发生——当前是惰性的。ADR-0002 |
| 双向链接与反向链接 | Absent | — | 写 `[[note]]` 不会成为链接，也没有反向链接面板 |
| 标签 | Absent | — | 写 `#tag` 只是普通文本，没有标签面板也不能按标签筛选 |
| 全局 / 跨文件搜索 | Absent | — | ⌘F 只在当前文档里搜；没有任何跨文件搜索入口 |
| 文件树 / vault | Absent | — | 侧栏只有大纲，没有文件夹浏览器；无法打开一个目录作为工作区 |
| 命令面板 | Absent | — | ⌘⇧P / ⌘P 都没有反应，没有可搜索的命令列表 |
| 演示模式 | Absent | — | 没有把文档投成幻灯片的入口，`---` 不会被当作分页符 |

### 主题与排版

| 能力 | 状态 | 在哪 | 怎么确认 |
|---|---|---|---|
| 浅色 / 深色 / 跟随系统 | Partial | `src-tauri/src/menu.rs`, `src/hooks/useMenuEvents.ts` | 限制：主题落盘与重启后保持未在真机验证（ADR-0032 GUI 验收）。Theme 菜单里三选一（`menu.theme.light` / `menu.theme.dark` / `menu.theme.system`），选择落进 `themeStore`、界面立刻切换，并写盘 `themeMode`；2026-09-27（ADR-0031 第 5b 步，`8b9d8d3`）起这次写入真的落盘，重启后保持所选主题（启动水合只应用、不回写）。写入失败时退回上一个已落盘的主题，记一条 `ui.theme.persist` 失败（上下文只有 `reason: "invoke_rejected"`，不带错误文本），提示只由偏好服务弹一次。此前（D24）写盘被丢掉，重启一律回到 System。另：2026-09-25 真机上点一次 Theme 菜单项曾记 4–5 条 `ui.menu.select`（同一次选择被重复执行），是 D31 的 `menu:action` 订阅泄漏；代码已修，2026-10-02 在 `ef91e24` 的 release 包上真机复查通过（`docs/test/20261002-dtrack-device-retest.md`）——点一次 Theme → Light / Dark / System，在 `~/.mdpro/mdpro.log` 里各恰好一条 |
| 跟随系统主题变化 | Partial | `src/hooks/useTheme.ts` | 限制：启动时初值的 Rust 路径真机未验（ADR-0032 GUI 验收）；运行中跟随系统切换不受影响。主题设为 System，在 macOS 系统设置里切换外观，mdpro 不用重启就跟着变（`theme:changed` 事件；处理器现读 store 的模式，只在 System 下才跟）。**启动时的初值 2026-09-27（第 5b 步）起换了来源**：`preferencesService.getSystemTheme` 过了 `isTauri()` 判定，真的走到 Rust `get_system_theme`（失败回落 light）；此前 D24 那道探测恒判为非 Tauri，走的是 `window.matchMedia("(prefers-color-scheme: dark)")`，本行当时写的「初值来自 `get_system_theme`」是错的。**这条 Rust 初值路径还没在真机上走过**，随 ADR-0032 GUI 验收一并看。主题模式现在也存得住了，app 不再永远处在 System 模式——此前这一行成立有一半是运气 |
| 编辑器字体 | Partial | `src/components/common/settings/EditorSettings.tsx` | 限制：真机未验（ADR-0032 GUI 验收）。⌘, → Editor 里在 System Default / Serif / Monospace 之间切换，正文字形当场变（写的是根节点上的 CSS 变量）；2026-09-27（ADR-0031 第 5b 步，`8b9d8d3`）起这一项落盘——关掉设置再打开仍是所选字体，重启后启动水合经 `applyEditorPref` 还原字形。此前（D24）只改得动本次会话 |
| 字号 | Shipped | `src/components/common/settings/SettingsStepper.tsx` | 2026-10-02 在 `ef91e24` 的 release 包上真机验证（D24 DC-M，`docs/test/20261002-dtrack-device-retest.md`）：调到 17px 后正常退出、冷启动，UI 与 `config.json` 都保持。⌘, → Editor 里用 ± 调字号，正文当场变大变小（CSS 变量）；停手 150 ms 后 stepper 调一次 `setPreferences`，2026-09-27（ADR-0031 第 5b 步，`8b9d8d3`）起这次写入真的落进 `config.json`——关掉设置再打开数字还在，重启后启动水合经 `applyEditorPref` 还原字号。此前（D24）那次调用算出合并结果就丢掉，重开回到 16px。（步进器自身钳在 12–24px，`clampFontSize` 另有一道 8–72px 的兜底，挡住已落盘的坏值——这条路径 5b 之后才第一次可达，同样未经真机） |
| 行高 | Partial | `src/components/common/settings/EditorSettings.tsx` | 限制：真机未验（ADR-0032 GUI 验收）。⌘, → Editor 里在 1.2 / 1.4 / 1.6 / 1.8 / 2.0 之间切，行距当场变；2026-09-27（ADR-0031 第 5b 步，`8b9d8d3`）起这一项落盘——关掉设置再打开仍是所选值，重启后行距也还原。此前（D24）只改得动本次会话，重开回到 1.6 |
| 内容宽度 | Partial | `src/components/common/settings/EditorSettings.tsx` | 限制：真机未验（ADR-0032 GUI 验收）。⌘, → Editor 里在 Narrow 600px / Medium 780px / Wide 900px / Full 之间切，正文栏宽当场变；2026-09-27（ADR-0031 第 5b 步，`8b9d8d3`）起这一项落盘——关掉设置再打开仍是所选宽度，重启后栏宽也还原。此前（D24）只改得动本次会话，重开回到 Medium |
| 自定义主题 CSS | Absent | — | ⌘, → Appearance 只给 default / oneDark 两个**代码**主题，没有任何加载用户 CSS 的入口，也没有主题文件夹。`customCss` / `userStylesheet` 一类标识符全仓库零命中。界面配色由 `.theme-light` / `.theme-dark` 两套内置 token 决定，改不了 |
| 界面本地化 | Absent | — | 界面文案全是硬编码英文（「Discard changes」「Opening file…」），没有语言设置项。`i18n` / `useTranslation` / locale 相关基础设施一律不存在——这不是「还差几个翻译文件」，是这条路还没开 |
| RTL / 竖排书写 | Unknown | `src/components/Editor/MilkdownEditor.tsx`, `src/components/Editor/Editor.tsx` | 继承自 webview 与 CodeMirror/ProseMirror，此处从未测过，不要声称它能用。要判断请自己粘一段阿拉伯语或希伯来语进两种模式实测 |

### MCP 集成

| 能力 | 状态 | 在哪 | 怎么确认 |
|---|---|---|---|
| MCP 服务开关 | Partial | `src-tauri/src/commands/mcp_server_switch.rs`, `src-tauri/src/services/mcp_controller/switch.rs`, `src-tauri/src/services/mcp_controller/controller.rs`, `src-tauri/src/services/preferences_mcp.rs`, `src-tauri/src/services/mcp_launch.rs`, `src-tauri/src/main.rs`, `src/hooks/useMcpServerSwitch.ts`, `src/components/common/IntegrationsSettings.tsx`, `src/components/common/McpServerStatus.tsx`, `src/utils/mcpStatusView.ts` | 限制：`config.json` 坏掉时设置页里切不动——设置页锁住开关，只显示一条「Settings file unreadable — fix it to change this setting」；锁住的开关跟着服务当前状态显示（running / starting 为开，其余为关），不再出现「关」挨着 Running 徽标（2026-10-07，D25 issue 1，[ADR-0054](adr/0054-a-locked-mcp-switch-mirrors-the-running-server.md)，真机未验），开关命令 `mcp_set_server_enabled` 本身也拒绝（`config_unreadable`），文件字节不变，要先修好文件；配置坏掉时日志整体不写（有意 fail-closed，ADR-0042 决定 6；`src-tauri/src/services/logger_corrupt_config_tests.rs` 钉住「服务照常起、状态报 unreadable、日志文件不写」，D25 issue 2）；sidecars built before this change must be relaunched（旧 sidecar 攥着旧 token，服务重开后一直 401）；原生写入确认框曾让整个 app 被模态框挡住（打不开设置页、关不了服务、退不出，2026-09-28 真机）；2026-09-30 已换成窗口内确认（见「写入确认对话框」行），关服务会撤回待答的确认（503，2026-09-30 真机验收 G3 通过）。2026-09-28 起（[ADR-0040](adr/0040-the-mcp-server-switch-takes-effect-live.md)，取代 [ADR-0039](adr/0039-mcp-server-enablement-is-read-once-at-launch.md) 的「启动时读一次」）⌘, → Integrations 里的开关**当场生效**：先落盘，再由 `McpController` 起停 HTTP 服务，返回一次状态。关：撤掉 `server.port` / `server.token`、作废内存里的 token、限时排空在途请求后等服务任务结束，标记 Off；开：绑端口、铸新 token、先写 0600 的 token 再写端口文件，标记 Running。落盘失败 → 服务不动、开关退回、只弹一次「Failed to save preferences」；落盘成功但端口被占 → 盘上保持开、标记 Failed to start，不回滚；退出途中点开关 → 什么都不做、开关退回。只有这个命令写 `mcp.serverEnabled`，通用的 `set_preferences` 保留盘上的值。启动时仍只读地读一次：显式 `false` 不起服务（`mcp.http_server.start {outcome:"skipped"}`），配置缺失/坏掉/读不了照常起服务（fail-open）。偏好还没加载完或加载失败时三个 MCP 勾选全部禁用并写明原因（F3）。每次切换一组 `mcp.server.toggle` 日志（start 后接 success 或 fail），只带 direction / phase / error 枚举与耗时。验证：设置页关掉 → `lsof -nP -iTCP:55045 -sTCP:LISTEN` 无监听、标记 Off；再打开 → 恢复监听、标记 Running，已连着的 sidecar 下一次读请求照常成功；`grep mcp.server.toggle ~/.mdpro/mdpro.log \| tail -2 \| jq .` 两行共用一个 `actionId`。真机开关检查 2026-09-28 已跑并通过（debug 包 `d211550`，条目见 [D25](plans/20260912-frontend-backend-sequencing-order.md#d25)）。ADR-0039 的真机 GA（2026-09-27，`8b9d8d3`，见 [D24](plans/20260912-frontend-backend-sequencing-order.md#d24)）验的是启动时读一次那一半，仍然成立。2026-10-02 在 `ef91e24` 的 release 包上真机复测（D25 C1，`docs/test/20261002-dtrack-device-retest.md`）：有待答确认时在另一窗口关服务 → 503 `CONFIRM_CANCELLED`，18 ms 到 `phase:disabled`，端口不再监听、`server.port` / `server.token` 撤掉，再打开 47 ms 回到 running；「Stopping」徽标过渡太短，未能目测（NOT VERIFIED） |
| 启动时自动运行 | Stub | `src/components/common/IntegrationsSettings.tsx` | 持久化但未被消费（D25）。勾不勾都一样——这个勾选没有任何读取点。服务启不启动由「MCP 服务开关」的 `serverEnabled` 决定：启动时读一次（ADR-0039），之后由开关当场起停（2026-09-28，ADR-0040）；`startOnLaunch` 因此是多余的，留给 D25 处置。2026-09-27（第 5b 步）起这个勾会写进 `config.json`、关掉设置再打开还在，但仍没人读；此前它从没落过盘（D24） |
| 自动批准 AI 编辑 | Stub | `src/components/common/IntegrationsSettings.tsx` | 持久化但未被消费（D25）。`autoApproveEdits` 在 `src/` 里零读取点，勾与不勾，外部写入的走法完全一样。2026-09-27（第 5b 步）起这个勾会写进 `config.json`、关掉设置再打开还在，但仍没人读；此前它从没落过盘（D24） |
| 四个 MCP 工具 | Shipped | `src-tauri/src/bin/mdpro_mcp.rs`, `src-tauri/src/bin/mdpro_mcp/conn.rs`, `src/hooks/useMcpEvents.ts`, `src/hooks/mcpInsertContent.ts`, `src/hooks/mcpTableAction.ts` | D35 已修复并经真机验证：2026-10-01 在 `d411c7e` 构建的 release 包上 WI-6 六项全部通过（[D35](plans/20260912-frontend-backend-sequencing-order.md#d35)；[ADR-0044](adr/0044-mcp-insert-in-wysiwyg-is-a-wholesale-replace.md) 已 Accepted）。确认方法：WYSIWYG 下对活动文档调 `insert_content`（`start` / `end` / 数字偏移），文字立刻出现在编辑器里，`grep editor.milkdown.reload ~/.mdpro/mdpro.log \| tail -1 \| jq .` 看到 reason `mcp-insert`；随后 ⌘S、⌘W、重开，文字仍在。已接受的代价（行为如此，不是缺陷）：WYSIWYG 下 insert_content 会重建编辑器——撤销历史清空、大纲折叠状态重置、标题全部展开（焦点与光标自 D37 起在编辑器原本聚焦时带过去，见「WYSIWYG 编辑」一行）；`position: "cursor"` 在 WYSIWYG 解析为 0，即文档开头；源码模式下插入不重建编辑器、不重置大纲，但光标会移到插入文字的末尾（`src/hooks/mcpInsertContent.ts` 的既有行为，早于 D35），**不**保证光标留在原处。修复前（2026-09-30 真机所见）：目标文档是活动文档且处于 WYSIWYG 时，插入进了 store 与影子存储、标签出现脏点，但 Milkdown 不重建，下一次 WYSIWYG 编辑时 `src/plugins/milkdown/editSync/controller.ts` 的 `write()` 把插入前的内容写回、覆盖插入（回归测试红跑已在 jsdom 复现）。现在先 flush 未落的编辑（flush 失败则拒绝插入），再走与 write_document 相同的整体替换重建。源码模式与非活动文档不受影响，仍走增量插入。在 Claude Desktop 里连上后列出工具，恰好是 get_open_documents、read_document、write_document、insert_content 四个，分别打到 `/api/documents`、`/api/documents/{id}`（GET / POST）与 `/api/documents/{id}/insert`。**偏移量的单位是 UTF-16 码元**（2026-09-22，D10 / [ADR-0021](adr/0021-mcp-document-offsets-are-utf16-code-units.md)）：一个 emoji 算 2，不是 1、也不是它的 4 个字节；落在一个字符内部的偏移向下吸附到该字符起点。此前 Rust 按 Unicode 标量、前端按 UTF-16 各算各的，星平面字符之后同一次插入会落到两个不同位置。验证：在文档开头放一个 emoji，调 `insert_content` 给 `position: 2`，文字应落在 emoji 之后、下一个字符之前，返回的 `newCursor` 应是 3 而不是 5。2026-09-28 起（ADR-0040 决定 4）sidecar 跟得上服务重开：收到 401 或连不上时从数据目录重读 port 与 token，读请求（GET）重试恰好一次，写请求（POST）不重放——这一次报错，下一次用新端口与 token；连续两次 401 就报错，不循环；返回给客户端的错误里没有 token |
| HTTP 表格端点 | Partial | `src-tauri/src/services/http_server.rs`, `src-tauri/src/bin/mdpro_mcp.rs` | 限制：只有 HTTP 端点，`mdpro_mcp.rs` 只注册了 4 个工具，任何 AI 客户端都无法通过 MCP 走到表格操作。用 curl 带 token 打 `/api/v1/insert_table`、`/api/v1/set_cell`、`/api/v1/add_row`、`/api/v1/delete_row`、`/api/v1/add_column`、`/api/v1/delete_column` 都能成功，但在 AI 客户端的工具列表里找不到任何表格工具。另：经这些端点编辑的表格，多于表头的单元格仍被截断丢弃（前端 `src/utils/tableMcp.ts`，D44 未覆盖，见 [ADR-0052](adr/0052-format-on-save-widens-tables-to-the-widest-row.md)） |
| 影子存储同步 | Partial | `src-tauri/src/services/shadow_store.rs`, `src/hooks/useMcpSync.ts`, `src/utils/mcpCursor.ts` | 限制：**同步的是内容，光标只是尽力而为**。已知边界（2026-09-22，D10(c)；②于 2026-10-07 由 D36 修掉）：① **WYSIWYG 模式下读不到光标** —— 只有源码模式的 CodeMirror 会写 `editorStore.editorView`，Milkdown 用自己的 `editorViewCtx` 从不回写，所以 WYSIWYG 下两侧一致地回报 0，`insert_content` 的 `position: "cursor"` 会插到文档开头而不是光标处；② ~~只移动光标不打字不会触发同步~~ —— **D36 已修**：源码模式下 CodeMirror 的 `selectionChange` 事件现在也走同一个 300ms 防抖去同步（光标不变时按载荷哈希去重，不重复推），所以只移动光标、等 300ms 后再调 `insert_content` 的 `cursor` 位置，文字落在新光标处（`tests/d36-mcp-cursor-sync.test.tsx`；真机未验）。剩下的窗口与内容同步相同：移动光标后 300ms 内就调，用的仍是上一个位置。源码模式下敲一个字再调 `insert_content` 的 `cursor` 位置，文字应落在光标处，这条是修好的；切到 WYSIWYG（⌃4）重做一次，文字会落在开头 —— 这就是①。改几个字不保存，前端 300ms 防抖地调 `mcp_sync_documents` 推一次，推完之后外部客户端 read_document 读到的是编辑器里的最新内容而不是磁盘上的旧内容。是最终一致不是即时一致：内容同步带 300ms 防抖（开 / 关 / 切文档才是立即推），在这个窗口里读到的仍是上一份快照。要确认就等这次同步落定后再读，别在敲完键的那一刻读 |
| 写入确认对话框 | Partial | `src-tauri/src/services/http_server.rs`, `src-tauri/src/services/mcp_confirm/http.rs`, `src-tauri/src/services/mcp_confirm/broker.rs`, `src-tauri/src/services/mcp_confirm/outbox.rs`, `src-tauri/src/commands/mcp_confirm.rs`, `src-tauri/src/main.rs`, `src/hooks/useMcpConfirm.ts`, `src/components/common/McpWriteConfirm.tsx`, `src/components/common/McpWriteConfirmDialog.tsx`, `src/hooks/useDialogEscape.ts`, `src/hooks/useReturnFocusOnClose.ts`, `src/utils/focusActiveMilkdownAtEnd.ts`, `src/App.tsx` | 限制：Dock 跳动未在真机验证。表格操作的确认 2026-10-02 在 `ef91e24` 的 release 包上真机通过（D25 G1，`docs/test/20261002-dtrack-device-retest.md`）：批准 202 并执行 `insert_table`，拒绝 403、文档不变，60.004 s 超时 408。Esc = 拒绝，走 document 级捕获监听（`useDialogEscape`，[ADR-0045](adr/0045-modal-escape-goes-to-the-last-dialog-in-dom-order.md)），2026-10-02 `ef91e24` debug 包真机通过（D34：窗口未聚焦时、光标原在编辑器里时、叠在「Unsaved changes」上时都返回 403 `USER_REJECTED`；物理键 + ABC 输入源）；WeType 等吞掉 Esc keydown 的输入法下 Esc 什么都不做，只能点「拒绝」（[ADR-0048](adr/0048-escape-swallowed-by-an-ime-is-not-recovered-from-keyup.md)，已接受）。2026-09-30 起（[ADR-0042](adr/0042-mcp-write-confirmation-is-an-in-window-queued-prompt.md)，Accepted）原生 Yes / No 弹框已删，换成窗口内确认：三条写入路径（write_document、insert_content、表格工具）都经同一个 `confirm_gate`。**持有目标文档的窗口**获得焦点时直接写入、不弹框；否则只在那个窗口弹出确认（mdpro 在后台时请求 Dock 跳动），其他窗口不弹；每个窗口一次只显示一个、按到达顺序（FIFO）排队，一次批准只管一次写入；初始焦点在「拒绝」上，回车不会误批准；整个 app 不再被模态框挡住，确认期间能开设置、能退出。结果：拒绝 403 `USER_REJECTED`；60 秒无人回答 408 `CONFIRM_TIMEOUT`；关服务 / 退出 / 关掉所属窗口时撤回 503 `CONFIRM_CANCELLED`（关窗被「Keep editing」撤回时不算关，请求照常等）；确认期间文档被关 404 `NOT_FOUND`。批准后的插入按**批准那一刻**的内容计算，确认期间打的字不会被覆盖。回复命令 `mcp_confirm_reply` 只认调用方窗口，id 必须是 UUID。确认框关闭（批准、拒绝、超时、撤回）时把焦点还给打开时持有焦点的元素，那个元素已不在就落到活动编辑器的文末（D37 WI-6，2026-10-01 release 包真机通过）。确认框开着时编辑器被重建（两个框排队时第一次批准即如此），关框后焦点回到新编辑器、光标留在原处而不是文末（D38，ADR-0055，2026-10-08 代码已修、真机未验）：批准后立刻打字，字进编辑器而不是丢掉。日志只带 id、窗口、操作、队列深度与结果，不带标题、路径、内容或 token。真机验收 2026-09-30 通过（G1–G8，见 [D25](plans/20260912-frontend-backend-sequencing-order.md#d25) 与 `docs/test/20260930-adr0042-wi10-gui-acceptance.md`）。验证：让外部客户端对后台窗口里的文档调 write_document → 该窗口出现确认框、其他窗口不出现；点拒绝 → 客户端收到 403；不答 60 秒 → 408；确认框开着时在设置页关 MCP → 503、确认框消失；`grep mcp.confirm ~/.mdpro/mdpro.log \| tail \| jq .` 看到 `mcp.confirm` 与 `mcp.confirm.reply` 行 |
| 客户端配置安装器 | Shipped | `src-tauri/src/commands/mcp.rs` | ⌘, → Integrations 里对 Claude Desktop / Claude Code / Codex CLI / Gemini CLI 点 Install（`mcp_install_config`），对应客户端的配置文件被写好；已安装状态由 `mcp_get_installations` 列出，再点 Remove（`mcp_remove_config`）能撤销 |
| 连接测试与端口复制 | Shipped | `src/components/common/IntegrationsSettings.tsx` | 点「Test Connection」得到结果；点复制按钮拿到 `localhost:<port>` |
| 令牌与来源校验 | Shipped | `src-tauri/src/services/http_server.rs` | 不带 token 直接 curl `/api/status` 被拒；带上正确 token 才返回 |
| 退出时清理服务配置 | Shipped | `src-tauri/src/services/app_exit.rs` | 开着 MCP 服务退出 mdpro，`~/Library/Application Support/mdpro/` 下的 `server.port` 与 `server.token` 应该都不在了，日志有一条 `app.quit` `status: success`。**2026-09-23 之前这两个文件每次退出都留着**（D16 定点侦察发现）：清理逻辑挂在 `RunEvent::ExitRequested` 上，而 macOS 的 ⌘Q / 菜单退出 / Dock 退出 / AppleScript 退出全都直接走 AppKit `terminate:`，那条事件根本不触发，于是上一轮的端口与令牌一直躺在盘上。现在整段搬到 `RunEvent::Exit`，它在每条退出路径上都会跑。单元测试证据是 `app_exit_tests.rs` 5 例（含「只删这两个文件、草稿与同目录其它文件逐字节不变」「跑两次不炸」「锁中毒仍能关停」）；**端到端（D16 的 G1）已于 2026-09-23 在打包 `.app` 上执行通过**——真机退出后两个文件都不在了，日志有 `app.quit`，补上了 WI-1 一直欠着的那一条 |
| 通过 HTTP 新建文档 | Partial | `src-tauri/src/services/http_server.rs`, `src/hooks/useMcpEvents.ts` | 限制：只有 `/api/documents/new` 这个 HTTP 端点，`mdpro_mcp.rs` 注册的四个工具里没有它，AI 客户端经 MCP 调不到。用 curl 带 token 打 `/api/documents/new`，mdpro 里确实会多出一个新文档 |
| MCP 服务器信息查询 | Partial | `src-tauri/src/commands/mcp.rs`, `src-tauri/src/services/mcp_launch.rs`, `src-tauri/src/services/mcp_controller/snapshot.rs`, `src/components/common/McpServerInfo.tsx` | 限制：`mcp_get_server_info` 注册着，但 `src/` 与 `tests/` 里零调用点——设置页的端口与运行状态全部来自 `mcp_get_status`（它从不携带 token）。它不是坏的，是没人接。`mcp_get_status` 报 `phase`（disabled / starting / running / stopping / failed，控制器此刻的状态；2026-09-28 起按 ADR-0040 决定 5 取代 ADR-0039 的 `launch`）、`error`（bind_in_use / bind_failed / publish_failed / serve_failed，只在 failed 时有值）与 `configured`（enabled / disabled / unreadable，每次调用只读地现读盘），`running` 仍等于「有端口绑定」。设置页的「Listening on localhost:…」只在绑了端口时出现，关着或启动失败时整块不渲染 |

### 日志与诊断

| 能力 | 状态 | 在哪 | 怎么确认 |
|---|---|---|---|
| 结构化 JSONL 日志 | Shipped | `src-tauri/src/services/logger.rs`, `src/services/loggingService.ts`, `src/services/preferencesService.ts`, `src/services/windowStateApplier.ts` | 跑 `tail -f ~/.mdpro/mdpro.log \| jq .`，然后在 app 里 ⌘O 打开一个文件，能看到一条 `file.open` 事件；前端每条都经 `log_event` 落盘。**读不出设置时两端都 fail-closed**（2026-09-22，D7）：`config.json` 存在但损坏时，Rust 侧回落到 `enabled: false` 而不是 `LogSettings::default()` 的 `enabled: true`，与前端 `loggingService.ts` 的 `FAIL_CLOSED_SETTINGS` 一致 —— 否则关掉日志的用户会在配置损坏时被静默重新打开，且该值与全新安装逐字节相同、无法分辨。**全新安装不会走到这里**：`load_preferences` 把「文件不存在」当成功路径处理，写入默认值并返回 `Ok`。验证：把 `~/.mdpro/config.json` 改成非法 JSON 再启动，日志文件不应新增行（改回来即恢复）。**`durationMs` 不再包含用户在原生对话框里停留的时间**（2026-09-22，D1）：此前一次导出会记成 72 745 ms，其中 72 154 ms 是人在挑保存位置，净成本只有 591 ms。现在 `file.export` / `file.export_rendered` 报「渲染 + 写盘」两段之和，`file.open` 经对话框时只从选中文件之后开始计时；取消导出报渲染那一段，取消打开则不带 `durationMs`。验证：⌘⇧E 导出时故意在保存框里停十几秒，日志里该条的 `durationMs` 应是几十毫秒量级，不是上万。**偏好读取与窗口几何套用也进日志**（2026-10-07，[D24](plans/20260912-frontend-backend-sequencing-order.md#d24) Part B，ADR-0032 GA-12 的日志），上下文只有枚举：桌面端每次前端读偏好记一条 `preferences.read`，`purpose` 是 12 个固定值之一（`app_hydrate`、`view_mode_startup_settle`、`view_mode_restore_on_close`、`save_reformat_check`、`settings_dialog`，以及各设置分页的 `settings_appearance` / `settings_general` / `settings_markdown` / `settings_editor` / `settings_export` / `settings_image` / `settings_shortcuts`），成功 info `outcome:"ok"`，失败 warn `outcome:"failed"` 加 `reason:"invoke_rejected"`（错误照旧抛给调用方）；浏览器里（`pnpm dev`）不记。每个窗口水合时套用全局窗口几何记一条 `window.apply_state`：`applied`（带 `monitor: "reported" \| "absent"`，窗口调用都成功之后才记）、`maximized`、副窗口的 `skipped` / `not_main`，任何抛错记 warn `failed`；不带坐标、窗口标签或错误文本。确认：无文件冷启动后 `jq -c 'select(.event=="preferences.read") \| .context.purpose' ~/.mdpro/mdpro.log` 新增恰好 `app_hydrate` 与 `view_mode_startup_settle` 两行，`select(.event=="window.apply_state")` 一行 `applied` 或 `maximized`；逐步场景见 `tests/manual-fixtures/d24-step6-last-view-mode.md` M-5 / M-6。2026-10-07 在 `987407c` 的 release 包上真机验证（`docs/test/20261008-d24-device-check.md`）：无文件冷启动恰为 `app_hydrate` + `view_mode_startup_settle` 两条读、一条 `applied`；带文件冷启动恰一条 `app_hydrate`、一条 `applied`；关掉最后一个文档恰一条 `view_mode_restore_on_close`、无 apply；`?open=` 副窗口一条 `app_hydrate`（settle 读 0 次，文档先到）、⌘⇧N 空窗口 `app_hydrate` + `view_mode_startup_settle`，两者都是一条 `skipped` / `not_main`。浏览器里不记这一条没有真机证据（M-6 第 3 步未跑），只有单测。单测：`tests/preferences-read-log.test.ts`、`tests/window-state-apply-effect.test.ts` |
| 日志开关 | Shipped | `src/components/common/settings/AdvancedSettings.tsx` | ⌘, → Advanced 里关掉日志（读写走 `get_logging_settings` / `set_logging_settings`，前端状态在 `loggingStore`）：此后新标签 / 切模式 / 保存 / 退出 / 重启，`mdpro.log` 增量 0 字节，关闭状态持久化在 `~/.mdpro/config.json`；重新打开即恢复写入。2026-09-22 在 release 包上人工验证，见 `docs/test/20260922-d2-logging-toggle-qa.md`（打开这一跳本身不写日志） |
| 日志级别 | Shipped | `src/components/common/settings/AdvancedSettings.tsx` | ⌘, → Advanced 里把级别设为 Error，Debug / Info 级别的事件不再写入 |
| DevTools | Shipped | `src-tauri/tauri.conf.json` | 在打包后的正式版里也能右键打开 Web Inspector，不只是 dev 构建 |

### 偏好设置

| 能力 | 状态 | 在哪 | 怎么确认 |
|---|---|---|---|
| 设置对话框 | Partial | `src/components/common/SettingsDialog.tsx` | 限制：不少设置项现在存得住却仍没有消费者（D25，见各行）。对话框未打开时 `SettingsDialog` 直接 `return null`，十个分页整体卸载；下次打开每一页都重新调一次 `preferencesService.getPreferences`。2026-09-27（ADR-0031 第 5b 步，`8b9d8d3`）起它按 `isTauri()`（每次调用时判定）真的走到 Rust `get_preferences`，读的是盘上的值；此前 D24 那道探测查 `window.__TAURI__`、恒假，返回 `DEFAULT_PREFERENCES` 常量，于是「改一项 → 关掉 → 再打开」就退回默认。读写失败的日志只带枚举 `reason`（如 `invoke_rejected`），不带错误文本或路径。⌘, 或 mdpro → Preferences（`menu.file.preferences`）打开，左侧十个分页、Tab 焦点困在对话框内、Esc 或点遮罩关闭，这些本身都正常。ADR-0032 的核心判据真机 GA 2026-09-27 在 `8b9d8d3` 的 release 包上跑过（见 [D24](plans/20260912-frontend-backend-sequencing-order.md#d24)）并通过：Default View Mode 从 Source 改成 WYSIWYG → 关掉设置再打开仍是 WYSIWYG、盘上 `defaultViewMode` 为 `wysiwyg` → 退出重启仍是 WYSIWYG。只验了这一项的往返，字体、代码主题、快捷键等其他分页的往返没有逐项跑 |
| 快捷键改键 | Stub | `src/components/common/settings/KeyboardShortcutsSettings.tsx`, `src/hooks/useKeyboardShortcuts.ts`, `src-tauri/src/models/preferences.rs` | 设置面板里 **49** 个可配置动作**一个都不生效**，不是本行此前写的「33 个脱节」（那句反过来暗示另外 24 个能用，不成立），也不是「57 个」——2026-09-23 实测：`KeyboardShortcutsSettings.tsx` 只渲染 49 行，而 Rust 与 TS 两侧的契约各有 **58** 个字段，两边已对齐（ADR-0031 WI-5）。差的 9 个字段两侧契约都有、面板里却没有入口：`fileOpenQuickly`、`formatHighlight`、`fileExportHtml` 和 6 个 `table*`。`handleSave` 只调 `setPreferences` 再更新面板自己的 React state，不回写 App 的 `keyboardShortcuts`，也不重新注册加速键（D25）；那次 `setPreferences` 自 2026-09-27（第 5b 步）起会落盘——持久化但未被消费（D25）：值存住了，当场仍不生效；此前它在 D24 处就被丢掉。**「不写任何 store」这句此前说得过头**：`App.tsx:266-267` 在挂载时确实会读 `prefs.keyboardShortcuts` 喂给 `useKeyboardShortcuts`，所以断的是「改完当场生效」这一段，不是整条链——第 5b 步落地后，按代码读，改键 + 重启后被 `useKeyboardShortcuts` 读取的那部分应当生效，但这一点**未经真机验证**，且原生菜单不重注册加速键，旧键照样会触发。**另记一笔 WI-7 拆掉的雷**：`App.tsx:267` 写的是 `{ ...DEFAULT_KEYBOARD_SHORTCUTS, ...prefs.keyboardShortcuts }`，而 WI-7 之前 Rust 的 `KeyboardShortcuts::default()` 返回 58 个空字符串——一旦步骤 5 把读取打通，这个展开会拿 58 个 `""` 覆盖掉 TS 侧的真实加速键，**全部快捷键一起失效**。WI-7 改成手写 `Default` 并加了 load 侧修复之后，这条路才安全。把「Source」从 ⌃2 改成别的键，⌃2 照旧生效、新键没反应；改 fileSaveAs 同样毫无反应。关掉设置再打开，改键记录现在还在（5b 之前会丢） |
| 默认视图模式 | Partial | `src/components/common/settings/GeneralSettings.tsx`, `src/App.tsx`, `src/hooks/useOpenUrlParam.ts` | 限制：**只在启动时读入**，改了要重启才对新打开的文件生效；⌘N 新建的空白文档不看它（沿用当前视图模式）。2026-09-27（ADR-0031 第 5b 步，`8b9d8d3`）起这一项落盘：⌘, → General 里设成 Source，关掉设置再打开仍是 Source；重启后，从 Finder 打开、拖进窗口、或经 `?open=` 开进新窗口的文件都以 Source 打开。本行此前写「不写进任何 store，没有人读它（D25）」是错的，D25 行 2026-09-23 已更正：`App.tsx` 启动时读入它，打开文件的几条入口都用它，真正的缺陷只是要重启才生效；那时它还从没落过盘（D24）。真机 GA 2026-09-27 在 `8b9d8d3` 的 release 包上跑过（见 [D24](plans/20260912-frontend-backend-sequencing-order.md#d24)），ADR-0032 GA-1 通过：盘上为 Source 时开进新窗口的文件以 Source 打开；在设置里改成 WYSIWYG，已开着的窗口不跟着变。首帧就是 Source 还是先闪一下再切，没有测 |
| 自动保存间隔 | Partial | `src/components/common/settings/GeneralSettings.tsx` | 限制：真机未验（ADR-0032 GUI 验收）。⌘, → General 里在 Off / 30s / 1min / 2min / 5min 之间选，选择当场进 `editorStore.setAutoSaveInterval`，设成 Off 后草稿确实不再自动写；2026-09-27（ADR-0031 第 5b 步，`8b9d8d3`）起这一项落盘——关掉设置再打开仍是所选间隔，重启后启动水合也按它来。此前（D24）只改得动本次会话，重开回到 30 秒 |
| 图片目录与外链复制 | Stub | `src/components/common/settings/ImageSettings.tsx` | 持久化但未被消费（D25）。两个控件都没有读取点。⌘, → Images 里把资源目录从 `./assets` 改成 `./img`，再粘一张图，文件仍然落在 `./assets`——`imagePastePlugin` 调 `uploadImage` 时根本不传目录，Rust 走兜底值；「复制外部图片」那个勾同样没人读，`imageService.copyExternalImage`（打到 `copy_external_image`）在 `src/` 里只有定义、只被测试调用。2026-09-27（第 5b 步）起两个值都写进 `config.json`、关掉设置再打开还在；此前它们从没落过盘（D24） |
| 偏好写入的原子性 | Partial | `src-tauri/src/services/preferences.rs` | 限制：嵌套组（`editor` / `export` / `image` 等）按整组替换，只改一个字段的调用方必须带齐同组兄弟字段。Rust 这一侧的合并写带锁、原子，读坏的 `config.json` 不会被默认值整份重写（ADR-0031 第 1 步）。2026-09-27（ADR-0031 第 5b 步，`8b9d8d3`）起前端 `preferencesService.setPreferences` 真的调到 `set_preferences`：快速连续改多个设置项再重启，每一项都保住——2026-10-02 在 `ef91e24` 的 release 包上真机验证（D24 DC-M，`docs/test/20261002-dtrack-device-retest.md`）：连续改 4 项得 4 对 `preferences.set` start/success，正常退出冷启动后 Source、侧栏隐藏、One Dark、17px、自动重排全部保持。此前（D24）没有任何一次前端写入到得了它，结果是一项都没写进去。`set_preferences` / `save_window_state` 失败时 Rust 日志只记错误种类（`IoError` / `ParseError`），不记错误文本。真机 GA 2026-09-27 在 `8b9d8d3` 的 release 包上跑过（见 [D24](plans/20260912-frontend-backend-sequencing-order.md#d24)）：坏掉的 `config.json` 在启动、开文件、退出全程字节不变（ADR-0032 GA-6、ADR-0039 GA-4）；Rust 的整份写入把 `mcp` 组里退役的 `enabled` 去掉、补上 `serverEnabled` |
| 图片配置读写命令 | Stub | `src-tauri/src/commands/image.rs` | 调 `get_image_config` 永远拿到默认值，即使刚在 ⌘, → Images 里改过；`set_image_config` 写进去也没有任何人会读到。函数体里写着 `// TODO: Load from preferences`——2026-09-27（第 5b 步）起 ⌘, 里的改动真的落进了 `config.json` 的 `image` 组，所以**现在拦路的就是这条 TODO**。本行此前把账算在 D24 上，当时成立（写入从没落盘，改成从偏好读也只读到默认值），5b 之后不再成立 |

### 窗口与标签页

| 能力 | 状态 | 在哪 | 怎么确认 |
|---|---|---|---|
| 新建窗口 | Partial | `src-tauri/src/commands/window.rs`, `src/hooks/useMenuEvents.ts` | **限制：⌘⇧N 开出的窗口不层叠**——2026-10-02 真机上每个新窗口都落在同一位置 156,71（`docs/test/20261002-dtrack-device-retest.md`）。D31 的真机判据 2026-10-07 在 `a55e87f` 的 release 包上全部通过（`docs/test/20261007-dtrack-device-checks.md`）：四个窗口各打字约 30 s 后按一次 ⌘⇧N，恰开一个窗口、恰一条 `menu.file.new_window`，`windowLabel` 为聚焦窗口；`ui.menu.listen` 条数等于窗口标签数，`ui.menu.focus_check` 0 条。2026-10-02 在 `ef91e24` 的 release 包上真机复查：⌘⇧N ×4 每次恰开一个窗口、恰一条 `ui.menu.select` `menu.file.new_window` 与一条 `window.create`，`ui.menu.listen` 条数等于窗口数，`ui.menu.focus_check` 失败 0 条。2026-09-25 在 `68d4648` 的 release 包上按一次 ⌘⇧N 开出了 7 个窗口（日志里 7 条 `ui.menu.select` `menu.file.new_window`），`3b6c157` 上 Theme 菜单也复现同一现象（`docs/test/20260925-r7-d29-d24-gui-acceptance.md`）。已确认的原因：`useMenuEvents.ts` 每次 App 渲染都重建 `menu:action` 订阅，`listen()` resolve 前的 cleanup 漏掉它，泄漏的订阅在聚焦窗口里累积；修法是每次挂载只订阅一次 + `cancelled` 标志（`3c9945b`）。预期行为：⌘⇧N 或 File → New Window（`menu.file.new_window` → `create_window`）开出**一个**独立的编辑器窗口，尺寸是按屏幕适配的默认值、不设位置，原意由窗口服务器层叠、真机上实际并未层叠（见限制）（ADR-0037：全局 `windowState` 只归 `main`，前端水合不再把新窗口挪到 100,100；日志 `window.create {geometry:"default", geometryReason:"no_path"}`，2026-10-02 真机确认，D24 D-4：新窗口 1200×800、`main` 留在原位）。**怎么确认**：用修复后的 release 包干净启动，在几个窗口里打字一阵后按一次 ⌘⇧N，数新开的窗口，并在 `~/.mdpro/mdpro.log` 里数这次按键之后的 `menu.file.new_window` 条数——应为 1，且其 `windowLabel` 为当时聚焦的窗口 |
| 多窗口文档 | Shipped | `src-tauri/src/commands/window.rs`, `src/hooks/useMenuEvents.ts` | 开两个窗口各打开不同文件，视图模式互不影响；菜单里点 ⌘S 只作用于当前聚焦的那个窗口。D31 之前，订阅泄漏会让一次 ⌘S 在聚焦窗口里执行 N 次（仍只在聚焦窗口，不会跨窗口）；已在代码里修好，2026-10-02 真机复查：脏文档上 ⌘S 一次恰一对 `file.save`（`docs/test/20261002-dtrack-device-retest.md`）。现在每条 `ui.menu.select` 都带 `windowLabel`，可在 `~/.mdpro/mdpro.log` 里确认一次菜单动作只由一个窗口执行：脏文档上 ⌘S 一次应恰好一条 |
| 全局窗口状态持久化 | Partial | `src-tauri/src/commands/preferences.rs`, `src-tauri/src/commands/window_state.rs`, `src/services/windowStateApplier.ts`, `src/hooks/saveWindowStateOnClose.ts` | 限制：只记 `main` 窗口，其他窗口既不写也不读全局记录（ADR-0037）。把 `main` 窗口拖到某个位置并改大小，退出再启动，尺寸、位置、最大化状态应当还原：关窗时 `useWindowCloseGuard` 经 `saveWindowStateOnClose` 把逻辑点交给 `preferencesService.saveWindowState`，2026-09-27（ADR-0031 第 5b 步，`8b9d8d3`）起它真的调到 `save_window_state`；此前（D24）它在环境探测处直接 return。读回只作用于 `main`：其他窗口水合时跳过，记 `window.apply_state {outcome:"skipped", reason:"not_main"}`；`main` 每次应用恰好记一条 `window.apply_state`——`applied`（带 `monitor` 为 `"reported"` 或 `"absent"`）、`maximized`，或抛错时 warn 级 `failed`，只有枚举、不带几何（D24 Part B WI-5，真机未验）。保存侧同样只让 `main` 写（第 5a 步）：前端对非 `main` 窗口记 `window.save_state {outcome:"skipped", reason:"not_main"}`，Rust `save_window_state`（`window_state.rs`）对非 `main` 标签不加锁不写、直接返回 `Ok`——这一层从注入的 `Window` 取 label，只有真机能证。真机 GA 2026-09-27 在 `8b9d8d3` 的 release 包上跑过（见 [D24](plans/20260912-frontend-backend-sequencing-order.md#d24)），ADR-0032 GA-8、GA-9、GA-10 通过：关副窗口只记一条不带标签与坐标的 skipped，全局 `windowState` 不变（盘上时间戳会变，因为同时写了该文件自己的按文件几何）；关 `main` 写入全局记录，重启位置还原。关窗保存全有或全无：全局写失败就不写按文件几何；失败日志只带阶段枚举 `reason`（`geometry_read_failed` / `save_rejected` / `geometry_save_rejected`），不带错误文本或坐标 |
| 按文件记忆窗口几何 | Partial | `src-tauri/src/services/window_restore.rs`, `src-tauri/src/services/window_restore_log.rs`, `src-tauri/src/services/window_geometry.rs`, `src-tauri/src/commands/window.rs`, `src-tauri/src/services/open_route/tauri_glue.rs`, `src/hooks/useWindowCloseGuard.ts`, `src/hooks/saveWindowStateOnClose.ts`, `src/services/windowService.ts`, `src/services/windowStateApplier.ts`, `src/utils/windowGeometry.ts` | 关窗时 `useWindowCloseGuard` 经 `saveWindowStateOnClose` 调 `windowService.saveWindowGeometry` 落到 `save_window_geometry`，按文件路径存逻辑点（ADR-0031 / WI-3；零宽 / 零高 / 超大几何被 `sanitize_geometry` 挡在 `config.json` 之外）。2026-09-25 真机确认写入侧：Retina 2× 下把 b.md 的窗口调到 333,177 / 1011×655 再关，存进 `{x:333, y:177, width:1011, height:655}`（`docs/test/20260925-r7-d29-d24-gui-acceptance.md`）；同一次运行里读回失败，从 Finder 再开 b.md 回到 100,100 / 1200×800。**2026-09-26 起读回接上了（D24 补记，本提交）**：凡是为某个文件新建窗口的入口——Finder / `open -a` 与第二实例带参启动在没有命中已开窗口时、D29 `emit_to` 失败的兜底，三者都走 `open_file_in_new_window`；以及 `create_window` 带 `filePath`——都经 `window_restore::restore_geometry_for` 读存下的几何：持 `preferences_rw_lock` 读 `config.json`，按 D29 的 `same_file` 规则找键（`/tmp` 与 `/private/tmp`、符号链接、`/./` 拼法互通，多个别名键取 `last_accessed` 最新的），再经 `clamp_geometry` 夹进主显示器工作区（旧的 2× 条目会被夹小，下次关窗覆盖）。没有路径（⌘⇧N）、没有记录或 `config.json` 读不了时，用按屏幕适配的默认尺寸、不设位置、由窗口服务器层叠；读失败不回写该文件。前端水合不再盖掉它：全局 `windowState` 只作用于 label 为 `main` 的窗口（ADR-0037）。**怎么确认**：给 b.md 调一个窗口大小后关，再开另一个文档，然后从 Finder 双击 b.md，新窗口应回到原位置与尺寸；`~/.mdpro/mdpro.log` 里那条 `window.open` 带 `geometry:"stored"`、`geometryReason:"stored"`、`geometryClamped:false`（旧 2× 条目为 `true`，读失败为 Warn `read_failed`）。DevTools 里 `invoke("get_window_geometry", { filePath })` 用同一个别名容错查找，读到的就是还原会用的记录。限制：`main` 冷启动时带进来的文件、以及以标签页开进已有窗口的文件（⌘O、最近文件、拖拽、只有 `main` 时的第二实例 broadcast）都不还原按文件几何；只按主显示器夹取，存在副显示器上的窗口会被拉回主显示器；读回这一半 2026-10-02 在 `ef91e24` 的 release 包上真机验证 D-1…D-5 通过（stored 几何精确还原、第二实例带绝对路径、越界夹进 `0,33 1512x949`、⌘⇧N 走默认、`/tmp` 与符号链接别名，`docs/test/20261002-dtrack-device-retest.md`），D-6（scale-1 显示器）没有外接屏，NOT VERIFIED；没有路径时的默认窗口实际不层叠，都落在 156,71；`create_window(filePath)` 在前端没有调用点；关 `main` 时若全局 `windowState` 写入失败，这次的按文件几何也不写（全有或全无，第 5b 步） |
| 原生 Window 菜单 | Shipped | `src-tauri/src/menu.rs` | Window 菜单里有 Minimize（⌘M）、Maximize、Close Window（⌘W） |
| 标签栏配置 `TabBarConfig` | Stub | `src-tauri/src/models/preferences.rs`, `src/types/preferences.ts` | Rust 与 TS 两边都有默认值（位置、最大可见标签数、关闭后的焦点行为），没有 UI、没有消费者，README 却把它当成已交付的可配置功能。翻遍 ⌘, 十个页面都找不到标签栏设置 |
| 标签页进阶能力 | Stub | `src/stores/tabStore.ts`, `src/components/TabBar/TabBar.tsx` | 固定标签、拖拽重排、撤销关闭标签（最近 10 个）、MRU 切换、按标签恢复滚动与光标——`tabStore.ts` 全部实现且有测试，但只被死掉的 `TabBar.tsx` 引用，UI 上到不了。在底部标签条上右键或中键点击都没有固定 / 撤销关闭的入口 |

### 平台集成

| 能力 | 状态 | 在哪 | 怎么确认 |
|---|---|---|---|
| 原生 macOS 菜单栏 | Shipped | `src-tauri/src/menu.rs` | 顶部有 App、File、Edit、View、Format、Theme、Window、Help 八个菜单 |
| 应用菜单基础项 | Shipped | `src-tauri/src/menu.rs` | mdpro 菜单里有 About、Services、Hide（⌘H）、Hide Others、Show All、Quit（⌘Q） |
| 应用内更新检查 | Shipped | `src/components/common/settings/AboutSettings.tsx` | ⌘, → About 里点检查更新，有新版时显示版本说明，下载时有进度条；进度与阶段都在 `updaterStore` 里 |
| 重启应用更新 | Shipped | `src/components/common/settings/AboutSettings.tsx` | 下载完成后弹出「Save and Restart / Don't restart yet」二选一 |
| 重启前保存守卫 | Shipped | `src/hooks/useUpdater.ts` | 留一个未命名的脏文档再点重启，被拦下并提示；把它保存好之后重启才放行。在 WYSIWYG 里打字后立刻点重启，写盘的是刚打的字而不是旧内容（先 flush 再判断，与关窗口、⌘Q 共用 `assessWindowUnsaved`）；flush 失败则一个字都不写、只弹一次提示 |
| 版本号显示 | Shipped | `src-tauri/src/commands/updater.rs` | ⌘, → About 里显示 `get_app_version` 返回的版本号，与 `tauri.conf.json` 里的一致 |
| 退出守卫：原生钩子、逐窗口提示与回复通道 `quit_guard_reply` | Partial | `src-tauri/src/services/quit_guard/macos.rs`, `src-tauri/src/commands/quit_guard.rs`, `src-tauri/src/services/quit_guard/driver.rs`, `src-tauri/src/services/quit_guard/rounds.rs`, `src-tauri/src/services/quit_guard/backstop.rs`, `src/hooks/useQuitGuard.ts`, `src/utils/quitGuardHandlers.ts`, `src/utils/quitDraftBackstop.ts`, `src/utils/quitDiscardSnapshot.ts`, `src/utils/quitDialogModel.ts` | **限制：对话框送达之后渲染进程才冻死时，两秒超时已不适用（ADR-0029），出路只有 ADR-0030 的菜单逃生口 *Stop Waiting and Quit…*（见下一行；2026-09-25 已对着 `SIGSTOP` 冻住的渲染进程真机验过，`docs/test/20260925-r7-d29-d24-gui-acceptance.md`），且在草稿兜底阶段（ADR-0035，≤2 秒）点它不起作用；D26（窗口答完退出提示后仍可编辑、commit 时被静默丢弃）已按 ADR-0035 修复并于 2026-09-25 真机验收通过（ADR-0035 Accepted），但仍有两条限制：①原生警告的 Quit Without Saving（ADR-0027 §5）仍丢掉用户已接受的 discard，且后台标签页的编辑在这条路上仍被静默丢弃——改它须另立 ADR 取代 ADR-0027 §5；②commit 时等 `DraftGate::close()` 没有上界，一次卡住的保存会冻住主线程（`app.quit.commit` 的 `gateWaitMs` 只记录等了多久，不设限）。** 探针已实测：`NSTerminateLater` 未答复期间 AppKit 完全屏蔽退出路径，第二次 ⌘Q 连 IMP 都进不去（日志零字节增长），所以「再按一次 ⌘Q」不是逃生口。 2026-09-23 先在 `ab54ee6` 的 release 包上跑过一轮（`docs/test/20260923-d16-gui-acceptance.md`）：G2 / G13 / G15 / G22 通过，**G20 / G21 失败**——`useQuitGuard.ts` 当时用全局 `listen`，一条点对点的提示被每个窗口都收到了，于是两个窗口同时弹框，没被提示的那个点 Cancel 则毫无效果。改为按 webview 订阅之后**已在 `8a7c1a7` 上真机复验通过**：两个脏窗口只弹一个框，错相 cancel 被拒且日志里带 `outOfPhase`。同一轮里 **ADR-0027 / ADR-0029 的超时与原生警告也第一次被实测通过**——超时在 +2.00 s 弹出警告框，选 Quit Without Saving 后提交 `deleted:0` 并在 3 ms 内退出，证明 `runModal` 的嵌套 run loop 不与驱动死锁，草稿文件逐字节未变；先应答 `delivered` 再挂住 3 分 29 秒不会超时。**这批证据横跨两个二进制**：G20/G21 复验、超时与警告框跑在一个 `--features tauri/devtools` 的构建上，release 包上跑的是另外四条。警告框里选了什么原先不记日志（选 Quit Without Saving 只留 `commit`，选 Keep Open 只留 `cancel {reason:userKeptOpen}`），**已在 `0989941` 补上** `app.quit.fallback`（见下方怎么确认）。另外 ADR-0027 警告框上 Escape 不做任何事——AppKit 只把 Escape 绑给标题字面为 "Cancel" 的按钮，而 Keep Open 必须占 Return 默认位。WI-4 已把 `applicationShouldTerminate:` 用 `class_addMethod` 加到运行中的 tao 委托类上（ADR-0025 §1），WI-7 已接上 webview 应答方：⌘Q 时 `app:quit-requested` 问每个窗口脏不脏，`app:quit-prompt` 再逐个提示，答案经 `quit_guard_reply` 回到协调器。**怎么确认**：启动时 `~/.mdpro/mdpro.log` 应有一条 `app.quit.hook_installed`，`context.delegateClass` 为 tao 的 `TaoAppDelegateParent`、`outcome` 为 `added`；不是 `added` 就说明钩子没装上，那一行是 error 级、带 `error` 原因。改脏一个文档后 ⌘Q 应出现 `app.quit.request` 并弹出该窗口的保存提示；窗口两秒内不应答才出现 `app.quit.timeout` 与原生警告「mdpro isn't responding to the quit request」，Keep Open 取消退出，Quit Without Saving 直接退出且**不删任何草稿**（ADR-0027 §5）。**两秒只卡机器、不卡人**（ADR-0029）：提示弹出后窗口立刻回一条 `delivered`，日志里 `app.quit.answer` 的 `answer` 为 `delivered`；这条 ack 到了之后对话框可以开多久都不会超时，读半小时再点 Discard 依然生效。提示本身另有两秒的**送达**预算，从发提示那一刻起算；送不到（`emit_to` 失败或窗口没回 ack）直接转原生警告，不会把退出请求永远吊着。派发失败的效果会留下 `app.quit.effect_failed`（error 级，`context.effect` 为 `activate` / `emitPrompt` / `emitCancelled` / `reply` / `nativeFallback` / `timerDispatch` 之一，`0989941` 起不再有静默失败）；提示没送到记的是 `emitPrompt`，**不会**再记成 `app.quit.timeout`。警告框里的选择记为 `app.quit.fallback`，`context.answer` 只可能是 `keepOpen` / `quitWithoutSaving`，不带 id 与路径。提交时有草稿删除失败，`app.quit.commit` 为 `status: fail`。前端退出事件订阅失败记为 `app.quit.listen`（只带数量）；`quit_guard_reply` 的报错文本不再回显文档 id（`943846b`）。另外提示是**点对点**的：多窗口时只有被提示的那个窗口弹框，日志里 `app.quit.check` `phase: prompt` 只应有一条。被协调器拒绝的应答不再记成成功——`app.quit.answer` 会是 `status: fail`，`error` 里带 `outOfPhase` 之类的原因。参数校验可单独验：DevTools 里 `invoke('quit_guard_reply', { requestId: 1, answer: 'clean', documentIds: [] })` 会被拒绝并提示 documentIds 只能跟 discard 一起用。**ADR-0035 的复查与草稿兜底**：每次退出（即使全都干净）在 commit 前都多一轮 `app.quit.recheck`（`{requestId, round, windowCount}`），所有事件与应答都带 `round`，过期轮次的应答被忽略；答完之后又被改过的窗口会再弹一次提示，每个窗口每次退出最多再提示一次，已 Discard 且未再改动的文档不会再触发提示。已 Discard 之后又改过的文档会被兜底写草稿并**保留**该草稿（`drafted` 应答用 `documentIds` 点名，Rust 只认同一窗口自己 discard 过的 id；新编辑胜过旧的 Discard），`app.quit.commit` 的 `undiscarded` 记其数量。commit 前有一轮 `app.quit.backstop`：每个窗口给每个仍未保存的文档（不论是否活动标签页）写草稿并回 `drafted` 与计数，下次启动可恢复；这一轮自有 2 秒期限，到期直接 commit，不弹原生警告。`app.quit.commit` 里多了 `drafted` / `draftFailed` / `draftMissing` / `capped` / `undiscarded` / `backstop` / `gateWaitMs`，只有数量；应答送不到时前端记 `app.quit.send`（warn）；`draftFailed` / `draftMissing` / `capped` 任一大于 0 即为 `status: fail`。**2026-09-25 真机验收**（`docs/test/20260925-d26-gui-acceptance.md`）：窗口 A 在 round 0 答 `clean`，窗口 B 对话框开着时在 A 的后台标签页改字，B 答 Discard 后 round 1 里 A 被再提示；A 用掉再提示后又被改，会在下一轮被 capped（`capped:1`）而不再弹框，其编辑由兜底写成草稿，下次启动 *Recover drafts* 可恢复；在再提示上点 Keep editing 记 `app.quit.cancel`，两窗口都留着且可编辑 |
| 退出卡住时的逃生口：mdpro 菜单 → Stop Waiting and Quit…（`menu.app.stop_waiting_quit`） | Shipped | `src-tauri/src/menu.rs`, `src-tauri/src/services/quit_guard/driver_escape.rs`, `src-tauri/src/services/quit_guard/escape.rs`, `src-tauri/src/services/quit_guard/logging_escape.rs`, `src-tauri/src/services/quit_guard/alert_text.rs` | **2026-09-25 在 `3b6c157` 的 release 包上真机验收通过**（`docs/test/20260925-r7-d29-d24-gui-acceptance.md`，ADR-0036 Accepted）：m1 位置 / 可点 / 无快捷键，m2 空闲点击记 `noop`，m3 对话框开着时点击弹原生警告、Keep Open 恢复正常，以及它存在的理由——ADR-0030 的残留检查：提示送达后用 `SIGSTOP` 冻住渲染进程，点它仍弹出原生警告，Quit Without Saving 退出后下次启动草稿可恢复。须知：草稿兜底阶段（ADR-0035，≤2 秒）点它被忽略，要等兜底自己的期限到；从这里进入的原生警告有自己的标题与正文（「Stop waiting and quit mdpro?」，文案由 `alert_text.rs` 按触发原因选取）：说明 mdpro 还没查完每个窗口的未保存修改，现在退出会丢掉所有窗口的未保存修改、草稿保留；按钮与超时警告相同，超时那条的文案不变（2026-09-26 修复，仅单元与契约测试覆盖）。ADR-0030 / ADR-0036：mdpro 菜单里紧挨 Quit 下方，无快捷键、始终可点；只在 Rust 里处理，不发 `menu:action`，不依赖任何 webview。按协调器所处阶段裁决：空闲或已 commit 时什么都不做；一阶段、复查轮、提示未送达、对话框已弹出（`deciding`）时把这次退出请求交给 ADR-0027 的原生警告（Keep Open / Quit Without Saving），与超时走同一条路，此后迟到的窗口应答以 `fallbackOwns` 拒掉；警告框已在显示时再点被忽略，一个请求最多一个警告框；Keep Open 之后请求即结束，再 ⌘Q 卡住再点会再弹一次。**怎么确认**：空闲时点它，`tail -f ~/.mdpro/mdpro.log` 里（用 `jq` 看）应看到一条 `app.quit.escape`，`context.outcome` 为 `noop`、`phase` 为 `idle`；有脏文档时 ⌘Q、等保存对话框弹出后再点，应先出现 `app.quit.escape` `outcome: fallback`（不会有 `app.quit.timeout`）再弹原生警告，选 Keep Open 后有 `app.quit.fallback` `answer: keepOpen`、app 恢复正常。日志只带 `outcome` / `phase` / `requestId` / `round` / `unresolvedCount` / `reason`，全是数量与枚举，不含窗口标签、文档 id 或路径。**逃生口专用文案的真机检查待做**：`deciding` 时点它，警告标题应为「Stop waiting and quit mdpro?」、Keep Open 为默认按钮；另用 `SIGSTOP` 触发超时，警告应仍是「mdpro isn’t responding to the quit request」；浅色与深色外观各看一遍 |
| 云同步 | Absent | — | 设置里没有任何账号或同步项；文件只在本地。立场 |
| 协作编辑 | Absent | — | 两个人同时开同一个文件不会看到对方的光标或改动。立场 |
| 版本历史 | Absent | — | 没有查看或回滚历史版本的入口（草稿恢复只针对崩溃，不是版本史）。立场 |
| 第三方插件市场 | Absent | — | 设置里没有插件浏览或安装入口；`src/plugins/` 是编辑器内部结构，不对外开放。立场 |
| 移动端 | Absent | — | 没有 iOS / iPadOS 构建目标，只发 macOS 的 .dmg |
| Windows 构建 | Unknown | `scripts/build-windows.sh` | `scripts/build-windows.sh` 在仓库里，但目标平台只声明 macOS 13+ ARM64，从未在此验证。不要据此声称 Windows 可用 |

> **关于「45 个定义、44 个注册」**：核对下来不成立。`src-tauri/src/commands/mod.rs::handlers()` 里注册了 46 个（D16 WI-3 加入 `quit_guard_reply` 之前是 45 个；D27 加入 `discard_recovery_draft` 后是 47 个），仓库里带 `#[tauri::command]` 的定义与之同数，逐名对齐没有漏网的。当年数出 44 多半是按逗号数的——列表最后一项后面没有逗号（那时是 `updater::get_app_version`，现在是 `quit_guard::quit_guard_reply`）；而直接 grep `tauri::command` 会数出 49，多出的三处在 `src-tauri/src/commands/logging.rs`（两处）与 `src-tauri/src/services/markdown.rs`（一处）的文档注释里。真正该记的不是漏注册，是注册了却没人调用的那四条：`get_draft`、`mcp_get_server_info`、`preview_html`、`export_html`，上面每条都有自己的一行。

---

## Part 2 —— 对照组

| Code | 编辑器 | 为什么它在这里 |
|---|---|---|
| Typ | Typora | 它是"所见即所得 Markdown"这条产品线的原型，用户对 mdpro 的默认期待其实是对它的记忆。 |
| MkT | MarkText | 同架构的开源前辈（Electron + 自研 Muya 引擎），用来回答"一个人做 Typora 替代品，工程上会卡在哪里"。 |
| Obs | Obsidian | 把编辑器扩张成知识库的一极，用它标定 mdpro"不做插件市场、不做双链"这两条否决要付出的代价。 |
| Ztl | Zettlr | 学术写作的一极（引文、Pandoc 管线、多格式导出），用来划清"只导出 HTML"这条边界到底切掉了谁。 |
| iAW | iA Writer | 克制的一极——把"功能少"本身当作卖点，用来检验 mdpro 的删减是设计主张还是尚未补齐。 |
| Bea | Bear | Apple 生态精致一极，也是唯一同样自带第一方 MCP 的对手，它证明"本地笔记 + AI 接口"不是 mdpro 的专利。 |
| Uly | Ulysses | 订阅制长文写作的一极，用目标、看板与发布管线换掉了"文件就是文件"这个前提。 |
| VMk | VMark | 与 mdpro 几乎同构的对手：Tauri 2 + React 19 + Zustand，Tiptap 所见即所得 + CodeMirror 6 源码模式，而且同样有**写进活缓冲区**的第一方 MCP。凡是账簿里「mdpro 独家」的说法，都要先过它这一关。 |
| MYn | MiaoYan（妙言） | 原生 Swift/AppKit 的轻量 Markdown 笔记，**明确拒绝所见即所得**（README：原生 Swift 里实现 WYSIWYG 过于复杂），用分栏预览换简单。它是 mdpro 所见即所得这一赌注的反方。 |
| SiY | 思源笔记 SiYuan | 块结构知识库的一极（Electron + Go 内核，`.sy` JSON 存储）：所见即所得、块引用、双链、第一方 MCP 全有，代价是文件不再是 `.md`。接替原 Logseq 那条「结构化」轴。 |
| Jop | Joplin | 同步优先、全平台的开源笔记（Electron，SQLite 存储，Joplin Cloud）。接替原 Notion 那条「同步与多端」轴，但它是开源、本地可用的，比 Notion 更接近 mdpro 真实会被拿来比较的对象。 |

这十一个不是"十一个竞品"，而是十一条轴：**原型（Typ）、同路人（MkT）、扩张（Obs）、学术（Ztl）、克制（iAW）、精致（Bea）、长文商业化（Uly）、同构对手（VMk）、原生反 WYSIWYG（MYn）、块结构（SiY）、同步多端（Jop）**。mdpro 在每条轴上都有一个明确的、可以被质问的位置。

---

## Part 3 —— 差距矩阵

图例：`● 有　◐ 部分　○ 没有　◍ 空壳　– 不适用`

> **◍ 空壳**的定义：代码在仓库里，但用户点不到或拿不到结果。mdpro 有三处空壳，全部经仓库核实（见下方"mdpro 列的取证"）。

### 人人都有而 mdpro 没有

| 能力 | mdpro | Typ | MkT | Obs | Ztl | iAW | Bea | Uly | VMk | MYn | SiY | Jop |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 全局搜索 | ○ | ● | ● | ● | ● | ◐ | ● | ● | ● | ● | ● | ● |
| 文件树 / 工作区 | ○ | ● | ● | ● | ● | ● | ◐ | ● | ● | ● | ● | ● |
| 文件增删重命名 | ○ | ● | ● | ● | ● | ● | ● | ● | ◐ | ● | ● | ● |
| 查找与替换 | ◐ | ● | ● | ● | ● | ● | ◐ | ● | ● | ● | ● | ● |
| 字数统计 | ○ | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| 拼写检查 | ◍ | ● | ● | ● | ● | ● | ● | ● | ○ | ○ | ● | ● |
| PDF 导出 | ○ | ● | ● | ● | ● | ● | ◐ | ● | ● | ● | ● | ● |
| 打印 | ○ | ● | ● | ● | ● | ● | ● | ● | ● | ◐ | ◐ | ● |
| 自定义主题 / CSS | ○ | ● | ● | ● | ● | ◐ | ● | ● | ● | ○ | ● | ● |
| 界面本地化（中文界面） | ○ | ● | ● | ● | ● | ◐ | ● | ● | ● | ● | ● | ● |

**10 行。** 这一桶换了四个对照组之后仍然成立——新增四列里只有 VMk、MYn 没有拼写检查、MYn 没有自定义主题。三个要点：

1. **查找与替换只做了一半。** `src/components/Editor/extensions/search.ts` 挂了 CodeMirror 的 `search({top:true})` + `searchKeymap`（⌘F / ⌘H），但文件里写着 *"WYSIWYG (Milkdown) mode search is out of scope — tracked as a follow-up."* 也就是说：mdpro 主打的那个模式恰恰是搜不了的。
2. **字数统计是零。** 全仓库 `wordCount` / `word_count` / `字数` / `StatusBar` 零命中——不是做得差，是完全没有。换上 VMk / MYn / SiY / Jop 之后，十一个对照组**无一例外全是 ●**。
3. **一个 Markdown 编辑器打不了印。** `menu.rs` 与全部组件里没有任何 print 路径。

### 有争议 —— 是真功能，但并不普遍

| 能力 | mdpro | Typ | MkT | Obs | Ztl | iAW | Bea | Uly | VMk | MYn | SiY | Jop |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 编辑区数学排版 | ○ | ● | ● | ◐ | ● | ○ | ● | ◐ | ● | ◐ | ● | ◐ |
| 编辑区脚注渲染 | ○ | ● | ● | ◐ | ◐ | ○ | ◐ | ◐ | ● | ◐ | ● | ◐ |
| Mermaid / 图表 | ◍ | ● | ● | ● | ◐ | ○ | ● | ○ | ● | ● | ● | ● |
| Word / docx 导出 | ○ | ◐ | ○ | ◐ | ● | ● | ◐ | ● | ○ | ○ | ● | ○ |
| Wikilink `[[…]]` | ○ | ○ | ○ | ● | ● | ◐ | ● | ◐ | ● | ● | ● | ◐ |
| 标签 | ○ | ○ | ○ | ● | ● | ● | ● | ● | ○ | ● | ● | ● |
| 反链 / 关系图 | ○ | ○ | ○ | ● | ● | ○ | ◐ | ◐ | ● | ● | ● | ◐ |
| 打字机模式 | ◍ | ● | ● | ◐ | ● | ● | ○ | ● | ● | ○ | ● | ○ |
| 专注模式 | ◍ | ● | ● | ◐ | ● | ● | ◐ | ● | ● | ○ | ◐ | ○ |
| 演示模式 | ○ | ◐ | ○ | ● | ◐ | ○ | ○ | ○ | ● | ● | ○ | ○ |
| 引文 / BibTeX | ○ | ○ | ○ | ◐ | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| 图床上传 | ○ | ● | ● | ◐ | ○ | ◐ | ○ | ◐ | ○ | ● | ◐ | ○ |
| 版本历史 | ○ | ◐ | ○ | ● | ○ | ● | ○ | ◐ | ● | ● | ● | ● |
| 云同步（第一方） | ○ | ○ | ○ | ● | ○ | ○ | ◐ | ● | ○ | ○ | ● | ● |
| 移动端 | ○ | ○ | ○ | ● | ○ | ◐ | ◐ | ◐ | ○ | ● | ● | ● |
| 实时协作 | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| 插件市场 | ○ | ◐ | ○ | ● | ○ | ○ | ○ | ○ | ○ | ○ | ● | ● |
| Windows / Linux | ○ | ● | ● | ● | ● | ◐ | ○ | ○ | ● | ○ | ● | ● |
| 纯本地 `.md` 文件 | ● | ● | ● | ● | ● | ● | ○ | ◐ | ● | ● | ○ | ○ |
| 多标签页 | ● | ○ | ● | ● | ● | ● | ◐ | ◐ | ● | ○ | ● | ◐ |

**20 行。** 五个要点：

1. **数学与脚注是 mdpro 最尴尬的一格。** 语法解析、KaTeX、MathML 导出全部做完了——但 `katex` 在前端只被 `src/services/exportService.ts` 一个文件引用。也就是说：**mdpro 能把 `$E=mc^2$` 导出成 MathML，却不能让你在编辑时看见它。** 对一个以 Typora 体验为卖点的产品，这一格的对照组是 Typ ● / MkT ● / Ztl ● / Bea ● / **VMk ●** / SiY ●——与 mdpro 同构的 VMark 在同一套 Tauri + React 栈上做到了。MYn 与 Jop 的 ◐ 是分栏预览里渲染、编辑区不渲染，和 mdpro 的 ○ 不是一回事：它们至少让你在写的时候看得见。
2. **Mermaid 是三处空壳中最有误导性的一处。** `markdown.rs` 的 `SVG_TAGS` 白名单与 `sanitizerPolicy.ts` 都专门为 Mermaid 内联 SVG 留了口子，还有 `test_sanitize_preserves_mermaid_svg` 这样的测试——但 `package.json` 里**根本没有 mermaid 依赖**。净化器为一个不存在的渲染器守了门。
3. **打字机模式与专注模式同理。** `focusModePlugin.ts`（75 行）和 `typewriterModePlugin.ts`（44 行）是真实现且已在 `plugins/index.ts` 注册，但 `pluginConfig.ts` 里两者都是 `enabled: false`，而 `src/components`、`src/hooks`、`src-tauri` 中**没有任何开关**。用户永远打不开它们。
4. **`[[wikilink]]` + 标签 + 反链这一组，Typ 和 MkT 也全是 ○。** 这说明"不做双链"不是 mdpro 的短板，而是它站在 Typora 那条线上的结果——分界在 Obs/Ztl/SiY 那一侧。**但这条线比建账时软了**：同样是轻量 Markdown 编辑器的 MYn 有 `Business/WikilinkIndex.swift` 的双向链接，同构的 VMk 也有 wikilink 与反链（反链与关系图在它的本地 knowledge base 面板里，不在编辑器里）。这一组仍值得作为"明确不做"写进 ADR，而 ADR 的 Context 要写明「Typora 线上的产品也开始做了」。
5. **mdpro 在最后两行是赢的**：纯本地文件（Bea 与 Jop 是 SQLite，SiY 是 `.sy` JSON，Uly 是专有库）和多标签页（**Typora 至今没有标签页**，这个诉求从 2016 年挂到现在；MYn 也没有）。这两行赢面最大的是块结构与同步那两极，对 VMk 则两行都打平。

### mdpro 有而多数没有

| 能力 | mdpro | Typ | MkT | Obs | Ztl | iAW | Bea | Uly | VMk | MYn | SiY | Jop |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 第一方 MCP server | ● | ○ | ○ | ◐ | ○ | ○ | ● | ○ | ● | ○ | ● | ● |
| AI 直写"正在编辑"的文档 | ● | ○ | ○ | ◐ | ○ | ○ | ◐ | ○ | ● | ○ | ◐ | ○ |
| 源码模式下的表格 CRUD | ● | ○ | ○ | ○ | ◐ | ◐ | – | – | ● | ○ | – | ○ |
| 图片拖拽缩放写回 Markdown | ● | ◐ | ○ | ◐ | ◐ | ○ | ◐ | ○ | ○ | ○ | ◐ | ○ |
| 结构化 JSONL 日志 | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ◐ | ● | ○ | ○ |
| Rust 白名单净化的 HTML 导出 | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| 非 Electron 原生外壳 | ● | ○ | ○ | ○ | ○ | ● | ● | ● | ● | ● | ○ | ○ |
| UTF-16 编码检测与往返保真 | ● | ◐ | ◐ | ○ | ○ | ○ | – | – | ○ | ○ | ○ | ○ |

**8 行。** 这一桶是换组之后变化最大的一张——**前两行已经不再是 mdpro 独有**。四个要点：

1. **「写进活的编辑缓冲区」不再是独家。** 建账时这一格被写成「mdpro 唯一真正没有对手的一格」；换入 VMark 后不成立了。VMark 的 MCP `document.write`（`server/mcp/src/tools/document.ts`）写的是「VMark 已经持有的那个缓冲区」，按 tab 定位，默认顺带落盘，还带 `expected_revision` 乐观锁。其余三家仍然对着存储层说话：Bear 是 SQLite 库；SiYuan 的 MCP 块工具走内核事务 `PerformTxSync`，再 `PushReloadProtyle` 让打开的编辑器整篇重载（所以给 ◐，是被动刷新而不是写进缓冲区）；Joplin 的 MCP 默认全部关闭、挂在 Web Clipper 端口上，改的是库里的笔记对象。**第一方 MCP 这一行在十一个对照组里已有 VMk / Bea / SiY / Jop 四个 ●**。mdpro 与 VMark 在这一格上的差异，这次**没有**比较两者的工具集，账簿给不出答案。
2. **源码模式的表格 CRUD 也有了一个对手。** VMark 的 `src/plugins/sourceContextDetection/tableActions.ts` 在源码侧做行列增删。其余对手的表格 UI 仍然只在富文本面：Typora 的源码模式是裸文本，Obsidian 的表格菜单在 Live Preview，SiYuan 根本没有源码模式（–）。mdpro 在 CodeMirror 侧有 `SourceTableContextMenu` + `lintTableColumnCount` + `sourceTableDetection`。
3. **后四行是「工程姿态」而非功能**，写进账簿时要标明它们的说服对象是自己和维护者，不是用户。JSONL 日志不再独有：MYn 的 `Helpers/Diagnostics.swift` 按行写 JSON 到 `~/Library/Logs/MiaoYan/diagnostics.log`（VMk 的 JSONL 是 `coherence/ledger.rs` 的 AI 溯源账本，不是诊断日志，给 ◐）。Rust 端 HTML 白名单净化与 UTF-16 往返保真（`encoding.rs` 对奇数字节长度显式报错而不是静默吞掉）在十一个对照组里仍然只有 mdpro 有。它们换不来一个新用户，但它们是「这个产品不会悄悄弄坏你的文件」的唯一证据。
4. **`非 Electron 原生外壳` 这一行快撑不住这个桶了。** 加上 VMk（同为 Tauri）和 MYn（Swift/AppKit），十一个对照组里有五个 ●。它仍是事实，但已经不是「多数没有」。

---

## mdpro 列的取证

mdpro 这一列**全部来自仓库核实**，不是回忆。关键命中：

| 格 | 判定 | 证据 |
|---|---|---|
| Mermaid | ◍ | `package.json` 无 mermaid 依赖；`src-tauri/src/services/markdown.rs` `SVG_TAGS` 与 `src/services/sanitizerPolicy.ts` 仅为其预留白名单 |
| 拼写检查 | ◍ | `src/plugins/codemirror/spellCheckPlugin.ts` —— `displayName: "Spell Check (Stub)"`，`codemirrorExtension: () => []`，init 里只打一条 `TODO: integrate dictionary backend` |
| 打字机 / 专注模式 | ◍ | 插件已实现并注册（`src/plugins/index.ts`），但 `src/plugins/core/pluginConfig.ts` 中 `enabled: false`，且组件/hooks/Rust 侧零开关 |
| 编辑区数学 | ○ | `katex` 仅被 `src/services/exportService.ts` 引用（经 `src/services/mathRender.ts`）；导出面之外无排版 |
| 查找与替换 | ◐ | `src/components/Editor/extensions/search.ts` 仅挂在 `Editor.tsx`（CodeMirror）；注释明写 WYSIWYG 搜索 out of scope |
| 字数统计 | ○ | `wordCount` / `word_count` / `charCount` / `StatusBar` / `字数` 全仓库零命中 |
| 打印 | ○ | `menu.rs` 及全部组件无 print 路径（唯一命中是 `MarkdownSettings.tsx` 的 "Pretty-print GFM tables"，不相关） |
| 文件树 / 工作区 | ○ | `src/components/Sidebar/` 只有 `FileItem` / `Sidebar` / `TOCSidebar`；`App.tsx` 的 `workspace` 只是 CSS 类名 |
| 界面本地化 | ○ | 无 i18n / locale / useTranslation 任何基础设施 |
| 自定义主题 CSS | ○ | `AppearanceSettings.tsx` 仅暴露 `CODE_THEMES = ["default","oneDark"]`，无用户 CSS 加载路径 |
| 快捷键自定义 | ●（未入表） | `KeyboardShortcutsSettings.tsx`（10.4K），File/Edit 等分组可改 |
| 任务列表 | ●（未入表） | Milkdown `gfm` preset + Rust `Options::ENABLE_TASKLISTS` |
| MCP 工具 | ● | `src-tauri/src/bin/mdpro_mcp.rs`（`read_document` / `write_document` / `insert_content` / `get_open_documents`）+ `services/http_server.rs`（45K，含 create_document 与表格工具） |
| UTF-16 | ● | `src-tauri/src/services/encoding.rs` 对 BOM 与奇数字节长度显式处理并报错，注释点名"避免保存时固化损坏" |

---

## 来源

Typ 至 Uly 七组核查于 **2026-09-17**（三组并行研究共抓取约 150 个页面，此处按产品收敛到主要来源）。VMk / MYn / SiY / Jop 四组核查于 **2026-09-22**：四个子代理各读一个 GitHub 仓库（源码、README、文档、release），主会话对存疑格回到仓库复核。原来的 VSC（VS Code + MPE）、Log（Logseq）、Not（Notion）三列在同一天移出对照组。

### Typ —— Typora
`typora.io/` · `/releases/stable.html` · `/releases/all` · `support.typora.io/`（含 `/Math/`、`/Search/`、`/File-Management/`、`/Export/`、`/Spellcheck/`、`/Word-Count/`、`/Draw-Diagrams-With-Markdown/`、`/Focus-and-Typewriter-Mode/`、`/Upload-Image/`、`/Auto-Save/`、`/Version-Control/`、`/Table-Editing/`、`/Outline/`、`/Dark-Mode/`、`/Sync/`、`/Markdown-Reference/`、`/Shortcut-Keys/`、`/purchase/`、`/Install-and-Use-Pandoc/`）· `github.com/typora/typora-issues/issues/6578`
**状态：在维护。** 稳定版 1.14.10；1.14 系列官方标注 2026-07-19。$14.99 买断，闭源。

### MkT —— MarkText　⚠️ 必读
`api.github.com/repos/marktext/marktext`（含 `/releases`、`/releases/latest`、`/commits`、`/contents/...`、`/search/code`、`/search/issues`）· `raw.githubusercontent.com/marktext/marktext/develop/packages/website/content/docs/end-user/{EDITING,MARKDOWN_SYNTAX,EXPORT,PREFERENCES,BASICS,IMAGE_UPLOADER_CONFIGRATION}.md` · `www.marktext.me`

**MarkText 没有停止维护——这与流传的说法相反，必须在账簿里写清楚。**

- 最新稳定版 **v0.19.1，2026-06-06**；预发布 **v0.20.0-rc.3，2026-09-15**；最后一次 push **2026-09-16**（核查前一天）。`archived: false`。
- 但它确实**沉寂过四年**：v0.17.1 停在 2022-03-07，直到 2026-05-28 的 v0.19.0 才复活（从无 v0.18）。复活带来了 TypeScript 迁移、渲染进程沙箱化、Windows ARM64，仓库已改为 monorepo。
- 因此"同架构开源前辈"这个定位成立，且指向的是一个**刚刚证明自己能复活**的项目，而不是一具尸体。MIT，61.5k star，免费。
- 小出入：官网仍标 v0.19.0，GitHub 稳定版已是 v0.19.1。
- **取证方式偏软的地方**：MarkText 大量能力格是从**应用自身的偏好项 schema 与 `packages/desktop/static/locales/en.json` 文案**反推的（属一手来源，但只证明"设置项/字符串存在"，不证明功能质量）。其"自动保存"默认是关的。

### Obs —— Obsidian
`obsidian.md/`（`/pricing`、`/license`、`/changelog/page/5`、`/help/` 及 `edit-and-read`、`plugins`、`syntax`、`advanced-syntax`、`plugins/search`、`plugins/file-recovery`、`plugins/footnotes`、`settings`、`hotkeys`、`data-storage`、`tags`、`tabs`、`attachments`、`mobile`、`sync/version-history`）· `community.obsidian.md/`（插件 7,707 / 主题 761）· `forum.obsidian.md` 帖 28416、45388
注意 `help.obsidian.md` 已 301 跳转到 `obsidian.md/help/`。

### Ztl —— Zettlr
`zettlr.com/`、`/download`、`/changelog` · `docs.zettlr.com/en/` 下 `file-manager/search`、`editor/{appearance,search,footnotes,statusbar,tables,autocomplete}`、`reference/{settings,keyboard-shortcuts,faq}`、`pkms/{zkn-method,graph}`、`scientific-technical/{math,mermaid}`、`export/{workflow,defaults-files,pdf-engine}`、`guides/{presentations,reference-manager-integration}`、`language-style/spellchecking` · `api.github.com/repos/Zettlr/Zettlr`
**状态：活跃。** v4.7.0，2026-07-26，月度小版本。GPL-3.0，免费。
**更正一条流传的错误信息**：聚合站 `noteapps.info` 称 Zettlr 内置 MCP server——已证伪。仓库内 `MCP` 与 `"Model Context Protocol"` 的 issue/PR 搜索均为 `total_count: 0`，4.7.0 release notes 与官方 changelog 亦无任何提及。Zettlr 唯一的写作辅助是 LanguageTool。**不要把这条写进账簿。**

### iAW —— iA Writer
`ia.net/writer`、`/writer/pricing`、`/writer/how-to/quick-tour` · `ia.net/support/` 下 `basics/{features,markdown-guide,shortcuts,settings,faq}`、`library/{navigation,organize,wikilinks,cloud-storage,content-blocks}`、`editor/{stats,authorship,smart-automation}`、`preview/{export-share-print,blog}`、`help/{versions-and-backups,trouble-shooting}`
注：`/support/editor/focus-mode` 返回 HTTP 409，未能抓取；`ulysses.app/features/` 404。买断制（Mac $49.99 / Win $29.99 / iOS $49.99），官网明写不提供订阅。

### Bea —— Bear
`bear.app/` + `/faq/` 下约 25 个条目（`features-and-price-of-bear-pro`、`whats-new-in-bear-2`、`where-are-bears-notes-located`、`export-your-notes`、`command-line-interface`、`how-to-write-math-formulas-in-bear`、`how-to-add-mermaid-diagrams-in-bear`、`how-to-use-footnotes-in-bear`、`backup-restore`、`how-to-use-tables-in-bear` 等）· `blog.bear.app/2026/04/bear-2-8-bearcli-claude-connector-and-mcp-server/`
**对本账簿最关键的一条**：Bear 2.8（2026-04-29）已提供 BearCLI、`Help → Advanced → Install Claude Connector` 一键安装、以及 `bearcli mcp-server`（macOS 限定，不受 Pro 限制）。**mdpro 不能再宣称"唯一带 MCP 的 Markdown 编辑器"。** 另：Bear 的存储是 SQLite 而非 `.md` 文件，官方文档明确劝阻第三方直接访问；查找替换、PDF/docx 导出、同步均被 Pro 订阅门控。

### Uly —— Ulysses
`ulysses.app/`、`/pricing/`、`/release-notes/` · `help.ulysses.app` 下 `faqs`、`keywords`、`the-library/{external-folders,backups}`、`dive-into-editing/{markdown-xl,writing-equations,tables-in-ulysses,images-and-sketches,editor-customization-guide}`、`the-dashboard/dashboard`、`editor/how-can-i-create-internal-links`、`export-publishing/export`
**两条语法假设需要更正**：Ulysses 的高亮语法是 `::mark::` 而**不是** `==highlight==`（本次二次核实确认）；数学用的是 `$$` 标记触发公式编辑器，而非裸 `$…$` 分隔符。它的库是专有格式，External Folders 虽然是真 `.md`，但代价是**没有嵌入图片、没有批注、且不进备份**。

### VMk —— VMark
`github.com/xiaolai/vmark`（浅克隆）：`README.md`、`website/guide/features.md`、`package.json`、`src-tauri/tauri.conf.json`、`server/mcp/src/tools/document.ts`、`src/export/htmlSanitizer.ts`、`src/plugins/`（含 `latex`、`mermaid`、`footnotePopup`、`sourceWikiLinkPopup`、`typewriterMode`、`focusMode`、`sourceContextDetection`）· `gh api repos/xiaolai/vmark`
**状态：极活跃。** v0.9.81（2026-09-20），最后提交 2026-09-21；ISC，免费；约 765 star。macOS / Windows / Linux（`tauri.conf.json` 的 `targets: "all"`）。README 自述是在人类监督下由 AI 开发、只收 issue。
**与 mdpro 同构到必须单独记一笔**：Tauri 2 + React 19 + Zustand + CodeMirror 6，所见即所得面换成了 Tiptap。它的 HTML 导出净化在前端（`htmlSanitizer.ts` 用 DOMParser），不在 Rust。PDF 导出在 Rust 侧（`src-tauri/src/pdf_export/`），它仓库里唯一的 UTF-16 命中就是 PDF 大纲的 UTF-16BE 编码，与文件读写无关。

### MYn —— MiaoYan（妙言）
`github.com/tw93/MiaoYan`（浅克隆）：`README.md` / `README_CN.md`、`Helpers/Diagnostics.swift`、`Helpers/ClipboardManager.swift`、`Helpers/PdfExportController.swift`、`Business/WikilinkIndex.swift`、`Business/NoteVersionManager.swift`、`Business/HtmlManager.swift`、`Controllers/EditorPrefsViewController.swift` · `gh api repos/tw93/MiaoYan`
**状态：活跃。** V4.3.2（2026-09-20）；MIT；GitHub / Homebrew 免费，Mac App Store 付费；约 8.6k star。macOS 12+，另有 iOS 18+ 的独立 SwiftUI 应用 `MiaoYanMobile/`。
**更正一条直觉**：它常被归进「Typora 替代品」，但它**不是**所见即所得。README 明写不做 WYSIWYG，编辑器是分栏源码 + 预览，数学、脚注、Mermaid 都在预览面渲染。同步交给用户自己的网盘文件夹，应用本身不登录任何同步服务，所以云同步给 ○。图床走本地 PicGo / PicList 的 HTTP 端点（`ClipboardManager.swift` 的 `127.0.0.1:36677/upload`）。

### SiY —— 思源笔记 SiYuan
`github.com/siyuan-note/siyuan`：`README.md` / `README_zh_CN.md`、`app/package.json`（Electron 44.4.1）、`kernel/go.mod`、`kernel/mcp/tools/`（50 余个文件，含 `block.go`、`document.go`）、`kernel/conf/editor.go`、`app/src/protyle/util/Options.ts`、`kernel/model/document_stat.go`、`app/src/search/util.ts`、`app/electron/main.js` · `github.com/88250/lute` 的 `parse/footnotes.go` · `gh api repos/siyuan-note/siyuan`
**状态：极活跃。** v3.8.4（2026-09-17），提交至 2026-09-22；AGPL-3.0；核心免费，云同步等功能需付费会员；约 46k star。桌面三平台 + Android / iOS / HarmonyOS + Docker。
**子代理初判被复核推翻最多的一列**：它最初给了脚注 ○、打字机 ○、拼写检查 ○、字数 ○。回到仓库，四格全部是 ●：Lute 有 `parse/footnotes.go`，`typewriterMode` 在 protyle 选项里，`kernel/conf/editor.go` 有拼写检查配置，`kernel/model/document_stat.go` 做字数统计。存储是 `.sy` JSON 而非 `.md`；思源没有源码模式，所以源码表格那一格是 `–`。

### Jop —— Joplin
`github.com/laurent22/joplin`：`README.md`、`readme/apps/{markdown,import_export,note_history,ai_mcp,custom_css,plugins,search}.md`、`readme/faq.md`、`packages/app-desktop/package.json`（Electron 42.3.0）、`packages/app-desktop/services/spellChecker/`、`packages/app-desktop/gui/NoteContentPropertiesDialog.tsx`、`packages/editor/CodeMirror/` · `gh api repos/laurent22/joplin`
**状态：活跃。** v3.7.18（2026-09-11），提交至 2026-09-21；AGPL-3.0；应用免费，Joplin Cloud 分档付费；约 56k star。
**两条更正**：①子代理报「桌面编辑器是 CodeMirror 5」。`package.json` 里确实还挂着 `codemirror 5.65.9`，但 `packages/editor/CodeMirror/` 用的是 `@codemirror/search` 等 CodeMirror 6 包；同一轮复核把拼写检查、字数、查找替换三格从 ◐ 改成 ●。②它有第一方 MCP（`readme/apps/ai_mcp.md`），但 10 个工具**默认全部关闭**，挂在 Web Clipper 的 HTTP 端口上，Claude Desktop 要经 `mcp-remote` 桥接。笔记存在 SQLite 里，官方 FAQ 说同步目录「基本上就是一个数据库」。

---

### 最软的几列 —— 请按这个顺序打折扣

按"本次是否真的读到了一手来源"排序，**从软到硬**：

1. **VMk、MYn、SiY、Jop —— 取证方式与前七列不同，而且是单人抽查。** 读的是仓库源码而不是官网文档：能证明代码在，不能证明用户点得到。每列由一个 Haiku 子代理完成，主会话只复核了存疑格，**复核改动了约 20 格**（SiY 约 10 格、Jop 5 格、VMk 与 MYn 各 2 格）。这个改动率本身就是折扣依据：没被复核的格同样可能有错。各列最软的格：
   - **Jop**：`AI 直写` 的 ○ 没有核实桌面端在 MCP 改笔记后会不会自动刷新打开的编辑器；`多标签页` / `反链` / `Wikilink` 的 ◐ 靠第三方插件或 `[标题](:/id)` 式内部链接；`编辑区数学/脚注` 的 ◐ 指富文本编辑器（TinyMCE）会渲染、Markdown 编辑器只在侧栏预览里渲染。
   - **SiY**：`打印` ◐ 只确认了 `app/electron/main.js` 里有 `webContents.print`；`图片拖拽缩放` ◐ 是按「尺寸存进块属性而非 Markdown」判的，**未在仓库里逐行确认**；`云同步` ● 受付费会员门控（与 Obs 的付费 Sync 给 ● 同一口径）；`演示模式` ○ 属证据缺失。
   - **VMk**：`文件增删重命名` ◐ 只找到标签页重命名，文件树里的删除未核实；`图片拖拽缩放` ○ 是没找到，不是厂商否认。
   - **MYn**：`打印` ◐ 只看到 `NSPrintOperation` 被 PDF 导出内部使用；`全局搜索` ● 依据 `miao search` CLI 与跨笔记检索代码，GUI 的全文范围未逐项核实；`多标签页` ○ 为推断。
2. **iAW 与 Uly —— 并列第二。** 两者的 `外部改动检测` 与 `剪贴板粘贴图片` **本次完全没有一手来源**（我按最接近的行为给了值，但这两格应视为未核实）；iA Writer 的 focus mode 页面返回 409 抓不到，其 Android 版停更只有第三方来源（Thurrott），而 ia.net 上仍挂着过期的 Android 页面。Ulysses 的 `::mark::` 是二次核实才找对页面的——第一次按 `==highlight==` 去找会得出错误结论。
3. **Typ（Typora）—— 闭源带来的软。** `外部改动检测` 仅来自 issue #6578，**官方从未记载**，且 tracker 里对其可靠性有争议；1.14.10 的发布日期只有第三方站点（warp2search.net）有，官方发布页只列版本号不列日期，下载页文件名甚至还停在 1.14.9。
4. **Obs、Ztl、MkT、Bea —— 相对最硬**，但各有一处弱点：Obsidian 的查找替换只有官方论坛的员工帖、PDF 导出只有 changelog（两者都没有帮助页），其 Live Preview 下的数学/脚注行为靠论坛帖（其中一条还是功能请求）；Zettlr 的 `打字机模式` 是从**源码**（`menu.darwin.ts`）确认的而非 v4 文档，且其 `==高亮==` 只确认了语法与导出开关、**未确认编辑器内的视觉渲染**，`编辑区数学排版` 的 ● 也夸大了默认状态（预渲染器需手动开启）；MarkText 见上文（偏好 schema 反推）；Bear 的脚注渲染样式与 math/Mermaid 是否受 Pro 门控，文档未明说。

### 完全来自一般认知、本次没有逐个核实的**行**（不是列）

这四行请单独打折，它们是横跨所有对照组的常识性判断，不是本次抓取的结论：

- **`打印`**（表 1）—— 只有 MarkText 的"PDF + HTML + print"有明确来源。Typ 至 Uly 的其余六列按"桌面应用普遍具备打印"给 ●；新四列是读仓库判的（VMk 的 features 文档写明 ⌘P，Jop 见 `custom_css.md`，SiY 与 MYn 各给 ◐，见上）。mdpro 的 ○ 是仓库核实的。
- **`界面本地化`**（表 1）—— Typ 至 Uly 七列来自一般认知；新四列在仓库里看得到中文界面资源（VMk 的 features 文档列出 10 种语言，MYn 用 `I18n.str()`，SiY 有 `app/appearance/langs/zh-CN.json`，Jop 走 Crowdin）。mdpro 的 ○ 是仓库核实的（零 i18n 基础设施）。
- **`结构化 JSONL 日志`**（表 3）—— 对照组的 ○ 是"没有面向用户的结构化日志"这一常识判断，没有逐个查证。
- **`非 Electron 原生外壳`**（表 3）—— 各产品的技术栈来自公开常识（Typora/MarkText/Obsidian/Zettlr 为 Electron；iA Writer/Bear/Ulysses 为原生 Apple 技术栈；mdpro 为 Tauri + WKWebView），前七列未逐个抓取技术声明。新四列读过清单文件：VMk 为 Tauri 2（`package.json`），MYn 为 Swift 6 + AppKit，SiY 为 Electron 44.4.1（`app/package.json`），Jop 为 Electron 42.3.0（`packages/app-desktop/package.json`）。

`UTF-16 编码检测与往返保真`（表 3）中，只有 mdpro 一格有硬证据（读源码）。新四列的 ○ 来自源码里没搜到（MYn 的文件读写全部是 `.utf8`；VMk 唯一的 UTF-16 命中在 PDF 大纲），属证据缺失；其余各格属推断。


---

## Part 4 — 读这张矩阵

### mdpro 不该追的

**云同步、协作编辑、版本历史。** mdpro 的约束写在 `CLAUDE.md` 的第一行：本地文件，仅此而已。这三样每一样都要求一个服务端、一个账号体系和一份账单，换来的是一个本地编辑器不需要的东西。

**PDF / Word 导出。** 被否决过一次，理由是 headless Chromium 的体积（`specs/001-mdpro-mvp/spec.md`）。导出的 HTML 在浏览器里能打印成 PDF——但**这条退路要求用户离开 mdpro**，因为 app 自己也没有打印入口（Part 1 的「打印」行，Absent）。PDF 是一个做过的决定，打印不是；把两者当成同一件事，就是用一条立场掩护一个从没被评估过的缺口。

**第三方插件市场。** `src/plugins/` 这套架构是**编辑器内部的**，不是对外的扩展点。一旦对外，沙箱、版本兼容和审核就全部变成必须品，而它们没有一个能靠一个人维护。

**块编辑器 / 思源那条路。** mdpro 的文件就是 Markdown 文件，不是一棵块树（思源的代价是 `.sy` JSON，见 Part 3）。这一条不是「还没做」。

**缺席是一个立场，不是一个缺口——前提是它被写下来**，而写下来正是这份账簿的用处。上面每一条在 Part 3 的矩阵里都不占行；它们在这里。

### 需要分清的两类缺席

Part 3 的「人人都有而 mdpro 没有」是**缺口**：对标物几乎都有、mdpro 没有、且没有一个写下来的理由说明为什么不该有。上面这一节是**立场**。把立场混进缺口表里，会让下一个读这张表的人去修一个已经做过决定的东西；反过来把缺口说成立场，则是更贵的那个方向——它让一件没人想过的事看起来像一件想过的事。上面「打印」那一段就是这条线的示范。

### 对外该怎么说 mdpro 独家

**不要再说「mdpro 有 MCP」。** 建账时核到 Bear 2.8 已经有第一方 MCP；2026-09-22 换组后，SiYuan 与 Joplin 也有（Part 3 第三张表的要点 1）。这句话在 2026 年 9 月已经不成立了。

**「写进用户此刻正在打字的那个缓冲区」也不再能单独当卖点。** 建账时这一格没有对手；换入 VMark 后有了——它的 MCP `document.write` 落进它自己持有的标签页缓冲区。Bear、SiYuan、Joplin 仍然对着存储层说话，所以这句话对十一个对照组里的十个仍然成立，但对与 mdpro 同构的那一个不成立。**产品文案在找到相对 VMark 的差异之前，不应再用「独家」这个词**；那个差异要比较两者的 MCP 工具集（mdpro 有 `mcp:table_action` 等表格工具），本次没有做。

顺带一个反向更正：**Zettlr 没有 MCP**，MarkText 也不是死项目（v0.20.0-rc.3，2026-09-15，沉寂四年后又动了）。任何基于这两条旧印象的结论都要重做。

### 第一顺位缺口

> **现在的第一顺位缺口是：WYSIWYG 模式下 `$…$` 和 `[^1]` 是字面文本。**

理由不是「缺的人最多」。按 Part 3 的三桶分，WYSIWYG 数学**整体上落在「有争议」那一桶**——十一个对标物里它并不普遍。选它是因为**桶的划分不看总数，看谁**：在 Typora、MarkText、Zettlr、Bear 这四个**直接对标物**，外加与 mdpro 同构的 VMark——也就是同样主打「所见即所得地写 Markdown」的那条产品线——上，它是 ●。mdpro 的整个卖点是「Typora 的所见即所得体验」，而在 mdpro 的**主要编辑模式**里，`$…$` 和 `[^1]` 是字面文本。

今天它们只在 Rust 渲染面上排版，也就是只在导出时——`src/services/mathRender.ts` 的唯一 import 方是 `src/services/exportService.ts`，Preview 面板在 stage-2 死代码清理里已经删掉了。这是 Phase 1 明确接受的行为（决策 B3），不是缺陷；但**一个被接受的缺席仍然是一个缺席**，而这一个正对着产品的那句话。这就是它排在第一顺位的全部理由：它不是最大的洞，它是唯一一个让产品的自我描述不成立的洞。

**第一顺位只有一条，但最便宜的一条不是它。** 如果要的是「今天就能让矩阵少一个洞」，那是**字数统计**——十一个对标物无一例外都有，mdpro 零代码，且它不碰渲染管线、不碰插件 registry、不碰任何已做过的决定。把它写在这里，是为了不让它在只盯第一顺位的读法里被丢掉。

这是**首次**建账，所以这里还没有被划掉的历史。以后关掉一条，就在它上面加删除线、写上是什么关掉的，保留原地，然后在下面写新的一条——**任何时刻只有一条**。一份给出四色清单的账簿，给不出「下一件事是什么」这一个答案。

### 最有后果的架构发现，但它不是第一顺位

`pluginRegistry.getMilkdownPlugins()` 的调用点是零。registry 只治理 CodeMirror；三个 Milkdown 插件能到编辑器里，只是因为 `src/components/Editor/MilkdownEditor.tsx` 直接 import 了实例本身。后果是**每一个 Milkdown 插件在 `src/plugins/core/pluginConfig.ts` 里的 `enabled` 开关都是装饰品**——`setPluginEnabled("image-paste", false)` 不会关掉图片粘贴——而且 `currentMode` 从不会是 `"milkdown"`，所以没有任何 Milkdown 插件收到过 `init()` 或 `destroy()`。

它排在第一顺位缺口之后，因为它今天不改变任何用户看得见的行为。它排在这里而不是被略过，是因为它让每一条关于 Milkdown 插件的声称都**无法验证**，包括这份账簿里的那些。

---

## 审计 pass

追加，不覆盖。每一段以「这次没有关掉什么」结尾。

### 2026-09-17 —— 首次建账

**范围**：`src/`、`src-tauri/src/`、`tests/`、`docs/plans/`、`docs/adr/`、`specs/` 全量读过一遍，外加十个对标物的公开文档与 release note 逐项核实。产出 Part 1 的 165 行、Part 2 的对照表、Part 3 的三桶矩阵。`pnpm ledger:check` 绿：177 条路径声称全部解析，94 个声明名字全部落进某一行。

**改了什么**：只有这份账簿和 `scripts/ledger/`、`tests/feature-ledger.test.ts`。**一行产品代码都没动**——这是刻意的。查出来的缺陷如实写成 `Stub` / `Partial` / `Absent`，修它们是各自独立的提交，不混进建账这一次。

**这次撞见而值得单拎出来的**：

- **`Stub` 比预想的多，且每一个都有"看起来在工作"的外观。** 另存为有偏好项没有处理器；`get_draft` 注册着、实现着、零调用点；`export_html` 零调用点但**是**一条写下来的决定（ADR-0003）而不是遗留。同样是"没人调用"，第三条不该被清理掉——这个区别只有账簿能保存。
- **Mermaid 是一道守着空房间的门。** 消毒器为它开了整套 SVG 白名单，Rust 侧有一个绿着的 `test_sanitize_preserves_mermaid_svg`，而 `package.json` 里没有 mermaid。**一个绿色测试证明了消毒器的行为，被读成了产品有这个功能。**
- **⌘⇧H 依焦点产生两种语法**，⌃2 下的 ⌘K 走 `window.prompt`（rule 30 §6 明令禁止）。两条都进了 Part 1 的 `Partial` 行并写明限制。
- **一次自我更正。** 建账中途出现过"45 个命令定义、`handlers()` 只注册 44 个"的说法，据此差点写下一条"存在未注册命令"。双向 diff 后交集是满的：那个 44 是数逗号数出来的，`updater::get_app_version` 末尾没有逗号。**错的是计数方法，不是代码**，如实记在这里而不是留下一条虚构的缺口。

**这次没有关掉什么。**

第一顺位缺口（WYSIWYG 数学与脚注）仍然开着。Milkdown registry 空转仍然开着。上面四条里没有一条被修复——它们只是从"没人知道"变成了"写下来了"。本次 pass 唯一交付的东西是**一份可被机器检查的现状描述**，以及一个门禁：从现在起，改变行为的那一次提交要重写它的那一行，否则 `pnpm ledger:check` 不会替你发现，但下一次 pass 会。

同样要写明**这次没有看过什么**：`.github/` 的 CI 配置、`src-tauri/` 的 Rust 依赖树、以及打包产物的实际行为（本次全部结论来自源码与测试，**没有在 `pnpm tauri build` 出的包上逐条手测**）。Part 1 的「怎么确认」那一列是**写给人去执行的步骤**，不是已经执行过的记录。
