# 分支审计发现的 MoSCoW 分类：frontend-backend-redesign

> 输入：[`20261009-branch-mini-audit-findings.md`](./20261009-branch-mini-audit-findings.md) 中全部 Critical（0）、High（17）、Medium（48）共 65 条。
> 方法：4 个 Fable 子代理按区域并行，逐条打开引用的 `file:line` 并沿调用链核实（只读，HEAD `aa5123a`；审计截取点 `d785ec9` 之后这些文件没有变化），统一用下面的标准分类。Claude 抽查了 Must 和 Won't 的关键依据（#44 ledger HTML 有 75 个 `href="#"`；#3 的 `get_draft` 在 `src/` 中没有调用方；#42 的 `atEnd` 只定义在 `Selection` 基类上；#65 中 Milkdown 编辑器按文档 key 挂载、已销毁的 flusher 返回 `clean`）。
> `#` 与本地 findings 文件 `.cc-suite/audits/audit-20261009-152531-findings.md` 一致。

## 分类标准

| 类别 | 含义 | 时机 |
|---|---|---|
| **Must** | 普通操作就能触发数据丢失、静默损坏，属于 rule 60 BLOCK 路径；工具类则指人们正依赖的产物是坏的 | 合并 master 前修 |
| **Should** | 缺陷真实，但触发面窄、可恢复（⌘Z），或可见的不一致用户可能碰到 | 尽快修，单独立 D 行 |
| **Could** | 加固、需要先有 bug 或亚毫秒级时序的理论竞态、日志准确性、只影响测试的代码 | 顺手时修 |
| **Won't（本周期）** | 误报、无法复现、修复成本远大于收益 | 不修，原因写明 |

## 总览

| 类别 | 条数（按 finding 计） | 按问题合并后 | 覆盖的 finding |
|---|---|---|---|
| Must | 4 | 2 | #2 / #39 / #43（A）、#44 |
| Should | 10 | 9 | #35（B）、#42（C）、#4 + #27、#16、#6、#12、#45、#46、#19 |
| Could | 45 | — | 见第 3 节 |
| Won't | 6 | 6 | #3、#8、#10、#49、#61、#65 |
| **合计** | **65** | | |

与原审计文档相比，有几处判断变了：
- **#4 与 #27 是同一个问题**（链接弹窗挂起的请求在切换文档后仍然有效）。找到了用户可达的触发路径：弹窗打开时按原生 ⌘W，或 MCP `create_document` 切换了活动文档，此时点 Insert 会写进另一份文档。因此由"未证实"升为 Should。#22 用同一修法就能一起关掉。
- **#3 降为 Won't**：没有加锁的旧格式迁移只有 `get_draft` 命令会走，而前端没有任何地方调用 `get_draft`；实际的恢复路径 `recover_draft_guarded_with` 是持锁的。正确的处理是删掉这个无人调用的命令，同时删掉它的 ledger 行。
- **D（#31/#33/#34）的修复比原先估计的便宜**：每个草稿包已经带有 `DraftOwner.window_label`，删除前直接比对即可。`commands/quit_guard.rs` 头注释里 "no label→id binding exists" 的说法已经过时。
- **#44 的影响比 Codex 报的大**：已提交的 `docs/feature-ledger.html` 中有 75 个链接被渲染成 `href="#"`（Codex 报的是 69 个）。

## 1. Must（合并 master 前修）

| 问题 | finding | 位置 | 核实要点 | 修法 | 规模 |
|---|---|---|---|---|---|
| **A 保存不串行** | #2、#39、#43 | `src/App.tsx:444` → `src/services/saveService.ts:85-98` → `src/hooks/useDocument.ts:201-241` → `src/utils/saveResult.ts:76-86`；`src-tauri/src/commands/file.rs:312` | 整条保存链没有 in-flight 保护：⌘S 直接调用 `onSave`，`markSaveInProgress` 只是给文件监听用的时间戳，`save_file` 没有按路径加锁，`atomic_write` 用 `File::create` 写共享的临时文件名 `.{name}.{pid}.tmp`。每次保存有两次 await，所以较早的保存可能最后才落盘：磁盘上是旧内容，界面显示已保存，关闭时也不提示。属于 rule 60 的数据丢失路径 | 在 `saveActiveDocument` 里按文档串行化（promise 链），临时文件名加唯一后缀并用 `create_new` 创建，补"乱序完成"回归测试 | S |
| **ledger HTML 链接全部失效** | #44 | `scripts/ledger/md.mjs:37` | `safeHref` 只放行 `https?://`、`#`、`/`、`./`、`../`、`mailto:`。ledger 里的链接都写成 `plans/…`、`adr/…`，所以全部变成 `href="#"`。已提交的 HTML 中有 75 处这样的链接，`adr/`、`plans/` 链接为 0 | 允许不带 scheme 的相对路径，只拒绝 `javascript:`、`data:` 等危险 scheme；与 #45、#46 一起修，然后重跑 `pnpm ledger:build` | S |

