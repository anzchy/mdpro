# Implementation Plan: Window Dragging, Multi-Window Docs, WYSIWYG Tables

**Branch**: `003-redesign-plugin-system` | **Date**: 2026-01-23 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-redesign-plugin-system/spec.md`

## Summary

Deliver three user-facing improvements:

1. Make the custom topbar draggable to move the window.
2. Allow multiple independent app windows, each with its own document session.
3. Enable Markdown table rendering in WYSIWYG mode.

## Technical Context

**Language/Version**: TypeScript 5.8 (frontend), Rust 2021 Edition (backend)
**Primary Dependencies**: React 19, Tauri 2.0, CodeMirror 6, Milkdown 7.18, Zustand 4
**Target Platform**: macOS 13+ (Apple Silicon), Tauri desktop app
**Testing**: Manual testing (no automated test framework configured)
**Constraints**:
- Preserve existing document open/save and file watcher reload behavior
- Maintain current visual layout of the topbar
- Keep WYSIWYG editor stable while adding table support

## Constitution Check

No custom constitution detected. Proceeding with standard practices:

- [x] **Simplicity**: Minimal changes to topbar and window lifecycle
- [x] **Backward Compatibility**: Existing file open/save flows remain intact
- [x] **Testable**: Each capability has a clear manual test

**Gate Status**: PASS

## Project Structure

### Documentation (this feature)

```text
specs/003-redesign-plugin-system/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── tasks.md
└── checklists/requirements.md
```

### Source Code (expected touch points)

```text
src/
├── components/
│   └── TitleBar/TitleBar.tsx        # Drag region behavior
├── hooks/
│   ├── useMenuEvents.ts             # New window event handling
│   └── useDocument.ts               # Window-scoped document session
├── services/
│   ├── windowService.ts             # Create/track windows (new)
│   └── fileService.ts               # Open file in new window
├── stores/
│   └── documentStore.ts             # Per-window store instance
└── styles/globals.css               # Topbar drag region tweaks

src-tauri/
├── src/
│   ├── main.rs                      # New window command/event
│   └── menu.rs                      # Menu item: New Window
└── tauri.conf.json                  # Window options (if needed)
```

**Structure Decision**: Keep a single React app bundle; window-specific state is isolated per window instance.

## Rollout Plan

1. **Topbar drag region**: Ensure drag region applied to non-interactive topbar elements.
2. **Multi-window**: Add menu entry + window creation flow + per-window state isolation.
3. **WYSIWYG tables**: Enable GFM table support in Milkdown configuration.
4. **Manual verification**: Confirm all acceptance scenarios.

## Risks & Mitigations

- **Risk**: Drag region interferes with clickable elements.
  - **Mitigation**: Mark interactive elements as non-draggable and test clicks.
- **Risk**: Multi-window creates shared state collisions.
  - **Mitigation**: Scope Zustand stores per window; avoid singletons for document state.
- **Risk**: Table plugin conflicts with existing Milkdown configuration.
  - **Mitigation**: Add table support via official preset and test WYSIWYG mode switching.
