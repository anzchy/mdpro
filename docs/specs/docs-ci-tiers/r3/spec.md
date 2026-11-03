> **r3 (approved 2026-11-03: 「panner的问题，直接回复同意」).** This revises r2 (`docs/specs/docs-ci-tiers/r2/`, approved 「Approve r2 (Recommended)」) for the
> three Highs left open by the r2 plan review (`herdr-spike/delegator/docs-ci-tiers-r2-plan-merged.md`, r2-H1..H3; ruling
> 「r3 + scoped confirm (Recommended)」). `r3/findings-map.md` maps each r2 finding to its change. Decision ids keep their
> `DCT-r2-D<n>` names, since no decision changes its subject; r1 ids are not reused for a different meaning.

## Problem Statement

A change to mdpro's documentation takes one of two routes today, and neither one matches what the file actually is.

- **CI's notion of prose is wrong.** The PR CI decides "prose or code" from one list. That list still counts `CLAUDE.md` and
  `AGENTS.md` as prose, although tooling tests now read them, and so did ADR-0147. A PR that changes only those files is
  classed prose, and it skips the very tests that assert on them. ADR-0095 named this exact risk as a consequence.
- **The direct path is wider still, and unchecked.** The delegator can push a docs-only commit straight to `master`. The
  allowlist for that push is wider than CI's prose list: it accepts `CLAUDE.md`, `AGENTS.md`, the always-on rules, the agent
  definitions, `docs/agents/**`, the guides, the feature ledger and `CHANGELOG.md`. A push to `master` runs no workflow.
  Some of the files rule 70 sends by direct commit are themselves read by tests and gate scripts: the sequencing doc, the
  journey records and runs, the decision-log README, the ADRs whose Status lines tests assert on, and `design/DESIGN.md`.
  Such a commit can break a test unseen, and the break surfaces as someone else's red PR.
- **Every code PR pays full CI.** Prose-only revisions of a docs-plus-code PR re-run the full lane each round, and a lint
  failure in test code can hold a prose change hostage (PR #591).
- **CI does not test the platforms that matter.**
  - PRs run on Ubuntu only. macOS runs only on release tags, and Windows never.
  - Forty-one tooling tests (and the harnesses about sixty more import) spawn `pwsh` to model Windows behaviour inside the
    per-commit unit lane.
  - The 30-minute job timeout sits at its ceiling.

The user asked for all three tiers in `docs/reference/20261102-docs-commit-pr-ci-practices.md` to land, ahead of the work
already in flight (「三档建议都要落地，这个要作为最优先的先处理，放在已经在做的task之前」), and for RC3/RC6's CI items to be folded into
the same spec (「Gated, fold into 3c (Recommended)」).

## Solution

Every changed path gets a **Change scope** (prose, policy or code) from one classifier, plus a flag saying whether it is a
**Gate input** (a non-code file some test or gate script reads). The same answer drives the landing route and the CI that runs.

- **Prose** (records, ADRs, plans, specs, audit and test records, decision-log entries, design notes).
  - Lands by the delegator's direct docs-only commit, as today, through the landing command.
  - **A prose Gate input is checked before it is pushed:** the landing command runs that file's readers (the tests and gate
    scripts that read it) and refuses the push if they fail. A push workflow re-runs them after the push as a backstop.
  - A cheap, non-blocking `prose-lint` runs on PRs and after each push to `master`.
- **Policy** (the Markdown among Policy files: `CLAUDE.md`, `AGENTS.md`, rules, skills, agent definitions, `docs/agents/**`
  except decisions, the guides, the ledger, `CHANGELOG.md`). Lands only through a PR. Its CI runs `prose-checks` and a
  `doc-policy` job (exactly the readers, without coverage), and skips build, typecheck, the full coverage run and Rust.
- **Code** keeps the full CI it has today, including every executable or data file under a Policy prefix.
- **Fail-closed.** `ci-gate` becomes a tested script. Every job that runs only sometimes is always in its `needs`, and its
  skip counts only when the scope job succeeded and said the job was not needed.
