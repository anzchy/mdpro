# 0027. A quit ack timeout draws a native alert instead of cancelling the quit

## Status

**Accepted** (2026-09-23). Supersedes **§3 (Timeouts)** of
[ADR-0025](./0025-app-quit-is-deferred-through-a-native-terminate-hook.md).
The rest of ADR-0025 — the native hook, the two-phase coordinator, the trust
boundary, discard-on-commit, and the move of cleanup to `RunEvent::Exit` —
stands unchanged. Decided with a Codex deliberation on the trade-off; the user
chose to route the question there rather than take the plan's default.

## Context

ADR-0025 §3 says a window that has not acknowledged phase 1 within about 2 s
counts as `cancel`. The stated reason was that a hung webview should block the
quit rather than lose its content. Implementation had not started on the
coordinator, so the constant had not yet been written into code.

Reviewing that clause against what this app is already measured to do changed
the picture:

- **The 2 s deadline is far below this app's known stalls.** D6 and D12
  measured main-thread blocks inside the webview of **7.4 s, 12.0 s and 259 s**
  on real documents. Phase 1 needs the webview to run JS to answer, so a ⌘Q
  during any of those times out.
- **The failure is silent.** At timeout the coordinator records `cancel` and
  replies NO. No dialog is drawn, because the webview is the thing that is
  stuck. The user presses ⌘Q and nothing happens, with no explanation.
- **macOS will not rescue it.** `NSTerminateLater` spins the run loop in
  `NSModalPanelRunLoopMode` until the app replies; Apple documents no general
  deadline or automatic Force Quit prompt for an ordinary Quit. The documented
  two-minute deadline covers logout, restart and shutdown only. Crucially,
  WKWebView's WebContent process is **separate from the native UI process**, so
  a stuck editor does not make mdpro unresponsive to the window server — macOS
  has no reason to mark it "not responding". The user is left to discover
  ⌥⌘⎋ on their own.
- **So for that user the guard is worse than the bug it fixes.** D16 loses
  unsaved work silently. This would lose it via Force Quit *and* take away the
  ability to quit.

Three alternatives were weighed against drawing a native alert:

- **Keep §3 as written.** Only benefit is matching an already-accepted record.
  That is not an engineering benefit when the record is wrong, and superseding
  is the documented way to change it.
- **Raise the constant.** 259 s is not a usable timeout. Any value is a guess
  trading responsiveness against reachability, and it does not remove the
  silent-refusal failure — it only makes it rarer and slower.
- **A second ⌘Q force-quits.** Restores quittability, but **repeated ⌘Q is not
  informed consent to discard unsaved work**. It is a deliberately reachable
  silent-data-loss path, and it still explains nothing.

A fifth option — answer phase 1 from Rust without the webview, by reading the
MCP shadow store's `is_dirty` — was examined and rejected. `useMcpSync` debounces
content at 300 ms and is best-effort, so a Rust-side "clean" can mean "the edit
has not arrived yet". That is the same class of race as D15/D19. Reading the
snapshot is possible; treating it as proof of cleanliness is not.

## Decision

1. **A phase-1 ack timeout hands the decision to a native alert, not to
   `cancel`.** The ~2 s constant stays, but it is now the threshold for
   *explaining the delay*, not for silently refusing the quit.
2. **The alert is drawn by Rust on the main thread**, as an app-modal `NSAlert`,
   so it does not depend on a painting webview. It names no documents and offers
   no save — it is one application-wide decision:
   - **Keep Open** — default button, and the Escape action. Replies
     `replyToApplicationShouldTerminate:NO`.
   - **Quit Without Saving** — replies YES. Its text must state that unsaved
     changes in all windows will be discarded, because at timeout the
     coordinator cannot know which windows are dirty.
3. **Replying NO ends the request.** The pending request is cleared, and a later
   ⌘Q starts a fresh one. ADR-0025 §2's "a second `terminate:` gets
   `NSTerminateCancel` and leaves the pending request intact" applies only while
   a request is genuinely in flight; treating a resolved request as still
   pending would be a coordinator bug, not this policy.
4. **The fallback takes exclusive ownership of the request.** Once the alert
   owns the decision, a late phase-1 reply for that request id is ignored and
   cannot advance the coordinator, open a prompt, or resolve AppKit a second
   time. AppKit is resolved exactly once per request. Coordinator locks are
   released before the native alert is presented, so a reply arriving mid-alert
   cannot deadlock.
5. **`Quit Without Saving` is a commit.** It follows the ADR-0025 §4 commit
   path: `save_draft` refuses to write from that moment. It deletes no drafts,
   because no window answered `discard` with document ids — drafts are the only
   remaining copy of the discarded work and must survive for recovery.

## Consequences

- **Gives:** the app is always quittable, and a quit that cannot be answered
  now explains itself instead of doing nothing. The guard keeps its point — no
  unsaved work is discarded without the user being told, in words, that it will
  be. It removes the dependency on a webview that can paint, which was the
  hazard ADR-0025's own Context identified as the real one.
- **Costs:**
  - **A second dialog implementation**, in Objective-C rather than React, that
    does not follow the design system in rules 30–34 and cannot. It will look
    like a system alert, because it is one.
  - **A reachable data-loss path.** "Quit Without Saving" discards unsaved
    changes in every window, including windows that answered `dirty` and never
    got their own prompt. Drafts are what makes this recoverable, which is why
    §5 forbids deleting them here.
  - **The alert can fire on a healthy app** if a window is merely slow rather
    than wedged — a user on a large document may meet a "not responding" alert
    for a stall they would not otherwise have noticed.
  - **It holds a logout open** until answered, up to the OS's two-minute
    deadline. Choosing Keep Open aborts the logout, as ADR-0025 already accepted
    for the ordinary path.
  - **More `unsafe` Objective-C** on top of ADR-0025's, and a modal presented
    from inside `applicationShouldTerminate:` — re-entrancy that has to be got
    right.
- **Forecloses:** treating a phase-1 timeout as a quiet policy decision. Any
  future timeout behaviour has to say something to the user.
- **Not settled here:** whether a genuinely backend-authoritative dirty
  protocol should replace phase 1 altogether. That would need Rust to
  acknowledge an "editing may occur" state before the frontend permits
  mutations, and clear it only after a versioned checkpoint — a much larger
  change than this one, and not required to close D16.
- **Verification owed.** Unit tests cannot cover this: the decisive case is
  *stall the WebContent process, ⌘Q, let the editor recover while the alert is
  open, choose Keep Open, then quit again*. It must be run against the packaged
  `.app`, because `NSTerminateLater`'s modal run-loop behaviour is part of what
  is being verified.
