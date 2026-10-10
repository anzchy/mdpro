# 0053. Only explicit view-mode commands persist lastViewMode

**Status**: Accepted (2026-10-07, D24 / ADR-0031 step 6; proposed and accepted
the same day, when the user approved the D24 Part A commit).

## Context

ADR-0031 step 6 is "Restore last-view-mode properly". Step 5 made
`lastViewMode` persist and held every write until the stored value had been
read (Amendment A1). After that settle, `useLastViewModePersistence` wrote **every** `viewMode` change.
The D24 row in
[`docs/plans/20260912-frontend-backend-sequencing-order.md`](../plans/20260912-frontend-backend-sequencing-order.md#d24)
names audit finding F5:

- Opening a large document auto-downgrades the window to Source
  (`App.tsx` degrade path). That downgrade was written as the user's
  `lastViewMode`, so the next launch started in Source although the user never
  chose it.
- The same holds for the other switches the app makes on its own once
  settled: a file drop and a Finder open reset the mode to `defaultViewMode`,
  and that reset was persisted. The launch-paths reset runs before settle, so
  it most likely never wrote; `?open=` in a secondary window depends on timing
  and was not verified either way. Both are now programmatic regardless.

The forces as understood at the time:

- The store's `setViewMode` had one caller signature for both kinds of switch,
  so the hook could not tell a user choice from an app decision by observing
  `viewMode`.
- There are four explicit commands: View menu set, View menu cycle, the
  keyboard cycle shortcut, and the source editor's `Mod-/`. There are at least
  five programmatic sites, and any future one is more likely to be added
  without thought than an explicit command is.
- Picking View > Source while the degrade already shows Source changes nothing
  on screen, but the user did choose Source (decision D-3).

## Decision

1. `setViewMode(mode, intent)` and `cycleViewMode(intent)` take an intent,
   `"user"` or `"programmatic"`. **The default is `"programmatic"`**, so a caller
   that does not label its switch never writes (fails closed). Only the literal
   `"user"` counts.
2. The editor store keeps `userViewModeChoice: { seq, mode }`. Every user
   command replaces it with `{ seq + 1, landed mode }`, **even when the mode does
   not change** (D-3). Programmatic switches never touch it.
3. The four explicit commands call the store through `userViewModeCommands`,
   an adapter that always passes `"user"` and ignores the positional
   `actionId` menu and keyboard handlers supply.
4. `useLastViewModePersistence` observes `userViewModeChoice.seq`, not
   `viewMode`. It applies the stored mode on settle as a programmatic switch.
   Its stale-read guard counts user choices, not mode changes, so a repeated
   same-mode choice still wins over a pending re-read.
5. `view.mode.change` logs carry the resolved `intent`. The event is still
   logged only when the mode actually changes, so a no-change user command
   (D-3) logs no `view.mode.change`.

## Consequences

- **Gives:** the large-document degrade, drops and Finder opens no longer
  overwrite the saved mode, and launch paths and `?open=` cannot. A relaunch restores the
  mode the user last picked.
- **Costs and limits:**
  - **A new switch site must choose correctly.** A future explicit command
    wired to the raw store action silently stops persisting. The source-text
    guards in `tests/view-mode-intent-call-site.test.ts` cover today's sites
    only.
  - **When a file is open at launch, the latch compares a user choice against
    the on-screen mode, not against disk.** If the launch path shows
    `defaultViewMode` and the user picks that same mode, the latch's duplicate
    check sees no change and writes nothing, even if disk holds the other mode.
    The next start in an empty window then restores the mode the user just
    declined. Pinned as a characterisation by LVI-11 (unchanged from before this
    decision); a later explicit switch corrects disk.
  - **A no-change user command is a write candidate** (D-3), so one extra
    `set_preferences` is possible where the stored value already matches; the
    latch's duplicate check suppresses it in the common case.
  - Two kinds of call now exist for one action. Readers must know that
    `setViewMode(m)` with no intent is the app talking, not the user.
  - **An explicit command during the startup hold still loses** to the
    stored value (Amendment A1, LVH-02); a command made before settle is not
    persisted.
  - **The latch's `lastSeen` is per window.** A value written by another
    window is not seen, so a choice equal to this window's `lastSeen` writes
    nothing even if another window has since written the other mode.
  - **The App wiring is verified only by source-text tests**
    (`tests/view-mode-intent-call-site.test.ts`) and the device fixture
    `tests/manual-fixtures/d24-step6-last-view-mode.md`; no test renders App.
  - **GA-5's expectations change**: the degrade and `?open=` steps now expect
    no `lastViewMode` write, not one.
  - This does not change the two preference reads at startup in a window with
    no document (GA-12); that stays an open question in the D24 row.