- **Enforcement.** The landing command accepts only prose. On the Claude route, the role guard refuses the delegator's raw
  push to `master`. A separate push workflow flags a commit with no green PR that touched a policy or code path. A runtime
  trace in the full CI run catches a reader the static scan missed.
- **CI platforms.**
  - `frontend` and `rust-test` time out at 45 minutes.
  - Every `pwsh`-spawning test moves to the slow lane, which now runs in CI: nightly in its own workflow, and as a required
    job on PRs that touch what those tests cover.
  - After #549 and #575 land, a PR that changes Rust also runs `rust-test` on macOS (blocking) and a Windows `cargo test` +
    `pnpm build` job (non-blocking until it has earned trust).

## User Stories

1. As the delegator, I want one module to tell me a path's change scope and whether it is a Gate input, so that CI and the
   landing command never disagree about the same file.
2. As the delegator, I want a direct docs-only commit to be refused when it touches a policy or code path, so that rules,
   skills and gate code never reach `master` without CI.
3. As the delegator, I want ADRs, plans, audit records, test records, spec snapshots, decision-log entries and the glossary to
   keep landing by direct commit, so that bookkeeping does not need a PR each time.
4. As the delegator, I want the landing command to run a prose Gate input's readers before it pushes, and to refuse the push
   when they fail, so that a sequencing-row fill or a journey run that breaks a test never reaches `master`.
5. As the delegator on the Claude route, I want the role guard to refuse my raw `git push` to `master` in every spelling, so
   that the Claude route goes through the same landing command the Codex route does.
6. As the delegator, I want my Claude pane to refuse to dispatch unless it runs with `MDPRO_ROLE=delegator`, so that the role
   guard's delegator branch is never inert.
7. As the delegator, I want a check after every push to `master` that fails when a commit with no green PR touched a policy or
   code path, so that a push that slipped past the guard is caught within minutes.
8. As the delegator, I want that check to cover every commit since the last completed check, so that a cancelled or missing
   run cannot let a commit escape.
9. As the delegator, when that check fires, I want to run the full CI on exactly the slipped commit and record the result as a
   gate exception, so that the miss is proved green or red without reverting `master`.
10. As the user, I want a PR that changes only `CLAUDE.md`, `AGENTS.md`, a rule or an agent definition to run the tests that
    read those files, so that a budget, citation or required-phrase break is caught before it lands.
11. As an implementor editing a rule, I want my policy-only PR to skip build, typecheck, the full coverage run and Rust, so that
    a prose edit gets an answer in minutes rather than the full lane.
12. As the delegator, I want every sometimes-run job to count as skipped only when the scope job succeeded and said it was not
    needed, so that a broken scope job, a missing output or a red `doc-policy` fails closed.
13. As a maintainer, I want the Gate inputs and their readers derived from the test and gate-script sources, not kept by hand,
    so that a new test reading a doc is picked up automatically.
14. As a maintainer, I want a directory a gate enumerates to make every file under it a Gate input, so that a new journey run
    file is checked like an old one.
15. As a maintainer, I want the full CI run to trace every repo file the tests read, and fail on a read of a prose path that is
    not a known Gate input or by a reader not listed for it, so that a reader the static scan cannot see is still caught.
16. As a maintainer, I want an executable or data file under a Policy prefix (hook settings, command-guard rules, agent TOML,
    JSON) and any symlink, submodule or executable-bit file to classify as code, so that wiring never gets the light lane.
17. As the delegator, I want decision-log entries, spec snapshots and `GLOSSARY.md` to stay prose, so that rule 12's and the
    decision log's direct commits keep working.
18. As the user, I want spelling, Markdown lint and broken relative links or anchors flagged on prose changes, so that
    cross-linked ADRs and rules do not rot.
19. As the delegator, I want `prose-lint` never to block a landing, and to check only the files a change touched, so that years
    of old Markdown do not turn every run red.
20. As a contributor, I want to run the same prose checks locally with one repo script at the same pinned tool versions.
21. As the user, I want the prose tools pinned inside the CI job, adding nothing to `package.json`, so that no new project
    dependency is introduced.
