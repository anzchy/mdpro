# 0158. Toggle Sidebar defaults to Ctrl+Shift+1 on Windows, with Ctrl+Shift+L kept as a secondary

**Status**: Proposed (2026-10-30; revised 2026-10-31 for spec r2). Spec [#553](https://github.com/anzchy/mdpro/issues/553),
snapshot `docs/specs/d50/r2/` (r1 chose Ctrl+Shift+F). The user accepted every grill recommendation: 「全部同意」.
Earlier, on D50's route, they chose 「New Windows default (gated)」. After r1's plan review: 「Probe the IME first
(Recommended)」, then 「Pick a different chord (Recommended)」 and 「Ctrl+Shift+1 (Recommended)」. If accepted, this
partially supersedes [ADR-0114](0114-the-menu-bar-and-default-keys-follow-one-command-table-and-vmark.md) Decision 1
(D12 「B · Keep ⇧⌘L (Recommended)」, and D6, Linux built with the Windows tree) and Decision 2 (the § 5.3.2 table), for
`view.sidebar` on Windows only.

## Context
- **Ctrl+Shift+L never reaches mdpro on the Windows test PC.** The D50 probe found that another process holds it as a
  system-wide hotkey (`RegisterHotKey` lastError 1409, with mdpro closed). mdpro's own shortcut route works: Ctrl+Shift+N
  and Ctrl+S pass.
- **Who owns it is not proved.** The IME probe found AMD Radeon Software's "Toggle Performance Logging" bound to
  Ctrl+Shift+L, but that is an inference and was not tested. Other Windows machines may or may not lose the chord the same
  way.
- **Input-method hotkeys take chords too.** They take a chord before the page sees it, and a `RegisterHotKey` probe does
  not detect them. ADR-0114 Decision 2 already records this for Ctrl+Shift+0. On the test PC:
  - Microsoft Pinyin is enabled, with its Simplified/Traditional switch on and bound to F;
  - Microsoft documents that switch as Ctrl+Shift+F, and Sogou uses the same default;
  - the default input method is WeType, whose binding is unknown.

  mdpro's users, and the user, are Chinese-speaking.
- **The real resolver finds Ctrl+Shift+1 free.** It is free on all three platforms, in v1 and v2, and in every ownership
  context. No known IME or GPU-tool default uses it. It is Typora's Windows key for the Outline sidebar, and mdpro's sidebar
  is the outline.
- **v2 has not shipped.** The v2 default set (M1b) is not in any release, so its Windows default can still change without
  a migration.
- **Evidence:**
  - `~/.mdpro-redesign/device/D50-probe-report.md`;
  - `~/.mdpro-redesign/device/D50-ime-probe-report.md`;
  - `~/.mdpro-redesign/device/D50-chord-candidates.md`.

## Options considered
- **Keep Ctrl+Shift+L and tell affected users to rebind it.** Lost: the user ruled for a new default, and the failure is
  silent, so users would not know to rebind.
- **Change the default on every platform.** Lost: there is no evidence on macOS or Linux, and macOS users have ⌘⇧L muscle
  memory.
- **Ctrl+Shift+F primary plus Ctrl+Shift+L secondary** (r1's choice). Lost after the IME probe: Microsoft Pinyin, which is
  enabled on the test PC, uses Ctrl+Shift+F for its Simplified/Traditional switch by default, and Sogou does the same. The
  fix would fail silently for the users it is meant for. It would also have taken the key the semantic-find plan proposes.
- **Ctrl+Shift+L primary plus Ctrl+Shift+1 secondary.** Lost: the menu would advertise the chord that fails on the machines
  this fixes, and a secondary is never shown on the menu, so the working chord could not be discovered (story 2).
- **Ctrl+Shift+Y.** The candidate study's fallback: free, with no known conflict. Lost: it has no precedent for a sidebar
  and is hard to remember.
- **Ctrl+Shift+0.** Lost: it is Paragraph's v2 default, and Windows commonly reserves it for keyboard-layout switching.
- **Ctrl+Shift+O, X, S, E, R, I or G.** Lost: they are AMD Radeon overlay and recording defaults (O verified, the rest
  from memory), and S, E and I are mdpro defaults already.
- **Ctrl+Shift+B, E, Z or K, Ctrl+Space, Ctrl+.** Lost: these are input-method hotkeys (Microsoft Pinyin's Ctrl+. is
  verified, the others are not), or they are taken in v2 (K is Code Fences off-Mac).
- **Ctrl+Shift+U or W.** Lost:
  - U is IBus's Unicode entry on Linux, which matters if Linux ever follows;
  - W closes the window in Chrome, so Chromium-based users expect it to close something.
- **Ctrl+\\ or Ctrl+Shift+\\.** Lost:
  - Ctrl+\\ is Clear Format's default, and on a German layout `\` needs AltGr, which is refused;
  - Ctrl+Shift+\\ is CodeMirror's matching-bracket key in Source.
- **Ctrl+Alt+anything.** Lost: it is AltGr on European layouts (D264).
- **Alt+Shift+S.** Lost: Alt+Shift is Windows' default switch between input languages.
- **Ctrl+F1 or F9.** Lost: on many laptops the F-row needs Fn. F9 is Typora's typewriter mode.
- **Ctrl+Shift+1 primary plus Ctrl+Shift+L secondary, Windows only** (chosen).

## Decision
1. On Windows, `view.sidebar`'s v2 primary default becomes Ctrl+Shift+1 (`Cmd+Shift+1`), and Ctrl+Shift+L becomes its one
   v2 secondary. macOS (⌘⇧L) and Linux (Ctrl+Shift+L, no secondary) do not change, so Linux no longer takes the Windows
   value for this row. The Windows native menu takes the chord from the command table.
2. Editor keymaps keep their precedence. On AZERTY, Ctrl+Shift+& in either editor stays Heading 1. With focus outside the
   editors it toggles the sidebar.
3. The v2 default is edited in place, with no v3. A configuration already stamped v2 keeps its stored value. A Windows v1
   configuration holding the v1 default migrates to Ctrl+Shift+1.
4. The Windows-only values (the Rust host default, the migration map, applied shortcuts, the menu accelerator) take the
   platform as a value, so that they are tested on the macOS and Linux test hosts.
5. A real-PC check on win-desktop proves the change, in the shared W036 rerun.

## Consequences
- Windows users get a sidebar chord that works even where Ctrl+Shift+L is owned elsewhere, and that no known input method
  takes. Where Ctrl+Shift+L is free, it still works.
- **Given up:**
  - On AZERTY, Ctrl+Shift+1 does not toggle the sidebar inside the editors. There it stays Heading 1, and the sidebar is
    reached by Ctrl+Shift+L, the menu, or a custom chord.
  - Notion users know Ctrl+Shift+1 as Heading 1. This is a habit clash, not an OS one.
  - Typora's Ctrl+Shift+1 opens the sidebar on its Outline tab. mdpro's toggles it.
  - One table row breaks "Linux takes the Windows value". Its tests carry an exact exception list instead of the blanket
    invariant.
  - The keyboard guide's shared Windows / Linux column splits for this row, and the Windows and macOS documentation differ
    for one action.
- **Residual risk.** WeType's own hotkey table is unknown. The device AC presses the chord with the default WeType input
  method active. An input-method hotkey on another machine can still take any chord, which is ADR-0114 Decision 2's
  stated limit.
- Test machines with a v2-stamped config keep Ctrl+Shift+L as their primary until it is reset. Their Windows menu shows
  the default Ctrl+Shift+1, because the off-Mac menu shows defaults, not custom chords.
- Once 0.3.6 ships, changing this default again needs a defaults-version bump and a migration.
