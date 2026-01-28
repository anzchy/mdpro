# Tasks: Concrete Logging (JSONL)

**Input**: Design documents from `/specs/005-add-concrete-logging/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Manual verification via jq/grep on `~/.mdpro/mdpro.log` (no automated tests)

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

**Total Tasks**: 81 | **User Stories**: 11 | **Phases**: 14

**Critical for Debugging Known Issues** 🎯:
- **US8**: Finder "Open With" failures (Phase 10)
- **US9**: Drag & drop failures (Phase 11)
- **US10**: Multi-tab/document issues (Phase 12)

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1-US7)
- Include exact file paths in descriptions

## Path Conventions

- **Backend (Rust)**: `src-tauri/src/`
- **Frontend (TypeScript)**: `src/`

---

## Phase 1: Setup (Backend Foundation)

**Purpose**: Create core logging infrastructure in Rust backend

- [ ] T001 [P] Create LogEntry, LogLevel, LogStatus, LogContext structs in `src-tauri/src/models/log_entry.rs` per data-model.md
- [ ] T002 [P] Create LogEntryPayload struct (for IPC) in `src-tauri/src/models/log_entry.rs`
- [ ] T003 Add LogSettings struct and `logging` field to UserPreferences in `src-tauri/src/models/preferences.rs`
- [ ] T076 [P] Add default LogSettings values (enabled=true, level=info) in `src-tauri/src/models/preferences.rs`
- [ ] T004 Export log_entry module from `src-tauri/src/models/mod.rs`
- [ ] T005 Add `log_structured_event()` function to `src-tauri/src/services/logger.rs` with JSONL output
- [ ] T006 Add `should_log()` level threshold function to `src-tauri/src/services/logger.rs`
- [ ] T077 [P] Add payload sanitization to strip any content fields (e.g., `context.content`, `details.content`) before write in `src-tauri/src/commands/logging.rs` or `src-tauri/src/services/logger.rs`

---

## Phase 2: Foundational (IPC Commands)

**Purpose**: Establish IPC layer for frontend-backend communication

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T007 Create `log_event` command in `src-tauri/src/commands/logging.rs` per contracts/logging-commands.md
- [ ] T008 Create `get_logging_settings` command in `src-tauri/src/commands/logging.rs`
- [ ] T009 Create `set_logging_settings` command in `src-tauri/src/commands/logging.rs`
- [ ] T010 Export logging module and register commands in `src-tauri/src/commands/mod.rs`
- [ ] T011 [P] Create TypeScript types (LogLevel, LogStatus, LogContext, LogEntryPayload, LogSettings) in `src/types/logging.ts`
- [ ] T012 [P] Create loggingService with logEvent, logEventSync, generateActionId in `src/services/loggingService.ts`
- [ ] T013 [P] Add getLoggingSettings, setLoggingSettings functions to `src/services/loggingService.ts`
- [ ] T014 Verify backend compiles with `cargo check` in src-tauri/
- [ ] T015 Verify frontend compiles with `pnpm build`

**Checkpoint**: Foundation ready - logging infrastructure operational, user story implementation can begin

---

## Phase 3: User Story 6 - App Startup Logging (Priority: P1) 🎯 MVP

**Goal**: Log app.launch and app.ready events with startup timing

**Independent Test**: Launch app, run `tail -5 ~/.mdpro/mdpro.log | jq .` and verify app.launch + app.ready entries

### Implementation for User Story 6

- [ ] T016 [US6] Add app.launch logging at start of main() in `src-tauri/src/main.rs` with appVersion and platform context
- [ ] T017 [US6] Add Instant::now() timing capture before tauri::Builder in `src-tauri/src/main.rs`
- [ ] T018 [US6] Add app.ready logging in setup() closure in `src-tauri/src/main.rs` with startupTimeMs and durationMs
- [ ] T019 [US6] Add app.quit logging before app shutdown (if possible via Tauri hooks) in `src-tauri/src/main.rs`
- [ ] T072 [US6] Add app.error logging when setup/run fails (capture error string + status=fail) in `src-tauri/src/main.rs`

**Checkpoint**: App startup/ready logging works - verify with `pnpm tauri dev` and check log file

---

## Phase 4: User Story 1 - Save Document Logging (Priority: P1)

**Goal**: Log file.save operations with start/success/fail status and correlation IDs

**Independent Test**: Click Save button, run `cat ~/.mdpro/mdpro.log | jq 'select(.event == "file.save")'` and verify start+success pair

### Implementation for User Story 1

- [ ] T020 [US1] Add file.save start logging at beginning of save_file command in `src-tauri/src/commands/file.rs`
- [ ] T021 [US1] Add file.save success logging after successful write in `src-tauri/src/commands/file.rs` with fileSizeBytes
- [ ] T022 [US1] Add file.save fail logging on error in `src-tauri/src/commands/file.rs` with error message
- [ ] T023 [US1] Add logUIEvent helper call for save action in `src/App.tsx` (handleSave) to link UI actionId to file.save
- [ ] T073 [US1] Add actionId parameter to file command invocations in `src/services/fileService.ts` (thread from UI event)
- [ ] T074 [US1] Accept optional actionId in `open_file`, `open_file_dialog`, `save_file_dialog` payloads in `src-tauri/src/commands/file.rs`
- [ ] T075 [US1] Use provided actionId for file.open/file.save start/success/fail log entries in `src-tauri/src/commands/file.rs`

**Checkpoint**: Save logging works - verify by saving a document and checking log entries

---

## Phase 5: User Story 2 - Open File Logging (Priority: P1)

**Goal**: Log file.open operations including dialog cancel

**Independent Test**: Open a file via menu, verify `cat ~/.mdpro/mdpro.log | jq 'select(.event == "file.open")'` shows start+success

### Implementation for User Story 2

- [ ] T024 [US2] Add file.open start logging at beginning of open_file command in `src-tauri/src/commands/file.rs`
- [ ] T025 [US2] Add file.open success logging after successful read in `src-tauri/src/commands/file.rs` with filePath, fileSizeBytes, encoding
- [ ] T026 [US2] Add file.open fail logging on error in `src-tauri/src/commands/file.rs`
- [ ] T027 [US2] Add file.open cancel logging when dialog is cancelled in `src-tauri/src/commands/file.rs`
- [ ] T028 [US2] Add logMenuSelect helper for menu.file.open in `src/hooks/useMenuEvents.ts`

**Checkpoint**: Open logging works - verify by opening files and checking log entries

---

## Phase 6: User Story 3 - Keyboard Shortcut Logging (Priority: P1)

**Goal**: Log all keyboard shortcuts with the key combination

**Independent Test**: Press Cmd+S, verify `cat ~/.mdpro/mdpro.log | jq 'select(.event == "ui.shortcut.trigger")'` shows entry

### Implementation for User Story 3

- [ ] T029 [US3] Add logShortcut helper function to `src/services/loggingService.ts` (already in quickstart.md)
- [ ] T030 [US3] Import loggingService in `src/hooks/useKeyboardShortcuts.ts`
- [ ] T031 [US3] Add logShortcut() calls at start of each shortcut handler in `src/hooks/useKeyboardShortcuts.ts`
- [ ] T032 [US3] Ensure actionId is generated and passed through to related file operations

**Checkpoint**: Shortcut logging works - verify by pressing Cmd+S, Cmd+O, Cmd+N and checking logs

---

## Phase 7: User Story 4 - Toggle Logging (Priority: P2)

**Goal**: Allow users to enable/disable logging from Settings > General

**Independent Test**: Toggle off, perform actions, verify no new entries; toggle on, verify entries appear

### Implementation for User Story 4

- [ ] T033 [P] [US4] Create loggingStore with enabled/level state in `src/stores/loggingStore.ts`
- [ ] T034 [US4] Add useEffect to load logging settings on Settings mount in `src/components/Settings/GeneralSettings.tsx`
- [ ] T035 [US4] Add Toggle component for "Enable Logging" in `src/components/Settings/GeneralSettings.tsx`
- [ ] T036 [US4] Implement handleLoggingToggle that calls setLoggingSettings in `src/components/Settings/GeneralSettings.tsx`
- [ ] T037 [US4] Log ui.toggle.change when logging is toggled (before disabling) in `src/components/Settings/GeneralSettings.tsx`

**Checkpoint**: Logging toggle works - verify by toggling and checking log behavior

---

## Phase 8: User Story 5 - Change Log Level (Priority: P2)

**Goal**: Allow users to change minimum log level from Settings > General

**Independent Test**: Set level to error, perform save, verify no info entries; set to debug, verify debug entries

### Implementation for User Story 5

- [ ] T038 [US5] Add Select/dropdown component for "Log Level" in `src/components/Settings/GeneralSettings.tsx`
- [ ] T039 [US5] Implement handleLevelChange that calls setLoggingSettings in `src/components/Settings/GeneralSettings.tsx`
- [ ] T040 [US5] Log ui.select.change when level is changed in `src/components/Settings/GeneralSettings.tsx`

**Checkpoint**: Log level filtering works - verify by changing levels and checking filtered output

---

## Phase 9: User Story 7 - Window Lifecycle Logging (Priority: P2)

**Goal**: Log window open/close/focus/blur events

**Independent Test**: Open new window, close it, verify `cat ~/.mdpro/mdpro.log | jq 'select(.event | startswith("window."))'`

### Implementation for User Story 7

- [ ] T041 [US7] Add window.open logging when WebviewWindowBuilder succeeds in `src-tauri/src/main.rs` (open_file_in_new_window function)
- [ ] T042 [US7] Add window.close logging in on_window_event for CloseRequested in `src-tauri/src/main.rs`
- [ ] T043 [US7] Add window.focus logging in on_window_event for Focused(true) in `src-tauri/src/main.rs`
- [ ] T044 [US7] Add window.blur logging in on_window_event for Focused(false) in `src-tauri/src/main.rs`

**Checkpoint**: Window lifecycle logging works - verify by opening/closing windows

---

## Phase 10: User Story 8 - Finder/External File Open (Priority: P1) 🎯 CRITICAL

**Goal**: Log file opens from Finder "Open With", double-click, and single-instance scenarios

**Independent Test**: Right-click .md in Finder → Open With → mdpro, verify `jq 'select(.event == "file.open.external")'`

### Implementation for User Story 8

- [ ] T045 [US8] Add file.open.external logging in RunEvent::Opened handler in `src-tauri/src/main.rs`
- [ ] T046 [US8] Add app.single_instance logging in tauri_plugin_single_instance callback in `src-tauri/src/main.rs`
- [ ] T047 [US8] Add file.open.cli logging for command line args in `src-tauri/src/main.rs` setup
- [ ] T048 [US8] Include source field in context (finder/cli/single_instance) for all external opens
- [ ] T049 [US8] Add logging for launch_state.set_paths and take_paths in `src-tauri/src/launch.rs`

**Checkpoint**: Finder opens are logged - verify by opening from Finder while app is running

---

## Phase 11: User Story 9 - Drag & Drop File Open (Priority: P1) 🎯 CRITICAL

**Goal**: Log file drops onto the app window

**Independent Test**: Drop .md file on window, verify `jq 'select(.event == "file.open.drop")'`

### Implementation for User Story 9

- [ ] T050 [US9] Add file.open.drop start logging in handleFileDrop in `src/App.tsx`
- [ ] T051 [US9] Add file.open.drop success/fail logging after openDocumentFromPath in `src/App.tsx`
- [ ] T052 [US9] Add file.open.drop cancel logging for non-.md files in `src/App.tsx`
- [ ] T053 [US9] Include dropTarget and fileCount in context for drop events

**Checkpoint**: Drag-drop is logged - verify by dropping files on window

---

## Phase 12: User Story 10 - Multi-Tab Document Logging (Priority: P1)

**Goal**: Log tab open/close/switch operations for multi-document tracking

**Independent Test**: Open 3 files, switch tabs, close one, verify `jq 'select(.event | startswith("tab."))'`

### Implementation for User Story 10

- [ ] T054 [US10] Add tab.open logging in upsertDocument in `src/stores/documentStore.ts` or `src/hooks/useDocument.ts`
- [ ] T055 [US10] Add tab.close logging in closeDocument in `src/stores/documentStore.ts` or `src/hooks/useDocument.ts`
- [ ] T056 [US10] Add tab.switch logging in setActiveDocumentById in `src/stores/documentStore.ts`
- [ ] T057 [US10] Add tab switch logging when clicking sidebar tab in `src/components/Sidebar/Sidebar.tsx`
- [ ] T058 [US10] Include documentId, filePath, tabIndex in tab event context

**Checkpoint**: Tab operations are logged - verify by opening multiple docs and switching

---

## Phase 13: User Story 11 - Window Move Logging (Priority: P2)

**Goal**: Log window move/drag operations for titlebar issue debugging

**Independent Test**: Drag window by titlebar, verify `jq 'select(.event == "window.move")'`

### Implementation for User Story 11

- [ ] T059 [US11] Add window.move logging in on_window_event for Moved event in `src-tauri/src/main.rs`
- [ ] T060 [US11] Debounce window.move events to log only final position (avoid spam during drag)

**Checkpoint**: Window moves are logged - verify by dragging window

---

## Phase 14: Polish & Cross-Cutting Concerns

**Purpose**: Additional logging points and verification

- [ ] T061 [P] Add logging to menu event handler in `src/hooks/useMenuEvents.ts` for all menu actions
- [ ] T062 [P] Add file.write logging for autosave in `src-tauri/src/commands/draft.rs`
- [ ] T063 [P] Add file.export logging in `src-tauri/src/commands/export.rs`
- [ ] T064 [P] Add file.close logging when document is closed in `src/stores/documentStore.ts`
- [ ] T078 [P] Add UI button logging in dialogs: `src/components/common/ConfirmDialog.tsx`, `src/components/common/ReloadDialog.tsx`, `src/components/common/RecoveryDialog.tsx`, `src/components/common/EncodingDialog.tsx`
- [ ] T079 [P] Add UI button logging in settings + sidebar: `src/components/common/SettingsDialog.tsx`, `src/components/Sidebar/FileItem.tsx`, `src/components/Sidebar/Sidebar.tsx`
- [ ] T080 [P] Add UI button logging in misc controls: `src/components/common/Toast.tsx`, `src/components/DevToolbar.tsx`
- [ ] T065 Run quickstart.md verification steps (jq validation, event filtering)
- [ ] T066 Manual test: click 10 buttons, verify 10 log entries
- [ ] T067 Manual test: open/save/write file cycle, verify 6+ entries
- [ ] T068 Manual test: Finder "Open With" mdpro, verify file.open.external
- [ ] T069 Manual test: Drag .md file to window, verify file.open.drop
- [ ] T070 Manual test: Open 3 files, switch tabs, close one, verify tab events
- [ ] T071 Verify log entries parse with `cat ~/.mdpro/mdpro.log | jq -c . > /dev/null`
- [ ] T081 Manual test: perform 100 rapid UI actions and confirm no perceptible UI lag (<50ms overhead)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies - can start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 - BLOCKS all user stories
- **Phase 3-9 (User Stories)**: All depend on Phase 2 completion
  - P1 stories (US1, US2, US3, US6) can proceed in parallel
  - P2 stories (US4, US5, US7) can proceed in parallel after P1
- **Phase 10 (Polish)**: Depends on all user stories being complete

### User Story Dependencies

| Story | Priority | Depends On | Can Parallel With |
|-------|----------|------------|-------------------|
| US6 (App Startup) | P1 | Phase 2 | US1, US2, US3, US8, US9, US10 |
| US1 (Save Logging) | P1 | Phase 2 | US2, US3, US6, US8, US9, US10 |
| US2 (Open Logging) | P1 | Phase 2 | US1, US3, US6, US8, US9, US10 |
| US3 (Shortcut Logging) | P1 | Phase 2 | US1, US2, US6, US8, US9, US10 |
| **US8 (Finder/External)** | **P1** | Phase 2 | US1, US2, US3, US6, US9, US10 |
| **US9 (Drag & Drop)** | **P1** | Phase 2 | US1, US2, US3, US6, US8, US10 |
| **US10 (Multi-Tab)** | **P1** | Phase 2 | US1, US2, US3, US6, US8, US9 |
| US4 (Toggle) | P2 | Phase 2 | US5, US7, US11 |
| US5 (Log Level) | P2 | Phase 2 | US4, US7, US11 |
| US7 (Window Lifecycle) | P2 | Phase 2 | US4, US5, US11 |
| **US11 (Window Move)** | **P2** | Phase 2 | US4, US5, US7 |

### Within Each User Story

- Backend changes before frontend integration
- Core implementation before additional context fields
- Verify each story checkpoint before moving to next

### Parallel Opportunities

**Phase 1 (can run in parallel):**
```
T001 (LogEntry model) || T002 (LogEntryPayload)
```

**Phase 2 (can run in parallel):**
```
T011 (TS types) || T012 (loggingService) || T013 (settings methods)
```

**P1 Stories (after Phase 2, can run in parallel):**
```
US6 (App Startup) || US1 (Save) || US2 (Open) || US3 (Shortcuts) || US8 (Finder) || US9 (Drop) || US10 (Tabs)
```

**P2 Stories (after Phase 2, can run in parallel):**
```
US4 (Toggle) || US5 (Level) || US7 (Window) || US11 (Window Move)
```

**Phase 14 (can run in parallel):**
```
T061 || T062 || T063 || T064 || T078 || T079 || T080
```

---

## Parallel Example: P1 Stories

```bash
# After Phase 2 completes, launch all P1 stories in parallel:

