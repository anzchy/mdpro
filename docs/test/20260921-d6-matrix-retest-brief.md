# D6 矩阵复测简报（交给 Codex 执行）

**建立日期**：2026-09-21
**被测分支**：`frontend-backend-redesign`
**执行者**：Codex（真机、本地 macOS）
**上游记录**：[`docs/test/20260921-d5-d6-real-device-measurement.md`](./20260921-d5-d6-real-device-measurement.md)
**相关决策**：[ADR-0004](../adr/0004-gate2-waiver-for-stage3-entry.md)、[ADR-0016](../adr/0016-large-document-guard-predicate-is-a-source-structure-score.md)、[ADR-0019](../adr/0019-large-document-guard-adds-a-longest-line-trigger.md)

---

## 1. 这次复测要关什么、不能关什么

### 1.1 它要关的

2026-09-21 的真机测量把 D6 矩阵测出了**七个空格**（见 §5）。这次复测只做一件事：
**把那七个格填成真实观测值**，并顺带确认 ADR-0019 修掉的那次保护倒退在真机上确实修掉了。

### 1.2 它**不能**关的

**D6 这一行不得标 ✅，无论这次结果多好看。**

ADR-0004 把 D6 的关闭条件绑在「3.8 出口复测」上，而 ADR-0004 的原文要求是：
3.8 必须**逐面比较**，并**点名排除**那些卡死的形态（wedged shapes），而不是比较聚合值。

本简报只覆盖「逐面」的测量部分。**「点名排除」是一个判断动作，不是一次测量**，它需要在计划层面写明哪些形态被排除、依据是什么。所以：

- 把七个格填满 → 这次复测的交付物；
- 把 D6 标 ✅ → **不在授权范围内，禁止执行**。

### 1.3 一个必须记住的教训

上一次 D6.3(c) 之所以带着一个保护倒退上线，不是因为测试不绿，而是因为：

1. 单元测试全绿；
2. 引用了一个「实测 0 ms」的数字——**那个 0 ms 属于 471,862 B 的 `.wysiwyg` 变体，被误当成 9,961,475 B 的 `.source` 变体**，两者差 21 倍；
3. `.source` 变体当时根本**没有被测过**。

实测结果：那份文档冷开挂起 **259,483 ms（4 分 19 秒）**，UI 至少 120 s 不可读。

**所以本次复测的第一纪律是：不得引用未在本轮亲自观测到的数字，不得跨构建、跨日期借用旧数字，不得把一个变体的数字安在另一个变体头上。**

---

## 2. 硬前提（不满足就不要开始测）

### 2.1 必须重新构建

上游记录测的是 `703a6b4`。**当前 HEAD 是 `9bb1422`**，中间落地了 ADR-0019（新增最长行判据）。
**记录里的构建已经过期，必须重打。**

```bash
cd /Users/jackcheng/Documents/01_Coding/mac-app/mdpro
git rev-parse --short HEAD        # 记下来，写进记录
CARGO_TARGET_DIR=target/gate2-bundle pnpm tauri build --debug --bundles app
```

**关于退出码 1**：这条命令在缺少 `TAURI_SIGNING_PRIVATE_KEY` 时会返回 1。
**失败点是 updater 签名，不是 `.app` 构建。** 判断构建是否成功看产物，不看退出码：

```bash
ls -l src-tauri/target/gate2-bundle/debug/bundle/macos/mdpro.app/Contents/MacOS/
```

### 2.2 必须测 bundle，不能测 dev server

`.claude/skills/gui-acceptance/SKILL.md:44` 原文：

> **`pnpm tauri dev` does not work with computer use. Neither does `pnpm dev`.**

只能启动上面那个 `.app`。启动后**必须**用 `ps` 确认进程确实来自构建路径（skill 检查项 `:398`）：

```bash
ps -Ao pid,rss,%cpu,command | grep -i mdpro | grep -v grep
```

输出里的 command 必须含 `target/gate2-bundle/debug/bundle/macos/mdpro.app`。
**如果指向别的路径，本轮全部数据作废**——那说明测的是另一个构建。

### 2.3 语料必须自检

```bash
node scripts/perf/generate-corpus.mjs --check
```

必须返回 `OK: reproduces plan M's recorded table (11/11)`。语料目录 `.perf-corpus/`，seed `0x5eed`，11 个 `.md` + `manifest.json`。

### 2.4 记录环境

