## Problem Statement

On Windows, pressing Ctrl+Shift+L does not toggle the sidebar. Nothing happens, and nothing tells the user why. On the
test PC, another program has registered Ctrl+Shift+L as a system-wide hotkey, so the keystroke never reaches mdpro. Every
other shortcut on the same path works. Users who hit this cannot reach the sidebar from the keyboard, and they have no way
to discover that a different chord would work.

The replacement chord must itself reach mdpro on Chinese Windows machines. r1 chose Ctrl+Shift+F, but Microsoft Pinyin,
which is enabled on the test PC, binds Ctrl+Shift+F to its Simplified/Traditional switch by default, and Sogou does the
same. An input method's hotkey takes the chord before the page sees it, so Ctrl+Shift+F would fail silently for the same
users.

## Solution

On Windows, Toggle Sidebar gets a new default binding, **Ctrl+Shift+1**, and the View menu shows it and takes it.
Ctrl+Shift+L stays as a secondary binding, so it still works on machines where nothing else owns it. macOS keeps ⌘⇧L and
Linux keeps Ctrl+Shift+L. A user who has already chosen their own sidebar chord keeps it. Ctrl+Shift+1 is Typora's
Windows key for its Outline sidebar, and mdpro's sidebar is the outline.

## User Stories

1. As a Windows user, I want Ctrl+Shift+1 to toggle the sidebar, so that I can show and hide it from the keyboard even when
   another program owns Ctrl+Shift+L.
2. As a Windows user, I want the View menu to show Ctrl+Shift+1 next to Toggle Sidebar, so that I can discover the chord
   that works.
3. As a Windows user coming from Typora, I want Ctrl+Shift+1 to open and close the outline sidebar as it does there, and
   Ctrl+Shift+L to still toggle the sidebar where no other program owns it, so that my habits keep working.
4. As a Windows user, I want Settings → Keyboard Shortcuts to list Ctrl+Shift+1 as the Toggle Sidebar default and
   Ctrl+Shift+L as its secondary, so that what I see matches what works.
5. As a Windows user, I want "Reset to default" on Toggle Sidebar to restore Ctrl+Shift+1, so that resetting gives me the
   working chord.
6. As a Windows user who rebound Toggle Sidebar myself, I want my chord kept, so that the update never overrides my choice.
7. As a Windows user, I want rebinding or clearing Toggle Sidebar's primary to leave the Ctrl+Shift+L secondary working as
   before, so that one change does not silently remove another.
8. As a Windows user, I want Ctrl+Shift+1 to toggle the sidebar in both Source and WYSIWYG views, with focus in the editor
   or elsewhere, so that it behaves like the other global shortcuts.
9. As a Windows user, I want Ctrl+Shift+1 to do nothing else, so that no editor command fires alongside the sidebar toggle
   and no character is typed.
10. As a Windows user, I want conflict detection in Settings to treat Ctrl+Shift+1 and the Ctrl+Shift+L secondary as taken
    by Toggle Sidebar, so that I am warned before I assign either to another action.
11. As a Windows user whose saved keys conflict at launch, I want the conflict notice to name Toggle Sidebar's Windows chord,
    so that it does not tell me about a chord I do not use.
12. As a Windows user on a fresh install, I want Ctrl+Shift+1 from the first launch, so that the first saved preferences do
    not pin the old chord.
13. As a Windows user on a French AZERTY keyboard, I want Ctrl+Shift+& in the editor to keep making Heading 1, so that the
    new sidebar chord does not take away a key I already use.
14. As a macOS user, I want ⌘⇧L to keep toggling the sidebar and to stay in the menu, so that nothing changes for me.
15. As a Linux user, I want Ctrl+Shift+L to remain the default, with no new secondary, so that nothing changes without
    evidence that it fails on Linux.
16. As a reader of the keyboard shortcuts guide, I want the Windows and Linux defaults for Toggle Sidebar shown separately,
    so that the guide is right on each platform.
17. As a Windows user upgrading from 0.3.5, I want to get Ctrl+Shift+1 with the rest of the new v2 defaults, so that the
    first version I install already works.
18. As a tester with a config already stamped v2, I want my stored Ctrl+Shift+L kept as a chosen value, so that test
    machines behave predictably, and "Reset to default" to give Ctrl+Shift+1.
19. As a support reader of `mdpro.log`, I want a toggle triggered by either chord to log the same `ui.shortcut.trigger`
    event with the `view.toggle_sidebar` action and the chord that was pressed, so that I can tell which chord a user used.
