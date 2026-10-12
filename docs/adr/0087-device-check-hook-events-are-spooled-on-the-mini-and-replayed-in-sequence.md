# 0087. Device-check hook events are spooled on the mini and replayed in sequence

**Status**: Proposed (2026-10-12). Written by the D177 implementor for
mdpro-delegator; acceptance and who decides are recorded here when it happens.

## Context

Rule 70 tells the delegator to wait for the device tester's hook events rather
than poll its screen. dtrack, the tester's Claude session on the Mac mini,
pushes `Stop`, `Notification` and `SessionStart` to a receiver on the MacBook
through Claude Code's built-in `type:"http"` hook
([option 3.2](../reference/20261011-claude-cross-machine-session-control.md)).
That hook is fire-and-forget: a failed POST is not retried and leaves no trace on
either side.

On 2026-10-12, 10:20–10:24, dtrack ran the 0.2.6 → 0.3.1 canary
([record](../test/20261012-canary-026-to-031-device-check.md)) and not one `Stop`
event arrived, because the mini's network had changed and Tailscale was down
([D177](../plans/20260912-frontend-backend-sequencing-order.md#d177)). The
delegator could not tell an idle tester from a lost event. The pipeline itself
(`receiver.py`, `wait-dtrack.sh`, `last-dtrack.sh`, a settings builder) lived
only in `~/.mdpro-redesign/hooks/`, outside git: untested, unaudited, and gone if
that directory were wiped.

## Options considered

1. **Keep the built-in http hook** (status quo). Lost: it is the cause. No
   retry, no sequence number, and the receiver cannot see what it missed.
2. **A command hook that spools on the mini and replays in sequence** (chosen).
3. **A launchd periodic flusher on the mini.** Deferred, not rejected: it is
   another moving part on a machine the device harness owns, and it needs the
   user's word. It is the remedy if limit (a) below bites in practice.
4. **Keep the code outside git.** Rejected: no receipts, no audit (ADR-0085),
   and lost when the directory is wiped.

## Decision

1. **Wire format.** `push.mjs` POSTs the hook's JSON unchanged, plus
   `spool_source` (`[A-Za-z0-9._-]{1,64}`), `spool_epoch`
   (`[A-Za-z0-9_-]{8,64}`, random, made when the mini's seq counter is first
   created), `spool_seq` (integer ≥ 1), `spool_ts` (the hook's time, ISO-8601),
   `spool_dead` and `spool_orphans` (integers ≥ 0; `spool_orphans` may be
   absent). A body with no `spool_*` key is the legacy http-hook payload and is
   stored as before. A spooled body with an invalid field gets 400.
2. **The receiver dedupes on (source, epoch, seq).** A duplicate gets 200 and
   is not stored. A new epoch retires the old one and restarts that source's
   tracking. A replay from a retired epoch is stale: 200, not stored, logged.
   `seq-state.json` persists this across restarts. `gaps.json` holds the current
   epoch per source as `{epoch, max, missing, dead[, orphans]}`, and
   `last-dtrack.sh` / `wait-dtrack.sh` print it as `missing seq A..B (source)`,
   `dead N (source)` and `orphans N (source)`.
3. **Locks.** `spool.lock`, `seq.lock` and `flush.lock` are atomic `mkdir`
   dirs with an owner pid, and a dead owner's lock is reclaimed. The lock
   order is spool, then seq. Flush holds `spool.lock` only around each
   rewrite, never across a request. When a lock stays busy past 500 ms, the
   event goes to `orphan.jsonl` without using up a seq.
4. **Replay rules.** Entries go one at a time in spool order. A 2xx deletes
   the entry. 401, 408, 429, 5xx and network errors stop the flush and keep
   the entry and everything after it. Any other 4xx moves the entry to
   `dead.jsonl`, and the flush continues. The spool holds at most 5000
   entries; past that, the oldest go to `dead.jsonl` (reason `cap`).
5. **Transport.** Requests use node's built-in `fetch` with a 3 s timeout,
   not curl. curl would put the token on its argv, which `ps` shows. The logs
   carry statuses and error names only.
6. **The hook stays fast.** It spools, starts `push.mjs --flush` as a
   detached child, and exits 0 in under 1 s. It exits 0 even on bad input.
7. **The code lives in git** under `scripts/device/hooks/`, with tests
   `tests/d177-*`. The install and cutover steps are in its
   [README](../../scripts/device/hooks/README.md).

## Consequences

- **Gained:** an outage now delays events instead of losing them, and a gap
  shows up as a number instead of as silence.
- **Cost: one more script on dtrack's hook path.** A bug in `push.mjs` runs
  on every tester event. It always exits 0, so the worst case is a silent
  stop, the same failure mode as before.
- **Cost: the token now exists in a second place,** a 0600 file on the
  mini, which `push.mjs` reads. The settings file no longer carries it.
- **Cost: the receiver now has state** (`seq-state.json`, `gaps.json`). A
  corrupt state file is moved aside and tracking restarts empty.
- **Cost: cutover needs the user.** Only the user may restart dtrack's
  `claude` process (rule 70).
- **Limits, accepted:**
  - (a) The spool flushes only when the next hook event fires. If dtrack goes
    quiet after the network returns, its events wait. A timed-out
    `wait-dtrack.sh` should be followed by `last-dtrack.sh`, which shows the
    gap.
  - An orphaned event shows up only as a count, and only after a later POST
    succeeds.
  - Only 64 retired epochs are kept per source. A replay from an epoch
    dropped off that list looks like a new epoch.
  - At most 10,000 missing seqs are tracked per source.
  - The Tailscale-down device check was not exercised (user decision). A
    receiver-down run stands in for it.
