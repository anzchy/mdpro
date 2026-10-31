# 567-tdd-skill spec snapshot r1 (2026-10-31)

A frozen copy of the issue bodies as published (rule 12, ADR-0148). Any later normative edit to an issue below is `r2`,
which needs re-approval and a plan review of its diff against this revision.

| File | Issue | File SHA-256 |
|---|---|---|
| `spec.md` | [#568](https://github.com/anzchy/mdpro/issues/568) | `350cc97b42b0a138c3d94ffc98caf45e8d16de1e643b1eaf99c60916fe514c19` |
| `tickets/T-01.md` | [#569](https://github.com/anzchy/mdpro/issues/569) | `c3fd270241ea52ea592f1d8c50f87241ec57fa754f254262c804ec1b33a851c3` |
| `tickets/T-02.md` | [#570](https://github.com/anzchy/mdpro/issues/570) | `fe37cc63ec185c697de6cff9d4b83fc0b7a8a6f2d9a4f23141258fecb6b5f70e` |
| `tickets/T-03.md` | [#571](https://github.com/anzchy/mdpro/issues/571) | `f69fb5ed25155edf58d2293c3e405fecbf7b4345fd574772b572c59eef5af95f` |

Each file is the issue body as `gh issue view <n> --json body --jq .body` returned it on 2026-10-31.

## Approval words (user, 2026-10-31)
- Start: 「Grill it here first (Recommended)」, then `/grill-with-docs #567` in the delegator session.
- Grill rounds: round 1 「是」; round 2 「Q9 用`jack-tdd-workflow` 作为name，其他的同意」; round 3 「Q5 Matt的Skill有codex版本,已经安装了，check一下.其他问题是」;
  round 4 「上面问题回答：是」; round 5, after the Codex and Fable slicing reviews, 「Q15-Q16 agree」.
- After the grill: 「codex 的tdd-guardian 在jack-tdd-workflow 上线之后就retire」 (replaces Q13).
- Test seams: 「Yes, these seams (Recommended)」.
- Ticket breakdown: 「Approve as drafted (Recommended)」.

## Blocking edges (native GitHub dependencies)
- T-01 (#569): #566 (vendor and pin the receipt engine).
- T-02 (#570): T-01 (#569); also the user's acceptance of the ADR, named in the body.
- T-03 (#571): T-02 (#570); also 0.3.6 shipping, named in the body.

## Related
- Parent: #567. ADR: [ADR-0161](../../../adr/0161-implementors-follow-one-project-skill-jack-tdd-workflow-and-codex-retires-tdd-guardian.md) (Proposed). Glossary: the "TDD" section of `GLOSSARY.md`.
- Planner folder: `~/.mdpro-redesign/planner/567-tdd-skill/` (`grill-log.md`, `spec.md`, `tickets/`, `adr-draft.md`, `GLOSSARY-edit.md`).
- Research: `docs/reference/20261031-slicing-best-practice-codex-review.md`, `-fable-review.md`.