20. As a maintainer, I want the command table to remain the single source of the sidebar's per-platform defaults and
    secondary, with the generated menu layout, the Windows native menu, the Rust host defaults, the migration, the
    applied-shortcuts command, the keydown hook and Settings all following it, so that they cannot drift (rule 41).
21. As a maintainer, I want every Windows-only value testable on the macOS and Linux hosts that run the tests, so that a
    forgotten Windows value fails a lane instead of shipping.
22. As a maintainer, I want the change proved on the real Windows PC, so that the fix is not only a unit-test claim.

## Implementation Decisions

- **The command table's `view.sidebar` row** gets explicit per-platform v2 values: macOS primary ⌘⇧L with no secondary;
  Windows primary Ctrl+Shift+1 (table notation `Cmd+Shift+1`) with one secondary, Ctrl+Shift+L (`Cmd+Shift+L`); Linux
  primary Ctrl+Shift+L with no secondary. v1 does not change on any platform.
- **The row builder learns a three-platform value.** Today its two-way value (macOS / off-Mac) gives Linux the Windows
  value, and its v2 secondaries are one list copied to every platform. It gains an explicit per-platform form for the v2
  primary and for the v2 secondaries. The two-way form and its meaning are unchanged for every other row, and the
  builder's header comment, which says Linux always takes the off-Mac value, names the exception (rule 22).
- **Two table invariants are narrowed, not dropped.** Their replacements are named under Testing Decisions:
  - "Linux takes the Windows menu, key, availability and route on every row" becomes "on every row except
    `view.sidebar`, which differs only in its v2 primary and v2 secondaries";
  - "the v2 secondaries are F6, F3 and Shift+F3 on every platform, and no others" adds exactly one entry, Ctrl+Shift+L on
    Windows `view.sidebar`.
- **The keydown hook** distinguishes Windows from Linux, which today it does not. On Windows with defaults version 2 it
  matches the sidebar's v2 secondaries, read from the command table for the running platform, after the primary. A
  keydown runs the toggle at most once. The log names the chord that matched: the primary's string when the primary
  matched, `Cmd+Shift+L` when the secondary did. The secondary works whatever the primary holds, a custom chord or
  `<unassigned>` included, as F6 does for Cycle View Mode. macOS and Linux have no sidebar secondary. The F6 branch is not
  changed.
- **Editor keymaps keep their precedence.** On US and German layouts, Ctrl+Shift+1 produces `!` with code `Digit1`. No
  editor keymap binds that, so the keydown reaches the hook and matches the sidebar on the physical key (K8). On French
  AZERTY, the same physical key produces `1` with Shift. CodeMirror's and ProseMirror's keymaps then try the chord without
  Shift and run the editor's own Heading 1 binding (`Mod-1`) first, and the hook skips the consumed keydown. Read from the
  code, not run: `@codemirror/view` `runHandlers`, the char-key lookup without Shift; `prosemirror-keymap`
  `keydownHandler`, the `noShift` lookup. So on AZERTY, Ctrl+Shift+& in either editor stays Heading 1, as it is today,
  and with focus outside the editors it toggles the sidebar. This is the decided behaviour unless the user rules
  otherwise (Further Notes, "Open for the user").
- **The Rust host defaults become platform-valued.** Today each default is chosen at compile time between macOS and
  "other", so no test host ever builds the Windows value. A defaults constructor takes the platform as a value, and the
  compile-time platform only picks which one production uses. The serde field defaults and the `Default` value read it
  for the host. Windows' Toggle Sidebar default is Ctrl+Shift+1. Without it, a fresh Windows install would write
  Ctrl+Shift+L on its first save, which Settings then treats as a custom value, and Ctrl+Shift+1 would do nothing.
- **The v1→v2 migration becomes platform-valued.** Today one off-Mac map serves Windows and Linux. The migration plan
  carries its platform and that platform's map. The Windows map is the off-Mac map plus one new entry: Toggle Sidebar from
  Ctrl+Shift+L to Ctrl+Shift+1. The macOS and Linux maps do not change, and no existing entry is edited. The migration's
  suppression check for kept custom values reads the plan's platform, not the compile-time one.
- **The applied-shortcuts resolution takes the platform as a value too**, with the host chosen the same way. Its Windows
  result binds Ctrl+Shift+1 for Toggle Sidebar and keeps Ctrl+Shift+L owned by it.
