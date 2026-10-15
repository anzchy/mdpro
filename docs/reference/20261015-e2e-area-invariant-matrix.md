# WI-E2E-0 区域与不变量矩阵（mdpro-a3，2026-10-15）

计划：[`docs/plans/20261015-plan-e2e-journeys.md`](../plans/20261015-plan-e2e-journeys.md) WI-E2E-0（base `master` `73cda31`，含 `cd05d63` 的测试位置修订）。
本文先作为 prep 写在仓库外，§6 的裁定定下之后随 WI-E2E-1 入库；结论已回填计划 §6 与 §9。旅程标签 `SJ-*` / `PJ-nn` 只是提案，正式 id 见 [`tests/journeys/REGISTRY.md`](../../tests/journeys/REGISTRY.md)。

**数据来源 `[实测]`**：一个一次性脚本（`e2e0-ledger-scan.py`，留在仓库外的 prep 目录，未提交）读 `docs/feature-ledger.md`（`73cda31`），按 ADR-0089 的规则算每行在每个平台的有效状态：macOS 取 inventory 的状态；Windows 取差异行的状态，没有差异行就继承 inventory；`N/A` 不参与。原始结果 `e2e0-ledger.json` 同在 prep 目录。ledger 之后的改动（例如 `4c7784a` 把 Windows 的「重启应用更新」改为 `Absent`）没有重算进本文的计数。

## 1. 有效状态计数

185 行。有效状态为 `Shipped` 的：**macOS 80 行，Windows 28 行**，合计 80 行（Windows 的 28 行都在 macOS 的 80 行里）。门禁义务（§4.5 规则 1）是 80 个 macOS 身份 + 28 个 Windows 身份 = **108 个 {平台, 能力} 身份**；inventory 格里的一个标记同时满足两个平台。

| 区域 | 行数 | macOS Shipped | Windows Shipped | Windows 其余（Unknown / Partial / Absent / Stub / N/A） |
|---|---|---|---|---|
| 文件与文档管理 | 25 | 10 | 6 | 11 / 5 / 1 / 1 / 1 |
| 编辑 / WYSIWYG | 33 | 21 | 4 | 25 / 2 / 1 / 1 / 0 |
| 表格 | 19 | 11 | 1 | 15 / 3 / 0 / 0 / 0 |
| 源码模式 | 12 | 9 | 6 | 6 / 0 / 0 / 0 / 0 |
| 导出 | 15 | 4 | 3 | 4 / 2 / 5 / 1 / 0 |
| 导航与界面 | 19 | 5 | 0 | 7 / 3 / 8 / 0 / 1 |
| 主题与排版 | 9 | 1 | 1 | 6 / 0 / 2 / 0 / 0 |
| MCP 集成 | 14 | 6 | 3 | 9 / 1 / 0 / 0 / 1 |
| 日志与诊断 | 10 | 5 | 1 | 2 / 1 / 0 / 0 / 6 |
| 偏好设置 | 7 | 0 | 0 | 5 / 1 / 0 / 1 / 0 |
| 窗口与标签页 | 7 | 2 | 1 | 5 / 0 / 0 / 1 / 0 |
| 平台集成 | 15 | 6 | 2 | 4 / 3 / 4 / 0 / 2 |

**读法**：Windows 的门禁义务今天只有 28 个身份，因为 99 行是 `Unknown`。WI-E2E-7 每把一行从 `Unknown` 判成 `Shipped`，Windows 就多一个义务。所以 Windows 一栏的工作量随验证而增长，不是一次性的。

## 2. 矩阵：每个 Shipped 行 → 拟定旅程或豁免

标签 `SJ-*` 是 WI-E2E-3 的五条快捷键旅程（按设置页分类：File / Edit / Paragraph / Format / View），`PJ-nn` 是本文拟定的其余旅程。它们都只是提案标签，**正式的 `EJ-NNN` 在 WI-E2E-1/3 起按发放顺序编号**。平台栏：`S` = Shipped，`U` = Unknown，`P` = Partial，`—` = N/A。

驱动能力代号（§4 汇总它们在两个平台上的现状）：
`page` 页面动作 · `key` 原生快捷键 · `menu` 原生菜单 · `dlg` 原生文件对话框 · `clip+` 写入富剪贴板（图片 / HTML） · `drag` 从文件管理器拖入 · `launch` 启动 / 退出 / 重启（含 HOME 隔离） · `fs` 读字节 / 外部写文件 · `http` 带 token 调 MCP · `win2` 多窗口定位 · `ime` 输入法（human） · `feed` 假更新源

