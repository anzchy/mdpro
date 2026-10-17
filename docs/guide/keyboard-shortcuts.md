# Keyboard Shortcuts

mdpro provides comprehensive keyboard shortcuts inspired by Typora and other popular Markdown editors.

## Global Shortcuts

These shortcuts work across all view modes.

### File Operations

| Shortcut | Action | Handler |
|----------|--------|---------|
| ⌘N | New document | `createDocument()` |
| ⌘⇧N | New window | `file.new_window` menu action |
| ⌘O | Open file | `openDocumentFromDialog()` |
| ⌘S | Save | `saveActiveDocument()` |
| ⌘W | Close document | `handleCloseRequest()` |
| ⌘⇧E | Export HTML | `exportHtml()` |

### View Mode

| Shortcut | Action | Target Mode |
|----------|--------|-------------|
| ⌃2 | Source | `source` |
| ⌃4 | WYSIWYG | `wysiwyg` |
| ⌘/ | Cycle View Mode | Toggles between source and wysiwyg — works from any context, including the CodeMirror editor |

> **Note**: View mode shortcuts use **Control** (⌃) key to avoid conflicts with Typora-style heading shortcuts (⌘1-6). ⌘/ cycles unconditionally; the line-comment shortcut moved to ⌘⌥/ to avoid the collision.

### UI Toggles

| Shortcut | Action |
|----------|--------|
| ⌘⇧L | Toggle Sidebar |
| ⌘, | Open Preferences |

## WYSIWYG Mode Shortcuts (Milkdown)

These shortcuts work only in WYSIWYG mode via the Typora-style keymap plugin.

### Typora-style Inline Editing

When the cursor is positioned inside certain inline elements, they expand to show their raw Markdown syntax:

| Element | Collapsed | Expanded (when cursor inside) |
|---------|-----------|-------------------------------|
| Link | [test link](blue, underlined) | `[test link](https://example.com)` |
| Inline Code | `code` (styled) | `` `code` `` (with backticks) |

