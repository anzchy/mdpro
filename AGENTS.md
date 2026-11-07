# Repository Guidelines

## Every session (Codex)

Codex loads only this file, and it does not follow links by itself. The files in this block bind every session; open
each one at session start, and then the files in your role's row below. Rules 70 and 71 bind every herdr session.

<!-- read-every-session:begin -->
- [CLAUDE.md](CLAUDE.md)
- [.claude/rules/12-feature-planning-gate.md](.claude/rules/12-feature-planning-gate.md)
- [.claude/rules/25-careful-mode.md](.claude/rules/25-careful-mode.md)
- [.claude/rules/60-review-checklist.md](.claude/rules/60-review-checklist.md)
<!-- read-every-session:end -->

| Role | Also open at session start |
|---|---|
| implementor | `docs/agents/implementor.md`, `.claude/rules/70-multi-session-coordination.md`, `.claude/rules/71-herdr-mixed-roster.md` |
| auditor | `docs/agents/auditor.md`, `.claude/rules/70-multi-session-coordination.md`, `.claude/rules/71-herdr-mixed-roster.md` |
| device tester | `docs/agents/device-tester.md`, `.claude/rules/70-multi-session-coordination.md`, `.claude/rules/71-herdr-mixed-roster.md` |
| herdr-delegator | `.agents/skills/mdpro-delegator/SKILL.md`, `.claude/rules/70-multi-session-coordination.md`, `.claude/rules/71-herdr-mixed-roster.md` |

## Path-triggered rules

Claude Code loads these from each rule's `paths:` frontmatter; Codex opens them by hand when
it is about to edit a matching path:

| Path you are about to edit | Rule that binds it |
|---|---|
| `src/**`, `src-tauri/**`, `tests/**`, `scripts/**`, `.claude/hooks/**`, `.agents/skills/**/scripts/**`, `vitest*.ts` | `.claude/rules/10-tdd.md` |
| `src/**`, `src-tauri/**`, `tests/**`, `scripts/**`, `.claude/hooks/**`, `.agents/skills/**/scripts/**` | `.claude/rules/22-comment-maintenance.md` |
| `src/**`, `src-tauri/**`, `tests/**` | `.claude/rules/50-codebase-conventions.md` |
| `src-tauri/src/commands/**/*.rs`, `src/services/**/*.ts`, `src/hooks/**/*.ts`, `src/components/**/*.tsx` | `.claude/rules/20-logging-and-docs.md` |
| `src/**/*.css`, `src/**/*.tsx`, `src/plugins/**/*.ts` | `.claude/rules/30-ui-consistency.md`, `32-component-patterns.md`, `33-focus-indicators.md`, `design/DESIGN.md` |
| `src/**/*.css`, `src/App.tsx`, `src/main.tsx` | `.claude/rules/31-design-tokens.md`, `34-dark-theme.md` |
| `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` | `.claude/rules/40-version-bump.md` |
| `src-tauri/src/menu.rs`, `src/types/preferences.ts`, `src/hooks/useKeyboardShortcuts.ts`, `src/components/common/settings/KeyboardShortcutsSettings.tsx`, `docs/guide/keyboard-shortcuts.md` | `.claude/rules/41-keyboard-shortcuts.md` |

## Command guards (Codex)

`.codex/rules/mdpro.rules` binds every Codex role. A per-worktree, gitignored
`.codex/rules/mdpro-role.rules` adds its role limits. Only the delegator pushes and lands, through
`node scripts/codex-rules/push-guard.mjs` and `node scripts/codex-rules/land-guard.mjs`. It replaces
`.claude/hooks/role-guard.sh`, which Codex does not run. A forbidden command means *ask*. Any other spelling is evasion:
`git -C`, `env`, `./`-prefixed or absolute script paths, `node --…`, wrappers, and `gh api`.

### Claude Code features Codex does not have

| The rules say | In Codex |
|---|---|
| `AskUserQuestion`, or `SendMessage` to the delegator | Stop and put the question in your final message. Never ask the user directly. |
| A rule-25 confirmation | Same: stop and name the exact command and what it could lose. |
| A skill (`jack-tdd-workflow`, `code-review`) | Use your installed copy; the brief names its version. Both runtimes follow `jack-tdd-workflow`. |
| `Agent` subagents | Run rule 10's lanes yourself, through `scripts/heavy-lock.sh`, and report each command and its result. |
| Hooks (`.claude/hooks/*`) | Not run. `.codex/rules/mdpro.rules` covers the command guards. |
| A handoff or report "in a file" | Write it under `~/.mdpro-redesign/herdr-spike/<your herdr agent name>/` and give the path. |

**Delegator routing:** if you hold `herdr-delegator`, run the mdpro-delegator skill
(`.agents/skills/mdpro-delegator/SKILL.md`) and follow rule 71 § Delegator runtime route.

## Project and commands

`src/` is the React + TypeScript UI, `src-tauri/` the Rust backend and Tauri config, `public/` static assets, `specs/`
product docs. Use **pnpm** only. `pnpm dev`, `pnpm build`, `pnpm tauri dev`, `pnpm tauri build`; `pnpm test:run`;
`cd src-tauri && cargo test`. Prerequisites, stores, IPC, logging, styling and version sync: `CLAUDE.md` and the
path-triggered rules above.

## Working agreement

- Run `git status -sb` at session start; keep diffs focused; do not commit unless the brief asks.
- Name test files `*.test.ts(x)` and put them under `tests/` (rule 10 § File placement); a test under `src/` never runs.
- Commit messages: `<type>(<scope>): <short summary>`, as `CLAUDE.md` § Git Commit Conventions says.
- `.claude/rules/*.md` is canonical; if this file disagrees with a rule file, the rule file wins and this file is the bug.

## Code Review Guidelines (for `@codex review`)

Source of truth is `.claude/rules/60-review-checklist.md`; use its four labels, not P0–P3: **BLOCK** (data loss,
security, or silent failure: fix before merge), **MUST** (rule violation or correctness issue: fix in this PR),
**SHOULD** (code quality or test gap: fix now if cheap, otherwise file an issue), **NOTE** (observation). Report BLOCK
and MUST always, SHOULD only when the fix is concrete and cheap. The six universal discipline rules in
`.claude/rules/30-ui-consistency.md` are review-blocking: a violation is at least **MUST**.

Treat these as BLOCK:
- a Tauri `#[tauri::command]` that trusts frontend input (paths, IDs, strings) without validation, or uses
  `unwrap()`/`expect()` on user-supplied data; commands return a `Result` (`String` or a `Serialize` enum);
- MCP tool handlers that touch the shadow store or emit events without validating args;
- save/draft paths that can silently discard dirty content, or overwrite a newer draft with an older one; a close with
  unsaved changes that does not prompt;
- async commands touching shared state (file watcher, shadow store, draft timer) without `Mutex`/`Arc<RwLock>`;
- frontend `listen()` handlers closing over Zustand state instead of `useXStore.getState()`;
- auto-save firing after document close; un-debounced file-watcher reloads;
- a Rust `match` with `_ => {}` that silently drops cases; a non-exhaustive TS discriminated union; a new
  `menu:action` value with no handler in `useMenuEvents.ts`;
- events emitted to the frontend that leak secrets or non-serializable data.

Treat these as SHOULD (omit if the fix isn't obvious): `console.log`/`println!` in committed code, magic numbers, dead
code, files over ~300 lines, missing tests, a behaviour change that didn't rewrite its `docs/feature-ledger.md` row.
Do not flag style nits below NOTE.
