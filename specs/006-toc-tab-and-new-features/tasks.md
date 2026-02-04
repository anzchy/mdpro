# Tasks: TOC Sidebar, Multi-Tab Support, and Editor Enhancements

**Input**: Design documents from `/specs/006-toc-tab-and-new-features/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**Tests**: Not explicitly requested in spec - tests are OPTIONAL and not included below.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1-US5)
- Include exact file paths in descriptions

## Path Conventions

This is a Tauri desktop app with:
- **Backend**: `src-tauri/src/` (Rust)
- **Frontend**: `src/` (React/TypeScript)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Extend existing project structure for new features

- [ ] T001 Create TOC store file at src/stores/tocStore.ts
- [ ] T002 [P] Create tab store file at src/stores/tabStore.ts
- [ ] T003 [P] Create TOC service file at src/services/tocService.ts
- [ ] T004 [P] Create image service file at src/services/imageService.ts
- [ ] T005 [P] Create TabBar component directory at src/components/TabBar/
- [ ] T006 [P] Create TOC commands module at src-tauri/src/commands/toc.rs
- [ ] T007 [P] Create image commands module at src-tauri/src/commands/image.rs
- [ ] T008 Register new Rust modules in src-tauri/src/commands/mod.rs

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T009 Add AutoSaveConfig struct to src-tauri/src/models/preferences.rs with enabled, interval_ms, debounce_ms, save_on_blur fields
- [ ] T010 [P] Add TabBarConfig struct to src-tauri/src/models/preferences.rs with position, maxVisibleTabs, showCloseOnHover, closeFocusBehavior fields
- [ ] T011 [P] Add ImageConfig struct to src-tauri/src/models/preferences.rs with asset_folder, copy_external_images, show_paste_preview fields
- [ ] T012 Extend preferences.json schema to include autoSave, tabBar, and image sections per data-model.md
- [ ] T013 Modify src/stores/documentStore.ts to support multi-document with getDocumentById and setActiveDocument methods
- [ ] T014 Add preferences IPC commands get_preferences and set_preferences in src-tauri/src/commands/preferences.rs

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - TOC Navigation (Priority: P1) 🎯 MVP

**Goal**: Display hierarchical TOC in sidebar, navigate to headings, real-time updates

**Independent Test**: Open document with headers, press Cmd+Shift+B, verify TOC displays, click entries to navigate

### Implementation for User Story 1

- [ ] T015 [US1] Implement get_document_headings command in src-tauri/src/commands/toc.rs using pulldown-cmark parser
- [ ] T016 [US1] Add generate_unique_id helper function in src-tauri/src/commands/toc.rs for duplicate heading handling
- [ ] T017 [US1] Register get_document_headings in Tauri invoke handler in src-tauri/src/commands/mod.rs
- [ ] T018 [P] [US1] Implement TOCEntry interface in src/stores/tocStore.ts per data-model.md
- [ ] T019 [P] [US1] Implement TOCState interface with entries, activeEntryId, isVisible, collapsedIds in src/stores/tocStore.ts
- [ ] T020 [US1] Implement tocStore actions: setEntries, setActiveEntry, toggleVisibility, navigateToEntry in src/stores/tocStore.ts
- [ ] T021 [US1] Implement getDocumentHeadings IPC wrapper in src/services/tocService.ts
- [ ] T022 [US1] Create useTOC hook in src/hooks/useTOC.ts with Intersection Observer for spy scrolling (rootMargin: 0px 0px -66%)
- [ ] T023 [US1] Create TOCSidebar component in src/components/Sidebar/TOCSidebar.tsx with hierarchical indentation
- [ ] T024 [US1] Add empty state message "No headings found" in TOCSidebar when entries array is empty
- [ ] T025 [US1] Implement smooth scrolling to heading on TOC entry click in src/components/Sidebar/TOCSidebar.tsx
- [ ] T026 [US1] Add active entry highlighting in TOCSidebar based on scroll position
- [ ] T027 [US1] Modify src/components/Sidebar/index.tsx to toggle between file list and TOC view
- [ ] T028 [US1] Wire Cmd+Shift+B menu action to toggle TOC visibility in src/hooks/useMenuEvents.ts
- [ ] T029 [US1] Add real-time TOC update when document content changes (debounced) in useTOC hook

**Checkpoint**: User Story 1 complete - TOC navigation fully functional and independently testable

---

## Phase 4: User Story 2 - Multi-Tab Document Editing (Priority: P1)

**Goal**: Open multiple documents as tabs, switch between them, preserve state

**Independent Test**: Click "+" button, open files in tabs, switch between tabs, close tabs with save prompts

### Implementation for User Story 2

- [ ] T030 [P] [US2] Implement Tab interface in src/stores/tabStore.ts with id, documentId, title, isDirty, isPinned, order, state, lastActiveAt
- [ ] T031 [P] [US2] Implement TabState interface in src/stores/tabStore.ts with scrollTop, cursorPosition, viewMode
- [ ] T032 [P] [US2] Implement ClosedTab interface in src/stores/tabStore.ts for undo close functionality
- [ ] T033 [US2] Implement tabStore actions: openTab, closeTab, switchToTab, setTabDirty in src/stores/tabStore.ts
- [ ] T034 [US2] Implement tabStore actions: reorderTabs, pinTab, unpinTab, undoCloseTab, saveTabState in src/stores/tabStore.ts
- [ ] T035 [US2] Implement getNextTabOnClose with MRU logic in src/stores/tabStore.ts
- [ ] T036 [US2] Create useTabs hook in src/hooks/useTabs.ts for tab management integration
- [ ] T037 [US2] Create Tab component in src/components/TabBar/Tab.tsx with dirty indicator (filled circle vs X)
- [ ] T038 [US2] Create TabBar component in src/components/TabBar/TabBar.tsx with single-row horizontal scroll layout
- [ ] T039 [US2] Add "+" button to TabBar for creating new document
- [ ] T040 [US2] Implement tab switching with 300ms cross-fade animation (no slide) via CSS in src/styles/
- [ ] T041 [US2] Implement context preservation in useTabs hook: save scrollTop, cursorPosition (line, column), and viewMode before switch; restore all three after switch per TabState interface
- [ ] T042 [US2] Wire Cmd+W to close active tab in src/hooks/useMenuEvents.ts
- [ ] T043 [US2] Implement middle-click to close tab in Tab component
- [ ] T044 [US2] Add save prompt dialog when closing dirty tab in closeTab action
- [ ] T045 [US2] Implement get_tab_preferences and save_tab_preferences commands in src-tauri/src/commands/preferences.rs
- [ ] T045a [US2] Verify Settings → General section exists in src/components/Settings/; create GeneralSettings.tsx if missing
- [ ] T046 [US2] Add tab bar position setting (top/bottom) to Settings → General UI
- [ ] T047 [US2] Integrate TabBar into main App layout in src/App.tsx

**Checkpoint**: User Story 2 complete - Multi-tab editing fully functional and independently testable

---

## Phase 5: User Story 3 - Streamlined Auto-Save (Priority: P2)

**Goal**: Silent Cmd+S save, configurable auto-save intervals, external change detection

**Independent Test**: Press Cmd+S on saved document (no dialog), configure auto-save interval, verify auto-save works

### Implementation for User Story 3

- [ ] T048 [US3] Implement save_document_silent command in src-tauri/src/commands/file.rs
- [ ] T049 [US3] Add NO_FILE_PATH error handling in save_document_silent for new documents
- [ ] T050 [US3] Implement get_auto_save_config command in src-tauri/src/commands/file.rs
- [ ] T051 [US3] Implement set_auto_save_config command in src-tauri/src/commands/file.rs with validation
- [ ] T052 [US3] Implement check_file_modified command in src-tauri/src/commands/file.rs
- [ ] T053 [US3] Register auto-save commands in Tauri invoke handler in src-tauri/src/commands/mod.rs
- [ ] T054 [US3] Refactor src/hooks/useAutoSave.ts with debounced save logic and saveInProgress flag
- [ ] T055 [US3] Add onBlur save trigger to useAutoSave hook
- [ ] T056 [US3] Create useAutoSaveConfig hook to load/save config via IPC in src/hooks/useAutoSave.ts
- [ ] T057 [US3] Modify Cmd+S handler in src/hooks/useMenuEvents.ts to use silent save for existing files
- [ ] T058 [US3] Add external change detection handling with Reload/Restore dialog in src/hooks/useFileWatcher.ts
- [ ] T059 [US3] Create SaveStatusIndicator component showing "Saved" or "Saving..." in src/components/
- [ ] T060 [US3] Create non-blocking error toast for auto-save failures
- [ ] T061 [US3] Add auto-save interval selector (5s, 15s, 60s, disabled) to Settings → General UI

**Checkpoint**: User Story 3 complete - Auto-save fully functional and independently testable

---

## Phase 6: User Story 4 - Table Rendering and Editing (Priority: P2)

**Goal**: Render Markdown tables as HTML, context menu for row/column operations, alignment controls

**Independent Test**: Create Markdown table, view in WYSIWYG/Preview, right-click for context menu, add rows/columns

### Implementation for User Story 4

- [ ] T062 [P] [US4] Define TableCell interface in src/plugins/milkdown/tablePlugin.ts per data-model.md
- [ ] T063 [P] [US4] Define TableState interface with cells, selectedCell, columnWidths in src/plugins/milkdown/tablePlugin.ts
- [ ] T064 [P] [US4] Define TableContextMenuAction type in src/plugins/milkdown/tablePlugin.ts
- [ ] T065 [US4] Create TableContextMenu component in src/components/Editor/TableContextMenu.tsx with menu structure per research.md
- [ ] T066 [US4] Implement menu items: Insert Row Above/Below, Insert Column Left/Right with dividers
- [ ] T067 [US4] Implement menu items: Align Left/Center/Right with divider before destructive actions
- [ ] T068 [US4] Implement menu items: Delete Row, Delete Column (destructive, at bottom)
- [ ] T069 [US4] Extend Milkdown table plugin to show context menu on right-click in src/plugins/milkdown/tablePlugin.ts
- [ ] T070 [US4] Implement executeTableAction function to dispatch Prosemirror commands in tablePlugin.ts
- [ ] T071 [US4] Implement Cmd+Enter keyboard shortcut for insert row below in tablePlugin.ts
- [ ] T072 [US4] Implement Tab navigation between cells with new row creation at end in tablePlugin.ts
- [ ] T073 [US4] Implement column alignment persistence to Markdown syntax (:--, :--:, --:) in tablePlugin.ts
- [ ] T074 [US4] Add CSS styles for rendered tables in src/styles/
- [ ] T074a [US4] Verify table rendering in Preview mode via marked library (GFM tables enabled); add table styles to Preview component CSS if needed

**Checkpoint**: User Story 4 complete - Table editing fully functional and independently testable

---

## Phase 7: User Story 5 - Image Rendering and Upload (Priority: P3)

**Goal**: Render local/remote images, drag-drop/paste upload, configurable asset folder

**Independent Test**: Insert local image path, insert web URL, drag-drop image file, use Settings → Image

### Implementation for User Story 5

- [ ] T075 [P] [US5] Define ImageReference interface in src/services/imageService.ts per data-model.md
- [ ] T076 [P] [US5] Define ImageConfig interface in src/services/imageService.ts
- [ ] T077 [US5] Implement resolve_image_path command in src-tauri/src/commands/image.rs
- [ ] T078 [US5] Implement upload_image command in src-tauri/src/commands/image.rs with base64 decoding
- [ ] T079 [US5] Implement upload_images_batch command for multiple images in src-tauri/src/commands/image.rs
- [ ] T080 [US5] Implement copy_external_image command in src-tauri/src/commands/image.rs
- [ ] T081 [US5] Implement get_image_config and set_image_config commands in src-tauri/src/commands/image.rs
- [ ] T082 [US5] Register image commands in Tauri invoke handler in src-tauri/src/commands/mod.rs
- [ ] T083 [US5] Implement resolveImagePath IPC wrapper in src/services/imageService.ts
- [ ] T084 [US5] Implement uploadImage IPC wrapper in src/services/imageService.ts
- [ ] T085 [US5] Create useImageUpload hook in src/hooks/useImageUpload.ts with handleDrop and handlePaste
- [ ] T086 [US5] Implement fileToBase64 helper in useImageUpload hook
- [ ] T087 [US5] Create ImageErrorPlaceholder component in src/components/Editor/ showing alt text and path
- [ ] T088 [US5] Create ImagePreviewDialog component for paste preview in src/components/
- [ ] T089 [US5] Wire drag-drop handler to editor in src/components/Editor/
- [ ] T090 [US5] Wire paste handler for clipboard images in src/components/Editor/
- [ ] T091 [US5] Create ImageSettings panel in src/components/Settings/ImageSettings.tsx
- [ ] T092 [US5] Add Image menu item to Settings navigation
- [ ] T093 [US5] Implement asset folder configuration in ImageSettings
- [ ] T094 [US5] Implement copy external images toggle in ImageSettings
- [ ] T095 [US5] Implement paste preview toggle in ImageSettings

**Checkpoint**: User Story 5 complete - Image handling fully functional and independently testable

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T096 [P] Add structured logging for all new features per CLAUDE.md logging rules
- [ ] T097 [P] Update native menu in src-tauri/src/menu.rs if needed for new features
- [ ] T098 Code cleanup: remove any console.log statements, add proper error handling
- [ ] T099 Performance validation: verify SC-001 to SC-007 success criteria from spec.md
- [ ] T100 Run quickstart.md validation checklist
- [ ] T101 Update CLAUDE.md with feature 006 active technologies if not already done

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phases 3-7)**: All depend on Foundational phase completion
  - User stories can proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P1 → P2 → P2 → P3)
- **Polish (Phase 8)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1) - TOC**: Can start after Foundational - No dependencies on other stories
- **User Story 2 (P1) - Tabs**: Can start after Foundational - No dependencies on other stories
- **User Story 3 (P2) - Auto-Save**: Can start after Foundational - Benefits from US2 (dirty state) but independently testable
- **User Story 4 (P2) - Tables**: Can start after Foundational - No dependencies on other stories
- **User Story 5 (P3) - Images**: Can start after Foundational - No dependencies on other stories

### Within Each User Story

- Rust commands before frontend services
- Stores/interfaces before hooks
- Hooks before components
- Core implementation before UI integration

### Parallel Opportunities

- All Setup tasks T001-T008 marked [P] can run in parallel
- Foundational T009-T011 can run in parallel
- User stories can run in parallel after Foundational completes
- Within each story, tasks marked [P] can run in parallel

---

## Parallel Example: User Story 1

```bash
# Phase 1: These can run in parallel
Task T001: "Create TOC store file at src/stores/tocStore.ts"
Task T003: "Create TOC service file at src/services/tocService.ts"
Task T006: "Create TOC commands module at src-tauri/src/commands/toc.rs"

