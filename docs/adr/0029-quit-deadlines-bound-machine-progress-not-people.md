# 0029. Quit deadlines bound machine progress, not people

**Status**: Accepted (2026-09-23; Proposed earlier the same day). Supersedes the
**single-deadline model** of
[ADR-0027](./0027-a-quit-ack-timeout-draws-a-native-alert.md). ADR-0027's alert and
its wording survive unchanged; only the rule for *when* the alert is reached
changes.

Decisions 1, 2, 4 and 5 were implemented in `d0e6420`. **Decision 3 was withdrawn
before implementation** and never shipped — see the decision itself and the
Consequences; its replacement is
[ADR-0030](./0030-a-menu-item-is-the-escape-hatch-for-a-stuck-quit.md).

## Context

ADR-0025 defers quit through `applicationShouldTerminate:` returning
`NSTerminateLater`, and ADR-0027 gives the request one deadline: a phase-1 ack that
has not arrived 2 s after the request started hands the request to a native alert.

Implementing WI-4 and WI-7 and then reviewing the result exposed that this is the
*only* deadline the request ever has, and that it is the wrong shape for phase 2.

The timer is armed exactly once, in `begin`, for `started_ms + 2000`. In the normal
case every window acks well inside 2 s, so that single tick finds no `Pending`
window, returns `Wait`, and is never re-armed. **From that instant the request has no
deadline of any kind.** A window that is `Prompted` and never answers leaves
`NSTerminateLater` unresolved forever: the app becomes unquittable with no alert and
no log line, and Force Quit — which discards exactly the unsaved work this machinery
exists to protect — is the only way out.

Three forces pull against each other:

1. **Phase 2 waits on a human.** Applying a 2 s deadline there would raise the
   "mdpro isn't responding … quitting will discard unsaved changes in every window"
   alert while the user is reading the Save prompt. Because the fallback seizes the
   request exclusively, that alert would *override* the careful per-window choice the
   user was in the middle of making. A deadline on human thought is not a safety
   feature; it is a data-loss feature.
2. **No deadline is the defect above.**
3. **A long deadline (minutes) resolves neither force.** It still replaces a
   legitimate Save prompt with a destructive warning for anyone who steps away, and
   it only postpones the ambiguity rather than removing it.

The ambiguity is irreducible: **silence cannot distinguish a person reading a dialog
from a renderer that froze immediately after drawing it.** No timeout can tell those
apart, so the guarantee we can actually offer is not "every quit finishes within a
fixed duration" but "a healthy native host stays recoverable even when a renderer
fails."

Two further facts decided the shape:

- The coordinator's liveness depends entirely on its effects *succeeding*, and the
  effects layer discards the `Result` of every one of them — `emit_to` (so a prompt
  that never reaches its webview is indistinguishable from one that did),
  `run_on_main_thread` for the alert (so a failed dispatch leaves the request owned
  by an alert that never appears), and `run_on_main_thread` for
  `replyToApplicationShouldTerminate` (so the app can fail to quit after a perfect
  protocol run). An unreported effect failure is a permanent hang in every case.
- `ns_reply_for` maps `Begin::AlreadyPending` to `NSTerminateCancel`. A second ⌘Q —
  the exact gesture a trapped user makes — is therefore swallowed, leaving the stuck
  request intact. The one recovery route the user would reach for by instinct is
  currently wired shut.

## Decision

**Deadlines bound machine progress only. Human decision time is never bounded.**

*(As first written this sentence ended "…and the escape hatch for a wedged renderer is
the user's own second ⌘Q." That half was withdrawn before implementation — see
decision 3. There is currently no escape hatch.)*

1. **Split delivery from decision in phase 2.** Issuing a prompt starts a fresh
   delivery deadline, measured from when *that prompt* was issued rather than from
   the start of the request, and re-armed for each prompt. The frontend sends a cheap
   delivery ack once it has committed the dialog UI. Until that ack the window is
   bounded; after it the window has unbounded time to answer. A decision that arrives
   without its ack counts as implicit delivery confirmation.
2. **A missing delivery ack means delivery could not be confirmed** — not that the
   webview is proven hung. It routes to the ADR-0027 alert, whose existing wording
   already claims no more than that.
