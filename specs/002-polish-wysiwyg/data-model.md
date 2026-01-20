# Data Model: Polish WYSIWYG Editor

**Feature**: 002-polish-wysiwyg | **Date**: 2026-01-19

## Entities

### ViewMode (Enum)

Represents the four view modes available in the editor.

| Value | Description | Engine |
|-------|-------------|--------|
| `split` | Side-by-side source + preview | CodeMirror (left) + HTML (right) |
| `editor-only` | Full-width source editor | CodeMirror |
| `preview-only` | Full-width rendered preview | HTML (read-only) |
| `wysiwyg` | Full-width WYSIWYG editor | Milkdown |

**TypeScript Definition** (existing in `src/types/editor.ts`):
```typescript
export type ViewMode = "split" | "editor-only" | "preview-only" | "wysiwyg"
```

**State Transitions**:
```
        ⌘/ (cycle)
    ┌─────────────────────────────────────┐
    │                                     │
    ▼                                     │
┌───────┐    ⌘/    ┌─────────────┐   ⌘/  │
│ split │ ───────▶ │ editor-only │ ──────┤
└───────┘          └─────────────┘       │
    ▲                                    │
    │                                    │
    │   ⌘/    ┌──────────────┐   ⌘/     ▼
    └──────── │   wysiwyg    │ ◀──── ┌───────────────┐
              └──────────────┘       │ preview-only  │
                                     └───────────────┘

Direct Access: ⌃1 (split), ⌃2 (editor-only), ⌃3 (preview-only), ⌃4 (wysiwyg)
```

---

### EditorContent (Shared State)

The Markdown content being edited, stored in Zustand as single source of truth.

| Field | Type | Description |
|-------|------|-------------|
| `content` | `string` | Raw Markdown text |
| `filePath` | `string \| null` | Associated file path (if saved) |
| `isDirty` | `boolean` | Has unsaved changes |

**Location**: `src/stores/documentStore.ts`

---

### EditorState (Extended)

Extended editor state to support view mode cycling and preferences.

| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `viewMode` | `ViewMode` | Current view mode | `split` |
| `lastUsedViewMode` | `ViewMode` | Persisted preference | `split` |

**Location**: `src/stores/editorStore.ts`

**New Methods**:
```typescript
interface EditorStore {
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
  cycleViewMode: () => void  // NEW: Split → Editor → Preview → WYSIWYG → Split
}
```

---

### MilkdownEditorInstance

Runtime reference to Milkdown editor (not persisted).

| Field | Type | Description |
|-------|------|-------------|
| `editor` | `Editor` | Milkdown editor instance from `useEditor` hook |
| `loading` | `boolean` | Editor initialization state |
| `getInstance` | `() => Editor` | Access method from `useInstance` hook |

**Location**: `src/hooks/useMilkdown.ts` (NEW)

---

### UserPreferences (Extended)

Persisted user preferences stored via Tauri backend.

| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `lastViewMode` | `ViewMode` | Last used view mode | `split` |

**Location**: `src-tauri/src/models/preferences.rs`

**IPC Command**: `get_preferences`, `save_preferences`

---

## Relationships

```
┌─────────────────────────────────────────────────────────────┐
│                     Zustand Stores                           │
│  ┌─────────────────────┐    ┌──────────────────────────┐   │
│  │   documentStore     │    │      editorStore         │   │
│  │  ┌───────────────┐  │    │  ┌────────────────────┐  │   │
│  │  │ content: str  │◀─┼────┼──│ viewMode: ViewMode │  │   │
│  │  │ filePath      │  │    │  │ setViewMode()      │  │   │
│  │  │ isDirty       │  │    │  │ cycleViewMode()    │  │   │
│  │  └───────────────┘  │    │  └────────────────────┘  │   │
│  └─────────────────────┘    └──────────────────────────┘   │
└────────────────────────────────┬────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
                    ▼                         ▼
┌───────────────────────────┐   ┌───────────────────────────┐
│      CodeMirror           │   │       Milkdown            │
│  (split, editor-only)     │   │       (wysiwyg)           │
│                           │   │                           │
│  - Reads content          │   │  - Parses content on load │
│  - Writes content onChange│   │  - Serializes on exit     │
└───────────────────────────┘   └───────────────────────────┘
                    │                         │
                    └────────────┬────────────┘
                                 │
                                 ▼
                    ┌───────────────────────────┐
                    │         Preview           │
                    │     (preview-only)        │
                    │                           │
                    │  - Reads content (r/o)    │
                    │  - Renders HTML           │
                    └───────────────────────────┘
```

---

## Validation Rules

1. **ViewMode**: Must be one of four valid enum values
2. **Content Sync**: Markdown content must be synced to Zustand store before view mode changes
3. **Large Document**: Documents >500KB must not enter WYSIWYG mode; auto-fallback to Editor mode
4. **Preference Persistence**: lastViewMode saved to disk on app close; restored on launch

---

## No Database Schema

This feature does not introduce database tables. All state is:
- In-memory (Zustand stores)
- File-based (Markdown documents)
- Preferences file (Tauri app data directory)
