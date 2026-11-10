Part of #702 (MIG-002 row). Plan: `docs/plans/20261107-mdpro_tiptap_windows_plan_v1-3.md` §1.1, §4.2 (entry-contract table), §5 MIG-002, §15 row MIG-002. Decisions: #686 (user: all eight "(Recommended)", then "Yes, record it (Recommended)"); grill record `MIG002-r1-D1`…`D24` (user: 「all yes」 in each of three rounds); seams (user: 「yes」); ticket split `MIG002-r1-D25` (user: 「u recommend the best practices」, then to the delegator 「确认 9 张票 (Recommended)」). Revision r2 closes the round-1 plan review (merged C0 H4 M11 L6; MH1–MH4, MM1–MM11, Lows), with `MIG002-r2-D26`…`D28` (user, planner pane: 「5 s / 15 s / 5 + 5 min (Recommended)」, 「Keep #686, name departure (Recommended)」, 「Today's state owner (Recommended)」). Tier High; gated (rule 12); record Issue; no ADR; not gate-sensitive; device AC: Mac (ADR-0144, with a named departure). Revision r3 closes the round-2 plan confirm (merged C0 H4 M5 L4; R2-H1…H4, the Mediums and the Lows) in the extra round the user approved (「Approved extra round r3 (Recommended)」, ADR-0143 decision 3); it changes no product behaviour, no ADR and no edge. Snapshot: `docs/specs/mig-002-state-safety/r3/` (r1 and r2 are superseded).

## Problem Statement

mdpro is about to move its WYSIWYG engine from Milkdown to Tiptap. The code that keeps a user's words safe is the code the migration rewires: saves, tab and mode switches, closing and quitting, drafts, external replacement, and MCP writes. Each of these crosses several stores and depends on a flush from the live editor. Plan §4.2's entry-contract table names eight entry points and what each must keep, but today:

- **The guarantees are proved only in pieces.** About a dozen unit suites (D92, D95, D97, D214, D290, D146, D241, D58, `quit-guard-wysiwyg-flush`, `wholesale-path-partition`, `useMcpSync`, `d173-other-window-save`) each test one hook or store, usually with a fake flusher or a reduced rig. No test drives the real `<App />` from a keystroke to the bytes that reach disk.
- **Some paths are untested end to end.** No `<App />` test fires a window close, a quit or an MCP event. Quit is tested only at hook level.
- **A test written against Milkdown internals proves nothing about Tiptap.** If the evidence is a renamed mock, the migration can lose a user's edit while every test stays green.
- **Unsafe behaviour today has no record.** If today's code already loses an edit somewhere, a migration that keeps that loss looks like a pass, and one that fixes it looks like a regression.

