# Tasks: Polish WYSIWYG Editor

**Feature**: 002-polish-wysiwyg | **Generated**: 2026-01-19 | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## User Stories (from spec.md)

| ID | Story | Priority | Independent Test |
|----|-------|----------|------------------|
| US1 | View Mode Switching & Cycling | P1 | Press ⌘/ to cycle, ⌃1-4 for direct access |
| US2 | Preview Mode Shows Rendered Output | P2 | Switch to Preview (⌃3), verify read-only HTML |
| US3 | True WYSIWYG Editing with Milkdown | P3 | Type `# Hello` in WYSIWYG, verify heading renders |
| US4 | Typora-style Inline Editing | P4 | Click inside link to see `[text](url)`, click away to collapse |
| US5 | Content Layout Constraints | P5 | Resize window, verify 780pt max-width and 40pt min margins |

---

## Phase 1: Setup

**Goal**: Install dependencies and prepare project structure for feature implementation.

- [✅] T001 Install Milkdown dependencies: `pnpm add @milkdown/kit @milkdown/react`
- [✅] T002 Verify build succeeds: `pnpm tauri dev` launches without errors
- [✅] T003 Create placeholder file at `src/components/Editor/MilkdownEditor.tsx`
- [✅] T004 Create placeholder file at `src/hooks/useMilkdown.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Goal**: Implement shared infrastructure needed by all user stories.

- [✅] T005 Add `cycleViewMode()` method to `src/stores/editorStore.ts` implementing cycle order: Split → Editor → Preview → WYSIWYG → Split
- [✅] T006 [P] Add `lastViewMode` field to Rust Preferences struct in `src-tauri/src/models/preferences.rs`
- [✅] T007 [P] Update `get_preferences` and `save_preferences` commands in `src-tauri/src/commands/preferences.rs` to handle lastViewMode
- [✅] T008 Add preferences loading on app mount in `src/App.tsx` to restore lastViewMode
- [✅] T009 Add preferences saving when viewMode changes in `src/App.tsx`

---

## Phase 3: User Story 1 - View Mode Switching & Cycling (P1)

**Goal**: Enable keyboard shortcuts to switch and cycle through all four view modes.

**Independent Test**: Press ⌘/ repeatedly to cycle through Split → Editor → Preview → WYSIWYG → Split. Use ⌃1-4 for direct access to any mode.

### Frontend Implementation

- [✅] T010 [US1] Update `src/hooks/useKeyboardShortcuts.ts` to add ⌘/ handler calling `cycleViewMode()`
- [✅] T011 [US1] Update `src/hooks/useMenuEvents.ts` to handle `set-view-mode` action for ⌃1-4
- [✅] T012 [US1] Update `src/hooks/useMenuEvents.ts` to handle `cycle-view-mode` action for ⌘/

### Backend Implementation

- [✅] T013 [US1] Update View menu in `src-tauri/src/menu.rs`: change shortcuts from ⌘1-4 to ⌃1-4
- [✅] T014 [US1] Add "Cycle View Mode" menu item with ⌘/ shortcut in `src-tauri/src/menu.rs`
- [✅] T015 [US1] Update menu event handler in `src-tauri/src/menu.rs` to emit `set-view-mode` with correct values
- [✅] T016 [US1] Update menu event handler in `src-tauri/src/menu.rs` to emit `cycle-view-mode` action

### Verification

- [ ] T017 [US1] Manual test: Verify ⌘/ cycles through all four modes in correct order
- [ ] T018 [US1] Manual test: Verify ⌃1 switches to Split, ⌃2 to Editor, ⌃3 to Preview, ⌃4 to WYSIWYG
- [ ] T019 [US1] Manual test: Verify rapid repeated shortcuts execute smoothly without lag

---

## Phase 4: User Story 2 - Preview Mode Shows Rendered Output (P2)

**Goal**: Fix Preview mode to show read-only rendered HTML instead of WYSIWYG editor.

**Independent Test**: Switch to Preview mode (⌃3), verify content displays as rendered HTML matching Split view right pane, and is not editable.

### Implementation

- [✅] T020 [US2] Update `src/components/Editor/SplitView.tsx` to route `preview-only` mode to use `Preview` component (full-width)
- [✅] T021 [US2] Ensure Preview component in `src/components/Preview/Preview.tsx` is used for preview-only mode with read-only HTML rendering
- [✅] T022 [US2] Update `src/App.tsx` view mode routing to render Preview component for `preview-only` mode

### Verification

- [ ] T023 [US2] Manual test: Verify preview-only mode shows rendered HTML (headings, lists, code blocks formatted)
- [ ] T024 [US2] Manual test: Verify clicking on preview content does not show cursor or allow editing
- [ ] T025 [US2] Manual test: Verify preview rendering matches Split view right pane exactly

---

## Phase 5: User Story 3 - True WYSIWYG Editing with Milkdown (P3)

**Goal**: Replace CodeMirror-based WYSIWYG with Milkdown for true rich-text Markdown editing.

**Independent Test**: Switch to WYSIWYG mode (⌃4), type `# Hello` and verify it transforms into a heading with hidden hash. Switch to Editor mode (⌃2) and verify Markdown is preserved.

