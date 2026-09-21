# View Modes

mdpro supports 2 view modes. Mode switching should be the exception, not the flow —
inline source reveal handles most element-specific editing without leaving WYSIWYG.

## Overview

| Mode | Shortcut | Description | Engine |
|------|----------|-------------|--------|
| **WYSIWYG** | ⌃4 | Rich text editing with inline source reveal | Milkdown |
| **Source** | ⌃2 | Full-width source editing | CodeMirror |

> **Note**: View mode shortcuts use **Control** (⌃) key to avoid conflicts with Typora-style heading shortcuts (⌘1-6).

## Type Definition

```typescript
// src/types/editor.ts
export type ViewMode = "wysiwyg" | "source";
```

## Mode Details

### WYSIWYG Mode (⌃4)

```
┌─────────────────────────────────────┐
│                                     │
│           Milkdown                  │
│     (Rich Text Editing)             │
│                                     │
└─────────────────────────────────────┘
```

- Edit rendered markdown directly (Typora-like experience)
- Inline source reveal: cursor inside a link or inline code shows the raw syntax
- Keyboard shortcuts for formatting (⌘B, ⌘I, ⌘K, etc.)
- Default mode for new documents and file opens

### Source Mode (⌃2)

```
┌─────────────────────────────────────┐
│                                     │
│           CodeMirror                │
│           (Full Width)              │
│                                     │
└─────────────────────────────────────┘
```

- Full-width source editing with syntax highlighting
- Used automatically for structurally large documents (score >25,000 — see
  [Large Document Protection](#large-document-protection))
- Escape hatch for structural edits that benefit from seeing raw Markdown

## Implementation

### View Mode State (editorStore.ts)

```typescript
export const useEditorStore = create<EditorStore>((set) => ({
  viewMode: "wysiwyg",
  setViewMode: (mode) => set({ viewMode: mode }),
  cycleViewMode: () =>
    set((state) => {
      const order: ViewMode[] = ["wysiwyg", "source"];
      const currentIndex = order.indexOf(state.viewMode);
      const nextIndex = (currentIndex + 1) % order.length;
      return { viewMode: order[nextIndex] };
    }),
}));
```

### View Mode Routing (App.tsx)

```tsx
{viewMode === "wysiwyg" ? (
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
| ⌃2 | Switch to Source mode |
| ⌃4 | Switch to WYSIWYG mode |
| ⌘/ | Cycle between modes |

### Menu Integration

The View menu in the native macOS menu bar provides:
- Source (⌃2)
- WYSIWYG (⌃4)
- Toggle Sidebar (⌘⇧L)

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

// Restore on load (with migration from old 4-mode values)
const prefs = await preferencesService.getPreferences();
setViewMode(migrateViewMode(prefs.lastViewMode ?? prefs.defaultViewMode));
```

### Migration from Old Values

Stored preferences from the old 4-mode model are migrated on load:

| Old value | New value |
|-----------|-----------|
| `"split"` | `"wysiwyg"` |
| `"preview-only"` | `"wysiwyg"` |
| `"editor-only"` | `"source"` |

## Automatic Mode Switching

### Large Document Protection

A document whose **source structure score** exceeds 25,000 automatically
switches to source mode. The score is `newlines + (pipes - table-row-starts)`
— roughly "lines plus table cells" — computed in one forward pass over the
content with no Markdown parsing. File size is **not** part of the judgement;
it was, until 2026-09-21, and it let a 471,880 B table document that blocks
the main thread for 12 seconds through. See
[ADR-0016](../adr/0016-large-document-guard-predicate-is-a-source-structure-score.md).

```typescript
useEffect(() => {
  if (!activeDocument) return;
  const decision = decideLargeDocumentGuard({
    viewMode,
    content: activeDocument.content,
  });
  switch (decision.action) {
    case "allow":
      return;
    case "degrade-to-source":
      showToast(decision.message);
      setViewMode("source");
      return;
  }
  decision satisfies never;
}, [activeDocument, setViewMode, showToast, viewMode]);
```

The predicate itself lives in `src/utils/largeDocumentGuard.ts` — a pure
function with no React and no store access, so it can be unit-tested. The effect
above owns only the two side effects. The threshold constant and the toast text
are both exported from `largeDocumentGuard.ts`; neither literal appears in
`App.tsx`. There is no `fileSize` fallback any more — the field was removed
from the predicate's input type outright, so there is no second source of
truth for it to disagree with, and the stale-size question the old `??`
existed to answer cannot arise.

### Finder/Drag-Drop Opens

Files opened via Finder or drag-drop use the user's preferred default view mode
(defaults to `"wysiwyg"`):

```typescript
// When opening from Finder — uses defaultViewMode from preferences
setViewMode(defaultViewMode);
void openPaths(paths);
```

## Content Synchronization

Both modes share the same content source (`documentStore`):

```
┌─────────────┐
│ CodeMirror  │◄──┐
└─────────────┘   │
                  │  documentStore.documents[].content
┌─────────────┐   │
│  Milkdown   │◄──┘
└─────────────┘
```

When switching modes:
1. Current editor saves content to store
2. New editor reads content from store
3. No data loss during transitions

## Inline Source Reveal (WYSIWYG)

In WYSIWYG mode, moving the cursor inside certain inline elements reveals their
raw Markdown syntax without leaving WYSIWYG mode:

| Element | Collapsed | Expanded |
|---------|-----------|----------|
| Link | rendered link | `[text](url)` |
| Inline Code | styled `code` | `` `code` `` with backticks |

Trigger: cursor movement into the element (automatic) or ⌃\` (force-reveal).

## Related Documentation

- [Architecture Overview](./architecture.md)
- [Milkdown Integration](./milkdown-integration.md)
- [Keyboard Shortcuts](./keyboard-shortcuts.md)
