---
name: load-context
description: Load the most recent saved session context
---

# Load Context

Invoke with `/load-context` at the start of a new session to resume previous work.

## Workflow

1. Find the latest `.claude/contexts/*.md` file by timestamp
2. Read and parse all sections
3. Present summary:
   - What was completed
   - What's in progress (with next steps)
   - What's pending
   - Key decisions to remember
4. Ask user: continue current task or pick from pending?
