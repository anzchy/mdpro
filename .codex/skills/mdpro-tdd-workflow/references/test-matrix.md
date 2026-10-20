# Step 2: the test matrix

Ported from tdd-guardian's `test-designer` and `test-matrix`, plus rule 71's case list. Write the
result to `~/.mdpro-redesign/herdr-spike/<you>/<item>-test-matrix.md`. This step creates no test or
source file.

## The law question, once per unit

Before writing cases for a unit (a function, store action, hook or service path), answer: does it
have a law? See `policy.md`. If it does, at least one case is S4–S6 and covers that law. If it
doesn't, write `Law: none: <why>`.

## Case categories (every AC, every unit)

1. **Success.**
2. **Boundary**: empty, one, max, CJK and other non-ASCII text, CRLF, the 10 MB limit.
3. **Invalid input and guards**: a wrong shape, a missing value, an unauthorized or stale caller.
4. **Failure paths**: the IPC rejects, a write fails, the preferences read throws. Assert what the
   user sees and that no dirty content is lost.
5. **Lifecycle and timing**, the category that produced every blocking High on 2026-10-20:
   - close, reopen, switch or replace the document **during an `await`**;
   - a stale token or generation;
   - a queued or batched operation (does each item re-check its guard?);
   - a second event arriving mid-way (a newer external change, a second save);
   - an answer to an older dialog arriving after a newer event.
6. **Every caller or entry path** that reaches the changed behaviour: menu, shortcut, toolbar, MCP
   event, relaunch or quit batch, autosave, Save As. List them with `rg`, and cover each one, or
   state why it can't reach the change.
7. **Platform**, where it applies: macOS against Windows key labels, paths and line endings.
8. **Properties and invariants** (S4–S6), wherever there's a law.
9. **What must not change**: the existing tests the brief protects, named by file. Their assertions
   stay as they are.

## Per-case fields (all required)

```markdown
### Case <n>: <name>   [AC-x]
- Category: success | boundary | guard | failure | lifecycle | entry-path | platform | property | unchanged
- Spec level: S1–S6, and why that level
- Input / sequence: concrete values, or the exact event order for timing cases
- Expected: the exact result, error or relation
- Observable effect: document content, store state, IPC call count and arguments at the boundary, toast or dialog text, log event (enum fields only), or "none"
- Assertion: Level 1–5, and the expect() you will write
- Mock boundary: what's mocked and why, or "none"
- Test file: tests/... (placement per rule 10), new or extended
- Receipt: <ITEM>-WI-n
- Refactor that would break it: if the answer is "renaming an internal", redesign the case
```

## Self-check before Step 3

- **Hard-coded return.** For each unit: if the body were replaced with `return <expected>`, would
  every case still pass? If so, add a boundary, failure or property case.
- **Lifecycle coverage.** For every `await` on the changed path, is there a case that changes the
  world during it?
- **Entry paths.** For every entry path found in category 6, is there a case, or a stated reason
  there isn't?
- **Every AC** appears in an `AC → cases` table at the end of the matrix.
- **The Deferred section** exists, even if it says "none".
