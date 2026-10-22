# 0133. A third Codex implementor takes Low-tier items, and every Codex agent runs with a context cap

## Status

Accepted, 2026-10-22. Decided by the user, recorded by herdr-delegator. The user's words:
「Accept (Recommended)」. Reviewed over three rounds by gpt-auditor (`review-plan`) and Opus
(`mdpro-fable-auditor`, plan mode), blind in round one: r1 C0 H1 / C0 H2, r2 C0 H1 / C0 H0,
r3 C0 H0 / C0 H0.

Proposed 2026-10-22 by herdr-delegator. The two decisions in it are the user's, given before
drafting:
- 「3rd slot, Low tier only (Recommended)」;
- 「Cap at next restart (Recommended)」.

**Revision 2** follows the first blind review: gpt-auditor C0 H1 M3 L0, Opus C0 H2 M7 L4.
- Both raised the same High: revision 1 loosened ADR-0131's session-id check without
  superseding it.
- Opus alone raised two more:
  - the launch flags are probably lost at an in-pane `/new`;
  - ADR-0131's context thresholds mean nothing under a 250k cap.

Revision 2 answers all three by making every reset a new pane, and names each clause it
supersedes.

**Revision 3** follows the round-two confirms:
- Opus closed all three, C0 H0 M2 L2.
- gpt-auditor closed all three and raised R2-H1, C0 H1 M2 L0: revision 2 started the agent in the
  new pane before closing the old one, and herdr refuses a name that a live agent still holds.

Decision 4 now closes the old pane first, as the three resets run on 2026-10-22 did. Decision 5
covers a session that has already compacted, and the third slot is scoped to herdr.

On acceptance, this ADR partially supersedes:
- [ADR-0124](0124-two-implementation-slots-and-a-herdr-mixed-model-roster-overlays-rule-70.md):
  "two machine-wide". It stays two for every item that is not in the Low-tier slot (decision 2).
- [ADR-0131](0131-every-audit-request-and-every-fix-round-starts-from-a-fresh-context.md):
  - decision 1, points 4 (its "under about 50 %" condition), 5, 6 and 7;
  - decision 2, steps 2 and 3 (the in-pane `/new` and the session-id check);
  - decision 7's "if the probe fails" clause, which becomes the rule.

  All of these are replaced by decisions 4 and 5 below.

## Context

**The Codex weekly quota is running out mid-week.** It went from 22% left to 15% left in about an
hour on 2026-10-22, with two implementors and the auditor at work. It resets on 28 Oct. The user
asked for a third implementor on a cheaper model for simple work, and for other ways to spend fewer
tokens: 「再增加一个gpt-imple-3 powered by gpt-5.6-sol medium effort, delegate simple tasks to
gpt-imple-3, also brainstorm other ways to make the best use of token usage, current gpt token
usage is consumed too fast.」

**What the session logs show**, for the 36 hours to 2026-10-22, counting only tokens spent inside
the window. The evidence and the script are in
[`docs/reference/20261022-codex-token-usage.md`](../reference/20261022-codex-token-usage.md).

| Who | Input tokens | Not cached | Output | Largest single request |
|---|---|---|---|---|
| mdpro implementors | 1,733M | 10.5M | 1.96M | 665k |
| other projects on the same account | ~325M | ~6.7M | ~1.1M | 596k |
| mdpro auditor and spec adversary (Astra) | 65M | 5.0M | 0.24M | 216k |

- 99% of implementor input is cached. The cost is driven by **context size multiplied by the number
  of tool calls**: every call resends the whole conversation.
- The global `~/.codex/config.toml` sets `model_context_window=1000000` and
  `model_auto_compact_token_limit=9000000`. Below the 1M window, an implementor session does not
  compact; what Codex does at the window itself was not observed. D255-WI-3b ran through eight brief
  amendments in one growing session.
- How the plan weighs cached tokens against uncached ones is not published. The direction is clear
  either way; the size of the saving is not.

**Launch flags and `/new`.** Rule 71 records that `/new` falls back to the `config.toml` default
model and effort. A launch flag passed to `herdr agent start` is therefore not known to survive an
in-pane `/new`. ADR-0131 resets panes with `/new`. Its session-id check is also unreliable: herdr
showed gpt-auditor's id as `01a16296…`, which is a session of another project (picsee).

