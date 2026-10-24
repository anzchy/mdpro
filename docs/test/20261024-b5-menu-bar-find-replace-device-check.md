# Device check B5 and B5b: macOS menu bar and WYSIWYG find/replace, Mac mini, 2026-10-23/24

Committed by herdr-delegator from the tester's reports (gpt-imple-3, Codex Computer Use). Build: a new verify build of
master `557fec68` (code equal to `d1c5b3c5`: M1b, WI-3d, WI-3c and D305), launched by exact path,
`releaseId:"unknown"`. B5 ran 2026-10-23 23:55–00:06; B5b, which finished B5 on the same build, ran on 2026-10-24.
The user's words: 「yes」 (build and start B5) and 「补跑 B5b，按 VS Code 习惯 (Recommended)」.

## Delegator's check against the cards

| Item | Verdict | Note |
|---|---|---|
| M4 tree walk, both modes | **PASS** | 18 menu screenshots against the macOS v2 layout; mode-switch logs |
| M3a on the M4 tree | **NOT EXERCISED** (twice) | B5 ran out of steps; in B5b Computer Use returned `Screenshot unavailable` for the bundle and the no-focused-window state was not proved |
| D261 steps 1, 2, 4 | **NOT EXERCISED** (twice) | ordinary routing and the immediate focus race reached one target; the stale-dialog submissions were not completed |
| M3b menu clicks | **NOT EXERCISED** | inline formatting, Heading, Quote, Ordered List and the modal refusal acted once each; the Source, table and stale-callback cases were not completed. New finding **D318**: Unordered List on an ordered-list paragraph logged `cancel` `no_change` twice (B5); on a plain paragraph it works, and on a bulleted item it is a no-op (B5b) |
| Switch Documents | **PASS** | B5's brief wrongly asked for a tab list; the menu plan (`docs/plans/20261015-plan-menu-reorganisation.md`) defines one MRU switch command, which switched tabs and logged `tab.switch` |
| Themes and Help | **PASS** | one select per click, no error |
| WI-3c find and replace | **PASS** | ⌘F opens the bottom bar focused and prefilled; ⌘G / ⇧⌘G wrap; ⌘H shows Replace; Replace with `cats` advances (F1 fixed). Undo follows the user's VS Code rule: ⌘Z in a field undoes the field; with focus in the document one ⌘Z reverts a whole Replace All and one ⇧⌘Z redoes it (B5b) |

M3a, D261 steps 1/2/4 and the rest of M3b keep `真机未验`. They have now failed to complete twice under Codex Computer
Use, so the next attempt should go to a tester whose screenshots work for this bundle.

---

## Tester's report B5 (verbatim)

# B5 device report — macOS menu bar and WYSIWYG find/replace

Tester: `gpt-imple-3`  
Run date: 2026-10-23 23:55–2026-10-24 00:06 +0800  
Evidence: `/Users/jack/.mdpro-redesign/device/B5-evidence/`

## Build and identity

- Requested SHA: `557fec68`; tested SHA: `557fec68cfacb509552f13eda1b401db19bdc5e2` (detached worktree).
- Worktree: `/Users/jack/Documents/mac-app/mdpro-wt/verify-557fec6`.
- Bundle: `/Users/jack/Documents/mac-app/mdpro-wt/verify-557fec6/src-tauri/target/release/bundle/macos/mdpro.app`.
- Build command: `scripts/heavy-lock.sh pnpm tauri build` with the brief's Rust PATH. Rust release compilation and `.app`, DMG, and updater archive bundling succeeded. The command's final exit was 1 only for the expected missing `TAURI_SIGNING_PRIVATE_KEY` updater-signing step. Full log: `/Users/jack/.mdpro-redesign/herdr-spike/gpt-imple-3/verify-557fec6.build.log`.
- First explicit-path launch, used only to discover and isolate two pre-existing recovery drafts: PID 20522; `app.ready` at `2026-10-23T23:55:05.517+08:00`, `appVersion:"0.3.5"`, `buildId:"unknown"`, `releaseId:"unknown"`.
- Test launch: PID 20848; process command was the verifier bundle's `Contents/MacOS/tauri-app`, with no other mdpro process. `app.ready` at `2026-10-23T23:55:55.020+08:00`, `appVersion:"0.3.5"`, `buildId:"unknown"`, `releaseId:"unknown"`.
- During shutdown, closing the primary window while the secondary window still existed caused the verifier to create a new primary process, PID 26979. Its `app.ready` at `00:06:13.527+08:00` also reported `buildId/releaseId:"unknown"`. No test probe ran in that process; it was closed during cleanup.

