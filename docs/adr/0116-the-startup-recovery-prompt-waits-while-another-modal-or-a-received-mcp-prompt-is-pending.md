# 0116. The startup Recovery prompt waits while another modal or a received MCP prompt is pending

**Status**: Accepted (2026-10-17). Decided by the user: 「Accept as written (Recommended)」,
asked by mdpro-delegator on r5. Drafted by mdpro-a3 for D241 and D273;
the number was reserved by mdpro-delegator, which set the terms: an MCP
prompt goes first, and the d42 cases that open Recovery second are rewritten
to "held under X". Review history:
- r2 answered the r1 plan reviews (Codex b184, H3 M3 L1; Fable, H1 M3 L3).
- r3 answered the r2 confirms (Codex b185, H2 M1; Fable, M3 L1).
- r4 answers the r3 confirms (Codex b188, H3; Fable, H1 M1 L3) and the
  user's choice of (g2) for the MCP handoff gap, relayed by mdpro-delegator
  on 2026-10-17: 「Narrow promise, g2 (Recommended)」. It makes no Rust or
  wire change, and it splits "admitted once" from "holds the slot now".
- r5 folds in the r4 confirms' wording (Codex b189, M1; Fable, M1 L2):
  the failed-show order, an empty re-list, and the pending-change channel.

Scope of the exception: **startup Recovery before its first admission in a
window, while that window has another modal open or an MCP request it has
received still pending.** For that case it would partially supersede
[ADR-0062](0062-app-level-dialogs-render-in-open-order.md) Decision 1 (open
order) and narrow its Decision 3 (Recovery's token is `null`, not `"open"`,
while held). ADR-0062 Decisions 2, 4 and 5 stand: the Recovery slot stays
mounted and only its dialog DOM is withheld.
[ADR-0108](0108-an-mcp-prompt-waits-while-another-modal-is-open.md) stands: an
MCP request that arrives after Recovery is admitted waits behind it.
[ADR-0056](0056-recovery-stays-a-forced-choice-and-encoding-opens-on-cancel.md)
Decision 1 stands: once admitted, Recovery is a forced choice with no Escape,
no backdrop close and no "Later". Its Consequences foreclosed deferral "until
a flow defines how drafts reappear, which would need a new ADR"; this is that
flow, for a system-side hold only. A user-initiated deferral stays
foreclosed.
[ADR-0042](0042-mcp-write-confirmation-is-an-in-window-queued-prompt.md)'s wire
contract is unchanged.

## Context

- **Recovery arrives late, unasked.** `useStartupDrafts` runs
  `cleanup_old_drafts` then `list_drafts` on every window mount (not only at
  launch) and keeps the returned metadata. Until it returns, the window is
  usable: ⌘, opens Settings, ⌘K Insert Link, an external change raises Reload,
  ⌘W raises Unsaved changes.
- **Under ADR-0062 a late Recovery renders on top** of the dialog the user
  opened (its token is the constant `"open"` when drafts are non-empty). It
  covers that dialog, and since Recovery has no Escape (ADR-0056), Escape no
  longer reaches the dialog underneath. Focus is not taken today: Recovery has
  no initial focus, and the d42 suite expects the dialog underneath to keep it
  (D241).
- **ADR-0108 holds MCP prompts** behind any `[aria-modal="true"]` element, so
  a held Recovery (not in the DOM) does not hold MCP; an MCP request that
  arrives while Settings is open is held by Settings, and shows when it
  closes.
- **The MCP queue is split between Rust and the window.** Rust keeps each
  window's FIFO and emits only its head. When a successfully emitted head
  ends by answer, expiry or withdrawal, its `confirm_resolved` precedes any
  successor's `confirm_request`. A failed show ends without
  `confirm_resolved`; Rust advances to any successor. These are separate
  events, and the reply IPC returns on its own path. Between them the window
  holds nothing while Rust holds B. The window cannot know B exists until B's
  request arrives without a wire change (option g1). The hook has no expiry
  timer: an expired entry leaves only when `publish()` next runs or the
  resolved event arrives, and a failed emit is logged, not retried. A held
  arrival calls `setPrompt(null)` on a null state, which does not
  re-render; nothing outside the hook can see the queue.
- **React layout effects see the commit, not each other's updates.** A child
  layout effect that reports to the parent schedules a parent update; the
  parent's layout effect in the same commit still reads the old state
  (reproduced by Codex on React 19.2.3). An update scheduled from an IPC
  callback renders in a later task, so a Tauri event can run between a
  callback's decision and the commit that shows its result.
- **Recovery's slot outlives its rows.** App drops a row when it is recovered
  or discarded (`App.tsx` `setDrafts`), and the keyed slots in `AppDialogs`
  stay mounted, so a ref in `AppDialogs` does not reset when Recovery closes.
- **The deadlines differ.** An MCP prompt expires 60 s after arrival (408,
  nothing written; ADR-0042). A draft has no deadline while the app runs.
