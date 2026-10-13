---
name: mdpro-resume
description: Resume every mdpro session paused by /mdpro-pause, and redispatch the delegator's own cancelled subagents. Use when the user says resume / 继续 / 恢复 / "I am back" / "resume all the work of related sessions". Only the delegator runs it.
---

# /mdpro-resume

Undo `/mdpro-pause`. The user's words are the authority; quote them.

## 1. Who resumes

Read `~/.mdpro-redesign/pause-state.json`. Its `sessions` are the ones to
resume. Check them against `ListAgents`: a session that is gone (restarted
under a new alias, or closed) is reported, not messaged; a new interactive
`mdpro-*` session that appeared since the pause gets the message too, since
it may have been started to take over a paused one.

If there is no pause-state file, fall back to the `/mdpro-pause` § 1 roster and
say so in the report.

## 2. The message

Send each session, in one response:

```
RESUME — user's words: 「<quote>」. Continue from where you stopped, in the
order you had: finish the step in flight, redispatch the subagents you
cancelled (same scope, same SHA), then carry on. master is <sha> (<what landed
during the pause, if anything>); rebase only if your next handoff needs it.
Reply with ONE line: <item> · <stage> · <what you are doing now>.
```

Fill in `master` from `git rev-parse --short master` and name any landing that
happened during the pause, so no peer resumes onto a stale parent.

## 3. Your own agents

For every entry in `ownAgents`, dispatch a fresh agent with the same prompt
scope, the same SHA or range, and `model: "opus"` (a verifier or audit cannot be
"resumed"; it reruns from the start on the same inputs). Then delete
`pause-state.json`, or rename it `pause-state.<pausedAt>.done.json` if the
user wants a record.

## 4. Report

One table: session · ack · what it is doing now; then your redispatched
agents; then what still waits on the user (pending AskUserQuestion answers,
rule-25 confirmations). Then go back to normal delegation.
