## Parent

#700 (MIG-003 row). Spec: #752 (r1). Decisions MIG003-r1-D4, D5, D15, D17, D22.

## What to build

A native advisory workflow that compiles, lints and tests the Rust backend on macOS and Windows, nightly on master and on dispatch, and is never on a PR.

- **`platform-advisory.yml`**, in `rust-audit-daily.yml`'s shape: `schedule` `37 3 * * *` and `workflow_dispatch` with no inputs; no `pull_request` or `push`; `permissions: contents: read`; `concurrency` per ref, never cancelling.
- **Matrix** `macos-latest`, `windows-latest`; `fail-fast: false`; `timeout-minutes: 45`.
- **Steps**: the toolchain with clippy; a sidecar stub for the runner's target triple, as `rust-test` does; `cargo check --all-targets`; `cargo clippy --all-targets -- -D warnings`; `cargo test` with its output tee'd and passed to the vacuous checker.
- **Cache**: `Swatinem/rust-cache`, key `platform-advisory-<os>`, saved only on a `schedule` run on master.
- **Vacuous checker**: a Node CLI, a file in and an exit code out; non-zero when no `test result:` line appears or the tests run total zero.
- **First cycle**: dispatch the lane on the ticket's base. If clippy or a test is red on existing code, stop for the delegator with the list; the fix is its own issue and the lane is never weakened.
- **Live runs**: a `ci-fault/platform` branch with a deliberately failing `cargo test`, which the delegator dispatches (expected red); and a green dispatch at the handoff SHA.

## Acceptance criteria

- [ ] A workflow test pins the triggers (exactly `schedule` and `workflow_dispatch`), `contents: read`, the concurrency group and `cancel-in-progress: false`, the matrix, `fail-fast: false`, and the clippy `-D warnings` step.
- [ ] A workflow test shows the cache save runs only for `schedule` on `refs/heads/master`.
- [ ] The checker's cases: a passing summary (exit 0); zero tests in total (non-zero); no `test result:` line (non-zero); a missing or empty file (non-zero); several crates' summaries summed.
- [ ] The base-run result is in the handoff: green on both OSes, or the stop with the list of existing findings.
- [ ] The confirm record holds the platform fault run id (red on the failing test's OS) and a green run whose `head_sha` is the handoff SHA.
- [ ] `ci.yml` is unchanged.
- [ ] Size: about 60 counted production lines (the workflow is not counted).

## Blocked by

- #753 (MIG-003a)

## Citations (master `ddc60447`)

| Cited | Path and name | Exists | Quoted |
|---|---|---|---|
| shape | `.github/workflows/rust-audit-daily.yml` | yes | "A failure shows only in the Actions tab and GitHub's failed-run email, not on any pull request." |
| sidecar stub | `.github/workflows/ci.yml`, step "Create sidecar stub for build.rs" | yes | `touch src-tauri/binaries/mdpro_mcp-aarch64-apple-darwin` |
| off the PR run | `.agents/skills/mdpro-delegator/references/landing-and-audit.md` § PR CI | yes | "the native platform lanes and the real-WebKit lane, which run on `schedule` and `workflow_dispatch` only (MIG-003)." |
| Windows precedent | `.github/workflows/build-windows.yml` | yes | `shared-key: "windows-release" # share cache across branches` |
