# 阶段 3 入口门禁二 · 实测记录

> 配套文档：`20260915-stage3-gate2-runbook.md`（执行手册）。
> 本文件只记录**测到的数字**和**测不到的原因**，不做调优建议。
> 门禁二的通过条件是「每个面都被测过、数字被记录下来」，不是「数字低于阈值」。

## 0. 测量条件（所有数字的前提）

| 项 | 值 |
|---|---|
| 日期 | 2026-09-15 |
| 机器 | Apple M4 / 24 GB / macOS 26.3.1 (Darwin 25.3.0) |
| **电源** | **电池供电，91% 放电中 — 没有插电** |
| 热节流 | `pmset -g therm`：无热警告、无性能警告记录 |
| 被测构建 | `pnpm tauri build --debug` 产物，`com.mdpro.app`，`target/gate2-bundle/debug/bundle/macos/mdpro.app` |
| 为什么用 debug bundle | 需要同时具备**可授权的 bundle id**（computer use）和 **Web Inspector**（`debug_assertions`）。未打包的 dev 二进制 `bundleID=[NULL]`，无法授权；release 构建没有 `devtools` feature。 |
| 语料 | `.perf-corpus/`，11/11 齐全，seed `0x5eed` |

> **电池模式是本次记录最大的可比性限制。** 笔记本在电池下会降频，
> 这批数字与任何插电状态下的测量都不可直接比较。重测时必须插电。

## 1. 六个面总表

| 面 | 形态 | 档 | 数值 | 跑几次 | 中位/单次 | 工具 |
|---|---|---|---:|---|---|---|
| 渲染 `render_markdown` | normal-prose | Source (9.96 MB) | 998.9 ms | 5 | **中位** | cargo |
| 渲染 `sanitize_html` | normal-prose | Source (9.96 MB) | 680.3 ms | 5 | **中位** | cargo |
| 打开（Rust 侧） | large-table | Source (9.96 MB) | 93 ms | 1 | 单次 | 日志 `file.open` |
| 切文档 | large-table | WYSIWYG (472 KB) | 55 766 ms | 1 | **单次** | DevTools |
| 关文档 | very-long-line | WYSIWYG (472 KB) | 79 197 ms | 1 | **单次** | DevTools |
| 主线程最长任务 | very-long-line | WYSIWYG (472 KB) | 79 197 ms | 1 | **单次** | DevTools + `sample` |
| PM 挂载 | large-table | WYSIWYG (472 KB) | ≈56 000 ms | 1 | **单次** | 日志 + DevTools |
| 导出 | normal-prose | WYSIWYG (473 KB) | **591 ms**（净算） | 1 | **单次** | 日志 `file.export_rendered` |

**除渲染面外，所有数字都是单次测量。** 渲染面是唯一可自动化、跑了 5 次取中位的面。

---

## 2. 渲染面（`cargo test --test perf_render_corpus -- --ignored`）

exit 0，`1 passed; 0 failed`，164.80 s，profile `test [unoptimized + debuginfo]`，repeats=5 取中位。

| file | bytes | render_p50 (ms) | sanitize_p50 (ms) | html_bytes |
|---|---:|---:|---:|---:|
| dense-math.source.md | 9 961 596 | 1982.5 | 5908.3 | 20 997 592 |
| dense-math.wysiwyg.md | 471 942 | 94.3 | 283.2 | 1 000 098 |
| large-table.source.md | 9 961 503 | 2351.6 | **10 307.5** | 24 173 369 |
| large-table.wysiwyg.md | 471 880 | 113.2 | 491.6 | 1 169 562 |
| many-short-nodes.source.md | 9 961 474 | 2205.3 | 5536.3 | 14 427 065 |
| many-short-nodes.wysiwyg.md | 471 867 | 107.0 | 276.5 | 700 477 |
| normal-prose.source.md | 9 961 944 | 998.9 | 680.3 | 10 289 130 |
| normal-prose.wysiwyg.crlf.md | 476 114 | 47.2 | 32.4 | 488 688 |
| normal-prose.wysiwyg.md | 473 540 | 47.4 | 32.0 | 488 688 |
| very-long-line.source.md | 9 961 475 | 925.9 | 439.4 | 9 961 536 |
| very-long-line.wysiwyg.md | 471 862 | 43.8 | 21.0 | 471 923 |

**发现：`sanitize_html` 在 5 种形态中的 4 种比 `render_markdown` 贵 2–4.4 倍**
（large-table 最极端：2351 ms → 10 307 ms）。这量化了计划 M §2.5 的
「ammonia 是真防线」——防线的成本是渲染本身的数倍。

## 3. 打开文档面（Rust 侧，日志 `file.open` 的 `durationMs`）

Source 档 5/5 全部测到：

| file | bytes | `file.open` (ms) |
|---|---:|---:|
| large-table.source.md | 9 961 503 | 93 |
| very-long-line.source.md | 9 961 475 | 94 |
| normal-prose.source.md | 9 961 944 | 154 |
| many-short-nodes.source.md | 9 961 474 | 156 |
| dense-math.source.md | 9 961 596 | 166 |

