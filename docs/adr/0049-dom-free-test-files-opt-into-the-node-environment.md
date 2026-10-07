# 0049. DOM-free test files opt into the node environment

**Status**: Accepted (2026-10-07, user decision). Proposed 2026-10-07.

## Context

Every Vitest file ran under jsdom (`vitest.config.ts` `environment: "jsdom"`),
and `tests/setup.ts` loaded `@testing-library/react` and `jest-dom` into every
file. Most of the suite does not need either: parsers, stores, services behind
mocked `invoke()`, and source-text scans of `src/`. On 2026-10-07 (HEAD
`54347a3`, coverage run, 321 files / 4439 tests), the summed per-file
`environment` time was 77.6 s and `setup` 33.7 s, out of a 117.2 s wall run.

The forces:

- **jsdom per file is the largest fixed cost** a file pays, and it is paid
  whether or not the file touches the DOM.
- **A file run without a DOM can pass vacuously.** Node 22 has its own
  `navigator` (`platform` is `"darwin"`, so `/Mac/i.test(navigator.platform)` is
  silently false), and `typeof window === "undefined" ? a : b` never throws: it
  quietly takes the branch the app never runs. A plain `ReferenceError` covers
  only the loud cases.
- Vitest 3 deprecates `environmentMatchGlobs`; the supported per-file switch is
  the `// @vitest-environment node` docblock.

## Decision

jsdom stays the default. A file that is DOM-free opts into node with
`// @vitest-environment node` on its first line.

- `tests/setup.ts` checks for `document` once. Under jsdom it registers
  Testing Library cleanup and `jest-dom` as before. Under node it skips both and
  installs `tests/helpers/nodeEnvironmentGuard.ts`.
- The guard turns 21 browser globals (`window`, `document`, `navigator`,
  `localStorage`, `matchMedia`, `requestAnimationFrame`, …) into accessors.
  A read whose **immediate caller** is first-party (`src/` or `tests/`, not
  `node_modules`) is recorded and thrown. Any other caller gets the original
  value. An `afterAll` fails the file if anything was recorded, so a throw that
  the code under test swallows still fails. `vi.stubGlobal` replaces the
  accessor, so an explicit stub still works.
- The marker went only on files that passed unchanged under node **with the
  guard on**: 143 converted plus the guard's own test, 144 of 321. Two more that
  passed were left on jsdom: `imagePastePlugin` (real `prosemirror-view`) and
  `milkdown-timer-drain` (an unhandled `addEventListener` error). No assertion
  was edited to make a file pass.
- Guard evidence: `tests/node-environment-guard.test.ts` is RED with the install
  call removed (2 pass / 4 fail) and GREEN with it (6 / 6).

Measured on the same machine with coverage on, the same 4439 tests ran and all
passed. The baseline's 6 failures were the guard test before the guard was wired
in, plus 2 in the pre-existing flaky `dev-toolbar-visibility`. Coverage stayed at 73.96 / 91.42 / 80.97 / 73.96. Summed environment time went
from 77.6 s to 36.4 s, summed setup from 33.7 s to 16.5 s, and wall time from
117.2 s to 99.8 s.

## Consequences

- About 40 s of per-file environment and setup CPU is gone from every unit
  run, and wall time drops by about 15%. The size of the wall-time gain depends
  on machine load; under contention it is smaller.
- **Two environments to reason about.** A node file sees no
  `@testing-library/jest-dom` matchers and no `cleanup`. A file that later
  needs the DOM must have its marker deleted. The guard says so in its error,
  but the author still has to act on it.
- **The guard sees only the immediate caller.** A library that reads
  `navigator` on behalf of first-party code gets Node's real value without
  complaint. That is deliberate, so React and zustand can probe their
  environment, but it means a vacuous pass routed through a dependency is
  still possible.
- The guard rewrites `globalThis` descriptors for the life of the file. A test
  that inspects those descriptors directly would see accessors.
- New test files default to jsdom, so the speed-up only grows if authors opt in
  deliberately. Rule `.claude/rules/10-tdd.md` says when to.