22. As an implementor, I want guidance (in the brief template, and as an audit-request line) to split a docs-plus-code PR into
    the gate code first and the prose trim second, so that a prose revision does not re-run full CI.
23. As an implementor, I want a PR that carries code or tests to keep full CI.
24. As a Policy-file author, I want my policy PR audited by today's route (the 11-02 policy set), so that this spec moves CI and
    landing only.
25. As an implementor, I want `frontend` and `rust-test` to time out at 45 minutes.
26. As an implementor, I want every test that spawns `pwsh`, directly or through a helper it imports, to live in a
    `*.slow.test.ts` file, so that the per-commit unit lane stops paying for PowerShell models.
27. As a maintainer, I want a lint that refuses such a spawn in a non-slow test file, so that the next PowerShell model cannot
    land back in the unit lane.
28. As the user, I want the slow lane to run in CI nightly, in its own workflow, so that the moved tests are still exercised
    and `ci.yml` keeps no schedule.
29. As an implementor of the Windows driver or the release tooling, I want the slow lane to be a required job on PRs that touch
    what the slow tests cover, so that those changes are still gated by their tests.
30. As the user, I want `rust-test` on macOS for every PR that touches Rust or the Cargo files, blocking, so that the primary
    platform's Rust is proved before landing.
31. As an implementor of a frontend-only PR, I want no macOS minutes spent on it.
32. As the user, I want a Windows job running `cargo test` and `pnpm build` on PRs that touch Rust or the Cargo files, so that
    Windows is proved by a runner (RC6).
33. As the delegator, I want that Windows job non-blocking until ten counted green runs in a row, recorded in one place, then
    promoted by its own decision-log entry.
34. As the delegator, when the Windows job is red on a PR, I want the same job run on the PR's base in the same workflow run, so
    that "red here, green on the base" is measured, goes into the audit request as a Medium, and resets the count.
35. As a release manager, I want release tags to keep their current CI matrix.
36. As a reader of the rules, I want each rule this spec changes rewritten in the same commit as the decision-log entry that
    records it, and each accepted ADR clause it changes given its "folded and changed by" link.
37. As a reader of the Glossary, I want **Change scope** and **Gate input** defined per path, and "tier" left to mean the audit
    tier.

## Implementation Decisions

Local ids `DCT-r2-D<n>` (rule 12).

- **DCT-r2-D1. One classifier.**
  - Input: a repo-relative path and its git mode. Output: a change scope (`prose`, `policy` or `code`) and a Gate-input flag
    with that input's readers.
  - A range's scope is the most demanding answer across its paths. An empty or unreadable range is `code`.
  - The CI scope step, the landing command, the push workflow's detector and the runtime trace check all use it. None keeps
    its own list.
  - It does **not** claim to be ADR-0159's path module. ADR-0159 is Proposed, and it disagrees in d6–d8. The change-scopes
    entry names the conflict. Reconciling the two is ADR-0159's own task before acceptance.
- **DCT-r2-D2. Prose.**
  - Everything under `docs/**` that policy does not claim, including `docs/agents/decisions/**` and `docs/specs/**`.
  - `design/**/*.md`, and every root `*.md` except `CLAUDE.md`, `AGENTS.md` and `CHANGELOG.md`. That covers `progress.md`,
    `GLOSSARY.md`, `README.md`, `TODOS.md`, the root `DESIGN.md` and the user Q&A file.
  - Non-Markdown records under `docs/test/` (for example `.ps1`, `.sh` or `.json` evidence) stay prose: nothing runs them.
- **DCT-r2-D3. Policy.**
  - The `*.md` files under `CLAUDE.md`, `AGENTS.md`, `.claude/**`, `.agents/**`, `.codex/**`, and `docs/agents/**` except
    `decisions/`.
  - `docs/guide/**`, the feature ledger files and `CHANGELOG.md`.
- **DCT-r2-D4. Code.**
  - Everything else: `src/`, `src-tauri/`, `tests/`, `scripts/`, `.github/`, configs and lockfiles, and unknown paths.
  - Every non-Markdown file under a Policy prefix (`settings.json`, `*.rules`, `*.toml`, `*.json`, `*.sh`, `*.mjs`, `*.py`).
  - Any path whose mode is a symlink, a submodule or executable, anywhere.
