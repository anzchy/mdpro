## Parent

#705 (MIG-001 spec r1); row #697.

## What to build

**MIG-001l: Emoji, CJK and encodings at the editor.** Cases for emoji (surrogate pairs, ZWJ sequences, skin tones), CJK punctuation and full-width spaces, combining marks, and a leading U+FEFF; CRLF and UTF-16 cited through `externalEvidence` to the Rust tests, not re-tested.

The category's required topics are the ones in #705's table; each maps to at least one case-id. Uses only the driver, lists and schemas from MIG-001a; a change to them needs the user's approval (spec #705).

Consumers: MIG-002 a, d, e, h.

## Acceptance criteria

- [ ] Every new case has a one-line `rationale`, a `baselineSha`, a fidelity tag from the closed list, and `derivedFrom` where it was copied from an existing test; `known-limitation` cases carry `dId`, `desired` and `reason`.
- [ ] Every fidelity claim has one committed negative case; every distinct guarded path has one temporary-mutation receipt in the jack-tdd-workflow store (`MIG001-l-…`), referenced from `guardedPaths`.
- [ ] `pnpm corpus:check` is green, and two consecutive `CORPUS_WRITE` runs produce identical bytes.
- [ ] Every case's untouched output equals its input byte-for-byte.
- [ ] Classification questions (normalization or defect) are listed in the handoff for the delegator; no case is left `dId: pending` at landing.
- [ ] A known limitation that proves a `Shipped` feature-ledger row false rewrites that row (`Partial` + `限制：`) in the same commit; otherwise no ledger change.
- [ ] The handoff reports the shard time this category adds.
- [ ] The U+FEFF case's outcome is reported to the delegator as a finding (the UTF-8 BOM is detected but not stripped in Rust).