3. ~~**A second `terminate:` on a live request escalates instead of cancelling.**~~
   **WITHDRAWN 2026-09-23, before implementation — the premise is false.** This
   decision proposed that `AlreadyPending` hand the request to the native alert
   instead of returning `NSTerminateCancel`, making the user's second ⌘Q the escape
   hatch for a wedged renderer. A device probe showed **AppKit never delivers it**:
   while an `NSTerminateLater` reply is outstanding, a second ⌘Q does not reach
   `applicationShouldTerminate:` at all. `Begin::AlreadyPending` is therefore
   unreachable from the keyboard, and the escape hatch this ADR was counting on does
   not exist. See Consequences for the evidence and what it leaves open. The
   `NS_TERMINATE_CANCEL` arm is **not** wrong and is left untouched — a programmatic
   `terminate:` can still reach it — but it must never again be cited as the user's
   route out of a stuck quit.
4. **Every liveness-critical effect reports its failure into the coordinator**
   instead of discarding it, and logs at error level with the request id and phase. A
   failed emit is a failed delivery. A failed alert dispatch releases fallback
   ownership rather than stranding it.
5. **An early tick re-arms for the remaining delay** rather than returning `Wait` and
   losing the request's only wake-up.

## Consequences

**What it costs.**

- The coordinator gains a state and the frontend gains a message. The
  "one timer, one deadline" simplicity that made ADR-0027 easy to reason about is
  gone, and there are more interleavings to test.
- **We give up automatic detection of a post-ack renderer freeze**, and — see below —
  we now know we get nothing in exchange. There is no escape hatch.

- **Decision 3's premise was tested on a device and is false.** It assumed AppKit
  would invoke the delegate again while an `NSTerminateLater` was outstanding. It does
  not. With a quit prompt on screen, a second ⌘Q produces: no visible change, **zero
  new bytes in `~/.mdpro/mdpro.log`**, and the original prompt intact.

  The measurement had to be built, because the stock binary cannot answer it:
  `QuitGuard::begin` logs only inside its `if let Begin::Later` arm, so an
  `AlreadyPending` hit writes no line at all — "AppKit re-invoked the delegate" and
  "AppKit swallowed the keystroke" are byte-identical silences. A temporary
  `app.quit.hook_probe` line was therefore added as the **first statement inside the
  `should_terminate` IMP**, before `host()`. First ⌘Q: `hook_probe{outcome:"enter"}` →
  `app.quit.request` → `hook_probe{outcome:"later",nsReply:2}`. Second ⌘Q: **no
  `hook_probe` at all — the IMP is never entered.** Control against "the keystroke
  never arrived": with the same prompt up, ⌘⇧L did fire (`ui.menu.select`), so the
  menu bar was live and ⌘Q specifically was suppressed. The diagnostic was then
  removed, the pristine bundle rebuilt and verified free of the probe string, and the
  result reproduced exactly.

  So `Begin::AlreadyPending` is **unreachable from a real second ⌘Q**. AppKit
  suppresses the quit path for the whole duration of the deferred reply. The
  `NS_TERMINATE_CANCEL` arm is not wrong — a programmatic `terminate:` still reaches
  it — but the ADR-0025 §2 reasoning behind it defends a path the keyboard cannot
  take, and it must not be cited as a user-facing recovery route.

  **Consequence: the ack-then-freeze hole has no remedy in this ADR.** Decisions 1, 2,
  4 and 5 are implemented; decision 3 is withdrawn with nothing put in its place. A
  webview that acknowledges delivery and *then* freezes still strands the quit, and
  the user's only exit is Force Quit — which discards the unsaved work this machinery
  exists to protect. Choosing the replacement (a long backstop deadline, a Dock or
  menu affordance, or accepting the hole) is a real decision with real costs and is
  deliberately **not** made here; it belongs to its own record, taken with this
  evidence in hand rather than folded into an ADR whose premise it just invalidated.

**What it buys.**

- The unquittable-app defect is closed for the cases that are detectable at all: a
  failed emit, and a renderer that never draws its prompt. **The
  undetectable-by-construction case — a webview that acks delivery and then freezes —
  stays open, permanently as far as this ADR goes.** The probe settled decision 3
  against us. Decisions 1, 2, 4 and 5 do not close that case and are not claimed to.
- A user deliberating over Save is never interrupted by a destructive warning.
- Effect failures become observable in `~/.mdpro/mdpro.log` instead of presenting as
  a hang with no evidence.

**Not decided here.** Whether "Save" settles on *selection* or on *write completion*
is a real gap — a failed or cancelled Save As must not settle a window — but it is
orthogonal to liveness and is left to its own record.
