# Research: Industry Conventions for New Features

**Feature Branch**: `006-toc-tab-and-new-features`
**Date**: 2026-02-03
**Purpose**: To document standard industry patterns and best practices for the features specified in `spec.md`.
**Updated**: 2026-02-03 with web search validation findings

## 1. Table of Contents (TOC) Sidebar

### Industry Conventions
*   **Automatic Generation**: TOCs are universally generated dynamically by parsing document headings (H1-H6). No manual curation is required by the user.
*   **Real-time Updates**: The sidebar reflects changes immediately as the user types or modifies structure.
*   **Hierarchical Indentation**: Visual hierarchy is preserved (H2 indented under H1) to communicate document structure at a glance.
*   **Active Section Highlighting**: The TOC entry corresponding to the user's current scroll position is highlighted ("Spy Scrolling").
*   **Smooth Scrolling**: Clicking an entry animates the scroll to the target section rather than jumping instantly.

### Implementation Patterns
*   **Anchors**: Generated anchor IDs typically lowercase the heading text and replace spaces with hyphens (e.g., `# Getting Started` -> `#getting-started`).
*   **Collapsibility**: Users can often collapse the entire sidebar or specific sections within the TOC to manage screen real estate.
*   **Empty States**: When no headings exist, a friendly placeholder text explains how to populate the TOC.

### Research Validation (2026-02-03)

