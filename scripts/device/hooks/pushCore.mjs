/**
 * Purpose: The core of the dtrack hook push pipeline (D177-WI-2). A Claude
 * Code `type:"command"` hook on the Mac mini runs `push.mjs`; this module
 * numbers each hook event and spools it, and re-exports the replay (`flush`,
 * pushFlush.mjs) and the shared context (pushCtx.mjs), so the spool reaches
 * the MacBook receiver in order and an event survives a Tailscale outage.
 * The split (D177-H-1) keeps each file under 300 lines; callers and tests
 * import everything from here.
 *
 * Pipeline: hook JSON → `enqueue`: spool.lock then seq.lock, both within one
 *   `lockWaitMs` deadline (else → orphan.jsonl, "spool lock busy" / "seq
 *   lock busy", no seq used) → next `{ epoch, seq }` → append
 *   `{ ...payload, spool_source, spool_epoch, spool_seq, spool_ts }` to
 *   spool.jsonl, overflow past `SPOOL_CAP` → dead.jsonl reason "cap".
 *   … `flush` (pushFlush.mjs): replay in spool order, capped at
 *   `FLUSH_MAX_MS` per run.
 *
 * Key decisions:
 * - Every side effect comes through `ctx` (`dir`, `fs`, `now`, `post`, `pid`,
 *   `isAlive`, `lockWaitMs`, `flushMaxMs`); `withDefaults` (pushCtx.mjs)
 *   fills in the real ones.
 * - The `seq` file is JSON `{ epoch, seq }`. The epoch is random and made only
 *   when the file is created (or replaced after corruption), so a wiped or
 *   corrupt state dir starts a new epoch at seq 1 and the receiver restarts
 *   that source's tracking instead of deduping it away.
 * - One `spool.lock` guards every read-modify-write of spool.jsonl. Flush
 *   holds it only around a read or a rewrite, never across a request, so a
 *   hook never waits for a POST. Lock order is spool → seq, so a busy spool
 *   lock orphans the payload without consuming a seq.
 * - A seq stays a safe integer below `Number.MAX_SAFE_INTEGER - 1`
 *   (pushStore.mjs; D177-H-3): reaching it rolls over to a new epoch, so a
 *   seq never repeats.
 * - push.log carries HTTP statuses, seqs and error names only: never a
 *   response body, a request header, an error message or the token.
 *
 * @module scripts/device/hooks/pushCore
 * @coordinates-with scripts/device/hooks/push.mjs (the CLI around it)
 * @coordinates-with scripts/device/hooks/pushCtx.mjs, pushFlush.mjs, pushLocks.mjs, pushStore.mjs
 * @coordinates-with scripts/device/hooks/receiver.py (dedupe and gaps)
 */
import { acquireLock, releaseLock } from "./pushLocks.mjs";
import { appendJsonl, logLine, readConfig, readSeqState, readSpool, writeSeqState, writeSpool } from "./pushStore.mjs";
import { SOURCE_RE, SPOOL_CAP, hookPaths, withDefaults } from "./pushCtx.mjs";

export { EPOCH_RE } from "./pushStore.mjs";
export {
  FLUSH_MAX_MS,
  FLUSH_SPOOL_WAIT_MS,
  REQUEST_TIMEOUT_MS,
  SEQ_LOCK_WAIT_MS,
  SOURCE_RE,
  SPOOL_CAP,
  classifyStatus,
  fetchPost,
  hookPaths,
} from "./pushCtx.mjs";
export { flush } from "./pushFlush.mjs";

function takeSeq(c, paths) {
  const state = readSeqState(c, paths);
  const next = { epoch: state.epoch, seq: state.seq + 1 };
  writeSeqState(c, paths, next);
  return next;
}

/**
 * Takes the next `{ epoch, seq }` under the seq lock; the first ever is seq 1
 * of a new epoch. Throws "seq lock busy" if a live owner holds the lock past
 * `ctx.lockWaitMs` (default `SEQ_LOCK_WAIT_MS`).
 */
export function nextSeq(ctx) {
  const c = withDefaults(ctx);
  const paths = hookPaths(c.dir);
  if (!acquireLock(c, paths.seqLock, Date.now() + c.lockWaitMs)) throw new Error("seq lock busy");
  try {
    return takeSeq(c, paths);
  } finally {
    releaseLock(c, paths.seqLock);
  }
}

function orphan(c, paths, payload, reason) {
  appendJsonl(c, paths.orphan, { ...payload, orphan_ts: c.now().toISOString(), orphan_reason: reason });
  logLine(c, paths, `orphaned: ${reason}`);
  return { seq: null, orphaned: true, dropped: 0 };
}

/** Appends one entry and trims the spool to `SPOOL_CAP`; returns how many were dropped. Caller holds spool.lock. */
function appendCapped(c, paths, entry) {
  const { entries, malformed } = readSpool(c, paths);
  for (const line of malformed) appendJsonl(c, paths.dead, { reason: "malformed", line });
  entries.push(entry);
  const over = Math.max(0, entries.length - SPOOL_CAP);
  const dropped = entries.splice(0, over);
  for (const e of dropped) appendJsonl(c, paths.dead, { reason: "cap", entry: e });
  if (over > 0 || malformed.length > 0) writeSpool(c, paths, entries);
  else c.fs.appendFileSync(paths.spool, JSON.stringify(entry) + "\n", { mode: 0o600 });
  if (over > 0) logLine(c, paths, `cap: dropped ${over} oldest (seq ${dropped.map((e) => e.spool_seq).join(",")})`);
  return over;
}

/**
 * Numbers and spools one hook payload. Returns `{ seq, dropped }`, or
 * `{ seq: null, orphaned: true, dropped: 0 }` when a lock stayed busy (or
 * push.json is unusable) and the payload went to orphan.jsonl.
 */
export function enqueue(ctx, payload) {
  const c = withDefaults(ctx);
  const paths = hookPaths(c.dir);
  const cfg = readConfig(c, paths, SOURCE_RE);
  if (cfg === null) return orphan(c, paths, payload, "config unreadable");
  const deadline = Date.now() + c.lockWaitMs;
  if (!acquireLock(c, paths.spoolLock, deadline)) return orphan(c, paths, payload, "spool lock busy");
  try {
    if (!acquireLock(c, paths.seqLock, deadline)) return orphan(c, paths, payload, "seq lock busy");
    let id;
    try {
      id = takeSeq(c, paths);
    } finally {
      releaseLock(c, paths.seqLock);
    }
    const entry = {
      ...payload,
      spool_source: cfg.source,
      spool_epoch: id.epoch,
      spool_seq: id.seq,
      spool_ts: c.now().toISOString(),
    };
    return { seq: id.seq, dropped: appendCapped(c, paths, entry) };
  } finally {
    releaseLock(c, paths.spoolLock);
  }
}