### 文件与文档管理（10）

| 行 | mac/win | 拟定 | 步骤类别 | 驱动能力 | smoke |
|---|---|---|---|---|---|
| 新建文档 | S/U | SJ-File（⌘N 用例） | native, page | key | |
| 保存 | S/S | **PJ-01 保存字节与脏标记**（部分：D19 保存中编辑作为第二用例；保存失败提示不含） | native, page, cli | key, fs | ★ |
| 关闭文档 | S/U | PJ-02 关闭脏文档确认（部分：对话框开着时 ⌘W/⌘N/⌘O 被屏蔽的那串用例另列） | native, page | key | |
| 编码自动检测 | S/S | PJ-03 编码往返（UTF-16LE、BOM、CRLF；fixture 由生成器产出） | launcher/page, cli | fs | |
| 保存时保留原编码 | S/S | PJ-03 | native, cli | key, fs | |
| 原子写入保存 | S/U | **豁免 `rust-only`**：效果只在进程被强杀时可见，真机无法稳定复现；测试 `src-tauri/src/commands/file.rs`（`test_atomic_write_replaces_content_and_leaves_no_tmp`）、`file_save_wiring_tests.rs` | — | — | |
| 外部变更重载提示 | S/S | PJ-05 → **watcher 合跑组**（WI-E2E-6，D32/D68/D69/D86，不拆） | cli, page | fs | |
| 未保存改动确认 | S/S | PJ-02 | native, page | key | |
| 草稿自动保存 | S/S | PJ-04 草稿跨重启（等 30 s，查草稿目录，重启后恢复框） | page, cli, launcher | launch, fs | |
| 保存后清理草稿 | S/U | PJ-04（部分：「保存中关标签」那条路径不含） | 同上 | launch, fs | |

### 编辑 / WYSIWYG（21）

| 行 | mac/win | 拟定 | 步骤类别 | 驱动能力 | smoke |
|---|---|---|---|---|---|
| 行内源码显隐 | S/U | SJ-Format（⌃\` 用例）+ 光标移入移出（page） | page, native | key | |
| 粗体 / 斜体 | S/S | SJ-Format | native | key | ★（Format 旅程的 W 子集） |
| 标题 1–6 与正文 | S/S | SJ-Paragraph | native | key | |
| 行内代码 | S/U | SJ-Format | native | key | |
| 删除线 | S/S | SJ-Format（Windows 键位不同，按 ADR-0096 分平台写输入，期望共用 golden） | native | key | |
| 插入链接（WYSIWYG） | S/U | PJ-07 插入链接（W 与 S 两种模式各一用例，含取消路径 D73） | native, page | key | |
| 链接 URL 消毒 | S/U | PJ-07（`javascript:` 被拒、补 `https://` 两用例） | page | — | |
| `==text==` 往返 | S/U | SJ-Format（存盘 golden） | native, cli | key, fs | |
| 图片粘贴 | S/U | PJ-09 图片粘贴 | native, cli | clip+, fs | |
| 图片粘贴校验 | S/U | PJ-09（6MB PNG、GIF 两用例） | native | clip+ | |
| 上传进度占位 | S/U | PJ-09（瞬态，判据靠日志；截图只作辅助） | native | clip+ | |
| 未保存文档禁粘贴守卫 | S/U | PJ-09 | native | clip+ | |
| 批量多图粘贴 | S/U | PJ-09 | native | clip+（多文件） | |
| 图片拖放插入 | S/U | PJ-10 图片拖放（macOS `drag`；Windows 记 `human` 或 BLOCKED，见 Q3） | native/human | drag | |
| 图片缩放菜单 | S/U | PJ-11 图片缩放与写回 | page | — | |
| 图片宽度写回 Markdown | S/U | PJ-11（部分：导出后 tooltip 一条由 PJ-24 覆盖） | page, native, cli | key, fs | |
| 本地图片渲染 | S/U | PJ-11（fixture 带相对路径图片） | page | — | |
| 粘贴 HTML 消毒 | S/U | PJ-12 粘贴 HTML（富剪贴板写入 HTML；纯消毒规则另有 `tests/sanitizer-*.test.ts`） | native | clip+ | |
| 链接点击守卫 | S/U | PJ-13 链接点击（`file:` 不打开且记日志；https 交给系统浏览器，清理时关掉） | page | — | |
| 撤销 / 重做 | S/S | SJ-Edit（含 D203 跨标签用例） | native | key | |
| 剪切 / 复制 / 粘贴 / 全选 | S/U | SJ-Edit（复制用例读剪贴板核对） | native | key, clip（读） | |

