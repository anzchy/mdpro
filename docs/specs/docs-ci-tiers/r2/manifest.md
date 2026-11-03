# docs-ci-tiers spec snapshot r2 (2026-11-03)

A frozen copy of the issue bodies as published after the r1 plan review returned NOT READY
(`~/.mdpro-redesign/herdr-spike/delegator/docs-ci-tiers-r1-plan-merged.md`, MH1–MH7). It supersedes
[r1](../r1/manifest.md). Any later normative edit to an issue below is `r3`, which needs re-approval and a plan
review of its diff against this revision. No brief cites r2 until both auditors' plan review of the r1→r2 diff passes.

| File | Issue | File SHA-256 |
|---|---|---|
| `spec.md` | [#594](https://github.com/anzchy/mdpro/issues/594) | `5c43d47246ec7412b4082fd8dfc6336a9dae3f3f5d65c0023ccac5e9feb44848` |
| `tickets/T-01.md` | [#595](https://github.com/anzchy/mdpro/issues/595) | `9f9f72e718a1455cd659b78c7e6da15ece1df52c20b2441e5f5e268d4939f60e` |
| `tickets/T-02.md` | [#596](https://github.com/anzchy/mdpro/issues/596) | `9128ab2cc3912289faab17cd9a5599b5ce121a0660a71b1525a77ae639bfe76f` |
| `tickets/T-03.md` | [#597](https://github.com/anzchy/mdpro/issues/597) | `8bf00e1f925e3f2c58acbb57cb8e077f36305bb4b291ab574785ba5d38b8e399` |
| `tickets/T-04.md` | [#598](https://github.com/anzchy/mdpro/issues/598) | `72ed1725faf2b5de52a9826462f50a8583833cdf3115cc5a7b172d22ec0ef179` |
| `tickets/T-05.md` | [#599](https://github.com/anzchy/mdpro/issues/599) | `2608aedfbe9a787982f5d902dfad901b908ade39fec275345a726aa8d06e4deb` |
| `tickets/T-06.md` | [#600](https://github.com/anzchy/mdpro/issues/600) | `1409ddff78c829cdcef217833867847f234443cc76a9be73a4d682a1795f0979` |
| `tickets/T-07.md` | [#601](https://github.com/anzchy/mdpro/issues/601) | `6b22321d70d02ff24f295611d44a4b93a9effc688eb097812f1abdf13eec79be` |
| `tickets/T-09.md` | [#603](https://github.com/anzchy/mdpro/issues/603) | `6995cbb1d4643ad6d071995a97e0c224c0980d639f9d705788185a7227afcb9c` |

Each file is the issue body as `gh api repos/anzchy/mdpro/issues/<n>` returned it after publication, and each hash
equals the one the planner recorded. **T-08 (#602) is closed as not planned**, folded into T-07 (#601); its body is
unchanged and stays in [r1](../r1/tickets/T-08.md).

## Approval words (user, 2026-11-03)
- Revision route, after the NOT READY plan review: 「Planner revises r2 now (Recommended)」.
- r2: 「Approve r2 (Recommended)」.
- r1's approvals (see [r1](../r1/manifest.md)) carry over for what r2 does not change.

## Blocking edges (read back from GitHub after publication)
- Native: T-02 (#596) ← T-01 (#595); T-03 (#597) ← T-01; T-05 (#599) ← T-01 (new in r2); T-06 (#600) ← T-02 (new in
  r2); T-07 (#601) ← T-02.
- In the body: T-06 and T-07 name PRs #549 and #575 as landed first.
- No blockers: T-01 (#595), T-04 (#598), T-09 (#603). 0.3.6 is no longer a blocker (tag `v0.3.6`).

## Not in this snapshot
Seven decision-log drafts (one per ticket that changes a rule, DCT-r2-D20) and the findings map stay with the planner
under `~/.mdpro-redesign/planner/docs-ci-tiers/r2/` until their tickets land. They go to the plan review with this
snapshot.
