# Repository Guidelines

## Read first (Codex)

Codex loads only this file. It does not load `CLAUDE.md` or `.claude/rules/`, and it does not follow links by itself, so read them yourself:

1. **At the start of every session, read [`CLAUDE.md`](./CLAUDE.md) in full.** It is the project's main instruction file; this file only summarises parts of it.
2. **Then read the always-on rules**: [`10-tdd`](.claude/rules/10-tdd.md), [`12-feature-planning-gate`](.claude/rules/12-feature-planning-gate.md), [`22-comment-maintenance`](.claude/rules/22-comment-maintenance.md), [`25-careful-mode`](.claude/rules/25-careful-mode.md), [`50-codebase-conventions`](.claude/rules/50-codebase-conventions.md), [`60-review-checklist`](.claude/rules/60-review-checklist.md), [`70-multi-session-coordination`](.claude/rules/70-multi-session-coordination.md), and [`71-herdr-mixed-roster`](.claude/rules/71-herdr-mixed-roster.md), which replaces the rule 70 clauses it names and adds what applies to you (the brief and self-acceptance table, receipts with the Node CLI, how you report).
3. **Before editing a file, read the rules its path triggers.** Claude Code loads these automatically from each rule's `paths:` frontmatter; Codex must do it by hand:

   | You are about to edit | Read first |
   |---|---|
   | `src-tauri/src/commands/**/*.rs`, `src/services/**/*.ts`, `src/hooks/**/*.ts`, `src/components/**/*.tsx` | [`20-logging-and-docs`](.claude/rules/20-logging-and-docs.md) |
   | `src/**/*.css`, `src/**/*.tsx`, `src/plugins/**/*.ts` | [`30-ui-consistency`](.claude/rules/30-ui-consistency.md), [`32-component-patterns`](.claude/rules/32-component-patterns.md), [`33-focus-indicators`](.claude/rules/33-focus-indicators.md), and [`design/DESIGN.md`](design/DESIGN.md) |
   | `src/**/*.css`, `src/App.tsx`, `src/main.tsx` | [`31-design-tokens`](.claude/rules/31-design-tokens.md), [`34-dark-theme`](.claude/rules/34-dark-theme.md) |
   | `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` | [`40-version-bump`](.claude/rules/40-version-bump.md) |
   | `src-tauri/src/menu.rs`, `src/types/preferences.ts`, `src/hooks/useKeyboardShortcuts.ts`, `src/components/common/settings/KeyboardShortcutsSettings.tsx`, `docs/guide/keyboard-shortcuts.md` | [`41-keyboard-shortcuts`](.claude/rules/41-keyboard-shortcuts.md) |

4. **Command guards.** [`.codex/rules/mdpro.rules`](.codex/rules/mdpro.rules) binds every Codex role. A per-worktree, gitignored `.codex/rules/mdpro-role.rules` adds its role limits. Only the delegator pushes and lands, through `node scripts/codex-rules/push-guard.mjs` and `node scripts/codex-rules/land-guard.mjs`. It replaces `.claude/hooks/role-guard.sh`, which Codex does not run. A forbidden command means *ask*. Any other spelling is evasion: `git -C`, `env`, `./`-prefixed or absolute script paths, `node --…`, wrappers, and `gh api`.

### Claude Code features Codex does not have

`CLAUDE.md` and the rules name tools that exist only in Claude Code. Use these instead:

| The rules say | In Codex |
|---|---|
| `AskUserQuestion`, or `SendMessage` to `mdpro-delegator` | Stop and put the question in your final message. The delegator drives you through herdr and reads your pane. Never ask the user directly. |
| A rule-25 confirmation | Same: stop and name the exact command and what it could lose. |
| `/tdd-guardian:workflow` and its steps | Run `$tdd-guardian:tdd-guardian-workflow` from the installed plugin. The brief, rules 10/71, project gates, and self-acceptance handoff still apply. The old `.codex/skills/mdpro-tdd-workflow/` port is archived for prior handoffs. |
| Other `/` skills, `Agent` subagents | Run the lanes in rule 10's tables yourself, through `scripts/heavy-lock.sh`, and report each command and its result. |
| Hooks (`.claude/hooks/*`) | Not run. `.codex/rules/mdpro.rules` covers the command guards. |
| A handoff or report "in a file" | Write it under `~/.mdpro-redesign/herdr-spike/<your herdr agent name>/` and give the path in your final message. |