| Shortcut | Action |
|----------|--------|
| ⌃\` | Force-reveal inline element under cursor |

This allows editing the URL or code content directly without switching to Source mode.

### Headings

| Shortcut | Action |
|----------|--------|
| ⌘1 | Heading 1 |
| ⌘2 | Heading 2 |
| ⌘3 | Heading 3 |
| ⌘4 | Heading 4 |
| ⌘5 | Heading 5 |
| ⌘6 | Heading 6 |
| ⌘0 | Paragraph (remove heading) |

> **Note**: In WYSIWYG mode, ⌘1-6 are heading shortcuts. Use ⌃2/⌃4 or ⌘/ to switch view modes.

### Text Formatting

| Shortcut | Action | Markdown |
|----------|--------|----------|
| ⌘B | Bold | `**text**` |
| ⌘I | Italic | `*text*` |
| ⌘⇧\` | Inline Code | `` `code` `` |
| ⌃⇧\` | Strikethrough | `~~text~~` |
| ⌘K | Insert Link | `[text](url)` |

> **Note**: Underline (⌘U) is listed in preferences but is not active in WYSIWYG mode. CommonMark and GFM have no underline mark, so there is no Milkdown command to bind.

### Built-in ProseMirror

| Shortcut | Action |
|----------|--------|
| ⌘Z | Undo |
| ⌘⇧Z | Redo |
| Tab | Indent (in lists) |
| ⇧Tab | Outdent (in lists) |
| Enter | New line / continue list |

## Source Mode Shortcuts (CodeMirror)

These shortcuts work in source mode.

### Selection

| Shortcut | Action |
|----------|--------|
| ⌘⇧H | Highlight selection |
| ⌘A | Select all |
| ⌘D | Select word |

### Format

| Shortcut | Action |
|----------|--------|
| Cmd + Option + T | Insert Table — opens the rows × cols picker (also via Format → Insert Table menu) |

### Table actions (cursor inside a table)

These shortcuts only fire when the cursor is inside a GFM table; outside a table
they're harmless no-ops. Direction-mnemonic via `Cmd + Option` + arrow.

| Shortcut | Action |
|----------|--------|
| Cmd + Option + ↑ | Insert row above |
| Cmd + Option + ↓ | Insert row below |
| Cmd + Option + ← | Insert column left |
| Cmd + Option + → | Insert column right |
| Cmd + Option + ⌫ | Delete current row |
| Cmd + Option + Shift + ⌫ | Delete current column |

### Editing

| Shortcut | Action |
|----------|--------|
| ⌘Z | Undo |
| ⌘⇧Z | Redo |
| ⌘⌥/ | Toggle line comment |
| Tab | Indent |
| ⇧Tab | Outdent |

## Implementation

### Global Shortcuts (useKeyboardShortcuts.ts)

```typescript
export function useKeyboardShortcuts({
  onNew,
  onOpen,
  onSave,
  onClose,
  onHighlight,
  onToggleSidebar,
  onCycleViewMode,
  onOpenPreferences,
}: UseKeyboardShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMod = event.metaKey || event.ctrlKey;

      if (isMod && event.key === "n") {
        event.preventDefault();
        onNew();
      }
      // ... more shortcuts
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [/* dependencies */]);
}
```

### Milkdown Keymap Plugin (src/plugins/milkdown/typoraKeymapPlugin.ts)

```typescript
const createTyporaKeymap = () =>
  $useKeymap("typora", {
  heading1: {
    shortcuts: "Mod-1",
    command: (ctx) => {
      const commands = ctx.get(commandsCtx);
      return () => commands.call(wrapInHeadingCommand.key, 1);
    },
  },
  bold: {
    shortcuts: "Mod-b",
    command: (ctx) => {
      const commands = ctx.get(commandsCtx);
      return () => commands.call(toggleStrongCommand.key);
    },
  },
  // ... more shortcuts
});
```

### CodeMirror Keymaps (src/plugins/codemirror/*)

CodeMirror shortcuts are defined inside individual plugins (e.g. heading, link,
highlight) and loaded via `pluginRegistry.getCodemirrorExtensions()`.

### Menu Integration (menu.rs)

Rust-side menu with accelerators:

```rust
MenuItem::with_id_and_accelerator(app, "new", "New", "CmdOrCtrl+N")?;
MenuItem::with_id_and_accelerator(app, "open", "Open...", "CmdOrCtrl+O")?;
MenuItem::with_id_and_accelerator(app, "save", "Save", "CmdOrCtrl+S")?;
```

## Shortcut Customization

Shortcuts can be customized via the Settings dialog:

### The Settings › Keyboard Shortcuts page (M7)

The page is built from the command table (`src/commands/commandTable.ts`), not
from a list of its own, so every entry has a row
(`src/components/common/settings/shortcuts/`):

- **Groups** follow D14: File, Edit, Paragraph, Format, View, Table, then the
  mdpro and Window groups. Export HTML is in File, Highlight in Format, Undo
  and Redo in Edit, and off-Mac Exit in File. Rows keep the table's order.
- **Configurable rows** (all 58 preference fields) have a key button. A
  WYSIWYG-only or Source-only command has that line, muted, under its name.
  The line states what the command can do, not the mode you are in.
- **Not available** rows have muted names and no key button, so clicking
  them records nothing. Their stored value is saved unchanged.
- **Fixed rows** show their key in a dashed box that is not a button. That
  is every built-in item with a key on the platform: Undo, Redo, Cut, Copy,
  Paste and Select All everywhere; on macOS also Quit, Hide, Hide Others,
  Minimize, Close Window and Enter Full Screen; on Windows, Minimize and
  Close Window. **System rows** (Jump to Top / Bottom once defaults v2
  apply) show "System" the same way. Fixed second keys, such as F6 on Cycle
  View Mode, sit beside the main key in a dashed box of their own.
- **Pending:** a key change applies at the next launch. Until then, a row
  whose saved key differs from the one the app is running with shows
  "Active: … · after restart: …". It compares the saved key with the run's
  applied snapshot (`get_applied_shortcuts`), never with unsaved edits.
- **Recording:** a key needs a modifier, except F1–F12, which record alone.
- **Reset to Defaults** restores the table's defaults for the stored
  defaults version, `<unassigned>` and `<system>` included.
- **Save** is refused while any conflict remains (M1a); the banner names
  both sides.


```typescript
// See src/types/preferences.ts for the full interface
interface KeyboardShortcuts {
  // File operations
  fileNew: string;
  fileOpen: string;
  fileSave: string;
  fileSaveAs: string;
  fileClose: string;
  // Edit operations
  editFind: string;
  editReplace: string;
  // Paragraph operations
  paragraphHeading1: string;
  // Format operations
  formatStrong: string;
  formatHighlight: string;
  // View operations
  viewToggleSidebar: string;
  viewCycleViewMode: string;
  // ... plus many more (see full interface in source)
}

