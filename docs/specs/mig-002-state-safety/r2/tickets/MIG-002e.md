## Parent

#733 (MIG-002 spec r2); row #702.

## What to build

**MIG-002e: row e (external wholesale replace).**

Clauses (spec #733):
- e-C1 (1): focus, selection and both scroll anchors are captured on the old view before the reload.
- e-C2 (1): replace, invalidation and the generation bump happen as one synchronous step, observed by the transition recorder, and the restore happens under the new generation.
- e-C3 (1): there is no late flush from the old writer.
- e-C4 (2):
  - **Frontend:** the open-write guard, given the Rust-canonical alias payload (a declared fake-behaviour row from the D173 alias payload fixture), guards the alias as one file. Two raw spellings without Rust canonicalisation pin today's exact-match outcome.
  - **Rust:** cite the file-watcher baseline-spelling, notice-spelling and fan-out tests.
- e-C5 (pin): an external replace while another window is dirty.
- e-C6 (2):
  - **Frontend:** rapid changes give at most one prompt within the prompt debounce, and no conflicting reloads.
  - **Rust:** the watcher's debounce (ADR-0111); cite the route-debounce-kind and route-state-change tests.
- e-CS (pin): the serializer throws during an external replace.

State owners: row e's. StrictMode clauses: e-C2, e-C3. Reused suites to cite: `wholesale-path-partition`, `toc-wholesale-reset`, `d214-external-change-baseline`, `d173-alias-delivery`, `d173-watch-holds`, `d173-b87-two-tabs-rename`, `d273-recovery-focus`. Likely MIG-005 host sites at 7bb42efb: `milkdownFocusCarry`, `scrollAnchor/capture`, `focusActiveEditor`; confirm by grep.

Corpus categories: a, l, n. Each journey cites its case-ids, listed in the pre-grant matrix.

## Acceptance criteria

- [ ] The card `docs/test/cards/MIG002-e.md` is written in the ADR-0144 format (model: `D326-identity-check.md`), with steps tagged `cli`, `computer-use` or `human`, each with its proof, a failure condition, and a log line plus effect. It is reviewed against this row's clauses in the round-one audit request (ADR-0144 decision 2). It covers: an external edit reloads and keeps the cursor and scroll position in WYSIWYG and in Source; the same file opened through a symlink; an external change while a second window holds the document dirty.

## Shared acceptance criteria (every MIG-002 ticket, r2)

- [ ] Every clause above follows its evidence path (spec #733 § Evidence paths):
  - **path 1:** a passing App journey, a negative journey, and a receipt per guarded `src/` path;
  - **path 2:** the frontend half as in path 1, plus the Rust half's named `cargo test`s (cited, or new with an `-R<n>` receipt and listed as a filled gap) and its declared fake-behaviour rows;
  - **path 3 (pin):** a current-outcome journey plus a receipt;
  - **path 4 (known limitation):** a current-outcome journey plus a `KL` receipt, `NOT PROVED`, and a tracked `ref`.

  Existing suites are cited by name; none is moved or rewritten.
- [ ] Receipts follow MIG-001's temporary-mutation procedure, with ids `MIG002-<row>-<clause>-<n>`, `…-R<n>` (Rust) and `MIG002-<row>-KL<n>-<k>`. The handoff has each mutation diff, failing assertion and restore, and lists "replay passes at base" under Known qualifications.
- [ ] Before the first RED, the test matrix lists per clause: its path, corpus case-ids, the unsafe attempt (guarantees), the byte and token oracles, and the Rust tests and fake-behaviour rows for a Rust half. The matrix attack has run on it (pre-grant matrix, spec § Pre-grant matrix).
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

#735 (MIG-002a1), #717 (MIG-001l), #719 (MIG-001n)