开测前抓一次，写进记录表头：机型、内存、macOS 版本与 Build、`pmset -g batt` 的电源状态与电量、`git rev-parse --short HEAD`、bundle 的 mtime。

> 上游记录里 `pmset -g therm` 报 `0xe00002bc` 取不到值。取不到就照抄错误原文，**不要留空，也不要写「正常」**。

---

## 3. 判据预测表（可证伪，测之前先看）

ADR-0019 之后的判据是**两个触发器，任一超限即降级**：

| 量 | 常量 | 阈值 | 方向 |
|---|---|---:|---|
| 结构分 `score = newlines + (pipes − tableRowStarts)` | `LARGE_DOCUMENT_STRUCTURE_THRESHOLD` | 25,000 | `<=` 放行 |
| 最长行 `longestLine`（UTF-16 码元） | `LARGE_DOCUMENT_LINE_LENGTH_THRESHOLD` | 1,000,000 | `<=` 放行 |

下表由判据的独立复算脚本算出，**该脚本先复现了计划 M 已记录的 5 个结构分（5/5 全中）才被采信**：

| 语料文件 | 字节 | 结构分 | 最长行 | 预测动作 | trigger |
|---|---:|---:|---:|---|---|
| `dense-math.source.md` | 9,961,596 | 425,316 | 63 | degrade-to-source | `structure` |
| `dense-math.wysiwyg.md` | 471,942 | 20,664 | 63 | **allow** | — |
| `large-table.source.md` | 9,961,503 | 1,164,910 | 46 | degrade-to-source | `structure` |
| `large-table.wysiwyg.md` | 471,880 | 57,190 | 45 | degrade-to-source | `structure` |
| `many-short-nodes.source.md` | 9,961,474 | 637,940 | 16 | degrade-to-source | `structure` |
| `many-short-nodes.wysiwyg.md` | 471,867 | 32,657 | 15 | degrade-to-source | `structure` |
| `normal-prose.source.md` | 9,961,944 | 54,126 | 353 | degrade-to-source | `structure` |
| `normal-prose.wysiwyg.crlf.md` | 476,114 | 2,574 | 352 | **allow** | — |
| `normal-prose.wysiwyg.md` | 473,540 | 2,574 | 351 | **allow** | — |
| `very-long-line.source.md` | 9,961,475 | 3 | 7,583,742 | degrade-to-source | **`line-length`** |
| `very-long-line.wysiwyg.md` | 471,862 | 3 | 359,285 | **allow** | — |

### 3.1 这张表对工作量的影响（重要）

**五个 9.96 MB 的 `.source` 语料现在全部降级。** 其中四个靠 `structure`（它们本来就远超 25,000），**只有 `very-long-line.source.md` 是靠 ADR-0019 新加的 `line-length`**。

含义：**那五格不再是「多分钟挂起计时」，而是廉价的「护栏是否触发」确认**——打开、按 ⌃4、看是否立刻弹 toast 并停在 Source。每格应在数秒内完成。

**真正还需要真机计时的，只有那几个 allow 的 `.wysiwyg` 档**（`dense-math`、`normal-prose`、`normal-prose.crlf`、`very-long-line`）。

### 3.2 回归确认项（新增，最高优先级）

`very-long-line.source.md` 在旧判据下被放行并挂起 **259,483 ms**。
**现在它必须立刻降级。** 这是 ADR-0019 存在的唯一理由，**必须单独观测并单独记录**。

如果它仍然进入 WYSIWYG 并挂起 → **这是 BLOCK 级缺陷**，立即停止后续测量并报告。

### 3.3 预测与实测不符时怎么办

**以实测为准，把偏差写进记录，不要修改预测表去迎合实测，也不要修改代码去迎合预测。**
偏差本身是发现，掩盖偏差是这份文档要防的事。

---

## 4. 测量方法：四件仪器，各管一段

| 仪器 | 测什么 | 怎么用 |
|---|---|---|
| **Web Inspector Console** | 交互事件 → 双 rAF 的墙钟毫秒；CSP 原文 | 在 Console 里下计时代码，事件触发打点，`requestAnimationFrame` 套两层后打点 |
| **应用 JSONL 日志** | Milkdown `loading → ready` | `tail -f ~/.mdpro/mdpro.log \| jq .`，看事件 `editor.milkdown.direct.state`，取 `context.editorLoading` 由 `true` 变 `false` 的两条时间戳之差 |
| **`sample`** | 挂起时栈顶在哪个函数 | `sample <pid> 20 -f /tmp/xx.txt`，读 top-of-stack |
| **`ps`** | CPU% 与 RSS | `ps -Ao pid,rss,%cpu,command \| grep mdpro` |

