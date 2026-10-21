# D6.1 — 真机 WKWebView sweep 执行手册

**状态**：待用户执行。本仓跑不了（只有 `unit`(vitest/jsdom) 与 `rust`(cargo) 两条泳道，
无 playwright / puppeteer，门禁二里每个 Milkdown 数字都是手工用 Web Inspector 取的）。

**它解锁什么**：D6.1 → D6.2（重选判据与阈值 + ADR-0016）→ D6 结案 → 3.8 出口复测。
在拿到本次 sweep 之前，[ADR-0006](../adr/0006-bump-micromark-gfm-table-for-quadratic-edit-map.md)`:190-193`
**禁止写死任何新阈值**。本手册只收集数据，不得据此直接改护栏。

---

## 1. 前置：必须先 build bundle

`pnpm tauri dev` 与 `pnpm dev` 都**不行**（computer-use 授权按 bundle identifier 走，
dev 产物没有 `Info.plist`）。人工执行同样建议用 bundle，理由是要测的就是发布形态。

```bash
# 先杀掉旧进程，否则 macOS 单实例会把 open -a 路由进旧镜像，
# 而 ps/pgrep 会显示新路径 —— 这个陷阱真的发生过一次，导致一个假 FAIL。
pkill -f 'bundle/macos/mdpro.app/Contents/MacOS/tauri-app'

pnpm tauri build --bundles app
# → src-tauri/target/release/bundle/macos/mdpro.app
```

`--bundles app` 跳过 DMG。若 `TAURI_SIGNING_PRIVATE_KEY` 报错退出 1，只影响 updater
产物，`.app` 本身已生成，可继续。

**验证 bundle 比源码新**（macos-device-test §3 Trap 2）：比对 `mdpro.app` 的 mtime 与
`src/components/Editor/MilkdownEditor.tsx`、`src/App.tsx`、`src/utils/largeDocumentGuard.ts`。

---

## 2. 语料

```bash
node scripts/perf/generate-corpus.mjs          # 生成 .perf-corpus/（已 gitignore）
node scripts/perf/generate-corpus.mjs --check  # 必须回 "OK: reproduces plan M's recorded table (11/11)"
```

本次只需 **5 个 `.wysiwyg` 形态**。`.source` 形态都是 9.96 MB，会被 500 KB 护栏挡下
自动切源码模式，进不了 WYSIWYG，测不到本次要测的东西。

| 夹具（`.perf-corpus/`） | bytes | 标题数 | 表格数 | 最大单表单元格 |
|---|---:|---:|---:|---:|
| `very-long-line.wysiwyg.md` | 471,862 | 1 | 0 | **0** |
| `large-table.wysiwyg.md` | 471,880 | 0 | 1 | **45,752** |
| `many-short-nodes.wysiwyg.md` | 471,867 | 0 | 0 | 0 |
| `dense-math.wysiwyg.md` | 471,942 | 3,444 | 0 | 0 |
| `normal-prose.wysiwyg.md` | 473,540 | 143 | 0 | 0 |

**注意五份都是 471–476 KB，全部压在 500 KB 护栏之下**，所以今天它们都被放进 WYSIWYG。
这不是巧合，是语料生成器刻意设计的——护栏边界正是要测的地方。

---

## 3. 本次 sweep 要回答的那个问题（已被本仓数据收窄）

ADR-0006 `:97-103` 的诊断是：护栏**机制**有效，错的是**阈值**与**判据变量**，
且 cost tracks **cells in the largest single table**, not bytes。

把语料成分与门禁二记录（`20260915-stage3-gate2-record.md`）的两个病态数字对上后，
这个判据**至少不完备**：

| 夹具 | 最大单表单元格 | 门禁二实测 |
|---|---:|---|
| `large-table.wysiwyg` | 45,752 | 切文档阻塞 **55,766 ms** |
| `very-long-line.wysiwyg` | **0** | 关文档阻塞 **79,197 ms** ← 记录中最差 |

**单元格判据会把记录中最严重的阻塞打成 0 分并放行。** `very-long-line` 是一整行超长文本，
成本来源显然不是表格。

⚠️ 这两个数字**引自 2026-09-15 的记录，不是本次重测**；ADR-0006 自己也写明该事
still unmeasured。所以上表是**给 sweep 的假设**，不是结论，更不构成对 ADR-0006 的推翻。
本次 sweep 的核心任务就是判定：**判据变量应该是单元格数、最长行长度、节点数，还是它们的组合。**

