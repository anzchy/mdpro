# Implementation Plan: Multi-Window Support & UI Improvements

**Branch**: `004-minor-fix` | **Date**: 2026-01-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/004-minor-fix/spec.md`

## Summary

Add multi-window support to mdpro allowing users to work on multiple documents simultaneously in independent Tauri windows. Each window manages its own document state, supports ⌘N for new window creation, ⌘S for saving, and native macOS window dragging. External file associations open in new windows. Settings page receives theme fixes and a new "Default View Mode" setting.

## Technical Context

**Language/Version**: TypeScript 5.8 (frontend), Rust 2021 Edition (backend)
**Primary Dependencies**: Tauri 2.0, React 19, Zustand 4, CodeMirror 6, Milkdown 7
**Storage**: Local filesystem (via Tauri), JSON preferences file
**Testing**: Vitest (frontend), cargo test (backend)
**Target Platform**: macOS 13+ (Apple Silicon ARM64)
**Project Type**: Desktop application (Tauri - Rust backend + React frontend)
**Performance Goals**: 10+ simultaneous windows, <500ms window creation, <1s save for 1MB files
**Constraints**: Local files only, no cloud sync, max 10MB file size
**Scale/Scope**: Single-user desktop app, ~15 source files modified

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The constitution template is not yet configured for this project. Proceeding with standard development practices:

- [x] No new external dependencies required
- [x] Changes follow existing architecture patterns
- [x] No breaking changes to existing IPC contracts
- [x] Testing requirements will be met (unit + integration)

## Project Structure

### Documentation (this feature)

```text
specs/004-minor-fix/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (via /speckit.tasks)
```

### Source Code (repository root)

```text
src-tauri/                    # Rust backend
├── src/
│   ├── main.rs              # [MODIFY] Window creation, multi-window lifecycle
│   ├── launch.rs            # [MODIFY] External file → new window routing
│   ├── menu.rs              # [EXISTING] Menu events already support ⌘N, ⌘S
│   ├── commands/
│   │   ├── mod.rs           # [MODIFY] Register new command
│   │   ├── preferences.rs   # [MODIFY] Add per-file window state persistence
│   │   └── window.rs        # [NEW] Window management commands
│   ├── models/
│   │   └── preferences.rs   # [MODIFY] Add defaultViewMode, per-file window states
│   └── services/
│       └── preferences.rs   # [MODIFY] Handle per-file window state storage

src/                          # React frontend
├── App.tsx                  # [MODIFY] Apply default view mode on startup
├── components/
│   └── common/
│       └── SettingsDialog.tsx  # [MODIFY] Theme sync, add Default View Mode setting
├── hooks/
│   └── useMenuEvents.ts     # [MODIFY] Handle file.new_window action → create window
├── stores/
│   └── preferencesStore.ts  # [MODIFY] Add defaultViewMode state
├── services/
│   └── windowService.ts     # [NEW] Window IPC wrapper (create_window)
├── styles/
│   └── settings.css         # [MODIFY] Fix theme contrast for settings dialog
└── types/
    └── preferences.ts       # [MODIFY] Add defaultViewMode type
```

**Structure Decision**: Tauri 2.0 desktop app with existing separation of Rust backend and React frontend. Multi-window support uses Tauri's native `WebviewWindow` API. Each window gets its own React app instance with isolated Zustand stores.

## Complexity Tracking

No constitution violations. Implementation uses existing patterns:
- Tauri's built-in multi-window support (WebviewWindow)
- Existing preferences persistence mechanism
- Existing menu event system
