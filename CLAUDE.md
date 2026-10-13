# [CLAUDE.md](http://CLAUDE.md)

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## gstack

Use the `/browse` skill from gstack for all web browsing tasks. Never use `mcp__claude-in-chrome__*` tools.

Skill list, setup, and workflow: [`docs/guide/gstack-workflow-guide.md`](./docs/guide/gstack-workflow-guide.md).

## Lessons Learned

See [`progress.md`](./progress.md) for accumulated implementation lessons — bug post-mortems, root causes, and patterns to avoid.

## Design System

**The design every UI decision references is
[`docs/design/mdpro-ui-new/DESIGN.md`](./docs/design/mdpro-ui-new/DESIGN.md)**
(user decision, 2026-10-11: 「mark 这个就是最后所有的 UI 设计都参考的设计方案」).
Read it before making any visual or UI decision; the root
[`DESIGN.md`](./DESIGN.md) is only the index into `docs/design/`, and
`docs/design/mdpro-ui-old/DESIGN.md` describes the UI as shipped, not where it
is going. Aesthetic register, "memorable thing", token names and component
contracts live in the new file. Enforceable rules live in `.claude/rules/30-34`
and win any conflict with it:

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

## Prerequisites

- **pnpm 10.26.1** — pinned by `packageManager` in `package.json`; never use `npm`/`yarn`.
- **Rust stable toolchain** (via `rustup`) — `src-tauri/Cargo.toml` is edition 2021; no toolchain file pins a version.
- **Xcode Command Line Tools** — required by Tauri to build on macOS.

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

Rust backend in `src-tauri/src/` (`commands/` = IPC handlers, `services/` = business
logic, `models/` = data types, `menu.rs` = native menu); React frontend in `src/`
(`components/`, `hooks/`, `services/` = typed `invoke()` wrappers, `stores/` =
Zustand, `plugins/` = Milkdown/CodeMirror). Stack: Tauri 2.0, React 19 + Vite 7,
CodeMirror 6 + Milkdown, pulldown-cmark, Zustand. Directory map and full stack
table: [`docs/guide/architecture.md`](./docs/guide/architecture.md).

## IPC & Event System

### Commands (Frontend → Rust)

Frontend calls Rust via `invoke()`. Commands are registered in `src-tauri/src/commands/mod.rs`:

```typescript
// src/services/fileService.ts
import { invoke } from '@tauri-apps/api/core';
const result = await invoke<OpenFileResult>('open_file', { path, encoding });
```

Key commands: `open_file`, `save_file`, `create_document`, `export_html`, `export_rendered_html`, `save_draft`, `get_preferences`, `get_app_version`, `quit_guard_reply`, `mcp_set_server_enabled`, `mcp_confirm_reply`

### Events (Rust → Frontend)

Rust emits events that frontend listens to via `listen()`:

| Event           | Payload                | Source                                        |
| --------------- | ---------------------- | --------------------------------------------- |
| `menu:action`   | `{ action, value }`    | Native menu clicks (menu.rs)                  |
| `file:open`     | `string[]`             | Single-instance file open (launch.rs)         |
| `file:changed`  | `{ path, changeType, newPath?, origin? }` | External file modification (file\_watcher.rs), and a save in another window: the save notice carries `origin: { windowLabel, documentId }` (services/file\_watcher\_save\_notice.rs, ADR-0086) |
| `file:open-in-window` | `{ windowLabel, documentId, path }` | External open of an already-open file, `emit_to` the one window that has it (services/open\_route/tauri\_glue.rs) → `useOpenInWindow.ts` |
| `theme:changed` | `"light" \| "dark"`    | System theme change                           |
| `mcp:write_document` | `{ document_id, content, window_label, action_id }` | MCP `write_document` tool (http\_server.rs) → `useMcpEvents.ts` |
| `mcp:insert_content` | `{ document_id, text, position, window_label, action_id }` | MCP `insert_content` tool (http\_server.rs) → `useMcpEvents.ts` |
| `mcp:create_document` | `{ document_id, content, window_label, action_id }` | MCP `create_document` tool (http\_server.rs) → `useMcpEvents.ts` |
| `mcp:table_action` | `{ document_id, action, payload, window_label, action_id }` | MCP table tools (http\_server.rs) → `useMcpEvents.ts` |
| `mcp:confirm_request` | `{ requestId, documentId, documentTitle, operation, action?, expiresInMs }` | MCP write awaiting approval (ADR-0042), `emit_to` the window that owns the document (mcp\_confirm/outbox.rs) → `useMcpConfirm.ts` |
| `mcp:confirm_resolved` | `{ requestId, outcome }` (`approved` \| `rejected` \| `timedOut` \| `cancelled` \| `withdrawn`) | Closes that prompt, `emit_to` the owning window (mcp\_confirm/outbox.rs) → `useMcpConfirm.ts` |
| `app:quit-requested` | `{ requestId, round }` | Quit phase 1 — asks every window if it is dirty (quit\_guard/events.rs) → `useQuitGuard.ts` |
| `app:quit-prompt` | `{ requestId, round }` | Quit phase 2 — prompts one dirty window at a time (quit\_guard/events.rs) → `useQuitGuard.ts` |
| `app:quit-cancelled` | `{ requestId, round }` | Quit aborted; windows dismiss their prompt (quit\_guard/events.rs) → `useQuitGuard.ts` |
| `app:quit-backstop` | `{ requestId, round }` | Quit commit — every window drafts every unsaved document, then replies `drafted` with counts (ADR-0035; quit\_guard/events.rs) → `useQuitGuard.ts` |

