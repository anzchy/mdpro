# mdpro 项目健康评估：继续 sequencing 计划，还是从零重写

- 日期：2026-09-18
- HEAD：`e030a2caf73e513147288e02938ea5f7cddb9cbc`（`e030a2c`），分支 `frontend-backend-redesign`
- 用户的问题（原话）：代码越积越多、可能已出现 AI slop，是继续执行
  `docs/plans/20260912-frontend-backend-sequencing-order.md`（下称 **排期文档**），
  还是另起新项目、先定义一套新规范再重写？
- 用户已确认的前提：新规范尚未成文；评估深度为实测门禁，不引用文档数字。
- 决策记录：[ADR-0010](../adr/0010-continue-vs-rewrite.md)（Proposed）。
- 结论先行：**不从零重写。继续，但把「继续」定义为对热点的逐模块绞杀式重写，
  非热点按排期文档走。** 翻转条件见 `## 建议`。

术语：文中 **本次实测** 指本文档记录的命令输出；**文档声明，未复测** 指引用自
排期文档、计划 P（`docs/plans/20260911-plan-ui-redesign.md`）、计划 M
（`docs/plans/20260912-plan-markdown-source-consolidation.md`）或 feature ledger
（`docs/feature-ledger.md`）的数字。每个数字后括号内是来源命令，完整命令在
`## 附录：复现命令`，以 `[A*]` 编号引用。

---

## 实测门禁

### 环境与脏树说明

- HEAD `e030a2c`（`git rev-parse HEAD`）。`git rev-parse HEAD` 与本节所有命令在同一
  工作树上顺序执行，未 stash、未 checkout。
- **脏树**：`git status --porcelain | wc -l` = **51**（本次实测；排期文档当日为 43，
  本评估期间工作树又有变动）。`git stash list` 有 4 条历史 stash，本次未动。
  脏树内容是进行中的表格扫描器工作（`src/utils/tableParser/{scan,lines,commonmark}.ts`、
  `src/plugins/codemirror/textLineSource.ts`、7 个未跟踪的 `tests/table-*.test.ts`、
  未跟踪的 ADR-0007/0008/0009）。**下面所有数字都是在这棵脏树上测的**，尤其
  vitest 的文件数与测试数包含了 7 个未跟踪测试文件。
- 工具链：node v22.22.3、pnpm 10.26.1、cargo 1.92.0（`node -v; pnpm -v; cargo --version`）。
- 时间戳为 UTC；本机时区 +08:00。

### 结果

| # | 命令 | 退出码 | 开始（UTC） | 耗时 | 关键输出 |
|---|---|---|---|---|---|
| G1 | `pnpm build` | **0** | 2026-09-17T22:14:18Z | 3 s | `tsc` 无错；vite 产出 `index-ChEHhkaL.js` 1,758.74 kB（gzip 558.03 kB），vite 警告「chunks larger than 500 kB」 |
| G2 | `pnpm test:run` | **0** | 2026-09-17T22:14:22Z | 13 s | Test Files 101 passed；Tests **1578 passed \| 4 todo**（1582） |
| G3 | `pnpm coverage` | **0** | 2026-09-17T22:14:35Z | 14 s | All files：Stmts 33.83 / Branch 84.95 / Funcs 65.88 / Lines 33.83；阈值未触发失败 |
| G4 | `pnpm ledger:check` | **0** | 2026-09-17T22:14:49Z | 0 s | `166 rows, 180 path claims, 0 findings, 94/94 declared names covered`（tauri-command 45 / http-route 11 / menu-id 17 / plugin-id 10 / store 11） |
| G5 | `cd src-tauri && cargo test` | **0** | 2026-09-17T22:14:20Z | 3 s（增量编译缓存） | lib 263 passed；`heading_identity_parity` 1 passed；`render_golden` 1 passed；`perf_render_corpus` 1 ignored；合计 **265 passed / 0 failed / 1 ignored** |
| G6 | `cd src-tauri && cargo clippy --all-targets` | **0** | 2026-09-17T22:14:24Z | 6 s | `grep -c '^warning'` = **0** |
| G7 | `pnpm typecheck:tests`（补充项） | **0** | 2026-09-17T22:14:49Z | 2 s | 无输出即通过 |

（命令与日志：[A1]；G5 的 3 秒耗时是因为 `target/` 已有缓存，不代表冷编译时间。）

### 与排期文档 D2 行记载的上一次门禁并列

| 指标 | 文档声明（`:368-369`，未复测） | 本次实测 | 差异 |
|---|---|---|---|
| vitest 通过数 | 1419 passed + 4 todo（93 文件） | 1578 passed + 4 todo（101 文件） | +159 用例、+8 文件；其中 7 个文件未跟踪（脏树） |
| cargo test | 263 passed | 263（lib）+ 2 集成 = 265 passed，1 ignored | 一致；文档只记了 lib 数 |
| clippy | 0 warnings | 0 warnings | 一致 |
| 覆盖率 lines / functions / branches / statements | 32.26 / 63.29 / 83.25 / 32.26 | **33.83 / 65.88 / 84.95 / 33.83** | 四项各 +1.6 ～ +2.6；主要来自脏树里 `tableParser/*` 新文件全部 100% |
| 阈值（`vitest.config.ts:28`） | 31 / 61 / 82 / 31 | 同 | 通过 |

判读：**门禁是绿的，而且比上次记录更绿。** 这一节的价值不在于「通过」，而在于两点：
（1）`pnpm build` 与 `test:run` 在本机 16 秒内跑完，**没有任何环境障碍**，但 CI 只在打 tag
时触发（`.github/workflows/ci.yml:1-6`，本次实测），最新 tag `v0.3.0` 在 2026-04-10，
`git rev-list --count v0.3.0..HEAD` = **158**——这 158 个提交没有一个在 CI 上跑过测试；
（2）覆盖率 33.83% lines 是把 `src/**` 全量计入（`all: true`）的口径，阈值 31 是「实测地板
取整」而非目标（`vitest.config.ts:25` 注释），所以它不能被读成质量指标，只能被读成棘轮。

### 背景段里两处需要更正的 observed 事实

- prompt 背景里「`package.json` 的 `devDependencies` 计数为 0」是错的：
  `jq '.devDependencies | length'` = **15**，`dependencies` = 23。coverage provider 可用。
- 背景里 ledger「13 Partial」是错的：本次实测 Partial = **14**（见 `## Ledger 抽样`）。

---

## 架构与模块化

### 超过 300 行的文件（rule 50）

`find src src-tauri/src -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.rs' -o -name '*.css' \) | xargs wc -l | awk '$1>300'` [A2] → **26 个**（TS/TSX 10、Rust 15、CSS 1）。

| 行数 | TS / TSX（10） | 行数 | Rust（15，含内联测试） |
|---|---|---|---|
| 1195 | `src/App.tsx` | 1534 | `services/markdown.rs` |
| 433 | `src/plugins/core/pluginRegistry.ts` | 1417 | `commands/file.rs` |
| 386 | `src/types/preferences.ts` | 1314 | `services/http_server.rs` |
| 368 | `src/stores/tabStore.ts` | 1027 | `commands/logging.rs` |
| 352 | `src/hooks/useMcpEvents.ts` | 724 | `models/preferences.rs` |
| 320 | `.../settings/AboutSettings.tsx` | 655 | `commands/mcp.rs` |
| 316 | `src/hooks/useDocument.ts` | 614 | `commands/image.rs` |
| 315 | `.../Editor/MilkdownEditor.tsx` | 569 | `main.rs` |
| 313 | `src/plugins/milkdown/table/contextMenu.ts` | 563 | `services/preferences.rs` |
| 307 | `.../common/IntegrationsSettings.tsx` | 446 / 407 / 402 / 389 / 354 / 352 | `draft/mod.rs` / `encoding.rs` / `shadow_store.rs` / `bin/mdpro_mcp.rs` / `draft/migration.rs` / `menu.rs` |

CSS：`src/styles/globals.css` **1917** 行。

计划 P 的 `stage-4c-foundation.md:67-69` 写「19 production files exceed it」、App.tsx「1194 lines」
（文档声明，未复测）；今天 App.tsx 1195 行，原始超限文件 26 个。