- **DCT-r2-D5. Gate inputs: the scan.**
  - *Sources:* every file under `tests/` (support, helpers and harnesses included), `scripts/`, `.github/workflows/` and
    `.claude/hooks/`, plus the vitest configs and `package.json`'s scripts.
  - *What it finds:* outside comments, every string literal (and every `join`/`resolve` of literals) that names an existing repo path which is
    not code.
    - A file literal makes that file a Gate input.
    - A directory literal makes every file under it a Gate input. This is how an enumerated directory such as
      `docs/test/journey-runs/` is covered, new files included.
    - An optional `gate-inputs:` annotation in the reading file may narrow a directory literal to the exact files it reads.
    - A literal that names a path without reading it carries a `not-a-read:` annotation and makes nothing a Gate input. This
      covers classification prefixes, exclusion lists, paths passed as data to the code under test, and keep-maps. The
      classifier, the landing command, the control source-tree exclusions, the CI scope script and their tests carry it.
    - An unannotated directory literal that names a whole top-level tree (`docs/`, `design/`) or a Policy prefix is a scan
      error.
  - *Readers:* the file holding the literal. Where that file is a helper or a gate script, the readers are every test that
    imports it (transitively) and the CI step that runs it.
  - *Errors:* a literal that names no existing path is a scan error, unless it sits in a test's temporary-fixture setup or
    carries an annotation saying so.
  - *Output:* the inventory of Gate inputs with their readers, which is also the `doc-policy` test list. On the committed
    tree it equals D7's list, as an upper bound as well as a lower one.
- **DCT-r2-D6. Gate inputs: the runtime trace.**
  - During the full `frontend` run, a preload records every repo file each test file reads, including through spawned
    `node` children.
  - A check step compares each traced (path, reader) pair. It fails when a read of a `prose` path is not a known Gate input,
    or when the reading test file is not in that input's reader list. It names the path and the reader.
  - Reads by non-Node children (`pwsh`, `sh`, `python`) are not traced. That residual risk is named in the change-scopes
    entry.
- **DCT-r2-D7. Today's Gate inputs and how each is ruled.** This is the inventory at `origin/master` d5a58402, from a literal
  scan; T-01's scan is the authority.
  - **Prose Gate inputs** (stay on the direct route, with their readers run before the push):
    - `docs/plans/20260912-frontend-backend-sequencing-order.md`, read by the journey catalogue;
    - `docs/test/20261002-adr0047-journeys.md`, read by the journey catalogue;
    - `docs/test/journey-runs/**`, enumerated by `journeys:check`;
    - `docs/agents/decisions/README.md` and `docs/agents/decisions/20261102-audit-policy-set-split.md`, read by the gh586
      test;
    - the ADR files whose text tests assert on: 0147 (gh586), and 0085, 0115 and 0121 (adr0146). adr0146 joins the
      directory literal `docs/adr` with a file name from a table, so without an annotation every ADR is a Gate input with
      that one reader; its `gate-inputs:` annotation narrows this to the three files. (0016 and 0019 are only cited in
      comments, which are not reads.)
    - `docs/test/20261023-m1b-device-chords.md`;
    - `design/DESIGN.md`, read by five contrast and token tests;
    - `design/DESIGN.stitch.md`;
    - `TODOS.md`, read by the colour-border test.
  - **Code** (not Markdown under `design/`): `design/prototypes/011-d260-settings-rail.html`.
  - **Policy already:** `docs/agents/audit-*.md` (which keep their ADR-0146 route), `docs/guide/**`, the ledger and
    `CHANGELOG.md`.
  - **Why the prose ruling:** every prose Gate input above is a file that a rule sends by direct commit: sequencing fills,
    device and journey records, decision entries, ADR status lines, design notes. Pre-push readers keep that route open
    while closing the gap. Making them policy would end rule 70's direct-commit list. Rewriting their readers is out of scope.
