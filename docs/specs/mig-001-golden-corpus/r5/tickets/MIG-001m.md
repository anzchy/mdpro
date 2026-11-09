## Parent

#705 (MIG-001 spec r5); row #697.

## What to build

**MIG-001m: Extreme input and the large-document guard.** Guard-only records (spec #705 § Guard-only records) built from committed recipes, calling the production guard on the content without mounting: each of the three thresholds (structure count, line length, Source table rows) at threshold−1, threshold and threshold+1 under each applicable view mode, covering `allow`, `degrade-to-source` and `withhold-table-extensions`; plus long-line and deep-nesting mounting cases sized under 2 s.

The category's required topics are the ones in #705's table; each maps to at least one case-id. Uses only the driver, lists and observations from MIG-001a; a change to them needs the user's approval (spec #705).

Consumers: MIG-002 rows through a only.

## Acceptance criteria

- [ ] Every new case has a one-line `rationale`, a `baselineSha` (the merge-base with master at generation), and `derivedFrom` where copied from an existing test. Every mounting case also has a fidelity tag whose mechanical rule holds (spec #705 § Executable fidelity tags) and serialized bytes; known limitations carry `limitRef`, `reason` and a `desired` file.
- [ ] Every fidelity claim has its declarative negative case, failing with that case's id; every distinct guarded path has one temporary-mutation receipt (`MIG001-m-…`) recorded by the spec's procedure, with the mutation diff, failing assertion and restore in the handoff and "replay passes at base" under Known qualifications.
- [ ] `pnpm corpus:check` and the manifest-validation test are green (no `limitRef: pending`, no missing expected file); `pnpm corpus:determinism` reports identical bytes.
- [ ] Every mounting case's untouched output equals its input byte-for-byte.
- [ ] Every case runs under 2 s under coverage; each runner file stays under 60 s; any `ci: local-only` case is listed in the handoff with its local result; the handoff reports this category's file times and the corpus running total against the 5-minute ceiling.
- [ ] Classification questions (normalization or defect) are listed in the handoff for the delegator.
- [ ] A known limitation that proves a `Shipped` feature-ledger row false rewrites that row (`Partial` + `限制：`) in the same commit; otherwise no ledger change.
- [ ] Runners, support code and fixtures follow the spec's rule-10 placement.
- [ ] Every recipe carries a sha256 that the run verifies; no input above 1 MB is committed.
- [ ] Every guard-only record has the spec's guard-only shape: recipe with its sha256, view mode, the full decision as its expected observation, and a `wrongObservation` negative that fails naming the case. It carries no fidelity tag, action, serialized output or untouched output, and guard-only records are the only records without them.

