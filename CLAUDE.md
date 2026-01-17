# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

mdpro is a local Markdown editor for macOS, combining Typora's WYSIWYG experience with modern design. Built with Tauri 2.0 (Rust backend + React frontend).

**Target**: macOS 13+, Apple Silicon (ARM64)

## Development Commands

```bash
# Start development (frontend + Tauri)
pnpm tauri dev

# Frontend only (no Tauri window)
pnpm dev

# Build production app
pnpm tauri build

# Type checking
pnpm type-check

# Frontend tests
pnpm test

# E2E tests
pnpm test:e2e
```

### Rust Backend Commands

```bash
cd src-tauri

cargo check        # Check compilation
cargo test         # Run unit tests
cargo fmt          # Format code
cargo clippy       # Lint
```

## Architecture

```
src-tauri/          # Rust backend (Tauri 2.0)
├── src/
│   ├── main.rs     # Entry point, window setup
│   ├── lib.rs      # Tauri command exports
│   ├── commands/   # IPC command handlers (file.rs, export.rs, preferences.rs)
│   ├── services/   # Business logic (markdown.rs, file_watcher.rs, draft.rs)
│   └── models/     # Data structures (document.rs, preferences.rs)

src/                # React frontend
├── components/     # UI components (Editor/, Preview/, Sidebar/, Toolbar/)
├── hooks/          # Custom hooks (useDocument, useEditor, useTheme, useAutoSave)
├── services/       # Tauri IPC wrappers (fileService, exportService)
├── stores/         # Zustand state (documentStore, editorStore, themeStore)
├── types/          # TypeScript types
└── styles/         # CSS & themes

specs/              # Feature specifications
└── 001-mdpro-mvp/  # Current MVP spec, plan, tasks, contracts
```

## Key Technologies

| Layer | Technology |
|-------|------------|
| Framework | Tauri 2.0 |
| Frontend | React 18 + TypeScript + Vite |
| Editor | CodeMirror 6 |
| Markdown (Rust) | pulldown-cmark |
| Markdown (JS) | marked + DOMPurify |
| State | Zustand |
| Styling | TailwindCSS |
| Testing | Vitest (unit), Playwright (E2E), cargo test (Rust) |

## IPC Pattern

Frontend calls Rust via Tauri commands defined in `src-tauri/src/commands/`. Wrappers in `src/services/` provide typed interfaces.

```typescript
// Frontend: src/services/fileService.ts
import { invoke } from '@tauri-apps/api/core';
const doc = await invoke<Document>('open_file', { path: '/path/to/file.md' });
```

```rust
// Backend: src-tauri/src/commands/file.rs
#[tauri::command]
pub fn open_file(path: String) -> Result<Document, String> { ... }
```

## Spec-Driven Development

This project uses speckit workflow. Key documents in `specs/001-mdpro-mvp/`:

- `spec.md` - Feature requirements and user stories
- `plan.md` - Technical architecture and decisions
- `tasks.md` - Implementation tasks (136 total)
- `data-model.md` - Data structures (Rust + TypeScript)
- `contracts/` - IPC command definitions

Use `/speckit.implement` to execute tasks from tasks.md.

## Performance Targets

- App startup: < 2 seconds
- Preview latency: < 100ms
- Editing: 60fps smooth
- Memory: < 500MB

## MVP Constraints

- Local files only (no cloud sync)
- No plugin system
- HTML export only (no PDF/Word)