- **Drafts are keyed by document, and listed as metadata.** A file-backed
  draft's id derives from its path. Another window that opens the same path
  autosaves over that bundle (`save_draft_as` replaces it) or deletes it on a
  successful save, and ADR-0038 hides a draft in use by a live window. So a
  held list can go stale, and an old crash draft can be replaced while it
  waits. This exists today in the seconds before `list_drafts` returns; a
  hold widens it.
- `RecoveryDialog` has no initial focus and no Tab trap, against ADR-0056
  (D273); its rows disappear as they are recovered or discarded.

## Options considered

- **(a) Hold Recovery behind modals and received MCP requests, with one
  admission check.** Chosen (decisions below).
- **(b) Hold, but Recovery goes before a waiting MCP prompt.** Lost: Recovery
  is a multi-row choice that can outlast an MCP prompt's 60 s. ADR-0108 already
  lets an admitted Recovery hold MCP prompts; letting a not-yet-shown one do it
  too adds timeouts for nothing.
- **(c) Close or replace the open dialog; (d) show Recovery and make the rest
  inert; (e) leave it.** Lost for ADR-0108's reasons (lost edits; recorders
  and delayed refocus reach past inert; the covering stays).
- **MCP handoff gap**:
  - **(g2) The promise covers requests the window has received.** Chosen by
    the user (2026-10-17, 「Narrow promise, g2 (Recommended)」). A request
    still queued in Rust when Recovery is admitted waits behind it and can
    time out (408, nothing written). No Rust or wire change.
  - **(g1) Every head-ending signal names the successor** (`next` on the
    reply result and on `confirm_resolved`, with a deadline bound). Rejected
    by the user's choice above. It needed a wire change on both sides and the
    contract fixture, and the r3 reviews found it still incomplete: a local
    expiry could run ahead of the successor signal; a reply and an event
    could carry snapshots in either order, so a per-window sequence and the
    successor's identity would be needed; and a relative budget does not
    reproduce Rust's exact deadline.
- **Protecting held drafts**:
  - **(h1) Re-list before admission and record the risk.** Chosen: the
    final check runs on a fresh `list_drafts`, so in-use drafts are filtered
    (ADR-0038) and replaced bundles show their current content and time. An
    old crash draft replaced by another window's autosave of the same path is
    still replaced.
  - **(h2) Keep the old version when a held, unanswered bundle is
    overwritten** (a sibling copy, dropped when answered). Lost: a new storage
    rule with its own cleanup, beyond D241; it also covers a risk that exists
    without the hold.
  - **(h3) Refuse writes to a held bundle.** Lost: the other window's autosave
    would fail, which risks newer work to protect older.

## Decision

1. **One admission check per window, on synchronous inputs.** Recovery may be
   admitted when its drafts are non-empty, no `[aria-modal="true"]` element
   other than Recovery is in the document, and the window's MCP-pending flag
   is false. The flag is read from a ref that `useMcpConfirm` writes inside
   its event handlers and timers, before any React update (AppDialogs owns
   the ref and passes it down), never from state reported by a child effect.
   A change is reported through its own channel: whenever the ref flips,
   the hook calls an `onMcpPendingChange` callback from AppDialogs, which
   bumps a counter in AppDialogs' state. That re-renders even when the
   prompt state does not change (a held arrival's `setPrompt(null)` on a
   null prompt re-renders nothing), and the bump only schedules a re-check;
   the check still reads the ref. The check runs in an
   `AppDialogs` layout effect, so it sees a modal opening in the same commit,
   when the drafts, the flag or the observed `aria-modal` set change, and once
   when the observer is installed. Held, it logs `ui.recovery.held` once
   (`{ reason: "modal" | "mcp", count }`).
