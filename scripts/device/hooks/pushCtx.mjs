/**
 * Purpose: The shared context of the dtrack hook push pipeline (D177-WI-2,
 * split out of pushCore.mjs by D177-H-1): its constants, the hook-dir file
 * names, `withDefaults` (the real fs, clock, pid probe and poster behind an
 * injected `ctx`), the response classifier and the default poster.
 *
 * Key decisions:
 * - `fetchPost` uses node's fetch, never curl, so the token is not on an argv
 *   visible in `ps`; it resolves `{ status }` only and never reads the body.
 * - `FLUSH_MAX_MS` (60 s) caps a whole flush run, so a detached `--flush`
 *   child always ends (D177-H-1, audit b92 finding 1).
 *
 * @module scripts/device/hooks/pushCtx
 * @coordinates-with scripts/device/hooks/pushCore.mjs, pushFlush.mjs
 */
import nodeFs from "node:fs";
import { pidAlive } from "./pushLocks.mjs";

export const SPOOL_CAP = 5000;
export const REQUEST_TIMEOUT_MS = 3000;
export const SEQ_LOCK_WAIT_MS = 500;
export const FLUSH_SPOOL_WAIT_MS = 2000;
export const FLUSH_MAX_MS = 60_000;
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

/** The injected `ctx` over the real defaults (`flushMaxMs` lets a test shorten the flush cap). */
export function withDefaults(ctx) {
  return {
    fs: nodeFs,
    now: () => new Date(),
    pid: process.pid,
    isAlive: pidAlive,
    post: fetchPost,
    lockWaitMs: SEQ_LOCK_WAIT_MS,
    flushMaxMs: FLUSH_MAX_MS,
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
