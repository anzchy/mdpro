# 0074. The menu-events D3 and A9 properties move to the slow lane

**Status**: Accepted (2026-10-10, mdpro-delegator ruling on D124; number
reserved by the delegator). Partially supersedes
[ADR-0050](0050-exhaustive-tests-run-in-a-separate-slow-lane.md): only its
"Stay in the unit lane" clause for **D3** and **A9**. Every other part of
ADR-0050 stands, including the 2 s threshold, the slow-lane mechanics and
`wysiwyg-edit-persistence` staying in the unit lane.

## Context

ADR-0050 kept two `useMenuEvents` properties in the per-commit unit lane, each
for a stated reason:

- **D3** (`tests/use-menu-events-logging.test.ts`, the logging sweep) stayed
  because D4 asserts the shape of every log line its file captures, D3's
  included, so moving D3 out would shrink D4's domain.
- **A9** (`tests/use-menu-events-subscription.test.ts`, the random-lifecycle
  property) stayed because its `vi.hoisted` / `vi.mock` harness could not be
  shared without duplicating about 270 lines.

D124 (2026-10-10) measured both still costing every commit: D3 8.0 s and A9
8.8 s under the coverage run, each with a 180 s timeout override. Both reasons
were then removed:

- **The harness is shared, not copied.** `tests/support/menuEventsHarness.ts`
  holds the fake event bus, window and captured log lines, and exports the
  `vi.mock` factory bodies. `tests/support/menuEventsDomain.ts` holds the
  hook-side helpers, the 17-row menu table and `expectMenuLineShape` (D4's five
  checks). Each test file keeps only its own one-line `vi.mock` declarations,
  because Vitest hoists them per file.
- **D4's domain is kept.** The slow sibling adds `D4 (slow)`, which runs
  `expectMenuLineShape` over every line D3 captures and asserts that all five
  line kinds appear (select success; listen success, cancel and fail;
  focus_check fail). The fast D4 still covers every line kind and all 17 menu
  rows from the fast cases.

## Decision

D3 and A9 move, verbatim, to `tests/use-menu-events-logging.slow.test.ts` and
`tests/use-menu-events-subscription.slow.test.ts`, alongside `D4 (slow)`. They
run in the slow lane (`pnpm test:slow`, tdd-guardian `slow`, push and manual)
under ADR-0050's mechanics. The fast files keep a comment where each property
was, pointing at its sibling.

## Consequences

- **D4's every-line check is now split across two lanes.** A per-commit run
  checks the shape of the fast cases' lines only. A change that breaks only
  the lines D3's random sequences reach is caught at push, not at commit.
- **Cost removed per commit:** the two fast files went from about 11.8 s wall
  (D3 9.0 s, A9 10.0 s in a plain run) to 1.4 s. The slow lane gains about
  9.8 s wall: D3 8.06 s, A9 8.82 s and D4 (slow) 13 ms.
- **The test count grows by one** (`D4 (slow)`): 86 before, 84 fast plus 3
  slow after.
- **The shared harness is now a dependency of four files.** A change to the
  fake bus or log capture has to keep both the fast and the slow suites green.