## Counts

**PASS 2 · FAIL 3 · NOT EXERCISED 2**

| Item | Verdict | Proof |
|---|---|---|
| 1. M4 tree walk, WYSIWYG and Source | PASS | 18 menu screenshots; mode-switch dispatch/select/change logs |
| 2. M3a on the M4 tree | NOT EXERCISED | Two modes/windows were established, but the required per-focus/no-focus screenshot matrix was not completed |
| 3. D261 steps 1, 2, and 4 | NOT EXERCISED | Distinct target labels were observed, but the focus-race and stale-dialog steps were not completed |
| 4. M3b menu clicks | FAIL | Several WYSIWYG commands worked once; Unordered List dispatched twice but both times cancelled `reason:"no_change"` and did not change the selected ordered-list paragraph |
| 5. Switch Documents menu | FAIL | Direct MRU switch works and logs `tab.switch`, but the menu does not list open tabs as required by B5 |
| 6. Themes and Help | PASS | Light/Dark/System and Keyboard Shortcuts all opened correctly, with one select event per click and no related error |
| 7. WI-3c find and replace | FAIL | Most find behavior passed; one Undo after Replace All undid the Find/Replace field state, not the document replacement |

## 1. M4 tree walk — PASS

Steps actually run:

1. Opened every top-level native menu with the pointer in WYSIWYG: mdpro, File, Edit, Paragraph, Format, View, Themes, Window, Help.
2. Switched to Source through View > Source, then opened the same nine menus with the pointer.
3. Compared visible item names, accelerator labels, separators, and enabled/disabled mode-specific rows against `src-tauri/src/menu_layout.json` v2. No mismatch was observed. In particular, WYSIWYG Table was enabled and Math Block disabled; Source Table was disabled and Math Block enabled; Source exposed Delete Word while WYSIWYG exposed Clear Format.

Decisive logs:

```json
{"event":"menu.action.dispatch","status":"success","context":{"action":"set-view-mode","target":"main","via":"focused"}}
{"event":"ui.menu.select","status":"success","context":{"controlId":"menu.view.set_mode","mode":"source","windowLabel":"main"}}
{"event":"view.mode.change","status":"success","context":{"fromMode":"wysiwyg","intent":"user","source":"setViewMode","toMode":"source"}}
```

Screenshots: `B5-evidence/menu-wysiwyg-{mdpro,file,edit,paragraph,format,view,themes,window,help}.png` and `B5-evidence/menu-source-{mdpro,file,edit,paragraph,format,view,themes,window,help}.png`.

## 2. M3a — NOT EXERCISED

Completed setup only: created window B from window A, left A in WYSIWYG, and set B to Source. The log proves the Source action targeted the generated B label:

```json
{"event":"window.create","status":"success","context":{"windowId":"mdpro-48313b5d-32c4-4fae-ba70-a5615043f8b1"}}
{"event":"menu.action.dispatch","status":"success","context":{"action":"set-view-mode","target":"mdpro-48313b5d-32c4-4fae-ba70-a5615043f8b1","via":"focused"}}
{"event":"ui.menu.select","status":"success","context":{"controlId":"menu.view.set_mode","mode":"source","windowLabel":"mdpro-48313b5d-32c4-4fae-ba70-a5615043f8b1"}}
```

I did not complete the required focused-A, focused-B, no-focused-window, and focused mode-change screenshot sequence. Therefore this is not device proof and is not a pass.

## 3. D261 steps 1, 2, and 4 — NOT EXERCISED

The run established that ordinary clicks were routed to a single focused label: window B received Source/System actions under its generated label; after B was minimized, Save targeted only `main`:

