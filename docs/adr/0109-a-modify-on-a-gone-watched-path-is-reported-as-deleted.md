# 0109. A modify on a watched path that no longer exists is reported as deleted

**Status**: Accepted (2026-10-16). Decided by the user, relayed by
mdpro-delegator: D246 goes 「Into v0.3.5 (Recommended)」. The fix direction
came from the delegator's and mdpro-a3's triage; drafted by mdpro-a6 for D246,
number reserved by the delegator. Extends
[ADR-0078](0078-a-watched-file-moved-away-is-reported-as-deleted.md) from
single-path renames to every non-Name `Modify(_)`, and changes what
[ADR-0093](0093-windows-reads-are-proven-stable-by-file-identity-and-the-self-write-gate-matches-every-spelling.md)'s
M5 control expects for `Modify(Any)` on a missing file (see Decision). The
bodies of ADR-0072, ADR-0078 and ADR-0093 are unchanged and their other
decisions stand.

## Context

- **`rm` of an open file showed the reload prompt, not the deleted one**
  (D246, found in the Stage 3 batch 4 device run). On macOS FSEvents reports
  `rm` as one batch, which notify 6.1.1 splits into a `Remove` and then a
  trailing `Modify(Metadata(_))` (sometimes `Modify(Data(_))`) for the same
  path. The device log shows both: `deleted` at 30741, `modified` at 30742.
- **The trailing modify was routed as `modified` with no existence check.**
  `file_watcher_route.rs` checked existence only for `Create`, `Remove` and
  single-path renames (ADR-0072, ADR-0078). D116 keys the debounce by
  (path, kind), so the `modified` was not absorbed by the `deleted` before it,
  and the frontend's latest-wins slot replaced "File was deleted externally"
  with "modified externally". A user who then reloads, or trusts the prompt,
  is told the file is on disk when it exists only in memory: a silent
  data-loss path (rule 60).
- **The router learns the truth the same way ADR-0078 did:** whether the path
  exists when the event is handled. Rust has it; the frontend does not.
- Evidence: triage `~/.mdpro-redesign/stage-3/prep-s3-4-triage.md` (F2);
  device report `~/.mdpro-redesign/stage-3/reports/report-20261015-s3-4-dialogs.md`
  (log lines 30741 → 30749). The live test `mg_e` (real FSEvents `rm`)
  produced a `modified` in 3 runs of 3 before the fix and none in 3 after.

## Options considered

- **(a) Route a non-Name `Modify(_)` on a gone path as `deleted`**, the same
  as a `Remove` on a gone path. Chosen. One router arm; the trailing modify
  then shares the (path, `deleted`) debounce key and is `Debounced`.
- **(b) Frontend: never let a `modified` replace a pending `deleted`.** Lost:
  it is wrong when the file is recreated (a non-atomic save, delete then
  restore), where `modified` is the true last word, and it guesses in the
  layer that cannot stat the file.
- **(c) Route by baseline registration** (gone and registered → `deleted`).
  Lost: it couples routing to the baseline ticket and its races, and leaves
  the bug in place for paths with no baseline entry.
- **(d) Leave it.** Lost: the wrong prompt after `rm` stays.

## Decision

1. **A non-Name `Modify(_)` whose first path does not exist when the event is
   handled is `EmittedDeleted`.** Like ADR-0078's moved-away rename: not
   self-write-gated, `unchangedCheck` `not_checked`, debounced under
   (path, `deleted`), the baseline entry left alone. A modify on a path that
   exists stays `modified`, with the checks it had.
2. **The unchanged check runs only for a `modified` candidate.** A filtered
   kind on a missing file used to fail open to `modified`; it now emits
   `deleted` without a stat of a file that is not there.
3. **Every host, Windows included.** On Windows `Modify(Any)` on a missing
   file now emits `deleted`; ADR-0093's M5 control expected `modified`. The
   frontend needs no change: `deleted` already prompts.

Test pins this replaces (the old expectation was `modified` on a missing path):
`k2` Missing column, `r19_fail_open_missing_stat_emits`,
`m5_windows_modify_any_on_a_missing_file_still_emits`, the `o2` kind table's
Modify rows, and `o9b` (rewritten as
`o9b_emitted_remove_debounces_a_modify_on_the_gone_path_only`). Gate and
observe tests `o7`–`o12` and `o17`, which only needed some modify to emit, now
use a real file (`existing_path` in `file_watcher_kinds_fixture.rs`).
New pins: `file_watcher_route_modify_gone_tests.rs`, `mg_a`–`mg_g`.

## Consequences

- **Gained:** `rm` of an open file ends on the deleted prompt, and the ⌘S
  that recreates it is a choice the user was told about.
- **Cost: a modify handled inside a non-atomic save's gap** (unlink, then
  write) now reports `deleted` for a moment. The write's own `Create`, handled
  once the path exists, still emits `modified` under its own key, so the last
  prompt is the reload one (`mg_f`, and `mg_g` for identical bytes, which the
  new mtime keeps from being provably unchanged).
- **Cost: one edge can end on a stale `deleted`.** A tool that unlinks,
  writes identical bytes and restores the mtime (`rsync -t`-style) makes the
  recreated file provably unchanged, so its `Create` is `IgnoredUnchanged`.
  Before D246 a modify handled during the gap emitted `modified` and covered
  this; now the deleted prompt stays over a file that exists. Nothing is lost:
  the content is in memory and the prompt offers Save.
- **Existence is read when the event is handled, not when it happened.** A
  modify from before an `rm` that is handled after it reports `deleted`; that
  is the state the user needs to see.
- **Windows behaviour changed** (Decision 3) and goes on the Windows device
  list: a `Modify(Any)` on a missing file prompts deleted, not modified.
- **Forecloses:** treating a vanished path as changed content on any event
  kind, without first pairing events through a backend that reports both
  sides.
