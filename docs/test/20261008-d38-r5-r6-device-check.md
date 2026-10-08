# D38 真机复测 r5 / r6：排队确认框关闭后光标留在原处（2026-10-08）

r4 在 `f78990d` 上 D38 未通过（[`20261008-dtrack-r4-device-check.md`](20261008-dtrack-r4-device-check.md)），返工在 `bcdbff8`（[ADR-0061](../adr/0061-a-prompt-that-opens-after-the-capture-also-carries-the-caret.md)）。本记录收两轮 Mac mini 复测，被测都是 `bcdbff8` 的 release 包：r5 跑了 A（两框都批准）、B（批准后拒绝）、C（用户点标题栏），A、B 通过；C 内容正确，但执行方自己的工具调用让窗口失焦，偏离了简报。用户要求 C 严格重跑，r6 由用户点标题栏、执行方全程不调工具，通过。D38 据此关闭。下面 §4 原样收录两份 mini 报告（英文）；排序文档 D38 行、ledger、CHANGELOG 按本记录改写。

## 0. 测量条件

| 项 | 值 |
|---|---|
| 日期 | 2026-10-08；r5 约 12:01–12:16，r6 约 12:20–12:22（GMT+8） |
| 机器 | Mac mini |
| 执行方 | 控制台会话里的 Claude Code（Bash + computer-use）；r5-C 与 r6-C 的标题栏点击、批准、打 `Z` 由用户亲手做 |
| 被测构建 | release，`fix/dtrack-batch` 的 `bcdbff8`（`bcdbff8af01298a8a05ef8ecf7c9ba3aa83c8cf4`），`Contents/MacOS/tauri-app` 的 mtime 为 2026-10-08 11:24:32；`ps` 确认二进制在 `builds/bcdbff8/` 下（r5 pid 19361，r6 pid 25628） |
| 被测代码 | D38 首次修法 `4d1b54d`（[ADR-0060](../adr/0060-a-confirm-prompt-returning-into-the-editor-carries-the-caret.md)）+ 返工 `bcdbff8`（ADR-0061），都在被测构建里 |
| 设置 | 日志开着（Info）；MCP Running（`localhost:55045`），Auto-approve 关；没有改任何设置 |
| 证据存放 | 截图在 mini 的 `~/.mdpro-redesign/dtrack/reports/shots/r5-d38*`、`r6-d38c-*`，**不入库** |

**构建之后的提交**：`bcdbff8` 之后本分支只有 `9896234`（r4 记录，纯文档），D38 涉及的代码没有改动。

## 1. 复核

本记录逐条核对了两份报告的结论与它们自己贴出的日志行是否相符（行号、时间先后、`active` / `promptTarget` / `focus` 字段、HTTP 码），没有发现矛盾；没有另行重读 mini 的 `~/.mdpro/mdpro.log`，下文引用的日志行号与时间戳都出自 mini 报告原文。

## 2. 逐项结论

| 判据 | 结果 | 要点（证据见 §4 原文） |
|---|---|---|
| r5 D38-A 两框都批准 | **通过** | 最终内容 `TWO ONE HelloZ world` / `Last line.`，r1、r2 都是 200。第一次写入记 `editor.milkdown.focus.restore` `restored`、`focus:"deferred"`、`active:"prompt"`、`promptTarget:"old-editor"`（7669）；没有 `skipped:focus-elsewhere`，也没有任何 `ui.mcp_confirm.focus_return` 行 |
| r5 D38-B 批准后拒绝 | **通过** | 最终内容 `ONE HelloZ world`，r2 403 `USER_REJECTED`；第一次写入同样是 deferred（7772），拒绝之后没有 restore 行，光标仍对 |
| r5 D38-C 用户点标题栏 | **内容正确，但偏离简报，被 r6 取代** | 第二次批准后约 2 s 窗口失焦（`window.blur` 7880），执行方认为很可能是自己的工具调用所致，但没有证实；打 `Z` 之前前后共两轮失焦 / 聚焦（7880 / 7887、7889 / 7890），所以它证明的是「光标挺过失焦与标题栏重新聚焦」，不是简报要的那条严格路径 |
| r6 D38-C 严格重跑 | **通过** | 用户点标题栏（`window.focus` 8016）→ 批准 → 批准（8036）→ 打 `Z`（8049，`contentLength` 32→33），8036 与 8049 之间没有 `window.blur` / `window.focus` / `focus_return`；第一次写入 deferred（8031），没有 skip 或 fallback 行；最终内容 `TWO ONE HelloZ world` / `Last line.`，盘上文件一致 |

