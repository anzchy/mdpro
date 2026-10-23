# 0138. Effort follows task difficulty, and audits read from the diff outward

## Status

Accepted, 2026-10-23. Decided by the user, recorded by herdr-delegator. The user's words: 「接受 (Recommended)」, given
to a question that stated the ADR-0121 decision 6 result (no escapes recorded, "insufficient evidence") and that recall
under decision 4 is unmeasured; that answer is the decision 6 ruling. Reviewed over three rounds by gpt-auditor
(`gpt-6-sol` medium) and opus-auditor, blind in round one: r1 C0 H3 / C0 H3, r2 C0 H2 / C0 H0, r3 C0 H0 / C0 H0.

Proposed the same day by herdr-delegator. The user's direction, given before drafting:
「token-efficiency changes: 先采纳你的建议，但是effort 要根据任务难度来route」. It routes Codex reasoning effort by task
difficulty and narrows how auditors start reading, on the models the user already chose.

**Revision 2** answers the round-one reviews (gpt-auditor C0 H3 M3 L1, Opus C0 H3 M7 L3):
- Both: ADR-0121 decision 6's escape replay was triggered and not addressed (decision 6 below now addresses it).
- Both: diff-led reading narrowed exactly D305's class (a peer writer and an unchanged lock holder), and the pilot
  could not see that miss. Decision 4 now makes the auditor build its own shared-resource map and keeps full reading for
  `hard` ranges; decision 5 labels recall unmeasured and makes adoption a separate decision.
- Codex: lane reuse trusted an author-written log and left out runner and configuration inputs. Revision 1's decision 3
  is **withdrawn**; the verifier keeps its independent run.
- Opus: the matrix-attack skip for `routine` grants was new, not existing, and overrode a user decision and ADR-0133.
  It is **withdrawn**: every grant keeps its attack.

The ADR-0121 decision 6 replay: `docs/audit/escapes.md` has no rows, so the result is "insufficient evidence", and the
user decides without recall numbers, as for ADR-0124 and ADR-0131.
The acceptance question put to the user states that result and that recall under decision 4 is unmeasured; the
user's answer to that question, quoted here on acceptance, is the decision 6 ruling.

**Revision 3** answers gpt-auditor's round-two H1 (the ruling must be the informed acceptance itself, above) and H2
("no default adoption" had no stop rule; decision 5 now reverts to the prior settings after the second pilot PR
until the user rules). Opus's round two was C0 H0 M3 L2.

On acceptance it partially supersedes:
- [ADR-0121](0121-audit-effort-follows-risk-pre-existing-findings-do-not-block-and-auditors-are-measured.md) decision 1,
  **extended, not replaced**: the tier still sets how many auditors and dimensions; difficulty is added for effort;
- the request template and the audit-mode reading procedure of `.claude/agents/mdpro-fable-auditor.md` and
  `gpt-auditor/BRIEF.md` (decision 4), under ADR-0121 decision 6;
- rule 71's one effort per role (§ Restart, Models), and the fixed `gpt-6-astra` high of `mdpro-spec-adversary` (for
  `routine` and `standard` grants only; decision 2);
- for gpt-auditor, the effort half of the user's same-day 「update gpt-auditor's model to `GPT-6-Sol medium`, from now
  on」: the model stays `gpt-6-sol`, the effort follows decision 2, per the later 「effort 要根据任务难度来route」.

## Context

- **What tokens buy.** One Codex audit request reads 0.67–1.54 M input tokens, 86–92 % cached, and writes 3–6 k
  (`docs/audit/audit-log.md` § Fresh-context cost; plan reviews, not PR audits). Implementor runs dominate: 1,733 M input
  over 36 hours (`docs/reference/20261022-codex-token-usage.md`). D258's attack and reviewer, both `gpt-6-astra` high,
  added 2.1 M input to a Low-tier item.
- **What the spend found.** On D305 Codex alone raised a data-loss High, and its round-two trace needed files the range
  never touched: the quit backstop (a peer writer) and startup cleanup holding `DRAFT_LOCK`. On D255-WI-3c Opus alone
  found the Replace High. Confirms found new Highs on D301, D290 and D255-WI-3d. Neither auditor and no round is shown to
  be idle, and recall under any narrowed process is unmeasured.
- **The community.** Route lower effort to routine work and keep strong reasoning for hard review; high effort costs
  about 3–5× medium in reasoning tokens. The evidence is practitioner reports, not controlled trials
  (`~/.mdpro-redesign/herdr-spike/gpt-auditor/token-efficiency.md`).
- **Today's settings.** Implementors `gpt-6-sol` medium; gpt-imple-3 `gpt-5.6-sol` medium; gpt-auditor `gpt-6-sol`
  medium; the spec adversary `gpt-6-astra` high; opus-auditor Opus at Claude Code's default.

## Options considered

1. **Leave everything as it is.** Lost: Astra-high attacks and medium-effort implementors on mechanical work, and whole
   files re-read for one-line changes.
