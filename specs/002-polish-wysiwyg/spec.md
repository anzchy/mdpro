# Feature Specification: Polish WYSIWYG Editor

**Feature Branch**: `002-polish-wysiwyg`
**Created**: 2026-01-19
**Status**: Draft
**Input**: User description: "创建specs/002-polish-WYSIWYG和同名的branch，spec实现的功能如下：1.目前mdpro app的Preview mode我希望是split view右边的样子。2. command + /在split view, editor view, preview，和 WYSIWYG四种模式中循环切换。3. WYSIWYG模式实现机制我不是很满意，调研一下这个开源项目:https://github.com/Milkdown/milkdown，看看其WYSIWYG实现的原理是什么，如何整合到我的项目中。"

## Clarifications

### Session 2026-01-19

- Q: When a document exceeds 500KB in WYSIWYG mode, what should happen? → A: Auto-switch to Editor mode with a toast notification explaining why
- Q: When Milkdown encounters malformed/unparseable Markdown, what should happen? → A: Render unparseable sections as plain text blocks (content preserved, editable)

## Overview

This feature enhances the mdpro Markdown editor by:

1. **Redesigning Preview Mode**: The current "preview-only" mode displays a WYSIWYG editor (WysiwygView). This should be changed to display a read-only rendered preview, consistent with the right pane of split view.

