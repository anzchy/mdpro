# D6.1 — WKWebView 真机测量记录（2026-09-20）

**状态：已执行五份语料的 A/C/D 测量并完成记录；部分指标 NOT VERIFIED，D6.1 不按完整门禁通过结案。** B 按 brief 的“若尚未进入”条件均跳过，因为 A 已进入 WYSIWYG。中途会话中断、临时文件消失；保留第一轮已返回证据，并单独标记第二轮补测。未修改源码、阈值或系统设置，未截图、提交、推送或创建 PR。

## 1. 依据、代码与机器

- brief：`/private/tmp/claude-501/-Users-jackcheng-Documents-01-Coding-mac-app-mdpro/880c787d-9d0b-4f82-8ef6-6da72d46e938/scratchpad/d61-codex-brief.md`；优先于 [执行手册](20260920-d61-wkwebview-sweep-protocol.md)。
- 分支 `frontend-backend-redesign`；HEAD `fba67ff90a40e92ce9584793808c207e7c6e5a09`，带开始时已有未提交修改。本记录对应实际工作树，不是仅该提交。
- chip / RAM：**Apple M4 / 24 GB**。
- macOS：**26.3.1 (build 25D771280a)**。
- Safari / WebKit：**26.3.1**。
- 上述机器信息按 brief 原样记录。`sample` 自动生成的报告另记 **macOS 26.3.1 (25D2128)**、WebContent **21623 (21623.2.7.111.2)**；OS build 存在差异，未擅自统一。未重新探测供电、温度或后台负载。
- 二进制：本仓库 `src-tauri/target/release/bundle/macos/mdpro.app`，**release**，没有混入 debug 测量。
- 初始旧实例及 mdpro_mcp 已结束，后续进程检查无 mdpro 输出；之后执行 `pnpm tauri build --bundles app`。内部 `pnpm build` 成功，Rust release 构建成功，`.app` 成功生成；最后仅 updater 签名因 `TAURI_SIGNING_PRIVATE_KEY` 缺失退出 1，按 brief 允许继续。
- bundle mtime `2026-09-20T09:50:38.876Z`。App.tsx、largeDocumentGuard.ts、MilkdownEditor.tsx、editorStore.ts、markdown.rs 均逐项早于 bundle，检查输出 **BUNDLE IS FRESH**。
- 每份语料冷启动前结束上一测试实例，按绝对 `.app` 路径打开；按新出现的唯一 WebContent PID 关联，且核对应用进程来自本仓库 bundle。WebContent 的 PPID 为 launchd，不能仅靠父子关系关联。

## 2. 结果表

语料校验输出：`OK: reproduces plan M's recorded table (11/11)`。bytes、lines、maxLineBytes 本次实算；lines 为 UTF-8 文本 `split("\n").length`，包含末尾换行产生的空项；maxLineBytes 为 UTF-8 字节数。maxCells 来自 brief 的语料基线，headings 由 corpus check 复核。**行数不是实际 ProseMirror 节点数**。

单位 ms。R1 为首次运行；R2 为中断后补测，使用同一 release bundle。`≤` 是“至该时点已有快捷键处理证据”的近似上界，不是准确完成耗时。`0*` 表示未捕获两个连续 >80% CPU 采样点，**不等于零卡顿**。

| fixture (.wysiwyg.md) | bytes | maxCells | headings | lines | maxLineBytes | A_open_ms | A_block_ms | B_to_wysiwyg_ms | B_block_ms | C_to_source_ms | C_block_ms | D_close_ms | D_block_ms | interactive during block? | crashed/hung? |
|---|---:|---:|---:|---:|---:|---|---:|---|---|---|---:|---|---|---|---|
| very-long-line R1 | 471862 | 0 | 1 | 4 | 471845 | NOT VERIFIED | 0* | N/A | N/A | NOT VERIFIED | 0* | NOT VERIFIED | 0* | NOT VERIFIED | 采样窗口未见；非全程保证 |
| large-table R1 | 471880 | 45752 | 0 | 11439 | 45 | ≲11913 | 12004 | N/A | N/A | NOT VERIFIED | 0* | NOT VERIFIED | 0* | No | 有限时阻塞，随后恢复 |
| many-short-nodes R1 | 471867 | 0 | 0 | 32658 | 15 | ≲8261 | 7409 | N/A | N/A | NOT VERIFIED | 0* | NOT VERIFIED | 0* | No | 有限时阻塞，随后恢复 |
| dense-math R1；D=R2 | 471942 | 0 | 3444 | 20665 | 63 | ≲2372 | 1793 | N/A | N/A | NOT VERIFIED | 0* | NOT VERIFIED | 0*（R2） | No | 有限时阻塞，随后恢复；R1 D CPU 丢失 |
| normal-prose R2 | 473540 | 0 | 143 | 2575 | 420 | ≲1018 | 256 | N/A | N/A | NOT VERIFIED | 0* | NOT VERIFIED | 0* | NOT VERIFIED | R2 窗口未见；R1 中断原因未知 |

A 的就绪日志另列，避免与可交互混为一谈：

| fixture | 启动命令前 t0 → 该文档 editorLoading=false | Rust file.open durationMs | A 探针从发送请求至日志处理 | A 采样窗口 / 峰值 CPU |
|---|---:|---:|---|---|
| very-long-line R1 | 969 | 2 | 未发独立探针 | 97 点，首次点 t0+601 ms，末点 t0+25358 ms / 101.2% |
| large-table R1 | 11913 | 2 | 10827 ms | 18729 ms / 159.4% |
| many-short-nodes R1 | 8261 | 2 | 7245 ms | 15339 ms / 165.2% |
| dense-math R1 | 2372 | 1 | 1363 ms | 15099 ms / 169.2% |
| normal-prose R2 | 795 | 2 | 335 ms | 15063 ms / 116.8% |

就绪事件只采用 `tab.open` 后、对应新文档挂载后的事件；启动空编辑器也会记录 editorLoading=false，已排除。大表格/多短节点/密集数学探针在 CPU >80% 时发送，日志分别延后约 10.8/7.2/1.4 秒才出现，支持发送时不能及时处理输入。探针用 Cmd+Shift+L，不改动语料内容。普通正文峰值很短，日志在高 CPU 段后返回，无法据此写“阻塞期间 Yes”。超长行 A/C 无独立探针，不补推 Yes/No。

C、D 无可靠完成端点，故其准确完成时长保持 NOT VERIFIED；未将 dispatch 日志或 CPU 安静时点填成准确完成时间。D 均按 brief 的 A→B→C→D 顺序，在 **Source 模式下关闭**。关闭后空编辑器重新进入 WYSIWYG 的日志不是关闭完成端点。

## 3. 热点

以下是 `sample <WebContent PID> 10 -file ...` 的 top-of-stack 命中次数，**不是毫秒**，且汇总涉及所有线程；忽略等待线程后列出可识别帧。JS JIT 帧部分显示 `???`，没有函数名的帧不得擅自命名为 Milkdown/ProseMirror 内部算法。

| fixture / action | 可识别活跃帧（命中次数） | 可支持的解释 |
|---|---|---|
| very-long-line R1 A | `JSC::Yarr::Interpreter<char16_t>::matchDisjunction` 13；`WebCore::RenderBox::mapLocalToContainer` 12 | 此次启动采样大部分为等待：主线程 8375 点中 8163 点处于 RunLoop 等待；没有捕获历史长阻塞 |
| very-long-line R1 C | `WebCore::WidthIterator::advance` 21；CoreText `TOpenTypePositioningEngine::PositionRuns` 8 | 文字度量/排版活动，非持续长阻塞的因果证明 |
| large-table R1 A | `JSC::JSObject::countElements` 7370；`operationArrayIndexOfNonStringIdentityValueContiguous` 76；`JSC::JSFinalObject::visitChildren` 40 | JS 对象/数组处理活跃；另有 `__gettimeofday` 6726，不能自动归因到主线程表格算法 |
| many-short-nodes R1 A | `JSC::JSObject::countElements` 1812；`WebCore::nextListItemHelper` 1329；`JSC::JSArray::unshiftCountWithArrayStorage` 970 | 除共有对象处理外，还有列表布局与数组搬移成本 |
| dense-math R1 A | `operationStringIndexOfWithIndexWithOneChar` 210；`JSC::JSObject::visitChildren` 61；`JSC::JSObject::countElements` 53 | 字符串查找、对象遍历活动；不能据文件名推断为数学排版引擎成本 |
| normal-prose R2 A | `pas_thread_local_cache_for_all` 13；`JSC::DFG::runPhase<...BackwardsPropagationPhase>` 8；`JSC::Yarr::Interpreter<char16_t>::testCharacterClass` 5 | 多数时间为等待；未出现与大表格相当的持续热点 |

超长行与大表格的已捕获活跃帧不同，但超长行此次未出现长阻塞，**不能宣称已证明历史两种长阻塞有不同根因**。大表格与多短节点反而共享 `countElements` 热点；不能仅凭帧名确定上层调用或复杂度。

## 4. 判据结论

本轮支持：**单表单元格数不足以作为唯一风险变量**。同在约 472 KB 的语料中，零表格的 many-short-nodes 出现约 7.4 秒连续高 CPU，输入处理延迟约 7.2 秒；因此一个将零单元格视为无风险的判据会漏掉已观测到的停顿。大表格最慢，支持将表格结构纳入候选变量，但未证明“最大单表单元格数”比总单元格数、总节点数或其他结构量更有解释力。

最长行达 471845 字节的 very-long-line 在本轮 A/C/Source-close 路径没有重现历史长阻塞，故也不支持用最长行作为唯一排序变量；这并不排除其他关闭路径的长行风险。较稳妥的研究方向是**表格规模与节点/列表结构的组合**，保留最长行候选，进一步用分档、控制变量语料验证。实际节点数未测，五份语料各一次有效主测量且中途环境中断，不能拟合可靠阈值、因果模型或跨机器指标。

历史 55766 ms / 79197 ms 未填入本次表格。本次 D 是 Source-close，**直接关闭 WYSIWYG 的历史最坏路径仍 NOT VERIFIED**。本记录可供 D6.2 评估候选变量，但不足以自行批准新阈值或 release gate；未设置任何毫秒阻塞门禁。

## 5. 仪器诚实性与未测项

- `*_block_ms` 全部为 shell 约每 250 ms 读取 WebContent `ps %cpu`、按连续 >80% 的首末点差计算的 **CPU-pegging 估计**，不是 Web Inspector Timeline 主线程阻塞时长。命令执行开销使实际间隔约 250–262 ms；一个高点按给定算法得到 0。`ps` 的时间平滑、后台线程和 JIT/GC 均会影响数值。
- A 在识别新 WebContent 后才开始采样；多数 C/D 采样在 AppleScript 返回后开始，前面的短时段可能漏采。仅超长行 C 采用并行计时采样。不得将 0 理解为没有短暂停顿。
- A 的日志/探针时间为 shell 发起操作至 Rust 收到异步日志的近似尺度，含启动/调度；不是精确呈现完成时间。不作小于 50 ms 的时长结论。没有使用固定延迟 500 ms 的 `editor.milkdown.dom.check` 作为计时端点。
- `sample` 本身、CPU 轮询和侧栏探针会引入测量扰动；侧栏开关也可能影响布局。未运行无探针对照；没有重复样本、分位数或统计显著性结论。
- C/D 有 dispatch、后续探针等证据，但没有可靠卸载/挂载完成日志；准确耗时 NOT VERIFIED。部分 A 探针不是在阻塞期间完成，不能声称全程可交互。
- **护栏没有专门决策日志，生产中的护栏决策不可直接观测。** 这是 brief 提供的源码调查结论。本轮语料均低于护栏，不构成护栏触发实验，也不将日志窗口没有事件写成触发/未触发的强证明。关闭后自动回 WYSIWYG 的 mode.change 亦不能解释为护栏事件。不修复该缺口。
- R1 中断后临时 CPU/sample 文件消失；已返回数值与热点摘录保存在对话工具输出及本记录，不能重新审阅其完整原始栈。持久日志仍在 `~/.mdpro/mdpro.log`。R2 CPU 原始点与日志摘要直接写入本文附录，防止再次丢失。
- R1 普通正文已记录 18:12:42 打开、18:12:57 切 Source、18:12:59 探针；尚无 D 事件。18:15:23 应用重新启动。是否用户重启、系统故障、应用故障尚未确认，**全程“无 crash/永久 hang”不判通过，也不反推 mdpro 导致系统中断**。
- R2 是补齐丢失证据，不能覆盖 R1 中断；两轮分列，不作为同一受控环境的重复实验。没有为某个卡死动作强杀恢复的已确认证据；重启夹具时使用 SIGTERM 清理旧实例。

## 6. 复核索引与执行边界

第一轮持久日志按字节窗口读取（半开区间，避免全局 grep 的负向误判）：

| fixture / action | 日志字节区间 | 应用 PID / WebContent PID |
|---|---|---|
| very-long-line A | [2379068,2386441) | 55142 / 55154 |
| very-long-line C | [2386828,2388207) | 55142 / 55154 |
| very-long-line D | [2388207,2392004) | 55142 / 55154 |
| large-table A / C / D | [2392004,2399797) / [2399797,2400994) / [2400994,2404785) | 58921 / 58941 |
| many-short-nodes A / C / D | [2404785,2412429) / [2412429,2414300) / [2414300,2418295) | 60737 / 60757 |
| dense-math A / C | [2418295,2425695) / [2425695,2426942) | 62432 / 62451 |
| normal-prose R2 A / C / D | [2442886,2450496) / [2450496,2452176) / [2452176,2455582) | 10120 / 10139 |
| dense-math R2 D | [2463725,2467127) | 11785 / 11788 |

执行遇到的环境错误及恢复：

- 沙箱内 `osascript -e 'tell application "System Events" to tell process "Codex" to get name of windows'` 返回 `64:68: execution error: An error of type -10827 has occurred. (-10827)`；`ps -Ao pid,ppid,lstart,comm` 返回 `zsh:1: operation not permitted: ps`。沙箱外进程检查成功。
- 按名称查询 `Codex` 返回 `Can’t get process "Codex". (-1728)`；改为按已验证 mdpro PID 查询窗口，成功返回 `mdpro`。后续 Ctrl+2/Cmd+W/Cmd+Shift+L 均成功，并有新增日志阳性证据。未出现 brief 要求停止的 -1719 / -25211，未改动辅助功能设置。
- 两次沙箱外命令自动审批超时，各按工具允许重试一次并成功；不是安全拒绝或应用性能失败。
- 原测量会话在 continue 后返回 `write_stdin failed: Unknown process id 71370`，沙箱内外均确认 `/private/tmp/d61-*.cpu.json` 不存在。故未声称这些原始文件仍可下载。
- 仓库仅新增本记录；原有修改不动。构建产物及 /tmp 的测量文件属于执行产物，没有添加源码/测试/阈值。

## 7. 附录：逐步保全的原始证据

以下保留中断恢复时的记载及 R2 摘要。若附录写“尚未补测”，指该时点状态；最终覆盖范围以上表为准。

## 已恢复的第一轮证据（18:20 保存）

测量会话中断后，原会话 ID 返回 Unknown process id，/tmp/d61-* 临时文件已不在；以下数值来自中断前已经返回的工具输出，未重新估算。持久日志仍在 ~/.mdpro/mdpro.log。18:15:23 应用重新启动，当前进程 PID 696；中断/系统重启原因待确认，不能归因为 mdpro 崩溃，也不能记为全程无崩溃。

| fixture | A CPU 连续 >80% ms | C CPU 连续 >80% ms | D CPU 连续 >80% ms | A 采样窗口/峰值 | 探针证据 |
|---|---:|---:|---|---|---|
| very-long-line | 0（单个 >80% 点） | 0 | 0 | 97 点 / 101.2% | A/C 未发独立探针；D 探针 18:10:04.328 发送、04.527 处理 |
| large-table | 12004 | 0 | 0 | 18729 ms / 159.4% | A 探针 18:10:19.839 发送、30.666 处理，延迟 10827 ms |
| many-short-nodes | 7409 | 0 | 0 | 15339 ms / 165.2% | A 探针 18:11:09.754 发送、16.999 处理，延迟 7245 ms |
| dense-math | 1793 | 0 | NOT VERIFIED（输出丢失） | 15099 ms / 169.2% | A 探针 18:11:56.420 发送、57.783 处理，延迟 1363 ms |
| normal-prose | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | 输出未返回，原始 CPU 文件丢失 | 日志确认 A 就绪和 C dispatch；没有 D 事件 |

第一轮 B 均为 N/A：在 A 中已进入 WYSIWYG。C/D 的准确完成时间均 NOT VERIFIED，未使用日志差冒充。D 是 Source 模式下关闭，不是直接关闭 WYSIWYG。

本次 release 构建成功生成 .app，最后因 TAURI_SIGNING_PRIVATE_KEY 缺失退出 1，仅影响 updater 签名。bundle mtime=2026-09-20T09:50:38.876Z，指定五份源码逐项均早于 bundle，输出 BUNDLE IS FRESH。

sample 自动带出 OS Version: macOS 26.3.1 (25D2128)，与 brief 原样提供的 build 25D771280a 不同；WebContent Version: 21623 (21623.2.7.111.2)。保留两者，不擅自消除差异。

热点摘录（样本命中次数，不是毫秒；忽略等待线程）：
- very-long-line A：JSC::Yarr::Interpreter<char16_t>::matchDisjunction 13，WebCore::RenderBox::mapLocalToContainer 12；主线程 8375 次中 8163 次处于 RunLoop 等待。C：WebCore::WidthIterator::advance 21，CoreText TOpenTypePositioningEngine::PositionRuns 8。未捕获持续长阻塞。
- large-table A：JSC::JSObject::countElements 7370，operationArrayIndexOfNonStringIdentityValueContiguous 76，JSC::JSFinalObject::visitChildren 40；__gettimeofday 6726 为全进程汇总，不能自动归因为主线程/表格算法。
- many-short-nodes A：JSC::JSObject::countElements 1812，WebCore::nextListItemHelper 1329，JSC::JSArray::unshiftCountWithArrayStorage 970。
- dense-math A：operationStringIndexOfWithIndexWithOneChar 210，JSC::JSObject::visitChildren 61，JSC::JSObject::countElements 53。
- normal-prose：热点未恢复。

已捕获的节点型与表格型成本足以说明仅单表单元格数不能覆盖本轮全部显著停顿；最长行在本轮不是最慢项，尚不能作为唯一变量。未测实际节点数，只有行数，不能建立节点数的定量关系或新阈值。

### 第二轮 normal-prose A 原始摘要

```json
{
  "round": 2,
  "fixture": "normal-prose",
  "action": "A",
  "apid": "10120",
  "pid": "10139",
  "t0": 1789899834236,
  "offset": 2442886,
  "end": 2450496,
  "windowMs": 15063,
  "longestPeggedSpanMs": 256,
  "peak": 116.8,
  "probe": {
    "sentAt": 1789899834919,
    "cpu": 95.4,
    "relativeMs": 683
  },
  "error": null,
  "events": [
    {
      "ts": "2026-09-20T18:23:54.711+08:00",
      "level": "info",
      "event": "editor.milkdown.direct.state",
      "status": "success",
      "actionId": "a9ab121b-c3ba-463b-96ec-856b2eb9a6f4",
      "context": {
        "editorLoading": true,
        "hasInstance": false
      },
      "durationMs": null,
      "error": null
    },
    {
      "ts": "2026-09-20T18:23:54.719+08:00",
      "level": "info",
      "event": "editor.milkdown.direct.state",
      "status": "success",
      "actionId": "74a04e8d-0793-4ffb-b8ba-a32970aed000",
      "context": {
        "editorLoading": false,
        "hasInstance": true
      },
      "durationMs": null,
      "error": null
    },
    {
      "ts": "2026-09-20T18:23:54.732+08:00",
      "level": "info",
      "event": "file.open",
      "status": "start",
      "actionId": "2913e4a0-1592-4027-ac54-e045f53e2cf6",
      "context": {
        "encodingHint": null,
        "filePath": "/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/normal-prose.wysiwyg.md"
      },
      "durationMs": null,
      "error": null
    },
    {
      "ts": "2026-09-20T18:23:54.734+08:00",
      "level": "info",
      "event": "file.open",
      "status": "success",
      "actionId": "2913e4a0-1592-4027-ac54-e045f53e2cf6",
      "context": {
        "encoding": "UTF-8",
        "filePath": "/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/normal-prose.wysiwyg.md",
        "fileSizeBytes": 473540
      },
      "durationMs": 2,
      "error": null
    },
    {
      "ts": "2026-09-20T18:23:54.738+08:00",
      "level": "info",
      "event": "tab.open",
      "status": "success",
      "actionId": "92baf37d-0ba1-4431-afb3-74b158b346c4",
      "context": {
        "documentId": "750492cd37f749a9",
        "filePath": "/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/normal-prose.wysiwyg.md",
        "tabIndex": 0
      },
      "durationMs": null,
      "error": null
    },
    {
      "ts": "2026-09-20T18:23:54.740+08:00",
      "level": "info",
      "event": "editor.milkdown.direct.state",
      "status": "success",
      "actionId": "71b90cf4-4137-4bdc-8346-8bd7d50f22b7",
      "context": {
        "editorLoading": true,
        "hasInstance": false
      },
      "durationMs": null,
      "error": null
    },
    {
      "ts": "2026-09-20T18:23:55.031+08:00",
      "level": "info",
      "event": "editor.milkdown.direct.state",
      "status": "success",
      "actionId": "f76bfa9d-7420-44e5-bf82-ebcdfa2f784f",
      "context": {
        "editorLoading": false,
        "hasInstance": true
      },
      "durationMs": null,
      "error": null
    },
    {
      "ts": "2026-09-20T18:23:55.254+08:00",
      "level": "info",
      "event": "ui.shortcut.trigger",
      "status": "success",
      "actionId": "2ec6cc59-97c2-4427-bac4-1b7ab549a723",
      "context": {
        "action": "view.toggle_sidebar",
        "shortcut": "Cmd+Shift+L"
      },
      "durationMs": null,
      "error": null
    }
  ]
}
```

```text
Sort by top of stack, same collapsed (when >= 5):
        __psynch_cvwait  (in libsystem_kernel.dylib)        67294
        __workq_kernreturn  (in libsystem_kernel.dylib)        29169
        mach_msg2_trap  (in libsystem_kernel.dylib)        8203
        pas_thread_local_cache_for_all  (in JavaScriptCore)        13
        start_wqthread  (in libsystem_pthread.dylib)        11
        JSC::DFG::runPhase<JSC::DFG::BackwardsPropagationPhase>(JSC::DFG::Graph&)  (in JavaScriptCore)        8
        pas_thread_local_cache_flush_deallocation_log  (in JavaScriptCore)        6
        syscall_thread_switch  (in libsystem_kernel.dylib)        6
        JSC::Yarr::Interpreter<char16_t>::testCharacterClass(JSC::Yarr::CharacterClass*, char32_t)  (in JavaScriptCore)        5
        _platform_memmove  (in libsystem_platform.dylib)        5


```

CPU 原始点 [相对 ms, %cpu]：
```json
[[430,33.7],[683,95.4],[939,116.8],[1193,53.8],[1450,20.7],[1707,11.6],[1964,5.2],[2221,2.9],[2476,1.5],[2732,0.5],[2990,0.3],[3247,0.1],[3504,0.4],[3759,0.2],[4017,0.1],[4275,0.1],[4532,0.1],[4790,0.1],[5048,0.1],[5306,0],[5564,0],[5822,0],[6081,0],[6338,0],[6595,0],[6852,0],[7110,0],[7368,0],[7625,0],[7881,0],[8138,0],[8395,0],[8653,0],[8910,0],[9166,0.1],[9422,0],[9678,0.4],[9935,0.2],[10190,0.2],[10447,0.1],[10700,0],[10953,0.1],[11209,0],[11465,0.1],[11721,0.2],[11977,0.1],[12233,0],[12490,0],[12747,0],[13003,0],[13261,0],[13518,0],[13775,0],[14032,0],[14289,0],[14548,0],[14805,0],[15063,0]]
```

### 第二轮 normal-prose C 原始摘要

```json
{
  "round": 2,
  "fixture": "normal-prose",
  "action": "C",
  "apid": "10120",
  "pid": "10139",
  "t0": 1789899849303,
  "offset": 2450496,
  "end": 2452176,
  "windowMs": 15110,
  "longestPeggedSpanMs": 0,
  "peak": 17.9,
  "probe": {
    "sentAt": 1789899851020,
    "cpu": 5.3,
    "relativeMs": 1717
  },
  "error": null,
  "events": [
    {
      "ts": "2026-09-20T18:24:09.545+08:00",
      "level": "info",
      "event": "view.mode.change",
      "status": "success",
      "actionId": "4f4418ea-eea5-4a7e-af74-f28127170704",
      "context": {
        "fromMode": "wysiwyg",
        "source": "setViewMode",
        "toMode": "source"
      },
      "durationMs": null,
      "error": null
    },
    {
      "ts": "2026-09-20T18:24:11.197+08:00",
      "level": "info",
      "event": "ui.shortcut.trigger",
      "status": "success",
      "actionId": "49d6ae06-087e-4206-9065-efc90a29c9d2",
      "context": {
        "action": "view.toggle_sidebar",
        "shortcut": "Cmd+Shift+L"
      },
      "durationMs": null,
      "error": null
    }
  ]
}
```

```text
Sort by top of stack, same collapsed (when >= 5):
        __psynch_cvwait  (in libsystem_kernel.dylib)        67947
        __workq_kernreturn  (in libsystem_kernel.dylib)        20772
        mach_msg2_trap  (in libsystem_kernel.dylib)        8416
        pas_thread_local_cache_for_all  (in JavaScriptCore)        7
        JSC::DFG::CPSRethreadingPhase::run()  (in JavaScriptCore)        6
        start_wqthread  (in libsystem_pthread.dylib)        6
        pas_thread_local_cache_flush_deallocation_log  (in JavaScriptCore)        5
        syscall_thread_switch  (in libsystem_kernel.dylib)        5


```

CPU 原始点 [相对 ms, %cpu]：
```json
[[182,0],[436,17.9],[691,9.6],[952,4.7],[1208,9.9],[1461,9.4],[1717,5.3],[1973,17.3],[2230,6.8],[2488,2.9],[2743,1.2],[3001,0.5],[3258,0.4],[3515,0.2],[3773,0.1],[4030,0.2],[4287,0.1],[4544,0.1],[4802,0],[5065,0],[5322,0],[5579,0],[5844,0],[6102,0],[6358,0],[6617,0],[6874,0],[7131,0],[7388,0],[7646,0],[7903,0],[8161,0],[8417,0],[8674,0],[8931,0],[9187,0],[9446,0],[9703,0],[9962,0],[10220,12.3],[10473,6.4],[10731,2.3],[10988,0.9],[11245,2.1],[11503,0.8],[11761,0.4],[12018,0.2],[12274,0.1],[12532,0.1],[12790,0.1],[13049,0],[13306,0],[13564,0],[13822,0],[14079,0],[14336,0],[14595,0],[14853,0],[15110,0]]
```

### 第二轮 normal-prose D 原始摘要

```json
{
  "round": 2,
  "fixture": "normal-prose",
  "action": "D",
  "apid": "10120",
  "pid": "10139",
  "t0": 1789899864415,
  "offset": 2452176,
  "end": 2455582,
  "windowMs": 15092,
  "longestPeggedSpanMs": 0,
  "peak": 10.8,
  "probe": {
    "sentAt": 1789899866134,
    "cpu": 0.2,
    "relativeMs": 1719
  },
  "error": null,
  "events": [
    {
      "ts": "2026-09-20T18:24:24.606+08:00",
      "level": "info",
      "event": "ui.shortcut.trigger",
      "status": "success",
      "actionId": "76e7f3bf-dd6b-4ed6-8c12-065902d696e3",
      "context": {
        "action": "file.close",
        "shortcut": "Cmd+W"
      },
      "durationMs": null,
      "error": null
    },
    {
      "ts": "2026-09-20T18:24:24.611+08:00",
      "level": "info",
      "event": "file.close",
      "status": "success",
      "actionId": "2b1407e1-d477-4b16-9e32-81550d6461cb",
      "context": {
        "documentId": "750492cd37f749a9",
        "filePath": "/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/normal-prose.wysiwyg.md"
      },
      "durationMs": null,
      "error": null
    },
    {
      "ts": "2026-09-20T18:24:24.621+08:00",
      "level": "info",
      "event": "view.mode.change",
      "status": "success",
      "actionId": "2fcdccb8-e8a2-4c1a-9e5a-065f12718da9",
      "context": {
        "fromMode": "source",
        "source": "setViewMode",
        "toMode": "wysiwyg"
      },
      "durationMs": null,
      "error": null
    },
    {
      "ts": "2026-09-20T18:24:24.622+08:00",
      "level": "info",
      "event": "editor.milkdown.direct.state",
      "status": "success",
      "actionId": "ee18efbd-f6aa-4512-a7a8-a5bff30db808",
      "context": {
        "editorLoading": true,
        "hasInstance": false
      },
      "durationMs": null,
      "error": null
    },
    {
      "ts": "2026-09-20T18:24:24.629+08:00",
      "level": "info",
      "event": "editor.milkdown.direct.state",
      "status": "success",
      "actionId": "d3a2c23f-7573-4a81-86a9-1c88240c476e",
      "context": {
        "editorLoading": false,
        "hasInstance": true
      },
      "durationMs": null,
      "error": null
    },
    {
      "ts": "2026-09-20T18:24:26.308+08:00",
      "level": "info",
      "event": "ui.shortcut.trigger",
      "status": "success",
      "actionId": "88e68364-b987-4fcd-b9c1-957cb492bcbb",
      "context": {
        "action": "view.toggle_sidebar",
        "shortcut": "Cmd+Shift+L"
      },
      "durationMs": null,
      "error": null
    }
  ]
}
```

```text
Sort by top of stack, same collapsed (when >= 5):
        __psynch_cvwait  (in libsystem_kernel.dylib)        43480
        __workq_kernreturn  (in libsystem_kernel.dylib)        20016
        mach_msg2_trap  (in libsystem_kernel.dylib)        8568
        pas_thread_local_cache_for_all  (in JavaScriptCore)        5


```

CPU 原始点 [相对 ms, %cpu]：
```json
[[187,0],[441,5.6],[697,3.3],[954,1.7],[1210,0.7],[1463,0.3],[1719,0.2],[1976,0.1],[2232,0.9],[2490,0.4],[2748,0.2],[3003,0.2],[3260,0.2],[3517,0.1],[3775,0.1],[4032,0.1],[4290,0.1],[4548,0.1],[4806,0],[5063,0],[5320,0],[5578,0.1],[5836,0.1],[6093,0],[6350,0],[6608,0],[6865,0],[7123,0],[7380,0],[7637,0],[7894,0],[8152,0],[8411,0],[8668,0],[8926,0],[9182,0],[9439,0],[9697,0],[9953,10.8],[10210,5.9],[10463,2.3],[10720,0.8],[10977,0.5],[11235,0.2],[11492,0.1],[11749,0],[12006,0],[12263,0],[12520,0],[12777,0],[13030,0],[13288,0],[13546,0],[13803,0],[14060,0],[14318,0],[14575,0],[14834,0],[15092,0]]
```

### 第二轮 dense-math D 原始摘要

