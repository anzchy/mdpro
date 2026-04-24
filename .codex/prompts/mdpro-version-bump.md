---
description: Bump mdpro version across package, Tauri config, and Cargo manifest.
argument-hint: "[version | patch | minor | major]"
---

# mdpro Version Bump

Read current version from `package.json`.

Parse input:

| Input | Action |
| --- | --- |
| `0.5.0` | Use exactly |
| `patch` | Increment patch |
| `minor` | Increment minor |
| `major` | Increment major |
| empty | Default to patch |

Before editing, show:

```text
Current: OLD -> New: NEW
```

Update all three files:

| File | Field |
| --- | --- |
| `package.json` | `"version"` |
| `src-tauri/tauri.conf.json` | `"version"` |
| `src-tauri/Cargo.toml` | `version` |

Verify:

```bash
grep '"version"' package.json src-tauri/tauri.conf.json
grep '^version' src-tauri/Cargo.toml
```

Only commit, tag, or push if the user explicitly asked for those actions.

