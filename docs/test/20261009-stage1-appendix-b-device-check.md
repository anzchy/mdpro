# Stage 1 Appendix B 真机前后对比（2026-10-09）

本轮在 Mac mini（1920×1080，@1x）上分别用 `73c7620`（Stage 1 之前）和 `c961798`（WI-1.2 搬移之后）的 release 包，按 brief `20261009-brief-stage1-appendix-b.md`，对 [Appendix B](../plans/20260911-ui-redesign/appendices.md) 的 Tauri-only 单元格各拍一组前后对照。判据是逐像素比较（`pngdiff`），用来核验 [`stage-1-split.md`](../plans/20260911-ui-redesign/stage-1-split.md) 的最后一条验收标准：「Tauri-only cells show no visible difference」。截图不进仓库，留在 Mini 的 `~/.mdpro-redesign/dtrack/reports/shots/`。

## 裁定（用户，2026-10-09）

**判 MET。** 用户原话：「判 MET，a3 收尾 (Recommended)」。

按 brief 的原规则，本次结论是 **INCONCLUSIVE**，两个层级都**没有 FAIL**：

- 60 个「单元格 × 主题」的比较行中，52 行的最佳配对是 `IDENTICAL`。
- A1 `busy-open` 判 PASS (dynamic)，差异只在旋转的 busy spinner 里。

裁定把下面两处文字视为动态区域：它们的**内容**在前后两遍中本来就不同，差异由构造决定，与样式无关。

| 单元格 | 不同的内容 | 遮罩矩形（左上角原点，px） | 遮罩后 |
|---|---|---|---|
| A14 `draft-recovery`（浅色、深色） | 草稿行里的 scratch 路径（`…/before/…` 对 `…/after/…`）和草稿时间戳 | x450–595，y420–465 | `IDENTICAL 1200x800` |
| A15 `encoding`（浅色、深色） | 对话框里的 scratch 路径，折行位置随之不同 | x405–800，y380–420 | `IDENTICAL 1200x800` |

有了这条裁定，Tier A 每个单元格都是 PASS、PASS (dynamic)，或带理由的 NOT RUN。两个层级都没有 FAIL。

另有两处不影响结论，在此说明：

- **B10 `focus-settings-rail`：NOT VERIFIED。** 它属于 Tier B，不阻塞验收。
  - 从 Settings 打开时的状态开始，连按 12 次 Tab，焦点环始终没有落到「General」。前 9 次落在其余 9 个 rail 项，第 10、11 次落在两个 select 上，第 12 次落在一个不显示焦点环的控件上。
  - 这个 Tab 顺序在两遍、两种主题下完全一致。按 12 次之后的画面前后 `IDENTICAL`。
  - 「General」只在冷启动后第一次 ⌘, 时显示焦点环，前后两遍都是这样。
  - 这是焦点行为（rule 33 / WI-3.x 的范围），不是 Stage 1 的样式差异。
- **A16 拖放，检查 (b)：在字面上未满足。** 检查 (a)（前后对比）在所有帧上都是 `IDENTICAL`。
  - 检查 (b) 要求同一遍里的悬停帧等于空闲帧。实际两者恰好差 `DIFF 516 px bbox x=9...68 y=9...22`，8 组悬停全部如此。
  - 这块区域是 macOS 的红绿灯按钮：拖动悬停在非活动窗口上时，macOS 把它们画成彩色。空闲帧是在 Finder 位于前台时拍的，按钮是灰色。
  - 这是窗口外框，不是应用 CSS；两个构建表现相同；两个构建都没有画出任何拖放目标。
  - 2026-10-05 那次判定「相等」，可能是空闲帧的拍法不同。

本次顺带发现一个工具问题，不影响结论：原生 Open 面板打开时，`scripts/redesign/device/winid.js` 先列出面板，所以 `shot.sh` 拍到的是面板而不是主窗口（A1，见下文偏差 7）。EXEC 在本次运行中改用 scratch 变体 `shotmain.sh` 规避，仓库里的脚本没有改动。

## 完整报告（EXEC 原文，英文）

Brief: `brief-20261009-stage1-appendix-b.md`. Dispatch: `ALLOW_MCP_TOGGLE=yes`, scope Tier A + Tier B (all rows).
EXEC ran both passes on this Mac with Bash and computer-use, 12:15–12:57 GMT+8. No user steps (U1–U4) were needed.

### Overall

**INCONCLUSIVE** under the brief's rule as written. There is **no FAIL** in either tier.

- **52 of 60 compared cell × theme rows** have an `IDENTICAL` best pairing (PASS).
- **A1 `busy-open`** (both themes) is **PASS (dynamic)**. The diff is only inside the busy spinner.
- **Three cells are NOT VERIFIED, in both themes:**
  - **B10** is Tier B. The ring never reached "General" within 12 Tab presses in either pass. B10 alone does not block MET.
  - **A15 `encoding`** and **A14 `draft-recovery`** are Tier A. In each, the only differing pixels are dialog text whose *content* differs between passes by construction:
    - A15 shows the scratch path, `…/stage1-appb/before/…` vs `…/after/…`.
    - A14 shows that path plus the draft timestamp.
  - In all four of those rows, a masked `pngdiff` that excludes just that text box is `IDENTICAL` over the rest of the 1200×800 frame.
  - These are state (content) differences, not style differences, so per the brief they are never FAIL. Text is not a named dynamic region, though, so they cannot be PASS (dynamic) either.

**If the delegator accepts "path/timestamp text whose content differs by construction" as a dynamic region for A15/A14, the criterion becomes MET.** Every Tier A cell would then be PASS or PASS (dynamic), and there is no FAIL.

The A16 within-pass check (b) is not literally met; see A16. The hover frame differs from idle only in the macOS traffic-light buttons, identically in both builds.

### Build

| | before (`APP_B`) | after (`APP_A`) |
|---|---|---|
| App | `~/.mdpro-redesign/dtrack/builds/73c7620/mdpro.app` | `~/.mdpro-redesign/dtrack/builds/c961798/mdpro.app` |
| `Contents/MacOS/tauri-app` mtime | Oct 9 12:03:11 2026 | Oct 9 12:04:31 2026 |
| Worktree HEAD | `WT_B` = `73c762002d0c02d3b904f4c1711088c8f41018ed` | `WT_A` = `c9617987281fdf89ad9401019869639ffd4b0614` |

`git -C $WT_A diff --stat 73c7620 c961798 -- src-tauri tests/manual-fixtures scripts/redesign/device` printed nothing:

```
--- diff stat:
--- end
```

**Launches** (PID, `ps` path, proof):

