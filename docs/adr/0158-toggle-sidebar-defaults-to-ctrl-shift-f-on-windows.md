# 0158. Toggle Sidebar defaults to Ctrl+Shift+F on Windows, with Ctrl+Shift+L kept as a secondary

**Status**: Proposed (2026-10-30). Spec [#553](https://github.com/anzchy/mdpro/issues/553), snapshot `docs/specs/d50/r1/`. The user accepted every grill recommendation: 「全部同意」.
Earlier, on D50's route, they chose 「New Windows default (gated)」.

## Context
On the Windows test PC, Ctrl+Shift+L never reaches mdpro. The D50 probe found that another process holds it as a
system-wide hotkey (`RegisterHotKey` lastError 1409, with mdpro closed). mdpro's own shortcut route works: Ctrl+Shift+N
and Ctrl+S pass. Which program owns the chord is unknown, so other Windows machines may or may not lose it the same way.
The v2 default set (M1b) has not shipped yet, so its Windows default can still change without a migration.

## Options considered
- **Keep Ctrl+Shift+L and tell affected users to rebind it.** Lost: the user ruled for a new default, and the failure is
  silent, so users would not know to rebind.
- **Change the default on every platform.** Lost: there is no evidence on macOS or Linux, and macOS users have ⌘⇧L muscle
  memory.
- **Ctrl+Shift+U, Y or W on Windows.** Lost: U is IBus's Unicode entry on Linux, which matters if Linux ever follows. Y
  is hard to remember. W closes a window in some Chromium hosts.
- **Ctrl+Alt+anything.** Lost: it is AltGr on European layouts (D264).
- **Ctrl+Shift+F primary plus Ctrl+Shift+L secondary, Windows only** (chosen).

## Decision
1. On Windows, `view.sidebar`'s v2 primary default becomes Ctrl+Shift+F, and Ctrl+Shift+L becomes a v2 secondary.
   macOS (⌘⇧L) and Linux (Ctrl+Shift+L) do not change.
2. The v2 default is edited in place, with no v3. A configuration already stamped v2 keeps its stored value.
3. A real-PC check on win-desktop proves the change, in the shared W036 rerun.

## Consequences
- Windows users get a sidebar chord that works even where Ctrl+Shift+L is owned elsewhere. Where it is free,
  Ctrl+Shift+L still works.
- **Given up:**
  - Ctrl+Shift+F on Windows cannot later become "Find in files" without another defaults change.
  - The keyboard guide's shared Windows / Linux column splits for this row.
  - Windows and macOS documentation differ for one action.
- Test machines with a v2-stamped config keep Ctrl+Shift+L as their primary until it is reset.
- Once 0.3.6 ships, changing this default again needs a defaults-version bump and a migration.
