# 0033. An external open of a file that is already open goes to the window that has it

## Status

**Accepted** (2026-09-25), after the implementation (`33cf822`) passed G-D29-1..7 on
the release bundle built at `3b6c157` (`docs/test/20260925-r7-d29-d24-gui-acceptance.md`).
Real focusing, un-minimising, `emit_to` delivery, the `/tmp` and symlink
aliases, and the single-instance broadcast were all confirmed on the device.
This record is now immutable. The same run found that a window opened by this
route's `NewWindow` fallback ignores the file's stored geometry. That predates
this record and is tracked under D24.

**Proposed** (2026-09-24). Closes **D29** on
`docs/plans/20260912-frontend-backend-sequencing-order.md` once implemented.
Settles gap (f) of
[ADR-0028](./0028-reopening-a-dirty-open-file-focuses-it-instead-of-reloading.md),
which is Accepted and left unchanged.

**Corrected in place while Proposed** (2026-09-24), before any code: an
independent review rejected the first draft. What it found and what changed
is recorded under *Correction* at the end.

## Context

ADR-0028 made every open path **inside a window** refuse to replace a dirty
document: the window focuses its tab instead. The D20 real-app acceptance
(`docs/test/20260924-d20-gui-acceptance.md`, G2) showed that opens arriving
from **outside** never reach that guard. Both routes live in
`src-tauri/src/main.rs`:

| Route | Today |
|---|---|
| `RunEvent::Opened` (Finder double-click, "Open With", `open -a`) with the app ready | Always calls `open_file_in_new_window` |
| Single-instance callback (a second process launched with paths) | Calls `open_file_in_new_window` unless `main` is the only window. When it is, it broadcasts `file:open`, and the focused window takes it |

Neither route asks whether some window already has the path open. A new window
has an empty store and loads the file from disk. The same file is then open
twice: a dirty copy in one window and the disk copy in another. Nothing is
lost at that moment. But the copies diverge, and whichever is saved last
silently wins.

These facts shaped the decision. Each one was checked against the code.

- **The MCP shadow store is the only Rust-side record of which window has
  which document, and it is best-effort.**
  - `useMcpSync` pushes each window's documents (`id`, `path`, `is_dirty`).
    It does so immediately on open, close and tab switch, and debounces
    content changes by 300 ms.
  - A failed sync is only logged.
  - The window label starts as `"main"` and is filled in asynchronously
    (`src/hooks/useMcpSync.ts`). A sync that runs before that lands is filed
    under the wrong window.
  - Rust removes a window's entry on `CloseRequested`
    (`src-tauri/src/main.rs`). A close can be **cancelled** by the unsaved
    prompt, so a live dirty window can be missing from the store.
- **Paths are not canonical on the frontend.**
  - `open_file_from_path` returns the path it was given.
  - Single-instance arguments are canonicalized (`src-tauri/src/launch.rs`).
  - Finder `RunEvent::Opened` paths are not.
  - ADR-0028's guard matches the raw `id` and `path`. If an alias path
    (symlink, `/tmp` vs `/private/tmp`) is sent to the right window, the
    guard still finds no match, and the window opens a duplicate tab beside
    the dirty one.
- **The global `listen()` receives events aimed at other windows.** It
  listens on target `Any`. A per-window
  `getCurrentWebviewWindow().listen()` does not. `useQuitGuard.ts` already
  relies on this.
- **A successful emit does not mean the window acted.** `open_file_in_new_window`
  puts the path in the URL precisely because an emit can land before React
  is listening.
- **The existing `file:open` handler is the wrong carrier.** It acts only if
  its own window is focused (`shouldHandleWindowEvent`), and it resets the
  view mode.

## Decision

1. **An external open of a path that some window already has goes to that
   window.** Both routes above check first. On a match, Rust unminimizes,
   shows and focuses the window. It then emits `file:open-in-window` to that
   window alone (`emit_to`), with `{ windowLabel, documentId, path }`.
   - `documentId` and `path` are the **matched document's own values** from
     the store, not the incoming path.
   - The window listens per-webview, and checks the label again defensively.
   - **The window focuses the tab with that `documentId`, dirty or clean,
     and reads and writes nothing.** Focusing is the one outcome that is
     right in every case, including a document Save As moved (the id that
     came from its old path) and an alias path. Reloading a clean copy would
     need ADR-0028's write path, which by its gap (c) opens a second tab for
     the Save As shape.
   - If the tab is gone by the time the event lands (closed in between), the
     window calls `openDocumentFromPath(path)`. The ADR-0028 guard then
     decides as for any open.
2. **Matching canonicalizes both sides.** Rust compares
   `std::fs::canonicalize` of the incoming path with that of each stored
   path. If canonicalization fails (for example the file is gone), it
   compares the raw strings. Only windows that still exist as webview windows
   are considered.
