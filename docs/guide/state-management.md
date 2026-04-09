# State Management

mdpro uses [Zustand](https://github.com/pmndrs/zustand) for state management with two primary stores.

## Store Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     React Components                         │
└─────────────────────────────────────────────────────────────┘
            │                              │
            ▼                              ▼
┌─────────────────────────┐    ┌─────────────────────────────┐
│     documentStore       │    │       editorStore           │
│                         │    │                             │
│  - Document content     │    │  - View mode                │
│  - Active document      │    │  - Sidebar visibility       │
│  - Modified state       │    │  - Cursor/selection         │
│  - File paths           │    │  - Scroll positions         │
└─────────────────────────┘    └─────────────────────────────┘
            │                              │
            │       Shared by both engines │
            ▼                              ▼
┌─────────────────────────┐    ┌─────────────────────────────┐
│      CodeMirror         │    │        Milkdown             │
└─────────────────────────┘    └─────────────────────────────┘
```

> Note: Editor feature plugins are managed by `pluginRegistry` and are not part
> of Zustand state. The registry holds editor view references and emits
> doc/selection/focus events to plugins via `EditorContext`.

## documentStore

Manages document content and metadata.

### Interface

```typescript
interface DocumentStore {
  // State
  documents: Document[];
  activeDocumentId: string | null;

  // Actions
  setDocuments: (documents: Document[]) => void;
  setActiveDocumentId: (id: string | null) => void;
  upsertDocument: (document: Document) => void;
  updateDocumentContent: (id: string, content: string) => void;
  markDocumentModified: (id: string, isModified: boolean) => void;
  updateDocumentPath: (id: string, path: string) => void;
  closeDocument: (id: string) => void;
}
```

### Document Type

```typescript
interface Document {
  id: string;
  path: string | null;      // File path (null for untitled)
  content: string;          // Markdown content
  encoding: string;         // e.g., "UTF-8"
  isModified: boolean;      // Unsaved changes flag
  lastSaved: string | null; // ISO timestamp
  fileSize: number | null;  // Bytes
}
```

### Key Actions

#### updateDocumentContent

Updates content and marks document as modified:

```typescript
updateDocumentContent: (id, content) =>
  set((state) => ({
    documents: state.documents.map((doc) =>
      doc.id === id ? { ...doc, content, isModified: true } : doc,
    ),
  })),
```

#### upsertDocument

Insert or update a document:

```typescript
upsertDocument: (document) =>
  set((state) => {
    const index = state.documents.findIndex((item) => item.id === document.id);
    if (index === -1) {
      return { documents: [...state.documents, document] };
    }
    const next = [...state.documents];
    next[index] = document;
    return { documents: next };
  }),
```

### Usage in Components

```typescript
// Reading state
const { documents, activeDocumentId } = useDocumentStore((state) => ({
  documents: state.documents,
  activeDocumentId: state.activeDocumentId,
}));

// Updating content
const updateDocumentContent = useDocumentStore((state) => state.updateDocumentContent);
updateDocumentContent(docId, newContent);
```

## editorStore

Manages editor UI state.

### Interface

```typescript
interface EditorStore extends EditorState {
  showSidebar: boolean;
  editorView: EditorView | null;

  // View mode
  setViewMode: (mode: ViewMode) => void;
  cycleViewMode: () => void;

  // Sidebar
  setShowSidebar: (show: boolean) => void;
  toggleSidebar: () => void;

  // Cursor/Selection
  setCursor: (cursor: CursorPosition) => void;
  setSelection: (selection: SelectionRange | null) => void;

  // Scroll
  setEditorScroll: (scroll: ScrollPosition) => void;
  setPreviewScroll: (scroll: ScrollPosition) => void;

  // Focus
  setFocus: (isFocused: boolean) => void;

  // Undo/Redo depth
  setUndoDepth: (depth: number) => void;
  setRedoDepth: (depth: number) => void;
}
```

### EditorState Type

```typescript
interface EditorState {
  activeDocumentId: string | null;
  viewMode: ViewMode;
  cursor: CursorPosition;
  selection: SelectionRange | null;
  editorScroll: ScrollPosition;
  previewScroll: ScrollPosition;
  isFocused: boolean;
  undoDepth: number;
  redoDepth: number;
}
```

### View Mode Cycling

```typescript
cycleViewMode: () =>
  set((state) => {
    const order: ViewMode[] = ["split", "editor-only", "preview-only", "wysiwyg"];
    const currentIndex = order.indexOf(state.viewMode);
    const nextIndex = (currentIndex + 1) % order.length;
    return { viewMode: order[nextIndex] };
  }),
```

## Data Flow Examples

### User Types in Editor

```
User keystroke
      │
      ▼
┌─────────────────┐
│ CodeMirror      │
│ onChange()      │
└─────────────────┘
      │
      ▼
┌─────────────────┐
│ documentStore   │
│ updateDocument- │
│ Content()       │
└─────────────────┘
      │
      │ Zustand notifies
      │ subscribers
      ▼
┌─────────────────┐
│ Preview         │
│ re-renders      │
└─────────────────┘
```

### Switch View Mode

```
User presses ⌃4
      │
      ▼
┌─────────────────┐
│ useKeyboard-    │
│ Shortcuts       │
└─────────────────┘
      │
      ▼
┌─────────────────┐
│ editorStore     │
│ setViewMode()   │
└─────────────────┘
      │
      │ Zustand notifies
      ▼
┌─────────────────┐
│ App.tsx         │
│ re-renders with │
│ new viewMode    │
└─────────────────┘
      │
      ▼
┌─────────────────┐
│ MilkdownEditor  │
│ reads content   │
│ from docStore   │
└─────────────────┘
```

## Selector Optimization

Use selectors to prevent unnecessary re-renders:

```typescript
// Bad: subscribes to entire store
const store = useDocumentStore();

// Good: subscribes only to needed values
const content = useDocumentStore((state) =>
  state.documents.find((d) => d.id === state.activeDocumentId)?.content
);
```

## Persistence

State persistence is handled separately via Tauri preferences API, not in the stores themselves:

```typescript
// Save to preferences
await preferencesService.setPreferences({ lastViewMode: viewMode });

// Load from preferences
const prefs = await preferencesService.getPreferences();
setViewMode(prefs.lastViewMode);
```

## Why Zustand?

| Feature | Benefit |
|---------|---------|
| **Minimal boilerplate** | No reducers, action types, or providers |
| **TypeScript-friendly** | Full type inference |
| **Selector-based subscriptions** | Fine-grained reactivity |
| **No Context Provider needed** | Direct hook usage anywhere |
| **Devtools support** | Redux DevTools compatible |

## Related Documentation

- [Architecture Overview](./architecture.md)
- [Milkdown Integration](./milkdown-integration.md)
- [View Modes](./view-modes.md)
