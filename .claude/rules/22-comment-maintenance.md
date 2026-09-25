---
description: Keep `Purpose:` headers and Rust `//!` module docs in sync when modifying documented files.
---

# 22 - Comment Maintenance

**When you modify code in a file with AI-maintenance doc comments, update those comments in the same change** — a comment that describes old behaviour misleads the next reader worse than no comment.

## What Counts as a Documented File

Files with a `Purpose:` line in their header block, or Rust files with `//!` module docs.

## When to Update Comments

| Change Type | Action Required |
|-------------|-----------------|
| Change function behavior | Update its TSDoc / `///` doc |
| Add/remove/rename exports | Add/remove/update their docs |
| Change what a file coordinates with | Update `@coordinates-with` lines |
| Change data flow or pipeline | Update `Pipeline:` in header |
| Change a design decision | Update `Key decisions:` in header |
| Rename a file | Update `@module` path and any `@coordinates-with` references in other files |

## When NOT to Update Comments

- Drive-by comment updates in files you didn't modify — don't touch unrelated files
- Whitespace-only or import-order changes — no doc change needed
- Test file changes — test files don't have maintenance comments

## Comment Rot Prevention

**Fix a stale comment you notice while editing, in the same commit** — a later cleanup pass rarely happens.

## Quick Check

Before committing, scan your changed files for `Purpose:` headers and verify they still accurately describe what the file does.
