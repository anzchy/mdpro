# 567-tdd-skill spec snapshot r5 (2026-11-01)

A frozen copy of the issue bodies as published (rule 12, ADR-0148). It supersedes [r4](../r4/manifest.md); r1–r4 stay as the
record. Any later normative edit is `r6`, which needs re-approval and a plan review of its diff against this revision.

| File | Issue | File SHA-256 |
|---|---|---|
| `spec.md` | [#568](https://github.com/anzchy/mdpro/issues/568) | `29a58190eb67e9c53a9cdba38701be105a422ad1b8ac30c309451583ee801905` |
| `tickets/T-01.md` | [#569](https://github.com/anzchy/mdpro/issues/569) | `8a402f868586f21a842a6ee5e6f4b889f844728b3951e8a645c349aec205facf` |
| `tickets/T-02.md` | [#570](https://github.com/anzchy/mdpro/issues/570) | `3262d94577142177461522c9d59c26141d5d27bb2bbaf78f72dce5745f5ebef1` |
| `tickets/T-03.md` | [#571](https://github.com/anzchy/mdpro/issues/571) | `9a5e09bf8c49508a3b2d94f6b80b11d689682c51dfd4343b791c6719a7967245` (unchanged from r4) |

Each file is the issue body as `gh issue view <n> --json body --jq .body` returned it on 2026-11-01.

## Why r5
The user asked that jack-tdd-workflow be self-contained: 「pr #577中 skill.md 引用的 scripts/tdd/red-receipt.mjs, references/matrix-template.md,commands in .claude/rules/10-tdd.md, .agents/skills/mdpro-delegator/references/templates/matrix-attack-prompt.md should be jack-tdd-workflow skill self-contained」.
r5 gives the skill a thin receipt wrapper with four modes (spec § Receipts table) that calls `scripts/tdd/red-receipt.mjs`,
which stays where it is. T-01 adds the wrapper and its stub-root test and leaves rule 10 and #566's guard test unchanged; T-02
adds the Rust verify line to rule 10 and names the wrapper there. The attack prompt still moves in T-02. No receipt contract
changes (ADR-0162 decision 5).

## Approval words (user, 2026-11-01)
- r1–r4's words carry over; see [r4](../r4/manifest.md).
- 「right, the receipt stay where it is, add  A thin wrapper inside the skill that calls it.」
- 「Wrapper carries them (Recommended)」 (rule 10 keeps its commands; story 37 stands).
- 「Keep it in T-02 (Recommended)」 (attack prompt).
- 「r5, into T-01 now (Recommended)」.
- 「Approve r5 (Recommended)」, and in chat 「批准R5」.

## Plan review
- Round 1 on draft 1: gpt-auditor NOT READY C0 H1 M0 L0 (F1, no oracle for the four-mode equality); opus-auditor (fable-auditor
  session) NOT READY C0 H2 M4 L5 (cargo fmt before Rust verify; no rule-10 referent for Rust verify).
- Round 2 (the cap) on draft 2: gpt-auditor READY C0 H0 M2 L0; opus-auditor READY C0 H0 M1 L3. Every round-one finding CLOSED
  or a non-blocking PARTIAL. opus M1 (story 20 still named the cargo fmt precondition) was fixed in story 20 before publishing.
- Reports: `~/.mdpro-redesign/herdr-spike/{gpt-auditor,opus-auditor}/T567-spec-r5-{plan,confirm}.md`.

## Dispositions (ADR-0148 decision 4)
- gpt M1 (the stub must also compare the child environment): carried into T-01's fix brief as a required case.
- gpt M2 / opus M4 (what r5 voids on PR #577): **no review is voided.** #577 had no code audit yet; its CI was red, which under
  ADR-0162 sends it back to the implementor without an audit round. Both auditors audit the final head once. The earlier
  receipts `T567-S1`…`S37` stay as recorded, and their recorded spec lines are not edited; the wrapper arrives as new cycles.
- opus Lows (both skill paths in the stub-root test, what the rule-10 comparison extracts): carried into the fix brief.

## Blocking edges (native GitHub dependencies, unchanged)
- T-01 (#569): #566.
- T-02 (#570): T-01 (#569); also the user's acceptance of ADR-0161, named in the body.
- T-03 (#571): T-02 (#570); also 0.3.6 shipping, named in the body.
