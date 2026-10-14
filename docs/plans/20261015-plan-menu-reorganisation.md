# Plan: reorganise the native menu bar on macOS and Windows

**Status:** revised after the Codex plan review (2026-10-15, § 9). Decisions taken (§ 0);
no code written.
**Base:** written on `master` @ `74a4804`; the review revision re-checked its citations on
`1d7aa9f`, after #443 moved the app to Tauri 2.12.1 and muda 0.20.0
(`src-tauri/Cargo.lock:2494-2495`). Crate paths are relative to
`~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/`.
**Asked by the user:** 「去看看 Windows 和 macOS 端的 menu item, 看 mark与feature-ledger中一些竞品（如typora）等是怎么组织的，单独形成一个Plan」.
**Evidence:**
[macOS shortcut run](../test/20261014-shortcuts-mac-device-check.md) (build `50c67c5`),
[Windows D190 W1–W5](../test/20261014-d190-w1-w5-windows-device-check.md),
[Windows D190 WI-6/WI-7](../test/20261014-d190-wi6-wi7-windows-device-check.md) and its
[`menus.txt`](../test/windows-audit-20261014-d190-wi6-wi7/menus.txt),
[Windows shortcut run](../test/20261014-shortcuts-windows-device-check.md) (build `50c67c5`),
[ADR-0096](../adr/0096-on-windows-and-linux-ctrl-digits-are-headings-and-ctrl-slash-switches-the-view.md),
[ADR-0090](../adr/0090-windows-and-linux-quit-through-the-quit-guard.md),
[`feature-ledger.md`](../feature-ledger.md) Part 2–3.

## 0. Decisions (2026-10-15)

The user answered the first draft's questions; relayed by the coordinator.

| # | Question | Decision (user's words) | Effect on this plan |
|---|---|---|---|
| D1 | Layout (old Q1, Q5) | 「Typora-style + slim Windows (Recommended)」 | § 5.1 / 5.2 trees stand: Paragraph menu; no app menu and no Window menu off-Mac |
| D2 | Key clashes (old Q2, Q3, Q6) | 「遵循vmark的相关keyboard convention」 | Default keys on **both** platforms follow VMark's `DEFAULT_SHORTCUTS` (§ 5.3). Deviations only where VMark's key is OS-owned or VMark has no binding. Supersedes clauses of ADR-0096 and ADR-0090 (§ 5.3.4) |
| D3 | Items with no command (old Q4, Q8) | 「Show them disabled」 | Greyed out in the menu; shown in Settings as "Not available", not editable. Save As appears disabled, not hidden. Scheduled as WI-M7 |
| D4 | Saved preferences (old Q7) | Plan default | A stored value equal to an old default is migrated to the new default |
| D5 | Label (old Q9) | Plan default | "Settings…" on macOS |
| D6 | Linux (old Q10) | Plan default | Built with the Windows tree; recorded as untested |

## 1. Goal

1. Every command mdpro has is reachable from the menu bar, under the menu a Typora user
   expects, with the key that actually runs it.
2. mdpro's default keys match VMark's on macOS and on Windows/Linux, except where that key
   is owned by the OS.
3. No menu item and no Settings entry advertises a chord the OS owns. Today ⌘⌥Q (Quote)
   quits and ⌘H (Replace) hides the app.
4. Each platform follows its own convention. macOS keeps an app menu. Windows and Linux put
   Settings and Exit in File and About in Help.
5. Nothing silently does nothing. A command missing in the current mode is a disabled menu
   item; a command missing in both modes is a disabled item and a read-only "Not
   available" row in Settings.

## 2. Non-goals

- **No new editor features.** Underline, Image, Clear Format, Math Block,
  Copy as Markdown, Paste as Plain Text, Select Line, Delete Word, Save As, mdpro-owned
  WYSIWYG find, off-Mac full screen and document switching are not built here. They get
  their VMark key and a **disabled** menu item (D3), so building one later only enables it.
- **"No command" means no command in the loaded editors, not "no key today".** The
  inventory is of commands, not of advertised shortcuts. Quote and both lists are **not**
  in the list above: the loaded Milkdown preset already has them
  (`MilkdownEditor.tsx:153-163` loads `mdproCommonmark`, `commonmarkPreset.ts:39-47`;
  `@milkdown/preset-commonmark@7.18.0/lib/index.js:764` blockquote `Mod-Shift-b`, `:1377`
  ordered list `Mod-Alt-7`, `:1273` bullet list `Mod-Alt-8`, `:891` code block `Mod-Alt-c`).
  They are wired to the menu and to their § 5.3.2 key in WYSIWYG (mode: W), not disabled.
  Their old Milkdown keys are a K4 question (§ 5.3.1). Image has no command in either editor
  (only the paste and drop plugins), so it stays disabled.
