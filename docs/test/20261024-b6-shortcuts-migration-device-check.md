# Device check B6: macOS shortcuts and the v1→v2 migration, Mac mini, 2026-10-24

Committed by herdr-delegator from the tester's report (gpt-imple-3, Codex Computer Use). Build: the B5 verify build of
master `557fec68`, launched by exact path, `releaseId:"unknown"`. The user's words: 「开始 B6，我让 picsee 暂停 GUI
(Recommended)」.

## Delegator's check against the cards

| Item | Verdict | Note |
|---|---|---|
| v2 per-chord table, WYSIWYG | **PASS** for the chords run | ⌘I, ⌘U, ⇧⌘X, ⌘\, ⌘D, ⌘L, ⌥⌘[ / ⌥⌘], ⇧⌘I each acted once with its document effect |
| v2 per-chord table, Source; Math Block, lists, Quote, Code Fences | **NOT EXERCISED** | Computer Use cannot send a literal backtick (`keyNotFound`) and its selection drifted after undo; no per-chord proof |
| M1a v1→v2 migration | **PASS** | `preferences.shortcuts.migrate` `fromVersion:1` `toVersion:2` `changedCount:14`; a custom v1 Quote key survived, changed v1 defaults moved to v2 |
| M7 Keyboard Shortcuts list | **NOT EXERCISED** | groups, muted unavailable rows, capability lines, fixed rows and Cycle View's F6 observed; the card's screenshots and its record-and-reopen steps were not done (no screenshot file available). Minimize is the known D296 gap |
| D165 re-smoke | **PASS** | ⌘W / ⌘N / ⌘O cancel with `reason:"modal-open"` under three dialogs |
| D155 re-smoke | **FAIL on the card's typing step**; the D155 fix itself holds | Insert row above the header keeps one table, alignment preserved in saved bytes, ⌥⌘↑ inserts once and one ⌘Z removes it. Typing right after the **context-menu** insertion does not land: the known keys-lost-after-a-right-click observation (M-1 report), the [D292](../plans/20260912-frontend-backend-sequencing-order.md#d292) family, not a regression of D155's structure fix |

The Source chord sweep and the M7 card need a tester whose screenshots and key synthesis work for this bundle
(mac-test managed both in B5c).

---

## Tester's report (verbatim)

# B6 report: macOS shortcuts and v1→v2 migration (gpt-imple-3, 2026-10-24)

- **Build:** `/Users/jack/Documents/mac-app/mdpro-wt/verify-557fec6/src-tauri/target/release/bundle/macos/mdpro.app`, SHA `557fec68cfacb509552f13eda1b401db19bdc5e2`.
- **Identity:** every launch was by that explicit path. The three used launches had exactly one mdpro process and logged `app.ready` with `pid` 98717 / 99648 / 2181, `appVersion:"0.3.5"`, `buildId:"unknown"`, `releaseId:"unknown"`.
- **Run:** 2026-10-24 09:34–09:40 +0800. Evidence: `~/.mdpro-redesign/device/B6-evidence/`; decisive events: `logs/decisive-events.jsonl`; full copied log: `logs/mdpro-full.log`.
- **Screenshots:** none saved. Computer Use could display screenshots, but this bundle/run did not yield a file path; the chord verdicts below use the proving log plus the live document/AX effect, as the B6 brief permits.

## Counts

**PASS 2 (M1a migration, D165) · FAIL 2 (per-chord table, D155) · NOT EXERCISED 1 (M7 complete card).**

## 1. macOS v2 per-chord table — FAIL

The WYSIWYG subset was exercised on the copied `fixtures/b6-shortcuts.md`:

