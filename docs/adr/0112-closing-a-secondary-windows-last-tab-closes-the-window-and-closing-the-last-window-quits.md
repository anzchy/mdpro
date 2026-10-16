# 0112. Closing a secondary window's last tab closes the window, and closing the last window quits

**Status**: Proposed (2026-10-16, revision 3). Number reserved by
mdpro-delegator for
[D253](../plans/20260912-frontend-backend-sequencing-order.md#d253). Drafted
by mdpro-a3. The user's answers, relayed by mdpro-delegator on 2026-10-16. All
six are recorded with their sources in
`~/.mdpro-redesign/handoff/mdpro-delegator-20261016-1856.md` § D253 user
answers (complete record, 2026-10-16); the first is also the D253 row as
registered, and the last was asked by the delegator through AskUserQuestion:

- direction: 「Close the secondary window (Recommended)」;
- when only secondary windows remain, the last one closes too: 「Close it (Recommended)」;
- ⌘W on an already-empty secondary window: 「Close the window (Recommended)」;
- on Windows, closing the last window quits: 「Yes, quit on Windows (Recommended)」;
- after revision 1's review: 「Quit, every platform (Recommended)」. This
  **supersedes** the earlier 「(a) D253 adds window recovery (Recommended)」,
  which was given on a false premise (see Context).

## Context

- ⌘W on the only tab of a secondary window leaves an empty window. Every
  user close path (⌘W and File → Close through `handleCloseRequest` →
  `closeActiveDocument`; the tab × through `closeDocumentById`) ends in
  `documentStore.closeDocument`, and nothing looks at what is left.
- An external open of a file that is not already open creates a new window
  (`open_file_in_new_window`, `services/open_route/tauri_glue.rs`), so empty windows pile up over a day
  of opening files from Finder.
- On macOS, closing a window's last document closes the window. mdpro's main
  window (label `"main"`, the only one that writes the global window state)
  is also the app's home: its empty state is the start surface.
- An OS close of a window already has one guarded path, `useWindowCloseGuard`:
  flush, then `windowCloseDecisionAfterFlush` (ADR-0025), then a prompt or
  save state and close. A close that bypasses it would skip the flush, the
  window-state save and the latch.
- **What happens when the last window closes.** Revision 1 said that on macOS
  the app would keep running with no window and nothing could bring one back,
  and proposed window recovery for it. That was a reading of `main.rs`, not a
  run, and it was wrong. Both reviews of revision 1 (Codex and Fable,
  independently) traced the runtime: when the last window is destroyed,
  tauri-runtime-wry raises `ExitRequested`; `main.rs` does not prevent it, so
  the app exits (tauri-runtime-wry 2.12.1, the version `src-tauri/Cargo.lock`
  pins, `lib.rs` around lines 4255-4270; tao's `should_exit` → `NSApp stop:` →
  process exit). So today, closing the last
  window quits mdpro on every platform, macOS included. On Windows that close
  goes through the per-window close guard and then Tauri's exit, not the app
  quit guard (ADR-0090 § Consequences).
- The guard checks the window is clean, then awaits the window-state save,
  then latches the close and calls `close()` again; the re-entered pass sees
  the latch and lets the close through whatever is unsaved
  (`exitDecisionFor(…, allowLatched = true)` returns "proceed"). A document
  that turns dirty during the save or between the latch and the re-entry (an
  MCP `create_document` routed to this window before Rust dropped its routing,
  a `file:open` into this window) is closed without a prompt and without a
  draft. This already exists for the red close button; this decision adds ⌘W
  as a second trigger. Two close attempts can also overlap (two ⌘W presses,
  or a cancel followed by a continuation that wakes up after its await), and a
  Discard answers for the documents shown when it was asked, not for ones that
  arrive afterwards. A close requested after a tab closes has the same window:
  the document count read before an await can be stale after it.
- Tauri's JS `Window.close()` runs the close-requested handler and destroys
  the window only if the handler did not prevent it; `destroy()` skips the
  handler. The guard already re-enters itself through `close()`.

## Options considered

1. **Close a secondary window when its last tab closes; the main window keeps
   its empty state** (chosen by the user).
2. **Close any window when its last tab closes, the main window included.**
   Lost: the start surface would vanish with the last document, and closing
   the last tab would quit the app, which the user did not ask for.
3. **Keep today's behaviour.** Lost: the reported defect, and empty windows
   keep accumulating.
4. **Close only windows that were created for an external open.** Lost: it
   needs a window-origin flag that survives reloads, and a ⌘⇧N window would
   behave differently from a Finder-opened one, which is harder to explain
   than one rule keyed on the label.

For the last window:

- **A. Quit, on every platform, through Tauri's last-window exit** (chosen:
  「Quit, every platform (Recommended)」). It is today's behaviour, so nothing
  new is built for it.
