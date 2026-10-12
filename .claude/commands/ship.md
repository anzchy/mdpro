---
description: Full pre-landing pipeline — rebase, test, review, bump, commit, hand off for landing
argument-hint: "[bump-type: patch|minor|major] [optional: pr-title]"
---

# Ship

Automated pre-landing pipeline. Runs rebase → tests → pre-landing review → version bump → commit → handoff to mdpro-delegator, which lands on `master` by `git merge --ff-only` ([ADR-0083](../../docs/adr/0083-master-is-the-single-integration-trunk.md)). Non-interactive except for MINOR/MAJOR bumps and any BLOCK-level findings.

## Context

```text
$ARGUMENTS
```

Default bump type is `patch` unless specified.

---

## Step 1 — Pre-flight Check

```bash
# Confirm we are NOT on master/main
git rev-parse --abbrev-ref HEAD
```

**Stop** if on `master` or `main`. Ship must run from a feature or fix branch.

```bash
# Sync with base: rebase onto local master, never merge it in
git rebase master
```

Resolve simple conflicts automatically (whitespace, lock files). Ask for guidance on logic conflicts.
A merge commit here would make the delegator's `--ff-only` landing impossible.

---

## Step 2 — Run Gates

```bash
pnpm build && pnpm test:run
```

If Rust code changed:
```bash
cargo check --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml
```

**Stop on any failure.** Do not ship failing tests. Fix the issue or escalate.

---

## Step 3 — Pre-Landing Review

Apply the checklist from `.claude/rules/60-review-checklist.md` against the full diff:

```bash
git diff master...HEAD
```

- **BLOCK** findings: Fix immediately, re-run gates, then continue.
- **MUST** findings: Fix if quick (< 10 min); otherwise ask user whether to fix now or file an issue.
- **SHOULD** / **NOTE**: Collect for PR description.

---

## Step 4 — Version Bump

Determine bump type from argument (default: `patch`).

- **patch**: Bug fixes, minor tweaks, dependency updates
- **minor**: New features, new IPC commands, new UI views (ask if not specified)
- **major**: Breaking changes, major rewrites (always ask)

Run the bump command:

```
/bump [patch|minor|major]
```

This updates `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` atomically per rule 40.

---

## Step 5 — Update CHANGELOG.md

Generate a changelog entry from the diff and commit history since the last tag:

```bash
git log $(git describe --tags --abbrev=0)..HEAD --oneline
```

Add an entry under `## [Unreleased]` in `CHANGELOG.md` (or the new version section if releasing):

```markdown
## [X.Y.Z] — YYYY-MM-DD

### Added
- ...

### Fixed
- ...

### Changed
- ...
```

---

## Step 6 — Commit

Stage all changed files. One commit per logical change (or one combined ship commit if all changes are part of the same feature):

```bash
git add <files>
git commit -m "$(cat <<'EOF'
type(scope): summary of changes

- bullet 1
- bullet 2

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

Follow the commit format from CLAUDE.md: `type(scope): summary` with conventional commit types (`feat`, `fix`, `chore`, `docs`, `refactor`, `perf`).

---

## Step 7 — Hand Off for Landing

Do not push and do not open a PR. Send mdpro-delegator a handoff (rule 70 § Commits and branches):

- the branch and the commit SHA, rebased onto the current `master` HEAD;
- the paths the commit touches;
- the lanes that passed on that tree (`pnpm build`, `pnpm test:run`, Rust lanes if run);
- the SHOULD/NOTE findings from Step 3, or "All BLOCK/MUST items resolved".

The delegator verifies it, lands it with `git merge --ff-only <sha>` and pushes `origin master`.
If `master` moved in the meantime, rebase again, re-run the gates and resend.

---

## Step 8 — Sync Docs (if feature changes)

If the change introduces new IPC commands, keyboard shortcuts, or user-facing behaviors:
- Update CLAUDE.md IPC table
- Update `docs/guide/keyboard-shortcuts.md` if shortcuts changed (rule 41)
- Update relevant `docs/guide/*.md` if behavior changed

---

## Escalation Gates (Always Ask)

- **MINOR or MAJOR version bumps** — confirm before bumping
- **BLOCK findings from review** — never ship past a BLOCK without explicit user approval
- **Merge conflicts in logic files** — never auto-resolve logic; ask
- **Diff > 500 lines** — summarize scope and confirm intent before proceeding

---

## What Ship Does NOT Do

- Force push (`git push -f`)
- Skip tests or review
- Ship from `master` / `main`
- Push, open a PR, or land on `master` itself — only the delegator lands, by `--ff-only`
- Auto-resolve logic-level merge conflicts
- Commit without explicit file staging
