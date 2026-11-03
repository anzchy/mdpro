---
description: The delegator's own command — review open PRs, rebase the ones that need it, and list the ones ready to land
argument-hint: "[#PR ... | --mine | --pattern fix/issue-*]"
---

# Merge PRs

Review open pull requests one at a time, rebase the ones that need it, and mark the ones ready to land.

**This is the delegator's command alone.** Any other session that is asked to run it stops here, before Phase 1 and
before any `gh` or `git` command, and sends the delegator `$ARGUMENTS` verbatim (the PR numbers, `--mine`,
`--pattern …`, or "(empty)"). It runs nothing else.

**Only the delegator lands, by `git merge --ff-only` onto `master`, and pushes `origin master`** ([rule 70 § Commits and
branches](../rules/70-multi-session-coordination.md#commits-and-branches)). This command never merges a PR: no `gh pr
merge`, no squash, no merge commit. Its last step is the Ready list; landing is the delegator's separate procedure.

## Input

```text
$ARGUMENTS
```

## Phase 1: Discover PRs

Parse `$ARGUMENTS` to determine which PRs to process:

| Input | Scope |
|-------|-------|
| `#12 #34 #56` | Specific PR numbers |
| `--mine` | All open PRs authored by current user |
| `--pattern fix/issue-*` | PRs whose head branch matches the glob |
| (empty) | Same as `--mine` |

Fetch PR details:
```bash
gh pr list --author @me --state open --json number,title,headRefName,statusCheckRollup,reviewDecision,mergeable
```

If no open PRs found: report "No open PRs to process" and STOP.

## Phase 2: Pre-merge Review

For each PR, collect and display a status table:

```
| # | Title | Branch | Checks | Mergeable | Action |
|---|-------|--------|--------|-----------|--------|
| 12 | fix: resolve X (fixes #123) | fix/issue-123-slug | ✅ pass | ✅ yes | Ready |
| 34 | feat: add Y (fixes #456) | feat/issue-456-slug | ❌ fail | ✅ yes | Blocked |
| 56 | fix: handle Z (fixes #789) | fix/issue-789-slug | ✅ pass | ⚠️ conflict | Needs rebase |
```

### Status checks

For each PR:
```bash
gh pr checks {N}
```

### Classification

| Checks | Mergeable | Status |
|--------|-----------|--------|
| Pass | Yes, and up to date with `origin/master` | **Ready** — green on its current head |
| Pass | Yes, but behind `origin/master` | **Needs rebase** — `--ff-only` would refuse it |
| Fail | Any | **Blocked** — checks must pass first |
| Pass | Conflict | **Needs rebase** — will rebase onto `origin/master` first |
| Pending | Any | **Waiting** — checks still running |

**Present the table to the user and ask for confirmation before proceeding.**

Options to offer:
- Prepare all ready PRs (skip blocked/waiting)
- Prepare specific PRs by number
- Cancel

## Phase 3: Sequential Preparation

Process PRs one at a time in the order confirmed by the user.

For each PR:

### 3a. Final check

```bash
git fetch origin
gh pr view {N} --json headRefName,headRefOid,mergeable,mergeStateStatus,statusCheckRollup
git fetch origin <headRefName>
```

Record `<branch>` = `headRefName` and `<S>` = `headRefOid` from that output; every later step uses these two values.

- If checks failed since Phase 2: skip, report, continue to next.
- Rebase (3b) when any of these holds:
  - `mergeable` reports a conflict;
  - `mergeStateStatus` is `BEHIND`;
  - `git merge-base --is-ancestor origin/master <S>` exits non-zero (`origin/master` is not in the PR's history).
- Otherwise skip 3b and go to 3c with `<head>` = `<S>`.

### 3b. Rebase in a throwaway worktree

Never check out the PR in the current checkout: the main checkout stays on `master`. Use a detached worktree under
`/Users/jack/Documents/mac-app/mdpro-wt/` (ADR-0134), named `merge-prs-<N>-<first 7 of S>`. If that path already
exists, skip this PR and report the path: never reuse or delete it.

```bash
git worktree add --detach /Users/jack/Documents/mac-app/mdpro-wt/merge-prs-<N>-<S7> <S>
```

In that worktree, in this order:

1. `git rebase origin/master`. On conflicts: `git rebase --abort`, then go to step 5, and skip this PR with the
   conflicting files in its report.
2. `<S′>` = `git rev-parse HEAD`.
3. `git push --force-with-lease=<branch>:<S> origin HEAD:refs/heads/<branch>`. This is rule 25's standing exception,
   the delegator's alone, on a PR branch, never `master`, a `release/x.y` branch or a tag. If the push is rejected, go
   to step 5, and skip this PR ("Force-push rejected"); there is no poll.
4. Leave the worktree (`cd` back to where you started).
5. `git worktree remove /Users/jack/Documents/mac-app/mdpro-wt/merge-prs-<N>-<S7>`. If it is refused, leave the
   directory, report its path, and ask the user before `--force` or any `rm` (rule 25).

Then wait for GitHub to see the pushed head: run `gh pr view {N} --json headRefOid` every 10 seconds, up to 30 times.
- If it equals `<S′>`: go to 3c with `<head>` = `<S′>`.
- If it is neither `<S>` nor `<S′>` (someone else pushed): stop polling, skip this PR, report "head moved".
- After 30 tries still `<S>`: skip this PR, report "pushed head not seen".

### 3c. Checks on that exact head

```bash
gh pr checks {N} --watch
gh pr view {N} --json headRefOid,statusCheckRollup
```

The PR is **Ready** only when all of these hold:
- the watch exited 0;
- `statusCheckRollup` lists `ci-gate`, completed and passing. An empty list means the checks have not started yet:
  run the watch again, and do not count it as green;
- the `headRefOid` read after the watch still equals `<head>`. If not, skip the PR and report "head moved".

A failing check makes it "Skipped — checks failing". Record each Ready PR with its `<head>` SHA. The delegator lands it
later by its own procedure (rule 70 § Commits and branches: verifier PASS, audit verdict, green `ci-gate` on that SHA,
then `git merge --ff-only <head>`), not from this command.

### 3d. Refresh `origin/master`

Before the next PR:
```bash
git fetch origin
```

### 3e. Report

After each PR, log the result and its SHA. Continue to next PR.

## Phase 4: Summary

After all PRs are processed, display final results:

```
| # | Title | Result |
|---|-------|--------|
| 12 | fix: resolve X | ✅ Ready @ <head> |
| 34 | feat: add Y | ❌ Skipped — checks failing |
| 56 | fix: handle Z | ✅ Ready @ <S′> (rebased) |
```

Also report:
- Number Ready / skipped / failed, with each Ready PR's head SHA
- Any PRs that need manual attention (conflicts, failing checks)

## Error Handling

| Scenario | Action |
|----------|--------|
| No open PRs | Report, STOP |
| Checks failing | Skip PR, report, continue |
| Rebase conflict | Skip PR, report conflict files, continue |
| Pushed head not seen after 30 polls | Skip PR, report, continue |
| Head moved (another push during the run) | Skip PR, report both SHAs, continue |
| Throwaway worktree path already exists | Skip PR, report the path, never reuse or delete it, continue |
| `git worktree remove` refused | Leave the directory, report its path, ask the user before `--force` or any `rm` (rule 25) |
| Force-push rejected | Skip PR, report, continue |
| User cancels | STOP immediately, report what was already marked Ready |

## Safety Rules

1. **The delegator's command alone.** Any other session asked to run it stops before Phase 1 and sends the delegator
   `$ARGUMENTS` verbatim. The delegator confirms with the user before preparing anything.
2. **Never mark a PR Ready without green checks on its current head** — skip and report.
3. **Only the delegator force-pushes**, as `git push --force-with-lease=<branch>:<old head>` on a PR branch, never
   `master`, a `release/x.y` branch or a tag (rule 25), and never a bare `--force`.
4. **Never delete a branch** — branch deletion asks the user (rule 25), and remote branches stay thirty days (ADR-0084).
5. **Sequential only** — never prepare in parallel. Each rebase or landing may affect the next PR's mergeability.
6. **No merge here** — only the delegator lands, by `git merge --ff-only` onto `master` (rule 70). `master` takes no
   merge commit.
