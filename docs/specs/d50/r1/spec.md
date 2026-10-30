## Problem Statement

On Windows, pressing Ctrl+Shift+L does not toggle the sidebar. Nothing happens, and nothing tells the user why. On the
test PC, another program has registered Ctrl+Shift+L as a system-wide hotkey, so the keystroke never reaches mdpro. Every
other shortcut on the same path works. Users who hit this cannot reach the sidebar from the keyboard, and they have no way
to discover that a different chord would work.

## Solution

On Windows, Toggle Sidebar gets a new default binding, **Ctrl+Shift+F**, and the View menu shows it. Ctrl+Shift+L stays as
a secondary binding, so it still works on machines where nothing else owns it. macOS keeps ⌘⇧L and Linux keeps
Ctrl+Shift+L. A user who has already chosen their own sidebar chord keeps it.

## User Stories

1. As a Windows user, I want Ctrl+Shift+F to toggle the sidebar, so that I can show and hide it from the keyboard even when
   another program owns Ctrl+Shift+L.
2. As a Windows user, I want the View menu to show Ctrl+Shift+F next to Toggle Sidebar, so that I can discover the chord
   that works.
3. As a Windows user coming from Typora, I want Ctrl+Shift+L to still toggle the sidebar where no other program owns it, so
   that my habit keeps working.
4. As a Windows user, I want Settings → Keyboard Shortcuts to list Ctrl+Shift+F as the Toggle Sidebar default, so that
   what I see matches what works.
5. As a Windows user, I want "Reset to default" on Toggle Sidebar to restore Ctrl+Shift+F, so that resetting gives me the
   working chord.
6. As a Windows user who rebound Toggle Sidebar myself, I want my chord kept, so that the update never overrides my choice.
7. As a Windows user, I want rebinding Toggle Sidebar's primary to leave the Ctrl+Shift+L secondary working as before, so
   that one change does not silently remove another.
8. As a Windows user, I want Ctrl+Shift+F to toggle the sidebar in both Source and WYSIWYG views, with focus in the editor or
   elsewhere, so that it behaves like the other global shortcuts.
9. As a Windows user, I want Ctrl+Shift+F to do nothing else, so that no editor command fires alongside the sidebar toggle.
10. As a Windows user, I want conflict detection in Settings to treat Ctrl+Shift+F and the Ctrl+Shift+L secondary as taken
    by Toggle Sidebar, so that I am warned before I assign either to another action.
11. As a macOS user, I want ⌘⇧L to keep toggling the sidebar and to stay in the menu, so that nothing changes for me.
12. As a Linux user, I want Ctrl+Shift+L to remain the default, so that nothing changes without evidence that it fails on
    Linux.
13. As a reader of the keyboard shortcuts guide, I want the Windows and Linux defaults for Toggle Sidebar shown separately,
    so that the guide is right on each platform.
14. As a Windows user upgrading from 0.3.5, I want to get Ctrl+Shift+F with the rest of the new v2 defaults, so that the
    first version I install already works.
15. As a tester with a config already stamped v2, I want my stored Ctrl+Shift+L kept as a chosen value, so that test
    machines behave predictably, and "Reset to default" to give Ctrl+Shift+F.
16. As a support reader of `mdpro.log`, I want a toggle triggered by either chord to log the same `ui.shortcut.trigger`
    event with the `view.toggle_sidebar` action and the chord pressed, so that I can tell which chord a user used.
17. As a maintainer, I want the command table to remain the single source of the sidebar's per-platform defaults, with the
    generated menu layout, the applied-shortcuts command and the Settings defaults all following it, so that they cannot
    drift (rule 41).
18. As a maintainer, I want the change proved on the real Windows PC, so that the fix is not only a unit-test claim.

## Implementation Decisions

- **The command table's `view.sidebar` row** gets a Windows-only v2 override: primary Ctrl+Shift+F (written in the table's
  `Cmd` notation, which maps to Ctrl off macOS) and one v2 secondary, Ctrl+Shift+L. macOS and Linux keep the shared v2
  value. v1 does not change.
- **The generated menu layout is regenerated** from the table, through its freshness test. The Rust menu builder and the
  applied-shortcuts command read the Windows primary from it. No hand-written accelerator changes, unless rule 41's audit
  finds a hardcoded sidebar accelerator in the native menu. In that case the menu must take the Windows value from the
  layout too.
