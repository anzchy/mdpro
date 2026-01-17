# Tasks: mdpro MVP

**Input**: Design documents from `/specs/001-mdpro-mvp/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Tests are NOT explicitly requested in the feature specification. Test tasks are omitted.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Rust Backend**: `src-tauri/src/`
- **React Frontend**: `src/`
- **Tests**: `tests/` (E2E: `tests/e2e/`, Unit: `tests/unit/`)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Create Tauri 2.0 + React + TypeScript project using `pnpm create tauri-app`
- [x] T002 Configure Cargo.toml with dependencies: pulldown-cmark, serde, serde_json, notify, chrono, uuid in src-tauri/Cargo.toml
- [x] T003 [P] Configure package.json with dependencies: @uiwjs/react-codemirror, @codemirror/lang-markdown, marked, dompurify, zustand in package.json
- [x] T004 [P] Configure TailwindCSS with darkMode: 'class' in tailwind.config.js
- [x] T005 [P] Configure Vite with Tauri plugin in vite.config.ts
- [x] T006 [P] Configure TypeScript strict mode in tsconfig.json
- [x] T007 Create directory structure per plan.md (src/components/, src/hooks/, src/services/, src/stores/, src/types/, src/styles/)
- [x] T008 Create Rust directory structure (src-tauri/src/commands/, src-tauri/src/services/, src-tauri/src/models/)

**Checkpoint**: Project structure ready for development

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Backend Models & Types

- [ ] T009 [P] Create Document model in src-tauri/src/models/document.rs per data-model.md
- [ ] T010 [P] Create Draft model in src-tauri/src/models/draft.rs per data-model.md
- [ ] T011 [P] Create UserPreferences model in src-tauri/src/models/preferences.rs per data-model.md
- [ ] T012 Create models/mod.rs exporting all models in src-tauri/src/models/mod.rs

### Frontend Types

- [ ] T013 [P] Create Document types in src/types/document.ts per data-model.md
- [ ] T014 [P] Create EditorState types in src/types/editor.ts per data-model.md
- [ ] T015 [P] Create Theme types in src/types/theme.ts per data-model.md
- [ ] T016 [P] Create UserPreferences types in src/types/preferences.ts per data-model.md

### State Management

- [ ] T017 [P] Create documentStore with Zustand in src/stores/documentStore.ts
- [ ] T018 [P] Create editorStore with Zustand in src/stores/editorStore.ts
- [ ] T019 [P] Create themeStore with Zustand in src/stores/themeStore.ts

### Base UI Components

- [ ] T020 Create App shell layout with sidebar, toolbar, main area in src/App.tsx
- [ ] T021 [P] Create global CSS styles and CSS variables in src/styles/globals.css
- [ ] T022 [P] Create light theme CSS in src/styles/themes/light.css
- [ ] T023 [P] Create dark theme CSS in src/styles/themes/dark.css

### Tauri Configuration

- [ ] T024 Configure tauri.conf.json with window settings, app name, security CSP in src-tauri/tauri.conf.json
- [ ] T025 Setup main.rs with Tauri builder and command registration in src-tauri/src/main.rs
- [ ] T026 Create lib.rs with command exports in src-tauri/src/lib.rs

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - 打开并编辑本地Markdown文件 (Priority: P1) 🎯 MVP

**Goal**: Users can open, edit, and save local Markdown files

**Independent Test**: Open a .md file via File menu or drag-drop, edit content, save with Cmd+S, verify file updated on disk

### Backend Commands (US1)

- [ ] T027 [P] [US1] Implement open_file command in src-tauri/src/commands/file.rs per file-commands.md
- [ ] T028 [P] [US1] Implement open_file_dialog command in src-tauri/src/commands/file.rs per file-commands.md
- [ ] T029 [P] [US1] Implement save_file command in src-tauri/src/commands/file.rs per file-commands.md
- [ ] T030 [P] [US1] Implement save_file_dialog command in src-tauri/src/commands/file.rs per file-commands.md
- [ ] T031 [P] [US1] Implement close_document command in src-tauri/src/commands/file.rs per file-commands.md
- [ ] T032 [US1] Create commands/mod.rs and register file commands in src-tauri/src/commands/mod.rs

### Frontend Services (US1)

- [ ] T033 [US1] Create fileService with IPC wrappers in src/services/fileService.ts per file-commands.md

### Editor Component (US1)

- [ ] T034 [US1] Create base Editor component with CodeMirror 6 in src/components/Editor/Editor.tsx
- [ ] T035 [US1] Configure CodeMirror markdown language extension in src/components/Editor/extensions/markdown.ts
- [ ] T036 [US1] Create useDocument hook for document state in src/hooks/useDocument.ts
- [ ] T037 [US1] Create useEditor hook for editor state in src/hooks/useEditor.ts

### File Menu & Shortcuts (US1)

- [ ] T038 [US1] Create Toolbar component with File menu (Open, Save, New) in src/components/Toolbar/Toolbar.tsx
- [ ] T039 [US1] Implement Cmd+O, Cmd+S, Cmd+W keyboard shortcuts in src/hooks/useKeyboardShortcuts.ts
- [ ] T040 [US1] Implement drag-and-drop file opening in src/App.tsx

### Unsaved Changes (US1)

- [ ] T041 [US1] Add unsaved changes indicator in title bar in src/components/Toolbar/Toolbar.tsx
- [ ] T042 [US1] Implement close confirmation dialog for unsaved changes in src/components/common/ConfirmDialog.tsx
- [ ] T043 [US1] Handle window close event with unsaved check in src/App.tsx

**Checkpoint**: User Story 1 complete - can open, edit, save files independently

---

## Phase 4: User Story 2 - 实时预览Markdown渲染效果 (Priority: P1)

**Goal**: Users see live-rendered markdown preview as they type

**Independent Test**: Type `# Heading` in editor, see rendered heading in preview within 100ms