### 表格（11）

| 行 | mac/win | 拟定 | 步骤类别 | 驱动能力 | smoke |
|---|---|---|---|---|---|
| 插入表格对话框 | S/U | **PJ-14 插入表格**（网格悬停与数字两路径） | native, page | key, menu | ★ |
| 插入行 / 列 | S/U | PJ-15 表格结构操作 | native | key | |
| 删除行 / 列 / 整表 | S/U | PJ-15 | native | key | |
| 移动行 / 列 | S/U | PJ-15（右键菜单；边界项置灰作为用例） | page | — | |
| Esc 退出表格 | S/U | PJ-16 表格导航（Esc 这一步是物理键：macOS 可用 `key`，D 项里有「物理 Esc」的 human 先例，见 Q4） | native | key | |
| 输入法安全的表格导航 | S/U | PJ-16（`human` 步：IME） | human | ime | |
| 列数校验提示 | S/U | PJ-17 源码模式表格（删表体行的 `\|`） | page | — | |
| 当前单元格高亮 | S/S | PJ-17（含 D39 大文档用例；大文件由生成器产出） | page | — | |
| 列宽拖拽 | S/U | PJ-18 表格布局（拖拽；不写进 Markdown 用磁盘字节判） | page | — | |
| 跨模式单元格光标同步 | S/U | PJ-18 | native, page | key | |
| 宽表格滚动 | S/U | PJ-18 | page | — | |

### 源码模式（9）

| 行 | mac/win | 拟定 | 步骤类别 | 驱动能力 | smoke |
|---|---|---|---|---|---|
| 源码编辑 | S/S | **PJ-19 源码编辑与装饰** | native, page | key | ★ |
| 查找与替换 | S/S | PJ-20 查找替换 | native, page | key | |
| 源码模式标题级别 | S/S | SJ-Paragraph（S 模式用例） | native | key | |
| 提升 / 降低标题级别 | S/S | SJ-Paragraph（S 模式） | native | key | |
| 源码模式插入链接 | S/S | PJ-07（S 模式用例） | native, page | key | |
| 隐藏 Markdown 语法标记 | S/S | PJ-19 | page | — | |
| 行注释切换 | S/U | PJ-22 源码编辑命令（⌘⌥/、Tab/⇧Tab） | native | key | |
| 代码块缩进 / 反缩进 | S/U | PJ-22 | native | key | |
| 代码块主题 | S/U | PJ-23 外观偏好跨重启（跨区域：与「字号」共用） | page, launcher, cli | launch, fs | |

### 导出（4）

| 行 | mac/win | 拟定 | 步骤类别 | 驱动能力 | smoke |
|---|---|---|---|---|---|
| 导出 HTML | S/U | **PJ-24 导出 HTML**（原生保存对话框；产物与 golden HTML 整块比较） | native, cli | key, dlg, fs | ★ |
| 自动链接与 emoji | S/S | PJ-24 的 fixture 带这些构造，作为用例（见 Q2：备选是 `pure-transform` 豁免，测试 `src-tauri/src/services/markdown_ext/autolink_tests.rs`、`tests/render-golden.test.ts`） | 同上 | 同上 | |
| GFM 渲染 | S/S | 同上 | 同上 | 同上 | |
| 导出消毒 | S/S | 同上（备选豁免的测试：`tests/sanitizer-policy.test.ts`、`tests/sanitizer-malicious-fixtures.test.ts`） | 同上 | 同上 | |

### 导航与界面（5）

| 行 | mac/win | 拟定 | 步骤类别 | 驱动能力 | smoke |
|---|---|---|---|---|---|
| 切换侧栏 | S/U | SJ-View（⌘⇧L；持久化用例要重启） | native, launcher, cli | key, launch, fs | |
| 底部标签条 | S/U | PJ-25 底部标签条（+、脏点、悬停 ×、路径提示、横向滚动、flush 失败拒切） | page | — | |
| 视图模式切换 | S/U | SJ-View（Windows 只有 Ctrl+/，按平台写输入） | native | key | ★（View 旅程子集） |
| 加载指示 | S/U | PJ-26 加载指示（大文件由生成器产出；瞬态，判据靠日志，截图辅助。日志里是否有可判的事件待核实，见 Q6） | native, page | key, dlg | |
| 窗口拖拽区 | S/— | PJ-27 窗口拖拽（只在 macOS；Windows `n/a`，ledger 已写 N/A） | native | drag（窗口） | |

