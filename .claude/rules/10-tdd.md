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

**Format before you record.** A Rust red is recorded on `rustfmt`-clean test
files (`cargo fmt` first, then `receipt.js record`), and `cargo fmt` is never
run between record and verify: the receipt fingerprints the file's bytes, and a
later reformat breaks it for good (D187). The PreToolUse hook
`.claude/hooks/receipt-rustfmt-guard.sh` enforces this: it refuses the record
and names each Rust file that is not `rustfmt`-clean.

## How much to run, and when

Several sessions share one machine, so **run the full suite once per commit,
not once per step**. The full unit lane (413 files, with coverage) and two
`cargo test` builds are the heaviest jobs here, and repeating them is most of
the CPU load.

| When | Run | Coverage |
|------|-----|----------|
| RED → GREEN while writing a WI | Only the affected files: `pnpm exec vitest run tests/<files>`, or `pnpm exec vitest related <changed src files> --run` | Off |
| Once, just before each commit | The full `unit` lane, plus typecheck and build **under the lock**: `scripts/heavy-lock.sh sh -c 'pnpm -s typecheck:tests && pnpm -s build'` | On (the gate reads it) |
| Only when `src-tauri/` changed | The `rust` and `rust-verify-run` lanes | — |
| After a rebase or fast-forward that only brought docs or `.claude` changes | Nothing new: `src/` and `tests/` are tree-identical, so the earlier gate still holds. Re-run only the tests touching any conflicted file | — |
| After a rebase or fast-forward that brought a `patches/` or lockfile change | `pnpm install --force --frozen-lockfile --offline` first, in every worktree you build in: the D181 guard refuses a build whose `node_modules` predates the patch set (2026-10-13, D192's patch landing broke adr047's and the main checkout's builds) | — |

- **Every heavy command goes through `scripts/heavy-lock.sh`**: vitest
  with coverage, `tsc`, `pnpm build`, `cargo test`, `tauri build`. A command
  outside the lock runs in parallel with another session's locked job, so the
  lock only stops half of the overload.
- **A full run happens once per commit.** When a subagent has already run the
  full lane on the exact tree being committed, the session reviewing its work
  reads that log and re-runs only the decisive test files. Run it again only
  if the tree changed after that run.
- **An unlocked partial run takes at most 2 workers.** The RED → GREEN
  runs in the first row are outside the lock, so three sessions doing them at
  once stack their workers on the same cores; on 2026-10-11 the machine sat at
  load 45 on 10 cores with one locked lane running. Since D147 (`bce24d3`)
  `vitest.workers.ts` makes 2 the default whenever `heavy-lock.sh` is not the
  parent; a locked run gets `50%`, and an explicit `VITEST_MAX_WORKERS` still
  wins. (User decision, 2026-10-11.)
- **Two handoffs on the same parent cost one full run, not two.** The one
  that arrived first is verified and landed; the other waits for that landing,
  rebases once, and is verified by tree identity (rule 70 § Commits). A peer
  does not start a lane run on a handoff it has been told to hold.
- Need the machine for something else? Lower `VITEST_MAX_WORKERS` (default
  `50%`, e.g. `30%`). The cost is a longer run.
