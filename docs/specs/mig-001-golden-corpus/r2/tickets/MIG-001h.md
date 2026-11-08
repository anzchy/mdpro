## Parent

#705 (MIG-001 spec r2); row #697.

## What to build

**MIG-001h: Blocks.** Cases for fenced and indented code with info strings, block quotes, ATX and setext headings, thematic breaks, HTML blocks, and math (`$…$`, `$$…$$`) kept literal with `renderedMath.count` = 0.

The category's required topics are the ones in #705's table; each maps to at least one case-id. Uses only the driver, lists and observations from MIG-001a; a change to them needs the user's approval (spec #705).

Consumers: MIG-002 b.

## Acceptance criteria

- [ ] Every new case has a one-line `rationale`, a `baselineSha` (the merge-base with master at generation), a fidelity tag whose mechanical rule holds (spec #705 § Executable fidelity tags), mandatory serialized bytes for every mounting case, and `derivedFrom` where copied from an existing test; known limitations carry `limitRef`, `reason` and a `desired` file.
- [ ] Every fidelity claim has its declarative negative case, failing with that case's id; every distinct guarded path has one temporary-mutation receipt (`MIG001-h-…`) recorded by the spec's procedure, with the mutation diff, failing assertion and restore in the handoff and "replay passes at base" under Known qualifications.
- [ ] `pnpm corpus:check` and the manifest-validation test are green (no `limitRef: pending`, no missing expected file); `pnpm corpus:determinism` reports identical bytes.
- [ ] Every case's untouched output equals its input byte-for-byte.
- [ ] Every case runs under 2 s under coverage; each runner file stays under 60 s; any `ci: local-only` case is listed in the handoff with its local result; the handoff reports this category's file times and the corpus running total against the 5-minute ceiling.
- [ ] Classification questions (normalization or defect) are listed in the handoff for the delegator.
- [ ] A known limitation that proves a `Shipped` feature-ledger row false rewrites that row (`Partial` + `限制：`) in the same commit; otherwise no ledger change.
- [ ] Runners, support code and fixtures follow the spec's rule-10 placement.

