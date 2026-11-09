## Parent

#733 (MIG-002 spec r1); row #702.

## What to build

**MIG-002h: row h (MCP mirror).**

Clauses (spec #733):
- h-C1: the mirror converges on the store's Markdown after the 200 ms edit-sync delay plus the 300 ms debounce.
- h-C2: with MCP off there are no mirror calls, and routing follows today's rules.
- h-C3: cancel and re-register leave no stale entry.
- h-C4: UTF-16 offsets on both sides for emoji and ZWJ.
- h-C5: no server ACK exists, and nothing treats a flush or sync as one.
- h-C6: Rust-side sync and approval are cited by `cargo test` names.

No serializer-throws journey: a flush is not a server ACK (D8).

StrictMode clauses: h-C3. Reused suites to cite: `useMcpSync.content`, `useMcpSync.retry`, `useMcpSync.routable`, `useMcpSync.routing`. Rust tests: `shadow_store` tests (`test_sync_documents`, the rollback tests, `shadow_store_routable_tests`, `shadow_store_owner_focus_tests`), the `http_server` test modules, `http_server_over_limit*`, `mcp_sync_cap_d98_tests`. Likely MIG-005 host sites at 7bb42efb: none direct; confirm by grep.

Corpus categories: a, l. Each journey cites its case-ids.

## Acceptance criteria

- [ ] For h-C6, the handoff maps each Rust sub-obligation to its existing test name. A sub-obligation with none gets a new `cargo test` in the existing Rust test layout (rule 10), and is listed as a filled gap.
- [ ] The card `docs/test/cards/MIG002-h.md` is written in the ADR-0144 format (model: `D326-identity-check.md`), with steps tagged `cli`, `computer-use` or `human`, each with its proof, a failure condition, and a log line plus effect. It covers: with MCP on, an MCP client reads the document after typing stops (emoji included); MCP off sends nothing; close and reopen leaves no stale entry.
- [ ] The PR lands with a waiver that quotes the user's ruling and names the single M0 Mac batch run at the SHA after the last MIG-002 sub-PR lands.

## Shared acceptance criteria (every MIG-002 ticket)

- [ ] Every clause listed above has at least one passing App journey and at least one negative journey, and its existing suites are cited by name in the handoff. No existing suite is moved or rewritten.
- [ ] Every distinct guarded path has one temporary-mutation receipt `MIG002-<row>-<clause>-<n>`, recorded by MIG-001's procedure. The handoff has the mutation diff, the failing assertion and the restore, and lists "replay passes at base" under Known qualifications.
- [ ] Each journey asserts the document id, the expected delta of every token its clause touches through `readTokens`, "unchanged" for the rest, the write log's bytes and order, and that no `failed` flush is reported as success.
- [ ] Documents are opened by MIG-001 case-id. An unedited write is byte-equal to the case's untouched bytes; an edited write equals bytes the journey states.
- [ ] The StrictMode clauses listed above run with StrictMode on.
- [ ] Unsafe current behaviour is pinned and named by a known-limitation record (`<row>-KL<n>`: clause, current, desired, reason, ref), and is sent to the delegator as a finding. No `ref: pending` remains at landing. No production fix is made.
- [ ] Nothing under `src/` changes, apart from receipt mutations that are restored. A clause that can't be observed without a production seam becomes a known limitation and a finding.
- [ ] The harness and the boundary change only by addition (after a1), and a1's harness tests and the corpus suite stay green.
- [ ] Each journey takes under 5 s under coverage and each file under 60 s. The handoff reports this row's times and the MIG-002 running total against the 5-minute ceiling.
- [ ] No feature-ledger change, unless a known limitation proves a `Shipped` row false; that row then becomes `Partial` + `限制：` in the same commit.
- [ ] The handoff names this row's MIG-005 host sites from `git grep -n 'getEditor()' src` at its base.
- [ ] Journeys are in `tests/state-safety/<row>-<slug>.journey.test.tsx` and follow rule 10's placement rules.

## Blocked by

#735 (MIG-002a1), #717 (MIG-001l)
