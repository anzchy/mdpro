---
description: Test-Driven Development discipline — when tests are required, mdpro-specific test patterns, and where test files must live.
---

# 10 - TDD Workflow

Vitest + jsdom (frontend) and `cargo test` (Rust). Run `pnpm test:run`
or `cd src-tauri && cargo test` before commit.

## Core discipline

**Work RED → GREEN → REFACTOR** — a test you never saw fail proves nothing.
Bug fixes MUST include a regression test that fails without the fix and
passes with it.

## When tests are required

| Category | Required? | Notes |
|----------|-----------|-------|
| Stores (`src/stores/`) | **Yes** | State transitions, selectors |
| Hooks (`src/hooks/`) | **Yes** | Side effects, lifecycle |
| Utils / parsers / formatters | **Yes** | Pure functions |
| Rust commands (`src-tauri/src/commands/`) | **Yes** | Input validation, error paths |
| Business logic (close, save, merge) | **Yes** | |
| Bug fixes | **Yes** | Regression test |
| Edge cases (empty, null, max, concurrent) | **Yes** | Bugs live at boundaries |
| Components | Case-by-case | Test behavior (clicks, ARIA), not rendering |
| Plugins (Milkdown / CodeMirror) | Case-by-case | Test extracted logic, not editor DOM |
| CSS-only | No | Visual QA in both themes |
| Docs / config / type-only | No | |

## Anti-patterns

- **Mock only at boundaries** (Tauri, network, fs) — mocking the logic under test makes the test assert its own mock.
- **No snapshot tests for logic** — snapshots get auto-updated without review; use explicit assertions.

## mdpro-specific patterns

- **Stores**: reset with `useXStore.setState(...)` in `beforeEach`. Call actions via `useXStore.getState()` — no React rendering needed.
- **Hooks**: use `renderHook` from `@testing-library/react`. Mock `@tauri-apps/api/event` and `@tauri-apps/api/core` at boundaries.
- **Components**: query by ARIA role/name, not CSS class. Use `userEvent`, not `fireEvent`.
- **Plugins**: extract testable logic from plugin wiring; test transforms and state changes, not editor DOM.
- **Rust commands**: every `#[tauri::command]` returns a `Result` (error type is `String` or a serializable enum such as `FileError`); test the error path explicitly.

## File placement

**Put frontend tests in `tests/<name>.test.ts`** — `vitest.config.ts` only includes `tests/**/*.test.ts`, so a test co-located under `src/` never runs.