3. **A window is routable only once its listener is live.**
   - The sync payload gains a flag, `routable`. The window sets it only after
     its `file:open-in-window` listener has resolved.
   - The flag is part of `SyncDocumentsPayload`, of the dedupe hash, and of
     the Rust `WindowState`.
   - Flipping it to true forces an immediate sync. A listener that fails to
     subscribe leaves it false and logs why.
   - A window that is not routable is treated as not holding the path, so the
     open falls back to today's behaviour.
   - This avoids an acknowledgement protocol with timeouts.
4. **The registry is made trustworthy enough to route on.**
   - `useMcpSync` resolves its window label synchronously, before its first
     sync.
   - Rust keeps removing a window's entry on `CloseRequested`, as today.
     Keeping it until `Destroyed` was rejected: a clean window's close awaits
     `saveWindowState()` and then closes on a latch with no re-check
     (`src/hooks/useWindowCloseGuard.ts`). An MCP write that landed in that
     gap would be discarded without a prompt.
   - Instead, **a cancelled close re-registers the window.** When the
     unsaved prompt is cancelled, the window forces a sync that bypasses the
     dedupe hash. `sync_documents` recreates the entry.
   - A change to a document's `path` (Save As) syncs immediately, like an
     open or close. Today only the content debounce notices it. Without
     this, the old path would keep routing to that window for up to 300 ms,
     and the new path would not route there.
5. **If several windows hold the path, the dirty copy wins**, then the most
   recently focused window.
6. **Paths are routed one by one.** In a multi-file open, a path that is
   already open goes to its window. Every other path keeps today's
   behaviour.
7. **A lookup failure falls back to today's behaviour.** That covers a
   poisoned lock, no match, a window that is not routable, and a failed
   emit. The fallback can create a duplicate, but it does not drop the
   open. An emit that succeeds is **not** covered: see the hung-webview
   cost below.
8. **Every routing decision is logged** as `file.open.route`, with the
   source, the outcome (`existing-window` / `new-window` / `broadcast`), the
   window label and the match count. No content is logged.

## Consequences

- **Gives:** a Finder double-click or `open -a` on a file that is already open
  no longer creates a second, diverging copy. The user is taken to the copy
  they have.
- **Costs:**
  - **The MCP shadow store becomes load-bearing for data safety.** It was
    built for MCP. If `useMcpSync` is ever gated behind the MCP preference
    (D25 item ② argues the MCP server should be), routing silently falls
    back to new windows. That change must first move routing to its own
    registry. A comment on `useMcpSync` and a test pin the dependency.
  - **An open that is still in flight is invisible.** A window that is still
    reading a file has not synced it, so two quick double-clicks can still
    produce two windows. Closing that needs a registry written before the
    read.
  - **A hung webview swallows the open.** The window is focused, but nothing
    happens in it. Nothing is lost, and there is no timeout fallback.
  - **The `is_dirty` tie-break lags by up to 300 ms.** It only chooses
    between duplicates, and the receiving window re-checks dirtiness itself.
  - **A window with its close prompt open is not routable.** Its entry was
    removed on `CloseRequested`. A Finder open during the prompt creates a
    duplicate window. Nothing is lost, and cancelling the prompt restores
    routing. MCP also regains the window then, which today it only does on
    the next sync.
  - **A Finder open no longer refreshes a clean, stale tab.** ⌘O inside the
    window still does (ADR-0028 decision 3). From Finder, the user is only
    taken to the tab. A change on disk made while mdpro was watching is
    already offered by the file watcher. A change made while it was not
    watching needs ⌘O.
- **Forecloses:** "an external open always means a new window" as the
  multi-window model. It still holds for files that are not already open.
- **Not decided here:** whether a file that is *not* open should go into an
  existing window as a tab. That is a product question, not a data-safety
  one.

## Correction (2026-09-24)

The first draft had four problems. An independent review (Codex, thread
`01a0d1bd…`) found them, and each was confirmed by reading the code:

- It routed the **incoming** path to the window. An alias path would still
  have produced a duplicate tab in that window. The fix is decision 1: send
  the stored path and id.
- It trusted the store to list a live window, but a **cancelled close had
  already removed** it. The fix is decision 4.
- It said event targets could not be relied on. That was **backwards**:
  per-window listeners do filter, and it is the global `listen` that does
  not.
- It treated a successful emit as success, although the listener might not
  be mounted yet. The fix is decision 3.

A second review, on the same thread, found three more. Each is now
addressed:

- The readiness flag needed a sync invariant. That is decision 3's bullets.
- Save As changes only `path`, which the sync did not treat as structural.
  That is decision 4's last bullet.
- Routing the stored path through `openDocumentFromPath` still duplicated a
  clean, Save-As-moved document. Decision 1 now focuses by id instead.

It also found the "never refuses an open" wording too strong, and decision 7
was narrowed.

A third review found that the second draft's move of the store removal to
`Destroyed` opened a silent-discard race. The clean-close latch in
`useWindowCloseGuard.ts` closes without re-checking, so an MCP write during
its `saveWindowState()` await would have been lost. Decision 4 now keeps the
removal on `CloseRequested` and re-registers on cancel.

An acknowledgement round-trip with a timeout was considered for the
listener-readiness point and rejected. It would be a second timeout protocol beside the quit
guard's, and the readiness flag closes the same gap without one.
