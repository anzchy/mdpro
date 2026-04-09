# Upgrade `.claude/` Config — Lessons from xiaolai/vmark

> Source: https://github.com/xiaolai/vmark/tree/main/.claude
> Date: 2026-03-12 (revised for mdpro)
> Status: Active — ready to execute

---

## Current Baseline (Verified 2026-03-12)

```
.claude/
├── settings.local.json            # Personal only — NO settings.json (missing!)
├── agents/ (9 agents)             # Well-adapted for mdpro
│   ├── auditor.md
│   ├── impact-analyst.md
│   ├── implementer.md
│   ├── manual-test-author.md
│   ├── planner.md
│   ├── release-steward.md
│   ├── spec-guardian.md
│   ├── test-runner.md
│   └── verifier.md
├── commands/ (25 files — bloated)
│   ├── bump.md                    # Good — already adapted for mdpro 3-file bump
│   ├── test-guide.md              # STALE — still references "VMark features"
│   ├── feature-workflow.md        # Keep
│   ├── fix.md                     # Keep
│   ├── fix-issue.md               # Keep
│   ├── merge-prs.md               # Keep
│   ├── audit-fix.md               # Keep
│   ├── codex-*.md (10 files)      # REDUNDANT — covered by codex-toolkit plugin
│   ├── _model-selection.md        # REDUNDANT — used only by codex commands
│   ├── shared/model-selection.md  # REDUNDANT — used only by codex commands
│   └── speckit.*.md (9 files)     # REDUNDANT — covered by speckit plugin
├── rules/ (2 files — thin)
│   ├── 00-engineering-principles.md
│   └── 10-tdd.md
├── scripts/codex-preflight.sh
└── skills/ (7 items)
    ├── plan-audit/SKILL.md
    ├── plan-verify/SKILL.md
    ├── planning/SKILL.md + templates/
    ├── release-gate/SKILL.md
    ├── save-context.md
    └── load-context.md
```

**Key gaps vs vmark:**
- No `settings.json` (hooks + plugins not configured)
- No `hooks/` directory (no prompt refinement)
- Only 2 rules vs vmark's 13 (missing: logging-and-docs, comment-maintenance, version-bump, keyboard-shortcuts, codebase-conventions)
- No `loc-guardian.local.md`
- No `docs-guardian/config.json`
- No `tdd-guardian/config.json`
- No `README.md` for the `.claude/` directory itself
- `test-guide.md` references "VMark features" — stale
- 21 redundant command files (codex-* + speckit.* + model-selection helpers)

---

## Project Context: mdpro

| Aspect | Detail |
|--------|--------|
| **App type** | macOS desktop app (Tauri 2.0 + Rust backend + React frontend) |
| **Frontend** | React 19 + TypeScript + Vite 7 |
| **Editor (WYSIWYG)** | Milkdown 7.18 (@milkdown/kit, @milkdown/react) — ProseMirror-based |
| **Editor (Source)** | CodeMirror 6 (@uiw/react-codemirror) |
| **Preview** | marked.js + DOMPurify (JS); pulldown-cmark (Rust) |
| **State** | Zustand 4 |
| **IPC** | Tauri 2.0 `invoke()` + `listen()` events |
| **File dialogs** | rfd (Rust) |
| **File watching** | notify (Rust) |
| **MCP server** | Rust binary (`mdpro_mcp`) using rmcp; sidecar to Tauri app |
| **HTTP API** | axum (internal, localhost + token auth) |
| **Package manager** | pnpm |
| **Testing** | Vitest + jsdom (`pnpm test:run`) |
| **Rust testing** | `cargo test` |
| **Target** | macOS 13+, Apple Silicon (ARM64) |
| **UI domains** | WYSIWYG editor (Milkdown), source editor (CodeMirror), split view, preview pane, TOC sidebar, bottom tabs, title bar, settings dialog |
| **Logging** | JSONL at `~/.mdpro/mdpro.log`; structured via `loggingService.ts` (frontend) and `logger.rs` (Rust) |

---

## Rule Boundary Policy

| Scope | Location | Rationale |
|-------|----------|-----------|
| Cross-tool rules (Claude Code, Codex, Gemini) | `AGENTS.md` | Single source of truth for all AI agents |
| Claude Code-specific enforcement | `.claude/rules/` | Auto-loaded per session, supplements AGENTS.md |
| Project structure, architecture, security | `AGENTS.md` + `CLAUDE.md` | Already well-covered there |
| Operational habits (comment sync, doc updates, version bump) | `.claude/rules/` | Lightweight rules that supplement CLAUDE.md |

**Principle:** Don't duplicate content between `CLAUDE.md` and `.claude/rules/`. Rules in `.claude/rules/` are *additive* enforcement — they reference CLAUDE.md as the authoritative source and add operational checklists.

---

## Category 1: KEEP AS-IS

| File | Action | Why |
|------|--------|-----|
| `rules/22-comment-maintenance.md` | Copy from vmark verbatim | Generic rule about TSDoc/`///` comment sync — no tech-stack specifics |

