# docs-ci-tiers spec snapshot r3 (2026-11-03)

A frozen copy of the issue bodies as published after the r2 plan review returned NOT READY
(`~/.mdpro-redesign/herdr-spike/delegator/docs-ci-tiers-r2-plan-merged.md`, r2-H1..H3). It supersedes
[r2](../r2/manifest.md). Any later normative edit to an issue below is `r4`, which needs re-approval and a plan
review of its diff against this revision. **No brief cites r3 until both scoped confirms of the r2→r3 diff are
CLOSED**: gpt-auditor confirms r2-H1 and r2-H2, and opus-auditor confirms r2-H3.

| File | Issue | File SHA-256 |
|---|---|---|
| `spec.md` | [#594](https://github.com/anzchy/mdpro/issues/594) | `a6854be9d0314ed9f852b3d3e8f291ede2b31ad18f2d5ed244558f89b19d2432` |
| `tickets/T-01.md` | [#595](https://github.com/anzchy/mdpro/issues/595) | `15284c5f89d5b4e17cbab6e8b6281ba2d6209798490782de92c60c5d3ca75224` |
| `tickets/T-02.md` | [#596](https://github.com/anzchy/mdpro/issues/596) | `e07f2a1cbdcdbc336ec2a1bf0e691b5184f1ba4c19ffadbede088aba5f0c7b5c` |
| `tickets/T-03.md` | [#597](https://github.com/anzchy/mdpro/issues/597) | `b3c27e520476bc6ea38fb56dd94267aecc5d97e5488281e7baae9395e86e9081` |
| `tickets/T-04.md` | [#598](https://github.com/anzchy/mdpro/issues/598) | `f52453f2313a9d686309344754ad18264c09aef4b342183fd0d018212d21f874` |
| `tickets/T-05.md` | [#599](https://github.com/anzchy/mdpro/issues/599) | `4ccdc5e00ecc4a6013613a68cd485e310e7780b31924a90949f046618d3a6f98` |
| `tickets/T-06.md` | [#600](https://github.com/anzchy/mdpro/issues/600) | `7f0055aad673355c54b02e7a4f86cc1b6cf233e0961e186e0c497bf2235a6eca` |
| `tickets/T-07.md` | [#601](https://github.com/anzchy/mdpro/issues/601) | `6a56d6464316b5d795f76825f665fb4b5f5989b73ca458dd562966018fedd0cd` |
| `tickets/T-09.md` | [#603](https://github.com/anzchy/mdpro/issues/603) | `2e2889a5145426c0b5f07ef3b2d491efd2be24dec852210cf443e410b404e9cb` |

Each file is the issue body as `gh api repos/anzchy/mdpro/issues/<n>` returned it after publication, and each hash
equals the one the planner recorded. T-08 (#602) stays closed, folded into T-07 (#601); its body stays in
[r1](../r1/tickets/T-08.md).

## Approval words (user, 2026-11-03)
- Revision route, after the NOT READY r2 plan review: 「r3 + scoped confirm (Recommended)」.
- r3: 「panner的问题，直接回复同意」 (relayed to the planner by herdr-delegator).
- The approvals of r1 and r2 carry over for what r3 does not change.

## Blocking edges (read back from GitHub after publication)
- Native: T-02 (#596) ← T-01 (#595); T-03 (#597) ← T-01, T-02 (new in r3); T-05 (#599) ← T-01, T-02 (new in r3),
  T-03 (new in r3); T-06 (#600) ← T-02; T-07 (#601) ← T-02.
- In the body: T-06 and T-07 name PRs #549 and #575 as landed first.
- No blockers: T-01 (#595), T-04 (#598), T-09 (#603).

## Not in this snapshot
The seven decision-log drafts and the findings map stay with the planner under
`~/.mdpro-redesign/planner/docs-ci-tiers/r3/` until their tickets land. They go to the scoped confirms with this
snapshot.
