# I556 spec snapshot r4 (2026-10-30)

Frozen copy of the issue bodies for #556 item 4, the landing gate (rule 12, ADR-0148). **r4 supersedes r3**
(`docs/specs/i556/r3/`, which stays in the tree). Any normative edit to the issues below makes `r5`, which needs
re-approval and a plan review of its diff against this revision.

r4 answers the round-2 plan review of r3 (ADR-0143): gpt-auditor C0 H3 M1 L0 and opus-auditor C0 H1 M3 L3, merged as
Z1–Z8. That review reached the two-round cap, and the user ruled under ADR-0129 (below). Both reports and the merged
verdict are planner-local, outside the repo. `changes-from-r3.md` maps each finding to the edit that answers it. Per
the cap ruling, each raiser confirms on the r3→r4 diff only before any grant.

| File | Issue | Body SHA-256 |
|---|---|---|
| `spec.md` | [#557](https://github.com/anzchy/mdpro/issues/557) | `661e6ff4fe858153fc387b0ec1d2589dd5d04864abfff615b6b2b89b52863cd5` |
| `tickets/T-01.md` | [#558](https://github.com/anzchy/mdpro/issues/558) | `151fb634153a668a484999889873eee27dcea68afe892881bb6eb608c4f3a3b1` |
| `tickets/T-02.md` | [#559](https://github.com/anzchy/mdpro/issues/559) | `a7b1f81b840b644225a535742da507e93e4a86cd66d4228d156760a9f5342c46` |
| `tickets/T-03.md` | [#560](https://github.com/anzchy/mdpro/issues/560) | `dedf541df80d170c565f423d642d71560e8730bb6f84508d842fe9a94658c03f` (unchanged from r3) |
| `tickets/T-04.md` | [#561](https://github.com/anzchy/mdpro/issues/561) | `b9cd8c91bb31f8596036a19095771e9312734e4e35e4dd2be4c2d4a559d8fceb` |
| `tickets/T-05.md` | [#562](https://github.com/anzchy/mdpro/issues/562) | `253090412850b89ed267579eeef5d5f5e3f38cb1258ca494be65db48d0cb0299` (unchanged from r3) |
| `tickets/T-06.md` | [#563](https://github.com/anzchy/mdpro/issues/563) | `143a7d260f2aaac71bcf38b0ac819ca71fb01feead07621387d624fac1e2a546` |

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
- r3 round-2 cap rulings (ADR-0129):
  - 「修成 r4 + 限定复核 (Recommended)」 (fix Z1–Z8 as r4; each raiser confirms on the r3→r4 diff only);
  - on Z2, 「算，强制 High (Recommended)」 (rules 60, 70 and 71, `CLAUDE.md`, `AGENTS.md`, the delegator `SKILL.md` and
    `references/**` are gate-sensitive).

## Blocking edges (native GitHub dependencies, verified by GET; unchanged from r3)
- T-01 (#558): none.
- T-02 (#559): #558.
- T-03 (#560): #558.
- T-04 (#561): #558, #559, #560.
- T-05 (#562): #558.
- T-06 (#563): #558, #559, #560, #561, #562. Also, as written in its body: #556 item 1 has landed.

## Related
- ADR-0159 (Proposed, revised for r4): `docs/adr/0159-landing-is-checked-against-the-records-by-one-command-and-policy-files-land-by-pr.md`.
- Terms: `GLOSSARY.md` § Landing (no new term in r4).
- Previous revision: `docs/specs/i556/r3/`.