## 2. Should（尽快修，单独立 D 行）

| 问题 | finding | 位置 | 理由 | 修法 | 规模 |
|---|---|---|---|---|---|
| **B 退出期间新开窗口** | #35 | `quit_guard/request.rs:98-111`、`coordinator.rs:133`；`commands/window.rs:34`、`open_route/tauri_glue.rs:106` | `create_window` 和 `open_file_in_new_window` 都不检查 quit guard。新窗口不在快照里：它的 dirty 回复被拒绝，也不会被提示；它会收到兜底广播并尝试 `save_draft`，但 commit 不等它。只有那次写入抢先完成，编辑才能保住。触发需要在退出对话框弹出时新开窗口 | 退出请求进行中时拒绝新建窗口和外部打开路由，或把迟到的窗口登记进请求 | M |
| **C 末尾分隔线被替换** | #42 | `src/utils/focusActiveMilkdownAtEnd.ts:44` | `TextSelection` 没有自己的 `atEnd`，调用落到 `Selection.atEnd`，遇到末尾可选中的原子节点时返回 `NodeSelection`。Milkdown 的 `hr` 是叶子节点，项目里也没注册 trailing-paragraph 插件。⌘Z 可以恢复 | 用 `Selection.findFrom($end, -1, true)` 并保留回退分支；补回归测试 | S |
| **链接插入写错文档** | #4、#27（#22 一并修） | `src/plugins/codemirror/linkPlugin.ts:70-71`、`src/components/Editor/SplitView.tsx:34`、`src/stores/linkInsertStore.ts` | 所有标签页共用一个 CodeMirror 实例。⌘K 弹窗打开时，原生 ⌘W 或 MCP `create_document` 会切换活动文档，此时点 Insert 就把 `[text](url)` 写进别的文档。⌘Z 可以恢复 | 文档关闭、切换、视图模式改变时调用 `clearPendingCallback()` 并关闭弹窗；或者在发起请求时记下 `activeDocumentId`，提交时比对 | S |
| target 扫描钩子可被绕过 | #16（#17 一并修） | `.claude/hooks/block-target-scan.sh:24,60` | 命令里只要出现 `target` 就整段放行。代码中 `e.target` 很常见，`grep -rn "e.target" .` 会扫进 `src-tauri/target`，正是这个钩子当初要拦的那次 5 分钟事故 | 识别真正的排除或 prune 参数；消费掉 `-e`、`-f` 的参数，没有路径时默认按 `.` 处理 | S |
| heavy-lock 收到信号后过早释放 | #12 | `scripts/heavy-lock.sh:104` | 收到信号只给直接子进程发 TERM，不 `wait` 就释放锁。rustc、vitest worker 还在运行，排队的其他 session 这时就会启动重任务 | 终止整个进程组，等它退出后再释放锁 | M |
| 构建输入检查漏掉 verify 配置 | #6 | `scripts/control/buildInputsGuard.mjs:49` | 检查的文件列表里没有 `src-tauri/tauri.verify.conf.json`。它现在没有路径字段，所以眼下没漏掉什么，但以后加了图标或资源路径就会漏检 | 加入 `SINGLE_FILES`，`baseDir: "src-tauri"` | S |
| ledger 表格缺分隔行仍通过检查 | #45 | `scripts/ledger/parse.mjs:136` | 缺少 `\|---\|` 分隔行的表格能通过 `ledger:check`，但渲染出来是一段文字 | 要求有分隔行，缺失时报错 | S |
| ledger 构建产物前缀缺 `src-tauri/target/` | #46 | `scripts/ledger/parse.mjs:255` | 真实的 Cargo 输出目录不在禁止前缀里，而本地这个目录存在，所以 `path-resolves` 也拦不住 | 把 `src-tauri/target/` 加进前缀列表 | S |
| 视觉快照看不到 toggle 位移 | #19 | `scripts/redesign/snapshot.js:62` | `PROPS` 不含 `transform`、`top`、`left`。设置页的 toggle 滑块靠 `translateX` 移动，这部分回归会被静默放过 | 加上 transform 和定位属性，基线会因此变动一次 | S |

## 3. Could（顺手修）

