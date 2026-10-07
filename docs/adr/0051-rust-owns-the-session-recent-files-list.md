# 0051. Rust owns the session Recent Files list

**Status**: Accepted (2026-10-07, user decision while fixing D43).

## Context

D43 (row in
[`docs/plans/20260912-frontend-backend-sequencing-order.md`](../plans/20260912-frontend-backend-sequencing-order.md#d43);
device evidence in `docs/test/20261002-dtrack-device-retest.md` §2): with a
corrupt `config.json`, opening a second window replaced the app-wide
**Open Recent** menu with that window's own list, and focusing the older
window did not bring its list back.

The forces as understood at the time:

- macOS has **one** native menu for the whole app, but every window ran its
  own `useRecentFiles` state and pushed its whole list through
  `set_recent_files_menu` whenever that list or the view mode changed. The
  last window to push won. With a healthy config every window starts from
  the same stored list, so this was invisible. When the config cannot be
  read, each window starts empty and the windows disagree.
- Re-pushing on window focus would only change which window wins. It would
  still drop the files opened in the other windows.
- The disk is not a usable shared source in exactly the failing case: the
  config is the thing that is corrupt.
- The frontend logger fails closed when the config is corrupt, so the
  `preferences.recent_files.buffer` warn the device run expected could never
  be written. Only the Rust logger, which caches its settings at startup,
  can report this case.

## Decision

1. The Rust `MenuState` holds the **session list**. Windows send operations,
   not lists: `seed` (the stored list, or `null` when it could not be read,
   plus the files opened before hydration), `record` (one opened path) and
   `refresh` (view mode changed). The command is `sync_recent_files_menu`,
   and it replaces `set_recent_files_menu`.
2. Rust applies the operation, rebuilds the menu, and returns the merged
   list. Windows display that reply and save it. A reply that a newer
   request has overtaken is not displayed.
3. `seed` keeps the session entries first and appends the stored entries
   that are missing. One window's hydration therefore never removes what
   another window opened.
4. Rust remembers the last view mode. Only `refresh` carries it, so `seed`
   and `record` cannot reset it.
5. Operations are validated in Rust. A `seed` drops paths over the size
   limit and keeps at most the first 64 entries. A `record` with an
   oversized path is rejected; the window then keeps and saves its own
   local list, as it does for any failed call. A failed menu install keeps
   the old list.
6. Rust logs `menu.recent_files.sync` with the operation and count, never
   the paths. A `seed` with `stored: null` logs a warn with
   `outcome: "hydration_failed"`, which is the signal a device run can see.

## Consequences

- One Open Recent list for the session, whichever window is focused.
- An IPC contract change. The old command is removed, not kept beside the
  new one; anything still calling `set_recent_files_menu` breaks loudly.
- The list now lives in two places, Rust memory and each window's display.
  A window shows the session list only as of its last reply. It does not
  update when another window opens a file; the menu does.
- Disk writes still come from the windows. Two windows that save at nearly
  the same moment can land out of order, so the stored list can lag the
  session list by one entry until the next open. This is the residual that
  feature-ledger row 71 now names.
- The View menu's mode checkmark is still last-writer-wins: each window
  sends `refresh` with its own mode. This is unchanged by this decision.
- The session list is lost on quit if the config stays unwritable. That is
  unchanged from before.
- Adds a second mutex to `MenuState` (the sync lock), held across the
  rebuild, kept separate from the data lock that the menu click handler
  reads, so that a click during a rebuild cannot deadlock.