---

## Category 2: ADOPT WITH EDITS

### 2.1 Prompt Refinement Hook

**Source**: vmark `hooks/refine_prompt.sh` + `hooks/refine_prompt.txt`

**`hooks/refine_prompt.txt`** — adapt VMark domain mapping to mdpro:

```text
Act as a prompt refiner for mdpro — a Tauri 2.0 + React 19 macOS markdown editor with Milkdown WYSIWYG and CodeMirror source editing.
Rewrite the text as a clear, actionable prompt for a coding assistant.
Output only the revised prompt. No preamble, no explanation.

Rules:
- Use imperative voice ("Add…", "Fix…", "Refactor…").
- Keep all technical terms exactly as given (Milkdown, ProseMirror, CodeMirror, Zustand, Tauri, Rust, rmcp, axum, pulldown-cmark, DOMPurify, marked, MCP, etc.).
- Preserve file paths, component names, function names, Tauri command names, and Rust struct names verbatim.
- If the input mentions a UI area, map it to the correct mdpro domain:
    - WYSIWYG editor → Milkdown / ProseMirror (src/components/Editor/MilkdownEditor.tsx)
    - Source editor → CodeMirror 6 (src/components/Editor/Editor.tsx)
    - Split view → SplitView component (src/components/Editor/SplitView.tsx)
    - Preview pane → Preview component (src/components/Preview/Preview.tsx)
    - TOC sidebar → TOCSidebar (src/components/Sidebar/)
    - Bottom tabs → BottomTabs (src/components/BottomTabs/)
    - Settings → SettingsDialog (src/components/common/SettingsDialog.tsx)
    - Rust backend → src-tauri/src/commands/ or src-tauri/src/services/
    - MCP server → src-tauri/src/bin/mdpro_mcp.rs or src-tauri/src/services/http_server.rs
- If the input is in Chinese, translate to English while keeping code identifiers untranslated.
- Remove filler words, hedging, and politeness fluff.
- Keep the prompt concise — one to three sentences max.
- Do not add requirements the user did not mention.
```

**`hooks/refine_prompt.sh`** — use vmark's script with added dependency guards (vmark's version lacks graceful fallback):

```bash
#!/bin/bash
input=$(cat)
prompt=$(echo "$input" | jq -r '.prompt // ""')

# Only trigger on >> prefix
[[ "$prompt" =~ ^'>>' ]] || exit 0

# Dependency checks — fail gracefully, never block the user
command -v jq >/dev/null || { echo '{"decision":"allow"}'; exit 0; }
command -v claude >/dev/null || { echo '{"decision":"allow"}'; exit 0; }

text="${prompt#>>}"
text="${text#"${text%%[![:space:]]*}"}"
[ -z "$text" ] && { echo '{"decision":"block","reason":"Nothing to refine. Provide text after >>."}'; exit 0; }

script_dir="$(cd "$(dirname "$0")" && pwd)"
system=$(cat "$script_dir/refine_prompt.txt")

result=$(CLAUDECODE= claude -p --model haiku <<EOF
$system

Rewrite this:
$text
EOF
) || { echo '{"decision":"allow"}'; exit 0; }

echo "$result" | pbcopy
echo "{\"decision\":\"block\",\"reason\":\"Refined (copied):\n$result\"}"
```

**Error behavior matrix:**

| Failure | Behavior | Rationale |
|---------|----------|-----------|
| `jq` not installed | `allow` (pass through) | Non-blocking |
| `claude` CLI not installed | `allow` (pass through) | Non-blocking |
| Haiku API timeout / error | `allow` (pass through) | Non-blocking |
| Empty text after `>>` | `block` with message | User needs feedback |
| Successful refinement | `block` + copy to clipboard | User pastes refined prompt |

---

### 2.2 `settings.json` — Create with Hooks + Plugins

**Create** (currently missing — only `settings.local.json` exists):

```json
{
  "permissions": {
    "allow": []
  },
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/refine_prompt.sh",
            "timeout": 60
          }
        ]
      }
    ]
  },
  "enabledPlugins": {
    "frontend-design@claude-code-plugins": true,
    "rust-analyzer-lsp@claude-plugins-official": true,
    "codex-toolkit-for-claude@xiaolai": true,
    "tdd-guardian@xiaolai": true
  }
}
```

**Plugin decisions vs vmark:**

| Plugin | Decision | Reason |
|--------|----------|--------|
| `frontend-design@claude-code-plugins` | KEEP | React UI development |
| `rust-analyzer-lsp@claude-plugins-official` | KEEP | mdpro has a Rust backend (src-tauri/) — same as vmark |
| `codex-toolkit-for-claude@xiaolai` | KEEP | Codex orchestration |
| `codex-toolkit@xiaolai` | SKIP | Duplicate of `-for-claude` variant |
| `tdd-guardian@xiaolai` | KEEP | Enforces TDD discipline |

**Pre-requisite**: Run `claude plugin list` to verify all four plugins are available before writing.

---

