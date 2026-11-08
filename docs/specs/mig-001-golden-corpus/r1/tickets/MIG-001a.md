## Parent

#705 (MIG-001 spec r1); row #697.

## What to build

**MIG-001a: Corpus core and empty paragraphs.** The whole Golden Corpus pipeline, proven end to end on category a (empty paragraphs), so that every later category only adds data.

- The engine-neutral layer: per-category manifest shards and the closed lists (fidelity tags, normalizations N1–N8, action kinds, observation kinds), the comparator, and per-category per-platform runners.
- The Milkdown engine driver (`mount`, `untouched`, `serialize`, `runAction`, `observe`) mounting the real `<MilkdownEditor/>` with the production plugin list, selected by `CORPUS_ENGINE` (default `milkdown`). It implements every action kind (`type`, `delete`, `toggleMark`, `paste`, `undo`, `insertTableRow`, `insertTableColumn`, `find`, `replace`, `modeSwitch`) with text anchors, and every observation schema (`toc`, `find`, `scrollAnchor`, `pasteSanitize`, `largeDocGuard`), in Markdown-source terms.
- The shared fake Tauri boundary: an in-memory file system and a byte-level write log of `save_file`, `save_draft` and `delete_draft`, built to be reused by MIG-002's App-journey harness.
- `pnpm corpus:generate` (write mode) and `pnpm corpus:check` (manifest validation and determinism).
- Category a cases: 0/1/2/3+ blank lines between blocks; leading and trailing blanks; whitespace-only lines; empty paragraphs around headings, lists, quotes and code; an edit next to an empty paragraph keeps it.

The category's required topics are the ones in #705's table; each maps to at least one case-id. Uses only the driver, lists and schemas from MIG-001a (this ticket builds them).

Consumers: every MIG-002 row (#702), MIG-009a (#695).

## Acceptance criteria

- [ ] Every new case has a one-line `rationale`, a `baselineSha`, a fidelity tag from the closed list, and `derivedFrom` where it was copied from an existing test; `known-limitation` cases carry `dId`, `desired` and `reason`.
- [ ] Every fidelity claim has one committed negative case; every distinct guarded path has one temporary-mutation receipt in the jack-tdd-workflow store (`MIG001-a-…`), referenced from `guardedPaths`.
- [ ] `pnpm corpus:check` is green, and two consecutive `CORPUS_WRITE` runs produce identical bytes.
- [ ] Every case's untouched output equals its input byte-for-byte.
- [ ] Classification questions (normalization or defect) are listed in the handoff for the delegator; no case is left `dId: pending` at landing.
- [ ] A known limitation that proves a `Shipped` feature-ledger row false rewrites that row (`Partial` + `限制：`) in the same commit; otherwise no ledger change.
- [ ] The handoff reports the shard time this category adds.
- [ ] Each action kind and each observation schema has a driver-level test through the engine-driver seam.
- [ ] A tooling test runs `corpus:check` over a valid small manifest and over manifests each broken in one rule (unlisted fixture, missing file, duplicate or malformed id, tag/normalization/action/observation outside the closed lists, known-limitation without dId, fidelity claim without negativeCase, missing rationale or baselineSha, non-canonical key order, non-deterministic write) and asserts the named failure for each.
- [ ] The fake boundary's own tests show a save records exact bytes and an unedited open records no write.
- [ ] No corpus code imports the reduced rigs or the editor port; driver interface has no Milkdown types.
- [ ] Required topics for a (spec #705 table) each map to at least one case-id.