- **DCT-r2-D8. Landing route.**
  - **What it accepts.** The landing command's docs-only mode accepts only `prose` paths. The two pinned audit files keep
    their refusal.
  - **Prose Gate inputs.** When the commit touches one, the command first runs its readers: the `doc-policy` vitest config
    over those test files, without coverage, under the heavy lock's guard-only mode, plus each gate script that reads it.
    `journeys:check` runs with `--base` set to `origin/master`. Any failure, or failing to run, refuses the push.
  - **The Claude route.** The Claude delegator lands through the same command; its raw `git merge --ff-only` plus `git push`
    is retired.
  - **The role guard.** It gains a `delegator` branch. That branch refuses any Bash command that would update `master`
    except the landing command itself. Covered spellings: `git push` with a master refspec (`master`, `HEAD:master`,
    `master:master`, `+master`, `refs/heads/master`, `<sha>:refs/heads/master`), a bare `git push` or `git push origin HEAD`
    from `master`, `--all`, `--mirror`, `git -C`, and `gh api … git/refs/heads/master`. It still allows rule 25's `--force-with-lease` to PR branches, and pushes to `retro/*`
    branches.
  - **Setting the role.** `delegator-route.sh` blocks dispatch on the Claude route unless `MDPRO_ROLE=delegator`. "No role,
    no checks" still holds for the user's own sessions; ADR-0159 d8's "unset in the main checkout means delegator" is not
    adopted. The landing command's existing role-overlay check needs the delegator overlay in the main checkout, which the
    Claude route therefore installs too.
  - **The docs change.** Rule 70 § Commits item 2, its "Only the delegator lands" paragraph and the delegator skill change
    to match.
- **DCT-r2-D9. `ci-gate` is a script, and fail-closed applies to every conditional job.**
  - The scope job emits `scope` (`prose|policy|code`), `doc_policy`, `rust` and `slow` (each `true|false`). `doc_policy` is
    true for `policy`, and for `prose` with any Gate input. An empty or unreadable range (dispatch, tags, a retro run) emits
    `code` with all three set to `true`.
  - Every conditional job is a separate job that is always in `ci-gate`'s `needs`: `frontend`, `rust-test`, `doc-policy`,
    and later `slow` and `rust-test-macos`.
  - For each, the gate script requires `success` when the scope outputs say it is required. It accepts `skipped` only when
    `scope` succeeded and its outputs say the job was not needed. A missing or unknown output fails the gate.
  - `scope` and `prose-checks` always require `success`. `rust-audit` stays out of `needs` (ADR-0107 d2).
  - `doc-policy` is required for `policy`. For `prose` with any Gate input, it is required for those readers.
  - The rule table, as written:

    | Job | Required when |
    |---|---|
    | `frontend`, `rust-test` | `scope == code` |
    | `doc-policy` | `doc_policy == true` |
    | `slow` | `slow == true` |
    | `rust-test-macos` | `scope == code` and `rust == true` |
- **DCT-r2-D10. `doc-policy`.**
  - It runs `vitest run` under its own config, whose include is exactly the reader list (`*.slow.test.ts` readers
    included), without coverage.
  - The job fails unless the number of collected files equals the list's length. Then a moved or renamed reader cannot drop
    out silently.
