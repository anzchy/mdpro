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

### Adding a New IPC Command

1. Define the command in `src-tauri/src/commands/<module>.rs`

2. Register it in `src-tauri/src/commands/mod.rs` → `handlers()`

3. Create typed wrapper in `src/services/<service>.ts`

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

- **Atomic commits**: see "Git Commit Conventions" above and `.claude/rules/00-engineering-principles.md`.
- **Test-driven development**: see `.claude/rules/10-tdd.md` for the mdpro-specific test matrix and Vitest/XCTest commands.
- **Changelog**: every release-affecting change updates `CHANGELOG.md` under `## [Unreleased]`, moved to a versioned section on release. Format follows [Keep a Changelog](https://keepachangelog.com/).

## Cross-Platform Development (Mac + WSL)

This project is developed on **macOS** (primary) and **WSL/Linux** (secondary). Line ending mismatches are a common pitfall.

### Line Endings — Always LF

`.gitattributes` enforces LF for all text files. **Never commit CRLF.**

```bash
# Verify a file's line endings
file src/App.tsx          # Should say "ASCII text" not "CRLF line terminators"
```

### If you see mass "modified" files after a pull

This is almost always a CRLF/LF mismatch — not real code changes. Verify:

```bash
git diff --stat HEAD      # Same insertions = deletions → line ending issue
file src/App.tsx          # "CRLF line terminators" confirms it
```

Fix by restoring all files to the committed LF versions:

```bash
git checkout -- .
```

### Re-normalize after editing `.gitattributes`

```bash
git add --renormalize .
git commit -m "chore: normalize line endings to LF"
```

### Never set `core.autocrlf = true`

Windows/WSL default is `autocrlf=true` which converts LF→CRLF on checkout. This causes every line to appear modified when diffing against Mac commits. Disable it:

```bash
git config core.autocrlf false        # repo-level
git config --global core.autocrlf false  # or globally on WSL
```

The `.gitattributes` `eol=lf` rule is authoritative — no per-developer config needed.

## Constraints

- Local files only (no cloud sync)

- No third-party plugin marketplace (the internal `src/plugins/` Milkdown/CodeMirror architecture is editor-internal only)

- HTML export only (no PDF/Word)

- Max file size: 10MB

## Logging Rules

After implementing any new feature, **always add structured logging** to enable debugging in production builds:

### Rust Backend (src-tauri/)

```rust
use tauri_app_lib::models::{LogEntryPayload, LogLevel, LogStatus};
use tauri_app_lib::services::logger;

// Log operation start
logger::log_event(LogEntryPayload {
    level: LogLevel::Info,
    event: "feature.action".to_string(),  // e.g., "file.open", "window.create"
    status: LogStatus::Start,
    action_id: None,
    context: Some(json!({ "key": "value" })),
    duration_ms: None,
    error: None,
});

// Log success/failure
logger::log_event(LogEntryPayload {
    level: LogLevel::Info,  // or LogLevel::Error for failures
    event: "feature.action".to_string(),
    status: LogStatus::Success,  // or LogStatus::Fail
    action_id: None,
    context: Some(json!({ "result": "details" })),
    duration_ms: Some(elapsed_ms),
    error: None,  // or Some(error_message) for failures
});
```

### TypeScript Frontend (src/)

```typescript
import { loggingService } from './services/loggingService';

// Log UI events
loggingService.logEventSync({
    level: 'info',
    event: 'ui.component.action',  // e.g., "ui.button.click", "tab.switch"
    status: 'success',
    actionId: loggingService.generateActionId(),
    context: { screen: 'editor', controlId: 'button-id' },
});
```

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

## Debugging Strategies

### Tauri Dev WebView DevTools

**In **``**, right-click anywhere in the window → "Inspect Element"** to open WebView DevTools with full Chrome DevTools capabilities:

- Elements / DOM inspection

- Console logs

- Network requests

- Sources with breakpoints

- Performance profiling

This is often overlooked but provides the best of both worlds: full DevTools + Tauri APIs.

### Enable DevTools in Production Builds (for internal testing)

Add to `tauri.conf.json` for test builds:

```json
{
  "app": {
    "windows": [{
      "devtools": true
    }]
  }
}
```

Or trigger via keyboard shortcut (add to Rust backend):

```rust
#[tauri::command]
fn toggle_devtools(window: tauri::Window) {
    if window.is_devtools_open() {
        window.close_devtools();
    } else {
        window.open_devtools();
    }
}
```

**Note**: Disable DevTools in public releases for security.

### When to use `pnpm dev` (localhost:1420)

Use browser-based debugging for **frontend-only issues**:

- **React/UI bugs**: Component rendering, state management, CSS issues

- **Editor issues**: Milkdown/CodeMirror initialization, schema errors, plugin conflicts

- **Console errors**: JavaScript exceptions, React warnings, unhandled promises

- **Network inspection**: API calls, timing issues (DevTools Network tab)

- **DOM inspection**: Element structure, computed styles, event listeners

- **Hot reload**: Faster iteration when making frequent UI changes

**Advantages**: Chrome DevTools, breakpoints, React DevTools extension, instant feedback

**Limitations**: No Tauri APIs (file dialogs, native menus, window management)

### When to use `pnpm tauri dev` + JSONL logs

Use Tauri + log files for **integration and Tauri-specific issues**:

- **File operations**: Open, save, encoding detection, file watcher

- **IPC debugging**: Frontend ↔ Rust communication, invoke/event flow

- **Native features**: Menu events, window lifecycle, drag-drop from Finder

- **App startup**: Launch paths, single-instance handling, preferences loading

- **Production simulation**: Testing behavior closer to the built app

- **Race conditions**: Async timing issues between Tauri and React

**Commands**:

```bash
# Watch logs in real-time
tail -f ~/.mdpro/mdpro.log | jq .

# Filter by event type
tail -f ~/.mdpro/mdpro.log | jq 'select(.event | startswith("file."))'

# Filter by level
tail -f ~/.mdpro/mdpro.log | jq 'select(.level == "error")'
```

### Debug Workflow

1. **Start with localhost** if unsure - faster iteration, better tooling

2. **Switch to Tauri dev** when:

   - Issue only reproduces in Tauri window

   - Need to test file/menu/window operations

   - Debugging IPC or Rust backend

3. **Use both simultaneously**: localhost for UI, logs for backend correlation

## Active Technologies

- TypeScript 5.8 (frontend), Rust 2021 Edition (backend) + React 19, Tauri 2.0, CodeMirror 6, Milkdown (NEW), Zustand 4 (002-polish-wysiwyg)

- N/A (local file system via Tauri) (002-polish-wysiwyg)

- TypeScript 5.8 (frontend), Rust 2021 Edition (backend - unchanged) + React 19, Tauri 2.0, CodeMirror 6 (@codemirror/\*), Milkdown 7.18 (@milkdown/kit, @milkdown/react), Zustand 4 (003-redesign-plugin-system)

- N/A (no new storage requirements) (003-redesign-plugin-system)

- TypeScript 5.8 (frontend), Rust 2021 Edition (backend) + Tauri 2.0, React 19, Zustand 4, CodeMirror 6, Milkdown 7 (004-minor-fix)

- Local filesystem (via Tauri), JSON preferences file (004-minor-fix)

- JSONL file at `~/.mdpro/mdpro.log`, preferences in existing `preferences.json` (005-add-concrete-logging)

- TypeScript 5.8 (frontend), Rust 2021 Edition (backend) + React 19, Tauri 2.0, CodeMirror 6, Milkdown 7.18, Zustand 4.5.4, Vite 7 (006-toc-tab-and-new-features)

- Local filesystem via Tauri, JSON preferences file at `~/.mdpro/preferences.json` (006-toc-tab-and-new-features)

- Local filesystem, `~/.mdpro/` for config (server.port, server.token) (007-feat/mcp-server)

## Recent Changes

- 002-polish-wysiwyg: Added TypeScript 5.8 (frontend), Rust 2021 Edition (backend) + React 19, Tauri 2.0, CodeMirror 6, Milkdown (NEW), Zustand 4

## Plugin System (003-redesign-plugin-system)

- Plugin definitions live in `src/plugins/` with `core/`, `codemirror/`, and `milkdown/` subfolders.

- Register plugins in `src/plugins/index.ts` and configure defaults in `src/plugins/core/pluginConfig.ts`.

- Use `codemirrorExtension` for source mode and `milkdownPlugin` for WYSIWYG mode; plugins may support both.

- Plugin lifecycle is managed by `pluginRegistry` (initialized in `src/components/Editor/Editor.tsx` and `src/hooks/useMilkdown.ts`).

- Editor events (doc/selection/focus) are emitted via `pluginRegistry.emitEvent` and consumed through `EditorContext.events`.

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