### Core Milkdown Component

- [✅] T026 [US3] Implement `useMilkdown.ts` hook in `src/hooks/useMilkdown.ts` with Milkdown editor initialization
- [✅] T027 [US3] Implement `MilkdownEditor.tsx` in `src/components/Editor/MilkdownEditor.tsx` using MilkdownProvider and useEditor
- [✅] T028 [US3] Configure Milkdown with commonmark, history, and listener plugins in `MilkdownEditor.tsx`
- [✅] T029 [US3] Connect Milkdown to Zustand documentStore for content read/write in `MilkdownEditor.tsx`

### Data Synchronization

- [✅] T030 [US3] Implement lazy serialization: sync Markdown to store when leaving WYSIWYG mode in `src/App.tsx`
- [✅] T031 [US3] Implement lazy parsing: load Markdown into Milkdown when entering WYSIWYG mode in `MilkdownEditor.tsx`

### Large Document Handling

- [✅] T032 [US3] Add document size check (>500KB) before entering WYSIWYG mode in `src/App.tsx`
- [✅] T033 [US3] Implement toast notification when auto-switching to Editor mode for large documents

### Keyboard Shortcuts (Typora-style)

- [✅] T034 [US3] Configure Milkdown keymaps for ⌘1-6 (H1-H6) and ⌘0 (paragraph) in `MilkdownEditor.tsx`
- [✅] T035 [US3] Configure Milkdown keymaps for ⌘B (bold), ⌘I (italic), ⌘K (link) in `MilkdownEditor.tsx`

### Integration

- [✅] T036 [US3] Update `src/App.tsx` to route `wysiwyg` mode to MilkdownEditor component
- [✅] T037 [US3] Remove old `src/components/Editor/WysiwygView.tsx` file (replaced by MilkdownEditor)

### Verification

- [ ] T038 [US3] Manual test: Verify typing `# Hello` in WYSIWYG mode creates heading with hidden hash
- [ ] T039 [US3] Manual test: Verify typing `**bold**` displays as bold with hidden asterisks
- [ ] T040 [US3] Manual test: Verify typing `- item` creates bullet list
- [ ] T041 [US3] Manual test: Verify switching WYSIWYG → Editor preserves Markdown correctly
- [ ] T042 [US3] Manual test: Verify ⌘1-6 creates headings, ⌘0 reverts to paragraph
- [ ] T043 [US3] Manual test: Verify ⌘B, ⌘I, ⌘K work for formatting
- [ ] T044 [US3] Manual test: Verify documents >500KB auto-switch to Editor with toast

---

## Phase 6: Polish & Cross-Cutting Concerns

**Goal**: Finalize implementation, clean up, and verify all acceptance criteria.

### Menu State Sync

- [✅] T045 Update native menu bar to show checkmark on current view mode in `src-tauri/src/menu.rs`

### Editor Mode Heading Shortcuts

- [✅] T046 Add ⌘1-6, ⌘0 heading shortcuts and ⌘K link shortcut to CodeMirror editor in `src/hooks/useKeyboardShortcuts.ts` (per FR-014)

### Final Cleanup

- [✅] T047 Remove any unused imports from modified files
- [✅] T048 Verify all TypeScript types are correct (run `pnpm build`)

### Integration Verification

