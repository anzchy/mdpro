---
description: Fix a reported bug at its root cause, test-first, with a regression test and every gate green
argument-hint: "[issue description or error message]"
---

# Fix

## Context

```text
$ARGUMENTS
```

## If no issue was given

If `$ARGUMENTS` is empty or only whitespace, stop and ask for the issue: the error text, the failing test, or the
steps that reproduce it (an implementor asks through the delegator). Do not guess a target from `git status`, recent
commits or the log.

## Fixing Philosophy

**No half measures.** Every fix must be complete and correct.

### Principles

1. **Understand before fixing** — Read the code, trace the flow, identify root cause
2. **Fix the cause, not the symptom** — No band-aids, no workarounds, no "good enough"
3. **Rewrite if necessary** — Bad code deserves replacement, not patching
4. **Test-first** — Write a failing test that captures the bug, then fix, then verify green (see `.claude/rules/10-tdd.md`)
5. **Zero regressions** — Run the gates in step 6 before declaring done
6. **Clean as you go** — If you touch it, leave it better than you found it

### Anti-patterns to Avoid

- Adding flags to bypass broken logic
- Wrapping bad code in try-catch to silence errors
- Commenting out problematic code
- Adding TODO for "later"
- Special-casing edge cases without fixing core issue
- Copy-pasting fixes across similar code

## Process

### 1. Reproduce

- Read the source files on the symptom's call chain, and trace it to the root cause.
- If the issue involves UI behavior, ask the user to reproduce it (an implementor asks through the delegator). Do not
  start a dev server; use Tauri MCP for E2E when available.

### 2. Diagnose

- Find the **root cause**, not just where it crashes.
- Check if similar patterns exist elsewhere — the same bug may lurk in related code.

### 3. Test First (RED)

- Write a failing test that captures the bug.
- Follow the pattern catalog in `.claude/rules/10-tdd.md`:
  - Store bug → store test with `getState()`
  - Plugin bug → minimal schema + `createState()` helper
  - Hook bug → `renderHook` with mocked dependencies
  - Util bug → table-driven `it.each` covering the broken case
- Exception: CSS-only or visual bugs don't need unit tests — use visual QA instead.

### 4. Fix the Root Cause (GREEN)

- Address the root cause. Rewrite when one of the "Rewrite when" conditions below holds.
- Keep the diff minimal and focused — don't refactor unrelated code.
- Follow project conventions:
  - Use `@/` imports for cross-module, relative for same-module
  - No Zustand store destructuring in components
  - Keep files under ~300 lines

### 5. Refactor

- Clean up without changing behavior. Tests must still pass.
- Remove dead code. Update comments if they're now stale.

### 6. Verify

Every heavy command runs through `scripts/heavy-lock.sh` (rule 10). All of these must pass; the only exception is a gate
that fails on code the fix did not touch (see "If a step fails"), and then the fix is blocked, not done:

- The focused run while you work: `VITEST_MAX_WORKERS=2 scripts/heavy-lock.sh --guard-only pnpm exec vitest run tests/<files>`.
- Once before the commit, the full unit lane with coverage, which checks the coverage thresholds:
  `scripts/heavy-lock.sh pnpm exec vitest run --coverage`.
- Typecheck and build: `scripts/heavy-lock.sh sh -c 'pnpm -s typecheck:tests && pnpm -s build'`.
- If Rust code was changed, also run `scripts/heavy-lock.sh cargo check --manifest-path src-tauri/Cargo.toml`, then
  `scripts/heavy-lock.sh node scripts/cargo-test-lane.mjs cargo test --manifest-path src-tauri/Cargo.toml`.
- If user-facing behavior changed, update CHANGELOG.md.

### When to Rewrite vs Patch

**Rewrite when:**
- The existing code is fundamentally flawed
- Patching would add complexity
- The fix requires understanding fragile logic
- Similar bugs have occurred in this code before

**Patch only when:**
- The code is sound but has a small oversight
- The fix is isolated and obvious
- Rewriting would introduce unnecessary risk

## If a step fails

- **The bug cannot be reproduced:** stop and ask for more detail (an implementor asks through the delegator). Do not
  fix a guess.
- **A gate fails on code the fix did not touch:** report the fix as **blocked, not done**, with the command and its
  failing output, and do not fix it here.
- **The fix touches more than 5 files:** pause and report what changed, why each file is needed, and whether a
  narrower fix is possible, as `/investigate`'s Blast Radius Rule does. Ask before going on (an implementor asks
  through the delegator).

## Output

Report:
1. **Root cause** — the file:line and the condition that triggers the failure
2. **Fix** — what changed and why it removes the root cause
3. **Regression test** — its path and name, and its RED output before the fix; or, for a CSS-only or visual fix, the
   visual QA evidence instead
4. **Gates** — each command run in step 6 and its result
5. **Rewrite or patch** — which one, and the criterion from "When to Rewrite vs Patch" that decided it