**Decision**: Implement spy scrolling using Intersection Observer API
**Rationale**: Modern, performant approach recommended by [CSS-Tricks](https://css-tricks.com/sticky-table-of-contents-with-scrolling-active-states/) and Bootstrap 5
**Implementation Detail**: Use `rootMargin: "0px 0px -66%"` to trigger activation when user scrolls 33% past heading

**Additional Finding - Duplicate Headings**:
- **Problem**: Two headings with same text generate identical IDs, causing TOC links to point to first occurrence only
- **Solution**: Append numeric suffix (e.g., `heading`, `heading-1`, `heading-2`)
- **Source**: [Markdown All in One](https://markdown-all-in-one.github.io/docs/guide/table-of-contents.html)

**References**:
- [Bootstrap Scrollspy](https://getbootstrap.com/docs/5.0/components/scrollspy/)
- [Markdown All in One Documentation](https://markdown-all-in-one.github.io/docs/guide/table-of-contents.html)

---

## 2. Multi-Tab Document Support

### Industry Conventions
*   **Single Row Layout**: Tabs are restricted to a single horizontal row. If tabs overflow, a "more" dropdown or horizontal scrolling is provided rather than stacking rows.
*   **Dirty State Indicators**: A visual cue (e.g., a dot or changing the "x" to a circle) indicates unsaved changes directly on the tab.
*   **Tab Cycles**: Standard keyboard shortcuts (`Ctrl/Cmd + Tab` and `Ctrl/Cmd + Shift + Tab`) cycle through open tabs.
*   **Close Behavior**: The active tab is usually closed with `Cmd/Ctrl + W`. Middle-clicking a tab is a standard shortcut to close it.

### UX Best Practices
*   **Label Truncation**: Filenames are truncated in the middle or end if space is limited, ensuring unique identifiers (like extensions) often remain visible.
*   **Focus Management**: Closing the active tab typically passes focus to the immediate right tab, or the last used tab (MRU), depending on browser/editor convention.

### Research Validation (2026-02-03)

**Critical Addition - Animation**:
- **Decision**: Use 300ms cross-fade with 100ms overlap for tab content transitions
- **Rationale**: Per [SetProduct](https://www.setproduct.com/blog/tabs-ui-design), slide animations cause spatial disorientation
- **Rule**: Never use slide animations for tab switching

**Critical Addition - Context Preservation**:
- **Decision**: Maintain scroll position per tab
- **Rationale**: Prevents user disorientation when switching between tabs
- **Implementation**: Store scroll position in tab state, restore on switch

**Critical Addition - Loading Strategy**:
- **Decision**: Show skeleton screens with 150ms delay for heavy content
- **Rationale**: Never show blank panes - per [SetProduct](https://www.setproduct.com/blog/tabs-ui-design)
- **Implementation**: Skeleton component triggers after 150ms if content not loaded

**Additional Finding - Undo Close Tab**:
- Per [Obsidian](https://help.obsidian.md/tabs), remember pinned status when reopening closed tabs
- Keep track of last 10 closed tabs for recovery

**References**:
- [NN/G - Tabs Used Right](https://www.nngroup.com/articles/tabs-used-right/)
- [UX Planet - Designing Perfect Tabs](https://uxplanet.org/designing-perfect-tabs-2c0aaf835bfc)
- [SetProduct - Tabs UI Design](https://www.setproduct.com/blog/tabs-ui-design)
- [Obsidian Tabs Documentation](https://help.obsidian.md/tabs)

---

## 3. Streamlined Auto-Save

### Industry Conventions
*   **Implicit vs. Explicit**: Modern "local-first" apps (Obsidian, VS Code) default to auto-save, often removing the need for a manual "Save" button entirely, though "Save As" remains.
*   **Triggers**:
    *   **onBlur**: Save when the window loses focus.
    *   **Debounce**: Save after `N` milliseconds of inactivity (typically 1s - 5s).
    *   **Interval**: Save every `N` seconds regardless of activity (less common for local files, more common for cloud).
*   **Feedback**:
    *   **Minimalist**: A subtle status bar indicator ("Saved" or checkmark) is preferred over modal dialogs or blocking spinners.
    *   **Error Handling**: If a save fails (e.g., permission error), a non-blocking toast notification is standard.

### UX Best Practices
*   **"Dirty" State Retention**: Even with auto-save, keeping the "dirty" indicator until the write to disk is confirmed provides necessary user confidence.
*   **Manual Save Override**: `Cmd/Cmd + S` should still force a write immediately, providing tactile reassurance to the user.

### Research Validation (2026-02-03)

**Decision - Debounce Timing**:
- **Choice**: 1500ms default (configurable: 5s, 15s, 60s, disabled)
- **Rationale**: Common range is 500ms-1500ms per [Medium article](https://kannanravi.medium.com/implementing-efficient-autosave-with-javascript-debounce-techniques-463704595a7a)
- **Trade-off**: Too short overloads I/O, too long risks data loss

**Critical Addition - saveInProgress Flag**:
- **Problem**: Debounce timeout may exceed save duration, causing double-saves
- **Solution**: Set `saveInProgress` flag, skip new save until previous completes
- **Source**: Common pattern in auto-save implementations

**Critical Addition - Hybrid Approach**:
- **Decision**: Combine debounce + onBlur for coverage
- **Rationale**: Debounce handles typing pauses, onBlur catches app switches
- **Implementation**: Both triggers check `saveInProgress` flag

**References**:
- [Medium - AutoSave with Debounce](https://kannanravi.medium.com/implementing-efficient-autosave-with-javascript-debounce-techniques-463704595a7a)
- [FreeCodeCamp - Debounce](https://www.freecodecamp.org/news/javascript-debounce-example/)

---

## 4. Table Rendering and Editing

### Industry Conventions
*   **WYSIWYG Overlay**: Tables render as HTML grid structures. Editing text is inline.
*   **Context Menus**: Right-clicking inside a table cell is the standard discovery mechanism for structural edits.
*   **Menu Structure**:
    *   **Row Operations**: "Insert Row Above/Below", "Delete Row".
    *   **Column Operations**: "Insert Column Left/Right", "Delete Column".
    *   **Alignment**: "Align Left/Center/Right".
*   **Keyboard Navigation**: `Tab` moves to the next cell; `Shift + Tab` moves to the previous. Pressing `Tab` in the last cell of the last row typically creates a new row.

### UX Best Practices
*   **Visual Selection**: Clicking a row or column header (if available) or dragging across cells should highlight the selection.
*   **Destructive Actions**: Delete actions are often grouped or separated by a divider to prevent accidental clicks.

### Research Validation (2026-02-03)

**Decision - Menu Structure Order**:
```
Insert Row Above
Insert Row Below
---
Insert Column Left
Insert Column Right
---
Align Left
Align Center
Align Right
---
Delete Row
Delete Column
```
- **Rationale**: Group by operation type, isolate destructive actions at bottom
- **Source**: [Typora Table Editing](https://support.typora.io/Table-Editing/)

**Critical Addition - Quick Shortcut**:
- **Decision**: Cmd+Enter to insert row below current row
- **Rationale**: Faster than context menu for common operation
- **Source**: Typora uses this pattern

**Critical Addition - Mouse Drag Resize**:
- **Decision**: Allow column width adjustment via mouse drag on column borders
- **Rationale**: Expected interaction for table manipulation
- **Implementation**: CSS resize handles on column borders

**References**:
- [Typora Table Editing](https://support.typora.io/Table-Editing/)
- [TOAST UI Editor](https://github.com/nhn/tui.editor)

---

## 5. Image Rendering and Upload

### Industry Conventions
*   **Source Types**:
    *   **Local Paths**: Relative paths (`./images/img.png`) are preferred for portability within git repositories.
    *   **Remote URLs**: HTTPS links are rendered directly.
*   **Drag-and-Drop**: Dragging an image file onto the editor is the expected interaction for insertion.
*   **Paste**: Pasting image data from the clipboard should automatically save the file to a default location and insert the markdown link.

### UX Best Practices
*   **Default Asset Folders**: Editors often default to saving pasted/dragged images in an `./assets` or `./images` subdirectory relative to the document.
*   **Path Resolution**: The editor must intelligently resolve relative paths based on the open file's location.
*   **Error Placeholders**: Broken images should show a visual placeholder (broken image icon) along with the alt text and the raw path, aiding debugging.

### Research Validation (2026-02-03)

**Decision - Default Asset Folder**:
- **Choice**: `./assets/` relative to document location
- **Rationale**: Industry standard, keeps images organized
- **Configurable**: Yes, via Settings → Image

**Critical Addition - Multiple Images**:
- **Decision**: Support pasting/dropping multiple images at once
- **Rationale**: Common workflow when adding many images
- **Implementation**: Process array of files, insert links sequentially

**Critical Addition - Dimension Handling**:
- **Problem**: Markdown syntax `![](img.png)` doesn't support explicit dimensions
- **Solution**: When user resizes image, serialize as HTML `<img width="X" height="Y">`
- **Source**: [MDXEditor](https://mdxeditor.dev/editor/docs/images)

**Critical Addition - Preview Before Insert**:
- **Decision**: Show preview dialog for pasted images
- **Rationale**: User should see what they're inserting
- **Source**: [Markdown Monster](https://markdownmonster.west-wind.com/docs/Embedding-Links-Images-Tables-and-More/Embedding-Images.html)

**Critical Addition - Auto-Copy to Workspace**:
- **Decision**: When dragging from outside project, prompt user to copy to assets folder
- **Rationale**: Keeps images portable with document
- **Source**: [VS Code Markdown](https://code.visualstudio.com/docs/languages/markdown)

**References**:
- [VS Code Markdown](https://code.visualstudio.com/docs/languages/markdown)
- [MDXEditor Images](https://mdxeditor.dev/editor/docs/images)
- [Markdown Monster - Embedding Images](https://markdownmonster.west-wind.com/docs/Embedding-Links-Images-Tables-and-More/Embedding-Images.html)

---

## Summary of Research Additions

| Feature | Original research.md | Added from Web Search |
|---------|---------------------|----------------------|
| TOC Sidebar | Complete | Duplicate heading handling, Intersection Observer details |
| Multi-Tab | Complete | Animation (300ms cross-fade), context preservation, skeleton screens, undo close |
| Auto-Save | Complete | saveInProgress flag, hybrid approach |
| Table Editing | Complete | Cmd+Enter shortcut, mouse drag resize |
| Image Handling | Complete | Multiple images, dimension handling, preview dialog, auto-copy |
