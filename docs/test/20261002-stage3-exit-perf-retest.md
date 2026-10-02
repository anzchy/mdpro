# 阶段 3.8 · 大文档性能出口复测（2026-10-02）

> 基线：[`docs/plans/20260915-stage3-gate2-record.md`](../plans/20260915-stage3-gate2-record.md)（下称「基线记录」）。
> 方法：[`docs/plans/20260915-stage3-gate2-runbook.md`](../plans/20260915-stage3-gate2-runbook.md)。
> 范围：排序文档 3.8 行；[ADR-0004](../adr/0004-gate2-waiver-for-stage3-entry.md)「Consequences / Step 3.8 is now harder」——**逐面比较、点名排除楔住的形态，不比聚合值**。
>
> 本文所有毫秒数都是**观察值，不是阈值**（E39/G0）。数字只取自日志、`ps`、cargo；没有一个数字来自截图。

## 0. 测量条件

| 项 | 本次 | 基线（2026-09-15） |
|---|---|---|
| 机器 | Apple M4 / 24 GB / macOS 26.3.1 (Darwin 25.3.0) | 同 |
| 电源 | **电池**，开始时 73% 放电中，结束时 55% | 电池，91% 放电中 |
| 热节流 | `pmset -g therm`：无热警告、无性能警告 | 同 |
| 被测构建 | **release** bundle `com.mdpro.app` v0.3.0，`mdpro/src-tauri/target/release/bundle/macos/mdpro.app`，mtime 2026-10-02T02:36:18Z | **debug** bundle（带 Web Inspector） |
| 源码版本 | 构建自 `ef91e24`；与 HEAD `e471198` 之间 `src/`、`src-tauri/` 无差异 ⇒ 被测映像即 `e471198` | 入口门禁时的代码（500 KB 字节护栏） |
| `Contents/MacOS/tauri-app` sha256 | `0c340fff3e1a7763913edc4fef031d570f62df6dbf57386c022efabde78652b9` | — |
| 新鲜度（gui-acceptance 陷阱 2） | bundle 晚于 `largeDocumentGuard.ts`、`tocService.ts`、`lineCounter.ts`、`App.tsx`、`MilkdownEditor.tsx`、`markdown.rs`、`file.rs` | — |
| 冷启动（陷阱 3） | 启动日志 `appReady:false`、窗口 label `main` | — |
| 语料 | 11 份，seed `0x5eed`，`generate-corpus.mjs --check` 11/11 与计划 M 表逐字节一致；放在 scratchpad，未进仓库。全部跑完后 sha256 复核 11/11 OK | `.perf-corpus/`，同一份输入 |

**可比性限制（读下面每一张表之前先读这一段）：**

1. **构建 profile 不同。** 基线是 debug bundle，本次是 release bundle。除 S1（渲染面，两边都用 cargo `test` profile）外，新旧数字不是同一个二进制。
2. **测量工具不同。** release 包没有 DevTools（`src-tauri/Cargo.toml` 的 `tauri` features 只有 `protocol-asset`）。基线的切换/关闭用的是 Web Inspector 的「点击 → 双 rAF」，最长任务用 Timelines；本次只能用日志时间戳差做**代理指标**，每处都标了出来。
3. **两边都在电池下。** 基线记录 §10 要求重测插电，本次**没有做到**。
4. **基线除渲染面外都是单次**；本次大多也是单次，只有 S1（5 次取中位）与 WYSIWYG 配对切换（10 次）不是。
5. **护栏已经换了。** 基线时是 500 KB 字节护栏；今天是 ADR-0016 结构分 + ADR-0019 最长行（WYSIWYG 入口）与 ADR-0022 表格行密度（Source）。基线里最大的两个数字所走的路径**今天已经不存在**，见 §2 与 §3。

## 1. 现行护栏对每份语料的判定（导入真实 `src/utils/largeDocumentGuard.ts` 计算，真机日志逐一印证）