2. **Implementing View Mode Cycling**: Adding keyboard shortcuts to switch and cycle through view modes:
   - **⌘/** to cycle through all four view modes: Split → Editor → Preview → WYSIWYG → Split
   - **⌃1** for Split view, **⌃2** for Editor, **⌃3** for Preview, **⌃4** for WYSIWYG (direct access)

3. **Adopting Dual-Engine Architecture**: Using two specialized editing engines for optimal experience in each mode:
   - **WYSIWYG mode → Milkdown (ProseMirror)**: True rich-text editing like Typora
   - **Editor mode → CodeMirror**: Source code editing with syntax highlighting

4. **Preserving Typora-style Shortcuts**: Keeping ⌘1-6 for heading levels (H1-H6), ⌘0 for paragraph, consistent with Typora's default behavior.

## Architecture: Dual-Engine Design

mdpro adopts a **dual-engine architecture** to provide the best experience for each editing mode:

### Why Two Engines?

| Engine | Underlying Model | Best For |
|--------|-----------------|----------|
| **CodeMirror** | Plain text with decorations | Source code editing, syntax highlighting, line numbers |
| **ProseMirror (Milkdown)** | Structured document tree | True WYSIWYG, rich-text editing, Typora-like experience |

The key difference is how they represent the document:

- **CodeMirror**: Stores `# Hello` as literal text, uses decorations to hide the `#` visually
- **ProseMirror**: Converts `# Hello` into a heading node structure, `#` truly disappears

### Engine Assignment by View Mode

| View Mode | Engine | Rendering |
|-----------|--------|-----------|
| **Split** | CodeMirror (left) + HTML Preview (right) | Source + rendered side-by-side |
| **Editor** | CodeMirror | Full-width source editing |
| **Preview** | HTML (read-only) | Full-width rendered output |
| **WYSIWYG** | Milkdown (ProseMirror) | Full-width true WYSIWYG |

### Data Synchronization

All four modes share the same underlying Markdown content:

```
┌─────────────────────────────────────────────────────────┐
│                 Markdown Content                         │
│              (Single Source of Truth)                    │
│                    Zustand Store                         │
└──────────────────────┬──────────────────────────────────┘
                       │
       ┌───────────────┼───────────────┐
       ▼               ▼               ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│  CodeMirror │ │   Preview   │ │  Milkdown   │
│  (Editor/   │ │  (HTML)     │ │  (WYSIWYG)  │
│   Split)    │ │             │ │             │
└─────────────┘ └─────────────┘ └─────────────┘
```

When switching modes:
- **Editor → WYSIWYG**: Markdown string → Milkdown parses to ProseMirror document
- **WYSIWYG → Editor**: Milkdown serializes ProseMirror document → Markdown string

## Visual Design

- **Wireframe Diagram**: [wireframe.html](./diagrams/wireframe.html) - 界面布局线框图
- **Site Diagram**: [site-diagram.html](./diagrams/site-diagram.html) - 应用架构和数据流图

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View Mode Switching & Cycling (Priority: P1)

As a user editing a Markdown document, I want to quickly switch between view modes using keyboard shortcuts so that I can efficiently switch between editing, previewing, and WYSIWYG experiences without navigating menus.

**Why this priority**: This is the most frequently used interaction for power users who need to switch contexts rapidly between writing, formatting, and reviewing their work. It provides immediate productivity value with minimal implementation risk.

**Independent Test**: Can be fully tested by pressing ⌘/ repeatedly to cycle, or ⌃1/⌃2/⌃3/⌃4 for direct access. Delivers immediate usability value for existing users.

**Acceptance Scenarios**:

1. **Given** the editor is in any view mode, **When** user presses ⌃1, **Then** the view changes to Split view
2. **Given** the editor is in any view mode, **When** user presses ⌃2, **Then** the view changes to Editor-only mode
3. **Given** the editor is in any view mode, **When** user presses ⌃3, **Then** the view changes to Preview mode
4. **Given** the editor is in any view mode, **When** user presses ⌃4, **Then** the view changes to WYSIWYG mode
5. **Given** the editor is in Split view mode, **When** user presses ⌘/, **Then** the view changes to Editor-only mode
6. **Given** the editor is in Editor-only mode, **When** user presses ⌘/, **Then** the view changes to Preview mode
7. **Given** the editor is in Preview mode, **When** user presses ⌘/, **Then** the view changes to WYSIWYG mode
8. **Given** the editor is in WYSIWYG mode, **When** user presses ⌘/, **Then** the view changes to Split view mode (completing the cycle)
9. **Given** any view mode, **When** user presses shortcuts multiple times rapidly, **Then** the view changes smoothly without lag or visual glitches

---

### User Story 2 - Preview Mode Shows Rendered Output (Priority: P2)

As a user who wants to review my formatted Markdown document, I want Preview mode to show a read-only rendered view (like the right pane in Split view) so that I can see exactly how my document will appear when published.

**Why this priority**: This fixes a UX inconsistency where Preview mode currently shows an editable WYSIWYG view instead of a true preview. This is important for users who need to review formatting without accidentally modifying content.

**Independent Test**: Can be tested by switching to Preview mode (⌃3) and verifying that the content is rendered HTML (not an editable field) and matches the Split view right pane appearance.

**Acceptance Scenarios**:

1. **Given** a document with Markdown content, **When** user switches to Preview mode, **Then** the document is displayed as rendered HTML (headings, lists, code blocks, etc. are visually formatted)
2. **Given** Preview mode is active, **When** user clicks on the rendered content, **Then** no cursor appears and text cannot be edited
3. **Given** Preview mode is active with an image in the document, **When** the preview loads, **Then** images are rendered and displayed correctly (same as Split view right pane)
4. **Given** Preview mode is active with code blocks, **When** the preview loads, **Then** syntax highlighting is applied to code blocks
5. **Given** Preview mode is active, **When** user clicks on a hyperlink, **Then** the link opens in the default browser (same behavior as Split view)

---

### User Story 3 - True WYSIWYG Editing with Milkdown (Priority: P3)

As a user who prefers visual editing, I want WYSIWYG mode to provide a true Typora-like experience where I can write and format content visually while maintaining valid Markdown output, so that I can focus on content without thinking about syntax.

**Why this priority**: This is the most complex feature requiring significant refactoring (replacing CodeMirror with Milkdown). While it provides the best editing experience, it builds upon the foundation of P1 and P2. The current WYSIWYG mode still functions, making this an enhancement rather than a critical fix.

**Independent Test**: Can be tested by switching to WYSIWYG mode (⌃4), typing formatted content (headings, bold, lists), and verifying the underlying Markdown is correct when switching to Editor mode (⌃2).

**Acceptance Scenarios**:

1. **Given** WYSIWYG mode is active, **When** user types "# Hello", **Then** the text transforms into a visible heading immediately (hash symbol hidden)
2. **Given** WYSIWYG mode is active, **When** user types "**bold**", **Then** the text displays as bold and the asterisks are hidden
3. **Given** WYSIWYG mode is active, **When** user types "- item", **Then** a bullet list item is created with proper formatting
4. **Given** WYSIWYG mode is active with formatted content, **When** user switches to Editor mode, **Then** the underlying Markdown syntax is preserved correctly
5. **Given** WYSIWYG mode is active, **When** user selects text and uses ⌘B, **Then** the selection becomes bold
6. **Given** WYSIWYG mode is active, **When** user presses ⌘1, **Then** the current line/selection becomes a H1 heading (Typora-style)
7. **Given** WYSIWYG mode is active, **When** user presses ⌘2 through ⌘6, **Then** the current line/selection becomes the corresponding heading level
8. **Given** WYSIWYG mode is active, **When** user presses ⌘0, **Then** the current line reverts to normal paragraph
9. **Given** WYSIWYG mode is active, **When** user pastes content from another application, **Then** the content is converted to appropriate Markdown format
10. **Given** a document opened in WYSIWYG mode, **When** the document contains complex Markdown (tables, code blocks, images), **Then** all elements render correctly and are editable

---

### User Story 4 - Typora-style Inline Editing (Priority: P4)

As a user editing in WYSIWYG mode, I want inline elements (links, inline code) to reveal their raw Markdown syntax when my cursor is inside them, so that I can easily edit the underlying markup without switching to Editor mode—just like Typora.

**Why this priority**: This enhances the WYSIWYG experience by providing contextual editing for inline elements. It builds upon the basic Milkdown integration (P3) and provides the polish expected from a Typora-like editor.

**Independent Test**: In WYSIWYG mode, click inside a rendered link to see `[text](url)` appear. Click inside inline code to see backticks `` `code` ``. Move cursor away to see rendered form again.

**Acceptance Scenarios**:

1. **Given** WYSIWYG mode with a document containing `[example](https://example.com)`, **When** user clicks inside the link text "example", **Then** the link transforms to show raw Markdown `[example](https://example.com)` with the cursor positioned inside
2. **Given** WYSIWYG mode with a document containing `` `code` ``, **When** user clicks inside the rendered inline code, **Then** it transforms to show `` `code` `` with visible backticks and the cursor positioned inside
3. **Given** the cursor is inside an expanded link showing raw Markdown, **When** user moves cursor outside the link (clicks elsewhere), **Then** the link collapses back to rendered form (blue underlined text)
4. **Given** the cursor is inside an expanded inline code showing backticks, **When** user moves cursor outside, **Then** the inline code collapses back to styled rendered form
5. **Given** an expanded link showing `[text](url)`, **When** user edits the URL portion, **Then** the changes are preserved when the link collapses
6. **Given** an expanded inline code showing `` `code` ``, **When** user edits the code content, **Then** the changes are preserved when it collapses
7. **Given** WYSIWYG mode, **When** user uses arrow keys to navigate into a link or inline code, **Then** the element expands to show raw Markdown (same as clicking)
8. **Given** multiple inline elements on the same line, **When** user clicks inside one, **Then** only that specific element expands (others remain rendered)

---

### Edge Cases

- What happens when user presses ⌘/ or ⌃1-4 with no document open? → View mode cycling should still work (affecting the default/welcome view state)
- What happens when Milkdown encounters malformed Markdown? → Render unparseable sections as plain text blocks; content is preserved and remains editable; no crash or data loss
- What happens when switching from WYSIWYG to Editor mode mid-edit? → Cursor position should be approximately preserved; unsaved changes are maintained in memory
- What happens when the document is very large (>500KB) in WYSIWYG mode? → System auto-switches to Editor mode with a toast notification explaining the size limitation; user can continue editing in Editor/Split modes
- What happens when cursor is at the boundary between link text and URL? → The entire link element should be expanded; cursor can move freely within the expanded `[text](url)` structure
- What happens when user deletes all text inside an expanded link? → The link node should be removed, leaving just the cursor position
- What happens when user types backtick inside expanded inline code? → The backtick should be escaped or the inline code should be split appropriately

## Requirements *(mandatory)*

### Functional Requirements

**View Mode Switching**
- **FR-001**: System MUST support cycling through view modes in order: Split → Editor → Preview → WYSIWYG → Split
- **FR-002**: System MUST respond to ⌘/ keyboard shortcut to trigger view mode cycling
- **FR-003**: System MUST respond to ⌃1, ⌃2, ⌃3, ⌃4 keyboard shortcuts for direct view mode switching (Split, Editor, Preview, WYSIWYG respectively)

**Preview Mode**
- **FR-004**: Preview mode MUST display read-only rendered HTML output (not an editable view)
- **FR-005**: Preview mode rendering MUST match the right pane of Split view exactly (same CSS, same code highlighting, same image rendering)

**Dual-Engine Architecture**
- **FR-006**: WYSIWYG mode MUST use Milkdown framework (ProseMirror-based) for true rich-text Markdown editing
- **FR-007**: Editor and Split modes MUST use CodeMirror for source code editing with syntax highlighting, line numbers, and code folding
- **FR-008**: System MUST maintain a single Markdown source of truth (Zustand store), synchronized across all view modes without data loss
- **FR-009**: When switching from WYSIWYG to Editor mode, Milkdown MUST serialize the ProseMirror document back to valid Markdown
- **FR-010**: When switching from Editor to WYSIWYG mode, Milkdown MUST parse the Markdown string into a ProseMirror document

**WYSIWYG Capabilities**
- **FR-011**: WYSIWYG mode MUST support common Markdown formatting: headings (1-6), bold, italic, strikethrough, inline code, code blocks, bullet lists, numbered lists, links, images, blockquotes, horizontal rules
- **FR-012**: WYSIWYG mode MUST support Typora-style heading shortcuts: ⌘1 (H1), ⌘2 (H2), ⌘3 (H3), ⌘4 (H4), ⌘5 (H5), ⌘6 (H6), ⌘0 (paragraph)
- **FR-013**: WYSIWYG mode MUST support standard formatting shortcuts: ⌘B (bold), ⌘I (italic), ⌘K (link)

**Editor Mode Capabilities**
- **FR-014**: Editor mode MUST also support Typora-style heading shortcuts (⌘1-6, ⌘0) and ⌘K (link) for consistency across modes

**Typora-style Inline Editing**
- **FR-017**: WYSIWYG mode MUST expand link elements to show raw Markdown `[text](url)` when cursor is positioned inside
- **FR-018**: WYSIWYG mode MUST expand inline code elements to show backticks `` `code` `` when cursor is positioned inside
- **FR-019**: Expanded inline elements MUST collapse back to rendered form when cursor moves outside
- **FR-020**: Edits made to expanded inline elements MUST be preserved when the element collapses
- **FR-021**: Arrow key navigation into inline elements MUST trigger expansion (same behavior as clicking)
- **FR-022**: Multiple inline elements on the same line MUST expand independently (only the focused element expands)

**System Integration**
- **FR-015**: System MUST update the native menu bar to reflect the current view mode state
- **FR-016**: System MUST persist the last-used view mode in user preferences

### Keyboard Shortcut Summary

| Shortcut | Action | Context |
|----------|--------|---------|
| ⌘/ | Cycle view modes (Split → Editor → Preview → WYSIWYG → Split) | Global |
| ⌃1 | Switch to Split view | Global |
| ⌃2 | Switch to Editor-only view | Global |
| ⌃3 | Switch to Preview view | Global |
| ⌃4 | Switch to WYSIWYG view | Global |
| ⌘1-6 | Set heading level H1-H6 | Editor / WYSIWYG |
| ⌘0 | Set paragraph (remove heading) | Editor / WYSIWYG |
| ⌘B | Bold | Editor / WYSIWYG |
| ⌘I | Italic | Editor / WYSIWYG |
| ⌘K | Insert/edit link | Editor / WYSIWYG |

### Key Entities

- **ViewMode**: Enum representing the four view modes (split, editor-only, preview-only, wysiwyg)
- **EditorContent**: The Markdown text content being edited, synchronized across all view modes (single source of truth)
- **CodeMirrorEditor**: The source code editor used in Split and Editor modes (syntax highlighting, line numbers)
- **MilkdownEditor**: The WYSIWYG editor instance powered by ProseMirror that manages rich-text editing and Markdown conversion
- **InlineEditPlugin**: ProseMirror plugin that manages cursor-aware expansion/collapse of inline elements (links, inline code)
- **LinkNodeView**: Custom ProseMirror NodeView for link marks that renders expanded `[text](url)` or collapsed styled link based on cursor position
- **InlineCodeNodeView**: Custom ProseMirror NodeView for inline code marks that renders expanded `` `code` `` or collapsed styled code based on cursor position

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can cycle through all four view modes in under 0.5 seconds per transition (no perceptible lag)
- **SC-002**: View mode changes via ⌘/ or ⌃1-4 complete within 200ms of keypress (responsive feel)
- **SC-003**: Preview mode renders identically to Split view right pane (pixel-perfect consistency)
- **SC-004**: WYSIWYG mode correctly round-trips 100% of standard Markdown syntax (no data loss)
- **SC-005**: Users can perform common formatting operations in WYSIWYG mode without knowing Markdown syntax
- **SC-006**: Document content remains consistent when switching between any two view modes (no content corruption)
- **SC-007**: WYSIWYG mode handles documents up to 500KB with acceptable performance (no noticeable input lag)
- **SC-008**: Typora users can use familiar shortcuts (⌘1-6 for headings) without relearning
- **SC-009**: Inline element expansion/collapse completes within 50ms (imperceptible transition)
- **SC-010**: Users can click into a link, edit the URL, click away, and see the updated link render correctly
- **SC-011**: Users can click into inline code, modify content, click away, and see the updated code render correctly
- **SC-012**: Typora users recognize and can use the inline editing behavior without instruction

## Assumptions

**Dual-Engine Architecture**
- The dual-engine approach (CodeMirror + Milkdown) is justified because each engine excels at its specific use case: CodeMirror for source editing, ProseMirror for WYSIWYG
- The existing CodeMirror implementation in Editor/Split modes will be retained as-is; only WYSIWYG mode changes
- Markdown serialization/parsing overhead when switching modes is acceptable (<100ms for typical documents)

**Milkdown Integration**
- The Milkdown framework is compatible with React 19 and can be integrated into the existing Tauri/Vite build pipeline
- Milkdown's default CommonMark plugin provides sufficient Markdown feature support for mdpro's requirements
- The current document state management (Zustand stores) can serve as the single source of truth for both engines

**Keyboard Shortcuts**
- Users familiar with Typora will expect ⌘1-6 for headings; using ⌃1-4 for view modes avoids conflict
- ⌃ (Control) key is less commonly used in macOS apps, making it suitable for view mode switching without conflicting with standard shortcuts

**Typora-style Inline Editing**
- ProseMirror's NodeView API provides sufficient control to implement cursor-aware rendering for marks
- Custom NodeViews can track cursor position via ProseMirror selection state and decorations
- The expand/collapse transition can be implemented without full document re-parsing
- Milkdown's architecture allows registering custom NodeView plugins alongside existing plugins