### 2.3 `rules/20-logging-and-docs.md` — Adapt for mdpro

vmark's version references `dev-docs/`. mdpro uses `docs/` and `specs/` and has a structured logging system already defined in `CLAUDE.md`.

```markdown
# 20 - Logging and Docs (Local)

- Update relevant dev docs in the same change when behavior changes.
- If `docs/` contains documentation for the affected feature, keep it as the single
  source of truth and update it in the same commit.
- If `specs/` contains a spec for the feature, update `tasks.md` to mark completed
  items and note any deviations in `spec.md`.

## Logging (required for new features)

When adding a new Tauri command or significant frontend feature, add structured
logging following the patterns in CLAUDE.md § "Logging Rules":

- Rust backend: use `logger::log_event(LogEntryPayload { ... })` with `Start` +
  `Success`/`Fail` pairs and meaningful `event` names (`"feature.action"`).
- TypeScript frontend: use `loggingService.logEventSync({ ... })` with `ui.<component>.<action>` naming.
- Verify with: `tail -f ~/.mdpro/mdpro.log | jq .`

## IPC Changes

When adding or modifying a Tauri command:
1. Define in `src-tauri/src/commands/<module>.rs`
2. Register in `src-tauri/src/commands/mod.rs` → `handlers()`
3. Create typed wrapper in `src/services/<service>.ts`
4. Update `CLAUDE.md` IPC table if it's a new command
```

---

### 2.4 `rules/40-version-bump.md` — Adapt for mdpro 3-file sync

vmark bumps 5 files (it has a separate MCP npm package). mdpro's MCP server is a Rust binary — no separate `package.json`. Only 3 files need to stay in sync. The `commands/bump.md` already implements this correctly; this rules file makes it enforceable.

```markdown
# 40 - Version Bump Procedure

When bumping the version number, **all three files must be updated together**.

## Files to Update

| File | Field | Why |
|------|-------|-----|
| `package.json` | `"version"` | Frontend/npm |
| `src-tauri/tauri.conf.json` | `"version"` | macOS bundle (CFBundleShortVersionString) |
| `src-tauri/Cargo.toml` | `version` | Rust binary (`env!("CARGO_PKG_VERSION")`) |

## Why All Three Matter

- macOS About dialog shows version from `tauri.conf.json` and `Cargo.toml`
- If they differ, macOS shows: `Version 0.2.0 (0.3.0)` — confusing
- `mdpro_mcp` binary reports version via `env!("CARGO_PKG_VERSION")` — must match app

## Bump Procedure

Use `/bump` command (`commands/bump.md`) which handles all three files atomically.
Or manually:

1. Update all three files to the same version
2. Verify: `grep '"version"' package.json src-tauri/tauri.conf.json && grep '^version' src-tauri/Cargo.toml`
3. Commit: `git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml`
4. `git commit -m "chore: bump version to vX.Y.Z"`
5. `git tag vX.Y.Z && git push origin master --tags`

## Common Mistakes

- Forgetting `Cargo.toml` (causes dual version in About dialog)
- Running `pnpm tauri build` before updating all three files
- Tagging before committing all three
```

---

### 2.5 `rules/41-keyboard-shortcuts.md` — Adapt for mdpro

vmark syncs 3 files (menu.rs + shortcutsStore.ts + website docs). mdpro syncs:
- `src-tauri/src/menu.rs` — native menu accelerators
- `src/types/preferences.ts` — `DEFAULT_KEYBOARD_SHORTCUTS` constant
- `docs/guide/keyboard-shortcuts.md` — user-facing docs

```markdown
# 41 - Keyboard Shortcuts

When adding, changing, or removing a keyboard shortcut, update ALL three files.

## Files to Keep in Sync

| File | Purpose | Format |
|------|---------|--------|
| `src-tauri/src/menu.rs` | Native macOS menu accelerators | `"CmdOrCtrl+Shift+B"` |
| `src/types/preferences.ts` | `DEFAULT_KEYBOARD_SHORTCUTS` defaults | `{ key: "mod+shift+b" }` |
| `docs/guide/keyboard-shortcuts.md` | User documentation | `Cmd + Shift + B` |

## Format Differences

| Context | Example | Notes |
|---------|---------|-------|
| Rust menu (`menu.rs`) | `CmdOrCtrl+Shift+S` | `+` separator, full modifier names |
| TypeScript (`preferences.ts`) | `mod+shift+s` | lowercase, `mod` for Cmd/Ctrl |
| Documentation | `Cmd + Shift + S` | Human-readable with spaces |

## Conflict Check Before Adding

```bash
# Check menu.rs for existing accelerators
grep -i "CmdOrCtrl" src-tauri/src/menu.rs | grep -i "YourKey"

