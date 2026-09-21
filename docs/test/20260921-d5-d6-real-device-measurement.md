# 测量条件

| 项 | 值 |
|---|---|
| 日期 | 2026-09-21 |
| 机器型号与内存 | MacBook Pro（Mac16,1，Apple M4，10 核：4P+6E），24 GB |
| macOS | 26.3.1 (a)，Build 25D771280a |
| **电源状态** | **已插电**；`pmset -g batt`：`Now drawing from 'AC Power'`，电池 55%，charging |
| `pmset -g therm` | 未取得数值；原文：`Error:Failed to get thermal warning level with error code 0xe00002bc`；`Error: Failed to get performance warning level with error code 0xe00002bc`；`Error: No CPU power status with error code 0xe00002bc` |
| Git | `frontend-backend-redesign`，`703a6b4 feat(editor): judge the large-document guard by source structure, not byte size` |
| 被测构建 | debug bundle：`src-tauri/target/gate2-bundle/debug/bundle/macos/mdpro.app`；最终还原后 mtime `Sep 21 16:57:38 2026` |
| 构建命令 | `CARGO_TARGET_DIR=target/gate2-bundle pnpm tauri build --debug --bundles app` |
| 构建结果 | `.app` 成功生成；命令最后因未提供 `TAURI_SIGNING_PRIVATE_KEY` 返回 1，失败点是 updater 签名，不是 `.app` 构建 |
| D5 配置自检 | `strings -a .../Contents/MacOS/tauri-app \| grep -o "connect-src[^;\"]*"` 命中 `connect-src 'self' ipc: http://ipc.localhost` |
| 语料 | `.perf-corpus/`，seed `0x5eed`；`node scripts/perf/generate-corpus.mjs --check` 返回 `OK: reproduces plan M's recorded table (11/11)` |
| 日志阳性验证 | 正向 bundle 中打开 `dense-math.wysiwyg.md` 后保存；`file.save` 记录 start/success，`durationMs=19`，文件 471,942 B。D6 起点 `LOG0=10497`；护栏关闭构建起点 `LOG0=10584` |
| 方法 | Web Inspector Console（CSP 原文、事件到双 rAF）、应用 JSONL 日志（Milkdown loading→ready）、`sample`（调用栈 top-of-stack）、`ps`（CPU/RSS） |

> 本记录只写本轮测到的数字和测不到的原因。毫秒数不作阻塞阈值。
> 单次严重样本触发停止后没有重试覆盖；未完成项保留为“未验证”。

## 1. D5：打包版 CSP / IPC 自定义协议

### 1.1 当前配置正向观察

被测对象是上述 debug bundle，不是 `pnpm tauri dev`，也不是 release bundle。

| 观察项 | 结果 |
|---|---|
| 二进制 CSP 字符串 | 命中 `connect-src 'self' ipc: http://ipc.localhost` |
| Web Inspector Console 清空后 ⌘R | CSP / `connect-src` / `ipc://localhost` / `ipc.localhost` 拒绝 **0 条** |
| 其余 error / warning | **0 条** |
| 真实 IPC：打开 | `dense-math.wysiwyg.md` 打开成功；日志 `file.open success`，471,942 B |
| 真实 IPC：保存 | 界面显示 `Saved`；日志 `file.save success`，`durationMs=19` |

### 1.2 旧 CSP 负对照

临时把 CSP 改回不含 `connect-src` 的旧值，以同一命令重打 debug bundle。
首次启动时 Inspector 徽标显示 **10 warnings + 10 errors**。

10 条 CSP 拒绝按 Console 折叠计数展开后为：

