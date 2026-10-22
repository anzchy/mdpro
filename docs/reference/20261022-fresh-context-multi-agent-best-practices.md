# Fresh context in multi-agent coding: what the vendors say (2026-10-22)

Evidence for [ADR-0131](../adr/0131-every-audit-request-and-every-fix-round-starts-from-a-fresh-context.md).
An Opus research subagent of herdr-delegator gathered it on 2026-10-22, at the user's request:
「同时用subagent 查看codex, claude code dev相关multi agents相关最佳实践，看看这个ADR的决定符合最佳实践吗」.
It read the pages with gstack `/browse`. Quotes are as it returned them and have not been re-checked
since.

| ADR point | Verdict | Source and quote |
|---|---|---|
| 1. Implementor: one session per item, a new session per fix round | PARTLY | Codex best practices (learn.chatgpt.com/guides/best-practices): "Keep one chat per coherent unit of work"; "If the work is still part of the same problem, staying in the same chat is often better because it preserves the reasoning trail." Claude Code best practices (code.claude.com/docs/en/best-practices): "If you've corrected Claude more than twice on the same issue… the context is cluttered with failed approaches. Run /clear." No vendor gives a percentage threshold. HumanLayer (humanlayer.com/blog/advanced-context-engineering) recommends "keeping utilization in the 40%-60% range". |
| 2. gpt-auditor: `/new` before every request | ALIGNED | Claude Code best practices: "A fresh context improves code review since Claude won't be biased toward code it just wrote." The research subagent also attributed to that page a warning that a reviewer asked to find gaps "will usually report some, even when the work is sound"; gpt-auditor could not find it on the OpenAI pages, and it is unverified. Codex slash commands (developers.openai.com/codex/cli/slash-commands): `/new` will "Reset the chat context without leaving the CLI". |
| 3. Fable: a fresh subagent per request | ALIGNED, with one trap | Subagents (code.claude.com/docs/en/sub-agents): "Each subagent runs in its own context window", but "A fork inherits everything the main session has at the moment it spawns." Multi-agent research system (anthropic.com/engineering/multi-agent-research-system): multi-agent systems "use about 15× more tokens than chats." |
| 4. Delegator: one session, rotated by handoff | ALIGNED | Effective context engineering (anthropic.com/engineering/effective-context-engineering-for-ai-agents): compaction is "the first lever", and "overly aggressive compaction can result in the loss of subtle but critical context." Cognition (cognition.ai/blog/dont-build-multi-agents): "Share context, and share full agent traces". The delegator is the agent that holds the full context. |

**Amendments it proposed, all taken into revision 2 of the ADR:**
1. A narrow first fix round stays in the same session while usage is under about 50 %. A fresh session starts above 50 %, and from round two on.
2. A confirm or challenge request carries the counter-proof text itself. (Its proposed narrowing to "open findings and correctness" was dropped in revision 3: ADR-0121 decision 4 keeps every introduced High in scope.)
3. The Fable auditor is a named, non-fork subagent, and it is never resumed across rounds.
4. The delegator compacts on purpose, with `/compact <instructions>`, before it reaches the rotation count.

**Not verified:**
- There is no published threshold for when to compact and when to start fresh.
- Whether `/new` sent through `herdr agent prompt` really resets a Codex pane.
- How strongly a reviewer anchors on its own earlier finding.
