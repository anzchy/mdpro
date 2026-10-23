# Device check B4: windows and editor, Mac mini, 2026-10-23

Committed by herdr-delegator from the tester's report (gpt-imple-3, Codex Computer Use). Build: a new verify build of
master `4295e10c` (code equal to `7b801703`, with M1b and WI-3d), launched by exact path, `releaseId:"unknown"`. The four
physical Esc presses were made by the user on the mini's keyboard, one per dialog, each confirmed in chat
(「已按 Esc」).

## Delegator's check against the cards

| Item | Verdict | Note |
|---|---|---|
| D297 | **PASS** | a window with no tab accepts no typing; ⌘N restores editing |
| D253 re-smoke | **PASS** | |
| D158 re-smoke | **NOT EXERCISED** for the lint rows | M1b removed the Source lint panel's Cmd+Shift+M (now Highlight, D269), so the lint rows are not reachable by key; search panel and gutter covered in the report |
| D286 re-smoke | **PASS** | |
| D259 step 1 (Esc) | **PASS** | Insert Link and Insert Table: `focusReturned:true` after the user's physical Esc |
| D140 | **PASS** | encoding and reload dialogs close on the physical Esc (`ui.dialog.cancel`). New finding D317: after the encoding dialog's Esc, focus stays on the page root and a typed key edits nothing |

---

## Tester's report (verbatim)

# Device report B4 — windows and editor

Date: 2026-10-23 (Asia/Shanghai)  
Run window: 16:32–17:13  
Tester: `gpt-imple-3`  
Counts: **PASS 5 / FAIL 0 / NOT EXERCISED 1**

## Build and identity

- SHA: `4295e10cfb4a3c67853293441c618927d3ef6699`
- App: `/Users/jack/Documents/mac-app/mdpro-wt/verify-4295e10/src-tauri/target/release/bundle/macos/mdpro.app`
- Binary: `Contents/MacOS/tauri-app`
- This run built the verify worktree. The `.app`, DMG and updater archive were produced; the final updater-signing-key error was the expected harmless post-bundle failure.
- Launch used only the exact app path. The identity check found exactly one verify process: pid `52562`, `/Users/jack/Documents/mac-app/mdpro-wt/verify-4295e10/src-tauri/target/release/bundle/macos/mdpro.app/Contents/MacOS/tauri-app`; no other mdpro process was running.
- Matching launch log:

```json
{"ts":"2026-10-23T16:32:54.796+08:00","event":"app.ready","status":"success","context":{"appVersion":"0.3.5","buildId":"unknown","pid":52562,"platform":"macos","releaseId":"unknown","startupTimeMs":269}}
```

## 1. D297 — PASS

I closed the main window's last tab, clicked the blank canvas and typed `D297-SHOULD-NOT-APPEAR`. No editable surface appeared and the text went nowhere. Cmd+N restored an editor.

```json
{"ts":"2026-10-23T16:33:34.916+08:00","event":"ui.editor.no_document","status":"success","context":{"state":"no_document"}}
```

Screenshot: `B4-evidence/screenshots/D297-tabless.png`.

## 2. D253 re-smoke — PASS

I kept the main fixture open, created a secondary window with a dirty untitled last tab, and pressed Cmd+W. The dirty tab prompted. Keep editing cancelled the first close; a second Cmd+W followed by Discard changes closed the secondary window while the main window remained open.

```json
{"ts":"2026-10-23T16:34:29.806+08:00","event":"ui.dialog.cancel","status":"success","context":{"controlId":"dialog.confirm.cancel","title":"Unsaved changes"}}
{"ts":"2026-10-23T16:34:35.442+08:00","event":"window.close_requested","status":"start","context":{"action":"last_tab_closed","windowLabel":"mdpro-72a4ffc8-f392-4194-83b5-8a05542966ec"}}
{"ts":"2026-10-23T16:34:35.509+08:00","event":"window.close_requested","status":"success","context":{"action":"allowed_close","windowLabel":"mdpro-72a4ffc8-f392-4194-83b5-8a05542966ec"}}
```

Screenshot: `B4-evidence/screenshots/D253-main-remains.png`.

## 3. D158 re-smoke — NOT EXERCISED

In Source mode with the dark theme, I inspected the search panel and gutter. Neither showed a light band. A search-input pixel sample measured foreground `rgb(234,236,239)` over background `rgb(18,21,27)`, contrast **15.44:1**.

