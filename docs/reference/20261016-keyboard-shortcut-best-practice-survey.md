# Keyboard shortcuts: mdpro against Word, Typora and similar editors

**Asked by the user (2026-10-16):** 「关于当前的keyboard shortcut映射，请a6 调研微软Word、typora等类似text
editor，看看我的版本是否符合最佳实践」

**Written by:** mdpro-a6, on master `d907a3f6`. Read-only: no code or plan was changed.

**Status:** a survey and recommendations. Nothing here is decided. Where a recommendation touches the menu
plan's § 5.3.2, it is marked **§ 9 input**, for codex-audit's scoped re-review of
[the menu plan](../plans/20261015-plan-menu-reorganisation.md).

## 0. What was compared

- **mdpro now**: the defaults that ship today. These are the 49 Settings entries, re-derived from the code
  at `3315eb3e`. Whether each key actually works on macOS comes from the device audit,
  [`20261016-shortcuts-mac-audit.md`](../test/20261016-shortcuts-mac-audit.md). The audit's verdicts are
  shown as: ✅ works in both modes, W / S works in WYSIWYG or Source only, ❌ does nothing, ⛔ taken by
  macOS. The Windows column comes from the menu plan's § 5.3.2 "mdpro today Win" (`platformLabels.ts`,
  `predefined.rs`). Highlight ⇧⌘H is a default (`src/types/preferences.ts:217`) but is not one of the
  49 audited entries.
- **mdpro v0.3.6**: the proposal in [menu plan § 5.3.2](../plans/20261015-plan-menu-reorganisation.md),
  which follows VMark (decision D2). Its VMark column is taken from that table, which pins
  `xiaolai/vmark@e0a982d` `src/stores/settingsStore/shortcutDefinitions.ts`. VMark was not re-read here.
- **Other editors**: Microsoft Word, Typora, Google Docs, Obsidian, VS Code, iA Writer and Bear. All are
  read from the vendor's own page on 2026-10-16 (sources in § 6).
- **Platform**: Apple's HIG "Keyboards" page and Apple Support "Mac keyboard shortcuts"; Microsoft
  Support "Keyboard shortcuts in Windows", the Windows app "Keyboard accelerators" guide and the Win32
  UX guide "Keyboard".

**How to read a cell.**

| Mark | Meaning |
|---|---|
| — | The source was read and lists no key for that action |
| n/a | The app has no such command |
| UNV | The source does not list the key, so it is unverified. A value after it is what the key is believed to be |
| [ref] | A source in § 6 |

**Sources by column.** Each column has one source, so every cell is cited by its column:

| Column | Source |
|---|---|
| Word | [W] |
| Typora | [T] |
| Google Docs | [GD] |
| Obsidian | [O] |
| VS Code | [VS] |
| iA Writer | [iA] |
| Bear | [B] |
| macOS platform | [A-sup] and [A-hig] |
| Windows platform | [M-sup], [M-acc] and [M-ux] |

Where a row rests on one particular source, it says which.

**Verdicts.**

