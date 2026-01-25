# Feature Specification: Multi-Window Support & UI Improvements

**Feature Branch**: `004-minor-fix`
**Created**: 2026-01-25
**Status**: Draft
**Input**: User description: "添加同时多个窗口打开多个文档的功能，目前只能同时开一个窗口。我希望command+n之后会新开一个窗口，每个窗口对不同文档的操作互相独立。一个窗口中操作文档，按下command+s之后，保存文档到存储盘。每个窗口支持在Mac上自由拖拽。当我在窗口中打开一个md文档，然后在Finder中双击打开另一个md文档，默认新开一个mdpro窗口打开新文档。在Settings中General菜单增加默认打开模式设置。Setting page的主题要跟随mdpro主界面主题。"

## Overview

This feature adds multi-window support to mdpro, allowing users to work on multiple documents simultaneously in independent windows. Each window operates independently, supporting native macOS window behaviors including dragging, keyboard shortcuts (⌘N, ⌘S), and proper file association handling. Additionally, the Settings page will receive theme improvements and a new "Default View Mode" setting.

## Visual Design

- **Wireframe Diagram**: [wireframe.html](./diagrams/wireframe.html) - 界面布局线框图
- **Site Diagram**: [site-diagram.html](./diagrams/site-diagram.html) - 应用架构和数据流图

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create New Window (Priority: P1)

As a user, I want to press ⌘⇧N to create a new mdpro window so that I can work on multiple documents simultaneously without losing context in my current window.

**Why this priority**: Multi-window is the core feature that enables all other window-related functionality. Without this, users cannot work on multiple documents at once.

**Independent Test**: Can be fully tested by pressing ⌘⇧N and verifying a new empty window opens while the original window remains unchanged.

**Acceptance Scenarios**:

1. **Given** an mdpro window is open with a document, **When** user presses ⌘⇧N, **Then** a new mdpro window opens with an empty/untitled document
2. **Given** an mdpro window is open, **When** user presses ⌘⇧N, **Then** the original window remains unaffected and retains its document state
3. **Given** no mdpro window is open, **When** user launches mdpro, **Then** a single new window opens (existing behavior preserved)

---

### User Story 2 - Save Document with ⌘S (Priority: P1)

As a user, I want to press ⌘S to save my document to disk so that my changes are persisted immediately.

**Why this priority**: Saving is a fundamental operation that users expect to work reliably. This ensures data is not lost.

**Independent Test**: Can be fully tested by editing a document, pressing ⌘S, and verifying the file on disk contains the changes.

**Acceptance Scenarios**:

1. **Given** a window has an existing file open with unsaved changes, **When** user presses ⌘S, **Then** the file is saved to its original location on disk
2. **Given** a window has a new untitled document, **When** user presses ⌘S, **Then** a save dialog appears to let user choose location and filename
3. **Given** a document was just saved, **When** user presses ⌘S again without changes, **Then** no action is taken (or file is re-saved with same content)

---

### User Story 3 - Window Dragging (Priority: P1)

As a user, I want to drag windows by their title bar so that I can arrange my workspace on macOS.

**Why this priority**: This is standard macOS window behavior that users expect. Without it, the app feels broken.

**Independent Test**: Can be fully tested by clicking and dragging the window title bar and verifying the window moves with the cursor.

**Acceptance Scenarios**:

1. **Given** an mdpro window is visible, **When** user clicks and holds on the title bar area, **Then** the cursor changes to indicate dragging is possible
2. **Given** user is holding click on title bar, **When** user moves the mouse, **Then** the window follows the cursor movement
3. **Given** user is dragging a window, **When** user releases the mouse button, **Then** the window stays at its new position

---

### User Story 4 - External File Opens in New Window (Priority: P2)

As a user, when I have mdpro open and double-click a .md file in Finder, I want it to open in a new mdpro window so that my current work is not disrupted.

**Why this priority**: This improves workflow when managing multiple documents but requires the multi-window foundation from P1 stories.

**Independent Test**: Can be fully tested by opening a file in mdpro, then double-clicking a different .md file in Finder, and verifying both windows are open with their respective documents.

**Acceptance Scenarios**:

1. **Given** mdpro is running with a document open, **When** user double-clicks a different .md file in Finder, **Then** a new mdpro window opens with that file
2. **Given** mdpro is running with an empty window, **When** user double-clicks a .md file in Finder, **Then** that file opens in the existing empty window (optimization)
3. **Given** mdpro is not running, **When** user double-clicks a .md file in Finder, **Then** mdpro launches and opens that file in a new window

---

### User Story 5 - Default View Mode Setting (Priority: P2)

As a user, I want to configure which view mode (Editor, Preview, Split, WYSIWYG) new documents open in, so that I can customize my editing experience.

**Why this priority**: This is a quality-of-life improvement that enhances user experience but is not blocking core functionality.

**Independent Test**: Can be fully tested by changing the setting in Settings > General, creating a new document, and verifying it opens in the selected view mode.

**Acceptance Scenarios**:

