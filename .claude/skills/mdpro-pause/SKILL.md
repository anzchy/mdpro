---
name: mdpro-pause
description: Pause every mdpro session at once — the peers listed in rule 70 (implementors, auditor, device harness) and this session's own background subagents. Use whenever the user says pause / 暂停 / 停一下 / 先停 / "all work paused" / "pause subagents across all sessions", with or without a reason. Only the delegator runs it; a peer that receives it relays the request to mdpro-delegator instead.
---

# /mdpro-pause

Stop all project work until the user says resume. The user's words are the
authority: quote them in every message you send, never paraphrase them into an
instruction of your own.

## 1. Who gets paused

Run `ListAgents`. A **project session** is an interactive row (not `Remote
Control · offline`) whose name is either

- `mdpro-*` other than yourself (`mdpro-delegator`), or
- an alias in the role table of `.claude/rules/70-multi-session-coordination.md`
  (today `adr047-verify`; read the file, the aliases change).

Unrelated sessions on the machine (`polish-transcripts-*`, `open-dedao-*`,
`jack-expense-monitor-*`, …) are not touched. **dtrack on the Mac mini is never
messaged, killed or restarted**: if a device run is in progress, let it finish
and record that it was left running.

## 2. Your own subagents first

For every background agent of yours that is still running (verifier, audit,
registrar, forks), call `TaskStop` and note its task id, what it was doing and
the SHA or range it was on, so `/mdpro-resume` can redispatch it. A finished
agent needs nothing.

## 3. One message per session

Send each project session, in one response, this message with the user's words
filled in:

```
PAUSE — user's words: 「<quote>」. Finish the tool call in flight, then stop:
no new step, no commit, no handoff, no lane run, no message to other peers.
Cancel your own running subagents (TaskStop) and note what they were on.
Leave worktrees, branches and uncommitted files exactly as they are.
Reply with ONE line: <item> · <stage> · <where you stopped> · <subagents cancelled: n>.
Resume only on a message from mdpro-delegator that quotes the user.
```

Do not ask the peers to write handoffs; that is `/mdpro-handoff`, and the user
asks for it separately.

## 4. Record the pause

Write `~/.mdpro-redesign/pause-state.json`:

```json
{ "pausedAt": "<ISO>", "userWords": "<quote>",
  "sessions": { "<name>": { "msgId": "…", "ack": null } },
  "ownAgents": [ { "taskId": "…", "what": "…", "sha": "…" } ] }
```

Fill `ack` with each one-line reply as it arrives (`ReadNotifications`). A
session that has not replied within a few minutes is listed as *no ack yet*,
not assumed paused.

## 5. Report

One table to the user: session · ack (or *no ack yet*) · where it stopped; then
your own cancelled agents; then anything left running on purpose (dtrack). Then
stop working yourself: no landings, no docs commits, no device briefs, until
`/mdpro-resume`.
