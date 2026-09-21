# WYSIWYG Architecture Overview

This document describes the technical architecture behind mdpro's WYSIWYG editing system.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           App.tsx                                    │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    View Mode Router                            │  │
│  │  viewMode === "wysiwyg" ? <MilkdownEditor />                  │  │
│  │  otherwise ? <SplitView /> (CodeMirror 6, full pane)          │  │
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
│  │  - source mode      │     │                                 │   │
│  │  - full-pane layout │     │  - wysiwyg mode                 │   │
│  │  - syntax highlight │     │  - rich text editing            │   │
│  └─────────────────────┘     └─────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Plugin System                                │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ pluginRegistry manages plugin lifecycle and exposes editor     │  │
│  │ events (doc/selection/focus) to plugins.                        │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Dual-Engine Design

mdpro uses a **dual-engine architecture** to provide the best editing experience for different use cases:

| Engine | View Modes | Use Case |
|--------|------------|----------|
| **CodeMirror 6** | source | Source editing with syntax highlighting |
| **Milkdown** | wysiwyg | True WYSIWYG editing like Typora |
| **marked + DOMPurify** | none | Export fallback only — renders Markdown → HTML when the Rust IPC throws |

### Why Two Engines?

1. **CodeMirror excels at source editing**: Fast, syntax highlighting, familiar to developers
2. **Milkdown excels at WYSIWYG**: ProseMirror-based, renders markdown as rich text in-place
3. **Content is shared**: Both engines read/write to the same Zustand store

## Plugin System

Editor features (keymaps, commands, decorations) are implemented as plugins
registered via `src/plugins/index.ts`. The plugin registry:

- Loads mode-specific extensions for CodeMirror and Milkdown
- Manages plugin lifecycle, priority ordering, and errors
- Exposes editor events (doc/selection/focus) through `EditorContext`

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
│  (Sidebar, TabBar)  │
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

### 4. Large Document Protection

Documents automatically switch to Source mode, to prevent Milkdown performance
issues, when **either** their source structure score —
`newlines + (pipes - table-row-starts)`, roughly lines plus table cells —
exceeds 25,000, **or** their longest single line exceeds 1,000,000 UTF-16 code
units (`App.tsx`, predicate in `src/utils/largeDocumentGuard.ts`). Both counts
come from one forward pass. File size stopped being the judgement variable on
2026-09-21; see
[ADR-0016](../adr/0016-large-document-guard-predicate-is-a-source-structure-score.md)
and
[ADR-0019](../adr/0019-large-document-guard-adds-a-longest-line-trigger.md).

## File Structure

```
src/
├── components/
│   └── Editor/
│       ├── Editor.tsx           # CodeMirror wrapper
│       ├── SplitView.tsx        # Source-mode layout (full-pane CodeMirror)
│       └── MilkdownEditor.tsx   # Milkdown WYSIWYG component
├── plugins/
│   ├── core/                    # Plugin registry, types, config
│   ├── codemirror/              # Source mode plugins
│   └── milkdown/                # WYSIWYG plugins
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
