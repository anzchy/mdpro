# Desktop GUI lock: agreement with picsee (2026-10-27)

This records the condition that ends [ADR-0134](../adr/0134-the-herdr-roster-moves-to-the-mac-mini-isolated-from-picsee.md)
decision 6's per-run check, as anticipated by
[ADR-0144](../adr/0144-behaviour-acs-are-proved-in-the-real-app-before-landing.md) § The user's answers 1.

- **The user's word:** 「Negotiate the lock (Recommended)」 (2026-10-27).
- **How it was agreed:** herdr-delegator messaged picsee-delegator, under rule 71's permission for direct lock
  coordination.

## What picsee confirmed

picsee confirmed that it already takes `$HOME/.cache/desktop-gui.lock` before every GUI run on the Mac mini, since
the two projects' 2026-10-24 agreement.

- **Helper:** picsee's `gui-lock.sh acquire|wait|release|status`.
- **Acquire** is an atomic `mkdir`. The lock holds an `owner` file with `project`, `session`, `batch`, `start`,
  `pid`, `expected_minutes` and `purpose`.
- **Release** removes only its own lock. Exit 75 means busy, and the waiter then runs no GUI.
- **Scope:** the lock is taken before the first GUI action (launch, panels, keys, mouse, drags, screen capture,
  activation). It is held across relaunches, and released after the app has quit and cleanup is done, aborted runs
  included. Builds and log reads use the heavy lock instead.
- **Since picsee #175,** picsee runs a 10–20 minute device smoke before merging each PR that changes user-visible
  behaviour.

## Terms both sides keep

1. **`expected_minutes` is set honestly.** A hold more than 30 minutes past it lets the waiting side ask its own
   user. Neither side ever removes the other's lock, and a lock that looks stale goes to the owner's user.
2. **There is no hard maximum hold.** A long batch, for example picsee's 60–90 minute parity run, says so up front.
3. **picsee messages mdpro-delegator when a GUI run starts and when it ends,** as a courtesy. The lock remains the
   authority.

## Consequence for mdpro

mdpro's GUI runs no longer ask the user, per run, for the word that picsee starts no GUI. The lock alone serialises
the desktop.

The rule 70 § The Mac mini and rule 71 paragraphs that still describe the per-run word are superseded on this point
by this record and ADR-0144. They will be edited the next time those files are clean to commit; they currently carry
the user's uncommitted edits.
