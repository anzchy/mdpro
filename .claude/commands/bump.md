---
description: Bump version across all required files, commit, tag, and push
argument-hint: "[version | patch | minor | major]"
---

# Version Bump

Bump the version number across all required files, commit, tag, and push.

## Input

```text
$ARGUMENTS
```

## Phase 1: Determine New Version

Read current version from `package.json`.

Parse `$ARGUMENTS`:

| Input | Action |
|-------|--------|
| `0.5.0` | Use exactly as specified |
| `patch` | Increment patch: `0.2.0` → `0.2.1` |
| `minor` | Increment minor: `0.2.0` → `0.3.0` |
| `major` | Increment major: `0.2.0` → `1.0.0` |
| (empty) | Default to `patch` |

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

## Phase 4: Commit, Tag, Push

```bash
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
git commit -m "chore: bump version to v{version}"
git tag v{version}
git push origin master --tags
```

Report done: `Bumped to v{version}, tagged v{version}, pushed.`
