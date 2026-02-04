# mdpro - AI Context

## Project Overview

**mdpro** is a high-performance, local Markdown editor optimized for macOS (Apple Silicon). It combines the precision of source editing with the elegance of a WYSIWYG interface.

*   **Type:** Desktop Application (Tauri 2.0)
*   **Stack:** Rust (Backend) + React 19 / TypeScript / Vite (Frontend)
*   **Core Architecture:** Dual-engine editing system using **CodeMirror 6** for source mode and **Milkdown** (ProseMirror-based) for WYSIWYG mode.

## Key Features

*   **View Modes:** Split, Editor-only, Preview-only, WYSIWYG (Typora-style).
*   **Plugin System:** Unified architecture for CodeMirror and Milkdown extensions.
*   **Native Integration:** macOS menu bar, file associations, drag-and-drop.
*   **Safety:** Auto-save drafts, external file watching with conflict detection.
*   **Debugging:** Comprehensive JSONL structured logging (`~/.mdpro/mdpro.log`).

## Architecture Highlights

*   **Frontend (`src/`):**
    *   **State:** `Zustand` stores (`documentStore`, `editorStore`) serve as the single source of truth.
    *   **Components:** `Editor` (CodeMirror), `MilkdownEditor` (WYSIWYG), `Preview` (marked + DOMPurify).
    *   **IPC:** `services/` folder contains typed wrappers for Tauri `invoke` calls.
*   **Backend (`src-tauri/`):**
    *   **Commands:** IPC handlers in `src-tauri/src/commands/` (file ops, export, logging).
    *   **Services:** Core logic in `src-tauri/src/services/` (file watcher, markdown rendering).
    *   **Menu:** Native macOS menu definitions in `src-tauri/src/menu.rs`.

## Development Workflow

### Prerequisites
*   Node.js + pnpm
*   Rust stable toolchain

### Common Commands

| Command | Description | Use Case |
| :--- | :--- | :--- |
| `pnpm dev` | Start Vite dev server (UI only) | **Preferred for UI/Component work.** Fast HMR, browser DevTools. |
| `pnpm tauri dev` | Start Desktop App | **Preferred for Integration/IPC work.** Tests file ops, menus, backend logic. |
| `pnpm build` | Build Frontend | Runs `tsc` and `vite build`. |
| `pnpm tauri build` | Build App Bundle | Creates `.app` and `.dmg` (release mode). |
| `cargo test` | Run Backend Tests | Run inside `src-tauri/`. |

### Debugging

*   **Frontend:** Use Browser DevTools in `pnpm dev`.
*   **Backend/Integration:** Use `pnpm tauri dev` and monitor logs.
    *   **Log File:** `~/.mdpro/mdpro.log` (JSONL format).
    *   **Monitor:** `tail -f ~/.mdpro/mdpro.log | jq .`
    *   **Tauri DevTools:** Right-click inside the app window -> "Inspect Element".

## Coding Conventions

*   **Style:** Functional React components, Hooks, `PascalCase` for components, `camelCase` for functions/vars. Rust uses standard `snake_case`.
*   **State Management:** Use Zustand stores. Avoid local state for data that needs to persist across view modes.
*   **Logging:** **Mandatory** for new features. Use the structured logging pattern defined in `CLAUDE.md`.
    *   Rust: `logger::log_event(LogEntryPayload { ... })`
    *   TS: `loggingService.logEventSync({ ... })`
*   **Tests:** Manual verification is currently primary. Backend unit tests via `cargo test`.

## Directory Map

*   `src/components/`: React UI components.
*   `src/plugins/`: Editor plugins (CodeMirror & Milkdown adapters).
*   `src/services/`: Frontend IPC wrappers.
*   `src/stores/`: Global state (Zustand).
*   `src-tauri/src/commands/`: Rust IPC command handlers.
*   `specs/`: Detailed feature specifications (check `specs/001-mdpro-mvp/` and others).
*   `doc/`: Technical documentation (Architecture, State Management, etc.).

## Important Notes for AI Agents

1.  **Read Specs:** Before starting a major task, check `specs/` for relevant design documents.
2.  **Check Logs:** When debugging backend issues, always ask the user to check or `tail` the `mdpro.log`.
3.  **Preserve Architecture:** Respect the dual-engine design. Changes to editing logic often need to be applied to **both** CodeMirror and Milkdown paths.
4.  **Security:** Be mindful of `tauri.conf.json` capabilities and permissions.
