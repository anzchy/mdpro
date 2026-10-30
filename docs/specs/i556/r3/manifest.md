# I556 spec snapshot r3 (2026-10-30)

Frozen copy of the issue bodies the user approved for #556 item 4, the landing gate (rule 12, ADR-0148). **r3 supersedes
r2** (`docs/specs/i556/r2/`, which stays in the tree). Any normative edit to the issues below makes `r4`, which needs
re-approval and a plan review of its diff against this revision.

r3 answers the round-1 plan review of r2 (ADR-0143): gpt-auditor C0 H2 M2 L0 and opus-auditor C0 H2 M7 L7. Both reports
and the merged verdict are planner-local, outside the repo. `changes-from-r2.md` maps each finding to the edit that
answers it.

| File | Issue | Body SHA-256 |
|---|---|---|
| `spec.md` | [#557](https://github.com/anzchy/mdpro/issues/557) | `871f7fe01186837b9c1f12fcaa04580d15875e671e68e86c30c2eca0daa8088e` |
| `tickets/T-01.md` | [#558](https://github.com/anzchy/mdpro/issues/558) | `166b9901319cf28cd4bc3e0e561028a6e83bdc93a612a832b7c751d45b115214` |
| `tickets/T-02.md` | [#559](https://github.com/anzchy/mdpro/issues/559) | `10464b0c51c9c339f7db7572baa281a4c8cbbb6cd9f2aeca3cdf53bfaa88b46d` |
| `tickets/T-03.md` | [#560](https://github.com/anzchy/mdpro/issues/560) | `dedf541df80d170c565f423d642d71560e8730bb6f84508d842fe9a94658c03f` |
| `tickets/T-04.md` | [#561](https://github.com/anzchy/mdpro/issues/561) | `573385e9d124ee6762526e4895a2ec8c8fe331d3efbddfafcefa6badd4a35739` |
| `tickets/T-05.md` | [#562](https://github.com/anzchy/mdpro/issues/562) | `253090412850b89ed267579eeef5d5f5e3f38cb1258ca494be65db48d0cb0299` |
| `tickets/T-06.md` | [#563](https://github.com/anzchy/mdpro/issues/563) | `5c4fccf83e4b9292823830173e4d4aee95b2464979ea51de778f1f78f7642a6e` |

Each hash is of `gh issue view <n> --json body --jq .body`, as written to that file: the body plus the one trailing
newline that `jq` adds. Parent issue: [#556](https://github.com/anzchy/mdpro/issues/556) (item 4); the tickets are
sub-issues of #557.

## Approval words (user, 2026-10-30)
- Grill of #556 item 4: 「全部同意」 four times (Q1–Q17).
- Seams: 「对的」.
- Ticket breakdown: 「1.yes 2.yes 3.no」.
- r1 review rulings: 「Accept ruling row (Recommended)」, 「Low-tier gpt audit (Recommended)」, 「docs/agents/**」,
  「Yes, both (Recommended)」.
- r2 approval rulings: 「No, both auditors」, 「ci-gate + audit only (Recommended)」, 「Approve, proceed (Recommended)」.
- r2 round-1 plan review ruling: 「好，按方案一起草 r3」 (keep the routine route; the command forces the audited route for
  gate-sensitive paths).
- r3 confirmation rulings:
  - 「同意收紧 (Recommended)」 (standing exceptions only through the verifier's `CARRIED` line; `ci-gate` exceptions for
    one landing and one SHA);
  - 「同意 (Recommended)」 (an unset role in the main checkout counts as the delegator);
  - 「两个都强制」 (both auditors' security lines required on High tier);
  - 「release/x.y 纳入范围, 带开放问题落地, 扩大门禁文件列表, routine 路由收窄」 (the four other drafting decisions).

## Blocking edges (native GitHub dependencies, verified by GET; unchanged from r2)
- T-01 (#558): none.
- T-02 (#559): #558.
- T-03 (#560): #558.
- T-04 (#561): #558, #559, #560.
- T-05 (#562): #558.
- T-06 (#563): #558, #559, #560, #561, #562. Also, as written in its body: #556 item 1 has landed.

## Related
- ADR-0159 (Proposed, revised for r3): `docs/adr/0159-landing-is-checked-against-the-records-by-one-command-and-policy-files-land-by-pr.md`.
- Terms: `GLOSSARY.md` § Landing.
- Previous revision: `docs/specs/i556/r2/`.
