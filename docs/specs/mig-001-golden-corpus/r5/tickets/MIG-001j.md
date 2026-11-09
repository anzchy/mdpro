## Parent

#705 (MIG-001 spec r5); row #697.

## What to build

**MIG-001j: Link and paste safety.** Cases for `activateLink`, run at the production origin (spec #705 § Runner layout): refused schemes with their `reason`; a protocol-relative `//host/x` and a backslash `\\host/x` href, which only the scheme gate refuses; external URLs; relative and fragment links with outcome `same-app` and zero opener calls; an anchor without `href`. Also autolinks, pasted `<script>` and event handlers with `pasteSafety`, and sanitizer order relative to table paste.

The category's required topics are the ones in #705's table; each maps to at least one case-id. Uses only the driver, lists and observations from MIG-001a; a change to them needs the user's approval (spec #705).

Consumers: MIG-002 f.

## Acceptance criteria

- [ ] Every new case has a one-line `rationale`, a `baselineSha` (the merge-base with master at generation), and `derivedFrom` where copied from an existing test. Every mounting case also has a fidelity tag whose mechanical rule holds (spec #705 § Executable fidelity tags) and serialized bytes; known limitations carry `limitRef`, `reason` and a `desired` file.
- [ ] Every fidelity claim has its declarative negative case, failing with that case's id; every distinct guarded path has one temporary-mutation receipt (`MIG001-j-…`) recorded by the spec's procedure, with the mutation diff, failing assertion and restore in the handoff and "replay passes at base" under Known qualifications.
- [ ] `pnpm corpus:check` and the manifest-validation test are green (no `limitRef: pending`, no missing expected file); `pnpm corpus:determinism` reports identical bytes.
- [ ] Every mounting case's untouched output equals its input byte-for-byte.
- [ ] Every case runs under 2 s under coverage; each runner file stays under 60 s; any `ci: local-only` case is listed in the handoff with its local result; the handoff reports this category's file times and the corpus running total against the 5-minute ceiling.
- [ ] Classification questions (normalization or defect) are listed in the handoff for the delegator.
- [ ] A known limitation that proves a `Shipped` feature-ledger row false rewrites that row (`Partial` + `限制：`) in the same commit; otherwise no ledger change.
- [ ] Runners, support code and fixtures follow the spec's rule-10 placement.
- [ ] The j runner carries the production-origin docblock; at least one case expects outcome `same-app` with zero opener calls; every `refused` case records its `reason`; one case expects `no-href`.
- [ ] The link-click guard has its own temporary-mutation receipts: removing the click handling or its cancellation turns a j case red; removing the same-app branch turns the `same-app` case red; removing the scheme gate turns the protocol-relative or backslash case red (its `reason` or `outcome` changes).

