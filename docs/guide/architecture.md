# Architecture Overview

Directory map and technology stack for mdpro, moved out of `CLAUDE.md` to keep
that file within its context budget. This is a **snapshot of the main modules,
not an exhaustive listing** — newer modules (e.g. `services/shadow_store.rs`,
`services/quit_guard/`, `services/open_route/`) are not all shown. Run
`ls src-tauri/src/services src/hooks src/stores` for the current tree.

## Directory map

```
src-tauri/              # Rust backend (Tauri 2.0)
├── src/
│   ├── main.rs         # Entry point, app setup, event handlers
│   ├── lib.rs          # Module exports
│   ├── menu.rs         # Native macOS menu bar (File, Edit, View, Theme menus)
│   ├── launch.rs       # File association & single-instance handling
│   ├── commands/       # IPC command handlers
│   │   ├── file.rs     # File operations (open, save, close, reload)
│   │   ├── export.rs   # HTML export & markdown rendering
│   │   ├── draft.rs    # Auto-save draft recovery
│   │   └── preferences.rs
│   ├── services/       # Business logic
│   │   ├── file_watcher.rs  # External file change detection (notify crate)
│   │   ├── encoding.rs      # Character encoding detection
│   │   └── markdown.rs      # pulldown-cmark rendering
│   └── models/         # Data structures (Document, Draft, Preferences)

src/                    # React frontend
├── App.tsx             # Main app shell, orchestrates all features
├── components/
│   ├── Editor/         # CodeMirror source + Milkdown WYSIWYG (SplitView, MilkdownEditor)
│   ├── Sidebar/        # Document tabs
│   └── Toolbar/        # Title bar
├── hooks/
│   ├── useDocument.ts  # Document CRUD operations
│   ├── useMenuEvents.ts # Listens to menu:action events from Rust
│   ├── useFileWatcher.ts # Handles external file changes
│   └── useAutoSave.ts  # Draft auto-save timer
├── services/           # Tauri IPC wrappers (typed invoke calls)
└── stores/             # Zustand state (documentStore, editorStore, themeStore)
```

## Key technologies

| Layer         | Technology                                             |
| ------------- | ------------------------------------------------------ |
| Framework     | Tauri 2.0                                              |
| Frontend      | React 19 + TypeScript + Vite 7                         |
| Editor        | CodeMirror 6 (@uiw/react-codemirror)                   |
| Markdown      | pulldown-cmark (Rust), marked + DOMPurify (JS fallback) |
| State         | Zustand                                                |
| File dialogs  | rfd (Rust)                                             |
| File watching | notify (Rust)                                          |