| 请求 | 条数 | Console 原文 |
|---|---:|---|
| `ipc://localhost/log_event` | 3 | `Refused to connect to ipc://localhost/log_event because it appears in neither the connect-src directive nor the default-src directive of the Content Security Policy.` |
| `ipc://localhost/plugin%3Aevent%7Clisten` | 4 | `Refused to connect to ipc://localhost/plugin%3Aevent%7Clisten because it appears in neither the connect-src directive nor the default-src directive of the Content Security Policy.` |
| `ipc://localhost/set_recent_files_menu` | 1 | `Refused to connect to ipc://localhost/set_recent_files_menu because it appears in neither the connect-src directive nor the default-src directive of the Content Security Policy.` |
| `ipc://localhost/get_logging_settings` | 1 | `Refused to connect to ipc://localhost/get_logging_settings because it appears in neither the connect-src directive nor the default-src directive of the Content Security Policy.` |
| `ipc://localhost/cleanup_old_drafts` | 1 | `Refused to connect to ipc://localhost/cleanup_old_drafts because it appears in neither the connect-src directive nor the default-src directive of the Content Security Policy.` |

另外有 10 条 Tauri fallback error，原文均为：

`IPC custom protocol failed, Tauri will now use the postMessage interface instead – TypeError: Load failed`

清空 Console 后 ⌘R 没有再次出现这些行；本轮观察与失败锁存后不再重试一致。
负对照结束后已还原 CSP，并重新构建当前 bundle；最终二进制自检再次命中
`connect-src 'self' ipc: http://ipc.localhost`。

### 1.3 D5 结论

当前打包表面上 CSP/IPC 拒绝为 **0 条**，打开与保存 IPC 均正常返回；旧 CSP 的同类 bundle
首次启动稳定产生 **10 条拒绝 + 10 条 fallback error**。本轮看见了旧配置失败，也看见了当前配置干净。

## 2. D6：结构分护栏真机观察

### 2.1 护栏开启：真机是否降级、toast 是否重复

| 语料 | 结构分 | 观测 |
|---|---:|---|
| `large-table.wysiwyg.md` | 57,190 | `tab.open` 16:42:53.665；Milkdown loading 16:42:53.669；16:42:53.674 切到 Source。出现 **1 条** toast，文案与合同逐字一致 |
| `many-short-nodes.wysiwyg.md` | 32,657 | `tab.open` 16:47:21.574；Milkdown loading 16:47:21.620；16:47:21.647 切到 Source。出现 **1 条** toast，文案与合同逐字一致 |

toast 原文：

`This document is too complex for WYSIWYG. Switched to Source mode for performance.`

两次均只看到一条 toast，没有看到 Rust `largeFileWarning` 与结构护栏 toast 叠成两条。

### 2.2 降级日志留痕

从 D6 的 `LOG0=10497` 起检索 `large`、`guard`、`toast`、上述 toast 文案，未找到对应的
护栏判定事件。能看到 `tab.open`、`editor.milkdown.direct.state loading=true` 和
`view.mode.change wysiwyg→source`，但没有记录结构分、阈值或“为何降级”的事件。

结论：误判/降级仍不留专用日志痕迹。

## 3. 护栏开启 / 关闭的同会话对照

关闭护栏的临时改动只有：

`LARGE_DOCUMENT_STRUCTURE_THRESHOLD = Number.MAX_SAFE_INTEGER`

测完后已还原为 `25_000` 并重新构建当前 bundle。

### 3.1 PM 挂载与主线程阻塞