**D38 的结论**：A、B、C 三种情形下 `Z` 都落在原光标处（`Hello` 之后），不再跑到文末；日志正是 ADR-0061 预期的形态——写入先于下一个框到达时，交还给那个框、由它关闭时回到原光标。D38 关闭。

**本轮没有覆盖的**：

- 确认框超时（60 s，`408`）、关服务撤回（`503`）、关窗口取消这三条关框路径下的光标去向，没有上真机。
- 源码模式下的同一情形（D38 只涉及 WYSIWYG 的重建）。

## 3. 报告 NOTE 的去向（只记录，不是修复）

1. **第二次写入的 restore 行没有类别字段**（r5 7685、7878，r6 8047）：`active` / `promptTarget` / `focus` 只加在 deferred 与 skip 两种行上，第二次写入时最后一个框已关、焦点空闲，走的是普通还原，所以日志里看不出它与 deferred 的区别。行为正确，只是日志少一个维度；以后要区分时再给普通还原行也加字段，本批次不改。
2. **每次批准都是一次整篇重载**（`mcp.insert` `wholesale:true` → reload → mount）：这是 [ADR-0044](../adr/0044-mcp-insert-in-wysiwyg-is-a-wholesale-replace.md) 的既定设计（WYSIWYG 下的 MCP 插入整篇替换），D38 的光标携带正是为它而做；两次重载后光标都对。只记录。
3. **r6 两个请求都等了约 52 s 才批准**（`waitedMs` 52652、52241），离 60 s 超时很近：等的是用户在 mini 前操作，不是产品延迟。将来写简报时，让用户在请求发出后尽快去点，免得一不小心就测成了超时路径。
4. **r5 拒绝之后没有 restore 行**：拒绝不改文档、不重建编辑器，没有要携带的东西；光标应是由第一次写入那次 deferred 还原放好的（报告也只说 presumably）。最终内容对，符合设计。
5. **r5 D38-C 的失焦**：执行方的工具调用（轮询、`wait`、截图）很可能把前台让给了 Terminal。r6 的做法——交给用户之后执行方不再调任何工具，直到用户说「done」——应写进以后需要「不点击直接打字」的简报。
6. **`file.write` 行的 `title` 是 `"Untitled"`**（r5 7883 等），路径却是 `d38c.md`：与 r4 记录的 NOTE 4 同属自动保存 / 草稿写入日志读起来与盘上不符的问题；r5 里自动保存还在窗口失焦、内容没变时写了两次（12:14:17、12:14:48，都是 32 字节），无害。不归 D38，只记录。
7. **r6 用文件启动时窗口标签是 `main`**，r5 的 C 是 `mdpro-<uuid>`：启动带文件开在主窗口、运行中再开则开新窗口，是 D29 的路由设计。
8. **日志没有按键事件**：`Z` 的时刻靠 `editor.milkdown.mount` 的 `contentLength` 32→33 推断。属于测量手段。
9. **r5 的执行偏差**：第一次启动没带文件，留下一个空的 Untitled 窗口，整轮都开着，退出时没有提示；⌘Q 被 computer-use 挡住，改走菜单 **Quit mdpro**；请求从 Bash 工具的 shell 后台发出（发出时 Terminal 在前台，`lsappinfo front` 确认）。r6 的 `disown -a` 打印 `job not found`，无害，两个 curl 都写回了 `200`。都不影响结论。

## 4. 测试报告原文

以下是 mini 报告 `report-20261008-d38-r5.md` 与 `report-20261008-d38c-r6.md` 全文，原样收录，只把标题层级下调两级。

### D38 re-run on `bcdbff8`, round 5 (2026-10-08)

Brief: `brief-20261008-d38-r5.md`. Build: `~/.mdpro-redesign/dtrack/builds/bcdbff8/mdpro.app` (single process, PID 19361, binary confirmed under `builds/bcdbff8/` via `ps`). Device checks only: nothing in the repo was edited, committed or pushed.

Preconditions (checked in Settings, nothing changed): Advanced → Enable Logging **on** (level Info). Integrations → MCP Server **Running** on `localhost:55045`, Auto-approve edits **off**. The MCP token was loaded into a shell variable only; its length (64) was the only thing printed.

#### Results

