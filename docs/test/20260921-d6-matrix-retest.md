# D6 矩阵复测记录

## 0. 测量条件（所有数字的前提）

| 项 | 值 |
|---|---|
| 测量日期 | 2026-09-21 至 2026-09-22（跨午夜，Asia/Shanghai） |
| 机器 | MacBook Pro（Mac16,1），Apple M4 10 核，24 GB 内存 |
| macOS | 26.3.1 (a)，Build `25D771280a` |
| 电源 | `pmset -g batt`：`Now drawing from 'AC Power'`；电量 69%；同时报告 `discharging`。本记录保留命令原文含义，不把它改写成“充电中” |
| 热状态 | `pmset -g therm`：`Error:Failed to get thermal warning level with error code 0xe00002bc`；`Error: Failed to get performance warning level with error code 0xe00002bc`；`Error: No CPU power status with error code 0xe00002bc` |
| 被测分支 / SHA | `frontend-backend-redesign` / `accae4a` |
| 构建命令 | `CARGO_TARGET_DIR=target/gate2-bundle pnpm tauri build --debug --bundles app` |
| 被测构建 | `/Users/jackcheng/Documents/01_Coding/mac-app/mdpro/src-tauri/target/gate2-bundle/debug/bundle/macos/mdpro.app`；护栏开启态产物 mtime `2026-09-21 23:39:21 +0800`；进程命令路径已确认来自该 bundle |
| 最终还原构建 | 同一命令、同一路径；可执行文件 mtime `2026-09-22 00:04:49 +0800`，53,729,592 B |
| 构建结果说明 | `.app` 已生成；命令在 updater 签名阶段因缺少 `TAURI_SIGNING_PRIVATE_KEY` 返回 1，与简报所述一致 |
| 语料 | `.perf-corpus/`，seed `0x5eed`；`node scripts/perf/generate-corpus.mjs --check` 返回 `OK: reproduces plan M's recorded table (11/11)` |
| 护栏开启常量 | `LARGE_DOCUMENT_STRUCTURE_THRESHOLD = 25_000`；`LARGE_DOCUMENT_LINE_LENGTH_THRESHOLD = 1_000_000` |
| 护栏关闭变体 | 两个常量均临时改为 `Number.MAX_SAFE_INTEGER` 后重打同一路径 debug bundle；测后已还原并再次构建 |

本记录只列本轮 `accae4a` 的观测值及测不到的原因。毫秒数不作为阻塞阈值。旧构建 `703a6b4` 的数值只在明确标注旧 SHA 的位置保留作构建间事实陈列，不作为本轮结果。

## 1. 最高优先级回归确认

| 语料 / 操作 | 护栏 | 本轮观测 | UI / 结果 | 结论 |
|---|---|---:|---|---|
| `very-long-line.source.md`（9,961,475 B），打开后进入 WYSIWYG | 开 | `tab.open`→强制 Source **89 ms**；`editorLoading=true`→强制 Source **82 ms**。首次手动 Source→WYSIWYG 后 **17 ms** 回到 Source，其中 loading→回退 **15 ms** | toast 原文为 `This document is too complex for WYSIWYG. Switched to Source mode for performance.`；最终停在 Source；未出现旧构建的数分钟挂起 | **已确认**：ADR-0019 的 `line-length` 触发器在真机 bundle 上拦下该变体 |

上述 17 / 15 ms 只取快捷键驱动产生的第一组日志。随后 computer-use 键盘驱动发生重复触发，后续重复记录全部作废，没有用它们补数。

## 2. 七个未验证格复测结果