- **HTML export only.** No PDF, Word or Pandoc items (CLAUDE.md § Constraints).
- No localisation of menu labels, no menu icons.
- No live re-registration of menu accelerators after a rebind (VMark's `accelerators.rs`).
  That stays a follow-up (WI-M8). Rebinding stays `Stub` in that respect (ledger `:416`).

## 3. Current state

### 3.1 How a key reaches a command today

| Platform | Who gets the key first | Source |
|---|---|---|
| macOS | The webview. If the DOM handles the key and calls `preventDefault`, the native menu never sees it ("route H"). Only keys no DOM handler takes reach the menu ("route M"): ⇧⌘N, ⌃2, ⌃4, ⌥⌘T. | `20261014-shortcuts-mac-device-check.md:55` (Finding 1), rows F1–F7, V1–V3, P10 |
| Windows | **Observed:** the webview, while it has focus. WebView2 kept every tested key from Tauri's menu accelerators, so the hook `useKeyboardShortcuts` does the work. **Not a guarantee:** Tauri still runs `TranslateAcceleratorW` on the window's messages (`tauri-2.12.1/src/app.rs:2466-2471`), so when the native window rather than the webview has focus, or for a key no device run pressed, an accelerator can fire. K4 (§ 5.3.1) treats this as an observation per focus context. | `src/hooks/useKeyboardShortcuts.ts:168-171`; `20261014-d190-w1-w5-windows-device-check.md:42` (W1b) |
| Linux | GTK menu accelerators fire, so menu and editor compete for one chord. | ADR-0096 § Context (not device-tested) |

Three keymaps feed the editor, and they are not the Settings list:

- `src/hooks/useKeyboardShortcuts.ts:108-271`: app keys (window listener) plus headings,
  paragraph and link while CodeMirror has focus (`:131-160`).
- `src/plugins/milkdown/typoraKeymapPlugin.ts:164-239`: headings, paragraph, bold, italic,
  inline code, strikethrough, link in WYSIWYG.
- `src/components/Editor/extensions/search.ts:17-20`: CodeMirror `searchKeymap`, which binds
  `Mod-f`, `F3`, `Mod-g`, `Mod-Shift-l`, `Mod-Alt-g`, `Mod-d` and **no** `Mod-h`
  (`node_modules/@codemirror/search/dist/index.js:1030-1037`). The file's own comment
  (`search.ts:10`, "Cmd+H — open Find & Replace panel") is stale.

### 3.2 Every menu item, per platform

Built by `build_menu` (`src-tauri/src/menu.rs:93-217`) and `menu_submenus.rs`. Accelerators
of predefined items come from muda. The table was written against muda 0.17.1; the app now
ships muda 0.20.0 (`Cargo.lock:2494-2495`), whose accelerator table is
`muda-0.20.0/src/items/predefined.rs:615-675` (Undo `:627`, Redo `:629-634`, Cut / Copy /
Paste `:619-621`, Minimize `:638`, Hide `:655`, Hide Others `:656`, Quit `:669`). The keys
are unchanged; `predefined.rs:<n>` line numbers below are 0.17.1's. "W / S" = works in
WYSIWYG / Source. Route H/M per § 3.1.

| Menu › item | id | mac key | Win key | W / S | Device status |
|---|---|---|---|---|---|
| App › About | predefined (`menu.rs:100`) | — | — | n/a | Win: present (L1). mac: not clicked |
| App › Preferences... | `menu.file.preferences` (`menu.rs:102-108`) | ⌘, | Ctrl+, | both | mac F7 PASS (H). Win W1 PASS (H), menu click L2 PASS |
| App › Services | predefined, mac only (`menu.rs:116-118`) | — | absent | n/a | — |
| App › Hide mdpro | predefined (`menu.rs:120`) | **⌘H** (`predefined.rs:330`) | absent | n/a | mac E11: ⌘H hides the app in W and S |
| App › Hide Others | predefined (`menu.rs:121`) | ⌥⌘H (`predefined.rs:331`) | absent | n/a | — |
| App › Show All | predefined (`menu.rs:122`) | — | absent | n/a | — |
| App › Quit (mac) / Exit (Win) | predefined Quit / `menu.app.quit` (`menu.rs:129-138`) | ⌘Q (`predefined.rs:344`) | none | n/a | mac: used to close each sitting. Win W4a–W4e PASS (guarded) |
| App › Stop Waiting and Quit… | `menu.app.stop_waiting_quit` (`menu.rs:139-146`) | none | none | n/a | Win L7 PASS. mac: ledger `:467` Shipped |
| File › New | `menu.file.new` (`menu.rs:149`) | ⌘N | Ctrl+N | both | mac F1 PASS (H). Win W1 PASS (H) |
| File › New Window | `menu.file.new_window` (`menu.rs:150-156`) | ⇧⌘N | Ctrl+Shift+N | both | mac F2 PASS (M). Win W1b PASS (H) |
| File › Open... | `menu.file.open` (`menu.rs:157`) | ⌘O | Ctrl+O | both | mac F3 PASS (H). Win W1 PASS (H) |
| File › Open Recent ▸ | `menu.file.recent.<n>`, `menu.file.recent.empty` (`menu_recent.rs:207-224`) | — | — | both | mac: used in Part A (Finding 4). No "Clear" item |
| File › Save | `menu.file.save` (`menu.rs:158`) | ⌘S | Ctrl+S | both | mac CM-M click + F4 PASS. Win W1, W4e click PASS |
| File › Export HTML... | `menu.file.export_html` (`menu.rs:159-165`) | ⇧⌘E | Ctrl+Shift+E | both | Win W1 PASS (H), L6 click PASS. mac: not in the run |
| File › Close | `menu.file.close` (`menu.rs:166`) | ⌘W | Ctrl+W | both | mac F6 PASS (H). Win W1 PASS (H) |
| Edit › Undo / Redo | predefined (`menu_submenus.rs:18-19`) | ⌘Z / ⇧⌘Z | Ctrl+Z / **Ctrl+Y** (`predefined.rs:311-318`) | both | mac CM-C ⌘Z PASS in S. Ledger `:145` Shipped. Windows: a click is replayed as a synthetic Ctrl+Z / Ctrl+Y through `SendInput` (`muda-0.20.0/src/platform_impl/windows/mod.rs:1151-1158, 1191-1230`), the mechanism of VMark #1354; Tauri documents the items as unsupported on Windows/Linux (`tauri-2.12.1/src/menu/predefined.rs:91, 109`). A predefined item has no accelerator setter, so its Ctrl+Y label cannot become Ctrl+Shift+Z |
| Edit › Cut / Copy / Paste / Select All | predefined (`menu_submenus.rs:21-25`) | ⌘X/C/V/A | Ctrl+X/C/V/A (`predefined.rs:308-321`) | both | Ledger `:146` Shipped. Win: see collision C11 |
| View › Cycle View Mode | `menu.view.cycle` (`menu_submenus.rs:56-62`) | ⌘/ | Ctrl+/ | both | mac V4 PASS. Win K4, W1 PASS |
| View › Source (check) | `menu.view.source` (`menu_submenus.rs:64-71`) | ⌃2 | none (ADR-0096, `:39-47`) | both | mac V1 PASS (M). Win K5 label PASS |
| View › WYSIWYG (check) | `menu.view.wysiwyg` (`menu_submenus.rs:72-79`) | ⌃4 | none | both | mac V2 PASS (M). Win K5 |
| View › Toggle Sidebar | `menu.view.toggle_sidebar` (`menu_submenus.rs:80-86`) | ⇧⌘L | Ctrl+Shift+L | both | mac V3 W and S PASS (H). Win W1 PASS |
| View › Enter Full Screen | inserted by macOS, not by mdpro | fn F | — | n/a | Seen in the run (`…mac-device-check.md:57`) |
| Format › Highlight Selection | `menu.format.highlight` (`menu.rs:184-190`) | ⇧⌘H | Ctrl+Shift+H | both, two syntaxes (ledger `:129` Partial) | Win W1 PASS (H) |
| Format › Insert Table | `menu.format.insert_table` (`menu.rs:191-197`) | ⌥⌘T | Ctrl+Alt+T | **W only** (toast in S, `src/App.tsx:725-733`) | mac P10 PASS (M). Win W1 PASS (H), US layout |
| Theme › Light / Dark / System | `menu.theme.*` (`menu_submenus.rs:98-107`) | none | none | n/a | No checkmark on the active theme. Ledger `:326` Partial |
| Window › Minimize | predefined (`menu_submenus.rs:111`) | ⌘M | Ctrl+M | n/a | Win `menus.txt` |
| Window › Maximize / Zoom | predefined (`menu_submenus.rs:112`) | — | — | n/a | — |
| Window › Close Window | predefined (`menu_submenus.rs:114`) | **⌘W** (`predefined.rs:336-338`) | Alt+F4 | n/a | Duplicates File › Close on mac (C3) |
| Help › mdpro Help | `menu.help.placeholder` (`menu_submenus.rs:118-127`) | — | — | — | Always disabled |

**Count** (separators, Open Recent's children and the macOS-inserted Full Screen item not
counted): **macOS 34** items in 8 top-level menus; **Windows/Linux 30** in the same 8
menus, because the app menu loses Services, Hide, Hide Others and Show All
(`menu_quit.rs:45-47`). The Windows tree matches `menus.txt` line for line.

### 3.3 Settings → Keyboard Shortcuts versus the menu

The page lists 49 entries in five groups (`src/components/common/settings/KeyboardShortcutsSettings.tsx:20-95`).
Defaults live in `src/types/preferences.ts:163-237` and, mirrored, in
`src-tauri/src/models/preferences.rs` (e.g. `:411` `Cmd+H`, `:451` `Cmd+Option+Q`) and
`tests/fixtures/preferences-contract.json` (`$defaultKeyboardShortcuts`).
"Device (mac)" is the 2026-10-14 run on `50c67c5`; it found **48 PASS, 34 no binding,
4 OS-owned** (`…mac-device-check.md:526-533`).

| Settings entry (default, mac) | In a menu? | Bound in W | Bound in S | Device (mac) |
|---|---|---|---|---|
| New, New Window, Open, Save, Close, Preferences | yes | hook | hook | PASS |
| Save As ⇧⌘S | no | — | — | F5 no binding. Ledger `:75` Stub |
| Copy As Markdown, Paste As Plain Text, Select Line, Delete Word | no | — | — | E1–E5 no binding |
| Select Word ⌘D | no | — | CodeMirror `Mod-d` | E4 W no binding |
| Jump to Top / Bottom ⌘↑ / ⌘↓ | no | WebKit native | CodeMirror | PASS |
| Find ⌘F, Find Next ⌘G, Find Previous ⇧⌘G | no | — | CodeMirror | E8–E10 W no binding, S PASS |
| Replace **⌘H** | no | — | — (no `Mod-h`) | **E11 hides mdpro** |
| Heading 1–6 ⌘1–6, Paragraph ⌘0 | no | Milkdown | hook (`useKeyboardShortcuts.ts:138-159`) | P1–P7 PASS both |
| Increase / Decrease Heading ⌘= / ⌘- | no | — | CodeMirror | P8–P9 W no binding, S PASS |
| Table ⌥⌘T | yes (Format) | hook → modal | toast, no-op | P10 PASS |
| Code Fences ⌥⌘C | no | Milkdown keymap `Mod-Alt-c` (preset `:891`) and the input rule | — | P11 W PASS, S no binding |
| Math Block ⌥⌘B | no | — | — | P12 no binding |
| Ordered List ⌥⌘O, Unordered List ⌥⌘U | no | the command exists, under Milkdown's `Mod-Alt-7` / `Mod-Alt-8` (preset `:1377`, `:1273`), not under the advertised key | — | P14, P15 no binding **for the advertised key** |
| Quote **⌥⌘Q** | no | the command exists, under Milkdown's `Mod-Shift-b` (preset `:764`) | — | **P13 runs Quit** in W and S |
| Indent ⌘] / Outdent ⌘[ | no | yes | yes | P16–P17 PASS |
| Bold ⌘B, Italic ⌘I, Code ⇧⌘\`, Strikethrough ⌃⇧\` | no | Milkdown | — | T1–T5 W PASS, S no binding |
| Underline ⌘U, Image ⌃⌘I, Clear Format ⌘\\ | no | — | — | T3, T7, T8 no binding |
| Hyperlink ⌘K | no | Milkdown dialog | hook dialog | T6 PASS both |
| Source ⌃2, WYSIWYG ⌃4, Cycle ⌘/, Toggle Sidebar ⇧⌘L | yes | yes | yes | V1–V4 PASS |
| Toggle Fullscreen ⌥⌘F | no | — | — | V5 no binding |
| Switch Documents ⌘\` | no | — | — | V6 no binding |

The preset also binds `Mod-Alt-0`…`Mod-Alt-6` (paragraph and headings, preset `:505`,
`:655-690`) in WYSIWYG, which no Settings entry lists.

In menus but **not** on the Settings page: Export HTML and Highlight (stored as
`fileExportHtml`, `formatHighlight`, not rendered; ledger `:416`), Open Recent, Theme,
Undo…Select All, the app-menu items and the Window menu.

## 4. Comparison: Typora, VMark, mdpro

Sources:

- **Typora:** `typora/support.typora.io`, `_posts/basic/2019-01-05-Shortcut Keys.md` @
  `3858b86` (2025-07-13; page `last_modified_at: 2025-04-05`). It confirms the group names
  File / Edit / Paragraph / Format / View and every key quoted below. **Unverified:** the
  Themes, Window and Help menus, the app menu contents, where Preferences sits on each
  platform, and whether Typora's mac Hide item keeps ⌘H. They come from memory of the app,
  not from a source I could read.
- **VMark:** `xiaolai/vmark` @ `e0a982d` (2026-10-13), `src-tauri/src/menu/localized.rs`
  and `src-tauri/src/menu/localized/*.rs`, read through `gh api`.

### 4.1 Top-level layout

| Position | Typora mac | Typora Win (unverified) | VMark mac | VMark Win/Linux | mdpro mac | mdpro Win |
|---|---|---|---|---|---|---|
| 0 | Typora | — | VMark | — | mdpro | **mdpro** |
| 1 | File | File | File | File | File | File |
| 2 | Edit | Edit | Edit | Edit | Edit | Edit |
| 3 | Paragraph | Paragraph | Format | Format | View | View |
| 4 | Format | Format | Insert | Insert | Format | Format |
| 5 | View | View | View | View | Theme | Theme |
| 6 | Themes | Themes | Window | — | Window | **Window** |
| 7 | Window | — | Help | Help | Help | Help |
| 8 | Help | Help | | | | |

VMark's split by platform is explicit: the app menu and the Window menu are
`#[cfg(target_os = "macos")]` (`localized.rs:31-32, 90-131`). Off-Mac, Settings, "Save All
and Exit" and Exit sit at the end of File (`localized/file_menu.rs:145-182`), and About
moves to the end of Help (`localized/window_help_menu.rs`, "on non-macOS the About item
lives here because there is no App menu").

### 4.2 The differences that decide this plan

1. **mdpro has no Paragraph menu.** Typora and VMark both expose headings, lists, quote and
   code blocks in a menu. VMark nests them as Format › Headings / Lists / Blockquote
   submenus (`localized/format_submenus.rs`). mdpro's Settings groups already copy
   Typora's names (`KeyboardShortcutsSettings.tsx:20-95`), so Typora's layout costs no
   relabelling.
2. **mdpro copies the macOS app menu to Windows.** Ledger `:480` records it ("结构照搬
   macOS（含「mdpro」应用菜单，W7）"). Neither competitor does this.
3. **VMark's menu accelerators follow the user's rebinding.** `create_localized_menu`
   resolves every accelerator through a custom map (`localized.rs:51-90`) and
   `accelerators.rs` diffs changes into the live menu. mdpro's menu keys are literals in
   `menu.rs`, separate from `preferences.ts`; rebinding never reaches the menu (ledger
   `:416`).
4. **VMark avoids predefined clipboard items on Windows.** Its comment
   (`localized/edit_menu.rs:209-222`, issue #1354) says muda's predefined Cut / Copy /
   Paste / Select All put Ctrl+X/C/V/A into the Win32 accelerator table and re-emit them
   with `SendInput`, which desyncs WebView2's modifier state (lost characters, broken IME).
   mdpro uses those predefined items on Windows (`menu_submenus.rs:21-25`). **Not observed
   in mdpro yet**; it is a spike item (WI-M2).
5. **Typora uses a different chord family off-Mac.** Its macOS ⌘⌥ chords become Ctrl+Shift
   or plain Ctrl on Windows: Table Ctrl+T, Code Fences Ctrl+Shift+K, Math Ctrl+Shift+M,
   Quote Ctrl+Shift+Q, lists Ctrl+Shift+[ / ], Image Ctrl+Shift+I, Find Next F3, Jump
   Ctrl+Home / Ctrl+End, Full Screen F11, Switch Documents Ctrl+Tab. mdpro maps ⌘⌥ to
   Ctrl+Alt (`useKeyboardShortcuts.ts:74-80`), which is AltGr on many European layouts.
6. **Typora keeps ⌘H for Replace and ⌥⌘Q for Quote on macOS; so does VMark for Quote**
   (`localized/format_submenus.rs:161-164`). VMark binds Find & Replace
   to ⌘F as one item and keeps ⌘H for Hide. Whether an explicit ⌥⌘Q **menu item** beats the
   Quit behaviour mdpro hit is unverified (WI-M2).

## 5. Proposed design

### 5.1 macOS menu tree

Keys are the proposed defaults of § 5.3. Every item carries its own annotation; an item
without one works in both modes. *(W)* = enabled only in WYSIWYG, *(S)* = enabled only in
Source, *(n/a)* = disabled in both modes until the command is built (D3). The trees are
rendered from the availability table of § 5.5, not maintained by hand; where they differ,
the table wins.

```
mdpro      About mdpro · — · Settings… ⌘, · — · Services ▸ · — · Hide mdpro ⌘H ·
           Hide Others ⌥⌘H · Show All · — · Quit mdpro ⌘Q · Stop Waiting and Quit…
File       New ⌘N · New Window ⇧⌘N · — · Open… ⌘O · Open Recent ▸ · — · Close ⌘W ·
           — · Save ⌘S · Save As… ⇧⌘S (n/a) · — · Export HTML… ⇧⌘E
Edit       Undo ⌘Z · Redo ⇧⌘Z · — · Cut · Copy · Paste · Copy as Markdown ⇧⌘C (n/a) ·
           Paste as Plain Text ⇧⌘V (n/a) · Select All · — ·
           Selection ▸ [Select Line ⌘L (n/a) · Select Word ⌘D (S) · Delete Word (n/a)] · — ·
           Find ▸ [Find and Replace… ⌘F (S) · Find Next ⌘G (S) · Find Previous ⇧⌘G (S)]
Paragraph  Heading 1…6 ⌘1…⌘6 · Paragraph ⇧⌘0 · — ·
           Increase Heading ⌥⌘] (S) · Decrease Heading ⌥⌘[ (S) · — ·
           Table… ⇧⌘T (W) · Code Fences ⌥⌘C (W) · Math Block ⌥⇧⌘M (n/a) ·
           Quote (key: open question 1) (W) · — · Ordered List ⌥⌘O (W) · Unordered List ⌥⌘U (W) · — ·
           Indent ⌘] · Outdent ⌘[
Format     Bold ⌘B (W) · Italic ⌘I (W) · Underline ⌘U (n/a) · Code ⇧⌘` (W) · Strikethrough ⇧⌘X (W) ·
           Highlight ⇧⌘M · — · Link… ⌘K · Image… ⇧⌘I (n/a) · — · Clear Format ⌘\ (n/a)
View       Source ⌃2 · WYSIWYG ⌃4 · Toggle Source Mode F6 · — · Toggle Sidebar ⌃⇧0 ·
           Switch Documents ⌃Tab (n/a) · — · (Enter Full Screen fn F, inserted by macOS)
Themes     Light · Dark · System   (check items, the active one ticked)
Window     Minimize ⌘M · Zoom · — · Bring All to Front   (Close Window removed)
Help       Keyboard Shortcuts… (opens Settings › Keyboard Shortcuts)   (disabled placeholder removed)
```

Against § 3.2: Paragraph menu added; Format gains the marks, Link and the disabled items;
Edit gains Selection and Find; Insert Table moves to Paragraph; Window loses the duplicate
⌘W item (C3) and gains Bring All to Front (`predefined.rs:170`); Themes gets checkmarks;
Help gets one live item; "Preferences…" becomes "Settings…" (D5).

### 5.2 Windows and Linux menu tree

```
File       New Ctrl+N · New Window Ctrl+Shift+N · — · Open… Ctrl+O · Open Recent ▸ · — ·
           Save Ctrl+S · Save As… Ctrl+Shift+S (n/a) · — · Export HTML… Ctrl+Shift+E · — ·
           Settings… Ctrl+, · — · Close Ctrl+W · Exit Ctrl+Q · Stop Waiting and Exit…
Edit       Undo Ctrl+Z · Redo Ctrl+Shift+Z   (custom items, § 5.7) · — · Cut · Copy · Paste ·
           Copy as Markdown (n/a) · Paste as Plain Text (n/a) · Select All · — ·
           Selection ▸ (as macOS) · — ·
           Find ▸ [Find and Replace… Ctrl+F (S) · Find Next Ctrl+G (S) · Find Previous Ctrl+Shift+G (S)]
Paragraph  as macOS, same annotations, Ctrl for ⌘ and Alt for ⌥: Heading Ctrl+1…6 ·
           Paragraph Ctrl+Shift+0 · Increase / Decrease Heading Ctrl+Alt+] / [ (S) ·
           Table… Ctrl+Shift+T (W) · Code Fences Ctrl+Alt+C (W) · …
Format     Bold Ctrl+B (W) · Italic Ctrl+I (W) · Underline Ctrl+U (n/a) · Code Ctrl+Shift+` (W) ·
           Strikethrough Ctrl+Shift+X (W) · Highlight Ctrl+Shift+M · — · Link… Ctrl+K ·
           Image… Ctrl+Shift+I (n/a) · — · Clear Format Ctrl+\ (n/a)
View       Toggle Source Mode F6 · Source · WYSIWYG · — · Toggle Sidebar Alt+Shift+0 ·
           Switch Documents (n/a, no key shown) · Full Screen (n/a)
Themes     Light · Dark · System
Help       Keyboard Shortcuts… · — · About mdpro
```

- **No app menu and no Window menu** (D1). Settings, Exit and the escape item move to
  File; About moves to Help, as in VMark (`localized.rs:90-131`).
- **Exit gets Ctrl+Q**, VMark's key (`localized/file_menu.rs:178-181`). This supersedes
  ADR-0090's "Exit has no accelerator" (`docs/adr/0090-…md:78-79`). The escape item keeps
  no key (ADR-0036 § 3) and still directly follows Exit.
- Source and WYSIWYG keep no accelerator off-Mac (ADR-0096 stands for these two items).
- **Every key shown must also be bound in the DOM**: in every tested focus context, a menu
  accelerator did not fire on Windows (§ 3.1). Ctrl+Q and F6 are new hook bindings.
  **Ctrl+Tab is not bound** while Switch Documents has no command: a key that is consumed
  and does nothing is the silent failure Goal 5 forbids. Until then the key passes through
  to the webview, and the Settings row shows "Not available" (§ 5.5).
- **Native behaviour that already works is stated, not hidden** (Windows shortcut run
  `:106, 112-114, 134-135`): in WYSIWYG, Ctrl+F / Ctrl+G open and step WebView2's own find
  bar, and Ctrl+Shift+V pastes plain text natively in both editors. The Find items stay
  *(S)*, because the menu cannot drive WebView2's find bar. The Settings rows say
  "WYSIWYG: browser find bar" and "native" rather than "Not available". The key is not
  suppressed (open question 7).

### 5.3 Accelerator policy: follow VMark

**Source of VMark's keys:** `xiaolai/vmark` @ `e0a982d`,
`src/stores/settingsStore/shortcutDefinitions.ts:44-215` (`DEFAULT_SHORTCUTS`, its stated
source of truth), `website/guide/shortcuts.md`, and its rule
`.claude/rules/41-keyboard-shortcuts.md`. VMark's notation: `Mod` = ⌘ on macOS and Ctrl
elsewhere; `Alt` = ⌥. A key differs by platform only where an entry sets
`defaultKeyOther` (e.g. Toggle Sidebar ⌃⇧0 → Alt+Shift+0, because Ctrl+Shift+0 is
Paragraph off-Mac, `shortcutDefinitions.ts:130`). Undo, Redo and Quit are menu items with
fixed keys (`localized/edit_menu.rs:194-206`, `file_menu.rs:178-181`).

#### 5.3.1 Rules

| # | Rule | Why |
|---|---|---|
| K1 | **Default = VMark's default for the same action**, on both platforms, read from the pinned SHA above. `Mod` → ⌘ / Ctrl, `Alt` → ⌥ / Alt. VMark's `defaultKeyOther` applies off-Mac. | D2 |
| K2 | **VMark has no binding for the action:** keep mdpro's key if it is not OS-owned and not used by VMark for another action; otherwise leave it unassigned. | D2, closest consistent choice |
| K3 | **VMark's key is OS-owned on a platform:** keep VMark's key only if the WI-M2 spike shows mdpro's explicit item wins, **with the item enabled and with it disabled**. The chord then goes on K5's exception list by name. Otherwise it is unassigned on that platform, and the action stays menu-only. | ⌘H / ⌥⌘Q device results |
| K4 | **One owner per chord, per platform and per focus context** (editor W, editor S, modal or Settings input, shortcut recorder, native window or menu focus). Exactly one keymap acts on a chord in each context. The menu shows the chord, and handles it only where no DOM keymap does. A key the loaded editors already bind for another purpose is **removed or rebound in the same WI** that assigns the chord: CodeMirror's fold keys (C12), the table arrows against add-cursor (open question 5), and Milkdown's `Mod-Shift-b` / `Mod-Alt-0…8` once the menu owns Quote, lists and headings. The § 3.1 routing is an observation per context, not an event-order guarantee; the tests and device checks cover every context listed here. | § 3.1, review #2, #12 |
| K5 | **No OS-owned default for an editor command.** macOS: ⌘H, ⌥⌘H, ⌘M, ⌘Q, ⌥⌘Q, ⌃⌘F, ⌘\`, ⌘Tab, ⌘Space, ⇧⌘Q, ⇧⌘3/4/5. Windows/Linux: Win-key chords, Alt+F4. **Native items keep their OS key**: Quit ⌘Q, Hide ⌘H, Hide Others ⌥⌘H, Minimize ⌘M and the macOS-inserted Full Screen are not editor commands. A test pins the list (WI-M1a), checks only editor-command defaults, and accepts a K3 exception only by name. | C1, C2, C4, C5 |
| K6 | **Menu label, binding and availability come from one command table**, per platform. Its format is fixed in § 5.5. | `menu.rs` literals and `preferences.ts` are independent today |
| K7 | **mdpro does not track VMark automatically.** A later VMark change is adopted by a new plan row, not by re-syncing. | A pinned SHA is reviewable; a moving target is not |
| K8 | **A key matches on what the user pressed, for both shifted digits and symbols.** For a binding with Shift and a digit or symbol, the matcher also accepts the physical key (`event.code` `Digit0`, `BracketRight`, …), because ⇧0 arrives as `event.key ")"` on US layouts. A binding without Shift keeps today's logical match and the D190-WI-7 relaxed pass. AltGr stays refused off-Mac (`useKeyboardShortcuts.ts:69-72`). VMark does the same through `matchesShiftedSymbol` and its `event.code` fallback (`src/utils/shortcutMatch.ts` @ `e0a982d`). | Review #13: today ⇧⌘0 / Ctrl+Shift+0 / ⌃⇧0 / Alt+Shift+0 never match (`useKeyboardShortcuts.ts:91-103`) |

#### 5.3.2 Side by side

51 rows: the 49 Settings entries (Heading 1–6 as one row), the 6 hidden table keys as two
rows, plus Undo, Redo, Export HTML, Quit / Exit and Open Quickly. "mdpro today Win" is what
runs or is shown there (`platformLabels.ts:36-58`, `predefined.rs:306-346`).
**Bold** in the last column = a change from today.

| Action | VMark mac | VMark Win | mdpro today mac | mdpro today Win | Proposed mac / Win | Note |
|---|---|---|---|---|---|---|
| New | ⌘N | Ctrl+N | ⌘N | Ctrl+N | ⌘N / Ctrl+N | |
| New Window | ⇧⌘N | Ctrl+Shift+N | ⇧⌘N | Ctrl+Shift+N | same | |
| Open | — (⌘O is Quick Open; Open File is menu-only) | — | ⌘O | Ctrl+O | ⌘O / Ctrl+O | K2: mdpro has no Quick Open, so ⌘O keeps its meaning |
| Open Quickly (hidden entry) | ⌘O | Ctrl+O | ⇧⌘O | Ctrl+Shift+O | **— / —** | K2: VMark's ⇧⌘O is Open Workspace; no command in mdpro |
| Save | ⌘S | Ctrl+S | ⌘S | Ctrl+S | same | |
| Save As | ⇧⌘S | Ctrl+Shift+S | ⇧⌘S | Ctrl+Shift+S | same, disabled (D3) | |
| Close | ⌘W | Ctrl+W | ⌘W | Ctrl+W | same | C3 drops the second ⌘W item |
| Settings | ⌘, | Ctrl+, | ⌘, | Ctrl+, | same | |
| Export HTML | — (menu only) | — | ⇧⌘E | Ctrl+Shift+E | ⇧⌘E / Ctrl+Shift+E | K2: device-verified on both; VMark does not use the chord |
| Quit / Exit | ⌘Q | Ctrl+Q | ⌘Q | none | ⌘Q / **Ctrl+Q** | Supersedes ADR-0090 clause |
| Undo | ⌘Z | Ctrl+Z | ⌘Z | Ctrl+Z | same | |
| Redo | ⇧⌘Z | Ctrl+Shift+Z | ⇧⌘Z | Ctrl+Y | ⇧⌘Z / **Ctrl+Shift+Z** | Off-Mac this needs custom Undo / Redo items (§ 5.7, C14). Ctrl+Y stays a working second key if both editors still accept it (the review reports they do; M6 tests it) |
| Copy As Markdown | ⇧⌘C (Copy as HTML) | Ctrl+Shift+C | ⇧⌘C | Ctrl+Shift+C | same, disabled | Same chord, VMark's action differs |
| Paste As Plain Text | ⇧⌘V | Ctrl+Shift+V | ⇧⌘V | Ctrl+Shift+V | same, disabled | |
| Select Line | ⌘L | Ctrl+L | ⌘L | Ctrl+L | same, disabled | |
| Select Word | ⌘D (Select Next Occurrence) | Ctrl+D | ⌘D | Ctrl+D | same | CodeMirror's `Mod-d` already is VMark's action |
| Delete Word | — (⇧⌘D = Skip Occurrence) | — | ⇧⌘D | Ctrl+Shift+D | **— / —**, disabled | K2: VMark spends the chord elsewhere |
| Jump to Top / Bottom | — (native) | — | ⌘↑ / ⌘↓ | Ctrl+↑ / Ctrl+↓ | **system** ⌘↑ ⌘↓ / Ctrl+Home Ctrl+End, not editable | K2: native editing keys, no menu item |
| Find (and Replace) | ⌘F | Ctrl+F | ⌘F | Ctrl+F | same | VMark has one Find and Replace item |
| Find Next | ⌘G | Ctrl+G | ⌘G | Ctrl+G | same | Replaces the first draft's F3 |
| Find Previous | ⇧⌘G | Ctrl+Shift+G | ⇧⌘G | Ctrl+Shift+G | same | |
| Replace | — (part of ⌘F) | — | ⌘H (hides the app) | Ctrl+H | **— / —** | C2: merged into Find and Replace ⌘F. The `editReplace` field is kept, deprecated, with the `merged` state of § 5.6 |
| Heading 1–6 | ⌘1–6 | Ctrl+1–6 | ⌘1–6 | Ctrl+1–6 | same | ADR-0096 unchanged |
| Paragraph | ⇧⌘0 | Ctrl+Shift+0 | ⌘0 | Ctrl+0 | **⇧⌘0 / Ctrl+Shift+0** | Needs K8 (C13). Open question 4 (Windows) |
| Increase Heading | ⌥⌘] | Ctrl+Alt+] | ⌘= | Ctrl+= | **⌥⌘] / Ctrl+Alt+]** | VMark uses ⌘= for zoom. Collides with CodeMirror's fold keys in S (C12) |
| Decrease Heading | ⌥⌘[ | Ctrl+Alt+[ | ⌘- | Ctrl+- | **⌥⌘[ / Ctrl+Alt+[** | C12 |
| Table | ⇧⌘T | Ctrl+Shift+T | ⌥⌘T | Ctrl+Alt+T | **⇧⌘T / Ctrl+Shift+T** | Replaces the device-verified Ctrl+Alt+T |
| Code Fences | ⌥⌘C | Ctrl+Alt+C | ⌥⌘C | Ctrl+Alt+C | same | |
| Math Block | ⌥⇧⌘M | Ctrl+Alt+Shift+M | ⌥⌘B | Ctrl+Alt+B | **⌥⇧⌘M / Ctrl+Alt+Shift+M**, disabled | VMark's ⌥⌘B is Bookmark |
| Quote | ⌥⌘Q | Ctrl+Alt+Q | ⌥⌘Q (runs Quit) | Ctrl+Alt+Q | **open** / Ctrl+Alt+Q, (W) | K3, open question 1. Milkdown's blockquote command, today under `Mod-Shift-b` |
| Ordered List | ⌥⌘O | Ctrl+Alt+O | ⌥⌘O | Ctrl+Alt+O | same, (W) | Milkdown's command, today under `Mod-Alt-7` |
| Unordered List | ⌥⌘U | Ctrl+Alt+U | ⌥⌘U | Ctrl+Alt+U | same, (W) | Milkdown's command, today under `Mod-Alt-8` |
| Indent | ⌘] | Ctrl+] | ⌘] | Ctrl+] | same | |
| Outdent | ⌘[ | Ctrl+[ | ⌘[ | Ctrl+[ | same | |
| Bold | ⌘B | Ctrl+B | ⌘B | Ctrl+B | same | |
| Italic | ⌘I | Ctrl+I | ⌘I | Ctrl+I | same | |
| Underline | ⌘U | Ctrl+U | ⌘U | Ctrl+U | same, disabled | |
| Code | ⇧⌘\` | Ctrl+Shift+\` | ⇧⌘\` | Ctrl+Shift+\` | same | ADR-0096 unchanged |
| Strikethrough | ⇧⌘X | Ctrl+Shift+X | ⌃⇧\` | Alt+Shift+5 | **⇧⌘X / Ctrl+Shift+X** | Supersedes ADR-0096's strikethrough clause |
| Hyperlink | ⌘K | Ctrl+K | ⌘K | Ctrl+K | same | |
| Image | ⇧⌘I | Ctrl+Shift+I | ⌃⌘I | shown as Ctrl+I (= Italic) | **⇧⌘I / Ctrl+Shift+I**, disabled | Fixes C6 |
| Highlight | ⇧⌘M | Ctrl+Shift+M | ⇧⌘H | Ctrl+Shift+H | **⇧⌘M / Ctrl+Shift+M** | Also hardcoded in Source: `highlightPlugin.ts:65-68` `Mod-Shift-h`, and the menu literal `menu.rs:189` |
| Clear Format | ⌘\\ | Ctrl+\\ | ⌘\\ | Ctrl+\\ | same, disabled | |
| Source | — | — | ⌃2 | none (ADR-0096) | ⌃2 / none | K2: VMark has no direct-mode key; ⌃2 is free in VMark |
| WYSIWYG | — | — | ⌃4 | none | ⌃4 / none | K2 |
| Toggle Source Mode (Cycle) | F6 | F6 | ⌘/ | Ctrl+/ | **F6 / F6** | Supersedes ADR-0096's Ctrl+/ clause; open question 2. The recorder refuses a key with no modifier (`platformLabels.ts:72-74`), so M7 lets it record F1–F12 alone |
| Toggle Sidebar | ⌃⇧0 | Alt+Shift+0 | ⇧⌘L | Ctrl+Shift+L | **⌃⇧0 / Alt+Shift+0** | Frees ⇧⌘L for CodeMirror's select-all-matches (C11); the key is VMark's. Needs K8 (C13). VMark binds it in its keymap only and has no Toggle Sidebar menu item (`shortcutDefinitions.ts:134`: a Rust accelerator would clash with Paragraph's Mod-Shift-0 off-Mac). mdpro keeps the menu item, because its off-Mac key is Alt+Shift+0, not Ctrl+Shift+0, so the clash does not arise. Changes ADR-0088's tooltip text |
| Toggle Fullscreen | system item (⌃⌘F) | none | ⌥⌘F (unbound) | Ctrl+Alt+F (unbound) | **system fn F / —**, disabled off-Mac (VMark also relies on the system-added fn F item) | C5 |
| Switch Documents | ⌃Tab (Last Used Tab) | Ctrl+Tab | ⌘\` (macOS window cycling) | Ctrl+\` | **⌃Tab / Ctrl+Tab** reserved, disabled, **not bound** | C4. The key is stored as the future default but no keymap consumes it until the command exists (§ 5.2) |
| Table: insert row above / below, column left / right | — | — | ⌥⌘↑ ↓ ← → | Ctrl+Alt+arrows | same | K2. VMark's ⌥⌘↑/↓ is Add Cursor; CodeMirror binds it too (`@codemirror/commands/dist/index.js:1747-1748`). Open question 5 |
| Table: delete row / column | — | — | ⌥⌘⌫ / ⌥⇧⌘⌫ | Ctrl+Alt+Backspace / +Shift | same | K2 |

#### 5.3.3 Where following VMark still leaves a choice

- **Quote ⌥⌘Q** is VMark's key and quit mdpro on device (P13). K3 decides it after the
  WI-M2 spike. Open question 1.
- **F6** needs Fn on a Mac keyboard unless "Use F1, F2… as standard function keys" is on
  (VMark's own guide says so). Open question 2: keep ⌘/ / Ctrl+/ as a fixed second key?
- **Ctrl+Alt chords off-Mac** (Code Fences, lists, Quote, heading level, Math, table keys)
  are AltGr on many European layouts. mdpro's matcher refuses AltGr
  (`useKeyboardShortcuts.ts:69-72`); VMark has no AltGr handling in
  `src/utils/shortcutMatch.ts`. Open question 3.
- **Ctrl+Shift+0** (Paragraph, Windows): some Windows installs give it to the input
  language hotkey. From memory, not checked. Open question 4.

#### 5.3.4 What this does to ADR-0096 and ADR-0090

| Clause | Windows device case (`20261014-d190-wi6-wi7-windows-device-check.md:28-32`) | Changes? |
|---|---|---|
| ADR-0096: Ctrl+1–6 are headings off-Mac | K3 PASS | **No** |
| ADR-0096: inline code Ctrl+Shift+\` off-Mac | K1 PASS | **No** |
| ADR-0096: Source / WYSIWYG items carry no key off-Mac | K5 PASS | **No** |
| ADR-0096: strikethrough Alt+Shift+5 off-Mac, ⌃⇧\` on macOS | K2 PASS | **Yes** → ⇧⌘X / Ctrl+Shift+X |
| ADR-0096: view switch is Ctrl+/ off-Mac | K4 PASS | **Yes** → F6 (unless open question 2 keeps Ctrl+/ as a second key) |
| ADR-0090: Exit has no accelerator | (W4: Exit itself verified) | **Yes** → Ctrl+Q |

A new ADR (WI-M0) records D2 and supersedes those three clauses by name. ADR-0096 and
ADR-0090 get only a forward link in their Status lines (CLAUDE.md § ADR).

### 5.4 Collisions and defects to fix

| # | Defect | Source | Fix | WI |
|---|---|---|---|---|
| C1 | ⌥⌘Q (Quote) runs Quit | `preferences.ts:200`, `preferences.rs:451`; device P13 W/S (`…mac-device-check.md:136, 212, 274`) | K3 after the M2 spike; meanwhile Paragraph › Quote is enabled in W with no key on macOS | M2, M1b |
| C2 | ⌘H (Replace) hides mdpro; CodeMirror has no `Mod-h` either | `preferences.ts:185`, `preferences.rs:411`; `predefined.rs:330`; `search/dist/index.js:1030-1037`; device E11 (`:401, 471`) | Replace merges into Find and Replace ⌘F (VMark). Fix the stale comment `search.ts:10` | M1b |
| C3 | ⌘W on two mac items: File › Close and Window › Close Window | `menu.rs:166`; `menu_submenus.rs:114`; `predefined.rs:336-338` | Drop the predefined Close Window on macOS | M1b |
| C4 | Switch Documents ⌘\` is macOS window cycling | `preferences.ts:226`; device V6 (`:49`) | ⌃Tab / Ctrl+Tab (VMark), item disabled | M1b |
| C5 | Toggle Fullscreen ⌥⌘F binds nothing; macOS supplies ⌃⌘F / fn F | `preferences.ts:225`; `predefined.rs:326-329`; device V5 (`:48, 57`) | macOS: system item, entry shown "(system)"; off-Mac: disabled | M1b, M7 |
| C6 | Off-Mac, Image `Cmd+Ctrl+I` shows as "Ctrl+I", the Italic key | `preferences.ts:213`; `platformLabels.ts:36-40`; `…wi6-wi7…:91` | ⇧⌘I / Ctrl+Shift+I (VMark) | M1b |
| C7 | Off-Mac, ⌥⌘ chords are Ctrl+Alt = AltGr on international layouts | `preferences.ts:197-202, 231-236`; `useKeyboardShortcuts.ts:69-80` | Follows VMark (keeps Ctrl+Alt). Open question 3 | M6 |
| C8 | Help › mdpro Help is permanently disabled | `menu_submenus.rs:118-127` | Replace with Keyboard Shortcuts… | M4 |
| C9 | Themes has no checkmark | `menu_submenus.rs:98-107` | `CheckMenuItem`, as View already does (`:63-79`) | M4 |
| C10 | Windows predefined clipboard items enter the Win32 accelerator table; VMark #1354 saw lost keys and broken IME from it | `menu_submenus.rs:21-25`; `predefined.rs:308-321`; VMark `localized/edit_menu.rs:209-222` | Follow VMark: accelerator-free custom Cut / Copy / Paste / Select All **on Windows only** (VMark's override is Windows-only; Linux keeps the predefined items), routed to the clipboard path. M2 records whether mdpro showed the symptom | M5 |
| C11 | ⇧⌘L also matches CodeMirror `Mod-Shift-l` | `index.js:1035` | Gone once Toggle Sidebar moves to ⌃⇧0 | M1b |
| C12 | The new heading-level keys are CodeMirror fold keys: ⌥⌘[ / ] fold / unfold code on macOS, Ctrl+Alt+[ / ] fold / unfold all off-Mac; the basic setup loads `foldKeymap` | `@codemirror/language/dist/index.js:1502-1506`; `@uiw/codemirror-extensions-basic-setup/esm/index.js:65-66` | Pass `foldKeymap: false` to the basic setup and re-add fold under its off-Mac keys only (Ctrl+Shift+[ / ]), or drop fold keys. A composed-keymap test proves one action per chord in S (K4) | M1b |
| C13 | Shift+digit and shifted-symbol bindings never match: ⇧0 arrives as `event.key ")"` | `useKeyboardShortcuts.ts:91-103`; review #13 (the matcher run in memory) | K8: physical-key fallback for Shift bindings | M1a |
| C14 | Off-Mac predefined Undo / Redo: a click is replayed as synthetic Ctrl+Z / Ctrl+Y through `SendInput`, Tauri documents them as unsupported, and the label cannot become Ctrl+Shift+Z | § 3.2 Undo / Redo row | Custom Undo / Redo items routed to the focused editor's history (§ 5.7) | M5 |
| C15 | The Insert Table dialog title hardcodes `⌘⌥T` on every platform | `src/components/Editor/TableInsertModal/index.tsx:191`; Windows shortcut run `:75` (the delegator's P10 item) | Render the effective chord for the platform from the command table | M1b |
| C16 | WebView2 owns some browser keys: Ctrl+Shift+I may open DevTools depending on build and settings; F6 moves focus between browser panes | `wry-0.57.0/src/webview2/mod.rs:649-651` (`SetAreBrowserAcceleratorKeysEnabled`); [Microsoft's WebView2 shortcut list](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/browser-features#additional-keyboard-shortcuts-information) | M2 probes release and dev builds. Ctrl+Tab and Ctrl+Shift+T are not assumed taken, because WebView2 turns their browser actions off | M2, M6 |

### 5.5 Command table, availability and dispatch

**One command table** (K6) is the source for the menu trees, the default keys, the Settings
page and the dispatcher. It lives in TypeScript (`src/commands/commandTable.ts`, new). Rust
gets the menu part as a generated, committed JSON file (`src-tauri/src/menu_layout.json`,
`include_str!`). A parity test fails when the two are out of step. Each row has:

| Field | Values |
|---|---|
| `id` | stable command id, e.g. `paragraph.quote`; the `MENU_*` id and the preferences field are derived from it, or listed beside it |
| `menu` | path per platform (`macos`, `windows`, `linux`), or `none` |
| `key` | default per platform; `fixed` (Undo, Redo, Quit, Exit: not editable) or `configurable` |
| `availability` | `both` / `W` / `S` / `none` |
| `route` | `frontend` (a `menu:action` the dispatcher runs), `native` (a predefined item; no log line from the frontend), `rust-quit` (Exit and the escape item, handled in Rust, logged there), `unavailable` (never dispatched) |
| `nativeBehaviour` | optional text for Settings, e.g. "WYSIWYG: browser find bar" (§ 5.2) |

- **Routes are exhaustive.** The dispatcher and the Rust id → action map both `match` on
  `route` without a wildcard arm (rule 60 § Enum completeness). An `unavailable` id is
  present, disabled, and refused with a log line if a stale event ever carries it.
- **Ledger discovery**: the ledger scanner reads `MENU_*` ids from `menu.rs` only
  (`scripts/ledger/declared.mjs:95-98`). The WI that moves ids out of `menu.rs` extends
  the scanner to the new file in the same commit.
- **Availability follows the focused window.** Rust keeps one "last view mode reported by
  any window" today (`menu_recent.rs:50-54, 112-128`), and focusing a window does not
  refresh it. The menu is app-wide on macOS. The menu state becomes per window: each window
  reports its mode on focus and on every mode change, and Rust re-enables items from the
  **focused** window's mode. A window that closes or never reported leaves the items
  enabled as `both` would, with a log line. Off-Mac the plan keeps one app-wide menu as
  today; per-window menus are not needed, because each window's hook checks its own mode
  before it acts.
- **Settings shows capability, not the current mode.** Each row says "WYSIWYG only",
  "Source only", "Not available" or its `nativeBehaviour` text, whatever mode the window is
  in (M7).

### 5.6 Stored preferences: migration and the new states

The preferences live in `~/.mdpro/config.json` on every platform. Rust loads them and
repairs them (`services/preferences.rs:85-100`). The frontend has its own defaults
(`preferencesService.ts:110-129`) and hydrates them twice (`App.tsx:217-218`, Settings).

- **One migration boundary: Rust's load path.** A `keyboardShortcutsVersion` field
  (absent = 1) marks the table. On load, version 1 → 2 replaces each value that equals a
  version-1 default with the version-2 default, keeps every other value, and writes the
  file back once, under `preferences_rw_lock` (`services/preferences.rs:43-48`, which today
  serialises only `set_preferences` and `save_window_state`; the migrating load takes it
  too, so two windows starting at once migrate once). A failed write leaves the in-memory
  result migrated and retries on the next load. A corrupt file follows today's parse-error
  path unchanged. A second load is a no-op. A downgraded build reads version 2 as it reads
  any file, and keeps the migrated values, which it treats as custom. That is the accepted
  cost. The frontend never migrates.
- **Collisions are refused, not introduced.** After migration, each chord is normalised
  per platform (`Cmd+I` and `Cmd+Ctrl+I` off-Mac are the same chord, C6). If a kept custom
  value now collides with a new default, for example a custom Save on ⇧⌘T against Table,
  the **default** loses: that command is stored `unassigned`, and Settings shows the
  conflict once. The custom value is never changed. Settings' own conflict check
  (`KeyboardShortcutsSettings.tsx:124-134, 183-191`) uses the same normalisation and
  refuses Save on a conflict between available commands.
- **New persisted states.** Today an empty string is repaired to the default on every read
  (`models/preferences.rs:310-352`, ADR-0031 step 4, decision D-b, whose recorded cost
  says reversing it needs a new ADR). The new states are explicit values, not `""`:
  `"<unassigned>"`, `"<system>"` (Jump to Top / Bottom, mac Full Screen) and
  `"<merged:editFind>"` (Replace). `""` keeps its ADR-0031 meaning. Reset restores the
  table's default, which may itself be `<unassigned>`. The M0 ADR supersedes ADR-0031's
  clause by name.
- **Fields are kept, never deleted.** `editReplace`, `viewToggleFullscreen` and the rest
  stay in the contract (`tests/fixtures/preferences-contract.json`) with their new state,
  so an older build can still read the file.

### 5.7 Undo / Redo, clipboard and Exit off-Mac

- **Undo / Redo (C14).** Off-Mac they become custom `MenuItem`s, `route: frontend`, with
  fixed keys Ctrl+Z / Ctrl+Shift+Z, as VMark does (`localized/edit_menu.rs:194-206`). A click
  runs the focused editor's history command: Milkdown's history `undo` / `redo` in W,
  CodeMirror's in S. The keys stay with the editors' own keymaps (K4): the hook does
  **not** also bind them, so a key press never runs history twice. macOS keeps the
  predefined items.
- **Clipboard (C10) is conditional on M2.** There is no shared clipboard dispatcher today:
  paste is handled by editor plugins (`MilkdownEditor.tsx:164-165`, `imagePastePlugin.ts`,
  `table/pasteWidenAlignment.ts`). Custom items are built only if M2(c) shows mdpro has
  VMark #1354's symptoms, or the user asks for parity (open question 6). If they are built,
  each item runs through the focused editor itself: one editor transaction, and for Paste
  the editor's existing paste pipeline, so HTML sanitising, table and image handling and
  undo history still apply. A text-only clipboard write is not acceptable in WYSIWYG. Cut removes text only after the clipboard
  write resolved. A failed write leaves the selection intact and logs it. Composition
  (IME) in progress refuses the action. Otherwise the predefined items stay.
- **Exit Ctrl+Q needs a new IPC command.** The frontend can only reply to a quit request
  (`quitGuardService.ts:94-122`, `quit_guard_reply`). The request itself is private Rust
  (`menu.rs:259-269`). M6 adds `request_quit`: a `#[tauri::command]` that calls the same
  `request_guarded_quit` path, a typed wrapper in `quitGuardService.ts`, a
  `app.quit.request` log line, a ledger row and the CLAUDE.md "Key commands" entry. A
  second request while one is in flight joins it; it never starts a second round.

## 6. Work items

Branch per item, `<type>/<id>-<slug>` off `master` in its own worktree, landed by the
delegator (rule 70). The D or WI prefix for receipts comes from the delegator.

**Every landed WI is coherent on its own.** A default key changes in the same commit as
every consumer of it: the command table, the Rust menu literal, the CodeMirror and Milkdown
keymaps, Settings, the Table dialog hint (C15), the sidebar tooltip
(ADR-0088), the migration and the ledger row. No intermediate commit advertises a key that
does not run.

**Rule 50 § 6 extraction is assigned, not incidental.** Already over 300 lines:
`typoraKeymapPlugin.ts` (317), `src/types/preferences.ts` (399),
`src-tauri/src/models/preferences.rs` (944). Close to it: `menu.rs` (277),
`useKeyboardShortcuts.ts` (271), `KeyboardShortcutsSettings.tsx` (282), `useMenuEvents.ts`
(250). The WI that first adds behaviour to one of them extracts first, in its own commit
on that branch: key definitions out of `preferences.ts` / `preferences.rs` (M1a), command
factories out of `typoraKeymapPlugin.ts` (M1b), the action table out of `useMenuEvents.ts`
(M3), the per-menu builders out of `menu.rs` (M4).

| WI | Scope | Files (expected) | Tests (rule 10) | Ledger rows to rewrite | ADR |
|---|---|---|---|---|---|
| **M2** | **Disposable spike, never landed.** A `spike/menu-m2` branch with temporary handlers and items: (a) ⌥⌘Q with an explicit Quote item, enabled and disabled, and with a DOM handler; (b) ⌃Tab, F6 and ⌃⇧0 reach the webview on macOS; (c) Windows typing, IME and paste after a menu Copy and after Ctrl+C (C10); (d) Ctrl+Shift+0 and an AltGr layout on Windows; (e) Ctrl+Shift+I, F6 and Ctrl+Tab in WebView2, release and dev builds (C16); (f) whether a menu accelerator fires on Windows with focus on the native window rather than the webview (K4) | the spike branch, deleted after the record lands (rule 25); brief under `docs/pending/`, record under `docs/test/` | none (spike) | none | Feeds M0 |
| **M0** | Write the ADR **after M2's record**: D1–D6, rules K1–K8, the § 5.3.2 table by reference, the § 5.5 table format, the § 5.6 states, and the superseded clauses of § 5.3.4 plus ADR-0031 step 4 D-b | `docs/adr/NNNN-…md` (number from the delegator when it is written); Status-line forward links in ADR-0096, ADR-0090 and ADR-0031 | none (docs) | none | **Yes**, this one |
| **M1a** | The contract, **no default changes**: the command table (§ 5.5) with today's keys; the generated Rust JSON and its parity test; the matcher's K8 fix (C13); the reserved-chord test (K5); `keyboardShortcutsVersion`, the § 5.6 states and normalised collision detection; migration code with an empty v1 → v2 map | new `src/commands/commandTable.ts`, `src-tauri/src/menu_layout.json`, `src/hooks/useKeyboardShortcuts.ts`, `src/types/preferences.ts` (extracted), `src-tauri/src/models/preferences.rs` (extracted), `src-tauri/src/services/preferences.rs`, `tests/fixtures/preferences-contract.json`, `KeyboardShortcutsSettings.tsx` (conflict check only) | Matcher: real `event.key` / `event.code` pairs for ⇧0, ⌃⇧0, Alt+Shift+0, ⇧⌘`, a German layout's shifted symbols, and AltGr refused. Migration: missing field, legacy `""`, a stored old default, a custom value, a custom value that collides with a new default, a second load (no-op), a failed write-back, two windows loading at once, a corrupt file, a version-2 file read by the code before M1a's migration ran (downgrade). States survive load, save and Reset. Parity: TS table = Rust JSON | "快捷键改键" `:416` (states and conflicts) | Needs M0 accepted |
| **M3** | Editor command dispatcher: `menu:action` `editor.<command>` routed to Milkdown in W and CodeMirror in S, reusing existing commands (`typoraKeymapPlugin.ts:61-113`, `headingPlugin`, `insertLinkCommand`, `triggerTableInsert`, highlight, **Milkdown's blockquote and list commands**). Availability per § 5.5, per window | new `src/utils/editorMenuCommands.ts`, `src/hooks/useMenuEvents.ts` (split out `menuActionTable.ts`), `src-tauri/src/menu.rs`, `src-tauri/src/menu_recent.rs` (per-window mode) | TS: command × mode matrix, through the composed editor keymaps rather than a single `keydownHandler`, with the hook's window listener attached (it runs in its mode, is refused and logged in the other); an `unavailable` id is never dispatched; every route is matched with no wildcard. Focus: two windows in different modes, focus switches, a window closing, the mode reported late; a menu event while a modal or the Settings recorder has focus is not applied to the editor. Rust: id → action covers every `MENU_*` id | menu route added to `:122`–`:125` | No |
| **M1b** | Default keys § 5.3.2 on both platforms, C1–C6, C11, C12, C15; the v1 → v2 migration map; drop the mac Close Window (C3); remove or rebind the editor keys K4 names (fold, `Mod-Shift-b`, `Mod-Alt-0…8`); each changed key with **every** consumer (see above), including `highlightPlugin.ts:65-68` and `headingPlugin.ts:109-111` | the command table, `typoraKeymapPlugin.ts` (extracted), `highlightPlugin.ts`, `headingPlugin.ts`, the CodeMirror basic-setup options, `menu.rs` / `menu_submenus.rs`, `TableInsertModal/index.tsx`, the sidebar tooltip, `search.ts` (comment) | Every changed key fires its command once and the old key no longer fires, through the composed keymaps in both modes; ⌥⌘] / Ctrl+Alt+] changes the heading level and folds nothing; migration of each changed default; `window_menu_has_close(os)` | "粗体 / 斜体" `:122`, "标题 1–6 与正文" `:123`, "删除线" `:125`, "高亮选区" `:129`, "查找与替换" `:233`, "视图模式切换" `:292`, "原生 Window 菜单" `:442`, "插入表格对话框" `:188`, "快捷键改键" `:416` | Covered by M0 |
| **M4** | macOS tree § 5.1, rendered from the command table, every *(n/a)* item and Save As disabled (D3), C8, C9, Bring All to Front, "Settings…" (D5) | `src-tauri/src/menu.rs`, new `menu_paragraph.rs` / `menu_format.rs` / `menu_edit.rs`, `menu_submenus.rs`, `scripts/ledger/declared.mjs` (scan the new files) | Rust: the production builder consumes `menu_layout.json`, and `menu_layout_for("macos")` → titles, ids, enabled flags as data is that same output; each *(n/a)* id present and disabled; each new `MENU_*` id handled | "原生 macOS 菜单栏" `:460`, "应用菜单基础项" `:461`, "另存为" `:75` (disabled menu item), "浅色 / 深色 / 跟随系统" `:326`, a row per new `MENU_*` id (`pnpm ledger:check`) | Covered by M0 |
| **M5** | Windows/Linux tree § 5.2: no app menu, no Window menu, Settings / Exit / escape in File, About in Help, disabled items as M4; custom Undo / Redo (C14, § 5.7); clipboard items only if M2(c) or open question 6 says so | `src-tauri/src/menu.rs`, `menu_quit.rs`, `menu_submenus.rs`; the editor history and (if built) clipboard adapters | Rust: `menu_layout_for("windows")` and `("linux")` from the production builder; Exit still routes to `request_guarded_quit` (`menu.rs:225, 259-269`); escape item directly after Exit (`menu_escape_order_tests.rs`). TS: a menu Undo / Redo click runs the focused editor's history once, in W and in S, and a Ctrl+Z press runs it once (no hook double-run). If the clipboard items are built: WYSIWYG copy keeps formatting, paste goes through the sanitiser and table/image handling, Cut keeps the text when the clipboard write fails, nothing runs during IME composition, each action is one undo step | "原生 macOS 菜单栏" Windows row `:480`, `:467` and its Windows row, `:468`, "撤销 / 重做" `:145` | Covered by M0 |
| **M6** | Off-Mac specifics: Exit Ctrl+Q through the new `request_quit` command (§ 5.7); F6 bound in the hook; Ctrl+Y kept as a second Redo key if the editors accept it; VMark's `defaultKeyOther` cases (Alt+Shift+0); the AltGr decision (open question 3); Settings labels | `src-tauri/src/commands/quit_guard.rs` + `commands/mod.rs` (registration), `src/services/quitGuardService.ts`, `src/hooks/useKeyboardShortcuts.ts`, `src/utils/platformLabels.ts`, CLAUDE.md "Key commands" | Rust: `request_quit` with no guard exits as the menu path does; a second request while one is in flight joins it. TS: Ctrl+Q calls `request_quit` once, never `app.exit`; IPC failure is logged and surfaced. Real keydowns, as M1b; AltGr per the decision; Ctrl+Shift+I does nothing in a release build (C16) | "快捷键改键" Windows row `:427`, "插入表格对话框" Windows row `:212`, quit-guard Windows rows, a row for `request_quit` | Covered by M0 |
| **M7** | Settings shows every entry (D3) with its capability (§ 5.5): "Not available" (greyed, recorder disabled), "WYSIWYG only" / "Source only", "(system)", `nativeBehaviour` text; `<merged:…>` rows show what they merged into. The recorder accepts F1–F12 alone. The 9 contract fields missing from the page (ledger `:416`) are added the same way | `src/components/common/settings/KeyboardShortcutsSettings.tsx` (split), `src/utils/platformLabels.ts` | Component: role/name of a disabled row, `aria-disabled`, clicking it starts no recording, Save does not write it, Reset restores `<unassigned>` where that is the default; F6 records; conflict detection ignores unavailable rows | "快捷键改键" `:416` and `:427` | No |
| **M8** | (Follow-up, not scheduled) Menu accelerators rebuilt from stored preferences on save, as VMark's `accelerators.rs` does | `menu.rs`, a new Tauri command | to be designed | `:416` | Yes |

Order: **M2 (spike) → M0 → M1a → M3 → M1b → M4 and M5 in parallel → M6 → M7.** M2 must
finish before M0 is written, because its results decide K3, C10 and C16. M1a lands the
contract before any key changes; M3 lands the dispatcher before the menu advertises new
commands; M1b then changes keys with all their consumers at once. M8 is outside this plan.

Every behaviour WI rewrites its ledger rows and `CHANGELOG.md` `## [Unreleased]` in the
same commit and runs `pnpm ledger:check` (and `pnpm ledger:build`). Logging follows the
route (§ 5.5, rule 20): `frontend` items log `ui.menu.select` through `useMenuEvents`;
`rust-quit` items log in Rust (`log_menu_exit`, `menu.rs:259-269`); `native` items log
nothing and are proved by their effect; `unavailable` items are proved disabled. The
sidebar plan's tooltip text (`20261012-plan-sidebar-toggle-and-resize.md` § 6, ADR-0088)
changes with the M1b sidebar key.

### 6.1 Device checks

Evidence follows the route (§ 5.5): a `frontend` item shows one `ui.menu.select`; a
`rust-quit` item shows its Rust log line; a `native` item shows its effect (the app hides,
the window minimises); an `unavailable` item is greyed and a click does nothing. Every key
is pressed in each focus context of K4 that applies: the editor in W, the editor in S, an
open modal, the Settings recorder.

| Platform | How | What |
|---|---|---|
| macOS | dtrack brief (rule 70 § Device-check batches), batch "menu bar" | Click every item of § 5.1 in W and in S: each shows its route's evidence, or is greyed as § 5.1 marks it. Two windows in different modes: the menu follows the focused one. Press every changed key of § 5.3.2 in both modes; the old key does nothing; ⌥⌘] / ⌥⌘[ fold nothing in S. Re-run P13, E11, V5, V6, F6. Failure: any key that hides or quits the app, any enabled `frontend` item without a log line, any *(n/a)* item enabled, any key that acts twice |
| Windows | `remote-windows-device-test` skill, `menuclick` per item, `menus.txt` dump | `menus.txt` equals § 5.2 with the disabled flags. Each changed key fires once through the hook (`ui.shortcut.trigger`). Ctrl+Q goes through `request_quit` and the quit guard. Menu Undo / Redo in W and S. C10 (if built): type, paste and use IME after a menu Copy. Ctrl+Shift+I and F6 in the release build (C16). Settings shows the capability rows. AltGr layout if one can be installed |
| Linux | not available | Recorded as untested (D6) |

## 7. Open questions for the user

1. **Quote on macOS.** VMark's ⌥⌘Q quit mdpro on device. If the M2 spike shows an explicit
   Paragraph › Quote item takes ⌥⌘Q, keep it; if not, leave Quote unassigned on macOS
   (menu-only), or pick another key?
2. **View toggle.** VMark's F6 needs Fn on most Mac keyboards. Keep ⌘/ / Ctrl+/ (ADR-0096,
   device-verified) as a fixed second key beside F6, or F6 only?
3. **AltGr.** VMark keeps Ctrl+Alt chords off-Mac. On German and similar layouts those keys
   type characters, and mdpro's guard refuses them. Accept that (as VMark does), or give
   those actions an off-Mac variant?
4. **Ctrl+Shift+0** (Paragraph, Windows) may be taken by the Windows input-language hotkey.
   Keep VMark's key if M2 shows it reaches mdpro, otherwise which?
5. **Table row / column keys** (⌥⌘arrows, kept from mdpro): VMark and CodeMirror use
   ⌥⌘↑ / ↓ for Add Cursor. Keep mdpro's, or move them? Either way K4 needs one owner per
   context: inside a table the table key, outside it add-cursor.
6. **Clipboard items on Windows** (C10, § 5.7). If M2 shows no #1354 symptom in mdpro, keep
   the predefined items (recommended: no adapter to build and no editing risk), or build
   VMark's custom items anyway for parity?
7. **Native keys in WYSIWYG on Windows** (§ 5.2). Ctrl+F / Ctrl+G open WebView2's find bar
   and Ctrl+Shift+V pastes plain text. Keep them and say so in Settings (recommended), or
   suppress them until mdpro has its own?

## 8. What this plan could not verify

- Typora's Themes / Window / Help menus, its app menu, its Windows File menu and whether
  its mac Hide keeps ⌘H. Its support page lists Indent ⌘[ / Outdent ⌘], the reverse of
  mdpro and VMark; not checked in the app.
- Why ⌥⌘Q reaches Quit. muda's Quit item carries only ⌘Q (`predefined.rs:344`).
- Which item fires for ⌘W when no DOM handler takes it.
- Whether mdpro shows VMark's #1354 symptoms on Windows.
- Whether Ctrl+Y still redoes in both editors once the Windows Redo label becomes
  Ctrl+Shift+Z, and whether Ctrl+Shift+0 and F6 reach the webview on each platform.
- The macOS reserved chords in K5 not device-tested in mdpro: all but ⌘H, ⌥⌘Q and ⌘\`.
- **A menu action is not pinned to the window and document it was clicked in.**
  `menu:action` is broadcast, and each window asks `isFocused()` and acts if the check fails
  (`useMenuEvents.ts:114-121`, fail-open). That is today's behaviour, not something this
  plan introduces, so it is reported to the delegator for a D number rather than fixed
  here. M3 must not make it worse: it adds editor actions to the same path.
- VMark's keys are read from its source and guide at `e0a982d`. **macOS checked live (2026-10-15, mdpro-codex-audit)**: the running VMark 0.9.99 on the Mac mini (e0a982d is v0.9.99 plus two CI/dependency-only commits) shows the § 4.1 layout and every macOS key in § 5.3.2 that has a VMark menu item, read from its menu tree with System Events (archive `~/.mdpro-redesign/handoff/mdpro-codex-audit-20261015-vmark-0.9.99-menus.txt`). Three corrections came from it: Toggle Sidebar is keymap-only in VMark; its full screen is the system fn F item, not ⌃⌘F; and its clipboard override is Windows-only. The Windows and Linux columns are still source-only.

## 9. Review revision (2026-10-15)

The plan was reviewed with `/cc-suite:review-plan --full` (Codex `gpt-6.1-sol`, effort high,
thread `01a13c60-13f9-7d00-bf25-7342ce5277ba`; verdict **NEEDS REVISION**, 26 findings;
output archived at `~/.mdpro-redesign/handoff/mdpro-codex-audit-20261015-0556-review-plan-menu.json`).
mdpro-codex-audit triaged it and, on the user's instruction (「按照你建议的开始修改，修改 plan
文档本身，然后 commit。」), revised the plan. ✔ = re-checked in code for this revision.

| Review # | Triage | Where it is addressed |
|---|---|---|
| 1 ✔ | Must | § 2 (commands, not keys), § 3.3, § 5.1, § 5.3.2 Quote / list rows, M3 |
| 2 | Should | § 3.1 Windows row, K4, M2(f), § 6.1 |
| 3 | Should | § 5.1 annotations per item, § 5.5 (the table wins over the trees) |
| 4 | Should | § 5.2, § 5.3.2 Switch Documents: reserved, not bound |
| 5 | Should | K3 / K5 (exception by name; native items keep OS keys) |
| 6 | Should | § 5.5 `route`, § 6 logging paragraph, § 6.1 evidence per route |
| 7 | Must | § 5.6 (Rust load path, version field, lock, failure, downgrade), M1a |
| 8 | Must | § 5.6 collisions, M1a tests |
| 9 ✔ | Should | § 5.5 per-window availability, M3 |
| 10 | Deferred | Pre-existing; § 8, reported to the delegator for a D number |
| 11 ✔ | Should | Evidence list, C15, § 5.2 native keys |
| 12 ✔ | Must | C12, K4, M1b |
| 13 ✔ | Must | K8, C13, M1a |
| 14 ✔ | Must | § 3.2 (muda 0.20: replayed through `SendInput`), C14, § 5.7, M5 |
| 15 | Must | § 5.7 (conditional on M2; editor-aware if built), open question 6, M5 |
| 16 ✔ | Must | § 5.7 `request_quit`, M6 |
| 17 | Should | C16, M2(e), M6 |
| 18 | Must | § 5.5 command table and generated Rust JSON, M1a |
| 19 ✔ | Must | § 5.6 explicit states; ADR-0031 D-b clause superseded in M0 |
| 20 ✔ | Should | § 5.3.2 F6 row, § 5.5 capability labels, M7 |
| 21 ✔ | Should | § 5.5 exhaustive routes and scanner, M4 |
| 22 ✔ | Should | § 5.2 native behaviour, open question 7 |
| 23 | Must | M2 is a spike branch; M0 follows its record |
| 24 ✔ | Must | § 6 coherence rule; order M1a → M3 → M1b |
| 25 | Should | Tests column of M1a–M7 |
| 26 | Note | § 6 extraction paragraph |

Also corrected: muda 0.17.1 / Tauri 2.9.5 citations (the app is on muda 0.20.0 and
Tauri 2.12.1 since #443), and the dangling "(C12)" in the Toggle Sidebar row (now C11).
