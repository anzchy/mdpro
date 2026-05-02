---
description: Test-Driven Development discipline — when tests are required, anti-patterns to avoid, mdpro-specific commands.
---

# 10 - TDD Workflow

Vitest + jsdom (frontend) and `cargo test` (Rust). Run `pnpm test:run`
or `cd src-tauri && cargo test` before commit.

## Core discipline

**RED → GREEN → REFACTOR.** Write a test that fails for the right
reason, then write the minimum code to pass, then clean up. The
reviewable artifact is *the test fails without the change and passes
with it* — not the order in which keys were typed. Bug fixes MUST
include a regression test that demonstrates this.

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

- Writing code first, tests second — you can't claim a test catches regressions you haven't run it against.
- `it("renders without crashing")` — proves nothing.
- Asserting implementation details (call counts on internal helpers, private state shape) — breaks on refactor.
- Mocking everything — mock at boundaries (Tauri, network, fs), never logic under test.
- Snapshot tests for logic — auto-updated without review; use explicit assertions.
- `any` in test types.
- Skipping edge cases.

## mdpro-specific patterns

- **Stores**: reset with `useXStore.setState(...)` in `beforeEach`. Call actions via `useXStore.getState()` — no React rendering needed.
- **Hooks**: use `renderHook` from `@testing-library/react`. Mock `@tauri-apps/api/event` and `@tauri-apps/api/core` at boundaries.
- **Components**: query by ARIA role/name, not CSS class. Use `userEvent`, not `fireEvent`.
- **Plugins**: extract testable logic from plugin wiring; test transforms and state changes, not editor DOM.
- **Rust commands**: every `#[tauri::command]` returns `Result<T, String>`; test the error path explicitly.

## Commands

```bash
pnpm test:run                  # Frontend tests (Vitest)
pnpm build                     # tsc + vite build
cd src-tauri && cargo test     # Rust tests
cd src-tauri && cargo check    # Rust compile check
```

## File placement

- Co-locate: `foo.test.ts` beside `foo.ts`.
- Larger suites: `__tests__/` subdirectory.
- Shared helpers: `src/test/`.