| 语料 | WYSIWYG 入口 | Source | 基线（500 KB 字节护栏） |
|---|---|---|---|
| dense-math.source | 降级 · structure (425 316) | 放行 | 降级 |
| large-table.source | 降级 · structure (1 164 910) | **卸掉表格扩展**（232 982 行） | 降级 |
| many-short-nodes.source | 降级 · structure (637 940) | 放行 | 降级 |
| normal-prose.source | 降级 · structure (54 126) | 放行 | 降级 |
| very-long-line.source | 降级 · **line-length**（7 583 742） | 放行 | 降级 |
| large-table.wysiwyg | **降级** · structure (57 190) | 放行 | **放行**（即 55 766 ms 那条） |
| many-short-nodes.wysiwyg | **降级** · structure (32 657) | 放行 | 放行 |
| dense-math.wysiwyg | 放行 | 放行 | 放行 |
| normal-prose.wysiwyg / .crlf | 放行 | 放行 | 放行 |
| very-long-line.wysiwyg | 放行 | 放行 | 放行 |

## 2. 逐面对照（不做聚合）

### S1 渲染面（cargo `perf_render_corpus`，`test [unoptimized + debuginfo]` profile，repeats=5，取中位）

与基线同 profile、同输入，是本文唯一同口径的一面。总耗时 158.53 s（基线 164.80 s）。

| 语料 | render_p50 本次 | render_p50 基线 | sanitize_p50 本次 | sanitize_p50 基线 |
|---|---:|---:|---:|---:|
| **normal-prose.source**（基线总表那一行） | **969.0 ms** | **998.9 ms** | **662.5 ms** | **680.3 ms** |
| dense-math.source | 1917.1 | — | 5550.3 | — |
| large-table.source | 2285.7 | — | 9861.4 | — |
| many-short-nodes.source | 2141.5 | — | 5400.3 | — |
| very-long-line.source | 899.8 | — | 435.5 | — |
| dense-math.wysiwyg | 91.4 | — | 268.1 | — |
| large-table.wysiwyg | 111.0 | — | 482.8 | — |
| many-short-nodes.wysiwyg | 104.1 | — | 272.0 | — |
| normal-prose.wysiwyg | 46.3 | — | 31.6 | — |
| normal-prose.wysiwyg.crlf | 46.0 | — | 31.6 | — |
| very-long-line.wysiwyg | 42.3 | — | 20.7 | — |

基线总表只记了 normal-prose.source 一行，其余行列出供下次对照。2026-09-20 实测的噪声底约 ±8%，normal-prose.source 的变化（−3.0% / −2.6%）落在噪声底内，**不能读成提速**。

### S2 打开面（Rust 侧，日志 `file.open` success 的 `durationMs`，⌘O 对话框）

D1 修复后计时器从对话框关闭后才开始，对话框停留不再计入。

| 语料 | 本次 | 基线 |
|---|---:|---:|
| **large-table.source**（基线总表那一行） | **25 ms** | **93 ms** |
| dense-math.source | 24 ms | 基线 5 份 source 区间 93–166 ms |
| very-long-line.source | 22 ms | 同上 |
| many-short-nodes.source | 35 ms | 同上 |
| normal-prose.source | 40 ms | 同上 |
| WYSIWYG 档 6 份 | 1–4 ms | 6–17 ms |
| exactly-10mib.md（10 485 760 B） | 22 ms | — |

large-table.source 打开时记一条 `editor.large_document.source_tables_withheld`（tableRows 232 982 > 50 000，ADR-0022）。
这个数字**不含前端挂载**（runbook:177-179），前端成本见 S5 与 §3。

### S3a 切文档（代理：`tab.switch` → 下一条 `editor.milkdown.direct.state` editorLoading=false，或 → `editor.large_document.degrade`）

**不是基线方法**（基线用 Web Inspector 点击 → 双 rAF）。WYSIWYG 模式。