| Variant | Verdict | Final content (`/api/documents/:id`) | HTTP | How mdpro was focused | Screenshots |
|---|---|---|---|---|---|
| **D38-A** approve both | **PASS** | `TWO ONE HelloZ world` / `Last line.` | r1 `200`, r2 `200` | computer-use `open_application("mdpro")` (app activation) | `shots/r5-d38a-0.png`, `r5-d38a-p1.png` (1st prompt), `r5-d38a-1.png`, `r5-d38a-2.png` |
| **D38-B** reject second | **PASS** | `ONE HelloZ world` / `Last line.` | r1 `200`, r2 `403` `{"error":"User rejected write operation","code":"USER_REJECTED"}` | computer-use `open_application("mdpro")` (app activation) | `r5-d38b-0.png`, `r5-d38b-p1.png` (1st prompt), `r5-d38b-1.png`, `r5-d38b-2.png` |
| **D38-C** user title-bar click | **PASS on content, with a protocol deviation** (see below) | `TWO ONE HelloZ world` / `Last line.` | r1 `200`, r2 `200` | User clicked the title bar (`window.focus` 12:13:52.200, line 7847) and approved both prompts. mdpro then blurred (12:13:58.949) **before Z was typed**. The user re-focused it by title-bar click and typed Z around 12:15:05–12:15:15. | `r5-d38c-0.png`, `r5-d38c-2.png` (no prompt shots: the user drove the prompts) |

All three files on disk match the API content after ⌘S. On every check, the `Z` stayed at the original caret position (after `Hello`). It never landed at the end of the document, as it did in round 4.

Log checks (expected after the fix, step 8). For every variant, the first write's `focus.restore` is `success` / `outcome: restored` / `focus: "deferred"` with `active: "prompt"` and `promptTarget: "old-editor"`. No line contains `skipped:focus-elsewhere`. No `ui.mcp_confirm.focus_return` line appears at all, so none has `outcome: fallback`. (Counted with `grep -cE 'focus-elsewhere|"fallback"|focus_return'` after each mark: 0, 0, 0.)

#### D38-A: log after mark N=7649

Category fields, verbatim: line 7669 `"active":"prompt"`, `"promptTarget":"old-editor"`. The second write's restore (line 7685) has neither field and no `focus` key.

```
7650 {"ts":"2026-10-08T12:01:15.378+08:00","event":"mcp.insert","status":"start","context":{"documentId":"54b8b4507ef52f86","textLength":4}}
7651 {"ts":"2026-10-08T12:01:15.379+08:00","event":"mcp.confirm","status":"start","context":{"documentId":"54b8b4507ef52f86","operation":"insert","queueDepth":1,"requestId":"6d6e97a5-700b-46bd-b4b0-3c101ef98e18","windowLabel":"mdpro-adc572a9-7f55-4a46-b495-3bfa717a5671"}}
7652 {"ts":"2026-10-08T12:01:16.403+08:00","event":"mcp.insert","status":"start","context":{"documentId":"54b8b4507ef52f86","textLength":4}}
7653 {"ts":"2026-10-08T12:01:16.404+08:00","event":"mcp.confirm","status":"start","context":{"documentId":"54b8b4507ef52f86","operation":"insert","queueDepth":2,"requestId":"995bb3c5-21ff-411b-8fef-06daf16c6076","windowLabel":"mdpro-adc572a9-7f55-4a46-b495-3bfa717a5671"}}
7658 {"ts":"2026-10-08T12:01:25.778+08:00","event":"mcp.confirm","status":"success","context":{"documentId":"54b8b4507ef52f86","operation":"insert","outcome":"approved","queueDepth":1,"requestId":"6d6e97a5-700b-46bd-b4b0-3c101ef98e18","waitedMs":10399,"windowLabel":"mdpro-adc572a9-7f55-4a46-b495-3bfa717a5671"}}
7659 {"ts":"2026-10-08T12:01:25.778+08:00","event":"mcp.insert","status":"success","context":{"documentId":"54b8b4507ef52f86","insertOffset":0,"newCursor":4}}
7663 {"ts":"2026-10-08T12:01:25.782+08:00","event":"mcp.insert","status":"success","context":{"documentId":"54b8b4507ef52f86","wholesale":true}}
7669 {"ts":"2026-10-08T12:01:25.794+08:00","event":"editor.milkdown.focus.restore","status":"success","context":{"active":"prompt","anchor":"diff","documentId":"54b8b4507ef52f86","durationMs":1,"focus":"deferred","outcome":"restored","promptTarget":"old-editor","reason":"mcp-insert"}}
7674 {"ts":"2026-10-08T12:01:31.447+08:00","event":"mcp.confirm","status":"success","context":{"documentId":"54b8b4507ef52f86","operation":"insert","outcome":"approved","queueDepth":2,"requestId":"995bb3c5-21ff-411b-8fef-06daf16c6076","waitedMs":15043,"windowLabel":"mdpro-adc572a9-7f55-4a46-b495-3bfa717a5671"}}
7675 {"ts":"2026-10-08T12:01:31.448+08:00","event":"mcp.insert","status":"success","context":{"documentId":"54b8b4507ef52f86","insertOffset":0,"newCursor":4}}
7679 {"ts":"2026-10-08T12:01:31.450+08:00","event":"mcp.insert","status":"success","context":{"documentId":"54b8b4507ef52f86","wholesale":true}}
7685 {"ts":"2026-10-08T12:01:31.462+08:00","event":"editor.milkdown.focus.restore","status":"success","context":{"anchor":"diff","documentId":"54b8b4507ef52f86","durationMs":0,"outcome":"restored","reason":"mcp-insert"}}
```

