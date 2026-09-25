# 0036. The stuck-quit escape hatch is an always-enabled app-menu item without a shortcut

## Status

**Accepted** (2026-09-25), after the implementation (`3b6c157`) passed the
device check named at the end of the Amendment. m1, m2 and m3 all passed, and
so did ADR-0030's residual check against a renderer frozen with `SIGSTOP`
(`docs/test/20260925-r7-d29-d24-gui-acceptance.md`). This record is now
immutable. The run found one wording defect: the alert still says the app
"didn't answer in time" when it was reached from this item. That is a change to
the ADR-0027 alert text and needs no new decision here.

**Proposed** (2026-09-25). Settles the three questions
[ADR-0030](./0030-a-menu-item-is-the-escape-hatch-for-a-stuck-quit.md) left
open under *Not decided here*: the item's label, its placement, and whether it
has a keyboard shortcut. ADR-0030 itself is unchanged. The user delegated these
choices ("按照最佳实践，由你来定"), so this record is the author's call and is
open to challenge before implementation lands.

## Context

ADR-0030 decided that a custom Rust-handled menu item hands a live, stuck quit
request to the ADR-0027 native alert. Three forces bear on how that item looks:

- **Where a trapped user looks.** ⌘Q has just failed to do anything. The next
  place people look is the menu that holds Quit, which is the app menu. An item
  in File or Window will not be found.
- **The failure it recovers from is a frozen renderer.** Anything that makes
  the item's usefulness depend on extra state being kept in sync during that
  failure weakens the one path that has to work. Enabling the item only while a
  request is live is the macOS convention, but it adds a `set_enabled` call on
  every request start and end. If one of those calls goes missing, the hatch is
  greyed out exactly when it is needed.
- **ADR-0030 §5 on wording.** The label must promise only that it reaches a
  decision, and must not read as a safe or lossless quit.

## Decision

1. **Placement**: the app menu (`mdpro`), directly below the predefined Quit
   item.
2. **Label**: `Stop Waiting and Quit…`. The ellipsis follows the macOS
   convention that a confirmation follows, and here that confirmation is the
   ADR-0027 alert. "Stop waiting" names what the user is doing: giving up on
   the windows that have not answered. The label does not claim anything is
   saved.
3. **No keyboard shortcut.** The fastest route to a destructive path is also the
   easiest to take by accident, and the state it serves is rare.
4. **Always enabled.** When no quit request is live it does nothing, and logs a
   no-op (ADR-0030 §3) with counts only. Its usefulness does not depend on any
   menu-state update.

## Consequences

**What it costs.**

- **A live-looking item that usually does nothing.** Clicked on an idle app, it
  gives no visible response, which will read as broken to someone who tries it
  out of curiosity. Greying it out would be clearer and is what AppKit
  convention expects. It was rejected only for the reliability reason above.
- **The label is still a compromise.** "Stop Waiting and Quit…" is vague to
  anyone who has never been stuck. Only the alert behind it states the loss.
- **No shortcut means the user must use the mouse** at the exact moment they
  are most frustrated. ADR-0030's discoverability cost stands in full.

**What it buys.**

- Nothing needs to have gone right for the item to be usable. It is built once,
  at menu creation, and its handler asks the coordinator directly.
- There is one destructive confirmation, the ADR-0027 alert, and one place
  where its wording lives.

**Re-open when** device evidence shows users do not find it, or when
enable-while-live can be driven from the same code path that opens the request
and so cannot drift.

## Amendment

*Amendment (2026-09-25, while Proposed, after implementation).* The item is
built as `menu.app.stop_waiting_quit` and handled in Rust only
(`menu.rs` → `quit_guard::deliver_escape`), with no `menu:action` emit. What a
click does depends on the phase of the coordinator's live request. When more
than one marker applies, the precedence is fallback > backstop > prompted >
deciding > everything else (`escape.rs`).

| Phase (log `phase`) | Ruling (log `outcome`) | Source |
|---|---|---|
| No live request (`idle`) | `noop` | ADR-0030 §3 |
| Phase 1, a re-check round, or residual (`checking`) | `fallback`: ADR-0027 alert | ADR-0030 §2 |
| A window was prompted but has not acked (`awaitingDelivery`) | `fallback` | ADR-0030 §2 |
| A dialog is up and acked (`deciding`) | `fallback` | ADR-0030 §2 |
| ADR-0035 draft backstop running (`backstop`) | `ignored`, reason `outOfPhase` | **ADR-silent; decided here** |
| The alert already owns the request (`fallback`) | `ignored`, reason `fallbackOwns` | ADR-0027: one alert per request |
| Committed / terminating | `noop`: indistinguishable from idle | **ADR-silent; decided here** |

A `fallback` ruling does exactly what an ack timeout does. It hands the
request to the ADR-0027 alert, the alert then owns it, and late webview replies
are refused with `fallbackOwns`. After Keep Open the request is gone, so a new
quit followed by the escape alerts again. Every click writes one
`app.quit.escape` line *before* the alert, instead of `app.quit.timeout`. The
line holds the outcome and phase, plus requestId, round, unresolvedCount and
reason. These are counts and enums only, with no labels, ids, paths or content.

**Costs of the two ADR-silent rows.**

- **Backstop → ignored.** Handing the backstop to the alert would bring back
  the loss that ADR-0035 corrected: the alert's Quit Without Saving drops
  discards the user already accepted. The backstop commits on its own 2 s
  deadline instead. The cost is that the escape is inert for up to 2 s. Also,
  if the backstop timer's main-thread dispatch fails (`effect_failed
  timerDispatch`), the quit is stranded, and this item cannot rescue it.
- **Committed → noop.** Once commit has taken the request, the coordinator
  cannot tell that state from idle, and `NSTerminateLater` must be answered
  exactly once. The cost is that a failed final `reply(true)` after commit is
  not recoverable from this item.

**A cost of the `deciding` row, which follows from ADR-0030 §2 rather than
from a choice made here.** A healthy window that is only waiting on a person
reading its dialog can now be sent to the alert's Quit Without Saving. That
option quits with unsaved in-memory edits unwritten, and it drops the discards
the user already accepted, so their drafts survive (ADR-0027 §5). Before this
item, no timer could reach that path from `deciding` (ADR-0029). The alert
states the loss, and that is the only guard.

Status stays **Proposed**. It becomes Accepted only after the device check has
run: m1 (placement, enabled, no shortcut), m2 (an idle click logs `noop`), m3
(a click in `deciding` shows the alert, and Keep Open restores the app), and
ADR-0030's residual check against a deliberately wedged renderer.