```json
{
  "round": 2,
  "fixture": "dense-math",
  "action": "D",
  "apid": "11785",
  "pid": "11788",
  "t0": 1789899957986,
  "offset": 2463725,
  "end": 2467127,
  "windowMs": 15096,
  "longestPeggedSpanMs": 0,
  "peak": 13.2,
  "probe": {
    "sentAt": 1789899959721,
    "cpu": 0.2
  },
  "events": [
    {
      "ts": "2026-09-20T18:25:58.185+08:00",
      "level": "info",
      "event": "ui.shortcut.trigger",
      "status": "success",
      "actionId": "a53c92d3-29ee-494e-af2c-04d1389ed1fb",
      "context": {
        "action": "file.close",
        "shortcut": "Cmd+W"
      },
      "durationMs": null,
      "error": null
    },
    {
      "ts": "2026-09-20T18:25:58.190+08:00",
      "level": "info",
      "event": "ui.toc.coordination.reset",
      "status": "success",
      "actionId": "ba02ccf8-d812-4a26-8b29-313eef59b4be",
      "context": {
        "documentId": "1c3d1a71ed567027"
      },
      "durationMs": null,
      "error": null
    },
    {
      "ts": "2026-09-20T18:25:58.190+08:00",
      "level": "info",
      "event": "tab.close",
      "status": "success",
      "actionId": "a7cc86ad-1b40-4b3a-ae8f-03fc77d70e69",
      "context": {
        "documentId": "1c3d1a71ed567027",
        "filePath": "/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/dense-math.wysiwyg.md",
        "wasModified": false
      },
      "durationMs": null,
      "error": null
    },
    {
      "ts": "2026-09-20T18:25:58.190+08:00",
      "level": "info",
      "event": "file.close",
      "status": "success",
      "actionId": "a7cc86ad-1b40-4b3a-ae8f-03fc77d70e69",
      "context": {
        "documentId": "1c3d1a71ed567027",
        "filePath": "/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/dense-math.wysiwyg.md"
      },
      "durationMs": null,
      "error": null
    },
    {
      "ts": "2026-09-20T18:25:58.213+08:00",
      "level": "info",
      "event": "view.mode.change",
      "status": "success",
      "actionId": "288935c4-1f7e-4035-975a-f32190d912b4",
      "context": {
        "fromMode": "source",
        "source": "setViewMode",
        "toMode": "wysiwyg"
      },
      "durationMs": null,
      "error": null
    },
    {
      "ts": "2026-09-20T18:25:58.214+08:00",
      "level": "info",
      "event": "ui.toc.spy.detach",
      "status": "success",
      "actionId": "b03ca0d5-a86a-4800-89a0-0084838c88a3",
      "context": {
        "documentId": null,
        "mode": "source"
      },
      "durationMs": null,
      "error": null
    },
    {
      "ts": "2026-09-20T18:25:58.214+08:00",
      "level": "info",
      "event": "editor.milkdown.mount",
      "status": "success",
      "actionId": "56376878-52c0-4051-a33e-beb1a8cf6d8f",
      "context": {
        "contentLength": 0,
        "documentId": null,
        "hasContent": false
      },
      "durationMs": null,
      "error": null
    },
    {
      "ts": "2026-09-20T18:25:58.214+08:00",
      "level": "info",
      "event": "editor.milkdown.direct.state",
      "status": "success",
      "actionId": "c016db7e-1c28-4e51-a089-5d07f31878a9",
      "context": {
        "editorLoading": true,
        "hasInstance": false
      },
      "durationMs": null,
      "error": null
    },
    {
      "ts": "2026-09-20T18:25:58.218+08:00",
      "level": "info",
      "event": "editor.milkdown.factory.direct",
      "status": "start",
      "actionId": "e255d288-7884-4cd2-8bc9-4efd1e14bc47",
      "context": {
        "hasRoot": true,
        "initialMarkdownLength": 0
      },
      "durationMs": null,
      "error": null
    },
    {
      "ts": "2026-09-20T18:25:58.225+08:00",
      "level": "info",
      "event": "editor.milkdown.direct.state",
      "status": "success",
      "actionId": "12fb66a9-6ad1-4616-bab9-9a4aa7bb26cb",
      "context": {
        "editorLoading": false,
        "hasInstance": true
      },
      "durationMs": null,
      "error": null
    },
    {
      "ts": "2026-09-20T18:25:58.225+08:00",
      "level": "info",
      "event": "editor.milkdown.listener.registered",
      "status": "success",
      "actionId": "dac8c38a-075a-4209-a9b8-fbbae0ed9b58",
      "context": {
        "documentId": null
      },
      "durationMs": null,
      "error": null
    },
    {
      "ts": "2026-09-20T18:25:58.715+08:00",
      "level": "info",
      "event": "editor.milkdown.dom.check",
      "status": "success",
      "actionId": "0035643f-e34f-4730-b0a0-dc9b577e405c",
      "context": {
        "hasMilkdownRoot": true,
        "hasProseMirror": true,
        "hasRoot": true,
        "proseMirrorChildCount": 1,
        "proseMirrorInnerHTMLLength": 45
      },
      "durationMs": null,
      "error": null
    },
    {
      "ts": "2026-09-20T18:25:59.905+08:00",
      "level": "info",
      "event": "ui.shortcut.trigger",
      "status": "success",
      "actionId": "4e26c893-db2c-4fc6-9285-a16c9d8b5bfe",
      "context": {
        "action": "view.toggle_sidebar",
        "shortcut": "Cmd+Shift+L"
      },
      "durationMs": null,
      "error": null
    }
  ]
}
```

CPU 原始点：
```json
[[194,0],[449,13.2],[706,3.8],[964,2.8],[1221,1],[1478,0.5],[1735,0.2],[1992,1.1],[2249,0.4],[2506,0.2],[2763,0.1],[3020,0.1],[3277,0.1],[3532,0.1],[3789,0.1],[4045,0.1],[4302,0.1],[4559,0.1],[4816,0],[5073,0],[5331,0],[5588,0],[5847,0],[6104,0],[6362,0],[6621,0],[6879,0],[7136,0],[7393,0],[7652,0],[7908,0],[8166,0],[8424,0],[8682,0],[8939,0],[9198,0],[9456,0],[9714,0],[9971,0],[10228,0],[10482,0],[10738,0.1],[10994,0.1],[11251,0],[11507,0],[11763,0],[12020,0],[12276,0],[12533,0],[12789,0],[13044,0],[13300,0],[13558,0],[13815,0],[14073,0],[14327,0],[14585,0],[14843,0]]
```


## 2026-09-20 D6.1-b — WYSIWYG 关闭与文档切换补测

本节只追加，不修改前文。依据 `/var/folders/_k/kf42wzb57vl8c_1vcs01hp7c0000gn/T/d61b-wysiwyg-close-XXXXXX.md.E5yaoAPOsA`。使用与前文相同的 release bundle，mtime `2026-09-20T09:50:38.876Z`；六份指定源码均早于 bundle，检查输出 BUNDLE IS FRESH。不开启 Source，不重新计量 A 打开耗时。以下逐次保存证据，结束后追加汇总。

模式验证说明：源码 setViewMode 对同模式直接返回，不发 view.mode.change；默认 WYSIWYG 启动可能没有本进程模式转换日志。此情形组合使用新文档 tab.open 后的 Milkdown mount/ready、Ctrl+4 对应菜单确认、当前窗口内无 toMode:source，以及日志中最近的模式转换（注明是否来自本次启动之前），不伪造不存在的模式转换。

前置清理后的 mdpro 进程：[]。

### D6.1-b P1 very-long-line trial 1

**D6.1-b 执行停止，未测项 NOT VERIFIED：** Unexpected non-whitespace character after JSON at position 231 (line 1 column 232)

准备阶段恢复说明：首次在查询历史最近模式时，整份历史日志的旧损坏行触发 JSON 解析错误（首处 byte 882792，2026-03-31）；尚未发送关闭动作，故不算一次关闭试验。改用上一轮已验证的日志起点 byte 2379068 查询历史模式，当前每次动作仍只读自己的新字节窗口；不修复或改写应用日志。重新冷启动执行 trial 1。

前置清理后的 mdpro 进程：[]。

### D6.1-b P1 very-long-line trial 1

动作开始：2026-09-20T11:09:53.711Z；日志 offset 2483367；应用/WebContent 18795/18804。

```json
{"path":"P1","fixture":"very-long-line","trial":1,"binary":"release","setupInfo":{"setupOffset":2475223,"documentId":"53d9a25f1f829c1d","readyTs":"2026-09-20T19:09:50.490+08:00","modeMenuTs":"2026-09-20T19:09:51.094+08:00","lastMode":{"ts":"2026-09-20T18:25:58.213+08:00","level":"info","event":"view.mode.change","status":"success","actionId":"288935c4-1f7e-4035-975a-f32190d912b4","context":{"fromMode":"source","source":"setViewMode","toMode":"wysiwyg"},"durationMs":null,"error":null},"lastModePredatesLaunch":true,"appLine":"18795 /Users/jackcheng/Documents/01_Coding/mac-app/mdpro/src-tauri/target/release/bundle/macos/mdpro.app/Contents/MacOS/tauri-app","apid":"18795","wpid":"18804"},"offset":2483367,"end":2487302,"t0":1789902593711,"ended":1789902603741,"windowMs":10030,"cpuSpanMs":0,"above80Points":0,"peakCpu":10.6,"probeLatencyMs":106,"firstProbeSentAt":"2026-09-20T11:09:53.816Z","probesSent":5,"probesHandled":5,"confirmedAction":true,"recovered":true,"dead":false,"actionError":null,"quiet10s":true,"lowerBoundMarker":"2026-09-20T19:09:53.845+08:00","probes":[{"sentAt":1789902593816,"iso":"2026-09-20T11:09:53.816Z","returnedAt":1789902593914},{"sentAt":1789902595845,"iso":"2026-09-20T11:09:55.845Z","returnedAt":1789902595978},{"sentAt":1789902597870,"iso":"2026-09-20T11:09:57.870Z","returnedAt":1789902597995},{"sentAt":1789902599899,"iso":"2026-09-20T11:09:59.899Z","returnedAt":1789902600028},{"sentAt":1789902601919,"iso":"2026-09-20T11:10:01.919Z","returnedAt":1789902602050}],"events":[{"ts":"2026-09-20T19:09:53.824+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"b99fed1b-63d7-4078-9580-c1281bf3d14f","context":{"action":"file.close","shortcut":"Cmd+W"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:09:53.826+08:00","level":"info","event":"tab.close","status":"success","actionId":"3ba9f1c5-790b-4e5b-9ec1-04c7d6040b00","context":{"documentId":"53d9a25f1f829c1d","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/very-long-line.wysiwyg.md","wasModified":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:09:53.826+08:00","level":"info","event":"file.close","status":"success","actionId":"3ba9f1c5-790b-4e5b-9ec1-04c7d6040b00","context":{"documentId":"53d9a25f1f829c1d","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/very-long-line.wysiwyg.md"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:09:53.833+08:00","level":"info","event":"editor.milkdown.mount","status":"success","actionId":"d6b67331-49d1-41fe-af8b-1b4de846e5ff","context":{"contentLength":0,"documentId":null,"hasContent":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:09:53.833+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"274b77e3-04b9-4bf3-afc6-9d01d58bc4df","context":{"editorLoading":true,"hasInstance":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:09:53.845+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"ec5a54a5-bd97-4332-b849-916e187a2954","context":{"editorLoading":false,"hasInstance":true},"durationMs":null,"error":null},{"ts":"2026-09-20T19:09:53.922+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"b7bb2864-1127-4112-b1f5-c923b82808ea","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:09:55.984+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"a4e7e45f-ca83-465c-af13-b01bf8efa209","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:09:57.999+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"bd4c7fb8-4640-4047-a580-adaf5f4734dd","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:10:00.036+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"489cbb08-b6e5-4f10-8147-363cb2fe576a","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:10:02.059+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"b67711c7-ea5f-4869-99cb-60a236b59e2b","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null}]}
```

CPU [相对 ms, %cpu]：
```json
[[7,0.1],[260,10.6],[517,5],[767,1.8],[1019,1],[1265,0.4],[1521,0.3],[1771,0.3],[2023,0.1],[2267,0.2],[2524,1.6],[2775,0.6],[3024,0.5],[3277,0.2],[3524,0.2],[3777,0.1],[4029,0.2],[4274,0.1],[4529,2.8],[4781,1],[5031,0.6],[5281,0.3],[5535,0.1],[5785,0.2],[6035,0.1],[6282,0.1],[6537,1.6],[6788,0.7],[7034,0.6],[7289,0.3],[7540,0.1],[7791,0.1],[8042,0.1],[8287,0.1],[8540,2.6],[8795,1.3],[9045,0.4],[9296,0.4],[9547,0.2],[9797,0.2]]
```

热点（所有线程，命中次数非 ms）：
```text
Sort by top of stack, same collapsed (when >= 5):
        __psynch_cvwait  (in libsystem_kernel.dylib)        65011
        __workq_kernreturn  (in libsystem_kernel.dylib)        25374
        mach_msg2_trap  (in libsystem_kernel.dylib)        8405
        pas_thread_local_cache_for_all  (in JavaScriptCore)        19
        syscall_thread_switch  (in libsystem_kernel.dylib)        14
        stop_allocator  (in JavaScriptCore)        7
        start_wqthread  (in libsystem_pthread.dylib)        6
        JSC::CodeBlock::visitChildren(JSC::JSCell*, JSC::SlotVisitor&)  (in JavaScriptCore)        5
```

### D6.1-b P1 very-long-line trial 2

动作开始：2026-09-20T11:10:08.939Z；日志 offset 2495205；应用/WebContent 19327/19336。

```json
{"path":"P1","fixture":"very-long-line","trial":2,"binary":"release","setupInfo":{"setupOffset":2487302,"documentId":"53d9a25f1f829c1d","readyTs":"2026-09-20T19:10:05.722+08:00","modeMenuTs":"2026-09-20T19:10:06.304+08:00","lastMode":{"ts":"2026-09-20T18:25:58.213+08:00","level":"info","event":"view.mode.change","status":"success","actionId":"288935c4-1f7e-4035-975a-f32190d912b4","context":{"fromMode":"source","source":"setViewMode","toMode":"wysiwyg"},"durationMs":null,"error":null},"lastModePredatesLaunch":true,"appLine":"19327 /Users/jackcheng/Documents/01_Coding/mac-app/mdpro/src-tauri/target/release/bundle/macos/mdpro.app/Contents/MacOS/tauri-app","apid":"19327","wpid":"19336"},"offset":2495205,"end":2499140,"t0":1789902608939,"ended":1789902618957,"windowMs":10018,"cpuSpanMs":0,"above80Points":0,"peakCpu":7,"probeLatencyMs":99,"firstProbeSentAt":"2026-09-20T11:10:09.055Z","probesSent":5,"probesHandled":5,"confirmedAction":true,"recovered":true,"dead":false,"actionError":null,"quiet10s":true,"lowerBoundMarker":"2026-09-20T19:10:09.076+08:00","probes":[{"sentAt":1789902609055,"iso":"2026-09-20T11:10:09.055Z","returnedAt":1789902609149},{"sentAt":1789902611071,"iso":"2026-09-20T11:10:11.071Z","returnedAt":1789902611201},{"sentAt":1789902613097,"iso":"2026-09-20T11:10:13.097Z","returnedAt":1789902613225},{"sentAt":1789902615118,"iso":"2026-09-20T11:10:15.118Z","returnedAt":1789902615246},{"sentAt":1789902617137,"iso":"2026-09-20T11:10:17.137Z","returnedAt":1789902617266}],"events":[{"ts":"2026-09-20T19:10:09.061+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"e4776894-46c3-4df3-bbd3-4478a722aaa7","context":{"action":"file.close","shortcut":"Cmd+W"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:10:09.063+08:00","level":"info","event":"tab.close","status":"success","actionId":"b598c053-0f53-4ba3-92cf-ac790290abce","context":{"documentId":"53d9a25f1f829c1d","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/very-long-line.wysiwyg.md","wasModified":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:10:09.063+08:00","level":"info","event":"file.close","status":"success","actionId":"b598c053-0f53-4ba3-92cf-ac790290abce","context":{"documentId":"53d9a25f1f829c1d","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/very-long-line.wysiwyg.md"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:10:09.067+08:00","level":"info","event":"editor.milkdown.mount","status":"success","actionId":"ecbd1d5e-4905-40d0-bace-0e18ed90dccf","context":{"contentLength":0,"documentId":null,"hasContent":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:10:09.068+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"028877e7-8068-4809-b01d-9cb58a1422a3","context":{"editorLoading":true,"hasInstance":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:10:09.076+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"20e369b6-92f6-48c8-8543-dc777ca64e10","context":{"editorLoading":false,"hasInstance":true},"durationMs":null,"error":null},{"ts":"2026-09-20T19:10:09.154+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"a7721182-c584-4f1b-99a3-17094c99fa23","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:10:11.204+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"d659bf9f-eabe-4274-bafd-03f5f3b1fabb","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:10:13.228+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"913900f4-ba14-4a8a-8c77-6b6e659f72bc","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:10:15.255+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"70f9f3a9-e7c5-4053-b0bc-f7b15b50071e","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:10:17.271+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"07989c98-3886-4329-871d-df4c2cc44923","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null}]}
```

CPU [相对 ms, %cpu]：
```json
[[6,0.3],[259,7],[514,3.3],[763,2.3],[1017,0.9],[1263,0.5],[1514,0.3],[1769,0.1],[2022,0.2],[2267,0.1],[2524,0.9],[2774,0.4],[3025,0.4],[3276,0.3],[3527,0.2],[3778,0.1],[4030,0.1],[4276,0.1],[4533,0.7],[4784,0.3],[5033,0.2],[5285,0.3],[5535,0.1],[5786,0.1],[6035,0.1],[6281,0.1],[6536,1.6],[6786,0.7],[7037,0.4],[7288,0.4],[7539,0.1],[7790,0.1],[8042,0.1],[8287,0.1],[8542,3.5],[8794,1.3],[9045,0.5],[9297,0.5],[9547,0.2],[9798,0.2]]
```

热点（所有线程，命中次数非 ms）：
```text
Sort by top of stack, same collapsed (when >= 5):
        __psynch_cvwait  (in libsystem_kernel.dylib)        59242
        __workq_kernreturn  (in libsystem_kernel.dylib)        25564
        mach_msg2_trap  (in libsystem_kernel.dylib)        8493
        pas_thread_local_cache_for_all  (in JavaScriptCore)        16
        scavenger_thread_main  (in JavaScriptCore)        7
        start_wqthread  (in libsystem_pthread.dylib)        6
        stop_allocator  (in JavaScriptCore)        6
```

### D6.1-b P1 very-long-line trial 3

动作开始：2026-09-20T11:10:24.083Z；日志 offset 2507284；应用/WebContent 19861/19870。

```json
{"path":"P1","fixture":"very-long-line","trial":3,"binary":"release","setupInfo":{"setupOffset":2499140,"documentId":"53d9a25f1f829c1d","readyTs":"2026-09-20T19:10:20.873+08:00","modeMenuTs":"2026-09-20T19:10:21.437+08:00","lastMode":{"ts":"2026-09-20T18:25:58.213+08:00","level":"info","event":"view.mode.change","status":"success","actionId":"288935c4-1f7e-4035-975a-f32190d912b4","context":{"fromMode":"source","source":"setViewMode","toMode":"wysiwyg"},"durationMs":null,"error":null},"lastModePredatesLaunch":true,"appLine":"19861 /Users/jackcheng/Documents/01_Coding/mac-app/mdpro/src-tauri/target/release/bundle/macos/mdpro.app/Contents/MacOS/tauri-app","apid":"19861","wpid":"19870"},"offset":2507284,"end":2511219,"t0":1789902624083,"ended":1789902634113,"windowMs":10030,"cpuSpanMs":0,"above80Points":0,"peakCpu":6.3,"probeLatencyMs":97,"firstProbeSentAt":"2026-09-20T11:10:24.199Z","probesSent":5,"probesHandled":5,"confirmedAction":true,"recovered":true,"dead":false,"actionError":null,"quiet10s":true,"lowerBoundMarker":"2026-09-20T19:10:24.217+08:00","probes":[{"sentAt":1789902624199,"iso":"2026-09-20T11:10:24.199Z","returnedAt":1789902624293},{"sentAt":1789902626216,"iso":"2026-09-20T11:10:26.216Z","returnedAt":1789902626347},{"sentAt":1789902628238,"iso":"2026-09-20T11:10:28.238Z","returnedAt":1789902628365},{"sentAt":1789902630269,"iso":"2026-09-20T11:10:30.269Z","returnedAt":1789902630401},{"sentAt":1789902632293,"iso":"2026-09-20T11:10:32.293Z","returnedAt":1789902632423}],"events":[{"ts":"2026-09-20T19:10:24.202+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"3246fc5d-c4ed-4727-b692-bed72affdfe8","context":{"action":"file.close","shortcut":"Cmd+W"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:10:24.205+08:00","level":"info","event":"tab.close","status":"success","actionId":"9963458d-d1eb-4f7b-966a-8c949f38d70a","context":{"documentId":"53d9a25f1f829c1d","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/very-long-line.wysiwyg.md","wasModified":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:10:24.205+08:00","level":"info","event":"file.close","status":"success","actionId":"9963458d-d1eb-4f7b-966a-8c949f38d70a","context":{"documentId":"53d9a25f1f829c1d","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/very-long-line.wysiwyg.md"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:10:24.208+08:00","level":"info","event":"editor.milkdown.mount","status":"success","actionId":"aab95011-3c87-4073-8ca6-970785d009f4","context":{"contentLength":0,"documentId":null,"hasContent":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:10:24.208+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"7aef0d91-f784-45e3-914c-6a634377dec0","context":{"editorLoading":true,"hasInstance":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:10:24.217+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"3835ef58-5440-4ee4-a118-89acd7953b66","context":{"editorLoading":false,"hasInstance":true},"durationMs":null,"error":null},{"ts":"2026-09-20T19:10:24.296+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"c3e35265-27bd-4ec2-82fd-4c7f37a63e1d","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:10:26.354+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"6ee4ad9d-766f-4775-a4f1-64889a759a95","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:10:28.370+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"26263c18-3c30-4056-ac60-0757f3cac3f3","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:10:30.407+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"2dd73083-472a-4663-a8b6-2eb5928e0431","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:10:32.429+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"b1d5c497-da34-43f8-95df-f182f2248f6e","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null}]}
```

CPU [相对 ms, %cpu]：
```json
[[6,0.3],[258,6.3],[514,4.8],[762,2.2],[1016,0.9],[1261,0.6],[1517,0.4],[1768,0.3],[2018,0.2],[2264,0.2],[2518,1.1],[2769,0.4],[3023,0.4],[3272,0.2],[3523,0.2],[3774,0.1],[4023,0.1],[4270,0.1],[4526,0.7],[4778,0.4],[5027,0.2],[5279,0.2],[5531,0.1],[5782,0.1],[6032,0.1],[6279,0.1],[6532,1.6],[6784,0.7],[7035,0.5],[7286,0.4],[7538,0.1],[7789,0.1],[8040,0.1],[8285,0.1],[8542,3.5],[8791,1.3],[9043,0.7],[9294,0.3],[9544,0.1],[9795,0.1]]
```

热点（所有线程，命中次数非 ms）：
```text
Sort by top of stack, same collapsed (when >= 5):
        __psynch_cvwait  (in libsystem_kernel.dylib)        55119
        __workq_kernreturn  (in libsystem_kernel.dylib)        27023
        mach_msg2_trap  (in libsystem_kernel.dylib)        8484
        pas_thread_local_cache_for_all  (in JavaScriptCore)        22
        stop_allocator  (in JavaScriptCore)        6
        start_wqthread  (in libsystem_pthread.dylib)        5
```

### D6.1-b P1 large-table trial 1

动作开始：2026-09-20T11:10:49.288Z；日志 offset 2518855；应用/WebContent 20393/20405。

```json
{"path":"P1","fixture":"large-table","trial":1,"binary":"release","setupInfo":{"setupOffset":2511219,"documentId":"9bcf40cdc1692ed5","readyTs":"2026-09-20T19:10:45.695+08:00","modeMenuTs":"2026-09-20T19:10:46.360+08:00","lastMode":{"ts":"2026-09-20T18:25:58.213+08:00","level":"info","event":"view.mode.change","status":"success","actionId":"288935c4-1f7e-4035-975a-f32190d912b4","context":{"fromMode":"source","source":"setViewMode","toMode":"wysiwyg"},"durationMs":null,"error":null},"lastModePredatesLaunch":true,"appLine":"20393 /Users/jackcheng/Documents/01_Coding/mac-app/mdpro/src-tauri/target/release/bundle/macos/mdpro.app/Contents/MacOS/tauri-app","apid":"20393","wpid":"20405"},"offset":2518855,"end":2522784,"t0":1789902649288,"ended":1789902659330,"windowMs":10042,"cpuSpanMs":0,"above80Points":0,"peakCpu":15.5,"probeLatencyMs":106,"firstProbeSentAt":"2026-09-20T11:10:49.409Z","probesSent":5,"probesHandled":5,"confirmedAction":true,"recovered":true,"dead":false,"actionError":null,"quiet10s":true,"lowerBoundMarker":"2026-09-20T19:10:49.515+08:00","probes":[{"sentAt":1789902649409,"iso":"2026-09-20T11:10:49.409Z","returnedAt":1789902649500},{"sentAt":1789902651430,"iso":"2026-09-20T11:10:51.430Z","returnedAt":1789902651560},{"sentAt":1789902653452,"iso":"2026-09-20T11:10:53.452Z","returnedAt":1789902653579},{"sentAt":1789902655477,"iso":"2026-09-20T11:10:55.477Z","returnedAt":1789902655610},{"sentAt":1789902657503,"iso":"2026-09-20T11:10:57.503Z","returnedAt":1789902657635}],"events":[{"ts":"2026-09-20T19:10:49.418+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"c684c13d-65ad-482b-ae43-82c9ae4ef560","context":{"action":"file.close","shortcut":"Cmd+W"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:10:49.420+08:00","level":"info","event":"tab.close","status":"success","actionId":"7b5c491b-a4d5-419e-b646-faaedb1cc328","context":{"documentId":"9bcf40cdc1692ed5","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/large-table.wysiwyg.md","wasModified":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:10:49.421+08:00","level":"info","event":"file.close","status":"success","actionId":"7b5c491b-a4d5-419e-b646-faaedb1cc328","context":{"documentId":"9bcf40cdc1692ed5","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/large-table.wysiwyg.md"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:10:49.493+08:00","level":"info","event":"editor.milkdown.mount","status":"success","actionId":"02fe69fb-3117-4dc4-871c-6016a202bebc","context":{"contentLength":0,"documentId":null,"hasContent":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:10:49.493+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"7e110a28-e530-4f61-ad40-398f15ea91df","context":{"editorLoading":true,"hasInstance":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:10:49.515+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"4be2df95-1024-40cf-a560-b08c252885ef","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:10:49.515+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"20577fa1-9699-4ac9-97ed-81caea0e3ac9","context":{"editorLoading":false,"hasInstance":true},"durationMs":null,"error":null},{"ts":"2026-09-20T19:10:51.566+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"6ce76052-f643-43cf-a171-677edc654181","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:10:53.582+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"c8a4e46a-f717-45e4-8295-4f671fd98284","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:10:55.616+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"409a1d89-2ce2-4df7-afef-7b3d2e5e9418","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:10:57.642+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"fd8a031d-8bf5-4a3b-a715-f77f19f8394a","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null}]}
```

CPU [相对 ms, %cpu]：
```json
[[6,0],[259,9.9],[514,15.5],[764,7.2],[1015,10.7],[1260,4.2],[1516,1.7],[1766,0.7],[2017,0.4],[2264,0.2],[2518,5.1],[2771,2],[3022,0.6],[3273,0.4],[3524,0.3],[3775,0.2],[4025,0.1],[4271,0.1],[4526,6.2],[4777,2.4],[5027,1],[5277,0.3],[5529,0.2],[5780,0.1],[6030,0.1],[6276,0.1],[6531,1.9],[6783,0.8],[7033,0.3],[7284,0.4],[7533,0.1],[7786,0.1],[8036,0.1],[8282,0.1],[8538,1.4],[8787,0.5],[9039,0.2],[9291,0.3],[9540,0.1],[9790,0.1],[10042,0.1]]
```

热点（所有线程，命中次数非 ms）：
```text
Sort by top of stack, same collapsed (when >= 5):
        __psynch_cvwait  (in libsystem_kernel.dylib)        64569
        __workq_kernreturn  (in libsystem_kernel.dylib)        25316
        mach_msg2_trap  (in libsystem_kernel.dylib)        8361
        pas_thread_local_cache_for_all  (in JavaScriptCore)        29
        madvise  (in libsystem_kernel.dylib)        21
        WebCore::RenderTreeUpdater::tearDownRenderers(WebCore::Element&, WebCore::RenderTreeUpdater::TeardownType, WebCore::RenderTreeBuilder&)  (in WebCore)        9
        WebCore::JSCSSStyleDeclaration::visitAdditionalChildren<JSC::SlotVisitor>(JSC::SlotVisitor&)  (in WebCore)        7
        WebCore::JSNode::visitAdditionalChildren<JSC::SlotVisitor>(JSC::SlotVisitor&)  (in WebCore)        7
        JSC::WeakMapImpl<JSC::WeakMapBucket<JSC::WeakMapBucketDataKeyValue>>::visitOutputConstraints<JSC::SlotVisitor>(JSC::JSCell*, JSC::SlotVisitor&)  (in JavaScriptCore)        6
        WebCore::Node::opaqueRoot() const  (in WebCore)        6
        start_wqthread  (in libsystem_pthread.dylib)        6
        syscall_thread_switch  (in libsystem_kernel.dylib)        6
        JSC::Subspace::forEachMarkedCellInParallel<JSC::SlotVisitor, void WebCore::DOMGCOutputConstraint::executeImplImpl<JSC::SlotVisitor>(JSC::SlotVisitor&)::'lambda'(JSC::Subspace&)::operator()(JSC::Subspace&) const::'lambda'(JSC::SlotVisitor&, JSC::HeapCell*, JSC::HeapCell::Kind)>(void WebCore::DOMGCOutputConstraint::executeImplImpl<JSC::SlotVisitor>(JSC::SlotVisitor&)::'lambda'(JSC::Subspace&)::operator()(JSC::Subspace&) const::'lambda'(JSC::SlotVisitor&, JSC::HeapCell*, JSC::HeapCell::Kind) const&)::Task::run(JSC::SlotVisitor&)  (in WebCore)        5
        pas_thread_local_cache_flush_deallocation_log  (in JavaScriptCore)        5
```

### D6.1-b P1 large-table trial 2

动作开始：2026-09-20T11:11:14.563Z；日志 offset 2530661；应用/WebContent 20983/20992。

```json
{"path":"P1","fixture":"large-table","trial":2,"binary":"release","setupInfo":{"setupOffset":2522784,"documentId":"9bcf40cdc1692ed5","readyTs":"2026-09-20T19:11:10.932+08:00","modeMenuTs":"2026-09-20T19:11:11.425+08:00","lastMode":{"ts":"2026-09-20T18:25:58.213+08:00","level":"info","event":"view.mode.change","status":"success","actionId":"288935c4-1f7e-4035-975a-f32190d912b4","context":{"fromMode":"source","source":"setViewMode","toMode":"wysiwyg"},"durationMs":null,"error":null},"lastModePredatesLaunch":true,"appLine":"20983 /Users/jackcheng/Documents/01_Coding/mac-app/mdpro/src-tauri/target/release/bundle/macos/mdpro.app/Contents/MacOS/tauri-app","apid":"20983","wpid":"20992"},"offset":2530661,"end":2534842,"t0":1789902674563,"ended":1789902685082,"windowMs":10519,"cpuSpanMs":0,"above80Points":0,"peakCpu":23.6,"probeLatencyMs":99,"firstProbeSentAt":"2026-09-20T11:11:14.676Z","probesSent":6,"probesHandled":6,"confirmedAction":true,"recovered":true,"dead":false,"actionError":null,"quiet10s":true,"lowerBoundMarker":"2026-09-20T19:11:14.757+08:00","probes":[{"sentAt":1789902674676,"iso":"2026-09-20T11:11:14.676Z","returnedAt":1789902674772},{"sentAt":1789902676693,"iso":"2026-09-20T11:11:16.693Z","returnedAt":1789902676827},{"sentAt":1789902678712,"iso":"2026-09-20T11:11:18.712Z","returnedAt":1789902678847},{"sentAt":1789902680737,"iso":"2026-09-20T11:11:20.737Z","returnedAt":1789902680867},{"sentAt":1789902682759,"iso":"2026-09-20T11:11:22.759Z","returnedAt":1789902682884},{"sentAt":1789902684779,"iso":"2026-09-20T11:11:24.779Z","returnedAt":1789902684874}],"events":[{"ts":"2026-09-20T19:11:14.681+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"b0d40178-f5ea-449e-abac-ef070fc58cf4","context":{"action":"file.close","shortcut":"Cmd+W"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:11:14.683+08:00","level":"info","event":"file.close","status":"success","actionId":"78188669-5804-4d54-95b4-cf21b9f44d4c","context":{"documentId":"9bcf40cdc1692ed5","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/large-table.wysiwyg.md"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:11:14.683+08:00","level":"info","event":"tab.close","status":"success","actionId":"78188669-5804-4d54-95b4-cf21b9f44d4c","context":{"documentId":"9bcf40cdc1692ed5","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/large-table.wysiwyg.md","wasModified":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:11:14.744+08:00","level":"info","event":"editor.milkdown.mount","status":"success","actionId":"e1ceac52-24f5-4d2a-9622-cd9b6ed45fb8","context":{"contentLength":0,"documentId":null,"hasContent":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:11:14.744+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"07f67106-0049-4aca-8e40-bffb2a2bd6c6","context":{"editorLoading":true,"hasInstance":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:11:14.757+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"215c7713-b7c0-4cbd-8706-3d0024a7c9dd","context":{"editorLoading":false,"hasInstance":true},"durationMs":null,"error":null},{"ts":"2026-09-20T19:11:14.775+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"858a5090-c32e-4ed3-8511-cae3caca3a4a","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:11:16.833+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"36b3f100-a2c6-4dbd-a12e-0bf0f0ce646b","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:11:18.853+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"f8e49d6f-8e9f-493c-9748-13f093f670e2","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:11:20.875+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"1cff6b52-8260-4623-b542-79e6ebf42617","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:11:22.891+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"35dadf06-fcb5-4067-bddf-b2f78c68499f","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:11:24.883+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"ce0bb742-bdab-44c0-a183-b370e7c28082","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null}]}
```

CPU [相对 ms, %cpu]：
```json
[[5,0],[258,23.6],[512,9.6],[763,4.8],[1014,9.6],[1260,4],[1516,1.6],[1766,0.8],[2018,0.3],[2264,0.2],[2518,1.4],[2768,0.6],[3020,0.4],[3271,0.4],[3523,0.3],[3774,0.1],[4025,0.1],[4272,0.1],[4526,0.8],[4777,0.4],[5028,0.2],[5279,0.4],[5529,0.1],[5780,0.1],[6029,0.1],[6277,0.1],[6532,1.2],[6783,0.5],[7035,0.4],[7285,0.3],[7536,0.1],[7787,0.1],[8038,0.1],[8284,0.1],[8540,0.8],[8789,0.4],[9041,0.2],[9292,0.2],[9543,0.1],[9791,0.1],[10042,0.1],[10288,0.1]]
```

