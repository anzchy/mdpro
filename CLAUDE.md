# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

mdpro is a local Markdown editor for macOS, combining Typora's WYSIWYG experience with modern design. Built with Tauri 2.0 (Rust backend + React frontend).

**Target**: macOS 13+, Apple Silicon (ARM64)

## Development Commands

```bash
pnpm install              # Install dependencies
pnpm tauri dev            # Start development (frontend + Tauri window)
pnpm dev                  # Frontend only (Vite dev server, no Tauri)
pnpm build                # Build frontend (runs tsc + vite build)
pnpm tauri build          # Build production app (.dmg)
```

### Rust Backend Commands

```bash
cd src-tauri
cargo check               # Check compilation
cargo test                # Run unit tests
cargo fmt                 # Format code
cargo clippy              # Lint
```

## Architecture

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
│   ├── Editor/         # CodeMirror editor (SplitView, WysiwygView)
│   ├── Preview/        # Markdown preview pane
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

## Key Technologies

| Layer | Technology |
|-------|------------|
| Framework | Tauri 2.0 |
| Frontend | React 19 + TypeScript + Vite 7 |
| Editor | CodeMirror 6 (@uiw/react-codemirror) |
| Markdown | pulldown-cmark (Rust), marked + DOMPurify (JS preview) |
| State | Zustand |
| File dialogs | rfd (Rust) |
| File watching | notify (Rust) |

## IPC & Event System

### Commands (Frontend → Rust)

Frontend calls Rust via `invoke()`. Commands are registered in `src-tauri/src/commands/mod.rs`:

```typescript
// src/services/fileService.ts
import { invoke } from '@tauri-apps/api/core';
const result = await invoke<OpenFileResult>('open_file', { path, encoding });
```

Key commands: `open_file`, `save_file`, `create_document`, `export_html`, `save_draft`, `get_preferences`

### Events (Rust → Frontend)

Rust emits events that frontend listens to via `listen()`:

| Event | Payload | Source |
|-------|---------|--------|
| `menu:action` | `{ action, value }` | Native menu clicks (menu.rs) |
| `file:open` | `string[]` | Single-instance file open (launch.rs) |
| `file:changed` | `{ path, changeType }` | External file modification (file_watcher.rs) |
| `theme:changed` | `"light" \| "dark"` | System theme change |

### Adding a New IPC Command

1. Define the command in `src-tauri/src/commands/<module>.rs`
2. Register it in `src-tauri/src/commands/mod.rs` → `handlers()`
3. Create typed wrapper in `src/services/<service>.ts`

## Menu System

Native macOS menu defined in `src-tauri/src/menu.rs`. Menu events are handled via `menu:action` event:

- File: New (⌘N), Open (⌘O), Save (⌘S), Export HTML (⌘⇧E), Close (⌘W)
- View: Split (⌘1), Editor (⌘2), Preview (⌘3), WYSIWYG (⌘4), Toggle Sidebar (⌘⇧B)
- Format: Highlight Selection (⌘⇧H)
- Theme: Light, Dark, System

## Release Workflow

```bash
# 1. Update versions in src-tauri/Cargo.toml and src-tauri/tauri.conf.json
# 2. Test locally
pnpm tauri build

# 3. Tag and push (triggers GitHub Actions → builds DMG)
git tag v0.1.2
git push origin v0.1.2
```

## Spec-Driven Development

Feature specifications live in `specs/001-mdpro-mvp/`:
- `spec.md` - Requirements and user stories
- `plan.md` - Technical architecture
- `tasks.md` - Implementation tasks
- `contracts/` - IPC command definitions

## Constraints

- Local files only (no cloud sync)
- No plugin system
- HTML export only (no PDF/Word)
- Max file size: 10MB

## Active Technologies
- TypeScript 5.8 (frontend), Rust 2021 Edition (backend) + React 19, Tauri 2.0, CodeMirror 6, Milkdown (NEW), Zustand 4 (002-polish-wysiwyg)
- N/A (local file system via Tauri) (002-polish-wysiwyg)
- TypeScript 5.8 (frontend), Rust 2021 Edition (backend - unchanged) + React 19, Tauri 2.0, CodeMirror 6 (@codemirror/*), Milkdown 7.18 (@milkdown/kit, @milkdown/react), Zustand 4 (003-redesign-plugin-system)
- N/A (no new storage requirements) (003-redesign-plugin-system)
- TypeScript 5.8 (frontend), Rust 2021 Edition (backend) + Tauri 2.0, React 19, Zustand 4, CodeMirror 6, Milkdown 7 (004-minor-fix)
- Local filesystem (via Tauri), JSON preferences file (004-minor-fix)

## Recent Changes
- 002-polish-wysiwyg: Added TypeScript 5.8 (frontend), Rust 2021 Edition (backend) + React 19, Tauri 2.0, CodeMirror 6, Milkdown (NEW), Zustand 4

## Plugin System (003-redesign-plugin-system)

- Plugin definitions live in `src/plugins/` with `core/`, `codemirror/`, and `milkdown/` subfolders.
- Register plugins in `src/plugins/index.ts` and configure defaults in `src/plugins/core/pluginConfig.ts`.
- Use `codemirrorExtension` for source mode and `milkdownPlugin` for WYSIWYG mode; plugins may support both.
- Plugin lifecycle is managed by `pluginRegistry` (initialized in `src/components/Editor/Editor.tsx` and `src/hooks/useMilkdown.ts`).
- Editor events (doc/selection/focus) are emitted via `pluginRegistry.emitEvent` and consumed through `EditorContext.events`.