```json
{"event":"menu.action.dispatch","status":"success","context":{"action":"theme.system","target":"mdpro-48313b5d-32c4-4fae-ba70-a5615043f8b1","via":"focused"}}
{"event":"menu.action.dispatch","status":"success","context":{"action":"file.save","target":"main","via":"focused"}}
```

However, B5 requires D261 steps 1, 2, and 4 as a set. I did not complete the immediate focus-race or the Insert Table/Save As/close-confirm stale-document submissions, so there is no `reason:"stale"` proof. Per the brief this is NOT EXERCISED.

## 4. M3b menu clicks — FAIL

Steps actually run on a copied `d37-small-doc.md` fixture in WYSIWYG:

- Bold, Italic, Code, Strikethrough, Highlight Selection, Heading 2, Quote, and Ordered List were each clicked through native menus. Each produced one `menu.action.dispatch` and one `ui.menu.select success`. The visible/serialized document proved Bold, Italic, Strikethrough, Highlight, Heading 2, Quote, and Ordered List. Code had the success log but its document effect was not independently retained as proof.
- With the ordered-list paragraph still selected, Unordered List was clicked twice. Both clicks produced one dispatch but `ui.menu.select cancel` with `reason:"no_change"`; the document remained `1. Second paragraph ends here.`. This fails the requirement that the listed menu click perform its action once.
- The complete M3b WYSIWYG/Source command matrix, link/table stale callbacks, modal refusal, and Source table cases were not run. This incompleteness is additional reason not to accept the row as passing.

Decisive logs:

```json
{"event":"ui.menu.select","status":"success","context":{"controlId":"editor.format.strong"}}
{"event":"ui.menu.select","status":"success","context":{"controlId":"editor.format.emphasis"}}
{"event":"ui.menu.select","status":"success","context":{"controlId":"editor.format.code"}}
{"event":"ui.menu.select","status":"success","context":{"controlId":"editor.format.strike"}}
{"event":"ui.menu.select","status":"success","context":{"controlId":"menu.format.highlight","windowLabel":"main"}}
{"event":"ui.menu.select","status":"success","context":{"controlId":"editor.paragraph.heading2"}}
{"event":"ui.menu.select","status":"success","context":{"controlId":"editor.paragraph.quote"}}
{"event":"ui.menu.select","status":"success","context":{"controlId":"editor.paragraph.orderedList"}}
{"event":"ui.menu.select","status":"cancel","context":{"controlId":"editor.paragraph.unorderedList","reason":"no_change"}}
```

Screenshot: `B5-evidence/m3b-wysiwyg-format-actions.png`.

## 5. Switch Documents — FAIL

Opened copied `d37-small-doc.md` and `d43-recent-menu.md` as two tabs. View contained a single `Switch Documents` command, not a tab list/submenu. Clicking it switched directly from d43 to the MRU d37 tab. Thus the underlying MRU action works, but B5's explicit “lists the open tabs; choosing one activates it” UI contract is absent.

```json
{"event":"menu.action.dispatch","status":"success","context":{"action":"view.switch_documents","target":"main","via":"focused"}}
{"event":"ui.menu.select","status":"success","context":{"controlId":"menu.view.switch_documents","windowLabel":"main"}}
{"event":"tab.switch","status":"success","context":{"fromDocumentId":"1c9bf2580254f64e","toDocumentId":"af27c2f50c7c0c32"}}
```

Screenshot: `B5-evidence/switch-documents-no-list.png`.

## 6. Themes and Help — PASS

Clicked Themes > Dark, System, and Light with the pointer. The window visibly switched each time and each click logged exactly one dispatch/select pair. Clicked Help > Keyboard Shortcuts; Settings opened directly to the Keyboard Shortcuts page. No error or fail was logged for any theme/help action. The test-launch log contained 563 info lines and one unrelated `ui.toc.resolve.mismatch` warning caused after changing a fixture heading; there were no theme/help warnings or errors.