### `App.tsx` 承担了什么

本次实测（`grep -c` 于 `src/App.tsx` [A3]）：`useEffect` **15**、`useCallback` **25**、`useState` 11、
`useRef` 7、事件订阅 3（`onCloseRequested :382`、`onDragDropEvent :878`、`listen("file:open") :1092`）、
直接 `invoke` 6 处、自定义 hook 10 个、触碰 store 5 个、渲染 11 个组件/模态。
按职责归簇为 10 簇，其中 7 簇按 rule 50 可整簇抽出：

| 簇 | 证据行 | 可抽出为 |
|---|---|---|
| 偏好加载 / 持久化 | `useEffect :231`（40 行 loader）、`:288`、`:295` | `useAppPreferences.ts` |
| 窗口生命周期 | `:170`、`:187`、`:375-448`、`:685`、`:696` | 控制器（WI-4.22 指定形式） |
| 文档打开路由 | `:517`、`:538`、`:554`、`:570`、`:311`、`:1029`、`:1090` | 控制器 |
| 关闭确认 / 数据丢失守卫 | `:911`、`:935`、`closeTargetRef :109/416/915-941` | 控制器 |
| 文件监视 / 外部变更 | `:116`、`:478`、`:607`、`:623` | `useExternalChange.ts` |
| 草稿恢复 | `:456`、`:628`、`:651`、本地接口 `:55-67` | `useDraftRecovery.ts` |
| 拖放（文件 + 图片） | `:711`、`:720`（83 行）、`:803`（65 行）、`:871` | `useFileDrop.ts`（计划 P WI-4.12） |
| 表格命令路由 | `:951`、`:978` | `tableCommandRouter.ts` |
| 保存 / 导出 | `:577`、`:581` | 已半抽出 |
| 主题 / 侧栏 / 大文件护栏 | `:450`、`:161`、`:499`、`:506-515` | 留在 App |

排期文档把 **WI-4.22「文件大小棘轮 + App.tsx 生命周期缝」列为基础链最后一环**（`:206`），
并规定「18 落地后立即重写剩余所有 App 任务的文件集合」（`:217-218`）。**本次实测：WI-4.22 未落地**
——`src/hooks/` 无 `useTauriEvent.ts`、`src/` 无 `controllers/`、`package.json` 无任何 size ratchet
脚本 [A3]。计划 P `stage-4c-foundation.md:87` 点名的已知缺陷「`closeActiveDocument(true)` 关闭的是
确认时的活动文档而非发起确认的那个文档」，今天仍在：`src/App.tsx:926` 与 `:941` 仍调用
`closeActiveDocument(true)`，`closeTargetRef` 只记录来源是 window 还是 document，不记录文档 id。

### 跨 feature import（rule 50「keep features local」）

口径：feature = `src/components/*`、`src/plugins/milkdown/*`、`src/plugins/codemirror/*` 各一个目录；
共享层 = `utils` / `stores` / `services` / `hooks` / `plugins/core` / `types`。`tsconfig.json` 无
`paths`，`vite.config.ts` 无 alias，全部相对路径，解析无歧义 [A4]。

- 相对 import 总数 382（已剥注释；`src/utils/tableParser/index.ts:6` 注释里有一个假路径）。
- **跨 feature 37 条**：feature→feature 27 条，**共享层→feature 10 条**（分层倒置，更严重）。
- feature→feature 里 23 条是 `components/Editor` → `plugins/{codemirror,milkdown}`，这是
  「组件挂插件」的结构性依赖，需人工判断是否算违规。
- **唯一循环**：`common/settings/editorPrefApply.ts:23` ↔ `Editor/extensions/dynamicExtensions.ts`。
- `plugins/milkdown/table/types.ts` 被 4 个不同位置引用（`components/Editor`、`plugins/codemirror`、
  `utils/tableEdits`、`utils/tableMcp`），事实上已是共享契约却放在 feature 目录。
- 需人工判断：`src/components/common` 实为共享 UI（`ConfirmDialog`/`Toast`）；若归入共享层，
  feature→feature 降为 24 条。

### 五套引擎今天的调用方

口径冲突先说明：计划 M `:79-85` 定义的「五套」是 pulldown-cmark(HTML) / pulldown-cmark(TOC) /
marked / remark(Milkdown) / 正则标题解析器；ammonia 与 DOMPurify 被 M `:160` 明确列为
「纵深防御，不是冗余」。下面按 prompt 给的五项核实 [A5]：

| 引擎 | 非测试调用方 | 判定 |
|---|---|---|
| pulldown-cmark `render_markdown`（`markdown.rs:506`） | `commands/export.rs:21/60/126` | 活；但 `preview_html`（`export.rs:125`）与 `exportService.exportHtml`（`:134`）**零调用方却仍注册**（`commands/mod.rs:17,19`） |
| `marked` | `exportService.ts:64-108`（仅 catch 降级分支）、`AboutSettings.tsx:196`（release notes，生产路径） | 一半降级一半生产；**删降级 ≠ 能删依赖**（计划 M `:177`） |
| Milkdown remark | `MilkdownEditor.tsx:178-179` `.use(commonmark).use(gfm)`；自写 `highlightMarkPlugin.ts:71/131` | 活，WYSIWYG 唯一解析器 |
| ammonia | `markdown.rs:363` 封装为 `sanitize_html`，调用方 `export.rs:60/126/160` | 活，导出第二层净化 |
| DOMPurify | `sanitizerPolicy.ts:162`、`MilkdownEditor.tsx:46`（粘贴）、`AboutSettings.tsx:198` | 活，进程内唯一净化 |

**五套全部还在生产路径上**，与排期文档 `:31-32`「M 要收敛的五套引擎全部还在」一致。

### 五份 slug 实现，三活两死（核实排期文档 3.2 行）

`grep -rin slug src src-tauri/src` 在源码里只有 2 处注释命中；实际按函数名定位 5 份 [A5]：

| # | 函数 | 位置 | 判定 | 依据 |
|---|---|---|---|---|
| 1 | `generateUniqueId` | `src/services/tocService.ts:101` | 活 | `tocService:74 → useTOC:73 → App.tsx:136` |
| 2 | `generateHeadingId` | `src/services/exportService.ts:47` | 活（仅 catch 降级分支） | 与 #1 逐字符相同的复制体 |
| 3 | `generateAnchorId` | `src/stores/tocStore.ts:120` | **死** | 全仓含 tests 仅定义行 1 处引用 |
| 4 | `generate_heading_id` | `src-tauri/src/services/markdown.rs:23` | 活 | `render_markdown` 内 |
| 5 | `generate_unique_id` | `src-tauri/src/commands/toc.rs:36` | **死（链条上游断）** | 函数本身被 `toc.rs:106` 调用，但 TS 包装 `getDocumentHeadings` 零调用方，且 TS 传 `document_id`、Rust 收 `content`，参数名不匹配 |

排期文档 `:134`「五份、三活两死」**成立**，五个行号逐个对上。但同一格内「后缀碰撞 `x, x-1, x-1`
五面皆有」**不实**：#3 用占位集合检查，正是免疫的那份，且文档同格上一句自己说它是「唯一防碰撞正确的」。
应为「四个计数器面皆有」。本次不改文档，此处并列记录。

### Rust 大文件：正当地大，还是职责堆叠

方法：`#[cfg(test)]` 块行数用行首锚定 grep + 目视核实模块尾；`file.rs` 的测试块在文件**中部**
（400–1036），尾部又是命令 [A6]。

