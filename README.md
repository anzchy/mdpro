# mdpro

A local Markdown editor built with Tauri 2 + React + TypeScript.

## File Structure

```
.
|-- src/                 # React UI
|   |-- components/      # UI components (Editor, Toolbar, etc.)
|   |-- hooks/           # Custom hooks (useDocument, shortcuts, etc.)
|   |-- services/        # Tauri IPC wrappers
|   |-- stores/          # Zustand state stores
|   |-- styles/          # Global + theme styles
|   `-- types/           # Shared TypeScript types
|-- src-tauri/           # Rust backend (Tauri)
|   `-- src/
|       |-- commands/    # IPC commands (file, export, etc.)
|       |-- models/      # Data models
|       `-- services/    # Backend services
|-- specs/001-mdpro-mvp/ # Product spec, plan, and tasks
|-- public/              # Static assets
`-- package.json
```

## How to Use

Prerequisites:
- Node.js + pnpm
- Rust toolchain (stable)
- Tauri CLI (installed via devDependencies)

Common commands:
- `pnpm install`: install JS dependencies
- `pnpm dev`: run the Vite web dev server
- `pnpm build`: build the web bundle (type-check + Vite build)
- `pnpm tauri dev`: run the desktop app (uses Vite in the background)
- `pnpm tauri build`: build a desktop app bundle

## How to Test

Tests are not wired yet. When added:
- Frontend: `pnpm test` (Vitest)
- Backend: `cargo test` in `src-tauri/`
- E2E: `pnpm playwright test`

## Troubleshooting

- **Tauri build fails**: ensure Rust toolchain is installed (`rustup show`) and `pnpm install` has run.
- **Window doesn't open**: make sure `pnpm tauri dev` is used (not just `pnpm dev`).
- **File dialogs not working**: confirm native dialog permissions (macOS Security & Privacy).
- **IPC errors**: verify commands are registered in `src-tauri/src/commands/mod.rs` and `src-tauri/src/main.rs`.
- **Type errors after dependency changes**: delete `node_modules`, re-run `pnpm install`.

## Recommended IDE Setup

- VS Code + Tauri + rust-analyzer
