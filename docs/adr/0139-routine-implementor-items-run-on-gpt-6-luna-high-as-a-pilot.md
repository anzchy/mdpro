# 0139. Routine implementor items run on gpt-6-luna high, as a pilot

## Status

Accepted, 2026-10-24. Decided by the user, recorded by herdr-delegator. The user's words: 「接受 (Recommended)」.
Reviewed over two rounds by gpt-auditor and opus-auditor, blind in round one: r1 C0 H1 / C0 H2, r2 C0 H0 / C0 H0.

Proposed 2026-10-23 by herdr-delegator. The user's direction, given before drafting:
「one small ADR that adds gpt-6-luna high for routine implementors only, 按照你建议的办」, after asking whether the
implementor or the test-matrix attack could run on a cheaper model such as `gpt-6-luna` high for `routine` or
`standard` items.

**Revision 2** answers the round-one reviews (gpt-auditor C0 H1 M2, Opus C0 H2 M4 L2). Both raised that the stop sent
routine items to `gpt-6-sol` low, against ADR-0138 decision 5's prior settings; Opus also raised that gpt-imple-3's model
is fixed by ADR-0133 decision 1 and was changed without naming it. Decision 4 now reverts with everything else, and
ADR-0133 is named below. The recording (who, where, in-flight, empty sample) and both rule 71 sentences are now stated.

On acceptance it partially supersedes:
- [ADR-0138](0138-effort-follows-task-difficulty-and-audits-read-from-the-diff-outward.md) decision 2, the implementor
  row's `routine` cell, which reads "Implementor (`gpt-6-sol`; gpt-imple-3 `gpt-5.6-sol`) | low": it becomes
  `gpt-6-luna` high for every implementor;
- [ADR-0133](0133-a-third-codex-implementor-takes-low-tier-items-and-every-codex-agent-runs-with-a-context-cap.md)
  decision 1, gpt-imple-3's model, **for `routine` items only**. Its `standard` and `hard` items stay on `gpt-5.6-sol`,
  and ADR-0133 decision 8's measurement of `gpt-5.6-sol` continues on those items; Luna items are excluded from its count.

On acceptance rule 71's Models sentence and its difficulty table both change to match, and ADR-0133 gets a forward link.

## Context

- **ADR-0138** (accepted the same day) routes Codex effort by difficulty. A `routine` item is mechanical and fully
  specified, with no lifecycle: copy, CSS, a rename outside High-tier paths, docs. Its implementor runs `gpt-6-sol` low.
- **The model.** Codex's model list (`~/.codex/models_cache.json`, 2026-10-23) describes `gpt-6-luna` as "Fast and
  affordable model for easier tasks", with low to max effort. `gpt-6-sol` is "Previous generation workhorse model".
  No local price or token comparison exists; whether Luna high costs less than Sol low per item is unmeasured.
- **What the implementor's tokens are.** Implementor runs are the largest sink: 1,733 M input over 36 hours, and
  200–300 M for a large item (`docs/reference/20261022-codex-token-usage.md`). D258, a Low-tier item, used 16.2 M.
- **What is not changed.** The matrix attack keeps its ADR-0138 models: its only job is finding a missed case, and the
  three blocking Highs of 2026-10-20 were all missed cases. `standard` and `hard` implementors are unchanged.

## Options considered

1. **Keep `gpt-6-sol` low for routine items.** Lost: the user asked to try a cheaper model where the risk is lowest.
2. **Luna high for routine and standard implementors.** Lost for now: standard items carry ordinary logic, a
   judgement-heavy matrix and rule 60's checks. It can follow if the routine pilot goes well.
3. **Luna for the matrix attack.** Lost: the cheapest place to lose recall is the step whose only job is recall, and
   its share of tokens is small (2.1 M for D258's attack and reviewer).
4. **Luna high for routine implementors only, measured inside ADR-0138's pilot.** Chosen.

## Decision

1. **Routine implementors run `gpt-6-luna` with `model_reasoning_effort=high`**, launched by rule 71 § Restart with
   `-m gpt-6-luna -s danger-full-access -c model_reasoning_effort=high -c model_auto_compact_token_limit=250000`. This
   applies to gpt-imple-1, -2 and -3 alike when the brief's difficulty is `routine`.
2. **A raise leaves Luna.** If the difficulty is raised during the item (ADR-0138 decision 1), the new pane uses that
   difficulty's model and effort. A Luna implementor that cannot meet an AC stops and says so; it is not retried on
   Luna.
3. **Everything else in the workflow is unchanged** for these items: the attacked matrix (on
   `mdpro-spec-adversary-std`), RED receipts, the reviewer, the gates, the self-acceptance table, and both audits by
   tier.
4. **Measurement and stop.**
   - **Who and where.** The delegator writes one row per Luna item in `docs/audit/audit-log.md` § ADR-0138 pilot: item
     id, agent, model and effort, start and end, input, cached and output tokens, fix rounds, and every Critical or High
     found against it by detector.
   - **Stop.** It ends with ADR-0138 decision 5: when the second High-tier pilot PR lands, dispatch returns to the
     **prior settings** from the next brief on, routine items included: `gpt-6-sol` medium, and gpt-imple-3 on
     `gpt-5.6-sol` medium, until the user rules on both ADRs. A Luna item already in flight at that moment finishes on
     Luna and is recorded; a fix round after the stop runs on the prior settings.
   - **Empty sample.** If no routine item ran on Luna before the stop, the delegator reports the Luna result as
     inconclusive.
   - Any Critical or High found against a Luna item is reported to the user at once, with the item's figures.

## Consequences

- **Gained.** A measured try of the cheapest model on the lowest-risk work; data for deciding whether Luna can take
  `standard` items later.
- **Costs.** Luna may need more fix rounds or more audit findings, which can cost more than it saves; the pilot shows
  which. Its price advantage is unverified locally. Rule 71 gains a model exception in its table, and a raised item
  needs a new pane.
- **Unchanged.** The matrix attack's models, `standard` and `hard` implementors, both auditors, the round cap, every
  data-loss guard.
- **Foreclosed.** Nothing; ADR-0138's stop rule returns the choice to the user.
