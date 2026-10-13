---
name: mdpro-handoff
description: Have every mdpro session write a handoff document (the /handoff format, saved where rule 70 expects it) and collect the paths. Use when the user says handoff / 写 handoff / 交接 / "before I restart" / "rotate the sessions", or when session-size-guard says to rotate. Only the delegator runs it; it also writes its own handoff.
---

# /mdpro-handoff

Every project session, this one included, writes a handoff so a fresh session
can continue from the file alone. Rule 70 § Session rotation names the path and
the facts; `/handoff` (mattpocock-skills) names the shape. Both apply.

## 1. Who writes one

Same roster as `/mdpro-pause` § 1: `ListAgents`, interactive `mdpro-*` sessions
other than yourself, plus the aliases in rule 70's role table. Not dtrack: its
state is the report files on the mini, never a handoff.

## 2. The message

Send each session, in one response:

```
HANDOFF — user's words: 「<quote>」. Write your handoff now, before anything else.
Run `/handoff <your role>: continuing <your current item>`; if the Skill tool
refuses it as user-only, write the document yourself to the same spec:
compact the conversation for a fresh agent, a "suggested skills" section naming
the skills the next session should call, no content that already lives in a
plan, ADR, row, commit or diff (link the path or SHA instead), secrets redacted.
Save it to ~/.mdpro-redesign/handoff/<your ListAgents alias>-<YYYYMMDD-HHMM>.md
(not the OS temp dir /handoff defaults to). It must name, each fact checked
with a command, not from memory:
  - current WI / D item and its stage;
  - branch, its HEAD, whether it is landed on master;
  - uncommitted state, with a patch saved next to the handoff;
  - the next concrete step;
  - ADR and D numbers you hold;
  - open questions and pending messages from other sessions.
Reply with ONE line: the file path (and the patch path if any).
Keep working afterwards unless a PAUSE is in force.
```

## 3. Your own handoff

Write `~/.mdpro-redesign/handoff/mdpro-delegator-<YYYYMMDD-HHMM>.md` the same
way (run `/handoff delegator: <what the next delegator session continues>`; if
refused, write it by hand to the spec above). Add what only the delegator
knows: which peer owns which item, handoffs received but not landed (SHA,
parent, verifier and audit state), numbers reserved, the pending device-brief
list per area, the user's standing decisions quoted, and the ones still
waiting for the user. Verify every SHA with `git merge-base --is-ancestor`.

## 4. Report

List every path, one per session, with *no reply yet* for the ones still
missing (`ReadNotifications` until they arrive). Tell the user the two ways to
rotate (rule 70 § Session rotation, `/clear` in place or a new session) and
that worktrees stay until a landing is confirmed.