```json
{"event":"ui.menu.select","status":"success","context":{"controlId":"menu.theme.dark","windowLabel":"main"}}
{"event":"ui.menu.select","status":"success","context":{"controlId":"menu.theme.system","windowLabel":"main"}}
{"event":"ui.menu.select","status":"success","context":{"controlId":"menu.theme.light","windowLabel":"main"}}
{"event":"ui.menu.select","status":"success","context":{"controlId":"menu.help.keyboard_shortcuts","windowLabel":"main"}}
```

Screenshots: `B5-evidence/find-dark-theme.png`, `B5-evidence/theme-system.png`, `B5-evidence/help-keyboard-shortcuts.png` (the light-theme find screenshot is `find-selection-prefill.png`).

## 7. WI-3c find and replace — FAIL

Steps and results:

- PASS: selected `paragraph`, pressed Command-F, bottom Find bar opened focused with the selection prefilled and `1 of 3`.
- PASS: Command-G advanced; repeated Command-G wrapped to `1 of 3`; Shift-Command-G wrapped backward to `3 of 3`.
- PASS: Command-H exposed the Replace row.
- PASS: on an appended `cat cat cat.` sequence, Replace with `cats` changed one occurrence and advanced to the next active match. With whole-word off, the resulting `cats` remained a substring match, so the displayed count stayed three.
- **FAIL:** Replace All then produced `catss cats cats.` (expected under substring matching after the earlier single replacement). One Command-Z did not revert that document transaction; instead it reverted the Find/Replace fields to their prior query/replacement and left `catss cats cats.` in the document.
- PASS: Escape closed the bar and a typed `x` landed in the editor.
- PASS: switching mode and switching tab closed the bar.
- PASS: Source Command-F opened the existing CodeMirror top search panel unchanged.
- PASS: light and dark themes.
- PASS: at a window width below 720 px the bottom bar wrapped cleanly to two rows.
- NOT EXERCISED subcase: reload-closes-find.

Decisive action logs include paired start/success rows for `next`, `previous`, `replace.open`, `replace.one`, `replace.all`, and `close`. The Replace All pair was:

```json
{"event":"ui.find.action","status":"start","actionId":"e698028f-3ccb-40ba-acba-9e6961a8a0e1","context":{"controlId":"replace.all"}}
{"event":"ui.find.action","status":"success","actionId":"e698028f-3ccb-40ba-acba-9e6961a8a0e1","context":{"controlId":"replace.all"}}
```

Screenshots:

- `B5-evidence/find-selection-prefill.png`
- `B5-evidence/find-wrap-previous-3-of-3.png`
- `B5-evidence/replace-row.png`
- `B5-evidence/replace-single-advances.png`
- `B5-evidence/replace-all-one-undo-fail.png`
- `B5-evidence/find-escape-focus-return.png`
- `B5-evidence/source-search-unchanged.png`
- `B5-evidence/find-dark-theme.png`
- `B5-evidence/find-narrow-under-720.png`

## Cleanup proof

- The verifier process is gone: `pgrep -x tauri-app` returned no process.
- Restored `/Users/jack/.mdpro/config.json` from `B5-evidence/config-backup/config.json`; `cmp` exited 0 (`config_cmp=PASS`).
- Two pre-existing drafts temporarily isolated from Recovery were restored to their original directory with their original SHA-256 values:
  - `858322f7b0e05037.draft.json`: `0073be6727825aea25d125f61415d270e099407bd3fb8f210982a8257b4eddd0`
  - `cd0315a393fbe762.draft.json`: `528cf52cdfbf6150141ae19d0d6f3bfaf579d449d87fd72f68fca950095a53e7`
- `$HOME/.cache/desktop-gui.lock` was removed only after the app had quit and after its owner file was rechecked as `project=mdpro`, `session=gpt-imple-3`.
- The verifier worktree remains in place at `/Users/jack/Documents/mac-app/mdpro-wt/verify-557fec6` on detached `557fec68` for B6/B7.
- No repository source files were changed and no commit was made. The copied d37 fixture under B5 evidence was intentionally saved with the test mutations.

## Surprises

