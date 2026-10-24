# Device check B5c: M3a, D261 steps 1/2/4, M3b full matrix, Mac mini, 2026-10-24

Committed by herdr-delegator from the tester's report (mac-test, Claude Computer Use). Build: the B5 verify build of
master `557fec68`, launched by exact path, `releaseId:"unknown"`. It finishes the three items B5 and B5b left NOT
EXERCISED. The user's words: 「这三项交给 mac-test，gpt-imple-3 接着跑 B6 (Recommended)」.

## Delegator's check against the cards

| Item | Verdict | Note |
|---|---|---|
| M3a on the M4 tree | **PASS** | both modes, focused and no-focus states; `ui.menu.build` disabledCount 4 → 6 with no focused window |
| D261 step 1 | **PASS** | one target per click, both directions |
| D261 step 2 (focus race) | **FAIL**, new finding **D319** | Highlight clicked in A, then ⌘\` at once: the action ran in B, 2 of 2 (`window.focus` B ~29 ms before `menu.action.dispatch` `target:B`). With a 300 ms gap it ran in A. The card's failure condition is "runs … in the wrong window" |
| D261 step 4 | **PASS** for Table stale and close-confirm stale; Save As + switch **not reachable** (the modal Save panel blocks every switch, which is itself the safe outcome) | |
| M3b full matrix | **PASS**, Source link-stale sub-step **NOT EXERCISED** | every command one dispatch, one select and its document change, both modes; stale callbacks, modal refusal and Source table cases pass. The one sub-step stopped when a picsee GUI took the front during mdpro's GUI lock (09:24:29) |

Not a verdict: a picsee GUI run started during the held desktop lock. Reported to the user.

---

## Tester's report (verbatim)

# B5c device report: M3a, D261 steps 1/2/4, M3b full matrix (Mac mini)

Tester: mac-test (dtrack Claude session, Computer Use)
Run: 2026-10-24 08:13–09:26 +0800 (a paused gap 08:38–09:11; no app input during it, checked in the log)
Evidence: `~/.mdpro-redesign/device/B5c-evidence/` (26 screenshots, `mdpro-run.log` = every log line of this run, `m3b-dispatch.tsv`, `marks.txt` = log line marks per step)

## Build and identity

- Bundle `/Users/jack/Documents/mac-app/mdpro-wt/verify-557fec6/src-tauri/target/release/bundle/macos/mdpro.app`, worktree HEAD `557fec68cfacb509552f13eda1b401db19bdc5e2`. No rebuild.
- No mdpro running before. `open -n <bundle>` → one process, PID 66369, `…/verify-557fec6/…/mdpro.app/Contents/MacOS/tauri-app`.
- `{"ts":"2026-10-24T08:21:32.708+08:00","event":"app.ready","status":"success","context":{"appVersion":"0.3.5","buildId":"unknown","pid":66369,"platform":"macos","releaseId":"unknown","startupTimeMs":249}}`
- Fixtures: copies of `tests/manual-fixtures/d37-small-doc.md` (plus d43/d87, not needed) and two purpose-written files `m3b-w.md` / `m3b-s.md` (one target line per command, pristine copies alongside). All in `B5c-evidence/fixtures/`.
- Input source was Doubao Pinyin, so no letters were typed; text (URLs, the window-A line) went in by clipboard paste.

## Counts

**PASS 2 · FAIL 1 · PARTIAL-NOT-EXERCISED sub-steps 2** (detailed below)

| Item | Verdict | Proof |
|---|---|---|
| 1. M3a on the M4 tree, both modes, per-focus and no-focus | **PASS** | 9 screenshots `m3a-1…9`; `ui.menu.build` disabledCount 4 → 6 when no window has focus; mode-switch dispatch/select/mode_report |
| 2. D261 steps 1, 2 and 4 | **FAIL** (step 2) | Step 1 PASS (one target per click, both directions). **Step 2 FAIL 2/2**: Highlight clicked in A, ⌘\` sent right after, and the action ran in **B** (`target` = B label). Step 4: Table stale PASS, close-confirm stale PASS, Save As + switch **not reachable** (the modal Save panel blocks every switch) |
| 3. M3b full matrix, WYSIWYG and Source | **PASS** (one sub-step NOT EXERCISED) | Every listed command: one `menu.action.dispatch` + one `ui.menu.select` per mode, with the document change visible (serialised Source view of W, screenshots). Link stale and Table stale callbacks, modal refusal in both modes, Source table cases all pass. **Source link-stale step NOT EXERCISED**: a Picsee GUI came to the front during the lock (see Surprises) |

## 1. M3a — PASS

Setup: window A = `main` (Untitled tab, pasted "alpha line in window A"), window B = `mdpro-218ab884-…` (d37 copy). B switched to Source via View › Source.

| State | View menu | Paragraph menu | Screenshot |
|---|---|---|---|
| Focus A (WYSIWYG) | ✓ WYSIWYG | Table… enabled, Math Block grey | `m3a-1-focusA-view`, `m3a-2-focusA-paragraph` |
| Focus B (Source) | ✓ Source | Table… grey, Math Block enabled | `m3a-3-focusB-view`, `m3a-4-focusB-paragraph` |
| No focused window (both windows minimised via AXMinimized, mdpro frontmost) | **no mode checked** | Table… grey **and** Math Block grey | `m3a-5-nofocus-view`, `m3a-6-nofocus-paragraph` |
| A switched to Source while focused | ✓ Source | Table… grey, Math Block enabled | `m3a-7-focusA-source-view`, `m3a-8-focusA-source-paragraph` |

Decisive logs:

```json
{"ts":"08:38:30.231","event":"window.blur","context":{"windowLabel":"main"}}
{"ts":"08:38:30.232","event":"ui.menu.build","status":"success","context":{"disabledCount":6,"droppedAccelerators":6,"itemCount":67,"version":2}}
{"ts":"09:11:52.613","event":"menu.action.dispatch","status":"success","context":{"action":"set-view-mode","target":"main","via":"focused"}}
{"ts":"09:11:52.615","event":"ui.menu.select","status":"success","context":{"controlId":"menu.view.set_mode","mode":"source","windowLabel":"main"}}
{"ts":"09:11:52.642","event":"ui.menu.mode_report","status":"start","context":{"mode":"source","source":"change"}}
```

Insert Table in a Source window: the menu item is greyed, so it can't be clicked, and the card's `ui.menu.availability cancel` line isn't reachable from the menu. The ⌘⇧T chord in A (Source) showed the toast "Insert Table is available in WYSIWYG mode" and inserted nothing (`ui.shortcut.trigger` `paragraph.table`). Screenshot `m3a-9-source-table-chord-refused`.

## 2. D261 steps 1, 2, 4 — FAIL

### Step 1 — PASS
- A focused, "alpha" selected, Format › Highlight Selection → A highlighted, B unchanged (`d261-1a-highlight-A-only`).
  `{"event":"menu.action.dispatch","context":{"action":"format.highlight","target":"main","via":"focused"}}` and one `ui.menu.select` with `windowLabel:"main"`.
- B focused (Source), "First" selected, same menu → B got `==First==`, A unchanged (`d261-1b-highlight-B-only`).
  `{"event":"menu.action.dispatch","context":{"action":"format.highlight","target":"mdpro-218ab884-4557-4d1b-b87c-ef336d4efa94","via":"focused"}}`.

### Step 2 (focus race) — FAIL, 2 of 2
Procedure: A focused with a word selected; Format › Highlight Selection clicked; ⌘\` (macOS next window) sent straight after the click in the same batch. (A first try with a mouse click on B didn't change focus. It was swallowed, A acted, and it doesn't count.)

| Run | Gap click→⌘\` | Who acted | Log order |
|---|---|---|---|
| race 1 | ~0 ms | **B** (`====First====`; A's "window" not highlighted) | `window.focus B` 09:13:10.208 → `menu.action.dispatch … target:B` 09:13:10.237 |
| race 2 | ~0 ms | **B** (`======First======`) | `window.focus B` 09:13:32.093 → `dispatch target:B` 09:13:32.117 |
| race 3 | 300 ms | A (correct) | `dispatch target:main` 09:13:47.337 → `window.focus B` 09:13:47.391 |

Screenshots: `d261-2-race1-B-acted-after`, `d261-2-race2-B-acted`, `d261-2-race3-gap300-A-acted`.

```json
{"ts":"09:13:32.093","event":"window.focus","context":{"windowLabel":"mdpro-218ab884-4557-4d1b-b87c-ef336d4efa94"}}
{"ts":"09:13:32.117","event":"menu.action.dispatch","status":"success","context":{"action":"format.highlight","target":"mdpro-218ab884-4557-4d1b-b87c-ef336d4efa94","via":"focused"}}
{"ts":"09:13:32.118","event":"ui.menu.select","status":"success","context":{"controlId":"menu.format.highlight","windowLabel":"mdpro-218ab884-4557-4d1b-b87c-ef336d4efa94"}}
```

Reading: macOS delivers the menu item's action only after the item's selection flash, about 250 ms after mouse-up (race 3: the event arrived about 250 ms after the click and 54 ms before the late focus). `resolve_target` reads the window that is focused when the event reaches Rust. A focus change inside that window therefore sends the action to the other window. That is the card's failure condition: "action runs … in the wrong window". The B5b run that "retained main" most likely had a larger gap.

### Step 4 — Table stale PASS, close-confirm stale PASS, Save As + switch not reachable
- **Insert Table**: A, tab 2 ("beta doc two") active, Paragraph › Table… → modal; View › Switch Documents (native menu still works under the in-app modal) → tab 1; Insert → toast "Document changed; table not inserted". Neither tab got a table (`d261-4a-table-stale-toast`).
  ```json
  {"ts":"09:14:21.512","event":"menu.action.dispatch","context":{"action":"paragraph.table","target":"main","via":"focused"}}
  {"ts":"09:14:28.765","event":"tab.switch","status":"success","context":{"fromDocumentId":"f0ebe38b-…","toDocumentId":"c842f903-…"}}
  {"ts":"09:14:36.173","event":"ui.menu.select","status":"cancel","context":{"reason":"stale","stage":"table_submit","windowLabel":"main"}}
  ```
- **Close-confirm**: tab 2 dirty, File › Close → "Unsaved changes" prompt; View › Switch Documents → tab 1; Discard changes → toast "Document changed; nothing closed", both tabs still open (`d261-4b-close-stale-toast`).
  `{"ts":"09:15:19.100","event":"ui.menu.select","status":"cancel","context":{"reason":"stale","stage":"close_confirm","windowLabel":"main"}}`
- **Save As + switch: NOT REACHABLE.** File › Save As opens the app-modal NSSavePanel. While it is up, View › Switch Documents is greyed (`d261-4c-saveas-switch-greyed`), and a click on tab 2 and ⌃Tab both do nothing. Panel cancelled, nothing written (`file.save_as` start → cancel). The `save_entry` stale guard can only be reached by a switch landing between the menu click and the panel opening, which wasn't exercised.

Extra line seen on every tab switch / mode change: `ui.menu.select cancel reason:"stale" stage:"highlight"`. The earlier highlight request is re-seen after the remount and correctly dropped, with no document change.

## 3. M3b full matrix — PASS (Source link-stale step NOT EXERCISED)

Windows: W = `mdpro-dd1789a6-…` (m3b-w.md, WYSIWYG), S = `mdpro-77b77d04-…` (m3b-s.md, switched to Source). Each command was clicked once through the native menu on its own target line. `m3b-dispatch.tsv` holds every row. Per mode, each command below has exactly **one** `menu.action.dispatch` (target = that window, `via:"focused"`) and **one** `ui.menu.select`:

| Command | WYSIWYG result | Source result |
|---|---|---|
| Bold / Italic / Underline / Code / Strikethrough | success; **bold**, *italic*, `<u>`, `code`, ~~strike~~ | success; `**…**`, `*…*`, `<u>…</u>`, `` `…` ``, `~~…~~` |
| Highlight Selection | success, `==highlight==` | success, `==highlight==` |
| Clear Format | success, "clear" lost bold | menu item grey (W-only), not dispatched |
| Link… (pasted URL, Insert) | opened → `ui.link-modal.submit`, `[link](https://example.com/w08)` | opened → submit, `[link](https://example.com/s08)` |
| Image… | `select start opened` → `image.pick cancel` → `select cancel reason:"picker_cancel"`, nothing inserted | same |
| Heading 1–6 | success, H1…H6 | success, `#`…`######` |
| Paragraph | success, `## w15` → paragraph | success, `## s15` → paragraph |
| Increase / Decrease Heading | success, H3→H2 / H3→H4 | success, H3→H2 / H3→H4 |
| Table… | modal → 3×3 table inserted after w24 | menu grey (W-only) |
| Code Fences / Quote / Ordered / Unordered List | success, fenced block, blockquote, `1.`, bullet | success, fences, `>`, `1.`, `-` |
| Math Block | menu grey (S-only) | success, empty `$$ $$` block inserted below s28 |
| Indent / Outdent | success, w23 nested then un-nested | success, s23 indented then outdented |
| Select Word / Select Line | success, "select" / whole line selected | success, same |
| Delete Word | menu grey (S-only) | success, "En" of "End" deleted (caret was mid-word) |
| Find… / Find Next / Find Previous / Replace… | bottom bar prefilled "find" 1 of 3 → 2 of 3 → 1 of 3 → Replace row opened | CodeMirror panel prefilled → next → previous → Replace field focused |

The serialised Markdown of the W document after the run is visible in Source (`m3b-w-3-…`, `m3b-w-4-serialized-top`), and the S results in `m3b-s-1-format-headings`, `m3b-s-2-blocks`. Fixture files on disk were never saved (`cmp` with the pristine copies passes).

**Modal refusal** (both modes): with Insert Link open, W Paragraph › Heading 1 → `{"event":"ui.menu.select","status":"cancel","context":{"controlId":"editor.paragraph.heading1","reason":"modal_open"}}`; S Format › Bold → `…"controlId":"editor.format.strong","reason":"modal_open"`. Document unchanged both times.

**Stale callbacks (W):**
- Link: Link modal open on "word", View › Source → modal closed, nothing applied: `{"event":"ui.link-insert.cancel","status":"cancel","context":{"reason":"view-mode-changed"}}` (09:20:06.813). By design (`useLinkInsertBinding`) the modal unmounts before any submit, so the `link_submit` stale line isn't reachable from the UI. B5b saw the same on a document switch.
- Table: Table… modal open, View › Source. The modal **hides** with no log line and its pending callback stays. View › WYSIWYG brings the same modal back (`m3b-w-5-table-modal-survives-mode-roundtrip`). Insert → toast "Document changed; table not inserted", nothing inserted (`m3b-w-6-…`):
  `{"ts":"09:20:49.407","event":"ui.menu.select","status":"cancel","context":{"reason":"stale","stage":"table_submit"}}`
- Source link stale: **NOT EXERCISED**. The Link click in S never dispatched, because Picsee took the front at that moment (below).

**Source table cases:**
- Table… is greyed in Source (M3a shots), and the ⌘⇧T chord gives the WYSIWYG-only toast.
- The table.* commands have no macOS menu item (menu path "none" in `menu_layout.json`). Their keys, run in S inside `| s1 | s2 |`: ⌥⌘↓ row below, ⌥⌘→ column right, ⌥⌘⇧⌫ delete column, ⌥⌘⌫ delete row. Each logged one `ui.shortcut.trigger` + one `editor.table.<op>` success and changed the table visibly (back to the original 2×2 at the end).
- ⌥⌘↓ on s29 outside the table: no table action logged, a second caret added on the line below (CodeMirror add-cursor), no text change (`m3b-s-3-table-keys-outside`).

## Cleanup proof

- mdpro could not be quit through its UI because Picsee held the front, so PID 66369 was ended with `kill` (SIGTERM). `pgrep -lf MacOS/tauri-app` → none.
- The four drafts this run created (`2c1629af1d9f4cd0`, `9fd421ab09aa94f8`, `c842f903-…`, `d6574e50ce6eac54`) moved to `B5c-evidence/run-drafts/`. The two pre-existing drafts were restored; `shasum -c` OK: `858322f7b0e05037` `0073be67…ddd0`, `cd0315a393fbe762` `528cf52c…53e7`.
- `~/.mdpro/config.json`: the app had migrated it to the v2 shortcut set at launch. It was restored from `B5c-evidence/config-backup/config.json`; `cmp` exit 0 (`config_cmp=PASS`).
- No repository files changed, no commit, no rebuild. Worktree untouched.
- `$HOME/.cache/desktop-gui.lock` (owner `project=mdpro`, `session=mac-test`, `batch=B5c`) released after all of the above.

## Surprises

1. **Picsee ran a GUI during the mdpro lock.** `Picsee.app` PID 91080 started **09:24:29** from `/Users/jack/Documents/mac-app/picsee/.build/device-20261024-092410-P2-02-FOLDER-01-VIEW-10/…`, and at 09:24:53 it took the front, stopping my batch. The lock directory was held by B5c the whole time (taken 08:13:53). The `picsee-dtrack` pane also shows an earlier `open -n …/dd-signed/…/Picsee.app` line, of unknown time. I never touched Picsee. Possible spill-over: the unexplained focus jump S → W at 09:23:58 and the S blur at 09:24:29. Neither changed a verdict: the affected outside-table press was redone in S.
2. D261 step 2 fails at a 0 ms gap but passes at 300 ms. The window is macOS's menu-flash delay before the action is delivered.
3. Insert Table modal on a mode change: it hides in Source without logging and comes back on return to WYSIWYG. The stale guard still blocks the insert. The Link modal instead closes and logs `ui.link-insert.cancel`. The two modals behave differently.
4. Repeated `ui.menu.select cancel stage:"highlight"` lines on tab switches and mode changes (harmless re-seen highlight requests).
5. Fast background clicks are swallowed once (window activation): the + tab button, Insert in modals, and a click on window B. Each was re-clicked, and only the visible result was counted.
