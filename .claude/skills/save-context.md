---
name: save-context
description: Save current session context before context compaction
---

# Save Context

Invoke with `/save-context` when context is getting long and you want to preserve state.

## When to use

- Context usage is above 80%
- Before switching to a different task
- At natural stopping points

## What to save

Write a markdown file to `.claude/contexts/YYYY-MM-DD_HH-MM-SS.md`:

### Required sections

1. **Session Metadata** — date, branch, context usage %
2. **Completed Tasks** — what was done this session
3. **In-Progress Tasks** — current work with status
4. **Pending Tasks** — what's left to do
5. **Key Decisions** — architectural/design choices made
6. **Modified Files** — list of files changed (from `git status`)
7. **Resume Instructions** — clear steps for the next session:
   - What to read first
   - What commands to run
   - Where to pick up