### Backend Rendering (US2)

- [ ] T044 [US2] Implement render_markdown command with pulldown-cmark in src-tauri/src/services/markdown.rs
- [ ] T045 [US2] Add render_markdown to export commands in src-tauri/src/commands/export.rs

### Frontend Preview (US2)

- [ ] T046 [US2] Create exportService with renderMarkdown wrapper in src/services/exportService.ts
- [ ] T047 [US2] Create Preview component with markdown rendering in src/components/Preview/Preview.tsx
- [ ] T048 [US2] Create preview styles (typography, code blocks) in src/components/Preview/styles/preview.css
- [ ] T049 [US2] Implement debounced preview updates (100ms) in src/hooks/usePreview.ts

### Split View (US2)

- [ ] T050 [US2] Create SplitView component with resizable panes in src/components/Editor/SplitView.tsx
- [ ] T051 [US2] Implement scroll sync between editor and preview in src/hooks/useScrollSync.ts

**Checkpoint**: User Story 2 complete - live preview works independently

---

## Phase 5: User Story 3 - 创建新的Markdown文档 (Priority: P1)

**Goal**: Users can create new blank documents and save them

**Independent Test**: Press Cmd+N, type content, save to new file location

### Backend Commands (US3)

- [ ] T052 [US3] Implement create_document command in src-tauri/src/commands/file.rs per file-commands.md

### Frontend Implementation (US3)

- [ ] T053 [US3] Add createDocument to fileService in src/services/fileService.ts
- [ ] T054 [US3] Implement Cmd+N shortcut for new document in src/hooks/useKeyboardShortcuts.ts
- [ ] T055 [US3] Add "New" button to Toolbar/File menu in src/components/Toolbar/Toolbar.tsx
- [ ] T056 [US3] Handle first-time save (Save As dialog) for new documents in src/hooks/useDocument.ts

**Checkpoint**: User Story 3 complete - can create new documents independently

---

## Phase 6: User Story 4 - 使用标准Markdown语法编写内容 (Priority: P1)

**Goal**: Full markdown syntax support with syntax highlighting in preview

