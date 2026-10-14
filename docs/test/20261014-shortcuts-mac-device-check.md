# Settings → Keyboard Shortcuts, macOS device check — Part A (app keys)

- **Brief:** `brief-20261014-shortcuts-mac-dtrack.md` + matrix `brief-20261014-shortcuts-matrix.md` § 2–3
- **Build:** `50c67c5` (v0.3.3 candidate), `builds/50c67c5/mdpro.app`
- **Run:** 2026-10-14 21:44–21:52 GMT+8, the mini, one sitting, dtrack only
- **Scope of this file so far:** pre-flight + **Part A only** (controls CM-M/CM-P/CM-C, F1–F7, V1–V6). Parts B and C were not started.
- **Log:** `~/.mdpro/mdpro.log`; launch mark L19098; Part A lines L19099–L19537
- **Shots:** `reports/shots/shortcuts-a-*.png` (window-only, `shot.sh`; the Open panel by its own window id)

## Pre-flight

| Check | Result |
|---|---|
| Screen lock (`ioreg … CGSSessionScreenIsLocked`) | absent → not locked |
| `request_access(["mdpro"])` | granted `com.mdpro.app` (displayName mdpro), denied none, screenshotFiltering native |
| `pgrep -fl 'mdpro\|tauri-app'` | no mdpro (only the dtrack tmux and an unrelated `claude --resume mdpro-remote` matched the pattern by name) |
| `shasum -a 256 …/tauri-app` | `7d8551b03dd569fed87b728bd021d37397c5c2523dc50e493994644f993aa060` = `BIN_SHA`; mtime `2026-10-14T21:24:34` = `BIN_MTIME` |
| `git -C $WT rev-parse HEAD` | `50c67c5a30ee4cf1a9fca491b2df41c7e178c694` |
| `$S/asfound.json` | written; `keyboardShortcuts` equals the matrix § 3 defaults for all 49 page entries; `defaultViewMode` wysiwyg, `lastViewMode` wysiwyg |
| Input source | `ABC` (KeyboardLayout ID 252) |
| Fixture | `base.md`, `w.md`, `s.md` written exactly per § 3.1; all three sha1 `16713adef94d5c4296d6ab5290829f1755b5246a` |
| Launch `open -a $APP $S/w.md` | L19108 `app.ready` `releaseId` `0.3.3@50c67c5a30ee4cf1a9fca491b2df41c7e178c694`, pid 33842; L19110 `window.focus` main; L19132 `file.open` success w.md |
| Recover drafts | none shown |

## Part A results

Gate (`lastfocus` → `{"event":"window.focus","w":"main"}`) passed before every key press; no NOT VERIFIED (focus).