# Check preferences.ts for existing defaults
grep "defaultKey" src/types/preferences.ts
```

## Registered Shortcuts (current)

| Action | Shortcut | menu.rs | preferences.ts |
|--------|----------|---------|----------------|
| New | ⌘N | ✓ | ✓ |
| Open | ⌘O | ✓ | ✓ |
| Save | ⌘S | ✓ | ✓ |
| Close | ⌘W | ✓ | ✓ |
| Toggle Sidebar | ⌘⇧B | ✓ | ✓ |
| Split view | ⌃1 | ✓ | — |
| Editor only | ⌃2 | ✓ | — |
| Preview only | ⌃3 | ✓ | — |
| WYSIWYG | ⌃4 | ✓ | — |
| Export HTML | ⌘⇧E | ✓ | — |
| Highlight | ⌘⇧H | ✓ | ✓ |
```

---

### 2.6 `rules/50-codebase-conventions.md` — Full rewrite for mdpro

vmark's version covers Tiptap plugin patterns and an MCP bridge dispatcher. mdpro has a completely different architecture. Full rewrite needed:

```markdown
# 50 - Codebase Conventions

Undocumented patterns found across the codebase. Follow these for consistency.

## 1. Zustand Store Conventions

**Naming:** `use[Name]Store` for the hook, file named `[name]Store.ts` in `src/stores/`.

**Creation (without middleware):**
```ts
export const useDocumentStore = create<DocumentState>((set, get) => ({ ... }));
```

**In components:** Never destructure store values at the top level of a component.
Use `useXStore((state) => state.field)` for subscriptions, `useXStore.getState()` in
callbacks and event handlers to avoid stale closures.

**Reset in tests:** Call `useXStore.setState({ ... })` in `beforeEach` to isolate tests.

## 2. Tauri IPC Pattern

Every Tauri command follows the same 3-layer flow:

| Layer | File | Responsibility |
|-------|------|----------------|
| Rust command | `src-tauri/src/commands/<module>.rs` | Business logic, returns `Result<T, String>` |
| Registration | `src-tauri/src/commands/mod.rs` → `handlers()` | Registers with Tauri |
| TS wrapper | `src/services/<service>.ts` | Typed `invoke()` call, error handling |

**Command signature (Rust):**
```rust
#[tauri::command]
pub async fn my_command(arg: String) -> Result<MyData, String> {
    do_thing(&arg).map_err(|e| format!("Failed: {}", e))
}
```

**Never panic on user input.** All commands return `Result<T, String>`.

## 3. Tauri Event Pattern

Rust → Frontend events use `app_handle.emit("event:name", &payload)`.
Frontend → listens with `listen("event:name", handler)` and stores the unlisten fn
for cleanup in `useEffect` return.

**Event naming convention** (matches CLAUDE.md):
- `menu:action` — native menu clicks
- `file:open`, `file:changed` — file lifecycle
- `mcp:write_document`, `mcp:insert_content` — MCP-triggered editor mutations
- `theme:changed` — system theme

## 4. Plugin Structure (Milkdown + CodeMirror)

Plugins live in `src/plugins/` with three subdirectories:

| Directory | For |
|-----------|-----|
| `src/plugins/core/` | Config and registry |
| `src/plugins/milkdown/` | WYSIWYG (Milkdown/ProseMirror) plugins |
| `src/plugins/codemirror/` | Source editor (CodeMirror 6) plugins |

Each plugin exports either a `milkdownPlugin` (for WYSIWYG) or a `codemirrorExtension`
(for source mode). Register in `src/plugins/index.ts` and configure defaults in
`src/plugins/core/pluginConfig.ts`.

**Plugin styles** live co-located with the plugin file. Never add plugin CSS to global stylesheets.

## 5. MCP Shadow Store

The MCP layer uses a shadow store (in-memory Rust state) to bridge the async gap
between frontend edits and MCP tool calls:

- Frontend syncs to Rust via `mcp_sync_documents` (debounced 300ms for content,
  immediate for open/close/switch events)
- MCP tool calls (`read_document`, `write_document`) operate on this shadow store
- `write_document` emits `mcp:write_document` event → frontend applies to editor

**Never access document content directly from files** in MCP handlers — always go
through the shadow store (`src-tauri/src/services/shadow_store.rs`).

## 6. Error Handling

**TypeScript:** Always narrow `unknown` errors:
```ts
error instanceof Error ? error.message : String(error)
```

**Rust:** Convert errors with `.map_err()`:
```rust
fs::read(path).map_err(|e| format!("Failed to read: {}", e))?;
```

Never use `error as Error` (unsafe cast).

## 7. Logging

See CLAUDE.md § "Logging Rules" for the full pattern.

**Quick reference:**
- Frontend: `loggingService.logEventSync({ level, event, status, actionId, context })`
- Rust: `logger::log_event(LogEntryPayload { level, event, status, ... })`
- Every significant operation logs `Start` + `Success`/`Fail` with an `action_id`

Never use `console.log` for debug output in committed code. Use the logging service.

## 8. File Size Limit

Keep source files under **300 lines** (CLAUDE.md rule). When a file approaches
this limit, extract by type:
- Types/interfaces → `types.ts` in the same directory
- Pure helpers → `utils.ts`
- Sub-components → new `ComponentName.tsx`
- Custom hooks → `useFeatureName.ts`
```

