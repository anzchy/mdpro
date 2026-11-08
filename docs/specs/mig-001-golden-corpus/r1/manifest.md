# MIG-001 Golden Corpus spec snapshot r1 (2026-11-07)

A frozen copy of the issue bodies as published (rule 12, ADR-0148). Any later normative edit to an issue below is `r2`,
which needs re-approval and a plan review of its diff against this revision.

| File | Issue | File SHA-256 |
|---|---|---|
| `spec.md` | [#705](https://github.com/anzchy/mdpro/issues/705) | `8aa6dc02ec4d6e539bebe337201d1aca5e52734c3369bd7e4e14c5126f06eb05` |
| `tickets/MIG-001a.md` | [#706](https://github.com/anzchy/mdpro/issues/706) | `d07fd60acde24170447c98365af82c8ec378755ddeeddb0afa4785cebf2f6db8` |
| `tickets/MIG-001b.md` | [#707](https://github.com/anzchy/mdpro/issues/707) | `7ac52bc227bad82c9569b45b215cc1dde17bc851d29642ad6198c654e6786e51` |
| `tickets/MIG-001c.md` | [#708](https://github.com/anzchy/mdpro/issues/708) | `8cd7f1d8c86c5fee7cc0f547ccde2d9e1521b7c595c57c5671699be4ef2fad83` |
| `tickets/MIG-001d.md` | [#709](https://github.com/anzchy/mdpro/issues/709) | `69715a332395de3d7d3e34f1d2e23a3dbb69bf8b056b67d4f1697644038b8adb` |
| `tickets/MIG-001e.md` | [#710](https://github.com/anzchy/mdpro/issues/710) | `18e84037ab076620c8296a73d1a27408840aec4544fcf92ff3e8902f33dc58db` |
| `tickets/MIG-001f.md` | [#711](https://github.com/anzchy/mdpro/issues/711) | `d7330dd329bfeacebcd21a7b4921232cc7061067e47f985920548104f0e457a8` |
| `tickets/MIG-001g.md` | [#712](https://github.com/anzchy/mdpro/issues/712) | `bdd0fded3ad02a6a8b0f7c143f7d062fc14b83023c30360d2b12281ef4469f6c` |
| `tickets/MIG-001h.md` | [#713](https://github.com/anzchy/mdpro/issues/713) | `8d5e47f3ed3e10cb54881ca6ddc4bdd0534062bef3a36f5b7cb77b80b228f871` |
| `tickets/MIG-001i.md` | [#714](https://github.com/anzchy/mdpro/issues/714) | `a41ac96c16891adf5163d94fa0c435fb0cbf5a4dd89cbbd1c3bb1d33841a8048` |
| `tickets/MIG-001j.md` | [#715](https://github.com/anzchy/mdpro/issues/715) | `04c0f1ccce387a13d7d8e17224b0599f310dca9c850a594b656f4ebabfe99c09` |
| `tickets/MIG-001k.md` | [#716](https://github.com/anzchy/mdpro/issues/716) | `de55b2e8c62669715054070fea97d409ead3bef9399b0f106fa68986c49992f3` |
| `tickets/MIG-001l.md` | [#717](https://github.com/anzchy/mdpro/issues/717) | `45ad7fa197d562c2591997238454b397659e3e104ce237bfe3f9c227b787c220` |
| `tickets/MIG-001m.md` | [#718](https://github.com/anzchy/mdpro/issues/718) | `bd6e53e05229940e674af0bd37a61ae9766edc77cb62046aac94eaacf6a306ae` |
| `tickets/MIG-001n.md` | [#719](https://github.com/anzchy/mdpro/issues/719) | `05050be83d74bb6d574c9557383788625b7a838bbe6b36a227a72e99c8b6ff12` |

Each file is the issue body as `gh issue view <n> --json body --jq .body` returned it on 2026-11-07.

## Approval words (user, 2026-11-07)
- Grill (Q1–Q29, Q9b and two self-corrections): 「全部 yes」.
- Test seams (engine driver interface; Tauri module mock; `corpus:check` CLI): 「yes」.
- Ticket breakdown (14 tickets a…n, a unsplit, b…n blocked only by a, no merges): 「yes」.

## Blocking edges
- Native: MIG-001b…n (#707–#719) ← MIG-001a (#706). Unblocked: MIG-001a (#706).

## Related
- Parent: spec #705, a sub-issue of row #697. Plan `docs/plans/20261107-mdpro_tiptap_windows_plan_v1-3.md` §5 MIG-001; decisions #681.
- No ADR (test-internal conventions; CLAUDE.md § ADR, ADR-0165). Not gate-sensitive (no new job or gate input).
- Glossary candidates: `~/.mdpro-redesign/planner/mig-001-golden-corpus/glossary-candidates.md` (proposed section "Golden Corpus").
- Planner folder: `~/.mdpro-redesign/planner/mig-001-golden-corpus/` (`seed.md`, `grill-decisions.md`, `spec.md`, `tickets/`, `handoff.md`).