| 语料 | 护栏 | 结果 | 最长任务 / 栈顶证据 | UI | RSS |
|---|---|---:|---|---|---:|
| `large-table.wysiwyg.md` | 开 | 9 ms 内从 `tab.open` 走到 Source；未等到 PM ready | 未形成完整 PM 挂载样本 | 可交互 | 未单列 |
| `large-table.wysiwyg.md` | 关 | **11,394 ms**（loading→ready） | 15 s `sample`：`JSC::JSObject::countElements` **7,585** 次 top-of-stack | 挂载期间不可交互；之后恢复 | **1,027,280 KB** |
| `many-short-nodes.wysiwyg.md` | 开 | 73 ms 内从 `tab.open` 走到 Source；未等到 PM ready | 未形成完整 PM 挂载样本 | 可交互 | 未单列 |
| `many-short-nodes.wysiwyg.md` | 关 | **8,123 ms**（loading→ready） | 12 s `sample`：`JSC::JSObject::countElements` **1,824** 次；`WebCore::nextListItemHelper` **1,485** 次 | 挂载期间不可交互；之后恢复 | **585,840 KB** |
| `very-long-line.wysiwyg.md` | 开 | **155 ms**（Source→WYSIWYG，loading→ready） | 本次切换未单独捕获 Long Task 栈 | 恢复 | 未单列 |
| `dense-math.wysiwyg.md` | 开 | **13,103 ms**（关闭 very-long-line 后重挂载，loading→ready） | 与下节同一次 10 s `sample`；`countElements` 59 次 | 期间不可交互；之后恢复 | 见下节 |
| `normal-prose.wysiwyg.md` | 开/关 | **未验证** | 严重 source 样本触发停止后未继续补跑 | 未验证 | 未验证 |

`sample` 次数是 top-of-stack 命中次数，不是毫秒。

### 3.2 最高优先级：关 `very-long-line.wysiwyg.md`

测试序列：当前 tab 为 WYSIWYG 的 `very-long-line.wysiwyg.md`，关闭后回到前一个
`dense-math.wysiwyg.md`。页面 keydown 到双 rAF：

| 项 | 数值 |
|---|---:|
| 关文档到双 rAF | **13,141 ms** |
| 后继 dense-math loading→ready | **13,103 ms** |
| 10 s `sample` 中 `JSC::JSObject::countElements` | 59 次 top-of-stack |
| 稳定后 WebContent RSS | **1,135,696 KB** |

本次关闭最终恢复，没有复现 2026-09-15 的 79,197 ms；本次数字也不是“关闭自身析构”的纯成本，
它包含关闭后对 `dense-math` 的重挂载。

其余四个 WYSIWYG 档的逐一 close 开/关配对：**未验证**。原因是后续 9.96 MB 样本已产生
数分钟不可交互，本轮按“不重试掩盖、卡住即记录”停止扩展矩阵；没有拿旧日期或旧构建的 close 数补表。

### 3.3 9.96 MB `very-long-line.source.md`

该文件 9,961,475 B、结构分 3；护栏开与关都会放行。本轮在护栏关闭构建、WYSIWYG 模式打开：

| 项 | 数值 |
|---|---:|
| `file.open success` | 16:51:51.804；日志 `durationMs=25,214`，其中包含文件对话框人工停留，不当作磁盘读取净耗时 |
| PM loading=true | 16:51:52.350 |
| PM loading=false | 16:56:11.833 |
| loading→ready | **259,483 ms（4 分 19.483 秒）** |
| UI | 至少前 **120 秒**不可通过辅助功能读取；该次读取超时。最终恢复 |
| CPU | 观察点持续 **98.5%–100.0%**；ready 后 0.1% |
| RSS | 观察点在 **469,728–967,824 KB** 间震荡；ready 后 566,432 KB |
| 20 s `sample` | `JSC::JSObject::countElements` **11,175** 次 top-of-stack |

本样本在 15 分钟上限前收敛，因此不能写成“永久不响应”；但在 4 分 19.483 秒内没有 ready，
且 UI 至少 120 秒不可读。

其余四个 9.96 MB source 档：**未验证**。本轮在首个 source 档出现数分钟无响应后停止，
没有用估算或 2026-09-15/20 的旧值代替。

## 4. 逐面完成度

