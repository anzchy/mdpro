## Problem Statement

A change to mdpro's documentation takes one of two routes today, and neither one matches what the file actually is.

- **CI's notion of prose is wrong.** The PR CI decides "prose or code" from one list. That list still counts `CLAUDE.md` and `AGENTS.md` as prose, although tooling tests now read them, and so did ADR-0147. A PR that changes only those files is classed prose, and it skips the very tests that assert on them. ADR-0095 named this exact risk as a consequence.
- **The direct path is wider still.** The delegator can push a docs-only commit straight to `master`, and the allowlist for that push is wider than CI's prose list: it accepts `CLAUDE.md`, `AGENTS.md`, the always-on rules, the agent definitions, `docs/agents/**`, the guides, the feature ledger and `CHANGELOG.md`. A push to `master` runs no workflow at all. Such a commit can break a budget test, a citation test or `ledger:check` unseen, and the break surfaces as someone else's red PR.
- **Every code PR pays full CI.** Prose-only revisions of a docs-plus-code PR re-run the full lane each round, and a lint failure in test code can hold a prose change hostage (PR #591).
- **CI does not test the platforms that matter.**
  - PRs run on Ubuntu only. macOS runs only on release tags, and Windows never.
  - Forty-odd tooling tests spawn `pwsh` to model Windows behaviour inside the per-commit unit lane.
  - The 30-minute job timeout sits at its ceiling.

The user asked for all three tiers in `docs/reference/20261102-docs-commit-pr-ci-practices.md` to land, ahead of the work already in flight (「三档建议都要落地，这个要作为最优先的先处理，放在已经在做的task之前」), and for RC3/RC6's CI items (the vmark comparison, `docs/audit/20261101-vmark-mdpro-架构对比.md`) to be folded into the same spec (「Gated, fold into 3c (Recommended)」).

## Solution

Every changed path gets a **Change scope** (prose, policy or code), decided by one classifier: does anything executable read this path? The same answer drives both the landing route and the CI that runs.

- **Prose** (records, ADRs, plans, specs, audit and test records, decision-log entries).
  - Lands by the delegator's direct docs-only commit, as today.
  - A cheap, non-blocking `prose-lint` (spelling, Markdown lint, offline link and anchor check, on changed files only) runs on PRs and after each push to `master`.
- **Policy** (the prose among Policy files, and every **Gate input**: a non-code file a test or gate script reads).
  - Lands only through a PR.
  - Its CI runs the prose checks plus a `doc-policy` job: exactly the tests that read those paths, without coverage. It skips build, typecheck, the full coverage run and Rust.
- **Code** keeps the full CI it has today. Splitting gate code from a prose trim is recommended guidance, not a check.
- **Enforcement.**
  - The direct push accepts only prose paths.
  - On the Claude route, the role guard refuses the delegator's raw push to `master`.
  - A post-hoc check after each push to `master` flags a commit with no PR that touched a policy or code path.
- **CI platforms.**
  - The `frontend` and `rust-test` jobs get 45 minutes.
  - Every `pwsh`-spawning test moves to the slow lane, which now runs in CI: nightly, and as a gate on Windows-driver PRs.
  - After #549, #575 and 0.3.6, a PR that changes Rust also runs `rust-test` on macOS (blocking) and a Windows `cargo test` + `pnpm build` job (non-blocking until it has earned trust).

## User Stories

1. As the delegator, I want one module to tell me a path's change scope, so that CI and the landing command never disagree about the same file.
2. As the delegator, I want a direct docs-only commit to be refused when it touches a policy or code path, so that a Gate input never reaches `master` without CI.
3. As the delegator, I want ADRs, plans, audit records, test records, spec snapshots and decision-log entries to keep landing by direct commit, so that bookkeeping does not need a PR each time.
4. As the delegator on the Claude route, I want the role guard to refuse my raw `git push` to `master`, so that the Claude route has the same guard the Codex route has through `land-guard`.
5. As the delegator, I want a check after every push to `master` that fails loudly when a commit with no PR touched a policy or code path, so that a push that slipped past the guard is caught within minutes.
6. As the delegator, when that check fires, I want to record a gate exception and open a PR that runs the right checks on the commit, so that the miss is proved green or red without reverting `master`.
7. As the user, I want a PR that changes only `CLAUDE.md`, `AGENTS.md`, a rule or an agent definition to run the tests that read those files, so that a budget, citation or required-phrase break is caught before it lands.
8. As an implementor editing a rule, I want my policy-only PR to skip build, typecheck, the full coverage run and Rust, so that a prose edit gets an answer in minutes rather than the full lane.
9. As the delegator, I want `ci-gate` to accept those skips only when the scope job succeeded and said `policy`, so that a broken scope job fails closed rather than skipping tests.
10. As a maintainer, I want the list of doc-reading tests derived from the test sources, not kept by hand, so that a new test reading a rule is picked up by `doc-policy` automatically.
11. As a maintainer, I want a tooling test to fail when a test or gate script reads a path the classifier calls prose, so that a new Gate input cannot hide in the prose scope.
12. As a maintainer, when such a path is found, I want it added to the policy scope by exact path, so that the test keeps reading it and CI keeps protecting it.
13. As the delegator, I want decision-log entries to stay prose scope, so that a ruling with no rule change lands as a docs-only commit, as the decision log's README already says.
14. As the delegator, I want spec snapshots under `docs/specs/` to stay prose scope unless a test reads them, so that committing an approved snapshot needs no PR.
15. As the user, I want spelling, Markdown lint and broken relative links or anchors flagged on prose changes, so that cross-linked ADRs and rules do not rot.
16. As the delegator, I want `prose-lint` never to block a landing, and to check only the files a change touched, so that years of old Markdown do not turn every run red.
17. As the delegator, I want a red `prose-lint` after a push to `master` fixed in my next docs commit, with no D row and nothing blocked, so that prose nits cost nothing beyond the fix.
18. As a contributor, I want to run the same prose checks locally with one repo script at the same pinned tool versions, so that I can clean a change before pushing.
19. As the user, I want the prose tools run at pinned versions inside the CI job, adding nothing to `package.json`, so that no new project dependency (and no dependency ADR) is introduced.
20. As an implementor, I want guidance (in the brief template, and as an auditor Medium) to split a docs-plus-code PR into the gate code first and the prose trim second, so that a prose revision does not re-run full CI and a test-code lint cannot hold prose hostage.
21. As an implementor, I want a PR that carries code or tests to keep full CI, so that nothing that executes lands with less checking than today.
22. As a Policy-file author, I want my policy PR audited by today's route (the 11-02 policy set, the two pinned audit files at High tier), so that this change moves CI and landing only, not audit.
23. As an implementor, I want `frontend` and `rust-test` to time out at 45 minutes, so that a full run is not killed at its 30-minute ceiling.
24. As an implementor, I want every test that spawns `pwsh` to live in a `*.slow.test.ts` file, so that the per-commit unit lane stops paying for PowerShell models.
25. As a maintainer, I want a lint that refuses a `pwsh` spawn in a non-slow test file, so that the next PowerShell model cannot land back in the unit lane.
26. As the user, I want the slow lane to run in CI nightly, so that the moved tests are still exercised.
27. As an implementor of the Windows driver, I want the slow lane to run inside `ci-gate` on PRs that touch the driver skill or its tests, so that driver changes are still gated by their tests.
28. As the user, after #549, #575 and 0.3.6, I want `rust-test` on macOS for every PR that touches Rust or the Cargo files, blocking, so that the primary platform's Rust is proved before landing, not only at a release tag.
29. As an implementor of a frontend-only PR, I want no macOS minutes spent on it, so that CI cost tracks where macOS can differ.
30. As the user, after the same preconditions, I want a Windows job running `cargo test` and `pnpm build` on PRs that touch Rust or the Cargo files, so that Windows is proved by a runner instead of only by the bespoke driver (RC6).
31. As the delegator, I want that Windows job non-blocking until ten consecutive green runs, then promoted into `ci-gate` by its own decision-log entry, so that the first, likely red, Windows runs do not hold landings.
32. As the delegator, when the Windows job is red on a PR but green on its base, I want it put in the audit request as a Medium, and the green count reset, so that a Windows regression is seen and weighed without blocking.
33. As a release manager, I want release tags to keep their current CI matrix, so that the release gate does not change in this spec.
34. As the user, I want the two process decisions recorded as decision-log entries, each gate-sensitive and plan-reviewed by both auditors, so that the change is recorded where ADR-0165 says process decisions live.
35. As a reader of ADR-0095, I want its decision 2's prose list marked as folded and changed by the change-scopes entry, so that the accepted ADR points at the current rule.
36. As a reader of rule 70, I want § Commits item 2's "a docs-only commit … needs no PR and no CI" replaced by the change-scope route, so that the rule text matches what the guard enforces.
37. As a reader of the Glossary, I want **Change scope** and **Gate input** defined, and "tier" left to mean the audit tier, so that the two classifications are never confused.
38. As a maintainer, I want this classifier to be the one ADR-0159 asks for, so that the repo never keeps two lists of Policy files.

## Implementation Decisions

Local ids `DCT-r1-D<n>` (rule 12).

- **DCT-r1-D1. One classifier.**
  - A single module answers `prose`, `policy` or `code` for a repo-relative path.
  - A PR's change scope is the most demanding answer across its paths, and an empty or unreadable range is `code`.
  - The CI scope step and the landing command's docs-only mode both import it. Neither keeps its own list.
  - It is the path module ADR-0159 calls for.
- **DCT-r1-D2. Prose scope.** Everything under `docs/**` not claimed by policy, `design/**/*.md`, `progress.md` and the user Q&A file. That includes `docs/agents/decisions/**` and `docs/specs/**`.
- **DCT-r1-D3. Policy scope.**
  - The prose files among Policy files: `CLAUDE.md`, `AGENTS.md`, `.claude/**`, `.agents/**`, `.codex/**` and `docs/agents/**` except `decisions/`.
  - `docs/guide/**`, the feature ledger files and `CHANGELOG.md`.
  - Every exact path the scan (D4) finds a test or gate script reading. ADR-0147 is one today.
  - Executables under Policy prefixes are code.
- **DCT-r1-D4. Gate inputs are derived.** A scan over the test and gate-script sources lists the repo paths and prefixes they read. Any such path that classifies as prose is an error until it is added to the policy list by exact path. The `doc-policy` test list is the scan's output, never hand-kept.
- **DCT-r1-D5. Landing route.**
  - The docs-only landing mode accepts only prose-scope paths. The two pinned audit files keep their existing refusal.
  - Rule 70 § Commits item 2 changes to match.
  - The role guard gains a delegator branch that refuses a raw `git push` to `master` outside the landing command.
- **DCT-r1-D6. CI scope step.**
  - It emits three values.
  - A `policy` PR runs `prose-checks`, `prose-lint` and `doc-policy`: vitest without coverage over the scanned tests.
  - `ci-gate` treats the skipped `frontend`, `rust-test` and `rust-audit` jobs as passing only when the scope job succeeded and output `policy`. Otherwise it fails closed.
- **DCT-r1-D7. `prose-lint`.**
  - It runs on PRs and on a new push-to-`master` trigger, and is never in `ci-gate`'s needs.
  - Its three checks are codespell, markdownlint-cli2 and a repo script for relative links and anchors (offline, no network).
  - It checks changed files only.
  - Tool versions are pinned inside the job. `package.json` is unchanged, and one repo script runs the same versions locally.
  - The markdownlint config turns off the rules that fight existing docs (line length, CJK spacing).
- **DCT-r1-D8. Post-hoc push check.**
  - On push to `master`, a step finds any pushed commit that has no associated PR and touches a policy or code path, and fails.
  - The delegator then records a gate-exception row, opens a PR from `master` that runs `doc-policy` or the full lane on that commit, and asks the user only if it is red. There is no revert.
- **DCT-r1-D9. Code PRs** keep full CI. Splitting a PR is guidance in the brief template and an auditor Medium, never a CI check.
- **DCT-r1-D10. Audit unchanged.** Policy PRs keep the 11-02 policy-set route. Receipts are needed only when a PR changes a test.
- **DCT-r1-D11. Timeouts.** `frontend` and `rust-test` go to 45 minutes.
- **DCT-r1-D12. pwsh to the slow lane** (ADR-0050).
  - Every tooling test that spawns `pwsh` moves to a `*.slow.test.ts` sibling.
  - A lint refuses a `pwsh` spawn in a non-slow test file.
  - A CI `slow` job runs nightly outside `ci-gate`, and inside `ci-gate` on PRs touching the Windows-driver skill or its tests.
- **DCT-r1-D13. macOS** (after #549, #575, 0.3.6). On a `code` PR touching `src-tauri/` or the Cargo files, `rust-test` also runs on `macos-latest`, and it is blocking. `frontend` stays Ubuntu-only on PRs. Tags keep their matrix.
- **DCT-r1-D14. Windows** (same preconditions).
  - A `windows-latest` job runs `cargo test` and `pnpm build` on the same PRs. It is outside `ci-gate`.
  - Ten consecutive green runs allow promotion, by its own decision-log entry.
  - A red on a PR whose base was green goes into the audit request as a Medium and resets the count.
  - Installer builds (`build-windows.yml`) on PRs are not included.
- **DCT-r1-D15. Records.** These are process decisions under ADR-0165, so no ADR. There are two gate-sensitive decision-log entries:
  - "change scopes" folds and changes ADR-0095 decision 2's prose list and rule 70 item 2;
  - "CI platforms" covers the timeouts, the slow lane, macOS and Windows.

  The Glossary gains **Change scope** and **Gate input**.
- **DCT-r1-D16. Order.**
  - First, ahead of in-flight work: D1–D12, D15 and the Glossary.
  - D13 and D14 wait for #549 and #575 to land and for 0.3.6 to ship.

## Testing Decisions

- **A good test here** asserts what a path classifies as, what a job will run, or what a guard refuses, through the module's or file's public face. It never asserts a helper's internals. No permanent test reads git history, because the CI checkout is shallow (the D355 fix 4 / RC5 fix 1 lesson). Nothing touches the app, so there are no `device` ACs.
- **Seam 1: the classifier, as a unit.**
  - Path in, scope out, covering prose, policy, code, exact-path Gate inputs, `docs/agents/decisions/**`, `docs/specs/**`, executables under Policy prefixes, and empty or unreadable ranges.
  - For every path in a table, the CI scope step and the landing command's docs-only check give the same answer.
  - Prior art: `tests/tooling/ci-change-scope.test.ts`.
- **Seam 2: scan-derived consistency.**
  - It runs the scan over the real test and gate-script sources.
  - It fails when a read path classifies as prose.
  - It asserts the `doc-policy` test list equals the scan's output.
  - Prior art: vmark's `check-rust-filter-inputs` pattern, and `tests/tooling/feature-ledger.test.ts`'s coverage-of-declared-surfaces check.
- **Seam 3: workflow and guard text contract.**
  - From the committed files, it asserts that `ci.yml`:
    - makes `ci-gate` trust the `policy` skip only on scope success;
    - keeps `prose-lint` and the nightly `slow` job out of `needs`, and puts `slow` in `needs` on driver PRs;
    - sets the 45-minute timeouts;
    - conditions macOS `rust-test` on Rust paths and makes it blocking;
    - keeps Windows out of `needs`.
  - It also asserts that the role guard's delegator branch refuses a raw push to `master`, and that the `pwsh` lint refuses a spawn outside a slow file.
  - Prior art: `tests/tooling/adr0146-audit-dimensions.test.ts`, and the existing workflow-reading tooling tests.
- Each ticket's ACs map onto these three seams. A new seam stops the work and goes to the delegator (rule 12).

## Out of Scope

- **Audit changes.** The 11-02 policy set, the two pinned audit files and ADR-0121 tiers are untouched.
- **Release changes.** The release workflow and the tag CI matrix are unchanged.
- **Windows installers.** `build-windows.yml` installers on PRs are not included; promoting Windows to blocking happens in its own later entry.
- **Journeys and device runs.** The journey runner on the control channel (RC1 b), and any real-app or device run in CI, are not included.
- **Rewriting tests.** Rewriting existing tests so they stop reading docs (D4 adds paths to policy instead), and removing jsdom host-model tests beyond the `pwsh` move, are not included.
- **External links.** Links to outside URLs are not checked. Spelling and markdownlint are not run repo-wide over old files.
- **GitHub branch protection** on `master` is not changed.
- **#580** is not part of this spec. Its NL-audit chain overlaps the 11-02 policy set and is reconciled separately.

## Further Notes

- Sources:
  - `docs/reference/20261102-docs-commit-pr-ci-practices.md` (commit `1860d566`): findings M1–M3 and the three tiers;
  - `docs/audit/20261101-vmark-mdpro-架构对比.md`, RC3 and RC6;
  - the delegator heartbeat's order step 3c.
- Grill: three rounds, each answered 「all yes」, shared understanding confirmed 「yes」 (2026-11-03). Planner folder: `~/.mdpro-redesign/planner/docs-ci-tiers/`.
- **"Tier" is not used in records**, because it means ADR-0121's audit tier. The three classes are change scopes.
- **Gate-sensitive throughout.** Every ticket edits CI or landing tooling, so each one is High tier and both auditors plan-review the two decision-log entries before they land.

