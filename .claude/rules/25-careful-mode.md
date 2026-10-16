---
description: Always-on guardrails — pause and confirm before rm -rf, force-push, hard reset, git clean, and similar destructive git/filesystem commands.
---

# 25 - Destructive Command Guardrails (Always On)

**Pause and confirm with the user before running any bash command that matches the patterns below**, using `AskUserQuestion` (a session that may not use it asks through the delegator, rule 70, which shows the user the same command and risk). Show the exact command and the risk. Do not proceed until the user explicitly approves.

This rule is **always active** — it is not session-scoped.

## Protected Patterns

| Pattern | Example | Risk |
|---------|---------|------|
| `rm -rf` / `rm -r` / `rm --recursive` | `rm -rf src/` | Recursive delete — unrecoverable |
| `git push --force` / `-f` | `git push -f origin master` | Rewrites published history |
| `git reset --hard` | `git reset --hard HEAD~3` | Destroys uncommitted work |
| `git checkout .` / `git restore .` | `git checkout .` | Discards all local changes |
| `git clean -f` / `-fd` | `git clean -fd` | Removes untracked files permanently |
| `git branch -D` | `git branch -D feature/xyz` | Force-deletes local branch |

## Standing Exception: Re-pushing a PR Branch

The delegator may run `git push --force-with-lease=<branch>:<old head>` on a
pull-request branch without asking, when the new head is a rebase or fix of
the same handoff. It never applies to `master`, a `release/x.y` branch or a tag;
every other force-push still asks (user decision, 2026-10-14:
「Standing force-with-lease (Recommended)」;
[ADR-0095](../../docs/adr/0095-pull-request-ci-is-a-landing-gate.md)).

## Safe Exceptions (No Confirmation Needed)

These common cleanup targets are safe to delete without asking:

- `rm -rf node_modules`
- `rm -rf dist` / `build` / `.next` / `out`
- `rm -rf target` (Rust build artifacts)
- `rm -rf coverage`
- `rm -rf .turbo` / `.vite` / `.cache`
- `rm -rf *.lock` when explicitly reinstalling

## Confirmation Format

**Show the exact command and what could be lost via `AskUserQuestion`, and offer a safer alternative when one exists** (e.g. `git stash` instead of `git checkout .`) — the user can only approve a risk they can see.
