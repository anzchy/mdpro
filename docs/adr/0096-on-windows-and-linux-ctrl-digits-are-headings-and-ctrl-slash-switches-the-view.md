# 0096. On Windows and Linux, Ctrl+1–6 are headings and Ctrl+/ switches the view

**Status**: Accepted (2026-10-14). Decided by the user, relayed by
mdpro-delegator: 「Headings win, Ctrl+/ toggles (Recommended)」. Implemented by
mdpro-a3 as D190-WI-6. macOS is unchanged. Partially superseded
(2026-10-16) by [ADR-0114](0114-the-menu-bar-and-default-keys-follow-one-command-table-and-vmark.md): the strikethrough clause and the
"stored preference strings are not changed" clause.

## Context

- **Two of mdpro's shortcut pairs are told apart on macOS only by ⌘ versus ⌃.**
  - Headings are `Mod-1` … `Mod-6` (Milkdown `typoraKeymapPlugin.ts`, CodeMirror
    `headingPlugin.ts`, and the window hook `useKeyboardShortcuts.ts`).
  - The View menu's Source and WYSIWYG items carry `Ctrl+2` and `Ctrl+4`
    (`menu_submenus.rs`).
  - Inline code is `Mod-Shift-\``; strikethrough is `Ctrl-Shift-\``.

  ProseMirror's and CodeMirror's `Mod` is ⌘ on macOS and Ctrl everywhere else.
  So on Windows and Linux each pair is one chord.
- **The Windows audit found both** (W6, `docs/feature-ledger-windows-audit-claude.md`):
  - Ctrl+Shift+\` gave strikethrough, so inline code had no key.
  - The View menu advertised Ctrl+2 and Ctrl+4, which the editor spends on
    headings 2 and 4.
- **What actually ran on each platform.**
  - **Windows:** WebView2 keeps keys from Tauri's menu accelerators (D190
    WI-1b), so Ctrl+2 always made a heading and the menu label was simply
    false.
  - **Linux:** GTK menu accelerators do fire, so the menu and the editor
    competed for the key.
- **Typora is the reference** for mdpro's keymap. On Windows, Typora uses:
  - Ctrl+1–6 for headings;
  - Ctrl+/ to toggle source mode;
  - Ctrl+Shift+\` for inline code;
  - Alt+Shift+5 for strikethrough.
- **mdpro has exactly two view modes** (`ViewMode = "wysiwyg" | "source"`), so
  Cycle View Mode (`CmdOrCtrl+/`, already on every platform) is a toggle.

## Options considered

1. **Headings keep Ctrl+1–6; the view switch is Ctrl+/ (chosen).**
   - Source and WYSIWYG lose their own accelerator off-Mac.
   - Cycle View Mode, Ctrl+/, toggles between the two.
   - This matches Typora on Windows and what the editor already did on
     Windows.
2. **The view switch keeps Ctrl+2 / Ctrl+4; headings 2 and 4 lose their key.**
   - Lost: two of six headings would have no shortcut, and the set would be
     ragged (1, 3, 5, 6).
   - It contradicts Typora.
   - On Windows it would also need the window hook to take Ctrl+2 / Ctrl+4
     away from the editor, since the native accelerator never fires there.
3. **The view switch moves to Ctrl+Alt+2 / Ctrl+Alt+4.**
   - Lost: Windows reports AltGr as Ctrl+Alt. On European layouts AltGr+2 and
     AltGr+4 type characters (for example `²`, `@`, `$`), so the chord would
     swallow typing or be refused by the AltGr guard (`useKeyboardShortcuts.ts`,
     D190 audit b98).
   - It adds a chord nobody expects from Typora.

## Decision

- **On Windows and Linux:**
  - Ctrl+1–6 are headings (unchanged in the editor).
  - The View → Source and View → WYSIWYG items carry no accelerator
    (`view_item_accelerator(_, macos: false)` returns `None`).
  - View → Cycle View Mode, Ctrl+/, is the view switch, and its menu label
    shows that key.
- **Strikethrough moves off Ctrl+Shift+\` there:**
  - It takes Alt+Shift+5, Typora's Windows key
    (`strikethroughShortcut(false)`).
  - Inline code keeps Ctrl+Shift+\`.
  - The ruling above did not name this key. The implementor chose it for
    Typora parity, and it is recorded here so it can be overruled on its own.
- **macOS keeps:**
  - ⌃2 / ⌃4 for Source / WYSIWYG;
  - ⌘⇧\` for inline code;
  - ⌃⇧\` for strikethrough.

## Consequences

- A Windows or Linux user can type every heading level and inline code by
  keyboard, and the View menu no longer names a key the editor uses for
  something else.
- **Cost:**
  - Off-Mac there is no direct "go to Source" or "go to WYSIWYG" key, only
    the toggle. A user who wants a mode, not a flip, must look at the
    current mode first.
  - A macOS user moving to Windows relearns two keys: the view switch and
    strikethrough.
- **Cost:**
  - Alt+Shift alone is Windows' default input-language switch hotkey. That
    hotkey fires on the bare modifiers, so Alt+Shift+5 still reaches the app,
    but a user who presses Alt+Shift slowly may see the language switch as
    well.
  - On layouts where Shift+5 is not `%`, prosemirror-keymap still matches by
    key code (`5`).
- **The stored preference strings are not changed.** `viewSource` `Ctrl+2`,
  `viewWysiwyg` `Ctrl+4` and `formatStrike` `Ctrl+Shift+\`` stay in
  `preferences.ts` and `preferences.rs`, so the preferences contract and
  existing preference files are untouched.
  - Nothing reads these three values to bind a key; they only feed the
    Settings → Keyboard Shortcuts list.
  - Showing their off-Mac meaning there is D190 WI-7's job (the Settings
    shortcut labels), which is where the list's ⌘ / Cmd labels are fixed too.
- The W6 cases are pinned by `tests/d190-wi6-windows-keymap.test.ts`. It
  resolves real keydowns through prosemirror-keymap's `keydownHandler`, not by
  comparing strings. The menu side is pinned by
  `src-tauri/src/menu_submenus_wi6_tests.rs`.