- [ ] T049 Manual test: Full round-trip - create document, edit in all 4 modes, save, reopen, verify content
- [ ] T050 Manual test: Verify lastViewMode is persisted and restored on app relaunch

---

## Phase 7: User Story 4 - Typora-style Inline Editing (P4)

**Goal**: Implement cursor-aware inline element expansion for links and inline code, providing Typora-like editing experience.

**Independent Test**: In WYSIWYG mode, click inside a rendered link to see `[text](url)`. Click inside inline code to see backticks. Move cursor away to collapse back to rendered form.

**Technical Approach**: Use ProseMirror's NodeView API to create custom views for `link` and `inlineCode` marks that:
1. Track cursor position via `decorations` or selection state
2. Render expanded (raw Markdown) form when cursor is inside
3. Render collapsed (styled) form when cursor is outside
4. Preserve edits during collapse/expand transitions

### Custom NodeView Plugin

- [ ] T051 [US4] Create `src/components/Editor/plugins/inlineEditPlugin.ts` with ProseMirror plugin skeleton
- [ ] T052 [US4] Implement `LinkNodeView` class extending ProseMirror NodeView for link marks
- [ ] T053 [US4] Implement `InlineCodeNodeView` class for inline code marks
- [ ] T054 [US4] Add cursor position tracking using ProseMirror selection state

### Link Expansion/Collapse

- [ ] T055 [US4] Implement link expanded state: render `[text](url)` with editable text and URL
- [ ] T056 [US4] Implement link collapsed state: render styled link (blue, underlined)
- [ ] T057 [US4] Add transition logic: expand when cursor enters, collapse when cursor leaves
- [ ] T058 [US4] Handle URL editing: parse and update href attribute on collapse

### Inline Code Expansion/Collapse

- [ ] T059 [US4] Implement inline code expanded state: render `` `code` `` with visible backticks
- [ ] T060 [US4] Implement inline code collapsed state: render styled code (monospace, background)
- [ ] T061 [US4] Add transition logic: expand when cursor enters, collapse when cursor leaves
- [ ] T062 [US4] Handle content editing: preserve changes on collapse

### Integration with Milkdown

- [ ] T063 [US4] Register custom NodeView plugin with Milkdown editor in `useMilkdown.ts`
- [ ] T064 [US4] Ensure plugin works with existing Typora keymap (⌘K for links)
- [ ] T065 [US4] Add CSS styles for expanded/collapsed states in `globals.css`

### Verification

- [ ] T066 [US4] Manual test: Click inside link shows `[text](url)`, click away collapses
- [ ] T067 [US4] Manual test: Click inside inline code shows backticks, click away collapses
- [ ] T068 [US4] Manual test: Edit URL in expanded link, verify changes preserved
- [ ] T069 [US4] Manual test: Edit content in expanded inline code, verify changes preserved
- [ ] T070 [US4] Manual test: Arrow key navigation into/out of inline elements works correctly
- [ ] T071 [US4] Manual test: Multiple inline elements on same line expand independently

---

## Phase 8: User Story 5 - Content Layout Constraints (P5)

**Goal**: Implement consistent content width constraints across all view modes for improved readability.

**Independent Test**: Resize the window. Verify text content area has max-width 780pt, minimum 40pt side margins, and is centered when window is wider than 860pt.

### CSS Implementation

- [ ] T072 [US5] Add CSS variables `--content-max-width: 780px` and `--content-padding: 40px` to `:root` in `src/styles/globals.css`
- [ ] T073 [US5] Apply layout constraints to `.preview-content` (Preview mode): `max-width`, `padding-left/right`, `margin: 0 auto`
- [ ] T074 [US5] Apply layout constraints to `.milkdown-editor .ProseMirror` (WYSIWYG mode): `max-width`, `padding-left/right`, `margin: 0 auto`
- [ ] T075 [US5] Apply layout constraints to `.editor-shell .cm-content` (Editor mode): `max-width`, `padding-left/right`, `margin: 0 auto`
- [ ] T076 [US5] Ensure CodeMirror scroller background extends full width while content is constrained

### Verification

