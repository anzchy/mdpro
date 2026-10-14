> **Delegator ruling (2026-10-14).** Accepted: C1, C2a, C2b (re-run), C3 and C4 PASS; D161 is device-verified on `6768740`. The first C2b attempt is NOT EXERCISED (operator slip) and is not counted. The three brief deviations (C4 step 5 returns 201 after Keep editing, the activation is logged as `tab.switch` rather than `document.activate`, new windows open with no tab) are brief corrections, not findings.

# 0.3.2 RC device check, part C: MCP (D161) on `6768740` (2026-10-14)

Brief: `briefs/20261014-brief-rc-032.md` § Part C. One sitting, 16:17–16:22 (+08:00), after parts A and B were accepted. Parts A and B were not repeated.

**Headline.** No FAIL. C1, C2a, C2b, C3 and C4 all **PASS**. Each create opened its tab in exactly one window: the focused window, or else the window focused most recently. Every create logged exactly one `scheduled` line and one `applied` line with the same `actionId`. With no window registered, the route returned `503 NO_WINDOW` and did not emit the event.

Three notes for the delegator:
- **C2b ran twice.** On the first try, Finder was still frontmost, so my click on window B was refused. The tab went to `main`, which was correct for that focus state. That attempt counts as NOT EXERCISED. The re-run passed.
- **C4 step 5 returned `201`, not `503`.** Clicking **Keep editing** re-registers the window right away (`window.close_cancelled` `notified:true`).
- **No `document.activate` line on any create.** The brief expects one, but this build logs `tab.switch` with that `toDocumentId` instead (see §5 N1).

**No token appears in this report, the transcript or any shot.**

## 1. Build evidence

| item | value |
|---|---|
| binary mtime | `stat -f %m` = 1791958358 = `2026-10-14T14:12:38` = `$BIN_MTIME` ✓ |
| binary sha256 | `388e6468075c966f1a258e33f853c2f580e3b64acab4174d564e1daf48bafc16` = `$BIN_SHA` ✓ |
| HEAD | `67687400d347da08e14edf02b5e9aab64578dfa5` ✓ |
| ancestors | 819fa2c ac79c63 658bc1d d91fb38 eafccb4 0d25ce2 8b57388 650061d 402e8eb cfa9503 8a19778 e4230d0 bcba314 eeee04f 3f0d07b: all `0` ✓ |
| `mdpro_mcp` | `-rwxr-xr-x … 8014944 Oct 14 14:12 …/Contents/MacOS/mdpro_mcp` ✓ |
| input source | `ABC` ✓ |
| request_access | `mdpro` granted (`com.mdpro.app`) |
| pre-launch `pgrep -fl 'mdpro\|tauri-app'` | only `tmux …dtrack` and `claude --resume mdpro-remote`; no app process ✓ |
| launch | `open -a "$APP"` (no file) at 16:18:32; PID **5596**, `ps` path `…/builds/6768740/mdpro.app/Contents/MacOS/tauri-app` |
| L18278 | `app.ready` `appVersion:"0.3.2"` `pid:5596` `releaseId:"0.3.2@67687400d347da08e14edf02b5e9aab64578dfa5"` |
| **L18279** | `{"ts":"2026-10-14T16:18:32.802+08:00","level":"info","event":"mcp.http_server.start","status":"success","actionId":null,"context":{"phase":"running","port":55045},…}` ✓ |
| About | `c0-about`: **Version v0.3.2** ("Checking for updates…"; no update button clicked). Closed with the ✕. |
| `W0` | `{100, 100, 1200, 800}` (position, size) |
| token | loaded from `server.token` (64 chars), never printed. `unset TOKEN` at C5. |
| status without token | `curl … /api/status` → **`401`** ✓ |
| status with token | `{"version":"0.3.2","window_focused":true}` **`200`** ✓ |
| `WB` | `mdpro-c104116d-58b3-44fc-ac26-98183491ee4a` (L18317, the first `window.focus` after ⌘⇧N that is not `main`; `window.create` L18315) |
| tiling | screen `0, 0, 1920, 1080`. `main` → `{0, 30, 958, 964}`, B → `{960, 30, 960, 964}` (the 25 I asked for came back as 30). CG window ids: `main` = 15646, B = 15648. |

