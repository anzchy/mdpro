# Step 6: review checklist

The `mdpro-tdd-reviewer` subagent applies this. Use it yourself only when the subagent can't be
spawned. Ported from tdd-guardian's `reviewer` and `review-gate`, plus mdpro rule 60. It reports
findings and fixes nothing.

## Order of findings

1. Code findings, by severity, with `file:line`.
2. Test quality: every `expect()` in the changed tests classified as behaviour (Level 1–5) or wiring
   (Level 6–7).
3. Specification strength: a unit with a law but only examples.
4. Change tax: an assertion modified while the behaviour it describes is unchanged.
5. Missing tests: every brief AC and matrix case without a test.
6. Residual risk, in two or three lines.

## Rule 60 critical pass (each one is High when violated)

- IPC input is validated in Rust; a command returns `Result`, never `unwrap` on user data.
- Shared async state is guarded; listeners use `getState()`, not captured values.
- **Data loss**: a save error reaches the user; no dirty content is silently discarded; a draft never
  overwrites newer content; a close with unsaved changes prompts.
- **Silent failure**: a user action (Save, Insert, Confirm) that does nothing, with no toast, dialog
  or log. That was M3b H1 and D290 H3.
- **Lifecycle**: every `await` on a mutating path re-checks document identity, path and token after
  it resumes. Every item of a batch re-checks its guard.
- `match` and union exhaustiveness: no `_ => {}` that drops a case.
- A new `menu:action` has a handler.

## Severity

| Finding | Severity |
|---|---|
| A data-loss path, silent failure, or unguarded await on a mutating path | High |
| A wiring-only test in a changed file | High |
| Every test of a unit passes against a hard-coded return | High |
| A receipt `SEPARATION-BROKEN` without a stated reason | High |
| A brief AC with no test, or a happy path untested | High |
| A unit with a law but no S4–S6 case | Medium |
| A mocked internal module | Medium |
| An error path untested | Medium |
| A file over 300 lines; `console.log`; a stale rule 22 header | Medium |
| Logging that carries a path or content (rule 20 says enum fields only) | Medium |
| A ledger, CHANGELOG or sequencing row not updated with the behaviour | Medium |

## Output

```markdown
# Review — <item>
Verdict: APPROVED | APPROVED WITH NOTES | CHANGES REQUESTED | BLOCKED
## High
### R1 — <title> (`file:line`) — <evidence; the case that would expose it>
## Medium
## Test quality table (file | behaviour expects | wiring expects | verdict)
## Residual risk
COUNT H<n> M<n> L<n>
```

BLOCKED means one or more High findings. CHANGES REQUESTED means Medium findings only.