**Independent Test**: Type all markdown syntax (headings, lists, code, tables, links, images), verify correct rendering

### Markdown Syntax Support (US4)

- [ ] T057 [US4] Configure GFM extensions in pulldown-cmark (tables, task lists, strikethrough) in src-tauri/src/services/markdown.rs
- [ ] T058 [US4] Add code syntax highlighting with highlight.js or shiki in src/components/Preview/Preview.tsx
- [ ] T059 [US4] Style tables, blockquotes, lists in preview CSS in src/components/Preview/styles/preview.css
- [ ] T060 [US4] Handle image rendering with fallback for failed loads in src/components/Preview/ImageRenderer.tsx
- [ ] T061 [US4] Make links clickable (open in external browser) in src/components/Preview/Preview.tsx

### Editor Enhancements (US4)

- [ ] T062 [US4] Add CodeMirror syntax highlighting for markdown in src/components/Editor/extensions/syntax.ts
- [ ] T063 [US4] Implement Cmd+Z / Cmd+Shift+Z undo/redo in src/components/Editor/Editor.tsx

**Checkpoint**: User Story 4 complete - full markdown syntax works independently

---

## Phase 7: User Story 5 - 使用高亮和标记功能 (Priority: P2)

**Goal**: Support HTML mark tag and underline syntax for highlighting

**Independent Test**: Type `<mark style="background: #FF5582A6;">text</mark>` and `<u>text</u>`, see styled output

### Custom Syntax Support (US5)

- [ ] T064 [US5] Configure pulldown-cmark to allow HTML tags (mark, u) in src-tauri/src/services/markdown.rs
- [ ] T065 [US5] Style mark and underline elements in preview CSS in src/components/Preview/styles/preview.css
- [ ] T066 [US5] Implement Cmd+Shift+H shortcut to wrap selection in mark tag in src/hooks/useKeyboardShortcuts.ts
- [ ] T067 [US5] Add highlight button to toolbar in src/components/Toolbar/Toolbar.tsx

**Checkpoint**: User Story 5 complete - highlighting works independently

---

## Phase 8: User Story 6 - 切换编辑视图模式 (Priority: P2)

**Goal**: Users can switch between split-pane, editor-only, preview-only, and WYSIWYG modes

**Independent Test**: Click mode buttons, verify correct view renders for each mode

### View Mode Controls (US6)

- [ ] T068 [US6] Add view mode buttons to Toolbar (Split, Editor, Preview, WYSIWYG) in src/components/Toolbar/Toolbar.tsx
- [ ] T069 [US6] Implement editor-only mode (hide preview) in src/components/Editor/SplitView.tsx
- [ ] T070 [US6] Implement preview-only mode (hide editor) in src/components/Editor/SplitView.tsx

### WYSIWYG Mode (US6)

- [ ] T071 [US6] Create WysiwygView component with CM6 decorations in src/components/Editor/WysiwygView.tsx
- [ ] T072 [US6] Implement markdown syntax hiding on unfocused lines in src/components/Editor/extensions/wysiwyg.ts
- [ ] T073 [US6] Create widget decorations for headings, lists, code blocks in src/components/Editor/extensions/widgets.ts
- [ ] T074 [US6] Implement cursor-aware syntax reveal in src/components/Editor/extensions/wysiwyg.ts

**Checkpoint**: User Story 6 complete - all view modes work independently

---

## Phase 9: User Story 7 - 使用文件侧边栏管理文档 (Priority: P3)

**Goal**: Sidebar shows open documents for quick switching

**Independent Test**: Open multiple files, see them in sidebar, click to switch between them

### Sidebar Component (US7)

- [ ] T075 [US7] Create Sidebar component in src/components/Sidebar/Sidebar.tsx
- [ ] T076 [US7] Create FileItem component for sidebar entries in src/components/Sidebar/FileItem.tsx
- [ ] T077 [US7] Track open documents in documentStore in src/stores/documentStore.ts
- [ ] T078 [US7] Implement document switching on sidebar click in src/components/Sidebar/Sidebar.tsx
- [ ] T079 [US7] Add close button to FileItem with confirmation in src/components/Sidebar/FileItem.tsx
- [ ] T080 [US7] Add sidebar toggle button to toolbar in src/components/Toolbar/Toolbar.tsx