| 切到 | 本次 | 基线 | 说明 |
|---|---:|---:|---|
| normal-prose.wysiwyg | 225 ms | 475 ms | |
| very-long-line.wysiwyg | 150 ms | 590 ms | |
| dense-math.wysiwyg | 1 503 ms | 9 449 ms | |
| **large-table.wysiwyg**（基线总表那一行） | **21 ms → 降级** | **55 766 ms** | **不同操作**：基线是挂进 PM，今天被护栏拒绝。点名排除，见 §3 |
| many-short-nodes.wysiwyg | 21 ms → 降级 | 8 183 ms | 不同操作，同上 |

配对切换 normal-prose.wysiwyg ↔ very-long-line.wysiwyg 共 10 次：到 normal-prose 225/205/201/236/204 ms，到 very-long-line 150/155/159/151/158 ms，整体中位约 180 ms（参照：`accae4a` 上 D6 矩阵 5 次中位 577 ms，同为日志代理）。

**Source 档切换**（Source 模式下切到 5 份 9.96 MB 文档，再按 ⌃4 的那一下从按键到被处理的间隔，代理「下一次输入多久被响应」）：dense-math 459 ms、large-table 2 497 ms、many-short-nodes 498 ms、normal-prose 412 ms、very-long-line 731 ms。dense-math.source 第一次切过去时这段间隔为 **8–12 s（n=1，未复现）**，复测为 459 ms，两个都记。

### S3b 关文档（代理：`tab.close` → 下一个 tab 就绪）

| 关掉 | 下一个 tab 与结果 | 基线 |
|---|---|---:|
| dense-math.wysiwyg | many-short-nodes.wysiwyg，降级 41 ms | 8 103 ms |
| many-short-nodes.wysiwyg | 下一个 tab 在 Source，Source 没有就绪日志：**测不了** | 402 ms |
| **very-long-line.wysiwyg**（基线总表那一行） | large-table.wysiwyg，**降级 16 ms** | **79 197 ms** |
| large-table.wysiwyg | normal-prose 在 Source：**测不了**（日志里 5 295 ms 的差值含本人 ⌃4 的按键延迟，作废） | 626 ms |
| normal-prose.wysiwyg（最后一个） | 空窗口，10 ms | 31 ms |

very-long-line.wysiwyg 那一行：基线的 79 197 ms 是**关掉之后下一个 tab（large-table.wysiwyg）的重挂载**，今天同一个下一个 tab 被护栏降级，所以是**不同操作**，不能读成「79 s → 16 ms 的提速」。

另有四个差值（4 291、4 298、9 459、5 295 ms）包含本人 ⌃4 的按键延迟，属测量伪影，已丢弃，不入表。

### S4 主线程最长任务（代理）

release 没有 Timelines，基线的「最长单次任务 79 197 ms」**在 release 上无法以同一方法复现**。代理：

| 观察 | 值 | 来源 |
|---|---|---|
| 冷开 dense-math.source 后 WebContent 忙碌到空闲 | ≤15 s（+12 s 时 99.5%，+15 s 回落） | `ps` 每秒采样 |
| dense-math.source 首次切 tab 的输入延迟 | 8–12 s，n=1，未复现 | 日志 |
| 允许挂载的最长 WYSIWYG mount | 1 573 ms（dense-math.wysiwyg） | 日志 |

本次**没有取 `sample`**，栈顶未知。

### S5 Milkdown/PM 挂载面（⌃2 → ⌃4）

**允许的形态**：mount = `direct.state` true→false；基线口径 = `factory.direct` → `dom.check`（`dom.check` 是 500 ms `setTimeout`，自带约 500 ms 底）。

