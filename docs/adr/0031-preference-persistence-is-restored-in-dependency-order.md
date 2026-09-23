# 0031. Preference persistence is restored in dependency order, not all at once

## Status

**Proposed** (2026-09-23). Supersedes the scope fence recorded in the
`CHANGELOG.md` entry "Frontend structured logging no longer stops shortly after
startup" — specifically its bullet beginning "**Scope, deliberately narrow**".
That bullet is a decision record living in a changelog; this ADR replaces it and
the changelog entry stays as the historical account of what shipped then.

Decided with a Codex deliberation on the sequencing trade-off; the user routed
the question there rather than take the default. Registered as **D24** in
[the D-series defect register](../plans/20260912-frontend-backend-sequencing-order.md#d24).

## Context

`preferencesService.isTauriEnv()` tests for `window.__TAURI__`. Tauri v2 injects
that global only when `app.withGlobalTauri` is enabled, and it is not enabled —
the key is absent from `tauri.conf.json`. The detector is therefore **always
false in the shipping app**, and both halves of the service take a browser-mode
branch: `getPreferences()` returns `DEFAULT_PREFERENCES`, and `setPreferences()`
computes a merged object and discards it. There is no localStorage, no cache and
no error.

So **no user preference has ever been written to disk**, and none persists even
within a session — a Settings panel appears to work only because the React
component holds the value in its own state. `SettingsDialog` is gated on
`if (!open) return null`, so closing the dialog unmounts every page, and each
page re-reads `getPreferences()` on mount. **The loss is therefore visible
without restarting: change a setting, close Settings, reopen it, and the old
value is back.** Every acceptance step written as "restart and check" understates
this. The blast radius is every
preference: theme mode, recent files, sidebar visibility, last view mode, the
whole editor group, all ~56 keyboard shortcuts, export, image, MCP, code theme,
auto-save interval, `markdown.autoPair`.

The evidence is on disk rather than inferred: `~/.mdpro/config.json` carries all
19 keys and **every value is the Rust `Default`**. The file exists only because
`load_preferences()` materialises defaults when it is missing. Two settings do
survive, and both reach Rust through ad-hoc `invoke` calls that skip the service
entirely — per-file window geometry (`windowService.ts`) and logging settings
(`loggingService.ts`, via a `safeInvoke` with no environment detection at all).

This was **known and deliberately fenced**, not overlooked. The fence was held by
a test asserting on the *source bytes* of `preferencesService.ts`
(`toContain('"__TAURI__" in window')`, `not.toContain("__TAURI_INTERNALS__")`),
whose own comment concedes it is below the project's assertion-level floor and
admissible only because its subject is a deliberate non-change.

The fence's stated justification was that correcting the detector "would restore
every preference at once and expose three separately-verified latent defects".
**Re-reading the code found that justification does not hold:**

- **Window geometry physical-vs-logical is real but already live.** The
  per-file geometry path is ungated and never consults the detector. Saves use
  `innerSize()`/`outerPosition()` (physical); restores apply `LogicalSize` and
  `builder.inner_size()` (logical); `scaleFactor()` appears nowhere in the repo.
  All eight `windowStates` entries on disk are byte-identical at
  `x:200 y:200 2400×1600` — exactly 2× the `1200×800 @ 100,100` default on every
  axis, on a scale-2 display. A position doubling from 100 to 200 is not a user
  dragging a window. **The fence never contained this defect.**
- **`lastViewMode` written before read is real and stronger than claimed** —
  deterministic, not a race. The write fires on the commit after
  `preferencesLoaded`; the read is gated behind an `invoke` round-trip and a
  300 ms timer.
- **"The system-theme listener has no cancellation" is false.** `useTheme.ts`
  does return a cleanup that calls `unlisten()`. A narrower defect exists — no
  `cancelled` flag, so a cleanup landing before `listen()` resolves leaks one
  handler — which is one line to fix and barely connected to the detector.

Two further hazards were found that the fence's justification never mentioned,
and they are what actually sets the ordering:

- **`set_preferences` and `save_window_state` both do
  `load_preferences().unwrap_or_default()`.** One unreadable or corrupt
  `config.json` therefore makes `current` a default struct, and the very next
  partial write **rewrites the whole file from defaults**, destroying every other
  setting. `commands/logging.rs` already refuses this exact fallback and its
  comment names `preferences.rs:41` as the divergent case, giving this precise
  reason. The defect was diagnosed, written down next door, and left standing.
  It is inert only because nothing currently calls these commands.
- **A startup effect that writes a pre-hydration default becomes destructive the
  moment persistence works.** An audit of every `setPreferences` call reachable
  at startup found one previously unknown instance beyond `lastViewMode`: the
  `?open=` URL-param effect writes `recentFiles` with no `preferencesLoaded`
  guard, racing hydration. `preferencesLoaded` is a local `useState` inside
  `App`, not a shared flag, so each writer guards itself or does not.

**A third layer sits behind the other two, and it bounds what this ADR can
claim.** Auditing the ledger against the code found preferences that have **no
consumer at all** — the gate is not what stops them working, and correcting the
detector will not make them work. Verified directly:

- `autoApproveEdits` is written by the Integrations toggle and **read by
  nothing**; it appears only in the TS type, its default, and the control that
  sets it. The approval dialog will still fire.
- The MCP server is spawned unconditionally in `main.rs` setup, consulting no
  preference, so the "MCP 服务开关" toggle gates nothing.
- `KeyboardShortcutsSettings.handleSave` calls `setPreferences` and local React
  state only. It never reaches a shortcuts store or re-registers an
  accelerator, so **every** rebind is inert — including in-session.
- `defaultViewMode` updates no store; the export-folder and include-styles
  preferences have no read site; the image paste plugin never passes an asset
  folder through.

**So step 5 makes preferences persist; it does not make them take effect.** For
this group the restored value will be stored faithfully and still ignored,
which is a *worse* observable state than today — today the control is
ineffective and forgets, and afterwards it is ineffective and remembers. These
are separate defects with separate fixes and they are registered separately as
**D25**; this ADR neither fixes them nor claims to.

## Decision

**Restore persistence in dependency order. Each step is independently
reviewable, and every step that could destroy data precedes the step that makes
writes real.**

1. **Stop `set_preferences` and `save_window_state` falling back to defaults.**
   Propagate the load error as `logging.rs` already does. This is first because
   it is the only step whose absence converts a transient read failure into
   total settings loss.
2. **Fix window geometry units**, including the `innerSize`/`outerPosition`
   pairing, not only the scale factor. Independent of the fence and already
   affecting users.
3. **Fix the theme-listener cleanup race** with a `cancelled` flag. Small,
   unrelated, jsdom-testable.
4. **Align the Rust and TypeScript preference contracts in both directions** —
   the fields missing from Rust, and the Rust-only field a full-object write
   would reset. This closes D23. It precedes the detector flip so that the flip
   cannot convert silent field loss into persistently wrong values.
5. **Correct the detector**, delete the source-bytes fence test, and rebuild the
   seven tests that stub `__TAURI__` so they model the real runtime shape. In
   the same change, guard the `recentFiles` startup write on hydration and hold
   `lastViewMode` at `defaultViewMode` so startup cannot clobber the saved value.
6. **Restore last-view-mode properly**, as its own change, once the flip has
   shipped and the read/write ordering is covered.

**`deny_unknown_fields` is not adopted.** Aligning the schema is step 4; making
unknown fields fatal is a different decision with a real cost, taken separately
if at all.

**The source-bytes fence test is deleted, not adapted.** Its replacements are
behavioural: browser mode issues no `invoke`; Tauri mode reaches the backend; a
changed preference survives a reload; the saved view mode is read before any
write can replace it.

## Consequences

- **Gives:** preferences persist **for every preference that has a consumer**.
  The ongoing harm — every setting silently lost on every restart, and on every
  close of the Settings dialog — ends for that group. Two defects that were
  never behind the fence (geometry, the `unwrap_or_default` path) get fixed on
  their own evidence rather than as collateral. A failure after any step is
  attributable to that step.
- **Does not give:** working settings for the D25 group. Persisting a value
  nobody reads converts "ineffective and forgets" into "ineffective and
  remembers". D25 must be sized before step 5 ships, because step 5 is what
  makes that group's failure durable and therefore user-visible as a bug report
  rather than as a quirk.
- **Costs:**
  - **Six changes instead of one**, with the user's preferences still not
    persisting until step 5. Steps 1–4 deliver no user-visible benefit on their
    own; they exist to make step 5 safe.
  - **Restoring persistence makes wrong values durable.** Today a bad
    preference evaporates on restart. After step 5 it survives, and a user may
    not know which field is responsible. This is the real cost of the decision
    and it is accepted.
  - **A deliberate boundary is being removed**, and the judgement that put it
    there was made with less evidence than this record has, not with none. If
    the three latent defects had been as described, the fence would have been
    reasonable.
  - Step 4 changes an on-disk contract. Existing `config.json` files were
    written by Rust and contain only Rust-known fields, so no migration is
    needed today — a fact that stops being true once step 4 ships.
- **Forecloses:** treating `preferencesService` as environment-agnostic. After
  step 5 the detector is load-bearing for real writes, and getting it wrong
  again costs user data rather than costing nothing.
- **Not settled here — the verification lane.** No jsdom test can prove the
  shipping WebView exposes the marker the detector checks; the tests that stub
  the global assert the browser branch as *correct*, which is how this survived.
  Codex recommended a thin automated Tauri smoke lane. This repo has a vitest
  lane, a Rust lane, and a documented **manual** gui-acceptance lane already
  used for D16/D17/D19, and it has refused a harness before. Whether the
  round-trip obligation becomes a new automated lane or a gui-acceptance
  criterion is a real decision with a real cost and belongs to its own record.
  Until it is taken, **step 5 is not verifiable by the automated lanes alone**
  and must not be recorded as verified on their strength.
