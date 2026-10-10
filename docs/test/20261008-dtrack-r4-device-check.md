# D-track 真机复测 r4：D36、D38、D39、D25 issue 1（2026-10-08）

本轮在 Mac mini 上用 `fix/dtrack-batch` 的 `f78990d` release 构建，按 brief `brief-20261008-dtrack-r4.md` 跑了四项：D36 第 1–3 步、D39、D25 issue 1 通过；D38 两种变体（A 两框都批准、B 批准后拒绝）**未通过**。D38 已在 `bcdbff8` 返工（[ADR-0061](../adr/0061-a-prompt-that-opens-after-the-capture-also-carries-the-caret.md)），返工后的代码还没有上真机。D36 第 4 步的对照组只作参考，结论是「无法判定」。下面 §4 原样收录 mini 报告（英文）；排序文档 D36、D38、D39、D25 行，ledger 与 CHANGELOG 按本记录改写。

## 0. 测量条件

| 项 | 值 |
|---|---|
| 日期 | 2026-10-08（09:34 至 09:43 左右，GMT+8） |
| 机器 | Mac mini |
| 执行方 | 控制台会话里的 Claude Code，Bash + computer-use 驱动 app |
| 被测构建 | release v0.3.0，分支 `fix/dtrack-batch` 的 `f78990d`（`f78990db58d2cf0230d1022b4e69f669cc2c6772`），`Contents/MacOS/tauri-app` 的 mtime 为 2026-10-08 09:24:07；每次启动都按完整路径，`ps` 确认运行的是 `builds/f78990d/` 下的二进制（pid 8473、14126、14943）；`/api/status` 报 `0.3.0` |
| 被测代码 | D36 `bfc02e0`、D39 `f78990d`、D25 issue 1 `dd5a312`（[ADR-0054](../adr/0054-a-locked-mcp-switch-mirrors-the-running-server.md)）、D38 首次修法 `4d1b54d`（[ADR-0060](../adr/0060-a-confirm-prompt-returning-into-the-editor-carries-the-caret.md)），都在被测构建里 |
| 设置 | 日志开着（Info）；D36 之前 MCP 为 Running（`localhost:55045`），Auto-approve 关。除 D25 的坏配置及其还原外没有改任何设置 |
| 证据存放 | 截图在 mini 的 `~/.mdpro-redesign/dtrack/reports/shots/r4-*`，草稿文件在 `scratch/r4`，**都不入库** |
| 配置 | D25 前 `cp -p` 备份；坏配置跑完后 app 没有改写它（`cmp` 相同）；还原后 `cmp` 相等、`jq empty` 通过，sanity 启动后仍与备份相等 |

**构建之后的提交**：`f78990d` 之后本分支只有 `bcdbff8`（D38 返工），只改 `src/hooks/useMilkdownFocusRestore.ts`、`src/hooks/useReturnFocusOnClose.ts`、`src/utils/milkdownFocusCarry.ts`（对 `src/`、`src-tauri/src`、`tests/manual-fixtures/` 取 `f78990d..bcdbff8` 的 diff stat 只列出这三个文件）。D36、D39、D25 涉及的代码在两者之间没有改动；D38 的返工代码不在被测构建里。

## 1. 复核

