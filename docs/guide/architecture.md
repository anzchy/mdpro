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

## Events

<!-- moved-from: CLAUDE.md § IPC & Event System (ADR-0147) -->
Rust emits events that frontend listens to via `listen()`:

| Event           | Payload                | Source                                        |
| --------------- | ---------------------- | --------------------------------------------- |
| `menu:action`   | `{ action, value, target }` | Native menu clicks (menu.rs); `target` names the window the click was for (D261) |
| `file:open`     | `string[]`             | External open routed to a window (services/open\_route/tauri\_glue.rs) and `create_window(Some(path))` (commands/window.rs) |
| `file:changed`  | `{ path, changeType, newPath?, origin? }` | External file modification (file\_watcher.rs), sent once to every spelling the file is open under (services/file\_watcher\_fanout.rs, D185), and a save in another window: the save notice carries `origin: { windowLabel, documentId }` (services/file\_watcher\_save\_notice.rs, ADR-0086) |
| `file:open-in-window` | `{ windowLabel, documentId, path }` | External open of an already-open file, `emit_to` the one window that has it (services/open\_route/tauri\_glue.rs) → `useOpenInWindow.ts` |
| `theme:changed` | `"light" \| "dark"`    | System theme change                           |
| `mcp:write_document` | `{ document_id, content, window_label, action_id }` | MCP `write_document` tool (http\_server.rs) → `useMcpEvents.ts` |
| `mcp:insert_content` | `{ document_id, text, position, window_label, action_id }` | MCP `insert_content` tool (http\_server.rs) → `useMcpEvents.ts` |
| `mcp:create_document` | `{ document_id, content, window_label, action_id }` | MCP `create_document` tool (http\_server.rs) → `useMcpEvents.ts` |
| `mcp:table_action` | `{ document_id, action, payload, window_label, action_id }` | MCP table tools (http\_server.rs) → `useMcpEvents.ts` |
| `mcp:confirm_request` | `{ requestId, documentId, documentTitle, operation, action?, expiresInMs }` | MCP write awaiting approval (ADR-0042), `emit_to` the window that owns the document (mcp\_confirm/outbox.rs) → `useMcpConfirm.ts` |
| `mcp:confirm_resolved` | `{ requestId, outcome }` (`approved` \| `rejected` \| `timedOut` \| `cancelled` \| `withdrawn`) | Closes that prompt, `emit_to` the owning window (mcp\_confirm/outbox.rs) → `useMcpConfirm.ts` |
| `app:quit-requested` | `{ requestId, round }` | Quit phase 1 — asks every window if it is dirty (quit\_guard/events.rs) → `useQuitGuard.ts` |
| `app:quit-prompt` | `{ requestId, round }` | Quit phase 2 — prompts one dirty window at a time (quit\_guard/events.rs) → `useQuitGuard.ts` |
| `app:quit-cancelled` | `{ requestId, round }` | Quit aborted; windows dismiss their prompt (quit\_guard/events.rs) → `useQuitGuard.ts` |
| `app:quit-backstop` | `{ requestId, round }` | Quit commit — every window drafts every unsaved document, then replies `drafted` with counts (ADR-0035; quit\_guard/events.rs) → `useQuitGuard.ts` |