热点（所有线程，命中次数非 ms）：
```text
Sort by top of stack, same collapsed (when >= 5):
        __psynch_cvwait  (in libsystem_kernel.dylib)        58758
        __workq_kernreturn  (in libsystem_kernel.dylib)        25432
        mach_msg2_trap  (in libsystem_kernel.dylib)        8421
        madvise  (in libsystem_kernel.dylib)        20
        pas_thread_local_cache_for_all  (in JavaScriptCore)        19
        WebCore::RenderTreeUpdater::tearDownRenderers(WebCore::Element&, WebCore::RenderTreeUpdater::TeardownType, WebCore::RenderTreeBuilder&)  (in WebCore)        9
        start_wqthread  (in libsystem_pthread.dylib)        5
```

### D6.1-b P1 large-table trial 3

动作开始：2026-09-20T11:11:40.068Z；日志 offset 2542478；应用/WebContent 21559/21566。

```json
{"path":"P1","fixture":"large-table","trial":3,"binary":"release","setupInfo":{"setupOffset":2534842,"documentId":"9bcf40cdc1692ed5","readyTs":"2026-09-20T19:11:36.466+08:00","modeMenuTs":"2026-09-20T19:11:36.935+08:00","lastMode":{"ts":"2026-09-20T18:25:58.213+08:00","level":"info","event":"view.mode.change","status":"success","actionId":"288935c4-1f7e-4035-975a-f32190d912b4","context":{"fromMode":"source","source":"setViewMode","toMode":"wysiwyg"},"durationMs":null,"error":null},"lastModePredatesLaunch":true,"appLine":"21559 /Users/jackcheng/Documents/01_Coding/mac-app/mdpro/src-tauri/target/release/bundle/macos/mdpro.app/Contents/MacOS/tauri-app","apid":"21559","wpid":"21566"},"offset":2542478,"end":2546407,"t0":1789902700068,"ended":1789902710099,"windowMs":10031,"cpuSpanMs":0,"above80Points":0,"peakCpu":13.9,"probeLatencyMs":97,"firstProbeSentAt":"2026-09-20T11:11:40.185Z","probesSent":5,"probesHandled":5,"confirmedAction":true,"recovered":true,"dead":false,"actionError":null,"quiet10s":true,"lowerBoundMarker":"2026-09-20T19:11:40.264+08:00","probes":[{"sentAt":1789902700185,"iso":"2026-09-20T11:11:40.185Z","returnedAt":1789902700279},{"sentAt":1789902702206,"iso":"2026-09-20T11:11:42.206Z","returnedAt":1789902702333},{"sentAt":1789902704231,"iso":"2026-09-20T11:11:44.231Z","returnedAt":1789902704335},{"sentAt":1789902706257,"iso":"2026-09-20T11:11:46.257Z","returnedAt":1789902706388},{"sentAt":1789902708282,"iso":"2026-09-20T11:11:48.282Z","returnedAt":1789902708412}],"events":[{"ts":"2026-09-20T19:11:40.190+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"5038868f-ef25-48bf-b75d-64c7c111b511","context":{"action":"file.close","shortcut":"Cmd+W"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:11:40.193+08:00","level":"info","event":"tab.close","status":"success","actionId":"450f4157-8b0a-4c3a-9848-a9e64f187824","context":{"documentId":"9bcf40cdc1692ed5","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/large-table.wysiwyg.md","wasModified":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:11:40.193+08:00","level":"info","event":"file.close","status":"success","actionId":"450f4157-8b0a-4c3a-9848-a9e64f187824","context":{"documentId":"9bcf40cdc1692ed5","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/large-table.wysiwyg.md"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:11:40.252+08:00","level":"info","event":"editor.milkdown.mount","status":"success","actionId":"56e8315f-b9a3-4c91-82b1-100753149985","context":{"contentLength":0,"documentId":null,"hasContent":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:11:40.252+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"a94efe14-f33c-42bc-aa65-a3991e3ace95","context":{"editorLoading":true,"hasInstance":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:11:40.264+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"ed307175-a8a5-43b1-9910-ab85d424fff6","context":{"editorLoading":false,"hasInstance":true},"durationMs":null,"error":null},{"ts":"2026-09-20T19:11:40.282+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"09cdedfd-23ce-4900-9752-cc73df0b519e","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:11:42.341+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"67ed8453-ec2a-46b0-ba09-f5590a5f474c","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:11:44.341+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"c869cb02-f5a2-4956-8cca-2aaee61f133f","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:11:46.399+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"491188a9-6c26-46a8-a505-a6e9b358bb8e","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:11:48.417+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"1719b3c6-c618-4687-b078-7c23282b461f","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null}]}
```

CPU [相对 ms, %cpu]：
```json
[[5,0],[258,4.9],[510,13.9],[763,6.6],[1012,9.4],[1260,3.7],[1516,1.1],[1766,0.4],[2018,0.3],[2263,0.3],[2518,1.2],[2769,0.5],[3020,0.3],[3271,0.4],[3522,0.2],[3773,0.2],[4024,0.1],[4270,0.1],[4522,0.8],[4777,0.3],[5027,0.4],[5278,0.1],[5529,0.1],[5781,0.1],[6032,0.1],[6278,0.1],[6533,1],[6785,0.4],[7034,0.4],[7284,0.3],[7536,0.1],[7783,0.1],[8036,0.1],[8284,0.1],[8536,0.8],[8791,0.4],[9040,0.2],[9290,0.3],[9540,0.1],[9793,0.1]]
```

热点（所有线程，命中次数非 ms）：
```text
Sort by top of stack, same collapsed (when >= 5):
        __psynch_cvwait  (in libsystem_kernel.dylib)        55856
        __workq_kernreturn  (in libsystem_kernel.dylib)        25518
        mach_msg2_trap  (in libsystem_kernel.dylib)        8427
        madvise  (in libsystem_kernel.dylib)        17
        scavenger_thread_main  (in JavaScriptCore)        11
        pas_thread_local_cache_for_all  (in JavaScriptCore)        9
        WebCore::RenderTreeUpdater::tearDownRenderers(WebCore::Element&, WebCore::RenderTreeUpdater::TeardownType, WebCore::RenderTreeBuilder&)  (in WebCore)        8
        WebCore::RenderTreeBuilder::detachFromRenderElement(WebCore::RenderElement&, WebCore::RenderObject&, WebCore::RenderTreeBuilder::WillBeDestroyed)  (in WebCore)        5
        stop_allocator  (in JavaScriptCore)        5
```

### D6.1-b P1 many-short-nodes trial 1

动作开始：2026-09-20T11:12:01.525Z；日志 offset 2554570；应用/WebContent 22146/22155。

```json
{"path":"P1","fixture":"many-short-nodes","trial":1,"binary":"release","setupInfo":{"setupOffset":2546407,"documentId":"b51b085cf74834e0","readyTs":"2026-09-20T19:11:58.184+08:00","modeMenuTs":"2026-09-20T19:11:58.638+08:00","lastMode":{"ts":"2026-09-20T18:25:58.213+08:00","level":"info","event":"view.mode.change","status":"success","actionId":"288935c4-1f7e-4035-975a-f32190d912b4","context":{"fromMode":"source","source":"setViewMode","toMode":"wysiwyg"},"durationMs":null,"error":null},"lastModePredatesLaunch":true,"appLine":"22146 /Users/jackcheng/Documents/01_Coding/mac-app/mdpro/src-tauri/target/release/bundle/macos/mdpro.app/Contents/MacOS/tauri-app","apid":"22146","wpid":"22155"},"offset":2554570,"end":2558761,"t0":1789902721525,"ended":1789902732060,"windowMs":10535,"cpuSpanMs":0,"above80Points":0,"peakCpu":22.6,"probeLatencyMs":104,"firstProbeSentAt":"2026-09-20T11:12:01.647Z","probesSent":6,"probesHandled":6,"confirmedAction":true,"recovered":true,"dead":false,"actionError":null,"quiet10s":true,"lowerBoundMarker":"2026-09-20T19:12:01.723+08:00","probes":[{"sentAt":1789902721647,"iso":"2026-09-20T11:12:01.647Z","returnedAt":1789902721743},{"sentAt":1789902723666,"iso":"2026-09-20T11:12:03.666Z","returnedAt":1789902723793},{"sentAt":1789902725687,"iso":"2026-09-20T11:12:05.687Z","returnedAt":1789902725812},{"sentAt":1789902727714,"iso":"2026-09-20T11:12:07.714Z","returnedAt":1789902727845},{"sentAt":1789902729738,"iso":"2026-09-20T11:12:09.738Z","returnedAt":1789902729866},{"sentAt":1789902731757,"iso":"2026-09-20T11:12:11.757Z","returnedAt":1789902731851}],"events":[{"ts":"2026-09-20T19:12:01.652+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"16a07b3f-49bd-4a9f-87ce-6945e07afbcb","context":{"action":"file.close","shortcut":"Cmd+W"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:12:01.654+08:00","level":"info","event":"tab.close","status":"success","actionId":"d2bb590d-4b44-42fe-988b-3c3ff116f1e9","context":{"documentId":"b51b085cf74834e0","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/many-short-nodes.wysiwyg.md","wasModified":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:12:01.655+08:00","level":"info","event":"file.close","status":"success","actionId":"d2bb590d-4b44-42fe-988b-3c3ff116f1e9","context":{"documentId":"b51b085cf74834e0","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/many-short-nodes.wysiwyg.md"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:12:01.713+08:00","level":"info","event":"editor.milkdown.mount","status":"success","actionId":"c27be569-5bd7-40a4-9d29-ad2bd7b7d0c9","context":{"contentLength":0,"documentId":null,"hasContent":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:12:01.713+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"0ac10d72-40af-4896-b6ef-4daa929a4784","context":{"editorLoading":true,"hasInstance":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:12:01.723+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"84de3daf-70a4-40e3-947d-be05cc4e935d","context":{"editorLoading":false,"hasInstance":true},"durationMs":null,"error":null},{"ts":"2026-09-20T19:12:01.751+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"b0d9539d-0806-4ad4-9784-1a4ce403878a","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:12:03.803+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"71848664-6f8f-4aef-9445-dd201b90cb9c","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:12:05.821+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"21134e2f-80dc-42ad-83d5-ca0857265673","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:12:07.853+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"a3a290da-0613-457b-8137-a8e1431189ef","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:12:09.869+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"481dda18-75f6-4387-8ae6-8704a94b72a4","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:12:11.861+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"08bf0c0b-5fd6-4214-bb5f-e2f7d43fead3","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null}]}
```

CPU [相对 ms, %cpu]：
```json
[[5,0],[257,22.6],[510,9],[764,4.8],[1014,9.1],[1262,3.6],[1517,1.6],[1767,0.7],[2019,0.3],[2265,0.2],[2521,1.1],[2771,0.5],[3022,0.5],[3273,0.3],[3524,0.3],[3775,0.1],[4027,0.1],[4272,0.2],[4529,1],[4779,0.5],[5030,0.4],[5279,0.3],[5531,0.1],[5782,0.1],[6033,0.1],[6280,0.1],[6535,1.1],[6786,0.5],[7037,0.3],[7288,0.3],[7539,0.1],[7790,0.1],[8042,0.1],[8287,0.1],[8543,0.9],[8795,13.4],[9045,9.8],[9297,5.2],[9547,2.3],[9799,0.9],[10050,4.9],[10296,3.5]]
```

热点（所有线程，命中次数非 ms）：
```text
Sort by top of stack, same collapsed (when >= 5):
        __psynch_cvwait  (in libsystem_kernel.dylib)        60100
        __workq_kernreturn  (in libsystem_kernel.dylib)        26894
        mach_msg2_trap  (in libsystem_kernel.dylib)        8356
        madvise  (in libsystem_kernel.dylib)        36
        pas_thread_local_cache_for_all  (in JavaScriptCore)        18
        JSC::MarkedSpace::forEachWeakInParallel<JSC::SlotVisitor&>(JSC::SlotVisitor&)::Task::run(JSC::SlotVisitor&)  (in JavaScriptCore)        8
        pas_thread_local_cache_flush_deallocation_log  (in JavaScriptCore)        8
        WebCore::JSNodeOwner::finalize(JSC::Handle<JSC::Unknown>, void*)  (in WebCore)        7
        WebCore::JSNodeOwner::isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown>, void*, JSC::AbstractSlotVisitor&, WTF::ASCIILiteral*)  (in WebCore)        6
        WebCore::RenderTreeUpdater::tearDownRenderers(WebCore::Element&, WebCore::RenderTreeUpdater::TeardownType, WebCore::RenderTreeBuilder&)  (in WebCore)        6
        scavenger_thread_main  (in JavaScriptCore)        6
        WebCore::RenderObject::markContainingBlocksForLayout(WebCore::RenderElement*)  (in WebCore)        5
```

### D6.1-b P1 many-short-nodes trial 2

动作开始：2026-09-20T11:12:23.032Z；日志 offset 2566683；应用/WebContent 22714/22723。

```json
{"path":"P1","fixture":"many-short-nodes","trial":2,"binary":"release","setupInfo":{"setupOffset":2558761,"documentId":"b51b085cf74834e0","readyTs":"2026-09-20T19:12:19.872+08:00","modeMenuTs":"2026-09-20T19:12:20.410+08:00","lastMode":{"ts":"2026-09-20T18:25:58.213+08:00","level":"info","event":"view.mode.change","status":"success","actionId":"288935c4-1f7e-4035-975a-f32190d912b4","context":{"fromMode":"source","source":"setViewMode","toMode":"wysiwyg"},"durationMs":null,"error":null},"lastModePredatesLaunch":true,"appLine":"22714 /Users/jackcheng/Documents/01_Coding/mac-app/mdpro/src-tauri/target/release/bundle/macos/mdpro.app/Contents/MacOS/tauri-app","apid":"22714","wpid":"22723"},"offset":2566683,"end":2570874,"t0":1789902743032,"ended":1789902753567,"windowMs":10535,"cpuSpanMs":0,"above80Points":0,"peakCpu":22.2,"probeLatencyMs":101,"firstProbeSentAt":"2026-09-20T11:12:23.154Z","probesSent":6,"probesHandled":6,"confirmedAction":true,"recovered":true,"dead":false,"actionError":null,"quiet10s":true,"lowerBoundMarker":"2026-09-20T19:12:23.230+08:00","probes":[{"sentAt":1789902743154,"iso":"2026-09-20T11:12:23.154Z","returnedAt":1789902743250},{"sentAt":1789902745174,"iso":"2026-09-20T11:12:25.174Z","returnedAt":1789902745308},{"sentAt":1789902747193,"iso":"2026-09-20T11:12:27.193Z","returnedAt":1789902747324},{"sentAt":1789902749221,"iso":"2026-09-20T11:12:29.221Z","returnedAt":1789902749349},{"sentAt":1789902751243,"iso":"2026-09-20T11:12:31.243Z","returnedAt":1789902751361},{"sentAt":1789902753264,"iso":"2026-09-20T11:12:33.264Z","returnedAt":1789902753359}],"events":[{"ts":"2026-09-20T19:12:23.160+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"0a7e2343-7c91-402d-a1cf-042ab1150e07","context":{"action":"file.close","shortcut":"Cmd+W"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:12:23.163+08:00","level":"info","event":"tab.close","status":"success","actionId":"aa3e73ae-6dab-43c5-ad38-753e6de853d8","context":{"documentId":"b51b085cf74834e0","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/many-short-nodes.wysiwyg.md","wasModified":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:12:23.163+08:00","level":"info","event":"file.close","status":"success","actionId":"aa3e73ae-6dab-43c5-ad38-753e6de853d8","context":{"documentId":"b51b085cf74834e0","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/many-short-nodes.wysiwyg.md"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:12:23.219+08:00","level":"info","event":"editor.milkdown.mount","status":"success","actionId":"ebd1f163-5fe7-4cb9-abb0-eca873bcdb7e","context":{"contentLength":0,"documentId":null,"hasContent":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:12:23.219+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"bcec2faf-ad4f-4303-9c26-b48b28d2d076","context":{"editorLoading":true,"hasInstance":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:12:23.230+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"e2b0bade-1793-4361-85d5-b5ddf6bfa4d1","context":{"editorLoading":false,"hasInstance":true},"durationMs":null,"error":null},{"ts":"2026-09-20T19:12:23.255+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"8f7a5fa0-e7c8-4e58-98c9-824ee0e0448c","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:12:25.311+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"1f92eef6-2af2-4406-a7c5-88b23a48f86b","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:12:27.329+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"b0418b90-ec60-4608-b581-18f3a2e129a4","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:12:29.353+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"b1762005-588a-4244-ae70-f2050645a9f4","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:12:31.370+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"ff8b8938-d4e6-485a-b38d-09ee5954dd9f","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:12:33.369+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"ce96b26f-dbfc-41cb-b975-c37927c96978","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null}]}
```

CPU [相对 ms, %cpu]：
```json
[[5,0],[257,22.2],[510,9.4],[764,4.1],[1014,6.1],[1261,2.5],[1516,1.1],[1766,0.4],[2017,0.2],[2263,0.1],[2519,1.4],[2770,0.5],[3020,0.3],[3273,0.4],[3522,0.2],[3773,0.1],[4025,0.1],[4270,0.1],[4525,0.8],[4777,0.5],[5026,0.3],[5278,0.3],[5529,0.1],[5779,0.1],[6031,0.1],[6279,10.9],[6533,8.1],[6783,3.2],[7035,2.7],[7283,1.1],[7535,0.5],[7786,0.3],[8035,0.2],[8283,0.1],[8539,0.9],[8790,0.4],[9041,0.2],[9293,0.2],[9542,0.1],[9794,0.1],[10045,3.9],[10291,4.7]]
```

热点（所有线程，命中次数非 ms）：
```text
Sort by top of stack, same collapsed (when >= 5):
        __psynch_cvwait  (in libsystem_kernel.dylib)        65045
        __workq_kernreturn  (in libsystem_kernel.dylib)        25437
        mach_msg2_trap  (in libsystem_kernel.dylib)        8369
        pas_thread_local_cache_for_all  (in JavaScriptCore)        24
        madvise  (in libsystem_kernel.dylib)        20
        JSC::MarkedSpace::forEachWeakInParallel<JSC::SlotVisitor&>(JSC::SlotVisitor&)::Task::run(JSC::SlotVisitor&)  (in JavaScriptCore)        7
        WebCore::JSNodeOwner::isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown>, void*, JSC::AbstractSlotVisitor&, WTF::ASCIILiteral*)  (in WebCore)        6
        stop_allocator  (in JavaScriptCore)        6
        WebCore::RenderObject::markContainingBlocksForLayout(WebCore::RenderElement*)  (in WebCore)        5
        WebCore::RenderTreeUpdater::tearDownRenderers(WebCore::Element&, WebCore::RenderTreeUpdater::TeardownType, WebCore::RenderTreeBuilder&)  (in WebCore)        5
        scavenger_thread_main  (in JavaScriptCore)        5
        start_wqthread  (in libsystem_pthread.dylib)        5
        take_last_empty_consider_view  (in JavaScriptCore)        5
```

### D6.1-b P1 many-short-nodes trial 3

动作开始：2026-09-20T11:12:44.526Z；日志 offset 2578796；应用/WebContent 23271/23280。

```json
{"path":"P1","fixture":"many-short-nodes","trial":3,"binary":"release","setupInfo":{"setupOffset":2570874,"documentId":"b51b085cf74834e0","readyTs":"2026-09-20T19:12:41.361+08:00","modeMenuTs":"2026-09-20T19:12:41.902+08:00","lastMode":{"ts":"2026-09-20T18:25:58.213+08:00","level":"info","event":"view.mode.change","status":"success","actionId":"288935c4-1f7e-4035-975a-f32190d912b4","context":{"fromMode":"source","source":"setViewMode","toMode":"wysiwyg"},"durationMs":null,"error":null},"lastModePredatesLaunch":true,"appLine":"23271 /Users/jackcheng/Documents/01_Coding/mac-app/mdpro/src-tauri/target/release/bundle/macos/mdpro.app/Contents/MacOS/tauri-app","apid":"23271","wpid":"23280"},"offset":2578796,"end":2582735,"t0":1789902764526,"ended":1789902774565,"windowMs":10039,"cpuSpanMs":0,"above80Points":0,"peakCpu":15.2,"probeLatencyMs":97,"firstProbeSentAt":"2026-09-20T11:12:44.646Z","probesSent":5,"probesHandled":5,"confirmedAction":true,"recovered":true,"dead":false,"actionError":null,"quiet10s":true,"lowerBoundMarker":"2026-09-20T19:12:44.720+08:00","probes":[{"sentAt":1789902764646,"iso":"2026-09-20T11:12:44.646Z","returnedAt":1789902764741},{"sentAt":1789902766667,"iso":"2026-09-20T11:12:46.667Z","returnedAt":1789902766794},{"sentAt":1789902768689,"iso":"2026-09-20T11:12:48.689Z","returnedAt":1789902768816},{"sentAt":1789902770718,"iso":"2026-09-20T11:12:50.718Z","returnedAt":1789902770845},{"sentAt":1789902772745,"iso":"2026-09-20T11:12:52.745Z","returnedAt":1789902772878}],"events":[{"ts":"2026-09-20T19:12:44.651+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"24620e1c-e29a-43d9-b4eb-48516581658d","context":{"action":"file.close","shortcut":"Cmd+W"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:12:44.653+08:00","level":"info","event":"tab.close","status":"success","actionId":"f3953eb8-5b13-4626-8c92-cae95f06fa48","context":{"documentId":"b51b085cf74834e0","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/many-short-nodes.wysiwyg.md","wasModified":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:12:44.653+08:00","level":"info","event":"file.close","status":"success","actionId":"f3953eb8-5b13-4626-8c92-cae95f06fa48","context":{"documentId":"b51b085cf74834e0","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/many-short-nodes.wysiwyg.md"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:12:44.709+08:00","level":"info","event":"editor.milkdown.mount","status":"success","actionId":"3fc3fe42-5544-4ee1-ab80-dbc13c099255","context":{"contentLength":0,"documentId":null,"hasContent":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:12:44.709+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"d950a8f6-11c2-455e-af2b-6122f9f83f48","context":{"editorLoading":true,"hasInstance":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:12:44.720+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"94d01770-32d7-4c56-acd6-2595ef3f62a4","context":{"editorLoading":false,"hasInstance":true},"durationMs":null,"error":null},{"ts":"2026-09-20T19:12:44.743+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"5070bccf-4f61-4944-a0d1-cc787a5526e0","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:12:46.804+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"d32be454-2184-45ad-9914-1afc1df66866","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:12:48.821+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"1cec08ff-7b75-4b70-9b77-cb25a7c88001","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:12:50.853+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"b1b3597e-a787-40d4-9b70-abfd32b2d6db","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:12:52.887+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"06aafe7c-6a4a-4f64-bc1d-3f0d91ddb854","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null}]}
```

CPU [相对 ms, %cpu]：
```json
[[6,0],[259,15.2],[515,10.2],[766,4.9],[1017,10],[1263,3.8],[1518,1.6],[1769,0.7],[2021,0.4],[2267,0.2],[2522,1.4],[2774,0.6],[3025,0.2],[3275,0.4],[3525,0.2],[3779,0.1],[4028,0.1],[4276,0.1],[4531,0.8],[4781,0.5],[5032,0.3],[5283,0.2],[5535,0.2],[5785,0.1],[6036,0.1],[6281,0.1],[6536,12],[6787,4.5],[7038,1.7],[7288,1.7],[7541,0.8],[7790,0.4],[8040,0.3],[8287,0.1],[8543,1.6],[8795,0.6],[9047,0.3],[9296,0.3],[9547,0.2],[9798,0.2]]
```

热点（所有线程，命中次数非 ms）：
```text
Sort by top of stack, same collapsed (when >= 5):
        __psynch_cvwait  (in libsystem_kernel.dylib)        67758
        __workq_kernreturn  (in libsystem_kernel.dylib)        25342
        mach_msg2_trap  (in libsystem_kernel.dylib)        8358
        pas_thread_local_cache_for_all  (in JavaScriptCore)        29
        madvise  (in libsystem_kernel.dylib)        22
        JSC::MarkedSpace::forEachWeakInParallel<JSC::SlotVisitor&>(JSC::SlotVisitor&)::Task::run(JSC::SlotVisitor&)  (in JavaScriptCore)        8
        mach_absolute_time  (in libsystem_kernel.dylib)        8
        JSC::SlotVisitor::drain(WTF::MonotonicTime)  (in JavaScriptCore)        6
        scavenger_thread_main  (in JavaScriptCore)        6
        start_wqthread  (in libsystem_pthread.dylib)        6
        JSC::UnlinkedCodeBlock::visitChildren(JSC::JSCell*, JSC::SlotVisitor&)  (in JavaScriptCore)        5
        WebCore::RenderTreeUpdater::tearDownRenderers(WebCore::Element&, WebCore::RenderTreeUpdater::TeardownType, WebCore::RenderTreeBuilder&)  (in WebCore)        5
        pas_thread_local_cache_flush_deallocation_log  (in JavaScriptCore)        5
```

### D6.1-b P1 dense-math trial 1

动作开始：2026-09-20T11:13:01.207Z；日志 offset 2590365；应用/WebContent 23835/23844。

```json
{"path":"P1","fixture":"dense-math","trial":1,"binary":"release","setupInfo":{"setupOffset":2582735,"documentId":"1c3d1a71ed567027","readyTs":"2026-09-20T19:12:58.175+08:00","modeMenuTs":"2026-09-20T19:12:58.586+08:00","lastMode":{"ts":"2026-09-20T18:25:58.213+08:00","level":"info","event":"view.mode.change","status":"success","actionId":"288935c4-1f7e-4035-975a-f32190d912b4","context":{"fromMode":"source","source":"setViewMode","toMode":"wysiwyg"},"durationMs":null,"error":null},"lastModePredatesLaunch":true,"appLine":"23835 /Users/jackcheng/Documents/01_Coding/mac-app/mdpro/src-tauri/target/release/bundle/macos/mdpro.app/Contents/MacOS/tauri-app","apid":"23835","wpid":"23844"},"offset":2590365,"end":2594292,"t0":1789902781207,"ended":1789902791308,"windowMs":10101,"cpuSpanMs":0,"above80Points":0,"peakCpu":13.4,"probeLatencyMs":106,"firstProbeSentAt":"2026-09-20T11:13:01.313Z","probesSent":5,"probesHandled":5,"confirmedAction":true,"recovered":true,"dead":false,"actionError":null,"quiet10s":true,"lowerBoundMarker":"2026-09-20T19:13:01.354+08:00","probes":[{"sentAt":1789902781313,"iso":"2026-09-20T11:13:01.313Z","returnedAt":1789902781411},{"sentAt":1789902783331,"iso":"2026-09-20T11:13:03.331Z","returnedAt":1789902783461},{"sentAt":1789902785349,"iso":"2026-09-20T11:13:05.349Z","returnedAt":1789902785480},{"sentAt":1789902787367,"iso":"2026-09-20T11:13:07.367Z","returnedAt":1789902787496},{"sentAt":1789902789385,"iso":"2026-09-20T11:13:09.385Z","returnedAt":1789902789513}],"events":[{"ts":"2026-09-20T19:13:01.318+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"52fba262-4190-4bd6-b109-8dec629f95f2","context":{"action":"file.close","shortcut":"Cmd+W"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:01.320+08:00","level":"info","event":"tab.close","status":"success","actionId":"28740bcd-2f4b-4714-9910-e13e84ae2378","context":{"documentId":"1c3d1a71ed567027","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/dense-math.wysiwyg.md","wasModified":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:01.321+08:00","level":"info","event":"file.close","status":"success","actionId":"28740bcd-2f4b-4714-9910-e13e84ae2378","context":{"documentId":"1c3d1a71ed567027","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/dense-math.wysiwyg.md"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:01.349+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"37d7bf08-6f57-4dca-99e6-5c106f3f4be0","context":{"editorLoading":true,"hasInstance":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:01.349+08:00","level":"info","event":"editor.milkdown.mount","status":"success","actionId":"93479531-c377-408e-91a7-242dba550f0b","context":{"contentLength":0,"documentId":null,"hasContent":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:01.354+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"6a217b4b-3394-4a92-89e3-4b782b46f4bc","context":{"editorLoading":false,"hasInstance":true},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:01.419+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"5aab44d5-859d-4286-802f-5b07ffb935b2","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:03.470+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"09eb00be-927e-4a6a-9c53-320993256dbc","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:05.486+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"58eb0259-d014-440a-b020-e284eb03957c","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:07.503+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"182625e8-f74e-4dda-8c58-5d3ed8b6f4f9","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:09.519+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"36880e07-c67f-4589-bfd7-819761f07d83","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null}]}
```

CPU [相对 ms, %cpu]：
```json
[[4,0],[257,13.4],[513,5.7],[764,3.5],[1016,3.9],[1262,1.7],[1518,0.7],[1769,0.5],[2018,0.3],[2264,0.1],[2520,1.4],[2770,0.5],[3021,0.2],[3272,0.5],[3523,0.3],[3773,0.2],[4025,0.1],[4272,0.1],[4527,1],[4779,0.4],[5031,0.2],[5280,0.4],[5532,0.2],[5783,0.1],[6033,0.1],[6281,0.1],[6535,1.7],[6785,0.7],[7036,0.5],[7288,0.3],[7537,0.1],[7788,0.1],[8039,0.1],[8285,0.1],[8537,1.4],[8791,0.6],[9042,0.4],[9293,0.2],[9544,0.1],[9795,0.1],[10046,0.1]]
```

热点（所有线程，命中次数非 ms）：
```text
Sort by top of stack, same collapsed (when >= 5):
        __psynch_cvwait  (in libsystem_kernel.dylib)        59019
        __workq_kernreturn  (in libsystem_kernel.dylib)        25492
        mach_msg2_trap  (in libsystem_kernel.dylib)        8455
        pas_thread_local_cache_for_all  (in JavaScriptCore)        25
        madvise  (in libsystem_kernel.dylib)        8
        scavenger_thread_main  (in JavaScriptCore)        8
        stop_allocator  (in JavaScriptCore)        8
```

### D6.1-b P1 dense-math trial 2

动作开始：2026-09-20T11:13:18.079Z；日志 offset 2602163；应用/WebContent 24377/24386。

```json
{"path":"P1","fixture":"dense-math","trial":2,"binary":"release","setupInfo":{"setupOffset":2594292,"documentId":"1c3d1a71ed567027","readyTs":"2026-09-20T19:13:14.448+08:00","modeMenuTs":"2026-09-20T19:13:14.919+08:00","lastMode":{"ts":"2026-09-20T18:25:58.213+08:00","level":"info","event":"view.mode.change","status":"success","actionId":"288935c4-1f7e-4035-975a-f32190d912b4","context":{"fromMode":"source","source":"setViewMode","toMode":"wysiwyg"},"durationMs":null,"error":null},"lastModePredatesLaunch":true,"appLine":"24377 /Users/jackcheng/Documents/01_Coding/mac-app/mdpro/src-tauri/target/release/bundle/macos/mdpro.app/Contents/MacOS/tauri-app","apid":"24377","wpid":"24386"},"offset":2602163,"end":2606090,"t0":1789902798079,"ended":1789902808110,"windowMs":10031,"cpuSpanMs":0,"above80Points":0,"peakCpu":14.7,"probeLatencyMs":99,"firstProbeSentAt":"2026-09-20T11:13:18.202Z","probesSent":5,"probesHandled":5,"confirmedAction":true,"recovered":true,"dead":false,"actionError":null,"quiet10s":true,"lowerBoundMarker":"2026-09-20T19:13:18.248+08:00","probes":[{"sentAt":1789902798202,"iso":"2026-09-20T11:13:18.202Z","returnedAt":1789902798296},{"sentAt":1789902800221,"iso":"2026-09-20T11:13:20.221Z","returnedAt":1789902800348},{"sentAt":1789902802243,"iso":"2026-09-20T11:13:22.243Z","returnedAt":1789902802370},{"sentAt":1789902804271,"iso":"2026-09-20T11:13:24.271Z","returnedAt":1789902804404},{"sentAt":1789902806289,"iso":"2026-09-20T11:13:26.289Z","returnedAt":1789902806420}],"events":[{"ts":"2026-09-20T19:13:18.210+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"a6d75773-a56c-4330-a6ce-21919dbafb43","context":{"action":"file.close","shortcut":"Cmd+W"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:18.213+08:00","level":"info","event":"tab.close","status":"success","actionId":"0980aa44-ffaf-4d8b-83b3-b7bef4b8e741","context":{"documentId":"1c3d1a71ed567027","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/dense-math.wysiwyg.md","wasModified":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:18.213+08:00","level":"info","event":"file.close","status":"success","actionId":"0980aa44-ffaf-4d8b-83b3-b7bef4b8e741","context":{"documentId":"1c3d1a71ed567027","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/dense-math.wysiwyg.md"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:18.244+08:00","level":"info","event":"editor.milkdown.mount","status":"success","actionId":"2bf6e02a-7519-4ea3-8d0b-4b23ba0a0ee2","context":{"contentLength":0,"documentId":null,"hasContent":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:18.244+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"1aec83a9-2989-4ea2-adb0-ec552a3ea21c","context":{"editorLoading":true,"hasInstance":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:18.248+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"6ab1ecc1-1bb9-46a1-835e-d57e4420c92e","context":{"editorLoading":false,"hasInstance":true},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:18.301+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"a48bd30b-f911-4aa6-ad68-141d15b689d2","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:20.352+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"dcb226d1-2a83-4f1f-b4ed-d1966522b4d4","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:22.378+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"f6799c58-13d2-4777-92f7-5e477f41f049","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:24.411+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"7796f215-d9eb-46c9-b6bb-6e3730fa0c4d","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:26.428+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"cd0b1ada-dc9f-4bbf-a69b-a201cfc85454","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null}]}
```