**ADR-0124 caps unlanded implementation items at two machine-wide.** The cap limits parallel load
and parallel token burn. A third implementor working in parallel breaks it unless its work is
fenced.

**ADR-0121's Low tier is narrow:** CSS, `docs/**`, `design/**`, `CHANGELOG.md`, and tests that guard
presentation only. Its audit is Codex mini alone. Few items in today's queues are Low: D258 is one;
D306 is not, because its test guards gate tooling.

## Options considered

**The third implementor:**
1. **A third slot, Low tier only (chosen).** Low-tier items need the least reasoning and the
   cheapest audit, so they fit a cheaper model.
2. **gpt-imple-3 shares the two slots.** No cap change, but it would sit idle whenever both slots
   are taken, which is most of the time. This option lost.
3. **Raise the cap to three for any item.** More parallel work, but three agents burning quota at
   once is the opposite of what the quota needs. This option lost.

**The context cap:**
1. **A per-agent launch flag, applied at each agent's next restart (chosen).** The global config,
   and with it the user's other projects, stays untouched, and no conversation in progress is cut.
2. **Restart every agent now.** It saves the most, but each agent loses its conversation mid-item.
   This option lost.
3. **Edit the global config.** It would also cap the user's other projects. This option lost.
4. **Lower `model_context_window` per agent instead.** Compaction is what reclaims context. A
   smaller window without a compaction limit only moves the point where the session fills, and the
   limit alone is enough. This option lost.
5. **No cap, fresh sessions only.** It leaves a long item to grow unbounded between resets. This
   option lost.

**How a reset keeps the flags:**
1. **A new pane for every reset (chosen).** `herdr agent start` passes the model, the effort and the
   cap each time. A new Codex process starts a new conversation (rule 71 § Restart). This was already
   ADR-0131 decision 7's fallback.
2. **Keep `/new`, and probe whether `-c` survives it.** The probe would have to fill 250k of context
   to show compaction, and `/new` already drops `-m` by rule 71's own record. This option lost.
3. **A per-project Codex profile.** It needs a config edit that the user's ruling avoided. This
   option lost.

## Decision

1. **gpt-imple-3 joins the roster.** It is a Codex implementor on `gpt-5.6-sol` at medium effort,
   in a herdr pane, with one `mdpro-wt/` worktree per item. It works under rule 71's brief, attacked
   matrix, receipts, self-acceptance and landing, exactly as gpt-imple-1 and gpt-imple-2 do.
2. **The third slot** exists only under herdr-delegator, the scope of ADR-0124's roster and of
   rule 71.
   - It belongs to gpt-imple-3 and holds one Low-tier item at a time. The delegator tiers the item
     under ADR-0121 decision 1 when it writes the grant, and the heartbeat assignment records the
     tier.
   - A Low-tier item granted to gpt-imple-1 or gpt-imple-2 uses one of their general slots.
   - **The implementor finds a higher-tier path:** the item stops with `<item>-blocked.md`.
     - It keeps the third slot until the delegator hands it to gpt-imple-1 or gpt-imple-2, which
       happens only when a general slot is free.
     - The worktree, the branch and the receipts move with it, and the delegator records the
       handover in the brief.
   - **An auditor raises the tier at audit time** (ADR-0121): the item finishes its fixes in
     place, as an item already over the cap, and gpt-imple-3 takes no new item until it lands.
   - Medium and High items keep the two-slot cap.
3. **gpt-imple-3 also takes prep** (ADR-0097: read-only investigation and scratch notes outside the
   repository) for items queued for the other implementors. Prep needs no slot.