## Menu System

Native macOS menu defined in `src-tauri/src/menu.rs`. Menu events are handled via `menu:action` event:

- File: New (⌘N), Open (⌘O), Save (⌘S), Export HTML (⌘⇧E), Close (⌘W)
- View: Source (⌃2), WYSIWYG (⌃4), Toggle Sidebar (⌘⇧L)
- Format: Highlight Selection (⌘⇧H)
- App (Windows/Linux): Exit → quit guard; Stop Waiting and Quit… (ADR-0090)
- Theme: Light, Dark, System

## Release Workflow

See `.claude/rules/40-version-bump.md` for the full procedure (3 files must
stay in sync: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`).
Or use the `/bump` command, which handles all three atomically.

Releases are built by a manually dispatched workflow, not by pushing a tag
([ADR-0073](./docs/adr/0073-release-workflow-auto-publishes-only-after-verifying-the-uploaded-draft.md);
runbook: [`docs/guide/release-runbook.md`](./docs/guide/release-runbook.md)).

```bash
# 1. Bump the three files (/bump or rule 40) on a chore/ branch; the delegator
#    lands it on master by `git merge --ff-only` and pushes origin master
# 2. Precondition: the 0.3.1 device regression passed on the locked SHA
# 3. Rehearse, then release (mode: build-only | draft | rehearsal-draft)
gh workflow run release.yml -f ref=<sha> -f version=0.3.1 -f mode=build-only
gh workflow run release.yml -f ref=<sha> -f version=0.3.1 -f mode=draft
```

`mode=draft` publishes on its own, but only after `verify-release` passes on
the uploaded draft. Never `gh release create` by hand. A leftover draft is
deleted only after confirmation (rule 25).

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

### Commit Checklist

Before each commit, verify:

- [ ] Only related files are staged (`git diff --cached --stat`)
- [ ] Project still builds (`pnpm build` or `cargo check`)
- [ ] Message follows `type(scope): summary` format
- [ ] Body explains WHY, not WHAT
- [ ] No secrets or large binaries included

## Plan Status Tracking (UI redesign × Markdown consolidation)

Sequencing for this effort lives in
[`docs/plans/20260912-frontend-backend-sequencing-order.md`](./docs/plans/20260912-frontend-backend-sequencing-order.md).

- **Branch**: every work item lands on `master`, the single trunk, and only
  through the delegator's `git merge --ff-only` of a short-lived branch that
  has passed `mdpro-landing-verifier` **and** a mini audit with no Critical
  or High finding (rule 70,
  [ADR-0085](./docs/adr/0085-a-branch-is-audited-before-it-is-fast-forwarded-onto-master.md)).
  Nobody lands by merge commit, and the only direct commits are
  the delegator's docs-only ones. Before 2026-10-12 this effort lived on `frontend-backend-redesign`,
  now frozen ([ADR-0083](./docs/adr/0083-master-is-the-single-integration-trunk.md)).
- **Updating the status is part of finishing the work item, not a follow-up.**
  When an independent WI is implemented **and verified**, update its row in the
  sequencing doc — status marker, commit SHAs, and anything the work proved
  wrong — in the same commit that finishes it. A status column that gets
  refreshed in a later cleanup pass is a status column nobody can trust.
- **Verified means its own gates passed**, not that the code is written. A WI
  that is deferred records what deferred it and where it went, rather than
  being left blank.
- The sequencing doc carries **order and status only**. Acceptance criteria stay
  in plans P and M; when they conflict, the original plan wins and the
  sequencing doc is corrected to match.

## Worktrees

Parallel work (peer sessions, verification builds) uses git worktrees, and they
all live in **one place**: `/Users/jackcheng/Documents/01_Coding/mac-app/mdpro-wt/`.
Not as `mac-app/mdpro-*` siblings, not under the repo's `.claude/worktrees/`, and
not in a session scratchpad, where they become broken entries when the
scratchpad is wiped.

- **A large feature gets its own worktree, and the user approves it first.**
  Before implementing a large feature, decide whether it needs an isolated
  worktree in `../mdpro-wt/`. If it does, **ask the user before creating it**,
  naming the branch, the directory, and the base commit. Small fixes and
  doc-only edits stay on the current checkout.
- **Implementor sessions (rule 70) get one worktree per item in flight**, created
  without asking each time (user decision, 2026-10-11: 「同意，作为常设安排」).
  A held item's rebase must not wait for the active item's worktree. Removal
  still goes through the delegator under rule 25, once the item has landed.
- **Branch**: `<type>/<id>-<slug>`. `<type>` comes from the commit types table,
  and `<id>` is the defect or work item, e.g. `fix/d41-source-tab-gaps` or
  `docs/d35-device-verified`.
- **Directory**: the branch name with `/` → `-`, e.g.
  `mdpro-wt/fix-d41-source-tab-gaps`. A detached checkout for verifying a commit
  is `mdpro-wt/verify-<sha7>`.
- **Create**: `git worktree add ../mdpro-wt/<dir> -b <branch> master`.
  Copy the gitignored sidecar `src-tauri/binaries/mdpro_mcp-aarch64-apple-darwin`
  in before `pnpm tauri build`.
- **Move only with `git worktree move`**, never `mv`. A plain `mv` leaves git's
  registry pointing at the old path, and the worktree shows as `prunable`.
- **Remove once merged**: `git worktree remove <dir>` then `git branch -d <branch>`.
  A merged worktree left lying around gets its stale tdd-guardian state mistaken
  for live work.
- **Exceptions**: `isolation: "worktree"` subagents create
  `.claude/worktrees/agent-*` themselves; remove each one when its agent is done.
  `~/.codex/worktrees/` is managed by the Codex app, so leave it alone.

## Manual test fixtures

Markdown documents for device checks (`/gui-acceptance`, `/gui-manual-verify`)
live in **`tests/manual-fixtures/`**, named `<id>-<slug>.md`, e.g.
`d41-source-tab.md`. Not in a session scratchpad, where they vanish, and not in
`tests/fixtures/`, which holds the unit tests' contract JSON. Vitest only
collects `*.test.{ts,tsx}`, so nothing here runs.

- **Run on a copy.** Copy the fixture to the scratchpad and open the copy. A
  run edits the document, ⌘S writes it and a draft can outlive the run, so the
  committed original must stay pristine.
- Large generated fixtures (multi-MB) are not committed. Commit the generator
  script instead.

## Feature Ledger

[`docs/feature-ledger.md`](./docs/feature-ledger.md) is the inventory of **what
mdpro has right now**: every capability, its state, where the code is, and how to
confirm it in the running app. `docs/feature-ledger.html` is the rendered view —
generated, never hand-edited.

- **The commit that changes the behaviour rewrites the row.** Same rule as the
  sequencing doc above, same reason: a state column refreshed in a later cleanup
  pass is a state column nobody can trust. Shipping a feature, stubbing one out,
  or discovering a claim was false all edit the ledger in that commit.
- **State is one of five words** — `Shipped` / `Partial` / `Stub` / `Absent` /
  `Unknown`. The enum is closed; `Shipped (export only)` is a gate failure, not a
  nuance. Nuance goes in the 怎么确认 column. `Partial` **must** carry a literal
  `限制：` naming the limit.
- **Run `pnpm ledger:check` before committing a behaviour change**, and
  `pnpm ledger:build` when the markdown changes. The gate gives three answers:
  every path claim resolves, every state cell is in the enum, and every declared
  app surface (`#[tauri::command]`, `http_server.rs` routes, `menu.rs` `MENU_*`
  ids, `pluginConfig.ts` plugin ids, `src/stores/`) appears in some row. The
  third is the one that catches a surface nobody wrote a row for.