| 文件 | 总行 | 非测试行 | 测试占比 | `#[tauri::command]` | 判定 |
|---|---|---|---|---|---|
| `commands/file.rs` | 1417 | 780 | 45% | 8 | **正当地大（临界）**：21 个生产 fn 全在「校验→读→编码/行尾→原子写→命令」一条主线；行尾 4 个 fn 可抽 `line_endings.rs` |
| `commands/logging.rs` | 1027 | 125 | 88% | 3 | **正当地大**：生产区只有 4 个 fn，体量全是测试 |
| `services/markdown.rs` | 1534 | 692 | 55% | 0 | **正当地大**：692 行里 218–360 是白名单常量表（parity 测试的权威数据），其余是单向管线 |
| `services/http_server.rs` | 1314 | **1083** | **17.6%** | 0 | **职责堆叠，最严重**：配置/令牌、鉴权+CORS、UTF-8 偏移、6 个文档路由、7 个表格路由、原生对话框、路由装配、自制 `mod hex`——八个互不相干的关注点；测试最薄 |
| `main.rs` | 569 | 569 | **0%** | 0 | **职责堆叠且零测试**：`main()` 一个函数 440 行（130–569）；就绪标志/待处理路径队列/移动缓存三组全局可测纯逻辑无一测试 |

按总行数排会误判（`markdown.rs` 最大但一半是测试）。**按非测试行数排，`http_server.rs` 是最大的
生产代码块，且恰好测试最薄、关注点最杂。**

---

## Ledger 抽样

### 方法（先声明）

- 范围：`docs/feature-ledger.md` Part 1（`:61-294`，以 `## Part` 标题划界）。表格四列
  `| 能力 | 状态 | 在哪 | 怎么确认 |`，状态在第 2 列。
- 母体：状态格恰为 `Shipped` 的行按文件顺序编号，**N = 119**（`awk` [A7]）。
- 样本量 **10**（评审者设定的假设值；后文说明为何 10 足以支撑本文的翻转阈值）。
- 种子 20260918：`python3 -c "import random; r=random.Random(20260918); print(sorted(r.sample(range(119),10)))"`
  → `[6, 19, 39, 45, 55, 77, 79, 111, 112, 117]`。
- 判定：真 / 假 / 无法静态确认。只核「怎么确认」那一格今天是否仍成立，不测功能好坏。
- 全账簿计数（本次实测 [A7]）：Shipped **119** / Partial **14** / Stub 7 / Absent 24 / Unknown 2，合计 166；
  Partial 缺 `限制：` 的行 **0/14**；枚举无越界值。

### 结果

| idx | 能力 | 判定 | 证据 |
|---|---|---|---|
| 6 | Finder 文件关联 | 真 | `tauri.conf.json:42-47` `fileAssociations` md/markdown；路由 `main.rs:84`。LaunchServices 生效需装机验证，机制层面判真 |
| 19 | 保存后清理草稿 | 真 | `useDocument.ts:257` 在 `saveFile`（`:239`）成功后 `invoke("delete_draft")`；另存为 `:192` 同 |
| 39 | 粘贴 HTML 消毒 | 真 | `MilkdownEditor.tsx:45-54` `FORBID_ATTR` 含 `onclick`、`FORBID_TAGS` 含 `script`；`:183` 已挂入编辑器 |
| **45** | 表格右键菜单（源码） | **假** | 账簿写「16 个操作」；`actionDescriptors.ts` `grep -c 'id: "'` = **15**，`types.ts:21-35` 联合类型 15 个成员。同一错误在 `:133`（WYSIWYG 行）重复 |
| 55 | 当前单元格高亮 | 真 | `sourceTableCellHighlight.ts:36`；`Editor.tsx:25,124` 注册；`globals.css:360` 有规则（文件头 `@coordinates-with` 指向的 CSS 文件已陈旧，属 rule 22 注释腐化） |
| 77 | 大纲侧栏 | 真 | 命令注册 `commands/mod.rs:48`；`tocService.ts:36`；`tocStore.ts:51,89`；`useTOC.ts:113-246`；折叠 `TOCSidebar.tsx:35,62` |
| 79 | 底部标签条 | 真 | `App.tsx:1151-1156` 喂 `documents`；`BottomTabs.tsx:52/63/73/81`；`BottomTabs.css:45,96,109` |
| **111** | 按文件记忆窗口几何 | **假** | 写端 `App.tsx:205` 持续写；**读端不存在**：`grep -rn getWindowGeometry src/` 只命中 `windowService.ts:45` 定义行；Rust 内 `get_stored_geometry` 只在 `create_window` 收到 `file_path` 时读，而前端唯一调用 `App.tsx:1014 openNewWindow()` 不传参；Finder 双击路径 `main.rs:84` 硬编码 1200×800。**只写不读，应为 Stub 或 Partial** |
| 112 | 原生 Window 菜单 | 真 | `menu.rs:242-248` minimize/maximize/close_window。附注：`menu.rs:146` File→Close 显式绑 `CmdOrCtrl+W`，与 Window→Close Window 的预定义 ⌘W 撞键；账簿 `:74` 与 `:270` 对 ⌘W 的声称不可能同时为真（不在本次判定内） |
| 117 | 重启前保存守卫 | 真 | `useUpdater.ts:85-124`：未命名脏文档 toast 并 `return false`；有路径逐个保存；调用方 `AboutSettings.tsx:11` |

**真 8 / 假 2 / 无法静态确认 0；可静态判定行中假率 20%。**

判读：10 行的路径声明 100% 可解析，`pnpm ledger:check` 的三道门全绿——而 [111] 的路径、命令名、
注册全部正确，结论仍是错的。**门禁挡得住格式，挡不住定级。** 两条假的性质不同：[45] 是数字口误，
[111] 是把「只写不读的死数据」记成 Shipped，恰是账簿规则里「Stub 不是功能」要挡的情形。
建议把「IPC 命令有无前端调用点」做成 `ledger:check` 的第四道可机检规则——账簿已为 `get_draft`
如实写了 Partial，说明这个判据有人用过，只是没系统化。

样本量为何够：本文的翻转阈值是「假率 > 30%」（见下一节 T1）。10 行抽出 2 假，20% 点估计的
95% 区间（Wilson）约 3.5%–55.8%，不能排除 30%；所以本文**没有**把账簿判为不可信，只判为
「显著但可修」，并把「30 行复抽」写进翻转条件。

---

## AI slop 判据与打分

### 判据清单（先声明，后打分）

打分尺度：每条 **0 = 无 / 1 = 局部 / 2 = 系统性**。「系统性」的操作定义写在每条「阈值」里。
汇总规则（先声明）：**≥ 4 条为 2 → 判「slop 系统性存在」；否则判「slop 集中于局部」。**

同时先声明 `## 建议` 使用的四个翻转阈值：

- **T1 账簿假率**：Shipped 抽样假率 > 30% → 账簿不可信，任何选项前先重建账簿；10%–30% → 显著但可修。
- **T2 修复无测试率**：非合并 fix 提交中无任何测试改动的比例 > 50% → 「重写会丢失的知识」判为重大，
  这是**反对**从零重写的证据（那些知识只在代码里）。
- **T3 源码文本断言占比**：`tests/` 中用 `readFileSync` 读产品源码做正则断言的测试文件占比 > 33% →
  测试网不足以守住绞杀式模块重写，动热点前须先补行为测试。
- **T4 一天 spike**：按新规范重写最差热点，1 个工作日内若现有测试网不能证明等价
  → 该模块改走「重写」而非「绞杀」；若 spike 显示新规范在现栈内不可满足 → 升级为选项 2 讨论。

| # | 判据 | 怎么测 | 阈值（= 2 分） |
|---|---|---|---|
| C1 重复实现 | 同一逻辑多份并存 | slug 函数数、引擎数、死入口数（`## 架构与模块化`） | ≥ 3 份同逻辑并存且含死份 |
| C2 文档与代码失实 | 账簿抽样假率 + 排期文档自记订正数 | `## Ledger 抽样`；`grep -o` 订正词 [A9] | 假率 > 30%，或每 10 行一次订正 |
| C3 测试只测接线不测行为 | wiring 断言比；源码文本断言文件比 | `grep -c toHaveBeenCalled` / `grep -c 'expect('`；`grep -l readFileSync` [A8] | wiring > 30% **或** 源码文本断言文件 > 33% |
| C4 文档 slop | 文档/代码字节比；规则立于代码之前还是之后；重复文档 | `find … wc -c` [A9]；`git log --diff-filter=A` [A10] | 比值 > 1.5 且 ≥ 半数规则立于 70% 提交之后 |
| C5 修复无测试 | fix 提交无 tests/ 改动且 diff 无新增 `#[test]` | [A10] | > 50% |
| C6 文件规模纪律 | 超 300 行文件数 | [A2] | ≥ 20 个且含 > 1000 行的前端文件 |
| C7 半完成迁移 | 已启动未收口的迁移条目数 | 排期文档 / 计划 M / 计划 P 状态词 [A11] | ≥ 10 条 |

