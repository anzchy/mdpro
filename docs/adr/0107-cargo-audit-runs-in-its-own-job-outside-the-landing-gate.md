# 0107. `cargo audit` runs in its own job, outside the landing gate, daily on master, with accepted advisories listed in `audit.toml`

**Status**: Accepted (2026-10-15). Decided by the user, relayed by
mdpro-delegator: after an explanation of why `rust-audit` does not block a PR
but does block a tag, the user chose 「Accept + daily schedule (Recommended)」.
Drafted by mdpro-a6 for D237; the delegator reserved the number and set the
terms (rust-audit outside `ci-gate`'s `needs`; ADR-0095's body is not edited).
Partially supersedes [ADR-0095](0095-pull-request-ci-is-a-landing-gate.md),
Decision 1, the clause "The `rust-test` job runs `cargo test` and
`cargo audit`". ADR-0095's other decisions stand.

## Context

- **PR CI never showed the audit.** ADR-0095 put `cargo audit` in `rust-test`,
  and `ci.yml` marked that step `continue-on-error` on `pull_request`. A failing
  audit left every PR green. On a tag or manual run the step was blocking, so
  the result appeared only there. On 2026-10-15 a manual run on `77d5f2d`
  (run 38706042076) found 15 vulnerabilities, and the next `v*` tag build
  would have failed `rust-test` (D237).
- **An advisory is not about the diff.** RustSec publishes against the lockfile
  at any time. A PR that touches CSS goes red the day an advisory lands for a
  crate it never touched. If the audit is a required check, every landing
  waits on an unrelated dependency fix. If its failure is swallowed, nobody
  sees it.
- **Some advisories cannot be fixed by a semver update and do not reach
  mdpro.** mdpro-codex-audit's read-only triage
  (`~/.mdpro-redesign/prep/d237-cargo-audit-triage.md`) found that none of the
  15 was reachable with attacker input as shipped. Fourteen had semver fixes.
  rmcp's RUSTSEC-2026-0189 needs a major bump to ≥ 1.4, and it sits in a
  transport feature mdpro does not compile.

## Options considered

- **A. Keep it in `rust-test`, blocking everywhere.** Lost: every PR blocks
  on advisories unrelated to its change, including prose-adjacent ones.
- **B. Keep it in `rust-test`, `continue-on-error` on PRs** (ADR-0095 as
  shipped). Lost: the failure is invisible on the only runs anyone reads, and
  that is how D237 accumulated 15 advisories.
- **C. A separate `rust-audit` job, outside `ci-gate`'s `needs`, never
  `continue-on-error`.** Chosen.
- **D. Make `ci-gate` require `rust-audit` only on tag and manual runs.**
  Not chosen: it puts an event condition into the one required check's
  logic, and a failed `rust-audit` job already fails a tag or manual run.
- For the time between a release tag and the next, a **daily scheduled
  run** (chosen, by the user) or **none**. With no schedule, ci.yml runs only
  for PRs, tags and manual dispatch, so an advisory published after the last
  PR is first seen at the tag build. The schedule goes in a separate small
  workflow, not a `schedule` trigger on ci.yml, which would need every other
  job gated off for scheduled runs.
- **E. Drop the audit from CI and run it by hand before a release.** Lost:
  a manual step is the one skipped under release pressure.
- For the unfixable rmcp advisory: **ignore it in `audit.toml` with its
  reason** (chosen), or **bump rmcp to 1.x now** (lost: a major-version MCP
  change inside a release-blocking lockfile fix; it becomes a follow-up).

## Decision

1. **`cargo audit` moves out of `rust-test` into a `rust-audit` job.** It
   needs `scope` and runs only when `scope` says `code=true`, like the other
   heavy jobs, which on a tag or manual run is always. It runs `cargo audit`
   from `src-tauri/` with no `continue-on-error`.
2. **`ci-gate` does not need `rust-audit`.** On a PR an advisory shows as a
   red `rust-audit` check and the landing is not blocked. On a `v*` tag or a
   manual run, the failed job turns the run red.
3. **A daily run on master.** `.github/workflows/rust-audit-daily.yml`
   runs the same `cargo audit` on a daily cron (and by manual dispatch),
   as its only job. ci.yml keeps no `schedule` trigger.
4. **Accepted advisories live in `src-tauri/.cargo/audit.toml`**, each with
   its advisory id, the reason it does not reach mdpro, and what removes it.
   The first and only entry is RUSTSEC-2026-0189, until the rmcp ≥ 1.4 bump.
   `tests/tooling/ci-workflow-gate.test.ts` pins the list, so adding an
   ignore is a reviewed test change, and
   `tests/tooling/rust-audit-daily-workflow.test.ts` pins the daily workflow.

## Consequences

- **A red check on a PR can be ignored.** The landing condition is
  `ci-gate`, so a red `rust-audit` does not stop the delegator. The
  advisory is caught when someone reads the check, or at the tag build at
  the latest, which then needs a fix before the release goes out.
- **A daily failure is easy to miss.** It shows only in the Actions tab and
  in GitHub's failed-run email to whoever last edited the schedule, never on
  a PR, and it repeats every day until fixed. Someone has to read it; the
  tag build is still the backstop.
- **The audit steps exist twice**, in ci.yml's rust-audit job and in the
  daily workflow. A change to how the audit runs must edit both.
- **A tag build can still fail on an advisory published the same day.**
  That is intended: a release should not ship a fresh advisory unseen. The
  cost is a lockfile fix inside the release window.
- **`audit.toml` can hide a real problem** if an ignore outlives its reason.
  rmcp's ignore holds only while `transport-streamable-http-server` stays off.
  Turning that feature on, or bumping rmcp, must revisit it.
- **One more CI job, and one run a day.** Each installs `cargo-audit` from
  source, about four minutes. On a PR it runs in parallel with the others,
  so a PR's wall-clock time is unchanged. The repo is public, so the hosted
  runner minutes are free.
- **The warnings stay allowed.** cargo-audit reports unmaintained and
  unsound crates (proc-macro-error, anyhow, event-listener, glib, rand) as
  warnings that do not fail the job. This decision does not promote them.
