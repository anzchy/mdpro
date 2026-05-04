---
description: Keep shortcut definitions in sync across menu.rs, preferences.ts, and user docs.
paths:
  - "src-tauri/src/menu.rs"
  - "src/types/preferences.ts"
  - "src/hooks/useKeyboardShortcuts.ts"
  - "src/components/common/settings/KeyboardShortcutsSettings.tsx"
  - "docs/guide/keyboard-shortcuts.md"
---

# 41 - Keyboard Shortcuts

When adding, changing, or removing a keyboard shortcut, update ALL three files.

## Files to Keep in Sync

| File | Purpose | Format |
|------|---------|--------|
| `src-tauri/src/menu.rs` | Native macOS menu accelerators | `"CmdOrCtrl+Shift+L"` |
| `src/types/preferences.ts` | `DEFAULT_KEYBOARD_SHORTCUTS` defaults | `{ key: "mod+shift+l" }` |
| `docs/guide/keyboard-shortcuts.md` | User documentation | `Cmd + Shift + L` |

## Format Differences

| Context | Example | Notes |
|---------|---------|-------|
| Rust menu (`menu.rs`) | `CmdOrCtrl+Shift+S` | `+` separator, full modifier names |
| TypeScript (`preferences.ts`) | `mod+shift+s` | lowercase, `mod` for Cmd/Ctrl |
| Documentation | `Cmd + Shift + S` | Human-readable with spaces |

## Conflict Check Before Adding

```bash
# Check menu.rs for existing accelerators
grep -i "CmdOrCtrl" src-tauri/src/menu.rs | grep -i "YourKey"

# Check preferences.ts for existing defaults
grep "defaultKey" src/types/preferences.ts
```

## Registered Shortcuts (current)

| Action | Shortcut | menu.rs | preferences.ts |
|--------|----------|---------|----------------|
| New | ⌘N | ✓ | ✓ |
| Open | ⌘O | ✓ | ✓ |
| Save | ⌘S | ✓ | ✓ |
| Close | ⌘W | ✓ | ✓ |
| Toggle Sidebar | ⌘⇧L | ✓ | ✓ |
| Source | ⌃2 | ✓ | — |
| WYSIWYG | ⌃4 | ✓ | — |
| Cycle view mode | ⌘/ | ✓ | ✓ (also bound in Editor.tsx high-prec keymap so source mode honours it) |
| Toggle line comment | ⌘⌥/ | — (CodeMirror keymap in Editor.tsx) | — |
| Inline reveal | ⌃` | — (ProseMirror keymap) | — |
| Export HTML | ⌘⇧E | ✓ | — |
| Highlight | ⌘⇧H | ✓ | ✓ |
