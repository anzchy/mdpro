# 阶段 3 入口门禁二 · 逐步验证手册

配套 [`20260912-plan-markdown-source-consolidation.md`](./20260912-plan-markdown-source-consolidation.md)
（下称**计划 M**）的 **§ 阶段 3 入口门禁二：大文档性能基线**。
那一节说明了**门禁为什么没达成**；本文只回答**怎么一步步把它做完**。

判据与验收口径以计划 M 为准，本文冲突时以计划 M 为准。
证据分级沿用计划 M 的约定：**[实测]** / **[推断]** / **[Codex]**。
跨计划引用一律用小节标题，不用行号；对**源码**的引用带实测日期。

---

## 0. 先读这一节：门禁二的通过判据不是「快」

这是最容易搞错的一点。`baseline-protocol.md` 的 G0 清单 **Performance (E39)** 条明确规定
**FPS / 堆 / 毫秒阈值永不设为阻塞项**。计划 M § 阶段 3 入口门禁二 也重申了一遍：
E39 提过的 `p95 ≤ 8ms`、`单任务 < 50ms` 是**提案，从未采纳**。

所以门禁二的通过条件是 **「每个面都被测过、数字被记录下来」**，不是「数字低于某个阈值」。
看到 80ms 不要去调优，**记下来就行**。

只有三条是真正的硬判据：

| # | 硬判据 | 不满足时 |
|---|---|---|
| 1 | 全程不崩溃、不进入永久无响应 | **阻塞**，第 3 步不可进入 |
| 2 | 10MB 拒绝行为正确（`file.rs:16` `MAX_FILE_SIZE` / `:162` 的拒绝分支，**[实测 2026-09-15]**） | **阻塞** |
| 3 | 六个面各自要么有一个记录在案的数字，要么有一条写明原因的「不可测」 | **未达成**，但不是缺陷 |

其余一切都是**观察**。

---

## 1. 一次性准备

### 1.1 生成语料

```bash
node scripts/perf/generate-corpus.mjs --check
```

生成五形态 × 两档加 CRLF 孪生体共 11 个文件到 `.perf-corpus/`（已 gitignore），
打印每个文件的字节数 / 行数 / 标题数 / SHA-256，并**当场断言计划 M 的基线表**。

**11/11 不全通过就停下**——语料对不上，后面测出来的数和基线表不可比，白测。

Source 档每个约 9.96 MB，**刻意贴着 10MB 硬拒的下沿**：既能过 `open_file` 的门，
又能把压力顶到最大。不要自己改大到 10MB 以上，那测的是拒绝路径不是性能路径。

### 1.2 证明日志是活的 —— **不要跳过这一步**

> **[实测 2026-09-15] 这一步存在的原因。**
> `~/.mdpro/mdpro.log` 的 JSON 键是 **`durationMs`（camelCase）**，不是 `duration_ms`
> ——`log_entry.rs:36` 的 `#[serde(rename_all = "camelCase")]` 对 `LogEntry` 生效。
> 计划 M § 阶段 3 入口门禁二 用「全部 7012 行中 `duration_ms` 出现 0 次」断定导出面从未触发，
> **那个 grep 无论导出过多少次都恒为 0**，证据是无效的。
> 结论本身另有站得住的证据（`file.export_rendered` 事件在 7,144 行中出现 **0 次**，
> 而 **2,293 行确实带 `durationMs`**），但判据必须换掉。
> 教训一般化：**在用「出现 0 次」下任何结论之前，先证明这个查询在阳性情况下会出现非 0 次。**

在 app 里做一个一定会写日志的动作（打开任意一个小文件），然后确认新行落地：

```bash
node -e '
const fs=require("fs"),os=require("os");
const lines=fs.readFileSync(os.homedir()+"/.mdpro/mdpro.log","utf8").trim().split("\n");
const last=JSON.parse(lines[lines.length-1]);
console.log("总行数 =",lines.length);
console.log("最后一行 =",JSON.stringify(last));
console.log("键 =",Object.keys(last).join(","));
'
```

最后一行必须是你刚才那个动作，且键里能看到 `durationMs`。
**看不到就先修日志，别往下走**——后面每一步都靠它取数。

### 1.3 记下起点行号

```bash
wc -l < ~/.mdpro/mdpro.log      # 记为 LOG0
```