#### D38-B: log after mark N=7752

Category fields, verbatim: line 7772 `"active":"prompt"`, `"promptTarget":"old-editor"`. The second `mcp.confirm` (line 7777) is `fail` / `outcome: rejected`, followed by `mcp.insert` `fail` `httpStatus: 403`. No `focus.restore` follows the rejection.

```
7753 {"ts":"2026-10-08T12:02:16.042+08:00","event":"mcp.insert","status":"start","context":{"documentId":"a4b85639557bdf66","textLength":4}}
7754 {"ts":"2026-10-08T12:02:16.042+08:00","event":"mcp.confirm","status":"start","context":{"documentId":"a4b85639557bdf66","operation":"insert","queueDepth":1,"requestId":"a12b38fc-f96e-4f9b-a4b8-e486a82d8353","windowLabel":"mdpro-e92d82b5-d935-4def-b362-95bfeb7402d7"}}
7755 {"ts":"2026-10-08T12:02:17.067+08:00","event":"mcp.insert","status":"start","context":{"documentId":"a4b85639557bdf66","textLength":4}}
7756 {"ts":"2026-10-08T12:02:17.067+08:00","event":"mcp.confirm","status":"start","context":{"documentId":"a4b85639557bdf66","operation":"insert","queueDepth":2,"requestId":"16aa41ff-6bbb-4059-845a-0e24c5b894ca","windowLabel":"mdpro-e92d82b5-d935-4def-b362-95bfeb7402d7"}}
7761 {"ts":"2026-10-08T12:02:23.413+08:00","event":"mcp.confirm","status":"success","context":{"documentId":"a4b85639557bdf66","operation":"insert","outcome":"approved","queueDepth":1,"requestId":"a12b38fc-f96e-4f9b-a4b8-e486a82d8353","waitedMs":7370,"windowLabel":"mdpro-e92d82b5-d935-4def-b362-95bfeb7402d7"}}
7762 {"ts":"2026-10-08T12:02:23.413+08:00","event":"mcp.insert","status":"success","context":{"documentId":"a4b85639557bdf66","insertOffset":0,"newCursor":4}}
7766 {"ts":"2026-10-08T12:02:23.417+08:00","event":"mcp.insert","status":"success","context":{"documentId":"a4b85639557bdf66","wholesale":true}}
7772 {"ts":"2026-10-08T12:02:23.429+08:00","event":"editor.milkdown.focus.restore","status":"success","context":{"active":"prompt","anchor":"diff","documentId":"a4b85639557bdf66","durationMs":1,"focus":"deferred","outcome":"restored","promptTarget":"old-editor","reason":"mcp-insert"}}
7777 {"ts":"2026-10-08T12:02:28.713+08:00","event":"mcp.confirm","status":"fail","context":{"documentId":"a4b85639557bdf66","operation":"insert","outcome":"rejected","queueDepth":2,"requestId":"16aa41ff-6bbb-4059-845a-0e24c5b894ca","waitedMs":11645,"windowLabel":"mdpro-e92d82b5-d935-4def-b362-95bfeb7402d7"}}
7778 {"ts":"2026-10-08T12:02:28.713+08:00","event":"mcp.insert","status":"fail","context":{"documentId":"a4b85639557bdf66","httpStatus":403}}
```

#### D38-C: log after mark N=7842 (window focus/blur lines included for context)

Category fields, verbatim: line 7862 `"active":"prompt"`, `"promptTarget":"old-editor"`.