---

### 2.7 `loc-guardian.local.md` — Adapt for mdpro

vmark's version covers TypeScript/React + Rust. mdpro is the same stack (no Python).

```markdown
---
max_pure_loc: 300
---

# loc-guardian Extraction Rules

## TypeScript / React (src/)

- **Types/interfaces** → `types.ts` in same directory
- **Constants & config objects** → `constants.ts`
- **Pure utility functions** → `utils.ts` or `<name>Utils.ts`
- **Sub-components** → new `<ComponentName>.tsx` file
- **Custom hooks** → `use<Name>.ts` in same directory
- **Store actions/selectors** → keep in store file; split by feature if >300 LOC
- **Service functions** → `src/services/<name>Service.ts` (one file per domain)

## Rust (src-tauri/src/)

- **Tauri commands** → `commands.rs` within the feature module
- **Data types/structs** → add to `src-tauri/src/models/` (see existing pattern)
- **Helper/utility functions** → `utils.rs` within the feature module
- **Tests** → keep in `#[cfg(test)]` block at bottom of each file
- **New services** → `src-tauri/src/services/<name>.rs`
```

---

### 2.8 `docs-guardian/config.json` — Create new

Map mdpro source areas to their corresponding documentation:

```json
{
  "framework": "markdown",
  "docsRoot": "docs",
  "language": "typescript",
  "strictness": "warn",
  "stalenessThresholdDays": 30,
  "mappings": [
    {
      "source": "src-tauri/src/commands/**",
      "docs": "docs/guide/architecture.md"
    },
    {
      "source": "src-tauri/src/services/http_server.rs",
      "docs": "docs/reference/cli-vs-mcp-roadmap.md"
    },
    {
      "source": "src-tauri/src/bin/mdpro_mcp.rs",
      "docs": "docs/reference/vmark-mcp-comparison.md"
    },
    {
      "source": "src/components/Editor/**",
      "docs": "docs/guide/milkdown-integration.md"
    },
    {
      "source": "src/stores/**",
      "docs": "docs/guide/state-management.md"
    },
    {
      "source": "src/plugins/**",
      "docs": "docs/guide/architecture.md"
    }
  ],
  "exclude": [
    "**/node_modules/**",
    "**/dist/**",
    "**/target/**",
    "**/*.test.*",
    "**/__tests__/**"
  ]
}
```

---

### 2.9 `tdd-guardian/config.json` — Create new

```json
{
  "enabled": true,
  "testCommand": "pnpm test:run",
  "coverageCommand": "pnpm test:run --coverage",
  "coverageSummaryPath": "coverage/coverage-summary.json",
  "thresholds": {
    "lines": 40,
    "functions": 45,
    "branches": 35,
    "statements": 40
  },
  "enforceRedGreenRefactor": true,
  "blockCommitOnFailure": false,
  "stack": "react-ts-vitest",
  "packageManager": "pnpm"
}
```

**Notes:**
- Thresholds are lower than vmark (mdpro is early-stage; Rust backend tests run separately)
- `blockCommitOnFailure: false` — advisory, not blocking (until coverage improves)
- Rust tests run via `cd src-tauri && cargo test` — not covered by this config

---

### 2.10 `commands/test-guide.md` — Fix stale VMark reference

Current file references "VMark features". Replace content to reference mdpro's test assets:

```markdown
---
description: Manual Testing Guide for mdpro
---

# Manual Testing Guide

Open the edge cases test file and help test mdpro features.

## Instructions

1. Read `tests/edge-cases-test.md` for the full test case list
2. Read `tests/20260312-mdpro-features-test-report.md` for current status
3. Run `pnpm dev` to open the browser dev server at http://localhost:1420/
4. For Tauri integration tests: `pnpm tauri dev`

## Test Categories (from edge-cases-test.md)