之后所有查询都只看 `LOG0` 之后的行，否则会把历史数据当成本次测量。

---

## 2. 渲染面（Rust）—— 唯一可以自动化的一面

计划 M 把这一面标为「可自动化，本次未做」。它不需要真机，因为
`markdown::render_markdown` 与 `markdown::sanitize_html` 都是普通 `pub fn`
（`services/markdown.rs:506` / `:362`，**[实测 2026-09-15]**），可以直接从测试里调。

**[实测 2026-09-15]** 当前 `markdown.rs` 的测试里没有任何大输入用例，
`Cargo.toml` 也没有 bench harness —— 所以这是从零加的。

新建 `src-tauri/tests/perf_render_corpus.rs`（或加到现有测试模块），要点四条：

1. **用 `std::time::Instant`，不要引 criterion。** G0 禁止新依赖（`无新依赖`）。
2. **标 `#[ignore]`。** `.perf-corpus/` 是 gitignore 的，新克隆里没有；
   不标 `#[ignore]` 会让 `cargo test` 在别人机器上直接红。
3. **`render_markdown` 与 `sanitize_html` 分开计时。** 计划 M § 2.5 的结论是
   「导出链路上 ammonia 是真防线」——只有分开测才知道这道防线的成本是多少。
4. **每个文件重复 5 次取中位，首次单独记。** 与基线表同口径（JIT / 正则预热普遍高 1.5–3 倍）。

骨架：

```rust
#[test]
#[ignore = "需要 .perf-corpus/，先跑 node scripts/perf/generate-corpus.mjs"]
fn perf_render_corpus() {
    use std::time::Instant;
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent().unwrap().join(".perf-corpus");
    let mut files: Vec<_> = std::fs::read_dir(&dir).expect("先生成语料")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().map(|x| x == "md").unwrap_or(false))
        .collect();
    files.sort();

    println!("file\tbytes\trender_ms\tsanitize_ms");
    for path in files {
        let md = std::fs::read_to_string(&path).unwrap();
        let mut render = vec![];
        let mut sanitize = vec![];
        for _ in 0..5 {
            let t = Instant::now();
            let html = tauri_app_lib::services::markdown::render_markdown(&md);
            render.push(t.elapsed().as_secs_f64() * 1000.0);
            let t = Instant::now();
            let _ = tauri_app_lib::services::markdown::sanitize_html(&html);
            sanitize.push(t.elapsed().as_secs_f64() * 1000.0);
        }
        render.sort_by(|a, b| a.partial_cmp(b).unwrap());
        sanitize.sort_by(|a, b| a.partial_cmp(b).unwrap());
        println!("{}\t{}\t{:.1}\t{:.1}",
            path.file_name().unwrap().to_string_lossy(),
            md.len(), render[2], sanitize[2]);
    }
}
```

跑：

```bash
cd src-tauri && cargo test --test perf_render_corpus -- --ignored --nocapture
```

> **zsh 陷阱 [实测]：** 本仓的工具链过滤器会重写 `cargo test` 的输出，**即使重定向到文件**。
> 输出看起来被截断时，用 `node -e` 里的 `child_process.spawnSync` 跑并自己打印。

把 11 行结果抄进第 8 节的表。

---

## 3. 打开文档（可从日志直接读）

**[实测 2026-09-15]** `open_file` 的 Success 记录带 `durationMs`，
context 里还带 `fileSizeBytes`（`commands/file.rs:1070-1082`）——所以这一面**不需要 DevTools**。

逐个打开 `.perf-corpus/` 里的 5 个 Source 档文件（⌘O），然后：

```bash
node -e '
const fs=require("fs"),os=require("os");
const LOG0 = Number(process.argv[1]);
fs.readFileSync(os.homedir()+"/.mdpro/mdpro.log","utf8").trim().split("\n")
  .slice(LOG0)
  .map(l=>{try{return JSON.parse(l)}catch(e){return null}})
  .filter(o=>o && o.event==="file.open" && o.status==="success")
  .forEach(o=>console.log(
    String(o.durationMs).padStart(6), "ms  ",
    String(o.context.fileSizeBytes).padStart(9), "B  ",
    o.context.filePath.split("/").pop()));
' "$LOG0"
```

