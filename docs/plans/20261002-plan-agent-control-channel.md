# Plan: Agent 在真实 app 里验证工作的控制通道（ADR-0047 的执行计划）

Opened 2026-10-02
Branch: `master`（ADR-0083；各工作项在 `mdpro-wt/` 下的短分支上做，由 delegator 以 `--ff-only` 落地。2026-10-12 之前是 `frontend-backend-redesign`，现已冻结）
Repo: anzchy/mdpro
Status: **执行中（2026-10-15：WI-000–WI-004 已完成并验证，WI-004 为 `9940be9`；WI-005 构建已备、人工基线待 dtrack 排期；WI-006 已获实现名额。此前：WI-000–WI-003 已完成并验证；WI-003 真机验收 2026-10-08 夜至 2026-10-09 晨跑过、Check D 修复后 2026-10-09 复测通过）**
上游记录：[ADR-0047](../adr/0047-agents-verify-in-the-real-app-through-a-feature-gated-control-channel.md)（Proposed，2026-10-02 已修订）、[ADR-0034](../adr/0034-a-local-real-app-journey-lane-runs-before-release.md)（Proposed，2026-10-02 已修订）、排序文档 [D30 行](./20260912-frontend-backend-sequencing-order.md#d30)

**分工**：ADR-0047 是决定，本文只写工作项、验收和测试。两者冲突时以 ADR 为准，改的是本文。

## 证据分级约定

| 标记 | 含义 |
|---|---|
| `[实测]` | 写计划时在仓库或本机实际读到、跑出来的，带 `file:line` |
| `[推断]` | 根据文档或经验推出来的，没有跑过；对应工作项开工时先验证 |
| `[二手]` | 研究 agent 或 Codex 读上游源码、文档后的转述，我没有亲自核对 |

## 修订记录

**修订 2（2026-10-02）**。第一稿交 Codex 评审（线程 `01a0fa60…`，结论 NEEDS REVISION，21 条：2 条 BLOCK、18 条 MUST、1 条 SHOULD）。本稿逐条处理，两份 ADR 同步修订。

工作项重新编号。第一稿把「能跑的验证基础设施」排在需要它的工作之后，这是评审指出的顺序倒置：

| 第一稿 | 本稿 | 变化 |
|---|---|---|
| —（散在 WI-004 里） | **WI-000** | 新增：旅程、步骤类别、比对口径、升级试探、读候选 A 的源码 |
| WI-003 新鲜进程标记 | **WI-001** | 扩成构建入口加构建身份，提前到最前 |
| WI-002 运行隔离 | **WI-002** | 加验证打包配置、启动守卫、单一活动运行 |
| —（在 WI-010 里） | **WI-003** | 新增：最小启动器，带所有权证明 |
| WI-001 Tauri 升级 | **WI-004** | 挪到基础设施之后，版本改为钉死的一组 |
| WI-004 基线 | **WI-005** | 只剩两个构建和人工基线 |
| WI-005 / 006 / 007 | **WI-006 / 007 / 008** | S1 加执行安全三项；spike 产物保留到重验通过 |
| WI-008 / 009 / 010 / 011 | **WI-009 / 010 / 011 / 012** | 补契约；最终实现重跑 S1–S5 |

Codex 的 21 条各自落在哪里：

| # | 级别 | 问题 | 本稿的处理 |
|---|---|---|---|
| 1 | MUST | J4 虚构了「保存」按钮 | J4 换成两个存在的点击（J4a、J4b）；J2、J3 的落盘证据改用草稿自动保存。见 WI-000 |
| 2 | MUST | 计划改了 ADR 的决定却没改 ADR | 两份 ADR 已改，见 0.1 |
| 3 | MUST | 「不开任何监听」与 MCP 服务冲突 | 改为「不开控制通道的监听」；按用途和 pid 列监听清单。R3、WI-009 |
| 4 | MUST | 「CLI 重跑 J1–J7」没区分原生步骤和人工步骤；ADR-0034 的首批旅程没人交付 | 步骤分四类（4.1）；旅程编排器（WI-011）；范围声明（第 1 节） |
| 5 | MUST | `HOME` 只隔离 Rust 路径 | 持久化清单、允许留在运行目录外的状态、重置策略（WI-002）。**有保留，见下** |
| 6 | MUST | 固定的验证 identifier 在两次验证运行之间仍会撞 | 同一时刻只允许一个验证运行，发文件参数之前先查（WI-002、WI-003） |
| 7 | MUST | 验证打包配置不完整 | 完整的配置覆盖（WI-002） |
| 8 | **BLOCK** | 只凭 pid 就杀进程、只凭标记文件就递归删目录 | 所有权 = 启动随机数 + 进程启动时间 + 可执行文件路径，对不上就拒绝（R8、WI-003） |
| 9 | MUST | 启动成功与关闭的语义没定 | 三级就绪、失败清理、`quit` 的语义（WI-003、WI-009） |
| 10 | MUST | 「`open` 不传环境变量」是错的 | 已更正（3.3）；冷启动拆成 J1a、J1b；每条启动路径都传环境变量 |
| 11 | MUST | `buildId` 分不出两次不同的脏改动 | 改为工作区内容的 git tree 哈希（WI-001）。**做法比建议的轻，见下** |
| 12 | MUST | Cargo feature 管不到 Vite 产物 | 默认方案下三种构建共用同一份 `dist`，不存在前端变体（Q9）。**与建议不同，见下** |
| 13 | MUST | 「只在 feature 构建里的能力文件」要明确做法 | `build.rs` 按 `CARGO_FEATURE_*` 分支加 `capabilities_path_pattern`；能力文件不是监听的授权边界（WI-009） |
| 14 | SHOULD | 「同一个小版本」是错的目标 | 钉一组测过的版本（WI-000 试探、WI-004） |
| 15 | MUST | S5 的日志比对又脆又弱 | 语义投影（WI-000）；两种比较分开做（WI-005） |
| 16 | MUST | `stat` 清单证明不了「没读真实数据」 | 路径解析测试和启动守卫为主，清单为辅（WI-002）。**有保留，见下** |
| 17 | MUST | CLI 与探针的契约不全 | WI-010、WI-011 |
| 18 | MUST | 「带返回值的脚本执行」不是异步操作契约 | 进 S1 的通过标准，并在 WI-009 落地 |
| 19 | MUST | 工作项顺序倒置 | 重排，见上表 |
| 20 | **BLOCK** | 选型可能先于「变更不重放」和「`eval` 关得住」的证明 | 这三项进 S1，候选不过就不入选（ADR-0047 决定 4；R9、R10） |
| 21 | MUST | 选中的实现在取证之后被重写 | spike 产物保留；最终实现重跑 S1–S5（WI-008、WI-011） |

**我与 Codex 不同的四处**（都可以被你推翻）：

1. **#16 不做进程级的文件访问监视。** `fs_usage` 之类要 sudo。主证据改为两样：每个持久化根目录的路径解析测试，和验证构建在环境不对时拒绝启动的守卫。前后元数据清单只作旁证，并且在日常 mdpro 关着的时候取。
2. **#5 不承诺在 macOS 13 上实测 WebKit 数据。** 验证只在开发机上跑。macOS 13 上 WebKit 数据会在两次验证运行之间保留，这一点写成已知限制，进每份记录。
3. **#11 不手工维护一份源文件清单。** 用临时 index 算工作区的 git tree 哈希，已跟踪和未跟踪（未被忽略）的文件都算进去。被忽略的构建输入只有 sidecar 二进制，单独算哈希。
4. **#12 不做前端构建变体。** 探针由 Rust 侧注入脚本读 DOM，前端产物在三种构建里完全相同。这条是新设计，Codex 没审过，列为 Q9。

---

## 0. 审核时请先看这几处

### 0.1 两份 ADR 已经改了什么

都是 Proposed，按「Proposed 可原地更正」的惯例直接改，并在 Status 里留了修订说明。两份都没有提交。

| ADR | 位置 | 改动 |
|---|---|---|
| 0047 | Status | 加修订说明；与 ADR-0034 的关系从两处扩到四处；去掉「未合并」 |
| 0047 | Context | 加三条事实：single-instance 套接字由 identifier 决定；WebKit 数据不跟 `$HOME`；`main` 在 builder 之前就写日志、迁移草稿 |
| 0047 | 决定 3 | 三个前置条件变四个。隔离加「不被路由进另一个 mdpro」「独立的 bundle 身份」「同一时刻一个运行」「隔离是部分的」；构建身份覆盖内容；启动器要证明所有权 |
| 0047 | 决定 4 | 候选先后做；S1 加执行路由清单、`eval` 关闭、至多一次、结果契约；S2 的负对照改为回退 `c39dfb1`；S5 改为语义比较，另加生产打包抽样 |
| 0047 | 决定 5 | 选择规则补上「候选 A 在任何一关失败」；「小到能发给上游」换成维护预算；选型之后实现要重过 S1–S5 |
| 0047 | 决定 6–8 | 「不开控制通道的监听」；能力文件只在需要 IPC 权限时才有；探针加「窗口就绪」「待确认提示」；驱动不重放 |
| 0047 | Consequences | 与发布版的差异逐项列出；三种构建；隔离不完整；一次一个运行；验证构建不能手工打开；筛选要跑两遍 |
| 0034 | Status、决定 2、3、4、6、Costs | 四处改为指向 ADR-0047：spike 顺序、「一个 Cargo feature」、安全条件、日志路径。车道本身和首批旅程不变 |

### 0.2 待你决定的问题

每个问题都给了默认值。你不回答时按默认值执行，并在对应工作项里记下来。Q9–Q11 是本稿新出现的，Codex 没有审过。

| # | 问题 | 默认值（我的建议） | 影响 |
|---|---|---|---|
| Q1 | spike 的时间盒：每个候选两个工作日 | 确认。到点未过即按决定 5 处理，不延长 | WI-006、WI-007 |
| Q2 | 候选先后做，WebdriverIO 插件在前；维护预算多少行 | 先后做。~~预算约 300 行~~ **预算约 400 行**（2026-10-15 用户原话「Raise to ~400」，经 delegator 转达），只限监听、鉴权、路由表三处 | WI-006、WI-007 |
| Q3 | 数据目录的隔离机制 | `HOME` 加 `CFFIXED_USER_HOME` 指向运行目录，称为「部分隔离」。不引入发布版也认的数据根目录变量 | WI-002 |
| Q4 | 验证构建是否用独立 identifier | 用 `com.mdpro.app.verify`，连同完整的打包配置。**不设「退回同 identifier」的自动退路**：S4 若因此失败，停下来问你 | WI-002 |
| Q5 | `pid`、`buildId` 进所有构建还是只进验证构建 | 所有构建的 `app.ready` 都带。不强制写日志：用户关了日志就没有这一行。自动化不依赖它，另有握手文件 | WI-001、WI-003 |
| Q6 | CLI 放哪、用什么写 | `scripts/control/*.mjs`，Node，测试放 `tests/`。「不加依赖」是暂定的：ARIA 名称计算若证明自己写不全，再经 ADR 引入依赖 | WI-003、WI-011 |
| Q7 | Feature Map 与 `docs/feature-ledger.md` 的关系 | ledger 仍是状态的唯一来源。Feature Map 只写「怎么驱动、看什么证据」 | WI-012 |
| Q8 | 排序文档里怎么记 | 只在 D30 行加链接，不为每个 WI 开行 | WI-008 |
| **Q9** | 探针怎么读前端状态 | **Rust 侧注入脚本读 DOM，加 Rust 侧状态**。三种构建的 `dist` 完全相同。代价：当前渲染的标签栏没有 tab 语义，脏标记是个空 `<span>`，要先给它补 ARIA（所有构建都带，本身是无障碍改进，可能要动标签的 DOM 结构）。备选是做一个前端构建变体把 store 暴露出来，那样要分输出目录、防产物串味 | WI-010 |
| **Q10** | Cargo feature 用一个还是两个 | **两个**：`verify-run`（启动守卫、MCP 端口）和 `control-channel`（驱动，依赖前者）。这样「驱动开或关」能在同一个验证身份下比较 | WI-002、WI-009 |
| **Q11** | 验证构建的 WebKit 数据怎么处理 | 用默认的持久存储，落点实测后写进记录，不清理。备选是验证构建里开 `incognito`，更干净，但与发布版又多一处差异。前端不用任何 web storage `[实测 src/ 无匹配]`，所以残留的只会是缓存 | WI-002 |
| **Q12** | ADR-0034 的首批旅程（D29 三条、D20 G1、偏好往返）和 `pnpm test:app` 谁来做 | 不在本计划内。本计划交付通道、CLI 和 J1a–J7b；那五条旅程和车道命令在 D30 / ADR-0034 下另开后续计划 | 范围 |

---

## 1. Outcomes（要达到什么）

1. Agent 做完一个工作项后，能自己在真实 app 里核对路由、状态、落盘和控制台错误，并交回带证据类别的结果。人只被问到只有人能判断的事。
2. 同一个通道也是 ADR-0034 发布前旅程车道将来的驱动方式。
3. 发布版里没有这个通道：依赖图、前端产物、运行时三处都查不到，尝试激活也激活不了。

**本计划交付**：通道、启动器、CLI、旅程 J1a–J7b、验证 skill 和 Feature Map。

**不在范围内**：

- ADR-0034 的首批旅程和 `pnpm test:app`（Q12）。
- 进 CI、成为提交或发布的门禁（ADR-0047 决定 1、ADR-0034 决定 1）。
- 以耗时、FPS、内存为阈值的断言（E39）。等待命令的超时是「等不到就放弃」，不是性能断言。
- 原生菜单栏、打开和保存面板、退出提示、Finder 的自动化。这些留给 `gui-acceptance` 或人（决定 2）。
- 物理按键和 IME 的结论（决定 8）。

## 2. Constraints & Dependencies（约束与依赖）

- macOS 13+、Apple Silicon、WKWebView；pnpm 10.26.1；Rust stable。
- 实现类工作项走 tdd-guardian。配置可用：`enabled: true`，车道 `unit` 与 `rust` `[实测 .claude/tdd-guardian/config.json]`。spike（WI-006、WI-007）和升级试探（WI-000）是一次性调查，不走 tdd-guardian，也不合入。
- 工作树只放在 `/Users/jackcheng/Documents/01_Coding/mac-app/mdpro-wt/`，分支名 `<type>/d30-<slug>`。
- agent 不读、不打印 `server.token`。隔离运行里的 token 也一样：只在 CLI 内部用，永不输出。
- 旅程里不点草稿的 Discard。J5 用 Esc，等同「Keep editing」。
- 改变行为的提交在同一提交里改 `docs/feature-ledger.md` 对应行，并过 `pnpm ledger:check`。
- 对话框键盘行为只由物理按键定案（`progress.md` 2026-09-30）。
- 删除分支、递归删除目录这类命令，由我执行时先问你（规则 25）。CLI 自己的清理逻辑受 R8 约束。

## 3. Current Behavior Inventory（现状清单）

### 3.1 版本

| 项 | 现状 | 证据 |
|---|---|---|
| `tauri` | `Cargo.toml` 写 `"2"`，lock 在 2.9.5 | `[实测 src-tauri/Cargo.toml:22；Cargo.lock:4469]` |
| 关联 crate | tauri-build 2.5.3、wry 0.53.5、tao 0.34.5、single-instance 2.3.7、updater 2.9.0、process 2.3.1、opener 2.5.3 | `[实测 Cargo.lock]` |
| JS 侧 | `@tauri-apps/api` lock 里同时有 2.9.1 和 2.10.1；`@tauri-apps/cli` 2.9.6。这些包本来就各有各的版本号 | `[实测 pnpm-lock.yaml:816-888]` |
| `eval_with_callback` | 2.9.5 没有，2.11.5 有；2.10.x 未查 | `[实测 ~/.cargo/registry 两个版本的源码]` |
| 注入初始化脚本 | `plugin::Builder::js_init_script`、`WebviewWindowBuilder::initialization_script` 在 2.9.5 和 2.11.5 都有 | `[实测 tauri-2.9.5/src/plugin.rs:370；webview_window.rs:946]` |
| Cargo feature | 没有 `[features]` 段；`build.rs` 只有 `tauri_build::build()` | `[实测 src-tauri/Cargo.toml；build.rs]` |

### 3.2 一次运行会碰到的状态

| 状态 | 位置 | 跟 `$HOME` 走吗 | 证据 |
|---|---|---|---|
| 偏好 `config.json` | `~/.mdpro/` | 是 | `[实测 services/preferences.rs:52-61]` |
| 日志 `mdpro.log` | `~/.mdpro/` | 是 | `[实测 services/logger.rs:13-17]` |
| 草稿 | `~/Library/Application Support/mdpro/drafts` | 是 | `[实测 services/draft/paths.rs:8-13]` |
| 旧草稿迁移 | `~/.mdpro/drafts` | 是 | `[实测 services/draft/migration.rs:113]` |
| MCP `server.token`、`server.port` | `~/Library/Application Support/mdpro/` | 是 | `[实测 services/http_server.rs:81]` |
| MCP 客户端配置安装 | `~/Library/Application Support/Claude/…`、`~/.claude/settings.json`、`~/.codex/config.toml`、`~/.config/gemini/settings.json` | 是 | `[实测 commands/mcp.rs:315-348]` |
| MCP 端口 | 固定 `127.0.0.1:55045` | **否** | `[实测 services/http_server.rs:895-905]` |
| single-instance 套接字 | `/tmp/com_mdpro_app_si.sock`，由 identifier 决定 | **否** | `[实测 tauri-plugin-single-instance-2.3.7/src/platform_impl/macos.rs:60-70；tauri.conf.json:5]` |
| WKWebView 数据 | wry 用 WebKit 默认的持久存储；自定义存储要 macOS 14；`incognito` 才是非持久的 | **否**（落点未测） | `[实测 wry-0.53.5/src/wkwebview/mod.rs:221-245]` |
| Cocoa 的偏好、缓存、窗口恢复状态 | `~/Library/…/<bundle id>` | 未知 | `[推断]`，WI-002 实测 |
| 前端 `localStorage` 等 | 未使用 | — | `[实测 src/ 无匹配]` |
| 启动时联网 | 没有；更新检查只在「关于」页点击时触发 | — | `[实测 AboutSettings.tsx:65]` |

所有 Rust 侧路径都经 `dirs` crate，现有 Rust 测试就是用临时 `$HOME` 加 `crate::HOME_LOCK` 隔离的 `[实测 src-tauri/src/lib.rs:20]`。偏好读失败时日志会被关掉（`FAIL_CLOSED_SETTINGS`）`[实测 services/logger.rs:44,104-106]`。

### 3.3 启动与进程

- **`main` 在 builder 之前就碰持久化**：第一条语句写 `app.launch` 日志（`main.rs:79`），随后迁移旧草稿（`:95`），`tauri::Builder` 在 `:121` `[实测]`。所以启动守卫必须是 `main` 的第一条语句。
- MCP 服务在 `setup` 里启动（`main.rs:148-165`）；`app.ready` 在 `:240-250`，只带 `startupTimeMs`、`appVersion`、`platform` `[实测]`。前端的偏好加载更晚。所以 `app.ready` 不代表通道就绪，也不代表窗口就绪。
- 插件注册顺序：`single_instance`（`:257`）→ opener（`:413`）→ updater（`:414`）→ process（`:415`）；`RunEvent::Opened` 在 `:438`，`RunEvent::Exit` 在 `:516` `[实测]`。
- `"appReady"` 这个字段只在 `RunEvent::Opened` 的日志里出现（`:471`）`[实测]`。它不是冷启动的通用标记。第一稿用错了。
- **`open` 会把环境变量传给它启动的 app**，并且有 `--env VAR=值` `[实测 man open]`。第一稿的推断是错的。直接执行包内二进制仍然有用：启动器能拿到子进程句柄。两条路径是两条不同的启动路径，各测各的。
- `src-tauri` 里没有任何信号处理 `[实测 grep]`。SIGTERM 多半不经过退出守卫 `[推断]`。
- sidecar `mdpro_mcp` 由 MCP 客户端启动，从它自己的环境解析数据目录 `[实测 bin/mdpro_mcp.rs:254-259]`。

### 3.4 可观测性与可驱动性

- 前端 `error`、`unhandledrejection` 没有任何捕获 `[实测 src/ 无匹配]`。
- `src/main.tsx` 在顶部静态导入 `App` `[实测]`。装在前端包里的捕获赶不上模块初始化阶段的错误，得由 Rust 侧在页面脚本之前注入。
- store 和编辑器视图不在 `window` 上；`data-testid` 为 0。
- **实际渲染的标签栏是 `BottomTabs`**（`App.tsx:1023`）`[实测 BottomTabs.tsx:48-77]`：
  - 标签是普通 `<button>`，没有 `role="tab"`、没有 `aria-selected`，活动状态只在 CSS 类上；
  - 新建按钮的文字是 `+`，只有 `title`；
  - 脏标记是一个没有任何文字和属性的 `<span className="bottom-tab__modified" />`；
  - 关闭控件是嵌在标签按钮里的 `<span role="button">`，文字 `×`，没有可访问名称。

  带完整 ARIA 的 `TabBar.tsx` 没有被任何地方渲染 `[实测 grep "<TabBar"]`。
- 关闭脏文档的确认框标题是 `Unsaved changes`，只有 `Discard` 和 `Keep editing` 两个按钮，没有「保存」`[实测 BottomTabs.tsx:79-87；App.tsx:1049-1056]`。确认按钮带 `autoFocus` `[实测 ConfirmDialog.tsx:67-69]`。
- 设置对话框只能从原生菜单 `Preferences...` 打开 `[实测 menu.rs:77-82；App.tsx:472,878,898]`。里面的复选框有的带 `<label htmlFor>`（如 `md-auto-pair`），有的没有（如 Word Wrap）`[实测 MarkdownSettings.tsx:70-77；EditorSettings.tsx:185-193]`。
- 新开窗口的入口是原生菜单 `New Window`（⌘⇧N）`[实测 menu.rs:107-112]`。
- 自动保存写的是草稿（`save_draft`），不是文件本身；间隔下限 5 秒 `[实测 src/hooks/useAutoSave.ts:15,28]`。`⌘S` 是原生菜单加速键，不经过 webview。
- 修饰键快捷键：Source 模式 `Mod-1`…`Mod-6`、`Mod-k`、`Mod-Shift-h` `[实测 src/plugins/codemirror/]`；WYSIWYG 模式 `Mod-1`…`Mod-6`、`Mod-b`、`Mod-i` `[实测 src/plugins/milkdown/typoraKeymapPlugin.ts:158-166]`。
- `menu:action` 的焦点判断在 `isFocused()` 抛错时放行 `[实测 src/hooks/useMenuEvents.ts:108-115]`。

### 3.5 构建与打包

- `beforeBuildCommand` 是 `pnpm build`，产物固定在 `../dist` `[实测 tauri.conf.json:9-10]`。不管 Cargo feature 怎么选，前端都是同一条命令、同一个目录。
- 打包配置里有：`fileAssociations`（md、markdown）、`createUpdaterArtifacts: true`、更新地址指向正式发布、`externalBin: ["binaries/mdpro_mcp"]`；没有签名相关的段 `[实测 tauri.conf.json]`。
- sidecar 二进制 `src-tauri/binaries/mdpro_mcp-aarch64-apple-darwin` 被 gitignore，新工作树里要手工拷进去 `[实测 CLAUDE.md]`。它由哪一步构建，开工时核对。
- 能力文件只有 `capabilities/default.json`，覆盖 `main` 和 `mdpro-*` `[实测]`。tauri-build 默认解析 `capabilities/` 下所有文件；`Attributes::capabilities_path_pattern` 可以改 `[实测 tauri-build-2.5.3/src/lib.rs:348,376]`。
- 窗口有三个创建点：配置里的主窗口、`commands/window.rs:59`、`services/open_route/tauri_glue.rs:114` `[实测]`。

### 3.6 现状与目标的差距

| 差距 | 由哪个工作项补 |
|---|---|
| 没有写下来的旅程、比对口径、步骤分类 | WI-000 |
| 无法证明「正在跑的是这次构建」 | WI-001 |
| 验证运行会读写真实数据、抢端口、被路由进已运行实例 | WI-002 |
| 没有能安全启动和结束进程的工具 | WI-003 |
| Tauri 版本不够 | WI-004 |
| 不知道哪个驱动能用 | WI-005 – WI-008 |
| 没有 feature 开关、凭证、运行时开关、发布版洁净检查 | WI-009 |
| 没有只读探针和控制台捕获；标签栏没有 ARIA 语义 | WI-010 |
| 没有 CLI、没有证据类别、没有旅程编排 | WI-011 |
| 没有 Feature Map；`test-runner`、`fix`、`feature-workflow` 里的「Tauri MCP E2E」指向空处，`mcp-dev` skill 过时 | WI-012 |

## 4. Target Rules（目标规则）

来自修订后的 ADR-0047，这里只编号以便工作项引用，不新增决定。

- **R1 隔离**：验证运行不读写真实的 `~/.mdpro`、`~/Library/Application Support/mdpro` 和 MCP 客户端配置；不占 55045；不被路由进另一个 mdpro（日常的或另一次验证运行）。同一时刻只有一个验证运行。隔离是部分的：留在运行目录之外的状态逐项列出，进每份记录。（决定 3）
- **R2 新鲜且是预期的构建**：每次运行先证明进程是这次启动的、镜像是预期的那次构建。构建身份覆盖内容。证明不了就是 NOT VERIFIED。（决定 3）
- **R3 只在验证构建里，且要显式打开**：通道由默认关闭的 Cargo feature 编入，启动时还需显式开关。没有开关时不开**控制通道的**监听；MCP 服务照常。（决定 6）
- **R4 凭证**：每次启动新发、放在私有的运行目录里、进程退出即失效；永不复用 `server.token`；每个路由或每次请求都校验。HTTP 监听只绑回环并严格校验 Host 和 Origin；Unix 套接字权限 0600。（决定 6）
- **R5 发布版洁净**：默认 feature 图里没有驱动 crate；发布用的 `dist` 里没有驱动资源；对发布包探测不到端点；对发布包尝试运行时激活也失败。（决定 6）
- **R6 探针只读**：探针有版本号，不刷新、不聚焦、不同步任何状态。（决定 7）
- **R7 证据类别**：结论只能是 pass、fail、driver failure、unknown outcome、NOT VERIFIED 之一。驱动输入记为驱动输入，不抵物理按键规则。（决定 8）
- **R8 所有权**：启动器只结束它能证明是自己启动的进程，只删它能证明是自己建的目录。对不上就拒绝，不猜。（决定 3）
- **R9 至多一次**：一个变更类请求最多执行一次。CLI 不重试，驱动不重放，迟到的结果不改结论。（决定 4 的 S1、决定 8）
- **R10 `eval` 关得住**：没有在启动时单独开启，服务端就拒绝任意脚本，凡是能执行脚本的路由都算。输出不算验收证据。（决定 7）

### 4.1 步骤类别

旅程的每一步属于下面四类之一，记录里逐步标明。「用 CLI 跑旅程」指编排器跑 `cli` 步骤，并在其余步骤上停下来等人或等另一个工具。

| 类别 | 谁做 | 例子 |
|---|---|---|
| `cli` | 经控制通道的驱动输入或探针 | 在编辑器里打字、点 webview 里的按钮、读脏标记 |
| `launcher` | 启动器起外部进程 | 冷启动、带路径起第二个进程、`open --env … -a` |
| `native` | `gui-acceptance`（computer-use）或人 | 原生菜单、打开和保存面板、退出提示 |
| `human` | 只能是人 | 物理按键、IME、绘制是否正确 |

### 4.2 边界情况

| 情况 | 期望 |
|---|---|
| 日常 mdpro 正在运行 | 验证运行照常冷启动，窗口标签为 `main`，两边互不影响 |
| 另一个验证运行正在跑 | `launch` 在发出任何文件参数之前拒绝，指出是哪次运行 |
| 上一次验证运行崩溃，留下运行目录、锁或套接字 | `doctor` 报告并指出是哪次运行留下的；不自动删 |
| 记录里的 pid 现在是另一个进程（pid 被复用） | `quit` 拒绝，报告对不上的是哪一项 |
| 验证构建被双击，或没带运行环境就被 `open` 起来 | 进程立刻退出，不碰任何持久化路径 |
| 构建比工作区旧，或不是经构建入口打的 | `doctor` 给 NOT VERIFIED |
| 启动时没带通道开关 | 不开控制通道的监听；MCP 服务照常 |
| 凭证错误、缺失，或 Host/Origin 不符 | 拒绝，且不泄露凭证是否存在 |
| 变更类命令超时 | unknown outcome；之后到达的结果被丢弃并记日志；后续先用探针读状态 |
| 同一个请求被发了两次 | 第二次不执行，返回第一次的结论或「重复请求」 |
| 请求执行期间窗口被重载或关闭 | driver failure，带窗口的新代号 |
| 控制台缓冲溢出 | 探针返回溢出计数和首尾序号 |
| 目标窗口标签不存在或已关闭 | driver failure，带现有标签列表 |
| 按 role 和 name 找到多个目标，或找到的目标不可见 | driver failure，列出全部匹配；不猜 |
| ADR-0042 的 MCP 确认框（60 秒超时）弹出 | 探针能看到它；等待命令不把它当作「稳定」 |
| 用户在偏好里关了日志 | 发布版照旧不写 `app.ready`；验证运行用预置的偏好夹具，日志是开的 |

## 5. Decision Log（本计划自己的决定）

ADR-0047 已定的不重复。下面是计划层面的选择，都能被你在 0.2 里推翻。

| # | 决定 | 备选 | 理由 |
|---|---|---|---|
| PD1 | spike 代码不合入；选定后从 WI-009 起按 TDD 重写，重写后重跑 S1–S5 | 把 spike 分支整理后合入 | spike 代码没有先写测试；但重写之后原来的证据就不算数了，所以要重验 |
| PD2 | 数据目录隔离靠 `HOME`，不加应用级的数据根目录变量 | `MDPRO_DATA_ROOT` 之类 | 发布版若认这种变量，等于多一个能把 token 目录指到别处的入口。`verify-run` 认的变量只做校验，不改路径 |
| PD3 | 构建身份 = 工作区的 git tree 哈希，由唯一的构建入口算出并经环境变量编进二进制 | 提交号加「是否干净」；手工维护源文件清单 | 前者分不出两次脏改动；后者要人维护。tree 哈希由 git 算，已跟踪和未跟踪的都覆盖 |
| PD4 | 自动化靠握手文件确认进程身份，不靠 `app.ready` 日志行 | 等日志行出现 | 日志可以被用户关掉，也可能写失败；`app.ready` 也不代表窗口就绪 |
| PD5 | J2、J3 的落盘证据用草稿自动保存 | `⌘S` | `⌘S` 是原生加速键，在驱动够不着的那一层 |
| PD6 | `quit` 默认保留运行目录，删除是单独的 `clean` 命令 | 退出即删 | 运行目录里是证据（日志、草稿、偏好）；删除要过所有权检查 |
| PD7 | 第三阶段先给与驱动无关的验收；驱动相关的细节在 WI-008 之后补写 | 现在就写满 | 驱动没选出来，写了也是猜 |
| PD8 | Tauri 升级前先做一次不合入的试探 | 直接升级 | 升级的风险在键盘和焦点上，越早知道越好；试探同时给出要钉的那组版本 |

## 6. Work Items（工作项）

### 总览

| WI | 内容 | 对应 ADR | 依赖 | 估计 | 走 tdd-guardian |
|---|---|---|---|---|---|
| **第零阶段：口径**（不产生合入的代码） |||||
| WI-000 | 旅程、步骤类别、比对口径、记录模板、升级试探、读候选 A 源码 | 决定 4 | — | M | 否 |
| **第一阶段：前置条件** |||||
| WI-001 | 构建入口与构建身份 | 决定 3 | WI-000 | M | 是 |
| WI-002 | 验证打包配置与运行隔离 | 决定 3 | WI-001 | L | 是 |
| WI-003 | 最小启动器：`doctor`、`launch`、`quit`、`clean` | 决定 3 | WI-001、002 | M | 是 |
| WI-004 | Tauri 升级到钉死的一组版本 | 决定 3 | WI-000–003 | M | 否（依赖变更），全套门禁加真机对照 |
| **第二阶段：spike** |||||
| WI-005 | 两个构建与人工基线 | 决定 4 | WI-004 | S | 否（人工） |
| WI-006 | 候选 A：`tauri-plugin-wdio-webdriver` | 决定 4 | WI-005 | 2 天时间盒 | 否 |
| WI-007 | 候选 B：自研插件（A 不合格才做） | 决定 4 | WI-005 | 2 天时间盒 | 否 |
| WI-008 | 选择、记录、ADR 状态 | 决定 5 | WI-006/007 | S | 否（文档） |
| **第三阶段：落地**（WI-008 结论为「只读探针」时，WI-009 缩为探针通道，WI-011 去掉输入命令） |||||
| WI-009 | 驱动接入 | 决定 6 | WI-008 | L | 是 |
| WI-010 | 固定探针 v1 与控制台缓冲 | 决定 7 | WI-009 | M | 是 |
| WI-011 | `control-mdpro` 完整 CLI、旅程编排、重验 | 决定 1、5、8 | WI-009、010 | L | 是 |
| WI-012 | 验证 skill 与 Feature Map | 「未决定」项 | WI-011 | M | 否（文档） |

---

### WI-000 旅程、步骤类别、比对口径、升级试探

- **Goal**：在写任何代码之前，把「跑什么、跟什么比、记在哪」定死，并尽早知道 Tauri 升级和候选 A 的风险。
- **旅程**（每一步标步骤类别；每个控件引用 `file:line`）

  | 旅程 | 内容 | 落盘或日志证据 | 用于 |
  |---|---|---|---|
  | J1a | `launcher`：直接执行包内二进制，带夹具冷启动；窗口 `main` | 握手文件；`app.ready` 带 pid 和 buildId；`file.open.cli`，之后 `tab.open` | S4、S5 |
  | J1b | `launcher`：没有实例在跑时 `open --env … -a <包> <夹具>` | `file.open.external`（`source:"finder"`、`appReady:false`），紧跟 `file.open.external.pending` `[实测 main.rs:438-492]`；之后 `tab.open` 才证明文件真的开了 | S4、S5 |
  | J2 | `cli`：Source 模式（由预设的 `defaultViewMode` 定，不靠按键）。输入 `alpha beta`，移开光标后用 Shift+← 选中 `alpha`，删除，`Mod-z`，`Mod-1` | 草稿文件的 `content` 等于预期；`ui.shortcut.trigger` 一条 | S3、S5 |
  | J3 | `cli`：WYSIWYG 模式。输入 `alpha beta`，选中 `beta` 按 `Mod-b`，再选中 `alpha` 删除，`Mod-z`，`Mod-1` | 草稿的 `content` 与人工基线那次的草稿逐字节相同 | S3、S5 |
  | J4a | `cli`：点 `BottomTabs` 的新建按钮 → `create_document` `[实测 BottomTabs.tsx:49-55；fileService.ts:44]` | 标签数加一，活动文档变了；`tab.open`、`tab.switch` | S3（触发异步 IPC 的点击） |
  | J4b | `native`：原生菜单开 `Preferences...`。`cli`：进 Markdown 页，点 `Auto-pair Brackets & Quotes` 复选框 → `set_preferences` | 这一步的日志片段里 `preferences.set` 恰好一条 start 一条 success `[实测 commands/preferences.rs:61-98]`；运行目录的 `config.json` 里 `markdown.autoPair` 翻转 `[实测 models/preferences.rs:776-780]` | S3（点击 → 异步 IPC → 落盘） |
  | J5 | `cli`：文档变脏 → 点标签的关闭 → `ConfirmDialog` 出现。然后按 Esc，焦点不事先移到对话框上 | 头上：`ui.dialog.cancel` 和 `ui.dialog.escape` 两条，对话框关闭；文档仍在、仍脏 | S2 |
  | J6 | `native`：原生菜单 `New Window` 开第二个窗口 `mdpro-<uuid>`。`cli`：按标签分别读两个窗口的活动文档和脏标记 | `window.create`；两个窗口的探针结果互不串 | S4 |
  | J7a | `launcher`：运行中，带**已经开着的那份**文件的路径起第二个进程 | `app.single_instance`；`file.open.route` 的 `outcome` 是 `existing-window`；`main` 切回那个标签，不新开 | S4 |
  | J7b | `launcher`：运行中，`open --env … -a <包> <一份没开着的文件>` | `file.open.external`（`source:"finder"`、`appReady:true`）；`file.open.route` 的 `outcome` 是 `new-window`；多出第三个窗口 | S4 |

  每一步的键序、控件、预期事件和 `file:line` 在[旅程文档](../test/20261002-adr0047-journeys.md)里，上表只是索引，两处不一致时以旅程文档为准。

  **2026-10-02 对照代码后的修正**（写旅程文档时发现）：
  - 草稿不在 `~/.mdpro/` 下，在 `~/Library/Application Support/mdpro/drafts/<文档 id>.draft.json`。自动保存最短 5 秒一次，只写活动且已修改的文档。
  - 模式靠预设的 `defaultViewMode` 定。`⌃2`、`⌃4` 只是原生菜单的快捷键，驱动够不着。所以 Source 和 WYSIWYG 分两次运行。
  - J2、J3 的键序是为撤销分组定的。CodeMirror 和 ProseMirror 都会把 500 ms 内相邻的输入和删除并成一个撤销单位，驱动打字快，人打字慢，撤销掉的内容就可能不一样。键序里先移动选区（J3 里先加粗），让删除必定自成一组，结果不随速度变。
  - `Mod-z` 走哪条路都不写日志，只能看落盘的文字。
  - J5 的日志证据是两条：`ui.dialog.cancel` 和 `ui.dialog.escape`。
  - J7a 原来没说带哪个路径。带一份没开着的文件时，走广播还是新开窗口取决于窗口数，而广播只由有焦点的那个窗口处理，结果不稳定。改成带已经开着的文件，结果是确定的。
  - J1b 有一个竞态：打开事件若在 `app.ready` 之后才到，文件会开在新窗口而不是 `main`。以人工基线那次为准；人工两次结果不一样时，J1b 记为不可比。
  - S2 要读 DOM 焦点，而 release 配置的包没有 Web Inspector。spike 用的包需要打开 Tauri 的 `devtools` feature（见 WI-005）。

  下文说「全部旅程」指 J1a–J7b 这十条。J4b 同时是 ADR-0032 偏好往返的前半段，但不替代它（Q12）。
- **Acceptance**
  1. `docs/test/<日期>-adr0047-journeys.md` 写好十条旅程：每步的类别、预期的应用事件、最终的磁盘状态。每个被点的控件、被按的键都对照代码核过。
  2. **语义投影**写进同一份文档，作为「两次运行一致」的唯一定义：
     - 只看一份允许清单里的应用事件，驱动自己的生命周期事件不算；
     - 比因果顺序，不比全序（异步事件可以交错）；
     - 归一：时间戳、耗时、pid、buildId、窗口 uuid、文档 id、临时路径；
     - 每个事件列出必须相等的载荷字段（哪个窗口、哪个文档、什么操作）；
     - 加上最终的磁盘检查（草稿内容、`config.json` 字段）；
     - 不比较任何耗时（E39）。
  3. `docs/test/<日期>-adr0047-spike.md` 建好骨架：每个候选一张 S1–S6 的表，每格是「结论 + 证据类别 + 证据位置」。
  4. S2 的人工基线规程写好：四项记录（原生 key window、DOM 焦点、收到按键的窗口、日志行），以及「回退构建上物理 Esc 也关了对话框」时怎么办（S2 作废，暂停）。
  5. **升级试探**（不合入）：在 `mdpro-wt/chore-d30-tauri-upgrade-trial` 上把 Tauri 升到候选版本，跑 `pnpm test:run`、`pnpm build`、`cargo test`，打一个包，由人做 J1a 和 J5 的物理 Esc。产出两样：坏了什么；要钉的那一组版本（tauri、tauri-build、wry、tao、四个插件、`@tauri-apps/api`、`@tauri-apps/cli`）。
     **结果（2026-10-02）**：升到 Tauri 2.12.1，源码和 `Cargo.toml` 一行没改，只动了两个 lock 文件和 `package.json` 里五个 `@tauri-apps/*` 的版本范围。升级前后门禁结果相同（`pnpm test:run` 4378 过、`pnpm typecheck:tests`、`pnpm build`、`cargo test` 1112 过、clippy 无警告）。包打出来了；`pnpm tauri build` 以 1 退出只是因为本机没有更新签名的私钥。版本组和细节在 [spike 记录](../test/20261002-adr0047-spike.md)的「Pinned versions」。**没核的**：2.9.5 到 2.12.1 之间 `RunEvent::Opened` 和建窗口的改动没有比对。**真机（2026-10-02）**：J1a 和 J5 在试探包上都通过。J5 的 Esc 是你按的物理键（输入法 ABC），日志里 `ui.dialog.cancel` 和 `ui.dialog.escape` 两条都有，对话框关闭，标签仍在且未保存；其余点击和输入由 computer-use 完成。这与 D34 在 2.9.5 上的真机记录相同，停止条件没有触发；键盘行为只验了 Esc 这一处，其余留给 WI-004 的全旅程对照。真机跑出一处预测错误（打开文件不写 `tab.switch`），已在旅程文档里改正。逐行证据在 spike 记录的「Upgrade trial」。
  6. **读候选 A 的源码**（不构建）：取 `tauri-plugin-wdio-webdriver` 1.4.0 这个 crate 本身，列出它开的每个监听、每条能执行脚本或发输入的路由、恢复时重放脚本的逻辑。ADR 里标「二手」的几条由此变成 `[实测]` 或被推翻。若读完就能判定补丁超出维护预算，候选 A 直接记「S1 不过」，时间盒不启动。
- **Tests (first)**：无代码。
- **Dependencies**：第 5 条需要你做两次物理按键。
- **Estimate**：M（其中人工约二十分钟）。

### WI-001 构建入口与构建身份

- **Goal**：满足 R2 的一半：从正在跑的进程能得到一个标识，它等于「这棵工作区内容打出来的那次构建」。
- **设计**
  - **唯一的构建入口** `scripts/control/build.mjs`，参数是打包配置（`release` 或 `verify`）和 Cargo feature。发布流程照旧可以直接用 `pnpm tauri build`，那样打出来的 `buildId` 是 `unknown`。
  - **`sourceTree`**：用临时 index 对工作区做 `git add -A` 再 `git write-tree`，不动真正的 index。已跟踪和未跟踪（未被忽略）的文件都算进去。
  - **`buildId`** = `sourceTree`、打包配置、feature 集合、sidecar 二进制的 sha256 四者的摘要。入口经环境变量 `MDPRO_BUILD_ID` 交给 cargo；`build.rs` 声明 `rerun-if-env-changed` 并编进二进制。没有这个变量时是 `unknown`。
  - **构建清单** `build-manifest.json` 写在 bundle 旁边（不写进 `.app`，签名之后不再改包）：`sourceTree`、提交号、打包配置、feature、sidecar 摘要、`dist` 摘要、主程序摘要、版本组、`codesign -dv` 的摘要、`buildId`。
  - `verify` 配置用单独的 cargo 目标目录，避免两种配置互相覆盖对方的产物 `[推断]`。
  - `app.ready` 的 context 增加 `pid` 和 `buildId`（Q5）。只在日志开着时写，不改变日志开关的语义。
- **Acceptance**
  1. 同一棵工作区连打两次，`buildId` 相同。改一个已跟踪文件、再改成另一个样子、只改前端文件、加一个未跟踪的源文件、换 feature 或打包配置，这五种情况 `buildId` 各不相同。
  2. 不经入口直接 `pnpm tauri build`，二进制报 `unknown`。
  3. `app.ready` 的 `pid` 等于进程实际 pid；`buildId` 等于清单里的值。
  4. 清单和 `buildId` 里没有绝对路径、用户名、凭证。
  5. 先打 `verify` 再打 `release`，以及反过来：每个包内嵌的 `buildId` 都等于它自己的清单；`release` 包的 `dist` 摘要等于在干净目录里单独打的 `release` 包（没有产物串味）。
  6. `CHANGELOG.md` 的 `[Unreleased]` 记一条：发布版日志多了两个字段。
- **Tests (first)**
  - `tests/control/control-build-identity.test.ts`：在临时 git 仓库上跑 `sourceTree` 函数，覆盖第 1 条的五种情况，并确认真正的 index 没被动过。
  - `src-tauri/src/services/build_info_tests.rs`：变量缺失 → `unknown`；格式；不含路径。
  - `app.ready` 载荷构造函数的单测：`pid == std::process::id()`。
- **Touched areas**：新增 `scripts/control/build.mjs`、`scripts/control/sourceTree.mjs`；`src-tauri/build.rs`；`src-tauri/src/main.rs:240-250`；新增 `services/build_info.rs`；`package.json` 加脚本。
- **Risks + mitigations**
  - `MDPRO_BUILD_ID` 一变主 crate 就重编 → 只有内容真的变了它才变，这正是想要的。
  - sidecar 是拷进来的旧文件 → 它的摘要进 `buildId` 和清单；入口负责从同一棵树构建它（现有做法开工时核对）。
- **Rollback**：回退提交；发布流程不依赖入口。
- **Estimate**：M。
- **实施偏离（2026-10-02 写；1–8 条你 2026-10-08 已确认；与上面「设计」冲突处以这里为准）**
  1. **`sourceTree` 有排除清单**（修正 PD3）。默认排除 `.claude/`、`docs/`、`**/*.tsbuildinfo`，清单写进构建清单的 `sourceTreeExcludes`，并进 `buildId`。原因：这三类不进任何构建产物，却在每次会话里变，不排除的话 `buildId` 几乎每次都变。代价：排除目录里的文件若被构建引用，`buildId` 就看不见它的改动；由一条守卫测试挡住（构建输入不得指向被排除的目录）。
  2. **`sourceTree` 的算法**。临时 index 从空开始，不拷贝真正的 index；`git add -A` 按内容重新哈希所有未忽略文件；已跟踪但被忽略的文件从真正的 index 只读列出后强制加入。原因：拷贝 index 会带上 `assume-unchanged`、`skip-worktree` 标记和 stat 缓存，改动可能被跳过。结果只取决于内容、文件模式和路径。
  3. **`buildId` 不经 `build.rs`**。`option_env!("MDPRO_BUILD_ID")` 只写在 `tauri-app` 这个 bin（`main.rs`）里，lib 只接收参数。原因：Cargo 把 lib 链进每个 bin，变量放在 lib 或 `build.rs` 里会让 `mdpro_mcp` 跟着重编，sidecar 摘要随之不稳。**已实测（2026-10-03）**：cargo 追踪 `option_env!` 的变量值——只改变量重新链接 `tauri-app`（17 s），变量不变则无操作（0.46 s）；不必退回 `build.rs`。
  4. **`buildId` 是本机身份**，不保证跨机器相同：`sourceTree` 沿用你的 git 配置（含全局 `core.excludesFile`）。格式是 64 位小写十六进制的 sha256。
  5. **版本组的来源**。Rust crate 版本取自 `Cargo.lock`，JS 包版本取自 `node_modules/<包>/package.json`（装上的版本，而不是 `package.json` 里的范围）。
  6. **`verify` 配置在 WI-002 之前不可用**。入口在 `src-tauri/tauri.verify.conf.json` 不存在时明确报错退出；验收第 5 条随之移到 WI-002。
  7. **失败不留清单**。入口解析完参数先删掉该配置下旧的 `build-manifest.json`，任何一步失败都不会留下清单。
  8. **覆盖率**。`scripts/control/*.mjs` 原先不在 vitest 的 `coverage.include` 里（与 `scripts/ledger/*.mjs` 相同），新代码的覆盖率数字因此不存在。**你定的是纳入（2026-10-08，review L2）**：`vitest.config.ts` 的 `include` 加了 `scripts/control/**/*.mjs`；总量 L/F/B/S 由 73.96 / 80.97 / 91.42 / 73.96 变为 76.92 / 82.90 / 91.56 / 76.92，门槛 73/80/91/73 不变。没有单测的驱动脚本 `smoke.mjs` 按 0% 计入，是有意的。
- **状态（2026-10-08）**：**验收 1–6 全部了结；review（`.claude/tdd-guardian/review-20261003-050327.md`）的 L1、L2、Q1、Q2 和 Low 5/6/7/9 已收口，本轮改动已提交（`78c78e0`、`35c17f2`、`d6c1666`、`8026e37`、`0481bc7`）**。原提交 `e0eed13`、`35e266c`、`da046f1`；Low 5、6、9 和 Low 7 的措辞已在 `35e266c` 里。偏离 1–8 你 2026-10-08 已确认。Low 8（五个测试文件超 300 行）你定不拆，跳过。WI-001 本身不剩未结的验收项；ADR-0047 仍是 Proposed。收据 `ADR47-WI-3`（`buildId.mjs` 与 `tests/control/control-build-id.test.ts`，落在 `35e266c`）→ SEPARATION-BROKEN（2026-10-02）。高危项 spec-changed-under-green 指的是随机输入生成器里的一行 `sourceTree: str(r, HEX, ...(…))`：绿阶段为过 TS2556 改过，随后原样恢复，上方加一行 `// @ts-expect-error`，没有 `expect` 被改。2026-10-08 按插件的逐行指纹（0.10.2 `lib/verification.js` 的 `fingerprintFile`：去首尾空白、丢空行、sha256 取前 16 位）复核：2026-10-02T13:19Z 的 `ADR47-WI-13` 收据里，这个文件是红时 308 行原样加那一行注释，所以「原样恢复」成立（review-20261002-200447 当时说核不了）；判定那一刻这行被改成了什么，收据没存，查不到。提交版比红时还少两行，即 `genValid` 和 `mutate` 里的 `str(r, FEATURE_ALPHA, 1, 8)`（哈希逐字对上）。这是 WI-19 事先声明的生成器收窄（特征名不许以 `-` 开头，C4），发生在 2026-10-03，晚于这份收据的判定，`ADR47-WI-19` 收据为 HELD。另两条：weak-red 是插件解析不了 vitest 的 `| N todo` 后缀；implementation-already-present 的 7 个文件里，`scripts/control/buildId.mjs` 是本项实现，红时已在工作区（review Q2：红可能是导入失败而非断言失败，靠模块外算出的金值 T01/T02/T10 降级）；3 个 Rust 文件属 `ADR47-WI-1`（`e0eed13`），另 3 个是文档。review 把这份收据降为 Low 并豁免。
  - **review 收口（2026-10-08）**
    - **L1 集成 lane**：tdd-guardian 新增 `integration` lane（`gateOn: ["manual"]`，`coverage: none`），命令 `scripts/heavy-lock.sh node scripts/control/smoke.mjs`：真跑一次 `pnpm control:build --profile verify`，再由纯函数 `scripts/control/smokeChecks.mjs` 检查清单存在且 `updaterArtifacts:false`、`codesign -dvvv` 能解析且 cdhash 一致、bundle 旁边没有 `*.app.tar.gz` 或 `.sig`。`smokeChecks.mjs` 有 63 条单测（`tests/control/control-build-smoke-checks.test.ts`）。2026-10-08 真跑：exit 0，93 s，`=== 10 passed, 0 failed ===`，buildId `3480d8af…`（之后按 review 改了驱动：构建失败时 total 只计失败数，重抛信号前先设 exitCode 1）。反向检查：把真实 codesign stderr 里的 `CDHash=` 行删掉，`checkVerifyBundle` 报 `parseCodesign: missing or empty CDHash=`。**限制**：只跑 verify 配置，release 的 `--config` 路径没走到；`tauri.verify.conf.json` 自己就设了 `createUpdaterArtifacts:false`，清单里的 `updaterArtifacts:false` 又是常量（`manifest.mjs:180`），所以真正算证据的只有「目录里没有更新产物」这一条。
    - **L2 覆盖率**：见偏离 8。
    - **Q1 rust lane 包装**：`rust` 和 `rust-verify-run` 两条 lane 改为 `scripts/heavy-lock.sh node scripts/cargo-test-lane.mjs cargo test ...`。包装只在输出里有行首的 `test result: FAILED.`（去掉 ANSI 颜色后）时把 exit 101 改成 1；编译错误仍是 101，插件照旧读成 runner-error；其他退出码和信号原样透传。51 条单测（`tests/tooling/cargo-test-lane.test.ts`）。
    - **Q2 回执解析：豁免**。是插件缺陷，不在本仓库修，也不改插件缓存。
    - **Low 7 补全**：`sourceTree.mjs` 头注释的过度承诺改正（`mkdtemp` 在 try 之外，这一处拒绝不带仓库目录）。另给 `commentBlanker.mjs` 加了列出导入方的头注释，新增 `tests/control/control-comment-blanker.test.ts`（30 条）。
  - **上游备注（tdd-guardian 0.10.2）**：vitest 计数正则（`exec.js:97`）认不出摘要里的 `| N todo` 后缀，红灯因此记成 `opaque-failure`、没有计数（Q2）；cargo 计数只取第一处匹配（`exec.js:117`）；`UPGRADE_PATTERNS`（`exec.js:28-33`）会把 exit 1 的输出重新归类。后两条是 Q1 包装的已知边界。
  - **真机检查**（验收 1–4 于 2026-10-03 在 `release` 配置上跑，`pnpm control:build`；验收 5 于 2026-10-08）：
  - 验收 1 **通过**：同一工作区连打三次，`buildId` 相同（`216fb017…`），三份清单逐字节相同。五种变更情形由 `tests/control/control-build-identity.test.ts` 在临时仓库上覆盖，真机未重复。
  - 验收 2 **通过**：不带变量直接 `cargo build`，二进制重新链接，里面只剩 `unknown`。
  - 验收 3 **通过**：临时 `HOME` 下冷启动，`app.ready` 的 `pid` 等于进程 pid，`buildId` 等于清单；真实 `~/.mdpro/mdpro.log` 未增一行。
  - 验收 4 **通过**（清单与 `buildId`）：零处 home 路径、用户名、`/Users/`。入口转发的子工具输出（pnpm 横幅、cargo `Compiling … (<路径>)`、tauri `Built application at:`）含本机 home 路径，`redactPaths` 只管入口自己的消息。**你定的是不脱敏（2026-10-08）**：这些输出只到控制台，mdpro 不把它写盘；清单和 `buildId` 已证明不含路径。**附带说明**：tdd-guardian 插件（0.10.2，`exec.js:239-240`）保留一条 lane 最后 80 行 stdout 和 40 行 stderr，这些行会进 hook 消息和会话记录，但不进 `state.json` / `receipts.json`（2026-10-08 对这两个文件 grep `/Users/`，零命中）。
  - 验收 5 **通过**（2026-10-08，先 `verify` 后 `release` 互不串味）：打了三个包：本工作区 release、本工作区 verify、在干净检出 `verify-23e0007` 里单独打的 release。每个包内嵌恰好一个非零的 64 位十六进制 id，且等于它自己清单里的 `buildId`：分别是 `53534e1f…`、`f562a007…`、`3f2a3349…`。三个包的 `distSha256` 都是 `ea0388941b3e…`，`updaterArtifacts` 都是 `false`；每个 bundle 目录里只有清单和 `.app`。**附带说明**：两处检出的 release `buildId` 不同（`53534e1f` 对 `3f2a3349`），因为 `build.mjs` 每次重编 sidecar，它的 Mach-O `LC_UUID` 和 ad-hoc 签名差 48 字节；验收 5 只要求 `dist` 摘要相等，所以算通过。verify 和 release 共用同一个可变的 sidecar 文件 `src-tauri/binaries/mdpro_mcp-aarch64-apple-darwin`。
  - 验收 6 已做。
  - 观察：入口每次运行都把主 crate 编两遍（sidecar 用裸 `cargo`，应用在 tauri CLI 的 `TAURI_ENV_*` 环境下），什么都没改也要约 3 分钟；sidecar 摘要和 `buildId` 不受影响。临时 `HOME` 的 `config.json` 里 `mcp.serverEnabled: false` 生效：日志里 `mcp.http_server.start` 的 context 是 `{"outcome":"skipped","reason":"disabled"}`，服务没起。

### WI-002 验证打包配置与运行隔离

- **Goal**：满足 R1。你开着日常 mdpro 的同时，验证构建能独立冷启动；环境不对时它不启动。
- **设计**
  - **打包配置覆盖** `src-tauri/tauri.verify.conf.json`，由构建入口经 `tauri build --config` 合并 `[二手：Tauri CLI 文档，合并方式为 JSON Merge Patch]`：

    | 项 | 验证构建 | 理由 |
    |---|---|---|
    | `identifier` | `com.mdpro.app.verify` | single-instance 套接字、WebKit 数据、Launch Services 身份都跟日常版分开 |
    | `productName` | `mdpro-verify` | 包名和菜单栏上一眼能分清；数据目录名是代码里的字面量 `mdpro`，不受影响 `[实测 draft/paths.rs:12]` |
    | `bundle.fileAssociations` | `[]` | 不去抢 `.md` 的默认打开方式 |
    | `bundle.createUpdaterArtifacts` | `false` | 验证构建不产生更新产物 |
    | 更新地址 | 清空 | 验证构建不能把自己更新成正式版。清空后点「检查更新」的表现 `[推断]`，实测一次 |
    | 签名 | 与本机打的发布包相同（配置里没有签名段，即 ad-hoc `[推断]`） | 包是整体重新构建并签名的，不在构建后改 identifier |
    | sidecar | 同一个文件名，由构建入口从同一棵树构建 | 文件名跟目标三元组走，不跟 identifier 走 `[二手]` |

  - **Cargo feature `verify-run`**（默认关闭，Q10），只做三件事：
    1. **启动守卫**，`main` 的第一条语句，在 `app.launch` 日志和草稿迁移之前。校验不过就向 stderr 写一行并以非零码退出，不解析任何持久化路径。
    2. MCP 服务绑系统分配的端口，并写进运行目录下的 `server.port`。sidecar 本来就从这个文件读端口 `[实测 bin/mdpro_mcp/conn.rs:25]`。
    3. 把 `instance.json`（启动随机数、pid、`buildId`）写进运行目录。这是握手文件（PD4）。
  - **运行环境**由启动器设置，每条启动路径都传（直接执行；`open --env` 逐个传）：`HOME`、`CFFIXED_USER_HOME`（让 Cocoa 的路径也跟过来 `[推断]`）、`MDPRO_VERIFY_RUN`（运行目录）、`MDPRO_VERIFY_NONCE`。
  - **守卫校验的内容**：四个变量齐全；运行目录是绝对路径、不是符号链接、在约定的父目录下、权限 0700、属于当前用户；目录里有启动器写的 `launch.json` 且随机数一致；`dirs::home_dir()` 和 `dirs::data_dir()` 解析出来都在运行目录里。
  - **约定父目录（2026-10-03 定）**：`<真实 home>/Library/Application Support/mdpro-verify/runs`。按用户隔离、重启不清、在所有仓库和 `sourceTree` 之外、不随 `~/Documents` 同步。守卫跑的时候 `HOME` 已指向运行目录，真实 home 只能从 `libc::getpwuid_r` 取，因此直接依赖 `libc`（已在 `Cargo.lock` 里，记为偏离，不另写 ADR）。路径含用户名，所以日志和启动器输出只记运行目录的 basename。守卫在上面一行之外另加四条：父目录属主为当前用户且 0700；`CFFIXED_USER_HOME` 在运行目录内；`launch.json` 不是符号链接；`HOME`、`CFFIXED_USER_HOME`、`MDPRO_VERIFY_RUN` 各自等于自身的 `canonicalize()`（否则「不是符号链接」在 macOS 的符号链接式临时目录下无法成立，启动器相应传 realpath）。
  - **持久化清单与重置策略**

    | 状态 | 验证运行里在哪 | 重置 |
    |---|---|---|
    | 运行目录本身（`launch.json`、`instance.json`） | `<真实 home>/Library/Application Support/mdpro-verify/runs/<随机名>`，0700 | 不自动删，重启后仍在；只由 `clean <运行>`（WI-003）显式删，`doctor` 报告残留 |
    | 偏好、日志、草稿、旧草稿、MCP token 和端口文件、MCP 客户端配置 | 运行目录内 | 每次运行一个新目录 |
    | MCP 端口 | 系统分配 | 进程退出即释放 |
    | single-instance 套接字 | `/tmp/com_mdpro_app_verify_si.sock` | 进程退出后残留由 `doctor` 报告 |
    | WebKit 数据、Cocoa 缓存与窗口恢复状态 | 多半在真实 `~/Library` 下按 `com.mdpro.app.verify` 分开 `[推断]`，实测后写进记录 | **不重置**（Q11）。每份记录列出这些路径；结论可能依赖 web storage 的旅程记 NOT VERIFIED |
    | Launch Services 登记 | 系统级 | 验证包没有文件关联，不改默认打开方式 |

  - **一次一个运行**：约定父目录下有一把排他创建的锁，记着持有者的随机数。`launch` 在发任何文件参数之前先查三样：锁、有没有验证包的主程序在跑、套接字有没有活的监听。
  - sidecar：旅程不用它。将来要用，由启动器带着运行环境起它。
- **Acceptance**（在真实 `~/.mdpro` 存在的机器上）
  1. **路径解析**（主证据）：临时 `HOME` 下，3.2 表里每个跟 `HOME` 走的根目录都解析到该目录内。另有一条测试扫 `src-tauri/src` 里所有 `dirs::` 调用点，不在登记表里的调用点让测试变红。
  2. **守卫**：表驱动的单测覆盖每一种不合格的环境。真机上：双击验证包，或不带环境 `open -a` 它，进程退出，真实的 `~/.mdpro` 和 `~/Library/Application Support/mdpro` 下没有新增或改动的条目。
  3. **旁证**：日常 mdpro **关着**时，对真实的 `~/.mdpro`、`~/Library/Application Support/mdpro` 和四个 MCP 客户端配置文件取元数据清单（路径、大小、mtime，用 `stat`，不读内容）。隔离运行里做一遍「开夹具、编辑、等草稿落盘、改一项偏好、退出」，清单前后一致。
  4. 日常 mdpro **开着**时：隔离运行冷启动，窗口 `main`，`instance.json` 的随机数对得上。由人确认日常那个 mdpro 没有多出窗口或标签。
  5. 验证实例的 MCP 服务在 `server.port` 记的端口上应答；55045 的监听仍属于日常实例的 pid。
  6. 已有一个验证运行时再 `launch`：被拒绝；第一个实例的日志里没有新增 `file.open.external`。
  7. `verify-run` 关闭的构建不认这四个变量：端口函数恒为 55045，守卫的符号不存在。
  8. 验证包的 `Info.plist` 里没有 `CFBundleDocumentTypes`；由人确认 Finder 里 `.md` 的默认打开方式没变。
  9. WebKit 和 Cocoa 状态的实际落点写进记录，标 `[实测]` 和测的系统版本。macOS 13 没测就写没测。
  10. J1a 在改写了 `HOME` 和 `CFFIXED_USER_HOME` 的环境里能走通。若 `CFFIXED_USER_HOME` 让 webview 出问题，去掉它，并把因此留在外面的状态补进清单。
- **Tests (first)**
  - `src-tauri/src/services/verify_run_guard_tests.rs`（持 `HOME_LOCK`）：每一种不合格环境 → 拒绝；合格 → 通过；feature 关 → 不编入。
  - `src-tauri/src/services/http_server_port_tests.rs`：feature 关 → 55045；开 → 0，并发布实际端口。
  - `src-tauri/src/services/run_isolation_tests.rs`（持 `HOME_LOCK`）：第 1 条的根目录解析。
  - `tests/control/control-persistence-roots.test.ts`：`dirs::` 调用点登记表。
- **Touched areas**：`src-tauri/Cargo.toml`（`[features]`）；`src-tauri/src/main.rs`（首条语句）；新增 `services/verify_run.rs`；`services/http_server.rs`（`MCP_SERVER_PORT`、`app_controller_env`）；新增 `src-tauri/tauri.verify.conf.json`。
- **Risks + mitigations**
  - 独立 identifier 可能影响 Launch Services 对 `RunEvent::Opened` 的路由 → J1b、J7b 专门测这条路径。若走不通，**停下来问你**，不自动退回同 identifier（Q4）。
  - 改写 `HOME` 可能让 WebKit 的子进程异常 → 第 10 条。
- **Rollback**：回退提交。两个 feature 都默认关闭，发布版不受影响。
- **Estimate**：L。
- **实施偏离（2026-10-07；与上面「设计」冲突处以这里为准）**
  1. **直接依赖 `libc`**（你 2026-10-03 定）。`src-tauri/Cargo.toml` 加 `libc = "0.2"`，只给守卫取 `getuid` / `getpwuid_r`；版本早已经传递依赖进了 `Cargo.lock`，不另写 ADR。
  2. **变量的存在性检查有固定顺序**：`MDPRO_VERIFY_RUN` → `MDPRO_VERIFY_NONCE` → `HOME` → `CFFIXED_USER_HOME`，四个都查完才做路径检查。几个变量同时缺时，拒绝行报的总是顺序里第一个，所以表驱动测试的结果是确定的。
  3. **登记表多一个 scope `production-guard`**。守卫自己的 `dirs::home_dir()` / `dirs::data_dir()` 只读出解析结果来比对，不持久化任何东西，因此不给 `root`；这个 scope 只允许出现在 `services/verify_run.rs`，用在别处就是 `bad-entry`。守卫的调用在 `verify_run.rs`，不在 `verify_run_checks.rs`。
  4. **登记表的 `root` 可以是数组**。`commands/mcp.rs` 里一次 `home_dir()` 调用拼出四个 MCP 客户端的配置路径，所以这一条登记四个 root id。WI-8 的双射按 `production` 根 id 算，不按条目数算。
  5. **`GuardError` 不带字符串载荷**，只带 `Var` / `PathVar` 枚举。拒绝行和日志因此不可能带出路径、用户名或随机数。
  6. **多一个变体 `PasswdHomeNotAbsolute`**。`pw_dir` 若是相对路径，约定父目录就会相对 cwd 解析。这条分支在真机上造不出来，只经过评审，和 `PasswdHomeNotUtf8` 一样。
  7. **验证包的名字是常量 `mdpro-verify.app`**（`scripts/control/buildSteps.mjs`），不从覆盖配置的 `productName` 读。两边一旦不一致，构建就停在「没留下主程序」，而不是悄悄跟着覆盖配置走。
  8. **旧草稿迁移挪进 `services/draft/startup_migration.rs`**。守卫要做 `main()` 的第一条语句，`main.rs` 放不下，所以把迁移和它的 `app.draft_migration` 日志一起移出来；行为、顺序和日志行都没变。
  9. **保留 F5：参数错误什么都不动**。入口在参数解析失败时（包括用户自己传 `verify-run` feature）直接退出，不删旧的 `build-manifest.json`，所以旧清单可能留下来。WI-001 偏离 7 的「先删旧清单」是从参数解析成功之后才开始的。
  10. **WI3-T05 的夹具往上挪了一级**。现在在 `…/mdpro` 放普通文件，让 `create_dir_all` 失败，原来是在 `…/mdpro/drafts` 放。**这暴露了一个已有缺陷，本 WI 不修，只记录**：`…/mdpro/drafts` 是普通文件时，`ensure_dir` 的 `exists()` 检查能通过，接着 rename 报 ENOTDIR，却被静默跳过。启动迁移因此返回 `Ok(0)`，一行日志都不写，旧草稿留在原处。
  11. **tdd-guardian 的 rust lane 仍只跑 feature 关的构建**。`--features verify-run` 的 `cargo test` / `cargo clippy -- -D warnings` 回执是手工跑的，记在 `.claude/tdd-guardian/state.json` 的 ADR47-WI002-4…8 里。
  12. **覆盖率**。`scripts/control/persistenceRoots.mjs` 和 `rustScopes.mjs` 同 WI-001 偏离 8，原先不在 vitest 的 `coverage.include` 里。2026-10-08 起随 `scripts/control/**/*.mjs` 一并纳入：`persistenceRoots.mjs` L 99.45 / B 93.18，`rustScopes.mjs` L 97.77 / B 89.69。
  13. **握手文件从启动前守卫挪进 setup 钩子，「替换」改为「拒绝」，成功日志随之挪进发布**（2026-10-08，修下面状态里记的覆写缺陷；决定见 [ADR-0058](../adr/0058-a-verify-run-publishes-its-handshake-once-and-never-replaces-it.md)）。设计里「守卫写 `instance.json`」原来实现为 `main()` 首条语句里原子替换写入；同一运行里的第二个进程也跑这一段，于是先覆写、再被 single-instance 转走。现在：
      - **校验与发布分开**。`enforce()`（`src-tauri/src/services/verify_run.rs`）只做校验，仍是 `main()` 的第一条语句；不写文件、不写日志，不合格就向 stderr 写一行并以 78 退出。`publish_or_exit(&verified_run, BUILD_ID_RAW)` 是 Tauri `.setup` 闭包的第一条语句。插件的 setup 在 `build()` 里先于这个闭包执行 `[实测 tauri 2.9.5 app.rs:2291 对 1299–1302；插件锁在 2.3.7]`，所以 single-instance 的次进程在发布之前就已转发并 exit 0，主进程则先占下套接字。
      - **发布是排他的**。`publish`（`src-tauri/src/services/verify_run_instance.rs`）先写临时文件 `.instance.json.<uuid>.tmp`（`create_new`、0600、`write_all`、`sync_all`），再 `fs::hard_link` 到 `instance.json`，然后删临时文件。EEXIST → `GuardError::InstanceExists`（`instance.json already exists`），其他失败 → `InstanceWrite`，两者都以 78 退出。不覆写，也不跟随符号链接。只靠插件先跑不够：插件的 macOS 代码在 notify 出错、且错误不是 NotFound / ConnectionRefused 时照常启动 `[实测 插件 2.3.7]`，这样的进程会走到 setup。
      - **日志**：`app.verify_run` 的成功行只在链接成功后写；失败行的 `reason` 是 `instance_exists` 或 `instance_write`。
      - **门禁**：tdd-guardian 加了 `rust-verify-run` lane（`cargo test --manifest-path src-tauri/Cargo.toml --features verify-run`，提交时跑），偏离 11 的「feature 开靠手工回执」到此为止。`rust` lane 仍是 feature 关，因为 `wi6_t01`（发布版端口 55045）只在 feature 关时成立。
      - **代价**：被拒的进程已经写过 `app.launch`、在运行目录里跑过草稿迁移，还可能闪一下窗口；setup 里的 `exit(78)` 跳过 `RunEvent::Exit`，si.sock 留下，下一次启动遇到 ConnectionRefused 时清掉；若一个漏过插件的次进程抢先发布，启动器自己起的子进程会以 78 退出（往拒绝一侧失败）。
- **状态（2026-10-08）**：**已验证，但真机发现一处缺陷；修复已写完、单测与提交门禁（unit / rust / rust-verify-run）都过、修复后真机复测 R1–R4 过（2026-10-08，真机记录 §3），与 ADR-0058 一起提交（修复 `23e0007`，ADR `c345a75`）**。验收 6 延到 WI-003。复测用的是提交前的工作区，`23e0007` 本身没有再打包上真机；验收 7 的 release 包 `nm` 未做（可选）；R3 窗口是否闪现未观察。原提交 `678b320`、`4390665`、`186910b`、`d455e02`、`e36c63a`；真机记录 [`docs/test/20261007-adr0047-wi002-device.md`](../test/20261007-adr0047-wi002-device.md)。原门禁情况：unit lane 过；`cargo test` 和 `cargo test --features verify-run` 都过，`cargo clippy -- -D warnings` 两种都过。
  - **缺陷（2026-10-07 真机实测，记录 § 2）**：同一运行里起第二个进程（J7a），它重跑启动前守卫，把 `<RUN>/instance.json` 的 pid 从 36009 改成 36146，再经 single-instance 把参数转给主实例（日志 `file.open.external`，路由 `broadcast`），然后 exit 0。`instance.json` 于是指向一个死 pid，WI-003 的 `quit` 和 `--via open` 握手会因此出错。
  - **修复**：见偏离 13。
  - **测试证据**：新增 `verify_run_publish_*.rs`，重写 `verify_run_instance_tests.rs`——t03 回归重现、拒绝规律、并发下只有一个赢家、EFBIG 的 exec 用例、`publish_or_exit` 的 exec 测试；vitest 结构测试 `tests/control/control-verify-run-publish-structure.test.ts` 和 `tests/control/control-verify-run-wiring.test.ts` T15(c)/T17/T18。`cargo test --manifest-path src-tauri/Cargo.toml --features verify-run` 1201 过，vitest 4817 过。
  - **评审延后两项（你 2026-10-08 定）**：「同一运行目录上两次启动 app 二进制」的端到端检查，由修复后的真机复测（R2 / R3，已过，但是直接执行二进制，不是经启动器）和之后 WI-003 的旅程 lane 覆盖；`app.verify_run.temp_cleanup` 的 warn 分支没有生产代码里的故障接缝就测不到，免测。
  - **交给 WI-003**：
    - 每次 `launch` 用新的运行目录，**不要预建 `instance.json`**——发布是排他的，预建就是自己拒绝自己。
    - `doctor` / `clean` 要处理残留的 `.instance.json.*.tmp`（临时文件清理失败时留下），以及被 `exit(78)` 留下的 si.sock。
    - debug 的 verify 构建会把日志行回显到 stderr，排在拒绝行之前。启动器要么取 stderr 的**最后一行**，要么只支持 release 构建。**这是 WI-003 要定的事**。
  - 验收 1 **单测通过**：`run_isolation_tests.rs` 在临时 `HOME` 下把登记表里的每个 `production` 根都解析到该目录内（feature 关、开各 6/6）。`tests/control/control-persistence-roots.test.ts` 让登记表和 `src-tauri/src` 里的 `dirs::` 调用点完全相等。
  - 验收 7 **单测通过**：feature 关时端口恒为 55045，守卫的符号不编入（`http_server_port_tests.rs`、vitest 接线测试）。release 包上的 `nm` 没做。
  - **真机通过**（macOS 26.3.1，`e36c63a` 构建的 verify 包）：D-WI2、2、3、4、5、10。真实目录的元数据清单在每一步前后都一致。
  - 验收 8 **通过，附偏离**：`Info.plist` 里 `CFBundleDocumentTypes` 是空数组，不是不存在；Launch Services 不把它列为 `.md` 的候选，默认打开方式没变。
  - 验收 9 **[实测] macOS 26.3.1**：WebKit 数据与缓存都在运行目录内，真实 `~/Library` 下没有 `com.mdpro.app.verify` 的条目，也没有 Cocoa 偏好或 saved state。**macOS 13 没测——你的决定（2026-10-07）**。
  - 验收 6 **未验证**：要用启动器在已有运行时再 `launch`，WI-003 之前没有启动器。转到 WI-003 的验收里一并跑。（2026-10-09 更新：**已真机验证**，2026-10-09 WI-003 真机 Check B：运行活着时再 `launch` 退出 1、被拒，不建运行目录，第一个实例日志里没有新增 `file.open.external`。记录 [`docs/test/20261009-adr0047-wi003-device.md`](../test/20261009-adr0047-wi003-device.md) §1。）
  - **推翻的假设**：启动器写偏好夹具时不能只写部分字段——`UserPreferences` 有必填字段，部分文件整份解析失败，设置页全报错。WI-003 的夹具要写完整的一份。
  - WI-001 验收 5（先 `verify` 后 `release` 互不串味）本轮没跑，仍开着。

### WI-003 最小启动器

- **Goal**：满足 R2 的另一半和 R8。没有驱动也能安全地起、认、停一个验证运行。WI-004 的升级前后对照和 spike 都用它。
- **命令**（`scripts/control/`，后面在 WI-011 扩成完整 CLI）
  - **`doctor`**：包在不在；清单在不在；`buildId` 不是 `unknown`；清单的 `sourceTree` 等于此刻工作区的 tree 哈希；打包配置是 `verify`；有没有残留的运行目录、锁、进程、套接字（指出是哪次运行，不删）；列出运行目录之外的状态路径。每项一行结论，任一失败则非零退出并说下一步怎么做。
  - **`launch`**：过 `doctor` 和「一次一个运行」→ 在约定父目录下建运行目录（随机名、0700；路径长度留够 Unix 套接字的 104 字节上限）→ 写偏好夹具（日志开、自动保存取下限）和 `launch.json`（随机数、预期 `buildId`、主程序的真实路径）→ 直接执行包内主程序，保留子进程句柄 → 等 `instance.json`，要求随机数、`buildId`、pid 三者都对 → 记下进程启动时间。`--via open` 走 Launch Services，没有句柄，pid 取自 `instance.json`，再用启动时间和可执行文件路径核对。
  - **就绪分三级**，`launch` 的返回值说明到了哪一级：L1 进程身份（握手文件）；L2 通道已鉴权可用（WI-009 起）；L3 各窗口的前端就绪（WI-010 起）。本工作项只到 L1。
  - **启动失败**：超时或握手对不上 → driver failure。有句柄的子进程由启动器结束；没有句柄的只报告，不杀。锁释放，运行目录保留。
  - **`quit`**：四项全对才动手——`launch.json` 与 `instance.json` 的随机数一致；pid 还活着；`ps` 报的启动时间等于记录；可执行文件的真实路径等于记录。任何一项对不上就拒绝，报告是哪一项。然后发 SIGTERM，宽限期后 SIGKILL，结果里写明用了哪个。它不经过退出守卫；要测退出守卫，那是 `native` 或 `human` 步骤。
  - **`clean <运行>`**：只在这些都成立时删目录——没有活着的自有进程；真实路径在约定父目录下；本身不是符号链接；属于当前用户；权限 0700；里面有启动器写的 `launch.json`。删除时不跟随符号链接。`quit` 默认不删（PD6）。
- **Acceptance**
  1. Trap 3 重现：起旧包 → 不杀 → 重新构建 → `launch`。结果是拒绝（已有运行）或 `buildId` 不符，不是通过。
  2. Trap 2 重现：改一个源文件不重新构建，`doctor` 报 `sourceTree` 不符。
  3. pid 复用：记录里的 pid 换成一个无关的活进程，`quit` 拒绝。
  4. 运行目录被换成符号链接、或挪到约定父目录之外，`clean` 拒绝。
  5. 所有输出里没有 token 和随机数的原文。
  6. 用启动器把 J1a、J1b、J7a、J7b 的 `launcher` 步骤走一遍，握手和日志都对。
- **Tests (first)**：`tests/control/control-launcher-*.test.ts`——`doctor` 各检查项（临时目录）；所有权判定的四项各自单独失败；`clean` 的每个拒绝条件；锁的排他；启动超时的清理路径；输出里无凭证。进程表和 `spawn` 在边界处 mock，所有权判定本身不 mock。
- **Touched areas**：`scripts/control/`（`doctor.mjs`、`launch.mjs`、`quit.mjs`、`clean.mjs`、`ownership.mjs`、`runDir.mjs`）；`package.json` 加四条脚本（2026-10-08 更正：不是一条）：`pnpm control:doctor`、`pnpm control:launch`、`pnpm control:quit`、`pnpm control:clean`，各自是 `node scripts/control/<动词>.mjs`，与 `pnpm control:build` 并列。每个文件不超过 300 行。
- **来自 WI-002 的约束**：新运行目录、不预建 `instance.json`、`doctor` / `clean` 处理残留临时文件和 si.sock、stderr 取哪一行——见 WI-002 状态里的「交给 WI-003」。
- **Risks + mitigations**：`ps` 的启动时间精度只到秒 → 与可执行文件路径、随机数一起用，不单独作数。
- **Rollback**：回退提交；纯脚本。
- **Estimate**：M。
- **偏离**
  1. **加了 `launch --into <运行> [--via open] <文件>`（你 2026-10-08 定，D1）**。J7a / J7b 要往一个**活着的**运行里再起一个进程，原四条命令做不到。`--into` 先按 `quit` 的四项核对所有权，不碰 `.lock` 和 `owner.json`，不建运行目录；直接执行时要求第二个进程 exit 0。不带 `--into` 的 `launch` 只要有运行活着就拒绝（WI-002 验收 6）。
  2. **残留的锁一律拒绝，只由 `clean` 清（你定，D2）**。`launch` 遇到 `.lock` 不论活的还是陈旧的都拒绝，不自动接管、不自动清；`doctor` 指出是哪次运行和下一步。评审后补：运行目录已被手删而锁仍指向它时，`clean <运行>` 在扫描为空、套接字不活时释放这把孤儿锁（`clean: absent R; released orphan lock`）；没有任何运行目录时，`clean` 用任意不存在的运行名也能清掉陈旧的 si.sock，`doctor` 的提示照此给出可执行的命令。否则一把孤儿锁会让以后的 `launch` 全部被拒，无路可走。
  3. **偏好夹具的模板入库（你定，D3）**：`scripts/control/presets/verify-preferences.json`，完整的一份 `UserPreferences`。Rust 侧 `preferences_verify_preset_tests.rs` 在普通 `rust` lane 里把它反序列化，字段一变就红。每次运行的 `config.json` 仍是生成的，不入库。偏离 §10。
  4. **路径预算是 103 字节，量真实路径**。si.sock 的完整路径要放进 104 字节；运行名 25 字节，算下来家目录的真实路径不能超过 22 字节（`/Users/jackcheng` 是 16）。超了 `launch` 拒绝，不截断。
  5. **stderr 取哪一行（WI-002 交来的）**：取以守卫前缀开头的**最后一行**，debug 构建回显的日志行不影响；没有这样的行就报 `unknown`。不限定 release 构建。
  6. **所有权核对是五项，不是四项**：随机数、pid（`owner.json` 与 `instance.json` 一致且是正的安全整数）、活着、启动时间、可执行文件真实路径。`quit` 在 SIGKILL 之前再核一次启动时间和可执行文件，变了或读不出就不杀、不释放锁。
  7. **`clean` 不写 `launcher.jsonl`**（与日志规则 20 有出入）。它删的正是这个文件所在的目录；结果只在 stdout 的结论行里。
  8. **删除次序**：`clean` 先核锁，再删运行目录（`launch.json` 最后删），删完才释放锁。中途失败时 `launch.json` 和锁都还在，下一次 `clean` 能重新证明所有权并重试。
  9. **`--into` 要证明文件送到了（WI-R3，2026-10-09 真机 Check D 发现）**：偏离 1 原写「直接执行时要求第二个进程 exit 0」，真机证明 exit 0 不够——`--into --via open` 用的 `open -n` 起一个新实例，文件作为打开文档事件给了新实例，新实例经 single-instance 只转交空参数（`file.open.args_filtered {accepted:0}`）就退出 0，启动器报 pass 而文件没到。改为：`--into --via open` 的 `open` 不带 `-n`（`--env` 照带，竞态下冷启动仍关在运行目录里）；冷启动 `launch --via open` 仍带 `-n`。`--into` 带文件时，除 exit 0 外还要在运行自己的应用日志里、spawn 前的偏移之后、`handshakeTimeoutMs` 之内出现 `file.open.external` / `success` 且 `filePath` 是该文件（真实路径或原样）的一行，否则 `fail — into: file not delivered within <ms> ms`，不杀任何进程。
- **状态（2026-10-09）**：**已验证。真机验收跑过一轮（`69dd5d9`，2026-10-08 23:24 起跑、2026-10-09 08:53 结束），Check D 假通过；修复 WI-R3（`92e3902`）2026-10-09 真机复测 D 通过，A、C 回归通过，负例 D2（送不到的文件）报 `fail`**。真机记录 [`docs/test/20261009-adr0047-wi003-device.md`](../test/20261009-adr0047-wi003-device.md)。
  - **复测（2026-10-09，mini，macOS 26.4，`92e3902` 构建的 verify 包，`buildId` `2076e34b…78695`，报告 `~/.mdpro-redesign/dtrack/reports/20261009-wi-r3.md`）**：D `--into --via open b.md` → `file delivered (source finder)`，日志 `file.open.external`（`appReady:true`）→ `file.open.route` `new-window` → success，`b.md` 在第二个窗口；没有 `app.launch` 行、只有一个验证进程、`instance.json` 摘要不变。D2 `--into --via open c.txt` → `verdict: fail — into: file not delivered within 15000 ms`，exit 1，属主进程还活着（Launch Services 没把 `c.txt` 交给 app，app 日志没长）。A、C 回归通过（C 报 `file delivered (source single_instance)`，路由 `existing-window`）。收尾 `quit` / `clean` / `doctor` 都过，证据里没有随机数，真实目录清单不变。没覆盖到的：日常 mdpro 当时没开；评审 M2（同 bundle id 的另一份验证包可能收走文件）没测；pnpm 在失败结论之后多打一行 `ELIFECYCLE`，读结论要取启动器自己的最后一行。
  - **第一轮（2026-10-08 23:24 起跑、2026-10-09 08:53 结束；预检和 A 的 `launch` 在 10-08 23:24–23:25，之后被 Computer Use 权限弹窗挡了约 9 小时，A 的截图和 B–J 在 10-09 08:48–08:53；mini，报告 `~/.mdpro-redesign/dtrack/reports/20261008-wi10.md`）**：A 直接启动、B 已有运行时再启动被拒（WI-002 验收 6：不建运行目录，第一个实例日志没有 `file.open.external`）、C `--into` 同一文件、E pid 复用 `quit` 拒绝（`ownership: startTime, exe`）、F 真 `quit` / 残留 si.sock / `clean`、G `--via open` 冷启动、H 运行活着时重打后 `launch` 被拒、I 改源码不重打 `doctor` 报 `sourceTree` 不符、J 输出无随机数，都过；D 假通过（偏离 9）。另记：`doctor` / `launch` 探 si.sock 时活着的应用会记一行 `file.open.args_filtered {accepted:0}`（不打开文件，可能把窗口带到前台；低风险，未改）；H 的重打与原包逐字节相同，「`buildId` 不符」没在真机上触发；应用退出时日志里没有关闭行。WI-R3：新测 `tests/control/control-launcher-into-delivery.test.ts`（27 例），分离保持；LI-01、LI-04、LA-INT-2 原先把「exit 0 即过」写进了断言，改为假进程写一行送达日志后仍是成功用例，你 2026-10-09 接受，理由记在 `receipts.json`。WI-R3 提交 `92e3902`；提交门禁 unit（371 个文件，5427 过）、rust（1155 过）、rust-verify-run（1204 过）都过，slow lane 34 过；覆盖率 L 80.31 / F 84.32 / B 92.53 / S 80.31。终审「通过，附说明」（`.claude/tdd-guardian/review-20261009-wi-r3.md`）：过时的注释已改；未改的跟进项（仍开着，真机复测不涉及）——M1 慢测桩只走「原样路径」分支；M2 `open` 不带 `-n` 会把文件交给同 bundle id 的任一进程（日常 mdpro 的 id 不同，只有另一个验证包会抢；抢走时送达检查报 `fail`，但文件开在运行之外）；L4 未规范化的路径可能误判失败；L6 日志里的 `source` 未过滤就打印；L9 测试注释重复、L10 放宽的快照不再查日志只追加；缺测「退出与送达贴着共同时限」和「`--via open` 带相对路径」。
- **原状态（2026-10-08）**：**可自动化部分已完成，真机验收（下面 WI-10）待做**。tdd-guardian 全流程：设计测试后对抗两轮、缺口全补；WI-1–WI-9 加评审修复 WI-R1、WI-R2 全部完成；终审第一轮要求修改，修完复审「通过，附说明」。提交门禁 unit（370 个文件，5400 过）、rust（1155 过）、rust-verify-run（1204 过）都过；覆盖率 L 80.19 / F 84.28 / B 92.50 / S 80.19，`scripts/control/` 下启动器每个文件分支覆盖都 ≥ 91%。`slow` lane（真实进程的 LA-INT、QU-INT）未在门禁里跑，推送前跑。
  - **规格分离**：8 项保持；WI-6、WI-7、WI-8 的测试辅助代码在红之后改过（环境快照的比较方式、目录 mtime、APFS 目录大小），你 2026-10-08 接受，理由记在 `receipts.json`；WI-R1 只改了两行测试文件头注释并已逐字恢复，理由已记，你可否决。
  - **验收 2、3、4、5 单测通过**：`sourceTree` 不符时 `doctor` 非零退出；记录里的 pid 换成无关活进程时 `quit` 拒绝并指出哪一项；运行目录是符号链接或不在约定父目录下时 `clean` 拒绝；所有输出（stdout、stderr、`launcher.jsonl`）里没有随机数原文。
  - **验收 1、6 和 WI-002 验收 6 未验证**：要真机包。按 tdd-guardian 计划的 WI-10 记到 `docs/test/` 的新真机记录里。（2026-10-09 更新：WI-002 验收 6 与验收 1 真机已过；验收 6 的 J7b 等 WI-R3 真机复测，见上面的状态。）（2026-10-09 再更新：**都已真机验证**。验收 1（Trap 3，拒绝理由是已有运行）、WI-002 验收 6、验收 6 的 J1b / J7a 在 2026-10-09 过，J1a 2026-10-08 启动、2026-10-09 截图；J7b 在 2026-10-09 WI-R3 复测过。验收 4 仍只有单测。记录 [`docs/test/20261009-adr0047-wi003-device.md`](../test/20261009-adr0047-wi003-device.md)。）
  - **评审留下的低风险项（不阻塞）**：`launch` 先占锁后建目录，两步之间的 `clean R` 会释放活的锁（窗口是两次同步调用）；`clean` 删到最后一步、删空目录失败时，下一次 `clean` 证明不了所有权，要手动 `rmdir` 后再 `clean`；`owner.json` 的 pid 被篡改成非正整数时 `doctor` 说去 `clean`，`clean` 却拒绝；`clean.mjs` 288 行，再加东西前先拆。
  - 提交：运行目录布局与偏好模板 `83a35b0`；启动器、评审修复与本状态段在其后紧接的一次提交里（同一提交更新状态，SHA 见 `git log`）。

### WI-004 Tauri 升级到钉死的一组版本

- **Goal**：升到 WI-000 试探定下的那组版本，功能不变。
- **Acceptance**
  1. lock 文件里的版本等于那一组；`eval_with_callback` 在该版本存在；`@tauri-apps/api` 在 lock 里若仍有两份，写明是谁带进来的。
  2. `pnpm test:run`、`pnpm build`、`pnpm typecheck:tests`、`cd src-tauri && cargo test`、`pnpm coverage`、`pnpm ledger:check` 全绿，覆盖率不低于现有阈值；`cargo clippy` 没有新增告警。
  3. ~~升级前、升级后各用构建入口打一个 `verify` 包（驱动关），由人经启动器手工走全部旅程。两次的语义投影相等。~~
     **改为（2026-10-14，用户：「需要我手动测的到时候发给我」，回答「哪些可全自动、哪些必须人手、尽量减少手工项」的分法）**：升级前、升级后的 `verify` 包（驱动关）都由 dtrack 经启动器走全部旅程，`cli` 与 `native` 类的步骤由 computer-use 完成，两次的语义投影相等；`human` 类步骤（J5 的物理 Esc）并入第 4 条的人工那一次。升级前一侧的 `human` 步骤引用 D34、D41 已有的真机记录与 v0.3.3 的那一轮，不重测。其余真机项同样不要人：快速连开（经 SSH 循环 20 次，失败条件为出现两个各有窗口的 `tauri-app` 进程）、从 Finder 打开（`open -a`，冷启动与运行中各一次）、菜单快捷键（复用快捷键矩阵 brief，与 v0.3.3 那一轮逐项对比）、退出前保存提示（菜单「退出」）、本地图片、全屏；更新路径分两步：发布前用 updater 2.9 的校验逻辑离线验新签名，发布后由 dtrack 从 0.3.3 走一次更新。
  4. 物理按键回归：D34（Esc 关闭 `ConfirmDialog`）和 D41（Source 表格里的 Tab）在升级后的包上由人重测，结果与各自的验收记录一致。
     **人工的那一次（2026-10-14 起，只此一次，约 15 分钟，在升级后的包上）**：中文输入法组字并在组字中按一次 Esc；D34 的物理 Esc（同时算 J5 的 `human` 步骤）；D41 的 Tab；有未保存内容时按物理 ⌘Q，保存提示弹出。清单由 delegator 转给用户。
  5. 这个提交只含依赖变更和 API 适配。
- **Tests (first)**：没有可以先写的新测试。防线是现有两条车道加第 3、4 条的人工对照。升级若迫使某处改代码，那处先补测试再改。
- **Touched areas**：`src-tauri/Cargo.toml`、`Cargo.lock`、`package.json`、`pnpm-lock.yaml`；若 API 有变，调用点。
- **Risks + mitigations**：wry、tao 升级会改变 WKWebView 的键盘、焦点、IME 行为，而近期修掉的缺陷正好在这些地方 → 第 4 条；WI-000 的试探已经提前看过一遍。
- **Rollback**：回退这一个提交。
- **Estimate**：M。
- **结果（2026-10-14，adr047-verify，代码完成、真机未验；分支 `chore/adr47-wi004-tauri-upgrade`，按 delegator 裁定在 v0.3.3 发布后合入、单独发版）**：lock 与 spike 记录的钉死表逐项相等（tauri 2.12.1、tauri-build 2.7.1、wry 0.57.0、tao 0.37.1、single-instance 2.5.2、updater 2.13.1、process 2.4.0、opener 2.7.0、`@tauri-apps/api` 与 `cli` 2.12.1），`@tauri-apps/api` 在 lock 里只剩一份。`eval_with_callback` 在 2.12.1 存在（`webview/mod.rs:2185`、`webview_window.rs:2584`）。源码与 `Cargo.toml` 未改。源码对读（只读）发现两处真实变化，都进真机项：single-instance 2.5.2 把套接字的 bind 挪进异步任务（`platform_impl/macos.rs:100`），冷启动后极短窗口内的第二次启动可能成为第二个主进程（verify 构建由 `instance.json` 的排他链接挡住，普通构建挡不住）；原生菜单 muda 0.17.1 → 0.20.0，快捷键解析重写。updater 2.9 客户端只读 `darwin-*` 键，新签名的 trusted comment 多一个它不解析的 `version:` 字段，所以 0.3.x 仍能更新；发布脚本不需改，但 build-only 运行要确认产物文件名。
- **真机第一轮（2026-10-15，dtrack，`a6131ec`）**：A1、A2、A4、A5（重跑）、A6 通过；A3 快捷键 94 行里 93 行与 v0.3.3 相同，F2 不同：⌘⇧N 开出的窗口没有 `window.focus`。原因是我们的接线有竞态（v0.3.3 也有，只是赢了），登记为 [D217](20260912-frontend-backend-sequencing-order.md#d217)，修在本分支的第二个提交：焦点改由 `app.run` 记录。WI-004 因此不再是「源码未改」：`main.rs` 与新的 `services/window_focus.rs` 有改动。真机复查 F2 与一次外部打开，等新的 mini 包。
- **落地（2026-10-15，delegator）**：`df2a879`（依赖钉死）+ `9940be9`（D217）经 PR #443 快进到 `master`；verifier PASS，审计 b130 C0/H0/M1，CI 绿。真机：F2 复查 R1 对照 3/3 复现、R2 5/5、R3、R4 通过；A7 第 5 部分 33 段语义投影相等（第 3 条）；A8.1 更新签名离线校验通过；第 4 条的人工那一次：D34 物理 Esc、D41 Tab 由用户按过，通过；⌘Q 保存提示按用户要求由 dtrack 脚本按键代按，通过；中文输入法组字中 Esc 不取消，v0.3.3 同样如此（TextEdit 对照会取消），不是升级回归，登记 [D219](20260912-frontend-backend-sequencing-order.md#d219)。记录：[`docs/test/20261015-wi004-tauri-upgrade-device-check.md`](../test/20261015-wi004-tauri-upgrade-device-check.md)。

### WI-005 两个构建与人工基线

- **Goal**：spike 的对照组备齐。
- **Acceptance**
  1. ~~两个 `verify` 包：**基线头**（含 WI-001–004），和**回退构建**（基线头上回退 `c39dfb1` 的四个 `src/` 文件）。两个包都打开 Tauri 的 `devtools` feature：S2 四项记录里的 DOM 焦点和「哪个窗口收到按键」要靠 Web Inspector 里装的被动记录器读（规程见旅程文档），release 配置的包默认没有它。这一条差异写进 spike 记录的「Builds」。选型之后的包（WI-009 起）不开，改由固定探针读。这四个文件之后没有再被改过 `[实测 git log]`。回退构建只用于 S2，不合入、不跑门禁：D34 的测试在它上面会失败，这是预期的，记在 spike 记录里。~~
     **改为（2026-10-15，[ADR-0100](../adr/0100-the-s2-negative-control-is-a-minimal-confirmdialog-patch.md)，用户选「Minimal ConfirmDialog patch (Recommended)」）**：「这四个文件之后没有再被改过」到 2026-10-15 已不成立（`c39dfb1..9940be9` 里 10 个提交改过它们，`useDialogEscape` 还被 D140 的两个对话框共用）。回退构建改为基线头上只给 `ConfirmDialog` 打一个约 10 行的补丁：去掉它的 `useDialogEscape` 注册，换回 D34 之前挂在 backdrop 上的 `onKeyDown` Escape。补丁不提交、不推送，全文写进 spike 记录的「Builds」。`devtools` 两个包都开，用 mini 工作树里未提交的一行 `devtools = ["tauri/devtools"]`（delegator 2026-10-15 裁定；随 WI-006 的第一个提交正式加入），差异照样写进「Builds」。
     **补记（2026-10-16，[ADR-0113](../adr/0113-the-s2-control-takes-focus-out-of-the-dialog-with-one-backdrop-click.md)，用户选「1. Click backdrop, then Esc (Recommended)」）**：按原协议（焦点在 `Keep editing`，卡片内）跑出来两个包都关，对照不成立，S2 作废（spike 记录「Negative control」）。对照补丁不变，协议加 J5 第 2a 步：Esc 前用 computer use 在暗色 backdrop 上点一次，让焦点落到 `<body>`；记录器显示 `inDialog:false`、`active` 以 `BODY.` 开头（macOS 上是 `BODY.tauri-macos`） 的 Esc 才算数。比较一、二已通过，不重跑。
  2. 人在两个包上各做一次 J5 的物理 Esc，四项记录齐全。这一步在装任何驱动之前做，为的是先确认负对照成立，再花 spike 的时间。预期：回退构建上对话框不关，基线头上关。`ConfirmDialog` 的确认按钮带 `autoFocus`，所以回退构建上的结果必须实测，不能假定。**回退构建上若关了，S2 作废，spike 暂停，回来重新设计负对照。**
     **人工部分（2026-10-15，用户选「Only physical Esc, ~12 min (Recommended)」）**：人只按物理 Esc——两个包上 J5 第 3 步各一次，比较二里 release 包上 J5 第 3 步一次；比较一与比较二的其余步骤由 dtrack 经 computer use 走，与 WI-004 第 3 条 2026-10-14 的分法相同。
  3. **比较一**（驱动的影响）：人经启动器在基线头（`control-channel` 关）上手工走全部旅程，语义投影存档。与 WI-004 第 3 条的升级后记录是同一棵树时（`buildId` 相等）直接复用。
  4. **比较二**（打包配置的影响）：人在 `release` 配置的包上手工走 J1a、J2、J5，启动时把 `HOME` 指到临时目录，**日常 mdpro 关着**（同一个 identifier 和端口）。与比较一的同名旅程对比语义投影。差异逐条写进记录。
- **Tests (first)**：无代码。
- **Dependencies**：需要你本人到场，约四十分钟。
- **Estimate**：S。

### WI-006 候选 A：`tauri-plugin-wdio-webdriver`

- **Goal**：按 S1–S6 的顺序检验，失败即停。时间盒两个工作日（Q1）。WI-000 第 6 条若已判定不过，本项不启动。
- **位置**：`mdpro-wt/chore-d30-spike-wdio`，分支 `chore/d30-spike-wdio`。不合入（PD1）。
- **Acceptance（即各关的通过标准）**
  - **S1**，五项全过才算过：
    1. 能在 `control-channel` 这一个默认关闭的 feature 后面打出 `verify` 包；它开的每个监听满足 R4。套代理不算。
    2. 从钉住的 crate 源码列出每条能执行脚本或发输入的路由，逐条验证没有凭证就被拒绝。
    3. 没开 `eval` 时，任意脚本在每条这样的路由上都被服务端拒绝（R10）。WebDriver 的点击和按键内部也走脚本执行，所以这一项实际问的是：把任意执行路由关掉之后，固定命令还能不能用。
    4. 至多一次（R9），用注入的故障测：响应丢失、完成延迟、连接断开、请求重复。每种情况下，一个有计数效果的操作（J4b 的复选框，看 `preferences.set` 的 start 条数）只发生一次。
    5. 结果契约：请求带关联 id；结果是统一的成功或错误信封；Promise 完成才算完成；超时给 unknown outcome；迟到的结果被丢弃。
    需要的补丁行数记下来，对照维护预算（Q2）。能力文件若需要，确认能做到只在 feature 构建里存在。
  - **S2**：spike 分支上打两个带驱动的包：spike 头，和 ~~spike 头上回退 `c39dfb1` 的 `src/` 部分（ADR-0047 决定 4 说的就是这两个）~~**改为（2026-10-15，[ADR-0100](../adr/0100-the-s2-negative-control-is-a-minimal-confirmdialog-patch.md)）**：spike 头上打 WI-005 用的同一个 `ConfirmDialog` 补丁（`wi005-br-confirmdialog.patch`，全文在 spike 记录的「Builds」；不提交、不推送）。人先在这两个包上各按一次物理 Esc（驱动编入、通道开着、不发输入），结果须与 WI-005 的基线相同；不同就说明驱动本身改变了键盘行为，S2 记不过。然后驱动各发一次 Esc（J5），结果与人工基线一致——回退构建上不关、spike 头上关。四项记录齐全。**2026-10-16 起**（[ADR-0113](../adr/0113-the-s2-control-takes-focus-out-of-the-dialog-with-one-backdrop-click.md)）：人工和驱动的每次 Esc 前都先做 J5 第 2a 步（点一次 backdrop），「不先聚焦对话框」按此理解。
  - **S3**：J2、J3、J4a、J4b 全部走通，以磁盘内容和日志为准。J4b 开设置那一步是 `native`，不算驱动的。
  - **S4**：J1a、J1b、J6、J7a、J7b 走通；`single_instance` 仍是第一个注册的插件，`RunEvent::Opened` 的处理未被绕过（静态核对加日志）。
  - **S5**：全部旅程的语义投影与 WI-005 的比较一相等。
  - **S6**：本仓库要拥有的行数、要带的上游补丁数和各自的行数。
- **Tests (first)**：无。spike 是一次性调查，不走 tdd-guardian（第 2 节）；S1 的故障注入脚本留在 spike 分支上，随 WI-008 第 3 条保留。
- **停止条件**：任一关失败即停并记录失败点；时间盒用完即停，未跑的关记为「未跑」。
- **Risks**：合成按键对 CodeMirror 和 ProseMirror 可能部分有效 → 每条旅程只有「磁盘和日志与预期一致」才算过，没有「基本可用」。
- **WI-000 第 6 条的结果（2026-10-02，读源码，未构建）**：候选 A 进入 spike。细节和 `path:line` 在 spike 记录的「Source reading before the spike」一节，这里只列影响本项做法的四点 `[实测 crate 1.4.0 源码]`：
  1. 输入全是合成 DOM 事件，不产生 `NSEvent`。W3C Actions 的按键在 contenteditable 里不插入文字，往编辑器里打字只能用 Element Send Keys（走 `execCommand('insertText')`）。
  2. S1 第 3 项要关的不只三条脚本路由：`POST /print` 的 `orientation` 和 `POST /url` 的 `javascript:` 也能带进脚本，`DELETE /window` 走 `window.destroy()` 会绕过未保存提示，都要在路由表里拒绝。
  3. `/wdio/eval` 在 WebKit 回收完成回调时会重发同一段脚本（最多三次），S1 第 4 项必须删掉这段。
  4. 插件在每个 webview 创建时就替换 `WKUIDelegate`，`window.prompt` 会卡住主线程 30 秒。Source 模式的 ⌘K（`linkPlugin.ts:9`）在带驱动的包里不能用，旅程不走它。
  
  补丁估计 225–290 行（监听、鉴权、路由表之内），~~预算约 300 行（Q2）~~。UI delegate 改成按需安装另需 30–60 行，且在这三处之外，~~做不做待定~~。

  **用户裁定（2026-10-15，经 delegator 转达，WI-006 开工前）**：
  - **B1 预算**：「Raise to ~400」。候选 A 的补丁预算改为约 400 行，仍只限监听、鉴权、路由表三处。ADR-0047 决定 6 写的是「300 lines at most」；ADR-0047 仍是 Proposed，所以由本计划修订这个数字，ADR 的文字在 WI-008 把它改为 Accepted 时一并更正。
  - **B2 ⌘K**：「Accept as known diff (Recommended)」。不做按需安装的补丁。带驱动的包里 Source 模式 ⌘K 卡住约 30 秒，记为**只属于测试包的已知差异**，写进 spike 记录；旅程（含 e2e 旅程目录，ADR-0103）一律不在 Source 模式走 ⌘K。发布包不带驱动，不受影响。
  - **B4 取得 crate**：「Vendor as a local path (Recommended)」。把钉死的 1.4.0 下载一次放进 spike 分支，用 `[patch.crates-io]` 指向本地路径；补丁就是对这份副本的一个可审的 diff。用户的这句话涵盖这一次联网下载。
  - **B3** 已于 2026-10-15 落地（S2 的对照改用 ADR-0100 的补丁，见上面 S2 一条）。
- **Estimate**：2 天时间盒。

### WI-007 候选 B：自研插件

- **前提**：仅当候选 A 不合格（修订后的决定 5）。A 败在 S2、S3 时尤其要做，因为那正是自研方案（`NSEvent` 经 `NSApp sendEvent`）声称的优势所在。
- **位置**：`mdpro-wt/chore-d30-spike-inrepo`，分支 `chore/d30-spike-inrepo`。不合入。
- **最小范围**：运行目录里的 Unix 套接字（0600）加每次启动的凭证；按标签列出窗口；固定命令的执行与结果回传（`eval_with_callback`）；按键注入；点击。只做到能跑 S1–S6。
- **Acceptance**：与 WI-006 的 S1–S6 相同。S1 里 Host/Origin 一项按决定 6 写「不适用」，不写「满足」。S6 额外记录 Objective-C 互操作的行数。
- **Tests (first)**：无，同 WI-006。
- **停止条件**：同 WI-006。
- **Estimate**：2 天时间盒。

### WI-008 选择、记录、ADR 状态

- **Goal**：按决定 5 的规则得出结论，并让文档反映它。
- **Acceptance**
  1. `docs/test/<日期>-adr0047-spike.md` 填完，每格有证据类别；失败的关和未跑的关如实写。
  2. 结论是三者之一：WebdriverIO 插件、自研插件、只读探针（输入全部保持人工）。
  3. **spike 的补丁、分支、提交号、构建清单都留着**，直到 WI-011 的重验通过。
  4. ADR-0047 的 Status 改为 Accepted 并注明日期；维护预算的数字在这时定下。
  5. 选中了驱动时，新写一份依赖 ADR（编号取当时 `docs/adr/` 的下一个）。
  6. 排序文档 D30 行加上 ADR-0047、本计划、spike 记录的链接，状态字符串沿用该登记表邻行的写法。
  7. 回到本计划，补写 WI-009–WI-011 中与驱动相关的验收（PD7）。
- **Tests (first)**：无代码；只改文档。
- **Estimate**：S。

### WI-009 驱动接入

- **Goal**：把选定的通道按 R3、R4、R5、R9、R10 正式接进来，测试先行。
- **Acceptance（与驱动无关的部分）**
  1. `Cargo.toml` 的 `control-channel` 默认关闭，依赖 `verify-run`；驱动依赖是它的可选依赖。
  2. `control-channel` 构建不带运行时开关启动时，没有控制通道的监听和套接字。用监听清单验证：按 pid 列出全部 TCP 监听和 Unix 套接字，逐个对上用途（MCP 服务、single-instance、控制通道）。不带开关时只有前两个。
  3. 凭证每次启动新生成，写在运行目录内、权限 0600；进程退出后旧凭证被拒绝；通道的代码里没有任何路径读 `server.token`。
  4. HTTP 监听：只绑 `127.0.0.1`；Host 或 Origin 不符 → 拒绝；缺凭证或凭证错 → 拒绝；无通配 CORS；每条路由都在同一张表驱动的测试里。Unix 套接字：0600；每次请求校验凭证。
  5. `eval` 没在启动时开启：每条能执行脚本的路由都拒绝任意脚本（R10）。
  6. 请求带 id；同一个 id 第二次到达不执行（R9）。超时之后才完成的请求，其结果被丢弃并记日志，不会被当成后一个请求的回答。
  7. 目标窗口在请求执行期间被重载或关闭 → driver failure；窗口每次重载代号加一，发给旧代号的请求被拒绝。
  8. 通道在 `setup` 完成之后才开，进程退出时关，套接字文件被删。`quit` 时还在执行的请求，结论是 unknown outcome。
  9. 驱动若需要 Tauri IPC 权限：`build.rs` 按 `CARGO_FEATURE_CONTROL_CHANNEL` 分支，用 `capabilities_path_pattern` 选能力文件目录；`capabilities/default.json` 不变。两种构建各自解析出来的 ACL 都核对一遍，并确认 `removeUnusedCommands` 没受影响 `[二手：该 API 的文档警告]`。不需要权限就不加能力文件。
  10. 发布版洁净检查做成一条命令，四层全过：默认 feature 图里没有驱动 crate；发布 `dist` 里没有驱动资源；对发布包探测不到端点；对发布包带上运行时开关启动，监听清单里仍只有 MCP 和 single-instance。
  11. 插件注册不改变 `single_instance` 的首位，不绕过 `RunEvent::Opened`。
  12. 新增的命令或路由在 `docs/feature-ledger.md` 有自己的行；`pnpm ledger:check` 通过。
  13. 有结构化日志：通道开启、关闭、被拒绝的请求、被丢弃的迟到结果（都不含凭证）。
- **Tests (first)**：凭证生命周期；逐路由的拒绝矩阵（无凭证、错凭证、错 Host、错 Origin、未开 `eval`）；重复 id 不执行；迟到结果被丢弃；窗口代号；无开关不监听；feature 关闭时相关符号不存在；洁净检查脚本和监听清单解析的单测放 `tests/`。
- **Rollback**：feature 默认关闭，回退提交即可。
- **Estimate**：L。

### WI-010 固定探针 v1 与控制台缓冲

- **Goal**：满足 R6。
- **设计（Q9 的默认方案）**
  - 探针脚本存在 Rust 插件里，属于 `control-channel`。前端源码里没有探针代码，三种构建的 `dist` 相同。
  - 控制台与错误缓冲由 Rust 侧注入的初始化脚本安装，早于页面自己的脚本，三个窗口创建点都覆盖到（注入范围 `[推断]`，实测）。
  - 窗口标签列表读自 Rust 侧。其余读 DOM。
  - **先补 ARIA**（所有构建都带）：`BottomTabs` 加 `role="tablist"`、`role="tab"`、`aria-selected`；脏标记、关闭控件和新建按钮有可访问名称；应用外壳在偏好加载完成前带 `aria-busy`。不改外观，过规则 30–34。现在的关闭控件嵌在标签按钮里，`role="tab"` 里再放一个可交互的控件不合规，所以这一步可能要调整 DOM 结构（关闭控件挪成标签的兄弟节点），不只是加属性。
  - DOM 给不出的字段（例如文档路径）取自 Rust 侧的 shadow store，并在结果里标明它是防抖的。
- **Acceptance**
  1. 探针集合有版本号。v1 含：窗口标签列表、每个窗口的前端是否就绪、活动文档、脏标记、视图模式、待确认的提示（ADR-0042 的确认框、`ConfirmDialog`）、控制台与错误缓冲。每个字段写明来源（DOM、Rust 侧、shadow store）。
  2. 缓冲捕获 `console.error`、`console.warn`、`error`、`unhandledrejection`；每条有递增序号；容量固定，溢出时计数；模块初始化阶段抛的错也在里面。
  3. 调用任何探针前后：`document.activeElement` 不变；没有 store 的写操作；没有 `invoke` 调用；没有新增日志行。
  4. 脏标记读自 DOM（由 store 直接渲染），不经 300 ms 防抖的 shadow store。
  5. `release` 包与 `verify` 包的 `dist` 摘要相等（并入 WI-009 第 10 条的第二层）。
  6. 新增的 ARIA 有组件测试：按 role 和 name 查得到活动标签和脏标签。
- **Tests (first)**：`tests/control-console-buffer.test.ts`（序号单调、容量、溢出计数、先于应用模块安装）；`tests/control-probes-readonly.test.ts`（第 3 条的四个不变量，探针脚本在 jsdom 里对着渲染出来的界面跑）；`tests/control-probes-version.test.ts`；`tests/bottom-tabs-aria.test.tsx`。
- **Touched areas**：Rust 插件里的探针脚本；`src/components/BottomTabs/BottomTabs.tsx`；应用外壳的 `aria-busy`。
- **Risks + mitigations**
  - 探针为了「读得准」顺手刷新状态 → 第 3 条是硬性测试。
  - DOM 给不出某个要用的状态 → 先考虑把它做成所有构建都有的 ARIA 属性；实在不行再回到 Q9 的备选，届时分输出目录并测产物串味。
- **Estimate**：M。

### WI-011 `control-mdpro` 完整 CLI、旅程编排、重验

- **Goal**：agent 面向的唯一入口，满足 R7；并在最终实现上重新取得 S1–S5 的证据。
- **命令集（提议；ADR 说命令集未定）**：WI-003 的四个，加 `windows`、`probe`、`snapshot`、`click`、`press`、`type`、`screenshot`、`console`、`wait`、`run-journey`、`eval`（需在 `launch` 时单独开启）。全部支持 `--window <label>`、`--json`、`--help`；变更类支持 `--dry-run`。结论为「只读探针」时去掉 `click`、`press`、`type`。
- **契约**
  - **请求与响应**有版本号。响应固定含：`schemaVersion`、`requestId`、`verdict`（五值之一）、`evidenceClass`、`stepClass`、运行身份（`buildId`、pid）、窗口标签与代号，以及 `data` 或 `error`（代码加说明）。
  - **退出码**：0 pass；1 fail；2 driver failure；3 unknown outcome；4 NOT VERIFIED；64 用法错误。
  - **目标定位**按 ARIA role 和 name，不提供按坐标点击。零个匹配或多个匹配都是 driver failure，并列出候选；用 `--within <role/name>` 缩小范围。隐藏的、`aria-hidden` 的、尺寸为零的不算目标。有 `aria-modal` 对话框开着时，对话框之外的目标被拒绝。
  - **选区**不单设命令，用 `press` 发 Shift+方向键。
  - **变更串行**：同一个运行里同时只有一个变更类命令在执行；读命令不受限。
  - **`wait`** 只接受具名条件：`window-ready`、`no-pending-confirm`、`dirty=<值>`、`active-document=<值>`、`log-event=<名>`（从某个偏移之后）、`draft-saved`、`file-equals`。必须带 `--timeout`。等不到就是 NOT VERIFIED，不会返回「已稳定」。
  - **`snapshot`** 是从 DOM 推出来的 ARIA 表示，输出里这样标明；它不是系统的无障碍树。名称计算只实现一个子集（`aria-label`、`aria-labelledby`、`label for`、文本内容、`title`），每个名称带来源。子集不够用时，经 ADR 引入依赖，不悄悄写一个不完整的算法（Q6）。
  - **上限**：快照节点数、控制台条数、输出字节数都有上限，超了就截断并注明。
  - **`run-journey <id>`**：按 WI-000 的旅程定义执行 `cli` 和 `launcher` 步骤；遇到 `native`、`human` 步骤停下，说明要做什么，等对方确认后继续；产出逐步的结论表，每步带步骤类别和证据类别。
- **Acceptance**
  1. 上面每条契约都有测试。
  2. 任何输出里都没有凭证和 token。
  3. 变更类命令超时 → `unknown outcome`，CLI 不重试。
  4. `launch` 能到 L3：通道已鉴权，且 `window-ready` 成立。
  5. **重验**：在最终实现上重跑 S1–S5，包括 S2 的两个构建、WI-005 的比较一。结论与 spike 记录逐关对照，写进 `docs/test/<日期>-adr0047-reverify.md`。任何一关与 spike 不一致，这个工作项不算完成。
  6. 「只读探针」结论下，第 5 条改为：编排器跑全部旅程，输入步骤全部是 `human`，探针和落盘检查由 CLI 做；S2、S3 记「不适用」。
  7. 重验通过之后，spike 的工作树和分支可以清理。删除分支到时单独问你。
- **Tests (first)**：`tests/control-cli-*.test.ts`——参数解析；响应结构；退出码映射；目标定位的零个、多个、隐藏、模态四种情况；`wait` 的每个条件和超时；变更串行；输出上限；`run-journey` 在非 `cli` 步骤上停下；输出里无凭证。传输层在边界处 mock。
- **Touched areas**：`scripts/control/`；`package.json`。
- **Estimate**：L。

### WI-012 验证 skill 与 Feature Map

- **Goal**：让 agent 知道某个功能该怎么驱动、看什么证据；清掉指向空处的旧引用。
- **Acceptance**
  1. 新 skill（pstack 的结构：`SKILL.md` + `references/features/`），说明四类步骤各由谁做，何时用 CLI、何时交给 `gui-acceptance`、何时必须由人做。
  2. Feature Map 首批覆盖全部旅程涉及的功能，每条对应一个 ledger 行，只写驱动步骤和证据，不写状态（Q7）。
  3. `test-runner`、`fix`、`feature-workflow` 里的「Tauri MCP E2E」改为指向该 skill；`mcp-dev` skill 的过时内容更正或标注。
  4. `gui-acceptance`、`gui-manual-verify` 各加一段，说明与 CLI 的分工。
  5. CLAUDE.md 加一小节指向该 skill。
  6. 用一个真实的小工作项试跑一次，把过程记在 `docs/test/`。
- **Tests (first)**：无代码；第 6 条是它的验收。
- **Estimate**：M。

## 7. Testing Procedures（测试流程）

| 何时 | 跑什么 |
|---|---|
| 每个走 tdd-guardian 的 WI | `/tdd-guardian:workflow`；红 → 绿，覆盖率不低于阈值（lines 31 / functions 61 / branches 82 / statements 31） |
| 每个 WI 收尾 | `pnpm test:run`、`pnpm build`、`pnpm typecheck:tests`、`cd src-tauri && cargo test`、`pnpm coverage`、`pnpm ledger:check`；改了 ledger 再跑 `pnpm ledger:build` |
| WI-002 起每次要在真机上跑 | 用构建入口打包，用启动器起；不手工 `open` 验证包 |
| WI-009 起每次改动通道 | 发布版洁净检查四层 |
| 任何涉及对话框键盘的结论 | 物理按键，由人做 |

`pnpm check:all` 和 `pnpm lint` 在本仓库不存在，不要跑。

## 8. Rollout Plan（推进方式）

1. **第零阶段**只产生 `docs/test/` 下的文档和一个不合入的试探分支。
2. **第一阶段**四个 WI 各自一个或几个提交，各自能独立回退。WI-001–003 不依赖 Tauri 升级，在 2.9.5 上做完，这样升级前的基线才取得出来。WI-004 合入后是否观察一段日常使用再开始 spike，由你定。
3. **第二阶段**不产生合入代码，只产生 spike 记录和 ADR 状态变更。
4. **第三阶段**全部在默认关闭的 feature 后面；每个 WI 合入前过洁净检查。WI-010 的 ARIA 补充是唯一进所有构建的界面改动。
5. **停止条件**
   - WI-000 的试探，或 WI-004 的真机对照，出现与升级前不同的键盘或焦点行为 → 停，先定位。
   - WI-002 的独立 identifier 让 `RunEvent::Opened` 走不通 → 停，问你。
   - WI-005 的负对照不成立 → 停，重做 S2 设计。
   - 两个候选都不过 → 按决定 5 收缩为只读探针。
   - WI-011 的重验与 spike 不一致 → 停，不清理 spike 产物。

## 9. Manual Test Checklist（人工检查清单）

- [x] WI-000：试探包上的 J1a 和 J5 物理 Esc（2026-10-02 通过）
- [x] WI-002：双击验证包，它退出，真实目录没有变化（2026-10-07，真机记录验收 2）
- [x] WI-002：开着日常 mdpro 起隔离运行，日常那边没有多出窗口或标签（2026-10-07，真机记录验收 4）
- [x] WI-002：Finder 里 `.md` 的默认打开方式没变；验证包点「检查更新」不会装上正式版（前半已过，真机记录验收 8。后半：2026-10-09 查明没有单独的「检查更新」按钮，About 打开即自动检查；空地址的报错原先被误判成网络错误，`e457cdb` 已修（`updaterErrors.ts`）。同日在 mini 上用 `e457cdb` 的验证包（buildId `13b68953…`）真机看过：About 显示 “Automatic updates coming soon.”，没有 Check Again，也没有安装按钮；日志只有一条 `ui.about.update_check` start，没有 fail。记录：[`docs/test/20261009-adr0047-wi002-about-updater-device.md`](../test/20261009-adr0047-wi002-about-updater-device.md)）
- [x] WI-003：故意不杀旧进程再 `launch`，被拒绝（2026-10-09，真机 Check H：运行活着时重打再 `launch`，以已有运行被拒；重打的包与原包逐字节相同，`buildId` 不符这一支没触发。记录 [`docs/test/20261009-adr0047-wi003-device.md`](../test/20261009-adr0047-wi003-device.md)）
- [x] WI-004：升级前后两个包各走一遍全部旅程（2026-10-15，dtrack，33 段相等；记录 [`docs/test/20261015-wi004-tauri-upgrade-device-check.md`](../test/20261015-wi004-tauri-upgrade-device-check.md)）
- [x] WI-004：D34 的 Esc、D41 的 Tab 物理重测（2026-10-15，用户按键，通过；同一记录 H2、H3）
- [ ] WI-005：两个包上的物理 Esc 基线（回退构建不关、基线头关）
- [ ] WI-005：比较一（驱动关的全部旅程）、比较二（`release` 包的 J1a、J2、J5，日常 mdpro 关着）
- [ ] WI-006 / WI-007：每个候选的两个带驱动的包上，各按一次物理 Esc
- [ ] WI-009：对发布包带运行时开关启动，监听清单里没有控制通道
- [ ] WI-011：重验里的 S2 两个构建
- [ ] WI-012：一个真实工作项的试跑

## 10. Plan → Verify Handoff（交给验证的证据）

| WI | 要收的证据 |
|---|---|
| WI-000 | 旅程文档；语义投影定义；spike 记录骨架；试探结果与版本组；候选 A 的路由清单 |
| WI-001 | 新增测试的红、绿输出；两次构建的清单；互打两种配置后的 `dist` 摘要对照 |
| WI-002 | 新增 Rust 测试的红、绿输出；守卫的真机结果；真实目录的前后元数据清单；监听与端口的 pid 对照；WebKit 落点 |
| WI-003 | 启动器测试；Trap 2、Trap 3、pid 复用三种重现时的输出 |
| WI-004 | 门禁输出；升级前后的语义投影；D34、D41 重测记录 |
| WI-005 | 两份物理基线（各四项）；比较一、比较二的投影与差异说明 |
| WI-006 / 007 | spike 记录的 S1–S6 表，每格带证据类别；补丁与行数 |
| WI-008 | 接受后的 ADR-0047；依赖 ADR；D30 行；保留的 spike 产物清单 |
| WI-009 | 拒绝矩阵测试；监听清单；洁净检查四层输出；ledger 行 |
| WI-010 | 四个测试文件的红、绿输出；两种包的 `dist` 摘要 |
| WI-011 | CLI 测试；重验记录 |
| WI-012 | 试跑记录 |

**夹具**：旅程用的 Markdown 文件（含一张表格、几级标题）放 `tests/manual-fixtures/adr0047-journeys.md`（CLAUDE.md「Manual test fixtures」）。运行时用副本：启动器把它拷进运行目录再打开，仓库里的原件不被改动。预置的 `config.json`（日志开、自动保存取下限）由启动器在运行目录里生成，不是提交的文件。截图不提交。
