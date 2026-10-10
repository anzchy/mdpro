---
description: Atomic version bumps via /bump — keep package.json, tauri.conf.json, and Cargo.toml in lockstep.
paths:
  - "package.json"
  - "src-tauri/Cargo.toml"
  - "src-tauri/tauri.conf.json"
---

# 40 - Version Bump Procedure

**Bump with `/bump`**, which updates `package.json`, `src-tauri/tauri.conf.json`,
and `src-tauri/Cargo.toml` atomically. A hand edit that misses one file ships
mismatched versions.

## Which Number to Bump

**Every release bumps the patch number and nothing else**
([ADR-0069](../../docs/adr/0069-releases-bump-the-patch-number-only.md)):
0.3.0 → 0.3.1 → … → 0.3.9 → 0.3.10 → … → 0.3.100. The minor stays at 3.

- A minor or major bump needs the user to name that exact version, and an ADR
  that supersedes ADR-0069.
- Sort tags with `git tag --sort=version:refname` or `sort -V`. A text sort
  puts 0.3.10 before 0.3.9.

## Why All Three Matter

- macOS About dialog shows version from `tauri.conf.json` and `Cargo.toml`
- If they differ, macOS shows: `Version 0.2.0 (0.3.0)` — confusing
- `mdpro_mcp` (`src-tauri/src/bin/mdpro_mcp.rs`) reports `env!("CARGO_PKG_VERSION")`,
  so a stale `Cargo.toml` makes the MCP server report the old version

## Common Mistakes

- Forgetting `Cargo.toml` (causes dual version in About dialog)
- Running `pnpm tauri build` before updating all three files
- Tagging before committing all three