## 2. Settings

As found (`$S/asfound.json`): `{"themeMode":"system","defaultViewMode":"wysiwyg","lastViewMode":"wysiwyg","autoSaveInterval":30,"logging":{"enabled":true,"level":"info"},"mcp":{"serverEnabled":true}}`. `mcp.serverEnabled` was `true`.
Re-read after quit (`$S/restored.json`): identical (`cmp` **EQUAL**).

## 3. Verdict table

| row | verdict | RESIDUAL | proof lines |
|---|---|---|---|
| C1 focused window (B) gets the tab | **PASS** | – | L18345 scheduled / L18349 applied, `actionId 179151ae…` |
| C2a background, `main` focused last | **PASS** | – | L18363 / L18367, `actionId fa161257…` |
| C2b background, B focused last | **PASS** on the re-run (`C2b-mru-B2`). First attempt `C2b-mru-B`: **NOT EXERCISED (precondition: B never got focus; operator slip, §6 S1)** | – | re-run: L18399 / L18404, `actionId 60e2c82b…`. First attempt: L18380 / L18385 |
| C3 actionId join over the part | **PASS**: all 4 creates that returned 201 during C1–C2 (C1, C2a, C2b first attempt, C2b re-run), each exactly 1 scheduled + 1 applied (`activated:true`), no orphan applied line, no `no window label` line | – | L18345–L18404 (table in §4 C3) |
| C4 no window → 503 `NO_WINDOW` | **PASS** | – | **L18440** `mcp.create` `warn` `fail` `stage:"scheduled"` `reason:"no window"`; HTTP `503` `{"code":"NO_WINDOW"}` |
| C4 control (step 6) | **PASS**: `201`, one joined pair, tab in `main` | – | L18463 / L18468 |
| C4 step 5 (observation) | **NOTE: `201`**. The window is registered again as soon as you click Keep editing. | – | L18444 `window.close_cancelled` `notified:true`; L18445 / L18450 |

## 4. Per row

The brief says each window should show one Untitled tab at C0. **On this build, cold launch and ⌘⇧N both open a window with no tab** (`c0-w15646`, `c0-w15648`: empty sidebar, no tab bar), and `/api/documents` returned `[]` before C1. So the control "`main`'s tab count is unchanged" is checked from a start of 0 tabs (§6 D1).

### C1 (window B focused)
- Clicked B's title bar. `lastfocus` = `{"event":"window.focus","w":"mdpro-c104116d-58b3-44fc-ac26-98183491ee4a"}`. `/api/status` = `{"version":"0.3.2","window_focused":true}`.
- mark **18344**. `create C1-focused-B` → `{"id":"03f4f964-1a99-42a0-94e6-8c1830eba573"} 201`. `ndoc` = **1**.
- `joins`:
  ```
  18345: {"ts":"2026-10-14T16:19:34.201+08:00","level":"info","event":"mcp.create","status":"success","actionId":"179151ae-82cd-491f-ab23-fad90f725853","context":{"contentLength":15,"documentId":"03f4f964-1a99-42a0-94e6-8c1830eba573","stage":"scheduled"},"durationMs":null,"error":null}
  18349: {"ts":"2026-10-14T16:19:34.208+08:00","level":"info","event":"mcp.create","status":"success","actionId":"179151ae-82cd-491f-ab23-fad90f725853","context":{"activated":true,"documentId":"03f4f964-1a99-42a0-94e6-8c1830eba573","stage":"applied"},"durationMs":null,"error":null}
  ```
  The lines between them are one window's frontend work: L18346 `ui.toc.coordination.reset`, L18347 `tab.open` `tabIndex:0`, L18348 `tab.switch` `fromDocumentId:null` → `toDocumentId` = that id. There is no second `tab.open` from another window.
