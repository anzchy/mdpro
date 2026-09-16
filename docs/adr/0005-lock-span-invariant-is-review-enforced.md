# 0005. The preferences lock-span invariant is review-enforced, not test-enforced

## Status

Accepted — 2026-09-16

## Context

`commands/logging.rs#apply_logging_settings` performs a read-modify-write of
`~/.mdpro/config.json`: load every preference, replace the `logging` field, save
the whole struct back. Before this change it held no lock, so a concurrent
`set_preferences` or `save_window_state` could land between the load and the
save and have its write silently discarded. The fix takes
`preferences::preferences_rw_lock()` across the whole sequence, matching the
idiom the sibling writers already use.

The correctness of that fix depends on the guard's **span**, not merely on its
presence. A guard scoped to the load alone —

```rust
let current = { let _lock = preferences_rw_lock().lock()?; load_preferences()? };
```

— still leaves `save_preferences` unlocked and reintroduces the lost update. This
is not a hypothetical shape. All four sibling writers begin lock-then-load, so the
most natural cleanup anyone would attempt on them, extracting a shared
`locked_load()` helper, produces exactly it.

The regression test for the defect (R5, the deterministic interleaving) **cannot
see span**, and says so in its own doc comment. This was confirmed by mutation:
with the guard narrowed to the load, the whole `commands::logging` module stayed
green, 8 passed, 0 failed. The test matrix identified the gap during its adversary
pass, retracted an earlier claim that R5 covered it, and prescribed a bounded
interleaving stress case as the behavioural witness.

That stress case was then written and measured, and it does not work. Forty
rounds, a `Barrier`, a subject calling `apply_logging_settings` against an
interferer performing the locked read-modify-write idiom on a disjoint field:
**0 detections in 10 runs** against the narrowed-guard mutant.

The reason is structural rather than a matter of tuning, which is the load-bearing
fact in this record:

- A *correct* concurrent writer must re-read under the lock before it writes.
  That re-read means it can never complete load→save inside the window between
  the subject's unlock-after-load and the subject's own save — the subject is
  already serialising while the interferer has not finished waking.
- Removing the interferer's re-read (pre-loading its snapshot before the barrier)
  does make the race winnable, but then it models a stale writer by construction
  and goes red against the **fixed** code too. That is worse than no test.
- Widening the window by enlarging `config.json` scales both threads equally, so
  it does not shift the outcome.

Catching a narrowed guard therefore requires a pause point inside the production
function — a `#[cfg(test)]` hook in a registered Tauri command's write path.

## Decision

Do not build the executable witness. The GS-1 invariant — that a single `_lock`
binding dominates the load, the struct update, `save_preferences`, **and**
`logger::set_log_settings`, with no inner block narrowing it — is enforced by
review only.

To make that enforceable by someone who never reads this file, the reasoning is
placed at the guard itself, as a `GS-1 — REVIEW-ENFORCED INVARIANT` comment in
`commands/logging.rs`, naming the forbidden shape, the mutation result, and the
fact that the witness was attempted and measured at 0/10. The test matrix's
prescription of the stress case is retracted in place rather than deleted.

We reject the pause-hook alternative: test-only machinery inside the write path of
a command that persists user preferences buys one invariant at the cost of a
production code path that only exists to be observed, in exactly the function
whose job is not to lose data.

## Consequences

**What this costs, plainly:**

- **A real defect can be reintroduced with the entire suite green.** Narrowing the
  guard is a silent data-loss regression. Nothing automated will catch it. This is
  the single place in the logging-settings change where the safety net has a hole
  that the change itself identified and did not close.
- **The most likely trigger is a well-intentioned refactor**, not carelessness — a
  `locked_load()` extraction across the four sibling writers. The people most
  likely to break it are the people tidying up.
- **Enforcement decays.** A comment is obeyed until someone is in a hurry. Unlike
  `let _lock` versus `let _`, which the compiler enforces via
  `#[deny(let_underscore_lock)]`, nothing here fails loudly.
- **This record is the only durable statement of why there is no test.** Without
  it, the absence reads as an oversight and someone re-attempts the stress case,
  spends the same hours, and reaches the same 0/10.

**What it buys:**

- No test-only branch in a preferences write path.
- No flaky case in CI. The discarded stress case could only ever have been
  flaky-green, but a 40-round threaded loop on every `cargo test` is a standing
  cost for measurably zero detection.
- The gap is named in three places a future editor plausibly reads: the guard
  itself, the test matrix, and this record.

**Revisit this if** a pause hook becomes cheap for an unrelated reason (for
example, if the preferences layer grows a seam for fault injection that is already
justified on its own merits), or if the lost update is ever observed in
production. At that point the trade changes and this decision should be superseded
rather than edited.

**Related:** the frontend half of the same effort fails closed on an unreadable
config; the Rust-side logger cache still fails open (`services/logger.rs`
`unwrap_or_default()`), which is disclosed in `CHANGELOG.md` and is a separate
defect with no ADR of its own yet.
