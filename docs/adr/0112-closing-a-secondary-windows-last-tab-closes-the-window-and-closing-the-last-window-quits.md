# 0112. Closing a secondary window's last tab closes the window, and closing the last window quits

**Status**: Proposed (2026-10-16, revision 2). Number reserved by
mdpro-delegator for
[D253](../plans/20260912-frontend-backend-sequencing-order.md#d253). Drafted
by mdpro-a3. The user's answers, all relayed by mdpro-delegator on 2026-10-16
and recorded in its handoff `~/.mdpro-redesign/handoff/mdpro-delegator-20261016-1856.md`
§ Standing user decisions:

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
  (`create_window`, `commands/window.rs`), so empty windows pile up over a day
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
  the app exits (tauri-runtime-wry 2.9.3, the pinned version; tao's
  `should_exit` → `NSApp stop:` → process exit). So today, closing the last
  window quits mdpro on every platform, macOS included. On Windows that close
  goes through the per-window close guard and then Tauri's exit, not the app
  quit guard (ADR-0090 § Consequences).
- The guard checks the window is clean, then awaits the window-state save,
  then latches the close. A document that turns dirty during that await (an
  MCP create, a `file:open` delivered into this window) would close without a
  prompt. A close requested after a tab closes has the same window: the
  document count read before an await can be stale after it.

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
  requests that window's close through `useWindowCloseGuard`, never by
  calling `close()` around it. The count of remaining documents is read
  after the tab close has finished, not before its awaits.
- The main window keeps today's empty state.
- A window that becomes empty any other way (a quit in progress, an
  MCP-driven change) is left to its own path.
- ⌘W on a secondary window that is already empty closes it.
- If only secondary windows remain, the last one closes like any other, and
  closing the last window quits the app on every platform through Tauri's
  last-window exit, guarded by that window's close prompt.
- **The close guard re-checks before it commits.** After the window-state
  save it decides again (flush, then the same any-dirty rule) just before it
  latches the close. A window that turned dirty during the save is not closed:
  it prompts as for any dirty close.

## Consequences

- Gains: no build-up of empty windows; matches the macOS document-window
  convention for secondary windows; one rule keyed on the window label; the
  guard no longer has a gap between its check and its close.
- Costs: a secondary window's position and size are not kept for the next
  file once it closes (only `"main"` writes window state). The main window
  and a secondary window behave differently on the same keystroke, by
  design, and the ledger has to say so. The second decision in the guard
  costs one more flush per clean close.
- Forecloses: an empty secondary window as a deliberate workspace; reopening
  one needs ⌘⇧N.
- When the last remaining window is a secondary one, closing its last tab
  quits the app. That follows from options 1 and A together; the user chose
  both.
- macOS keeps quitting when the last window closes (today's behaviour). Staying
  alive with no window, and the recovery it would need, is not built and
  needs its own decision.