WYSIWYG 档：6–17 ms。

**结论：Rust 侧读 ~10 MB 只要 93–166 ms，不是瓶颈。** 所有卡顿都在前端。

## 4. 切文档 / 关文档（Web Inspector 控制台，click → 双 rAF 的墙钟时间）

`tab.switch` / `tab.close` 日志里没有 `durationMs`，所以在页内实测。**每项都是单次。**

| 切到 | ms | | 关闭 | ms |
|---|---:|---|---|---:|
| Untitled | 117 | | dense-math.wysiwyg | 8 103 |
| normal-prose.wysiwyg | 475 | | many-short-nodes.wysiwyg | 402 |
| **large-table.wysiwyg** | **55 766** | | **very-long-line.wysiwyg** | **79 197** |
| very-long-line.wysiwyg | 590 | | large-table.wysiwyg | 626 |
| many-short-nodes.wysiwyg | 8 183 | | normal-prose.wysiwyg | 31 |
| dense-math.wysiwyg | 9 449 | | Untitled | 20 |

关文档的成本其实是**重新挂载下一个 tab**，所以两列的形态顺序不对应。

**RSS 回落检查：内存会还回去，没有泄漏迹象。**
切换过程 2 528 000 → 843 088 KB；关闭过程 2 329 536 → 1 914 864 KB；
六个 tab 全关后 1 351 088 KB，静置 20 s 后 **976 448 KB**。

## 5. 主线程阻塞面

- 最长单次阻塞：**79 197 ms**（关闭 very-long-line 触发的重挂载，单次）
- 次长：**55 766 ms**（切到 large-table.wysiwyg）
- **阻塞期间 UI 不可交互**：点击 TOC 条目无任何反应，
  且「Document exceeds 500KB」toast 超过一分钟不自动消失（本应几秒后消失）。
- 栈顶分两类，见 §6。

## 6. Milkdown / ProseMirror 挂载面 —— 最关键的一面

### 6.1 已存在的 500 KB 护栏（`src/App.tsx:506-515`）

```ts
if (viewMode !== "wysiwyg") return;
if (!activeDocument) return;
const bytes = activeDocument.fileSize ?? new TextEncoder().encode(activeDocument.content).length;
if (bytes <= 500 * 1024) return;
showToast("Document exceeds 500KB. Switched to Source mode for performance.");
setViewMode("source");
```

应用**已经**会把 >500 KB 的文档自动切到 Source 模式，不让它挂进 PM DOM。
这条护栏此前没有被记录在任何计划文档里，它改变了这一面的结论。

### 6.2 挂载耗时（日志 `editor.milkdown.factory.direct` → `editor.milkdown.dom.check`）

| file | bytes | 挂载耗时 |
|---|---:|---:|
| normal-prose.wysiwyg.md | 473 540 | 501 / 554 ms（两次） |
| dense-math.wysiwyg.md | 471 942 | ≈9 000 ms |
| **large-table.wysiwyg.md** | **471 880** | **≈56 000 ms** |

### 6.3 两种性质完全不同的卡死

**(A) 472 KB 档 —— CSS 布局，不是 JS。有界，会结束。**

`sample` 栈顶：
`RenderGrid::layoutBlock` → `GridTrackSizingAlgorithm::run` → `resolveIntrinsicTrackSizes`
→ `minContributionForGridItem` → `RenderElement::layoutIfNeeded`
→ `RenderFlexibleBox::layoutBlock` → `performFlexLayout` → `constructFlexLayoutItem`（深层嵌套 flex）

Web Inspector Timeline 独立佐证：选中阻塞区间 5.63 s，
**JavaScript & Events 泳道完全为空，Call Tree 无任何 JS 采样**，
只有 Layout & Rendering 有条目。确认这段时间不在 JS 里。
该阻塞**会结束**（CPU 回到 0.0%），属于严重卡顿，不是永久无响应。

**(B) 9.96 MB 档 —— JS 字符串分配 + GC。不会结束。**

`sample` 栈（dev 构建与 debug bundle 两个不同进程，栈完全一致）：
`DOMTimer::fired` → `ScheduledAction::execute` → `JSC::profiledCall`
→ 5–6 层未符号化的 JIT 帧 → **`operationSingleCharacterString`**
→ `JSC::JSString::create` → `LocalAllocator::allocateSlowCase`
→ `MarkedBlock::Handle::sweep` → `IsoInlinedHeapCellType<JSC::JSString>::finishSweep`

- dev 构建 PID 20415：**4330/4330** 主线程采样全在这一个栈；持续 **3 小时 49 分**，~99% CPU，phys_footprint 峰值 1387 MB。
- debug bundle PID 43454：**7858/7858** 采样，同一个栈。两个进程各跑 7–10 分钟无收敛，RSS 在 1.3–2.2 GB 之间反复震荡（分配/回收颠簸）。
- 关键：**这发生在 Source 模式下**（500 KB 护栏已经生效切走了）。
  所以它**不是 PM 挂载**，而是某段对全文逐字符迭代的 JS，无论哪个编辑器模式都会跑。