| Pass | When | PID | `ps` path | Log |
|---|---|---|---|---|
| before | P.0 cold launch with `light/surf.md` | 3263 | `…/builds/73c7620/mdpro.app/Contents/MacOS/tauri-app` | `8696: file.open.external start {"appReady": false, "filePaths": ["$S/before/light/surf.md"]}`, `8704: app.ready {"pid": 3263}` |
| before | A14-light relaunch (`open -a`, no file) | 13809 | same | `9060: app.ready {"pid": 13809}` |
| before | A14-dark relaunch | 19867 | same | `9444: app.ready {"pid": 19867}` |
| after | P.0 cold launch with `light/surf.md` | 20490 | `…/builds/c961798/mdpro.app/Contents/MacOS/tauri-app` | `9506: file.open.external start {"appReady": false, "filePaths": ["$S/after/light/surf.md"]}`, `9514: app.ready {"pid": 20490}` |
| after | A14-light relaunch | 26042 | same | `9853: app.ready {"pid": 26042}` |
| after | A14-dark relaunch | 31762 | same | `10235: app.ready {"pid": 31762}` |

`pgrep -fl tauri-app` was empty before the after pass launched (after the before pass's menu Quit at 12:41:06) and again at the end (12:56:40).

### Machine

- **Display:** `Resolution: 1920 x 1080 (1080p FHD - Full High Definition)`. No `Retina` line, so @1x.
- **Input source:** `AppleSelectedInputSources` → `"KeyboardLayout Name" = ABC` (ID 252). U1 was not needed.
- **`AppleKeyboardUIMode`:** `2`, so keyboard navigation is on and B10 ran.
- **`pngdiff`:** built at `~/.mdpro-redesign/dtrack/tools/pngdiff`. The self-test `pngdiff X X` printed `IDENTICAL 1920x1080`.
- **Stray process:** none. The `pgrep -fl 'mdpro|tauri-app'` hits were only shell/tmux command lines containing the string "mdpro", not an app process.

### Settings as found (read before the before pass; look only)

| Setting | As found | Changed? |
|---|---|---|
| Theme menu | **System**. The menu shows no check mark, so the value was read from the last `ui.menu.select` in `mdpro.log` (`4511: menu.theme.system`). It rendered light because macOS is in Light appearance. | Switched per pass (Light → Dark). Restored to **System** at the end of each pass: before at log `9477`, after at `10268`. |
| View mode | **WYSIWYG** | ⌃2 / ⌃4 during cells. Restored to WYSIWYG at the end of each pass: `9482`, `10273`. |
| General › Auto-save Interval | 30 seconds | No |
| General › Default View Mode | WYSIWYG | No |
| Advanced › Enable Logging / Log Level | on / Info | No. U3 was not needed. |
| Integrations › Enable MCP Server | **Running** (`localhost:55045`). Start on launch off, Auto-approve off. | Toggled off and back on in A2, 4 times. Each time "Running" was confirmed restored. The port stayed 55045 throughout. |
| Appearance › Code Block Theme | Default | No |

No other setting was touched. The after pass repeated the same look-only Settings open (General → Advanced → Integrations → Appearance → Close) right after launch, so that both passes have the same action sequence.

### Verdict table

The "best pairing" is the before × after pair with the fewest differing pixels, out of all 9 pairings. All 540 pairings are in `reports/stage1-appb-pngdiff-all.txt`. Shots are in `reports/shots/`, named `s1b-<cell>-<theme>-<pass>-<k>.png`. All 360 burst frames reported the expected size (1200×800, or 400×640 / 959×800 / 900×800 for the narrow cells).

#### Tier B

| Cell | Theme | Verdict | Best pairing `pngdiff` | Shots (best pair) | Reason |
|---|---|---|---|---|---|
| B1 `main-source` | light | PASS | `IDENTICAL 1200x800` | before-1 × after-2 | |
| B1 `main-source` | dark | PASS | `IDENTICAL 1200x800` | before-1 × after-1 | |
| B2 `main-source-nosidebar` | light | PASS | `IDENTICAL 1200x800` | 1 × 1 | |
| B2 `main-source-nosidebar` | dark | PASS | `IDENTICAL 1200x800` | 1 × 1 | |
| B3 `narrow-400x640` | light | PASS | `IDENTICAL 400x640` | 1 × 1 | |
| B3 `narrow-400x640` | dark | PASS | `IDENTICAL 400x640` | 1 × 1 | |
| B3 `narrow-400x640-nosidebar` | light | PASS | `IDENTICAL 400x640` | 1 × 1 | |
| B3 `narrow-400x640-nosidebar` | dark | PASS | `IDENTICAL 400x640` | 1 × 2 | |
| B4 `narrow-959x800` | light | PASS | `IDENTICAL 959x800` | 1 × 1 | |
| B4 `narrow-959x800` | dark | PASS | `IDENTICAL 959x800` | 1 × 1 | |
| B5 `narrow-900x800` | light | PASS | `IDENTICAL 900x800` | 1 × 1 | |
| B5 `narrow-900x800` | dark | PASS | `IDENTICAL 900x800` | 1 × 2 | |
| B6 `settings-general` | light | PASS | `IDENTICAL 1200x800` | 1 × 1 | |
| B6 `settings-general` | dark | PASS | `IDENTICAL 1200x800` | 1 × 1 | |
| B10 `focus-settings-rail` | light | **NOT VERIFIED** | (`IDENTICAL 1200x800`, informational) | 1 × 1 | No ring on "General" within 12 Tabs in either pass (see B10). |
| B10 `focus-settings-rail` | dark | **NOT VERIFIED** | (`IDENTICAL 1200x800`, informational) | 1 × 1 | Same. |
| A2 `settings-integrations-on` | light | PASS | `IDENTICAL 1200x800` | 1 × 1 | Badge "Running" in both. |
| A2 `settings-integrations-on` | dark | PASS | `IDENTICAL 1200x800` | 1 × 1 | Badge "Running" in both. |
| A2 `settings-integrations-off` | light | PASS | `IDENTICAL 1200x800` | 1 × 1 | Badge "Off" in both. |
| A2 `settings-integrations-off` | dark | PASS | `IDENTICAL 1200x800` | 1 × 1 | Badge "Off" in both. |
| A3 `settings-about` | light | PASS | `IDENTICAL 1200x800` | 1 × 1 | Settled text "Automatic updates coming soon." in both. |
| A3 `settings-about` | dark | PASS | `IDENTICAL 1200x800` | 1 × 1 | Same. |
| B7 `settings-narrow` | light | PASS | `IDENTICAL 400x640` | 1 × 1 | |
| B7 `settings-narrow` | dark | PASS | `IDENTICAL 400x640` | 1 × 1 | |
| B8 `link-modal` | light | PASS | `IDENTICAL 1200x800` | 1 × 1 | Word "One" selected. |
| B8 `link-modal` | dark | PASS | `IDENTICAL 1200x800` | 1 × 1 | Word "One" selected. |
| B9 `table-insert` | light | PASS | `IDENTICAL 1200x800` | 1 × 1 | |
| B9 `table-insert` | dark | PASS | `IDENTICAL 1200x800` | 1 × 1 | |

#### Tier A

| Cell | Theme | Verdict | Best pairing `pngdiff` | Shots (best pair) | Reason |
|---|---|---|---|---|---|
| A1 `busy-open` | light | **PASS (dynamic)** | `DIFF 124 px bbox x=239...256 y=8...25` | before-3 × after-3 | The bbox is the busy spinner (18×18 px left of "Opening file..."). The label is present in both. Masked (spinner box x232–262, y2–31): `IDENTICAL 1200x800`. |
| A1 `busy-open` | dark | **PASS (dynamic)** | `DIFF 84 px bbox x=239...256 y=8...25` | before-2 × after-2 | Same. Masked: `IDENTICAL 1200x800`. |
| A15 `encoding` | light | **NOT VERIFIED** | `DIFF 869 px bbox x=412...787 y=388...414` | 1 × 1 | State: the dialog prints the file path, `…/stage1-appb/before/light/latin1.md` vs `…/after/light/latin1.md`, which wraps differently. Masked (x405–800, y380–420): `IDENTICAL 1200x800`. |
| A15 `encoding` | dark | **NOT VERIFIED** | `DIFF 827 px bbox x=412...788 y=388...414` | 1 × 1 | Same. Masked: `IDENTICAL 1200x800`. |
| A6 `toast-error-open` | light | PASS | `IDENTICAL 1200x800` | 1 × 1 | "Failed to open file" in all 3 shots of each pass. |
| A6 `toast-error-open` | dark | PASS | `IDENTICAL 1200x800` | 1 × 1 | Same. |
| A7 `toast-large-degrade` | light | PASS | `IDENTICAL 1200x800` | 2 × 2 | Guard toast in both passes. The app switched to Source (`view.mode.change … programmatic`). Pairing 1 × 1 differs in the tab strip only (toast/tab animation frame timing); the best pairing is identical. |
| A7 `toast-large-degrade` | dark | PASS | `IDENTICAL 1200x800` | 2 × 2 | Same. |
| A8 `toast-large-withhold` | light | PASS | `IDENTICAL 1200x800` | 2 × 2 | Withhold toast in both passes. |
| A8 `toast-large-withhold` | dark | PASS | `IDENTICAL 1200x800` | 2 × 2 | Same. |
| A4 `toast-saved` | light | PASS | `IDENTICAL 1200x800` | 1 × 1 | "Saved" toast in both. |
| A4 `toast-saved` | dark | PASS | `IDENTICAL 1200x800` | 1 × 1 | Same. |
| A12 `extchange-modified` | light | PASS | `IDENTICAL 1200x800` | 1 × 1 | |
| A12 `extchange-modified` | dark | PASS | `IDENTICAL 1200x800` | 1 × 1 | |
| A13 `extchange-deleted` | light | PASS | `IDENTICAL 1200x800` | 1 × 1 | Non-destructive button: **Ignore**. |
| A13 `extchange-deleted` | dark | PASS | `IDENTICAL 1200x800` | 1 × 1 | Same. |
| A5 `toast-error-save` | light | PASS | `IDENTICAL 1200x800` | 1 × 1 | "Save failed: [object Object]" in both. |
| A5 `toast-error-save` | dark | PASS | `IDENTICAL 1200x800` | 1 × 1 | Same. |
| A9 `confirm-cmdw` | light | PASS | `IDENTICAL 1200x800` | 1 × 1 | |
| A9 `confirm-cmdw` | dark | PASS | `IDENTICAL 1200x800` | 1 × 1 | |
| A10 `confirm-quit` | light | PASS | `IDENTICAL 1200x800` | 1 × 1 | Non-quitting button: **Keep editing**. |
| A10 `confirm-quit` | dark | PASS | `IDENTICAL 1200x800` | 1 × 1 | Same. |
| A11 `mcp-confirm` | light | PASS | `IDENTICAL 1200x800` | 1 × 1 | Inactive window in both. HTTP 403 in both. |
| A11 `mcp-confirm` | dark | PASS | `IDENTICAL 1200x800` | 1 × 1 | Same. |
| A16 `dragdrop-idle` | light | PASS | `IDENTICAL 1200x800` | 1 × 1 | |
| A16 `dragdrop-idle` | dark | PASS | `IDENTICAL 1200x800` | 1 × 1 | |
| A16 `dragdrop-hover-md` | light | PASS (a) | `IDENTICAL 1200x800` | 1 × 1 | (b) See A16 note. |
| A16 `dragdrop-hover-md` | dark | PASS (a) | `IDENTICAL 1200x800` | 1 × 1 | (b) See A16 note. |
| A16 `dragdrop-hover-image` | light | PASS (a) | `IDENTICAL 1200x800` | 1 × 1 | (b) See A16 note. |
| A16 `dragdrop-hover-image` | dark | PASS (a) | `IDENTICAL 1200x800` | 1 × 1 | (b) See A16 note. |
| A14 `draft-recovery` | light | **NOT VERIFIED** | `DIFF 1324 px bbox x=458...587 y=428...458` | 1 × 1 | State: the draft row prints the path (`appb/before/light/surf.md` vs `appb/after/light/surf.md`) and the draft timestamp (`…04:31:33.702362…` vs `…04:48:25.489491…`). Masked (x450–595, y420–465): `IDENTICAL 1200x800`. |
| A14 `draft-recovery` | dark | **NOT VERIFIED** | `DIFF 1185 px bbox x=458...587 y=428...458` | 1 × 1 | Same (`…04:40:19.422931…` vs `…04:55:58.123976…`). Masked: `IDENTICAL 1200x800`. |

Masked diffs used a scratch variant of `pngdiff` that skips one rectangle (`pngdiffmask A B x0 y0 x1 y1`), built in the session scratchpad and not committed anywhere.

### Carried rows

| Appendix B row | Status | Reason |
|---|---|---|
| Disabled-with-reason control | NOT RUN | NOT CAPTURED in the before set either: "Saving…" is up for one render (~11–18 ms), and the capture takes ~67 ms. It is not capturable without a code change. |
| Large-file warning toast (> 10 MB) | n/a | Unreachable; A6 covers it. |
| External-change — modified with unsaved edits; Status strip | n/a | These states don't exist yet; they are "after"-only, in Stage 4. |
| Drag-and-drop empty-state hovers; Esc mid-drag | NOT RUN | The empty state needs every tab closed mid-pass, and Esc is excluded. Nothing is drawn at either commit (`App.tsx` handles `drop` only). |
| Recent files; native surfaces | n/a | Drawn by macOS, not app CSS. |
| Settings — About offline error state | NOT RUN | It needs the network turned off, which is a system setting. |

Nothing new was learned that changes these rows.

### Per cell notes

**Focus gate.** The gate ran before every key and every `type` (`tail -n 2000 $LOG | jq … | tail -n 1`). In all four pass × theme runs, the last focus event before each in-window key or type was `window.focus` with `windowId` `main`. No gate needed a re-activation, and none was NOT VERIFIED (tool focus limit). The B10 loops checked the gate before each of the 12 Tabs and printed no `GATE FAIL`. There were two designed exceptions:

- **Native Open panel** (every ⌘O → ⌘⇧G → path → Return). While the panel is key, the main window logs `window.blur`, so the literal gate cannot pass. For keystrokes into the panel, EXEC checked that `window 1` of `tauri-app` was the panel `"Open"`. ⌘O itself was always sent behind a passing `window.focus/main` gate. The panel close re-focuses main (for example `{"ts":"…12:20:39.314…","event":"window.focus","context":{"windowId":"main"…}}`).
- **A11.** It needs mdpro unfocused. After `open_application("Finder")` the gate showed `window.blur` (`main`) in all four runs (for example `12:28:19.633 window.blur`). mdpro was re-activated before Reject was clicked.

**B10.** The Tab order from the state Settings opens in (B6 frame) was the same in both passes and both themes:

1. Tabs 1–9 ring Editor, Markdown, Image, Integrations, Export, Appearance, Keyboard Shortcuts, Advanced, About.
2. Tabs 10 and 11 ring the Default View Mode and Auto-save selects.
3. Tab 12 lands on a control with no visible ring. The frame equals the untabbed B6 frame (`pngdiff` B6 vs B10: `IDENTICAL`).

"General" never showed a ring within 12 presses, so the verdict is NOT VERIFIED by the cell's rule. The same count (12) was used in every run, and the 12-press frames are IDENTICAL before vs after. Observation: on the first ⌘, after a fresh launch (the look-only as-found open), "General" *did* show a ring in both passes. Later opens did not.

**A2.** Toggle log lines:
- before/light: `8789 off/disabled`, `8794 on/running`
- before/dark: `9184 off`
- after/light: `9595 off`
- after/dark: `9977 off`

Each off was followed by a click back on, confirmed visually as "Running". The badge reads "Running" in the on state and "Off" in the off state in both builds.

**A3.** The update line showed "Checking for updates..." and then settled to "Automatic updates coming soon." within about 13 s in every run. That text matches 2026-10-05.

**A7 / A8.** `editor.large_document.degrade {"trigger":"structure"}` was followed by `view.mode.change {"toMode":"source","intent":"programmatic"}` in all 4 runs (before/light `8880/8883`, before/dark `9275/9278`, after/light `9686/9689`, after/dark `10068/10071`). `source_tables_withheld {"tableRows":50003}` appeared at `8909`, `9304`, `9715` and `10097`. The generator triggered both guards in both passes, so neither cell is NOT RUN (generator).

**A11 HTTP codes.** `reports/a11-before-light.txt`, `a11-before-dark.txt`, `a11-after-light.txt` and `a11-after-dark.txt` each hold `{"error":"User rejected write operation","code":"USER_REJECTED"}403`. Log examples: `9033 mcp.insert fail {"httpStatus":403}` (before/light) and `10219 … 403` (after/dark). Token length 64 was printed; the token was not.

**A16.** Check (a), before vs after: the idle, md-hover and image-hover frames are all `IDENTICAL` in both themes. Check (b), hover vs same-pass idle: in all 8 hover bursts (2 files × 2 themes × 2 passes) the hover frame differs from idle by exactly `DIFF 516 px bbox x=9...68 y=9...22`. That region is the macOS traffic-light buttons, which macOS shows in colour while a drag hovers over the inactive window. Idle was shot with Finder frontmost, so mdpro was inactive with grey buttons. The rest of the frame is identical to idle, so no app-drawn drop target appears in either build. This is window chrome, not app CSS, and it behaves the same before and after, so it is not a Stage 1 regression. It does mean check (b) is not literally "equal" as it was on 2026-10-05; that run may have shot idle differently.

Other A16 details:
- No drop happened. No `file.open` or tab events occurred, and the scratch directories were unchanged after each release over the Finder window.
- The drag was synthesized with `left_mouse_down`, `mouse_move` and `left_mouse_up`. The reaction of the window chrome shows that the drag session was live over mdpro.

**A14.** `draft.write` start lines carrying the scratch path, each followed by `success` in the same actionId:
- before/light: `9048` (`$S/before/light/surf.md`)
- before/dark: `9437`
- after/light: `9846`
- after/dark: `10228`

Each was followed by `kill -9` of the recorded PID only (3263, 13809, 20490, 26042), then `open -a "$APP"` with no file. Each relaunch's "Recover drafts" listed exactly one row, the draft EXEC created (`file.draft.list {"listed": 1}` at `9072`, `9457`, `9865`, `10247`), so U2 was not needed.

**Crops** (both sides) are in `reports/shots/`. A1 crops are at 4×; A15 and A14 crops at 2×.
- `s1b-crop-busy-open-{light,dark}-{before,after}.png` (A1, PASS dynamic). The spinner arc is at a different rotation; the "Opening file..." label is identical.
- `s1b-crop-encoding-{light,dark}-{before,after}.png` (A15). Only the path text differs: "…/before/lig|ht/latin1.md" vs "…/after/light/|latin1.md".
- `s1b-crop-draft-recovery-{light,dark}-{before,after}.png` (A14). Only the path's second line and the timestamp differ.

### Discards

| # | When | Click | Document |
|---|---|---|---|
| 1 | before, A14-light | **Discard** in Recover drafts (`9089 dialog.recovery.discard`, `9091 file.draft.discard {"deleted": true}`) | `$S/before/light/surf.md` draft (scratch copy) |
| 2 | before, A14-dark | **Discard** (`9473`, `9475`) | `$S/before/dark/surf.md` draft |
| 3 | after, A14-light | **Discard** (`9882`, `9884`) | `$S/after/light/surf.md` draft |
| 4 | after, A14-dark | **Discard** (`10264`, `10266`) | `$S/after/dark/surf.md` draft |

No "Discard changes" was clicked in any confirm dialog: A9 used Keep editing, A10 used Keep editing, and A13's ⌘W raised no prompt. Both menu Quits ended clean with no prompt.

### Deviations

From the brief's list:
1. Focus was moved by app activation (`open_application`) or by the `set frontmost` in `key.sh` / `kc.sh`, never by a title-bar click (r4).
2. No Esc was used anywhere. The Esc paths of every dialog and the drag cancel are NOT RUN. Drags were cancelled by releasing over the Finder window.
3. The before shots were retaken in this run from `73c7620`. The 2026-10-05 set (`e121110`) was not used for any verdict.
4. Draft recovery was staged with a deliberate `kill -9` after a logged `draft.write`.
5. Theme and view mode were switched and restored per pass. Quitting saves window geometry.
6. The A13 `rm` and the A5 `chmod 555/755` acted only on this run's scratch files. Each `rm` targeted a single literal scratch path.

Found in this run (both passes were kept identical unless noted):

7. **`shot.sh` picks the wrong window while a native panel is open (A1).** `winid.js` lists the Open panel (`880×448`, layer 8) first, so `shot.sh` captured the panel. EXEC used a scratch variant, `shotmain.sh`, which runs the same `screencapture -x -o -l<id>` but picks the layer-0 `mdpro` window. It was used for A1 only, in all four runs. The first before/light A1 burst (880×448) was deleted and retaken while the panel was still open.
8. **P.2 step 1 did not "route into the existing window".** After the A14 Discard, the main window has no tab, so `open -a "$APP" $S/$P/dark/surf.md` opened a second window (`file.open.route {"outcome":"new-window"}`, before `9095`, after `9888`). In both passes EXEC closed that extra window with its close button (clean doc, no prompt) and opened `dark/surf.md` into `main` through ⌘O → ⌘⇧G. The whole run then stayed on the one `main` window, so P.2 step 2 (close extra tabs) had nothing to close.
9. **Caret placement for A4, A5 and A9.** EXEC did not click at the end of the last line. It clicked into the editor, then pressed ⌘↓, ↑, ⌘→ (`kc.sh 125 command`, `126`, `124 command`), each behind the gate. This puts the caret at the end of the last text line (`![image 1](img/i01.png)`) the same way in every run.
10. **After-pass mirror of the as-found read.** After the cold launch, the after pass repeated the look-only Settings open/close, so that B6/B10 Settings state matches. This matters because the first ⌘, after launch shows a "General" ring (see B10).
11. **before/light A13:** the `rm` came about 2 min after the open, not 2 s. The first `rm` was refused by a tool safety check over the shell-variable path and was re-issued with the literal path. The verdict is unaffected (IDENTICAL).
12. **before/light A16 image drag** was retaken once. The first path crossed a Terminal window that is hidden from computer-use screenshots, so the move stopped before reaching mdpro and the burst was taken without hovering. All later drags used a path that avoids it. The dark-theme drag paths differ from the light ones because the scratch Finder window opened with a sidebar there; each theme used the same paths in both passes.
13. **after/dark B8:** the first double-click on "One" left only a caret. It was repeated once, and the selection was confirmed before ⌘K.
14. **after/light, before the A14 mark:** a stray `open -a "$APP_A"` (no file) was sent while the app was running. It only re-activated the app. `winid.js` still showed one window, and no `file.open` or route event was logged.
15. **Burst timing for toasts:** the final Return of the Open panel and ⌘S were sent from Bash immediately before the burst, so the toasts were captured inside 3 s.
16. **Gate during Open-panel keystrokes:** see Per cell notes; the panel-is-frontmost check replaced the literal `window.focus/main` gate there.

The full timestamped action log for both passes is in `reports/stage1-appb-actions.log`.

### Appendix: log evidence (`~/.mdpro/mdpro.log`, lines after 8694, filtered)

Paths are shortened with `$S` = `~/.mdpro-redesign/dtrack/scratch/stage1-appb`. Periodic `draft.write` lines are omitted except the four A14 lines quoted above.

```
8696: 12:15:18.139 file.open.external start {"appReady": false, "filePaths": ["$S/before/light/surf.md"]}
8704: 12:15:18.228 app.ready success {"pid": 3263}
8705: 12:15:18.234 mcp.http_server.start success {"port": 55045, "phase": "running"}
8715: 12:15:18.386 file.draft.list start {}
8716: 12:15:18.386 file.draft.list success {"listed": 0}
8727: 12:15:18.401 file.open success {"filePath": "$S/before/light/surf.md"}
8753: 12:16:13.871 ui.menu.select success {"controlId": "menu.theme.light"}
8759: 12:16:14.603 view.mode.change success {"toMode": "source", "fromMode": "wysiwyg", "intent": "user"}
8789: 12:18:40.147 mcp.server.toggle success {"direction": "off", "phase": "disabled"}
8794: 12:18:47.999 mcp.server.toggle success {"direction": "on", "phase": "running"}
8804: 12:19:35.702 view.mode.change success {"toMode": "wysiwyg", "fromMode": "source", "intent": "user"}
8827: 12:20:09.525 view.mode.change success {"toMode": "source", "fromMode": "wysiwyg", "intent": "user"}
8839: 12:20:39.320 file.open cancel {}
8844: 12:21:00.618 file.open fail {"filePath": "$S/before/light/latin1.md"} err=encoding error: /Users/jack/.mdpro-redesign/dtrack/scratch/stage1-appb
8845: 12:21:22.325 ui.dialog.cancel success {"controlId": "dialog.encoding.cancel"}
8849: 12:21:39.096 file.open fail {"filePath": "$S/before/light/big.md"} err=file too large: /Users/jack/.mdpro-redesign/dtrack/scratch/stage1-appb
8853: 12:22:00.903 view.mode.change success {"toMode": "wysiwyg", "fromMode": "source", "intent": "user"}
8873: 12:22:17.530 file.open success {"filePath": "$S/before/light/big-structure.md"}
8880: 12:22:17.537 editor.large_document.degrade fail {"trigger": "structure"} err=large document degraded to source: structure
8883: 12:22:17.537 view.mode.change success {"toMode": "source", "fromMode": "wysiwyg", "intent": "programmatic"}
8895: 12:22:34.550 tab.close success {"filePath": "$S/before/light/big-structure.md"}
8905: 12:22:48.362 file.open success {"filePath": "$S/before/light/big-table.md"}
8909: 12:22:48.411 editor.large_document.source_tables_withheld fail {"tableRows": 50003} err=source table extensions withheld: too many table rows
8917: 12:23:03.846 tab.close success {"filePath": "$S/before/light/big-table.md"}
8922: 12:23:28.181 file.save success {"filePath": "$S/before/light/surf.md"}
8934: 12:23:54.925 file.open success {"filePath": "$S/before/light/ext-mod.md"}
8945: 12:24:02.388 file.change.decision success {"action": "reload-prompt", "changeType": "modified"}
8946: 12:24:11.279 ui.dialog.cancel success {"controlId": "dialog.reload.ignore"}
8950: 12:24:12.305 tab.close success {"filePath": "$S/before/light/ext-mod.md"}
8957: 12:24:30.811 file.open success {"filePath": "$S/before/light/ext-del.md"}
8968: 12:26:42.978 file.change.decision success {"action": "deleted-prompt", "changeType": "deleted"}
8969: 12:26:53.659 ui.dialog.cancel success {"controlId": "dialog.reload.ignore"}
8973: 12:26:54.690 tab.close success {"filePath": "$S/before/light/ext-del.md"}
8980: 12:27:09.779 file.open success {"filePath": "$S/before/light/ro/save.md"}
8991: 12:27:21.288 file.save fail {"filePath": "$S/before/light/ro/save.md"} err=permission denied: /Users/jack/.mdpro-redesign/dtrack/scratch/stage1-a
8995: 12:27:32.469 file.save success {"filePath": "$S/before/light/ro/save.md"}
9005: 12:27:33.675 tab.close success {"filePath": "$S/before/light/ro/save.md"}
9008: 12:27:56.719 ui.dialog.cancel success {"controlId": "dialog.confirm.cancel"}
9012: 12:27:57.763 app.quit.prompt start {}
9017: 12:28:07.585 ui.dialog.cancel success {"controlId": "dialog.confirm.cancel"}
9018: 12:28:07.585 ui.dialog.cancel success {"controlId": "dialog.quit.cancel"}
9020: 12:28:07.585 app.quit.cancel cancel {"reason": "cancelled"}
9027: 12:28:20.467 mcp.confirm start {}
9029: 12:28:30.752 ui.mcp_confirm.reject success {}
9032: 12:28:30.753 mcp.confirm fail {"outcome": "rejected"}
9033: 12:28:30.753 mcp.insert fail {"httpStatus": 403} err=write not confirmed
9060: 12:31:54.695 app.ready success {"pid": 13809}
9061: 12:31:54.699 mcp.http_server.start success {"port": 55045, "phase": "running"}
9071: 12:31:54.844 file.draft.list start {}
9072: 12:31:54.844 file.draft.list success {"listed": 1}
9085: 12:31:55.167 view.mode.change success {"toMode": "source", "fromMode": "wysiwyg", "intent": "programmatic"}
9089: 12:32:09.751 ui.dialog.cancel success {"controlId": "dialog.recovery.discard", "draftId": "2237ace67c4ba9b3"}
9090: 12:32:09.751 file.draft.discard start {}
9091: 12:32:09.752 file.draft.discard success {"outcome": "ok", "deleted": true}
9092: 12:32:09.754 file.draft.discard success {"outcome": "ok"}
9093: 12:32:20.133 file.open.external start {"appReady": true, "filePaths": ["$S/before/dark/surf.md"]}
9095: 12:32:20.180 file.open.route success {"outcome": "new-window"}
9107: 12:32:20.283 file.draft.list start {}
9108: 12:32:20.284 file.draft.list success {"listed": 0}
9120: 12:32:20.294 file.open success {"filePath": "$S/before/dark/surf.md"}
9153: 12:32:44.814 file.open success {"filePath": "$S/before/dark/surf.md"}
9161: 12:32:53.246 ui.menu.select success {"controlId": "menu.theme.dark"}
9184: 12:33:50.784 mcp.server.toggle success {"direction": "off", "phase": "disabled"}
9189: 12:34:00.601 mcp.server.toggle success {"direction": "on", "phase": "running"}
9199: 12:34:33.472 view.mode.change success {"toMode": "wysiwyg", "fromMode": "source", "intent": "user"}
9222: 12:35:05.792 view.mode.change success {"toMode": "source", "fromMode": "wysiwyg", "intent": "user"}
9233: 12:35:09.997 file.open cancel {}
9238: 12:35:26.181 file.open fail {"filePath": "$S/before/dark/latin1.md"} err=encoding error: /Users/jack/.mdpro-redesign/dtrack/scratch/stage1-appb
9240: 12:35:38.633 ui.dialog.cancel success {"controlId": "dialog.encoding.cancel"}
9244: 12:35:53.227 file.open fail {"filePath": "$S/before/dark/big.md"} err=file too large: /Users/jack/.mdpro-redesign/dtrack/scratch/stage1-appb
9248: 12:35:59.205 view.mode.change success {"toMode": "wysiwyg", "fromMode": "source", "intent": "user"}
9268: 12:36:14.727 file.open success {"filePath": "$S/before/dark/big-structure.md"}
9275: 12:36:14.733 editor.large_document.degrade fail {"trigger": "structure"} err=large document degraded to source: structure
9278: 12:36:14.733 view.mode.change success {"toMode": "source", "fromMode": "wysiwyg", "intent": "programmatic"}
9290: 12:36:19.698 tab.close success {"filePath": "$S/before/dark/big-structure.md"}
9300: 12:36:39.746 file.open success {"filePath": "$S/before/dark/big-table.md"}
9304: 12:36:39.794 editor.large_document.source_tables_withheld fail {"tableRows": 50003} err=source table extensions withheld: too many table rows
9312: 12:36:44.719 tab.close success {"filePath": "$S/before/dark/big-table.md"}
9318: 12:36:49.152 file.save success {"filePath": "$S/before/dark/surf.md"}
9329: 12:37:11.664 file.open success {"filePath": "$S/before/dark/ext-mod.md"}
9340: 12:37:14.362 file.change.decision success {"action": "reload-prompt", "changeType": "modified"}
9341: 12:37:17.868 ui.dialog.cancel success {"controlId": "dialog.reload.ignore"}
9345: 12:37:31.825 tab.close success {"filePath": "$S/before/dark/ext-mod.md"}
9352: 12:37:38.313 file.open success {"filePath": "$S/before/dark/ext-del.md"}
9363: 12:37:41.006 file.change.decision success {"action": "deleted-prompt", "changeType": "deleted"}
9364: 12:37:44.585 ui.dialog.cancel success {"controlId": "dialog.reload.ignore"}
9368: 12:38:00.943 tab.close success {"filePath": "$S/before/dark/ext-del.md"}
9375: 12:38:07.664 file.open success {"filePath": "$S/before/dark/ro/save.md"}
9386: 12:38:12.207 file.save fail {"filePath": "$S/before/dark/ro/save.md"} err=permission denied: /Users/jack/.mdpro-redesign/dtrack/scratch/stage1-a
9391: 12:38:18.203 file.save success {"filePath": "$S/before/dark/ro/save.md"}
9400: 12:38:19.410 tab.close success {"filePath": "$S/before/dark/ro/save.md"}
9403: 12:38:41.195 ui.dialog.cancel success {"controlId": "dialog.confirm.cancel"}
9407: 12:38:42.246 app.quit.prompt start {}
9410: 12:38:45.483 ui.dialog.cancel success {"controlId": "dialog.confirm.cancel"}
9411: 12:38:45.483 ui.dialog.cancel success {"controlId": "dialog.quit.cancel"}
9413: 12:38:45.484 app.quit.cancel cancel {"reason": "cancelled"}
9420: 12:39:01.437 mcp.confirm start {}
9422: 12:39:05.535 ui.mcp_confirm.reject success {}
9425: 12:39:05.536 mcp.confirm fail {"outcome": "rejected"}
9426: 12:39:05.537 mcp.insert fail {"httpStatus": 403} err=write not confirmed
9444: 12:40:30.765 app.ready success {"pid": 19867}
9445: 12:40:30.774 mcp.http_server.start success {"port": 55045, "phase": "running"}
9456: 12:40:30.918 file.draft.list start {}
9457: 12:40:30.918 file.draft.list success {"listed": 1}
9469: 12:40:31.244 view.mode.change success {"toMode": "source", "fromMode": "wysiwyg", "intent": "programmatic"}
9473: 12:40:47.881 ui.dialog.cancel success {"controlId": "dialog.recovery.discard", "draftId": "20f9b4fdb0910231"}
9474: 12:40:47.882 file.draft.discard start {}
9475: 12:40:47.883 file.draft.discard success {"outcome": "ok", "deleted": true}
9476: 12:40:47.884 file.draft.discard success {"outcome": "ok"}
9477: 12:40:49.453 ui.menu.select success {"controlId": "menu.theme.system"}
9482: 12:40:50.203 view.mode.change success {"toMode": "wysiwyg", "fromMode": "source", "intent": "user"}
9503: 12:41:06.693 app.quit success {}
9506: 12:41:31.825 file.open.external start {"appReady": false, "filePaths": ["$S/after/light/surf.md"]}
9514: 12:41:31.889 app.ready success {"pid": 20490}
9515: 12:41:31.893 mcp.http_server.start success {"port": 55045, "phase": "running"}
9525: 12:41:32.043 file.draft.list start {}
9526: 12:41:32.043 file.draft.list success {"listed": 0}
9537: 12:41:32.053 file.open success {"filePath": "$S/after/light/surf.md"}
9561: 12:41:56.509 ui.menu.select success {"controlId": "menu.theme.light"}
9567: 12:41:57.247 view.mode.change success {"toMode": "source", "fromMode": "wysiwyg", "intent": "user"}
9595: 12:42:56.500 mcp.server.toggle success {"direction": "off", "phase": "disabled"}
9600: 12:43:00.944 mcp.server.toggle success {"direction": "on", "phase": "running"}
9610: 12:43:35.455 view.mode.change success {"toMode": "wysiwyg", "fromMode": "source", "intent": "user"}
9633: 12:43:57.779 view.mode.change success {"toMode": "source", "fromMode": "wysiwyg", "intent": "user"}
9645: 12:44:10.976 file.open cancel {}
9650: 12:44:17.222 file.open fail {"filePath": "$S/after/light/latin1.md"} err=encoding error: /Users/jack/.mdpro-redesign/dtrack/scratch/stage1-appb
9651: 12:44:27.423 ui.dialog.cancel success {"controlId": "dialog.encoding.cancel"}
9655: 12:44:39.861 file.open fail {"filePath": "$S/after/light/big.md"} err=file too large: /Users/jack/.mdpro-redesign/dtrack/scratch/stage1-appb
9659: 12:44:45.873 view.mode.change success {"toMode": "wysiwyg", "fromMode": "source", "intent": "user"}
9679: 12:44:58.745 file.open success {"filePath": "$S/after/light/big-structure.md"}
9686: 12:44:58.752 editor.large_document.degrade fail {"trigger": "structure"} err=large document degraded to source: structure
9689: 12:44:58.752 view.mode.change success {"toMode": "source", "fromMode": "wysiwyg", "intent": "programmatic"}
9701: 12:45:03.717 tab.close success {"filePath": "$S/after/light/big-structure.md"}
9711: 12:45:21.712 file.open success {"filePath": "$S/after/light/big-table.md"}
9715: 12:45:21.760 editor.large_document.source_tables_withheld fail {"tableRows": 50003} err=source table extensions withheld: too many table rows
9724: 12:45:26.694 tab.close success {"filePath": "$S/after/light/big-table.md"}
9728: 12:45:31.001 file.save success {"filePath": "$S/after/light/surf.md"}
9740: 12:45:52.599 file.open success {"filePath": "$S/after/light/ext-mod.md"}
9751: 12:45:55.294 file.change.decision success {"action": "reload-prompt", "changeType": "modified"}
9752: 12:45:58.828 ui.dialog.cancel success {"controlId": "dialog.reload.ignore"}
9756: 12:46:10.076 tab.close success {"filePath": "$S/after/light/ext-mod.md"}
9763: 12:46:16.533 file.open success {"filePath": "$S/after/light/ext-del.md"}
9774: 12:46:19.221 file.change.decision success {"action": "deleted-prompt", "changeType": "deleted"}
9775: 12:46:22.700 ui.dialog.cancel success {"controlId": "dialog.reload.ignore"}
9779: 12:46:37.026 tab.close success {"filePath": "$S/after/light/ext-del.md"}
9786: 12:46:43.748 file.open success {"filePath": "$S/after/light/ro/save.md"}
9797: 12:46:48.309 file.save fail {"filePath": "$S/after/light/ro/save.md"} err=permission denied: /Users/jack/.mdpro-redesign/dtrack/scratch/stage1-a
9801: 12:46:54.287 file.save success {"filePath": "$S/after/light/ro/save.md"}
9811: 12:46:55.478 tab.close success {"filePath": "$S/after/light/ro/save.md"}
9814: 12:47:15.419 ui.dialog.cancel success {"controlId": "dialog.confirm.cancel"}
9818: 12:47:16.466 app.quit.prompt start {}
9821: 12:47:19.646 ui.dialog.cancel success {"controlId": "dialog.confirm.cancel"}
9822: 12:47:19.646 ui.dialog.cancel success {"controlId": "dialog.quit.cancel"}
9824: 12:47:19.647 app.quit.cancel cancel {"reason": "cancelled"}
9831: 12:47:33.558 mcp.confirm start {}
9833: 12:47:37.585 ui.mcp_confirm.reject success {}
9836: 12:47:37.586 mcp.confirm fail {"outcome": "rejected"}
9837: 12:47:37.586 mcp.insert fail {"httpStatus": 403} err=write not confirmed
9853: 12:48:43.929 app.ready success {"pid": 26042}
9854: 12:48:43.929 mcp.http_server.start success {"port": 55045, "phase": "running"}
9864: 12:48:44.080 file.draft.list start {}
9865: 12:48:44.080 file.draft.list success {"listed": 1}
9878: 12:48:44.411 view.mode.change success {"toMode": "source", "fromMode": "wysiwyg", "intent": "programmatic"}
9882: 12:48:57.461 ui.dialog.cancel success {"controlId": "dialog.recovery.discard", "draftId": "72759baa3f7e5b67"}
9883: 12:48:57.461 file.draft.discard start {}
9884: 12:48:57.462 file.draft.discard success {"outcome": "ok", "deleted": true}
9885: 12:48:57.463 file.draft.discard success {"outcome": "ok"}
9886: 12:48:58.903 file.open.external start {"appReady": true, "filePaths": ["$S/after/dark/surf.md"]}
9888: 12:48:58.949 file.open.route success {"outcome": "new-window"}
9900: 12:48:59.061 file.draft.list start {}
9901: 12:48:59.061 file.draft.list success {"listed": 0}
9913: 12:48:59.069 file.open success {"filePath": "$S/after/dark/surf.md"}
9946: 12:49:20.092 file.open success {"filePath": "$S/after/dark/surf.md"}
9954: 12:49:22.325 ui.menu.select success {"controlId": "menu.theme.dark"}
9977: 12:50:18.255 mcp.server.toggle success {"direction": "off", "phase": "disabled"}
9982: 12:50:22.691 mcp.server.toggle success {"direction": "on", "phase": "running"}
9992: 12:50:57.389 view.mode.change success {"toMode": "wysiwyg", "fromMode": "source", "intent": "user"}
10015: 12:51:28.981 view.mode.change success {"toMode": "source", "fromMode": "wysiwyg", "intent": "user"}
10027: 12:51:41.809 file.open cancel {}
10031: 12:51:48.050 file.open fail {"filePath": "$S/after/dark/latin1.md"} err=encoding error: /Users/jack/.mdpro-redesign/dtrack/scratch/stage1-appb
10033: 12:51:58.123 ui.dialog.cancel success {"controlId": "dialog.encoding.cancel"}
10037: 12:52:10.747 file.open fail {"filePath": "$S/after/dark/big.md"} err=file too large: /Users/jack/.mdpro-redesign/dtrack/scratch/stage1-appb
10041: 12:52:16.721 view.mode.change success {"toMode": "wysiwyg", "fromMode": "source", "intent": "user"}
10061: 12:52:29.780 file.open success {"filePath": "$S/after/dark/big-structure.md"}
10068: 12:52:29.787 editor.large_document.degrade fail {"trigger": "structure"} err=large document degraded to source: structure
10071: 12:52:29.787 view.mode.change success {"toMode": "source", "fromMode": "wysiwyg", "intent": "programmatic"}
10083: 12:52:34.733 tab.close success {"filePath": "$S/after/dark/big-structure.md"}
10093: 12:52:59.864 file.open success {"filePath": "$S/after/dark/big-table.md"}
10097: 12:52:59.911 editor.large_document.source_tables_withheld fail {"tableRows": 50003} err=source table extensions withheld: too many table rows
10105: 12:53:04.833 tab.close success {"filePath": "$S/after/dark/big-table.md"}
10110: 12:53:09.119 file.save success {"filePath": "$S/after/dark/surf.md"}
10122: 12:53:19.358 file.open success {"filePath": "$S/after/dark/ext-mod.md"}
10133: 12:53:22.048 file.change.decision success {"action": "reload-prompt", "changeType": "modified"}
10134: 12:53:25.560 ui.dialog.cancel success {"controlId": "dialog.reload.ignore"}
10138: 12:53:41.362 tab.close success {"filePath": "$S/after/dark/ext-mod.md"}
10145: 12:53:47.783 file.open success {"filePath": "$S/after/dark/ext-del.md"}
10156: 12:53:50.489 file.change.decision success {"action": "deleted-prompt", "changeType": "deleted"}
10157: 12:53:53.978 ui.dialog.cancel success {"controlId": "dialog.reload.ignore"}
10161: 12:53:55.012 tab.close success {"filePath": "$S/after/dark/ext-del.md"}
10168: 12:54:01.699 file.open success {"filePath": "$S/after/dark/ro/save.md"}
10179: 12:54:20.910 file.save fail {"filePath": "$S/after/dark/ro/save.md"} err=permission denied: /Users/jack/.mdpro-redesign/dtrack/scratch/stage1-a
10183: 12:54:26.905 file.save success {"filePath": "$S/after/dark/ro/save.md"}
10193: 12:54:28.113 tab.close success {"filePath": "$S/after/dark/ro/save.md"}
10196: 12:54:49.523 ui.dialog.cancel success {"controlId": "dialog.confirm.cancel"}
10200: 12:54:50.565 app.quit.prompt start {}
10203: 12:54:53.752 ui.dialog.cancel success {"controlId": "dialog.confirm.cancel"}
10204: 12:54:53.752 ui.dialog.cancel success {"controlId": "dialog.quit.cancel"}
10206: 12:54:53.753 app.quit.cancel cancel {"reason": "cancelled"}
10211: 12:54:55.474 mcp.confirm start {}
10215: 12:54:59.537 ui.mcp_confirm.reject success {}
10218: 12:54:59.539 mcp.confirm fail {"outcome": "rejected"}
10219: 12:54:59.539 mcp.insert fail {"httpStatus": 403} err=write not confirmed
10235: 12:56:10.865 app.ready success {"pid": 31762}
10236: 12:56:10.874 mcp.http_server.start success {"port": 55045, "phase": "running"}
10246: 12:56:11.021 file.draft.list start {}
10247: 12:56:11.021 file.draft.list success {"listed": 1}
10260: 12:56:11.345 view.mode.change success {"toMode": "source", "fromMode": "wysiwyg", "intent": "programmatic"}
10264: 12:56:27.162 ui.dialog.cancel success {"controlId": "dialog.recovery.discard", "draftId": "2db95c23ccd5b051"}
10265: 12:56:27.162 file.draft.discard start {}
10266: 12:56:27.162 file.draft.discard success {"outcome": "ok", "deleted": true}
10267: 12:56:27.163 file.draft.discard success {"outcome": "ok"}
10268: 12:56:28.701 ui.menu.select success {"controlId": "menu.theme.system"}
10273: 12:56:29.430 view.mode.change success {"toMode": "wysiwyg", "fromMode": "source", "intent": "user"}
10294: 12:56:40.163 app.quit success {}
```