**Delegator routing:** If you hold `herdr-delegator`, run the [mdpro-delegator Skill](.agents/skills/mdpro-delegator/SKILL.md) and follow [rule 71's runtime route](.claude/rules/71-herdr-mixed-roster.md#delegator-runtime-route). Codex uses the completion-listener scripts; Claude uses its original background Bash and Claude tools. The agent roster is shared; ADR-0143 requires both auditors on every audit, at most two rounds.

## Project Structure & Module Organization
- `src/` holds the React + TypeScript UI (entry in `src/main.tsx`, main component in `src/App.tsx`).
- `src-tauri/` contains the Rust backend, Tauri config (`src-tauri/tauri.conf.json`), and app icons.
- `public/` is for static assets served by Vite.
- `specs/` includes product docs and contracts; the active MVP spec is under `specs/001-mdpro-mvp/`.

## Prerequisites
- **pnpm 10.26.1**, pinned by `packageManager` in `package.json`.
- **Rust stable toolchain** via `rustup` (`src-tauri/Cargo.toml` is edition 2021; no toolchain file pins a version).
- **Xcode Command Line Tools**, required by Tauri to build on macOS.
- Target: macOS 13+ on Apple Silicon (ARM64).

## Build, Test, and Development Commands
- This repo uses **pnpm** (`package.json` declares `"packageManager": "pnpm@10.26.1"`; `pnpm-lock.yaml` is tracked). Never run `npm`/`yarn`.
- `pnpm dev`: starts the Vite dev server for the web UI.
- `pnpm build`: type-checks (`tsc`) and builds the production web bundle.
- `pnpm preview`: serves the built web bundle locally.
- `pnpm tauri dev`: runs the desktop app in development (requires Rust toolchain).
- `pnpm tauri build`: produces a desktop app build via Tauri.

## Coding Style & Naming Conventions
- TypeScript/React uses 2-space indentation, double quotes, and semicolons (match existing files).
- Prefer functional React components with hooks; keep component files in `PascalCase` (e.g., `App.tsx`).
- Use `camelCase` for variables/functions, `PascalCase` for components/types, and `snake_case` in Rust.
- Keep UI styles in colocated CSS files (e.g., `src/App.css`) unless a component warrants its own file.

## Testing Guidelines
- Frontend tests use `Vitest` with `jsdom`.
- Install dependencies from project root: `pnpm install`.
- Run all frontend tests: `pnpm test:run`.
- Run a specific test file in `tests/`: `pnpm test:run -- tests/markdown-editor-core.test.ts`.
- Edge-case checklist lives in `tests/edge-cases-test.md` and should be used as regression coverage input.
- Rust backend tests run in `src-tauri/` via `cargo test`.
- Name test files `*.test.ts` / `*.test.tsx` and put them **under `tests/`**: at the root for app behaviour, or in `tests/control/`, `tests/tooling/` or `tests/perf/` when its system under test puts it there (the table in `.claude/rules/10-tdd.md` § File placement, ADR-0098). `vitest.config.ts` sets `include: ["tests/**/*.test.{ts,tsx}"]`, so a test in a feature-local folder under `src/` is never discovered and silently never runs.

## Commit & Pull Request Guidelines
- Commit messages use conventional commits `<type>(<scope>): <short summary>` (e.g., "fix(save): surface write errors"); see CLAUDE.md "Git Commit Conventions".
- PRs should include a clear summary, link to any relevant spec in `specs/`, and UI screenshots for visual changes.
- Call out any Tauri/Rust changes that affect permissions or capabilities.

## Configuration & Security Notes
- Tauri permissions/capabilities live in `src-tauri/capabilities/`; update them alongside feature work.
- Treat `src-tauri/tauri.conf.json` as the source of truth for bundling and app metadata.

> `.claude/rules/*.md` is canonical for every contract below; if this file ever disagrees with a rule file, the rule file wins and this file is the bug.

## Working Agreement
- Run `git status -sb` at session start.
- Read relevant files before editing. Understand before changing.
- Keep diffs focused — do not refactor surrounding code not mentioned in the task.
- Do not commit unless explicitly requested.
- Keep code files under ~300 lines; split proactively.

## Zustand Patterns (MANDATORY)
- NEVER destructure store values at component top-level — use selectors.
  BAD:  `const { mode } = useEditorStore()`
  GOOD: `const mode = useEditorStore(s => s.mode)`
- Inside callbacks/event handlers, use `useXStore.getState()` — never read stale closure state.
- All stores use `create<State>()` with explicit TypeScript generic — never untyped.

## Tauri IPC Rules
- Every `#[tauri::command]` must return a `Result` — never `unwrap()`/`expect()` on user input. The error type is `String` **or** a `Serialize` enum such as `FileError` (`src-tauri/src/commands/file.rs` uses the latter); both are valid.
- Log every command with Start + Success/Fail pairs using `logger::log_event()`.
- A new command must be registered in `src-tauri/src/commands/mod.rs` → `handlers()`, and needs a typed `invoke()` wrapper in `src/services/`. It does **not** need an entry in `src-tauri/capabilities/default.json` — that file carries only `core:*` and plugin permissions (`opener`, `updater`, `process`), not application commands.

## Logging (MANDATORY for all new features)
- TypeScript: use `loggingService.logEventSync()` — never `console.log()` in committed code.
- Rust: use `logger::log_event()` — never `println!()` / `eprintln!()` in committed code.
- Every significant user action needs: `[ActionName] Start` → `[ActionName] Success/Fail`.
- Include `actionId` in every log call.

## Styling Rules
- Default to CSS variables (`--color-text`, `--color-bg`, etc.); do not hardcode hex/rgb/rgba colors. Sanctioned exceptions exist and are not review findings: `.claude/rules/31-design-tokens.md` "Acceptable hardcoded values" (e.g. `rgba()` fallback lines preceding `color-mix()`, defensive `var(--xyz, #fallback)`) and `.claude/rules/34-dark-theme.md` "When overrides are needed" (per-theme raw `rgba()` for translucency where the source color must flip). Prefer `color-mix(in srgb, var(--color-text) N%, transparent)` over raw rgba; if no token exists, add it to both theme files first.
- Plugin styles live ONLY in their colocated `<name>.css` file, not in `src/styles/globals.css`.
- Theming uses `.theme-light` / `.theme-dark` class selectors on the root (not `[data-theme]`); see `.claude/rules/34-dark-theme.md`.

## Test Rules
- Every new store file needs a corresponding `*.test.ts`.
- Every bug fix needs a regression test that would have caught it.
- Never use snapshot tests for logic — use explicit assertions.
- Edge cases to always consider: empty input, null/undefined, Unicode/CJK, concurrent access.

## Version Sync (Rule 40)
- `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` must always match.
- Update all three when bumping version — never update just one.

## Verification Gates (run after any change)
- `pnpm build` — always
- `cd src-tauri && cargo check` — if any .rs file changed
- `pnpm test:run` — if any .test.ts touched or new tests added

## Code Review Guidelines (for `@codex review`)
Source of truth is `.claude/rules/60-review-checklist.md`; use its four labels, not P0–P3:

| Label | Meaning | Action |
|---|---|---|
| **BLOCK** | Data loss, security, or silent failure | Must fix before merge |
| **MUST** | Rule violation or correctness issue | Fix in this PR |
| **SHOULD** | Code quality or test gap | Fix now if cheap; otherwise file an issue |
| **NOTE** | Observation | No action; mention in the PR description |

Report BLOCK and MUST always. Report SHOULD only when the fix is concrete and cheap.
NOTE is optional. The six universal discipline rules in `.claude/rules/30-ui-consistency.md`
are review-blocking: a violation is at least **MUST**.

Treat these as BLOCK (must fix before merge):
- Tauri `#[tauri::command]` that trusts frontend input (paths, IDs, strings) without
  validation, or uses `unwrap()`/`expect()` on user-supplied data. Commands must return
  a `Result` (error type `String` or a `Serialize` enum such as `FileError`).
- MCP tool handlers that touch the shadow store or emit events without validating args.
- Save/draft paths that can silently discard dirty content, or overwrite a newer draft
  with an older one. Document close with unsaved changes must prompt, never silent-discard.
- Async commands touching shared state (file watcher, shadow store, draft timer) without
  `Mutex`/`Arc<RwLock>` guarding.
- Frontend `listen()` handlers closing over Zustand state instead of `useXStore.getState()`
  (stale-closure bug).
- Auto-save firing after document close; un-debounced file-watcher reloads.
- Rust `match` with `_ => {}` that silently drops cases; non-exhaustive TS discriminated
  unions; a new `menu:action` value with no handler in `useMenuEvents.ts`.
- Events emitted to the frontend that leak secrets or non-serializable data.

Treat these as SHOULD (comment, do not block; omit if the fix isn't obvious):
- `console.log`/`println!` in committed code (use the logging service), magic numbers,
  dead code, files over ~300 lines, missing tests, a behaviour change that didn't rewrite
  its `docs/feature-ledger.md` row.

Do not flag style nits below NOTE. Keep reviews focused on correctness, data loss,
and trust-boundary risks.
