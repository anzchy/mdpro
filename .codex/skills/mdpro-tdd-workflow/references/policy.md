# Test-quality policy

Ported from tdd-guardian's `policy-core`, plus mdpro's rule 10. Every step applies it. The
adversary and the reviewer subagents judge against it too.

## Test behaviour, not wiring

A test checks what the code **does**: its output, its side effect, or the state it leaves. It
doesn't check which internals were called. If you can break the behaviour while the test still
passes, the test is worthless.

### Assertion levels (prefer high, justify low)

| Level | Assertion | mdpro example | Quality |
|---|---|---|---|
| 1 | Output | `expect(parseTable(md)).toEqual({...})` | best |
| 2 | Side effect | `save_file` IPC count and arguments seen at the Tauri mock boundary; the file bytes in a tmpdir | best |
| 3 | Real integration | the real store, hook and service together, with Tauri mocked only at `@tauri-apps/api` | best |
| 4 | State | `useDocumentStore.getState().documents[id].isDirty === true` | good |
| 5 | Mock return plus output | the boundary mock returns data, and you assert what the caller makes of it | good |
| 6 | Mock call arguments | `expect(invoke).toHaveBeenCalledWith(...)` | weak, never alone |
| 7 | Mock was called | `toHaveBeenCalled()` | unacceptable alone |

Every test has at least one Level 1–5 assertion.

### Specification strength (how much of the input space a case claims)

| Level | Claim |
|---|---|
| S1 | one example |
| S2 | boundary or equivalence class: empty, one, max, CJK, CRLF, a 10 MB file |
| S3 | a named failure mode: the error type and the message the user sees |
| S4 | a property over a generated domain (`fast-check`) |
| S5 | an invariant across state transitions: round-trip, idempotence, conservation, "no write before consent" |
| S6 | a metamorphic relation |

**A unit with a law needs an S4–S6 case.** A law is a conserved quantity, a round-trip, an
idempotent operation, an ordering, a monotonic relation, or a stated invariant. mdpro examples:
- markdown round-trip: `serialize(parse(x)) == x`;
- a save writes at most once per consent;
- a stale token never mutates the document;
- dirty content is never discarded without a prompt.

A unit with no law says so in the matrix: `Law: none: <why>`.

## Mock rules

- **Mock only at boundaries**: Tauri (`@tauri-apps/api/core` and `/event`), the network, the file
  system, timers and `Date.now`, randomness. Never mock your own stores, services, utils or plugins
  (rule 10).
- **A mock call assertion supplements a behaviour assertion; it never replaces one.**
- **Prefer real objects**: the real Zustand store reset with `setState` in `beforeEach`, the real
  parser, real ProseMirror state for plugin logic, `renderHook` for hooks, and `userEvent` with
  ARIA queries for components.
- **No snapshot tests for logic.**
- **Don't restructure production code just to make it mockable.**

## The specification doesn't move

- Adding cases while implementing is fine.
- **Editing or deleting an assertion that existed at RED is a separation break.** If a recorded
  assertion is truly wrong, stop and state why; never relax it quietly.
- The receipt proves the order: a RED is recorded before the production change it tests.

## Coverage ignores

Only `/* v8 ignore start */` … `/* v8 ignore stop */`. `/* v8 ignore next N */` miscounts on `??`,
ternaries and catch bodies. Every ignore needs a one-line reason, and an ignore in a changed file is
a review finding.

## mdpro specifics (rule 10)

- **Test placement.** Frontend tests go under `tests/`. A test under `src/` never runs. The folder
  is chosen by the system under test:
  - `tests/control/`: the launcher or `scripts/control`;
  - `tests/tooling/`: repo tooling, importing nothing from `src/`;
  - `tests/perf/`: `*.perf.ts` files;
  - `tests/`: everything else.
- **Environment.** A DOM-free file starts with `// @vitest-environment node`. A test that takes 2 s
  or more under coverage goes in a `*.slow.test.ts` sibling.
- **Rust.** Rust tests sit next to their module. Run `cargo fmt` before recording a Rust RED, and
  never between record and verify.
- **A bug fix needs a regression test** that fails without the fix.

## What a test costs

Tests buy a lower cost of future change. These are findings too:
- a no-behaviour refactor that edits many assertions;
- an interface with one implementation and one double;
- more mocks than the unit has collaborators;
- a test that breaks when a private function is renamed.
