# WYSIWYG Architecture Overview

This document describes the technical architecture behind mdpro's WYSIWYG editing system.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           App.tsx                                    │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    View Mode Router                            │  │
│  │  viewMode === "wysiwyg" ? <MilkdownEditor />                  │  │
│  │  viewMode === "preview-only" ? <Preview />                    │  │
│  │  otherwise ? <SplitView /> (CodeMirror + Preview)             │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      State Management Layer                          │
│  ┌─────────────────────┐     ┌─────────────────────────────────┐   │
│  │   documentStore     │     │       editorStore               │   │
│  │   (Zustand)         │     │       (Zustand)                 │   │
│  │                     │     │                                 │   │
│  │  - documents[]      │     │  - viewMode                     │   │
│  │  - activeDocumentId │     │  - showSidebar                  │   │
│  │  - content sync     │     │  - cursor/selection             │   │
│  └─────────────────────┘     └─────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Editor Engines                               │
│  ┌─────────────────────┐     ┌─────────────────────────────────┐   │
│  │   CodeMirror 6      │     │       Milkdown                  │   │
│  │                     │     │       (ProseMirror-based)       │   │
│  │  - split view       │     │                                 │   │
│  │  - editor-only      │     │  - wysiwyg mode                 │   │
│  │  - syntax highlight │     │  - rich text editing            │   │
│  └─────────────────────┘     └─────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## Dual-Engine Design

mdpro uses a **dual-engine architecture** to provide the best editing experience for different use cases:

| Engine | View Modes | Use Case |
|--------|------------|----------|
| **CodeMirror 6** | split, editor-only | Source editing with syntax highlighting |
| **Milkdown** | wysiwyg | True WYSIWYG editing like Typora |
| **marked + DOMPurify** | preview-only, split (preview pane) | Markdown rendering |

### Why Two Engines?

1. **CodeMirror excels at source editing**: Fast, syntax highlighting, familiar to developers
2. **Milkdown excels at WYSIWYG**: ProseMirror-based, renders markdown as rich text in-place
3. **Content is shared**: Both engines read/write to the same Zustand store

## Data Flow

```
User types in Editor
        │
        ▼
┌─────────────────────┐
│  Editor Component   │
│  (CodeMirror or     │
│   Milkdown)         │
└─────────────────────┘
        │
        │ onChange / onMarkdownChange
        ▼
┌─────────────────────┐
│  documentStore      │
│  updateDocumentContent()
└─────────────────────┘
        │
        │ Zustand subscription
        ▼
┌─────────────────────┐
│  Other components   │
│  (Preview, Sidebar) │
│  re-render          │
└─────────────────────┘
```

## Key Design Decisions

### 1. Content as Single Source of Truth

The markdown content is stored in `documentStore.documents[].content`. Both editors read from and write to this same source, ensuring consistency when switching view modes.

### 2. Editor Instance Lifecycle

- **CodeMirror**: Persistent instance, content updated via `EditorView.dispatch()`
- **Milkdown**: New instance created when `documentId` changes (via `useMemo` dependency)

### 3. View Mode Persistence

View mode preference is persisted via Tauri preferences API and restored on app launch.

### 4. Large File Protection

Files >500KB automatically switch to editor-only mode to prevent Milkdown performance issues.

## File Structure

```
src/
├── components/
│   ├── Editor/
│   │   ├── Editor.tsx           # CodeMirror wrapper
│   │   ├── SplitView.tsx        # Split/editor-only/preview-only layout
│   │   └── MilkdownEditor.tsx   # Milkdown WYSIWYG component
│   └── Preview/
│       └── Preview.tsx          # Markdown preview (marked + DOMPurify)
├── hooks/
│   ├── useEditor.ts             # View mode management
│   └── useMilkdown.ts           # Milkdown integration hook
├── stores/
│   ├── documentStore.ts         # Document content state
│   └── editorStore.ts           # Editor UI state
└── types/
    └── editor.ts                # ViewMode type definition
```

## Related Documentation

- [Milkdown Integration](./milkdown-integration.md)
- [View Modes](./view-modes.md)
- [State Management](./state-management.md)
- [Keyboard Shortcuts](./keyboard-shortcuts.md)