| 语料 | 时机 | direct.state | factory→dom.check | 基线（factory→dom.check） |
|---|---|---:|---:|---:|
| dense-math.wysiwyg | ⌃4 | 1 573 ms | 1 564 ms | ≈9 000 ms |
| normal-prose.wysiwyg | 打开时 | 196 ms | 494 ms | 501 / 554 ms |
| normal-prose.wysiwyg | ⌃4 | 158 ms | 497 ms | 同上 |
| normal-prose.wysiwyg.crlf | 打开时 | 197 ms | 488 ms | — |
| normal-prose.wysiwyg.crlf | ⌃4 | 167 ms | 499 ms | — |
| very-long-line.wysiwyg | 打开时 | 145 ms | 491 ms | — |
| very-long-line.wysiwyg | ⌃4 | 132 ms | 495 ms | — |

normal-prose 系列的 factory→dom.check 约 490–500 ms，**几乎全是那 500 ms 计时器底**，不能用它跟基线 501/554 ms 比快慢；direct.state 才反映实际挂载。dense-math.wysiwyg 挂完后 CPU 尾巴约 4 s，WebContent RSS 1 698 064 KB。

**降级的形态**（view.mode.change → degrade）：normal-prose.source 34 ms、large-table.source 14 ms、dense-math.source 17 ms、many-short-nodes.source 18 ms、very-long-line.source 14 ms（**trigger=line-length**，未出现 BLOCK 情形）；large-table.wysiwyg、many-short-nodes.wysiwyg 挂载后约 4–7 ms 按 structure 降级。exactly-10mib.md 在 tab.open 后 95 ms 按 structure 降级（elements 218 454）。提示文案目测出现。

**基线总表那一行（large-table.wysiwyg ≈56 000 ms）今天被护栏拒绝，不能比，见 §3。**

### S6 导出面（normal-prose.wysiwyg，日志 `file.export_rendered`）

| 区间 | 本次 | 基线 |
|---|---:|---:|
| ⌘⇧E → `file.export_rendered start` | 30 ms（今天前一条日志是 `ui.shortcut.trigger`，不是 `ui.menu.select`） | 105 ms |
| start → 保存面板弹出 | 211 ms（代理：到 `window.blur`） | **591 ms**（render + sanitize + 拼装） |
| 日志 `durationMs` | **4 ms** | 72 745 ms（含 72 154 ms 停留，D1） |
| htmlSize | 489 770 B | 489 770 B |

口径差异：今天的 `durationMs` 是 Rust 侧重新 sanitize + 拼模板 **+ 写盘**，对话框停留已被排除（`export.rs:148-225`，D1 已修）；基线的 591 ms 是「start → 面板弹出」，不含写盘。两者相近但不是同一区间。211 ms 那段里 Rust 工作至多 4 ms，其余是 rfd 面板本身的弹出。前端的 HTML 正文渲染发生在 `start` 之前，落在 30 ms 那段里。
输出文件里 `id="title"` 出现 **0 次**（只记录，不判断）。导出文件存在 scratchpad，未进仓库。

### 内存（WebContent RSS，`ps`）

| 时点 | 本次 | 基线 |
|---|---:|---:|
| 5 份 Source 文档全开 | 4 356 976 KB | — |
| 切换系列后 | 1 737 616 KB | 2 528 000 → 843 088 KB（切换期间） |
| 全部关闭 | 1 754 848 KB | 1 351 088 KB |
| 空闲 20 s 后 | 1 754 960 KB | **976 448 KB** |
| 全部关闭后空闲 2.5 min（30 s 间隔，CPU 0%） | 1 754 976 → 1 755 296 KB | — |
| 之后再开 3 份 473 KB 文档 | 1 756 064 KB | — |

**全部关闭后 RSS 不回落**，基线则从 1.35 GB 回落到 0.98 GB。按 runbook:204-206，记为**疑似泄漏缺陷，不是性能观察**。保留意见：WebKit 可能只是留着已释放的内存不还给系统，本次没有 GC 控制手段，无法区分；但再开三份文档 RSS 只涨了约 1 MB，说明这块内存会被复用，不是每开一次都在累积。

## 3. 点名排除的形态

