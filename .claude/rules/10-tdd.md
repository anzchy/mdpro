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

**Put frontend tests under `tests/`** — `vitest.config.ts` includes `tests/**/*.test.{ts,tsx}`, so both `.test.ts` and `.test.tsx` are discovered, but only inside `tests/`. A test anywhere else — co-located under `src/`, or in a feature-local folder — never runs.

## Environment and the slow tier

- **jsdom is the default; a DOM-free file opts into node** with `// @vitest-environment node` as its first line. `tests/setup.ts` then makes any first-party read of `window`, `document`, `navigator` and the rest fail the file — if it trips, remove the marker rather than stubbing around it ([ADR-0049](../../docs/adr/0049-dom-free-test-files-opt-into-the-node-environment.md)).
- **An exhaustive, property or cost-enumeration test that takes ≥ 2 s under coverage goes in a `*.slow.test.ts` sibling.** The default run and the per-commit `unit` lane exclude it; `pnpm test:slow` and the tdd-guardian `slow` lane (push / manual) run it. Share the domain through `tests/support/`, never by copying it ([ADR-0050](../../docs/adr/0050-exhaustive-tests-run-in-a-separate-slow-lane.md)).