- Shots `c1-w15648` (B: tab `C1-focused-B`) and `c1-w15646` (`main`: still no tab = **control holds**).

### C2a (`main` focused last, mdpro in the background)
- Clicked `main`'s title bar: `lastfocus` = `window.focus` `main`. Ran Finder activate and waited 2 s: `lastfocus` = `{"event":"window.blur","w":"main"}`, `/api/status` = `{"version":"0.3.2","window_focused":false}` → **precondition met**.
- mark **18362**. `create C2a-mru-main` → `{"id":"2f10981c-1d33-448c-b938-b140eb831f7c"} 201`. `ndoc` = **1**.
- `joins`:
  ```
  18363: {"ts":"2026-10-14T16:19:59.372+08:00","level":"info","event":"mcp.create","status":"success","actionId":"fa161257-3e52-4042-beb0-c1d4eb23f4fe","context":{"contentLength":15,"documentId":"2f10981c-1d33-448c-b938-b140eb831f7c","stage":"scheduled"},"durationMs":null,"error":null}
  18367: {"ts":"2026-10-14T16:19:59.379+08:00","level":"info","event":"mcp.create","status":"success","actionId":"fa161257-3e52-4042-beb0-c1d4eb23f4fe","context":{"activated":true,"documentId":"2f10981c-1d33-448c-b938-b140eb831f7c","stage":"applied"},"durationMs":null,"error":null}
  ```
- Shots `c2a-w15646` (`main`: tab `C2a-mru-main`, 1 tab) and `c2a-w15648` (B: unchanged, still 1 tab `C1-focused-B`).

### C2b, first attempt (`C2b-mru-B`): NOT EXERCISED
- Finder was still frontmost after C2a, so the computer-use click on B's title bar was refused ("The desktop shell is frontmost"). I did not see the refusal and ran the step anyway. `lastfocus` before Finder activate = `{"event":"window.blur","w":"main"}`, **not** `window.focus $WB` → precondition failed.
- mark 18379. `create C2b-mru-B` → `{"id":"9a575cdd-38e1-45f7-80d6-8f58664020f8"} 201`. `ndoc` = 1. L18380 scheduled / L18385 applied, `actionId 36c00c3a-2d57-4fb0-b172-7281833c14bd`.
- The tab opened in **`main`** (`c2b-w15646`; `c2b-w15648` shows B unchanged). This is correct, because `main` was still the window focused last. It is a repeat of C2a's outcome, not a C2b result.

### C2b re-run (`C2b-mru-B2`): PASS
- `open_application("mdpro")`, clicked B's title bar: `lastfocus` = `{"event":"window.focus","w":"mdpro-c104116d-58b3-44fc-ac26-98183491ee4a"}`. Ran Finder activate and waited 2 s: `lastfocus` = `{"event":"window.blur","w":"mdpro-c104116d-58b3-44fc-ac26-98183491ee4a"}`, `/api/status` `"window_focused":false` → **precondition met**.
- mark **18398**. `create C2b-mru-B2` → `{"id":"b52ee93e-5130-4c65-952e-e22b9da44631"} 201`. `ndoc` = **1**.
- `joins`:
  ```
  18399: {"ts":"2026-10-14T16:20:32.937+08:00","level":"info","event":"mcp.create","status":"success","actionId":"60e2c82b-7a9c-41fc-83cb-5266e32f52f0","context":{"contentLength":13,"documentId":"b52ee93e-5130-4c65-952e-e22b9da44631","stage":"scheduled"},"durationMs":null,"error":null}
  18404: {"ts":"2026-10-14T16:20:32.943+08:00","level":"info","event":"mcp.create","status":"success","actionId":"60e2c82b-7a9c-41fc-83cb-5266e32f52f0","context":{"activated":true,"documentId":"b52ee93e-5130-4c65-952e-e22b9da44631","stage":"applied"},"durationMs":null,"error":null}
  ```
