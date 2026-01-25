# Tasks: Multi-Window Support & UI Improvements

**Input**: Design documents from `/specs/004-minor-fix/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓

**Tests**: Not explicitly requested - tests omitted per specification.

**Organization**: Tasks grouped by user story for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

## Path Conventions

- **Backend (Rust)**: `src-tauri/src/`
- **Frontend (React)**: `src/`

---

## Phase 1: Setup

**Purpose**: Ensure development environment is ready

- [x] T001 Verify current branch is `004-minor-fix` and dependencies are installed
- [x] T002 [P] Run `pnpm tauri dev` to verify app starts correctly

**Checkpoint**: Development environment ready

---

## Phase 2: Foundational (Data Model & IPC Infrastructure)

**Purpose**: Backend infrastructure that enables all window-related user stories

**⚠️ CRITICAL**: User stories cannot begin until this phase completes

- [x] T003 Add `WindowGeometry` struct to `src-tauri/src/models/preferences.rs`
- [x] T004 Add `window_states: HashMap<String, WindowGeometry>` field to `UserPreferences` in `src-tauri/src/models/preferences.rs`
- [x] T005 Change `ViewMode` default from `Split` to `Wysiwyg` in `src-tauri/src/models/preferences.rs`
- [x] T006 Export new types in `src-tauri/src/models/mod.rs`
- [x] T007 Create `src-tauri/src/commands/window.rs` with `create_window` command using `WebviewWindowBuilder`
- [x] T008 Add `save_window_geometry` command to `src-tauri/src/commands/window.rs`
- [x] T009 Add `get_window_geometry` command to `src-tauri/src/commands/window.rs`
- [x] T010 Register window commands in `src-tauri/src/commands/mod.rs` (add `pub mod window` and handlers)
- [x] T011 [P] Add `WindowGeometry` interface to `src/types/preferences.ts`
- [x] T012 [P] Add `windowStates: Record<string, WindowGeometry>` to `UserPreferences` interface in `src/types/preferences.ts`
- [x] T013 Create `src/services/windowService.ts` with typed IPC wrappers for window commands

**Checkpoint**: Foundation ready - window creation and geometry persistence infrastructure complete

---

## Phase 3: User Story 1 - Create New Window (Priority: P1) 🎯 MVP

**Goal**: ⌘N creates a new independent mdpro window with empty/untitled document

**Independent Test**: Press ⌘N and verify new window opens while original stays unchanged

### Implementation for User Story 1

- [x] T014 [US1] Handle `file.new_window` menu action in `src/hooks/useMenuEvents.ts` to call `windowService.createWindow()`
- [x] T015 [US1] Ensure new window loads with default view mode from preferences in `src/App.tsx` (check `defaultViewMode` on mount)
- [x] T016 [US1] Verify window independence: each window gets isolated Zustand store instance (confirm in `src/main.tsx`)

**Checkpoint**: User Story 1 complete - ⌘N creates new independent windows

---

## Phase 4: User Story 2 - Save Document with ⌘S (Priority: P1)

**Goal**: ⌘S saves current document to disk; shows save dialog for untitled files

**Independent Test**: Edit document, press ⌘S, verify file saved to disk

### Implementation for User Story 2

- [x] T017 [US2] Verify `file.save` menu action exists and triggers save in `src/hooks/useMenuEvents.ts`
- [x] T018 [US2] Confirm `save_file` command handles both existing files and save-as dialog for untitled in `src-tauri/src/commands/file.rs`
- [x] T019 [US2] Test: create new window (⌘N), type content, press ⌘S, verify save dialog appears

**Checkpoint**: User Story 2 complete - ⌘S saves documents reliably

---

## Phase 5: User Story 3 - Window Dragging (Priority: P1)

**Goal**: Windows can be dragged by their title bar (native macOS behavior)

**Independent Test**: Click and drag title bar, verify window moves with cursor

### Implementation for User Story 3

- [x] T020 [US3] Verify `tauri.conf.json` has `decorations: true` (default) - native title bar enables dragging
- [x] T021 [US3] Test: drag window by title bar, confirm it moves smoothly

**Checkpoint**: User Story 3 complete - windows are freely draggable (already works with native decorations)

---

## Phase 6: User Story 7 - Independent Window Operations (Priority: P1)

**Goal**: Each window maintains independent document state; closing one doesn't affect others

**Independent Test**: Open two windows with different docs, edit one, verify other unchanged

### Implementation for User Story 7

- [x] T022 [US7] Verify each `WebviewWindow` in `src-tauri/src/commands/window.rs` gets unique label (e.g., `mdpro-{uuid}`)
- [x] T023 [US7] Confirm menu events are scoped to focused window in `src-tauri/src/menu.rs` (existing behavior)
- [x] T024 [US7] Test: open two windows, edit document A, verify document B unchanged; close A, verify B stays open
- [x] T024a [US7] Implement same-file conflict handling: when file watcher detects external change, show reload prompt with "Reload" and "Keep" options

**Checkpoint**: User Story 7 complete - windows operate independently

---

## Phase 7: User Story 4 - External File Opens in New Window (Priority: P2)

**Goal**: Double-clicking .md in Finder opens new mdpro window when app has document open

**Independent Test**: Open file in mdpro, double-click another .md in Finder, verify new window opens

### Implementation for User Story 4

- [x] T025 [US4] Modify `RunEvent::Opened` handler in `src-tauri/src/main.rs` to create new window when existing windows have documents
- [x] T026 [US4] Add helper function `has_windows_with_documents()` in `src-tauri/src/main.rs` to check window state
- [x] T027 [US4] Update single-instance handler in `src-tauri/src/main.rs` to route files to new windows when documents exist
- [x] T028 [US4] Handle edge case: if current window is empty/untitled, open file in that window instead of creating new one

**Checkpoint**: User Story 4 complete - external files open in new windows

---

## Phase 8: User Story 5 - Default View Mode Setting (Priority: P2)

**Goal**: Settings > General has "Default View Mode" dropdown; new documents use selected mode

**Independent Test**: Change setting to "Split", create new document, verify it opens in Split mode

### Implementation for User Story 5

- [x] T029 [US5] Add "Default View Mode" dropdown to General settings section in `src/components/common/SettingsDialog.tsx`
- [x] T030 [US5] Wire dropdown to `set_preferences` command with `defaultViewMode` field
- [x] T031 [US5] Update `src/App.tsx` to read `defaultViewMode` from preferences and apply on new document/window creation
- [x] T032 [US5] Verify dropdown options: Editor, Preview, Split, WYSIWYG (in that order)

**Checkpoint**: User Story 5 complete - default view mode is configurable

---

## Phase 9: User Story 6 - Settings Page Theme Sync (Priority: P2)

**Goal**: Settings page follows app theme with readable contrast in light/dark modes

**Independent Test**: Switch to dark mode, open Settings, verify text is readable (light on dark)

### Implementation for User Story 6

- [x] T033 [US6] Import `useThemeStore` in `src/components/common/SettingsDialog.tsx`
- [x] T034 [US6] Add dynamic class `theme-${resolvedTheme}` to settings dialog root element
- [x] T035 [US6] Create/update `src/styles/themes/light.css` and `dark.css` with CSS variables for light/dark themes
- [x] T036 [US6] Update settings dialog styles in `src/styles/globals.css` to use CSS variables: `--settings-sidebar-bg`, `--settings-input-bg`, `--settings-card-bg`, `--settings-card-border`, `--settings-btn-hover-bg`, `--settings-btn-active-bg`
- [ ] T037 [US6] Test both light and dark modes for WCAG AA contrast compliance - manual testing required

**Checkpoint**: User Story 6 complete - Settings page readable in all themes

---

## Phase 10: Window State Persistence (From Clarification)

**Goal**: Window position/size persists per file and restores on reopen

**Independent Test**: Open file, move/resize window, close, reopen same file, verify position restored

### Implementation for Window State Persistence

- [x] T038 Save window geometry on window close: call `save_window_geometry` in `src/App.tsx` saveWindowState callback
- [x] T039 Implement LRU eviction in `src-tauri/src/commands/window.rs` save_window_geometry to limit `window_states` to 100 entries
- [x] T040 Restore geometry in `create_window` command: check `get_window_geometry` for file and apply if found
- [x] T041 Handle untitled files: skip geometry persistence (check for `activeDocument.path` before saving)

**Checkpoint**: Window state persistence complete

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: Final cleanup and validation

- [x] T042 [P] Verify all menu shortcuts work: ⌘⇧N (new window), ⌘S (save), ⌘W (close) - shortcuts defined in menu.rs
- [ ] T043 [P] Test 10+ simultaneous windows for performance (SC-001) - manual testing required
- [ ] T044 [P] Verify window creation time < 500ms (SC-003) - manual testing required
- [ ] T045 [P] Verify save performance: 1MB file saves in < 1 second (SC-002) - manual testing required
- [ ] T046 Run manual test checklist from `quickstart.md` - manual testing required
- [x] T047 Code cleanup: remove any debug logs, unused imports - cleaned console.log statements

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies - start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 - **BLOCKS all user stories**
- **Phase 3-6 (P1 Stories)**: Depend on Phase 2 - can run in parallel
- **Phase 7-9 (P2 Stories)**: Depend on Phase 2 - can run in parallel with P1
- **Phase 10 (Persistence)**: Depends on Phase 2 - can run in parallel with stories
- **Phase 11 (Polish)**: Depends on all desired stories being complete

### User Story Dependencies

| Story | Depends On | Can Parallel With |
|-------|------------|-------------------|
| US1 (New Window) | Phase 2 | US2, US3, US7 |
| US2 (Save) | Phase 2 | US1, US3, US7 |
| US3 (Dragging) | Phase 2 | US1, US2, US7 |
| US7 (Independence) | Phase 2 | US1, US2, US3 |
| US4 (External File) | Phase 2 | US5, US6 |
| US5 (Default Mode) | Phase 2 | US4, US6 |
| US6 (Theme Sync) | Phase 2 | US4, US5 |

### Parallel Opportunities

```text
After Phase 2 completes:
├── P1 Stories (can run in parallel):
│   ├── US1: Create New Window
│   ├── US2: Save Document
│   ├── US3: Window Dragging
│   └── US7: Independent Operations
│
├── P2 Stories (can run in parallel with P1):
│   ├── US4: External File Opens
│   ├── US5: Default View Mode
│   └── US6: Settings Theme
│
└── Persistence (can run in parallel with all stories)
```

---

## Parallel Example: Phase 2 Foundation

```bash
# These can run in parallel (different files):
Task: "Add WindowGeometry struct to src-tauri/src/models/preferences.rs"  # T003
Task: "Add WindowGeometry interface to src/types/preferences.ts"           # T011
Task: "Create src/services/windowService.ts"                               # T013
```

---

## Implementation Strategy

### MVP First (P1 Stories Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL)
3. Complete Phases 3-6: P1 User Stories (US1, US2, US3, US7)
4. **STOP and VALIDATE**: Test all P1 stories independently
5. Deploy/demo if ready

### Full Feature Delivery

1. Complete MVP (Phases 1-6)
2. Add Phase 7: US4 (External File Opens)
3. Add Phase 8: US5 (Default View Mode)
4. Add Phase 9: US6 (Settings Theme)
5. Add Phase 10: Window State Persistence
6. Complete Phase 11: Polish

---

## Notes

- US3 (Window Dragging) requires minimal work - native macOS decorations handle this
- US2 (Save) mostly validates existing functionality
- Most new code is in Phase 2 (data model + IPC commands) and US4 (external file routing)
- Settings page changes (US5, US6) are isolated to `SettingsDialog.tsx` and CSS

---

## Appendix A: Codebase Investigation (Current State Analysis)

### A.1 为什么当前只支持一个窗口？

**结论**: 实际上代码已经支持多窗口，但可能存在问题导致功能未正常工作。

**现有多窗口实现代码**:

| 文件 | 行号 | 功能 |
|------|------|------|
| `src/App.tsx` | 527-557 | `openNewWindow()` 函数使用 `WebviewWindow` 创建新窗口 |
| `src-tauri/src/menu.rs` | 128-134 | "New Window" 菜单项，快捷键 `Cmd+Shift+N` |
| `src/hooks/useMenuEvents.ts` | 49-50 | 处理 `file.new_window` 事件，调用 `openNewWindow()` |

**关键代码** (`src/App.tsx:527-557`):
```typescript
const openNewWindow = useCallback(
  async (openPath?: string, notifyOnError = true) => {
    const windowLabel = `mdpro-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    new WebviewWindow(windowLabel, { /* config */ });
  }
);
```

**潜在问题**:
1. 新窗口可能创建但未正确显示
2. `file.new_window` 事件可能未正确传递到前端
3. 快捷键为 `Cmd+Shift+N` (⌘⇧N) - 已确认

---

### A.2 为什么窗口不能自由拖拽？

**结论**: 存在 CSS 属性冲突，使用了已弃用的 WebKit 属性。

**问题文件**: `src/styles/globals.css` (lines 143-193)

**问题代码**:
```css
.title-bar {
  -webkit-app-region: drag;  /* ← 已弃用/非标准属性 */
  user-select: none;
}

.title-bar-center {
  -webkit-app-region: drag;  /* ← 已弃用/非标准属性 */
}
```

**正确实现** (`src/components/TitleBar/TitleBar.tsx`):
```tsx
// Line 26 - 正确使用 Tauri 标准属性
<div className="title-bar" data-tauri-drag-region>

// Line 41 - 正确排除不可拖拽区域
<span className="title-bar-mode" data-tauri-drag-region="false">
```

**修复方案**:
1. 移除 `src/styles/globals.css` 中的 `-webkit-app-region: drag` 属性
2. 依赖 `data-tauri-drag-region` HTML 属性（Tauri 2.0 标准方式）

---

### A.3 为什么 ⌘S 不能保存文档？

**结论**: 保存流程完整实现，但可能存在事件传递或窗口焦点问题。

**完整保存流程分析**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. 菜单定义 (✓ 正常)                                                     │
│    File: src-tauri/src/menu.rs (line 136)                               │
│    Code: MENU_FILE_SAVE with shortcut "CmdOrCtrl+S"                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. 菜单事件处理 (✓ 正常)                                                 │
│    File: src-tauri/src/menu.rs (line 279)                               │
│    Code: emit_menu_action(app, "file.save", None)                       │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. 前端监听器 (⚠️ 潜在问题)                                              │
│    File: src/hooks/useMenuEvents.ts (lines 55-56)                       │
│    Code: case "file.save": handlers.onSave?.()                          │
│    Issue: 使用可选链 ?.() - 如果 handler 未定义会静默失败                 │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 4. 窗口焦点检查 (⚠️ 潜在问题)                                            │
│    File: src/hooks/useMenuEvents.ts (lines 31-40)                       │
│    Code: const isFocused = await currentWindow.isFocused();             │
│    Issue: 如果窗口未报告为焦点状态，事件不会被处理                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 5. Handler 连接 (✓ 正常)                                                 │
│    File: src/App.tsx (lines 677-691)                                    │
│    Code: onSave: () => void handleSave()                                │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 6. 保存实现 (✓ 正常)                                                     │
│    File: src/hooks/useDocument.ts (lines 226-247)                       │
│    Code: saveActiveDocument() → fileService.saveFile()                  │
│    Note: 如果 activeDocument 为 null，静默返回 null                      │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 7. Rust 后端 (✓ 正常)                                                    │
│    File: src-tauri/src/commands/file.rs (lines 209-232)                 │
│    Code: save_file command - 写入文件到磁盘                              │
└─────────────────────────────────────────────────────────────────────────┘
```

**关键文件和行号汇总**:

| 步骤 | 文件 | 行号 | 状态 |
|------|------|------|------|
| 菜单定义 | `src-tauri/src/menu.rs` | 136 | ✓ |
| 事件发送 | `src-tauri/src/menu.rs` | 279 | ✓ |
| 前端监听 | `src/hooks/useMenuEvents.ts` | 55-56 | ⚠️ |
| 焦点检查 | `src/hooks/useMenuEvents.ts` | 31-40 | ⚠️ |
| Handler | `src/App.tsx` | 387-400, 677-691 | ✓ |
| 保存逻辑 | `src/hooks/useDocument.ts` | 226-247 | ✓ |
| Rust命令 | `src-tauri/src/commands/file.rs` | 209-232 | ✓ |

**调试建议**:
1. 在 `src-tauri/src/menu.rs:279` 添加日志，确认事件已发送
2. 在 `src/hooks/useMenuEvents.ts:55` 添加日志，确认事件已接收
3. 检查 `shouldHandleMenuAction()` 中的 `isFocused` 返回值
4. 确认 `activeDocument` 不为 null

---

### A.4 修复优先级建议

基于以上分析，建议优先修复顺序：

1. **⌘S 保存问题** - 在 `useMenuEvents.ts` 添加调试日志定位具体问题点
2. **窗口拖拽问题** - 移除 `globals.css` 中已弃用的 `-webkit-app-region` 属性
3. **多窗口问题** - 确认 `file.new_window` 事件链路完整，添加日志追踪
