/**
 * Purpose: The replay half of the dtrack hook push pipeline (D177-WI-2, split
 * out of pushCore.mjs by D177-H-1): `flush` sends the spool to the receiver in
 * order, one entry at a time.
 *
 * Pipeline: flush.lock (no wait; held → skipped) → repeat { under spool.lock
 *   take the first entry → release → POST it plus `spool_dead` and
 *   `spool_orphans` → 2xx: remove it / other 4xx: dead.jsonl with status,
 *   remove it / 401·408·429·5xx·other·network: stop, keep it and everything
 *   after } until the spool is empty or the run's deadline passes.
 *
 * Key decisions:
 * - spool.lock is held only around a read or a rewrite, never across a
 *   request, so a hook never waits for a POST.
 * - A whole run is capped at `ctx.flushMaxMs` (default `FLUSH_MAX_MS`, 60 s;
 *   D177-H-1, audit b92 finding 1). No new request starts after the deadline,
 *   and a request still in flight is abandoned when it passes (it carries its
 *   own fetch timeout, cut to what is left). The run then stops with
 *   `{ seq, reason: "deadline" }`, logs it, releases flush.lock and keeps
 *   every unsent entry; a request that did arrive is deduped by the receiver
 *   on the next run.
 * - The replay order is spool (append) order: ascending seq within an epoch,
 *   and an older epoch's leftovers before a newer epoch's.
 * - `spool_dead` (this epoch's dead.jsonl lines) and `spool_orphans` (the
 *   non-empty lines of orphan.jsonl) are read per request, never stored.
 * - push.log carries HTTP statuses, seqs and error names only: never a
 *   response body, a request header, an error message or the token.
 *
 * @module scripts/device/hooks/pushFlush
 * @coordinates-with scripts/device/hooks/pushCore.mjs (re-exports flush)
 * @coordinates-with scripts/device/hooks/receiver.py (dedupe and gaps)
 */
import { acquireLock, releaseLock } from "./pushLocks.mjs";
import { appendJsonl, deadCount, logLine, orphanCount, readConfig, readSpool, writeSpool } from "./pushStore.mjs";
import { FLUSH_SPOOL_WAIT_MS, REQUEST_TIMEOUT_MS, SOURCE_RE, classifyStatus, hookPaths, withDefaults } from "./pushCtx.mjs";

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

/** Resolves "deadline" once `deadline` passes, unless `cancel()` is called first. */
function deadlineTimer(deadline) {
  let timer;
  const fired = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ kind: "deadline" }), Math.max(0, deadline - Date.now()));
  });
  return { fired, cancel: () => clearTimeout(timer) };
}

async function sendOne(c, paths, cfg, entry, deadline) {
  const body = JSON.stringify({
    ...entry,
    spool_dead: deadCount(c, paths, entry.spool_epoch),
    spool_orphans: orphanCount(c, paths),
  });
  const timeoutMs = Math.max(1, Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now()));
  const request = (async () => {
    try {
      const res = await c.post({ url: cfg.url, token: cfg.token, body, timeoutMs });
      const status = Number(res?.status);
      return { status, kind: classifyStatus(status) };
    } catch (e) {
      const code = safeName(e?.cause?.code ?? e?.code);
      return { kind: "network", name: `${safeName(e?.name)}/${code}` };
    }
  })();
  const timer = deadlineTimer(deadline);
  try {
    return await Promise.race([request, timer.fired]);
  } finally {
    timer.cancel();
  }
}

async function drain(c, paths, cfg, out, deadline) {
  for (;;) {
    const first = firstEntry(c, paths);
    if (first === undefined) return { reason: "spool lock busy" };
    const entry = first.value;
    if (entry === null) return null;
    const seq = entry.spool_seq;
    const r = Date.now() >= deadline ? { kind: "deadline" } : await sendOne(c, paths, cfg, entry, deadline);
    if (r.kind === "deadline") {
      logLine(c, paths, `flush stop seq=${seq} deadline after ${c.flushMaxMs} ms`);
      return { seq, reason: "deadline" };
    }
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
 * `{ seq, reason: "status", status }` / `{ seq, reason: "network" }` /
 * `{ seq, reason: "deadline" }` (the run hit `ctx.flushMaxMs`).
 */
export async function flush(ctx) {
  const c = withDefaults(ctx);
  const paths = hookPaths(c.dir);
  const deadline = Date.now() + c.flushMaxMs;
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
      out.stopped = await drain(c, paths, cfg, out, deadline);
    } finally {
      releaseLock(c, paths.flushLock);
    }
    // An entry appended just before the release found the lock held and its
    // flusher gave up; look once more so it is not left until the next hook.
    if (out.stopped !== null || readSpool(c, paths).entries.length === 0) return out;
  }
}

