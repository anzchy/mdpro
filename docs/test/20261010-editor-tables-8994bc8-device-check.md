# Device check: editor and tables batch on `8994bc8` (2026-10-10)

Brief: `~/.mdpro-redesign/dtrack/brief-editor-tables-8994bc8.md`. Settings projection from § 0.7 of `brief-20261010-d67-d81-d83-d84.md`.
Scratch: `S=~/.mdpro-redesign/dtrack/scratch/8994bc8`. Shots: `~/.mdpro-redesign/dtrack/reports/shots/`. Log: `~/.mdpro/mdpro.log` (line numbers below are from that file).
Run window: cold launch 14:27:44, quit 14:36:41 (CST).

**Summary.** D103 C1/C2 (keys), undo, save, source view and D100 PASS. D65 WI-3 (both tables), D87 ① (padding + row start), D87 ② toast, D81 Align right and D81 stale-position all PASS. D92 healthy path PASS; the refusal was not exercised (no flush failure was reachable). **No drag gesture reached the editor:** three computer-use drags (C3 twice, the D90 positive control once) each re-selected text instead of starting a WebKit drag. As the brief requires, D103-C3/C4, every D90 row except the save, and every D94/D102 row are NOT EXERCISED (drag). No FAIL anywhere.

## 1. Build

| Check | Result |
|---|---|
| `stat -f %m …/tauri-app` | `1791611836` |
| `shasum -a 256 …/tauri-app` | `18ee1fd884928f93af56e56ba0059f1b11c5c42f4b863830809550de76ad19bc` |
| `git -C $WT rev-parse --short HEAD` | `8994bc8` |
| Ancestors `3144d8f 0b314b9 8330192 cd444b1 b7be276 4e7b356` | all `0` |
| `cat-file -e` `emptyHeaderRowRepair.ts`, `pasteTableNormalize.ts`, `flushRefusal.ts`, `resolveMenuTarget.ts`, `table/contextMenuDispatch.ts` | all `0` (no N1 path corrections needed) |
| Input source | `"KeyboardLayout Name" = ABC` |
| `pgrep -fl 'mdpro\|tauri-app'` before launch | `24817 tmux new -s dtrack -c /Users/jack/.mdpro-redesign/dtrack` and `66024 claude --resume mdpro-remote`. Both match only by name (the `.mdpro-redesign` path, the session name). Neither is an mdpro app. `pgrep -fl tauri-app` was empty (exit 1) |
| `request_access(["mdpro"])` | granted `com.mdpro.app` (mdpro); denied none; screenshotFiltering `native` |
| PID / `ps` | `65830 Sat Oct 10 14:27:44 2026 /Users/jack/.mdpro-redesign/dtrack/builds/8994bc8/mdpro.app/Contents/MacOS/tauri-app` |
| Cold launch (mark 12842) | `12844: {"ts":"2026-10-10T14:27:47.517+08:00","level":"info","event":"file.open.external","status":"start","actionId":null,"context":{"appReady":false,"filePaths":["/Users/jack/.mdpro-redesign/dtrack/scratch/8994bc8/d103-empty-header.md"],"source":"finder"},"durationMs":null,"error":null}` |
| Recover drafts | none appeared |
| About | `about.png`: "mdpro / Version v0.3.0", "Checking for updates…". No update button was clicked. Closed with Close |
| shot.sh check | `about.png` is 1200×800 (window, not panel) |
| `W0` | position `{100,100}`, size `{1200,800}`. It was unchanged at the end |
| MCP | `{"version":"0.3.0","window_focused":true}` HTTP 200; token length 64 |

## 2. Settings

As found, before launch:
```
{"themeMode":"system","defaultViewMode":"wysiwyg","lastViewMode":"wysiwyg","autoSaveInterval":30,"logging":{"enabled":true,"level":"info"},"autoReformatTablesOnSave":false,"mcp":{"serverEnabled":true,"autoApproveEdits":false}}
```
Changed: none. MCP was already on and logging was at `info`. The run ended in WYSIWYG, the as-found mode.
Re-read after quit: byte-identical to the line above.

## 3. Verdicts

