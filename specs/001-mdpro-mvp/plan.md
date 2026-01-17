# Implementation Plan: mdpro MVP

**Branch**: `001-mdpro-mvp` | **Date**: 2026-01-17 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-mdpro-mvp/spec.md`

## Summary

mdpro是一款面向macOS的本地Markdown编辑器，结合Typora的WYSIWYG体验和bm.md的现代化设计。技术方案采用Tauri 2.0框架（Rust后端 + Web前端），前端使用React + TypeScript + CodeMirror 6实现编辑器，支持分屏预览和WYSIWYG两种模式。

## Technical Context

**Language/Version**: Rust 1.75+ (backend), TypeScript 5.x (frontend)
**Framework**: Tauri 2.0
**Primary Dependencies**:
- Frontend: React 18, CodeMirror 6, Vite, TailwindCSS
- Backend: tauri, pulldown-cmark, serde, notify (file watching)

**Storage**: Local filesystem (.md files), JSON config (preferences)
**Testing**: Vitest (frontend), cargo test (backend), Playwright (E2E)
**Target Platform**: macOS 13+ (Ventura), Apple Silicon (ARM64)
**Project Type**: Desktop application (Tauri)
**Performance Goals**:
- App startup < 2 seconds
- Preview latency < 100ms
- 60fps smooth editing
- Memory < 500MB

**Constraints**:
- No cloud sync (local only)
- No plugin system
- HTML export only (no PDF/Word)

**Scale/Scope**: Single-user desktop app, files typically < 5MB

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

> Note: Constitution template not customized for this project. Using sensible defaults.

| Principle | Status | Notes |
|-----------|--------|-------|
| Simplicity | ✅ Pass | MVP scope well-bounded, no over-engineering |
| Test Coverage | ✅ Pass | Unit + integration + E2E tests planned |
| Security | ✅ Pass | Local files only, no network/auth complexity |
| Performance | ✅ Pass | Tauri's lightweight architecture meets targets |

## Project Structure

### Documentation (this feature)

```text
specs/001-mdpro-mvp/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (IPC commands)
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
src-tauri/                    # Rust backend (Tauri)
├── src/
│   ├── main.rs              # Entry point, window setup
│   ├── lib.rs               # Tauri commands export
│   ├── commands/            # IPC command handlers
│   │   ├── mod.rs
│   │   ├── file.rs          # Open, save, create file operations
│   │   ├── export.rs        # HTML export
│   │   └── preferences.rs   # User preferences
│   ├── services/            # Business logic
│   │   ├── mod.rs
│   │   ├── markdown.rs      # Markdown parsing (pulldown-cmark)
│   │   ├── file_watcher.rs  # External file change detection
│   │   └── draft.rs         # Auto-save draft management
│   └── models/              # Data structures
│       ├── mod.rs
│       ├── document.rs
│       └── preferences.rs
├── Cargo.toml
└── tauri.conf.json

src/                          # Frontend (React + TypeScript)
├── components/
│   ├── Editor/              # CodeMirror editor wrapper
│   │   ├── Editor.tsx
│   │   ├── SplitView.tsx    # Split-pane mode
│   │   ├── WysiwygView.tsx  # WYSIWYG mode
│   │   └── extensions/      # CM6 extensions
│   ├── Preview/             # Markdown preview renderer
│   │   ├── Preview.tsx
│   │   └── styles/
│   ├── Sidebar/             # File list sidebar
│   │   ├── Sidebar.tsx
│   │   └── FileItem.tsx
│   ├── Toolbar/             # Top toolbar
│   │   └── Toolbar.tsx
│   └── common/              # Shared UI components
├── hooks/                   # Custom React hooks
│   ├── useDocument.ts
│   ├── useEditor.ts
│   ├── useTheme.ts
│   └── useAutoSave.ts
├── services/                # Tauri IPC wrappers
│   ├── fileService.ts
│   ├── exportService.ts
│   └── preferencesService.ts
├── stores/                  # State management (Zustand)
│   ├── documentStore.ts
│   ├── editorStore.ts
│   └── themeStore.ts
├── styles/                  # Global styles + themes
│   ├── globals.css
│   ├── themes/
│   │   ├── light.css
│   │   └── dark.css
│   └── editor/
├── types/                   # TypeScript type definitions
│   ├── document.ts
│   └── editor.ts
├── App.tsx
├── main.tsx
└── vite.config.ts

tests/
├── e2e/                     # Playwright E2E tests
│   ├── file-operations.spec.ts
│   ├── editor.spec.ts
│   └── export.spec.ts
└── unit/                    # Vitest unit tests
    ├── components/
    └── services/
```

**Structure Decision**: Tauri project structure with `src-tauri/` for Rust backend and `src/` for React frontend. This follows Tauri 2.0 conventions and provides clear separation between native and web layers.

## Complexity Tracking

No complexity violations. Architecture follows standard Tauri patterns.

## Technology Decisions Summary

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Framework | Tauri 2.0 | Lightweight (< 10MB), fast startup, native macOS integration |
| Frontend | React 18 + TypeScript | Mature ecosystem, excellent tooling, wide talent pool |
| Editor | CodeMirror 6 | Best-in-class for code/text editing, extensible for WYSIWYG |
| WYSIWYG | codemirror-rich-markdoc pattern | Hides syntax on unfocused lines, proven approach |
| Markdown (Rust) | pulldown-cmark | Fast, CommonMark compliant, GFM support |
| Markdown (JS) | marked + DOMPurify | Fast rendering, sanitized HTML output |
| State | Zustand | Simple, TypeScript-friendly, no boilerplate |
| Styling | TailwindCSS | Rapid UI development, consistent design |
| Build | Vite | Fast HMR, optimized builds |
| Testing | Vitest + Playwright | Modern, fast, good Tauri integration |
| Syntax Highlighting | highlight.js | Wide language support, lightweight, customizable themes |

## Code Syntax Highlighting Languages

Per FR-010, the following 20+ languages are supported for code block syntax highlighting:

### Tier 1 - Primary Languages (10)
| Language | highlight.js ID | Notes |
|----------|-----------------|-------|
| JavaScript | `javascript` / `js` | Includes ES6+ |
| TypeScript | `typescript` / `ts` | |
| Python | `python` / `py` | |
| Rust | `rust` / `rs` | |
| Go | `go` / `golang` | |
| Java | `java` | |
| C/C++ | `c` / `cpp` | |
| Swift | `swift` | macOS native development |
| Kotlin | `kotlin` | |
| Ruby | `ruby` / `rb` | |

### Tier 2 - Web & Scripting (8)
| Language | highlight.js ID | Notes |
|----------|-----------------|-------|
| HTML | `html` / `xml` | |
| CSS | `css` | Includes SCSS/LESS |
| JSON | `json` | |
| YAML | `yaml` / `yml` | |
| Bash/Shell | `bash` / `shell` | |
| SQL | `sql` | |
| Markdown | `markdown` / `md` | Meta! |
| PHP | `php` | |

### Tier 3 - Additional (6)
| Language | highlight.js ID | Notes |
|----------|-----------------|-------|
| C# | `csharp` / `cs` | |
| Objective-C | `objectivec` | Legacy macOS |
| Scala | `scala` | |
| Lua | `lua` | |
| R | `r` | Data science |
| Dockerfile | `dockerfile` | |

**Total: 24 languages** (exceeds FR-010 minimum of 20)
