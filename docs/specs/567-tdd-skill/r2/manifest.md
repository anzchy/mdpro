# 567-tdd-skill spec snapshot r2 (2026-10-31)

A frozen copy of the issue bodies as published (rule 12, ADR-0148). It supersedes [r1](../r1/manifest.md) after plan
review round 1; r1 stays as the record. Any later normative edit to an issue below is `r3`, which needs re-approval and a
plan review of its diff against this revision.

| File | Issue | File SHA-256 |
|---|---|---|
| `spec.md` | [#568](https://github.com/anzchy/mdpro/issues/568) | `37defc16b66d5ecafddc24c4ebf902efe562279247362297bcda591e96c4176d` |
| `tickets/T-01.md` | [#569](https://github.com/anzchy/mdpro/issues/569) | `bccb2c3ce2528076b6c669bc42ff1a311f0b644b8c0a6749eb961048038df32e` |
| `tickets/T-02.md` | [#570](https://github.com/anzchy/mdpro/issues/570) | `783937393b017714b19ee21c60f1bd917206fc910e98d48f4fec78059366c0a3` |
| `tickets/T-03.md` | [#571](https://github.com/anzchy/mdpro/issues/571) | `6553c50e9813dc34a80df303df8b86ec97e7c8445e8fc58db35a8a6c138118ef` |

Each file is the issue body as `gh issue view <n> --json body --jq .body` returned it on 2026-10-31.

## Why r2
Plan review round 1 at `376c7e18` (blob `d06cc4ab`): gpt-auditor NOT READY, C0 H3 M5 L0; opus-auditor NOT READY,
C0 H3 M4 L7. The merged verdict has five Highs:
- the re-attack and new-seam clauses;
- the live version check;
- the undefined Codex attacker;
- T-01 AC-3 against AC-8;
- T-03's first grant before go-live.

All five, and the Mediums and Lows, are fixed here. The merged verdict is at
`~/.mdpro-redesign/herdr-spike/delegator/T567-spec-r1-plan-merged.md`.

## Approval words (user, 2026-10-31)
- r1's words (grill rounds 1–5, the retirement, the seams, the tickets) carry over; see [r1](../r1/manifest.md).
- Round-1 rulings:
  - Codex attacker: 「Same as Claude」;
  - mid-item matrix change: 「Split by kind (Recommended)」;
  - cycle order: 「Verify, then refactor (Recommended)」;
  - version gate: 「prompt.sh + local test (Recommended)」.
- r2 approval: 「Approve r2 (Recommended)」.

## Blocking edges (native GitHub dependencies, unchanged)
- T-01 (#569): #566.
- T-02 (#570): T-01 (#569); also the user's acceptance of ADR-0161, named in the body.
- T-03 (#571): T-02 (#570); also 0.3.6 shipping, named in the body.

## Changed with this snapshot
- ADR-0161 (Proposed): its supersession list, decisions 2–5 and 7, and two cost lines.
- `GLOSSARY.md`: the Cycle order.