### 4.1 绝对禁止：用截图计时

**截图往返是秒级的，不能用来产生毫秒数字。**

- 155 ms 这一档，截图连量级都给不对；
- 在 120 s 的冻结窗口里，截图**无法区分「冻住了」和「还在慢慢跑」**。

computer use 可以用来**驱动交互**（切模式、开文件），**不得用来产生任何一个数字**。数字只能来自上表四件仪器。

### 4.2 菜单栏被占用时的绕法

`gui-acceptance` skill 记录了一个已知阻塞：iBar Pro 占用菜单栏坐标。

- **不要去跟它抢，也不要申请访问那个工具。**
- 有键盘快捷键的一律用快捷键：**⌃2 = Source，⌃4 = WYSIWYG，⌘⇧L = 侧栏**。
- 确实只能走菜单、又确实被挡住的，把对应判据记成 **NOT VERIFIED**，写明原因。

### 4.3 安全红线（来自 skill，不可协商）

- **不得为了让测试跑通而修改系统设置或安全设置。**
- **不得用 computer-use 工具点击任何网页链接。**

---

## 5. 矩阵里的七个未验证格

上游记录 §4「逐面完成度」列出的空格。**这是这次复测的全部作业范围。**

| # | 面 | 具体缺什么 | 预计成本 |
|---|---|---|---|
| 1 | 关文档 | 其余**四个** WYSIWYG 语料的关闭耗时（已测：`very-long-line.wysiwyg` 13,141 ms，RSS 1,135,696 KB） | 中 |
| 2 | Source→WYSIWYG（471 KB 档） | `normal-prose.wysiwyg` 护栏开启态未验证 | 低 |
| 3 | Source→WYSIWYG（471 KB 档） | 护栏关闭态：其余语料未验证 | 高（每格分钟级） |
| 4 | Source→WYSIWYG（9.96 MB 档） | 护栏开启态**五个全部**未验证 | **低**（见 §3.1，现在全是「是否触发」确认） |
| 5 | Source→WYSIWYG（9.96 MB 档） | 护栏关闭态：其余四个未验证 | 高 |
| 6 | 两个大文件来回切 5 次取中位 | 完全未验证 | 中 |
| 7 | 9.96 MB source 档标准 (1) | 完全未验证 | 中 |

### 5.1 已有数字（不要重测，但要注明是旧构建的）

上游记录 §3.1 / §3.2 / §3.3 已有的观测（**均测于 `703a6b4`**）：

| 语料 | 护栏开 | 护栏关 | 采样栈顶 | RSS |
|---|---:|---:|---|---:|
| `large-table.wysiwyg` | 9 ms（降级到 Source） | **11,394 ms** | `countElements` 7,585 | 1,027,280 KB |
| `many-short-nodes.wysiwyg` | 73 ms | **8,123 ms** | `countElements` 1,824 + `nextListItemHelper` 1,485 | 585,840 KB |
| `very-long-line.wysiwyg` | **155 ms**（放行） | 未验证 | — | — |
| `dense-math.wysiwyg` | **13,103 ms** | 未验证 | — | — |
| `normal-prose.wysiwyg` | 未验证 | 未验证 | — | — |
| `very-long-line.source`（旧判据放行） | **259,483 ms** loading→ready | — | `countElements` 11,175 | 469,728–967,824 KB 振荡 |

**这些数字来自上一个构建。** 如果这次复测在 `9bb1422` 上重测到其中某格并得到不同的值，**两个都记，注明构建 SHA**，不要覆盖旧值。

### 5.2 关闭护栏的正确做法（ADR-0019 之后变了）

上游记录里关闭护栏只改了一个常量：

```ts
LARGE_DOCUMENT_STRUCTURE_THRESHOLD = Number.MAX_SAFE_INTEGER
```

**这样做现在已经不够了。** ADR-0019 加的最长行判据会照样拦下 `very-long-line.source.md`，
于是「护栏关闭态」根本没关掉，测出来的数字会是一个假的、很快的降级。

**护栏关闭变体必须同时放开两个常量**，在 `src/utils/largeDocumentGuard.ts`：