```
7843 {"ts":"2026-10-08T12:13:36.748+08:00","event":"mcp.insert","status":"start","context":{"documentId":"5c469b97b855ed6d","textLength":4}}
7844 {"ts":"2026-10-08T12:13:36.749+08:00","event":"mcp.confirm","status":"start","context":{"documentId":"5c469b97b855ed6d","operation":"insert","queueDepth":1,"requestId":"dbc9d8ce-3442-45ac-8ba8-38538864ee10","windowLabel":"mdpro-dab88e4e-4ccc-43f8-a9be-3226774441ab"}}
7845 {"ts":"2026-10-08T12:13:37.771+08:00","event":"mcp.insert","status":"start","context":{"documentId":"5c469b97b855ed6d","textLength":4}}
7846 {"ts":"2026-10-08T12:13:37.771+08:00","event":"mcp.confirm","status":"start","context":{"documentId":"5c469b97b855ed6d","operation":"insert","queueDepth":2,"requestId":"747e2947-d865-4bac-b567-e0c4a64b8ef3","windowLabel":"mdpro-dab88e4e-4ccc-43f8-a9be-3226774441ab"}}
7847 {"ts":"2026-10-08T12:13:52.200+08:00","event":"window.focus","status":"success","context":{"windowId":"mdpro-dab88e4e-4ccc-43f8-a9be-3226774441ab","windowLabel":"mdpro-dab88e4e-4ccc-43f8-a9be-3226774441ab"}}
7851 {"ts":"2026-10-08T12:13:53.573+08:00","event":"mcp.confirm","status":"success","context":{"documentId":"5c469b97b855ed6d","operation":"insert","outcome":"approved","queueDepth":1,"requestId":"dbc9d8ce-3442-45ac-8ba8-38538864ee10","waitedMs":16824,"windowLabel":"mdpro-dab88e4e-4ccc-43f8-a9be-3226774441ab"}}
7852 {"ts":"2026-10-08T12:13:53.573+08:00","event":"mcp.insert","status":"success","context":{"documentId":"5c469b97b855ed6d","insertOffset":0,"newCursor":4}}
7856 {"ts":"2026-10-08T12:13:53.580+08:00","event":"mcp.insert","status":"success","context":{"documentId":"5c469b97b855ed6d","wholesale":true}}
7862 {"ts":"2026-10-08T12:13:53.593+08:00","event":"editor.milkdown.focus.restore","status":"success","context":{"active":"prompt","anchor":"diff","documentId":"5c469b97b855ed6d","durationMs":1,"focus":"deferred","outcome":"restored","promptTarget":"old-editor","reason":"mcp-insert"}}
7867 {"ts":"2026-10-08T12:13:56.781+08:00","event":"mcp.confirm","status":"success","context":{"documentId":"5c469b97b855ed6d","operation":"insert","outcome":"approved","queueDepth":2,"requestId":"747e2947-d865-4bac-b567-e0c4a64b8ef3","waitedMs":19009,"windowLabel":"mdpro-dab88e4e-4ccc-43f8-a9be-3226774441ab"}}
7868 {"ts":"2026-10-08T12:13:56.781+08:00","event":"mcp.insert","status":"success","context":{"documentId":"5c469b97b855ed6d","insertOffset":0,"newCursor":4}}
7872 {"ts":"2026-10-08T12:13:56.785+08:00","event":"mcp.insert","status":"success","context":{"documentId":"5c469b97b855ed6d","wholesale":true}}
7878 {"ts":"2026-10-08T12:13:56.800+08:00","event":"editor.milkdown.focus.restore","status":"success","context":{"anchor":"diff","documentId":"5c469b97b855ed6d","durationMs":0,"outcome":"restored","reason":"mcp-insert"}}
7880 {"ts":"2026-10-08T12:13:58.949+08:00","event":"window.blur","status":"success","context":{"windowId":"mdpro-dab88e4e-4ccc-43f8-a9be-3226774441ab","windowLabel":"mdpro-dab88e4e-4ccc-43f8-a9be-3226774441ab"}}
7887 {"ts":"2026-10-08T12:15:05.540+08:00","event":"window.focus","status":"success","context":{"windowId":"mdpro-dab88e4e-4ccc-43f8-a9be-3226774441ab","windowLabel":"mdpro-dab88e4e-4ccc-43f8-a9be-3226774441ab"}}
7889 {"ts":"2026-10-08T12:15:09.218+08:00","event":"window.blur","status":"success","context":{"windowId":"mdpro-dab88e4e-4ccc-43f8-a9be-3226774441ab","windowLabel":"mdpro-dab88e4e-4ccc-43f8-a9be-3226774441ab"}}
7890 {"ts":"2026-10-08T12:15:11.809+08:00","event":"window.focus","status":"success","context":{"windowId":"mdpro-dab88e4e-4ccc-43f8-a9be-3226774441ab","windowLabel":"mdpro-dab88e4e-4ccc-43f8-a9be-3226774441ab"}}
7895 {"ts":"2026-10-08T12:15:18.332+08:00","event":"window.blur","status":"success","context":{"windowId":"mdpro-dab88e4e-4ccc-43f8-a9be-3226774441ab","windowLabel":"mdpro-dab88e4e-4ccc-43f8-a9be-3226774441ab"}}
```