1. **Given** user opens Settings > General, **When** viewing the settings panel, **Then** a "Default View Mode" option is visible with four choices: Editor, Preview, Split, WYSIWYG
2. **Given** user sets "Default View Mode" to "Split", **When** user creates a new document (⌘N or File > New), **Then** the new document opens in Split view mode
3. **Given** user sets "Default View Mode" to "WYSIWYG", **When** user opens a file from Finder, **Then** the file opens in WYSIWYG view mode
4. **Given** no preference has been set, **When** user creates a new document, **Then** the document opens in WYSIWYG mode (default)

---

### User Story 6 - Settings Page Theme Sync (Priority: P2)

As a user, I want the Settings page to follow the main application theme so that text is readable and the UI is visually consistent.

**Why this priority**: The current settings page has poor contrast making it difficult to read (as shown in screenshot). This is a usability bug fix.

**Independent Test**: Can be fully tested by switching themes in the main app and verifying the Settings page updates its colors accordingly.

**Acceptance Scenarios**:

1. **Given** the app is in dark mode, **When** user opens Settings, **Then** the Settings page displays with dark background and light text (readable contrast)
2. **Given** the app is in light mode, **When** user opens Settings, **Then** the Settings page displays with light background and dark text (readable contrast)
3. **Given** the Settings page is open, **When** user switches theme in main app, **Then** the Settings page theme updates to match
4. **Given** settings page in any theme, **When** user views any settings panel, **Then** all text labels, input fields, and buttons have sufficient contrast (WCAG AA compliant)

---

### User Story 7 - Independent Window Operations (Priority: P1)

As a user, I want each window to operate independently so that actions in one window do not affect documents in other windows.

**Why this priority**: This is essential for multi-window to be useful. Windows must be isolated to prevent data loss or confusion.

**Independent Test**: Can be fully tested by opening two windows with different documents, editing one, and verifying the other remains unchanged.

**Acceptance Scenarios**:

1. **Given** two windows are open with different documents, **When** user edits document in window A, **Then** document in window B remains unchanged
2. **Given** two windows are open, **When** user closes window A, **Then** window B remains open and functional
3. **Given** two windows have the same file open, **When** user edits in window A and saves, **Then** window B shows a reload prompt dialog with options: "Reload" (discard local changes, load saved version) or "Keep" (keep local changes, mark as modified)

---

### Edge Cases

- What happens when user opens the same file in two different windows? Both windows open the file independently. When one window saves, other windows with the same file receive a reload prompt via the existing file watcher mechanism.
- What happens when user tries to save to a read-only location? A clear error message should be displayed.
- What happens when external app modifies a file while it's open in mdpro? The existing file watcher should prompt for reload.
- What happens when all windows are closed? The app quits (standard macOS behavior).
- What happens when user drags window to screen edge? Standard macOS window management (snap/tiling in Sequoia+) should work.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support creating multiple independent windows via ⌘⇧N keyboard shortcut
- **FR-002**: System MUST save the current document to disk when user presses ⌘S
- **FR-003**: System MUST show a save dialog for untitled documents when user presses ⌘S
- **FR-004**: Each window MUST be draggable by clicking and dragging the title bar area
- **FR-005**: System MUST open files from Finder in a new window when mdpro is already running with a document
- **FR-006**: System MUST provide a "Default View Mode" setting in Settings > General with options: Editor, Preview, Split, WYSIWYG
- **FR-007**: New documents and opened files MUST use the configured default view mode
- **FR-008**: Settings page MUST inherit and display the current application theme (light/dark)
- **FR-009**: Settings page MUST have readable text contrast in both light and dark themes
- **FR-010**: Each window MUST maintain independent document state (content, cursor position, view mode)
- **FR-011**: Closing one window MUST NOT affect other open windows
- **FR-012**: System MUST persist each window's position and size, restoring them when the same file is reopened

### Key Entities

- **Window**: Represents an mdpro application window. Contains one document, has independent state (position, size, view mode), responds to its own menu events. Position and size are persisted per-file and restored on reopen.
- **Document**: The markdown file content within a window. Has path (or null for untitled), content, modified flag, encoding.
- **Preferences**: User settings including the new "defaultViewMode" field (enum: editor, preview, split, wysiwyg).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can have at least 10 windows open simultaneously without noticeable performance degradation
- **SC-002**: ⌘S saves a 1MB document to disk in under 1 second
- **SC-003**: New windows appear within 500ms of pressing ⌘⇧N
- **SC-004**: Window dragging feels responsive with no visible lag (follows cursor in real-time)
- **SC-005**: 100% of users can read all text in Settings page in both light and dark themes (sufficient contrast)
- **SC-006**: Files opened from Finder open in a new window 100% of the time when mdpro already has a document open
- **SC-007**: Default view mode setting is correctly applied to new documents 100% of the time

## Clarifications

### Session 2026-01-25

- Q: When a user repositions or resizes windows, should the app remember these settings? → A: Remember per-window (each window position/size persists across app restarts)

## Assumptions

- Window dragging is provided by the native macOS window chrome. Tauri windows with default decorations support this natively.
- The default view mode when no preference is set will be **WYSIWYG** (closest to Typora experience).
- When opening the same file in multiple windows, each window operates on its own in-memory copy; **last save wins** - when one window saves, other windows detect the change via file watcher and prompt to reload.
- When all windows are closed, the **app quits** (standard macOS behavior).
- The Settings page is a React component that can access the theme store to apply appropriate styles.