| 面 | 护栏开 | 护栏关 | 本轮状态 |
|---|---|---|---|
| 关文档 · very-long-line WYSIWYG | 13,141 ms | 未单独复测；该文件结构分 3，开关两版决策相同，但本句只可作 [推断] | 部分完成 |
| 关文档 · 其余四个 WYSIWYG | 未验证 | 未验证 | 未完成 |
| Source(⌃2)→WYSIWYG(⌃4)，五个 WYSIWYG 档 | very-long-line 155 ms；large-table/many-short 被降级；dense-math 13,103 ms（由关闭后重挂载取得）；normal-prose 未验证 | large-table 11,394 ms；many-short 8,123 ms；其余未验证 | 部分完成 |
| Source→WYSIWYG，五个 9.96 MB source 档 | 未验证 | very-long-line 259,483 ms；其余未验证 | 部分完成 |
| 两个大文件来回切 5 次取中位 | 未验证 | 未验证 | 未完成 |
| PM 挂载 | 见 §3.1 | 见 §3.1 | 部分完成 |
| 9.96 MB source 档标准 (1) | 未验证 | very-long-line 最终恢复；其余四形态未验证 | 部分完成 |
| 护栏真机验收 / toast 数量 / 日志留痕 | 已完成 | 不适用 | 完成 |

没有为未完成格填估算值。

## 5. 结论

### ADR-0004 标准 (1) 是否真正满足

**未验证，不能写成已满足。** 已测的 `very-long-line.source.md` 在 **259,483 ms** 后恢复，
所以这一份样本没有构成“永久无响应”；`very-long-line.wysiwyg.md` 关闭在 **13,141 ms** 后恢复。
但其余四个 9.96 MB 形态未跑，缺少能覆盖标准 (1) 的完整真机证据。

### 新护栏是否该拦的都拦下、是否放过本该拦的

- 已证实拦下：`large-table.wysiwyg`（57,190）与 `many-short-nodes.wysiwyg`（32,657），均切到 Source，均只有一条合同文案 toast。关闭护栏后两者 PM 挂载分别为 **11,394 ms**、**8,123 ms**。
- `very-long-line.wysiwyg`（结构分 3）被放行；本轮 WYSIWYG 挂载 **155 ms**，关闭到后继文档双 rAF **13,141 ms**，最终恢复。没有数字证明它在当前构建上造成永久无响应。
- `very-long-line.source`（结构分同为 3）也被放行，在 WYSIWYG 挂载耗时 **259,483 ms**，UI 至少 120 秒不可读。[推断] 若“应拦”的业务含义包括避免数分钟不可交互，则当前结构分对超长行仍失明；当前 ADR-0004 标准只写“不永久无响应”，本轮这一例最终恢复，不能据此把标准 (1) 判失败。

### D6 能否结案

**不能结案。** 直接缺口是本轮矩阵未完成：其余四个 9.96 MB source 形态、其余 close 配对、
5 次同窗口切换中位数和 normal-prose 对照均未验证。因此现在既不能证明所有形态满足标准 (1)，
也不能用本轮数据证明存在永久无响应。

如果后续完整矩阵出现不收敛样本，缺的是能覆盖该形态的判据；如果团队认为本轮已测的
**259,483 ms** 有界无响应也不可发布，则这不是现行“永久无响应”文字能判掉的结果，需按
ADR-0004 的要求在发布前显式重新裁定标准。以上两条是条件判断，不是本轮已发生的通过或失败。

## 6. 还原与工作区

- `src-tauri/tauri.conf.json` 已还原为含 `connect-src 'self' ipc: http://ipc.localhost` 的当前配置。
- `src/utils/largeDocumentGuard.ts` 已还原为 `LARGE_DOCUMENT_STRUCTURE_THRESHOLD = 25_000`。
- 最终 debug bundle 已在还原后重新构建，二进制 CSP 自检再次命中。
- 本任务没有修改 `docs/adr/`，没有修改护栏逻辑、阈值或 toast 文案，没有做性能优化。
- 会话开始前已存在 `.claude/scheduled_tasks.lock` 修改；本任务未改它，也不把它纳入提交。
