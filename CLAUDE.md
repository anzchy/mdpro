# [CLAUDE.md](http://CLAUDE.md)

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## gstack

Use the `/browse` skill from gstack for all web browsing tasks. Never use `mcp__claude-in-chrome__*` tools.

Available gstack skills:
`/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/design-consultation`, `/review`, `/ship`, `/land-and-deploy`, `/canary`, `/benchmark`, `/browse`, `/qa`, `/qa-only`, `/design-review`, `/setup-browser-cookies`, `/setup-deploy`, `/retro`, `/investigate`, `/document-release`, `/codex`, `/cso`, `/autoplan`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/gstack-upgrade`

Setup: `git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack && cd ~/.claude/skills/gstack && ./setup`

## Lessons Learned

See [`progress.md`](./progress.md) for accumulated implementation lessons — bug post-mortems, root causes, and patterns to avoid.

## Design System

Always read [`DESIGN.md`](./DESIGN.md) before making any visual or UI decisions.
Aesthetic register, "memorable thing", and decisions log live there. Enforceable
rules live in `.claude/rules/30-34`:

- `30-ui-consistency.md` — index + 6 universal discipline rules
- `31-design-tokens.md` — color, type, spacing, z-index reference
- `32-component-patterns.md` — modal, context menu, button, code block
- `33-focus-indicators.md` — 4 focus patterns, WCAG enforcement
- `34-dark-theme.md` — `.theme-light` / `.theme-dark` convention

Do not deviate without explicit user approval. In QA mode, flag any code that
doesn't match the rules.

## Project Overview

mdpro is a local Markdown editor for macOS, combining Typora's WYSIWYG experience with modern design. Built with Tauri 2.0 (Rust backend + React frontend).

**Target**: macOS 13+, Apple Silicon (ARM64)

## Development Commands

```bash
pnpm install              # Install dependencies
pnpm tauri dev            # Start development (frontend + Tauri window)
pnpm dev                  # Frontend only (Vite dev server, no Tauri)
pnpm build                # Build frontend (runs tsc + vite build)
pnpm tauri build          # Build production app (.dmg)
```

### Rust Backend Commands

```bash
cd src-tauri
cargo check               # Check compilation
cargo test                # Run unit tests
cargo fmt                 # Format code
cargo clippy              # Lint
```

## Architecture

```
src-tauri/              # Rust backend (Tauri 2.0)
├── src/
│   ├── main.rs         # Entry point, app setup, event handlers
│   ├── lib.rs          # Module exports
│   ├── menu.rs         # Native macOS menu bar (File, Edit, View, Theme menus)
│   ├── launch.rs       # File association & single-instance handling
│   ├── commands/       # IPC command handlers
│   │   ├── file.rs     # File operations (open, save, close, reload)
│   │   ├── export.rs   # HTML export & markdown rendering
│   │   ├── draft.rs    # Auto-save draft recovery
│   │   └── preferences.rs
│   ├── services/       # Business logic
│   │   ├── file_watcher.rs  # External file change detection (notify crate)
│   │   ├── encoding.rs      # Character encoding detection
│   │   └── markdown.rs      # pulldown-cmark rendering
│   └── models/         # Data structures (Document, Draft, Preferences)