- `⌘I` produced `*alpha*`; `⌘U` produced `<u>alpha</u>`; `⇧⌘X` produced `~~alpha~~`.
- `⌘\` cleared the italic mark; `⌘D` selected `alpha`; `⌘L` selected the full `alpha beta` line.
- `⌥⌘[` changed Heading One from H1 to H2 and `⌥⌘]` returned it to H1, once each.
- `⇧⌘I` opened the image picker once; cancelling logged one `image.pick` Start/Cancel pair (`actionId:7871420e-…`).

The Source sweep was attempted after `view.mode.change` `wysiwyg→source`, but Computer Use selection drifted after the first undo and its key API rejected the literal backtick (`keyNotFound("`")`). The resulting document effects could not prove every Source chord independently; the Code chord in particular is **NOT EXERCISED**. Math Block, ordered/unordered list, Quote and Code Fences also lack an unambiguous per-chord document receipt from this run. Under B1's rule, incomplete proof makes this item FAIL, not PASS. No app hide/quit or double action was observed.

## 2. M1a v1→v2 migration — PASS

Steps actually run:

1. Copied the backed-up v1 `config.json` to `config-v1-custom.json` and changed only `paragraphQuote` from the v1 default `Cmd+Option+Q` to custom `Cmd+Option+9`.
2. Installed that file as `~/.mdpro/config.json`, launched the explicit verify bundle, and checked the written v2 file.
3. Saved the result as `config-custom-after.json` and restored the real config during cleanup.

Decisive evidence:

```json
{"event":"preferences.shortcuts.migrate","status":"success","actionId":"2f2eb181-11c8-482a-bee6-aa4c492f7fad","context":{"changedCount":14,"fromVersion":1,"outcome":"migrated","toVersion":2}}
{"keyboardShortcutsVersion":2,"paragraphQuote":"Cmd+Option+9","formatHighlight":"Cmd+Shift+M","paragraphTable":"Cmd+Shift+T"}
```

The custom v1 Quote binding survived, while changed v1 defaults migrated to v2.

## 3. M7 Keyboard Shortcuts list — NOT EXERCISED

Observed in Settings › Keyboard Shortcuts:

- groups in order: File, Edit, Paragraph, Format, View, Table, mdpro, Window;
- unavailable rows were muted and had no key button (`Open Quickly`, `Copy As Markdown`, `Paste As Plain Text`, `Toggle Fullscreen`);
- capability lines appeared (`Delete Word Source only`, `Math Block Source only`, `Table WYSIWYG only`, `Clear Format WYSIWYG only`);
- fixed/system rows rendered non-editable dashed boxes (`Jump to Top/Bottom System`, Undo/Redo/Cut/Copy/Paste/Select All, Quit, Hide Others, Minimize);
- Cycle View showed `Cmd+/` plus fixed second key `F6`;
- Minimize remained present as the known D296 gap and was not treated as a failure.

The card requires screenshot files for row-state proof plus recording F6 and reopening Settings/new-window Settings to prove the active/pending row. No screenshot file was available and those final two mutation/reopen steps were not run, so the complete M7 card is NOT EXERCISED.

## 4a. D165 modal tab-action guard — PASS

Ran `⌘W`, `⌘N`, `⌘O` with each of these dialogs open: Settings, External change detected, and Unsaved changes. Each dialog stayed open and each action produced a matching modal-open cancel. After Ignore on the external-change dialog, `⌘W` closed the clean fixture normally.

Representative receipts (the decisive file contains all three rounds):

```json
{"event":"tab.close","status":"cancel","actionId":"2d83658a-1797-4fc8-bd33-5ff356741788","context":{"action":"file.close","reason":"modal-open","source":"shortcut"}}
{"event":"tab.open","status":"cancel","actionId":"32e6d4dd-b01b-4dd4-80ad-d7144a436094","context":{"action":"file.new","reason":"modal-open","source":"shortcut"}}
{"event":"tab.open","status":"cancel","actionId":"7b66c89d-9cca-49d4-bb3b-7ffe4c8e1bf1","context":{"action":"file.open","reason":"modal-open","source":"shortcut"}}
{"event":"tab.close","status":"success","context":{"filePath":"/Users/jack/.mdpro-redesign/device/B6-evidence/fixtures/b6-shortcuts.md","wasModified":false}}
```

File › Open Recent was not separately clicked; its shared guard was not needed to establish the shortcut regression on this run.

## 4b. D155 Insert row above header — FAIL

Steps actually run:

1. Opened the copied aligned table in WYSIWYG and right-clicked `H1` → Insert row above.
2. The live document stayed one table, gained an empty header, and moved `H0/H1` to the first body row.
3. Saved bytes stayed one table and preserved center/right alignment (`:-:` / `-:`; the serializer normalized `--:` to `-:`).
4. Clicked the empty header and pressed `⌥⌘↑`; it inserted one additional empty header row and logged exactly one shortcut/action. One `⌘Z` removed exactly that insertion.

Decisive receipts:

```json
{"event":"editor.table.insert_row_before","status":"success","actionId":"f74c2716-9003-4a08-90eb-9628c8ee2ebc","context":{"colIndex":1,"rowIndex":0}}
{"event":"ui.shortcut.trigger","status":"success","actionId":"659fc05c-6148-4da2-b80d-f3d4a19be46a","context":{"action":"editor.table.insert_row_before","shortcut":"Cmd+Option+Up"}}
```

Failure: immediately after the context-menu insertion, typing `NEW` did not land in the empty header. This reproduces the focus-loss observation already recorded in M-1; the card explicitly requires the caret in the new header and typing/saving there, so D155 is FAIL even though the table structure and shortcut/undo paths passed. The unaligned-table and body-row variants were not separately exercised after that failure.

## Cleanup proof

- mdpro quit: PASS (`pgrep -lf 'mdpro.app/Contents/MacOS'` empty before cleanup).
- real config restored: PASS (`cmp ~/.mdpro/config.json B6-evidence/config-backup/config.json`).
- two pre-existing drafts were isolated without deletion and restored to `~/Library/Application Support/mdpro/drafts/`; any run draft was preserved under `B6-evidence/run-drafts/`.
- GUI lock released: PASS (`~/.cache/desktop-gui.lock` removed only after mdpro quit).
- verify worktree/build left in place; no repository files changed.

## Surprises

1. The first explicit launch surfaced two pre-existing Recovery rows. I quit, moved those draft files intact into evidence for the run, created an empty draft directory, and restored the originals byte-for-byte/path-for-path at cleanup; no draft was discarded.
2. Computer Use could not synthesize the literal backtick chord and selection offsets drifted in Source after repeated undo. Those probes were conservatively classified as unproved.
3. D155's post-context-menu typing focus loss is reproducible on this build; the shortcut path retained focus well enough to insert and undo.