```ts
export const LARGE_DOCUMENT_STRUCTURE_THRESHOLD = Number.MAX_SAFE_INTEGER;
export const LARGE_DOCUMENT_LINE_LENGTH_THRESHOLD = Number.MAX_SAFE_INTEGER;
```

**测完必须还原为 `25_000` 与 `1_000_000`，并用 `git diff` 确认工作区干净。** 还原动作要写进记录。

> 护栏关闭态的测量会让 UI 冻结数分钟，属于预期行为，不是崩溃。
> 上游记录在单次严重样本后就停止了重试；**如果这次也遇到不可恢复的挂起，允许停止该格并记「未验证 + 停止原因」，不要硬扛。**

---

## 6. 记录规则（这一节是硬约束）

1. **「未验证」是合法结论，且不得被悄悄升级成 pass。**
   来自 `gui-acceptance` skill §8 的原文要求。测不到就写测不到，并写明为什么测不到。
2. **不得填估算值、推算值、「约」「大概」。** 没有观测就是没有观测。
3. **不得跨构建、跨日期借用数字。** 每个数字旁边标注它属于哪个 SHA。
4. **不得把一个变体的数字安在另一个变体头上。** 这正是上一次翻车的原因。
5. **毫秒数不作阻塞阈值**（E39 / G0）。它们是证据，不是门禁。
6. **D6 不得标 ✅**（见 §1.2）。
7. 发现的缺陷不要顺手改。按 `gui-acceptance` §10，走 `/tdd-guardian:plan` → `:design-tests` → `:implement`，带一个先红后绿的回归测试。

---

## 7. 交付物

1. **测量记录**：新建 `docs/test/<日期>-d6-matrix-retest.md`，或在上游记录里新增一节并标明本轮 SHA。
   格式照抄上游记录：表头写测量条件，正文一格一行，未验证的格明确写「未验证」+ 原因。
2. **回归确认结论**：`very-long-line.source.md` 是否已被 `line-length` 拦下（§3.2）。
3. **预测偏差清单**：§3 预测表里与实测不符的行，逐条列出。
4. **工作区状态**：确认护栏常量已还原、`git diff` 干净。
5. **不要提交，不要推送**，除非明确被要求。

---

## 8. 可直接复制的完整 Prompt

> 以下整段可直接交给 Codex。

---

你要在真机上为 macOS 应用 mdpro 完成一次性能矩阵复测（代号 D6）。仓库在 `/Users/jackcheng/Documents/01_Coding/mac-app/mdpro`，分支 `frontend-backend-redesign`。完整背景在 `docs/test/20260921-d6-matrix-retest-brief.md`，先读它，本 prompt 与它冲突时以它为准。

**任务边界**

只做测量与记录。不要改产品代码（唯一例外是下文「护栏关闭变体」描述的两个阈值常量的临时改动，且必须还原）。**不得把计划文档里的 D6 标成 ✅**——ADR-0004 要求 3.8 出口复测「逐面比较并点名排除卡死形态」，本次只覆盖「逐面测量」，不覆盖「点名排除」这个判断动作。

**开始前的硬前提**

1. `git rev-parse --short HEAD` 记下 SHA。当前应为 `9bb1422` 或更新；上游记录测的是 `703a6b4`，已过期。
2. 重新构建 debug bundle：`CARGO_TARGET_DIR=target/gate2-bundle pnpm tauri build --debug --bundles app`。这条命令会因缺少 `TAURI_SIGNING_PRIVATE_KEY` 返回 1，**那是 updater 签名失败，不是构建失败**；看 `src-tauri/target/gate2-bundle/debug/bundle/macos/mdpro.app` 是否生成来判断。
3. 只测这个 `.app`。`pnpm tauri dev` 和 `pnpm dev` 都不可用。启动后用 `ps -Ao pid,rss,%cpu,command | grep -i mdpro` 确认进程路径确实是这个 bundle；不是就作废重来。
4. `node scripts/perf/generate-corpus.mjs --check` 必须返回 `OK: reproduces plan M's recorded table (11/11)`。
5. 记录机型、内存、macOS 版本与 Build、`pmset -g batt` 电源状态、HEAD SHA、bundle mtime。

**测量仪器（只能用这四件）**

- Web Inspector Console：交互事件到双 `requestAnimationFrame` 的墙钟毫秒。
- 应用 JSONL 日志 `~/.mdpro/mdpro.log`：事件 `editor.milkdown.direct.state`，取 `context.editorLoading` 从 `true` 变 `false` 的两条时间戳之差，即 Milkdown loading→ready。
- `sample <pid> 20`：挂起时的栈顶函数。
- `ps`：CPU% 与 RSS。