What deviated in D38-C:
- After the second Approve (12:13:56.78), I polled the `.out` files and then called computer-use `wait` and `screenshot`. At 12:13:58.949 mdpro logged `window.blur` and Terminal was frontmost. The user had not typed Z yet. I believe my own tool activity took focus away from mdpro, but I didn't confirm this.
- I asked the user to bring mdpro back with **one title-bar click only** and then type Z. The log shows `window.focus` 7887 (12:15:05.540), `window.blur` 7889 (12:15:09.218) and `window.focus` 7890 (12:15:11.809). So there were **two** blur/focus cycles before the final content, not one.
- Between those lines, three `editor.milkdown.mount` lines show `contentLength` going 33 → 32 → 33 (lines 7888, 7891, 7892 at 12:15:06.773, 12:15:13.584 and 12:15:15.324). The log alone doesn't show whether Z was typed once, or typed, removed and typed again. The final content has exactly one Z, in the right place.
- So D38-C shows the caret position **survives a blur and a title-bar re-focus**. It does **not** show the strict brief sequence: title-bar click → Approve → Approve → Z with no focus change in between. It should be re-run if that exact path matters.

#### Deviations from the brief (all variants)

1. **Launch:** my first launch was `open …/builds/bcdbff8/mdpro.app` **without** `d38a.md`, which opened an empty Untitled window (Source mode). I didn't quit and relaunch. Instead I opened `d38a.md` into the same instance with `open -a …/builds/bcdbff8/mdpro.app $S/d38a.md` (full path, new window). Before launching, `pgrep -fl 'mdpro.app'` was empty. The empty Untitled window stayed open the whole session, behind the test windows. It caused no prompt at quit.
2. **Screenshots** were saved with `screencapture -x` at each step. The "first prompt" shot that step 4 asks for (no name given) is saved as `r5-d38{a,b}-p1.png`.
3. **⌘Q** was blocked by the computer-use tool (system key combo not granted), so I quit through the **mdpro → Quit mdpro** menu item instead. No unsaved-changes prompt appeared. The log ends `app.quit` `success` (12:15:58.817) and then `mcp.http_server.stop` `stopped`. Afterwards `pgrep -fl 'mdpro.app'` was empty.
4. The step-3 requests were backgrounded from the Bash tool's shell, not typed in Terminal. Terminal was brought to the front with `open_application("Terminal")` first, and `lsappinfo front` confirmed Terminal was frontmost when each pair was fired.

#### Build

- `git -C /Users/jack/Documents/mac-app/mdpro rev-parse HEAD` → `bcdbff8af01298a8a05ef8ecf7c9ba3aa83c8cf4`
- `stat -f '%Sm' …/builds/bcdbff8/mdpro.app/Contents/MacOS/tauri-app` → `Oct  8 11:24:32 2026`

#### NOTEs (not fixes)

- The second write's `focus.restore` (A: 7685, C: 7878) logs `restored` with no `active`, `promptTarget` or `focus` key. This matches the brief: the fields are only added to the deferred and skipped lines. But it means you can't tell from the log whether the last restore went through the deferred path.
- In D38-B, no `focus.restore` line follows the rejected write. The caret still ended up right, presumably because the restore after the first (approved) write had already put it there.
- `file.write` lines for d38c carry `"title":"Untitled"` (7883, 7885, 7893), even though the path is `…/r5/d38c.md`. That is cosmetic or a metadata mismatch, not part of D38.
- In D38-C, focus left mdpro about 2 s after the last Approve, with no user action. If my tooling caused it (likely), future briefs that need "type without clicking" should have the user type Z right after the second Approve, before the agent calls any tool.
- Auto-save (30 s) wrote d38c at 12:14:17 and 12:14:48 while it was blurred and unchanged (32 bytes both times). Harmless.

### D38-C strict re-run, round 6: `bcdbff8` (2026-10-08)

**Verdict: PASS.** Final content `TWO ONE HelloZ world` / `Last line.` · r1 `200`, r2 `200` · no `window.blur` between the second `mcp.confirm` approval (8036, 12:21:36.777) and the `Z` edit (8049, 12:21:38.019). The first blur after the mark is 8050 (12:21:40.735).