| # | 面 | 本轮 `accae4a` 结果 | 工具 / 证据 | 状态 |
|---:|---|---|---|---|
| 1 | 关文档：其余四个 WYSIWYG 语料 | **未验证**。Web Inspector Console 无法可靠取得焦点；继续输入有把计时代码写进编辑器、污染语料的风险。没有用截图往返时间代替毫秒数 | Web Inspector 焦点观察 | **未验证** |
| 2 | Source→WYSIWYG（471 KB），`normal-prose.wysiwyg.md`，护栏开 | `editorLoading=true` `23:50:27.856`；ready `23:50:28.097`；**241 ms**。模式保持 WYSIWYG | JSONL 日志 | **已测** |
| 3 | Source→WYSIWYG（471 KB），护栏关：其余语料 | `dense-math.wysiwyg.md`：loading `23:58:08.868`→ready `23:58:10.452`，**1,584 ms**。其余本轮未验证；一次高成本代表项完成后停止，没有把旧构建数值移入本轮格子 | JSONL 日志 | **部分完成；其余未验证** |
| 4 | Source→WYSIWYG（9.96 MB），护栏开：五个 source 档 | `very-long-line.source.md`：loading→强制 Source **15 ms**，见 §1。`dense-math.source.md` 在仍处于 Source 时先出现长时间忙碌，之后确实观察到护栏回退，但键盘驱动重复触发使该次单动作计时无效。其余三个未验证 | JSONL 日志、`sample`、`ps` | **部分完成；其余未验证** |
| 5 | Source→WYSIWYG（9.96 MB），护栏关：其余四个 | `normal-prose.source.md`：模式切换 `00:02:11.786`；loading `00:02:11.802`→ready `00:02:20.507`，**8,705 ms**；观察 RSS **2,169,472 KB**；20 s 采样主线程高频栈顶为 `JSC::JSObject::countElements()`（717 + 696 次）。另外三个未验证：该代表项已经证明护栏关闭态会产生高内存与长主线程任务，按简报的停止规则不继续重复高成本样本 | JSONL 日志、`sample 18563 20`、`ps` | **部分完成；其余未验证** |
| 6 | 两个大文件来回切 5 次取中位 | 同一窗口在 `normal-prose.wysiwyg.md` 与 `very-long-line.wysiwyg.md` 间切换，click→双 rAF 五次为 **599 / 308 / 580 / 464 / 577 ms**；中位 **577 ms** | Web Inspector Console | **已测** |
| 7 | 9.96 MB source 档标准 (1) | **未验证，不能判定五形态均满足。** `dense-math.source.md` 在 Source 冷开后 WebContent 长时间高 CPU；`tab.open` 为 `23:41:36.808`，最后一次忙碌采样在其后 **153.192 s**，其后 **183.192 s** 的采样已恢复安静，故只能写恢复发生在两次采样之间。观察 RSS 为 795,312 / 714,128 / 730,096 KB，峰值 **2,033,968 KB**，恢复后 1,960,080 KB；20 s 采样栈顶 `operationStringIndexOfWithIndexWithOneChar` 13,117 次。其他四形态没有逐一完成标准 (1) 观察 | JSONL 日志、`sample`、`ps` | **未验证** |

### 2.1 本轮另外取得、但不属于七格缺口的当前构建数字

| 语料 / 操作 | 护栏 | `accae4a` 本轮数字 | 结果 |
|---|---|---:|---|
| `very-long-line.wysiwyg.md` WYSIWYG 挂载 | 开 | **154 ms**（loading→ready） | 放行并恢复 |
| `dense-math.wysiwyg.md` WYSIWYG 挂载 | 关 | **1,584 ms**（loading→ready） | 放行并恢复 |

`dense-math.wysiwyg.md` 的旧构建 `703a6b4` 记录为 13,103 ms；本轮 `accae4a` 为 1,584 ms。两者分别保留，不相互覆盖。

## 3. 预测动作核对

| 语料 | 简报预测 | 本轮实测 | 是否偏离 |
|---|---|---|---|
| `very-long-line.source.md` | `line-length` 降级 | 15 ms 内由 loading 回退到 Source；toast 文案完全一致 | 否 |
| `normal-prose.wysiwyg.md` | allow | 保持 WYSIWYG，241 ms ready | 否 |
| `very-long-line.wysiwyg.md` | allow | 保持 WYSIWYG，154 ms ready | 否 |
| `dense-math.wysiwyg.md` | allow | 护栏关闭代表项保持 WYSIWYG，1,584 ms ready；护栏开启动作未单独重测 | 未形成护栏开启态偏差结论 |
| `dense-math.source.md` | `structure` 降级；简报预期该格为数秒内完成的廉价确认 | 护栏动作最终出现；但在发起 WYSIWYG 前，Source 冷开本身已经忙碌 153.192–183.192 s | **操作成本预测偏离**；不是判据动作偏离 |
| 其余三份 `.source.md` | `structure` 降级 | 未逐份观测 | **未验证**，不写成符合或偏离 |

## 4. D6 状态

- ADR-0019 的最高优先级回归项已在 `accae4a` 真机 bundle 上确认：`very-long-line.source.md` 被最长行触发器拦下，loading→Source 为 **15 ms**，没有重现旧构建 `703a6b4` 的 259,483 ms WYSIWYG 挂载。
- 七格中，第 2、6 格完成；第 3、4、5 格仅得到部分形态；第 1、7 格仍是未验证。未验证项没有被升级成通过。
- ADR-0004 标准 (1) **本轮仍不能判定真正满足**：唯一做了长窗口观察的 `dense-math.source.md` 最终恢复，但恢复只定位在 `tab.open` 后 153.192–183.192 s 之间，且其余四个 9.96 MB 形态没有逐一验证。
- **D6 保持未结案，不标 `✅`。** 本记录只完成测量与未验证原因记录，不执行“点名排除”判断。