### 证据与打分

| # | 证据（本次实测） | 分 |
|---|---|---|
| C1 | slug 5 份（3 活 2 死）；5 套引擎全在生产路径；`preview_html` / `exportService.exportHtml` 零调用方仍注册；`docs/plans/20260402-plan-auto-updater.md` 与 `archive/` 同名文件字节完全相同（79,775 B，两份都是未跟踪） | **2** |
| C2 | 账簿抽样假率 20%（< 30%）；排期文档 422 行含订正词 **32** 次（失实 15 / 修正 7 / 订正 4 / 撤回 3 / 证伪 3）= 每 13 行一次；4 条可辨识的「订正的订正」链（`:43`、`:89`、`:410`、`:415`）；计划 M 756 行 18 次；计划 P 485 行 **0** 次；账簿 568 行 1 次 | **2**（订正密度触阈；假率未触阈） |
| C3 | wiring：`toHaveBeenCalled` 129 / `expect(` 1999 = **6.5%**（干净）；但 **46 / 93 = 49.5%** 跟踪测试文件含 `readFileSync`；抽样 5 个（种子 20260918 → `[6,19,39,77,79]`）中 3 个以源码文本正则为主：`data-loss-logic.test.ts` 26 条断言 19 条是对 `App.tsx` 源码正则（测的是拼写不是行为，且覆盖的正是数据丢失路径）；`milkdown-table-resize-handle.test.ts` 8/8 全是 CSS 文本正则（rule 10 说 CSS-only 不该有单测）；`typora-keymap-table-nav.test.ts` 10/19。`tableInsertStore.test.ts` 与 `highlight-rendering.test.ts` 合规 | **2**（源码文本断言触阈） |
| C4 | 文档 2,347,352 B（docs 76 个 md 1,747,095 + specs 66 个 md 542,198 + rules 34,442 + CLAUDE.md 18,410 + progress.md 5,207）vs 代码 1,191,245 B（src 678,445 + src-tauri/src 512,800）= **1.97×**；行数比 1.27×。规则时间线：CLAUDE.md 第 3 次提交（0.6%）；rule 10 + vitest 同日落地于第 69–73 次提交（13.7%，规则与工具没脱节）；**rule 30–34 + 60 在第 356 次提交（70.5%）一次性补齐**；ADR 制度第 482 次（95.4%）；ledger 第 503 次（99.6%） | **1**（比值触阈；但半数以上规则立于 15% 处，未触第二条件） |
| C5 | 非合并 fix **181**，无任何测试改动 **116（64.1%）**；改了 `src/`/`src-tauri/src/` 仍无测试 93/156（59.6%）；含两个并发修复 `518939a`（TOCTOU）、`e765de2`（锁持有）——rule 60 的 BLOCK 类别 | **2** |
| C6 | 26 个超限文件；`App.tsx` 1195、`globals.css` 1917 | **2** |
| C7 | 14 条未收口迁移（见 `## 热点与迁移`） | **2** |

**6 条为 2、1 条为 1 → 按先声明的规则，判「slop 系统性存在」。**

但要把这个判定读准：**系统性指的是「纪律」层面——测试写成了源码正则、修复不带测试、迁移开了不收——
而不是「代码到处都烂」。** 下一节的热点数据说明烂的地方是集中的。

---

## 热点与迁移

### 热点：提交次数 × 行数

`git log -n 100000 --format= --name-only -- src src-tauri/src | sort | uniq -c`，与当前 `wc -l` 连接 [A10]。
历史触碰过 211 个路径，现存 ts/tsx/css/rs 196 个。重命名只有 3 次，`--follow` 对排名无影响（±1）。

| # | 文件 | 提交 | 行 | 提交×行 | 非测试行 | 本文的判定 |
|---|---|---|---|---|---|---|
| 1 | `src/styles/globals.css` | 35 | 1917 | 67,095 | 1917 | **重做**：计划 P Stage 0 已规划 tokens/sections 拆分；CSS 无测试网，重做成本最低 |
| 2 | `src/App.tsx` | 43 | 1195 | 51,385 | 1195 | **绞杀**：按 WI-4.22 抽控制器；`data-loss-logic.test.ts` 那 19 条源码正则要先换成行为测试 |
| 3 | `src-tauri/src/commands/file.rs` | 22 | 1417 | 31,174 | 780 | **继续**：一条主线、45% 测试；只抽 `line_endings.rs` |
| 4 | `src-tauri/src/services/http_server.rs` | 21 | 1314 | 27,594 | 1083 | **绞杀（首选 spike 对象）**：8 个关注点、17.6% 测试；鉴权/偏移/hex 三块是纯函数，可先补测试再拆 |
| 5 | `src-tauri/src/services/markdown.rs` | 15 | 1534 | 23,010 | 692 | **继续**：管线 + 常量表 + 55% 测试；常量表是 parity 测试的权威数据，动它要连测试一起动 |
| 6 | `src-tauri/src/main.rs` | 22 | 569 | 12,518 | 569 | **绞杀**：440 行 `main()`、0 测试；三组全局状态先抽出并补测试 |
| 7 | `src-tauri/src/commands/mcp.rs` | 17 | 655 | 11,135 | 需人工判断 | **继续**：写 4 个外部客户端配置文件是对外副作用，重写最容易漏 |
| 8 | `src-tauri/src/models/preferences.rs` | 14 | 724 | 10,136 | 需人工判断 | **继续**：磁盘契约，动它就是动 `~/.mdpro/config.json` 格式 |
| 9 | `src/components/Editor/MilkdownEditor.tsx` | 27 | 315 | 8,505 | 315 | **继续，但先补往返测试**：`markdownUpdated`（`:231`）写回路径零测试覆盖 |
| 10 | `src-tauri/src/services/preferences.rs` | 13 | 563 | 7,319 | 需人工判断 | **继续**：原子写 + 0600 是数据契约 |

按提交次数排的 Top 10 与上表重合 8 个，另有 `Editor.tsx`（17）与 `types/preferences.ts`（15）。

**热点结论**：10 个热点里 4 个要绞杀式重写（App.tsx、http_server.rs、main.rs、globals.css 重做），
6 个继续。**非热点 186 个文件：继续。** 它们的提交次数中位数低、体量小，`tableParser/*` 这类
新模块覆盖率 100%——slop 没有均匀分布在仓库里。

### 修复里沉淀的知识

`git log -n 100000 --no-merges --format='%H%x09%s' | grep -P '^\S+\t(fix|Fix)'` [A10]：

| 指标 | 数 |
|---|---|
| 非合并 fix 提交 | 181（全部提交 505 = 413 非合并 + 92 合并；fix 占非合并 43.8%） |
| 触及 `src/` 或 `src-tauri/src/` | 156 |
| 触及 `tests/` | 46 |
| diff 新增 `#[test]` | 20 |
| **无任何测试改动** | **116（64.1%）** |
| 改了生产代码且无测试 | 93（占 156 的 59.6%） |

按月：2026-04 一个月 209 次提交、97 次 fix（占全部 fix 的 54%），是 v0.2.5/v0.2.6/v0.3.0 三连发布月；
7–8 月零提交；9 月 75 次提交但 fix 只有 5 次，结构转向 docs/治理。

这 116 个修复所承载的知识**只存在于代码里**：重写它们会被丢掉，继续它们会被保留但没人守着。
这个数字同时进入选项 2 的「丢失什么」和选项 1 的「最大风险」。

### 天花板在栈上还是在代码上（D6）

