## Parent

#700 (MIG-003 row). Spec: #752 (r3). Decisions MIG003-r1-D4, D5, D15, D17, D22; MIG003-r2-D25, D27; MIG003-r3-D29; r2 fixes MH1, MM2, MM3, MM4; r3 fixes H1, O-M1, O-M3, Low 2.

## What to build

A native advisory workflow that compiles, lints and tests the Rust backend on macOS and Windows, nightly on master and on dispatch, never on a PR. It lands on static evidence; its first runs are the delegator's bootstrap after landing.

- **`platform-advisory.yml`**, in `rust-audit-daily.yml`'s shape: `schedule` `37 3 * * *` and `workflow_dispatch` with no inputs; no `pull_request` or `push`, temporary or otherwise; `permissions: contents: read`; `concurrency` per ref, never cancelling.
- **Matrix** `macos-latest`, `windows-latest`; `fail-fast: false`; `timeout-minutes: 60`.
- **Steps**: the stable toolchain with the clippy component; a sidecar stub for the runner's target triple, as `rust-test` does, in a step with `shell: bash` (Windows defaults to pwsh, which has no `touch`); `cargo check --all-targets`; `cargo clippy --all-targets -- -D warnings`; `cargo test` piped through `tee` to a file in a step with `shell: bash` on both OSes (so `-eo pipefail` keeps `cargo test`'s exit); then the checker on that file.
- **Cache**: `Swatinem/rust-cache` (step id `rust-cache`), key `platform-advisory-<os>`, saved only on a `schedule` run on `refs/heads/master`.
- **Warm-cache marker** (MIG003-r3-D29): right after the cache step, a no-op step named exactly `rust-cache hit`, with `if: steps.rust-cache.outputs.cache-hit == 'true'`. Its jobs-API conclusion (`success` warm, `skipped` cold) is the source of MIG-003d's warm-cache filter.
- **Checker**: a Node CLI, a file in and an exit code out; non-zero when no `test result:` line appears, when any `test result:` line says `FAILED`, or when the tests run total zero.
- **Fault branch**: a local `ci-fault/platform` branch on top of the ticket, one `DO NOT MERGE` commit adding one deliberately failing Rust test on one named OS (`#[cfg(target_os = …)]`). The handoff names its SHA and the test's name.
- **Bootstrap (delegator, after the fast-forward; spec § Bootstrap)**: dispatch on master and on the pushed `ci-fault/platform`; record each run's id, `head_sha`, conclusion and, for a red, the decisive line. The master run is the first clippy run on both OSes. The fault run counts only once its OS's master run is green through clippy; until then it waits on the follow-up issue (spec § Bootstrap). A red master run → a follow-up issue with an owner and a target date; the workflow stays enabled; `-D warnings` is never narrowed without the user's approval; the native mapping of the handoff rule activates only after the first green master run.

## Acceptance criteria

- [ ] A workflow test pins the triggers (exactly `schedule` and `workflow_dispatch`, no inputs), `contents: read`, the concurrency group and `cancel-in-progress: false`, the matrix, `fail-fast: false`, `timeout-minutes: 60`, the clippy component, the `-D warnings` clippy step, and `shell: bash` on the step that pipes `cargo test` and on the sidecar-stub step.
- [ ] A workflow test shows the cache save runs only for `schedule` on `refs/heads/master`.
- [ ] A workflow test pins the warm-cache marker: a step named exactly `rust-cache hit`, directly after the step with id `rust-cache`, whose `if` is `steps.rust-cache.outputs.cache-hit == 'true'`; a mutation-RED case shows the test fails when the step is renamed, its `if` changes or the cache step's id changes.
- [ ] The checker's cases: a passing summary (exit 0); `test result: FAILED. 3 passed; 1 failed` (non-zero); a passing and a `FAILED` crate summary together (non-zero); zero tests in total (non-zero); no `test result:` line (non-zero); a missing or empty file (non-zero); several passing crates' summaries summed.
- [ ] The handoff names the `ci-fault/platform` SHA, the failing test's name and its OS.
- [ ] No existing test is edited; any existing test this change turns red stops the ticket for the delegator. `ci.yml` is unchanged.
- [ ] Size: about 60 counted production lines (the workflow is not counted).

## Post-landing obligations (delegator; not part of this ticket's acceptance verdict)

The handoff's self-acceptance table, the brief's AC map, the verifier, both auditors' `AC` lines and the ADR-0146 decision 4 pre-audit check do not list these (spec § Bootstrap). The issue closes only when they are recorded.

- [ ] The landing record (delegator) holds the bootstrap runs: the platform fault run red on its OS with the quoted line `test <name> ... FAILED`, and the master run's id, `head_sha` and conclusion; for a red master run, the follow-up issue number, owner and target date.
- [ ] If that OS's master run is not green through clippy, the landing record marks the fault run `waiting on #<n>` (the follow-up issue), and the delegator re-dispatches and records it after #<n> lands.

## Blocked by

- #753 (MIG-003a)

## Citations (master `4dac35fb`)

| Cited | Path and name | Exists | Quoted |
|---|---|---|---|
| shape | `.github/workflows/rust-audit-daily.yml:6–7` | yes | "A failure shows only in the Actions tab and GitHub's failed-run email, not on any pull request." |
| workflow pin precedent | `tests/tooling/rust-audit-daily-workflow.test.ts` › "runs on a daily cron and by manual dispatch, never on PRs or pushes" | yes | test title |
| sidecar stub | `.github/workflows/ci.yml`, step "Create sidecar stub for build.rs" | yes | `touch src-tauri/binaries/mdpro_mcp-aarch64-apple-darwin` |
| off the PR run | `.agents/skills/mdpro-delegator/references/landing-and-audit.md` § PR CI | yes | "the native platform lanes and the real-WebKit lane, which run on `schedule` and `workflow_dispatch` only (MIG-003)." |
| dispatch needs default branch | GitHub Docs, "Events that trigger workflows" › `workflow_dispatch` | external | "This event will only trigger a workflow run if the workflow file exists on the default branch." |
| cache-hit output | `Swatinem/rust-cache` README › Outputs | external | "`cache-hit`" (a boolean, true on an exact key match) |
