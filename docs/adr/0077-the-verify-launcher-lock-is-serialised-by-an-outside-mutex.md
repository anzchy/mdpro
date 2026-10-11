# 0077. The verify launcher's lock is serialised by an outside mutex

## Status

**Accepted** (2026-10-11, adr047-verify; delegator concurred). Implements
[D105](../plans/20260912-frontend-backend-sequencing-order.md#d105). It applies to the
launcher tooling under [ADR-0047](./0047-agents-verify-in-the-real-app-through-a-feature-gated-control-channel.md)
(`scripts/control/`). ADR-0047 says nothing about the launcher lock, so no clause of it
is superseded.

## Context

- The launcher keeps one lock per runs directory (`.lock`, a record `{run, nonce}`).
  [D82](../plans/20260912-frontend-backend-sequencing-order.md#d82) made release
  check-then-act safe by renaming `.lock` into a private tomb and linking it back if the
  record was not ours.
- A renamed file cannot serialise itself. While `.lock` is missing, another process can
  create it. Then a releaser that took someone else's record cannot put it back, and two
  processes both believe they hold the lock (D105 ①).
- A crash between the rename and the link-back left the record in a tomb with no error.
  A failed delete of the releaser's own tomb still returned `released`.
- `clean`'s stale-socket step had no shared point to serialise on. A second cleaner
  released an orphan lock, a launcher took it and bound `si.sock`, and the first cleaner
  deleted the live socket (D105 ②).
- All lock sections are synchronous and short (microseconds to milliseconds). The tool
  runs on one Mac (the mini) under Node, with no native add-ons.

## Options considered

- **`flock` on a lock file.** Lost: Node has no `flock` API, macOS ships no `flock(1)`,
  and the only route is a native dependency for a test tool.
- **Owner re-check alone** (re-read the lock before every destructive step). Lost: it
  closes ② only through a timing argument (no await between re-check and unlink), and it
  leaves ① open, because the gap is inside release itself.
- **Break a stale mutex by age.** Lost: a slow holder past the age limit and a newcomer
  would both hold it, which is the failure the mutex exists to stop.
- **An O_EXCL mutex file, broken only when its holder is provably dead.** Chosen.

## Decision

- `<parent>/.lock.mutex` is created with O_EXCL and holds only `{pid, token}`.
  `withLockMutex` waits for it with a bounded synchronous poll (`MUTEX_WAIT_MS`), then
  fails with `lock busy: …`. Re-entry from the same process fails at once.
- It is broken only when `kill(pid, 0)` returns ESRCH, and only while holding a second
  O_EXCL file, `.lock.mutex.break`, which nobody but its creator removes. It is never
  broken by age. Release removes it only if the token is ours.
- Acquire, both releases, and `clean`'s final lock re-check plus `si.sock` unlink run
  under it. The socket is unlinked only if the lock is absent or names the run being
  cleaned.
- The tomb protocol stays inside the mutex as a guard against scripts that do not take it.
  Acquire refuses while any tomb exists (`lock interrupted: kept <tomb> (run X)`), and a
  failed own-tomb delete is reported (`released; tomb kept: <b>`).
- Sections stay synchronous. No step inside `withLockMutex` may await.

## Consequences

- **Cost: manual removal.** A stale `.lock.mutex.break`, or a holder pid the OS has
  reused, blocks every launch until someone deletes the file named in the error. ESRCH is
  never wrong, but "alive" can be.
- **Cost: older checkouts are not covered.** Scripts from a verify worktree at an older
  SHA ignore the mutex. Only the tomb protocol guards against them.
- **Cost: a leftover tomb blocks launches.** This is deliberate (nothing is restored
  automatically), but `doctor` does not report tombs yet. The refusal message is the only
  guidance.
- **Cost: recorded tests changed.** Several D82 schedule tests had competitors acquiring
  inside a release section. They now write the record raw (rule 12, disclosed in the
  D105 commits). K-H1-3's recorded "c2 displaced" specified the hole and now reads
  "restored".
- **Forecloses** any asynchronous step inside a lock section.
- **Gained:** at most one holder over every injected schedule, including the case that
  defeated D82, and no silent release failures.