**Checkpoint**: User Story 7 complete - sidebar works independently

---

## Phase 10: User Story 8 - 切换明暗主题 (Priority: P3)

**Goal**: Users can switch between light/dark themes or follow system

**Independent Test**: Switch to dark theme, verify all UI elements use dark colors

### Theme Backend (US8)

- [ ] T081 [US8] Implement get_system_theme command in src-tauri/src/commands/preferences.rs
- [ ] T082 [US8] Implement theme change event listener in src-tauri/src/services/file_watcher.rs

### Theme Frontend (US8)

- [ ] T083 [US8] Create preferencesService with get/set preferences in src/services/preferencesService.ts
- [ ] T084 [US8] Create useTheme hook for theme management in src/hooks/useTheme.ts
- [ ] T085 [US8] Add theme toggle to toolbar/settings in src/components/Toolbar/Toolbar.tsx
- [ ] T086 [US8] Implement system theme detection and auto-switch in src/hooks/useTheme.ts
- [ ] T087 [US8] Apply theme class to document root in src/App.tsx

### Preferences Persistence (US8)

- [ ] T088 [US8] Implement get_preferences command in src-tauri/src/commands/preferences.rs
- [ ] T089 [US8] Implement set_preferences command in src-tauri/src/commands/preferences.rs
- [ ] T090 [US8] Create ~/.mdpro/config.json on first launch in src-tauri/src/services/preferences.rs
- [ ] T091 [US8] Load preferences on app startup in src/App.tsx

**Checkpoint**: User Story 8 complete - themes work independently

---

## Phase 11: Auto-save & Recovery (Cross-cutting)

**Purpose**: Implements FR-016 auto-save every 30 seconds with crash recovery

### Draft Management

- [ ] T092 Implement save_draft command in src-tauri/src/commands/draft.rs per draft-commands.md
- [ ] T093 Implement list_drafts command in src-tauri/src/commands/draft.rs per draft-commands.md
- [ ] T094 Implement recover_draft command in src-tauri/src/commands/draft.rs per draft-commands.md
- [ ] T095 Implement delete_draft command in src-tauri/src/commands/draft.rs per draft-commands.md
- [ ] T096 Create draft service for file operations in src-tauri/src/services/draft.rs

### Frontend Auto-save

- [ ] T097 Create useAutoSave hook with 30s interval in src/hooks/useAutoSave.ts per draft-commands.md
- [ ] T098 Create RecoveryDialog component in src/components/common/RecoveryDialog.tsx
- [ ] T099 Check for unrecovered drafts on app startup in src/App.tsx

---

## Phase 12: HTML Export (Cross-cutting)

**Purpose**: Implements FR-018 HTML export with inline styles

### Export Backend

- [ ] T100 Implement export_html command in src-tauri/src/commands/export.rs per export-commands.md
- [ ] T101 Create HTML template with inline CSS in src-tauri/src/services/html_template.rs

### Export Frontend

- [ ] T102 Add export_html to exportService in src/services/exportService.ts
- [ ] T103 Add "Export HTML" button to File menu in src/components/Toolbar/Toolbar.tsx

---

## Phase 13: External File Changes (Edge Case)

**Purpose**: Handle files modified outside the app

### File Watcher

- [ ] T104 Implement file watcher service with notify crate in src-tauri/src/services/file_watcher.rs per events.md
- [ ] T105 Create useFileWatcher hook for change events in src/hooks/useFileWatcher.ts per events.md
- [ ] T106 Create ReloadDialog component for external changes in src/components/common/ReloadDialog.tsx
- [ ] T107 Implement check_file_modified and reload_file commands in src-tauri/src/commands/file.rs

---

## Phase 14: Polish & Cross-Cutting Concerns