- **It is not a changelog, a plan, or an ADR.** When it changed → `CHANGELOG.md`.
  What is next and its acceptance → `docs/plans/`. Why → `docs/adr/`.
- The gate **cannot** tell you a sentence is still true. A path that resolves
  says nothing about whether the behaviour it describes still exists.

## Architecture Decision Records (ADR)

**When a decision is consequential, write an ADR.** Consequential means it is
expensive to reverse, it constrains later work, or it will be re-litigated by
someone who wasn't in the room: picking a rendering surface, adding or refusing
a dependency, changing an IPC contract, accepting a known defect, or deciding
**not** to build something. Decisions that reach for `AskUserQuestion` are
usually ADR-worthy — if it was worth interrupting a human, it is worth a record.
So is a consequential decision where **two or more viable options were weighed**:
the losing options are what the next person will reach for.

- **Location**: `docs/adr/NNNN-kebab-title.md`, numbered sequentially from
  `0001`, never renumbered and never deleted.
- **Structure** (Nygard): `# NNNN. Title` → **Status** → **Context** →
  **Options considered** → **Decision** → **Consequences**. Context states the
  forces *as they were understood at the time*, not as they look in hindsight.
  Options considered names every option that was on the table, with the reason
  each losing one lost; a record without them cannot stop the re-litigation it
  exists to prevent. Keep it to a page where you can; evidence (log lines, device
  runs, probe output) goes in a linked record under `docs/test/` or
  `docs/reference/`, not in the ADR.
