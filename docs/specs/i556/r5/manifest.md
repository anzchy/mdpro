# I556 spec snapshot r5 (2026-10-30)

Frozen copy of the issue bodies for #556 item 4, the landing gate (rule 12, ADR-0148). **r5 supersedes r4**
(`docs/specs/i556/r4/`, which stays in the tree). Any normative edit to the issues below makes `r6`, which needs
re-approval and a plan review of its diff against this revision.

r5 answers the post-cap raiser confirms of r4: opus-auditor marked every finding CLOSED; gpt-auditor kept H3 OPEN
(COUNT C0 H1 M0 L0 · BLOCKING C0 H1), because the land-open check did not enforce ADR-0129 decision 4's full record.
Both reports are outside the repo, at `~/.mdpro-redesign/herdr-spike/{opus,gpt}-auditor/I556-spec-r4-confirm.md`. The
user ruled under ADR-0129 (below): the landing command refuses every `post-cap land-open` row, and landing a finding
open goes to the user by hand. `changes-from-r4.md` maps each edit. Only `spec.md` (#557) and `tickets/T-04.md` (#561)
change.

| File | Issue | Body SHA-256 |
|---|---|---|
| `spec.md` | [#557](https://github.com/anzchy/mdpro/issues/557) | `e3bc87048a7f0de0b0007c47843669a125a584964ecb2fb1a08fa7bad0b025ec` |
| `tickets/T-01.md` | [#558](https://github.com/anzchy/mdpro/issues/558) | `151fb634153a668a484999889873eee27dcea68afe892881bb6eb608c4f3a3b1` (unchanged from r4) |
| `tickets/T-02.md` | [#559](https://github.com/anzchy/mdpro/issues/559) | `a7b1f81b840b644225a535742da507e93e4a86cd66d4228d156760a9f5342c46` (unchanged from r4) |
| `tickets/T-03.md` | [#560](https://github.com/anzchy/mdpro/issues/560) | `dedf541df80d170c565f423d642d71560e8730bb6f84508d842fe9a94658c03f` (unchanged from r3) |
| `tickets/T-04.md` | [#561](https://github.com/anzchy/mdpro/issues/561) | `d2183e8afc00a931ae7885f4c05e21daa5e9f72140c82469345a3ec2c62cce10` |
| `tickets/T-05.md` | [#562](https://github.com/anzchy/mdpro/issues/562) | `253090412850b89ed267579eeef5d5f5e3f38cb1258ca494be65db48d0cb0299` (unchanged from r3) |
| `tickets/T-06.md` | [#563](https://github.com/anzchy/mdpro/issues/563) | `143a7d260f2aaac71bcf38b0ac819ca71fb01feead07621387d624fac1e2a546` (unchanged from r4) |

Each hash is of `gh issue view <n> --json body --jq .body`, as written to that file: the body plus the one trailing
newline that `jq` adds. The #557 and #561 hashes are of the r5 files, written before those issues were edited; the
live bodies must hash to them after `gh issue edit`. Parent issue: [#556](https://github.com/anzchy/mdpro/issues/556) (item 4); the tickets are
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
- r4 post-cap ruling (ADR-0129, one return, no second fix), on gpt-auditor's open H3:
  - 「Narrow: refuse every land-open (Recommended)」 (the landing command refuses every `post-cap land-open` row, failing
    closed; landing a finding open is the ADR-0129 manual path, by the user's ruling and by hand).
- r5 approval (user, 2026-10-30): 「Approve r5 (Recommended)」. Review: 「Diff-only review, later (Recommended)」 — both auditors plan-review the r4→r5 diff before T-04 (#561) is briefed.

## Blocking edges (native GitHub dependencies, as verified by GET for r4; unchanged from r3 and r4)
- T-01 (#558): none.
- T-02 (#559): #558.
- T-03 (#560): #558.
- T-04 (#561): #558, #559, #560.
- T-05 (#562): #558.
- T-06 (#563): #558, #559, #560, #561, #562. Also, as written in its body: #556 item 1 has landed.

## Related
- ADR-0159 (Proposed, revised for r5): `docs/adr/0159-landing-is-checked-against-the-records-by-one-command-and-policy-files-land-by-pr.md`.
- Terms: `GLOSSARY.md` § Landing (no new term in r4 or r5).
- Previous revision: `docs/specs/i556/r4/`.
