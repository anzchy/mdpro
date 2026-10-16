# Plan: reorganise the native menu bar on macOS and Windows

**Status:** revised after the scoped Codex re-review and confirmed clean (C0 · H0 · M0 · L0, 2026-10-16, §§ 10–11). Decisions
taken (§ 0, including the user's answers to U1–U9); U10–U12 are still open, listed next; no code written.
**Scheduled for v0.3.6, merged with [D255](20260912-frontend-backend-sequencing-order.md#d255)**
(2026-10-16, decision D7 in § 0) and owning [D261](20260912-frontend-backend-sequencing-order.md#d261).
Next: M2. U10 and U11 wait for M2's record and U12 for the prototype.
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

## Decisions for the user

Collected for the delegator to put to the user. Each says which work item waits on it.
**U1–U9 were answered on 2026-10-16** (relayed by the delegator, quoted in the Waits column
and in § 0 as D9–D17) and are applied through the plan. U10 and U11 wait for M2's record;
U12 is a choice on the prototype. Nothing below has
been decided by this plan; where the plan needs a value to be written against, it uses
the recommendation and marks the row "(U*n*)". A "before M1b" decision changes a default key,
so M1b cannot land until it is answered.

| # | Question | Options | Recommendation | Waits |
|---|---|---|---|---|
| U1 | **Ctrl+Alt chords off-Mac on AltGr layouts** (old open question 3; survey R11; review #34). Code Fences, both lists, Quote, Increase / Decrease Heading, Math Block and the six table keys are Ctrl+Alt off-Mac. On German, French, Polish and similar layouts Ctrl+Alt is AltGr, and mdpro's matcher refuses AltGr (`useKeyboardShortcuts.ts:72`), so those keys never fire there. Pre-existing since `e895e4d5` | **A.** Accept it, as VMark does; Settings says "may not work on AltGr layouts". **B.** Windows/Linux variants from Typora's set where they are collision-free: Code Fences Ctrl+Shift+K, Quote Ctrl+Shift+Q, Ordered / Unordered List Ctrl+Shift+[ / ] (then CodeMirror fold keeps no off-Mac key, C12). Math Block cannot take Typora's Ctrl+Shift+M, which is Highlight (§ 5.3.2), so it stays Ctrl+Alt+Shift+M and disabled until D255 builds it. Heading level and the table keys keep Ctrl+Alt. M2(e) checks that WebView2 leaves Ctrl+Shift+K / Q to the page. **C.** B, plus moving heading level and the table keys off Ctrl+Alt too | **B.** It fixes the four keys that type characters on those layouts, with no collision in § 5.3.2. Heading level and table keys are rarer, and arrows and brackets under AltGr vary by layout. Either way, M1b's acceptance needs evidence on an AltGr layout that the key types its character in the editor and that the command runs (§ 6.1) | **Answered:** 「B · Typora's Ctrl+Shift keys (Recommended)」 |
| U2 | **The macOS key for Quote** (survey R5; old open question 1). ⌥⌘Q ran Quit on device (P13, [audit](../test/20261016-shortcuts-mac-audit.md)) | **A.** Keep VMark's ⌥⌘Q only if the M2 spike shows an explicit Quote item wins, enabled and disabled (K3); otherwise menu-only. **B.** Menu-only now, no key. **C.** ⇧⌘B, Milkdown's own blockquote key (preset `:764`), free in § 5.3.2 and not on K5's reserved list. Then K4's removal of `Mod-Shift-b` becomes a rebind to the same command | **C.** It already runs Quote in WYSIWYG today, so the change is a menu label and a Source command. A depends on beating an OS key, which R5 advises against. Avoid ⇧⌘Q (log out) | **Answered:** 「C · ⇧⌘B (Recommended)」 |
| U3 | **F6 for Toggle Source Mode** (survey R6; old open question 2) | **A.** F6 only (VMark). **B.** F6 in the menu, plus ⌘/ / Ctrl+/ kept as a fixed second key (Settings shows both; a native item shows one). **C.** ⌘/ / Ctrl+/ stays the menu key, F6 the second key | **B.** It follows D2 and keeps the device-verified ⌘/ (ADR-0096) for people who use it. F6 needs Fn on Mac laptops and is "next pane" in WebView2 (C16) | **Answered:** 「C · ⌘/ first, F6 second」, **not** the recommendation: ⌘/ / Ctrl+/ is the key the menu shows, F6 the second key |
| U4 | **Toggle Sidebar ⌃⇧0 / Alt+Shift+0** (survey R7) | **A.** VMark's ⌃⇧0 / Alt+Shift+0, freeing ⇧⌘L for CodeMirror's select-all-matches (C11). **B.** Keep ⇧⌘L / Ctrl+Shift+L (device-verified, Typora's), and take CodeMirror's `Mod-Shift-l` off the Source keymap instead | **B.** Apple's HIG discourages ⌃ chords, Alt+Shift is the Windows layout switch, and A needs K8's shifted-digit fix. Select-all-matches has no menu item and no Settings row today. B departs from D2, so it needs the user's word | **Answered:** 「B · Keep ⇧⌘L (Recommended)」, a D2 departure for this item |
| U5 | **Replace keys** (survey R2, R3; review #32, #33). The plan merges Replace into Find and Replace ⌘F / Ctrl+F and drops ⌘H (which hides the app) | **A.** As written: no Replace key. **B.** Windows keeps Ctrl+H as a second key that opens Find and Replace with the replace field focused (R3). **C.** B, and macOS gets ⌥⌘F the same way (R2); ⌥⌘F is free once Toggle Fullscreen becomes the system item (C5) | **C.** Ctrl+H is the Windows convention (Microsoft's accelerator table, Word, VS Code), and ⌥⌘F is the Mac editors' key (VS Code, Obsidian, iA, Bear). Neither collides in § 5.3.2. Today Ctrl+H is advertised but bound to nothing (no `Mod-h` in `searchKeymap`), so this adds a working key, not a kept one | **Answered:** 「Mac ⌘H  for Replace, ⌘F for find, Ctrl + H for replace on Windows」, none of A–C: Replace keeps its own key on both platforms, and there is no ⌥⌘F (D13) |
| U6 | **Settings groups for the entries M7 adds** (DESIGN open item 7; review #36) | **A.** As prototype A drew them: Export HTML in File, Highlight in Format, Undo / Redo in Edit (fixed), Exit in File. **B.** A separate "System" group for every fixed and system row | **A.** It is what the chosen prototype shows, and it keeps each command beside its menu | **Answered:** 「A · As prototype A drew it (Recommended)」 (D14) |
| U7 | **Windows full screen F11** (survey R14). D255 lists Toggle Fullscreen among its no-effect keys | **A.** Disabled off-Mac, as written. **B.** D255 builds it: F11 toggles `setFullscreen` on the window off-Mac; macOS keeps the system fn F item | **B.** Tauri's window API already does it, and Typora and VS Code use F11 | **Answered:** 「B · Build F11 full screen (Recommended)」 (D15) |
| U8 | **Insert Table ⇧⌘T / Ctrl+Shift+T** (survey R12) | **A.** VMark's ⇧⌘T / Ctrl+Shift+T, as written. **B.** Keep ⌥⌘T / Ctrl+Alt+T (device-verified; off-Mac it is an AltGr chord, U1) | **A.** mdpro binds no reopen-tab key (`tabStore.undoCloseTab` exists but nothing calls it), and B keeps an AltGr chord. If a Reopen Closed Tab command is added later, it needs a different key | **Answered:** 「A · ⇧⌘T / Ctrl+Shift+T (Recommended)」 (D16) |
| U9 | **Windows strikethrough** (survey R8) | **A.** Ctrl+Shift+X (VMark, the same shape as macOS ⇧⌘X). **B.** Keep Alt+Shift+5 (Typora, Google Docs; passed on device) | **A**, for D2. A close call: B is device-verified | **Answered:** 「A · Ctrl+Shift+X (Recommended)」 (D17) |
| U10 | **Clipboard items on Windows** (old open question 6; C10) | **A.** Keep the predefined items unless M2(c) shows VMark #1354's symptoms. **B.** Build VMark's custom items anyway, for parity | **A.** Custom items need the § 5.7 adapter, the riskiest code in the plan | after M2 |
| U11 | **Native keys in WYSIWYG on Windows** (old open question 7) | **A.** Keep WebView2's own Ctrl+F find bar and Ctrl+Shift+V plain paste and say so in Settings until D255 ships mdpro's find. **B.** Suppress them until then | **A.** Nothing that works today stops working. Once D255's WYSIWYG find lands, it takes Ctrl+F in WYSIWYG on both platforms | after M2 |
| U12 | **The D255 prototypes** (D7; the user's 2026-10-16 words in [D255](20260912-frontend-backend-sequencing-order.md#d255)) | Variants of the WYSIWYG find / replace popup (and of any other new UI the triage finds, e.g. an image picker), built with `/mattpocock-skills:prototype` on a `prototype/d255-*` branch | The user picks on the running prototype (rule 70 § Questions) | D255-WI-2 |

Still open after M2, and not the user's until the spike reports: **Ctrl+Shift+0** for
Paragraph on Windows (old open question 4); the **table keys** (old open question 5),
whose ownership conflict is now a defect with an owner (C17) rather than a question.

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
| D7 | Release, and D255 (2026-10-16) | 「合并进 v0.3.6 (Recommended)」, given in answer to: the plan and D255 (the Mac shortcuts that do nothing, from the [shortcuts audit](../test/20261016-shortcuts-mac-audit.md)) go into v0.3.6 together | D255 is this plan's "fill in the commands" track: an item with no command is **implemented where feasible** (new UI, such as a WYSIWYG ⌘F find panel, goes to the user as a prototype first) and **shown disabled under D3 only where it is not**. D3 is narrowed, not reversed. Default keys follow D2 (VMark), so D255 is built on the new key table, never on today's. § 5.8 gives each of D255's 26 actions a disposition and an owner; D255-WI-1…3 (§ 6) carry it out; M0 records D7 |
| D9 | Off-Mac Ctrl+Alt chords (U1, 2026-10-16) | 「B · Typora's Ctrl+Shift keys (Recommended)」 | Off-Mac: Code Fences Ctrl+Shift+K, Quote Ctrl+Shift+Q, Ordered / Unordered List Ctrl+Shift+[ / ]. Math Block, heading level and the table keys keep Ctrl+Alt. CodeMirror fold keeps no off-Mac key (C12) |
| D10 | Quote on macOS (U2, 2026-10-16) | 「C · ⇧⌘B (Recommended)」 | Quote is ⇧⌘B on macOS, Milkdown's own `Mod-Shift-b`; ⌥⌘Q stays unassigned; M2(a) is dropped |
| D11 | View toggle (U3, 2026-10-16) | 「C · ⌘/ first, F6 second」 | ⌘/ / Ctrl+/ is the menu's key (ADR-0096's clause stands); F6 is a fixed second key on both platforms. Departs from D2 for this item |
| D12 | Toggle Sidebar (U4, 2026-10-16) | 「B · Keep ⇧⌘L (Recommended)」 | ⇧⌘L / Ctrl+Shift+L stay; CodeMirror's `Mod-Shift-l` (select-all-matches) is removed from Source. Departs from D2 for this item |
| D13 | Replace keys (U5, 2026-10-16) | 「Mac ⌘H  for Replace, ⌘F for find, Ctrl + H for replace on Windows」 | Find ⌘F / Ctrl+F and Replace ⌘H / Ctrl+H are two items. On macOS ⌘H leaves the Hide item: Hide mdpro becomes a custom item with no key (C2); the user accepted that consequence: 「Accept: Hide has no key (Recommended)」 (2026-10-16). No ⌥⌘F. `editReplace` keeps its version-1 default, so the migration leaves it alone, and the `<merged:editFind>` state is dropped |
| D14 | Settings groups (U6, 2026-10-16) | 「A · As prototype A drew it (Recommended)」 | Export HTML in File, Highlight in Format, Undo / Redo in Edit (fixed), Exit in File (M7) |
| D15 | Windows / Linux full screen (U7, 2026-10-16) | 「B · Build F11 full screen (Recommended)」 | D255-WI-3d builds F11 off-Mac (§ 5.8 row 2); macOS keeps the system fn F item |
| D16 | Insert Table (U8, 2026-10-16) | 「A · ⇧⌘T / Ctrl+Shift+T (Recommended)」 | Insert Table leaves ⌥⌘T / Ctrl+Alt+T. D9's "table keys" that stay on Ctrl+Alt are the six in-table row and column keys, a different set, so the two answers do not overlap |
| D17 | Windows strikethrough (U9, 2026-10-16) | 「A · Ctrl+Shift+X (Recommended)」 | ADR-0096's Alt+Shift+5 clause is superseded, as § 5.3.4 says |
| D8 | Menu and Settings look (2026-10-16) | 「A · Plan as written, greyed」 ([DESIGN.md](../design/mdpro-ui-new/DESIGN.md) § Native menu bar and Keyboard Shortcuts page, `d907a3f6`) | The trees as drawn; unavailable items greyed in place; no banner for changed defaults. DESIGN's block is normative for M4, M5 and M7 |

## 1. Goal

1. Every command mdpro has is reachable from the menu bar, under the menu a Typora user
   expects, with the key that actually runs it.
2. mdpro's default keys match VMark's on macOS and on Windows/Linux, except where that key
   is owned by the OS.
3. No menu item and no Settings entry advertises a chord the OS owns. Today ⌘⌥Q (Quote)
   quits and ⌘H (Replace) hides the app. ⌘H is not the OS's, though: it is the key of
   mdpro's own predefined Hide item, so D13 takes it off Hide and gives it to Replace.
4. Each platform follows its own convention. macOS keeps an app menu. Windows and Linux put
   Settings and Exit in File and About in Help.
5. Nothing silently does nothing. A command missing in the current mode is a disabled menu
   item; a command missing in both modes is a disabled item and a read-only "Not
   available" row in Settings.

## 2. Non-goals

- **No new editor features outside D255.** The M-items build no command. D255's track
  (D7, § 5.8, D255-WI-1…3) is the exception: it triages each of D255's 26 actions, builds
  the feasible ones (Save As, the Source-mode marks, mdpro's WYSIWYG find and the rest of
  § 5.8's "build" rows), and leaves the rest disabled under D3. Until a D255 WI lands, every
  such item has its VMark key and a **disabled** menu item, so building it only enables it.
- **"No command" means no command in the loaded editors, not "no key today".** The
  inventory is of commands, not of advertised shortcuts. Quote and both lists are **not**
  in the list above: the loaded Milkdown preset already has them
  (`MilkdownEditor.tsx:153-163` loads `mdproCommonmark`, `commonmarkPreset.ts:39-47`;
  `@milkdown/preset-commonmark@7.18.0/lib/index.js:764` blockquote `Mod-Shift-b`, `:1377`
  ordered list `Mod-Alt-7`, `:1273` bullet list `Mod-Alt-8`, `:891` code block `Mod-Alt-c`).
  They are wired to the menu and to their § 5.3.2 key in WYSIWYG (mode: W), not disabled.
  Their old Milkdown keys are a K4 question (§ 5.3.1). **Image has a command but no UI**: the
  preset's `insertImageCommand` (`lib/index.js:975`, in its `commands` list `:1775-1783`, kept
  by `mdproCommonmark`, `commonmarkPreset.ts:39`) inserts a node from a payload, but nothing
  asks the user for the image: only the paste and drop plugins insert images
  (`imagePastePlugin.ts:142, 192`). The missing piece is the picker, so Image goes to D255's
  triage (§ 5.8) instead of being "no command".
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
the table wins. They show the state before D255's builds: each row § 5.8 builds turns its
*(n/a)* or single-mode mark into the modes it enables.

```
mdpro      About mdpro · — · Settings… ⌘, · — · Services ▸ · — · Hide mdpro (no key, D13) ·
           Hide Others ⌥⌘H · Show All · — · Quit mdpro ⌘Q · Stop Waiting and Quit…
File       New ⌘N · New Window ⇧⌘N · — · Open… ⌘O · Open Recent ▸ · — · Close ⌘W ·
           — · Save ⌘S · Save As… ⇧⌘S (n/a) · — · Export HTML… ⇧⌘E
Edit       Undo ⌘Z · Redo ⇧⌘Z · — · Cut · Copy · Paste · Copy as Markdown ⇧⌘C (n/a) ·
           Paste as Plain Text ⇧⌘V (n/a) · Select All · — ·
           Selection ▸ [Select Line ⌘L (n/a) · Select Word ⌘D (S) · Delete Word (n/a)] · — ·
           Find ▸ [Find… ⌘F (S) · Replace… ⌘H (S) · Find Next ⌘G (S) · Find Previous ⇧⌘G (S)]
Paragraph  Heading 1…6 ⌘1…⌘6 · Paragraph ⇧⌘0 · — ·
           Increase Heading ⌥⌘] (S) · Decrease Heading ⌥⌘[ (S) · — ·
           Table… ⇧⌘T (W) · Code Fences ⌥⌘C (W) · Math Block ⌥⇧⌘M (n/a) ·
           Quote ⇧⌘B (W) · — · Ordered List ⌥⌘O (W) · Unordered List ⌥⌘U (W) · — ·
           Indent ⌘] · Outdent ⌘[
Format     Bold ⌘B (W) · Italic ⌘I (W) · Underline ⌘U (n/a) · Code ⇧⌘` (W) · Strikethrough ⇧⌘X (W) ·
           Highlight ⇧⌘M · — · Link… ⌘K · Image… ⇧⌘I (n/a) · — · Clear Format ⌘\ (n/a)
View       Source ⌃2 · WYSIWYG ⌃4 · Toggle Source Mode ⌘/ (F6 also) · — · Toggle Sidebar ⇧⌘L ·
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
           Find ▸ [Find… Ctrl+F (S) · Replace… Ctrl+H (S) · Find Next Ctrl+G (S) · Find Previous Ctrl+Shift+G (S)]
Paragraph  as macOS, same annotations, Ctrl for ⌘ and Alt for ⌥: Heading Ctrl+1…6 ·
           Paragraph Ctrl+Shift+0 · Increase / Decrease Heading Ctrl+Alt+] / [ (S) ·
           Table… Ctrl+Shift+T (W) · Code Fences Ctrl+Shift+K (W) · Quote Ctrl+Shift+Q (W) ·
           Ordered / Unordered List Ctrl+Shift+[ / ] (W) · …
Format     Bold Ctrl+B (W) · Italic Ctrl+I (W) · Underline Ctrl+U (n/a) · Code Ctrl+Shift+` (W) ·
           Strikethrough Ctrl+Shift+X (W) · Highlight Ctrl+Shift+M · — · Link… Ctrl+K ·
           Image… Ctrl+Shift+I (n/a) · — · Clear Format Ctrl+\ (n/a)
View       Toggle Source Mode Ctrl+/ (F6 also) · Source · WYSIWYG · — · Toggle Sidebar Ctrl+Shift+L ·
           Switch Documents (n/a, no key shown) · Full Screen F11 (n/a until D255-WI-3d, D15)
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
  suppressed (U11). Once D255's WYSIWYG find lands, the items become *both* and mdpro's
  find takes the key in WYSIWYG.

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
| K4 | **One owner per chord, per platform and per focus context** (editor W, editor S, modal or Settings input, shortcut recorder, native window or menu focus). Exactly one keymap acts on a chord in each context. The menu shows the chord, and handles it only where no DOM keymap does. A key the loaded editors already bind for another purpose is **removed or rebound in the same WI** that assigns the chord: CodeMirror's fold keys (C12), the table arrows against add-cursor (C17), Milkdown's `Mod-Alt-0…8` once the menu owns lists and headings, Milkdown's `Mod-Shift-b` off-Mac (Quote is Ctrl+Shift+Q there, D9; on macOS it stays Quote's ⇧⌘B, D10), CodeMirror's `Mod-Shift-l` (D12), and off-Mac CodeMirror's `Mod-Alt-\` (`indentSelection`, `@codemirror/commands/dist/index.js:1777`), which eats AltGr+ß `\` on German ([D264](20260912-frontend-backend-sequencing-order.md#d264)). The § 3.1 routing is an observation per context, not an event-order guarantee; the tests and device checks cover every context listed here. | § 3.1, review #2, #12 |
| K5 | **No OS-owned default for an editor command.** macOS: ⌥⌘H, ⌘M, ⌘Q, ⌥⌘Q, ⌃⌘F, ⌘\`, ⌘Tab, ⌘Space, ⇧⌘Q, ⇧⌘3/4/5. Windows/Linux: Win-key chords, Alt+F4. Ctrl+Shift+0 is not reserved by Windows itself, but an input-method hot key can take it before the app (`HKCU\Control Panel\Input Method\Hot Keys\00000104` on win-desktop, M2(d1), 2026-10-16), so no editor command may rely on it alone off-Mac. **Native items keep their OS key**: Quit ⌘Q, Hide Others ⌥⌘H, Minimize ⌘M and the macOS-inserted Full Screen are not editor commands. Hide mdpro is the one exception, by the user's decision: it loses ⌘H to Replace (D13, C2). A test pins the list (WI-M1a), checks only editor-command defaults, and accepts a K3 exception only by name. | C1, C2, C4, C5 |
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
| Redo | ⇧⌘Z | Ctrl+Shift+Z | ⇧⌘Z | Ctrl+Y | ⇧⌘Z / **Ctrl+Shift+Z** | Off-Mac this needs custom Undo / Redo items (§ 5.7, C14). **Ctrl+Y stays a working second key, required**: both editors bind it today (`Editor.tsx:79-84` `Mod-y` and `Mod-Shift-z`; `@milkdown/plugin-history@7.18.0/lib/index.js:40` `["Mod-y", "Shift-Mod-z"]`). Losing it fails M5's acceptance |
| Copy As Markdown | ⇧⌘C (Copy as HTML) | Ctrl+Shift+C | ⇧⌘C | Ctrl+Shift+C | same, disabled | Same chord, VMark's action differs |
| Paste As Plain Text | ⇧⌘V | Ctrl+Shift+V | ⇧⌘V | Ctrl+Shift+V | same, disabled | |
| Select Line | ⌘L | Ctrl+L | ⌘L | Ctrl+L | same, disabled | |
| Select Word | ⌘D (Select Next Occurrence) | Ctrl+D | ⌘D | Ctrl+D | same | CodeMirror's `Mod-d` already is VMark's action |
| Delete Word | — (⇧⌘D = Skip Occurrence) | — | ⇧⌘D | Ctrl+Shift+D | **— / —**, disabled | K2: VMark spends the chord elsewhere |
| Jump to Top / Bottom | — (native) | — | ⌘↑ / ⌘↓ | Ctrl+↑ / Ctrl+↓ | **system** ⌘↑ ⌘↓ / Ctrl+Home Ctrl+End, not editable | K2: native editing keys, no menu item |
| Find | ⌘F | Ctrl+F | ⌘F | Ctrl+F | same | D13: Find only; Replace has its own item and key |
| Find Next | ⌘G | Ctrl+G | ⌘G | Ctrl+G | same; **F3 kept as a second key in Source** | CodeMirror's `searchKeymap` already binds F3 / Shift+F3 (`@codemirror/search/dist/index.js:1032`), and Microsoft's table uses F3 (survey R4). M1b's tests pin both; Settings shows F3 as a fixed second key |
| Find Previous | ⇧⌘G | Ctrl+Shift+G | ⇧⌘G | Ctrl+Shift+G | same; **Shift+F3** kept as above | |
| Replace | — (part of ⌘F) | — | ⌘H (hides the app) | Ctrl+H (bound to nothing) | **⌘H / Ctrl+H**, opening the search with the replace field focused | D13, against VMark (D2 departure). Same as today's stored default, so no migration. macOS needs C2: Hide mdpro gives up ⌘H. Source binds it in M1b; WYSIWYG gets it with D255-WI-3c, and until then it is disabled there and ⌘H does nothing in WYSIWYG |
| Heading 1–6 | ⌘1–6 | Ctrl+1–6 | ⌘1–6 | Ctrl+1–6 | same | ADR-0096 unchanged |
| Paragraph | ⇧⌘0 | Ctrl+Shift+0 | ⌘0 | Ctrl+0 | **⇧⌘0 / Ctrl+Shift+0** | Needs K8 (C13). Windows: M2(d) probes it |
| Increase Heading | ⌥⌘] | Ctrl+Alt+] | ⌘= | Ctrl+= | **⌥⌘] / Ctrl+Alt+]** | VMark uses ⌘= for zoom. Collides with CodeMirror's fold keys in S (C12) |
| Decrease Heading | ⌥⌘[ | Ctrl+Alt+[ | ⌘- | Ctrl+- | **⌥⌘[ / Ctrl+Alt+[** | C12 |
| Table | ⇧⌘T | Ctrl+Shift+T | ⌥⌘T | Ctrl+Alt+T | **⇧⌘T / Ctrl+Shift+T** | D16. Replaces the device-verified Ctrl+Alt+T: Insert Table leaves Ctrl+Alt on both platforms, while the six in-table keys below stay (D9) |
| Code Fences | ⌥⌘C | Ctrl+Alt+C | ⌥⌘C | Ctrl+Alt+C | ⌥⌘C / **Ctrl+Shift+K** | D9 (Typora's Windows key) |
| Math Block | ⌥⇧⌘M | Ctrl+Alt+Shift+M | ⌥⌘B | Ctrl+Alt+B | **⌥⇧⌘M / Ctrl+Alt+Shift+M**, disabled | VMark's ⌥⌘B is Bookmark |
| Quote | ⌥⌘Q | Ctrl+Alt+Q | ⌥⌘Q (runs Quit) | Ctrl+Alt+Q | **⇧⌘B / Ctrl+Shift+Q** | D10, D9. Milkdown's blockquote command, already under `Mod-Shift-b`, so ⇧⌘B runs it today in WYSIWYG; off-Mac Ctrl+Shift+B is removed (K4). Source gets a command through D255 (§ 5.8) |
| Ordered List | ⌥⌘O | Ctrl+Alt+O | ⌥⌘O | Ctrl+Alt+O | ⌥⌘O / **Ctrl+Shift+[**, (W) | D9. Milkdown's command, today under `Mod-Alt-7` |
| Unordered List | ⌥⌘U | Ctrl+Alt+U | ⌥⌘U | Ctrl+Alt+U | ⌥⌘U / **Ctrl+Shift+]**, (W) | D9. Milkdown's command, today under `Mod-Alt-8` |
| Indent | ⌘] | Ctrl+] | ⌘] | Ctrl+] | same | |
| Outdent | ⌘[ | Ctrl+[ | ⌘[ | Ctrl+[ | same | |
| Bold | ⌘B | Ctrl+B | ⌘B | Ctrl+B | same | |
| Italic | ⌘I | Ctrl+I | ⌘I | Ctrl+I | same | |
| Underline | ⌘U | Ctrl+U | ⌘U | Ctrl+U | same, disabled | |
| Code | ⇧⌘\` | Ctrl+Shift+\` | ⇧⌘\` | Ctrl+Shift+\` | same | ADR-0096 unchanged |
| Strikethrough | ⇧⌘X | Ctrl+Shift+X | ⌃⇧\` | Alt+Shift+5 | **⇧⌘X / Ctrl+Shift+X** | D17. Supersedes ADR-0096's strikethrough clause |
| Hyperlink | ⌘K | Ctrl+K | ⌘K | Ctrl+K | same | |
| Image | ⇧⌘I | Ctrl+Shift+I | ⌃⌘I | shown as Ctrl+I (= Italic) | **⇧⌘I / Ctrl+Shift+I**, disabled | Fixes C6 |
| Highlight | ⇧⌘M | Ctrl+Shift+M | ⇧⌘H | Ctrl+Shift+H | **⇧⌘M / Ctrl+Shift+M** | Also hardcoded in Source: `highlightPlugin.ts:65-68` `Mod-Shift-h`, and the menu literal `menu.rs:189` |
| Clear Format | ⌘\\ | Ctrl+\\ | ⌘\\ | Ctrl+\\ | same, disabled | |
| Source | — | — | ⌃2 | none (ADR-0096) | ⌃2 / none | K2: VMark has no direct-mode key; ⌃2 is free in VMark |
| WYSIWYG | — | — | ⌃4 | none | ⌃4 / none | K2 |
| Toggle Source Mode (Cycle) | F6 | F6 | ⌘/ | Ctrl+/ | ⌘/ / Ctrl+/ shown, **F6 second key** on both | D11: ADR-0096's Ctrl+/ clause stands. F6 is bound in the hook as a fixed second key, so it never appears on the native item. The recorder refuses a key with no modifier (`platformLabels.ts:72-74`); M7 lets it record F1–F12 alone |
| Toggle Sidebar | ⌃⇧0 | Alt+Shift+0 | ⇧⌘L | Ctrl+Shift+L | same (D12) | Departs from D2. C11 is fixed the other way: CodeMirror's `Mod-Shift-l` (`selectSelectionMatches`, `@codemirror/search/dist/index.js:1035`) leaves the Source keymap. ADR-0088's tooltip is unchanged. VMark binds ⌃⇧0 in its keymap only (`shortcutDefinitions.ts:134`) |
| Toggle Fullscreen | system item (⌃⌘F) | none | ⌥⌘F (unbound) | Ctrl+Alt+F (unbound) | **system fn F / F11** | C5, D15. F11 is built by D255-WI-3d; ⌥⌘F / Ctrl+Alt+F become unassigned |
| Switch Documents | ⌃Tab (Last Used Tab) | Ctrl+Tab | ⌘\` (macOS window cycling) | Ctrl+\` | **⌃Tab / Ctrl+Tab** reserved, disabled, **not bound** until D255-WI-3d | C4. The key is stored as the future default but no keymap consumes it until the command exists (§ 5.2) |
| Table: insert row above / below, column left / right | — | — | ⌥⌘↑ ↓ ← → | Ctrl+Alt+arrows | same | K2. VMark's ⌥⌘↑/↓ is Add Cursor; CodeMirror's `defaultKeymap` binds it (`@codemirror/commands/dist/index.js:1769`). Today both run in Source: C17 |
| Table: delete row / column | — | — | ⌥⌘⌫ / ⌥⇧⌘⌫ | Ctrl+Alt+Backspace / +Shift | same | K2 |

#### 5.3.3 Where following VMark still leaves a choice

- **Quote ⌥⌘Q** is VMark's key and quit mdpro on device (P13). Settled: ⇧⌘B (D10).
- **F6** needs Fn on a Mac keyboard unless "Use F1, F2… as standard function keys" is on
  (VMark's own guide says so). Settled: ⌘/ first, F6 second (D11).
- **Ctrl+Alt chords off-Mac** (Code Fences, lists, Quote, heading level, Math, table keys)
  are AltGr on many European layouts. mdpro's matcher refuses AltGr
  (`useKeyboardShortcuts.ts:72`); VMark has no AltGr handling in
  `src/utils/shortcutMatch.ts`. Settled before M1b as review #34 required: Typora's Ctrl+Shift
  keys for Code Fences, Quote and the lists (D9).
- **Ctrl+Shift+0** (Paragraph, Windows): some Windows installs give it to the input
  language hotkey. From memory, not checked. M2(d) probes it; the question goes to the user
  only if it fails.
- **Toggle Sidebar, Replace, Table, strikethrough**: the survey's R7, R2 / R3, R12 and R8
  argue for a different key than VMark's. All settled: D12, D13, D16, D17.

#### 5.3.4 What this does to ADR-0096 and ADR-0090

| Clause | Windows device case (`20261014-d190-wi6-wi7-windows-device-check.md:28-32`) | Changes? |
|---|---|---|
| ADR-0096: Ctrl+1–6 are headings off-Mac | K3 PASS | **No** |
| ADR-0096: inline code Ctrl+Shift+\` off-Mac | K1 PASS | **No** |
| ADR-0096: Source / WYSIWYG items carry no key off-Mac | K5 PASS | **No** |
| ADR-0096: strikethrough Alt+Shift+5 off-Mac, ⌃⇧\` on macOS | K2 PASS | **Yes** → ⇧⌘X / Ctrl+Shift+X |
| ADR-0096: view switch is Ctrl+/ off-Mac | K4 PASS | **No** (D11); F6 is added as a second key |
| ADR-0090: Exit has no accelerator | (W4: Exit itself verified) | **Yes** → Ctrl+Q |

A new ADR (WI-M0) records D2 and supersedes the two changed clauses by name. ADR-0096 and
ADR-0090 get only a forward link in their Status lines (CLAUDE.md § ADR).

### 5.4 Collisions and defects to fix

| # | Defect | Source | Fix | WI |
|---|---|---|---|---|
| C1 | ⌥⌘Q (Quote) runs Quit | `preferences.ts:200`, `preferences.rs:451`; device P13 W/S (`…mac-device-check.md:136, 212, 274`) | Quote moves to ⇧⌘B (D10); ⌥⌘Q is left unassigned | M1b |
| C2 | ⌘H (Replace) hides mdpro; CodeMirror has no `Mod-h` either | `preferences.ts:185`, `preferences.rs:411`; muda's predefined Hide carries ⌘H fixed (`muda-0.20.0/src/items/predefined.rs:655`) with no accelerator setter; `search/dist/index.js:1030-1037`; device E11 (`:401, 471`) | D13: Replace keeps ⌘H. On macOS the predefined Hide item is replaced by a custom **Hide mdpro** item with no key, `route: rust-hide`, which calls `AppHandle::hide()` (`tauri-2.12.1/src/app.rs:1115-1117`). Source binds `Mod-h` to open CodeMirror's search panel with the replace field focused. M2(a) confirms that with Hide's key gone ⌘H reaches the webview and nothing hides: **confirmed on device** 2026-10-16 (spike `02846d6c`, release profile, dtrack): ⌘H reached the page in W and S and nothing hid, and the keyless Hide mdpro still hid the app. **`rust-hide` is macOS only**: `AppHandle::hide` is `#[cfg(target_os = "macos")]` in tauri 2.12.1, so its call must be cfg-gated or the Windows build fails (the spike's first Windows build failed with E0599). Windows and Linux have no Hide item (`app_menu_has_macos_items`, `menu_quit.rs`). Fix the stale comment `search.ts:10` | M2, M1b |
| C3 | ⌘W on two mac items: File › Close and Window › Close Window | `menu.rs:166`; `menu_submenus.rs:114`; `predefined.rs:336-338` | Drop the predefined Close Window on macOS | M1b |
| C4 | Switch Documents ⌘\` is macOS window cycling | `preferences.ts:226`; device V6 (`:49`) | ⌃Tab / Ctrl+Tab (VMark), item disabled until D255-WI-3d builds it (§ 5.8 row 24) | M1b |
| C5 | Toggle Fullscreen ⌥⌘F binds nothing; macOS supplies ⌃⌘F / fn F (off-Mac F11 comes with D15) | `preferences.ts:225`; `predefined.rs:326-329`; device V5 (`:48, 57`) | macOS: system item, entry shown "(system)"; off-Mac: disabled | M1b, M7 |
| C6 | Off-Mac, Image `Cmd+Ctrl+I` shows as "Ctrl+I", the Italic key | `preferences.ts:213`; `platformLabels.ts:36-40`; `…wi6-wi7…:91` | ⇧⌘I / Ctrl+Shift+I (VMark) | M1b |
| C7 | Off-Mac, ⌥⌘ chords are Ctrl+Alt = AltGr on international layouts; the matcher refuses them there | `preferences.ts:200-203, 233-236`; `useKeyboardShortcuts.ts:72` | D9: Code Fences, Quote and the lists take Typora's Ctrl+Shift keys off-Mac. Math Block, heading level and the table keys keep Ctrl+Alt (still AltGr-limited, stated in Settings). K8 keeps refusing AltGr for character input | M1b |
| C8 | Help › mdpro Help is permanently disabled | `menu_submenus.rs:118-127` | Replace with Keyboard Shortcuts… | M4 |
| C9 | Themes has no checkmark | `menu_submenus.rs:98-107` | `CheckMenuItem`, as View already does (`:63-79`) | M4 |
| C10 | Windows predefined clipboard items enter the Win32 accelerator table; VMark #1354 saw lost keys and broken IME from it | `menu_submenus.rs:21-25`; `predefined.rs:308-321`; VMark `localized/edit_menu.rs:209-222` | **Conditional, one rule with § 5.7:** M2(c) records whether mdpro shows the symptom. If it does, or U10 B is chosen, M5 builds accelerator-free custom Cut / Copy / Paste / Select All **on Windows only** (VMark's override is Windows-only; Linux keeps the predefined items) through the § 5.7 adapter. Otherwise the predefined items stay on every platform | M2, M5 |
| C11 | ⇧⌘L also matches CodeMirror `Mod-Shift-l` | `@codemirror/search/dist/index.js:1035` | D12: Toggle Sidebar keeps ⇧⌘L / Ctrl+Shift+L, and `Mod-Shift-l` is removed from the Source keymap. A composed-keymap test proves ⇧⌘L only toggles the sidebar in Source | M1b |
| C12 | The new heading-level keys are CodeMirror fold keys: ⌥⌘[ / ] fold / unfold code on macOS, Ctrl+Alt+[ / ] fold / unfold all off-Mac; the basic setup loads `foldKeymap` | `@codemirror/language/dist/index.js:1502-1506`; `@uiw/codemirror-extensions-basic-setup/esm/index.js:65-66` | Pass `foldKeymap: false` to the basic setup and re-add fold under its off-Mac keys only (Ctrl+Shift+[ / ]), or drop fold keys. The lists take Ctrl+Shift+[ / ] off-Mac (D9), so fold keeps no off-Mac key. A composed-keymap test proves one action per chord in S (K4) | M1b |
| C13 | Shift+digit and shifted-symbol bindings never match: ⇧0 arrives as `event.key ")"` | `useKeyboardShortcuts.ts:91-103`; review #13 (the matcher run in memory) | K8: physical-key fallback for Shift bindings | M1a |
| C14 | Off-Mac predefined Undo / Redo: a click is replayed as synthetic Ctrl+Z / Ctrl+Y through `SendInput`, Tauri documents them as unsupported, and the label cannot become Ctrl+Shift+Z | § 3.2 Undo / Redo row | Custom Undo / Redo items routed to the focused editor's history (§ 5.7) | M5 |
| C15 | The Insert Table dialog title hardcodes `⌘⌥T` on every platform | `src/components/Editor/TableInsertModal/index.tsx:191`; Windows shortcut run `:75` (the delegator's P10 item) | Render the effective chord for the platform from the command table | M1b |
| C16 | WebView2 owns some browser keys: Ctrl+Shift+I may open DevTools depending on build and settings; F6 moves focus between browser panes | `wry-0.57.0/src/webview2/mod.rs:649-651` (`SetAreBrowserAcceleratorKeysEnabled`); [Microsoft's WebView2 shortcut list](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/browser-features#additional-keyboard-shortcuts-information) | M2 probes release and dev builds. Ctrl+Tab and Ctrl+Shift+T are not assumed taken, because WebView2 turns their browser actions off | M2, M6 |
| C17 | **One chord, two actions in Source.** ⌥⌘↑ / ↓ (Ctrl+Alt+↑ / ↓ off-Mac) runs CodeMirror's `addCursorAbove` / `Below` on the editor element, then bubbles to the hook's window listener, whose table branch has no `inCodeMirror` check (`useKeyboardShortcuts.ts:223-243`, listener `:254`) and calls `dispatchSourceTableAction` (`App.tsx` `handleTableShortcut`). Inside a Source table the user gets a new cursor **and** a new row; outside it, a cursor and a logged no-op table action | `@codemirror/commands/dist/index.js:1769` (`defaultKeymap`); review #12 | One owner per context (K4): the table key acts only when the selection is inside a table, and then CodeMirror's add-cursor does not run (the table binding moves into a CodeMirror keymap at higher precedence that returns `false` outside a table); outside a table, add-cursor alone. WYSIWYG keeps the table key alone (ProseMirror binds no add-cursor). A composed-keymap test proves one action per chord, inside and outside a table, in both modes | M1b |

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
| `route` | **per platform**: `frontend` (a `menu:action` the dispatcher runs), `native` (a predefined item; no log line from the frontend), `rust-quit` (Exit and the escape item, handled in Rust, logged there), `rust-hide` (macOS Hide mdpro, D13: `AppHandle::hide()` in Rust, logged there; macOS only, no Windows or Linux item, and the call is cfg-gated, C2), `unavailable` (never dispatched). Undo / Redo are `native` on macOS and `frontend` off-Mac (§ 5.7); Cut / Copy / Paste / Select All are `native` unless C10 builds the Windows items |
| `nativeBehaviour` | optional text for Settings, e.g. "WYSIWYG: browser find bar" (§ 5.2) |

- **Routes are exhaustive.** The dispatcher and the Rust id → action map both `match` on
  `route` without a wildcard arm (rule 60 § Enum completeness). An `unavailable` id is
  present, disabled, and refused with a log line if a stale event ever carries it.
- **Ledger discovery**: the ledger scanner reads `MENU_*` ids from `menu.rs` only
  (`scripts/ledger/declared.mjs:95-98`). The WI that moves ids out of `menu.rs` extends
  the scanner to the new file in the same commit.
- **Accelerators come from the stored keys, at menu build.** The generated JSON carries
  defaults only. When Rust builds the menu (startup, and every rebuild M4 / M5 already do),
  each `configurable` item's accelerator is resolved from the loaded, migrated preferences,
  **through the same conflict filter as § 5.6** (review #8): a stored chord that § 5.6 marks
  active → that chord; a stored chord that § 5.6 keeps but does not bind (it collides with a
  fixed, native, reserved or editor-owned chord, e.g. a custom Save on ⌘Z) → **no
  accelerator**, so the menu can neither show it nor fire it; `<unassigned>` and
  `<system>` → no accelerator; a value that fails to parse → no accelerator and a
  `ui.menu.accelerator` warn line. Rust and the frontend call one filter, generated from the
  command table, so the hook and the menu cannot disagree about which chord is active. `fixed` items keep the table's key. A rebind made in Settings reaches the menu
  label at the next build, not live; live re-registration stays M8. Until then Settings says
  so under the recorder ("the menu shows the new key after restart").
- **Availability follows the focused window, and fails closed.** Rust keeps one "last view
  mode reported by any window" today (`menu_recent.rs:50-55, 110-128`), and focusing a
  window does not refresh it. The menu state becomes per window: each window reports its
  mode on focus and on every mode change, and Rust enables items from the **focused**
  window's mode. With no focused window that has reported (none focused, the reporter closed,
  a report not yet arrived), **mode-limited items are disabled**; `both` items stay enabled.
  A failed `set_enabled` is logged (`ui.menu.availability` fail) and is not fatal, because
  the click-time check below still refuses the action.
- **A click is bound to its window and checked again there**
  ([D261](20260912-frontend-backend-sequencing-order.md#d261), owned by D261-WI-1, before
  M3). Rust resolves the target window when the menu event arrives, synchronously, and sends
  the action to that window only (`emit_to`); the frontend's async `isFocused()` query and
  its fail-open branch (`useMenuEvents.ts:120-126`) go. The target window turns the event
  into a **target token** when it receives it: window label, active document id and an
  editor generation (a counter, new in D261-WI-1, that the editor stores bump on every editor mount and every
  document switch, so switching away and back yields a new generation). Today's handlers
  receive only an action id (`MenuHandlers`, `useMenuEvents.ts:65-70`); D261-WI-1 passes the
  token to every handler. **The token is checked at the final mutation**, not only at
  dispatch: every await and every deferred callback re-checks it immediately before it
  touches a document or editor, and abandons with a `ui.menu.select` `stale` line if it no
  longer matches. The Insert Table dialog is the deferred case today: its submit callback
  fetches the live editor when the user confirms (`App.tsx:743-746`), possibly after a
  document switch, so the callback captures the token at open and checks it at submit.
  It also checks the mode before acting: an item that the menu showed enabled but the mode
  no longer allows is refused with the existing Source-mode toast pattern (`App.tsx:732-737`, `triggerTableInsert`),
  never silently. The same check covers off-Mac, where the menu stays one app-wide menu as
  today: a menu's enabled state is a hint there, and the click-time check is the guard.
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
  file back once. A failed write leaves the in-memory result migrated and retries on the
  next load. A corrupt file follows today's parse-error path unchanged. A second load is a
  no-op. The frontend never migrates.
- **Two loaders, so the lock is taken once** (review #28). `preferences_rw_lock`
  (`services/preferences.rs:49-55`) is a non-reentrant `std::sync::Mutex`, and **six**
  callers already hold it when they call `load_preferences()`:
  - `set_preferences` (`commands/preferences.rs:73-80`);
  - `save_window_state` (`:170-176`);
  - `apply_logging_settings` (`commands/logging.rs:99-104`);
  - the window-geometry save (`commands/window.rs:134-138`);
  - `read_stored_geometry_in` (`services/window_restore.rs:150-156`);
  - `persist_server_enabled` (`services/preferences_mcp.rs:43-46`).

  The MCP gate readers also take the lock (`services/mcp_launch.rs:91-100`), but they read
  the raw bytes and never call the loader. A load that took the lock again would deadlock
  the six. So M1a splits the loader: a public `load_preferences()` takes the lock and calls
  an internal `load_preferences_locked(&guard)`, which reads, migrates and writes back under
  the caller's guard. The six callers pass the guard they hold; every other caller keeps the
  public one. Two windows starting at once still migrate once.
- **No path can re-enter the lock by accident.** Two more things would deadlock even after
  the six are converted:
  - **The logger.** It loads its settings once, lazily, from `load_preferences()`
    (`services/logger.rs:90-95`, `settings_cache`). If the first log line of a run is written
    inside a lock span (the migration's own `prefs.migrate` line included), the public
    loader would wait on the lock that thread already holds. M1a gives the logger a
    read-only parse of the `logging` section, which takes no lock and never migrates or
    writes, like the MCP gate's raw read. Logging settings are not part of the key
    migration.
  - **A caller added later.** The guard becomes a type (`PrefsGuard`) that marks its thread
    while held, so a public load on a marked thread returns a `ReentrantLoad` error, with a
    `debug_assert!`, instead of hanging.

  Tests: each of the six callers runs the migration under its own guard without deadlock; a
  cold logger cache writes its first line inside a lock span; a public load on a guarded
  thread returns `ReentrantLoad`; a writer holding the lock while a second thread loads (it
  waits, then sees the written file).
- **The version moves only when the map is complete** (review #29). M1a lands the
  migration code with `CURRENT_KEYBOARD_SHORTCUTS_VERSION = 1` and an empty map: a load
  writes nothing and never stamps version 2. M1b sets the constant to 2 and installs the
  full v1 → v2 map in the same commit. A test loads a v0.3.5 file under M1a's code (unchanged,
  still version 1, byte-identical) and then under M1b's (migrated once).
- **Downgrade is tested with a real old-build write** (review #7). A v0.3.5 build's Rust
  struct has no version field and repairs only `""`: it reads version 2's values as custom
  ones, reads `"<unassigned>"` and the other § 5.6 states as unparseable chords that match
  nothing, and drops `keyboardShortcutsVersion` the next time it writes. Re-upgrading then
  sees version 1 again and re-runs the map, which changes only values still equal to a
  version-1 default. That is the accepted cost. M1b commits, as a fixture, a file written by
  a v0.3.5 build after it read a version-2 file (`tests/fixtures/`, captured on device), and
  tests the re-upgrade from it.
- **Collisions are refused, not introduced.** After migration, each chord is normalised
  per platform (`Cmd+I` and `Cmd+Ctrl+I` off-Mac are the same chord, C6). Two commands
  collide when they share a chord in a shared context: their availability (`both` / `W` /
  `S`) intersects, so a W-only and an S-only command may share one. The check covers three
  kinds of owner, not only defaults (review #8):
  - **a new configurable default**: if a kept custom value now collides with one, for
    example a custom Save on ⇧⌘T against Table, the **default** loses. That command is
    stored `<unassigned>`, and Settings shows the conflict once. The custom value is never
    changed.
  - **a fixed, native or reserved chord** (Undo, Redo, Quit / Exit, Cut / Copy / Paste /
    Select All, the native items and K5's list): the custom value cannot win, because the
    OS or the editor's own history keeps the chord. It stays stored, is **not bound**, and
    its Settings row shows "Conflicts with Undo, not active" until the user rebinds it. A
    custom Save on ⌘Z is this case.
  - **an editor-owned binding** that stays after M1b (CodeMirror's `defaultKeymap` and
    `searchKeymap` entries without a Settings row, such as `Mod-d`, and Milkdown's
    remaining preset keys): treated as fixed, as above. M1a's table lists them, read from
    the composed keymaps, and a test fails when one is added without a row.

  Settings' own conflict check (`KeyboardShortcutsSettings.tsx:124-134, 183-191`) uses the
  same normalisation and owner list, and refuses Save on any of these conflicts.
- **New persisted states.** Today an empty string is repaired to the default on every read
  (`models/preferences.rs:310-352`, ADR-0031 step 4, decision D-b, whose recorded cost
  says reversing it needs a new ADR). The new states are explicit values, not `""`:
  `"<unassigned>"` and `"<system>"` (Jump to Top / Bottom, mac Full Screen). The
  `"<merged:editFind>"` state of the r2 plan is dropped: Replace keeps its own key (D13). `""` keeps its ADR-0031 meaning. Reset restores the
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
  paste is handled by editor plugins (`MilkdownEditor.tsx:164-165`, `imagePastePlugin.ts`
  `handlePaste` `:241`, `table/pasteWidenAlignment.ts`), and no first-party code calls
  `navigator.clipboard` or `execCommand` for the editors. Custom items are built only if M2(c)
  shows mdpro has VMark #1354's symptoms, or the user chooses parity (U10 B). If they are
  built, this is the adapter:
  - **Formats.** WYSIWYG Copy / Cut write `text/html` and `text/plain` from ProseMirror's
    own `view.serializeForClipboard(slice)` (`prosemirror-view@1.41.5`, `dist/index.js:5768`),
    the serializer a keyboard copy uses. Source writes `text/plain` of the selection.
    WYSIWYG Paste reads `text/html` when present, else `text/plain`, and hands it to
    `view.pasteHTML` / `view.pasteText` (`:5751`, `:5757`), which run the same `handlePaste`
    props and `transformPasted` a keyboard paste runs, so sanitising and table handling
    apply. Image **files** on the clipboard are out of scope for the menu item (the keyboard
    path keeps them); the item says so in its log line. Source Paste inserts `text/plain`
    as one CodeMirror transaction.
  - **API and permission: decided by M2(c), not assumed.** A menu click is not a user
    activation inside the webview, so the async Clipboard API may refuse it. M2(c) tries,
    in WebView2 release and dev builds: `navigator.clipboard.write` / `read` with
    `ClipboardItem`, and `document.execCommand("copy" | "cut")` on the focused editor. If
    neither works without a prompt, the adapter uses Tauri's `clipboard-manager` plugin. That
    is a new dependency, so it needs its own ADR and the capability entries
    (`clipboard-manager:allow-read-text`, `allow-write-text`, `allow-write-html`). The record
    names the API chosen and the permission it needs. M5 does not start on the clipboard
    items without it.
  - **Revalidation across awaits.** Before the first await the adapter pins the window
    label, the active document id, the editor instance and the selection. WYSIWYG pins the
    ProseMirror `doc` node and the full `Selection`; Source pins CodeMirror's `state.doc`
    object and the whole `EditorSelection` (every range, not only the main one). Both doc
    objects are immutable and replaced on every change, so an identity check (`===`)
    catches any edit, including one that keeps the length (review #15). After every await it
    checks them again. If any changed, Copy has already written and stops; Cut and Paste
    abandon without touching the document and log `stale`. Cut deletes only after the write
    resolved, as one transaction and one undo step. A failed write leaves the selection
    intact and logs it. Composition (IME) in progress refuses the action.

  Otherwise the predefined items stay.
- **Exit Ctrl+Q needs a new IPC command.** The frontend can only reply to a quit request
  (`quitGuardService.ts:94-122`, `quit_guard_reply`). The request itself is private Rust
  (`menu.rs:259-269`). M6 adds `request_quit`: a `#[tauri::command]` that calls the same
  `request_guarded_quit` path, a typed wrapper in `quitGuardService.ts`, a
  `app.quit.request` log line, a ledger row and the CLAUDE.md "Key commands" entry. A
  second request while one is in flight joins it; it never starts a second round.

### 5.8 D255: what each no-effect action becomes

D255's 26 actions (the [audit](../test/20261016-shortcuts-mac-audit.md)'s "no effect" set) with
the key from § 5.3.2 and a **proposed** disposition. "Build" means the command is feasible with
what the code already has; "triage" means D255-WI-1 must establish it first; "disabled" stays
under D3. **D255-WI-1 confirms or corrects every row before any D255 implementation starts**, in
a docs commit to this section; the row's WI then owns the code and its tests. An enabled row
changes the command table's `availability`, and M4 / M5 / M7 render it from there.

**D255-WI-1 triage (2026-10-16, code read on `712d9452`).** All 26 rows were checked against the
code. Five were corrected: rows 4, 5 and 25 (preset citations), 6 (Underline: WI-1 proposed
disabling it; the user chose 「Build an underline mark」 instead), 7 (Image: a new command is needed, and an untitled document
refuses), 18–19 (WYSIWYG heading level: a new command, not `headingPlugin`) and 24 (MRU
citation). Every other row was confirmed as written. Rows 9 and 10 stay open until M2(c) has
recorded the clipboard API. Only the WYSIWYG find / replace popup (21–23, 26 W) needs a
prototype (U12). Row 7's URL / alt-text popup is needed only if the user asks for more than a
file picker.

| # | Action (gap) | Key (mac / Win) | Proposed disposition | Basis | Owner |
|---|---|---|---|---|---|
| 1 | Save As (both) | ⇧⌘S / Ctrl+Shift+S | **Build**, both modes | Untitled ⌘S already runs `save_file_dialog` (ledger `:75`); Save As reuses it for a titled document (`fileService.ts:109`, D111's Save As fields) | D255-WI-3d |
| 2 | Toggle Fullscreen (both) | system fn F / F11 | macOS: the system item (C5). Off-Mac: **build** F11 (D15) | Tauri's window `setFullscreen`; needs the `core:window:allow-set-fullscreen` capability | D255-WI-3d |
| 3 | Math Block (both) | ⌥⇧⌘M / Ctrl+Alt+Shift+M | **Build in Source** (insert a `$$` block); **disabled in WYSIWYG** | WYSIWYG has no math node (CLAUDE.md § Typora-Parity Phase 1) | D255-WI-3a |
| 4 | Ordered List (both) | ⌥⌘O / Ctrl+Shift+[ | WYSIWYG through M3 (preset command); **build in Source** (toggle `1. ` on the selected lines) | preset `wrapInOrderedListCommand` `:1367`, registered: `MilkdownEditor.tsx:28` uses `mdproCommonmark`, whose `commonmark` list includes `commands` (WI-1) | M3; D255-WI-3a |
| 5 | Unordered List (both) | ⌥⌘U / Ctrl+Shift+] | As 4, with `- ` | preset `wrapInBulletListCommand` `:1263` (WI-1) | M3; D255-WI-3a |
| 6 | Underline (both) | ⌘U / Ctrl+U | **Build, both modes** (user decision 2026-10-16, relayed by the delegator: 「Build an underline mark」). WYSIWYG: a Milkdown underline mark that parses and serialises `<u>…</u>`, so the editor shows a real underline; Source: ⌘U / Ctrl+U wraps the selection in `<u>…</u>`. WI-1 had proposed disabled in both modes (D3); M0's ADR records the decision with its three options: disabled, a mark, Source-only | Markdown has no underline; Milkdown has no mark today. The export sanitizer keeps `u` (`services/markdown.rs:426`, test `:1046`), but WYSIWYG would not show it: preset-commonmark's `html` node renders inline HTML as an atom whose text is the raw tag (`lib/index.js:1594-1610`), so `<u>x</u>` reads as literal tags around a plain `x`. A Source-only build would write markup that WYSIWYG shows as raw tags, which is why the mark is built. remark reads `<u>x</u>` as three inline nodes (`html`, `text`, `html`), so the mark's parser pairs the opening and closing tag before the `html` node takes them | D255-WI-3b (both modes) |
| 7 | Image (both) | ⇧⌘I / Ctrl+Shift+I | **Build** with a native file picker: WYSIWYG `insertImageCommand`, Source `![](path)`. The picked file is copied into the asset folder by the existing `copy_external_image` (`commands/image.rs:425`); paste uploads bytes instead, so its path does not apply. There is no frontend dialog plugin, so the picker is a **new Rust command** (`pick_image`) on `rfd` (precedent `commands/file.rs:1182`). An **untitled document refuses** with the toast paste shows ("Save the document before pasting images", `imagePastePlugin.ts:84-85`) and inserts nothing. A URL / alt-text popup, if wanted, is a U12 prototype (WI-1) | `lib/index.js:975`; `rfd` is already a dependency (`src-tauri/Cargo.toml:35`). A new command adds a ledger row and the CLAUDE.md key-commands check | D255-WI-3b |
| 8 | Clear Format (both) | ⌘\\ / Ctrl+\\ | **Build in WYSIWYG** (remove every mark in the selection); **triage** Source (stripping inline syntax by pattern can damage text) | ProseMirror `removeMark` | D255-WI-3b |
| 9 | Copy as Markdown (both) | ⇧⌘C / Ctrl+Shift+C | **Triage**: WYSIWYG serialises the selection with Milkdown's serializer; Source is a plain copy. Needs a clipboard write without a user activation (M2(c)). **Still open after WI-1**: the only clipboard use in `src/` is a button's `navigator.clipboard.writeText` (`IntegrationsSettings.tsx:167`, which has a user activation), and there is no clipboard plugin | as § 5.7 | D255-WI-1, after M2(c) |
| 10 | Paste as Plain Text (both) | ⇧⌘V / Ctrl+Shift+V | **Triage**: WYSIWYG `view.pasteText`; Source pastes plain text already. Needs a clipboard read (M2(c)). Windows WYSIWYG already does it natively (§ 5.2). **Still open after WI-1**, as row 9 | as § 5.7 | D255-WI-1, after M2(c) |
| 11 | Select Line (both) | ⌘L / Ctrl+L | **Build**: Source CodeMirror `selectLine` (`@codemirror/commands/dist/index.js:1057`); WYSIWYG selects the enclosing text block | — | D255-WI-3a, 3b |
| 12 | Delete Word (both) | unassigned | **Build in Source** (`deleteGroupBackward`, `:1244`), menu-only; WYSIWYG **triage** (⌥⌫ / Ctrl+Backspace already delete a word natively) | — | D255-WI-3a |
| 13–16 | Bold, Italic, Code, Strikethrough (Source) | ⌘B, ⌘I, ⇧⌘\`, ⇧⌘X | **Build**: toggle `**`, `*`, `` ` ``, `~~` around the selection | — | D255-WI-3a |
| 17 | Code Fences (Source) | ⌥⌘C / Ctrl+Shift+K | **Build**: wrap the selected lines in a fence | — | D255-WI-3a |
| 18–19 | Increase / Decrease Heading (WYSIWYG) | ⌥⌘] / ⌥⌘[ | **Build**: a **new ProseMirror** heading-level ± 1 command beside `makeHeadingCommand` (`typoraKeymapPlugin.ts:72`, `setBlockType` on `state.schema.nodes.heading`) (WI-1) | `src/plugins/codemirror/headingPlugin.ts` is CodeMirror only (`supportedModes: ["codemirror"]`). Its `:110-111` already run ± 1 in Source and stay M1b's key consumer | D255-WI-3b |
| 20 | Select Word (WYSIWYG) | ⌘D / Ctrl+D | **Build**: select the word at the cursor | — | D255-WI-3b |
| 21–23 | Find, Find Next, Find Previous (WYSIWYG) | ⌘F, ⌘G, ⇧⌘G | **Build after the prototype**: mdpro's find / replace popup, picked by the user (U12). Settles U11 | D255 row: the user's words | D255-WI-2, 3c |
| 24 | Switch Documents (OS-owned ⌘\`) | ⌃Tab / Ctrl+Tab | **Build**: switch to the most recently used tab | `tabStore.ts` `switchToTab` `:230`; MRU is `lastActiveAt` (`:44`, set on switch `:252`, sorted `:349`) (WI-1) | D255-WI-3d |
| 25 | Quote (OS-owned ⌥⌘Q) | ⇧⌘B / Ctrl+Shift+Q | WYSIWYG through M3; **build in Source** (toggle `> `) | preset `wrapInBlockquoteCommand` `:754` (WI-1) | M3; D255-WI-3a |
| 26 | Replace (OS-owned ⌘H) | ⌘H / Ctrl+H (D13) | Source: **M1b** binds `Mod-h` to CodeMirror's search panel with the replace field focused, once C2 frees ⌘H from Hide; WYSIWYG: the popup of 21–23 | `@codemirror/search` `openSearchPanel` | M1b; D255-WI-3c |

## 6. Work items

Branch per item, `<type>/<id>-<slug>` off `master` in its own worktree, landed by the
delegator (rule 70). The D or WI prefix for receipts comes from the delegator.

**Every landed WI is coherent on its own.** A default key changes in the same commit as
every consumer of it: the command table, the Rust menu literal, the CodeMirror and Milkdown
keymaps, Settings, the Table dialog hint (C15), the sidebar tooltip
(ADR-0088), the migration and the ledger row. No intermediate commit advertises a key that
does not run. A default whose consumer arrives in a later WI moves with that WI
(review #24): the Windows Redo label Ctrl+Shift+Z ships with M5's custom items, and Exit
Ctrl+Q with M6's `request_quit`. F6 (the second key, D11) and D9's off-Mac keys need only hook
and keymap bindings, so they ship in M1b with those bindings.

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
| **M2** | **Disposable spike, never landed.** A `spike/menu-m2` branch with temporary handlers and items: (a) Quote no longer needs a probe (⇧⌘B, D10); instead, with the predefined Hide replaced by a keyless custom item, ⌘H reaches the webview in W and in S, nothing hides, and the menu's Hide mdpro still hides the app (D13, C2); (b) ⌃Tab and F6 reach the webview on macOS; (c) Windows typing, IME and paste after a menu Copy and after Ctrl+C (C10), **and the clipboard API probe of § 5.7** (async Clipboard API and `execCommand` from a menu click, release and dev builds); (d) Ctrl+Shift+0 on Windows, and on an AltGr layout (German) **both** that each Ctrl+Alt chord types its character in the editor and that D9's Ctrl+Shift keys run their command; (e) Ctrl+Shift+I, F6, Ctrl+Tab, and D9's Ctrl+Shift+K, Ctrl+Shift+Q and Ctrl+Shift+[ / ], in WebView2 release and dev builds (C16); (f) whether a menu accelerator fires on Windows with focus on the native window rather than the webview (K4) | the spike branch, deleted after the record lands (rule 25); brief under `docs/pending/`, record under `docs/test/` | none (spike) | none | Feeds M0 |
| **D255-WI-1** | **Triage, docs only.** Confirms or corrects every § 5.8 row with a code read or a probe on the spike, records the clipboard API from M2(c), and names the rows that need a prototype (U12) | this plan § 5.8 | none (docs) | none | Feeds M0 |
| **M0** | Write the ADR **after M2's record and D255-WI-1**: D1–D17 quoted as § 0 records them, the answers to U10–U12 when given, rules K1–K8, the § 5.3.2 table and § 5.8 dispositions by reference, the § 5.5 table format, the § 5.6 states, and the superseded clauses of § 5.3.4 plus ADR-0031 step 4 D-b | `docs/adr/NNNN-…md` (number from the delegator when it is written); Status-line forward links in ADR-0096, ADR-0090 and ADR-0031 | none (docs) | none | **Yes**, this one |
| **M1a** | The contract, **no default changes**: the command table (§ 5.5) with today's keys and per-platform routes; the generated Rust JSON and its parity test; the matcher's K8 fix (C13); the reserved-chord test (K5); the editor-owned chord list (§ 5.6); `keyboardShortcutsVersion` with `CURRENT_KEYBOARD_SHORTCUTS_VERSION = 1`, the § 5.6 states and the three-owner collision check; the loader split (`load_preferences` / `load_preferences_locked`) with all six held-lock callers converted, the `PrefsGuard` re-entry check and the logger's lock-free settings read (§ 5.6); the migration code with an empty map | new `src/commands/commandTable.ts`, `src-tauri/src/menu_layout.json`, `src/hooks/useKeyboardShortcuts.ts`, `src/types/preferences.ts` (extracted), `src-tauri/src/models/preferences.rs` (extracted), `src-tauri/src/services/preferences.rs`, `src-tauri/src/commands/preferences.rs`, `src-tauri/src/services/preferences_mcp.rs`, `src-tauri/src/commands/logging.rs`, `src-tauri/src/commands/window.rs`, `src-tauri/src/services/window_restore.rs`, `src-tauri/src/services/logger.rs`, `tests/fixtures/preferences-contract.json`, `KeyboardShortcutsSettings.tsx` (conflict check only) | Matcher: real `event.key` / `event.code` pairs for ⇧0, ⌃⇧0, Alt+Shift+0, ⇧⌘\`, a German layout's shifted symbols, and AltGr refused. Loader: each of the six held-lock callers runs a migrating load under its own guard without deadlock; a cold logger cache logs its first line inside a lock span; a public load on a guarded thread returns `ReentrantLoad`; a writer holding the lock while a second thread loads (it waits). Migration with the empty map: a v0.3.5 file stays byte-identical and version 1; missing field, legacy `""`, a corrupt file. Collisions: a custom value against a new default, against a fixed key (custom Save on ⌘Z: kept, not bound, flagged, **and resolved to no menu accelerator** by the shared filter), against an editor-owned chord, and two commands sharing a chord in disjoint modes (allowed). States survive load, save and Reset. Parity: TS table = Rust JSON | "快捷键改键" `:416` (states and conflicts) | Needs M0 accepted |
| **D261-WI-1** | [D261](20260912-frontend-backend-sequencing-order.md#d261): a menu action is bound to its window. Rust resolves the focused window when the menu event arrives and `emit_to`s it; the frontend drops the async `isFocused()` query and its fail-open branch, turns the event into a target token (window, document id, editor generation) passed to every handler, and checks it at each final mutation, deferred callbacks included (§ 5.5) | `src-tauri/src/menu.rs` (event → target window), `src/hooks/useMenuEvents.ts` (handler signature), `src/stores/milkdownEditorStore.ts` and `editorStore.ts` (the generation counter), `src/App.tsx` (the Table dialog's submit) | Rust: the target is the window focused at event time; with none focused, editor and document actions are dropped with a log line and app-level ones (New, New Window, Open, Settings) keep today's handling. TS: focus changes after the click and before the handler runs → the action runs in the clicked window only; the document is switched during an await → `stale`, nothing applied; **switching away and back** during an await → `stale` (the generation moved); the Insert Table dialog opened from the menu, the document switched, then Insert pressed → nothing inserted into the other document, `stale` logged; two windows → exactly one acts. Receipts `D261-WI-*` | the menu rows that cite `useMenuEvents` (`:122`–`:125`) | No |
| **M3** | Editor command dispatcher: `menu:action` `editor.<command>` routed to Milkdown in W and CodeMirror in S, reusing existing commands (`typoraKeymapPlugin.ts:61-113`, `headingPlugin`, `insertLinkCommand`, `triggerTableInsert`, highlight, **Milkdown's blockquote and list commands**). Availability per § 5.5, per window, failing closed; the mode re-checked at click time | new `src/utils/editorMenuCommands.ts`, `src/hooks/useMenuEvents.ts` (split out `menuActionTable.ts`), `src-tauri/src/menu.rs`, `src-tauri/src/menu_recent.rs` (per-window mode) | TS: command × mode matrix, through the composed editor keymaps rather than a single `keydownHandler`, with the hook's window listener attached (it runs in its mode, is refused with a toast and logged in the other); an `unavailable` id is never dispatched; every route is matched with no wildcard. Focus: two windows in different modes, focus switches, a window closing, the mode reported late, **no focused window (mode-limited items disabled)**; a menu event while a modal or the Settings recorder has focus is not applied to the editor. Rust: id → action covers every `MENU_*` id; **a failed `set_enabled` is logged and the click-time check still refuses** | menu route added to `:122`–`:125` | No |
| **M7** | Settings shows every entry (D3) with its capability (§ 5.5), as DESIGN.md's block **specifies normatively** (D8), grouped per D14. Before M1b, so the new states have a presentation when M1b first stores them. The recorder accepts F1–F12 alone. The 9 contract fields missing from the page (ledger `:416`) are added the same way | `src/components/common/settings/KeyboardShortcutsSettings.tsx` (split), `src/utils/platformLabels.ts` | Component, one case per row state of DESIGN's block: "Not available" (muted name, no key button, a click starts no recording, Save does not write it); "WYSIWYG only" / "Source only" (key button works, capability line under the name); system and fixed rows (key in a non-editable dashed box, not a button); Replace as an ordinary row with its own key (D13); a conflict flagged by § 5.6; second keys (F3, and U3 / U5 if chosen) shown as fixed. No changed-default banner. Reset restores `<unassigned>` where that is the default; F6 records; conflict detection ignores unavailable rows; the group of each added entry matches U6 | "快捷键改键" `:416` and `:427` | No |
| **M1b** | Default keys § 5.3.2 on both platforms, with D9–D13, D16 and D17 applied; C2's keyless Hide mdpro item (`rust-hide`, macOS only: the `AppHandle::hide` call cfg-gated to macOS, no Hide item off-Mac) and Source's `Mod-h`; C1–C7, C11, C12, C15, C17; `CURRENT_KEYBOARD_SHORTCUTS_VERSION = 2` and the full v1 → v2 map in one commit; drop the mac Close Window (C3); remove or rebind the editor keys K4 names (fold, `Mod-Shift-b` off-Mac, `Mod-Alt-0…8`, CodeMirror's `Mod-Shift-l`, off-Mac `Mod-Alt-\`); [D264](20260912-frontend-backend-sequencing-order.md#d264): in Source off-Mac, an AltGr guard at high precedence lets Ctrl+Alt+<printable character that differs from the key's base> through to input, so no Ctrl-Alt binding, present or later, eats an AltGr character (CodeMirror's own AltGr check, `@codemirror/view/dist/index.js:8944`, only skips the base-key fallback); F6 bound in the hook as the fixed second key (D11); **the hook's Source table branch removed** when the table keys move into the CodeMirror keymap (C17: raising the new binding's precedence alone would still let the window listener run the action); each changed key with **every** consumer (see above), including `highlightPlugin.ts:65-68` and `headingPlugin.ts:109-111`. Not here: the Windows Redo label (M5) and Exit Ctrl+Q (M6) | the command table, `typoraKeymapPlugin.ts` (extracted; its header `:7-20` still says the editor `.use`s gfm only, so commonmark's commands are unregistered, which is stale since `mdproCommonmark` (`MilkdownEditor.tsx:28`); corrected here under rule 22, found by D255-WI-1), `highlightPlugin.ts`, `headingPlugin.ts`, the CodeMirror basic-setup options and a table keymap for C17, `menu.rs` / `menu_submenus.rs`, `TableInsertModal/index.tsx`, the sidebar tooltip, `search.ts` (header comment: it says `Cmd+H` opens Find & Replace, but `searchKeymap` has no `Mod-h` until this WI binds it; found by D255-WI-1), `src/hooks/useKeyboardShortcuts.ts` | Per changed chord, through the composed keymaps in both modes, the § 6.1 per-chord table: the new key runs its command once; **the old mdpro assignment no longer runs its command**, and what the old chord does instead is its expected owner (otherwise nothing). ⌘H opens Replace in Source, does nothing in WYSIWYG until D255-WI-3c, and never hides the app. ⇧⌘L toggles the sidebar in Source and selects no matches (D12); ⇧⌘B runs Quote in WYSIWYG, Ctrl+Shift+B does nothing off-Mac (D10, D9). ⌥⌘] / Ctrl+Alt+] changes the heading level and folds nothing; F3 / Shift+F3 still step the Source search; ⌥⌘↑ inside a Source table inserts a row and adds no cursor, outside it adds a cursor and logs no table action (C17), with the hook's window listener attached, so the removed branch is proved gone. [D264](20260912-frontend-backend-sequencing-order.md#d264): the composed Source keymap off-Mac, with ctrlKey + altKey and key `[`, `]`, `\`, `{`, `@` → no command runs and the default is not prevented; the device check runs in the Windows menu batch on German QWERTZ. Migration: an upgrade through M1a's and M1b's code, each changed default, and the re-upgrade from the v0.3.5-written fixture (§ 5.6); `window_menu_has_close(os)`; on macOS the app menu's Hide mdpro has no accelerator and routes `rust-hide` | "粗体 / 斜体" `:122`, "标题 1–6 与正文" `:123`, "删除线" `:125`, "高亮选区" `:129`, "查找与替换" `:233`, "视图模式切换" `:292`, "原生 Window 菜单" `:442`, "插入表格对话框" `:188`, "快捷键改键" `:416` | Covered by M0 |
| **M4** | macOS tree § 5.1, rendered from the command table, every item the table marks unavailable at that commit disabled (D3), C8, C9, Bring All to Front, "Settings…" (D5) | `src-tauri/src/menu.rs`, new `menu_paragraph.rs` / `menu_format.rs` / `menu_edit.rs`, `menu_submenus.rs`, `scripts/ledger/declared.mjs` (scan the new files) | Rust: the production builder consumes `menu_layout.json` and the stored keys through the shared conflict filter (§ 5.5: an active custom chord → that chord; a custom Save on ⌘Z → no accelerator, and ⌘Z stays Undo's; `<unassigned>` → none; unparseable → none and logged), and `menu_layout_for("macos")` → titles, ids, enabled flags as data is that same output; each unavailable id present and disabled, each available one enabled; each new `MENU_*` id handled. The comparison excludes what macOS inserts (DESIGN open item 9: the Help search field, the Window menu's window list, View › Enter Full Screen); the device brief lists them as expected extras | "原生 macOS 菜单栏" `:460`, "应用菜单基础项" `:461`, "另存为" `:75` (disabled menu item), "浅色 / 深色 / 跟随系统" `:326`, a row per new `MENU_*` id (`pnpm ledger:check`) | Covered by M0 |
| **M5** | Windows/Linux tree § 5.2: no app menu, no Window menu, Settings / Exit / escape in File, About in Help, disabled items as M4; custom Undo / Redo (C14, § 5.7) with the Ctrl+Shift+Z label; clipboard items only if M2(c) or U10 B says so, and only with the API M2(c) recorded | `src-tauri/src/menu.rs`, `menu_quit.rs`, `menu_submenus.rs`; the editor history and (if built) clipboard adapters | Rust: `menu_layout_for("windows")` and `("linux")` from the production builder; Exit still routes to `request_guarded_quit` (`menu.rs:225, 259-269`); escape item directly after Exit (`menu_escape_order_tests.rs`). TS: a menu Undo / Redo click runs the focused editor's history once, in W and in S; a Ctrl+Z press runs it once (no hook double-run); **Ctrl+Y and Ctrl+Shift+Z each redo exactly once in both editors** (required, R15). If the clipboard items are built: the § 5.7 formats, sanitiser and table handling on paste, Cut keeps the text when the write fails, a document or selection change during an await abandons Cut and Paste (including an equal-length Source edit, and a change to a secondary range), nothing runs during IME composition, each action is one undo step | "原生 macOS 菜单栏" Windows row `:480`, `:467` and its Windows row, `:468`, "撤销 / 重做" `:145` | Covered by M0 |
| **M6** | Off-Mac Exit: Ctrl+Q through the new `request_quit` command (§ 5.7), its default and its binding in one commit; Settings labels for the off-Mac rows | `src-tauri/src/commands/quit_guard.rs` + `commands/mod.rs` (registration), `src/services/quitGuardService.ts`, `src/hooks/useKeyboardShortcuts.ts`, `src/utils/platformLabels.ts`, CLAUDE.md "Key commands" | Rust: `request_quit` with no guard exits as the menu path does; a second request while one is in flight joins it; **two windows, both dirty**: one round prompts each in turn, exactly as the menu Exit does. TS: Ctrl+Q calls `request_quit` once, never `app.exit`; IPC failure is logged and surfaced; in a release build Ctrl+Shift+I **never opens DevTools**, and runs Image exactly once where the build's command table makes Image available (D255-WI-3b), otherwise nothing (C16; review #38) | "快捷键改键" Windows row `:427`, "插入表格对话框" Windows row `:212`, quit-guard Windows rows, a row for `request_quit` | Covered by M0 |
| **D255-WI-2** | **Prototypes (U12), throwaway.** The WYSIWYG find / replace popup in several variants, and any other new UI D255-WI-1 names, built with `/mattpocock-skills:prototype` on `prototype/d255-<slug>`; the user picks; the verdict is committed there and folded into DESIGN.md by the delegator's word | the prototype branch, its own `mdpro-wt/` worktree; never lands (rule 70 § Questions) | none (prototype) | none | — |
| **D255-WI-3a…d** | **D255's builds, from § 5.8 as D255-WI-1 left it**, in four batches: **a** Source commands (marks, fences, lists, Quote, Math, Select Line, Delete Word); **b** WYSIWYG commands (heading level, Select Word, Select Line, Clear Format, Image) and Underline in both modes (§ 5.8 row 6, user decision 2026-10-16: 「Build an underline mark」); **c** WYSIWYG find and replace from the chosen prototype; **d** file and app (Save As, Switch Documents, off-Mac full screen under U7). Each flips its rows' `availability` in the command table, so the menus and Settings follow | per batch: `editorMenuCommands.ts` and new command modules under `src/utils/` or `src/plugins/`, the command table, `fileService.ts` (Save As), `tabStore.ts` consumers (Switch Documents), Tauri capabilities (full screen), for **b** a new `pick_image` command in `commands/image.rs` registered in `commands/mod.rs` (§ 5.8 row 7), and for **b** the underline mark as a new Milkdown plugin under `src/plugins/milkdown/` used by `MilkdownEditor.tsx` and `tests/helpers/scriptedMilkdownRig.ts` | Per row: the command through the menu and through its key, in each mode the row enables, runs once and is one undo step; disabled modes stay refused with a toast; Save As writes the new path and leaves the old file untouched, cancel writes nothing; Image in an untitled document shows the paste toast and inserts nothing, and a cancelled picker inserts nothing; Underline, as serializer fidelity tests: `<u>x</u>` round-trips byte-identical through WYSIWYG, a document with no underline stays byte-identical on save (the D204 / D209 class), and export keeps `<u>` through the sanitizer (`services/markdown.rs:426`); Switch Documents follows MRU order with one tab and with none; find / replace: next and previous wrap, replace and replace-all are each one undo step, Escape closes and returns focus. Receipts `D255-WI-3a-*` etc. | per row: "另存为" `:75`, the D255 rows of "快捷键改键" `:416`, "查找与替换" `:233`, and one row per new capability | c: the WYSIWYG find scope and look (D255's row: "可能值得一份 ADR") |
| **M8** | (Follow-up, not scheduled) Menu accelerators rebuilt from stored preferences on save, as VMark's `accelerators.rs` does | `menu.rs`, a new Tauri command | to be designed | `:416` | Yes |

Order: **M2 (spike) → D255-WI-1 → M0 → M1a → D261-WI-1 → M3 → M7 → M1b → M4, M5 and
D255-WI-3a…d in parallel → M6.** D255-WI-2 runs any time after D255-WI-1 and must finish
before D255-WI-3c. M2 and D255-WI-1 must finish before M0 is written, because they decide
K3, C10, C16 and the § 5.8 dispositions. M1a lands the contract before any key changes.
D261-WI-1 lands before M3 adds editor commands to the menu path. M3 lands the dispatcher
before the menu advertises new commands. M7 lands before M1b, so the states M1b stores first
have a presentation. The decisions M1b and M7 wait on (U1–U9) are answered. M1b then
changes keys with all their consumers at once. D255's builds follow M1b, because they are
built on the new key table. M8 is outside this plan.

Every behaviour WI rewrites its ledger rows and `CHANGELOG.md` `## [Unreleased]` in the
same commit and runs `pnpm ledger:check` (and `pnpm ledger:build`). Logging follows the
route (§ 5.5, rule 20): `frontend` items log `ui.menu.select` through `useMenuEvents`;
`rust-quit` items log in Rust (`log_menu_exit`, `menu.rs:259-269`), and so does `rust-hide`; `native` items log
nothing and are proved by their effect; `unavailable` items are proved disabled. The
sidebar plan's tooltip text (`20261012-plan-sidebar-toggle-and-resize.md` § 6, ADR-0088)
does not change: the sidebar key stays (D12).

### 6.1 Device checks

Evidence follows the route (§ 5.5): a `frontend` item shows one `ui.menu.select`; a
`rust-quit` item shows its Rust log line; a `native` item shows its effect (the app hides,
the window minimises); an `unavailable` item is greyed and a click does nothing. Every key
is pressed in each focus context of K4 that applies: the editor in W, the editor in S, an
open modal, the Settings recorder.

**Each brief carries a per-chord table** (review #31), generated from the command table of the
build under test: chord, context, expected owner (`hook`, `codemirror`, `milkdown`, `native`,
`none`), expected effect, and the evidence line. "Unavailable" means unavailable **in that
build's table**: an item D255 has built is expected enabled, and an old *(n/a)* marking from
§ 5.1 is not a failure once its row is built.

| Platform | How | What |
|---|---|---|
| macOS | dtrack brief (rule 70 § Device-check batches), batch "menu bar" | Click every item of § 5.1 in W and in S: each shows its route's evidence, or is greyed as that build's table marks it. Two windows in different modes: the menu follows the focused one; with no window focused, mode-limited items are greyed. A click followed at once by a focus change acts in the clicked window only (D261). Press every changed key of § 5.3.2 in both modes: it runs its command once, and the old chord does what the per-chord table expects (⌘H opens Replace in S and never hides the app; the menu's Hide mdpro hides it, with its Rust log line; the old mdpro assignment no longer runs). ⌥⌘] / ⌥⌘[ fold nothing in S; ⌥⌘↑ in and out of a Source table (C17). Re-run P13, E11, V5, V6, F6. Failure: **an editor-command chord** that hides or quits the app (⌘Q and ⌥⌘H keep their meaning), any enabled `frontend` item without a log line, any item enabled that the build's table marks unavailable, any chord that acts twice |
| Windows | `remote-windows-device-test` skill, `menuclick` per item, `menus.txt` dump | `menus.txt` equals § 5.2 with the build's disabled flags. Each changed key runs its command once through its K4 owner: `ui.shortcut.trigger` for hook-owned keys, the editor's effect for editor-owned ones (Undo / Redo, the search keys). Ctrl+Y and Ctrl+Shift+Z redo once in W and in S. Ctrl+Q goes through `request_quit` and the quit guard, with two dirty windows. Menu Undo / Redo in W and S. C10 (if built): type, paste and use IME after a menu Copy. Ctrl+Shift+I in the release build opens no DevTools and runs Image only where it is available; F6 toggles the view (C16). Settings shows the capability rows. **AltGr layout required** (German, installed for the run): each Ctrl+Alt chord left by D9 types its character in the editor, and each of D9's Ctrl+Shift keys runs its command. Without that layout the batch is recorded incomplete, not passed |
| Linux | not available | Recorded as untested (D6) |

### 6.2 DESIGN.md's open items: owners

DESIGN.md's menu block lists ten open items (§ Native menu bar and Keyboard Shortcuts page).
Items 1–6 and 8 are owned as review r2b found. The three without an owner:

| DESIGN item | Owner | How it closes |
|---|---|---|
| 7. Settings groups for Export HTML, Highlight, Undo / Redo, Exit | **D14** (U6, answered); **M7** implements and tests the group of each entry | U6's answer is quoted in M0 and in M7's test |
| 9. Items macOS inserts (Help search, the Window list, View › Enter Full Screen) | **M4** | M4's builder test compares only mdpro's own items; the macOS brief lists the three as expected extras, checked present, not compared |
| 10. D255 shrinks the "not available" set | **D255-WI-1** sets the set; **M4, M5, M7** render it | Every item's state comes from the command table of the build, so DESIGN's look applies to whatever remains unavailable |

DESIGN's rule "their key is still shown" misses one exception the plan makes: Windows Switch
Documents shows no key while it is unavailable (§ 5.2; review #37). DESIGN.md is outside this
revision's file grant, so the fix is handed to the delegator: qualify the rule to "show an
unavailable item's key only where the platform tree gives one".

## 7. Open questions for the user

Moved to **Decisions for the user** at the top (U1–U12; U1–U4 answered, D9–D12), with options and a recommendation
each. The old numbering maps as: 1 → U2, 2 → U3, 3 → U1, 4 → after M2 (M2(d)), 5 → C17
(now a defect with an owner), 6 → U10, 7 → U11.

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
  (`useMenuEvents.ts:120-126`, fail-open). Registered as
  [D261](20260912-frontend-backend-sequencing-order.md#d261) (`8452319c`); **D261-WI-1
  owns the fix and lands before M3** (§ 5.5, § 6).
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

## 10. Scoped re-review revision (2026-10-16)

mdpro-codex-audit re-reviewed the § 9 revision on `525c14c6` (`/cc-suite:review-plan`, two
runs: `review-plan-mvahd3bm-l0gfvz`, thread `01a14303-dcb1-7dd3-9776-3ac7d227efb6`, against
the plan; and r2b against the [shortcut survey](../reference/20261016-keyboard-shortcut-best-practice-survey.md)
and DESIGN.md). Archives: `~/.mdpro-redesign/handoff/mdpro-codex-audit-20261016-1247-review-plan-menu-r2.json`
and `…-1251-review-plan-menu-r2b.json`. Verdict **NEEDS REVISION**, C0 · H13 · M7 · L1 after
mdpro-codex-audit downgraded #34 to Medium (counter-proof
`~/.mdpro-redesign/handoff/mdpro-codex-audit-v035-wip/menu-r2b-d34-counterproof.txt`).
mdpro-a6 revised the plan on the delegator's grant; every finding was checked in code first.
✔ = confirmed in code for this revision.

| # | Sev. | Verified | Where it is addressed |
|---|---|---|---|
| 1 | High | ✔ `insertImageCommand` is in the preset's `commands` (`lib/index.js:975, 1775-1783`) and kept by `mdproCommonmark` | § 2 (a command without a picker), § 5.8 row 7 |
| 7 | High | ✔ A v0.3.5 struct drops the version field on write | § 5.6 downgrade bullet; M1b fixture test |
| 8 | High | ✔ The rule covered only defaults | § 5.6 three-owner collisions; M1a tests |
| 9 | High | ✔ `last_view_mode` is app-wide and never refreshed on focus | § 5.5 fail-closed availability, click-time mode check; M3 tests |
| 10 | High | ✔ (`useMenuEvents.ts:120-126`) | D261-WI-1 before M3; § 5.5; § 8 |
| 12 | High | ✔ **Worse than reported**: in Source ⌥⌘↑ runs add-cursor and then the hook's table action | C17; M1b tests |
| 15 | High | ✔ No clipboard code exists to reuse | § 5.7 formats, API probe, revalidation; M2(c); M5 |
| 18 | High | ✔ The JSON carried defaults only | § 5.5 accelerators from stored keys; per-platform `route`; M4 test |
| 24 | High | ✔ M1b preceded M5's Redo item, M6's F6 / sidebar and M7 | § 6 coherence rule; F6 / sidebar / U1 in M1b; M7 before M1b; new order |
| 25 | High | ✔ | Tests of D261-WI-1, M3 (install failure), M6 (two dirty windows), M1b (downgrade fixture), D255-WI-3 |
| 27 | High | ✔ § 2, M4 and § 6.1 forbade what D7 asked for | § 2 amended; § 5.8; D255-WI-1…3; M0 records D7; M4 and § 6.1 judge by the build's table |
| 28 | High | ✔ Three writers hold the non-reentrant lock when they load | § 5.6 loader split; M1a tests |
| 29 | High | ✔ | § 5.6 version constant; M1a / M1b |
| 30 | Medium | ✔ | C10 rewritten to § 5.7's condition |
| 31 | Medium | ✔ | § 6.1 per-chord table and owner-based oracles; M1b tests |
| 32, 33 | Medium | ✔ Ctrl+H is advertised and bound to nothing today | U5 (survey R3, R2); § 5.3.2 Replace row |
| 34 | Medium (was High) | ✔ (`useKeyboardShortcuts.ts:72`) | U1 decided before M1b; C7 moves to M1b; M2(d) and § 6.1 require an AltGr layout |
| 35 | Medium | ✔ Both editors bind Mod-y | § 5.3.2 Redo row; M5 requires it |
| 36 | Medium | ✔ | M7 normative on DESIGN, per-state cases, U6; § 6.2 |
| 37 | Low | ✔ | § 6.2, handed to the delegator (DESIGN.md is outside the grant) |

Also: the user's menu UI pick is recorded as D8; F3 / Shift+F3 kept as Source second keys
(survey R4); the user's open choices are collected at the top as U1–U12.


## 11. Confirm round and the first answers (2026-10-16)

mdpro-codex-audit's scoped confirm of r3 (`1d39e856`; archive
`~/.mdpro-redesign/handoff/mdpro-codex-audit-20261016-1310-review-plan-menu-r3.json`) closed
32 findings and left **C0 · H5 · M0 · L0**. mdpro-a6 fixed the five on the same branch,
rebased onto `46ff1cdf` (DESIGN.md's #37 fix). The user's answers to U1–U4 came through the
delegator and are recorded as D9–D12 (§ 0).

| # | Sev. | Verified | Where it is addressed |
|---|---|---|---|
| 28 | High | ✔ Three more callers hold the lock when they load: `commands/logging.rs:99-104`, `commands/window.rs:134-138`, `services/window_restore.rs:150-156`. **Also found**: the logger's lazy settings load (`services/logger.rs:90-95`) would deadlock under a locking loader if the run's first log line came inside a lock span | § 5.6: six callers, the logger's lock-free read, `PrefsGuard` re-entry error; M1a files and tests |
| 8 | High | ✔ § 5.5 installed a stored chord without § 5.6's filter | § 5.5 shared conflict filter for accelerators; M1a and M4 tests (custom Save on ⌘Z) |
| 10 | High | ✔ `MenuHandlers` take only an action id (`useMenuEvents.ts:65-70`); the Table dialog fetches the editor at submit (`App.tsx:743-746`) | § 5.5 target token with an editor generation, checked at the final mutation; D261-WI-1 files and tests |
| 15 | High | ✔ | § 5.7: pin the doc object and the full selection, identity check; M5 race test |
| 38 | High | ✔ | M6 and § 6.1: Ctrl+Shift+I never opens DevTools, runs Image only where available |
| 12 (note) | — | ✔ The hook's window listener would still run the Source table action | M1b removes the hook's Source table branch; its test runs with the listener attached |

### 11.1 The answers to U5–U9 (2026-10-16)

Recorded as D13–D17 (§ 0) and applied: the trees (Find and Replace as two items, Hide mdpro
without a key, off-Mac Full Screen F11), K5, the § 5.3.2 Find / Replace / Table /
Strikethrough / Toggle Fullscreen rows, C2, C5, the § 5.5 `rust-hide` route, the § 5.6
states (`<merged:editFind>` dropped), § 5.8 rows 2 and 26, M2(a), M0, M1b, M7 and § 6.1.
D13 is not one of U5's options: it keeps ⌘H for Replace, which the plan had ruled out as
OS-owned. It is not: ⌘H is the key of mdpro's own predefined Hide item
(`muda-0.20.0/src/items/predefined.rs:655`), so C2 replaces that item with a keyless custom
one that calls `AppHandle::hide()`, and M2(a) probes the result. Asked about that consequence, the user answered 「Accept: Hide has no key (Recommended)」 (2026-10-16). Hide Others keeps ⌥⌘H. D16 and D9 do not overlap:
D9's Ctrl+Alt "table keys" are the six in-table row and column keys; Insert Table is a
separate action and moves to ⇧⌘T / Ctrl+Shift+T.

DESIGN.md's Keyboard Shortcuts block still describes a merged Replace row ("→ Find and
Replace"). D13 makes that stale. DESIGN.md is outside this file's grant; the delegator takes
the correction after this plan lands.

mdpro-codex-audit's final scoped confirm on `fae62649` (`review-plan-mvaj4tfa-qm3vnm`) is
**C0 · H0 · M0 · L0**: #8, #10, #15, #28 and #38 closed at plan level, and D13 is feasible
(`AppHandle::hide()` is the same NSApplication `hide:` as muda's predefined item).