- [ ] T077 [US5] Manual test: Preview mode - verify max-width 780pt and 40pt margins
- [ ] T078 [US5] Manual test: WYSIWYG mode - verify max-width 780pt and 40pt margins
- [ ] T079 [US5] Manual test: Editor mode - verify max-width 780pt and 40pt margins
- [ ] T080 [US5] Manual test: Split view - verify both panes apply constraints independently
- [ ] T081 [US5] Manual test: Resize window narrow (<860pt) - verify 40pt margins maintained
- [ ] T082 [US5] Manual test: Resize window wide (≥860pt) - verify content centered

---

## Dependencies

```
Phase 1 (Setup)
    │
    ▼
Phase 2 (Foundational) ──────────────────────────────────────┐
    │                                                         │
    ├──────────────────┬──────────────────┬──────────────────┤
    ▼                  ▼                  ▼                  │
Phase 3 (US1)     Phase 4 (US2)     Phase 5 (US3)           │
View Cycling      Preview Fix       Milkdown                 │
    │                  │                  │                  │
    └──────────────────┴──────────────────┘                  │
                       │                                     │
                       ▼                                     │
                Phase 6 (Polish) ◀───────────────────────────┘
                       │
                       ├───────────────────┐
                       ▼                   ▼
                Phase 7 (US4)        Phase 8 (US5)
              Typora-style Inline    Content Layout
```

### Story Dependencies

| Story | Depends On | Can Start After |
|-------|------------|-----------------|
| US1 (View Cycling) | Phase 2 | T009 complete |
| US2 (Preview Fix) | Phase 2 | T009 complete |
| US3 (Milkdown) | Phase 2 | T009 complete |
| US4 (Inline Editing) | Phase 5 (US3) | T044 complete |
| US5 (Content Layout) | Phase 6 (Polish) | T050 complete |

**Note**: US1, US2, and US3 can be implemented in parallel after Phase 2 is complete. US4 depends on Milkdown being functional (US3). US5 (Content Layout) can be done independently after Phase 6, and can run in parallel with US4.

---

## Parallel Execution Opportunities

### Within Phase 2 (Foundational)
```
T006 (Rust Preferences struct) ─┬─▶ T007 (Rust commands)
                                 │
T005 (cycleViewMode)            ─┴─▶ T008-T009 (App.tsx prefs)
```

### Across User Stories (After Phase 2)
```
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│ US1: T010-T019  │   │ US2: T020-T025  │   │ US3: T026-T044  │
│ (View Cycling)  │   │ (Preview Fix)   │   │ (Milkdown)      │
└─────────────────┘   └─────────────────┘   └─────────────────┘
        │                     │                     │
        └─────────────────────┴─────────────────────┘
                              │
                              ▼
                    Phase 6: T045-T050
                              │
                              ▼
                ┌─────────────────────────┐
                │ US4: T051-T071          │
                │ (Typora-style Inline)   │
                └─────────────────────────┘
```

---

## Implementation Strategy

### MVP Scope (Recommended First Delivery)

**User Story 1 only** (T001-T019):
- View mode cycling and direct switching
- Foundational preferences persistence
- Delivers immediate usability value
- Low risk, high impact

### Incremental Delivery

1. **Increment 1**: Phase 1 + Phase 2 + US1 (View Cycling) → Testable MVP
2. **Increment 2**: US2 (Preview Fix) → Fixes UX inconsistency
3. **Increment 3**: US3 (Milkdown) → Full feature complete
4. **Increment 4**: Phase 6 (Polish) → Production ready
5. **Increment 5**: US4 (Typora-style Inline) → Premium WYSIWYG experience
6. **Increment 6**: US5 (Content Layout) → Professional reading/editing experience

---

## Task Summary

| Phase | Tasks | Parallelizable |
|-------|-------|----------------|
| Setup | 4 | 0 |
| Foundational | 5 | 2 |
| US1 (P1) | 10 | 0 |
| US2 (P2) | 6 | 0 |
| US3 (P3) | 19 | 0 |
| Polish | 6 | 0 |
| US4 (P4) | 21 | 0 |
| US5 (P5) | 11 | 0 |
| **Total** | **82** | **2** |

### Tasks by User Story

| Story | Task Count | Task Range |
|-------|------------|------------|
| US1 | 10 | T010-T019 |
| US2 | 6 | T020-T025 |
| US3 | 19 | T026-T044 |
| US4 | 21 | T051-T071 |
| US5 | 11 | T072-T082 |