排期文档 D6 表（`:327-332`，文档声明）把问题拆成 (A) 472 KB WYSIWYG 档：
`micromark-extension-gfm-table@2.1.1` 的 `edit-map.js` O(cells²)，修法升级到 2.1.2；
(B) 9.96 MB Source 档：项目代码 `lintTableColumnCount.ts → cursorSync/table.ts → tableParser/parse.ts`
的 O(行×(字符+行))，修法改自己的代码。本次实测 [A5]：

- **(A) 已修**：`package.json:49` `pnpm.overrides` 钉 `>=2.1.2`，`pnpm-lock.yaml` 两处 2.1.2，
  提交 `d038585`，ADR-0006 Accepted 2026-09-17。
- **(B) 在飞行中**：脏树里 `tableParser/`、`cursorSync/table.ts`、`lintTableColumnCount.ts` 均为 modified，
  对应 `docs/plans/20260917-plan-table-over-detection-vs-gfm.md` 与 ADR-0007/0008/0009。
- **D6 本身未修**：`src/App.tsx:512` 仍是 `if (bytes <= 500 * 1024) return;`，判据变量仍是字节而非单元格数。
- **无任何虚拟化**：`grep -rni "virtual|windowing|IntersectionObserver|lazy" src/components/Editor src/plugins/milkdown`
  命中 6 行，全是 `prosemirror-tables` 的 `TableView` nodeView（列宽），与视口裁剪无关；
  `MilkdownEditor.tsx:114-116 → :174 → :178-188` 一次性把整篇内容解析并挂进 ProseMirror DOM。
  全仓唯一 `IntersectionObserver` 在 `useTOC.ts:62,179`，是 scroll-spy。

**回答「天花板在哪」**：(A) 和 (B) 两个已知真因都**不在**「ProseMirror 全量挂 DOM」这个设计上，
一个在依赖（已修）、一个在项目代码（在修）。但「整篇一次性挂 DOM、无虚拟化」是 Milkdown/ProseMirror
栈的固有形态——**同栈重写不会改变它**。所以：

- 选项 2「从零重写」**若仍用 Milkdown，在 D6 这个维度上得不到任何收益**；
- 要不要换内核，是一个本评估**无法用静态证据回答**的问题——D6 的实测数据（56 s、45,744 单元格）
  证明的是「阈值判据选错」，不是「ProseMirror 不可用」；
- 本文对选项 2 的定义**不含换内核**（见 `## 选项比较`），并把「是否换内核」列为需要实测才能开的
  独立问题：先把 D6 的判据改成单元格数、超阈降级到源码模式，测完再问。

### 半完成迁移清单

状态词来自排期文档图例（`:16`）；计划 M、P 没有自己的状态图例（M 用证据分级，P 用英文 + `- [ ]`）[A11]。
计划 P 的 53 个验收复选框 **0 个勾选**（`grep -c '^- \[x\]'` = 0）。

| # | 迁移 | 状态 | 证据 |
|---|---|---|---|
| 1 | 五引擎收敛（导出迁移 + 旧解析器退役） | ⬜ 未开始 | 排期 `:28`、`:31-32`；计划 M `:79-85` |
| 2 | 计划 P 主体（Stage 0→5） | ⬜ 实现为零 | 排期 `:31-32`（点名 5 个文件均不在 HEAD）；计划 P `:6` `Status: DRAFT` |
| 3 | 五份 slug 只改三活面 | 🔄 部分 | 计划 M `:110-118`、`:411-413`；排期 `:134` |
| 4 | Preview 已删、`marked` 降级仍活 | 🔄 半截 | Preview ✅（M `:132-135`）；降级 ⬜（排期 `:100`、`:237`；M `:409`、`:737`）；约束 M `:177` |
| 5 | `toc.rs` / `preview_html` 退役 | ⬜ 做法未决 | M `:326-328`「删除 vs 先标 deprecated 至今全无结论」 |
| 6 | Q15 / Q16 | Open — no proposal | 计划 P `:143-144`、`:435-436`；排期 `:164`。交叉矛盾：Q16 引用的 E39 预算在 M `:567` 被判「提案，从未采纳」 |
| 7 | WI-0.0 chore PR（CI 触发器 + 分支保护） | 🔄；1.1/1.2 ⏭️ | 排期 `:42`、`:50-51` |
| 8 | ESLint 接入（WI-4.21 硬前置） | ⏭️ 未开始 | 排期 `:29`、`:59`；M `:259`；本次实测无 eslint 配置 [A2] |
| 9 | M Part 6 P2 安全收紧（asset scope `**/*`、CSP `unsafe-eval`） | 无完成标记 | M `:265-268`；`tauri.conf.json:28-32` 现值未变 |
| 10 | D1 / D5 / D7 / D8 | 未修复 ×4 | 排期 `:286-291`；D5 CSP 无 `connect-src`（`tauri.conf.json:28` 本次核实）；D8 `bin/mdpro_mcp.rs:9` 注释与 `:36-40` 代码仍指向两个目录 |
| 11 | D6 + 9.96 MB 楔子 | 豁免入口，缺陷开放 | 上一小节 |
| 12 | Stage 5 准入 E6 `config.json` 覆写修复 | 未修 | 排期 `:224` |
| 13 | 3.8 大文档性能出口复测 | 豁免不覆盖 | 排期 `:140` |
| 14 | ADR-0003 落地（`sanitizeRenderedHtml` → `sanitizeExportFragment`、`SANITIZE_DOM:false`） | 未落地 | `sanitizerPolicy.ts:161` 仍旧名；`sanitizeExportFragment` 在 `src/`、`tests/` 零命中（唯一提及在夹具 json `:227`） |

另有：`activeDocumentId` 竞态「单独记录待办」无归属（M `:612`）。

继续 = 串行收口 14 条；重写 = 一次性宣布全部完成——但第 4、5、8、9、10、14 条在重写里
**并不自动消失**（`marked` 依赖、CSP、ESLint、ADR-0003 都是新代码同样要做的决定），
真正靠重写「归零」的只有 1、2、3、6、7、11、12、13。

---

## 选项比较

工作量单位：排期文档的 WI 粒度（一个 WI ≈ 一个可独立验证的 PR）。人日估算是评审者的假设，
标 *（估）*，不是实测。

### 选项 1：继续——按排期文档走完阶段 3 → 5

- **工作量**：阶段 3 余项（3.2 slug、3.8 出口复测、D 系列）约 6 WI；阶段 4 = 计划 P 主体，
  53 个验收项、WI-4.x 至少 22 个；阶段 5 约 5 WI。合计 **≥ 33 WI**（文档声明的条目数，本次点算）。
- **丢失什么**：不丢代码，也不丢 slop——App.tsx 会继续按 WI-4.22 之前的行号被 9 个后续任务改，
  排期 `:217` 已预见这一点。
- **保留什么**：全部 505 个提交、116 个无测试修复、1578 + 265 个测试、8 个 ADR、166 行账簿、
  磁盘契约、4 个外部客户端配置写入点。
- **最大风险**：三条叠加——(i) CI 零覆盖 158 个提交，门禁只在本机跑；(ii) 计划 M 阶段 5
  「已保存数据的损失无法靠代码回滚恢复」（M `:224`）而它点名的唯一防线「往返测试」（M `:231`）
  **不存在**（`grep -rn 'serializerCtx|getMarkdown|toMarkdown' tests/` = 0 [A5]）；(iii) 49.5% 的
  测试文件在读源码文本，热点重构时这些测试会大面积误红，或更糟——保持绿但没守住行为。

### 选项 2：从零重写——先定义新规范再重建

本文对「重写」的定义：**新仓库或新根目录，同栈（Tauri 2 + React + Milkdown + CodeMirror），
不换编辑器内核**。换内核是另一个决定，需要先有 D6 判据修正后的实测数据（见 `## 热点与迁移`）。

- **工作量**：无法用 WI 计，因为新规范尚未成文。下限参照：现有生产代码 35,684 行（[A9]），
  119 个 Shipped 里若保留 ~80 个（见裁剪清单），按原仓库 4 月峰值节奏（209 提交/月）*（估）*
  也是数月量级，且期间 158 个未发布提交继续积压。