每一项都**仍挂在 D6 下**，本文不替任何一项结案。

| 形态 | 为什么排除 / 单独论证 | 今天的状态 | 挂在 |
|---|---|---|---|
| **normal-prose.source（9.96 MB）** | 排序文档 §3.3 注 3 点名；基线里 Lezer TOC 解析 2 067 ms/次（2026-09-18，`3d37b86` 之前） | WYSIWYG 被拒（structure，34 ms）。Source 下打开 40 ms、到 CPU 空闲约 2.5 s；输入一个字符后 WebContent CPU 峰值 15%、无卡顿。**没有拿到 TOC 解析的毫秒数**（release 无 DevTools），只有「不卡」的观察 | D6 |
| **9.96 MB Source 档整体**（门禁二的楔子，无毫秒数，3 h 49 min 不收敛） | ADR-0004 Context / Decision 2；基线 §6.3(B)、§8 | 5 份全部打开、全部在 ≤15 s 内回到空闲（dense-math ≤15 s，very-long-line ≤8 s，many-short-nodes 约 4 s，normal-prose 约 2.5 s，large-table 打开 25 ms 并卸掉表格扩展）。**本次未见不收敛** | D6 |
| **dense-math.source** | 2026-09-21 冷开忙碌 153–183 s；根因 tocService 已于 `3d37b86` 修复 | 冷开 ≤15 s 回到空闲；首次切 tab 一次 8–12 s 输入延迟（n=1，未复现，复测 459 ms）。**没有取 `sample`**，那次 8–12 s 原因未知 | D6 |
| **very-long-line.source** | D6.3(c) 下曾挂起 259 483 ms | WYSIWYG 按 line-length 拒绝（14 ms）；Source 下打开 22 ms、≤8 s 回到空闲（采样起点偏晚，上界不精确） | D6 |
| **large-table.wysiwyg** | 基线 55 766 ms 切换、≈56 000 ms 挂载——D6 本身 | 被护栏降级（21 ms）。**基线路径已不存在，不比较** | D6 |
| **very-long-line.wysiwyg（关闭）** | 基线 79 197 ms 是关闭后下一个 tab 的重挂载 | 下一个 tab（large-table.wysiwyg）今天被降级，16 ms。**不同操作，不比较** | D6 |

## 4. 10 MB 拒绝

| 路径 | 文件 | 结果 |
|---|---|---|
| ⌘O 对话框 | over-10mib.md（10 485 761 B） | `file.open` fail，error `file too large: … size=10485761`；toast「Failed to open file」；**没有新 tab** ✅ |
| `open -a`（等同 Finder 外部打开） | over-10mib.md | `file.open` fail 同上；`file.open.url_param` fail「openDocumentFromPath returned null」；**新建了一个空窗口，没有任何提示**（截图确认窗口为空、无 toast） |
| 拖放 | over-10mib.md | **NOT VERIFIED**——从 Finder 拖需要 Finder 授权，本次未申请 |
| ⌘O 对话框 | exactly-10mib.md（10 485 760 B） | 正常打开（22 ms），95 ms 后按 structure 降级到 Source ✅（严格 `>` 比较，边界正确） |

外部打开的静默失败已经读代码确认：`src/hooks/useDocument.ts:82-92` 的 `openDocumentFromPath` 吞掉非编码类错误、返回 `null`，`useOpenUrlParam.ts` 只记日志不提示。**拒绝本身是对的**（文件没被读入），问题在用户得不到反馈，还要面对一个空窗口。作为新缺陷候选交 delegator 编号，本文不编号。

## 5. 三条硬标准的裁定