**这个数覆盖什么，不覆盖什么（重要）：** 它只含 Rust 侧的**读取 + 编码检测 + 返回**，
**不含**前端把内容挂进 CodeMirror / Milkdown 的时间。用户感知到的「打开卡了多久」是两者之和，
后半截在第 6 节测。把这两个数分开记，不要相加后只记一个总数。

---

## 4. 切文档 / 关文档（必须 DevTools）

**[实测 2026-09-15] 日志给不出这两个数。** `tab.switch` / `tab.close` 事件确实存在于代码里
（`stores/documentStore.ts:34` / `:91`，`stores/tabStore.ts:242` / `:211`），
但这些调用点**不传 `durationMs`**，而且它们只有一条记录、没有配对的结束事件——
拿不到耗时。另外**本机现有 7,144 行日志里 `tab.switch` 出现 0 次**，
所以先按 § 1.2 的教训做个阳性验证：切一次标签页，确认真的写出了 `tab.switch` 行；
如果没有，说明你的构建里前端日志根本没到文件，那么这一面只能靠 DevTools。

**步骤：**

1. `pnpm tauri dev` 启动（`baseline-protocol.md` § Visual evidence protocol (E5) 规定
   真机证据取自 WKWebView，不是 Chromium）。
2. 在窗口里右键 → 检查元素，打开 Web Inspector。
3. 同时打开 2 个 Source 档大文件（比如 `many-short-nodes.source` 和 `dense-math.source`
   ——基线表里最慢的两个）。
4. 切到 **Timelines / Performance**，点录制。
5. 在两个标签之间来回切换 5 次。停止录制。
6. 记录每次切换从 click 到下一帧渲染完成的墙钟时间，取中位。
7. 关文档同样：录制 → ⌘W 关掉大文件 → 停止 → 记录。

**关文档要额外记一件事：** 关掉之后内存有没有掉回去。计划 M 的基线表显示
`many-short-nodes` 的堆内增量约 198MB；如果关掉标签后 RSS 不回落，那是**泄漏**，
这条**不是**性能观察，而是要单独开缺陷记的。

---

## 5. 主线程阻塞

计划 M 说明了为什么 node 里测不了：node 没有渲染器主线程，同步解析的「阻塞时间」
等于它的墙钟时间，测了是同义反复。真机上它才有独立意义。

沿用第 4 步的那次录制即可，在 Timelines 里看 **Long Tasks**（> 50ms 的任务）：

1. 记录**最长的单个任务**时长，以及它的调用栈顶。
2. 记录一次打开大文件期间 Long Tasks 的**总时长**。
3. 记录期间 UI 是否可交互（能不能滚动、能不能点菜单）。

判据仍是 § 0：**记录，不设阈值**。唯一会阻塞的是「永久无响应」。

---

## 6. Milkdown / PM 挂载

这是计划 M § 10MB 门槛单列验收 后半句问的那件事——
**「文件能打开 ≠ 适合完整挂载成 PM DOM」**——也是六个面里最可能真出问题的一面。

1. 打开一个 Source 档大文件，确认停在 **Source 模式**（⌃2）。
2. 开始录制，按 **⌃4** 切到 WYSIWYG，等它稳定，停止录制。
3. 记录：切换耗时、期间最长任务、切完之后的 RSS。
4. **逐个形态重复。** 特别注意 `very-long-line.source`：
   计划 M 的结论 1 明确说它对 `toc` 解析器**根本不构成压力**（3 行、3.0ms），
   它的风险在 CodeMirror / Milkdown 的行模型——也就是**只有这一步能暴露**。
5. 如果某个形态挂不上去 / 卡死 / 崩溃，**停下来记录，不要重试掩盖**。
   这正是门禁二要找的东西，不是测试事故。

WYSIWYG 档（~471KB）也各跑一遍作对照——E39 的 <500KiB 就是按这一档定的。

---

## 7. 导出面（必须真的导出一次）

**[实测 2026-09-15]** `export.rs` 的埋点是活的：`export_html` 记 `file.export`
（`:52` / `:107`），`export_rendered_html` 记 `file.export_rendered`（`:150` / `:207`），
两者的 Success 都带 `durationMs`。

**菜单路径走的是后者**：`file.export_html` → `App.tsx:587` → `export_rendered_html`。
所以要看的事件名是 **`file.export_rendered`**，不是 `file.export`。

打开一个大文件 → **⌘⇧E** → 存盘，然后：

