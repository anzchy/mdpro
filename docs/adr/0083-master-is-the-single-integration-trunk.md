# 0083. `master` is the single integration trunk; releases are tags on it, hotfixes get a `release/x.y` branch

**Status**: Accepted (2026-10-12). User's words: 「选 B」, after reading
[`docs/plans/20261012-plan-branch-consolidation-after-031.md`](../plans/20261012-plan-branch-consolidation-after-031.md)
with its two independent reviews (appendix A, a survey of branching practice at
Google, Microsoft, Amazon, OpenAI, Anthropic and GitHub; appendix B, a Codex
plan review, thread `01a12e34-1aee-7e21-ba49-6d1ebb31dcfa`). Decided by the user,
recorded by mdpro-delegator. Supersedes the standing rule "never commit to
`master`" in `CLAUDE.md` and rule 70 for the delegator's fast-forward landings
only; every other clause of those rules stands.
**Partially superseded** (2026-10-12): the one-week deletion of the old branch in Decision 4 and the release-branch deletion timing in Decision 3 by [ADR-0084](0084-remote-branches-are-kept-thirty-days-after-their-work-lands.md) (thirty days after the work lands).

## Context

mdpro's integration branch `frontend-backend-redesign` was created for the UI
redesign × Markdown consolidation effort (`docs/plans/20260912-frontend-backend-sequencing-order.md`)
and has carried every landing since: 500+ commits, 176 D items, five AI-agent
sessions coordinated by a delegator (rule 70). `master` was advanced only at
release time: on 2026-10-11 it was fast-forwarded to `c8bd2b6` and v0.3.1 was
built from that SHA ([ADR-0073](0073-release-workflow-auto-publishes-only-after-verifying-the-uploaded-draft.md)).
On 2026-10-12, one day after the release, the branch is 58 commits ahead of
`master` again, 57 of them not yet on `origin`.

The question the user raised was how to consolidate after 0.3.1 and what to
develop on next. Facts established while answering it:

- `master` is an ancestor of the branch; a fast-forward is always possible as
  long as nobody commits to `master` by another route.
- GitHub enforces nothing on `master` except "no force push, no delete"
  (`gh api repos/anzchy/mdpro/branches/master/protection`, 2026-10-12): no
  required reviews, no required checks, no linear history. The "master only via
  PR" wording in `ci.yml` is a comment, not a rule, and `c8bd2b6` itself
  reached `master` by a direct fast-forward push.
- `.claude/hooks/role-guard.sh` already lists `master` and
  `frontend-backend-redesign` in the same `PROTECTED` set, so the integration
  branch and `master` have identical local protection. The hook binds
  implementors and the device tester only; the delegator and unset roles are
  not checked.
- `release.yml` builds from an explicit `-f ref=<sha>`; the updater reads
  `latest.json` from GitHub Releases; neither reads a branch name.
- The branch name is written into eight files (about 25 occurrences:
  `CLAUDE.md`, rule 70, `role-guard.sh`, the landing-verifier agent, two
  skills, the sequencing doc, a guide). Each new integration branch would mean
  editing them all again.
- The sequencing doc, every ADR, every device-check record and the tdd-guardian
  receipts cite commit SHAs. Any promotion that rewrites history (GitHub
  "Rebase and merge", squash) orphans those citations.
- `/bump` pushes `master --tags`; `fix-issue` branches from `master`; the release
  runbook dispatches `release.yml --ref master`, which reads the workflow file
  from `master`.

## Options considered

**A. A permanent `develop` branch, `master` fast-forwarded to the release tag at
each release** (OneFlow's develop+master variant; the plan's original
recommendation, and the survey's). Keeps the meaning "`master` = latest
release". Lost because it is a second permanent name for one history: every
tool that targets the default branch has to be pointed at `develop`, `/bump`,
`fix-issue` and the runbook all change, CI would run on two branches, the
workflow file read from `master` can lag the source on `develop`, and a hotfix
still needs a `release/x.y` branch because `develop` already holds unreleased
work. Only one published source recommends the pattern; every large
organisation surveyed develops on its default branch. The condition under
which A wins, "`master` must mean latest release to something external", does
not hold: the updater and the release workflow read SHAs and tags, not
branches.

**B. `master` is the trunk; `v*` tags mark releases; `release/x.y` only for
hotfixes** (chosen). One permanent branch; the existing `--ff-only` landing
process moves over unchanged; `/bump`, `fix-issue` and `--ref master` need no
change; the local protection model is already in place. Matches Google,
Microsoft (release flow), Amazon, VS Code, TypeScript, OpenAI and Anthropic.

**C. A development branch per release (`redesign-0.3.2`, …)**. Lost: no source
recommends it; it recreates a long-lived divergent branch every cycle and
re-edits the 25 branch-name sites each time. TypeScript's `release-N.N` branches
look similar but are stabilisation branches cut from `main`, not where
development happens.

**D. Codex's minimal cut: create `develop` now, leave `master` at v0.3.1, decide
the long-term model later.** Lost as a destination (it is A deferred), but its
sequencing insight is adopted: the migration commit, not the cut-over
snapshot, is the baseline every session takes.

**E. Promote through GitHub pull requests.** Lost: GitHub's PR UI has no
fast-forward merge. "Merge commit" keeps the cited SHAs reachable but makes the
tip a merge SHA that CI never built and forces a merge-back each release;
"Rebase and merge" and "Squash" rewrite SHAs. A direct `--ff-only` push is the
only promotion that keeps every citation valid, and it is permitted today.

## Decision

1. **`master` is the only permanent branch.** Every work item is done on a
   short-lived branch in its own worktree, created from `master`
   (`git worktree add ../mdpro-wt/<dir> -b <branch> master`), rebased onto
   `master` before handoff, verified by `mdpro-landing-verifier`, and landed by
   mdpro-delegator with `git merge --ff-only <sha>` followed by
   `git push origin master`. Nobody lands by merge commit, and the only
   direct commits on `master` are the delegator's docs-only ones (device-check
   records, sequencing-row SHA fills, the release-freeze paragraph), pushed at
   once, as they were on the old branch. The "never commit to `master`" rule
   in `CLAUDE.md` and rule 70 is rewritten to exactly that.