- **Status** is one of `Proposed` / `Accepted` / `Rejected` /
  `Superseded by ADR-NNNN` / `Deprecated`. Date every status change, and on
  `Accepted` or `Rejected` say **who decided**, quoting the user's words when the
  user did. `Rejected` keeps a proposal that was turned down, with the reason, so
  it is not proposed again from scratch.
- **An accepted ADR's body is immutable.** Only its Status line and a forward
  link (`Superseded by ADR-NNNN`, `partially superseded: <clause> by ADR-NNNN`)
  may change after acceptance. Changing your mind writes a **new** ADR that
  supersedes the old one, in whole or for a named clause, and links back; both
  stay in the tree. Editing an accepted record destroys the evidence of why the
  earlier decision looked right at the time — which is the only thing that stops
  it being remade by accident. (Rules amended 2026-10-11 after the vendor
  comparison in `docs/reference/20261011-adr-criteria-best-practices.md`;
  ADRs accepted before then keep their shape.)
- **Record the costs, not just the benefits.** An ADR whose Consequences section
  lists only upsides is advocacy, not a record. Name what the decision gives up
  and what it forecloses.
- Plans and rules **link** to ADRs rather than restating the reasoning. When a
  plan and an ADR disagree, the ADR is the decision and the plan is corrected.

Decisions already taken for the in-flight redesign still live inline in
`docs/plans/` (E26, E29 Stryker-not-adopted, E39 no-benchmarking-harness, the
`export_html` non-deletion). **Do not backfill them wholesale** — a bulk
conversion produces records nobody wrote and nobody trusts. Promote one to an ADR
when it is next disputed, superseded, or built on.

The B′ export-anchor decision was promoted this way on 2026-09-15
([ADR-0003](./docs/adr/0003-export-fragment-sanitizer-scope.md)): it was about to
be built on by WI-3.2, and it carries a precondition with a failure condition
(`<form>` entering the sanitizer allowlist) that must outlive any plan document.

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
MCP server setup, connecting clients (`claude mcp add`), the tool reference, and driving the local HTTP API by hand with curl (token header, confirm prompts) for device checks: see [`docs/guide/mdpro-mcp-guide.md`](./docs/guide/mdpro-mcp-guide.md).

## Typora-Parity Phase 1 Scope (rendering)

Phase 1 wires math (`$…$` / `$$…$$`), footnotes, autolinks, and emoji on the
**canonical Rust render surface** — i.e. HTML export (`render_markdown` →
`sanitize_html` / MathML export). That is the supported math/footnote path
for Phase 1. The Preview pane was the other consumer of this surface; it was
deleted in the stage-2 dead-code cleanup, so export is now the only one.

**Explicitly deferred to Phase 2 / follow-up:**

- **Milkdown WYSIWYG (surface 4)** does NOT typeset math or render footnotes.
  There is no Milkdown math/footnote plugin in `src/plugins/milkdown/`. In source
  mode `$…$` and `[^1]` remain visible as plain literal text (readable, not broken
  markup) — this is the accepted Phase 1 behavior, not a bug.
- **Export `marked` fallback** (`exportService.renderMarkdown` catch block, used
  only when the Rust IPC throws) renders neither math nor footnotes. Accepted
  degradation (plan decision A1); pinned by `tests/export-fallback-degradation.test.ts`.