```bash
node -e '
const fs=require("fs"),os=require("os");
fs.readFileSync(os.homedir()+"/.mdpro/mdpro.log","utf8").trim().split("\n")
  .slice(Number(process.argv[1]))
  .map(l=>{try{return JSON.parse(l)}catch(e){return null}})
  .filter(o=>o && /^file\.export/.test(o.event))
  .forEach(o=>console.log(o.event, o.status, o.durationMs+"ms",
    o.context && o.context.htmlSize ? o.context.htmlSize+"B" : ""));
' "$LOG0"
```

一次都没出现 → 说明菜单项没走到，先查这个，再谈性能。

**顺带确认一件已知缺陷会不会现形：** 导出一篇含 `# Title` 的文档后，
在导出的 HTML 里搜 `id="title"`。按 [ADR-0003](../adr/0003-export-fragment-sanitizer-scope.md)
（判定过程见计划 M § 导出锚点被 DOMPurify 剥离），该缺陷在 WI-3.2 实施前仍在，
今天它应该**搜不到**（只剩 `data-heading-id="title"`）。搜不到是**预期**，
证明该缺陷仍在，不是本次测量出的新问题。

---

## 8. 记录模板

把结果填进这张表，然后整表贴回计划 M § 阶段 3 入口门禁二。

| 面 | 形态 | 档 | 数值 | 工具 | 备注 |
|---|---|---|---:|---|---|
| 渲染 render_markdown | | Source | ms | cargo | |
| 渲染 sanitize_html | | Source | ms | cargo | |
| 打开（Rust 侧） | | Source | ms | 日志 `file.open` | 不含前端挂载 |
| 切文档 | | Source | ms | DevTools | |
| 关文档 | | Source | ms | DevTools | 记 RSS 是否回落 |
| 主线程最长任务 | | Source | ms | DevTools Long Tasks | |
| PM 挂载（⌃2→⌃4） | | Source | ms | DevTools | |
| 导出 | | Source | ms | 日志 `file.export_rendered` | |

每行都要能回答：**跑了几次、取的是中位还是单次、机器是不是插着电**
（笔记本在电池模式下会降频，两次测量不可比）。

---

## 9. 跑完之后必须改什么（**同一个提交**）

CLAUDE.md 的状态规则：**「更新状态是完成工作项的一部分，不是后续跟进」**。
所以测完之后，下面三件事和测量结果进**同一个提交**：

1. ✅ **计划 M § 阶段 3 入口门禁二** —— 把「门禁未达成」的表格换成实测结果，
   并改掉小节标题。**已做**：标题改为「六面已全测，**门禁未达成：硬标准 1 违反**」，
   「仍缺的部分」表改记六面实测结果。
2. ✅ **`20260912-frontend-backend-sequencing-order.md`** —— 阶段 3 的状态行。
   **已做**：第 3 行、§ 入口门禁 2、第 3.0 行三处同步。
3. ✅ **顺手修正计划 M 的失实句**（rule 22「发现即修，同一提交」）。**已做，且比预想的更糟**：
   原句「`duration_ms` 出现 0 次 —— 从未被触发过」有**两处**错，不是一处。
   事件名应为 `file.export_rendered`（不是 `file.export_html`）；
   更要紧的是**字段名**：`LogEntry` 带 `#[serde(rename_all = "camelCase")]`
   （`log_entry.rs:36`），落盘后叫 **`durationMs`**。在日志里搜 `duration_ms`
   **恒为 0 次**，与导出跑没跑过无关 —— 那条否定推断是用一个不存在的字段名做出来的。

---

## 10. 明确**不**属于本门禁的两件事

1. **过期解析结果（红线 3）。** 计划 M 已把它从入口测量项改为**第 3 步的出口条件**，
   理由是该危险今天不存在（TOC 解析纯同步、0 个 `AbortController`），
   而它只会由第 3 步自己创造出来。要求在进入第 3 步之前实测一个进入之后才存在的危险，
   是无法满足的循环依赖。**本手册不测它**，由 WI-3.x 在引入异步解析的同一个提交里补守卫。
2. **毫秒阈值。** 见 § 0。不要因为某个数字难看就去优化——那是第 3 步之后的事，
   现在做只会把基线搅浑，让日后「重测后与基线比较」失去参照。
