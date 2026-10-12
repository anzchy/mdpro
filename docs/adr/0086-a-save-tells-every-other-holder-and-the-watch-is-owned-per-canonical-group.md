# 0086. A save tells every other holder of the file, and the watch is owned per canonical group

**Status**: Proposed (2026-10-12, mdpro-a6, for D173). The user chose 「Let Codex
weigh in — deliberate, then recommend」; Codex's plan review
(`~/.mdpro-redesign/reviews/d173-codex-review-20261012.md`) said NEEDS REVISION,
2 BLOCK + 8 MUST, resolved in plan r2, which mdpro-delegator approved. Accepted
when D173's commit 1 lands. It then partially supersedes
[ADR-0068](0068-file-watcher-drops-metadata-and-content-events-when-the-file-is-unchanged.md)
decision 4 ("`unwatch`, which removes it", now only when the canonical group
empties) and decision 7 ("No IPC change"; "The `file:changed` payload is
unchanged"), and
[ADR-0081](0081-external-changes-are-kept-per-document-and-an-open-reports-a-change-since-its-read.md)'s
"Not covered: two windows on one path (D173)". Evidence:
[`20261012-d173-notify-fsevents-watch-semantics.md`](../reference/20261012-d173-notify-fsevents-watch-semantics.md).

## Context

D173 (MUST): two windows hold one file. **Closing it in one window unwatches it
for both**: the watch list has no owner. **A save in one is hidden from the
other**: the self-write mark is process-global and the save moves the one shared
baseline, so its FSEvents event is `SelfWrite` or `IgnoredUnchanged` for all;
B's ⌘S then overwrites A's save unprompted. Also: notify keeps one **canonical**
filter key per file, so unwatching any spelling silences the others; every
`watch` / `unwatch` restarts the FSEvents stream and loses events in flight; the
route knows no saving window or document; and a second window's register
overwrites the shared baseline, absorbing an external write not yet routed.

## Options considered

- **Saver-scoped self-write suppression and refresh** (the row's direction), so
  the save's own FSEvents event reaches the others. As stated it fails: the
  shared baseline still makes it `IgnoredUnchanged`. Codex named two buildable
  repairs. **Per-consumer baselines** lost because they rewrite ADR-0068's
  store, tickets and claims and their receipted tests. **Explicit listener
  targets** with per-document filtering lost because a late event needs
  attribution: a timed "recent save" table (the heuristic D86 WI-4 removed) or
  state that outlives the save. All three depend on FSEvents delivering the
  save, which a stream restart can drop.
- **Save-side notice (chosen).** The save knows the file, window and document,
  and tells the other holders directly.

## Decision

1. **Two-layer holders.** Holds are keyed by (window label, raw spelling) with a
   monotonic generation; a stale-generation release does nothing. A **canonical
   group** owns the notify watch: notify `unwatch` runs only when the group has
   no consumer, and clears every spelling it gave notify.
2. **Locks.** A transition lock is held through teardown's notify `unwatch`
   (transitions → holders; transitions → watcher → list → baseline). The holders
   lock is a leaf: no I/O, no other lock. **The notify callback never takes the
   transition lock**: notify's `stop()` joins the callback's thread, so that
   wait deadlocks teardown.
3. **Close rule.** A window calls `release_watch_hold(path, gen)` once no
   document in it holds the path; `close_document` stops unwatching.
   `WindowEvent::Destroyed` (never `CloseRequested`) calls `release_window` and
   fences the label.
4. **Save notice.** After a successful write, `save_file` and `save_file_dialog`
   emit one `file:changed` (`modified`) per distinct held spelling of the write
   target's group, with an additive `origin: {windowLabel, documentId}`. A
   failed emit is logged at error, not retried, and does not fail the save.
5. **Receipt policy** (listener and capture replay): record every matching
   document except the exact origin document in the origin window; never clear
   or replace a pending slot.
6. **Second-holder reconciliation** (WI-4): a register into a live group
   compares the prior baseline hash with the stored one; on a difference or an
   unknown hash, every held spelling gets a plain `file:changed`.

## Consequences

- **Gained**: a save prompts every other holder, sibling tabs included, and
  blocks their ⌘S. Closing no longer silences others; second-open absorption is
  closed.
- **Cost: payload and IPC.** `file:changed` gains `origin`; open, Save As and
  recover replies gain `holdGen`; new `release_watch_hold`.
- **Cost: concurrent saves race.** B's ⌘S already past its guard still writes; A
  is told after. No Rust revision check.
- **Cost: a webview reload keeps holds** until the window is destroyed.
- **Cost: a reconcile notice can prompt the new document once** for bytes it
  already read.
- **Cost: notify limits remain.** Its case-insensitive stream removal means
  releasing `Foo.md` silences `foo.md` on a case-sensitive volume; restarts
  still lose events.
- **Not covered: alias-spelling delivery**, owned by
  [D185](../plans/20260912-frontend-backend-sequencing-order.md#d185).
- **Cost: volume.** One broadcast per spelling per save to every window, and
  more log lines.
- **Forecloses**: informing other holders through the save's FSEvents event.
