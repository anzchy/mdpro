/**
 * Purpose: The core of the dtrack hook push pipeline (D177-WI-2). A Claude
 * Code `type:"command"` hook on the Mac mini runs `push.mjs`; this module
 * numbers each hook event, spools it, and replays the spool to the MacBook
 * receiver in order, so an event survives a Tailscale outage.
 *
 * Pipeline: hook JSON → `enqueue`: spool.lock then seq.lock, both within one
 *   `lockWaitMs` deadline (else → orphan.jsonl, "spool lock busy" / "seq
 *   lock busy", no seq used) → next `{ epoch, seq }` → append
 *   `{ ...payload, spool_source, spool_epoch, spool_seq, spool_ts }` to
 *   spool.jsonl, overflow past `SPOOL_CAP` → dead.jsonl reason "cap".
 *   … `flush`: flush.lock (no wait; held → skipped) → repeat { under
 *   spool.lock take the first entry → release → POST it plus `spool_dead`
 *   and `spool_orphans` →
 *   2xx: remove it / other 4xx: dead.jsonl with status, remove it /
 *   401·408·429·5xx·other·network: stop, keep it and everything after }.
 *
 * Key decisions:
 * - Every side effect comes through `ctx` (`dir`, `fs`, `now`, `post`, `pid`,
 *   `isAlive`, `lockWaitMs`); `withDefaults` fills in the real ones.
 * - The `seq` file is JSON `{ epoch, seq }`. The epoch is random and made only
 *   when the file is created (or replaced after corruption), so a wiped or
 *   corrupt state dir starts a new epoch at seq 1 and the receiver restarts
 *   that source's tracking instead of deduping it away.
 * - One `spool.lock` guards every read-modify-write of spool.jsonl. Flush
 *   holds it only around a read or a rewrite, never across a request, so a
 *   hook never waits for a POST. Lock order is spool → seq, so a busy spool
 *   lock orphans the payload without consuming a seq.
 * - The replay order is spool (append) order: ascending seq within an epoch,
 *   and an older epoch's leftovers before a newer epoch's.
 * - `spool_dead` is derived at send time from dead.jsonl (lines whose entry
 *   has the sent entry's epoch), never stored in the spool. `spool_orphans`
 *   (D177-WI-4) is likewise read per request: the non-empty lines of
 *   orphan.jsonl, the whole file, since an orphan has no epoch.
 * - push.log carries HTTP statuses, seqs and error names only: never a
 *   response body, a request header, an error message or the token.
 *
 * @module scripts/device/hooks/pushCore
 * @coordinates-with scripts/device/hooks/push.mjs (the CLI around it)
 * @coordinates-with scripts/device/hooks/pushLocks.mjs, pushStore.mjs
 * @coordinates-with scripts/device/hooks/receiver.py (dedupe and gaps)
 */
import nodeFs from "node:fs";
import { acquireLock, pidAlive, releaseLock } from "./pushLocks.mjs";
import {
  appendJsonl,
  deadCount,
  logLine,
  orphanCount,
  readConfig,
  readSeqState,
  readSpool,
  writeSeqState,
  writeSpool,
} from "./pushStore.mjs";

export { EPOCH_RE } from "./pushStore.mjs";
export const SPOOL_CAP = 5000;
export const REQUEST_TIMEOUT_MS = 3000;
export const SEQ_LOCK_WAIT_MS = 500;
export const FLUSH_SPOOL_WAIT_MS = 2000;
export const SOURCE_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** File names inside the hook dir. */
export function hookPaths(dir) {
  return {
    config: `${dir}/push.json`,
    token: `${dir}/token`,
    seq: `${dir}/seq`,
    spool: `${dir}/spool.jsonl`,
    dead: `${dir}/dead.jsonl`,
    orphan: `${dir}/orphan.jsonl`,
    log: `${dir}/push.log`,
    seqLock: `${dir}/seq.lock`,
    spoolLock: `${dir}/spool.lock`,
    flushLock: `${dir}/flush.lock`,
  };
}

function withDefaults(ctx) {
  return {
    fs: nodeFs,
    now: () => new Date(),
    pid: process.pid,
    isAlive: pidAlive,
    post: fetchPost,
    lockWaitMs: SEQ_LOCK_WAIT_MS,
    ...ctx,
  };
}

/** `"ok"` (2xx, drop it), `"dead"` (other 4xx) or `"stop"` (keep it and everything after). */
export function classifyStatus(status) {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401 || status === 408 || status === 429) return "stop";
  if (status >= 400 && status < 500) return "dead";
  return "stop";
}

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