4. **Every reset of a Codex pane is a new pane.** This replaces ADR-0131 decision 2's steps 2 and 3,
   and decision 1's point 6.
   - **The order matters, because herdr names are unique among live agents:**
     1. confirm that the old agent is `idle` or `done`;
     2. open a new pane in the same worktree (`herdr pane split <old> --direction down --cwd
        <worktree>`, adding `--env MDPRO_ROLE=implementor` for an implementor, as rule 71
        § Restart does);
     3. close the old pane, which releases the name;
     4. start the agent in the new pane with its full launch line: `herdr agent start <name> --kind
        codex --pane <new> -- -m <model> -c model_reasoning_effort=<effort> -c
        model_auto_compact_token_limit=250000`. If herdr answers `agent_pane_busy` because the new
        shell is not ready yet, wait a few seconds and retry the same command.
   - Three resets ran this way on 2026-10-22: gpt-imple-1, then gpt-auditor twice. The first start
     on `w5:p4` met `agent_pane_busy`, and the retry succeeded.
   - **The reset counts** when both hold:
     - the `agent_started` result's `argv` shows those flags. herdr returned this field on every
       start that day, for example `["codex","-m","gpt-6-astra","-c","model_reasoning_effort=high",
       "-c","model_auto_compact_token_limit=250000"]`;
     - before the prompt is sent, the status line reads `<model> <effort> · Context 0% used`.
   - Otherwise the result is void and the reset is repeated. The session id is not used.
   - This covers every gpt-auditor request (ADR-0131 decision 2), every implementor reset, and
     every restart.
   - The `mdpro-spec-adversary` and `mdpro-tdd-reviewer` subagents are not started by herdr and are
     not capped. Each is a fresh context per run.
5. **Context thresholds under the cap.** The status line's percentage is of the 1M window, so 250k
   is 25%. This replaces ADR-0131 decision 1 points 4 (the 50 % condition), 5 and 7.
   - **Fix 1 stays in the item's session** only when both hold:
     - the fix brief names one or two findings, each with its regression test;
     - the status line shows at most **12 %** used, about half the cap.
   - **At any stop or handoff, a session showing 20 % or more used, or one that has compacted,**
     writes a progress note and restarts in a new pane (decision 4), from the brief and that note.
     20 % is 80 % of the cap.
     - A compacted session reads lower after compaction, so the percentage alone misses it.
     - The delegator treats a session as compacted when its pane shows Codex's compaction notice,
       or when its used percentage has fallen since the previous wake.
   - The delegator reads the status line at each wake, as before.
6. **Every Codex agent runs with the cap from its next restart:** a new item, a fix round, a reset
   under decision 4, or a session restart under decision 5. `~/.codex/config.toml` is not
   changed.
7. **Every brief carries a token-discipline section:**
   - gate output goes to a log file, and the agent reads only its summary lines;
   - the agent reads only the file ranges it needs;
   - the delegator traces readers and callers before it grants, so a grant does not end in a stop
     that re-reads the whole context.
8. **Measurement.** At each landing, the delegator runs the evidence file's script over the window
   since the previous landing. It records the implementor's input, uncached input and largest
   request in the evidence file, for the next ten landings.
9. **In the commit that accepts this ADR:**
   - rule 71:
     - the roster row for gpt-imple-3;
     - § Slots;
     - § Restart's order and launch line;
     - § Fresh context's reset steps and thresholds, rewritten to decisions 4 and 5, with step 1's
       session-id record dropped;
   - rule 70: the cap line and the alias table;
   - Status forward links in ADR-0124 and ADR-0131;
   - `~/.mdpro-redesign/herdr-spike/gpt-auditor/BRIEF.md`'s reset section, outside the
     repository.

## Consequences

- **A third agent burns quota in parallel.** If Low-tier work does not show up, gpt-imple-3 does
  prep only, and prep still spends quota. The saving rests on the cap more than on the third slot.
- **The spec adversary still runs on Astra high for Low-tier grants.** Rule 71 requires the attacked
  matrix on every grant. For a CSS item that is a fixed cost out of proportion to the change. It is
  kept, because no rule exempts Low tier, and this ADR does not add one.
- **A cheaper model may need more review rounds.** Its Low-tier audit is Codex mini alone (ADR-0121),
  so the extra cost of a weak handoff lands on gpt-auditor.
- **Compaction now happens inside an item.** A session past 250k works from Codex's own summary until
  decision 5 restarts it at its next stop. Rule 71's files (brief, implement log, handoff) carry
  exactness across that boundary, as they already do across a fresh session.
- **A reset costs a pane and a process start**, where `/new` did not. The delegator records the new
  pane id in the heartbeat assignment each time.
- **The cap barely touches gpt-auditor**, whose largest request was 216k. Its saving comes from the
  implementors.
- **Two caps now coexist:** two general slots, and one Low-tier slot. The delegator must state the
  tier in every grant to gpt-imple-3.
- **gpt-5.6-sol's weight against the quota is unknown.** If the measurement shows no saving, the
  model choice is revisited by a new record, not by an edit here.
