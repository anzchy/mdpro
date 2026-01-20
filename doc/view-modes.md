# View Modes

mdpro supports 4 view modes to accommodate different editing workflows.

## Overview

| Mode | Shortcut | Description | Engine |
|------|----------|-------------|--------|
| **Split** | ⌘1 | Editor + Preview side-by-side | CodeMirror + marked |
| **Editor Only** | ⌘2 | Source editing only | CodeMirror |
| **Preview Only** | ⌘3 | Read-only preview | marked + DOMPurify |
| **WYSIWYG** | ⌘4 | Rich text editing | Milkdown |

## Type Definition

```typescript
// src/types/editor.ts
export type ViewMode = "split" | "editor-only" | "preview-only" | "wysiwyg";
```

## Mode Details

### Split Mode (⌘1)

```
┌──────────────────┬──────────────────┐
│                  │                  │
│   CodeMirror     │    Preview       │
│   (Source)       │    (HTML)        │
│                  │                  │
└──────────────────┴──────────────────┘
```

- **Default mode** for new documents
- Editor pane on left, preview pane on right
- Real-time preview updates as you type
- Resizable split (drag divider)

### Editor Only Mode (⌘2)

```
┌─────────────────────────────────────┐
│                                     │
│           CodeMirror                │
│           (Full Width)              │
│                                     │
└─────────────────────────────────────┘
```

- Maximum space for source editing
- Syntax highlighting
- Used automatically for large files (>500KB)

### Preview Only Mode (⌘3)

```
┌─────────────────────────────────────┐
│                                     │
│           Preview                   │
│           (Full Width)              │
│                                     │
└─────────────────────────────────────┘
```

- Read-only rendered view
- Default mode when opening files via Finder/drag-drop
- Ideal for reading documentation

### WYSIWYG Mode (⌘4)

```
┌─────────────────────────────────────┐
│                                     │
│           Milkdown                  │
│     (Rich Text Editing)             │
│                                     │
└─────────────────────────────────────┘
```

- Edit rendered markdown directly
- Typora-like experience
- Keyboard shortcuts for formatting (⌘B, ⌘I, etc.)

## Implementation

### View Mode State (editorStore.ts)

```typescript
export const useEditorStore = create<EditorStore>((set) => ({
  viewMode: "split",
  setViewMode: (mode) => set({ viewMode: mode }),
  cycleViewMode: () =>
    set((state) => {
      const order: ViewMode[] = ["split", "editor-only", "preview-only", "wysiwyg"];
      const currentIndex = order.indexOf(state.viewMode);
      const nextIndex = (currentIndex + 1) % order.length;
      return { viewMode: order[nextIndex] };
    }),
}));
```

### View Mode Routing (App.tsx)

```tsx
{viewMode === "preview-only" ? (
  <Preview markdown={activeDocument?.content ?? ""} />
) : viewMode === "wysiwyg" ? (
  <MilkdownEditor />
) : (
  <SplitView
    markdown={activeDocument?.content ?? ""}
    onChange={updateActiveDocumentContent}
    viewMode={viewMode}
  />
)}
```

### useEditor Hook

```typescript
export function useEditor() {
  const { viewMode, setViewMode, cycleViewMode, ... } = useEditorStore();
  return { viewMode, setViewMode, cycleViewMode, ... };
}
```

## View Mode Switching

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| ⌘1 | Switch to Split mode |
| ⌘2 | Switch to Editor Only mode |
| ⌘3 | Switch to Preview Only mode |
| ⌘4 | Switch to WYSIWYG mode |
| ⌘/ | Cycle through modes |

### Menu Integration

The View menu in the native macOS menu bar provides:
- Split View
- Editor Only
- Preview Only
- WYSIWYG
- Toggle Sidebar (⌘⇧B)

### Programmatic Switching

```typescript
// Direct mode set
setViewMode("wysiwyg");

// Cycle to next mode
cycleViewMode();
```

## Persistence

View mode preference is persisted via Tauri preferences:

```typescript
// Save on change
useEffect(() => {
  if (!preferencesLoaded) return;
  void preferencesService.setPreferences({ lastViewMode: viewMode });
}, [preferencesLoaded, viewMode]);

// Restore on load
const prefs = await preferencesService.getPreferences();
setViewMode(prefs.lastViewMode ?? prefs.defaultViewMode);
```

## Automatic Mode Switching

### Large File Protection

Files >500KB automatically switch to editor mode:

```typescript
useEffect(() => {
  if (viewMode !== "wysiwyg") return;
  if (!activeDocument) return;
  const bytes = activeDocument.fileSize ??
    new TextEncoder().encode(activeDocument.content).length;
  if (bytes <= 500 * 1024) return;
  showToast("Document exceeds 500KB. Switched to Editor mode for performance.");
  setViewMode("editor-only");
}, [activeDocument, viewMode]);
```

### Finder/Drag-Drop Opens

Files opened via Finder or drag-drop default to preview-only mode:

```typescript
// When opening from Finder
setViewMode("preview-only");
void openPaths(paths);
```

## Content Synchronization

All modes share the same content source (`documentStore`):

```
┌─────────────┐
│ CodeMirror  │◄──┐
└─────────────┘   │
                  │  documentStore.documents[].content
┌─────────────┐   │
│  Milkdown   │◄──┤
└─────────────┘   │
                  │
┌─────────────┐   │
│   Preview   │◄──┘
└─────────────┘
```

When switching modes:
1. Current editor saves content to store
2. New editor reads content from store
3. No data loss during transitions

## Related Documentation

- [Architecture Overview](./architecture.md)
- [Milkdown Integration](./milkdown-integration.md)
- [Keyboard Shortcuts](./keyboard-shortcuts.md)