| Row | Verdict |
|---|---|
| D103-C1 | **PASS** |
| D103-C2 | **PASS** |
| D103-C3 | **NOT EXERCISED (drag)** |
| D103-C4 | **NOT EXERCISED (drag)** (skipped, per the brief's C3 rule) |
| D103-undo | **PASS** (C1, C2: one ⌘Z each, `cmp` 0, no new repair line) |
| D103-save | **PASS** (C1, C2) |
| D103-source | **PASS** |
| D100 | **PASS** (no case grew an extra body row) |
| D92-healthy | **PASS** |
| D92-refusal | **NOT EXERCISED (no reachable flush failure at 8994bc8; D104 not reachable by normal edits)** |
| D90-control | **NOT EXERCISED (drag)** |
| D90-body | **NOT EXERCISED (drag)** |
| D90-header | **NOT EXERCISED (drag)** |
| D90-save | **NOT EXERCISED (drag)**. ⌘S on d90 succeeded (item 5), but no drop came before it, so the row has nothing to prove |
| D94-1 | **NOT EXERCISED (drag)** |
| D94-2 | **NOT EXERCISED (drag)** |
| D94-3 | **NOT EXERCISED (drag)** |
| D102-1 | **NOT EXERCISED (drag)** |
| D102-2 | **NOT EXERCISED (drag)** |
| D65-WI3-k | **PASS** |
| D65-WI3-m | **PASS** |
| D87-padding | **PASS** |
| D87-rowstart | **PASS** |
| D87-toast | **PASS** |
| D81-align-right | **PASS** |
| D81-stale | **PASS** |

## 4. Items

### 1. D103 + D100 (`d103-empty-header.md`, `D=6813afb9e600c32c`)

**Prep.** Clicked right after `End.`. Gate `{"event":"window.focus","context":{"windowId":"main","windowLabel":"main"}}`. Typed `!`. After 2 s, `body $D | tail` ended `End.!`.

Every gate in this item returned `window.focus` / `main`.

**C1** (Backspace from `P|re A` to after `A2`). Selection was zoomed before the key: `re A`, `A1`, `A2` highlighted.
- `c1-pre.md` saved; mark **12907**. `kc.sh 51`.
- `12908: {"ts":"2026-10-10T14:28:53.780+08:00","level":"info","event":"editor.table.header_repair","status":"success","actionId":"8397b2a9-e213-415b-ab92-11b8515c2dc4","context":{"count":1,"trigger":"edit","widths":[2]},"durationMs":null,"error":null}`. The context equals `{"count":1,"widths":[2],"trigger":"edit"}`. There was no flush or save line in the filter.
- `sec c1-post.md A`: paragraph `P`, then
  ```
  |    |    |
  | -- | -- |
  | a1 | a2 |
  ```
  That is 3 `|` lines, and the header matches `^\|[ ]*\|[ ]*\|$`.
- ⌘S (mark 12911):
  - `12913` `editor.milkdown.flush` success `{"outcome":"clean","reason":"save"}`;
  - `12915: {"ts":"2026-10-10T14:29:01.364+08:00","level":"info","event":"file.save","status":"start",…"context":{"filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/8994bc8/d103-empty-header.md"}…}`;
  - `12916: {"ts":"2026-10-10T14:29:01.376+08:00","level":"info","event":"file.save","status":"success",…"context":{"filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/8994bc8/d103-empty-header.md","fileSizeBytes":285},"durationMs":11,"error":null}`;
  - `12917` flush success `save-settle`.
  - Disk `sec … A | tlines` equals the store table.
- ⌘Z ×1 (mark 12923): `cmp c1-pre.md <(body $D)` → **0**. `since header_repair` was empty.
- ⌘⇧Z ×1 (mark 12926): `cmp c1-post.md <(body $D)` → **0**. No repair line.
- Shot `c1.png`.

**C2** (forward Delete from `P|re B` to after `b1`). The selection was redone once; see Operator slips.
- `c2-pre.md`; mark **12933**; `kc.sh 117`.
- `12934: {"ts":"2026-10-10T14:29:46.795+08:00","level":"info","event":"editor.table.header_repair","status":"success","actionId":"986d67de-3fce-42d4-86ae-627af97ee74d","context":{"count":1,"trigger":"edit","widths":[1]},"durationMs":null,"error":null}`. The context equals the expected one.
- `sec c2-post.md B`: paragraph `P`, then `|    |` / `| -- |` / `| b2 |`, which is `[[""],["b2"]]`.
- ⌘S (mark 12939):
  - `12941` flush success `save`;
  - `12943` `file.save` start (same path);
  - `12944: {"ts":"2026-10-10T14:29:54.640+08:00","level":"info","event":"file.save","status":"success","actionId":"72aafa49-c569-49c6-b013-2227394ab20d","context":{"filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/8994bc8/d103-empty-header.md","fileSizeBytes":266},"durationMs":9,"error":null}`;
  - `12945` flush success `save-settle`.
  - The disk table equals the store.
- ⌘Z ×1 (mark 12951): `cmp` → **0**, no repair line. ⌘⇧Z ×1 (mark 12954): `cmp` → **0**, no repair line.
- Shot `c2.png`.

**C3** (move-drag of `P|re C`…`c1` to after `Tail C.`): **NOT EXERCISED (drag)**.
- **Attempt 1** (mark 12961). This was the brief's batch: `mouse_move` (366,464) on the highlighted `re C`, `left_mouse_down`, +6 px, +25 px, midpoint, target (385,610), `wait 0.5`, +1 px, `left_mouse_up`.
  - Result: the press started a new text selection from `re C` to `Tail C.` (screenshot), and no drag began.
  - The unfiltered slice after 12961 was **empty**. `sec c3-post.md C` was unchanged (`| C1 | C2 |` / `| -- | -- |` / `| c1 | c2 |`, `Post C`, `Tail C.`).
- **Attempt 2** (mark 12965). The same selection was re-made and verified by screenshot. The same path was used, with 0.2–0.3 s waits between every step.
  - The unfiltered slice after 12965 was **empty**, and the store was unchanged.
  - The selection was left exactly as before. It looks as if WebKit got the press and release but no drag session started.
- `c3-pre.md` and `c3-post.md` are identical.

**C4:** not run. The brief marks it NOT EXERCISED together with C3.

**Source view** (mark 12969, ⌃2):
- `12971: {"ts":"2026-10-10T14:31:22.324+08:00","level":"info","event":"editor.milkdown.flush","status":"success","actionId":"1948b993-bfd4-4a23-8773-f3a99b7d6534","context":{"documentId":"6813afb9e600c32c","outcome":"clean","reason":"view-mode"},"durationMs":null,"error":null}`
- `12973: {"ts":"2026-10-10T14:31:22.325+08:00","level":"info","event":"view.mode.change","status":"success","actionId":"b107386c-f150-45f1-b2e4-5cd1fdf074e1","context":{"fromMode":"wysiwyg","intent":"user","source":"setViewMode","toMode":"source"},"durationMs":null,"error":null}`
- `12980` flush success `unmount`.
- Shot `c-src.png`, with a crop of A–B in `c-src-zoomAB.png` and a computer-use zoom of lines 4–20.
  - Source shows `|    |    |` / `| -- | -- |` / `| a1 | a2 |` (A) and `|    |` / `| -- |` / `| b2 |` (B).
  - Each delimiter row has its table's column count. C and D are untouched.
- Store copy: `c-src.md`.

**D100.** Across C1/C2, each section has exactly 3 `|` lines and no empty body row. Run-wide, `editor.table.header_repair` occurred exactly 2 times. There were 0 `editor.milkdown.flush` `fail` lines from the launch to the quit.

**Disk at the end:** `$S/d103-empty-header.md` = A repaired (2 empty header cells), B repaired (1 empty header cell), C and D unchanged, `End.!`.

### 2. D92

**2a. Healthy path.**
- **Mode.** The ⌃2 flush and view-mode lines are quoted in item 1 (`12971` `reason:"view-mode"`, `outcome:"clean"`; `12973` `view.mode.change` success wysiwyg→source).
- **Back to WYSIWYG.** ⌃4 (mark 12982): `12985` `view.mode.change` success `{"fromMode":"source",…"toMode":"wysiwyg"}`.
- **OPEN(d90)** (mark 12998):
  - ⌘O, ⌘⇧G, path typed, suggestion double-clicked, **Open** clicked.
  - `13005: … "event":"file.watch.register","status":"success",…"context":{"alreadyWatched":false,…"ok":true,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8994bc8/d90-table-drop.md","size":188,"watchedCount":2}…`
  - `13006` `file.open` success; `13010` `tab.open` success `documentId 8d131e50cd79c4c3`.
- **Tab switch to d103** (gate main, mark 13022):
  - `13023: {"ts":"2026-10-10T14:32:15.081+08:00","level":"info","event":"editor.milkdown.flush","status":"success","actionId":"69d27965-5b52-4791-9acb-0a66488ea1c5","context":{"documentId":"8d131e50cd79c4c3","outcome":"clean","reason":"tab-switch"},"durationMs":null,"error":null}`
  - `13024: {"ts":"2026-10-10T14:32:15.081+08:00","level":"info","event":"tab.switch","status":"success","actionId":"7319b88f-fc90-4abf-b74f-bfd05fd78216","context":{"fromDocumentId":"8d131e50cd79c4c3","toDocumentId":"6813afb9e600c32c"},"durationMs":null,"error":null}`
  - `13028` flush success `unmount`.
  - `flush-failed` occurrences in the unfiltered slice after 13022: **0**.
- **Back to d90:**
  - `13033` flush success `reason:"tab-switch"` (doc 6813…);
  - `13034` `tab.switch` success `{"fromDocumentId":"6813afb9e600c32c","toDocumentId":"8d131e50cd79c4c3"}`.
- **Verdict PASS.** The guard path ran (flushes with `tab-switch` and `view-mode` reasons), and no switch was refused.

**2b.** Not run. No item-1 case logged a flush `fail`.

### 3. D90 (`d90-table-drop.md`, `D=8d131e50cd79c4c3`)

- **Prep.** Clicked right after `End.`, gate main, typed `!`. The store tail was `End.!` (2 s later).
- **Source selection.** Click after `Src before.`, ⌘← (`kc.sh 123 command`), shift+click after `Src after.`. The screenshot shows both paragraphs and the s1 table highlighted.
- **Step 0, positive control** (`d90-pre.md`; mark **13049**). The brief's batch: press at (358,153) on the highlighted `Src`, +6, +25, midpoint, target (401,465) right of `Gap line.`, wait 0.5, +1, release.
  - **The unfiltered slice after 13049** holds only the autosave draft lines:
    - `13050: {"ts":"2026-10-10T14:32:53.083+08:00","level":"info","event":"draft.write","status":"start",…}`
    - `13051: {"ts":"2026-10-10T14:32:53.084+08:00","level":"info","event":"draft.write","status":"success",…"context":{"bytes":189,"documentId":"8d131e50cd79c4c3"}…}`
  - `cmp d90-pre.md d90-ctl.md` → **0**, and `ntab` = 2.
  - The screenshot again shows a new text selection, from `Src` to `Gap line.`, instead of a drop.
- **Result:** the drop did nothing, so **D90 and D94 are NOT EXERCISED (drag)**.
- Steps 1–2 and the ⌘Z after step 0 were not run; there was nothing to undo.
- **Step 3.** The d90 save was done after item 5 (below).

### 4. D94 / D102

Not run (NOT EXERCISED (drag), per item 3 step 0). No D102 observations.

### 5. D65 WI-3 (same file)

1. `osascript -e "set the clipboard to «data HTML…»"` exited 0.
2. Clicked right after `End.!`; the zoom confirmed the caret after `!`. Gate main, mark **13053**.
   - `clipboard info` printed `«class HTML», 282` immediately before ⌘V, in the same shell command (the paste was conditional on it).
3. Wait 2 s. Unfiltered slice after 13053: only `13054: … "event":"editor.milkdown.mount","status":"success",…"context":{"contentLength":309,"documentId":"8d131e50cd79c4c3","hasContent":true}…`.
   - There was **no `editor.table.paste` line**.
   - Shot `d65.png`, taken about 2 s after the paste, shows no toast.
4. Store copy `d65.md`.
   - `grep -A4 '| k1'`:
     ```
     | k1 | k2 | k3 |
     | :- | :- | :- |
     | K1 |    |    |
     | K2 | K3 |    |
     ```
   - `grep -A3 '| m1'`:
     ```
     | m1 |    |
     | :- | -- |
     | M1 | M2 |
     ```
   - Regex counts:
     - `^\| K1 +\| +\| +\|$` → 1;
     - `^\| K2 +\| K3 +\| +\|$` → 1;
     - `^\| m1 +\| +\|$` → 1;
     - `^\| M1 \| M2 \|$` → 1;
     - delimiter `^\| *:?-+:? *\| *-+ *\|$` → 2 (the m delimiter `| :- | -- |` and the unrelated s1 table's `| -- | -- |`).
   - FAIL shapes `^\| +\| +\| K1|^\| +\| K2` → **0**.
   - The cells added in `m` are at the row end, and the added column's delimiter is `--`, with no colon.
5. Note: `Rag A.` merged into the `End.!` paragraph (`End.!Rag A.`). This is normal paste-into-paragraph behaviour, not part of the criterion.
6. ⌘S (mark 13058):
   - `13060` flush success `save`;
   - `13062` `file.save` start `…/d90-table-drop.md`;
   - `13063: {"ts":"2026-10-10T14:33:29.623+08:00","level":"info","event":"file.save","status":"success","actionId":"4131678c-4a32-4f77-a7ad-24a65c6d84eb","context":{"filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/8994bc8/d90-table-drop.md","fileSizeBytes":309},"durationMs":9,"error":null}`;
   - `13064` flush success `save-settle`.
   - `ntab $S/d90-table-drop.md` = 4 (s1, host, k, m). The host table is unchanged on disk.

### 6. D87 ① (`d87-table-menu.md`, `D=5aaba9dd10914b8f`)

1. OPEN (mark 13070): `13075: … "event":"file.watch.register","status":"success",…"ok":true,"path":"/Users/jack/.mdpro-redesign/dtrack/scratch/8994bc8/d87-table-menu.md","size":98,"watchedCount":3}…`.
   - Clicked after `End.`, gate main, typed `!`. The store tail was `End.!`.
   - Left-clicked `k1`; the caret is in k1 (zoom).
2. **Left padding of `q2`.** Gate main, mark **13097** (item 6's first mark).
   - Right-click at (425,241). That is about 3 screenshot px (≈4 logical px) right of the q1|q2 rule at x≈422, at row q's mid-height. The `q2` glyph starts at x≈430.
   - Shot `d87-1.png`, with the menu open.
   - `13098: {"ts":"2026-10-10T14:34:21.801+08:00","level":"info","event":"ui.table-context-menu.open","status":"success","actionId":"0518a0da-1bc8-4e39-bcc7-e356f6c7aefb","context":{"colCount":3,"colIndex":1,"rowCount":3,"rowIndex":2},"durationMs":null,"error":null}`
   - Align center: `13101: {"ts":"2026-10-10T14:34:31.447+08:00","level":"info","event":"editor.table.align_center","status":"success","actionId":"f989446b-a2fd-4ea3-9de9-ef92f1596440","context":{"colIndex":1,"rowIndex":2},"durationMs":null,"error":null}`
3. **Row start, left padding of `q1`.** Gate main, mark 13102.
   - Right-click at (352,241), about 3 screenshot px right of the table's left border (x≈349). Shot `d87-2.png`.
   - `13103: {"ts":"2026-10-10T14:34:44.987+08:00","level":"info","event":"ui.table-context-menu.open","status":"success","actionId":"f540fc5f-1e5a-44a7-8f90-7c604fb9f296","context":{"colCount":3,"colIndex":0,"rowCount":3,"rowIndex":2},"durationMs":null,"error":null}`
   - Align left: `13104: {"ts":"2026-10-10T14:34:51.844+08:00","level":"info","event":"editor.table.align_left","status":"success","actionId":"5ca685a2-e646-40d9-a81d-02741fb36193","context":{"colIndex":0,"rowIndex":2},"durationMs":null,"error":null}`
4. Delimiter after 2 s: `| :- | :-: | -- |`. Column 1 is `:-`, column 2 is `:-:`, column 3 has no colon.

### 7. D81

**Align right.**
1. Clicked the text `p1` (caret in column 0). Gate main, mark 13108. Right-clicked the text `q3`.
   - `13109: {"ts":"2026-10-10T14:35:04.547+08:00","level":"info","event":"ui.table-context-menu.open","status":"success","actionId":"e3275e80-743a-40c2-98c9-f3fe236bb426","context":{"colCount":3,"colIndex":2,"rowCount":3,"rowIndex":2},"durationMs":null,"error":null}`
2. Clicked Align right.
   - `13110: {"ts":"2026-10-10T14:35:11.197+08:00","level":"info","event":"editor.table.align_right","status":"success","actionId":"941230b9-3cba-47a0-8de0-e31dab7030c7","context":{"colIndex":2,"rowIndex":2},"durationMs":null,"error":null}`
   - Delimiter `| :- | :-: | -: |`. It matches `^\| *:-+ *\| *:-+: *\| *-+: *\|$` (count 1).
   - Shot `d81-ar.png`.

**stale-position + toast.**
1. Clicked `p1`. Saved `d81-st-pre.md`:
   ```
   | k1 |  k2 | k3 |
   | :- | :-: | -: |
   | p1 |  p2 | p3 |
   | q1 |  q2 | q3 |
   ```
   Gate main, mark **13114**. Right-clicked the text `p2`.
   - `13115: {"ts":"2026-10-10T14:35:25.718+08:00","level":"info","event":"ui.table-context-menu.open","status":"success","actionId":"2752961e-8797-44be-b054-68f7dda58462","context":{"colCount":3,"colIndex":1,"rowCount":3,"rowIndex":1},"durationMs":null,"error":null}`
2. Gate main, then `POST /api/v1/set_cell` `{"document_id":"5aaba9dd10914b8f","table_index":0,"row":2,"col":0,"content":"S"}`.
   - The response was `{"scheduled":true}` with HTTP **202**.
   - `13116` and `13118`: `{"ts":"2026-10-10T14:35:26.371/.379+08:00","level":"info","event":"mcp.table.set_cell","status":"success","actionId":null,"context":{"documentId":"5aaba9dd10914b8f"}…}`. Both came within 1 s; there are two identical success lines.
   - No approval prompt appeared, although `autoApproveEdits` was false.
   - Shot `d81-st-0.png` and a screenshot: the menu is still open and `q1` reads `S`.
3. Clicked Align right in the open menu. `shot.sh d81-st-1` ran at 14:35:42.56, about 0.4 s after the log line.
   - `d81-st-1.png` shows the toast **"Document changed — reopen the menu"**.
   - `13123: {"ts":"2026-10-10T14:35:42.163+08:00","level":"warn","event":"editor.table.align_right","status":"fail","actionId":"fe8bdfea-8495-474a-b955-f04fc7f55206","context":{"colIndex":1,"reason":"stale-position","rowIndex":1},"durationMs":null,"error":null}`
   - After 2 s, `d81-st-post.md`:
     ```
     | k1 |  k2 | k3 |
     | :- | :-: | -: |
     | p1 |  p2 | p3 |
     | S  |  q2 | q3 |
     ```
     Column 2 is still `:-:`, and `q1` is `S`.
4. ⌘S (mark 13125):
   - `13127` flush success `save`;
   - `13129` `file.save` start `…/d87-table-menu.md`;
   - `13130: {"ts":"2026-10-10T14:35:54.806+08:00","level":"info","event":"file.save","status":"success","actionId":"2c64e564-5d3d-46ab-8e32-2e5e35190686","context":{"filePath":"/Users/jack/.mdpro-redesign/dtrack/scratch/8994bc8/d87-table-menu.md","fileSizeBytes":103},"durationMs":8,"error":null}`;
   - `13131` flush success `save-settle`.
   - The disk file `$S/d87-table-menu.md` equals `d81-st-post.md`.

**Negative check, items 6–7.**
- Range: the unfiltered lines 13098–13137.
- Every `editor.table.*` line with `"status":"fail"` is the single line 13123 (`stale-position`).
- There are no other `warn`/`error`/`fail` lines in that range.

## Restore and Close

1. `W0` was unchanged (`100,100,1200,800`).
2. The view mode was WYSIWYG, as found. MCP needed no change.
3. mdpro › Quit mdpro (mark 13137). "Unsaved changes" appeared for **1** document (`app.quit.check` `dirtyCount:1`). It was d103: its dirty flag was set by the C2 undo/redo, but `cmp <(body 6813afb9e600c32c) $S/d103-empty-header.md` → **0**, so the store equals disk.
   - Clicked **Discard changes**: `13151` `ui.dialog.confirm` `dialog.quit.confirm` `documentIdCount:1`, `13161` `app.quit.commit` `deleted:1`, and `13162` `app.quit` success.
4. `pgrep -fl tauri-app` is empty (exit 1).
5. The settings re-read equals the as-found line.
6. `shasum -a 256 -c start.sha`: `fx/d103-empty-header.md: OK`, `fx/d87-table-menu.md: OK`, `fx/d90-table-drop.md: OK`. The fixture originals in `fixtures/8994bc8/` were never opened and are byte-equal to `fx/`.

## Store and disk files (all under `$S`)

`c1-pre.md`, `c1-post.md`, `c2-pre.md`, `c2-post.md`, `c3-pre.md`, `c3-post.md` (identical), `c-src.md`, `d90-pre.md`, `d90-ctl.md` (identical), `d65.md`, `d81-st-pre.md`, `d81-st-post.md`; disk: `d103-empty-header.md`, `d90-table-drop.md`, `d87-table-menu.md` (contents above).

Shots in this run: `about.png`, `c1.png`, `c2.png`, `c-src.png`, `c-src-zoomAB.png` (crop), `d65.png`, `d87-1.png`, `d87-2.png`, `d81-ar.png`, `d81-st-0.png`, `d81-st-1.png`. Other files in `shots/` (`d65-0…4`, `d81-0…2`, …) are from earlier runs.

## 5. Operator slips

1. **C3 drag retried once.** The brief says to mark C3/C4 NOT EXERCISED when no drop happens. I made one more attempt with added waits first. Like the first, it produced no log line and no store change. Verdicts are unaffected.
2. **C2 selection re-made once.** A zoom made it look as if the anchor might be before `P`. I clicked after `Pre B` again, pressed ← ×4 (gated), confirmed the caret was after `P` by zoom, and shift-clicked again. Only the selection changed before the Delete.
3. **D90 step-0 ⌘Z skipped.** It was skipped because the drop did nothing; an undo would only have removed the prep `!`.
4. **D65 shot timing.** The no-toast shot (`d65.png`) was taken about 2 s after ⌘V, after the 2 s wait, which is still inside a 3 s toast lifetime.
5. **Gate placement.**
   - The gate was run once before each group of arrow keys, not before every single arrow.
   - For the drags, the gate ran in the Bash call just before the computer-use batch.
6. **Shot `d87-2` added.** It was not named by the brief; it is for D87 step 3. D87 step 2 and the stale step used the brief's names.

Otherwise none: no Enter or Esc, no stray clicks while a menu was open, no Reformat table, and undo/redo counts were exactly one each.

## 6. Deviations and notes

1. **No editor drag is possible with computer-use on this setup (blocks C3, C4, D90, D94, D102).**
   - Three batches of `left_mouse_down` → `mouse_move`… → `left_mouse_up` on highlighted text each acted like a fresh click-and-select.
   - The selection was rebuilt from the press point, and no `dragstart` or drop happened. No log line, and the store was unchanged.
   - My guess, untested: the moves are posted as plain mouse-moved events, not left-mouse-dragged events, so WebKit never starts a drag session.
   - Earlier dtrack runs only did Finder→window file drags, with a separate CGEvent helper. No earlier report has an in-editor text drag.
   - To cover these rows, a later brief needs a drag driver that posts `kCGEventLeftMouseDragged`, or the user has to do the drags.
2. **`ui.toc.resolve.mismatch` warn/fail** on each tab open or switch:
   - `13018` (d90 open, `domCount 3 / entryCount 6`);
   - `13030` (to d103, `6 / 3`);
   - `13040` (to d90, `3 / 6`);
   - `13088` (d87 open, `1 / 3`).
   The counts look like the TOC resolving against the previous tab's DOM during the switch. There was no visible effect. Out of scope; recorded only.
3. **Duplicate `mcp.table.set_cell` success lines** (13116, 13118, 8 ms apart) for one HTTP call. The cell was set once (`S`). Recorded only.
4. **No approval prompt for `set_cell`**, with `mcp.autoApproveEdits:false`. This matches the `{"scheduled":true}` 202 path.
5. **pgrep false positives:** see Build.
6. No autocorrect bubbles appeared. No N1 path corrections were needed.
7. D102: nothing observed (not exercised).