2. **Effort by ADR-0121 tier.** Lost: tier measures risk, not difficulty.
3. **Astra-high for High-tier round one, Sol-medium for confirms** (gpt-auditor's proposal). Lost: it changes the model
   the user chose the same day and still ties effort to tier.
4. **Fewer auditors or rounds for Medium tier.** Lost: no measured recall supports it.
5. **Reuse the implementor's lane results on identical trees** (revision 1). Withdrawn: a handoff log is author-written
   text, and three source trees miss runner, configuration and toolchain inputs. It saved machine time, not tokens.
6. **Skip the matrix attack on `routine` grants** (revision 1). Withdrawn: it overrode the user's every-grant decision
   (rule 71) and ADR-0133's reasoning, and a test-only change can guard a High-tier path.
7. **Effort by difficulty, plus auditor-built diff-first reading, measured.** Chosen.

## Decision

1. **Difficulty.** Every brief and every audit request names `routine`, `standard` or `hard`.
   - `routine`: mechanical and fully specified, with no lifecycle: copy, CSS, a rename outside High-tier paths, docs.
   - `standard`: ordinary logic. **Unlisted work is `standard`.**
   - `hard`: async lifecycle, locks, ordering, save, draft, close, recovery, quit, MCP approval, cross-window state,
     parsing edge cases.
   - **The hardest matching category wins.** Any range that ADR-0121 rates High by behaviour is at least `standard`.
     A test-only change takes the difficulty of the invariant it guards.
   - The delegator sets it; any agent may raise it, with a reason, and none may lower it. A raise mid-run is a new pane
     with the new effort (rule 71 § Restart).
2. **Effort by role.** Codex `model_reasoning_effort`; the models do not change.

   | Role | routine | standard | hard |
   |---|---|---|---|
   | Implementor (`gpt-6-sol`; gpt-imple-3 `gpt-5.6-sol`) | low | medium | high |
   | gpt-auditor, any request (`gpt-6-sol`) | medium | medium | high |
   | gpt-auditor confirm or challenge | medium; **high** when the fix touches a `hard` path or the previous round found a new High | same as routine | high |
   | `mdpro-spec-adversary` (every grant, as today) | `gpt-6-sol` medium | `gpt-6-sol` medium | `gpt-6-astra` high |

   Audit effort is never below medium. opus-auditor keeps Claude Code's default. Rule 71's existing skip for a fully
   specified fix round is unchanged.
3. *(Withdrawn in revision 2.)*
4. **Audits read from the diff outward, and build their own map.**
   - The request opens with `git diff --stat`, the diff, the changed tests, the ACs, and the implementor's entry-path and
     await map, given as **an index to verify, not a scope**.
   - Each auditor builds its own map: every acquirer of each lock the range touches or calls under, every writer and
     deleter of each persisted value it changes (drafts, preferences, files, receipts), every caller, and the window,
     close and quit lifecycles that reach them. It reads those in full, and names them in its report.
   - **`hard` ranges keep today's full reading** of every changed file and its callers. The narrowing applies to
     `routine` and `standard` ranges only.
   - Nothing the auditor may read today is forbidden.
5. **Pilot, measurement, and adoption.**
   - Decisions 2 and 4 apply from acceptance. For the next two High-tier PRs and every request in between, the delegator
     records per stage the input, cached and output tokens, the difficulty and effort used, and every Critical or High by
     detector, in `docs/audit/audit-log.md`.
   - **Recall is not measured by this pilot.** It has no matched comparator.
   - **Stop rule.** When the second pilot PR lands, the delegator records it in the audit log and, from the next brief or
     request on, dispatches with the prior settings (rule 71's single effort per role, `mdpro-spec-adversary` on
     `gpt-6-astra` high, today's full-file reading) until the user rules keep, change or revert. The delegator enforces
     this and quotes the ruling in a forward link on this ADR. Nothing becomes permanent by default.
   - Any High found later in code a pilot range touched is an escape (`docs/audit/escapes.md`) and is replayed against
     both request forms and both efforts (ADR-0121 decision 6).
6. **Escape replay.** Recorded above under Status: insufficient evidence, user decides without numbers.

## Consequences

- **Gained.** Less reasoning on routine work; Astra-high attacks only on `hard` grants; a shorter start to `routine`
  and `standard` audits; the first per-stage cost record of High-tier PRs; difficulty written down where it was implicit.
- **Costs.** Difficulty is a judgement; a `hard` item labelled `standard` gets less thought. The hardest-wins rule and
  the never-lower rule are the guard. The auditor-built map spends some of the saving. A `low`-effort implementor may need
  more fix rounds, which the pilot will show. Recall under the new reading is unknown; accepting this ADR means accepting that without
  numbers. Rule 71, the auditor brief and the `mdpro-fable-auditor` procedure all change.
- **Unchanged.** Two auditors on High and Medium, three rounds (ADR-0120), fresh context per request (ADR-0131), the
  250 k context cap (ADR-0133), the attack on every grant, the verifier's independent lane run, the models chosen by the
  user, and every data-loss guard.
- **Foreclosed.** Nothing permanent; decision 5 brings it back to the user.