**绝对禁止用截图计时。** 截图往返是秒级的：155 ms 那一档量级都会错，而在 120 秒的冻结窗口里截图无法区分「冻住」和「还在慢慢跑」。computer use 只用来驱动交互，不产生任何数字。

**交互约束**

菜单栏被 iBar Pro 占用，不要跟它抢，也不要申请访问该工具。切换视图一律用快捷键：⌃2 = Source，⌃4 = WYSIWYG，⌘⇧L = 侧栏。确实只能走菜单又被挡住的，记 NOT VERIFIED 并写明原因。不得修改系统或安全设置来绕开阻塞。不得用 computer-use 点击任何网页链接。

**判据现状**

护栏有两个触发器，任一超限即从 WYSIWYG 降级到 Source：结构分 `newlines + (pipes − tableRowStarts)` 阈值 25,000（`<=` 放行）；最长行 UTF-16 码元数阈值 1,000,000（`<=` 放行）。简报 §3 有全部 11 个语料的可证伪预测表，**测之前先读**。要点：五个 9.96 MB 的 `.source` 语料现在全部降级，其中四个靠结构分，只有 `very-long-line.source.md` 靠最长行。所以那五格是廉价的「是否触发」确认，不是分钟级计时。预测与实测不符时以实测为准，把偏差列出来，不要改预测表也不要改代码去迎合。

**最高优先级的单项：回归确认**

`very-long-line.source.md`（9,961,475 B，4 行，结构分 3，最长行 7,583,742）在旧判据下被放行并冷开挂起 **259,483 ms**、UI 至少 120 秒不可读。现在它**必须立刻降级**。单独观测、单独记录。如果它仍进入 WYSIWYG 并挂起，这是 BLOCK 级缺陷：停止后续测量，立即报告。

**作业范围：七个未验证格**

见简报 §5 的表：① 其余四个 WYSIWYG 语料的关文档耗时；② `normal-prose.wysiwyg` 护栏开启态；③ 471 KB 档护栏关闭态的其余语料；④ 9.96 MB 档护栏开启态五个全部；⑤ 9.96 MB 档护栏关闭态其余四个；⑥ 两个大文件来回切 5 次取中位；⑦ 9.96 MB source 档标准 (1)。简报 §5.1 列出了已有的旧构建数字，那些不用重测；若重测到不同值，两个都保留并各自标注 SHA。

**护栏关闭变体的关键改动**

上游记录只把 `LARGE_DOCUMENT_STRUCTURE_THRESHOLD` 改成 `Number.MAX_SAFE_INTEGER`。**现在这样不够**——最长行判据会照样拦截，护栏其实没关，会测出一个假的快速降级。必须在 `src/utils/largeDocumentGuard.ts` 同时把 `LARGE_DOCUMENT_STRUCTURE_THRESHOLD` 和 `LARGE_DOCUMENT_LINE_LENGTH_THRESHOLD` 都改成 `Number.MAX_SAFE_INTEGER`，测完还原为 `25_000` 和 `1_000_000`，并用 `git diff` 确认工作区干净。还原动作写进记录。护栏关闭态会让 UI 冻结数分钟，这是预期行为；遇到不可恢复的挂起，允许停止该格并记「未验证 + 停止原因」，不要硬扛。

**记录纪律**

「未验证」是合法结论，不得悄悄升级为 pass。不得填估算值或「大概」。不得跨构建、跨日期借用数字，每个数字标注所属 SHA。不得把一个变体的数字安在另一个变体头上——上一次翻车正是因为把 471,862 B 的 `.wysiwyg` 变体的「0 ms」误当成了 9,961,475 B 的 `.source` 变体，两者差 21 倍，而 `.source` 变体当时根本没测过。毫秒数是证据，不作阻塞阈值。

**交付**

新建 `docs/test/<日期>-d6-matrix-retest.md`，格式照抄 `docs/test/20260921-d5-d6-real-device-measurement.md`：表头写测量条件，正文一格一行，未验证的格写明原因。另外交付三项：回归确认结论、预测偏差清单、工作区还原确认。不要提交，不要推送。

如果发现新缺陷，不要顺手修。按 `gui-acceptance` skill §10 走 `/tdd-guardian:plan` → `:design-tests` → `:implement`，带一个先红后绿的回归测试。