### 主题与排版（1）

| 行 | mac/win | 拟定 | 步骤类别 | 驱动能力 | smoke |
|---|---|---|---|---|---|
| 字号 | S/S | **PJ-23 外观偏好跨重启** | page, launcher, cli | launch, fs | ★ |

### MCP 集成（6）

| 行 | mac/win | 拟定 | 步骤类别 | 驱动能力 | smoke |
|---|---|---|---|---|---|
| 四个 MCP 工具 | S/S | **PJ-28 MCP 工具往返**（curl 带 token；写操作走确认框） | cli, page | http | ★ |
| 客户端配置安装器 | S/U | PJ-30 客户端安装器（写客户端配置文件，**必须 HOME 隔离**；Windows 在 WI-E2E-W 第 3 条之前 BLOCKED） | page, cli | launch（隔离）, fs | |
| 连接测试与端口复制 | S/U | PJ-30（读剪贴板核对端口） | page | clip（读） | |
| 令牌与来源校验 | S/S | PJ-28（无 token、错 token 两用例） | cli | http | |
| 退出时清理服务配置 | S/S | PJ-29 MCP 退出清理 | launcher, cli | launch, fs | |
| 验证构建的 MCP 端口 | S/— | **豁免 `not-user-visible`**：只在验证启动器里出现的开发工具行为；测试为 `tests/control-*`（ADR-0098 迁移后在 `tests/control/`，具体文件待 WI-E2E-4 指定） | — | — | |

### 日志与诊断（5）

| 行 | mac/win | 拟定 | 步骤类别 | 驱动能力 | smoke |
|---|---|---|---|---|---|
| 结构化 JSONL 日志 | S/S | **PJ-31 日志开关与级别**（第一个用例就是 §4.7「就绪」那一步：写标记行再读回） | page, cli | fs | ★ |
| 日志开关 | S/P | PJ-31（关掉后 0 字节；Windows 是 Partial，只算 macOS 义务） | page, launcher, cli | launch, fs | |
| 日志级别 | S/U | PJ-31 | page, cli | fs | |
| DevTools | S/U | PJ-32 正式版 DevTools（右键 Inspect；Windows 是 WebView2 DevTools，注意与驱动用的 9222 端口区分） | native | — | |
| 验证运行启动器 | S/— | **豁免 `not-user-visible`**：开发工具；测试为 `tests/control-*`（同上，待指定） | — | — | |

### 窗口与标签页（2）

| 行 | mac/win | 拟定 | 步骤类别 | 驱动能力 | smoke |
|---|---|---|---|---|---|
| 多窗口文档 | S/U | **PJ-33 多窗口隔离**（⌘S 只作用于聚焦窗口；Windows 在窗口定位做好之前 BLOCKED，§4.7） | native, page | key, win2 | ★（macOS） |
| 原生 Window 菜单 | S/S | PJ-34 原生菜单（部分：Minimize / Maximize 本身是系统行为，只验菜单项在、点了有效） | native | menu | |

### 平台集成（6）

| 行 | mac/win | 拟定 | 步骤类别 | 驱动能力 | smoke |
|---|---|---|---|---|---|
| 原生 macOS 菜单栏 | S/— | PJ-34（macOS 可用 System Events 枚举菜单，`cli` 步，判据是菜单名列表） | cli/native | menu | |
| 应用菜单基础项 | S/S | PJ-34（Services / Hide / Hide Others / Show All 是 `os-owned`，只验存在；About、Quit 验行为） | native | menu | |
| 重启应用更新 | S/U | PJ-35 更新重启（**需要假更新源**，见 Q3；Windows 见 Q7） | page, launcher | feed | |
| 重启前保存守卫 | S/U | PJ-35（flush 后再判、flush 失败只弹一次两用例） | page | feed | |
| 版本号显示 | S/S | **PJ-36 About 版本号**（与运行清单里的构建身份对上） | page | — | ★ |
| 退出卡住时的逃生口（Stop Waiting and Quit…） | S/U | PJ-37 → **退出合跑组**（ADR-0036 的 m1–m5 原样收编，WI-E2E-6） | native, launcher | menu, launch | |

## 3. 汇总：旅程数量、smoke 集与批数