- **The defaults version stays 2.** No v3, and no v2→v3 migration. A stored value that equals Ctrl+Shift+L under a v2 stamp
  is kept, under the migration's existing rule that only from-version defaults move. This is safe only because v2 has not
  shipped in any release. The spec depends on that fact.
- **The v1→v2 migration map** is updated where it holds the Windows v2 default for this field. A Windows user on v1 holding
  the v1 default Ctrl+Shift+L moves to the new v2 primary, Ctrl+Shift+F, and gets the secondary.
- **Settings' defaults and conflict detection** read the same table, so they follow without separate edits. The table's
  conflict laws (binding-conflicts) must still hold: Ctrl+Shift+F is not a default of any other Windows action.
- **The keyboard shortcuts guide** splits the Toggle Sidebar row by platform. The menu reorganisation plan's v2 defaults
  table (the literal table that the command-table tests check against) is updated to match, in the same change.
- **The feature ledger's shortcut row** changes its Windows default and how to confirm it. `CHANGELOG.md` gets an
  Unreleased line.
- **An ADR** records the per-platform default and the options considered (draft: `adr-draft-windows-sidebar-default.md`).

## Testing Decisions

- **A good test checks behaviour at the seam** (the resolved binding, a dispatched action, a migrated value). It never
  checks how the table stores it.
- **Seam 1, the command table (unit).** It resolves Toggle Sidebar's v2 bindings per platform:
  - Windows: primary Ctrl+Shift+F, secondary Ctrl+Shift+L;
  - macOS: ⌘⇧L, with no new secondary;
  - Linux: Ctrl+Shift+L.

  On every platform, v1 is unchanged and the conflict laws hold. Prior art: `tests/command-table.test.ts` (the "v2
  defaults equal the literal § 5.3.2 table" block) and `tests/binding-conflicts*.test.ts`. The generated layout's
  freshness test proves that the Rust input follows.
- **Seam 2, keydown dispatch (unit).** On a non-Mac platform with the v2 Windows defaults:
  - a Ctrl+Shift+F keydown triggers `view.toggle_sidebar` exactly once and logs it;
  - a Ctrl+Shift+L keydown does the same;
  - a rebound primary leaves the secondary working;
  - neither chord fires any other action.

  Prior art: the shortcut-matching tests (`tests/chord.test.ts`, `tests/m7-shortcuts-rows.test.tsx`).
- **Seam 3, migration (Rust unit).**
  - A Windows v1 config holding the v1 default moves to Ctrl+Shift+F.
  - A custom value is kept.
  - A v2-stamped Ctrl+Shift+L is kept.
  - "Reset to default" yields Ctrl+Shift+F.

  Prior art: `preferences_migration_tests.rs` and `preferences_migration_load_tests.rs`.
- **Device (win-desktop, ADR-0144), in the shared W036 rerun:**
  - `RegisterHotKey` for Ctrl+Shift+F succeeds and is unregistered at once;
  - a real Ctrl+Shift+F press in the installed build logs `ui.shortcut.trigger` with `view.toggle_sidebar`, and the
    sidebar changes;
  - the View menu shows Ctrl+Shift+F;
  - Ctrl+Shift+L is recorded as owned elsewhere on this PC: `RegisterHotKey` returns 1409 and no trigger is logged.

  The D50 card's step 2 is rewritten to these steps.

## Out of Scope

- Detecting chords that another program has registered system-wide, and warning about them in Settings. A separate D row,
  only on the user's word.
- Finding out which program on win-desktop owns Ctrl+Shift+L.
- Changing the macOS or Linux defaults.
- A defaults-version bump or a new migration step.
- A "Find in files" feature, which this change keeps off Ctrl+Shift+F on Windows.

## Further Notes

- **Release.** In v0.3.6 (user: 「Fix in 0.3.6」). The device AC runs in the W036 rerun with the D336–D338 driver fix, on
  one locked build.
- **The fact the spec depends on:** M1b `7b801703` (v2 defaults) is not in `v0.3.5`. If 0.3.6 ships before this lands, the
  "no migration" decision no longer holds, and the spec needs a new revision.
- **Evidence for the cause:** `~/.mdpro-redesign/device/D50-probe-report.md`, classification A (P1 lastError 1409).
- **Terms**, from `glossary-edits.md`: default binding, secondary binding, defaults version, owned elsewhere.

- **Seams confirmed by the user** (2026-10-30): 「对的」, for the three unit seams (command table, keydown dispatch, migration) and the device AC.