const sameEntry = (a, b) =>
  a.spool_source === b.spool_source && a.spool_epoch === b.spool_epoch && a.spool_seq === b.spool_seq;

/** Runs `fn` under spool.lock; returns undefined when the lock stayed busy. */
function underSpoolLock(c, paths, fn) {
  if (!acquireLock(c, paths.spoolLock, Date.now() + FLUSH_SPOOL_WAIT_MS)) return undefined;
  try {
    return { value: fn() };
  } finally {
    releaseLock(c, paths.spoolLock);
  }
}

function firstEntry(c, paths) {
  return underSpoolLock(c, paths, () => {
    const { entries, malformed } = readSpool(c, paths);
    if (malformed.length > 0) {
      for (const line of malformed) appendJsonl(c, paths.dead, { reason: "malformed", line });
      writeSpool(c, paths, entries);
    }
    return entries[0] ?? null;
  });
}

function removeEntry(c, paths, entry, deadRecord) {
  return underSpoolLock(c, paths, () => {
    if (deadRecord) appendJsonl(c, paths.dead, deadRecord);
    const { entries } = readSpool(c, paths);
    const i = entries.findIndex((e) => sameEntry(e, entry));
    if (i >= 0) {
      entries.splice(i, 1);
      writeSpool(c, paths, entries);
    }
  });
}

const safeName = (v) => (typeof v === "string" && /^[A-Za-z0-9_]{1,40}$/.test(v) ? v : "?");

async function sendOne(c, paths, cfg, entry) {
  const body = JSON.stringify({
    ...entry,
    spool_dead: deadCount(c, paths, entry.spool_epoch),
    spool_orphans: orphanCount(c, paths),
  });
  try {
    const res = await c.post({ url: cfg.url, token: cfg.token, body, timeoutMs: REQUEST_TIMEOUT_MS });
    const status = Number(res?.status);
    return { status, kind: classifyStatus(status) };
  } catch (e) {
    const code = safeName(e?.cause?.code ?? e?.code);
    return { kind: "network", name: `${safeName(e?.name)}/${code}` };
  }
}

async function drain(c, paths, cfg, out) {
  for (;;) {
    const first = firstEntry(c, paths);
    if (first === undefined) return { reason: "spool lock busy" };
    const entry = first.value;
    if (entry === null) return null;
    const seq = entry.spool_seq;
    const r = await sendOne(c, paths, cfg, entry);
    if (r.kind === "network") {
      logLine(c, paths, `flush stop seq=${seq} network ${r.name}`);
      return { seq, reason: "network" };
    }
    if (r.kind === "stop") {
      logLine(c, paths, `flush stop seq=${seq} status=${r.status}`);
      return { seq, reason: "status", status: r.status };
    }
    const dead = r.kind === "dead" ? { reason: "status", status: r.status, entry } : null;
    if (removeEntry(c, paths, entry, dead) === undefined) return { reason: "spool lock busy" };
    logLine(c, paths, `flush ${dead ? "dead" : "sent"} seq=${seq} status=${r.status}`);
    (dead ? out.dead : out.sent).push(seq);
  }
}

/**
 * Replays the spool. Resolves `{ skipped, sent, dead, stopped }`: `skipped`
 * when another flusher holds the lock; `stopped` is null (spool drained) or
 * `{ seq, reason: "status", status }` / `{ seq, reason: "network" }`.
 */
export async function flush(ctx) {
  const c = withDefaults(ctx);
  const paths = hookPaths(c.dir);
  const out = { skipped: false, sent: [], dead: [], stopped: null };
  for (;;) {
    if (!acquireLock(c, paths.flushLock, 0)) return out.sent.length + out.dead.length > 0 ? out : { ...out, skipped: true };
    try {
      const cfg = readConfig(c, paths, SOURCE_RE);
      if (cfg === null) {
        logLine(c, paths, "flush stop: push.json or token unusable");
        out.stopped = { seq: null, reason: "config" };
        return out;
      }
      out.stopped = await drain(c, paths, cfg, out);
    } finally {
      releaseLock(c, paths.flushLock);
    }
    // An entry appended just before the release found the lock held and its
    // flusher gave up; look once more so it is not left until the next hook.
    if (out.stopped !== null || readSpool(c, paths).entries.length === 0) return out;
  }
}

/** The default poster: node fetch, `X-Mdpro-Token` header, timeout. Resolves `{ status }` only. */
export async function fetchPost({ url, token, body, timeoutMs = REQUEST_TIMEOUT_MS }) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Mdpro-Token": token },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  await res.arrayBuffer().catch(() => undefined); // drain and discard; the body is never read
  return { status: res.status };
}