1. Two drafts from the preceding B4 run were still present and caused Recovery on the first launch. I quit without resolving them, moved exactly those files into the B5 evidence backup for the run, then restored both after shutdown and verified their hashes.
2. Quit closed the main test window but the still-existing secondary window caused a fresh primary verifier process/window to appear. The new process still identified as the unsigned verifier (`releaseId:"unknown"`); no test ran in it, and cleanup closed it before restoring state and releasing the GUI lock.
3. `Switch Documents` behavior matches an MRU-toggle interpretation, while the B5 brief explicitly requires an open-tab list. The verdict follows the brief.

---

## Tester's report B5b (verbatim)

# B5b device report — completion run for B5

Tester: `gpt-imple-3`  
Run date: 2026-10-24 07:58–08:06 +0800  
Evidence: `/Users/jack/.mdpro-redesign/device/B5b-evidence/`

## Build and identity

- Tested SHA: `557fec68cfacb509552f13eda1b401db19bdc5e2` (existing detached verifier worktree).
- Bundle: `/Users/jack/Documents/mac-app/mdpro-wt/verify-557fec6/src-tauri/target/release/bundle/macos/mdpro.app`.
- Every launch was by that explicit bundle path. The primary clean test launch was PID `57767`; later restarts necessitated by a stuck native Open panel were PIDs `58592` and `58777`.
- Identity proof on all three test launches: the only mdpro process was from `verify-557fec6`, and `app.ready` reported `appVersion:"0.3.5"`, `buildId:"unknown"`, `releaseId:"unknown"`.

```json
{"ts":"2026-10-24T07:59:35.582+08:00","event":"app.ready","status":"success","context":{"appVersion":"0.3.5","buildId":"unknown","pid":57767,"platform":"macos","releaseId":"unknown"}}
{"ts":"2026-10-24T08:02:30.386+08:00","event":"app.ready","status":"success","context":{"appVersion":"0.3.5","buildId":"unknown","pid":58592,"platform":"macos","releaseId":"unknown"}}
{"ts":"2026-10-24T08:02:46.753+08:00","event":"app.ready","status":"success","context":{"appVersion":"0.3.5","buildId":"unknown","pid":58777,"platform":"macos","releaseId":"unknown"}}
```

## Counts

**PASS 2 · FAIL 0 · NOT EXERCISED 3**

| Item | Verdict | Proof |
|---|---|---|
| 1. M3a complete focus/no-focus matrix | NOT EXERCISED | Two windows with different modes and distinct target labels were established, but the required five screenshots could not be saved because Computer Use returned `Screenshot unavailable` for this bundle; the no-focused-window state was not proved |
| 2. D261 steps 1, 2 and 4 | NOT EXERCISED | Ordinary routing and the immediate focus-race reached one captured target; the stale-dialog submissions were not completed |
| 3. M3b full matrix | NOT EXERCISED | WYSIWYG inline formatting, modal refusal, and the two requested Unordered List cases were exercised; the full Source/table/stale-callback matrix was not completed |
| 4. WI-3c undo convention | PASS | Find/Replace field undo stayed in the focused field and left the document unchanged; one document-focused undo reverted all three Replace All replacements, and one redo restored all three |
| 5. Switch Documents re-graded | PASS | Per B5b, reused B5 evidence: one MRU command switched from d43 to d37 and logged `tab.switch`; no rerun was required |

## 1. M3a — NOT EXERCISED

Steps actually run:

1. Opened fixture-copy `d37-small-doc.md` in window A (WYSIWYG).
2. Created window B from File > New Window and set B to Source from the native View menu.
3. Focused A and opened Paragraph: Table was enabled and Math Block disabled.
4. Focused B and opened Paragraph: Table was disabled and Math Block enabled.
5. Attempted the required screenshot capture through Computer Use; its macOS app target returned `Screenshot unavailable for .../verify-557fec6/.../mdpro.app` for both `getScreenshot` and `getAXStateAndScreenshot`.
6. Attempted to minimise all windows for the no-focus state. Window rebinding could not prove that every window was minimised, so this step is not accepted.

Decisive routing/mode logs:

