# 0143. Every audit runs gpt-auditor and opus-auditor together, capped at two rounds

## Status

Accepted, 2026-10-25. Decided by the user, recorded by herdr-delegator (Claude route). The user's words:
「audit now has gpt-auditor + opus-auditor at the same time, audit cap is two」, given as Codex usage returned
(「now codex usage is sufficient, fire up all gpt-imple-* if needed」).

Supersedes, for audits requested from now on:
- [ADR-0120](0120-a-pre-landing-audit-runs-at-most-three-rounds-then-the-user-rules.md) decisions 1 and 2, the cap of three
  rounds, for gpt-auditor as well; [ADR-0142](0142-an-opus-auditor-review-runs-at-most-two-rounds-then-the-user-decides.md)
  already set two for opus-auditor and is folded into this record;
- rule 71 § Delegator runtime route and § Audits under herdr, where `gpt-auditor` is the one required auditor and
  `opus-auditor` is optional on the Claude route only, by the user's request and a usage check.

[ADR-0129](0129-a-high-that-survives-the-audit-cap-is-classified-tracked-and-expires.md) (the ruling record and the post-cap
fix) and [ADR-0121](0121-audit-effort-follows-risk-pre-existing-findings-do-not-block-and-auditors-are-measured.md) (tiers,
pre-existing findings) are unchanged.

## Context

- On 2026-10-24 the user retired opus-auditor on the Codex route and made gpt-auditor the sole required auditor. On
  2026-10-25 Codex usage ran out and opus-auditor became the only auditor (ADR-0141, D317, D319 round 3).
- With both models available again, the user wants both on every audit, as ADR-0115 once had, and a cap of two rounds
  for the pair, matching ADR-0142.
- The blind first round, the merge and the challenge of a one-sided finding (rule 70 item 4) were written for two
  auditors and still fit.

## Options considered

1. **gpt-auditor alone, opus optional** (rule 71 until now). Lost: the user asked for both.
2. **Both auditors, three rounds** (ADR-0120). Lost: the user set two.
3. **Both auditors, two rounds, then the user decides.** Chosen.

## Decision

1. **Both auditors on every audit**: every PR audit, ADR review and plan review goes to gpt-auditor and opus-auditor
   together, each in a fresh pane (rule 71 § Fresh context), on the same range and dimensions. Round one is blind; the
   delegator merges, and a finding only one raises is challenged by the other (rule 70 item 4). The High-tier security
   section is in both requests.
2. **At most two rounds**: the blind first audit and one confirm on the fix. A round is the pair; a challenge inside a
   round is not a round.
3. **After round two**, an open Critical or High goes to the user with both auditors' evidence. The user decides:
   one more round (once per review), fix without a further round (verifier and `ci-gate` still gate), land or accept
   it open under ADR-0129, or stop the item.
4. **When one model is unavailable** (usage exhausted, as on 2026-10-25), the delegator tells the user and the audit
   waits, unless the user directs a single-auditor round, which the record then names.
5. **In-flight reviews** keep the rounds they have used: a PR that already had two rounds is at the cap.

## Consequences

- **Gained.** Two independent models on every landing; the user hears about a stuck review after two rounds.
- **Costs.**
  - Every audit spends Codex and Claude usage, and a missing model now stops landings unless the user directs otherwise.
  - Findings a third round would have closed now cost a user question.
  - The delegator merges two verdicts and runs challenges again, which is slower than one auditor.
- **Foreclosed.** A third round, or a single-auditor round, without the user's word.