CPU [相对 ms, %cpu]：
```json
[[5,0],[258,14.7],[514,6.1],[765,3.6],[1018,4.3],[1264,1.9],[1519,0.8],[1770,0.4],[2021,0.3],[2267,0.2],[2523,1.6],[2774,0.7],[3025,0.4],[3276,0.4],[3527,0.1],[3778,0.2],[4027,0.1],[4272,0.1],[4528,0.9],[4780,0.4],[5030,0.2],[5281,0.3],[5532,0.2],[5783,0.1],[6034,0.2],[6279,0.1],[6535,1],[6786,0.4],[7037,0.2],[7288,0.3],[7539,0.1],[7790,0.1],[8041,0.1],[8287,0.1],[8540,1.3],[8793,0.5],[9043,0.3],[9293,0.2],[9544,0.1],[9793,0.1]]
```

热点（所有线程，命中次数非 ms）：
```text
Sort by top of stack, same collapsed (when >= 5):
        __psynch_cvwait  (in libsystem_kernel.dylib)        57721
        __workq_kernreturn  (in libsystem_kernel.dylib)        25512
        mach_msg2_trap  (in libsystem_kernel.dylib)        8458
        pas_thread_local_cache_for_all  (in JavaScriptCore)        28
        madvise  (in libsystem_kernel.dylib)        7
```

### D6.1-b P1 dense-math trial 3

动作开始：2026-09-20T11:13:35.026Z；日志 offset 2613720；应用/WebContent 24925/24934。

```json
{"path":"P1","fixture":"dense-math","trial":3,"binary":"release","setupInfo":{"setupOffset":2606090,"documentId":"1c3d1a71ed567027","readyTs":"2026-09-20T19:13:31.673+08:00","modeMenuTs":"2026-09-20T19:13:32.138+08:00","lastMode":{"ts":"2026-09-20T18:25:58.213+08:00","level":"info","event":"view.mode.change","status":"success","actionId":"288935c4-1f7e-4035-975a-f32190d912b4","context":{"fromMode":"source","source":"setViewMode","toMode":"wysiwyg"},"durationMs":null,"error":null},"lastModePredatesLaunch":true,"appLine":"24925 /Users/jackcheng/Documents/01_Coding/mac-app/mdpro/src-tauri/target/release/bundle/macos/mdpro.app/Contents/MacOS/tauri-app","apid":"24925","wpid":"24934"},"offset":2613720,"end":2617647,"t0":1789902815026,"ended":1789902825053,"windowMs":10027,"cpuSpanMs":0,"above80Points":0,"peakCpu":14,"probeLatencyMs":104,"firstProbeSentAt":"2026-09-20T11:13:35.143Z","probesSent":5,"probesHandled":5,"confirmedAction":true,"recovered":true,"dead":false,"actionError":null,"quiet10s":true,"lowerBoundMarker":"2026-09-20T19:13:35.185+08:00","probes":[{"sentAt":1789902815143,"iso":"2026-09-20T11:13:35.143Z","returnedAt":1789902815240},{"sentAt":1789902817160,"iso":"2026-09-20T11:13:37.160Z","returnedAt":1789902817294},{"sentAt":1789902819184,"iso":"2026-09-20T11:13:39.184Z","returnedAt":1789902819312},{"sentAt":1789902821213,"iso":"2026-09-20T11:13:41.213Z","returnedAt":1789902821342},{"sentAt":1789902823234,"iso":"2026-09-20T11:13:43.234Z","returnedAt":1789902823366}],"events":[{"ts":"2026-09-20T19:13:35.147+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"4f6ca6a0-8fa4-4972-abe8-a6df9edfb50b","context":{"action":"file.close","shortcut":"Cmd+W"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:35.149+08:00","level":"info","event":"tab.close","status":"success","actionId":"f7a90cd0-efdb-4b6e-8b38-437cf32be817","context":{"documentId":"1c3d1a71ed567027","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/dense-math.wysiwyg.md","wasModified":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:35.149+08:00","level":"info","event":"file.close","status":"success","actionId":"f7a90cd0-efdb-4b6e-8b38-437cf32be817","context":{"documentId":"1c3d1a71ed567027","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/dense-math.wysiwyg.md"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:35.179+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"0aa57844-62b9-402d-b9fa-eec7cf4f999f","context":{"editorLoading":true,"hasInstance":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:35.179+08:00","level":"info","event":"editor.milkdown.mount","status":"success","actionId":"81135456-13c4-4486-8b1f-c379cf9070fb","context":{"contentLength":0,"documentId":null,"hasContent":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:35.185+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"ad76cbc9-c716-4901-802a-1457d16d01b1","context":{"editorLoading":false,"hasInstance":true},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:35.247+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"25d8d52c-d837-4c0c-9024-8423c322e5ac","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:37.299+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"4dd37c23-6837-4582-9c60-a588e5f50dbd","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:39.315+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"ea53f07d-8214-4153-8349-7f2e24ab2964","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:41.349+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"5d2fbe0d-3506-458c-a7c9-fe8915e16eac","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:43.374+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"8859dc4a-d48b-451b-b460-a8045909a4f4","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null}]}
```

CPU [相对 ms, %cpu]：
```json
[[6,0],[259,14],[515,5.6],[767,3.3],[1018,3.9],[1264,1.7],[1520,0.7],[1771,0.4],[2022,0.3],[2267,0.1],[2521,1.8],[2774,0.7],[3025,0.2],[3275,0.4],[3525,0.2],[3777,0.2],[4027,0.1],[4274,0.1],[4530,1.1],[4780,0.4],[5030,0.2],[5281,0.3],[5532,0.2],[5784,0.1],[6035,0.1],[6281,0.1],[6536,1.4],[6787,0.7],[7039,0.4],[7290,0.3],[7541,0.1],[7791,0.1],[8042,0.1],[8289,0.1],[8544,1.7],[8797,0.6],[9048,0.2],[9297,0.2],[9549,0.1],[9799,0.1]]
```

热点（所有线程，命中次数非 ms）：
```text
Sort by top of stack, same collapsed (when >= 5):
        __psynch_cvwait  (in libsystem_kernel.dylib)        59185
        __workq_kernreturn  (in libsystem_kernel.dylib)        25470
        mach_msg2_trap  (in libsystem_kernel.dylib)        8450
        pas_thread_local_cache_for_all  (in JavaScriptCore)        23
        start_wqthread  (in libsystem_pthread.dylib)        7
        madvise  (in libsystem_kernel.dylib)        6
```

### D6.1-b P1 normal-prose trial 1

动作开始：2026-09-20T11:13:50.198Z；日志 offset 2625776；应用/WebContent 25470/25479。

```json
{"path":"P1","fixture":"normal-prose","trial":1,"binary":"release","setupInfo":{"setupOffset":2617647,"documentId":"750492cd37f749a9","readyTs":"2026-09-20T19:13:47.033+08:00","modeMenuTs":"2026-09-20T19:13:47.582+08:00","lastMode":{"ts":"2026-09-20T18:25:58.213+08:00","level":"info","event":"view.mode.change","status":"success","actionId":"288935c4-1f7e-4035-975a-f32190d912b4","context":{"fromMode":"source","source":"setViewMode","toMode":"wysiwyg"},"durationMs":null,"error":null},"lastModePredatesLaunch":true,"appLine":"25470 /Users/jackcheng/Documents/01_Coding/mac-app/mdpro/src-tauri/target/release/bundle/macos/mdpro.app/Contents/MacOS/tauri-app","apid":"25470","wpid":"25479"},"offset":2625776,"end":2629707,"t0":1789902830198,"ended":1789902840214,"windowMs":10016,"cpuSpanMs":0,"above80Points":0,"peakCpu":10.6,"probeLatencyMs":104,"firstProbeSentAt":"2026-09-20T11:13:50.315Z","probesSent":5,"probesHandled":5,"confirmedAction":true,"recovered":true,"dead":false,"actionError":null,"quiet10s":true,"lowerBoundMarker":"2026-09-20T19:13:50.340+08:00","probes":[{"sentAt":1789902830315,"iso":"2026-09-20T11:13:50.315Z","returnedAt":1789902830411},{"sentAt":1789902832333,"iso":"2026-09-20T11:13:52.333Z","returnedAt":1789902832463},{"sentAt":1789902834351,"iso":"2026-09-20T11:13:54.351Z","returnedAt":1789902834478},{"sentAt":1789902836373,"iso":"2026-09-20T11:13:56.373Z","returnedAt":1789902836503},{"sentAt":1789902838394,"iso":"2026-09-20T11:13:58.394Z","returnedAt":1789902838523}],"events":[{"ts":"2026-09-20T19:13:50.318+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"75c9389c-5a19-4e07-a0d6-6e1d912c6bc2","context":{"action":"file.close","shortcut":"Cmd+W"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:50.328+08:00","level":"info","event":"tab.close","status":"success","actionId":"72c3cef0-e35a-4a0c-aa6d-f0bde8361c82","context":{"documentId":"750492cd37f749a9","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/normal-prose.wysiwyg.md","wasModified":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:50.328+08:00","level":"info","event":"file.close","status":"success","actionId":"72c3cef0-e35a-4a0c-aa6d-f0bde8361c82","context":{"documentId":"750492cd37f749a9","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/normal-prose.wysiwyg.md"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:50.336+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"b3af1585-5bcf-40b9-97dc-1916e963e3e3","context":{"editorLoading":true,"hasInstance":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:50.336+08:00","level":"info","event":"editor.milkdown.mount","status":"success","actionId":"81a63306-aca9-40fe-9b16-de2be28a4fe0","context":{"contentLength":0,"documentId":null,"hasContent":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:50.340+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"0b05e106-0a72-4456-9815-dba05aa92e58","context":{"editorLoading":false,"hasInstance":true},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:50.419+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"99193d91-3662-4b4f-b00b-ecf6671f1855","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:52.469+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"387e093b-ce15-4f8d-ac7d-4abb00f06260","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:54.486+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"9f53fdcc-7564-4265-95ee-ec30d31ce913","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:56.511+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"72ac265f-5ea1-4279-a234-70fac43476b7","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:13:58.526+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"72b1ccd9-bb54-423d-bfa0-5aded676afec","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null}]}
```

CPU [相对 ms, %cpu]：
```json
[[6,0.2],[259,10.6],[513,4.7],[762,2.9],[1015,1.6],[1261,0.7],[1517,0.4],[1767,0.2],[2018,0.1],[2264,0.2],[2519,1.2],[2771,0.5],[3021,0.3],[3271,0.3],[3521,0.2],[3773,0.1],[4023,0.1],[4271,0.1],[4525,1.5],[4778,0.6],[5027,0.4],[5277,0.3],[5527,0.1],[5778,0.1],[6028,0.1],[6275,0.1],[6528,1.5],[6782,0.6],[7032,0.3],[7283,0.4],[7534,0.2],[7785,0.1],[8037,0.1],[8283,0.1],[8538,0.8],[8790,0.4],[9041,0.3],[9292,0.2],[9543,0.1],[9794,0.2]]
```

热点（所有线程，命中次数非 ms）：
```text
Sort by top of stack, same collapsed (when >= 5):
        __psynch_cvwait  (in libsystem_kernel.dylib)        67992
        __workq_kernreturn  (in libsystem_kernel.dylib)        26859
        mach_msg2_trap  (in libsystem_kernel.dylib)        8459
        pas_thread_local_cache_for_all  (in JavaScriptCore)        24
        scavenger_thread_main  (in JavaScriptCore)        13
        start_wqthread  (in libsystem_pthread.dylib)        6
        stop_allocator  (in JavaScriptCore)        5
        syscall_thread_switch  (in libsystem_kernel.dylib)        5
```

### D6.1-b P1 normal-prose trial 2

动作开始：2026-09-20T11:14:05.359Z；日志 offset 2637836；应用/WebContent 26028/26037。

```json
{"path":"P1","fixture":"normal-prose","trial":2,"binary":"release","setupInfo":{"setupOffset":2629707,"documentId":"750492cd37f749a9","readyTs":"2026-09-20T19:14:02.198+08:00","modeMenuTs":"2026-09-20T19:14:02.732+08:00","lastMode":{"ts":"2026-09-20T18:25:58.213+08:00","level":"info","event":"view.mode.change","status":"success","actionId":"288935c4-1f7e-4035-975a-f32190d912b4","context":{"fromMode":"source","source":"setViewMode","toMode":"wysiwyg"},"durationMs":null,"error":null},"lastModePredatesLaunch":true,"appLine":"26028 /Users/jackcheng/Documents/01_Coding/mac-app/mdpro/src-tauri/target/release/bundle/macos/mdpro.app/Contents/MacOS/tauri-app","apid":"26028","wpid":"26037"},"offset":2637836,"end":2641767,"t0":1789902845359,"ended":1789902855390,"windowMs":10031,"cpuSpanMs":0,"above80Points":0,"peakCpu":8.3,"probeLatencyMs":103,"firstProbeSentAt":"2026-09-20T11:14:05.478Z","probesSent":5,"probesHandled":5,"confirmedAction":true,"recovered":true,"dead":false,"actionError":null,"quiet10s":true,"lowerBoundMarker":"2026-09-20T19:14:05.500+08:00","probes":[{"sentAt":1789902845478,"iso":"2026-09-20T11:14:05.478Z","returnedAt":1789902845574},{"sentAt":1789902847496,"iso":"2026-09-20T11:14:07.496Z","returnedAt":1789902847626},{"sentAt":1789902849520,"iso":"2026-09-20T11:14:09.520Z","returnedAt":1789902849648},{"sentAt":1789902851548,"iso":"2026-09-20T11:14:11.548Z","returnedAt":1789902851675},{"sentAt":1789902853569,"iso":"2026-09-20T11:14:13.569Z","returnedAt":1789902853698}],"events":[{"ts":"2026-09-20T19:14:05.482+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"a0b7dc74-bbfe-486b-9d85-703c84bfc03b","context":{"action":"file.close","shortcut":"Cmd+W"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:14:05.483+08:00","level":"info","event":"tab.close","status":"success","actionId":"85031eb5-5f99-425d-a9b9-958fbc0453d7","context":{"documentId":"750492cd37f749a9","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/normal-prose.wysiwyg.md","wasModified":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:14:05.484+08:00","level":"info","event":"file.close","status":"success","actionId":"85031eb5-5f99-425d-a9b9-958fbc0453d7","context":{"documentId":"750492cd37f749a9","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/normal-prose.wysiwyg.md"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:14:05.494+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"1f761c8c-7068-4b73-b8e7-a3adf69b3130","context":{"editorLoading":true,"hasInstance":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:14:05.494+08:00","level":"info","event":"editor.milkdown.mount","status":"success","actionId":"f3e03c22-00df-43e6-8bcd-60b7db16595b","context":{"contentLength":0,"documentId":null,"hasContent":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:14:05.500+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"be5be718-f9d2-404e-8084-5a9f5aff8152","context":{"editorLoading":false,"hasInstance":true},"durationMs":null,"error":null},{"ts":"2026-09-20T19:14:05.581+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"b2d7d46c-5ce9-4dbf-94f6-8be964b15760","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:14:07.631+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"26204f83-72f4-4cec-93fd-83ebca6cbef2","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:14:09.657+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"5c1abeb2-294c-4416-b57c-716091b18ae6","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:14:11.681+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"7968ef42-3df7-49c2-8197-e1a57201396e","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:14:13.707+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"5e734c78-5f0a-490f-9d07-1d9f3d3961ae","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null}]}
```

CPU [相对 ms, %cpu]：
```json
[[6,0.2],[259,8.3],[515,4.1],[765,2.8],[1017,1.9],[1262,0.8],[1518,5.2],[1769,3.5],[2020,0.6],[2266,0.5],[2521,2.1],[2773,0.9],[3024,0.5],[3275,0.4],[3526,0.2],[3774,0.1],[4028,0.2],[4274,0.1],[4530,0.9],[4779,0.5],[5030,0.3],[5279,0.2],[5532,0.1],[5785,0.1],[6035,0.1],[6280,0.1],[6535,1.1],[6786,0.5],[7038,0.4],[7289,0.2],[7539,0.1],[7789,0.2],[8041,0.1],[8287,0.1],[8543,0.8],[8795,0.5],[9045,0.2],[9296,0.1],[9546,0.1],[9798,0.2]]
```

热点（所有线程，命中次数非 ms）：
```text
Sort by top of stack, same collapsed (when >= 5):
        __psynch_cvwait  (in libsystem_kernel.dylib)        67787
        __workq_kernreturn  (in libsystem_kernel.dylib)        25422
        mach_msg2_trap  (in libsystem_kernel.dylib)        8418
        pas_thread_local_cache_for_all  (in JavaScriptCore)        18
        scavenger_thread_main  (in JavaScriptCore)        9
        madvise  (in libsystem_kernel.dylib)        7
        stop_allocator  (in JavaScriptCore)        6
        JSC::JSObject::visitChildren(JSC::JSCell*, JSC::SlotVisitor&)  (in JavaScriptCore)        5
```

### D6.1-b P1 normal-prose trial 3

动作开始：2026-09-20T11:14:20.549Z；日志 offset 2649655；应用/WebContent 26561/26570。

```json
{"path":"P1","fixture":"normal-prose","trial":3,"binary":"release","setupInfo":{"setupOffset":2641767,"documentId":"750492cd37f749a9","readyTs":"2026-09-20T19:14:17.378+08:00","modeMenuTs":"2026-09-20T19:14:17.919+08:00","lastMode":{"ts":"2026-09-20T18:25:58.213+08:00","level":"info","event":"view.mode.change","status":"success","actionId":"288935c4-1f7e-4035-975a-f32190d912b4","context":{"fromMode":"source","source":"setViewMode","toMode":"wysiwyg"},"durationMs":null,"error":null},"lastModePredatesLaunch":true,"appLine":"26561 /Users/jackcheng/Documents/01_Coding/mac-app/mdpro/src-tauri/target/release/bundle/macos/mdpro.app/Contents/MacOS/tauri-app","apid":"26561","wpid":"26570"},"offset":2649655,"end":2653586,"t0":1789902860549,"ended":1789902870559,"windowMs":10010,"cpuSpanMs":0,"above80Points":0,"peakCpu":10.6,"probeLatencyMs":107,"firstProbeSentAt":"2026-09-20T11:14:20.666Z","probesSent":5,"probesHandled":5,"confirmedAction":true,"recovered":true,"dead":false,"actionError":null,"quiet10s":true,"lowerBoundMarker":"2026-09-20T19:14:20.692+08:00","probes":[{"sentAt":1789902860666,"iso":"2026-09-20T11:14:20.666Z","returnedAt":1789902860765},{"sentAt":1789902862681,"iso":"2026-09-20T11:14:22.681Z","returnedAt":1789902862810},{"sentAt":1789902864700,"iso":"2026-09-20T11:14:24.700Z","returnedAt":1789902864834},{"sentAt":1789902866724,"iso":"2026-09-20T11:14:26.724Z","returnedAt":1789902866826},{"sentAt":1789902868743,"iso":"2026-09-20T11:14:28.743Z","returnedAt":1789902868873}],"events":[{"ts":"2026-09-20T19:14:20.672+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"2aeec32f-2ab5-4965-84ef-5ba78607fa06","context":{"action":"file.close","shortcut":"Cmd+W"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:14:20.674+08:00","level":"info","event":"tab.close","status":"success","actionId":"c58101f4-de53-490c-a4d7-c7856a83a947","context":{"documentId":"750492cd37f749a9","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/normal-prose.wysiwyg.md","wasModified":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:14:20.674+08:00","level":"info","event":"file.close","status":"success","actionId":"c58101f4-de53-490c-a4d7-c7856a83a947","context":{"documentId":"750492cd37f749a9","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/normal-prose.wysiwyg.md"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:14:20.685+08:00","level":"info","event":"editor.milkdown.mount","status":"success","actionId":"893613d4-cad1-4df0-973d-088003576de2","context":{"contentLength":0,"documentId":null,"hasContent":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:14:20.685+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"e5799e4b-bea5-4f21-848b-c29c597eec7f","context":{"editorLoading":true,"hasInstance":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:14:20.692+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"3a7a9d2f-2c2e-44b3-a9af-a76891f7e14b","context":{"editorLoading":false,"hasInstance":true},"durationMs":null,"error":null},{"ts":"2026-09-20T19:14:20.773+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"ea486a1d-4d02-4c2e-afe1-166f54827286","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:14:22.814+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"0097f567-584c-49b9-8a3e-243e101b5579","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:14:24.840+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"52221ef1-9370-444d-85ff-cd1fa4b2c7dd","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:14:26.831+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"44f6a628-36b5-41f3-8066-d39adc80bb71","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:14:28.882+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"c83ba940-9aa4-461d-87d5-1a6dd6b79187","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null}]}
```

CPU [相对 ms, %cpu]：
```json
[[6,0.1],[259,10.6],[515,5.9],[762,2.7],[1017,1.4],[1262,0.6],[1518,8.9],[1769,6.1],[2019,2.2],[2264,0.7],[2519,3.5],[2770,1.3],[3022,0.8],[3273,0.6],[3524,0.3],[3774,0.1],[4025,0.2],[4271,0.1],[4527,1.4],[4778,0.5],[5029,0.4],[5280,0.3],[5530,0.1],[5780,0.1],[6030,0.1],[6277,0.1],[6532,1],[6784,0.5],[7035,0.4],[7286,0.2],[7535,0.1],[7788,0.1],[8039,0.1],[8284,0.1],[8541,1.2],[8791,0.5],[9042,0.2],[9294,0.2],[9542,0.1],[9794,0.2]]
```

热点（所有线程，命中次数非 ms）：
```text
Sort by top of stack, same collapsed (when >= 5):
        __psynch_cvwait  (in libsystem_kernel.dylib)        65069
        __workq_kernreturn  (in libsystem_kernel.dylib)        25400
        mach_msg2_trap  (in libsystem_kernel.dylib)        8412
        pas_thread_local_cache_for_all  (in JavaScriptCore)        26
        madvise  (in libsystem_kernel.dylib)        9
        JSC::JSObject::visitChildren(JSC::JSCell*, JSC::SlotVisitor&)  (in JavaScriptCore)        6
        stop_allocator  (in JavaScriptCore)        6
```

### D6.1-b P2 normal-prose-to-large-table trial 1

动作开始：2026-09-20T11:14:35.731Z；日志 offset 2661715；应用/WebContent 27093/27102。

```json
{"path":"P2","fixture":"normal-prose-to-large-table","trial":1,"binary":"release","setupInfo":{"setupOffset":2653586,"documentId":"750492cd37f749a9","readyTs":"2026-09-20T19:14:32.576+08:00","modeMenuTs":"2026-09-20T19:14:33.107+08:00","lastMode":{"ts":"2026-09-20T18:25:58.213+08:00","level":"info","event":"view.mode.change","status":"success","actionId":"288935c4-1f7e-4035-975a-f32190d912b4","context":{"fromMode":"source","source":"setViewMode","toMode":"wysiwyg"},"durationMs":null,"error":null},"lastModePredatesLaunch":true,"appLine":"27093 /Users/jackcheng/Documents/01_Coding/mac-app/mdpro/src-tauri/target/release/bundle/macos/mdpro.app/Contents/MacOS/tauri-app","apid":"27093","wpid":"27102"},"offset":2661715,"end":2668471,"t0":1789902875731,"ended":1789902885805,"windowMs":10074,"cpuSpanMs":0,"above80Points":0,"peakCpu":0.4,"probeLatencyMs":10128,"firstProbeSentAt":"2026-09-20T11:14:35.796Z","probesSent":5,"probesHandled":1,"confirmedAction":true,"recovered":true,"dead":false,"actionError":null,"quiet10s":true,"lowerBoundMarker":"2026-09-20T19:14:35.937+08:00","probes":[{"sentAt":1789902875796,"iso":"2026-09-20T11:14:35.796Z","returnedAt":1789902875888},{"sentAt":1789902877815,"iso":"2026-09-20T11:14:37.815Z","returnedAt":1789902877920},{"sentAt":1789902879832,"iso":"2026-09-20T11:14:39.832Z","returnedAt":1789902879931},{"sentAt":1789902881849,"iso":"2026-09-20T11:14:41.849Z","returnedAt":1789902881954},{"sentAt":1789902883874,"iso":"2026-09-20T11:14:43.874Z","returnedAt":1789902883976}],"events":[{"ts":"2026-09-20T19:14:35.930+08:00","level":"info","event":"editor.milkdown.mount","status":"success","actionId":"4097de89-4c48-455d-b74e-8c815a185750","context":{"contentLength":0,"documentId":null,"hasContent":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:14:35.930+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"0b8c113e-455f-4e47-b556-0b1053480140","context":{"editorLoading":true,"hasInstance":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:14:35.937+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"b5408a0b-4b5d-4188-b6ec-f65105083b69","context":{"editorLoading":false,"hasInstance":true},"durationMs":null,"error":null},{"ts":"2026-09-20T19:14:35.949+08:00","level":"info","event":"tab.open","status":"success","actionId":"6f36a16a-5dea-44eb-addd-122cb5181c99","context":{"documentId":"9bcf40cdc1692ed5","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/large-table.wysiwyg.md","tabIndex":0},"durationMs":null,"error":null},{"ts":"2026-09-20T19:14:35.949+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"3de8aa98-46dc-4fd9-bf81-172dc9251a79","context":{"editorLoading":true,"hasInstance":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:14:35.949+08:00","level":"info","event":"editor.milkdown.mount","status":"success","actionId":"8ce375ef-a558-4400-a347-5e79d8366c37","context":{"contentLength":415976,"documentId":"9bcf40cdc1692ed5","hasContent":true},"durationMs":null,"error":null},{"ts":"2026-09-20T19:14:45.924+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"4f70a869-df7f-44de-a923-cbfb62f41f5b","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:14:45.925+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"61d5da32-8be2-40a0-88d6-e721a733a931","context":{"editorLoading":false,"hasInstance":true},"durationMs":null,"error":null}]}
```

CPU [相对 ms, %cpu]：
```json
[[5,0.2],[258,0.4],[512,0.1],[762,0.2],[1013,0],[1261,0],[1516,0],[1765,0],[2016,0],[2263,0],[2517,0],[2768,0],[3020,0],[3270,0],[3522,0],[3772,0],[4021,0],[4269,0],[4522,0],[4772,0],[5024,0],[5275,0],[5526,0],[5777,0],[6027,0],[6274,0],[6528,0],[6779,0],[7029,0],[7280,0],[7532,0],[7783,0],[8033,0],[8281,0],[8534,0],[8786,0],[9035,0],[9284,0],[9537,0],[9787,0],[10038,0]]
```

热点（所有线程，命中次数非 ms）：
```text
Sort by top of stack, same collapsed (when >= 5):
        __psynch_cvwait  (in libsystem_kernel.dylib)        55116
        __workq_kernreturn  (in libsystem_kernel.dylib)        18958
        mach_msg2_trap  (in libsystem_kernel.dylib)        8626
```

### D6.1-b P2 normal-prose-to-large-table trial 2

动作开始：2026-09-20T11:14:50.900Z；日志 offset 2676600；应用/WebContent 27635/27685。

```json
{"path":"P2","fixture":"normal-prose-to-large-table","trial":2,"binary":"release","setupInfo":{"setupOffset":2668471,"documentId":"750492cd37f749a9","readyTs":"2026-09-20T19:14:47.800+08:00","modeMenuTs":"2026-09-20T19:14:48.287+08:00","lastMode":{"ts":"2026-09-20T18:25:58.213+08:00","level":"info","event":"view.mode.change","status":"success","actionId":"288935c4-1f7e-4035-975a-f32190d912b4","context":{"fromMode":"source","source":"setViewMode","toMode":"wysiwyg"},"durationMs":null,"error":null},"lastModePredatesLaunch":true,"appLine":"27635 /Users/jackcheng/Documents/01_Coding/mac-app/mdpro/src-tauri/target/release/bundle/macos/mdpro.app/Contents/MacOS/tauri-app","apid":"27635","wpid":"27685"},"offset":2676600,"end":2683087,"t0":1789902890900,"ended":1789902900955,"windowMs":10055,"cpuSpanMs":0,"above80Points":0,"peakCpu":0.3,"probeLatencyMs":10032,"firstProbeSentAt":"2026-09-20T11:14:50.965Z","probesSent":5,"probesHandled":1,"confirmedAction":true,"recovered":true,"dead":false,"actionError":null,"quiet10s":true,"lowerBoundMarker":"2026-09-20T19:14:51.109+08:00","probes":[{"sentAt":1789902890965,"iso":"2026-09-20T11:14:50.965Z","returnedAt":1789902891076},{"sentAt":1789902892982,"iso":"2026-09-20T11:14:52.982Z","returnedAt":1789902893085},{"sentAt":1789902895003,"iso":"2026-09-20T11:14:55.003Z","returnedAt":1789902895109},{"sentAt":1789902897019,"iso":"2026-09-20T11:14:57.019Z","returnedAt":1789902897126},{"sentAt":1789902899038,"iso":"2026-09-20T11:14:59.038Z","returnedAt":1789902899145}],"events":[{"ts":"2026-09-20T19:14:51.102+08:00","level":"info","event":"editor.milkdown.mount","status":"success","actionId":"ecf01bcc-e355-4d2c-b785-998725b13699","context":{"contentLength":0,"documentId":null,"hasContent":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:14:51.102+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"ffd866d1-a13e-4f8e-893c-fdf14cfef721","context":{"editorLoading":true,"hasInstance":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:14:51.109+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"f2189f72-5116-462a-9484-308c790db627","context":{"editorLoading":false,"hasInstance":true},"durationMs":null,"error":null},{"ts":"2026-09-20T19:14:51.117+08:00","level":"info","event":"tab.open","status":"success","actionId":"fd6d0a88-9430-46a8-a7d3-a70a53420334","context":{"documentId":"9bcf40cdc1692ed5","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/large-table.wysiwyg.md","tabIndex":0},"durationMs":null,"error":null},{"ts":"2026-09-20T19:14:51.122+08:00","level":"info","event":"editor.milkdown.mount","status":"success","actionId":"f46e5afb-5258-4bdf-b8cd-2e7cb70674c9","context":{"contentLength":415976,"documentId":"9bcf40cdc1692ed5","hasContent":true},"durationMs":null,"error":null},{"ts":"2026-09-20T19:14:51.123+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"c235780a-6d2b-42a0-a289-7417ffe51ba9","context":{"editorLoading":true,"hasInstance":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:15:00.997+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"b4387b9e-bf4b-43e3-9625-7ec593e8bd1e","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:15:00.997+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"0f90e6e7-59e5-4630-b044-9df0c8643cb8","context":{"editorLoading":false,"hasInstance":true},"durationMs":null,"error":null}]}
```

CPU [相对 ms, %cpu]：
```json
[[6,0.2],[261,0.3],[512,0.2],[762,0.2],[1013,0.1],[1262,0],[1514,0],[1765,0],[2015,0],[2265,0],[2517,0],[2767,0],[3018,0],[3267,0],[3520,0],[3770,0],[4020,0],[4270,0],[4523,0],[4775,0],[5027,0],[5276,0],[5527,0],[5778,0],[6028,0],[6277,0],[6530,0],[6780,0],[7030,0],[7281,0],[7533,0],[7785,0],[8034,0],[8283,0],[8536,0],[8787,0],[9038,0],[9288,0],[9539,0],[9788,0],[10041,0]]
```

热点（所有线程，命中次数非 ms）：
```text
Sort by top of stack, same collapsed (when >= 5):
        __psynch_cvwait  (in libsystem_kernel.dylib)        55282
        __workq_kernreturn  (in libsystem_kernel.dylib)        18502
        mach_msg2_trap  (in libsystem_kernel.dylib)        8738
```

### D6.1-b P2 normal-prose-to-large-table trial 3

动作开始：2026-09-20T11:15:06.071Z；日志 offset 2691216；应用/WebContent 28249/28299。

