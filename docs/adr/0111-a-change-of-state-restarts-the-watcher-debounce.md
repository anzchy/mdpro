# 0111. A change of state restarts the watcher debounce, and only a lookup that says so makes a path gone

**Status**: Accepted (2026-10-16). Number reserved by mdpro-delegator for
D246's audit follow-ups H-1 and H-2 (audit b167 on the D246 fix); the
directions were agreed by the delegator on 2026-10-16 (H-2: `fs::metadata`,
only `NotFound` counts as gone) and the item was granted for v0.3.6 under the
user's scope 「Core + polish (Recommended)」. Drafted by mdpro-a6. Amends
D116's debounce key law (one window per (path, kind)) and
[ADR-0109](0109-a-modify-on-a-gone-watched-path-is-reported-as-deleted.md)'s
existence test. The bodies of ADR-0068, ADR-0078 and ADR-0109 are unchanged
and their other decisions stand.

## Context

- **H-1: a quick modify → unlink → recreate can end on a stuck `deleted`.**
  D116 debounces by (path, kind), leading edge only, for 500 ms
  (`file_watcher_gate.rs`, `is_debounced`). A `modified` at t0 stamps
  (p, `modified`). The unlink then emits `deleted` under its own key. If the
  file is recreated before t0 + 500 ms, the recreate's event is a `modified`
  candidate and is `Debounced` by the stale (p, `modified`) stamp. There is no
  trailing emit, so the frontend's last word is "deleted" over a file that
  exists. This predates D246; ADR-0109 made `deleted` reachable from more
  events, so the window is easier to hit.
- **H-2: a lookup error was read as "gone".** ADR-0109's router and the
  `Remove` arm used `Path::exists`, which is `false` on **any** metadata error.
  A parent directory the user can no longer search (`PermissionDenied`), or an
  I/O error, therefore emitted `deleted`, and the unchanged check never ran.
  "Deleted" is the prompt that tells the user the document now lives only in
  memory; showing it for a file that may still be there is the wrong warning.
- Source: audit b167 on the D246 branch; prep notes
  `~/.mdpro-redesign/prep/d247-d248-plan.md` § "Hardening from audit b167".

## Options considered

- **H-1 (a): an emission clears the same path's entries of every other
  kind.** Chosen. A change of state restarts the window; a repeat of the same
  state is still absorbed. No timer. The `rm` batch's trailing modify is
  still debounced, because after ADR-0109 it is a `deleted` that follows a
  `deleted`.
- **H-1 (b): a trailing-edge emit timer.** Lost, for the reasons ADR-0078
  option (c) gave: a timer per path in the watcher thread, a delayed prompt,
  and a new race between the timer and the next event.
- **H-1 (c): one key per path, ignoring kind.** Lost: a `renamed` and a
  `modified` of the same path inside 500 ms are two facts, and dropping the
  second loses the reload prompt that D116 kept.
- **H-2 (a): `fs::metadata` and only `NotFound` / `NotADirectory` mean gone.**
  Chosen. Links are followed, as `Path::exists` did. `NotADirectory` covers a
  parent replaced by a file, where the path cannot exist.
- **H-2 (b): `fs::symlink_metadata`.** Lost: a watched symlink whose target
  was removed would read as present, a change from today's behaviour the
  audit did not ask for.
- **Leave both.** Lost: each ends on the wrong prompt over a document the user
  may lose.

## Decision

1. **An emission records its (path, kind) and drops that path's entries of
   every other kind** (`is_debounced`, `map.retain`). A suppressed event still
   refreshes nothing. Other paths' entries are untouched.
2. **A path is gone only when looking it up fails with `NotFound`, or with
   `NotADirectory`** (`file_watcher_route.rs`, `is_gone`). Any other error
   routes the path as present: a `modified` candidate whose unchanged check
   then fails open as `read_failed`, as it did before ADR-0109 for unreadable
   files. This applies to ADR-0109's modify arm and to the `Remove` arm.

Test pins this changes: `o9_debounce_is_per_first_path_and_per_kind` (a
`modified` after a `renamed` on one path now emits, and each path keeps only
its last kind) and `o9b_emitted_remove_debounces_a_modify_on_the_gone_path_only`
(the `modified` that follows a recreate clears the `deleted` entry). New pins:
`file_watcher_route_state_change_tests.rs` `sc_a`–`sc_d` (receipt
`D246-WI-2`) and, on unix, `file_watcher_route_gone_error_tests.rs`
`ge_a`–`ge_d` (receipt `D246-WI-3`).

## Consequences

- **Gained:** a recreate inside the window ends on the reload prompt, and an
  unreadable parent no longer claims the file was deleted.
- **Cost: more emissions in a burst that alternates states.** A file that is
  modified, deleted and recreated several times inside 500 ms emits once per
  change of state instead of once per kind. The frontend keeps one slot per
  document, latest wins, so the user sees the last state; the log has more
  lines.
- **Cost: a permission error now shows the reload prompt, not the deleted
  one.** If the file really was deleted behind a parent the user can no
  longer read, mdpro cannot tell, and says "modified" (the reload then fails
  and says why). That is the safer wrong answer: it does not tell the user the
  file is gone while it may not be.
- **Existence is still read when the event is handled** (ADR-0109); a change
  between the event and the lookup is not seen.
- **Forecloses:** treating any lookup error as proof of deletion, and a
  per-path debounce window that outlives a change of state.