协调方核对过被测构建与下表各项结论。本记录没有另行重读 mini 的 `~/.mdpro/mdpro.log`，下文引用的日志行、偏移量与时间戳都出自 mini 报告原文。D38 失败的成因是读代码对照报告日志得出的，见排序文档 [D38](../plans/20260912-frontend-backend-sequencing-order.md#d38) 行的返工记录。

## 2. 逐项结论

| 判据 | 结果 | 要点（证据见 §4 原文） |
|---|---|---|
| D36 第 1 步 基线 | **通过** | ⌘↓ 后 GET `.cursor` = 15 |
| D36 第 2 步 只移动光标 | **通过** | ⌘↑ ↓ ↓，等 1.5 s，GET `.cursor` = 10（修前停在 15） |
| D36 第 3 步 按光标插入 | **通过** | 前台路径，无 `mcp.confirm`；响应 `{"success":true,"new_cursor":15}` 200，日志 `insertOffset:10, newCursor:15`；屏幕与 GET `.content` 都是 `[D36]CCCC` |
| D36 第 4 步 对照组（只作参考） | **无法判定** | 第 1 次点击落在编辑器第 1 行、移动了光标，前提不成立，不计；第 2 次前提干净（光标 13），插入落在影子偏移 13，残留现象没有复现。不能据此确认、也不能排除已知残留 |
| D38-A 两框都批准 | **未通过** | 最后一框关闭后直接打 `Z`，落成 `Last line.Z`。日志：r1 写入记 `editor.milkdown.focus.restore` `cancel` `skipped:focus-elsewhere`，最后关框记 `ui.mcp_confirm.focus_return` `outcome:"fallback"`；没有 `restored` + `focus:"deferred"`。两条写入都是 200 |
| D38-B 批准后拒绝 | **未通过** | 同样 `Last line.Z`；拒绝本身正确（403 `USER_REJECTED`），日志形态同 A |
| D39 晚解析的围栏 | **通过** | 5 388 923 B，打开即降级到源码；光标进 `\| 1 \| 2 \|` 的 ` 2 ` 格，t0（09:39:03）有高亮，约 +10 s（09:39:13）起消失，直到约 +97 s 都没有回来；期间无输入；⌘W 无提示 |
| D25 issue 1 坏配置下的 Integrations | **通过** | 徽标 Running，锁住的开关显示开、点了不变，55045 仍在监听；「Settings file unreadable — fix it to change this setting」恰出现一次，「MCP settings couldn't be loaded…」不出现；app 没改写坏配置，期间日志 0 行 |

**D36 的结论**：修法要验的第 2、3 步真机通过。第 4 步对照组本来就不能让 D36 失败，这次也没能复现已知残留，残留措辞保持原样（移动光标后 300 ms 内调 `insert_content` 仍用上一个位置）。

**D38 的结论**：首次修法（ADR-0060）只处理「写入时焦点已在确认框里」的情形；真机上 Rust 先放行已批准的写入、再弹下一个框，写入时焦点还在编辑器，这条路径没有被接住。返工在 `bcdbff8`，**真机未验**，下次复测请看 skip / deferred 日志行新增的 `active`、`promptTarget` 字段。

**本轮没有覆盖的**：

- D38 返工后的代码（不在被测构建里）。
- D38 的焦点是用 app 激活（`open_application`）还给 mdpro 的，不是点标题栏：Terminal 在前台时 computer-use 的点击到不了 mdpro。按上述成因这不改变结论，但手动点标题栏的复测仍值得做一次。
- D38 的超时、撤回、取消路径。
- D25 issue 1 只看了 Integrations；三个勾选看起来是灰的，按简报没去点（源码里都是 `disabled={locked}`）。

## 3. 报告 NOTE 的去向（只记录，不是修复）

1. **NOTE 1 / D38 回归或残留**：即上面的 D38 失败，已在 `bcdbff8` 返工。
2. **NOTE 2 / D38 的焦点手段**：见 §2「本轮没有覆盖的」。
3. **NOTE 3 / `open -a <app> file` 每个文件开一个新窗口**：`file.open.route outcome:"new-window"`、`matchCount:0`，是 D29 的路由设计，不是缺陷；D38 的简报写的是「同一窗口开新标签」，下次改简报时照实写。
4. **NOTE 4 / 自动保存的 `file.write` 日志与盘上不符**：与 2026-10-07 D24 记录的 NOTE 3 同一现象（草稿 / 影子写入带着文档真实路径，读起来像保存）。不归本批次，只记录。
5. **NOTE 5 / D36 对照组的布局陷阱**：单窗口布局里编辑器第一行就在标题栏高度，点「标题栏」会移动光标；要点侧栏上方那一条。属于测量手段。
6. **NOTE 6 / D39 大文档打开即降级**：`editor.large_document.degrade`（`structureThreshold: 25000`），所以简报里「若是 WYSIWYG 就按 ⌃2」那一步用不上。
7. **NOTE 7 / 坏配置下 Settings → General 显示「Failed to load preferences. Please close and reopen settings.」**：D25 issue 1 范围之外的同类现象，记在排序文档 [D25](../plans/20260912-frontend-backend-sequencing-order.md#d25) 行，本批次不修。
8. **NOTE 8 / 会话锁**：第一次 computer-use 请求被另一个 Claude 会话占着的锁挡住，用户退出那个会话后才开始。与产品无关。

## 4. 测试报告原文

以下是 mini 报告 `report-20261008-dtrack-r4.md` 全文，原样收录，只把标题层级下调两级。

### Device checks r4 — D36, D38, D39, D25-issue-1 on `f78990d` (2026-10-08)

Brief: `brief-20261008-dtrack-r4.md`. Run 09:34–09:43 GMT+8 via Claude Code (Bash + computer-use), console session.
Scratch: `~/.mdpro-redesign/dtrack/scratch/r4`. Screenshots: `reports/shots/r4-*`.
Logging was on (⌘, → Advanced: Enable Logging ✓, level Info). MCP was **Running** on `localhost:55045` with Auto-approve off before D36. No setting was changed except the D25 config corruption and its restore.

#### Summary

| Check | Result |
|---|---|
| D36 steps 1–3 | **PASS** |
| D36 step-4 control (informational) | inconclusive. Attempt 1 deviated: my click moved the caret. Attempt 2 did not show the residual. |
| D38-A (approve both) | **FAIL**: `Z` landed as `Last line.Z` |
| D38-B (reject second) | **FAIL**: `Z` landed as `Last line.Z`. The reject path itself was correct (`403 USER_REJECTED`). |
| D39 | **PASS** |
| D25 issue 1 | **PASS** |

---

#### D36 — source-mode caret move resyncs the shadow store — **PASS** (steps 1–3)

Launch: `open -a …/builds/f78990d/mdpro.app scratch/r4/d36.md`, pid 8473, binary `…/builds/f78990d/mdpro.app/Contents/MacOS/tauri-app`. ⌃2 → Source, click into text (`r4-d36-0.png`). `D36=bfa7495c99b8f45f`.

- **Step 1, baseline.** ⌘↓, wait 1.5 s, GET `.cursor` → **`15`**. ✓
- **Step 2, move only.** ⌘↑ ↓ ↓ (caret visibly at the start of `CCCC`), wait 1.5 s, log mark **N=7177**, GET `.cursor` → **`10`**. ✓ (Before the fix it stayed at 15.)
- **Step 3, insert at cursor.** **Focused path:** mdpro was frontmost and no `mcp.confirm` line was logged.
  - Response: `{"success":true,"new_cursor":15}` **200** ✓
  - Screen: line 3 reads `[D36]CCCC` ✓ (`r4-d36-3.png`)
  - GET `.content` afterwards: `"AAAA\nBBBB\n[D36]CCCC\n"`, which matches the screen ✓
  - Log (after 7177):
    ```
    {"ts":"2026-10-08T09:35:08.706+08:00","event":"mcp.insert","status":"start","context":{"documentId":"bfa7495c99b8f45f","textLength":5}}
    {"ts":"2026-10-08T09:35:08.707+08:00","event":"mcp.insert","status":"success","context":{"documentId":"bfa7495c99b8f45f","insertOffset":10,"newCursor":15}}
    {"ts":"2026-10-08T09:35:08.717+08:00","event":"mcp.insert","status":"success","context":{"documentId":"bfa7495c99b8f45f","wholesale":false}}
    ```
- **Step 4, control (informational, can't fail D36).** Both requests went through the **focused path**; no confirm prompt appeared.
  - **Attempt 1 (deviated, mark N=7188).** GET `.cursor` was `10` before the click. My "title bar" click at y≈88 actually landed on editor line 1, because the editor text starts at the top edge of the window, so the caret moved to the end of `AAAA` (offset 4) before the osascript ⌘↑. Result: `{"success":true,"new_cursor":7}` 200, log `insertOffset: 4, newCursor: 7`. On screen `[C]` was at **0** (`[C]AAAA`), and GET 1 s later gave `"[C]AAAA\nBBBB\n[D36]CCCC\n"`, cursor 3. The residual pattern appeared (the response/log offset differed from the screen offset), but the precondition wasn't offset 10, so this attempt can't count.
  - **Attempt 2 (clean precondition, mark N=7197).** ⌘↑ ↓ ↓, then GET `.cursor` → `13` (line 3 now starts at 13 because of the earlier `[C]`). I clicked the window title strip above the sidebar (x≈205), and the caret visibly stayed on line 3. Then I ran osascript ⌘↑ and the insert in one Bash command: `{"success":true,"new_cursor":16}` 200, log `insertOffset: 13, newCursor: 16`. On screen `[C]` landed at **13**, as `[C][D36]CCCC`, and only afterwards was the caret at line 1. GET 1 s later gave `"[C]AAAA\nBBBB\n[C][D36]CCCC\n"`, cursor 0.
  - **The residual did not reproduce in attempt 2.** The insert landed at the shadow offset, and the ⌘↑ keystroke seems to have been handled after the insert. Record as inconclusive or informational.
- **Step 5.** Saved with ⌘S, and the dirty dot cleared. File on disk: `[C]AAAA / BBBB / [C][D36]CCCC`.

#### D38-A — queued confirm prompts, approve both — **FAIL**

- **Steps 1–2.** `open -a … d38a.md` opened a **new window**, not the same window (log `file.open.route outcome:new-window`). It was already in WYSIWYG. I clicked at the end of `Hello world` and pressed ← ×6; the caret is visibly between `Hello` and ` world` (`r4-d38a-0.png`). `A=e3e0f6857d43c7d2`.
- **Step 3.** I made mdpro unfocused by bringing Terminal to the front with computer-use `open_application`. Log mark **N=7262**. Both requests ran in the background, 1 s apart. **Both went through the prompt path.**
- **Step 4 (deviation).** My left-click on the mdpro title bar (y=66) while Terminal was frontmost **did not reach mdpro**: no `window.focus` line, and the menu bar stayed on Terminal. I focused mdpro with computer-use `open_application("mdpro")` instead, which gave `window.focus` at 09:36:56.380. I took a screenshot of the first prompt (`r4-d38a-prompt1.png`) and clicked **Approve**. The prompt text was: *An MCP client wants to add content to "d38a.md".*
- **Step 5.** The second prompt showed with the document behind it reading `ONE Hello world` ✓ (`r4-d38a-1.png`). I clicked **Approve**.
- **Step 6.** Without clicking anywhere I typed `Z` (`r4-d38a-2.png`). Screen: `TWO ONE Hello world` / `Last line.Z`. GET `.content` gave `"TWO ONE Hello world\n\nLast line.Z\n"` → **FAIL** (the old-D38 shape).
- **Step 7.** `d38a-r1.out`: `{"success":true,"new_cursor":4}200`. `d38a-r2.out`: `{"success":true,"new_cursor":4}200` ✓.
- **Step 8, log (after 7262):**
  ```
  {"ts":"2026-10-08T09:36:33.958+08:00","event":"mcp.confirm","status":"start","context":{"documentId":"e3e0f6857d43c7d2","operation":"insert","queueDepth":1,"requestId":"be6e35d0-…","windowLabel":"mdpro-d712091e-…"}}
  {"ts":"2026-10-08T09:36:34.982+08:00","event":"mcp.confirm","status":"start","context":{"documentId":"e3e0f6857d43c7d2","operation":"insert","queueDepth":2,"requestId":"502925b0-…","windowLabel":"mdpro-d712091e-…"}}
  {"ts":"2026-10-08T09:36:56.380+08:00","event":"window.focus","status":"success","context":{"windowId":"mdpro-d712091e-…"}}
  {"ts":"2026-10-08T09:36:58.996+08:00","event":"mcp.confirm","status":"success","context":{"documentId":"e3e0f6857d43c7d2","operation":"insert","outcome":"approved","queueDepth":1,"requestId":"be6e35d0-…","waitedMs":25037}}
  {"ts":"2026-10-08T09:36:58.996+08:00","event":"mcp.insert","status":"success","context":{"documentId":"e3e0f6857d43c7d2","insertOffset":0,"newCursor":4}}
  {"ts":"2026-10-08T09:36:59.010+08:00","event":"editor.milkdown.focus.restore","status":"cancel","context":{"documentId":"e3e0f6857d43c7d2","generation":2,"outcome":"skipped:focus-elsewhere","reason":"mcp-insert"}}
  {"ts":"2026-10-08T09:37:04.531+08:00","event":"mcp.confirm","status":"success","context":{"documentId":"e3e0f6857d43c7d2","operation":"insert","outcome":"approved","queueDepth":2,"requestId":"502925b0-…","waitedMs":29548}}
  {"ts":"2026-10-08T09:37:04.532+08:00","event":"mcp.insert","status":"success","context":{"documentId":"e3e0f6857d43c7d2","insertOffset":0,"newCursor":4}}
  {"ts":"2026-10-08T09:37:04.535+08:00","event":"ui.mcp_confirm.focus_return","status":"success","context":{"outcome":"fallback","target":"editor"}}
  {"ts":"2026-10-08T09:37:04.547+08:00","event":"editor.milkdown.focus.restore","status":"success","context":{"anchor":"diff","documentId":"e3e0f6857d43c7d2","durationMs":1,"outcome":"restored","reason":"mcp-insert"}}
  ```
  - Two `mcp.confirm start` lines, the second with `queueDepth: 2` ✓
  - Two `mcp.confirm success outcome: approved` ✓
  - Two `mcp.insert success` (`insertOffset: 0, newCursor: 4`) ✓
  - `editor.milkdown.focus.restore`: **no** `restored` + `focus: "deferred"` line. r1's write logged **`cancel` `skipped:focus-elsewhere`** ✗. r2's write logged `restored` (anchor `diff`) without `focus` ✓.
  - **`ui.mcp_confirm.focus_return outcome: fallback` is present** ✗, and **`skipped:focus-elsewhere` is present** ✗.
- **Caveat on the method.** Focus came back to mdpro through app activation (`open_application`), not a title-bar click, because the click didn't reach mdpro while Terminal was frontmost. The prompt still held focus when r1 was approved, and the second prompt was on screen. Even so, a developer may want to re-run this with a real title-bar click by hand to rule out the activation path.

#### D38-B — queued confirm prompts, reject the second — **FAIL**

- `d38b.md` opened in another new window, already in WYSIWYG. Caret between `Hello` and ` world` (`r4-d38b-0.png`). `B=dedbae46ba6d4c91`. Log mark **N=7356**. Both requests went through the **prompt path**.
- The same focus deviation as D38-A: the title-bar click didn't activate mdpro, so I used `open_application` (`window.focus` 09:37:52.006). First prompt screenshot: `r4-d38b-prompt1.png`. I clicked **Approve**. The second prompt showed over `ONE Hello world` (`r4-d38b-1.png`), and I clicked **Reject**. I typed `Z` (`r4-d38b-2.png`).
- GET `.content`: `"ONE Hello world\n\nLast line.Z\n"` → **FAIL**. Expected `ONE HelloZ world`.
- `d38b-r1.out`: `{"success":true,"new_cursor":4}200`. `d38b-r2.out`: `{"error":"User rejected write operation","code":"USER_REJECTED"}403` ✓.
- Log (after 7356, filtered):
  ```
  {"ts":"2026-10-08T09:37:46.661+08:00","event":"mcp.confirm","status":"start","context":{"documentId":"dedbae46ba6d4c91","operation":"insert","queueDepth":1,…}}
  {"ts":"2026-10-08T09:37:47.670+08:00","event":"mcp.confirm","status":"start","context":{"documentId":"dedbae46ba6d4c91","operation":"insert","queueDepth":2,…}}
  {"ts":"2026-10-08T09:37:52.882+08:00","event":"mcp.confirm","status":"success","context":{…,"outcome":"approved","queueDepth":1,"waitedMs":6221}}
  {"ts":"2026-10-08T09:37:52.883+08:00","event":"mcp.insert","status":"success","context":{"documentId":"dedbae46ba6d4c91","insertOffset":0,"newCursor":4}}
  {"ts":"2026-10-08T09:37:52.896+08:00","event":"editor.milkdown.focus.restore","status":"cancel","context":{"documentId":"dedbae46ba6d4c91","generation":2,"outcome":"skipped:focus-elsewhere","reason":"mcp-insert"}}
  {"ts":"2026-10-08T09:37:58.604+08:00","event":"mcp.confirm","status":"fail","context":{…,"outcome":"rejected","queueDepth":2,"waitedMs":10934}}
  {"ts":"2026-10-08T09:37:58.605+08:00","event":"mcp.insert","status":"fail","context":{"documentId":"dedbae46ba6d4c91","httpStatus":403}}
  {"ts":"2026-10-08T09:37:58.605+08:00","event":"ui.mcp_confirm.focus_return","status":"success","context":{"outcome":"fallback","target":"editor"}}
  ```
  - `outcome: rejected` ✓, but again `skipped:focus-elsewhere` instead of the deferred `restored`, followed by `focus_return fallback`.
- Both documents were saved with ⌘S. On disk: d38a = `TWO ONE Hello world / / Last line.Z`, d38b = `ONE Hello world / / Last line.Z`.

#### D39 — late parse into a fence clears the source table highlight — **PASS**

- Fixture: 60000 paragraphs, `stat` gives **5388923** bytes (< 10485760). Log mark **N=7418**.
- `open -a … d39.md` opened a new window **directly in Source**. The log shows `editor.large_document.degrade` `trigger:"structure"`, `elements:120009`, then `view.mode.change` wysiwyg→source, so no ⌃2 was needed. I clicked once in the top paragraph.
- One computer-use batch: ⌘↓, ←, ←, screenshot. The caret is in the ` 2 ` cell of `| 1 | 2 |` (line 120004).
- Shots (cropped to the last 3 lines). Note that the background capture loop started late, so the real offsets are larger than the labels:

  | file | time | cell highlight |
  |---|---|---|
  | `r4-d39-t0.png` | 09:39:03 | **visible** (soft accent box around ` 2 `) |
  | `r4-d39-t3.png` | 09:39:13 (~+10 s) | **gone** (only the caret) |
  | `r4-d39-t10.png` | 09:39:20 (~+17 s) | gone |
  | `r4-d39-t30.png` | 09:39:40 (~+37 s) | gone |
  | `r4-d39-t60.png` | 09:40:10 (~+67 s) | gone |
  | `r4-d39-t90.png` | 09:40:40 (~+97 s) | gone |

  A computer-use zoom taken a few seconds after t0 (not saved) already showed no highlight. The first saved shot without the highlight is `r4-d39-t3.png`, at 09:39:13. There was no input between t0 and t90.
- The highlight has no log event. After 09:38:51.8 the log has no lines until the ⌘W at 09:41:04.
- **Step 5.** ⌘W closed the tab with no prompt (`tab.close … "wasModified":false`).

Then ⌘Q quit mdpro with no prompt, and `pgrep -fl 'mdpro.app'` was empty.

#### D25 issue 1 — corrupt config gives a locked switch that matches the badge, with one note — **PASS**

1. `cp -p` backup → **`backup-ok`**.
2. Appended `x` → `jq empty` → **`corrupt-ok`**, then copied it to `config.corrupt.json`. Log mark **N=7507**.
3. Launched with no file: pid 14126 under `builds/f78990d/`. `lsof -nP -iTCP:55045 -sTCP:LISTEN` → `tauri-app 14126 … TCP 127.0.0.1:55045 (LISTEN)` ✓. Re-ran the preamble (64-char token loaded, not printed). `GET /api/status` → `{"version":"0.3.0","window_focused":true}` **200** ✓.
4. ⌘, → Integrations (`r4-d25-1.png`, MCP block zoomed in `r4-d25-2.png`, lower part of the panel in `r4-d25-3.png`):
   - Badge: **Running** ✓
   - **Enable MCP Server** is **on**. Clicking it changed nothing: still on, still Running, and `/api/status` was still 200 with port 55045 still listening ✓
   - **Start on launch** and **Auto-approve edits** are unchecked ✓ and look dimmed. I didn't click them, because the brief doesn't ask for it and a click would change a setting if they were live. Source at f78990d, `src/components/common/IntegrationsSettings.tsx:216,227,236`, gives all three switches `disabled={locked}`.
   - `Settings file unreadable — fix it to change this setting` appears **exactly once**, beside the badge ✓
   - `MCP settings couldn't be loaded — close and reopen Settings to retry` does **not** appear anywhere in the panel ✓
5. Closed Settings and quit with ⌘Q (no prompt).
   - `cmp ~/.mdpro/config.json config.corrupt.json` → identical (**corrupt-unchanged**, so the app didn't rewrite it).
   - `tail -n +7508 ~/.mdpro/mdpro.log | wc -l` → **0** ✓
6. Restore: `cp -p config.backup.json ~/.mdpro/config.json && cmp` → **`restore-ok`**, and `jq empty` succeeds.
7. Optional sanity check: relaunched (pid 14943). ⌘, → Integrations showed the normal state: switch on, **Running**, and no unreadable note (`r4-d25-sanity.png`). Quit, `pgrep` empty. Afterwards the config still `cmp`s equal to the backup. The relaunch logged 51 lines, so logging resumed.

---

#### Build

- Repo `git -C /Users/jack/Documents/mac-app/mdpro rev-parse HEAD` = `f78990db58d2cf0230d1022b4e69f669cc2c6772`. `cat-file -e f78990d` succeeds. Working tree: no tracked changes. There are 3 untracked plugin artifacts (`.claude/mind.mv2`, `.claude/mind.mv2.lock`, `.tokenize/`) that I didn't create by hand; I didn't edit, commit or push anything.
- Bundle `builds/f78990d/mdpro.app/Contents/MacOS/tauri-app` mtime **Oct 8 09:24:07 2026**.
- `/api/status` version **0.3.0**.
- Every launch was by full path, and `ps` showed the binary under `builds/f78990d/` each time (pids 8473, 14126, 14943).

#### Config cmp results

- backup: `backup-ok`
- corrupt unchanged after the D25 run: identical
- restore: `restore-ok`, valid JSON. Still equal to the backup after the sanity launch.

#### NOTEs (observations, not fixes)

1. **D38 regression or residual on f78990d.** In both A and B, r1's write, which landed while r2's prompt held focus, logged `focus.restore` `cancel` `skipped:focus-elsewhere` instead of `restored` + `focus:"deferred"`. Then `ui.mcp_confirm.focus_return` logged `fallback` and `Z` went to the end of the document. Per `useMilkdownFocusRestore.ts` at f78990d, this branch is taken when `record.viaDialog !== true` or when `redirectReturnFocus(document.activeElement, view.dom)` returns false. So either the carry record wasn't marked `viaDialog`, or the redirect didn't recognise the focused prompt element. I didn't investigate further.
2. **Focus method in D38.** Computer-use left-clicks on an mdpro window while Terminal was frontmost had no effect: no `window.focus` line, and the menu bar stayed on Terminal. I focused mdpro by app activation instead. A manual re-run with a real title-bar click would rule this out as a factor.
3. **`open -a <app> file` opens a new window per file** (`file.open.route outcome:new-window`, `matchCount:0`), not a tab in the existing window as the brief expects for D38-A and D38-B.
4. **Autosave log vs disk (d38a).** The log shows `file.write` `success` `bytes:33` for `…/scratch/r4/d38a.md` at 09:37:09 and 09:38:09 (the 30 s autosave interval). But at 09:38:3x the file on disk was still the original 24-byte `Hello world\n\nLast line.\n`, and the tab still showed the dirty dot. The file only changed after my ⌘S (mtime 09:38:42). This may be a draft or recovery write that logs the document path. The `title` field on these lines is `"Untitled"`.
5. **D36 control layout trap.** In the single-window layout, the editor's first line sits at the title-bar height, so a "title bar" click at the editor's x moves the caret. Use the strip above the sidebar instead.
6. **D39.** Large files are auto-degraded to Source mode on open (`editor.large_document.degrade`, `structureThreshold: 25000`), so the brief's "press ⌃2 if it comes up in WYSIWYG" step wasn't needed.
7. **Settings → General** under the corrupt config shows *"Failed to load preferences. Please close and reopen settings."* This is outside D25's scope; noted only.
8. **Session.** The first computer-use request was blocked by another Claude session holding the lock. The user exited that session before the run started.