```json
{"path":"P2","fixture":"normal-prose-to-large-table","trial":3,"binary":"release","setupInfo":{"setupOffset":2683087,"documentId":"750492cd37f749a9","readyTs":"2026-09-20T19:15:02.972+08:00","modeMenuTs":"2026-09-20T19:15:03.451+08:00","lastMode":{"ts":"2026-09-20T18:25:58.213+08:00","level":"info","event":"view.mode.change","status":"success","actionId":"288935c4-1f7e-4035-975a-f32190d912b4","context":{"fromMode":"source","source":"setViewMode","toMode":"wysiwyg"},"durationMs":null,"error":null},"lastModePredatesLaunch":true,"appLine":"28249 /Users/jackcheng/Documents/01_Coding/mac-app/mdpro/src-tauri/target/release/bundle/macos/mdpro.app/Contents/MacOS/tauri-app","apid":"28249","wpid":"28299"},"offset":2691216,"end":2697703,"t0":1789902906071,"ended":1789902916123,"windowMs":10052,"cpuSpanMs":0,"above80Points":0,"peakCpu":0.7,"probeLatencyMs":10040,"firstProbeSentAt":"2026-09-20T11:15:06.131Z","probesSent":5,"probesHandled":1,"confirmedAction":true,"recovered":true,"dead":false,"actionError":null,"quiet10s":true,"lowerBoundMarker":"2026-09-20T19:15:06.276+08:00","probes":[{"sentAt":1789902906131,"iso":"2026-09-20T11:15:06.131Z","returnedAt":1789902906235},{"sentAt":1789902908147,"iso":"2026-09-20T11:15:08.147Z","returnedAt":1789902908251},{"sentAt":1789902910170,"iso":"2026-09-20T11:15:10.170Z","returnedAt":1789902910276},{"sentAt":1789902912184,"iso":"2026-09-20T11:15:12.184Z","returnedAt":1789902912286},{"sentAt":1789902914206,"iso":"2026-09-20T11:15:14.206Z","returnedAt":1789902914310}],"events":[{"ts":"2026-09-20T19:15:06.269+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"c5d2d768-b0c1-4c53-ba13-9a9b650d08ce","context":{"editorLoading":true,"hasInstance":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:15:06.269+08:00","level":"info","event":"editor.milkdown.mount","status":"success","actionId":"fe086823-2ea8-4b26-a411-ad2d566ead43","context":{"contentLength":0,"documentId":null,"hasContent":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:15:06.276+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"4744aaa6-cc2d-4599-9464-7cc3c517cafc","context":{"editorLoading":false,"hasInstance":true},"durationMs":null,"error":null},{"ts":"2026-09-20T19:15:06.283+08:00","level":"info","event":"tab.open","status":"success","actionId":"6845f73e-ac79-43b0-9ab4-94f42b33a3ee","context":{"documentId":"9bcf40cdc1692ed5","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/large-table.wysiwyg.md","tabIndex":0},"durationMs":null,"error":null},{"ts":"2026-09-20T19:15:06.289+08:00","level":"info","event":"editor.milkdown.mount","status":"success","actionId":"6b538c9a-5761-46e4-82ff-0042a3d41dfa","context":{"contentLength":415976,"documentId":"9bcf40cdc1692ed5","hasContent":true},"durationMs":null,"error":null},{"ts":"2026-09-20T19:15:06.289+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"2a593dba-4252-47b0-ac63-771e0ecf9f54","context":{"editorLoading":true,"hasInstance":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:15:16.171+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"a9b33b8d-2122-4dba-875e-649873c724ce","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:15:16.171+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"c24bae0f-a02c-40c0-a646-4125790acf8e","context":{"editorLoading":false,"hasInstance":true},"durationMs":null,"error":null}]}
```

CPU [相对 ms, %cpu]：
```json
[[6,0.2],[259,0.7],[511,0.3],[762,0.3],[1013,0.1],[1262,0],[1516,0],[1766,0],[2016,0],[2264,0],[2516,0],[2767,0],[3018,0],[3269,0],[3519,0],[3770,0],[4021,0],[4270,0],[4523,0],[4774,0],[5025,0],[5275,0],[5527,0],[5777,0],[6028,0],[6277,0],[6529,0],[6780,0],[7033,0],[7282,0],[7532,0],[7783,0],[8034,0],[8282,0],[8535,0],[8786,0],[9037,0],[9288,0],[9538,0],[9788,0],[10039,0]]
```

热点（所有线程，命中次数非 ms）：
```text
Sort by top of stack, same collapsed (when >= 5):
        __psynch_cvwait  (in libsystem_kernel.dylib)        62066
        __workq_kernreturn  (in libsystem_kernel.dylib)        15741
        mach_msg2_trap  (in libsystem_kernel.dylib)        8709
```

### P2 初次三次记录的有效性更正（保留原值）

按 brief 的 open -a 指令执行时，当前应用实际新建窗口。首轮窗口日志：19:14:35.832 window.open，windowLabel=mdpro-28df3903-7e03-4023-8d78-5f022829dbac；tab.switch 是 fromDocumentId:null → large-table，不是 normal-prose → large-table。三轮均相同模式。因此上面 P2 三条自动摘要的 confirmedAction/recovered 布尔值只验证了新文档到达，**不能证明目标切换成立**，正式 P2 均标 VOID / NOT VERIFIED；CPU 采到的是原窗口，0 不可用于目标窗口。其约 10 秒探针延迟也不作为有效 P2 成绩。

源码 useDocument.ts:95 的 openDocumentFromDialog 会在当前 store 激活文档。改用 Cmd+O → Cmd+Shift+G 输入指定文件 → Return，最后确认打开前才启动计量。有效性必须同时满足 tab.switch.fromDocumentId=normal-prose、toDocumentId=large-table、目标 mount 且没有 window.open。此为修正驱动方式，不修改应用，也不重测 A。

前置清理后的 mdpro 进程：[]。

### D6.1-b P2-same-window normal-prose-to-large-table trial 1

动作开始：2026-09-20T11:17:26.944Z；日志 offset 2710681；应用/WebContent 29049/29057。

```json
{"path":"P2-same-window","fixture":"normal-prose-to-large-table","trial":1,"binary":"release","setupInfo":{"setupOffset":2701921,"documentId":"750492cd37f749a9","readyTs":"2026-09-20T19:17:21.660+08:00","modeMenuTs":"2026-09-20T19:17:22.158+08:00","lastMode":{"ts":"2026-09-20T18:25:58.213+08:00","level":"info","event":"view.mode.change","status":"success","actionId":"288935c4-1f7e-4035-975a-f32190d912b4","context":{"fromMode":"source","source":"setViewMode","toMode":"wysiwyg"},"durationMs":null,"error":null},"lastModePredatesLaunch":true,"appLine":"29049 /Users/jackcheng/Documents/01_Coding/mac-app/mdpro/src-tauri/target/release/bundle/macos/mdpro.app/Contents/MacOS/tauri-app","apid":"29049","wpid":"29057"},"offset":2710681,"end":2722915,"t0":1789903046944,"ended":1789903126732,"windowMs":79788,"cpuSpanMs":11793,"above80Points":48,"peakCpu":142.3,"probeLatencyMs":10889,"firstProbeSentAt":"2026-09-20T11:17:27.071Z","probesSent":40,"probesHandled":35,"confirmedAction":true,"recovered":true,"dead":false,"actionError":null,"quiet10s":true,"lowerBoundMarker":"2026-09-20T19:17:37.962+08:00","probes":[{"sentAt":1789903047071,"iso":"2026-09-20T11:17:27.071Z","returnedAt":1789903047169},{"sentAt":1789903049089,"iso":"2026-09-20T11:17:29.089Z","returnedAt":1789903049193},{"sentAt":1789903051102,"iso":"2026-09-20T11:17:31.102Z","returnedAt":1789903051206},{"sentAt":1789903053121,"iso":"2026-09-20T11:17:33.121Z","returnedAt":1789903053231},{"sentAt":1789903055142,"iso":"2026-09-20T11:17:35.142Z","returnedAt":1789903055243},{"sentAt":1789903057162,"iso":"2026-09-20T11:17:37.162Z","returnedAt":1789903057259},{"sentAt":1789903059183,"iso":"2026-09-20T11:17:39.183Z","returnedAt":1789903059310},{"sentAt":1789903061210,"iso":"2026-09-20T11:17:41.210Z","returnedAt":1789903061333},{"sentAt":1789903063230,"iso":"2026-09-20T11:17:43.230Z","returnedAt":1789903063356},{"sentAt":1789903065255,"iso":"2026-09-20T11:17:45.255Z","returnedAt":1789903065390},{"sentAt":1789903067280,"iso":"2026-09-20T11:17:47.280Z","returnedAt":1789903067406},{"sentAt":1789903069301,"iso":"2026-09-20T11:17:49.301Z","returnedAt":1789903069430},{"sentAt":1789903071323,"iso":"2026-09-20T11:17:51.323Z","returnedAt":1789903071449},{"sentAt":1789903073349,"iso":"2026-09-20T11:17:53.349Z","returnedAt":1789903073474},{"sentAt":1789903075369,"iso":"2026-09-20T11:17:55.369Z","returnedAt":1789903075498},{"sentAt":1789903077392,"iso":"2026-09-20T11:17:57.392Z","returnedAt":1789903077515},{"sentAt":1789903079415,"iso":"2026-09-20T11:17:59.415Z","returnedAt":1789903079545},{"sentAt":1789903081439,"iso":"2026-09-20T11:18:01.439Z","returnedAt":1789903081569},{"sentAt":1789903083460,"iso":"2026-09-20T11:18:03.460Z","returnedAt":1789903083591},{"sentAt":1789903085479,"iso":"2026-09-20T11:18:05.479Z","returnedAt":1789903085606},{"sentAt":1789903087499,"iso":"2026-09-20T11:18:07.499Z","returnedAt":1789903087623},{"sentAt":1789903089521,"iso":"2026-09-20T11:18:09.521Z","returnedAt":1789903089656},{"sentAt":1789903091543,"iso":"2026-09-20T11:18:11.543Z","returnedAt":1789903091673},{"sentAt":1789903093574,"iso":"2026-09-20T11:18:13.574Z","returnedAt":1789903093702},{"sentAt":1789903095594,"iso":"2026-09-20T11:18:15.594Z","returnedAt":1789903095723},{"sentAt":1789903097616,"iso":"2026-09-20T11:18:17.616Z","returnedAt":1789903097733},{"sentAt":1789903099637,"iso":"2026-09-20T11:18:19.637Z","returnedAt":1789903099765},{"sentAt":1789903101660,"iso":"2026-09-20T11:18:21.660Z","returnedAt":1789903101760},{"sentAt":1789903103679,"iso":"2026-09-20T11:18:23.679Z","returnedAt":1789903103793},{"sentAt":1789903105703,"iso":"2026-09-20T11:18:25.703Z","returnedAt":1789903105832},{"sentAt":1789903107725,"iso":"2026-09-20T11:18:27.725Z","returnedAt":1789903107849},{"sentAt":1789903109748,"iso":"2026-09-20T11:18:29.748Z","returnedAt":1789903109874},{"sentAt":1789903111773,"iso":"2026-09-20T11:18:31.773Z","returnedAt":1789903111902},{"sentAt":1789903113793,"iso":"2026-09-20T11:18:33.793Z","returnedAt":1789903113924},{"sentAt":1789903115813,"iso":"2026-09-20T11:18:35.813Z","returnedAt":1789903115941},{"sentAt":1789903117838,"iso":"2026-09-20T11:18:37.838Z","returnedAt":1789903117968},{"sentAt":1789903119854,"iso":"2026-09-20T11:18:39.854Z","returnedAt":1789903119988},{"sentAt":1789903121875,"iso":"2026-09-20T11:18:41.875Z","returnedAt":1789903122002},{"sentAt":1789903123898,"iso":"2026-09-20T11:18:43.898Z","returnedAt":1789903124032},{"sentAt":1789903125921,"iso":"2026-09-20T11:18:45.921Z","returnedAt":1789903126056}],"events":[{"ts":"2026-09-20T19:17:27.100+08:00","level":"info","event":"tab.open","status":"success","actionId":"fe6e8143-a228-42bc-9352-a63c67ce1d30","context":{"documentId":"9bcf40cdc1692ed5","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/large-table.wysiwyg.md","tabIndex":1},"durationMs":null,"error":null},{"ts":"2026-09-20T19:17:27.100+08:00","level":"info","event":"tab.switch","status":"success","actionId":"86a57e19-ff79-41bb-91c3-693f5aebd6d0","context":{"fromDocumentId":"750492cd37f749a9","toDocumentId":"9bcf40cdc1692ed5"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:17:27.108+08:00","level":"info","event":"editor.milkdown.mount","status":"success","actionId":"7334b61b-9064-470a-aaa2-f85c26c8bde0","context":{"contentLength":415976,"documentId":"9bcf40cdc1692ed5","hasContent":true},"durationMs":null,"error":null},{"ts":"2026-09-20T19:17:27.108+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"7978a891-594f-4af3-85f4-af72895d988a","context":{"editorLoading":true,"hasInstance":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:17:37.960+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"90cd7528-bd4d-4c97-9199-ebd9c9d6abd8","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:17:37.962+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"f4e56fcc-7444-4dcd-8fdc-5aa95e1eab23","context":{"editorLoading":false,"hasInstance":true},"durationMs":null,"error":null},{"ts":"2026-09-20T19:17:38.756+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"2374f68f-8dd6-4a9d-a7cf-e779ebe055bc","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:17:38.824+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"77d75087-66e6-4d75-88bb-7b8f71afde69","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:17:38.939+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"f9f41869-668f-4ec9-bc06-3c9a02e5ae81","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:17:38.991+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"d7ac2129-c50f-4ac8-afde-0b72104675c6","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:17:39.094+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"823bd29e-a8ce-4eb4-b991-071b40cb65bc","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:17:39.317+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"f92a31b8-171e-484f-8832-8923b4094048","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:17:41.348+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"c9e058d2-23be-44d4-9485-8ec38145a229","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:17:43.372+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"9bb32c64-1a8f-4659-8606-5c59207e7540","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:17:45.398+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"930859a1-9168-400d-8061-b9f4cdc260da","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:17:47.422+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"d3ad808c-de44-4189-b565-ac64b59c4b6b","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:17:49.442+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"53ad16ef-ff7a-4e5c-8625-7ed801d595cf","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:17:51.464+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"37868d0b-4b1a-41b6-8c48-263a7382d06f","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:17:53.489+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"e002ab93-bef1-471b-a8b0-f62c78cbbb5c","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:17:55.512+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"e697a953-fab1-44b1-b923-3af019ec0e64","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:17:57.528+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"fe427ae9-8de8-4d6d-ba3c-298b60b01852","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:17:59.561+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"e19f762f-3018-41a5-9cc3-cf1a4fdaf4f2","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:18:01.577+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"2eb571d0-9779-46ee-a754-94fede5eb0d8","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:18:03.604+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"19086e6b-593f-4ed3-a5e6-d4398ae331db","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:18:05.618+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"240abb81-4113-4b20-8e62-f89bc5d68364","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:18:07.637+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"3fb3b8eb-8d27-4dce-a5e3-1952b2c983dc","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:18:09.665+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"79dad88b-043c-4f74-a008-da386db99a14","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:18:11.686+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"52c27596-97ad-4e28-b72e-8555867c2908","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:18:13.715+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"af8b1e5c-3b9a-4429-8a79-62d7db3a1b0d","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:18:15.738+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"ce0ebf84-5de0-4597-ba43-b0c9c6fd66af","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:18:17.748+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"eeb441ad-7797-4721-b65a-df30bedb4e82","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:18:19.780+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"f2c8f87f-ef3e-46b5-a54a-72bca3369296","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:18:21.772+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"1f85f9ad-bb04-42cf-9259-fae11a3b8863","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:18:23.806+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"93e73f91-aced-4194-a6d2-44f46a483e6d","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:18:25.843+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"a312ed05-2f5c-4ee5-ab8f-644c7ace1473","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:18:27.867+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"7275c594-5e1d-4f83-b3e9-43bd7a24e683","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:18:29.884+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"287d9666-be8e-42a9-ba58-a23b8ba6ad0d","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:18:31.915+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"7d8ad8e0-ed4e-4ecd-8028-5fcee2bca414","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:18:33.940+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"c73c2a48-b99c-4207-8dfe-dc01affbde1b","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:18:35.954+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"88cbaf8c-e853-4ff0-a1c8-b94b3fb9ccbb","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null}]}
```

CPU [相对 ms, %cpu]：
```json
[[7,0.1],[260,48.9],[514,77.3],[765,85.2],[1015,98.5],[1265,96.2],[1518,93.6],[1769,91.2],[2021,90.2],[2270,91.8],[2522,92.4],[2771,91],[3024,90.7],[3274,90.2],[3525,90.1],[3776,90.2],[4027,89.9],[4276,91.6],[4529,94.5],[4780,91.8],[5032,90.9],[5282,90.4],[5532,90],[5784,90.1],[6034,90.1],[6282,91.5],[6535,93.2],[6785,91.5],[7037,90.9],[7289,90.2],[7540,89.7],[7788,90],[8042,91.3],[8290,90.9],[8544,93.3],[8797,91.2],[9047,92.2],[9299,90.4],[9547,104.9],[9798,123.3],[10049,137.4],[10298,131.3],[10549,142.3],[10801,115.3],[11053,128.9],[11303,109.3],[11554,103.9],[11805,101.8],[12055,111.9],[12304,116.2],[12558,86.2],[12808,34.9],[13059,37.7],[13309,16.7],[13561,6.7],[13812,2.4],[14063,0.9],[14310,0.4],[14563,36.2],[14814,22.1],[15066,8.8],[15315,3.7],[15567,32.4],[15816,13.4],[16067,4.9],[16316,1.8],[16567,29.7],[16820,24],[17068,9.5],[17322,3.9],[17574,1.5],[17823,0.7],[18075,0.2],[18324,0.1],[18573,23.5],[18825,25.2],[19076,10],[19327,4.3],[19577,1.7],[19829,0.7],[20082,0.3],[20332,0.1],[20580,15.2],[20833,27.1],[21083,10.7],[21332,4.5],[21583,1.9],[21834,0.7],[22086,0.4],[22336,0.2],[22585,9.6],[22840,27.6],[23091,10.4],[23342,4.5],[23592,1.8],[23844,0.7],[24094,0.3],[24344,0.2],[24593,5.1],[24848,29.4],[25099,11.2],[25351,4.8],[25600,1.9],[25850,0.8],[26102,0.4],[26353,0.1],[26602,0],[26856,28.6],[27107,13.2],[27357,5.5],[27608,2.2],[27858,0.9],[28108,0.4],[28360,0.2],[28608,0],[28859,33.4],[29113,15.3],[29362,6.1],[29613,2.6],[29863,1],[30116,0.3],[30366,1.1],[30614,0.5],[30866,33.7],[31117,15.5],[31368,6.1],[31621,2.6],[31869,1],[32119,0.4],[32370,0.1],[32619,0],[32872,37.3],[33125,16.6],[33374,6.8],[33624,2.6],[33875,1.1],[34126,0.4],[34377,0.1],[34625,0.1],[34876,38.3],[35131,16.7],[35380,6.8],[35632,2.6],[35884,1.1],[36133,0.4],[36384,0.2],[36632,0],[36885,39.9],[37135,20.8],[37386,8.3],[37638,3.2],[37888,1.3],[38138,0.5],[38389,0.2],[38635,0],[38890,34.6],[39141,21.2],[39391,8.6],[39642,3.4],[39892,1.4],[40143,0.5],[40395,0.3],[40642,0.1],[40896,31.8],[41147,23],[41398,9.1],[41650,3.7],[41900,1.4],[42150,0.6],[42402,0.2],[42650,0.1],[42904,33.6],[43156,15.6],[43407,6.4],[43658,2.6],[43908,1],[44159,0.5],[44411,0.2],[44659,0.1],[44912,37.6],[45163,16.8],[45416,6.7],[45666,2.6],[45916,1.1],[46167,0.4],[46413,0.2],[46665,0.1],[46917,39.6],[47168,17.8],[47419,7.2],[47669,2.8],[47921,1.2],[48172,0.5],[48422,0.2],[48672,0.1],[48923,37.7],[49175,22],[49426,8.9],[49677,3.4],[49927,1.3],[50178,0.5],[50426,0.2],[50677,0],[50928,37.7],[51181,21.5],[51433,8.6],[51683,3.3],[51934,1.3],[52185,0.5],[52435,0.2],[52688,0.1],[52936,29.4],[53190,24.1],[53441,9.4],[53692,4.1],[53944,1.5],[54192,0.7],[54444,0.3],[54692,0],[54942,29.4],[55193,18.3],[55445,7.3],[55696,2.9],[55947,1.1],[56197,0.5],[56448,0.2],[56700,0.1],[56950,20.3],[57203,26.6],[57453,10.3],[57702,4.4],[57954,1.7],[58206,0.7],[58456,0.3],[58706,0],[58955,10.6],[59208,27.1],[59457,10.2],[59706,4.1],[59959,1.7],[60210,0.6],[60461,0.2],[60713,0],[60960,4.4],[61214,29.8],[61466,11.3],[61716,4.6],[61967,1.9],[62219,0.8],[62468,0.3],[62718,0],[62968,0],[63221,27.3],[63472,12.6],[63721,5.2],[63971,2.1],[64222,0.8],[64473,0.4],[64724,0.2],[64972,0],[65226,33.4],[65477,15.1],[65727,6.3],[65979,2.5],[66228,1],[66481,0.4],[66732,0.1],[66980,0.1],[67233,35.3],[67484,16.1],[67734,6.5],[67986,2.5],[68236,1],[68489,21.3],[68741,11.1],[68988,24.4],[69242,48.5],[69491,22],[69739,8.7],[69989,10.4],[70241,4],[70490,4.5],[70743,1.8],[70992,0.8],[71247,0.3],[71497,0.1],[71746,0],[71999,0.1],[72251,0],[72501,0.1],[72753,0],[73002,0],[73256,0],[73508,0],[73755,0],[74009,0],[74259,0],[74512,0],[74761,0],[75008,0],[75260,0],[75511,0],[75760,0],[76014,0],[76265,0],[76516,0],[76765,0],[77014,0],[77266,0],[77518,0],[77766,0],[78018,0],[78270,0],[78522,0],[78772,0],[79021,0],[79273,0],[79524,0],[79773,0]]
```

热点（所有线程，命中次数非 ms）：
```text
Sort by top of stack, same collapsed (when >= 5):
        __psynch_cvwait  (in libsystem_kernel.dylib)        61570
        __workq_kernreturn  (in libsystem_kernel.dylib)        15226
        JSC::JSObject::countElements()  (in JavaScriptCore)        7340
        operationArrayIndexOfNonStringIdentityValueContiguous  (in JavaScriptCore)        96
        JSC::JSFinalObject::visitChildren(JSC::JSCell*, JSC::SlotVisitor&)  (in JavaScriptCore)        61
        JSC::JSObject::visitChildren(JSC::JSCell*, JSC::SlotVisitor&)  (in JavaScriptCore)        49
        JSC::BlockDirectory::tryAllocateBlock(JSC::Heap&)  (in JavaScriptCore)        37
        JSC::SlotVisitor::drain(WTF::MonotonicTime)  (in JavaScriptCore)        31
        JSC::MarkedBlock::Handle::sweep(JSC::FreeList*)  (in JavaScriptCore)        26
        mach_msg2_trap  (in libsystem_kernel.dylib)        25
        JSC::JSObject::putOwnDataPropertyBatching(JSC::VM&, WTF::UniquedStringImpl**, long long const*, unsigned int)  (in JavaScriptCore)        20
        JSC::globalFuncCloneObject(JSC::JSGlobalObject*, JSC::CallFrame*)  (in JavaScriptCore)        19
        _platform_memset  (in libsystem_platform.dylib)        13
        JSC::DFG::performGraphPackingAndLivenessAnalysis(JSC::DFG::Graph&)  (in JavaScriptCore)        12
        JSC::arrayProtoFuncPush(JSC::JSGlobalObject*, JSC::CallFrame*)  (in JavaScriptCore)        12
        __bzero  (in libsystem_platform.dylib)        11
        JSC::JSObject::putDirectInternal<(JSC::JSObject::PutMode)1>(JSC::VM&, JSC::PropertyName, JSC::JSValue, unsigned int, JSC::PutPropertySlot&)  (in JavaScriptCore)        10
        _platform_memmove  (in libsystem_platform.dylib)        10
        pas_thread_local_cache_flush_deallocation_log  (in JavaScriptCore)        10
        slow_path_spread  (in JavaScriptCore)        10
        JSC::B3::Air::Greedy::GreedyAllocator::run()  (in JavaScriptCore)        9
        JSC::B3::eliminateDeadCodeImpl(JSC::B3::Procedure&)  (in JavaScriptCore)        9
        JSC::JSArray::tryCreate(JSC::VM&, JSC::Structure*, unsigned int)  (in JavaScriptCore)        9
        JSC::JSObject::putDirectIndex(JSC::JSGlobalObject*, unsigned int, JSC::JSValue, unsigned int, JSC::PutDirectIndexMode)  (in JavaScriptCore)        9
        JSC::objectConstructorValues(JSC::JSGlobalObject*, JSC::CallFrame*)  (in JavaScriptCore)        9
        JSC::B3::Air::Greedy::GreedyAllocator::allocateRegisters<(JSC::B3::Bank)0>()  (in JavaScriptCore)        8
        JSC::B3::fixSSA(JSC::B3::Procedure&)  (in JavaScriptCore)        8
        JSC::arrayProtoFuncSplice(JSC::JSGlobalObject*, JSC::CallFrame*)  (in JavaScriptCore)        8
        JSC::objectAssignFast(JSC::JSGlobalObject*, JSC::JSFinalObject*, JSC::JSObject*, WTF::Vector<WTF::UniquedStringImpl*, 8ul, WTF::CrashOnOverflow, 16ul, WTF::FastMalloc>&, JSC::MarkedVector<JSC::JSValue, 8ul, WTF::RecordOverflow>&)::'lambda'(JSC::PropertyTableEntry const&)::operator()(JSC::PropertyTableEntry const&) const  (in JavaScriptCore)        8
        JSC::DFG::CPSRethreadingPhase::run()  (in JavaScriptCore)        7
        JSC::DFG::runPhase<JSC::DFG::(anonymous namespace)::PutStackSinkingPhase>(JSC::DFG::Graph&)  (in JavaScriptCore)        7
        JSC::JSArray::appendMemcpy(JSC::JSGlobalObject*, JSC::VM&, unsigned int, JSC::JSArray*)  (in JavaScriptCore)        7
        JSC::JSLexicalEnvironment::visitChildren(JSC::JSCell*, JSC::SlotVisitor&)  (in JavaScriptCore)        7
        JSC::JSObject::initializeIndex(JSC::ObjectInitializationScope&, unsigned int, JSC::JSValue)  (in JavaScriptCore)        7
        WTF::HashMap<unsigned long long, JSC::SparseArrayEntry, WTF::IntHash<unsigned long long>, WTF::UnsignedWithZeroKeyHashTraits<unsigned long long>, WTF::HashTraits<JSC::SparseArrayEntry>, WTF::HashTableTraits, (WTF::ShouldValidateKey)0, WTF::FastMalloc>::add<JSC::SparseArrayEntry>(unsigned long long&&, JSC::SparseArrayEntry&&)  (in JavaScriptCore)        7
        WTF::Liveness<JSC::B3::Air::UnifiedTmpLivenessAdapter>::compute()  (in JavaScriptCore)        6
        operationObjectAssignObject  (in JavaScriptCore)        6
        operationSpreadGeneric  (in JavaScriptCore)        6
        JSC::B3::(anonymous namespace)::CSE::run()  (in JavaScriptCore)        5
        JSC::DFG::InPlaceAbstractState::initialize()  (in JavaScriptCore)        5
        JSC::JSObject::getOwnPropertySlotByIndex(JSC::JSObject*, JSC::JSGlobalObject*, unsigned int, JSC::PropertySlot&)  (in JavaScriptCore)        5
        JSC::JSObject::hasProperty(JSC::JSGlobalObject*, unsigned int) const  (in JavaScriptCore)        5
        operationIteratorNextTryFast  (in JavaScriptCore)        5
        pas_thread_local_cache_for_all  (in JavaScriptCore)        5
```

### D6.1-b P2-same-window normal-prose-to-large-table trial 2

动作开始：2026-09-20T11:18:53.793Z；日志 offset 2731675；应用/WebContent 32186/32228。

```json
{"path":"P2-same-window","fixture":"normal-prose-to-large-table","trial":2,"binary":"release","setupInfo":{"setupOffset":2722915,"documentId":"750492cd37f749a9","readyTs":"2026-09-20T19:18:48.535+08:00","modeMenuTs":"2026-09-20T19:18:49.020+08:00","lastMode":{"ts":"2026-09-20T18:25:58.213+08:00","level":"info","event":"view.mode.change","status":"success","actionId":"288935c4-1f7e-4035-975a-f32190d912b4","context":{"fromMode":"source","source":"setViewMode","toMode":"wysiwyg"},"durationMs":null,"error":null},"lastModePredatesLaunch":true,"appLine":"32186 /Users/jackcheng/Documents/01_Coding/mac-app/mdpro/src-tauri/target/release/bundle/macos/mdpro.app/Contents/MacOS/tauri-app","apid":"32186","wpid":"32228"},"offset":2731675,"end":2731675,"t0":1789903133793,"ended":1789903143838,"windowMs":10045,"cpuSpanMs":0,"above80Points":0,"peakCpu":1.5,"probeLatencyMs":null,"firstProbeSentAt":"2026-09-20T11:18:53.935Z","probesSent":5,"probesHandled":0,"confirmedAction":false,"recovered":false,"dead":false,"actionError":null,"quiet10s":true,"probes":[{"sentAt":1789903133935,"iso":"2026-09-20T11:18:53.935Z","returnedAt":1789903134055},{"sentAt":1789903135956,"iso":"2026-09-20T11:18:55.956Z","returnedAt":1789903136091},{"sentAt":1789903137975,"iso":"2026-09-20T11:18:57.975Z","returnedAt":1789903138093},{"sentAt":1789903139996,"iso":"2026-09-20T11:18:59.996Z","returnedAt":1789903140126},{"sentAt":1789903142015,"iso":"2026-09-20T11:19:02.015Z","returnedAt":1789903142157}],"events":[]}
```

CPU [相对 ms, %cpu]：
```json
[[8,0.1],[262,0.8],[514,0.3],[765,0.1],[1017,0.9],[1264,0.4],[1517,0.2],[1767,1],[2018,0.5],[2266,0.2],[2519,0.1],[2771,0.7],[3022,0.3],[3274,0.1],[3523,0.8],[3775,0.3],[4026,0.2],[4274,1.2],[4528,0.5],[4777,0.2],[5028,1.3],[5279,0.6],[5532,0.2],[5783,1.4],[6034,0.5],[6281,0.2],[6534,0.1],[6784,0.7],[7034,0.2],[7285,0.1],[7538,0.7],[7789,0.3],[8040,0.1],[8288,1.2],[8541,0.5],[8793,0.3],[9043,1.3],[9294,0.5],[9545,0.2],[9796,1.5],[10045,0.6]]
```

热点（所有线程，命中次数非 ms）：
```text
Sort by top of stack, same collapsed (when >= 5):
        __psynch_cvwait  (in libsystem_kernel.dylib)        54050
        __workq_kernreturn  (in libsystem_kernel.dylib)        25593
        mach_msg2_trap  (in libsystem_kernel.dylib)        8493
        pas_thread_local_cache_for_all  (in JavaScriptCore)        23
        WebCore::RenderGeometryMap::pushMappingsToAncestor(WebCore::RenderLayer const*, WebCore::RenderLayer const*, bool)  (in WebCore)        5
```

**D6.1-b 执行停止，未测项 NOT VERIFIED：** trial not recovered or action unconfirmed; preserve result and stop

### 同窗口 P2 trial 2 驱动失败与补测说明

第一次 trial 2 的日志窗口 [2731675,2731675) 为空，应用进程仍在、CPU 安静，但无 tab.switch/探针，不能判为应用卡死。辅助功能读取确认存在原生 Open 窗口，未完成文件选择确认。本条 VOID，保留原数据；后续补测增加路径框全选、打开按钮 enabled 校验，并明确点击 Open 按钮。用户告知关闭过一个窗口；有效 trial 1 的动作日志窗口无 window.close/file.close，补测均重新冷启动，不推断用户动作造成了上述驱动失败。

前置清理后的 mdpro 进程：[]。

### D6.1-b P2-same-window-retry normal-prose-to-large-table trial 2

动作开始：2026-09-20T11:21:01.014Z；日志 offset 2740435；应用/WebContent 33032/33082。

