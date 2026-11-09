Part of #702 (MIG-002 row). Plan: `docs/plans/20261107-mdpro_tiptap_windows_plan_v1-3.md` §1.1, §4.2 (entry-contract table), §5 MIG-002, §15 row MIG-002. Decisions: #686 (user: all eight "(Recommended)", then "Yes, record it (Recommended)"); grill record `MIG002-r1-D1`…`D24` (user: 「all yes」 in each of three rounds); seams (user: 「yes」); ticket split `MIG002-r1-D25` (user: 「u recommend the best practices」, choosing the planner's recommended split of ticket a). Tier High; gated (rule 12); record Issue; no ADR; not gate-sensitive; device AC: Mac (ADR-0144). Snapshot: `docs/specs/mig-002-state-safety/r1/`.

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
  - a **write log** of every `save_file`, `save_draft` and `delete_draft` with its exact bytes;
  - a read-only view of the document's tokens (§1.1).

  It reuses the fake Tauri boundary that MIG-001a builds. Production code is not changed.
- **Contract clauses.** Each row is split into numbered clauses `<row>-C<n>`, each one obligation, worded close to §4.2. Every clause has:
  1. at least one passing App journey;
  2. at least one **negative journey**, which attempts the unsafe thing (a failed flush, a cancel, a stale token, a rejected approval) and asserts that nothing unsafe happened;
  3. a temporary-mutation RED receipt for each distinct guarded code path;
  4. the existing suites that already cover it, cited.
- **Today's unsafe behaviour is recorded, not fixed.** A journey that finds a loss pins what happens today and names a **known-limitation** record (current, desired, reason, and a D-id or issue). The delegator receives it as a finding, and the fix is a separate D-item.
- **Nine PRs (D25).** Ticket a1 lands the harness, the known-limitation registry and row a's two core clauses as the tracer bullet; a2 finishes row a. a1 blocks a2 and b…h, which then run in parallel. Each ticket names its corpus case-ids, its clauses, its negative journeys, its token assertions, its Mac card steps, and its MIG-005 consumer sites.
- **Device evidence.** Each row writes a Mac card. One M0 Mac batch runs all eight cards after the last sub-PR lands. Until then, each sub-PR lands with a recorded user waiver that names that batch.

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
32. As an MCP client user, I want an approved table edit to change the editor and the store together, or neither, so that the table on screen is the table that's saved.
33. As an MCP client user, I want an MCP table edit to keep my undo history and TOC, so that it behaves like an ordinary edit.
34. As an MCP client user, I want the MCP mirror of each document to converge on what I typed after I stop, so that the AI reads my current text.
35. As an MCP client user, I want no mirror traffic when MCP is off, so that disabling MCP really disables it.
36. As an MCP client user, I want offsets in documents with emoji to mean the same characters on both sides, so that AI edits land in the right place.
37. As a maintainer migrating to Tiptap, I want each entry point's obligations listed as numbered clauses, so that I know exactly what my change must keep.
38. As a maintainer, I want each clause to have a journey that fails when the guard is removed, so that a green suite means something.
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
- **Contract clause:** one obligation of a row, id `<row>-C<n>`, never renumbered. A retired clause keeps its id.
- **App journey:** a test that renders the real `<App />` through the journey harness and asserts external effects: write-log bytes, dialog and quit replies, visible state, and token deltas.
- **Negative journey:** an App journey that attempts the unsafe thing and asserts that nothing unsafe happened. It is distinct from MIG-001's declarative "negative case".
- **Write log:** the fake boundary's ordered record of every `save_file`, `save_draft` and `delete_draft` (and `save_file_dialog`), with the document id, the path and the exact bytes.
- **Known limitation (MIG-002):** a record of unsafe current behaviour, id `<row>-KL<n>`.
- **M0 Mac batch:** the single device run of all MIG-002 cards, at the master SHA after the last sub-PR lands.

### Contract clauses (r1 draft, frozen on approval)
The clauses below come from §4.2 and §5. A ticket may not drop or reword one. An implementor who finds a clause wrong or untestable sends it to the delegator, and changing it is revision r2.

