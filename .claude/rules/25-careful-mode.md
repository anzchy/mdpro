---
description: Always-on guardrails — pause and confirm before rm -rf, force-push, hard reset, DROP TABLE, and similar destructive commands.
---

# 25 - Destructive Command Guardrails (Always On)

Before running any bash command that matches the patterns below, **pause and confirm with the user** using `AskUserQuestion`. Show the exact command and the risk. Do not proceed until the user explicitly approves.

This rule is **always active** — it is not session-scoped and cannot be disabled by the user mid-conversation.

## Protected Patterns

| Pattern | Example | Risk |
|---------|---------|------|
| `rm -rf` / `rm -r` / `rm --recursive` | `rm -rf src/` | Recursive delete — unrecoverable |
| `git push --force` / `-f` | `git push -f origin master` | Rewrites published history |
| `git reset --hard` | `git reset --hard HEAD~3` | Destroys uncommitted work |
| `git checkout .` / `git restore .` | `git checkout .` | Discards all local changes |
| `git clean -f` / `-fd` | `git clean -fd` | Removes untracked files permanently |
| `git branch -D` | `git branch -D feature/xyz` | Force-deletes local branch |
| `DROP TABLE` / `DROP DATABASE` | `DROP TABLE documents;` | Data loss |
| `TRUNCATE` | `TRUNCATE preferences;` | Data loss |
| `kubectl delete` | `kubectl delete deployment` | Production impact |
| `docker rm -f` / `docker system prune` | `docker system prune -a` | Container/image loss |

## Safe Exceptions (No Confirmation Needed)

These common cleanup targets are safe to delete without asking:

- `rm -rf node_modules`
- `rm -rf dist` / `build` / `.next` / `out`
- `rm -rf target` (Rust build artifacts)
- `rm -rf coverage`
- `rm -rf .turbo` / `.vite` / `.cache`
- `rm -rf *.lock` when explicitly reinstalling

## Confirmation Format

When a protected command is detected, say:

> **⚠️ Destructive operation detected**
> Command: `<exact command>`
> Risk: `<what could be lost>`
> Proceed? (yes / no / alternative)

Offer a safer alternative when one exists (e.g., `git stash` instead of `git checkout .`).