### 前端
| finding | 要点 | 规模 |
|---|---|---|
| #22 | 只读状态下插入链接，修 #27 时一并解决 | S |
| #23 | 编辑器和序列化器都失败时返回的是请求的内容而非编辑器实际内容；序列化失败时应返回 `storeReconciled: false` | S |
| #24 | 两个窗口的最近文件列表可能乱序写入，需要在 Rust 侧持锁修；下次打开文件会自愈 | M |
| #25 | 启动时显示的模式与磁盘记录不一致，导致第一次切换不写盘；下次切换会修正 | S |
| #26 | `viaDialog` 能绕过当前判断，需要两个提示在同一次 commit 内交替；只影响焦点 | S |
| #28 | Settings 打开后 50 ms 内弹出 Reload，焦点会被 Settings 抢走 | S |
| #58 | 关闭后立即重开 Settings 可能读到写入前的值；需要毫秒级操作 | M |
| #59、#60 | 两次重叠写入都失败后，复选框和磁盘不一致；改用 `useTheme` 的 `rollbackTarget` 模式，抽成共享 helper | S |
| #62、#64 | 偏好写入没有按 key 排序；在 `preferencesService` 加按 key 的写入队列 | S–M |
| #63 | 切换标签页的 300 ms 内 TOC 高亮会闪一下 | S |
| #66 | 只显示一行的视口属于退化情况，作为加固处理 | S |
| #67 | tier-2 匹配到重复标题时跳到第一个；有歧义时应返回 null，同时修正头注释中 "never a wrong target" 的说法 | S |
| #36、#37 | 关闭或更新时 await 期间有 MCP 写入，可能没有提示；master 上就有 | S–M |
| #38、#40 | 切换标签页时忽略了 flush 失败；目前没有已知触发 | M |
| #41 | 异步删除草稿可能删掉更新的草稿；属于理论情况 | S |

### Rust
| finding | 要点 | 规模 |
|---|---|---|
| #31、#33、#34（D） | discard ID 不校验所属窗口；可以直接比对 `DraftOwner.window_label`，同时修正过时的头注释 | M（只改注释为 S） |
| #1 | verify_run 的符号链接逃逸，只在 `verify-run` feature 下编译 | S–M |
| #32 | 兜底超时后，重新起草的草稿可能被删；需要两个小概率条件同时成立 | M |
| #21 | `view_mode` 没有校验；前端类型只会传合法值，属于 IPC 加固 | S |
| #50、#51 | `emit_to` 发给不存在的窗口也返回 Ok；先查窗口再发，前端按 `expiresInMs` 加过期计时 | S |
| #52 | 崩溃后启动又绑定端口失败时，旧的发现文件残留；这是 Could 里最值得做的一条 | S |
| #53 | `unpublish` 吞掉错误，可能破坏"有 port 就有 token"的不变量 | S |
| #54 | 测试辅助函数 `connect_refused` 判断过宽 | S |
| #55 | 路由日志在执行前就记为 Success | S |
| #56、#57 | quit_guard 的副作用没有代次标签；一次修复解决两条 | S–M |

### 脚本
| finding | 要点 | 规模 |
|---|---|---|
| #5 | 同一 checkout 并发构建会共用 sidecar；建议校验打进包里的 sidecar 摘要 | S |
| #7、#9 | 数组形式的 glob 和正则里的 `/*` 会造成漏检；仓库里目前没有这类写法 | S–M |
| #11 | heavy-lock 回收竞态，需要三方竞争；可换成 flock | M |
| #13、#14 | rustScopes 解析 raw 字符串和泛型逗号出错；仓库里没有这类写法 | S |
| #15 | `sourceTree` 把所有 HEAD 读取错误都当成 unborn | S |
| #17 | 随 #16 一起修 | S |
| #18 | `key.sh` 遇到引号会出错；现有调用方不会传引号 | S |
| #20 | snapshot 看不到语法 token 的样式；它们来自 CodeMirror 默认样式，本项目的改动不会让它们回归 | M |
| #47 | ledger 覆盖检查用子串匹配；实测现在没有误判 | M |
| #48 | 语料 `--check` 不检查缺失的条目 | S |

## 4. Won't（本周期不修）

| finding | 原因 |
|---|---|
| #3 | `get_draft` 在前端没有调用方，路径到不了。另立一项清理：删除这个命令及其 ledger 行 |
| #8 | 方向是误报，会失败得很明显，不会静默通过；要修需要一个真正的解析器（L） |
| #10 | `use r#dirs` 是没人会写的对抗性写法 |
| #49 | 截止时间已由 `timeout_at` 保证，缺口只有毫秒级的定时器唤醒延迟，而且写入是用户点了 Approve 的 |
| #61 | Tauri `listen()` 在正常 webview 中不会被拒绝，无法复现 |
| #65 | 误报：只有活动文档挂载了 Milkdown，已销毁的 flusher 返回 `clean`，不存在其他文档的 flusher 失败的情况 |

## 5. 建议的派单顺序

1. **Must A**：保存串行化，前后端各一个提交，走 tdd-guardian。先写乱序完成的 RED 测试。
2. **Must #44，加上 Should #45、#46**：`scripts/ledger/` 的三处小改动放进一个提交，重新生成 `docs/feature-ledger.html`。
3. **Should C、链接插入（#4/#27/#22）**：两个 S 级前端修复，各自带回归测试。
4. **Should B**：需要设计退出期间的窗口策略（拒绝还是登记），建议先立 D 行，再判断是否需要写 ADR。
5. **工具类 Should（#16/#17、#12、#6、#19）**：属于开发体验，可以并行派给执行 session。
6. Could 中 #52、D（#31/#33/#34）、#56/#57 性价比最高，可以排到下一轮。