MIG-005 (the editor port, #704 / #689) needs, for each entry-contract row, a frozen entry, a passing journey, a failing journey and failure evidence before it changes that row's callers (plan §5 M0→M1 gate).

## Solution

A **state-safety contract** for each of §4.2's eight entry-contract rows, each proved through **App journeys**: tests that render the real `<App />`, with real Milkdown and real stores, over a fake Tauri boundary that records every byte written.

- **The journey harness.** One shared test helper renders the app and gives tests:
  - typing and composition;
  - menu actions, window close, quit and MCP events;
  - scripted dialog answers and file-system events;
  - fake time;
  - a **write log** of every `save_file`, `save_file_dialog`, `save_draft` and `delete_draft` with its exact bytes, and an **IPC call log** of every other command with its arguments;
  - a read-only view of the document's tokens (§1.1).

  It reuses the fake Tauri boundary that MIG-001a builds. Production code is not changed.
- **Contract clauses.** Each row is split into numbered clauses `<row>-C<n>`, each one obligation, worded close to §4.2 and to the accepted ADRs. A clause is a **guarantee** (a stated safe outcome) or a **pin** (today's outcome, where neither §4.2 nor an ADR states the right one). Each has its own evidence path (§ Evidence paths). A guarantee needs a passing App journey, a **negative journey** that attempts the unsafe thing and asserts nothing unsafe happened, a RED receipt per guarded path, and its existing suites cited.
- **Rust-enforced halves are proved in Rust.** Where a guarantee is enforced behind the fake boundary (draft claims, MCP approval, alias canonicalisation, the watcher debounce, the save notice, the mirror's shadow store), the journey asserts only the frontend half, and the Rust half is proved by named `cargo test`s.
- **Today's unsafe behaviour is recorded, not fixed, and never counted as proved.** A clause whose current outcome is unsafe takes the **known-limitation path**: a journey pins today's outcome, a mutation proves that assertion, the clause is reported `NOT PROVED`, and a tracked fix is named. The fix is a separate D-item.
- **Nine PRs (D25).** Ticket a1 lands the harness, the known-limitation registry and row a's two core clauses as the tracer bullet; a2 finishes row a. a1 blocks a2 and b…h, which then run in parallel. Each ticket names its clauses and their paths, its corpus categories, its Rust tests, its Mac card steps and its MIG-005 consumer sites. Its corpus case-ids, negative journeys and token oracles are in its test matrix (§ Test matrix), written before the first RED, because the case-ids exist only once the corpus tickets land.
- **Device evidence.** Each row writes a Mac card. One M0 Mac batch runs all eight cards after the last sub-PR lands. Until then, each of the nine sub-PRs lands with a recorded user waiver that names that batch. This departs from ADR-0144 decisions 3 and 6 by the user's #686 ruling, and is named (§ Device AC).

## User Stories

1. As a writer, I want Cmd+S pressed immediately after typing to save what I just typed, so that a debounce never costs me the last words.
2. As a writer, I want two quick saves of the same document never to write older bytes after newer ones, so that the file on disk is always my latest save.
3. As a writer, I want text I type while a save is in flight to stay marked unsaved, so that I know it still needs saving.
4. As a writer, I want a save whose editor flush fails to write nothing and leave the document unsaved, with an error, so that a broken serializer never reports success.
5. As a writer, I want a save that finishes after I closed, reopened, reloaded or moved the document not to mark the new buffer clean, so that a stale save never hides my unsaved edits.
6. As a writer, I want Save As to write to the new path and leave the document's identity consistent, so that later saves go to the file I chose.
7. As a writer, I want Save As onto a path already open in another tab to behave the same way every time, so that I never get two tabs silently writing one file.
8. As a writer, I want a save from another mdpro window not to overwrite unsaved edits in this window, so that two windows cannot erase each other's work.
9. As a writer using an input method, I want Cmd+S during composition to behave in a known way, so that half-composed CJK text is neither lost nor half-saved.
10. As a writer, I want switching tabs right after typing to keep my edit, so that switching never drops text.
11. As a writer, I want switching WYSIWYG → Source → WYSIWYG quickly to keep every edit, with a defined undo and selection, so that a mode toggle is never destructive.
12. As a writer, I want the app to refuse a tab or mode switch when the document I'm leaving fails to flush, so that the unsaved edit stays where I can still save it.
13. As a writer, I want a flush failure in an unrelated document not to block my switch, so that one broken tab doesn't freeze the others.
14. As a writer, I want my reading position kept across a mode switch, so that toggling doesn't jump me elsewhere in the document.
15. As a writer, I want closing a dirty tab to ask me about that tab, and Cancel to keep it exactly as it was, so that a close prompt never costs edits.
16. As a writer, I want closing the last window or quitting to ask about every dirty document, and Cancel to keep them, so that quitting is never a silent discard.
17. As a writer, I want quitting inside the edit-sync delay to include my latest keystrokes, so that quick quit-after-typing is safe.
18. As a writer, I want the app never to unmount the only editor holding my unserialized edits after its flush failed, so that a failure never destroys the last copy.
19. As a writer, I want "Don't Save" to be the only way edits are discarded, so that closing an editor for any other reason flushes first.
20. As a writer, I want drafts deleted only after the document is saved, so that a crash between steps can still recover my work.
21. As a writer, I want the auto-draft to contain the document's Markdown as the store holds it, so that a recovered draft opens as Markdown I wrote.
22. As a writer, I want draft recovery to refuse an older draft over newer content, so that recovery never rolls my document back.
23. As a writer, I want the source draft kept until recovery has re-keyed it successfully, so that a failed recovery leaves the draft in place.
24. As a writer, I want no draft written after I close a document, so that closed documents don't reappear as drafts.
25. As a writer, I want a reload caused by an external change to keep my cursor, selection and scroll position, so that the reload doesn't make me lose my place.
26. As a writer, I want an editor flush that arrives after an external reload never to write the old text back over the new file, so that external changes aren't silently reverted.
27. As a writer, I want the same file opened through two different paths to be guarded as one file, so that an alias path can't bypass the external-change check.
28. As a writer, I want an external replace while another window holds unsaved edits to behave in a known way, so that a second window doesn't lose edits silently.
29. As an MCP client user, I want a rejected or timed-out approval to leave the document unchanged, so that refusing an AI edit really refuses it.
30. As an MCP client user, I want an approved insert never to be overwritten by a late flush from the old editor, so that the AI's edit and mine both survive.
31. As an MCP client user, I want an insert into a background document to leave my active document untouched, so that AI edits only go where they were aimed.
32. As an MCP client user, I want an approved table edit in WYSIWYG to change the editor and the store together, or neither, so that the table on screen is the table that's saved; and I want the Source branch's known gap recorded, so that it is fixed rather than forgotten.
33. As an MCP client user, I want an MCP table edit to keep my undo history and TOC, so that it behaves like an ordinary edit.
34. As an MCP client user, I want the MCP mirror of each document to converge on what I typed after I stop, so that the AI reads my current text.
35. As a writer, I want external opens routed to the window that already holds the file even when the MCP server is off, so that turning MCP off doesn't break opening files (ADR-0033).
36. As an MCP client user, I want offsets in documents with emoji to mean the same characters on both sides, so that AI edits land in the right place.
37. As a maintainer migrating to Tiptap, I want each entry point's obligations listed as numbered clauses, so that I know exactly what my change must keep.
38. As a maintainer, I want each clause to have evidence that fails when its guard is removed, on the side of the boundary where the guard lives, so that a green suite means something.
39. As a maintainer, I want journeys to drive the real app and assert bytes written, so that the evidence survives a change of engine.
40. As a maintainer, I want journeys to assert which tokens moved and which didn't, so that a migration that silently changes token semantics is caught.
41. As a maintainer, I want today's unsafe behaviour recorded with a desired outcome and a reference, so that I can tell an improvement from a regression.
42. As a maintainer, I want journeys to load documents by MIG-001 case-id, so that the bytes have reviewed rationales.
43. As a maintainer, I want the harness to fail when a journey leaves timers, listeners or flushers behind, so that one journey cannot contaminate the next.
44. As a maintainer, I want the harness to fail on any IPC call it doesn't model, so that an unmodelled write can't pass unseen.
45. As a maintainer, I want StrictMode double-mounting exercised in each row, so that mount and unmount bugs show up before production enables it.
46. As the delegator, I want each ticket to state its time cost, so that I can check the CI budget at grant.
47. As the delegator, I want every known limitation to come to me as a finding, so that I can open its D-item.
48. As the device tester, I want one Mac card per row and one batch for all of them, so that one run proves the row set on a real WKWebView.
49. As the MIG-005 implementor, I want each row to name the host sites that call the editor directly, so that I know which callers each port change touches.
50. As the MIG-005/013 planner, I want today's serializer-failure behaviour pinned per row, so that the failure policy starts from facts.

## Implementation Decisions

### Vocabulary
- **Entry-contract row:** one row of plan §4.2's table, lettered a…h: a save / Save As; b tab/mode switch; c tab/window close and quit; d draft timer and recovery; e external wholesale replace; f MCP write/insert; g MCP table; h MCP mirror. Row h was added by #686; §15 lists a…g.
- **Contract clause:** one obligation of a row, id `<row>-C<n>`, never renumbered. A retired clause keeps its id. Each row's serializer-throws clause is `<row>-CS`.
- **Guarantee clause:** a clause stating a safe outcome that today's code is expected to deliver.
- **Pin clause:** a clause that freezes today's outcome where neither §4.2 nor an accepted ADR states the right one. The r3 pins are a-C7, a-C9, b-C2, b-C7, c-C2, c-C7, e-C5, e-C7, f-C2 and every `<row>-CS`.
- **Frontend half / Rust half:** the parts of one clause enforced in the frontend and in Rust. A clause with a Rust half lists the half in its text.
- **App journey:** a test that renders the real `<App />` through the journey harness and asserts external effects: write-log bytes, the IPC call log, dialog and quit replies, visible state, and token deltas.
- **Negative journey:** an App journey that attempts the unsafe thing and asserts that nothing unsafe happened. It is distinct from MIG-001's declarative "negative case".
- **Current-outcome journey:** an App journey that asserts today's outcome of a pin or known-limitation clause, whatever it is.
- **Write log:** the fake boundary's ordered record of every `save_file`, `save_file_dialog`, `save_draft` and `delete_draft`, with the document id, the path and the exact bytes.
- **IPC call log:** the harness's ordered record of every other IPC command with its arguments (for example `mcp_sync_documents`, `mcp_confirm_reply`, `quit_guard_reply`).
- **Known limitation (MIG-002):** a record of unsafe current behaviour, id `<row>-KL<n>`.
- **Clause status:** each clause ends its ticket as `PROVED` (a guarantee with its full evidence), `PINNED` (a pin whose outcome is safe), or `NOT PROVED` (on the known-limitation path).
- **State owner:** the module that, at 7bb42efb, holds the authoritative copy of a piece of state a row touches (D28).
- **M0 Mac batch:** the single device run of all MIG-002 cards, at the master SHA after the last sub-PR lands.

### Evidence paths (r2: MH1, MH4; r3: R2-H2, R2-H3, M2, M5)
Every clause takes exactly one path.

1. **Guarantee, frontend-enforced:**
   - at least one passing App journey;
   - at least one negative journey;
   - one temporary-mutation receipt per distinct guarded path in `src/`, id `MIG002-<row>-<clause>-<n>`;
   - its existing suites cited.
2. **Guarantee with a Rust half** (the exception to path 1, stated precisely):
   - The **frontend half** follows path 1. Its journeys assert only what the frontend does: the token is forwarded, the reply is sent, nothing is applied without the event, and the payload is handled as Rust produces it.
   - The **Rust half** is proved by named `cargo test`s.
     - Existing tests are cited by exact path, `<file>::<test>`, where `<file>` is the test file under `src-tauri/src/` (for an inline module, `<file>::tests::<test>`). A prose name is never enough. The handoff names the assertion that would fail if the half were broken. No new receipt is needed, because those tests carry their own D-item evidence.
     - A sub-obligation that no Rust test covers gets a new `cargo test` in the existing Rust test layout (rule 10), with one temporary-mutation receipt of a tracked `src-tauri/` file, id `MIG002-<row>-<clause>-R<n>`. It is listed as a filled gap.
   - **The fake's modelled behaviour is declared.** Every behaviour the fake boundary performs on a Rust half's behalf (a stale claim writing the destination and keeping the source, emitting only after approval, one copy per held alias spelling, a debounced event) is a row in the harness's **fake-behaviour table**. A journey may rely on the fake only through a declared row. How a row is tied to Rust (r3, M2):
     - **A row that carries a payload** (an event body, an error wire shape, the per-spelling copies) is tied by a **shared fixture**: a JSON file that a Rust test produces or reads with `include_str!` and the harness reads too, in the pattern of the D173 alias payload fixture and `file_watcher_holders_live_tests.rs`. Where no such fixture exists, the ticket adds one with the Rust test that reads it, as a filled `-R<n>` gap.
     - **A row with no payload** (an ordering or an absence, such as "nothing is emitted before approval") is pinned to a cited test's assertion by exact path, and the handoff quotes that assertion.
     - Each row names the exact Rust test whose assertion it models, and that test must assert the behaviour the clause relies on, not merely touch the same module.
   - Clauses on this path at r3: a-C8, d-C2, e-C4, e-C6, f-C1 and h-C2.
   - **Rust-only clause** (r3, R2-H2; the one exception to the frontend half): a clause that states no frontend obligation takes path 2 with **no frontend half**: no App journey, no negative journey and no frontend receipt. Instead, the clause lists its Rust sub-obligations, and each one maps to a named existing test by exact path, or to a new `cargo test` with an `MIG002-<row>-<clause>-R<n>` receipt listed as a filled gap. A sub-obligation with neither leaves the clause `NOT PROVED`. The shared ticket criterion for path 2 carries the same exception. The only Rust-only clause at r3 is h-C6.
3. **Pin:**
   - A current-outcome journey and one temporary-mutation receipt proving that its assertion is wired (changing the current outcome turns it red).
   - A negative journey only where the clause names an unsafe attempt.
   - If the pinned outcome turns out unsafe, the clause moves to path 4.
4. **Known limitation** (the current outcome is unsafe):
   - a current-outcome journey that names the record `<row>-KL<n>`, driven only through external inputs or the harness's declared fault helpers (the real-serializer break; for g-C6, the CodeMirror transaction fault);
   - one temporary-mutation receipt `MIG002-<row>-KL<n>-<k>` proving that the journey's assertion is wired;
   - the clause's status is `NOT PROVED`, in the ticket's clause-status table and in the handoff. It is never counted as a passing guarantee, and no negative journey is required for it;
   - a tracked fix: the record's `ref` is a D-id or an issue the delegator opened. A check test fails on `ref: pending`.
   - **Landing ground (ADR-0146 decision 4; r3, R2-H3).** The clause's guarantee is an AC the sub-PR does not meet, so its `NOT PROVED` is High unless accepted. The ground is **(a)**: the guarantee is moved to the later item that the record's `ref` names. Before that sub-PR's round-one audit, the delegator records the acceptance on ground (a), naming the `ref`, and the audit request cites it. A path-4 clause without that recorded acceptance blocks the sub-PR. What the sub-PR itself must meet is the record, the current-outcome journey and its `KL` receipt.
   - **A current outcome that cannot be driven** (r3, M5): if no journey can reach the outcome through external inputs or a declared fault helper, the implementor stops and sends it to the delegator. The record then carries `observable: false`, with no journey and no receipt. The clause stays `NOT PROVED`, and it lands only on the same recorded ground (a), or on ground (c), a user waiver recorded as an audit-log gate exception. No production seam is added for it.

**Precedence over the shared criteria:**
- The rule that a journey asserts "no `failed` flush is reported as success" binds guarantee and pin journeys.
- A path-4 journey that asserts such a report is exempt, and its clause is `NOT PROVED`.
- The serializer-throws clause `<row>-CS` is a pin: it follows path 3 if today's outcome is safe and path 4 if it is not.

**StrictMode-only failures:** a journey that fails only with StrictMode on takes path 4 with `strictModeOnly: true` in its record. The finding says that production runs without StrictMode.

**Consumer.** MIG-005 reads each row's clause-status table. A `NOT PROVED` clause is MIG-005's input, not a MIG-002 landing blocker.

### Contract clauses (r3, frozen on approval)
The clauses come from §4.2, §5 and the accepted ADRs. A ticket may not drop or reword one. An implementor who finds a clause wrong or untestable sends it to the delegator, and changing it is a new revision.

**Row a: save / Save As** (D7: Save As onto an open path; IME; two windows)
- **State owners (D28):** text and dirty state, the document store; unflushed edits, the Milkdown editor's edit-sync controller; the save transaction, the save service (snapshot, queue, result application); baselines, the baseline-epoch tables; the external-change gate, the external-change store.
- a-C1: saves of one document are serialized from snapshot to result application. A second save during an in-flight save never lands older bytes after newer ones.
- a-C2: Cmd+S before the edit-sync delay elapses writes the latest typed text.
- a-C3: the settle flush after the await runs. Input typed during an in-flight save stays dirty after the result is applied.
- a-C4: a failed flush writes nothing, does not mark the document clean, and is never reported as success.
- a-C5: closing, reopening, reloading or moving the document during an in-flight save invalidates the old task. Its result neither marks the new buffer clean nor rebaselines it.
- a-C6: the external-change gate (D171) and the ignored-deletion consent (D290) still run before a write.
- a-C7 (pin): Save As writes to the chosen path, and later saves follow it. Save As onto a path open in another tab gives today's outcome.
- a-C8 (Rust half):
  - **Frontend:** a save notice from another window (its origin names another window) does not overwrite this window's dirty buffer, and this window's own save is skipped as `own-save`.
  - **Rust:** the save notice and its origin are emitted to every other holder (ADR-0086). Cite `services/file_watcher_save_notice_tests.rs::d173_wi2_a_save_notifies_the_other_window_and_own_event_stays_unchanged`, `services/file_watcher_save_notice_tests.rs::d173_wi2_a2_one_notice_per_distinct_held_spelling`, `services/file_watcher_save_notice_shape_tests.rs::d173_wi2_s1_notice_is_the_watcher_payload_plus_camel_case_origin` and `services/file_watcher_route_own_save_tests.rs::os1_event_after_a_completed_save_is_ignored_unchanged`.
- a-C9 (pin): Cmd+S during an IME composition.
- a-CS (pin): the serializer throws during a save.

**Row b: tab/mode switch**
- **State owners:** the active document, the document store; the view mode, the editor store; the switch decision, the flush-refusal helpers; unflushed edits, the Milkdown editor; the scroll anchor, the scroll-anchor capture on the outgoing view.
- b-C1: a tab switch reads the state after the flush. An edit inside the edit-sync delay survives.
- b-C2 (pin): WYSIWYG → Source → WYSIWYG in quick succession keeps every edit. Today's undo and selection outcome is pinned.
- b-C3: when the outgoing document's flush fails, both the document store and the editor store refuse the switch (tab and view mode), and neither store changes.
- b-C4: a failed flush in an unrelated document does not refuse the switch.
- b-C5: the targeted and aggregate flush results stay distinct (ADR-0071). The switch decision uses the targeted result.
- b-C6: the scroll anchor is captured before the mode switch and restored after it. This is content-level in jsdom; position is proved on the card.
- b-C7 (pin): a switch during an IME composition.
- b-CS (pin): the serializer throws during a switch.

**Row c: tab/window close and quit**
- **State owners:** the close and quit transactions, the App's close handlers, the window-close guard and the quit guard; text and dirty state, the document store; unflushed edits, the Milkdown editor; drafts, the Rust draft service, reached through the draft IPC.
- c-C1: the dirty prompt targets the document captured when the close began. Cancel leaves its bytes, dirty state and tab unchanged.
- c-C2 (pin): the re-check after the prompt (the document changed or was saved while the prompt was open).
- c-C3: the draft drain/delete order on close and quit is preserved. No draft is deleted before its document's save succeeds.
- c-C4: after a failed flush, the only instance that holds unserialized edits is not unmounted.
- c-C5: discard happens only with valid user consent ("Don't Save"). An ordinary destroy flushes first and is not a discard.
- c-C6: a quit or last-window close inside the edit-sync delay includes the latest keystrokes.
- c-C7 (pin): a close during an IME composition.
- c-CS (pin): the serializer throws during a close or quit.

**Row d: draft timer and recovery**
- **State owners:** the draft timer, the auto-save hook; recovery, the recover-into-open-tab flow; claims and draft storage, the Rust draft service; text, the document store.
- d-C1: the draft timer writes the Markdown that the store holds, and the draft bytes equal the store's text at that moment.
- d-C2 (Rust half):
  - **Frontend:** recovery forwards its claim token on every `save_draft` and `delete_draft` (IPC call log and write log). Separately, the frontend revision check refuses a write after the target document changed, so that write is not sent. These are two frontend obligations, and neither one stands in for the Rust half.
  - **Rust (ADR-0127 decision 4; r3, R2-H1):** a write carrying a stale token still writes the destination and deletes nothing at the source; a delete carrying a stale token deletes nothing; a same-id stale token keeps the newer draft beside the older text. Cite `services/draft/d299_claim_tests.rs::d299_old_token_never_deletes_a_newer_claim_at_the_same_source_id` (the destination holds `R1`, the source bundle is byte-identical, the stale delete returns `false`), `services/draft/d299_claim_tests.rs::d299_stale_same_id_token_preserves_newer_own_text` (both texts remain), `services/draft/d305_owned_delete_tests.rs::d305_recovery_claim_is_not_deleted` and `services/draft/d305_owned_delete_tests.rs::d305_stale_same_window_delete_preserves_newer_saved_bytes`.
  - **Oracle:** a journey that needs a stale-token outcome relies on the fake-behaviour row "a stale token writes the destination and keeps the source", tied to the first d299 test above. No journey asserts that a stale token writes nothing.
- d-C3: the source draft stays until recovery re-keys it successfully.
- d-C4: recovery into an open tab flushes only that tab (targeted).
- d-C5: a stale recovery is refused. An older draft never overwrites newer content.
- d-C6: no draft is written after its document is closed.
- d-CS (pin): the serializer throws during a draft write or a recovery.

**Row e: external wholesale replace** (D7: alias paths; two windows)
- **State owners:** the replacement transaction, the wholesale-replace helper; the open-write guard; the reload count, the Milkdown editor store's per-document generations; the change events, the Rust file watcher; text, the document store.
- e-C1: focus, selection and both scroll anchors (Source and WYSIWYG) are captured on the old live view **before** the reload.
- e-C2: the store replacement, the old writer's invalidation and the generation bump happen as one synchronous step, and the restore happens under the new generation. It is observed by the harness's **transition recorder** (§ Journey harness): no recorded store state shows the new text with the old writer still valid or the old generation.
- e-C3: no late flush from the old writer writes old text after the replacement.
- e-C4 (Rust half; r3, R2-H4):
  - **Frontend:** when an external change reaches a file held under two spellings, Rust sends **one copy per held spelling**, each with `path` set to that spelling (D185). Given those copies (a declared fake-behaviour row, tied by a shared Rust-produced fan-out fixture), each holder's document, canonical or alias, records its own pending change, and no document records one for a spelling it does not hold. The D173 alias payload fixture is not used for this row, because it predates D185 and carries the canonical spelling only.
  - **Rust:** alias spellings are one watch group, and the watcher fans out one copy per held spelling (ADR-0086, D173, D185). Cite `services/file_watcher_fanout_tests.rs::d185_wi2_a_two_spellings_two_windows_both_get_an_external_modify`, `services/file_watcher_fanout_tests.rs::d185_wi2_b_only_alias_held_alias_and_event_path_get_it`, `services/file_watcher_fanout_tests.rs::d185_wi2_d_two_tabs_in_one_window_both_get_it`, `services/file_watcher_baseline_spelling_tests.rs::d106_a_removing_one_spelling_keeps_the_others_baseline` and `services/file_watcher_notice_spelling_tests.rs::d173_wi4_b97_component_equal_spellings_each_get_a_notice`. No Rust-produced fan-out fixture exists at 8b13ccff, so the ticket adds one, read by a new test in the fan-out module that compares it with `fan_out`'s output, with an `MIG002-e-C4-R<n>` receipt.
- e-C5 (pin): an external replace while another window holds this document dirty.
- e-C7 (pin; split from r2's e-C4): opening one file under two raw spellings. The open-write guard compares exact path strings, and nothing in the frontend canonicalises them. A current-outcome journey pins today's outcome of the second opening (whether a second tab opens and how each tab is guarded). If that outcome is unsafe, for example two writable tabs on one file, the clause moves to path 4 as a known limitation.
- e-C6 (Rust half):
  - **Frontend:** rapid external changes produce at most one prompt within the frontend's prompt debounce, and no conflicting reloads.
  - **Rust:** the watcher's per-path, per-kind debounce restarts on a change of state (ADR-0111). Cite `services/file_watcher_route_debounce_kind_tests.rs::dk_c_two_modified_inside_the_interval_still_debounce`, `services/file_watcher_route_debounce_kind_tests.rs::dk_a_replace_then_remove_reports_the_deletion`, `services/file_watcher_route_state_change_tests.rs::sc_a_modified_rm_recreate_inside_the_interval_ends_modified` and `services/file_watcher_route_state_change_tests.rs::sc_c_the_same_state_repeated_is_still_debounced`.
- e-CS (pin): the serializer throws during an external replace.

**Row f: MCP write/insert** (ADR-0044)
- **State owners:** the insert, the MCP event hook and the insert-content helper; approval and its timeout, the Rust confirm broker and gate; text, the document store; the WYSIWYG view, the Milkdown editor.
- f-C1 (Rust half):
  - **Frontend:** no insert event means no change to the store, the editor or the write log. Every confirm request gets exactly one `mcp_confirm_reply` with the user's answer, seen in the IPC call log.
  - **Rust:** a rejected or timed-out (60 s) approval never emits the insert. Two sub-obligations:
    - the approval maps rejection and timeout to an error: cite `services/mcp_confirm/http_tests.rs::h1_mapping_over_every_outcome`, `services/mcp_confirm/http_tests.rs::h3_each_real_outcome_through_the_gate_yields_its_status`, `services/mcp_confirm/broker_time_tests.rs::b1_a_fresh_request_times_out_at_60_s`, `services/mcp_confirm/broker_tests.rs::the_budget_is_sixty_seconds` and `services/mcp_confirm/gate_tests.rs::g1_exhaustive_rule_over_three_by_three`;
    - the insert handler returns on that error before it emits `mcp:insert_content` (r3, M1). No test at 8b13ccff asserts this, so it is an **expected gap**: a new `cargo test` beside the HTTP-server insert tests, proving that a rejected and a timed-out approval emit no insert event, with an `MIG002-f-C1-R<n>` receipt. Citing the mapping tests does not satisfy it.
- f-C2 (pin): today's WYSIWYG insert strategy (global flush, then wholesale rebuild) and today's different background and Source paths.
- f-C3: after an approved insert, no late flush from the old editor overwrites the inserted content.
- f-C4: an insert aimed at a background document leaves the active document unchanged.
- f-C5: inserted content that is unsafe (category j) is sanitized as it is today.
- f-CS (pin): the serializer throws during an insert's flush.

**Row g: MCP table** (ADR-0065)
- **State owners:** the action, the MCP table-action hook; the WYSIWYG view, the Milkdown editor; the Source view, CodeMirror; text, the document store.
- g-C1: **WYSIWYG branch.** Only the target is flushed. The action re-reads, parses newContent with the editor's parser, and applies it with `replaceAll` **before** any store write (ADR-0065 decision 3).
- g-C2: **WYSIWYG refusals.** No parsed doc, the view unchanged after `replaceAll`, or a throw before the view advanced: the store and the editor are both unchanged, and nothing is written.
- g-C3: **WYSIWYG throw after the view advanced.** The store receives the editor's serialized Markdown, falling back to newContent if that serializer also throws, so the store and the editor agree.
- g-C4: the table edit is an ordinary edit. Undo restores the previous bytes, the TOC is kept, and the wholesale-replace path is never taken (decision 5).
- g-C5: no late flush overwrites the table edit.
- g-C6: **Source branch** (ADR-0065 decision 4). The store is written first, then CodeMirror's dispatch runs. A throwing dispatch is caught and logged, and the store stays ahead of the view.
  - This is the accepted divergence (Amendment B not delivered), so g-C6 takes path 4. It is a known limitation `g-KL1`, `NOT PROVED`, with `ref` #747.
  - **Observable evidence (r3, R2-H3).** The current-outcome journey, in Source mode with the target active, adds a throwing transaction filter to the live Source view through CodeMirror's public API (an appended configuration). The production update then throws inside its existing catch. No production code changes and no module is mocked; the fault is a declared row-g fault helper. The journey asserts that the store holds newContent, the Source view's text is unchanged, the action fails with the dispatch-threw reason, and nothing is written. Its `KL` receipt moves the store write after the dispatch in a temporary mutation, which turns the journey red.
  - **Landing ground:** ADR-0146 decision 4 **(a)**: the guarantee moves to #747. The delegator records it before g's round-one audit (§ Evidence paths, path 4). If the fault cannot reach the catch, path 4's "cannot be driven" rule applies.
- g-CS (pin): the serializer throws during the target flush.

**Row h: MCP mirror** (ADR-0033 decision 4)
- **State owners:** the mirror, the MCP sync hook; the shadow store and routing registry, Rust; text, the document store.
- h-C1: after typing stops, the mirror converges on the store's Markdown once the edit-sync delay (200 ms) and the mirror's content debounce (300 ms) have both elapsed. These are the delays §4.2 names.
- h-C2 (Rust half):
  - **Frontend:** the routing registry's `mcp_sync_documents` calls run the same whether the MCP server preference is on or off. The journey compares the IPC call logs of the two runs (ADR-0033 decision 4).
  - **Rust:** with the server off, nothing is exposed over HTTP. Cite `services/mcp_controller/switch_tests.rs::s1_toggles_from_running_follow_disk_and_runtime_with_fresh_tokens`, `services/mcp_controller/lifecycle_tests.rs::c2_tokens_are_fresh_across_cycles_and_old_ones_are_revoked`, `services/mcp_controller/files_unpublish_tests.rs::f6_unpublish_is_idempotent_and_conserves_siblings`, `services/mcp_controller/stop_abort_tests.rs::c6_the_port_rebinds_immediately_after_a_keep_alive_connection` and `services/preferences_mcp_tests.rs::p4_persist_changes_only_server_enabled_relative_to_typed_round_trip`. If none of these asserts that a request to the old port gets no answer once the server is off, that is a gap with an `MIG002-h-C2-R<n>` receipt.
- h-C3: a cancelled close re-registers with a forced sync that bypasses the dedupe hash, and a close or reopen leaves no stale entry (ADR-0033 decision 4).
- h-C4: offsets use UTF-16 code units on both sides for emoji and ZWJ text (category l).
- h-C5: a successful `mcp_sync_documents` result is the only delivery acknowledgement. On failure the dedupe hash is forgotten, so an identical retry goes out. Nothing treats a sync result as a save or as an MCP client having read the document. The guarded path is the failure branch's hash reset.
- h-C6 (**Rust-only**, path 2's stated exception; r3, R2-H2): the shadow store and the HTTP server. Each sub-obligation maps to its tests:
  1. **sync** stores the documents sent: `services/shadow_store.rs::tests::test_sync_documents`;
  2. **rollback** restores the previous content when an update is undone: `services/shadow_store.rs::tests::test_update_document_content_rollback` and `services/shadow_store.rs::tests::test_update_document_content_rollback_after_insert`;
  3. **routing** is per window, last write wins, and owner and focus agree: `services/shadow_store_routable_tests.rs::sync_routable_last_write_wins_exhaustive`, `services/shadow_store_routable_tests.rs::sync_routable_is_per_window` and `services/shadow_store_owner_focus_tests.rs::of1_agrees_with_separate_readers_across_transitions`;
  4. **HTTP limits** refuse an over-cap document before the confirmation gate: `services/http_server_over_limit_tests.rs::o1_an_over_cap_document_is_refused_with_413_document_too_large` and `services/http_server_over_limit_tests.rs::o6_every_mcp_read_and_write_route_refuses_before_the_confirmation_gate`;
  5. **the sync cap** caps only the oversize document and keeps the rest current: `commands/mcp_sync_cap_d98_tests.rs::s2_only_the_oversize_document_is_capped` and `commands/mcp_sync_cap_d98_tests.rs::s4_after_a_capped_sync_the_store_has_the_small_documents_current`.

  It has no journey, no negative journey and no frontend receipt. Any sub-obligation the handoff finds uncovered gets a new test with an `MIG002-h-C6-R<n>` receipt.
- There is no h-CS, because a flush is not a mirror acknowledgement (D8).

### Journey harness (MIG-002a1; D11, D13, D14, D16, D21, D25)
- It renders the real `<App />` with the real Milkdown and real stores. `<StrictMode>` is an option per journey, and the production entry is unchanged.
- **Boundary.** It reuses MIG-001a's fake Tauri boundary (in-memory file system, write log, opener log) and extends it with:
  - the webview quit event bus, with capture of `quit_guard_reply`;
  - the window close request;
  - `menu:action` delivery;
  - dialog fakes (ask, message, save, open), each answered by a script;
  - the IPC commands the App calls at startup and in the journeys;
  - a `file:changed` emitter that carries the origin window label;
  - an MCP event emitter;
  - updater and process stubs.
- **Fail-closed is a harness layer (MM7).** The harness's own IPC dispatcher throws on any command that neither the harness nor the shared boundary models. MIG-001's shared boundary keeps its own behaviour, whatever that is when #706 lands; MIG-002 does not change it and does not depend on it.
- **The IPC call log (MM8)** records every IPC call, beside the write log. It lands in a1.
- **The fake-behaviour table (MH1)** declares, per behaviour the fake performs on a Rust half's behalf, the Rust test or Rust-produced fixture it is pinned to. It lands in a1, empty except for any rows a1 needs; later tickets add rows.
- **Fake time.** Fake timers are the default, through `advance(ms)`. A journey may use real timers only with a stated reason. MIG-002a1 proves that Milkdown mounts under fake timers; if it can't, the fallback goes to the user through the delegator.
- **Failed flush.** It breaks the **real serializer**, by promoting the D92 break/heal shape into the harness. Journeys may not register fake flushers.
- **Tokens.** `readTokens(id)` reads raw store state:
  - lifetime and replacement;
  - the baseline by id;
  - the baseline by path;
  - reload (absent counts as 0);
  - the window editor generation, as a delta from the journey's start;
  - a menu-target capture.

  Each journey asserts the delta it expects for every token its clause touches, and "unchanged" for the rest.
- **Transition recorder (MM11).** A read-only subscription to the document store and the Milkdown editor store records every notified state during a step. It is the one internal observation the harness allows, and it exists for synchronous-step clauses (e-C2). It is not a call count.
- **Teardown (MM3).**
  - After each journey, the harness cancels the Milkdown ctx timeouts recorded by the existing Milkdown timer drain. These are the 3 s timeouts Milkdown arms and never clears, and only they are exempt.
  - It then asserts that nothing is left: no other pending timer, no live listener, no registered flusher.
- **Additions only, in per-row modules (L4).**
  - The core harness file is a1's. Tickets after a1 add helpers in a row-local helper module and add fake-behaviour rows; they change no existing helper.
  - Changing an existing helper's behaviour goes to the user through the delegator.
  - a1's harness tests and the corpus suite stay green.

### Documents and bytes (D15)
- Journeys open MIG-001 corpus inputs by case-id.
- An unedited write is byte-equal to that case's untouched bytes. An edited write is compared with bytes the journey states, never with bytes re-derived from the engine.
- IME composition journeys (a-C9, b-C7, c-C7) type their composition text through composition events and assert bytes the journey states. They need no category-l case (L3).
- **Corpus dependencies.** Every row depends on MIG-001 category a. The extra categories per row are:

  | Row | Extra categories |
  |---|---|
  | a (a2) | l |
  | b | g, h, n |
  | c | none |
  | d | l |
  | e | l, n |
  | f | b, j |
  | g | e, f |
  | h | l |

  A ticket may add a category; dropping one needs the user.

### Test matrix (MM2; checkpoints named in r3, M3)
A ticket is granted only when its blocking corpus categories have landed, so their case-ids exist. The implementor's test matrix (`jack-tdd-workflow`; Codex: tdd-guardian until go-live) then lists, for every clause:
- its path (1–4);
- its corpus case-ids;
- the unsafe attempt (guarantee clauses);
- the byte oracle (write-log bytes) and the token oracle (expected deltas);
- for a Rust half, the cited or new `cargo test` names and the fake-behaviour rows it relies on.

**One checkpoint each:**
- **Written:** by the implementor, before the first RED.
- **Attacked:** by the fresh attacker, before the first RED. The attack checks that no no-op journey can satisfy it.
- **Checked for coverage:** by the delegator, when confirming the handoff. Every clause must have a row.

### Known limitations (D3, D4, MH4, L4)
- **Records** are kept one file per row in a registry directory, with these fields:
  - `id` (`<row>-KL<n>`);
  - `clause`;
  - `current`;
  - `desired`;
  - `reason`;
  - `ref`;
  - `strictModeOnly` (optional);
  - `observable` (optional; `false` only under path 4's "cannot be driven" rule, r3).
- `ref` is a D-id or an issue the delegator opened. A check test fails on `ref: pending`, so the PR cannot land until the delegator supplies the issue.
- The current-outcome journey names the record id, and the clause is `NOT PROVED`.
- **Ledger:** there is no feature-ledger change, unless a known limitation proves a `Shipped` row false. That row is then rewritten to `Partial` with `限制：` in the same commit.

### Production code (D12)
- Nothing under `src/` or `src-tauri/` changes, except two things:
  - temporary RED mutations, restored before commit;
  - new `cargo test`s for listed Rust-half gaps (path 2), which are test code in the existing Rust test layout.
- A clause whose current outcome can't be driven without a production seam follows path 4's "cannot be driven" rule. It never gets a seam.

### Placement (D10)
- Journeys: `tests/state-safety/<row>-<slug>.journey.test.tsx`, one or more files per row.
- Harness: `tests/helpers/appJourneyHarness.tsx`, with row-local helper modules beside it.
- Registry: `tests/fixtures/state-safety/known-limitations/<row>.json`.
- All of these follow rule 10's placement rules.

### Device AC (D18, D27)
- **Cards.** Each row has a card `docs/test/cards/MIG002-<row>.md` in the ADR-0144 format, with steps tagged `cli`, `computer-use` or `human`, each with its proof, a failure condition, and a log line plus effect. The model is `D326-identity-check.md`. a2's card covers every row-a clause, and b's also holds the scroll-anchor retention steps carried over from MIG-001n.
- **Card review (ADR-0144 decision 2):** each card is reviewed against its row's clauses in that sub-PR's round-one audit request.
- **Named departure from ADR-0144** (user: #686 item 4; r2 user: 「Keep #686, name departure (Recommended)」):
  - **Decision 3** puts an item's device run in audit round one, before landing. For MIG-002, each of the nine sub-PRs, a1 included, lands instead with a waiver. Each waiver is an audit-log gate exception under decision 5, quoting the user's ruling and naming the M0 Mac batch.
  - **Decision 6** says batches no longer carry an item's first check. Here, one M0 Mac batch carries the first check of all eight cards, at the master SHA after the last sub-PR lands.
  - A batch FAIL reopens the owning row.

### Tickets and edges (D19, D25)
Nine tickets. Row a is split in two (D25, which overrides #686 item 1's "8 sub-PRs" and item 8's "ticket a blocks b…h"):
- **a1** holds the harness, the registry and its check test, a-C2, a-C4 and a-CS. It uses category a cases only.
- **a2** holds a-C1, a-C3 and a-C5…C9, and the row-a card.

| Ticket | Blocked by |
|---|---|
| a1 | #706 (MIG-001a) |
| a2 | a1, #717 (l) |
| b | a1, #712 (g), #713 (h), #719 (n) |
| c | a1 |
| d | a1, #717 (l) |
| e | a1, #717 (l), #719 (n) |
| f | a1, #707 (b), #715 (j) |
| g | a1, #710 (e), #711 (f) |
| h | a1, #717 (l) |

r2 and r3 change no edge. One M0 Mac batch covers eight cards, one per row: a1 has no card of its own, and a2's card covers every row-a clause.

Each ticket names:
- its clauses and their paths;
- its state owners;
- its corpus categories, with case-ids in its test matrix;
- its StrictMode clauses;
- its reused suites;
- its Rust tests;
- its Mac card steps;
- its MIG-005 host sites, from `git grep -n 'getEditor()' src` at its base. The 7bb42efb reference has 13 calls (the grep prints 15 lines; the other two are comments, in `insertTable.ts` and `milkdownEditorStore.ts`, and are not host sites): `App.tsx`, `TableContextMenu` (×2), `mcpTableAction`, `windowCloseAttempt`, `wysiwygKeymapEntries` (adapter-internal), `editorStore`, `editorImageInsert`, `editorMenuCommands`, `focusActiveEditor`, `milkdownFocusCarry`, `scrollAnchor/capture` and `tableInsertTrigger`. This is the same set as §4.2's eleven positions plus the adapter-internal site (L2).

## Testing Decisions

**What makes a good test here.**
- An App journey asserts only external effects: the write log's bytes and order, the IPC call log, the dialog and quit replies, what the user can see (dirty mark, active tab, view mode, text), and the token deltas.
- The one allowed internal observation is the transition recorder, used only for synchronous-step clauses.
- A journey never asserts plugin order, internal call counts or Milkdown APIs.
- A clause's evidence is defined by its path (§ Evidence paths), and its status is reported per clause.

**Seams** (user: 「yes」; widened in r2 by MH1):
1. **The App journey**, the main seam: the real `<App />` over the fake Tauri boundary. It covers every row's frontend half.
2. **Rust `cargo test`s** for the Rust halves of a-C8, d-C2, e-C4, e-C6, f-C1 and h-C2, and for the Rust-only h-C6, existing or new, cited by exact path. The Rust halves are tied to the App seam through the declared fake-behaviour table; h-C6 has no tie, because it has no frontend half.

**What MIG-002a1 tests about the harness itself:**
- a save records exact bytes;
- an unedited open records no write;
- the IPC call log records a non-write command with its arguments;
- a scripted dialog answer reaches the app;
- a quit reply is captured;
- an unmodelled IPC call throws;
- a journey that leaves a non-Milkdown timer, a listener or a flusher behind fails, while the Milkdown ctx timeouts are drained;
- the real serializer break yields `failed`, and the heal restores it;
- `readTokens` reports a known delta;
- the transition recorder records each notified state;
- Milkdown mounts under fake timers;
- the known-limitation registry check rejects `ref: pending` and malformed records.

**RED evidence (D22).**
- Receipts are recorded by MIG-001's procedure:
  1. edit a tracked file on the guarded path (`src/`, or `src-tauri/` for a new Rust test);
  2. record the RED;
  3. restore the file;
  4. run green;
  5. put the diff, the failing assertion and the restore in the handoff, with "replay passes at base" under Known qualifications.
- Ids: `MIG002-<row>-<clause>-<n>`, `MIG002-<row>-<clause>-R<n>` for Rust, and `MIG002-<row>-KL<n>-<k>` for a known limitation.
- The existing suites stay where they are, unrewritten, and are cited per clause.

**Budget (D17, D26; user: 「5 s / 15 s / 5 + 5 min (Recommended)」).**
- Each journey runs under 5 s under coverage, measured and reported. This is the budget, not a timeout.
- Each journey file sets a 15 s test timeout, so a budget breach shows up as a reported figure, not a timeout flake.
- Each file runs under 60 s.
- **Shard time** is the sum of per-file durations across the four `frontend` shards in a coverage run.
- MIG-002's journeys add at most 5 minutes of shard time. MIG-001 keeps its own 5-minute corpus ceiling, so M0 adds at most 10 minutes in all.
- These figures are D17's own; plan §17 has no CI number.
- Each handoff reports its row's times and both running totals.

**Prior art:**
- `tests/d297-tabless-editor-column.test.tsx`, `control-app-readiness.test.tsx` and `m4-app-menu.test.tsx` (the real `<App />` in jsdom; `menu:action` delivery);
- `tests/helpers/milkdownEditorHarness.tsx` (typing into the real editor) and `tests/helpers/milkdownTimerDrain.ts` (the ctx timeouts);
- `d92-failed-flush-blocks-switch` (real serializer break and heal);
- `d173-other-window-save`, `d173-alias-delivery` and the D173 alias payload fixture (other-window origin; the shared-fixture pattern, not e-C4's payload);
- `d185-alias-delivery-contract` (the per-spelling copies, hand-built there; e-C4's journeys use a Rust-produced fixture instead, and that suite stays as it is);
- `quit-guard-wysiwyg-flush` and the `useQuitGuard*` suites (the quit bus and replies);
- `useMcpSync.retry` (the hash reset on failure);
- `d42-app-dialog-open-order` and `d110-about-settings-strict-mode` (StrictMode in tests);
- MIG-001a's fake boundary.

## Out of Scope

- **Fixing any unsafe behaviour found**, including ADR-0065 decision 4's Source-branch divergence. It is recorded as a known limitation and fixed by a separate D-item, with an ADR change if one is needed.
- **The serialization-failure policy** (whether the writer stays mounted, recoverable snapshots, refused transitions): MIG-005/013 (#689). MIG-002 records today's behaviour as their input.
- **Windows Ctrl/AltGr/IME/window routing:** WIN-001's `WCM` rows (DEC-001).
- **The editor port, adapters, and any production seam:** MIG-005.
- **Enabling `<StrictMode>` in production.**
- **Real WebKit or WKWebView automation:** the Mac cards cover the device side, and MIG-003's advisory lane is separate.
- **Moving or rewriting existing unit suites**, Rust or frontend.
- **Any new CI job or `ci-gate` change.**
- **Rust behaviour changes:** new Rust tests only for listed gaps.

## Further Notes

- **Plan text this spec overrides (D23), to fix in plan v1.4:**
  - §15 "MIG-002a…g" becomes a1, a2 and b…h: MCP mirror added (#686), and row a split (D25).
  - §5 MIG-002's Windows Ctrl/AltGr/IME/window-routing item moves to WIN-001's `WCM` rows.
  - §4.2's MCP-mirror "ACK limits" reads: the sync IPC result is the only delivery acknowledgement, and it is not a save or a read confirmation (h-C5).
  - §4.2's "200 ms editor / 300 ms mirror" is kept as written. 200 ms is the edit-sync delay and 300 ms the mirror's content debounce; this is a naming note, not a drift (L1).
  - §4.2's eleven host sites plus the adapter-internal site are the 13-call grep at each ticket's base; only §4.2's parenthetical "12 call sites" miscounts (L2).
  - §4.2's "Owner" is read as today's state owner (D28).
- **ADR-0144 departure:** named under § Device AC (D27).
- **Known qualification:** a characterization receipt's replay at base passes by construction.
- **jsdom only:** journeys characterize jsdom, and the Mac cards cover WKWebView.
- **Delegator checkpoints (r3, M3):**
  - **at grant:** every ticket that blocks it has landed, including #706 before a1;
  - **at handoff confirmation:** the test matrix covers every clause, and the reported journey times are within D26's ceilings;
  - **before round-one audit:** each path-4 clause has its recorded ADR-0146 decision-4 acceptance, cited in the audit request;
  - **at landing:** the sub-PR's waiver is a recorded user ruling and an audit-log gate exception.
- **Findings for the delegator** (D-items or issues; the planner reserves none):
  - #747 (opened by the delegator after r2) is g-C6's `ref`;
  - every known limitation each ticket records.
- **Gate sensitivity and ADRs:** none. It adds no dependency, contract, persisted format or surface; there is no new job, and `ci-gate` is unchanged (D24). The ADR-0144 departure uses that ADR's own waiver clause (decision 5) and is named, so no superseding ADR is needed.
- **Status:** not granted. `ready-for-agent` is not a grant (rule 12).
