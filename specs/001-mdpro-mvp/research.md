# Research: mdpro MVP

**Branch**: `001-mdpro-mvp` | **Date**: 2026-01-17

## Overview

This document captures technology research and decisions for the mdpro Markdown editor MVP.

---

## 1. Desktop Framework: Tauri 2.0

### Decision
Use **Tauri 2.0** as the desktop application framework.

### Rationale
- **Lightweight**: Apps typically < 10MB (vs Electron's 100MB+)
- **Performance**: Startup in < 0.5 seconds, idle memory ~30-40MB
- **Native macOS integration**: Uses WKWebView, native menus, system dialogs
- **Security**: Rust backend with opt-in API access
- **Active development**: v2.0 released October 2024, strong community

### Alternatives Considered

| Alternative | Rejected Because |
|-------------|------------------|
| Electron | Large bundle size (100MB+), high memory usage (200-300MB idle) |
| Wails (Go) | Smaller ecosystem, less macOS-specific optimization |
| Native Swift | No web view benefits, steeper learning curve for web developers |

### Sources
- [Tauri 2.0 Stable Release](https://v2.tauri.app/blog/tauri-20/)
- [Tauri GitHub](https://github.com/tauri-apps/tauri)

---

## 2. Frontend Framework: React 18 + TypeScript

### Decision
Use **React 18** with **TypeScript 5.x** for the frontend UI.

### Rationale
- **Ecosystem**: Largest ecosystem of UI libraries and tooling
- **TypeScript**: Strong typing prevents runtime errors
- **CodeMirror integration**: Excellent React wrapper available (@uiwjs/react-codemirror)
- **Developer experience**: Hot module replacement, excellent debugging
- **Talent pool**: Widely known framework

### Alternatives Considered

| Alternative | Rejected Because |
|-------------|------------------|
| Vue 3 | Smaller CodeMirror ecosystem, fewer Tauri examples |
| Svelte | Less mature tooling, smaller ecosystem |
| Solid.js | Too new, limited library support |

---

## 3. Code Editor: CodeMirror 6

### Decision
Use **CodeMirror 6** as the text editing engine.

### Rationale
- **Performance**: Optimized for large documents, virtual rendering
- **Extensibility**: Modular architecture for custom extensions
- **Markdown support**: Official @codemirror/lang-markdown package
- **WYSIWYG potential**: Can hide/show syntax with decorations
- **Active maintenance**: Regular updates, responsive maintainer

### Alternatives Considered

| Alternative | Rejected Because |
|-------------|------------------|
| Monaco Editor | Heavy (from VS Code), overkill for markdown |
| ProseMirror | Schema-based, harder to extend for raw markdown |
| TipTap | WYSIWYG-first, harder to show raw syntax |
| Ace Editor | Older architecture, less performant |

### Sources
- [CodeMirror Documentation](https://codemirror.net/)
- [@codemirror/lang-markdown](https://github.com/codemirror/lang-markdown)

---

## 4. WYSIWYG Implementation Pattern

### Decision
Implement WYSIWYG using CodeMirror 6 decorations to hide syntax on unfocused lines.

### Rationale
- **codemirror-rich-markdoc pattern**: Uses lezer-markdown tokenizer, applies `cm-markdoc-hidden` class to syntax characters
- **Block widgets**: Complex elements (tables, blockquotes) replaced with rendered HTML widgets
- **Cursor-aware**: Widgets disappear when cursor enters, showing raw source
- **Proven approach**: Inspired by HyperMD (CodeMirror 5), adapted for CM6

### Implementation Approach
1. Use CM6 StateFields to track focused line
2. Apply Decoration.mark() to hide syntax on unfocused lines
3. Use Decoration.widget() for complex block elements
4. Reveal raw source on cursor enter via transaction effects

### Sources
- [codemirror-rich-markdoc](https://github.com/segphault/codemirror-rich-markdoc)
- [Ixora CM6 Extensions](https://codeberg.org/retronav/ixora)
- [ink-mde](https://github.com/davidmyersdev/ink-mde)

---

## 5. Markdown Parsing

### Decision
Use **pulldown-cmark** (Rust) for backend parsing and **marked** (JS) for frontend preview.

### Rationale

**Backend (pulldown-cmark)**:
- Native Rust, blazing fast
- CommonMark compliant
- GFM extensions (tables, strikethrough, task lists)
- Streaming parser, memory efficient

**Frontend (marked)**:
- Fast JavaScript parser
- GFM support out of the box
- Extensible for custom syntax (mark, underline)
- Works well with DOMPurify for sanitization

### Alternatives Considered

| Alternative | Rejected Because |
|-------------|------------------|
| markdown-it | Slower than marked for large files |
| remark/unified | Complex AST manipulation overhead |
| comrak (Rust) | Larger binary size than pulldown-cmark |

---

## 6. State Management: Zustand

### Decision
Use **Zustand** for frontend state management.

### Rationale
- **Simplicity**: Minimal boilerplate, intuitive API
- **TypeScript**: Excellent type inference
- **Performance**: No unnecessary re-renders
- **Size**: ~1KB gzipped
- **DevTools**: Redux DevTools compatible

### Alternatives Considered

| Alternative | Rejected Because |
|-------------|------------------|
| Redux Toolkit | Overkill for single-user app, more boilerplate |
| Jotai | Atomic model less suited for document state |
| MobX | Magic reactivity harder to debug |

---

## 7. Styling: TailwindCSS

### Decision
Use **TailwindCSS 3.x** for styling.

### Rationale
- **Rapid development**: Utility classes speed up UI work
- **Dark mode**: Built-in dark mode support with `dark:` prefix
- **Customization**: Easy to define theme colors
- **Tree shaking**: Only used classes in production bundle
- **Consistency**: Design tokens prevent one-off values

### Theme Implementation
```css
/* tailwind.config.js */
module.exports = {
  darkMode: 'class', // Toggle via class on html element
  theme: {
    extend: {
      colors: {
        editor: {
          bg: 'var(--editor-bg)',
          text: 'var(--editor-text)',
          // ...
        }
      }
    }
  }
}
```

---

## 8. Build Tooling: Vite

### Decision
Use **Vite** as the frontend build tool.

### Rationale
- **Speed**: Instant HMR, fast cold start
- **Tauri integration**: Official Tauri Vite plugin
- **Modern**: Native ES modules, optimized production builds
- **Ecosystem**: Wide plugin availability

### Configuration
```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
})
```

---

## 9. Testing Strategy

### Decision
Three-tier testing approach:
1. **Unit tests**: Vitest for frontend logic
2. **Backend tests**: cargo test for Rust
3. **E2E tests**: Playwright for user flows

### Rationale
- **Vitest**: Fast, Vite-native, Jest-compatible API
- **cargo test**: Rust standard, no additional setup
- **Playwright**: Cross-browser, good async support

### Test Coverage Priorities
1. File operations (open, save, create)
2. Markdown parsing edge cases
3. Auto-save and draft recovery
4. Editor mode switching
5. Keyboard shortcuts

---

## 10. Auto-save Implementation

### Decision
Auto-save drafts to temporary location every 30 seconds.

### Implementation Approach
```rust
// Draft storage location
~/.mdpro/drafts/{document_hash}.draft.md

// Draft metadata
~/.mdpro/drafts/{document_hash}.meta.json
{
  "original_path": "/path/to/file.md",
  "last_modified": "2026-01-17T10:30:00Z",
  "recovered": false
}
```

### Recovery Flow
1. On app startup, scan `~/.mdpro/drafts/` for `.meta.json` files
2. For each, check if `recovered: false` and draft is newer than original
3. Prompt user: "Recover unsaved changes to {filename}?"
4. On accept: Load draft content, mark as modified
5. On reject: Delete draft files

---

## Summary of Decisions

| Area | Decision | Confidence |
|------|----------|------------|
| Framework | Tauri 2.0 | High |
| Frontend | React 18 + TypeScript | High |
| Editor | CodeMirror 6 | High |
| WYSIWYG | CM6 decorations + widgets | Medium |
| Markdown (Rust) | pulldown-cmark | High |
| Markdown (JS) | marked + DOMPurify | High |
| State | Zustand | High |
| Styling | TailwindCSS | High |
| Build | Vite | High |
| Testing | Vitest + Playwright | High |

All NEEDS CLARIFICATION items from Technical Context have been resolved.
