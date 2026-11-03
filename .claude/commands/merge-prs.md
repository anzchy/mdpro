---
description: Review open PRs and prepare the ready ones for the delegator to land — sequential, with rebase handling
argument-hint: "[#PR ... | --mine | --pattern fix/issue-*]"
---

# Merge PRs

Review open pull requests one at a time, rebase the ones that need it, and hand the ready ones to the delegator.

**Only the delegator lands, by `git merge --ff-only` onto `master`, and pushes `origin master`** ([rule 70 § Commits and
branches](../rules/70-multi-session-coordination.md#commits-and-branches)). This command never merges a PR: no `gh pr
merge`, no squash, no merge commit. Its last step is the hand-off.

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
| Pass | Yes | **Ready** — can go to the delegator |
| Fail | Any | **Blocked** — checks must pass first |
| Pass | Conflict | **Needs rebase** — will rebase onto `origin/master` first |
| Pending | Any | **Waiting** — checks still running |

**Present the table to the user and ask for confirmation before proceeding.**

Options to offer:
- Hand all ready PRs to the delegator (skip blocked/waiting)
- Hand specific PRs by number
- Cancel

## Phase 3: Sequential Preparation

Process PRs one at a time in the order confirmed by the user.

For each PR:

### 3a. Final check

```bash
gh pr view {N} --json mergeable,statusCheckRollup,mergeStateStatus
```

- If checks failed since Phase 2: skip, report, continue to next.
- If conflict detected: attempt rebase (Phase 3b).

### 3b. Rebase if needed

```bash
gh pr checkout {N}
git fetch origin
git rebase origin/master
```

- If rebase succeeds: the delegator alone force-pushes the PR branch, never `master`, a `release/x.y` branch or a tag
  (rule 25's standing exception). Any other session reports the rebased head to the delegator instead.
  ```bash
  git push --force-with-lease=<branch>:<old head>
  ```
  Wait for checks:
  ```bash
  gh pr checks {N} --watch
  ```
- If rebase has conflicts: skip this PR, report conflicts to user, continue to next.

### 3c. Hand to the delegator

Send the delegator the PR number, its head SHA and its green checks. The delegator lands it with
`git merge --ff-only <sha>` and pushes `origin master` (rule 70). Do not merge it here, and do not check out, pull or
merge into `master` in this checkout.

### 3d. Refresh `origin/master`

Before the next PR's rebase, fetch so it rebases onto whatever the delegator has landed:
```bash
git fetch origin
```

### 3e. Report

After each hand-off, log the result. Continue to next PR.

## Phase 4: Summary

After all PRs are processed, display final results:

```
| # | Title | Result |
|---|-------|--------|
| 12 | fix: resolve X | ✅ Ready for delegator |
| 34 | feat: add Y | ❌ Skipped — checks failing |
| 56 | fix: handle Z | ✅ Ready for delegator (rebased) |
```

Also report:
- Number handed to the delegator / skipped / failed
- Any PRs that need manual attention (conflicts, failing checks)

## Error Handling

| Scenario | Action |
|----------|--------|
| No open PRs | Report, STOP |
| Checks failing | Skip PR, report, continue |
| Rebase conflict | Skip PR, report conflict files, continue |
| Hand-off refused (delegator reports a problem) | Report error, continue to next |
| Force-push rejected | Skip PR, report, continue |
| User cancels | STOP immediately, report what was already handed off |

## Safety Rules

1. **Always confirm with user** before handing anything off (an implementor asks through the delegator).
2. **Never hand off PRs with failing checks** — skip and report.
3. **Only the delegator force-pushes**, as `git push --force-with-lease=<branch>:<old head>` on a PR branch, never
   `master`, a `release/x.y` branch or a tag (rule 25), and never a bare `--force`.
4. **Never delete a branch** — branch deletion asks the user (rule 25), and remote branches stay thirty days (ADR-0084).
5. **Sequential only** — never prepare in parallel. Each landing may affect the next PR's mergeability.
6. **No merge here** — only the delegator lands, by `git merge --ff-only` onto `master` (rule 70). `master` takes no
   merge commit.