## 5. 还原与工作区

- 临时护栏关闭变体已结束；两个常量已还原为 `25_000` 与 `1_000_000`。
- 还原后已再次运行 `CARGO_TARGET_DIR=target/gate2-bundle pnpm tauri build --debug --bundles app`，指定路径上的 `.app` 已被正式阈值版本覆盖。
- `git diff -- src/utils/largeDocumentGuard.ts` 为空，`git diff --check` 通过。
- 本轮没有修改判据、阈值、文案或 ADR；没有提交、没有推送。
- 工作区仍有任务开始前已存在的 `.claude/scheduled_tasks.lock` 修改；本轮未触碰。除此之外，本轮新增文件仅为本记录。

---

## 6. 审核附注（Claude，2026-09-22）

本节由复测执行者以外的一方补写。第 0–5 节保持原样未改。

### 6.0 已独立核实的部分

| 核实项 | 方法 | 结果 |
|---|---|---|
| 表头 SHA 与仓库一致 | `git rev-parse --short HEAD` | `accae4a`，一致 |
| 护栏常量已还原 | `grep` + `git diff -- src/utils/largeDocumentGuard.ts` | `25_000` / `1_000_000`，零 diff |
| 工作区可用 | `pnpm vitest run tests/large-document-guard*.test.ts` | 64 例全绿（51 + 13） |
| §2 各项时间差自洽 | 由记录中的时间戳复算 | 241 ms、1,584 ms、8,705 ms 均与时间戳相符 |
| §2 第 6 格中位数 | 对 599 / 308 / 580 / 464 / 577 排序取中 | 577 ms，正确 |
| 记录纪律 | 通读 | 未验证项未被升级为通过；D6 未标 ✅；旧构建数字未挪入本轮格子；电源状态的自相矛盾原文照录 |

以下两条是记录本身没有点出的问题，不是对上述观测值的否定。

### 6.1 第 3 格的代表项选择不能回答该格的问题

`dense-math.wysiwyg.md` 的结构分为 20,664、最长行为 63，**两个阈值都不超**，因此它在护栏开启态与关闭态下**都是 allow**。对一份被放行的文档，护栏的全部作用只是多做一趟 471,942 字符的前向扫描，代价在亚毫秒量级。换言之，对这个文件而言「护栏关」不是一个独立的实验条件，它与「护栏开」是同一条代码路径。

471 KB 档里「护栏关」真正构成独立条件的只有会降级的两份——`large-table.wysiwyg.md` 与 `many-short-nodes.wysiwyg.md`——而它们恰好是旧构建 `703a6b4` 已经测过的 11,394 ms 与 8,123 ms。因此第 3 格在本轮之后**剩余的真实缺口是「在 `accae4a` 上重测这两份降级语料的护栏关闭态」**，而 1,584 ms 这个数字回答的不是这个问题。

该格的状态「部分完成；其余未验证」在字面上成立，但「部分完成」的那一部分落在了缺口之外。

附带一个未解释的异常：同一条代码路径上，旧构建 `703a6b4` 记为 13,103 ms，本轮 `accae4a` 记为 1,584 ms，相差 8.3 倍。`accae4a` 相对 `703a6b4` 只增加了判据的第二个计数器与文档，不含任何能让 Milkdown 挂载提速 8 倍的改动。最可能的解释是冷挂载与热挂载的差异，或两次计时的锚点不同。记录把两个数字并列保留是正确的，但把它归类为「构建间事实陈列」，掩盖了它其实是同一路径上的一处待解释偏差。

### 6.2 153–183 s 的挂起发生在护栏设计上不覆盖的面

`src/utils/largeDocumentGuard.ts:260` 的第一条语句是：

```ts
if (input.viewMode !== "wysiwyg") return { action: "allow" };
```

护栏只在进入 WYSIWYG 时判定。§2 第 7 格观测到的 `dense-math.source.md` 冷开忙碌，发生在**文档仍处于 Source 模式**时，此时护栏必然返回 allow 且不做任何事。20 s 采样的栈顶是 `operationStringIndexOfWithIndexWithOneChar`（13,117 次）——一个字符串扫描循环，而不是 WYSIWYG 路径上的 `JSC::JSObject::countElements()`。

记录把这一条归入 §3 的「操作成本预测偏离」。这一归类低估了它：它不是简报对工作量的预估失准，而是**一个现有护栏架构上无法覆盖的性能面**。ADR-0016 与 ADR-0019 冻结的判据只在 WYSIWYG 入口处生效，对 Source 模式下打开 9.96 MB 文档所付出的代价没有任何作用。