- **The Windows native menu takes the chord from the table.** Off-Mac, the native menu does not read the generated
  layout: the View menu's Toggle Sidebar item carries a literal `CmdOrCtrl+Shift+L`. That item's accelerator now comes
  from the generated layout's v2 primary for the running platform. On Windows it is `CmdOrCtrl+Shift+1`; on Linux it stays
  `CmdOrCtrl+Shift+L`. The conversion spells the table's `Cmd` as `CmdOrCtrl`. The macOS converter keeps `Cmd`, which the
  menu library reads as the Windows key off-Mac, so it must not be reused there unchanged. The other off-Mac items keep
  their literals. The off-Mac menu still shows defaults, not a user's custom chords, as it does today for every item.
- **Places that treat Windows as Linux.** The launch conflict notice names a yielded default from the Linux column, and
  would show Ctrl+Shift+L to a Windows user. It reads the Windows-aware platform instead. The other sites that pass
  `"linux"` for Windows read only fields whose Windows and Linux values are equal. The narrowed invariant above is what
  keeps that true, so they are not changed.
- **Settings** reads the same table through its Windows-aware platform. Its defaults, its secondary display, its conflict
  detection and "Reset to default" follow without separate edits, and each gets a test (Testing Decisions). The table's
  conflict laws must still hold: Ctrl+Shift+1 is no other Windows action's default or secondary.
- **The defaults version stays 2.** No v3, and no v2→v3 migration. A stored value that equals Ctrl+Shift+L under a v2 stamp
  is kept, under the migration's existing rule that only from-version defaults move. This is safe only because v2 has not
  shipped in any release. The spec depends on that fact.
- **Documentation in the same change:**
  - the keyboard shortcuts guide splits the Toggle Sidebar row by platform;
  - the menu reorganisation plan's v2 defaults table (§ 5.3.2), which the command-table tests check against, gets the
    Windows value and a pointer to ADR-0158;
  - the M1b device chord input (`docs/test/20261023-m1b-device-chords.md`) gets the two new Windows rows, and its header
    no longer says that the Windows column stands for Linux too;
  - the semantic-find plan's key question (S-U6) gets a note that Microsoft Pinyin and Sogou bind Ctrl+Shift+F by
    default, with the IME probe as evidence;
  - the feature ledger's shortcut row and its sidebar toggle row change their Windows chord and how to confirm it;
  - `CHANGELOG.md` gets an Unreleased line.
- **ADR-0158** records the per-platform default, the options considered (Ctrl+Shift+F included), and the partial
  supersession of ADR-0114 Decisions 1 and 2 for this row.

## Testing Decisions

- **A good test checks behaviour at the seam** (the resolved binding, a dispatched action, a migrated value, a menu
  accelerator). It never checks how the table stores it. A Windows case runs on any host by passing the platform as a
  value. None depends on the compile-time platform.
- **Seam 1, the command table and its Settings consumers (unit).**
  - v2 resolves per platform: Windows primary Ctrl+Shift+1 with secondary Ctrl+Shift+L; macOS ⌘⇧L, no secondary; Linux
    Ctrl+Shift+L, no secondary. v1 is unchanged everywhere, and the conflict laws hold.
  - Replacement invariants in `tests/command-table.test.ts`:
    - `:241`, "gives Linux the Windows menu, key, availability and route on every row", asserts that the rows that differ
      are exactly `["view.sidebar"]`, and that for that row the menu, availability, route, v1 and the rest of the key are
      equal, with Linux holding `Cmd+Shift+L` and no secondary;
    - `:187`, the secondaries test, expects F6, F3 and Shift+F3 on every platform plus `view.sidebar/windows:
      ["Cmd+Shift+L"]`, and nothing on `view.sidebar` for macOS or Linux;
    - the literal § 5.3.2 table (`:79`) keeps its `[macOS, off-Mac]` shape and adds an explicit Windows override for
      `viewToggleSidebar`. The changed-field count (`:160`) becomes 15 on macOS, 21 on Windows and 20 on Linux, and the
      Windows set equals the Linux set plus `viewToggleSidebar`;
    - the independent oracle `tests/support/bindingV2Defaults.ts` changes the same way.
  - Settings: `resetDefaults` yields Ctrl+Shift+1 for Windows v2, Ctrl+Shift+L for Linux v2, macOS v2 and Windows v1. On
    Windows, the Toggle Sidebar row shows default Ctrl+Shift+1 and secondary Ctrl+Shift+L. Assigning either chord to
    another action is flagged as a conflict with Toggle Sidebar. The launch notice for a yielded Toggle Sidebar names
    Ctrl+Shift+1 on Windows.
  - The generated layout's freshness test proves that the Rust input follows.
  - Prior art: `tests/command-table.test.ts`, `tests/binding-conflicts*.test.ts`, `tests/m7-row-state.test.ts`,
    `tests/settings-keyboard-shortcuts.test.ts`, `tests/settings-shortcut-conflicts.test.tsx`.