```json
{"path":"P2-same-window-retry","fixture":"normal-prose-to-large-table","trial":2,"binary":"release","setupInfo":{"setupOffset":2731675,"documentId":"750492cd37f749a9","readyTs":"2026-09-20T19:20:54.608+08:00","modeMenuTs":"2026-09-20T19:20:55.135+08:00","lastMode":{"ts":"2026-09-20T18:25:58.213+08:00","level":"info","event":"view.mode.change","status":"success","actionId":"288935c4-1f7e-4035-975a-f32190d912b4","context":{"fromMode":"source","source":"setViewMode","toMode":"wysiwyg"},"durationMs":null,"error":null},"lastModePredatesLaunch":true,"appLine":"33032 /Users/jackcheng/Documents/01_Coding/mac-app/mdpro/src-tauri/target/release/bundle/macos/mdpro.app/Contents/MacOS/tauri-app","apid":"33032","wpid":"33082"},"offset":2740435,"end":2766084,"t0":1789903261014,"ended":1789903441046,"windowMs":180032,"cpuSpanMs":11792,"above80Points":48,"peakCpu":130.7,"probeLatencyMs":10568,"firstProbeSentAt":"2026-09-20T11:21:01.290Z","probesSent":89,"probesHandled":89,"confirmedAction":true,"recovered":true,"dead":false,"actionError":null,"quiet10s":false,"lowerBoundMarker":"2026-09-20T19:21:11.860+08:00","probes":[{"sentAt":1789903261290,"iso":"2026-09-20T11:21:01.290Z","returnedAt":1789903261388},{"sentAt":1789903263310,"iso":"2026-09-20T11:21:03.310Z","returnedAt":1789903263410},{"sentAt":1789903265331,"iso":"2026-09-20T11:21:05.331Z","returnedAt":1789903265435},{"sentAt":1789903267348,"iso":"2026-09-20T11:21:07.348Z","returnedAt":1789903267454},{"sentAt":1789903269367,"iso":"2026-09-20T11:21:09.367Z","returnedAt":1789903269471},{"sentAt":1789903271390,"iso":"2026-09-20T11:21:11.390Z","returnedAt":1789903271485},{"sentAt":1789903273409,"iso":"2026-09-20T11:21:13.409Z","returnedAt":1789903273535},{"sentAt":1789903275432,"iso":"2026-09-20T11:21:15.432Z","returnedAt":1789903275560},{"sentAt":1789903277451,"iso":"2026-09-20T11:21:17.451Z","returnedAt":1789903277572},{"sentAt":1789903279473,"iso":"2026-09-20T11:21:19.473Z","returnedAt":1789903279602},{"sentAt":1789903281498,"iso":"2026-09-20T11:21:21.498Z","returnedAt":1789903281630},{"sentAt":1789903283521,"iso":"2026-09-20T11:21:23.521Z","returnedAt":1789903283643},{"sentAt":1789903285543,"iso":"2026-09-20T11:21:25.543Z","returnedAt":1789903285668},{"sentAt":1789903287568,"iso":"2026-09-20T11:21:27.568Z","returnedAt":1789903287693},{"sentAt":1789903289591,"iso":"2026-09-20T11:21:29.591Z","returnedAt":1789903289721},{"sentAt":1789903291615,"iso":"2026-09-20T11:21:31.615Z","returnedAt":1789903291743},{"sentAt":1789903293643,"iso":"2026-09-20T11:21:33.643Z","returnedAt":1789903293771},{"sentAt":1789903295666,"iso":"2026-09-20T11:21:35.666Z","returnedAt":1789903295779},{"sentAt":1789903297683,"iso":"2026-09-20T11:21:37.683Z","returnedAt":1789903297813},{"sentAt":1789903299710,"iso":"2026-09-20T11:21:39.710Z","returnedAt":1789903299838},{"sentAt":1789903301735,"iso":"2026-09-20T11:21:41.735Z","returnedAt":1789903301867},{"sentAt":1789903303758,"iso":"2026-09-20T11:21:43.758Z","returnedAt":1789903303894},{"sentAt":1789903305780,"iso":"2026-09-20T11:21:45.780Z","returnedAt":1789903305905},{"sentAt":1789903307801,"iso":"2026-09-20T11:21:47.801Z","returnedAt":1789903307927},{"sentAt":1789903309823,"iso":"2026-09-20T11:21:49.823Z","returnedAt":1789903309954},{"sentAt":1789903311850,"iso":"2026-09-20T11:21:51.850Z","returnedAt":1789903311977},{"sentAt":1789903313873,"iso":"2026-09-20T11:21:53.873Z","returnedAt":1789903314005},{"sentAt":1789903315890,"iso":"2026-09-20T11:21:55.890Z","returnedAt":1789903316021},{"sentAt":1789903317910,"iso":"2026-09-20T11:21:57.910Z","returnedAt":1789903318034},{"sentAt":1789903319937,"iso":"2026-09-20T11:21:59.937Z","returnedAt":1789903320068},{"sentAt":1789903321957,"iso":"2026-09-20T11:22:01.957Z","returnedAt":1789903322093},{"sentAt":1789903323978,"iso":"2026-09-20T11:22:03.978Z","returnedAt":1789903324077},{"sentAt":1789903326001,"iso":"2026-09-20T11:22:06.001Z","returnedAt":1789903326127},{"sentAt":1789903328024,"iso":"2026-09-20T11:22:08.024Z","returnedAt":1789903328154},{"sentAt":1789903330048,"iso":"2026-09-20T11:22:10.048Z","returnedAt":1789903330176},{"sentAt":1789903332070,"iso":"2026-09-20T11:22:12.070Z","returnedAt":1789903332196},{"sentAt":1789903334092,"iso":"2026-09-20T11:22:14.092Z","returnedAt":1789903334219},{"sentAt":1789903336118,"iso":"2026-09-20T11:22:16.118Z","returnedAt":1789903336246},{"sentAt":1789903338144,"iso":"2026-09-20T11:22:18.144Z","returnedAt":1789903338269},{"sentAt":1789903340167,"iso":"2026-09-20T11:22:20.167Z","returnedAt":1789903340296},{"sentAt":1789903342189,"iso":"2026-09-20T11:22:22.189Z","returnedAt":1789903342318},{"sentAt":1789903344216,"iso":"2026-09-20T11:22:24.216Z","returnedAt":1789903344344},{"sentAt":1789903346239,"iso":"2026-09-20T11:22:26.239Z","returnedAt":1789903346363},{"sentAt":1789903348261,"iso":"2026-09-20T11:22:28.261Z","returnedAt":1789903348385},{"sentAt":1789903350285,"iso":"2026-09-20T11:22:30.285Z","returnedAt":1789903350377},{"sentAt":1789903352310,"iso":"2026-09-20T11:22:32.310Z","returnedAt":1789903352437},{"sentAt":1789903354333,"iso":"2026-09-20T11:22:34.333Z","returnedAt":1789903354445},{"sentAt":1789903356355,"iso":"2026-09-20T11:22:36.355Z","returnedAt":1789903356479},{"sentAt":1789903358375,"iso":"2026-09-20T11:22:38.375Z","returnedAt":1789903358505},{"sentAt":1789903360394,"iso":"2026-09-20T11:22:40.394Z","returnedAt":1789903360520},{"sentAt":1789903362415,"iso":"2026-09-20T11:22:42.415Z","returnedAt":1789903362547},{"sentAt":1789903364438,"iso":"2026-09-20T11:22:44.438Z","returnedAt":1789903364571},{"sentAt":1789903366460,"iso":"2026-09-20T11:22:46.460Z","returnedAt":1789903366592},{"sentAt":1789903368481,"iso":"2026-09-20T11:22:48.481Z","returnedAt":1789903368610},{"sentAt":1789903370504,"iso":"2026-09-20T11:22:50.504Z","returnedAt":1789903370629},{"sentAt":1789903372526,"iso":"2026-09-20T11:22:52.526Z","returnedAt":1789903372654},{"sentAt":1789903374544,"iso":"2026-09-20T11:22:54.544Z","returnedAt":1789903374670},{"sentAt":1789903376566,"iso":"2026-09-20T11:22:56.566Z","returnedAt":1789903376668},{"sentAt":1789903378589,"iso":"2026-09-20T11:22:58.589Z","returnedAt":1789903378719},{"sentAt":1789903380610,"iso":"2026-09-20T11:23:00.610Z","returnedAt":1789903380735},{"sentAt":1789903382635,"iso":"2026-09-20T11:23:02.635Z","returnedAt":1789903382777},{"sentAt":1789903384656,"iso":"2026-09-20T11:23:04.656Z","returnedAt":1789903384777},{"sentAt":1789903386676,"iso":"2026-09-20T11:23:06.676Z","returnedAt":1789903386804},{"sentAt":1789903388699,"iso":"2026-09-20T11:23:08.699Z","returnedAt":1789903388822},{"sentAt":1789903390718,"iso":"2026-09-20T11:23:10.718Z","returnedAt":1789903390830},{"sentAt":1789903392741,"iso":"2026-09-20T11:23:12.741Z","returnedAt":1789903392871},{"sentAt":1789903394761,"iso":"2026-09-20T11:23:14.761Z","returnedAt":1789903394888},{"sentAt":1789903396779,"iso":"2026-09-20T11:23:16.779Z","returnedAt":1789903396912},{"sentAt":1789903398801,"iso":"2026-09-20T11:23:18.801Z","returnedAt":1789903398929},{"sentAt":1789903400822,"iso":"2026-09-20T11:23:20.822Z","returnedAt":1789903400951},{"sentAt":1789903402845,"iso":"2026-09-20T11:23:22.845Z","returnedAt":1789903402970},{"sentAt":1789903404868,"iso":"2026-09-20T11:23:24.868Z","returnedAt":1789903404995},{"sentAt":1789903406887,"iso":"2026-09-20T11:23:26.887Z","returnedAt":1789903407012},{"sentAt":1789903408906,"iso":"2026-09-20T11:23:28.906Z","returnedAt":1789903409035},{"sentAt":1789903410928,"iso":"2026-09-20T11:23:30.928Z","returnedAt":1789903411055},{"sentAt":1789903412949,"iso":"2026-09-20T11:23:32.949Z","returnedAt":1789903413079},{"sentAt":1789903414971,"iso":"2026-09-20T11:23:34.971Z","returnedAt":1789903415104},{"sentAt":1789903416989,"iso":"2026-09-20T11:23:36.989Z","returnedAt":1789903417120},{"sentAt":1789903419008,"iso":"2026-09-20T11:23:39.008Z","returnedAt":1789903419136},{"sentAt":1789903421031,"iso":"2026-09-20T11:23:41.031Z","returnedAt":1789903421161},{"sentAt":1789903423049,"iso":"2026-09-20T11:23:43.049Z","returnedAt":1789903423170},{"sentAt":1789903425069,"iso":"2026-09-20T11:23:45.069Z","returnedAt":1789903425193},{"sentAt":1789903427096,"iso":"2026-09-20T11:23:47.096Z","returnedAt":1789903427220},{"sentAt":1789903429113,"iso":"2026-09-20T11:23:49.113Z","returnedAt":1789903429243},{"sentAt":1789903431135,"iso":"2026-09-20T11:23:51.135Z","returnedAt":1789903431262},{"sentAt":1789903433157,"iso":"2026-09-20T11:23:53.157Z","returnedAt":1789903433287},{"sentAt":1789903435181,"iso":"2026-09-20T11:23:55.181Z","returnedAt":1789903435312},{"sentAt":1789903437203,"iso":"2026-09-20T11:23:57.203Z","returnedAt":1789903437327},{"sentAt":1789903439225,"iso":"2026-09-20T11:23:59.225Z","returnedAt":1789903439354}],"events":[{"ts":"2026-09-20T19:21:01.213+08:00","level":"info","event":"tab.switch","status":"success","actionId":"96119b76-dada-41e2-a16b-30153c9c081f","context":{"fromDocumentId":"750492cd37f749a9","toDocumentId":"9bcf40cdc1692ed5"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:21:01.213+08:00","level":"info","event":"tab.open","status":"success","actionId":"41f96517-7e90-4b85-8843-f30af64c2538","context":{"documentId":"9bcf40cdc1692ed5","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/large-table.wysiwyg.md","tabIndex":1},"durationMs":null,"error":null},{"ts":"2026-09-20T19:21:01.218+08:00","level":"info","event":"editor.milkdown.mount","status":"success","actionId":"a32996ad-2c5b-41df-8179-3b1031321e14","context":{"contentLength":415976,"documentId":"9bcf40cdc1692ed5","hasContent":true},"durationMs":null,"error":null},{"ts":"2026-09-20T19:21:01.218+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"5a346a83-bc69-4652-a777-af1e26957e70","context":{"editorLoading":true,"hasInstance":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:21:11.858+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"7a912669-d997-4aae-8e56-1c6f64a8c87d","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:21:11.860+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"391ef708-736b-43bc-84cb-4d3a4b58c0e5","context":{"editorLoading":false,"hasInstance":true},"durationMs":null,"error":null},{"ts":"2026-09-20T19:21:12.513+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"5f915ab7-8fb0-445f-98a3-8a15db99bcf1","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:21:12.717+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"4152b6ba-3e6b-4a28-9ba9-068ae58fadae","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:21:12.758+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"3a7f560d-6cd7-4f4e-a52b-be1d9956e248","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:21:12.788+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"79df869f-4a7f-4662-aded-dea3b501202b","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:21:12.812+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"84d3604c-84e3-4562-b18c-5fad4d236f16","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:21:13.549+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"0e173f4e-3f12-4486-b49e-4ef3242db860","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:21:15.582+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"d8c6cc80-be68-476e-8c19-f60963772bf0","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:21:17.587+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"81dd9fd2-2c74-400a-8255-9933b94a811f","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:21:19.619+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"dffc8b47-e1ef-4af9-bbf7-c9b5a61f874e","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:21:21.646+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"b619e150-2a6c-4de5-afb2-01c7fb455b30","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:21:23.654+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"d18bf711-4235-4ed5-abfc-2990b5d3b9c7","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:21:25.685+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"540a8782-de54-49c4-8083-1b80cf0fc76c","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:21:27.710+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"30bc4416-7c25-4a57-aa99-7133f6d175ec","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:21:29.739+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"c473b8f5-65e1-48b1-93f1-1724d27da515","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:21:31.760+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"e2ebe218-4648-4efb-b8c9-1d29a8047215","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:21:33.787+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"0aca47e4-3685-474a-97b1-29c9c5d5ec42","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:21:35.794+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"406e6f43-5d33-477c-877b-65d76241e1e3","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:21:37.830+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"3d70414c-c362-474d-b286-8953bae8642a","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:21:39.855+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"f40aa1f0-30be-45da-9ca0-e05a06d8254b","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:21:41.882+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"e062804b-e38f-4d0c-861c-497095ff69ed","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:21:43.912+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"bef35d67-6a3b-4185-ac8d-432f2752d9fb","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:21:45.918+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"7a8c15a8-b314-4ee6-83d6-d22637111ad5","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:21:47.938+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"4f1eb2d4-7826-42ba-8214-02bdfee708d6","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:21:49.972+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"4780ffcb-bc8a-40f6-8027-009f11e2c7d5","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:21:51.994+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"37c9e832-e4f1-41bf-b407-2f97cd35efff","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:21:54.021+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"25a8fd9b-894e-402c-b9f5-89e53cf10847","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:21:56.039+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"79c6773f-4236-4253-a274-dfe99e0bd13f","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:21:58.049+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"b3712c92-bb17-47f1-8220-46f4543cae27","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:22:00.085+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"fa305b0a-6753-44a9-acd6-d1c4d956d1c6","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:22:02.110+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"48931e73-80f6-4ea7-b780-4d82313a182e","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:22:04.091+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"0646f866-c8d3-4c61-8882-fb3ddb984e83","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:22:06.143+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"a1e3508a-af49-44f7-b71e-d245ec700295","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:22:08.171+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"fd583160-ad20-4cbb-89c7-c2c7f85120fc","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:22:10.192+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"7800a76b-9274-4ede-8fcd-5e58770613df","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:22:12.213+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"4a579d61-f392-498b-920c-d9fbeb2f67fb","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:22:14.234+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"6eab4707-5980-4314-9570-9aaa9e4142c9","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:22:16.262+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"c61ddab9-b18d-48f3-9cb4-6b3e2b132ae8","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:22:18.286+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"89469745-589d-4522-9612-dbd7c7ec11b4","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:22:20.309+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"9687d134-ab90-45a0-89da-4c4882d8632f","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:22:22.332+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"1735a3fe-6634-4ac9-b260-6d6c12b32060","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:22:24.361+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"317508ed-93a2-4519-81d2-8fdd12f7e1da","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:22:26.380+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"b981c927-1f20-4b1a-8a34-731b74391672","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:22:28.402+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"979f812d-2db1-43c9-9528-4a17e52effb8","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:22:30.393+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"5d5c4f1c-5e57-472f-9f02-f14a0061cc25","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:22:32.455+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"c8078851-4920-40d4-a6c2-086a1fd2f48a","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:22:34.463+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"c5f660ae-3843-40e8-8699-eb09fe35f0ec","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:22:36.497+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"fc2ecd01-ec5d-48de-83e2-e6657c1008ac","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:22:38.517+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"eadd9f7c-be95-47a2-b7fb-fd355ca042d7","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:22:40.537+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"502cba92-886b-4c99-9358-8c134584b7cc","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:22:42.563+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"12f30251-1a0c-47e7-b824-c1e89d6a3672","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:22:44.588+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"38426df2-141e-46da-b051-2eef64b29ae5","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:22:46.602+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"8069ab3b-647c-43df-9bba-68a7ac540298","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:22:48.624+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"d335b1e8-0372-48f6-97b9-6173d6b20fa7","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:22:50.646+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"a64df24f-1a2f-476d-b2b1-693c06d964bb","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:22:52.667+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"2955bee5-6333-4826-a87f-d2ac0279a18f","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:22:54.688+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"58aaad95-4880-4383-a62c-7df67d91e5f3","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:22:56.678+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"3dc12891-f58f-4764-9d92-25beba164ccb","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:22:58.733+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"81eb02af-1312-424e-a75e-2a20e116b536","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:23:00.752+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"15d276a9-97bf-4b7f-aa07-7e68c006e4f6","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:23:02.792+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"28d33599-f5d3-4991-89e7-8a2a8156a235","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:23:04.791+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"02dd993c-5362-4a68-ae18-8a4b647ecd2c","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:23:06.821+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"d7fe4442-b379-465f-8262-090f0ccfcef4","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:23:08.833+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"26cca267-c730-4fc7-ba37-494c8a0b76bd","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:23:10.844+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"428d8c98-0928-41ef-88af-05acb530e49c","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:23:12.887+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"1140f022-3c59-4b82-a2d7-c59270968a92","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:23:14.904+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"a3288362-932b-43d9-a04a-370899fff6f3","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:23:16.929+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"e39222de-bbc2-417c-8e42-8c026191959a","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:23:18.944+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"ea584ca4-7039-4a3e-a6c7-1a07473a5585","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:23:20.968+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"91a4b8d0-a5c8-4f36-ba2a-d2a7b3cd2f9b","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:23:22.986+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"0b5c1b4e-055b-4db3-b8f8-7890a2f89618","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:23:25.013+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"67e586ed-a36d-4839-a4b7-9797ed461553","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:23:27.025+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"3d952e86-e614-4602-9249-5b90c2b28430","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:23:29.051+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"cbdf09cc-211f-47db-8186-d58e970dac57","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:23:31.069+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"357f0a5e-0af0-4ce8-87e2-f102f530dd44","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:23:33.096+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"c9719923-cd0a-4ef6-9416-88783e61a2b1","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:23:35.122+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"2c0e7535-f7b8-4f77-8a72-421a47724961","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:23:37.134+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"2e838abc-72e4-4d60-9753-131a2b954a8b","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:23:39.149+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"38451d14-af2c-4329-b8dc-775095bd33dc","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:23:41.176+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"8fb2215a-1fdc-4431-a0d2-454c6b2b3d82","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:23:43.188+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"74fe6d19-b1ff-44c6-8a25-a57a59c15fed","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:23:45.211+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"a27b0e57-af53-4fae-9be2-b5c8ebf179ab","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:23:47.234+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"58f9db5a-5b96-4278-9c6a-dd82f28ded44","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:23:49.259+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"e5f22e94-91af-44a6-81bc-a43596713345","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:23:51.276+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"77af53b9-caad-490a-85bc-d5dd5544aaef","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:23:53.303+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"8b190f11-64d7-4ba4-ba14-1bfb6009eff8","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:23:55.329+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"1b92884e-f457-4ae6-b743-b4c9c9f5423b","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:23:57.341+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"e0bd9816-5a92-4935-84b4-5c2ad9e035b3","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:23:59.371+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"ed3d2039-d7b5-4c46-8d6f-c7031ec7917e","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null}]}
```

CPU [相对 ms, %cpu]：
```json
[[6,0.1],[259,2.6],[510,94.6],[763,93.2],[1014,91.1],[1263,92],[1516,92.5],[1767,90.6],[2018,90],[2268,89.7],[2517,92.3],[2769,91.8],[3019,90.4],[3271,89.8],[3521,89.8],[3772,90.3],[4022,89.8],[4272,89.7],[4521,92.1],[4773,91.8],[5024,90.6],[5275,90],[5525,89.7],[5777,89.8],[6028,89.8],[6278,90.2],[6528,92.2],[6781,92.6],[7031,90.7],[7282,90.5],[7534,90.3],[7784,90],[8036,90],[8287,90],[8536,91.1],[8789,93.4],[9040,91.1],[9290,90.6],[9540,100.3],[9792,117.1],[10043,130.7],[10292,121.6],[10543,122.8],[10796,107.7],[11048,104],[11298,101.5],[11549,130.7],[11801,112.6],[12052,98.7],[12302,85.2],[12551,39.8],[12805,55.4],[13056,23.3],[13308,9.5],[13558,3.6],[13808,1.4],[14059,0.6],[14309,0.2],[14557,0.1],[14810,41.4],[15062,18.3],[15313,7.4],[15564,2.8],[15815,1.1],[16067,0.4],[16315,0.2],[16565,0.1],[16818,42.6],[17069,21.4],[17322,8.2],[17573,3.2],[17824,1.1],[18075,0.5],[18328,0.2],[18573,0.1],[18827,37.7],[19079,23.1],[19328,9.1],[19577,3.4],[19829,1.3],[20079,0.5],[20330,0.2],[20577,0.1],[20832,30.5],[21083,27.4],[21333,10.6],[21584,4.3],[21835,1.7],[22085,0.7],[22336,0.2],[22584,0.3],[22840,27.3],[23091,25.1],[23342,6.2],[23592,2.4],[23844,1],[24097,0.4],[24347,0.2],[24593,0.1],[24846,39.8],[25099,17.6],[25349,7.2],[25599,2.6],[25848,1],[26100,0.4],[26353,0.1],[26600,0.1],[26854,39.3],[27104,17.5],[27356,6.9],[27608,2.6],[27858,1.1],[28109,0.4],[28358,0.2],[28608,0.1],[28859,41.7],[29110,23.7],[29361,9.2],[29614,3.6],[29863,1.3],[30113,0.5],[30367,1],[30616,0.4],[30865,37.6],[31120,22.8],[31369,8.9],[31619,3.3],[31872,1.3],[32122,0.5],[32373,0.2],[32623,0.1],[32871,28.2],[33124,27.6],[33374,10.5],[33626,4.3],[33878,1.7],[34129,0.7],[34378,0.3],[34629,0.1],[34879,28.6],[35132,25.6],[35383,9.8],[35634,4],[35885,1.5],[36136,0.6],[36386,0.2],[36638,0.1],[36887,18.3],[37140,30],[37391,11.4],[37642,4.8],[37892,1.9],[38143,0.7],[38392,0.3],[38643,0.1],[38892,8.9],[39145,32.7],[39396,12.2],[39647,5],[39898,2],[40149,0.8],[40399,0.3],[40651,0.1],[40898,2.6],[41152,33.9],[41402,14.6],[41654,6.1],[41905,2.2],[42156,1],[42407,0.4],[42658,0.2],[42907,0.1],[43158,59.4],[43409,24],[43659,18.9],[43910,7.2],[44161,2.5],[44413,0.8],[44664,0.2],[44912,0.1],[45166,34.4],[45416,15.5],[45667,6.3],[45917,2.6],[46170,1.1],[46419,0.4],[46671,0.2],[46918,0.1],[47170,30.1],[47423,14.2],[47674,5.9],[47924,2.3],[48175,1],[48426,0.4],[48677,0.2],[48925,0.1],[49180,39.7],[49431,17.8],[49683,7.2],[49931,2.8],[50183,1.3],[50432,0.5],[50684,0.2],[50932,0.1],[51184,38],[51435,17.3],[51687,7.1],[51940,2.8],[52190,1.1],[52441,0.4],[52692,0.2],[52938,0.1],[53192,39.1],[53444,22.3],[53697,8.9],[53946,3.6],[54197,1.4],[54448,0.5],[54699,0.2],[54947,0.1],[55200,33.1],[55451,22.4],[55701,8.8],[55954,3.5],[56204,1.4],[56455,0.6],[56706,0.2],[56953,0.1],[57207,30.1],[57459,20.7],[57708,8.2],[57959,3.3],[58208,1.3],[58462,0.5],[58713,0.2],[58962,0],[59213,19.5],[59466,40.6],[59716,15.7],[59966,6.1],[60217,2.1],[60469,0.7],[60720,0.3],[60969,0.3],[61218,14.1],[61472,28.6],[61723,10.7],[61974,4.5],[62224,1.9],[62472,0.7],[62724,0.3],[62973,0.1],[63225,21.1],[63478,22.6],[63730,8.9],[63981,3.8],[64231,1.5],[64482,0.6],[64734,0.2],[64984,0.1],[65233,4.6],[65485,29.7],[65737,11.7],[65989,4.9],[66240,2],[66492,1],[66742,0.4],[66992,0.1],[67241,0.1],[67495,30],[67744,13.6],[67995,5.5],[68246,2.4],[68498,1],[68750,0.4],[68999,0.2],[69247,0.1],[69501,32.7],[69749,15],[70001,6.1],[70252,2.5],[70502,0.9],[70753,0.4],[71006,0],[71254,21.6],[71506,25.6],[71758,10],[72010,4.2],[72262,1.7],[72513,0.7],[72763,0.3],[73013,0],[73262,16.1],[73516,26.8],[73763,10.5],[74017,4.3],[74266,1.7],[74516,0.8],[74768,0.3],[75019,0],[75268,8],[75521,28],[75773,10.5],[76024,4.4],[76274,1.7],[76524,0.7],[76776,0.2],[77026,0],[77275,1.4],[77529,27.6],[77781,12.6],[78031,5.2],[78282,2],[78532,0.8],[78783,0.3],[79034,0.1],[79281,0],[79535,29],[79785,13.2],[80035,5.3],[80286,2.2],[80535,1],[80786,0.4],[81040,0.1],[81287,0],[81541,33.6],[81790,15.3],[82042,6.4],[82293,2.5],[82543,1],[82794,0.4],[83045,0.1],[83293,0.1],[83549,34.5],[83798,15.8],[84049,6.5],[84300,2.5],[84551,1.1],[84801,0.4],[85052,0.2],[85300,0],[85550,40.8],[85801,17.4],[86057,7],[86307,2.7],[86558,1.1],[86808,0.3],[87057,0.1],[87306,0],[87559,39.4],[87809,17.8],[88059,7.4],[88310,2.8],[88559,1.2],[88811,0.5],[89062,0.1],[89310,0],[89563,39],[89816,17.5],[90067,7],[90317,2.9],[90568,1.2],[90818,0.5],[91070,0.2],[91320,0],[91571,31.9],[91824,40],[92076,15.1],[92325,6],[92577,1.9],[92827,0.7],[93079,0.2],[93327,0.1],[93578,26.9],[93832,25.5],[94083,10],[94332,4.2],[94583,1.6],[94835,0.7],[95085,0.2],[95337,0.1],[95584,19.6],[95838,25.5],[96089,10.1],[96340,4.3],[96592,1.7],[96842,0.7],[97093,0.3],[97344,0.1],[97591,12.8],[97844,29.5],[98096,11.1],[98346,4.5],[98598,1.7],[98849,0.7],[99100,0.4],[99350,0.1],[99599,8.2],[99853,28],[100104,10.5],[100355,4.5],[100606,1.7],[100857,0.7],[101105,0.3],[101357,0.1],[101606,0.1],[101859,31.5],[102110,14],[102360,5.4],[102611,2.2],[102860,0.9],[103113,0.4],[103362,0.2],[103612,0],[103864,30.5],[104116,13.7],[104366,5.5],[104617,2.3],[104867,0.9],[105117,0.4],[105369,0.2],[105616,0],[105869,35.4],[106120,16],[106370,6.5],[106622,2.6],[106871,1.1],[107125,0.4],[107374,0.1],[107622,0],[107875,30],[108125,14.2],[108377,5.8],[108627,2.3],[108879,1],[109127,0.4],[109379,45.2],[109628,18.2],[109880,44.3],[110133,19.4],[110383,7.5],[110634,2.8],[110885,1.2],[111135,0.5],[111385,0.2],[111635,0.1],[111889,36.9],[112141,16.8],[112391,6.8],[112641,2.6],[112892,1.1],[113143,0.5],[113392,0.2],[113640,0.1],[113896,40.1],[114145,20.7],[114397,8.4],[114647,3.2],[114899,1.2],[115148,0.5],[115400,0.2],[115646,0.1],[115899,32.1],[116151,15],[116401,6],[116651,2.4],[116903,1],[117153,0.4],[117404,0.2],[117652,0.1],[117908,28],[118158,24.5],[118408,9.7],[118656,4],[118908,1.6],[119159,0.7],[119409,0.2],[119657,0.1],[119913,23.1],[120163,24.1],[120412,9.5],[120663,3.9],[120913,1.5],[121165,0.6],[121416,0.2],[121664,0.1],[121916,11.2],[122168,27.6],[122418,10.3],[122670,4.3],[122920,1.7],[123171,0.5],[123422,0.2],[123670,0],[123922,36.4],[124175,16.6],[124424,6.7],[124675,2.6],[124922,1.5],[125175,0.4],[125427,0.1],[125677,0.1],[125927,39.2],[126180,21.4],[126431,8.5],[126683,3.3],[126934,1.3],[127181,0.5],[127434,0.2],[127685,0],[127934,37.3],[128189,20.5],[128436,8.1],[128688,3.1],[128938,1.2],[129189,0.5],[129440,0.1],[129692,0],[129969,33.8],[130202,25.3],[130453,10],[130706,4],[130958,1.6],[131209,0.6],[131459,0.1],[131710,0.1],[131958,21.9],[132213,24.6],[132462,9.6],[132714,4],[132965,1.5],[133218,0.7],[133467,0.2],[133718,0.1],[133967,19.1],[134219,27.3],[134471,10.6],[134722,4.4],[134973,1.7],[135223,0.7],[135474,0.2],[135725,0],[135972,11.9],[136225,27],[136476,10.1],[136728,4.4],[136978,1.7],[137229,0.7],[137479,0.3],[137731,0.1],[137979,5.5],[138231,31.2],[138483,11.7],[138734,4.7],[138985,1.9],[139238,0.8],[139487,0.3],[139739,0.1],[139987,0.1],[140241,56],[140492,22.8],[140741,9],[140993,3.4],[141245,1.3],[141493,0.4],[141745,0.2],[141994,0.1],[142247,31.9],[142499,14.2],[142749,5.8],[143000,2.3],[143252,1],[143502,0.4],[143753,0.2],[144001,0.1],[144254,31.9],[144506,15],[144756,6.2],[145007,2.6],[145257,1.1],[145508,0.4],[145757,0.2],[146006,0],[146256,34.6],[146509,15.8],[146758,6.5],[147009,2.5],[147260,1.1],[147513,0.4],[147763,0.2],[148010,0.1],[148266,35.1],[148517,16],[148766,6.5],[149018,2.6],[149268,1.1],[149520,0.4],[149769,0.2],[150017,0.1],[150273,40.3],[150523,18],[150775,7.3],[151024,2.8],[151275,1.2],[151526,0.4],[151778,0.2],[152025,0],[152278,41],[152530,21],[152782,8.4],[153033,3.3],[153284,1.3],[153534,0.5],[153785,0.2],[154034,0.1],[154288,33.6],[154539,24.1],[154790,9.7],[155041,3.8],[155291,1.5],[155542,0.6],[155793,0.1],[156041,0.1],[156295,28.6],[156547,23.2],[156799,9.1],[157048,3.9],[157299,53.8],[157549,22.3],[157801,8.2],[158048,2.9],[158302,27],[158552,25],[158803,9.8],[159055,4.2],[159307,1.6],[159556,0.7],[159808,0.2],[160056,0.1],[160308,19.1],[160559,26.2],[160810,10.3],[161061,4.2],[161311,1.7],[161562,0.7],[161814,0.3],[162063,0.1],[162314,13.4],[162565,27.9],[162817,10.6],[163067,4.4],[163320,1.7],[163571,0.7],[163820,0.3],[164071,0.1],[164322,8.3],[164575,27.9],[164825,10.6],[165074,4.4],[165325,1.7],[165577,0.7],[165826,0.3],[166078,0.1],[166326,0.1],[166580,21.9],[166831,8.8],[167081,3.5],[167333,1.3],[167584,0.5],[167837,0.1],[168085,0.1],[168333,30.6],[168588,22],[168840,8.7],[169090,3.6],[169342,1.4],[169593,0.6],[169843,0.2],[170093,0],[170342,26],[170595,25.2],[170847,9.8],[171098,4.2],[171349,1.6],[171600,0.7],[171850,0.2],[172101,0],[172349,19.5],[172603,25],[172855,9.8],[173106,4],[173357,1.7],[173608,0.7],[173859,0.2],[174109,0.1],[174358,14.2],[174610,28.1],[174863,10.5],[175113,4.5],[175363,1.8],[175613,0.7],[175862,0.2],[176115,0],[176363,8.1],[176617,27.6],[176867,10.3],[177119,4.3],[177368,1.7],[177618,0.6],[177869,0.3],[178118,0.1],[178368,0.1],[178621,29.7],[178871,13.2],[179123,5.7],[179374,2.2],[179625,0.9],[179876,0.4]]
```