| # | 标准 | 裁定 | 依据 |
|---|---|---|---|
| 1 | 每个面都有数字，或有书面的「测不了」理由 | ✅ **达成** | 六面八行都有数字（§2）。拿不到基线口径的地方——切换/关闭的「点击 → 双 rAF」、最长任务的 Timelines、Source 档的就绪时刻——逐一写明了原因（release 无 DevTools；Source 没有就绪日志），并给了标注过的代理值 |
| 2 | 不崩溃、不永久无响应 | ✅ **达成**（附保留） | 11 份语料在两种模式下全部打开、切换、关闭，exactly-10mib 打开后降级到 Source，进程没崩，每次都回到 0% CPU。最长忙碌约 15 s（dense-math.source 冷开），最长单次输入延迟 8–12 s（n=1，未复现）。门禁二时 9.96 MB 档 3 h 49 min 不收敛的情形**本次未出现**。保留：8–12 s 那一次没取 `sample`，原因未知；观察窗口按形态在 15 s – 3 min 之间，不是 runbook 建议的 ≥5 min |
| 3 | 10 MB 拒绝正确 | ✅ **达成**（附缺陷） | 超出 1 字节被拒、恰好 10 MiB 放行，⌘O 与外部两条路径都在 Rust 侧正确拒绝。外部路径没有提示且留下空窗口（§4），拖放路径未测 |

## 6. D6 能否结案——建议

**建议：D6 的性能楔子部分可以结案；另开两条，不要随 D6 一起关掉。**

理由：

- D6 的原始定义是「500 KB 护栏放过了一份会卡 56 s 的 472 KB 文档」。今天那份文档（large-table.wysiwyg）被结构分护栏在 21 ms 内拒绝；同档另一个病态形态（many-short-nodes.wysiwyg）也被拒绝；被放行的三个形态挂载都在 1.6 s 以内（最慢 dense-math.wysiwyg 1 573 ms，基线 ≈9 000 ms）。
- 门禁二卡住的硬标准 1（9.96 MB 档不收敛）本次 5 份全部在 ≤15 s 内收敛。
- ADR-0004 要求的逐面比较与点名排除已经做了（§2、§3）。

需要单独挂账、不随 D6 关闭的：

1. **全部关闭后 WebContent RSS 不回落（约 1.75 GB）**——疑似泄漏，按 runbook 记为缺陷。需要 GC 可控的 debug bundle 才能区分「真泄漏」与「WebKit 留着内存」。
2. **外部打开超过 10 MB 的文件静默失败并留下空窗口**（§4）。

建议关闭前再补一项（可选，不阻塞）：

3. **dense-math.source 首次切 tab 那次 8–12 s 的输入延迟**（n=1）。如果能复现，应取 `sample` 后再判断它是否属于 D6。

## 7. NOT VERIFIED 与未做的事

| 项 | 原因 |
|---|---|
| 切换/关闭/最长任务的基线口径数字 | release 无 DevTools；要拿就得另建 debug bundle（`CARGO_TARGET_DIR=target/gate2-bundle pnpm tauri build --debug --bundles app`） |
| Source 档 tab 的就绪时刻 | Source 没有就绪日志 |
| normal-prose.source 的 TOC 解析毫秒数 | 同上，只有「输入不卡、CPU 峰值 15%」的观察 |
| `sample` 栈顶 | 本次未取 |
| 拖放路径的 10 MB 拒绝 | 需要 Finder 授权，未申请 |
| 插电重测 | 全程电池供电（73% → 55%） |
| 双主题 | 不在本次范围 |

## 8. 证据位置（均在 session scratchpad，未进仓库）

- 日志：`~/.mdpro/mdpro.log`，按字节偏移切片（偏移文件 `perf/off-*`）
- S1 原始输出：`perf/s1.txt`
- CPU / RSS 采样：`perf/{densemath,vll,msn,nps,type,s5dm}-cpu.txt`、`perf/rss-5src.txt`、`perf/rss-idle.txt`
- 护栏判定：`perf/guard-verdicts.txt`
- 退出：`app.quit.commit` drafted=0；drafts 目录（`~/Library/Application Support/mdpro/drafts`）为空；语料 sha256 11/11 与 manifest 一致
