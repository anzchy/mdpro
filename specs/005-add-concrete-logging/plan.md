# Implementation Plan: Concrete Logging (JSONL)

**Branch**: `005-add-concrete-logging` | **Date**: 2026-01-28 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/005-add-concrete-logging/spec.md`

## Summary

Upgrade the existing plaintext logger to a structured JSONL logging system that captures all UI actions, file operations, and app/window lifecycle events. The system provides correlation IDs for tracking operation flows, configurable log levels, and user-controllable enable/disable via Settings > General.

## Technical Context

**Language/Version**: TypeScript 5.8 (frontend), Rust 2021 Edition (backend)
**Primary Dependencies**:
- Frontend: React 19, @tauri-apps/api 2.x, Zustand 4
- Backend: Tauri 2.0, serde/serde_json, chrono, uuid
**Storage**: JSONL file at `~/.mdpro/mdpro.log`, preferences in existing `preferences.json`
**Testing**: Manual verification via jq/grep on log file
**Target Platform**: macOS 13+ (Apple Silicon)
**Project Type**: Desktop app (Tauri = Rust backend + React frontend)
**Performance Goals**: <50ms logging overhead per operation
**Constraints**: Async writes, non-blocking UI, silent failure on write errors
**Scale/Scope**: Local debugging only, no rotation

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| Library-First | N/A | Constitution is template, not customized |
| Test-First | ADVISORY | Manual testing via log file inspection |
| Simplicity | PASS | Minimal changes to existing architecture |

**Note**: The constitution.md is still in template form. No blocking gates identified.

## Project Structure

### Documentation (this feature)

```text
specs/005-add-concrete-logging/
├── spec.md              # Feature specification (complete)
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (IPC contracts)
├── diagrams/
│   └── site-diagram.html
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
src-tauri/
├── src/
│   ├── main.rs                    # MODIFY: Add app + window lifecycle logging
│   ├── services/
│   │   ├── logger.rs              # MODIFY: Upgrade to JSONL + structured events
│   │   └── mod.rs
│   ├── commands/
│   │   ├── mod.rs                 # MODIFY: Register new logging command
│   │   ├── file.rs                # MODIFY: Add file operation logging
│   │   ├── window.rs              # (Existing window commands; no lifecycle logging)
│   │   └── logging.rs             # NEW: Logging IPC command handler
│   └── models/
│       ├── preferences.rs         # MODIFY: Add LogSettings
│       └── log_entry.rs           # NEW: LogEntry struct definition

src/
├── services/
│   ├── loggingService.ts          # NEW: Frontend logging service
│   └── preferencesService.ts      # MODIFY: Add logging settings methods
├── hooks/
│   ├── useMenuEvents.ts           # MODIFY: Add menu event logging
│   └── useKeyboardShortcuts.ts    # MODIFY: Add shortcut logging
├── stores/
│   ├── loggingStore.ts            # NEW: Logging state (enabled, level)
│   └── documentStore.ts           # MODIFY: Add tab event logging
├── components/
│   ├── Settings/
│   │   └── GeneralSettings.tsx    # MODIFY: Add logging toggle + level dropdown
│   └── Sidebar/
│       └── Sidebar.tsx            # MODIFY: Add tab switch logging
├── App.tsx                        # MODIFY: Add drag-drop and file:open event logging
└── types/
    └── logging.ts                 # NEW: TypeScript types for log events
```

**Structure Decision**: Existing Tauri architecture (Rust backend + React frontend). New files are minimal; most changes modify existing modules to add logging hooks.

## Complexity Tracking

No violations identified. Implementation follows existing patterns:
- IPC commands follow existing `commands/` module pattern
- Frontend services follow existing `services/` module pattern
- Settings UI extends existing Settings component

---

## Phase 0: Research

### Research Tasks

1. **Tauri Window Events API** - How to hook into window lifecycle (open/close/focus/blur)
2. **Async File Writing in Rust** - Best practices for non-blocking log writes
3. **Action ID Generation** - UUID v4 vs custom correlation ID strategy
4. **Existing Logger Integration** - How to upgrade `logger.rs` without breaking existing calls

### Findings

See [research.md](./research.md) for detailed findings.

---

## Phase 1: Design & Contracts

### Data Model

See [data-model.md](./data-model.md) for entity definitions.

### API Contracts

See [contracts/](./contracts/) for IPC command specifications.

### Quickstart

See [quickstart.md](./quickstart.md) for implementation guide.

---

## Implementation Sequence

### Phase 1: Backend Foundation (Rust)

1. Create `log_entry.rs` model with LogEntry struct
2. Upgrade `logger.rs` to support JSONL format
3. Add LogSettings to preferences model
4. Create `logging.rs` command handler

### Phase 2: Backend Integration

5. Add app lifecycle logging to `main.rs`
6. Add file operation logging to `file.rs`
7. Add window lifecycle logging to `window.rs`

### Phase 3: Frontend Foundation (TypeScript)

8. Create logging types (`types/logging.ts`)
9. Create logging service (`services/loggingService.ts`)
10. Create logging store (`stores/loggingStore.ts`)

### Phase 4: Frontend Integration

11. Add logging to menu events hook
12. Add logging to keyboard shortcuts hook
13. Add Settings UI for logging toggle + level

### Phase 5: Verification

14. Manual testing with jq
15. Verify all event types are captured
