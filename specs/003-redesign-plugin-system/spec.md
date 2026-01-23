# Feature Specification: Window Dragging, Multi-Window Docs, WYSIWYG Tables

**Feature Branch**: `003-redesign-plugin-system`
**Created**: 2026-01-23
**Status**: Draft
**Input**: User description: "希望鼠标左键按着app的topbar可以随意拖拽页面移动界面的位置；希望可以同时多个窗口打开不同的md文档，各个窗口互不影响；wysiwyg模式下支持渲染markdown表格语法。"

## Overview

This update improves mdpro's desktop usability and WYSIWYG parity with Markdown by adding three capabilities:

1. **Draggable topbar**: Users can drag the window by holding the left mouse button on the app's topbar.
2. **Multi-window documents**: Users can open multiple app windows, each with an independent document session.
3. **WYSIWYG table rendering**: Markdown table syntax renders as tables in WYSIWYG mode.

### Current State Analysis

- **Window dragging**: The app uses a custom topbar, but dragging does not move the window reliably.
- **Multi-window**: The app runs as a single window with tabs/documents in one session only.
- **WYSIWYG tables**: WYSIWYG mode does not render pipe-based Markdown tables.

## Visual Design

- **Topbar**: The existing topbar remains visually unchanged; only drag behavior is added.
- **Window management**: Add a "New Window" entry in the app menu and allow opening files into a new window.
- **WYSIWYG tables**: Tables should match Markdown preview styling and be readable/editable.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Drag Window from Topbar (Priority: P1)

As a user, I want to drag the app window by holding the left mouse button on the topbar so I can reposition the window quickly.

**Independent Test**: Click and drag on the topbar area moves the window without selecting text or interacting with controls.

**Acceptance Scenarios**:

1. **Given** the app is running, **When** the user drags the topbar, **Then** the window moves on screen.
2. **Given** the topbar has interactive elements (buttons/menus), **When** the user clicks them, **Then** those actions trigger and do not start dragging.
3. **Given** the user drags from any non-interactive topbar region, **When** dragging, **Then** the cursor does not select content underneath.

---

### User Story 2 - Open Multiple Independent Windows (Priority: P1)

As a user, I want to open multiple app windows so I can work on different Markdown documents side-by-side without them affecting each other.

**Independent Test**: Open two windows with different files; edits, view mode, and sidebar state are independent.

**Acceptance Scenarios**:

1. **Given** the app is open, **When** the user chooses "New Window", **Then** a new window opens with a fresh session.
2. **Given** two windows are open with different documents, **When** the user edits one document, **Then** the other window remains unchanged.
3. **Given** window A has unsaved changes, **When** window B is closed, **Then** window A remains open and unaffected.
4. **Given** the same file is opened in two windows, **When** one window saves, **Then** the other window detects the file change and shows the existing reload prompt behavior.

---

### User Story 3 - WYSIWYG Table Rendering (Priority: P1)

As a user, I want Markdown table syntax to render as tables in WYSIWYG mode so the editing experience matches the preview.

**Independent Test**: A Markdown document containing a pipe table renders as a table in WYSIWYG mode.

**Acceptance Scenarios**:

1. **Given** a document with a standard Markdown table, **When** switching to WYSIWYG mode, **Then** the table renders with rows and columns.
2. **Given** a table in WYSIWYG mode, **When** the user edits cell text, **Then** changes persist in the underlying Markdown.
3. **Given** a document without tables, **When** switching to WYSIWYG, **Then** rendering is unchanged and no errors occur.

---

### Edge Cases

- Dragging should not interfere with double-click selection or topbar buttons.
- New window should open even when no document is currently loaded.
- Opening many windows should not corrupt shared preferences (recent files, theme, shortcuts).
- When the same file is open in multiple windows, existing file watcher conflict resolution should still apply.
- Table rendering should handle alignment markers (`:---`, `---:`) and empty cells gracefully.

## Requirements *(mandatory)*

### Functional Requirements

**Window Dragging**

- **FR-001**: The topbar MUST define a draggable region that moves the window on macOS.
- **FR-002**: Interactive controls inside the topbar MUST remain clickable and not start dragging.
- **FR-003**: Dragging MUST not interfere with editor interactions below the topbar.

**Multi-Window**

- **FR-010**: The app MUST provide a "New Window" action to open a new window.
- **FR-011**: Each window MUST maintain its own document session state (active doc, view mode, sidebar state).
- **FR-012**: Closing one window MUST NOT close or reset other windows.
- **FR-013**: Opening a file in a new window MUST load that file without affecting other windows.
- **FR-014**: Window titles MUST reflect the active document in each window.

**WYSIWYG Tables**

- **FR-020**: WYSIWYG mode MUST render Markdown table syntax as tables.
- **FR-021**: Edits made inside a WYSIWYG table MUST persist in the Markdown source.
- **FR-022**: Table rendering MUST support basic alignment markers and header rows.

### Key Entities

- **Window Session**: A single app window with its own editor state and active document.
- **Window Manager**: Frontend logic that creates new windows and routes open-file actions.
- **Table Renderer**: WYSIWYG plugin/preset that enables Markdown table support.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can drag the window from the topbar on macOS in all view modes.
- **SC-002**: Two or more windows can be open simultaneously with independent state.
- **SC-003**: A Markdown table displays correctly in WYSIWYG mode and edits persist.
- **SC-004**: No regression to existing file watcher reload prompts when the same file is open in multiple windows.

## Assumptions

- Tauri multi-window APIs are available and supported in the current build.
- The custom topbar remains in use; no native titlebar swap is required.
- WYSIWYG mode continues to be powered by Milkdown.

## Out of Scope

- Collaborative real-time syncing across windows.
- Cross-window undo/redo.
- Table editing UI beyond basic text editing (e.g., add/remove row buttons).
- Windows on other OS platforms beyond current macOS target.

## Implementation Approach (High-Level)

1. Mark the topbar as a drag region while preserving interactive elements.
2. Add window creation flow and per-window initialization behavior.
3. Enable GFM table support in Milkdown WYSIWYG mode and ensure Markdown round-trip.