---

## 4. 逐夹具操作

对上表 5 个夹具**各做一遍**，顺序随意，但每个夹具之间**重启 app**（避免上一个文档的
GC / 内存压力污染下一个）。

```bash
# 记录日志基线字节数（负向断言只有靠字节窗口才可信）
wc -c < ~/.mdpro/mdpro.log

open -a "$PWD/src-tauri/target/release/bundle/macos/mdpro.app" \
     "$PWD/.perf-corpus/<fixture>.md"

# 确认跑的是刚 build 的那个
ps -Ao pid,lstart,comm | grep -i mdpro | grep -v grep
```

每个夹具测 **4 个动作**，用 Web Inspector 的 Timeline/Performance 面板取主线程阻塞时长：

| # | 动作 | 记录什么 |
|---|---|---|
| A | 打开文档（冷启动直接带文件参数） | 从 `app.launch` 到可交互的墙钟时间；主线程最长单次阻塞 |
| B | `⌃4` 切到 WYSIWYG（若未自动进入） | 切换耗时；主线程最长单次阻塞 |
| C | `⌃2` 切回 Source | 同上 |
| D | `⌘W` 关文档 | 关闭耗时；主线程最长单次阻塞 ← `very-long-line` 的 79 s 出在这里 |

**判定"不可交互"要有证据**：阻塞期间尝试点侧栏或敲一个字符，记录是否有响应，
而不是只凭感觉写"卡"。

---

## 5. 记录模板

每个夹具一行，填进 `docs/plans/` 下一份新的 record 文件（建议
`20260920-d61-wkwebview-sweep-record.md`）：

```
| fixture | bytes | maxCells | headings | A_open_ms | A_block_ms | B_to_wysiwyg_ms | B_block_ms | C_to_source_ms | D_close_ms | D_block_ms | 期间可交互? |
```

另外记三件事：

1. **机型、macOS 版本、WKWebView/Safari 版本**——判据要迁移到别的机器，这是前提。
2. **是 release 还是 `--debug` bundle**。两者是不同的二进制，混着记等于没记。
3. **任何一次崩溃或永久无响应**，以及是否需要强杀。门禁二的硬标准
   「不崩溃、不永久无响应」当初就是栽在这里。

---

## 6. 做完之后**不要**做的事

- **不要**顺手把新阈值写进 `src/utils/largeDocumentGuard.ts`。那是 D6.2，
  且必须先有 ADR-0016 承载判据变更的理由与代价。
- **不要**把毫秒数变成阻塞门禁（E39/G0）。`perf_render_corpus.rs` 按设计不断言阈值，
  这条纪律对前端面同样成立。
- **不要**把"没测到"写成 pass（macos-device-test §8）。测不到的格子写 NOT VERIFIED 并注明拦路的东西。
- 菜单栏被第三方工具（iBar Pro）占用时**不要**去争，也不要给那个工具授权；
  用键盘快捷键（`⌃2` / `⌃4` / `⌘⇧L`）(macos-device-test §9)。

---

## 7. 现状交叉引用

- 护栏判定已是纯函数 `decideLargeDocumentGuard`（`src/utils/largeDocumentGuard.ts`），
  调用点在 `src/App.tsx` 的护栏 `useEffect` 里。**2026-09-21 更新：D6.3(c) 已交付** ——
  判据由字节数换成 ADR-0016 的结构分（换行数 + 竖线数 − 表格行起始数），阈值 25 000，
  `fileSize` 已从输入类型删除；测试由 34 例重写为 **45 例全绿**
  （`tests/large-document-guard.test.ts` 33 例 + `tests/large-document-guard-call-site.test.ts` 12 例），
  模块行/语句/分支/函数覆盖率均 100%。
  所以 D6.2 改判据时改的是一个**有网**的函数，不是裸改。
  （此处原先钉着 `largeDocumentGuard.ts:82` 与 `App.tsx:513` 两个行号；
  两个都已随本次改动失效，故改为只指文件与符号 —— 行号会随每次编辑过期，
  而符号名不会。）
- Rust 渲染面已于 2026-09-20 复测，11 份 `html_bytes` 与基线逐字节相同，
  记录在 sequencing doc 的 3.8 行。**Rust 面不是瓶颈；所有卡顿都在前端。**