**旅程数量**：WI-E2E-3 的 5 条快捷键旅程（SJ-*）+ 34 条 PJ（PJ-01…PJ-37，去掉合并进别处的 PJ-06/08/21）= **39 条**，覆盖 80 行里的 76 行。另外 4 行走豁免（原子写入 1 行，验证启动器 2 行，导出的 3 行备选豁免不计入，见 Q2）。其中 2 条（PJ-05、PJ-37）本身就是 rule 70 的合跑组，在 WI-E2E-6 收编，不另做。ADR-0034 决定 7 的五条和 ADR-0047 的 J1a–J7b（10 条，spike 组）不在上面的 80 行映射里，另加。**目录总规模约 39 + 5 + 10 ≈ 54 条**。

**smoke 集**（每个有 Shipped 行的区域一条主路径；偏好设置没有 Shipped 行，不需要 smoke）：PJ-01 保存、SJ-Format（W 子集）、PJ-14 插入表格、PJ-19 源码编辑、PJ-24 导出 HTML、SJ-View（子集）、PJ-23 外观偏好、PJ-28 MCP 工具、PJ-31 日志、PJ-33 多窗口、PJ-36 About。**11 条**。按每条 3–5 分钟（含就绪与清理），每个平台约 **35–55 分钟**，与 §4.6「≤45 分钟」的目标一致，但上限会超。Windows 上 PJ-33 在 WI-E2E-W 之前记 BLOCKED，整次 smoke 结论按 §4.6 是 INCOMPLETE。

**full 的批数** `[推断，WI-E2E-5 实测后替换]`：按旅程类别估单条耗时：

| 类别 | 条数 | 单条（分钟） | 小计 |
|---|---|---|---|
| 只有页面动作和快捷键（SJ-*、PJ-07/11/13/15/17/18/19/20/22/25/34/36） | 18 | 4 | 72 |
| 要重启或 HOME 隔离（PJ-04/23/29/30/31/32/35，SJ-View 的持久化用例） | 8 | 7 | 56 |
| 富剪贴板、拖放、IME、原生对话框（PJ-03/09/10/12/16/24/26/27） | 8 | 8 | 64 |
| 多窗口与 MCP（PJ-01/02/14/28/33） | 5 | 5 | 25 |
| **合计（不含合跑组、ADR-0034 与 spike 组）** | 39 | | **≈ 217 分钟 / 平台** |

≈ **5 批 × 45 分钟 / 平台**，两个平台约 **7–8 设备小时**，还没算构建、传输、准备、对照、重试和证据审阅（与 §9 的「4–6 批、6–9 设备小时」同一量级，偏上）。Windows 今天能跑的远少于此：富剪贴板、拖放、多窗口和 HOME 隔离在 WI-E2E-W 之前都是 BLOCKED。

## 4. 驱动能力在两个平台上的现状 `[读脚本与记录，未在设备上逐项演示]`

| 能力 | macOS（dtrack） | Windows（`remote-windows-device-test`） | 影响的拟定旅程 |
|---|---|---|---|
| page | computer use，可用 | CDP 9222 `cdp.sh eval`，可用；退出码不可信（D228） | 大部分 |
| key | `key.sh`，可用 | `ui.sh` 计划任务，可用；退出码不传回（D228） | SJ-*、大部分 |
| menu | computer use 点菜单；System Events 可枚举 | 未核实（Win32 菜单栏的驱动方式） | PJ-14、PJ-34、PJ-37 |
| dlg | computer use | 未核实（UIA 驱动通用文件对话框） | PJ-24、PJ-26 |
| clip+（图片 / HTML） | 可用 `osascript` 写入 PNG / HTML 剪贴板，未演示 | 桌面会话里 PowerShell 写剪贴板（STA），未实现 | PJ-09、PJ-12 |
| drag（文件拖入） | computer use 从 Finder 拖，需要 Finder 授权 | 没有可靠办法，倾向记 `human` | PJ-10 |
| launch + 隔离 | `HOME` 指向临时目录（WI-005 P3） | WI-E2E-W 第 3 条核实；之前只能快照加恢复 | PJ-04/23/29/30/31/35 |
| fs | ssh / 本地 shell | ssh，可用 | 多数 |
| http | curl | ssh 上 `curl.exe`，未核实 token 读取 | PJ-28/29 |
| win2 | computer use 按窗口标题 | **BLOCKED** 直到窗口标签绑定（§4.7 第 3 条） | PJ-33 |
| ime | human | human | PJ-16 |
| feed（假更新源） | 只有发版金丝雀那条路（v0.3.4 updater canary） | 不适用（D224：Windows 不提供更新） | PJ-35 |