**Row a: save / Save As** (D7: Save As onto an open path; IME; two-window)
- a-C1: Saves of one document are serialized from snapshot to result application. A second save during an in-flight save never lands older bytes after newer ones.
- a-C2: Cmd+S before the edit-sync delay elapses writes the latest typed text.
- a-C3: The settle flush after the await runs. Input typed during an in-flight save stays dirty after the result is applied.
- a-C4: A failed flush writes nothing, does not mark the document clean, and is never reported as success.
- a-C5: Closing, reopening, reloading or moving the document during an in-flight save invalidates the old task. Its result neither marks the new buffer clean nor rebaselines it.
- a-C6: The external-change gate (D171) and the rebuild-consent check still run before a write.
- a-C7: Save As writes to the chosen path, and later saves follow it. Save As onto a path open in another tab gives today's outcome, pinned.
- a-C8: A save in another window (`file:changed` with another window's origin) does not overwrite this window's dirty buffer.
- a-C9: Cmd+S during an IME composition gives today's outcome, pinned.

**Row b: tab/mode switch**
- b-C1: A tab switch reads the state after the flush. An edit inside the edit-sync delay survives.
- b-C2: WYSIWYG → Source → WYSIWYG in quick succession keeps every edit. Today's undo and selection outcome is pinned.
- b-C3: When the outgoing document's flush fails, both the document store and the editor store refuse the switch (tab and view mode), and neither store changes.
- b-C4: A failed flush in an unrelated document does not refuse the switch.
- b-C5: The targeted and aggregate flush results stay distinct (ADR-0071). The switch decision uses the targeted result.
- b-C6: The scroll anchor is captured before the mode switch and restored after it. This is content-level in jsdom; position is proved on the card.
- b-C7: A switch during an IME composition gives today's outcome, pinned.

**Row c: tab/window close and quit**
- c-C1: The dirty prompt targets the document captured when the close began. Cancel leaves its bytes, dirty state and tab unchanged.
- c-C2: The re-check after the prompt (the document changed or was saved while the prompt was open) gives today's outcome, preserved.
- c-C3: The draft drain/delete order on close and quit is preserved. No draft is deleted before its document's save succeeds.
- c-C4: After a failed flush, the only instance that holds unserialized edits is not unmounted.
- c-C5: Discard happens only with valid user consent ("Don't Save"). An ordinary destroy flushes first and is not a discard.
- c-C6: A quit or last-window close inside the edit-sync delay includes the latest keystrokes.
- c-C7: A close during an IME composition gives today's outcome, pinned.

**Row d: draft timer and recovery**
- d-C1: The draft timer writes the Markdown that the store holds, and the draft bytes equal the store's text at that moment.
- d-C2: Target, claim (ADR-0127 `claimToken`) and revision ownership hold. A draft write or delete with a stale claim changes nothing.
- d-C3: The source draft stays until recovery re-keys it successfully.
- d-C4: Recovery into an open tab flushes only that tab (targeted).
- d-C5: A stale recovery is refused. An older draft never overwrites newer content.
- d-C6: No draft is written after its document is closed.

**Row e: external wholesale replace** (D7: alias paths; two-window)
- e-C1: Focus, selection and both scroll anchors (Source and WYSIWYG) are captured on the old live view **before** the reload.
- e-C2: The store replacement, the old writer's invalidation and the generation bump happen as one synchronous step. The restore happens under the new generation.
- e-C3: No late flush from the old writer writes old text after the replacement.
- e-C4: The same file opened through an alias path is guarded as one file by the open-write guard.
- e-C5: An external replace while another window holds this document dirty gives today's outcome, pinned.
- e-C6: Rapid external changes produce no conflicting reloads (debounced).

**Row f: MCP write/insert** (ADR-0044)
- f-C1: The approval, target and version checks are unchanged. A rejected or timed-out approval changes neither the store nor the editor nor the write log.
- f-C2: Today's WYSIWYG insert strategy (global flush, then wholesale rebuild) and today's different background and Source paths are pinned.
- f-C3: After an approved insert, no late flush from the old editor overwrites the inserted content.
- f-C4: An insert aimed at a background document leaves the active document unchanged.
- f-C5: Inserted content that is unsafe (category j) is sanitized as it is today.

**Row g: MCP table** (ADR-0065 D1–5)
- g-C1: Only the target is flushed. The action re-reads, validates, and applies to the editor **before** writing the store.
- g-C2: A refusal leaves both the editor and the store unchanged.
- g-C3: A throw after the dispatch is reconciled, so the editor and the store agree.
- g-C4: The table edit is an ordinary edit: undo restores the previous bytes, and the TOC is kept. It never takes the wholesale-replace path.
- g-C5: No late flush overwrites the table edit.

**Row h: MCP mirror**
- h-C1: After typing stops, the mirror converges on the store's Markdown, once the edit-sync delay (200 ms) and the mirror debounce (300 ms) have elapsed.
- h-C2: With MCP off, there are no mirror calls, and routing follows today's rules.
- h-C3: Cancelling and re-registering (close, reopen) leaves no stale mirror entry.
- h-C4: Offsets use UTF-16 code units on both sides for emoji and ZWJ text (category l).
- h-C5: No server ACK exists. A flush or a sync call is never treated as a save or a server confirmation.
- h-C6: The Rust side's independent sync and approval are cited by their existing `cargo test` names. A new Rust test is added only for a sub-obligation with no coverage, and the gap is listed.

Each of rows a–g also has one **serializer-throws journey** (D8) that pins today's outcome for that row's flush. It is filed as a known limitation only if the outcome is unsafe (a `failed` flush reported as success, or dirty dropped). It is listed as input to MIG-005/013 (#689).

### Journey harness (MIG-002a1; D11, D13, D14, D16, D21, D25)
- It renders the real `<App />` with the real Milkdown and real stores. `<StrictMode>` is an option per journey, and the production entry is unchanged.
- **Boundary.** It reuses MIG-001a's fake Tauri boundary (in-memory file system, write log, opener log) and extends it with:
  - the webview quit event bus, with capture of `quit_guard_reply`;
  - the window close request;
  - `menu:action` delivery;
  - dialog fakes (ask, message, save, open), each answered by a script;
  - the IPC commands the App calls at startup and in the journeys (launch paths, draft list, logging, the open dialog, MCP sync, watch commands);
  - a `file:changed` emitter that carries the origin window label;
  - an MCP event emitter;
  - updater and process stubs.

  An IPC call the harness does not model throws, so the harness fails closed. MIG-001's existing boundary behaviour is unchanged, and the corpus suite stays green.
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
- **Teardown.** After each journey, the harness asserts that nothing is left: no pending timers, no live listeners, no registered flushers.
- **Tickets after a1 may only add** to the harness and the boundary. Changing an existing helper's behaviour goes to the user through the delegator.

### Documents and bytes (D15)
- Journeys open MIG-001 corpus inputs by case-id.
- An unedited write is byte-equal to that case's untouched bytes. An edited write is compared with bytes the journey states, never with bytes re-derived from the engine.
- **Corpus dependencies.** Every row depends on MIG-001 category a. The extra categories per row are:

  | Row | Extra categories |
  |---|---|
  | a | l |
  | b | g, h, n |
  | c | none |
  | d | l |
  | e | l, n |
  | f | b, j |
  | g | e, f |
  | h | l |

  A ticket may add a category; dropping one needs the user.

### Known limitations (D3, D4)
- One committed registry for the spec holds every record, with these fields: `id` (`<row>-KL<n>`), `clause`, `current`, `desired`, `reason`, `ref`.
- `ref` is a D-id or an issue the delegator opened. A check test fails on `ref: pending`, so the PR cannot land until the delegator supplies the issue.
- The journey asserts the current behaviour and names the record id.
- **Ledger:** there is no feature-ledger change, unless a known limitation proves a `Shipped` row false. That row is then rewritten to `Partial` with `限制：` in the same commit.

### Production code (D12)
Nothing under `src/` changes except temporary RED mutations, which are restored before commit. A clause that can't be observed without a production seam becomes a known limitation and a finding.

### Placement (D10)
- Journeys: `tests/state-safety/<row>-<slug>.journey.test.tsx`, one or more files per row.
- Harness: `tests/helpers/appJourneyHarness.tsx`.
- Registry: `tests/fixtures/state-safety/known-limitations.json`.
- All of these follow rule 10's placement rules.

### Device AC (D18)
- Each row has a card `docs/test/cards/MIG002-<row>.md` in the ADR-0144 format, with steps tagged `cli`, `computer-use` or `human`, each with its proof, a failure condition, and a log line plus effect. The model is `D326-identity-check.md`.
- b's card also holds the scroll-anchor retention steps carried over from MIG-001n.
- One M0 Mac batch runs all eight cards at the SHA after the last sub-PR lands. Each sub-PR lands with a waiver that quotes the user's ruling and names that batch. A batch FAIL reopens the owning row.

### Tickets and edges (D19, D25)
Nine tickets. Row a is split in two (D25, which overrides #686 item 1's "8 sub-PRs" and item 8's "ticket a blocks b…h"):
- **a1** holds the harness, the registry and its check test, a-C2, a-C4 and row a's serializer-throws journey. Category a cases only.
- **a2** holds a-C1, a-C3 and a-C5…C9 and the row a card.

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

Row a's extra category l applies to a2. One M0 Mac batch still covers eight cards, one per row; a1 has no card of its own, and a2's card covers every row a clause.

Each ticket names:
- its clauses;
- its corpus case-ids;
- its negative journeys;
- its token assertions;
- its StrictMode clauses;
- its reused suites;
- its Mac card steps;
- its MIG-005 host sites, from `git grep -n 'getEditor()' src` at its base. The 7bb42efb reference has 13 calls, in `App.tsx`, `TableContextMenu` (×2), `mcpTableAction`, `windowCloseAttempt`, `wysiwygKeymapEntries` (adapter-internal), `editorStore`, `editorImageInsert`, `editorMenuCommands`, `focusActiveEditor`, `milkdownFocusCarry`, `scrollAnchor/capture` and `tableInsertTrigger`.

## Testing Decisions

**What makes a good test here.**
- An App journey asserts only external effects: the write log's bytes and order, the dialog and quit replies, what the user can see (dirty mark, active tab, view mode, text), and the token deltas.
- It never asserts plugin order, internal call counts or Milkdown APIs.
- A clause is proved when its journey passes, its negative journey passes, and a temporary mutation of the guarded path turns at least one of them red.

**Seams** (user: 「yes」):
1. **The App journey**, the main seam: the real `<App />` over the fake Tauri boundary. Every row uses it.
2. **The existing Rust test modules**, for row h only. They are cited, plus new tests for any uncovered sub-obligation.

**What MIG-002a1 tests about the harness itself:**
- a save records exact bytes;
- an unedited open records no write;
- a scripted dialog answer reaches the app;
- a quit reply is captured;
- an unmodelled IPC call throws;
- a journey that leaves a timer, listener or flusher behind fails;
- the real serializer break yields `failed`, and the heal restores it;
- `readTokens` reports a known delta;
- Milkdown mounts under fake timers;
- the known-limitation registry check rejects `ref: pending`.

**RED evidence (D22).**
- Each distinct guarded path gets one temporary-mutation receipt, `MIG002-<row>-<clause>-<n>`, recorded by MIG-001's procedure:
  1. edit a tracked `src/` file on the path;
  2. record the RED;
  3. restore the file;
  4. run green;
  5. put the diff, the failing assertion and the restore in the handoff, with "replay passes at base" under Known qualifications.
- Each clause also has a committed negative journey.
- The existing suites stay where they are, unrewritten, and are cited per clause.

**Budget (D17).**
- Each journey runs under 5 s under coverage, and each file under 60 s.
- All MIG-002 journeys together add under 5 minutes of shard time.
- Each handoff reports its row's times and the running total.
- The new journeys run in the existing `frontend` shards.

**Prior art:**
- `tests/d297-tabless-editor-column.test.tsx`, `control-app-readiness.test.tsx` and `m4-app-menu.test.tsx` (the real `<App />` in jsdom; `menu:action` delivery);
- `tests/helpers/milkdownEditorHarness.tsx` (typing into the real editor);
- `d92-failed-flush-blocks-switch` (real serializer break and heal);
- `d173-other-window-save` (other-window origin);
- `quit-guard-wysiwyg-flush` and the `useQuitGuard*` suites (the quit bus and replies);
- `d42-app-dialog-open-order` and `d110-about-settings-strict-mode` (StrictMode in tests);
- MIG-001a's fake boundary.

## Out of Scope

- **Fixing any unsafe behaviour found.** It is recorded as a known limitation and fixed by a separate D-item.
- **The serialization-failure policy** (whether the writer stays mounted, recoverable snapshots, refused transitions): MIG-005/013 (#689). MIG-002 records today's behaviour as their input.
- **Windows Ctrl/AltGr/IME/window routing:** WIN-001's `WCM` rows (DEC-001).
- **The editor port, adapters, and any production seam:** MIG-005.
- **Enabling `<StrictMode>` in production.**
- **Real WebKit or WKWebView automation:** the Mac cards cover the device side, and MIG-003's advisory lane is separate.
- **Moving or rewriting existing unit suites.**
- **Any new CI job or `ci-gate` change.**
- **Rust-side MCP behaviour beyond citing tests and filling listed gaps.**

## Further Notes

- **Plan text this spec overrides (D23), to fix in plan v1.4:**
  - §15 "MIG-002a…g" becomes a1, a2 and b…h: MCP mirror added (#686), and row a split (D25).
  - §5 MIG-002's Windows Ctrl/AltGr/IME/window-routing item moves to WIN-001's `WCM` rows.
  - §4.2's MCP-mirror "ACK limits" reads: no server ACK exists, and a flush is not one.
  - §4.2's "200 ms editor" is the edit-sync delay; the mirror debounce is 300 ms.
  - §4.2's eleven host sites become the 13-call grep at each ticket's base.
- **Known qualification:** a characterization receipt's replay at base passes by construction.
- **jsdom only:** journeys characterize jsdom, and the Mac cards cover WKWebView.
- **Delegator checks at grant:**
  - the §17 CI budget against the reported journey times;
  - each sub-PR's batch waiver, which is a recorded user ruling;
  - that MIG-001a (#706) has landed the boundary before granting a1; at 7bb42efb it was still staged and uncommitted.
- **Gate sensitivity and ADRs:** none. It adds no dependency, contract, persisted format or surface; there is no new job, and `ci-gate` is unchanged (D24).
- **Status:** not granted. `ready-for-agent` is not a grant (rule 12).