2. **A release is a locked SHA on `master` plus a `v*` tag.** The runbook stays
   as in ADR-0073: lock the SHA in the sequencing doc, device regression on
   it, `gh workflow run release.yml --ref master -f ref=<sha> …`. The step
   "fast-forward the integration branch into `master` first" disappears.
   `master` keeps moving while a release is in flight; the release reads only
   the locked SHA.
3. **A hotfix to a released version gets `release/x.y`, cut from the tag, only
   when needed.** The fix lands on `master` first (upstream first) and is
   `cherry-pick -x`ed onto the release branch, which gets its own `/bump` and
   tag and runs the full lanes once. Release branches never merge back and are
   deleted (rule 25) once the next minor ships.
4. **Migration.** The verified tip of `frontend-backend-redesign` becomes
   `master` by one user-run fast-forward. The delegator then lands one
   migration commit **C** on `master` that renames every branch reference,
   changes `role-guard.sh`'s `PROTECTED` set (old name kept one week,
   `release/*` added), adds the hook regression test, rewrites the rule text,
   and accepts this record. Every
   session takes C, not the pre-migration tip, as its baseline, and the mini's
   main checkout switches only after C is on `origin`. The old branch is tagged
   `archive/frontend-backend-redesign` and deleted after one week with the
   user's confirmation.
5. **Rule 70's landing protocol is unchanged** apart from the branch name: one
   full lane run per commit, tree-identity acceptance, first-arrived lands and
   the other rebases once, the landing verifier before every `--ff-only`.

## Consequences

- **`master` carries unreleased work.** Anyone who clones `master` expecting the
  released product gets a development snapshot. README and release notes
  point at GitHub Releases, and `latest.json` is unaffected, but the
  expectation "`master` is stable" is gone.
- **Direct pushes to `master` run no GitHub CI.** `ci.yml` tests pull requests
  only. The gate is local (rule 10 lanes, the landing verifier) exactly as it
  was for `frontend-backend-redesign`, so nothing is lost relative to today,
  but Linux-side differences surface only in PRs and release builds (`ci.yml`
  already runs on every `v*` tag). The user kept it that way on 2026-10-12
  (「每次推master就跑太频繁了，这个有待讨论」); a daily `schedule` run on
  `master` is the option if a Linux canary is wanted later. Turning on
  GitHub's linear-history rule would mechanically forbid merge commits and
  is left as an option.
- **`origin/master` is pushed after every landing** (user decision 2026-10-12,
  「落地即推」). The six-month rule "never push to `origin` unless the user
  asks" is replaced for the delegator's `master` pushes only; the 57-commit
  backlog that existed on 2026-10-12 cannot recur.
- **The audit-fix bot is dormant** (`cc-audit-fix.yml`: manual trigger only,
  its last five runs failed, the repository's last pull request predates the
  redesign). Its prompt now says it never merges on GitHub; if it is revived,
  its branch is a handoff the delegator rebases and lands by fast-forward.
- **A long-standing rule is reversed.** "Never commit to `master`" was in force
  for six months. Two slips become possible: an implementor committing on
  `master` (blocked by `role-guard.sh`, now with a test) and the delegator
  landing by merge instead of fast-forward (rule text; optionally linear
  history on GitHub).
- **Two names coexist for one week.** `frontend-backend-redesign` stays
  protected and frozen; nothing lands on it. Its deletion is a rule-25 action.
- **Every future integration branch question is closed.** There is no next
  rename; the 25 branch-name sites are edited once, to `master`.
- **Accepted ADRs that name `frontend-backend-redesign` are not edited**
  (immutability). They describe where work landed at the time; this record is
  the forward link.
