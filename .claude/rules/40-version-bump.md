---
description: Atomic version bumps — keep package.json, tauri.conf.json, and Cargo.toml in lockstep.
paths:
  - "package.json"
  - "src-tauri/Cargo.toml"
  - "src-tauri/tauri.conf.json"
---

# 40 - Version Bump Procedure

When bumping the version number, **all three files must be updated together**.

## Files to Update

| File | Field | Why |
|------|-------|-----|
| `package.json` | `"version"` | Frontend/npm |
| `src-tauri/tauri.conf.json` | `"version"` | macOS bundle (CFBundleShortVersionString) |
| `src-tauri/Cargo.toml` | `version` | Rust binary (`env!("CARGO_PKG_VERSION")`) |

## Why All Three Matter

- macOS About dialog shows version from `tauri.conf.json` and `Cargo.toml`
- If they differ, macOS shows: `Version 0.2.0 (0.3.0)` — confusing
- `mdpro_mcp` binary reports version via `env!("CARGO_PKG_VERSION")` — must match app

## Bump Procedure

Use `/bump` command (`commands/bump.md`) which handles all three files atomically.
Or manually:

1. Update all three files to the same version
2. Verify: `grep '"version"' package.json src-tauri/tauri.conf.json && grep '^version' src-tauri/Cargo.toml`
3. Commit: `git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml`
4. `git commit -m "chore: bump version to vX.Y.Z"`
5. `git tag vX.Y.Z && git push origin master --tags`

## Common Mistakes

- Forgetting `Cargo.toml` (causes dual version in About dialog)
- Running `pnpm tauri build` before updating all three files
- Tagging before committing all three
