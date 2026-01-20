# Research: Polish WYSIWYG Editor

**Feature**: 002-polish-wysiwyg | **Date**: 2026-01-19

## Research Summary

All technical unknowns have been resolved. This document consolidates findings from the comprehensive Milkdown research (`/milkdown-research.md`) and codebase analysis.

---

## Decision 1: WYSIWYG Engine Selection

**Decision**: Use Milkdown (ProseMirror-based) for WYSIWYG mode

**Rationale**:
- ProseMirror uses structured document tree model that truly converts Markdown to rich-text nodes
- Milkdown provides React integration (`@milkdown/react`) compatible with React 19
- Plugin-driven architecture allows selective feature inclusion
- MIT licensed, actively maintained (11k+ stars, v7.18.0)

**Alternatives Considered**:
1. **Keep CodeMirror for WYSIWYG** - Rejected: CodeMirror uses plain text with decorations, cannot provide true WYSIWYG where syntax markers disappear
2. **Use ProseMirror directly** - Rejected: Requires building Markdown↔ProseMirror transformation from scratch; Milkdown provides this out of the box
3. **Build custom plugin system** - Rejected for this feature: Over-engineering for the current scope; can be revisited for future extensibility

---

## Decision 2: Milkdown Package Selection

**Decision**: Use minimal package set for core WYSIWYG functionality

**Packages to install**:
```bash
pnpm add @milkdown/kit @milkdown/react
```

**Rationale**:
- `@milkdown/kit` bundles: core, prose, transformer, preset-commonmark, history, clipboard
- `@milkdown/react` provides: MilkdownProvider, Milkdown component, useEditor hook
- No additional plugins needed for basic WYSIWYG (headings, bold, italic, lists, code blocks, links, images)

**Alternatives Considered**:
1. **Install individual packages** - Rejected: `@milkdown/kit` provides convenient bundle without extra overhead
2. **Add GFM preset** - Deferred: CommonMark sufficient for initial implementation; GFM (tables, strikethrough, task lists) can be added later

---

## Decision 3: Data Synchronization Strategy

**Decision**: Lazy serialization on mode switch

**Rationale**:
- Only serialize Milkdown → Markdown when switching away from WYSIWYG mode
- Only parse Markdown → Milkdown when entering WYSIWYG mode
- Avoids continuous synchronization overhead during editing
- Zustand store holds canonical Markdown string; engines transform on demand

**Implementation**:
```typescript
// On entering WYSIWYG mode
const markdown = useDocumentStore(s => s.content)
editor.action(replaceAll(markdown))

// On leaving WYSIWYG mode
const markdown = editor.action(getMarkdown())
useDocumentStore.setState({ content: markdown })
```

**Alternatives Considered**:
1. **Real-time bidirectional sync** - Rejected: Unnecessary complexity and potential performance issues
2. **Debounced sync** - Rejected: Still adds overhead without clear benefit for single-document editing

---

## Decision 4: Keyboard Shortcut Handling Strategy

**Decision**: Dual-layer shortcut handling (Tauri menu + React hooks)

**Rationale**:
- **⌃1-4 (view switching)**: Handle in Rust `menu.rs` for native menu integration
- **⌘1-6 (headings)**: Handle in React for both CodeMirror and Milkdown editors
- **⌘/ (cycling)**: Handle in React `useKeyboardShortcuts` hook

**Implementation**:
- Rust menu emits `menu:action` events with `{ action: "set-view-mode", value: "split" | "editor-only" | ... }`
- React hook listens for native menu events AND registers browser-level keyboard handlers
- Milkdown uses `$useKeymap` for heading shortcuts within editor context

**Alternatives Considered**:
1. **All shortcuts in Rust** - Rejected: Editor-specific shortcuts (headings, formatting) need editor context
2. **All shortcuts in React** - Rejected: View mode shortcuts should integrate with native menu bar

---

## Decision 5: Large Document Handling

**Decision**: Auto-switch to Editor mode with toast notification for documents >500KB

**Rationale**:
- ProseMirror performance degrades with very large documents
- 500KB threshold covers 99%+ of typical Markdown documents
- Editor mode (CodeMirror) handles large files efficiently with virtualization
- Toast notification explains the switch without blocking user workflow

**Implementation**:
```typescript
const handleEnterWYSIWYG = () => {
  const size = new Blob([content]).size
  if (size > 500 * 1024) {
    toast.info("Document too large for WYSIWYG mode. Switching to Editor.")
    setViewMode('editor-only')
    return
  }
  setViewMode('wysiwyg')
}
```

---

## Decision 6: Malformed Markdown Handling

**Decision**: Render unparseable sections as plain text blocks

**Rationale**:
- Preserves all user content (no data loss)
- User can continue editing and fix syntax
- Matches Milkdown's default graceful degradation behavior
- No need for custom error UI or auto-repair logic

---

## Technical Dependencies Verified

| Dependency | Version | Compatibility |
|------------|---------|---------------|
| React | 19.1.0 | ✅ Milkdown supports React 18+, compatible with 19 |
| Vite | 7.0.4 | ✅ Standard ES modules, no issues |
| Tauri | 2.0 | ✅ No conflicts with frontend dependencies |
| Zustand | 4.5.4 | ✅ Works alongside Milkdown's internal state |
| CodeMirror | 6.x | ✅ Retained for Editor/Split modes, no conflict |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Milkdown bundle size impact | Low | Low | Tree-shaking via Vite; kit is ~150KB gzipped |
| React 19 compatibility issues | Low | Medium | Milkdown actively maintained; fallback to manual DOM if needed |
| Markdown round-trip data loss | Medium | High | Comprehensive test with complex documents; CommonMark compliance |
| Performance on edge cases | Low | Medium | 500KB threshold; lazy serialization |

---

## References

- Milkdown GitHub: https://github.com/Milkdown/milkdown
- Milkdown Docs: https://milkdown.dev/docs
- ProseMirror Guide: https://prosemirror.net/docs/guide/
- Comprehensive research: `/milkdown-research.md` (root)
