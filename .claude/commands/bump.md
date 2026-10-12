---
description: Bump version across all required files, commit, and hand off for landing and tagging
argument-hint: "[version | patch | minor | major]"
---

# Version Bump

Bump the version number across all required files and commit it on a `chore/` branch; the delegator lands, tags and pushes.

## Input

```text
$ARGUMENTS
```

## Phase 1: Determine New Version

Read current version from `package.json`.

Parse `$ARGUMENTS`:

Releases bump the patch number only
([ADR-0069](../../docs/adr/0069-releases-bump-the-patch-number-only.md)).

| Input | Action |
|-------|--------|
| (empty) or `patch` | Increment patch: `0.3.9` → `0.3.10` (integer, never roll over to `0.4.0`) |
| `minor` / `major` | **Stop.** Tell the user ADR-0069 forbids it, and ask them to name the exact version and confirm a superseding ADR |
| An explicit version | Accept it only if it is the next patch. Any other version: same as `minor` / `major` |

Display: `Current: {old} → New: {new}` and ask user to confirm.

## Phase 2: Update All 3 Files

| File | Field |
|------|-------|
| `package.json` | `"version"` |
| `src-tauri/tauri.conf.json` | `"version"` |
| `src-tauri/Cargo.toml` | `version` |

Use the Edit tool for each file — not sed.

## Phase 3: Verify

Read back all 3 files and confirm the version matches:

```bash
grep '"version"' package.json src-tauri/tauri.conf.json
grep '^version' src-tauri/Cargo.toml
```

If any mismatch: fix before proceeding.

## Phase 4: Commit, Hand Off, Tag

Run this on a `chore/bump-v{version}` branch in its own worktree under `../mdpro-wt/`, never
on `master` ([ADR-0083](../../docs/adr/0083-master-is-the-single-integration-trunk.md)):

```bash
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
git commit -m "chore: bump version to v{version}"
```

Hand the commit SHA to mdpro-delegator, which lands it on `master` with
`git merge --ff-only` and pushes `origin master` (rule 70). The tag goes on the landed
`master` SHA, and the push is the delegator's:

```bash
git tag v{version} <landed-sha>
git push origin v{version}
```

Report done: `Bumped to v{version} at <sha>; handed off for landing and tagging.`