**Purpose**: Final improvements affecting multiple user stories

- [ ] T108 Add loading states for file operations in src/components/common/LoadingSpinner.tsx
- [ ] T109 Add error toast notifications for failed operations in src/components/common/Toast.tsx
- [ ] T110 Implement large file warning (>10MB) in src/hooks/useDocument.ts
- [ ] T111 Save and restore window dimensions on close/open in src/App.tsx
- [ ] T112 Add recent files list to File menu in src/components/Toolbar/Toolbar.tsx
- [ ] T113 Performance optimization: virtual scrolling for large documents in src/components/Editor/Editor.tsx
- [ ] T114 Implement file encoding detection with fallback prompt in src-tauri/src/services/encoding.rs
- [ ] T115 Create EncodingDialog component for manual encoding selection in src/components/common/EncodingDialog.tsx
- [ ] T116 Run quickstart.md validation: verify all setup steps work

---

## Phase 15: Testing

**Purpose**: Unit tests, integration tests, and E2E tests per plan.md testing strategy

**Frameworks**: Vitest (frontend unit), cargo test (backend), Playwright (E2E)

### Backend Unit Tests (Rust)

- [ ] T117 [P] Create unit tests for Document model in src-tauri/src/models/document.rs
- [ ] T118 [P] Create unit tests for Draft model in src-tauri/src/models/draft.rs
- [ ] T119 [P] Create unit tests for markdown rendering service in src-tauri/src/services/markdown.rs
- [ ] T120 [P] Create unit tests for file operations commands in src-tauri/src/commands/file.rs
- [ ] T121 [P] Create unit tests for encoding detection service in src-tauri/src/services/encoding.rs

### Frontend Unit Tests (Vitest)

- [ ] T122 [P] Create unit tests for documentStore in tests/unit/stores/documentStore.test.ts
- [ ] T123 [P] Create unit tests for editorStore in tests/unit/stores/editorStore.test.ts
- [ ] T124 [P] Create unit tests for themeStore in tests/unit/stores/themeStore.test.ts
- [ ] T125 [P] Create unit tests for useDocument hook in tests/unit/hooks/useDocument.test.ts
- [ ] T126 [P] Create unit tests for useAutoSave hook in tests/unit/hooks/useAutoSave.test.ts

### Frontend Component Tests (Vitest + React Testing Library)

- [ ] T127 [P] Create component tests for Editor in tests/unit/components/Editor.test.tsx
- [ ] T128 [P] Create component tests for Preview in tests/unit/components/Preview.test.tsx
- [ ] T129 [P] Create component tests for Toolbar in tests/unit/components/Toolbar.test.tsx
- [ ] T130 [P] Create component tests for Sidebar in tests/unit/components/Sidebar.test.tsx

### E2E Tests (Playwright)

- [ ] T131 Create E2E test for file open/edit/save flow in tests/e2e/file-operations.spec.ts
- [ ] T132 Create E2E test for new document creation in tests/e2e/new-document.spec.ts
- [ ] T133 Create E2E test for live preview rendering in tests/e2e/preview.spec.ts
- [ ] T134 Create E2E test for theme switching in tests/e2e/theme.spec.ts
- [ ] T135 Create E2E test for HTML export in tests/e2e/export.spec.ts
- [ ] T136 Create E2E test for auto-save and recovery in tests/e2e/autosave.spec.ts

**Checkpoint**: All tests passing, ready for release

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies - can start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 completion - BLOCKS all user stories
- **Phase 3-10 (User Stories)**: All depend on Phase 2 completion
  - Phase 3 → US1 (文件操作): No story dependencies - RECOMMENDED MVP
  - Phase 4 → US2 (实时预览): Benefits from US1 but can be tested independently
  - Phase 5 → US3 (新建文档): Can run parallel with US1/US2
  - Phase 6 → US4 (Markdown语法): Builds on US2 preview but testable independently
  - Phase 7 → US5 (高亮标记): Extends US4 markdown support
  - Phase 8 → US6 (视图模式): Requires US1 editor and US2 preview
  - Phase 9 → US7 (侧边栏): Requires US1 document handling
  - Phase 10 → US8 (主题切换): Can run parallel with any P1 story