src/                    # React frontend
├── App.tsx             # Main app shell, orchestrates all features
├── components/
│   ├── Editor/         # CodeMirror editor (SplitView, WysiwygView)
│   ├── Preview/        # Markdown preview pane
│   ├── Sidebar/        # Document tabs
│   └── Toolbar/        # Title bar
├── hooks/
│   ├── useDocument.ts  # Document CRUD operations
│   ├── useMenuEvents.ts # Listens to menu:action events from Rust
│   ├── useFileWatcher.ts # Handles external file changes
│   └── useAutoSave.ts  # Draft auto-save timer
├── services/           # Tauri IPC wrappers (typed invoke calls)
└── stores/             # Zustand state (documentStore, editorStore, themeStore)
```

## Key Technologies

| Layer         | Technology                                             |
| ------------- | ------------------------------------------------------ |
| Framework     | Tauri 2.0                                              |
| Frontend      | React 19 + TypeScript + Vite 7                         |
| Editor        | CodeMirror 6 (@uiw/react-codemirror)                   |
| Markdown      | pulldown-cmark (Rust), marked + DOMPurify (JS preview) |
| State         | Zustand                                                |
| File dialogs  | rfd (Rust)                                             |
| File watching | notify (Rust)                                          |

## IPC & Event System

### Commands (Frontend → Rust)

Frontend calls Rust via `invoke()`. Commands are registered in `src-tauri/src/commands/mod.rs`:

```typescript
// src/services/fileService.ts
import { invoke } from '@tauri-apps/api/core';
const result = await invoke<OpenFileResult>('open_file', { path, encoding });
```

Key commands: `open_file`, `save_file`, `create_document`, `export_html`, `export_rendered_html`, `save_draft`, `get_preferences`, `get_app_version`

### Events (Rust → Frontend)

Rust emits events that frontend listens to via `listen()`:

| Event           | Payload                | Source                                        |
| --------------- | ---------------------- | --------------------------------------------- |
| `menu:action`   | `{ action, value }`    | Native menu clicks (menu.rs)                  |
| `file:open`     | `string[]`             | Single-instance file open (launch.rs)         |
| `file:changed`  | `{ path, changeType }` | External file modification (file\_watcher.rs) |
| `theme:changed` | `"light" \| "dark"`    | System theme change                           |
| `mcp:write_document` | `{ document_id, content, window_label }` | MCP `write_document` tool (http\_server.rs) → `useMcpEvents.ts` |
| `mcp:insert_content` | `{ document_id, text, position, window_label }` | MCP `insert_content` tool (http\_server.rs) → `useMcpEvents.ts` |
| `mcp:create_document` | `{ document_id, content, window_label }` | MCP `create_document` tool (http\_server.rs) → `useMcpEvents.ts` |
| `mcp:table_action` | `{ document_id, action, payload, window_label }` | MCP table tools (http\_server.rs) → `useMcpEvents.ts` |

## Menu System

Native macOS menu defined in `src-tauri/src/menu.rs`. Menu events are handled via `menu:action` event:

- File: New (⌘N), Open (⌘O), Save (⌘S), Export HTML (⌘⇧E), Close (⌘W)

- View: Source (⌃2), WYSIWYG (⌃4), Toggle Sidebar (⌘⇧L)

- Format: Highlight Selection (⌘⇧H)

- Theme: Light, Dark, System

## Release Workflow

See `.claude/rules/40-version-bump.md` for the full procedure (3 files must
stay in sync: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`).
Or use the `/bump` command, which handles all three atomically.

```bash
# 1. Bump versions (use /bump or follow rule 40)
# 2. Test locally
pnpm tauri build

# 3. Tag and push (triggers GitHub Actions → builds DMG)
git tag v0.1.2
git push origin master --tags
```

## Git Commit Conventions

This project follows **atomic commit** principles. Each commit should contain one logical change.

### Commit Message Format

```
<type>(<scope>): <short summary>

<body>

Co-Authored-By: Claude <noreply@anthropic.com>
```

### Types

| Type       | Use For          | Example Scope                    |
| ---------- | ---------------- | -------------------------------- |
| `feat`     | New features     | `toc`, `tabs`, `image`, `editor` |
| `fix`      | Bug fixes        | `save`, `encoding`, `menu`       |
| `docs`     | Documentation    | `readme`, `changelog`, `specs`   |
| `style`    | CSS/formatting   | `css`, `theme`                   |
| `refactor` | Code restructure | `commands`, `stores`             |
| `test`     | Test files       | `fixtures`, `unit`               |
| `chore`    | Build/tooling    | `deps`, `config`, `tooling`      |
| `perf`     | Performance      | `render`, `parsing`              |

### Splitting Strategy for mdpro

When making large changes, split by architectural layer:

1. **Backend first**: `src-tauri/src/commands/*.rs` - Rust commands

2. **Services**: `src/services/*.ts` - TypeScript IPC wrappers

3. **Stores**: `src/stores/*.ts` - Zustand state

4. **Hooks**: `src/hooks/*.ts` - React hooks

5. **Components**: `src/components/**/*.tsx` - UI components

6. **Styles**: `src/styles/*.css` - CSS updates

7. **Integration**: `src/App.tsx` - Wiring everything together

8. **Docs/Tests**: Documentation and test fixtures

### Example Workflow