热点（所有线程，命中次数非 ms）：
```text
Sort by top of stack, same collapsed (when >= 5):
        __psynch_cvwait  (in libsystem_kernel.dylib)        59247
        __workq_kernreturn  (in libsystem_kernel.dylib)        17002
        JSC::JSObject::countElements()  (in JavaScriptCore)        7228
        operationArrayIndexOfNonStringIdentityValueContiguous  (in JavaScriptCore)        96
        mach_msg2_trap  (in libsystem_kernel.dylib)        65
        JSC::JSObject::visitChildren(JSC::JSCell*, JSC::SlotVisitor&)  (in JavaScriptCore)        61
        JSC::JSFinalObject::visitChildren(JSC::JSCell*, JSC::SlotVisitor&)  (in JavaScriptCore)        57
        JSC::BlockDirectory::tryAllocateBlock(JSC::Heap&)  (in JavaScriptCore)        33
        JSC::JSObject::putOwnDataPropertyBatching(JSC::VM&, WTF::UniquedStringImpl**, long long const*, unsigned int)  (in JavaScriptCore)        31
        __bzero  (in libsystem_platform.dylib)        26
        JSC::globalFuncCloneObject(JSC::JSGlobalObject*, JSC::CallFrame*)  (in JavaScriptCore)        25
        JSC::MarkedBlock::Handle::sweep(JSC::FreeList*)  (in JavaScriptCore)        24
        JSC::SlotVisitor::drain(WTF::MonotonicTime)  (in JavaScriptCore)        21
        JSC::JSArray::appendMemcpy(JSC::JSGlobalObject*, JSC::VM&, unsigned int, JSC::JSArray*)  (in JavaScriptCore)        13
        JSC::JSObject::putDirectInternal<(JSC::JSObject::PutMode)1>(JSC::VM&, JSC::PropertyName, JSC::JSValue, unsigned int, JSC::PutPropertySlot&)  (in JavaScriptCore)        12
        _platform_memmove  (in libsystem_platform.dylib)        12
        pas_thread_local_cache_flush_deallocation_log  (in JavaScriptCore)        11
        JSC::B3::eliminateDeadCodeImpl(JSC::B3::Procedure&)  (in JavaScriptCore)        10
        JSC::DFG::performGraphPackingAndLivenessAnalysis(JSC::DFG::Graph&)  (in JavaScriptCore)        10
        JSC::JSObject::getOwnPropertySlotByIndex(JSC::JSObject*, JSC::JSGlobalObject*, unsigned int, JSC::PropertySlot&)  (in JavaScriptCore)        10
        JSC::B3::Air::Greedy::GreedyAllocator::allocateRegisters<(JSC::B3::Bank)0>()  (in JavaScriptCore)        9
        JSC::DFG::CPSRethreadingPhase::run()  (in JavaScriptCore)        9
        _platform_memset  (in libsystem_platform.dylib)        9
        JSC::objectConstructorValues(JSC::JSGlobalObject*, JSC::CallFrame*)  (in JavaScriptCore)        8
        WTF::fastMalloc(unsigned long)  (in JavaScriptCore)        8
        bmalloc_heap_config_specialized_local_allocator_try_allocate_small_segregated_slow  (in JavaScriptCore)        8
        JSC::B3::Air::Greedy::GreedyAllocator::run()  (in JavaScriptCore)        7
        JSC::DFG::AbstractInterpreter<JSC::DFG::InPlaceAbstractState>::verifyEdges(JSC::DFG::Node*)  (in JavaScriptCore)        7
        JSC::objectAssignFast(JSC::JSGlobalObject*, JSC::JSFinalObject*, JSC::JSObject*, WTF::Vector<WTF::UniquedStringImpl*, 8ul, WTF::CrashOnOverflow, 16ul, WTF::FastMalloc>&, JSC::MarkedVector<JSC::JSValue, 8ul, WTF::RecordOverflow>&)::'lambda'(JSC::PropertyTableEntry const&)::operator()(JSC::PropertyTableEntry const&) const  (in JavaScriptCore)        7
        JSC::toPropertyDescriptor(JSC::JSGlobalObject*, JSC::JSValue, JSC::PropertyDescriptor&, bool&)  (in JavaScriptCore)        7
        WTF::tryFastMalloc(unsigned long)  (in JavaScriptCore)        7
        JSC::JSArray::tryCreate(JSC::VM&, JSC::Structure*, unsigned int)  (in JavaScriptCore)        6
        JSC::JSObject::initializeIndex(JSC::ObjectInitializationScope&, unsigned int, JSC::JSValue)  (in JavaScriptCore)        6
        JSC::B3::reduceStrength(JSC::B3::Procedure&)  (in JavaScriptCore)        5
        JSC::BlockDirectory::removeBlock(JSC::MarkedBlock::Handle*, JSC::BlockDirectory::WillDeleteBlock)  (in JavaScriptCore)        5
        JSC::DFG::runPhase<JSC::DFG::(anonymous namespace)::PutStackSinkingPhase>(JSC::DFG::Graph&)  (in JavaScriptCore)        5
        JSC::FTL::(anonymous namespace)::LowerDFGToB3::buildExitArguments(JSC::FTL::OSRExitDescriptor*, JSC::CodeOrigin, JSC::FTL::FormattedValue, unsigned int)  (in JavaScriptCore)        5
        JSC::JSFunction::getOwnPropertySlot(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::PropertySlot&)  (in JavaScriptCore)        5
        JSC::JSFunction::reifyLazyPropertyIfNeeded<(JSC::JSFunction::SetHasModifiedLengthOrName)0>(JSC::VM&, JSC::JSGlobalObject*, JSC::PropertyName)  (in JavaScriptCore)        5
        JSC::globalFuncCopyDataProperties(JSC::JSGlobalObject*, JSC::CallFrame*)  (in JavaScriptCore)        5
```

### D6.1-b P2-same-window-retry normal-prose-to-large-table trial 3

**D6.1-b 执行停止，未测项 NOT VERIFIED：** Open button not enabled: false


第三次同窗口补测的准备阶段发现 Open enabled=false，尚未开始动作计时，故不是一次性能样本。AX 列表确认 .perf-corpus 中存在 large-table.wysiwyg.md；改为按准确文件名显式选中该行后校验 Open。前一有效 trial 2 已保存：观察 180032 ms，仍有持续探针响应；观察上限不是阻塞或永久挂起。

前置清理后的 mdpro 进程：[]。

### D6.1-b P2-same-window-retry normal-prose-to-large-table trial 3

动作开始：2026-09-20T11:25:47.338Z；日志 offset 2783363；应用/WebContent 40419/40469。

```json
{"path":"P2-same-window-retry","fixture":"normal-prose-to-large-table","trial":3,"binary":"release","setupInfo":{"setupOffset":2774603,"documentId":"750492cd37f749a9","readyTs":"2026-09-20T19:25:40.166+08:00","modeMenuTs":"2026-09-20T19:25:40.673+08:00","lastMode":{"ts":"2026-09-20T18:25:58.213+08:00","level":"info","event":"view.mode.change","status":"success","actionId":"288935c4-1f7e-4035-975a-f32190d912b4","context":{"fromMode":"source","source":"setViewMode","toMode":"wysiwyg"},"durationMs":null,"error":null},"lastModePredatesLaunch":true,"appLine":"40419 /Users/jackcheng/Documents/01_Coding/mac-app/mdpro/src-tauri/target/release/bundle/macos/mdpro.app/Contents/MacOS/tauri-app","apid":"40419","wpid":"40469"},"offset":2783363,"end":2809012,"t0":1789903547338,"ended":1789903727363,"windowMs":180025,"cpuSpanMs":10790,"above80Points":44,"peakCpu":140,"probeLatencyMs":10504,"firstProbeSentAt":"2026-09-20T11:25:47.586Z","probesSent":89,"probesHandled":89,"confirmedAction":true,"recovered":true,"dead":false,"actionError":null,"quiet10s":false,"lowerBoundMarker":"2026-09-20T19:25:58.091+08:00","probes":[{"sentAt":1789903547586,"iso":"2026-09-20T11:25:47.586Z","returnedAt":1789903547692},{"sentAt":1789903549605,"iso":"2026-09-20T11:25:49.605Z","returnedAt":1789903549704},{"sentAt":1789903551621,"iso":"2026-09-20T11:25:51.621Z","returnedAt":1789903551726},{"sentAt":1789903553642,"iso":"2026-09-20T11:25:53.642Z","returnedAt":1789903553743},{"sentAt":1789903555664,"iso":"2026-09-20T11:25:55.664Z","returnedAt":1789903555768},{"sentAt":1789903557683,"iso":"2026-09-20T11:25:57.683Z","returnedAt":1789903557786},{"sentAt":1789903559704,"iso":"2026-09-20T11:25:59.704Z","returnedAt":1789903559837},{"sentAt":1789903561726,"iso":"2026-09-20T11:26:01.726Z","returnedAt":1789903561853},{"sentAt":1789903563746,"iso":"2026-09-20T11:26:03.746Z","returnedAt":1789903563869},{"sentAt":1789903565769,"iso":"2026-09-20T11:26:05.769Z","returnedAt":1789903565895},{"sentAt":1789903567791,"iso":"2026-09-20T11:26:07.791Z","returnedAt":1789903567919},{"sentAt":1789903569816,"iso":"2026-09-20T11:26:09.816Z","returnedAt":1789903569944},{"sentAt":1789903571837,"iso":"2026-09-20T11:26:11.837Z","returnedAt":1789903571961},{"sentAt":1789903573858,"iso":"2026-09-20T11:26:13.858Z","returnedAt":1789903573987},{"sentAt":1789903575881,"iso":"2026-09-20T11:26:15.881Z","returnedAt":1789903576004},{"sentAt":1789903577910,"iso":"2026-09-20T11:26:17.910Z","returnedAt":1789903578034},{"sentAt":1789903579936,"iso":"2026-09-20T11:26:19.936Z","returnedAt":1789903580060},{"sentAt":1789903581959,"iso":"2026-09-20T11:26:21.959Z","returnedAt":1789903582080},{"sentAt":1789903583985,"iso":"2026-09-20T11:26:23.985Z","returnedAt":1789903584111},{"sentAt":1789903586005,"iso":"2026-09-20T11:26:26.005Z","returnedAt":1789903586135},{"sentAt":1789903588027,"iso":"2026-09-20T11:26:28.027Z","returnedAt":1789903588134},{"sentAt":1789903590051,"iso":"2026-09-20T11:26:30.051Z","returnedAt":1789903590178},{"sentAt":1789903592072,"iso":"2026-09-20T11:26:32.072Z","returnedAt":1789903592201},{"sentAt":1789903594093,"iso":"2026-09-20T11:26:34.093Z","returnedAt":1789903594218},{"sentAt":1789903596120,"iso":"2026-09-20T11:26:36.120Z","returnedAt":1789903596244},{"sentAt":1789903598144,"iso":"2026-09-20T11:26:38.144Z","returnedAt":1789903598271},{"sentAt":1789903600166,"iso":"2026-09-20T11:26:40.166Z","returnedAt":1789903600294},{"sentAt":1789903602190,"iso":"2026-09-20T11:26:42.190Z","returnedAt":1789903602320},{"sentAt":1789903604212,"iso":"2026-09-20T11:26:44.212Z","returnedAt":1789903604343},{"sentAt":1789903606237,"iso":"2026-09-20T11:26:46.237Z","returnedAt":1789903606361},{"sentAt":1789903608262,"iso":"2026-09-20T11:26:48.262Z","returnedAt":1789903608386},{"sentAt":1789903610286,"iso":"2026-09-20T11:26:50.286Z","returnedAt":1789903610411},{"sentAt":1789903612311,"iso":"2026-09-20T11:26:52.311Z","returnedAt":1789903612436},{"sentAt":1789903614332,"iso":"2026-09-20T11:26:54.332Z","returnedAt":1789903614452},{"sentAt":1789903616351,"iso":"2026-09-20T11:26:56.351Z","returnedAt":1789903616477},{"sentAt":1789903618372,"iso":"2026-09-20T11:26:58.372Z","returnedAt":1789903618502},{"sentAt":1789903620392,"iso":"2026-09-20T11:27:00.392Z","returnedAt":1789903620525},{"sentAt":1789903622416,"iso":"2026-09-20T11:27:02.416Z","returnedAt":1789903622543},{"sentAt":1789903624440,"iso":"2026-09-20T11:27:04.440Z","returnedAt":1789903624568},{"sentAt":1789903626464,"iso":"2026-09-20T11:27:06.464Z","returnedAt":1789903626595},{"sentAt":1789903628488,"iso":"2026-09-20T11:27:08.488Z","returnedAt":1789903628596},{"sentAt":1789903630508,"iso":"2026-09-20T11:27:10.508Z","returnedAt":1789903630636},{"sentAt":1789903632530,"iso":"2026-09-20T11:27:12.530Z","returnedAt":1789903632658},{"sentAt":1789903634554,"iso":"2026-09-20T11:27:14.554Z","returnedAt":1789903634685},{"sentAt":1789903636574,"iso":"2026-09-20T11:27:16.574Z","returnedAt":1789903636702},{"sentAt":1789903638597,"iso":"2026-09-20T11:27:18.597Z","returnedAt":1789903638729},{"sentAt":1789903640621,"iso":"2026-09-20T11:27:20.621Z","returnedAt":1789903640752},{"sentAt":1789903642643,"iso":"2026-09-20T11:27:22.643Z","returnedAt":1789903642768},{"sentAt":1789903644666,"iso":"2026-09-20T11:27:24.666Z","returnedAt":1789903644794},{"sentAt":1789903646689,"iso":"2026-09-20T11:27:26.689Z","returnedAt":1789903646786},{"sentAt":1789903648711,"iso":"2026-09-20T11:27:28.711Z","returnedAt":1789903648844},{"sentAt":1789903650735,"iso":"2026-09-20T11:27:30.735Z","returnedAt":1789903650861},{"sentAt":1789903652757,"iso":"2026-09-20T11:27:32.757Z","returnedAt":1789903652886},{"sentAt":1789903654774,"iso":"2026-09-20T11:27:34.774Z","returnedAt":1789903654902},{"sentAt":1789903656794,"iso":"2026-09-20T11:27:36.794Z","returnedAt":1789903656928},{"sentAt":1789903658816,"iso":"2026-09-20T11:27:38.816Z","returnedAt":1789903658944},{"sentAt":1789903660842,"iso":"2026-09-20T11:27:40.842Z","returnedAt":1789903660969},{"sentAt":1789903662862,"iso":"2026-09-20T11:27:42.862Z","returnedAt":1789903662993},{"sentAt":1789903664885,"iso":"2026-09-20T11:27:44.885Z","returnedAt":1789903665010},{"sentAt":1789903666907,"iso":"2026-09-20T11:27:46.907Z","returnedAt":1789903667035},{"sentAt":1789903668930,"iso":"2026-09-20T11:27:48.930Z","returnedAt":1789903669027},{"sentAt":1789903670947,"iso":"2026-09-20T11:27:50.947Z","returnedAt":1789903671076},{"sentAt":1789903672973,"iso":"2026-09-20T11:27:52.973Z","returnedAt":1789903673103},{"sentAt":1789903675001,"iso":"2026-09-20T11:27:55.001Z","returnedAt":1789903675128},{"sentAt":1789903677021,"iso":"2026-09-20T11:27:57.021Z","returnedAt":1789903677143},{"sentAt":1789903679041,"iso":"2026-09-20T11:27:59.041Z","returnedAt":1789903679175},{"sentAt":1789903681068,"iso":"2026-09-20T11:28:01.068Z","returnedAt":1789903681194},{"sentAt":1789903683087,"iso":"2026-09-20T11:28:03.087Z","returnedAt":1789903683210},{"sentAt":1789903685109,"iso":"2026-09-20T11:28:05.109Z","returnedAt":1789903685235},{"sentAt":1789903687130,"iso":"2026-09-20T11:28:07.130Z","returnedAt":1789903687253},{"sentAt":1789903689151,"iso":"2026-09-20T11:28:09.151Z","returnedAt":1789903689260},{"sentAt":1789903691172,"iso":"2026-09-20T11:28:11.172Z","returnedAt":1789903691301},{"sentAt":1789903693193,"iso":"2026-09-20T11:28:13.193Z","returnedAt":1789903693326},{"sentAt":1789903695216,"iso":"2026-09-20T11:28:15.216Z","returnedAt":1789903695343},{"sentAt":1789903697238,"iso":"2026-09-20T11:28:17.238Z","returnedAt":1789903697369},{"sentAt":1789903699257,"iso":"2026-09-20T11:28:19.257Z","returnedAt":1789903699388},{"sentAt":1789903701278,"iso":"2026-09-20T11:28:21.278Z","returnedAt":1789903701401},{"sentAt":1789903703302,"iso":"2026-09-20T11:28:23.302Z","returnedAt":1789903703426},{"sentAt":1789903705321,"iso":"2026-09-20T11:28:25.321Z","returnedAt":1789903705443},{"sentAt":1789903707341,"iso":"2026-09-20T11:28:27.341Z","returnedAt":1789903707468},{"sentAt":1789903709367,"iso":"2026-09-20T11:28:29.367Z","returnedAt":1789903709493},{"sentAt":1789903711388,"iso":"2026-09-20T11:28:31.388Z","returnedAt":1789903711511},{"sentAt":1789903713411,"iso":"2026-09-20T11:28:33.411Z","returnedAt":1789903713537},{"sentAt":1789903715437,"iso":"2026-09-20T11:28:35.437Z","returnedAt":1789903715560},{"sentAt":1789903717457,"iso":"2026-09-20T11:28:37.457Z","returnedAt":1789903717586},{"sentAt":1789903719476,"iso":"2026-09-20T11:28:39.476Z","returnedAt":1789903719611},{"sentAt":1789903721499,"iso":"2026-09-20T11:28:41.499Z","returnedAt":1789903721628},{"sentAt":1789903723521,"iso":"2026-09-20T11:28:43.521Z","returnedAt":1789903723643},{"sentAt":1789903725543,"iso":"2026-09-20T11:28:45.543Z","returnedAt":1789903725674}],"events":[{"ts":"2026-09-20T19:25:47.505+08:00","level":"info","event":"tab.open","status":"success","actionId":"3c0aee60-e0cc-44ed-ab84-8aa0b4faeec9","context":{"documentId":"9bcf40cdc1692ed5","filePath":"/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.perf-corpus/large-table.wysiwyg.md","tabIndex":1},"durationMs":null,"error":null},{"ts":"2026-09-20T19:25:47.505+08:00","level":"info","event":"tab.switch","status":"success","actionId":"8ada35f1-b2c7-44b5-87c5-1a671a3f9eaf","context":{"fromDocumentId":"750492cd37f749a9","toDocumentId":"9bcf40cdc1692ed5"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:25:47.511+08:00","level":"info","event":"editor.milkdown.mount","status":"success","actionId":"1d07813e-485a-42cd-b2c9-9cdb412095a1","context":{"contentLength":415976,"documentId":"9bcf40cdc1692ed5","hasContent":true},"durationMs":null,"error":null},{"ts":"2026-09-20T19:25:47.511+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"ef14ba24-9cf0-45cc-9303-18ea21954300","context":{"editorLoading":true,"hasInstance":false},"durationMs":null,"error":null},{"ts":"2026-09-20T19:25:58.090+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"a90c3b77-73f7-400c-bcc3-149fd19c2f8a","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:25:58.091+08:00","level":"info","event":"editor.milkdown.direct.state","status":"success","actionId":"d05bea9e-c287-464d-9234-4e547b771d75","context":{"editorLoading":false,"hasInstance":true},"durationMs":null,"error":null},{"ts":"2026-09-20T19:25:58.296+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"b69a8db2-c2b0-473c-8087-c2bb117dcfa7","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:25:58.343+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"8a026caa-a631-4697-82e2-5859b88dcfa5","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:25:58.369+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"f6e1f1d3-b6d6-48a3-88c3-66f72b276e3f","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:25:58.393+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"6fc7a5ba-3bf1-4dec-bd95-57d65cb00fb7","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:25:58.488+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"21c1a542-3a0d-48c7-8ac5-2b3c3c52cbd7","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:25:59.843+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"fbc793c6-b269-4604-9a74-b5e12bac3f1e","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:26:01.860+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"049e43a4-808e-462b-bc4e-2dcd2d81c1e0","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:26:03.876+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"6a09fbc4-402e-4785-a18e-f57cf958b58c","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:26:05.901+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"693841c8-a026-41d2-9cf9-821070596563","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:26:07.926+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"c88a8e12-115a-4270-8bf6-13f81ff37a41","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:26:09.953+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"b4c19b96-9073-4317-9ccf-606b812842ac","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:26:11.969+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"b0309acb-8cb5-494c-a9e4-b0448f01c612","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:26:13.993+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"ba0007fc-a8a4-4b55-9b95-874c4d321365","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:26:16.009+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"4c036231-4350-404b-83ed-bba23ff3cac4","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:26:18.035+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"46dedbc4-9983-4b34-a38b-0d796a7132af","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:26:20.068+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"ee924112-462b-45b1-8dc6-98ba09853ca2","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:26:22.085+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"ce132d97-7962-48c8-844e-ac01f1decd82","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:26:24.118+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"0b2b4f0d-0c24-448a-bb1c-ef03376d489d","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:26:26.143+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"081ad865-52d0-4302-863d-9f30c209828f","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:26:28.135+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"d07c1042-f56d-418a-845b-8bd4b4b41e08","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:26:30.184+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"e05c6972-cc9d-4afd-90a3-dee3c6563f28","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:26:32.209+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"78f4c428-2bf3-4db3-8a56-36a7c18a8935","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:26:34.226+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"12b38b57-bec9-420b-9258-5c189c8af558","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:26:36.251+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"c96ab4ef-e718-4ed3-ae7b-9f2de96df5ed","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:26:38.276+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"82f8e4d9-b48b-4a36-81b8-29963950d320","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:26:40.301+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"03539001-8c65-4aeb-970c-38b5d7d26b39","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:26:42.326+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"def1a581-01d9-42ce-9acb-b71c70ee9df6","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:26:44.351+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"fd518462-3302-4c67-8d56-11c68564c666","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:26:46.368+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"fe397347-0dd8-415e-be4d-9c211885118e","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:26:48.393+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"a075d1fd-0b45-4fd3-8cbe-381749c5d416","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:26:50.417+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"aed05091-7288-443f-9211-e9b3f95ecffa","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:26:52.443+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"921493c1-da36-49db-960d-4db293a7dcdd","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:26:54.459+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"a0d3781f-e9f6-4c33-8ee1-9d90e0ea835e","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:26:56.484+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"3bf1c37c-5b97-4f14-9b19-59eaf5109a82","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:26:58.509+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"60c614ed-9e11-4607-a235-49574fce71bd","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:27:00.526+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"3562d542-c800-4164-b009-d36eeb3c2833","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:27:02.551+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"fb5b3cda-1a1e-4c71-8df8-89979e0e7c9e","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:27:04.576+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"c59d7415-606c-4aa2-a927-c0564de4842e","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:27:06.601+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"60ddd1ea-cb1d-4d63-aa1c-d9b314c54ea5","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:27:08.601+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"8e34ff5a-74dd-48c9-af30-8a245ab9d320","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:27:10.642+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"aa9d6e7c-5b08-4ebe-8ab8-c0e89a70230a","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:27:12.659+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"f61b86f0-c7b9-498a-a734-21a1cb96e947","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:27:14.692+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"1779cc06-019f-4268-92d9-ace213f1fa80","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:27:16.709+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"7731bb2a-3b85-42a8-a72b-baab2df729c2","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:27:18.734+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"8dd85520-5213-44be-ba61-9720738918d4","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:27:20.759+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"c143f59c-fb24-4f85-950a-8acffab90199","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:27:22.776+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"ade549d2-a898-4695-8483-87990280ace9","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:27:24.801+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"29614ed2-5a8c-442f-8e7d-a7b6c83723e6","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:27:26.792+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"a9b99a78-9ddb-47a3-b3cb-9b1eff3684cc","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:27:28.851+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"ec5faa3a-1a62-4649-b288-c5c12cde2c27","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:27:30.867+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"d891979b-b678-4a2f-89e1-15fcbd77e3ad","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:27:32.892+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"56ea4fe7-aaf2-4b01-845d-9426071d9b6f","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:27:34.909+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"15bcf33d-0101-402c-98e1-e6ec1018ac07","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:27:36.934+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"a6575f66-9730-4fad-8832-39faa9ae7669","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:27:38.951+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"5215a406-5755-476b-a229-283cf647f6e1","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:27:40.976+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"566a10a2-7f57-4196-bacb-947bd067263f","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:27:43.000+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"3ba7626a-9f4f-4462-8253-cd8142c3cbc3","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:27:45.017+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"56c57a6c-a044-48f5-b0ab-4f78d2542a82","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:27:47.042+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"a72c708d-e7bc-40f4-b6ea-abae7daad1ba","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:27:49.034+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"975a3100-ea1a-41d0-a38b-7bf3630a514b","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:27:51.084+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"37724026-4c40-414b-8482-543771c26e14","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:27:53.109+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"e2231fd4-8643-4344-a468-d611b33353cc","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:27:55.134+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"15c0ae89-6aae-46fa-a2a5-541238514f66","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:27:57.150+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"737dd32a-ca9e-4fa7-bcc3-2d5bd17d2316","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:27:59.175+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"28365b67-714d-4731-8e5e-44f6ae897601","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:28:01.200+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"1bc59b5d-15ba-4b91-8363-18827631bd25","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:28:03.217+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"b239faeb-44ed-476f-be8c-d7cc5aaabc79","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:28:05.242+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"bfc0d3cd-b7c0-4a78-bfd6-4d1e169c7d15","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:28:07.259+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"fd3d3eaf-b010-440b-8c73-181c3e850d52","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:28:09.267+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"917a20ae-6aa2-48db-9d54-0d1d29487ee9","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:28:11.309+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"e5f3f0c2-1642-4f1f-a6f8-2021978fd3fc","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:28:13.334+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"f86c14af-2bd0-4932-800d-cb2751ecf563","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:28:15.350+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"8e979266-d4a9-4d4c-8647-04824abc2f0f","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:28:17.375+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"bd86246d-ccfb-46cb-bfee-abc188645929","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:28:19.400+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"2f4b534d-a242-4871-8745-876c0c8fb02f","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:28:21.408+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"2bf93380-2a35-4e2f-ad10-5e31b68318c0","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:28:23.426+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"40ef0403-429a-408b-86f7-86f9fe42e42d","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:28:25.450+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"6b786fb0-9fd8-49e1-bcb2-5e45d9e6176c","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:28:27.475+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"d50aac10-8959-4d54-b725-033d76376777","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:28:29.500+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"062e5583-45a7-48f9-8dd9-6440b3cbd7db","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:28:31.517+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"6f010f81-7aa8-44be-9b42-04c0fd102040","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:28:33.542+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"414ed8d4-634c-4984-bd74-f0112dbf7015","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:28:35.567+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"620e31e3-5491-494e-831f-2d033a069c09","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:28:37.592+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"c57b00d8-2c58-4b16-9c26-5224b42ea5ee","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:28:39.617+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"5ec694a5-dcdb-47e2-8a7d-239139ff04b2","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:28:41.633+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"61c7815e-0821-4c9e-ad13-dc3c3f467b91","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:28:43.650+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"f2c8188a-0ca9-4d63-af5a-bcf8ae512a5d","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null},{"ts":"2026-09-20T19:28:45.675+08:00","level":"info","event":"ui.shortcut.trigger","status":"success","actionId":"56843e58-3264-4781-803a-307d840bb381","context":{"action":"view.toggle_sidebar","shortcut":"Cmd+Shift+L"},"durationMs":null,"error":null}]}
```

