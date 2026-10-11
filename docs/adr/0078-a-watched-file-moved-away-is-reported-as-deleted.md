# 0078. A watched file moved away is reported as deleted

**Status**: Accepted (2026-10-11; proposed the same day by mdpro-a6 for D107).
User decided, relayed by mdpro-delegator: 「批准：D116 先、D107 后，ADR-0078
(Recommended)」. Supersedes
[ADR-0072](0072-a-replaced-watched-file-is-checked-like-a-content-change.md)
decision 3 for single-path renames only. ADR-0072's other decisions stand.
Depends on D116, which keys the watcher debounce by path and change kind.

## Context

ADR-0072 decision 3 kept a single-path `Modify(Name(_))` event on a path that
no longer exists as `IgnoredRenameSinglePath`. Its Consequences listed the cost:
"Not covered: a file moved away (D107). The document keeps its old path, and
⌘S recreates the file there." So when another program moves a watched file
away (`mv`, Finder, a sync client), mdpro says nothing, and the user's next ⌘S
silently writes the document back at the old path. A plain `Remove` of the
same file already reaches the frontend as `deleted`. The frontend then shows
"File was deleted externally. Save to a new location if needed."
(`src/utils/dataLossGuards.ts`).

notify 6.1.1's FSEvents backend reports a rename as single-path
`Modify(Name(Any))` and doesn't pair the two sides (ADR-0072 Context). So the
watcher can't tell "moved to X" from "moved away" from "about to be
replaced". The only signal it has is whether the path exists when the event is
handled.

A "safe save" editor renames the target to a backup, then renames a temp file
onto the target. Its first event can arrive while the path is briefly gone.
Before D116, the watcher's 500 ms per-path debounce would then swallow the
replacement's `modified` event, because it came within 500 ms of the `deleted`
one.

## Options considered

- **(a) Keep ADR-0072 decision 3.** A moved file stays ignored. Nothing new can
  go wrong, but the silent recreation on ⌘S stays. That's the defect D107
  records.
- **(b) Route a single-path Name event on a missing path as `deleted`** (the
  same as a `Remove`). The decision is made from the path's existence when the
  event is handled. No timing is involved, and the IPC contract doesn't change.
  Its weak spot is the safe-save gap. With D116, `deleted` and `modified` have
  separate debounce entries, so the replacement's `modified` also emits, and the
  frontend's 300 ms debounce delivers the last event.
- **(c) Report `deleted` only after a short grace re-check that the path is
  still gone.** This would absorb safe-save without depending on D116. But the
  notify callback runs on one thread for every watched path. Waiting there
  delays every other file's events; scheduling the re-check elsewhere adds a
  timer and an ordering problem against later events for the same path. Any
  fixed grace is a guess: a slower safe-save, for example over a network
  volume or with a sync client, still produces the false prompt. And a real
  move gets reported later by exactly the grace. (c) would still be the
  fallback if (b) shows a visible flicker on a real device.

## Decision

(b). A single-path `Modify(Name(_))` on a watched path that no longer exists,
when its event is handled, is routed as a change of type `deleted`
(`EmittedDeleted`), the same as a `Remove` on a missing path. It isn't
self-write-gated (only `EmittedModified` is). It goes straight to the D116
debounce keyed by (path, `deleted`), then emits. It never runs the unchanged
check, because there is no file to read; its `unchangedCheck` is
`not_checked`. It doesn't touch the baseline entry. This applies only to a
path that no longer exists when the event is handled. A `Remove` (or rename)
whose path still exists is a replaced file, routed as `modified` (ADR-0072
decision 1, extended to `Remove` by D152). A `Create` on a missing path stays
`IgnoredKind`. Two-path renames stay as they are (`renamed` with `newPath`).
The frontend needs no change: `deleted` already prompts.

## Consequences

- **Gained:** an external move of a watched file prompts. The ⌘S that recreates
  the file at the old path is no longer silent; the user has been told.
- **Cost: a safe save can show a brief "deleted" prompt that is then replaced.**
  If the replacement event arrives more than the frontend's 300 ms after the
  `deleted` one, the user may see "File was deleted externally" before
  "modified externally" replaces it. The final prompt is right and nothing is
  lost. A device run measures how often this happens. If it's frequent, (c)
  is the next step.
- **Cost: depends on D116.** Without per-kind debounce keys, the safe-save case
  would end on a false `deleted` prompt. D107 doesn't land before D116.
- **Not changed:** where the file went. mdpro still doesn't learn the new path
  of a moved file, because single-path events don't carry it. The document
  keeps its old path, as with a deleted file.
- **Forecloses:** treating a vanished path as anything but deleted without
  first pairing rename events, which would need a backend that reports both
  sides.
