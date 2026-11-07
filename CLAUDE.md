# CLAUDE.md

Guidance for Claude Code in this repository. Rules with enforceable detail live in `.claude/rules/`; the text this file
held before D355 is in `docs/reference/20261027-rules-70-71-history.md`.

## gstack

Use the `/browse` skill from gstack for all web browsing tasks. Never use `mcp__claude-in-chrome__*` tools.
Skill list, setup, and workflow: [`docs/guide/gstack-workflow-guide.md`](./docs/guide/gstack-workflow-guide.md).

## Lessons Learned

See [`progress.md`](./progress.md) for bug post-mortems, root causes, and patterns to avoid.

## Design System

**Every UI decision references [`design/DESIGN.md`](design/DESIGN.md)** (user decision, 2026-10-11: 「mark
这个就是最后所有的 UI 设计都参考的设计方案」). Read it before a visual or UI decision. Rules 30–34 (path-scoped) are the
enforceable part and win any conflict with it. Do not deviate without explicit user approval; in QA mode, flag code
that doesn't match the rules.

## Project Overview

mdpro is a local Markdown editor for macOS, combining Typora's WYSIWYG experience with modern design, built with Tauri
2.0 (Rust backend + React frontend). **Target**: macOS 13+, Apple Silicon (ARM64).

Prerequisites: **pnpm 10.26.1** (pinned by `packageManager`; never `npm`/`yarn`), the Rust stable toolchain via
`rustup`, and the Xcode Command Line Tools.

## Development Commands

```bash
pnpm install              # Install dependencies
pnpm tauri dev            # Start development (frontend + Tauri window)
pnpm dev                  # Frontend only (Vite dev server, no Tauri)
pnpm build                # Build frontend (runs tsc + vite build)
pnpm tauri build          # Build production app (.dmg)
cd src-tauri && cargo check | cargo test | cargo fmt | cargo clippy
```

**Every heavy command runs through `scripts/heavy-lock.sh`**: vitest with coverage, `tsc`, `pnpm build`, `cargo test`,
`tauri build`. Rule 10 has the lanes and the worker limits.

## Architecture

Rust backend in `src-tauri/src/` (`commands/` = IPC handlers, `services/` = business logic, `models/` = data types,
`menu.rs` = native menu); React frontend in `src/` (`components/`, `hooks/`, `services/` = typed `invoke()` wrappers and the editor port,
`stores/` = Zustand, `plugins/` = Milkdown/Tiptap/CodeMirror). Stack and directory map:
[`docs/guide/architecture.md`](./docs/guide/architecture.md).