2. **MCP-pending means "a request this window has received is still live",
   and every such request has a deadline the window keeps** (g2).
   - The ref is true exactly while the hook's queue is non-empty. It does not
     track answers in flight or requests Rust has not sent.
   - An entry leaves the queue when it is answered (before the reply IPC, as
     today), when its `confirm_resolved` arrives, or when a new deadline
     timer fires at its deadline (arrival time plus `expiresInMs`; it never
     replies, and Rust's 408 stands).
   - A reply that never settles holds nothing, because the answered entry has
     already left. A late `confirm_resolved` for an entry that has already
     left is ignored, so it cannot bring the entry back.
   - So the flag cannot stay true past the latest deadline among the requests
     received, whatever events are lost.
3. **The re-list finishes before the final check.** When the check passes,
   Recovery calls `list_drafts` (h1) and stays held. Each re-list carries a
   sequence number and a cancelled flag set by its effect's cleanup, as
   `useStartupDrafts`' `mounted` guard does today, so a superseded or
   unmounted re-list sets nothing. When the latest re-list returns, the same
   callback re-reads the document's `aria-modal` set and the MCP-pending ref.
   If either now holds, Recovery stays held with the fresh list and waits
   for the next change. If the list comes back empty while the startup
   drafts are not, the empty result replaces `drafts`: there is nothing left
   to offer, Recovery is not admitted, and no later `aria-modal` or flag
   change starts another re-list.
4. **Admission sets two refs: "admitted" and "holds the slot".**
   - Both are set synchronously in that callback, before React renders, and
     Recovery takes its open-order token there. A dialog the user opens
     before Recovery's commit renders above it (ADR-0062 open order). The
     callback logs `ui.recovery.released`.
   - **Admitted** never clears for the window's life. It stops a StrictMode
     double render or a later modal from holding Recovery again.
   - **Holds the slot** is what `useMcpConfirm`'s publish check reads beside
     `isModalOpen()`. It stops an MCP request from mounting in the gap before
     Recovery's commit; once Recovery is in the DOM, ADR-0108's `aria-modal`
     hold covers the same ground.
   - **Holds the slot clears** when the admitted dialog has no rows left (the
     final row recovered or discarded, or the list emptied any other way) and
     when the window unmounts. AppDialogs then asks the hook to publish again,
     in the same layout effect, so a queued or newly arriving MCP request
     shows at once rather than at its 408.
5. **Focus (D273) starts at the first display with rows.**
   - The first commit that renders the admitted dialog with at least one row
     captures `document.activeElement` as the return target. Then it gives
     the first row's Recover visible initial focus (`useVisibleInitialFocus`,
     rule 33), enabled on that commit, not at admission, so it never runs on
     an empty ref.
   - Tab and Shift+Tab loop in the card (rule 32).
   - When a focused row is removed and rows remain, focus moves to the next
     row's Recover, or the previous one after the last row, never to
     `<body>`.
   - When the last row goes, the dialog closes and focus returns to the
     captured target if it is still in the document, else to the active
     editor.
   - A modal opened over Recovery returns focus to Recovery's control when it
     closes. No Escape, no backdrop close.
6. **Tests** cover:
   - drafts and an MCP request landing in the same `act()`, MCP first;
   - a modal opening in the same commit as the drafts;
   - while the re-list is out: a modal arriving (held), an MCP request
     arriving (held), and the window unmounting (nothing set);
   - an MCP request arriving after admission and before Recovery's commit
     (waits);
   - the final row recovered, and the final row discarded, each followed by
     a fresh MCP request (shown at once), and by an MCP request already
     queued behind Recovery (shown on close);
   - the deadline timer dropping a received head; a lost `confirm_resolved`;
     a reply that never settles; a late `confirm_resolved` after the entry
     left;
   - the g2 cost: B emitted after A's answer and admitted behind Recovery
     (waits; ends by its own deadline);
   - a second window recovering a held draft;
   - each focus case above, including Recovery's first populated commit
     coming after a modal opened in the admission gap and closed again.

   The d42 pairs where Recovery opens second become "held under X", and the
   d42 harness models Recovery's hold and the production MCP handoff order.
   `dialogOpenOrder.ts` and its oracle are unchanged.

## Consequences

- **D241 stays in the frontend**: `useMcpConfirm`, `McpWriteConfirm`,
  `AppDialogs`, `RecoveryDialog`, the re-list beside `useStartupDrafts`, and
  their tests. No Rust, no IPC or event shape, no contract fixture and no
  CLAUDE.md events row changes.
- **The wait is unbounded.** Recovery shows only when this window has no other
  modal and no received MCP request pending. A user who keeps Settings open,
  or a client that keeps sending writes, keeps it held for as long as that
  lasts. Each MCP prompt still ends by answer or by its 60 s deadline, so the
  window is never stuck, but Recovery has no deadline of its own.
- **A request still queued in Rust can wait behind Recovery and time out**
  (g2's cost). Rust shows B only after A ends, so if Recovery is admitted in
  that gap, B waits behind it (ADR-0108). If the user takes longer than B's
  60 s, B ends unseen: nothing is written and the client gets 408. The same
  holds when the window's deadline timer drops A a moment before Rust expires
  it (the two clocks are separate): admission can come one event early,
  bounded the same way.
- **No notice and no manual way in.** Nothing says drafts are waiting, and
  there is no menu item to open Recovery. Another window shows the same drafts
  at once (ADR-0038 permitting), and closing the window leaves them on disk
  for the next window's mount.
- **A held crash draft can still be replaced** by another window that opens
  the same file and autosaves or saves (h1's cost). The re-list shows what is
  there at admission, not what was there at launch.
- **The hook's API grows**: a pending ref and its `onMcpPendingChange`
  callback, a deadline timer, a "holds the slot" ref it honours and a
  re-publish call. A new App-level prompt with a
  deadline needs the same pending wiring; one without would wait like
  Recovery.
- **One extra `list_drafts` per admission**, and a re-list that loses its race
  costs another at the next chance.
- **The hold depends on `aria-modal="true"`**, as ADR-0108's does; the D240
  contract test is the guard.
- **Focus moves at the first display**, possibly seconds after the user's
  last action, to Recover. That is ADR-0056's forced choice at a later moment.
- **Device check**: the hold behind Settings and an MCP prompt, the release
  order, an MCP request after Recovery closes, and the Tab loop and focus
  after each Recover / Discard, in both themes (rule 33; D235 recorded Tab
  escaping Recovery on Mac).