```json
{"event":"menu.action.dispatch","status":"success","context":{"action":"file.new_window","target":"main","via":"focused"}}
{"event":"menu.action.dispatch","status":"success","context":{"action":"set-view-mode","target":"mdpro-a1b20585-4c2d-4a32-bd1c-9fee96d76578","via":"focused"}}
{"event":"ui.menu.select","status":"success","context":{"controlId":"menu.view.set_mode","mode":"source","windowLabel":"mdpro-a1b20585-4c2d-4a32-bd1c-9fee96d76578"}}
{"event":"view.mode.change","status":"success","context":{"fromMode":"wysiwyg","intent":"user","source":"setViewMode","toMode":"source"}}
```

Screenshots: none. The card requires them, so this item cannot pass.

## 2. D261 steps 1, 2 and 4 — NOT EXERCISED

Steps actually run:

1. With two windows open, native menu actions produced one dispatch to one concrete label. The mode change above targeted B only; formatting actions targeted `main` only.
2. Ran the focus-race probe by clicking Format > Highlight Selection in A and immediately sending the macOS next-window chord. The action retained `target:"main"`; the other window remained empty.
3. Opened Link on a selection, entered a URL, then switched documents. The app closed the Link modal on switch, so there was no still-live Insert callback to submit and no `reason:"stale"` proof.
4. Insert Table stale submit, Save As + switch, and close-confirm + switch were not completed. The computer-control layer repeatedly rebound to a newly focused window and then created an extra window when a stale AX index was rejected; continuing could not produce reliable per-dialog proof.

Decisive logs:

```json
{"event":"menu.action.dispatch","status":"success","context":{"action":"editor.format.hyperlink","target":"main","via":"focused"}}
{"event":"ui.menu.select","status":"success","context":{"controlId":"editor.format.hyperlink"}}
{"event":"tab.switch","status":"success","context":{"fromDocumentId":"458b506f445c320b","toDocumentId":"b8a52e23-ddd1-4b2e-bd68-dfc928acfa03"}}
{"event":"menu.action.dispatch","status":"success","context":{"action":"format.highlight","target":"main","via":"focused"}}
{"event":"ui.menu.select","status":"success","context":{"controlId":"menu.format.highlight","windowLabel":"main"}}
```

No stale log was produced, so the card's step 4 is not device proof.

## 3. M3b full matrix — NOT EXERCISED

WYSIWYG steps completed on the copied fixture:

- Heading 2 visibly changed the current paragraph to H2 and logged one dispatch/select pair.
- Bold, Italic, Underline, Code, Strikethrough, Highlight Selection and Clear Format each logged one successful dispatch/select pair. The document was visibly changed and then returned with Undo between probes.
- Modal refusal: while Insert Link owned focus, Paragraph > Heading 1 produced `reason:"modal_open"` and the document did not change.
- Unordered List on a plain paragraph changed it to a bullet and logged success.
- Unordered List on that already bulleted item left it unchanged and logged cancel `reason:"no_change"`. This bounds D318: the plain-paragraph path works; applying the same command to an existing bullet is a no-op. The B5 ordered-list-paragraph failure was not reproduced in these two requested cases.

```json
{"event":"ui.menu.select","status":"success","context":{"controlId":"editor.paragraph.heading2"}}
{"event":"ui.menu.select","status":"success","context":{"controlId":"editor.format.strong"}}
{"event":"ui.menu.select","status":"success","context":{"controlId":"editor.format.emphasis"}}
{"event":"ui.menu.select","status":"success","context":{"controlId":"editor.format.underline"}}
{"event":"ui.menu.select","status":"success","context":{"controlId":"editor.format.code"}}
{"event":"ui.menu.select","status":"success","context":{"controlId":"editor.format.strike"}}
{"event":"ui.menu.select","status":"success","context":{"controlId":"menu.format.highlight","windowLabel":"main"}}
{"event":"ui.menu.select","status":"success","context":{"controlId":"editor.format.clearFormat"}}
{"event":"ui.menu.select","status":"cancel","context":{"controlId":"editor.paragraph.heading1","reason":"modal_open"}}
{"event":"ui.menu.select","status":"success","context":{"controlId":"editor.paragraph.unorderedList"}}
{"event":"ui.menu.select","status":"cancel","context":{"controlId":"editor.paragraph.unorderedList","reason":"no_change"}}
```