## 5. 给 delegator 的问题（多数要转 adr047-verify；裁定见 §6）

1. **Q1 原子写入**：「原子写入保存」用 `rust-only` 豁免可以吗？它是用户可见行为（文件不会半截），但只在强杀时可见，真机复现不稳定。§4.5 规则 4 说完整链路不能整体豁免；这一行本身就是一条不变量，不是链路。
2. **Q2 导出的三行**：作为 PJ-24 fixture 里的用例（一份 fixture，一次导出，golden HTML 整块比较），还是 `pure-transform` 豁免（测试已存在）？前者多 0 次运行、golden 维护多一点；后者门禁更省事，但违背「导出 HTML 整条链路不能整体豁免」的精神，只适用于逐条不变量。我倾向用例。
3. **Q3 富剪贴板、拖放、假更新源**：这三类驱动能力计划里没有 WI 负责。clip+ 在 Windows 要新写；drag 在 Windows 倾向 `human`；PJ-35 需要一个只在验证构建里生效的更新端点覆盖，否则只能在发版金丝雀上跑。要不要在 WI-E2E-W 或另开一个 WI 里排？
4. **Q4 Esc**：PJ-16 的 Esc 用 `key` 步还是 `human` 步？之前有过「物理 Esc」作为 human 步的先例（计划 §9），但 `key.sh` 发的 Esc 在 macOS 上能到达 WebView。
5. **Q5 回填**：WI-E2E-0 要求「结论回填到本计划」，但计划是 adr047-verify 写的。由我在 WI-E2E-1 的分支里改 §9 和 §6 的估计，还是我把这份 prep 交给 adr047-verify 去改？
6. **Q6 加载指示**：PJ-26 的判据要一条日志事件；「Opening file…」「Exporting HTML…」现在有没有对应的日志事件我还没核实。没有的话，它要么加日志（改 `src/`，另一个 WI），要么只能用截图，而截图按 §4.4 不能作判据。
7. **Q7 ledger 疑点（不是我的行，只报告）**：「重启应用更新」「重启前保存守卫」的 Windows 有效状态是继承来的 `Shipped`→ 实际差异表写 `Unknown`；按 D224（Windows 不提供更新），这两行在 Windows 上也许该是 `N/A`。「验证构建的 MCP 端口」「验证运行启动器」两行是开发工具，记为 Shipped 会给门禁带来义务；用 `not-user-visible` 豁免可以，但也许它们本不该在用户能力清单里。

## 6. Rulings (adr047-verify, relayed and accepted by mdpro-delegator, 2026-10-15)

- **Q1** Atomic write: macOS `rust-only` exemption. Marker text: 「无 UI 旅程（rust-only）：强杀时文件不截断、权限位保持；测试：src-tauri/src/commands/atomic_write_tests.rs」, plus `file.rs`'s `test_atomic_write_*` if wanted. Windows is Unknown, so there's no obligation; add a note that CI has no Windows cargo leg.
- **Q2** Export is **one journey and one fixture** holding all three constructs, compared against one whole golden HTML. Each row links to its own case through `ledger[].cases/covers`. `pure-transform` is only for single, Rust-tested rendering rules.
- **Q3** Rich clipboard (clip+) and the fake update feed each get their own WI, added to the plan by adr047 during the §6 backfill review. Until then their cases are BLOCKED and stay in the baseline; PJ-35 runs only at the release canary. File drag is a `human` step on both platforms (ADR-0075). None of this goes into WI-E2E-W.
- **Q4** Esc is a `native` step. macOS: computer use's key action or `key code 53` (key.sh can't send Esc). Windows: the ui.ps1 chord.
- **Q6** No log event exists for the loading indicator. The delegator registered [D229](../plans/20260912-frontend-backend-sequencing-order.md#d229) to add `ui.loading.show/hide`; PJ-26 stays in the baseline until that lands.
- **Q7** The verify-run port and the launcher are `not-user-visible` exemptions with paths under `tests/control/` (after ADR-0098). Restart-to-update on Windows is a ledger correction (Absent, D224), routed separately and not mine; the delegator made it in `4c7784a`.
- **Q5** (delegator) The §6 / §9 backfill goes in the WI-E2E-1 branch, and adr047-verify reviews the diff.