- **DCT-r2-D11. Push workflow (`master-push.yml`, separate from `ci.yml`).**
  - **Trigger.** On push to `master`. No concurrency group, so a burst of pushes is never cancelled.
  - **Permissions:** `contents: read`, `pull-requests: read`, `actions: read`.
  - **Range.** It checks every commit from the `after` SHA of the latest earlier run that concluded `success`, through this
    push's `after`. A red, failed or cancelled run does not move the start, so the next push checks its commits and Gate
    inputs again until a run is green. With no earlier green run, it starts at the `before` of the earliest run. History
    comes from `fetch-depth: 0`.
  - **Detector.** For each commit in the range that touches a `policy` or `code` path, it passes only when:
    - the commit is an ancestor of, or equal to, the head H of an associated PR whose `ci-gate` concluded `success` on H;
    - and H is an ancestor of, or equal to, this push's `after`, so a raw push of a strict prefix of a green PR fails.

    A commit with a green D12 retro run on that exact SHA also passes. Otherwise it fails and names the commit. Any API,
    git or range failure fails the run.
  - **Reader re-run.** For each prose Gate input in the range, it runs the readers as the landing command does, plus
    `journeys:check --base <range start>`.
  - **Red-master hold, enforced by the landing command** (both modes).
    - **When it applies.** While `.github/workflows/master-push.yml` exists in `origin/master`'s tree, the command reads
      the `master-push.yml` run for `origin/master`'s HEAD before it pushes.
    - **Red.** If that run concluded anything but `success`, the command refuses, unless the landing is a repair
      (`--repair <run-id>` naming that run). A repair still passes every other gate.
    - **Pending or unknown.** It refuses, naming the reason, while the run is in progress or missing, or when the lookup
      fails; the delegator waits and retries.
    - **Which run counts.** Only HEAD's run; a red run on an earlier SHA is not consulted, because HEAD's run re-checks
      its range.
    - **Rule.** Rule 70 § Commits item 2 gains this as a landing condition.
  - **`ci.yml` is unchanged.** It keeps no push-to-`master` trigger and no `schedule` (ADR-0107 d3). Its "push deliberately
    runs nothing" header stays true for `ci.yml`, and gains a pointer to the new workflow.
- **DCT-r2-D12. The exact-SHA retro route.** When the detector fires:
  1. The delegator pushes `retro/<sha7>` at exactly the slipped SHA.
  2. It runs `gh workflow run ci.yml --ref retro/<sha7> -f base=<the SHA's first parent>`. A dispatch run has no PR base, so
     `scope` says `code` and the full lane runs on that exact SHA, with full history.
  3. It records a gate-exception row with the SHA, the run URL and the `ci-gate` result, landed with `--repair` naming
     the red `master-push` run (D11). When the retro run is green, that push's `master-push` run passes the commit.
  4. It asks the user only when the run is red. Then the fix is a forward PR, landed with `--repair`, and there is no
     revert.
  5. The branch follows ADR-0084's 30-day rule.
- **DCT-r2-D13. `prose-lint`** (its own workflow, on `pull_request` and push to `master`; never in `ci-gate`).
  - Three checks: codespell, markdownlint-cli2 (with line length and CJK spacing off), and a repo script for relative links
    and anchors (offline).
  - Changed Markdown files only.
  - Versions are pinned in the job. One local script runs the same versions, and `package.json` is unchanged.
  - A red after a push is fixed in the next docs commit, with no D row.
- **DCT-r2-D14. Code PRs** keep full CI. Splitting is guidance in the brief template, plus one line in the audit-request
  template asking for a Medium on an unsplit docs-plus-code PR. The pinned audit files are unchanged. This decision is
  spec-local, not a decision-log entry.
- **DCT-r2-D15. Audit unchanged.** The 11-02 policy set, the two pinned audit files and the ADR-0121 tiers. Receipts are
  needed only when a PR changes a test.
- **DCT-r2-D16. Timeouts.** `frontend` and `rust-test` go to 45 minutes. The macOS leg (D18) gets the same limit, and a
  timeout counts as red.
- **DCT-r2-D17. `pwsh` to the slow lane.**
  - **What moves.** Every test file that spawns `pwsh`, directly or through a `tests/` helper it imports, moves to a
    `*.slow.test.ts` sibling. The helpers that spawn it are split out, so that a non-slow file can still import the
    non-spawning parts.
  - **The lint** refuses a direct or transitive `pwsh` spawn in a non-slow test file.
  - **The slow-trigger set** is derived from the moved `pwsh` files only: those files, plus every repo path they import or
    spawn. Today that is the Windows-driver skill and `scripts/release/devReleaseId.mjs`. The other slow files keep
    ADR-0050's local and nightly route and do not set `slow`.
  - **When `slow` is required.** The scope job sets `slow=true` when a PR touches the slow-trigger set. A `slow` job in
    `ci.yml` is then required, through the D9 rule.
  - **Nightly.** A separate workflow, `slow-nightly.yml`, runs the whole slow lane nightly and on manual dispatch.
  - **The unit inventory.** `tests/ci-inventory.json` (`compare-report.mjs`) is updated for the moved files.
  - **What it changes.** This replaces ADR-0050's slow-tier criterion for these files: membership by host model, beside
    "≥ 2 s and an enumeration".
  - **Order.** It waits for #549 (spawn timeouts) and #575 (driver work in flight).
