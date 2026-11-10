## Parent

#733 (MIG-002 spec r2); row #702.

## What to build

**MIG-002c: row c (tab close, window close, quit).**

Clauses (spec #733):
- c-C1 (1): the prompt targets the captured document, and Cancel changes nothing.
- c-C2 (pin): the re-check after the prompt.
- c-C3 (1): the draft drain/delete order is preserved, so no draft is deleted before its save succeeds.
- c-C4 (1): after a failed flush, the only instance holding unserialized edits isn't unmounted.
- c-C5 (1): discard only with "Don't Save" consent; a destroy flushes first.
- c-C6 (1): a quit or last-window close inside the edit-sync delay includes the latest keystrokes.
- c-C7 (pin): a close during IME composition, with journey-stated bytes.
- c-CS (pin): the serializer throws during a close or quit.

State owners: row c's. StrictMode clauses: c-C4, c-C5. Reused suites to cite: `quit-guard-wysiwyg-flush`, `quit-guard-decision`, `quit-guard-service`, `useQuitGuard*`, `quitDraftBackstop`, `d97-tab-close-after-failed-flush`, `d92-failed-flush-callers`. Likely MIG-005 host sites at 7bb42efb: `windowCloseAttempt`; confirm by grep.

Corpus categories: a. Each journey cites its case-ids, listed in the pre-grant matrix.

## Acceptance criteria

- [ ] The card `docs/test/cards/MIG002-c.md` is written in the ADR-0144 format (model: `D326-identity-check.md`), with steps tagged `cli`, `computer-use` or `human`, each with its proof, a failure condition, and a log line plus effect. It is reviewed against this row's clauses in the round-one audit request (ADR-0144 decision 2). It covers: close a dirty tab then Cancel; close the last window then Cancel; Cmd+Q right after typing then Save; "Don't Save" discards and leaves no draft; close during a Pinyin composition.

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

#735 (MIG-002a1)