这使 D6 未结案的理由比 §4 写的更硬。§4 的表述是「没测全」；实际情况还包括「已测到的部分指向一个判据管不到的面」。ADR-0004 标准 (1) 正是针对 9.96 MB source 档，因此在为 3.8 出口复测做「点名排除」判断时，这一面必须被单独论及，而不能与 WYSIWYG 护栏的表现合并叙述。

### 6.3 这两条不改变的结论

- ADR-0019 的最高优先级回归确认成立：`very-long-line.source.md` 确实被 `line-length` 触发器拦下，loading→Source 为 15 ms，没有重现 259,483 ms。
- D6 保持未结案、不标 `✅`。上述两条只会加强这一判断，不会削弱它。

## 7. 第 7 格根因（Claude，2026-09-22，晚于 §6）

**§6.2 的结论错了，本节改正它。** §6.2 原样保留——记录里一条当时看起来成立的推断，
被后来的测量推翻，这件事本身是证据，编辑掉它就毁掉了证据。

### 7.1 §6.2 哪一句错了

§6.2 说对了两件事：`largeDocumentGuard.ts:260` 确实只在进入 WYSIWYG 时判定；
20 s 采样的栈顶确实是 `operationStringIndexOfWithIndexWithOneChar`，一个字符串扫描循环。

错的是从这两件事推出的第三句——「**一个现有护栏架构上无法覆盖的性能面**」。
那一步把「护栏够不着这条路径」直接读成了「这条路径上的代价是固有的、只能由判据来挡」。
栈顶那个函数名当时就摆在记录里，它是 JSC 对 `indexOf("\n", i)` 的快路径——
即是说，那 20 s 采样直接指着我们自己的代码，而 §6.2 把它归给了 WebKit。

### 7.2 实际的根因

`src/services/tocService.ts` 的 `parseHeadingsFromContent` 为每个标题计算行号时写的是
`countNewlines(forParse.slice(0, node.from))`：对**每一个**标题，把整段前缀切出来、从头扫一遍。
代价是 文档大小 × 标题数。

`dense-math.source.md` 有 **70,886 个标题**、9,110,964 字符，约 3.5e11 次字符读取。

它出现在 Source 模式，是因为**大纲不分模式都解析**：唯一没有护栏的那条路径，
同时也是背着我们自己那个二次方的那条路径。两件事在这一格里重合，§6.2 只看见了前一件。

### 7.3 同机对照测量

同一台机器、同一批 offset、逐条比对输出校验和：

| 语料 | 行号计算（旧） | 行号计算（新） | 输出一致 |
|---|---|---|---|
| `dense-math.source.md`（9,110,964 字符，70,886 标题） | 152,551 ms | 24 ms | 是 |
| `normal-prose.source.md`（7,564,792 字符，3,007 标题） | 1,348 ms | 11 ms | 是 |

152.5 s 落在本记录 §2 第 7 格的 153–183 s 窗口内。
修复后 `dense-math.source.md` 的整趟大纲解析为 1,055 ms。
`many-short-nodes.source.md` 标题数为 0，与它从未在这一格停顿相符——这是该归因的一个独立旁证。

已修，提交 `3d37b86`（`src/utils/lineCounter.ts` 单游标一趟扫完；
「一趟」这条不变量由 `tests/line-counter.test.ts` S1 用扫描字符数钉住，不用毫秒，E39/G0）。

### 7.4 这**不**意味着什么

- **没有做真机整机复测。** 上表测的是行号计算这一个组件，在 Node 里跑的。
  153–183 s 里还剩多少，未知。把本节读成「第 7 格已解决」是不成立的。
- **§6.2 关于护栏覆盖面的那句话仍然成立**：Source 模式这一面依然没有任何判据。
  改变的只是「已测到的这个数字证明该面需要判据」这个论证——它不再成立，
  因为那个数字的主导成分是一个 bug。该面缺判据仍是事实，但现在它是一个**未测量**的缺口，
  不是一个已测量的缺口。
- **对 3.8 出口复测的影响**：§6.2 要求把这一面「单独论及」。这条要求不变，但论述的内容变了——
  要论的是「移除二次方之后，这一面还剩多少代价」，而这需要先有一次真机测量。
- **D6 仍不标 `✅`。**

### 7.5 记录层面的教训

这一格的原始记录里已经有了指向真因的证据（栈顶函数名），但归因写成了 WebKit。
采样栈顶如果落在一个能被识别为自有代码的符号上，应当先去代码里找那个循环，
再断言代价是平台固有的。
