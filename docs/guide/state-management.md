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

## Known Defects

### `setActiveDocumentId` — last-writer-wins on overlapping opens (open)

`activeDocumentId` is stored **twice** — in `documentStore`
(`src/stores/documentStore.ts:29`) and in `editorStore`
(`src/stores/editorStore.ts:125`) — and every caller is expected to set both, as
two separate unsynchronized statements:

```typescript
// src/hooks/useDocument.ts:63-65; the same pair repeats at :86, :98-100,
// :123-125, :142-144 and :150-152
useDocumentStore.getState().upsertDocument(result.document);
useDocumentStore.getState().setActiveDocumentId(result.document.id);
setEditorActiveDocumentId(result.document.id);
```

Neither setter consults a generation or sequence number; both assign
unconditionally. That produces one live defect and one latent trap.

**1. The slowest open wins, not the latest (live).** `openDocumentFromPath`,
`openDocumentFromDialog` and `openDocumentWithEncoding` each `await` an IPC
round-trip through `fileService.openFile` *before* assigning. When two open
flows overlap, their awaits settle in completion order rather than invocation
order, and the document that finishes reading last becomes active — even if the
user asked for it first. Opening a large file and then a small one reliably
lands on the small one.

Note the multi-file path is **not** the trigger: `openPaths`
(`src/App.tsx:553-567`) awaits inside a `for` loop, so a Finder multi-select is
sequential. The race needs two *independent* flows in flight at once — a
`file:open` event (`src/App.tsx:1091`) arriving while a dialog open
(`src/App.tsx:541`) is still pending, or an MCP document event
(`src/hooks/useMcpEvents.ts:296`) landing mid-open.

**2. The two copies can diverge (latent).** Because the pair of assignments is
not atomic, an interleaving can leave `documentStore.activeDocumentId` and
`editorStore.activeDocumentId` pointing at different documents.
`useMcpEvents.ts:296` makes this reachable directly: it sets only the
`documentStore` copy. Today this is latent rather than user-visible — no reader
of `editorStore.activeDocumentId` exists in `src/`; every consumer
(`MilkdownEditor.tsx:107`, `useAutoSave.ts:12`, `useMcpSync.ts:42`,
`Editor.tsx:185`) reads `documentStore`, and `editorStore` itself reaches across
to `useDocumentStore.getState().activeDocumentId` at `editorStore.ts:72`. The
`editorStore` copy is therefore written by every open flow and read by none —
which is precisely the trap for the next person who subscribes to it, since it
is silently wrong exactly when the two flows overlap.

**Why it is not fixed here.** The fix is a source change across `src/stores/`
and `src/hooks/useDocument.ts`: either collapse the duplicated field onto one
store, or carry a monotonic request token that a settling open must re-check
before it assigns. Both are behavior-affecting changes that need their own tests
— `.claude/rules/10-tdd.md` marks stores and hooks as mandatory-test categories
— and this defect was recorded during a docs/config-only hygiene pass barred
from touching `src/`. Collapsing the duplicate is the preferred direction, since
consequence 2 shows the second copy currently serves no reader.

## Related Documentation

- [Architecture Overview](./architecture.md)
- [Milkdown Integration](./milkdown-integration.md)
- [View Modes](./view-modes.md)
