# 0037. The global window state belongs to `main`; every other window's geometry belongs to its builder

## Status

**Accepted** (2026-09-26). Taken while implementing the D24 follow-up on
`docs/plans/20260912-frontend-backend-sequencing-order.md` (per-file window
geometry restored on every route that builds a window for a file). The
mechanism was put to an independent review (Codex, job
`review-plan-muhj2is2-oavdk9`) before it was chosen. It constrains step 5 of
[ADR-0031](./0031-preference-persistence-is-restored-in-dependency-order.md),
which is Accepted and left unchanged.

The implementation lands in the same change. The device checks D-1…D-6
in `.claude/tdd-guardian/plan-20260926-062337.md` have not run yet.

## Context

The 2026-09-25 device run (`docs/test/20260925-r7-d29-d24-gui-acceptance.md`)
saved b.md's window as logical `333,177 / 1011×655`. It then reopened b.md
from Finder and got `100,100 / 1200×800`. The obvious cause was on the Rust
side: `open_file_in_new_window` never read the stored geometry and hard-coded
`inner_size(1200, 800)`. Reading the code found a second cause, and the second
one decides the design.

- **Finding 0: every window applied the global `windowState` after mount.**
  `App.tsx` `loadPreferences` called `applyWindowState(prefs.windowState)` in
  every webview, not only in `main`. Step 5 has not landed, so `isTauriEnv()`
  is false and `getPreferences()` returns the frontend default
  `{1200, 800, x:100, y:100}`. Every window was therefore resized to 1200×800
  and moved to 100,100. `open_file_in_new_window` sets no position, so the
  100,100 the device saw came from the frontend, not from Rust.
- **So a Rust-only fix could not pass the device check.** A window restored by
  its builder would be overwritten a few hundred milliseconds later. After
  step 5 it would be overwritten with `main`'s saved `windowState` instead of
  the default, which is still not the file's geometry.
- **There are two sources of geometry and they disagree about scope.**
  `windowState` is one global record. `windowStates` is keyed by file path.
  Only one of them can govern a given window.
- **Two ways to stop hydration moving a window were considered.**
  - *A label gate*: hydration applies `windowState` only in the window whose
    label is `main`.
  - *A URL flag*: a window restored by Rust gets `?geometry=restored`, and
    hydration skips windows that carry it.

  The review rejected the flag for two reasons. A secondary window **with no
  stored record** carries no flag, so hydration would still move it to the
  global record, and ⌘⇧N windows would keep landing at 100,100. And putting
  geometry provenance in the URL means every future window-creation path has
  to remember to set the flag. A path that forgets it fails silently.

## Decision

1. **The global `windowState` belongs to the window labelled `main`, and to no
   other window.** Hydration asks `ownsGlobalWindowState(label)`, which is exact
   equality with `"main"`: no prefix match, case folding or trimming
   (`src/utils/windowGeometry.ts`). The effect lives in
   `src/services/windowStateApplier.ts`. Every other window gets `skip`, which
   issues no `setSize` or `setPosition` and logs
   `window.apply_state {outcome:"skipped", reason:"not_main"}`.
2. **A secondary window's geometry is owned by the Rust builder that creates
   it.** Both building sites, `open_file_in_new_window`
   (`services/open_route/tauri_glue.rs`) and `create_window`
   (`commands/window.rs`), take size and position from one helper,
   `window_restore::restore_geometry_for`. With a path and a stored record,
   the window opens at that record, clamped to the primary display's work
   area. With no path (⌘⇧N), no record, or an unreadable `config.json`, it
   opens at the default size fitted to the screen with **no** position, and
   the window server cascades it.
3. **When step 5 lands, the save side must mirror this.** Only `main` may write
   the global `windowState`. Today `useWindowCloseGuard.saveWindowState` writes
   it from any closing window. That is harmless now only because step 5 still
   gates the write.

## Consequences

**What it costs.**

- **⌘⇧N windows no longer inherit the global record.** Before this change a
  new window was moved to the same place as the global record (in practice
  always 100,100). Now it opens cascaded at the fitted default, and after step
  5 it still will not open where `main` last was. That is a visible change,
  and someone will read it as a regression.
- **Step 5 inherits an obligation.** If step 5 un-gates
  `useWindowCloseGuard.saveWindowState` without also restricting it to `main`,
  closing any secondary window overwrites `main`'s record with that window's
  frame. `main` then reopens where some other window last was, and nothing
  errors. This record is the only guard until step 5 is written.
- **The string `"main"` becomes a contract.** It is the label Tauri gives the
  window declared in `tauri.conf.json`, which sets no label of its own.
  Renaming that window, giving it an explicit label, or making a window other
  than the first one the "primary" window breaks the gate silently. The label
  is named once, as `GLOBAL_WINDOW_STATE_OWNER`, and pinned by unit tests.
  Neither catches a change made in `tauri.conf.json`.
- **`main` still gets no per-file restore.** On cold launch `main` exists
  before any path is known. A file opened at launch, or opened as a tab in an
  existing window, never restores that file's geometry. Fixing that means
  deciding between `main`'s `windowState` and a file's record, and it belongs
  with step 5.
- **Clamping is against the primary display only.** A record saved on a
  secondary display that is still connected is pulled onto the primary one.
- **Per-file restore is now coupled to D29's path-identity rule.** The lookup
  uses `open_route`'s `same_file` (ADR-0033 decision 2), so a change to that
  rule changes both.

**What it buys.**

- A window opened for a file comes back where the user left it, and nothing
  in the frontend moves it afterwards.
- A new window that has no record is cascaded instead of stacked exactly on
  top of the last one.
- The rule survives future window-creation paths without anyone remembering
  to set a flag: any window that is not `main` is left alone.

**Re-open when** mdpro needs more than one window that should remember a
global frame, or when `main` stops being the first window the app creates.