1. **A. Text Input & Cursor** — EC-INPUT-001 through EC-INPUT-012
2. **B. IME & Unicode** — EC-IME-001 through EC-IME-007
3. **C. Markdown Parsing** — EC-MD-001 through EC-MD-010
4. **D. Code Blocks** — EC-BLOCK-001 through EC-BLOCK-005
5. **E. TOC** — EC-TOC-001 through EC-TOC-008
6. **F. Lists** — EC-LIST-001 through EC-LIST-006
7. **G. Tables** — EC-TABLE-001 through EC-TABLE-010
8. **H. Links & Images** — EC-LINK/IMG-001 through EC-IMG-008
9. **I. Paste & Drag** — EC-PASTE/DRAG-001 through EC-DRAG-002
10. **J. File I/O** — EC-FILE-001 through EC-FILE-009
11. **K. Find & Replace** — EC-SEARCH-001 through EC-SEARCH-005
12. **L. Performance** — EC-PERF-001 through EC-PERF-006
13. **M. Security** — EC-SEC-001 through EC-SEC-006
14. **N. Accessibility** — EC-A11Y-001 through EC-A11Y-005
15. **O. Compatibility** — EC-COMP-001 through EC-COMP-004
```

---

### 2.11 `README.md` — Create for `.claude/` directory

vmark has a `README.md` describing its `.claude/` structure. mdpro has none. Create one that documents the final target state.

---

## Category 3: SKIP (vmark-specific, not applicable to mdpro)

| File | Why Skip |
|------|----------|
| `rules/21-website-docs.md` | Maps vmark source to VitePress website docs. mdpro has no website. |
| `rules/30-ui-consistency.md` | ProseMirror/Tiptap popup/toolbar CSS principles |
| `rules/31-design-tokens.md` | 100+ CSS custom properties for vmark's design system |
| `rules/32-component-patterns.md` | Editor popup/toolbar/menu CSS patterns — vmark-specific |
| `rules/33-focus-indicators.md` | WCAG focus patterns for Tiptap editor components |
| `rules/34-dark-theme.md` | `.dark-theme` + `color-mix()` for vmark's CSS architecture |
| `skills/tiptap-dev/`, `tiptap-editor/` | Tiptap is vmark's WYSIWYG; mdpro uses Milkdown |
| `skills/css-design-tdd/` | vmark's CSS token auditing — different design system |
| `skills/shortcut-audit/` | vmark shortcut reconciliation (3 specific files) |
| `skills/mcp-server-manager/` | vmark MCP server management — mdpro's MCP is different architecture |
| `skills/react-app-dev/` | vmark-specific React patterns (ProseMirror-centric) |
| `commands/bump.md` (vmark) | Already have mdpro-adapted version |
| `commands/test-guide.md` (vmark) | Updating ours (§2.10), not copying vmark's |

---

## Category 4: CREATE NEW (mdpro-specific, inspired by vmark patterns)

| New File | Inspired By | Purpose |
|----------|-------------|---------|
| `skills/tauri-app-dev/SKILL.md` | vmark `tauri-app-dev` | Tauri 2.0 patterns: commands, events, IPC, rfd, notify, app lifecycle, bundling |
| `skills/milkdown-dev/SKILL.md` | vmark `tiptap-dev` | Milkdown 7 patterns: plugin system, ProseMirror commands, schema, history, WYSIWYG content sync |
| `skills/mcp-dev/SKILL.md` | vmark `mcp-server-manager` | mdpro MCP architecture: rmcp, axum HTTP API, shadow store, tool patterns, config management |

**Acceptance criteria:**

| Skill | Minimum content |
|-------|----------------|
| `tauri-app-dev/SKILL.md` | Tauri 2.0 command pattern, event system, rfd dialogs, notify watcher, app handle usage, `pnpm tauri dev` + `cargo check` workflow |
| `milkdown-dev/SKILL.md` | Milkdown editor factory, plugin-listener for onChange, imagePastePlugin as example, ProseMirror transaction basics, `@milkdown/kit/preset/commonmark` + `gfm` + `history`, content sync to Zustand |
| `mcp-dev/SKILL.md` | `mdpro_mcp.rs` binary structure, shadow store sync, HTTP API routes, token auth, `ServerConfig.load()` pattern, adding a new MCP tool (3 steps: HTTP endpoint → MCP tool → register) |

---

## Phased Action Plan

### Phase 1a — Cleanup (safe, removes noise)

| # | Action | Definition of Done |
|---|--------|--------------------|
| 1 | Delete 10 `codex-*.md` commands | Plugin-provided; confirmed equivalent via `claude plugin list` |
| 2 | Delete 9 `speckit.*.md` commands | Plugin-provided; confirmed equivalent |
| 3 | Delete `_model-selection.md` + `shared/model-selection.md` | No longer needed after codex commands removed |
| 4 | Update `commands/test-guide.md` | Content updated to reference mdpro test assets (§2.10) |

**Verification**: `ls .claude/commands/` shows exactly 6 files: `audit-fix.md`, `bump.md`, `feature-workflow.md`, `fix.md`, `fix-issue.md`, `merge-prs.md`, `test-guide.md`

**Rollback**: `git checkout -- .claude/commands/`

---

### Phase 1b — Rules (zero risk)

| # | Action | Definition of Done |
|---|--------|--------------------|
| 5 | Create `rules/22-comment-maintenance.md` | Copied verbatim from vmark |
| 6 | Create `rules/20-logging-and-docs.md` | mdpro-adapted content (§2.3) |
| 7 | Create `rules/40-version-bump.md` | mdpro 3-file version (§2.4) |
| 8 | Create `rules/41-keyboard-shortcuts.md` | mdpro file mapping (§2.5) |
| 9 | Create `rules/50-codebase-conventions.md` | Full mdpro rewrite (§2.6) |

**Verification**: `ls .claude/rules/` shows 7 files (00, 10, 20, 22, 40, 41, 50)

**Rollback**: `git checkout -- .claude/rules/`

---

### Phase 1c — Hook + Settings (controlled rollout)

| # | Action | Definition of Done |
|---|--------|--------------------|
| 10 | Create `hooks/refine_prompt.txt` | mdpro-adapted domain mapping (§2.1) |
| 11 | Create `hooks/refine_prompt.sh` | Script with dependency guards (§2.1) |
| 12 | Create `settings.json` | Hooks + plugins configured (§2.2) |
| 13 | Smoke test | Type `>> 修复 WYSIWYG 模式下保存丢失内容的问题` → clipboard has English imperative |

**Pre-requisites**:
- `jq` installed: `brew install jq`
- `claude` CLI in PATH
- `claude plugin list` confirms all 4 plugins available

**Rollback**: Remove `hooks/` dir; delete `settings.json`

---

### Phase 1d — Guardian Configs + loc-guardian

| # | Action | Definition of Done |
|---|--------|--------------------|
| 14 | Create `loc-guardian.local.md` | TypeScript/React + Rust extraction rules (§2.7) |
| 15 | Create `docs-guardian/config.json` | Valid JSON, mappings match project (§2.8) |
| 16 | Create `tdd-guardian/config.json` | Valid JSON, `pnpm test:run` runs (§2.9) |

**Verification**:
```bash
cat .claude/docs-guardian/config.json | jq . >/dev/null && echo "OK"
cat .claude/tdd-guardian/config.json | jq . >/dev/null && echo "OK"
```

---

### Phase 2 — Skills

| # | Action | Definition of Done |
|---|--------|--------------------|
| 17 | Create `skills/tauri-app-dev/SKILL.md` | Covers Tauri 2.0 command/event patterns for mdpro |
| 18 | Create `skills/milkdown-dev/SKILL.md` | Covers Milkdown plugin system + content sync |
| 19 | Create `skills/mcp-dev/SKILL.md` | Covers rmcp + axum MCP architecture |

**Verification**: Each SKILL.md has valid YAML frontmatter (`name`, `description`). Content references mdpro files, not vmark.

**Rollback**: `git checkout -- .claude/skills/`

---

### Phase 3 — README + Final Wiring

| # | Action | Definition of Done |
|---|--------|--------------------|
| 20 | Create `.claude/README.md` | Documents all dirs, explains hook trigger, lists active plugins |
| 21 | Update agents with skill references | `auditor`, `implementer`, `planner`, `test-runner`, `verifier` reference `tauri-app-dev`; `implementer` + `planner` also reference `milkdown-dev` |

---

### Phase Gate Checklist (run after each phase)

```bash
# 1. settings.json valid JSON
cat .claude/settings.json | jq . >/dev/null && echo "settings OK"