I also opened a lint diagnostic tooltip from the gutter. It showed no light band; primary text `rgb(234,236,239)` over `rgb(26,32,44)` measured **13.79:1**, and secondary text `rgb(189,191,196)` measured **8.87:1**.

The required lint **rows** were not reached. The old Cmd+Shift+M route now invokes M1b's Highlight Selection command (as documented); I immediately undid that action. Because the brief requires the lint rows themselves, the item is NOT EXERCISED despite the passing search, gutter and tooltip observations.

Screenshots: `B4-evidence/screenshots/D158-dark-search-gutter.png`, `B4-evidence/screenshots/D158-dark-lint-tooltip.png`.

## 4. D286 re-smoke — PASS

I enabled Auto-Reformat Tables on Save, opened `B4-evidence/fixtures/d286-backtick-info.md`, and saved. The table after the invalid backtick info string `` ```la`ng `` was reformatted on disk.

```json
{"ts":"2026-10-23T16:42:39.824+08:00","event":"editor.table.auto-reformat-on-save","status":"success","context":{"documentId":"778288a232a7bac2"}}
```

The saved fixture contains:

````text
# D286 invalid backtick info string

```la`ng

| a   | longer |
| --- | ------ |
| x   | yy     |
````

## 5. D259 physical-Esc focus return — PASS

With `these words` selected in `d259-link-focus.md`, I opened Insert Link with Cmd+K. After the user's physical Esc, the dialog closed and its log recorded `focusReturned:true`; typing `x` replaced the original selection, proving focus and selection return. I undid the probe.

I repeated the physical-Esc path for Insert Table using M1b's Shift+Cmd+T shortcut. The dialog closed, the log again recorded `focusReturned:true`, and typing `x` replaced the preserved selection. I undid the probe.

```json
{"ts":"2026-10-23T17:05:56.197+08:00","event":"ui.link-modal.cancel","status":"cancel","context":{"focusReturned":true,"screen":"wysiwyg"}}
{"ts":"2026-10-23T17:08:41.122+08:00","event":"ui.table-modal.cancel","status":"cancel","context":{"focusReturned":true,"screen":"wysiwyg"}}
```

## 6. D140 physical Esc — PASS

I copied a seven-byte ISO-8859 fixture to `B4-evidence/fixtures/d140-latin1.md`, opened it, and clicked the encoding dialog's explanatory text so focus was not on a button. The user's physical Esc closed the dialog through its Cancel path.

I then changed the open `d259-link-focus.md` fixture externally and clicked the reload dialog's explanatory text. The user's physical Esc closed it through Ignore. The editor continued showing the pre-change text, proving the external change was not reloaded.

```json
{"ts":"2026-10-23T17:11:01.502+08:00","event":"ui.dialog.cancel","status":"success","context":{"controlId":"dialog.encoding.cancel"}}
{"ts":"2026-10-23T17:13:15.432+08:00","event":"ui.dialog.cancel","status":"success","context":{"controlId":"dialog.reload.ignore"}}
```

## Cleanup

- mdpro pid `52562` was terminated after Cmd+Q surfaced the expected unsaved-changes prompt for the externally changed/ignored evidence fixture. A final process check found no running `mdpro.app/Contents/MacOS` process (`mdpro_absent_exit=0`).
- `/Users/jack/.mdpro/config.json` was restored from `B4-evidence/config-backup/config.json`. `cmp` succeeded (`config_cmp_exit=0`); both files have SHA-256 `503c76eddd87a6eefd92700c7bb50df3beebae65cf40ad7f153dab6f460183b4`.
- The owned GUI lock (`session=gpt-imple-3`, pid `77924`) was released. `/Users/jack/.cache/desktop-gui.lock` is absent (`lock_absent_exit=0`).
- The verify worktree and app bundle remain in place. No repository files were edited, no fix was made, and no commit was created.

## Surprises

- After the encoding dialog's Esc cancellation, accessibility focus remained on mdpro's HTML root. A one-character probe did not edit the document. This does not change the assigned D140 Esc verdict—the dialog closed once through the logged encoding-cancel path—but it did not provide an additional editor-focus-return proof.
- M1b maps Cmd+Shift+M to Highlight Selection, so the former lint-panel shortcut could not be used to reach D158's lint-row surface.
