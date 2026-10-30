# I556 spec snapshot r2 (2026-10-30)

Frozen copy of the issue bodies the user approved for #556 item 4, the landing gate (rule 12, ADR-0148). Any normative
edit to the issues below makes `r3`, which needs re-approval and a plan review of its diff against this revision.

r1 was published to the same issues on 2026-10-30 but never frozen. An informal Opus and Fable review of it (C0 H10 and C0 H5,
13 merged blocking issues) led to this revision. `changes-from-r1.md` maps each finding to the edit that answers it.

| File | Issue | Body SHA-256 |
|---|---|---|
| `spec.md` | [#557](https://github.com/anzchy/mdpro/issues/557) | `da1efd07c6640b5c98e1d67a7bc7458b69d68696a5ea4e3ef6ca9bde005dda79` |
| `tickets/T-01.md` | [#558](https://github.com/anzchy/mdpro/issues/558) | `604b6ca010be32e12ce0203ec5699dc264962f61a1c217b29e523fb8b5a2f13d` |
| `tickets/T-02.md` | [#559](https://github.com/anzchy/mdpro/issues/559) | `c772458e58e544bdb16e4472e430b1ea24b79faeccd2c113af611fd4b90eee20` |
| `tickets/T-03.md` | [#560](https://github.com/anzchy/mdpro/issues/560) | `2290d07cde7db473f21ded971528fa8f1f626ffc3f04068c984dbdc915dd9acf` |
| `tickets/T-04.md` | [#561](https://github.com/anzchy/mdpro/issues/561) | `7a6ef63772264802f0e9679cb4ff30b678895d85b12af9c440dcf655776a8f40` |
| `tickets/T-05.md` | [#562](https://github.com/anzchy/mdpro/issues/562) | `722f886e02fa065b110c0c56cfba7bbae9916ef7d4873778a47dadbef136ad74` |
| `tickets/T-06.md` | [#563](https://github.com/anzchy/mdpro/issues/563) | `ef301e093d9a2868f811a464c394fc7c214a4120141ae1fd39efa9d70b47c7f8` |

Each hash is of `gh issue view <n> --json body --jq .body`, as written to that file. The file is the body plus the one
trailing newline that `jq` adds. Parent issue: [#556](https://github.com/anzchy/mdpro/issues/556) (item 4); the
tickets are sub-issues of #557.

## Approval words (user, 2026-10-30)
- Grill of #556 item 4: 「全部同意」 four times (Q1–Q17; rounds in `~/.mdpro-redesign/planner/I556/grill.md`).
- Seams: 「对的」.
- Ticket breakdown: 「1.yes 2.yes 3.no」.
- r1 review rulings:
  - 「Accept ruling row (Recommended)」 (post-cap rows);
  - 「Low-tier gpt audit (Recommended)」 (routine Policy PRs are audited, revising Q6);
  - 「docs/agents/**」 (a Policy file);
  - 「Yes, both (Recommended)」 (delegator overlay and `MDPRO_ROLE=delegator` on the Claude route).
- r2 approval rulings:
  - 「No, both auditors」 (routine Policy PRs keep both auditors; ADR-0143 is untouched);
  - 「ci-gate + audit only (Recommended)」 (routine Policy PRs need no verifier record);
  - 「Approve, proceed (Recommended)」.

## Blocking edges (native GitHub dependencies, verified by GET)
- T-01 (#558): none.
- T-02 (#559): #558.
- T-03 (#560): #558.
- T-04 (#561): #558, #559, #560.
- T-05 (#562): #558.
- T-06 (#563): #558, #559, #560, #561, #562. Also, as written in its body: #556 item 1 has landed.

## Related
- ADR-0159 (Proposed): `docs/adr/0159-landing-is-checked-against-the-records-by-one-command-and-policy-files-land-by-pr.md`.
- Terms: `GLOSSARY.md` § Landing.
