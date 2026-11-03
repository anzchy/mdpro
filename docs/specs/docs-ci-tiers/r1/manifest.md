# docs-ci-tiers spec snapshot r1 (2026-11-03)

A frozen copy of the issue bodies as published (rule 12, ADR-0148). Any later normative edit to an issue below is `r2`,
which needs re-approval and a plan review of its diff against this revision.

| File | Issue | File SHA-256 |
|---|---|---|
| `spec.md` | [#594](https://github.com/anzchy/mdpro/issues/594) | `f121421119f6ec41a2157a24966dbbb775dba802a2f9d75427a0c0bb31a8cc40` |
| `tickets/T-01.md` | [#595](https://github.com/anzchy/mdpro/issues/595) | `d88fadb1641057427c712d7ff0f7e62532ee4dcb978f4c7959ef4095e0ab9a0e` |
| `tickets/T-02.md` | [#596](https://github.com/anzchy/mdpro/issues/596) | `00eb106c44f7f783fff8dd1ef2124b88430d7b20364829c32caa0c4c3aae307c` |
| `tickets/T-03.md` | [#597](https://github.com/anzchy/mdpro/issues/597) | `fa887fb0904831bd9dcabe2d4fb5d25c4ade337cc59ea28fcff025969594d680` |
| `tickets/T-04.md` | [#598](https://github.com/anzchy/mdpro/issues/598) | `9877b6f0f2a748be0b1a924c7267670bb8d8e089fc7d324fa21440ab32492450` |
| `tickets/T-05.md` | [#599](https://github.com/anzchy/mdpro/issues/599) | `e09294fe70946d3bd993d567c6ae72725f2e100e06915b03a6e6fb8669c811a7` |
| `tickets/T-06.md` | [#600](https://github.com/anzchy/mdpro/issues/600) | `a52eaa462200c045b9563fba88508711d70b78bd5d2837c7087a4cb19a8b4fd8` |
| `tickets/T-07.md` | [#601](https://github.com/anzchy/mdpro/issues/601) | `1288791ea7c108cb72a00504c1bbd925cc30a6a6f740a60b81129498ba76110b` |
| `tickets/T-08.md` | [#602](https://github.com/anzchy/mdpro/issues/602) | `ae52cc5c9aad24fa056c00a16440c4bd13c747674f22aa923fbc12e12f6d69e5` |
| `tickets/T-09.md` | [#603](https://github.com/anzchy/mdpro/issues/603) | `15f8f7cafe0844e1f55ca32cc822bee5bf2f4f92a98c3a4cc39302f9c85da81e` |

Each file is the issue body as `gh issue view <n> --json body --jq .body` returned it on 2026-11-03. Each ticket's hash
equals the one the planner recorded at publication. The planner's local `spec.md` differs from `spec.md` here only by
the trailing newline `--jq` adds.

## Approval words (user, 2026-11-03)
- Start: 「提交commit docs/reference/20261102-docs-commit-pr-ci-practices.md，然后按照你的建议，三档建议都要落地，这个要作为最优先的先处理，放在已经在做的task之前」;
  route 「Gated, fold into 3c (Recommended)」.
- Grill rounds 1–3: 「all yes」 each (round 3 includes the test seams); shared understanding 「yes」.
- Spec and ticket breakdown (granularity, T-05 split, D9 Medium placement, sub-issues with native edges): 「yes」.

## Blocking edges
- Native: T-02 (#596) ← T-01 (#595); T-03 (#597) ← T-01; T-07 (#601) ← T-02; T-08 (#602) ← T-02.
- Named in the body: T-06 (#600) ← PR #575; T-07, T-08 ← PR #549, PR #575, 0.3.6 shipped (shipped 2026-11-02).
- Unblocked: T-01 (#595), T-04 (#598), T-05 (#599), T-09 (#603).

## Related
- Parent: #594. Covers RC3, RC6 and RC1(c) of `docs/audit/20261101-vmark-mdpro-架构对比.md`, and the three tiers of
  `docs/reference/20261102-docs-commit-pr-ci-practices.md`.
- No ADR: CI lane layout and the landing route are process (CLAUDE.md § ADR, ADR-0165). Two decision-log drafts, both
  gate-sensitive, are plan-reviewed with this snapshot and land with T-01 and T-05:
  `~/.mdpro-redesign/planner/docs-ci-tiers/decision-draft-change-scopes.md`, `decision-draft-ci-platforms.md`.
- Glossary: **Change scope**, **Gate input** under `GLOSSARY.md` § Landing.
- Planner folder: `~/.mdpro-redesign/planner/docs-ci-tiers/` (`SEED.md`, `grill-log.md`, `approval.md`, `spec.md`, `tickets/`).