- **Seam 2, keydown dispatch (unit).**
  - Hook, Windows platform, v2:
    - Ctrl+Shift+1, sent as on US (`!`, `Digit1`), triggers `view.toggle_sidebar` once and logs `Cmd+Shift+1`;
    - Ctrl+Shift+L does the same and logs `Cmd+Shift+L`;
    - with a custom primary, and with `<unassigned>`, Ctrl+Shift+L still triggers once;
    - a custom primary equal to Ctrl+Shift+L triggers once, not twice;
    - neither chord fires another action.
  - Hook, other cases: on Linux, Ctrl+Shift+L triggers and Ctrl+Shift+1 does nothing. On Windows with defaults version 1,
    the secondary is inactive. macOS is unchanged.
  - Composed editors, Windows: in WYSIWYG and in Source, with focus in the editor and with focus outside it, Ctrl+Shift+1
    toggles once, leaves the document unchanged and runs no editor command. An AZERTY keydown (`1` with Shift, `Digit1`)
    runs Heading 1 once and does not toggle in either editor, and toggles once with focus outside the editors.
  - Prior art: `tests/d190-wi1-windows-shortcuts.test.tsx`, `tests/m1b-hook-consumed.test.tsx`,
    `tests/m1b-composed-offmac.test.tsx`, `tests/chord.test.ts`.
  - `tests/m1b-device-chord-table.test.ts` expects 76 rows, not 74.
- **Seam 3, Rust host values and migration (Rust unit, any host).**
  - The defaults constructor for Windows gives Ctrl+Shift+1, and for macOS and Linux Ctrl+Shift+L. The host-only parity
    test becomes a check of every field on all three platforms against the generated layout's v2 defaults.
  - Migration with the Windows plan: a v1 config holding Ctrl+Shift+L moves to Ctrl+Shift+1; a custom value is kept; a
    v2-stamped Ctrl+Shift+L is kept. With the Linux plan, the same v1 config keeps Ctrl+Shift+L. The "every changed v1
    default becomes the v2 default" test runs once per platform.
  - Applied shortcuts for Windows bind Ctrl+Shift+1 and keep the secondary owned.
  - The Windows View menu's Toggle Sidebar accelerator is exactly `CmdOrCtrl+Shift+1`, and Linux's is
    `CmdOrCtrl+Shift+L`. The off-Mac menu tree baselines for Windows and Linux differ only in that line. A search finds no
    literal sidebar accelerator left in the native menu code.
  - Prior art: `menu_layout_tests.rs`, `menu_from_layout_tree_tests.rs`, `preferences_migration_tests.rs`,
    `preferences_migration_load_tests.rs`.
- **Device (win-desktop, ADR-0144), in the shared W036 rerun:**
  - **Terms.**
    - A *real press* is a keystroke sent through the remote-windows-device-test driver's real-input route (`ui.sh`
      `chord`, injected in the interactive desktop session) after a real `clickat` has set focus. It is neither a page
      (CDP) event nor a key pressed by hand.
    - An *interactive-desktop probe* runs in the driver's scheduled task in the user's desktop session. Over SSH,
      `RegisterHotKey` fails with 1459 and proves nothing.
  - **Starting config.** With mdpro closed, the user's `.mdpro` folder is snapshotted and its hashes recorded. The run
    starts from configs derived from that snapshot, because the live config is v2-stamped with Ctrl+Shift+L and would
    correctly keep it:
    - **A**, v2-stamped with `viewToggleSidebar` removed. This is what a fresh install reads, and it exercises the Rust
      Windows default;
    - **B**, v1-stamped with `viewToggleSidebar` holding the v1 default. This exercises the real Windows migration.

    The stamp and the stored sidebar value are recorded before each launch. The snapshot is restored at the end and its
    hashes are checked.
  - **Input method.** The target window's HKL and the active input method (the default, WeType) are recorded before the
    presses. Windows' input-language hotkeys are read, and none is Ctrl+Shift+1.
  - **Probes.** In an interactive-desktop probe with mdpro closed, `RegisterHotKey` for Ctrl+Shift+1 succeeds and is
    unregistered at once, and the result for Ctrl+Shift+L is recorded.
  - **Presses (config A).** A real Ctrl+Shift+1 press toggles the sidebar exactly once and logs one `ui.shortcut.trigger`
    with `view.toggle_sidebar` and `Cmd+Shift+1`. It runs no other action and leaves the document bytes unchanged, in
    three places:
    - WYSIWYG, editor focused;
    - Source, editor focused;
    - a non-editor element focused.

    The View menu shows Ctrl+Shift+1.
  - **Ctrl+Shift+L.**
    - Where the probe returned 1409, a real press logs no trigger and leaves the sidebar unchanged. The passing
      Ctrl+Shift+1 presses and the card's Ctrl+Shift+N control, on the same route in the same run, make that negative
      meaningful.
    - Where the probe succeeded, a real press triggers once and logs `Cmd+Shift+L`.
  - **Migration (config B).** After one launch, the config is stamped 2 and holds Ctrl+Shift+1, and one real press
    toggles.
  - The D50 card is rewritten to these steps.

