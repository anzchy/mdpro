# 0069. Releases bump the patch number only

**Status**: Accepted (2026-10-10). User's words: 「常规发布一律 patch，下次发
0.3.1, 最多0.3.xxx（譬如0.3.100）」.

## Context

The user felt the version had climbed to 0.3.0 too fast. Fifteen tags from
v0.1.2 to v0.3.0 contain two minor bumps: v0.2.0 and v0.3.0, the two-mode
editor. `/bump` already defaulted to `patch`, but accepted `minor` and `major`
with no stated reason, so the minor bumps came from whoever ran it.

The user asked how Codex CLI does it. Codex CLI bumps the minor on most
releases and keeps the patch number for hotfixes, so copying it would move the
number faster, not slower.

`[Unreleased]` in `CHANGELOG.md` holds the whole UI redesign and Markdown
consolidation. Under any minor-on-features rule, the next release would be
0.4.0.

## Decision

1. Every release bumps the patch number: 0.3.0 → 0.3.1 → 0.3.2 → …
2. The minor number stays at 3. The patch number keeps counting past 9:
   0.3.10, 0.3.11, and so on up to 0.3.100 or beyond. SemVer compares each
   field as an integer, so 0.3.10 sorts after 0.3.9. The Tauri updater
   compares versions with the `semver` crate, so it sees the newer release.
3. The next release is **0.3.1**, even though it carries the redesign.
4. `/bump` refuses `minor`, `major` and any explicit version that is not the
   next patch, unless the user names that exact version in the same request.
   A new minor or major line is a new decision and gets its own ADR that
   supersedes this one.

## Consequences

- The version number no longer signals the size of a release. 0.3.1 ships the
  whole redesign, and a reader cannot tell it apart from a one-line fix by
  number alone. `CHANGELOG.md` is the only place that tells them apart.
- SemVer's "0.y.z: anything may change" reading is unchanged. Patch releases
  may still carry breaking changes, e.g. to the preferences format or the MCP
  tools. Nothing in the version warns an MCP client about them.
- Long patch numbers (0.3.57) look unusual to users, and some tooling sorts
  version strings as text, which puts 0.3.10 before 0.3.9. Any script that
  sorts tags must use `sort -V` or `git tag --sort=version:refname`.
- The decision forecloses minor bumps for milestones. Leaving the 0.3 line,
  or reaching 1.0, needs a superseding ADR.
