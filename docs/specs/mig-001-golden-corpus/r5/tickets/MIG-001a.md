## Parent

#705 (MIG-001 spec r5); row #697.

## What to build

**MIG-001a: Corpus core and empty paragraphs.** The whole Golden Corpus pipeline, proven end to end on category a (empty paragraphs), so that every later category only adds data.

- The engine-neutral layer: per-category manifest shards and the closed lists file (fidelity tags, action groups, normalizations N1–N8 with sources and reference transforms, action kinds, observation kinds, negative kinds); the comparator with every tag rule for the baseline engine and for any other engine (including the either-side pass and improvement report for known limitations); the action-aware checks for edited and interaction `semantic-roundtrip` cases (unedited blocks, and each action's text model over visible text that keeps whitespace in code); the guard-only record shape; the declarative negative runner; the content-level `toc` and `largeDocGuard` observations calling the production functions.
- The Milkdown engine driver (`mount`, `untouched`, `serialize`, `runAction`, `observe`) mounting the real `<MilkdownEditor/>`, selected by `CORPUS_ENGINE`. It implements every action kind with the spec's anchor rules (`type`, `delete`, `toggleMark`, `clearFormat`, `setListKind`, `paste`, `undo`, `insertTableRow`, `insertTableColumn`, `find`, `replace`, `modeSwitch`, `activateLink`) and every driver observation (`find`, `pasteSafety`, `linkActivation`, `renderedMath`, `imageSources`, `selection`). `linkActivation` is derived from the guard's mocked events, the click's propagation and the fake opener, never from the URL.
- The shared fake Tauri boundary: in-memory file system, byte-level write log of `save_file`, `save_draft` and `delete_draft`, and a fake native opener with a call log; built for reuse by MIG-002.
- `pnpm corpus:generate` (scratch outputs, one merge step, refuses `CI`), `pnpm corpus:check` (read-only), `pnpm corpus:determinism` (local, through heavy-lock), and the manifest-validation test in the existing shards.
- Category a cases (spec table), including the ADR-0091 C7 list-merge known limitation and an undo with `selection`.

The category's required topics are the ones in #705's table; each maps to at least one case-id. This ticket builds the driver, lists and observations every later slice uses.

Consumers: every MIG-002 row (#702), MIG-009a (#695).

## Acceptance criteria

- [ ] Every new case has a one-line `rationale`, a `baselineSha` (the merge-base with master at generation), and `derivedFrom` where copied from an existing test. Every mounting case also has a fidelity tag whose mechanical rule holds (spec #705 § Executable fidelity tags) and serialized bytes; known limitations carry `limitRef`, `reason` and a `desired` file.
- [ ] Every fidelity claim has its declarative negative case, failing with that case's id; every distinct guarded path has one temporary-mutation receipt (`MIG001-a-…`) recorded by the spec's procedure, with the mutation diff, failing assertion and restore in the handoff and "replay passes at base" under Known qualifications.
- [ ] `pnpm corpus:check` and the manifest-validation test are green (no `limitRef: pending`, no missing expected file); `pnpm corpus:determinism` reports identical bytes.
- [ ] Every mounting case's untouched output equals its input byte-for-byte.
- [ ] Every case runs under 2 s under coverage; each runner file stays under 60 s; any `ci: local-only` case is listed in the handoff with its local result; the handoff reports this category's file times and the corpus running total against the 5-minute ceiling.
- [ ] Classification questions (normalization or defect) are listed in the handoff for the delegator.
- [ ] A known limitation that proves a `Shipped` feature-ledger row false rewrites that row (`Partial` + `限制：`) in the same commit; otherwise no ledger change.
- [ ] Runners, support code and fixtures follow the spec's rule-10 placement.
- [ ] Each action kind and each observation has a driver-level test through the engine-driver seam; anchor errors are tested for duplicate text, text split across marks, a ZWJ string, a multi-cell range and a missing anchor.
- [ ] Each tag rule has a test that it rejects a violating case (an `immutable` case whose output differs from input; a `semantic-roundtrip` case whose listed normalizations do not reproduce the output or are not minimal; a changed unedited block; a dropped word under the action's text model; a known limitation matching neither side on a non-default engine) and the improvement report fires when `desired` is matched. Two tag-validation tests reproduce the r2 counterexamples and must be rejected: (1) input `Keep beta`, `toggleMark` strong on `beta`, output `Keep`; (2) a fenced code line `a b` serialized as `ab` while `type` inserts `X` after a separate paragraph `target`; (3) input `A\n\n\n\nB\n\nC\n` (one empty paragraph between A and B), `type` `X` after `C`, output `A\n\nB\n\nCX\n` (the empty paragraph lost), and its variant output `A\n\nB\n\n\n\nCX\n` (the empty paragraph moved next to the edit); (4) input `> a\n>\n>\n>\n> b\n` (an empty paragraph inside a quote), `type` `!` after `b`, output `> a\n>\n> b!\n`, and its list variant, input `* a\n\n\n\n  b\n`, output `* a\n\n  b!\n`.
- [ ] A `corruptSerialized` negative keeps the observation and untouched bytes, corrupts only serialized output, and fails naming the case.
- [ ] A tooling test runs `corpus:check` over a valid small manifest and over manifests each broken in one rule (unlisted fixture, missing file, duplicate or malformed id, value outside a closed list, action group not matching its directory, incoherent tag/normalizations, known limitation without limitRef/reason/desired, fidelity claim without a negative, missing rationale or baselineSha, non-canonical key order) and asserts the named failure; determinism is tested through two prepared scratch outputs, without nesting Vitest; `corpus:check` leaves the tree byte-identical.
- [ ] Write mode refuses to run when `CI` is set; a missing expected file fails the case and generates nothing.
- [ ] The fake boundary's tests show a save records exact bytes, an unedited open records no write, and an external link activation records one opener call.
- [ ] No corpus code imports the reduced rigs or the editor port; the driver interface has no Milkdown types.
- [ ] The `activateLink` driver test runs at the production origin (`tauri://localhost/`) and observes every `linkActivation` outcome through the real guard: `refused` with each `reason`, `external`, `same-app` with zero opener calls, and `no-href`.
- [ ] `corpus:check` accepts a well-formed guard-only record and rejects one that carries a mounting field (fidelity tag, action, normalizations, serialized output) or lacks its recipe sha256, view mode, decision or `wrongObservation` negative.

