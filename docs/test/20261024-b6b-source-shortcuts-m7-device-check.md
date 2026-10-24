# Device check B6b: Source shortcuts and the M7 list, Mac mini, 2026-10-24

Committed by herdr-delegator from the tester's report (mac-test, Claude Computer Use). Build: the B5 verify build of
master `557fec68`, launched by exact path, `releaseId:"unknown"`. It finishes what B6 left NOT EXERCISED. The user's
words: 「补测交给 mac-test，D155 按 D292 记不挡锁定 (Recommended)」. picsee drove the GUI about 10:54–11:05 during the
lock (picsee-delegator's own disclosure); mac-test re-ran every step in that window and lists them.

## Delegator's check against the cards

| Item | Verdict | Note |
|---|---|---|
| v2 per-chord table, Source and the WYSIWYG chords B6 left | **PASS** | every chord once, one log line each (Source ⌘D and WYSIWYG ⇧⌘\` prove by effect only: their CodeMirror / Milkdown owners log nothing by design), the change on screen and in saved bytes |
| M7 Keyboard Shortcuts list | **PASS** | every group and row state; F6 refused by the Cycle View conflict; F7 saved and shown as pending after a reopen and in a new window. Minimize is the known D296 gap |

Observations, not fail conditions:
- **D320 (new):** in WYSIWYG, ⌥⇧⌘M (Math Block, Source-only) is refused silently, with no toast and no log line. The
  menu plan's D255-WI-3a…d acceptance says a disabled mode is refused with a toast.
- Source Math Block with the caret mid-line splits the line around the inserted block. At the line end it inserts a
  clean block below. Kept with D320 for the owner to compare against the menu path.

With B5, B5b, B5c, B6 and B6b, the macOS menu-bar and shortcut batch is complete on `557fec68` except D261 step 2
(D319, in progress).

---

## Tester's report (verbatim)

# B6b device report: Source shortcuts and the M7 list (Mac mini)

Tester: mac-test (dtrack Claude session, Computer Use)
Run: 2026-10-24 09:50–11:26 +0800 (lock held the whole time; app input paused 10:08–10:49 and 10:57–11:06, see Surprises)
Evidence: `~/.mdpro-redesign/device/B6b-evidence/` (42 screenshots, `mdpro-run.log` = every log line since launch, `marks.txt` = log-line marks per step, fixtures + pristine copies, `b6b-*-after.md` = saved results, `config-after-run.json`)

## Build and identity

- Bundle `/Users/jack/Documents/mac-app/mdpro-wt/verify-557fec6/src-tauri/target/release/bundle/macos/mdpro.app`, worktree HEAD `557fec68cfacb509552f13eda1b401db19bdc5e2`. No rebuild.
- No mdpro running before; `open -n <bundle>` → one process, PID 11389, `…/verify-557fec6/…/MacOS/tauri-app` (stayed the only one all run).
- `{"ts":"2026-10-24T09:52:12.135+08:00","event":"app.ready","status":"success","context":{"appVersion":"0.3.5","buildId":"unknown","pid":11389,"platform":"macos","releaseId":"unknown","startupTimeMs":436}}`
- Fixtures in `B6b-evidence/fixtures/`: `b6b-source.md` (one target line per Source chord), `b6b-wysiwyg.md` (one target paragraph per WYSIWYG chord), plus a copy of `tests/manual-fixtures/d37-small-doc.md` (unused). Opened with `open -a <bundle> <copy>` (each opened a new window in the same process).
- **Input source** was Doubao Pinyin; switched to ABC (`com.apple.keylayout.ABC`, TIS API) before the key sweep and restored to Doubao at the end.
- Two pre-existing drafts were moved aside before launch (no Recovery dialog) and restored byte-identical (`shasum -c` OK).

## Counts

**PASS 2 · FAIL 0** (findings and caveats below)

| Item | Verdict | Proof |
|---|---|---|
| 1. v2 per-chord table: Source (D255-WI-3a, 3b in S, D268, D270) + the WYSIWYG chords B6 left unproved | **PASS** (with 3 findings, none a fail condition) | Every chord ran once: a `ui.editor.command` `via:"key"` line per chord (except two owners that log nothing by design, below), the change per screenshot `s01…s16` / `w01…w07`, and the saved bytes `b6b-source-after.md`, `b6b-wysiwyg-after.md`. No chord did nothing, acted twice, or ran another command |
| 2. M7 Keyboard Shortcuts list, complete card | **PASS** (Minimize = known D296 gap, recorded) | Screenshots `m7-01…m7-19` per group and row state; F6 recorded (accepted, Save blocked by the conflict with Cycle View Mode's fixed F6); F7 recorded and saved (`settings.shortcuts.save`, config `fileExportHtml:"F7"`); pending row "Active: Cmd+Shift+E · after restart: F7" after reopening Settings **and** in a new window's Settings |

## 1. Per-chord table

### Source (window `mdpro-5b0f9f72…`, `b6b-source.md`, view switched with ⌃2)

Marks/selection: a double-click on the target word for marks, a caret click on the line for block commands.

| Chord | Command | Log line (`ui.editor.command`, `mode:"source"`, `via:"key"`) | Document effect | Shot |
|---|---|---|---|---|
| ⌘B | format.strong | 10:01:24.444 success | `**bold** target line` | s01 |
| ⌘I (D268) | format.emphasis | 10:04:04.131 success | `*italic* target line`; selection stayed on the word (CodeMirror `selectParentSyntax` did not run) | s02 |
| ⇧⌘\` | format.code | 10:04:22.598 success | `` `code` target line `` | s03 |
| ⇧⌘X | format.strike | 10:04:28.566 success | `~~strike~~ target line` | s04 |
| ⌘U (D270) | format.underline | 10:04:34.016 success | `<u>underline</u> target line`; no undoSelection | s05 |
| ⌥⌘C | paragraph.codeFences | 10:05:08.694 success | line wrapped in a ```` ``` ```` fence | s06 |
| ⌥⌘O | paragraph.orderedList | 10:05:22.815 success | `1. ordered target line` | s07 |
| ⌥⌘U | paragraph.unorderedList | 10:05:29.055 success | `- unordered target line` | s08 |
| ⇧⌘B | paragraph.quote | 10:05:42.070 success | `> quote target line` | s09 |
| ⌥⇧⌘M | paragraph.mathBlock | 10:05:47.337 success (mid-line); 10:06:09.819 success (line end) | `$$` / blank / `$$` block. **Finding A** below | s10, s11 |
| ⌘L | edit.selectLine | 10:06:38.976 success | whole `selectline target line` line selected | s12 |
| ⌘D | edit.selectWord | **none, by design**: in Source ⌘D is CodeMirror `searchKeymap` `Mod-d` (`commands/inventory/codemirrorRows.ts:75`), which logs nothing | word `selectword` selected | s13 |
| ⇧⌘I | format.image | `ui.menu.select` start 10:07:55.226, `image.pick` start, `ui.editor.command` start `via:"key"`; Cancel → `image.pick` cancel + `ui.menu.select` cancel `reason:"picker_cancel"` 10:08:01.64 | native picker opened once; cancel inserted nothing | s14 |
| (menu-only) Edit › Selection › Delete Word | edit.deleteWord | `menu.action.dispatch` `editor.edit.deleteWord` `via:"focused"` + `ui.menu.select` success 10:50:17 | `deleteword` removed, `target line` left | s15, s16 |

One ⌘Z after the mid-line Math Block removed exactly that insert (one undo step). Saved with ⌘S (`file.save` success 10:50:23, 341 bytes); `diff` against the pristine copy shows exactly the changes above and nothing else.

### WYSIWYG (window `mdpro-a1fef441…`, `b6b-wysiwyg.md`)

| Chord | Log line | Document effect | Shot |
|---|---|---|---|
| ⇧⌘\` Code | **none, by design**: the Milkdown inline-code key is not one of the logged `wysiwygKeymapEntries` (only D255-built commands log) | `code` became inline code | w01 |
| ⌥⌘C Code Fences | `ui.editor.command` start+success 10:51:54.198/.205 `paragraph.codeFences` `mode:"wysiwyg"` `via:"key"` (one actionId) | fenced block | w02 |
| ⌥⌘O Ordered List | 10:52:00.111/.119 `paragraph.orderedList` | `1. ordered target line` | w03 |
| ⌥⌘U Unordered List | 10:52:06.140/.144 `paragraph.unorderedList` | `- unordered target line` | w04 |
| ⇧⌘B Quote | 10:52:25.537/.539 `paragraph.quote` | blockquote | w05 |
| ⌥⇧⌘M Math Block (Source only) | **none** | nothing inserted, no toast. **Finding B** | w06 (suspect, see below), **re-run** w07 |

Saved bytes (`b6b-wysiwyg-after.md`, 171 bytes, identical in the first and the re-run save):

    # B6b WYSIWYG sweep

    `code` target line

    ```
    fence target line
    ```

    1. ordered target line

    - unordered target line

    > quote target line

    math target line

    end of fixture

### Findings (item 1)

- **A. Source Math Block splits the line at the caret.** With the caret inside `math target l|ine`, ⌥⇧⌘M produced `math target l` / `$$` / blank / `$$` / `ine` (s10). At the line end it inserts a clean block below (s11). One command, one undo step, so not a fail condition. But B5c's menu path inserted the block below the line, so the key and menu paths may differ, or the menu click had the caret at the line end. Worth a look.
- **B. Math Block in WYSIWYG is silent.** No insert (correct, Source-only), but no toast and no log line. The only mode toast in this build is Insert Table's (`utils/tableInsertTrigger.ts:36`). Plan § 6 D255-WI-3a…d acceptance says "disabled modes stay refused with a toast". Recorded as a gap against that line, not as a fail.
- **C. Two chords prove by effect only.** Source ⌘D (CodeMirror owner) and WYSIWYG ⇧⌘\` (Milkdown owner) emit no log line by design, so their proof is the effect (and saved bytes for ⇧⌘\`). If the brief's "one log line per chord" is strict, these two are effect-only.

## 2. M7 Keyboard Shortcuts list

Settings opened from the WYSIWYG window (⌘,; `ui.shortcut.trigger` `file.preferences`).

1. **Groups and rows** (`m7-01` … `m7-13`): File, Edit, Paragraph, Format, View, Table, mdpro, Window, in that order. Rows match the command table: File incl. Save As ⇧⌘S and Export HTML; Edit incl. Select Line/Word, Delete Word "Not set", Find ⌘F, Find Next ⌘G + fixed F3, Find Previous ⇧⌘G + fixed ⇧F3, Replace ⌘H; Paragraph incl. Table ⇧⌘T, Code Fences ⌥⌘C, Math Block ⌥⇧⌘M, Quote ⇧⌘B, lists ⌥⌘O/⌥⌘U; Format incl. Underline ⌘U, Strikethrough ⇧⌘X, Image ⇧⌘I, Highlight ⇧⌘M, Clear Format ⌘\; View: Source ⌃2, WYSIWYG ⌃4, Toggle Sidebar ⇧⌘L, Cycle View Mode ⌘/ + fixed F6, Switch Documents ⌃Tab; Table: the six ⌥⌘ keys.
2. **Not available rows** (Open Quickly, Copy As Markdown, Paste As Plain Text, Toggle Fullscreen): muted, no key button. Clicking both the label and the "Not available" text of Open Quickly started no recording and logged nothing (`m7-02`).
3. **Capability lines**: Delete Word "Source only", Math Block "Source only", Table "WYSIWYG only", Clear Format "WYSIWYG only" (`m7-04`, `m7-08`, `m7-09`, `m7-11`). Find carries no capability line on macOS: this build's v2 table has Find `both` (D255-WI-3c built WYSIWYG find), so the card's older "Find: Source only" wording no longer applies. **Fixed/system rows** with dashed, non-editable boxes: 12 on macOS (Jump to Top, Jump to Bottom "System", Undo, Redo, Cut, Copy, Paste, Select All, Enter Full Screen ⌃⌘F, Quit ⌘Q, Hide Others ⌥⌘H, Minimize ⌘M). Clicking Undo's box started no recording and logged nothing (`m7-06`).
4. **Record F6 alone**: Export HTML → "Press keys…" → F6 was accepted as a lone F-key (`ui.button.click` `settings.shortcuts.edit.fileExportHtml`). The page then showed "Conflicting shortcuts detected — Save is blocked until they are resolved. Export HTML conflicts with Cycle View Mode, not active", with the row in red (`m7-14`, `m7-15`): F6 is Cycle View Mode's fixed second key, so the refusal is correct. To exercise Save, Export HTML was re-recorded as **F7** (`m7-16`).
5. **Save and pending row**: "Unsaved shortcut changes · Discard · Save" banner (`m7-17`). Save → `ui.button.click` `settings.shortcuts.save` 11:22:50.488 + `preferences.set` success; `~/.mdpro/config.json` had `"fileExportHtml": "F7"`. Reopening Settings showed **"Export HTML F7 — Active: Cmd+Shift+E · after restart: F7"** (`m7-18`). ⇧⌘N (`window.create` success, window `mdpro-19363850…`) → click → ⌘, in the new window showed the same pending row (`m7-19`).
- **Minimize (D296)**: present under Window as a fixed ⌘M row (`m7-13`). Recorded, not failed.
- No `ui.settings.shortcuts.save` `refused` line appeared: Save was never clicked while the F6 conflict stood (the banner hides the Save button then).

## Steps re-run after the picsee intrusion (10:54–11:05)

mdpro-delegator relayed that picsee drove the GUI ~10:54–11:05 (launched Picsee, ⌘O panel, keystrokes, arrows, screencapture). My steps in that window and what I did:

| Original step | Time | Re-run |
|---|---|---|
| WYSIWYG ⌥⇧⌘M Math Block refusal (w06) | 10:55 | **Re-run** 11:06 (`w-math-rerun` mark, `w07`): no insert, no log line, no toast, as before |
| WYSIWYG ⌘S save | 10:56:53 | **Re-run** 11:07:38 after repair (below); bytes identical to the first save |
| ⌘, open Settings (General page only) | 10:57 | **Re-run**: Settings closed and reopened at 11:08; all M7 steps ran after 11:06 |

**Foreign input reached mdpro**: at 11:06 the WYSIWYG document read `math targetl line`, a stray `l` typed after my 10:56:53 save (the file on disk still had `math target line`; a draft `b6d21e2a986175b8.draft.json` held it). I retyped the word, re-saved, and confirmed the bytes match the pre-intrusion save. The Source window's file was unaffected (`cmp` OK) and all four windows answered `clean` at quit. All Source chords (10:01–10:08, 10:50) and the WYSIWYG chords w01–w05 (10:50–10:52) ran before the intrusion and were not re-run.

## Cleanup

- mdpro quit with `osascript … quit` at 11:25:51: `app.quit.check` `clean` for all 4 windows; no tauri-app process left.
- `~/.mdpro/config.json` restored from the backup: `cmp` OK (the run's version, with F7, is kept as `config-after-run.json`).
- Pre-existing drafts restored, `shasum -c` OK; the run left no draft (the stray-`l` draft was cleared by the app at the re-save).
- Input source restored to Doubao Pinyin (TIS `select rc=0`).
- `$HOME/.cache/desktop-gui.lock` (owner mdpro / mac-test / B6b, taken 09:50:33) released at 11:26:24, after mdpro quit.
- Verify build left in place; no repository files changed.

## Surprises

1. **Picsee drove the GUI during the lock** (Picsee PID 46962 from `picsee/.build/device-20261024-105430-issue82-FOLDER-01/…`, Terminal taking the front, a stray keystroke in mdpro). I stopped input at 10:57, asked, and resumed only after mdpro-delegator said picsee was paused; see the re-run table.
2. **Other sessions' unit tests write into `~/.mdpro/mdpro.log`** throughout the run: `app.quit.*` with window labels A/B/w0–w7, `ui.menu.availability` cancels for `paragraph.table`, `file.save`/`file.watch.*` under `/var/folders/…/mdpro_io_test`, `ui.menu.build` version 1. None carry this run's window IDs; I excluded them. `mdpro-run.log` still contains them, so filter by window ID or `via` when reading it.
3. HID idle kept resetting every 1–5 s from 10:51 on, with a UURemote "Wake Up Display" assertion active, so someone may have been connected remotely. After 11:06 the log showed no input I didn't send.
4. Computer Use's key API accepted `cmd+shift+grave` for ⇧⌘\` (B6 had failed on a literal backtick).
5. Opening a file with `open -n <bundle> <file>` at launch opened no tab; the file came in through a second `open -a`, which opened its own window.
