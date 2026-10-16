<!-- Device-check record. Merged by mdpro-delegator from dtrack's three reports on the Mac mini (~/.mdpro-redesign/dtrack/reports/report-20261016-shortcuts-audit-{a,b,c}.md); briefs by mdpro-a3 (~/.mdpro-redesign/stage-3/brief-shortcuts-audit-{common,a,b,c}.md, not in the repo). Earlier run: docs/test/20261014-shortcuts-mac-device-check.md. -->

# Keyboard shortcuts audit, macOS: every Settings entry in WYSIWYG and Source (2026-10-16)

Recorded by mdpro-delegator. The user's request: 「测试Mac上mdpro 每一个Keyboard Shortcut(in Settings），哪些可以work，哪些无法Work，二是如果可以Work，什么情况下Work（WYSIWYG 还是 Source mode），出具一个全面的Audit报告」.

**Verdict:** of the 49 entries on Settings › Keyboard Shortcuts, at their default macOS bindings,
**22 work in both modes, 6 only in WYSIWYG, 6 only in Source,
12 in neither, and 3 are taken by macOS before mdpro sees them.**
Every one of the 98 cases (49 entries × 2 modes) came out as the 2026-10-14 run predicted. No verdict or
route changed, and nothing regressed. This run adds Source mode for File and View, which 2026-10-14 had
not tested, and a two-window check of ⌘\`.

## Setup

| Item | Value |
|---|---|
| Machine | Mac mini, dtrack, macOS 26.4, 1920×1080 @1x, input source ABC |
| Build | the v0.3.5 candidate: build-only release run 38830353983 of `3315eb3effdbd993f33047039f3ea6f5da4949c7`. `tauri-app` sha256 `490b53b70709a5d755d3e03b329fe406f3a0e6085ba0c2b1618412c3df8ae717`; releaseId `0.3.4@3315eb3e…` on every launch |
| Bindings | the defaults. mdpro-a3 re-derived the 49 entries from the code at `3315eb3e` (KeyboardShortcutsSettings, preferences.ts, platformLabels, useKeyboardShortcuts, useMenuEvents, menu.rs, the link and Typora keymaps, Editor.tsx); nothing has changed since `50c67c5`. `keyboardShortcuts` in `config.json` was identical before and after every batch |
| Runs | A (File, View) 09:47–10:00; B (Paragraph) 10:02–10:13; C (Format, Edit) 10:13–10:24 (+0800). Each batch ran one W pass and one S pass on a fixed fixture copy, with route controls first. Every close was clean: no quit prompt, no drafts, config as found |

**How each case was judged.** The key was pressed with the window focused and the log marked first.
- **WORKS:** the action happened, proved by a log line (L-number), a saved-file diff or a shot.
- **NO EFFECT:** nothing happened, and the log was empty after the mark.
- **OS-OWNED:** macOS acted first.
- **N/A:** the action can't apply in that mode by design, and the app says so.

**Route** (how the key reached the action):
- **H:** mdpro's window key hook (`ui.shortcut.trigger`).
- **M:** the native menu accelerator (`ui.menu.select`).
- **P:** the WYSIWYG (Milkdown) keymap.
- **C:** the CodeMirror keymap.
- **OS:** macOS.

## Summary by where it works

| Where it works | Count | Entries |
|---|---|---|
| **Both modes** | 22 | New ⌘N、New Window ⌘⇧N、Open ⌘O、Save ⌘S、Close ⌘W、Preferences ⌘,、Source ⌃2、WYSIWYG ⌃4、Toggle Sidebar ⌘⇧L、Cycle View Mode ⌘/、Heading 1 ⌘1、Heading 2 ⌘2、Heading 3 ⌘3、Heading 4 ⌘4、Heading 5 ⌘5、Heading 6 ⌘6、Paragraph ⌘0、Indent ⌘]、Outdent ⌘[、Hyperlink ⌘K、Jump to Top ⌘↑、Jump to Bottom ⌘↓ |
| **WYSIWYG only** | 6 | Table ⌘⌥T、Code Fences ⌘⌥C、Bold ⌘B、Italic ⌘I、Code ⌘⇧\`、Strikethrough ⌃⇧\` |
| **Source only** | 6 | Increase Heading ⌘=、Decrease Heading ⌘-、Select Word ⌘D、Find ⌘F、Find Next ⌘G、Find Previous ⌘⇧G |
| **Neither** (NO EFFECT in both) | 12 | Save As ⌘⇧S、Toggle Fullscreen ⌘⌥F、Math Block ⌘⌥B、Ordered List ⌘⌥O、Unordered List ⌘⌥U、Underline ⌘U、Image ⌘⌃I、Clear Format ⌘\、Copy As Markdown ⌘⇧C、Paste As Plain Text ⌘⇧V、Select Line ⌘L、Delete Word ⌘⇧D |
| **Taken by macOS** | 3 | Switch Documents ⌘\`、Quote ⌘⌥Q、Replace ⌘H |

How to read the edge cases:
- ⌃2 (Source) and ⌃4 (WYSIWYG) count as working in both modes. In the mode that is already current they are N/A by design.
- Table ⌘⌥T is WYSIWYG-only by design. In Source it shows the toast "Insert Table is available in WYSIWYG mode".
- ⌘↑ / ⌘↓ work in both modes, but not as mdpro bindings: WYSIWYG gets WebKit's native caret move, and Source gets CodeMirror's.
- In Source, ⌘I and ⌘U don't format: ⌘I grows the selection (CodeMirror select-parent-syntax), and ⌘U collapses it (CodeMirror undo-selection).

## Full matrix (entry × mode)

| # | Group | Entry | Mac chord | WYSIWYG | Source | Effect in WYSIWYG | Effect in Source |
|---|---|---|---|---|---|---|---|
| F1 | File | New | ⌘N | ✅ WORKS (H) | ✅ WORKS (H) | new Untitled tab, tabs 2→3 | new Untitled tab in Source |
| F2 | File | New Window | ⌘⇧N | ✅ WORKS (M) | ✅ WORKS (M) | second window, focused | second window (opened in Source) |
| F3 | File | Open | ⌘O | ✅ WORKS (H) | ✅ WORKS (H) | native Open panel (`sa16-f3-w-panel`) | native Open panel (`sa16-f3-s-panel`) |
| F4 | File | Save | ⌘S | ✅ WORKS (H) | ✅ WORKS (H) | diff `CTRL control linexx` | diff `CTRL control linex` |
| F5 | File | Save As | ⌘⇧S | ❌ NO EFFECT | ❌ NO EFFECT | nothing; no dialog; sha unchanged | nothing; no dialog; sha unchanged |
| F6 | File | Close | ⌘W | ✅ WORKS (H) | ✅ WORKS (H) | Untitled tab closed, tabs 3→2 | Untitled tab closed, tabs 3→2 |
| F7 | File | Preferences | ⌘, | ✅ WORKS (H) | ✅ WORKS (H) | Settings opens (`sa16-f7-w`) | Settings opens (`sa16-f7-s`) |
| V1 | View | Source | ⌃2 | ✅ WORKS (M) | — N/A (M) | switches to Source | none (already Source); no message |
| V2 | View | WYSIWYG | ⌃4 | — N/A (M) | ✅ WORKS (M) | none (already WYSIWYG); no message | switches to WYSIWYG |
| V3 | View | Toggle Sidebar | ⌘⇧L | ✅ WORKS (H) | ✅ WORKS (H) | sidebar hides; 2nd press (L33827) restores; tooltip "Hide Sidebar (⌘⇧L)" | sidebar hides; CodeMirror selection unchanged; 2nd press (L33919) restores |
| V4 | View | Cycle View Mode | ⌘/ | ✅ WORKS (H) | ✅ WORKS (C) | W→S→W, one change per press | S→W, one change |
| V5 | View | Toggle Fullscreen | ⌘⌥F | ❌ NO EFFECT | ❌ NO EFFECT | nothing | nothing |
| V6 | View | Switch Documents | ⌘\` | ⚠️ OS-OWNED (OS) | ⚠️ OS-OWNED (OS) | macOS "Move focus to next window" moves to window B; one window: nothing | macOS "Move focus to next window" moves to window B; one window: nothing |
| P1 | Paragraph | Heading 1 | ⌘1 | ✅ WORKS (P) | ✅ WORKS (C + H) | line becomes H1 | `# ` prefix |
| P2 | Paragraph | Heading 2 | ⌘2 | ✅ WORKS (P) | ✅ WORKS (C + H) | line becomes H2 | `## ` prefix |
| P3 | Paragraph | Heading 3 | ⌘3 | ✅ WORKS (P) | ✅ WORKS (C + H) | line becomes H3 | `### ` prefix |
| P4 | Paragraph | Heading 4 | ⌘4 | ✅ WORKS (P) | ✅ WORKS (C + H) | line becomes H4 | `#### ` prefix |
| P5 | Paragraph | Heading 5 | ⌘5 | ✅ WORKS (P) | ✅ WORKS (C + H) | line becomes H5 | `##### ` prefix |
| P6 | Paragraph | Heading 6 | ⌘6 | ✅ WORKS (P) | ✅ WORKS (C + H) | line becomes H6 | `###### ` prefix |
| P7 | Paragraph | Paragraph | ⌘0 | ✅ WORKS (P) | ✅ WORKS (C + H) | H1 becomes a paragraph | `# ` removed |
| P8 | Paragraph | Increase Heading | ⌘= | ❌ NO EFFECT | ✅ WORKS (C) | nothing; no page zoom | `###`→`##` |
| P9 | Paragraph | Decrease Heading | ⌘- | ❌ NO EFFECT | ✅ WORKS (C) | nothing; no page zoom | `##`→`###` |
| P10 | Paragraph | Table | ⌘⌥T | ✅ WORKS (M) | — N/A (M) | Insert Table modal (`sb16-p10-w-modal`), cancelled | toast "Insert Table is available in WYSIWYG mode"; no modal |
| P11 | Paragraph | Code Fences | ⌘⌥C | ✅ WORKS (P) | ❌ NO EFFECT | line becomes a fenced code block | nothing |
| P12 | Paragraph | Math Block | ⌘⌥B | ❌ NO EFFECT | ❌ NO EFFECT | nothing | nothing |
| P13 | Paragraph | Quote | ⌘⌥Q | ⚠️ OS-OWNED (OS) | ⚠️ OS-OWNED (OS) | macOS Quit and Keep Windows: "Unsaved changes" prompt (`sb16-p13-w-prompt`), Keep editing | macOS Quit and Keep Windows: "Unsaved changes" prompt (`sb16-p13-s-prompt`), Keep editing |
| P14 | Paragraph | Ordered List | ⌘⌥O | ❌ NO EFFECT | ❌ NO EFFECT | nothing | nothing |
| P15 | Paragraph | Unordered List | ⌘⌥U | ❌ NO EFFECT | ❌ NO EFFECT | nothing | nothing |
| P16 | Paragraph | Indent | ⌘] | ✅ WORKS (P) | ✅ WORKS (C) | item nests (2 spaces, `-` kept) | item nests (4 spaces) |
| P17 | Paragraph | Outdent | ⌘[ | ✅ WORKS (P) | ✅ WORKS (C) | item lifts to top level (`-` kept) | item lifts to top level |
| T1 | Format | Bold | ⌘B | ✅ WORKS (P) | ❌ NO EFFECT | `alpha` becomes bold | nothing |
| T2 | Format | Italic | ⌘I | ✅ WORKS (P) | ❌ NO EFFECT | `bravo` becomes italic | selection grows from `bravo` to the whole line (CodeMirror select-parent-syntax) |
| T3 | Format | Underline | ⌘U | ❌ NO EFFECT | ❌ NO EFFECT | nothing; selection stays | selection collapses to the caret (CodeMirror undo-selection) |
| T4 | Format | Code | ⌘⇧\` | ✅ WORKS (P) | ❌ NO EFFECT | `delta` becomes inline code | nothing |
| T5 | Format | Strikethrough | ⌃⇧\` | ✅ WORKS (P) | ❌ NO EFFECT | `echo` struck through | nothing |
| T6 | Format | Hyperlink | ⌘K | ✅ WORKS (P) | ✅ WORKS (C + H) | Insert Link dialog (`sc16-t6-w-dialog`); URL inserted by clicking Insert | same Insert Link dialog (`sc16-t6-s-dialog`); URL inserted |
| T7 | Format | Image | ⌘⌃I | ❌ NO EFFECT | ❌ NO EFFECT | nothing | nothing |
| T8 | Format | Clear Format | ⌘\ | ❌ NO EFFECT | ❌ NO EFFECT | `T8 clear **golf** format` unchanged | `T8 clear **golf** format` unchanged |
| E1 | Edit | Copy As Markdown | ⌘⇧C | ❌ NO EFFECT | ❌ NO EFFECT | clipboard unchanged | clipboard unchanged |
| E2 | Edit | Paste As Plain Text | ⌘⇧V | ❌ NO EFFECT | ❌ NO EFFECT | nothing pasted (clipboard had HTML + plain `hotel`) | nothing pasted (clipboard had plain `hotel` only) |
| E3 | Edit | Select Line | ⌘L | ❌ NO EFFECT | ❌ NO EFFECT | Z goes in at the caret | Z goes in at the caret (CodeMirror select-line is ⌃L) |
| E4 | Edit | Select Word | ⌘D | ❌ NO EFFECT | ✅ WORKS (C) | Z goes in at the caret | CodeMirror `Mod-d` selects `india`; Z replaces it |
| E5 | Edit | Delete Word | ⌘⇧D | ❌ NO EFFECT | ❌ NO EFFECT | `juliet` unchanged | `juliet` unchanged |
| E6 | Edit | Jump to Top | ⌘↑ | ✅ WORKS | ✅ WORKS (C) | WebKit native: caret to the document start | caret to the document start |
| E7 | Edit | Jump to Bottom | ⌘↓ | ✅ WORKS | ✅ WORKS (C) | WebKit native: caret to the document end | caret to the document end (empty last line) |
| E8 | Edit | Find | ⌘F | ❌ NO EFFECT | ✅ WORKS (C) | no find UI | find panel opens with focus in Find; `kilo` gives 3 matches; a macOS autocorrect bubble "Kilo" showed and was not applied |
| E9 | Edit | Find Next | ⌘G | ❌ NO EFFECT | ✅ WORKS (C) | nothing | current match: 1st `kilo` (wrapped), then 2nd |
| E10 | Edit | Find Previous | ⌘⇧G | ❌ NO EFFECT | ✅ WORKS (C) | nothing | current match back from the 2nd `kilo` to the 1st; panel closed with × |
| E11 | Edit | Replace | ⌘H | ⚠️ OS-OWNED (OS) | ⚠️ OS-OWNED (OS) | macOS Hide mdpro; re-shown with open_application (L34596 `window.focus`) | macOS Hide; CodeMirror's Replace field never reached; re-shown (L34619 `window.focus`) |

The L-numbers, diffs and shot names behind each cell are in the three batch reports on the mini.

## Compared with 2026-10-14

[2026-10-14](20261014-shortcuts-mac-device-check.md) ran 86 cases (48 PASS, 34 FAIL with no binding, 4 OS-owned) on an earlier build.
- **No overlapping case changed** its verdict or its route.
- **⌘\` (Switch Documents) is OS-OWNED, not NO EFFECT.** With two windows open, macOS's "Move focus to next window" takes it (`window.blur` → `window.focus` on the other window). The 2026-10-14 run had one window, so nothing visible happened.
- **New cases:** File (F1–F7) and View V5/V6 in Source, ⌃2 in Source and ⌃4 in WYSIWYG, and Table ⌘⌥T in Source. The File keys behave in Source exactly as in WYSIWYG; CodeMirror swallows none of them.
- **Re-confirmed:** D235 refuses ⌘, and ⌘⌥T while Insert Link is open (`ui.dialog.open` cancel, `reason:"modal-open"`). D189's sidebar tooltip reads "Hide Sidebar (⌘⇧L)".

## Notes (not shortcut defects)

1. **WYSIWYG saves keep `-` list markers.** 2026-10-14 rewrote them to `*`, which was D204; the change is `63b47b38`.
2. **Each heading key in WYSIWYG logs a `ui.toc.resolve.mismatch` warning**, `level:warn`. The outline was correct after every press, so the warning is log-only.
3. **macOS autocorrect** applied `linex` → `lines` in WYSIWYG when a click accepted its bubble. It also offered "Kilo" under CodeMirror's Find field, but didn't apply it. The find inputs don't set `autocorrect="off"` / `spellcheck="false"`.
4. **A tab can stay dirty after typing and ⌘Z**, as on 2026-10-14.
5. **A new window opens in the current window's mode.**
6. **Menus:**
   - File has no Save As item, and View has neither Switch Documents nor Toggle Fullscreen (⌘⌥F), matching their NO EFFECT verdicts.
   - The app menu's "Stop Waiting and Quit…" is mdpro's own stuck-quit escape hatch (ADR-0036), not a shortcut.
7. **Off-app:** a macOS Gatekeeper prompt for `codex` (D252) sat on the mini's screen during the run. It blocked one click on the Settings ×; dtrack used the dialog's Close button instead, and no verdict was affected.

## What the gaps mean

None of the 12 NO EFFECT-in-both entries is a regression. Each is listed in Settings with a
default chord that no handler binds on macOS, which is the same finding as 2026-10-14. Whether to bind them,
hide them or mark them unavailable is a product decision, not part of this audit. The same goes for the
6/6 single-mode entries and the three chords macOS takes (⌘\`, ⌥⌘Q, ⌘H).
