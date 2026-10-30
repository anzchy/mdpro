# 0156. Three implementation slots, and opus-imple-2 joins the roster

## Status

**Accepted, 2026-10-30. Decided by the user**, recorded by herdr-delegator (Claude route). The user's words:
「create a new pane opus-imple-2 and delegate tasks to it.」, then, asked what opus-imple-2 should take under the two-slot
cap, 「Raise cap to 3, all start」.

**Partially supersedes** [ADR-0124](0124-two-implementation-slots-and-a-herdr-mixed-model-roster-overlays-rule-70.md)
decision 1: "**two** machine-wide" becomes three. One unlanded item per session still holds. It also adds a roster row to
[rule 71](../../.claude/rules/71-herdr-mixed-roster.md). The user's 2026-10-29 roster decision (two implementors, two
auditors, the delegator) is extended by this ADR.

The user decided before review. The draft goes to gpt-auditor for a plan review as a record check. A finding there leads
to a new ADR; it does not reopen this one.

## Context

- **What is waiting.** On 2026-10-30, three implementation items are waiting:
  - #551, ADR0149-entry, held by opus-imple-1 in its fix 3;
  - D336–D338, the Windows driver fixes;
  - D50, Ctrl+Shift+L on Windows.

  D50 and the driver fixes gate the v0.3.6 Windows menu batch.
- **The cap queued them.** With two slots, the user's earlier order queued both 0.3.6 items behind #551:
  「After #551, gpt-imple-1 on driver fixes, opus-imple-1 on D50」.
- **The Mini is under a CPU pause.** ADR-0150 decision 9 allows no full mdpro heavy lane on the Mini, so CI is the
  full-lane evidence. Each implementor runs only focused tests at no more than two workers, through
  `scripts/heavy-lock.sh --guard-only`.
- **Past caps.** ADR-0119 once allowed four slots. ADR-0124 cut that to two after the review and landing queue overloaded
  the delegator. ADR-0133's third slot, Low tier only, closed with gpt-imple-3 on 2026-10-29.

## Options considered

1. **Keep two slots, and put opus-imple-2 on D50 now.** Lost: the user chose to start all three items.
2. **Keep two slots, and put opus-imple-2 on D312 PR 1.** Lost: the same reason.
3. **Three slots for any tier (chosen).**

## Decision

1. **Cap.** One unlanded implementation item per session, and **three** machine-wide, with or without herdr.
2. **Roster.** `opus-imple-2` is a Claude Code implementor:
   - it runs on Opus, started with `--model opus --dangerously-skip-permissions` and `MDPRO_ROLE=implementor`;
   - it has its own persistent worktree, `mdpro-wt/opus-imple-2`;
   - it gets work from a brief file plus `herdr agent prompt`;
   - it reports through `~/.mdpro-redesign/herdr-spike/opus-imple-2/<item>-handoff.md`.

   The live roster becomes:
   - herdr-delegator;
   - gpt-imple-1, opus-imple-1 and opus-imple-2;
   - gpt-auditor and opus-auditor.

   gpt-imple-2 stays idle.
3. **Initial assignment.**
   - opus-imple-2 takes D50;
   - gpt-imple-1 takes D336–D338;
   - opus-imple-1 finishes #551.
4. **Unchanged.**
   - landing (the verifier, a merged blocking count of C0 H0, a green `ci-gate`, and `--ff-only`);
   - both auditors on every audit, capped at two rounds (ADR-0143);
   - the ADR-0150 decision 9 pause and its focused-run limit.

## Consequences

- **Gained.** Both v0.3.6 Windows items start now instead of after #551.
- **Costs.**
  - Up to three handoffs can queue for audit and landing at once. gpt-auditor serves them one at a time, so audits
    serialise behind it.
  - The delegator coordinates more at once. That is the overload ADR-0124 cut slots to avoid.
  - Three implementors run focused lanes on the Mini at the same time, at up to two workers each. That adds CPU load
    during the pause the user set to reduce it.
  - Each new worktree adds a `node_modules` tree to the Mini's disk.
- **Foreclosed.** Nothing permanently: a later ADR can lower the cap again.