CPU [相对 ms, %cpu]：
```json
[[4,0],[258,24.5],[507,88],[759,90.2],[1011,89.9],[1259,91.1],[1511,92.1],[1761,90.8],[2011,90.4],[2263,90.3],[2514,93],[2766,91.9],[3017,90.5],[3268,90.1],[3518,89.8],[3769,90.3],[4020,90],[4271,90.1],[4522,92.7],[4774,91.9],[5025,90.7],[5275,90.1],[5526,90.2],[5777,90.3],[6027,90.1],[6279,90.4],[6528,92.8],[6782,92.4],[7032,91.2],[7284,90.5],[7534,89.7],[7785,89.4],[8037,89.3],[8287,89.2],[8536,91.9],[8788,92.3],[9040,90.5],[9289,90.7],[9540,129.4],[9791,113],[10042,129.6],[10291,140],[10542,117],[10794,107.2],[11046,112.3],[11297,132.2],[11549,63.6],[11799,30.5],[12050,12.6],[12300,4.7],[12548,2.1],[12802,31.4],[13054,12.4],[13302,5.2],[13553,33],[13806,14.9],[14058,5.4],[14308,7.9],[14555,3],[14808,30],[15059,11.8],[15312,4.9],[15561,2.1],[15812,0.9],[16064,0.4],[16312,0.2],[16561,0.1],[16816,32.5],[17066,12.6],[17316,5.3],[17567,2],[17819,0.9],[18069,0.4],[18320,0.2],[18569,0.1],[18820,32],[19075,12.5],[19325,5.2],[19576,2],[19826,0.9],[20077,0.4],[20328,0.1],[20577,0.2],[20830,39.1],[21081,15.4],[21333,6.3],[21584,2.4],[21834,1.2],[22084,0.4],[22335,0.2],[22582,0.1],[22838,35.6],[23086,14.8],[23336,6.1],[23588,2.4],[23840,1],[24091,0.5],[24343,0.2],[24591,0],[24844,29.1],[25095,18.3],[25348,7.4],[25597,3.1],[25849,1.1],[26100,0.5],[26351,0.1],[26598,0.1],[26851,22.2],[27103,11.4],[27355,4.7],[27606,1.9],[27857,0.7],[28108,0.3],[28358,0.2],[28607,0.1],[28859,31.2],[29110,12.1],[29360,4.9],[29612,2.1],[29864,0.8],[30115,0.4],[30364,0.7],[30614,0.3],[30867,33],[31117,12.8],[31370,5.2],[31619,2.1],[31872,0.9],[32121,0.4],[32373,0.1],[32622,0.1],[32872,39.7],[33124,15.6],[33375,6.3],[33627,2.5],[33880,1],[34128,0.4],[34379,0.2],[34628,0.1],[34879,33.9],[35132,14.6],[35383,5.9],[35634,2.5],[35885,1],[36134,0.4],[36385,0.2],[36636,0.1],[36883,25.4],[37137,19.4],[37387,7.7],[37637,3.2],[37889,1.2],[38142,0.5],[38392,0.2],[38643,0.1],[38892,17.8],[39145,19.6],[39395,7.7],[39647,3],[39899,1.2],[40150,0.5],[40400,0.2],[40651,0.1],[40900,21.1],[41152,19.6],[41403,7.7],[41654,3.4],[41905,1.3],[42157,0.5],[42406,0.2],[42657,0],[42906,6.6],[43159,21.7],[43411,8.5],[43660,3.7],[43912,1.4],[44161,0.6],[44412,0.2],[44663,0.1],[44913,0],[45166,26.9],[45416,10.5],[45666,4.3],[45918,1.7],[46169,0.7],[46418,0.3],[46670,0.1],[46918,0.1],[47171,23.7],[47424,9.2],[47673,3.8],[47925,1.6],[48176,0.7],[48426,0.3],[48677,0.1],[48926,0.1],[49179,30.9],[49431,12.1],[49681,5.1],[49933,2],[50183,0.8],[50434,0.4],[50685,0.1],[50933,0.1],[51187,29.2],[51438,11.5],[51689,4.7],[51940,1.9],[52191,0.8],[52442,0.4],[52692,0.2],[52942,0.1],[53193,34.3],[53444,13.5],[53694,5.4],[53947,2.2],[54197,0.9],[54448,0.4],[54698,0.2],[54946,0.1],[55200,35.1],[55451,13.8],[55702,5.7],[55955,2.2],[56205,1],[56457,0.3],[56708,0.2],[56955,0.1],[57209,36.2],[57459,17],[57710,6.8],[57960,2.8],[58210,1],[58461,0.5],[58712,0.2],[58960,0.1],[59214,32.1],[59466,15.6],[59715,6.4],[59965,2.5],[60217,1],[60467,0.5],[60717,0.2],[60967,0.1],[61219,24.3],[61471,19.2],[61722,7.5],[61973,3.2],[62224,1.2],[62475,0.5],[62725,0.2],[62976,0.1],[63227,16.7],[63478,19.2],[63730,7.5],[63981,3.3],[64231,1.3],[64482,0.5],[64732,0.2],[64981,0],[65232,11.8],[65484,22.3],[65735,8.4],[65985,3.7],[66236,1.4],[66487,0.6],[66737,0.2],[66990,0],[67238,5],[67491,21.7],[67743,8.2],[67993,3.5],[68245,1.4],[68495,0.6],[68746,0.2],[68997,0.1],[69246,0],[69498,25.6],[69750,9.6],[70001,4],[70253,1.6],[70503,0.6],[70754,0.3],[71007,0],[71256,0],[71510,25.8],[71760,9.7],[72009,4],[72260,1.5],[72511,0.7],[72763,0.3],[73015,0.1],[73262,0.1],[73515,29.9],[73767,11.8],[74018,3.1],[74268,1.9],[74518,0.8],[74772,0.2],[75022,0],[75269,17],[75523,19.3],[75775,7.6],[76023,3.3],[76277,1.3],[76528,0.5],[76778,0.2],[77030,0],[77280,12.8],[77533,22.2],[77783,8.3],[78033,3.6],[78284,1.4],[78534,0.6],[78784,0.2],[79035,0.1],[79282,3.1],[79533,23.2],[79784,8.7],[80035,3.8],[80287,1.4],[80539,0.6],[80789,0.2],[81039,0],[81290,4.5],[81540,23],[81794,8.5],[82046,3.7],[82296,1.5],[82547,0.6],[82796,0.2],[83047,0.1],[83296,0.1],[83550,25.9],[83800,9.7],[84050,4],[84301,1.6],[84550,0.8],[84801,0.3],[85051,0.1],[85300,0.1],[85554,27.4],[85804,10.4],[86056,4.3],[86308,1.7],[86557,0.7],[86808,0.3],[87058,0.1],[87307,0.1],[87560,31.3],[87811,12.2],[88062,5],[88314,2],[88565,0.9],[88815,0.5],[89065,0.1],[89314,0.1],[89568,35.4],[89818,13.8],[90070,5.7],[90320,2.3],[90573,1],[90824,0.4],[91075,0.2],[91322,0.1],[91576,35.7],[91827,14.1],[92077,5.7],[92328,2.2],[92578,1],[92831,0.3],[93081,0.2],[93330,0.1],[93584,34.6],[93834,17.2],[94087,6.9],[94335,2.8],[94586,1.1],[94837,0.5],[95089,0.1],[95338,0],[95589,31.5],[95841,15.6],[96092,6.4],[96342,2.6],[96593,1],[96845,0.5],[97094,0.1],[97346,0.1],[97597,25],[97848,20.2],[98099,7.9],[98350,3.4],[98600,1.2],[98851,0.5],[99101,0.2],[99351,0.1],[99603,27.1],[99855,11.4],[100107,4.6],[100357,2],[100608,0.8],[100860,0.4],[101112,0.1],[101361,0],[101609,9.7],[101861,23.1],[102113,8.7],[102362,3.6],[102616,1.5],[102866,0.6],[103117,0.2],[103368,0],[103617,5.1],[103872,21.2],[104123,8],[104374,3.6],[104624,1.4],[104873,0.5],[105125,0.2],[105375,0.1],[105623,0],[105877,27.6],[106126,10.4],[106376,4.2],[106628,1.8],[106877,0.7],[107128,0.3],[107379,0],[107628,0],[107882,25.5],[108133,9.6],[108384,4],[108635,1.6],[108885,0.7],[109138,0.3],[109387,0.1],[109637,0],[109891,31.1],[110141,12.1],[110391,4.9],[110643,2],[110894,0.9],[111145,0.3],[111398,0.2],[111646,0.1],[111897,29.3],[112151,11.5],[112400,4.6],[112651,2],[112901,0.8],[113153,0.4],[113403,0],[113651,0.1],[113905,34.9],[114157,13.7],[114406,5.5],[114658,2.1],[114909,0.9],[115161,0.3],[115410,0.1],[115659,0],[115913,35.2],[116164,13.8],[116416,5.5],[116667,2.2],[116917,1],[117168,0.4],[117419,0.2],[117667,0],[117921,38.9],[118173,15.3],[118423,6.1],[118674,2.4],[118926,0.9],[119176,0.2],[119428,0],[119675,0],[119931,25],[120182,9.8],[120432,4],[120683,1.7],[120936,0.7],[121185,0.2],[121438,0],[121684,0],[121936,23.4],[122188,8.8],[122439,3.8],[122689,1.4],[122939,0.7],[123191,0.1],[123442,0],[123690,0],[123944,31],[124194,12],[124446,4.9],[124696,2],[124947,0.9],[125198,0.4],[125449,0],[125696,0],[125949,35.5],[126201,13.9],[126451,5.6],[126702,2.3],[126952,1],[127205,0.4],[127455,0.1],[127703,0.1],[127957,35.4],[128209,13.9],[128458,5.7],[128710,2.2],[128960,1],[129211,0.3],[129462,0.2],[129712,0],[129964,37.6],[130217,15.6],[130467,6.2],[130718,2.5],[130969,0.9],[131221,0.4],[131472,0.2],[131723,0.1],[131973,31.4],[132225,13.9],[132476,5.8],[132726,2.2],[132978,0.9],[133228,0.4],[133478,0.2],[133730,0.1],[133977,24.1],[134231,19.7],[134483,7.7],[134733,3.2],[134983,1.3],[135233,0.4],[135485,0.2],[135735,0.1],[135983,20],[136235,18.3],[136487,7.2],[136738,3.1],[136990,1.2],[137240,0.5],[137492,0.2],[137742,0.1],[137991,11.2],[138244,22.4],[138494,8.8],[138746,3.7],[138997,1.5],[139249,0.5],[139500,0.2],[139749,0.1],[139998,6.9],[140250,22],[140502,8.2],[140752,3.7],[141005,1.4],[141254,0.6],[141506,0.2],[141756,0],[142005,5.3],[142259,23.2],[142510,8.7],[142760,3.6],[143011,1.5],[143261,0.6],[143513,0.2],[143764,0.1],[144013,0.1],[144267,25.5],[144516,9.7],[144768,4],[145019,1.6],[145271,0.7],[145520,0.3],[145770,0.1],[146018,0],[146273,31.3],[146523,12.2],[146775,5],[147026,2],[147275,0.9],[147525,0.4],[147777,0],[148024,0],[148277,30.3],[148528,11.8],[148780,5],[149031,2],[149282,0.9],[149533,0.5],[149784,0.1],[150031,0.1],[150286,35.5],[150535,13.9],[150788,5.8],[151037,2.2],[151288,1],[151541,0.4],[151790,0.2],[152039,0.1],[152292,36.4],[152543,14.3],[152795,5.8],[153045,2.2],[153295,1],[153544,0.4],[153796,0.1],[154044,0],[154297,37.8],[154549,14.8],[154801,5.9],[155051,2.3],[155302,1],[155553,0.4],[155804,0.2],[156053,0.1],[156305,32.3],[156558,12.5],[156809,5.1],[157058,2.1],[157309,0.9],[157560,0.4],[157810,0.1],[158059,0.1],[158312,28.1],[158564,18.5],[158816,7.5],[159065,3],[159315,1.3],[159565,0.5],[159818,0.1],[160065,0.1],[160320,25],[160569,19.1],[160819,7.5],[161071,3.2],[161322,1.1],[161574,0.5],[161824,0.2],[162073,0.1],[162326,14.2],[162577,21.6],[162827,8.4],[163080,3.5],[163331,1.4],[163581,0.6],[163832,0.2],[164081,0],[164333,32.3],[164584,12.6],[164836,5.3],[165087,2],[165336,0.9],[165586,0.4],[165838,0.2],[166088,0.1],[166340,36.3],[166591,14.2],[166840,5.8],[167091,2.4],[167342,1],[167593,0.4],[167843,0.2],[168095,0.1],[168343,33.2],[168598,15.2],[168849,6.1],[169100,2.4],[169350,1],[169601,0.4],[169852,0.2],[170104,0.1],[170352,28.4],[170606,18.4],[170858,7.3],[171108,3],[171358,1.1],[171609,0.5],[171860,0.2],[172112,0.1],[172361,20.7],[172615,18.7],[172866,7.4],[173116,3.1],[173367,1.2],[173617,0.5],[173868,0.2],[174119,0.1],[174367,15.3],[174619,21.2],[174872,8.3],[175123,3.5],[175374,1.4],[175626,0.6],[175875,0.2],[176126,0.1],[176376,11.7],[176629,20.1],[176880,7.9],[177131,3.5],[177383,1.4],[177634,0.6],[177881,0.2],[178135,0],[178384,4.4],[178636,23.2],[178887,8.6],[179139,3.7],[179389,1.4],[179640,0.6],[179890,0.2]]
```

热点（所有线程，命中次数非 ms）：
```text
Sort by top of stack, same collapsed (when >= 5):
        __psynch_cvwait  (in libsystem_kernel.dylib)        58533
        __workq_kernreturn  (in libsystem_kernel.dylib)        12028
        JSC::JSObject::countElements()  (in JavaScriptCore)        7170
        operationArrayIndexOfNonStringIdentityValueContiguous  (in JavaScriptCore)        89
        JSC::JSFinalObject::visitChildren(JSC::JSCell*, JSC::SlotVisitor&)  (in JavaScriptCore)        60
        mach_msg2_trap  (in libsystem_kernel.dylib)        50
        JSC::JSObject::visitChildren(JSC::JSCell*, JSC::SlotVisitor&)  (in JavaScriptCore)        43
        JSC::BlockDirectory::tryAllocateBlock(JSC::Heap&)  (in JavaScriptCore)        29
        JSC::MarkedBlock::Handle::sweep(JSC::FreeList*)  (in JavaScriptCore)        25
        __bzero  (in libsystem_platform.dylib)        22
        JSC::JSObject::putOwnDataPropertyBatching(JSC::VM&, WTF::UniquedStringImpl**, long long const*, unsigned int)  (in JavaScriptCore)        20
        JSC::SlotVisitor::drain(WTF::MonotonicTime)  (in JavaScriptCore)        20
        JSC::DFG::performGraphPackingAndLivenessAnalysis(JSC::DFG::Graph&)  (in JavaScriptCore)        17
        _platform_memset  (in libsystem_platform.dylib)        16
        JSC::globalFuncCloneObject(JSC::JSGlobalObject*, JSC::CallFrame*)  (in JavaScriptCore)        15
        JSC::objectConstructorValues(JSC::JSGlobalObject*, JSC::CallFrame*)  (in JavaScriptCore)        14
        JSC::B3::(anonymous namespace)::ReduceStrength::reduceValueStrength()  (in JavaScriptCore)        13
        JSC::B3::reduceStrength(JSC::B3::Procedure&)  (in JavaScriptCore)        12
        JSC::JSArray::appendMemcpy(JSC::JSGlobalObject*, JSC::VM&, unsigned int, JSC::JSArray*)  (in JavaScriptCore)        11
        JSC::JSObject::initializeIndex(JSC::ObjectInitializationScope&, unsigned int, JSC::JSValue)  (in JavaScriptCore)        11
        pas_thread_local_cache_flush_deallocation_log  (in JavaScriptCore)        11
        JSC::B3::Air::Greedy::GreedyAllocator::allocateRegisters<(JSC::B3::Bank)0>()  (in JavaScriptCore)        10
        JSC::DFG::runPhase<JSC::DFG::(anonymous namespace)::PutStackSinkingPhase>(JSC::DFG::Graph&)  (in JavaScriptCore)        10
        operationObjectAssignObject  (in JavaScriptCore)        10
        JSC::JSLexicalEnvironment::visitChildren(JSC::JSCell*, JSC::SlotVisitor&)  (in JavaScriptCore)        9
        JSC::JSObject::getOwnPropertySlotByIndex(JSC::JSObject*, JSC::JSGlobalObject*, unsigned int, JSC::PropertySlot&)  (in JavaScriptCore)        9
        _platform_memmove  (in libsystem_platform.dylib)        9
        operationSpreadGeneric  (in JavaScriptCore)        9
        JSC::JSObject::putDirectInternal<(JSC::JSObject::PutMode)1>(JSC::VM&, JSC::PropertyName, JSC::JSValue, unsigned int, JSC::PutPropertySlot&)  (in JavaScriptCore)        8
        JSC::objectAssignFast(JSC::JSGlobalObject*, JSC::JSFinalObject*, JSC::JSObject*, WTF::Vector<WTF::UniquedStringImpl*, 8ul, WTF::CrashOnOverflow, 16ul, WTF::FastMalloc>&, JSC::MarkedVector<JSC::JSValue, 8ul, WTF::RecordOverflow>&)::'lambda'(JSC::PropertyTableEntry const&)::operator()(JSC::PropertyTableEntry const&) const  (in JavaScriptCore)        8
        JSC::B3::Air::Greedy::GreedyAllocator::run()  (in JavaScriptCore)        7
        JSC::toPropertyDescriptor(JSC::JSGlobalObject*, JSC::JSValue, JSC::PropertyDescriptor&, bool&)  (in JavaScriptCore)        7
        WTF::fastMalloc(unsigned long)  (in JavaScriptCore)        7
        JSC::DFG::AbstractInterpreter<JSC::DFG::InPlaceAbstractState>::executeEffects(unsigned int, JSC::DFG::Node*)  (in JavaScriptCore)        6
        JSC::DFG::CPSRethreadingPhase::run()  (in JavaScriptCore)        6
        JSC::JSFunction::reifyLazyPropertyIfNeeded<(JSC::JSFunction::SetHasModifiedLengthOrName)0>(JSC::VM&, JSC::JSGlobalObject*, JSC::PropertyName)  (in JavaScriptCore)        6
        JSC::JSObject::defineOwnProperty(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::PropertyDescriptor const&, bool)  (in JavaScriptCore)        6
        JSC::arrayProtoFuncPush(JSC::JSGlobalObject*, JSC::CallFrame*)  (in JavaScriptCore)        6
        pas_segregated_page_construct  (in JavaScriptCore)        6
        JSC::B3::eliminateDeadCodeImpl(JSC::B3::Procedure&)  (in JavaScriptCore)        5
        JSC::DFG::BasicBlock::BasicBlock(JSC::BytecodeIndex, unsigned int, unsigned int, unsigned int, float)  (in JavaScriptCore)        5
        JSC::DFG::ByteCodeParser::get(JSC::Operand)  (in JavaScriptCore)        5
        JSC::JSCallee::visitChildren(JSC::JSCell*, JSC::SlotVisitor&)  (in JavaScriptCore)        5
        JSC::JSObject::putDirectIndex(JSC::JSGlobalObject*, unsigned int, JSC::JSValue, unsigned int, JSC::PutDirectIndexMode)  (in JavaScriptCore)        5
        JSC::MarkedVectorBase::expandCapacity(unsigned int)  (in JavaScriptCore)        5
        JSC::globalFuncCopyDataProperties(JSC::JSGlobalObject*, JSC::CallFrame*)  (in JavaScriptCore)        5
```

### D6.1-b 最终汇总（2026-09-20）

P1 完成 15 次有效 WYSIWYG-close；P2 完成 3 次有效同窗口切换。早先 3 次外部打开及 1 次对话框确认失败均排除，原始记录保留，不覆盖旧值。未重测 A 打开性能，没有改动源码/阈值或系统设置。

#### P1 — WYSIWYG 关闭

| fixture | trial | confirmed WYSIWYG at close? | close_block_ms (CPU) | probe_latency_ms | first_probe_sent_at (+08:00) | recovered? | hung/crashed? |
|---|---:|---|---:|---:|---|---|---|
| very-long-line | 1 | Yes¹ | 0* | 106 | 2026-09-20T19:09:53.816+08:00 | Yes | 未观察到 |
| very-long-line | 2 | Yes¹ | 0* | 99 | 2026-09-20T19:10:09.055+08:00 | Yes | 未观察到 |
| very-long-line | 3 | Yes¹ | 0* | 97 | 2026-09-20T19:10:24.199+08:00 | Yes | 未观察到 |
| large-table | 1 | Yes¹ | 0* | 106 | 2026-09-20T19:10:49.409+08:00 | Yes | 未观察到 |
| large-table | 2 | Yes¹ | 0* | 99 | 2026-09-20T19:11:14.676+08:00 | Yes | 未观察到 |
| large-table | 3 | Yes¹ | 0* | 97 | 2026-09-20T19:11:40.185+08:00 | Yes | 未观察到 |
| many-short-nodes | 1 | Yes¹ | 0* | 104 | 2026-09-20T19:12:01.647+08:00 | Yes | 未观察到 |
| many-short-nodes | 2 | Yes¹ | 0* | 101 | 2026-09-20T19:12:23.154+08:00 | Yes | 未观察到 |
| many-short-nodes | 3 | Yes¹ | 0* | 97 | 2026-09-20T19:12:44.646+08:00 | Yes | 未观察到 |
| dense-math | 1 | Yes¹ | 0* | 106 | 2026-09-20T19:13:01.313+08:00 | Yes | 未观察到 |
| dense-math | 2 | Yes¹ | 0* | 99 | 2026-09-20T19:13:18.202+08:00 | Yes | 未观察到 |
| dense-math | 3 | Yes¹ | 0* | 104 | 2026-09-20T19:13:35.143+08:00 | Yes | 未观察到 |
| normal-prose | 1 | Yes¹ | 0* | 104 | 2026-09-20T19:13:50.315+08:00 | Yes | 未观察到 |
| normal-prose | 2 | Yes¹ | 0* | 103 | 2026-09-20T19:14:05.478+08:00 | Yes | 未观察到 |
| normal-prose | 3 | Yes¹ | 0* | 107 | 2026-09-20T19:14:20.666+08:00 | Yes | 未观察到 |

#### P2 — 同窗口 normal-prose → large-table

| fixture | trial | confirmed WYSIWYG at switch? | switch_block_ms (CPU) | probe_latency_ms | first_probe_sent_at (+08:00) | recovered? | hung/crashed? |
|---|---:|---|---:|---:|---|---|---|
| normal-prose-to-large-table | 1 | Yes¹ | 11793 | 10889 | 2026-09-20T19:17:27.071+08:00 | Yes | 未观察到 |
| normal-prose-to-large-table | 2 | Yes¹ | 11792 | 10568 | 2026-09-20T19:21:01.290+08:00 | Yes | 未观察到 |
| normal-prose-to-large-table | 3 | Yes¹ | 10790 | 10504 | 2026-09-20T19:25:47.586+08:00 | Yes | 未观察到 |

¹ 模式证据为：新文档 Milkdown ready + Ctrl+4 菜单事件 + 当前准备/动作日志中无 Source 转换 + 最近模式记录为 wysiwyg。默认模式不触发同模式 change 日志，最近 change 来自之前的启动；未把旧日志单独当作本进程证明。P2 另有 normal-prose ID → large-table ID 的 tab.switch，且动作窗口内没有 window.open/window.close/file.close。用户关闭窗口的提示已处理，三次有效切换均从独立冷启动准备。

`0*`：无两个连续 >80% 采样点，不是 0 ms 卡顿。全部 P1 甚至没有 >80% 点。表格毫秒数是采样/探针估计，非准确完成时间。

#### n=3 中位数与范围

| 路径 / fixture | CPU 连续高占用中位数 [min,max] ms | 首探针延迟中位数 [min,max] ms |
|---|---|---|
| P1 / very-long-line | 3/3 未捕获（0*；不作真实零值统计） | 99 [97, 106] |
| P1 / large-table | 3/3 未捕获（0*；不作真实零值统计） | 99 [97, 106] |
| P1 / many-short-nodes | 3/3 未捕获（0*；不作真实零值统计） | 101 [97, 104] |
| P1 / dense-math | 3/3 未捕获（0*；不作真实零值统计） | 104 [99, 106] |
| P1 / normal-prose | 3/3 未捕获（0*；不作真实零值统计） | 104 [103, 107] |
| P2 / normal-prose-to-large-table | 11792 [10790, 11793] | 10568 [10504, 10889] |

n=3 只报告中位数和范围，不计算置信区间。

#### 热点对照

关闭路径：very-long-line 三次主要为等待，`pas_thread_local_cache_for_all` 分别 19/16/22 次；第一轮 `JSC::CodeBlock::visitChildren` 5 次。large-table 关闭的 `WebCore::RenderTreeUpdater::tearDownRenderers` 为 9/9/8 次，第三轮 `RenderTreeBuilder::detachFromRenderElement` 5 次。两者均未在 top-of-stack 的 ≥5 命中列表出现 `JSC::JSObject::countElements`；这只是采样阈值内未捕获，不证明该函数从未执行。没有持续关闭阻塞，无法给历史关闭阻塞命名根因。

P2 有效 trial 1：JSC::JSObject::countElements()  (in JavaScriptCore)        7340；operationArrayIndexOfNonStringIdentityValueContiguous  (in JavaScriptCore)        96；JSC::JSFinalObject::visitChildren(JSC::JSCell*, JSC::SlotVisitor&)  (in JavaScriptCore)        61。
P2 有效 trial 2：JSC::JSObject::countElements()  (in JavaScriptCore)        7228；operationArrayIndexOfNonStringIdentityValueContiguous  (in JavaScriptCore)        96；JSC::JSFinalObject::visitChildren(JSC::JSCell*, JSC::SlotVisitor&)  (in JavaScriptCore)        57。
P2 有效 trial 3：JSC::JSObject::countElements()  (in JavaScriptCore)        7170；operationArrayIndexOfNonStringIdentityValueContiguous  (in JavaScriptCore)        89；JSC::JSFinalObject::visitChildren(JSC::JSCell*, JSC::SlotVisitor&)  (in JavaScriptCore)        60。

P2 的 countElements 热点与前文大表格打开的热点一致，而关闭路径没有相同量级的采样表现。命中次数不是 ms，汇总涉及所有线程；未给 ??? JIT 帧编造函数名。

#### 与历史观察直接比较

- very-long-line WYSIWYG-close 历史 **79197 ms**：本次 **未复现**。3/3 未捕获连续高 CPU，首探针 97–106 ms，均恢复。不是对历史记录的否定，也不是修复证明。
- large-table WYSIWYG 文档切换历史 **55766 ms**：本次 **部分复现**多秒停顿，但未复现 55.8 秒量级。3 次连续高 CPU 为 11793, 11792, 10790 ms，首探针为 10889, 10568, 10504 ms。历史与本次仪器、操作细节及代码状态不同，不能将差异归因于某个修复。

#### 对 §4 判据结论的更新

本节补齐“当前 release 直接关闭 WYSIWYG 文档”的实测缺口；不回写前文的历史 NOT VERIFIED。三次超长行关闭均未重现长阻塞，不支持把最长行当作本次关闭成本的唯一预测变量。大表格的同窗口进入路径有明显成本，关闭没有同等级成本，说明判据评估还须区分操作路径。前文零表格 many-short-nodes 的约 7.4 秒打开停顿仍然有效，**cells-only 不足**的结论不变；本节不取代 §4 关于表格规模与节点/列表结构组合的研究方向，不据此删掉长行候选或产生阈值。未控制节点数、表格尺寸梯度和跨机器环境，n=3 也不足以拟合阈值。

#### 仪器与未验证范围

- CPU 在动作前即开始采样，约每 250 ms 读取正确 WebContent PID；连续 >80% 按首末点差估计。它是全进程 CPU，并非 Web Inspector Timeline，也非严格主线程占用。低于 250 ms 或未跨阈值的停顿可能漏掉。
- 每次最多观察 180 s；连续 CPU <20% 至少 10 s 则提前结束。每 2 s 的侧栏探针可能引起额外布局，影响 CPU 安静时间；观察窗口不可当作阻塞时长。没有无探针对照。
- 首探针发送请求时刻 → 首条匹配处理日志为 probe-latency estimate，包含 AppleScript 和异步 Rust 日志调度，不是精确完成时间。关闭指令到第一探针之间的短间隔不包含在探针延迟中。没有 sub-50 ms 结论。
- 阻塞期间多次快捷键可能合并/未处理；发送数和处理数已逐次保存，无 actionId 跨端关联。因此仅使用首探针近似，不假装每条探针都有一对一配对。
- 关闭后的空编辑器 ready 保留为 brief 要求的 lower-bound marker（重建阶段进度标记），不当作完成端点；与首探针不保证严格先后关系。未使用固定 500 ms 的 dom.check 计时。
- 无 trial 达到永久无响应的已确认状态，无因卡死而 SIGKILL；夹具间仅 SIGTERM 冷启动清理。hung/crashed 列只描述观察窗口，不能证明任意长运行无故障。
- 本次没有系统中断。前文第一轮中断的原因仍未验证；不因本次成功抹去该边界。原始记录中的机器版本差异、供电/温度未控制等限制继续适用。

#### 观察窗口与证据完整性

| 路径 / fixture / trial | 观察窗口 ms | 达到连续安静 10 s? | 探针发送/处理 | 日志字节区间 |
|---|---:|---|---|---|
| P1 / very-long-line / 1 | 10030 | True | 5/5 | [2483367,2487302) |
| P1 / very-long-line / 2 | 10018 | True | 5/5 | [2495205,2499140) |
| P1 / very-long-line / 3 | 10030 | True | 5/5 | [2507284,2511219) |
| P1 / large-table / 1 | 10042 | True | 5/5 | [2518855,2522784) |
| P1 / large-table / 2 | 10519 | True | 6/6 | [2530661,2534842) |
| P1 / large-table / 3 | 10031 | True | 5/5 | [2542478,2546407) |
| P1 / many-short-nodes / 1 | 10535 | True | 6/6 | [2554570,2558761) |
| P1 / many-short-nodes / 2 | 10535 | True | 6/6 | [2566683,2570874) |
| P1 / many-short-nodes / 3 | 10039 | True | 5/5 | [2578796,2582735) |
| P1 / dense-math / 1 | 10101 | True | 5/5 | [2590365,2594292) |
| P1 / dense-math / 2 | 10031 | True | 5/5 | [2602163,2606090) |
| P1 / dense-math / 3 | 10027 | True | 5/5 | [2613720,2617647) |
| P1 / normal-prose / 1 | 10016 | True | 5/5 | [2625776,2629707) |
| P1 / normal-prose / 2 | 10031 | True | 5/5 | [2637836,2641767) |
| P1 / normal-prose / 3 | 10010 | True | 5/5 | [2649655,2653586) |
| P2-same-window / normal-prose-to-large-table / 1 | 79788 | True | 40/35 | [2710681,2722915) |
| P2-same-window-retry / normal-prose-to-large-table / 2 | 180032 | False | 89/89 | [2740435,2766084) |
| P2-same-window-retry / normal-prose-to-large-table / 3 | 180025 | False | 89/89 | [2783363,2809012) |

追加前原文共 32912 bytes，SHA-256 `58ca63a579acbdc12a28f74036afdd253f4f70cc8a2e0d6e5fd8a57d1ea272a7`；已逐字节验证该前缀保持原样。本节及原始试验摘要为追加内容，未修改前文任何数值。

最终检查：`pnpm build` 成功（仅已有大包体积提示）；`git diff --check` 无输出。18 个有效样本的目标动作、恢复证据与日志窗口已逐项复核，未修改原文前缀及其他工作区文件。

---

### D6.1-b 复核修正（2026-09-20，独立复算）

对上节的独立复核。**不修改上节任何数值**；下列各项是从同一份 `~/.mdpro/mdpro.log`
原始事件重新推算出来的，与上节的 CPU 采样构成两套独立仪器。复核动机：上节 P1
的首探针延迟在 15 次试验中落在 97–107 ms 且**与 fixture 无关**，横跨 0–45752 cells
与 4–32658 lines 的五个 fixture 没有分化——这种不分化本身就是仪器触到地板的信号，
不是被测对象的性质。

#### 修正 1 —— P1 关闭的真实拆除耗时（上节记为 `0*`）

`0*` 与 97–107 ms 首探针延迟**两者都是地板伪影**：拆除在第一个探针发出（≈90 ms）
之前就已结束，所以 250 ms 的 CPU 采样取不到连续 >80% 点，而探针测到的是它自己的
派发地板。真实耗时可以直接从日志读出——`file.close` 与随后空编辑器
`editor.milkdown.mount` / `editor.milkdown.direct.state{editorLoading:false}` 的间隔：

| fixture | `file.close`→`mount` ms (3 次) | →`editorLoading:false` ms (3 次) | 关闭前 pmChildCount | 关闭前 innerHTML |
|---|---|---|---|---|
| very-long-line | 7 / 4 / 3 | 19 / 13 / 12 | 2 | 359,314 |
| normal-prose | 8 / 10 / 11 | 12 / 16 / 18 | 1,287 | 368,074 |
| dense-math | 28 / 31 / 30 | 33 / 35 / 36 | 10,332 | 519,048 |
| many-short-nodes | 58 / 56 / 56 | 68 / 67 / 67 | 1 | 2,770,280 |
| large-table | 72 / 61 / 59 | 94 / 74 / 71 | 1 | 2,314,681 |

三次试验内部离散度低，fixture 之间分化清楚。**该排序与首轮 sweep 的 action-A 打开
代价 5/5 完全一致**（large-table > many-short-nodes > dense-math > normal-prose >
very-long-line），量级小约 200 倍。

结论不变但证据等级提高：历史 **79,197 ms 未复现**，且现在是有量级的实测值而非
"未捕获"。上节 §4 "不把 `0*` 当真实零值"的克制是对的——这里补上了它缺的那个数。

附带发现：拆除耗时跟的是**渲染后 DOM 字节数**而非节点数。dense-math 有 10,332 个
顶层节点只要 ~30 ms；large-table 只有 1 个顶层节点却要 ~64 ms。节点计数在这条路径上
不是预测量。

#### 修正 2 —— WYSIWYG 模式证据由"推断"升级为直接正向证据

上节脚注 ¹ 记：「默认模式不触发同模式 change 日志，最近 change 来自之前的启动；
未把旧日志单独当作本进程证明」。该保留可以撤销，证据本就在同一份日志里：

1. **15 次关闭中的每一次**，其前 ~3 s 都有一条 `editor.milkdown.dom.check`，显示
   ProseMirror DOM 已完整填充（`hasProseMirror: true`，innerHTML 359 KB–2.77 MB，
   见上表）。Milkdown 持有文档 DOM 即等价于 WYSIWYG 为当前渲染面。
2. **整个观察窗口（19:09–19:15）内 `view.mode.change` 事件数为 0**，证明既没有
   按下 ⌃2，也没有发生任何模式切换。

两条合并：本进程内 WYSIWYG 为关闭时的实际渲染面，属直接观测而非推断。上节
"confirmed WYSIWYG at close? Yes¹" 的上标可视为已兑现。

#### 修正 3 —— P2 的日志侧独立复算（与 CPU 采样互证）

按"有 `tab.open`+`tab.switch`、无 `window.open`"重新识别有效的同窗口切换，
得到 3 次，与上节的有效计数一致；19:15:06 那次确为新窗口，上节将其排除是对的。

| 试验 | `tab.open`→`dom.check` ms | 扣除 500 ms 固定定时器 | 上节 CPU 连续高占用 ms |
|---|---|---|---|
| 19:17:27.100 | 11,734 | 11,234 | 11,793 |
| 19:21:01.213 | 11,555 | 11,055 | 11,792 |
| 19:25:47.505 | 10,848 | 10,348 | 10,790 |

两套独立仪器偏差 ≈5%，且三次的相对排序一致（trial 3 最低）。注意
`editor.milkdown.dom.check` 依赖 `MilkdownEditor.tsx:161` 的硬编码
`setTimeout(…, 500)`，**本身不是合格的计时终点**，此处仅作为交叉校验的第二仪器使用，
不取代 CPU 采样值。

#### 命名限制 L-1 —— 探针污染了 CPU 安静判据（"达到连续安静 10 s = False"）

观察窗表中 `P2-same-window-retry` 的 trial 2 与 trial 3 记为
「达到连续安静 10 s? **False**」，观察窗跑满 180,032 / 180,025 ms。

**这是仪器自身造成的污染，不是残留卡顿。** 每 2 s 一次的 ⌘⇧L 侧栏探针会在一个
2.31 MB 的 ProseMirror DOM 上反复触发布局，使 WebContent 的 CPU 无法回落到 20%
以下，因而"连续安静 10 s"这一早退条件在大文档上**永远不可能被满足**。

反证据：这两次试验 **89/89 探针全部被处理**，没有丢失——若应用仍处于阻塞，探针会
被丢弃而非按时落盘。故上节 "recovered? Yes" 的判定成立。

该限制的作用范围与后果：

- **"连续安静 10 s"在 innerHTML 达到 MB 量级的 fixture 上不是可用的恢复判据**，
  后续任何复用本协议的测量都不应把它当作通过条件。可用的恢复判据是
  **探针处理率**（processed / sent）与**连续高 CPU 段的结束时刻**。
- 上节已自陈「没有无探针对照」，这条限制正是该缺口的具体后果，应一并保留。
- 同表 `P2-same-window` trial 1 为 40 发 35 收（丢 5 发），是本次唯一出现探针丢失的
  试验，观察窗 79,788 ms。该丢失未出现在上节面向读者的汇总中，在此补记。

#### 对 D6.2 判据设计的两项输入

1. **同窗口切换代价 ≈ 冷打开代价**：本次同窗口切换 10.3–11.2 s，对比首轮 sweep
   large-table 冷打开 12,004 ms；热点 `JSC::JSObject::countElements` 7,170–7,340
   对比首轮同 fixture 打开的 7,370，几乎相同。**不存在额外的"切换惩罚"**——guard
   判据可以是文档自身的单一函数，在 open 与 switch 两处同样套用，无需分别建模。
2. **关闭路径不需要 guard**：最坏 ~72 ms（`file.close`→`mount`），比首轮 §2 的打开
   代价小两个数量级。D6.2 的判据应只瞄准 open / switch 上的 `countElements` 路径；
   为关闭路径设阈值是没有收益的复杂度。

#### 本节复核所做的完整性核验

- 追加前原文前缀（前 680 行）SHA-256 重算为
  `58ca63a579acbdc12a28f74036afdd253f4f70cc8a2e0d6e5fd8a57d1ea272a7`，
  **与原始值逐字节相同**。
- `git status --porcelain -- src src-tauri` 中无由本次 sweep 引入的改动；其中列出的
  `src/hooks/useTOC.ts` 改动与 5 个 scroll-spy 新文件均早于本次 sweep，属先前 WI 遗留。
- 本节为纯追加，未修改上节及前文的任何数值、表格或结论。
