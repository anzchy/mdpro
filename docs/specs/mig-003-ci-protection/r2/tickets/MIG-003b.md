## Parent

#700 (MIG-003 row). Spec: #752 (r2). Decisions MIG003-r1-D4, D5, D15, D17, D22; MIG003-r2-D25, D27; r2 fixes MH1, MM2, MM3, MM4.

## What to build

A native advisory workflow that compiles, lints and tests the Rust backend on macOS and Windows, nightly on master and on dispatch, never on a PR. It lands on static evidence; its first runs are the delegator's bootstrap after landing.

- **`platform-advisory.yml`**, in `rust-audit-daily.yml`'s shape: `schedule` `37 3 * * *` and `workflow_dispatch` with no inputs; no `pull_request` or `push`, temporary or otherwise; `permissions: contents: read`; `concurrency` per ref, never cancelling.
- **Matrix** `macos-latest`, `windows-latest`; `fail-fast: false`; `timeout-minutes: 60`.
- **Steps**: the stable toolchain with the clippy component; a sidecar stub for the runner's target triple, as `rust-test` does; `cargo check --all-targets`; `cargo clippy --all-targets -- -D warnings`; `cargo test` piped through `tee` to a file in a step with `shell: bash` on both OSes (so `-eo pipefail` keeps `cargo test`'s exit); then the checker on that file.
- **Cache**: `Swatinem/rust-cache`, key `platform-advisory-<os>`, saved only on a `schedule` run on `refs/heads/master`.
- **Checker**: a Node CLI, a file in and an exit code out; non-zero when no `test result:` line appears, when any `test result:` line says `FAILED`, or when the tests run total zero.
- **Fault branch**: a local `ci-fault/platform` branch on top of the ticket, one `DO NOT MERGE` commit adding one deliberately failing Rust test on one named OS (`#[cfg(target_os = …)]`). The handoff names its SHA and the test's name.
- **Bootstrap (delegator, after the fast-forward; spec § Bootstrap)**: dispatch on master and on the pushed `ci-fault/platform`; record each run's id, `head_sha`, conclusion and, for a red, the decisive line. The master run is the first clippy run on both OSes. A red master run → a follow-up issue with an owner and a target date; the workflow stays enabled; `-D warnings` is never narrowed without the user's approval; the native mapping of the handoff rule activates only after the first green master run.

## Acceptance criteria

- [ ] A workflow test pins the triggers (exactly `schedule` and `workflow_dispatch`, no inputs), `contents: read`, the concurrency group and `cancel-in-progress: false`, the matrix, `fail-fast: false`, `timeout-minutes: 60`, the clippy component, the `-D warnings` clippy step, and `shell: bash` on the step that pipes `cargo test`.
- [ ] A workflow test shows the cache save runs only for `schedule` on `refs/heads/master`.
- [ ] The checker's cases: a passing summary (exit 0); `test result: FAILED. 3 passed; 1 failed` (non-zero); a passing and a `FAILED` crate summary together (non-zero); zero tests in total (non-zero); no `test result:` line (non-zero); a missing or empty file (non-zero); several passing crates' summaries summed.
- [ ] The handoff names the `ci-fault/platform` SHA, the failing test's name and its OS.
- [ ] No existing test is edited; any existing test this change turns red stops the ticket for the delegator. `ci.yml` is unchanged.
- [ ] The landing record (delegator) holds the bootstrap runs: the platform fault run red on its OS with the quoted line `test <name> ... FAILED`, and the master run's id, `head_sha` and conclusion; for a red master run, the follow-up issue number, owner and target date.
- [ ] Size: about 60 counted production lines (the workflow is not counted).

## Blocked by

- #753 (MIG-003a)

## Citations (master `93c7e9bb`)

| Cited | Path and name | Exists | Quoted |
|---|---|---|---|
| shape | `.github/workflows/rust-audit-daily.yml:6–7` | yes | "A failure shows only in the Actions tab and GitHub's failed-run email, not on any pull request." |
| workflow pin precedent | `tests/tooling/rust-audit-daily-workflow.test.ts` › "runs on a daily cron and by manual dispatch, never on PRs or pushes" | yes | test title |
| sidecar stub | `.github/workflows/ci.yml`, step "Create sidecar stub for build.rs" | yes | `touch src-tauri/binaries/mdpro_mcp-aarch64-apple-darwin` |
| off the PR run | `.agents/skills/mdpro-delegator/references/landing-and-audit.md` § PR CI | yes | "the native platform lanes and the real-WebKit lane, which run on `schedule` and `workflow_dispatch` only (MIG-003)." |
| dispatch needs default branch | GitHub Docs, "Events that trigger workflows" › `workflow_dispatch` | external | "This event will only trigger a workflow run if the workflow file exists on the default branch." |
