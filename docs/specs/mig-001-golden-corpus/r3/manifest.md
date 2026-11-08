# MIG-001 Golden Corpus spec snapshot r3 (2026-11-08)

A frozen copy of the issue bodies as edited for r3 (rule 12, ADR-0148). r3 is a post-cap, scoped revision
(ADR-0129): it fixes R2-H1, R2-H2, R2-H3 and R2-M1 and Lows L1 and L3 from the round-2 confirm, and changes nothing
else normatively. It supersedes r2 (`docs/specs/mig-001-golden-corpus/r2/`, unchanged) and r1 (unchanged).

| File | Issue | File SHA-256 |
|---|---|---|
| `spec.md` | [#705](https://github.com/anzchy/mdpro/issues/705) | `c599d5baa8d2bfad3434fe5dc11880ef0698710bc42e577e9f138d79631cf692` |
| `tickets/MIG-001a.md` | [#706](https://github.com/anzchy/mdpro/issues/706) | `19e5d3b473ac7225baee7fb62dcab03d65824fd43f241a58c8d77e6b0f3f08d3` |
| `tickets/MIG-001b.md` | [#707](https://github.com/anzchy/mdpro/issues/707) | `bd0268c6ab75164d104e477e8cefff2fce200c346bc35884296517bfda5fb9b2` |
| `tickets/MIG-001c.md` | [#708](https://github.com/anzchy/mdpro/issues/708) | `42ed643a8b1f414106b7871139773fce8fce687c57a59d224c71c5b16a4c972f` |
| `tickets/MIG-001d.md` | [#709](https://github.com/anzchy/mdpro/issues/709) | `60c849d94bd578ed2cc15253e71617adc15ff34f51f9047fbef0308eea273855` |
| `tickets/MIG-001e.md` | [#710](https://github.com/anzchy/mdpro/issues/710) | `b570441243f8da3599ef1c176e4beba2ab3d77ad5d41778c9fe87e289bc825e2` |
| `tickets/MIG-001f.md` | [#711](https://github.com/anzchy/mdpro/issues/711) | `4f94127e7e392d9bd243ded52ed46bc6d29a48f9deec3f167d654e9c31b56ea5` |
| `tickets/MIG-001g.md` | [#712](https://github.com/anzchy/mdpro/issues/712) | `ed69bf5d4a8d51b00a0e0c8918dfeba4f7a4953e308db4d6287732a5affe7434` |
| `tickets/MIG-001h.md` | [#713](https://github.com/anzchy/mdpro/issues/713) | `1b3c3e0a7bcf0c43c4825b2191fe3782492be9f2e6941e6ee0679a99dd2860ae` |
| `tickets/MIG-001i.md` | [#714](https://github.com/anzchy/mdpro/issues/714) | `5f6a91dda9cecd7c3bd960aa01e158b041881c0f43da46eff5aa2fa9df31b4ba` |
| `tickets/MIG-001j.md` | [#715](https://github.com/anzchy/mdpro/issues/715) | `c5633cfd4092762fcc953829183b7f464a7489afb455ac40ed4a52cb444c7625` |
| `tickets/MIG-001k.md` | [#716](https://github.com/anzchy/mdpro/issues/716) | `8422fa2ec6cfcc35c07b05c83d048f0e33c72f82740e61ba86b24ec16c1492da` |
| `tickets/MIG-001l.md` | [#717](https://github.com/anzchy/mdpro/issues/717) | `6f2c0f86f68dd9b2ef791ccc4326e1401a44168754b4fc78d8abc6820c400a12` |
| `tickets/MIG-001m.md` | [#718](https://github.com/anzchy/mdpro/issues/718) | `4251242098141de902a40365e3343adbabfab6a9746787e055059ae7fc82e6ea` |
| `tickets/MIG-001n.md` | [#719](https://github.com/anzchy/mdpro/issues/719) | `69537c6855fa91f42689a892445b71ed9393de59caad49ecc06dc221aaaf57a1` |

Each file is the issue body as `gh issue view <n> --json body --jq .body` returned it on 2026-11-08.

## Approval words (user, 2026-11-08)
- Ruling to the delegator after the cap (quoted in the r3 revise brief): 「r3 + scoped confirm (Recommended)」.
- r3 re-approval in the planner pane: 「Approve r3 (Recommended)」.
- Earlier words stand: r2 rulings 「Content-level + device card (Recommended)」, 「Add activate-link action
  (Recommended)」, 「Either side passes (Recommended)」; Q1–Q6 「全部 yes」; r2 re-approval 「yes」.

## What changed from r2
- Spec #705: guard-only records (new section, `caseKind`); untouched and tag rules scoped to mounting records;
  edited/interaction `semantic-roundtrip` rule rewritten (unedited blocks, action-aware text, literal whitespace in
  code); `linkActivation` derived from the guard's events and propagation, with `reason` and `no-href`; runner origin
  for `activateLink`; cell anchor and `setListKind { at: caret }` (L1); `activateLink` modifier removed (L3); row j.
- All 14 tickets: parent line r3; common AC 1 and AC 4 scoped to mounting cases.
- Tickets a, j, m: their fix-specific scope and ACs.

## Blocking edges
- Native, unchanged: MIG-001b…n (#707–#719) ← MIG-001a (#706). Unblocked: #706.

## Related
- Merged confirm r2: C0 H3 M1 L4 (delegator `mig-001/r2-merged.md`). Scoped confirm: each raiser on the r2→r3 diff.
- Findings map: `~/.mdpro-redesign/planner/mig-001-golden-corpus/r3/findings-map.md`.
- No ADR. Title change: #705 "(r2)" → "(r3)".
