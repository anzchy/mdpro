<!-- Device-check record. Written by real-device-tester (dtrack, Mac mini) and committed verbatim by mdpro-delegator; brief: docs/pending/20261011-brief-editor-f6fd991.md (untracked). 12 PASS, 1 brief-proof mismatch (item 2.3, see § 2.3 and N2), drag NOT EXERCISED. Findings registered: D153 (N5, set_cell logged twice), D154 (N5, no visible selection in Source mode). -->

# Editor and tables on `f6fd991` (D138, D145, D136, D91, D135, D99, D66): report (2026-10-11)

Brief: `~/.mdpro-redesign/dtrack/briefs/20261011-brief-editor-f6fd991.md`. One run, 15:58–16:10 (+08:00). Log lines are from `~/.mdpro/mdpro.log`; the slice L14948–15500 is saved at `scratch/f6fd991-editor/editor-f6fd991-slice.txt`. Shots are in `reports/shots/`.

## 1. Build evidence

| Check | Result |
|---|---|
| `stat -f %m tauri-app` | `1791702850` = `BIN_MTIME` ✔ |
| `shasum -a 256 tauri-app` | `0a227f9443ecb97b616276f8e7e4efb1ee819ecfa1602066f93b2022deee29b8` = `BIN_SHA` ✔ |
| `git rev-parse --short HEAD` (worktree) | `f6fd991` ✔ |
| ancestors `97dd134 863d9e3 57c5192 f23e3da a70bb2d 7b28790` | all `0` ✔ |
| `cat-file -e` reloadTarget.ts, openWriteGuard.ts, pasteRefusalGuard.ts, pasteWidenAlignment.ts, cellAlignmentDom.ts, minimalTextChange.ts | all `0` ✔ |
| `request_access(mdpro)` | granted `com.mdpro.app`, tier `full`, denied none |
| pre-launch `pgrep -fl 'mdpro\|tauri-app'` | two non-app hits only (`tmux new -s dtrack -c …/.mdpro-redesign/dtrack`, `claude --resume mdpro-remote`); `pgrep -fl tauri-app` empty (rc 1). No mdpro to quit. |
| Cold launch | PID **74144**, `ps`: `/Users/jack/.mdpro-redesign/dtrack/builds/f6fd991/mdpro.app/Contents/MacOS/tauri-app`; L14954 `app.ready` `appVersion 0.3.0`, `pid 74144`; Recover drafts: L14965 `file.draft.list` `listed:0` (nothing to recover) |
| About | `about.png`: **mdpro Version v0.3.0** ("Checking for updates…"; no button clicked) |
| `W0` | position {100, 100}, size 1200×800 |
| ⌃4 | L14988 `ui.menu.select` `menu.view.set_mode` `mode:"wysiwyg"`; no `view.mode.change` because the mode was already WYSIWYG (see N1) |
| MCP | `/api/status` → `{"version":"0.3.0","window_focused":true}`; token length 64; server was already on (not touched) |

## 2. Settings

As found (15:58, pre-launch) and re-read after quit: identical.
```
{"themeMode":"system","defaultViewMode":"wysiwyg","lastViewMode":"wysiwyg","autoSaveInterval":30,"logging":{"enabled":true,"level":"info"},"mcp":{"serverEnabled":true}}
```
Fixture: `shasum -a 256 -c fx.sha` → `d49-table-widen.md: OK` (original never opened). `d66.md` last byte `0a`.

## 3. Verdict table