| Item | Value |
|---|---|
| Build | `bcdbff8af01298a8a05ef8ecf7c9ba3aa83c8cf4` (`git -C /Users/jack/Documents/mac-app/mdpro rev-parse HEAD`) |
| Bundle mtime | `Oct  8 11:24:32 2026` (`builds/bcdbff8/mdpro.app/Contents/MacOS/tauri-app`) |
| Binary check | pid 25628 `/Users/jack/.mdpro-redesign/dtrack/builds/bcdbff8/mdpro.app/Contents/MacOS/tauri-app` |
| Launch | `open -a …/builds/bcdbff8/mdpro.app $S/d38c.md`, with no mdpro running beforehand (`pgrep` empty) |
| Preconditions | Opened in WYSIWYG (title shows `WYSIWYG`, so ⌃4 not needed). Settings → Integrations: MCP **Running**, Auto-approve **off**. Advanced: Enable Logging **on**, level Info. Nothing changed. |
| Doc id | `C=66150dd66901a8dd`, port 55045, token 64 chars (not printed) |
| Log mark | `N=8011`, requests fired 12:20:43 |
| How mdpro was focused | The user clicked the title bar (`window.focus` 8016, 12:21:33.685). The agent made **no tool calls** from the handover message until the user said "done". |
| Final content (`/api/documents/$C`) | `TWO ONE HelloZ world` / (blank) / `Last line.`. The saved file on disk is identical. |
| `d38c-r1.out` | `{"success":true,"new_cursor":4}200` |
| `d38c-r2.out` | `{"success":true,"new_cursor":4}200` |
| Screenshots | `reports/shots/r6-d38c-0.png` (caret `Hello|world`, before the requests), `reports/shots/r6-d38c-2.png` (12:21:52, after "done") |

#### Ordering check (step 5)

```
8016 12:21:33.685 window.focus                     ← user's title-bar click
8020 12:21:36.154 mcp.confirm approved (req 1)
8026 12:21:36.162 editor.milkdown.mount  len 28
8031 12:21:36.172 focus.restore restored, focus:deferred, active:prompt, promptTarget:old-editor
8036 12:21:36.777 mcp.confirm approved (req 2)     ← last approval
8042 12:21:36.784 editor.milkdown.mount  len 32
8047 12:21:36.795 focus.restore restored (no category fields)
8049 12:21:38.019 editor.milkdown.mount  len 33    ← Z (32 → 33 chars)
8050 12:21:40.735 window.blur                      ← after Z
```
Between 8036 and 8049 there is no `window.blur`, no `window.focus` and no `ui.mcp_confirm.focus_return`. There is no `skipped:focus-elsewhere` line and no `outcome: fallback` line anywhere after the mark.

`active` / `promptTarget`, verbatim, only on 8031: `"active":"prompt"`, `"promptTarget":"old-editor"`.

#### Log lines after mark N=8011 (step 6, filtered)