| Verdict | Meaning |
|---|---|
| ✅ convention | Agrees with the platform and with most of the editors |
| ↔ deviates | Differs from the editors' consensus, or from Typora, but is not unsafe |
| ⛔ OS | The OS or the standard app menu takes the chord before the editor does (proved on device, or documented) |
| ◻ no command | The key matches convention, but mdpro has no command behind it ([D255](../plans/20260912-frontend-backend-sequencing-order.md#d255)) |

---

## 1. macOS

| # | Command | mdpro now | v0.3.6 | VMark | Word | Typora | Google Docs | Obsidian | VS Code | iA / Bear | macOS convention | Verdict (now → v0.3.6) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | New | ⌘N ✅ | ⌘N | ⌘N | UNV ⌘N | ⌘N | — | ⌘N | ⌘N | ⌘N / ⌘N | ⌘N | ✅ |
| 2 | New Window | ⇧⌘N ✅ | ⇧⌘N | ⇧⌘N | — | ⇧⌘N | n/a | — | ⇧⌘N | UNV / ⌥⌘N | — | ✅ |
| 3 | Open | ⌘O ✅ | ⌘O | Quick Open | UNV ⌘O | ⌘O | ⌘O | ⌘O (switcher) | ⌘O | UNV / ⌘O (Quick Open) | ⌘O | ✅ |
| 4 | Save | ⌘S ✅ | ⌘S | ⌘S | UNV ⌘S | ⌘S | ⌘S | n/a | ⌘S | ⌘S / n/a | ⌘S | ✅ |
| 5 | Save As | ⇧⌘S ❌ | ⇧⌘S, disabled | ⇧⌘S | ⇧⌘S | ⇧⌘S | n/a | n/a | ⇧⌘S | ⌥⇧⌘S / n/a | ⇧⌘S (Save As or Duplicate) | ◻ |
| 6 | Close | ⌘W ✅ | ⌘W | ⌘W | ⌘F4 | ⌘W | n/a | UNV | ⌘W | ⌘W / UNV | ⌘W | ✅ |
| 7 | Settings | ⌘, ✅ | ⌘, | ⌘, | UNV ⌘, | ⌘, | — | UNV | ⌘, | ⌘, / ⌘, | ⌘, | ✅ |
| 8 | Export HTML | ⇧⌘E | ⇧⌘E | — | — | UNV | — | UNV | — (⇧⌘E = Explorer) | ⇧⌘E Export / ⇧⌘S Export | — | ✅ (iA agrees) |
| 9 | Quit | ⌘Q | ⌘Q | ⌘Q | UNV | UNV | n/a | UNV | UNV | UNV | ⌘Q | ✅ |
| 10 | Undo / Redo | ⌘Z / ⇧⌘Z | same | same | ⌘Z / ⌘Y | UNV | ⌘Z / ⇧⌘Z | ⌘Z / ⇧⌘Z | ⌘Z / ⇧⌘Z | UNV | ⌘Z / ⇧⌘Z | ✅ (Word's ⌘Y is the outlier) |
| 11 | Copy as Markdown | ⇧⌘C ❌ | ⇧⌘C, disabled | ⇧⌘C (as HTML) | n/a | ⇧⌘C | — | — | n/a | ⌃⌘C / UNV | ⇧⌘C = Colors window [A-hig] | ◻; matches Typora |
| 12 | Paste as plain text | ⇧⌘V ❌ | ⇧⌘V, disabled | ⇧⌘V | ⇧⌘V | ⇧⌘V | ⇧⌘V | ⇧⌘V | — (Markdown preview) | UNV / UNV | ⌥⇧⌘V Paste and Match Style; ⇧⌘V "Paste as" [A-hig] | ◻; editors agree |
| 13 | Select Line | ⌘L ❌ | ⌘L, disabled | ⌘L | — | ⌘L | — | — | ⌘L | UNV / (⌘L = list in Bear) | — | ◻ (Typora, VS Code) |
| 14 | Select Word / next match | ⌘D (S only) | ⌘D | ⌘D (next occurrence) | — | ⌘D | — | UNV | ⌘D (next match) | (⌘D = Focus mode) / (⌘D = wiki link) | — | ✅ (Typora, VS Code) |
| 15 | Delete Word | ⇧⌘D ❌ | — (native ⌥⌫) | — | — | ⇧⌘D | — | ⌥⌫ | UNV | UNV | ⌥⌫, text system [A-sup] | ✅ v0.3.6 |
| 16 | Jump to top / bottom | ⌘↑ / ⌘↓ ✅ | system, not editable | native | ⌘Home / ⌘End | ⌘↑ / ⌘↓ | ⌘↓ only | ⌘↑ / ⌘↓ | ⌘↑ / ⌘↓ | ⌘↑ / ⌘↓ / UNV | ⌘↑ / ⌘↓ [A-sup] | ✅ |
| 17 | Find | ⌘F (S only) | ⌘F (Find and Replace) | ⌘F | ⌘F | ⌘F | ⌘F | ⌘F | ⌘F | ⌘F / ⌘F | ⌘F | ✅ key; ◻ in WYSIWYG |
| 18 | Find Next / Previous | ⌘G / ⇧⌘G (S only) | same | same | ⇧F4 / — | ⌘G / ⇧⌘G | ⌘G / ⇧⌘G | — | ⌘G / ⇧⌘G | ⌘G / ⇧⌘G / UNV | ⌘G / ⇧⌘G | ✅ key; ◻ in WYSIWYG |
| 19 | Replace | ⌘H ⛔ (Hide) | — (merged into ⌘F) | — (part of ⌘F) | ⌃H | **⌘H** | ⇧⌘H | ⌥⌘F | ⌥⌘F | ⌥⌘F / ⌥⌘F | ⌘H = Hide; ⌥⌘F = "go to the search field" [A-sup] | ⛔ → ↔ (no direct key) |
| 20 | Heading 1–6 | ⌘1–6 ✅ | same | same | ⌥⌘1–3 | ⌘1–6 | ⌥⌘1–6 | UNV | — | ⌘1–6 / ⌘1–6 | — | ✅ (the Markdown editors agree) |
| 21 | Paragraph | ⌘0 ✅ | ⇧⌘0 | ⇧⌘0 | ⇧⌘N | ⌘0 | ⌥⌘0 | UNV | — | (⌘0 = text size) / (⌘0 = actual size) | ⌘0 = actual size in iA, Bear, Word, Docs | ↔ v0.3.6 leaves Typora, but frees ⌘0 |
| 22 | Increase / Decrease Heading | ⌘= / ⌘- (S only) | ⌥⌘] / ⌥⌘[ | same | ⌃⇧← / → (Outline view) | ⌘= / ⌘- | — | UNV | — | UNV | ⌘- / ⇧⌘= = smaller / bigger [A-sup]; ⌥⌘= / ⌥⌘- = screen zoom (OS) [A-hig] | ↔ today; ✅ v0.3.6 frees the size keys |
| 23 | Insert Table | ⌥⌘T (W only) | ⇧⌘T | ⇧⌘T | — | ⌥⌘T | — | UNV | — | UNV / ⌥⌘T | ⌥⌘T = show/hide toolbar [A-sup]; ⇧⌘T = reopen closed tab (Typora, Obsidian, browsers) | ↔ both chords already mean something else |
| 24 | Code Fences | ⌥⌘C (W only) | ⌥⌘C | ⌥⌘C | n/a | ⌥⌘C | — | UNV | — | ⇧⌘J / ⌃⌘C | ⌥⌘C = Copy Style [A-sup] | ↔ minor (matches Typora) |
| 25 | Math Block | ⌥⌘B ❌ | ⌥⇧⌘M, disabled | ⌥⇧⌘M | — | ⌥⌘B | — | UNV | — | UNV | — | ↔ v0.3.6 leaves Typora for a four-key chord |
| 26 | Quote | ⌥⌘Q ⛔ (Quit and Keep Windows) | open (K3) | ⌥⌘Q | n/a | ⌥⌘Q | n/a | UNV | — | UNV / ⇧⌘T | ⌥⌘Q quit the app on device (audit P13) | ⛔ today and in VMark |
| 27 | Ordered / Unordered List | ⌥⌘O / ⌥⌘U ❌ | same, W only | same | — / ⇧⌘L | ⌥⌘O / ⌥⌘U | ⇧⌘7 / ⇧⌘8 | UNV | — | ⇧⌘L (ordered) / ⇧⌘L, ⌘L | — | ◻; matches Typora, no consensus |
| 28 | Indent / Outdent | ⌘] / ⌘[ ✅ | same | same | ⌃⇧M / ⇧⌘M | page lists ⌘[ for Indent, ⌘] for Outdent | ⌘] / ⌘[ | Tab / ⇧Tab | ⌘] / ⌘[ | ⇥ / ⇥ | ⌘{ ⌘} = align (other keys) | ✅ (Docs, VS Code). Typora's page has them the other way round |
| 29 | Bold / Italic | ⌘B / ⌘I (W only) | same | same | ⌘B / ⌘I | same | same | same | — | same | ⌘B / ⌘I [A-sup] | ✅ key; ◻ in Source |
| 30 | Underline | ⌘U ❌ | ⌘U, disabled | ⌘U | ⌘U | ⌘U | ⌘U | n/a | n/a | n/a / ⌘U | ⌘U | ◻ (Markdown has no underline; Typora writes `<u>`) |
| 31 | Inline Code | ⇧⌘\` (W only) | same | same | n/a | ⇧⌘\` | n/a | UNV | — | ⌘J / ⌥⌘C | ⇧⌘\` = previous window [A-sup]; works in mdpro on device (T4) | ✅ (matches Typora) |
| 32 | Strikethrough | ⌃⇧\` (W only) | ⇧⌘X | ⇧⌘X | ⇧⌘X | ⌃⇧\` | ⇧⌘X | UNV | — | ⌥⌘U / ⇧⌘U | HIG: avoid ⌃ | ↔ today; ✅ v0.3.6 (Word, Docs) |
| 33 | Hyperlink | ⌘K ✅ | same | same | UNV ⌘K | ⌘K | ⌘K | UNV | — (chord prefix) | ⌘K / ⌘K | ⌘K = add link [A-sup] | ✅ |
| 34 | Image | ⌃⌘I ❌ | ⇧⌘I, disabled | ⇧⌘I | — | ⌃⌘I | — | UNV | — | ⌥⌘K / ⇧⌘V | HIG: avoid ⌃ | ◻; ✅ v0.3.6 key |
| 35 | Highlight | ⇧⌘H (not audited) | ⇧⌘M | ⇧⌘M | — | — | — | UNV | — | ⇧⌘U / ⇧⌘M | — | ✅ v0.3.6 (matches Bear) |
| 36 | Clear Format | ⌘\\ ❌ | ⌘\\, disabled | ⌘\\ | — | ⌘\\ | ⌘\\ | UNV | — | UNV / (⌘\\ = main window) | — | ◻ (Typora, Docs) |
| 37 | Cycle Source / WYSIWYG | ⌘/ ✅ | F6 | F6 | — | ⌘/ | mode keys ⌥⇧⌘Z / X / C | ⌘E (edit / read) | ⇧⌘V (preview) | ⌘R (preview) / n/a | F-keys need Fn on Mac laptops (plan § 5.3.3) | ↔ v0.3.6 leaves Typora and every Mac editor |
| 38 | Source / WYSIWYG direct | ⌃2 / ⌃4 ✅ | same | — | — | — | — | — | — | — | HIG: avoid ⌃ | ↔ minor |
| 39 | Toggle Sidebar | ⇧⌘L ✅ | ⌃⇧0 | ⌃⇧0 | — | ⇧⌘L | outline: ⌃⌘A, H | UNV | ⌘B | ⌃⌘S / ⌃3 | HIG: avoid ⌃ | ↔ v0.3.6 leaves Typora and the HIG |
| 40 | Toggle Full Screen | ⌥⌘F ❌ | system ⌃⌘F (fn F) | system | — | ⌥⌘F | — | UNV | ⌃⌘F | ⌃⌘F / ⌃⌘F | ⌃⌘F [A-sup, A-hig] | ◻ → ✅ v0.3.6 |
| 41 | Switch Documents | ⌘\` ⛔ (window cycling) | ⌃Tab, reserved | ⌃Tab | ⌘\` (next window) | ⌘\` | — | ⌃Tab | ⌃Tab | ⌃⌘→ / ⌘] | ⌘\` = next window [A-sup] | ⛔ → ✅ v0.3.6 |
| 42 | Zoom in / out / reset | none | none | ⌘= (zoom) | ⌘+ / ⌘- / ⌘0 | not supported | ⌘+ / ⌘- / ⌘0 | UNV | ⌘= / ⌘- | ⌘+ / ⌘- / ⌘0 | — | no command (gap) |

---

## 2. Windows

The VMark column is omitted where it equals v0.3.6.

| # | Command | mdpro now | v0.3.6 | Word | Typora | Google Docs | Obsidian | VS Code | Windows convention | Verdict (now → v0.3.6) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1–4 | New / New Window / Open / Save | Ctrl+N / Ctrl+Shift+N / Ctrl+O / Ctrl+S | same | Ctrl+N / — / Ctrl+O / Ctrl+S | same as mdpro | — / n/a / Ctrl+O / Ctrl+S | Ctrl+N / — / Ctrl+O (switcher) / n/a | same as mdpro | Ctrl+N, Ctrl+S [M-acc]; Ctrl+O UNV | ✅ |
| 5 | Save As | Ctrl+Shift+S | same, disabled | F12 | Ctrl+Shift+S | n/a | UNV | Ctrl+Shift+S | — | ◻ |
| 6 | Close | Ctrl+W | same | Ctrl+W / Ctrl+F4 | Ctrl+W | n/a | UNV | Ctrl+F4 / Ctrl+W | Ctrl+W [M-acc]; Ctrl+F4 [M-sup] | ✅ |
| 7–8 | Settings / Export | Ctrl+, / Ctrl+Shift+E | same | — / — | Ctrl+, / UNV | — | UNV | Ctrl+, / (Ctrl+Shift+E = Explorer) | — | ✅ |
| 9 | Exit | none (ADR-0090) | Ctrl+Q | Alt+F4 (Ctrl+Q = reset paragraph) | UNV | n/a | UNV | Alt+F4 | Alt+F4 is the OS close; Ctrl+Q is on M-ux's free list | ↔ acceptable (Alt+F4 still works) |
| 10 | Undo / Redo | Ctrl+Z / Ctrl+Y | Ctrl+Z / Ctrl+Shift+Z (+ Ctrl+Y if both editors accept it) | Ctrl+Z / Ctrl+Y | UNV | Ctrl+Z / Ctrl+Shift+Z | Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y | Ctrl+Z / Ctrl+Y | Ctrl+Z / **Ctrl+Y** [M-acc] | ↔ Ctrl+Y must keep working |
| 11–12 | Copy as Markdown / Paste plain | Ctrl+Shift+C / Ctrl+Shift+V | same, disabled | n/a / Ctrl+Shift+V | same as mdpro | — / Ctrl+Shift+V | — / Ctrl+Shift+V | n/a / (preview) | Ctrl+Shift+V = paste plain [M-sup] | ◻ |
| 13–14 | Select Line / Select Word | Ctrl+L / Ctrl+D | same | — | Ctrl+L / Ctrl+D | — | — | Ctrl+L / Ctrl+D | Ctrl+D = delete item [M-acc] (file managers) | ✅ (Typora, VS Code) |
| 15 | Delete Word | Ctrl+Shift+D | — | Ctrl+Backspace | Ctrl+Shift+D | — | Ctrl+Backspace | UNV | Ctrl+Backspace [M-sup] | ✅ v0.3.6 |
| 16 | Jump to top / bottom | Ctrl+↑ / Ctrl+↓ | Ctrl+Home / Ctrl+End, system | Ctrl+Home / End | Ctrl+Home / End | — | Ctrl+Home / End | Ctrl+Home / End | Ctrl+Home / End [M-sup] | ↔ today; ✅ v0.3.6 |
| 17 | Find | Ctrl+F | same | Ctrl+F | Ctrl+F | Ctrl+F | Ctrl+F | Ctrl+F | Ctrl+F [M-acc] | ✅ |
| 18 | Find Next / Previous | Ctrl+G / Ctrl+Shift+G | same | Shift+F4 / — | **F3 / Shift+F3** | Ctrl+G / Ctrl+Shift+G | — | **F3 / Shift+F3** | **F3** [M-acc]; Ctrl+G is a free key [M-ux] | ↔ deviates from Windows (F3) |
| 19 | Replace | Ctrl+H | **— (merged into Ctrl+F)** | Ctrl+H | Ctrl+H | Ctrl+H | Ctrl+H | Ctrl+H | **Ctrl+H** [M-acc, M-sup] | ✅ today → ↔ v0.3.6 drops a universal key |
| 20 | Heading 1–6 | Ctrl+1–6 (ADR-0096) | same | Ctrl+Alt+1–3 | Ctrl+1–6 | Ctrl+Alt+1–6 | UNV | — | Ctrl+number is on M-ux's free list | ✅ (Typora) |
| 21 | Paragraph | Ctrl+0 | Ctrl+Shift+0 | Ctrl+Shift+N | Ctrl+0 (Ctrl+Shift+0 = actual size) | Ctrl+Alt+0 | UNV | — | Ctrl+0 = default zoom [M-acc] | ↔ both; v0.3.6 clashes with Typora's zoom key, and plan open question 4 |
| 22 | Increase / Decrease Heading | Ctrl+= / Ctrl+- | Ctrl+Alt+] / Ctrl+Alt+[ | Alt+Shift+← / → (Outline) | Ctrl+= / Ctrl+- | — | UNV | — | Ctrl++ / Ctrl+- = zoom [M-acc]; avoid Ctrl+Alt and `[]` [M-ux] | ↔ both |
| 23 | Insert Table | Ctrl+Alt+T | Ctrl+Shift+T | — | **Ctrl+T** | — | UNV | — | Ctrl+T = new tab; Ctrl+Shift+T = reopen tab (browsers, Typora) | ↔ both |
| 24 | Code Fences | Ctrl+Alt+C | same | n/a | **Ctrl+Shift+K** | — | UNV | — | "Don't use Ctrl+Alt" (AltGr) [M-ux] | ⛔ guidance, both |
| 25 | Math Block | Ctrl+Alt+B | Ctrl+Alt+Shift+M | UNV Alt+= (equation) | **Ctrl+Shift+M** | — | UNV | — | AltGr [M-ux] | ⛔ guidance, both |
| 26 | Quote | Ctrl+Alt+Q | same | n/a | **Ctrl+Shift+Q** | n/a | UNV | — | AltGr [M-ux] | ⛔ guidance, both |
| 27 | Ordered / Unordered List | Ctrl+Alt+O / U | same | — / Ctrl+Shift+L | **Ctrl+Shift+[ / ]** | Ctrl+Shift+7 / 8 | UNV | — | AltGr [M-ux] | ⛔ guidance, both |
| 28 | Indent / Outdent | Ctrl+] / Ctrl+[ | same | Ctrl+M / Ctrl+Shift+M | (page lists Ctrl+[ for Indent) | Ctrl+] / Ctrl+[ | Tab / Shift+Tab | Ctrl+] / Ctrl+[ | — | ✅ (Docs, VS Code) |
| 29–30 | Bold / Italic / Underline | Ctrl+B / I / U | same (U disabled) | Ctrl+B / I / U | same | same | Ctrl+B / UNV / n/a | — | Ctrl+B / I / U [M-acc] | ✅ |
| 31 | Inline Code | Ctrl+Shift+\` | same | n/a | Ctrl+Shift+\` | n/a | UNV | — | — | ✅ (Typora) |
| 32 | Strikethrough | Alt+Shift+5 (ADR-0096) | Ctrl+Shift+X | — | **Alt+Shift+5** | **Alt+Shift+5** | UNV | — | Alt+Shift switches layout [M-lang] | ↔ v0.3.6 leaves Typora and Docs, which agree |
| 33 | Hyperlink | Ctrl+K | same | Ctrl+K | Ctrl+K | Ctrl+K | UNV | — | — | ✅ |
| 34 | Image | shown as Ctrl+I (= Italic, C6) | Ctrl+Shift+I, disabled | — | Ctrl+Shift+I | — | UNV | — | — | ⛔ today (a clash inside mdpro) → ✅ v0.3.6 |
| 35 | Highlight | Ctrl+Shift+H | Ctrl+Shift+M | — (Ctrl+Shift+M = outdent) | — (Ctrl+Shift+M = math) | — | UNV | — | — | ↔ minor |
| 36 | Clear Format | Ctrl+\\ | same, disabled | Ctrl+Space | Ctrl+\\ | Ctrl+\\ or Ctrl+Space | UNV | — | avoid `\` (varies by locale) [M-ux] | ◻ (Typora, Docs) |
| 37 | Cycle Source / WYSIWYG | Ctrl+/ (ADR-0096) | F6 | — | **Ctrl+/** | mode keys | Ctrl+E | Ctrl+Shift+V | **F6 = next UI pane** [M-acc, M-kbd2002] | ↔ v0.3.6 takes a Windows convention key |
| 38 | Toggle Sidebar | Ctrl+Shift+L | Alt+Shift+0 | — | **Ctrl+Shift+L** | — | UNV | Ctrl+B | Alt+Shift switches layout [M-lang] | ↔ v0.3.6; whether Alt+Shift+0 is safe is UNV |
| 39 | Full Screen | Ctrl+Alt+F (not bound) | disabled | — | **F11** | — | UNV | **F11** | F11 (Explorer: maximize) [M-sup] | ◻ → ◻ |
| 40 | Switch Documents | Ctrl+\` | Ctrl+Tab, reserved | Ctrl+F6 | Ctrl+Tab | Ctrl+Shift+PgDn | Ctrl+Tab | Ctrl+Tab | Ctrl+Tab = next tab [M-sup] | ✅ v0.3.6 |
| 41 | Zoom | none | none | Ctrl++ / - / 0 | Ctrl+Shift+= / - / 0 | Ctrl++ / - / 0 | UNV | Ctrl+= / - | Ctrl++ / - / 0 [M-acc] | no command (gap) |

---

## 3. Conflicts with OS-owned or platform-standard keys

| Key | Platform | mdpro use | Who owns it | Evidence | Status |
|---|---|---|---|---|---|
| ⌘H | macOS | Replace (now) | App menu Hide | Audit E11: mdpro hides | v0.3.6 unbinds it ✅ |
| ⌥⌘Q | macOS | Quote (now; VMark's key) | App menu "Quit and Keep Windows" | Audit P13: the quit prompt appears | v0.3.6 leaves it **open** (K3); must change |
| ⌘\` | macOS | Switch Documents (now) | Next window of the app | Audit V6; [A-sup] | v0.3.6 moves it to ⌃Tab ✅ |
| ⇧⌘\` | macOS | Inline Code | Previous window [A-sup] | Audit T4: works in mdpro (one window) | Not proved with two windows (UNV) |
| ⌃ as a modifier | macOS | ⌃2 / ⌃4, ⌃⇧\` (now), ⌃⌘I (now), ⌃⇧0 (v0.3.6), ⌃Tab (v0.3.6) | HIG: "avoid ⌃" [A-hig] | Guidance, not reservation | ⌃Tab is the cross-app tab convention, which is fine; ⌃⇧0 is new |
| ⌘= / ⌘- | macOS | Increase / Decrease Heading (now) | Size convention [A-sup] | Audit P8/P9: no page zoom | v0.3.6 frees them ✅ |
| Ctrl+Alt+letter | Windows | Code Fences, lists, Quote, Math, heading level (now and v0.3.6) | AltGr on many European layouts | [M-ux]: "Don't use Ctrl+Alt combinations"; plan § 5.3.3 open question 3 | Unresolved |
| Alt+Shift+… | Windows | Strikethrough Alt+Shift+5 (now), Sidebar Alt+Shift+0 (v0.3.6) | Layout switch hotkey [M-lang] | Alt+Shift+5 passed on device (ADR-0096); Alt+Shift+0 untested | Test Alt+Shift+0 in M2 |
| Ctrl+Shift+0 | Windows | Paragraph (v0.3.6) | Some installs: input-language hotkey (plan open question 4, unverified); Typora: actual size | — | Test in M2 |
| F6 | Windows | Cycle mode (v0.3.6) | Next UI pane [M-acc] | Guidance | Ask (plan open question 2) |

---

## 4. Commands the editors agree on, and mdpro does not give a key

1. **Find, Find Next and Find Previous in WYSIWYG** (⌘F / ⌘G / ⇧⌘G; Ctrl+F). Every editor surveyed has
   them. This is D255's ⌘F find popup.
2. **Five of D255's twelve "neither mode" keys** already sit on the consensus chord, and need only the
   command behind them:
   - Save As ⇧⌘S;
   - Underline ⌘U;
   - Paste as Plain Text ⇧⌘V (Apple's own is ⌥⇧⌘V);
   - Clear Format ⌘\\ (Typora, Docs);
   - Select Line ⌘L (Typora, VS Code).
3. **Full screen.** It is ⌃⌘F on macOS: the HIG, VS Code, iA and Bear. v0.3.6 already uses the
   system-added item. Windows has **F11** (Typora, VS Code), but v0.3.6 leaves full screen
   disabled off-Mac.
4. **Replace on Windows: Ctrl+H.** Word, Typora, Docs, Obsidian, VS Code and Microsoft's own table all
   use it. v0.3.6 removes the key and merges Replace into Ctrl+F.
5. **Find Next / Previous on Windows: F3 / Shift+F3.** Microsoft's accelerator table, Typora and VS Code
   use it. mdpro uses Ctrl+G only.
6. **Zoom** (⌘+ / ⌘- / ⌘0; Ctrl++ / Ctrl+- / Ctrl+0) in Word, Docs, VS Code, iA and Bear. mdpro has
   no zoom command. v0.3.6 frees ⌘0, ⌘= and ⌘- for it.
7. **Typora-only keys with no wider consensus**, kept as they are: Math ⌥⌘B, the list keys ⌥⌘O /
   ⌥⌘U, Image ⌃⌘I, Copy as Markdown ⇧⌘C. Delete Word has a native key (⌥⌫ / Ctrl+Backspace), so
   v0.3.6 is right to drop ⇧⌘D.

---

## 5. Recommendations

**Keep** means it is already best practice. **Change** means the evidence points one way. **Ask** means
it is a preference call between two reasonable maps.

| # | Item | Now → v0.3.6 | Recommendation | Why | § 9 input? |
|---|---|---|---|---|---|
| R1 | Core file and edit keys: New, Open, Save, Close, Settings, Undo, Find, Bold, Italic, Link, Headings ⌘1–6, Indent | as is | **Keep** | Every source agrees | — |
| R2 | Replace ⌘H | ⛔ → unbound | **Keep** v0.3.6 unbinding on macOS. **Change**: give Find and Replace **⌥⌘F** on macOS, which VS Code, Obsidian, iA and Bear use and v0.3.6 frees from full screen | ⌘H belongs to Hide; ⌥⌘F is the Mac editors' replace key | Yes |
| R3 | Replace Ctrl+H (Windows) | Ctrl+H → none | **Change**: keep Ctrl+H, opening the merged Find and Replace with the replace field focused | It is universal on Windows, and dropping it is the biggest regression in the remap | Yes |
| R4 | Find Next / Previous (Windows) | Ctrl+G only | **Change**: add F3 / Shift+F3 as a second key, keeping Ctrl+G | Microsoft's own table, Typora and VS Code | Yes |
| R5 | Quote ⌥⌘Q | ⛔ → open | **Change on macOS, Ask which key.** No editor agrees on one. Don't use ⇧⌘Q (log out). Bear's ⇧⌘T clashes with reopen-tab | The device audit proved it quits mdpro | Yes (K3) |
| R6 | Cycle mode ⌘/ → F6 | deviates | **Ask.** Recommend keeping ⌘/ / Ctrl+/ as the primary or a fixed second key | Typora and the user's muscle memory use ⌘/. F6 needs Fn on Mac laptops and is "next pane" on Windows | Yes (open question 2) |
| R7 | Toggle Sidebar ⇧⌘L → ⌃⇧0 / Alt+Shift+0 | deviates | **Ask.** Keep ⇧⌘L unless C11 (CodeMirror select-all-matches) must have it | Typora uses ⇧⌘L / Ctrl+Shift+L; the HIG says avoid ⌃; Alt+Shift is the Windows layout switch | Yes |
| R8 | Strikethrough | ⌃⇧\` / Alt+Shift+5 → ⇧⌘X / Ctrl+Shift+X | **Keep** on macOS (matches Word and Docs, and leaves ⌃). **Ask** on Windows: Typora and Docs agree on Alt+Shift+5, which passed on device | Two consensus groups | Yes |
| R9 | Increase / Decrease Heading | ⌘= / ⌘- → ⌥⌘] / ⌥⌘[ | **Keep** on macOS (frees the size and zoom keys). On Windows, **flag** the Ctrl+Alt form under R11 | ⌘= / ⌘- are the size convention | With R11 |
| R10 | Paragraph ⌘0 → ⇧⌘0 | deviates from Typora | **Keep** on macOS if a zoom command is planned (R13); otherwise **Ask**. On Windows, test Ctrl+Shift+0 in M2 | ⌘0 is "actual size" elsewhere | Yes (open question 4) |
| R11 | Ctrl+Alt chords on Windows (Code Fences, lists, Quote, Math, heading level) | unchanged | **Ask.** The alternative is Typora's Windows set: Ctrl+Shift+K, Ctrl+Shift+[ / ], Ctrl+Shift+Q, Ctrl+Shift+M | Microsoft: "Don't use Ctrl+Alt combinations" (AltGr). The matcher refuses AltGr today, so these keys never fire on those layouts | Yes (open question 3) |
| R12 | Insert Table ⌥⌘T → ⇧⌘T | both clash | **Ask.** ⌥⌘T is Typora's and only shadows "show toolbar", which mdpro doesn't have. ⇧⌘T / Ctrl+Shift+T is "reopen closed tab" in Typora, Obsidian and browsers. On Windows, Typora uses Ctrl+T | Reopen-tab is a stronger cross-app habit than the toolbar | Yes |
| R13 | Zoom | none | **Add a command later** (⌘+ / ⌘- / ⌘0; Ctrl++ / - / 0). Not part of this plan | Universal across the editors surveyed | Note for a later item |
| R14 | Full screen on Windows | disabled | **Change**: F11 | Typora and VS Code | Yes |
| R15 | Redo on Windows | Ctrl+Y → Ctrl+Shift+Z | **Keep** Ctrl+Y as a working key. M6 already plans to test it; make that required, not conditional | Microsoft's table and Word use Ctrl+Y | Yes |
| R16 | Exit Ctrl+Q (Windows) | none → Ctrl+Q | **Keep** | Microsoft lists Ctrl+Q as free for apps. Alt+F4 still works | — |
| R17 | D255's no-effect keys | ❌ | **Keep the keys and implement the commands** (§ 4 item 2), WYSIWYG find first | The chords are already the consensus ones | D255, not § 5.3.2 |

---

## 6. Sources

All of these were read on 2026-10-16. The three research passes behind them used gstack `/browse`.
WebFetch was used for the Obsidian help pages, the VS Code PDFs and the VS Code Markdown page, and is
marked in each tool note.

| Ref | Source | URL |
|---|---|---|
| W | Microsoft Support, "Keyboard shortcuts in Word" (Windows and macOS tabs; not a complete list) | https://support.microsoft.com/en-us/office/keyboard-shortcuts-in-word-95ef89dd-7142-4b50-afb2-f762f663ceb2 |
| T | Typora, "Shortcut Keys" (macOS and Windows/Linux columns; page updated 2026-09-06) | https://support.typora.io/Shortcut-Keys/ |
| GD | Google Docs Editors Help, "Keyboard shortcuts for Google Docs" | https://support.google.com/docs/answer/179738?hl=en&co=GENIE.Platform%3DDesktop |
| O | Obsidian Help: editing shortcuts, find and replace, quick switcher, tabs, edit and read (WebFetch) | https://obsidian.md/help/editing-shortcuts · https://obsidian.md/help/find-and-replace · https://obsidian.md/help/plugins/quick-switcher · https://obsidian.md/help/tabs · https://obsidian.md/help/edit-and-read |
| VS | VS Code keyboard shortcut PDFs (WebFetch), the default keybindings reference, and the Markdown docs (WebFetch) | https://code.visualstudio.com/shortcuts/keyboard-shortcuts-macos.pdf · https://code.visualstudio.com/shortcuts/keyboard-shortcuts-windows.pdf · https://code.visualstudio.com/docs/reference/default-keybindings · https://code.visualstudio.com/docs/languages/markdown |
| iA | iA Writer Support, "Shortcuts" (Mac and Windows tabs; the Windows tab is short) | https://ia.net/writer/support/basics/shortcuts?platform=mac · https://ia.net/writer/support/basics/shortcuts?platform=windows |
| B | Bear, "macOS Keyboard Shortcuts" | https://bear.app/faq/mac-keyboard-shortcuts/ |
| A-sup | Apple Support, "Mac keyboard shortcuts" | https://support.apple.com/en-us/102650 |
| A-hig | Apple Human Interface Guidelines, "Keyboards" | https://developer.apple.com/design/human-interface-guidelines/keyboards |
| M-sup | Microsoft Support, "Keyboard shortcuts in Windows" | https://support.microsoft.com/en-us/windows/keyboard-shortcuts-in-windows-dcc61a57-8ff0-cffe-9796-cb9706c75eec |
| M-acc | Microsoft Learn, "Keyboard accelerators" (Common Keyboard Accelerators table) | https://learn.microsoft.com/en-us/windows/apps/design/input/keyboard-accelerators |
| M-ux | Microsoft Learn, Win32 UX guide, "Keyboard" | https://learn.microsoft.com/en-us/windows/win32/uxguide/inter-keyboard |
| M-kbd2002 | Microsoft Learn (archived), "Guidelines for Keyboard User Interface Design" | https://learn.microsoft.com/en-us/previous-versions/windows/desktop/dnacc/guidelines-for-keyboard-user-interface-design |
| M-lang | Microsoft Support, "Switch between languages using the Language bar" (WebFetch) | https://support.microsoft.com/en-us/office/languages/switch-between-languages-using-the-language-bar |
| VMark | via menu plan § 5.3.2: `xiaolai/vmark@e0a982d` `src/stores/settingsStore/shortcutDefinitions.ts:44-215` | [menu plan](../plans/20261015-plan-menu-reorganisation.md) |

**Not verified:**

- Word for Mac's page lists no ⌘N / ⌘O / ⌘S / ⌘, / ⌘Q / ⌘K.
- Typora's page lists no Undo, Redo, Export, Quit or Highlight key.
- Obsidian's help documents no heading, list or sidebar keys.
- iA Writer's Windows page is short.
- Apple's pages don't say which chords an app cannot override. The ⛔ marks rest on the device audit,
  not on Apple's text.
