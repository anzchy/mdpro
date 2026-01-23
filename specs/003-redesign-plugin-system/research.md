# Research: Window Dragging, Multi-Window, WYSIWYG Tables

**Feature**: 003-redesign-plugin-system
**Date**: 2026-01-23

## Research Questions

### 1. How to enable window dragging with a custom topbar?

**Decision**: Use Tauri drag regions on non-interactive topbar elements.

**Rationale**:
- Tauri supports custom draggable regions via `data-tauri-drag-region`.
- Keeping the existing visual layout avoids UI churn.
- Interactive elements should be explicitly excluded from drag regions.

**Alternatives Considered**:
1. **Native titlebar** - Rejected: would change layout and require redesign.
2. **Full-window drag** - Rejected: breaks editor text selection.

### 2. How to support multiple independent windows?

**Decision**: Use Tauri window APIs to create additional windows and scope editor state per window instance.

**Rationale**:
- Each Tauri window runs the same frontend bundle with isolated in-memory state.
- Using window labels allows routing open-file actions to specific windows.
- Existing file watcher reload prompt can handle same-file edits across windows.

**Alternatives Considered**:
1. **Tabs only** - Rejected: user explicitly requested multiple windows.
2. **Single shared store** - Rejected: would leak state across windows.

### 3. How to render Markdown tables in WYSIWYG mode?

**Decision**: Enable GFM table support in Milkdown configuration.

**Rationale**:
- CommonMark does not include tables.
- Milkdown provides GFM/table presets that parse and render pipe tables.
- Aligns WYSIWYG output with existing preview rendering expectations.

**Alternatives Considered**:
1. **Custom ProseMirror schema** - Rejected: higher complexity and maintenance.
2. **Render tables only in preview** - Rejected: user explicitly needs WYSIWYG tables.

## Technology Notes

### Tauri Window Drag Regions

- Apply `data-tauri-drag-region` to draggable DOM nodes.
- Avoid placing drag regions over buttons or input controls.

### Multi-Window Events

- Use app menu and custom events to open files in new windows.
- Preserve existing single-instance behavior for external file open events.

### Milkdown Tables

- Prefer official GFM/table preset for schema + keymaps.
- Validate Markdown round-trip: table edits update source text correctly.

## Decisions Summary

| Question | Decision |
|----------|----------|
| Drag region | Tauri drag region on topbar only |
| Multi-window | Tauri window API + per-window state |
| WYSIWYG tables | Enable Milkdown GFM table support |
