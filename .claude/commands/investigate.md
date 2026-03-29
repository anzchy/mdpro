---
description: Root cause analysis before any fix — Iron Law debugging
argument-hint: "[symptom or error description]"
---

# Investigate

## Context

```text
$ARGUMENTS
```

## Iron Law

**NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST.**

Symptoms are not bugs. Crashes are not root causes. Never modify code until you have a testable hypothesis that explains *why* the failure occurs.

---

## Phase 1 — Gather Symptoms

- Read the relevant source files. Trace the call chain from the reported symptom back to its origin.
- Collect all available evidence: error messages, log entries (`tail -f ~/.mdpro/mdpro.log | jq .`), test output, and user-reported steps to reproduce.
- State the symptom precisely: what happened, what was expected, when it first appeared.

## Phase 2 — Scope Lock

- Identify the single module or file boundary most likely containing the root cause.
- Restrict investigation to that scope. Do not read or modify unrelated files.
- If the scope is unclear, start at the outermost boundary (the IPC command or the React component) and trace inward.

## Phase 3 — Pattern Match

Check the symptom against known failure patterns:

| Pattern | Signals |
|---------|---------|
| Race condition | Works sometimes, fails on fast repeat, timing-sensitive |
| Stale closure | Event handler reads outdated state, Tauri `listen()` captures old values |
| Nil/undefined propagation | Works until a specific document state, optional chaining hides the source |
| State mutation | Zustand store value changes unexpectedly, useEffect fires incorrectly |
| IPC contract mismatch | Rust returns `Ok(T)` but TS expects different shape, or command not registered |
| File watcher false positive | `file:changed` fires spuriously on save (debounce issue) |
| Config drift | Works in dev (`pnpm tauri dev`) but fails in prod build |
| Encoding error | Non-UTF-8 file corrupts content on open/save |

## Phase 4 — Form and Test a Hypothesis

1. State the hypothesis as a falsifiable claim: *"The bug occurs because X causes Y under condition Z."*
2. Find evidence that confirms or refutes it (logs, grep for the code path, add a temporary assertion).
3. If the hypothesis is refuted, form a new one.

**3-Strike Rule:** After three failed hypotheses, stop. Do not guess further. Report what you found and ask for guidance — more context is needed.

## Phase 5 — Fix + Verify

Once the root cause is confirmed:

1. **Write a regression test first** (RED) — a test that fails *without* the fix and passes *with* it. Follow the pattern catalog in `.claude/rules/10-tdd.md`.
2. **Fix the root cause**, not the symptom. If the surrounding code is fragile, note it but do not refactor it in the same commit.
3. **Verify the original symptom is gone** — reproduce the original steps, confirm the fix resolves them.
4. **Run all gates** — `pnpm build && pnpm test:run`. If Rust changed: `cargo check --manifest-path src-tauri/Cargo.toml && cargo test`.

## Blast Radius Rule

If the fix touches more than 5 files, pause and report:
- What changed and why
- Which files are affected and why each one is necessary
- Whether a narrower fix is possible

Ask before proceeding.

## Output

Report:
1. **Root cause** — the specific line/condition causing the failure
2. **Hypothesis trail** — what you ruled out and why
3. **Fix applied** — what changed and why it addresses the root cause
4. **Regression test** — location and what it proves
5. **Verification result** — gates output, before/after behavior