## Out of Scope

- Detecting chords owned elsewhere and warning about them in Settings. A separate D row, only on the user's word.
- Proving which program owns Ctrl+Shift+L on win-desktop. The IME probe found AMD Radeon Software's "Toggle Performance
  Logging" bound to it, an inference that was not tested.
- Changing the macOS or Linux defaults.
- A defaults-version bump or a new migration step.
- Making the off-Mac native menu show custom chords, for this item or any other.
- Making F6 or any other hard-coded hook key read the table.
- Changing the platform-collapse sites whose fields are equal on Windows and Linux.
- Typora's exact Ctrl+Shift+1 behaviour, which opens the sidebar on its Outline tab. mdpro toggles.
- A "Find in files" key. Ctrl+Shift+F stays unassigned on Windows; the semantic-find plan only gets the IME note.

## Further Notes

- **Release.** In v0.3.6 (user: 「Fix in 0.3.6」). The device AC runs in the W036 rerun with the D336–D338 driver fix, on
  one locked build.
- **The fact the spec depends on:** M1b `7b801703` (v2 defaults) is not in `v0.3.5`. If 0.3.6 ships before this lands, the
  "no migration" decision no longer holds, and the spec needs a new revision.
- **Evidence:**
  - for the cause, `~/.mdpro-redesign/device/D50-probe-report.md`, classification A (P1 lastError 1409);
  - for the IME, `~/.mdpro-redesign/device/D50-ime-probe-report.md`, classification B, read-only. Microsoft Pinyin is
    enabled. Its Simplified/Traditional switch is on (`EnableSimplifiedTraditionalOutputSwitch = 1`, key code 70 = F),
    and its Ctrl modifiers come from Microsoft's documentation. WeType is the default IME, and its own binding is
    undetermined. AMD Radeon binds Ctrl+Shift+L, O and X, not F or 1;
  - for the chord, the candidate study, `~/.mdpro-redesign/device/D50-chord-candidates.md`. The real resolver finds
    Ctrl+Shift+1 free on all three platforms, in v1 and v2, in every context.
- **User decisions after r1's plan review:**
  - 「Probe the IME first (Recommended)」, then 「Pick a different chord (Recommended)」: Ctrl+Shift+F is dropped;
  - 「Ctrl+Shift+1 (Recommended)」: Windows v2 primary Ctrl+Shift+1, Ctrl+Shift+L secondary, macOS ⌘⇧L, Linux
    Ctrl+Shift+L.
- **Earlier decisions that still bind:**
  - 「New Windows default (gated)」;
  - the grill, 「全部同意」;
  - the seams, 「对的」, for the three unit seams and the device AC. r2 keeps three unit seams: Reset moves from the
    migration seam to Seam 1, where it is tested, and Seam 3 now covers every platform-valued Rust value;
  - 「Fix in 0.3.6」.
- **Supersession.** ADR-0158 partially supersedes ADR-0114 Decision 1 (D12 「B · Keep ⇧⌘L (Recommended)」 and D6, Linux
  built with the Windows tree) and Decision 2 (the § 5.3.2 table), for `view.sidebar` on Windows only. ADR-0114 gets a
  forward link when ADR-0158 is accepted.
- **Terms**, from `GLOSSARY.md` § Keyboard shortcuts: default binding, secondary binding, defaults version, owned
  elsewhere. "Owned elsewhere" is widened to cover input-method hotkeys.
- **Open for the user:**
  - AZERTY. Inside the editors, Ctrl+Shift+& stays Heading 1 and does not toggle the sidebar. There, the sidebar is
    reached by Ctrl+Shift+L where it is free, by the menu, or by a custom chord. The alternative is to make the sidebar
    win over the editors' Heading 1 on AZERTY. That would take a key AZERTY users have today and would need an editor
    keymap change. Recommended: accept, as written above.