```
8012 {"ts":"2026-10-08T12:20:43.501+08:00","level":"info","event":"mcp.insert","status":"start","actionId":null,"context":{"documentId":"66150dd66901a8dd","textLength":4},"durationMs":null,"error":null}
8013 {"ts":"2026-10-08T12:20:43.502+08:00","level":"info","event":"mcp.confirm","status":"start","actionId":null,"context":{"documentId":"66150dd66901a8dd","operation":"insert","queueDepth":1,"requestId":"a62ee77d-be7d-47cd-97dd-ab1dfa61d51d","windowLabel":"main"},"durationMs":null,"error":null}
8014 {"ts":"2026-10-08T12:20:44.535+08:00","level":"info","event":"mcp.insert","status":"start","actionId":null,"context":{"documentId":"66150dd66901a8dd","textLength":4},"durationMs":null,"error":null}
8015 {"ts":"2026-10-08T12:20:44.535+08:00","level":"info","event":"mcp.confirm","status":"start","actionId":null,"context":{"documentId":"66150dd66901a8dd","operation":"insert","queueDepth":2,"requestId":"1c68cfdb-9b0a-485f-adb2-ee918d642577","windowLabel":"main"},"durationMs":null,"error":null}
8016 {"ts":"2026-10-08T12:21:33.685+08:00","level":"info","event":"window.focus","status":"success","actionId":null,"context":{"windowId":"main","windowLabel":"main"},"durationMs":null,"error":null}
8020 {"ts":"2026-10-08T12:21:36.154+08:00","level":"info","event":"mcp.confirm","status":"success","actionId":null,"context":{"documentId":"66150dd66901a8dd","operation":"insert","outcome":"approved","queueDepth":1,"requestId":"a62ee77d-be7d-47cd-97dd-ab1dfa61d51d","waitedMs":52652,"windowLabel":"main"},"durationMs":null,"error":null}
8021 {"ts":"2026-10-08T12:21:36.154+08:00","level":"info","event":"mcp.insert","status":"success","actionId":null,"context":{"documentId":"66150dd66901a8dd","insertOffset":0,"newCursor":4},"durationMs":null,"error":null}
8025 {"ts":"2026-10-08T12:21:36.159+08:00","level":"info","event":"mcp.insert","status":"success","actionId":null,"context":{"documentId":"66150dd66901a8dd","wholesale":true},"durationMs":null,"error":null}
8026 {"ts":"2026-10-08T12:21:36.162+08:00","level":"info","event":"editor.milkdown.mount","status":"success","actionId":"3424e30a-d587-4d0b-9a0e-c2a2e220cfb2","context":{"contentLength":28,"documentId":"66150dd66901a8dd","hasContent":true},"durationMs":null,"error":null}
8031 {"ts":"2026-10-08T12:21:36.172+08:00","level":"info","event":"editor.milkdown.focus.restore","status":"success","actionId":"619c26cd-3da5-4713-9b36-cc956ce9cf64","context":{"active":"prompt","anchor":"diff","documentId":"66150dd66901a8dd","durationMs":0.9999999999708962,"focus":"deferred","outcome":"restored","promptTarget":"old-editor","reason":"mcp-insert"},"durationMs":null,"error":null}
8036 {"ts":"2026-10-08T12:21:36.777+08:00","level":"info","event":"mcp.confirm","status":"success","actionId":null,"context":{"documentId":"66150dd66901a8dd","operation":"insert","outcome":"approved","queueDepth":2,"requestId":"1c68cfdb-9b0a-485f-adb2-ee918d642577","waitedMs":52241,"windowLabel":"main"},"durationMs":null,"error":null}
8037 {"ts":"2026-10-08T12:21:36.777+08:00","level":"info","event":"mcp.insert","status":"success","actionId":null,"context":{"documentId":"66150dd66901a8dd","insertOffset":0,"newCursor":4},"durationMs":null,"error":null}
8041 {"ts":"2026-10-08T12:21:36.782+08:00","level":"info","event":"mcp.insert","status":"success","actionId":null,"context":{"documentId":"66150dd66901a8dd","wholesale":true},"durationMs":null,"error":null}
8042 {"ts":"2026-10-08T12:21:36.784+08:00","level":"info","event":"editor.milkdown.mount","status":"success","actionId":"97a9cad9-3196-484c-ab2b-a2d5113f57e3","context":{"contentLength":32,"documentId":"66150dd66901a8dd","hasContent":true},"durationMs":null,"error":null}
8047 {"ts":"2026-10-08T12:21:36.795+08:00","level":"info","event":"editor.milkdown.focus.restore","status":"success","actionId":"f26d2f74-2e04-4e57-9d1f-22f6d0bb52c0","context":{"anchor":"diff","documentId":"66150dd66901a8dd","durationMs":0,"outcome":"restored","reason":"mcp-insert"},"durationMs":null,"error":null}
8049 {"ts":"2026-10-08T12:21:38.019+08:00","level":"info","event":"editor.milkdown.mount","status":"success","actionId":"abd45671-9634-44a7-b2de-61249ab53310","context":{"contentLength":33,"documentId":"66150dd66901a8dd","hasContent":true},"durationMs":null,"error":null}
8050 {"ts":"2026-10-08T12:21:40.735+08:00","level":"info","event":"window.blur","status":"success","actionId":null,"context":{"windowId":"main","windowLabel":"main"},"durationMs":null,"error":null}
```
No `ui.mcp_confirm.focus_return` line appears.

#### Save and quit (step 7)

The agent brought mdpro forward with `open_application("mdpro")` (`window.focus` 8053, 12:22:02.466) and pressed ⌘S (`file.save` success, 8058; a "Saved" toast appeared). It then chose mdpro menu → **Quit mdpro** (`app.quit.request` 8066). No unsaved-changes prompt appeared. `pgrep -fl 'mdpro.app'` is empty afterwards.

#### NOTEs (not fixes)

- The log has no keystroke event. The `Z` time comes from the `editor.milkdown.mount` at 8049, where `contentLength` goes 32 → 33. That mount is the only line between the last restore and the blur.
- The blur at 8050 (12:21:40.735) comes about 2.7 s after `Z`. It is most likely the user switching to Terminal to type "done". No agent tool was running then.
- Because of that, `r6-d38c-2.png` was taken with mdpro in the background. The content check relies on the API read and the saved file, not on the screenshot.
- Launching with the file gave the window the label `main`. In round 5, D38-C windows had `mdpro-<uuid>` labels. All `mcp.confirm` lines carry `"windowLabel":"main"`.
- As in round 5, the second write's `focus.restore` (8047) has no `active`, `promptTarget` or `focus` key.
- Each approval is followed by a wholesale reload: `mcp.insert` `wholesale:true` → `editor.milkdown.reload` → `mount`. The caret still landed correctly after both reloads.
- Both requests waited about 52 s for approval (`waitedMs` 52652 and 52241), close to the 60 s timeout.
- The `disown -a` in the firing shell printed `job not found`, which is harmless. Both background curls finished and wrote `200`.