- Shots `c2b2-w15648` (B: now 2 tabs, active `C2b-mru-B2`) and `c2b2-w15646` (`main`: unchanged, 2 tabs, active `C2b-mru-B`).
- **Control (C2a ↔ C2b):** with the same windows and the same background state, the tab went to `main` when `main` was focused last and to B when B was focused last. The failed first attempt is a third data point that agrees: when `main` was last, the tab went to `main`.

### C3: actionId join (from mark 18272, the C0 launch)
```
L18345 {"actionId":"179151ae-82cd-491f-ab23-fad90f725853","status":"success","stage":"scheduled","doc":"03f4f964-…","act":null,"reason":null}
L18349 {"actionId":"179151ae-82cd-491f-ab23-fad90f725853","status":"success","stage":"applied","doc":"03f4f964-…","act":true,"reason":null}
L18363 {"actionId":"fa161257-3e52-4042-beb0-c1d4eb23f4fe","status":"success","stage":"scheduled","doc":"2f10981c-…","act":null,"reason":null}
L18367 {"actionId":"fa161257-3e52-4042-beb0-c1d4eb23f4fe","status":"success","stage":"applied","doc":"2f10981c-…","act":true,"reason":null}
L18380 {"actionId":"36c00c3a-2d57-4fb0-b172-7281833c14bd","status":"success","stage":"scheduled","doc":"9a575cdd-…","act":null,"reason":null}
L18385 {"actionId":"36c00c3a-2d57-4fb0-b172-7281833c14bd","status":"success","stage":"applied","doc":"9a575cdd-…","act":true,"reason":null}
L18399 {"actionId":"60e2c82b-7a9c-41fc-83cb-5266e32f52f0","status":"success","stage":"scheduled","doc":"b52ee93e-…","act":null,"reason":null}
L18404 {"actionId":"60e2c82b-7a9c-41fc-83cb-5266e32f52f0","status":"success","stage":"applied","doc":"b52ee93e-…","act":true,"reason":null}
```
(The `doc` ids are shortened here; the full ids are in the per-row blocks above.) There are 4 `actionId`s, and each has exactly one `scheduled` line and one `applied` line with `activated:true` and the same `documentId`. No applied line lacks a scheduled twin. Count of `"reason":"no window label"` since 18272: **0**. The later C4 lines (L18440, L18445/L18450, L18463/L18468) follow the same rule: one fail line and no applied line for the 503, and one joined pair for each 201.

### C4: no window registered → 503
1. **Close B.** mark 18420; clicked B's red button. **Unsaved changes** appeared (`c4-b-dlg-w15648`). L18421 `window.close` `$WB`; L18423 `window.close_requested` `start` `decision:"prompt"`; L18424 `cancel` `action:"prevented_showing_dialog"`.
   *Observation while B's dialog was up (read-only, no create):* `/api/documents` listed only `main`'s two ids `["2f10981c","9a575cdd"]`. B's two documents were already gone from the shadow store, which confirms the `CloseRequested` → `remove_window` mechanism this probe relies on.
   Clicked **Discard changes**: L18427 `ui.dialog.confirm`, L18429 `window.close` `$WB`, L18432 `allowed_close`, L18433 `window.focus` `main`. Afterwards `winid.js` lists only one window (15646). B is gone.
