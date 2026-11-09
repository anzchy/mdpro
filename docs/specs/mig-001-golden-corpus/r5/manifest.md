# MIG-001 Golden Corpus spec snapshot r5 (2026-11-09)

A frozen copy of the issue bodies as edited for r5 (rule 12, ADR-0148). r5 fixes opus's r4 confirm findings for the
ADR-0129 residual #720 (R4-H1, R4-M1, R4-M2, R4-L1) and the out-of-scope `setListKind` note inside the same rule,
and changes nothing else normatively. It supersedes r4 (`docs/specs/mig-001-golden-corpus/r4/`, unchanged); r1–r3
are unchanged.

| File | Issue | File SHA-256 |
|---|---|---|
| `spec.md` | [#705](https://github.com/anzchy/mdpro/issues/705) | `4eae17cce47e45f2ad5d9a827cb12af9f542a1c569822c17b400c8cf27902045` |
| `tickets/MIG-001a.md` | [#706](https://github.com/anzchy/mdpro/issues/706) | `8c287c3d85ff61eb9b85f7d9dcd5f8210983f4693d72a849b626be44ce99982d` |
| `tickets/MIG-001b.md` | [#707](https://github.com/anzchy/mdpro/issues/707) | `b5489b36634183db3ff110f2d17a2803fe2457691dedd9250fc931670e5266f7` |
| `tickets/MIG-001c.md` | [#708](https://github.com/anzchy/mdpro/issues/708) | `1751af8701c189ece0cc8c5bddbc9eb0b8ee25df45d970f2d0023e8c2e22320d` |
| `tickets/MIG-001d.md` | [#709](https://github.com/anzchy/mdpro/issues/709) | `47b793f2e4e1f416a6a0e66eaec28a71136169a38a2bf39013a69027727cc1f8` |
| `tickets/MIG-001e.md` | [#710](https://github.com/anzchy/mdpro/issues/710) | `c12a89af3768d7616c2517b18692ff2f9848326c41bae1737273f9f0626fd32c` |
| `tickets/MIG-001f.md` | [#711](https://github.com/anzchy/mdpro/issues/711) | `457fde7e989bb69f5cd5c8be24e05ae5fa7292fbd8333115f691f29d8386869d` |
| `tickets/MIG-001g.md` | [#712](https://github.com/anzchy/mdpro/issues/712) | `63d8846b168d3c38c29757d59c51e88262ced4c27114d9054b6b4c1ca48b72c1` |
| `tickets/MIG-001h.md` | [#713](https://github.com/anzchy/mdpro/issues/713) | `ea7c773e8ed3188186d92a81df220c3d3ca452a9b47a53197ebc96ab08927d3d` |
| `tickets/MIG-001i.md` | [#714](https://github.com/anzchy/mdpro/issues/714) | `6b366756abaa67ba0cc9995aea61d90c6478b683a4af9e3486590e9a1a14cb43` |
| `tickets/MIG-001j.md` | [#715](https://github.com/anzchy/mdpro/issues/715) | `82831b737ba31b73bd6c89b5752b23a4c40557a6975aa65b23f825d428eadc3e` |
| `tickets/MIG-001k.md` | [#716](https://github.com/anzchy/mdpro/issues/716) | `c184c51014c80eb530d5d6dcdc112b1b818d4c4bc0d3be3dcfa8afdf9e3763b4` |
| `tickets/MIG-001l.md` | [#717](https://github.com/anzchy/mdpro/issues/717) | `9c48677c56dbab3bd24f06745066dec13d09b18407bef148208291b946707350` |
| `tickets/MIG-001m.md` | [#718](https://github.com/anzchy/mdpro/issues/718) | `ca4920d50d3ed619fabc8d9dffbf65e7e9d61a9891ccdc54501357a0091a6431` |
| `tickets/MIG-001n.md` | [#719](https://github.com/anzchy/mdpro/issues/719) | `6e65d4cca60cfbc0d2fa82907204efe8af0c49c3fdb48933404aec6561343d0a` |

Each file is the issue body as `gh issue view <n> --json body --jq .body` returned it on 2026-11-09.

## Approval words
- To the delegator (2026-11-09): 「接受 r4，#720 继续跟踪 (Recommended)」; 「先做 r5，再开工 a」.
- r5 approval in the planner pane (2026-11-09): 「Approve r5 (Recommended)」.
- Earlier words stand (r1–r4 manifests).

## What changed from r4
- Spec #705, edited `semantic-roundtrip` rule: the splitter runs at every ADR-0091 level (document, blockquote, list
  item) after prefix removal; lists are a level of items; "touched" defined per level, `setListKind` touching the
  whole list; S:152's "only as the length of a separator" and the "Not caught" note corrected (prefix spelling in a
  touched container declared); `type` line-break model per container (ADR-0091 decisions 1–3), empty predicted
  blocks merging separators, no model for a table cell or a second break on an empty item (escalation); multi-block
  `paste` predicts its own separators; cross-block selection anchors; header line names r5.
- Ticket a (#706): Ta:30 gains rejection (4), the quote case and its list variant.
- Tickets b…n: parent line "spec r4" → "spec r5" only (not normative).
- #705 title "(r4)" → "(r5)".

## Blocking edges
- Native, unchanged by r5: MIG-001b…n (#707–#719) ← MIG-001a (#706); #706 ← #720.

## Related
- Residual #720; records `delegator/mig-001/r4-merged.md`, `opus-auditor/mig-001-r4-confirm.md`.
- Findings map: `~/.mdpro-redesign/planner/mig-001-golden-corpus/r5/findings-map.md`. No ADR.