- **DCT-r2-D18. macOS.** On a `code` PR with `rust=true`, a separate `rust-test-macos` job runs, and it is required (D9). The
  `frontend` job stays Ubuntu-only on PRs. Tags keep their matrix. `rust-test-macos` and `rust-windows` also run on
  dispatch. A green dispatch run on the T-07 branch head (`gh workflow run ci.yml --ref <branch>`) proves the macOS
  cold-cache time before the job is required.
- **DCT-r2-D19. Windows.**
  - **What runs.** A `windows-latest` job, `rust-windows`, runs `cargo test` and `pnpm build` on `rust=true` PRs. It first
    creates the `mdpro_mcp-x86_64-pc-windows-msvc.exe` sidecar stub, as `build-windows.yml` does. It stays outside `ci-gate`.
    Counting starts at its first green run after T-07 lands. A Windows red does not hold T-07's handoff.
  - **Base comparison.** When the head is red, a `rust-windows-base` job runs the same steps on the PR's base SHA in the same
    workflow run.
  - **Counting.**
    - The unit is the latest completed attempt on a distinct PR head SHA.
    - Green advances the count. Red resets it.
    - Cancelled and skipped runs neither advance nor reset it.
    - The delegator records each counted run as a row in `docs/audit/audit-log.md` § Windows CI series: PR, SHA, run URL,
      result and running count.
  - **Promotion.** Ten in a row allow promotion by a new entry.
  - **Base green.** A red head with a green base goes into that PR's audit request as a Medium. The delegator sends the
    audit request only after `rust-windows-base` has concluded.
  - **Not included:** installers on PRs.
- **DCT-r2-D20. Records.** Each rule change lands in the same commit as the decision-log entry that records it, in the ticket
  that makes the change. That is seven entries, six of them gate-sensitive:

  | Entry | Ticket | What it folds or changes |
  |---|---|---|
  | change scopes | T-01 | ADR-0095 d2 → `70-multi-session-coordination.md#change-scopes` |
  | policy lane and fail-closed gate | T-02 | ADR-0095 d3 ("a skipped job counts as passed") → `#pull-request-ci`; also the timeouts |
  | docs-only landing route | T-03 | rule 70 § Commits item 2; the "Only the delegator lands" paragraph; CLAUDE.md § User questions' "reusable how-to … `docs/guide/` in the same commit" (a guide is now policy, so a direct commit puts the how-to under `docs/knowledge/`, or links a guide PR) |
  | `prose-lint` | T-04 | not gate-sensitive |
  | master push checks | T-05 | rule 70 § Commits item 2: the red-master hold becomes a landing condition |
  | slow lane in CI | T-06 | ADR-0050's criterion → `10-tdd.md#environment-and-the-slow-tier`; ADR-0095 d7's "the slow lane runs locally on push" and "no check moves into the PR run" → `#pull-request-ci` |
  | Rust on macOS and Windows | T-07 | ADR-0095 d7's "macOS runs on `v*` tags" → `#pull-request-ci`, which already allows PR checks (slow-lane entry) |

  The Glossary's **Change scope** and **Gate input** are corrected to per-path definitions.
- **DCT-r2-D21. Order and edges.**
  - **First, ahead of in-flight work:** T-01, then T-02, then T-03, then T-05. T-03 and T-05 run T-02's `doc-policy`
    reader config, and T-05 adds the red-master hold to the landing command that T-03 rewrites. T-04 and T-09 have no
    blocker.
  - **After #549 and #575:** T-06 and T-07. 0.3.6 has shipped and is no longer a precondition.
  - **Overlap with #549.** #549 also edits files T-02 and T-03 touch. The delegator orders the landings, and the later one
    rebases. There is no edge, because docs-ci goes ahead of in-flight work.