- **Phase 11-13 (Cross-cutting)**: Depend on relevant user stories
- **Phase 14 (Polish)**: Depends on all desired user stories being complete
- **Phase 15 (Testing)**: Depends on Phase 14 completion

### User Story Dependencies

| Story | Depends On | Can Parallel With |
|-------|------------|-------------------|
| US1 (P1) | Foundational | US3, US8 |
| US2 (P1) | Foundational | US3, US8 |
| US3 (P1) | Foundational | US1, US2, US8 |
| US4 (P1) | US2 (preview) | - |
| US5 (P2) | US4 (markdown) | US6 |
| US6 (P2) | US1, US2 | US5 |
| US7 (P3) | US1 | US8 |
| US8 (P3) | Foundational | US1-US7 |

### Parallel Opportunities

**Within Phase 2 (Foundational)**:
- T009, T010, T011 (all models) can run in parallel
- T013, T014, T015, T016 (all types) can run in parallel
- T017, T018, T019 (all stores) can run in parallel
- T021, T022, T023 (all CSS) can run in parallel

**Within Phase 3 (US1)**:
- T027, T028, T029, T030, T031 (all file commands) can run in parallel

**Across Phases**:
- Once Foundational completes, US1/US2/US3/US8 can start in parallel

---

## Parallel Example: Phase 2 (Foundational)

```bash
# Launch all model tasks together:
Task: "Create Document model in src-tauri/src/models/document.rs"
Task: "Create Draft model in src-tauri/src/models/draft.rs"
Task: "Create UserPreferences model in src-tauri/src/models/preferences.rs"

# Launch all type tasks together:
Task: "Create Document types in src/types/document.ts"
Task: "Create EditorState types in src/types/editor.ts"
Task: "Create Theme types in src/types/theme.ts"
Task: "Create UserPreferences types in src/types/preferences.ts"

# Launch all store tasks together:
Task: "Create documentStore with Zustand in src/stores/documentStore.ts"
Task: "Create editorStore with Zustand in src/stores/editorStore.ts"
Task: "Create themeStore with Zustand in src/stores/themeStore.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test file open/edit/save independently
5. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add US1 (files) → Test independently → **MVP Ready!**
3. Add US2 (preview) → Test independently → Split-pane editing
4. Add US3 (new docs) → Test independently → Full file operations
5. Add US4 (syntax) → Test independently → Full markdown support
6. Add US5-US8 → Test independently → Feature-complete

### Parallel Team Strategy

With 2+ developers:
- Developer A: US1 (files) → US3 (new docs) → US7 (sidebar)
- Developer B: US2 (preview) → US4 (syntax) → US5 (highlight)
- Sync at US6 (view modes) which needs both

---

## Summary

| Category | Count |
|----------|-------|
| Total Tasks | 136 |
| Phase 1 (Setup) | 8 |
| Phase 2 (Foundational) | 18 |
| Phase 3 → US1 (文件操作) | 17 |
| Phase 4 → US2 (实时预览) | 8 |
| Phase 5 → US3 (新建文档) | 5 |
| Phase 6 → US4 (Markdown语法) | 7 |
| Phase 7 → US5 (高亮标记) | 4 |
| Phase 8 → US6 (视图模式) | 7 |
| Phase 9 → US7 (侧边栏) | 6 |
| Phase 10 → US8 (主题切换) | 11 |
| Phase 11 (Auto-save) | 8 |
| Phase 12 (Export) | 4 |
| Phase 13 (File Watch) | 4 |
| Phase 14 (Polish) | 9 |
| Phase 15 (Testing) | 20 |

**Suggested MVP Scope**: Phase 1 + Phase 2 + Phase 3 (US1) = 43 tasks

---

## Notes

- [P] tasks = different files, no dependencies
- [US#] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- All file paths follow Tauri 2.0 + React conventions from plan.md
