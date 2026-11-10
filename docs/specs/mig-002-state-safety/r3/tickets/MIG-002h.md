## Parent

#733 (MIG-002 spec r3); row #702.

## What to build

**MIG-002h: row h (MCP mirror, ADR-0033 decision 4).**

Clauses (spec #733):
- h-C1 (1): the mirror converges on the store's Markdown after the 200 ms edit-sync delay plus the 300 ms content debounce.
- h-C2 (2):
  - **Frontend:** `mcp_sync_documents` calls are the same with the MCP server preference on and off (IPC call logs compared), because routing needs them (ADR-0033).
  - **Rust:** with the server off nothing is exposed; cite `services/mcp_controller/switch_tests.rs::s1_toggles_from_running_follow_disk_and_runtime_with_fresh_tokens`, `services/mcp_controller/lifecycle_tests.rs::c2_tokens_are_fresh_across_cycles_and_old_ones_are_revoked`, `services/mcp_controller/files_unpublish_tests.rs::f6_unpublish_is_idempotent_and_conserves_siblings`, `services/mcp_controller/stop_abort_tests.rs::c6_the_port_rebinds_immediately_after_a_keep_alive_connection` and `services/preferences_mcp_tests.rs::p4_persist_changes_only_server_enabled_relative_to_typed_round_trip`; if none asserts that the old port answers nothing once off, add one (`MIG002-h-C2-R<n>`).
- h-C3 (1): a cancelled close re-registers with a forced sync, and close or reopen leaves no stale entry.
- h-C4 (1): UTF-16 offsets on both sides for emoji and ZWJ.
- h-C5 (1): a successful sync result is the only delivery acknowledgement. On failure the hash is forgotten and an identical retry goes out. Nothing treats a sync result as a save or a read. The guarded path is the hash reset.
- h-C6 (2, **Rust-only**: no journey, no negative journey, no frontend receipt). Sub-obligations and tests:
  1. sync: `services/shadow_store.rs::tests::test_sync_documents`;
  2. rollback: `services/shadow_store.rs::tests::test_update_document_content_rollback`, `services/shadow_store.rs::tests::test_update_document_content_rollback_after_insert`;
  3. routing: `services/shadow_store_routable_tests.rs::sync_routable_last_write_wins_exhaustive`, `services/shadow_store_routable_tests.rs::sync_routable_is_per_window`, `services/shadow_store_owner_focus_tests.rs::of1_agrees_with_separate_readers_across_transitions`;
  4. HTTP limits: `services/http_server_over_limit_tests.rs::o1_an_over_cap_document_is_refused_with_413_document_too_large`, `services/http_server_over_limit_tests.rs::o6_every_mcp_read_and_write_route_refuses_before_the_confirmation_gate`;
  5. sync cap: `commands/mcp_sync_cap_d98_tests.rs::s2_only_the_oversize_document_is_capped`, `commands/mcp_sync_cap_d98_tests.rs::s4_after_a_capped_sync_the_store_has_the_small_documents_current`.

No h-CS: a flush is not a mirror acknowledgement (D8).

State owners: row h's. StrictMode clauses: h-C3. Reused suites to cite: `useMcpSync.content`, `useMcpSync.retry`, `useMcpSync.routable`, `useMcpSync.routing`. Likely MIG-005 host sites at 7bb42efb: none direct; confirm by grep.

Corpus categories: a, l. Each journey cites its case-ids, listed in its test matrix.

## Acceptance criteria

- [ ] For h-C2 and h-C6, the handoff maps each Rust sub-obligation to its exact test path and quotes the assertion that would fail. A sub-obligation with none gets a new `cargo test` in the existing Rust test layout (rule 10) with an `-R<n>` receipt, and is listed as a filled gap.
- [ ] The card `docs/test/cards/MIG002-h.md` is written in the ADR-0144 format (model: `D326-identity-check.md`), with steps tagged `cli`, `computer-use` or `human`, each with its proof, a failure condition, and a log line plus effect. It is reviewed against this row's clauses in the round-one audit request (ADR-0144 decision 2). It covers: with the MCP server on, an MCP client reads the document after typing stops (emoji included); with it off, an external open of an already-open file still routes to its window; close and reopen leaves no stale entry.

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

#735 (MIG-002a1), #717 (MIG-001l)