- **丢失什么**：
  - **116 个没有回归测试的修复**（93 个改了生产代码）。它们只在代码里，重写时不会被任何测试提醒。
    其中两个是并发修复（`518939a` TOCTOU、`e765de2` 锁持有）。
  - **1578 个 vitest 用例中约一半**：46 个文件读源码文本，源码换了它们全部作废；`milkdown-*` 测试
    通过 `vi.mock` 替换整个 kit，对新代码没有约束力。
  - **267 个 Rust 内联测试**中与 `file.rs`/`logging.rs`/`markdown.rs` 结构绑定的部分。
  - (a) **数据契约**（本次实测 [A12]）：5 个落盘位置，**零版本字段**，**两个配置根**
    （`~/.mdpro/{config.json,mdpro.log}` 与 `{data_dir}/mdpro/{drafts/,server.port,server.token}`）；
    草稿有两种格式（two-file legacy 与 bundle）**靠文件名后缀判别**，格式迁移只在 `load_draft` 懒触发，
    `list_drafts`/`recover_draft` 不迁移，`cleanup_old_drafts` 永远不回收 legacy；
    two-file → bundle 的格式迁移**没有专门测试**；MCP 安装器会写 4 个外部文件
    （Claude Desktop / `~/.claude/settings.json` / `~/.codex/config.toml` / gemini）。
    **往返保真**：不存在 source→WYSIWYG→source 测试；`c17c003` 语料（25 case × 5 face）
    **只覆盖 slug 与 TOC 偏移，不含 HTML 输出**，且 18/25 个 case 带 `currentlyFailsOn`——
    它同时钉住了正确答案和今天的错误答案，**重写后直接产出正确答案会反向失败**，搬运时须清掉
    `currentlyFailsOn`/`currentlyProduces`。仓库里**不存在**「给一段 Markdown、期望一整段 HTML」的 golden 语料。
- **保留什么**：
  - (b) **安全决策**：`linkSafety.ts` 三个函数是纯函数（唯一 import 是 `ALLOWED_URI_SCHEMES`），
    **可整体搬走**，前提是把该常量提到无依赖模块（`sanitizerPolicy.ts` 在模块加载期注册 DOMPurify
    全局 hook，会传递性拉起 DOM）；Rust `MATH_TAGS`/`SVG_TAGS`/`SVG_ATTRS`（`markdown.rs:251/284/310`）
    与 JS `BASE_TAGS`/`MATH_ATTRS`/`ALLOWED_URI_SCHEMES` 都是**数据表**，可搬；
    `tests/sanitizer-rust-js-parity.test.ts` 用正则解析 Rust 源码比对四组集合，只要新代码保持
    `pub const` 形式就**一行不改能用**；MCP 令牌 `constant_time_eq`（`http_server.rs:136-147`）
    与 `validate_origin` 是纯函数可搬（目前无独立单测）。ADR-0001/0002/0003 的决定与失败条件
    （opener 插件升级、`<form>` 进 allowlist）全部可移植。**不可搬**：`sanitizerPolicy.ts` 的 hook、
    `useMilkdownLinkClickGuard.ts`、`milkdown-link-click-guard.test.ts`。
  - 8 个 ADR、账簿（修正 2 行后）、CLAUDE.md 与 rules 中「已立」的部分。
- (c) **范围裁剪——119 个 Shipped「重写时还会再建吗」**（按账簿 12 个小节，逐节给保留/放弃）：

| 小节 | Shipped 数 | 保留 | 放弃 / 降级 |
|---|---|---|---|
| 文件与文档管理 | 22 | 新建/打开/保存/关闭/编码检测与保留/原子写入/外部变更监听与重载/未保存确认/草稿自动保存与恢复/保存后清理 | **最近打开**（菜单同步是 `invoke` 直连 App）、**大文件提示横幅**（应并入 D6 修正后的统一降级）、**陈旧草稿清理**（先修 legacy 不回收） |
| 编辑 / WYSIWYG | 24 | 基本编辑、标题、行内代码、删除线、链接消毒、粘贴消毒、链接点击守卫、撤销重做、图片粘贴/拖放/宽度写回 | **上传进度占位**、**批量多图粘贴**（先做单图）、**`==text==` 往返**（无测试、只有注释声称）、**图片缩放菜单**（先靠宽度写回） |
| 表格 | 18 | 插入对话框、右键菜单（合并两套为一套 15 操作）、行列增删移、对齐、Tab/Esc 导航、IME 安全、列数校验、单元格高亮 | **列宽拖拽**（CSS-only 且测试是 CSS 正则）、**宽表格滚动**、**跨模式单元格光标同步**（复杂度高、D6 (B) 真因所在链）、**MCP 驱动的表格编辑**（7 个 HTTP 表格路由是 http_server.rs 职责堆叠的一半） |
| 源码模式 | 11 | 源码编辑、查找替换、标题级别、语法标记隐藏、行注释、缩进、自动配对、大文档保护 | **代码块主题**（并入主题）、**自动换行与缩进宽度**（默认值即可） |
| 导出 | 6 | 导出 HTML、导出消毒、GFM、自动链接/emoji | **默认导出目录**、**内嵌样式开关**（先固定一种） |
| 导航与界面 | 7 | 大纲侧栏、切换侧栏、底部标签条、视图模式切换、加载指示 | **模式徽标**、**窗口拖拽区**（Tauri 配置项而非功能） |
| 主题与排版 | 6 | 浅/深/跟随系统 | **编辑器字体/字号/行高/内容宽度**四项合并为一个「排版」设置 |
| MCP 集成 | 8 | 服务开关、四个 MCP 工具、影子存储同步、令牌与来源校验、写入确认 | **自动批准 AI 编辑**（安全面）、**客户端配置安装器**（写 4 个外部文件，改为「复制配置」）、**连接测试与端口复制** |
| 日志与诊断 | 4 | 结构化 JSONL、日志开关、级别 | **DevTools**（构建 flag） |
| 偏好设置 | 5 | 设置对话框、默认视图模式、自动保存间隔、偏好原子写入 | **图片目录与外链复制** |
| 窗口与标签页 | 5 | 新建窗口、多窗口文档、全局窗口状态持久化、原生 Window 菜单 | **按文件记忆窗口几何**（本次证明只写不读） |
| 平台集成 | 5 | 原生菜单栏、应用菜单基础项、版本号 | **应用内更新检查 / 重启更新 / 重启前保存守卫**——若「无外部用户」成立则整条 updater 链放弃；成立与否见 `## 建议` 的显式假设 |

粗算保留约 **80–85** 个、放弃或降级约 **34–39** 个。把 119 个全部重建的重写是最差选项。

- **最大风险**：**同栈重写不改变 D6 的栈固有形态**；116 个修复的知识丢失；磁盘契约无版本字段意味着
  新代码必须读懂旧文件而没有格式测试可依；期间 158 个提交继续不发布；且新规范尚未成文——
  在规范落地前动手，就是再产一次同样的 slop。

#### 新规范应包含什么（用户已确认尚未成文）

分两类。**「已立但未执行」**是现有规则里写了但没有机制强制的；**「缺失」**是根本没写的。
两类都是**重写前必须先补的项**——否则重写只是换个目录继续。