```bash
# Stage only TOC-related files
git add src-tauri/src/commands/toc.rs   
        src/services/tocService.ts   
        src/stores/tocStore.ts   
        src/hooks/useTOC.ts   
        src/components/Sidebar/TOCSidebar.tsx

# Verify what's staged
git diff --cached --stat

# Commit with descriptive message
git commit -m "feat(toc): add table of contents with heading extraction

Implement document outline sidebar using pulldown-cmark for parsing.
Supports hierarchical display, scroll-spy, and click-to-navigate.

Tested: Manual QA with H1-H6 headings"
```

### Commit Checklist

Before each commit, verify:

- [ ] Only related files are staged (`git diff --cached --stat`)

- [ ] Project still builds (`pnpm build` or `cargo check`)

- [ ] Message follows `type(scope): summary` format

- [ ] Body explains WHY, not WHAT

- [ ] No secrets or large binaries included

## Spec-Driven Development

Feature specifications live in `specs/001-mdpro-mvp/`:

- `spec.md` - Requirements and user stories

- `plan.md` - Technical architecture

- `tasks.md` - Implementation tasks

- `contracts/` - IPC command definitions



### Project Constitution

- **Atomic commits**: see "Git Commit Conventions" above.
- **Test-driven development**: see `.claude/rules/10-tdd.md` for the mdpro-specific test matrix and where test files must live.
- **Changelog**: every release-affecting change updates `CHANGELOG.md` under `## [Unreleased]`, moved to a versioned section on release. Format follows [Keep a Changelog](https://keepachangelog.com/).

## Cross-Platform Development (Mac + WSL)

Developed on macOS (primary) and WSL/Linux (secondary). Two must-follow rules:

- **Always LF.** `.gitattributes` (`* text=auto eol=lf`) is authoritative. **Never commit CRLF.**
- **Never set `core.autocrlf = true`** (use `git config core.autocrlf false` on WSL).

Mass "modified" files after a pull, re-normalizing, and verification commands: see [`docs/guide/cross-platform-wsl.md`](./docs/guide/cross-platform-wsl.md).

## Constraints

- Local files only (no cloud sync)

- No third-party plugin marketplace (the internal `src/plugins/` Milkdown/CodeMirror architecture is editor-internal only)

- HTML export only (no PDF/Word)

- Max file size: 10MB

## Logging Rules

After implementing any new feature, **always add structured logging** to enable debugging in production builds.

Rust (`logger::log_event`) and TypeScript (`loggingService.logEventSync`) code samples live in `.claude/rules/20-logging-and-docs.md` (auto-loads when commands/services/hooks/components are touched).

### Event Naming Convention

- UI events: `ui.<component>.<action>` (e.g., `ui.button.click`, `ui.menu.select`)

- File events: `file.<action>` (e.g., `file.open`, `file.save`, `file.open.external`)

- App events: `app.<action>` (e.g., `app.launch`, `app.ready`, `app.quit`)

- Window events: `window.<action>` (e.g., `window.open`, `window.close`, `window.focus`)

- Tab events: `tab.<action>` (e.g., `tab.open`, `tab.close`, `tab.switch`)

### Log File Location

- Path: `~/.mdpro/mdpro.log`

- Format: JSONL (one JSON object per line)

- Verify with: `tail -f ~/.mdpro/mdpro.log | jq .`

## Debugging

DevTools in dev/prod builds, when to use `pnpm dev` vs `pnpm tauri dev` + JSONL logs, and the debug workflow: see [`docs/guide/debugging.md`](./docs/guide/debugging.md).

## Typora-Parity Phase 1 Scope (rendering)

Phase 1 wires math (`$…$` / `$$…$$`), footnotes, autolinks, and emoji on the
**canonical Rust render surface** — i.e. the Preview pane and HTML export
(`render_markdown` → `sanitize_html` / MathML export). That is the supported
math/footnote path for Phase 1.

**Explicitly deferred to Phase 2 / follow-up:**

- **Milkdown WYSIWYG (surface 4)** does NOT typeset math or render footnotes.
  There is no Milkdown math/footnote plugin in `src/plugins/milkdown/`. In source
  mode `$…$` and `[^1]` remain visible as plain literal text (readable, not broken
  markup) — this is the accepted Phase 1 behavior, not a bug.
- **Export `marked` fallback** (`exportService.renderMarkdown` catch block, used
  only when the Rust IPC throws) renders neither math nor footnotes. Accepted
  degradation (plan decision A1); pinned by `tests/export-fallback-degradation.test.ts`.