2. **Close `main`.** mark 18433; clicked `main`'s red button. `c4-dlg` (body "You have unsaved changes. Close without saving?"). **L18434** `window.close` `main`; L18436 `close_requested` `start` `decision:"prompt"`; **L18437** `window.close_requested` `status:"cancel"` `action:"prevented_showing_dialog"`. Dialog left up. No key press went to mdpro.
3. **Precondition:** `mcurl "$API/api/documents"` → **`[]`** ✓.
4. mark **18439**. `create C4-no-window` →
   `{"error":"No mdpro window is open to create the document in","code":"NO_WINDOW"} 503`
   ```
   18440: {"ts":"2026-10-14T16:21:09.997+08:00","level":"warn","event":"mcp.create","status":"fail","actionId":"f0095a5b-5b26-4b79-b32c-3d14c6a62fb9","context":{"documentId":"c563757d-8054-4281-8e99-aa14dcb7707b","reason":"no window","stage":"scheduled"},"durationMs":null,"error":null}
   ```
   `since '.'` after 18439 holds only L18440 (2 s later): **no `applied` line, no `tab.open`**. `c4-after`: the dialog is still up over `main`'s 2 tabs. No new tab. → **PASS**.
5. Clicked **Keep editing**:
   ```
   18443: {"ts":"2026-10-14T16:21:16.765+08:00","level":"info","event":"ui.dialog.cancel",…,"context":{"controlId":"dialog.confirm.cancel","title":"Unsaved changes"},…}
   18444: {"ts":"2026-10-14T16:21:16.765+08:00","level":"info","event":"window.close_cancelled",…,"context":{"notified":true},…}
   ```
   (L18441/18442 just before: `draft.write` for `9a575cdd` `C2b-mru-B`, 12 bytes, written while the dialog was up.)
   Right after, with no key press: mark **18444** (`NC`). `create C4-after-keep` → `{"id":"c4bf3ca7-c981-4284-aae5-7e329b0f6d0c"} 201`. L18445 scheduled / L18450 applied `activated:true`, `actionId 14eee2b6-3a33-4feb-b363-179ee15e348b`. `/api/documents` then listed `["2f10981c","9a575cdd","c4bf3ca7"]`. Shot `c4-keep` (tab `C4-after-keep` in `main`).
   **NOTE:** the result is **`201`, not `503`**. The window does *not* stay unregistered after a vetoed close until its next sync. `window.close_cancelled` `notified:true` re-registers it immediately, 1.2 s before the create. So the brief's guess about step 5 does not hold on this build, and that is the better behaviour.
6. **Control.** Clicked at the end of `C4-after-keep`, gate `main` (`lastfocus` = `window.focus` `main`), `key.sh X`, waited 2 s. L18460 `editor.milkdown.mount` `contentLength:17` (was 16) shows the X landed. `/api/documents` listed documents. mark **18462** (`ND`). `create C4-control` → `{"id":"9ca3f032-0356-47be-9f0b-332fe6e4bd24"} 201`.
   ```
   18463: {"ts":"2026-10-14T16:21:33.714+08:00","level":"info","event":"mcp.create","status":"success","actionId":"2529927a-fae8-4682-b421-96f64d0503d2","context":{"contentLength":13,"documentId":"9ca3f032-0356-47be-9f0b-332fe6e4bd24","stage":"scheduled"},"durationMs":null,"error":null}
   18468: {"ts":"2026-10-14T16:21:33.718+08:00","level":"info","event":"mcp.create","status":"success","actionId":"2529927a-fae8-4682-b421-96f64d0503d2","context":{"activated":true,"documentId":"9ca3f032-0356-47be-9f0b-332fe6e4bd24","stage":"applied"},"durationMs":null,"error":null}
   ```
   `c4-control`: the tab `C4-control` is in `main` (4 tabs). **Control PASS**, so step 4 counts.
   The step 6 control repeats what step 5 had already shown (the window was registered before the X). It still meets the brief's "control gives 201" condition.

