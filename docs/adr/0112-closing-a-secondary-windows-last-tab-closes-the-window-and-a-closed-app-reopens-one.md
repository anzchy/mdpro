# 0112. Closing a secondary window's last tab closes the window, and an app with no window reopens one

**Status**: Proposed (2026-10-16). Number reserved by mdpro-delegator for
[D253](../plans/20260912-frontend-backend-sequencing-order.md#d253). Drafted
by mdpro-a3. The user decided the direction and its edges on 2026-10-16,
through the delegator:

- direction: 「Close the secondary window (Recommended)」;
- when only secondary windows remain, the last one closes too: 「Close it (Recommended)」;
- ⌘W on an already-empty secondary window: 「Close the window (Recommended)」;
- on Windows, closing the last window quits: 「Yes, quit on Windows (Recommended)」;
- window recovery is part of this decision: 「(a) D253 adds window recovery (Recommended)」.

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
- With no window open, nothing brings one back on macOS (checked on
  `7cf7e6dd`). The run loop handles `RunEvent::Opened`, focus and `Exit`, but
  not `RunEvent::Reopen`, so a Dock click does nothing. Every menu item,
  ⌘N and New Window included, is `app.emit("menu:action")` to the webviews,
  and with no webview it lands nowhere. Only Finder "Open With" creates a
  window. This already strands the app today when the main window is closed
  by its red button, and closing the last secondary window would make it
  common.
- Emitting to a window right after it is built races its listener:
  `create_window` emits `file:open` immediately after the build. The launch
  path avoids the race by letting the frontend pull (`launch_state`).

## Options considered

1. **Close a secondary window when its last tab closes; the main window keeps
   its empty state** (chosen by the user).
2. **Close any window when its last tab closes, the main window included.**
   Lost: on macOS the start surface would vanish with the last document, and
   on Windows closing the last tab would quit the app, which the user did not
   ask for.
3. **Keep today's behaviour.** Lost: the reported defect, and empty windows
   keep accumulating.
4. **Close only windows that were created for an external open.** Lost: it
   needs a window-origin flag that survives reloads, and a ⌘⇧N window would
   behave differently from a Finder-opened one, which is harder to explain
   than one rule keyed on the label.

For delivering a menu action to a window that recovery has just built:

- **A. Emit right after the build** (as `create_window` does for `file:open`).
  Lost: the webview has not registered its `menu:action` listener yet, so the
  action can be dropped.
- **B. A one-slot pending action that the new window takes once on mount**
  (chosen). Same shape as the launch path's pull. Cost: one new IPC command.
- **C. A timer before the emit.** Lost: any delay is a guess, too short on a
  slow machine and visible on a fast one.

## Decision

- After a **user close of a tab** (⌘W, File → Close, the tab ×) leaves a
  window with **no documents**, and the window's label is not `"main"`, mdpro
  requests that window's close through `useWindowCloseGuard`. It never calls
  `close()` directly. With nothing open the guard saves state and closes
  without a prompt; with a dirty document (a race) it prompts as for any
  close.
- The main window keeps today's empty state.
- A window that becomes empty any other way (a quit in progress, an
  MCP-driven change) is left to its own path.
- ⌘W on a secondary window that is already empty closes it.
- If only secondary windows remain, the last one closes like any other. On
  macOS the app keeps running with no window. On Windows, closing the last
  window quits through the existing quit guard.
- **Window recovery**: when no webview window exists, a Dock click
  (`RunEvent::Reopen` with no visible window), File → New, File → New
  Window, File → Open and Settings create one window and act in it. The
  logic lives in `src-tauri/src/services/window_recovery.rs` (public
  `ensure_window`, so later work can reuse it), wired from `main.rs`;
  `menu.rs` is not edited. New and New Window deliver nothing more: the
  recovered window, with its untitled document, is the result. Open and
  Settings leave a one-slot pending action that the new window takes once on
  mount (`take_recovered_window_action`) and dispatches through the normal
  `menu:action` handler.

## Consequences

- Gains: no build-up of empty windows; matches the macOS document-window
  convention; one rule keyed on the window label; the app can no longer be
  stranded with no window on macOS.
- Costs: a secondary window's position and size are not kept for the next
  file once it closes (only `"main"` writes window state). The main window
  and a secondary window behave differently on the same keystroke, by
  design, and the ledger has to say so. Recovery adds one IPC command and a
  branch in the menu-event closure that every menu click passes through.
- Forecloses: an empty secondary window as a deliberate workspace; reopening
  one needs ⌘⇧N.
- With only secondary windows left, closing the last tab leaves macOS with no
  window and quits on Windows. Both are accepted (the user's answers above).
  On macOS this relies on recovery: a Dock click, ⌘N, ⌘⇧N, ⌘O or ⌘, must each
  bring a window back, and the device check covers each.
