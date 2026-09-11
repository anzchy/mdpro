---
description: Keep shortcut definitions in sync across menu.rs, preferences.ts, the shortcut hook, the Settings panel, and user docs.
paths:
  - "src-tauri/src/menu.rs"
  - "src/types/preferences.ts"
  - "src/hooks/useKeyboardShortcuts.ts"
  - "src/components/common/settings/KeyboardShortcutsSettings.tsx"
  - "docs/guide/keyboard-shortcuts.md"
---

# 41 - Keyboard Shortcuts

**When adding, changing, or removing a shortcut, update every file below that
holds it.** `menu.rs` accelerators are hardcoded and never read preferences, so
drift is silent: the Settings panel lists the `preferences.ts` key while the
native menu fires on the `menu.rs` key, and for an action with no
`useKeyboardShortcuts` branch (e.g. `viewSource`) the listed key does nothing.

## Files to Keep in Sync

| File | Holds | Format (real example) |
|------|-------|-----------------------|
| `src-tauri/src/menu.rs` | Native macOS menu accelerators | `Some("CmdOrCtrl+Alt+T")`, `Some("Ctrl+2")` |
| `src/types/preferences.ts` | `KeyboardShortcuts` fields + `DEFAULT_KEYBOARD_SHORTCUTS` | `paragraphTable: "Cmd+Option+T"`, `tableInsertRowAbove: "Cmd+Option+Up"` |
| `src/hooks/useKeyboardShortcuts.ts` | Webview keydown dispatch; one `matchesShortcut(event, shortcuts.<field>)` branch per action | `shortcuts.paragraphTable` |
| `src/components/common/settings/KeyboardShortcutsSettings.tsx` | `SHORTCUT_CATEGORIES`: the rows the Settings panel lists and lets users rebind | `{ key: "paragraphTable", label: "Table" }` |
| `docs/guide/keyboard-shortcuts.md` | User documentation and the current shortcut list | `⌘⇧N` in most tables; `Cmd + Option + T` in the Format and Table actions tables |

## Format Differences

- **menu.rs** (Tauri accelerator): `CmdOrCtrl`, `Ctrl`, `Alt`, `Shift`, joined by `+`.
- **preferences.ts** (parsed by `matchesShortcut`): `Cmd` (Meta on macOS, Ctrl
  elsewhere), `Ctrl`, `Option`, `Shift`; arrows are `Up` / `Down` / `Left` / `Right`.
  `Alt` in menu.rs is `Option` here.
- **Docs**: macOS glyphs (`⌘⇧N`, `⌃2`) or spaced words (`Cmd + Option + T`).

## Conflict Check Before Adding

Grep for the key suffix across both definition files (example: `T`):

```bash
grep -nE '\+T"' src-tauri/src/menu.rs src/types/preferences.ts
```

## Current Shortcuts

`docs/guide/keyboard-shortcuts.md` is the current list. Don't mirror it here.
