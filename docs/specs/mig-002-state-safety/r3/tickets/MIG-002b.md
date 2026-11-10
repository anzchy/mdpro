## Parent

#733 (MIG-002 spec r3); row #702.

## What to build

**MIG-002b: row b (tab and view-mode switch).**

Clauses (spec #733):
- b-C1 (1): a tab switch reads the state after the flush.
- b-C2 (pin): a quick WYSIWYG → Source → WYSIWYG keeps every edit, with undo and selection pinned.
- b-C3 (1): when the outgoing document's flush fails, both stores refuse the switch and neither changes.
- b-C4 (1): a failed flush in an unrelated document doesn't refuse the switch.
- b-C5 (1): targeted and aggregate results stay distinct (ADR-0071).
- b-C6 (1): the scroll anchor is captured and restored across a mode switch.
- b-C7 (pin): a switch during IME composition, with journey-stated bytes.
- b-CS (pin): the serializer throws during a switch.

State owners: row b's. StrictMode clauses: b-C2, b-C6. Reused suites to cite: `d92-*`, `d95-flush-refusal-scope`, `d95-*open-activation`, `d97-tab-close-after-failed-flush`, `d255-switch-documents`, `wysiwyg-flush-sites`. Likely MIG-005 host sites at 7bb42efb: `scrollAnchor/capture`, `editorStore`, `milkdownFocusCarry`, `focusActiveEditor`; confirm by grep.

Corpus categories: a, g, h, n. Each journey cites its case-ids, listed in its test matrix.

## Acceptance criteria

- [ ] The card `docs/test/cards/MIG002-b.md` is written in the ADR-0144 format (model: `D326-identity-check.md`), with steps tagged `cli`, `computer-use` or `human`, each with its proof, a failure condition, and a log line plus effect. It is reviewed against this row's clauses in the round-one audit request (ADR-0144 decision 2). It covers: a tab switch immediately after typing; a WYSIWYG → Source → WYSIWYG round trip with undo; a refused switch after a failed flush (if reproducible on device, otherwise `cli` log evidence); **scroll-anchor retention across a mode switch** (carried from MIG-001n, ADR-0144); a switch during a Pinyin composition.

## Shared acceptance criteria (every MIG-002 ticket, r3)

- [ ] Every clause above follows its evidence path (spec #733 § Evidence paths):
  - **path 1:** a passing App journey, a negative journey, and a receipt per guarded `src/` path;
  - **path 2:** the frontend half as in path 1, plus the Rust half's `cargo test`s, each cited by exact `<file>::<test>` path (or new, with an `-R<n>` receipt and listed as a filled gap), and its declared fake-behaviour rows, each tied by a shared fixture where it carries a payload. **Exception:** a Rust-only clause (h-C6) has no frontend half, so no journey, negative journey or frontend receipt; each of its Rust sub-obligations maps to a named test or a new `-R<n>` test;
  - **path 3 (pin):** a current-outcome journey plus a receipt;
  - **path 4 (known limitation):** a current-outcome journey plus a `KL` receipt, `NOT PROVED`, and a tracked `ref`. Before round-one audit the delegator records an ADR-0146 decision-4 acceptance on ground (a), moving the guarantee to the `ref`; without it the clause blocks. An outcome that cannot be driven is sent to the delegator (`observable: false`, ground (a) or (c)), never given a seam.

  Existing suites are cited by name; none is moved or rewritten.
- [ ] Receipts follow MIG-001's temporary-mutation procedure, with ids `MIG002-<row>-<clause>-<n>`, `…-R<n>` (Rust) and `MIG002-<row>-KL<n>-<k>`. The handoff has each mutation diff, failing assertion and restore, and lists "replay passes at base" under Known qualifications.
- [ ] The test matrix lists per clause: its path, corpus case-ids, the unsafe attempt (guarantees), the byte and token oracles, and the Rust tests and fake-behaviour rows for a Rust half (spec § Test matrix). It is written and attacked before the first RED; the delegator checks its coverage when confirming the handoff.
- [ ] Each guarantee and pin journey asserts:
  - the document id;
  - the expected delta of every token its clause touches through `readTokens`, and "unchanged" for the rest;
  - the write log's bytes and order (and the IPC call log where the clause names an IPC);
  - the effect on each state owner the ticket names;
  - that no `failed` flush is reported as success. A path-4 journey is exempt, and its clause is `NOT PROVED`.
- [ ] Documents are opened by MIG-001 case-id. An unedited write is byte-equal to the case's untouched bytes; an edited write equals bytes the journey states.
- [ ] The StrictMode clauses listed above run with StrictMode on. A failure seen only under StrictMode takes path 4 with `strictModeOnly: true`.
- [ ] Each known limitation is recorded in this row's registry file (`<row>-KL<n>`: clause, current, desired, reason, ref) and sent to the delegator as a finding. No `ref: pending` remains at landing. No production fix is made.
- [ ] Nothing under `src/` or `src-tauri/` changes, except restored receipt mutations and new `cargo test`s for listed gaps.
- [ ] After a1, the harness changes only by addition: row-local helper modules and new fake-behaviour rows. a1's harness tests and the corpus suite stay green.
- [ ] Budget (D26): each journey under 5 s under coverage, measured; each journey file sets a 15 s test timeout; each file under 60 s. The handoff reports this row's times and the running totals against MIG-002's 5-minute shard-time ceiling and M0's 10 minutes (shard time = per-file durations summed across the four `frontend` shards in a coverage run).
- [ ] No feature-ledger change, unless a known limitation proves a `Shipped` row false; that row then becomes `Partial` + `限制：` in the same commit.
- [ ] The handoff ends with a clause-status table (`PROVED` / `PINNED` / `NOT PROVED`) and names this row's MIG-005 host sites from `git grep -n 'getEditor()' src` at its base.
- [ ] The PR lands with a waiver that quotes the user's ruling (#686 item 4; r2 「Keep #686, name departure (Recommended)」) and names the single M0 Mac batch at the SHA after the last MIG-002 sub-PR lands. The waiver is recorded as an ADR-0144 decision-5 audit-log gate exception.
- [ ] Journeys are in `tests/state-safety/<row>-<slug>.journey.test.tsx` and follow rule 10's placement rules.

## Blocked by

#735 (MIG-002a1), #712 (MIG-001g), #713 (MIG-001h), #719 (MIG-001n)