# Phase 3: After backend command (T015-T017), these can run in parallel
Task T018: "Implement TOCEntry interface in src/stores/tocStore.ts"
Task T019: "Implement TOCState interface in src/stores/tocStore.ts"
```

## Parallel Example: Multiple User Stories

```bash
# After Foundational phase, launch all P1 stories in parallel:
Developer A: Start User Story 1 (TOC) - T015 onwards
Developer B: Start User Story 2 (Tabs) - T030 onwards
```

---

## Implementation Strategy

### MVP First (User Story 1 + 2 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 - TOC Navigation
4. Complete Phase 4: User Story 2 - Multi-Tab Support
5. **STOP and VALIDATE**: Test both P1 stories independently
6. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add User Story 1 (TOC) → Test independently → Demo
3. Add User Story 2 (Tabs) → Test independently → Demo (MVP Complete!)
4. Add User Story 3 (Auto-Save) → Test independently → Demo
5. Add User Story 4 (Tables) → Test independently → Demo
6. Add User Story 5 (Images) → Test independently → Demo
7. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers after Foundational:

- Developer A: User Story 1 (TOC) + User Story 3 (Auto-Save)
- Developer B: User Story 2 (Tabs) + User Story 4 (Tables)
- Developer C: User Story 5 (Images) + Polish

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence

---

## Summary

| Phase | Tasks | Parallel Opportunities |
|-------|-------|----------------------|
| Setup | T001-T008 (8 tasks) | 6 parallel |
| Foundational | T009-T014 (6 tasks) | 2 parallel |
| US1 - TOC (P1) | T015-T029 (15 tasks) | 2 parallel |
| US2 - Tabs (P1) | T030-T047 (19 tasks) | 3 parallel |
| US3 - Auto-Save (P2) | T048-T061 (14 tasks) | 0 parallel |
| US4 - Tables (P2) | T062-T074a (14 tasks) | 3 parallel |
| US5 - Images (P3) | T075-T095 (21 tasks) | 2 parallel |
| Polish | T096-T101 (6 tasks) | 2 parallel |
| **Total** | **103 tasks** | **20 parallel** |

### MVP Scope (Recommended)

- Phase 1: Setup (8 tasks)
- Phase 2: Foundational (6 tasks)
- Phase 3: User Story 1 - TOC (15 tasks)
- Phase 4: User Story 2 - Tabs (18 tasks)
- **MVP Total: 48 tasks**