### 6.4 符号化：做到哪一步，为什么停在这里

- `sample` 无法符号化 JIT 帧，只给原始地址（`0x10f861f00`）。这是硬下限。
- Web Inspector 的 profiler **能**把 JS 帧还原到源文件，但只有录制**结束**才会 flush。
  (A) 类阻塞会结束 → 成功录到，结论是「根本没有 JS」。
  (B) 类阻塞不会结束 → 录制永远 flush 不出来。**这是 (B) 无法定位到源文件的真正原因。**
- 项目代码已被系统性排除：`useTOC` / `tocService.parseHeadingsFromContent` /
  `tableMcp.escapeCellContent` / `MilkdownEditor` 全部逐行读过，均无全文逐字符循环；
  `src/` 下**不存在** `charAt` / `charCodeAt` / `split("")` / `fromCharCode`。
  因此该循环在依赖里（Milkdown / ProseMirror / remark 方向），**具体文件未定位**。

---

## 7. 导出面（日志 `file.export_rendered`）

对 `normal-prose.wysiwyg.md`（473 540 B）导出，产出 489 770 B HTML，写盘成功。

| 区间 | ms |
|---|---:|
| ⌘⇧E → `file.export_rendered start` | 105 |
| start → 保存面板弹出（render + sanitize + HTML 组装） | **591** |
| 保存面板停留（人工输入路径） | 72 154 |
| 点 Save → `success`（写 489 770 B） | <1 |
| **日志报告的 `durationMs`** | **72 745** |

**净导出成本 ≈ 591 ms。日志里那个 72 745 ms 有 99.2% 是文件选择器的停留时间。**

---

## 8. 门禁二结论

runbook §0 的三条硬条件：

| # | 条件 | 结果 |
|---|---|---|
| 1 | 不崩溃、不永久无响应 | ❌ **违反 — 阻断** |
| 2 | 10 MB 拒绝正确 | ✅ 已达成（此前实测） |
| 3 | 六个面各有数字或书面「测不了」的理由 | ✅ 六面齐全 |

### 门禁二未通过，卡在第 1 条。

判定依据：9.96 MB 文档打开后渲染进程 100% CPU **不收敛**
（dev 构建 3 h 49 min；debug bundle 两个进程各 7–10 min 持续观察无收敛），
期间 UI 完全不响应点击，toast 不消失。这是永久无响应，不是慢。

应用**没有崩溃**，进程能正常 ⌘Q 退出（即使带着两个卡死的渲染进程）。

---

## 9. 本轮新发现的缺陷

| ID | 级别 | 描述 |
|---|---|---|
| **D5** | BLOCK | `src-tauri/tauri.conf.json:28` 的 CSP 没有 `connect-src`，`default-src 'self'` 因此拒绝 `ipc://localhost`。打包构建每次启动产生约 20 条 console 错误（`log_event`、`plugin:event|listen`、`set_recent_files_menu`、`get_logging_settings`、`cleanup_old_drafts`）。Tauri 会回退到 postMessage，**功能不受影响**（已实测 `invoke` 与 `listen` 均正常），但错误噪音会淹没真实问题。`pnpm tauri dev` 注入宽松 dev CSP，完全掩盖了这个问题。 |
| **D6** | MUST | **500 KB 护栏阈值定得太高，形同虚设。** `large-table.wysiwyg.md` 只有 471 880 B，低于 500 KB 门槛因而**被允许**挂进 PM DOM，结果阻塞主线程约 56 s。护栏挡住了 10 MB，却放过了一个能卡死 56 秒的文档。 |
| **D1**（既有） | MUST | `file.rs:1098` 的计时器跨越了文件选择器。本轮给出了确切数字：导出报告 72 745 ms，其中 72 154 ms 是人工停留，净成本 591 ms。经由对话框的 `durationMs` 全部不可用。 |

## 10. 仍未解释 / 测不了的事项

1. **9.96 MB JS 循环的源文件位置** —— 见 §6.4。原因已写明（录制无法 flush），
   不是没查。项目代码已排除，方向指向依赖。
2. **22:18 的五次打开异常** —— 当时 Rust 侧记录 `file.open.external success`，
   但没有 `file.open` / `tab.open`，UI 也没有新 tab。
   两个假设（CSP 破坏 listen、启动竞态）都已被实验否证。
   本轮发现**每次外部打开都会新建一个窗口**（`window.open` + 新 windowId）而不是在现有窗口加 tab，
   这是一条此前不知道的线索，但**不足以解释当时缺失的 `file.open` 记录**。
   仍是未解释状态。
3. **所有非渲染面的数字都是单次**，且在**电池供电**下测得。重测须插电并取中位。