| Case | Mode | Key sent | Verdict | Proof |
|---|---|---|---|---|
| CM-M (menu) | W | mouse: File › Save (after `key.sh x` on `CTRL`) | **PASS** | L19150 `ui.menu.select` `controlId":"menu.file.save"`, L19154 `file.save` success `…/w.md` 751 B; diff `> CTRL control linex` |
| CM-M (key) | W | `key.sh n command` | **PASS — route deviation** | L19164 `ui.shortcut.trigger` `{"action":"file.new","shortcut":"Cmd+N"}`; new Untitled tab (screen). **No `ui.menu.select menu.file.new`**: ⌘N took route H, not M (see Finding 1) |
| CM-P | W | click after `alpha`, `kc.sh 123 option shift`, `key.sh b command` | **PASS** | saved via File › Save (L19186/L19190); diff `> T1 bold word: **alpha**`. Bold then toggled off with a second ⌘B so Part C's T1 starts clean (confirmed by the F4 diff: T1 line equals base) |
| CM-C | S (s.md) | click end of `CTRL`, `key.sh x`, `key.sh z command` | **PASS** | screen: `CTRL control linex` → `CTRL control line` (zoom), shot `shortcuts-a-cmc-after-undo`; s.md on disk unchanged (sha1 = base) |
| F1 New | W | `key.sh n command` | **PASS (route H)** | L19312 `ui.shortcut.trigger` `file.new` `Cmd+N`; tab strip 3 → 4 (`w.md · Untitled · s.md · Untitled`), shot `shortcuts-a-f1`. No `menu.file.new` |
| F2 New Window | W | `key.sh n command shift` | **PASS (route M)** | L19324 `ui.menu.select` `menu.file.new_window`; L19328 `window.focus` `mdpro-b0e7b015-…` (non-main); `winid.js` 2 windows; shot `shortcuts-a-f2`. Window B closed by its close button → 1 window, focus main |
| F3 Open | W | `key.sh o command` | **PASS (route H)** | L19359 `ui.shortcut.trigger` `file.open` `Cmd+O`; L19360 `file.open` start `source:dialog`; `winid.js` `15954 mdpro 8 880 448 Open`; shots `shortcuts-a-f3-openpanel`, `shortcuts-a-f3-main`. Cancel button → L19363 `file.open` `cancel` |
| F4 Save | W | `key.sh x` on `CTRL`, then `key.sh s command` | **PASS (route H)** | L19374 `ui.shortcut.trigger` `file.save` `Cmd+S`; L19378 `file.save` success `…/w.md` 752 B; diff `> CTRL control linexx` |
| F5 Save As | W | `key.sh s command shift` | **FAIL (no binding)** | zero log lines of any event after mark 19387; no dialog (`winid.js`: main only); w.md sha1 unchanged; shot `shortcuts-a-f5` |
| F6 Close | W | on the clean F1 Untitled tab: `key.sh w command` | **PASS (route H)** | L19397 `ui.shortcut.trigger` `file.close` `Cmd+W`; L19401 `tab.close` `wasModified:false`, `filePath:null`; tabs 4 → 3 (screen) |
| F7 Preferences | W | `key.sh , command` | **PASS (route H)** | L19419 `ui.shortcut.trigger` `file.preferences` `Cmd+,`; L19421 `preferences.read` `settings_dialog`; Settings modal visible, shot `shortcuts-a-f7`. Closed with its Close button; `keyboardShortcuts` unchanged |
| V1 Source | W → S | `key.sh 2 control` | **PASS (route M)** | L19423 `ui.menu.select` `menu.view.set_mode` `mode:source`; L19426 `view.mode.change` wysiwyg → source |
| V2 WYSIWYG | S → W | `key.sh 4 control` | **PASS (route M)** | L19434 `ui.menu.select` `menu.view.set_mode` `mode:wysiwyg`; L19436 `view.mode.change` source → wysiwyg |
| V3 Toggle Sidebar | W | `key.sh l command shift` | **PASS (route H)** | L19450 `ui.shortcut.trigger` `view.toggle_sidebar`; sidebar hidden (shots `shortcuts-a-v3w-before/after`). Restored with a second press (L19453) |
| V3 Toggle Sidebar | S | caret inside `heading` on line 5, `key.sh l command shift` | **PASS (route H)** | L19467 `ui.shortcut.trigger` `view.toggle_sidebar`; sidebar hidden (shots `shortcuts-a-v3s-before/after`). **Selection unchanged**: no `heading` matches selected (CodeMirror `Mod-Shift-l` did not also fire). Restored with a second press (L19470) |
| V4 Cycle View Mode | from S | `key.sh / command` | **PASS (route C)** | L19474 `view.mode.change` source → wysiwyg, `source:cycleViewMode`; **no** `ui.shortcut.trigger`/`ui.menu.select` (CodeMirror had the caret, so its `viewModeKeymap` took it). One line per press |
| V4 Cycle View Mode | from W | `key.sh / command` ×2 | **PASS (route H)** | press 1: L19488 `ui.shortcut.trigger` `view.cycle` + L19491 wysiwyg → source; press 2: L19499 `view.cycle` + L19501 source → wysiwyg. Two `view.mode.change` lines, one per press, none doubled |
| V5 Toggle Fullscreen | W | `key.sh f command option` | **FAIL (no binding)** | bounds before/after `100, 100, 1200, 800` (System Events) and `winid.js` `15901 mdpro 0 1200 800`; zero log lines after mark 19514; w.md unchanged; shot `shortcuts-a-v5` |
| V6 Switch Documents | W, 3 tabs (w.md active) | ``key.sh '`' command`` | **FAIL (no binding)** | active tab still `w.md` (zoom of tab strip, shots `shortcuts-a-v6-before/after`); zero log lines; one window, focus main |

**Tally (Part A):** 4 controls PASS (CM-M with a route note). F: 6 PASS, 1 FAIL (no binding) (F5). V (8 cases): 6 PASS (V1, V2, V3 W/S, V4 S/W), 2 FAIL (no binding) (V5, V6). No NOT EXERCISED, no NOT VERIFIED.

## Findings for the delegator