Source was entered and its menu availability was inspected (Table disabled, Math Block enabled). Heading 1 logged success. A later Bold probe logged `reason:"no_change"` because the selection was no longer valid after window rebinding. The remaining Source commands, Source table cases, Table stale callback, and Link stale submit were not completed. Therefore the full matrix is NOT EXERCISED, not a partial pass.

## 4. WI-3c undo convention — PASS

Steps actually run:

1. Replaced a copied fixture paragraph with `cat cat cat` and opened Replace.
2. With Find focused, typed a replacement query then pressed Command-Z: the Find field returned to `cat`, Replace stayed `dog`, and document text stayed `dog dog dog`.
3. With Replace focused, replaced `dog` with `hound`, then pressed Command-Z: Replace returned to `dog`, Find stayed `cat`, and the document did not change.
4. Clicked Replace All for `cat` → `dog`: the editor visibly changed all three matches to `dog dog dog` and announced `replaced 3 matches.`
5. Clicked the document, pressed Command-Z once: the whole line returned to `cat cat cat` in one step.
6. Pressed Shift-Command-Z once: the whole line returned to `dog dog dog` in one step.

The first attempt used accessibility `setValue`, whose synthetic write has different native undo history; it cleared both controlled fields. That attempt is not the verdict. The accepted probes used normal focused typing, matching the user's VS Code convention, and passed.

No `ui.find.action` rows were emitted for these undo keystrokes in this build. The decisive proof was the accessibility-visible field and document value after each single keypress.

## 5. Switch Documents, re-graded — PASS

B5b says to reuse B5's run. The tested native View > Switch Documents command is one MRU switch, not a tab list. B5's decisive proof is valid under the corrected plan:

```json
{"event":"menu.action.dispatch","status":"success","context":{"action":"view.switch_documents","target":"main","via":"focused"}}
{"event":"ui.menu.select","status":"success","context":{"controlId":"menu.view.switch_documents","windowLabel":"main"}}
{"event":"tab.switch","status":"success","context":{"fromDocumentId":"1c9bf2580254f64e","toDocumentId":"af27c2f50c7c0c32"}}
```

## Cleanup proof

- Quit every verifier process. `pgrep -lf 'verify-557fec6/.*/mdpro.app/Contents/MacOS|tauri-app'` returned no process.
- Restored `/Users/jack/.mdpro/config.json` from `B5b-evidence/config-backup/config.json`; `cmp` exited 0 (`config_cmp=PASS`).
- Restored the two pre-existing drafts with their original SHA-256 values:
  - `858322f7b0e05037.draft.json`: `0073be6727825aea25d125f61415d270e099407bd3fb8f210982a8257b4eddd0`
  - `cd0315a393fbe762.draft.json`: `528cf52cdfbf6150141ae19d0d6f3bfaf579d449d87fd72f68fca950095a53e7`
- Drafts created only by this copied-fixture run were isolated under `B5b-evidence/run-drafts/`; no pre-existing draft was deleted.
- The verifier worktree remains at `/Users/jack/Documents/mac-app/mdpro-wt/verify-557fec6` on detached `557fec68`.
- No repository files were changed and no commit was made.
- The GUI lock owner was rechecked as `project=mdpro`, `session=gpt-imple-3`, `pid=61107` before release.

## Surprises

1. Computer Use could inspect the macOS accessibility menu tree but returned no screenshots for this app, which prevents M3a's required screenshot proof.
2. The native Open panel accumulated nested Go-to-Folder sheets under Computer Use and stopped accepting the selected path. The verifier was restarted by exact PID; later fixtures were opened from Recent or created as clean untitled tabs.
3. A document switch automatically closed the pending Link modal, so there was no stale Insert callback to submit in that path.
4. A rejected stale accessibility index was followed by a real `file.new_window` dispatch. No test verdict relies on that accidental window.
