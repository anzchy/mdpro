# 0025. App quit is deferred through a native terminate hook

## Status

**Accepted** (2026-09-23; proposed 2026-09-22). Closes **D16** on
`docs/plans/20260912-frontend-backend-sequencing-order.md` once implemented.
Evidence: spike on 2026-09-22 (throwaway worktree, `[SPIKE-d16]`-tagged
prototype, 4 instrumented real-device runs; report kept outside the repo).

## Context

On macOS, ⌘Q, the menu's Quit, a Dock quit and AppleScript `quit` all go to
AppKit `-[NSApplication terminate:]`. tao's app delegate
(`TaoAppDelegateParent`, tao 0.34.5) does not implement
`applicationShouldTerminate:`, so AppKit goes straight to
`applicationWillTerminate:`, then tao `AppState::exit()`, then Tauri
`RunEvent::Exit`. As the spike measured:

- **No unsaved-changes guard runs.** `RunEvent::ExitRequested` never fires on
  this path, and neither does any window's `onCloseRequested` (the only place
  that runs the D15 all-documents check, `App.tsx` via
  `hasUnsavedChangesAfterFlush`). Dirty documents are silently discarded. This
  is D16.
- **Cleanup never runs.** The `app.quit` log, the MCP server shutdown and
  `cleanup_server_config` sit under `ExitRequested` (`main.rs:542-564`). They
  are skipped, so a stale `server.port` / `server.token` survives every quit.
  The spike confirmed this.
- **Nothing above tao can say "not yet".** Neither Tauri nor tao exposes
  `NSTerminateLater`. The alternatives were: fork tao, tauri-runtime-wry and
  tauri (three pinned forks); cancel the terminate and later call `app.exit()`
  ourselves; or add the missing method to tao's delegate class at runtime.
- **Codex's concern about a stalled run loop did not hold.** Under
  `NSTerminateLater`, AppKit spins `NSModalPanelRunLoopMode`. In that mode Tauri
  events arrived in 0–3 ms and `invoke` round-tripped in 2 ms. `setTimeout`
  fired on time, rAF ran at 62 fps, the React ConfirmDialog painted in 21 ms,
  and clicks reached it in 3–4 ms.
- **The real hazard is visibility.** When the app is hidden or its window is
  covered, WebKit stops rAF and painting. The dialog mounts but is never drawn,
  so the user cannot answer. Unhiding and activating the app, and showing its
  windows, from Rust fixed this (drawn in ≤300 ms).

## Decision

1. **Native hook.** A macOS-only `src-tauri/src/services/quit_guard.rs` uses
   `class_addMethod` at `setup()` to add `applicationShouldTerminate:` to the
   running delegate's class. It logs the class name and the result. If the add
   fails, for example because a future tao already defines the method, it logs
   an error rather than silently falling back to an unguarded quit.
   `objc2` / `objc2-foundation` become direct dependencies; they are already in
   `Cargo.lock` transitively, so no new crates are added.
2. **Coordinator, in two phases.** The decision logic is a pure Rust state
   machine: it takes no app handle and no clock, and time is passed in.
   - With no window open, return `NSTerminateNow`.
   - **Phase 1: check.** Emit `app:quit-requested { requestId }` to every
     window and return `NSTerminateLater`. Each window flushes its WYSIWYG edits,
     runs the existing all-documents check, and answers
     `quit_guard_reply { requestId, answer: "clean" | "dirty" }`.
   - **Phase 2: prompt.** When every window has answered, Rust takes the dirty
     windows in snapshot order, one at a time. For each one it unhides and
     activates the app, then shows, unminimises and focuses **that window
     only**, then sends `app:quit-prompt { requestId }` to that window alone.
     The window shows the existing unsaved-changes dialog and answers `discard`
     (with `documentIds` of its dirty documents) or `cancel`. Clean windows
     never force the app to the front. Ordering and activation are enforced in
     Rust, not left to the frontend.
   - **Window identity comes from the caller.** `quit_guard_reply` takes the
     window label from the invoking `WebviewWindow`, never from the payload
     (rule 60, IPC trust boundary). `answer` is a strict enum; `documentIds` is
     accepted only with `discard`, is length-capped, and every id goes through
     the draft service's id validation.
   - Rust replies `replyToApplicationShouldTerminate:YES` only when every window
     has ended in `clean` or `discard`. On the first `cancel` it replies NO and
     emits `app:quit-cancelled { requestId }` to every window so that open
     dialogs close.
   - Answers with a stale `requestId`, from a label outside the snapshot, or
     out of phase, are ignored. The spike hit the stale-id race. A second
     `terminate:` while a request is pending gets `NSTerminateCancel` and leaves
     the pending request intact.
   - A window destroyed while a request is pending counts as clean from then
     on, wherever it is in the protocol, and is never prompted afterwards. A
     discard it had already answered stands. Only `Destroyed` is routed; a
     close request is not, because the user may still choose "Keep editing".
3. **Timeouts.** A window that has not acknowledged within about 2 s
   (constant named in code) counts as `cancel`: a hung webview blocks the quit
   rather than losing its content. Once a window has acknowledged and shown a
   dialog, there is no timeout.
4. **Discard means discard, but only once the quit commits.** A `discard`
   answer carries the ids of that window's dirty documents. Rust deletes those
   drafts only when the whole quit commits, just before replying YES. A discard
   in window A followed by a cancel in window B deletes nothing. From the moment
   of commit, `save_draft` refuses to write, so an auto-save tick cannot recreate
   a draft between the deletion and process exit. A draft left behind after an
   explicit discard would resurrect content the user threw away. (Window-close
   Discard does not delete drafts today; bringing it in line is a follow-up, not
   part of this decision.)
5. **Cleanup moves to `RunEvent::Exit`.** The `app.quit` log, the MCP shutdown
   and `cleanup_server_config` run there, so they run on every exit path,
   including the ones that never raise `ExitRequested`.
6. **One guard for every way out.** The updater relaunch (`prepareForRelaunch`,
   `useUpdater.ts`) and the window close path reuse the same per-window decision
   function. `prepareForRelaunch` today reads `isModified` without flushing
   WYSIWYG edits and sees only its own window.

## Consequences

- **Gives:** ⌘Q, menu Quit, Dock quit, AppleScript quit and system logout all
  prompt when any window holds unsaved changes. MCP config files are removed on
  every exit. The decision logic is two pure functions, one in Rust (combine the
  windows' answers) and one in TypeScript (one window's answer), and both are
  unit-testable.
- **Costs:**
  - It depends on a **private tao class** and `unsafe` Objective-C. A tao
    upgrade can break it silently in behaviour, though not at compile time. The
    install log line and a quit acceptance check on every tao bump are the only
    guards.
  - Quit becomes **asynchronous**. A webview that never answers makes the app
    refuse to quit, where today it quits and loses data. A user must then force
    quit.
  - Choosing "Keep editing" also **aborts a system logout, restart or
    shutdown**. This is the standard macOS behaviour for document apps, but it
    is now ours to own.
  - Quitting with a dirty document from the Dock or a script **brings mdpro to
    the front**.
- **Forecloses:** a quit that always succeeds. Any future "quit without
  asking" affordance has to go through this coordinator.
- **Not covered by the spike:**
  - more than one window;
  - system logout and shutdown deadlines;
  - minimised windows on their own;
  - a physical ⌘Q key and physical clicks (the spike used posted NSEvents);
  - the red close button and ⌘W, which already have their own guard.

  These are acceptance items for the implementing work, not assumptions.
