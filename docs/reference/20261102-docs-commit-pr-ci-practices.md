# Docs commits: PR, CI and which checks — practice survey and mdpro tiers

Date: 2026-11-02. Read-only survey, written for the user's question
「看看vmark, marktext，以及Claude code, codex, Microsoft, Google等关于doc相关的commit最佳实践是什么，一是是否要通过pr提交，二是是否要经过CI，经过CI的话，要做哪些测试，和code 相关的测试维度一样吗」.
Sources were read on this date through `gh api` (repo files at the default branch's HEAD) and WebFetch. A claim
marked **UNVERIFIED** is one I could not confirm from a primary source.

## Summary

- **PR: almost always.** Every project surveyed protects its default branch (`gh api repos/<r>/branches/<b> -q .protected`
  returned `true` for all nine repos checked). Microsoft Learn says so outright: "We use PRs for all changes, even for
  contributors who have write access." vmark goes further, with `enforce_admins: true`. The one direct-push pattern
  found is a **bot**: the Claude Code repo's `CHANGELOG.md` is committed by GitHub Actions with no PR.
- **CI: yes, but reduced for prose.** The mature repos (vmark, VS Code, Codex, GitLab) all run CI on a docs-only PR, and
  skip or shrink the heavy test tiers. They never skip a cheap always-on tier. They decide what counts as prose with
  an **allowlist of paths that no test reads**, never `!**/*.md`.
- **Checks: different dimensions.** Docs get spelling (codespell, Vale), Markdown format and lint (Prettier,
  markdownlint), link and anchor checks, a docs-site build or preview, and TOC/ASCII checks. Code gets unit tests,
  typecheck, coverage and build. The two sets meet only where a Markdown file is an **input to a test**: vmark's Markdown
  corpus, the Markdown under VS Code's `src/`, `test/` and `extensions/`, and mdpro's rules. There the file is treated as
  code.
- **mdpro is unusual in one way.** Many of its "docs" are executable policy: tests and gate tooling read them. Two of
  mdpro's own gates disagree about which docs those are (Finding M2), and the direct docs-only push path can land
  test-read files with no CI at all (Finding M3).

## Comparison

| Source | PR required for docs? | CI on docs-only change? | Docs checks | Same dimensions as code? |
|---|---|---|---|---|
| vmark | Yes; every commit to `main` goes through a PR, admins included | Yes. `fe-static` always runs; test, coverage, build and Rust tiers skip | emdash lint over every `*.md`, keybinding manifest vs `website/guide/shortcuts.md`, website `lint:md` + VitePress build | No. A separate always-on static tier; app tiers are path-filtered off |
| marktext | Yes ("All PRs must pass CI") | Yes, in full: Lint and Test have no docs filter | No docs-specific check in the main CI; the website workflow runs only on `packages/website/**` | Docs PRs run the code checks (ESLint, typecheck, unit tests) |
| Claude Code (anthropics/claude-code) | CHANGELOG: no, a bot pushes it directly. Other changes: merged PRs | Only `mods/**` has CI (`mod-tests.yml`); CHANGELOG and plugin docs have none found | None found | n/a |
| Codex (openai/codex) | Yes; every commit is a `(#NNNNN)` PR, and external PRs are not accepted | Yes. `blocking-ci` runs on every PR; `rust-ci` jobs skip without `codex-rs/` | codespell (repo-wide), Prettier `--check` on `*.md docs/*.md`, README ASCII check, README TOC check | No. Spell and format checks always run; Rust tiers path-gated |
| Microsoft VS Code | Yes (PR workflow `pr.yml`) | Yes. "Compile & Hygiene" always; core test jobs skip if every path is Markdown outside `src/ test/ extensions/` | Hygiene + ESLint on changed files | No. Test jobs skip; hygiene stays |
| Microsoft Learn (MicrosoftDocs) | Yes, "even for contributors who have write access" | Yes. Validation and build, then staging preview | Build validation (warnings/errors posted on the PR), staging preview, author `#sign-off` | No. Content validation and preview, not tests |
| Microsoft TypeScript | Yes (protected) | Yes, full: no `paths` filter in `ci.yml` | None docs-specific (the handbook lives in another repo, **UNVERIFIED** which) | Docs run the code CI |
| Google eng-practices / docguide | Yes. A doc change is a CL and is reviewed | Internal CI **UNVERIFIED** | Reviewer checks that docs are updated; docs ship "in the same CL as the code change" | Review dimension, not test dimension |
| google/go-github | Yes (protected) | Yes, full: `tests.yml` has no paths filter | none docs-specific | Docs run the code CI |
| GitLab (reference) | Yes (MR) | Yes. Docs jobs run for `.md` changes | `docs-lint markdown` (Vale + markdownlint), `docs-lint links`, mermaid, redirects, `docs hugo_build`, `docs code_quality` | No. A dedicated docs job family |
| Kubernetes website (CNCF, not Google-owned) | Yes (OWNERS/Prow approvals; Prow job list **UNVERIFIED**) | Netlify deploy preview builds the Hugo site per PR | Site build and preview | No |

## Findings with citations

### 1. vmark (xiaolai/vmark)

- **PR only, admins included.** `.github/workflows/ci.yml` lines 3–6: "Every commit reaching `main` arrives through a PR
  (branch protection: required checks `frontend` + `rust`, `enforce_admins: true`, and … `strict: true`". CI triggers on
  `pull_request` only (lines 27–29).
  `CONTRIBUTING.md` line 5: "VMark takes issues, not pull requests". External PRs are not merged; the maintainer and its
  AI agents still land through PRs.
- **Prose filter by allowlist.** The `changes` job (from line 437) uses `dorny/paths-filter` with
  `predicate-quantifier: some-with-excludes`. Its `code` output (lines 489–496) is `'**'` minus `README.md`, `AGENTS.md`,
  `CLAUDE.md`, `.claude/**/*.md` and `website/**/*.md`. The comment at lines 480–488 explains why it is not `!**/*.md`:
  50 Markdown files under `src/` are a corpus "that round-trip tests READ at runtime".
- **One tier never skips.** Lines 336–341: "`fe-static` runs on EVERY PR, prose included: it carries the markdown
  gates. It is therefore never legitimately skipped." The comment at lines 129–131 makes the same point.
  `fe-test`, `fe-coverage`, `fe-build` and the other app tiers carry `if: needs.changes.outputs.code == 'true'`.
- **Docs site checked pre-merge.** The `website` job (lines 278–291) runs `lint:md` and the VitePress build when
  `website/**` changes. It was added because a broken site change "passed every required check and failed on main
  (audit 20260906, C7)".
- **The gate fails closed on the filter.** In `ci-gate` (lines 319–335), a skip is trusted only if `changes` succeeded and
  output a usable boolean.
- **Contrast with mdpro.** vmark can exclude `CLAUDE.md` and `.claude/**/*.md` from `code` because its comment says
  nothing in the app tiers reads them. In mdpro, tests do read them.

### 2. marktext (marktext/marktext)

- **PR required.** `.github/CONTRIBUTING.md` lines 31–36: "Submit PRs directly to the `develop` branch … All PRs must
  pass **CI** before they can be merged."
- **No docs reduction.** `lint.yml` (lines 3–9) and `build.yml` ignore only `packages/muya/**`. `test.yml` (lines 3–6) has
  no filter at all. A docs-only PR therefore runs ESLint, typecheck (`lint.yml` 22–26), unit tests (`test.yml` 24–25)
  and installer builds.
- `website-deploy.yml` runs on `packages/website/**` for both PR and push.

### 3. Claude Code (anthropics/claude-code)

- **The public repo is mostly the changelog, issues, plugins and mods.** The product source and the docs site are not in
  it (where docs.claude.com is authored: **UNVERIFIED**).
- **Direct pushes by a bot.** The `CHANGELOG.md` commits `80c6959`, `b3f291d` and `0e1f478` ("chore: Update CHANGELOG.md
  and feed.xml") have 0 associated PRs (`gh api …/commits/<sha>/pulls`). Their author and committer are both
  "GitHub Actions". Other changes land as merged PRs, e.g. `f03f778` "Merge pull request #105303".
- **CI only for executable content.** `.github/workflows/mod-tests.yml` lines 3–7 trigger on `pull_request` with
  `paths: ["mods/**", …]`, then run `tsc` and `claude plugin test` (lines 24–38). No CI covering Markdown was found.

### 4. OpenAI Codex (openai/codex)

- **PRs, internal only.** `docs/contributing.md` line 5: "**We do not accept external code contributions or pull
  requests.**" Every recent commit on `main` carries a `(#NNNNN)` PR number.
- **One required entrypoint for every PR.** `.github/workflows/blocking-ci.yml` lines 5–8 run `on: pull_request: {}`
  with no paths filter. Lines 48–61: the `required` job needs `codespell`, `repo-checks`, `rust-ci`, `sdk` and the others.
- **Rust tiers gate themselves by path.** `rust-ci.yml` lines 38–47 compute `codex=true` only for `codex-rs/*`. The
  `general` job is gated on that at line 64.
- **Docs checks always run.** `codespell.yml` lines 23–26 run on the whole repo. `repo-checks.yml` lines 65–75 run the
  README ASCII check, `readme_toc.py`, `just fmt-check` and `pnpm run format`. Root `package.json` line 6 defines that
  as `prettier --check *.json *.md docs/*.md .github/workflows/*.yml **/*.js`.

### 5. Microsoft

- **VS Code** (`microsoft/vscode`). `.github/workflows/pr.yml` lines 21–25: "Detect Changes (the plan) → the jobs that run
  what the plan selects → PR Gate, which reports their results as a single check".
  `.github/actions/detect-changes/detect.ts` lines 113–116 define documentation as "Markdown outside the sources, tests
  and extensions, which use Markdown files as test inputs". The unit, browser and product test rules may skip on it
  (lines 198–208). `Compile & Hygiene` (pr.yml line 209) has no such rule, and its hygiene + ESLint step (lines 307–308)
  runs on changed files.
  This is the same allowlist idea as vmark: Markdown that tests read is code.
- **Microsoft Learn contributor guide.**
  [how-to-write-quick-edits](https://learn.microsoft.com/en-us/contribute/content/how-to-write-quick-edits): "We use
  PRs for all changes, even for contributors who have write access. Most repositories protect the default branch."
  [process-pull-request](https://learn.microsoft.com/en-us/contribute/content/process-pull-request): "**Validation
  and build**: Automated checks verify whether your changes pass validation tests. The validation tests might yield
  warnings or errors, requiring you to edit one or more files in your PR before it can be merged." A staging preview
  follows, then the author's `#sign-off`, and a reviewer merges. The internal validation rule set (link, metadata,
  Acrolinx and so on) is not published in these pages: **UNVERIFIED** in detail.
- **TypeScript** (`microsoft/TypeScript`). `.github/workflows/ci.yml` lines 3–9 trigger on push, `pull_request` and
  `merge_group`, with no `paths` key: docs changes run the full build.

### 6. Google

- **The style guide is a writing guide only.** The developer documentation style guide
  ([highlights](https://developers.google.com/style/highlights)) covers tone, grammar and formatting, and says nothing
  about review or CI.
- **Docs are reviewed like code, in the same change.** Google eng-practices,
  [What to look for](https://google.github.io/eng-practices/review/reviewer/looking-for.html): reviewers "check to see
  that it also updates associated documentation", and "If documentation is missing, ask for it."
  [docguide best practices](https://google.github.io/styleguide/docguide/best_practices.html): "Change your
  documentation in the same CL as the code change." [Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html):
  "It's usually best to do refactorings in a separate CL from feature changes or bug fixes."
- **Google-internal CI on doc CLs: UNVERIFIED.**
- **google/go-github** (Google-owned OSS). `.github/workflows/tests.yml` lines 5–11 run on push and PR to `master` with
  no paths filter: a docs change runs the Go test matrix.

### 7. Docs-as-code references

- **GitLab.** [docs testing](https://docs.gitlab.com/development/documentation/testing/): "Merge requests containing
  changes to Markdown (`.md`) files run these CI/CD jobs". The jobs are `docs-lint markdown` (Vale, markdownlint),
  `docs-lint links`, `docs-lint mermaid`, `docs-lint redirects`, `docs hugo_build` and `docs code_quality`. The
  pipelines page warns: "Forcing all jobs on docs only related MRs would not have the prerequisite jobs and would lead
  to errors."
- **Kubernetes website.** `netlify.toml` defines a `deploy-preview` build (`make deploy-preview`) for every PR.

## mdpro today

- **CI.** `.github/workflows/ci.yml` runs on `pull_request` and `v*` tags (lines 15–17), and nothing on a push to
  `master`.
  - The `scope` job (line 42) runs `scripts/ci/change-scope.mjs`.
  - `prose-checks` (lines 61–75: ledger check and journeys check) always runs.
  - `frontend` (line 79), `rust-test` (line 137) and `rust-audit` (line 188) run only when `code == 'true'`. `frontend`
    is build, `typecheck:tests`, the `conditional-tests.mjs` lint (line 113) and vitest with coverage (line 121).
  - `ci-gate` (line 203) is the one required check (ADR-0095).
- **The prose list.** `change-scope.mjs` lines 24–37 count `docs/adr|architecture|audit|design|pending|plans|reference|test/`
  and root `AGENTS.md`, `CLAUDE.md` and `progress.md` as prose. `.claude/`, `docs/guide/`, `docs/agents/`, the ledger
  and `CHANGELOG.md` are code.
- **Direct docs-only commits.** Rule 70 § Commits and branches item 2 (line 212): "A docs-only commit that item 4
  leaves unaudited also needs no PR and no CI." Item 4 (lines 229–233) exempts docs-only commits from audit, except
  `docs/agents/audit-dimensions.md` and `audit-policy-set.md`, which need a High-tier PR.
  `scripts/codex-rules/land-guard.mjs --docs-only` enforces that exception (`PROTECTED_AUDIT_FILES`, line 24). Its path
  allowlist, `allowedDocsPath` (line 18), is `docs/**`, `design/**/*.md`, `CHANGELOG.md`, `CLAUDE.md`, `AGENTS.md` and
  `.claude/{rules,agents}/*.md`. The script prints that "PR, CI, verifier PASS and audit verdict are not checked".
- **PR #591 (D355)** touched rules 70/71, AGENTS.md, CLAUDE.md and `docs/agents/**`. It also touched
  `scripts/codex-rules/land-guard.mjs` and about 20 `tests/tooling/*` files, which made it `code=true`. The PR head
  `e3b9b5fe` adds `tests/tooling/always-on-budget.test.ts`, which holds `CLAUDE.md` ≤ 9,000 B, rule 70 ≤ 6,000 B,
  rule 71 ≤ 4,000 B, `AGENTS.md` ≤ 7,000 B and per-route byte caps. The blocker was the D302 lint in the `frontend` job,
  on the PR's **own test code** (fixed by `c12b2b35`), not on prose.

**M1. In mdpro, some docs are code by the industry's own test.** vmark and VS Code skip tests on Markdown only when no
test reads it. In mdpro:
- `tests/tooling/adr0141-wi2-skill-text.test.ts` line 38 reads `AGENTS.md`;
- `tests/tooling/gh586-audit-policy-split.test.ts` line 205 reads `docs/adr/0147-…`;
- at the PR #591 head, `always-on-budget.test.ts` and the `rule-citations` tests read `CLAUDE.md` and the rules.

**M2. The CI prose list contradicts ADR-0095's own consequence.** ADR-0095 says "If a test starts reading a file under a
prose prefix, a prose-only PR could skip the job that would catch a break." That has now happened. A PR that changes
only `CLAUDE.md`, `AGENTS.md` or ADR-0147 is `code=false`, and skips the tests that assert on those files.

**M3. The direct docs-only path is wider than the CI's notion of prose.** `land-guard --docs-only` accepts paths that
`change-scope.mjs` calls code because tests read them: `.claude/rules/*.md`, `docs/guide/`, `docs/agents/**` (except
the two protected files), `docs/feature-ledger.md` and `CHANGELOG.md`. A push to `master` runs no workflow, so such a
commit can break `always-on-budget` or `ledger:check` unseen until the next PR goes red on someone else's change.

## Recommendation for mdpro: three tiers

The principle, from vmark, VS Code, Codex and GitLab: **classify by "does anything executable read this path", not by
file extension.** Then give every tier a cheap always-on check, and keep the heavy tiers for code.

### Tier A — plain prose

*Paths:* `docs/adr/`, `docs/plans/`, `docs/audit/`, `docs/reference/`, `docs/research/`, `docs/test/` records,
`progress.md`, the Q&A file. Each must be a path no test reads; today ADR-0147 fails that (M1).

- **Route:** the delegator's direct docs-only commit stays. It matches the Claude Code changelog pattern, and nobody
  reviews these files as code.
- **CI:** add a `push: branches: [master]` trigger that runs **only** `prose-checks`, as a non-blocking post-hoc signal.
  Optionally add a Markdown link and anchor check (e.g. lychee offline mode, or a small anchor script), since ADRs and
  rules cross-link heavily.
- **Checks:** ledger and journeys checks, links and anchors. **Not** unit tests, typecheck or coverage.
- **Audit:** none (unchanged).
- **Drop:** nothing. **Add:** the master-push prose job.
- **Cost:** about 1 runner-minute per push. A red result arrives after the fact; the delegator fixes it with the next
  docs commit.

### Tier B — agent instructions and gate inputs

*Paths:* `CLAUDE.md`, `AGENTS.md`, `.claude/rules/**`, `.claude/agents/**`, `.claude/skills/**`, `.agents/skills/**/*.md`,
`docs/agents/**`, `docs/guide/`, `docs/feature-ledger.*`, `CHANGELOG.md`, and any path a test or script reads.

- **Route:** **PR required**, as at Microsoft Learn and vmark. Take `CLAUDE.md`, `AGENTS.md` and `.claude/rules|agents`
  out of `land-guard`'s `allowedDocsPath`. Or keep them, and have `--docs-only` first run the doc-reading tests locally
  and refuse on red: cheaper, but weaker.
- **CI:** give `change-scope.mjs` a third answer, `policy`, and move `CLAUDE.md` and `AGENTS.md` out of
  `PROSE_ROOT_FILES`. A `policy` PR runs `prose-checks` plus one `doc-policy` job: `vitest run tests/tooling/<the files
  that read these paths>` (always-on-budget, rule-citations, codex-land-guard-docs, adr0141 skill-text, adr0146
  dimensions, gh586), with no coverage. It **skips** `pnpm build`, `typecheck:tests`, the full vitest-with-coverage run
  and `rust-test`. Those are code dimensions, and prose cannot move them.
  - The list of doc-reading tests must be **derived**, not hand-kept, like vmark's `check-rust-filter-inputs.test.mjs`:
    a tooling test fails when a test reads a Tier-B path that is not in the list.
- **Checks:** byte and line budgets, citation and anchor resolution, required-phrase assertions, ledger and journeys.
  These are *policy* dimensions: closer to code than to prose, but not unit tests, typecheck or coverage.
- **Audit:** keep today's split. A gate-sensitive decision-log entry gets plan review by both auditors (rule 70 item 4).
  The two pinned audit files stay a High-tier PR. Other instruction edits get no code audit. Receipts are needed only
  when the PR changes a test.
- **Drop:** full vitest-with-coverage and rust-test on pure Tier-B PRs (roughly the 7 minutes of ADR-0095's estimate),
  and receipts for prose-only edits. **Add:** the `doc-policy` job, its derived input list, and the PR requirement.
- **Cost:**
  - Every rule tweak becomes a PR, with about 2–3 minutes of CI and delegator handling, where today it is a direct push.
  - The change edits `ci.yml` and `change-scope.mjs`, which is High-tier CI tooling and needs its own audited PR.
  - It changes ADR-0095 decision 2's prose list. Per CLAUDE.md § ADR, CI lane layout is process: a decision-log entry,
    with the ADR-0095 clause folded per ADR-0165 decision 5. Plan review by both auditors applies if it is
    gate-sensitive.

### Tier C — docs PRs carrying code or tests

*Example:* #591, with `land-guard.mjs` and `tests/tooling/**`.

- **Route:** PR and full CI, exactly as today. These PRs are code. VS Code, vmark and Codex all run full CI the moment a
  non-prose path appears.
- **Checks:** the full `frontend` job (build, typecheck, `conditional-tests` lint, vitest with coverage); `rust-test`
  only if `src-tauri/` changed. Receipts for every new test (rule 10), the tiered audit (ADR-0121), and the ADR-0162
  pre-audit `ci-gate`.
- **Add: split the PR.** Following Google's "separate CL" advice, land the gate code and its tests (Tier C, audited)
  first, then the prose trim it measures (Tier B). In #591, the budget test and `rules-budget-lib.ts` are code; the trim
  of rules 70/71 is prose. Split, a lint failure in test code would not have held the prose hostage, and the prose
  revision rounds would not have re-run the full lane.
- **Cost:** two PRs and two landings instead of one, and an ordering dependency. The gate PR must land with the caps set
  so they pass on the current tree, or with a `KNOWN_EXCEPTIONS` entry, which `always-on-budget.test.ts` already
  supports.

### Answer to "same dimensions as code?"

No, except where the doc is an input to code. Prose gets link and anchor checks, spelling, format and a site build.
Agent-instruction docs that tests read get **policy** checks (budgets, citations, required phrases). Only a PR that
carries code or tests gets the code dimensions: unit tests, typecheck, coverage and audits.
