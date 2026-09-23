# 0030. A menu item is the escape hatch for a stuck quit

**Status**: Accepted (2026-09-23). Replaces the withdrawn decision 3 of
[ADR-0029](./0029-quit-deadlines-bound-machine-progress-not-people.md), which
proposed the user's second ⌘Q for this role before a device probe showed that
route does not exist.

## Context

ADR-0029 bounds machine progress but deliberately never bounds human decision
time, so a webview that acknowledges its prompt and *then* freezes leaves
`NSTerminateLater` unresolved forever. That case is undetectable by
construction: silence cannot distinguish a person reading a dialog from a
renderer that died after drawing it. ADR-0029 accepted that and planned to make
it *recoverable* instead — the user presses ⌘Q again, and the second one
escalates to the native alert.

**A device probe on 2026-09-23 showed AppKit never delivers that second ⌘Q.**
With a quit prompt on screen, a second ⌘Q produced no visible change and zero
new bytes in the log. A temporary diagnostic placed as the first statement
inside the `should_terminate` IMP confirmed the IMP is *never entered*: the
first ⌘Q logged `enter` then `later`, the second logged nothing at all. AppKit
suppresses the quit path for the entire duration of a deferred reply.
`Begin::AlreadyPending` is unreachable from the keyboard.

The same run supplied the way out, as a control rather than as its object. To
rule out "the keystroke never arrived", ⌘⇧L was pressed with the prompt still
up, and it fired normally (`ui.menu.select`). **The menu bar stays live for the
whole duration of the deferred reply; only the quit path is suppressed.**

Two constraints follow, and together they determine the design:

1. **It cannot be the existing Quit item.** `menu.rs:126` builds it with
   `PredefinedMenuItem::quit`, which goes through `terminate:` — the very path
   AppKit is suppressing. A predefined Quit item is as dead as the keystroke.
2. **It cannot be routed through the webview.** The failure this exists to
   recover from *is* a frozen renderer. Anything that emits `menu:action` and
   waits for the frontend to act is stuck behind the same freeze.

## Decision

**Add a custom menu item, handled entirely in Rust, that hands a live stuck
quit request directly to the ADR-0027 native alert.**

1. A `MenuItem::with_id` entry — not a `PredefinedMenuItem` — so its activation
   does not travel the suppressed `terminate:` path.
2. Its handler runs **in Rust**, in `menu.rs`'s menu-event handler, calling the
   coordinator's fallback directly. It does not emit `menu:action` and does not
   depend on any webview being alive.
3. It is **inert unless a quit request is live**. With no request outstanding it
   does nothing and logs that it was a no-op; it is not a second general-purpose
   way to quit.
4. It resolves the request through the existing ADR-0027 alert rather than
   quitting directly. The user still gets the "quitting will discard unsaved
   changes" warning and the Keep Open / Quit Without Saving choice — this
   surfaces an existing decision point, it does not add a new one.
5. Its wording must promise only what it can deliver: it reaches the alert, and
   the alert is explicit that unsaved changes in unresponsive windows are lost.
   It must not read as a safe or lossless quit.

## Consequences

**What it costs.**

- **A menu entry every user sees, for a state almost none of them will reach.**
  A permanently visible affordance for a rare failure is UI clutter, and naming
  it well is genuinely hard: precise wording is alarming, reassuring wording
  lies.
- **Discoverability is poor and we should not pretend otherwise.** A trapped
  user's instinct is ⌘Q, then Force Quit — not opening a menu to look for a
  recovery item. This makes the hole *recoverable*, not *self-evidently
  recoverable*, and many users will still reach for Force Quit and lose the
  work.
- **One residual assumption is not yet verified.** The ⌘⇧L control proves menu
  dispatch survives a *deferred reply*; it does not prove menu dispatch survives
  a *frozen webview*, because the renderer was healthy during that test. The
  reasoning that it will hold — menu events are dispatched on the AppKit main
  thread, which a hung renderer process does not block — is sound but untested.
  **This must be verified on a device against a deliberately wedged renderer
  before this ADR's benefit may be claimed.** If it fails, the escape hatch does
  not exist and this record is superseded rather than quietly patched.
- It adds a second quit-adjacent path to `menu.rs`, which has to stay in sync
  with the coordinator's notion of a live request or it will fire into nothing.

**What it buys.**

- The one failure mode ADR-0029 leaves open stops being terminal. Recovery no
  longer requires Force Quit, which discards exactly the unsaved work the whole
  quit guard exists to protect.
- It works precisely when the frontend does not, because nothing on the path
  touches the webview.
- It reuses the ADR-0027 alert rather than inventing a second destructive
  confirmation, so there is one place where "quit and lose unsaved work" is
  phrased and one place to get that wording right.

**Not decided here.** The item's label, its menu placement, and whether it
carries a keyboard shortcut at all. A shortcut is tempting and risky in equal
measure — it is the fastest route for a trapped user and an easy way to lose
work by accident — and it deserves its own decision rather than being settled
in passing.