The frontend calls Rust with `invoke()`; commands are registered in `src-tauri/src/commands/mod.rs`. Key commands:
`open_file`, `save_file`, `create_document`, `export_html`, `export_rendered_html`, `pick_image`, `save_draft`,
`recover_draft` (returns `target` and `claimToken`; `save_draft`/`delete_draft` take an optional `claimToken`,
ADR-0127), `get_preferences`, `get_app_version`, `quit_guard_reply`, `mcp_set_server_enabled`, `mcp_confirm_reply`,
`get_applied_shortcuts`. Rust → frontend events: [`docs/guide/architecture.md#events`](./docs/guide/architecture.md#events).
The native menu: [`docs/guide/keyboard-shortcuts.md#menu-system`](./docs/guide/keyboard-shortcuts.md#menu-system).

## Release Workflow

Bump `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` together (rule 40, or `/bump`). Releases
are built by dispatching `release.yml`, never by pushing a tag, and never by `gh release create` (ADR-0073). Runbook:
[`docs/guide/release-runbook.md`](./docs/guide/release-runbook.md).

## Git Commit Conventions

Atomic commits, one logical change each, as `<type>(<scope>): <short summary>`, a body that explains why, and the
`Co-Authored-By` trailer. Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`. Before each
commit: only related files staged (`git diff --cached --stat`), the project builds, no secrets or large binaries.
Splitting a large change by layer: `docs/agents/implementor.md#commit-splitting`.

## User questions and answers

A question the user asks a session directly, whose answer is worth finding a week later, goes into
[`docs/reference/user-question-and-answer.md`](./docs/reference/user-question-and-answer.md), whose header holds the
criteria. The session answers, then sends the delegator the question verbatim and the answer in one to four sentences
(a Codex session puts them in its final message); the delegator records it or not.

## Plan status tracking

**A new item is a GitHub issue in `anzchy/mdpro`**, and its state and labels are its status; the landing record updates
and closes it (decision: `docs/agents/decisions/20261102-new-items-are-github-issues.md`). The sequencing doc,
[`docs/plans/20260912-frontend-backend-sequencing-order.md`](./docs/plans/20260912-frontend-backend-sequencing-order.md),
carries order only; its existing D rows are still updated by the commit that finishes them. Verified means the item's own gates passed. A rule-12 item
follows its approved spec snapshot. Landing: rule 70 § Commits and branches.

## Agent skills

Specs and tickets are GitHub issues in `anzchy/mdpro` (`docs/agents/issue-tracker.md`); triage labels in
`docs/agents/triage-labels.md`; one `GLOSSARY.md` and `docs/adr/` (`docs/agents/domain.md`).

## Worktrees

All worktrees live in `/Users/jack/Documents/mac-app/mdpro-wt/` (ADR-0134). A large feature's worktree needs the
user's approval first (branch, directory, base). Branch `<type>/<id>-<slug>`; directory is the branch with `/` → `-`;
create with `git worktree add ../mdpro-wt/<dir> -b <branch> master` and copy the gitignored sidecar
`src-tauri/binaries/mdpro_mcp-aarch64-apple-darwin` in before `pnpm tauri build`. Move only with `git worktree move`.
A landed item's worktree is removed at landing (ADR-0157); deleting a branch needs the user's confirmation (rule 25).
`isolation: "worktree"` subagents remove their own `.claude/worktrees/agent-*`; leave `~/.codex/worktrees/` alone.

## Manual test fixtures

Device-check documents live in `tests/manual-fixtures/` (`<id>-<slug>.md`); run on a copy
([`tests/manual-fixtures/README.md`](./tests/manual-fixtures/README.md)).

## Feature Ledger

[`docs/feature-ledger.md`](./docs/feature-ledger.md) is the inventory of what mdpro has now. **The commit that changes
the behaviour rewrites the row**, the same rule as the item's issue. State is one of `Shipped` / `Partial` / `Stub` /
`Absent` / `Unknown`; `Partial` carries a literal `限制：`. Run `pnpm ledger:check` before committing a behaviour change,
and `pnpm ledger:build` when the markdown changes. It is not a changelog, a plan or an ADR.

## Architecture Decision Records (ADR)

**An ADR records a significant product or architecture decision** (ADR-0165): an IPC or MCP contract, a persisted
format or preference key, a dependency, a rendering surface or engine, platform and release scope, an accepted known
defect, or not building something. Significant: costly to reverse once shipped, or binding several modules or an
external party. Otherwise, or in doubt, it goes below the bar (issue, spec or ledger row). Process goes to
[`docs/agents/decisions/`](./docs/agents/decisions/README.md).

The delegator reserves numbers. Structure: Status, Enforced by, Context, Options considered, Decision, Consequences;
one page. An accepted ADR's body is immutable; a changed mind takes a superseding ADR. The bar, review, Status and
fold-in: [`docs/adr/README.md`](./docs/adr/README.md).

## Spec-Driven Development

Feature specifications live in `specs/001-mdpro-mvp/` (`spec.md`, `plan.md`, `tasks.md`, `contracts/`). Constitution:
atomic commits; TDD per rule 10; every release-affecting change updates `CHANGELOG.md` under `## [Unreleased]`.

## Cross-Platform Development (Mac + WSL)

**Always LF** (`.gitattributes` is authoritative); **never set `core.autocrlf = true`**. Details:
[`docs/guide/cross-platform-wsl.md`](./docs/guide/cross-platform-wsl.md).

## Constraints

Local files only (no cloud sync); no third-party plugin marketplace; HTML export only (no PDF/Word); max file size 10MB.

## Logging Rules

After any new feature, add structured logging (rule 20 has the code samples). Event names: `ui.<component>.<action>`,
`file.<action>`, `app.<action>`, `window.<action>`, `tab.<action>`. The log is `~/.mdpro/mdpro.log`, JSONL
(`tail -f ~/.mdpro/mdpro.log | jq .`).

## Debugging

[`docs/guide/debugging.md`](./docs/guide/debugging.md); the MCP server and its HTTP API:
[`docs/guide/mdpro-mcp-guide.md`](./docs/guide/mdpro-mcp-guide.md). Phase 1 rendering scope (math and footnotes on the
export surface only): [`docs/guide/md-engine-architecture.md#phase-1-scope`](./docs/guide/md-engine-architecture.md#phase-1-scope).