### C5: restore and close
`unset TOKEN`. Restored `W0` → `100, 100, 1200, 800`. Ran mdpro › Quit mdpro, and **Unsaved changes** "Quit without saving?" appeared. Clicked **Discard changes**: L18478 `app.quit.check` `dirtyCount:4`; L18487 `dialog.quit.confirm` `documentIdCount:4`; L18488 `answer:"discard"` `idCount:4`; L18497 `app.quit.commit` (`deleted:1`: the C2b-mru-B draft from L18442); L18498 `app.quit`; L18499 `mcp.http_server.stop` `outcome:"stopped"`. **Discarded: 4 scratch MCP documents.** `pgrep -fl tauri-app` returns nothing (exit 1). Settings re-read EQUAL (§2).

Shots (in `reports/shots/`): `c0-about`, `c0-w15646`, `c0-w15648`, `c1-w15646`, `c1-w15648`, `c2a-w15646`, `c2a-w15648`, `c2b-w15646`, `c2b-w15648`, `c2b2-w15646`, `c2b2-w15648`, `c4-b-dlg-w15646`, `c4-b-dlg-w15648`, `c4-dlg`, `c4-after`, `c4-keep`, `c4-control`. Window 15646 = `main`, 15648 = B.

## 5. Notes

- **N1. No `document.activate` line for an MCP create.** The brief expects one, with `toDocumentId` = the new id. On this build, `handleCreateDocument` (`src/hooks/useMcpEvents.ts:158-215`) calls `upsertDocument`, which opens the tab and logs **`tab.switch`** `toDocumentId` = the new id (L18348, L18449, …). After that, `setActiveDocumentId` finds the document already active, so `document.activate` (`src/stores/documentStore.ts:188-195`, logged only when `id !== activeDocumentId`) never fires. Activation is still proven: `activated:true` on the applied line, the `tab.switch` line, and the shots. Not a FAIL. The brief's join should use `tab.switch` instead.
- **N2. The frontend `mcp.create` lines carry no `windowLabel`.** The applied lines show which window applied the create only through the shots. The scheduled line's chosen owner label is not in the log either. This is fine for the verdicts here, because each pair has one applied line and the shots show one tab. A `windowLabel` in the context would make the owner provable from the log alone.
- **N3. C4 step 5** (see §4 C4 step 5): `201`, because `window.close_cancelled` `notified:true` re-registers the window at once.
- **N4. B's shadow entry is dropped while its own close dialog is up** (§4 C4 step 1 observation). This matches the brief's model of `CloseRequested`.

## 6. Operator slips and deviations

- **S1. C2b first attempt.** I clicked B while Finder was frontmost. computer-use refused the click and I missed the refusal message, so I ran Finder activate and the create without checking `lastfocus` = `window.focus $WB` first. Result: NOT EXERCISED (`C2b-mru-B` landed in `main`, which was correct for that state). I re-ran the step correctly as `C2b-mru-B2`. Because of this, `main` holds one extra MCP tab, and C4 to C5 discarded 4 documents instead of the planned 3.
- **S2. Shot name `c0-about.png`** was written into the shared `reports/shots/` folder. An earlier run (the 2026-10-12 canary) also used `c0-*`, `c1*` … `c7*` names there. If an older `c0-about.png` existed, this run overwrote it. The other names in this run (`c0-w*`, `c1-w*`, `c2a/c2b/c2b2-w*`, `c4-b-dlg-w*`, `c4-dlg`, `c4-after`, `c4-keep`, `c4-control`) do not match any older file in the listing.
- **D1. C0:** neither window showed an Untitled tab. Cold launch and ⌘⇧N open empty windows on this build. The brief's "each window shows one Untitled tab" did not hold. The controls use the real starting count of 0.
- **D2. Tiling:** the window y position was clamped from 25 to 30 under the menu bar. The first `set {position, size}` in a single AppleScript statement failed with `-10003`, and setting position and size as two separate statements worked.
- Never pressed Esc, Return or ⌘Z, and never pressed a key while a dialog was open. The only key pressed into mdpro was `X` in C4 step 6, after the gate.
