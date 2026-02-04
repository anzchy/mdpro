# Feature Specification: TOC Sidebar, Multi-Tab Support, and Editor Enhancements

**Feature Branch**: `006-toc-tab-and-new-features`
**Created**: 2026-02-02
**Status**: Draft
**Input**: User description: "TOC sidebar toggle, multi-tab document support, auto-save improvements, table rendering with alignment and context menus, image rendering with upload settings"

## Overview

This feature bundle enhances mdpro with five key improvements: (1) a Table of Contents (TOC) view in the sidebar toggled via Command+Shift+B, (2) multi-tab support allowing users to open multiple documents in a single window, (3) streamlined auto-save behavior without dialogs, (4) full HTML table rendering with cell alignment controls and right-click editing, and (5) image rendering support across all view modes with upload capabilities. These enhancements bring mdpro closer to feature parity with established Markdown editors like Typora.

## Visual Design

- **Wireframe Diagram**: [wireframe.html](./diagrams/wireframe.html) - 界面布局线框图
- **Site Diagram**: [site-diagram.html](./diagrams/site-diagram.html) - 应用架构和数据流图
- **User Flow Diagram**: [user-flow.html](./diagrams/user-flow.html) - 用户旅程流程图

## User Scenarios & Testing *(mandatory)*

### User Story 1 - TOC Navigation (Priority: P1)

As a user working with long documents, I want to quickly navigate between sections using a Table of Contents view in the sidebar, so I can efficiently move through my document structure.

**Why this priority**: TOC navigation is fundamental for document editing productivity. Long-form content becomes unmanageable without quick section jumping. This is a core editor feature that users expect.

**Independent Test**: Can be fully tested by opening any Markdown document with headers, pressing Command+Shift+B, and verifying the TOC displays and clicking entries navigates to the correct section.

**Acceptance Scenarios**:

1. **Given** a document with multiple headings (H1-H6), **When** I press Command+Shift+B, **Then** the sidebar displays a hierarchical Table of Contents with all headings
2. **Given** the TOC is visible, **When** I click on a heading entry, **Then** the editor scrolls to and focuses that heading in the document
3. **Given** the TOC is visible, **When** I press Command+Shift+B again, **Then** the sidebar returns to showing the filename/file list view
4. **Given** I edit the document and add/remove/modify headings, **When** I view the TOC, **Then** the TOC updates to reflect the current document structure

---

### User Story 2 - Multi-Tab Document Editing (Priority: P1)

As a user working on multiple related documents, I want to open multiple Markdown files as tabs within the same window, so I can quickly switch between them without managing separate windows.

**Why this priority**: Multi-document workflows are essential for technical writing, documentation, and note-taking. This enables mdpro to serve as a primary editor rather than auxiliary tool.

**Independent Test**: Can be fully tested by clicking the "+" button, opening files in tabs, switching between tabs, and closing tabs - verifying document state is preserved.

**Acceptance Scenarios**:

1. **Given** the application is open with one document, **When** I click the "+" button, **Then** a new empty Markdown document opens in a new tab within the same window
2. **Given** multiple tabs are open, **When** I click on a tab, **Then** that document becomes active and the editor displays its content
3. **Given** multiple tabs are open with unsaved changes, **When** I close a tab with unsaved changes, **Then** the system prompts me to save, discard, or cancel
4. **Given** the tab bar is visible, **When** I check Settings → General, **Then** I can configure the tab bar position (top or bottom of the interface)

---

### User Story 3 - Streamlined Auto-Save (Priority: P2)

As a user who frequently saves documents, I want Command+S to silently save without dialogs, and I want periodic auto-save, so I can focus on writing without interruption.

**Why this priority**: Reducing friction in the save workflow improves writing flow. Auto-save prevents data loss. This is a quality-of-life improvement that builds on existing save functionality.

**Independent Test**: Can be fully tested by pressing Command+S on a saved document and verifying no dialog appears, then configuring auto-save intervals and verifying documents save automatically.

**Acceptance Scenarios**:

1. **Given** a document that has been saved before (has a file path), **When** I press Command+S, **Then** the document saves silently without showing any dialog
2. **Given** a new document that has never been saved, **When** I press Command+S, **Then** a Save As dialog appears to let me choose the file location
3. **Given** the document has external changes, **When** the system detects the conflict, **Then** it displays "Reload" or "Restore" options (reload from disk or restore editor content)
4. **Given** Settings → General is open, **When** I view auto-save options, **Then** I can select an auto-save interval from options (5s, 15s, 60s, or disabled)
5. **Given** auto-save is enabled with a 15-second interval, **When** I make changes and wait 15 seconds, **Then** the document auto-saves without user interaction

---

### User Story 4 - Table Rendering and Editing (Priority: P2)

As a user creating documentation with tables, I want Markdown tables to render as proper HTML tables with alignment controls, and I want to easily add rows/columns via right-click, so I can create professional-looking tabular content.

**Why this priority**: Tables are common in technical documentation. Rich table editing reduces the need to manually write Markdown table syntax, which is error-prone and tedious.

**Independent Test**: Can be fully tested by creating a Markdown table, viewing it in WYSIWYG/Preview/Split modes, adjusting alignment, and using right-click to add rows/columns.

**Acceptance Scenarios**:

1. **Given** a Markdown table in the document, **When** I view in WYSIWYG, Preview, or Split View mode, **Then** the table renders as a formatted HTML table
2. **Given** a rendered table, **When** I select a column, **Then** I can set alignment (left, center, right) for that column's content
3. **Given** the cursor is in a table cell, **When** I right-click, **Then** a context menu appears with options: "Insert Row Above", "Insert Row Below", "Insert Column Left", "Insert Column Right", "Delete Row", "Delete Column"
4. **Given** I select "Insert Row Below" from the context menu, **When** the action completes, **Then** a new row is added below the current row with empty cells

