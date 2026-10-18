# 0095. Pull-request CI is a landing gate: fast checks on every PR, prose-only PRs skip the heavy jobs, one required summary check

**Status**: Accepted (2026-10-14). Decided by the user, recorded by
mdpro-delegator. The user read a survey of how vmark and large projects run PR
CI, then adopted five practices with 「这些建议采纳，看看是否要提一个adr，然后更改repo相关设置」.
Asked about the two choices this left open, the user answered
「Yes, enforce on GitHub (Recommended)」 (branch protection) and
「Standing force-with-lease (Recommended)」 (re-pushing a rebased head).
Partially superseded (2026-10-18) by [ADR-0121](0121-audit-effort-follows-risk-pre-existing-findings-do-not-block-and-auditors-are-measured.md): Decision 5's "zero Critical and zero High"
means zero blocking findings.
Settles Decision 4 of [ADR-0092](0092-every-landing-has-a-pull-request-as-its-record-and-lands-by-fast-forward.md),
which was still open: CI is blocking, not just reported. Adds one landing
condition to [ADR-0085](0085-a-branch-is-audited-before-it-is-fast-forwarded-onto-master.md)'s
gate and leaves its other conditions unchanged. Adds one standing exception to rule 25.

## Context

- **PR CI was advisory.** `ci.yml` ran on every PR, but `master` required no
  check, and the delegator lands by a local `git merge --ff-only` that GitHub
  can't gate. During the ADR-0092 pilot, CI was red on #417, #418 and #423
  (the D193 causes), and nothing depended on it.
- **CI tested stale heads.** Implementors can't push (rule 70), so after a
  rebase the PR still pointed at the pre-rebase commit. On 2026-10-14 #425's
  CI failed on `0a98821`, whose parent predated the D193 fix. The rebased
  `e4230d0` was never pushed. The workaround was a new branch and PR (#427),
  because re-pushing needs a force-push and rule 25 asks for confirmation every time.
- **What the survey found** (2026-10-14, read with `gh` from each repo's
  workflows):
  - **vmark** runs CI only on PRs, relying on strict branch protection, so a
    merged tree equals the tested one. It skips the heavy tiers for docs-only
    PRs, reports through summary jobs, and cancels superseded runs.
  - **React and VS Code** run on every PR.
  - **Tauri** filters by path per crate.
  - **Rust** runs a small subset per PR, and the full matrix only in its merge
    queue or on request.
- **mdpro already had three of the five practices.** Superseded PR runs are
  cancelled and every job has a timeout (5). macOS runs only on `v*` tags (3).
  Landing by `--ff-only` means the landed tree is the PR head's tree, so
  `master` needs no run of its own (4).
- **Cost:** the repo is public, so GitHub-hosted runners are free. A PR run
  takes about 7 minutes. The only cost is waiting for it.

## Options considered

- **A. Keep CI advisory** (ADR-0092 Decision 4 as piloted). Lost: a red or
  stale head can land, and the pilot showed nobody reads an advisory check.
- **B. CI as a landing gate, enforced in rule 70 only.** Lost to C. It
  guards the delegator's landings but not a merge-button click on a red PR.
- **C. CI as a landing gate, in rule 70 and in GitHub branch protection
  (strict).** Chosen.
- **D. Path filters per area** (Rust jobs only when `src-tauri/` changes, as
  Tauri does). Rejected for now: Rust tests `include_str!` files under
  `scripts/` and `tests/fixtures/`, and frontend tests read
  `src-tauri/tauri.conf.json`, so a per-area filter would skip a job that the
  change can break.
- **E. A merge queue for the heavy checks** (Rust's model). Not now: GitHub's
  queue can't fast-forward (ADR-0092 D/E), and the heavy checks already run
  only on release tags.
- For re-pushing a rebased head, three options were weighed:
  - **a standing force-with-lease** (chosen);
  - **a new branch and PR per rebase**, as done for #427. Lost: it splits one
    landing's record across several PRs;
  - **asking every time.** Lost: every re-push would wait on a human.

## Decision

1. **Every PR runs the fast checks.** The `frontend` job runs `pnpm build`
   (dependency patch check, `tsc` and Vite), `pnpm typecheck:tests` and
   `pnpm test:run`. The `rust-test` job runs `cargo test` and `cargo audit`.
2. **A prose-only PR skips both heavy jobs.** The `scope` job runs
   `scripts/ci/change-scope.mjs` on the PR's range, and only "prose-only"
   answers `code=false`. Prose-only means every changed path is under
   `docs/adr/`, `docs/architecture/`, `docs/audit/`, `docs/design/`,
   `docs/pending/`, `docs/plans/`, `docs/reference/` or `docs/test/`, or is
   one of `AGENTS.md`, `CLAUDE.md` or `progress.md` at the root. Anything else
   is code, including:
   - `docs/feature-ledger.*`, `docs/guide/`, `CHANGELOG.md` and `.claude/`,
     because tests read them;
   - an empty range, or a git failure.

   The `prose-checks` job runs `node scripts/ledger/check.mjs` on every PR.
3. **One summary check, `ci-gate`.** It runs `if: always()`, needs every other
   job, and fails if any of them failed or was cancelled. A skipped job counts
   as passed. It is the only required status check, so a skipped job can never
   leave a required check pending.
4. **Branch protection on `master`** requires `ci-gate` with "require branches
   to be up to date" (strict). Admins are not enforced, so the delegator's
   docs-only direct commits (rule 70) still push. Force-push and deletion stay
   blocked.
5. **Landing condition** (rule 70 § Commits 2): the delegator lands a SHA only
   when the PR's head is that SHA and `ci-gate` is green on it, besides the
   verifier PASS and zero Critical / zero High findings. A failure that is a
   registered intermittent test may be rerun once with
   `gh run rerun <id> --failed`. A second failure blocks the landing like any other.
6. **Re-push by force-with-lease.** When a handed-off branch is rebased or
   fixed, the delegator re-pushes the PR branch with
   `git push --force-with-lease=<branch>:<old head>` without asking each time.
   This is a standing exception to rule 25. It covers only a peer's or the
   delegator's PR branch, and only when the new head is a rebase or fix of
   the same handoff. Never `master`, a `release/x.y` branch or a tag. Every
   other force-push still asks.
7. **Heavy checks stay later.** macOS runs on `v*` tags, the slow lane runs
   locally on push, and the installers build by manual dispatch. No check
   moves into the PR run.

## Consequences

- **A landing waits for CI**, about 7 minutes after the head is pushed, in
  parallel with the verifier and the audit. Usually it costs no extra time,
  because the audit takes longer.
- **Intermittent tests now block.** D196 (`d177-push-script` s2) failed one
  attempt on both D193 and D188. Each rerun costs a few minutes, and D196
  moves up in priority.
- **The prose list must stay true.** If a test starts reading a file under a
  prose prefix, a prose-only PR could skip the job that would catch a break.
  The list is an allowlist, so a new directory defaults to code. Moving a
  directory into it needs a check that nothing reads it.
- **Force-with-lease rewrites a branch other sessions may have fetched.** The
  lease protects only against overwriting a push the delegator didn't see.
  Peers never push, so in practice only the delegator writes these branches.
- **Admin bypass stays possible.** GitHub's rule binds the merge button and
  non-admins, not the delegator's own pushes. Rule 70 is what stops the
  delegator.
- **ADR-0092 stays Proposed.** Its pilot result and acceptance are a separate
  decision. This record answers only its Decision 4.
