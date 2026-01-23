# Implementation Plan: Polish WYSIWYG Editor

**Branch**: `002-polish-wysiwyg` | **Date**: 2026-01-19 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-polish-wysiwyg/spec.md`

## Summary

Enhance mdpro Markdown editor with: (1) View mode cycling via ⌘/ and direct access via ⌃1-4, (2) Preview mode showing read-only rendered HTML instead of WYSIWYG, (3) True WYSIWYG editing using Milkdown (ProseMirror-based) replacing CodeMirror-based pseudo-WYSIWYG. The dual-engine architecture retains CodeMirror for Editor/Split modes while introducing Milkdown for WYSIWYG mode, with Zustand store as single source of truth.

## Technical Context

**Language/Version**: TypeScript 5.8 (frontend), Rust 2021 Edition (backend)
**Primary Dependencies**: React 19, Tauri 2.0, CodeMirror 6, Milkdown (NEW), Zustand 4
**Storage**: N/A (local file system via Tauri)
**Testing**: Manual testing (no test framework in current setup)
**Target Platform**: macOS 13+ (Apple Silicon ARM64)
**Project Type**: Desktop app (Tauri hybrid: Rust backend + React frontend)
**Performance Goals**: View mode transitions <200ms, WYSIWYG handles documents up to 500KB
**Constraints**: <500ms view mode transition, graceful degradation for large docs (>500KB auto-switch to Editor mode)
**Scale/Scope**: Single-user local Markdown editor, documents typically <100KB

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The constitution template is not customized for this project. Using default best practices:

- ✅ **Library-First**: Milkdown is a modular library with clear purpose
- ✅ **Test-First**: Acceptance scenarios defined in spec for manual verification
- ✅ **Simplicity**: Dual-engine justified - each engine excels at its use case
- ✅ **Observability**: Text I/O debuggable, state changes visible in Zustand devtools

No violations requiring justification.

## Project Structure

### Documentation (this feature)

```text
specs/002-polish-wysiwyg/
├── spec.md              # Feature specification (complete)
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (IPC contracts)
├── diagrams/            # Visual diagrams (complete)
│   ├── wireframe.html
│   └── site-diagram.html
├── checklists/          # Quality checklists
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
src/                          # React frontend
├── App.tsx                   # MODIFY: View mode routing, keyboard shortcuts
├── components/
│   ├── Editor/
│   │   ├── SplitView.tsx     # MODIFY: Route preview-only to Preview component
│   │   ├── WysiwygView.tsx   # REMOVE: Replace with MilkdownEditor
│   │   └── MilkdownEditor.tsx # NEW: Milkdown-based WYSIWYG component
│   └── Preview/
│       └── Preview.tsx       # EXISTING: Reuse for preview-only mode
├── hooks/
│   ├── useKeyboardShortcuts.ts # MODIFY: Add ⌘/, ⌃1-4 handlers
│   └── useMilkdown.ts        # NEW: Milkdown editor hook
├── stores/
│   └── editorStore.ts        # MODIFY: View mode state, cycling logic
└── types/
    └── editor.ts             # EXISTING: ViewMode enum already defined

src-tauri/                    # Rust backend
└── src/
    ├── menu.rs               # MODIFY: Update View menu items (⌃1-4)
    └── commands/
        └── preferences.rs    # MODIFY: Persist last-used view mode
```

**Structure Decision**: Existing Tauri hybrid structure retained. New Milkdown component added to `src/components/Editor/`. Backend changes minimal (menu shortcuts only).

## Complexity Tracking

> No Constitution Check violations requiring justification.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Dual-engine (CodeMirror + Milkdown) | Each engine optimal for its mode | Single engine cannot provide both source editing with line numbers AND true WYSIWYG |

## Content Layout Implementation

### CSS Variables Strategy

All content layout constraints are implemented via CSS custom properties in `globals.css`:

```css
:root {
  --content-max-width: 780px;  /* Maximum text content width */
  --content-padding: 40px;      /* Minimum side padding */
}
```

### Layout Application by Component

| Component | CSS Selector | Layout Application |
|-----------|-------------|-------------------|
| Preview | `.preview-content` | `max-width`, `padding`, `margin: 0 auto` |
| WYSIWYG (Milkdown) | `.milkdown-editor .ProseMirror` | `max-width`, `padding`, `margin: 0 auto` |
| Editor (CodeMirror) | `.editor-shell .cm-content` | `max-width`, `padding`, `margin: 0 auto` |

### Responsive Behavior

```
Window width ≥ 860px (780 + 40×2):
┌──────────────────────────────────────────────────┐
│         │◄─── 780px max ───►│         │
│  ≥40px  │    Text Content    │  ≥40px  │
│         │                    │         │
└──────────────────────────────────────────────────┘

Window width < 860px:
┌─────────────────────────────┐
│ 40px │◄─ auto ─►│ 40px │
│      │  Content  │      │
└─────────────────────────────┘
```

### Files to Modify

- `src/styles/globals.css` - Add CSS variables and layout rules for all components