| 类别 | 项 | 现状证据 | 新规范要求 |
|---|---|---|---|
| 已立未执行 | 300 行上限（rule 50 §6） | 26 个超限文件；无 ratchet 脚本 | 可执行 ratchet：`scripts/size-ratchet.mjs` 记录每文件上限，只降不升，进 `pnpm test:run` 前置 |
| 已立未执行 | Bug 修复必须带回归测试（rule 10） | 64.1% fix 无测试 | commit-msg / PR 检查：subject 以 `fix` 开头的提交必须触及 `tests/` 或新增 `#[test]`，否则 CI 拒绝 |
| 已立未执行 | 「测试行为不测渲染 / 不测 DOM」（rule 10） | 46/93 文件读源码文本 | **禁止在 `tests/` 里 `readFileSync` 读 `src/`**（允许读 fixtures）；vitest setup 里 mock `fs.readFileSync` 对 `src/` 路径抛错 |
| 已立未执行 | 「同提交更新状态列」（CLAUDE.md） | 账簿 20% 假率；排期文档每 13 行一次订正 | 账簿加第四道机检：每个 `#[tauri::command]` 与每个 `services/*.ts` 导出函数必须有 ≥ 1 个非测试调用点，否则状态不得为 Shipped |
| 已立未执行 | CI 门禁 | 只在 tag 触发；158 个提交零 CI | push 与 PR 触发 `pnpm test:run` + `cargo test`（可用 `paths-ignore: docs/**` 控成本） |
| 已立未执行 | ADR 落地 | ADR-0003 Accepted 三天后仍未实现 | Accepted 的 ADR 必须有一个 WI 编号与落地提交 SHA，否则状态只能是 Proposed |
| 缺失 | ESLint / 架构边界检查 | 无 `eslint.config.*`；37 条跨 feature import、1 条循环 | `eslint-plugin-import` 的 `no-restricted-paths`（feature 目录互不 import，共享层不得 import feature）+ `import/no-cycle` |
| 缺失 | 磁盘格式版本 | 5 个落盘位置零版本字段 | 所有落盘 JSON 必含 `schemaVersion`；迁移函数必有「旧文件 → 新文件」的 fixture 测试 |
| 缺失 | 往返保真 golden 语料 | 不存在 Markdown → HTML 整段 golden，不存在 source→WYSIWYG→source 测试 | 建 `tests/golden/*.md` + `.html` + 往返断言；语料从 `heading-identity.json` 与 `phase1.json` 起步但**去掉 `currentlyFailsOn`** |
| 缺失 | 大文档降级判据 | `App.tsx:512` 按字节 | 按单元格数 / 节点数判据，超阈强制源码模式；预算数字来自实测而非提案（E39 教训） |
| 缺失 | 发布节奏 | 5 个月未发 tag | 每 N 个 feat 或每月至少一个 tag；release.yml 的「只保留最近 2 个 release 并删 tag」步骤须评估后决定去留 |
| 缺失 | 文档体量纪律 | 文档/代码 1.97×；同名计划两份 | 计划文档归档即删原件；「订正」只允许写在状态列，不允许在正文层层叠加 |

### 选项 3：原地绞杀（strangler）——评审者建议的假设选项

保留仓库、505 个提交、ADR、账簿，**只对热点逐个重写**，用现有测试网守住，非热点走排期文档。

- **与选项 1 的本质区别**：选项 1 把 App.tsx 当作被 9 个后续 WI 继续修改的对象（排期 `:217`
  已承认这会重写文件集合）；选项 3 把 App.tsx / http_server.rs / main.rs 当作**先重写再继续**的对象，
  并且**在重写前先把「新规范」里「已立未执行」的 6 项做成机制**——否则绞杀出来的新模块会以同样速度腐化。
  换句话说：选项 3 = 选项 1 + 新规范先行 + 热点顺序颠倒。
- **工作量**：新规范机制 6 项约 6 WI *（估）*；三个热点绞杀各 2–4 WI *（估）*；然后接排期文档 ≥ 33 WI。
  比选项 1 多约 15 WI，但后续每个 WI 都在机制保护下进行。
- **丢失什么**：热点重写时，对应的源码文本测试作废（`data-loss-logic.test.ts` 等），必须先换成行为测试；
  这是绞杀的真实成本，T3 阈值就是为它设的。
- **保留什么**：其余一切，包括 116 个修复的知识（因为非热点不动）。
- **最大风险**：热点重写在没有往返测试和行为测试的情况下开始——所以顺序必须是「先补网，再绞杀」，
  且用 T4 的一天 spike 验证网够不够。

---

## 建议

**选项 3：原地绞杀。不从零重写。** 具体顺序：

1. **先做新规范里「已立未执行」的 6 项机制**（CI push 触发、fix 必带测试、禁读源码文本、
   size ratchet、账簿第四道机检、ADR 落地追踪）——这一步不改产品代码，只改门禁。
2. **修正本次实测发现的两处账簿失实**（[45] 16→15，含 `:133` 孪生行；[111] Shipped → Partial/Stub）
   与排期文档 `:134` 的「五面皆有」→「四面皆有」。
3. **一天 spike（T4）**：对 `http_server.rs` 做绞杀——先给 `constant_time_eq`、`validate_origin`、
   `char_offset_to_byte`、`mod hex` 补纯函数测试，再把 8 个关注点拆成 4 个模块。选它而不选 App.tsx，
   因为它是非测试行最多、测试最薄、且不依赖往返测试的热点，spike 结果最干净。
4. 补往返测试网（golden 语料 + source→WYSIWYG→source），然后绞杀 App.tsx（WI-4.22 的控制器形式）。
5. 接排期文档阶段 3 余项 → 4 → 5，非热点不动。

### 显式假设：是否有外部用户

本仓库无法静态判定（无遥测、无下载统计；`README.md` 无面向终端用户的安装章节；
自动更新计划 `:55-58` 写「公开发布应以公证完成为前置」；updater 端点已配置且 `pubkey` 存在）。
两种情形下的结论：

- **有外部用户**：选项 2 被排除——updater 端点 `latest.json`、`config.json`、草稿两种格式、
  `server.token` 都必须兼容，而这些契约零版本字段。选项 3 不变。
- **无外部用户**：选项 2 的数据契约成本显著下降，但**结论不变**——反对它的主证据是 116 个无测试修复的
  知识丢失（T2 触阈）与同栈重写在 D6 上零收益，这两条与用户数无关。此情形下裁剪清单里
  整条 updater 链可放弃。

### 翻转条件（可实测）

| 条件 | 测法 | 触发后 |
|---|---|---|
| **F1** 账簿 30 行复抽假率 > 30%（T1） | 同种子扩到 `r.sample(range(119),30)`，同判定法 | 先重建账簿，再谈任何选项；账簿不可信时选项 3 的「非热点继续」失去依据 |
| **F2** spike 失败（T4） | 1 个工作日内 `http_server.rs` 拆分后 `cargo test` + `pnpm test:run` 不能全绿，或必须改动 > 3 个现有测试文件才能绿 | 该模块改为「重写」（新文件替换，旧文件删除），但仍不升级为整仓重写 |
| **F3** 新规范在现栈内不可满足 | spike 或往返测试暴露必须换编辑器内核（例如往返丢失结构且 Milkdown schema 无法表达） | 升级为选项 2 讨论，且选项 2 的定义改为「换内核」——届时需要新 ADR |
| **F4** 往返测试暴露数据损失 | golden 语料跑 source→WYSIWYG→source，任一 case 丢文字或结构 | 计划 M 阶段 5 与所有 WYSIWYG 热点冻结，先修保真；这不是翻转到选项 2 的条件，而是「继续」的前置 |
| **F5** 机制落地后 fix 无测试率 30 天内仍 > 30%（T2 的追踪版） | `git log --since=<机制落地日>` 重跑 [A10] | 说明纪律问题在流程而非代码，重写不解决它；此时应停下审视开发流程而非仓库 |

若 F1 与 F2 同时触发，本建议改为**条件建议**：先重建账簿并补测试网，两者收口后重跑本评估的
`## Ledger 抽样` 与 `## 热点与迁移` 两节再决定。

---

## 附录：复现命令

所有命令在仓库根目录、HEAD `e030a2c`、脏树（51 条 porcelain）上执行。
⚠️ 本机曾观察到裸 `git log` 在某些 shell 环境下被静默截断为 50 条并丢弃合并提交
（子代理环境复现，主 shell 未复现）；所有历史统计务必加 `-n 100000`，并用
`git rev-list --count HEAD`（= 505）交叉核对。

**[A1] 门禁**（日志留存于会话 scratchpad，未入库）
```bash
pnpm build; pnpm test:run; pnpm coverage; pnpm ledger:check; pnpm typecheck:tests
cd src-tauri && cargo test && cargo clippy --all-targets
grep -E '^test result' <cargo-test.log> | awk '{p+=$4; f+=$6; i+=$8} END {print p, f, i}'
grep -E '^All files' <coverage.log>          # 列序：Stmts | Branch | Funcs | Lines
git rev-parse HEAD; git status --porcelain | wc -l; git stash list
```