const DEFAULT_KEYBOARD_SHORTCUTS: KeyboardShortcuts = {
  fileNew: "Cmd+N",
  fileOpen: "Cmd+O",
  fileSave: "Cmd+S",
  fileSaveAs: "Cmd+Shift+S",
  fileClose: "Cmd+W",
  editFind: "Cmd+F",
  editReplace: "Cmd+H",
  paragraphHeading1: "Cmd+1",
  formatStrong: "Cmd+B",
  formatHighlight: "Cmd+Shift+H",
  viewToggleSidebar: "Cmd+Shift+L",
  viewCycleViewMode: "Cmd+/",
  // ...
};
```

Customizations are persisted via preferences.

## Conflict Resolution

### ⌘1-6 in WYSIWYG Mode

In WYSIWYG mode, ⌘1-6 are bound to headings (Typora behavior). Switch
modes with ⌃2 / ⌃4 or ⌘/ — all three work from any focus state.
Conflicts between plugin shortcuts follow plugin priority order.

### ⌘/ vs Line Comment

⌘/ cycles view modes unconditionally — even when the CodeMirror source
editor has focus. The line-comment shortcut moved to ⌘⌥/ to free the
binding. This is implemented as a `Prec.highest` keymap in
`Editor.tsx` so it overrides basicSetup's defaultKeymap, which would
otherwise grab ⌘/ for `toggleLineComment`.

### Focus-Based Routing

Most shortcuts route by focus; ⌘/ and ⌘⌥/ are handled by the editor's
high-precedence keymap, which calls the global store action directly.

```
┌─────────────────────┐
│  Key Event          │
└─────────────────────┘
          │
          ▼
┌──────────────────────────────┐
│  Editor high-prec keymap?    │──Yes──▶ Editor.tsx viewModeKeymap
│  (⌘/ cycle, ⌘⌥/ comment)    │         calls store action or CM cmd
└──────────────────────────────┘
          │ No
          ▼
┌─────────────────────┐
│  Is editor focused? │──Yes──▶ Editor handles (Milkdown/CM)
└─────────────────────┘
          │ No
          ▼
┌─────────────────────┐
│  Global handler     │
│  (useKeyboard-      │
│   Shortcuts)        │
└─────────────────────┘
```

## Platform Considerations

- `Mod` = ⌘ (Command) on macOS
- `Mod` = Ctrl on Windows/Linux (future)
- All shortcuts use `event.metaKey` check on macOS

## Quick Reference Card

```
┌────────────────────────────────────────────┐
│              mdpro Shortcuts               │
├────────────────────────────────────────────┤
│ FILE                                       │
│   ⌘N    New          ⌘O    Open           │
│   ⌘⇧N   New Window   ⌘S    Save           │
│   ⌘W    Close        ⌘⇧E   Export HTML     │
├────────────────────────────────────────────┤
│ VIEW (uses Control key)                    │
│   ⌃2    Source       ⌃4    WYSIWYG        │
│   ⌘/    Cycle        ⌘⇧L   Sidebar        │
├────────────────────────────────────────────┤
│ WYSIWYG FORMATTING                         │
│   ⌘B    Bold         ⌘I    Italic         │
│   ⌘⇧`   Inline Code  ⌃⇧`   Strikethrough  │
│   ⌘K    Link         ⌘0-6  Headings       │
│   ⌃`    Inline Reveal                     │
├────────────────────────────────────────────┤
│ EDITING                                    │
│   ⌘Z    Undo         ⌘⇧Z   Redo           │
│   ⌘⇧H   Highlight    ⌘⌥/   Toggle Comment │
└────────────────────────────────────────────┘
```

## Related Documentation

- [View Modes](./view-modes.md)
- [Milkdown Integration](./milkdown-integration.md)