- **B. Keep running on macOS with no window, and add window recovery** (a Dock
  click, File → New, New Window, Open and Settings each build a window and act
  in it). Lost: it would mean preventing `ExitRequested` and building a
  recovery path (a new service, a menu-event intercept, a take-once IPC
  command to hand the action to the new window), all to change behaviour the
  user had only chosen because revision 1 said the app would otherwise be
  stranded. The macOS document-app convention of staying alive is a nicety,
  not a defect fix, and can be its own decision later.

## Decision

- After a **user close of a tab** (⌘W, File → Close, the tab ×) leaves a
  window with **no documents**, and the window's label is not `"main"`, mdpro
  requests that window's close with `getCurrentWindow().close()`, which runs
  `useWindowCloseGuard`'s handler; it never calls `destroy()`. The count of
  remaining documents is read after the tab close has finished, not before
  its awaits.
- The main window keeps today's empty state.
- A window that becomes empty any other way (a quit in progress, an
  MCP-driven change) is left to its own path.
- ⌘W on a secondary window that is already empty closes it.
- If only secondary windows remain, the last one closes like any other, and
  closing the last window quits the app on every platform through Tauri's
  last-window exit, guarded by that window's close prompt.
- **The close guard decides in the pass that lets the close through.**
  - (a) A latch set by the clean save-and-close path means "allow if still
    clean": after the state save, and again on re-entry, the guard flushes and
    re-reads the unsaved state, and prompts if anything is now dirty. Only a
    latch from an explicit Discard allows the close unconditionally, within
    (c).
  - (b) One close attempt is active at a time, with an attempt generation. A
    newer close request or a cancel invalidates older attempts, and a
    continuation that wakes after an await under a stale generation does
    nothing: no latch, no close, no prompt.
  - (c) A Discard covers exactly the documents the prompt was about, by id and
    content. A document that is new or changed since the prompt was raised
    prompts again.

## Consequences

- Gains: no build-up of empty windows; matches the macOS document-window
  convention for secondary windows; one rule keyed on the window label; a
  document that turns dirty while a window closes is prompted for, not lost,
  for the red button as well as ⌘W.
- Costs: a secondary window's position and size are not kept for the next
  file once it closes (only `"main"` writes window state). The main window
  and a secondary window behave differently on the same keystroke, by
  design, and the ledger has to say so. When the last tab closes first, the
  closing file's geometry is not saved with the window, because the state save
  reads the active document after it has been removed
  (`saveWindowStateOnClose.ts`). The re-decision costs one more flush per clean
  close, and the guard carries an attempt counter and a consent snapshot.
- Forecloses: an empty secondary window as a deliberate workspace; reopening
  one needs ⌘⇧N.
- When the last remaining window is a secondary one, closing its last tab
  quits the app. That follows from options 1 and A together; the user chose
  both.
- macOS keeps quitting when the last window closes (today's behaviour). Staying
  alive with no window, and the recovery it would need, is not built and
  needs its own decision.

## Regression matrix

What the tests and the device check must cover:

| Case | Expected |
|---|---|
| ⌘W on the last clean tab of a secondary window | the window closes once, no prompt |
| ⌘W on the last tab of `"main"` | empty state, no close |
| ⌘W on an empty secondary window | the window closes |
| repeated close (two ⌘W, or a close while one is in flight) | exactly one close; the stale attempt does nothing |
| cancel, then a stale continuation wakes | nothing closes, no new prompt |
| dirty content during the state save, or between the latch and re-entry | prompt, no close |
| Discard, then a new or changed document arrives before the close | prompt again |
| Discard with the same dirty documents | closes |
| the last window closes (any platform) | Tauri's last-window exit; the app quits after that window's own prompt |
