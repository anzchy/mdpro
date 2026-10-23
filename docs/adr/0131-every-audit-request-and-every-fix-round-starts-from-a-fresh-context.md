# 0131. Every audit request and every fix round starts from a fresh context

## Status

Partially superseded: the clause making the second half a fresh subagent per request by [ADR-0137](0137-the-second-auditor-runs-on-opus-as-the-opus-auditor-pane.md) (2026-10-23).

Partially superseded 2026-10-22 by [ADR-0133](0133-a-third-codex-implementor-takes-low-tier-items-and-every-codex-agent-runs-with-a-context-cap.md): decision 1 points 4 (the 50 % condition), 5, 6 and 7; decision 2 steps 2 and 3 (the in-pane `/new` and the session-id check, so step 1's session-id record is dropped); decision 7's fallback becomes the rule. Every reset is a new pane with explicit launch flags and a 250k compaction cap.

Accepted, 2026-10-22. Decided by the user, recorded by herdr-delegator. The user's words: 「Accept (Recommended)」. That answer was given on a question that stated the ADR-0121 escape replay result, "insufficient evidence" (zero escapes), so it is also the user's decision without recall numbers.

Proposed 2026-10-22 by herdr-delegator. The user had asked how the long-running implementors and
auditors should get a fresh context: through subagents, or with `/clear` before each task. On the
recommendation, the user said 「好，起草 ADR」.

- **Revision 2**, the same day, takes the amendments from a check against vendor guidance. The user
  asked for that check: 「同时用subagent 查看codex, claude code dev相关multi agents相关最佳实践，看看这个ADR的决定符合最佳实践吗」.
- **Revision 3** follows the first review: gpt-auditor C0 H1 M4 L1, Opus C0 H1 M9 L4. The two
  reviewers raised the same two issues, and each rated a different one High:
  - the confirm scope against ADR-0121 decision 4;
  - the Fable agent's read barrier.
- **Revision 3.1** closes the two Mediums the round-two confirms left open: gpt-auditor
  C0 H0 M2 L0, Opus C0 H0 M1 L3. They were the Enter key after `/new`, and context left versus
  context used.

**Scope: under herdr only**, like ADR-0124. When rule 71 does not apply, rule 70 stands unchanged.
That includes its `/cc-suite:continue` challenges.

On acceptance, this ADR changes three earlier ADRs:
- [ADR-0124](0124-two-implementation-slots-and-a-herdr-mixed-model-roster-overlays-rule-70.md):
  it partially supersedes decision 3's clause "fable-auditor (a Fable session …)". It extends
  decision 4 with the conversation that each Codex request runs in.
- [ADR-0115](0115-every-pre-landing-audit-runs-twice-codex-and-fable-on-the-same-dimensions.md):
  its clause "Fable as a subagent of the delegator", which ADR-0124 superseded under herdr, is
  restored for PR audits.
- [ADR-0121](0121-audit-effort-follows-risk-pre-existing-findings-do-not-block-and-auditors-are-measured.md):
  nothing in it is superseded. Decision 4's confirm scope is kept as written. The escape replay
  required by its decision on auditor changes is recorded under Consequences.

Each of these ADRs gets a forward link in its Status line.

## Context

Under rule 71, every role except the device tester is a long-lived conversation:
- **gpt-imple-1 and gpt-imple-2** get a new Codex session per item. That session carries the item's
  amendments and every audit fix round.
- **gpt-auditor** works in one Codex pane, w5:p2. Every PR audit, confirm, challenge, ADR review and
  plan review runs in it.
- **fable-auditor** is one Claude Fable session across every PR it audits.

Three things went wrong between 2026-10-20 and 2026-10-22:
- **Anchoring.** On ADR128 (PR #522), gpt-auditor held finding A at High in round three, as in round
  one. It did not answer the counter-proof Fable gave in round two, that no gate consumes the lint
  until AC-9. The merged verdict had to settle it.
- **Size.** fable-auditor reached 9 compactions and a 25 MiB transcript. That size is rule 70's
  strong rotation level. It was rotated on 2026-10-22 from
  `~/.mdpro-redesign/handoff/fable-auditor-20261022-1130.md`.
- **Blindness.** A session that has run confirms and challenges has had the other auditor's
  findings forwarded to it, and it still holds them at its next first round. ADR-0124 decision 6
  requires round one to be blind, and only a reset makes that true.

Nothing has to live in a conversation thread. Every exchange is already a file:
- the brief and its amendments;
- the handoff;
- the round reports;
- the merged verdict;
- the challenge requests.

Facts checked on 2026-10-22:
- **Codex.** Codex CLI 0.163.0 has `/new` ("start a new chat during a conversation").
- **herdr.** `herdr agent get` reports the pane's Codex session id (`agent_session.value`).
  `herdr agent send-keys` and `herdr pane send-text` send input without starting a `--wait`.
- **Fable agent definition.** `.claude/agents/mdpro-fable-auditor.md` is read-only and has no Write
  tool. Its opening bars it from reading the Codex result and any audit report file in `audit`,
  `confirm` and `plan` mode. Yet its `confirm` input lists the findings of both auditors' earlier
  rounds. Both reviewers found this contradiction.
- **Escapes.** `docs/audit/escapes.md` has no rows.

Vendor guidance supports the direction: a fresh reviewer context, and isolated non-fork subagents.
It leaves the thresholds to local judgment. The evidence is in
[`docs/reference/20261022-fresh-context-multi-agent-best-practices.md`](../reference/20261022-fresh-context-multi-agent-best-practices.md).
Its quotes were gathered once and have not been re-checked since.

## Options considered

1. **Keep the long-lived sessions, and rotate them on the size hook.** This option lost.
   - Rotation comes only at 5 or 10 compactions, after the anchoring and the leakage have already
     happened.
   - It does nothing for either problem.
2. **`/clear` everyone before every task, implementors included.** This option lost.
   - An implementor inside an item needs what it learned there: which test failed and why, and
     which approach it dropped.
   - OpenAI's guidance is one chat per coherent unit of work.
3. **A subagent for everyone.** This option lost.
   - Codex agents are herdr panes. The delegator cannot dispatch a Codex subagent and keep herdr's
     `--wait` wake-up and pane state, and rule 71 is built on both.
4. **Reset per request where independence matters, and keep context where continuity matters
   (chosen).**
   - Auditors are reset for every request.
   - An implementor keeps its context inside one item, and through a narrow first fix.

## Decision

### 1. Implementors

1. **Sessions.** One fresh Codex session per item. That is unchanged.
2. **Amendments.** That session carries the item's amendments up to its first handoff.
3. **Fix numbering.** Fixes are numbered by the ADR-0120 audit round they answer:
   - **fix 1** answers round one, the blind audit;
   - **fix 2** answers round two, the first confirm;
   - a **post-cap fix** (ADR-0129) is any fix after round three.
4. **Fix 1 stays in the item's session only when both of these hold:**
   - the fix brief names one or two findings, each with its regression test;
   - the session's context is under about 50 %.

   **Every other fix starts a new session.** That covers every fix 2 and every post-cap fix,
   because by then the old context holds an approach that was already corrected. The new session
   starts from only these files:
   - the brief;
   - the last handoff;
   - the merged verdict;
   - the fix brief.
5. **Measuring context.** The delegator reads the Codex status line's "context left" with
   `herdr agent read <name> --source recent-unwrapped`. The thresholds here are context *used*,
   which is 100 % minus context left: "under about 50 %" means at least 50 % left, and "past
   about 60 %" means under 40 % left.
   - It reads it before granting fix 1 in place.
   - It reads it at each wake, for the restart test in point 7.
6. **How a new session starts.** The delegator resets the pane in the same worktree, as in
   decision 2. If that reset fails, it opens a new pane as in rule 71 § Restart.
7. **Restart at 60 %.** A session past about 60 % writes a progress note, then restarts from the
   brief and that note. The 60 % figure is an upper bound from practitioner guidance; no vendor
   publishes one.
8. **Rejected approaches.** Every handoff names the approaches it rejected, and why.

### 2. Reset and request protocol for a Codex pane

Before every gpt-auditor request (first audit, confirm, challenge, ADR or plan review) and every
implementor reset:
1. **Reset only when idle.** Confirm that `herdr agent get` shows `idle` or `done`, and record the
   current session id.
2. **Send `/new` as input, not as a prompt, and submit it.** Run `herdr pane send-text <pane>
   '/new'`, then `herdr agent send-keys <name> enter`. Neither uses `--wait`: `/new` starts no
   turn, so a `prompt --wait` would stall. `send-keys` alone takes key names only, and
   `send-text` alone does not press Enter.
3. **Check the reset.** The reset counts only when `herdr agent get` reports a different session
   id. If the id has not changed, use rule 71 § Restart, a new pane. A result produced before a
   confirmed reset is void for this protocol.
4. **Send the request.** Use `herdr agent prompt … --wait`, in the background, as rule 71 already
   requires. The prompt points at a self-contained request file:
   - `herdr-spike/gpt-auditor/<item>-r<round>-request.md`, which re-points at the standing
     `BRIEF.md`;
   - or the implementor's fix brief.

**A confirm request carries:**
- the fix diff range;
- the open findings by id, with their text;
- the earlier report files;
- **the text of every counter-proof or challenge it must answer.**

**Its scope is ADR-0121 decision 4 as written:**
- the fix diff;
- every open finding, including any unfixed instance of an open class;
- any Critical or High that a commit in `base..sha` introduced, exposed or worsened.

The request does not invite a fresh full audit of untouched code.

### 3. fable-auditor

1. **Retirement.** The long-lived Fable session is retired once this ADR is accepted and its open
   requests have finished.
2. **A fresh subagent per request.** For each PR audit, confirm or challenge, the delegator
   dispatches the `mdpro-fable-auditor` subagent on the Fable model.
   - It is named, never a fork, and never resumed. A fork inherits the delegator's conversation,
     including the Codex verdict. A resumed subagent keeps its earlier round.
   - Every request is a new `Agent` call, using the same request form as decision 2.
3. **Reports.** The subagent returns its verdict as its result. It stays read-only. The delegator
   writes that verdict, verbatim, to `herdr-spike/fable-auditor/<item>-r<round>.md`.
4. **Plan reviews.** ADR and plan reviews stay with Opus, in `plan` mode (ADR-0118).

### 4. A phase-aware read barrier, for both auditors

The barrier depends on the phase.

| Phase | May read | Must not read |
|---|---|---|
| Round one (`audit`, or `plan` round one) | the range, the brief, the handoff, `REVIEW.md` | any other auditor's verdict, PR comments, `herdr-spike/delegator/` |
| `confirm`, `plan` confirm | the files the request names: completed earlier rounds of both auditors, the merged verdict, the counter-proofs | the other auditor's report for the **current** round |
| `challenge` | the one challenged finding and its evidence, as the request quotes them | anything else from the other auditor |

The agent definition and gpt-auditor's `BRIEF.md` both state this table. Both stay read-only on
source.

### 5. The delegator

1. **Session.** The delegator keeps one session, rotated by handoff under rule 70.
2. **Compaction.** At a quiet point, the delegator asks the user to type `/compact`, because a
   session cannot issue its own slash command. A quiet point means no landing in flight, and every
   wait recorded in `heartbeat.json`. The instructions name what to keep:
   - the open findings;
   - SHAs;
   - number reservations;
   - the armed waits.

### 6. In the commit that accepts this ADR

- **Rule 71:**
  - the roster rows for gpt-auditor and fable-auditor;
  - § Restart: fix numbering and context measurement;
  - § "Challenge and confirm with gpt-auditor": decision 2's protocol replaces "relying on its
    thread".
- **`.claude/agents/mdpro-fable-auditor.md`:** decision 4's table replaces its blanket barrier. It
  says the verdict is returned, not written. Its stale `mdpro-delegator` and `mdpro-codex-audit`
  wording is fixed.
- **`~/.mdpro-redesign/herdr-spike/gpt-auditor/BRIEF.md`:** the same table, and decision 2's
  request form. This file is outside the repository.
- **Forward links** in the Status lines of ADR-0124, ADR-0115 and ADR-0121.

### 7. Before relying on it

**One probe request** on gpt-auditor, before any live audit. The delegator:
1. resets the pane by decision 2;
2. checks that the session id changed;
3. asks what the previous request was.

The probe passes when:
- the session id changed;
- the answer names no earlier request.

If the probe fails, decision 2 falls back to a new pane per request.

## Consequences

- **This changes the auditors, so ADR-0121's escape replay applies.** The agent definition and the
  request template both change.
  - `docs/audit/escapes.md` has zero rows, so recall is "insufficient evidence".
  - The user decides without recall numbers, and that decision is quoted in this ADR's Status on
    acceptance.
  - The first escapes recorded after this change are replayed against both forms.
- **Cold starts have a cost that is not measured yet.** Each request re-reads the brief, the diff
  and the earlier reports, and no parent conversation is inherited.
  - Whether prompt caching offsets this is not established.
  - The first ten requests after acceptance record their duration and token usage, input, cached
    and output, in a "Fresh-context cost" table in `docs/audit/audit-log.md`.
- **The request file is now the only memory.** A request that leaves out an open finding loses it.
  Before sending a confirm, the delegator checks its request against the merged verdict's open list.
- **A fix session has only the handoff's reasoning.** A fix that depends on an unrecorded reason
  can undo it. That is why handoffs now list the approaches they rejected.
- **Partial reversal under herdr.** Fable goes back to being a subagent for PR audits. The user can
  no longer watch it in its own pane, but its reports stay readable as files.
- **Anchoring is reduced, not removed.** A fresh auditor still reads its own earlier report in a
  confirm. The counter-proof text in the request makes it answer that proof, and the ADR-0120 cap
  and the challenge rules still apply.
- **Blindness gets stronger, but still depends on the delegator.** Round one never shares a context
  with an earlier challenge. A request that names the wrong file can still break it.
- **The reset depends on herdr and Codex behaviour that only the probe establishes.** If either
  changes, the fallback is a new pane per request, which costs a startup each time.