1. **Route M vs H on macOS (contradicts matrix § 2 / rule 70 D190 WI-1b).** With System Events `keystroke` delivery, ⌘N, ⌘O, ⌘S, ⌘W, ⌘, and ⌘⇧L were all taken by **route H** (`ui.shortcut.trigger`), not by the native menu, even though each has a menu item with that accelerator (File menu shows ⌘N ⌘O ⌘S ⌘W; app menu shows Settings… ⌘,; View shows Toggle Sidebar ⇧⌘L). Only ⌘⇧N (`menu.file.new_window`), ⌃2 and ⌃4 (`menu.view.set_mode`) reached route M. The action happened once in every case (no doubled action seen). The CM-M key half therefore did not log `menu.file.new`; I counted CM-M as PASS because the menu route itself (mouse) and key delivery both worked, and I flag the route difference rather than stop Part A. The delegator may rule otherwise.
2. **⌘/ from Source** takes route C (no H line) while CodeMirror has the caret, and route H after a mode switch (no caret in CodeMirror). Either way, exactly one mode change per press.
3. **No binding confirmed on device:** F5 Save As (⌘⇧S), V5 Toggle Fullscreen (⌘⌥F), V6 Switch Documents (⌘`). These match desk finding § 5.1. Note: the View menu offers **Enter Full Screen** with `fn F`, not ⌘⌥F.
4. **Side observations (not Part A cases):**
   - **s.md stays dirty after the undo.** After CM-C (`x` then ⌘Z, content equal to disk), the s.md tab kept its dirty dot, `draft.write` wrote 750 B at 21:47:58, and Quit raised "Unsaved changes / Quit without saving?" (`app.quit.prompt` L19519, shot `shortcuts-a-quit-prompt`). Clicked **Discard changes**; L19530 `discardedUnchangedCount:1`, L19536 `app.quit.commit` `deleted:1`, L19537 `app.quit`.
   - **External open makes a new window, not a tab.** `open -a $APP $S/s.md` while the app ran opened s.md in a **new window** (L19205 `file.open.route` `outcome:new-window`), not a tab in main. I closed it with its close button and reopened s.md in main via File › Open Recent (L19262 `menu.file.open_recent`, `windowLabel:main`) so the focus gate stayed on `main`.
   - **Serializer rewrites bullet markers.** Every WYSIWYG save of w.md rewrites `-` bullets to `*` (P16/P17 lines). This is the known pre-existing serializer behaviour, not a shortcut result, but it will appear in Part B/C diffs.
   - **macOS autocorrect.** It offered `lines` for `linex` (a bubble only, never applied).
   - **Stale table of contents.** Once, after a tab switch to w.md, it showed "No headings found" until the next view change.

## Part A diff (`diff $S/base.md $S/w.md`, after F4, final)

```
3c3
< CTRL control line
---
> CTRL control linexx
33,36c33,36
< - P16 indent item one
< - P16 indent item two
< - P17 parent
<   - P17 outdent item
---
> * P16 indent item one
> * P16 indent item two
> * P17 parent
>   * P17 outdent item
```

`diff $S/base.md $S/s.md`: empty (s.md sha1 = base).

## Close (Part A sitting)

- Quit from the app menu › Quit mdpro (no ⌘Q). The prompt and its Discard are described in Finding 4. `pgrep tauri-app` shows nothing.
- `config.json` `keyboardShortcuts` **equals** `$S/asfound.json`; `defaultViewMode` / `lastViewMode` both `wysiwyg`, as found.
- `$S` left in place. w.md carries Part A's edits (`linexx`, `*` bullets); Part B's pre-flight rewrites the fixture per brief step 5.
- No repo edited, committed or pushed. No Esc/Enter pressed in any dialog or menu.

## Parts B and C

Not started — awaiting mdpro-delegator.

---

# Part B — paragraph (P1–P17, W then S)

- **Run:** 2026-10-14 21:54–22:02 GMT+8, the mini, one sitting, dtrack only. Log lines L19538–L19729.
- **D204 note (once):** WYSIWYG saves rewrite `-` list markers to `*` (D204, known). It shows in the W diff on the P16/P17 lines; no row is failed for the marker character itself.

## Pre-flight (Part B)

| Check | Result |
|---|---|
| Screen lock | not locked |
| `request_access(["mdpro"])` | granted `com.mdpro.app`, tier full, denied none |
| `pgrep -fl 'mdpro\|tauri-app'` | no mdpro running (only the dtrack tmux / unrelated `claude --resume mdpro-remote` name matches) |
| Build | sha256 `7d8551b0…3aa060` = `BIN_SHA`, mtime `2026-10-14T21:24:34`; HEAD `50c67c5a30ee…` |
| As found | `$S/asfound-b.json` byte-identical to `$S/asfound.json` (defaults; `lastViewMode` wysiwyg) |
| Input source | ABC |
| Fixture | `w.md`, `s.md` re-copied from `base.md` (sha1 `16713adef9…` all three) |
| Launch `open -a $APP $S/w.md` | L19548 `app.ready` `releaseId` `0.3.3@50c67c5a30ee4cf1a9fca491b2df41c7e178c694`, pid 40038; L19572 `file.open` w.md; no Recover drafts |

Gate: `lastfocus` = `{"event":"window.focus","w":"main"}` before every key press (helper aborts otherwise; it never aborted). Harness note: the first CM-P press showed `window.blur` (L19587) from the `kc.sh` `set frontmost`, re-focused 18 ms later at L19588, before ⌘B was sent; the helper was then tightened to require `window.focus` exactly. No NOT VERIFIED (focus).

## W half (w.md)

| Case | Mode | Key sent | Verdict | Proof |
|---|---|---|---|---|
| CM-P | W | click after `alpha`, `kc.sh 123 option shift`, `key.sh b command` | **PASS** | diff `> T1 bold word: **alpha**` |
| P1 Heading 1 | W | `key.sh 1 command` | **PASS** | diff `> # P1 heading target`; no log line (route P) |
| P2 Heading 2 | W | `key.sh 2 command` | **PASS** | diff `> ## P2 heading target` |
| P3 Heading 3 | W | `key.sh 3 command` | **PASS** | diff `> ### P3 heading target` |
| P4 Heading 4 | W | `key.sh 4 command` | **PASS** | diff `> #### P4 heading target` |
| P5 Heading 5 | W | `key.sh 5 command` | **PASS** | diff `> ##### P5 heading target` |
| P6 Heading 6 | W | `key.sh 6 command` | **PASS** | diff `> ###### P6 heading target` |
| P7 Paragraph | W | `key.sh 0 command` on `# P7` | **PASS** | diff `> P7 paragraph target` (no `#`) |
| P8 Increase Heading | W | `key.sh = command` on `### P8` | **FAIL (no binding)** | line 19 unchanged in diff; zero log lines after mark 19609; no page zoom |
| P9 Decrease Heading | W | `key.sh - command` on `## P9` | **FAIL (no binding)** | line 21 unchanged; zero log lines; no page zoom |
| P10 Table | W | `key.sh t command option` | **PASS (route M)** | L19612 `ui.menu.select` `menu.format.insert_table`; Insert Table modal (shot `shortcuts-b-p10-modal`); closed with its Cancel, nothing inserted (diff) |
| P11 Code Fences | W | `key.sh c command option` | **PASS** | diff `22a23 > ```` and `23a25 > ```` around `P11 code target` |
| P12 Math Block | W | `key.sh b command option` | **FAIL (no binding)** | line unchanged; zero log lines |
| P13 Quote | W | `key.sh q command option` | **FAIL — ⌘⌥Q is macOS Quit** | not "nothing happens": L19618 `app.quit.request`, L19622 `app.quit.prompt` (doc dirty) → "Unsaved changes / Quit without saving?" (shot `shortcuts-b-p13-quit-prompt`). Cancelled with **Keep editing** → L19629 `app.quit.cancel`. Line unchanged. See Finding B1 |
| P14 Ordered List | W | `key.sh o command option` | **FAIL (no binding)** | line unchanged; zero log lines; caret confirmed on the line (⌥⇧← selected `target`) |
| P15 Unordered List | W | `key.sh u command option` | **FAIL (no binding)** | line unchanged; zero log lines; caret confirmed on the line |
| P16 Indent | W | `key.sh ']' command` in 2nd P16 item | **PASS** | diff `>   * P16 indent item two` (nested) |
| P17 Outdent | W | `key.sh '[' command` in nested P17 item | **PASS** | diff `> * P17 outdent item` (top level) |

Save: `key.sh s command` → L19636 `ui.shortcut.trigger` `file.save`, L19640 `file.save` success w.md 787 B.

```
$ diff $S/base.md $S/w.md
5c5
< P1 heading target
---
> # P1 heading target
7c7
< P2 heading target
---
> ## P2 heading target
9c9
< P3 heading target
---
> ### P3 heading target
11c11
< P4 heading target
---
> #### P4 heading target
13c13
< P5 heading target
---
> ##### P5 heading target
15c15
< P6 heading target
---
> ###### P6 heading target
17c17
< # P7 paragraph target
---
> P7 paragraph target
22a23
> ```
23a25
> ```
33,36c35,38
< - P16 indent item one
< - P16 indent item two
< - P17 parent
<   - P17 outdent item
---
> * P16 indent item one
>   * P16 indent item two
> * P17 parent
> * P17 outdent item
38c40
< T1 bold word: alpha
---
> T1 bold word: **alpha**
```

## S half (s.md)

s.md opened in main via File › Open Recent (L19650 `menu.file.open_recent`), Source by View menu (L19671 `menu.view.set_mode` source, L19674 `view.mode.change` wysiwyg → source).

| Case | Mode | Key sent | Verdict | Proof |
|---|---|---|---|---|
| CM-C | S | click end of `CTRL`, `key.sh x`, `key.sh z command` | **PASS** | screen `linex` → `line` (zoom), shot `shortcuts-b-cmc-after-undo`; line 3 unchanged in diff |
| P1 Heading 1 | S | `key.sh 1 command` | **PASS** | diff `> # P1 heading target`; L19682 `ui.shortcut.trigger` `paragraph.heading1` — **1 line** |
| P2 Heading 2 | S | `key.sh 2 command` | **PASS** | diff `> ## P2 …`; L19685 `paragraph.heading2` — 1 line |
| P3 Heading 3 | S | `key.sh 3 command` | **PASS** | diff `> ### P3 …`; L19686 `paragraph.heading3` — 1 line |
| P4 Heading 4 | S | `key.sh 4 command` | **PASS** | diff `> #### P4 …`; L19687 `paragraph.heading4` — 1 line |
| P5 Heading 5 | S | `key.sh 5 command` | **PASS** | diff `> ##### P5 …`; L19688 `paragraph.heading5` — 1 line |
| P6 Heading 6 | S | `key.sh 6 command` | **PASS** | diff `> ###### P6 …`; L19689 `paragraph.heading6` — 1 line |
| P7 Paragraph | S | `key.sh 0 command` on `# P7` | **PASS** | diff `> P7 paragraph target`; L19692 `paragraph.paragraph` — 1 line |
| P8 Increase Heading | S | `key.sh = command` | **PASS** | diff `> ## P8 increase target`; no log line (route C) |
| P9 Decrease Heading | S | `key.sh - command` | **PASS** | diff `> ### P9 decrease target`; no log line |
| P11 Code Fences | S | `key.sh c command option` | **FAIL (no binding)** | line unchanged; zero log lines |
| P12 Math Block | S | `key.sh b command option` | **FAIL (no binding)** | line unchanged; only background `draft.write` lines |
| P13 Quote | S | `key.sh q command option` | **FAIL — ⌘⌥Q is macOS Quit** | L19695 `app.quit.request`, L19698 `app.quit.prompt` (shot `shortcuts-b-p13s-quit-prompt`); **Keep editing** → L19704 `app.quit.cancel`; line unchanged |
| P14 Ordered List | S | `key.sh o command option` | **FAIL (no binding)** | line unchanged; zero log lines |
| P15 Unordered List | S | `key.sh u command option` | **FAIL (no binding)** | line unchanged; zero log lines |
| P16 Indent | S | `key.sh ']' command` in 2nd P16 item | **PASS** | diff `>     - P16 indent item two` (nested, 4-space indent unit) |
| P17 Outdent | S | `key.sh '[' command` in nested P17 item | **PASS** | diff `> - P17 outdent item` |

P1–P7 in S: 7 presses, 7 `ui.shortcut.trigger` lines (L19682–L19692), one per press; no heading applied twice (each line has exactly n `#`).

Save: `key.sh s command` → L19707 `ui.shortcut.trigger` `file.save`, L19710 `file.save` success s.md 777 B.

```
$ diff $S/base.md $S/s.md
5c5
< P1 heading target
---
> # P1 heading target
7c7
< P2 heading target
---
> ## P2 heading target
9c9
< P3 heading target
---
> ### P3 heading target
11c11
< P4 heading target
---
> #### P4 heading target
13c13
< P5 heading target
---
> ##### P5 heading target
15c15
< P6 heading target
---
> ###### P6 heading target
17c17
< # P7 paragraph target
---
> P7 paragraph target
19c19
< ### P8 increase target
---
> ## P8 increase target
21c21
< ## P9 decrease target
---
> ### P9 decrease target
34c34
< - P16 indent item two
---
>     - P16 indent item two
36c36
<   - P17 outdent item
---
> - P17 outdent item
```

**Tally (Part B, 33 cases + 2 controls):** controls CM-P, CM-C PASS. W (17): PASS = P1–P7, P10, P11, P16, P17 = **11**; FAIL (no binding) = P8, P9, P12, P14, P15 = **5**; FAIL (Quit) = P13 = **1**. S (16): PASS = P1–P9, P16, P17 = **11**; FAIL (no binding) = P11, P12, P14, P15 = **4**; FAIL (Quit) = P13 = **1**. No NOT EXERCISED / NOT VERIFIED. All verdicts match matrix § 3 expectations except P13, whose "—" is in fact a binding to app Quit.

## Findings for the delegator (Part B)

- **B1. P13 Quote ⌘⌥Q quits mdpro (both modes).** macOS sends ⌥⌘Q to the app menu's Quit alternate ("Quit and Keep Windows"); mdpro runs its full quit path (`app.quit.request` → prompt). With unsaved work a prompt saves the user; with **no** dirty document the app would presumably quit outright (not tested — it would end the sitting). Same class as E11 ⌘H / Hide: the Settings page offers a chord the OS app menu owns.
- **B2. Mode-only rows confirmed:** P8/P9 work in S only; P11 works in W only; P12, P14, P15 work in neither (desk finding § 5.1 confirmed).
- **B3. Source P16 indent** inserts 4 spaces (`    - P16 indent item two`), WYSIWYG writes 2 (`  * …`). Both parse as nested; noted only.
- **B4. `lastViewMode`** is `source` after this sitting (as found `wysiwyg`): the app records the last mode, and Part B ends in S. `keyboardShortcuts` is unchanged. I did not edit `config.json`. Part C's W launch will open in Source unless the delegator wants it reset; Part C can switch to W by the View menu, as the brief already prescribes for mode changes.

## Close (Part B sitting)

- Quit from app menu › Quit mdpro: L19720 `app.quit.check` `clean`, `dirtyCount:0`; L19728 `app.quit.commit` `deleted:0`; L19729 `app.quit`. `pgrep tauri-app` empty; `~/.mdpro/drafts` empty.
- `config.json` `keyboardShortcuts` **equals** `$S/asfound.json`. **Difference:** `lastViewMode` `source` (as found `wysiwyg`); `defaultViewMode` `wysiwyg` unchanged. Not fixed, per brief.
- `$S` left in place (w.md sha1 `7b70200b…`, s.md sha1 `7bdf8cdf…`, diffs also in `$S/diff-b-w.txt`, `$S/diff-b-s.txt`).
- No repo edited; no Esc/Enter in any dialog; no ⌘Q (the two quit prompts came from P13's ⌘⌥Q and were cancelled).

## Part C

Not started — awaiting mdpro-delegator.

---

# Part C — format and edit (T1–T8, E1–E11; W then S)

- **Run:** 2026-10-14 22:03–22:12 GMT+8, the mini, one sitting, dtrack only. Log lines L19730–L19968.
- **D204 note (once):** the W diffs show the known `-` → `*` list-marker rewrite on the P16/P17 lines (D204); not counted against any row.

## Pre-flight (Part C)

| Check | Result |
|---|---|
| Screen lock | not locked |
| `request_access` | First call also asked for `clipboardRead`; **the delegator declined that on purpose**. Re-requested for `mdpro` only, no clipboard flags → granted `com.mdpro.app`, tier full, denied none. E1/E2 are proved with `pbpaste` in the shell, as the brief says |
| `pgrep` | no mdpro running |
| Build | sha256 = `BIN_SHA`, mtime `2026-10-14T21:24:34`, HEAD `50c67c5a30ee…` |
| As found | `$S/asfound-c.json`: `keyboardShortcuts` = defaults; `defaultViewMode` wysiwyg; `lastViewMode` **source** (carried over from Part B, B4) |
| Input source | ABC |
| Fixture | `w.md`, `s.md` re-copied from `base.md` (sha1 `16713adef9…`) |
| Launch | L19740 `app.ready` `releaseId` `0.3.3@50c67c5a30ee4cf1a9fca491b2df41c7e178c694`, pid 47744; w.md opened in **WYSIWYG** (`defaultViewMode` applies to the opened file despite `lastViewMode` source); no Recover drafts |

Gate passed (`window.focus` main) before every key press, including after each E11 re-show.

## Format, W (w.md)

| Case | Mode | Key sent | Verdict | Proof |
|---|---|---|---|---|
| CM-P = T1 Bold | W | click after `alpha`, `kc.sh 123 option shift`, `key.sh b command` | **PASS** | diff `> T1 bold word: **alpha**`. CM-P and T1 W are the same press (a second ⌘B would toggle it off) |
| T2 Italic | W | sel `bravo`, `key.sh i command` | **PASS** | `> T2 italic word: *bravo*` |
| T3 Underline | W | sel `charlie`, `key.sh u command` | **FAIL (no binding)** | line unchanged; zero log lines; selection stayed |
| T4 Code | W | sel `delta`, ``key.sh '`' command shift`` | **PASS** | ``> T4 code word: `delta` `` |
| T5 Strikethrough | W | sel `echo`, ``key.sh '`' control shift`` | **PASS** | `> T5 strike word: ~~echo~~` |
| T6 Hyperlink | W | sel `foxtrot`, `key.sh k command` | **PASS** | opens an **Insert Link** dialog (shot `shortcuts-c-t6w`, no log line); typed `https://example.com`, clicked **Insert** (no Enter) → `> T6 link word: [foxtrot](https://example.com)` |
| T7 Image | W | sel `line`, `key.sh i command control` | **FAIL (no binding)** | line unchanged; zero log lines; shot `shortcuts-c-t7w` |
| T8 Clear Format | W | whole line (`kc.sh 123 command shift`), `key.sh '\\' command` | **FAIL (no binding)** | `T8 clear **golf** format` unchanged; zero log lines |

Save: L19794 `file.save` success w.md 785 B.

```
$ diff $S/base.md $S/w.md        # after T in W
33,36c33,36
< - P16 indent item one
< - P16 indent item two
< - P17 parent
<   - P17 outdent item
---
> * P16 indent item one
> * P16 indent item two
> * P17 parent
>   * P17 outdent item
38c38
< T1 bold word: alpha
---
> T1 bold word: **alpha**
40c40
< T2 italic word: bravo
---
> T2 italic word: *bravo*
44c44
< T4 code word: delta
---
> T4 code word: `delta`
46c46
< T5 strike word: echo
---
> T5 strike word: ~~echo~~
48c48
< T6 link word: foxtrot
---
> T6 link word: [foxtrot](https://example.com)
```

## Format, S (s.md)

s.md opened in main via File › Open Recent (L19804); Source by View menu (L19824/L19827).

| Case | Mode | Key sent | Verdict | Proof |
|---|---|---|---|---|
| CM-C | S | click end of `CTRL`, `key.sh x`, `key.sh z command` | **PASS** | shots `shortcuts-c-cmc-typed` (`linex`) → `shortcuts-c-cmc-after-undo` (`line`); line 3 unchanged in diff |
| T1 Bold | S | sel `alpha`, `key.sh b command` | **FAIL (no binding)** | unchanged; zero log lines |
| T2 Italic | S | sel `bravo`, `key.sh i command` | **FAIL (no binding)** | text unchanged; selection grew from `bravo` to the whole line (CodeMirror `Mod-i` select-parent-syntax), shot `shortcuts-c-t2s` |
| T3 Underline | S | sel `charlie`, `key.sh u command` | **FAIL (no binding)** | text unchanged; the selection collapsed back to the caret (CodeMirror `Mod-u` undo-selection), shot `shortcuts-c-t3s` |
| T4 Code | S | sel `delta`, ``key.sh '`' command shift`` | **FAIL (no binding)** | unchanged; zero log lines |
| T5 Strikethrough | S | sel `echo`, ``key.sh '`' control shift`` | **FAIL (no binding)** | unchanged; zero log lines |
| T6 Hyperlink | S | sel `foxtrot`, `key.sh k command` | **PASS** | L19840 `ui.shortcut.trigger` `{"action":"format.hyperlink","shortcut":"Cmd+K"}` (one line); same Insert Link dialog (shot `shortcuts-c-t6s`); URL typed, **Insert** clicked → `> T6 link word: [foxtrot](https://example.com)` |
| T7 Image | S | sel `line`, `key.sh i command control` | **FAIL (no binding)** | unchanged; zero log lines; shot `shortcuts-c-t7s` |
| T8 Clear Format | S | whole line, `key.sh '\\' command` | **FAIL (no binding)** | unchanged; zero log lines |

Save: L19847 `file.save` success s.md 773 B.

```
$ diff $S/base.md $S/s.md        # after T in S
48c48
< T6 link word: foxtrot
---
> T6 link word: [foxtrot](https://example.com)
```

## Edit, W (w.md)

| Case | Mode | Key sent | Verdict | Proof |
|---|---|---|---|---|
| E1 Copy As Markdown | W | sel `hotel`, `key.sh c command shift` | **FAIL (no binding)** | `pbpaste` before: empty (sha1 `da39a3ee5e6b`, 0 bytes); after: identical, empty. Zero log lines; no inspector/window |
| E2 Paste As Plain Text | W | `key.sh c command` on `hotel` (pbpaste → `hotel`; `clipboard info` has «class HTML» 442 B + utf8), then caret at end of `E2`, `key.sh v command shift` | **FAIL (no binding)** | nothing pasted (zoom); `E2 paste target line` unchanged in diff; zero log lines |
| E3 Select Line | W | caret end of `E3`, `key.sh l command`, then `key.sh Z` | **FAIL (no binding)** | `> E3 select line targetZ` (Z inserted at caret; nothing selected) |
| E4 Select Word | W | caret inside `india`, `key.sh d command`, `key.sh Z` | **FAIL (no binding)** | `> E4 select word indZia` |
| E5 Delete Word | W | caret inside `juliet`, `key.sh d command shift` | **FAIL (no binding)** | `E5 delete word juliet` unchanged; zero log lines |
| E6 Jump to Top | W | caret end of `LAST line`, `kc.sh 126 command`, `key.sh Z` | **PASS** (WebKit native) | `> # ZShortcut matrix fixture` — Z at the document start |
| E7 Jump to Bottom | W | caret end of first line, `kc.sh 125 command`, `key.sh Z` | **PASS** (WebKit native) | `> LAST lineZ` |
| E8 Find | W | `key.sh f command` | **FAIL (no binding)** | no find UI (shot `shortcuts-c-e8w`); only background `draft.write` lines |
| E9 Find Next | W | `key.sh g command` | **FAIL (no binding)** | no selection change (shot `shortcuts-c-e9w`); zero log lines |
| E10 Find Previous | W | `key.sh g command shift` | **FAIL (no binding)** | no change (shot `shortcuts-c-e10w`); zero log lines |
| E11 Replace | W | `key.sh h command` | **FAIL — ⌘H is macOS Hide** (as expected) | L19881 `window.blur`; System Events `visible` = false; `winid.js` no on-screen window. Shown again with `open_application("mdpro")` → visible true, gate `window.focus` main |

Save: L19889 `file.save` success w.md 789 B.

```
$ diff $S/base.md $S/w.md        # after T + E in W (final w.md)
1c1
< # Shortcut matrix fixture
---
> # ZShortcut matrix fixture
33,36c33,36
< - P16 indent item one
< - P16 indent item two
< - P17 parent
<   - P17 outdent item
---
> * P16 indent item one
> * P16 indent item two
> * P17 parent
>   * P17 outdent item
38c38
< T1 bold word: alpha
---
> T1 bold word: **alpha**
40c40
< T2 italic word: bravo
---
> T2 italic word: *bravo*
44c44
< T4 code word: delta
---
> T4 code word: `delta`
46c46
< T5 strike word: echo
---
> T5 strike word: ~~echo~~
48c48
< T6 link word: foxtrot
---
> T6 link word: [foxtrot](https://example.com)
58c58
< E3 select line target
---
> E3 select line targetZ
60c60
< E4 select word india
---
> E4 select word indZia
66c66
< LAST line
---
> LAST lineZ
```

## Edit, S (s.md)

Source by View menu (L19908/L19911).

| Case | Mode | Key sent | Verdict | Proof |
|---|---|---|---|---|
| E1 Copy As Markdown | S | sel `hotel` inside `**hotel**`, `key.sh c command shift` | **FAIL (no binding)** | clipboard emptied first with `pbcopy < /dev/null` (it held only the run's own `hotel`); `pbpaste` before `[]`, after `[]`; zero log lines. The selection was `hotel` (the following ⌘C gave `hotel`) |
| E2 Paste As Plain Text | S | `key.sh c command` (pbpaste → `hotel`; in S the copy is **plain text only**: utf8/string, no HTML flavour), caret end of `E2`, `key.sh v command shift` | **FAIL (no binding)** | nothing pasted; line unchanged in diff; zero log lines |
| E3 Select Line | S | caret end of `E3`, `key.sh l command`, `key.sh Z` | **FAIL (no binding)** | `> E3 select line targetZ` (as the matrix predicts: CodeMirror's select-line is ⌃L) |
| E4 Select Word | S | caret inside `india`, `key.sh d command`, `key.sh Z` | **PASS** | `> E4 select word Z` — ⌘D selected `india`, Z replaced it (CodeMirror `Mod-d`) |
| E5 Delete Word | S | caret inside `juliet`, `key.sh d command shift` | **FAIL (no binding)** | unchanged; zero log lines |
| E6 Jump to Top | S | caret end of `LAST line`, `kc.sh 126 command`, `key.sh Z` | **PASS** | `> Z# Shortcut matrix fixture` — Z at document start (CodeMirror `Cmd-ArrowUp`) |
| E7 Jump to Bottom | S | caret end of line 1, `kc.sh 125 command`, `key.sh Z` | **PASS** | `66a67 > Z` — Z at the document end (the empty line after the final newline; the file now ends without a newline) |
| E8 Find | S | `key.sh f command` | **PASS** | CodeMirror find/replace panel opened with focus in Find (shot `shortcuts-c-e8s-panel`); typed `kilo` → three matches highlighted (shot `shortcuts-c-e8s-kilo`); no log line (route C) |
| E9 Find Next | S | `key.sh g command` ×2 | **PASS** | 1st press: the current match went to the 1st `kilo` (it wrapped from the document end, shot `shortcuts-c-e9s-1`); 2nd press: the 2nd `kilo` (shot `shortcuts-c-e9s-2`) |
| E10 Find Previous | S | `key.sh g command shift` | **PASS** | the current match went back from the 2nd `kilo` to the 1st (shot `shortcuts-c-e10s`). Panel closed with its × button |
| E11 Replace | S | `key.sh h command` | **FAIL — ⌘H is macOS Hide** (as expected) | L19925 `window.blur`; `visible` false; no on-screen window. Note: CodeMirror's panel has a Replace field, but ⌘H never reaches it. Re-shown with `open_application("mdpro")`, gate passed |

Save: L19930 `file.save` success s.md 772 B.

```
$ diff $S/base.md $S/s.md        # after T + E in S (final s.md)
1c1
< # Shortcut matrix fixture
---
> Z# Shortcut matrix fixture
48c48
< T6 link word: foxtrot
---
> T6 link word: [foxtrot](https://example.com)
58c58
< E3 select line target
---
> E3 select line targetZ
60c60
< E4 select word india
---
> E4 select word Z
66a67
> Z
\ No newline at end of file
```

**Tally (Part C, 38 cases + 2 controls):** CM-P and CM-C PASS.

| Group | PASS | FAIL (no binding) | FAIL (OS-owned chord) |
|---|---|---|---|
| T in W (8) | T1, T2, T4, T5, T6 | T3, T7, T8 | — |
| T in S (8) | T6 | T1, T2, T3, T4, T5, T7, T8 | — |
| E in W (11) | E6, E7 | E1, E2, E3, E4, E5, E8, E9, E10 | E11 (Hide) |
| E in S (11) | E4, E6, E7, E8, E9, E10 | E1, E2, E3, E5 | E11 (Hide) |

Total 14 PASS, 22 FAIL (no binding), 2 FAIL (Hide). No NOT EXERCISED / NOT VERIFIED. Every verdict matches the matrix § 3 "Expected" column.

## Findings for the delegator (Part C)

- **C1. Format works in W only, apart from Hyperlink.** In S, ⌘B, ⌘I, ⌘⇧` and ⌃⇧` do nothing to the text. ⌘I in S widens the selection, and ⌘U in S collapses it. Matches the desk findings.
- **C2. Hyperlink (⌘K) opens an in-app "Insert Link" dialog in both modes.** In S it also logs `format.hyperlink` (route H); in W it logs nothing. The matrix said "typora keymap: link"; the result is the same `[foxtrot](url)`.
- **C3. ⌘H hides mdpro in both modes** (E11), as expected. It never reaches CodeMirror's Replace field.
- **C4. Edit rows mostly have no binding in W.** In W only ⌘↑ and ⌘↓ work, and that is native WebKit. In S, CodeMirror supplies ⌘D (Select Word), ⌘↑/⌘↓, ⌘F, ⌘G and ⌘⇧G. ⌘L, ⌘⇧D, ⌘⇧C and ⌘⇧V have no binding in either mode. Desk finding § 5.1 is confirmed.
- **C5. The copied clipboard differs by mode.** ⌘C in W puts HTML plus plain text on the clipboard; ⌘C in S puts plain text only. This is relevant to any future Paste As Plain Text work.

## Close (Part C sitting and whole run)

- **lastViewMode restored.** Before quitting I switched the window to WYSIWYG with View › WYSIWYG (L19941). This makes the app record `lastViewMode` = `wysiwyg`, the value found before Part A. I made no file edit.
- **Clean quit.** Quit from the app menu › Quit mdpro: L19957 `app.quit.check` `clean`, `dirtyCount:0`; L19968 `app.quit`. `pgrep tauri-app` is empty and `~/.mdpro/drafts` is empty.
- **config.json matches the original.** `keyboardShortcuts` **equals** `$S/asfound.json`. `defaultViewMode` and `lastViewMode` are both `wysiwyg`, the same as before Part A.
- **Clipboard.** It was empty before E1 W. At the end it holds the run's own `hotel`; no user content was printed or kept.
- **Scratch files.** `$S` is left in place: w.md sha1 `c90dcfb1…`, s.md `70b5f711…`. The diffs are also saved as `$S/diff-c-{tw,ts,ew,es}.txt`. Shots: `reports/shots/shortcuts-c-*.png` (16 files).
- **Nothing else changed.** No repo was edited, committed or pushed. No Esc or Enter was pressed in any dialog, panel or menu. There was no ⌘Q, and ⌘Z was used only for CM-C.

## Whole-run summary (macOS, 50c67c5)

| Part | Cases | PASS | FAIL (no binding) | FAIL (OS-owned chord) |
|---|---|---|---|---|
| A app keys | 15 + 4 controls | 12 | 3 (F5, V5, V6) | — |
| B paragraph | 33 + 2 controls | 22 | 9 | 2 (P13 ⌘⌥Q = Quit, W and S) |
| C format/edit | 38 + 2 controls | 14 | 22 | 2 (E11 ⌘H = Hide, W and S) |
| **Total** | **86 + 8 control runs** | **48** | **34** | **4** |

All controls passed in every sitting.