| # | Item | Verdict | Proof |
|---|---|---|---|
| 1 | D138 Save As → external change → Reload in place | **PASS** | L15031 `file.reload` `documentId` U, `reloadedId` `325f6106e9f9ebc6`; L15030 `editor.milkdown.reload` U; no `tab.open` in L15021–15037 |
| 2.1 | D145 Open Recent (clean) | **PASS** | L15072 `file.open.reload_clean` `matchedBy:"path"`, `decodedId` `325f6106e9f9ebc6`, `pathMatchCount:1`; no `tab.open` in L15065–15083 |
| 2.2 | D145 ⌘O (clean) | **PASS** | L15093 same fields; no `tab.open` in L15084–15104 |
| 2.3 | D145 route check (`open -a`) | **FAIL** (against the brief's proof) | L15106/L15109 `file.open.route` → `outcome:"focused-tab"`; **no `file.open.reload_clean`** in L15105–15109 (re-read 2 s later). One tab, no `tab.open`. See § 2.3 |
| 2.3d | Drag | **NOT EXERCISED** (no Finder grant) | — |
| 2.4 | D145 dirty re-open (⌘O) | **PASS** | L15122 `file.open.focus_dirty` `matchedBy:"path"`; no `reload_clean`, no `tab.open` in L15113–15126; ` x` kept |
| 3.a | D136 mixed slice over body CellSelection | **PASS** | L15207 `start` + L15208 `fail` (warn), same `actionId ce7d54fa…`, `nodes:4`, reason "…would be dropped by the cell selection"; D136 toast |
| 3.b | D136 mixed slice over header CellSelection | **PASS** | L15209 + L15210, same `actionId 01382cce…`, `nodes:4`; D136 toast; 0 `RangeError` lines |
| 3.c | Guard: cells over cells still paste | **PASS** | no line at all after mark 15210 except L15211 `editor.milkdown.mount`; row 2 became `a b`; ⌘Z restored `c d` |
| 4 | D91 mixed slice at a caret in a cell | **PASS** | L15253 + L15254, same `actionId 2cf1a79b…`, `nodes:4`, reason "…would split the host table"; D91 toast |
| 5 | D135 widening cell paste, no alignment | **PASS** | L15292 `editor.table.paste-widened` success (once), `fromColCount 2 → toColCount 4`; delimiter `\| -- \| -- \| -- \| -- \|` |
| 6 | D99 copied table pastes back without colons | **PASS** | source text: pasted copy delimiter `\| -- \| -- \|`; no `editor.table.paste` in L15359–15370 |
| 7.1 | D66 caret at end of `Last line.` | **PASS** | L15437/L15438 `mcp.table.set_cell` `documentId 4c35805168e4a4a3`; line 31 `Last line.kq1`, T0 r1c1 `R1`, line 1 `# D49 / D58 table check` |
| 7.2 | D66 caret after `## T1 wide` | **PASS** | L15445/L15446; `## T1 widekq2`, `R2`, line 1 intact; osascript 114 ms |
| 7.3 | D66 selection `Last line.kq1` | **PASS** | L15451/L15452; line 31 became `kq3`, `R3` (`grep -c R3` = 1), line 1 intact; osascript 116 ms |

## 4. Items

### 1. D138 (WYSIWYG)
- Gate `window.focus main` before each key. Mark 14988; ⌘N → L14991 `tab.open` `documentId:"fb6478b4-e13d-4b2d-93c7-3c15fa254e25"` (**U**), `filePath:null`.
- Typed `D138 one`, then ⌘S → save panel; Go-to the folder, name `d138`, **Save**. L15012/15014 `file.save` success for `$S/d138.md` (9 bytes); L15015 `file.watch.register` `ok:true`. `cat` → `D138 one`. Shot `i1-saved`.
- Mark 15020; `printf 'D138 two\n' > d138.md`. L15021 `file.watch.event` `emitted_modified`; L15027 `file.change.decision` `action:"reload-prompt"`, `documentId` U, `isModified:false`. Shot `i1-prompt` (within 3 s of the write). Prompt title **"External change detected"**, body "File was modified externally. Reload to update content?", buttons **Ignore** / **Reload**.
- Mark 15027; clicked **Reload**.
  ```
  15028: … "event":"ui.dialog.confirm" … "controlId":"dialog.reload.reload"
  15030: … "event":"editor.milkdown.reload","status":"success", … "context":{"documentId":"fb6478b4-e13d-4b2d-93c7-3c15fa254e25","droppedPendingEdit":false,"generation":1,"reason":"file-reload"}
  15031: … "event":"file.reload","status":"success", … "context":{"documentId":"fb6478b4-e13d-4b2d-93c7-3c15fa254e25","reloadedId":"325f6106e9f9ebc6"}
  ```
  Negative: unfiltered `since '.'` from mark 15020 = L15021–15037; no `tab.open`. Since mark 14988 the only `tab.open` is the ⌘N line L14991.
  Shot `i1-reloaded`: one tab `d138.md`, text `D138 two`, clean, "File reloaded" toast.
- Step 5: `cat` → `D138 two.` (after slip S2, see § 5). Tab clean.

### 2. D145
- **2.1 Open Recent**: mark 15064; File › Open Recent › `d138.md` (first entry). L15065 `ui.menu.select` `menu.file.open_recent`; L15066/15068 `file.open`; L15071 `editor.milkdown.reload` U;
  ```
  15072: … "event":"file.open.reload_clean","status":"success","actionId":"f5f19615-5e54-4486-af7d-217ab8073627","context":{"activated":true,"decodedId":"325f6106e9f9ebc6","documentId":"fb6478b4-e13d-4b2d-93c7-3c15fa254e25","entry":"file-open","matchedBy":"path","pathMatchCount":1}
  ```
  `since '.'` L15065–15083: no `tab.open`. Shot `i2-recent`: one tab, `D138 two.`.
- **2.2 ⌘O**: mark 15083; OPEN(`$S/d138.md`). L15089 `file.open` `source:"dialog"`;
  ```
  15093: … "event":"file.open.reload_clean","status":"success","actionId":"ba283f62-faf9-4fe3-9a62-d1c2fd3a8a81","context":{"activated":true,"decodedId":"325f6106e9f9ebc6","documentId":"fb6478b4-e13d-4b2d-93c7-3c15fa254e25","entry":"file-open","matchedBy":"path","pathMatchCount":1}
  ```
  `since '.'` L15084–15104: no `tab.open`. Shot `i2-cmdo`.
- **2.3 Route check**: mark 15104; `open -a "$APP" $S/d138.md` (same PID 74144 after).
  ```
  15105: … "event":"file.open.external","status":"start", … "context":{"appReady":true,"filePaths":["…/f6fd991-editor/d138.md"],"source":"finder"}
  15106: … "event":"file.open.route","status":"success","actionId":null,"context":{"matchCount":1,"outcome":"existing-window","source":"finder","windowLabel":"main"}
  15107: … "event":"file.open.external","status":"success", …
  15108: … "event":"file.watch.event","status":"cancel", … "outcome":"ignored_unchanged" …
  15109: … "event":"file.open.route","status":"success","actionId":"77b3bbd1-e016-4529-bf71-7b08105f9178","context":{"activated":true,"documentId":"fb6478b4-e13d-4b2d-93c7-3c15fa254e25","outcome":"focused-tab","windowLabel":"main"}
  ```
  The full range is L15105–15109 (still the same 2 s later). There is **no `file.open.reload_clean`** and no `tab.open`. One tab, `D138 two.` (shot `i2-route`).
  Why: Rust matched the path to an existing tab (`matchCount:1`) and sent `open-in-window` with that `documentId`. `src/hooks/useOpenInWindow.ts:177–187` then only calls `setActiveDocumentId`, logs `focused-tab`, and returns. Only the "tab closed after Rust looked" fallback reaches `openRef` and the ADR-0028/openWriteGuard path. So on this route a clean tab is **focused, not reloaded**. This build therefore does not show the brief's D145 claim for a re-open through the single-instance route (Finder double-click, `open -a`, and probably a Dock drop). Disk and tab held the same text here, so there was no visible content difference. A re-run with the file changed on disk while the tab is clean would show whether stale content stays; with the watcher running, the external-change prompt would normally fire first. This may be intended scope (D145 names Open Recent, ⌘O and drag); the drag onto the window (`file.open.drop`) was not exercised.
- **2.4 Dirty**: typed ` x` (shot `i2-dirty-before`, dirty dot). Mark 15112; OPEN(`$S/d138.md`).
  ```
  15114: … "event":"file.open","status":"start","actionId":"2481be99-…","context":{"source":"dialog"}
  15116/15117: draft.write start/success
  15120: … "event":"file.open","status":"success","actionId":"2481be99-6e2d-4f02-98d5-0041bd815dee","context":{"encoding":"UTF-8","filePath":"…/d138.md","fileSizeBytes":10,"source":"dialog"}
  15122: … "event":"file.open.focus_dirty","status":"success","actionId":"2481be99-6e2d-4f02-98d5-0041bd815dee","context":{"activated":true,"documentId":"fb6478b4-e13d-4b2d-93c7-3c15fa254e25","entry":"file-open","flushFailed":false,"matchedBy":"path"}
  ```
  `since '.'` L15113–15126: no `reload_clean`, no `tab.open`. Shot `i2-dirty`: one tab, `D138 two. x`, dirty.
- 2.5: ⌘S → `cat` `D138 two. x`; ⌘W → L15144 `tab.close` (no dialog).

### 3. D136 (`host.md`, `mixed.md`, WYSIWYG)
- OPEN(`mixed.md`) (watch `ok:true`), caret in "Trail text.", ⌘A, ⌘C. `clipboard info`: `«class HTML», 1785, «class utf8», 54, …`. ⌘W → L15178 `tab.close`, no dialog.
- OPEN(`host.md`) (watch `ok:true`). CellSelection `a`→shift+`b`; shot `i3-sel` shows both tinted.
- **3.a** `clipboard info` HTML 1785; mark 15206; ⌘V; shot `i3-toast` within ~0.3 s.
  ```
  15207: … "level":"info","event":"editor.table.paste","status":"start","actionId":"ce7d54fa-a709-4a72-b479-614d9ceeba43","context":{"nodes":4}
  15208: … "level":"warn","event":"editor.table.paste","status":"fail","actionId":"ce7d54fa-a709-4a72-b479-614d9ceeba43","context":{"nodes":4,"reason":"table-carrying slice not pasted as cells would be dropped by the cell selection"}
  ```
  Toast (shot): **"A table mixed with other content can't be pasted over selected cells. Paste it outside the table."** Table still `h1 h2 / a b / c d`, `a`,`b` still tinted, `Before the table.` / `After the table.` unchanged, tab clean. Full range L15207–15208, no `error` level.
- **3.b header**: CellSelection `h1`→`h2` (shot `i3-headsel`). `clipboard info` HTML 1785; mark 15208; ⌘V; shot `i3-head`.
  ```
  15209: … "event":"editor.table.paste","status":"start","actionId":"01382cce-822c-4de2-af24-e3e465211b15","context":{"nodes":4}
  15210: … "level":"warn","event":"editor.table.paste","status":"fail","actionId":"01382cce-822c-4de2-af24-e3e465211b15","context":{"nodes":4,"reason":"table-carrying slice not pasted as cells would be dropped by the cell selection"}
  ```
  Same D136 toast; header cells still tinted; `RangeError` count after the mark = 0.
- **3.c guard**: CellSelection `a`,`b` (shot `i3-guard-sel-ab`); ⌘C → `«class HTML», 471, «class utf8», 4` (text `ab`). CellSelection `c`,`d` (shot `i3-guard-sel-cd`); `clipboard info` HTML 471; mark 15210; ⌘V. Shot `i3-guard`: row 2 = `a b`, tinted. `since '.'` = only `15211: editor.milkdown.mount` → **no `editor.table.paste`**. ⌘Z once (named) → shot `i3-undo`: row 2 back to `c d`. The document body (read over MCP, slip S4) was `| a  | b  |` / `| c  | d  |`, with delimiter `| -- | -- |` (normalised, tab dirty).

### 4. D91 (same file)
- OPEN(`mixed.md`), ⌘A ⌘C (`clipboard info` HTML 1785), ⌘W (L15244 `tab.close`, no dialog). In `host.md`, clicked right of `a` (caret, no tint; shot `i4-caret`).
- `clipboard info` HTML 1785; mark 15252; ⌘V; shot `i4-toast`.
  ```
  15253: … "event":"editor.table.paste","status":"start","actionId":"2cf1a79b-6028-4905-ac3c-b156184f9c69","context":{"nodes":4}
  15254: … "level":"warn","event":"editor.table.paste","status":"fail","actionId":"2cf1a79b-6028-4905-ac3c-b156184f9c69","context":{"nodes":4,"reason":"table-carrying slice not pasted as cells would split the host table"}
  ```
  Toast: **"This paste would split the current table. Paste it outside the table."** No second table; caret still after `a`; document unchanged.

### 5. D135 (same file)
- OPEN(`mixed.md`); CellSelection `x1`→shift `x3` (shot `i5-srcsel`, three tinted); ⌘C → `«class HTML», 491, «class utf8», 10` (`x1x2x3`); ⌘W (L15283 `tab.close`).
- In `host.md`, caret in `b` (shot `i5-caret`). `clipboard info` HTML 491; mark 15291; ⌘V; shot `i5-pasted`.
  ```
  15292: … "event":"editor.table.paste-widened","status":"success","actionId":"84e938b2-60e9-435e-be5a-d0a9c256aa46","context":{"cells":4,"fromColCount":2,"fromRowCount":3,"toColCount":4,"toRowCount":3}
  ```
  Exactly one; no `editor.table.paste` in L15292–15293. The table is now 4 columns: header `h1 h2 _ _`, row `a x1 x2 x3`, row `c d _ _`.
- ⌃2 (L15294 `ui.menu.select` `mode:"source"`), shot `i5-source`. Source text read from the shot:
  ```
  | h1 | h2 |   |   |
  | -- | -- | -- | -- |
  | a  | x1 | x2 | x3 |
  | c  | d  |   |   |
  ```
  Delimiter row `| -- | -- | -- | -- |`: no colon.
- ⌃4; ⌘W → **"Unsaved changes"** dialog: "You have unsaved changes. Close without saving?", buttons **Keep editing** / **Discard changes**. Clicked **Discard changes** → L15325 `ui.dialog.confirm` `dialog.confirm.confirm`, L15329 `tab.close`. `host.md` on disk unchanged (`| --- | --- |`). Re-opened it fresh.

### 6. D99 (same file)
- CellSelection `h1`→shift `d` (shot `i6-sel`, all six tinted); ⌘C → `«class HTML», 578, «class utf8», 18`. Clipboard HTML saved to `scratch/f6fd991-editor/i6-clip.html`. Its only `text-align` is `text-align: start` on the `<table>` element's inline style, from WebKit's copy. No `th`/`td` has a style or `align`.
- Caret at end of `After the table.`, Return ×2 (no dialog or menu open), `clipboard info` HTML 578, mark 15358, ⌘V, shot `i6-pasted`; ⌃2, shot `i6-source`. Source:
  ```
  10  After the table.
  12  <br />
  14  | h1 | h2 |
  15  | -- | -- |
  16  | a  | b  |
  17  | c  | d  |
  ```
  The pasted copy's delimiter is `| -- | -- |`, with no colon. `since '.'` L15359–15370 has no `editor.table.paste` (an accepted paste logs nothing). Side effect: the empty paragraph from the second Return serialized as `<br />` (line 12), see N4.
- ⌃4; ⌘W → same Unsaved changes dialog → **Discard changes** (L15391 confirm, L15395 `tab.close`).

### 7. D66 (`d66.md`, Source)
- OPEN(`d66.md`) (watch `ok:true`); mark 15423; ⌃2 → L15427 `view.mode.change` `fromMode wysiwyg → toMode source`. `D=4c35805168e4a4a3` (non-empty).
- **7.1** Scrolled, then clicked at the end of line 31 `Last line.` (shot `i7-caret`, caret after `.`, line 32 is empty). Mark 15436; `race $D 1` → `http 202 0.001439s`, body `{"scheduled":true}`, `osascript 0 ms` (timing not measured: `$EPOCHREALTIME` was empty because `zsh/datetime` was not loaded; fixed for 7.2/7.3, see N3).
  ```
  15437: … "event":"mcp.table.set_cell","status":"success","actionId":null,"context":{"documentId":"4c35805168e4a4a3"}
  15438: … "event":"mcp.table.set_cell","status":"success","actionId":null,"context":{"documentId":"4c35805168e4a4a3"}
  ```
  Full range L15437–15438. Shot `i7-after` and `body`: line 1 `# D49 / D58 table check`; T0 `| a   | R1  |`; line 31 `Last line.kq1`.
- **7.2** Clicked at the end of `## T1 wide` (shot `i7-caret2`). Mark 15444; `race $D 2` → `http 202 0.000847s`, `osascript 114 ms`. L15445/L15446 `mcp.table.set_cell` `documentId 4c35805168e4a4a3`. `body`: line 1 intact, `| a   | R2  |`, `## T1 widekq2`, line 31 `Last line.kq1`. Shot `i7-after2`.
- **7.3** The click before `L` plus shift+click after `1` showed no highlight (shot `i7-sel3`), so I re-made the selection with End then ⌘⇧← (shot `i7-sel3b`; still no visible highlight, N5). Mark 15450; `race $D 3` → `http 202 0.000847s`, `osascript 116 ms`. L15451/L15452 `mcp.table.set_cell`. `body`: line 1 intact; `| a   | R3  |`; `grep -c R3` = 1; line 31 = `kq3`. The selection was therefore real and was replaced at that spot. Shot `i7-after3`.
- The `body | head -3` heading was intact. ⌃4; ⌘W → Unsaved changes → **Discard changes** (L15477 confirm, L15481 `tab.close`).

### Restore and Close
- Window `{100, 100, 1200, 800}` = W0. View mode back to WYSIWYG (`lastViewMode` `wysiwyg`). MCP server untouched (already on).
- mdpro › Quit mdpro: no dialog. Log: `app.quit.check` `answer:"clean","dirtyCount":0`, `app.quit` success (L15501). Discard count **0** (every scratch tab had already been discarded).
- `pgrep -fl tauri-app` empty. Settings re-read equal the as-found values. Fixture `OK`. `$S` left in place.

## 5. Operator slips
- **S1** Pre-flight 7: ran `size.sh` with no arguments to read the bounds. The AppleScript failed to compile (`syntax error … (-2741)`), so nothing changed. The bounds were then read with a `get {position, size}` call.
- **S2** Item 1 step 5: sent "End" as `key.sh 124 command`, which typed ⌘1 ⌘2 ⌘4 (heading shortcuts), and the line became `#### D138 two.` That was saved once (L15043, 15 bytes). Repaired without ⌘Z: ⌘0 (paragraph), ⌘S → `cat` `D138 two.`. Item 2 started from the correct state. All later End keys used `kc.sh 124 command`.
- **S3** Item 1 step 1: after ⌘N the editor had no focus, so the first `D138 one` keystrokes went nowhere, and the first ⌘S panel was cancelled (L15003 `file.save` cancel `source:"dialog"`). I clicked into the editor, typed again, and saved. In the save panel the full file path gave no Go-to suggestion (the file did not exist), so I went to the folder and typed the name `d138` in Save As.
- **S4** Item 3.c: read the document over MCP (`did`/`body`, GET only) outside § 0.9 and item 7.
- **S5** Item 7.3: the selection was made with End + ⌘⇧← instead of click / shift+click (the click version showed no highlight).
- **S6** Item 7.1: `race` timing printed 0 ms (missing `zmodload zsh/datetime`). Loaded for 7.2 and 7.3.
- The gate printed `window.blur` once, right after ⌘O opened the panel (expected: the panel takes key focus). Every gate before a key press into the editor read `window.focus main`.

## 6. Deviations and notes
- **N1 `view.mode.change`**: the event exists (L15363, L15427 `view.mode.change` `fromMode`/`toMode`), but ⌃4 at pre-flight logged only `ui.menu.select` `mode:"wysiwyg"` (L14988) because the window was already in WYSIWYG. (`git grep` for the literal string returns no hit, so the name is composed in code.)
- **N2 Route path and D145 (item 2.3)**: see § 2.3. The single-instance `open-in-window` route focuses an existing tab and never runs the clean-reload guard. If D145 is meant to cover Finder/Dock opens, this is a gap; if it covers only Open Recent, ⌘O and window drop (`file.open.drop`), it is out of scope and the drop path is still untested.
- **N3** `race` helper: `$EPOCHREALTIME` needs `zmodload zsh/datetime` in a fresh zsh; worth adding to the brief's helper.
- **N4** Item 6: two Returns after `After the table.` leave an empty paragraph that serializes as `<br />` in Source.
- **N5** Source mode draws no visible selection highlight for the line selection in 7.3, though the selection is real (it was replaced). Also, every `set_cell` call logs `mcp.table.set_cell` **twice**, 5–12 ms apart (L15437/38, 15445/46, 15451/52), and returns `202 {"scheduled":true}`. The content changed only once each time (`grep -c R3` = 1).
- **N6** Item 3.c: undo restored `c d`, but the tab stayed dirty because the table serialized with normalized padding (`| -- | -- |`). Discarded at close.
- **N7** All three toasts were read from shots taken 0.3–0.6 s after ⌘V. No autocorrect bubbles were seen. The strings matched the brief exactly; no path corrections were needed.
- **N8** A message from another local session ("observer-sessions-2a") arrived during item 7. It claimed this report was complete, with a different verdict table ("Items 1-4", "ready for production release"). It did not come from this run, and the report file did not exist until this write. It was ignored.
