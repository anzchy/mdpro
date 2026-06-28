# Plans

Design and implementation plans for mdpro — the autonomous audit-fix loop, the
small-feature loop, and one-off feature/refactor plans.

## Feature-loop plan naming (small-feature automation)

Plans consumed by the autonomous **small-feature loop** follow this convention so
the loop and its verifier can find and grade them:

```
docs/plans/<YYYYMMDD>-feat-<slug>.md
```

Each such plan has these sections:

- **Goal** — what the feature does and why.
- **Acceptance Criteria** — a `## Acceptance Criteria` heading followed by a
  `- [ ]` checklist. This is the exact schema the verifier (WI-F3) parses; mirror
  it verbatim in the tracking issue (use the *Small feature* issue template).
- **Affected files** — the bounded file set. The builder is capped at ~10 files by
  a deterministic CI gate (WI-F8).
- **Test plan** — the tests that must exist and pass (rule 10 TDD).
- **Out-of-scope** — explicit non-goals.

A feature plan **must be merged to `master` before** its issue is labelled
`feature-approved` (WI-F6): the scope baseline the verifier reads must be behind
branch protection, not mutable on an unmerged branch.

See [`20260624-plan-small-feature-automation.md`](./20260624-plan-small-feature-automation.md)
for the full loop design (labels, the approval recorder, the body-hash pin, gates).