**[A2] 文件规模与 lint**
```bash
find src src-tauri/src -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.rs' -o -name '*.css' \) \
  | xargs wc -l | awk '$1>300 && $2!="total"' | sort -rn
ls eslint.config.* .eslintrc* 2>/dev/null; jq '.devDependencies | length' package.json
```

**[A3] App.tsx**
```bash
grep -c 'useEffect(' src/App.tsx; grep -c 'useCallback' src/App.tsx
grep -n 'listen<\|listen(\|onCloseRequested\|onDragDropEvent' src/App.tsx
grep -n 'closeActiveDocument(true)\|closeTargetRef' src/App.tsx
ls src/hooks/useTauriEvent.ts src/controllers 2>&1; jq '.scripts' package.json
grep -n 'WI-4.22' docs/plans/20260912-frontend-backend-sequencing-order.md docs/plans/20260911-ui-redesign/stage-4c-foundation.md
```

**[A4] 跨 feature import**：对 `src/**/*.{ts,tsx}` 提取 `from '…'` 相对路径（先剥 `//` 与 `/* */` 注释），
按 `src/components/<X>`、`src/plugins/milkdown/<X>`、`src/plugins/codemirror/<X>` 归 feature，
其余归共享层；统计 from-feature ≠ to-feature 的边。`grep -n 'paths\|baseUrl' tsconfig.json; grep -n alias vite.config.ts`。

**[A5] 引擎、slug、D6、往返**
```bash
grep -n 'render_markdown' src-tauri/src -r; grep -rn "marked" src/; grep -rni dompurify src/; grep -rn 'ammonia' src-tauri/src
grep -rn "previewHtml\|exportService.exportHtml" src/ tests/
grep -rnE 'generateUniqueId|generateHeadingId|generateAnchorId|generate_heading_id|generate_unique_id' src src-tauri/src tests
grep -n 'micromark-extension-gfm-table' package.json pnpm-lock.yaml; git log -n 100000 --oneline -S micromark-extension-gfm-table -- package.json
sed -n '512p' src/App.tsx
grep -rni "virtual\|windowing\|IntersectionObserver\|lazy\|nodeView" src/components/Editor/MilkdownEditor.tsx src/plugins/milkdown/
grep -rn "serializerCtx\|getMarkdown\|toMarkdown" tests/ | wc -l
grep -rn sanitizeExportFragment src tests
```

**[A6] Rust 大文件**
```bash
for f in src-tauri/src/commands/file.rs src-tauri/src/commands/logging.rs src-tauri/src/services/markdown.rs src-tauri/src/services/http_server.rs src-tauri/src/main.rs; do
  echo "$f $(wc -l < $f) fn=$(grep -cE '^[[:space:]]*(pub(\([a-z]+\))? )?(async )?fn ' $f) cmd=$(grep -cE '^[[:space:]]*#\[tauri::command\]' $f) test=$(grep -cE '^[[:space:]]*#\[(tokio::)?test\]' $f) cfg=$(grep -nE '^#\[cfg\(test\)\]' $f)"
done
```

**[A7] Ledger**
```bash
grep -n '^#' docs/feature-ledger.md
awk 'NR>=61 && NR<295 && /^\|[^|]*\| Shipped \|/ {print NR": "$0}' docs/feature-ledger.md | cat -n
python3 -c "import random; r=random.Random(20260918); print(sorted(r.sample(range(119),10)))"
for s in Shipped Partial Stub Absent Unknown; do echo "$s $(grep -cE "^\|[^|]*\| $s \|" docs/feature-ledger.md)"; done
grep -nE '^\|[^|]*\| Partial \|' docs/feature-ledger.md | grep -vc '限制：'
grep -rn getWindowGeometry src/; grep -n openNewWindow src/App.tsx; grep -c 'id: "' src/plugins/milkdown/table/actionDescriptors.ts
```

**[A8] 测试质量**
```bash
git ls-files 'tests/*.test.ts' 'tests/**/*.test.ts' | sort > /tmp/t.txt; wc -l /tmp/t.txt   # 93
python3 -c "import random; r=random.Random(20260918); print(sorted(r.sample(range(93),5)))"
xargs grep -c 'expect(' < /tmp/t.txt | awk -F: '{s+=$2} END {print s}'          # 1999
xargs grep -c 'toHaveBeenCalled' < /tmp/t.txt | awk -F: '{s+=$2} END {print s}' # 129
xargs grep -l 'readFileSync' < /tmp/t.txt | wc -l                                # 46
```

**[A9] 文档体量与订正**
```bash
find docs -name '*.md' -type f -exec cat {} + | wc -c; find specs -name '*.md' -type f -exec cat {} + | wc -c
cat .claude/rules/*.md | wc -c; wc -c CLAUDE.md progress.md
find src -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) -exec cat {} + | wc -c
find src-tauri/src -name '*.rs' -exec cat {} + | wc -c
f=docs/plans/20260912-frontend-backend-sequencing-order.md; wc -l $f; for w in 失实 订正 撤回 证伪 修正; do echo "$w $(grep -o $w $f | wc -l)"; done
grep -c '^- \[ \]' docs/plans/20260911-plan-ui-redesign.md; grep -c '^- \[x\]' docs/plans/20260911-plan-ui-redesign.md
```

**[A10] 历史分析**
```bash
git rev-list --count HEAD; git log -n 100000 --oneline | wc -l; git log -n 100000 --merges --oneline | wc -l
git log -n 100000 --format= --name-only -- src src-tauri/src | grep -v '^$' | sort | uniq -c | sort -rn   # 与 wc -l 连接得 提交×行
git log -n 100000 --no-merges --format='%H%x09%s' | grep -P '^\S+\t(fix|Fix)' > /tmp/fx.tsv   # 181
# 对每个 SHA：git show --format= --name-only SHA 是否含 tests/；git show --unified=0 SHA -- '*.rs' 是否有 ^+.*#\[test\]
git log -n 100000 --format=%ad --date=format:%Y-%m | sort | uniq -c
for p in CLAUDE.md .claude/rules/*.md docs/adr/0001-* docs/feature-ledger.md scripts/ledger/check.mjs .github/workflows/ci.yml vitest.config.ts; do
  l=$(git log -n 100000 --diff-filter=A --format='%ad %H' --date=short -- "$p" | tail -1); h=${l#* }; echo "$p ${l% *} $(git rev-list --count ${h}^)"; done
git tag --sort=creatordate; git rev-list --count v0.3.0..HEAD   # 158
sed -n '1,6p' .github/workflows/ci.yml
```

**[A11] 迁移状态词**
```bash
for f in docs/plans/20260912-frontend-backend-sequencing-order.md docs/plans/20260912-plan-markdown-source-consolidation.md docs/plans/20260911-plan-ui-redesign.md; do
  echo "== $f"; for k in 部分 未开始 待 阻塞 仍未 未修复; do echo "  $k $(grep -c $k $f)"; done; done
grep -n 'Q15\|Q16' docs/plans/20260911-plan-ui-redesign.md docs/plans/20260912-frontend-backend-sequencing-order.md
```

**[A12] 数据契约与安全**
```bash
sed -n '59,64p;67,77p;103,113p' src-tauri/src/services/draft/mod.rs; sed -n '1,20p' src-tauri/src/services/draft/migration.rs
grep -rn 'server.token\|server.port\|config.json\|mdpro.log\|data_dir\|home_dir' src-tauri/src | grep -v test
grep -n 'claude_desktop_config\|settings.json\|config.toml' src-tauri/src/commands/mcp.rs
git show --stat c17c003 -n 1; python3 -c "import json;d=json.load(open('tests/render-fixtures/heading-identity.json'));c=d['cases'];print(len(c),sum(1 for x in c if x.get('currentlyFailsOn')))"
sed -n '1,60p' src/services/linkSafety.ts | grep -n import; grep -n 'import\|addHook' src/services/sanitizerPolicy.ts
grep -n 'csp' src-tauri/tauri.conf.json; grep -n 'endpoints' -A2 src-tauri/tauri.conf.json
```
