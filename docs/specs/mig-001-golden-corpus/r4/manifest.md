# MIG-001 Golden Corpus spec snapshot r4 (2026-11-09)

A frozen copy of the issue bodies as edited for r4 (rule 12, ADR-0148). r4 fixes the ADR-0129 residual tracked in
#720 (R3-H1, the unfixed instance of R2-H2) and opus's r3 Lows L1 and L2, and changes nothing else normatively.
It supersedes r3 (`docs/specs/mig-001-golden-corpus/r3/`, unchanged); r1 and r2 are unchanged.

| File | Issue | File SHA-256 |
|---|---|---|
| `spec.md` | [#705](https://github.com/anzchy/mdpro/issues/705) | `4ddbccd6e06a7824fcdeb8161adbb62b520175f10a1e3c552c7ef9cc78a8b36b` |
| `tickets/MIG-001a.md` | [#706](https://github.com/anzchy/mdpro/issues/706) | `e6ba2714aa7737619a36c4087cad37474f1c16f8487d5bad0aa3737161b32953` |
| `tickets/MIG-001b.md` | [#707](https://github.com/anzchy/mdpro/issues/707) | `c8c6f8fd742b29fccd3b407371649e1351740558769dde438819309995a3a840` |
| `tickets/MIG-001c.md` | [#708](https://github.com/anzchy/mdpro/issues/708) | `7f557996010bc62005e567322ee16508a0839a3d49c4e097081d50d8672e93ce` |
| `tickets/MIG-001d.md` | [#709](https://github.com/anzchy/mdpro/issues/709) | `08eb8e0d096e9fca2f215294531a838ee1ecee5401e009d66de61d6a220bdf00` |
| `tickets/MIG-001e.md` | [#710](https://github.com/anzchy/mdpro/issues/710) | `90825db9eaeb7502b47db91578815aa69005caf3c137d88669799f3c2e34565a` |
| `tickets/MIG-001f.md` | [#711](https://github.com/anzchy/mdpro/issues/711) | `58fc3d78a8140b9b420ccdcc3498aee926d27b35a04ad65609e98e074d18ada8` |
| `tickets/MIG-001g.md` | [#712](https://github.com/anzchy/mdpro/issues/712) | `cd46795d1dffc3a43b75fda9d1455128aab45393af25ccba6925fd71ba0857a1` |
| `tickets/MIG-001h.md` | [#713](https://github.com/anzchy/mdpro/issues/713) | `0045a895d5f1e0e65c5d33fa0bd3e570583745b011de0f38fa755b782d3a5e85` |
| `tickets/MIG-001i.md` | [#714](https://github.com/anzchy/mdpro/issues/714) | `14e1c5b6d09ed13366479b5a1bd5e80e4aea4c184490672c2ca6bc1b9818c3e2` |
| `tickets/MIG-001j.md` | [#715](https://github.com/anzchy/mdpro/issues/715) | `8e1f000388395dd03bfac857b9cf908d8329d7ddd199e14e52944aabc745f388` |
| `tickets/MIG-001k.md` | [#716](https://github.com/anzchy/mdpro/issues/716) | `22cf1e91f3275cfd1729e80dfaf9fdb114cd8aa885591ac9bac73a0d88512a99` |
| `tickets/MIG-001l.md` | [#717](https://github.com/anzchy/mdpro/issues/717) | `9315fed01586dcc802965dc149f7acaeeed934be3068193cb124108fc74d7e36` |
| `tickets/MIG-001m.md` | [#718](https://github.com/anzchy/mdpro/issues/718) | `bb93d5ea5b11901b053dc133928ffaec9f3181b9161d91a3ef05d95d212081e7` |
| `tickets/MIG-001n.md` | [#719](https://github.com/anzchy/mdpro/issues/719) | `ddfb4d9320877bcec319a2a2c17b19bdb3f9e341338111be4c5827d3f6fd48d7` |

Each file is the issue body as `gh issue view <n> --json body --jq .body` returned it on 2026-11-09.

## Approval words
- Ruling to the delegator (2026-11-08): 「Accept r3, track residual (Recommended)」.
- Instruction to the delegator (2026-11-09): 「让 planner 现在就做 MIG-001 的 r4，修 #720」.
- r4 approval in the planner pane (2026-11-09): 「Approve r4 (Recommended)」.
- Earlier words stand (r1–r3 manifests).

## What changed from r3
- Spec #705: check 1 keeps blank-line separators as tokens and compares those between untouched blocks; check 2
  adds the separator model (unchanged except a named split or join: `type` with a line break, `delete` across
  blocks, multi-block `paste`); the "Not caught" note says separators are compared; `propagated` listener is
  bubble-phase (L1); `largeDocGuard` reads "the case's content" (L2); header line names r4.
- Ticket a (#706): Ta:30 gains the third required rejection and its moved-paragraph variant.
- Tickets b…n: parent line "spec r3" → "spec r4" only (not normative).
- #705 title "(r3)" → "(r4)".

## Blocking edges
- Native, unchanged by r4: MIG-001b…n (#707–#719) ← MIG-001a (#706). #706 ← #720 (the delegator's edge for this residual).

## Related
- Residual issue #720; records `delegator/mig-001/r3-merged.md`, `opus-auditor/mig-001-r3-confirm.md`.
- Findings map: `~/.mdpro-redesign/planner/mig-001-golden-corpus/r4/findings-map.md`.
- No ADR.