# US6: App Startup
Task: "Add app.launch logging at start of main() in src-tauri/src/main.rs"

# US1: Save Logging
Task: "Add file.save start logging at beginning of save_file in src-tauri/src/commands/file.rs"

# US2: Open Logging
Task: "Add file.open start logging at beginning of open_file in src-tauri/src/commands/file.rs"

# US3: Shortcut Logging
Task: "Add logShortcut() calls in src/hooks/useKeyboardShortcuts.ts"
```

---

## Implementation Strategy

### MVP First (Phase 1 + 2 + US6)

1. Complete Phase 1: Setup (backend models)
2. Complete Phase 2: Foundational (IPC commands)
3. Complete Phase 3: User Story 6 (app.launch/ready)
4. **STOP and VALIDATE**: Test with `tail -f ~/.mdpro/mdpro.log | jq .`
5. You now have basic app lifecycle logging

### Incremental Delivery

1. Setup + Foundational → Logging infrastructure ready
2. Add US6 (App Startup) → Test: app.launch + app.ready appear
3. Add US1 (Save) → Test: file.save with start/success/fail
4. Add US2 (Open) → Test: file.open with dialog cancel
5. Add US3 (Shortcuts) → Test: ui.shortcut.trigger events
6. **Add US8 (Finder Open) → Test: file.open.external from Finder** 🎯 CRITICAL
7. **Add US9 (Drag & Drop) → Test: file.open.drop events** 🎯 CRITICAL
8. **Add US10 (Multi-Tab) → Test: tab.open/close/switch events**
9. Add US4+US5 (Settings) → Test: toggle and level filtering
10. Add US7 (Windows) → Test: window.open/close events
11. Add US11 (Window Move) → Test: window.move events
12. Polish → All edge cases covered

### Single Developer Sequence

1. Phase 1: T001-T006, T076-T077 (backend models/logger)
2. Phase 2: T007-T015 (IPC + frontend foundation)
3. Phase 3: T016-T019 (app lifecycle - quick win)
4. Phase 4: T020-T023 (save logging)
5. Phase 5: T024-T028 (open logging)
6. Phase 6: T029-T032 (shortcut logging)
7. Phase 7: T033-T037 (settings toggle)
8. Phase 8: T038-T040 (log level)
9. Phase 9: T041-T044 (window events)
10. **Phase 10: T045-T049 (Finder/external open) 🎯 CRITICAL for your issues**
11. **Phase 11: T050-T053 (drag & drop) 🎯 CRITICAL for your issues**
12. **Phase 12: T054-T058 (multi-tab logging)**
13. Phase 13: T059-T060 (window move)
14. Phase 14: T061-T071 (polish + verification)

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story
- No automated tests - verification via jq commands
- Commit after each phase or logical group
- All logging errors are silently ignored (NFR-002)
- Keep existing `log_line()` for backward compatibility