# 2. All agent YAML frontmatter valid
for f in .claude/agents/*.md; do head -1 "$f" | grep -q '^---' && echo "$f OK"; done

# 3. All skill SKILL.md files have frontmatter
find .claude/skills -name 'SKILL.md' -exec sh -c \
  'head -1 "$1" | grep -q "^---" && echo "$1 OK"' _ {} \;

# 4. Guardian configs valid JSON
for f in .claude/docs-guardian/config.json .claude/tdd-guardian/config.json; do
  [ -f "$f" ] && cat "$f" | jq . >/dev/null && echo "$f OK" || echo "$f MISSING"
done

# 5. Command count (should be 7 after cleanup)
echo "Commands: $(ls .claude/commands/*.md 2>/dev/null | wc -l | tr -d ' ') (expected 7)"

# 6. Project gate
pnpm build && echo "Frontend build OK"
cd src-tauri && cargo check && echo "Rust check OK"
```

---

## Namespace Audit

### Codex commands → `codex-toolkit-for-claude@xiaolai` plugin

| Local command | Plugin equivalent | Resolution |
|---------------|-------------------|------------|
| `codex-audit.md` | `codex-toolkit:audit` | **Delete** |
| `codex-audit-mini.md` | `codex-toolkit:audit` (--mini) | **Delete** |
| `codex-audit-fix.md` | `codex-toolkit:audit-fix` | **Delete** |
| `codex-bug-analyze.md` | `codex-toolkit:bug-analyze` | **Delete** |
| `codex-implement.md` | `codex-toolkit:implement` | **Delete** |
| `codex-review-plan.md` | `codex-toolkit:review-plan` | **Delete** |
| `codex-verify.md` | `codex-toolkit:verify` | **Delete** |
| `codex-continue.md` | `codex-toolkit:continue` | **Delete** |
| `codex-init.md` | `codex-toolkit:init` | **Delete** |
| `codex-preflight.md` | `codex-toolkit:preflight` | **Delete** |

### Speckit commands → speckit plugin

| Local command | Plugin equivalent | Resolution |
|---------------|-------------------|------------|
| `speckit.analyze.md` | `speckit:analyze` | **Delete** |
| `speckit.checklist.md` | `speckit:checklist` | **Delete** |
| `speckit.clarify.md` | `speckit:clarify` | **Delete** |
| `speckit.constitution.md` | `speckit:constitution` | **Delete** |
| `speckit.implement.md` | `speckit:implement` | **Delete** |
| `speckit.plan.md` | `speckit:plan` | **Delete** |
| `speckit.specify.md` | `speckit:specify` | **Delete** |
| `speckit.tasks.md` | `speckit:tasks` | **Delete** |
| `speckit.taskstoissues.md` | `speckit:taskstoissues` | **Delete** |

### Helper files

| Local file | Resolution |
|------------|------------|
| `_model-selection.md` | **Delete** with codex commands |
| `shared/model-selection.md` | **Delete** with codex commands |

**Net result:** `commands/` drops from 25 files → 7 core commands.

---

## Appendix A: vmark `.claude/` Full Directory Tree (2026-03-12)

```
.claude/
├── README.md
├── settings.json                  # hooks + 5 plugins
├── settings.local.json            # gitignored
├── loc-guardian.local.md          # max_pure_loc: 300
├── agents/ (9 agents)
│   └── auditor, impact-analyst, implementer, manual-test-author,
│       planner, release-steward, spec-guardian, test-runner, verifier
├── commands/ (6 commands)
│   └── bump.md, feature-workflow.md, fix-issue.md, fix.md,
│       merge-prs.md, test-guide.md
├── docs-guardian/
│   └── config.json
├── hooks/
│   ├── refine_prompt.sh
│   └── refine_prompt.txt
├── rules/ (13 files: 00–50)
│   ├── 00-engineering-principles.md
│   ├── 10-tdd.md
│   ├── 20-logging-and-docs.md
│   ├── 21-website-docs.md         ← skip (vmark website)
│   ├── 22-comment-maintenance.md
│   ├── 30-ui-consistency.md       ← skip (Tiptap)
│   ├── 31-design-tokens.md        ← skip (Tiptap)
│   ├── 32-component-patterns.md   ← skip (Tiptap)
│   ├── 33-focus-indicators.md     ← skip (Tiptap)
│   ├── 34-dark-theme.md           ← skip (vmark CSS)
│   ├── 40-version-bump.md
│   ├── 41-keyboard-shortcuts.md
│   └── 50-codebase-conventions.md
├── skills/ (17 skills)
│   ├── ai-coding-agents/ (SKILL.md + references/)
│   ├── css-design-tdd/            ← skip
│   ├── mcp-dev/
│   ├── mcp-server-manager/        ← skip (vmark-specific)
│   ├── plan-audit/, plan-verify/, planning/, release-gate/
│   ├── react-app-dev/             ← skip (Tiptap-centric)
│   ├── rust-tauri-backend/
│   ├── shortcut-audit/            ← skip
│   ├── tauri-app-dev/
│   ├── tauri-mcp-test-runner/     ← skip
│   ├── tauri-mcp-testing/         ← skip
│   ├── tiptap-dev/, tiptap-editor/ ← skip
└── tdd-guardian/
    ├── config.json
    └── state.json
```

---

## Appendix B: Target `.claude/` Tree After All Phases

```
.claude/
├── README.md                              # NEW (Phase 3)
├── settings.json                          # NEW (Phase 1c — hooks + plugins)
├── settings.local.json                    # existing (gitignored)
├── loc-guardian.local.md                  # NEW (Phase 1d)
├── agents/ (9 agents — unchanged)
│   └── all existing agents kept as-is
├── commands/ (7 files — after cleanup)
│   ├── audit-fix.md                       # existing
│   ├── bump.md                            # existing (already mdpro-adapted)
│   ├── feature-workflow.md                # existing
│   ├── fix.md                             # existing
│   ├── fix-issue.md                       # existing
│   ├── merge-prs.md                       # existing
│   └── test-guide.md                      # UPDATED (Phase 1a)
├── docs-guardian/
│   └── config.json                        # NEW (Phase 1d)
├── hooks/                                 # NEW directory (Phase 1c)
│   ├── refine_prompt.sh
│   └── refine_prompt.txt
├── rules/ (7 files)
│   ├── 00-engineering-principles.md       # existing
│   ├── 10-tdd.md                          # existing
│   ├── 20-logging-and-docs.md             # NEW (Phase 1b)
│   ├── 22-comment-maintenance.md          # NEW from vmark (Phase 1b)
│   ├── 40-version-bump.md                 # NEW adapted (Phase 1b)
│   ├── 41-keyboard-shortcuts.md           # NEW adapted (Phase 1b)
│   └── 50-codebase-conventions.md         # NEW mdpro rewrite (Phase 1b)
├── scripts/codex-preflight.sh             # existing
├── skills/
│   ├── milkdown-dev/SKILL.md              # NEW (Phase 2)
│   ├── mcp-dev/SKILL.md                   # NEW (Phase 2)
│   ├── tauri-app-dev/SKILL.md             # NEW (Phase 2)
│   ├── plan-audit/SKILL.md                # existing
│   ├── plan-verify/SKILL.md               # existing
│   ├── planning/ (SKILL.md + templates/)  # existing
│   ├── release-gate/SKILL.md              # existing
│   ├── save-context.md                    # existing
│   └── load-context.md                    # existing
└── tdd-guardian/
    └── config.json                        # NEW (Phase 1d)
```
