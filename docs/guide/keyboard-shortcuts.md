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
| ⌃1 | Split View | `split` |
| ⌃2 | Editor Only | `editor-only` |
| ⌃3 | Preview Only | `preview-only` |
| ⌃4 | WYSIWYG | `wysiwyg` |
| ⌘/ | Cycle View Mode | Next in order — **only when CodeMirror editor is not focused** |

> **Note**: View mode shortcuts use **Control** (⌃) key to avoid conflicts with Typora-style heading shortcuts (⌘1-6).
>
> **⌘/ context-sensitivity**: When the CodeMirror source editor has keyboard focus, ⌘/ toggles line comments (see [CodeMirror Mode Shortcuts](#codemirror-mode-shortcuts)). When the editor is not focused, ⌘/ cycles the view mode.

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

This allows editing the URL or code content directly without switching to Editor mode.

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

> **Note**: In WYSIWYG mode, ⌘1-6 are heading shortcuts. Use ⌃1-4 or ⌘/ to switch view modes.

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

## CodeMirror Mode Shortcuts

These shortcuts work in split and editor-only modes.

### Selection

| Shortcut | Action |
|----------|--------|
| ⌘⇧H | Highlight selection |
| ⌘A | Select all |
| ⌘D | Select word |

### Editing

| Shortcut | Action |
|----------|--------|
| ⌘Z | Undo |
| ⌘⇧Z | Redo |
| ⌘/ | Toggle comment — **only when editor has focus** |
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

```typescript
interface KeyboardShortcuts {
  newDocument: string;
  openDocument: string;
  saveDocument: string;
  closeDocument: string;
  toggleSidebar: string;
  cycleViewMode: string;
  highlightSelection: string;
}

const DEFAULT_KEYBOARD_SHORTCUTS: KeyboardShortcuts = {
  newDocument: "meta+n",
  openDocument: "meta+o",
  saveDocument: "meta+s",
  closeDocument: "meta+w",
  toggleSidebar: "meta+shift+l",
  cycleViewMode: "meta+/",
  highlightSelection: "meta+shift+h",
};
```

Customizations are persisted via preferences.

## Conflict Resolution

### ⌘1-6 in WYSIWYG Mode

In WYSIWYG mode, ⌘1-6 are bound to headings (Typora behavior).
Global view mode shortcuts are disabled to prevent conflicts.
Conflicts between plugin shortcuts follow plugin priority order.

**Workaround**: Use View menu or ⌘/ to cycle modes.

### Focus-Based Routing

Shortcuts are handled differently based on focus:

```
┌─────────────────────┐
│  Key Event          │
└─────────────────────┘
          │
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
│   ⌃1    Split        ⌃2    Editor         │
│   ⌃3    Preview      ⌃4    WYSIWYG        │
│   ⌘/    Cycle        ⌘⇧L   Sidebar        │
├────────────────────────────────────────────┤
│ WYSIWYG FORMATTING                         │
│   ⌘B    Bold         ⌘I    Italic         │
│   ⌘⇧`   Inline Code  ⌃⇧`   Strikethrough  │
│   ⌘K    Link         ⌘0-6  Headings       │
├────────────────────────────────────────────┤
│ EDITING                                    │
│   ⌘Z    Undo         ⌘⇧Z   Redo           │
│   ⌘⇧H   Highlight                         │
└────────────────────────────────────────────┘
```

## Related Documentation

- [View Modes](./view-modes.md)
- [Milkdown Integration](./milkdown-integration.md)