---

### User Story 5 - Image Rendering and Upload (Priority: P3)

As a user adding visual content to documents, I want images to render properly in all view modes and have easy access to image upload functionality, so I can create rich multimedia documents.

**Why this priority**: Image support is important for documentation but builds on the core text editing experience. This feature requires more infrastructure (Settings menu addition) and is less critical than text-focused features.

**Independent Test**: Can be fully tested by inserting a local image path, inserting a web URL, viewing in all modes, and using the Image menu to upload a new image.

**Acceptance Scenarios**:

1. **Given** a Markdown image reference `![alt](path/to/local/image.png)`, **When** I view in WYSIWYG, Preview, or Split View mode, **Then** the local image renders inline
2. **Given** a Markdown image reference `![alt](https://example.com/image.png)`, **When** I view in any rendering mode, **Then** the web image loads and renders inline
3. **Given** the Settings menu is open, **When** I look for image options, **Then** there is a top-level "Image" menu item
4. **Given** I open Settings → Image, **When** I view the options, **Then** I can configure image upload destination and behavior
5. **Given** I want to add an image, **When** I use the Image upload feature, **Then** I can select a local file and have it inserted at the cursor position

---

### Edge Cases

- What happens when the document has no headings? → TOC shows "No headings found" message
- What happens when an image path is invalid or file is missing? → Shows placeholder with error indicator and path
- What happens when a web image fails to load (network error, 404)? → Shows placeholder with error message
- What happens when user tries to close the last tab? → Closes the window entirely (same as current single-document behavior)
- What happens when auto-save interval triggers during active typing? → Waits for a pause in typing (debounce) before saving
- What happens with very large tables (100+ rows)? → Renders with virtual scrolling or pagination to maintain performance

## Requirements *(mandatory)*

### Functional Requirements

**TOC Sidebar:**
- **FR-001**: System MUST display a hierarchical Table of Contents in the sidebar when toggled via Command+Shift+B
- **FR-002**: System MUST parse all heading levels (H1-H6) from the current document for TOC display
- **FR-003**: System MUST navigate to the corresponding heading position when a TOC entry is clicked
- **FR-004**: System MUST update the TOC in real-time as the document is edited

**Multi-Tab Support:**
- **FR-005**: System MUST support opening multiple documents as tabs within a single application window
- **FR-006**: System MUST create a new empty document when the "+" button is clicked
- **FR-007**: System MUST preserve document state (content, cursor position, scroll position) when switching between tabs
- **FR-008**: System MUST prompt to save unsaved changes when closing a tab with modifications
- **FR-009**: Users MUST be able to configure tab bar position (top or bottom) in Settings → General

**Auto-Save:**
- **FR-010**: System MUST save documents silently (no dialog) when Command+S is pressed on previously-saved files
- **FR-011**: System MUST show Save As dialog for new, never-saved documents
- **FR-012**: System MUST provide "Reload" and "Restore" options when external file changes are detected
- **FR-013**: Users MUST be able to configure auto-save interval (5s, 15s, 60s, disabled) in Settings → General
- **FR-014**: System MUST implement debounced auto-save that waits for typing pause before saving

**Table Rendering:**
- **FR-015**: System MUST render Markdown tables as HTML tables in WYSIWYG, Preview, and Split View modes
- **FR-016**: System MUST support column alignment settings (left, center, right) that persist in Markdown syntax
- **FR-017**: System MUST provide right-click context menu for table editing with row/column operations

**Image Rendering:**
- **FR-018**: System MUST render local images inline when file path is valid
- **FR-019**: System MUST render web images inline with proper network loading
- **FR-020**: System MUST display error placeholders for missing/failed images
- **FR-021**: System MUST add a top-level "Image" menu in Settings for image-related configuration
- **FR-022**: Users MUST be able to upload and insert images via the Image settings

### Key Entities

- **Tab**: Represents an open document in the tab bar; contains document reference, dirty state, display title
- **TOCEntry**: Represents a heading in the Table of Contents; contains heading level, text, document position
- **AutoSaveConfig**: Stores user's auto-save preferences; contains interval setting, enabled state
- **TableCell**: Represents a cell in a rendered table; contains content, row/column index, alignment
- **ImageReference**: Represents an image in the document; contains path (local or URL), alt text, loading state

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can navigate to any document section via TOC in under 2 seconds
- **SC-002**: Users can open and switch between 10+ document tabs without noticeable performance degradation
- **SC-003**: Documents auto-save within the configured interval with 100% reliability (no data loss)
- **SC-004**: Tables with up to 50 rows render and respond to edits in under 500ms
- **SC-005**: Local images render immediately upon document load; web images begin loading within 100ms
- **SC-006**: New features follow established macOS HIG patterns and existing mdpro UI conventions (verifiable via design review checklist)
- **SC-007**: Right-click table operations complete in under 200ms perceived time

## Assumptions

- Users are familiar with standard Markdown table syntax (pipes and dashes)
- Local image paths are relative to the document location or absolute paths
- Web images are accessed via HTTPS and the system has network connectivity
- Tab bar follows platform conventions for macOS (similar to Safari/Chrome tab behavior)
- The existing Settings infrastructure can accommodate new General and Image sections
- pulldown-cmark (Rust) supports table extensions for proper parsing
