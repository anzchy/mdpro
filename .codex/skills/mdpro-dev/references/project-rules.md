# mdpro Project Rules

## Engineering

- Read before editing; keep diffs focused.
- Prefer local project patterns over new abstractions.
- Avoid cross-feature imports unless the dependency is genuinely shared.
- Keep source files under roughly 300 lines.
- Fix root causes, not symptoms.

## TDD

Use RED -> GREEN -> REFACTOR for behavior changes.

Tests are required for:
- stores, hooks, utils/helpers, Rust commands, business logic, bug fixes, and edge cases
- empty input, null or undefined, boundary values, Unicode/CJK, concurrent access, and rapid repeated actions

Tests are usually not required for:
- CSS-only, docs-only, config-only, or type-only changes with no runtime behavior

Patterns:
- Store tests call actions through `useStore.getState()` and reset state in `beforeEach`.
- Hook tests use `renderHook` and mock Tauri/DOM boundaries.
- Component tests query by ARIA role/name and use `userEvent`.
- Utils/service tests use table-driven `it.each`.
- Plugin tests should test extracted logic, not full editor integration.
- Do not use snapshot tests for logic.

## Zustand

- Never destructure store values at component top level.
- Good: `const mode = useEditorStore((state) => state.mode);`
- Inside callbacks/listeners, use `useXStore.getState()` to avoid stale closure state.
- All stores use `create<State>()` with an explicit TypeScript generic.

## IPC And Events

Tauri IPC flow:
1. Rust command in `src-tauri/src/commands/<module>.rs`
2. Registration in `src-tauri/src/commands/mod.rs`
3. Typed frontend wrapper in `src/services/<service>.ts`

Rules:
- Every `#[tauri::command]` returns `Result<T, String>`.
- Never `unwrap()` or `expect()` user input.
- Validate paths, IDs, strings, and MCP args at the Rust boundary.
- Emit only serializable, non-secret event payloads.
- New commands need capability entries in `src-tauri/capabilities/default.json`.

Event naming:
- `menu:action`
- `file:open`, `file:changed`
- `mcp:write_document`, `mcp:insert_content`
- `theme:changed`

Frontend listeners must clean up unlisten functions in `useEffect` cleanup.

## Logging

Frontend:
- Use `loggingService.logEventSync({ level, event, status, actionId, context })`.
- Significant user actions log Start plus Success or Fail.
- Event names should be specific, for example `ui.settings.save`.

Rust:
- Use `logger::log_event(LogEntryPayload { ... })`.
- New Tauri commands log Start plus Success or Fail.
- Include `action_id` when available.

Never commit:
- `console.log`
- `println!`
- `eprintln!`

Verify logs with:

```bash
tail -f ~/.mdpro/mdpro.log | jq .
```

## Comments

When changing files with `Purpose:` header comments or Rust `//!` module docs, keep the comments synchronized.

Update docs when you change:
- function behavior
- exports
- `@coordinates-with`
- data flow or pipeline
- design decisions
- known limitations
- edge-case handling

Do not do drive-by comment edits in unrelated files. Do not write comments with line numbers, dates, or author names.

## Pre-Landing Review

Critical checks:
- IPC trust boundaries are validated.
- Race conditions are controlled with fresh store reads and proper cleanup.
- Data-loss paths surface write/save/recovery errors.
- Rust `match` and TypeScript discriminated unions are exhaustive.
- New `menu:action` values have frontend handlers.

Quality checks:
- No dead code, unused imports, or magic numbers without constants.
- New store/hook/service behavior has tests.
- Bug fixes have regression tests.
- Docs and logging are updated for user-facing behavior.

Severity:
- BLOCK: data loss, security, or silent failure. Must fix before landing.
- MUST: rule violation or correctness issue. Fix in this PR.
- SHOULD: code quality or test gap. Fix if cheap, otherwise file or note.
- NOTE: observation only.

## Keyboard Shortcuts

When adding, changing, or removing shortcuts, update all three:

| File | Purpose | Format |
| --- | --- | --- |
| `src-tauri/src/menu.rs` | Native menu accelerators | `CmdOrCtrl+Shift+L` |
| `src/types/preferences.ts` | `DEFAULT_KEYBOARD_SHORTCUTS` | `mod+shift+l` |
| `docs/guide/keyboard-shortcuts.md` | User docs | `Cmd + Shift + L` |

Before adding, check for conflicts in `menu.rs` and `preferences.ts`.

## Version Sync

When bumping versions, update all three together:

| File | Field |
| --- | --- |
| `package.json` | `"version"` |
| `src-tauri/tauri.conf.json` | `"version"` |
| `src-tauri/Cargo.toml` | `version` |

Verify:

```bash
grep '"version"' package.json src-tauri/tauri.conf.json
grep '^version' src-tauri/Cargo.toml
```

Only commit, tag, or push when the user explicitly asks.