## Testing Decisions

- **A good test here** asserts what a path classifies as, what a job will run, what the gate decides, or what a guard refuses,
  through the module's or script's public face. It never asserts a helper's internals. No permanent test reads git history,
  because the CI checkout is shallow (the D355 fix 4 / RC5 fix 1 lesson); CI steps that need history fetch it themselves.
  Nothing touches the app, so there are no `device` ACs.
- **Seam 1: the classifier, as a unit.**
  - Covers path and mode in, scope and Gate-input flag out.
  - Cases: every D2–D4 class; non-Markdown under a Policy prefix; symlink, submodule and executable modes; root `*.md`;
    directory-derived Gate inputs; empty and unreadable ranges.
  - For every path in a table, every caller gives the same answer.
  - Prior art: `tests/tooling/ci-change-scope.test.ts`.
- **Seam 2: scan and trace consistency.**
  - The scan runs over the real sources and fails on a scan error. The `doc-policy` list equals its reader output, and the
    slow-trigger set equals what the moved `pwsh` files import or spawn.
  - The trace-check logic is tested on recorded fixtures.
  - Prior art: vmark's `check-rust-filter-inputs`, and `tests/tooling/feature-ledger.test.ts`'s declared-surfaces check.
- **Seam 3: the gate script, the workflows and the guards.**
  - **The gate script's behaviour.** Given a `needs` JSON and scope outputs, it decides pass or fail. Cases cover each job's
    required-and-success, required-and-skipped, not-needed-and-skipped, a failed scope, and a missing output.
  - **The workflow text contract:**
    - every conditional job is in `needs`;
    - `prose-lint`, `master-push`, `slow-nightly` and `rust-windows` are not;
    - `ci.yml` has no push-to-`master` and no `schedule` trigger;
    - the timeouts;
    - the Windows stub;
    - the push workflow's permissions, `fetch-depth` and lack of a concurrency group.
  - **The guards.** The role guard's delegator branch refuses each named spelling and allows the landing command, PR-branch
    `--force-with-lease` and `retro/*`. `delegator-route.sh` refuses dispatch without the role. The landing command refuses
    when a prose Gate input's reader fails. The `pwsh` lint refuses direct and transitive spawns.
  - **The detector**, on fixture commit graphs and stubbed API answers.
  - Prior art: `tests/tooling/adr0146-audit-dimensions.test.ts`, and the workflow-reading tooling tests.
- **Seam 4: the prose-lint scripts.** The links-and-anchors script, on fixture Markdown: a good link, a broken link, a missing
  anchor, a CJK heading anchor, and no network access.
- Each ticket's ACs map onto these four seams. A new seam stops the work and goes to the delegator (rule 12).

## Out of Scope

- **Audit changes.** The 11-02 policy set, the two pinned audit files and the ADR-0121 tiers are untouched (D15).
- **Release changes.** The release workflow and the tag CI matrix are unchanged.
- **Windows installers** on PRs. The promotion of Windows to blocking has its own later entry.
- **Journeys and device runs.** The journey runner on the control channel (RC1 b), and any real-app or device run in CI.
- **Rewriting readers.** Rewriting tests so they stop reading docs; D7 rules on today's readers instead.
- **External links.** Repo-wide spelling and lint over old files.
- **GitHub branch protection** on `master`.
- **ADR-0159.** Its acceptance, and reconciling its d6–d8 with this classifier.
- **#580.**

## Further Notes

- Sources:
  - `docs/reference/20261102-docs-commit-pr-ci-practices.md`;
  - `docs/audit/20261101-vmark-mdpro-架构对比.md`, RC3, RC6, and RC1(c)'s CI half (its `build-windows.yml` half is out of
    scope);
  - the r1 plan review.
- **"Tier" is not used in records**, because it means ADR-0121's audit tier.
- **Gate-sensitive throughout.** Every ticket except T-04 and T-09 changes a landing or CI condition. Each such ticket is High
  tier, and its entry is plan-reviewed by both auditors before it lands.
